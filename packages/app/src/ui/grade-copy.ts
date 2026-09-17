import { t } from '../i18n/t';

/** The tier names and their closing lines (spec 2026-09-10 §4.1, decided by the lead). Fixed
 *  here so no screen rewrites them; the debrief resolves `speaker` to a plate and portrait
 *  the same way the commander bar does. Index by stars; 0 has neither.
 *
 *  Read through `t()` at MODULE load, not per-render: this module has a non-screen
 *  consumer (`main.ts`'s `TIER_LINES[runtime.stars]`, out of this batch's scope) that
 *  expects a plain array, not a function. `t.ts`'s module state defaults to the bundled
 *  `en` catalogue before any async boot code runs, so this resolves correctly for the
 *  only locale shipped today; it will not pick up a `?pseudo=1`/later-locale switch that
 *  happens after this module is first imported, which is a known limitation until
 *  `main.ts`'s own callers move to a lazy accessor (Task 11 territory). */
export const TIER_NAMES = ['', t('grade.tier.1'), t('grade.tier.2'), t('grade.tier.3')] as const;

export const TIER_LINES = [
  null,
  { speaker: 'shai', text: t('grade.tier.1.line') },
  { speaker: 'idit', text: t('grade.tier.2.line') },
  { speaker: 'shai', text: t('grade.tier.3.line') },
] as const;
