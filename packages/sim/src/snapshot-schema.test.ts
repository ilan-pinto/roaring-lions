import { describe, expect, it } from 'vitest';
import { FlowField } from './flowfield';
import { runDrive, runSetup, woundedSetup } from './golden-worlds.test-helper';
import { Rng } from './rng';
import { Sim } from './sim';
import {
  FLOWFIELD_SNAPSHOT_SCHEMA,
  RNG_SNAPSHOT_SCHEMA,
  SIM_SNAPSHOT_SCHEMA,
  rowsOf,
  type LengthRule,
  type SnapshotRow,
} from './snapshot-schema';

// The completeness gate for the snapshot schema (net sim snapshot S1, Task 2).
// It reflects over live worlds and fails, naming the property, on a Sim own
// property with no row and on a row naming a property no world has; and it
// checks every row's kind against the runtime value, so a table that merely
// lists the right names with the wrong shape is red too.
//
// A match world (`buildMatchWorld`) would need packages/app, which the sim may not import, so the
// same two-way check on the sim of a mirror room and of an economy room lives in
// tools/src/net/snapshot-witness.test.ts ("the schema covers the sim of a real match world").

type Props = Record<string, unknown>;

interface World {
  readonly label: string;
  readonly sim: Sim;
}

function worlds(): World[] {
  const out: World[] = [];
  out.push({ label: 'bare', sim: new Sim({ seed: 0x51ed, width: 20, height: 12, capacity: 30 }) });
  const g0 = runSetup(0x1234);
  out.push({ label: 'golden@0', sim: g0.sim });
  const g500 = runSetup(0x1234);
  for (let t = 0; t < 500; t++) {
    runDrive(g500.sim, t, g500.ids);
    g500.sim.tick();
  }
  out.push({ label: 'golden@500', sim: g500.sim });
  out.push({ label: 'wounded', sim: woundedSetup(0x7070) });
  return out;
}

const props = (o: unknown): Props => o as Props;

function lengthOf(rule: LengthRule, sim: Sim): number | null {
  if (rule === 'any') return null;
  if (rule === 'capacity') return sim.capacity;
  if (rule === 'cells') return sim.width * sim.height;
  if ('capacityTimes' in rule) return sim.capacity * rule.capacityTimes;
  return rule.fixed;
}

/** Every complaint about one object against a row set. Empty means clean. */
function checkRows(label: string, owner: unknown, rows: readonly SnapshotRow[], sim: Sim): string[] {
  const complaints: string[] = [];
  const o = props(owner);
  const have = new Set(Object.keys(o));
  const named = new Set<string>();
  for (const row of rows) {
    if (named.has(row.name)) complaints.push(`${label}: duplicate row "${row.name}"`);
    named.add(row.name);
  }
  for (const k of have) if (!named.has(k)) complaints.push(`${label}: property "${k}" has no row`);
  for (const row of rows) if (!have.has(row.name)) complaints.push(`${label}: row "${row.name}" names no property`);

  for (const row of rows) {
    if (!have.has(row.name)) continue;
    const v = o[row.name];
    const at = `${label}.${row.name}`;
    const kind = row.kind;
    switch (kind.t) {
      case 'typed': {
        if (!ArrayBuffer.isView(v) || (v as object).constructor.name !== kind.ctor) {
          complaints.push(`${at}: expected ${kind.ctor}, found ${show(v)}`);
          break;
        }
        const want = lengthOf(kind.len, sim);
        const got = (v as unknown as { length: number }).length;
        if (want !== null && got !== want) complaints.push(`${at}: length ${got}, rule says ${want}`);
        break;
      }
      case 'scalar':
        if (typeof v !== 'boolean' && !(typeof v === 'number' && Number.isInteger(v))) {
          complaints.push(`${at}: expected an integer or boolean, found ${show(v)}`);
        }
        break;
      case 'rng':
        if (!(v instanceof Rng)) complaints.push(`${at}: expected Rng, found ${show(v)}`);
        else complaints.push(...checkRows(`${at}`, v, RNG_SNAPSHOT_SCHEMA, sim));
        break;
      case 'aux':
        if (!Array.isArray(v)) complaints.push(`${at}: expected an array, found ${show(v)}`);
        break;
      case 'pool':
        complaints.push(...checkPool(at, row.name, o, sim));
        break;
      case 'object':
        if (kind.shape === 'array' && !Array.isArray(v)) complaints.push(`${at}: expected an array, found ${show(v)}`);
        if (kind.shape === 'record' && (v === null || typeof v !== 'object' || Array.isArray(v))) {
          complaints.push(`${at}: expected a plain record, found ${show(v)}`);
        }
        if (kind.shape === 'flowfield' && v !== null && !(v instanceof FlowField)) {
          complaints.push(`${at}: expected FlowField or null, found ${show(v)}`);
        }
        break;
    }
  }
  return complaints;
}

function checkPool(at: string, name: string, sim: Props, world: Sim): string[] {
  const complaints: string[] = [];
  const v = sim[name];
  const slots = (sim.fields as unknown[]).length;
  if (name === 'fields') {
    if (!Array.isArray(v)) return [`${at}: expected an array of FlowField, found ${show(v)}`];
    v.forEach((f, i) => {
      if (!(f instanceof FlowField)) complaints.push(`${at}[${i}]: expected FlowField, found ${show(f)}`);
      else complaints.push(...checkRows(`${at}[${i}]`, f, FLOWFIELD_SNAPSHOT_SCHEMA, world));
    });
  } else if (name === 'fieldByGoal') {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((m) => m instanceof Map)) {
      complaints.push(`${at}: expected one Map per domain (3), found ${show(v)}`);
    }
  } else {
    // fieldGoalKey, fieldDomain, fieldLastIssued: parallel to `fields`, slot for slot.
    if (!Array.isArray(v)) complaints.push(`${at}: expected an array, found ${show(v)}`);
    else {
      if (v.length !== slots) complaints.push(`${at}: length ${v.length}, pool has ${slots} slots`);
      if (!v.every((n) => typeof n === 'number' && Number.isInteger(n))) complaints.push(`${at}: non-integer entry`);
    }
  }
  return complaints;
}

function show(v: unknown): string {
  if (v === null) return 'null';
  if (ArrayBuffer.isView(v)) return `${(v as object).constructor.name}[${(v as unknown as { length: number }).length}]`;
  if (Array.isArray(v)) return `Array[${v.length}]`;
  if (typeof v === 'object') return (v as object).constructor.name;
  return `${typeof v} ${String(v)}`;
}

// The classes, written out independently of the table. `state` is "everything
// else", exactly as the brief has it, so only the four smaller classes are
// listed; reclassifying a property is a deliberate edit to BOTH places.
const CONFIG = [
  'width', 'height', 'capacity', 'seed', 'unitTypes', 'structureTypes', 'boulder', 'hasBoulders', 'openGrid',
  'humanHeldBySide', 'tnPoints', 'tnTiles', 'state', 'structures', 'works',
];
const DERIVED = ['fields'];
const SCRATCH = [
  'seenThisTick', 'bestObserver', 'bestObserverP', 'bestObserverStructure', 'detP', 'detStrength', 'detSig', 'detOccl',
  'detDistSq', 'aimTurned', 'aimDesired', 'aimFrom', 'braceWant', 'sealQueue', 'sealStamp', 'fieldLive',
  'approachField', 'snapX', 'snapY', 'presentedArc', 'engageDSq', 'engageOX', 'engageOY', 'eyeX', 'eyeY',
  'spreadTiles',
];

describe('snapshot schema: completeness', () => {
  const all = worlds();

  it('the four worlds really differ, so a "fixed" length cannot be a capacity in disguise', () => {
    const caps = new Set(all.map((w) => w.sim.capacity));
    const cells = new Set(all.map((w) => w.sim.width * w.sim.height));
    expect(caps.size).toBe(3); // bare 30, wounded 64, both golden 128
    expect(cells.size).toBe(3);
    // A pool exists to check, and an approach field is live in at least one world.
    expect(all.some((w) => (props(w.sim).fields as unknown[]).length > 0)).toBe(true);
    expect(all.some((w) => props(w.sim).approachField instanceof FlowField)).toBe(true);
    expect(all.some((w) => props(w.sim).approachField === null)).toBe(true);
  });

  for (const w of all) {
    it(`${w.label}: every own property has exactly one row, and every row names a property`, () => {
      const names = Object.keys(props(w.sim));
      const rows = new Set(SIM_SNAPSHOT_SCHEMA.map((r) => r.name));
      expect(names.filter((n) => !rows.has(n)), 'properties with no row').toEqual([]);
      expect([...rows].filter((n) => !names.includes(n)), 'rows naming no property').toEqual([]);
      expect(SIM_SNAPSHOT_SCHEMA.length).toBe(rows.size);
    });

    it(`${w.label}: every row's kind matches the runtime value, its length rule included`, () => {
      expect(checkRows('Sim', w.sim, SIM_SNAPSHOT_SCHEMA, w.sim)).toEqual([]);
    });
  }

  it('the classes are exactly the ones the design names; everything else is state', () => {
    const names = (c: Parameters<typeof rowsOf>[0]): string[] => rowsOf(c).map((r) => r.name).sort();
    expect(names('config')).toEqual([...CONFIG].sort());
    expect(names('derived')).toEqual([...DERIVED].sort());
    expect(names('scratch')).toEqual([...SCRATCH].sort());
    const listed = new Set([...CONFIG, ...DERIVED, ...SCRATCH]);
    expect(names('state')).toEqual(SIM_SNAPSHOT_SCHEMA.filter((r) => !listed.has(r.name)).map((r) => r.name).sort());
  });

  it('the properties the design singles out as doubtful are state', () => {
    const cls = new Map(SIM_SNAPSHOT_SCHEMA.map((r) => [r.name, r.cls]));
    for (const n of [
      'rng', 'trail', 'removed', 'fieldRef', 'fieldByGoal', 'fieldGoalKey', 'fieldDomain', 'fieldLastIssued',
      'stProducesFor', 'constructedAt', 'sealGen', 'blockedVehicleMask', 'pendingEvents', 'pendingStrikes',
      'patrolLegIds', 'stTiles', 'commandQueue', 'runtimeQueue',
    ]) {
      expect(cls.get(n), n).toBe('state');
    }
  });

  it('the typed-array kinds are the only place a length rule lives, and the aux and pool rows are the design lists', () => {
    expect(SIM_SNAPSHOT_SCHEMA.filter((r) => r.kind.t === 'aux').map((r) => r.name).sort()).toEqual(
      ['commandQueue', 'patrolLegIds', 'pendingEvents', 'pendingStrikes', 'runtimeQueue', 'stTiles']
    );
    expect(SIM_SNAPSHOT_SCHEMA.filter((r) => r.kind.t === 'pool').map((r) => r.name).sort()).toEqual(
      ['fieldByGoal', 'fieldDomain', 'fieldGoalKey', 'fieldLastIssued', 'fields']
    );
    expect(SIM_SNAPSHOT_SCHEMA.filter((r) => r.kind.t === 'rng').map((r) => r.name)).toEqual(['rng']);
  });

  it('a state row is always a kind the encoder walks: typed with a known length, scalar, rng, aux or pool', () => {
    // An `object` row, or a typed row of unpromised length ('any'), carries no state: the encoder
    // (snapshot.ts) has no way to write either, so one classed `state` would be silently dropped.
    for (const r of rowsOf('state')) {
      const ok =
        (r.kind.t === 'typed' && r.kind.len !== 'any') || r.kind.t === 'scalar' || r.kind.t === 'rng' || r.kind.t === 'aux' || r.kind.t === 'pool';
      expect(ok, `${r.name} is state but has kind ${JSON.stringify(r.kind)}`).toBe(true);
    }
  });

  it('rowsOf returns a class in schema order', () => {
    for (const c of ['state', 'config', 'derived', 'scratch'] as const) {
      const want = SIM_SNAPSHOT_SCHEMA.filter((r) => r.cls === c);
      expect(rowsOf(c)).toEqual(want);
    }
    expect(rowsOf('state').length + rowsOf('config').length + rowsOf('derived').length + rowsOf('scratch').length).toBe(
      SIM_SNAPSHOT_SCHEMA.length
    );
  });

  it('owned objects have their own row sets: Rng, and every FlowField in the pool', () => {
    for (const w of all) {
      const p = props(w.sim);
      expect(checkRows('Rng', p.rng, RNG_SNAPSHOT_SCHEMA, w.sim)).toEqual([]);
      for (const f of p.fields as FlowField[]) expect(checkRows('FlowField', f, FLOWFIELD_SNAPSHOT_SCHEMA, w.sim)).toEqual([]);
    }
    expect(RNG_SNAPSHOT_SCHEMA).toEqual([{ name: 'state', cls: 'state', kind: { t: 'typed', ctor: 'Uint32Array', len: 'capacity' } }]);
    expect(FLOWFIELD_SNAPSHOT_SCHEMA.every((r) => r.cls === 'derived')).toBe(true);
  });
});
