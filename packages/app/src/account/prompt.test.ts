import { describe, expect, it } from 'vitest';
import { memStorage } from './fixtures';
import { markNever, markShown, promptDue, PROMPT_KEY } from './prompt';

const base = { enabled: true, open: true, signedIn: false, moment: 'firstVictory' as const, tutorial: false, pageShown: false };
const due = (storage: Parameters<typeof promptDue>[0]['storage'], over: Partial<Parameters<typeof promptDue>[0]> = {}): boolean =>
  promptDue({ storage, ...base, ...over });
const boom = (): never => {
  throw new Error('blocked');
};

describe('the save prompt rules (A2-13)', () => {
  it('is absent with no moment (the menu at boot) and in the tutorial', () => {
    const s = memStorage();
    expect(due(s, { moment: null })).toBe(false);
    expect(due(s, { tutorial: true })).toBe(false);
  });
  it('is shown at each of the three moments', () => {
    for (const moment of ['firstVictory', 'firstTown', 'campaignDone'] as const) expect(due(memStorage(), { moment })).toBe(true);
  });
  it('is absent when off, closed or signed in', () => {
    const s = memStorage();
    expect(due(s, { enabled: false })).toBe(false);
    expect(due(s, { open: false })).toBe(false);
    expect(due(s, { signedIn: true })).toBe(false);
  });
  it('is absent after three showings', () => {
    const s = memStorage();
    for (let i = 0; i < 3; i++) {
      expect(due(s)).toBe(true);
      markShown(s);
    }
    expect(due(s)).toBe(false);
    expect(JSON.parse(s.map.get(PROMPT_KEY) ?? '')).toEqual({ version: 1, shown: 3, never: false });
  });
  it('"never" stops it for good', () => {
    const s = memStorage();
    markNever(s);
    expect(due(s)).toBe(false);
    expect(JSON.parse(s.map.get(PROMPT_KEY) ?? '')).toMatchObject({ never: true });
  });
  it('a damaged record reads as a fresh one', () => {
    const s = memStorage();
    s.setItem(PROMPT_KEY, '{"version":7,"shown":99}');
    expect(due(s)).toBe(true);
    s.setItem(PROMPT_KEY, 'not json');
    expect(due(s)).toBe(true);
  });
});

describe('the prompt under throwing storage (A1-12, prompt half)', () => {
  const refusing = { getItem: boom, setItem: boom, removeItem: boom };
  it('does not throw and answers by the page alone: at most once per page load', () => {
    expect(due(refusing, { pageShown: false })).toBe(true);
    expect(() => markShown(refusing)).not.toThrow();
    expect(() => markNever(refusing)).not.toThrow();
    expect(due(refusing, { pageShown: true })).toBe(false);
  });
  it('a null storage behaves the same', () => {
    expect(due(null, { pageShown: false })).toBe(true);
    expect(due(null, { pageShown: true })).toBe(false);
  });
  it('still honours the other rules', () => {
    expect(due(refusing, { moment: null })).toBe(false);
    expect(due(refusing, { signedIn: true })).toBe(false);
  });
});
