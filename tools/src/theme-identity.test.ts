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
import { maps, parseMap, applyTerrain, type MapId } from '@lions/data';
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

/** One map per shipped theme, with the theme each is expected to be. */
const CASES: ReadonlyArray<{ id: MapId; terrain: string }> = [
  { id: 'beit_sahwan_outskirts', terrain: 'arid' },
  { id: 'wadi_halam_basin', terrain: 'green' },
  { id: 'tel_marum', terrain: 'highland' },
];

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

function identityOf(id: MapId, weather?: 'clear'): Identity {
  const parsed = parseMap(maps[id]);
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
        const { program, light } = identityOf(c.id);
        out[c.id] = { program, light };
      }
      writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
    }, 120_000);
    return;
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, { program: string; light: string }>;

  it('covers exactly the three themes', () => {
    expect(Object.keys(recorded).sort()).toEqual(CASES.map((c) => c.id).sort());
  });

  for (const c of CASES) {
    describe(c.id, () => {
      const parsed = parseMap(maps[c.id]);
      it(`is a ${c.terrain} map`, () => {
        expect(parsed.terrain).toBe(c.terrain);
      });
      const got = identityOf(c.id);

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
        expect(got.program).toBe(recorded[c.id].program);
      });
      it('boots the recorded light', () => {
        expect(got.light, JSON.stringify(got.lightFields)).toBe(recorded[c.id].light);
      });
      it("names weather: 'clear' and gets the identical program and light", () => {
        const clear = identityOf(c.id, 'clear');
        expect(clear.program).toBe(recorded[c.id].program);
        expect(clear.light).toBe(recorded[c.id].light);
      });
    });
  }
});
