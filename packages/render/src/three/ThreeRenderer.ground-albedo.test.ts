/**
 * `captureGroundAlbedo` -- the minimap's photograph of this map's lit ground
 * (`../api.ts`, shell-upgrade Phase 2 Task 15).
 *
 * What is and is not testable here, and why the split is where it is.
 *
 * The PICTURE is not. `new THREE.WebGLRenderer(...)` cannot construct under
 * this suite's `environment: 'node'`, so the fake below stands in for it --
 * the same device `ThreeRenderer.test.ts` already uses, and for the same
 * reason. Whether the ground comes back the right way up, the right colour
 * and the right way round is the visual gate's question, and the pieces that
 * CAN be pinned without a GPU are pinned where they are pure: `flipRows`
 * (`packages/app/src/ui/minimap.ts`, two tests) owns the row order, and
 * `api.test.ts` owns the seam's shape.
 *
 * What IS testable is the thing most likely to go wrong and least likely to
 * be noticed: this method switches two draw layers OFF and back ON around
 * one render. A restore that did not run would take every unit and every
 * overlay off the battlefield for the rest of the mission -- silently, from
 * a HUD decoration, and nowhere near the code that drew them. Three of the
 * four tests below are about that, one of them through a render that throws,
 * because "it restores when everything goes right" is the easy half.
 *
 * Global `ImageData` is shimmed for the same reason jsdom needs one in
 * `minimap.test.ts`: node has none, and without it the success path would
 * throw on its last line and be measured as the failure path.
 *
 * FIX ROUND 1 added a coverage rasteriser to the fake, and it is worth being
 * precise about what it does and does not prove. It walks the REAL scene the
 * production code hands it, with the REAL `THREE.OrthographicCamera` that
 * code configured, and increments one counter per pixel for every visible
 * mesh whose world-space bounding box projects onto it. So "these pixels
 * changed when that object went away" is a genuine statement about this
 * scene and this camera -- it catches an object missing from the scene, an
 * object hidden, an object outside the frustum, and a frustum or `up` vector
 * that frames the wrong ground. It says NOTHING about colour, shading,
 * texture, depth order or the flip; those belong to the visual gate and to
 * `pnpm ui:shots`, and `flipRows` owns the row order in its own pure tests.
 * It is a contribution test, exactly the shape of this repo's visible-toggle
 * A/B, and it is deliberately not dressed up as a photograph.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { BuildingMeshTemplate } from './units/mesh-building';

/** Set by the fake renderer at the moment it is asked to draw, so a test can
 *  ask what the scene looked like DURING the capture rather than after it. */
let onRender: (() => void) | null = null;
/** Every `render()` the fake was asked for. One capture is two: the scene
 *  pass, then `OutputPass`'s full-screen quad. */
let renderCalls = 0;
let throwOnRender = false;
/** The last SCENE render's coverage, one byte per pixel -- see the file
 *  header. `readRenderTargetPixels` answers from this, so the `ImageData`
 *  the production code returns carries it. */
let coverage: Uint8Array | null = null;
/** The square the current render target was made at, taken from
 *  `setRenderTarget` rather than guessed. */
let targetSize = 0;
/** Ground-albedo texture loads the fake loader has accepted and not yet
 *  completed. Calling one is "this tile just arrived over the network",
 *  which is the only way to reproduce the boot race from a test: `init()`
 *  fires six of these and awaits none of them. */
let pendingTextures: (() => void)[] = [];

/**
 * One byte per pixel: how many VISIBLE meshes' world bounding boxes project
 * onto it, through the camera the caller actually configured.
 *
 * Bounding boxes rather than triangles, and no depth test: this measures
 * CONTRIBUTION -- "did this object reach these pixels" -- which is the only
 * question the tests below ask and the same question the repo's own
 * visible-toggle A/B asks of the real renderer. Rows are written bottom-up,
 * GL's own order, so the fake lies in the same direction the real readback
 * does and `flipRows` is exercised on the app side exactly as in production.
 */
function rasterise(scene: THREE.Object3D, camera: THREE.Camera, size: number): Uint8Array {
  const out = new Uint8Array(Math.max(size, 0) * Math.max(size, 0));
  if (size <= 0) return out;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  scene.traverseVisible((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh !== true || !mesh.geometry) return;
    const geometry = mesh.geometry;
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const local = geometry.boundingBox;
    if (local === null || local.isEmpty()) return;
    box.copy(local).applyMatrix4(mesh.matrixWorld);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      corner.set(
        (c & 1) === 0 ? box.min.x : box.max.x,
        (c & 2) === 0 ? box.min.y : box.max.y,
        (c & 4) === 0 ? box.min.z : box.max.z
      );
      corner.project(camera);
      const px = ((corner.x + 1) / 2) * size;
      // Bottom-up, GL's origin.
      const py = ((corner.y + 1) / 2) * size;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
    const lo = (v: number): number => Math.max(0, Math.min(size, Math.floor(v)));
    const hi = (v: number): number => Math.max(0, Math.min(size, Math.ceil(v)));
    for (let y = lo(y0); y < hi(y1); y++) {
      for (let x = lo(x0); x < hi(x1); x++) {
        const i = y * size + x;
        if (out[i] < 255) out[i]++;
      }
    }
  });
  return out;
}

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    toneMapping = actual.ACESFilmicToneMapping;
    toneMappingExposure = 1;
    domElement: unknown = {};
    shadowMap = { enabled: false, autoUpdate: true, type: 0 };
    private target: unknown = null;
    setClearColor(): void {}
    setRenderTarget(t: unknown): void {
      this.target = t;
      const rt = t as { width?: number } | null;
      if (rt && typeof rt.width === 'number') targetSize = rt.width;
    }
    getRenderTarget(): unknown {
      return this.target;
    }
    clear(): void {}
    render(subject: THREE.Object3D, camera: THREE.Camera): void {
      renderCalls++;
      onRender?.();
      if (throwOnRender) throw new Error('context lost');
      // A `Pass`'s own full-screen quad arrives as a bare `Mesh`, never a
      // `Scene` (`FullScreenQuad.render` calls `renderer.render(this._mesh,
      // this._camera)`). Only the world render is rasterised; the encode
      // pass would otherwise splat the whole frame and erase what the scene
      // pass measured.
      if ((subject as THREE.Scene).isScene !== true) return;
      coverage = rasterise(subject, camera, targetSize);
    }
    /** Answers from the coverage the scene render built, so the `ImageData`
     *  the production code returns actually carries what was in the scene --
     *  and a buffer that was never written reads 0 rather than a plausible
     *  constant. */
    readRenderTargetPixels(
      _t: unknown,
      _x: number,
      _y: number,
      w: number,
      h: number,
      buffer: Uint8Array
    ): void {
      const cov = coverage;
      for (let i = 0; i < w * h; i++) {
        // Scaled so one object's worth of coverage is plainly visible in a
        // byte, and saturating rather than wrapping -- a wrap would let two
        // different scenes read identically.
        const v = cov === null ? 0 : Math.min(255, cov[i] * 24);
        buffer[i * 4] = v;
        buffer[i * 4 + 1] = v;
        buffer[i * 4 + 2] = v;
        buffer[i * 4 + 3] = 255;
      }
    }
    setPixelRatio(): void {}
    dispose(): void {}
  }
  /**
   * Records each load rather than completing it, so a test can land a texture
   * at a chosen moment -- specifically AFTER a photograph has already been
   * taken, which is the real boot order this file's newest pair is about:
   * `init()` fires these six and does not await them.
   *
   * Deferring is safe for every other test here because `makeOpts()` declares
   * no texture URL at all, so nothing is queued unless a test asks for it.
   */
  class FakeTextureLoader {
    load(_url: string, onLoad: (t: THREE.Texture) => void): THREE.Texture {
      const tex = new actual.Texture();
      pendingTextures.push(() => onLoad(tex));
      return tex;
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer, TextureLoader: FakeTextureLoader };
});

class ImageDataShim {
  readonly colorSpace: PredefinedColorSpace = 'srgb';
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as { ImageData?: typeof ImageData }).ImageData =
    ImageDataShim as unknown as typeof ImageData;
}

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
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

function makeRenderer(): ThreeRenderer {
  return new ThreeRenderer(new Sim({ seed: 1, width: 8, height: 8, capacity: 4 }), makeOpts());
}

const TOWN_TILES = 8 * 8;

/**
 * A renderer whose open-ground slot has a texture URL, with
 * `loadGroundTexture` already run so the load is queued in `pendingTextures`
 * and lands only when a test says so.
 *
 * The private method is called directly rather than through `init(host)`:
 * `init` is the async method that wants a live GL context and a DOM host,
 * neither of which exists under `environment: 'node'`, and everything this
 * pair is about happens between that one call and the first capture. The URL
 * has to name a row of `GROUND_ALBEDOS` (`terrain/mesh.ts`) or the loader
 * refuses it before any fetch, which would queue nothing.
 */
function makeTexturedRenderer(): ThreeRenderer {
  const r = new ThreeRenderer(new Sim({ seed: 1, width: 8, height: 8, capacity: 4 }), {
    ...makeOpts(),
    groundTextureUrl: 'https://example.test/assets/desert_sand_tile.jpg',
  });
  (r as unknown as { loadGroundTexture(): void }).loadGroundTexture();
  return r;
}

/**
 * A renderer over a map with ONE structure whose building mesh has
 * "loaded" -- a 2x2x2 box standing in for a GLB, which is all
 * `instantiateBuildingMesh` needs (it clones `template.root` and nothing
 * else).
 *
 * The template is written straight into `buildingMeshIdleTemplates` because
 * the real route is `loadBuildingMesh`, an async `GLTFLoader` fetch that has
 * no headless equivalent. What that map controls is the two things this test
 * is about: `composeTerrain`'s `hasArt` stops drawing the structure's
 * palette box, and `updateBuildingMeshes` stands the clone up. Both read the
 * map, so injecting it reproduces the real state exactly.
 *
 * `setDecor` is called here so both captures in a comparison start from the
 * identical terrain input, and is the same call used later to mark the
 * terrain dirty and drop the memo between them.
 */
function makeTownRenderer(): { renderer: ThreeRenderer; template: BuildingMeshTemplate } {
  const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
  const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
  sim.addStructure(type, [0]);
  const renderer = new ThreeRenderer(sim, makeOpts());
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const root = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const template: BuildingMeshTemplate = { root, materials: [], geometries: [geometry] };
  (renderer as unknown as { buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate> })
    .buildingMeshIdleTemplates.set('shanty', template);
  renderer.setDecor(new Uint8Array(TOWN_TILES));
  return { renderer, template };
}

/** The clones `updateBuildingMeshes` has stood up, by structure index. */
function buildingRoots(r: ThreeRenderer): Map<number, THREE.Object3D> {
  return (r as unknown as { buildingMeshIdleEntities: Map<number, THREE.Object3D> })
    .buildingMeshIdleEntities;
}

/** The two things `setDebugLayerVisible('units'|'overlays', ...)` actually
 *  writes, read back off the real objects rather than off a spy -- the
 *  failure worth catching is a restore that did not RUN, and a spy on the
 *  call would report it either way. */
function layerState(r: ThreeRenderer): { unitsHidden: boolean; overlaysVisible: boolean } {
  const inner = r as unknown as {
    unitsDebugHidden: boolean;
    overlayBatch: { mesh: THREE.Object3D };
  };
  return { unitsHidden: inner.unitsDebugHidden, overlaysVisible: inner.overlayBatch.mesh.visible };
}

beforeEach(() => {
  onRender = null;
  renderCalls = 0;
  throwOnRender = false;
  coverage = null;
  targetSize = 0;
  pendingTextures = [];
});

/**
 * A capture, narrowed to non-null.
 *
 * The assertion is what fails the test, by name and at the line that took
 * the picture; the throw exists only to narrow the type for the comparisons
 * below. A `!` would do neither -- it would read as "this cannot be null"
 * where the whole point of this method is that it CAN be, and a regression
 * would surface as a TypeError on a property access several lines away from
 * the capture that actually failed.
 */
function shot(img: ImageData | null): ImageData {
  expect(img).not.toBeNull();
  if (img === null) throw new Error('captureGroundAlbedo returned null');
  return img;
}

/** How many pixels of two captures of the same map differ at all. */
function pixelDelta(a: ImageData, b: ImageData): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i]) n++;
  }
  return n;
}

describe('ThreeRenderer.captureGroundAlbedo', () => {
  it('refuses a size that is not a square of pixels, without drawing anything', () => {
    const r = makeRenderer();
    expect(r.captureGroundAlbedo(0)).toBeNull();
    expect(r.captureGroundAlbedo(-8)).toBeNull();
    expect(r.captureGroundAlbedo(Number.NaN)).toBeNull();
    expect(renderCalls).toBe(0);
    r.dispose();
  });

  it('photographs the ground the app asked for, at the size it asked for', () => {
    const r = makeRenderer();
    const shot = r.captureGroundAlbedo(48);
    expect(shot).not.toBeNull();
    expect(shot?.width).toBe(48);
    expect(shot?.height).toBe(48);
    // The read-back arriving with the SCENE in it, rather than an untouched
    // buffer that happens to be the right length: the fake answers from the
    // coverage its rasteriser built, so a non-zero channel means geometry
    // projected onto that pixel. Opaque, because this is a photograph of
    // ground -- a transparent one would blit as nothing at all, which reads
    // exactly like the painted fallback.
    expect(shot?.data.some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);
    expect(shot?.data[3]).toBe(255);
    expect(renderCalls).toBeGreaterThan(0);
    r.dispose();
  });

  it('draws the ground with the units and the overlays switched off, and puts both back', () => {
    const r = makeRenderer();
    let duringRender: { unitsHidden: boolean; overlaysVisible: boolean } | null = null;
    onRender = () => {
      duringRender ??= layerState(r);
    };

    expect(r.captureGroundAlbedo(48)).not.toBeNull();

    // The minimap draws its own dots from `sim.state` under its own fog
    // rule, so a unit baked into the ground would be a second, permanent,
    // unfogged copy of the roster.
    expect(duringRender).toEqual({ unitsHidden: true, overlaysVisible: false });
    expect(layerState(r)).toEqual({ unitsHidden: false, overlaysVisible: true });
    r.dispose();
  });

  it('puts them back even when the render throws -- a lost context must not empty the battlefield', () => {
    const r = makeRenderer();
    throwOnRender = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Null rather than a throw: this is a HUD decoration, and the minimap's
    // own fallback is the painted terrain.
    expect(r.captureGroundAlbedo(48)).toBeNull();
    expect(layerState(r)).toEqual({ unitsHidden: false, overlaysVisible: true });
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    r.dispose();
  });

  it('stands the buildings up before it draws, so a town is not bare pads', () => {
    // The defect this closes: `updateBuildingMeshes` runs inside `frame()`,
    // and `main.ts` mounts the minimap some 1500 lines before the first
    // `frame()` call -- while `composeTerrain`'s `hasArt` has ALREADY
    // stopped drawing the palette box for a structure whose art loaded. So
    // a capture that did not stand the buildings up photographed a town as
    // its `underBuilding` pads: no buildings, and no building shadows.
    const { renderer: r } = makeTownRenderer();

    const withBuilding = shot(r.captureGroundAlbedo(64));
    // The direct statement: the capture itself put the clone in the scene.
    expect(buildingRoots(r).size).toBe(1);

    // CONTROL FIRST, because the comparison below re-captures and a
    // re-capture that moved on its own would make any delta meaningless.
    // `setDecor` marks the terrain dirty -- which drops the memo -- with
    // byte-identical decor, so this second capture must be the same
    // picture. Without this the test could pass on a terrain rebuild that
    // is merely nondeterministic.
    r.setDecor(new Uint8Array(TOWN_TILES));
    const again = shot(r.captureGroundAlbedo(64));
    expect(pixelDelta(withBuilding, again)).toBe(0);

    // Now the same capture with the building hidden.
    // `updateBuildingMeshes` only INSTANTIATES a clone it does not already
    // have and never re-asserts `visible`, so this holds across the capture.
    const root = [...buildingRoots(r).values()][0];
    root.visible = false;
    r.setDecor(new Uint8Array(TOWN_TILES));
    const withoutBuilding = shot(r.captureGroundAlbedo(64));

    const delta = pixelDelta(again, withoutBuilding);
    expect(delta).toBeGreaterThan(0);
    // And it is the BUILDING that moved, not the whole frame: a 2x2x2 box
    // on an 8x8 map cannot reach most of the picture, so a delta that did
    // would mean something else changed between the two captures and this
    // test was measuring that instead.
    expect(delta).toBeLessThan(64 * 64 * 0.5);
  });

  it('restores both layers when the SECOND hide throws', () => {
    // The hides are two calls. With them outside the try that owns the
    // restore, a throw from the second leaves the first one's layer hidden
    // for the rest of the mission -- every unit gone, from a minimap.
    const r = makeRenderer();
    const mesh = (r as unknown as { overlayBatch: { mesh: THREE.Object3D } }).overlayBatch.mesh;
    let visible = true;
    // Refuses to be hidden and accepts being shown, so the restore itself
    // is not what fails -- the injection is precisely "the second hide
    // throws", and nothing else.
    Object.defineProperty(mesh, 'visible', {
      configurable: true,
      get: () => visible,
      set: (next: boolean) => {
        if (next === false) throw new Error('refusing to hide');
        visible = next;
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(r.captureGroundAlbedo(48)).toBeNull();
    expect(layerState(r)).toEqual({ unitsHidden: false, overlaysVisible: true });

    warn.mockRestore();
    r.dispose();
  });

  it('puts a layer somebody else hid on purpose back to HIDDEN, not to visible', () => {
    // A debug harness -- the visual gate's toggle A/B, `plate-capture.ts` --
    // switches a layer off deliberately and then photographs. A minimap
    // capture running in between must not hand it back a different scene
    // than the one it asked for.
    const r = makeRenderer();
    r.setDebugLayerVisible('overlays', false);

    expect(r.captureGroundAlbedo(48)).not.toBeNull();

    expect(layerState(r)).toEqual({ unitsHidden: false, overlaysVisible: false });
    r.dispose();
  });

  it('is taken once per map, and dropped when the terrain is rebuilt', () => {
    const r = makeRenderer();
    r.captureGroundAlbedo(48);
    const afterFirst = renderCalls;
    expect(afterFirst).toBeGreaterThan(0);

    // A second caller, same size: the memo answers, the GPU is not asked
    // again.
    r.captureGroundAlbedo(48);
    expect(renderCalls).toBe(afterFirst);

    // A different size is a different picture, not a resample of this one.
    r.captureGroundAlbedo(64);
    const afterResize = renderCalls;
    expect(afterResize).toBeGreaterThan(afterFirst);

    // And the memo is not allowed to outlive its own subject. `setDecor`
    // only MARKS the terrain dirty -- the rebuild happens on the next
    // `frame()` (or inside the next capture) -- so a capture that consulted
    // the memo before the dirty gate would answer with a photograph of
    // ground that has already been superseded. Asserted through the public
    // setter rather than by writing the private flag, because the setter is
    // how it actually happens.
    r.setDecor(new Uint8Array(8 * 8));
    r.captureGroundAlbedo(64);
    expect(renderCalls).toBeGreaterThan(afterResize);

    r.dispose();
  });

  it('answers with the SAME object twice, so a caller can poll it by identity', () => {
    // The seam's freshness signal is object identity (`api.ts`), and the
    // minimap leans on it: it asks on each of its 4 Hz redraws and re-blits
    // only when the answer is a different object. A capture that returned a
    // fresh `ImageData` every time would still be CORRECT and would make
    // that caller rebuild its blit canvas four times a second forever, with
    // nothing to show for it and no test pointing at the cause.
    const r = makeRenderer();
    const first = shot(r.captureGroundAlbedo(48));
    const second = shot(r.captureGroundAlbedo(48));
    expect(second).toBe(first);
    r.dispose();
  });

  it('a ground texture that lands after the photograph makes the NEXT ask a new picture', () => {
    // The race this closes. `init()` fires six `TextureLoader.load` calls
    // fire-and-forget and awaits none of them, while `main.ts` mounts the
    // minimap right after the deploy gate -- which on a sandbox or the
    // tutorial is immediately. A tile arriving after the capture writes the
    // material's uniforms and nothing else, so before this the photograph
    // kept that slot's flat palette tone for the whole mission: still lit,
    // still shaded, still elevation-correct, and not the ground the player
    // is looking at.
    const r = makeTexturedRenderer();
    const before = shot(r.captureGroundAlbedo(48));
    const afterFirst = renderCalls;
    // Identity-stable while nothing has changed -- the control, so the
    // assertion below is about the texture and not about the memo being
    // broken in general.
    expect(r.captureGroundAlbedo(48)).toBe(before);
    expect(renderCalls).toBe(afterFirst);

    // The tile arrives, late.
    expect(pendingTextures.length).toBe(1);
    for (const land of pendingTextures) land();

    const after = shot(r.captureGroundAlbedo(48));
    expect(after).not.toBe(before);
    expect(renderCalls).toBeGreaterThan(afterFirst);
    r.dispose();
  });
});
