/**
 * GH-1394 slice 2: the words of the campaign posture, in one place, so the board's chip, the deploy line and the refused resume
 * name a posture the same way. Literal keys only (one `switch` per table), so the i18n gate sees every one, and nothing is
 * resolved at module load (CLAUDE.md, "Never resolve a label table at module load").
 */
import type { PostureId } from '@lions/data';
import { t } from '../i18n/t';

/** "Easier", "Standard", "Harder" (slice 1's keys, ruling D1). */
export function postureLabel(id: PostureId): string {
  switch (id) {
    case 'easier': return t('difficulty.easier.label');
    case 'standard': return t('difficulty.standard.label');
    case 'harder': return t('difficulty.harder.label');
  }
}

/** What the posture does to a mission, in full (slice 1's keys): the rows of the picker. */
export function postureBlurb(id: PostureId): string {
  switch (id) {
    case 'easier': return t('difficulty.easier.blurb');
    case 'standard': return t('difficulty.standard.blurb');
    case 'harder': return t('difficulty.harder.blurb');
  }
}

/** What the posture does to the grade and the pay, short: the line beside the chosen posture wherever the player chooses it.
 *  Easier's says it caps at two stars and pays no carry credits (ruling 3). */
export function postureNote(id: PostureId): string {
  switch (id) {
    case 'easier': return t('difficulty.note.easier');
    case 'standard': return t('difficulty.note.standard');
    case 'harder': return t('difficulty.note.harder');
  }
}
