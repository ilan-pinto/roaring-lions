/**
 * The rescale pass: scale a vehicle GLB (or its kit source) uniformly about
 * the origin, in place, by its `RESCALE_FACTORS` entry.
 *
 *     pnpm rescale:meshes -- --id=mbt_lavi --id=officer_armour --kit=mbt_lavi
 *
 * `--id=` rewrites `art/meshes/vehicles/<id>.glb`, `--kit=` rewrites
 * `art/parts/kit/<id>.glb`. See `rescale-contract.ts` for why the Lavi needs
 * it and where it sits in the pipeline.
 *
 * A similarity transform, so it touches only what carries a length: every
 * POSITION accessor (each once, however many primitives share it -- the wreck
 * twins share their live meshes), morph-target positions, every node's
 * translation and every translation animation channel, the `_RL_TRACK`
 * per-vertex metres (contract v7; -1 stays -1) and the running-gear extras'
 * lengths. Normals, UVs, rotations, materials and images are untouched, and
 * the ground stays at y = 0 because the origin is on it.
 *
 * NOT idempotent, on purpose: scaling is not a fixed point, so a second run
 * would grow the tank again. The pass writes `extras.rl_rescale` and REFUSES a
 * file that already carries one.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Accessor, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { RG_EXTRAS_KEY, RG_NOT_TRACK, RG_TRACK_ATTR } from './running-gear-contract';
import { RESCALE_EXTRAS_KEY, RESCALE_FACTORS } from './rescale-contract';
export { rescaleMark } from './rescale-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');
const KIT_SOURCES = path.join(REPO, 'art', 'parts', 'kit');

export interface RescaleReport {
  readonly positions: number;
  readonly nodes: number;
  readonly trackAccessors: number;
}

function scaleAccessor(a: Accessor, f: number, keep?: (v: number) => boolean): void {
  const arr = a.getArray();
  if (!arr) throw new Error(`accessor "${a.getName()}" has no array`);
  if (a.getNormalized() || !(arr instanceof Float32Array)) {
    throw new Error(`accessor "${a.getName()}" is not plain float -- quantised geometry is not handled here`);
  }
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = keep && !keep(arr[i]) ? arr[i] : arr[i] * f;
  a.setArray(out);
}

/** The running-gear extras' lengths, scaled; pitch rides along, so the file
 *  is still a whole number of bars per loop (the running-gear pass then
 *  re-derives the pitch from the nominal 0.3 m). */
function scaleRunningGear(rg: Record<string, unknown>, f: number): Record<string, unknown> {
  const wheels = (rg.wheels as Record<string, unknown>[] | undefined) ?? [];
  const tracks = (rg.tracks as Record<string, unknown>[] | undefined) ?? [];
  return {
    ...rg,
    wheels: wheels.map((w) => ({
      ...w,
      centre: (w.centre as number[]).map((c) => c * f),
      radius: (w.radius as number) * f,
      cutRadius: (w.cutRadius as number) * f,
    })),
    tracks: tracks.map((t) => ({
      ...t,
      loopLength: (t.loopLength as number) * f,
      pitch: (t.pitch as number) * f,
      gauge: (t.gauge as number) * f,
    })),
  };
}

export function applyRescale(doc: Document, factor: number, what: string): RescaleReport {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new Error(`${what}: bad factor ${factor}`);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  if (!scene) throw new Error(`${what}: no scene`);
  const extras = { ...(scene.getExtras() as Record<string, unknown>) };
  if (extras[RESCALE_EXTRAS_KEY] !== undefined) {
    throw new Error(
      `${what}: already rescaled (extras.${RESCALE_EXTRAS_KEY} = ${JSON.stringify(extras[RESCALE_EXTRAS_KEY])}) -- ` +
        `start from a fresh export, never rescale twice`
    );
  }

  const positions = new Set<Accessor>();
  const tracks = new Set<Accessor>();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const p = prim.getAttribute('POSITION');
      if (p) positions.add(p);
      const t = prim.getAttribute(RG_TRACK_ATTR);
      if (t) tracks.add(t);
      for (const target of prim.listTargets()) {
        const tp = target.getAttribute('POSITION');
        if (tp) positions.add(tp);
      }
    }
  }
  for (const a of tracks) if (positions.has(a)) throw new Error(`${what}: an accessor is both POSITION and ${RG_TRACK_ATTR}`);
  for (const a of positions) scaleAccessor(a, factor);
  for (const a of tracks) scaleAccessor(a, factor, (v) => v !== RG_NOT_TRACK);

  const nodes = root.listNodes();
  for (const n of nodes) {
    const [x, y, z] = n.getTranslation();
    n.setTranslation([x * factor, y * factor, z * factor]);
  }
  const animated = new Set<Accessor>();
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== 'translation') continue;
      const out = ch.getSampler()?.getOutput();
      if (out && !animated.has(out)) {
        animated.add(out);
        scaleAccessor(out, factor);
      }
    }
  }

  if (extras[RG_EXTRAS_KEY] !== undefined) {
    extras[RG_EXTRAS_KEY] = scaleRunningGear(extras[RG_EXTRAS_KEY] as Record<string, unknown>, factor);
  }
  extras[RESCALE_EXTRAS_KEY] = { factor };
  scene.setExtras(extras);
  return { positions: positions.size, nodes: nodes.length, trackAccessors: tracks.size };
}

export interface RescaleTargets {
  readonly vehicles: readonly string[];
  readonly kits: readonly string[];
}

export function parseRescaleArgs(argv: readonly string[]): RescaleTargets {
  const vehicles: string[] = [];
  const kits: string[] = [];
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--(id|kit)=(.+)$/.exec(a);
    if (!m) throw new Error(`rescale:meshes: unknown argument ${a} (use --id=<vehicle> or --kit=<vehicle>)`);
    if (RESCALE_FACTORS[m[2]] === undefined) {
      throw new Error(`rescale:meshes: "${m[2]}" has no RESCALE_FACTORS entry (have ${Object.keys(RESCALE_FACTORS).join(', ')})`);
    }
    (m[1] === 'id' ? vehicles : kits).push(m[2]);
  }
  // No default: every file this pass touches is named, because a second run
  // over an unnamed default would be refused anyway and a first one would
  // rescale things nobody asked for.
  if (vehicles.length + kits.length === 0) throw new Error('rescale:meshes: name at least one --id= or --kit=');
  return { vehicles, kits };
}

export async function runRescalePass(targets: RescaleTargets): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const files = [
    ...targets.vehicles.map((id) => ({ id, file: path.join(VEHICLES, `${id}.glb`) })),
    ...targets.kits.map((id) => ({ id, file: path.join(KIT_SOURCES, `${id}.glb`) })),
  ];
  for (const { file } of files) if (!existsSync(file)) throw new Error(`rescale:meshes: no file at ${file}`);
  for (const { id, file } of files) {
    const doc = await io.read(file);
    const f = RESCALE_FACTORS[id];
    const r = applyRescale(doc, f, path.relative(REPO, file));
    await io.write(file, doc);
    console.log(
      `RESCALE_OK ${path.relative(REPO, file)} x${f}: ${r.positions} position accessor(s), ${r.nodes} node(s), ` +
        `${r.trackAccessors} track accessor(s)`
    );
  }
}

async function main(): Promise<number> {
  await runRescalePass(parseRescaleArgs(process.argv.slice(2)));
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
