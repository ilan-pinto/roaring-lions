/**
 * L3 (GH-943): the Lavi's normal and ORM maps, held to the bytes that ship.
 *
 * - **The frame round trip.** The generator writes tangent-space normals in three's own derivative
 *   frame (`getTangentFrame`, no tangents on this asset). That frame is re-derived HERE, line for line
 *   from the GLSL, by a second transliteration that shares no code with `lavi_maps.py`, and run on the
 *   SHIPPED maps and geometry: every probe texel's decoded normal must land within 2 degrees of the
 *   object-space normal the generator meant (`tools/fixtures/mbt_lavi-maps-probes.json`). A flipped
 *   green channel must NOT: it is the silent failure of every normal-map pipeline, a bump read as a dent.
 * - **Determinism.** The generator is a table plus seeded noise: two runs are byte-identical, and the
 *   shipped GLB declares the hash of the generator source that made it (a stale map fails by name).
 * - **No `mathutils.noise`.** Blender 5.2 reseeds it per process; the generator must never import it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAPS_EXTRAS_KEY, MAPS_SIZE, ORM_EXTRAS_KEY, TEAM_FRACTION_BAND, TEAM_LUMA_KEY } from './maps-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LAVI = path.join(REPO, 'art', 'meshes', 'vehicles', 'mbt_lavi.glb');
const PROBES = path.join(REPO, 'tools', 'fixtures', 'mbt_lavi-maps-probes.json');
const GENERATOR = path.join(REPO, 'tools', 'vehicles', 'lavi_maps.py');
const READER = path.join(REPO, 'tools', 'vehicles', 'glb_read.py');

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));

/**
 * three's `getTangentFrame` (normalmap_pars_fragment.glsl.js), for one point, as the COLUMNS
 * [T*scale, B*scale, N]. `dFdx`/`dFdy` are taken over an orthographic screen whose x and y span
 * the plane normal to N (a front-facing triangle seen from outside); any other view gives the
 * same frame up to a common factor that `scale` removes, which is what this checks.
 */
function glslFrame(Pu: V3, Pv: V3, Nin: V3, view: number): [V3, V3, V3] {
  const N = norm(Nin);
  const seed: V3 = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let e1 = norm(cross(N, seed));
  let e2 = cross(N, e1);
  // Rotate the screen about N, to prove the frame does not depend on the view.
  const c = Math.cos(view);
  const s = Math.sin(view);
  [e1, e2] = [add(mul(e1, c), mul(e2, s)), add(mul(e1, -s), mul(e2, c))];
  // screen (x, y) -> (u, v): the inverse of [[e1.Pu, e1.Pv], [e2.Pu, e2.Pv]]
  const a = dot(e1, Pu), b = dot(e1, Pv), cc = dot(e2, Pu), d = dot(e2, Pv);
  const det = a * d - b * cc;
  const st0 = [d / det, -cc / det]; // d(u,v)/dx
  const st1 = [-b / det, a / det]; // d(u,v)/dy
  const q0 = add(mul(Pu, st0[0]), mul(Pv, st0[1]));
  const q1 = add(mul(Pu, st1[0]), mul(Pv, st1[1]));
  const q1perp = cross(q1, N);
  const q0perp = cross(N, q0);
  const T = add(mul(q1perp, st0[0]), mul(q0perp, st1[0]));
  const B = add(mul(q1perp, st0[1]), mul(q0perp, st1[1]));
  const scale = 1 / Math.sqrt(Math.max(dot(T, T), dot(B, B)));
  return [mul(T, scale), mul(B, scale), N];
}

interface Probe {
  part: string;
  x: number;
  y: number;
  n: V3;
  target: V3;
  tri: number;
}

let doc: Document;
let normal: PNG;
let probes: { size: number; generator_sha256: string; probes: Probe[] };

beforeAll(async () => {
  doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(LAVI);
  const mat = doc.getRoot().listMaterials()[0]!;
  normal = PNG.sync.read(Buffer.from(mat.getNormalTexture()!.getImage()!));
  probes = JSON.parse(readFileSync(PROBES, 'utf8')) as typeof probes;
});

/** The angle, degrees, between the runtime normal at a probe and the one the generator meant. */
function errorDeg(p: Probe, normalScaleY: number, view = 0): number {
  const mesh = doc.getRoot().listNodes().find((n) => n.getName() === p.part)!.getMesh()!;
  const prim = mesh.listPrimitives()[0]!;
  const pos = prim.getAttribute('POSITION')!, uv = prim.getAttribute('TEXCOORD_0')!, nrm = prim.getAttribute('NORMAL')!;
  const idx = prim.getIndices()!.getArray()!;
  const i = [idx[3 * p.tri]!, idx[3 * p.tri + 1]!, idx[3 * p.tri + 2]!];
  const P = i.map((k) => pos.getElement(k, [0, 0, 0]) as V3);
  const U = i.map((k) => uv.getElement(k, [0, 0]) as [number, number]);
  const Nv = i.map((k) => nrm.getElement(k, [0, 0, 0]) as V3);
  // Pu, Pv: metres per UV unit, from the triangle.
  const e1 = sub(P[1]!, P[0]!), e2 = sub(P[2]!, P[0]!);
  const d1 = [U[1]![0] - U[0]![0], U[1]![1] - U[0]![1]], d2 = [U[2]![0] - U[0]![0], U[2]![1] - U[0]![1]];
  const det = d1[0]! * d2[1]! - d2[0]! * d1[1]!;
  const Pu = mul(sub(mul(e1, d2[1]!), mul(e2, d1[1]!)), 1 / det);
  const Pv = mul(sub(mul(e2, d1[0]!), mul(e1, d2[0]!)), 1 / det);
  // Barycentrics of the texel centre -> the interpolated vertex normal.
  const tu = (p.x + 0.5) / MAPS_SIZE, tv = (p.y + 0.5) / MAPS_SIZE;
  const w1 = ((tu - U[0]![0]) * d2[1]! - (tv - U[0]![1]) * d2[0]!) / det;
  const w2 = ((tv - U[0]![1]) * d1[0]! - (tu - U[0]![0]) * d1[1]!) / det;
  const N = norm(add(add(mul(Nv[0]!, 1 - w1 - w2), mul(Nv[1]!, w1)), mul(Nv[2]!, w2)));
  const [T, B] = glslFrame(Pu, Pv, N, view);
  const o = (p.y * normal.width + p.x) * 4;
  const m: V3 = [(normal.data[o]! / 255) * 2 - 1, (normal.data[o + 1]! / 255) * 2 - 1, (normal.data[o + 2]! / 255) * 2 - 1];
  const mapN: V3 = [m[0], m[1] * normalScaleY, m[2]]; // `mapN.xy *= normalScale`
  const n = norm(add(add(mul(T, mapN[0]), mul(B, mapN[1])), mul(N, mapN[2])));
  return (Math.acos(Math.min(1, Math.max(-1, dot(n, norm(p.target))))) * 180) / Math.PI;
}

describe('the normal map, through three\'s own tangent frame', () => {
  it('has probes on every part that carries relief', () => {
    expect(probes.size).toBe(MAPS_SIZE);
    const parts = new Set(probes.probes.map((p) => p.part));
    expect([...parts].sort()).toEqual(['hull_hull', 'turret_hull', 'turret_metal']);
    expect(probes.probes.length).toBeGreaterThanOrEqual(150);
  });

  it('round-trips within 2 degrees at EVERY probe (GLTFLoader negates normalScale.y: -1)', () => {
    const errs = probes.probes.map((p) => errorDeg(p, -1));
    expect(Math.max(...errs)).toBeLessThan(2);
  });

  it('is independent of the view the derivatives are taken in', () => {
    const errs = probes.probes.slice(0, 40).map((p, k) => errorDeg(p, -1, 0.37 * (k + 1)));
    expect(Math.max(...errs)).toBeLessThan(2);
  });

  it('a FLIPPED green channel fails: the same maps under normalScale.y = +1', () => {
    const errs = probes.probes.map((p) => errorDeg(p, +1));
    expect(Math.max(...errs)).toBeGreaterThan(2);
    // not an edge case: most steep texels are wrong, not one
    expect(errs.filter((e) => e > 2).length).toBeGreaterThan(probes.probes.length * 0.5);
  });
});

describe('the shipped maps are the generator\'s, and say so', () => {
  const sha = (): string => {
    const h = createHash('sha256');
    h.update(readFileSync(GENERATOR));
    h.update(readFileSync(READER));
    return h.digest('hex');
  };

  it('the GLB and the probe table declare the hash of the generator source in the tree', () => {
    const scene = doc.getRoot().listScenes()[0]!;
    const maps = (scene.getExtras() as Record<string, { generator_sha256: string; size: number }>)[MAPS_EXTRAS_KEY]!;
    expect(maps.generator_sha256).toBe(sha());
    expect(probes.generator_sha256).toBe(sha());
  });

  it('marks the one material authored, with a team luma, and ships exactly three images', () => {
    const mats = doc.getRoot().listMaterials();
    expect(mats).toHaveLength(1);
    const ex = mats[0]!.getExtras() as Record<string, unknown>;
    expect(ex[ORM_EXTRAS_KEY]).toBe(true);
    expect(ex[TEAM_LUMA_KEY]).toBeGreaterThan(0);
    expect(doc.getRoot().listTextures().map((t) => t.getMimeType())).toEqual(['image/jpeg', 'image/png', 'image/png']);
    // one ORM texture serves occlusion AND metal-roughness
    expect(mats[0]!.getOcclusionTexture()).toBe(mats[0]!.getMetallicRoughnessTexture());
  });

  it('the team mask is about 2% of the surface, inside the approved band', () => {
    const maps = (doc.getRoot().listScenes()[0]!.getExtras() as Record<string, { team_fraction: number }>)[MAPS_EXTRAS_KEY]!;
    expect(maps.team_fraction).toBeGreaterThanOrEqual(TEAM_FRACTION_BAND[0]);
    expect(maps.team_fraction).toBeLessThanOrEqual(TEAM_FRACTION_BAND[1]);
  });

  it('the ORM alpha is binary and its zero texels are the declared team texels', () => {
    const mat = doc.getRoot().listMaterials()[0]!;
    const orm = PNG.sync.read(Buffer.from(mat.getOcclusionTexture()!.getImage()!));
    let zero = 0;
    for (let i = 3; i < orm.data.length; i += 4) {
      const a = orm.data[i]!;
      if (a !== 0 && a !== 255) throw new Error(`ORM alpha ${a} is not binary`);
      if (a === 0) zero++;
    }
    const maps = (doc.getRoot().listScenes()[0]!.getExtras() as Record<string, { team_texels: number }>)[MAPS_EXTRAS_KEY]!;
    expect(zero).toBe(maps.team_texels);
  });

  it('the generator never imports mathutils.noise (Blender 5.2 reseeds it per process)', () => {
    const src = readFileSync(GENERATOR, 'utf8');
    expect(src).not.toMatch(/^\s*(from|import)\s+mathutils/m);
    expect(src).not.toMatch(/\bimport bpy\b/);
    expect(src).not.toMatch(/np\.random\.(rand|randn|random|seed)\b/);
  });
});

describe('determinism', () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'rl-lavi-maps-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const run = (tag: string): { normal: Buffer; orm: Buffer; report: string } => {
    const out = path.join(scratch, tag);
    const r = spawnSync(
      'python3',
      [GENERATOR, '--glb', LAVI, '--kit', path.join(REPO, 'art', 'parts', 'kit', 'mbt_lavi.glb'), '--out', out, '--size', '256'],
      { encoding: 'utf8' }
    );
    if (r.status !== 0) throw new Error(`generator failed:\n${r.stderr}`);
    return {
      normal: readFileSync(path.join(out, 'normal.png')),
      orm: readFileSync(path.join(out, 'orm.png')),
      report: readFileSync(path.join(out, 'report.json'), 'utf8'),
    };
  };

  it('two runs of the generator are byte-identical (256 px; the maps pass runs it at 2048)', () => {
    const a = run('a');
    const b = run('b');
    expect(a.normal.equals(b.normal)).toBe(true);
    expect(a.orm.equals(b.orm)).toBe(true);
    expect(a.report).toBe(b.report);
  }, 240_000);
});
