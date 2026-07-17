/**
 * Capability-unit overlay implementation over a `GraphLayer`. Registers
 * the `"capability-unit"` domain idempotently at construction time and
 * provides the write + read API surfaced by `CapabilityUnitOverlay`.
 *
 * Fathom row 3.1.8.4 wave 4 (disposition-layer, BREAKING): the legacy
 * `entry` / `composes` / `uses` membership edges are RETIRED.
 * `analysis-disposition` edges (via `@kepello/nodegraph-dispositions`'s
 * `recordDispositions`, authored by THIS overlay's own
 * `capability-unit`-domain mutator — the caller-mutator ruling, wave 1's
 * `overlay.ts` doc comment) are now THE membership record:
 *   - kind `entry`    → the unit's seed element (subtype `"entry"` when
 *     it's the only kind on that (unit, target) pair)
 *   - kind `composes` → a strictly-owned member
 *   - kind `uses`     → a shared element the closure references
 * A target carrying more than one kind (e.g. the pathological
 * entry-∈-owned-set overlap) collapses to ONE edge whose
 * `metadata.kinds` holds all applicable kinds and whose `subtype` is
 * the PRIMARY kind per `PRIMARY_KIND_PRECEDENCE` (entry beats composes
 * beats uses). Readers MUST filter by kinds-CONTAINS, never subtype
 * equality — see `membersOf` / `usedBy` / `unitForEntry` /
 * `unitsThatUse` below.
 *
 * Drift parity: `recordDispositions`'s per-pair kind merge is
 * deliberately ADDITIVE (correct within one call) — it never removes a
 * kind or evicts a pair that fell out of the desired set. Every write
 * path that changes a unit's membership (`insertUnit`, `renameUnit`)
 * therefore reconciles through `reconcileDispositions` below, which
 * tombstones any live disposition edge whose target/kind-set no longer
 * matches the desired state before re-recording — mirroring
 * `nodegraph-domain-model`'s `reconcileDispositions` /
 * `nodegraph-clusters`'s `reconcileDispositionEdges` idiom.
 */

import type { Edge, GraphLayer, GraphMutator, Node } from "@kepello/nodegraph-core";
import {
  ANALYSIS_DISPOSITION_EDGE_TYPE,
  makeDispositionOverlay,
  type DispositionCandidate,
  type DispositionOverlay,
  type PositiveKind,
} from "@kepello/nodegraph-dispositions";
import {
  CAPABILITY_UNIT_DOMAIN,
  CAPABILITY_UNIT_INDEXES,
  CAPABILITY_UNIT_METADATA_KIND,
  CAPABILITY_UNIT_METADATA_SCHEMA,
  CAPABILITY_UNIT_SCHEMA_VERSION,
} from "./schema.js";
import type {
  CapabilityUnitInput,
  CapabilityUnitMetadata,
  CapabilityUnitNode,
  CapabilityUnitOverlay,
} from "./types.js";

export class CapabilityUnitOverlayImpl implements CapabilityUnitOverlay {
  private readonly mutator: GraphMutator<typeof CAPABILITY_UNIT_DOMAIN>;
  private readonly dispositions: DispositionOverlay;

  constructor(private readonly graph: GraphLayer) {
    // Per Fathom row 5.0.42: registerOverlay returns the domain-scoped
    // mutator; this overlay holds it for all substrate writes.
    this.mutator = this.graph.registerOverlay({
      domain: CAPABILITY_UNIT_DOMAIN,
      schemaVersion: CAPABILITY_UNIT_SCHEMA_VERSION,
      metadataSchema: CAPABILITY_UNIT_METADATA_SCHEMA,
      indexes: CAPABILITY_UNIT_INDEXES,
    });
    // This overlay's own disposition-overlay handle. Registers the
    // shared `disposition` domain idempotently (5.0.42) — writes
    // through it are used only for `recordDispositions`'s internal
    // reason/ledger-node bookkeeping, never for the edges this overlay
    // authors itself (see class doc comment).
    this.dispositions = makeDispositionOverlay(this.graph);
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

    // Wave 4 (3.1.8.4, BREAKING): `analysis-disposition` edges ARE the
    // membership record. Build the desired (target → kind set) map —
    // entry, owned (composes), used (uses) — and reconcile the unit's
    // outgoing disposition edges to match it exactly. A target present
    // in more than one input (the pathological entry-∈-owned-set
    // overlap) collapses onto one edge carrying both kinds; this map
    // handles that for free (same target key, kinds unioned into one
    // Set) — `ownedElementIds` structurally excludes the entry in
    // practice (see `closure.ts`'s BFS), but `insertUnit`'s type
    // contract doesn't itself enforce the exclusion, so this is pinned
    // defensively (`overlay-dispositions.test.ts`).
    const wanted = new Map<string, Set<PositiveKind>>();
    const want = (target: string, kind: PositiveKind): void => {
      let kinds = wanted.get(target);
      if (kinds === undefined) {
        kinds = new Set();
        wanted.set(target, kinds);
      }
      kinds.add(kind);
    };
    want(input.entryElementId, "entry");
    for (const id of input.ownedElementIds) want(id, "composes");
    for (const id of input.usedElementIds) want(id, "uses");
    this.reconcileDispositions(node.id, wanted);

    return asUnit(node);
  }

  /**
   * Bring `unitNodeId`'s outgoing `analysis-disposition` edges to
   * exactly `wanted` (target → kind set). Mirrors
   * `nodegraph-domain-model`'s `reconcileDispositions`: a target whose
   * kind set is unchanged is left alone (skipped from the re-record
   * batch, so re-analyzing unchanged input doesn't churn edge ids); a
   * target that's gone (departed member / stale entry) or whose kind
   * set changed is tombstoned outright — `recordDispositions`'s
   * per-pair kind merge is deliberately ADDITIVE, so re-sending a
   * shrunken kind set would never shed the stale kind without this
   * explicit tombstone-first step.
   */
  private reconcileDispositions(
    unitNodeId: string,
    wanted: ReadonlyMap<string, ReadonlySet<PositiveKind>>,
  ): void {
    const existing = this.graph.edgesFrom(unitNodeId, {
      type: ANALYSIS_DISPOSITION_EDGE_TYPE,
      includeDangling: true,
    });
    const satisfied = new Set<string>();
    for (const e of existing) {
      const key = e.targetId ?? e.targetRef;
      if (key === null) continue;
      const wantedKinds = wanted.get(key);
      if (wantedKinds !== undefined && kindSetEquals(edgeKinds(e), wantedKinds)) {
        satisfied.add(key);
        continue;
      }
      this.mutator.tombstoneEdge(e.id);
    }
    const batch: DispositionCandidate[] = [];
    for (const [target, kinds] of wanted) {
      if (satisfied.has(target)) continue;
      const shape = targetShape(this.graph, target);
      for (const kind of kinds) {
        batch.push({ sourceId: unitNodeId, kind, ...shape });
      }
    }
    if (batch.length > 0) {
      this.dispositions.recordDispositions(this.mutator, batch);
    }
  }

  /**
   * Capture a node's live outgoing disposition edges as a (target →
   * kind set) map — used by `renameUnit` to preserve membership across
   * a metadata-only `supersedeNode` call (5.0.39 idiom: raw
   * `supersedeNode` cascades the prior tip's outgoing edges to
   * tombstoned, so the caller must capture BEFORE superseding and
   * re-reconcile onto the new tip's id AFTER).
   */
  private captureDispositionWanted(nodeId: string): Map<string, Set<PositiveKind>> {
    const wanted = new Map<string, Set<PositiveKind>>();
    for (const e of this.graph.edgesFrom(nodeId, {
      type: ANALYSIS_DISPOSITION_EDGE_TYPE,
      includeDangling: true,
    })) {
      const key = e.targetId ?? e.targetRef;
      if (key === null) continue;
      wanted.set(key, new Set(edgeKinds(e)));
    }
    return wanted;
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
        // Capture the prior tip's disposition-edge membership BEFORE
        // superseding (see `captureDispositionWanted` doc comment) —
        // `supersedeNode` cascades the prior tip's outgoing edges to
        // tombstoned, so a rename that skipped this step would silently
        // orphan the unit's entry/composes/uses membership.
        const wanted = this.captureDispositionWanted(existing.id);
        const next: CapabilityUnitMetadata = { ...prior, displayName };
        const node = this.mutator.supersedeNode(existing.id, {
          contentHash: existing.contentHash,
          metadata: next as unknown,
        });
        this.reconcileDispositions(node.id, wanted);
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
    // Walk incoming `analysis-disposition` edges carrying kind `entry`
    // — resolved (targetId) and dangling (targetRef) in one call, since
    // `entryElementId` may name either form. Wave 4 (3.1.8.4): kinds-
    // CONTAINS filter, never subtype equality — a target can carry
    // `entry` as a non-primary kind (see class doc comment).
    const edges = this.graph
      .edgesTo(entryElementId, { type: ANALYSIS_DISPOSITION_EDGE_TYPE, includeDangling: true })
      .filter((e) => edgeKinds(e).includes("entry"));
    if (edges.length === 0) return undefined;
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
    // Wave 4 (3.1.8.4): kinds-CONTAINS "composes", never subtype
    // equality — see class doc comment.
    return this.graph
      .edgesFrom(unit.id, { type: ANALYSIS_DISPOSITION_EDGE_TYPE, includeDangling: true })
      .filter((e) => edgeKinds(e).includes("composes"));
  }

  usedBy(unitId: string): Edge[] {
    const unit = this.graph.getLiveNodeByNaturalKey(
      CAPABILITY_UNIT_DOMAIN,
      unitId,
    );
    if (unit === undefined) return [];
    // Wave 4 (3.1.8.4): kinds-CONTAINS "uses", never subtype equality —
    // see class doc comment.
    return this.graph
      .edgesFrom(unit.id, { type: ANALYSIS_DISPOSITION_EDGE_TYPE, includeDangling: true })
      .filter((e) => edgeKinds(e).includes("uses"));
  }

  unitsThatUse(elementId: string): CapabilityUnitNode[] {
    // Incoming `analysis-disposition` edges carrying kind `uses`,
    // resolved + dangling in one call. Per Fathom row
    // `perf-getbyid-consumer-migrations` (5.0.1.2.3.1): collect all
    // candidate source-ids first, batch-hydrate once via
    // `getNodesByIds`, then filter.
    const edges = this.graph
      .edgesTo(elementId, { type: ANALYSIS_DISPOSITION_EDGE_TYPE, includeDangling: true })
      .filter((e) => edgeKinds(e).includes("uses"));
    const candidateIds = Array.from(new Set(edges.map((e) => e.sourceId)));
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

/**
 * Resolve a disposition candidate's target: `targetId` when `id` names a
 * live node, `targetRef` (natural-key form) otherwise — used by
 * `reconcileDispositions` to build each candidate's target shape.
 */
function targetShape(
  graph: GraphLayer,
  id: string,
): { targetId: string } | { targetRef: string } {
  return graph.getNodeById(id) !== undefined ? { targetId: id } : { targetRef: id };
}

/** Kinds carried on an `analysis-disposition` edge (`metadata.kinds`). */
function edgeKinds(edge: Edge): PositiveKind[] {
  const metadata = edge.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return [];
  }
  const kinds = (metadata as { kinds?: unknown }).kinds;
  return Array.isArray(kinds) ? (kinds as PositiveKind[]) : [];
}

function kindSetEquals(
  kinds: readonly PositiveKind[],
  wanted: ReadonlySet<PositiveKind>,
): boolean {
  if (kinds.length !== wanted.size) return false;
  for (const k of kinds) {
    if (!wanted.has(k)) return false;
  }
  return true;
}

/** Convenience factory mirroring the analysis / cluster overlay patterns. */
export function makeCapabilityUnitOverlay(
  graph: GraphLayer,
): CapabilityUnitOverlay {
  return new CapabilityUnitOverlayImpl(graph);
}
