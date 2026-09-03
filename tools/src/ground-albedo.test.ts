/**
 * The ground albedo table, checked against the images it describes.
 *
 * `mesh.ts`'s `GROUND_ALBEDOS` carries a mean colour per texture, and every
 * one of them is load-bearing arithmetic rather than documentation: the
 * shader divides the sampled texel by it, so a mean that drifts from its
 * file's real one stops open ground averaging to its `data/palette.json`
 * tone and puts a colour cast over the whole map that still looks like sand.
 * The old test asserted those numbers against three literals a human had
 * typed twice, which cannot catch a mean that was wrong when it was measured
 * or an image that was later re-exported.
 *
 * This one decodes the shipped PNGs and recomputes them.
 *
 * It lives in `tools/` rather than beside `mesh.ts` for one reason: `pngjs`
 * is a `tools` dependency and `packages/render` has no PNG decoder. The
 * table is therefore read the way this tree already reads across a boundary
 * it cannot import over -- by parsing the source, exactly as
 * `terrain/surface.test.ts` parses `TERRAIN_PALETTE_EXEMPTION` out of
 * `validate_assets.py` and `units/textured-building.test.ts` parses
 * `TEXTURED_MESH_EXEMPT` out of `validate_mesh_assets.py`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));

interface TableEntry {
  id: string;
  tiles: number;
  gain: number;
  mean: [number, number, number];
}

/** A tile is this many screen pixels wide at zoom 1 (`project.ts`'s
 *  `TILE_W`). The number the visibility check below is measured against. */
const TILE_PIXELS = 64;

/**
 * The least on-screen contrast a ground albedo may have and still be worth
 * sampling, as std/mean of the image box-filtered to its own size at zoom 1.
 *
 * 0.05 is not a round number picked for the look of it -- it sits in a gap
 * that was measured on this branch. `desert_sand_tile` reads 0.060 and is the
 * reference: it is the surface that was signed off on screen at gain 1.
 * `road_track_tile` at gain 1 reads 0.039, and that was photographed -- the
 * road drew as a FLAT tan band with fully-rippled sand beside it, because its
 * wheel track is a 1.9% lane/shoulder luminance delta plus grain, and grain
 * is exactly what a 16x minification averages away. Nothing else measured on
 * this branch falls between the two.
 */
const MIN_VISIBLE_CONTRAST = 0.05;

/** Every `id: { tiles: N, mean: [r, g, b] },` line of `GROUND_ALBEDOS`. */
function parseTable(): TableEntry[] {
  const src = readFileSync(root('packages/render/src/three/terrain/mesh.ts'), 'utf8');
  const block = /export const GROUND_ALBEDOS = \{([\s\S]*?)\n\} as const/.exec(src);
  expect(block, 'GROUND_ALBEDOS not found in terrain/mesh.ts').not.toBeNull();
  const out: TableEntry[] = [];
  const line =
    /^\s{2}([a-z0-9_]+):\s*\{\s*tiles:\s*([0-9.]+),\s*gain:\s*([0-9.]+),\s*mean:\s*\[([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\]\s*\},$/gm;
  for (const m of block![1].matchAll(line)) {
    out.push({
      id: m[1],
      tiles: Number(m[2]),
      gain: Number(m[3]),
      mean: [Number(m[4]), Number(m[5]), Number(m[6])],
    });
  }
  return out;
}

/** A PNG's own mean colour, in 0..255 bytes, over its RGB channels. */
function imageMean(path: string): [number, number, number] {
  const png = PNG.sync.read(readFileSync(path));
  let r = 0;
  let g = 0;
  let b = 0;
  const n = png.width * png.height;
  for (let i = 0; i < n; i++) {
    r += png.data[i * 4];
    g += png.data[i * 4 + 1];
    b += png.data[i * 4 + 2];
  }
  return [r / n, g / n, b / n];
}

const table = parseTable();

describe('the ground albedo table', () => {
  it('parses, and is not empty -- the regex above is the whole test otherwise', () => {
    // Without this, a table whose formatting drifted past the line regex
    // would produce zero entries and every `it.each` below would silently
    // run zero times: a green suite asserting nothing at all.
    expect(table.length).toBeGreaterThanOrEqual(6);
  });

  it.each(table)("$id's declared mean is the image's own", ({ id, mean }) => {
    const actual = imageMean(root(`assets/textures/${id}.png`));
    // 0.05 of a byte: the table carries one decimal place, so anything
    // looser would pass a mean that had been rounded from a different image.
    expect(actual[0]).toBeCloseTo(mean[0], 1);
    expect(actual[1]).toBeCloseTo(mean[1], 1);
    expect(actual[2]).toBeCloseTo(mean[2], 1);
  });

  it.each(table)('$id repeats over a positive number of tiles', ({ tiles }) => {
    expect(tiles).toBeGreaterThan(0);
  });

  it.each(table)('$id still has contrast left once minified to gameplay size', ({ id, tiles, gain }) => {
    // The defect this catches, measured: an image whose usable signal is
    // finer than one screen pixel at zoom 1 mips to its own mean, and the
    // surface draws as the flat palette tone it had before anyone wired a
    // texture to it -- with every uniform set, every mask correct, and
    // nothing at all to see. Photographed on the road at gain 1.
    const png = PNG.sync.read(readFileSync(root(`assets/textures/${id}.png`)));
    // Texels per screen pixel at zoom 1: the source spans `tiles` tiles, and
    // a tile is TILE_PIXELS wide.
    const minification = png.width / (tiles * TILE_PIXELS);
    const n = Math.max(1, Math.round(png.width / minification));
    const step = png.width / n;
    // Box-filter to that size in luminance, which is what the mip chain does.
    const cells = new Float64Array(n * n);
    const counts = new Float64Array(n * n);
    for (let y = 0; y < png.height; y++) {
      const cy = Math.min(n - 1, Math.floor(y / step));
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        const lum = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
        const c = cy * n + Math.min(n - 1, Math.floor(x / step));
        cells[c] += lum;
        counts[c] += 1;
      }
    }
    let sum = 0;
    for (let i = 0; i < cells.length; i++) {
      cells[i] /= counts[i];
      sum += cells[i];
    }
    const mean = sum / cells.length;
    let variance = 0;
    for (const v of cells) variance += (v - mean) ** 2;
    const contrast = (Math.sqrt(variance / cells.length) / mean) * gain;
    expect(
      contrast,
      `${id} mips to a flat tone at gameplay zoom (${contrast.toFixed(4)} < ${MIN_VISIBLE_CONTRAST}) -- raise its gain or shrink its repeat`
    ).toBeGreaterThan(MIN_VISIBLE_CONTRAST);
  });

  it('covers every texture the app actually asks the renderer for', () => {
    // The likeliest real bug this can catch: a typo, a rename, or a theme
    // added to `TERRAIN_GROUND_TEXTURE` whose image nobody shipped. The
    // renderer REFUSES a URL the table does not name (it warns and leaves
    // the surface flat), so the symptom on screen is a surface that never
    // got its material and nothing anywhere saying why.
    const ids = new Set(table.map((e) => e.id));
    const asked = new Set<string>();
    const main = readFileSync(root('packages/app/src/main.ts'), 'utf8');
    for (const m of main.matchAll(/textures\/([a-z0-9_]+)\.png/g)) asked.add(m[1]);
    const themes = readFileSync(root('packages/app/src/terrain-themes.ts'), 'utf8');
    const themeBlock = /TERRAIN_GROUND_TEXTURE[^=]*= \{([\s\S]*?)\};/.exec(themes);
    expect(themeBlock, 'TERRAIN_GROUND_TEXTURE not found').not.toBeNull();
    for (const m of themeBlock![1].matchAll(/'([a-z0-9_]+)'/g)) asked.add(m[1]);
    // Both halves have to be found, or this passes by looking at nothing.
    expect(asked.size, 'found no texture names in main.ts / terrain-themes.ts').toBeGreaterThanOrEqual(6);
    for (const id of asked) expect(ids, `main.ts asks for ${id}, which no GROUND_ALBEDOS entry names`).toContain(id);
  });

  it('names every PNG in assets/textures/, and no PNG it does not ship', () => {
    // Both directions, and the first is the one that matters: a texture
    // added to `assets/textures/` with no table entry is a file the renderer
    // will refuse to bind, which reads on screen as a surface that never got
    // its material -- with nothing anywhere saying why.
    const onDisk = readdirSync(root('assets/textures'))
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, ''))
      .sort();
    expect(table.map((e) => e.id).sort()).toEqual(onDisk);
  });
});
