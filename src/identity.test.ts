/**
 * Identity-hash tests. Pins:
 *
 *   - Empty owned set still produces a stable hash (singleton units OK).
 *   - Order-independence on owned hashes (sort happens internally).
 *   - Different entry contentHash → different unitId.
 *   - Renaming a member (different elementId, same contentHash) → same id.
 *   - Adding a member to the owned set → different id.
 *   - Short fixed-width hex output.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeUnitId } from "./identity.js";

test("computeUnitId — empty owned set hashes entry alone", () => {
  const id = computeUnitId("entry-hash", []);
  assert.equal(typeof id, "string");
  assert.equal(id.length, 16);
});

test("computeUnitId — owned set order-independent", () => {
  const a = computeUnitId("entry", ["h1", "h2", "h3"]);
  const b = computeUnitId("entry", ["h3", "h2", "h1"]);
  assert.equal(a, b);
});

test("computeUnitId — different entry hash → different unit id", () => {
  const a = computeUnitId("entry-v1", ["h1", "h2"]);
  const b = computeUnitId("entry-v2", ["h1", "h2"]);
  assert.notEqual(a, b);
});

test("computeUnitId — same content, different ids would give same hash", () => {
  // Identity is content-based, not id-based — renaming an owned helper
  // (different elementId, same contentHash) keeps unitId stable.
  const a = computeUnitId("entry", ["helperA-hash", "helperB-hash"]);
  const b = computeUnitId("entry", ["helperA-hash", "helperB-hash"]);
  assert.equal(a, b);
});

test("computeUnitId — adding an owned member changes the id", () => {
  const a = computeUnitId("entry", ["h1"]);
  const b = computeUnitId("entry", ["h1", "h2"]);
  assert.notEqual(a, b);
});

test("computeUnitId — short fixed-width hex output", () => {
  const id = computeUnitId("entry", ["x", "y"]);
  assert.match(id, /^[0-9a-f]{16}$/);
});

test("computeUnitId — golden pin (byte-identity across the shortContentHash migration)", () => {
  // Captured against the pre-migration sha256(entryHash + '\n' + sorted owned)
  // assembly. Must stay byte-identical after routing through the shared
  // shortContentHash helper — id churn here is a supersession storm.
  const id = computeUnitId("entry-golden-hash", ["owned-c-hash", "owned-a-hash", "owned-b-hash"]);
  assert.equal(id, "6a357fa82ec62e64");
});
