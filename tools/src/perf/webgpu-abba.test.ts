import { describe, expect, it } from 'vitest';
import { abbaOrder, barMet, compare, loadRefusal, median, roundsRefusal, summarise } from './webgpu-abba';

describe('quiet-machine refusals', () => {
  it('refuses a loaded machine and passes a quiet one, with the boundary at 4', () => {
    expect(loadRefusal(172.78)).toMatch(/not a quiet machine/);
    expect(loadRefusal(4.01)).not.toBeNull();
    expect(loadRefusal(4)).toBeNull();
    expect(loadRefusal(0.3)).toBeNull();
    expect(loadRefusal(Number.NaN)).not.toBeNull();
  });
  it('requires at least 3 rounds', () => {
    expect(roundsRefusal(2)).not.toBeNull();
    expect(roundsRefusal(3)).toBeNull();
  });
});

describe('abbaOrder', () => {
  it('alternates ABBA and BAAB, each arm twice per round', () => {
    expect(abbaOrder('a', 'b', 0)).toEqual(['a', 'b', 'b', 'a']);
    expect(abbaOrder('a', 'b', 1)).toEqual(['b', 'a', 'a', 'b']);
  });
});

describe('summarise and compare', () => {
  it('takes the median of the round medians and the spread of them', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const s = summarise([[10, 12], [20, 22], [11, 13]]);
    expect(s.value).toBe(12);
    expect(s.spread).toBe(10);
  });
  it('a difference inside the spread counts as no difference; one outside does not', () => {
    const base = { value: 10, spread: 2, rounds: 3 };
    expect(compare(base, { value: 11.5, spread: 0.1, rounds: 3 }).withinSpread).toBe(true);
    expect(compare(base, { value: 13, spread: 0.1, rounds: 3 }).withinSpread).toBe(false);
  });
  it('the bars: G 1.05, F 1.10, unless inside the spread', () => {
    const tight = { value: 10, spread: 0.1, rounds: 3 };
    expect(barMet('G', compare(tight, { value: 10.4, spread: 0.1, rounds: 3 }))).toBe(true);
    expect(barMet('G', compare(tight, { value: 10.8, spread: 0.1, rounds: 3 }))).toBe(false);
    expect(barMet('F', compare(tight, { value: 10.8, spread: 0.1, rounds: 3 }))).toBe(true);
    expect(barMet('F', compare(tight, { value: 11.5, spread: 0.1, rounds: 3 }))).toBe(false);
    expect(barMet('G', compare({ value: 10, spread: 3, rounds: 3 }, { value: 11, spread: 0.1, rounds: 3 }))).toBe(true);
  });
});
