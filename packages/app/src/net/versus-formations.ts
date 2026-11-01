/**
 * Formations in versus rooms (GH-859 P1a, the lead's ruling of 29 Oct): OFF until S4 passed; opened 1 Nov on the maps S4 covered.
 *
 * Formations ship in single-player. While the gate is closed (or the map is in `VERSUS_FORMATIONS_CLOSED_MAPS`) a versus room never sends a `formation` on a `move` or `attackMove`
 * (the sender strip in `roomOrderSink`), never applies one (the receiver gate in `seatWorldFor`), and the
 * HUD formation row shows inactive with `FORMATION_VERSUS_REASON_KEY`. The sim still registers the shipped
 * formations in every room (`match-world.ts`) and the content digest still folds them, so nothing here
 * moves a hash or a digest: this file decides only what the app ASKS for and ALLOWS.
 *
 * ONE predicate, three consumers. Do not re-derive "are formations open here" anywhere else.
 */

/** OPEN (the lead, 1 Nov, GH-859): S4 passed clean (0 TRIP of 27 cells, tunnels A+B pooled, 192 seeds paired with each cell's own
 *  baseline) on Beit Sahwan, Tel Marum and Milh Flats with the shipped Attack (aircraft left out, `legs: false`). Wadi Tarfan and
 *  Rujm Sawda stay closed through `VERSUS_FORMATIONS_CLOSED_MAPS`. Closing it again is this one constant. */
export const VERSUS_FORMATIONS_OPEN = true;

/** Versus maps formations stay OFF on even after P1b opens the gate. Rujm Sawda (GH-913 L8, the lead's ruling) is outside the S4
 *  check, which was run on the other maps' cells, and stays so until it passes its own run. Wadi Tarfan (the lead, 1 Nov, GH-859)
 *  is closed the same way: S4 is judged without it until its Sarim lean is settled, which is GH-561, not the formations work.
 *  When a map passes its own run, DELETE its entry. `rujm_sawda.test.ts` pins the Rujm entry and `versus-formations.test.ts`
 *  the predicate, with the gate open. */
export const VERSUS_FORMATIONS_CLOSED_MAPS: readonly string[] = ['rujm_sawda', 'wadi_tarfan'];

/** The HUD row's reason line when formations are inactive in a versus room (a `t()` key). */
export const FORMATION_VERSUS_REASON_KEY = 'hud.formation.inert.versus';

/** Whether formations are open in a room of this mode. A versus room follows the gate, and is closed on a map
 *  in `VERSUS_FORMATIONS_CLOSED_MAPS` whatever the gate says; anything else (single-player has no mode, the
 *  sandbox room) is open. `versusOpen` is injectable so a test can witness the open path (P1b's) without
 *  editing the constant; production callers leave it at the default. `map` is the room's (`config.map`). */
export function formationsOpenIn(mode: 'versus' | 'sandbox' | undefined | null, versusOpen: boolean = VERSUS_FORMATIONS_OPEN, map?: string | null): boolean {
  if (mode !== 'versus') return true;
  return versusOpen && !(map !== undefined && map !== null && VERSUS_FORMATIONS_CLOSED_MAPS.includes(map));
}
