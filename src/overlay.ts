/**
 * Capability-unit overlay implementation over a `GraphLayer`. Registers
 * the `"capability-unit"` domain idempotently at construction time and
 * provides the write + read API surfaced by `CapabilityUnitOverlay`.
 *
 * Edges out from a unit node:
 *   - `entry`    → seed element
 *   - `composes` → strictly-owned member (one edge per owned element)
 *   - `uses`     → shared element the closure references
 */

import type { Edge, GraphLayer, GraphMutator, Node } from "@kepello/nodegraph-core";
import {
  CAPABILITY_UNIT_DOMAIN,
  CAPABILITY_UNIT_INDEXES,
  CAPABILITY_UNIT_METADATA_KIND,
  CAPABILITY_UNIT_METADATA_SCHEMA,
} from "./schema.js";
import {
  COMPOSES_EDGE_TYPE,
  ENTRY_EDGE_TYPE,
  USES_EDGE_TYPE,
  type CapabilityUnitInput,
  type CapabilityUnitMetadata,
  type CapabilityUnitNode,
  type CapabilityUnitOverlay,
} from "./types.js";

export class CapabilityUnitOverlayImpl implements CapabilityUnitOverlay {
  private readonly mutator: GraphMutator<typeof CAPABILITY_UNIT_DOMAIN>;

  constructor(private readonly graph: GraphLayer) {
    // Per Fathom row 5.0.42: registerOverlay returns the domain-scoped
    // mutator; this overlay holds it for all substrate writes.
    this.mutator = this.graph.registerOverlay({
      domain: CAPABILITY_UNIT_DOMAIN,
      metadataSchema: CAPABILITY_UNIT_METADATA_SCHEMA,
      indexes: CAPABILITY_UNIT_INDEXES,
    });
  }

  insertUnit(input: CapabilityUnitInput): CapabilityUnitNode {
    return this.graph.transaction(
      {
        kind: "insert-capability-unit",
        producerDomain: CAPABILITY_UNIT_DOMAIN,
        summary: `insert capability unit ${input.unitId}`,
      },
      () => this.doInsertUnit(input),
    ).result;
  }

  private doInsertUnit(input: CapabilityUnitInput): CapabilityUnitNode {
    const metadata = buildMetadata(input);
    const existing = this.graph.getLiveNodeByNaturalKey(
      CAPABILITY_UNIT_DOMAIN,
      input.unitId,
    );
    let node: Node;
    if (existing === undefined) {
      node = this.mutator.insertNode({
        domain: CAPABILITY_UNIT_DOMAIN,
        naturalKey: input.unitId,
        contentHash: input.contentHash,
        metadata: metadata as unknown,
      });
    } else if (existing.contentHash === input.contentHash) {
      node = existing;
    } else {
      node = this.mutator.supersedeNode(existing.id, {
        contentHash: input.contentHash,
        metadata: metadata as unknown,
      });
    }

    // entry edge — always exactly one. Tombstone any others first.
    const existingEntry = this.graph
      .edgesFrom(node.id, { type: ENTRY_EDGE_TYPE, includeDangling: true });
    let hasCorrectEntry = false;
    for (const e of existingEntry) {
      const matches =
        e.targetId === input.entryElementId ||
        e.targetRef === input.entryElementId;
      if (matches) hasCorrectEntry = true;
      else this.mutator.tombstoneEdge(e.id);
    }
    if (!hasCorrectEntry) {
      const byId = this.graph.getNodeById(input.entryElementId);
      if (byId !== undefined) {
        this.mutator.insertEdge({
          sourceId: node.id,
          targetId: input.entryElementId,
          type: ENTRY_EDGE_TYPE,
        });
      } else {
        this.mutator.insertEdge({
          sourceId: node.id,
          targetRef: input.entryElementId,
          type: ENTRY_EDGE_TYPE,
        });
      }
    }

    // composes + uses — emit missing, leave existing in place.
    this.emitMembershipEdges(
      node.id,
      input.ownedElementIds,
      COMPOSES_EDGE_TYPE,
    );
    this.emitMembershipEdges(
      node.id,
      input.usedElementIds,
      USES_EDGE_TYPE,
    );

    return asUnit(node);
  }

  private emitMembershipEdges(
    sourceId: string,
    targets: readonly string[],
    edgeType: string,
  ): void {
    const existing = this.graph.edgesFrom(sourceId, {
      type: edgeType,
      includeDangling: true,
    });
    const existingTargets = new Set<string>();
    for (const e of existing) {
      if (e.targetId !== null) existingTargets.add(e.targetId);
      if (e.targetRef !== null) existingTargets.add(e.targetRef);
    }
    for (const target of targets) {
      if (existingTargets.has(target)) continue;
      const byId = this.graph.getNodeById(target);
      if (byId !== undefined) {
        this.mutator.insertEdge({ sourceId, targetId: target, type: edgeType });
      } else {
        this.mutator.insertEdge({ sourceId, targetRef: target, type: edgeType });
      }
    }
  }

  renameUnit(unitId: string, displayName: string): CapabilityUnitNode {
    return this.graph.transaction(
      {
        kind: "rename-capability-unit",
        producerDomain: CAPABILITY_UNIT_DOMAIN,
        summary: `rename capability unit ${unitId}`,
      },
      () => {
        const existing = this.graph.getLiveNodeByNaturalKey(
          CAPABILITY_UNIT_DOMAIN,
          unitId,
        );
        if (existing === undefined) {
          throw new Error(`No live capability unit with unitId=${unitId}`);
        }
        const prior = existing.metadata as CapabilityUnitMetadata | null;
        if (prior === null) {
          throw new Error(`Capability unit ${unitId} has no metadata`);
        }
        const next: CapabilityUnitMetadata = { ...prior, displayName };
        const node = this.mutator.supersedeNode(existing.id, {
          contentHash: existing.contentHash,
          metadata: next as unknown,
        });
        return asUnit(node);
      },
    ).result;
  }

  tombstoneUnit(unitId: string): void {
    this.graph.transaction(
      {
        kind: "tombstone-capability-unit",
        producerDomain: CAPABILITY_UNIT_DOMAIN,
        summary: `tombstone capability unit ${unitId}`,
      },
      () => {
        const existing = this.graph.getLiveNodeByNaturalKey(
          CAPABILITY_UNIT_DOMAIN,
          unitId,
        );
        if (existing === undefined) return;
        this.mutator.tombstoneNode(existing.id);
      },
    );
  }

  listUnits(): CapabilityUnitNode[] {
    return this.graph
      .queryNodes({ domain: CAPABILITY_UNIT_DOMAIN, lifecycleState: "live" })
      .map(asUnit);
  }

  getUnit(unitId: string): CapabilityUnitNode | undefined {
    const node = this.graph.getLiveNodeByNaturalKey(
      CAPABILITY_UNIT_DOMAIN,
      unitId,
    );
    return node === undefined ? undefined : asUnit(node);
  }

  unitForEntry(entryElementId: string): CapabilityUnitNode | undefined {
    // Walk incoming `entry` edges; resolve UUIDs first, then natural keys.
    const edges = this.graph.edgesTo(entryElementId, { type: ENTRY_EDGE_TYPE });
    if (edges.length === 0) {
      const byRef = this.graph
        .queryEdges({ targetRef: entryElementId, type: ENTRY_EDGE_TYPE });
      if (byRef.length === 0) return undefined;
      edges.push(...byRef);
    }
    // Per Fathom row `perf-getbyid-consumer-migrations` (5.0.1.2.3.1):
    // batch the per-edge source-node hydration into one IN-clause query.
    const sourceNodes = this.graph.getNodesByIds(edges.map((e) => e.sourceId));
    for (const edge of edges) {
      const node = sourceNodes.get(edge.sourceId);
      if (
        node !== undefined &&
        node.lifecycleState === "live" &&
        node.domain === CAPABILITY_UNIT_DOMAIN
      ) {
        return asUnit(node);
      }
    }
    return undefined;
  }

  membersOf(unitId: string): Edge[] {
    const unit = this.graph.getLiveNodeByNaturalKey(
      CAPABILITY_UNIT_DOMAIN,
      unitId,
    );
    if (unit === undefined) return [];
    return this.graph.edgesFrom(unit.id, {
      type: COMPOSES_EDGE_TYPE,
      includeDangling: true,
    });
  }

  usedBy(unitId: string): Edge[] {
    const unit = this.graph.getLiveNodeByNaturalKey(
      CAPABILITY_UNIT_DOMAIN,
      unitId,
    );
    if (unit === undefined) return [];
    return this.graph.edgesFrom(unit.id, {
      type: USES_EDGE_TYPE,
      includeDangling: true,
    });
  }

  unitsThatUse(elementId: string): CapabilityUnitNode[] {
    // Incoming `uses` edges; resolved first, then natural-key form.
    // Per Fathom row `perf-getbyid-consumer-migrations` (5.0.1.2.3.1):
    // collect all candidate source-ids first, batch-hydrate once via
    // `getNodesByIds`, then filter. Pre-fix: one SQL per edge. Post-fix:
    // one IN-clause query for the union.
    const allEdges: Edge[] = [
      ...this.graph.edgesTo(elementId, { type: USES_EDGE_TYPE }),
      ...this.graph.queryEdges({ targetRef: elementId, type: USES_EDGE_TYPE }),
    ];
    const candidateIds = Array.from(new Set(allEdges.map((e) => e.sourceId)));
    const nodes = this.graph.getNodesByIds(candidateIds);
    const out: CapabilityUnitNode[] = [];
    for (const id of candidateIds) {
      const node = nodes.get(id);
      if (
        node !== undefined &&
        node.lifecycleState === "live" &&
        node.domain === CAPABILITY_UNIT_DOMAIN
      ) {
        out.push(asUnit(node));
      }
    }
    return out;
  }
}

function buildMetadata(input: CapabilityUnitInput): CapabilityUnitMetadata {
  const meta: CapabilityUnitMetadata = {
    kind: CAPABILITY_UNIT_METADATA_KIND,
    unitId: input.unitId,
    entryElementId: input.entryElementId,
    entryName: input.entryName,
    name: input.name,
    ownedCount: input.ownedElementIds.length,
    usedCount: input.usedElementIds.length,
  };
  if (input.displayName !== undefined) meta.displayName = input.displayName;
  if (input.language !== undefined) meta.language = input.language;
  return meta;
}

function asUnit(node: Node): CapabilityUnitNode {
  return node as CapabilityUnitNode;
}

/** Convenience factory mirroring the analysis / cluster overlay patterns. */
export function makeCapabilityUnitOverlay(
  graph: GraphLayer,
): CapabilityUnitOverlay {
  return new CapabilityUnitOverlayImpl(graph);
}
