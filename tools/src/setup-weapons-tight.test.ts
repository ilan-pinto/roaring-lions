// GH-976 (WP2, R0.5): the roster sweep for weapons tight. The check that fails the day a new weapon class arrives.
//
// Every shipped unit type of EVERY faction (kdf, sarim, ashwar, rif, and whatever ships next) that can hurt something (a weapon, or a demolish / kamikaze / tunnel-charge
// ability: beams, the swarm, mortars, rockets, ATGMs, snipers, demo and breach charge teams, the dozer), registered the way
// a room registers it (`sim.addUnitType` on the shipped JSON), stands at the edge of its own region in a set-up, in sight
// of the other side's edge across the band, attack-moving on it. Zero `fire`, `impact`, `beam` or structure-hit event, and
// every hp (unit and structure) unchanged, through tick 199 (the bell is 200). A garrisoned shooter case uses a house
// inside its own region. Two band widths: 4 (the edges 5 tiles apart) and 0 (adjacent regions, so even a flamer is in range).
//
// Each type has a CONTROL beside it: the same world with no set-up, where the same force must fight (a fire event, a hit or a
// structure hit), so no type passes because it was never able to. A type whose control stays silent is named in
// SILENT_CONTROL with the reason, and the test counts them, so a silent control cannot hide.
//
// Falsified (the commit message lists the runs): the `stepCombat` weapons-tight guard removed turns this red on the types
// that fire; the `stepKamikaze` and `stepDemolition` guards are run one at a time, and the result is recorded there.
import { describe, expect, it } from 'vitest';
import { units, type UnitId } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, type SimEvent, type UnitTypeJson } from '../../packages/sim/src/sim';

const W = 48;
const H = 48;
const UNTIL = 200;
const LAST_OWN = 19;

/** x <= 19 is side 0's, the next `band` columns are the band, the rest side 1's. Inline integer maths, no data helper (P1). */
function region(band: number): Int8Array {
  const r = new Int8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) r[y * W + x] = x <= LAST_OWN ? 0 : x <= LAST_OWN + band ? -1 : 1;
  return r;
}

const DUMMY_GROUND: UnitTypeJson = {
  id: 'wt_dummy_ground',
  role: 'infantry',
  hull: { hp: 9000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.5 },
  sensors: { optics: 1, sight_tiles: 4, signature: 1 },
  weapons: [],
};
const DUMMY_VEHICLE: UnitTypeJson = { ...DUMMY_GROUND, id: 'wt_dummy_vehicle', role: 'mbt' };
const DUMMY_AIR: UnitTypeJson = { ...DUMMY_GROUND, id: 'wt_dummy_air', role: 'drone', mobility: { speed_tiles_s: 1, domain: 'air' } };
const HOUSE = { id: 'wt_house', name: 'House', hp_per_tile: 600, garrison_slots: 4, rubble_cover: 1 };
const WALL = { id: 'wt_wall', name: 'Wall', hp_per_tile: 600, garrison_slots: 0, rubble_cover: 1 };

type Json = UnitTypeJson & { faction?: string };
const HURTS = new Set(['demolish', 'kamikaze', 'tunnel_charge']);
// No faction filter (WP3 review): the sweep exists to fail the day a new weapon class arrives, whichever faction brings it.
const ROSTER: Json[] = (Object.entries(units) as [UnitId, Json][])
  .map(([, u]) => u)
  .filter((u) => (u.weapons?.length ?? 0) > 0 || (u.abilities ?? []).some((a) => HURTS.has(a)));

/** Types whose control (no set-up) stays silent in this little world, and why. Everything else must fight in its control. */
const SILENT_CONTROL: Readonly<Record<string, string>> = {};

const FIGHT = new Set(['fire', 'impact', 'beam', 'structureHit', 'structureDestroyed', 'destroyed', 'component', 'chargeDetonated', 'strike']);

interface Outcome {
  readonly fought: SimEvent[];
  readonly hpMoved: string[];
}

function play(u: Json, band: number, setup: boolean, ticks: number): Outcome {
  const sim = new Sim({ seed: 976, width: W, height: H, capacity: 64, humanHeld: [true, true] });
  if (setup) sim.beginSetup({ untilTick: UNTIL, region: region(band) });
  const tU = sim.addUnitType(u);
  const gnd = sim.addUnitType(DUMMY_GROUND);
  const veh = sim.addUnitType(DUMMY_VEHICLE);
  const air = sim.addUnitType(DUMMY_AIR);
  const house = sim.addStructureType(HOUSE);
  const wall = sim.addStructureType(WALL);
  const own = LAST_OWN;
  const far = LAST_OWN + band + 1;
  // Two houses, one deep in each region, for the garrisoned shooters; two walls at the edges for the demolishers.
  const houseA = sim.addStructure(house, [24 * W + 14]);
  const houseB = sim.addStructure(house, [24 * W + far + 5]);
  sim.addStructure(wall, [28 * W + own]);
  sim.addStructure(wall, [28 * W + far]);
  const ids: number[] = [];
  const put = (type: number, side: number, x: number, y: number): number => {
    const id = sim.spawn(type, side, fx.from(x + 0.5), fx.from(y + 0.5));
    ids.push(id);
    return id;
  };
  const squadA: number[] = [];
  const squadB: number[] = [];
  for (let k = 0; k < 2; k++) {
    squadA.push(put(tU, 0, own, 22 + k));
    squadB.push(put(tU, 1, far, 22 + k));
  }
  const garrA = put(tU, 0, 15, 24);
  const garrB = put(tU, 1, far + 4, 24);
  for (const [t, dx] of [[gnd, 0], [veh, 0], [air, 0]] as const) {
    put(t, 0, own - dx - 1, 26);
    put(t, 1, far + dx + 1, 26);
  }
  put(veh, 0, own, 24);
  put(veh, 1, far, 24);
  const hp0 = ids.map((i) => sim.state.hp[i]);
  const shp0 = [sim.structures.hp[0], sim.structures.hp[1], sim.structures.hp[2], sim.structures.hp[3]];
  const goA = { x: fx.from(far + 0.5), y: fx.from(23.5) };
  const goB = { x: fx.from(own + 0.5), y: fx.from(23.5) };
  sim.queueCommand({ kind: 'attackMove', ids: squadA, x: goA.x, y: goA.y });
  sim.queueCommand({ kind: 'attackMove', ids: squadB, x: goB.x, y: goB.y });
  if ((u.abilities ?? []).includes('garrison')) {
    sim.queueCommand({ kind: 'garrison', ids: [garrA], structure: houseA });
    sim.queueCommand({ kind: 'garrison', ids: [garrB], structure: houseB });
  }
  const fought: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) for (const e of sim.tick()) if (FIGHT.has(e.kind)) fought.push(e);
  const hpMoved: string[] = [];
  ids.forEach((id, k) => {
    if (sim.state.hp[id] !== hp0[k] || sim.state.alive[id] === 0) hpMoved.push(`unit ${id}`);
  });
  shp0.forEach((h, s) => {
    if (sim.structures.hp[s] !== h || sim.structures.alive[s] === 0) hpMoved.push(`structure ${s}`);
  });
  return { fought, hpMoved };
}

describe('weapons tight: the shipped roster (GH-976, R0.5)', () => {
  it('reads a roster of both factions with beams, a swarm, indirect fire and charge teams in it', () => {
    const ids = ROSTER.map((u) => u.id);
    expect(ROSTER.length).toBeGreaterThanOrEqual(25);
    for (const must of ['mortar_team', 'rocket_battery', 'atgm_cell', 'sniper_team', 'demo_squad', 'breach_team', 'drone_swarm', 'aa_remetz', 'dozer_d9', 'loiter_drone', 'mbt_lavi']) {
      expect(ids, must).toContain(must);
    }
    // Every faction the data ships that has anything armed is in the sweep: the set is read from the data, not written here.
    const armedFactions = new Set(ROSTER.map((u) => u.faction));
    const allFactions = new Set((Object.values(units) as Json[]).map((u) => u.faction));
    for (const f of ['kdf', 'sarim', 'ashwar', 'rif']) expect(armedFactions.has(f), `faction ${f} in the sweep`).toBe(true);
    for (const f of allFactions) {
      const armedOfF = (Object.values(units) as Json[]).filter((u) => u.faction === f && ((u.weapons?.length ?? 0) > 0 || (u.abilities ?? []).some((a) => HURTS.has(a))));
      if (armedOfF.length > 0) expect(armedFactions.has(f), `faction ${f} has armed types the sweep skipped`).toBe(true);
    }
  });

  for (const band of [4, 0]) {
    for (const u of ROSTER) {
      it(`${u.id} (band ${band}): nothing fires and nothing is hurt before the bell`, () => {
        const out = play(u, band, true, UNTIL);
        expect(out.fought.map((e) => `${e.kind}@${e.tick}`)).toEqual([]);
        expect(out.hpMoved).toEqual([]);
      });
    }
  }

  it('control: with no set-up the same worlds fight (a type that stays silent is named, with its reason)', () => {
    const silent: string[] = [];
    for (const u of ROSTER) {
      const fought = play(u, 0, false, UNTIL).fought.length > 0 || play(u, 4, false, UNTIL).fought.length > 0;
      if (!fought) silent.push(u.id);
    }
    expect(silent.sort()).toEqual(Object.keys(SILENT_CONTROL).sort());
  });
});

// ---- the garrisoned shooter, on its own (WP3 review) ---------------------------------------------------------------------
// The sub-case inside `play` could pass vacuously: if the unit never reached the house it was an ordinary rifleman and the
// check said nothing about a window. Here the garrison is the point: a unit ordered into a house in its own region is asserted
// INSIDE it (`garrisonedIn`), and the same world with no set-up must show that very unit firing, so a pass is not a unit that
// could not shoot from a window. The enemy is an unarmed dummy 6 tiles off, in its own region.

/** Garrisoners whose control does not fire from the window in this little world, and why. Everything else must. */
const SILENT_GARRISON_CONTROL: Readonly<Record<string, string>> = {
  mortar_team: 'its only weapon is a mortar: `fires_from_building` is false, so a window never fires it',
  at_nlos_team: 'its only weapon is an indirect missile: `fires_from_building` is false, so a window never fires it',
};

function playGarrison(u: Json, band: number, setup: boolean, ticks: number): { inside: boolean; shots: number; hurt: boolean } {
  const sim = new Sim({ seed: 976, width: W, height: H, capacity: 16, humanHeld: [true, true] });
  if (setup) sim.beginSetup({ untilTick: UNTIL, region: region(band) });
  const tU = sim.addUnitType(u);
  const gnd = sim.addUnitType(DUMMY_GROUND);
  const house = sim.addStructureType(HOUSE);
  const hs = sim.addStructure(house, [24 * W + 18]);
  const shooter = sim.spawn(tU, 0, fx.from(16.5), fx.from(24.5));
  const dummy = sim.spawn(gnd, 1, fx.from(24.5), fx.from(24.5));
  const dummyHp = sim.state.hp[dummy];
  sim.queueCommand({ kind: 'garrison', ids: [shooter], structure: hs });
  let shots = 0;
  for (let t = 0; t < ticks; t++) for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === shooter) shots++;
  return { inside: sim.state.garrisonedIn[shooter] === hs, shots, hurt: sim.state.hp[dummy] !== dummyHp || sim.state.alive[dummy] === 0 };
}

describe('weapons tight: a garrisoned shooter fires from nowhere before the bell (GH-976, WP3 review)', () => {
  const GARRISONERS = ROSTER.filter((u) => (u.abilities ?? []).includes('garrison') && (u.weapons?.length ?? 0) > 0);

  it('the roster has garrisoners with weapons in it', () => {
    expect(GARRISONERS.length).toBeGreaterThanOrEqual(8);
  });

  it('an exemption from the control is true: every weapon of a silent-control type has fires_from_building false in the data', () => {
    for (const id of Object.keys(SILENT_GARRISON_CONTROL)) {
      const u = GARRISONERS.find((g) => g.id === id);
      expect(u, `${id} is a garrisoner with weapons`).toBeDefined();
      const weapons = (u?.weapons ?? []) as { fires_from_building?: boolean }[];
      expect(weapons.length).toBeGreaterThan(0);
      for (const w of weapons) expect(w.fires_from_building, id).toBe(false);
    }
  });

  for (const band of [4, 0]) {
    for (const u of GARRISONERS) {
      it(`${u.id} (band ${band}): inside the house before the bell, and silent; the control shoots from the same window`, () => {
        const tight = playGarrison(u, band, true, UNTIL - 1);
        expect(tight.inside, 'entered the house during the set-up').toBe(true);
        expect(tight.shots, 'shots during the set-up').toBe(0);
        expect(tight.hurt, 'the dummy was hurt').toBe(false);
        const control = playGarrison(u, band, false, UNTIL - 1);
        expect(control.inside, 'the control also entered').toBe(true);
        if (SILENT_GARRISON_CONTROL[u.id] === undefined) expect(control.shots, 'the control fires from the window').toBeGreaterThan(0);
      });
    }
  }
});
