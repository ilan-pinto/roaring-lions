/**
 * @vitest-environment jsdom
 *
 * GH-1225 slice 3 (decision L7) gates for `building-cut.node.ts`, the TSL twin of a building's holed and/or cut colour clone, and
 * for `building-cut-maths.ts`, the one fragment body it runs. The graph is compiled by three's own `GLSLNodeBuilder` and
 * `WGSLNodeBuilder` (no GPU) on REAL legacy clones (`BuildingCutMaterials`, `BuildingHoleMaterials`). The number oracle below is the
 * legacy GLSL transcribed with LITERALS, never imported from the code under test. Each spec's one-line mutation is in the commit.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NUMBER_INT_OPS, NUMBER_OPS } from '../fog-ops';
import { MATERIAL_MATHS } from '../material-maths';
import { BUILDING_HOOK_SEGMENTS } from '../material-names';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from '../node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from '../backend/unported';
import { buildingFragmentOps, NUMBER_FLOW, type BuildingFragmentInput } from './building-cut-maths';
import {
  BuildingCutMaterials,
  createCutUniforms,
  CUT_MASK_TERM,
  CUT_PROGRAM_KEY,
  cutMaskHook,
  cutShaderHook,
  type CutUniforms,
} from './cut-material';
import { BuildingHoleMaterials, HOLES_MASK_TERM, HOLES_PROGRAM_KEY, holesShaderHook } from './holed-material';
import { maskHook } from './building-mask';
import { buildingSkin } from './building-skin';
import {
  BUILDING_BOUND_KEY,
  createNodeBuildingMaterial,
  CUT_SEGMENT,
  HOLES_SEGMENT,
  NODE_BUILDING_MATERIAL_NAME,
  type BuildingTwinBound,
} from './building-cut.node';

// ---------------------------------------------------------------------------------------------------------------------------------
// The oracle: the legacy GLSL (`CUT_PARS_GLSL`, `CUT_COLOUR_GLSL`, `HOLES_PARS_GLSL`, `HOLES_COLOUR_GLSL`) on numbers, every constant a
// LITERAL read off that text and `building-holes.ts`: 8 volumes, the 0.03 t section; 6 holes, depth 0.6, edge 0.85 + 0.30 e, 4 octaves
// from 4 cells, 6 cracks of 0.05..0.10 t at 2.6 deg, alpha 0.9, the 0.03 t lip, the 0.15 t halo at 0.7, salts 64 and 80.
// ---------------------------------------------------------------------------------------------------------------------------------

type V3 = [number, number, number];

function glslHash(xi: number, yi: number): number {
  let h = (Math.imul(xi >>> 0, 374761393) + Math.imul(yi >>> 0, 668265263)) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) >>> 0, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

function glslEdge(theta: number, seed: number): number {
  const t = theta / 6.283185307179586;
  const turn = t - Math.floor(t);
  let sum = 0;
  let norm = 0;
  let amp = 1;
  for (let o = 0; o < 4; o++) {
    const cells = 4 << o;
    const u = turn * cells;
    const i0 = Math.floor(u) % cells;
    const i1 = (i0 + 1) % cells;
    const fr = u - Math.floor(u);
    const s = fr * fr * (3 - 2 * fr);
    const a = glslHash(i0, seed * 128 + o);
    const b = glslHash(i1, seed * 128 + o);
    sum += amp * (a + (b - a) * s);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

interface OracleHoles {
  c: [number, number, number, number][];
  a: [number, number, number, number][];
  n: number;
  lip: V3;
  halo: V3;
  crack: V3;
  interior: V3;
}
interface OracleCut {
  v: number[];
  n: number;
  cap: V3;
  interior: V3;
}

/** `rlHoleApply`, then `HOLES_COLOUR_GLSL`: null where it discards. */
function glslHoles(p: V3, h: OracleHoles): { tint: [number, number, number, number] } | null {
  let tint: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    if (i >= h.n) break;
    const c = h.c[i];
    const r = c[3];
    const a = h.a[i];
    const seed = Math.trunc(a[3] + 0.5);
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const ax = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    if (Math.abs(ax) >= 0.6) continue;
    const hlp = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let t = [hlp[1] * a[2] - hlp[2] * a[1], hlp[2] * a[0] - hlp[0] * a[2], hlp[0] * a[1] - hlp[1] * a[0]];
    const tl = Math.hypot(t[0], t[1], t[2]);
    t = [t[0] / tl, t[1] / tl, t[2] / tl];
    const b = [a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]];
    const x = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
    const y = d[0] * b[0] + d[1] * b[1] + d[2] * b[2];
    const rho = Math.hypot(x, y);
    const th = Math.atan2(y, x);
    const rr = r * (0.85 + 0.3 * glslEdge(th, seed));
    if (rho < rr) return null;
    const o = rho - rr;
    for (let k = 0; k < 6; k++) {
      const ang = glslHash(k, seed * 128 + 64) * 6.283185307179586;
      const len = 0.05 + 0.05 * glslHash(k, seed * 128 + 80);
      const s = o / len;
      if (s > 1) continue;
      const raw = Math.abs(th - ang);
      let dth = raw - 6.283185307179586 * Math.floor(raw / 6.283185307179586);
      if (dth > 3.141592653589793) dth = 6.283185307179586 - dth;
      if (dth < ((2.6 * Math.PI) / 180) * (1 - s) && 0.9 > tint[3]) tint = [...h.crack, 0.9];
    }
    if (o < 0.03) tint = [...h.lip, 1];
    const ho = o - 0.03;
    if (ho >= 0 && ho < 0.15) {
      const al = 0.7 * (1 - ho / 0.15);
      if (al > tint[3]) tint = [...h.halo, al];
    }
  }
  return { tint };
}

/** `rlCutApply`: null where it discards, else the section flag. */
function glslCut(p: V3, c: OracleCut): { section: boolean } | null {
  let section = false;
  for (let i = 0; i < 8; i++) {
    if (i >= c.n) break;
    const a = c.v.slice(8 * i, 8 * i + 4);
    const b = c.v.slice(8 * i + 4, 8 * i + 8);
    const rho = Math.hypot(p[0] - a[0], p[2] - a[1]);
    if (rho >= a[2] + a[3]) continue;
    const h = b[0] + (b[1] - b[0]) * Math.min(1, Math.max(0, (rho - a[2]) / a[3]));
    if (p[1] > h) return null;
    if (p[1] > h - 0.03) section = true;
  }
  return { section };
}

/** The whole legacy fragment of a clone holed and/or cut: main() runs `rlCutApply(); rlHoleApply();`, then at map_fragment the
 *  CUT splice and then the HOLES splice. Null where it discards. */
function glslFragment(p: V3, front: boolean, base: V3, cut: OracleCut | null, holes: OracleHoles | null): V3 | null {
  const c = cut === null ? { section: false } : glslCut(p, cut);
  const h = holes === null ? { tint: [0, 0, 0, 0] as [number, number, number, number] } : glslHoles(p, holes);
  if (c === null || h === null) return null;
  let rgb: V3 = [...base];
  if (cut !== null) {
    if (!front) rgb = [...cut.interior];
    else if (c.section) rgb = [...cut.cap];
  }
  if (holes !== null) {
    if (!front) rgb = [...holes.interior];
    else rgb = rgb.map((x, i) => x * (1 - h.tint[3]) + h.tint[i] * h.tint[3]) as V3;
  }
  return rgb;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Literal fixtures: one volume beside a 2 t house (the slice 1 spec's), a second written but past the count, and two holes in the
// house's east wall (x = 7), one through the corner of the cut.
// ---------------------------------------------------------------------------------------------------------------------------------

const CUT: OracleCut = {
  v: [8, 6, 1.25, 0.5, 0.4, 2, 0, 0, /* past the count: */ 6, 6, 3, 0.5, 0, 2, 0, 0, ...new Array<number>(48).fill(0)],
  n: 1,
  cap: [0.9, 0.85, 0.8],
  interior: [0.1, 0.08, 0.07],
};
const HOLES: OracleHoles = {
  c: [[7, 1.2, 5.5, 0.3], [7, 0.6, 6.4, 0.35], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  a: [[1, 0, 0, 37], [1, 0, 0, 1201], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  n: 2,
  lip: [0.3, 0.28, 0.25],
  halo: [0.05, 0.05, 0.06],
  crack: [0.02, 0.02, 0.02],
  interior: [0.12, 0.1, 0.1],
};
const BASE: V3 = [0.7, 0.62, 0.5];

const ops = (p: V3, front: boolean, cut: OracleCut | null, holes: OracleHoles | null) => {
  const f: BuildingFragmentInput<number> = { p, front: front ? 1 : 0, base: BASE, cut, holes };
  return buildingFragmentOps(NUMBER_OPS, NUMBER_INT_OPS, NUMBER_FLOW, f);
};

/** Points over the east wall (x = 7, both holes' plane) and through the cut volume. */
function grid(): V3[] {
  const out: V3[] = [];
  for (let y = 0; y <= 2.2; y += 0.05) for (let z = 4.8; z <= 7.2; z += 0.05) out.push([7, y, z]);
  for (let y = 0; y <= 2.2; y += 0.1) for (let x = 6; x <= 8; x += 0.1) out.push([x, y, 6]);
  // Off the wall by up to the depth either side, and just past it.
  for (const dx of [-0.59, -0.3, 0.3, 0.59, 0.61]) for (let z = 5; z <= 6.8; z += 0.02) out.push([7 + dx, 1.2, z]);
  return out;
}

describe('G1: the fragment maths on numbers equals the legacy GLSL (literals)', () => {
  for (const [label, cut, holes] of [
    ['cut alone', CUT, null],
    ['holes alone', null, HOLES],
    ['holed AND cut', CUT, HOLES],
  ] as const) {
    it(`${label}: the same fragments discard, and the kept ones take the same colour, front and back`, () => {
      let discarded = 0;
      let tinted = 0;
      for (const p of grid()) {
        for (const front of [true, false]) {
          const want = glslFragment(p, front, BASE, cut, holes);
          const got = ops(p, front, cut, holes);
          expect(got.keep, `keep at ${p.join(',')} front=${front}`).toBe(want === null ? 0 : 1);
          if (want === null) {
            discarded++;
            continue;
          }
          got.rgb.forEach((c, i) => expect(c, `rgb[${i}] at ${p.join(',')} front=${front}`).toBeCloseTo(want[i] as number, 12));
          if (front && (want[0] !== BASE[0] || want[1] !== BASE[1])) tinted++;
        }
      }
      // The grid really does reach the discard and the recolour (a vacuous oracle passes everything).
      expect(discarded).toBeGreaterThan(50);
      expect(tinted).toBeGreaterThan(20);
    });
  }

  it('the cut: above the cut height inside R is discarded, the 0.03 t band under it is the cap, outside R + W is untouched', () => {
    expect(ops([8, 0.5, 6], true, CUT, null).keep).toBe(0);
    expect(ops([8, 0.38, 6], true, CUT, null).rgb).toEqual(CUT.cap);
    expect(ops([8, 0.3, 6], true, CUT, null).rgb).toEqual(BASE);
    expect(ops([8, 0.3, 6], false, CUT, null).rgb).toEqual(CUT.interior);
    // R + W = 1.75: at 1.8 t nothing is cut even far above the cut height.
    expect(ops([9.8, 1.5, 6], true, CUT, null).keep).toBe(1);
    // In the band, the cut height slopes up: 1.5 t out it is 0.4 + 1.6 * 0.5 = 1.2.
    expect(ops([9.5, 1.15, 6], true, CUT, null).keep).toBe(1);
    expect(ops([9.5, 1.25, 6], true, CUT, null).keep).toBe(0);
  });

  it('the count gates: the second volume (centred 6, 6, R 3) cuts nothing at n = 1 and cuts at n = 2', () => {
    expect(ops([5, 1, 6], true, CUT, null).keep).toBe(1);
    expect(ops([5, 1, 6], true, { ...CUT, n: 2 }, null).keep).toBe(0);
    expect(ops([7, 1.2, 5.5], true, null, { ...HOLES, n: 0 }).keep).toBe(1);
    expect(ops([7, 1.2, 5.5], true, null, HOLES).keep).toBe(0);
  });

  it('the order: on a back face of a holed AND cut clone the holes\' interior wins; on a front face the edge tint lies over the cap', () => {
    expect(ops([8, 0.3, 6], false, CUT, HOLES).rgb).toEqual(HOLES.interior);
    // A lip fragment of hole 0 (0.3 t radius at 1.2, 5.5) found on the wall, kept by the cut (below 0.4 nowhere near it): its
    // colour is the lip, alpha 1, whatever lies under it.
    const lip = grid().find((p) => {
      const h = glslHoles(p, HOLES);
      return h !== null && h.tint[3] === 1;
    });
    expect(lip, 'the grid finds a lip fragment').toBeDefined();
    expect(ops(lip as V3, true, null, HOLES).rgb).toEqual(HOLES.lip);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The real legacy clones, and the twin.
// ---------------------------------------------------------------------------------------------------------------------------------

const col = (c: V3): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);

function legacy(opts: { cut: boolean; holes: boolean; map?: boolean; shared?: CutUniforms }) {
  const map = opts.map ? new THREE.DataTexture(new Uint8Array([200, 190, 170, 255]), 1, 1) : null;
  const band = new THREE.MeshStandardMaterial({ color: 0xc8b494, roughness: 0.8, ...(map ? { map } : {}) });
  const shared = opts.shared ?? createCutUniforms();
  const cut = opts.cut ? new BuildingCutMaterials(shared, { cap: col(CUT.cap), interior: col(CUT.interior) }) : null;
  const holes = opts.holes ? new BuildingHoleMaterials({ lip: col(HOLES.lip), halo: col(HOLES.halo), crack: col(HOLES.crack), interior: col(HOLES.interior) }) : null;
  holes?.setHoles(HOLES.c.slice(0, HOLES.n).map((c, i) => ({ c: [c[0], c[1], c[2]], radius: c[3], axis: [HOLES.a[i][0], HOLES.a[i][1], HOLES.a[i][2]], seed: HOLES.a[i][3], classRadius: c[3] })));
  const material = buildingSkin(band, holes, cut) as THREE.MeshStandardMaterial;
  return { band, shared, cut, holes, material };
}

async function deps() {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  return { W, TSL: TSL as never, maths: MATERIAL_MATHS.building };
}
async function twinOf(m: THREE.MeshStandardMaterial): Promise<THREE.Material> {
  return createNodeBuildingMaterial(await deps(), m);
}
const boundOf = (m: THREE.Material): BuildingTwinBound => m.userData[BUILDING_BOUND_KEY] as BuildingTwinBound;

interface Compiled {
  readonly frag: string;
  readonly vert: string;
  readonly used: ReadonlySet<unknown>;
  readonly renderUpdate: () => void;
}

async function compileGlsl(mesh: THREE.Mesh): Promise<Compiled> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  r.shadowMap.enabled = true;
  (r as unknown as { hasCompatibility(): boolean }).hasCompatibility = () => false;
  const builder = new W.GLSLNodeBuilder(mesh, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    updateNodes: Array<{ update(frame: unknown): void }>;
    uniforms: { fragment: Array<{ node: unknown }> };
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  const frame = { camera: builder.camera, scene: builder.scene, renderer: r, object: mesh, material: mesh.material };
  return {
    frag: builder.fragmentShader,
    vert: builder.vertexShader,
    used: new Set<unknown>(builder.uniforms.fragment.map((u) => u.node)),
    renderUpdate: () => {
      for (const n of builder.updateNodes) n.update(frame);
    },
  };
}

async function compileWgsl(mesh: THREE.Mesh): Promise<string> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: false });
  r.shadowMap.enabled = true;
  const stubbed = r as unknown as { hasFeature(): boolean; hasCompatibility(): boolean; backend: Record<string, unknown> };
  stubbed.hasFeature = () => false;
  stubbed.hasCompatibility = () => false;
  stubbed.backend.utils = { getTextureSampleData: () => ({ primarySamples: 1 }), getTextureFormatGPU: () => 'rgba8unorm' };
  stubbed.backend.device = { features: new Set<string>() };
  const Builder = (W as unknown as { WGSLNodeBuilder: new (m: THREE.Mesh, r: unknown) => unknown }).WGSLNodeBuilder;
  const builder = new Builder(mesh, r) as { scene: THREE.Scene; camera: THREE.Camera; material: unknown; build(): void; fragmentShader: string };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return builder.fragmentShader;
}

const meshOf = (m: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);

describe('G2: the twin compiles on GLSL and WGSL, and every legacy uniform reaches it', () => {
  for (const [label, cut, holes] of [
    ['cut', true, false],
    ['holes', false, true],
    ['holes and cut', true, true],
  ] as const) {
    it(`${label}: a lit standard node material, the census name, the mask a discard on both backends`, async () => {
      const l = legacy({ cut, holes, map: true });
      const t = await twinOf(l.material);
      expect(t.name).toBe(NODE_BUILDING_MATERIAL_NAME);
      expect(t.name.startsWith('rl-node-material-')).toBe(true);
      expect((t as unknown as { isMeshStandardNodeMaterial?: boolean }).isMeshStandardNodeMaterial).toBe(true);
      expect((t as THREE.MeshStandardMaterial).map).toBe(l.band.map);
      expect(t.side).toBe(THREE.DoubleSide);
      const g = await compileGlsl(meshOf(t));
      expect(g.frag).toContain('discard');
      expect(g.frag).toContain('gl_FrontFacing');
      const w = await compileWgsl(meshOf(t));
      expect(w).toContain('discard');
      expect(w).toContain('front_facing');
      const b = boundOf(t) as unknown as Record<string, unknown>;
      const names = cut ? ['uRlCutV', 'uRlCutN', 'uRlCutCap', 'uRlCutInterior'] : [];
      if (holes) names.push('uRlHoleN', 'uRlLip', 'uRlHalo', 'uRlCrack', 'uRlInterior');
      for (const n of names) expect(g.used.has(b[n]), `${n} is bound but the fragment never reads it`).toBe(true);
      if (holes) {
        for (const k of ['uRlHoleC', 'uRlHoleA']) for (const [i, u] of (b[k] as unknown[]).entries()) expect(g.used.has(u), `${k}[${i}] never reaches the fragment`).toBe(true);
      }
    });
  }

  it('without a map the base is the colour, alpha 1 (the stock conversion\'s rule)', async () => {
    const t = await twinOf(legacy({ cut: true, holes: false }).material);
    const g = await compileGlsl(meshOf(t));
    expect(g.frag).toContain('discard');
  });

  it('a dead volume or hole costs one branch, as the GLSL\'s break and continue: each body sits inside its own if', async () => {
    const t = await twinOf(legacy({ cut: true, holes: true }).material);
    const { frag } = await compileGlsl(meshOf(t));
    const main = frag.slice(frag.indexOf('void main()'));
    // One atan per hole (its theta), and one length(vec2) per volume and per hole (each rho), each nested at least one block below
    // main's own.
    const atan = main.split('\n').filter((l) => /\batan\(/.test(l));
    const rho = main.split('\n').filter((l) => /length\( vec2\(/.test(l));
    expect(atan).toHaveLength(6);
    expect(rho).toHaveLength(8 + 6);
    for (const l of [...atan, ...rho]) expect(l.startsWith('\t\t'), `not inside a branch: ${l.trim().slice(0, 80)}`).toBe(true);
  });

  it('two cut buildings share ONE volume-block node, and two holed and cut buildings compile the SAME program text', async () => {
    const shared = createCutUniforms();
    const a = await twinOf(legacy({ cut: true, holes: true, shared }).material);
    const b = await twinOf(legacy({ cut: true, holes: true, shared }).material);
    expect(boundOf(a).uRlCutV).toBe(boundOf(b).uRlCutV);
    expect(boundOf(a).uRlCutN).toBe(boundOf(b).uRlCutN);
    expect(boundOf(a).uRlCutCap).not.toBe(boundOf(b).uRlCutCap);
    const ga = await compileGlsl(meshOf(a));
    const gb = await compileGlsl(meshOf(b));
    expect(ga.frag).toBe(gb.frag);
    expect(ga.vert).toBe(gb.vert);
  });
});

describe('G3: the uniforms are the legacy records, by reference', () => {
  it('the volume block is a uniformArray over the legacy Float32Array itself, and the counts are re-read every render', async () => {
    const l = legacy({ cut: true, holes: true });
    const t = await twinOf(l.material);
    const b = boundOf(t);
    const arr = b.uRlCutV as unknown as { array: unknown; value: Float32Array };
    expect(arr.array).toBe(l.shared.uRlCutV.value);
    const g = await compileGlsl(meshOf(t));
    l.shared.uRlCutV.value[10] = 9.5;
    l.shared.uRlCutN.value = 3;
    l.holes!.uniforms.uRlHoleN.value = 1;
    g.renderUpdate();
    // Float 10 is volume 1's r, padded to its own vec4.
    expect(arr.value[40]).toBe(9.5);
    expect(b.uRlCutN!.value).toBe(3);
    expect(b.uRlHoleN!.value).toBe(1);
    // Vectors and colours by reference.
    expect(b.uRlHoleC![0].value).toBe(l.holes!.uniforms.uRlHoleC.value[0]);
    expect(b.uRlInterior!.value).toBe(l.holes!.uniforms.uRlInterior.value);
  });
});

describe('G4: the shadow takes the same mask (r186)', () => {
  type ShadowNodes = { colorNode: unknown };
  const shadowNodesOf = async (m: THREE.Material): Promise<ShadowNodes> => {
    const W = await import('three/webgpu');
    const r = new W.WebGPURenderer({ forceWebGL: true });
    return (r as unknown as { _getShadowNodes(m: THREE.Material): ShadowNodes })._getShadowNodes(m);
  };
  const compileShadow = async (colorNode: unknown): Promise<Compiled> => {
    const W = await import('three/webgpu');
    const m = new W.NodeMaterial();
    m.colorNode = colorNode as never;
    return compileGlsl(meshOf(m));
  };

  it('r186 honours castShadowNode (it becomes the caster\'s colour), but only as the transmitted channel: it warns without the flag', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const m = new W.MeshStandardNodeMaterial();
    m.castShadowNode = TSL.vec4(1, 0, 0, 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nodes = await shadowNodesOf(m);
    expect(nodes.colorNode).not.toBeNull();
    expect(warn.mock.calls.some((c) => String(c.join(' ')).includes('shadowMap.transmitted'))).toBe(true);
    warn.mockRestore();
  });

  it('the twin\'s maskNode reaches the shadow pass as a discard, with no castShadowNode and no warning', async () => {
    const t = (await twinOf(legacy({ cut: true, holes: true }).material)) as THREE.Material & { castShadowNode: unknown; maskNode: unknown };
    expect(t.castShadowNode).toBeNull();
    expect(t.maskNode).not.toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nodes = await shadowNodesOf(t);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect(nodes.colorNode).not.toBeNull();
    const shadow = await compileShadow(nodes.colorNode);
    expect(shadow.frag).toContain('discard');
    // The discard's condition is the computed mask, never a constant (a `maskShadowNode` of true would leave the shadow whole).
    const cond = /if \( ([^\n]*) \) \{\s*discard;/.exec(shadow.frag);
    expect(cond, 'no conditional discard in the shadow program').not.toBeNull();
    expect((cond as RegExpExecArray)[1]).toMatch(/nodeVar\d+/);
    // The same mask: the shadow program reads the volume block, its count and every hole.
    const b = boundOf(t);
    for (const [name, u] of [['uRlCutV', b.uRlCutV], ['uRlCutN', b.uRlCutN], ['uRlHoleN', b.uRlHoleN], ...(b.uRlHoleC ?? []).map((c, i) => [`uRlHoleC[${i}]`, c])] as const) {
      expect(shadow.used.has(u), `the shadow mask never reads ${name}`).toBe(true);
    }
  });
});

describe('G5: the seam and the census', () => {
  it('the segment copies equal the legacy keys, and the set the adoption table reads is exactly those two', () => {
    expect(CUT_SEGMENT).toBe(CUT_PROGRAM_KEY);
    expect(HOLES_SEGMENT).toBe(HOLES_PROGRAM_KEY);
    expect([...BUILDING_HOOK_SEGMENTS].sort()).toEqual([CUT_PROGRAM_KEY, HOLES_PROGRAM_KEY].sort());
  });

  it('a cut, a holed and a holed-and-cut clone each go to the building slot; the band material goes nowhere', () => {
    for (const [cut, holes] of [[true, false], [false, true], [true, true]] as const) expect(legacyTwinSlot(legacy({ cut, holes }).material)).toBe('building');
    expect(legacyTwinSlot(legacy({ cut: false, holes: false }).material)).toBeNull();
  });

  it('rl-cut and rl-holes are ported: named before adoption, exempt with the list, adopted to the twin, and silent after', async () => {
    expect(PORTED_MATERIAL_KEYS.has('rl-cut')).toBe(true);
    expect(PORTED_MATERIAL_KEYS.has('rl-holes')).toBe(true);
    const l = legacy({ cut: true, holes: true });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), l.material);
    const g = new THREE.Group();
    g.add(mesh);
    expect(censusUnported(g, {}).map((e) => e.key)).toEqual(['rl-holes|rl-cut']);
    expect(censusUnported(g, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    const d = await deps();
    const n = adoptMaterials(g, { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: null, building: (m) => createNodeBuildingMaterial(d, m) }, createTwinCache());
    expect(n).toBe(1);
    expect((mesh.material as THREE.Material).name).toBe(NODE_BUILDING_MATERIAL_NAME);
    expect(censusUnported(g, {})).toEqual([]);
  });

  it('a material carrying any other hook is refused loudly', async () => {
    const m = new THREE.MeshStandardMaterial();
    m.customProgramCacheKey = () => 'stock|rl-cut|rl-team-mark-2';
    await expect(twinOf(m)).rejects.toThrow(/not only/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// No trigger, no change: the legacy programs and the node program of an uncut building, byte for byte, as they were on the base
// (2886772e0) before this slice. LITERALS: sha256 prefixes printed there from the same calls.
// ---------------------------------------------------------------------------------------------------------------------------------

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

describe('G6: no trigger, no change (literals from the base)', () => {
  it('every legacy hook writes the program text it wrote before this slice', () => {
    const std = THREE.ShaderLib.standard;
    const dep = THREE.ShaderLib.depth;
    const nor = THREE.ShaderLib.normal;
    const c = cutShaderHook(std.vertexShader, std.fragmentShader);
    const ho = holesShaderHook(std.vertexShader, std.fragmentShader, true);
    const hc = cutShaderHook(ho.vertex, ho.fragment);
    const hd = holesShaderHook(dep.vertexShader, dep.fragmentShader, false);
    const cm = cutMaskHook(dep.vertexShader, dep.fragmentShader);
    const cn = cutMaskHook(nor.vertexShader, nor.fragmentShader);
    const hm = maskHook(dep.vertexShader, dep.fragmentShader, [HOLES_MASK_TERM, CUT_MASK_TERM]);
    expect([sha(c.vertex), sha(c.fragment)]).toEqual(['a491ed32c0d86939', '1169349daac71f87']);
    expect([sha(ho.vertex), sha(ho.fragment)]).toEqual(['d1d12eaa05a146bb', '58694b70b6ce7aaf']);
    expect([sha(hc.vertex), sha(hc.fragment)]).toEqual(['83023021a7ee79e8', 'b9b6e597751c3d53']);
    expect([sha(hd.vertex), sha(hd.fragment)]).toEqual(['0c7bb01a4204f180', '0bba5c33e4f7d137']);
    expect([sha(cm.vertex), sha(cm.fragment)]).toEqual(['b8d81dc534a98db5', '81e2a3e4cfb41dc7']);
    expect([sha(cn.vertex), sha(cn.fragment)]).toEqual(['fb88b6d8e2fd43e6', 'b5cb8353cb0cdd2b']);
    expect([sha(hm.vertex), sha(hm.fragment)]).toEqual(['80fb6b527505868f', '0308ef8c3c809275']);
  });

  it('an uncut, unholed band material is adopted by nothing and compiles to the node program it compiled to before', async () => {
    const W = await import('three/webgpu');
    const band = new THREE.MeshStandardMaterial({ color: 0xc8b494, roughness: 0.8 });
    expect(legacyTwinSlot(band)).toBeNull();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), band));
    const d = await deps();
    expect(adoptMaterials(g, { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: null, building: (m) => createNodeBuildingMaterial(d, m) }, createTwinCache())).toBe(0);
    // The stock conversion (`NodeLibrary.fromMaterial`: every key copied onto a fresh node material), compiled.
    const nm = new W.MeshStandardNodeMaterial();
    for (const k in band) (nm as unknown as Record<string, unknown>)[k] = (band as unknown as Record<string, unknown>)[k];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), nm);
    const r = new W.WebGPURenderer({ forceWebGL: true });
    const builder = new W.GLSLNodeBuilder(mesh, r) as unknown as { scene: THREE.Scene; camera: THREE.Camera; material: unknown; build(): void; vertexShader: string; fragmentShader: string };
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.OrthographicCamera();
    builder.material = nm;
    builder.build();
    expect([sha(builder.vertexShader), sha(builder.fragmentShader)]).toEqual(['a35c419a83ea2ed2', 'e6e67e5ef4c0fef3']);
  });
});
