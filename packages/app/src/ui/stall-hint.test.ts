import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STALL_TICKS,
  hintTarget,
  stallHintLine,
  stallStart,
  stallStep,
  tickIsActive,
  type StallRow,
  type StallState,
} from './stall-hint';

const row = (o: Partial<StallRow> & { id: string }): StallRow => ({
  type: 'locate',
  text: `Objective ${o.id}`,
  primary: true,
  status: 'active',
  ...o,
});

/** Look every 5 ticks from `from` up to and including `to`, collecting hints. */
function run(
  start: StallState,
  from: number,
  to: number,
  rows: (tick: number) => readonly StallRow[],
  opts: { enabled?: boolean; active?: (tick: number) => boolean } = {}
): { state: StallState; hints: { tick: number; row: StallRow }[] } {
  let state = start;
  const hints: { tick: number; row: StallRow }[] = [];
  for (let tick = from; tick <= to; tick += 5) {
    const r = stallStep(state, {
      enabled: opts.enabled ?? true,
      tick,
      active: opts.active?.(tick) ?? false,
      rows: rows(tick),
    });
    state = r.state;
    if (r.hint) hints.push({ tick, row: r.hint });
  }
  return { state, hints };
}

const LOCATE = [row({ id: 'find' })];

describe('stallStep', () => {
  it('says nothing before the window and speaks once the window has run', () => {
    const early = run(stallStart(0), 0, STALL_TICKS - 5, () => LOCATE);
    expect(early.hints).toEqual([]);
    const at = run(stallStart(0), 0, STALL_TICKS, () => LOCATE);
    expect(at.hints.map((h) => h.tick)).toEqual([STALL_TICKS]);
    expect(at.hints[0].row.id).toBe('find');
  });

  it('speaks once per stall, however long it lasts', () => {
    const r = run(stallStart(0), 0, STALL_TICKS * 5, () => LOCATE);
    expect(r.hints).toHaveLength(1);
  });

  it('re-arms only after progress, and then speaks again after a full window', () => {
    // A kill at 2 x window: the first stall said its line, the kill ends it, and
    // the next line is a full window after the kill and not before.
    const killAt = STALL_TICKS * 2;
    const r = run(stallStart(0), 0, killAt + STALL_TICKS, () => LOCATE, { active: (t) => t === killAt });
    expect(r.hints.map((h) => h.tick)).toEqual([STALL_TICKS, killAt + STALL_TICKS]);
  });

  it('is held off by steady activity (a kill, an identification)', () => {
    const r = run(stallStart(0), 0, STALL_TICKS * 4, () => LOCATE, { active: (t) => t % STALL_TICKS !== 0 && t % 100 === 0 });
    expect(r.hints).toEqual([]);
  });

  it('counts an objective changing state as progress', () => {
    const at = STALL_TICKS - 5;
    const rows = (t: number): StallRow[] => [row({ id: 'a', status: t >= at ? 'complete' : 'active' }), row({ id: 'b', type: 'capture' })];
    const r = run(stallStart(0), 0, STALL_TICKS + 20, rows);
    expect(r.hints).toEqual([]);
  });

  it('counts a hold clock moving as progress, and a held-still clock as a stall', () => {
    const moving = (t: number): StallRow[] => [row({ id: 'h', type: 'hold_for', ticksLeft: 6000 - t })];
    expect(run(stallStart(0), 0, STALL_TICKS * 3, moving).hints).toEqual([]);
    const frozen = (): StallRow[] => [row({ id: 'h', type: 'hold_for', ticksLeft: 4000, paused: 'unheld' })];
    expect(run(stallStart(0), 0, STALL_TICKS * 3, frozen).hints).toHaveLength(1);
  });

  it('does not count a deadline clock as progress, and never points at one', () => {
    const rows = (t: number): StallRow[] => [
      row({ id: 'loc' }),
      row({ id: 'dl', type: 'evacuate_before', ticksLeft: 4800 - t }),
      row({ id: 'surv', type: 'survive_until', ticksLeft: 6000 - t }),
    ];
    const r = run(stallStart(0), 0, STALL_TICKS, rows);
    expect(r.hints.map((h) => h.row.id)).toEqual(['loc']);
    const onlyClocks = (t: number): StallRow[] => [
      row({ id: 'dl', type: 'evacuate_before', ticksLeft: 4800 - t }),
      row({ id: 'surv', type: 'survive_until', ticksLeft: 6000 - t }),
    ];
    expect(run(stallStart(0), 0, STALL_TICKS * 3, onlyClocks).hints).toEqual([]);
  });

  it('says nothing when no primary is open', () => {
    const rows = [row({ id: 'p', status: 'complete' }), row({ id: 's', primary: false })];
    expect(run(stallStart(0), 0, STALL_TICKS * 3, () => rows).hints).toEqual([]);
  });

  it('is silent when disabled (tutorial, sandbox, ended) and starts its window afresh when enabled again', () => {
    expect(run(stallStart(0), 0, STALL_TICKS * 5, () => LOCATE, { enabled: false }).hints).toEqual([]);
    const off = run(stallStart(0), 0, STALL_TICKS * 2, () => LOCATE, { enabled: false });
    const back = run(off.state, STALL_TICKS * 2 + 5, STALL_TICKS * 3 + 5, () => LOCATE);
    // Not at the first look after re-enabling: a full window from it.
    expect(back.hints.map((h) => h.tick)).toEqual([STALL_TICKS * 3 + 5]);
  });

  it('does not count a paused sim: the tick does not advance', () => {
    // A paused mission's clock stops, so the look sees the same tick forever.
    let state = stallStart(0);
    for (let i = 0; i < 1000; i++) {
      const r = stallStep(state, { enabled: true, tick: STALL_TICKS - 5, active: false, rows: LOCATE });
      state = r.state;
      expect(r.hint).toBeNull();
    }
    // And a pause sandwiched in a quiet stretch (disabled while paused) costs
    // the stretch it covered.
    const before = run(stallStart(0), 0, STALL_TICKS - 5, () => LOCATE);
    const paused = stallStep(before.state, { enabled: false, tick: STALL_TICKS - 5, active: false, rows: LOCATE });
    const after = run(paused.state, STALL_TICKS, STALL_TICKS + 5, () => LOCATE);
    expect(after.hints).toEqual([]);
  });
});

describe('tickIsActive', () => {
  it('counts a kill, our identification and any mission event', () => {
    expect(tickIsActive([{ kind: 'destroyed' }], [])).toBe(true);
    expect(tickIsActive([{ kind: 'contact', side: 0, level: 'identified' }], [])).toBe(true);
    expect(tickIsActive([], [{ kind: 'objective' }])).toBe(true);
  });
  it('does not count a shot, the enemy seeing us, a lost contact, or nothing', () => {
    expect(tickIsActive([{ kind: 'fire' }], [])).toBe(false);
    expect(tickIsActive([{ kind: 'contact', side: 1, level: 'identified' }], [])).toBe(false);
    expect(tickIsActive([{ kind: 'contact', side: 0, level: 'lost' }], [])).toBe(false);
    expect(tickIsActive([{ kind: 'spawn' }, { kind: 'impact' }], [])).toBe(false);
    expect(tickIsActive([], [])).toBe(false);
  });
});

describe('hintTarget and stallHintLine', () => {
  it('points at the first open primary the player can act on', () => {
    const rows = [row({ id: 'x', status: 'complete' }), row({ id: 'y', primary: false }), row({ id: 'z', type: 'capture' })];
    expect(hintTarget(rows)?.id).toBe('z');
  });

  it('words each type, naming the objective from its own text', () => {
    const line = (o: Partial<StallRow>): string => stallHintLine(row({ id: 'o', text: 'the ward crossing', ...o }));
    expect(line({ type: 'locate' })).toBe('Still open — the ward crossing. Any unit can spot the last position. Send someone to look.');
    expect(line({ type: 'capture', paused: 'contested' })).toContain('contested');
    expect(line({ type: 'hold_for', paused: 'unheld' })).toContain('Nobody is on the ground');
    expect(line({ type: 'capture' })).toContain('stand on it');
    expect(line({ type: 'eliminate_hvt' })).toContain('still alive');
    expect(line({ type: 'destroy_all' })).toContain('Enemy units remain');
    expect(line({ type: 'raze' })).toContain('Nothing has moved');
  });

  it('escapes the objective text, which reaches innerHTML', () => {
    expect(stallHintLine(row({ id: 'o', text: '<b>Rock & roll</b>' }))).toContain('&lt;b&gt;Rock &amp; roll&lt;/b&gt;');
  });
});

describe('main.ts wiring', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  it('looks only in a real, running, unpaused, non-tutorial mission', () => {
    const at = main.indexOf('stallStep(stall,');
    expect(at).toBeGreaterThan(0);
    const call = main.slice(at, at + 400);
    expect(call).toContain('stepList === undefined');
    expect(call).toContain('!paused');
    expect(call).toContain("runtime.result === 'ongoing'");
    // The sandbox has no runtime, and the look sits behind it.
    expect(main.slice(at - 120, at)).toContain('if (runtime &&');
  });
});
