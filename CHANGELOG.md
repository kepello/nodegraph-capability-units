# Changelog

All notable changes to `@kepello/nodegraph-capability-units`. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
