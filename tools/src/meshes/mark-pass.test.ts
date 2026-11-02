/**
 * The team mark (L3, GH-943), held to the bytes that ship and to the pass that writes it.
 *
 * - The pass is not idempotent and its position in the pipeline is load-bearing: each way of running it out of
 *   order throws BEFORE the measurement.
 * - The shipped Lavi, the Ambush Tank and the command Lavi (one describe each): an independent TS measurement of the boxes (per-triangle centroids, no UV, no python) must
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
import { afterAll, describe, expect, it } from 'vitest';
import { MARK_EXTRAS_KEY, MARK_RECIPES, MARK_SCENE_KEY, TEAM_FRACTION_BAND, type TeamMark } from './mark-contract';
import { applyMark, parseMarkArgs, type MarkMeasure } from './mark-pass';
import { RG_EXTRAS_KEY } from './running-gear-contract';
import { RESCALE_EXTRAS_KEY } from './rescale-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');
/** Every vehicle with a mark: the Lavi, and the two variants cut from its hull (lead, 2 Nov). */
const MARKED = ['mbt_lavi', 'mbt_lavi_camo', 'officer_armour'] as const;
const glbOf = (id: string): string => path.join(VEHICLES, `${id}.glb`);
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
    expect(parseMarkArgs(['--id=mbt_lavi_camo', '--id=officer_armour'])).toEqual(['mbt_lavi_camo', 'officer_armour']);
  });
});

type V3 = [number, number, number];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const docs = new Map<string, Document>();
async function load(id: string): Promise<Document> {
  let d = docs.get(id);
  if (!d) {
    d = await io.read(glbOf(id));
    docs.set(id, d);
  }
  return d;
}

const markOf = (doc: Document): TeamMark => (doc.getRoot().listMaterials()[0]!.getExtras() as Record<string, TeamMark>)[MARK_EXTRAS_KEY]!;

interface Cover {
  covered: number;
  total: number;
  /** Centroids of the covered triangles (for "it covers none of the cupola"). */
  hits: V3[];
  /** Every triangle centroid of the node. */
  all: V3[];
}

/** Triangle-centroid coverage of one mesh node by the boxes: independent of UVs and of the python. */
function coverage(doc: Document, nodeName: string, mark: TeamMark): Cover {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === nodeName)!;
  const prim = node.getMesh()!.listPrimitives()[0]!;
  const pos = prim.getAttribute('POSITION')!;
  const nrm = prim.getAttribute('NORMAL')!;
  const idx = prim.getIndices()!.getArray()!;
  let covered = 0;
  let total = 0;
  const hits: V3[] = [];
  const all: V3[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const P = [0, 1, 2].map((k) => pos.getElement(idx[t + k]!, [0, 0, 0]) as V3);
    const N = [0, 1, 2].map((k) => nrm.getElement(idx[t + k]!, [0, 0, 0]) as V3);
    const e1 = [P[1]![0] - P[0]![0], P[1]![1] - P[0]![1], P[1]![2] - P[0]![2]];
    const e2 = [P[2]![0] - P[0]![0], P[2]![1] - P[0]![1], P[2]![2] - P[0]![2]];
    const area = 0.5 * Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
    const c = [0, 1, 2].map((a) => (P[0]![a]! + P[1]![a]! + P[2]![a]!) / 3) as V3;
    const n = [0, 1, 2].map((a) => (N[0]![a]! + N[1]![a]! + N[2]![a]!) / 3);
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    const ny = n[1]! / len;
    const nz = Math.abs(n[2]! / len);
    const { roof, band } = mark;
    const inRoof = c[0]! >= roof.x[0] && c[0]! <= roof.x[1] && Math.abs(c[2]!) <= roof.z_half && c[1]! >= roof.y[0] && c[1]! <= roof.y[1] && ny >= roof.min_ny;
    const inBand = c[0]! >= band.x[0] && c[0]! <= band.x[1] && c[1]! >= band.y[0] && c[1]! <= band.y[1] && nz >= band.min_nz;
    total += area;
    all.push(c);
    if (inRoof || inBand) {
      covered += area;
      hits.push(c);
    }
  }
  return { covered, total, hits, all };
}

const LIVE = ['hull_hull', 'hull_rubber', 'turret_hull', 'turret_metal'];

/** How much of the marked area must ride the turret (it turns; the hull does not). The Ambush Tank's net drapes
 *  beside the turret ring on `hull_hull`, so it cannot meet the Lavi's 95%. */
const TURRET_SHARE: Record<(typeof MARKED)[number], number> = { mbt_lavi: 0.95, mbt_lavi_camo: 0.8, officer_armour: 0.95 };

describe.each(MARKED)('the shipped %s', (id) => {
  it('carries its mark, and ships the base colour alone', async () => {
    const doc = await load(id);
    const m = markOf(doc);
    expect(m.team_fraction).toBeGreaterThanOrEqual(TEAM_FRACTION_BAND[0]);
    expect(m.team_fraction).toBeLessThanOrEqual(TEAM_FRACTION_BAND[1]);
    expect(m.luma).toBeGreaterThan(0.05);
    expect(doc.getRoot().listTextures().map((t) => t.getName())).toEqual(['base_color']);
    expect(doc.getRoot().listMaterials()[0]!.getNormalTexture()).toBeNull();
    expect(doc.getRoot().listScenes()[0]!.getExtras()).toHaveProperty(MARK_SCENE_KEY);
  });

  it('about 2% of the live surface by an independent triangle measurement (centroids, hull and turret roles)', async () => {
    const doc = await load(id);
    const m = markOf(doc);
    const hull = coverage(doc, 'hull_hull', m);
    const turret = coverage(doc, 'turret_hull', m);
    const live = LIVE.reduce((s, n) => s + coverage(doc, n, m).total, 0);
    const fraction = (hull.covered + turret.covered) / live;
    expect(fraction).toBeGreaterThan(0.015);
    expect(fraction).toBeLessThan(0.025);
    // a variant DECLARES the triangle share, so the declared number and this oracle must agree closely
    if (m.team_fraction_basis === 'triangle') expect(Math.abs(fraction - m.team_fraction)).toBeLessThan(0.0005);
  });

  it('rides the TURRET, which hangs off turret_pivot; only the hull and the turret body carry it', async () => {
    const doc = await load(id);
    const m = markOf(doc);
    const hull = coverage(doc, 'hull_hull', m).covered;
    const turret = coverage(doc, 'turret_hull', m).covered;
    expect(turret / (hull + turret)).toBeGreaterThan(TURRET_SHARE[id]);
    const node = doc.getRoot().listNodes().find((n) => n.getName() === 'turret_hull')!;
    expect(node.getParentNode()?.getName()).toBe('turret_pivot');
    // the barrel, the antennas and the tracks are other roles: they are never swapped onto a variant
    const roles = doc.getRoot().listNodes().filter((n) => n.getMesh() && !n.getName().startsWith('kit_') && !n.getName().startsWith('WRECK_'));
    const carrying = roles.filter((n) => (n.getExtras() as { rl_role?: string }).rl_role === 'hull').map((n) => n.getName()).sort();
    expect(carrying).toEqual(['hull_hull', 'turret_hull']);
  });

  it('the wreck twins share the live material, so a wreck never needs a second mark', async () => {
    const doc = await load(id);
    expect(doc.getRoot().listMaterials()).toHaveLength(1);
  });
});

describe('the Lavi: every kit UV lies inside an exclusion pin, so no kit part is painted', () => {
  it('13 kit parts, every vertex within a pin', async () => {
    const doc = await load('mbt_lavi');
    const m = markOf(doc);
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

describe('the two variants have no kit and exclude nothing', () => {
  it.each(['mbt_lavi_camo', 'officer_armour'] as const)('%s: no kit_ node, every pin outside the unit square, the recipe names no kit', async (id) => {
    const doc = await load(id);
    expect(doc.getRoot().listNodes().filter((n) => n.getName().startsWith('kit_'))).toEqual([]);
    for (const pin of markOf(doc).exclude_uv) expect(pin.some((c) => c < 0 || c > 1)).toBe(true);
    expect(MARK_RECIPES[id]!.kit).toBeNull();
    expect(markOf(doc).team_fraction_basis).toBe('triangle');
  });
});

describe('each variant\'s box is placed for ITS hull', () => {
  it('the command Lavi: the roof panel stands clear of the cupola, in plan, so the cupola never hides half of it', async () => {
    const doc = await load('officer_armour');
    const m = markOf(doc);
    const key = (c: V3): string => c.map((v) => v.toFixed(4)).join(',');
    const lavi = new Set(coverage(await load('mbt_lavi'), 'turret_hull', markOf(await load('mbt_lavi'))).all.map(key));
    const turret = coverage(doc, 'turret_hull', m);
    const added = turret.all.filter((c) => !lavi.has(key(c)));
    expect(added.length).toBeGreaterThan(60); // the cupola ring, lid and periscope block really were found
    expect(Math.max(...added.map((c) => c[1]!))).toBeGreaterThan(2.9);
    // the cupola's footprint in plan (x, |z|) against the roof box's: they must not overlap at all
    const cx = [Math.min(...added.map((c) => c[0]!)), Math.max(...added.map((c) => c[0]!))];
    const cz = [Math.min(...added.map((c) => c[2]!)), Math.max(...added.map((c) => c[2]!))];
    const xOverlap = Math.min(cx[1]!, m.roof.x[1]) - Math.max(cx[0]!, m.roof.x[0]);
    const zOverlap = Math.min(cz[1]!, m.roof.z_half) - Math.max(cz[0]!, -m.roof.z_half);
    expect(xOverlap > 0 && zOverlap > 0).toBe(false);
    // and the Lavi's own roof box WOULD overlap it (so this test is about the move, not about a coincidence)
    const lm = markOf(await load('mbt_lavi'));
    expect(Math.min(cx[1]!, lm.roof.x[1]) - Math.max(cx[0]!, lm.roof.x[0])).toBeGreaterThan(0.5);
  });

  it.each(['mbt_lavi_camo', 'officer_armour'] as const)('%s does not carry the Lavi\'s boxes in from the imported source (rescale.drop_imported_mark)', async (id) => {
    const lavi = markOf(await load('mbt_lavi'));
    const m = markOf(await load(id));
    expect(m.roof).not.toEqual(lavi.roof);
    expect(m.team_fraction).not.toBe(lavi.team_fraction);
  });

  it('the Ambush Tank: the panel paints no foliage tuft (it stays under the tips and wants a steep surface)', async () => {
    const doc = await load('mbt_lavi_camo');
    const m = markOf(doc);
    const turret = coverage(doc, 'turret_hull', m);
    // the tufts stand to y ~3.4; the net hump itself tops out under 3.0. Nothing the box paints is above 3.0.
    expect(Math.max(...turret.hits.map((c) => c[1]!))).toBeLessThan(3.0);
    expect(turret.all.some((c) => c[1]! > 3.2)).toBe(true); // and the tufts really are there to be missed
    expect(m.roof.y[1]).toBeLessThan(3.0);
    expect(m.roof.min_ny).toBeGreaterThanOrEqual(0.5);
  });

  it('the Lavi\'s own numbers are untouched (it shipped in PR 958)', async () => {
    const m = markOf(await load('mbt_lavi'));
    expect(m.roof).toEqual({ x: [-1.7, -0.4], z_half: 0.7, y: [2.28, 2.56], min_ny: 0.6 });
    expect(m.team_fraction).toBe(0.02115);
  });
});

describe('the roster pin: validate:meshes requires a mark on exactly the recipe ids', () => {
  it('MARK_REQUIRED (python) equals MARK_RECIPES (TypeScript)', () => {
    const code =
      'import sys, json\n' +
      `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\n` +
      'sys.argv = ["x"]\n' +
      'import validate_mesh_assets as v\n' +
      'print(json.dumps(list(v.MARK_REQUIRED)))\n';
    const r = spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
    const required = (JSON.parse(r.stdout.trim().split('\n').pop()!) as string[]).sort();
    expect(required).toEqual(Object.keys(MARK_RECIPES).sort());
    expect(required).toEqual([...MARKED].sort());
  }, 60_000);
});

let n = 0;
async function check(
  mutate?: (mark: Record<string, unknown>) => void,
  opts: { id?: string; required?: readonly string[]; strip?: boolean } = {}
): Promise<string[]> {
  const id = opts.id ?? 'mbt_lavi';
  const dir = path.join(scratch, `v${n++}`);
  mkdirSync(dir, { recursive: true });
  const d = await io.read(glbOf(id));
  const mat = d.getRoot().listMaterials()[0]!;
  const extras = { ...(mat.getExtras() as Record<string, unknown>) };
  const mark = JSON.parse(JSON.stringify(extras[MARK_EXTRAS_KEY])) as Record<string, unknown>;
  mutate?.(mark);
  if (opts.strip) delete extras[MARK_EXTRAS_KEY];
  else extras[MARK_EXTRAS_KEY] = mark;
  mat.setExtras(extras);
  await io.write(path.join(dir, `${id}.glb`), d);
  const required = opts.required ?? [id];
  const code =
    'import sys, json\n' +
    `sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\n` +
    'sys.argv = ["x"]\n' +
    'import validate_mesh_assets as v\n' +
    `f, lines = v.check_team_marks(${JSON.stringify(dir)}, ${JSON.stringify(required)})\n` +
    'print(json.dumps({"failures": f, "lines": lines}))\n';
  const r = spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!) as { failures: string[]; lines: string[] };
  expect(out.lines.length + out.failures.length).toBeGreaterThan(0); // it really read the vehicle
  return out.failures;
}

describe('check_team_marks (validate:meshes)', () => {
  it.each(MARKED)('the shipped %s passes', async (id) => {
    expect(await check(undefined, { id })).toEqual([]);
  }, 60_000);
  it('a kit part pinned outside every exclusion pin fails: the mark would paint it', async () => {
    const f = await check((m) => {
      (m.exclude_uv as number[][])[2] = [0.5, 0.5];
    });
    expect(f.join('\n')).toMatch(/a kit part is pinned at uv .* no exclusion pin covers/);
  }, 60_000);
  it.each(MARKED)('%s: a mark outside the 1.5-2.5% band fails', async (id) => {
    const f = await check((m) => {
      m.team_fraction = 0.06;
    }, { id });
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
  it.each(['mbt_lavi_camo', 'officer_armour'])('%s losing its mark fails: a vehicle on the roster cannot silently stop being checked', async (id) => {
    const f = await check(undefined, { id, strip: true });
    expect(f.join('\n')).toMatch(new RegExp(`${id} carries no rl_team_mark, but it must`));
  }, 60_000);
  it('a required id with no GLB at all fails', async () => {
    const f = await check(undefined, { id: 'mbt_lavi', required: ['mbt_lavi', 'officer_armour'] });
    expect(f.join('\n')).toMatch(/officer_armour: no GLB at .*, but it must carry a team mark/);
  }, 60_000);
});
