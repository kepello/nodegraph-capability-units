# @kepello/nodegraph-capability-units

Recovered capability-unit overlay for [`@kepello/nodegraph`](https://github.com/kepello/nodegraph-core). Second layer of the Layered Code Abstraction arc (L2 in [Fathom's roadmap](https://github.com/kepello/Fathom/blob/main/docs/code_abstraction.md#l2--capability-units-entry-rooted-closures)).

Each capability unit is an entry-rooted closure: a public seed (HTTP route handler, CLI command, exported method, controller-/command-stereotype method) plus the transitive set of private helpers it owns. **Strict-ownership boundary** — an element joins a unit's closure only when 100% of its callers are reachable from the same seed. Shared helpers surface as `uses` edges rather than being absorbed.

## Quick start

```ts
import { GraphLayerImpl } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import {
  computeCapabilityUnits,
  defaultSeedSelector,
  makeCapabilityUnitOverlay,
} from "@kepello/nodegraph-capability-units";

const graph = new GraphLayerImpl(new InMemoryBackend());
const overlay = makeCapabilityUnitOverlay(graph);

const result = computeCapabilityUnits({
  elements: [
    { id: "createUser", name: "createUser", contentHash: "h1", exported: true },
    { id: "validate", name: "validate", contentHash: "h2" },
    { id: "persist", name: "persist", contentHash: "h3" },
  ],
  callEdges: [
    { source: "createUser", target: "validate" },
    { source: "createUser", target: "persist" },
  ],
  seedSelector: defaultSeedSelector,
});

for (const unit of result.units) {
  overlay.insertUnit(unit);
}
```

## Surface

- `computeCapabilityUnits({ elements, callEdges, seedSelector? })` — pure algorithm: identifies seeds (default: `exported` ∪ `controller`/`command` stereotypes), computes forward reachability per seed, applies strict-ownership boundary, emits one `ComputedUnit` per seed.
- `defaultSeedSelector(element)` — the hybrid heuristic. Pass a custom callback to override.
- `computeUnitId(entryContentHash, sortedOwnedHashes)` — stable content-hash identity helper.
- `makeCapabilityUnitOverlay(graph)` — registers the `"capability-unit"` domain + indexes; exposes write / read API (`insertUnit`, `listUnits`, `getUnit`, `unitForEntry`, `unitsThatUse`).

## Trade-offs

- Strict-ownership excludes shared utilities from the unit body — they appear as `uses` edges. Capability units that lean heavily on shared helpers look small at their owned core; this is by design.
- Dynamic dispatch (virtual / interface targets) treated as direct calls in v1 — the wire protocol doesn't yet surface dispatch kind. Real branching-marker support lands when Fathom `l2-virtual-dispatch-protocol-extension` (3.1.2.1) ships.
- Cross-language calls are not in the L0 graph, so capability units stay per-language until workspace-level link records exist (Fathom `l2-cross-language-edges` 3.1.2.3).
