/**
 * The team mark (L3, GH-943), held to the bytes that ship and to the pass that writes it.
 *
 * - The pass is not idempotent and its position in the pipeline is load-bearing: each way of running it out of
 *   order throws BEFORE the measurement.
 * - The shipped Lavi: an independent TS measurement of the boxes (per-triangle centroids, no UV, no python) must
 *   agree with the declared coverage; the mark rides the TURRET mesh, which turns on `turret_pivot`; and no
 *   texture but the base colour ships.
 * - `check_team_marks` (validate_mesh_assets.py) is falsified on scratch copies: a kit UV outside every
 *   exclusion pin, a coverage outside the band and a leftover map each turn it red.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARK_EXTRAS_KEY, MARK_SCENE_KEY, TEAM_FRACTION_BAND, type TeamMark } from './mark-contract';
import { applyMark, parseMarkArgs, type MarkMeasure } from './mark-pass';
import { RG_EXTRAS_KEY } from './running-gear-contract';
import { RESCALE_EXTRAS_KEY } from './rescale-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LAVI = path.join(REPO, 'art', 'meshes', 'vehicles', 'mbt_lavi.glb');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-mark-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const measure = (over: Partial<MarkMeasure> = {}): MarkMeasure => ({
  mark: {
    roof: { x: [-1.7, -0.4], z_half: 0.7, y: [2.28, 2.56], min_ny: 0.6 },
    band: { x: [-1.7, -0.4], y: [2.12, 2.3], min_nz: 0.6 },
    exclude_uv: [[0.28149, 0.21069], [0.26978, 0.26538], [0.86938, 0.82397]],
    exclude_radius: 0.0002,
  },
  luma: 0.17,
  team_fraction: 0.021,
  team_area_m2: 2.4,
  surface_area_m2: 114,
  ...over,
});

function docOf(extras: Record<string, unknown>, nodes: string[] = []): Document {
  const doc = new Document();
  doc.createBuffer();
  doc.createScene('s').setExtras(extras);
  for (const n of nodes) doc.createNode(n);
  const mat = doc.createMaterial('material');
  mat.setBaseColorTexture(doc.createTexture('base_color').setImage(new Uint8Array([1])).setMimeType('image/jpeg'));
  mat.setNormalTexture(doc.createTexture('normal').setImage(new Uint8Array([2])).setMimeType('image/jpeg'));
  mat.setMetallicRoughnessTexture(doc.createTexture('metallic_roughness').setImage(new Uint8Array([3])).setMimeType('image/jpeg'));
  return doc;
}
const good = { [RESCALE_EXTRAS_KEY]: { factor: 1.18 }, [RG_EXTRAS_KEY]: { version: 1 } };

describe('mark pass refusals', () => {
  it('refuses a file that is already marked, unrescaled, without running gear, or kitted or wrecked', () => {
    expect(() => applyMark(docOf({ ...good, [MARK_SCENE_KEY]: {} }), 'mbt_lavi', measure())).toThrow(/already carries/);
    expect(() => applyMark(docOf({ [RG_EXTRAS_KEY]: {} }), 'mbt_lavi', measure())).toThrow(/not rescaled/);
    expect(() => applyMark(docOf({ [RESCALE_EXTRAS_KEY]: { factor: 1.18 } }), 'mbt_lavi', measure())).toThrow(/running-gear/);
    expect(() => applyMark(docOf(good, ['kit_armour_1_turret_hull']), 'mbt_lavi', measure())).toThrow(/BEFORE kit and wreck/);
    expect(() => applyMark(docOf(good, ['death_root']), 'mbt_lavi', measure())).toThrow(/BEFORE kit and wreck/);
  });
  it('refuses a mark outside the approved 1.5-2.5% band, or one over a black bake', () => {
    expect(() => applyMark(docOf(good), 'mbt_lavi', measure({ team_fraction: 0.05 }))).toThrow(/outside 1\.5-2\.5%/);
    expect(() => applyMark(docOf(good), 'mbt_lavi', measure({ team_fraction: 0.001 }))).toThrow(/outside/);
    expect(() => applyMark(docOf(good), 'mbt_lavi', measure({ luma: 0 }))).toThrow(/luma/);
  });
  it('writes the mark, marks the scene and DROPS the flat textures, keeping the base colour', () => {
    const doc = docOf(good);
    const r = applyMark(doc, 'mbt_lavi', measure());
    expect(r.droppedTextures).toBe(2);
    const mat = doc.getRoot().listMaterials()[0]!;
    expect(doc.getRoot().listTextures().map((t) => t.getName())).toEqual(['base_color']);
    expect(mat.getNormalTexture()).toBeNull();
    const mark = (mat.getExtras() as Record<string, TeamMark>)[MARK_EXTRAS_KEY]!;
    expect(mark.luma).toBe(0.17);
    expect(mark.roof.x).toEqual([-1.7, -0.4]);
    expect(doc.getRoot().listScenes()[0]!.getExtras()).toHaveProperty(MARK_SCENE_KEY);
  });
  it('names its vehicle: no default, no unknown id', () => {
    expect(() => parseMarkArgs([])).toThrow(/at least one --id/);
    expect(() => parseMarkArgs(['--id=jeep_shoded'])).toThrow(/no recipe/);
    expect(parseMarkArgs(['--', '--id=mbt_lavi'])).toEqual(['mbt_lavi']);
  });
});

type V3 = [number, number, number];
let io: NodeIO;
let doc: Document;
beforeAll(async () => {
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  doc = await io.read(LAVI);
});

const markOf = (): TeamMark => (doc.getRoot().listMaterials()[0]!.getExtras() as Record<string, TeamMark>)[MARK_EXTRAS_KEY]!;

/** Triangle-centroid coverage of one mesh node by the boxes: independent of UVs and of the python. */
function coverage(nodeName: string, mark: TeamMark): { covered: number; total: number } {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === nodeName)!;
  const prim = node.getMesh()!.listPrimitives()[0]!;
  const pos = prim.getAttribute('POSITION')!;
  const nrm = prim.getAttribute('NORMAL')!;
  const idx = prim.getIndices()!.getArray()!;
  let covered = 0;
  let total = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const P = [0, 1, 2].map((k) => pos.getElement(idx[t + k]!, [0, 0, 0]) as V3);
    const N = [0, 1, 2].map((k) => nrm.getElement(idx[t + k]!, [0, 0, 0]) as V3);
    const e1 = [P[1]![0] - P[0]![0], P[1]![1] - P[0]![1], P[1]![2] - P[0]![2]];
    const e2 = [P[2]![0] - P[0]![0], P[2]![1] - P[0]![1], P[2]![2] - P[0]![2]];
    const area = 0.5 * Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
    const c = [0, 1, 2].map((a) => (P[0]![a]! + P[1]![a]! + P[2]![a]!) / 3);
    const n = [0, 1, 2].map((a) => (N[0]![a]! + N[1]![a]! + N[2]![a]!) / 3);
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    const ny = n[1]! / len;
    const nz = Math.abs(n[2]! / len);
    const { roof, band } = mark;
    const inRoof = c[0]! >= roof.x[0] && c[0]! <= roof.x[1] && Math.abs(c[2]!) <= roof.z_half && c[1]! >= roof.y[0] && c[1]! <= roof.y[1] && ny >= roof.min_ny;
    const inBand = c[0]! >= band.x[0] && c[0]! <= band.x[1] && c[1]! >= band.y[0] && c[1]! <= band.y[1] && nz >= band.min_nz;
    total += area;
    if (inRoof || inBand) covered += area;
  }
  return { covered, total };
}

describe('the shipped Lavi', () => {
  it('carries its mark, and ships the base colour alone (the maps are gone)', () => {
    const m = markOf();
    expect(m.team_fraction).toBeGreaterThanOrEqual(TEAM_FRACTION_BAND[0]);
    expect(m.team_fraction).toBeLessThanOrEqual(TEAM_FRACTION_BAND[1]);
    expect(m.luma).toBeGreaterThan(0.05);
    expect(doc.getRoot().listTextures().map((t) => t.getName())).toEqual(['base_color']);
    expect(doc.getRoot().listMaterials()[0]!.getNormalTexture()).toBeNull();
  });

  it('about 2% of the live surface by an independent triangle measurement (centroids, hull and turret roles)', () => {
    const m = markOf();
    const hull = coverage('hull_hull', m);
    const turret = coverage('turret_hull', m);
    const live = ['hull_hull', 'hull_rubber', 'turret_hull', 'turret_metal'].reduce((s, n) => s + coverage(n, m).total, 0);
    const fraction = (hull.covered + turret.covered) / live;
    expect(fraction).toBeGreaterThan(0.015);
    expect(fraction).toBeLessThan(0.025);
  });

  it('rides the TURRET: at least 95% of the marked area is on turret_hull, which hangs off turret_pivot', () => {
    const m = markOf();
    const hull = coverage('hull_hull', m).covered;
    const turret = coverage('turret_hull', m).covered;
    expect(turret / (hull + turret)).toBeGreaterThan(0.95);
    const node = doc.getRoot().listNodes().find((n) => n.getName() === 'turret_hull')!;
    expect(node.getParentNode()?.getName()).toBe('turret_pivot');
    // the barrel, the antennas and the tracks are other roles: they are never swapped onto a variant
    const roles = doc.getRoot().listNodes().filter((n) => n.getMesh() && !n.getName().startsWith('kit_') && !n.getName().startsWith('WRECK_'));
    const carrying = roles.filter((n) => (n.getExtras() as { rl_role?: string }).rl_role === 'hull').map((n) => n.getName()).sort();
    expect(carrying).toEqual(['hull_hull', 'turret_hull']);
  });

  it('every kit UV in the file lies inside an exclusion pin, so no kit part is painted', () => {
    const m = markOf();
    const kit = doc.getRoot().listNodes().filter((n) => n.getName().startsWith('kit_') && n.getMesh());
    expect(kit.length).toBe(13);
    for (const node of kit) {
      for (const prim of node.getMesh()!.listPrimitives()) {
        const uv = prim.getAttribute('TEXCOORD_0')!;
        for (let i = 0; i < uv.getCount(); i++) {
          const [u, v] = uv.getElement(i, [0, 0]) as [number, number];
          const near = m.exclude_uv.some((p) => Math.hypot(u - p[0], v - p[1]) < m.exclude_radius);
          if (!near) throw new Error(`${node.getName()} vertex ${i} at uv ${u},${v} is outside every exclusion pin`);
        }
      }
    }
  });
});

let n = 0;
async function check(mutate?: (mark: Record<string, unknown>, json: { images: { name?: string }[] }) => void): Promise<string[]> {
  const dir = path.join(scratch, `v${n++}`);
  mkdirSync(dir, { recursive: true });
  const d = await io.read(LAVI);
  const mat = d.getRoot().listMaterials()[0]!;
  const mark = JSON.parse(JSON.stringify((mat.getExtras() as Record<string, unknown>)[MARK_EXTRAS_KEY])) as Record<string, unknown>;
  mutate?.(mark, { images: [] });
  mat.setExtras({ ...(mat.getExtras() as Record<string, unknown>), [MARK_EXTRAS_KEY]: mark });
  await io.write(path.join(dir, 'mbt_lavi.glb'), d);
  const code =
    'import sys, json\n' +
    `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\n` +
    'sys.argv = ["x"]\n' +
    'import validate_mesh_assets as v\n' +
    `f, lines = v.check_team_marks(${JSON.stringify(dir)})\n` +
    'print(json.dumps({"failures": f, "lines": lines}))\n';
  const r = spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!) as { failures: string[]; lines: string[] };
  expect(out.lines.length + out.failures.length).toBeGreaterThan(0); // it really read the Lavi
  return out.failures;
}

describe('check_team_marks (validate:meshes)', () => {
  it('the shipped Lavi passes', async () => {
    expect(await check()).toEqual([]);
  }, 60_000);
  it('a kit part pinned outside every exclusion pin fails: the mark would paint it', async () => {
    const f = await check((m) => {
      (m.exclude_uv as number[][])[2] = [0.5, 0.5];
    });
    expect(f.join('\n')).toMatch(/a kit part is pinned at uv .* no exclusion pin covers/);
  }, 60_000);
  it('a mark outside the 1.5-2.5% band fails', async () => {
    const f = await check((m) => {
      m.team_fraction = 0.06;
    });
    expect(f.join('\n')).toMatch(/outside 1\.5-2\.5%/);
  }, 60_000);
  it('an inside-out box and a missing luma fail', async () => {
    const f = await check((m) => {
      (m.roof as { x: number[] }).x = [-0.4, -1.7];
      m.luma = 0;
    });
    expect(f.join('\n')).toMatch(/roof box is empty or inside out/);
    expect(f.join('\n')).toMatch(/luma must be positive/);
  }, 60_000);
});
