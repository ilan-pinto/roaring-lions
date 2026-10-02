// The one mapping from a KDF unit's authored `unlock` field names to the
// sim's `UnlockGate`. Moved out of `main.ts` (GH-317) so a spec can prove a
// coin-bought unit opens on every surface that reads this gate -- the garage,
// the reinforcement dock (`unitInfo`) and `resolveUpgrades` -- without
// booting the app.
import type { units } from '@lions/data';
import type { UnlockGate } from '@lions/sim';

/** A KDF unit JSON entry's `unlock` gate, mapped from the authored
 *  `roe_rating_min`/`stars_min`/`after_mission`/`price` field names to `UnlockGate` --
 *  the one mapping `unitInfo`, `kdfUnits` and `resolveUpgrades`'s lookup all share.
 *  `bought` is resolved here and nowhere else (spec §4.4) -- a purchase opens the
 *  unit on every surface that reads this gate by construction. */
export function kdfUnlockGate(u: (typeof units)[keyof typeof units], bought: ReadonlySet<string>): UnlockGate | undefined {
  const unlock = 'unlock' in u
    ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number })
    : undefined;
  if (!unlock) return undefined;
  return {
    roeMin: unlock.roe_rating_min,
    starsMin: unlock.stars_min,
    afterMission: unlock.after_mission,
    price: unlock.price,
    bought: bought.has(u.id),
  };
}
