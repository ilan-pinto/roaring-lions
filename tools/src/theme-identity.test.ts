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
 *    map size (x, y); the fog pass's `uHazeFar` and `uHazeTint`; `HAZE_LOW`
 *    (haze.ts); and the renderer's `toneMappingExposure`.
 *
 * `init()` needs a live GL context, so the fog pass is slotted in the way
 * `init()` does it (`new FogOfWarPass(shroud.texture, w, h)`, then
 * `applyHaze()`), and one `frame()` runs first so the terrain rebuild has run.
 *
 * Regenerate (only for a DELIBERATE change to a shipped theme's program or
 * light, and say so in the commit): `UPDATE_THEME_IDENTITY=1 pnpm vitest run
 * tools/src/theme-identity.test.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
import { HAZE_LOW } from '../../packages/render/src/three/haze';
import type { GroundMaterial } from '../../packages/render/src/three/terrain/mesh';
import type { SceneLights } from '../../packages/render/src/three/lighting';
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
  groundMat: GroundMaterial;
  sceneLights: SceneLights;
  renderer: { toneMappingExposure: number };
  shroud: ShroudTexture;
  fogPass: FogOfWarPass | null;
  applyHaze(): void;
}

interface Identity {
  program: string;
  light: string;
  /** The values behind `light`, for a failure message that can be read. */
  lightFields: Record<string, unknown>;
  fragmentLength: number;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Six decimals: a sun direction is derived from float positions. */
const r6 = (xs: readonly number[]): number[] => xs.map((x) => Number(x.toFixed(6)));

function identityOf(json: MapJson, weather?: 'clear'): Identity {
  const parsed = parseMap(json);
  const sim = new Sim({ seed: 20260727, width: parsed.width, height: parsed.height, capacity: 4 });
  applyTerrain(parsed, sim);
  // `weather: 'clear'` is a seam P4 reads (GH-871): naming it must change nothing.
  const r = new ThreeRenderer(sim, { ...rendererOptionsFor(parsed, HIGH, '/'), ...(weather ? { weather } : {}) });
  const priv = r as unknown as Private;
  // What `init()` does with the fog pass, minus the GL-dependent rest.
  priv.fogPass = new FogOfWarPass(priv.shroud.texture, sim.width, sim.height);
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
    hazeLow: HAZE_LOW,
    exposure: priv.renderer.toneMappingExposure,
  };
  r.dispose();
  return { program, light: sha(JSON.stringify(lightFields)), lightFields, fragmentLength: shader.fragmentShader.length };
}

describe('the ground program and the boot light, per shipped theme (GH-871)', () => {
  if (UPDATE) {
    it('regenerates the fixture', () => {
      const out: Record<string, { program: string; light: string }> = {};
      for (const c of CASES) {
        const { program, light } = identityOf(c.json);
        out[c.key] = { program, light };
      }
      writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
    }, 120_000);
    return;
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, { program: string; light: string }>;

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
      const got = identityOf(c.json);

      it('read a real program and a live light, not an empty one', () => {
        // The injected ground GLSL ran, and every light field is non-vacuous.
        expect(got.fragmentLength).toBeGreaterThan(THREE.ShaderChunk.meshphysical_frag.length + 500);
        const f = got.lightFields;
        expect(f.sunIntensity).toBeGreaterThan(0);
        expect(f.hemiIntensity).toBeGreaterThan(0);
        expect(f.shadowMapSize).toEqual([4096, 4096]);
        expect(f.hazeFar).toBeGreaterThan(0);
        expect((f.hazeTint as number[]).some((x) => x > 0)).toBe(true);
        expect(f.hazeLow).toBeGreaterThan(0);
        expect(f.exposure).toBe(1);
      });
      it('draws the recorded ground program', () => {
        expect(got.program).toBe(recorded[c.key].program);
      });
      it('boots the recorded light', () => {
        expect(got.light, JSON.stringify(got.lightFields)).toBe(recorded[c.key].light);
      });
      it("names weather: 'clear' and gets the identical program and light", () => {
        const clear = identityOf(c.json, 'clear');
        expect(clear.program).toBe(recorded[c.key].program);
        expect(clear.light).toBe(recorded[c.key].light);
      });
    });
  }

  // GH-871 P2 adds no shader term: the wetland draws the SAME ground program
  // as arid. P4 (rain) changes this assertion deliberately. Its LIGHT differs
  // (the haze key is `overcast.1`), and is only recorded, not compared.
  describe('the wetland fixture', () => {
    it("draws arid's ground program, byte for byte", () => {
      expect(recorded.wetland.program).toBe(recorded.beit_sahwan_outskirts.program);
      expect(identityOf(WETLAND_FIXTURE).program).toBe(recorded.beit_sahwan_outskirts.program);
    });
    it('boots a light of its own (the haze differs by design)', () => {
      expect(recorded.wetland.light).not.toBe(recorded.beit_sahwan_outskirts.light);
    });
  });
});
