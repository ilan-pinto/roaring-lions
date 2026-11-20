// `&works` (GH-277): the sandbox has no mission, and a field work is raised through a
// `MissionRuntime` (price, count, builders, refund). So the flag builds a runtime over a
// mission that exists only for that: a single objective nothing in a session reaches, a
// purse, and every buildable KDF type on offer twice. The flag never touches a real mission,
// and the runtime is held apart from the battlefield's own `runtime`, so no mission-only path
// (the strip, the end screen, the debrief, the ledger) wakes up for it.

import type { MissionJson, Sim } from '@lions/sim';
import type { SandboxAnchors } from './sandbox-anchors';
import { SANDBOX_WORKS_KDF } from './sandbox-force';
import { openTileFor } from './sandbox-place';

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

/**
 * The `&works` builders, each on the tile the sandbox's own placer (`openTileFor`, `sandbox-place.ts`) would stand
 * it on: its `SANDBOX_WORKS_KDF` offset from the friendly anchor, or the nearest tile open on its own mask and not
 * already taken. The runtime spawns them and refuses a blocked tile outright, and an offset knows nothing of the
 * ground: on Bir Tarsha, Bir Tarsha 2 and Umm Zeitoun the raw offset is a wall, and Free play failed to start with
 * the works on (their default). Call it AFTER the sandbox force stands, so a builder does not take a body's tile.
 */
export function sandboxWorksBuilders(
  sim: Sim,
  typeOf: Map<string, number>,
  anchors: SandboxAnchors
): { unit: string; at: [number, number] }[] {
  const tileFor = openTileFor(sim, typeOf);
  const [ax, ay] = anchors.friendly;
  return SANDBOX_WORKS_KDF.map(([unit, dx, dy]) => ({ unit, at: tileFor(unit, ax + dx, ay + dy) }));
}

/**
 * The structure type ids a boot may draw as a field work, for `meshPlanFor`'s `extraStructures`:
 * the mission's own `field_works` keys, or on a `&works` sandbox (no mission) every type the
 * sandbox offers. A work raised mid-mission is on no map tile, so without these ids its GLB is
 * never planned and it draws the procedural box.
 */
export function worksTypeIdsFor(
  missionFieldWorks: Readonly<Record<string, number>> | undefined,
  sandboxTypes: readonly WorksCatalogueEntry[] | null
): string[] {
  if (sandboxTypes !== null) return Object.keys(sandboxWorksMission(sandboxTypes, []).field_works ?? {});
  return Object.keys(missionFieldWorks ?? {});
}
