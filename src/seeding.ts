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
 *   - `methodStereotype` ∈ `{controller, command, composition-root,
 *     non-void-command, collaborational-command}`
 *     (from `@kepello/nodegraph-analysis` L1 derivation set).
 *
 * Returns `false` for elements lacking both signals — the typical
 * private helper case.
 *
 * Fathom row 5.0.29: `composition-root` added 2026-05-18. Round-5
 * pilot F15 surfaced `composeFathomMcp` — explicitly marked as a
 * composition-root stereotype by 5.0.15 and a `library-export` —
 * returning null from `code.capability_unit_for(...)` because the
 * seed predicate didn't recognize the stereotype. Composition roots
 * ARE externally-callable seeds by definition; missing them leaves
 * the L2 surface visibly incomplete on the workspace's actual entry
 * points.
 *
 * Fathom row 3.1.1.1.9.3.r2 tail F6: `non-void-command` and
 * `collaborational-command` added 2026-07-03. The r2 side-effect
 * derivation split plain `command` into these finer-grained variants —
 * both are command-family entry points by construction, same as
 * `command`.
 */
export function defaultSeedSelector(element: ElementForSeeding): boolean {
  // Fathom row 5.0.23: test-fixture functions are not capability-unit
  // seeds. Top-level functions in test files (.test.ts, /tests/, etc.)
  // get `exported: true` from the analyzer's normal exported-symbol
  // detection — but the L3 clusterer excludes their paths (5.0.14 /
  // 5.0.28 c), so they have no `clusterByElement` mapping at L5. Walking
  // their closures produces empty scenarios (every edge skipped — source
  // cluster undefined). Cleanest fix: reject at the seed boundary using
  // the unified `test-fixture` L1 stereotype primitive (5.0.34).
  if (element.methodStereotype === "test-fixture") return false;
  if (element.exported === true) return true;
  const st = element.methodStereotype;
  return (
    st === "controller"
    || st === "command"
    || st === "composition-root"
    || st === "non-void-command"
    || st === "collaborational-command"
  );
}
