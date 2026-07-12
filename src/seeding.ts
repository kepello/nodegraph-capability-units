/**
 * Entry-seed identification — the hybrid rule the L2 row specifies:
 * `exported === true` OR L1 method-role === `entry-command`.
 *
 * Consumers wanting framework-aware seeds (HTTP route handlers,
 * decorator-marked commands, scheduled jobs, message subscribers)
 * pass a custom `SeedSelector` to `computeCapabilityUnits`. The
 * operator-config-driven path is tracked as Fathom
 * `l2-operator-configured-seeds` (3.1.2.2, Parked) — when that ships,
 * this module exposes a selector that reads
 * `.fathom/fathom.config.json` `capabilityUnits.seeds`.
 */

import type { ElementForSeeding } from "./types-internal.js";

export type SeedSelector = (element: ElementForSeeding) => boolean;

/**
 * Default hybrid seed selector. An element is a seed iff:
 *   - `exported === true` (boundary-visible from outside the
 *     containing artifact), OR
 *   - `methodRole === "entry-command"` (the `@kepello/nodegraph-analysis`
 *     L1 semantic-role projection of `methodStereotype` — see below).
 *
 * Returns `false` for elements lacking both signals — the typical
 * private helper case.
 *
 * Migrated off a raw `methodStereotype` admit-list onto the `methodRole`
 * contract (Fathom row stereotype-vocabulary-drift class root fix). The
 * admit-list this replaced was hand-patched TWICE as the analyzer's
 * stereotype vocabulary grew — once to add a composition-root stereotype,
 * once to add two finer-grained command variants from a later side-effect
 * derivation split — and nothing failed loud on either occasion; the
 * fix just silently under-seeded until someone noticed a missing capability
 * unit. `methodRole` moves the mapping OWNER-side (into the analysis
 * engine's exhaustive, compile-checked table): this selector reads ONE
 * stable value and absorbs future stereotype additions for free, with
 * no consumer-side list to hand-sync ever again. Behavior-identical on
 * the day of migration — `entry-command` is defined to cover exactly the
 * stereotype family this admit-list used to enumerate by hand.
 */
export function defaultSeedSelector(element: ElementForSeeding): boolean {
  // Fathom row 5.0.23: test-fixture functions are not capability-unit
  // seeds. Top-level functions in test files (.test.ts, /tests/, etc.)
  // get `exported: true` from the analyzer's normal exported-symbol
  // detection — but the L3 clusterer excludes their paths (5.0.14 /
  // 5.0.28 c), so they have no `clusterByElement` mapping at L5. Walking
  // their closures produces empty scenarios (every edge skipped — source
  // cluster undefined). Cleanest fix: reject at the seed boundary using
  // the unified `test-fixture` role (5.0.34; carried through the
  // `methodRole` projection unchanged — it maps to itself).
  if (element.methodRole === "test-fixture") return false;
  if (element.exported === true) return true;
  return element.methodRole === "entry-command";
}
