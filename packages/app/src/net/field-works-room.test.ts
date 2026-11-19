import { describe, expect, it } from 'vitest';
import { applyFrame, matchDigest, validateConfig, type MatchConfig } from '@lions/net';
import { buildMatchWorld, matchTick, versusFieldWorks } from './match-world';
import { seatWorldFor } from './frame-run';
import { productionOf } from './outcome';
import { hasEconomy } from './computer/economy-view';
import { roomWorksDockRuntime, roomWorksPurse, roomWorksSeat } from './room-works';

// Versus field works (the lead's ruling, 18 Nov 2026: "add it to play with a friend, Annihilation mode option", "KDF vs KDF
// only", 1,000 logistics a player): the room option end to end below the DOM -- the config, the world, ownership, the
// works-only runtime, the outcome rule and the seat-bound views.

function room(fieldWorks: boolean, map = 'tel_marum', seed = 4321): MatchConfig {
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({
    matchId: 'M', code: 'ABCDEF', seed, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' },
    hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, ...(fieldWorks ? { fieldWorks: true } : {}),
  });
  if (c === null) throw new Error('bad fixture');
  return c;
}

/** A living builder of `side` (the D9, or any `construct` unit the force fields). */
function builderOf(w: ReturnType<typeof buildMatchWorld>, side: 0 | 1): number {
  for (const id of w.bySide[side]) if (w.sim.unitTypes[w.sim.state.typeIdx[id]].canConstruct) return id;
  throw new Error(`side ${side} fields no builder`);
}

/** An open tile near `id` where `typeId` may stand for `side`, searched outward from the unit. */
function padNear(w: ReturnType<typeof buildMatchWorld>, id: number, typeId: string, side: 0 | 1): [number, number] {
  const rt = w.runtime;
  if (rt === null) throw new Error('no runtime');
  const ux = w.sim.state.posX[id] >> 16;
  const uy = w.sim.state.posY[id] >> 16;
  for (let r = 2; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = ux + dx;
        const y = uy + dy;
        if (rt.constructReason(typeId, x, y, [id], side) === null) return [x, y];
      }
    }
  }
  throw new Error(`no pad for ${typeId} near ${id}`);
}

/** `side`'s site raising at (x, y): unstaked, or staked under a structure row (a builder beside the pad stakes at once). */
function siteOf(w: ReturnType<typeof buildMatchWorld>, x: number, y: number, side: 0 | 1): number {
  const rt = w.runtime;
  if (rt === null) return -1;
  const st = w.sim.structureAt(x, y);
  return rt.unstakedWorksAt(x, y, side)?.site ?? (st >= 0 ? rt.worksAt(st, side)?.site : undefined) ?? -1;
}

describe('versus field works: the room world', () => {
  it('the offer is the shipped buildable works that open no line, each counted so the purse binds first', () => {
    // A literal: the five works and the 1,000 purse over each price, floored. The forward camp is held out.
    expect(versusFieldWorks()).toEqual({ kdf_medic_station: 4, kdf_outpost: 2, kdf_intel_centre: 2, kdf_workshop: 3, kdf_aid_post: 5 });
  });

  it('off: no runtime, as today; on: a works-only runtime, each side with 1,000 and its own offer', () => {
    expect(buildMatchWorld(room(false)).runtime).toBeNull();
    const w = buildMatchWorld(room(true));
    expect(w.fieldWorks).toBe(true);
    const rt = w.runtime;
    if (rt === null) throw new Error('no runtime');
    for (const side of [0, 1] as const) {
      expect(rt.logisticsOf(side)).toBe(1000);
      expect(rt.worksOffers(side).map((o) => o.typeId)).toEqual(Object.keys(versusFieldWorks()));
    }
    expect([...w.structureTypes].sort()).toEqual(Object.keys(versusFieldWorks()).sort());
  });

  it('the option is in the hash: the same room with and without it differs at tick 0, and only in the runtime digest', () => {
    const on = buildMatchWorld(room(true));
    const off = buildMatchWorld(room(false));
    // The sim is the same world byte for byte (the works runtime stands nothing and spawns nobody) ...
    expect(on.sim.hash()).toBe(off.sim.hash());
    // ... and the match digest both machines compare is not.
    expect(matchDigest(on.sim.hash(), on.runtime?.digest() ?? 0, 0)).not.toBe(matchDigest(off.sim.hash(), off.runtime?.digest() ?? 0, 0));
  });

  it('seat 1 raises a work through the frame path: ownership passes it, the runtime charges side 1 and the sim opens its site', () => {
    const config = room(true);
    const w = buildMatchWorld(config);
    const rt = w.runtime;
    if (rt === null) throw new Error('no runtime');
    const d9 = builderOf(w, 1);
    const [x, y] = padNear(w, d9, 'kdf_aid_post', 1);
    const world = seatWorldFor(config, w.sim);
    const res = applyFrame({ tick: 0, cmds: [{ seat: 1, seq: 0, cmd: { kind: 'raiseWorks', side: 1, works: 'kdf_aid_post', x, y, ids: [d9] } }] }, w.sim, world);
    expect(res).toEqual({ queued: 1, dropped: 0 });
    const out = matchTick(w);
    expect(rt.logisticsOf(1)).toBe(800);
    expect(rt.logisticsOf(0)).toBe(1000);
    expect(out.mission.some((e) => e.kind === 'works' && e.phase === 'started' && e.side === 1)).toBe(true);
    expect(rt.worksOffers(1).find((o) => o.typeId === 'kdf_aid_post')?.left).toBe(4);
    expect(rt.worksOffers(0).find((o) => o.typeId === 'kdf_aid_post')?.left).toBe(5);
  });

  it('seat 0 cannot raise for side 1 or cancel side 1\'s site; off the option both orders drop', () => {
    const config = room(true);
    const w = buildMatchWorld(config);
    const world = seatWorldFor(config, w.sim);
    const d9 = builderOf(w, 1);
    const [x, y] = padNear(w, d9, 'kdf_aid_post', 1);
    expect(applyFrame({ tick: 0, cmds: [{ seat: 0, seq: 0, cmd: { kind: 'raiseWorks', side: 1, works: 'kdf_aid_post', x, y, ids: [] } }] }, w.sim, world).dropped).toBe(1);
    applyFrame({ tick: 0, cmds: [{ seat: 1, seq: 0, cmd: { kind: 'raiseWorks', side: 1, works: 'kdf_aid_post', x, y, ids: [d9] } }] }, w.sim, world);
    matchTick(w);
    const site = siteOf(w, x, y, 1);
    expect(site).toBeGreaterThanOrEqual(0);
    // Ownership passes a cancel for the seat's own side; the runtime refuses a site of the other.
    const seat0 = roomWorksSeat(w.runtime as NonNullable<typeof w.runtime>, 0);
    expect(seat0.canCancelWorks(site)).toBe(false);
    expect(roomWorksSeat(w.runtime as NonNullable<typeof w.runtime>, 1).canCancelWorks(site)).toBe(true);
    const offConfig = room(false);
    const off = buildMatchWorld(offConfig);
    const offWorld = seatWorldFor(offConfig, off.sim);
    expect(applyFrame({ tick: 0, cmds: [{ seat: 1, seq: 0, cmd: { kind: 'raiseWorks', side: 1, works: 'kdf_aid_post', x, y, ids: [] } }] }, off.sim, offWorld).dropped).toBe(1);
  });

  it('an annihilation room still: a works-only runtime is no economy, so the outcome asks it nothing', () => {
    const w = buildMatchWorld(room(true));
    expect(productionOf(w)).toBeUndefined();
    expect(hasEconomy(w)).toBe(false);
  });

  it('the seat views are bound to their side: the dock, the purse and the works questions', () => {
    const w = buildMatchWorld(room(true));
    const rt = w.runtime;
    if (rt === null) throw new Error('no runtime');
    const d9 = builderOf(w, 1);
    const [x, y] = padNear(w, d9, 'kdf_outpost', 1);
    w.sim.queueCommand({ kind: 'raiseWorks', side: 1, works: 'kdf_outpost', x, y, ids: [d9] });
    matchTick(w);
    expect(roomWorksPurse(rt, 1)).toEqual({ logistics: 650, ratePerMin: 0 });
    expect(roomWorksPurse(rt, 0)).toEqual({ logistics: 1000, ratePerMin: 0 });
    expect(roomWorksDockRuntime(rt, 1).logistics).toBe(650);
    expect(roomWorksDockRuntime(rt, 1).worksOffers?.().find((o) => o.typeId === 'kdf_outpost')?.left).toBe(1);
    expect(roomWorksDockRuntime(rt, 0).worksOffers?.().find((o) => o.typeId === 'kdf_outpost')?.left).toBe(2);
    // The site is side 1's: its seat finds it (staked or not), side 0's does not.
    const s1 = roomWorksSeat(rt, 1);
    const s0 = roomWorksSeat(rt, 0);
    const st = w.sim.structureAt(x, y);
    expect(s1.unstakedWorksAt(x, y) ?? (st >= 0 ? s1.worksAt(st) : null)).not.toBeNull();
    expect(s0.unstakedWorksAt(x, y) ?? (st >= 0 ? s0.worksAt(st) : null)).toBeNull();
  });
});
