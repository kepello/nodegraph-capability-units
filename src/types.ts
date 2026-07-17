/**
 * Capability-unit overlay public types. Each unit is an entry-rooted
 * closure of L0 element nodes — a public seed plus the strictly-owned
 * helpers it calls. Shared helpers (used by multiple seeds) surface via
 * the `uses` disposition kind rather than being absorbed into any
 * unit's body.
 *
 * Fathom row 3.1.8.4 wave 4 (BREAKING): membership is recorded as
 * `analysis-disposition` edges (kinds `entry` / `composes` / `uses`),
 * not the dedicated `entry` / `composes` / `uses` edge types this
 * package emitted through wave 3a — those edge-type constants are
 * retired; see `overlay.ts`'s class doc comment.
 */

import type { Edge, Node } from "@kepello/nodegraph-core";
import { CAPABILITY_UNIT_METADATA_KIND } from "./schema.js";

/**
 * Cluster node metadata. The substrate validates this against
 * `CAPABILITY_UNIT_METADATA_SCHEMA` at write time.
 */
export interface CapabilityUnitMetadata {
  kind: typeof CAPABILITY_UNIT_METADATA_KIND;
  /** Content-hash identity. Stable under member rename when contentHashes match. */
  unitId: string;
  /** The seed (entry method / handler / etc.) that roots this unit. */
  entryElementId: string;
  /** Local name of the entry element — used as the unit's auto-name. */
  entryName: string;
  /** Auto-generated unit name. v1: equals `entryName`. */
  name: string;
  /** Operator override; takes precedence over `name` in human-facing renders. */
  displayName?: string;
  /** Source language; absent for cross-language closures (not produced in v1). */
  language?: string;
  /** Count of strictly-owned members (excludes the entry itself). */
  ownedCount: number;
  /** Count of used (shared) members. */
  usedCount: number;
}

/**
 * Input to `insertUnit`. The natural key equals `unitId` so re-inserting
 * an identical unit is a no-op upsert at the substrate level.
 */
export interface CapabilityUnitInput {
  unitId: string;
  entryElementId: string;
  entryName: string;
  name: string;
  displayName?: string;
  language?: string;
  /** Stable content-hash this unit's identity was derived from. */
  contentHash: string;
  /** Members in the strict-ownership closure. Excludes the entry. */
  ownedElementIds: readonly string[];
  /** Elements the closure reaches but does not own. */
  usedElementIds: readonly string[];
}

/** Read projection. Same shape as a `Node` with typed metadata. */
export interface CapabilityUnitNode extends Omit<Node, "metadata"> {
  metadata: CapabilityUnitMetadata;
}

/**
 * Public capability-unit overlay. Returned by `makeCapabilityUnitOverlay(graph)`.
 * Registers the `"capability-unit"` domain + indexes against the graph layer
 * at construction time.
 */
export interface CapabilityUnitOverlay {
  // Write

  /**
   * Insert (or upsert) a capability-unit node + its `entry` /
   * `composes` / `uses` `analysis-disposition` edges. Returns the
   * persisted node. Idempotent on identical content-hash; supersedes on
   * content change.
   */
  insertUnit(input: CapabilityUnitInput): CapabilityUnitNode;

  /** Replace a unit's `displayName`. Identity is preserved. */
  renameUnit(unitId: string, displayName: string): CapabilityUnitNode;

  /** Tombstone (logically delete) a unit node. */
  tombstoneUnit(unitId: string): void;

  // Read

  /** All live unit nodes in this graph. */
  listUnits(): CapabilityUnitNode[];

  /** Lookup by content-hash identity. */
  getUnit(unitId: string): CapabilityUnitNode | undefined;

  /** Resolve the unit (if any) rooted at a given entry element id. */
  unitForEntry(entryElementId: string): CapabilityUnitNode | undefined;

  /**
   * `analysis-disposition` edges carrying kind `composes` for a unit —
   * the elements it strictly owns. Returns substrate edges; `targetId`
   * set for resolved members, `targetRef` for unresolved (dangling)
   * ones.
   */
  membersOf(unitId: string): Edge[];

  /** `analysis-disposition` edges carrying kind `uses` — shared elements the closure references. */
  usedBy(unitId: string): Edge[];

  /**
   * Resolve every unit whose closure uses the given element (incoming
   * `analysis-disposition` edges carrying kind `uses`). Useful for
   * "what units would break if I changed this shared helper?" queries.
   */
  unitsThatUse(elementId: string): CapabilityUnitNode[];
}
