/**
 * The words of save and resume (GH-1393 slice 2). Every string is a catalogue key; a refusal CODE (`older_version`, `world_mismatch`...) is an
 * internal id and never reaches the screen (`player-wording.test.ts`'s rule, the same one `withdrawn` is held to). One function per place
 * the words appear, so the pause menu, the campaign board and the boot say the same thing.
 */
import type { ResumeRefusal } from '../mission-save';
import type { WriteResult } from '../mission-save-store';
import type { MovedWhat, PostureShift } from '../mission-resume';
import { t } from '../i18n/t';
import { postureLabel } from './posture-copy';

export type SaveFailure = 'encode_failed' | 'too_large' | Exclude<WriteResult, { ok: true }>['reason'];

/** Why Save and quit did not save, in words. The three storage reasons are one sentence: what to do about them is the same. */
export function saveFailureText(reason: SaveFailure): string {
  switch (reason) {
    case 'too_large': return t('save.err.too_large');
    case 'encode_failed': return t('save.err.encode_failed');
    case 'no_storage':
    case 'refused':
    case 'unverified': return t('save.err.storage');
  }
}

/** Why a stored save will not be loaded, in words. The record is kept; the card offers Discard. */
/** `moved` is found at the boot, not on load: the live campaign is no longer the one the mission was started from. */
export function resumeRefusalText(reason: ResumeRefusal | 'moved', moved: readonly MovedWhat[] = [], posture?: PostureShift): string {
  switch (reason) {
    case 'moved': return movedText(moved, posture);
    case 'older_version': return t('resume.refused.older');
    case 'mission_unknown': return t('resume.refused.mission');
    case 'damaged': return t('resume.refused.damaged');
    case 'world_mismatch': return t('resume.refused.damaged');
    case 'unreadable': return t('resume.refused.unreadable');
  }
}

/** Literal keys, so the i18n gate sees every one. */
function movedWord(m: MovedWhat): string {
  switch (m) {
    case 'ledger': return t('resume.moved.ledger');
    case 'units': return t('resume.moved.units');
    case 'upgrades': return t('resume.moved.upgrades');
    case 'posture': return t('resume.moved.posture');
  }
}

/** What changed in the campaign since the save, in words ("your campaign progress has changed, a unit was bought"). With nothing named, the plain sentence.
 *  A posture change ALONE has its own sentence (GH-1394 slice 2, ruling 6): it names both postures and says how to get the save back, since setting
 *  the posture back is all it takes. */
export function movedText(moved: readonly MovedWhat[], posture?: PostureShift): string {
  if (moved.length === 0) return t('resume.refused.moved');
  if (posture !== undefined && moved.length === 1 && moved[0] === 'posture') {
    return t('resume.refused.posture', { was: postureLabel(posture.was), now: postureLabel(posture.now) });
  }
  return t('resume.refused.moved.named', { what: moved.map(movedWord).join(t('resume.moved.join')) });
}

/** "just now", "14 minutes ago", "3 hours ago", "2 days ago". */
export function savedAgo(savedAt: number, now: number): string {
  const min = Math.max(0, Math.floor((now - savedAt) / 60_000));
  if (min < 1) return t('resume.ago.now');
  if (min < 60) return t('resume.ago.minutes', { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 48) return t('resume.ago.hours', { n: hours });
  return t('resume.ago.days', { n: Math.floor(hours / 24) });
}
