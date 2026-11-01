// GH-859 (lead, 1 Nov): a formation can LEAVE CLASSES OUT. A unit of an excluded class, ordered with the formation,
// takes the plain group order to the same click: it is not seated in the template, not counted toward `min_members`,
// not grouped, and does not march. The oracle is the lead's Q2-ALT written as two commands: the same formation order
// for the other units, then a SEPARATE plain order for the excluded ones. Every world is hand-built and every
// expectation is a literal or the two-command sequence (casebook: "the oracle imported its arguments").
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { compileFormation, fmExcludes, templateOffsets, FM_CLASS_AIRCRAFT, FM_CLASS_INFANTRY, FM_CLASS_NONE, type FormationJson } from './formation-template';
import { RIFLES, TANK } from './golden-worlds.test-helper';
import { Sim, type UnitTypeJson } from './sim';

/** A fixture shaped like the shipped Attack, with the aircraft left out and no aircraft element. Literals: the
 *  shipped file may be retuned without moving these tests. */
const LEAVES_AIR: FormationJson = {
  id: 'fx_attack',
  label: 'formation.attack.name',
  blurb: 'formation.attack.blurb',
  factions: ['kdf', 'sarim'],
  verb: 'attackMove',
  min_members: 2,
  elements: [
    { classes: ['armour'], shape: { kind: 'rank', spacing: 2, max_lateral: 6, rank_depth: 3 } },
    { classes: ['infantry'], shape: { kind: 'rank', spacing: 1, max_lateral: 3, rank_depth: 1 }, gap: 1 },
  ],
  exclude: ['aircraft'],
  march: { legs: true, leg_tiles: 8, pace: 'none', dress_s: 3 },
  arrival: { face: 'front', stance: 'none' },
  contact: { drill: 'press', call_radius_tiles: 12, quiet_s: 10 },
};
/** The same file with nothing left out and the aircraft in their own element behind the infantry. */
const HOLDS_AIR: FormationJson = {
  ...LEAVES_AIR,
  id: 'fx_hold',
  exclude: undefined,
  elements: [...LEAVES_AIR.elements, { classes: ['aircraft'], shape: { kind: 'rank', spacing: 2, max_lateral: 2, rank_depth: 2 }, gap: 1, standoff: 13 }],
};
/** Leaves the infantry out instead, so the test is not about aircraft alone. */
const LEAVES_INF: FormationJson = {
  ...LEAVES_AIR,
  id: 'fx_noinf',
  exclude: ['infantry'],
  elements: [LEAVES_AIR.elements[0], { classes: ['aircraft'], shape: { kind: 'rank', spacing: 2, max_lateral: 2, rank_depth: 2 }, gap: 1 }],
};

/** Leaves the armour out: the tanks are VEHICLES, so the march route's lead domain is the question. */
const LEAVES_ARM: FormationJson = {
  ...LEAVES_AIR,
  id: 'fx_noarm',
  exclude: ['armour'],
  elements: [LEAVES_AIR.elements[1], LEAVES_INF.elements[1]],
};

const MBT: UnitTypeJson = { ...TANK, id: 'fe_mbt', role: 'mbt', mobility: { speed_tiles_s: 1.1, turn_rate_deg_s: 60 } };
const AIR: UnitTypeJson = {
  id: 'fe_air',
  hull: { hp: 100, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { domain: 'air', speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  weapons: [],
};

interface W {
  sim: Sim;
  tanks: number[];
  squads: number[];
  air: number[];
}
const at = (n: number): number => fx.from(n + 0.5);
/** Two tanks and three squads in one stack at (24, 40); three aircraft stacked at (20, 42). Click (24, 24): forward is -y. */
function world(nAir = 3, formations: FormationJson[] = [LEAVES_AIR, HOLDS_AIR, LEAVES_INF, LEAVES_ARM]): W {
  const sim = new Sim({ seed: 0x859, width: 48, height: 48, capacity: 64 });
  const mbt = sim.addUnitType(MBT);
  const inf = sim.addUnitType(RIFLES);
  const air = sim.addUnitType(AIR);
  for (const f of formations) sim.addFormationType(f);
  return {
    sim,
    tanks: [0, 1].map(() => sim.spawn(mbt, 0, at(24), at(40), 0)),
    squads: [0, 1, 2].map(() => sim.spawn(inf, 0, at(24), at(40), 0)),
    air: Array.from({ length: nAir }, () => sim.spawn(air, 0, at(20), at(42), 0)),
  };
}
interface Priv {
  goalX: Int32Array;
  goalY: Int32Array;
  wpX: Int32Array;
  wpY: Int32Array;
  wpCount: Uint8Array;
  fmGroup: Int8Array;
  fmArrive: Uint8Array;
  restFacing: Uint16Array;
  attackMove: Uint8Array;
  moving: Uint8Array;
  fgMembers: Uint8Array;
  fmLive: boolean;
}
const priv = (sim: Sim): Priv => sim as unknown as Priv;
const goalTile = (sim: Sim, id: number): [number, number] => [priv(sim).goalX[id] >> 16, priv(sim).goalY[id] >> 16];
const finalTile = (sim: Sim, id: number): [number, number] => {
  const p = priv(sim);
  const n = p.wpCount[id];
  return n === 0 ? goalTile(sim, id) : [p.wpX[id * 8 + n - 1] >> 16, p.wpY[id * 8 + n - 1] >> 16];
};
const finals = (sim: Sim, ids: number[]): [number, number][] => ids.map((id) => finalTile(sim, id));
const attack = (sim: Sim, ids: number[], formation?: string): void => {
  sim.queueCommand({ kind: 'attackMove', ids, x: at(24), y: at(24), ...(formation === undefined ? {} : { formation }) } as never);
};

describe('the field compiles', () => {
  it('sets the bit of each excluded class and none for a file without the field', () => {
    expect(compileFormation(LEAVES_AIR).excludeMask).toBe(1 << FM_CLASS_AIRCRAFT);
    expect(compileFormation(LEAVES_INF).excludeMask).toBe(1 << FM_CLASS_INFANTRY);
    expect(compileFormation(HOLDS_AIR).excludeMask).toBe(0);
    const both = compileFormation({ ...LEAVES_AIR, exclude: ['aircraft', 'infantry'], elements: [LEAVES_AIR.elements[0]] });
    expect(both.excludeMask).toBe((1 << FM_CLASS_AIRCRAFT) | (1 << FM_CLASS_INFANTRY));
  });
  it('fmExcludes answers per class code and never wraps on class none', () => {
    const tpl = compileFormation(LEAVES_AIR);
    expect(fmExcludes(tpl, FM_CLASS_AIRCRAFT)).toBe(true);
    expect(fmExcludes(tpl, FM_CLASS_INFANTRY)).toBe(false);
    // The mask holds bits 0..6 only, so class none (255, a shift of 31 in JS) could never hit one; the range check is for the reader.
    expect(fmExcludes(tpl, FM_CLASS_NONE)).toBe(false);
    expect(fmExcludes(tpl, -1)).toBe(false);
    expect(fmExcludes(tpl, 7)).toBe(false);
  });
  it('refuses what the schema would, naming the formation and the field', () => {
    expect(() => compileFormation({ ...LEAVES_AIR, exclude: [] })).toThrow('formation fx_attack: exclude');
    expect(() => compileFormation({ ...LEAVES_AIR, exclude: ['rest'] })).toThrow('formation fx_attack: exclude rest');
    expect(() => compileFormation({ ...LEAVES_AIR, exclude: ['aircraft', 'aircraft'] })).toThrow('formation fx_attack: exclude aircraft twice');
    expect(() => compileFormation({ ...LEAVES_AIR, exclude: ['tank'] })).toThrow('formation fx_attack: exclude tank');
  });
  it('refuses a class that is also in an element: that element would be dead data', () => {
    expect(() => compileFormation({ ...LEAVES_AIR, elements: HOLDS_AIR.elements })).toThrow('formation fx_attack: elements[2].classes names an excluded class');
  });
});

describe('the template skips an excluded class', () => {
  it('templateOffsets seats nobody of it, and the others keep the slots they have without it', () => {
    const tpl = compileFormation(LEAVES_AIR);
    const infantry = FM_CLASS_INFANTRY;
    const withAir = templateOffsets(tpl, [0, 0, infantry, infantry, FM_CLASS_AIRCRAFT, FM_CLASS_AIRCRAFT]);
    const without = templateOffsets(tpl, [0, 0, infantry, infantry]);
    expect(withAir.map((s) => s.cls).includes(FM_CLASS_AIRCRAFT)).toBe(false);
    expect([...withAir]).toEqual([...without]);
    // And the same classes in a file that holds the aircraft DO seat them.
    expect(templateOffsets(compileFormation(HOLDS_AIR), [0, 0, infantry, infantry, FM_CLASS_AIRCRAFT, FM_CLASS_AIRCRAFT]).filter((s) => s.cls === FM_CLASS_AIRCRAFT)).toHaveLength(2);
  });
});

describe('an order with the formation: the excluded units fly the plain order, the rest keep their slots', () => {
  it('the ground units seat exactly as if the aircraft had not been named', () => {
    const a = world(3);
    attack(a.sim, [...a.tanks, ...a.squads, ...a.air], 'fx_attack');
    a.sim.tick();
    const b = world(0);
    attack(b.sim, [...b.tanks, ...b.squads], 'fx_attack');
    b.sim.tick();
    expect(finals(a.sim, [...a.tanks, ...a.squads])).toEqual(finals(b.sim, [...b.tanks, ...b.squads]));
    // Nine literal tiles guard the oracle from agreeing on nothing: the two tanks lead the click rank.
    expect(finals(b.sim, b.tanks)).toEqual([[24, 24], [26, 24]]);
  });

  it('the aircraft land where a SEPARATE plain order, issued after the formed one, puts them (Q2-ALT)', () => {
    const one = world(3);
    attack(one.sim, [...one.tanks, ...one.squads, ...one.air], 'fx_attack');
    one.sim.tick();
    const two = world(3);
    attack(two.sim, [...two.tanks, ...two.squads], 'fx_attack');
    attack(two.sim, two.air);
    two.sim.tick();
    expect(finals(one.sim, one.air)).toEqual(finals(two.sim, two.air));
    // Literals: the click rank is the tanks' (24 and 26), so the first aircraft takes 22 and the next rank is 3 back.
    expect(finals(one.sim, one.air)).toEqual([[22, 24], [24, 27], [26, 27]]);
    // The two-command sequence and the one command agree on the whole world.
    for (let t = 0; t < 40; t++) {
      one.sim.tick();
      two.sim.tick();
    }
    expect(one.sim.hash()).toBe(two.sim.hash());
  });

  it('no two units claim a tile, and an aircraft goes straight to its slot on the attack-move latch', () => {
    const w = world(3);
    attack(w.sim, [...w.tanks, ...w.squads, ...w.air], 'fx_attack');
    w.sim.tick();
    const tiles = finals(w.sim, [...w.tanks, ...w.squads, ...w.air]).map(([x, y]) => `${x},${y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
    const p = priv(w.sim);
    for (const id of w.air) {
      expect(p.wpCount[id]).toBe(0); // no checkpoint queued: the march is the formation's
      expect(p.moving[id]).toBe(1);
      expect(p.attackMove[id]).toBe(1);
    }
  });

  it('the aircraft join no group and take no rest facing or stance; the others march in the group', () => {
    const w = world(3);
    attack(w.sim, [...w.tanks, ...w.squads, ...w.air], 'fx_attack');
    w.sim.tick();
    const p = priv(w.sim);
    for (const id of w.air) {
      expect(p.fmGroup[id]).toBe(-1);
      expect(p.restFacing[id]).toBe(0xffff);
      expect(p.fmArrive[id]).toBe(0);
    }
    const g = p.fmGroup[w.tanks[0]];
    expect(g).toBeGreaterThanOrEqual(0);
    for (const id of [...w.tanks, ...w.squads]) expect(p.fmGroup[id]).toBe(g);
    expect(p.fgMembers[g]).toBe(5);
    // The 16-tile approach is cut into legs: the ground units queue checkpoints, the aircraft do not.
    expect(p.wpCount[w.tanks[0]]).toBeGreaterThan(0);
  });

  it('a formation that holds the aircraft is untouched by the field existing: the same order seats them in the template', () => {
    const w = world(3);
    attack(w.sim, [...w.tanks, ...w.squads, ...w.air], 'fx_hold');
    w.sim.tick();
    const p = priv(w.sim);
    for (const id of w.air) expect(p.fmGroup[id]).toBeGreaterThanOrEqual(0);
    expect(p.fgMembers[p.fmGroup[w.tanks[0]]]).toBe(8);
    // Held 13 tiles behind the click (standoff 13): the plain order would put the first aircraft ON the click.
    expect(finals(w.sim, w.air)[0][1]).toBe(24 + 13);
  });
});

describe('what is left out does not count', () => {
  it('one placeable member and three aircraft is a PLAIN order: byte-identical to naming no formation', () => {
    const named = world(3);
    attack(named.sim, [named.tanks[0], ...named.air], 'fx_attack'); // 1 placeable < min_members 2
    const plain = world(3);
    attack(plain.sim, [plain.tanks[0], ...plain.air]);
    for (let t = 0; t < 30; t++) {
      named.sim.tick();
      plain.sim.tick();
    }
    expect(priv(named.sim).fmLive).toBe(false);
    expect(named.sim.hash()).toBe(plain.sim.hash());
  });
  it('two placeable members and nothing left out is a formed order (the count is on the placeable side only)', () => {
    const w = world(3);
    attack(w.sim, [w.tanks[0], w.tanks[1], ...w.air], 'fx_attack');
    w.sim.tick();
    expect(priv(w.sim).fmLive).toBe(true);
    expect(priv(w.sim).fgMembers[priv(w.sim).fmGroup[w.tanks[0]]]).toBe(2);
  });
  it('the centroid that frames the excluded units\' own rows is theirs alone: it is where a separate plain order would frame them', () => {
    // Two aircraft in the far north-east corner. Their own approach to the click is from the east (west-facing
    // rows); the whole order's centroid is dominated by the ground units to the south and would face north.
    const mk = (): W => {
      const w = world(0);
      for (let k = 0; k < 2; k++) w.air.push(w.sim.spawn(w.sim.unitTypes.length - 1, 0, at(47), at(2 + k), 0));
      return w;
    };
    const one = mk();
    attack(one.sim, [...one.tanks, ...one.squads, ...one.air], 'fx_attack');
    one.sim.tick();
    const two = mk();
    attack(two.sim, [...two.tanks, ...two.squads], 'fx_attack');
    attack(two.sim, two.air);
    two.sim.tick();
    expect(finals(one.sim, one.air)).toEqual(finals(two.sim, two.air));
    // From the east, the plain frame faces west: the first aircraft takes the free click-column tile next to the tanks.
    expect(finals(one.sim, one.air)).toEqual([[24, 22], [27, 24]]);
  });
  it('the centroid that frames the rows is the placeable units\' own: an aircraft far to the east does not turn the frame', () => {
    // Tanks and squads stand south of the click; an aircraft starting hundreds of tiles' worth east would, in the
    // sum, swing the approach to east-west. It must not.
    const w = world(0);
    const far = w.sim.spawn(w.sim.unitTypes.length - 1, 0, at(47), at(2), 0);
    attack(w.sim, [...w.tanks, ...w.squads, far], 'fx_attack');
    w.sim.tick();
    expect(finals(w.sim, w.tanks)).toEqual([[24, 24], [26, 24]]);
  });
  it('an excluded tank does not make the march route a vehicle route (the lead domain is the placeable units\')', () => {
    // A boulder field on the click: foot-open, vehicle-shut, so the two routes (and their checkpoints) differ.
    const mk = (): W => {
      const w = world(0);
      for (const y of [22, 23, 24]) w.sim.setBoulder(24, y, true);
      return w;
    };
    const route = (w: W): [number, number][][] => w.squads.map((id) => {
      const p = priv(w.sim);
      const out: [number, number][] = [goalTile(w.sim, id)];
      for (let k = 0; k < p.wpCount[id]; k++) out.push([p.wpX[id * 8 + k] >> 16, p.wpY[id * 8 + k] >> 16]);
      return out;
    });
    const withTanks = mk();
    attack(withTanks.sim, [...withTanks.tanks, ...withTanks.squads], 'fx_noarm');
    withTanks.sim.tick();
    const alone = mk();
    attack(alone.sim, alone.squads, 'fx_noarm');
    alone.sim.tick();
    expect(route(withTanks)).toEqual(route(alone));
    expect(route(withTanks)[0].length).toBeGreaterThan(1);
  });
  it('leaving out the infantry works the same way for any class: they take the plain grid, the tanks the template', () => {
    const w = world(0);
    attack(w.sim, [...w.tanks, ...w.squads], 'fx_noinf');
    w.sim.tick();
    const p = priv(w.sim);
    expect(p.fmLive).toBe(true);
    expect(p.fgMembers[p.fmGroup[w.tanks[0]]]).toBe(2);
    for (const id of w.squads) expect(p.fmGroup[id]).toBe(-1);
    // The plain grid, with the tanks' click-rank tiles (24 and 26) reserved by the template that was seated first.
    expect(finals(w.sim, w.squads)).toEqual([[25, 24], [23, 24], [22, 24]]);
  });
});

/** Every placeable class stands off the click, so the click tile is free for a left-out unit. */
const STANDOFF: FormationJson = {
  ...LEAVES_AIR,
  id: 'fx_standoff',
  elements: [
    { classes: ['armour'], shape: { kind: 'rank', spacing: 2, max_lateral: 6, rank_depth: 3 }, standoff: 6 },
    { classes: ['infantry'], shape: { kind: 'rank', spacing: 1, max_lateral: 3, rank_depth: 1 }, gap: 1 },
  ],
};

describe('sim-guard round 1: survivors of 26 mutations', () => {
  it('APPEND: an appended formed order joins the excluded unit to no group', () => {
    const w = world(3);
    const all = [...w.tanks, ...w.squads, ...w.air];
    w.sim.queueCommand({ kind: 'move', ids: all, x: at(10), y: at(30) } as never);
    for (let t = 0; t < 5; t++) w.sim.tick();
    w.sim.queueCommand({ kind: 'attackMove', ids: all, x: at(24), y: at(24), append: true, formation: 'fx_attack' } as never);
    w.sim.tick();
    const p = priv(w.sim);
    for (const id of w.air) {
      expect(p.wpCount[id]).toBe(1); // the click, queued behind the leg it was on
      expect(p.fmGroup[id]).toBe(-1);
    }
    expect(p.fgMembers[p.fmGroup[w.tanks[0]]]).toBe(5);
  });

  it('MARCH + CLICK FRACTION: a left-out unit whose slot is the clicked tile keeps the exact point on a march', () => {
    const w = world(0, [STANDOFF]);
    const air = w.sim.spawn(w.sim.unitTypes.length - 1, 0, at(24), at(44), 0);
    w.sim.queueCommand({ kind: 'attackMove', ids: [...w.tanks, ...w.squads, air], x: fx.from(24.25), y: fx.from(24.25), formation: 'fx_standoff' } as never);
    w.sim.tick();
    const p = priv(w.sim);
    expect(p.wpCount[w.tanks[0]]).toBeGreaterThan(0); // it IS a march
    expect(finalTile(w.sim, air)).toEqual([24, 24]); // the plain grid's click tile (the template stands off)
    expect([p.goalX[air], p.goalY[air]]).toEqual([fx.from(24.25), fx.from(24.25)]);
  });

  it('DOMAIN ORIGINS: a left-out tank is seated on the VEHICLE origin when a boulder shuts the click to wheels', () => {
    const mk = (): W => {
      const w = world(0);
      for (const y of [22, 23, 24]) w.sim.setBoulder(24, y, true);
      return w;
    };
    const one = mk();
    attack(one.sim, [...one.tanks, ...one.squads], 'fx_noarm');
    one.sim.tick();
    const two = mk();
    attack(two.sim, two.squads, 'fx_noarm');
    attack(two.sim, two.tanks);
    two.sim.tick();
    expect(finals(one.sim, one.tanks)).toEqual(finals(two.sim, two.tanks));
    for (const [x, y] of finals(one.sim, one.tanks)) expect(x === 24 && y >= 22 && y <= 24).toBe(false);
  });

  it('BYSTANDER: an own-side unit outside the order holds its tile against the left-out units as well', () => {
    const mk = (): W => {
      const w = world(3);
      w.squads.push(w.sim.spawn(w.sim.unitTypes.length - 2, 0, at(22), at(24), 0)); // idle, outside the order, on the first air tile
      return w;
    };
    const w = mk();
    const bystander = w.squads[3];
    attack(w.sim, [...w.tanks, ...w.squads.slice(0, 3), ...w.air], 'fx_attack');
    w.sim.tick();
    expect(finals(w.sim, w.air).map(([x, y]) => `${x},${y}`)).not.toContain('22,24');
    expect(bystander).toBeGreaterThan(0);
  });
});
