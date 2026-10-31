// GH-859 P1a Task 3, extended in P1b: the formation STATE. Registering a formation, the class on a
// unit type and the latched hash block (the P1a columns, then the fourteen P1b columns of the march,
// the drills and the calls, and the per-unit call class) must change nothing a world can see until a
// formation is ordered, and once one is every column must reach the hash. The behaviour itself is
// read in formation-march / -contact / -calls.test.ts. Every expected value is a literal.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FormationJson } from './formation-template';
import { FM_SEED, RIFLES, RUN_SEED, TANK, formationDrive, formationSetup, runDrive, runSetup } from './golden-worlds.test-helper';
import { Sim, type UnitTypeJson } from './sim';
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

// ---- GH-859 P1b Task 2: fourteen more columns, state only --------------------------------------------------
// Every expected value below is a literal. The columns are written through `internals` the way a snapshot
// poison test reaches a private; nothing in this task writes them.

type ColumnKind = 'row' | 'unit';
/** The fourteen, in Ruling 18's order, with the value a poke writes (nonzero and unlike the empty value). */
const P1B_COLUMNS: readonly { name: string; kind: ColumnKind; ctor: 'Uint8Array' | 'Uint16Array' | 'Int32Array'; poke: number }[] = [
  { name: 'fgLegs', kind: 'row', ctor: 'Uint8Array', poke: 3 },
  { name: 'fgRelease', kind: 'row', ctor: 'Uint8Array', poke: 2 },
  { name: 'fgDress', kind: 'row', ctor: 'Uint16Array', poke: 40 },
  { name: 'fgQuiet', kind: 'row', ctor: 'Uint16Array', poke: 41 },
  { name: 'fgAtCp', kind: 'row', ctor: 'Uint16Array', poke: 2 },
  { name: 'fgAway', kind: 'row', ctor: 'Uint16Array', poke: 1 },
  { name: 'fgCalled', kind: 'row', ctor: 'Uint8Array', poke: 1 },
  { name: 'fgPace', kind: 'row', ctor: 'Int32Array', poke: 9000 },
  { name: 'fgCallX', kind: 'row', ctor: 'Int32Array', poke: 5 * 65536 },
  { name: 'fgCallY', kind: 'row', ctor: 'Int32Array', poke: 7 * 65536 },
  { name: 'fmLeg', kind: 'unit', ctor: 'Uint8Array', poke: 2 },
  { name: 'fmDuty', kind: 'unit', ctor: 'Uint8Array', poke: 2 },
  { name: 'fmHomeX', kind: 'unit', ctor: 'Int32Array', poke: 3 * 65536 },
  { name: 'fmHomeY', kind: 'unit', ctor: 'Int32Array', poke: 4 * 65536 },
];
type Typed = Record<string, Uint8Array | Uint16Array | Int32Array>;
const typed = (sim: Sim): Typed => internals(sim) as unknown as Typed;

describe('the P1b columns: shape, latch and hash', () => {
  const fresh = (): Sim => new Sim({ seed: 3, width: 16, height: 16, capacity: 8 });
  it('there are fourteen, each of its own length and element type, all empty on a fresh sim', () => {
    expect(P1B_COLUMNS).toHaveLength(14);
    const sim = fresh();
    let checked = 0;
    for (const c of P1B_COLUMNS) {
      const col = typed(sim)[c.name];
      expect(col.constructor.name, c.name).toBe(c.ctor);
      expect(col.length, c.name).toBe(c.kind === 'row' ? 32 : 8);
      expect(col.every((v) => v === 0), c.name).toBe(true);
      checked++;
    }
    expect(checked).toBe(14);
  });

  /** A world with one Column ordered, one tick on, so the latch is up legitimately. */
  const ordered = (): Sim => {
    const sim = new Sim({ seed: 7, width: 24, height: 24, capacity: 8 });
    sim.addUnitType(RIFLES);
    sim.addFormationType(loadFormation('column'));
    const ids = [0, 1, 2, 3].map((k) => sim.spawn(0, 0, (4 + k) * 65536 + 32768, 4 * 65536 + 32768));
    sim.queueCommand({ kind: 'move', ids, x: 12 * 65536 + 32768, y: 12 * 65536 + 32768, formation: 'column' });
    sim.tick();
    return sim;
  };

  it('with the latch down none of the fourteen reaches the hash', () => {
    const base = fresh().hash();
    let checked = 0;
    for (const c of P1B_COLUMNS) {
      const sim = fresh();
      typed(sim)[c.name][1] = c.poke;
      expect(sim.hash(), c.name).toBe(base);
      checked++;
    }
    expect(checked).toBe(14);
  });

  it('an order raises the latch, and then each of the fourteen moves the hash on its own', () => {
    const base = ordered();
    expect((internals(base) as unknown as { fmLive: boolean }).fmLive).toBe(true);
    const h0 = base.hash();
    // The ordered world is deterministic: a second copy hashes the same before any poke.
    expect(ordered().hash()).toBe(h0);
    const seen = new Set<number>([h0]);
    let checked = 0;
    for (const c of P1B_COLUMNS) {
      const sim = ordered();
      typed(sim)[c.name][1] = c.poke;
      const h = sim.hash();
      expect(h, c.name).not.toBe(h0);
      seen.add(h);
      checked++;
    }
    expect(checked).toBe(14);
    expect(seen.size).toBe(15); // no two columns collide either
  });

  it('a column that is poked and put back leaves the hash where it was', () => {
    const sim = ordered();
    const h0 = sim.hash();
    for (const c of P1B_COLUMNS) {
      const col = typed(sim)[c.name];
      // G-6, P1b: the march writes real values (a 4-step diagonal is one checkpoint: fgLegs 1 and fmLeg 1 here), so the
      // value put back is the one that was there, not zero.
      const was = col[1];
      col[1] = c.poke;
      col[1] = was;
    }
    expect(sim.hash()).toBe(h0);
  });
});

describe('the formation world moves all fourteen columns of the march, the drills and the calls', () => {
  // G-6, P1b Task 3: this was "moves none of the fourteen" (the premise of the Task 2 pin move). The march wrote
  // seven of them: fgLegs fgRelease fgDress fgAtCp fgPace (rows) and fmLeg fmDuty (units). G-6, P1b Task 4: the drills
  // write three more, fgQuiet fgCallX fgCallY (the side-1 Column halts, the Attack presses). G-6, P1b Task 5: the calls write
  // the last four, fgAway fgCalled fmHomeX fmHomeY (the Column's medic answers a man down at 180; the Attack's helicopter and
  // drone sortie at 511 and come home from 910), so none is left to read empty and the world runs its 1000 ticks.
  const MARCH_COLUMNS = ['fgLegs', 'fgRelease', 'fgDress', 'fgAtCp', 'fgPace', 'fmLeg', 'fmDuty', 'fgQuiet', 'fgCallX', 'fgCallY', 'fgAway', 'fgCalled', 'fmHomeX', 'fmHomeY'];
  it('every column moves at some tick of the 1000', () => {
    expect(MARCH_COLUMNS).toHaveLength(14);
    const { sim, ids } = formationSetup(FM_SEED);
    let liveRowsSeen = 0;
    let scans = 0;
    const moved = new Set<string>();
    for (let t = 0; t < 1000; t++) {
      formationDrive(sim, t, ids);
      sim.tick();
      const fgLive = typed(sim).fgLive;
      for (let g = 0; g < 32; g++) if (fgLive[g] === 1) liveRowsSeen++;
      for (const c of P1B_COLUMNS) {
        const col = typed(sim)[c.name];
        const march = MARCH_COLUMNS.includes(c.name);
        for (let k = 0; k < col.length; k++) {
          if (col[k] === 0) continue;
          if (march) moved.add(c.name);
          else throw new Error(`tick ${t}: ${c.name}[${k}] = ${col[k]}`);
        }
      }
      scans++;
    }
    expect(scans).toBe(1000);
    expect(Array.from(moved).sort()).toEqual([...MARCH_COLUMNS].sort());
    expect((internals(sim) as unknown as { fmLive: boolean }).fmLive).toBe(true);
    expect(liveRowsSeen).toBeGreaterThan(1000); // four groups for most of the run: not a vacuous scan
  });
});

describe('UnitType.fmCall is read once, from the T1 table', () => {
  const find = (dir: string, file: string): string | undefined => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const r = find(join(dir, e.name), file);
        if (r !== undefined) return r;
      } else if (e.name === file) return join(dir, e.name);
    }
    return undefined;
  };
  const callOf = (file: string): number => {
    const path = find(join(ROOT, 'data', 'units'), file);
    if (path === undefined) throw new Error(`no ${file}`);
    const json = JSON.parse(readFileSync(path, 'utf8')) as UnitTypeJson;
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    return sim.unitTypes[sim.addUnitType(json)].fmCall;
  };
  it('reads a strike helicopter, a spotting drone and a swarm; a ground unit has no call', () => {
    expect(callOf('heli_peten.json')).toBe(1); // strike
    expect(callOf('recon_drone.json')).toBe(2); // spot
    expect(callOf('drone_swarm.json')).toBe(0); // stay
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    expect(sim.unitTypes[sim.addUnitType(RIFLES)].fmCall).toBe(0);
    expect(sim.unitTypes[sim.addUnitType(TANK)].fmCall).toBe(0);
  });
});
