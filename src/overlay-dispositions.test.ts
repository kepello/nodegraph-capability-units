/**
 * Disposition-layer wave 3a (Fathom row 3.1.8.4). Pins:
 *
 *   - `insertUnit` emits `analysis-disposition` edges ADDITIVELY,
 *     alongside the existing `entry`/`composes`/`uses` membership edges
 *     (both families coexist until wave 4 retires membership).
 *   - Kinds map 1:1: `entry` → `["entry"]`, `composes` → `["composes"]`,
 *     `uses` → `["uses"]` — no collapse case naturally occurs at L2
 *     because `ownedElementIds` structurally excludes the entry (see
 *     `closure.ts`'s BFS — the seed is never added to its own reached
 *     set).
 *   - The entry-target-∈-owned-set collapse shape is PINNED regardless:
 *     `insertUnit`'s public contract doesn't itself enforce the
 *     exclusion, and the wave-1 `recordDispositions` grouping already
 *     handles it generically (group-by (source, target), merge kinds).
 *     A pathological input where an owned element id equals the entry
 *     element id collapses to ONE edge, `metadata.kinds` sorted
 *     `["composes", "entry"]`, subtype/primary `"entry"` (precedence 3
 *     beats `composes`'s 4 — see `nodegraph-dispositions`'s
 *     `PRIMARY_KIND_PRECEDENCE`).
 *   - Disposition edges resolve dangling (targetRef) members exactly
 *     like the membership edges they parallel.
 *   - Re-inserting an unchanged unit doesn't duplicate disposition edges.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GraphLayerImpl, type GraphLayer } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import { ANALYSIS_DISPOSITION_EDGE_TYPE } from "@kepello/nodegraph-dispositions";
import { makeCapabilityUnitOverlay } from "./overlay.js";
import {
  COMPOSES_EDGE_TYPE,
  ENTRY_EDGE_TYPE,
  USES_EDGE_TYPE,
} from "./types.js";

function makeGraph(): GraphLayer {
  return new GraphLayerImpl(new InMemoryBackend());
}

test("insertUnit — both edge families exist: membership AND analysis-disposition", () => {
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

  // Membership edges (unchanged, still emitted).
  assert.equal(
    graph.edgesFrom(node.id, { type: ENTRY_EDGE_TYPE, includeDangling: true }).length,
    1,
  );
  assert.equal(
    graph.edgesFrom(node.id, { type: COMPOSES_EDGE_TYPE, includeDangling: true }).length,
    2,
  );
  assert.equal(
    graph.edgesFrom(node.id, { type: USES_EDGE_TYPE, includeDangling: true }).length,
    1,
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
