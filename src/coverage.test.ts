/**
 * Algorithm-level tests for `countL2Units` + `computeL2Coverage`
 * (L2 query surface, exported from `./queries.js`). Pure-function tests:
 * build an in-memory substrate + overlay, insert known units, call the
 * query, assert exact numbers. No MCP transport involved — those tests
 * lived in `fathom-mcp/src/phase-3/capability-units-aggregate.test.ts`
 * and moved here when the algorithm relocated.
 *
 * Filed under Fathom row `l2-coverage-restructuring` (5.3.3): the
 * algorithm shipped originally inside the MCP handler in
 * `fathom-mcp@2.15.0/2.15.1` — wrong layer — and moved into this
 * package as `queries.ts`. Implements two denominator-exclusion
 * categories in the move:
 *   - Cat 1a — `hasBody === false` (structural; body-less interface
 *     methods cannot be capability-unit members).
 *   - Cat 1b — `methodStereotype === "test-fixture"` (policy; mirrors
 *     the L2 seed-side exclusion shipped in 5.0.23).
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GraphLayerImpl, type GraphLayer } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import {
  makeCapabilityUnitOverlay,
  type CapabilityUnitOverlay,
} from "./index.js";
import { countL2Units, computeL2Coverage } from "./queries.js";

interface BuiltSubstrate {
  graph: GraphLayer;
  overlay: CapabilityUnitOverlay;
  uuids: Record<string, string>;
}

/**
 * Build a substrate with caller-controlled element specs. Each spec
 * names a naturalKey, elementKind, optional language, optional hasBody,
 * and optional methodStereotype (lifted into `memoizedDerivations` to
 * mirror what `analyzeRepo` persists at L1).
 */
type ElementSpec = {
  naturalKey: string;
  elementKind: string;
  language?: string;
  hasBody?: boolean;
  methodStereotype?: string;
};

function buildSubstrate(specs: readonly ElementSpec[]): BuiltSubstrate {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  graph.registerOverlay({
    schemaVersion: 1,
    domain: "analysis",
    metadataSchema: {
      kind: "analysis-element",
      type: "object",
      properties: {},
      required: ["kind"],
    },
    indexes: [],
  });

  const uuids: Record<string, string> = {};
  graph.transaction(
    { kind: "test-insert-element", producerDomain: "analysis", summary: "seed" },
    () => {
      for (const spec of specs) {
        const metadata: Record<string, unknown> = {
          kind: "analysis-element",
          elementName: spec.naturalKey.split(":").pop()!,
          elementKind: spec.elementKind,
        };
        if (spec.language !== undefined) metadata.language = spec.language;
        if (spec.hasBody !== undefined) metadata.hasBody = spec.hasBody;
        if (spec.methodStereotype !== undefined) {
          metadata.memoizedDerivations = { methodStereotype: spec.methodStereotype };
        }
        const node = graph.insertNode({
          domain: "analysis",
          naturalKey: spec.naturalKey,
          contentHash: `ch_${spec.naturalKey}`,
          metadata,
        });
        uuids[spec.naturalKey] = node.id;
      }
    },
  );

  const overlay = makeCapabilityUnitOverlay(graph);
  return { graph, overlay, uuids };
}

/**
 * Build a methodStereotype lookup function backed by the substrate's
 * memoizedDerivations. Test-fixture-local wiring; the algorithm itself
 * is callback-agnostic.
 *
 * NOTE (Fathom 2.4.7 audit): production wires this callback through
 * `readMemoizedValue` from
 * `@kepello/nodegraph-core` so post-version-bump keys (e.g.
 * `methodStereotype:v2`) resolve. This fixture writes unversioned
 * keys in `buildSubstrate` and reads them back here unversioned —
 * the fixture's substrate data shape is under the test's own
 * control, so the version-tolerance concern doesn't apply. If a
 * future test needs to mirror the production wiring (verify the
 * version-tolerant resolution path end-to-end), import the helper
 * here and use it instead.
 */
function stereoLookupFromMetadata(graph: GraphLayer): (id: string) => string | null {
  return (id: string) => {
    const node = graph.getNodeById(id);
    if (node === undefined) return null;
    const meta = node.metadata as { memoizedDerivations?: { methodStereotype?: string } } | null;
    const s = meta?.memoizedDerivations?.methodStereotype;
    return typeof s === "string" ? s : null;
  };
}

// --- countL2Units -----------------------------------------------------

test("countL2Units — total + per-language breakdown", () => {
  const { graph, overlay, uuids } = buildSubstrate([
    { naturalKey: ":proj:a", elementKind: "function", language: "typescript", hasBody: true },
    { naturalKey: ":proj:b", elementKind: "function", language: "typescript", hasBody: true },
    { naturalKey: ":proj:c", elementKind: "function", language: "swift", hasBody: true },
  ]);
  overlay.insertUnit({
    unitId: "cu_a",
    entryElementId: uuids[":proj:a"]!,
    entryName: "a",
    name: "a",
    language: "typescript",
    contentHash: "h_a",
    ownedElementIds: [],
    usedElementIds: [],
  });
  overlay.insertUnit({
    unitId: "cu_b",
    entryElementId: uuids[":proj:b"]!,
    entryName: "b",
    name: "b",
    language: "typescript",
    contentHash: "h_b",
    ownedElementIds: [],
    usedElementIds: [],
  });
  overlay.insertUnit({
    unitId: "cu_c",
    entryElementId: uuids[":proj:c"]!,
    entryName: "c",
    name: "c",
    language: "swift",
    contentHash: "h_c",
    ownedElementIds: [],
    usedElementIds: [],
  });
  void graph; // graph used to silence unused-var lint

  const all = countL2Units({ overlay });
  assert.equal(all.total, 3);
  assert.equal(all.byLanguage.typescript, 2);
  assert.equal(all.byLanguage.swift, 1);

  const filtered = countL2Units({ overlay, language: "typescript" });
  assert.equal(filtered.total, 2);
  assert.equal(filtered.byLanguage.typescript, 2);
  assert.equal(filtered.byLanguage.swift, undefined);
});

// --- computeL2Coverage — two-unit baseline ---------------------------

test("computeL2Coverage — two-unit fixture with mixed kinds", () => {
  // 4 body-bearing TS callables: alpha (entry), beta (entry), util (shared),
  // orphan (uncovered). Plus 1 class container (excluded — not body-bearing).
  const { graph, overlay, uuids } = buildSubstrate([
    { naturalKey: ":proj:alpha", elementKind: "function", language: "typescript", hasBody: true },
    { naturalKey: ":proj:beta", elementKind: "function", language: "typescript", hasBody: true },
    { naturalKey: ":proj:util", elementKind: "function", language: "typescript", hasBody: true },
    { naturalKey: ":proj:orphan", elementKind: "function", language: "typescript", hasBody: true },
    { naturalKey: ":proj:SomeClass", elementKind: "class", language: "typescript" },
  ]);
  overlay.insertUnit({
    unitId: "cu_alpha",
    entryElementId: uuids[":proj:alpha"]!,
    entryName: "alpha",
    name: "alpha",
    language: "typescript",
    contentHash: "h_alpha",
    ownedElementIds: [],
    usedElementIds: [uuids[":proj:util"]!],
  });
  overlay.insertUnit({
    unitId: "cu_beta",
    entryElementId: uuids[":proj:beta"]!,
    entryName: "beta",
    name: "beta",
    language: "typescript",
    contentHash: "h_beta",
    ownedElementIds: [],
    usedElementIds: [uuids[":proj:util"]!],
  });

  const result = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
  });
  // Denominator: 4 (alpha + beta + util + orphan); SomeClass excluded.
  assert.equal(result.totalBodyBearingCallables, 4);
  // Numerator: alpha + beta + util = 3 (orphan unreachable).
  assert.equal(result.l2VisibleElementCount, 3);
  // 3/4 = 75
  assert.equal(result.coveragePercent, 75);
  assert.deepEqual(result.byLanguage.typescript, { total: 4, visible: 3, coveragePercent: 75 });
});

// --- computeL2Coverage — language filter -----------------------------

test("computeL2Coverage — language filter restricts numerator + denominator", () => {
  const { graph, overlay, uuids } = buildSubstrate([
    { naturalKey: ":proj:ts1", elementKind: "function", language: "typescript", hasBody: true },
    { naturalKey: ":proj:sw1", elementKind: "function", language: "swift", hasBody: true },
  ]);
  overlay.insertUnit({
    unitId: "cu_ts",
    entryElementId: uuids[":proj:ts1"]!,
    entryName: "ts1",
    name: "ts1",
    language: "typescript",
    contentHash: "h_ts",
    ownedElementIds: [],
    usedElementIds: [],
  });
  overlay.insertUnit({
    unitId: "cu_sw",
    entryElementId: uuids[":proj:sw1"]!,
    entryName: "sw1",
    name: "sw1",
    language: "swift",
    contentHash: "h_sw",
    ownedElementIds: [],
    usedElementIds: [],
  });

  const filtered = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
    language: "typescript",
  });
  assert.equal(filtered.totalBodyBearingCallables, 1);
  assert.equal(filtered.l2VisibleElementCount, 1);
  assert.equal(filtered.coveragePercent, 100);
  assert.equal(filtered.byLanguage.swift, undefined);
});

// --- computeL2Coverage — empty-overlay invariant ---------------------

test("computeL2Coverage — empty overlay returns coveragePercent 0 cleanly", () => {
  const { graph, overlay } = buildSubstrate([
    { naturalKey: ":proj:lone", elementKind: "function", language: "typescript", hasBody: true },
  ]);

  const result = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
  });
  assert.equal(result.totalBodyBearingCallables, 1);
  assert.equal(result.l2VisibleElementCount, 0);
  assert.equal(result.coveragePercent, 0);
});

// --- computeL2Coverage — stale-UUID regression -----------------------

test("computeL2Coverage — resolves stale UUIDs in unit metadata after element supersede", () => {
  // Mirrors the 2.15.1 fix scenario: element is inserted, unit references
  // its ORIGINAL UUID, element is superseded (new UUID assigned, same
  // naturalKey). Coverage must still see the entry as L2-visible.
  const graph = new GraphLayerImpl(new InMemoryBackend());
  graph.registerOverlay({
    schemaVersion: 1,
    domain: "analysis",
    metadataSchema: {
      kind: "analysis-element",
      type: "object",
      properties: {},
      required: ["kind"],
    },
    indexes: [],
  });

  let originalUuid = "";
  graph.transaction(
    { kind: "test-insert-element", producerDomain: "analysis", summary: "seed" },
    () => {
      const node = graph.insertNode({
        domain: "analysis",
        naturalKey: ":proj:stableFn",
        contentHash: "ch_v1",
        metadata: {
          kind: "analysis-element",
          elementName: "stableFn",
          elementKind: "function",
          language: "typescript",
          hasBody: true,
        },
      });
      originalUuid = node.id;
    },
  );

  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "cu_stable",
    entryElementId: originalUuid,
    entryName: "stableFn",
    name: "stableFn",
    language: "typescript",
    contentHash: "cu_h_stable",
    ownedElementIds: [],
    usedElementIds: [],
  });

  graph.transaction(
    { kind: "test-supersede", producerDomain: "analysis", summary: "v2" },
    () => {
      graph.supersedeNode(originalUuid, {
        contentHash: "ch_v2",
        metadata: {
          kind: "analysis-element",
          elementName: "stableFn",
          elementKind: "function",
          language: "typescript",
          hasBody: true,
        },
      });
    },
  );

  const result = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
  });
  assert.equal(result.totalBodyBearingCallables, 1);
  assert.equal(
    result.l2VisibleElementCount,
    1,
    `Stale UUID must resolve through getNodeById → naturalKey lookup. Got ${result.l2VisibleElementCount}.`,
  );
  assert.equal(result.coveragePercent, 100);
});

// --- computeL2Coverage — Cat 1a: hasBody === false excluded ----------

test("computeL2Coverage — Cat 1a: body-less interface methods excluded from denominator", () => {
  // hasBody === false marks structurally body-less elements (interface
  // method signatures, abstract method declarations). They emit no
  // calls/callsMethod edges and cannot be capability-unit members; they
  // must NOT count in the coverage denominator.
  const { graph, overlay, uuids } = buildSubstrate([
    { naturalKey: ":proj:impl", elementKind: "function", language: "typescript", hasBody: true },
    {
      naturalKey: ":proj:IFoo.bar",
      elementKind: "method",
      language: "typescript",
      hasBody: false, // body-less interface method
    },
  ]);
  overlay.insertUnit({
    unitId: "cu_impl",
    entryElementId: uuids[":proj:impl"]!,
    entryName: "impl",
    name: "impl",
    language: "typescript",
    contentHash: "h_impl",
    ownedElementIds: [],
    usedElementIds: [],
  });

  const result = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
  });
  // Denominator: 1 (impl); body-less method excluded.
  assert.equal(
    result.totalBodyBearingCallables,
    1,
    "Cat 1a: body-less interface method must be excluded from denominator",
  );
  assert.equal(result.l2VisibleElementCount, 1);
  assert.equal(result.coveragePercent, 100);
});

// Conservative cousin of Cat 1a: when `hasBody` is missing (undefined),
// the element is INCLUDED in the denominator. Analyzers at basic
// conformance may not emit the facet yet; we don't want to silently shrink
// the denominator and inflate coverage in that case.
test("computeL2Coverage — Cat 1a conservative: hasBody undefined keeps element in denominator", () => {
  const { graph, overlay, uuids } = buildSubstrate([
    { naturalKey: ":proj:impl", elementKind: "function", language: "typescript", hasBody: true },
    {
      naturalKey: ":proj:noBodyFacet",
      elementKind: "method",
      language: "typescript",
      // hasBody intentionally omitted — analyzer at basic conformance
    },
  ]);
  overlay.insertUnit({
    unitId: "cu_impl",
    entryElementId: uuids[":proj:impl"]!,
    entryName: "impl",
    name: "impl",
    language: "typescript",
    contentHash: "h_impl",
    ownedElementIds: [],
    usedElementIds: [],
  });

  const result = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
  });
  // Denominator: 2 (impl + noBodyFacet — unknown hasBody is included).
  assert.equal(
    result.totalBodyBearingCallables,
    2,
    "Cat 1a is strict-equality: hasBody undefined → INCLUDED (don't inflate coverage on lossy analyzers)",
  );
  assert.equal(result.l2VisibleElementCount, 1);
  assert.equal(result.coveragePercent, 50);
});

// --- computeL2Coverage — Cat 1b: test-fixture stereotype excluded ----

test("computeL2Coverage — Cat 1b: test-fixture-stereotype elements excluded from denominator", () => {
  // methodStereotype === "test-fixture" → element lives in a test path
  // (.test.ts / /tests/ / /__tests__/ / /fixtures/). L2 seeds already
  // exclude them (5.0.23); coverage follows the same policy. Drift-proof
  // because the stereotype is the unified L1 primitive, NOT a path regex.
  const { graph, overlay, uuids } = buildSubstrate([
    { naturalKey: ":proj:prod", elementKind: "function", language: "typescript", hasBody: true },
    {
      naturalKey: ":proj:test_helper",
      elementKind: "function",
      language: "typescript",
      hasBody: true,
      methodStereotype: "test-fixture",
    },
  ]);
  overlay.insertUnit({
    unitId: "cu_prod",
    entryElementId: uuids[":proj:prod"]!,
    entryName: "prod",
    name: "prod",
    language: "typescript",
    contentHash: "h_prod",
    ownedElementIds: [],
    usedElementIds: [],
  });

  const result = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
  });
  // Denominator: 1 (prod); test-fixture excluded.
  assert.equal(
    result.totalBodyBearingCallables,
    1,
    "Cat 1b: methodStereotype === 'test-fixture' must be excluded from denominator",
  );
  assert.equal(result.l2VisibleElementCount, 1);
  assert.equal(result.coveragePercent, 100);
});

// Conservative cousin of Cat 1b: null methodStereotype (no L1 derivation
// yet, or stereotype rules didn't fire) leaves the element in the
// denominator. Mirrors the 1a conservative posture.
test("computeL2Coverage — Cat 1b conservative: null methodStereotype keeps element in denominator", () => {
  const { graph, overlay, uuids } = buildSubstrate([
    { naturalKey: ":proj:prod", elementKind: "function", language: "typescript", hasBody: true },
    {
      naturalKey: ":proj:undecided",
      elementKind: "function",
      language: "typescript",
      hasBody: true,
      // methodStereotype intentionally omitted (lookup returns null)
    },
  ]);
  overlay.insertUnit({
    unitId: "cu_prod",
    entryElementId: uuids[":proj:prod"]!,
    entryName: "prod",
    name: "prod",
    language: "typescript",
    contentHash: "h_prod",
    ownedElementIds: [],
    usedElementIds: [],
  });

  const result = computeL2Coverage({
    overlay,
    graph,
    methodStereotype: stereoLookupFromMetadata(graph),
  });
  // Denominator: 2 (prod + undecided — null stereotype is INCLUDED).
  assert.equal(
    result.totalBodyBearingCallables,
    2,
    "Cat 1b is strict-equality: methodStereotype null/undefined → INCLUDED",
  );
  assert.equal(result.l2VisibleElementCount, 1);
  assert.equal(result.coveragePercent, 50);
});
