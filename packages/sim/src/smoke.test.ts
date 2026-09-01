import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { EYE_HEIGHT, Sim, SMOKE_RISE, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// Smoke is the counterplay to prepared fire. Without it, crossing open
// ground against a dug-in defence is not a tactic, it is a casualty list —
// which is exactly what playtesting the demolition squad showed.

const RIFLES: UnitTypeJson = {
  id: 'k_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 9, effective_range_tiles: 7, accuracy: 0.6, penetration: 8, damage: 20, suppression: 45, rof_per_min: 300 },
  ],
};

const SAPPERS: UnitTypeJson = {
  id: 'k_demo',
  role: 'engineer',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  abilities: ['demolish', 'smoke'],
  weapons: [],
};

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

describe('smoke screens', () => {
  it('breaks line of sight, so a watched unit stops being identified', () => {
    const sim = new Sim({ seed: 5, width: 32, height: 16, capacity: 16 });
    const inf = sim.addUnitType(RIFLES);
    const demo = sim.addUnitType(SAPPERS);
    const observer = sim.spawn(inf, 0, fx.from(4.5), fx.from(8.5));
    sim.spawn(inf, 1, fx.from(14.5), fx.from(8.5));
    const sapper = sim.spawn(demo, 0, fx.from(5.5), fx.from(8.5));
    collect(sim, 12 * TICKS_PER_SECOND);
    expect(sim.contactLevel(0, 1)).toBe(2); // seen in the open

    // Screen laid across the middle of the sight line.
    sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(9.5), y: fx.from(8.5) });
    collect(sim, 2 * TICKS_PER_SECOND);
    expect(sim.debugDetection(observer, 1)?.visible).toBe(false);
    // Confidence is what gates engagement (the display state deliberately
    // keeps hysteresis), and it decays behind the screen.
    const before = sim.contactConfidence(0, 1);
    collect(sim, 8 * TICKS_PER_SECOND);
    const after = sim.contactConfidence(0, 1);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(fx.from(0.7)); // below the identify threshold
  });

  it('thins out and lifts, restoring the sight line', () => {
    const sim = new Sim({ seed: 6, width: 32, height: 16, capacity: 16 });
    const inf = sim.addUnitType(RIFLES);
    const demo = sim.addUnitType(SAPPERS);
    const observer = sim.spawn(inf, 0, fx.from(4.5), fx.from(8.5));
    sim.spawn(inf, 1, fx.from(14.5), fx.from(8.5));
    const sapper = sim.spawn(demo, 0, fx.from(5.5), fx.from(8.5));
    sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(9.5), y: fx.from(8.5) });
    collect(sim, 5 * TICKS_PER_SECOND);
    expect(sim.debugDetection(observer, 1)?.visible).toBe(false);

    collect(sim, 90 * TICKS_PER_SECOND);
    expect(sim.debugDetection(observer, 1)?.visible).toBe(true);
    expect(sim.smokeAt(9, 8)).toBe(0);
  });

  it('collapses the volume of aimed fire across it', () => {
    const shotsFired = (withSmoke: boolean): number => {
      const sim = new Sim({ seed: 21, width: 32, height: 16, capacity: 16 });
      const inf = sim.addUnitType(RIFLES);
      const demo = sim.addUnitType(SAPPERS);
      sim.spawn(inf, 0, fx.from(6.5), fx.from(8.5));
      sim.spawn(inf, 1, fx.from(12.5), fx.from(8.5));
      const sapper = sim.spawn(demo, 0, fx.from(6.5), fx.from(9.5));
      if (withSmoke) {
        sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(9.5), y: fx.from(8.5) });
      }
      const evs = collect(sim, 12 * TICKS_PER_SECOND);
      return evs.filter((e) => e.kind === 'fire').length;
    };
    const clear = shotsFired(false);
    const smoked = shotsFired(true);
    expect(clear).toBeGreaterThan(20);
    expect(smoked).toBeLessThan(clear / 2);
  });

  it('cannot be laid again immediately — it is a limited resource', () => {
    const sim = new Sim({ seed: 8, width: 32, height: 16, capacity: 8 });
    const demo = sim.addUnitType(SAPPERS);
    const sapper = sim.spawn(demo, 0, fx.from(5.5), fx.from(8.5));
    sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(9.5), y: fx.from(8.5) });
    const first = collect(sim, 2);
    expect(first.some((e) => e.kind === 'smokeLaid')).toBe(true);
    sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(14.5), y: fx.from(8.5) });
    const second = collect(sim, 2 * TICKS_PER_SECOND);
    expect(second.some((e) => e.kind === 'smokeLaid')).toBe(false);
  });

  it('gets the engineers across open ground more often than not having it', () => {
    // The measured problem: sappers ordered at a building across open ground
    // are shot down before they arrive. Smoke should change that materially.
    const crossings = (withSmoke: boolean): number => {
      let arrived = 0;
      for (let seed = 0; seed < 12; seed++) {
        const sim = new Sim({ seed: 500 + seed, width: 40, height: 16, capacity: 16 });
        const inf = sim.addUnitType(RIFLES);
        const demo = sim.addUnitType(SAPPERS);
        // A dug-in fire team watching open ground the sappers must cross.
        for (let x = 22; x < 30; x++) {
          sim.setCover(x, 8, 2);
          sim.setCover(x, 7, 2);
        }
        sim.spawn(inf, 1, fx.from(24.5), fx.from(8.5));
        sim.spawn(inf, 1, fx.from(25.5), fx.from(7.5));
        sim.spawn(inf, 1, fx.from(26.5), fx.from(8.5));
        const sapper = sim.spawn(demo, 0, fx.from(14.5), fx.from(8.5));
        if (withSmoke) {
          sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(20.5), y: fx.from(8.5) });
        }
        sim.queueCommand({ kind: 'attackMove', ids: [sapper], x: fx.from(22.5), y: fx.from(8.5) });
        for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) {
          sim.tick();
          if (sim.state.alive[sapper] === 0) break;
          if (fx.toNumber(sim.state.posX[sapper]) >= 21.5) {
            arrived++;
            break;
          }
        }
      }
      return arrived;
    };
    const without = crossings(false);
    const smoked = crossings(true);
    expect(smoked).toBeGreaterThan(without);
  });

  it('stays deterministic', () => {
    const build = (): number => {
      const sim = new Sim({ seed: 77, width: 32, height: 16, capacity: 16 });
      const inf = sim.addUnitType(RIFLES);
      const demo = sim.addUnitType(SAPPERS);
      sim.spawn(inf, 0, fx.from(5.5), fx.from(8.5));
      sim.spawn(inf, 1, fx.from(16.5), fx.from(8.5));
      const sapper = sim.spawn(demo, 0, fx.from(6.5), fx.from(9.5));
      sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(11.5), y: fx.from(8.5) });
      collect(sim, 600);
      return sim.hash();
    };
    expect(build()).toBe(build());
  });
});

// Smoke has a height, and until now it did not.
//
// `raySmoke` walked the same Bresenham line `losRay` does and summed every
// smoked tile it crossed, with no reference to elevation at all -- one of the
// three things the elevation milestone (E1-E3) left inert because every
// shipped map was flat. Tel Marum authored relief and shipped three missions,
// so it stopped being dormant. Height-blind, a screen pooled on a valley floor
// blinded an observer whose sight line passed three levels above it.
//
// A screen is now a column SMOKE_RISE levels tall standing on its OWN tile's
// ground. Every case below authors relief, because on flat ground the new
// comparison reduces to `SMOKE_RISE > EYE_HEIGHT` at every step -- always true
// -- and the rule is untestable there. That degeneracy is the point: nothing
// about smoke changes on a map without an elevation grid.
//
// Each negative is paired with the arrangement that should give the opposite
// answer on the same geometry. "Cannot see" on its own passes for a broken
// spawn, a screen that never got laid, or a sight range that was too short.
describe('smoke and elevation', () => {
  const SCOUT: UnitTypeJson = {
    id: 'k_scout',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.0 },
    sensors: { optics: 1, sight_tiles: 32, signature: 0.6 },
  };

  /** Two weaponless scouts on opposing sides, and a sapper who lays one screen
   *  through the real `smoke` command -- not a hand-written `sim.smoke` grid.
   *  The screen has to be reachable the way a player reaches it, or the test
   *  proves something about a fixture the game cannot produce. */
  function look(
    build: (sim: Sim) => void,
    a: readonly [number, number],
    b: readonly [number, number],
    screen: readonly [number, number] | null,
    sapperAt: readonly [number, number]
  ): { sim: Sim; visible: boolean; laid: boolean } {
    const sim = new Sim({ seed: 3, width: 24, height: 12, capacity: 8 });
    build(sim);
    const scout = sim.addUnitType(SCOUT);
    const demo = sim.addUnitType(SAPPERS);
    const watcher = sim.spawn(scout, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
    const target = sim.spawn(scout, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
    const sapper = sim.spawn(demo, 0, fx.from(sapperAt[0] + 0.5), fx.from(sapperAt[1] + 0.5));
    collect(sim, 4 * TICKS_PER_SECOND);
    let laid = false;
    if (screen) {
      sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(screen[0] + 0.5), y: fx.from(screen[1] + 0.5) });
      laid = collect(sim, 1 * TICKS_PER_SECOND).some((e) => e.kind === 'smokeLaid');
    }
    const d = sim.debugDetection(watcher, target);
    if (!d) throw new Error('no detection record — the pair was never evaluated');
    return { sim, visible: d.visible, laid };
  }

  /** Two shoulders of high ground with a valley floor between them. The
   *  observers stand on the shoulders; the screen goes in the valley. */
  const shoulders = (sim: Sim): void => {
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 6; x++) sim.setElevation(x, y, 4);
      for (let x = 18; x < 24; x++) sim.setElevation(x, y, 4);
    }
  };

  /** The same map with the ground under the screen lifted to the shoulders'
   *  own height — the screen tiles and nothing else. */
  const mesa = (sim: Sim): void => {
    shoulders(sim);
    for (let y = 0; y < 12; y++) {
      for (let x = 9; x <= 15; x++) sim.setElevation(x, y, 4);
    }
  };

  it('a screen in the valley does not blind a sight line that passes above it', () => {
    // Shoulder to shoulder: the line sits at 4 + EYE_HEIGHT = 5 the whole way
    // across, and the plume tops out at 0 + SMOKE_RISE = 2. Three levels of
    // clear air. Height-blind, this was blocked.
    const { sim, visible, laid } = look(shoulders, [4, 6], [20, 6], [12, 6], [12, 9]);
    expect(laid).toBe(true);
    expect(sim.smokeAt(12, 6)).toBeGreaterThan(0); // the screen is really there
    expect(visible).toBe(true);
  });

  it('and the same screen standing on the shoulders’ own height does blind it', () => {
    // The discriminator. Same observers, same tiles smoked, same everything —
    // only the GROUND under the screen moves, 0 to 4. The plume now tops at 6
    // against a line at 5, and the shot is blind. If the first test passed
    // because the screen failed to lay, or because two scouts 16 tiles apart
    // never see each other anyway, this one passes too and the pair is
    // meaningless. It does not.
    const { visible, laid } = look(mesa, [4, 6], [20, 6], [12, 6], [12, 9]);
    expect(laid).toBe(true);
    expect(visible).toBe(false);
  });

  it('and two men on the valley floor are still blinded by it', () => {
    // The other half of the first test. The screen has not become weaker —
    // it is exactly as opaque as it ever was to anyone level with it. Line at
    // 0 + EYE_HEIGHT = 1, plume top 2.
    const { visible, laid } = look(shoulders, [8, 6], [16, 6], [12, 6], [12, 9]);
    expect(laid).toBe(true);
    expect(visible).toBe(false);
  });

  it('and with no screen at all the shoulders see each other — the control', () => {
    const { visible } = look(shoulders, [4, 6], [20, 6], null, [12, 9]);
    expect(visible).toBe(true);
  });

  it('a man standing in his own screen is blinded by it, however high he stands', () => {
    // The k = 0 endpoint. `lineH` there is exactly h0 * total, so the test
    // reduces to `SMOKE_RISE > EYE_HEIGHT` — the coupling the constant carries
    // a warning about, asserted through behaviour rather than arithmetic. The
    // observer is on the shoulder at elevation 4 looking at a target on the
    // far shoulder, and the screen is laid on his own feet.
    const { visible, laid } = look(shoulders, [4, 6], [20, 6], [4, 6], [4, 8]);
    expect(laid).toBe(true);
    expect(visible).toBe(false);
  });

  it('a screen over relief replays identically from the same seed', () => {
    // `pnpm test:determinism` cannot cover this and does not: the golden
    // replay lays no smoke at all, and no shipped mission or playtest plan
    // does either — `smoke` is reachable only from the player's UI, which is
    // why this change moved neither golden hash. So the replay guard for
    // smoke over NON-uniform relief lives here instead. Deliberately an
    // equality between two runs rather than a pinned number: a golden
    // constant here would be a second pin to maintain for a scenario the
    // determinism suite does not own.
    const build = (): number => {
      const sim = new Sim({ seed: 63, width: 32, height: 16, capacity: 16 });
      // A ridge with a valley either side, so h0, h1 and the tiles between
      // them are all different and the cross-multiply actually does work.
      for (let y = 0; y < 16; y++) {
        for (let x = 12; x <= 19; x++) sim.setElevation(x, y, 3);
        for (let x = 14; x <= 17; x++) sim.setElevation(x, y, 5);
      }
      const inf = sim.addUnitType(RIFLES);
      const demo = sim.addUnitType(SAPPERS);
      const a = sim.spawn(inf, 0, fx.from(6.5), fx.from(8.5));
      sim.spawn(inf, 1, fx.from(24.5), fx.from(8.5));
      const sapper = sim.spawn(demo, 0, fx.from(7.5), fx.from(9.5));
      sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(11.5), y: fx.from(8.5) });
      sim.queueCommand({ kind: 'attackMove', ids: [a], x: fx.from(24.5), y: fx.from(8.5) });
      collect(sim, 600);
      return sim.hash();
    };
    expect(build()).toBe(build());
  });

  it('SMOKE_RISE stays above EYE_HEIGHT, or smoke stops working on every flat map', () => {
    // Not behavioural — an assertion about two constants that sit in sim.ts as
    // unrelated numbers a tuning pass could move independently, and the mirror
    // of elevation.test.ts's EYE_HEIGHT < BLOCK_RISE guard.
    //
    // On flat ground every elevation is 0, so the sight line sits at exactly
    // EYE_HEIGHT above every tile it crosses. A plume of height EYE_HEIGHT or
    // less never reaches it, `(0 + SMOKE_RISE) * total > EYE_HEIGHT * total`
    // stops being true, and smoke becomes inert on every shipped map at once —
    // with nothing pointing at the cause.
    expect(SMOKE_RISE).toBeGreaterThan(EYE_HEIGHT);
  });

  it('a uniform plateau changes the hash and nothing else — smoke reads relative height', () => {
    // The guard against the opposite error: reading absolute height somewhere.
    // Raising every tile by the same amount must leave the screen doing exactly
    // what it did, because h0, h1 and every elevation on the line move together
    // and the comparison degenerates. Mirrors elevation.test.ts's plateau test,
    // with a screen in the middle of the firefight.
    function scenario(raised: boolean): { sim: Sim; events: SimEvent[] } {
      const sim = new Sim({ seed: 31, width: 32, height: 16, capacity: 16 });
      if (raised) {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 32; x++) sim.setElevation(x, y, 5);
        }
      }
      const inf = sim.addUnitType(RIFLES);
      const demo = sim.addUnitType(SAPPERS);
      sim.spawn(inf, 0, fx.from(6.5), fx.from(8.5));
      sim.spawn(inf, 1, fx.from(12.5), fx.from(8.5));
      const sapper = sim.spawn(demo, 0, fx.from(6.5), fx.from(9.5));
      sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(9.5), y: fx.from(8.5) });
      const events = collect(sim, 15 * TICKS_PER_SECOND);
      return { sim, events };
    }
    const flat = scenario(false);
    const raised = scenario(true);
    expect(flat.sim.hash()).not.toBe(raised.sim.hash()); // elevation is state
    expect(raised.events).toEqual(flat.events);
  });
});
