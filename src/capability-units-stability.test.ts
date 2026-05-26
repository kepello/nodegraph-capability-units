/**
 * capability-units-stability — pins Fathom row 5.3.1 (L2-TS gate 4). The
 * full L2 pipeline (compute → insert → re-read) MUST produce byte-identical
 * persisted state across re-runs with unchanged input. The closure
 * algorithm is a pure function (see closure.test.ts determinism); this
 * test extends the invariant to the substrate-persistence layer so a
 * future change introducing non-determinism (Map iteration order leak,
 * Date.now in the algorithm, edge-emission ordering drift) breaks the
 * build at the full-pipeline level.
 *
 * Mirrors `stereotype-stability.test.ts` (5.1.2, L1-TS gate 4).
 *
 * Coverage:
 *   - Two-run variant: compute + insert twice → identical substrate state.
 *   - Three-run variant: belt-and-suspenders against even/odd flip
 *     non-determinism.
 *   - Snapshot includes unit metadata + composes / uses edge target sets
 *     (sorted) — the persisted shape consumers read via `listUnits` /
 *     `membersOf` / `usedBy`.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GraphLayerImpl } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import { computeCapabilityUnits } from "./closure.js";
import { makeCapabilityUnitOverlay } from "./overlay.js";
import type { CallEdge, ElementForSeeding } from "./types-internal.js";
import type { CapabilityUnitMetadata } from "./types.js";

/**
 * Rule 8 coverage — fixture exercises every closure shape that the L2
 * pipeline emits on real workspaces:
 *
 *   - Single seed + owned helper (alpha → privateOne).
 *   - Two seeds + shared helper (alpha + beta → shared).
 *   - Seed with empty closure (gamma — no outgoing edges).
 *   - Seed reachable through a chain (delta → mid → leaf — mid + leaf
 *     are owned).
 *   - Cycle in the call graph (cycleA → cycleB → cycleA — BFS visited-set
 *     handles it; closure must be deterministic).
 *   - Mixed languages: alpha = typescript, beta = swift — language field
 *     uniformity check.
 *
 * Stereotype-driven seeds (controller / command / composition-root) also
 * fire via the default selector — `delta` gets methodStereotype=controller
 * without being exported, ensuring the selector's OR branch is exercised.
 */
function fixture(): { elements: ElementForSeeding[]; callEdges: CallEdge[] } {
  const elements: ElementForSeeding[] = [
    { id: "alpha", name: "alpha", contentHash: "ch-alpha", exported: true, language: "typescript" },
    { id: "beta", name: "beta", contentHash: "ch-beta", exported: true, language: "swift" },
    { id: "gamma", name: "gamma", contentHash: "ch-gamma", exported: true, language: "typescript" },
    { id: "delta", name: "delta", contentHash: "ch-delta", methodStereotype: "controller", language: "typescript" },
    { id: "privateOne", name: "privateOne", contentHash: "ch-private-one", language: "typescript" },
    { id: "shared", name: "shared", contentHash: "ch-shared", language: "typescript" },
    { id: "mid", name: "mid", contentHash: "ch-mid", language: "typescript" },
    { id: "leaf", name: "leaf", contentHash: "ch-leaf", language: "typescript" },
    { id: "cycleA", name: "cycleA", contentHash: "ch-cycle-a", exported: true, language: "typescript" },
    { id: "cycleB", name: "cycleB", contentHash: "ch-cycle-b", language: "typescript" },
  ];
  const callEdges: CallEdge[] = [
    { source: "alpha", target: "privateOne" },
    { source: "alpha", target: "shared" },
    { source: "beta", target: "shared" },
    { source: "delta", target: "mid" },
    { source: "mid", target: "leaf" },
    { source: "cycleA", target: "cycleB" },
    { source: "cycleB", target: "cycleA" },
  ];
  return { elements, callEdges };
}

interface UnitSnapshot {
  metadata: CapabilityUnitMetadata;
  composesTargets: string[];
  usesTargets: string[];
}

/**
 * Build the persisted-state snapshot. Iterates `listUnits` in unitId
 * order (the substrate's natural-key index) so the output map's iteration
 * order is the same across runs; each unit's composes / uses target lists
 * are sorted for set-equality semantics.
 */
function snapshot(overlay: ReturnType<typeof makeCapabilityUnitOverlay>): Map<string, UnitSnapshot> {
  const out = new Map<string, UnitSnapshot>();
  const sorted = [...overlay.listUnits()].sort((a, b) =>
    a.metadata.unitId.localeCompare(b.metadata.unitId),
  );
  for (const node of sorted) {
    const composes = overlay.membersOf(node.metadata.unitId)
      .map((e) => e.targetId ?? e.targetRef ?? "")
      .sort();
    const uses = overlay.usedBy(node.metadata.unitId)
      .map((e) => e.targetId ?? e.targetRef ?? "")
      .sort();
    out.set(node.metadata.unitId, {
      metadata: node.metadata,
      composesTargets: composes,
      usesTargets: uses,
    });
  }
  return out;
}

/** Run the full L2 pipeline (compute + insert) into a fresh overlay; return the snapshot. */
function runPipeline(): Map<string, UnitSnapshot> {
  const graph = new GraphLayerImpl(new InMemoryBackend());
  const overlay = makeCapabilityUnitOverlay(graph);
  const { units } = computeCapabilityUnits(fixture());
  for (const u of units) {
    overlay.insertUnit({
      unitId: u.unitId,
      entryElementId: u.entryElementId,
      entryName: u.entryName,
      name: u.entryName,
      contentHash: u.contentHash,
      ownedElementIds: u.ownedElementIds,
      usedElementIds: u.usedElementIds,
      ...(u.language !== undefined ? { language: u.language } : {}),
    });
  }
  return snapshot(overlay);
}

function diff(a: Map<string, UnitSnapshot>, b: Map<string, UnitSnapshot>): string[] {
  const out: string[] = [];
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const av = a.get(k);
    const bv = b.get(k);
    if (av === undefined) { out.push(`only in B: ${k}`); continue; }
    if (bv === undefined) { out.push(`only in A: ${k}`); continue; }
    // Metadata equality
    if (JSON.stringify(av.metadata) !== JSON.stringify(bv.metadata)) {
      out.push(`${k}: metadata diverged\n  A: ${JSON.stringify(av.metadata)}\n  B: ${JSON.stringify(bv.metadata)}`);
    }
    // composes target sets
    if (JSON.stringify(av.composesTargets) !== JSON.stringify(bv.composesTargets)) {
      out.push(`${k}: composesTargets diverged: ${JSON.stringify(av.composesTargets)} vs ${JSON.stringify(bv.composesTargets)}`);
    }
    // uses target sets
    if (JSON.stringify(av.usesTargets) !== JSON.stringify(bv.usesTargets)) {
      out.push(`${k}: usesTargets diverged: ${JSON.stringify(av.usesTargets)} vs ${JSON.stringify(bv.usesTargets)}`);
    }
  }
  return out;
}

test("capability-unit stability — two pipeline runs produce identical persisted state (Fathom 5.3.1)", () => {
  const snap1 = runPipeline();
  const snap2 = runPipeline();
  const drift = diff(snap1, snap2);
  assert.equal(
    drift.length,
    0,
    `expected zero L2 drift across re-runs, got:\n${drift.join("\n")}`,
  );
});

test("capability-unit stability — three-run variant (Fathom 5.3.1)", () => {
  // Belt-and-suspenders against even/odd-flip non-determinism — a single
  // failing comparison could be paper-thin luck.
  const snap1 = runPipeline();
  const snap2 = runPipeline();
  const snap3 = runPipeline();
  assert.equal(diff(snap1, snap2).length, 0, "r1 vs r2 drift");
  assert.equal(diff(snap2, snap3).length, 0, "r2 vs r3 drift");
  assert.equal(diff(snap1, snap3).length, 0, "r1 vs r3 drift");
});

test("capability-unit stability — ownedElementIds + usedElementIds are sorted within each unit (Fathom 5.3.1)", () => {
  // The closure walker MUST produce sorted output for stability — if it
  // emits in BFS-discovery order, two runs could trivially differ when
  // Map iteration changes. This pins the contract at the compute level.
  const { units } = computeCapabilityUnits(fixture());
  for (const u of units) {
    const ownedCopy = [...u.ownedElementIds];
    const usedCopy = [...u.usedElementIds];
    assert.deepEqual(
      u.ownedElementIds,
      ownedCopy.sort(),
      `ownedElementIds not sorted for unit ${u.entryName}: ${JSON.stringify(u.ownedElementIds)}`,
    );
    assert.deepEqual(
      u.usedElementIds,
      usedCopy.sort(),
      `usedElementIds not sorted for unit ${u.entryName}: ${JSON.stringify(u.usedElementIds)}`,
    );
  }
});
