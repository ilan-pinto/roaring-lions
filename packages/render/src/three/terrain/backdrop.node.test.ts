/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T10) gates for `backdrop.node.ts`. The graph is compiled to GLSL by three's own `GLSLNodeBuilder` (no GPU) on a real
 * `MeshStandardMaterial` built by `buildBackdrop`, so these read the real generated shader. Each spec names its one-line mutation in
 * the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import { MATERIAL_MATHS } from '../material-maths';
import { backdropFadeOps, BACKDROP_FADE_KEY as LEGACY_KEY, buildBackdrop, type BackdropSpec, type LoadedBackdropKit } from './backdrop';
import { BACKDROP_BOUND_KEY, BACKDROP_FADE_KEY, createNodeBackdropMaterial, NODE_BACKDROP_MATERIAL_NAME, type BackdropTwinBound } from './backdrop.node';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from '../node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from '../backend/unported';

// LITERALS, never imported from the code under test: a 48 x 32 map, the fade from 12 to 19.2 tiles past it (M = 24: 0.5 and 0.8).
const SIZE: [number, number] = [48, 32];
const FADE: [number, number] = [12, 19.2];
const BG: [number, number, number] = [0.1, 0.2, 0.4];
const LIT: [number, number, number] = [0.8, 0.6, 0.2];

const fade = (x: number, z: number, lit = LIT) =>
  backdropFadeOps(NUMBER_OPS, { x, z, sizeX: SIZE[0], sizeZ: SIZE[1], fadeFrom: FADE[0], fadeTo: FADE[1], lit, bg: BG });

describe('G1: the fade on numbers (literals)', () => {
  it('inside the map, and exactly on its edge, is the lit colour (f = 0)', () => {
    expect(fade(10, 10).rgb).toEqual(LIT);
    expect(fade(0, 0).f).toBe(0);
    expect(fade(48, 32).f).toBe(0);
  });
  it('at and below the fade start is untouched, and just past it moves', () => {
    // 12 tiles beyond the east edge: length 12, the smoothstep's lower edge.
    expect(fade(60, 10).f).toBe(0);
    expect(fade(60.5, 10).f).toBeGreaterThan(0);
    // The middle of the ramp: smoothstep(12, 19.2, 15.6) = 0.5 exactly.
    expect(fade(63.6, 10).f).toBeCloseTo(0.5, 12);
    expect(fade(63.6, 10).rgb[0]).toBeCloseTo(0.5 * LIT[0] + 0.5 * BG[0], 12);
  });
  it('at and beyond the fade end is exactly the background', () => {
    for (const at of [fade(48 + 19.2, 10), fade(-30, -30)]) {
      expect(at.f).toBe(1);
      BG.forEach((c, i) => expect(at.rgb[i]).toBeCloseTo(c, 12));
    }
  });
  it('past a corner the distance is the LENGTH of the two overshoots, not their max', () => {
    // 9 east and 9 south of the corner: length 12.73 (> 12), but max(9, 9) = 9 (< 12).
    const f = fade(48 + 9, 32 + 9).f;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeCloseTo(((d) => d * d * (3 - 2 * d))((Math.hypot(9, 9) - 12) / 7.2), 12);
  });
  it('west and north overshoots count from 0, the east and south from the size', () => {
    expect(fade(-15.6, 10).f).toBeCloseTo(0.5, 12);
    expect(fade(10, -15.6).f).toBeCloseTo(0.5, 12);
    expect(fade(10, 32 + 15.6).f).toBeCloseTo(0.5, 12);
  });
  it('the lit colour is what is mixed: the same position with a different lit colour moves the result', () => {
    const a = fade(63.6, 10, [0, 0, 0]);
    const b = fade(63.6, 10, [1, 1, 1]);
    expect(b.rgb[0] - a.rgb[0]).toBeCloseTo(0.5, 12);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

// The kit fixture reads the shipped GLB through `import.meta.url`, which jsdom's URL breaks; the fade does not depend on the kit's geometry.
const kitSource = { pieces: new Map() } as unknown as LoadedBackdropKit['source'];
const SPEC: BackdropSpec = { valley: 'ns', crest: 48, seed: 7, kit: 'wadi_halam_kit', pieces: [] };

function loadedKit(): LoadedBackdropKit {
  const map = new THREE.DataTexture(new Uint8Array([200, 190, 170, 255]), 1, 1);
  map.needsUpdate = true;
  const olive = new THREE.BoxGeometry(1, 1, 1);
  return { map, olive, source: kitSource } as unknown as LoadedBackdropKit;
}

interface Compiled {
  readonly glsl: string;
  readonly vertex: string;
  readonly used: ReadonlySet<unknown>;
}

async function compile(mesh: THREE.Mesh): Promise<Compiled> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  // An instanced mesh asks the uninitialised backend for its uniform-buffer limit: a tiny one takes the instance-ATTRIBUTE path.
  (r as unknown as { backend: { capabilities: { getUniformBufferLimit(): number } } }).backend.capabilities = { getUniformBufferLimit: () => 16 };
  const builder = new W.GLSLNodeBuilder(mesh as never, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { fragment: Array<{ node: unknown }> };
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return { glsl: builder.fragmentShader, vertex: builder.vertexShader, used: new Set<unknown>(builder.uniforms.fragment.map((u) => u.node)) };
}

async function legacyMaterial(): Promise<THREE.MeshStandardMaterial> {
  const rim = () => 0;
  const b = buildBackdrop(SPEC, loadedKit(), rim, 48, 32, '#33261a');
  const m = (b.group.getObjectByName('backdrop-kit') as THREE.Mesh).material as THREE.MeshStandardMaterial;
  return m;
}

async function twinOf(legacy: THREE.MeshStandardMaterial): Promise<THREE.Material> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  return createNodeBackdropMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.backdrop }, legacy);
}
const boundOf = (m: THREE.Material): BackdropTwinBound => m.userData[BACKDROP_BOUND_KEY] as BackdropTwinBound;

describe('the legacy side', () => {
  it('names the record under the key both sides spell, with the literals the fade is built from', async () => {
    expect(BACKDROP_FADE_KEY).toBe(LEGACY_KEY);
    const m = await legacyMaterial();
    const rec = m.userData[LEGACY_KEY] as { bg: { value: THREE.Vector3 }; size: { value: THREE.Vector2 }; fade: { value: THREE.Vector2 } };
    expect(rec.size.value.toArray()).toEqual([48, 32]);
    expect(rec.fade.value.x).toBeCloseTo(rec.fade.value.y * (0.5 / 0.8), 12);
    // The record is what the legacy shader binds, by reference.
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' };
    m.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uBdBg).toBe(rec.bg);
    expect(shader.uniforms.uBdSize).toBe(rec.size);
    expect(shader.uniforms.uBdFade).toBe(rec.fade);
  });
});

describe('the twin graph', () => {
  it('is a lit standard node material carrying the legacy look, the census name and a fade output node', async () => {
    const legacy = await legacyMaterial();
    const t = (await twinOf(legacy)) as THREE.MeshStandardMaterial & { outputNode: unknown; colorNode: unknown };
    expect(t.name).toBe(NODE_BACKDROP_MATERIAL_NAME);
    expect(t.name.startsWith('rl-node-material-')).toBe(true);
    expect(t.map).toBe(legacy.map);
    expect([t.roughness, t.metalness, t.envMapIntensity]).toEqual([legacy.roughness, legacy.metalness, legacy.envMapIntensity]);
    expect(t.envMap).toBeNull();
    expect(t.outputNode).not.toBeNull();
  });

  it('G3: the fade is the OUTPUT term, after lighting, and the colour node stays the stock lit albedo', async () => {
    const legacy = await legacyMaterial();
    const t = (await twinOf(legacy)) as THREE.Material & { colorNode: unknown };
    expect(t.colorNode).toBeNull();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), t);
    const { glsl } = await compile(mesh);
    // The program's last word on the colour is the mix of three's lit variable (`Output`) toward the background, by the fade; the
    // lit total is assigned before it, and the fade itself reads no albedo.
    const final = /fragColor = vec4\( mix\( Output\.x, nodeUniform\d+\.x, (nodeVar\d+) \), mix\( Output\.y, nodeUniform\d+\.y, \1 \), mix\( Output\.z, nodeUniform\d+\.z, \1 \), Output\.w \);/.exec(glsl);
    expect(final, 'the final colour is not mix(Output, background, fade)').not.toBeNull();
    expect(glsl.indexOf('Output = ')).toBeGreaterThanOrEqual(0);
    expect(glsl.indexOf('Output = ')).toBeLessThan((final as RegExpExecArray).index);
    const fadeLine = new RegExp(`${(final as RegExpExecArray)[1]} = smoothstep[^;]*;`).exec(glsl);
    expect(fadeLine, 'no fade line').not.toBeNull();
    expect((fadeLine as RegExpExecArray)[0]).not.toContain('DiffuseColor');
  });

  it('G2: uBdBg, uBdSize and uBdFade each reach the graph', async () => {
    const legacy = await legacyMaterial();
    const t = await twinOf(legacy);
    const { used } = await compile(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), t));
    for (const [name, node] of Object.entries(boundOf(t))) expect(used.has(node), `${name} is bound but the graph never reads it`).toBe(true);
  });

  it('G2: the uniforms share the legacy record\'s vectors by reference', async () => {
    const legacy = await legacyMaterial();
    const t = await twinOf(legacy);
    const rec = legacy.userData[LEGACY_KEY] as { bg: { value: THREE.Vector3 }; size: { value: THREE.Vector2 }; fade: { value: THREE.Vector2 } };
    const b = boundOf(t) as unknown as Record<string, { value: unknown }>;
    expect(b.uBdBg?.value).toBe(rec.bg.value);
    expect(b.uBdSize?.value).toBe(rec.size.value);
    expect(b.uBdFade?.value).toBe(rec.fade.value);
  });

  it('G2: on the olives (an InstancedMesh) the fragment world position comes from the INSTANCE matrix', async () => {
    const legacy = await legacyMaterial();
    const t = await twinOf(legacy);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), t, 3);
    const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), t);
    const i = await compile(inst);
    const p = await compile(plain);
    // The instanced local position is `instanceMatrix * position`, assigned to `positionLocal` BEFORE the world-position varying
    // (the fade's x, z) is written from `positionLocal`: the legacy hook's `modelMatrix * instanceMatrix * position`.
    const instanced = /positionLocal = \( nodeVar\d+ \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/.exec(i.vertex);
    const worldI = /v_positionWorld = \( \w+ \* vec4\( ([^,]+), 1\.0 \) \)\.xyz;/.exec(i.vertex);
    expect(instanced, 'the instance matrix never reaches positionLocal').not.toBeNull();
    expect(worldI, 'no world-position varying').not.toBeNull();
    expect((worldI as RegExpExecArray)[1]).toBe('positionLocal');
    expect((instanced as RegExpExecArray).index).toBeLessThan((worldI as RegExpExecArray).index);
    // A plain mesh has no instance step.
    expect(p.vertex).not.toMatch(/positionLocal = \( nodeVar\d+ \* vec4\( positionLocal/);
  });
});

describe('the seam', () => {
  it('a legacy backdrop material is recognised, adopted, and its twin takes the legacy render state', async () => {
    const legacy = await legacyMaterial();
    expect(legacyTwinSlot(legacy)).toBe('backdrop');
    expect(PORTED_MATERIAL_KEYS.has('rl-backdrop-fade')).toBe(true);
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), legacy);
    const g = new THREE.Group();
    g.add(mesh);
    const cache = createTwinCache();
    const n = adoptMaterials(g, { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: null, backdrop: (l) => createNodeBackdropMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.backdrop }, l) }, cache);
    expect(n).toBe(1);
    expect(mesh.material).not.toBe(legacy);
    expect((mesh.material as THREE.Material).name).toBe(NODE_BACKDROP_MATERIAL_NAME);
    // The ported legacy hook is not reported as unported once its key is listed.
    expect(censusUnported(g, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
  });
});
