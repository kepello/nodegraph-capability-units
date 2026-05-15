/**
 * Capability-unit overlay domain + IndexSpecs + JSON Schema.
 * Registered against the substrate at overlay construction time.
 * Mirrors the cluster overlay shape — same registration pattern.
 */

import type { IndexSpec, MetadataSchema } from "@kepello/nodegraph-core";

export const CAPABILITY_UNIT_DOMAIN = "capability-unit";

export const CAPABILITY_UNIT_METADATA_KIND = "capability-unit";

export const CAPABILITY_UNIT_METADATA_SCHEMA: MetadataSchema = {
  type: "object",
  title: "Recovered capability unit",
  description:
    "An entry-rooted closure: a public seed plus its strictly-owned helpers. Edges out: `entry` → seed element; `composes` → owned closure members; `uses` → elements called by the closure but not owned by it.",
  required: ["kind", "unitId", "entryElementId", "name", "ownedCount"],
  properties: {
    kind: {
      type: "string",
      enum: ["capability-unit"],
      title: "Discriminator",
      description: "Always 'capability-unit' for nodes this overlay writes.",
    },
    unitId: {
      type: "string",
      title: "Stable unit id",
      description:
        "Content-hash identity. `hash(entry.contentHash || sorted owned contentHashes joined by \\n)`. Stable under member rename when contentHashes don't change; changes when owned set changes or entry body changes.",
    },
    entryElementId: {
      type: "string",
      title: "Entry element id",
      description: "The seed (public method / handler) that roots this unit.",
    },
    entryName: {
      type: "string",
      title: "Entry element name",
      description: "Local name of the entry element. Used as the unit's display name.",
    },
    name: {
      type: "string",
      title: "Unit name",
      description:
        "Auto-generated label. v1: derived from `entryName`. Operator-overrideable via `displayName`.",
    },
    displayName: {
      type: "string",
      title: "Operator-supplied display name",
      description:
        "Optional override that takes precedence over `name` in renders. Operator sets via `.fathom/fathom.config.json` `capabilityUnits.rename` or future MCP tool.",
    },
    language: {
      type: "string",
      title: "Language",
      description:
        "Source language. Set when entry + all owned members share the same language; absent for mixed-language closures (not produced in v1 — units stay per-language).",
    },
    ownedCount: {
      type: "number",
      title: "Owned member count",
      description:
        "Number of L0 elements the unit owns (in `composes`). Does not include the entry itself.",
    },
    usedCount: {
      type: "number",
      title: "Used (shared) member count",
      description:
        "Number of L0 elements the unit's closure reaches but does not own.",
    },
  },
};

export const CAPABILITY_UNIT_INDEXES: IndexSpec[] = [
  {
    name: "units_by_unit_id",
    fields: ["metadata.unitId"],
    scope: {
      domain: CAPABILITY_UNIT_DOMAIN,
      lifecycleState: "live",
      nonNull: ["metadata.unitId"],
    },
    unique: true,
  },
  {
    name: "units_by_entry",
    fields: ["metadata.entryElementId"],
    scope: {
      domain: CAPABILITY_UNIT_DOMAIN,
      lifecycleState: "live",
      nonNull: ["metadata.entryElementId"],
    },
  },
  {
    name: "units_by_language",
    fields: ["metadata.language"],
    scope: {
      domain: CAPABILITY_UNIT_DOMAIN,
      lifecycleState: "live",
      nonNull: ["metadata.language"],
    },
  },
];
