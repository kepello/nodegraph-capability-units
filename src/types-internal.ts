/**
 * Internal data shapes for the closure algorithm. Kept separate from
 * the public overlay types so the algorithm has no peer-dep on the
 * substrate (`@kepello/nodegraph-core`) — it operates on plain objects
 * the overlay layer marshals to/from.
 */

/**
 * One L0 element participating in capability-unit recovery. `id` is the
 * substrate node id (UUID or natural key — caller's choice; must be
 * unique within the input set). `contentHash` feeds unit-identity
 * computation; matched against the analyzer's per-element contentHash.
 */
export interface ElementForSeeding {
  id: string;
  /** Local name; used to derive the unit's display name. */
  name: string;
  contentHash: string;
  /** Optional language tag. Single-language closures record it; mixed leave unset. */
  language?: string;
  /**
   * Optional facet from `@kepello/nodegraph-analysis` engine.
   * Default seed selector treats `true` as a seed candidate.
   */
  exported?: boolean;
  /**
   * Optional L1 method stereotype from `@kepello/nodegraph-analysis`.
   * Default seed selector treats `controller` / `command` as seed candidates.
   * Other values (`accessor-shaped`, `command`, etc.) are accepted as
   * opaque strings — the package doesn't enforce the L1 enum.
   */
  methodStereotype?: string;
}

/**
 * One directed call edge between two L0 elements. Edge types in the
 * wire protocol that should be passed here: `calls` (cross-class) and
 * `callsMethod` (intra-class). The algorithm treats both uniformly —
 * both express "this element invokes that element."
 */
export interface CallEdge {
  source: string;
  target: string;
}
