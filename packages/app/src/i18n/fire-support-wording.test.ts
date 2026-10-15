// S-F Task 7: F1 stopped intel from trickling. Intel is earned by identifying
// the enemy, holding high ground and completing objectives, and it is spent on
// FOUR calls. Any chrome line that still describes the trickle, a "satellite",
// a two-item menu or a rate is false, and one false line is enough to teach a
// player to wait. Every value in the catalogue is read the way a player reads
// it (`playerText`) and held against the phrases the old model left behind.
import { describe, expect, it } from 'vitest';
import en from './en.json';
import { playerText } from './player-text';

const STALE =
  /watch longer|while (it sits )?still|while stationary|satellite|sweep and precision-strike|at the current intel rate|no intel coming in/i;

/** Keys the old model owned and no shipped screen should still carry. */
const DELETED_KEYS = [
  'hud.card.cap.markTarget',
  'dock.support.charge.eta',
  'dock.support.charge.none',
  'dock.support.clock.minutes',
  'dock.support.clock.none',
] as const;

describe('no chrome line still describes the intel trickle', () => {
  const catalogue = en as Record<string, string>;

  it('no catalogue value reads as a rate, a wait or a two-item menu', () => {
    const hits = Object.entries(catalogue)
      .filter(([, v]) => STALE.test(playerText(v).text))
      .map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  it('the keys the old model owned are gone', () => {
    const present = DELETED_KEYS.filter((k) => k in catalogue);
    expect(present).toEqual([]);
  });

  it('the intel tip and the first-use hints name how intel is earned and what it buys', () => {
    expect(playerText(catalogue['hud.strip.intel.tip']).text).toMatch(/identifying the enemy/);
    expect(playerText(catalogue['hud.strip.intel.tip']).text).toMatch(/high ground/);
    expect(playerText(catalogue['hud.strip.intel.tip']).text).toMatch(/objectives/);
    expect(playerText(catalogue['hud.hint.first.intel']).text).toMatch(/smoke.*mortars.*sweep.*precision strike/);
  });

  it('the sniper hint does not tie identification to high ground', () => {
    const text = playerText(catalogue['hud.hint.first.sniper']).text;
    expect(text).toMatch(/every enemy it identifies earns intel, wherever it stands/);
    expect(text).not.toMatch(/high ground, where/);
    expect(text).not.toMatch(/see further|sees further/);
  });

  it('the fallback "called" note carries no grid coordinates', () => {
    expect(catalogue['main.note.supportCalled']).not.toMatch(/\{[xy]\}/);
  });
});
