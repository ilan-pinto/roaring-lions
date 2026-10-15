/**
 * The precondition that makes "a `^` tile is rock by its symbol, not by the
 * mask" (`packages/render/src/three/terrain/rock-keying.test.ts`) change
 * nothing on any shipped map: every `^` tile is blocked in the sim and stands
 * under no structure, so `drawBlockedMask` -- which clears only live
 * low-profile structures' tiles -- always terraces it, and the three keying
 * sites take the branch they always took.
 *
 * Lives in `packages/app` because it needs `@lions/data`'s real maps, which
 * `packages/render` may not import (the same reason `ground-texture-slots.
 * test.ts` lives here).
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, type MapId } from '@lions/data';
import { DECOR_RIDGE } from '@lions/render/terrain';

const MAP_IDS = Object.keys(maps) as MapId[];

function load(id: MapId): { sim: Sim; decor: Uint8Array | null } {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20261015, width: parsed.width, height: parsed.height, capacity: 64 });
  applyTerrain(parsed, sim);
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsed.structures) {
    const t = typeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  return { sim, decor: parsed.decor };
}

/** `^` tiles the draw mask would NOT terrace: unblocked, or under a structure. */
function unterracedRidges(
  decor: Uint8Array | null,
  blocked: Uint8Array,
  width: number,
  structureAt: (x: number, y: number) => number
): number[] {
  const out: number[] = [];
  if (!decor) return out;
  for (let t = 0; t < decor.length; t++) {
    if (decor[t] !== DECOR_RIDGE) continue;
    if (blocked[t] === 0 || structureAt(t % width, Math.floor(t / width)) >= 0) out.push(t);
  }
  return out;
}

describe('every shipped ^ tile is terraced by the draw mask', () => {
  let ridgeTiles = 0;
  it.each(MAP_IDS)('%s', (id) => {
    const { sim, decor } = load(id);
    if (decor) for (const d of decor) if (d === DECOR_RIDGE) ridgeTiles++;
    expect(unterracedRidges(decor, sim.blocked, sim.width, (x, y) => sim.structureAt(x, y))).toEqual([]);
  });

  it('is not vacuous: the shipped maps carry ridge tiles, and the check catches an unblocked one', () => {
    expect(ridgeTiles).toBeGreaterThan(100);
    const { sim, decor } = load('tel_marum');
    const blocked = new Uint8Array(sim.blocked);
    const t = (decor as Uint8Array).indexOf(DECOR_RIDGE);
    blocked[t] = 0;
    expect(unterracedRidges(decor, blocked, sim.width, (x, y) => sim.structureAt(x, y))).toEqual([t]);
  });
});
