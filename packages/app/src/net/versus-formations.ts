/**
 * Formations in versus rooms (GH-859 P1a, the lead's ruling of 29 Oct): OFF until S4 passed; opened 1 Nov on the maps S4 covered, on Wadi Tarfan once its Sarim lean was settled (GH-945), and on Rujm Sawda and Milh Flats (large) once each passed its own S4 run (3 Nov, GH-913).
 *
 * Formations ship in single-player. While the gate is closed (or the map is in `VERSUS_FORMATIONS_CLOSED_MAPS`) a versus room never sends a `formation` on a `move` or `attackMove`
 * (the sender strip in `roomOrderSink`), never applies one (the receiver gate in `seatWorldFor`), and the
 * HUD formation row shows inactive with `FORMATION_VERSUS_REASON_KEY`. The sim still registers the shipped
 * formations in every room (`match-world.ts`) and the content digest still folds them, so nothing here
 * moves a hash or a digest: this file decides only what the app ASKS for and ALLOWS.
 *
 * ONE predicate, three consumers. Do not re-derive "are formations open here" anywhere else.
 */
import { versusRules } from '@lions/data';
import { economyRoom, type MatchConfig } from '@lions/net';

/** OPEN (the lead, 1 Nov, GH-859): S4 passed clean (0 TRIP of 27 cells, tunnels A+B pooled, 192 seeds paired with each cell's own baseline) on Beit Sahwan, Tel Marum and Milh Flats with the shipped Attack (aircraft left out, `legs: false`), and again on Wadi Tarfan
 *  (0 TRIP of 21 cells, GH-945) once its seats and tunnel capacities were re-measured. On 3 Nov the same S4 was run on the three large maps, on seeds 30000-30383 that no choice had seen: Rujm Sawda and Milh Flats (large) passed
 *  (mirror cell, 0 TRIP of 3) and opened; Wadi Tarfan (large) tripped one of 21 cells (placed, both ends, Sarim friendly: KDF leads 60.4% pooled against a 56.5% base) and stays closed
 *  through `VERSUS_FORMATIONS_CLOSED_MAPS`. A formation amplifies a base lean 2.5 to 5 times (GH-945), so a map's base is level before it is offered with formations.
 *  Closing it again is this one constant. */
export const VERSUS_FORMATIONS_OPEN = true;

/** Versus maps formations stay OFF on even with the gate open: a map that has not passed its own S4 run. Wadi Tarfan (large) is one
 *  (GH-913 L8 / GH-920, the lead's ruling): one trip in 21 cells on 3 Nov. Tel Marum (large) is closed from birth (GH-920 B3), until its own S4 run. Wadi Tarfan itself was closed the same way until GH-945 re-seated it;
 *  Rujm Sawda and Milh Flats (large) left on 3 Nov. When a map passes its own run, DELETE its entry.
 *  `wadi_tarfan_l.test.ts` pins the Wadi Tarfan (large) entry and `versus-formations.test.ts` the predicate, with the gate open. */
export const VERSUS_FORMATIONS_CLOSED_MAPS: readonly string[] = ['wadi_tarfan_l', 'tel_marum_l'];

/** The HUD row's reason line when formations are inactive in a versus room (a `t()` key). */
export const FORMATION_VERSUS_REASON_KEY = 'hud.formation.inert.versus';

/** The three kinds of versus room, as a map's rules file names them (`formations_closed_in`): a same-faction room, a KDF-v-Sarim win-mode
 *  room (two placed forces, no economy) and a KDF-v-Sarim room on the skirmish economy. */
export type VersusRoomKind = 'mirror' | 'placed' | 'economy';

/** Which kind of versus room a config is, or `undefined` for a room that is not a versus room (single player, the sandbox). */
export function roomKindOf(config: Pick<MatchConfig, 'mode' | 'seats' | 'winMode'> | null | undefined): VersusRoomKind | undefined {
  if (config === null || config === undefined || config.mode !== 'versus') return undefined;
  if (economyRoom(config)) return 'economy';
  return config.seats[0].faction === config.seats[1].faction ? 'mirror' : 'placed';
}

/** Whether a map's rules file closes formations in rooms of this kind (GH-859, the lead's ruling of 5 Nov: open, except a Tel Marum
 *  economy room). Data, not a list of ids here: `formations_closed_in` in `data/versus/<map>.json`. A map with no rules file closes nothing. */
export function formationsClosedByRules(map: string | null | undefined, kind: VersusRoomKind | undefined): boolean {
  if (map === undefined || map === null || kind === undefined) return false;
  const rules = (versusRules as Readonly<Record<string, { readonly formations_closed_in?: readonly VersusRoomKind[] } | undefined>>)[map];
  return rules?.formations_closed_in?.includes(kind) === true;
}

/** Whether formations are open in a room of this mode. A versus room follows the gate, and is closed on a map
 *  in `VERSUS_FORMATIONS_CLOSED_MAPS` whatever the gate says, and in a room whose KIND its map's rules file closes
 *  (`formations_closed_in`); anything else (single-player has no mode, the sandbox room) is open. `versusOpen` is injectable so a
 *  test can witness the open path (P1b's) without editing the constant; production callers leave it at the default.
 *  `map` is the room's (`config.map`) and `kind` its `roomKindOf(config)`: a caller that leaves `kind` out gets today's answer for
 *  the map alone, so every production caller passes both. */
export function formationsOpenIn(mode: 'versus' | 'sandbox' | undefined | null, versusOpen: boolean = VERSUS_FORMATIONS_OPEN, map?: string | null, kind?: VersusRoomKind): boolean {
  if (mode !== 'versus') return true;
  if (!versusOpen) return false;
  if (map !== undefined && map !== null && VERSUS_FORMATIONS_CLOSED_MAPS.includes(map)) return false;
  return !formationsClosedByRules(map, kind);
}
