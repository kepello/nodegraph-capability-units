# Changelog

All notable changes to `@kepello/nodegraph-capability-units`. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
