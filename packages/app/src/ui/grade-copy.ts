import { t } from '../i18n/t';

/** A tier's closing line: who says it, and what. Index by stars (1-3; 0 has neither). */
export interface TierLine {
  speaker: 'shai' | 'idit';
  text: string;
}

/**
 * The tier names and their closing lines (spec 2026-09-10 §4.1, decided by the lead). Fixed
 * here so no screen rewrites them; the debrief resolves `speaker` to a plate and portrait
 * the same way the commander bar does. Index by stars; 0 has neither.
 *
 * Functions, not the arrays this module shipped with first -- those called `t()` once, at
 * MODULE LOAD, and froze the result. The pseudo pass caught the identical shape wrong in
 * `role.ts`'s `ROLE_LABEL` (fix round 1): `main.ts`'s boot sets the active catalogue,
 * `?pseudo=1` included, well after every module's top-level code has already run, so a
 * value resolved at import time can never see a locale picked after it. `tierName`/`tierLine`
 * call `t()` on every access instead, which is what lets `main.ts`'s own `TIER_LINES[stars]`
 * become `tierLine(stars)` -- same call site, now reactive -- with no other change there.
 */
export function tierName(stars: number): string {
  switch (stars) {
    case 1:
      return t('grade.tier.1');
    case 2:
      return t('grade.tier.2');
    case 3:
      return t('grade.tier.3');
    default:
      return '';
  }
}

export function tierLine(stars: number): TierLine | null {
  switch (stars) {
    case 1:
      return { speaker: 'shai', text: t('grade.tier.1.line') };
    case 2:
      return { speaker: 'idit', text: t('grade.tier.2.line') };
    case 3:
      return { speaker: 'shai', text: t('grade.tier.3.line') };
    default:
      return null;
  }
}
