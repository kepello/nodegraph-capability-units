/**
 * L2 query surface — workspace-aggregate functions over the
 * capability-unit overlay. Pure functions; no MCP transport. Thin
 * wrappers in `fathom-mcp/src/phase-3/capability-units.ts` call these.
 *
 * Shipped 0.6.0 (Fathom row `l2-coverage-restructuring`, 5.3.3) when
 * the algorithm moved out of the MCP tool handler — `fathom-mcp@2.15.0`
 * had inlined ~150 LOC of denominator-building + closure-walking +
 * naturalKey-resolution inside the handler, which violated the
 * thin-wrapper pattern other `code.*` tools follow. The relocation also
 * implements two denominator exclusions:
 *   - Cat 1a — `hasBody === false` (structural; body-less interface
 *     methods cannot be capability-unit members).
 *   - Cat 1b — `methodStereotype === "test-fixture"` (policy; mirrors
 *     the L2 seed-side exclusion shipped in 5.0.23).
 */

import type { GraphLayer } from "@kepello/nodegraph-core";
import type { CapabilityUnitOverlay } from "./types.js";

const BODY_BEARING_KINDS: ReadonlySet<string> = new Set([
  "method",
  "function",
  "constructor",
  "accessor",
  "operator",
]);

export interface L2CountInput {
  overlay: CapabilityUnitOverlay;
  /** Filter to units whose seed has this language (e.g., `typescript`). */
  language?: string;
}

export interface L2CountResult {
  total: number;
  byLanguage: Record<string, number>;
}

/**
 * Workspace-aggregate count of capability units. Pre-baked alternative
 * to enumerating via `overlay.listUnits()` when the only consumer need
 * is "how many" + per-language breakdown (e.g., `code.list_capability_units`
 * caps at 500 entries; workspaces with >500 units can't derive counts
 * by enumeration).
 */
export function countL2Units(input: L2CountInput): L2CountResult {
  let total = 0;
  const byLanguage: Record<string, number> = {};
  for (const u of input.overlay.listUnits()) {
    const lang = u.metadata.language ?? "unknown";
    if (input.language !== undefined && lang !== input.language) continue;
    total += 1;
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }
  return { total, byLanguage };
}

export interface L2CoverageInput {
  overlay: CapabilityUnitOverlay;
  graph: GraphLayer;
  /**
   * L1 stereotype lookup keyed by substrate node id (UUID). Returns
   * the element's `methodStereotype` (e.g., `"controller"`,
   * `"test-fixture"`) or `null` when no rule fired. Caller wires this
   * from analysis state — the L2 package is analysis-agnostic by design.
   */
  methodStereotype: (elementId: string) => string | null;
  /**
   * Filter to elements whose `metadata.language` matches. Restricts both
   * numerator (units' entries / owned / used) and denominator
   * (body-bearing callable population).
   */
  language?: string;
  /**
   * When set, the result includes a `sampleUnreachable` field listing
   * up to N naturalKeys of body-bearing elements that are NOT visible
   * via any unit (entry / owned / used). Useful for walking the
   * residual unreachables when the coverage number plateaus. Cap N
   * keeps the response shape stable across very-large workspaces.
   */
  sampleUnreachable?: number;
}

export interface L2CoveragePerLanguage {
  total: number;
  visible: number;
  coveragePercent: number;
}

export interface L2CoverageResult {
  totalBodyBearingCallables: number;
  l2VisibleElementCount: number;
  coveragePercent: number;
  byLanguage: Record<string, L2CoveragePerLanguage>;
  /**
   * Sample of unreachable element naturalKeys. Present only when the
   * caller sets `input.sampleUnreachable` > 0. Cap controls the
   * sample size; selection is deterministic (insertion order of the
   * `liveNaturalKeys` set, which mirrors the substrate's queryNodes
   * iteration order).
   */
  sampleUnreachable?: string[];
}

/**
 * Fraction of body-bearing callables (method / function / constructor /
 * accessor / operator) that appear in some capability unit as entry,
 * owned, or used. High coverage = the L2 surface explains the
 * workspace's behavior; gaps surface elements unreachable from any
 * seed (private helpers, dead code, framework-implicit calls).
 *
 * Denominator exclusions (shipped as part of `l2-coverage-restructuring`):
 *   - Cat 1a — `hasBody === false` (strict equality; missing facet
 *     INCLUDES the element so analyzers at basic conformance don't
 *     silently inflate coverage).
 *   - Cat 1b — `methodStereotype === "test-fixture"` (strict equality;
 *     null stereotype INCLUDES the element).
 */
export function computeL2Coverage(input: L2CoverageInput): L2CoverageResult {
  const allElements = input.graph.queryNodes({
    domain: "analysis",
    lifecycleState: "live",
  });

  // Build the live-naturalKey set of body-bearing callables that pass
  // Cat 1a / Cat 1b / language filters. naturalKey rather than UUID:
  // unit metadata can hold stale UUIDs from prior re-analyzes whose
  // contentHash matched (the overlay's idempotent insert path leaves
  // the entryElementId untouched); naturalKey is content-stable.
  const liveNaturalKeys = new Set<string>();
  const elementsByNk = new Map<string, { language?: string }>();
  for (const node of allElements) {
    const meta = node.metadata as {
      elementKind?: string;
      language?: string;
      hasBody?: boolean;
    } | null;
    const kind = meta?.elementKind;
    if (kind === undefined || !BODY_BEARING_KINDS.has(kind)) continue;
    // Cat 1a — strict equality; undefined hasBody falls through.
    if (meta?.hasBody === false) continue;
    // Cat 1b — strict equality; null stereotype falls through.
    if (input.methodStereotype(node.id) === "test-fixture") continue;
    const nk = node.naturalKey;
    if (nk === null || nk === undefined || nk === "") continue;
    if (input.language !== undefined && meta?.language !== input.language) continue;
    liveNaturalKeys.add(nk);
    elementsByNk.set(nk, { language: meta?.language });
  }

  // Resolve a stored element-reference (UUID or already-naturalKey form)
  // to a naturalKey. `getNodeById` walks tombstoned nodes too, so stale
  // UUIDs from prior re-analyzes resolve through to the current natural
  // key when the underlying content is unchanged.
  const resolveToNaturalKey = (stored: string): string | undefined => {
    if (liveNaturalKeys.has(stored)) return stored;
    const node = input.graph.getNodeById(stored);
    const nk = node?.naturalKey;
    if (nk !== null && nk !== undefined && nk !== "") return nk;
    return undefined;
  };

  const visibleNaturalKeys = new Set<string>();
  for (const u of input.overlay.listUnits()) {
    if (input.language !== undefined && u.metadata.language !== input.language) continue;
    const entry = u.metadata.entryElementId;
    if (entry !== undefined) {
      const nk = resolveToNaturalKey(entry);
      if (nk !== undefined) visibleNaturalKeys.add(nk);
    }
    for (const e of input.overlay.membersOf(u.metadata.unitId)) {
      const stored = e.targetId ?? e.targetRef;
      if (stored === null || stored === undefined) continue;
      const nk = resolveToNaturalKey(stored);
      if (nk !== undefined) visibleNaturalKeys.add(nk);
    }
    for (const e of input.overlay.usedBy(u.metadata.unitId)) {
      const stored = e.targetId ?? e.targetRef;
      if (stored === null || stored === undefined) continue;
      const nk = resolveToNaturalKey(stored);
      if (nk !== undefined) visibleNaturalKeys.add(nk);
    }
  }

  let totalBodyBearingCallables = 0;
  let l2VisibleElementCount = 0;
  const perLang: Record<string, { total: number; visible: number }> = {};
  const sampleCap = input.sampleUnreachable ?? 0;
  const unreachableSample: string[] = [];
  for (const nk of liveNaturalKeys) {
    const meta = elementsByNk.get(nk);
    const lang = meta?.language ?? "unknown";
    totalBodyBearingCallables += 1;
    const visible = visibleNaturalKeys.has(nk);
    if (visible) l2VisibleElementCount += 1;
    if (perLang[lang] === undefined) perLang[lang] = { total: 0, visible: 0 };
    perLang[lang].total += 1;
    if (visible) perLang[lang].visible += 1;
    if (!visible && sampleCap > 0 && unreachableSample.length < sampleCap) {
      unreachableSample.push(nk);
    }
  }

  const byLanguage: Record<string, L2CoveragePerLanguage> = {};
  for (const [k, v] of Object.entries(perLang)) {
    byLanguage[k] = {
      total: v.total,
      visible: v.visible,
      coveragePercent: pct(v.visible, v.total),
    };
  }

  const result: L2CoverageResult = {
    totalBodyBearingCallables,
    l2VisibleElementCount,
    coveragePercent: pct(l2VisibleElementCount, totalBodyBearingCallables),
    byLanguage,
  };
  if (sampleCap > 0) result.sampleUnreachable = unreachableSample;
  return result;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((100 * numerator) / denominator * 100) / 100;
}
