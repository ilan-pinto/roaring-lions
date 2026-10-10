// What a veteran's stripes DO, in the player's words (GH-417, H2: deployment
// is a decision, so its stakes are on the card).
//
// COPIED from `packages/sim/src/tuning.ts`, never imported: those constants
// are not part of `@lions/sim`'s public surface, and the app has no business
// reaching into the sim's tuning for a label. `veteran-effect.test.ts` reads
// tuning.ts as TEXT and fails the moment either number moves without this
// file being told -- the `PROJ_SPEED` precedent (CLAUDE.md, "Every shot that
// is one round").

import { t } from '../i18n/t';

/** Q16.16: effective-accuracy bonus per veterancy level (tuning.ts). */
export const VET_ACC_BONUS = 3932;
/** Q16.16: incoming-suppression reduction per veterancy level (tuning.ts). */
export const VET_SUPP_BONUS = 5243;

const pct = (q16: number, stripes: number): number => Math.round((q16 * stripes * 100) / 65536);

/** "+12% aim · −16% suppression" for two stripes; null for none. */
export function veteranEffect(stripes: number): string | null {
  if (stripes <= 0) return null;
  return t('deploy.vet.effect', { aim: pct(VET_ACC_BONUS, stripes), supp: pct(VET_SUPP_BONUS, stripes) });
}
