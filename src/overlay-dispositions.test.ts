/**
 * Disposition-layer wave 4 (Fathom row 3.1.8.4, BREAKING). Pins:
 *
 *   - `insertUnit` no longer emits the legacy `entry`/`composes`/`uses`
 *     membership edges — `analysis-disposition` edges are the SOLE
 *     membership record (wave 3a's coexistence period is over).
 *   - Kinds map 1:1: `entry` → `["entry"]`, `composes` → `["composes"]`,
 *     `uses` → `["uses"]` — no collapse case naturally occurs at L2
 *     because `ownedElementIds` structurally excludes the entry (see
 *     `closure.ts`'s BFS — the seed is never added to its own reached
 *     set).
 *   - The entry-target-∈-owned-set collapse shape is PINNED regardless:
 *     `insertUnit`'s public contract doesn't itself enforce the
 *     exclusion, and `recordDispositions`'s grouping already handles it
 *     generically (group-by (source, target), merge kinds). A
 *     pathological input where an owned element id equals the entry
 *     element id collapses to ONE edge, `metadata.kinds` sorted
 *     `["composes", "entry"]`, subtype/primary `"entry"` (precedence 3
 *     beats `composes`'s 4 — see `nodegraph-dispositions`'s
 *     `PRIMARY_KIND_PRECEDENCE`).
 *   - Disposition edges resolve dangling (targetRef) members exactly
 *     like the membership edges they replace.
 *   - Re-inserting an unchanged unit doesn't duplicate disposition edges.
 *   - DRIFT PARITY: `recordDispositions`'s per-pair kind merge is
 *     ADDITIVE ONLY — it never evicts a target that fell out of the
 *     desired set, nor sheds a kind a target no longer carries.
 *     `reconcileDispositions` (overlay.ts) is what makes the live
 *     disposition-edge set track current membership; the tests below
 *     exercise the three drift shapes it must handle: a departed
 *     member, a changed entry, and a target whose kind changes (moved
 *     from owned to used) — all under an UNCHANGED unit contentHash, the
 *     one case the substrate's own supersede-cascade can't rescue
 *     (see `overlay.ts`'s class doc comment) — plus `renameUnit`,
 *     which the substrate's cascade actively BREAKS unless the caller
 *     re-reconciles after `supersedeNode`.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GraphLayerImpl, type GraphLayer } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import { ANALYSIS_DISPOSITION_EDGE_TYPE } from "@kepello/nodegraph-dispositions";
import { makeCapabilityUnitOverlay } from "./overlay.js";

function makeGraph(): GraphLayer {
  return new GraphLayerImpl(new InMemoryBackend());
}

test("insertUnit — legacy membership edges are NOT emitted; analysis-disposition is the sole record", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  const node = overlay.insertUnit({
    unitId: "uid-1",
    entryElementId: "createUser",
    entryName: "createUser",
    name: "createUser",
    contentHash: "ch1",
    ownedElementIds: ["validate", "persist"],
    usedElementIds: ["logActivity"],
  });

  // Legacy membership edges — RETIRED, wave 4. Literal type strings
  // (not imported constants — `ENTRY_EDGE_TYPE` / `COMPOSES_EDGE_TYPE` /
  // `USES_EDGE_TYPE` were deleted from `types.ts` along with emission).
  assert.equal(
    graph.edgesFrom(node.id, { type: "entry", includeDangling: true }).length,
    0,
    "entry edges must not be emitted",
  );
  assert.equal(
    graph.edgesFrom(node.id, { type: "composes", includeDangling: true }).length,
    0,
    "composes edges must not be emitted",
  );
  assert.equal(
    graph.edgesFrom(node.id, { type: "uses", includeDangling: true }).length,
    0,
    "uses edges must not be emitted",
  );

  // Disposition edges — one per (unit, target) pair: entry + 2 owned + 1 used = 4.
  const dispositions = graph.edgesFrom(node.id, {
    type: ANALYSIS_DISPOSITION_EDGE_TYPE,
    includeDangling: true,
  });
  assert.equal(dispositions.length, 4);

  const byTargetRef = new Map(dispositions.map((e) => [e.targetRef, e]));
  const entryDisp = byTargetRef.get("createUser");
  const validateDisp = byTargetRef.get("validate");
  const persistDisp = byTargetRef.get("persist");
  const usesDisp = byTargetRef.get("logActivity");
  assert.ok(entryDisp, "entry disposition edge exists");
  assert.ok(validateDisp, "composes(validate) disposition edge exists");
  assert.ok(persistDisp, "composes(persist) disposition edge exists");
  assert.ok(usesDisp, "uses disposition edge exists");

  assert.deepEqual(entryDisp!.metadata, { kinds: ["entry"] });
  assert.equal(entryDisp!.subtype, "entry");
  assert.deepEqual(validateDisp!.metadata, { kinds: ["composes"] });
  assert.equal(validateDisp!.subtype, "composes");
  assert.deepEqual(persistDisp!.metadata, { kinds: ["composes"] });
  assert.equal(persistDisp!.subtype, "composes");
  assert.deepEqual(usesDisp!.metadata, { kinds: ["uses"] });
  assert.equal(usesDisp!.subtype, "uses");
});

test("insertUnit — disposition edges resolve to real node ids when the target is a live node", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);

  // Seed a real node in an unrelated domain so `getNodeById` resolves it.
  const FIXTURE_DOMAIN = "fixture";
  const fixtureMutator = graph.registerOverlay({
    domain: FIXTURE_DOMAIN,
    schemaVersion: 1,
    metadataSchema: { type: "object", properties: {} },
    indexes: [],
  });
  const seedNode = graph.transaction(
    { kind: "seed-fixture-node", producerDomain: FIXTURE_DOMAIN, summary: "seed fixture element" },
    () =>
      fixtureMutator.insertNode({
        domain: FIXTURE_DOMAIN,
        naturalKey: "seed-element",
        contentHash: "seed-ch",
        metadata: {},
      }),
  ).result;

  const node = overlay.insertUnit({
    unitId: "uid-resolved",
    entryElementId: seedNode.id,
    entryName: "seedFn",
    name: "seedFn",
    contentHash: "ch-resolved",
    ownedElementIds: [],
    usedElementIds: [],
  });

  const dispositions = graph.edgesFrom(node.id, {
    type: ANALYSIS_DISPOSITION_EDGE_TYPE,
    includeDangling: true,
  });
  assert.equal(dispositions.length, 1);
  assert.equal(dispositions[0]!.targetId, seedNode.id);
  assert.equal(dispositions[0]!.targetRef, null);
});

test("insertUnit — entry-target ∈ owned-set collapses to one edge, kinds=[composes,entry], primary=entry", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  // Pathological input: `ownedElementIds` includes the entry element id.
  // `computeCapabilityUnits` never produces this shape (the BFS
  // structurally excludes the seed from its own reached set — see
  // `closure.ts`), but `insertUnit`'s type contract doesn't enforce the
  // exclusion, so this pins the collapse behavior defensively.
  const node = overlay.insertUnit({
    unitId: "uid-overlap",
    entryElementId: "sharedTarget",
    entryName: "sharedTarget",
    name: "sharedTarget",
    contentHash: "ch-overlap",
    ownedElementIds: ["sharedTarget"],
    usedElementIds: [],
  });

  const dispositions = graph.edgesFrom(node.id, {
    type: ANALYSIS_DISPOSITION_EDGE_TYPE,
    includeDangling: true,
  });
  assert.equal(dispositions.length, 1, "entry + composes on the same target collapse to one edge");
  assert.deepEqual(dispositions[0]!.metadata, { kinds: ["composes", "entry"] });
  assert.equal(dispositions[0]!.subtype, "entry", "primary kind is entry (precedence 3 < composes 4)");
});

test("insertUnit — re-inserting an unchanged unit does not duplicate disposition edges", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  const input = {
    unitId: "uid-stable",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h1",
    ownedElementIds: ["m1"],
    usedElementIds: [],
  };
  const a = overlay.insertUnit(input);
  const b = overlay.insertUnit(input);
  assert.equal(a.id, b.id);
  const dispositions = graph.edgesFrom(a.id, {
    type: ANALYSIS_DISPOSITION_EDGE_TYPE,
    includeDangling: true,
  });
  assert.equal(dispositions.length, 2, "entry + composes(m1) — no duplicates from the second insert");
});

// --- Drift parity (3.1.8.4 wave 4) -----------------------------------
//
// All three cases below hold the unit's `contentHash` UNCHANGED across
// the two `insertUnit` calls, so the node id stays the same and the
// substrate's own supersede-cascade (which auto-tombstones a prior
// tip's outgoing edges) never fires. This is deliberate: it isolates
// the ONE case `reconcileDispositions` exists for. `recordDispositions`
// called directly on each call's fresh candidate batch — the wave-3a
// shape, before `reconcileDispositions` existed — would NOT tombstone a
// departed target's edge (no candidate touches that (source, target)
// pair, so it's simply never visited) and would ADD a moved target's
// new kind onto its existing edge rather than replace it (the merge is
// additive-only). Both are silent membership drift once disposition
// edges are the sole read path.

test("insertUnit — same contentHash, shrunken ownedElementIds: departed member's disposition edge is tombstoned", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "uid-drift-shrink",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h-stable",
    ownedElementIds: ["m1", "m2"],
    usedElementIds: [],
  });
  const after = overlay.insertUnit({
    unitId: "uid-drift-shrink",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h-stable",
    ownedElementIds: ["m1"],
    usedElementIds: [],
  });

  const members = overlay.membersOf("uid-drift-shrink").map((e) => e.targetRef);
  assert.deepEqual(members.sort(), ["m1"], "m2 must be evicted, not just left un-re-added");

  const dispositions = graph.edgesFrom(after.id, {
    type: ANALYSIS_DISPOSITION_EDGE_TYPE,
    includeDangling: true,
  });
  assert.equal(dispositions.length, 2, "entry(e) + composes(m1) only — m2's edge must be tombstoned, not merely absent from membersOf");
});

test("insertUnit — same contentHash, changed entryElementId: stale entry disposition edge is tombstoned", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "uid-drift-entry",
    entryElementId: "oldEntry",
    entryName: "oldEntry",
    name: "oldEntry",
    contentHash: "h-stable",
    ownedElementIds: [],
    usedElementIds: [],
  });
  overlay.insertUnit({
    unitId: "uid-drift-entry",
    entryElementId: "newEntry",
    entryName: "newEntry",
    name: "newEntry",
    contentHash: "h-stable",
    ownedElementIds: [],
    usedElementIds: [],
  });

  assert.equal(overlay.unitForEntry("oldEntry"), undefined, "stale entry must no longer resolve");
  const resolved = overlay.unitForEntry("newEntry");
  assert.ok(resolved, "new entry must resolve");
  assert.equal(resolved!.metadata.unitId, "uid-drift-entry");
});

test("insertUnit — same contentHash, target moves from owned to used: kind is corrected, not accumulated", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "uid-drift-kind",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h-stable",
    ownedElementIds: ["shifted"],
    usedElementIds: [],
  });
  const after = overlay.insertUnit({
    unitId: "uid-drift-kind",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h-stable",
    ownedElementIds: [],
    usedElementIds: ["shifted"],
  });

  assert.deepEqual(
    overlay.membersOf("uid-drift-kind").map((e) => e.targetRef),
    [],
    "shifted must no longer read as owned",
  );
  assert.deepEqual(
    overlay.usedBy("uid-drift-kind").map((e) => e.targetRef),
    ["shifted"],
    "shifted must read as used",
  );

  const shiftedEdge = graph
    .edgesFrom(after.id, { type: ANALYSIS_DISPOSITION_EDGE_TYPE, includeDangling: true })
    .find((e) => e.targetRef === "shifted");
  assert.ok(shiftedEdge, "shifted's disposition edge must exist");
  assert.deepEqual(
    shiftedEdge!.metadata,
    { kinds: ["uses"] },
    "kinds must be replaced, not accumulated to [composes, uses]",
  );
  assert.equal(shiftedEdge!.subtype, "uses");
});

test("renameUnit — preserves entry/composes/uses disposition edges across the metadata-only supersede", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "uid-rename",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h1",
    ownedElementIds: ["m1"],
    usedElementIds: ["u1"],
  });

  const renamed = overlay.renameUnit("uid-rename", "Operator Override");
  assert.equal(renamed.metadata.displayName, "Operator Override");

  assert.equal(
    overlay.unitForEntry("e")?.metadata.unitId,
    "uid-rename",
    "entry must still resolve after rename",
  );
  assert.deepEqual(
    overlay.membersOf("uid-rename").map((e) => e.targetRef),
    ["m1"],
    "composes membership must survive the rename's supersedeNode cascade",
  );
  assert.deepEqual(
    overlay.usedBy("uid-rename").map((e) => e.targetRef),
    ["u1"],
    "uses membership must survive the rename's supersedeNode cascade",
  );
});
