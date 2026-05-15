/**
 * Closure-algorithm tests. Pins:
 *
 *   - Single seed + private helper → helper is OWNED by the seed.
 *   - Two seeds + shared helper → helper is USED by both, owned by neither.
 *   - Self-loops are skipped.
 *   - Cycles in the call graph are handled (visited-set BFS).
 *   - Edges to elements outside the input set are ignored.
 *   - Empty input returns no units.
 *   - Determinism: same input → same units in the same order.
 *   - unitId derived from entry + owned contentHashes (renaming helper
 *     with same hash keeps unitId stable).
 *   - Custom seedSelector overrides the default.
 *   - Multiple disconnected seeds each get their own unit.
 *   - Language uniformity: uniform-language closure records the lang;
 *     mixed-language closure leaves language undefined.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeCapabilityUnits } from "./closure.js";
import type { CallEdge, ElementForSeeding } from "./types-internal.js";

function elements(...specs: Array<Partial<ElementForSeeding> & { id: string }>): ElementForSeeding[] {
  return specs.map((s) => ({
    id: s.id,
    name: s.name ?? s.id,
    contentHash: s.contentHash ?? `ch_${s.id}`,
    ...s,
  }));
}

function edges(...pairs: ReadonlyArray<readonly [string, string]>): CallEdge[] {
  return pairs.map(([source, target]) => ({ source, target }));
}

test("computeCapabilityUnits — empty input returns no units", () => {
  const result = computeCapabilityUnits({ elements: [], callEdges: [] });
  assert.equal(result.units.length, 0);
  assert.equal(result.ownerByElement.size, 0);
});

test("computeCapabilityUnits — single seed + private helper: helper is owned", () => {
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "createUser", exported: true },
      { id: "validate" },
    ),
    callEdges: edges(["createUser", "validate"]),
  });
  assert.equal(result.units.length, 1);
  const unit = result.units[0];
  assert.equal(unit.entryElementId, "createUser");
  assert.deepEqual(unit.ownedElementIds, ["validate"]);
  assert.deepEqual(unit.usedElementIds, []);
  assert.equal(result.ownerByElement.get("validate"), unit.unitId);
});

test("computeCapabilityUnits — two seeds + shared helper: helper is used by both, owned by neither", () => {
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "createUser", exported: true },
      { id: "updateUser", exported: true },
      { id: "logActivity" },
    ),
    callEdges: edges(
      ["createUser", "logActivity"],
      ["updateUser", "logActivity"],
    ),
  });
  assert.equal(result.units.length, 2);
  for (const unit of result.units) {
    assert.deepEqual(unit.ownedElementIds, []);
    assert.deepEqual(unit.usedElementIds, ["logActivity"]);
  }
  // Shared helper has no single owner.
  assert.equal(result.ownerByElement.has("logActivity"), false);
});

test("computeCapabilityUnits — self-loops are skipped", () => {
  const result = computeCapabilityUnits({
    elements: elements({ id: "recursive", exported: true }),
    callEdges: edges(["recursive", "recursive"]),
  });
  assert.equal(result.units.length, 1);
  assert.deepEqual(result.units[0].ownedElementIds, []);
  assert.deepEqual(result.units[0].usedElementIds, []);
});

test("computeCapabilityUnits — cycles in private helpers are handled", () => {
  // entry → a, a → b, b → a (cycle in private helpers)
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "entry", exported: true },
      { id: "a" },
      { id: "b" },
    ),
    callEdges: edges(
      ["entry", "a"],
      ["a", "b"],
      ["b", "a"],
    ),
  });
  assert.equal(result.units.length, 1);
  const unit = result.units[0];
  // Both a and b are owned — only `entry` reaches them.
  assert.deepEqual(unit.ownedElementIds, ["a", "b"]);
});

test("computeCapabilityUnits — edges to elements outside the input set are ignored", () => {
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "entry", exported: true },
      { id: "known" },
    ),
    callEdges: edges(
      ["entry", "known"],
      ["entry", "UNKNOWN_TARGET"],
    ),
  });
  assert.equal(result.units.length, 1);
  assert.deepEqual(result.units[0].ownedElementIds, ["known"]);
});

test("computeCapabilityUnits — determinism: same input produces same output order", () => {
  const input = {
    elements: elements(
      { id: "alpha", exported: true },
      { id: "beta", exported: true },
      { id: "shared" },
    ),
    callEdges: edges(["alpha", "shared"], ["beta", "shared"]),
  };
  const a = computeCapabilityUnits(input);
  const b = computeCapabilityUnits(input);
  assert.deepEqual(
    a.units.map((u) => u.entryElementId),
    b.units.map((u) => u.entryElementId),
  );
  assert.deepEqual(
    a.units.map((u) => u.unitId),
    b.units.map((u) => u.unitId),
  );
});

test("computeCapabilityUnits — unitId derived from contentHashes, not element ids", () => {
  // Rename helper by changing its id but keeping contentHash.
  const a = computeCapabilityUnits({
    elements: elements(
      { id: "entry", contentHash: "entry-ch", exported: true },
      { id: "helperOld", contentHash: "helper-ch" },
    ),
    callEdges: edges(["entry", "helperOld"]),
  });
  const b = computeCapabilityUnits({
    elements: elements(
      { id: "entry", contentHash: "entry-ch", exported: true },
      { id: "helperRenamed", contentHash: "helper-ch" },
    ),
    callEdges: edges(["entry", "helperRenamed"]),
  });
  assert.equal(a.units[0].unitId, b.units[0].unitId);
});

test("computeCapabilityUnits — custom seedSelector overrides default", () => {
  // Default selector wouldn't pick `weird` (no exported, no stereotype).
  // Custom selector picks ids starting with `weird`.
  const result = computeCapabilityUnits({
    elements: elements({ id: "weird-entry" }, { id: "private-helper" }),
    callEdges: edges(["weird-entry", "private-helper"]),
    seedSelector: (e) => e.id.startsWith("weird"),
  });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].entryElementId, "weird-entry");
});

test("computeCapabilityUnits — multiple disconnected seeds each form a unit", () => {
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "createUser", exported: true },
      { id: "deleteUser", exported: true },
      { id: "createHelper" },
      { id: "deleteHelper" },
    ),
    callEdges: edges(
      ["createUser", "createHelper"],
      ["deleteUser", "deleteHelper"],
    ),
  });
  assert.equal(result.units.length, 2);
  // Each unit owns its own private helper.
  const byEntry = new Map(result.units.map((u) => [u.entryElementId, u]));
  assert.deepEqual(byEntry.get("createUser")?.ownedElementIds, ["createHelper"]);
  assert.deepEqual(byEntry.get("deleteUser")?.ownedElementIds, ["deleteHelper"]);
});

test("computeCapabilityUnits — language uniformity records the lang", () => {
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "createUser", exported: true, language: "typescript" },
      { id: "validate", language: "typescript" },
    ),
    callEdges: edges(["createUser", "validate"]),
  });
  assert.equal(result.units[0].language, "typescript");
});

test("computeCapabilityUnits — mixed-language closure leaves language undefined", () => {
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "createUser", exported: true, language: "typescript" },
      { id: "nativeHelper", language: "dotnet" },
    ),
    callEdges: edges(["createUser", "nativeHelper"]),
  });
  assert.equal(result.units[0].language, undefined);
});
