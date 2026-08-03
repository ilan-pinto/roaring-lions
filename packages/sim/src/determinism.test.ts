import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

// The canary for invariants 2 and 3 (CLAUDE.md): replay 1000 ticks from a
// fixed seed and assert the state hash is stable. Must pass before any
// commit touching @lions/sim. A failure here is never cosmetic.

const RIFLES: UnitTypeJson = {
  id: 'd_rifles',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 8,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 50,
      rof_per_min: 300,
    },
  ],
};

const TANK: UnitTypeJson = {
  id: 'd_tank',
  hull: {
    hp: 3000,
    armor: { front: 700, side: 300, rear: 150 },
    aps: { base_pk: 0.75, magazine: 3, reload_s: 8, ineffective_vs: ['apfsds', 'kinetic'] },
  },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1.0, sight_tiles: 12, signature: 1.0 },
  weapons: [
    {
      id: 'gun',
      type: 'apfsds',
      range_tiles: 12,
      accuracy: 0.85,
      penetration: 1300,
      damage: 520,
      rof_per_min: 9,
    },
  ],
};

/** A full little battle: walls, mixed forces, mid-run orders both sides. */
function run(seed: number, ticks: number, extraIdleUnit = false): Sim {
  const sim = new Sim({ seed, width: 48, height: 48, capacity: 128 });
  const rifles = sim.addUnitType(RIFLES);
  const tank = sim.addUnitType(TANK);

  for (let y = 10; y < 38; y++) sim.setBlocked(24, y, true);
  for (let x = 20; x < 29; x++) sim.setCover(x, 20, 2);

  const west: number[] = [];
  for (let n = 0; n < 8; n++) west.push(sim.spawn(rifles, 0, fx.fromInt(4), fx.fromInt(8 + n * 3)));
  west.push(sim.spawn(tank, 0, fx.fromInt(2), fx.fromInt(24)));
  const east: number[] = [];
  for (let n = 0; n < 8; n++) east.push(sim.spawn(rifles, 1, fx.fromInt(44), fx.fromInt(8 + n * 3)));
  east.push(sim.spawn(tank, 1, fx.fromInt(46), fx.fromInt(24)));

  if (extraIdleUnit) sim.spawn(rifles, 0, fx.fromInt(1), fx.fromInt(1));

  for (let t = 0; t < ticks; t++) {
    if (t === 10) sim.queueCommand({ kind: 'attackMove', ids: west, x: fx.fromInt(40), y: fx.fromInt(24) });
    if (t === 200) sim.queueCommand({ kind: 'attackMove', ids: east, x: fx.fromInt(8), y: fx.fromInt(24) });
    if (t === 600) sim.queueCommand({ kind: 'halt', ids: [west[0]] });
    sim.tick();
  }
  return sim;
}

describe('determinism (1000-tick replay)', () => {
  it('two independent replays from the same seed produce an identical state hash', () => {
    const a = run(0x1310_0001, 1000);
    const b = run(0x1310_0001, 1000);
    expect(a.hash()).toBe(b.hash());
    // Golden pin. This value must be identical on every machine and engine —
    // that is the whole claim of invariants 2 and 3. It changes ONLY when the
    // model deliberately changes (sim code or tuning constants); update it by
    // reading the new value from this failure, in the same commit, on purpose.
    // Updated for structures: garrison/demolition/building columns, the
    // displaced flag, and threat-scaled near-miss suppression.
    expect(a.hash()).toBe(1610960308);
  });

  it('a different seed produces a different hash', () => {
    const a = run(1, 1000);
    const b = run(2, 1000);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('hash evolves over time (the replay actually simulates)', () => {
    const a = run(7, 250);
    const b = run(7, 1000);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('an extra idle entity does not perturb other units (per-entity PRNG streams)', () => {
    const a = run(0xbeef, 1000);
    const b = run(0xbeef, 1000, true);
    for (let i = 0; i < 18; i++) {
      expect(b.state.posX[i], `posX of entity ${i}`).toBe(a.state.posX[i]);
      expect(b.state.posY[i], `posY of entity ${i}`).toBe(a.state.posY[i]);
      expect(b.state.hp[i], `hp of entity ${i}`).toBe(a.state.hp[i]);
      expect(b.state.suppression[i], `suppression of entity ${i}`).toBe(a.state.suppression[i]);
    }
  });
});
