/**
 * Capability-unit identity computation. `unitId = sha256(entry.contentHash
 * || '\n' || sorted owned contentHashes joined by '\n')`. The hash is
 * short (16 hex chars = 64 bits) — collisions remain astronomically
 * unlikely for in-workspace cardinality.
 *
 * Stability properties:
 *
 *   - Renaming an owned element (different elementId, same contentHash)
 *     → identical unitId. Identity tracks behavior, not labels.
 *   - Editing the entry body → different contentHash → different unitId.
 *     The unit's behavior changed; the new identity reflects that.
 *   - Adding/removing an owned helper → different unitId. Same.
 *   - Empty owned set (entry only, no helpers) → still hashes the entry
 *     contentHash — singleton units are first-class.
 */

import { shortContentHash } from "@kepello/nodegraph-core";

/**
 * Compute a stable `unitId` from the entry's contentHash plus an
 * iterable of owned contentHashes. Empty owned set is fine — the
 * entry alone produces a stable hash for singleton units.
 */
export function computeUnitId(
  entryContentHash: string,
  ownedContentHashes: Iterable<string>,
): string {
  const sortedOwned = [...ownedContentHashes].sort();
  return shortContentHash([entryContentHash, ...sortedOwned]);
}
