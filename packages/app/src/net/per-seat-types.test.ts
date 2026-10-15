/**
 * N2-P5, the per-seat unit types spike (ruling L2, 15 Oct): can each SEAT of a
 * versus room field its own kit -- side 1's KDF types patched by a bought tier
 * while side 0's are not -- with no sim code at all?
 *
 * The recipe is app-side only: register the roster once (side 0, the base
 * ladder, exactly the mirror's world), then register a SECOND, patched copy
 * of every KDF type through the app's own `upgradePrepass` (the very loop
 * `bootBattlefield` and `buildMatchWorld` register through), and spawn each
 * side through its own id -> type-index map. The sim keys nothing on a type's
 * `id` (`addUnitType` appends; the only reads of `UnitType.id` in the sim are
 * the `spawn` event and the mission runtime, which a room does not run), so
 * two registrations under one id are two independent types to it.
 *
 * The patched copy KEEPS the base id (`applyUpgrades` patches stats, never
 * the id), which is why `forcesOf` and `scoreOf` -- both of which price a unit
 * by `unitCost(sim.unitTypes[typeIdx[i]].id)` -- price it at the base cost
 * with no mapping. Whether a kitted unit SHOULD be worth more on the board is
 * a design call for the per-seat-kit work, not something this spike decides.
 */
import { describe, it, expect } from 'vitest';
import { units, type UpgradableUnit } from '@lions/data';
import { fx, type Sim } from '@lions/sim';
import { VERSUS_KDF } from './versus-force';
import { forcesOf, unitCost } from './outcome';
import { scoreOf } from './scoreboard';
import { upgradePrepass } from '../upgrade-prepass';
import { sandboxAnchors, type SandboxAnchors } from '../sandbox-anchors';
import { hostileFacing } from '../sandbox-facing';
import { placeOnOpen } from '../sandbox-place';
import { buildWorld } from './versus-world.test-helper';

type RosterUnit = UpgradableUnit & { readonly id: string; readonly faction: string; readonly hull: { readonly hp: number } };
const roster = Object.values(units) as unknown as RosterUnit[];

/** Side 1's kit: the `armour` track at tier 1 on every KDF type that has one. */
const SIDE1_TIERS: Record<string, Record<string, number>> = {};
for (const u of roster) if (u.faction === 'kdf' && u.upgrades?.armour) SIDE1_TIERS[u.id] = { armour: 1 };

const HP_DELTA = (id: string): number => {
  const u = roster.find((x) => x.id === id);
  return (u?.upgrades?.armour?.tiers[0]?.patch['hull.hp'] as number | undefined) ?? 0;
};

/** The mirror's world (`buildWorld`: side 0's types, the base ladder) plus a
 *  second, patched registration of every KDF type for side 1, appended so
 *  every side-0 index is the one the mirror always had. Returns one id -> type
 *  map per SIDE. */
function perSeatWorld(mapId: 'beit_sahwan_outskirts' | 'tel_marum', patchSide1 = true) {
  const { sim, typeOf, map } = buildWorld(mapId);
  const typeOf1 = new Map(typeOf);
  if (patchSide1) {
    for (const t of upgradePrepass(roster, SIDE1_TIERS).registered) {
      if (t.faction !== 'kdf') continue; // only the brigade buys kit
      typeOf1.set(t.id, sim.addUnitType(t as never));
    }
  }
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

function run(mapId: 'beit_sahwan_outskirts' | 'tel_marum', ticks: number, patchSide1 = true) {
  const w = perSeatWorld(mapId, patchSide1);
  const bySide = perSeatSpawns(w.sim, w.typeOfBySide, sandboxAnchors(w.map));
  for (let i = 0; i < ticks; i++) w.sim.tick();
  return { ...w, bySide };
}

describe('per-seat unit types with no sim code (N2-P5, ruling L2)', () => {
  it('the per-seat spawner IS the mirror when both seats share one map (the pin holds)', () => {
    // Control: the test's spawner with side 1 on side 0's types reproduces
    // versus-force.test.ts's pinned mirror hash, so what follows differs from
    // the mirror ONLY by side 1's patched registrations.
    expect(run('beit_sahwan_outskirts', 200, false).sim.hash()).toBe(580559085);
  });

  it("side 1's KDF units carry the patched HP; side 0's carry the base", () => {
    const { sim, bySide } = run('beit_sahwan_outskirts', 0);
    let patched = 0;
    VERSUS_KDF.forEach(([id], k) => {
      const base = roster.find((u) => u.id === id)!.hull.hp;
      const a = bySide[0][k];
      const b = bySide[1][k];
      expect(sim.state.hp[a]).toBe(fx.from(base));
      expect(sim.state.hp[b]).toBe(fx.from(base + HP_DELTA(id)));
      // Same id on both seats: what the pricing below relies on.
      expect(sim.unitTypes[sim.state.typeIdx[b]].id).toBe(sim.unitTypes[sim.state.typeIdx[a]].id);
      if (HP_DELTA(id) > 0) {
        expect(sim.state.typeIdx[b]).not.toBe(sim.state.typeIdx[a]);
        patched++;
      }
    });
    // Every placement in the KDF versus force has an armour track.
    expect(patched).toBe(VERSUS_KDF.length);
  });

  for (const mapId of ['beit_sahwan_outskirts', 'tel_marum'] as const) {
    it(`two runs give equal hashes, and the patch reaches the hash (${mapId})`, () => {
      const a = run(mapId, 200);
      const b = run(mapId, 200);
      expect(a.sim.hash()).toBe(b.sim.hash());
      expect(a.sim.hash()).not.toBe(run(mapId, 200, false).sim.hash());
    });
  }

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
