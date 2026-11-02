/**
 * The mark pass: give a vehicle GLB its team mark.
 *
 *     pnpm mark:meshes -- --id=mbt_lavi --id=mbt_lavi_camo --id=officer_armour
 *
 * It runs `tools/vehicles/lavi_mark.py` for the vehicle (its own boxes, the covered share and the bake's luma under them), writes
 * `material.extras.rl_team_mark` and a scene marker, and DROPS whatever normal, metallic-roughness and occlusion
 * textures the export carried (a Meshy export's are flat: 89% of normal texels tilt under 0.05). The GLB goes
 * back to carrying its base colour alone. See `mark-contract.ts` for what the mark is.
 *
 * Not idempotent, on purpose, like the rescale pass: it refuses a file that is already marked, not rescaled,
 * with no running gear, or already kitted or wrecked (it measures the host meshes alone).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { isKitName } from './kit-contract';
import { RG_EXTRAS_KEY } from './running-gear-contract';
import { RESCALE_EXTRAS_KEY, RESCALE_FACTORS, rescaleMark } from './rescale-contract';
import { MARK_EXTRAS_KEY, MARK_RECIPES, MARK_SCENE_KEY, MARK_VERSION, TEAM_FRACTION_BAND, type TeamMark } from './mark-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');

/** What the measurement hands the pass. */
export interface MarkMeasure {
  readonly mark: {
    readonly roof: TeamMark['roof'];
    readonly band: TeamMark['band'];
    readonly exclude_uv: TeamMark['exclude_uv'];
    readonly exclude_radius: number;
  };
  readonly luma: number;
  readonly team_fraction: number;
  readonly team_fraction_basis?: 'texel' | 'triangle';
  readonly team_area_m2: number;
  readonly surface_area_m2: number;
}

export interface MarkReport {
  readonly id: string;
  readonly teamFraction: number;
  readonly luma: number;
  readonly droppedTextures: number;
}

function preconditions(doc: Document, id: string): void {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${id}: no scene`);
  const extras = scene.getExtras() as Record<string, unknown>;
  if (extras[MARK_SCENE_KEY] !== undefined) {
    throw new Error(`${id}: already carries extras.${MARK_SCENE_KEY} -- start from a fresh export, never run the mark pass twice`);
  }
  const want = RESCALE_FACTORS[id];
  if (want !== undefined && rescaleMark(doc) !== want) {
    throw new Error(`${id}: not rescaled (extras.${RESCALE_EXTRAS_KEY}) -- the mark's boxes are in the shipped frame`);
  }
  if (extras[RG_EXTRAS_KEY] === undefined) throw new Error(`${id}: no extras.${RG_EXTRAS_KEY} -- run pnpm running-gear:meshes first`);
  const late = doc
    .getRoot()
    .listNodes()
    .filter((n) => isKitName(n.getName()) || n.getName() === 'death_root');
  if (late.length > 0) throw new Error(`${id}: already carries ${late.map((n) => n.getName()).join(', ')} -- the mark pass comes BEFORE kit and wreck`);
}

function theMaterial(doc: Document, id: string): Material {
  const mats = doc.getRoot().listMaterials();
  if (mats.length !== 1) throw new Error(`${id}: expected exactly one material, found ${mats.length}`);
  if (!mats[0].getBaseColorTexture()) throw new Error(`${id}: the material has no base colour texture`);
  return mats[0];
}

/** The pure half: write `measure` into `doc`. */
export function applyMark(doc: Document, id: string, measure: MarkMeasure): MarkReport {
  preconditions(doc, id);
  const material = theMaterial(doc, id);
  const [lo, hi] = TEAM_FRACTION_BAND;
  if (!(measure.team_fraction >= lo && measure.team_fraction <= hi)) {
    throw new Error(`${id}: the mark covers ${(measure.team_fraction * 100).toFixed(2)}% of the surface, outside ${lo * 100}-${hi * 100}%`);
  }
  if (!(measure.luma > 0)) throw new Error(`${id}: the bake under the mark measured luma ${measure.luma}`);

  const base = material.getBaseColorTexture();
  let dropped = 0;
  for (const t of new Set([material.getNormalTexture(), material.getMetallicRoughnessTexture(), material.getOcclusionTexture(), material.getEmissiveTexture()])) {
    if (t && t !== base) {
      t.dispose();
      dropped++;
    }
  }
  const mark: TeamMark = {
    version: MARK_VERSION,
    roof: measure.mark.roof,
    band: measure.mark.band,
    exclude_uv: measure.mark.exclude_uv,
    exclude_radius: measure.mark.exclude_radius,
    luma: measure.luma,
    team_fraction: measure.team_fraction,
    ...(measure.team_fraction_basis ? { team_fraction_basis: measure.team_fraction_basis } : {}),
  };
  material.setExtras({ ...(material.getExtras() as Record<string, unknown>), [MARK_EXTRAS_KEY]: mark });
  const scene = doc.getRoot().listScenes()[0];
  scene.setExtras({ ...(scene.getExtras() as Record<string, unknown>), [MARK_SCENE_KEY]: { version: MARK_VERSION } });
  return { id, teamFraction: measure.team_fraction, luma: measure.luma, droppedTextures: dropped };
}

export function measureMark(id: string, glbPath: string): MarkMeasure {
  const recipe = MARK_RECIPES[id];
  if (!recipe) throw new Error(`mark:meshes: no recipe for "${id}" (have ${Object.keys(MARK_RECIPES).join(', ')})`);
  const argv = [path.join(REPO, recipe.script), '--id', id, '--glb', glbPath];
  if (recipe.kit !== null) argv.push('--kit', path.join(REPO, recipe.kit));
  const run = spawnSync('python3', argv, {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  if (run.status !== 0) throw new Error(`${recipe.script} failed (${run.status}):\n${run.stderr || run.stdout}`);
  return JSON.parse(run.stdout.trim().split('\n').pop() as string) as MarkMeasure;
}

export function parseMarkArgs(argv: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--id=(.+)$/.exec(a);
    if (!m) throw new Error(`mark:meshes: unknown argument ${a} (use --id=<vehicle>)`);
    if (!MARK_RECIPES[m[1]]) throw new Error(`mark:meshes: no recipe for "${m[1]}" (have ${Object.keys(MARK_RECIPES).join(', ')})`);
    ids.push(m[1]);
  }
  if (ids.length === 0) throw new Error('mark:meshes: name at least one --id=');
  return ids;
}

export async function runMarkPass(ids: readonly string[], dir: string = VEHICLES): Promise<MarkReport[]> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const out: MarkReport[] = [];
  for (const id of ids) {
    const file = path.join(dir, `${id}.glb`);
    if (!existsSync(file)) throw new Error(`mark:meshes: no file at ${file}`);
    const doc = await io.read(file);
    preconditions(doc, id);
    const report = applyMark(doc, id, measureMark(id, file));
    await io.write(file, doc);
    out.push(report);
    console.log(
      `MARK_OK ${id}: team mark ${(report.teamFraction * 100).toFixed(2)}% of the surface, bake luma ${report.luma}, ${report.droppedTextures} flat texture(s) dropped`
    );
  }
  return out;
}

async function main(): Promise<number> {
  await runMarkPass(parseMarkArgs(process.argv.slice(2)));
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
