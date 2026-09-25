/**
 * Task 12 fix round 2 (review finding 1a): a ground decal reproduces its own
 * approved colour on EVERY surface of a green map, not just on open grass.
 *
 * Decals are albedo ratios multiplied onto the lit ground
 * (`packages/render/src/three/decal-pool.ts`, `decalMultiplier`). At alpha 1
 * the result is `drawn * decal / local`, which is the decal's own colour only
 * when `local` (the denominator captured at the stamp,
 * `terrain/decal-ground-tone.ts`) equals `drawn` (what the ground shader
 * actually composes there). Dividing by the map's `open` tone everywhere
 * drew a crater lip salmon and a tyre print red on a green map's road.
 *
 * `drawn` is rebuilt here the way `GroundMaterial` builds it -- the tile
 * top's vertex tone, then the road surface and shoulder mixed in from the
 * CONTROL MAP's own bytes, bilinearly sampled at 8 texels a tile and decoded
 * as the shader decodes them -- so it is an independent reading of the road,
 * not a second call to the function under test. The albedo images and the
 * macro field are ratio fields with mean 1 and are left out of both sides
 * (see `decal-ground-tone.ts`).
 *
 * This lives in `tools/` because it needs a real green map and the real green
 * theme, and `@lions/render` may not import `@lions/data` or `@lions/app`.
 */
import { describe, expect, it } from 'vitest';
import { maps, paletteColor, parseMap } from '@lions/data';
import { TERRAIN_THEMES } from '../../packages/app/src/terrain-themes';
import { decalGroundTone, type DecalGroundSource } from '../../packages/render/src/three/terrain/decal-ground-tone';
import { tileBaseToneHex } from '../../packages/render/src/three/terrain/ground';
import {
  buildControlMap,
  CONTROL_TEXELS_PER_TILE,
  ROAD_DISTANCE_RANGE_TILES,
} from '../../packages/render/src/three/terrain/control-map';
import { buildRoadGraph, roadProfile } from '../../packages/render/src/three/terrain/road-graph';
import { hexToLinear } from '../../packages/render/src/three/terrain/shared';
import type { TerrainInput } from '../../packages/render/src/three/terrain/types';
import { decalMultiplier } from '../../packages/render/src/three/decal-pool';

type Rgb = [number, number, number];

const map = parseMap(maps.wadi_halam_basin);
const tones = TERRAIN_THEMES.green;
const background = paletteColor('shadow.1');
const shoulder = paletteColor('limestone.2');
const input: TerrainInput = {
  width: map.width,
  height: map.height,
  decor: map.decor,
  elevation: map.elevation,
  blocked: map.blocked,
  cover: map.cover,
};
const src: DecalGroundSource = { input, tones, background, shoulder, graph: buildRoadGraph(input) };
const control = buildControlMap(input);

/** Control B at world point (x, z), bilinear over texel centres like the GPU,
 *  as floats in [0, 1]. */
function controlB(x: number, z: number): [number, number, number, number] {
  const N = CONTROL_TEXELS_PER_TILE;
  const fx = x * N - 0.5;
  const fz = z * N - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const tx = fx - i0;
  const tz = fz - j0;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const [di, dj, w] of [
    [0, 0, (1 - tx) * (1 - tz)],
    [1, 0, tx * (1 - tz)],
    [0, 1, (1 - tx) * tz],
    [1, 1, tx * tz],
  ] as const) {
    const i = Math.min(control.width - 1, Math.max(0, i0 + di));
    const j = Math.min(control.height - 1, Math.max(0, j0 + dj));
    for (let c = 0; c < 4; c++) out[c] += (w * control.b[(j * control.width + i) * 4 + c]) / 255;
  }
  return out;
}

/** What `GroundMaterial` holds in `diffuseColor` at (x, z), before the albedo
 *  and macro ratio fields: `GROUND_BLEND_GLSL`'s road mix, transcribed. */
function drawn(x: number, z: number): Rgb {
  const ti = Math.floor(z) * input.width + Math.floor(x);
  const base = hexToLinear(tileBaseToneHex(input, tones, ti, background));
  const b = controlB(x, z);
  const p = roadProfile(b[1] * ROAD_DISTANCE_RANGE_TILES, b[3] * 2 - 1, ROAD_DISTANCE_RANGE_TILES);
  const road = hexToLinear(tones.road);
  const sh = hexToLinear(shoulder);
  return [0, 1, 2].map((c) => {
    const r = base[c] + (road[c] - base[c]) * p.surface;
    return r + (sh[c] - r) * p.shoulder;
  }) as Rgb;
}

// Tiles read off `data/maps/wadi_halam_basin.json`'s rows: row 34 is an
// east-west road (x = 13..33), row 17 x = 13..23 is cover `1`, and (40, 5) is
// open grass well clear of anything.
const SURFACES: readonly { name: string; x: number; z: number }[] = [
  { name: 'road centre', x: 20.5, z: 34.5 },
  { name: 'road shoulder', x: 20.5, z: 35.0 },
  { name: 'cover', x: 15.5, z: 17.5 },
  { name: 'open', x: 40.5, z: 5.5 },
];

/** The decal kinds whose colours sit furthest from grass: the pale lip, the
 *  tyre, the dark bowl, and the tread (which is the theme's rut tone). */
const DECALS: readonly { name: string; hex: string }[] = [
  { name: 'crater lip (limestone.1)', hex: paletteColor('limestone.1') },
  { name: 'tyre (limestone.6)', hex: paletteColor('limestone.6') },
  { name: 'crater bowl (shadow.0)', hex: paletteColor('shadow.0') },
  { name: 'tread (rut)', hex: tones.rut },
];

describe('a decal on a green map is its own colour on every surface (fix round 2)', () => {
  it('reads a road tone on the road, a shoulder at its edge, and grass off it', () => {
    // The precondition: the four surfaces really are different grounds, or
    // the test below could pass with the open-only divisor.
    const road = drawn(20.5, 34.5);
    const open = drawn(40.5, 5.5);
    expect(Math.abs(road[0] - open[0]) + Math.abs(road[1] - open[1])).toBeGreaterThan(0.05);
    expect(drawn(20.5, 35.0)).not.toEqual(road);
  });

  for (const s of SURFACES) {
    it(`captures the ground the shader draws on ${s.name}`, () => {
      const local = decalGroundTone(src, s.x, s.z);
      const d = drawn(s.x, s.z);
      for (let c = 0; c < 3; c++) expect(local[c], `channel ${c}`).toBeCloseTo(d[c], 2);
    });
    for (const k of DECALS) {
      it(`draws ${k.name} at alpha 1 on ${s.name} as the approved colour`, () => {
        const want = hexToLinear(k.hex);
        const got = decalMultiplier(want, decalGroundTone(src, s.x, s.z), 1).map((m, c) => drawn(s.x, s.z)[c] * m);
        // Within rounding: the control map's 8 bits and 8 texels a tile, as
        // bytes after the sRGB encode (the 1/255 a display can show).
        for (let c = 0; c < 3; c++) {
          const enc = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
          expect(Math.abs(enc(got[c]) - enc(want[c])), `channel ${c}`).toBeLessThanOrEqual(1);
        }
      });
    }
  }
});
