// GH-976 (WP3): the set-up fortification kit in the sim -- `fortify`/`unfortify`, `fortifyReason`, the 36-placement cap -- and the
// proof that `footprintRefusal` (the extraction field works now share) answers exactly what `placementReason` always did.
// Regions are built here by integer maths (the sim package imports nothing). Every count is a literal with its arithmetic beside it.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { RIFLES } from './golden-worlds.test-helper';
import { Rng } from './rng';
import { Sim, type FortifyRefusal, type SimEvent, type UnitTypeJson } from './sim';
import { SETUP_PLACEMENTS_PER_SIDE } from './tuning';

const W = 32;
const UNTIL = 200;
const pos = (n: number): number => fx.from(n);
/** Side 0 owns x <= 15, the band is x 16..19, side 1 owns x >= 20. */
function vert(): Int8Array {
  const r = new Int8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) r[y * W + x] = x <= 15 ? 0 : x <= 19 ? -1 : 1;
  return r;
}

const HESCO = { id: 'k_hesco', name: 'HESCO', hp_per_tile: 600, garrison_slots: 0, rubble_cover: 2, low_profile: true, standing_cover: 3 };
const POST = { id: 'k_post', name: 'Post', hp_per_tile: 120, garrison_slots: 1, garrison_cover: 1, floors: 1, rubble_cover: 1, low_profile: true, standing_cover: 2 };
const TWALL = { id: 'k_twall', name: 'T-Wall', hp_per_tile: 900, garrison_slots: 0, rubble_cover: 2 };
const WORKS = (id: string, fp: [number, number]) => ({ id, name: id, hp_per_tile: 200, garrison_slots: 0, rubble_cover: 1, buildable: { cost: { logistics: 1 }, build_time_s: 1, footprint: fp } });
const HELO: UnitTypeJson = {
  id: 'k_helo', role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' }, sensors: { optics: 1, sight_tiles: 10, signature: 1 }, weapons: [],
};

interface Kit { readonly sim: Sim; readonly rifles: number; readonly helo: number; readonly hesco: number; readonly post: number; readonly twall: number }

/** A set-up world with the kit {12 hesco, 4 posts, 2 t-walls} and `bans`. */
function build(bans: readonly (readonly [number, number, number, number])[] = [], kit = true): Kit {
  const sim = new Sim({ seed: 976, width: W, height: W, capacity: 64 });
  sim.beginSetup({ untilTick: UNTIL, region: vert() });
  const rifles = sim.addUnitType(RIFLES);
  const helo = sim.addUnitType(HELO);
  const hesco = sim.addStructureType(HESCO);
  const post = sim.addStructureType(POST);
  const twall = sim.addStructureType(TWALL);
  if (kit) {
    sim.setSetupKit([{ structType: hesco, allowance: 12 }, { structType: post, allowance: 4 }, { structType: twall, allowance: 2 }], bans);
  }
  return { sim, rifles, helo, hesco, post, twall };
}

function run(sim: Sim, n: number, sink: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < n; i++) sink.push(...sim.tick());
  return sink;
}
/** Queue the commands, tick once, return that tick's events. */
function send(sim: Sim, ...cmds: Parameters<Sim['queueCommand']>[0][]): SimEvent[] {
  for (const c of cmds) sim.queueCommand(c);
  return sim.tick();
}
/** The foot mask at tile index t (the sim keeps it private; a test may read it). */
const blockedAt = (sim: Sim, t: number): number => (sim as unknown as { blocked: Uint8Array }).blocked[t];
const kinds = (ev: SimEvent[]): string[] => ev.map((e) => e.kind);
/** Tile of the i-th spot of a spread layout inside side 0's region: seven to a row, every other tile, rows two apart. */
const spot = (i: number): [number, number] => [2 + 2 * (i % 7), 4 + 2 * ((i - (i % 7)) / 7)];
const refusal = (ev: SimEvent[]): string => {
  const e = ev.find((x) => x.kind === 'fortifyRefused');
  return e !== undefined && e.kind === 'fortifyRefused' ? e.reason : 'none';
};

describe('the kit allowance', () => {
  it('twelve hesco are accepted and the 13th is no_kit; the other slots are untouched', () => {
    const { sim } = build();
    for (let i = 0; i < 12; i++) {
      const [x, y] = spot(i);
      const ev = send(sim, { kind: 'fortify', side: 0, kit: 0, x, y });
      expect(kinds(ev), `hesco ${i}`).toContain('fortified');
    }
    expect(sim.setupKitLeft(0, 0)).toBe(0);
    expect(sim.setupKitLeft(0, 1)).toBe(4);
    expect(sim.setupKitLeft(1, 0)).toBe(12); // the other side's allowance is its own
    const [x, y] = spot(12);
    expect(sim.fortifyReason(0, 0, x, y)).toBe('no_kit');
    expect(refusal(send(sim, { kind: 'fortify', side: 0, kit: 0, x, y }))).toBe('no_kit');
    expect(sim.fortifyReason(0, 1, x, y)).toBeNull(); // a post still has room
    expect(sim.structureCount).toBe(12);
  });

  it('a slot out of range, a side that is not 0 or 1, and a world that never gave a kit are no_kit', () => {
    const { sim } = build();
    expect(sim.fortifyReason(0, 3, 2, 4)).toBe('no_kit');
    expect(sim.fortifyReason(0, -1, 2, 4)).toBe('no_kit');
    expect(sim.fortifyReason(2 as 0, 0, 2, 4)).toBe('no_kit');
    expect(build([], false).sim.fortifyReason(0, 0, 2, 4)).toBe('no_kit');
  });

  it('unfortify refunds the allowance, and a fortify is accepted again', () => {
    const { sim } = build();
    for (let i = 0; i < 12; i++) {
      const [x, y] = spot(i);
      send(sim, { kind: 'fortify', side: 0, kit: 0, x, y });
    }
    expect(sim.setupKitLeft(0, 0)).toBe(0);
    const [x0, y0] = spot(0);
    const ev = send(sim, { kind: 'unfortify', side: 0, x: x0, y: y0 });
    expect(kinds(ev)).toEqual(['unfortified']);
    expect(sim.setupKitLeft(0, 0)).toBe(1);
    const [x, y] = spot(12);
    expect(kinds(send(sim, { kind: 'fortify', side: 0, kit: 0, x, y }))).toContain('fortified');
    expect(sim.setupKitLeft(0, 0)).toBe(0);
  });

  it('the 37th accepted placement is placements_spent, with allowance to spare; the 36th is accepted', () => {
    const { sim } = build();
    expect(SETUP_PLACEMENTS_PER_SIDE).toBe(36);
    const [x, y] = spot(0);
    for (let n = 1; n <= 36; n++) {
      expect(kinds(send(sim, { kind: 'fortify', side: 0, kit: 0, x, y })), `placement ${n}`).toContain('fortified');
      expect(kinds(send(sim, { kind: 'unfortify', side: 0, x, y })), `take-down ${n}`).toEqual(['unfortified']);
    }
    expect(sim.setupKitLeft(0, 0)).toBe(12); // every one refunded: the allowance is not what stops the 37th
    expect(sim.fortifyReason(0, 0, x, y)).toBe('placements_spent');
    expect(refusal(send(sim, { kind: 'fortify', side: 0, kit: 0, x, y }))).toBe('placements_spent');
    expect(sim.fortifyReason(1, 0, 22, 4)).toBeNull(); // side 1 has placed nothing
  });
});

describe('where a piece may go', () => {
  it('a tile of the enemy region, the band, or off the map is outside_region', () => {
    const { sim } = build();
    expect(sim.fortifyReason(0, 0, 22, 4)).toBe('outside_region'); // side 1's
    expect(sim.fortifyReason(0, 0, 17, 4)).toBe('outside_region'); // the band
    expect(sim.fortifyReason(0, 0, -1, 4)).toBe('outside_region');
    expect(sim.fortifyReason(0, 0, 2.5, 4)).toBe('outside_region');
    expect(sim.fortifyReason(1, 0, 4, 4)).toBe('outside_region'); // and the mirror
    expect(sim.fortifyReason(1, 0, 22, 4)).toBeNull();
    expect(refusal(send(sim, { kind: 'fortify', side: 0, kit: 0, x: 22, y: 4 }))).toBe('outside_region');
    expect(sim.structureCount).toBe(0);
  });

  it('a ban rect refuses every tile it covers and only those', () => {
    const { sim } = build([[4, 4, 2, 3]]); // x 4..5, y 4..6
    for (const [x, y] of [[4, 4], [5, 4], [4, 6], [5, 6]]) expect(sim.fortifyReason(0, 0, x, y), `${x},${y}`).toBe('banned');
    for (const [x, y] of [[3, 4], [6, 4], [4, 3], [4, 7]]) expect(sim.fortifyReason(0, 0, x, y), `${x},${y}`).toBeNull();
    expect(refusal(send(sim, { kind: 'fortify', side: 0, kit: 0, x: 5, y: 5 }))).toBe('banned');
  });

  it('a living unit on the tile makes it occupied; the next tile over is free', () => {
    const { sim, rifles } = build();
    sim.spawn(rifles, 0, pos(8.5), pos(8.5));
    expect(sim.fortifyReason(0, 0, 8, 8)).toBe('occupied');
    expect(sim.fortifyReason(0, 0, 9, 8)).toBeNull();
    expect(refusal(send(sim, { kind: 'fortify', side: 0, kit: 0, x: 8, y: 8 }))).toBe('occupied');
  });

  it('an enemy unit counts too, and a dead one, an airborne one and a carried one do not', () => {
    const { sim, rifles, helo } = build();
    const dead = sim.spawn(rifles, 0, pos(3.5), pos(3.5));
    sim.debugKill(dead);
    expect(sim.fortifyReason(0, 0, 3, 3)).toBeNull();
    const hov = sim.spawn(helo, 0, pos(5.5), pos(5.5));
    const rider = sim.spawn(rifles, 0, pos(5.5), pos(5.5));
    expect(sim.embarkAtSpawn(hov, rider)).toBe(true);
    expect(sim.fortifyReason(0, 0, 5, 5), 'a hovering helicopter and its rider').toBeNull();
    sim.state.airState[hov] = 1; // not LANDED or LANDING: still airborne, so it stays so
    sim.spawn(rifles, 1, pos(9.5), pos(9.5)); // a side-1 unit standing in side 0's region (a spawn did it): still a body on the tile
    expect(sim.fortifyReason(0, 0, 9, 9)).toBe('occupied');
  });

  it('a piece that would close a one-wide corridor is seals_passage, and the same tile is fine once the wall has a second gap', () => {
    const { sim } = build();
    for (let y = 0; y < W; y++) if (y !== 16) sim.setBlocked(10, y, true); // a wall across the map with a gap at (10, 16)
    expect(sim.fortifyReason(0, 0, 10, 16)).toBe('seals_passage');
    expect(refusal(send(sim, { kind: 'fortify', side: 0, kit: 0, x: 10, y: 16 }))).toBe('seals_passage');
    sim.setBlocked(10, 8, false); // a second gap
    expect(sim.fortifyReason(0, 0, 10, 16)).toBeNull();
  });

  it('the footprint rules answer in field works\' order: a blocked tile, a boulder, an occupied tile, and a slot-less table', () => {
    const { sim } = build();
    sim.setBlocked(6, 6, true);
    expect(sim.fortifyReason(0, 0, 6, 6)).toBe('blocked');
    sim.setBoulder(7, 6, true);
    expect(sim.fortifyReason(0, 0, 7, 6)).toBe('no_footing');
    const [x, y] = spot(0);
    send(sim, { kind: 'fortify', side: 0, kit: 0, x, y });
    expect(sim.fortifyReason(0, 1, x, y)).toBe('blocked'); // a standing piece blocks its tile: the earlier rule answers first
  });

  it('a full structure table is no_structure_slot', () => {
    const { sim } = build();
    // 256 structures is the table: one neutral one-tile wall on every even tile (3, 3 stays free).
    const wall = sim.addStructureType({ id: 'k_fill', hp_per_tile: 1, garrison_slots: 0, rubble_cover: 0 });
    for (let y = 0; y < W; y += 2) for (let x = 0; x < W; x += 2) sim.addStructure(wall, [y * W + x]); // 16 x 16 = 256, all on even tiles
    expect(sim.structureCount).toBe(256);
    expect(sim.fortifyReason(0, 0, 3, 3)).toBe('no_structure_slot');
  });
});

describe('unfortify', () => {
  it('takes down only a kit piece of the asker\'s side, and answers no_piece for anything else', () => {
    const { sim, post } = build();
    send(sim, { kind: 'fortify', side: 0, kit: 0, x: 4, y: 4 });
    const neutral = sim.addStructure(sim.addStructureType({ id: 'k_n', hp_per_tile: 50, garrison_slots: 0, rubble_cover: 0 }), [10 * W + 10]);
    void post;
    const noPiece = (x: number, y: number, side = 0): string => {
      const ev = send(sim, { kind: 'unfortify', side, x, y });
      const e = ev.find((v) => v.kind === 'unfortifyRefused');
      return e !== undefined && e.kind === 'unfortifyRefused' ? e.reason : 'accepted';
    };
    expect(noPiece(9, 9)).toBe('no_piece'); // an empty tile
    expect(noPiece(10, 10)).toBe('no_piece'); // a map structure
    expect(noPiece(-3, 2)).toBe('no_piece'); // off the map
    expect(noPiece(4, 4, 1)).toBe('no_piece'); // the other side's request for my piece
    expect(blockedAt(sim, 4 * W + 4)).toBe(1);
    expect(noPiece(4, 4)).toBe('accepted');
    expect(blockedAt(sim, 4 * W + 4)).toBe(0);
    expect(blockedAt(sim, 10 * W + 10)).toBe(1);
    void neutral;
  });

  it('a garrisoned sandbag post is occupied: refused, standing, and nobody is thrown out', () => {
    const { sim, rifles } = build();
    const sq = sim.spawn(rifles, 0, pos(6.5), pos(8.5));
    const ev0 = send(sim, { kind: 'fortify', side: 0, kit: 1, x: 6, y: 6 });
    const placed = ev0.find((e) => e.kind === 'fortified');
    expect(placed?.kind === 'fortified' ? placed.structure : -1).toBeGreaterThanOrEqual(0);
    const s = placed?.kind === 'fortified' ? placed.structure : -1;
    sim.queueCommand({ kind: 'garrison', ids: [sq], structure: s });
    run(sim, 120);
    expect(sim.state.garrisonedIn[sq], 'the squad entered the post').toBe(s);
    const left = sim.setupKitLeft(0, 1);
    const ev = send(sim, { kind: 'unfortify', side: 0, x: 6, y: 6 });
    const e = ev.find((x) => x.kind === 'unfortifyRefused');
    expect(e?.kind === 'unfortifyRefused' ? e.reason : 'none').toBe('occupied');
    expect(sim.state.garrisonedIn[sq]).toBe(s);
    expect(blockedAt(sim, 6 * W + 6)).toBe(1);
    expect(sim.setupKitLeft(0, 1)).toBe(left); // no refund for a refusal
  });

  it('records which slot placed a piece (setupKitOf) and -1 for any other structure', () => {
    const { sim } = build();
    const own = sim.addStructure(0, [12 * W + 12]);
    send(sim, { kind: 'fortify', side: 0, kit: 2, x: 4, y: 4 });
    expect(sim.setupKitOf(own)).toBe(-1);
    expect(sim.setupKitOf(own + 1)).toBe(2);
    expect(sim.setupKitOf(99)).toBe(-1);
    expect(sim.setupKitOf(-1)).toBe(-1);
    expect(sim.structureProducesFor(own + 1)).toBe(-1);
  });
});

describe('after the bell', () => {
  it('fortify is not_setup and unfortify is unfortifyRefused not_setup; a placed piece stays standing', () => {
    const { sim } = build();
    send(sim, { kind: 'fortify', side: 0, kit: 0, x: 4, y: 4 });
    run(sim, UNTIL);
    expect(sim.setupActive).toBe(false);
    expect(sim.fortifyReason(0, 0, 6, 6)).toBe('not_setup');
    expect(refusal(send(sim, { kind: 'fortify', side: 0, kit: 0, x: 6, y: 6 }))).toBe('not_setup');
    const ev = send(sim, { kind: 'unfortify', side: 0, x: 4, y: 4 });
    const e = ev.find((x) => x.kind === 'unfortifyRefused');
    expect(e?.kind === 'unfortifyRefused' ? e.reason : 'none').toBe('not_setup');
    expect(blockedAt(sim, 4 * W + 4)).toBe(1);
    expect(sim.structureCount).toBe(1);
  });
});

describe('field works are unchanged by the extraction (placementReason === footprintRefusal)', () => {
  it('agrees on 200 seeded random footprints over a map of walls, boulders, levels and structures', () => {
    const sim = new Sim({ seed: 3, width: 20, height: 20, capacity: 8 });
    const types = [[1, 1], [2, 1], [1, 3], [2, 2], [3, 2]].map(([fw, fh], i) => ({ fw, fh, id: sim.addStructureType(WORKS(`w${i}`, [fw, fh])) }));
    const plain = sim.addStructureType({ id: 'plain', hp_per_tile: 100, garrison_slots: 0, rubble_cover: 0 });
    const r = new Rng(20261106, 1); // the TEST's own seeded stream, entity 0
    const below = (n: number): number => r.nextU32(0) % n;
    for (let i = 0; i < 40; i++) sim.setBlocked(below(20), below(20), true);
    for (let i = 0; i < 25; i++) sim.setBoulder(below(20), below(20), true);
    for (let i = 0; i < 30; i++) sim.setElevation(below(20), below(20), 1 + below(2));
    for (let i = 0; i < 6; i++) {
      const x = below(18);
      const y = below(18);
      if (blockedAt(sim, y * 20 + x) === 0) sim.addStructure(plain, [y * 20 + x]);
    }
    const probe = sim as unknown as { footprintRefusal(tx: number, ty: number, fw: number, fh: number): string | null };
    const seen = new Set<string | null>();
    for (let n = 0; n < 200; n++) {
      const t = types[below(types.length)];
      const x = below(24) - 2;
      const y = below(24) - 2;
      const a = sim.placementReason(t.id, x, y, 0);
      expect(a, `#${n}: ${t.fw}x${t.fh} at ${x},${y}`).toBe(probe.footprintRefusal(x, y, t.fw, t.fh));
      seen.add(a);
    }
    // Not vacuous: every rule this draw can reach answered at least once.
    // ('overlap' is reachable only through a pending field-works site, which works.test.ts covers; a standing structure is blocked first.)
    for (const why of ['off_map', 'blocked', 'no_footing', 'not_level', null]) expect(seen.has(why), String(why)).toBe(true);
    // The seal rule on a clean map: a wall across it with one gap, and the footprint in the gap.
    const gap = new Sim({ seed: 3, width: 20, height: 20, capacity: 8 });
    const works = gap.addStructureType(WORKS('gap', [1, 1]));
    for (let y = 0; y < 20; y++) if (y !== 9) gap.setBlocked(14, y, true);
    expect(gap.placementReason(works, 14, 9, 0)).toBe('seals_passage');
    expect((gap as unknown as typeof probe).footprintRefusal(14, 9, 1, 1)).toBe('seals_passage');
  });
});

describe('the kit is configuration that cannot be given twice or late', () => {
  it('setSetupKit throws without a set-up, after tick 0, twice, and on a bad piece or ban', () => {
    const bare = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const t = bare.addStructureType(HESCO);
    expect(() => bare.setSetupKit([{ structType: t, allowance: 1 }], [])).toThrow(/beginSetup/);
    const { sim, hesco } = build([], false);
    expect(() => sim.setSetupKit([{ structType: 99, allowance: 1 }], [])).toThrow(/no structure type/);
    expect(() => sim.setSetupKit([{ structType: hesco, allowance: -1 }], [])).toThrow(/allowance/);
    expect(() => sim.setSetupKit([{ structType: hesco, allowance: 1 }], [[1, 2, 3, 0.5]])).toThrow(/four integers/);
    sim.setSetupKit([{ structType: hesco, allowance: 1 }], []);
    expect(() => sim.setSetupKit([{ structType: hesco, allowance: 1 }], [])).toThrow(/twice/);
    const late = build([], false);
    late.sim.tick();
    expect(() => late.sim.setSetupKit([{ structType: late.hesco, allowance: 1 }], [])).toThrow(/before the first tick/);
  });

  it('the kit is hashed: two worlds that differ only in the allowance, the ban rects or a placement differ', () => {
    const base = build([[1, 1, 1, 1]]).sim.hash();
    expect(build([[1, 1, 1, 1]]).sim.hash()).toBe(base);
    expect(build([[1, 1, 1, 2]]).sim.hash()).not.toBe(base);
    expect(build([]).sim.hash()).not.toBe(base);
    // The allowance alone: hesco 11 against 12, same bans, same everything else, at tick 0.
    const eleven = (() => {
      const w = build([[1, 1, 1, 1]], false);
      w.sim.setSetupKit([{ structType: w.hesco, allowance: 11 }, { structType: w.post, allowance: 4 }, { structType: w.twall, allowance: 2 }], [[1, 1, 1, 1]]);
      return w.sim.hash();
    })();
    expect(eleven).not.toBe(base);
    const placed = build([[1, 1, 1, 1]]);
    send(placed.sim, { kind: 'fortify', side: 0, kit: 0, x: 4, y: 4 });
    const twin = build([[1, 1, 1, 1]]);
    twin.sim.tick();
    expect(placed.sim.hash()).not.toBe(twin.sim.hash());
  });
});

// A reason is a string of the union: this fails to compile if FortifyRefusal loses a member the sim can answer.
const ALL_REASONS: readonly FortifyRefusal[] = ['off_map', 'blocked', 'no_footing', 'not_level', 'overlap', 'seals_passage', 'not_setup', 'no_kit', 'placements_spent', 'outside_region', 'banned', 'occupied', 'no_structure_slot'];
void ALL_REASONS;
