/**
 * Puts the Nemala medic team in a versus room, IN MEMORY (GH-707, the lead, 30 Oct 2026). The shipped data holds it out
 * of versus (`VERSUS_HELD_UNITS`, and it is on no doctrine menu), so the rescue path -- build at a KDF camp, a rescue
 * order from a frame, the camp as drop-off, the probe's rescue arm and the snapshot witness's rescue world -- is
 * exercised by this harness and never by the shipped menu. Nothing is written to disk. Not for app code.
 */
import { doctrines } from '@lions/data';
import { VERSUS_HELD_UNITS } from './versus-roster';

const MEDIC = 'inf_medic_squad';

/** Enters the medic room and returns the function that leaves it. Re-entrant: a second call is a no-op that returns a no-op. */
export function enterMedicRoom(): () => void {
  const held = VERSUS_HELD_UNITS as Set<string>;
  const menu = doctrines.kdf.menu as string[];
  const wasHeld = held.has(MEDIC);
  const wasOnMenu = menu.includes(MEDIC);
  if (!wasHeld && wasOnMenu) return () => {};
  held.delete(MEDIC);
  if (!wasOnMenu) menu.push(MEDIC);
  return () => {
    if (wasHeld) held.add(MEDIC);
    if (!wasOnMenu) menu.splice(menu.indexOf(MEDIC), 1);
  };
}

/** Runs `fn` with the medic team in a room, then puts the shipped state back. */
export function withMedicInRoom<T>(fn: () => T): T {
  const leave = enterMedicRoom();
  try {
    return fn();
  } finally {
    leave();
  }
}
