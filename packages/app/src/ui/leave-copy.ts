// K-13: what the leave / quit confirm says. A mission costs the attempt and
// leaves the campaign as it was; a free-play run has no campaign attempt
// to lose, so "the campaign keeps everything" meant nothing there. One source
// for the HUD's leave button and the pause menu's Quit, which ask the
// identical question.
import { t } from '../i18n/t';
import { routes } from '../shell/links';

export interface LeaveCopy {
  /** The leave button's tooltip. */
  tip: string;
  title: string;
  body: string;
  confirm: string;
}

export function leaveCopy(freePlay: boolean): LeaveCopy {
  return freePlay
    ? {
        tip: t('hud.leave.title.sandbox'),
        title: t('hud.leave.confirm.title.sandbox'),
        body: t('hud.leave.confirm.body.sandbox'),
        confirm: t('hud.leave.confirm.action'),
      }
    : {
        tip: t('hud.leave.title'),
        title: t('hud.leave.confirm.title'),
        body: t('hud.leave.confirm.body'),
        confirm: t('hud.leave.confirm.action'),
      };
}

/**
 * Where a confirmed leave lands (PA-25). A mission goes back to the campaign
 * map it came from; a free-play run was started from the picker, so it goes
 * back to the picker -- dropping a player who was choosing a map onto the war
 * board read as being thrown out of the mode. The HUD's leave button and the
 * pause menu's Quit both ask `main.ts` for this, so the two cannot land on
 * different screens.
 */
export function leaveHref(freePlay: boolean): string {
  return freePlay ? routes.freePlay() : routes.campaign();
}
