/**
 * Overlay-implementation tests. Pins:
 *
 *   - registerOverlay is idempotent.
 *   - insertUnit persists metadata + entry / composes / uses edges.
 *   - insertUnit is idempotent on identical content-hash.
 *   - insertUnit supersedes on different content-hash.
 *   - renameUnit updates displayName, preserves identity.
 *   - tombstoneUnit removes from listUnits.
 *   - unitForEntry walks incoming entry edges.
 *   - unitsThatUse walks incoming uses edges.
 *   - membersOf returns composes edges.
 *   - usedBy returns uses edges.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  GraphLayerImpl,
  type GraphLayer,
} from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import {
  CAPABILITY_UNIT_DOMAIN,
  CAPABILITY_UNIT_METADATA_KIND,
} from "./schema.js";
import {
  CapabilityUnitOverlayImpl,
  makeCapabilityUnitOverlay,
} from "./overlay.js";
import {
  COMPOSES_EDGE_TYPE,
  ENTRY_EDGE_TYPE,
  USES_EDGE_TYPE,
} from "./types.js";

function makeGraph(): GraphLayer {
  return new GraphLayerImpl(new InMemoryBackend());
}

test("registerOverlay — idempotent on repeated construction", () => {
  const graph = makeGraph();
  const overlay = makeCapabilityUnitOverlay(graph);
  assert.doesNotThrow(() => new CapabilityUnitOverlayImpl(graph));
  assert.ok(overlay);
});

test("insertUnit — persists metadata + entry / composes / uses edges", () => {
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

  // Edges out
  const entry = graph.edgesFrom(node.id, { type: ENTRY_EDGE_TYPE, includeDangling: true });
  const composes = graph.edgesFrom(node.id, { type: COMPOSES_EDGE_TYPE, includeDangling: true });
  const uses = graph.edgesFrom(node.id, { type: USES_EDGE_TYPE, includeDangling: true });
  assert.equal(entry.length, 1);
  assert.equal(composes.length, 2);
  assert.equal(uses.length, 1);
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
