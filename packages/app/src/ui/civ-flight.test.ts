import { describe, expect, it } from 'vitest';
import { CivFlightWatch, FLIGHT_COOLDOWN_TICKS, FLIGHT_GATHER_TICKS, type CivObservation } from './civ-flight';
import { alertNotice } from './mission-notice';

/** A civilian sheltering in place at (x, 10). */
const civ = (id: number, over: Partial<CivObservation> = {}): CivObservation => ({
  id,
  alive: true,
  buried: false,
  moving: false,
  carried: false,
  suppressed: false,
  x: id + 0.5,
  y: 10.5,
  ...over,
});

/** Run the watch over consecutive ticks, collecting every line it says. */
function run(
  watch: CivFlightWatch,
  frames: readonly (readonly CivObservation[])[],
  start = 0
): { tick: number; notice: NonNullable<ReturnType<CivFlightWatch['observe']>> }[] {
  const out: { tick: number; notice: NonNullable<ReturnType<CivFlightWatch['observe']>> }[] = [];
  frames.forEach((f, i) => {
    const n = watch.observe(f, start + i);
    if (n) out.push({ tick: start + i, notice: n });
  });
  return out;
}

const repeat = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe('CivFlightWatch — the break', () => {
  it('says nothing while families shelter in place', () => {
    const w = new CivFlightWatch();
    expect(run(w, repeat(400, () => [civ(1), civ(2)]))).toEqual([]);
  });

  it('names troops when the family was not suppressed the tick the rule ran', () => {
    const w = new CivFlightWatch();
    const lines = run(w, [[civ(1)], ...repeat(FLIGHT_GATHER_TICKS + 1, () => [civ(1, { moving: true })])]);
    expect(lines).toHaveLength(1);
    expect(lines[0].notice).toMatchObject({
      cause: 'troops',
      count: 1,
      at: { x: 1.5, y: 10.5 },
      line: { key: 'alert.civFlight.troops', params: { n: 1 }, tone: 'info' },
    });
  });

  // The rule decides after tick T and the order lands in tick T+1. By T+1 the
  // suppression can have decayed under the line -- so the cause must come
  // from the observation BEFORE the move, not the one that saw it.
  it('names fire from the observation before the move, even if suppression has decayed since', () => {
    const w = new CivFlightWatch();
    const lines = run(w, [
      [civ(1, { suppressed: true })],
      ...repeat(FLIGHT_GATHER_TICKS + 1, () => [civ(1, { moving: true, suppressed: false })]),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].notice).toMatchObject({
      cause: 'fire',
      line: { key: 'alert.civFlight.fire', tone: 'warn' },
    });
  });

  it('counts a family that boarded a carrier as a break', () => {
    const w = new CivFlightWatch();
    const lines = run(w, [[civ(1)], ...repeat(FLIGHT_GATHER_TICKS + 1, () => [civ(1, { carried: true })])]);
    expect(lines.map((l) => l.notice.count)).toEqual([1]);
  });

  it('ignores the dead and the buried', () => {
    const w = new CivFlightWatch();
    const lines = run(
      w,
      repeat(FLIGHT_GATHER_TICKS + 5, () => [
        civ(1, { alive: false, moving: true }),
        civ(2, { buried: true, moving: true }),
      ])
    );
    expect(lines).toEqual([]);
  });

  // The sim re-orders a family whose transport died under it (the first
  // branch of `CivilianFlight.step`). That is the same flight, not a new one.
  it('announces a family once, however many times it stops and starts', () => {
    const w = new CivFlightWatch();
    const frames = [
      [civ(1)],
      ...repeat(40, () => [civ(1, { moving: true })]),
      ...repeat(40, () => [civ(1)]),
      ...repeat(FLIGHT_COOLDOWN_TICKS + 40, () => [civ(1, { moving: true })]),
    ];
    const lines = run(w, frames);
    expect(lines).toHaveLength(1);
    expect(w.hasFled(1)).toBe(true);
  });
});

describe('CivFlightWatch — the throttle', () => {
  // The lead's bar: a whole village breaking is one line, not twenty. A squad
  // walking through it sets the families off in a ripple, a few ticks apart.
  it('a village of twenty breaking inside the gather window is ONE line', () => {
    const w = new CivFlightWatch();
    const ids = repeat(20, (i) => i);
    const frames = repeat(FLIGHT_GATHER_TICKS + 10, (t) => ids.map((id) => civ(id, { moving: t > id })));
    const lines = run(w, [ids.map((id) => civ(id)), ...frames]);
    expect(lines).toHaveLength(1);
    expect(lines[0].notice.count).toBe(20);
    // It jumps to the first family that broke.
    expect(lines[0].notice.at).toEqual({ x: 0.5, y: 10.5 });
  });

  it('waits out the gather window before speaking', () => {
    const w = new CivFlightWatch();
    const lines = run(w, [[civ(1)], ...repeat(FLIGHT_GATHER_TICKS + 1, () => [civ(1, { moving: true })])]);
    // Broke at tick 1, said at tick 1 + GATHER.
    expect(lines[0].tick).toBe(1 + FLIGHT_GATHER_TICKS);
  });

  it('holds a later break through the cooldown and then says it, never drops it', () => {
    const w = new CivFlightWatch();
    const firstSaid = 1 + FLIGHT_GATHER_TICKS;
    const secondBreak = firstSaid + 50; // well inside the cooldown
    const total = firstSaid + FLIGHT_COOLDOWN_TICKS + 10;
    const frames = repeat(total, (t) => [
      civ(1, { moving: t >= 1 }),
      civ(2, { moving: t >= secondBreak }),
      civ(3, { moving: t >= secondBreak + 2 }),
    ]);
    const lines = run(w, frames);
    expect(lines.map((l) => [l.tick, l.notice.count])).toEqual([
      [firstSaid, 1],
      [firstSaid + FLIGHT_COOLDOWN_TICKS, 2],
    ]);
  });

  it('a mixed batch is called fire -- the louder fact', () => {
    const w = new CivFlightWatch();
    const lines = run(w, [
      [civ(1), civ(2, { suppressed: true })],
      ...repeat(FLIGHT_GATHER_TICKS + 1, () => [civ(1, { moving: true }), civ(2, { moving: true })]),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].notice.cause).toBe('fire');
    expect(lines[0].notice.count).toBe(2);
  });
});

describe('CivFlightWatch — the wording', () => {
  it('names the cause and the refuge, pluralised', () => {
    const fire = alertNotice({ key: 'alert.civFlight.fire', params: { n: 1 }, tone: 'warn' });
    const troops = alertNotice({ key: 'alert.civFlight.troops', params: { n: 3 }, tone: 'info' });
    expect(fire[0]).toBe('<b>1 family running for the refuge</b> — under fire');
    expect(troops[0]).toBe('<b>3 families running for the refuge</b> — your troops are close');
    expect(fire[1]).toBe('warn');
  });
});
