# Changelog

All notable changes to `@kepello/nodegraph-capability-units`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.14.0] — 2026-07-14

Fathom row `overlay-projection-discards-14-of-19-facets` (3.1.0.7) — `fathom-cli`'s abstractions runner used to hand-project each L0 element down to `id`/`name`/`contentHash`/`language`/`exported`/`methodStereotype`/`methodRole` before calling `computeCapabilityUnits`. Adds the field this row's shared facet bag lands on; `computeCapabilityUnits`/`defaultSeedSelector` are unchanged (`facets` is not read by this package).

### Added

- `ElementForSeeding.facets?: Readonly<Record<string, unknown>>` — the full L0 facet set (`@kepello/nodegraph-analysis`'s `projectElementFacets`), when the caller supplies it. Plain structural type — no new peer-dependency (same decoupling rationale as `methodStereotype`/`methodRole` above). Optional, not required: making it required would force editing every hand-built `ElementForSeeding` literal across this package's ~1,500-line test suite for a field nothing reads yet.

### Tests

Suite unchanged: 59/59 pass. `npm run build` clean.

## [0.13.0] — 2026-07-11

`defaultSeedSelector` migrated off its hand-maintained raw-stereotype admit-list onto the `@kepello/nodegraph-analysis` `methodRole` contract (`nodegraph-analysis@3.60.0`) — the raw list had been hand-patched TWICE as the stereotype vocabulary grew (once for `composition-root`, once for `non-void-command` / `collaborational-command`), the proof case for the stereotype-vocabulary-drift class. Behavior-identical today — `entry-command` is defined to cover exactly the five values the list used to enumerate by hand — and drift-proof going forward: a future stereotype addition only needs an edit to `nodegraph-analysis`'s `METHOD_ROLE` table, never this selector.

### Changed

- `defaultSeedSelector` (`src/seeding.ts`) now reads `element.methodRole === "entry-command"` (was: membership test against `{controller, command, composition-root, non-void-command, collaborational-command}`) and rejects `element.methodRole === "test-fixture"` (was: `element.methodStereotype === "test-fixture"`). The `exported === true` branch is unchanged.
- `ElementForSeeding` (`src/types-internal.ts`) gains `methodRole?: string` — the `@kepello/nodegraph-analysis` L1 method-role projection, threaded opaque (this package has no dependency on `nodegraph-analysis`). `methodStereotype?: string` stays on the type but is no longer read anywhere in this package — kept for now in case a future caller needs the raw value; flagged as a residual for the orchestrator to consider removing.

### Tests

- 10 tests in `seeding.test.ts` migrated from `methodStereotype`-keyed fixtures to `methodRole`-keyed fixtures (`entry-command` qualifies, `accessor`/`other` do not, `test-fixture` rejected with/without `exported`).
- 1 new guard test: asserts `seeding.ts` contains no raw-stereotype string-literal comparison and no `.methodStereotype` property read — fails loud if a future edit regrows a raw admit-list.
- `capability-units-stability.test.ts` fixture updated (`delta`'s seed signal is now `methodRole: "entry-command"` instead of `methodStereotype: "controller"`) to keep exercising the selector's role-based OR branch.
- RED witnessed pre-migration: `entry-command` qualification, `test-fixture`-while-exported rejection, and the raw-list guard all failed against the un-migrated selector (3 of 10 in `seeding.test.ts`). GREEN after the migration. 59/59 tests pass (was 61 — 12 stereotype-specific tests collapsed into 10 role-based tests, net include the new guard).

## [0.12.0] — 2026-07-10

`computeUnitId` migrated onto `@kepello/nodegraph-core`'s shared `shortContentHash` helper. Step 2 of Fathom row `0.3.2.f8` (identity-hash-helper-consolidation). Behavior-preserving — golden-pinned; no id change → no downstream cache concern from this package.

### Changed

- `computeUnitId` now calls `shortContentHash([entryContentHash, ...sortedOwned])` instead of hand-rolling the sha256-then-slice(0,16) assembly. Local `SHORT_HASH_LENGTH` const removed.
- Peer dependency on `@kepello/nodegraph-core` retargeted `^5.7.1` → `^5.12.0` (introduces `shortContentHash`).

### Tests

- 1 new golden-pin regression test: fixed input `computeUnitId("entry-golden-hash", ["owned-c-hash", "owned-a-hash", "owned-b-hash"])` asserts the exact pre-migration literal `6a357fa82ec62e64`. Captured green against the un-migrated code, stayed green after the migration — byte-identity confirmed. 61/61 tests pass (was 60).

## [0.11.0] — 2026-07-03

Adds — `non-void-command` and `collaborational-command` method stereotypes recognized as seeds by `defaultSeedSelector`. Closes Fathom row `3.1.1.1.9.3.r2` tail F6.

### Changed

- `defaultSeedSelector` returns true when `element.methodStereotype` is `"non-void-command"` or `"collaborational-command"` (in addition to the existing `controller` / `command` / `composition-root`). `@kepello/nodegraph-analysis`'s r2 side-effect derivation split plain `command` into these finer-grained variants — both are command-family entry points by construction, same as `command` itself.

### Tests

- 2 new regression tests: `non-void-command` qualifies, `collaborational-command` qualifies. RED witnessed pre-fix (`false !== true` on both assertions); GREEN after adding both stereotypes to the selector. 60/60 tests pass (was 58).

## [0.10.0] — 2026-05-28

Adopt the per-overlay schema-version stamp (Fathom row 1.12.3). Exports `CAPABILITY_UNIT_SCHEMA_VERSION` (= 1, V1 baseline) and declares it on the overlay's `OverlayRegistration`.

### Changed

- Registration now passes the mandatory `schemaVersion` field added in substrate 1.12.2. Peer dependency on `@kepello/nodegraph-core` retargeted to `^3.0.0`. No behavior change beyond the version stamp.

## [0.9.0] — 2026-05-25

Batch UUID→Node hydration in `unitForEntry` + `unitsThatUse`. Part of Fathom row `perf-getbyid-consumer-migrations` (5.0.1.2.3.1). Peer-bump `@kepello/nodegraph-core` `^2.2.0` → `^2.3.0`. No behavior change.

### Changed

- `unitForEntry`: per-edge `getNodeById` loop → one `getNodesByIds([...edges.sourceId])` IN-clause query + Map lookup.
- `unitsThatUse`: union of `edgesTo` + `queryEdges` results dedupes source-ids, then batches; pre-fix did one SQL per edge.

### Tests

All existing tests pass; no behavior change.

## [0.8.0] — 2026-05-23

L2 closure walker reads `overrides` edges. P3 of Fathom row `l2-overrides-edge-first-class` (3.1.2.1).

### Added

- `ComputeCapabilityUnitsInput.overridesByTarget?: ReadonlyMap<string, readonly string[]>` — inverse-indexed map from interface/abstract method id to its impl method ids. During BFS, when the walker visits element E, it now enqueues both forward `calls` targets AND any entries in `overridesByTarget.get(E)`.

### Why

P1 + P2 land the `overrides` edge type + analyzer emission. P3 makes the L2 closure walker actually descend through dispatch: visiting an interface method I.M expands the closure to include all impls that override I.M. Closes the ~70% of L2-Gate-3 residual unreachable elements (Pattern A) traced on 2026-05-23.

### Direction

Substrate stores `overrides: C.M → I.M` (child → parent). The walker needs the inverse direction for BFS — `overridesByTarget` is that inverse map, precomputed by callers. `fathom-cli/runAbstractions` builds it via `graph.queryEdges({ type: "overrides" })` + `groupBy(targetId)`.

### Tests

6 new tests in `overrides-closure.test.ts`: single-impl, multi-impl, transitive expansion, no-map backward compat, empty-map equivalence, multi-seed `used`-vs-`owned` semantics. 58/58 tests pass (52 prior + 6 new).

### Strict-ownership preserved

The override expansion plays cleanly with the existing strict-ownership semantics. An impl method reached from two seeds via interface-method dispatch is `used`, not `owned` — same logic as if it were reached via direct `calls` edges.

## [0.7.0] — 2026-05-23

Adds — optional `sampleUnreachable` param to `computeL2Coverage` for walking the residual unreachables when coverage plateaus.

### Added

- `L2CoverageInput.sampleUnreachable?: number` — when set, the result includes a `sampleUnreachable: string[]` listing up to N naturalKeys of body-bearing elements NOT visible via any unit's entry / owned / used sets. Cap controls the sample size; selection is deterministic (insertion-order of the substrate's queryNodes iteration).

### Why

Surfaced 2026-05-23 during the L2 Gate 3 walkthrough. The 5.3.3 ship intentionally trimmed the prior debug `unreachableBreakdown` field (it was investigation debt), but the residual walk needs identities. This is the principled re-add: explicit opt-in, capped sample size, permanent tooling for future "what's still uncovered" investigations.

### Tests

- 52/52 tests pass (no behavior change in the no-opt case; opt-in just adds a side-output).

## [0.6.0] — 2026-05-22

New public query surface — `countL2Units` + `computeL2Coverage`. Closes Fathom row `l2-coverage-restructuring` (5.3.3).

### Added

- `src/queries.ts` exports two pure aggregate functions:
  - `countL2Units({ overlay, language? })` — total + per-language unit count.
  - `computeL2Coverage({ overlay, graph, methodStereotype, language? })` — fraction of body-bearing callables visible as entry / owned / used across the union of capability units.
- `src/coverage.test.ts` — 9 algorithm-level tests covering: two-unit baseline, language filter, empty-overlay invariant, stale-UUID resolution after element supersede, Cat 1a strict + conservative, Cat 1b strict + conservative.

### Why

The aggregate algorithms originally shipped in `fathom-mcp@2.15.0/2.15.1` were inlined inside the MCP tool handler in `fathom-mcp/src/phase-3/capability-units.ts` — wrong layer, since:

1. CLI / future-API consumers can't reach them without invoking MCP.
2. Algorithm tests had to build a `HandlerRecorder` MCP stub to exercise pure-function logic.
3. The thin-wrapper pattern other `code.*` tools follow (`nodegraph-analysis/src/code-queries.ts` ↔ `nodegraph-analysis-mcp/src/tools.ts`) was violated.

The relocation also implements two denominator exclusions surfaced by the L2-TS Gate 3 investigation ([.agents/plans/l2-ts-baseline-2026-05-21.md](../../.agents/plans/l2-ts-baseline-2026-05-21.md) §M3):

- **Cat 1a — `hasBody === false`** (structural). Body-less interface methods emit no `calls` / `callsMethod` edges and cannot be capability-unit members. Strict equality: missing/undefined `hasBody` INCLUDES the element so analyzers at basic conformance don't silently shrink the denominator.
- **Cat 1b — `methodStereotype === "test-fixture"`** (policy). Mirrors the L2 seed-side exclusion shipped in `@kepello/nodegraph-capability-units@0.3.0` (Fathom 5.0.23). Drift-proof because it reads the unified L1 stereotype primitive (5.0.34) rather than a path regex. Strict equality: null/undefined stereotype INCLUDES.

The `methodStereotype` lookup is a caller-supplied callback (analysis-agnostic package). `fathom-mcp` wires it from substrate `metadata.memoizedDerivations.methodStereotype` (populated by the L1 cascade during `analyzeRepo`).

### Expected impact

On the Fathom workspace 2026-05-21 snapshot:

| step | denominator | unreachable | TS coverage |
|--|--|--|--|
| Before (2.15.1) | 1,297 | 611 | 52.89% |
| After Cat 1a (`hasBody` filter) | 1,155 | 469 | 59.4% |
| After Cat 1b (`test-fixture` filter) | **929** | **243** | **73.9%** |

The 243 residual unreachable are real Category 2 gaps (private helpers, dynamic dispatch, framework-implicit calls) — filed separately.

### Tests

- 9 new tests in `coverage.test.ts`. 52/52 tests pass (43 prior + 9 new).

## [0.5.0] — 2026-05-21

Tests — substrate-persistence stability probe (L2-TS gate 4). Closes Fathom row 5.3.1.

### Added

- `src/capability-units-stability.test.ts` — three tests pinning the full L2 pipeline (`computeCapabilityUnits` → `insertUnit`) byte-stability across re-runs:
  - Two-run: same input → same persisted state (metadata + composes/uses targets).
  - Three-run variant: belt-and-suspenders against even/odd-flip non-determinism.
  - `ownedElementIds` + `usedElementIds` sort contract pinned at the compute level.

### Why

L2-TS baseline 2026-05-21 ([.agents/plans/l2-ts-baseline-2026-05-21.md](../../.agents/plans/l2-ts-baseline-2026-05-21.md)) gate 4 — re-running `fathom analyze` against unchanged source MUST produce identical `unitId` + closures for every unit. The closure algorithm is a pure function (`closure.test.ts` already pins determinism on the input/output level), but the full pipeline (insert into substrate, re-read via overlay) was unpinned. This test closes that gap at the persistence layer so a future change that introduces ordering drift in `membersOf` / `usedBy` or in the overlay's edge-emit path breaks the build.

Mirrors the pattern shipped for L1 gate 4 in `nodegraph-analysis@2.26.1` (`stereotype-stability.test.ts`, Fathom 5.1.2).

### Tests

- 3 new tests in `capability-units-stability.test.ts`. 43/43 tests pass (40 pre-existing + 3 new).

## [0.4.0] — 2026-05-18

(filling — earlier entry was the 0.3.0 ship; the 0.4.0 line documenting the ghost-cluster fix lives in the workspace changelog 5.0.22 entry — package was bumped without an inline note.)

## [0.3.0] — 2026-05-19

Bug fix — `defaultSeedSelector` rejects `methodStereotype === "test-fixture"` even when `exported === true`. Closes Fathom row 5.0.23. TDD-driven.

### Changed

- `defaultSeedSelector` short-circuits to `false` when the element's `methodStereotype` is `"test-fixture"`. Previously, a top-level function in a test file (`.test.ts`, `/tests/`, `/fixtures/`, etc.) would get `exported: true` from the analyzer's normal exported-symbol detection and qualify as a seed, but the L3 clusterer excludes those same paths (5.0.14 / 5.0.28 c) — so the resulting L2 capability unit's entry had no cluster mapping and L5 scenario-walk produced empty steps for every edge.

### Why

Row 5.0.23 originally framed the problem as "L5 derivation runs but emits empty scenarios" — investigation showed the L5 algorithm walks cross-cluster call edges correctly (13 unit tests pin its correctness). Substrate probe on the Fathom workspace: 22 of 804 scenarios produced steps; the 782 empty ones were all units whose entry was a top-level function in a test file. The fix lives in the L2 seed boundary, not the L5 algorithm — and uses the unified `test-fixture` L1 stereotype primitive shipped in 5.0.34. Pattern: any layer needing fixture exclusion reads the same single signal.

### Tests

- 2 new regression tests: `test-fixture` stereotype is rejected with `exported: true` AND without. 40/40 tests pass.

## [0.2.0] — 2026-05-18

Adds — `composition-root` method stereotype recognized as a seed by `defaultSeedSelector`. Closes Fathom row 5.0.29.

### Changed

- `defaultSeedSelector` returns true when `element.methodStereotype === "composition-root"` (in addition to the existing `controller` / `command`). Composition roots are externally-callable entry points by definition (the L1 `composition-root` stereotype fires on small linear bodies wiring many cross-class collaborators — `composeFathomMcp`, `defineMemoizedDerivation`, etc.).
- Round-5 pilot F15 surfaced `composeFathomMcp` returning null from `code.capability_unit_for(...)` despite being a `library-export` composition-root. The L2 surface now correctly seeds on it.

### Tests

- 38/38 tests pass; 1 new regression test for composition-root seed.

## [0.1.0] — 2026-05-14

Initial publish. Second layer of the workspace Layered Code Abstraction arc (Fathom work row `l2-capability-unit-overlay` 3.1.2, per `docs/code_abstraction.md` L2).

### Added

- `CAPABILITY_UNIT_DOMAIN` + `CAPABILITY_UNIT_METADATA_SCHEMA` + indexes (`units_by_entry`, `units_by_closure_hash`, `units_by_language`).
- `CapabilityUnitMetadata`, `CapabilityUnitInput`, `CapabilityUnitNode`, `CapabilityUnitOverlay` interfaces.
- `makeCapabilityUnitOverlay(graph)` factory — registers the domain + indexes against a `GraphLayer` and returns the overlay with `insertUnit` / `tombstoneUnit` writes and `listUnits` / `getUnit` / `unitForEntry` / `unitsThatUse` / `membersOf` / `usedBy` reads.
- `computeCapabilityUnits({ elements, callEdges, seedSelector? })` — pure algorithm. Identifies seeds via the selector, computes forward call-graph reachability per seed, applies strict-ownership boundary (an element is `owned` only when 100% of its callers are reachable from one seed; otherwise `used` by every seed that reaches it).
- `defaultSeedSelector(element)` — hybrid: `exported === true` OR `methodStereotype ∈ {controller, command}`. Per the L2 row's seed-identification design.
- `computeUnitId(entryContentHash, sortedOwnedHashes)` — stable content-hash identity helper.

### Trade-offs (v1 — documented limitations)

- **Strict-ownership boundary excludes shared utilities from unit body** — they appear as `uses` edges, not absorbed. Units that lean on shared helpers look small at their owned core; intentional design choice.
- **Dynamic dispatch treated as direct calls** — wire protocol doesn't yet surface dispatch kind. Real branching-marker support lands when Fathom `l2-virtual-dispatch-protocol-extension` (3.1.2.1) ships.
- **Cross-language calls absent from L0 graph** → capability units stay per-language until workspace-level link records exist (Fathom `l2-cross-language-edges` 3.1.2.3).
- **Operator-configured seeds not yet supported** — `defaultSeedSelector` is the only built-in; consumers wanting framework-aware seeds (HTTP route handlers, decorator-marked commands) pass a custom selector. Operator-config-driven path is parked as Fathom `l2-operator-configured-seeds` (3.1.2.2).

### Schema-versioning note

Registers without `schemaVersion` because `nodegraph-core@1.1.1` doesn't yet enforce the field. Will declare `schemaVersion: 1` when Fathom row `overlay-version-and-migration-substrate` (1.12.2) ships. Same posture as `nodegraph-clusters` and `nodegraph-domain-model`.
