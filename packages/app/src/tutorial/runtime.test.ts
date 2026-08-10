import { describe, expect, it } from 'vitest';
import { advance, initTutorial, matches, type PredicateJson, type StepJson, type TutorialInput } from './runtime';

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
    const s = initTutorial(STEPS, 0);
    expect(s.index).toBe(0);
    expect(s.done).toBe(false);
    expect(s.openedAtMs).toBe(0);
  });

  it('advances when the awaited intent arrives', () => {
    let s = initTutorial(STEPS, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 1000);
    expect(s.index).toBe(1);
    expect(s.openedAtMs).toBe(1000);
  });

  it('does not advance on a different intent', () => {
    let s = initTutorial(STEPS, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'halt', ids: [1] } }, 500);
    expect(s.index).toBe(0);
  });

  it('does not advance on the right intent kind with the wrong narrowing', () => {
    // The move lesson wants an attackMove. A plain move is the same kind and
    // must not satisfy it, or the step teaches the wrong verb.
    let s = initTutorial(STEPS, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 0);
    expect(s.index).toBe(1);
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'move', ids: [1], x: 0, y: 0, append: false } }, 10);
    expect(s.index).toBe(1);
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'attackMove', ids: [1], x: 0, y: 0, append: false } }, 20);
    expect(s.index).toBe(2);
  });

  it('advances on a sim event, restricted to the named side', () => {
    let s = { ...initTutorial(STEPS, 0), index: 2 };
    s = advance(s, { kind: 'sim', event: { kind: 'pinned', tick: 5, entity: 3 }, sideOf: () => 0 }, 100);
    expect(s.index).toBe(2); // our own squad pinned is not the lesson
    s = advance(s, { kind: 'sim', event: { kind: 'pinned', tick: 6, entity: 9 }, sideOf: () => 1 }, 200);
    expect(s.index).toBe(3);
    expect(s.done).toBe(true);
  });

  it('reports a nudge once the step has been open long enough', () => {
    let s = initTutorial(STEPS, 0);
    s = advance(s, { kind: 'tick' }, 11_000);
    expect(s.nudging).toBe(false);
    s = advance(s, { kind: 'tick' }, 12_001);
    expect(s.nudging).toBe(true);
  });

  it('clears the nudge when the step changes', () => {
    let s = initTutorial(STEPS, 0);
    s = advance(s, { kind: 'tick' }, 20_000);
    expect(s.nudging).toBe(true);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 20_100);
    expect(s.nudging).toBe(false);
  });

  it('never nudges a step that declares no nudge', () => {
    let s = { ...initTutorial(STEPS, 0), index: 1, openedAtMs: 0 };
    s = advance(s, { kind: 'tick' }, 600_000);
    expect(s.nudging).toBe(false);
  });

  it('ignores everything once done', () => {
    const s = { ...initTutorial(STEPS, 0), index: 3, done: true };
    const after = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 999);
    expect(after).toBe(s);
  });

  it('advances at most one step per input', () => {
    // Two steps both awaiting `select` must not both clear on one click, or a
    // single action skips a lesson the player never saw.
    const twoSelects: StepJson[] = [
      { id: 'a', title: 'A', teach: 'a', await: { kind: 'intent', intent: 'select' } },
      { id: 'b', title: 'B', teach: 'b', await: { kind: 'intent', intent: 'select' } },
    ];
    let s = initTutorial(twoSelects, 0);
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
    let s = initTutorial(steps, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'overlay', on: true } }, 10);
    expect(s.index).toBe(0);
    s = advance(s, { kind: 'sim', event: { kind: 'contact', tick: 1, side: 0, target: 4, level: 'identified', confidence: 0 }, sideOf: () => 1 }, 20);
    expect(s.index).toBe(1);
  });

  it('satisfies all_of in the reverse order too', () => {
    // Order-independence is the entire justification for accumulating in
    // `advance` rather than checking both children against one input.
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
    let s = initTutorial(steps, 0);
    s = advance(s, { kind: 'sim', event: { kind: 'contact', tick: 1, side: 0, target: 4, level: 'identified', confidence: 0 }, sideOf: () => 1 }, 10);
    expect(s.index).toBe(0);
    s = advance(s, { kind: 'intent', intent: { kind: 'overlay', on: true } }, 20);
    expect(s.index).toBe(1);
  });

  it('is done immediately for an empty step list', () => {
    const s = initTutorial([], 0);
    expect(s.done).toBe(true);
  });

  it('satisfies elapsed_s from when the step opened, not from mission start', () => {
    const steps: StepJson[] = [
      { id: 'a', title: 'A', teach: 'a', await: { kind: 'intent', intent: 'select' } },
      { id: 'beat', title: 'Beat', teach: 'read this', await: { kind: 'elapsed_s', seconds: 5 } },
    ];
    let s = initTutorial(steps, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } }, 30_000);
    s = advance(s, { kind: 'tick' }, 34_000);
    expect(s.index).toBe(1);
    s = advance(s, { kind: 'tick' }, 35_001);
    expect(s.index).toBe(2);
  });
});

describe('matches', () => {
  // Direct, table-driven coverage of predicate features that `advance`'s
  // scenario tests above never exercise: narrowing fields on non-order/select
  // intents, `by_unit`, `loaded`, `mission`, and `any_of`. Each has a positive
  // and a negative case so a silent mismatch in the field checked cannot pass.
  const cases: Array<{ name: string; pred: PredicateJson; input: TutorialInput; expected: boolean }> = [
    {
      name: 'via matches a select with the same via',
      pred: { kind: 'intent', intent: 'select', via: 'box' },
      input: { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'box' } },
      expected: true,
    },
    {
      name: 'via rejects a select with a different via',
      pred: { kind: 'intent', intent: 'select', via: 'box' },
      input: { kind: 'intent', intent: { kind: 'select', ids: [1], via: 'click' } },
      expected: false,
    },
    {
      name: 'action matches a group with the same action',
      pred: { kind: 'intent', intent: 'group', action: 'assign' },
      input: { kind: 'intent', intent: { kind: 'group', slot: 1, action: 'assign' } },
      expected: true,
    },
    {
      name: 'action rejects a group with a different action',
      pred: { kind: 'intent', intent: 'group', action: 'assign' },
      input: { kind: 'intent', intent: { kind: 'group', slot: 1, action: 'recall' } },
      expected: false,
    },
    {
      name: 'by_unit matches when the killer resolves to the named type',
      pred: { kind: 'sim', event: 'destroyed', by_unit: 'sniper' },
      input: {
        kind: 'sim',
        event: { kind: 'destroyed', tick: 1, entity: 5, by: 9 },
        sideOf: () => 0,
        typeIdOf: (id) => (id === 9 ? 'sniper' : 'rifleman'),
      },
      expected: true,
    },
    {
      name: 'by_unit rejects when the killer resolves to a different type',
      pred: { kind: 'sim', event: 'destroyed', by_unit: 'sniper' },
      input: {
        kind: 'sim',
        event: { kind: 'destroyed', tick: 1, entity: 5, by: 9 },
        sideOf: () => 0,
        typeIdOf: () => 'rifleman',
      },
      expected: false,
    },
    {
      name: 'loaded matches a transport event with loaded true',
      pred: { kind: 'sim', event: 'transport', loaded: true },
      input: {
        kind: 'sim',
        event: { kind: 'transport', tick: 1, entity: 2, carrier: 3, loaded: true },
        sideOf: () => 0,
      },
      expected: true,
    },
    {
      name: 'loaded rejects a transport event with loaded false',
      pred: { kind: 'sim', event: 'transport', loaded: true },
      input: {
        kind: 'sim',
        event: { kind: 'transport', tick: 1, entity: 2, carrier: 3, loaded: false },
        sideOf: () => 0,
      },
      expected: false,
    },
    {
      name: 'mission matches a mission event of the named kind',
      pred: { kind: 'mission', event: 'trigger' },
      input: { kind: 'mission', event: { kind: 'trigger', tick: 1, id: 'x' } },
      expected: true,
    },
    {
      name: 'mission rejects a mission event of a different kind',
      pred: { kind: 'mission', event: 'trigger' },
      input: { kind: 'mission', event: { kind: 'objective', tick: 1, id: 'x', status: 'active' } },
      expected: false,
    },
    {
      name: 'any_of matches when one child matches',
      pred: {
        kind: 'any_of',
        of: [
          { kind: 'intent', intent: 'select' },
          { kind: 'intent', intent: 'halt' },
        ],
      },
      input: { kind: 'intent', intent: { kind: 'halt', ids: [1] } },
      expected: true,
    },
    {
      name: 'any_of rejects when no child matches',
      pred: {
        kind: 'any_of',
        of: [
          { kind: 'intent', intent: 'select' },
          { kind: 'intent', intent: 'halt' },
        ],
      },
      input: { kind: 'intent', intent: { kind: 'order', verb: 'move', ids: [1], x: 0, y: 0, append: false } },
      expected: false,
    },
  ];

  for (const { name, pred, input, expected } of cases) {
    it(name, () => {
      expect(matches(pred, input, 0, 0)).toBe(expected);
    });
  }
});

describe('append narrowing', () => {
  const QUEUE_STEPS: StepJson[] = [
    {
      id: 'move_as_one',
      title: 'Move as one',
      teach: 'Queue waypoints with shift.',
      await: { kind: 'intent', intent: 'order', append: true },
    },
  ];

  it('matches only a shift-queued order', () => {
    let s = initTutorial(QUEUE_STEPS, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'attackMove', ids: [1], x: 0, y: 0, append: false } }, 10);
    expect(s.index).toBe(0); // a plain order must not clear the lesson
    s = advance(s, { kind: 'intent', intent: { kind: 'order', verb: 'attackMove', ids: [1], x: 0, y: 0, append: true } }, 20);
    expect(s.index).toBe(1);
    expect(s.done).toBe(true);
  });

  it('rejects a non-order intent even when append is asked for', () => {
    let s = initTutorial(QUEUE_STEPS, 0);
    s = advance(s, { kind: 'intent', intent: { kind: 'select', ids: [1, 2], via: 'box' } }, 10);
    expect(s.index).toBe(0);
  });
});
