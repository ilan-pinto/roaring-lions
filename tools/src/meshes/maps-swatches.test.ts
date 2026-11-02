/**
 * L3 (GH-943): the kit's three swatches in the Lavi's maps, falsified. A kit part has no UVs of its own:
 * the kit pass pins every one onto one of three texels of the bake, so it draws whatever the normal and
 * ORM maps hold there. Each mutation of a SCRATCH copy of the shipped Lavi must turn the real Python
 * check (`validate_mesh_assets.check_kit_swatches`) red, and the unmutated copy must stay green.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { MAPS_EXTRAS_KEY } from './maps-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LAVI = path.join(REPO, 'art', 'meshes', 'vehicles', 'mbt_lavi.glb');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-maps-swatch-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Swatch {
  uv: [number, number];
  texel: [number, number];
  window: number;
}

let n = 0;
/** A scratch dir holding the Lavi with its maps mutated; returns the check's failure lines. */
async function check(mutate?: (orm: PNG, normal: PNG, swatches: Record<string, Swatch>, extras: Record<string, unknown>) => void): Promise<string[]> {
  const dir = path.join(scratch, `v${n++}`);
  mkdirSync(dir, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(LAVI);
  const mat = doc.getRoot().listMaterials()[0]!;
  const ormTex = mat.getOcclusionTexture()!;
  const nrmTex = mat.getNormalTexture()!;
  const orm = PNG.sync.read(Buffer.from(ormTex.getImage()!));
  const normal = PNG.sync.read(Buffer.from(nrmTex.getImage()!));
  const scene = doc.getRoot().listScenes()[0]!;
  const extras = scene.getExtras() as Record<string, Record<string, unknown>>;
  const maps = extras[MAPS_EXTRAS_KEY]!;
  mutate?.(orm, normal, maps.swatches as Record<string, Swatch>, maps);
  ormTex.setImage(PNG.sync.write(orm));
  nrmTex.setImage(PNG.sync.write(normal));
  scene.setExtras({ ...extras, [MAPS_EXTRAS_KEY]: maps });
  await io.write(path.join(dir, 'mbt_lavi.glb'), doc);
  const code =
    'import sys, json\n' +
    `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\n` +
    'sys.argv = ["x"]\n' +
    'import validate_mesh_assets as v\n' +
    `f, lines = v.check_kit_swatches(${JSON.stringify(dir)})\n` +
    'print(json.dumps({"failures": f, "lines": lines}))\n';
  const r = spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!) as { failures: string[]; lines: string[] };
  expect(out.lines.length + out.failures.length).toBeGreaterThan(0); // it really read the Lavi
  return out.failures;
}

const set = (png: PNG, x: number, y: number, rgba: [number, number, number, number]): void => {
  const o = (y * png.width + x) * 4;
  for (let c = 0; c < 4; c++) png.data[o + c] = rgba[c]!;
};

describe('the kit swatches in the maps', () => {
  it('the shipped Lavi passes: three flat, unmasked swatches', async () => {
    expect(await check()).toEqual([]);
  }, 60_000);

  it('alpha 0 (a team texel) at ONE kit UV fails', async () => {
    const f = await check((orm, _n, sw) => {
      const [x, y] = sw.metal!.texel;
      set(orm, x, y, [255, orm.data[(y * orm.width + x) * 4 + 1]!, orm.data[(y * orm.width + x) * 4 + 2]!, 0]);
    });
    expect(f.join('\n')).toMatch(/kit swatch 'metal'.*team mask \(alpha != 255\)/);
  }, 60_000);

  it('a dent in the normal map under a swatch fails', async () => {
    const f = await check((_o, normal, sw) => {
      const [x, y] = sw.paint!.texel;
      set(normal, x + 3, y - 2, [200, 60, 180, 255]);
    });
    expect(f.join('\n')).toMatch(/kit swatch 'paint'.*the normal is not flat/);
  }, 60_000);

  it('roughness that is not the declared class value fails', async () => {
    const f = await check((orm, _n, sw) => {
      const [x, y] = sw.dark!.texel;
      const o = (y * orm.width + x) * 4;
      set(orm, x, y, [255, 10, orm.data[o + 2]!, 255]);
    });
    expect(f.join('\n')).toMatch(/kit swatch 'dark'.*roughness is not/);
  }, 60_000);

  it('a kit part pinned where no swatch is declared fails', async () => {
    const f = await check((_o, _n, sw, maps) => {
      delete sw.dark;
      void maps;
    });
    expect(f.join('\n')).toMatch(/a kit part is pinned at uv .* no declared swatch covers/);
  }, 60_000);

  it('an ORM alpha that is not binary fails', async () => {
    const f = await check((orm) => {
      set(orm, 10, 10, [255, 200, 0, 128]);
    });
    expect(f.join('\n')).toMatch(/ORM alpha is not binary/);
  }, 60_000);
});
