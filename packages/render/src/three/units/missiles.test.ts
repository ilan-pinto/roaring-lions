import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPON_CLASS } from '@lions/sim';
import { AIR_LIFT_PX } from './frame-state';
import {
  INTERCEPT_SCALE,
  MISSILE_AIR_LIFT_PX,
  MISSILE_CAPACITY,
  MISSILE_GROUND_LIFT_PX,
  MISSILE_PROFILES,
  MISS_LATERAL_TILES,
  MISS_OVERSHOOT_TILES,
  SIM_PROJ_SPEED_TILES_S,
  SIM_TICK_S,
  TOP_ATTACK_WEAPON_IDS,
  hash01,
  interceptMissiles,
  missileDurationS,
  missileHeadingTurns,
  missilePointAt,
  missileVariantFor,
  pushMissile,
  spawnMissile,
  stepMissiles,
  type MissileLaunch,
  type MissileModel,
  type TargetTrack,
} from './missiles';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TUNING = path.resolve(HERE, '../../../../sim/src/tuning.ts');
const UNITS = path.resolve(HERE, '../../../../../data/units');

function launch(over: Partial<MissileLaunch> = {}): MissileLaunch {
  return {
    sx: 0, sy: 0, tx: 8, ty: 0, simDistTiles: 8, side: 0, cls: WEAPON_CLASS.atgm, weaponId: 'kornet',
    target: 1, willHit: true, shooterAir: false, targetAir: false, tick: 100, shooter: 0, ...over,
  };
}
function spawned(over: Partial<MissileLaunch> = {}): MissileModel {
  const m = spawnMissile(launch(over));
  if (m === null) throw new Error('fixture: spawnMissile refused a missile class');
  return m;
}
function track(x: number, y: number, alive = 1): TargetTrack {
  return { x: [0, x], y: [0, y], alive: [1, alive] };
}

describe('the flight time is the sim\'s own (spec D1)', () => {
  it('copies PROJ_SPEED for the three missile classes, read from tuning.ts as text', () => {
    const src = readFileSync(TUNING, 'utf8');
    const block = /export const PROJ_SPEED = new Int32Array\(\[([\s\S]*?)\]\)/.exec(src);
    if (block === null) throw new Error('PROJ_SPEED not found in tuning.ts -- the pin must be re-pointed, not deleted');
    const byName = new Map<string, number>();
    for (const m of block[1].matchAll(/(\d+),\s*\/\/\s*([a-z_]+)/g)) byName.set(m[2], Number(m[1]) / 65536);
    expect(SIM_PROJ_SPEED_TILES_S.atgm).toBe(byName.get('atgm'));
    expect(SIM_PROJ_SPEED_TILES_S.rpg).toBe(byName.get('rpg'));
    expect(SIM_PROJ_SPEED_TILES_S.heat).toBe(byName.get('heat'));
  });

  // n = ceil(dist / (speed x 0.05)) is prTicksLeft; the round resolves n - 1
  // ticks AFTER the fire tick, because stepProjectiles runs in the same tick
  // as combat (sim.ts's tick order) and decrements on the tick it was fired.
  // Measured at 9e9b0640: a 4-tile rpg7 fired at tick 17 resolved at 30 (n 14,
  // delta 13); a 7-tile Spike fired at 50 resolved at 84 (n 35, delta 34).
  it('quantises to whole 50 ms ticks, n - 1 of them, the way the sim resolves prTicksLeft', () => {
    expect(SIM_TICK_S).toBe(0.05);
    expect(missileDurationS(WEAPON_CLASS.atgm, 6)).toBeCloseTo(1.45, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 7)).toBeCloseTo(1.7, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 9)).toBeCloseTo(2.2, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 6.01)).toBeCloseTo(1.5, 9);
    expect(missileDurationS(WEAPON_CLASS.rpg, 4)).toBeCloseTo(0.65, 9);
    expect(missileDurationS(WEAPON_CLASS.rpg, 5.5)).toBeCloseTo(0.9, 9);
    expect(missileDurationS(WEAPON_CLASS.heat, 1.2)).toBeCloseTo(0.1, 9);
    // A same-tick resolution still draws for one tick: never zero.
    expect(missileDurationS(WEAPON_CLASS.atgm, 0)).toBeCloseTo(0.05, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 1e6)).toBe(6);
  });

  // Fix round 1: falsification (b) needs a boundary input this platform
  // actually hits, not just the original 6-tile case (which happens not to
  // trip it on this Node -- see the report). perTick = 4 * SIM_TICK_S =
  // 0.2, and 0.2 is not exactly representable in binary float: perTick * 3
  // is a hair ABOVE the true 0.6 (measured 0.6000000000000001), so dividing
  // it back by perTick reads a hair above the integer 3
  // (3.0000000000000004) even though the ground distance IS exactly three
  // ticks. Without the `- 1e-9` epsilon this rounds up to n = 4 instead of
  // n = 3, changing the animation's duration by a whole 50 ms tick for a
  // shot that should resolve in exactly three.
  it('the epsilon guards a real boundary: 3 exact ticks of atgm flight float-rounds a hair high (spec D1)', () => {
    const perTick = SIM_PROJ_SPEED_TILES_S.atgm * SIM_TICK_S;
    const dist = perTick * 3;
    // Confirms the boundary condition actually exists on this platform;
    // if this assertion itself ever goes false, the epsilon has nothing
    // left to guard for this case and the comment above should be revisited.
    expect(dist / perTick).toBeGreaterThan(3);
    expect(missileDurationS(WEAPON_CLASS.atgm, dist)).toBeCloseTo((3 - 1) * SIM_TICK_S, 12);
  });
});

describe('missileVariantFor (spec D2)', () => {
  it('flies the Spike top-attack and every other ATGM guided', () => {
    expect(missileVariantFor(WEAPON_CLASS.atgm, 'spike_atgm')).toBe('top_attack');
    for (const id of ['kornet', 'hellfire', 'manpad']) expect(missileVariantFor(WEAPON_CLASS.atgm, id)).toBe('guided');
  });

  it('flies every rpg-class weapon unguided and every heat warhead as a warhead', () => {
    for (const id of ['rpg7', 'rpg', 'spg9']) expect(missileVariantFor(WEAPON_CLASS.rpg, id)).toBe('unguided');
    expect(missileVariantFor(WEAPON_CLASS.heat, 'warhead')).toBe('warhead');
    // A top-attack id fired from a non-atgm class is not top-attack: the set
    // names a missile, not a string.
    expect(missileVariantFor(WEAPON_CLASS.rpg, 'spike_atgm')).toBe('unguided');
  });

  it('claims no other class', () => {
    for (const name of ['apfsds', 'he', 'small_arms', 'hmg', 'autocannon', 'mortar', 'rocket', 'interceptor', 'demolition']) {
      expect(missileVariantFor(WEAPON_CLASS[name], 'x')).toBeNull();
    }
  });

  it('names only weapons that ship, so a rename cannot silently drop the Spike to guided', () => {
    const ids = new Set<string>();
    for (const dir of ['kdf', 'enemy']) {
      for (const f of readdirSync(path.join(UNITS, dir))) {
        if (!f.endsWith('.json')) continue;
        const u = JSON.parse(readFileSync(path.join(UNITS, dir, f), 'utf8')) as { weapons?: { id: string; type: string }[] };
        for (const w of u.weapons ?? []) if (w.type === 'atgm') ids.add(w.id);
      }
    }
    expect(TOP_ATTACK_WEAPON_IDS.size).toBeGreaterThan(0);
    for (const id of TOP_ATTACK_WEAPON_IDS) expect(ids.has(id), id).toBe(true);
  });
});

describe('the path', () => {
  it('starts at the tube and ends at the hull, each at its own height (N7)', () => {
    const m = spawned();
    const start = missilePointAt(m, 0);
    expect(start.x).toBeCloseTo(0, 9);
    expect(start.y).toBeCloseTo(0, 9);
    expect(start.liftPx).toBeCloseTo(MISSILE_GROUND_LIFT_PX, 9);
    const end = missilePointAt(m, 1);
    expect(end.x).toBeCloseTo(8, 9);
    expect(end.y).toBeCloseTo(0, 9);
    expect(end.liftPx).toBeCloseTo(MISSILE_GROUND_LIFT_PX, 9);
    expect(MISSILE_AIR_LIFT_PX).toBe(AIR_LIFT_PX);
    const heli = spawned({ shooterAir: true });
    expect(missilePointAt(heli, 0).liftPx).toBe(MISSILE_AIR_LIFT_PX);
    const manpad = spawned({ weaponId: 'manpad', targetAir: true });
    expect(missilePointAt(manpad, 1).liftPx).toBeCloseTo(MISSILE_AIR_LIFT_PX, 9);
  });

  it('top-attack climbs to its apex at u = 0.40 and dives steeper than it climbed (N4)', () => {
    const m = spawned({ weaponId: 'spike_atgm', tx: 7, simDistTiles: 7 });
    expect(m.variant).toBe('top_attack');
    expect(m.apexPx).toBe(42); // 7 tiles x 6 px, inside 30..60
    const h = (u: number): number => missilePointAt(m, u).liftPx - MISSILE_GROUND_LIFT_PX;
    expect(h(0.4)).toBeCloseTo(42, 9);
    for (const u of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) expect(h(u)).toBeLessThan(42);
    const climb = (h(0.1) - h(0)) / 0.1;
    const dive = (h(0.9) - h(1)) / 0.1;
    expect(dive).toBeGreaterThan(climb);
    expect(spawned({ weaponId: 'spike_atgm', tx: 2, simDistTiles: 2 }).apexPx).toBe(30);
    expect(spawned({ weaponId: 'spike_atgm', tx: 20, simDistTiles: 20 }).apexPx).toBe(60);
  });

  it('guided weaves sideways and settles onto the line by impact (N5)', () => {
    const m = spawned();
    const off = [0.1, 0.25, 0.5, 0.75].map((u) => Math.abs(missilePointAt(m, u).y));
    expect(Math.max(...off)).toBeGreaterThan(0.02);
    for (const o of off) expect(o).toBeLessThanOrEqual(MISSILE_PROFILES.guided.weaveTiles + 1e-9);
    expect(Math.abs(missilePointAt(m, 0).y)).toBeLessThan(1e-9);
    expect(Math.abs(missilePointAt(m, 1).y)).toBeLessThan(1e-9);
  });

  // Fix round 1: falsification (d) needs a sample point where sin() is NOT
  // already zero, or the decay term is invisible -- at weaveCycles = 1.5 the
  // sine itself returns to 0 at both u = 0 and u = 1, so the original
  // endpoint-only assertions above pass with or without `* (1 - p)`. Solving
  // 2*pi*weaveCycles*p = pi/2 + 2*pi*k for k = 1 gives p = (1.25) / weaveCycles
  // -- a point near the END of flight (p ~= 0.833 at the shipped 1.5 cycles)
  // where sin() is exactly +1, so the offset there is decay alone.
  it('the weave decays by (1 - p) at a point where sin() is not already zero (N5)', () => {
    const m = spawned();
    const prof = MISSILE_PROFILES.guided;
    const p = 1.25 / prof.weaveCycles;
    const sinAtP = Math.sin(2 * Math.PI * prof.weaveCycles * p);
    expect(sinAtP).toBeCloseTo(1, 9); // confirms this p actually isolates decay from the sine term
    const y = missilePointAt(m, p).y;
    const expected = prof.weaveTiles * sinAtP * (1 - p);
    expect(y).toBeCloseTo(expected, 9);
    // Without decay this would read the full weaveTiles (sin = 1, no shrink)
    // -- nearly 6x the decayed value at this p -- so this bound is the one
    // that must go red if `* (1 - p)` is dropped.
    expect(Math.abs(y)).toBeLessThan(prof.weaveTiles * 0.5);
  });

  it('unguided flies a flat hump with no weave (N6)', () => {
    const m = spawned({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7', tx: 4, simDistTiles: 4 });
    expect(m.variant).toBe('unguided');
    expect(m.apexPx).toBe(4); // 4 tiles x 1.0, inside 2..8
    for (const u of [0.2, 0.5, 0.8]) expect(missilePointAt(m, u).y).toBe(0);
  });

  it('reports its heading along the ground, in turns', () => {
    const east = spawned({ weaponId: 'rpg7', cls: WEAPON_CLASS.rpg });
    expect(missileHeadingTurns(east, 0.5)).toBeCloseTo(0, 6);
    const south = spawned({ weaponId: 'rpg7', cls: WEAPON_CLASS.rpg, tx: 0, ty: 8 });
    expect(missileHeadingTurns(south, 0.5)).toBeCloseTo(0.25, 6);
  });

  // Fix round 2: a guided (or top-attack) round weaves off the launch-target
  // line from its very first sampled fraction, so sampling forward from
  // u = 0 to get a heading tilts the answer by the weave, not just the
  // ground track. The brief is explicit that u = 0 uses the launch-to-target
  // line instead. Measured at the shipped weave (0.12 tiles, 1.5 cycles): a
  // forward sample tilted a due-east launch by ~7.8 degrees (0.0218 turns)
  // where the chord itself is exactly 0.
  it('at u = 0 the heading is the launch-to-target chord, not a weave-tilted forward sample', () => {
    const east = spawned(); // guided (kornet): weaves from u = 0
    expect(missileHeadingTurns(east, 0)).toBeCloseTo(0, 9);
    const diag = spawned({ tx: 8, ty: 8 });
    expect(missileHeadingTurns(diag, 0)).toBeCloseTo(0.125, 6); // 45 degrees
  });
});

describe('guidance and misses', () => {
  it('a guided missile follows its live target and freezes on the last place it saw it', () => {
    const list = [spawned()];
    stepMissiles(list, 0.1, track(9, 1));
    expect(list[0].tx).toBe(9);
    expect(list[0].ty).toBe(1);
    stepMissiles(list, 0.1, track(12, 5, 0));
    expect(list[0].tx).toBe(9);
    expect(list[0].tracking).toBe(false);
  });

  it('an unguided rocket keeps its launch aim', () => {
    const list = [spawned({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7' })];
    stepMissiles(list, 0.1, track(9, 1));
    expect(list[0].tx).toBe(8);
  });

  it('a miss flies 0.8 tiles past the target, a hashed step to the side, and does not track (N17)', () => {
    const m = spawned({ willHit: false });
    expect(m.miss).toBe(true);
    expect(m.tracking).toBe(false);
    expect(m.tx).toBeCloseTo(8 + MISS_OVERSHOOT_TILES, 9);
    expect(Math.abs(m.ty)).toBeLessThanOrEqual(MISS_LATERAL_TILES);
    // Deterministic by (tick, shooter): a capture is repeatable.
    expect(spawned({ willHit: false }).ty).toBe(m.ty);
    expect(spawned({ willHit: false, tick: 101 }).ty).not.toBe(m.ty);
  });

  it('hash01 is in [0, 1) and stable', () => {
    for (let i = 0; i < 200; i++) {
      const v = hash01(i, 7 - i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash01(3, 4)).toBe(hash01(3, 4));
  });
});

describe('stepping, landing and intercept', () => {
  it('lands on the frame its sim-synced duration elapses, with its profile\'s power (N14)', () => {
    // 8 tiles at 4 tiles/s: n = 40, so 39 ticks = 1.95 s. dt = 1/64 is exact
    // in binary, so the frame count is not at the mercy of float summation.
    const list = [spawned()];
    let landed: ReturnType<typeof stepMissiles> = [];
    let frames = 0;
    while (list.length > 0 && frames < 1000) {
      landed = stepMissiles(list, 1 / 64, track(8, 0));
      frames++;
    }
    expect(frames).toBe(125);
    expect(landed).toHaveLength(1);
    expect(landed[0].x).toBeCloseTo(8, 9);
    expect(landed[0].power).toBe(MISSILE_PROFILES.guided.impactPower);
    expect(landed[0].scale).toBe(1);
    expect(landed[0].miss).toBe(false);
  });

  it('a warhead draws nothing and still lands (N3)', () => {
    const m = spawned({ cls: WEAPON_CLASS.heat, weaponId: 'warhead', tx: 1.2, simDistTiles: 1.2 });
    expect(MISSILE_PROFILES[m.variant].drawn).toBe(false);
    const list = [m];
    const out = stepMissiles(list, 0.2, track(1.2, 0));
    expect(out).toHaveLength(1);
    expect(out[0].power).toBe(0.3);
  });

  it('an APS intercept detonates the missiles aimed at that target, where they are, at half scale (spec D4)', () => {
    const list = [spawned(), spawned({ target: 2 })];
    stepMissiles(list, 0.975, { x: [0, 8, 8], y: [0, 0, 0], alive: [1, 1, 1] }); // half of 1.95 s
    const out = interceptMissiles(list, 1, 0);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(4, 1);
    expect(out[0].scale).toBe(INTERCEPT_SCALE);
    expect(out[0].power).toBeCloseTo(MISSILE_PROFILES.guided.impactPower * INTERCEPT_SCALE, 9);
    expect(list).toHaveLength(1);
    expect(list[0].target).toBe(2);
  });

  it('an intercept names the ROUND: two shooters on one target, only the matching one detonates (sim aps carries shooter)', () => {
    const list = [spawned({ shooter: 3 }), spawned({ shooter: 5 })];
    stepMissiles(list, 0.5, track(8, 0));
    const out = interceptMissiles(list, 1, 5);
    expect(out).toHaveLength(1);
    expect(list).toHaveLength(1);
    expect(list[0].shooter).toBe(3);
  });

  it('one aps event kills ONE round -- the oldest -- when a shooter has two in flight at one target', () => {
    const list = [spawned({ tick: 1 }), spawned({ tick: 2 })];
    stepMissiles(list, 0.5, track(8, 0));
    expect(interceptMissiles(list, 1, 0)).toHaveLength(1);
    expect(list).toHaveLength(1);
    expect(list[0].seed).toBe(spawned({ tick: 2 }).seed);
  });

  it("intercepts a MISS too -- the sim's APS engages a shaped charge hit or miss -- and it detonates, not lands", () => {
    const list = [spawned({ willHit: false })];
    expect(list[0].miss).toBe(true);
    stepMissiles(list, 0.5, track(8, 0));
    const out = interceptMissiles(list, 1, 0);
    expect(out).toHaveLength(1);
    expect(out[0].scale).toBe(INTERCEPT_SCALE);
    // Killed in the air, so it marks no ground: the scorch is a MISS's.
    expect(out[0].miss).toBe(false);
    expect(list).toHaveLength(0);
    expect(stepMissiles(list, 5, track(8, 0))).toHaveLength(0);
  });

  it('holds at most MISSILE_CAPACITY, evicting the oldest', () => {
    const list: MissileModel[] = [];
    for (let i = 0; i < MISSILE_CAPACITY + 3; i++) pushMissile(list, spawned({ tick: i }));
    expect(list).toHaveLength(MISSILE_CAPACITY);
    expect(list[0].seed).toBe(spawned({ tick: 3 }).seed);
  });
});
