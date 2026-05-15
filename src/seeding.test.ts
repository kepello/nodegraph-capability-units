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

test("defaultSeedSelector — exported true overrides non-seed stereotype", () => {
  // Mixed signals — exported wins even if stereotype is non-seed.
  assert.equal(
    defaultSeedSelector(
      el({ exported: true, methodStereotype: "accessor-shaped" }),
    ),
    true,
  );
});
