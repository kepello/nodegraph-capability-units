/**
 * Public API surface for `@kepello/nodegraph-capability-units`.
 */

// Schema
export {
  CAPABILITY_UNIT_DOMAIN,
  CAPABILITY_UNIT_INDEXES,
  CAPABILITY_UNIT_METADATA_KIND,
  CAPABILITY_UNIT_METADATA_SCHEMA,
} from "./schema.js";

// Types
export {
  COMPOSES_EDGE_TYPE,
  ENTRY_EDGE_TYPE,
  USES_EDGE_TYPE,
  type CapabilityUnitInput,
  type CapabilityUnitMetadata,
  type CapabilityUnitNode,
  type CapabilityUnitOverlay,
} from "./types.js";

// Internal data shapes (re-exported for consumers wiring the pipeline)
export type {
  CallEdge,
  ElementForSeeding,
} from "./types-internal.js";

// Identity
export { computeUnitId } from "./identity.js";

// Seeding
export {
  defaultSeedSelector,
  type SeedSelector,
} from "./seeding.js";

// Closure algorithm
export {
  computeCapabilityUnits,
  type ComputeCapabilityUnitsInput,
  type ComputeCapabilityUnitsResult,
  type ComputedUnit,
} from "./closure.js";

// Overlay
export {
  CapabilityUnitOverlayImpl,
  makeCapabilityUnitOverlay,
} from "./overlay.js";
