import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { FlowField } from './flowfield';
import {
  GATE_CIVILIANS,
  GATE_RIFLES,
  GATE_TILES,
  GATE_W,
  GATE_X,
  gateTypeJson,
  gateWorld,
  runGateWorld,
  type GateWorld,
} from './gate-world.test-helper';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import { encodeSim, internals, restoreSim, SnapshotRefused } from './snapshot';
import { forkWitness, type ForkVerdict } from './snapshot-witness';
import { GATE_CLOSED, GATE_CLOSING, GATE_OPEN, GATE_OPENING, structureTypeFromJson } from './structures';

// GH-1438 E1: the compound gate (docs/campaign/civilian-drama.md section 2, section 10.2 E1). Every spec here
// is a literal world. Each names, in its comment, the one-line mutation of the implementation that turns it red.

const W = 24;
const H = 16;
/** A 2 x 1 gate at (10, 8)-(11, 8): centroid (11.0, 8.5). */
const TILES = [8 * W + 10, 8 * W + 11];
const CX = 11.0;
const CY = 8.5;

const DRONE: UnitTypeJson = {
  id: 'gate_drone',
  role: 'drone',
  hull: { hp: 120, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.2, domain: 'air' },
  sensors: { optics: 2, sight_tiles: 16, signature: 0.3 },
};

const WOUNDED: UnitTypeJson = {
  id: 'gate_wounded',
  role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};

interface Flat {
  sim: Sim;
  gate: number;
  rifles: number;
  civ: number;
  drone: number;
  wounded: number;
}

/** An open field with the 2 x 1 gate alone in it and every type registered. Nothing spawned. */
function flat(gateOver: Parameters<typeof gateTypeJson>[0] = {}): Flat {
  const sim = new Sim({ seed: 0x1438, width: W, height: H, capacity: 16 });
  const gate = sim.addStructure(sim.addStructureType(gateTypeJson(gateOver)), TILES);
  return {
    sim,
    gate,
    rifles: sim.addUnitType(GATE_RIFLES),
    civ: sim.addUnitType(GATE_CIVILIANS),
    drone: sim.addUnitType(DRONE),
    wounded: sim.addUnitType(WOUNDED),
  };
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

const stateOf = (sim: Sim, g: number): number => sim.structures.gate[g];
const blockedAll = (sim: Sim, tiles: readonly number[]): boolean => tiles.every((t) => sim.blocked[t] === 1);
const openAll = (sim: Sim, tiles: readonly number[]): boolean => tiles.every((t) => sim.blocked[t] === 0);
const gateEvents = (ev: SimEvent[]): string[] =>
  ev.filter((e) => e.kind === 'gateOpened' || e.kind === 'gateClosed').map((e) => `${e.kind}@${e.tick}`);

describe('the gate block compiles to integers, and refuses what the schema refuses', () => {
  it('radius 4, hold 3 s, swing 2 s: 4 x 4 x 65536, 60 ticks, 40 ticks', () => {
    const g = structureTypeFromJson(gateTypeJson(), TICKS_PER_SECOND).gate;
    expect(g).toEqual({ opensFor: 0, radiusSq: 1048576, radiusQ8: 1024, holdTicks: 60, swingTicks: 40 });
    // The defaults the schema documents.
    const d = structureTypeFromJson({ id: 'g', hp_per_tile: 1, gate: { open_radius_tiles: 8 } }, TICKS_PER_SECOND).gate;
    expect(d).toEqual({ opensFor: 0, radiusSq: 4194304, radiusQ8: 2048, holdTicks: 60, swingTicks: 40 });
    expect(structureTypeFromJson({ id: 'w', hp_per_tile: 1 }, TICKS_PER_SECOND).gate).toBeNull();
  });

  it('throws on per_tile, a fractional or out-of-range radius, and an opens_for other than 0', () => {
    const bad = (extra: object, gate: object): (() => unknown) => () =>
      structureTypeFromJson({ id: 'g', hp_per_tile: 1, ...extra, gate: { open_radius_tiles: 4, ...gate } }, TICKS_PER_SECOND);
    expect(bad({ per_tile: true }, {})).toThrow(/not per_tile/);
    expect(bad({}, { open_radius_tiles: 3.5 })).toThrow(/open_radius_tiles/);
    expect(bad({}, { open_radius_tiles: 9 })).toThrow(/open_radius_tiles/);
    expect(bad({}, { open_radius_tiles: 0 })).toThrow(/open_radius_tiles/);
    expect(bad({}, { hold_open_s: 31 })).toThrow(/hold_open_s/);
    expect(bad({}, { swing_s: 0 })).toThrow(/swing_s/);
    expect(bad({}, { opens_for: 1 })).toThrow(/opens_for/);
  });
});

describe('opening: who is near', () => {
  // Mutation: `<=` -> `<` (or `>`) in gateNear's radius compare. The squad at exactly 4.0 tiles no longer opens it.
  it('opens for a KDF squad exactly at the radius, swinging for swing_s, and not for one 1/256 tile further', () => {
    const at = flat();
    at.sim.spawn(at.rifles, 0, fx.from(CX), fx.from(CY + 4));
    expect(blockedAll(at.sim, TILES)).toBe(true);
    const first = at.sim.tick();
    expect(stateOf(at.sim, at.gate)).toBe(GATE_OPENING);
    expect(at.sim.structures.gateTimer[at.gate]).toBe(40);
    const ev = [...first, ...run(at.sim, 39)];
    // Ticks 1..39: still swinging, still shut.
    expect(stateOf(at.sim, at.gate)).toBe(GATE_OPENING);
    expect(blockedAll(at.sim, TILES)).toBe(true);
    ev.push(...at.sim.tick());
    expect(stateOf(at.sim, at.gate)).toBe(GATE_OPEN);
    expect(openAll(at.sim, TILES)).toBe(true);
    expect(gateEvents(ev)).toEqual(['gateOpened@40']);

    const out = flat();
    out.sim.spawn(out.rifles, 0, fx.from(CX), fx.from(CY + 4) + 256);
    // And on the other axis, diagonally just outside: (2.83, 2.83) is 4.0 tiles to two places; (2.84, 2.84) is not.
    out.sim.spawn(out.rifles, 0, fx.from(CX - 2.84), fx.from(CY - 2.84));
    expect(gateEvents(run(out.sim, 200))).toEqual([]);
    expect(stateOf(out.sim, out.gate)).toBe(GATE_CLOSED);
    expect(blockedAll(out.sim, TILES)).toBe(true);
  });

  // Mutation: delete the `side[i] !== side` test. A civilian or an enemy beside it opens it.
  it('opens for side 0 only: a civilian and an enemy at the gate do nothing', () => {
    const w = flat();
    w.sim.spawn(w.civ, 2, fx.from(CX), fx.from(CY + 1));
    w.sim.spawn(w.rifles, 1, fx.from(CX), fx.from(CY - 1));
    expect(gateEvents(run(w.sim, 200))).toEqual([]);
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSED);
  });

  // Mutation: delete the `isAir` skip. A drone parked over the gate opens it.
  it('an aircraft overhead opens nothing', () => {
    const w = flat();
    w.sim.spawn(w.drone, 0, fx.from(CX), fx.from(CY + 1));
    expect(gateEvents(run(w.sim, 200))).toEqual([]);
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSED);
  });

  // Mutation: delete the `horsDeCombat` (isDown) test. A KDF man down beside the gate opens it.
  it('a KDF man down beside the gate opens nothing', () => {
    const w = flat();
    w.sim.spawn(w.wounded, 0, fx.from(CX), fx.from(CY + 1));
    expect(w.sim.isDown(0)).toBe(true);
    expect(gateEvents(run(w.sim, 200))).toEqual([]);
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSED);
  });

  // Mutation: delete any one of the `tunnelIn` / `carriedBy` / `garrisonedIn` tests. The squad whose column is
  // set opens the gate. (The columns are set by hand: each is the sim's own word for "not on this ground".)
  for (const col of ['tunnelIn', 'carriedBy', 'garrisonedIn'] as const) {
    it(`a KDF squad with ${col} set (buried, carried, at a window) opens nothing`, () => {
      const w = flat();
      const id = w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
      (internals(w.sim)[col] as Int32Array)[id] = 0;
      expect(gateEvents(run(w.sim, 100))).toEqual([]);
      expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSED);
      // The same squad on the ground opens it: the test is the column, not the place.
      (internals(w.sim)[col] as Int32Array)[id] = -1;
      expect(gateEvents(run(w.sim, 41))).toEqual(['gateOpened@140']);
    });
  }
});

describe('closing: the hold, and nothing is ever shut in', () => {
  // Mutation: delete the `stGateHold` decrement (`else if (hold > 0) hold--`). The gate never shuts.
  it('shuts hold_open_s after the last soldier left, and takes swing_s to do it', () => {
    const w = flat();
    const id = w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
    const ev = run(w.sim, 41); // opened at tick 40
    w.sim.debugKill(id);
    // Tick 40 set the hold to 60; ticks 41..100 count it down, tick 100 starts the swing, tick 140 shuts it.
    ev.push(...run(w.sim, 60));
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSING);
    expect(openAll(w.sim, TILES)).toBe(true); // passable all the way through the swing
    ev.push(...run(w.sim, 40));
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSED);
    expect(blockedAll(w.sim, TILES)).toBe(true);
    expect(gateEvents(ev)).toEqual(['gateOpened@40', 'gateClosed@140']);
  });

  it('hold_open_s 0 starts the swing on the first tick nobody is near', () => {
    const w = flat({ hold_open_s: 0 });
    const id = w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
    run(w.sim, 41);
    w.sim.debugKill(id);
    expect(gateEvents(run(w.sim, 41))).toEqual(['gateClosed@81']);
  });

  // Mutation: delete `!this.gateOccupied(g)` in the OPEN branch. The gate goes CLOSING over the family's heads.
  it('never starts to shut on a civilian standing in it, nor on a downed man of any side', () => {
    for (const [what, spawnIn] of [
      ['a civilian', (w: Flat) => w.sim.spawn(w.civ, 2, fx.from(10.5), fx.from(8.5))],
      ['an enemy man down', (w: Flat) => w.sim.spawn(w.wounded, 1, fx.from(11.5), fx.from(8.5))],
    ] as const) {
      const w = flat();
      const kdf = w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
      const body = spawnIn(w);
      run(w.sim, 41);
      w.sim.debugKill(kdf);
      run(w.sim, 300);
      expect(stateOf(w.sim, w.gate), what).toBe(GATE_OPEN);
      expect(openAll(w.sim, TILES), what).toBe(true);
      // Once the tile is clear it shuts: hold already spent, one swing.
      w.sim.debugKill(body);
      expect(gateEvents(run(w.sim, 41)), what).toEqual([`gateClosed@${341 + 40}`]);
    }
  });

  // Mutation: delete `!this.gateOccupied(g)` in the CLOSING branch (decrement regardless). The gate shuts on him.
  it('a man who steps into a closing gate holds it, the timer standing still, until he is out', () => {
    const w = flat();
    const kdf = w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
    const civ = w.sim.spawn(w.civ, 2, fx.from(CX), fx.from(CY + 3));
    run(w.sim, 41);
    w.sim.debugKill(kdf);
    run(w.sim, 70); // tick 100 began the swing; ticks 101..110 ran 10 of its 40
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSING);
    expect(w.sim.structures.gateTimer[w.gate]).toBe(30);
    const st = internals(w.sim);
    (st.posX as Int32Array)[civ] = fx.from(10.5);
    (st.posY as Int32Array)[civ] = fx.from(8.5);
    run(w.sim, 200);
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSING);
    expect(w.sim.structures.gateTimer[w.gate]).toBe(30);
    expect(openAll(w.sim, TILES)).toBe(true);
    (st.posY as Int32Array)[civ] = fx.from(11.5);
    expect(gateEvents(run(w.sim, 30))).toEqual([`gateClosed@${311 + 29}`]);
  });

  // Mutation: delete the `wantOpen` reversal in the CLOSING branch. The squad coming back watches it shut.
  it('a soldier coming back during the swing sends it back to OPEN without ever blocking a tile', () => {
    const w = flat();
    const kdf = w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
    run(w.sim, 41);
    w.sim.debugKill(kdf);
    run(w.sim, 80); // mid-swing
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSING);
    w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY - 3));
    const ev = run(w.sim, 200);
    expect(stateOf(w.sim, w.gate)).toBe(GATE_OPEN);
    expect(gateEvents(ev)).toEqual([]);
    expect(openAll(w.sim, TILES)).toBe(true);
  });

  // Mutation: delete `if (this.stAlive[g] === 0) continue;` in stepGates. The wreck of the gate shuts again.
  it('a destroyed gate stays open for good, and stepGates leaves it alone', () => {
    const w = flat();
    const kdf = w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
    run(w.sim, 41);
    w.sim.debugDestroyStructure(w.gate);
    expect(openAll(w.sim, TILES)).toBe(true);
    w.sim.debugKill(kdf);
    const ev = run(w.sim, 300);
    expect(gateEvents(ev)).toEqual([]);
    expect(openAll(w.sim, TILES)).toBe(true);
    // And one destroyed while shut opens too, and a squad beside the rubble starts no swing.
    const s = flat();
    s.sim.debugDestroyStructure(s.gate);
    s.sim.spawn(s.rifles, 0, fx.from(CX), fx.from(CY + 2));
    expect(gateEvents(run(s.sim, 100))).toEqual([]);
    expect(openAll(s.sim, TILES)).toBe(true);
    expect(stateOf(s.sim, s.gate)).toBe(GATE_CLOSED);
  });
});

// Reach into the pool: the oracle is a FlowField computed from scratch (removestructure.test.ts's shape).
interface Pool {
  fields: FlowField[];
  fieldByGoal: Map<number, number>[];
  maskFor(d: number): Uint8Array;
  elevation: Uint8Array;
}

function freshDirs(sim: Sim, goal: number): number[] {
  const p = sim as unknown as Pool;
  const f = new FlowField(sim.width, sim.height);
  f.compute(p.maskFor(0), p.elevation, goal % sim.width, (goal - (goal % sim.width)) / sim.width);
  return Array.from(f.dirs);
}

describe('the flow fields across a swing', () => {
  // Mutation: delete `recomputeFields('opened')` (or 'closed') in flipGate. The cached field keeps describing the
  // gate as it was, and differs from a fresh compute right after the flip.
  it('every field a living unit follows equals a fresh compute after the gate opens and after it shuts', () => {
    let flips = 0;
    const v = gateWorld();
    for (let t = 0; t < 1400; t++) {
      v.drive(t);
      const ev = v.sim.tick();
      if (!ev.some((e) => e.kind === 'gateOpened' || e.kind === 'gateClosed')) continue;
      flips++;
      const p = v.sim as unknown as Pool;
      for (const [key, idx] of p.fieldByGoal[0]) {
        expect(Array.from(p.fields[idx].dirs), `field to ${key} at tick ${t}`).toEqual(freshDirs(v.sim, key));
      }
    }
    expect(flips).toBe(4);
  });

  // Mutation: delete `recomputeFields('opened')`: the third family stays pressed to the wall with the gate open.
  it('a family sent through the shut gate presses the wall, and walks through once it is open', () => {
    const w = gateWorld();
    const civ = w.civilians[2];
    const x = (): number => w.sim.state.posX[civ] >> 16;
    let opened = -1;
    let crossedAt = -1;
    for (let t = 0; t < 1400; t++) {
      w.drive(t);
      for (const e of w.sim.tick()) if (e.kind === 'gateOpened' && t > 800) opened = t;
      if (t >= 420 && t < 1000) expect(x(), `tick ${t}: through a shut gate`).toBeLessThan(GATE_X);
      if (crossedAt < 0 && x() > GATE_X) crossedAt = t;
    }
    // The squad comes back at 800 and opens it at 1067 (the swing from 1027); the family is through soon after.
    expect(opened).toBe(1067);
    expect(crossedAt).toBeGreaterThan(opened);
    expect(crossedAt).toBeLessThan(opened + 100);
    expect(x()).toBeGreaterThan(28);
    // The first two went through on the first opening and are where they were sent.
    for (const c of [w.civilians[0], w.civilians[1]]) expect(w.sim.state.posX[c] >> 16).toBeGreaterThan(34);
  });

  it('after it shuts, the field from the west to the east is unreachable: nobody is routed through it', () => {
    const w = gateWorld();
    runGateWorld(w, 600); // shut since 405
    expect(stateOf(w.sim, w.gate)).toBe(GATE_CLOSED);
    // A fresh compute toward the east: every west tile has no way (the wall runs the map's height).
    const dirs = freshDirs(w.sim, 9 * GATE_W + 30);
    for (let y = 0; y < 18; y++) for (let x = 0; x < GATE_X; x++) expect(dirs[y * GATE_W + x]).toBe(dirs[0]);
  });
});

describe('determinism', () => {
  // Mutation: fold the gate block unconditionally in hash() (drop `if (this.gateLive)`). The two worlds differ.
  // Mutation: set `gateLive` in addStructureType instead of addStructure. The two worlds differ.
  it('registering a gate type and raising none hashes exactly as a world without the type', () => {
    const build = (withType: boolean): Sim => {
      const sim = new Sim({ seed: 77, width: W, height: H, capacity: 8 });
      if (withType) sim.addStructureType(gateTypeJson());
      const r = sim.addUnitType(GATE_RIFLES);
      sim.spawn(r, 0, fx.from(3.5), fx.from(3.5));
      sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(20.5), y: fx.from(12.5) });
      return sim;
    };
    const a = build(false);
    const b = build(true);
    for (let t = 0; t < 200; t++) {
      a.tick();
      b.tick();
      expect(b.hash(), `tick ${t}`).toBe(a.hash());
    }
    expect(internals(b).gateLive).toBe(false);
  });

  // The fork witness at the cuts that matter: mid-opening, open, mid-closing, shut with a family pressing, and the
  // second opening. Mutation: drop the `stGateTimer` row from snapshot-schema.ts. The restored world swings from the
  // poison and the hashes part at the first hash tick.
  const fork = (T: number): ForkVerdict<GateWorld> =>
    forkWitness<GateWorld>({
      build: () => gateWorld(),
      drive: (world, t) => world.drive(t),
      T,
      horizon: 200,
      hashEvery: 5,
    });
  for (const [label, T] of [
    ['mid-opening', 180],
    ['open, the families in the gate', 300],
    ['mid-closing, the hold spent', 380],
    ['shut, a family pressing the wall', 900],
    ['mid-opening, the second time', 1040],
  ] as const) {
    it(`a snapshot cut ${label} (T = ${T}) restores to the uninterrupted run`, () => {
      const v = fork(T);
      expect(v.configDifference).toBeNull();
      expect(v.roundTripEqualAtT).toBe(true);
      expect(v.hashDivergedAt).toBeNull();
      expect(v.encodingEqualAtEnd, v.firstDifference ?? '').toBe(true);
    });
  }

  it('the cuts above land where their labels say', () => {
    const w = gateWorld();
    const at = new Map<number, number>();
    runGateWorld(w, 1041, (t) => at.set(t + 1, stateOf(w.sim, w.gate)));
    expect([180, 300, 380, 900, 1040].map((T) => at.get(T))).toEqual([GATE_OPENING, GATE_OPEN, GATE_CLOSING, GATE_CLOSED, GATE_OPENING]);
  });

  // Mutation: delete the gate-state range check in restoreSim. A forged state 7 is restored.
  it('a snapshot with a gate state outside 0..3 is refused', () => {
    const w = gateWorld();
    runGateWorld(w, 100);
    const sim = w.sim;
    (internals(sim).stGateState as Uint8Array)[w.gate] = 7;
    const bytes = encodeSim(sim, {});
    expect(() => restoreSim(gateWorld().sim, bytes)).toThrow(SnapshotRefused);
  });
});

describe('the readers of structureOfTile: an open gate is open ground', () => {
  type Los = { losRay(x0: number, y0: number, x1: number, y1: number): number };
  // A sight-blocking gate (low_profile false) across the ray, so the test is the gate's state and not the
  // low-profile rule. Mutation: in losRay, test `structureOfTile[t] >= 0` instead of `blocked[t] !== 0`, the old
  // "a structure tile is a blocked tile" assumption: the open gate blocks the sight line.
  it('an open gate does not block a sight line; a shut tall one does', () => {
    const sim = new Sim({ seed: 3, width: W, height: H, capacity: 8 });
    const g = sim.addStructure(sim.addStructureType(gateTypeJson({}, { low_profile: false })), TILES);
    const los = sim as unknown as Los;
    expect(los.losRay(10, 4, 10, 12)).toBe(-1);
    const r = sim.addUnitType(GATE_RIFLES);
    sim.spawn(r, 0, fx.from(CX), fx.from(CY + 2));
    run(sim, 41);
    expect(stateOf(sim, g)).toBe(GATE_OPEN);
    expect(los.losRay(10, 4, 10, 12)).toBeGreaterThanOrEqual(0);
  });

  // An open gate is still a structure: it can be shot and brought down, and its tiles stay its own.
  it('an open gate keeps its tiles and its hp: structureAt still names it', () => {
    const w = flat();
    w.sim.spawn(w.rifles, 0, fx.from(CX), fx.from(CY + 2));
    run(w.sim, 41);
    expect(stateOf(w.sim, w.gate)).toBe(GATE_OPEN);
    expect(w.sim.structureAt(10, 8)).toBe(w.gate);
    expect(w.sim.structureAt(11, 8)).toBe(w.gate);
    expect(w.sim.structures.hp[w.gate]).toBe(w.sim.structures.maxHp[w.gate]);
  });
});

describe('the gate world', () => {
  it('the gate tiles are the ones the world names', () => {
    const w = gateWorld();
    for (const t of GATE_TILES) expect(w.sim.structureAt(t % GATE_W, (t - (t % GATE_W)) / GATE_W)).toBe(w.gate);
  });
});
