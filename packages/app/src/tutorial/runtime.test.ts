import { describe, expect, it } from 'vitest';
import { advance, initTutorial, type StepJson } from './runtime';

const STEPS: StepJson[] = [
  {
    id: 'take_command',
    title: 'Take command',
    teach: 'Click a squad.',
    await: { kind: 'intent', intent: 'select' },
    nudge_after_s: 12,
    nudge: 'Click the squad.',
  },
  {
    id: 'move',
    title: 'Move',
    teach: 'Right-click ground.',
    await: { kind: 'intent', intent: 'order', verb: 'attackMove' },
  },
  {
    id: 'pin',
    title: 'Pin them',
    teach: 'Fire holds them down.',
    await: { kind: 'sim', event: 'pinned', side: 1 },
  },
];

describe('advance', () => {
  it('opens on the first step', () => {
    const s = initTutorial(STEPS);
    expect(s.index).toBe(0);
    expect(s.done).toBe(false);
    expect(s.openedAtMs).toBe(0);
  });

  it('advances when the awaited intent arrives', () => {
    let s = initTutorial(STEPS);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 1000);
    expect(s.index).toBe(1);
    expect(s.openedAtMs).toBe(1000);
  });

  it('does not advance on a different intent', () => {
    let s = initTutorial(STEPS);
    s = advance(s, { kind: 'intent', intent: { kind: 'halt', ids: [1] } }, 500);
    expect(s.index).toBe(0);
  });

  it('does not advance on the right intent kind with the wrong narrowing', () => {
    // The move lesson wants an attackMove. A plain move is the same kind and
    // must not satisfy it, or the step teaches the wrong verb.
    let s = initTutorial(STEPS);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 0);
    expect(s.index).toBe(1);
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'move', ids: [1], x: 0, y: 0, append: false } }, 10);
    expect(s.index).toBe(1);
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'attackMove', ids: [1], x: 0, y: 0, append: false } }, 20);
    expect(s.index).toBe(2);
  });

  it('advances on a sim event, restricted to the named side', () => {
    let s = { ...initTutorial(STEPS), index: 2 };
    s = advance(s, { kind: 'sim', event: { kind: 'pinned', tick: 5, entity: 3 }, sideOf: () => 0 }, 100);
    expect(s.index).toBe(2); // our own squad pinned is not the lesson
    s = advance(s, { kind: 'sim', event: { kind: 'pinned', tick: 6, entity: 9 }, sideOf: () => 1 }, 200);
    expect(s.index).toBe(3);
    expect(s.done).toBe(true);
  });

  it('reports a nudge once the step has been open long enough', () => {
    let s = initTutorial(STEPS);
    s = advance(s, { kind: 'tick' }, 11_000);
    expect(s.nudging).toBe(false);
    s = advance(s, { kind: 'tick' }, 12_001);
    expect(s.nudging).toBe(true);
  });

  it('clears the nudge when the step changes', () => {
    let s = initTutorial(STEPS);
    s = advance(s, { kind: 'tick' }, 20_000);
    expect(s.nudging).toBe(true);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 20_100);
    expect(s.nudging).toBe(false);
  });

  it('never nudges a step that declares no nudge', () => {
    let s = { ...initTutorial(STEPS), index: 1, openedAtMs: 0 };
    s = advance(s, { kind: 'tick' }, 600_000);
    expect(s.nudging).toBe(false);
  });

  it('ignores everything once done', () => {
    const s = { ...initTutorial(STEPS), index: 3, done: true };
    const after = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 999);
    expect(after).toEqual(s);
  });

  it('advances at most one step per input', () => {
    // Two steps both awaiting `select` must not both clear on one click, or a
    // single action skips a lesson the player never saw.
    const twoSelects: StepJson[] = [
      { id: 'a', title: 'A', teach: 'a', await: { kind: 'intent', intent: 'select' } },
      { id: 'b', title: 'B', teach: 'b', await: { kind: 'intent', intent: 'select' } },
    ];
    let s = initTutorial(twoSelects);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 0);
    expect(s.index).toBe(1);
    expect(s.done).toBe(false);
  });

  it('satisfies all_of only when every child has been seen, in any order', () => {
    const steps: StepJson[] = [
      {
        id: 'both',
        title: 'Both',
        teach: 'contact and overlay',
        await: {
          kind: 'all_of',
          of: [
            { kind: 'sim', event: 'contact' },
            { kind: 'intent', intent: 'overlay' },
          ],
        },
      },
    ];
    let s = initTutorial(steps);
    s = advance(s, { kind: 'intent', intent: { kind: 'overlay', on: true } }, 10);
    expect(s.index).toBe(0);
    s = advance(s, { kind: 'sim', event: { kind: 'contact', tick: 1, side: 0, target: 4, level: 'identified', confidence: 0 }, sideOf: () => 1 }, 20);
    expect(s.index).toBe(1);
  });

  it('satisfies elapsed_s from when the step opened, not from mission start', () => {
    const steps: StepJson[] = [
      { id: 'a', title: 'A', teach: 'a', await: { kind: 'intent', intent: 'select' } },
      { id: 'beat', title: 'Beat', teach: 'read this', await: { kind: 'elapsed_s', seconds: 5 } },
    ];
    let s = initTutorial(steps);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 30_000);
    s = advance(s, { kind: 'tick' }, 34_000);
    expect(s.index).toBe(1);
    s = advance(s, { kind: 'tick' }, 35_001);
    expect(s.index).toBe(2);
  });
});
