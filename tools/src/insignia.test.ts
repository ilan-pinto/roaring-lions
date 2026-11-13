/**
 * GH-1096 S1: the Roaring Lion insignia's placement, held to the bytes that ship (spec section 9, gates 2 and 10).
 *
 * Gate 2, geometry: an INDEPENDENT measurement of each framed vehicle's GLB (`art/meshes/vehicles/<id>.glb`, read with
 * gltf-transform: no python, no UV maths shared with `tools/vehicles/insignia.py`). Every live mesh triangle is SUBDIVIDED 12 x 12
 * (a Meshy hull's triangles are huge, the carriers' lesson), and the sub-triangle centroids are tested with the interpolated
 * normal, which is what the fragment shader does:
 *  - on each flank, at least 90% of the disc's area lands on host `rl_role: hull` faces that pass the normal test inside the slab;
 *  - the disc does not meet either team-mark box (the vehicle's own `rl_team_mark`);
 *  - no `rubber`, `metal` or `plate` face sits in the disc and slab (the shader paints only hull-role meshes, but a track or a
 *    barrel in the box would mean the frame is in the wrong place);
 *  - every kit face, of every tier, in the disc and slab passes the normal test (decision 14: the lion paints the outermost FLAT
 *    plate, so a non-flat kit face in the box would take a slice of lion);
 *  - the bake's luminance spread under the disc, on the VISIBLE surface (the front-most face at each 1 cm point), is under a
 *    measured ceiling, which catches baked windows and hatches. The Lavi's forward skirt reads 0.030; the ceiling is 0.045. A
 *    literal witness on the Lavi's own turret flank (0.20, 2.10), baked detail, reads 0.073 (insignia.py's sampler), so the check can fail on this bake.
 *  - the host hull hash the table recorded is the hash of these bytes, computed a third way (TypeScript, from gltf-transform's
 *    arrays), beside the generator's numpy and the validator's struct.
 *
 * Gate 10, the art gate: `check_insignia_frames` (validate_mesh_assets.py) passes the shipped table and is falsified on scratch
 * copies of it (a missing entry, one flipped hash byte), and its `INSIGNIA_REQUIRED` is pinned to the table's keys.
 *
 * The one-line falsifications (centre x 50, the team band, the turret flank) are run by hand and listed in the commit message.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import jpeg from 'jpeg-js';
import { afterAll, describe, expect, it } from 'vitest';
import { INSIGNIA_FRAMES } from '../../packages/render/src/three/units/insignia-frames';
import type { InsigniaFrame } from '../../packages/render/src/three/units/insignia';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');
const TABLE = path.join(REPO, 'packages', 'render', 'src', 'three', 'units', 'insignia-frames.ts');
const SUBDIV = 12;
/** The share of the disc each flank must paint. */
const AREA_FLOOR = 0.9;
/** Linear-luma standard deviation under the disc. Measured: the Lavi's forward skirt 0.030 (insignia.py's `luma_std`). */
const LUMA_STD_CEILING = 0.045;

const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-insignia-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type V3 = [number, number, number];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const docs = new Map<string, Document>();
async function load(id: string): Promise<Document> {
  let d = docs.get(id);
  if (!d) {
    d = await io.read(path.join(VEHICLES, `${id}.glb`));
    docs.set(id, d);
  }
  return d;
}

interface Extras {
  rl_role?: string;
  rl_kit?: unknown;
  rl_wreck?: boolean;
}
const extrasOf = (n: GNode): Extras => n.getExtras() as Extras;
const isHost = (n: GNode): boolean => extrasOf(n).rl_role === 'hull' && extrasOf(n).rl_kit === undefined && extrasOf(n).rl_wreck !== true;
const isLive = (n: GNode): boolean => n.getMesh() !== null && extrasOf(n).rl_wreck !== true && !n.getName().startsWith('WRECK_');

/** A mesh's triangles in its OWN attribute space (what the shader reads), with normals and uvs. The node chain must net to the
 *  identity (the turret: pivot +T, mesh -T), or the attribute space is not the vehicle's frame and this says so. */
interface Tri {
  readonly P: [V3, V3, V3];
  readonly N: [V3, V3, V3];
  readonly U: [[number, number], [number, number], [number, number]];
}
function trianglesOf(node: GNode): Tri[] {
  const m = node.getWorldMatrix();
  const off = Math.hypot(m[12], m[13], m[14]);
  const rot = Math.abs(m[0] - 1) + Math.abs(m[5] - 1) + Math.abs(m[10] - 1) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[4]);
  if (off > 1e-5 || rot > 1e-6) throw new Error(`${node.getName()}: its node chain is not the identity; the frame would be in the wrong space`);
  const prim = node.getMesh()!.listPrimitives()[0]!;
  const pos = prim.getAttribute('POSITION')!;
  const nrm = prim.getAttribute('NORMAL')!;
  const uv = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices()!.getArray()!;
  const out: Tri[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const k = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    out.push({
      P: k.map((i) => pos.getElement(i, [0, 0, 0]) as V3) as Tri['P'],
      N: k.map((i) => nrm.getElement(i, [0, 0, 0]) as V3) as Tri['N'],
      U: k.map((i) => (uv ? (uv.getElement(i, [0, 0]) as [number, number]) : [0, 0])) as Tri['U'],
    });
  }
  return out;
}

/** Every sub-triangle centroid of `tris` (SUBDIV^2 per triangle) with its interpolated normal and its projected XY area. */
function* subCentroids(tris: readonly Tri[]): Generator<{ c: V3; n: V3; areaXY: number }> {
  for (const { P, N } of tris) {
    const ax = P[1][0] - P[0][0];
    const ay = P[1][1] - P[0][1];
    const bx = P[2][0] - P[0][0];
    const by = P[2][1] - P[0][1];
    const areaXY = Math.abs(ax * by - ay * bx) / 2 / (SUBDIV * SUBDIV);
    for (let i = 0; i < SUBDIV; i++) {
      for (let j = 0; j < SUBDIV - i; j++) {
        for (const up of [true, false]) {
          if (!up && j >= SUBDIV - i - 1) continue;
          const bu = up ? (i + 1 / 3) / SUBDIV : (i + 2 / 3) / SUBDIV;
          const bv = up ? (j + 1 / 3) / SUBDIV : (j + 2 / 3) / SUBDIV;
          const bw = 1 - bu - bv;
          const c = [0, 1, 2].map((a) => bw * P[0][a] + bu * P[1][a] + bv * P[2][a]) as V3;
          const n = [0, 1, 2].map((a) => bw * N[0][a] + bu * N[1][a] + bv * N[2][a]) as V3;
          yield { c, n, areaXY };
        }
      }
    }
  }
}

const inDisc = (f: InsigniaFrame, c: V3): boolean => Math.hypot(c[0] - f.centre[0], c[1] - f.centre[1]) <= f.d / 2;
const inSlab = (f: InsigniaFrame, c: V3): boolean => Math.abs(c[2]) >= f.slab[0] && Math.abs(c[2]) <= f.slab[1];
const flankFacing = (f: InsigniaFrame, n: V3): boolean => Math.abs(n[2]) / Math.hypot(n[0], n[1], n[2]) >= f.min_n;

async function nodesOf(id: string): Promise<GNode[]> {
  return (await load(id)).getRoot().listNodes().filter(isLive);
}

/** The painted share of the disc on each flank: projected area of host-hull sub-triangles passing every test, over pi r^2. */
async function coverage(id: string, f: InsigniaFrame): Promise<{ plus: number; minus: number }> {
  const out = { plus: 0, minus: 0 };
  for (const node of (await nodesOf(id)).filter(isHost)) {
    for (const s of subCentroids(trianglesOf(node))) {
      if (inDisc(f, s.c) && inSlab(f, s.c) && flankFacing(f, s.n)) out[s.c[2] > 0 ? 'plus' : 'minus'] += s.areaXY;
    }
  }
  const disc = Math.PI * (f.d / 2) ** 2;
  return { plus: out.plus / disc, minus: out.minus / disc };
}

/** The base colour as LINEAR luma (jpeg-js; the base-colour texture, never a normal map). */
function bakeLumaOf(doc: Document): { w: number; h: number; luma: Float64Array } {
  const tex = doc.getRoot().listMaterials()[0]!.getBaseColorTexture()!;
  if (tex.getMimeType() !== 'image/jpeg') throw new Error(`spec: the bake is ${tex.getMimeType()}, not a JPEG`);
  const img = jpeg.decode(tex.getImage()!, { useTArray: true });
  const luma = new Float64Array(img.width * img.height);
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.2126 * lin(img.data[i * 4]!) + 0.7152 * lin(img.data[i * 4 + 1]!) + 0.0722 * lin(img.data[i * 4 + 2]!);
  }
  return { w: img.width, h: img.height, luma };
}

/** The bake's luma at the VISIBLE host-hull surface (the front-most face on each flank at each 1 cm point of the disc). */
async function lumaSpread(id: string, centre: readonly [number, number], d: number): Promise<{ mean: number; std: number; points: number }> {
  const doc = await load(id);
  const bake = bakeLumaOf(doc);
  const tris = (await nodesOf(id)).filter(isHost).flatMap(trianglesOf);
  const r = d / 2;
  const near = tris.filter((t) => {
    const xs = t.P.map((p) => p[0]);
    const ys = t.P.map((p) => p[1]);
    return Math.max(...xs) >= centre[0] - r && Math.min(...xs) <= centre[0] + r && Math.max(...ys) >= centre[1] - r && Math.min(...ys) <= centre[1] + r;
  });
  const values: number[] = [];
  const steps = Math.round(d * 100);
  for (const side of [1, -1]) {
    for (let yi = 0; yi < steps; yi++) {
      for (let xi = 0; xi < steps; xi++) {
        const x = centre[0] - r + (xi + 0.5) / 100;
        const y = centre[1] - r + (yi + 0.5) / 100;
        if (Math.hypot(x - centre[0], y - centre[1]) > r) continue;
        let best: { z: number; u: number; v: number } | null = null;
        for (const t of near) {
          const [a, b, c] = t.P;
          const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
          if (Math.abs(den) < 1e-12) continue;
          const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
          const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const z = l1 * a[2] + l2 * b[2] + l3 * c[2];
          if (best !== null && side * z <= side * best.z) continue;
          best = { z, u: l1 * t.U[0][0] + l2 * t.U[1][0] + l3 * t.U[2][0], v: l1 * t.U[0][1] + l2 * t.U[1][1] + l3 * t.U[2][1] };
        }
        if (best === null) continue;
        const px = Math.min(bake.w - 1, Math.max(0, Math.floor(best.u * bake.w)));
        const py = Math.min(bake.h - 1, Math.max(0, Math.floor(best.v * bake.h)));
        values.push(bake.luma[py * bake.w + px]!);
      }
    }
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return { mean, std, points: values.length };
}

interface TeamMarkBoxes {
  roof: { x: [number, number]; y: [number, number] };
  band: { x: [number, number]; y: [number, number] };
}

const FRAMED = Object.keys(INSIGNIA_FRAMES).sort();

describe('gate 2: each frame stands on its hull (independent, subdivided)', () => {
  it('measures something: the table is not empty', () => {
    expect(FRAMED.length).toBeGreaterThan(0);
  });

  it.each(FRAMED)('%s: at least 90% of the disc on each flank lands on host hull faces passing the normal test in the slab', async (id) => {
    const c = await coverage(id, INSIGNIA_FRAMES[id]!);
    expect(c.plus, '+z flank').toBeGreaterThanOrEqual(AREA_FLOOR);
    expect(c.minus, '-z flank').toBeGreaterThanOrEqual(AREA_FLOOR);
  }, 60_000);

  it.each(FRAMED)('%s: the disc meets neither team-mark box', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    const mark = ((await load(id)).getRoot().listMaterials()[0]!.getExtras() as { rl_team_mark?: TeamMarkBoxes }).rl_team_mark;
    if (mark === undefined) return;
    const r = f.d / 2;
    for (const box of [mark.roof, mark.band]) {
      const overlap = f.centre[0] + r > box.x[0] && f.centre[0] - r < box.x[1] && f.centre[1] + r > box.y[0] && f.centre[1] - r < box.y[1];
      expect(overlap, `the disc overlaps the team box x ${box.x} y ${box.y}`).toBe(false);
    }
  });

  it.each(FRAMED)('%s: no rubber, metal or plate face stands in the disc and slab', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    const strays: string[] = [];
    for (const node of await nodesOf(id)) {
      if (extrasOf(node).rl_role === 'hull') continue;
      for (const s of subCentroids(trianglesOf(node))) {
        if (inDisc(f, s.c) && inSlab(f, s.c)) {
          strays.push(`${node.getName()} (${extrasOf(node).rl_role}) at ${s.c.map((v) => v.toFixed(2)).join(', ')}`);
          break;
        }
      }
    }
    expect(strays).toEqual([]);
  }, 60_000);

  it.each(FRAMED)('%s: every kit face of every tier in the disc and slab is flank-facing (a flat plate takes the lion)', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    let seen = 0;
    const bent: string[] = [];
    for (const node of (await nodesOf(id)).filter((n) => extrasOf(n).rl_kit !== undefined)) {
      for (const s of subCentroids(trianglesOf(node))) {
        if (!inDisc(f, s.c) || !inSlab(f, s.c)) continue;
        seen++;
        if (!flankFacing(f, s.n)) bent.push(`${node.getName()} at ${s.c.map((v) => v.toFixed(2)).join(', ')}`);
      }
    }
    expect(bent.slice(0, 5)).toEqual([]);
    // the Lavi's tier-2 skirt plate really is in the box (so this checked something)
    if (id === 'mbt_lavi') expect(seen).toBeGreaterThan(100);
  }, 60_000);

  it.each(FRAMED)('%s: the bake under the disc is plain (luma spread under the measured ceiling), and its mean is the table\'s', async (id) => {
    const f = INSIGNIA_FRAMES[id]!;
    const s = await lumaSpread(id, [f.centre[0], f.centre[1]], f.d);
    expect(s.points).toBeGreaterThan(2000);
    expect(s.std).toBeLessThan(LUMA_STD_CEILING);
    // jpeg-js against PIL, nearest texel each: the two decoders agree to well under a percent of the mean
    expect(Math.abs(s.mean - f.luma) / f.luma).toBeLessThan(0.02);
  }, 60_000);

  it('the witness: the Lavi\'s turret flank (0.20, 2.10), baked detail, reads ABOVE the ceiling, so the check can fail on this bake', async () => {
    const s = await lumaSpread('mbt_lavi', [0.2, 2.1], 0.6);
    expect(s.points).toBeGreaterThan(5000);
    expect(s.std).toBeGreaterThan(LUMA_STD_CEILING);
  }, 60_000);

  it.each(FRAMED)('%s: the recorded host hash is these bytes\' (a third implementation: gltf-transform arrays)', async (id) => {
    const hosts = (await nodesOf(id)).filter(isHost).sort((a, b) => (a.getName() < b.getName() ? -1 : 1));
    expect(hosts.length).toBeGreaterThan(0);
    const h = createHash('sha256');
    for (const n of hosts) {
      const a = n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
      h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    }
    expect(h.digest('hex')).toBe(INSIGNIA_FRAMES[id]!.host_sha256);
  });
});

function pythonJson(code: string): unknown {
  const r = spawnSync('python3', ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(REPO, 'tools'))})\nsys.argv = ["x"]\nimport validate_mesh_assets as v\n${code}`], {
    cwd: REPO,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}

function checkTable(table: string): { failures: string[]; lines: string[] } {
  return pythonJson(
    `f, lines = v.check_insignia_frames(${JSON.stringify(VEHICLES)}, table_path=${JSON.stringify(table)})\nprint(json.dumps({"failures": f, "lines": lines}))`
  ) as { failures: string[]; lines: string[] };
}

describe('gate 10: check_insignia_frames (validate:meshes)', () => {
  it('INSIGNIA_REQUIRED (python) equals the table\'s keys (TypeScript)', () => {
    const required = (pythonJson('print(json.dumps(list(v.INSIGNIA_REQUIRED)))') as string[]).sort();
    expect(required).toEqual(FRAMED);
    expect(required).toEqual(['mbt_lavi']);
  }, 60_000);

  it('the shipped table passes, and really read each vehicle', () => {
    const r = checkTable(TABLE);
    expect(r.failures).toEqual([]);
    expect(r.lines).toHaveLength(FRAMED.length);
  }, 60_000);

  it('a table with one flipped hash byte fails: the hull "changed since its frame was measured"', () => {
    const text = readFileSync(TABLE, 'utf8');
    const hash = INSIGNIA_FRAMES.mbt_lavi!.host_sha256;
    const flipped = `${hash.slice(0, 10)}${hash[10] === '0' ? '1' : '0'}${hash.slice(11)}`;
    const file = path.join(scratch, 'flipped.ts');
    writeFileSync(file, text.replace(hash, flipped));
    expect(checkTable(file).failures.join('\n')).toMatch(/mbt_lavi: the host hull changed since its frame was measured/);
  }, 60_000);

  it('a table without the Lavi fails: INSIGNIA_REQUIRED names it', () => {
    const file = path.join(scratch, 'empty.ts');
    const text = readFileSync(TABLE, 'utf8');
    const a = text.indexOf('= {', text.indexOf('// BEGIN rl-insignia-frames'));
    const b = text.indexOf('};', a);
    writeFileSync(file, `${text.slice(0, a)}= {}${text.slice(b + 1)}`);
    expect(checkTable(file).failures.join('\n')).toMatch(/mbt_lavi has no frame/);
  }, 60_000);
});
