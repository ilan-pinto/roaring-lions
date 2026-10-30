/**
 * Formations in versus rooms (GH-859 P1a, the lead's ruling of 29 Oct): OFF until P1b.
 *
 * Formations ship in single-player. A versus room never sends a `formation` on a `move` or `attackMove`
 * (the sender strip in `roomOrderSink`), never applies one (the receiver gate in `seatWorldFor`), and the
 * HUD formation row shows inactive with `FORMATION_VERSUS_REASON_KEY`. The sim still registers the shipped
 * formations in every room (`match-world.ts`) and the content digest still folds them, so nothing here
 * moves a hash or a digest: this file decides only what the app ASKS for and ALLOWS.
 *
 * ONE predicate, three consumers. Do not re-derive "are formations open here" anywhere else.
 */

/** P1b flips this, gated on the S4 check per cell against its own baseline at >= 192 seeds. */
export const VERSUS_FORMATIONS_OPEN = false;

/** The HUD row's reason line when formations are inactive in a versus room (a `t()` key). */
export const FORMATION_VERSUS_REASON_KEY = 'hud.formation.inert.versus';

/** Whether formations are open in a room of this mode. A versus room follows the gate; anything else
 *  (single-player has no mode, the sandbox room) is open. `versusOpen` is injectable so a test can witness
 *  the open path (P1b's) without editing the constant; production callers leave it at the default. */
export function formationsOpenIn(mode: 'versus' | 'sandbox' | undefined | null, versusOpen: boolean = VERSUS_FORMATIONS_OPEN): boolean {
  return mode === 'versus' ? versusOpen : true;
}
