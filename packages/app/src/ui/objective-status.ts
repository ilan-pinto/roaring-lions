// packages/app/src/ui/objective-status.ts
/**
 * One word for an objective's state, in the player's language.
 *
 * I10 (final review): `ObjectiveStatus` is a sim enum -- `'active'`,
 * `'complete'`, `'failed'` -- and two places printed it straight into the DOM.
 * `ui/pause.ts` wrote `status.textContent = o.status`, so the pause menu's
 * objective list stayed English in every locale; `main.ts`'s HUD notice
 * interpolated `e.status.toUpperCase()` into `"<b>OBJECTIVE {status}</b> —
 * {label}"`, which is the same defect with a `.toUpperCase()` in front of it.
 * Both also read UNBRACKETED under `?pseudo=1`, which is what a pseudo-locale
 * pass is for.
 *
 * Two call sites, one table, and the mapping from enum to key lives here
 * rather than being spelled out twice -- an enum-to-key map written at each
 * sink is how the two drift when a fourth status arrives.
 *
 * Resolved on CALL, never at module load: a table built at import time freezes
 * in whatever locale was active before `main.ts`'s boot calls `setCatalogue`,
 * and renders plain English under `?pseudo=1` forever. That is the bug
 * `role.ts`'s `ROLE_LABEL` and `grade-copy.ts`'s tier tables were each fixed
 * for; this module is written the fixed way from the start.
 */
import type { ObjectiveStatus } from '@lions/sim';
import { t } from '../i18n/t';

/**
 * `'active'` -> "In progress", `'complete'` -> "Complete", `'failed'` ->
 * "Failed".
 *
 * The parameter is typed as the sim's own union, so a status the sim adds and
 * this file does not answer is a compile error rather than a key that renders
 * as itself at runtime.
 */
export function objectiveStatusLabel(status: ObjectiveStatus): string {
  return t(`objective.status.${status}`);
}

/**
 * The same word, for the HUD's notice feed, which shouts.
 *
 * Upper-cased through `toLocaleUpperCase` rather than `toUpperCase`: the two
 * differ for real languages (Turkish dotless i is the standard example), and
 * this string is about to be shown to a player in whichever locale the
 * catalogue is set to. `currentLocale()` is not consulted because the
 * default-locale form already follows the runtime's own locale, and a
 * pseudo-locale string has no case rules of its own worth honouring.
 */
export function objectiveStatusShout(status: ObjectiveStatus): string {
  return objectiveStatusLabel(status).toLocaleUpperCase();
}
