import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

// Attack-move's sweep (stepSweep, and sweep.test.ts beside this): a unit that
// has finished its attack-move and has nothing to shoot advances on what it
// knows about instead of standing still.
//
// The gap this pins, found while measuring halt to fire (spec
// 2026-10-05-infantry-halt-to-fire §6): stepSweep skipped every IDENTIFIED
// contact as "the combat step's problem". That is only true while combat can
// shoot it. An enemy identified beyond weapon range -- a squad with 13 tiles of
// sight and an 8-tile rifle, which is what the sensor upgrade buys
// `inf_squad` -- is nobody's problem: combat has no shot and the sweep will not
// walk to it, so the attack-mover kneels and watches it for the rest of the
// mission.

const LOOKER: UnitTypeJson = {
  id: 'o_looker',
  role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 14, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6,
      accuracy: 0.6,
      penetration: 8,
      damage: 1,
      suppression: 0,
      rof_per_min: 300,
    },
  ],
};

/** Loud enough to stay identified at 12 tiles for as long as it is watched,
 *  so the contact never decays to `lost` -- which the OLD sweep would have
 *  walked to, and which would let the first test below pass without the fix
 *  (measured: it did, at signature 1, after the contact decayed). */
const POST: UnitTypeJson = {
  id: 'o_post',
  role: 'support',
  hull: { hp: 1000000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 1, signature: 6 },
};

const HELI: UnitTypeJson = {
  ...POST,
  id: 'o_heli',
  role: 'gunship',
  mobility: { speed_tiles_s: 3, domain: 'air' },
};

function world() {
  const sim = new Sim({ seed: 5, width: 48, height: 32, capacity: 8 });
  return { sim, looker: sim.addUnitType(LOOKER), post: sim.addUnitType(POST), heli: sim.addUnitType(HELI) };
}

describe('an attack-mover that has arrived', () => {
  it('advances on an enemy it has identified but cannot reach, and engages it', () => {
    const w = world();
    const r = w.sim.spawn(w.looker, 0, fx.from(4.5), fx.from(16.5));
    // 12 tiles off the goal: inside sight 14, outside rifle range 8.
    const p = w.sim.spawn(w.post, 1, fx.from(22.5), fx.from(16.5));
    w.sim.queueCommand({ kind: 'attackMove', ids: [r], x: fx.from(10.5), y: fx.from(16.5) });
    let arrived = -1;
    let fired = -1;
    let everLost = false;
    for (let t = 0; t < 1200 && fired < 0; t++) {
      const events = w.sim.tick();
      if (arrived < 0 && fx.toNumber(w.sim.state.posX[r]) >= 10.4) arrived = t;
      if (arrived >= 0 && w.sim.contactLevel(0, p) !== 2) everLost = true;
      if (events.some((e) => e.kind === 'fire' && e.shooter === r && e.target === p)) fired = t;
    }
    // Premise: it got to its goal, out of range, with the target identified
    // the whole time after -- so nothing but the identified contact can have
    // drawn it forward.
    expect(arrived).toBeGreaterThan(0);
    expect(everLost).toBe(false);
    expect(fired).toBeGreaterThan(arrived);
    expect(22.5 - fx.toNumber(w.sim.state.posX[r])).toBeLessThanOrEqual(8);
  });

  it('closes to effective range on a target it arrived within maximum range of, instead of plinking from where it stopped', () => {
    const w = world();
    const r = w.sim.spawn(w.looker, 0, fx.from(4.5), fx.from(16.5));
    // 7 tiles off the goal: inside rifle range 8, outside effective range 6,
    // and in cover -- a target in the open it would shoot from where it is.
    const p = w.sim.spawn(w.post, 1, fx.from(17.5), fx.from(16.5));
    w.sim.setCover(17, 16, 2);
    w.sim.queueCommand({ kind: 'attackMove', ids: [r], x: fx.from(10.5), y: fx.from(16.5) });
    let arrived = -1;
    for (let t = 0; t < 600; t++) {
      w.sim.tick();
      if (arrived < 0 && fx.toNumber(w.sim.state.posX[r]) >= 10.4) arrived = t;
    }
    expect(arrived).toBeGreaterThan(0);
    // It walked on past its goal and got down inside effective range.
    expect(17.5 - fx.toNumber(w.sim.state.posX[r])).toBeLessThanOrEqual(6);
    expect(w.sim.state.brace[r]).toBe(2); // BRACE_KNEELING
    expect(w.sim.state.curTarget[r]).toBe(p);
  });

  it('holds where it was sent and fires on a target in the open in the band', () => {
    const w = world();
    const r = w.sim.spawn(w.looker, 0, fx.from(4.5), fx.from(16.5));
    const p = w.sim.spawn(w.post, 1, fx.from(17.5), fx.from(16.5)); // open ground
    w.sim.queueCommand({ kind: 'attackMove', ids: [r], x: fx.from(10.5), y: fx.from(16.5) });
    let fired = 0;
    for (let t = 0; t < 600; t++) {
      for (const e of w.sim.tick()) if (e.kind === 'fire' && e.shooter === r && e.target === p) fired++;
    }
    expect(fired).toBeGreaterThan(0);
    // Stayed near its goal: it did not walk on to effective range.
    expect(17.5 - fx.toNumber(w.sim.state.posX[r])).toBeGreaterThan(6);
  });

  it('does not chase an identified aircraft it has no weapon for', () => {
    const w = world();
    const r = w.sim.spawn(w.looker, 0, fx.from(4.5), fx.from(16.5));
    const h = w.sim.spawn(w.heli, 1, fx.from(22.5), fx.from(16.5));
    w.sim.identifyTo(0, h);
    w.sim.queueCommand({ kind: 'attackMove', ids: [r], x: fx.from(10.5), y: fx.from(16.5) });
    for (let t = 0; t < 600; t++) w.sim.tick();
    // Arrived and stayed: a rifle squad does not walk under a helicopter.
    expect(w.sim.contactLevel(0, h)).toBe(2);
    expect(fx.toNumber(w.sim.state.posX[r])).toBeCloseTo(10.5, 1);
    expect(w.sim.state.moving[r]).toBe(0);
  });
});
