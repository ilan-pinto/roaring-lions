// GH-859 P1a Task 2: the pure template. Every expected value below is a literal written out by
// hand (casebook: "the oracle imported its arguments"): the class table, the ring lists, the
// facing constants and every slot. Nothing is computed by the code under test.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, unitTypeFromJson, type UnitTypeJson } from './sim';
import { DIR_NONE } from './flowfield';
import { FORMATION_WALK_CAP } from './tuning';
import {
  FM_CALL_SPOT,
  FM_CALL_STAY,
  FM_CALL_STRIKE,
  aircraftCallOf,
  assignTemplate,
  checkpointsOf,
  compileFormation,
  eighthToward,
  formationClassOf,
  ringTiles,
  routeWalk,
  templateOffsets,
  type CompiledFormation,
  type FormationJson,
  type TemplateInput,
  type TemplateUnit,
  type UnitCallJson,
  type UnitClassJson,
} from './formation-template';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loadFormation = (id: string): FormationJson => JSON.parse(readFileSync(join(ROOT, 'data', 'formations', `${id}.json`), 'utf8')) as FormationJson;
const compiled = (id: string): CompiledFormation => compileFormation(loadFormation(id));

// ---- class codes, as literals ---------------------------------------------------------------
const ARMOUR = 0;
const LIGHT = 1;
const RECON = 2;
const INFANTRY = 3;
const SUPPORT = 4;
const MEDIC = 5;
const AIRCRAFT = 6;
const NONE = 255;
const FACING_NONE = 0xffff;
const CLASS_CODE: Record<string, number> = {
  armour: ARMOUR, light_vehicle: LIGHT, recon: RECON, infantry: INFANTRY, support_weapon: SUPPORT, medic: MEDIC, aircraft: AIRCRAFT, none: NONE,
};

// ---------------------------------------------------------------------------------------------
describe('formationClassOf: the 50 shipped units against the spec 2.1 table', () => {
  // The spec's table, id by id, the four proposed overrides included. A literal, not the function.
  const TABLE: Record<string, string> = {
    mbt_lavi: 'armour', mbt_lavi_camo: 'armour', ifv_namer: 'armour', dozer_d9: 'armour',
    apc_eitan: 'light_vehicle', apc_kipod: 'light_vehicle', jeep_shoded: 'light_vehicle', demo_tzav: 'light_vehicle',
    aa_remetz: 'light_vehicle', technical: 'light_vehicle', moto_rpg: 'light_vehicle', gun_truck: 'light_vehicle',
    scout_shachaf: 'recon', ugv_recon_dog: 'recon', recon_zikit: 'recon',
    inf_squad: 'infantry', inf_grenadier: 'infantry', at_team: 'infantry', breach_team: 'infantry', demo_squad: 'infantry',
    yahalom_squad: 'infantry', sarim_rifles: 'infantry', militia_cell: 'infantry', charge_squad: 'infantry', rpg_team: 'infantry',
    recoilless_team: 'infantry', digger_crew: 'infantry', manpad_team: 'infantry', atgm_cell: 'infantry',
    mortar_team: 'support_weapon', sniper_team: 'support_weapon', spg_cluster: 'support_weapon', spg_long_range: 'support_weapon',
    at_nlos_team: 'support_weapon', mortar_crew: 'support_weapon', rocket_battery: 'support_weapon',
    inf_medic_squad: 'medic', veh_ambulance: 'medic', air_medevac_heli: 'medic',
    heli_peten: 'aircraft', heli_peten_gunship: 'aircraft', heli_yanshuf: 'aircraft', recon_drone: 'aircraft',
    attack_drone: 'aircraft', drone_swarm: 'aircraft', loiter_drone: 'aircraft', paramotor: 'aircraft',
    wounded_kdf: 'none', wounded_sarim: 'none', civilians: 'none',
  };
  // The roles `wheeled` defaults to false for (sim.ts FOOT_ROLES), restated here as a literal.
  const FOOT_ROLES = ['infantry', 'at_team', 'artillery', 'engineer', 'sniper', 'support'];

  const files: string[] = [];
  const collect = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) collect(join(dir, e.name));
      else if (e.name.endsWith('.json')) files.push(join(dir, e.name));
    }
  };
  collect(join(ROOT, 'data', 'units'));
  const units = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as UnitClassJson & { id: string; mobility: { wheeled?: boolean } });

  it('covers every unit on disk and nothing else (a unit with no row is a red test, not a silent default)', () => {
    expect(Object.keys(TABLE)).toHaveLength(50);
    expect(units.map((u) => u.id).sort()).toEqual(Object.keys(TABLE).sort());
  });
  it('reads each unit as the table says', () => {
    for (const u of units) {
      const wheeled = u.mobility.wheeled ?? !FOOT_ROLES.includes(u.role ?? '');
      expect(formationClassOf(u, wheeled), u.id).toBe(CLASS_CODE[TABLE[u.id]]);
    }
  });
  it('M7b: the sim\'s own type builder reads each unit as the same table (a FOOT_ROLES change reaches here)', () => {
    let checked = 0;
    for (const u of units) {
      expect(unitTypeFromJson(u as unknown as UnitTypeJson).fmClass, u.id).toBe(CLASS_CODE[TABLE[u.id]]);
      checked++;
    }
    expect(checked).toBe(50);
  });
  it('the override wins, and an unknown one throws naming the unit', () => {
    expect(formationClassOf({ id: 'x', role: 'infantry', formation_class: 'armour' }, false)).toBe(ARMOUR);
    expect(formationClassOf({ id: 'x', role: 'mbt', formation_class: 'none' }, true)).toBe(NONE);
    expect(() => formationClassOf({ id: 'oddball', role: 'mbt', formation_class: 'tank' }, true)).toThrow('unit oddball: formation_class tank');
  });
  it('the first matching rule wins: a wounded role is none even in the air, a rescue block is a medic even on wheels', () => {
    expect(formationClassOf({ role: 'wounded', mobility: { domain: 'air' } }, false)).toBe(NONE);
    expect(formationClassOf({ role: 'support', rescue: {} }, true)).toBe(MEDIC);
    expect(formationClassOf({ role: 'apc', hull: { can_carry: ['wounded'] } }, true)).toBe(MEDIC);
    expect(formationClassOf({ role: 'apc', hull: { can_carry: ['wounded', 'infantry'] } }, true)).toBe(LIGHT);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the ring', () => {
  it('has the midpoint circle counts', () => {
    expect([2, 3, 4, 5, 6, 7, 8].map((r) => ringTiles(r).length)).toEqual([12, 16, 24, 28, 32, 40, 44]);
  });
  it('R = 3 is this list, in this order', () => {
    expect(ringTiles(3)).toEqual([
      [3, 0], [3, 1], [2, 2], [1, 3], [0, 3], [-1, 3], [-2, 2], [-3, 1],
      [-3, 0], [-3, -1], [-2, -2], [-1, -3], [0, -3], [1, -3], [2, -2], [3, -1],
    ]);
  });
  it('is angularly monotone for R = 3..6 (quadrant, then cross-product sign), and closed with no repeats', () => {
    // Test-local integer check: counter-clockwise from (r, 0), (forward, lateral) with lateral up.
    const quadrant = (f: number, l: number): number => (l >= 0 ? (f > 0 || (f === 0 && l > 0) ? (f > 0 ? 0 : 1) : 1) : f < 0 || (f === 0 && l < 0) ? 2 : 3);
    for (const r of [3, 4, 5, 6]) {
      const t = ringTiles(r);
      expect(new Set(t.map(([f, l]) => `${f},${l}`)).size).toBe(t.length);
      expect(t[0]).toEqual([r, 0]);
      for (let i = 1; i < t.length; i++) {
        const [pf, pl] = t[i - 1];
        const [f, l] = t[i];
        const qa = quadrant(pf, pl);
        const qb = quadrant(f, l);
        expect(qb === qa || qb === qa + 1, `R${r} step ${i} quadrant`).toBe(true);
        if (qb === qa) expect(pf * l - pl * f, `R${r} step ${i} turns counter-clockwise`).toBeGreaterThan(0);
        // continuity: a step moves at most one tile either way
        expect(Math.abs(f - pf) <= 1 && Math.abs(l - pl) <= 1, `R${r} step ${i} adjacent`).toBe(true);
      }
    }
  });
});

describe('ringTiles is shared and frozen (N2)', () => {
  it('the list and every tile in it refuse a write, and a second call returns the same list', () => {
    const t = ringTiles(3);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t[0])).toBe(true);
    expect(() => (t as unknown as number[][]).push([9, 9])).toThrow(TypeError);
    expect(() => {
      (t[0] as unknown as number[])[0] = 9;
    }).toThrow(TypeError);
    expect(ringTiles(3)[0]).toEqual([3, 0]);
    expect(ringTiles(3)).toBe(t);
  });
});

// ---------------------------------------------------------------------------------------------
// P1b Task 1: the march geometry. Every list below is written out by hand.
describe('routeWalk', () => {
  // A 6 x 6 grid, tile = y * 6 + x. DIR codes: 0 = +x, 1 = +x+y, 2 = +y, 4 = -x, 6 = -y. The dog-leg:
  // (0,0) east, (1,0) east, (2,0) south-east to (3,1), (3,1) south, (3,2) south, arriving at (3,3).
  const dogLeg = (): Uint8Array => {
    const d = new Uint8Array(36).fill(DIR_NONE);
    d[0 * 6 + 0] = 0;
    d[0 * 6 + 1] = 0;
    d[0 * 6 + 2] = 1;
    d[1 * 6 + 3] = 2;
    d[2 * 6 + 3] = 2;
    return d;
  };
  it('follows the dirs one tile per step: the tiles AFTER the start, the goal last', () => {
    expect(Array.from(routeWalk(dogLeg(), 6, 6, 0, 0, 3, 3) ?? [])).toEqual([1, 2, 9, 15, 21]);
  });
  it('a start on the goal is an empty route, not null', () => {
    const r = routeWalk(dogLeg(), 6, 6, 3, 3, 3, 3);
    expect(r).not.toBeNull();
    expect(Array.from(r ?? [99])).toEqual([]);
  });
  it('a DIR_NONE cell on the path gives null', () => {
    const d = dogLeg();
    d[1 * 6 + 3] = DIR_NONE; // (3,1) has no direction
    expect(routeWalk(d, 6, 6, 0, 0, 3, 3)).toBeNull();
  });
  it('a 2-cell cycle gives null at w x h steps', () => {
    const d = new Uint8Array(36).fill(DIR_NONE);
    d[0] = 0; // (0,0) east
    d[1] = 4; // (1,0) west
    expect(routeWalk(d, 6, 6, 0, 0, 5, 5)).toBeNull();
  });
  it('a walk off the grid gives null', () => {
    const d = new Uint8Array(36).fill(DIR_NONE);
    d[5] = 0; // (5,0) east: off the edge
    expect(routeWalk(d, 6, 6, 5, 0, 0, 5)).toBeNull();
  });
});

describe('checkpointsOf', () => {
  // budget 9: S = max(legTiles, ceil(L / 9)); the last checkpoint is always L - 1.
  const ROWS: [number, number, number[]][] = [
    [8, 0, []],
    [8, 1, [0]],
    [8, 8, [7]],
    [8, 9, [7, 8]],
    [8, 16, [7, 15]],
    [8, 17, [7, 15, 16]],
    [8, 100, [11, 23, 35, 47, 59, 71, 83, 95, 99]],
    [0, 30, [29]],
  ];
  it('has the eight rows', () => {
    expect(ROWS).toHaveLength(8);
  });
  for (const [legTiles, length, want] of ROWS) {
    it(`legTiles ${legTiles}, L ${length}: ${JSON.stringify(want)}`, () => {
      expect(checkpointsOf(length, legTiles, 9)).toEqual(want);
    });
  }
});

describe('aircraftCallOf: the T0 census of every shipped air unit (Ruling 12)', () => {
  // By hand. Seats are hull.transport_slots, kamikaze is in top-level abilities, swarm is a top-level block.
  const CALLS: Record<string, number> = {
    heli_peten: FM_CALL_STRIKE, heli_peten_gunship: FM_CALL_STRIKE, paramotor: FM_CALL_STRIKE,
    heli_yanshuf: FM_CALL_STAY, // six seats
    recon_drone: FM_CALL_SPOT,
    attack_drone: FM_CALL_STAY, loiter_drone: FM_CALL_STAY, // kamikaze
    drone_swarm: FM_CALL_STAY, // swarm
    air_medevac_heli: FM_CALL_STAY, // four seats, no weapon: the CCP
  };
  const air: (UnitCallJson & { id: string })[] = [];
  const collect = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) collect(join(dir, e.name));
      else if (e.name.endsWith('.json')) {
        const j = JSON.parse(readFileSync(join(dir, e.name), 'utf8')) as UnitCallJson & { id: string };
        if (j.mobility?.domain === 'air') air.push(j);
      }
    }
  };
  collect(join(ROOT, 'data', 'units'));
  it('knows the constants', () => {
    expect([FM_CALL_STAY, FM_CALL_STRIKE, FM_CALL_SPOT]).toEqual([0, 1, 2]);
  });
  it('covers every air unit on disk and nothing else', () => {
    expect(Object.keys(CALLS)).toHaveLength(9);
    expect(air.map((u) => u.id).sort()).toEqual(Object.keys(CALLS).sort());
  });
  it('reads each as the table says', () => {
    let checked = 0;
    for (const u of air) {
      expect(aircraftCallOf(u), u.id).toBe(CALLS[u.id]);
      checked++;
    }
    expect(checked).toBe(9);
  });
  it('seats beat a ground weapon, a block beats a weapon, a missing can_target means ground', () => {
    const base = { id: 'x', mobility: { domain: 'air' } };
    expect(aircraftCallOf({ ...base, weapons: [{}] })).toBe(FM_CALL_STRIKE);
    expect(aircraftCallOf({ ...base, weapons: [{ can_target: ['air'] }] })).toBe(FM_CALL_SPOT);
    expect(aircraftCallOf({ ...base, weapons: [{ can_target: ['air'] }, { can_target: ['ground', 'structure'] }] })).toBe(FM_CALL_STRIKE);
    expect(aircraftCallOf({ ...base, weapons: [] })).toBe(FM_CALL_SPOT);
    expect(aircraftCallOf({ ...base, hull: { transport_slots: 2 }, weapons: [{}] })).toBe(FM_CALL_STAY);
    expect(aircraftCallOf({ ...base, hull: { transport_slots: 0 }, weapons: [{}] })).toBe(FM_CALL_STRIKE);
    expect(aircraftCallOf({ ...base, abilities: ['kamikaze'], weapons: [{}] })).toBe(FM_CALL_STAY);
    expect(aircraftCallOf({ ...base, swarm: {}, weapons: [{}] })).toBe(FM_CALL_STAY);
  });
  it('throws naming the unit on a value it cannot read', () => {
    expect(() => aircraftCallOf({ id: 'oddball', mobility: { domain: 'air' }, hull: { transport_slots: -1 } })).toThrow('unit oddball: hull.transport_slots -1');
    expect(() => aircraftCallOf({ id: 'oddball', mobility: { domain: 'air' }, weapons: [{ can_target: ['sky'] }] })).toThrow('unit oddball: weapons[0].can_target sky');
    expect(() => aircraftCallOf({ id: 'oddball', mobility: { domain: 'ground' } })).toThrow('unit oddball: mobility.domain ground');
  });
});

describe('eighthToward', () => {
  it('names the eight unit vectors', () => {
    const cases: [number, number, number][] = [
      [1, 0, 0], [1, 1, 8192], [0, 1, 16384], [-1, 1, 24576], [-1, 0, 32768], [-1, -1, 40960], [0, -1, 49152], [1, -1, 57344],
    ];
    for (const [dx, dy, want] of cases) expect(eighthToward(dx, dy), `${dx},${dy}`).toBe(want);
  });
  it('an axis wins only by MORE than 2:1; exactly 2:1 is the nearer diagonal', () => {
    expect(eighthToward(3, 1)).toBe(0);
    expect(eighthToward(2, 1)).toBe(8192);
    expect(eighthToward(1, 2)).toBe(8192);
    expect(eighthToward(1, 3)).toBe(16384);
    expect(eighthToward(-3, -1)).toBe(32768);
    expect(eighthToward(-1, -3)).toBe(49152);
  });
  it('(0, 0) has no direction', () => {
    expect(eighthToward(0, 0)).toBe(FACING_NONE);
  });
});

// ---------------------------------------------------------------------------------------------
// A 48 x 48 map, click (24, 24), approach from the south: forward is -y, lateral is +x. So a slot
// at frame (f, l) is the tile (24 + l, 24 - f), and these helpers turn a tile back into a frame.
const W = 48;
const H = 48;
const FOOT = 0;
const VEHICLE = 1;
const openMask = (): Uint8Array => new Uint8Array(W * H);
type Frame = { fx: number; fy: number; lx: number; ly: number };
const SOUTH: Frame = { fx: 0, fy: -1, lx: 1, ly: 0 };

function unit(id: number, cls: number): TemplateUnit {
  const vehicle = cls === ARMOUR || cls === LIGHT || cls === RECON;
  return { id, domain: vehicle ? VEHICLE : FOOT, cls, vehicle, air: cls === AIRCRAFT };
}
function input(units: TemplateUnit[], over: Partial<TemplateInput> = {}): TemplateInput {
  const foot = openMask();
  return {
    width: W, height: H, masks: [foot, foot], origins: [[24, 24], [24, 24]], clickX: 24, clickY: 24, fromX: 24, fromY: 40,
    units, reserved: new Uint8Array(W * H), cover: new Uint8Array(W * H), ...over,
  };
}
/** id -> [forward, lateral] in `frame`, from the click (24, 24). */
function framed(slots: { id: number; x: number; y: number }[], frame: Frame = SOUTH): Map<number, [number, number]> {
  const m = new Map<number, [number, number]>();
  for (const s of slots) m.set(s.id, [(s.x - 24) * frame.fx + (s.y - 24) * frame.fy + 0, (s.x - 24) * frame.lx + (s.y - 24) * frame.ly + 0]); // + 0: no negated zero
  return m;
}
const mix = (...classes: number[]): TemplateUnit[] => classes.map((c, i) => unit(i + 1, c));
const lit = (m: Map<number, [number, number]>): Record<number, [number, number]> => Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]));

describe('Column on open ground', () => {
  const tpl = compiled('column');
  it('3 armour at (0,0) (-1,+2) (-3,0), then infantry from row -5 after the 1-tile gap, in two files', () => {
    const { slots, ringRadius } = assignTemplate(input(mix(ARMOUR, ARMOUR, ARMOUR, INFANTRY, INFANTRY, INFANTRY, INFANTRY)), tpl);
    expect(ringRadius).toBe(0);
    expect(lit(framed(slots))).toEqual({ 1: [0, 0], 2: [-1, 2], 3: [-3, 0], 4: [-5, 0], 5: [-5, 2], 6: [-6, 0], 7: [-6, 2] });
    // arrival.face "travel": the way it marches, 49152 for a march to the north (-y)
    for (const s of slots) expect(s.face, `id ${s.id}`).toBe(49152);
  });
  it('24 armour: the hulls past the walk spill BEHIND the column in its own pattern, spacing kept (S3)', () => {
    // click (24, 10), approach from the south: slot k of the armour element is file k % 2, row k / 2, at
    // forward -(3 row + file), lateral 2 file: tile (24 + 2 file, 10 + 3 row + file). The walk's cap of 24
    // holds hulls 1..17 (rows 0..8 in file 0, 0..7 in file 1); hulls 18..24 are the spill.
    const { slots, overflow } = assignTemplate(input(mix(...Array<number>(24).fill(ARMOUR)), { origins: [[24, 10], [24, 10]], clickY: 10 }), tpl);
    expect(overflow).toEqual([]);
    const tile = (id: number): [number, number] => {
      const s = slots.find((q) => q.id === id);
      return s === undefined ? [-1, -1] : [s.x, s.y];
    };
    expect(tile(1)).toEqual([24, 10]);
    expect(tile(2)).toEqual([26, 11]);
    expect(tile(17)).toEqual([24, 34]); // row 8, file 0: still inside the walk (24 deep)
    expect([18, 19, 20, 21, 22, 23, 24].map(tile)).toEqual([[26, 35], [24, 37], [26, 38], [24, 40], [26, 41], [24, 43], [26, 44]]);
    // every hull is 3 rows from the one before it in its file: no knot, no hull at the head
    for (const file of [24, 26]) {
      const ys = slots.filter((q) => q.x === file).map((q) => q.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], `file x=${file}`).toBe(3);
    }
  });
  it('a recon unit takes the point slot 3 ahead and does not move the stack', () => {
    const { slots } = assignTemplate(input(mix(RECON, INFANTRY, INFANTRY)), tpl);
    expect(lit(framed(slots))).toEqual({ 1: [3, 0], 2: [0, 0], 3: [0, 2] });
  });
  it('support weapons trail the infantry with no gap, medics a gap of 1, aircraft a gap of 2 and no facing', () => {
    // infantry rows 0 and -1 (4 in two files), support at -2, medic at -2-1-1 = -4, aircraft at -5 - 2 - 1 ... see below
    const { slots } = assignTemplate(input(mix(INFANTRY, INFANTRY, INFANTRY, INFANTRY, SUPPORT, MEDIC, AIRCRAFT)), tpl);
    // infantry (0,0) (0,2) (-1,0) (-1,2); support: rear -1, gap 0 -> front row -2: (-2,0); medic 1 file depth 2:
    // rear -2, gap 1 -> front row -4: (-4,0); aircraft rank, gap 2: the medic's rear is -4 -> -7: (-7,0)
    expect(lit(framed(slots))).toEqual({ 1: [0, 0], 2: [0, 2], 3: [-1, 0], 4: [-1, 2], 5: [-2, 0], 6: [-4, 0], 7: [-7, 0] });
    expect(slots.find((s) => s.id === 7)?.face).toBe(FACING_NONE);
    expect(slots.find((s) => s.id === 1)?.face).toBe(49152);
  });
  it('in a one-tile street the right file loses every slot: file 0 holds every member, in class order', () => {
    const street = openMask();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x !== 24) street[y * W + x] = 1;
    const { slots } = assignTemplate(input(mix(INFANTRY, INFANTRY, SUPPORT), { masks: [street, street] }), tpl);
    expect(slots.map((s) => [s.id, s.x, s.y])).toEqual([[1, 24, 24], [2, 24, 25], [3, 24, 26]]);
  });
  it('vehicles in the same street are still 3 apart (every third tile of file 0)', () => {
    const street = openMask();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x !== 24) street[y * W + x] = 1;
    const { slots } = assignTemplate(input(mix(ARMOUR, ARMOUR, ARMOUR), { masks: [street, street] }), tpl);
    expect(slots.map((s) => [s.id, s.x, s.y])).toEqual([[1, 24, 24], [2, 24, 27], [3, 24, 30]]);
  });
  it('armour anchors at the vehicle-snapped click in a boulder corridor, and the infantry start again at row 0 of the click', () => {
    const foot = openMask();
    const veh = openMask();
    veh[24 * W + 24] = 1;
    veh[23 * W + 24] = 1; // the two tiles of boulder in front of the click: vehicles snap to (24, 22)
    const { slots } = assignTemplate(
      input(mix(ARMOUR, ARMOUR, INFANTRY, INFANTRY), { masks: [foot, veh], origins: [[24, 24], [24, 22]] }),
      tpl
    );
    expect(slots.map((s) => [s.id, s.x, s.y])).toEqual([[1, 24, 22], [2, 26, 23], [3, 24, 24], [4, 26, 24]]);
  });
});

describe('Attack on open ground', () => {
  const tpl = compiled('attack');
  it('armour line abreast on the click row, infantry 2 behind, the medic 11 behind the click', () => {
    const { slots } = assignTemplate(input(mix(ARMOUR, ARMOUR, INFANTRY, INFANTRY, INFANTRY, INFANTRY, INFANTRY, MEDIC)), tpl);
    expect(lit(framed(slots))).toEqual({
      1: [0, 0], 2: [0, 2], 3: [-2, 0], 4: [-2, 1], 5: [-2, -1], 6: [-2, 2], 7: [-2, -2], 8: [-11, 0],
    });
    // arrival.face "front": the approach direction
    expect(slots.every((s) => s.face === 49152)).toBe(true);
  });
  it('aircraft stand 13 behind, light vehicles and recon share the second rank 3 behind the armour', () => {
    const { slots } = assignTemplate(input(mix(ARMOUR, LIGHT, RECON, AIRCRAFT)), tpl);
    // armour (0,0); light + recon element: gap 2 after the armour rear 0 -> front row -3, ids 2 then 3: (-3,0) (-3,2);
    // aircraft: standoff 13
    expect(lit(framed(slots))).toEqual({ 1: [0, 0], 2: [-3, 0], 3: [-3, 2], 4: [-13, 0] });
    expect(slots.find((s) => s.id === 4)?.face).toBe(FACING_NONE);
  });
  it('the same order from all four approaches gives the same offsets, rotated', () => {
    const units = mix(ARMOUR, ARMOUR, INFANTRY, INFANTRY, INFANTRY);
    const want = { 1: [0, 0], 2: [0, 2], 3: [-2, 0], 4: [-2, 1], 5: [-2, -1] };
    const approaches: { from: [number, number]; frame: Frame }[] = [
      { from: [24, 40], frame: SOUTH },
      { from: [24, 8], frame: { fx: 0, fy: 1, lx: -1, ly: 0 } },
      { from: [8, 24], frame: { fx: 1, fy: 0, lx: 0, ly: 1 } },
      { from: [40, 24], frame: { fx: -1, fy: 0, lx: 0, ly: -1 } },
    ];
    for (const a of approaches) {
      const { slots } = assignTemplate(input(units, { fromX: a.from[0], fromY: a.from[1] }), tpl);
      expect(lit(framed(slots, a.frame)), `from ${a.from}`).toEqual(want);
    }
  });
  it('is the same whatever order the ids come in', () => {
    const units = mix(ARMOUR, ARMOUR, INFANTRY, INFANTRY, INFANTRY, MEDIC);
    const a = assignTemplate(input(units), tpl).slots;
    const b = assignTemplate(input([...units].reverse()), tpl).slots;
    expect(b).toEqual(a);
  });
  it('a class-none unit gets no slot and takes no tile', () => {
    const base = mix(ARMOUR, INFANTRY);
    const withNone = [...base, { id: 99, domain: FOOT, cls: NONE, vehicle: false, air: false }];
    const a = assignTemplate(input(base), tpl).slots;
    const b = assignTemplate(input(withNone), tpl).slots;
    expect(b).toEqual(a);
    expect(b.some((s) => s.id === 99)).toBe(false);
  });
  it('a reserved tile is never given out', () => {
    const reserved = new Uint8Array(W * H);
    reserved[24 * W + 24] = 1;
    const { slots } = assignTemplate(input(mix(ARMOUR, INFANTRY), { reserved }), tpl);
    expect(slots.some((s) => s.x === 24 && s.y === 24)).toBe(false);
    expect(slots).toHaveLength(2);
  });
});

describe('Ambush on open ground', () => {
  const tpl = compiled('ambush');
  it('6 ring members: radius 3, the two armour on opposite halves, spread by bit reversal', () => {
    // ring order: armour, armour, support, infantry x3 (the file's class order, then id)
    const units = mix(ARMOUR, ARMOUR, SUPPORT, INFANTRY, INFANTRY, INFANTRY, MEDIC, MEDIC);
    const { slots, ringRadius } = assignTemplate(input(units), tpl);
    expect(ringRadius).toBe(3);
    // 16 tiles, 6 members: positions floor(k * 16 / 6) = 0 2 5 8 10 13, taken in the order k = 0 4 2 1 5 3,
    // i.e. ring indices 0 10 5 2 13 8 -> (3,0) (-2,-2) (-1,3) (2,2) (1,-3) (-3,0)
    // medics: the ring's rear is -3, gap 2 -> front row -6, rank spacing 2: (-6,0) (-6,2)
    expect(lit(framed(slots))).toEqual({ 1: [3, 0], 2: [-2, -2], 3: [-1, 3], 4: [2, 2], 5: [1, -3], 6: [-3, 0], 7: [-6, 0], 8: [-6, 2] });
  });
  it('faces inward at the click, an eighth-turn per slot', () => {
    const { slots } = assignTemplate(input(mix(ARMOUR, ARMOUR, SUPPORT, INFANTRY, INFANTRY, INFANTRY, MEDIC)), tpl);
    const face = (id: number): number | undefined => slots.find((s) => s.id === id)?.face;
    expect(face(1)).toBe(16384); // slot (3,0) = tile (24,21): the click is straight south
    expect(face(6)).toBe(49152); // slot (-3,0) = tile (24,27): straight north
    expect(face(4)).toBe(24576); // slot (2,2) = tile (26,22): south-west
    expect(face(7)).toBe(49152); // the medic at (-6,0), tile (24,30)
  });
  it('a ring of hulls snapped off the click closes on ITS OWN centre, not on the foot click (N7)', () => {
    const foot = openMask();
    const veh = openMask();
    veh[24 * W + 24] = 1;
    veh[23 * W + 24] = 1; // boulders: vehicles snap to (24, 22)
    const { slots } = assignTemplate(input(mix(ARMOUR, ARMOUR, ARMOUR, ARMOUR), { masks: [foot, veh], origins: [[24, 24], [24, 22]] }), tpl);
    // four hulls take ring positions 0, 8, 4, 12: frame (3,0), (-3,0), (0,3), (0,-3) about (24, 22)
    expect(slots.map((s) => [s.id, s.x, s.y])).toEqual([[1, 24, 19], [2, 24, 25], [3, 27, 22], [4, 21, 22]]);
    // id 3 at (27,22) looks west at the ring's centre (24,22); toward the foot click (24,24) it would be south-west
    expect(slots.map((s) => s.face)).toEqual([16384, 49152, 32768, 0]);
  });
  it('the radius is the smallest that seats the ring: 2 -> 3, 16 -> 3, 17 -> 4, 32 -> 6, 33 -> 6 with one over', () => {
    const radius = (n: number): number => assignTemplate(input(mix(...Array<number>(n).fill(INFANTRY))), tpl).ringRadius;
    expect([2, 16, 17, 32, 33].map(radius)).toEqual([3, 3, 4, 6, 6]);
    const r6 = ringTiles(6);
    const { slots } = assignTemplate(input(mix(...Array<number>(33).fill(INFANTRY))), tpl);
    const onRing = new Set(r6.map(([f, l]) => `${24 + l},${24 - f}`));
    expect(slots.filter((s) => onRing.has(`${s.x},${s.y}`))).toHaveLength(32);
    expect(slots).toHaveLength(33);
    expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(33);
  });
  // Two ring members: positions floor(k * 16 / 2) = 0 and 8, i.e. frame (3,0) and (-3,0).
  const two = mix(INFANTRY, INFANTRY);
  it('takes the better cover one step inward or outward', () => {
    const cover = new Uint8Array(W * H);
    cover[22 * W + 24] = 3; // frame (2,0): one step inward of (3,0)
    cover[28 * W + 24] = 2; // frame (-4,0): one step outward of (-3,0)
    expect(lit(framed(assignTemplate(input(two, { cover }), tpl).slots))).toEqual({ 1: [2, 0], 2: [-4, 0] });
  });
  it('keeps the ring tile on a tie, however good the neighbour is', () => {
    const cover = new Uint8Array(W * H);
    cover[21 * W + 24] = 1; // the ring tile (3,0)
    cover[22 * W + 24] = 1; // its inward neighbour: equal
    expect(lit(framed(assignTemplate(input(two, { cover }), tpl).slots))).toEqual({ 1: [3, 0], 2: [-3, 0] });
  });
  it('an unusable ring tile falls to inward or outward, the lower tile index on a tie', () => {
    const foot = openMask();
    foot[21 * W + 24] = 1; // the ring tile (3,0) is a wall
    // inward (2,0) = tile (24,22), outward (4,0) = tile (24,20): equal cover, the lower index (24,20) wins
    expect(lit(framed(assignTemplate(input(two, { masks: [foot, foot] }), tpl).slots))).toEqual({ 1: [4, 0], 2: [-3, 0] });
  });
  it('a position with no usable candidate takes the next free ring tile in ring order', () => {
    const foot = openMask();
    for (const [f, l] of [[3, 0], [2, 0], [4, 0]]) foot[(24 - f) * W + (24 + l)] = 1;
    // position 0's three candidates are walls: it takes ring index 1, (3,1)
    expect(lit(framed(assignTemplate(input(two, { masks: [foot, foot] }), tpl).slots))).toEqual({ 1: [3, 1], 2: [-3, 0] });
  });
});

// ---------------------------------------------------------------------------------------------
describe('templateOffsets().ringRadius (M3: the schematic draws the order\'s ring)', () => {
  const rings = (n: number): number[] => Array<number>(n).fill(INFANTRY);
  it('Ambush: 6 ring members -> 3, 17 -> 4', () => {
    expect(templateOffsets(compiled('ambush'), rings(6)).ringRadius).toBe(3);
    expect(templateOffsets(compiled('ambush'), rings(17)).ringRadius).toBe(4);
  });
  it('agrees with assignTemplate, and a Column has none', () => {
    const tpl = compiled('ambush');
    for (const n of [2, 16, 17, 32]) expect(templateOffsets(tpl, rings(n)).ringRadius, `n ${n}`).toBe(assignTemplate(input(mix(...rings(n))), tpl).ringRadius);
    expect(templateOffsets(compiled('column'), [ARMOUR, INFANTRY, INFANTRY, MEDIC]).ringRadius).toBe(0);
  });
});

describe('templateOffsets: the HUD schematic cannot disagree with the order', () => {
  const MIXES: Record<string, number[]> = {
    heavy: [ARMOUR, ARMOUR, INFANTRY, INFANTRY, INFANTRY, INFANTRY, MEDIC],
    company: [RECON, LIGHT, LIGHT, INFANTRY, INFANTRY, INFANTRY, INFANTRY, INFANTRY, SUPPORT, SUPPORT, AIRCRAFT],
    light: [INFANTRY, INFANTRY, INFANTRY, INFANTRY, INFANTRY, INFANTRY, INFANTRY, SUPPORT, MEDIC, AIRCRAFT, AIRCRAFT],
  };
  for (const id of ['column', 'attack', 'ambush']) {
    for (const [name, classes] of Object.entries(MIXES)) {
      it(`${id} / ${name}: the schematic's offsets are assignTemplate's, in the frame`, () => {
        const tpl = compiled(id);
        const real = framed(assignTemplate(input(mix(...classes)), tpl).slots);
        const wantRows = [...real.entries()].map(([uid, [f, l]]) => [classes[uid - 1], f, l]);
        const gotRows = templateOffsets(tpl, classes).map((o) => [o.cls, o.forward, o.lateral]);
        const order = (a: number[], b: number[]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
        expect(gotRows.sort(order)).toEqual(wantRows.sort(order));
        expect(gotRows).toHaveLength(classes.length);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
describe('compileFormation', () => {
  it('pins the sim tick rate its seconds become ticks at', () => {
    expect(TICKS_PER_SECOND).toBe(20);
  });
  it('compiles the three shipped files', () => {
    const column = compiled('column');
    expect(column.id).toBe('column');
    expect([column.verb, column.minMembers, column.face, column.arriveStance, column.drill]).toEqual([0, 2, 2, 0, 1]);
    // march.dress_s 3 and contact.quiet_s 10 become ticks (x20); P1b reads them
    expect([column.legTiles, column.dressTicks, column.pace, column.callRadius, column.quietTicks]).toEqual([8, 60, 1, 12, 200]);
    expect(column.legs).toBe(true);
    expect(column.elementOfClass).toEqual([1, 2, 0, 3, 4, 5, 6]);
    const attack = compiled('attack');
    expect([attack.verb, attack.face, attack.arriveStance, attack.drill]).toEqual([1, 1, 0, 2]);
    expect(attack.elementOfClass).toEqual([0, 1, 1, 2, 3, 4, 5]);
    const ambush = compiled('ambush');
    expect([ambush.verb, ambush.face, ambush.arriveStance, ambush.drill]).toEqual([0, 4, 16, 3]);
    expect(ambush.elementOfClass).toEqual([0, 0, 0, 0, 0, 1, 2]);
    // all three walk to the cap: 24 covers the whole 48 x 48 map at worst
    expect([column.extent, attack.extent, ambush.extent]).toEqual([24, 24, 24]);
    expect(FORMATION_WALK_CAP).toBe(24);
  });
  it('a small formation is not capped: its extent is the bound it computes', () => {
    const tiny: FormationJson = {
      id: 'tiny', label: 'formation.tiny.name', blurb: 'formation.tiny.blurb', factions: ['kdf'], verb: 'move', min_members: 2,
      elements: [{ classes: ['rest'], shape: { kind: 'point', ahead: 2 } }],
      arrival: { face: 'none', stance: 'none' }, contact: { drill: 'none' },
    };
    const c = compileFormation(tiny);
    expect(c.extent).toBe(6); // standoff 0 + 2 rows of slack + point lateral 4
    expect([c.legTiles, c.dressTicks, c.pace, c.callRadius, c.quietTicks]).toEqual([0, 0, 0, 12, 200]);
    // "rest" takes every class
    expect(c.elementOfClass).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
  it('march.legs false compiles to legTiles 0, and a file with no march has no legs', () => {
    // G-6, P1b: the shipped Ambush now ships `legs: false` (Ruling 3), so this reads the Column, which has checkpoints.
    const j = JSON.parse(JSON.stringify(loadFormation('column'))) as FormationJson;
    expect(compileFormation(j).legs).toBe(true);
    expect(compileFormation(j).legTiles).toBe(8);
    (j.march as { legs: boolean }).legs = false;
    const c = compileFormation(j);
    expect([c.legs, c.legTiles, c.dressTicks, c.pace]).toEqual([false, 0, 60, 1]);
    delete (j as { march?: unknown }).march;
    expect([compileFormation(j).legs, compileFormation(j).legTiles]).toEqual([false, 0]);
  });
  it('the shipped Ambush marches without checkpoints (Ruling 3), with its pace and dress kept', () => {
    const c = compileFormation(loadFormation('ambush'));
    expect([c.legs, c.legTiles, c.dressTicks, c.pace]).toEqual([false, 0, 60, 1]);
    // and the other two shipped files keep theirs
    expect([compileFormation(loadFormation('column')).legTiles, compileFormation(loadFormation('attack')).legTiles]).toEqual([8, 8]);
  });
  const mutate = (f: (j: FormationJson) => void): FormationJson => {
    const j = JSON.parse(JSON.stringify(loadFormation('column'))) as FormationJson;
    f(j);
    return j;
  };
  it('throws naming the id on anything the schema would refuse', () => {
    expect(() => compileFormation(mutate((j) => (j.arrival.face = 'sideways')))).toThrow('formation column: arrival.face sideways');
    expect(() => compileFormation(mutate((j) => (j.contact.drill = 'bash')))).toThrow('formation column: contact.drill bash');
    expect(() => compileFormation(mutate((j) => (j.elements[1].shape.kind = 'wedge')))).toThrow('formation column: elements[1].shape.kind wedge');
    expect(() => compileFormation(mutate((j) => ((j.elements[0] as unknown as { classes: string[] }).classes = ['tank'])))).toThrow('formation column: elements[0].classes tank');
    expect(() => compileFormation(mutate((j) => (j.verb = 'charge')))).toThrow('formation column: verb charge');
    expect(() => compileFormation(mutate((j) => (j.min_members = 1)))).toThrow('formation column: min_members 1');
    expect(() => compileFormation(mutate((j) => (j.elements[1].shape.files = 4)))).toThrow('formation column: elements[1].shape.files 4');
    expect(() => compileFormation(mutate((j) => ((j.elements[2] as unknown as { classes: string[] }).classes = ['rest'])))).toThrow('rest not last');
  });
});
