import { afterEach, describe, expect, it } from 'vitest';
import type { ObjectiveStatus } from '@lions/sim';
import en from '../i18n/en.json';
import { setCatalogue } from '../i18n/t';
import { objectiveStatusLabel, objectiveStatusShout } from './objective-status';

const ALL: readonly ObjectiveStatus[] = ['active', 'complete', 'failed'];

afterEach(() => {
  setCatalogue('en', en);
});

describe('objectiveStatusLabel', () => {
  // I10's falsification, and the one that matters: before this, both sinks
  // printed the sim's own enum word. Asserting "not the enum" is what catches a
  // regression to `o.status` -- asserting the English text alone would not, if
  // someone happened to name a status 'Complete'.
  it('answers every ObjectiveStatus with catalogue text, never the enum word itself', () => {
    for (const s of ALL) {
      const label = objectiveStatusLabel(s);
      expect(label).not.toBe(s);
      expect(label.length).toBeGreaterThan(0);
      // A key that resolved to itself is what `t()` returns for a MISSING key,
      // so this is the vacuity guard: every one of the three is really in
      // `en.json`.
      expect(label).not.toBe(`objective.status.${s}`);
    }
    expect(new Set(ALL.map(objectiveStatusLabel)).size).toBe(3); // three distinct words
  });

  it('goes through the catalogue, so a second locale changes it', () => {
    setCatalogue('xx', {
      'objective.status.active': 'en cours',
      'objective.status.complete': 'termine',
      'objective.status.failed': 'echoue',
    });
    expect(ALL.map(objectiveStatusLabel)).toEqual(['en cours', 'termine', 'echoue']);
  });

  // The HUD notice shouts; the pause menu does not. Both read the same table,
  // which is the whole point of this module -- the notice used to uppercase the
  // raw enum instead.
  it('the shout form is the same word, upper-cased by the locale', () => {
    for (const s of ALL) expect(objectiveStatusShout(s)).toBe(objectiveStatusLabel(s).toLocaleUpperCase());
    expect(objectiveStatusShout('complete')).toBe('COMPLETE');
    expect(objectiveStatusShout('active')).toBe('IN PROGRESS');
  });

  // Under `?pseudo=1` a chrome string is bracketed and accented. These two were
  // the two strings on the pause menu and in the notice feed that were not.
  it('is bracketed under the pseudo-locale, which is how the capture pass sees it', () => {
    setCatalogue('pseudo', en, (out) => `[${out}]`);
    expect(objectiveStatusLabel('failed')).toBe('[Failed]');
    expect(objectiveStatusShout('failed')).toBe('[FAILED]');
  });
});
