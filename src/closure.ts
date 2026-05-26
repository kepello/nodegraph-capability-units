/**
 * Strict-ownership closure computation. Given a list of L0 elements,
 * directed call edges between them, and a seed selector, produces one
 * `ComputedUnit` per seed.
 *
 * Algorithm:
 *   1. Identify seeds via the selector.
 *   2. For each seed, BFS forward through `calls` / `callsMethod` edges
 *      to find R(seed) = transitive callees (the seed itself excluded).
 *   3. For each element E, collect `reachers(E)` = the set of seeds whose
 *      reachable set contains E.
 *   4. For seed S, owned(S) = `{E ∈ R(S) | reachers(E) = {S}}` — the
 *      strictly-owned subset.
 *   5. used(S) = `R(S) \ owned(S)` — shared helpers.
 *   6. unitId = `computeUnitId(entry.contentHash, [owned.contentHashes])`.
 *
 * Self-loops are skipped. Cycles in the call graph are handled naturally
 * by BFS visited-set tracking. Edges to elements outside the input set
 * are silently skipped.
 */

import { computeUnitId } from "./identity.js";
import { defaultSeedSelector, type SeedSelector } from "./seeding.js";
import type { CallEdge, ElementForSeeding } from "./types-internal.js";

export interface ComputeCapabilityUnitsInput {
  elements: readonly ElementForSeeding[];
  callEdges: readonly CallEdge[];
  /**
   * Predicate identifying which elements are entry seeds. Default:
   * `defaultSeedSelector` — `exported: true` OR L1 method-stereotype
   * `controller` / `command`.
   */
  seedSelector?: SeedSelector;
  /**
   * Inverse-indexed `overrides` edges: interface/abstract method
   * element id → list of impl method element ids that override it.
   * Threaded by callers from substrate `overrides` edges via a
   * `groupBy(targetId)` pass over `queryEdges({ type: "overrides" })`.
   *
   * Fathom row `l2-overrides-edge-first-class` (3.1.2.1 P3): during
   * BFS, when visiting an element E, the walker enqueues both:
   *   1. Forward `calls` targets (existing behavior)
   *   2. Any element ids in `overridesByTarget.get(E)` (new)
   *
   * When E is an interface method, this expands the closure to include
   * all concrete impls — closing the visibility gap that motivated the
   * row. When E is not an interface method (no entry in the map), the
   * walker is unchanged.
   */
  overridesByTarget?: ReadonlyMap<string, readonly string[]>;
}

export interface ComputedUnit {
  unitId: string;
  entryElementId: string;
  entryName: string;
  language?: string;
  /** Sorted owned element ids (ascending). Excludes the entry. */
  ownedElementIds: readonly string[];
  /** Sorted used element ids (ascending). */
  usedElementIds: readonly string[];
  /** Content hash that fed `unitId`. */
  contentHash: string;
}

export interface ComputeCapabilityUnitsResult {
  units: readonly ComputedUnit[];
  /**
   * Map from element id → the unit that strictly owns it (when the
   * element is owned). Shared elements + entries are absent from this
   * map — entries appear in their unit's `entryElementId` field;
   * shared elements appear in the `usedElementIds` of each unit that
   * reaches them.
   */
  ownerByElement: ReadonlyMap<string, string>;
}

/**
 * Run the closure-recovery pipeline over a synthetic L0 element graph.
 * Pure function — no substrate IO.
 */
export function computeCapabilityUnits(
  input: ComputeCapabilityUnitsInput,
): ComputeCapabilityUnitsResult {
  const seedSelector = input.seedSelector ?? defaultSeedSelector;
  const elementsById = new Map<string, ElementForSeeding>();
  for (const e of input.elements) elementsById.set(e.id, e);

  // Build forward adjacency (source → set of targets). Combines two
  // sources:
  //   1. `callEdges` — the input call graph (calls + callsMethod from
  //      the substrate, threaded by the caller).
  //   2. `overridesByTarget` — when visiting an interface method, also
  //      visit all impl methods that override it. Conceptually a virtual
  //      "calls" edge from the interface method to each impl, expanding
  //      the closure to include polymorphic dispatch targets. Fathom
  //      row `l2-overrides-edge-first-class` (3.1.2.1 P3).
  const adj = new Map<string, Set<string>>();
  const addAdjacency = (source: string, target: string) => {
    if (source === target) return;
    if (!elementsById.has(source) || !elementsById.has(target)) return;
    let targets = adj.get(source);
    if (targets === undefined) {
      targets = new Set();
      adj.set(source, targets);
    }
    targets.add(target);
  };
  for (const edge of input.callEdges) {
    addAdjacency(edge.source, edge.target);
  }
  if (input.overridesByTarget !== undefined) {
    for (const [interfaceMethodId, implMethodIds] of input.overridesByTarget) {
      for (const implMethodId of implMethodIds) {
        addAdjacency(interfaceMethodId, implMethodId);
      }
    }
  }

  // Identify seeds.
  const seeds: ElementForSeeding[] = [];
  for (const e of input.elements) {
    if (seedSelector(e)) seeds.push(e);
  }

  // For each seed, BFS forward to find R(seed) — transitive callees,
  // excluding the seed itself.
  const reachableBySeed = new Map<string, Set<string>>();
  for (const seed of seeds) {
    const reached = new Set<string>();
    const queue: string[] = [];
    const visited = new Set<string>([seed.id]);
    for (const t of adj.get(seed.id) ?? []) {
      if (!visited.has(t)) {
        visited.add(t);
        queue.push(t);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      reached.add(cur);
      for (const t of adj.get(cur) ?? []) {
        if (!visited.has(t)) {
          visited.add(t);
          queue.push(t);
        }
      }
    }
    reachableBySeed.set(seed.id, reached);
  }

  // Invert: for each element, which seeds reach it.
  const reachersByElement = new Map<string, Set<string>>();
  for (const [seedId, reachedSet] of reachableBySeed) {
    for (const elementId of reachedSet) {
      let reachers = reachersByElement.get(elementId);
      if (reachers === undefined) {
        reachers = new Set();
        reachersByElement.set(elementId, reachers);
      }
      reachers.add(seedId);
    }
  }

  // For each seed, partition R(seed) into owned vs used.
  const units: ComputedUnit[] = [];
  const ownerByElement = new Map<string, string>();
  for (const seed of seeds) {
    const reached = reachableBySeed.get(seed.id) ?? new Set<string>();
    const owned: string[] = [];
    const used: string[] = [];
    for (const elementId of reached) {
      const reachers = reachersByElement.get(elementId);
      if (reachers !== undefined && reachers.size === 1) {
        // Single reacher = this seed = owned.
        owned.push(elementId);
      } else {
        used.push(elementId);
      }
    }
    owned.sort();
    used.sort();

    // Resolve content hashes.
    const ownedHashes: string[] = [];
    for (const id of owned) {
      const el = elementsById.get(id);
      if (el !== undefined) ownedHashes.push(el.contentHash);
    }
    const unitId = computeUnitId(seed.contentHash, ownedHashes);
    const contentHash = [seed.contentHash, ...[...ownedHashes].sort()].join("\n");

    // Language: only set when entry + all owned share the same value.
    const languages = new Set<string>();
    if (seed.language !== undefined) languages.add(seed.language);
    for (const id of owned) {
      const lang = elementsById.get(id)?.language;
      if (lang !== undefined) languages.add(lang);
    }
    const language = languages.size === 1 ? [...languages][0] : undefined;

    units.push({
      unitId,
      entryElementId: seed.id,
      entryName: seed.name,
      language,
      ownedElementIds: owned,
      usedElementIds: used,
      contentHash,
    });

    for (const id of owned) ownerByElement.set(id, unitId);
  }

  // Sort units by entry element id for deterministic output ordering.
  units.sort((a, b) => a.entryElementId.localeCompare(b.entryElementId));

  return { units, ownerByElement };
}
