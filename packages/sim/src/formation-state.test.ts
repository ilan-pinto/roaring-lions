// GH-859 P1a Task 3: the formation STATE, with no behaviour behind it yet. Registering a
// formation, the class on a unit type and the latched hash block must change nothing a world can
// see until a formation is ordered. Every expected value is a literal.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FormationJson } from './formation-template';
import { RIFLES, RUN_SEED, TANK, runDrive, runSetup } from './golden-worlds.test-helper';
import { Sim } from './sim';
import { encodeSim, internals, restoreSim } from './snapshot';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loadFormation = (id: string): FormationJson => JSON.parse(readFileSync(join(ROOT, 'data', 'formations', `${id}.json`), 'utf8')) as FormationJson;

/** The columns this task adds, reached the way a snapshot poison test reaches a private. */
interface FmColumns {
  fmLive: boolean;
  fmGroup: Int16Array;
  restFacing: Uint16Array;
  fmArrive: Uint8Array;
  fgLive: Uint8Array;
  fgMembers: Uint16Array;
}
const cols = (sim: Sim): FmColumns => sim as unknown as FmColumns;

/** The golden run's world for `ticks` ticks (its own multi-unit attack-moves included), with the
 *  three shipped formations registered first when asked. Returns the hash read every 100 ticks. */
function hashes(register: boolean, ticks: number): { sim: Sim; at: number[] } {
  const { sim, ids } = runSetup(RUN_SEED);
  if (register) for (const id of ['column', 'attack', 'ambush']) sim.addFormationType(loadFormation(id));
  const at: number[] = [];
  for (let t = 0; t < ticks; t++) {
    runDrive(sim, t, ids);
    sim.tick();
    if (t % 100 === 99) at.push(sim.hash());
  }
  return { sim, at };
}

describe('formation registration is hash-neutral until a formation is ordered', () => {
  it('a world holding the three shipped formations hashes like its unregistered twin over 600 ticks', () => {
    const plain = hashes(false, 600);
    const reg = hashes(true, 600);
    expect(reg.sim.formationTypeCount()).toBe(3);
    expect(plain.sim.formationTypeCount()).toBe(0);
    expect(plain.at).toHaveLength(6);
    expect(reg.at).toEqual(plain.at);
    // The latch stayed down: nothing in this world orders a formation.
    expect(cols(reg.sim).fmLive).toBe(false);
  });

  it('the registered indices are file order, and formationIdOf names them', () => {
    const { sim } = runSetup(RUN_SEED);
    expect(sim.addFormationType(loadFormation('column'))).toBe(0);
    expect(sim.addFormationType(loadFormation('attack'))).toBe(1);
    expect(sim.addFormationType(loadFormation('ambush'))).toBe(2);
    expect(sim.formationIdOf(0)).toBe('column');
    expect(sim.formationIdOf(1)).toBe('attack');
    expect(sim.formationIdOf(2)).toBe('ambush');
    expect(sim.formationIdOf(3)).toBe('');
  });

  it('a duplicate id throws and registers nothing', () => {
    const { sim } = runSetup(RUN_SEED);
    sim.addFormationType(loadFormation('column'));
    expect(() => sim.addFormationType(loadFormation('column'))).toThrow('formation column: already registered');
    expect(sim.formationTypeCount()).toBe(1);
  });

  it('a malformed file throws naming its id and registers nothing', () => {
    const { sim } = runSetup(RUN_SEED);
    const bad = { ...loadFormation('column'), id: 'wobbly', verb: 'dance' };
    expect(() => sim.addFormationType(bad)).toThrow('formation wobbly');
    expect(sim.formationTypeCount()).toBe(0);
  });
});

describe('the hash block is latched and then sees every formation column', () => {
  it('the fresh columns read their literals', () => {
    const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 8 });
    const c = cols(sim);
    expect(Array.from(c.fmGroup)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
    expect(Array.from(c.restFacing)).toEqual([65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535]);
    expect(Array.from(c.fmArrive)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(c.fgLive).toHaveLength(32);
    expect(c.fgMembers).toHaveLength(32);
    expect(c.fmLive).toBe(false);
  });

  it('with the latch down no column reaches the hash; with it up each one does', () => {
    const make = (): Sim => {
      const s = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
      s.addUnitType(RIFLES);
      s.spawn(0, 0, 4 * 65536, 4 * 65536);
      return s;
    };
    const base = make().hash();
    // Latch down: a stray write to any column is invisible (a formation order is what raises the latch).
    for (const poke of [
      (c: FmColumns) => { c.fmGroup[0] = 3; },
      (c: FmColumns) => { c.restFacing[0] = 8192; },
      (c: FmColumns) => { c.fmArrive[0] = 19; },
      (c: FmColumns) => { c.fgLive[5] = 1; },
      (c: FmColumns) => { c.fgMembers[5] = 2; },
    ]) {
      const s = make();
      poke(cols(s));
      expect(s.hash()).toBe(base);
    }
    // Latch up: the block exists, and each column moves the hash on its own.
    const up = make();
    cols(up).fmLive = true;
    const latched = up.hash();
    expect(latched).not.toBe(base);
    const seen = new Set<number>([latched]);
    for (const poke of [
      (c: FmColumns) => { c.fmGroup[0] = 3; },
      (c: FmColumns) => { c.restFacing[0] = 8192; },
      (c: FmColumns) => { c.fmArrive[0] = 19; },
      (c: FmColumns) => { c.fgLive[5] = 1; },
      (c: FmColumns) => { c.fgMembers[5] = 2; },
    ]) {
      const s = make();
      cols(s).fmLive = true;
      poke(cols(s));
      seen.add(s.hash());
    }
    expect(seen.size).toBe(6);
  });
});

describe('UnitType.fmClass is read once, from the class function', () => {
  const classOf = (json: Parameters<Sim['addUnitType']>[0]): number => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    return sim.unitTypes[sim.addUnitType(json)].fmClass;
  };
  it('reads infantry, a roleless hull, an mbt, a civilian and an override', () => {
    expect(classOf(RIFLES)).toBe(3); // role infantry, on foot
    expect(classOf(TANK)).toBe(1); // no role: wheeled, so light_vehicle
    expect(classOf({ ...TANK, id: 'x_mbt', role: 'mbt' })).toBe(0);
    expect(classOf({ ...RIFLES, id: 'x_civ', faction: 'civilian' })).toBe(255);
    expect(classOf({ ...RIFLES, id: 'x_recon', formation_class: 'recon' })).toBe(2);
  });
  it('an unknown override throws naming the unit', () => {
    expect(() => classOf({ ...RIFLES, id: 'x_odd', formation_class: 'cavalry' })).toThrow('unit x_odd: formation_class cavalry');
  });
});

describe('a queued formation command crosses a snapshot', () => {
  it('the formation id on a queued move and attackMove survives encode and restore', () => {
    const make = (): Sim => {
      const { sim } = runSetup(RUN_SEED);
      for (const id of ['column', 'attack', 'ambush']) sim.addFormationType(loadFormation(id));
      return sim;
    };
    const a = make();
    for (let t = 0; t < 20; t++) a.tick();
    a.queueCommand({ kind: 'move', ids: [0, 1], x: 5 * 65536, y: 6 * 65536, formation: 'column' });
    a.queueCommand({ kind: 'attackMove', ids: [2, 3], x: 7 * 65536, y: 8 * 65536, sweep: true, formation: 'attack' });
    a.queueCommand({ kind: 'move', ids: [4], x: 9 * 65536, y: 9 * 65536 });
    const queued = internals(a).commandQueue as Record<string, unknown>[];
    expect(queued).toHaveLength(3);
    const fresh = make();
    restoreSim(fresh, encodeSim(a));
    const got = internals(fresh).commandQueue as Record<string, unknown>[];
    expect(got.map((c) => c.formation)).toEqual(['column', 'attack', undefined]);
    expect(got).toEqual(queued);
  });
});
