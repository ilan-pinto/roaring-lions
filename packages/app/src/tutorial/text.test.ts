import { afterEach, describe, expect, it } from 'vitest';
import { tutorials } from '@lions/data';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import { stepText, stepTextKey } from './text';

afterEach(() => setCatalogue('en', en));

describe('tutorial step text goes through t()', () => {
  const tut = tutorials.beit_sahwan_0;

  it('resolves every step, in English, with no missing key', () => {
    for (const s of tut.steps) {
      const w = stepText(tut.id, s);
      expect(w.title, s.id).not.toBe(stepTextKey(tut.id, s.id, 'title'));
      expect(w.teach.length, s.id).toBeGreaterThan(10);
      expect(w.nudge !== undefined, `${s.id} nudge iff nudge_after_s`).toBe(s.nudge_after_s !== undefined);
    }
    expect(missingKeys().filter((k) => k.startsWith('tutorial.'))).toEqual([]);
  });

  it('brackets under the pseudo-locale, which proves it is not a literal', () => {
    setCatalogue('pseudo', en, pseudo);
    for (const s of tut.steps) {
      const w = stepText(tut.id, s);
      for (const text of [w.title, w.teach, w.nudge ?? "⟦⟧"]) expect(text, s.id).toMatch(/^⟦.*⟧$/s);
    }
  });

  it('reads the ACTIVE catalogue at call time, not at module load', () => {
    const first = tut.steps[0];
    const key = stepTextKey(tut.id, first.id, 'title');
    setCatalogue('xx', { ...en, [key]: 'swapped' });
    expect(stepText(tut.id, first).title).toBe('swapped');
  });
});
