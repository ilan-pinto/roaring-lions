// How often the debrief asks (GH-464, spec §1, D2).
import { describe, expect, it } from 'vitest';
import { answered, asked, ignored, IGNORE_LIMIT, PROMPT_STATE_KEY, readPromptState, shouldAsk, writePromptState } from './prompt-policy';
import type { StorageLike } from '../telemetry/identity';

const store = (init: Record<string, string> = {}): StorageLike & { d: Record<string, string> } => {
  const d = { ...init };
  return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
};

describe('prompt policy', () => {
  it('asks once per mission, win or lose, and never on a replay of an asked one', () => {
    let s = readPromptState(store(), '0.122.0');
    expect(shouldAsk(s, 'beit_sahwan_1_recon', { sandbox: false })).toBe(true);
    s = asked(s, 'beit_sahwan_1_recon');
    expect(shouldAsk(s, 'beit_sahwan_1_recon', { sandbox: false })).toBe(false);
    expect(shouldAsk(s, 'beit_sahwan_2_foothold', { sandbox: false })).toBe(true);
  });

  it('asks the tutorial and never a sandbox', () => {
    const s = readPromptState(store(), '0.122.0');
    expect(shouldAsk(s, 'beit_sahwan_0_tutorial', { sandbox: false })).toBe(true);
    expect(shouldAsk(s, 'beit_sahwan_0_tutorial', { sandbox: true })).toBe(false);
  });

  it('stops after three unanswered asks in a row, until the next build', () => {
    const st = store();
    let s = readPromptState(st, '0.122.0');
    for (let i = 0; i < IGNORE_LIMIT; i++) s = ignored(asked(s, `m${i}`));
    writePromptState(st, s);
    s = readPromptState(st, '0.122.0');
    expect(shouldAsk(s, 'fresh_mission', { sandbox: false })).toBe(false);
    const next = readPromptState(st, '0.123.0');
    expect(shouldAsk(next, 'fresh_mission', { sandbox: false })).toBe(true);
    expect(shouldAsk(next, 'm0', { sandbox: false })).toBe(false);
  });

  it('an answer ends the silence streak', () => {
    let s = readPromptState(store(), '0.122.0');
    s = ignored(ignored(s));
    s = answered(s);
    expect(s.ignored).toBe(0);
  });

  it('reads a corrupt or blocked record as a clean one', () => {
    expect(readPromptState(store({ [PROMPT_STATE_KEY]: '{oops' }), '0.122.0')).toEqual({ rated: [], ignored: 0, build: '0.122.0' });
    expect(readPromptState(null, '0.122.0')).toEqual({ rated: [], ignored: 0, build: '0.122.0' });
  });
});
