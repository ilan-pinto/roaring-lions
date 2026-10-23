/**
 * GH-707 P2: the wound half of a roster entry's service record -- men of the squad who went
 * down wounded, and men who walked back in after treatment. Both are optional on the entry
 * (absent = 0, so every earlier save reads unchanged), and the line is empty until either is
 * non-zero, so a body that never saw a wound shows exactly the record it always showed.
 */
import { t } from '../i18n/t';

export interface WoundRecord {
  readonly wounded_in_action?: number;
  readonly rescued?: number;
}

/** "3 men wounded · 2 rescued", or '' when neither count is above zero. */
export function woundRecordText(entry: WoundRecord | undefined): string {
  const hurt = entry?.wounded_in_action ?? 0;
  const saved = entry?.rescued ?? 0;
  if (hurt <= 0 && saved <= 0) return '';
  return t('hud.card.recordWounds', { hurt, saved });
}
