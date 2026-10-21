// `&works` (GH-277): the sandbox has no mission, and a field work is raised through a
// `MissionRuntime` (price, count, builders, refund). So the flag builds a runtime over a
// mission that exists only for that: a single objective nothing in a session reaches, a
// purse, and every buildable KDF type on offer twice. The flag never touches a real mission,
// and the runtime is held apart from the battlefield's own `runtime`, so no mission-only path
// (the strip, the end screen, the debrief, the ledger) wakes up for it.

import type { MissionJson } from '@lions/sim';

/** The logistics a `&works` sandbox starts with: enough for every offer twice over. */
export const SANDBOX_WORKS_LOGISTICS = 5000;

/** What the flag needs of a structure type: its id and whether it can be raised in the field. */
export interface WorksCatalogueEntry {
  id: string;
  buildable: unknown | null;
}

/** The KDF works the player owns by default (`owner` 0) and may build: id prefix `kdf_`. */
export function sandboxWorksMission(
  types: readonly WorksCatalogueEntry[],
  /** The builders, spawned by the runtime itself: it only counts units it placed as the player's. */
  builders: readonly { unit: string; at: readonly [number, number] }[]
): MissionJson {
  const fieldWorks: Record<string, number> = {};
  for (const t of types) if (t.buildable !== null && t.id.startsWith('kdf_')) fieldWorks[t.id] = 2;
  return {
    id: 'sandbox_works',
    name: 'Field works',
    map: { file: 'sandbox' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'stand', type: 'survive_until', primary: true, seconds: 86400 }],
    starting_force: builders.map((b) => ({ unit: b.unit, count: 1, at: b.at })),
    resources: { logistics_start: SANDBOX_WORKS_LOGISTICS, intel_start: 0 },
    field_works: fieldWorks,
  } as MissionJson;
}
