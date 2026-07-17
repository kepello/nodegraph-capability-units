/**
 * Public API surface for `@kepello/nodegraph-capability-units`.
 */

// Schema
export {
  CAPABILITY_UNIT_DOMAIN,
  CAPABILITY_UNIT_INDEXES,
  CAPABILITY_UNIT_METADATA_KIND,
  CAPABILITY_UNIT_METADATA_SCHEMA,
  CAPABILITY_UNIT_SCHEMA_VERSION,
} from "./schema.js";

// Types
export {
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

// Workspace-aggregate queries (L2 count + coverage)
export {
  computeL2Coverage,
  countL2Units,
  type L2CountInput,
  type L2CountResult,
  type L2CoverageInput,
  type L2CoveragePerLanguage,
  type L2CoverageResult,
} from "./queries.js";
