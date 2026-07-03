/**
 * Seed-selector tests. Pins:
 *
 *   - `exported: true` qualifies as a seed.
 *   - `methodStereotype: "controller"` qualifies.
 *   - `methodStereotype: "command"` qualifies.
 *   - Other stereotypes do not (e.g., `"accessor-shaped"`).
 *   - Element with neither signal does not qualify.
 *   - `exported: false` + non-seed stereotype does not qualify.
 *   - Custom selector overrides the default.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
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

test("defaultSeedSelector — methodStereotype 'controller' qualifies", () => {
  assert.equal(
    defaultSeedSelector(el({ methodStereotype: "controller" })),
    true,
  );
});

test("defaultSeedSelector — methodStereotype 'command' qualifies", () => {
  assert.equal(
    defaultSeedSelector(el({ methodStereotype: "command" })),
    true,
  );
});

test("defaultSeedSelector — methodStereotype 'composition-root' qualifies (Fathom 5.0.29)", () => {
  // Round-5 F15: composeFathomMcp is composition-root and library-export
  // but L2 missed it as a seed. Fix: composition-root is now an
  // externally-callable seed alongside controller/command.
  assert.equal(
    defaultSeedSelector(el({ methodStereotype: "composition-root" })),
    true,
  );
});

test("defaultSeedSelector — methodStereotype 'non-void-command' qualifies (Fathom r2 tail F6)", () => {
  // `@kepello/nodegraph-analysis`'s r2 side-effect derivation split
  // `command` into finer-grained variants — `non-void-command` (a
  // side-effecting method that also returns a value) is a command-family
  // entry point by construction, same as plain `command`.
  assert.equal(
    defaultSeedSelector(el({ methodStereotype: "non-void-command" })),
    true,
  );
});

test("defaultSeedSelector — methodStereotype 'collaborational-command' qualifies (Fathom r2 tail F6)", () => {
  // Same rationale as `non-void-command` — `collaborational-command`
  // (a side effect reached only via descent through a collaborator) is
  // still a command-family entry point.
  assert.equal(
    defaultSeedSelector(el({ methodStereotype: "collaborational-command" })),
    true,
  );
});

test("defaultSeedSelector — non-seed stereotype does not qualify", () => {
  assert.equal(
    defaultSeedSelector(el({ methodStereotype: "accessor-shaped" })),
    false,
  );
});

test("defaultSeedSelector — element with neither signal does not qualify", () => {
  assert.equal(defaultSeedSelector(el({})), false);
});

test("defaultSeedSelector — exported: false + non-seed stereotype does not qualify", () => {
  assert.equal(
    defaultSeedSelector(el({ exported: false, methodStereotype: "incidental" })),
    false,
  );
});

test("defaultSeedSelector — methodStereotype 'test-fixture' is rejected even when exported (Fathom 5.0.23)", () => {
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
  // Fix: defaultSeedSelector rejects `test-fixture` stereotype even
  // when `exported: true`. Matches the unified `test-fixture` L1
  // primitive shipped in 5.0.34 (single signal carries fixture-ness
  // across rating / detection / now L2 seeding).
  assert.equal(
    defaultSeedSelector(
      el({ exported: true, methodStereotype: "test-fixture" }),
    ),
    false,
  );
});

test("defaultSeedSelector — methodStereotype 'test-fixture' is rejected without exported (Fathom 5.0.23)", () => {
  assert.equal(
    defaultSeedSelector(el({ methodStereotype: "test-fixture" })),
    false,
  );
});

test("defaultSeedSelector — exported true overrides non-seed stereotype", () => {
  // Mixed signals — exported wins even if stereotype is non-seed.
  assert.equal(
    defaultSeedSelector(
      el({ exported: true, methodStereotype: "accessor-shaped" }),
    ),
    true,
  );
});
