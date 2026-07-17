/**
 * Overlay-implementation tests. Pins:
 *
 *   - registerOverlay is idempotent.
 *   - insertUnit persists metadata + entry / composes / uses
 *     `analysis-disposition` edges.
 *   - insertUnit is idempotent on identical content-hash.
 *   - insertUnit supersedes on different content-hash.
 *   - renameUnit updates displayName, preserves identity.
 *   - tombstoneUnit removes from listUnits.
 *   - unitForEntry walks incoming entry-kind disposition edges.
 *   - unitsThatUse walks incoming uses-kind disposition edges.
 *   - membersOf returns composes-kind disposition edges.
 *   - usedBy returns uses-kind disposition edges.
 *
 * Fathom row 3.1.8.4 wave 4 (SANCTIONED delta): the "persists metadata +
 * entry / composes / uses edges" test below asserted on the now-retired
 * dedicated `entry`/`composes`/`uses` edge types; reworked to assert on
 * `analysis-disposition` edges instead. The other tests in this file
 * exercise the overlay's public read API (`membersOf` / `usedBy` /
 * `unitForEntry` / `unitsThatUse`), not raw edge types, so they carry
 * over unchanged — the disposition-backed re-implementation is exercised
 * transparently through them.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  GraphLayerImpl,
  type GraphLayer,
} from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import { ANALYSIS_DISPOSITION_EDGE_TYPE } from "@kepello/nodegraph-dispositions";
import {
  CAPABILITY_UNIT_DOMAIN,
  CAPABILITY_UNIT_METADATA_KIND,
} from "./schema.js";
import {
  CapabilityUnitOverlayImpl,
  makeCapabilityUnitOverlay,
} from "./overlay.js";

function makeGraph(): GraphLayer {
  return new GraphLayerImpl(new InMemoryBackend());
}

test("registerOverlay — idempotent on repeated construction", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  assert.doesNotThrow(() => new CapabilityUnitOverlayImpl(graph));
  assert.ok(overlay);
});

test("insertUnit — persists metadata + entry / composes / uses analysis-disposition edges (3.1.8.4 wave 4)", () => {
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
  assert.equal(node.metadata.kind, CAPABILITY_UNIT_METADATA_KIND);
  assert.equal(node.metadata.unitId, "uid-1");
  assert.equal(node.metadata.ownedCount, 2);
  assert.equal(node.metadata.usedCount, 1);

  // Edges out — analysis-disposition is the sole membership record
  // (legacy dedicated entry/composes/uses edge types retired, wave 4).
  const dispositions = graph.edgesFrom(node.id, {
    type: ANALYSIS_DISPOSITION_EDGE_TYPE,
    includeDangling: true,
  });
  assert.equal(dispositions.length, 4, "entry + 2 composes + 1 uses");
  assert.equal(overlay.unitForEntry("createUser")?.metadata.unitId, "uid-1");
  assert.equal(overlay.membersOf("uid-1").length, 2);
  assert.equal(overlay.usedBy("uid-1").length, 1);
});

test("insertUnit — idempotent on identical content-hash", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  const a = overlay.insertUnit({
    unitId: "u",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h1",
    ownedElementIds: ["m1"],
    usedElementIds: [],
  });
  const b = overlay.insertUnit({
    unitId: "u",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h1",
    ownedElementIds: ["m1"],
    usedElementIds: [],
  });
  assert.equal(a.id, b.id);
  // No duplicate edges.
  assert.equal(overlay.membersOf("u").length, 1);
});

test("insertUnit — supersedes on different content-hash", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  const a = overlay.insertUnit({
    unitId: "u",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "v1",
    ownedElementIds: ["m1"],
    usedElementIds: [],
  });
  const b = overlay.insertUnit({
    unitId: "u",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "v2",
    ownedElementIds: ["m1", "m2"],
    usedElementIds: [],
  });
  assert.notEqual(a.id, b.id);
  const live = overlay.listUnits();
  assert.equal(live.length, 1);
  assert.equal(live[0].id, b.id);
  assert.equal(live[0].metadata.ownedCount, 2);
});

test("renameUnit — updates displayName, preserves identity", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "u",
    entryElementId: "e",
    entryName: "e",
    name: "auto-name",
    contentHash: "h",
    ownedElementIds: [],
    usedElementIds: [],
  });
  const renamed = overlay.renameUnit("u", "Operator Override");
  assert.equal(renamed.metadata.unitId, "u");
  assert.equal(renamed.metadata.displayName, "Operator Override");
  assert.equal(renamed.metadata.name, "auto-name");
});

test("renameUnit — throws on unknown unitId", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  assert.throws(() => overlay.renameUnit("nope", "X"));
});

test("tombstoneUnit — removes from listUnits", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "doomed",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h",
    ownedElementIds: [],
    usedElementIds: [],
  });
  assert.equal(overlay.listUnits().length, 1);
  overlay.tombstoneUnit("doomed");
  assert.equal(overlay.listUnits().length, 0);
});

test("tombstoneUnit — silent no-op on unknown unitId", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  assert.doesNotThrow(() => overlay.tombstoneUnit("nope"));
});

test("getUnit — by id; undefined for unknown", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "known",
    entryElementId: "e",
    entryName: "e",
    name: "e",
    contentHash: "h",
    ownedElementIds: [],
    usedElementIds: [],
  });
  const found = overlay.getUnit("known");
  const missing = overlay.getUnit("missing");
  assert.ok(found);
  assert.equal(found.metadata.unitId, "known");
  assert.equal(missing, undefined);
});

test("unitForEntry — walks incoming entry edges (natural-key form)", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "u",
    entryElementId: "myEntry",
    entryName: "myEntry",
    name: "myEntry",
    contentHash: "h",
    ownedElementIds: [],
    usedElementIds: [],
  });
  const unit = overlay.unitForEntry("myEntry");
  assert.ok(unit);
  assert.equal(unit.metadata.unitId, "u");
});

test("unitsThatUse — finds units whose uses set includes the element", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  overlay.insertUnit({
    unitId: "u1",
    entryElementId: "e1",
    entryName: "e1",
    name: "e1",
    contentHash: "h1",
    ownedElementIds: [],
    usedElementIds: ["sharedHelper"],
  });
  overlay.insertUnit({
    unitId: "u2",
    entryElementId: "e2",
    entryName: "e2",
    name: "e2",
    contentHash: "h2",
    ownedElementIds: [],
    usedElementIds: ["sharedHelper"],
  });
  const users = overlay.unitsThatUse("sharedHelper");
  assert.equal(users.length, 2);
});

test("CAPABILITY_UNIT_DOMAIN — domain is the substrate identifier", () => {
  assert.equal(CAPABILITY_UNIT_DOMAIN, "capability-unit");
});
