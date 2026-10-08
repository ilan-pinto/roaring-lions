// K-13: what the leave / quit confirm says. A mission costs the attempt and
// leaves the campaign as it was; a free-play run has no campaign attempt
// to lose, so "the campaign keeps everything" meant nothing there. One source
// for the HUD's leave button and the pause menu's Quit, which ask the
// identical question.
import { t } from '../i18n/t';

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
