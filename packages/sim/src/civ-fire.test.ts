import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import type { FormationJson } from './formation-template';
import { Sim, type SimEvent } from './sim';
import { encodeSim, internals, restoreSim, SnapshotRefused } from './snapshot';
import { forkWitness, type ForkVerdict } from './snapshot-witness';
import {
  CF_CELL,
  CF_CIV,
  CF_KDF,
  CF_WOUNDED,
  CIV_FIRE_FLAG_TICK,
  CIV_FIRE_KDF_TICK,
  civFireWorld,
  runCivFireWorld,
  type CivFireWorld,
} from './civ-fire-world.test-helper';

// GH-1438 E6 (docs/campaign/civilian-drama.md §10.2 E6; the lead's ruling D18, Option A, 18 Nov 2026): an enemy
// placement marked `fires_on_civilians`, with no target of the fighting sides in reach, shoots the nearest identified,
// standing civilian. The civilian falls in place and lies still. The mission half (the placement flag, the wave
// passthrough, Conduct and first_contact) is in mission.test.ts, "E6".

type Fire = Extract<SimEvent, { kind: 'fire' }>;

/** Every fire event of the run, as [tick, shooter, target], and every woundedDown as [tick, entity]. */
function record(w: CivFireWorld, ticks: number): { fires: [number, number, number][]; downs: [number, number][] } {
  const fires: [number, number, number][] = [];
  const downs: [number, number][] = [];
  runCivFireWorld(w, ticks, (t, evs) => {
    for (const e of evs) {
      if (e.kind === 'fire') fires.push([t, (e as Fire).shooter, (e as Fire).target]);
      if (e.kind === 'woundedDown') downs.push([t, e.entity]);
    }
  });
  return { fires, downs };
}

describe('fires on civilians: who shoots whom', () => {
  it('a flagged cell shoots the crowd nearest first from the tick it is flagged, and each falls in place', () => {
    const w = civFireWorld();
    const [c0, c1, c2] = w.civilians;
    const { fires, downs } = record(w, CIV_FIRE_KDF_TICK);
    // Literals read off the run (the world's comment gives the distances: 3.2, 4.1 and 5.4 tiles from cell A).
    expect(fires.map(([, s, t]) => [s, t])).toEqual([
      [w.cellA, c0], [w.cellA, c0],
      [w.cellA, c1], [w.cellA, c1], [w.cellA, c1], [w.cellA, c1],
      [w.cellA, c2], [w.cellA, c2], [w.cellA, c2],
    ]);
    expect(fires[0][0]).toBe(CIV_FIRE_FLAG_TICK);
    expect(downs.map(([, e]) => e)).toEqual([c0, c1, c2]);
    // Down in place: alive, down, and never shot again after he fell.
    for (const [t, e] of downs) {
      expect([w.sim.state.alive[e], w.sim.state.woundState[e] !== 0]).toEqual([1, true]);
      expect(fires.filter(([ft, , tg]) => tg === e && ft > t)).toEqual([]);
    }
  });

  it('the same world unflagged: nobody ever fires at a civilian (and cell B, never flagged, never does in the flagged world)', () => {
    const cw = civFireWorld(false);
    const control = record(cw, 600);
    expect(control.fires.length).toBeGreaterThan(0); // the KDF firefight still happens
    expect(control.fires.filter(([, , t]) => cw.sim.state.side[t] === 2)).toEqual([]);
    expect(control.downs).toEqual([]);
    const w = civFireWorld();
    const flagged = record(w, 600);
    expect(flagged.fires.filter(([, s, t]) => s === w.cellB && w.sim.state.side[t] === 2)).toEqual([]);
  });

  it('the fighting sides first: once a KDF man in reach is identified the flagged cell shoots only him, though a civilian stands nearer', () => {
    const sim = new Sim({ seed: 0x14386, width: 24, height: 12, capacity: 8 });
    sim.addUnitType(CF_WOUNDED);
    const cell = sim.spawn(sim.addUnitType(CF_CELL), 1, fx.from(10.5), fx.from(5.5));
    // A civilian who cannot fall (no wounds, vast hp), so he stands nearer than the KDF man for the whole run: the
    // preference, not his going down, is what keeps the cell off him.
    const sturdy = { ...CF_CIV, id: 'cf_sturdy', hull: { hp: 1000000, armor: { front: 0, side: 0, rear: 0 } } };
    const civ = sim.spawn(sim.addUnitType(sturdy), 2, fx.from(12.5), fx.from(5.5)); // 2 tiles
    const kdf = sim.spawn(sim.addUnitType({ ...CF_KDF, weapons: [] }), 0, fx.from(15.5), fx.from(5.5)); // 5 tiles
    sim.setCivFire(cell);
    const targets: number[] = [];
    for (let t = 0; t < 200; t++) for (const e of sim.tick()) if (e.kind === 'fire') targets.push((e as Fire).target);
    // The civilian, 2 tiles off, is identified first and draws the opening shot; from the KDF man's first shot on,
    // every round goes to him.
    const first = targets.indexOf(kdf);
    expect(first).toBeGreaterThan(0);
    expect(targets.slice(0, first).every((t) => t === civ)).toBe(true);
    expect(targets.length - first).toBeGreaterThan(10);
    expect(targets.slice(first)).toEqual(new Array<number>(targets.length - first).fill(kdf));
    expect([sim.state.alive[civ], sim.state.woundState[civ]]).toEqual([1, 0]); // he stood throughout
  });

  it('a civilian nobody of side 1 has identified is not shot (the same contact rule as any target)', () => {
    const sim = new Sim({ seed: 0x14386, width: 24, height: 12, capacity: 8 });
    sim.addUnitType(CF_WOUNDED);
    // A blind cell: it sees 0 tiles, so nothing of its side ever identifies the civilian 2 tiles off.
    const cell = sim.spawn(sim.addUnitType({ ...CF_CELL, sensors: { optics: 1, sight_tiles: 0, signature: 0.6 } }), 1, fx.from(10.5), fx.from(5.5));
    sim.spawn(sim.addUnitType(CF_CIV), 2, fx.from(12.5), fx.from(5.5));
    sim.setCivFire(cell);
    let fired = 0;
    for (let t = 0; t < 200; t++) for (const e of sim.tick()) if (e.kind === 'fire') fired++;
    expect(fired).toBe(0);
  });
});

// A shot at a civilian is not contact: `fireAt` reports formation contact only for a target of the fighting sides
// (`side[target] <= 1`), so a flagged cell marching in an Attack formation keeps marching past the crowd it fires on.
// Mutation: delete the side test from `fireAt`'s `fmPend` call (contacts 0 -> 1).
describe('fires on civilians: a formation', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const attack = JSON.parse(readFileSync(join(ROOT, 'data', 'formations', 'attack.json'), 'utf8')) as FormationJson;

  it('two flagged cells attack-moving in formation past a civilian fire on him and report no contact', () => {
    const sim = new Sim({ seed: 0x15, width: 40, height: 12, capacity: 16 });
    sim.addUnitType(CF_WOUNDED);
    const cell = sim.addUnitType(CF_CELL);
    const civType = sim.addUnitType(CF_CIV);
    sim.addFormationType(attack);
    const a = sim.spawn(cell, 1, fx.from(4.5), fx.from(5.5));
    const b = sim.spawn(cell, 1, fx.from(4.5), fx.from(6.5));
    const civ = sim.spawn(civType, 2, fx.from(12.5), fx.from(5.5));
    sim.setCivFire(a);
    sim.setCivFire(b);
    sim.queueCommand({ kind: 'attackMove', ids: [a, b], x: fx.from(36.5), y: fx.from(6.5), formation: 'attack' });
    const evs: SimEvent[] = [...sim.tick()];
    // The order formed a group: without one there is nothing to report contact to, and the 0 below would be vacuous.
    const fmGroup = internals(sim).fmGroup as Int32Array;
    expect(internals(sim).fmLive).toBe(true);
    expect(fmGroup[a]).toBeGreaterThanOrEqual(0);
    expect(fmGroup[b]).toBe(fmGroup[a]);
    for (let t = 0; t < 400; t++) evs.push(...sim.tick());
    const atCiv = evs.filter((e) => e.kind === 'fire' && (e as Fire).target === civ).length;
    const contacts = evs.filter((e) => e.kind === 'formationContact' || e.kind === 'formationSprung').length;
    expect(atCiv).toBe(27); // read off the run
    expect(contacts).toBe(0);
  });
});

describe('fires on civilians: setCivFire and the deferred fold', () => {
  it('refuses a civilian, a KDF unit and a dead enemy; takes a living enemy', () => {
    const w = civFireWorld(false);
    expect(() => w.sim.setCivFire(w.civilians[0])).toThrow(/only side 1/);
    expect(() => w.sim.setCivFire(w.kdf)).toThrow(/only side 1/);
    w.sim.debugKill(w.cellB);
    expect(() => w.sim.setCivFire(w.cellB)).toThrow(/not a living entity/);
    expect(w.sim.firesOnCivilians(w.cellA)).toBe(false);
    w.sim.setCivFire(w.cellA);
    expect(w.sim.firesOnCivilians(w.cellA)).toBe(true);
  });

  it('nothing folds before the flag: the flagged and the control world hash alike to the flag tick, and part on it', () => {
    const a = civFireWorld();
    const b = civFireWorld(false);
    for (let t = 0; t < CIV_FIRE_FLAG_TICK; t++) {
      a.drive(t);
      b.drive(t);
      a.sim.tick();
      b.sim.tick();
      expect(a.sim.hash(), `tick ${t}`).toBe(b.sim.hash());
    }
    expect(internals(a.sim).civFireLive).toBe(false);
    a.drive(CIV_FIRE_FLAG_TICK);
    expect(internals(a.sim).civFireLive).toBe(true);
    expect(a.sim.hash()).not.toBe(b.sim.hash());
  });
});

describe('fires on civilians: the snapshot', () => {
  // Mutation: drop the `civFire` row from snapshot-schema.ts. The restored cell is unflagged, so it holds its fire.
  const fork = (T: number): ForkVerdict<CivFireWorld> =>
    forkWitness<CivFireWorld>({ build: () => civFireWorld(), drive: (world, t) => world.drive(t), T, horizon: 120, hashEvery: 4 });
  for (const [label, T] of [
    ['before the flag', 30],
    ['the flag set, the first civilian still standing', 42],
    ['mid-crowd', 50],
    ['the KDF squad walking in', CIV_FIRE_KDF_TICK + 20],
    ['in the firefight', 450],
  ] as const) {
    it(`a snapshot cut ${label} (T = ${T}) restores to the uninterrupted run`, () => {
      const v = fork(T);
      expect(v.configDifference).toBeNull();
      expect(v.roundTripEqualAtT).toBe(true);
      expect(v.hashDivergedAt).toBeNull();
      expect(v.encodingEqualAtEnd, v.firstDifference ?? '').toBe(true);
    });
  }

  // Mutation: delete either restore check in snapshot.ts.
  it('a flag outside 0..1, or a set flag with the fold off, is refused', () => {
    const w = civFireWorld();
    runCivFireWorld(w, 50);
    (internals(w.sim).civFire as Uint8Array)[w.cellA] = 2;
    expect(() => restoreSim(civFireWorld().sim, encodeSim(w.sim, {}))).toThrow(SnapshotRefused);
    const v = civFireWorld(false);
    runCivFireWorld(v, 50);
    (internals(v.sim).civFire as Uint8Array)[v.cellA] = 1;
    expect(() => restoreSim(civFireWorld().sim, encodeSim(v.sim, {}))).toThrow(/civFireLive false/);
  });
});
