// @vitest-environment jsdom
/**
 * GH-279: when the refuge ring is shown. Once per EMITTED flight line -- never
 * once per family -- and when the tracker's "Show refuge" is pressed.
 */
import { describe, expect, it } from 'vitest';
import type { AlertLine } from './alerts';
import { CivFlightWatch, FLIGHT_COOLDOWN_TICKS, type CivObservation } from './civ-flight';
import { objectivesPanel, type ObjectiveRow } from './objectives';
import { refugeJump, sayFlight, type TilePoint } from './refuge-ping';

const REFUGE: TilePoint = { x: 24.5, y: 22.5 };

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

/** Every effect a flight line has, recorded in order. */
function recorder() {
  const calls: string[] = [];
  const pings: [number, number][] = [];
  const lines: AlertLine[] = [];
  return {
    calls,
    pings,
    lines,
    sinks: {
      note: (line: AlertLine) => {
        calls.push('note');
        lines.push(line);
      },
      flash: () => calls.push('flash'),
      ping: (x: number, y: number) => {
        calls.push('ping');
        pings.push([x, y]);
      },
    },
  };
}

describe('sayFlight', () => {
  it('pings the refuge exactly once per emitted line, over a whole evacuation', () => {
    const w = new CivFlightWatch();
    const rec = recorder();
    // Five families. Three break in a ripple a few ticks apart (one line),
    // then after the cooldown two more break (a second line).
    const moving = new Set<number>();
    let emitted = 0;
    for (let tick = 0; tick < 3 * FLIGHT_COOLDOWN_TICKS; tick++) {
      if (tick === 5) moving.add(1);
      if (tick === 12) moving.add(2);
      if (tick === 20) moving.add(3);
      if (tick === FLIGHT_COOLDOWN_TICKS + 50) moving.add(4);
      if (tick === FLIGHT_COOLDOWN_TICKS + 52) moving.add(5);
      const civs = [1, 2, 3, 4, 5].map((id) => civ(id, { moving: moving.has(id) }));
      const flight = w.observe(civs, tick);
      if (flight) {
        emitted++;
        sayFlight(flight, REFUGE, rec.sinks, tick * 50);
      }
    }
    expect(emitted).toBe(2);
    expect(rec.lines.map((l) => l.params)).toEqual([{ n: 3 }, { n: 2 }]);
    // Five families, two lines, two pings -- never one per family.
    expect(rec.pings).toEqual([
      [24.5, 22.5],
      [24.5, 22.5],
    ]);
  });

  it('says the line, flashes the minimap and pings, and hands back where they broke', () => {
    const rec = recorder();
    const flashed: (readonly TilePoint[])[] = [];
    const at = sayFlight(
      {
        line: { key: 'alert.civFlight.troops', params: { n: 1 }, tone: 'info' },
        at: { x: 3.5, y: 9.5 },
        count: 1,
        cause: 'troops',
      },
      REFUGE,
      { ...rec.sinks, flash: (pts) => flashed.push(pts) },
      1234
    );
    expect(at).toEqual({ x: 3.5, y: 9.5 });
    expect(rec.calls).toEqual(['note', 'ping']);
    expect(flashed).toEqual([[{ x: 3.5, y: 9.5 }, REFUGE]]);
    expect(rec.pings).toEqual([[24.5, 22.5]]);
  });
});

describe('refugeJump -- the tracker\'s "Show refuge"', () => {
  const evac: ObjectiveRow[] = [
    {
      id: 'get_four_in',
      text: 'Get four in (1/4)',
      primary: true,
      carries: false,
      status: 'active',
      jumpTo: { x: 24.5, y: 22.5 },
    },
  ];

  it('moves the camera onto the refuge and pings it, once per press', () => {
    const camera = { x: 3, y: 4, zoom: 1.5 };
    const pings: [number, number][] = [];
    const host = document.createElement('div');
    const p = objectivesPanel(host, {
      rows: () => evac,
      paysCredits: true,
      onJump: refugeJump(camera, (x, y) => pings.push([x, y])),
    });
    const button = p.el.querySelector<HTMLButtonElement>('.rl-obj__jump');
    expect(button?.textContent).toBe('Show refuge');
    button?.click();
    expect(camera).toEqual({ x: 24.5, y: 22.5, zoom: 1.5 });
    expect(pings).toEqual([[24.5, 22.5]]);
    button?.click();
    expect(pings).toHaveLength(2);
    p.dispose();
  });
});
