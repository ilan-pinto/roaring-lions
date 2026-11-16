/**
 * The words of save and resume (GH-1393 slice 2). Every string is a catalogue key; a refusal CODE (`older_version`, `world_mismatch`...) is an
 * internal id and never reaches the screen (`player-wording.test.ts`'s rule, the same one `withdrawn` is held to). One function per place
 * the words appear, so the pause menu, the campaign board and the boot say the same thing.
 */
import type { ResumeRefusal } from '../mission-save';
import type { WriteResult } from '../mission-save-store';
import type { MovedWhat } from '../mission-resume';
import { t } from '../i18n/t';

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
export function resumeRefusalText(reason: ResumeRefusal | 'moved', moved: readonly MovedWhat[] = []): string {
  switch (reason) {
    case 'moved': return movedText(moved);
    case 'older_version': return t('resume.refused.older');
    case 'mission_unknown': return t('resume.refused.mission');
    case 'damaged': return t('resume.refused.damaged');
    case 'world_mismatch': return t('resume.refused.damaged');
    case 'unreadable': return t('resume.refused.unreadable');
  }
}

/** What changed in the campaign since the save, in words ("another mission was completed, a unit was bought"). With nothing named, the plain sentence. */
export function movedText(moved: readonly MovedWhat[]): string {
  if (moved.length === 0) return t('resume.refused.moved');
  const part = (m: MovedWhat): string => (m === 'ledger' ? t('resume.moved.ledger') : m === 'units' ? t('resume.moved.units') : t('resume.moved.upgrades'));
  return t('resume.refused.moved.named', { what: moved.map(part).join(t('resume.moved.join')) });
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
