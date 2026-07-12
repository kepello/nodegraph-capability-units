/**
 * Seed-selector tests. Pins:
 *
 *   - `exported: true` qualifies as a seed.
 *   - `methodRole: "entry-command"` qualifies (Fathom row
 *     stereotype-vocabulary-drift, seeding-selector migration).
 *   - Other roles do not (e.g., `"accessor"`, `"other"`).
 *   - Element with neither signal does not qualify.
 *   - `exported: false` + non-entry role does not qualify.
 *   - `methodRole: "test-fixture"` is rejected, with or without `exported`.
 *   - Guard: the seeder must not regrow a raw-stereotype string list.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultSeedSelector } from "./seeding.js";
import type { ElementForSeeding } from "./types-internal.js";

function el(overrides: Partial<ElementForSeeding>): ElementForSeeding {
  return {
    id: "x",
    name: "x",
    contentHash: "h",
    ...overrides,
  };
}

test("defaultSeedSelector — exported: true qualifies", () => {
  assert.equal(defaultSeedSelector(el({ exported: true })), true);
});

test("defaultSeedSelector — methodRole 'entry-command' qualifies", () => {
  // Fathom row stereotype-vocabulary-drift: `entry-command` is the
  // `@kepello/nodegraph-analysis` role projection that collapses
  // `controller` / `command` / `composition-root` / `non-void-command` /
  // `collaborational-command` — the exact five raw stereotypes the seed
  // selector used to hand-list. One role read replaces all five.
  assert.equal(
    defaultSeedSelector(el({ methodRole: "entry-command" })),
    true,
  );
});

test("defaultSeedSelector — methodRole 'accessor' does not qualify", () => {
  assert.equal(
    defaultSeedSelector(el({ methodRole: "accessor" })),
    false,
  );
});

test("defaultSeedSelector — methodRole 'other' does not qualify", () => {
  assert.equal(
    defaultSeedSelector(el({ methodRole: "other" })),
    false,
  );
});

test("defaultSeedSelector — element with neither signal does not qualify", () => {
  assert.equal(defaultSeedSelector(el({})), false);
});

test("defaultSeedSelector — exported: false + non-entry role does not qualify", () => {
  assert.equal(
    defaultSeedSelector(el({ exported: false, methodRole: "mutator" })),
    false,
  );
});

test("defaultSeedSelector — methodRole 'test-fixture' is rejected even when exported (Fathom 5.0.23)", () => {
  // Round-5 F2 / round-6 follow-up: 939 of 939 L5 scenarios had zero
  // steps. Root cause was NOT the L5 algorithm — it walks cross-cluster
  // call edges correctly. Real cause: top-level functions in test files
  // (.test.ts, /tests/, /fixtures/, etc.) get `exported: true` by the
  // fathom-cli L2 element filter, so they become seeds AND produce L2
  // capability units. But L3 clustering EXCLUDES test-file paths (5.0.14
  // + 5.0.28c), so the seed's `clusterByElement` lookup returns
  // `undefined` for every walked edge → L5 skips every edge → empty
  // scenarios.
  //
  // Fix: defaultSeedSelector rejects `test-fixture` even when
  // `exported: true`. Matches the unified `test-fixture` L1 primitive
  // (5.0.34), now read via the `methodRole` projection.
  assert.equal(
    defaultSeedSelector(
      el({ exported: true, methodRole: "test-fixture" }),
    ),
    false,
  );
});

test("defaultSeedSelector — methodRole 'test-fixture' is rejected without exported (Fathom 5.0.23)", () => {
  assert.equal(
    defaultSeedSelector(el({ methodRole: "test-fixture" })),
    false,
  );
});

test("defaultSeedSelector — exported true overrides non-entry role", () => {
  // Mixed signals — exported wins even if role is non-entry.
  assert.equal(
    defaultSeedSelector(
      el({ exported: true, methodRole: "accessor" }),
    ),
    true,
  );
});

test("defaultSeedSelector — source does not hard-code a raw stereotype string list (guard)", () => {
  // Regression guard for the twice-patched drift class: `defaultSeedSelector`
  // was hand-patched once for `composition-root` (5.0.29) and once for
  // `non-void-command` / `collaborational-command` (r2 tail F6) because it
  // matched raw `methodStereotype` values by hand. The migration to
  // `methodRole` collapses all five into one stable read — this guard
  // fails loud if a future edit reintroduces a raw-stereotype string
  // comparison (or reads `methodStereotype` at all) in the seeder source.
  //
  // Scoped to quoted string literals (not bare prose words) so the
  // docblock can still narrate the migration history by name without
  // tripping the guard.
  const here = fileURLToPath(import.meta.url);
  const seedingSrc = readFileSync(
    new URL("./seeding.ts", `file://${here}`),
    "utf8",
  );
  const rawStereotypeLiteral =
    /["'](controller|command|composition-root|non-void-command|collaborational-command)["']/;
  assert.equal(
    rawStereotypeLiteral.test(seedingSrc),
    false,
    "seeding.ts must not compare against a raw stereotype string literal — read methodRole instead",
  );
  assert.equal(
    seedingSrc.includes(".methodStereotype"),
    false,
    "seeding.ts must not read the raw methodStereotype field — read methodRole instead",
  );
});
