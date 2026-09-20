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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';

/** Set by the fake renderer at the moment it is asked to draw, so a test can
 *  ask what the scene looked like DURING the capture rather than after it. */
let onRender: (() => void) | null = null;
/** Every `render()` the fake was asked for. One capture is two: the scene
 *  pass, then `OutputPass`'s full-screen quad. */
let renderCalls = 0;
let throwOnRender = false;

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
    }
    getRenderTarget(): unknown {
      return this.target;
    }
    clear(): void {}
    render(): void {
      renderCalls++;
      onRender?.();
      if (throwOnRender) throw new Error('context lost');
    }
    /** A recognisable, non-zero read-back, so a test can tell "the bytes came
     *  from here" from "the buffer was never written". */
    readRenderTargetPixels(
      _t: unknown,
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      buffer: Uint8Array
    ): void {
      buffer.fill(200);
    }
    setPixelRatio(): void {}
    dispose(): void {}
  }
  class FakeTextureLoader {
    load(_url: string, onLoad: (t: THREE.Texture) => void): THREE.Texture {
      const tex = new actual.Texture();
      onLoad(tex);
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
});

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
    // The fake's own fill, so this is the read-back arriving rather than an
    // empty buffer that happens to be the right length.
    expect(shot?.data[0]).toBe(200);
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
});
