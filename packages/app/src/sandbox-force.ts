/**
 * The sandbox task force, as offsets from the map's own anchors.
 *
 * These four tables used to sit in `main.ts` beside `sandboxSpawns`, which
 * reads them. They moved here when mesh loading became roster-driven: the
 * loader needs to know which unit types a sandbox will place BEFORE the
 * renderer exists, and the one thing that must not happen is a second list of
 * sandbox units maintained by hand next to the first. `sandboxUnitTypes`
 * derives its answer from the same four arrays `sandboxSpawns` iterates, so a
 * unit added to the sandbox and missing from the mesh plan is not expressible
 * rather than merely tested for.
 *
 * `sandboxSpawns` itself stayed in `main.ts`: it needs `Sim`, `fx` and the
 * open-tile spiral, none of which this file should grow a dependency on.
 */

/** One placement: unit type id, then dx/dy from the anchor. */
export type SandboxPlacement = readonly [string, number, number];

/** The task force, as offsets from the friendly anchor. */
export const SANDBOX_KDF: readonly SandboxPlacement[] = [
  ['mbt_lavi', 0, -3],
  ['mbt_lavi', 0, 3],
  ['ifv_namer', -1, -7],
  ['ifv_namer', -1, 7],
  ['apc_eitan', -2, 0],
  ['inf_squad', 2, -5],
  ['inf_squad', 2, 0],
  ['inf_squad', 2, 5],
  ['at_team', 1, -2],
  ['mortar_team', -2, 2],
  ['jeep_shoded', 1, 3],
  ['recon_drone', 4, 0],
  // The D9 and the Apache both sit behind the line of contact, for different
  // reasons: the D9 is slow and unarmed, so sending it forward would just feed
  // it to the militia before it has done any work. The Apache is fast enough
  // to reach the front on its own, so holding it back gives the player a beat
  // to notice their most powerful asset before committing it.
  ['dozer_d9', -1, -3],
  ['heli_peten', 2, 8],
];

/** The opposition, as offsets from the hostile anchor. */
export const SANDBOX_ENEMY: readonly SandboxPlacement[] = [
  ['militia_cell', -4, -10],
  ['militia_cell', 2, -7],
  ['militia_cell', -2, 3],
  ['militia_cell', -6, 15],
  ['rpg_team', -4, 2],
  ['rpg_team', -12, -3],
  ['atgm_cell', 7, 0],
  ['technical', 11, -8],
  ['technical', 11, 10],
  ['mortar_crew', 13, 2],
  // The raider set. The sandbox is the only place these appear — no mission
  // places them yet — so this is what makes their art reachable in play at
  // all, and what the art was verified against. They sit inside the band
  // rather than beyond it: a hostile draws no sprite until a friendly unit
  // sees its tile, so anything parked past the opposition is invisible for
  // the whole opening, and scouting it with the drone does not work either
  // since the gun truck kills the drone before the fog lifts.
  ['gun_truck', 1, -5],
  ['charge_squad', 0, -2],
  ['loiter_drone', -1, 0],
  ['moto_rpg', -5, 6],
  ['paramotor', 2, 7],
];

/** The Sarim roster (`&sur`), as offsets from the hostile anchor. `atgm_cell`
 *  and `loiter_drone` are already in the base set, so only the four the
 *  sandbox could not otherwise reach are here. No mission fields any of them
 *  yet. */
export const SANDBOX_SUR: readonly SandboxPlacement[] = [
  ['sarim_rifles', -3, -4],
  ['sarim_rifles', -3, 4],
  ['recoilless_team', 3, -3],
  ['manpad_team', 5, 4],
  ['rocket_battery', 9, 1],
];

/** What `&tunnel` adds to the player's side: something that can find a route,
 *  and something that can bring it down. The base force already carries a
 *  `recon_drone`, which marks tunnels — the yahalom is what makes the charge
 *  cursor reachable at all. */
export const SANDBOX_TUNNEL_KDF: readonly SandboxPlacement[] = [
  ['yahalom_squad', 3, -1],
  ['yahalom_squad', 3, 1],
];

/**
 * Every unit type a sandbox will place, for the same flags `sandboxSpawns`
 * gets. The mesh loader's roster for `?sandbox=<map>`, and the reason these
 * tables live in their own module: it reads the arrays that place the units
 * rather than a copy of what they contain.
 */
export function sandboxUnitTypes(extras: { tunnel: boolean; sur: boolean }): Set<string> {
  const out = new Set<string>();
  for (const [id] of SANDBOX_KDF) out.add(id);
  for (const [id] of SANDBOX_ENEMY) out.add(id);
  if (extras.tunnel) for (const [id] of SANDBOX_TUNNEL_KDF) out.add(id);
  if (extras.sur) for (const [id] of SANDBOX_SUR) out.add(id);
  return out;
}
