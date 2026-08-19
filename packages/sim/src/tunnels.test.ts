import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { pointAtDistance, routeLength, SURFACE_SECONDS, TRAIL_DECAY, TRAIL_MAX } from './tunnels';
import { STRIKE_DELAY_TICKS } from './tuning';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

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

// Identified route knowledge is permanent; a suspected blip is not. Contact
// decay exists because units move — a tunnel is fixed geography, so once a
// side has established where a route runs the fact cannot go stale. The
// ledger already carries tunnel marks BETWEEN missions; a mark expiring in
// ~16 s within one mission contradicted that, and it made mark_tunnel
// self-defeating: the handover expired before the charge team finished
// walking (observed live as a charge dying at 117/160 ticks).
describe('identified persistence', () => {
  it('an identified route stays identified through 450 unobserved ticks, and a late charge completes', () => {
    // chargeScenario has no observer at all: the yahalom's sight is 0 by
    // fixture design and the occupant is underground, so from the moment of
    // the handover nothing ever refreshes the contact. Under decay this hit
    // `lost` at ~322 ticks; the charge below then started late enough to be
    // impossible.
    const { sim, idx, yahalom } = chargeScenario({ revealed: true });
    const events: SimEvent[] = [];
    for (let t = 0; t < 450; t++) events.push(...sim.tick());
    expect(sim.tunnelContactLevel(0, idx)).toBe(2);
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    let collapsed = false;
    for (let t = 0; t < 400 && !collapsed; t++) {
      for (const e of sim.tick()) {
        events.push(e);
        if (e.kind === 'tunnelCollapsed') collapsed = true;
      }
    }
    expect(collapsed).toBe(true);
    // And the ladder never emitted `lost` for it — the transition is
    // structurally unreachable at identified, not merely un-hit.
    expect(events.some((e) => e.kind === 'tunnelContact' && e.level === 'lost')).toBe(false);
  });

  it('a suspected route still decays to lost with nobody watching', () => {
    // This is the assertion that proves the fix did not simply switch decay
    // off: an unconfirmed blip fading is correct, because the fact was
    // never established. A scout far enough from one spoil tile climbs
    // slowly; the loop stops the tick suspicion registers, the spoil is
    // then wiped (weathered), and with strength zero the blip must fade
    // through `lost` back to unknown.
    const { sim, idx } = simWithRoute();
    const scout = sim.addUnitType(SCOUT_TYPE);
    sim.spawn(scout, 0, fx.from(7.5), fx.from(7.5));
    sim.trail[2 * 16 + 2] = TRAIL_MAX; // one spoil tile at the mouth (2,2)
    let level: number = 0;
    for (let t = 0; t < 600 && level < 1; t++) {
      sim.tick();
      sim.trail[2 * 16 + 2] = TRAIL_MAX; // hold the spoil fresh while watched
      level = sim.tunnelContactLevel(0, idx);
    }
    expect(level).toBe(1); // suspected, and never identified in one leap
    sim.trail.fill(0); // the trail weathers away
    const events: SimEvent[] = [];
    for (let t = 0; t < 600; t++) events.push(...sim.tick());
    expect(sim.tunnelContactLevel(0, idx)).toBe(0);
    expect(
      events.some((e) => e.kind === 'tunnelContact' && e.level === 'lost' && e.side === 0)
    ).toBe(true);
  });
});

/** Armed infantry whose duel settles nothing: working rifles on both sides
 *  (the surface shooter genuinely hunts, which is what makes "cannot be
 *  selected" meaningful; the underground rifle is what proves the earth
 *  keeps fire and sight in as well as out) on a deep hull with zero weapon
 *  suppression, so the firefights the surfacing tests do allow kill and pin
 *  nobody. The containment assertions then read any leak directly —
 *  curTarget, fire events, hp, suppression, contact — rather than the
 *  outcome of a coin-flip firefight between two identical units. */
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

  it('does not fire from underground even at an identified enemy', () => {
    const { sim, hidden, shooter } = belowGround();
    // Identified contacts both ways: the exact state where, without the
    // outbound guard, stepCombat lets the man below ground shoot
    // untargetable rounds out of bare dirt at a two-tile contact.
    sim.identifyTo(0, hidden);
    sim.identifyTo(1, shooter);
    const hpBefore = sim.state.hp[shooter];
    let firesFromBelow = 0;
    for (let t = 0; t < 200; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'fire' && e.shooter === hidden) firesFromBelow++;
      }
    }
    expect(firesFromBelow).toBe(0);
    expect(sim.state.hp[shooter]).toBe(hpBefore);
  });

  it('does not spot for its side while underground', () => {
    const { sim, shooter } = belowGround();
    // The surface enemy stands two tiles from the tunnel, in the open; the
    // underground rifle is the only unit its side has. If the earth blocks
    // sight outbound, the side's contact on that enemy never climbs.
    for (let t = 0; t < 200; t++) sim.tick();
    expect(sim.contactLevel(1, shooter)).toBe(0);
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

/** Charge team: `tunnel_charge` on a deep, unarmed hull — and blind. Sight 0
 *  matters: a team with working optics parked on fresh spoil identifies the
 *  route through ordinary detection mid-test, and the "will not charge an
 *  unidentified route" case silently stops testing the gate. trailStrengthFor
 *  scans ceil(sight) tiles and MIN_DETECT_DIST_SQ skips the tile the unit
 *  stands on, so sight 0 sees no spoil, ever. */
const YAHALOM_TYPE: UnitTypeJson = {
  id: 'tn_yahalom',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 0, signature: 0.6 },
  abilities: ['tunnel_charge'],
  weapons: [],
};

/** The man below: RIFLE_TYPE's deep hull behind a one-round-a-minute rifle.
 *  Slow on purpose. A surfaced occupant is held up by stepSurfacing's
 *  level-triggered submerge until its volley is spent, and at rof 1 the
 *  second round is ~1200 ticks out — so it is still above ground when the
 *  charge completes ~170 ticks in. RIFLE_TYPE's 300 rpm finishes the volley
 *  and takes the unit back down at ~tick 70, straight into the collapse the
 *  surfaced test needs it to survive. */
const MOLE_TYPE: UnitTypeJson = {
  id: 'tn_mole',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'tn_mole_w',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6.4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      rof_per_min: 1,
    },
  ],
};

/** A route with visible spoil near its vent end, a charge team half a tile
 *  from it, and an occupant below — the shape every collapse test starts
 *  from. The trail is stamped directly on tiles (10,6) and (11,6) so the
 *  scenario carries a dug route's real surface state; the charge itself no
 *  longer keys on spoil (nearestRouteTileDistSq measures to the route's own
 *  tiles), so in every variant the identified gate is the only thing between
 *  the team and the charge. `revealed` hands side 0 the identification via
 *  identifyTunnelTo, mark_tunnel's own path. `surfaced` opens the vent
 *  (readyToVent's fast-forward) so the occupant pops up at the charge team
 *  and is above ground when the route comes down. */
function chargeScenario(opts: { revealed: boolean; surfaced?: boolean }) {
  const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
  const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
  const yahalom = sim.spawn(sim.addUnitType(YAHALOM_TYPE), 0, fx.from(11.5), fx.from(7.0));
  const occupant = sim.spawn(sim.addUnitType(MOLE_TYPE), 1, fx.from(4.5), fx.from(6.5));
  sim.putInTunnel(occupant, idx);
  sim.trail[6 * sim.width + 10] = TRAIL_MAX;
  sim.trail[6 * sim.width + 11] = TRAIL_MAX;
  if (opts.surfaced === true) {
    sim.tnProgress[idx] = sim.tnLength[idx];
    sim.tnVentOpen[idx] = 1;
  }
  if (opts.revealed) sim.identifyTunnelTo(0, idx);
  return { sim, idx, yahalom, occupant };
}

describe('collapsing a route', () => {
  it('will not charge a route the side has not identified', () => {
    const { sim, idx, yahalom } = chargeScenario({ revealed: false });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tnAlive[idx]).toBe(1);
  });

  it('collapses after the full charge time and kills the occupants', () => {
    const { sim, idx, yahalom, occupant } = chargeScenario({ revealed: true });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    let collapsed: Extract<SimEvent, { kind: 'tunnelCollapsed' }> | null = null;
    for (let t = 0; t < 400 && !collapsed; t++) {
      for (const e of sim.tick()) if (e.kind === 'tunnelCollapsed') collapsed = e;
    }
    expect(collapsed).not.toBeNull();
    expect(collapsed?.tunnel).toBe(idx);
    expect(collapsed?.by).toBe(yahalom);
    expect(sim.tnAlive[idx]).toBe(0);
    expect(sim.state.alive[occupant]).toBe(0);
  });

  it('resets progress when the team is pinned', () => {
    const { sim, idx, yahalom } = chargeScenario({ revealed: true });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    for (let t = 0; t < 40; t++) sim.tick();
    expect(sim.chargeTicks[yahalom]).toBeGreaterThan(0);
    sim.debugSuppress(yahalom, fx.from(2)); // over PIN_AT
    sim.tick();
    expect(sim.chargeTicks[yahalom]).toBe(0);
  });

  it('does not charge from inside a garrison', () => {
    // yahalom_squad can garrison, the garrison branch keeps a chargeOrder,
    // and applyDamage will not touch a garrisoned target — so without the
    // garrisonedIn clause a team charges from hard cover, immune to fire,
    // and the escort loop the unit exists for is deleted. The house centroid
    // is one tile from the spoil: garrisoned there the team is stationary,
    // identified and comfortably in range, so the roof over its head must be
    // the only thing stopping the countdown.
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    sim.trail[6 * sim.width + 10] = TRAIL_MAX;
    sim.trail[6 * sim.width + 11] = TRAIL_MAX;
    sim.identifyTunnelTo(0, idx);
    const houseType = sim.addStructureType({ id: 'tn_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 });
    const house = sim.addStructure(houseType, [7 * sim.width + 11]);
    const team = sim.spawn(
      sim.addUnitType({ ...YAHALOM_TYPE, id: 'tn_yahalom_g', abilities: ['tunnel_charge', 'garrison'] }),
      0, fx.from(11.5), fx.from(9.5)
    );
    sim.queueCommand({ kind: 'chargeTunnel', ids: [team], tunnel: idx });
    sim.queueCommand({ kind: 'garrison', ids: [team], structure: house });
    let maxCharge = 0;
    for (let t = 0; t < 400; t++) {
      sim.tick();
      if (sim.chargeTicks[team] > maxCharge) maxCharge = sim.chargeTicks[team];
    }
    expect(sim.state.garrisonedIn[team]).toBe(house); // the exploit setup actually happened
    expect(sim.tnAlive[idx]).toBe(1);
    expect(maxCharge).toBe(0); // the countdown never ran, not merely never finished
  });

  it('walks to open ground when the nearest spoil lies under a building', () => {
    // stampTrail marks tiles under structures too. Aimed straight at a
    // blocked trail tile, the flow field bails to all-DIR_NONE, the
    // final-leg beeline wall-slides, and `displaced` holds the countdown at
    // zero for the whole grind — measured at ~250 ticks before the first
    // charge tick in this geometry. Routed through nearestOpenTile the walk
    // is ~105 ticks and the collapse lands at ~265; the 340 budget splits
    // the two outcomes with ~70 ticks of margin on each side.
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    sim.setBlocked(11, 6, true); // the building over the route
    sim.setBlocked(11, 7, true);
    sim.trail[6 * sim.width + 11] = TRAIL_MAX; // buried spoil — the team's nearest
    sim.trail[6 * sim.width + 5] = TRAIL_MAX; // open spoil far west, for the spotter
    sim.identifyTunnelTo(0, idx);
    // The scout predates the identified-persistence rule: identification no
    // longer decays, so nothing races a clock any more. It stays because
    // this test is about the walk geometry around the building, and an
    // observer standing in the scene changes none of that.
    sim.spawn(sim.addUnitType(SCOUT_TYPE), 0, fx.from(4.5), fx.from(4.5));
    const team = sim.spawn(sim.addUnitType(YAHALOM_TYPE), 0, fx.from(11.8), fx.from(9.5));
    sim.queueCommand({ kind: 'chargeTunnel', ids: [team], tunnel: idx });
    let collapsedAt = -1;
    for (let t = 0; t < 500 && collapsedAt < 0; t++) {
      for (const e of sim.tick()) if (e.kind === 'tunnelCollapsed') collapsedAt = t;
    }
    expect(collapsedAt).toBeGreaterThanOrEqual(0);
    expect(collapsedAt).toBeLessThanOrEqual(340);
    // And it worked from passable ground, not from inside the footprint.
    const tx = fx.toInt(sim.state.posX[team]);
    const ty = fx.toInt(sim.state.posY[team]);
    expect(tx === 11 && (ty === 6 || ty === 7)).toBe(false);
  });

  it('a charge team grinding at a compound wall still sets the charge: in range IS arrival', () => {
    // The case nearestOpenTile cannot rescue. The route ends in a sealed
    // courtyard, so the nearest route tile to the team is the courtyard
    // itself — open, therefore handed back verbatim as the walk goal, and
    // unreachable. The flow field floods only the courtyard, the final-leg
    // beeline wall-slides along the compound's south face, and the slide's
    // free-axis share decays asymptotically (stepDemolition's comment
    // documents the same pathology), holding `displaced` for hundreds of
    // ticks. The whole slide happens INSIDE charge range: with the in-range
    // stop sequenced before the displaced gate — demolition's ordering — the
    // team halts on the first in-range tick and the collapse lands at ~250.
    // With the stop after the gate it can never fire while sliding, and the
    // clock is still near zero at tick 400. A route venting inside a walled
    // compound is not an edge case; it is what tunnels are for.
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    // Ring x=9..11, y=4..6, sealed 1-tile courtyard at (10,5).
    for (let y = 4; y <= 6; y++) {
      for (let x = 9; x <= 11; x++) {
        if (x === 10 && y === 5) continue;
        sim.setBlocked(x, y, true);
      }
    }
    const idx = sim.addTunnel({ id: 'tn_yard', points: [[4, 5], [10, 5]] as const, dig_tiles_per_s: 1 });
    sim.identifyTunnelTo(0, idx);
    const team = sim.spawn(sim.addUnitType(YAHALOM_TYPE), 0, fx.from(13.5), fx.from(8.5));
    sim.queueCommand({ kind: 'chargeTunnel', ids: [team], tunnel: idx });
    let collapsedAt = -1;
    for (let t = 0; t < 400 && collapsedAt < 0; t++) {
      for (const e of sim.tick()) if (e.kind === 'tunnelCollapsed') collapsedAt = t;
    }
    expect(collapsedAt).toBeGreaterThanOrEqual(0);
    expect(sim.tnAlive[idx]).toBe(0);
  });

  it('a unit surfaced from a route that collapses under it survives on the surface', () => {
    const { sim, idx, yahalom, occupant } = chargeScenario({ revealed: true, surfaced: true });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.tnAlive[idx]).toBe(0);
    expect(sim.state.alive[occupant]).toBe(1); // it was above ground
    expect(sim.state.tunnelIn[occupant]).toBe(-1);
  });

  // The counter-unit's reach must match pre_dug's stealth. A pre_dug route
  // never stamps spoil — correctly, its digging predates the mission — so
  // while the charge keyed on visible trail it was indestructible: no tile
  // ever counted as "at the route" and the objective it anchors was
  // unwinnable. Identification (here via identifyTunnelTo, mark_tunnel's
  // path, since there is no spoil to observe and dwell on) is the gate that
  // earns the charge; geometry is what the team works against.
  it('a pre_dug route, identified, is chargeable and collapses — no spoil ever existed', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({
      id: 'tn_pd',
      points: [[4, 6], [12, 6]] as const,
      dig_tiles_per_s: 1,
      pre_dug: true,
    });
    const yahalom = sim.spawn(sim.addUnitType(YAHALOM_TYPE), 0, fx.from(11.5), fx.from(7.0));
    // Weaponless occupant: a pre_dug vent is OPEN, and an armed one would
    // surface at the charge team (stepSurfacing) and ride out the collapse
    // above ground — the surfaced variant already covers that. This test
    // wants the earth to close over somebody.
    const occupant = sim.spawn(sim.addUnitType(SCOUT_TYPE), 1, fx.from(4.5), fx.from(6.5));
    sim.putInTunnel(occupant, idx);
    expect(Array.from(sim.trail).every((v) => v === 0)).toBe(true); // truly no spoil
    sim.identifyTunnelTo(0, idx);
    sim.queueCommand({ kind: 'chargeTunnel', ids: [yahalom], tunnel: idx });
    let collapsed: Extract<SimEvent, { kind: 'tunnelCollapsed' }> | null = null;
    // 300 ticks is walk ~0 + charge 160 with margin. Identification no
    // longer decays, so no window is being raced here.
    for (let t = 0; t < 300 && !collapsed; t++) {
      for (const e of sim.tick()) if (e.kind === 'tunnelCollapsed') collapsed = e;
    }
    expect(collapsed).not.toBeNull();
    expect(collapsed?.by).toBe(yahalom);
    expect(sim.tnAlive[idx]).toBe(0);
    expect(sim.state.alive[occupant]).toBe(0); // the ambush died in its hole
    expect(Array.from(sim.trail).every((v) => v === 0)).toBe(true); // and nothing conjured spoil
  });
});

describe('putInTunnel kinematics', () => {
  it('burying a walking unit cancels its order: the earth holds it still', () => {
    // The half of the containment rule a command-time refusal cannot cover:
    // this unit was ordered while on the surface and is mid-walk when it goes
    // down. putInTunnel owns the buried invariant, so it clears the goal,
    // path and field along with setting tunnelIn.
    const sim = new Sim({ seed: 5, width: 16, height: 16, capacity: 4 });
    const digger = sim.addUnitType(DIGGER_TYPE);
    const idx = sim.addTunnel({ id: 'tn', points: [[2, 2], [10, 2]] as const, dig_tiles_per_s: 1 });
    const i = sim.spawn(digger, 1, fx.from(2.5), fx.from(2.5));
    sim.queueCommand({ kind: 'move', ids: [i], x: fx.from(12.5), y: fx.from(2.5) });
    for (let n = 0; n < 20; n++) sim.tick();
    expect(sim.state.moving[i]).toBe(1); // premise: it is under way
    sim.putInTunnel(i, idx);
    const at = sim.state.posX[i];
    for (let n = 0; n < 20; n++) sim.tick();
    expect(sim.state.moving[i]).toBe(0); // the order died at the mouth
    expect(sim.state.posX[i]).toBe(at); // it did not keep walking below ground
  });
});

// ---------------------------------------------------------------------------
// Task 16: containment is a rule, not a list of places that remembered it.
// The three leaks below the schema line are reachable TODAY through runtime
// burial (stepSurfacing/submerge produce exactly the state putInTunnel does);
// the rest lock in the two structural fixes — one eligibility check where
// applyCommands expands cmd.ids, and putInTunnel cancelling the whole order
// bundle — plus the step systems that move units with no command at all.
// ---------------------------------------------------------------------------

/** RIFLE_TYPE's deep hull carrying a Trophy-class APS and no weapons: the
 *  test reads the APS decision directly, not the outcome of a firefight. */
const APS_MOLE_TYPE: UnitTypeJson = {
  id: 'tn_aps_mole',
  hull: {
    hp: 20000,
    armor: { front: 300, side: 300, rear: 150 },
    aps: { base_pk: 0.9, magazine: 3, reload_s: 8 },
  },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

/** One-shot loitering munition: steers itself with no command at all, which
 *  is why a command-layer guard alone cannot contain it. */
const KAM_TYPE: UnitTypeJson = {
  id: 'tn_kam',
  hull: { hp: 120, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.2 },
  sensors: { optics: 1.0, sight_tiles: 10, signature: 0.3 },
  abilities: ['kamikaze'],
  weapons: [
    {
      id: 'tn_kam_w',
      type: 'rpg',
      range_tiles: 1,
      accuracy: 1.0,
      penetration: 600,
      damage: 400,
      splash_tiles: 1.0,
      rof_per_min: 6,
    },
  ],
};

/** Foot team that can take every surface order the command layer knows:
 *  garrison, demolish, smoke, load (at_team can embark), chargeTunnel. */
const MULTI_TYPE: UnitTypeJson = {
  id: 'tn_multi',
  role: 'at_team',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison', 'demolish', 'smoke', 'tunnel_charge'],
  demolition_time_s: 1,
  tunnel_charge_time_s: 1,
  weapons: [],
};

const CARRIER_TYPE: UnitTypeJson = {
  id: 'tn_carrier',
  role: 'apc',
  hull: { hp: 900, armor: { front: 20, side: 15, rear: 10 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

describe('containment is structural: no step or command reaches a buried unit', () => {
  it('a satellite sweep does not identify a submerged fighter through the earth', () => {
    const { sim, hidden } = belowGround();
    let revealedCount = -1;
    sim.queueCommand({ kind: 'reveal', side: 0, x: fx.from(4.5), y: fx.from(6.5) });
    for (const e of sim.tick()) {
      if (e.kind === 'revealed') revealedCount = e.count;
    }
    expect(sim.contactLevel(0, hidden)).toBe(0); // the earth stopped the sweep
    expect(revealedCount).toBe(0); // and the HUD is not told otherwise
  });

  it('APS stays cold while its carrier is underground — no intercept, no RNG draw', () => {
    // The determinism-relevant one: the aps event and the rng.nextU32 draw sit
    // in the same block, so "no aps event" proves the stream was not touched.
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    sim.spawn(sim.addUnitType(ATGM_TYPE), 0, fx.from(10.5), fx.from(6.5));
    const victim = sim.spawn(sim.addUnitType(APS_MOLE_TYPE), 1, fx.from(4.5), fx.from(6.5));
    // Launch at the victim ON the surface; go below only with the round in the air.
    let launched = false;
    for (let t = 0; t < 900 && !launched; t++) {
      for (const e of sim.tick()) if (e.kind === 'fire' && e.target === victim) launched = true;
    }
    expect(launched).toBe(true);
    sim.putInTunnel(victim, idx);
    let apsEvents = 0;
    for (let t = 0; t < 60; t++) {
      for (const e of sim.tick()) if (e.kind === 'aps') apsEvents++;
    }
    expect(apsEvents).toBe(0); // three metres of earth is the interceptor
    expect(sim.state.apsAmmo[victim]).toBe(3); // magazine untouched
  });

  it('an ambush does not spring on a buried enemy', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const ambusher = sim.spawn(sim.addUnitType(RIFLE_TYPE), 0, fx.from(6.5), fx.from(6.5));
    const buried = sim.spawn(sim.addUnitType(SCOUT_TYPE), 1, fx.from(4.5), fx.from(6.5));
    sim.putInTunnel(buried, idx);
    sim.setAmbush(ambusher, fx.from(3));
    let sprung = 0;
    for (let t = 0; t < 100; t++) {
      for (const e of sim.tick()) if (e.kind === 'ambushSprung') sprung++;
    }
    expect(sprung).toBe(0); // the trap is not spent on a man it cannot see
  });

  it('the same ambush DOES spring on a surface enemy: the guard reads tunnelIn, not proximity', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const ambusher = sim.spawn(sim.addUnitType(RIFLE_TYPE), 0, fx.from(6.5), fx.from(6.5));
    sim.spawn(sim.addUnitType(SCOUT_TYPE), 1, fx.from(4.5), fx.from(6.5));
    sim.setAmbush(ambusher, fx.from(3));
    let sprung = 0;
    for (let t = 0; t < 100; t++) {
      for (const e of sim.tick()) if (e.kind === 'ambushSprung') sprung++;
    }
    expect(sprung).toBe(1);
  });

  it('a buried unit refuses every surface order by construction, append fast-path included', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const st = sim.addStructureType({ id: 'tn_house', hp_per_tile: 100, garrison_slots: 4 });
    const house = sim.addStructure(st, [6 * sim.width + 6]);
    const u = sim.spawn(sim.addUnitType(MULTI_TYPE), 0, fx.from(4.5), fx.from(6.5));
    const car = sim.spawn(sim.addUnitType(CARRIER_TYPE), 0, fx.from(8.5), fx.from(8.5));
    sim.putInTunnel(u, idx);
    // Spoil on the surface and the route identified, so only containment can
    // refuse the charge order rather than the trail or the identified gate.
    sim.trail[6 * sim.width + 10] = TRAIL_MAX;
    sim.identifyTunnelTo(0, idx);
    const at = sim.state.posX[u];
    sim.queueCommand({ kind: 'garrison', ids: [u], structure: house });
    // The old hole: garrison set moving=1, and the append fast-path then took
    // a waypoint BEFORE the move branch's guard could refuse it.
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(20.5), y: fx.from(6.5), append: true });
    sim.queueCommand({ kind: 'demolish', ids: [u], structure: house });
    sim.queueCommand({ kind: 'load', ids: [u], carrier: car });
    sim.queueCommand({ kind: 'smoke', ids: [u], x: fx.from(5.5), y: fx.from(6.5) });
    sim.queueCommand({ kind: 'chargeTunnel', ids: [u], tunnel: idx });
    let smokeLaid = 0;
    for (let t = 0; t < 100; t++) {
      for (const e of sim.tick()) if (e.kind === 'smokeLaid') smokeLaid++;
    }
    expect(sim.state.posX[u]).toBe(at); // never walked, above or below ground
    expect(sim.state.moving[u]).toBe(0);
    expect(sim.structures.alive[house]).toBe(1); // no demolition through the roof
    expect(sim.structures.occupants[house]).toBe(0); // no garrison from below
    expect(sim.state.carriedBy[u]).toBe(-1); // no boarding from below
    expect(smokeLaid).toBe(0); // no screen laid out of bare dirt
    expect(sim.tnAlive[idx]).toBe(1); // no charge worked from inside the route
  });

  it('burial cancels a latched demolition order — and the automatic charge too', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const st = sim.addStructureType({ id: 'tn_shed', hp_per_tile: 100 });
    const shed = sim.addStructure(st, [6 * sim.width + 6]);
    const u = sim.spawn(sim.addUnitType(MULTI_TYPE), 0, fx.from(5.5), fx.from(6.5));
    // Order taken ON the surface, in range — the state a command refusal
    // cannot reach. stepDemolition's automatic branch would also raze a shed
    // beside a halted demolisher with no order at all, so the building
    // standing proves both the cleared bundle and the step-system guard.
    sim.queueCommand({ kind: 'demolish', ids: [u], structure: shed });
    sim.tick();
    sim.putInTunnel(u, idx);
    for (let t = 0; t < 100; t++) sim.tick();
    expect(sim.structures.alive[shed]).toBe(1);
    expect(sim.state.demoTarget[u]).toBe(-1);
  });

  it('a buried loitering munition does not steer at a cued target, let alone dive', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const kam = sim.spawn(sim.addUnitType(KAM_TYPE), 0, fx.from(6.5), fx.from(6.5));
    const enemy = sim.spawn(sim.addUnitType(SCOUT_TYPE), 1, fx.from(7.5), fx.from(6.5));
    sim.putInTunnel(kam, idx);
    sim.identifyTo(0, enemy); // the cue is live; the earth still contains
    const at = sim.state.posX[kam];
    const hpBefore = sim.state.hp[enemy];
    for (let t = 0; t < 50; t++) sim.tick();
    expect(sim.state.alive[kam]).toBe(1); // did not spend itself from below
    expect(sim.state.posX[kam]).toBe(at);
    expect(sim.state.hp[enemy]).toBe(hpBefore);
  });

  it('a carrier goes below alone: riders are set down, and a collapse does not kill them', () => {
    const { sim, idx } = simWithRoute();
    const car = sim.spawn(sim.addUnitType(CARRIER_TYPE), 1, fx.from(2.5), fx.from(2.5));
    const rider = sim.spawn(sim.addUnitType(MULTI_TYPE), 1, fx.from(2.5), fx.from(2.5));
    expect(sim.embarkAtSpawn(car, rider)).toBe(true);
    sim.putInTunnel(car, idx);
    expect(sim.state.tunnelIn[car]).toBe(idx);
    expect(sim.state.carriedBy[rider]).toBe(-1); // the hull fits the shaft; the squad does not
    expect(sim.state.tunnelIn[rider]).toBe(-1);
    expect(sim.tnOccupants[idx]).toBe(1);
    sim.debugCollapseTunnel(idx);
    expect(sim.state.alive[car]).toBe(0); // everyone below dies
    expect(sim.state.alive[rider]).toBe(1); // and nobody who was not below does
  });

  it('seating refuses both a buried rider and a buried carrier', () => {
    const { sim, idx } = simWithRoute();
    const car = sim.spawn(sim.addUnitType(CARRIER_TYPE), 1, fx.from(2.5), fx.from(2.5));
    const rider = sim.spawn(sim.addUnitType(MULTI_TYPE), 1, fx.from(2.5), fx.from(2.5));
    sim.putInTunnel(rider, idx);
    expect(sim.embarkAtSpawn(car, rider)).toBe(false);
    const car2 = sim.spawn(sim.addUnitType(CARRIER_TYPE), 1, fx.from(3.5), fx.from(2.5));
    const rider2 = sim.spawn(sim.addUnitType(MULTI_TYPE), 1, fx.from(3.5), fx.from(2.5));
    sim.putInTunnel(car2, idx);
    expect(sim.embarkAtSpawn(car2, rider2)).toBe(false);
  });

  it('the belt: even a unit some future system leaves moving does not walk below ground', () => {
    // Every autonomous moving-setter is individually guarded today (the
    // braces); this pins the belt in stepMovement itself. Simulate the next
    // unguarded setter by burying a mid-walk unit through the raw state
    // array — tunnelIn set, order bundle deliberately left intact — which is
    // exactly the state a forgotten guard would produce.
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const u = sim.spawn(sim.addUnitType(SCOUT_TYPE), 1, fx.from(4.5), fx.from(6.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(20.5), y: fx.from(6.5) });
    for (let t = 0; t < 10; t++) sim.tick();
    expect(sim.state.moving[u]).toBe(1); // premise: mid-walk, order live
    sim.state.tunnelIn[u] = idx; // the hypothetical unguarded setter
    const at = sim.state.posX[u];
    for (let t = 0; t < 20; t++) sim.tick();
    expect(sim.state.posX[u]).toBe(at); // the earth held it anyway
  });

  it('a unit SURFACED from a route is ordinary: it takes orders like anyone else', () => {
    // The distinction that must survive every containment fix: homeTunnel >= 0
    // with tunnelIn === -1 is the combat loop of the subsystem, not a
    // contained state.
    const { sim, hidden } = readyToVent({ dug: true });
    let surfaced = false;
    for (let t = 0; t < 200 && !surfaced; t++) {
      for (const e of sim.tick()) if (e.kind === 'surfaced' && e.entity === hidden) surfaced = true;
    }
    expect(surfaced).toBe(true);
    sim.queueCommand({ kind: 'move', ids: [hidden], x: fx.from(10.5), y: fx.from(6.5) });
    sim.tick();
    expect(sim.state.moving[hidden]).toBe(1); // the order was accepted
  });
});
