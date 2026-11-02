/**
 * The maps pass: give a vehicle GLB an AUTHORED normal map and an occlusion-roughness-metal
 * (ORM) map whose inverted alpha carries the team-colour mask.
 *
 *     pnpm maps:meshes -- --id=mbt_lavi
 *
 * Pipeline position (order load-bearing, `maps-contract.ts`): export -> rescale ->
 * running-gear -> MAPS -> kit -> wreck -> damage -> encode.
 *
 * The detail is a TABLE (`tools/vehicles/lavi_maps.py`): seams, welds, bolts, dents and wear
 * evaluated in numpy at each texel's 3D position, with hand-rolled seeded noise, never
 * `mathutils.noise`. This pass runs it, replaces whatever normal and metal-roughness textures
 * the export carried (Meshy's are flat: 89% of normal texels tilt under 0.05) with the
 * generated PNGs, points `occlusionTexture` and `metallicRoughnessTexture` at the SAME
 * texture (one upload), and stamps:
 *
 *   - `material.extras.rl_orm`        the maps are authored (the runtime keeps both, roughness 1);
 *   - `material.extras.rl_team_luma`  mean linear luma of the base colour over the mask texels;
 *   - `scene.extras.rl_maps`          version, size, generator hash, team fraction, kit swatches.
 *
 * It is NOT idempotent, on purpose, like the rescale pass: it refuses a file that already
 * carries `rl_maps`, one that is already kitted or wrecked (the maps must come BEFORE the kit,
 * whose UVs they keep flat), one that has not been rescaled or run through running-gear, and
 * one whose base colour is not the size the maps are authored against.
 *
 * Why the alpha channel is INVERTED (255 = bake, 0 = team): a premultiply, or a PNG optimiser
 * that zeroes the colour of transparent texels, can then only damage the team band and never
 * the hull's roughness. `gltf-loader.ts` pins `premultiplyAlpha: 'none'`, and a test pins that.
 *
 * Not done here: Draco (`pnpm encode:meshes` mirrors `art/meshes/` afterwards, and does not
 * touch image bytes) and the wreck's `rl_bake_luma` (the wreck pass stamps it).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, TextureInfo, type Document, type Material, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { PNG } from 'pngjs';
import { decodeImage, meanLinearLuma } from './bake-luma';
import { isKitName } from './kit-contract';
import { RG_EXTRAS_KEY } from './running-gear-contract';
import { RESCALE_EXTRAS_KEY, RESCALE_FACTORS, rescaleMark } from './rescale-contract';
import {
  MAPS_EXTRAS_KEY,
  MAPS_RECIPES,
  MAPS_SIZE,
  MAPS_VERSION,
  ORM_EXTRAS_KEY,
  TEAM_FRACTION_BAND,
  TEAM_LUMA_KEY,
} from './maps-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');
/** The frame check's probe table, written beside the maps it was drawn from (`lavi-maps.test.ts`). */
export const PROBE_FIXTURES = path.join(REPO, 'tools', 'fixtures');
export const probeFixturePath = (id: string): string => path.join(PROBE_FIXTURES, `${id}-maps-probes.json`);

/** What the generator hands the pass. */
export interface GeneratedMaps {
  readonly normalPng: Uint8Array;
  readonly ormPng: Uint8Array;
  readonly report: {
    readonly size: number;
    readonly generator_sha256: string;
    readonly team_fraction: number;
    readonly team_area_m2: number;
    readonly surface_area_m2: number;
    readonly swatches: Record<string, unknown>;
    readonly probes: readonly unknown[];
  };
}

export interface MapsReport {
  readonly id: string;
  readonly size: number;
  readonly teamFraction: number;
  readonly teamLuma: number;
  readonly textures: number;
  readonly bytes: { readonly normal: number; readonly orm: number };
}

function livePreconditions(doc: Document, id: string): void {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${id}: no scene`);
  const extras = scene.getExtras() as Record<string, unknown>;
  if (extras[MAPS_EXTRAS_KEY] !== undefined) {
    throw new Error(
      `${id}: already carries extras.${MAPS_EXTRAS_KEY} -- start from a fresh export, never run the maps pass twice`
    );
  }
  const want = RESCALE_FACTORS[id];
  if (want !== undefined && rescaleMark(doc) !== want) {
    throw new Error(`${id}: not rescaled (extras.${RESCALE_EXTRAS_KEY}) -- the maps are computed on the shipped frame`);
  }
  if (extras[RG_EXTRAS_KEY] === undefined) {
    throw new Error(`${id}: no extras.${RG_EXTRAS_KEY} -- run pnpm running-gear:meshes first (it adds vertices the maps must cover)`);
  }
  const late = doc
    .getRoot()
    .listNodes()
    .filter((n) => isKitName(n.getName()) || n.getName() === 'death_root');
  if (late.length > 0) {
    throw new Error(`${id}: already carries ${late.map((n) => n.getName()).join(', ')} -- the maps pass comes BEFORE kit and wreck`);
  }
}

function theMaterial(doc: Document, id: string): Material {
  const mats = doc.getRoot().listMaterials();
  if (mats.length !== 1) throw new Error(`${id}: expected exactly one material, found ${mats.length}`);
  const m = mats[0];
  if (!m.getBaseColorTexture()) throw new Error(`${id}: the material has no base colour texture`);
  return m;
}

/** Mean linear luma of the base colour over the texels whose ORM alpha is 0. */
export function teamRegionLuma(basePixels: Uint8Array, ormRgba: Uint8Array): { luma: number; texels: number } {
  if (basePixels.length !== ormRgba.length) throw new Error('team luma: base colour and ORM are not the same size');
  const picked: number[] = [];
  for (let i = 0; i < ormRgba.length; i += 4) if (ormRgba[i + 3] === 0) picked.push(i);
  if (picked.length === 0) throw new Error('team luma: the ORM alpha has no team texel (A = 0)');
  const sub = new Uint8Array(picked.length * 4);
  picked.forEach((src, k) => sub.set(basePixels.subarray(src, src + 4), k * 4));
  return { luma: Math.round(meanLinearLuma(sub) * 1e5) / 1e5, texels: picked.length };
}

/** The pure half: install `maps` into `doc`. */
export function applyMaps(doc: Document, id: string, maps: GeneratedMaps): MapsReport {
  livePreconditions(doc, id);
  const material = theMaterial(doc, id);
  const r = maps.report;
  if (r.size !== MAPS_SIZE) throw new Error(`${id}: generator wrote ${r.size} px maps, the contract is ${MAPS_SIZE}`);
  const [lo, hi] = TEAM_FRACTION_BAND;
  if (!(r.team_fraction >= lo && r.team_fraction <= hi)) {
    throw new Error(`${id}: team mask covers ${(r.team_fraction * 100).toFixed(2)}% of the surface, outside ${lo * 100}-${hi * 100}%`);
  }

  const base = material.getBaseColorTexture() as Texture;
  const baseImage = base.getImage();
  if (!baseImage) throw new Error(`${id}: the base colour texture has no image`);
  const basePx = decodeImage(baseImage, base.getMimeType());
  if (basePx.width !== MAPS_SIZE || basePx.height !== MAPS_SIZE) {
    throw new Error(`${id}: base colour is ${basePx.width}x${basePx.height}, the maps are authored against ${MAPS_SIZE}`);
  }
  const orm = PNG.sync.read(Buffer.from(maps.ormPng));
  if (orm.width !== MAPS_SIZE || orm.height !== MAPS_SIZE) throw new Error(`${id}: the ORM PNG is ${orm.width}x${orm.height}`);
  const { luma, texels } = teamRegionLuma(basePx.data, new Uint8Array(orm.data));

  // Replace whatever the export carried (Meshy's flat maps), disposing what nothing else uses.
  const stale = [material.getNormalTexture(), material.getMetallicRoughnessTexture(), material.getOcclusionTexture()];
  const normal = doc.createTexture('normal').setImage(maps.normalPng).setMimeType('image/png');
  const ormTex = doc.createTexture('orm').setImage(maps.ormPng).setMimeType('image/png');
  material.setNormalTexture(normal).setMetallicRoughnessTexture(ormTex).setOcclusionTexture(ormTex);
  material.setRoughnessFactor(1).setMetallicFactor(1).setNormalScale(1).setOcclusionStrength(1);
  // ONE sampler on all three slots: `GLTFLoader` caches a texture by (image, sampler), so a slot with
  // a sampler of its own would upload the ORM map a second time. Mipmapped, repeat.
  for (const info of [material.getNormalTextureInfo(), material.getOcclusionTextureInfo(), material.getMetallicRoughnessTextureInfo()]) {
    info?.setMagFilter(TextureInfo.MagFilter.LINEAR).setMinFilter(TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR);
    info?.setWrapS(TextureInfo.WrapMode.REPEAT).setWrapT(TextureInfo.WrapMode.REPEAT);
  }
  for (const t of new Set(stale)) if (t && t !== normal && t !== ormTex && t !== base) t.dispose();

  material.setExtras({ ...(material.getExtras() as Record<string, unknown>), [ORM_EXTRAS_KEY]: true, [TEAM_LUMA_KEY]: luma });
  const scene = doc.getRoot().listScenes()[0];
  scene.setExtras({
    ...(scene.getExtras() as Record<string, unknown>),
    [MAPS_EXTRAS_KEY]: {
      version: MAPS_VERSION,
      size: r.size,
      generator_sha256: r.generator_sha256,
      team_fraction: r.team_fraction,
      team_texels: texels,
      swatches: r.swatches,
    },
  });
  return {
    id,
    size: r.size,
    teamFraction: r.team_fraction,
    teamLuma: luma,
    textures: doc.getRoot().listTextures().length,
    bytes: { normal: maps.normalPng.length, orm: maps.ormPng.length },
  };
}

/** Runs the generator on `glbPath` and reads its output back. */
export function generateMaps(id: string, glbPath: string): GeneratedMaps {
  const recipe = MAPS_RECIPES[id];
  if (!recipe) throw new Error(`maps:meshes: no recipe for "${id}" (have ${Object.keys(MAPS_RECIPES).join(', ')})`);
  const out = mkdtempSync(path.join(os.tmpdir(), `lions-maps-${id}-`));
  try {
    const run = spawnSync(
      'python3',
      [path.join(REPO, recipe.script), '--glb', glbPath, '--kit', path.join(REPO, recipe.kit), '--out', out],
      { encoding: 'utf8', maxBuffer: 1 << 26 }
    );
    if (run.status !== 0) throw new Error(`${recipe.script} failed (${run.status}):\n${run.stderr || run.stdout}`);
    const png = (f: string): Uint8Array => new Uint8Array(readFileSync(path.join(out, f)));
    return {
      normalPng: png('normal.png'),
      ormPng: png('orm.png'),
      report: JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) as GeneratedMaps['report'],
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

export function parseMapsArgs(argv: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--id=(.+)$/.exec(a);
    if (!m) throw new Error(`maps:meshes: unknown argument ${a} (use --id=<vehicle>)`);
    if (!MAPS_RECIPES[m[1]]) throw new Error(`maps:meshes: no recipe for "${m[1]}" (have ${Object.keys(MAPS_RECIPES).join(', ')})`);
    ids.push(m[1]);
  }
  // No default: a pass that rewrites every vehicle unasked is how a typo costs an afternoon.
  if (ids.length === 0) throw new Error('maps:meshes: name at least one --id=');
  return ids;
}

export async function runMapsPass(ids: readonly string[], dir: string = VEHICLES): Promise<MapsReport[]> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const out: MapsReport[] = [];
  for (const id of ids) {
    const file = path.join(dir, `${id}.glb`);
    if (!existsSync(file)) throw new Error(`maps:meshes: no file at ${file}`);
    const doc = await io.read(file);
    livePreconditions(doc, id); // refuse BEFORE the minutes of numpy
    const maps = generateMaps(id, file);
    const report = applyMaps(doc, id, maps);
    await io.write(file, doc);
    if (dir === VEHICLES) {
      mkdirSync(PROBE_FIXTURES, { recursive: true });
      writeFileSync(
        probeFixturePath(id),
        `${JSON.stringify({ id, size: maps.report.size, generator_sha256: maps.report.generator_sha256, probes: maps.report.probes })}\n`
      );
    }
    out.push(report);
    console.log(
      `MAPS_OK ${id}: ${report.size}px normal ${(report.bytes.normal / 1024).toFixed(0)} KiB + ORM ${(report.bytes.orm / 1024).toFixed(0)} KiB, ` +
        `team mask ${(report.teamFraction * 100).toFixed(2)}% (luma ${report.teamLuma}), ${report.textures} texture(s)`
    );
  }
  return out;
}

async function main(): Promise<number> {
  await runMapsPass(parseMapsArgs(process.argv.slice(2)));
  return 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
