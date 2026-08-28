/**
 * The pure half of Phase C's overlay tier -- palette-key policy and small
 * per-overlay numeric formulas, exercised directly here, the same split
 * `fx.test.ts` draws for particles/tracers.
 *
 * `OverlayBatch` needs no `WebGLRenderer` to *construct*, exactly like
 * `ParticleInstancer`/`TracerBatch` (`fx.test.ts`'s own established
 * precedent, "renderOrder invariant" suite) -- and, unlike those two, its
 * `push`/`beginFrame`/`endFrame` methods are themselves plain typed-array
 * writes and `BufferGeometry.setDrawRange` calls with no GPU dependency
 * either, so this file exercises the real class end to end, not merely its
 * construction. `NumeralBatch` is different: its texture is built lazily,
 * on first `push()` (`ensureTexture`'s own doc comment explains why), which
 * touches `document` -- unavailable under this suite's `environment:
 * 'node'` -- so only its CONSTRUCTOR-time properties are checked here; the
 * Phase C report has the browser verification that covers `push()` itself.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import paletteJson from '../../../../../data/palette.json';
import { OVERLAY_RENDER_ORDER, BADGE_NUMERAL_RENDER_ORDER } from './render-order';
import {
  unitOverlayRadiusPx,
  hpBarColorKey,
  orderMarkerSize,
  cachedHexToUnit,
  HP_BG_COLOR_KEY,
  SUPPRESSION_COLOR_KEY,
  OVERLAY_ACCENT_COLOR_KEY,
  BADGE_TEXT_COLOR_KEY,
  ORDER_MARKER_TTL,
  OverlayBatch,
  NumeralBatch,
} from './overlays';

describe('unitOverlayRadiusPx', () => {
  it('matches Pixi\'s own type.isSoft ? 7 : 11 (renderer.ts unit loop)', () => {
    expect(unitOverlayRadiusPx(true)).toBe(7);
    expect(unitOverlayRadiusPx(false)).toBe(11);
  });
});

describe('hpBarColorKey', () => {
  it('picks the green tier above 0.5', () => {
    expect(hpBarColorKey(1)).toBe('scrub.0');
    expect(hpBarColorKey(0.51)).toBe('scrub.0');
  });

  it('picks the yellow tier for the (0.25, 0.5] band', () => {
    expect(hpBarColorKey(0.5)).toBe('team.neutral');
    expect(hpBarColorKey(0.26)).toBe('team.neutral');
  });

  it('picks the red tier at or below 0.25', () => {
    expect(hpBarColorKey(0.25)).toBe('team.hostile');
    expect(hpBarColorKey(0)).toBe('team.hostile');
  });
});

describe('orderMarkerSize', () => {
  it('starts at 10px arms when freshly placed (a = 1)', () => {
    expect(orderMarkerSize(1)).toBe(10);
  });

  it('grows to 16px arms just before it disappears (a = 0)', () => {
    expect(orderMarkerSize(0)).toBe(16);
  });

  it('is exactly halfway (13) at a = 0.5', () => {
    expect(orderMarkerSize(0.5)).toBe(13);
  });
});

describe('ORDER_MARKER_TTL', () => {
  it('matches Pixi\'s own addOrderMarker ttl of 80', () => {
    expect(ORDER_MARKER_TTL).toBe(80);
  });
});

describe('cachedHexToUnit', () => {
  it('converts #RRGGBB to an RGB triple in 0..1', () => {
    expect(cachedHexToUnit('#FF0000')).toEqual([1, 0, 0]);
    expect(cachedHexToUnit('#00FF00')).toEqual([0, 1, 0]);
  });

  it('returns the identical cached array reference on a repeat call for the same hex', () => {
    const a = cachedHexToUnit('#B8FF5A');
    const b = cachedHexToUnit('#B8FF5A');
    expect(a).toBe(b);
  });
});

describe('overlay palette keys resolve to the exact hex Pixi hard-codes at the equivalent call site', () => {
  // These pin the KEY, not a literal hex here (this module's own "colour is
  // looked up, never computed" rule) -- but the whole point of picking these
  // specific keys is that data/palette.json resolves them to Pixi's own
  // literals, so this test checks that against the live palette data
  // instead of asserting a fact about strings with no connection to it.
  // Same direct-JSON-import precedent as mesh-role.test.ts's own `paletteJson`.
  const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
  const reserved = paletteJson.reserved as Record<string, { colors: Record<string, string> }>;

  function resolve(key: string): string {
    const [band, name] = key.split('.');
    if (band in ramps) return ramps[band].colors[Number(name)];
    return reserved[band].colors[name];
  }

  it('HP_BG_COLOR_KEY / BADGE_TEXT_COLOR_KEY -> #14150F, Pixi\'s HP-bar background and badge text fill', () => {
    expect(resolve(HP_BG_COLOR_KEY)).toBe('#14150F');
    expect(resolve(BADGE_TEXT_COLOR_KEY)).toBe('#14150F');
  });

  it('SUPPRESSION_COLOR_KEY -> #FFB43C, Pixi\'s suppression bar fill', () => {
    expect(resolve(SUPPRESSION_COLOR_KEY)).toBe('#FFB43C');
  });

  it('OVERLAY_ACCENT_COLOR_KEY -> #B8FF5A, Pixi\'s selection-ring/order-marker/hover default', () => {
    expect(resolve(OVERLAY_ACCENT_COLOR_KEY)).toBe('#B8FF5A');
  });

  it('hpBarColorKey\'s three tiers resolve to Pixi\'s own three literals', () => {
    expect(resolve(hpBarColorKey(1))).toBe('#6B8A4A');
    expect(resolve(hpBarColorKey(0.4))).toBe('#E8C33A');
    expect(resolve(hpBarColorKey(0.1))).toBe('#D93A2B');
  });
});

describe('OverlayBatch construction', () => {
  it('draws at OVERLAY_RENDER_ORDER, not three.js\'s own default (0)', () => {
    const batch = new OverlayBatch(64);
    expect(batch.mesh.renderOrder).toBe(OVERLAY_RENDER_ORDER);
  });

  it('never frustum-culls -- overlays track entities across the whole map, like every other per-entity batch in this backend', () => {
    const batch = new OverlayBatch(64);
    expect(batch.mesh.frustumCulled).toBe(false);
  });

  it('is depthTest: false -- a faithful port of Pixi\'s un-occluded unitsG, not a shortcut (this module\'s own top comment)', () => {
    const batch = new OverlayBatch(64);
    expect((batch.mesh.material as THREE.Material).depthTest).toBe(false);
  });

  it('starts with an empty draw range -- nothing pushed yet, nothing drawn', () => {
    const batch = new OverlayBatch(64);
    expect(batch.mesh.geometry.drawRange.count).toBe(0);
  });
});

describe('OverlayBatch.rect / endFrame', () => {
  it('one rect uploads exactly 6 vertices and trims the draw range to them', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.rect([0, 0, 0], -12, -10, 12, -7, '#FF0000', 0.8);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(6);
  });

  it('beginFrame resets the draw range -- last frame\'s overlays do not bleed into a frame with nothing to draw', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.rect([0, 0, 0], -12, -10, 12, -7, '#FF0000', 0.8);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(6);

    batch.beginFrame();
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(0);
  });

  it('writes the resolved colour and alpha into every vertex it pushes', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.rect([1, 2, 3], 0, 0, 10, 10, '#00FF00', 0.5);
    batch.endFrame();
    const colors = (batch.mesh.geometry.getAttribute('aColor') as THREE.BufferAttribute).array as Float32Array;
    const alphas = (batch.mesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).array as Float32Array;
    for (let v = 0; v < 6; v++) {
      expect(colors[v * 3]).toBeCloseTo(0, 5);
      expect(colors[v * 3 + 1]).toBeCloseTo(1, 5);
      expect(colors[v * 3 + 2]).toBeCloseTo(0, 5);
      expect(alphas[v]).toBeCloseTo(0.5, 5);
    }
  });
});

describe('NumeralBatch construction', () => {
  it('draws at BADGE_NUMERAL_RENDER_ORDER, a DIFFERENT band from OverlayBatch\'s -- the "ring and numeral do not share a band" trap (render-order.ts)', () => {
    const batch = new NumeralBatch(16, '#14150F');
    expect(batch.mesh.renderOrder).toBe(BADGE_NUMERAL_RENDER_ORDER);
    expect(batch.mesh.renderOrder).not.toBe(OVERLAY_RENDER_ORDER);
  });

  it('starts with no texture bound (map: null) -- built lazily on first push(), not in the constructor', () => {
    const batch = new NumeralBatch(16, '#14150F');
    expect((batch.mesh.material as THREE.MeshBasicMaterial).map).toBeNull();
  });

  it('never frustum-culls, matching OverlayBatch', () => {
    const batch = new NumeralBatch(16, '#14150F');
    expect(batch.mesh.frustumCulled).toBe(false);
  });
});
