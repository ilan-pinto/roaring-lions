import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

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
