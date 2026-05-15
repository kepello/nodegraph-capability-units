/**
 * Entry-seed identification — the hybrid rule the L2 row specifies:
 * `exported === true` OR L1 method-stereotype ∈ `{controller, command}`.
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
 *   - `methodStereotype` ∈ `{controller, command}` (from
 *     `@kepello/nodegraph-analysis` L1 derivation set).
 *
 * Returns `false` for elements lacking both signals — the typical
 * private helper case.
 */
export function defaultSeedSelector(element: ElementForSeeding): boolean {
  if (element.exported === true) return true;
  const st = element.methodStereotype;
  return st === "controller" || st === "command";
}
