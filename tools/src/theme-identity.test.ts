/**
 * GH-871 P2 T1: what each shipped terrain theme's ground PROGRAM and boot
 * LIGHT are today, pinned before the wetland theme is wired in.
 *
 * `terrain-defaults.test.ts` pins the composed geometry and vertex colours of
 * all 35 maps. It cannot see two things a new theme can still move on a map it
 * never meant to touch: the ground shader's program (`GroundMaterial`'s
 * injected GLSL, its cache key and defines are shared by every theme) and the
 * light a map boots with (sun, hemisphere, shadow map, the fog pass's haze and
 * the output exposure). So one map per shipped theme is booted through the
 * app's own route, `rendererOptionsFor(parseMap(map), HIGH, '/')`, with an
 * `applyTerrain`-built `Sim`, into the real `ThreeRenderer` over a faked
 * `WebGLRenderer` (the `ThreeRenderer.ground-control.test.ts` harness), and
 * two SHA-256 digests are recorded:
 *
 *  - program: `GroundMaterial.onBeforeCompile` applied to three's own
 *    `meshphysical_vert` and `meshphysical_frag` (the `mesh.test.ts`
 *    `compiled()` seam), plus `customProgramCacheKey()` and `defines`.
 *  - light: the sun's intensity, colour (r, g, b) and direction; the
 *    hemisphere's intensity, sky colour and ground colour; the sun's shadow
 *    map size (x, y); the fog pass's `uHazeFar` and `uHazeTint`; its own
 *    `hazeLow` (the value compiled into its source); and the renderer's `toneMappingExposure`.
 *
 *  - scene (GH-871 P4 T1, added before any rain wiring): everything P4 can
 *    touch that `program` and `light` cannot see. The fog pass's fragment
 *    source, defines and uniform names; the foliage material's compiled
 *    vertex and fragment source and cache key (the live `decor-foliage`
 *    batches in the scene, and one built with the renderer's own sway
 *    uniforms, so a map without trees is not a vacuous read); the decal
 *    pool's fragment source, defines and its eight resolved linear colours in
 *    `DECAL_PALETTE_ORDER`; `surfaceMaterialFor`'s roughness and metalness per
 *    `SurfaceClass`; the sun's `shadow.intensity`; the ground material's
 *    sorted uniform names and defines; a census of the scene graph (the count
 *    of `Object3D`s by `type` and the sorted `renderOrder`s of visible
 *    meshes); and the name of the emitter `updateVehicleAmbientFx` chooses
 *    for a moving vehicle (`vehicleMoveEmitterName()`). It is a THIRD digest
 *    so the `program` and `light` lines stay byte-unchanged and the fixture
 *    only gains lines. The rain wiring (P4) must leave the three shipped
 *    entries' `scene` byte-identical.
 *
 * `init()` needs a live GL context, so the fog pass is slotted in the way
 * `init()` does it (`createFogPass()`, then
 * `applyHaze()`), and one `frame()` runs first so the terrain rebuild has run.
 *
 * Regenerate (only for a DELIBERATE change to a shipped theme's program or
 * light, and say so in the commit): `UPDATE_THEME_IDENTITY=1 pnpm vitest run
 * tools/src/theme-identity.test.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// `tools/` declares no `three` dependency, so it is reached through the render
// package that does: the types from its @types/three, the runtime by the
// very file the renderer's own `import 'three'` resolves to (so the mock below
// replaces what the renderer sees).
import type * as ThreeTypes from '../../packages/render/node_modules/@types/three';
// @ts-expect-error TS7016: the entry file carries no declarations; typed by the cast below.
import * as ThreeRuntime from '../../packages/render/node_modules/three/build/three.module.js';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, type MapJson } from '@lions/data';
import { ThreeRenderer } from '../../packages/render/src/three/ThreeRenderer';
import { FogOfWarPass } from '../../packages/render/src/three/fog-pass';
import type { GroundMaterial } from '../../packages/render/src/three/terrain/mesh';
import type { SceneLights } from '../../packages/render/src/three/lighting';
import { swayingFoliageMaterial, type SwayUniforms } from '../../packages/render/src/three/terrain/decor-mesh';
import { surfaceMaterialFor, type SurfaceClass } from '../../packages/render/src/three/units/unit-surface';
import type { ShroudTexture } from '../../packages/render/src/three/shroud-texture';
import { rendererOptionsFor } from '../../packages/app/src/renderer-options';

const THREE = ThreeRuntime as unknown as typeof ThreeTypes;

vi.mock('../../packages/render/node_modules/three/build/three.module.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeTypes>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const FIXTURE = join(__dirname, 'theme-identity.fixture.json');
const UPDATE = process.env.UPDATE_THEME_IDENTITY === '1';
const HIGH = { colorVision: 'default', quality: 'high' } as const;

/**
 * A literal wetland map (GH-871 P2 T4): no wetland map ships until Task 7, so
 * the fourth theme is booted from this fixture. A road, three cover levels and
 * a ridge, so the terrain build has something to draw.
 */
const WETLAND_FIXTURE: MapJson = {
  id: 'wetland_identity_fixture',
  name: 'Wetland identity fixture',
  width: 16,
  height: 16,
  terrain: 'wetland',
  rows: [
    '................',
    '..11............',
    '..11....rrrr....',
    '........r.......',
    '....222.r.......',
    '....222.r..^^...',
    '........r..^^...',
    '..3.....rrrr....',
    '................',
    '................',
    '.1..............',
    '................',
    '......2.........',
    '................',
    '................',
    '................',
  ],
  markers: { entry: [0, 15] },
  zones: { yard: [1, 0, 2, 2] },
};

/** One map per shipped theme, with the theme each is expected to be, then the
 *  wetland fixture. `key` is the fixture file's key. */
const CASES: ReadonlyArray<{ key: string; json: MapJson; terrain: string }> = [
  { key: 'beit_sahwan_outskirts', json: maps.beit_sahwan_outskirts, terrain: 'arid' },
  { key: 'wadi_halam_basin', json: maps.wadi_halam_basin, terrain: 'green' },
  { key: 'tel_marum', json: maps.tel_marum, terrain: 'highland' },
  { key: 'wetland', json: WETLAND_FIXTURE, terrain: 'wetland' },
];
/** The three shipped entries, which the wetland case never edits. */
const SHIPPED_KEYS = ['beit_sahwan_outskirts', 'wadi_halam_basin', 'tel_marum'];

interface Private {
  scene: ThreeTypes.Scene;
  sway: SwayUniforms;
  decalMaterial: ThreeTypes.ShaderMaterial;
  vehicleMoveEmitterName(): string;
  groundMat: GroundMaterial;
  sceneLights: SceneLights;
  renderer: { toneMappingExposure: number };
  shroud: ShroudTexture;
  fogPass: FogOfWarPass | null;
  createFogPass(): FogOfWarPass;
  applyHaze(): void;
}

interface Identity {
  program: string;
  scene: string;
  light: string;
  /** The values behind `light`, for a failure message that can be read. */
  lightFields: Record<string, unknown>;
  /** The values behind `scene`, for a failure message that can be read. */
  sceneFields: Record<string, unknown>;
  fragmentLength: number;
  /** The ground program's four digested parts, raw, for the strip test. */
  programParts: { vertex: string; fragment: string; cacheKey: string; defines: Record<string, unknown> };
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Six decimals: a sun direction is derived from float positions. */
const r6 = (xs: readonly number[]): number[] => xs.map((x) => Number(x.toFixed(6)));

/** `onBeforeCompile` applied to three's own meshphysical chunks (the `compiled()` seam). */
function compileOf(material: ThreeTypes.Material): { vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {} as Record<string, ThreeTypes.IUniform>,
    vertexShader: THREE.ShaderChunk.meshphysical_vert,
    fragmentShader: THREE.ShaderChunk.meshphysical_frag,
  };
  material.onBeforeCompile(shader as unknown as ThreeTypes.WebGLProgramParametersWithUniforms, {} as ThreeTypes.WebGLRenderer);
  return { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader };
}

/** One role that resolves to each `SurfaceClass` (`unit-surface.ts`'s role tables). */
const SURFACE_ROLES: Readonly<Record<SurfaceClass, string>> = {
  cloth: 'uniform',
  leather: 'boot',
  skin: 'face',
  wood: 'wood',
  gear: 'webbing',
  gunmetal: 'metal',
  armour: 'hull',
  plate: 'plate',
  rubber: 'rubber',
  glass: 'glass',
};

/** Everything `scene` digests, as readable values (long GLSL goes in as a hash). */
function sceneFieldsOf(priv: Private): Record<string, unknown> {
  const fogMat = priv.fogPass!.material;
  const decalMat = priv.decalMaterial;
  const decalColours = (decalMat.uniforms.uColors.value as ThreeTypes.Vector3[]).map((c) => r6(c.toArray()));

  // The live foliage batches (a map with trees), and one built the way the
  // renderer builds them, from the renderer's OWN sway uniforms: a fixture
  // with no trees must still read the foliage program.
  const live: ThreeTypes.Material[] = [];
  priv.scene.traverse((o) => {
    if (o.name === 'decor-foliage') live.push((o as ThreeTypes.Mesh).material as ThreeTypes.Material);
  });
  const liveFoliage = live.map((m) => {
    const c = compileOf(m);
    return sha(JSON.stringify([c.vertexShader, c.fragmentShader, m.customProgramCacheKey()]));
  });
  const built = swayingFoliageMaterial(['#808080'], priv.sway);
  const builtCompiled = compileOf(built);

  const surfaces: Record<string, number[]> = {};
  for (const cls of Object.keys(SURFACE_ROLES) as SurfaceClass[]) {
    const base = new THREE.MeshStandardMaterial();
    const m = surfaceMaterialFor(base, SURFACE_ROLES[cls]) as ThreeTypes.MeshStandardMaterial;
    surfaces[cls] = [m.roughness, m.metalness];
  }

  const ground = priv.groundMat as unknown as { uniforms: Record<string, unknown>; defines: Record<string, unknown> };
  const byType: Record<string, number> = {};
  priv.scene.traverse((o) => {
    byType[o.type] = (byType[o.type] ?? 0) + 1;
  });
  const orders: number[] = [];
  priv.scene.traverseVisible((o) => {
    if ((o as ThreeTypes.Mesh).isMesh) orders.push(o.renderOrder);
  });
  orders.sort((a, b) => a - b);

  return {
    fog: sha(JSON.stringify([fogMat.fragmentShader, fogMat.vertexShader, fogMat.defines, Object.keys(fogMat.uniforms).sort()])),
    foliageLive: liveFoliage,
    foliageBuilt: sha(JSON.stringify([builtCompiled.vertexShader, builtCompiled.fragmentShader, built.customProgramCacheKey()])),
    decalProgram: sha(JSON.stringify([decalMat.fragmentShader, decalMat.defines])),
    decalColours,
    surfaces,
    shadowIntensity: priv.sceneLights.sun.shadow.intensity,
    groundUniformNames: Object.keys(ground.uniforms).sort(),
    groundDefines: ground.defines,
    censusByType: Object.fromEntries(Object.entries(byType).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    visibleMeshRenderOrders: sha(JSON.stringify(orders)),
    visibleMeshCount: orders.length,
    vehicleMoveEmitter: priv.vehicleMoveEmitterName(),
  };
}

function identityOf(json: MapJson, weather?: 'clear'): Identity {
  const parsed = parseMap(json);
  const sim = new Sim({ seed: 20260727, width: parsed.width, height: parsed.height, capacity: 4 });
  applyTerrain(parsed, sim);
  // `weather: 'clear'` is a seam P4 reads (GH-871): naming it must change nothing.
  const r = new ThreeRenderer(sim, { ...rendererOptionsFor(parsed, HIGH, '/'), ...(weather ? { weather } : {}) });
  const priv = r as unknown as Private;
  // What `init()` does with the fog pass, minus the GL-dependent rest: the
  // very method `init()` calls, so a rain-only option reaches this pass too.
  priv.fogPass = priv.createFogPass();
  r.frame(1, 0);
  priv.applyHaze();

  const mat = priv.groundMat;
  const shader = {
    uniforms: {} as Record<string, ThreeTypes.IUniform>,
    vertexShader: THREE.ShaderChunk.meshphysical_vert,
    fragmentShader: THREE.ShaderChunk.meshphysical_frag,
  };
  mat.onBeforeCompile(shader as unknown as ThreeTypes.WebGLProgramParametersWithUniforms, {} as ThreeTypes.WebGLRenderer);
  const program = sha(
    JSON.stringify([shader.vertexShader, shader.fragmentShader, mat.customProgramCacheKey(), mat.defines])
  );
  const programParts = {
    vertex: shader.vertexShader,
    fragment: shader.fragmentShader,
    cacheKey: mat.customProgramCacheKey(),
    defines: { ...(mat.defines as Record<string, unknown>) },
  };

  const { sun, hemisphere } = priv.sceneLights;
  const fog = priv.fogPass.uniforms;
  const lightFields = {
    sunIntensity: sun.intensity,
    sunColor: r6(sun.color.toArray()),
    sunDirection: r6(sun.position.clone().sub(sun.target.position).normalize().toArray()),
    hemiIntensity: hemisphere.intensity,
    hemiSkyColor: r6(hemisphere.color.toArray()),
    hemiGroundColor: r6(hemisphere.groundColor.toArray()),
    shadowMapSize: [sun.shadow.mapSize.x, sun.shadow.mapSize.y],
    hazeFar: fog.uHazeFar.value,
    hazeTint: r6(fog.uHazeTint.value.toArray()),
    // The pass's own value (GH-871 P4 T2), not the `haze.ts` import: a wet
    // `HAZE_LOW` is compiled into the pass and would be invisible to the import.
    hazeLow: priv.fogPass.hazeLow,
    exposure: priv.renderer.toneMappingExposure,
  };
  const sceneFields = sceneFieldsOf(priv);
  r.dispose();
  return {
    program,
    scene: sha(JSON.stringify(sceneFields)),
    light: sha(JSON.stringify(lightFields)),
    lightFields,
    sceneFields,
    fragmentLength: shader.fragmentShader.length,
    programParts,
  };
}

/**
 * The 9.1 property, on output: a wet program's source with every
 * `#ifdef THEME_WET ... #endif` block removed. The block's leading newline goes
 * with it (that is how `mesh.ts`'s `wetBlock` lays one down), and it matches to
 * the FIRST `#endif`, which is why a wet block may hold no nested conditional.
 * Written out here on purpose: an oracle must not import the strip it checks.
 */
function stripWetBlocks(src: string): string {
  return src.replace(/\n#ifdef THEME_WET\n[\s\S]*?\n#endif/g, '');
}

/** The uniforms only a wet ground declares (`GroundMaterial`'s `wetUniforms`), as literals. */
const WET_UNIFORMS = [
  'uControlC',
  'uMarshAmp',
  'uMarshReflect',
  'uPuddleReflect',
  'uRippleAmp',
  'uRippleTimeSec',
  'uWetAmp',
  'uWetRim',
  'uWetSky',
];

describe('the ground program and the boot light, per shipped theme (GH-871)', () => {
  if (UPDATE) {
    it('regenerates the fixture', () => {
      // `scene` sits between `program` and `light`, so adding it only ADDS
      // lines to the fixture (no existing line gains a comma).
      const out: Record<string, { program: string; scene: string; light: string }> = {};
      for (const c of CASES) {
        const { program, scene, light } = identityOf(c.json);
        out[c.key] = { program, scene, light };
      }
      writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
    }, 120_000);
    return;
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
    string,
    { program: string; scene: string; light: string }
  >;

  it('covers exactly the three shipped themes and the wetland fixture', () => {
    expect(Object.keys(recorded).sort()).toEqual(CASES.map((c) => c.key).sort());
    expect(SHIPPED_KEYS.every((k) => k in recorded)).toBe(true);
  });

  for (const c of CASES) {
    describe(c.key, () => {
      const parsed = parseMap(c.json);
      it(`is a ${c.terrain} map`, () => {
        expect(parsed.terrain).toBe(c.terrain);
      });
      // Built in a hook, not at collection: a boot that throws fails these
      // tests with its own message rather than the whole file at collection.
      let got: Identity;
      beforeAll(() => {
        got = identityOf(c.json);
      });

      it('read a real program and a live light, not an empty one', () => {
        // The injected ground GLSL ran, and every light field is non-vacuous.
        expect(got.fragmentLength).toBeGreaterThan(THREE.ShaderChunk.meshphysical_frag.length + 500);
        const f = got.lightFields;
        expect(f.sunIntensity).toBeGreaterThan(0);
        expect(f.hemiIntensity).toBeGreaterThan(0);
        if (SHIPPED_KEYS.includes(c.key)) expect(f.shadowMapSize).toEqual([4096, 4096]);
        else {
          // The wetland case: a positive power of two (P4 Task 2 pins its value).
          const [w, h] = f.shadowMapSize as number[];
          for (const n of [w, h]) {
            expect(n).toBeGreaterThan(0);
            expect(Number.isInteger(Math.log2(n))).toBe(true);
          }
        }
        expect(f.hazeFar).toBeGreaterThan(0);
        expect((f.hazeTint as number[]).some((x) => x > 0)).toBe(true);
        expect(f.hazeLow).toBeGreaterThan(0);
        expect(f.exposure).toBe(1);
      });
      it('draws the recorded ground program', () => {
        expect(got.program).toBe(recorded[c.key].program);
      });
      it('read a live scene, not an empty one', () => {
        const f = got.sceneFields;
        // Each family of the digest saw something: a vacuous read (a missing
        // pass, an empty pool, a bare scene) would hash the same everywhere.
        expect((f.decalColours as number[][]).length).toBe(8);
        expect(Object.keys(f.surfaces as object).length).toBe(10);
        expect(f.shadowIntensity).toBeGreaterThan(0);
        expect((f.groundUniformNames as string[]).length).toBeGreaterThan(10);
        expect(f.visibleMeshCount).toBeGreaterThan(5);
        expect(Object.values(f.censusByType as Record<string, number>).reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
        // The shipped value; the wetland's (P4 Task 5) is pinned by the digest.
        if (SHIPPED_KEYS.includes(c.key)) expect(f.vehicleMoveEmitter).toBe('vehicle_dust');
        else expect(f.vehicleMoveEmitter).toEqual(expect.any(String));
      });
      it('draws the recorded scene', () => {
        expect(got.scene, JSON.stringify(got.sceneFields)).toBe(recorded[c.key].scene);
      });
      it('boots the recorded light', () => {
        expect(got.light, JSON.stringify(got.lightFields)).toBe(recorded[c.key].light);
      });
      // The wetland rains by default, so naming 'clear' there DOES change it (below).
      it.runIf(SHIPPED_KEYS.includes(c.key))("names weather: 'clear' and gets the identical program and light", () => {
        const clear = identityOf(c.json, 'clear');
        expect(clear.program).toBe(recorded[c.key].program);
        expect(clear.scene).toBe(recorded[c.key].scene);
        expect(clear.light).toBe(recorded[c.key].light);
      });
    });
  }

  // GH-871 P4 T4: the wetland rains, so it draws the THEME_WET ground program,
  // which DIFFERS from arid's -- and differs by exactly its own `#ifdef`
  // blocks, its define and its uniforms: with those removed it is arid's
  // program byte for byte (spec 9.1, on output). Its LIGHT differs too (the
  // haze key is `overcast.1`), and is only recorded, not compared.
  describe('the wetland fixture', () => {
    it("draws a ground program of its own, not arid's", () => {
      expect(recorded.wetland.program).not.toBe(recorded.beit_sahwan_outskirts.program);
      expect(identityOf(WETLAND_FIXTURE).program).not.toBe(recorded.beit_sahwan_outskirts.program);
    });
    it("is arid's ground program byte for byte once its THEME_WET blocks, define and uniforms are removed", () => {
      const arid = identityOf(maps.beit_sahwan_outskirts);
      const wet = identityOf(WETLAND_FIXTURE);
      const p = wet.programParts;
      // Non-vacuous: the blocks are there to remove (four of them, one per
      // anchor), the define is set and the cache key is the wet program's.
      expect(p.fragment.match(/#ifdef THEME_WET/g)?.length).toBe(4);
      expect(p.vertex).not.toContain('THEME_WET');
      expect(p.defines).toEqual({ STANDARD: '', THEME_WET: '' });
      expect(p.cacheKey).toBe('rl-ground-wet');
      expect(p.fragment.length).toBeGreaterThan(arid.programParts.fragment.length + 2000);
      // The strip: sources, then the cache key and the defines.
      const { THEME_WET: _wetDefine, ...definesWithoutWet } = p.defines;
      void _wetDefine;
      const stripped = sha(
        JSON.stringify([stripWetBlocks(p.vertex), stripWetBlocks(p.fragment), p.cacheKey.replace(/-wet$/, ''), definesWithoutWet])
      );
      expect(stripped).toBe(recorded.beit_sahwan_outskirts.program);
      expect(stripped).toBe(arid.program);
      // And the uniform record: the wetland's minus the wet uniforms is arid's.
      const names = wet.sceneFields.groundUniformNames as string[];
      expect(WET_UNIFORMS.every((n) => names.includes(n))).toBe(true);
      expect(names.filter((n) => !WET_UNIFORMS.includes(n))).toEqual(arid.sceneFields.groundUniformNames);
      expect(arid.sceneFields.groundDefines).toEqual({ STANDARD: '' });
    });
    it('boots a light of its own (the haze differs by design)', () => {
      expect(recorded.wetland.light).not.toBe(recorded.beit_sahwan_outskirts.light);
    });
    it("names weather: 'clear' and gets the dry light: nothing rains", () => {
      // The seam's other side: `rendererOptionsFor` sets 'rain' for this
      // theme, and an explicit 'clear' overrides it back to today's path.
      const f = identityOf(WETLAND_FIXTURE, 'clear').lightFields;
      expect(f.shadowMapSize).toEqual([4096, 4096]);
      expect(f.sunIntensity).toBe(2.6);
      expect(f.hemiIntensity).toBe(0.9);
      expect(f.hazeLow).toBe(0.06);
    });
    it('boots the rain light (GH-871 P4 T2), as literals', () => {
      const got = identityOf(WETLAND_FIXTURE);
      const f = got.lightFields;
      // Under rain the shadow map is one step down from high's 4096, by design.
      expect(f.shadowMapSize).toEqual([2048, 2048]);
      expect(f.sunIntensity as number).toBeCloseTo(1.196, 9);
      expect(f.hemiIntensity).toBe(1.35);
      expect(f.hazeFar).toBe(0.26);
      expect(f.hazeLow).toBe(0.1);
      expect(f.exposure).toBe(1);
      expect(got.sceneFields.shadowIntensity).toBe(0.45);
      // And the scene digest moved with the fog source (hazeLow is compiled in).
      expect(recorded.wetland.scene).not.toBe(recorded.beit_sahwan_outskirts.scene);
    });
  });
});
