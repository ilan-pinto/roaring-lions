/**
 * @vitest-environment jsdom
 *
 * jsdom, uniquely among this package's tests, because `SMAAPass` builds its
 * two lookup textures from `new Image()` with a base64 `src` -- a DOM global
 * the repo's default `environment: 'node'` does not have, so constructing
 * the real chain throws `ReferenceError: Image is not defined`. Stubbing the
 * pass instead would leave the one assertion that matters here -- that SMAA
 * is LAST, after the output transform -- testing a stand-in. jsdom never
 * fetches the data URI (no `resources: 'usable'`), so the cost is the
 * environment and nothing else.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createPostChain,
  createAoPass,
  isAoOccluder,
  AO_RADIUS_TILES,
  AO_RESOLUTION_SCALE,
  AO_SCALE,
  PIXEL_RATIO_CAP,
} from './post-chain';
import { GTAOPass as THREE_GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import type { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/**
 * The order-sensitive digest of the 64x64 RGBA Poisson-denoise noise texture
 * `WorldGTAOPass.generateNoise` builds from `AO_NOISE_SEED`.
 *
 * Recorded here rather than recomputed, because the property under test is
 * that this number is the same in EVERY process -- comparing two textures
 * built side by side would pass even with three's own `Math.random()`
 * version. Changing the seed, the generator, or upgrading three's
 * `SimplexNoise` moves it, and moving it means every golden baseline needs
 * re-blessing.
 */
const AO_NOISE_DIGEST = 3346967380;

/** The composer needs only these members of a renderer at construction. */
function fakeRenderer(): THREE.WebGLRenderer {
  const size = new THREE.Vector2(1440, 900);
  return {
    getSize: (v: THREE.Vector2) => v.copy(size),
    getPixelRatio: () => 1,
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    getContext: () => ({}),
  } as unknown as THREE.WebGLRenderer;
}

describe('createPostChain', () => {
  it('orders RenderPass, OutputPass, SMAAPass with a single-sampled HalfFloat target that carries depth+stencil', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 1440, 900, 1);
    expect(chain.passNames).toEqual(['RenderPass', 'OutputPass', 'SMAAPass']);
    const target = chain.composer.renderTarget1;
    expect(target.samples).toBe(0);
    expect(target.texture.type).toBe(THREE.HalfFloatType);
    expect(target.stencilBuffer).toBe(true);
    expect(target.depthTexture).not.toBeNull();
    expect(target.depthTexture?.format).toBe(THREE.DepthStencilFormat);
    expect(chain.composer.renderTarget2.depthTexture).not.toBeNull();
  });

  it('gives each buffer its OWN depth-stencil texture, not the clone that shares a Source', () => {
    // `EffectComposer` builds renderTarget2 as `renderTarget1.clone()`, and
    // that clone's depth texture shares a `THREE.Source` with the original
    // (`Texture.copy` does `this.source = source.source`; `RenderTarget.copy`
    // re-sources only the colour texture). `WebGLTextures` caches the GL
    // texture per Source under a parameters-only key, so a shared Source
    // means ONE `__webglTexture` for both buffers -- and a pass that samples
    // `readBuffer.depthTexture` while drawing into `writeBuffer` is then a
    // WebGL2 feedback loop, silently dropping the draw. Identity of the
    // `Source`, not of the `DepthTexture`, is the thing that has to differ.
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 1440, 900, 1);
    const one = chain.composer.renderTarget1.depthTexture;
    const two = chain.composer.renderTarget2.depthTexture;
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect((one as THREE.DepthTexture).source).not.toBe((two as THREE.DepthTexture).source);
    expect((two as THREE.DepthTexture).format).toBe(THREE.DepthStencilFormat);
    expect((two as THREE.DepthTexture).type).toBe(THREE.UnsignedInt248Type);
  });

  it('slots the fog pass after RenderPass and the AO pass after fog, OutputPass and SMAA last', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 1);
    const fog = { name: 'FogOfWarPass', render() {}, setSize() {}, dispose() {}, needsSwap: true, enabled: true, clear: false, renderToScreen: false } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    const ao = { ...fog, name: 'GTAOPass' } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    chain.setFogPass(fog);
    chain.setAoPass(ao);
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'GTAOPass', 'OutputPass', 'SMAAPass']);
    chain.setAoPass(null);
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'OutputPass', 'SMAAPass']);
  });

  it('createAoPass is a GTAOPass at the spec radius and scale, in world units', () => {
    const pass = createAoPass(new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600) as GTAOPass;
    // `instanceof`, not `constructor.name`: what ships is `WorldGTAOPass`, a
    // subclass, because this scene needs its G-buffer filtered and its
    // targets scaled (both below). The plan's own expectation was the bare
    // class name, and it is recorded here as changed rather than worked
    // around -- a diagnostic that reported plain `GTAOPass` for a pass that
    // does not behave like one would be the worse outcome.
    expect(pass).toBeInstanceOf(THREE_GTAOPass);
    expect(pass.constructor.name).toBe('WorldGTAOPass');
    expect(AO_RADIUS_TILES).toBe(0.6);
    expect(AO_SCALE).toBe(1.2);
    // The two constants have to reach the SHADER, not merely be exported at
    // the right value -- `updateGtaoMaterial` is the only thing that carries
    // them across, and a call that silently dropped a key would leave three's
    // own defaults (radius 0.25, scale 1) shading the scene while the
    // assertions above stayed green.
    expect(pass.gtaoMaterial.uniforms.radius.value).toBe(AO_RADIUS_TILES);
    expect(pass.gtaoMaterial.uniforms.scale.value).toBe(AO_SCALE);
    // World units, not screen: `screenSpaceRadius` is a shader DEFINE, and
    // with it on, `radius` would be read as pixels and the contact shadow
    // would swim as the player zooms. See `createAoPass` for why this is the
    // deliberate opposite of the occlusion outline's constant pixel width.
    expect(pass.gtaoMaterial.defines.SCREEN_SPACE_RADIUS).toBe(0);
    // An ORTHOGRAPHIC define, taken from the camera once at construction --
    // which is why `init()` hands over the persistent `viewCamera`.
    expect(pass.gtaoMaterial.defines.PERSPECTIVE_CAMERA).toBe(0);
    expect(pass.blendIntensity).toBe(1.0);
    pass.dispose();
  });

  it('builds the AO denoise noise texture from a seed, so two processes photograph the same frame', () => {
    // The gate found this, not a reviewer. `GTAOPass.generateNoise` does `new
    // SimplexNoise()`, and three's `SimplexNoise` defaults its random source
    // to `Math` -- so the Poisson-denoise kernel rotation was a fresh draw
    // from `Math.random()` per process. Inside one process the frame is
    // bit-identical (the visual gate's zero-time repaint control reads 0 px /
    // 0.0000), which is why it survived every in-process test; ACROSS
    // processes `quiet` moved 20 px / 0.1021 and `relief` 2 px / 0.1418
    // against a baseline blessed from the same commit minutes before, where
    // the pre-AO renderer read 0-1 px / 0.0000-0.0001 over 73 runs.
    //
    // Two passes built in the SAME process would agree even with the bug, so
    // this asserts against a stored digest of the seeded stream rather than
    // against a sibling: the texture has to be the same NUMBER, not merely
    // the same twice.
    const a = createAoPass(new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600) as GTAOPass;
    const b = createAoPass(new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600) as GTAOPass;
    const dataA = a.pdNoiseTexture.image.data as Uint8Array;
    const dataB = b.pdNoiseTexture.image.data as Uint8Array;
    expect(dataA.length).toBe(64 * 64 * 4);
    expect(Array.from(dataA)).toEqual(Array.from(dataB));
    // A cheap order-sensitive digest of the whole texture. Any change to the
    // seed, the generator or three's noise function moves it -- which is the
    // point: this number IS the contract that every capture environment
    // shares, and a deliberate change to it means re-blessing the baselines.
    let digest = 0;
    for (let i = 0; i < dataA.length; i++) digest = (digest * 31 + dataA[i]) >>> 0;
    expect(digest).toBe(AO_NOISE_DIGEST);
    // And it is real noise, not a constant field the assertions above would
    // also accept.
    expect(new Set(dataA).size).toBeGreaterThan(32);
    a.dispose();
    b.dispose();
  });

  it('the real AO pass lands between fog and OutputPass, and the composer sizes it', () => {
    // The stand-in test above proves the ORDER with a plain object labelled
    // the way the plan names the slot; this one proves the REAL pass takes
    // that slot -- reporting `WorldGTAOPass`, the subclass this scene needs
    // -- and that the size it was constructed with is not the size it runs
    // at: `EffectComposer.addPass` re-sizes every pass it takes to css x
    // pixel ratio, so a half-resolution AO cannot be bought by passing half
    // the width here (it must intercept `setSize`, and does).
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 2);
    const fog = { name: 'FogOfWarPass', render() {}, setSize() {}, dispose() {}, needsSwap: true, enabled: true, clear: false, renderToScreen: false } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    const ao = createAoPass(new THREE.Scene(), new THREE.OrthographicCamera(), 400, 300) as GTAOPass;
    chain.setFogPass(fog);
    chain.setAoPass(ao);
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'WorldGTAOPass', 'OutputPass', 'SMAAPass']);
    expect(ao.width).toBe(1600);
    expect(ao.height).toBe(1200);
    chain.setAoPass(null);
    ao.dispose();
  });

  /** A mesh with the geometry attributes and material flags named, and
   *  nothing else -- the three things `isAoOccluder` reads. */
  function meshWith(opts: { normals: boolean; transparent?: boolean; depthWrite?: boolean }): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    if (opts.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    const material = new THREE.MeshBasicMaterial();
    material.transparent = opts.transparent ?? false;
    material.depthWrite = opts.depthWrite ?? true;
    return new THREE.Mesh(geometry, material);
  }

  it('keeps everything but the opaque world out of the AO G-buffer', () => {
    // Each `false` below is a shape GTAO's `MeshNormalMaterial` override
    // would otherwise stamp into its normal AND depth buffers -- see
    // `isAoOccluder`. The no-normals case is the one that drew every unit on
    // screen solid black: three normalises the absent attribute's zero
    // vector and writes NaN.
    expect(isAoOccluder(meshWith({ normals: true }))).toBe(true);
    expect(isAoOccluder(meshWith({ normals: false }))).toBe(false);
    expect(isAoOccluder(meshWith({ normals: true, transparent: true }))).toBe(false);
    expect(isAoOccluder(meshWith({ normals: true, depthWrite: false }))).toBe(false);
    // Not a mesh: the override material never draws it, and the base pass
    // hides points and lines itself. Saying `false` here would hide whole
    // subtrees, because visibility in three is inherited.
    expect(isAoOccluder(new THREE.Group())).toBe(true);
    expect(isAoOccluder(new THREE.Object3D())).toBe(true);
  });

  it('the AO pass hides non-occluders for its own render and puts them back', () => {
    // The predicate above is only half of it; this is the half that was
    // broken on screen. `overrideVisibility` runs immediately before GTAO
    // re-renders the scene through its normal material, and
    // `restoreVisibility` immediately after -- so a unit's outline hull must
    // be invisible in between and visible again by the time the next
    // RenderPass draws it, or the outline disappears from the game.
    const scene = new THREE.Scene();
    const world = meshWith({ normals: true });
    const outlineHull = meshWith({ normals: false, transparent: true, depthWrite: false });
    scene.add(world, outlineHull);
    const pass = createAoPass(scene, new THREE.OrthographicCamera(), 800, 600) as GTAOPass;

    pass.overrideVisibility();
    expect(world.visible).toBe(true);
    expect(outlineHull.visible).toBe(false);

    pass.restoreVisibility();
    expect(world.visible).toBe(true);
    expect(outlineHull.visible).toBe(true);
    pass.dispose();
  });

  /**
   * Enough renderer for `GTAOPass.render` to run without a GL context: it
   * touches `shadowMap.autoUpdate` (this subclass) and is otherwise only
   * handed to `renderOverride`/`renderPass`, both stubbed by the callers
   * below.
   */
  function fakeRendererWithShadows(): THREE.WebGLRenderer {
    return { shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false } } as unknown as THREE.WebGLRenderer;
  }

  /** A scene with one piece of world and one outline hull, plus the pass
   *  that will hide the hull for its G-buffer render. */
  function aoOverScene(): { pass: GTAOPass; world: THREE.Mesh; outlineHull: THREE.Mesh } {
    const scene = new THREE.Scene();
    const world = meshWith({ normals: true });
    const outlineHull = meshWith({ normals: false, transparent: true, depthWrite: false });
    scene.add(world, outlineHull);
    return { pass: createAoPass(scene, new THREE.OrthographicCamera(), 8, 6) as GTAOPass, world, outlineHull };
  }

  it('renders its G-buffer with the shadow map switched off, and hands it back', () => {
    // `renderOverride` is a full `renderer.render(scene, camera)`, and a
    // shadow pass runs on every one of those -- so without this, the sun's
    // 4096 map was being redrawn for the whole scene once per frame and
    // thrown away, for a pre-pass that draws through `MeshNormalMaterial`
    // and consumes no shadows.
    const { pass } = aoOverScene();
    const renderer = fakeRendererWithShadows();
    const seen: boolean[] = [];
    Object.assign(pass, {
      renderOverride: () => seen.push(renderer.shadowMap.autoUpdate),
      renderPass: () => undefined,
    });

    const target = new THREE.WebGLRenderTarget(8, 6);
    pass.render(renderer, target, target, 0, false);

    expect(seen).toEqual([false]);
    // Restored, because the composer's RenderPass draws this frame's real
    // shadows and must go on doing so -- this is scoped to the nested
    // render, NOT the frame-level freeze that would pin shadows under
    // moving units.
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    target.dispose();
    pass.dispose();
  });

  it('restores visibility and the shadow flag when the G-buffer render throws', () => {
    // Between `overrideVisibility` and `restoreVisibility` every billboard,
    // tracer, decal, overlay and outline hull in the scene is invisible. A
    // transient throw in there -- a shader compile failure, a lost context
    // -- must not leave them that way for the rest of the session.
    const { pass, world, outlineHull } = aoOverScene();
    const renderer = fakeRendererWithShadows();
    Object.assign(pass, {
      renderOverride: () => {
        throw new Error('G-buffer render failed');
      },
      renderPass: () => undefined,
    });

    const target = new THREE.WebGLRenderTarget(8, 6);
    expect(() => pass.render(renderer, target, target, 0, false)).toThrow('G-buffer render failed');

    expect(outlineHull.visible).toBe(true);
    expect(world.visible).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    target.dispose();
    pass.dispose();
  });

  it('does not restore visibility twice on the happy path', () => {
    // `GTAOPass.restoreVisibility` is NOT idempotent in r170: it writes
    // `cache.get(object)` onto every object and then clears the cache, so a
    // second call assigns `undefined` -- falsy -- to `visible` on the whole
    // scene. The guard flag is what stops the `finally` above from blanking
    // the frame on every successful render.
    const { pass, world, outlineHull } = aoOverScene();
    const renderer = fakeRendererWithShadows();
    Object.assign(pass, { renderOverride: () => undefined, renderPass: () => undefined });

    const target = new THREE.WebGLRenderTarget(8, 6);
    pass.render(renderer, target, target, 0, false);

    expect(world.visible).toBe(true);
    expect(outlineHull.visible).toBe(true);
    target.dispose();
    pass.dispose();
  });

  it('runs the AO targets at AO_RESOLUTION_SCALE of the frame, through resize', () => {
    // Half resolution is the reason this pass fits the frame budget at all
    // (see `AO_RESOLUTION_SCALE`), and `setSize` is the only place it can
    // live -- `addPass` overwrites the constructor's size. A resize must not
    // quietly restore full resolution, which is what a scale applied only at
    // construction would do.
    expect(AO_RESOLUTION_SCALE).toBe(0.5);
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 2);
    const ao = createAoPass(
      new THREE.Scene(),
      new THREE.OrthographicCamera(),
      800,
      600,
      AO_RESOLUTION_SCALE
    ) as GTAOPass;
    chain.setAoPass(ao);
    expect(ao.width).toBe(800);
    expect(ao.height).toBe(600);
    chain.setSize(1000, 500, 2);
    expect(ao.width).toBe(1000);
    expect(ao.height).toBe(500);
    chain.setAoPass(null);
    ao.dispose();
  });

  it('sizes the target by css size times pixel ratio', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 2);
    expect(chain.composer.renderTarget1.width).toBe(1600);
    chain.setSize(400, 300, 2);
    expect(chain.composer.renderTarget1.width).toBe(800);
    expect(PIXEL_RATIO_CAP).toBe(2);
  });
});
