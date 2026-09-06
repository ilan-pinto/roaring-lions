// The HUD's arithmetic, tested where it has no DOM to hide in.
//
// The floating layout reports the same fact twice — the hold clock is drawn
// big and centred and stamped inline in the top strip — so the failures worth
// catching here are the ones where two parts of the HUD would disagree with
// each other, and the ones where a field says something that is not true.

import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '@lions/sim';
import {
  beatDwellMs,
  clockText,
  countSuppressed,
  holdClock,
  objectiveGlyph,
  roeTone,
  stepBeat,
  stripObjectives,
  worstPenalties,
  type MissionView,
  type ObjectiveView,
} from './hud-model';

function obj(over: Partial<ObjectiveView> = {}): ObjectiveView {
  return { id: 'o1', text: 'Hold the west', primary: true, status: 'active', ...over };
}

function mission(objectives: ObjectiveView[], over: Partial<MissionView> = {}): MissionView {
  return { name: 'Beit Sahwan II', objectives, result: 'ongoing', ...over };
}

describe('clockText', () => {
  it('rounds up, so a clock with time on it never reads 0:00', () => {
    expect(clockText(1)).toBe('0:01');
    expect(clockText(0)).toBe('0:00');
  });

  it('pads the seconds', () => {
    expect(clockText(65 * TICKS_PER_SECOND)).toBe('1:05');
    expect(clockText(600 * TICKS_PER_SECOND)).toBe('10:00');
  });
});

describe('holdClock', () => {
  it('is null when nothing is timed', () => {
    expect(holdClock(mission([obj()]))).toBeNull();
    expect(holdClock(null)).toBeNull();
  });

  it('ignores a timed objective that is not active', () => {
    expect(
      holdClock(mission([obj({ status: 'complete', ticksLeft: 100 * TICKS_PER_SECOND })]))
    ).toBeNull();
  });

  it('is untoned above a minute', () => {
    const c = holdClock(mission([obj({ ticksLeft: 160 * TICKS_PER_SECOND })]));
    expect(c).toEqual({ id: 'o1', text: '2:40', tone: '', contested: false });
  });

  it('runs amber under a minute — the last stretch is the part worth watching', () => {
    expect(holdClock(mission([obj({ ticksLeft: 60 * TICKS_PER_SECOND })]))?.tone).toBe('warn');
    expect(holdClock(mission([obj({ ticksLeft: 61 * TICKS_PER_SECOND })]))?.tone).toBe('');
  });

  it('says why a paused clock is paused, or it reads as a broken game', () => {
    const contested = holdClock(
      mission([obj({ ticksLeft: 160 * TICKS_PER_SECOND, paused: 'contested' })])
    );
    expect(contested).toEqual({ id: 'o1', text: '2:40  CONTESTED', tone: 'bad', contested: true });

    const unheld = holdClock(
      mission([obj({ ticksLeft: 160 * TICKS_PER_SECOND, paused: 'unheld' })])
    );
    expect(unheld).toEqual({
      id: 'o1',
      text: '2:40  NOBODY HOLDING',
      tone: 'warn',
      contested: false,
    });
  });

  it('names the objective it belongs to, so the strip can tell whose clock it is', () => {
    // The strip shows the active PRIMARY. Here the only timed objective is a
    // secondary, and stamping its clock beside the primary would report a
    // deadline the primary does not have.
    const m = mission([
      obj({ id: 'take_town', primary: true }),
      obj({ id: 'evac', primary: false, ticksLeft: 90 * TICKS_PER_SECOND }),
    ]);
    expect(holdClock(m)?.id).toBe('evac');
    expect(stripObjectives(m).primary?.id).toBe('take_town');
  });
});

describe('roeTone', () => {
  it('is a verdict at the campaign gate boundaries', () => {
    expect(roeTone(100)).toBe('good');
    expect(roeTone(80)).toBe('good');
    expect(roeTone(79)).toBe('warn');
    expect(roeTone(50)).toBe('warn');
    expect(roeTone(49)).toBe('bad');
    expect(roeTone(0)).toBe('bad');
  });
});

describe('stripObjectives', () => {
  it('shows the primary in hand', () => {
    const m = mission([
      obj({ id: 'a', status: 'complete' }),
      obj({ id: 'b', status: 'active' }),
      obj({ id: 'c', status: 'active' }),
    ]);
    expect(stripObjectives(m).primary?.id).toBe('b');
  });

  it('falls back to the first primary once every primary is done', () => {
    // Going blank at the end of a mission is the failure: the strip should say
    // the work is finished, not stop saying anything.
    const m = mission([obj({ id: 'a', status: 'complete' }), obj({ id: 'b', status: 'complete' })]);
    expect(stripObjectives(m).primary?.id).toBe('a');
  });

  it('is null when a mission declares no primary at all', () => {
    expect(stripObjectives(mission([obj({ primary: false })])).primary).toBeNull();
  });

  it('gives a failable deadline its own line when the strip is showing a different primary', () => {
    // Tel Marum II, 2026-09-06: hold_for first, a 300 s raze deadline third,
    // and the strip showing only the hold. The mission was lost on a clock
    // nobody had seen. The deadline now rides beside the primary, with its
    // own clock and its own tone.
    const m = mission([
      obj({ id: 'hold', type: 'hold_for', ticksLeft: 200 * TICKS_PER_SECOND }),
      obj({ id: 'spotter', type: 'eliminate_hvt' }),
      obj({ id: 'cache', type: 'raze', ticksLeft: 45 * TICKS_PER_SECOND }),
    ]);
    const s = stripObjectives(m);
    expect(s.primary?.id).toBe('hold');
    expect(s.deadline?.objective.id).toBe('cache');
    expect(s.deadline?.text).toBe('0:45');
    expect(s.deadline?.tone).toBe('warn');
    expect(s.primaryOpen).toBe(1); // the spotter, shown nowhere
  });

  it('picks the most urgent deadline, and runs red under thirty seconds', () => {
    const m = mission([
      obj({ id: 'hold', type: 'hold_for', ticksLeft: 200 * TICKS_PER_SECOND }),
      obj({ id: 'evac', type: 'evacuate_before', ticksLeft: 120 * TICKS_PER_SECOND }),
      obj({ id: 'cache', type: 'collapse', ticksLeft: 20 * TICKS_PER_SECOND }),
    ]);
    const s = stripObjectives(m);
    expect(s.deadline?.objective.id).toBe('cache');
    expect(s.deadline?.tone).toBe('bad');
    expect(s.primaryOpen).toBe(1);
  });

  it('does not double up when the shown primary IS the deadline -- its clock is inline', () => {
    const m = mission([
      obj({ id: 'cache', type: 'raze', ticksLeft: 45 * TICKS_PER_SECOND }),
      obj({ id: 'spotter', type: 'eliminate_hvt' }),
    ]);
    const s = stripObjectives(m);
    expect(s.primary?.id).toBe('cache');
    expect(s.deadline).toBeNull();
    expect(s.primaryOpen).toBe(1);
  });

  it('treats a hold or survive clock as no deadline at all -- running out is how those complete', () => {
    const m = mission([
      obj({ id: 'spotter', type: 'eliminate_hvt' }),
      obj({ id: 'hold', type: 'hold_for', ticksLeft: 10 * TICKS_PER_SECOND }),
      obj({ id: 'endure', type: 'survive_until', ticksLeft: 10 * TICKS_PER_SECOND }),
    ]);
    expect(stripObjectives(m).deadline).toBeNull();
    expect(stripObjectives(m).primaryOpen).toBe(2);
  });

  it('counts only the secondaries still open', () => {
    const m = mission([
      obj({ id: 'p', primary: true }),
      obj({ id: 's1', primary: false, status: 'active' }),
      obj({ id: 's2', primary: false, status: 'complete' }),
      obj({ id: 's3', primary: false, status: 'failed' }),
    ]);
    expect(stripObjectives(m).secondaryOpen).toBe(1);
  });
});

describe('objectiveGlyph', () => {
  it('distinguishes the three states', () => {
    expect(objectiveGlyph('complete')).toBe('☑');
    expect(objectiveGlyph('failed')).toBe('☒');
    expect(objectiveGlyph('active')).toBe('☐');
  });
});

describe('countSuppressed', () => {
  const force = (rows: [alive: number, side: number, routed: number, pinned: number][]) => ({
    alive: rows.map((r) => r[0]),
    side: rows.map((r) => r[1]),
    routed: rows.map((r) => r[2]),
    pinned: rows.map((r) => r[3]),
  });

  it('counts only living units on the player side', () => {
    const s = force([
      [1, 0, 0, 1], // ours, pinned
      [0, 0, 0, 1], // dead
      [1, 1, 0, 1], // hostile
      [1, 2, 1, 0], // civilian
    ]);
    expect(countSuppressed(s, 4)).toEqual({ pinned: 1, broken: 0 });
  });

  it('does not count a broken unit twice — the sim flags it pinned as well', () => {
    const s = force([
      [1, 0, 1, 1],
      [1, 0, 0, 1],
    ]);
    expect(countSuppressed(s, 2)).toEqual({ pinned: 1, broken: 1 });
  });

  it('stops at entityCount rather than at array length', () => {
    const s = force([
      [1, 0, 0, 1],
      [1, 0, 0, 1],
    ]);
    expect(countSuppressed(s, 1)).toEqual({ pinned: 1, broken: 0 });
  });
});

describe('worstPenalties', () => {
  it('names the two worst, worst first', () => {
    expect(
      worstPenalties([
        ['range', 0.81],
        ['cover', 0.4],
        ['target moving', 0.9],
      ])
    ).toEqual(['cover 40%', 'range 81%']);
  });

  it('drops a factor that rounds to 100% — a row saying a penalty costs nothing is noise', () => {
    expect(
      worstPenalties([
        ['range', 0.996],
        ['cover', 1],
        ['target moving', 0.9],
      ])
    ).toEqual(['target moving 90%']);
  });

  it('is empty when nothing is degrading the shot', () => {
    expect(worstPenalties([['range', 1]])).toEqual([]);
  });
});

describe('stepBeat', () => {
  it('clamps rather than wraps — a briefing is an ordered account', () => {
    expect(stepBeat(0, 4, -1)).toBe(0);
    expect(stepBeat(3, 4, 1)).toBe(3);
    expect(stepBeat(1, 4, 1)).toBe(2);
    expect(stepBeat(1, 4, -1)).toBe(0);
  });

  it('survives a mission with no briefing', () => {
    expect(stepBeat(0, 0, 1)).toBe(0);
  });
});

describe('beatDwellMs', () => {
  it('gives a long beat longer, so the bar does not fold mid-sentence', () => {
    const short = 'Go.';
    const long = 'x'.repeat(400);
    expect(beatDwellMs(long)).toBeGreaterThan(beatDwellMs(short));
  });

  it('floors at six seconds, so a one-word beat is still readable', () => {
    expect(beatDwellMs('Go.')).toBe(6000);
  });
});
