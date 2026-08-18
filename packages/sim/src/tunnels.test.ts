import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { pointAtDistance, routeLength, SURFACE_SECONDS, TRAIL_DECAY, TRAIL_MAX } from './tunnels';
import { STRIKE_DELAY_TICKS } from './tuning';
import type { UnitTypeJson } from './sim';

const STRAIGHT: [number, number][] = [[0, 0], [3, 0]];
const ELBOW: [number, number][] = [[0, 0], [3, 0], [3, 4]];
const DEGENERATE: [number, number][] = [[0, 0], [3, 0], [3, 0], [3, 4]];

/** Minimal unarmed unit that can dig — same shape as combat.test.ts's INF,
 *  zeroed of weapons, with the ability that makes assignDigger meaningful. */
const DIGGER_TYPE: UnitTypeJson = {
  id: 'tn_digger',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['dig_tunnel'],
  weapons: [],
};

/** Plain infantry that goes looking — DIGGER_TYPE without the shovel.
 *  Optics 1.0 a couple of tiles from fresh spoil identifies the route well
 *  inside the 400-tick budget the finding tests allow. */
const SCOUT_TYPE: UnitTypeJson = {
  id: 'tn_scout',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

describe('route geometry', () => {
  it('measures a straight run', () => {
    expect(fx.toNumber(routeLength(STRAIGHT))).toBeCloseTo(3, 2);
  });

  it('measures a polyline as the sum of its legs', () => {
    // 3 across then 4 down — the classic, so an error in leg summation is obvious.
    expect(fx.toNumber(routeLength(ELBOW))).toBeCloseTo(7, 2);
  });

  it('walks to a point partway along the first leg', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(1.5));
    expect(fx.toNumber(x)).toBeCloseTo(1.5, 2);
    expect(fx.toNumber(y)).toBeCloseTo(0, 2);
  });

  it('walks past the elbow into the second leg', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(5));
    expect(fx.toNumber(x)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y)).toBeCloseTo(2, 2);
  });

  it('clamps past the end to the final point rather than extrapolating', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(999));
    expect(fx.toNumber(x)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y)).toBeCloseTo(4, 2);
  });

  it('clamps before the start to the first point', () => {
    const [x, y] = pointAtDistance(ELBOW, fx.from(-5));
    expect(fx.toNumber(x)).toBeCloseTo(0, 2);
    expect(fx.toNumber(y)).toBeCloseTo(0, 2);
  });

  it('handles routes with repeated points (degenerate legs)', () => {
    // DEGENERATE has a repeated point at [3, 0], creating a zero-length leg.
    // Verify pointAtDistance treats it correctly: the zero-length leg is skipped,
    // and distances map to the same positions as a route without it.
    expect(fx.toNumber(routeLength(DEGENERATE))).toBeCloseTo(7, 2);

    // Walking partway into the first real leg should work.
    const [x1, y1] = pointAtDistance(DEGENERATE, fx.from(1.5));
    expect(fx.toNumber(x1)).toBeCloseTo(1.5, 2);
    expect(fx.toNumber(y1)).toBeCloseTo(0, 2);

    // Walking past the degenerate point into the final leg should work.
    const [x2, y2] = pointAtDistance(DEGENERATE, fx.from(5));
    expect(fx.toNumber(x2)).toBeCloseTo(3, 2);
    expect(fx.toNumber(y2)).toBeCloseTo(2, 2);
  });
});

import { Sim, TICKS_PER_SECOND } from './sim';

const ROUTE = { id: 'tn_a', points: [[2, 2], [8, 2]] as const, dig_tiles_per_s: 1 };

function simWithRoute() {
  const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
  const idx = sim.addTunnel(ROUTE);
  return { sim, idx };
}

describe('tunnel state', () => {
  it('registers a route with its measured length and no progress', () => {
    const { sim, idx } = simWithRoute();
    expect(idx).toBe(0);
    expect(sim.tunnelCount).toBe(1);
    expect(sim.tnAlive[idx]).toBe(1);
    expect(sim.tnProgress[idx]).toBe(0);
    expect(fx.toNumber(sim.tnLength[idx])).toBeCloseTo(6, 2);
    expect(sim.tnVentOpen[idx]).toBe(0);
  });

  it('starts every unit on the surface', () => {
    const { sim } = simWithRoute();
    expect(sim.state.tunnelIn[0]).toBe(-1);
  });

  it('refuses a route with fewer than two points', () => {
    const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
    expect(() => sim.addTunnel({ id: 'bad', points: [[1, 1]], dig_tiles_per_s: 1 })).toThrow(
      /at least two points/
    );
  });
});

describe('digging', () => {
  it('advances progress only while a living digger is assigned', () => {
    const { sim, idx } = simWithRoute();
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.tnProgress[idx]).toBe(0); // no digger, no dig

    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);
    for (let t = 0; t < 20; t++) sim.tick();
    expect(fx.toNumber(sim.tnProgress[idx])).toBeCloseTo(1, 1); // 1 tile/s for 1 s
  });

  it('opens the vent and emits once when the head reaches the end', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    const opened = [];
    for (let t = 0; t < 200; t++) {
      for (const e of sim.tick()) if (e.kind === 'ventOpened') opened.push(e);
    }
    expect(sim.tnVentOpen[idx]).toBe(1);
    expect(opened).toHaveLength(1);
    expect(opened[0].tunnel).toBe(idx);
  });

  it('stops advancing when the digger dies but leaves the route standing', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);
    for (let t = 0; t < 20; t++) sim.tick();
    const halted = sim.tnProgress[idx];
    sim.debugKill(id);
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.tnProgress[idx]).toBe(halted);
    expect(sim.tnAlive[idx]).toBe(1); // the tunnel that exists still exists
  });

  it('stamps surface spoil on the tiles the head passes under, and only those', () => {
    const { sim, idx } = simWithRoute(); // ROUTE runs (2,2) -> (8,2)
    const digger = sim.addUnitType(DIGGER_TYPE);
    const id = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.assignDigger(idx, id);

    sim.tick();
    // A single tick's advance (~0.05 tile at 1 tile/s) is far under the
    // interior loop's half-tile step, so the loop body never runs on the
    // first tick — the mouth tile is only marked by the trailing endpoint
    // stamp. If that stamp were ever dropped, tick one would dig nothing.
    // One decay step is already gone: stepFields runs late in the same tick,
    // after stepDigging's stamp, and tickCount 0 is a multiple of
    // TRAIL_DECAY_EVERY, so the fresh stamp weathers once before tick()
    // returns. That ordering is deliberate — decay sits where smoke decay
    // always has — so the expectation moved, not the decay.
    expect(sim.trail[2 * sim.width + 2]).toBe(TRAIL_MAX - TRAIL_DECAY); // mouth tile (2,2)

    for (let t = 1; t < 20; t++) sim.tick(); // 20 ticks total: progress crosses 1 tile
    expect(sim.trail[2 * sim.width + 2]).toBe(TRAIL_MAX); // still dug
    expect(sim.trail[2 * sim.width + 3]).toBe(TRAIL_MAX); // one tile in: dug

    expect(sim.trail[2 * sim.width + 4]).toBe(0); // ahead of the head: undug
    expect(sim.trail[10 * sim.width + 10]).toBe(0); // nowhere near the route
  });
});

describe('trail decay', () => {
  it('weathers spoil toward zero without going negative', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    for (let t = 0; t < 40; t++) sim.tick();
    const tile = 2 * 16 + 2;
    const fresh = sim.trail[tile];
    expect(fresh).toBeGreaterThan(0);

    sim.debugKill(sim.tnDigger[idx]); // stop new spoil
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.trail[tile]).toBeLessThan(fresh);

    for (let t = 0; t < 4000; t++) sim.tick();
    expect(sim.trail[tile]).toBe(0); // floors, never wraps
  });
});

describe('finding a route', () => {
  it('a unit with line of sight to fresh spoil eventually identifies the route', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    const scout = sim.addUnitType(SCOUT_TYPE);
    sim.spawn(scout, 0, fx.from(4.5), fx.from(4.5));
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tunnelContactLevel(0, idx)).toBe(2);
  });

  it('stays unknown to a side with nobody near it', () => {
    const { sim, idx } = simWithRoute();
    const digger = sim.addUnitType(DIGGER_TYPE);
    sim.assignDigger(idx, sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5)));
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tunnelContactLevel(0, idx)).toBe(0);
  });

  it('mark_tunnel identifies it outright', () => {
    const { sim, idx } = simWithRoute();
    sim.identifyTunnelTo(0, idx);
    expect(sim.tunnelContactLevel(0, idx)).toBe(2);
    expect(sim.tunnelContactLevel(1, idx)).toBe(0); // one side only
  });
});

/** Armed infantry whose duel settles nothing: a working rifle (the shooter
 *  genuinely hunts, which is what makes "cannot be selected" meaningful) on
 *  a deep hull with zero weapon suppression, so 200 ticks of mutual fire
 *  kill and pin nobody. The containment assertions then read the leak
 *  itself — curTarget, hp, suppression — rather than the outcome of a
 *  coin-flip firefight between two identical units. */
const RIFLE_TYPE: UnitTypeJson = {
  id: 'tn_rifle',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'tn_rifle_w',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6.4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      rof_per_min: 300,
    },
  ],
};

function belowGround() {
  const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
  const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
  const rifle = sim.addUnitType(RIFLE_TYPE);
  const hidden = sim.spawn(rifle, 1, fx.from(4.5), fx.from(6.5));
  const shooter = sim.spawn(rifle, 0, fx.from(6.5), fx.from(6.5));
  sim.putInTunnel(hidden, idx);
  return { sim, hidden, shooter, idx };
}

describe('a unit underground is contained', () => {
  it('cannot be selected as a target', () => {
    const { sim, hidden, shooter } = belowGround();
    for (let t = 0; t < 200; t++) sim.tick();
    expect(sim.state.alive[hidden]).toBe(1);
    expect(sim.state.curTarget[shooter]).not.toBe(hidden);
  });

  it('cannot be reached by splash', () => {
    const { sim, hidden } = belowGround();
    const hpBefore = sim.state.hp[hidden];
    // A shell landing directly on top of the tunnel.
    sim.debugSplash(fx.from(4.5), fx.from(6.5), fx.from(4), fx.from(500), fx.from(1), -1, -1);
    expect(sim.state.hp[hidden]).toBe(hpBefore);
  });

  it('cannot be suppressed', () => {
    const { sim, hidden } = belowGround();
    sim.debugSuppress(hidden, fx.from(1.5));
    expect(sim.state.suppression[hidden]).toBe(0);
  });
});

/** AT team with a slow guided missile: ATGM flight is 4 tiles/s, so a 6-tile
 *  shot spends 30 ticks in the air — a wide window to submerge the target
 *  mid-flight. No suppression stat, for the same reason RIFLE_TYPE's rifle
 *  carries none. */
const ATGM_TYPE: UnitTypeJson = {
  id: 'tn_at',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.7 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.5 },
  weapons: [
    {
      id: 'tn_atgm',
      type: 'atgm',
      range_tiles: 9,
      effective_range_tiles: 7.2,
      accuracy: 0.9,
      penetration: 900,
      damage: 400,
      rof_per_min: 3,
    },
  ],
};

/** Loitering munition, carriers.test.ts's shape: one warhead, one dive. */
const DRONE_TYPE: UnitTypeJson = {
  id: 'tn_loiter',
  role: 'drone',
  hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 }, suppression_resistance: 1 },
  mobility: { speed_tiles_s: 3.0, turn_rate_deg_s: 240 },
  sensors: { optics: 1.4, sight_tiles: 14, signature: 0.3 },
  abilities: ['kamikaze'],
  weapons: [
    {
      id: 'tn_warhead',
      type: 'heat',
      range_tiles: 1.2,
      effective_range_tiles: 1.2,
      accuracy: 0.9,
      penetration: 500,
      damage: 600,
      splash_tiles: 1.2,
      suppression: 70,
      rof_per_min: 60,
    },
  ],
};

describe('containment holds against strikes, drones, sight and shells in flight', () => {
  it('an off-map strike does not kill through the earth', () => {
    const { sim, hidden, shooter } = belowGround();
    const hpBefore = sim.state.hp[hidden];
    sim.queueCommand({ kind: 'callStrike', caller: shooter, x: fx.from(4.5), y: fx.from(6.5) });
    for (let t = 0; t < STRIKE_DELAY_TICKS + 5; t++) sim.tick();
    expect(sim.state.alive[hidden]).toBe(1);
    expect(sim.state.hp[hidden]).toBe(hpBefore);
    expect(sim.state.suppression[hidden]).toBe(0);
  });

  it('a loitering munition does not dive at three metres of dirt', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const drone = sim.spawn(sim.addUnitType(DRONE_TYPE), 0, fx.from(6.5), fx.from(6.5));
    const hidden = sim.spawn(sim.addUnitType(SCOUT_TYPE), 1, fx.from(4.5), fx.from(6.5));
    sim.putInTunnel(hidden, idx);
    sim.identifyTo(0, hidden); // recon cue: the side knows, the earth still protects
    for (let t = 0; t < 100; t++) sim.tick();
    expect(sim.state.alive[hidden]).toBe(1); // not killed through the roof
    expect(sim.state.alive[drone]).toBe(1); // did not waste itself on dirt
    expect(sim.state.curTarget[drone]).toBe(-1);
  });

  it('projectHit never offers a shot the earth refuses', () => {
    const { sim, hidden, shooter } = belowGround();
    // Fresh, fully identified contact — the exact window where, without the
    // guard, the panel would offer a shot selectTarget now refuses.
    sim.identifyTo(0, hidden);
    expect(sim.projectHit(shooter, hidden).kind).toBe('noSolution');
  });

  it('an underground unit is unseen, and stale contact decays to lost', () => {
    const { sim, hidden } = belowGround();
    sim.identifyTo(0, hidden);
    expect(sim.contactLevel(0, hidden)).toBe(2);
    // From full confidence, CONTACT_DECAY crosses LOST_AT in ~322 ticks.
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.contactLevel(0, hidden)).toBe(0);
  });

  it('a shell already in flight lands on the dirt when its target submerges', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    sim.spawn(sim.addUnitType(ATGM_TYPE), 0, fx.from(10.5), fx.from(6.5));
    const victim = sim.spawn(sim.addUnitType(SCOUT_TYPE), 1, fx.from(4.5), fx.from(6.5));
    // Let the AT team find and launch at the victim ON the surface; submerge
    // only once a would-hit round is actually in the air.
    let launched = false;
    for (let t = 0; t < 900 && !launched; t++) {
      for (const e of sim.tick()) if (e.kind === 'fire' && e.willHit) launched = true;
    }
    expect(launched).toBe(true);
    sim.putInTunnel(victim, idx);
    const hpBelow = sim.state.hp[victim];
    const vx = sim.state.posX[victim];
    const vy = sim.state.posY[victim];
    // Count only the redirected round: a ground impact at EXACTLY the
    // victim's position. A scattered would-miss lands at least SCATTER_BASE
    // (0.5 tiles) off the target, so it can never satisfy this. The hp and
    // alive equalities below carry the containment proof on their own; this
    // pins that the round became a ground impact rather than vanishing.
    let groundImpacts = 0;
    for (let t = 0; t < 60; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'nearMiss' && e.x === vx && e.y === vy) groundImpacts++;
      }
    }
    expect(sim.state.alive[victim]).toBe(1);
    expect(sim.state.hp[victim]).toBe(hpBelow);
    expect(groundImpacts).toBeGreaterThan(0); // the round landed on the dirt above
  });
});

/** A live route with an open vent (unless `dug: false`), a rifle team below,
 *  and an enemy rifle squad three tiles east of the vent — the shape every
 *  surfacing test starts from. `dug: true` fast-forwards the dig by writing
 *  the head's progress and the vent flag directly, exactly what simWithRoute's
 *  digger would have left behind after ~160 ticks. `wallAcrossVent` raises
 *  terrain between vent and target, so the vent tile has no shot at anything.
 *  `unit` swaps the rifle for a variant when a test needs a different ROF. */
function readyToVent(opts: { dug: boolean; wallAcrossVent?: boolean; unit?: UnitTypeJson }) {
  const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
  const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
  const ventX = 12;
  const ventY = 6;
  const rifle = sim.addUnitType(opts.unit ?? RIFLE_TYPE);
  const target = sim.spawn(rifle, 0, fx.from(15.5), fx.from(6.5)); // 3 tiles from the vent
  const hidden = sim.spawn(rifle, 1, fx.from(4.5), fx.from(6.5));
  sim.putInTunnel(hidden, idx);
  if (opts.dug) {
    sim.tnProgress[idx] = sim.tnLength[idx];
    sim.tnVentOpen[idx] = 1;
  }
  if (opts.wallAcrossVent) {
    sim.setBlocked(13, 6, true);
    sim.setBlocked(14, 6, true);
  }
  return { sim, idx, hidden, target, ventX, ventY };
}

describe('surfacing', () => {
  it('does not surface while the vent is still closed', () => {
    const { sim, hidden } = readyToVent({ dug: false });
    for (let t = 0; t < 200; t++) sim.tick();
    expect(sim.state.tunnelIn[hidden]).toBeGreaterThanOrEqual(0);
  });

  it('surfaces at the vent when a target is in range and in sight of it', () => {
    const { sim, hidden, ventX, ventY } = readyToVent({ dug: true });
    let surfaced = false;
    for (let t = 0; t < 200 && !surfaced; t++) {
      for (const e of sim.tick()) if (e.kind === 'surfaced' && e.entity === hidden) surfaced = true;
    }
    expect(surfaced).toBe(true);
    expect(sim.state.tunnelIn[hidden]).toBe(-1);
    expect(fx.toNumber(sim.state.posX[hidden])).toBeCloseTo(ventX + 0.5, 1);
    expect(fx.toNumber(sim.state.posY[hidden])).toBeCloseTo(ventY + 0.5, 1);
  });

  it('stays up for the full window even under fire that would pin it', () => {
    const { sim, hidden } = readyToVent({ dug: true });
    let surfacedAt = -1;
    for (let t = 0; t < 400; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'surfaced' && e.entity === hidden) surfacedAt = t;
      }
      if (surfacedAt >= 0 && t === surfacedAt + 1) {
        sim.debugSuppress(hidden, fx.from(2)); // well past PIN_AT
      }
      if (surfacedAt >= 0 && t < surfacedAt + SURFACE_SECONDS * TICKS_PER_SECOND) {
        expect(sim.state.tunnelIn[hidden]).toBe(-1); // still exposed
      }
    }
    expect(surfacedAt).toBeGreaterThanOrEqual(0);
  });

  it('submerges once the volley is spent and the window has elapsed', () => {
    const { sim, hidden } = readyToVent({ dug: true });
    let submerged = false;
    for (let t = 0; t < 600 && !submerged; t++) {
      for (const e of sim.tick()) if (e.kind === 'submerged' && e.entity === hidden) submerged = true;
    }
    expect(submerged).toBe(true);
    expect(sim.state.tunnelIn[hidden]).toBeGreaterThanOrEqual(0);
  });

  it('does not surface into a wall it cannot shoot past', () => {
    const { sim, hidden } = readyToVent({ dug: true, wallAcrossVent: true });
    for (let t = 0; t < 300; t++) sim.tick();
    expect(sim.state.tunnelIn[hidden]).toBeGreaterThanOrEqual(0);
  });

  it('a burst that outlives the window still brings the unit home', () => {
    // One shot every 60 ticks — exactly the window. The second shot always
    // lands after the exposure clock has run out, so the submerge decision
    // cannot be an edge check on the window-end tick alone: that tick sees a
    // half-finished burst, and the finish happens later, in ordinary combat.
    // Left edge-triggered, the unit is stranded on the surface forever with
    // homeTunnel latched, silently — nothing fails, it just never goes home.
    const slow: UnitTypeJson = {
      ...RIFLE_TYPE,
      id: 'tn_rifle_slow',
      weapons: [
        {
          id: 'tn_rifle_slow_w',
          type: 'small_arms',
          range_tiles: 8,
          effective_range_tiles: 6.4,
          accuracy: 0.6,
          penetration: 8,
          damage: 15,
          rof_per_min: 20,
        },
      ],
    };
    const { sim, hidden } = readyToVent({ dug: true, unit: slow });
    let submerged = false;
    for (let t = 0; t < 400 && !submerged; t++) {
      for (const e of sim.tick()) if (e.kind === 'submerged' && e.entity === hidden) submerged = true;
    }
    expect(submerged).toBe(true);
    expect(sim.state.tunnelIn[hidden]).toBeGreaterThanOrEqual(0);
  });
});
