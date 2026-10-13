import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

// Target choice against armour (lead exception 2026-10-13). A weapon "hurts"
// an armoured target only when its real P(penetration) against the face that
// target shows the shooter -- the curve resolveHit rolls -- is meaningfully
// above zero (PEN_HURTS_MIN), and anti-armour weapons spend their shots on a
// hurtable armed vehicle before a soft or unarmed target at similar range.
// selectTarget and projectHit read the same function, so both are asserted.
//
// The stats are the shipped roster's own numbers, inlined: the sim imports
// nothing, its tests included.

const rifle = { id: 'rifle', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 };

const INF: UnitTypeJson = {
  id: 't_inf',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [rifle],
};

/** at_team's spike_atgm: pen 900. */
const AT_TEAM: UnitTypeJson = {
  id: 't_at',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.7 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.5 },
  weapons: [{ id: 'spike', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78, penetration: 900, damage: 400, suppression: 10, rof_per_min: 3 }],
};

/** mbt_lavi's plate: 700 / 300 / 150. Armed, so an anti-armour weapon wants it. */
const LAVI: UnitTypeJson = {
  id: 't_lavi',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1.0, sight_tiles: 12, signature: 1.0 },
  weapons: [{ id: 'gun', type: 'apfsds', range_tiles: 12, effective_range_tiles: 9.6, accuracy: 0.85, penetration: 1300, damage: 520, rof_per_min: 9 }],
};

/** ifv_namer's cannon_30: pen 120, an autocannon (not an anti-armour class). */
const NAMER: UnitTypeJson = {
  id: 't_namer',
  hull: { hp: 2600, armor: { front: 420, side: 220, rear: 120 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1.0, sight_tiles: 10, signature: 1.0 },
  weapons: [{ id: 'cannon_30', type: 'autocannon', range_tiles: 9, effective_range_tiles: 7, accuracy: 0.6, penetration: 120, damage: 60, suppression: 30, rof_per_min: 200 }],
};

/** apc_eitan's plate: 220 / 140 / 90. A 30 mm reads 0 front, 0.08 side. */
const EITAN: UnitTypeJson = {
  id: 't_eitan',
  hull: { hp: 2200, armor: { front: 220, side: 140, rear: 90 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1.0, sight_tiles: 10, signature: 1.0 },
  weapons: [{ id: 'rws', type: 'hmg', range_tiles: 8, accuracy: 0.5, penetration: 25, damage: 20, rof_per_min: 400 }],
};

/** jeep_shoded: front 14, so soft. */
const JEEP: UnitTypeJson = {
  id: 't_jeep',
  hull: { hp: 500, armor: { front: 14, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.9 },
  weapons: [{ id: 'mg', type: 'hmg', range_tiles: 8, accuracy: 0.5, penetration: 22, damage: 20, rof_per_min: 400 }],
};

/** dozer_d9: armoured and unarmed. */
const D9: UnitTypeJson = {
  id: 't_d9',
  hull: { hp: 3200, armor: { front: 240, side: 170, rear: 110 } },
  mobility: { speed_tiles_s: 0.6 },
  sensors: { optics: 1.0, sight_tiles: 6, signature: 1.0 },
  weapons: [],
};

/** Facings, in turns: the face a target at +x of the shooter shows it. */
const FACE = { front: 32768, side: 16384, rear: 0 } as const;
const SX = 3.5;
const SY = 8.5;

interface Placed {
  type: UnitTypeJson;
  /** Tiles from the shooter along +x (dy offsets it sideways). */
  dx: number;
  dy?: number;
  facing?: number;
}

/** Spawn the shooter and its candidates (in order, so ids follow the array),
 *  identify every candidate to the shooter's side, tick once and return the
 *  slot-0 target together with the ids. */
function choose(shooterType: UnitTypeJson, placed: Placed[]): { picked: number; ids: number[]; sim: Sim; shooter: number } {
  const sim = new Sim({ seed: 4242, width: 30, height: 20, capacity: 16 });
  const typeIdx = new Map<string, number>();
  const idx = (u: UnitTypeJson): number => {
    let i = typeIdx.get(u.id);
    if (i === undefined) {
      i = sim.addUnitType(u);
      typeIdx.set(u.id, i);
    }
    return i;
  };
  const ids = placed.map((p) =>
    sim.spawn(idx(p.type), 1, fx.from(SX + p.dx), fx.from(SY + (p.dy ?? 0)), p.facing ?? FACE.side),
  );
  const shooter = sim.spawn(idx(shooterType), 0, fx.from(SX), fx.from(SY), 0);
  for (const id of ids) sim.identifyTo(0, id);
  sim.tick();
  return { picked: sim.state.curTarget[shooter], ids, sim, shooter };
}

function hurts(sim: Sim, shooter: number, target: number): boolean {
  const p = sim.projectHit(shooter, target);
  if (p.kind !== 'shot') throw new Error(`no shot: ${p.kind}`);
  return p.hurts;
}

describe('anti-armour target choice', () => {
  it('a Spike team picks a Lavi over an equidistant infantry squad', () => {
    for (const facing of [FACE.front, FACE.side, FACE.rear]) {
      // The squad spawns first, so a plain nearest-first tie would take it.
      const { picked, ids } = choose(AT_TEAM, [
        { type: INF, dx: 0, dy: 5 },
        { type: LAVI, dx: 5, facing },
      ]);
      expect(picked).toBe(ids[1]);
    }
  });

  it('a Spike team picks a Lavi over a nearer unarmed D9', () => {
    const { picked, ids } = choose(AT_TEAM, [
      { type: D9, dx: 3 },
      { type: LAVI, dx: 0, dy: 5 },
    ]);
    expect(picked).toBe(ids[1]);
  });

  it('the preference is for similar range only: a squad at 2 tiles beats a Lavi at 7', () => {
    const { picked, ids } = choose(AT_TEAM, [
      { type: LAVI, dx: 7 },
      { type: INF, dx: 0, dy: 2 },
    ]);
    expect(picked).toBe(ids[1]);
  });
});

describe('a weapon hurts armour only if it can penetrate the face it sees', () => {
  it('a 30 mm never selects a Lavi from the front (or side, or rear) while it has anything it can hurt', () => {
    for (const facing of [FACE.front, FACE.side, FACE.rear]) {
      const { picked, ids, sim, shooter } = choose(NAMER, [
        { type: LAVI, dx: 3, facing },
        { type: INF, dx: 0, dy: 6 },
      ]);
      expect(picked).toBe(ids[1]);
      // The hover projection says the same, through the same function.
      expect(hurts(sim, shooter, ids[0])).toBe(false);
      expect(hurts(sim, shooter, ids[1])).toBe(true);
    }
  });

  it("a 30 mm hurts an Eitan's side (0.08) but not its front (0.00)", () => {
    const side = choose(NAMER, [
      { type: EITAN, dx: 3, facing: FACE.side },
      { type: INF, dx: 0, dy: 6 },
    ]);
    expect(side.picked).toBe(side.ids[0]);
    expect(hurts(side.sim, side.shooter, side.ids[0])).toBe(true);

    const front = choose(NAMER, [
      { type: EITAN, dx: 3, facing: FACE.front },
      { type: INF, dx: 0, dy: 6 },
    ]);
    expect(front.picked).toBe(front.ids[1]);
    expect(hurts(front.sim, front.shooter, front.ids[0])).toBe(false);
  });

  it('a weapon with nothing it can hurt still fires on armour as a last resort', () => {
    const { picked, ids, sim, shooter } = choose(NAMER, [{ type: LAVI, dx: 4, facing: FACE.front }]);
    expect(picked).toBe(ids[0]);
    expect(hurts(sim, shooter, ids[0])).toBe(false);
  });
});

describe('soft targets are unaffected', () => {
  it('a rifle still shoots infantry, past a nearer tank', () => {
    const { picked, ids, sim, shooter } = choose(INF, [
      { type: LAVI, dx: 2 },
      { type: INF, dx: 0, dy: 5 },
    ]);
    expect(picked).toBe(ids[1]);
    expect(hurts(sim, shooter, ids[1])).toBe(true);
  });

  it('a rifle takes the nearer of two soft targets', () => {
    const { picked, ids } = choose(INF, [
      { type: JEEP, dx: 6 },
      { type: INF, dx: 0, dy: 3 },
    ]);
    expect(picked).toBe(ids[1]);
  });

  it('an anti-armour weapon offered only soft targets still engages, nearest first', () => {
    const two = choose(AT_TEAM, [
      { type: JEEP, dx: 6 },
      { type: INF, dx: 0, dy: 3 },
    ]);
    expect(two.picked).toBe(two.ids[1]);
    const alone = choose(AT_TEAM, [{ type: JEEP, dx: 8 }]);
    expect(alone.picked).toBe(alone.ids[0]);
    expect(hurts(alone.sim, alone.shooter, alone.ids[0])).toBe(true);
  });
});
