import { describe, expect, it } from 'vitest';
import { fx, ONE } from './fixed';
import {
  BRACE_DROPPING,
  BRACE_KNEELING,
  BRACE_NONE,
  BRACE_RISING,
  Sim,
  unitTypeFromJson,
  type SimEvent,
  type UnitTypeJson,
} from './sim';
import {
  AIM_OFF_HEADING_MAX,
  BOUND_FIRE_TICKS,
  BOUND_MOVE_TICKS,
  MOVING_STANCE_MOD,
  KNEEL_DROP_TICKS,
  KNEEL_RISE_TICKS,
} from './tuning';

// Halt to fire (spec docs/superpowers/specs/2026-10-05-infantry-halt-to-fire.md).
// A unit that halts to fire never shoots while its feet move: it stops, gets
// down for KNEEL_DROP_TICKS, fires while BRACE_KNEELING, and gets up for
// KNEEL_RISE_TICKS before it moves on. These tests pin the timing to the tick,
// because the renderer's kneel clips are driven by exactly these numbers.
//
// Every expected value below is a literal or a tuning constant, never a value
// read back from the code under test, and the falsifying mutation for each test
// is recorded in the commit that added it.

const RIFLES: UnitTypeJson = {
  id: 'b_rifles',
  role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 14, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 10,
      effective_range_tiles: 6,
      accuracy: 0.6,
      penetration: 8,
      damage: 1,
      suppression: 0,
      rof_per_min: 300,
    },
  ],
};

/** Same weapon, a vehicle: fires on the move. */
const TANK: UnitTypeJson = {
  ...RIFLES,
  id: 'b_tank',
  role: 'mbt',
  hull: { hp: 100000, armor: { front: 700, side: 300, rear: 150 } },
};

/** Something to shoot at that shoots at nothing and does not die. */
const POST: UnitTypeJson = {
  id: 'b_post',
  role: 'support',
  hull: { hp: 1000000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};

const CARRIER: UnitTypeJson = {
  id: 'b_carrier',
  role: 'apc',
  hull: { hp: 100000, armor: { front: 20, side: 15, rear: 10 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
};

interface World {
  sim: Sim;
  rifles: number;
  tank: number;
  post: number;
  carrier: number;
}

function world(): World {
  const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 16 });
  return {
    sim,
    rifles: sim.addUnitType(RIFLES),
    tank: sim.addUnitType(TANK),
    post: sim.addUnitType(POST),
    carrier: sim.addUnitType(CARRIER),
  };
}

const at = (n: number) => fx.from(n);

/** One tick, with what a test needs: the events, and the shooter's
 *  position before and after. */
interface Frame {
  tick: number;
  fired: boolean;
  moved: boolean;
  brace: number;
  braceTicks: number;
  events: SimEvent[];
}

function step(sim: Sim, id: number): Frame {
  const x0 = sim.state.posX[id];
  const y0 = sim.state.posY[id];
  const tick = sim.tickCount;
  const events = sim.tick();
  return {
    tick,
    fired: events.some((e) => e.kind === 'fire' && e.shooter === id),
    moved: sim.state.posX[id] !== x0 || sim.state.posY[id] !== y0,
    brace: sim.state.brace[id],
    braceTicks: sim.state.braceTicks[id],
    events,
  };
}

function run(sim: Sim, id: number, ticks: number): Frame[] {
  const out: Frame[] = [];
  for (let k = 0; k < ticks; k++) out.push(step(sim, id));
  return out;
}

describe('who halts to fire', () => {
  it('is derived: armed, on foot, not air, not a kamikaze', () => {
    expect(unitTypeFromJson(RIFLES).haltsToFire).toBe(true);
    expect(unitTypeFromJson(TANK).haltsToFire).toBe(false); // wheeled by role
    expect(unitTypeFromJson(POST).haltsToFire).toBe(false); // unarmed
    expect(unitTypeFromJson({ ...RIFLES, abilities: ['kamikaze'] }).haltsToFire).toBe(false);
    expect(
      unitTypeFromJson({ ...RIFLES, mobility: { speed_tiles_s: 2, domain: 'air' } }).haltsToFire
    ).toBe(false);
    // `wheeled` is the foot test, not the role: an artillery truck is not foot.
    expect(
      unitTypeFromJson({ ...RIFLES, role: 'artillery', mobility: { speed_tiles_s: 0.5, wheeled: true } })
        .haltsToFire
    ).toBe(false);
  });

  it('can be overridden either way in data', () => {
    expect(
      unitTypeFromJson({ ...TANK, mobility: { speed_tiles_s: 1, halts_to_fire: true } }).haltsToFire
    ).toBe(true);
    expect(
      unitTypeFromJson({ ...RIFLES, mobility: { speed_tiles_s: 1, halts_to_fire: false } }).haltsToFire
    ).toBe(false);
  });
});

describe('an idle rifleman that acquires a target', () => {
  it('gets down, and fires its first shot exactly KNEEL_DROP_TICKS after acquiring', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(15.5), at(16.5));
    w.sim.identifyTo(0, p); // acquired on tick 0
    const frames = run(w.sim, r, 40);
    // Premise: it does fire, so "no fire before tick 12" is not vacuous.
    const first = frames.findIndex((f) => f.fired);
    expect(first).toBe(4);
    expect(first).toBe(KNEEL_DROP_TICKS);
    // Down on the acquisition tick itself, kneeling by the tick before it fires.
    expect(frames[0].brace).toBe(BRACE_DROPPING);
    for (let k = 0; k < KNEEL_DROP_TICKS - 1; k++) expect(frames[k].brace).toBe(BRACE_DROPPING);
    expect(frames[KNEEL_DROP_TICKS - 1].brace).toBe(BRACE_KNEELING);
    // braceTicks counts down to the kneel.
    expect(frames[0].braceTicks).toBe(KNEEL_DROP_TICKS - 1);
    expect(frames[KNEEL_DROP_TICKS - 1].braceTicks).toBe(0);
    // Every shot is taken kneeling.
    for (const f of frames) if (f.fired) expect(f.brace).toBe(BRACE_KNEELING);
  });

  it('stays down when the target is gone and it has nowhere to go', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(15.5), at(16.5));
    w.sim.identifyTo(0, p);
    run(w.sim, r, 30);
    expect(w.sim.state.brace[r]).toBe(BRACE_KNEELING);
    w.sim.debugKill(p);
    const after = run(w.sim, r, 60);
    for (const f of after) expect(f.brace).toBe(BRACE_KNEELING);
  });
});

describe('an attack-moving rifleman', () => {
  it('against a target in the OPEN: bounds through the band, stops for good inside effective range, never fires on the move, and rises when the target is gone', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(4.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(24.5), at(16.5));
    w.sim.identifyTo(0, p);
    w.sim.queueCommand({ kind: 'attackMove', ids: [r], x: at(40.5), y: at(16.5) });
    const frames: (Frame & { dist: number })[] = [];
    for (let k = 0; k < 600; k++) {
      const f = step(w.sim, r);
      frames.push({ ...f, dist: 24.5 - fx.toNumber(w.sim.state.posX[r]) });
    }

    // Never a shot on a tick it moved, and never a shot standing.
    expect(frames.some((f) => f.fired)).toBe(true);
    for (const f of frames) {
      if (!f.fired) continue;
      expect(f.moved).toBe(false);
      expect(f.brace).toBe(BRACE_KNEELING);
    }
    // The first halt is the moment the target comes inside MAXIMUM range
    // (10 tiles): it had been walking far longer than a bound, so it stops at
    // once, on that tick, and fires KNEEL_DROP_TICKS later.
    const halt = frames.findIndex((f) => f.brace === BRACE_DROPPING);
    expect(halt).toBeGreaterThan(0);
    expect(frames[halt].dist).toBeLessThanOrEqual(10);
    expect(frames[halt].dist).toBeGreaterThan(9);
    expect(frames[halt].moved).toBe(false);
    expect(frames[halt - 1].moved).toBe(true);
    expect(frames.findIndex((f) => f.fired)).toBe(halt + KNEEL_DROP_TICKS);
    // In the band it fires from the knee for BOUND_FIRE_TICKS and then gets
    // up and goes on: the first rise starts exactly then.
    const kneel = halt + KNEEL_DROP_TICKS - 1;
    expect(frames[kneel].brace).toBe(BRACE_KNEELING);
    // (One tick later if it fired on the tick the bound ran out: a man who
    // fired this tick is still kneeling at the end of it.)
    const firstRise = frames.findIndex((f, k) => k > kneel && f.brace === BRACE_RISING);
    let due = kneel + BOUND_FIRE_TICKS + 1;
    while (frames[due].fired) due++;
    expect(firstRise).toBe(due);
    expect(due - (kneel + BOUND_FIRE_TICKS + 1)).toBeLessThanOrEqual(1);
    // ...and after a bound of BOUND_MOVE_TICKS on its feet, it halts again,
    // still in the band.
    const up = firstRise + KNEEL_RISE_TICKS;
    expect(frames[up].brace).toBe(BRACE_NONE);
    expect(frames[up].moved).toBe(true);
    const second = frames.findIndex((f, k) => k > up && f.brace === BRACE_DROPPING);
    expect(second).toBe(up + BOUND_MOVE_TICKS);
    expect(frames[second].dist).toBeGreaterThan(6);
    // Once inside effective range (6) it stops for good: down and staying
    // down for as long as the target lives.
    const close = frames.findIndex((f) => f.dist <= 6 && f.brace === BRACE_KNEELING);
    expect(close).toBeGreaterThan(second);
    for (let k = close; k < frames.length; k++) {
      expect(frames[k].brace).toBe(BRACE_KNEELING);
      expect(frames[k].moved).toBe(false);
    }
    // Kneeling buys no accuracy of its own. A shot from a short halt in the
    // band is priced as a unit on the move (GDD 5.2's short-halt); a shot
    // from the halt inside effective range as stationary.
    const stance = (f: Frame) => {
      const e = f.events.find((x) => x.kind === 'fire' && x.shooter === r);
      return e !== undefined && e.kind === 'fire' ? e.breakdown.stanceMod : -1;
    };
    const bandShots = frames.slice(0, close).filter((f) => f.fired).map(stance);
    const closeShots = frames.slice(close).filter((f) => f.fired).map(stance);
    expect(bandShots.length).toBeGreaterThan(0);
    expect(closeShots.length).toBeGreaterThan(0);
    for (const m of bandShots) expect(m).toBe(MOVING_STANCE_MOD);
    for (const m of closeShots) expect(m).toBe(ONE);
    expect(frames[frames.length - 1].dist).toBeGreaterThan(5);

    // Target gone: it rises, and moves again exactly KNEEL_RISE_TICKS after
    // the tick it started to rise.
    w.sim.debugKill(p);
    const after = run(w.sim, r, 60);
    const rise = after.findIndex((f) => f.brace === BRACE_RISING);
    expect(rise).toBe(0);
    for (let k = rise; k < rise + KNEEL_RISE_TICKS; k++) expect(after[k].moved).toBe(false);
    expect(after[rise + KNEEL_RISE_TICKS].moved).toBe(true);
    expect(after[rise + KNEEL_RISE_TICKS].brace).toBe(BRACE_NONE);
    expect(after[rise + KNEEL_RISE_TICKS - 1].brace).toBe(BRACE_RISING);
  });

  it('against a target in COVER: closes through the band holding fire, stops inside effective range, fires kneeling, and rises when the target is gone', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(4.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(24.5), at(16.5));
    w.sim.setCover(24, 16, 1); // light cover: nothing worth stopping short for
    w.sim.identifyTo(0, p);
    w.sim.queueCommand({ kind: 'attackMove', ids: [r], x: at(40.5), y: at(16.5) });
    const frames: (Frame & { dist: number })[] = [];
    for (let k = 0; k < 600; k++) {
      const f = step(w.sim, r);
      frames.push({ ...f, dist: 24.5 - fx.toNumber(w.sim.state.posX[r]) });
    }

    // Never a shot on a tick it moved, and never a shot standing.
    expect(frames.some((f) => f.fired)).toBe(true);
    for (const f of frames) {
      if (!f.fired) continue;
      expect(f.moved).toBe(false);
      expect(f.brace).toBe(BRACE_KNEELING);
    }
    // It walked the whole band -- inside maximum range (10), outside effective
    // range (6) -- on its feet, without stopping and without a shot.
    const halt = frames.findIndex((f) => f.brace !== BRACE_NONE);
    expect(halt).toBeGreaterThan(0);
    const inBand = frames.slice(0, halt).filter((f) => f.dist <= 10);
    expect(inBand.length).toBeGreaterThan(40);
    for (const f of inBand) {
      expect(f.moved).toBe(true);
      expect(f.fired).toBe(false);
    }
    // The halt is at effective range, on that tick, and the first shot comes
    // KNEEL_DROP_TICKS later.
    expect(frames[halt].brace).toBe(BRACE_DROPPING);
    expect(frames[halt].dist).toBeLessThanOrEqual(6);
    expect(frames[halt].dist).toBeGreaterThan(5);
    expect(frames[halt].moved).toBe(false);
    expect(frames[halt - 1].moved).toBe(true);
    expect(frames.findIndex((f) => f.fired)).toBe(halt + KNEEL_DROP_TICKS);
    // Down for good while the target lives, and priced as stationary: kneeling
    // buys no accuracy of its own.
    for (let k = halt + KNEEL_DROP_TICKS - 1; k < frames.length; k++) {
      expect(frames[k].brace).toBe(BRACE_KNEELING);
      expect(frames[k].moved).toBe(false);
    }
    for (const f of frames) {
      if (!f.fired) continue;
      const e = f.events.find((x) => x.kind === 'fire' && x.shooter === r);
      expect(e !== undefined && e.kind === 'fire' ? e.breakdown.stanceMod : -1).toBe(ONE);
    }

    // Target gone: it rises, and moves again exactly KNEEL_RISE_TICKS after
    // the tick it started to rise.
    w.sim.debugKill(p);
    const after = run(w.sim, r, 60);
    const rise = after.findIndex((f) => f.brace === BRACE_RISING);
    expect(rise).toBe(0);
    for (let k = rise; k < rise + KNEEL_RISE_TICKS; k++) expect(after[k].moved).toBe(false);
    expect(after[rise + KNEEL_RISE_TICKS].moved).toBe(true);
    expect(after[rise + KNEEL_RISE_TICKS].brace).toBe(BRACE_NONE);
    expect(after[rise + KNEEL_RISE_TICKS - 1].brace).toBe(BRACE_RISING);
  });

  it('gets up and closes when its close target dies and the next is in cover in the band', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const near = w.sim.spawn(w.post, 1, at(15.5), at(16.5)); // 5 tiles: close
    const far = w.sim.spawn(w.post, 1, at(19.5), at(17.5)); // ~9 tiles: band
    w.sim.setCover(19, 17, 2); // in cover: close on it, do not kneel and plink
    w.sim.identifyTo(0, near);
    w.sim.identifyTo(0, far);
    w.sim.queueCommand({ kind: 'attackMove', ids: [r], x: at(12.5), y: at(16.5) });
    run(w.sim, r, 40);
    expect(w.sim.state.brace[r]).toBe(BRACE_KNEELING);
    w.sim.debugKill(near);
    const after = run(w.sim, r, 200);
    // Not a kneel-and-plink at long range: it stands, walks in, and only gets
    // down again inside effective range of the far target.
    // Up at once -- one tick later only if it fired on the tick the close
    // target died (a man who fired this tick is still kneeling at its end).
    const up = after.findIndex((f) => f.brace === BRACE_RISING);
    expect(up).toBeGreaterThanOrEqual(0);
    expect(up).toBeLessThanOrEqual(1);
    expect(after.some((f) => f.moved)).toBe(true);
    const down = after.findIndex((f, k) => k > KNEEL_RISE_TICKS && f.brace === BRACE_DROPPING);
    expect(down).toBeGreaterThan(0);
    const dx = 19.5 - fx.toNumber(w.sim.state.posX[r]);
    const dy = 17.5 - fx.toNumber(w.sim.state.posY[r]);
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(6);
  });
});

describe('a man who has stopped', () => {
  it('takes a knee with nothing to shoot at', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const frames = run(w.sim, r, KNEEL_DROP_TICKS + 5);
    expect(frames[0].brace).toBe(BRACE_DROPPING);
    expect(frames[KNEEL_DROP_TICKS - 1].brace).toBe(BRACE_KNEELING);
    for (const f of frames) expect(f.fired).toBe(false);
  });

  it('is never made to kneel if he is ordered on before his first tick', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(4.5), at(16.5));
    w.sim.queueCommand({ kind: 'move', ids: [r], x: at(20.5), y: at(16.5) });
    const frames = run(w.sim, r, 30);
    for (const f of frames) {
      expect(f.brace).toBe(BRACE_NONE);
      expect(f.moved).toBe(true);
    }
  });
});

describe('a plain move', () => {
  it('runs past a target without halting and without firing, but still looks at it', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(4.5), at(10.5));
    const p = w.sim.spawn(w.post, 1, at(20.5), at(14.5));
    w.sim.identifyTo(0, p);
    w.sim.queueCommand({ kind: 'move', ids: [r], x: at(40.5), y: at(10.5) });
    let hadTarget = false;
    let aimed = false;
    for (let k = 0; k < 1200 && (k === 0 || w.sim.state.moving[r] === 1); k++) {
      const f = step(w.sim, r);
      expect(f.fired).toBe(false);
      expect(f.brace).toBe(BRACE_NONE);
      if (w.sim.state.curTarget[r] === p) {
        hadTarget = true;
        // Heading is due east (0); the target is to the south-east and then
        // behind, so a hull that aims is turned off zero toward it, inside
        // the walking allowance.
        const off = fx.angleDiff(w.sim.state.facing[r], 0);
        if (off !== 0) aimed = true;
        expect(Math.abs(off)).toBeLessThanOrEqual(AIM_OFF_HEADING_MAX);
      }
    }
    expect(hadTarget).toBe(true);
    expect(aimed).toBe(true);
    expect(w.sim.state.moving[r]).toBe(0); // it arrived
  });
});

describe('a vehicle', () => {
  it('still fires on the move and never leaves BRACE_NONE', () => {
    const w = world();
    const t = w.sim.spawn(w.tank, 0, at(4.5), at(10.5));
    const p = w.sim.spawn(w.post, 1, at(20.5), at(14.5));
    w.sim.identifyTo(0, p);
    w.sim.queueCommand({ kind: 'move', ids: [t], x: at(40.5), y: at(10.5) });
    const frames = run(w.sim, t, 300);
    expect(frames.some((f) => f.fired && f.moved)).toBe(true);
    for (const f of frames) expect(f.brace).toBe(BRACE_NONE);
  });
});

describe('interrupted transitions mirror', () => {
  it('a drop cut short rises only for as long as it had been dropping', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(15.5), at(16.5));
    w.sim.identifyTo(0, p);
    const before = run(w.sim, r, 2); // ticks 0-1 down
    expect(before[1].brace).toBe(BRACE_DROPPING);
    expect(before[1].braceTicks).toBe(KNEEL_DROP_TICKS - 2);
    // Ordered on with nothing to shoot: two ticks down, so two ticks up.
    w.sim.debugKill(p);
    w.sim.queueCommand({ kind: 'move', ids: [r], x: at(30.5), y: at(16.5) });
    const after = run(w.sim, r, 12);
    expect(after[0].brace).toBe(BRACE_RISING);
    expect(after[0].braceTicks).toBe(2);
    for (let k = 0; k < 2; k++) expect(after[k].moved).toBe(false);
    expect(after[2].moved).toBe(true);
    expect(after[2].brace).toBe(BRACE_NONE);
  });
});

describe('starting down', () => {
  it('an ambusher is already kneeling and fires on the tick it springs', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(22.5), at(16.5));
    w.sim.setAmbush(r, at(5));
    expect(w.sim.state.brace[r]).toBe(BRACE_KNEELING);
    w.sim.identifyTo(0, p);
    w.sim.queueCommand({ kind: 'move', ids: [p], x: at(11.5), y: at(16.5) });
    const frames = run(w.sim, r, 400);
    const sprung = frames.findIndex((f) => f.events.some((e) => e.kind === 'ambushSprung' && e.entity === r));
    expect(sprung).toBeGreaterThan(0);
    expect(frames.findIndex((f) => f.fired)).toBe(sprung);
  });

  it('a vehicle put in ambush stays at BRACE_NONE', () => {
    const w = world();
    const t = w.sim.spawn(w.tank, 0, at(10.5), at(16.5));
    w.sim.setAmbush(t, at(5));
    expect(w.sim.state.brace[t]).toBe(BRACE_NONE);
  });
});

describe('suppression and containment', () => {
  it('pinned freezes the brace: a pinned kneeler ordered on neither rises nor moves', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(15.5), at(16.5));
    w.sim.identifyTo(0, p);
    run(w.sim, r, 20);
    expect(w.sim.state.brace[r]).toBe(BRACE_KNEELING);
    w.sim.debugSuppress(r, fx.from(2));
    w.sim.tick(); // the pin latches in stepUpkeep
    expect(w.sim.state.pinned[r]).toBe(1);
    w.sim.queueCommand({ kind: 'move', ids: [r], x: at(30.5), y: at(16.5) });
    const frames = run(w.sim, r, 40);
    for (const f of frames) {
      expect(f.brace).toBe(BRACE_KNEELING);
      expect(f.moved).toBe(false);
    }
  });

  it('a routed man gets up and runs', () => {
    const w = world();
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    const p = w.sim.spawn(w.post, 1, at(15.5), at(16.5));
    w.sim.identifyTo(0, p);
    run(w.sim, r, 20);
    expect(w.sim.state.brace[r]).toBe(BRACE_KNEELING);
    let routedAt = -1;
    const frames: Frame[] = [];
    for (let k = 0; k < 400; k++) {
      if (k % 40 === 0) w.sim.debugSuppress(r, fx.from(2));
      const f = step(w.sim, r);
      frames.push(f);
      if (routedAt < 0 && f.events.some((e) => e.kind === 'routed' && e.entity === r)) routedAt = k;
    }
    expect(routedAt).toBeGreaterThan(0);
    const rise = frames.findIndex((f, k) => k > routedAt && f.brace === BRACE_RISING);
    expect(rise).toBe(routedAt + 1);
    expect(frames[rise + KNEEL_RISE_TICKS].moved).toBe(true);
  });

  it('a passenger is held at BRACE_NONE', () => {
    const w = world();
    const c = w.sim.spawn(w.carrier, 0, at(10.5), at(16.5));
    const r = w.sim.spawn(w.rifles, 0, at(10.5), at(16.5));
    w.sim.setAmbush(r, at(5)); // starts kneeling...
    expect(w.sim.embarkAtSpawn(c, r)).toBe(true);
    expect(w.sim.state.brace[r]).toBe(BRACE_NONE); // ...and boarding stands him up
    const p = w.sim.spawn(w.post, 1, at(15.5), at(16.5));
    w.sim.identifyTo(0, p);
    for (const f of run(w.sim, r, 30)) expect(f.brace).toBe(BRACE_NONE);
  });
});
