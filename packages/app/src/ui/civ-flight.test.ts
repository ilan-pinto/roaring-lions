import { describe, expect, it } from 'vitest';
import {
  CivFlightWatch,
  FLIGHT_COOLDOWN_TICKS,
  FLIGHT_GATHER_CAP_TICKS,
  FLIGHT_GATHER_TICKS,
  type CivObservation,
} from './civ-flight';
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

  // The header's rule, strictly: suppression that lands in the SAME tick the
  // order does is not what the rule saw, so a family walked out by a soldier
  // and shot at on her first step is still the soldier's.
  it('does not read the cause off the observation that saw the move', () => {
    const w = new CivFlightWatch();
    const lines = run(w, [
      [civ(1)],
      ...repeat(FLIGHT_GATHER_TICKS + 1, () => [civ(1, { moving: true, suppressed: true })]),
    ]);
    expect(lines.map((l) => l.notice.cause)).toEqual(['troops']);
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
    const frames = repeat(FLIGHT_GATHER_TICKS + 30, (t) => ids.map((id) => civ(id, { moving: t > id })));
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

  // Review finding 2: a squad at a walk sets families off a second or two
  // apart. A fixed 1.5 s window split a 3 s ripple into two lines ten
  // seconds apart; a sliding one keeps it one.
  it('a ripple spread over three seconds is still one line', () => {
    const w = new CivFlightWatch();
    const breakAt = [1, 21, 41, 61]; // every second, for three seconds
    const frames = repeat(61 + FLIGHT_GATHER_TICKS + 5, (t) => breakAt.map((b, i) => civ(i, { moving: t >= b })));
    const lines = run(w, frames);
    // Said when the slide or the cap closes it, whichever is first -- and once.
    const said = Math.min(61 + FLIGHT_GATHER_TICKS, 1 + FLIGHT_GATHER_CAP_TICKS);
    expect(lines.map((l) => [l.tick, l.notice.count])).toEqual([[said, 4]]);
  });

  it('stops sliding at the cap, so the family that opened it is not kept waiting', () => {
    const w = new CivFlightWatch();
    // A break every 20 ticks, indefinitely: the slide alone would never close.
    const breakAt = repeat(12, (i) => 1 + i * 20);
    const frames = repeat(240, (t) => breakAt.map((b, i) => civ(i, { moving: t >= b })));
    const lines = run(w, frames);
    expect(lines[0].tick).toBe(1 + FLIGHT_GATHER_CAP_TICKS);
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

describe('CivFlightWatch — where the line points', () => {
  // Review finding 4: a batch held through the cooldown is said up to ten
  // seconds after the break, by which time she has run several tiles.
  it('points at where the first family is NOW, not where she broke', () => {
    const w = new CivFlightWatch();
    const firstSaid = 1 + FLIGHT_GATHER_TICKS;
    const held = firstSaid + 20;
    const frames = repeat(firstSaid + FLIGHT_COOLDOWN_TICKS + 1, (t) => [
      civ(1, { moving: t >= 1 }),
      // Breaks at `held`, then runs 0.04 tiles a tick towards the refuge.
      civ(2, { moving: t >= held, x: 2.5 + Math.max(0, t - held) * 0.04 }),
    ]);
    const lines = run(w, frames);
    const second = lines[1];
    expect(second.notice.count).toBe(1);
    expect(second.notice.at.x).toBeCloseTo(2.5 + (second.tick - held) * 0.04, 6);
    expect(second.notice.at.x).toBeGreaterThan(2.5 + 5);
  });

  it('falls back to where she broke when she is no longer on the map', () => {
    const w = new CivFlightWatch();
    const lines = run(w, [
      [civ(1)],
      [civ(1, { moving: true })],
      ...repeat(FLIGHT_GATHER_TICKS, () => [civ(1, { alive: false, x: 40 })]),
    ]);
    expect(lines[0].notice.at).toEqual({ x: 1.5, y: 10.5 });
  });
});

describe('CivFlightWatch — idle', () => {
  // Review finding 5: `main.ts` skips building observations while this holds.
  it('is idle only once every civilian is latched or dead and nothing waits to be said', () => {
    const w = new CivFlightWatch();
    expect(w.idle).toBe(false); // never observed
    w.observe([civ(1), civ(2)], 0);
    expect(w.idle).toBe(false); // two sheltering
    w.observe([civ(1, { moving: true }), civ(2, { alive: false })], 1);
    expect(w.idle).toBe(false); // a line is pending
    for (let t = 2; t <= 1 + FLIGHT_GATHER_TICKS; t++) w.observe([civ(1, { moving: true }), civ(2, { alive: false })], t);
    expect(w.idle).toBe(true);
  });

  it('a buried civilian keeps it awake -- she may surface', () => {
    const w = new CivFlightWatch();
    w.observe([civ(1, { buried: true })], 0);
    expect(w.idle).toBe(false);
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
