/**
 * The Wadi Halam backdrop kit never covers the playable lozenge (GH-161), at
 * any zoom, on every shipped map that carries a `backdrop` block.
 *
 * What is checked is the PLACED kit: the shipped GLB's own bytes
 * (`art/meshes/backdrop/wadi_halam_kit.glb`), the map's committed piece list,
 * the real elevation grid through the renderer's own ground surface, and the
 * renderer's own floor -- `placeKit`, the call `buildBackdrop` draws from. Not
 * a model of it.
 *
 * ## Why one geometric check covers zoom 0.35, 1 and 2.5
 *
 * The camera is orthographic (30 degrees down, along (+1, +1)), so a point
 * hides whatever lies behind it along a fixed ray; zoom changes only how much
 * of the world a frame shows. A point that hides no map ground hides none at
 * any zoom. The zoom-specific part is whether a frame REACHES the backdrop at
 * all (at zoom 1 and 2.5 the camera is panned to the rim), which is a capture
 * question, not a geometric one -- `wadi-look/capture.ts` frames all three.
 *
 * ## Falsification, run and watched
 *
 * `pushed 2 tiles inward` below is the check going red on a shipped piece
 * moved into the map. The numbers in the commit message that adds this file
 * are from the same mutation applied to the map JSON by hand.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { maps, parseMap, type MapJson } from '@lions/data';
import { groundWorldY } from '../../packages/render/src/three/ground-height';
import { terrainSurfaceFrom } from '../../packages/render/src/three/terrain/surface';
import { placeKit, type BackdropSpec } from '../../packages/render/src/three/terrain/backdrop';
import { lozengeIntrusions, type Intrusion } from '../../packages/render/src/three/terrain/backdrop-lozenge';
import { readKitFixture } from '../../packages/render/src/three/terrain/backdrop-kit-fixture';

const kit = readKitFixture();

function rimOf(map: ReturnType<typeof parseMap>): (x: number, z: number) => number {
  const surf = terrainSurfaceFrom(map.elevation, map.blocked, map.width, map.height);
  const { width: w, height: h } = map;
  // `ThreeRenderer.syncBackdrop`'s own rim: the drawn ground, clamped a hair inside the rectangle.
  return (x, z) => groundWorldY(surf, w, h, Math.min(w - 0.01, Math.max(0.01, x)), Math.min(h - 0.01, Math.max(0.01, z)));
}

/** The kit at full detail AND its LOD1 twins (what is drawn below zoom 0.6): both must clear the lozenge. */
function intrusions(map: ReturnType<typeof parseMap>, spec: BackdropSpec): Intrusion[] {
  const { placed } = placeKit(spec, kit, rimOf(map), map.width, map.height);
  const rim = rimOf(map);
  return [
    ...lozengeIntrusions(placed, rim, map.width, map.height),
    ...lozengeIntrusions({ ...placed, positions: placed.lod1.positions, olives: [], houses: [] }, rim, map.width, map.height),
  ];
}

const withBlocks = Object.entries(maps as Record<string, MapJson>).filter(([, m]) => m.backdrop !== undefined);

describe('the backdrop never covers the playable lozenge', () => {
  it('the census is not vacuous: Wadi Halam IV carries a block, and it places a real kit', () => {
    expect(withBlocks.map(([id]) => id)).toContain('wadi_halam_4');
    const map = parseMap(maps.wadi_halam_4 as MapJson);
    const { placed } = placeKit(map.backdrop as BackdropSpec, kit, rimOf(map), map.width, map.height);
    expect(placed.pieces).toBeGreaterThan(40);
    expect(placed.triangles).toBeGreaterThan(100_000);
    expect(placed.triangles).toBeLessThanOrEqual(250_000); // the kit-spec budget
  });

  for (const [id, json] of withBlocks) {
    it(`${id}: nothing stands above the ground inside the rectangle, and nothing on a near side stands above the camera's line to it`, () => {
      const map = parseMap(json);
      const bad = intrusions(map, map.backdrop as BackdropSpec);
      const sample = bad
        .slice(0, 6)
        .map((b) => `${b.kind}/${b.what} at (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) y ${b.y.toFixed(2)} over by ${b.over.toFixed(3)}`);
      expect(bad.length, `${bad.length} intrusion(s), e.g. ${sample.join('; ')}`).toBe(0);
    });
  }

  it('is red when a shipped piece is pushed 2 tiles inward (west wall, then south slope)', () => {
    const map = parseMap(maps.wadi_halam_4 as MapJson);
    const spec = map.backdrop as BackdropSpec;
    // Push the first west wall 2 tiles toward the map centre (+x), and a south slope 2 tiles up (-z).
    const west = spec.pieces.findIndex((p) => p.id.startsWith('bd_wall_far') && p.rot === 0);
    const south = spec.pieces.findIndex((p) => p.id.startsWith('bd_slope_near') && p.rot === 270);
    expect(west).toBeGreaterThanOrEqual(0);
    expect(south).toBeGreaterThanOrEqual(0);
    for (const [k, dx, dz, kind] of [
      [west, 2, 0, 'inside'],
      [south, 0, -2, 'hard'],
    ] as const) {
      const pushed: BackdropSpec = {
        ...spec,
        pieces: spec.pieces.map((p, i) => (i === k ? { ...p, at: [p.at[0] + dx, p.at[1] + dz] as [number, number] } : p)),
      };
      const bad = intrusions(map, pushed);
      expect(bad.length, `${spec.pieces[k].id} pushed (${dx}, ${dz})`).toBeGreaterThan(0);
      expect(bad.some((b) => b.kind === kind || (kind === 'hard' && b.kind === 'design')), `a ${kind} intrusion`).toBe(true);
    }
  });

  it('is red when ONLY the LOD1 twin intrudes (the minimum-zoom mesh is checked too)', () => {
    const map = parseMap(maps.wadi_halam_4 as MapJson);
    const spec = map.backdrop as BackdropSpec;
    const { placed } = placeKit(spec, kit, rimOf(map), map.width, map.height);
    const lifted = Float32Array.from(placed.lod1.positions);
    for (let k = 1; k < lifted.length; k += 3) lifted[k] += 1; // every LOD1 vertex one tile up; the full mesh untouched
    const rim = rimOf(map);
    expect(lozengeIntrusions(placed, rim, map.width, map.height)).toEqual([]);
    expect(lozengeIntrusions({ ...placed, positions: lifted, olives: [], houses: [] }, rim, map.width, map.height).length).toBeGreaterThan(0);
  });

  it('is red when the kit is lifted: every piece 1 tile up breaks the near-side line', () => {
    const map = parseMap(maps.wadi_halam_4 as MapJson);
    const spec = map.backdrop as BackdropSpec;
    const lifted: BackdropSpec = { ...spec, pieces: spec.pieces.map((p) => ({ ...p, lift: (p.lift ?? 0) + 1 })) };
    expect(intrusions(map, lifted).filter((b) => b.kind === 'design' || b.kind === 'hard').length).toBeGreaterThan(0);
  });
});

describe('every piece id a map names is in the shipped kit', () => {
  for (const [id, json] of withBlocks) {
    it(`${id}`, () => {
      const map = parseMap(json);
      const spec = map.backdrop as BackdropSpec;
      for (const p of spec.pieces) expect(kit.pieces.has(p.id), `${id}: piece ${p.id}`).toBe(true);
      expect(kit.pieces.has('bd_olive')).toBe(true);
      const onDisk = JSON.parse(readFileSync(new URL(`../../data/maps/${id}.json`, import.meta.url), 'utf8')) as MapJson;
      expect(onDisk.backdrop?.kit).toBe('wadi_halam_kit');
    });
  }
});
