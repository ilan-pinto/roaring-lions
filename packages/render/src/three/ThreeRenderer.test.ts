/**
 * Final whole-branch review (Fix 2): `dispose()` never disposed the fog
 * layer -- the retired `FogMesh`'s own `dispose()` existed and was called
 * from nowhere, so `tools/src/perf/three-units.ts:757` (which calls
 * `renderer.dispose()` between backends to publish a peak-VRAM figure)
 * leaked a full-map `InstancedMesh` on every run. That fix is one line in
 * `dispose()`; this file exists to guard it, and it is deliberately narrow.
 * Task 10 replaced the mesh with a `ShroudTexture` + `FogOfWarPass` pair
 * and the guard moved with it -- the GPU object changed, the leak shape did
 * not.
 *
 * `ThreeRenderer` has no other headless coverage (recorded, deliberately
 * deferred, in `progress.md`'s "Deferred to Phase C" list -- proving the
 * phase's headline fog/visibility claim wants a real seam, not a
 * constructor-level workaround). This file does not attempt that. It
 * constructs exactly enough of a real `ThreeRenderer` to prove one thing:
 * that `dispose()` reaches the fog layer's own `dispose()`.
 *
 * The one real obstacle is `new THREE.WebGLRenderer(...)`, which cannot
 * construct under this suite's headless `environment: 'node'` (no `document`,
 * no WebGL). Every other object `ThreeRenderer`'s constructor builds --
 * `ShroudTexture`, `ParticleInstancer`, `TracerBatch`, `vertexColorMaterial()`
 * -- is plain `THREE.*` JS-side construction with no GPU context needed,
 * already proven headless-safe by `shroud-texture.test.ts`,
 * `units/fx.test.ts` and elsewhere. (`FogOfWarPass` is deliberately NOT in
 * that list: it is built in `init()`, which this file never calls.) So this file substitutes a minimal stand-in for
 * `THREE.WebGLRenderer` alone (via `vi.mock`, scoped to this one test file)
 * rather than a real one, keeping every other `three` export untouched.
 * Confirmed by reading the constructor directly: nothing runs between `new
 * THREE.WebGLRenderer(...)` and the end of the constructor that touches the
 * renderer beyond the colour-pipeline assignments (`outputColorSpace`,
 * `toneMapping`, `toneMappingExposure`, `setClearColor`) the "colour
 * pipeline" describe block below pins, all stubbed below.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import paletteJson from '../../../../data/palette.json';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { STRIPE_COLOR_KEY } from './units/overlays';
import { SKIRT_TONE } from './terrain/skirt';
import { albedoMean } from './terrain/mesh';
import { hexToLinear } from './terrain/shared';
import { FogOfWarPass } from './fog-pass';
import { hazeRadiance } from './haze';
import { SUN_DIRECTION } from './lighting';

const disposeSpy = vi.fn();

// `vi.mock` is hoisted by vitest above every import in this file (static or
// not), so the `import { ThreeRenderer } from './ThreeRenderer'` above --
// which itself does `import * as THREE from 'three'` -- resolves against
// this stand-in, not the real module.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    // Deliberately the WRONG value (three.js's own default is
    // `SRGBColorSpace`, not this) -- `the colour pipeline`'s test below
    // proves the constructor's own `this.renderer.outputColorSpace =
    // THREE.SRGBColorSpace` assignment runs. Starting the fake already at
    // `SRGBColorSpace` would make that assertion pass whether or not the
    // constructor ever touched the property at all -- the identical trap
    // review caught here, fixed the same way.
    outputColorSpace = actual.LinearSRGBColorSpace;
    domElement: unknown = {};
    /** Every hex `setClearColor` was called with, via `Color#getHexString()`
     *  (lower-case, no `#`) -- what `the colour pipeline`'s test below reads
     *  back to prove the constructor's background hex reached the clear
     *  colour. */
    clearColorCalls: string[] = [];
    setClearColor(color: THREE.Color): void {
      this.clearColorCalls.push(color.getHexString());
    }
    /** The WebGL context, reduced to the one question
     *  `disposeAndReleaseContext` asks it. `lost` is written only by
     *  `forceContextLoss` below (or by a test standing in for the browser
     *  taking the context first), so "the context reports lost" is a fact
     *  about what `dispose()` called, not about how the fake was built. */
    readonly context = {
      lost: false,
      isContextLost(): boolean {
        return this.lost;
      },
    };
    getContext(): { isContextLost(): boolean } {
      return this.context;
    }
    /** Every `dispose`/`forceContextLoss` call, in order, so the ORDER
     *  `context-release.ts` argues for is pinned rather than implied. */
    calls: string[] = [];
    forceContextLoss(): void {
      this.calls.push('forceContextLoss');
      this.context.lost = true;
    }
    renderCalls = 0;
    /** Throws once the context is lost -- the stand-in for what a real
     *  three renderer does on a context it never saw go (a render into a
     *  fresh target threw `TypeError: Cannot read properties of null
     *  (reading 'trim')`, measured, `context-release.ts`). So a draw that
     *  slips past a `disposed` guard fails the way it would in a browser. */
    render(): void {
      this.renderCalls += 1;
      if (this.context.lost) throw new Error('render on a lost context');
    }
    /** The three calls `photographGround` makes around its render, so a
     *  capture that is NOT refused reaches that render -- and its catch --
     *  rather than dying on a missing method before its `try`. */
    private target: unknown = null;
    getRenderTarget(): unknown {
      return this.target;
    }
    setRenderTarget(t: unknown): void {
      this.target = t;
    }
    clear(): void {}
    dispose(): void {
      this.calls.push('dispose');
      disposeSpy();
    }
  }
  /**
   * Shell upgrade Phase 0 Task 9: `loadGroundTexture` reaches the network
   * through `new THREE.TextureLoader().load(url, onLoad, ...)`, and the one
   * thing worth proving about it headless is that the OPEN-GROUND slot also
   * reaches `terrain/skirt.ts`. This stand-in calls `onLoad` synchronously
   * with a REAL `THREE.Texture` (`prepareGroundTexture` mutates what it is
   * handed, and a plain object would throw), so the whole callback runs.
   */
  class FakeTextureLoader {
    load(_url: string, onLoad: (t: THREE.Texture) => void): THREE.Texture {
      const tex = new actual.Texture();
      onLoad(tex);
      return tex;
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer, TextureLoader: FakeTextureLoader };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

function makeSim(): Sim {
  return new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
}

describe('ThreeRenderer.dispose', () => {
  it('disposes the fog shroud texture -- the exact regression this test guards', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    // Reach into the private field the same way this suite already treats
    // `ShroudTexture` as testable (`shroud-texture.test.ts` constructs and
    // inspects one directly) -- there is no public accessor for it, and
    // adding one purely for a test would widen `Renderer`'s surface for no
    // runtime reason (`api.ts`'s own top comment: "The surface is small ...
    // and that smallness is the whole reason replacing the backend is
    // tractable").
    //
    // Task 10 moved this guard from `fogMesh` (a full-map `InstancedMesh`,
    // geometry + material) to the shroud (a `DataTexture`), because fog is
    // a post pass now and the mesh is gone. The LEAK is the same shape and
    // so is the fix: a `dispose()` the class owns and has to actually call.
    // The other half of fog, `FogOfWarPass`, is built in `init()` -- which
    // needs a live GL context and is therefore out of this file's reach;
    // its release is pinned by reading `dispose()`, not by a test here.
    const shroud = (renderer as unknown as { shroud: { texture: unknown } }).shroud;
    const texture = shroud.texture as { addEventListener: (type: string, cb: () => void) => void };
    let textureDisposed = false;
    // three.js's own disposal signal: `Texture.dispose()` dispatches a
    // `'dispose'` event (it extends `EventDispatcher`) -- asserting on that
    // is a stronger guard than spying on `.dispose` directly, since it
    // proves the REAL three.js method ran, not merely that something
    // callable named `dispose` was invoked.
    texture.addEventListener('dispose', () => {
      textureDisposed = true;
    });

    renderer.dispose();

    expect(textureDisposed).toBe(true);
    // And the renderer's own WebGLRenderer.dispose() still ran too -- fog
    // disposal was ADDED, not substituted for something else.
    expect(disposeSpy).toHaveBeenCalled();
  });

  it('disposes smokeMesh -- the identical shape of leak the fog layer once had, guarded against from the start', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const smokeMesh = (renderer as unknown as { smokeMesh: { mesh: { geometry: unknown; material: unknown } } })
      .smokeMesh;
    const geometry = smokeMesh.mesh.geometry as { addEventListener: (type: string, cb: () => void) => void };
    const material = smokeMesh.mesh.material as { addEventListener: (type: string, cb: () => void) => void };
    let geometryDisposed = false;
    let materialDisposed = false;
    geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    material.addEventListener('dispose', () => {
      materialDisposed = true;
    });

    renderer.dispose();

    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(true);
  });
});

/**
 * `dispose()` gives the WebGL context back. `WebGLRenderer.dispose()` does
 * not (three r170), and leaving a mission is a soft navigation, so before
 * this every leave held ~0.4 GB of GPU memory until the canvas was
 * collected. See `context-release.ts` for the measurements and the order.
 */
describe('ThreeRenderer.dispose releases the WebGL context', () => {
  interface FakeGl {
    context: { lost: boolean };
    calls: string[];
    renderCalls: number;
  }
  const glOf = (r: ThreeRenderer): FakeGl => (r as unknown as { renderer: FakeGl }).renderer;

  it('loses the context, after three has freed its own caches', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = glOf(renderer);
    expect(gl.context.lost).toBe(false);

    renderer.dispose();

    expect(gl.context.lost).toBe(true);
    // dispose FIRST: three's caches are freed by a live context, and its
    // `webglcontextlost` listener is gone before the (asynchronous) event
    // lands, so three prints nothing.
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
  });

  it('is idempotent: a second dispose() does not throw and loses nothing twice', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = glOf(renderer);
    renderer.dispose();

    expect(() => renderer.dispose()).not.toThrow();
    // Exactly once each. A second `loseContext()` prints "WebGL:
    // INVALID_OPERATION: loseContext: context already lost" in Chromium.
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
  });

  it('loses the context even when a free on the way throws', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = glOf(renderer);
    // The shroud is one of ~60 frees before the context; any of them
    // throwing used to return from `dispose()` with the context alive and
    // `disposed` already set, so nothing could ever retry.
    const shroud = (renderer as unknown as { shroud: { dispose(): void } }).shroud;
    vi.spyOn(shroud, 'dispose').mockImplementation(() => {
      throw new Error('free failed');
    });

    expect(() => renderer.dispose()).toThrow('free failed');

    expect(gl.context.lost).toBe(true);
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
  });

  it('does not lose a context the browser already took', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = glOf(renderer);
    gl.context.lost = true;

    renderer.dispose();

    expect(gl.calls).toEqual(['dispose']);
  });

  it('draws nothing and photographs nothing once disposed', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = glOf(renderer);
    // The premise: before dispose a frame DOES reach the renderer, so the
    // zero below is the guard and not a frame that never draws.
    renderer.frame(1, 16);
    expect(gl.renderCalls).toBe(1);
    renderer.dispose();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderer.frame(1, 16);
      expect(gl.renderCalls).toBe(1);
      expect(renderer.captureGroundAlbedo(64)).toBeNull();
      // Null because it was refused, not because the capture failed and
      // was caught: that path warns, and would warn on every minimap redraw.
      expect(warn).not.toHaveBeenCalled();
      expect(gl.renderCalls).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });
});

// `ThreeRenderer.onEvents removed` lived here: a negative assertion that a
// `removed` entity never entered the BILLBOARD death-fade queue (`dying`).
// That queue went with the billboard path (WP-A3.3). The mesh paths' own
// abduction forks are pinned in `ThreeRenderer.vehicle-mesh-death.test.ts`
// ("prunes a REMOVED vehicle immediately") and the mesh-death suite.

describe('the chevron fallback colour', () => {
  // `makeOpts()` supplies no `resolveColor`, which is the one caller shape that
  // reaches the constructor's literal at all -- in the app `main.ts` always
  // passes one. A wrong literal is therefore invisible on screen and shows up
  // only as a test drawing a stripe in some other swatch's colour, so it is
  // pinned against `data/palette.json` itself rather than a second copy of the
  // hex. The chevron shipped with `team.neutral`'s `#E8C33A` while its own key
  // is `dust.0`.
  const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
  const swatch = (key: string): string => {
    const [band, index] = key.split('.');
    return ramps[band].colors[Number(index)];
  };

  it('falls back to the swatch STRIPE_COLOR_KEY resolves to, not to team.neutral', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const fill = (renderer as unknown as { chevronBatch: { fillColorHex: string } }).chevronBatch.fillColorHex;
    expect(fill).toBe(swatch(STRIPE_COLOR_KEY));
    expect(fill).not.toBe('#E8C33A');
  });
});

describe('time of day (ground plan 2, Task 8)', () => {
  type Lit = { sceneLights: { sun: THREE.DirectionalLight; hemisphere: THREE.HemisphereLight } };
  const lightsOf = (r: ThreeRenderer): Lit['sceneLights'] => (r as unknown as Lit).sceneLights;

  // `day` must be the frame before presets existed: with no option and with
  // `timeOfDay: 'day'` the sun sits at the same position to the bit.
  it('lights an absent timeOfDay and day identically, with the DAY_LIGHTS constants', () => {
    const a = new ThreeRenderer(makeSim(), makeOpts());
    const b = new ThreeRenderer(makeSim(), { ...makeOpts(), timeOfDay: 'day' });
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Object.is(lightsOf(a).sun.position[k], lightsOf(b).sun.position[k])).toBe(true);
    }
    expect(lightsOf(b).sun.intensity).toBe(2.6);
    expect(lightsOf(b).hemisphere.intensity).toBe(0.9);
    a.dispose();
    b.dispose();
  });

  it('lights dusk from its preset row, and night as dusk (D10)', () => {
    const day = new ThreeRenderer(makeSim(), makeOpts());
    for (const t of ['dusk', 'night'] as const) {
      const r = new ThreeRenderer(makeSim(), { ...makeOpts(), timeOfDay: t });
      expect(lightsOf(r).sun.intensity).toBe(1.8);
      expect(lightsOf(r).hemisphere.intensity).toBe(0.7);
      expect(lightsOf(r).sun.color.getHex()).toBe(new THREE.Color('#E0B87A').getHex());
      expect(lightsOf(r).hemisphere.color.getHex()).toBe(new THREE.Color('#8E9491').getHex());
      expect(lightsOf(r).hemisphere.groundColor.getHex()).toBe(lightsOf(day).hemisphere.groundColor.getHex());
      // A lower sun: the light sits nearer the ground than day's.
      expect(lightsOf(r).sun.position.y).toBeLessThan(lightsOf(day).sun.position.y);
      r.dispose();
    }
    day.dispose();
  });
});

describe('the dust haze (ground plan 2, Task 9)', () => {
  type Hazed = { fogPass: FogOfWarPass | null; applyHaze(): void; rebuildTerrain(): void };
  const hazed = (r: ThreeRenderer): Hazed => r as unknown as Hazed;
  // `init()` needs a real GL context, so the pass is built by hand and the
  // same two private calls `init()` and a rebuild make are made on it.
  const withPass = (r: ThreeRenderer): FogOfWarPass => {
    const pass = new FogOfWarPass(new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat), 4, 4);
    hazed(r).fogPass = pass;
    hazed(r).applyHaze();
    return pass;
  };
  const tintOf = (pass: FogOfWarPass): number[] => pass.uniforms.uHazeTint.value.toArray();

  it('day: the theme tone, scaled to lit ground under DAY_LIGHTS, 12% at +20 tiles', () => {
    const r = new ThreeRenderer(makeSim(), makeOpts());
    const pass = withPass(r);
    const k = hazeRadiance(2.6, SUN_DIRECTION.y, 0.9);
    const [lr, lg, lb] = hexToLinear(TONES.haze);
    const t = tintOf(pass);
    expect(t[0]).toBeCloseTo(lr * k, 6);
    expect(t[1]).toBeCloseTo(lg * k, 6);
    expect(t[2]).toBeCloseTo(lb * k, 6);
    expect(pass.uniforms.uHazeFar.value).toBe(0.12);
    expect(pass.uniforms.uHazeRef.value).toBe(0);
    hazed(r).fogPass = null;
    pass.dispose();
    r.dispose();
  });

  it("dusk: the preset's own dust.1, dimmer by dusk's light, 18%", () => {
    const r = new ThreeRenderer(makeSim(), { ...makeOpts(), timeOfDay: 'dusk' });
    const pass = withPass(r);
    const lights = (r as unknown as { resolvedLights: { direction: THREE.Vector3 } }).resolvedLights;
    const k = hazeRadiance(1.8, lights.direction.y, 0.7);
    expect(k).toBeLessThan(hazeRadiance(2.6, SUN_DIRECTION.y, 0.9));
    const [lr] = hexToLinear('#D1A668');
    expect(tintOf(pass)[0]).toBeCloseTo(lr * k, 6);
    expect(pass.uniforms.uHazeFar.value).toBe(0.18);
    hazed(r).fogPass = null;
    pass.dispose();
    r.dispose();
  });

  it('a rebuild hands the pass the median open-ground level (N-19)', () => {
    const r = new ThreeRenderer(makeSim(), makeOpts());
    const pass = withPass(r);
    r.setElevation(Uint8Array.from([0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3]));
    hazed(r).rebuildTerrain();
    expect(pass.uniforms.uHazeRef.value).toBe(2);
    hazed(r).fogPass = null;
    pass.dispose();
    r.dispose();
  });

  it('frame() puts the focus at the camera look-at point', () => {
    const r = new ThreeRenderer(makeSim(), makeOpts());
    const pass = withPass(r);
    r.camera.x = 3.25;
    r.camera.y = 1.5;
    r.frame(1, 0);
    expect(pass.uniforms.uFocus.value.toArray()).toEqual([3.25, 1.5]);
    hazed(r).fogPass = null;
    pass.dispose();
    r.dispose();
  });
});

describe('the colour pipeline', () => {
  // Replaces `palette-material.test.ts`'s own `applyPalettePipeline` test,
  // deleted with that module (Task 7): the pass-through colour space it
  // pinned is gone, folded into four plain assignments at the
  // `ThreeRenderer` constructor's own call site instead of one shared
  // function, so this is where that behaviour is proven now.
  it('configures the standard sRGB + ACES output and the palette background as clear colour', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = (renderer as unknown as { renderer: { outputColorSpace: string; toneMapping: number; clearColorCalls: string[] } }).renderer;
    expect(gl.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(gl.clearColorCalls).toEqual(['14150f']);
    // And the SCENE background, which is the one the composer actually
    // clears with: `setClearColor` alone leaves the GL clear colour holding
    // an sRGB-encoded triple whenever the previous `renderer.render` went to
    // the screen (SMAAPass does, every frame), and `RenderPass` then clears
    // the linear target with it -- measured off the map edge as #484b3b for
    // this #14150f. `Scene.background` is read with the target bound, so it
    // converts to linear. See the constructor's own comment.
    const scene = (renderer as unknown as { scene: THREE.Scene }).scene;
    expect((scene.background as THREE.Color).getHexString()).toBe('14150f');
    renderer.dispose();
  });
});

describe('the ground beyond the map', () => {
  /** Reaches the two private members this describe is about, the same way
   *  the fog-shroud guard above reaches `shroud`. */
  function internals(r: ThreeRenderer): {
    skirtMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    loadGroundTexture(): void;
  } {
    return r as unknown as ReturnType<typeof internals>;
  }

  it('binds the OPEN-GROUND albedo to the skirt, as a ratio to the image mean', () => {
    // The surviving mutant this test was written for: deleting the
    // `slot === 'sand'` branch in `loadGroundTexture` leaves the skirt
    // drawing flat `SKIRT_TONE` with no grain at all, and NOTHING else sees
    // it -- the visual gate's `skirt` toggle still moves tens of thousands
    // of pixels, because a flat quad is still a quad.
    const r = new ThreeRenderer(makeSim(), {
      ...makeOpts(),
      groundTextureUrl: 'http://example.invalid/desert_sand_tile.png',
    });
    const mesh = internals(r).skirtMesh;
    expect(mesh.material.map).toBeNull();
    internals(r).loadGroundTexture();
    expect(mesh.material.map).not.toBeNull();
    // The SAME texture object the ground material samples: one upload, and a
    // repeat that lines up with the ground's at the map edge.
    const ground = (r as unknown as { groundMat: { uniforms: Record<string, { value: unknown }> } })
      .groundMat;
    expect(mesh.material.map).toBe(ground.uniforms.uSand.value);
    // And applied as a ratio: `color * mean` is back at SKIRT_TONE.
    const mean = albedoMean('desert_sand_tile');
    expect(mesh.material.color.r * mean.x).toBeCloseTo(SKIRT_TONE.r, 5);
    expect(mesh.material.color.g * mean.y).toBeCloseTo(SKIRT_TONE.g, 5);
    expect(mesh.material.color.b * mean.z).toBeCloseTo(SKIRT_TONE.b, 5);
    r.dispose();
  });

  it('dispose() frees the skirt -- the same shape of leak the fog layer once had', () => {
    // It is added once in the CONSTRUCTOR and never rebuilt, so it is not
    // covered by `rebuildTerrain`'s own remove-and-dispose sweep; if
    // `dispose()` misses it, `tools/src/perf/three-units.ts` leaks one
    // geometry and one material per renderer it constructs.
    const r = new ThreeRenderer(makeSim(), makeOpts());
    const mesh = internals(r).skirtMesh;
    let geometryDisposed = 0;
    let materialDisposed = 0;
    mesh.geometry.addEventListener('dispose', () => {
      geometryDisposed += 1;
    });
    mesh.material.addEventListener('dispose', () => {
      materialDisposed += 1;
    });
    r.dispose();
    expect(geometryDisposed).toBe(1);
    expect(materialDisposed).toBe(1);
  });
});
