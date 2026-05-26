/**
 * P3 of Fathom row `l2-overrides-edge-first-class` (3.1.2.1) — L2
 * closure walker reads `overridesByTarget` to descend from interface
 * methods to their impl methods during BFS.
 *
 * `overridesByTarget` is a precomputed inverse-index map: target
 * element id (interface method) → list of source element ids (impl
 * methods). Built by callers from substrate `overrides` edges via a
 * `groupBy(targetId)` pass. The walker queries it during BFS the same
 * way it queries the forward call adjacency.
 *
 * Direction reminder: substrate stores `overrides: C.M → I.M` (child →
 * parent). The walker needs the INVERSE for BFS (visiting I.M expands
 * to impls). The caller threads the inverse map; the walker stays
 * pure-functional over its inputs.
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

test("overridesByTarget: visiting interface method expands to impl methods (Fathom 3.1.2.1 P3)", () => {
  // Seed `caller` calls interface method `IFoo.bar`; substrate has
  // overrides edge from `FooImpl.bar` → `IFoo.bar`. The walker should
  // include FooImpl.bar in the closure when visiting IFoo.bar.
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "caller", exported: true },
      { id: "IFoo.bar" }, // body-less interface method (not a seed)
      { id: "FooImpl.bar" }, // impl method (not a seed by name)
    ),
    callEdges: edges(["caller", "IFoo.bar"]),
    overridesByTarget: new Map<string, readonly string[]>([
      ["IFoo.bar", ["FooImpl.bar"]],
    ]),
  });
  assert.equal(result.units.length, 1);
  const unit = result.units[0]!;
  assert.equal(unit.entryElementId, "caller");
  // FooImpl.bar SHOULD be in the closure (owned OR used).
  const inClosure = unit.ownedElementIds.includes("FooImpl.bar") || unit.usedElementIds.includes("FooImpl.bar");
  assert.ok(
    inClosure,
    `expected FooImpl.bar in closure; owned=${unit.ownedElementIds.join(",")} used=${unit.usedElementIds.join(",")}`,
  );
});

test("overridesByTarget: multi-impl expansion (Fathom 3.1.2.1 P3)", () => {
  // IFoo.bar has two impls; caller reaching IFoo.bar should reach both.
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "caller", exported: true },
      { id: "IFoo.bar" },
      { id: "FooImplA.bar" },
      { id: "FooImplB.bar" },
    ),
    callEdges: edges(["caller", "IFoo.bar"]),
    overridesByTarget: new Map<string, readonly string[]>([
      ["IFoo.bar", ["FooImplA.bar", "FooImplB.bar"]],
    ]),
  });
  const unit = result.units[0]!;
  const all = [...unit.ownedElementIds, ...unit.usedElementIds];
  assert.ok(all.includes("FooImplA.bar"), `expected FooImplA.bar in closure; got ${all.join(", ")}`);
  assert.ok(all.includes("FooImplB.bar"), `expected FooImplB.bar in closure; got ${all.join(", ")}`);
});

test("overridesByTarget: impl method's own callees are also reached transitively (Fathom 3.1.2.1 P3)", () => {
  // Once we descend to FooImpl.bar, its body's calls (e.g., to a
  // private helper) should also be in the closure. BFS continues.
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "caller", exported: true },
      { id: "IFoo.bar" },
      { id: "FooImpl.bar" },
      { id: "helper" },
    ),
    callEdges: edges(
      ["caller", "IFoo.bar"],
      ["FooImpl.bar", "helper"],
    ),
    overridesByTarget: new Map<string, readonly string[]>([
      ["IFoo.bar", ["FooImpl.bar"]],
    ]),
  });
  const unit = result.units[0]!;
  const all = [...unit.ownedElementIds, ...unit.usedElementIds];
  assert.ok(all.includes("helper"), `transitive: expected helper in closure; got ${all.join(", ")}`);
});

test("overridesByTarget: no overrides map → walker unchanged (Fathom 3.1.2.1 P3)", () => {
  // Backward compatibility — when no overridesByTarget is passed, the
  // walker behaves as before (just call edges).
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "caller", exported: true },
      { id: "helper" },
    ),
    callEdges: edges(["caller", "helper"]),
    // No overridesByTarget supplied.
  });
  const unit = result.units[0]!;
  assert.ok(unit.ownedElementIds.includes("helper"));
});

test("overridesByTarget: empty map → walker behaves as if no overrides (Fathom 3.1.2.1 P3)", () => {
  // Empty map is equivalent to no map.
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "caller", exported: true },
      { id: "IFoo.bar" },
      { id: "FooImpl.bar" }, // not reached because the map is empty
    ),
    callEdges: edges(["caller", "IFoo.bar"]),
    overridesByTarget: new Map<string, readonly string[]>(),
  });
  const unit = result.units[0]!;
  const all = [...unit.ownedElementIds, ...unit.usedElementIds];
  assert.ok(!all.includes("FooImpl.bar"), `empty map: impl should NOT be reached; got ${all.join(", ")}`);
});

test("overridesByTarget: impl reached by multiple seeds is `used`, not `owned` (Fathom 3.1.2.1 P3)", () => {
  // Strict-ownership semantics: an impl method reached by two different
  // seeds is shared → `used`, not `owned`. The override expansion uses
  // the same reachers-by-element logic as call edges.
  const result = computeCapabilityUnits({
    elements: elements(
      { id: "seedA", exported: true },
      { id: "seedB", exported: true },
      { id: "IFoo.bar" },
      { id: "FooImpl.bar" },
    ),
    callEdges: edges(
      ["seedA", "IFoo.bar"],
      ["seedB", "IFoo.bar"],
    ),
    overridesByTarget: new Map<string, readonly string[]>([
      ["IFoo.bar", ["FooImpl.bar"]],
    ]),
  });
  // Both seeds reach FooImpl.bar via the interface; neither owns it.
  const seedAUnit = result.units.find((u) => u.entryElementId === "seedA")!;
  const seedBUnit = result.units.find((u) => u.entryElementId === "seedB")!;
  assert.ok(seedAUnit.usedElementIds.includes("FooImpl.bar"));
  assert.ok(seedBUnit.usedElementIds.includes("FooImpl.bar"));
  assert.equal(seedAUnit.ownedElementIds.includes("FooImpl.bar"), false);
  assert.equal(seedBUnit.ownedElementIds.includes("FooImpl.bar"), false);
});
