/**
 * N2-P5, the per-seat unit types spike (ruling L2, 15 Oct), and what shipped
 * from it: can each SEAT of a versus room field its own kit -- side 1's KDF
 * types patched by bought tiers while side 0's are not -- with no sim code at
 * all?
 *
 * The recipe is app-side only: register the roster once (side 0, the base
 * ladder, exactly the mirror's world), then register a SECOND, patched copy
 * of every KDF type through the app's own `upgradePrepass`, and spawn each
 * side through its own id -> type-index map. The sim keys nothing on a type's
 * `id` (`addUnitType` appends; the only reads of `UnitType.id` in the sim are
 * the `spawn` event and the mission runtime, which a room does not run), so
 * two registrations under one id are two independent types to it.
 *
 * The patched copy KEEPS the base id (`applyUpgrades` patches stats, never
 * the id), which is why `forcesOf` and `scoreOf` -- both of which price a unit
 * by `unitCost(sim.unitTypes[typeIdx[i]].id)` -- price it at the base cost
 * with no mapping. That is the shipped rule for this version (ruling, 16 Oct):
 * a kitted unit is worth its base cost on the board.
 *
 * The first half of this file builds the spike's own world by hand
 * (`buildWorld` plus a per-side spawner copied from `versusSpawns`), which is
 * how the question was first answered and the control pins that this world IS
 * the mirror. The shipped builder is `buildMatchWorld` (`match-world.ts`): it
 * registers side 0's roster, appends a copy only of a KDF type whose cleaned
 * claim (`seatKitTiers`) differs on side 1, and spawns each side through its
 * own table -- the last describe here runs that builder end to end.
 */
import { describe, it, expect } from 'vitest';
import { applyUpgrades, readPath, type UpgradableUnit } from '@lions/data';
import { fx, type Sim } from '@lions/sim';
import { VERSUS_KDF } from './versus-force';
import { forcesOf, unitCost } from './outcome';
import { scoreOf } from './scoreboard';
import { validateConfig, type MatchConfig } from '@lions/net';
import { buildMatchWorld, type MatchWorld } from './match-world';
import { upgradePrepass } from '../upgrade-prepass';
import { sandboxAnchors, type SandboxAnchors } from '../sandbox-anchors';
import { hostileFacing } from '../sandbox-facing';
import { placeOnOpen } from '../sandbox-place';
import { buildWorld } from './versus-world.test-helper';
import { versusRoster } from './versus-roster';

type RosterUnit = UpgradableUnit & { readonly id: string; readonly faction: string };
const roster = versusRoster() as unknown as RosterUnit[];
const kdf = roster.filter((u) => u.faction === 'kdf');

/** Side 1's kit: the `armour` AND `firepower` tracks at tier 1 on every KDF
 *  type (a track a type does not declare is ignored by `applyUpgrades`). */
const tiersFor = (tracks: readonly string[]): Record<string, Record<string, number>> =>
  Object.fromEntries(kdf.map((u) => [u.id, Object.fromEntries(tracks.map((t) => [t, 1]))]));
const KIT = tiersFor(['armour', 'firepower']);

const baseOf = (id: string): RosterUnit => {
  const u = roster.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};
const read = (u: UpgradableUnit, path: string): number => readPath(u, path) ?? NaN;
const tierPatch = (id: string, track: string, path: string): number =>
  (baseOf(id).upgrades?.[track]?.tiers[0]?.patch[path] as number | undefined) ?? 0;

/** Side 1's registrations, one variant per question. Every variant except
 *  `base` registers a full set of KDF copies, so the type-index layout -- and
 *  with it the tick-0 hash's typeIdx column -- is identical across them and a
 *  difference after combat can only come from the stats.
 *  - `base`: no copies; side 1 spawns on side 0's types (the mirror).
 *  - `identity`: copies with no tier, stat for stat the base.
 *  - `armour`: armour track only. `kit`: armour + firepower.
 *  - `plates`: the armour track's plate deltas WITHOUT its hull.hp delta, so
 *    the tick-0 state equals `identity`'s and only the target's armour lookup
 *    can tell them apart -- scaled by `PLATE_GAIN`, because the real tier-1
 *    plates (+14 on a Lavi's front, +1 on a squad) flip no roll in this 90 s
 *    fight: measured, the unscaled fate reads equal to `identity`'s. The sim
 *    reads plate off the TARGET's own type index (`presentedArmor`), so the
 *    gain only makes a difference observable, it changes no path. */
const PLATE_GAIN = 20;
type Variant = 'base' | 'identity' | 'armour' | 'kit' | 'plates';
function side1Types(variant: Exclude<Variant, 'base'>): RosterUnit[] {
  switch (variant) {
    case 'identity':
      return upgradePrepass(kdf, {}).registered;
    case 'armour':
      return upgradePrepass(kdf, tiersFor(['armour'])).registered;
    case 'kit':
      return upgradePrepass(kdf, KIT).registered;
    case 'plates':
      return kdf.map((u) => {
        const armour = u.upgrades?.armour;
        if (!armour) return applyUpgrades(u, {});
        const patch: Record<string, number> = {};
        for (const [path, d] of Object.entries(armour.tiers[0].patch)) {
          if (path !== 'hull.hp') patch[path] = d * PLATE_GAIN;
        }
        const tiers = [{ ...armour.tiers[0], patch }, ...armour.tiers.slice(1)];
        return applyUpgrades({ ...u, upgrades: { ...u.upgrades, armour: { ...armour, tiers } } }, { armour: 1 });
      });
  }
}

/** The mirror's world (`buildWorld`: side 0's types, the base ladder) plus
 *  side 1's registrations, appended so every side-0 index is the one the
 *  mirror always had. Returns one id -> type map per SIDE. */
function perSeatWorld(mapId: 'beit_sahwan_outskirts' | 'tel_marum', variant: Variant) {
  const { sim, typeOf, map } = buildWorld(mapId);
  const typeOf1 = new Map(typeOf);
  if (variant !== 'base') for (const t of side1Types(variant)) typeOf1.set(t.id, sim.addUnitType(t as never));
  return { sim, map, typeOfBySide: [typeOf, typeOf1] as const };
}

/** `versusSpawns`' KDF mirror, statement for statement, but each side placed
 *  through its OWN type map. */
function perSeatSpawns(sim: Sim, typeOfBySide: readonly [Map<string, number>, Map<string, number>], anchors: SandboxAnchors) {
  const place0 = placeOnOpen(sim, typeOfBySide[0]);
  const place1 = placeOnOpen(sim, typeOfBySide[1]);
  const [ax, ay] = anchors.friendly;
  const [bx, by] = anchors.hostile;
  const faceA = hostileFacing(bx, by, ax, ay);
  const faceB = hostileFacing(ax, ay, bx, by);
  const bySide: [number[], number[]] = [[], []];
  for (const [id, dx, dy] of VERSUS_KDF) bySide[0].push(place0(id, 0, ax + dx, ay + dy, faceA));
  for (const [id, dx, dy] of VERSUS_KDF) bySide[1].push(place1(id, 1, bx - dx, by - dy, faceB));
  return bySide;
}

/** The versus probe's play (`tools/src/backtest/versus-probe.ts`): every
 *  20 s each side's living units attack-move on the other side's centroid. */
const ORDER_EVERY = 400;
function order(sim: Sim, bySide: readonly [number[], number[]]): void {
  for (const side of [0, 1] as const) {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const i of bySide[side === 0 ? 1 : 0]) {
      if (sim.state.alive[i] !== 1) continue;
      x += sim.state.posX[i];
      y += sim.state.posY[i];
      n++;
    }
    const ids = bySide[side].filter((i) => sim.state.alive[i] === 1);
    if (n > 0 && ids.length > 0) sim.queueCommand({ kind: 'attackMove', ids, x: Math.round(x / n), y: Math.round(y / n) });
  }
}

function run(mapId: 'beit_sahwan_outskirts' | 'tel_marum', ticks: number, variant: Variant = 'kit', fight = false) {
  const w = perSeatWorld(mapId, variant);
  const bySide = perSeatSpawns(w.sim, w.typeOfBySide, sandboxAnchors(w.map));
  const hash0 = w.sim.hash();
  for (let t = 0; t < ticks; t++) {
    if (fight && t % ORDER_EVERY === 0) order(w.sim, bySide);
    w.sim.tick();
  }
  return { ...w, bySide, hash0 };
}

/** What a unit's fight did to it, read per placement (side, k). */
/** Suppression is in the fate since mobility kills (#706): with both Petens
 *  forced down, the 90 s fight's firepower patch reaches side 0 as suppression
 *  (units 12 and 13: 39110 vs 38861, 36672 vs 36627) and no longer as hp. */
const fate = (r: ReturnType<typeof run>) =>
  r.bySide.map((ids) =>
    ids.map((i) => [r.sim.state.alive[i], r.sim.state.hp[i], r.sim.state.posX[i], r.sim.state.posY[i], r.sim.state.suppression[i]]),
  );

/** 90 s of the probe's play: long enough on beit for both sides to lose units. */
const BATTLE_TICKS = 1800;

describe('per-seat unit types with no sim code (N2-P5, ruling L2)', () => {
  it('the per-seat spawner IS the mirror when both seats share one map (the pin holds)', () => {
    // Control: the test's spawner with side 1 on side 0's types reproduces
    // the mirror's hash on the sandbox heuristic's seats (versus-force.test.ts's
    // pin before beit's versus seats moved, `versus-seats.ts`), so what follows
    // differs from the mirror ONLY by side 1's registrations. This file keeps
    // those seats on purpose: it measures a mechanism, and its 90 s fight was
    // sized on them. Re-pinned when wounds opened to versus (23 Oct 2026: the wounded types
    // join the roster and the wound block is in the hash). Was 580559085.
    // Re-pinned 25 Oct 2026 for GH-421 Stage 2 (vehicle avoidance): the columns sepWait and sepLast join the hash and nothing else moved (with their hashArray lines removed the old values read back). Was 1696120804.
    expect(run('beit_sahwan_outskirts', 200, 'base').sim.hash()).toBe(1311563748);
  });

  it("side 1's KDF units carry the patched HP and weapon; side 0's carry the base", () => {
    const { sim, bySide } = run('beit_sahwan_outskirts', 0);
    let hpPatched = 0;
    let weaponPatched = 0;
    VERSUS_KDF.forEach(([id], k) => {
      const base = baseOf(id);
      const a = bySide[0][k];
      const b = bySide[1][k];
      const hpDelta = tierPatch(id, 'armour', 'hull.hp');
      expect(sim.state.hp[a]).toBe(fx.from(read(base, 'hull.hp')));
      expect(sim.state.hp[b]).toBe(fx.from(read(base, 'hull.hp') + hpDelta));
      // Same id on both seats: what the pricing below relies on.
      const ta = sim.unitTypes[sim.state.typeIdx[a]];
      const tb = sim.unitTypes[sim.state.typeIdx[b]];
      expect(tb.id).toBe(ta.id);
      expect(sim.state.typeIdx[b]).not.toBe(sim.state.typeIdx[a]);
      if (hpDelta > 0) hpPatched++;
      const penDelta = tierPatch(id, 'firepower', 'weapons[0].penetration');
      const accDelta = tierPatch(id, 'firepower', 'weapons[0].accuracy');
      if (ta.weapons.length > 0) {
        expect(ta.weapons[0].penetration).toBe(fx.from(read(base, 'weapons[0].penetration')));
        expect(tb.weapons[0].penetration).toBe(fx.from(read(base, 'weapons[0].penetration') + penDelta));
        expect(tb.weapons[0].accuracy).toBe(fx.from(read(base, 'weapons[0].accuracy') + accDelta));
      }
      if (penDelta > 0) weaponPatched++;
    });
    // Every placement in the KDF versus force has an armour track; all but
    // the unarmed D9 and recon drone have a firepower track.
    expect(hpPatched).toBe(VERSUS_KDF.length);
    expect(weaponPatched).toBe(VERSUS_KDF.filter(([id]) => baseOf(id).upgrades?.firepower).length);
    expect(weaponPatched).toBeGreaterThanOrEqual(VERSUS_KDF.length - 2);
  });

  for (const mapId of ['beit_sahwan_outskirts', 'tel_marum'] as const) {
    it(`two runs give equal hashes, and the patch reaches the hash (${mapId})`, () => {
      const a = run(mapId, 200);
      const b = run(mapId, 200);
      expect(a.sim.hash()).toBe(b.sim.hash());
      expect(a.sim.hash()).not.toBe(run(mapId, 200, 'base').sim.hash());
    });
  }

  // Each battle is 1800 ticks of a 30-unit fight (~1.6 s locally); the
  // explicit timeout keeps a slow CI runner from reading that as a hang.
  describe("through combat (the probe's attack-move, 90 s on beit_sahwan_outskirts)", { timeout: 60_000 }, () => {
    let memo: ReturnType<typeof run> | undefined;
    const kitRun = (): ReturnType<typeof run> => (memo ??= run('beit_sahwan_outskirts', BATTLE_TICKS, 'kit', true));
    let identityMemo: ReturnType<typeof run> | undefined;
    const identityRun = (): ReturnType<typeof run> =>
      (identityMemo ??= run('beit_sahwan_outskirts', BATTLE_TICKS, 'identity', true));

    it('fire is exchanged: both sides take damage and lose units', () => {
      const kit = kitRun();
      for (const side of [0, 1] as const) {
        const dead = kit.bySide[side].filter((i) => kit.sim.state.alive[i] === 0).length;
        expect(dead).toBeGreaterThan(0);
      }
      const [s0, s1] = scoreOf(kit.sim);
      expect(s0.lostValue).toBeGreaterThan(0);
      expect(s1.lostValue).toBeGreaterThan(0);
    });

    it('two runs hash equal through combat', () => {
      expect(run('beit_sahwan_outskirts', BATTLE_TICKS, 'kit', true).sim.hash()).toBe(kitRun().sim.hash());
    });

    it('duplicate registrations alone change no fight: identity copies play the mirror unit for unit', () => {
      const base = run('beit_sahwan_outskirts', BATTLE_TICKS, 'base', true);
      const identity = identityRun();
      expect(fate(identity)).toEqual(fate(base));
    });

    it('side 1 fires its OWN patched weapon: firepower moves the fight from an identical tick 0', () => {
      const kit = kitRun();
      const armour = run('beit_sahwan_outskirts', BATTLE_TICKS, 'armour', true);
      expect(armour.hash0).toBe(kit.hash0);
      expect(fate(kit)).not.toEqual(fate(armour));
    });

    it('hits on side 1 read its OWN patched armour: plates move the fight from an identical tick 0', () => {
      const identity = identityRun();
      const plates = run('beit_sahwan_outskirts', BATTLE_TICKS, 'plates', true);
      expect(plates.hash0).toBe(identity.hash0);
      expect(fate(plates)).not.toEqual(fate(identity));
    });

    it('scoreOf prices the post-combat board, patched losses included, at base cost', () => {
      const kit = kitRun();
      const valueOf = (side: 0 | 1, alive: 0 | 1): number =>
        VERSUS_KDF.reduce((s, [id], k) => s + (kit.sim.state.alive[kit.bySide[side][k]] === alive ? unitCost(id) : 0), 0);
      const [s0, s1] = scoreOf(kit.sim);
      expect(s1.lostValue).toBe(valueOf(1, 0));
      expect(s1.remaining).toBe(valueOf(1, 1));
      expect(s0.lostValue).toBe(valueOf(0, 0));
      expect(s0.remaining).toBe(valueOf(0, 1));
      expect(s1.lostValue + s1.remaining).toBe(6664);
    });
  });

  it('forcesOf and scoreOf price every unit, patched ones included, at its base cost', () => {
    const { sim, bySide } = run('beit_sahwan_outskirts', 0);
    const valueOf = (ks: readonly number[]): number => ks.reduce((s, k) => s + unitCost(VERSUS_KDF[k][0]), 0);
    const all = VERSUS_KDF.map((_, k) => k);
    expect(valueOf(all)).toBe(6664);
    expect(forcesOf(sim)).toEqual([6664, 6664]);

    // Kill the even placements of side 1 (all patched types) and the odd of
    // side 0: each loss must be priced on the board, and what is left too.
    const even = all.filter((k) => k % 2 === 0);
    const odd = all.filter((k) => k % 2 === 1);
    for (const k of even) sim.debugKill(bySide[1][k]);
    for (const k of odd) sim.debugKill(bySide[0][k]);
    const [s0, s1] = scoreOf(sim);
    expect(s1.lost).toBe(even.length);
    expect(s1.lostValue).toBe(valueOf(even));
    expect(s1.remaining).toBe(valueOf(odd));
    expect(s0.lostValue).toBe(valueOf(odd));
    expect(s0.remaining).toBe(valueOf(even));
    expect(s0.destroyedValue).toBe(s1.lostValue);
    expect(forcesOf(sim)).toEqual([valueOf(even), valueOf(odd)]);
  });
});

describe('the shipped builder (buildMatchWorld) with side 1 on a kit', { timeout: 60_000 }, () => {
  /** A beit room on the probe's seed; side 1 claims the armour and firepower
   *  tiers on every KDF type (the spike's `KIT`), side 0 claims nothing. */
  function room(kit1: 'matched' | 'brigade'): MatchConfig {
    const seat = (s: 0 | 1) => ({
      seat: s, side: s, faction: 'kdf', kit: s === 1 ? kit1 : 'brigade', tiers: s === 1 ? KIT : {},
      unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human',
    });
    const c = validateConfig({
      matchId: 'M', code: 'ABCDEF', seed: 20260727, map: 'beit_sahwan_outskirts', mode: 'versus', seats: [seat(0), seat(1)],
      pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
    });
    if (c === null) throw new Error('bad fixture');
    return c;
  }
  const play = (w: MatchWorld, ticks: number): MatchWorld => {
    for (let t = 0; t < ticks; t++) {
      if (t % ORDER_EVERY === 0) order(w.sim, w.bySide);
      w.sim.tick();
    }
    return w;
  };
  const fateOf = (w: MatchWorld) =>
    w.bySide.map((ids) => ids.map((i) => [w.sim.state.alive[i], w.sim.state.hp[i], w.sim.state.posX[i], w.sim.state.posY[i]]));

  it("the fight differs from the matched room's, and the board still prices at base cost (6664 a side at tick 0)", () => {
    const matched = buildMatchWorld(room('matched'));
    const kitted = buildMatchWorld(room('brigade'));
    expect(forcesOf(kitted.sim)).toEqual([6664, 6664]);
    expect(forcesOf(matched.sim)).toEqual([6664, 6664]);
    const [k0, k1] = scoreOf(kitted.sim);
    expect([k0.remaining, k1.remaining]).toEqual([6664, 6664]);
    expect([k0.lostValue, k1.lostValue]).toEqual([0, 0]);
    expect(fateOf(play(kitted, BATTLE_TICKS))).not.toEqual(fateOf(play(matched, BATTLE_TICKS)));
    // After combat the board still sums to the base cost, kitted losses included.
    const [s0, s1] = scoreOf(kitted.sim);
    expect(s1.lostValue + s1.remaining).toBe(6664);
    expect(s0.lostValue + s0.remaining).toBe(6664);
  });
});
