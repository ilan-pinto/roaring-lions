import { describe, expect, it } from 'vitest';
import type { Command } from '@lions/sim';
import { ADVISOR_NOTE_MAX, advisorMayRelay, cleanAdvisorMsg, type AdvisorMsg } from './advisor';
import { CHAT_MAX_CHARS } from './protocol';

const MOVE: Command = { kind: 'move', ids: [1, 2], x: 10, y: 12 };

describe('cleanAdvisorMsg', () => {
  it('round-trips each kind', () => {
    const all: AdvisorMsg[] = [
      { kind: 'text', text: 'hold the ridge' },
      { kind: 'ping', x: 0, y: 255 },
      { kind: 'proposal', id: 7, cmd: { ...MOVE, ids: [1, 2] }, note: 'flank left' },
      { kind: 'accept', id: 7 },
      { kind: 'veto', id: 7 },
    ];
    for (const a of all) expect(cleanAdvisorMsg(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it('a proposal\'s command is rebuilt by cleanCommand: a 3 KB pad does not survive', () => {
    const got = cleanAdvisorMsg({ kind: 'proposal', id: 1, cmd: { ...MOVE, pad: 'x'.repeat(3000) }, note: '' });
    expect(got).toEqual({ kind: 'proposal', id: 1, cmd: MOVE, note: '' });
    expect(JSON.stringify(got)).not.toContain('pad');
  });

  it('a proposal with a command cleanCommand refuses is null', () => {
    expect(cleanAdvisorMsg({ kind: 'proposal', id: 1, cmd: { kind: 'move', ids: [1], x: 1.5, y: 2 }, note: '' })).toBeNull();
    expect(cleanAdvisorMsg({ kind: 'proposal', id: 1, cmd: { kind: 'nope' }, note: '' })).toBeNull();
  });

  it('text and a note go through cleanChat: a bidi override is stripped, and the lengths are capped', () => {
    expect(cleanAdvisorMsg({ kind: 'text', text: 'a‮b' })).toEqual({ kind: 'text', text: 'ab' });
    const long = cleanAdvisorMsg({ kind: 'text', text: 'y'.repeat(CHAT_MAX_CHARS + 50) });
    expect(long).toEqual({ kind: 'text', text: 'y'.repeat(CHAT_MAX_CHARS) });
    const p = cleanAdvisorMsg({ kind: 'proposal', id: 1, cmd: MOVE, note: 'n‮'.repeat(200) });
    expect(p?.kind === 'proposal' && p.note).toBe('n'.repeat(ADVISOR_NOTE_MAX));
    expect(cleanAdvisorMsg({ kind: 'text', text: '‮  ' })).toBeNull();
    expect(cleanAdvisorMsg({ kind: 'text', text: 3 })).toBeNull();
  });

  it('a ping is an integer tile 0..255', () => {
    for (const [x, y] of [[256, 0], [0, 256], [1.5, 0], [0, 1.5], [-1, 0], [0, -1]]) {
      expect(cleanAdvisorMsg({ kind: 'ping', x, y })).toBeNull();
    }
    expect(cleanAdvisorMsg({ kind: 'ping', x: 255, y: 0 })).toEqual({ kind: 'ping', x: 255, y: 0 });
  });

  it('an id that is not an integer is null; an unknown kind is null; junk is null', () => {
    expect(cleanAdvisorMsg({ kind: 'accept', id: 1.5 })).toBeNull();
    expect(cleanAdvisorMsg({ kind: 'veto', id: '3' })).toBeNull();
    expect(cleanAdvisorMsg({ kind: 'proposal', id: 0.5, cmd: MOVE, note: '' })).toBeNull();
    expect(cleanAdvisorMsg({ kind: 'surprise' })).toBeNull();
    expect(cleanAdvisorMsg(null)).toBeNull();
    expect(cleanAdvisorMsg('text')).toBeNull();
    expect(cleanAdvisorMsg([])).toBeNull();
  });

  it('a proposal, accept or veto id is a safe non-negative integer: negative, unsafe and huge ids are null (N4a task 7)', () => {
    for (const id of [-1, -7, Number.MAX_SAFE_INTEGER + 1, 1e300]) {
      expect(cleanAdvisorMsg({ kind: 'accept', id }), `accept ${id}`).toBeNull();
      expect(cleanAdvisorMsg({ kind: 'veto', id }), `veto ${id}`).toBeNull();
      expect(cleanAdvisorMsg({ kind: 'proposal', id, cmd: MOVE, note: '' }), `proposal ${id}`).toBeNull();
    }
    expect(cleanAdvisorMsg({ kind: 'accept', id: 0 })).toEqual({ kind: 'accept', id: 0 });
    expect(cleanAdvisorMsg({ kind: 'veto', id: Number.MAX_SAFE_INTEGER })).toEqual({ kind: 'veto', id: Number.MAX_SAFE_INTEGER });
  });

  it('rebuilds the message: extra fields do not ride through', () => {
    expect(cleanAdvisorMsg({ kind: 'accept', id: 2, pad: 'x'.repeat(3000) })).toEqual({ kind: 'accept', id: 2 });
    expect(cleanAdvisorMsg({ kind: 'ping', x: 1, y: 2, pad: 'x' })).toEqual({ kind: 'ping', x: 1, y: 2 });
  });
});

describe('advisorMayRelay', () => {
  const proposal: AdvisorMsg = { kind: 'proposal', id: 1, cmd: MOVE, note: '' };
  const text: AdvisorMsg = { kind: 'text', text: 'hi' };
  it('proposals only from an assist advisor', () => {
    expect(advisorMayRelay('advisor', 'advise', proposal)).toBe(false);
    expect(advisorMayRelay('advisor', 'assist', proposal)).toBe(true);
    expect(advisorMayRelay('human', 'assist', proposal)).toBe(false);
    expect(advisorMayRelay('human', 'advise', proposal)).toBe(false);
  });
  it('accept and veto only from the human', () => {
    for (const a of [{ kind: 'accept', id: 1 }, { kind: 'veto', id: 1 }] as const) {
      expect(advisorMayRelay('advisor', 'assist', a)).toBe(false);
      expect(advisorMayRelay('advisor', 'advise', a)).toBe(false);
      expect(advisorMayRelay('human', 'assist', a)).toBe(true);
      expect(advisorMayRelay('human', 'advise', a)).toBe(true);
    }
  });
  it('text and ping go both ways at either scope', () => {
    for (const a of [text, { kind: 'ping', x: 1, y: 1 } as const]) {
      for (const from of ['human', 'advisor'] as const) {
        for (const scope of ['advise', 'assist'] as const) expect(advisorMayRelay(from, scope, a)).toBe(true);
      }
    }
  });
});
