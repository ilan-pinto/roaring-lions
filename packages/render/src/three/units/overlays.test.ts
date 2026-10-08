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
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import paletteJson from '../../../../../data/palette.json';
import { OVERLAY_RENDER_ORDER, BADGE_NUMERAL_RENDER_ORDER } from './render-order';
import { desaturateHex, ellipseDashAngles, RANGE_FILL_DESATURATE } from './overlay-geometry';
import {
  unitOverlayRadiusPx,
  hpBarColorKey,
  hpBarVisible,
  suppressionBarVisible,
  orderMarkerSize,
  queuedRouteLegs,
  ROUTE_LINE_WIDTH_PX,
  ROUTE_LINE_ALPHA,
  ROUTE_NODE_RADIUS_PX,
  ROUTE_NODE_ALPHA,
  cachedHexToLinear,
  cachedDesaturate,
  HP_BG_COLOR_KEY,
  SUPPRESSION_COLOR_KEY,
  OVERLAY_ACCENT_COLOR_KEY,
  BADGE_TEXT_COLOR_KEY,
  ORDER_MARKER_TTL,
  objectiveZoneColorKey,
  objectiveZoneFallbackColor,
  objectiveZonePulse,
  objectiveZoneDashed,
  OBJECTIVE_ZONE_DASH_TILES,
  OBJECTIVE_ZONE_STROKE_INSET_TILES,
  AIR_SHADOW_COLOR_KEY,
  MOBILITY_KILL_COLOR_KEY,
  buildingIntegrityColorKey,
  CHARGE_RING_TRACK_COLOR_KEY,
  CHARGE_RING_FILL_COLOR_KEY,
  CHARGE_RING_FILL_FALLBACK_COLOR,
  ISO_K,
  tileRadiusToEllipsePx,
  OverlayBatch,
  NumeralBatch,
  ChevronBatch,
  STRIPE_COLOR_KEY,
  REFUGE_RING_COLOR_KEY,
  REFUGE_RING_FALLBACK_COLOR,
  REFUGE_RING_EDGE_COLOR_KEY,
  REFUGE_RING_EDGE_FALLBACK_COLOR,
  REFUGE_RING_STYLE,
  REFUGE_RING_EDGE_STYLE,
  REFUGE_RING_EDGE_EXTRA_PX,
  WORLD_HALO_COLOR_KEY,
  WORLD_HALO_FALLBACK,
  OBJECTIVE_ZONE_HALO_COLOR_KEY,
  OBJECTIVE_ZONE_HALO_FALLBACK,
} from './overlays';

describe('unitOverlayRadiusPx', () => {
  it('matches Pixi\'s own type.isSoft ? 7 : 11 (renderer.ts unit loop)', () => {
    expect(unitOverlayRadiusPx(true)).toBe(7);
    expect(unitOverlayRadiusPx(false)).toBe(11);
  });
});

describe('hpBarColorKey', () => {
  it('picks the green tier above 0.5, either side', () => {
    for (const friendly of [false, true]) {
      expect(hpBarColorKey(1, friendly)).toBe('scrub.0');
      expect(hpBarColorKey(0.51, friendly)).toBe('scrub.0');
    }
  });

  it('picks the yellow tier for the (0.25, 0.5] band, either side', () => {
    for (const friendly of [false, true]) {
      expect(hpBarColorKey(0.5, friendly)).toBe('team.neutral');
      expect(hpBarColorKey(0.26, friendly)).toBe('team.neutral');
    }
  });

  it('a hostile keeps the red tier at or below 0.25', () => {
    expect(hpBarColorKey(0.25, false)).toBe('team.hostile');
    expect(hpBarColorKey(0, false)).toBe('team.hostile');
  });

  it('VR-03: a friendly never resolves to the hostile key, at any ratio', () => {
    for (let k = 0; k <= 100; k++) expect(hpBarColorKey(k / 100, true)).not.toBe('team.hostile');
    // The warn key, as a literal: the HUD's `--warn` is `team.neutral`.
    expect(hpBarColorKey(0.25, true)).toBe('team.neutral');
    expect(hpBarColorKey(0, true)).toBe('team.neutral');
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

describe('queuedRouteLegs', () => {
  it('puts the current goal BETWEEN the unit and its queue -- the queue holds what comes after the goal', () => {
    const legs = queuedRouteLegs([1, 2], [5, 6], [[9, 10], [13, 14]]);
    expect(legs).toEqual([[1, 2], [5, 6], [9, 10], [13, 14]]);
  });

  it('is unit -> goal alone when nothing is queued: a plain order still draws its one leg', () => {
    expect(queuedRouteLegs([1, 2], [5, 6], [])).toEqual([[1, 2], [5, 6]]);
  });
});

describe('route literals match Pixi\'s own queued-route block (renderer.ts)', () => {
  it('stroke width 1.5 / alpha 0.35 per leg, node radius 3 / alpha 0.55', () => {
    expect(ROUTE_LINE_WIDTH_PX).toBe(1.5);
    expect(ROUTE_LINE_ALPHA).toBe(0.35);
    expect(ROUTE_NODE_RADIUS_PX).toBe(3);
    expect(ROUTE_NODE_ALPHA).toBe(0.55);
  });
});

describe('ORDER_MARKER_TTL', () => {
  it('matches Pixi\'s own addOrderMarker ttl of 80', () => {
    expect(ORDER_MARKER_TTL).toBe(80);
  });
});

describe('cachedHexToLinear', () => {
  it('converts #RRGGBB to a LINEAR RGB triple in 0..1 -- 0x00 and 0xFF are fixed points of the sRGB transfer function, so the pure-red/pure-green corners land the same as hexToUnit would', () => {
    expect(cachedHexToLinear('#FF0000')).toEqual([1, 0, 0]);
    expect(cachedHexToLinear('#00FF00')).toEqual([0, 1, 0]);
  });

  it('returns the identical cached array reference on a repeat call for the same hex', () => {
    const a = cachedHexToLinear('#B8FF5A');
    const b = cachedHexToLinear('#B8FF5A');
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

  it('hpBarColorKey\'s three hostile tiers resolve to Pixi\'s own three literals', () => {
    expect(resolve(hpBarColorKey(1, false))).toBe('#6B8A4A');
    expect(resolve(hpBarColorKey(0.4, false))).toBe('#E8C33A');
    expect(resolve(hpBarColorKey(0.1, false))).toBe('#D93A2B');
  });

  it('VR-03: a friendly at a tenth of its health resolves to the warn yellow, not the hostile red', () => {
    expect(resolve(hpBarColorKey(0.1, true))).toBe('#E8C33A');
  });

  // VR-36 (lead ruling 2026-10-08): not held and contested are dashed, held
  // and target solid -- the dash is the channel colour cannot carry under
  // deuteranopia/protanopia, so the split must not drift.
  it('dashes the not-held and contested zone outlines, and only those', () => {
    expect(objectiveZoneDashed('held')).toBe(false);
    expect(objectiveZoneDashed('unheld')).toBe(true);
    expect(objectiveZoneDashed('contested')).toBe(true);
    expect(objectiveZoneDashed('target')).toBe(false);
    const [on, off] = OBJECTIVE_ZONE_DASH_TILES;
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
  });

  it('objectiveZoneColorKey\'s three states resolve to Pixi\'s own three literals', () => {
    expect(resolve(objectiveZoneColorKey('contested'))).toBe('#D93A2B');
    expect(resolve(objectiveZoneColorKey('unheld'))).toBe('#E8C33A');
    expect(resolve(objectiveZoneColorKey('held'))).toBe('#B8FF5A');
  });

  it('AIR_SHADOW_COLOR_KEY -> #0A0A08, Pixi\'s air-lift shadow ellipse fill (same swatch fog-mesh.ts names shadow.2)', () => {
    expect(resolve(AIR_SHADOW_COLOR_KEY)).toBe('#0A0A08');
  });

  it('MOBILITY_KILL_COLOR_KEY -> #8E9491, Pixi\'s own mobility-kill pip literal, exactly', () => {
    expect(resolve(MOBILITY_KILL_COLOR_KEY)).toBe('#8E9491');
  });

  it('buildingIntegrityColorKey\'s three tiers resolve to Pixi\'s own three literals (0.6/0.3 thresholds, NOT hpBarColorKey\'s 0.5/0.25)', () => {
    expect(resolve(buildingIntegrityColorKey(1, false))).toBe('#8E9491');
    expect(resolve(buildingIntegrityColorKey(0.4, false))).toBe('#E8C33A');
    expect(resolve(buildingIntegrityColorKey(0.1, false))).toBe('#D93A2B');
  });

  it('VR-03: a building the player holds never fills the hostile red, at any ratio', () => {
    for (let k = 0; k <= 100; k++) expect(buildingIntegrityColorKey(k / 100, true)).not.toBe('team.hostile');
    expect(resolve(buildingIntegrityColorKey(0.1, true))).toBe('#E8C33A');
    expect(resolve(buildingIntegrityColorKey(1, true))).toBe('#8E9491');
  });

  it('CHARGE_RING_TRACK_COLOR_KEY -> #5C625F, CHARGE_RING_FILL_COLOR_KEY -> #E8541E, Pixi\'s own charge-ring resolveColor fallbacks', () => {
    expect(resolve(CHARGE_RING_TRACK_COLOR_KEY)).toBe('#5C625F');
    expect(resolve(CHARGE_RING_FILL_COLOR_KEY)).toBe('#E8541E');
    expect(resolve(CHARGE_RING_FILL_COLOR_KEY)).toBe(CHARGE_RING_FILL_FALLBACK_COLOR);
  });

  it('STRIPE_COLOR_KEY -> #E0B87A, the same swatch theme.css\'s --commend (--rl-dust-0) maps to', () => {
    expect(resolve(STRIPE_COLOR_KEY)).toBe('#E0B87A');
  });
});

describe('tileRadiusToEllipsePx / ISO_K', () => {
  it('ISO_K is Math.SQRT1_2, Pixi\'s own weapon-envelope and tutorial-ring constant', () => {
    expect(ISO_K).toBe(Math.SQRT1_2);
  });

  it('matches Pixi\'s ring() closure verbatim: tiles * TILE_W * ISO_K, tiles * TILE_H * ISO_K', () => {
    const { rightR, upR } = tileRadiusToEllipsePx(4, 64, 32);
    expect(rightR).toBeCloseTo(4 * 64 * Math.SQRT1_2, 10);
    expect(upR).toBeCloseTo(4 * 32 * Math.SQRT1_2, 10);
  });

  it('a zero-tile radius collapses to a point, not NaN', () => {
    expect(tileRadiusToEllipsePx(0, 64, 32)).toEqual({ rightR: 0, upR: 0 });
  });
});

describe('objectiveZoneColorKey / objectiveZoneFallbackColor', () => {
  it('held resolves to the same key OVERLAY_ACCENT_COLOR_KEY does', () => {
    expect(objectiveZoneColorKey('held')).toBe(OVERLAY_ACCENT_COLOR_KEY);
  });

  it('every fallback literal matches its own key\'s resolved colour, pairwise', () => {
    for (const state of ['held', 'unheld', 'contested'] as const) {
      expect(objectiveZoneFallbackColor(state)).toBe(
        state === 'contested' ? '#D93A2B' : state === 'unheld' ? '#E8C33A' : '#B8FF5A'
      );
    }
  });
});

describe('objectiveZonePulse', () => {
  it('held is a fixed 0.3, regardless of frameN', () => {
    expect(objectiveZonePulse('held', 0)).toBe(0.3);
    expect(objectiveZonePulse('held', 999)).toBe(0.3);
  });

  it('unheld/contested pulse with frameN, matching Pixi\'s own 0.35 + 0.25 * sin(frameN * 0.09)', () => {
    for (const state of ['unheld', 'contested'] as const) {
      expect(objectiveZonePulse(state, 0)).toBeCloseTo(0.35, 10);
      expect(objectiveZonePulse(state, 10)).toBeCloseTo(0.35 + 0.25 * Math.sin(10 * 0.09), 10);
    }
  });
});

describe('OBJECTIVE_ZONE_STROKE_INSET_TILES', () => {
  it('is a small positive fraction of a tile, not a screen-pixel or zero value', () => {
    expect(OBJECTIVE_ZONE_STROKE_INSET_TILES).toBeGreaterThan(0);
    expect(OBJECTIVE_ZONE_STROKE_INSET_TILES).toBeLessThan(0.5);
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

describe('OverlayBatch.line', () => {
  it('one stroked segment uploads exactly 6 vertices and trims the draw range to them', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.line([0, 0, 0], -7, -5, 7, 5, 3, '#5C625F', 1);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(6);
  });

  it('two crossing segments (the permanent-wreck cross marker) upload 12 vertices total', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.line([0, 0, 0], -7, -5, 7, 5, 3, '#5C625F', 1);
    batch.line([0, 0, 0], -7, 5, 7, -5, 3, '#5C625F', 1);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(12);
  });

  it('writes the resolved colour and alpha into every vertex it pushes', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.line([1, 2, 3], -7, -5, 7, 5, 3, '#00FF00', 0.5);
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

describe('OverlayBatch.dashedEllipseRing (GH-279)', () => {
  it('pushes one quad per dash for a ring whose dashes are short', () => {
    const batch = new OverlayBatch(4096);
    batch.beginFrame();
    batch.dashedEllipseRing([0, 0, 0], 113, 56.5, REFUGE_RING_STYLE, '#6B8A4A', 1);
    batch.endFrame();
    const n = batch.mesh.geometry.drawRange.count;
    expect(n % 6).toBe(0);
    // ~540 px of perimeter at a 12 px period.
    expect(n / 6).toBeGreaterThanOrEqual(40);
    expect(n / 6).toBeLessThanOrEqual(50);
  });

  it('draws the same ring the same way every frame (the layout memo is transparent)', () => {
    const batch = new OverlayBatch(4096);
    const frame = (): Float32Array => {
      batch.beginFrame();
      batch.dashedEllipseRing([1, 2, 3], 113, 56.5, REFUGE_RING_STYLE, '#6B8A4A', 1);
      batch.endFrame();
      const pos = batch.mesh.geometry.getAttribute('position').array as Float32Array;
      return pos.slice(0, batch.mesh.geometry.drawRange.count * 3);
    };
    expect(frame()).toEqual(frame());
  });

  it('the under-stroke is the ring\'s own dashes, wider on every side and at both ends', () => {
    expect(ellipseDashAngles(113, 56.5, REFUGE_RING_EDGE_STYLE)).toHaveLength(
      ellipseDashAngles(113, 56.5, REFUGE_RING_STYLE).length
    );
    expect(REFUGE_RING_EDGE_STYLE.dashPx).toBe(REFUGE_RING_STYLE.dashPx);
    expect(REFUGE_RING_EDGE_STYLE.gapPx).toBe(REFUGE_RING_STYLE.gapPx);
    expect(REFUGE_RING_EDGE_STYLE.widthPx - REFUGE_RING_STYLE.widthPx).toBe(REFUGE_RING_EDGE_EXTRA_PX);
    expect(REFUGE_RING_EDGE_STYLE.extendPx).toBe(REFUGE_RING_EDGE_EXTRA_PX / 2);
  });

  it('the refuge ring wears the minimap cross\'s --good (scrub.0) over the one world halo (VR-35)', () => {
    const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
    const resolve = (key: string): string => {
      const [band, i] = key.split('.');
      return ramps[band].colors[Number(i)];
    };
    expect(REFUGE_RING_COLOR_KEY).toBe('scrub.0');
    expect(REFUGE_RING_EDGE_COLOR_KEY).toBe(WORLD_HALO_COLOR_KEY);
    expect(resolve(REFUGE_RING_COLOR_KEY)).toBe(REFUGE_RING_FALLBACK_COLOR);
    expect(resolve(REFUGE_RING_EDGE_COLOR_KEY)).toBe(REFUGE_RING_EDGE_FALLBACK_COLOR);
  });
});

describe('OverlayBatch.lineWorld', () => {
  it('one segment between two independent world points uploads exactly 6 vertices', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.lineWorld([0, 0, 0], [5, 0, 3], 1, '#B8FF5A', 0.35);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(6);
  });

  it('writes the resolved colour and alpha into every vertex it pushes', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.lineWorld([0, 0, 0], [5, 0, 3], 1, '#00FF00', 0.35);
    batch.endFrame();
    const colors = (batch.mesh.geometry.getAttribute('aColor') as THREE.BufferAttribute).array as Float32Array;
    const alphas = (batch.mesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).array as Float32Array;
    for (let v = 0; v < 6; v++) {
      expect(colors[v * 3]).toBeCloseTo(0, 5);
      expect(colors[v * 3 + 1]).toBeCloseTo(1, 5);
      expect(colors[v * 3 + 2]).toBeCloseTo(0, 5);
      expect(alphas[v]).toBeCloseTo(0.35, 5);
    }
  });
});

describe('OverlayBatch.polygonStrokeWorld', () => {
  const square: readonly [number, number, number][] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 4],
    [0, 0, 4],
  ];

  it('polygonStrokeWorld writes 2 triangles (6 vertices) per edge of a closed loop', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.polygonStrokeWorld(square, 0.1, '#FF0000', 0.5);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(square.length * 6);
  });
});

describe('NumeralBatch construction', () => {
  it('draws at BADGE_NUMERAL_RENDER_ORDER, ABOVE OverlayBatch\'s band -- the badge disc is in that tier, and the numeral must not draw under it (PA-18)', () => {
    const batch = new NumeralBatch(16, '#14150F');
    expect(batch.mesh.renderOrder).toBe(BADGE_NUMERAL_RENDER_ORDER);
    expect(batch.mesh.renderOrder).toBeGreaterThan(OVERLAY_RENDER_ORDER);
  });

  it('starts with no texture bound (map: null) -- built lazily on first push(), not in the constructor', () => {
    const batch = new NumeralBatch(16, '#14150F');
    expect((batch.mesh.material as THREE.MeshBasicMaterial).map).toBeNull();
  });

  it('never frustum-culls, matching OverlayBatch', () => {
    const batch = new NumeralBatch(16, '#14150F');
    expect(batch.mesh.frustumCulled).toBe(false);
  });

  // WP-P4 (PA-18): the atlas is painted in an sRGB colour (`shadow.1`), and
  // left at NoColorSpace the near-black ink was encoded on the way out and
  // drew mid-grey on the pale disc. A stand-in canvas is enough: the
  // property under test is set on the texture, not read from pixels.
  it('decodes its digit atlas as sRGB, like every other colour map', () => {
    const ctx = { clearRect: () => {}, fillText: () => {}, fillStyle: '', font: '', textAlign: '', textBaseline: '' };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    try {
      const batch = new NumeralBatch(16, '#14150F');
      batch.beginFrame();
      batch.push([0, 0, 0], 0, 0, 12, 14, 3);
      const map = (batch.mesh.material as THREE.MeshBasicMaterial).map;
      expect(map).not.toBeNull();
      expect(map?.colorSpace).toBe(THREE.SRGBColorSpace);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ChevronBatch construction', () => {
  // Same "constructor-time properties only" scope as NumeralBatch's own
  // suite above, for the identical reason: push() calls ensureTexture(),
  // which touches document -- unavailable under this suite's environment:
  // 'node'. The browser verification (task brief step 4) covers push()
  // itself.
  it('draws at BADGE_NUMERAL_RENDER_ORDER, the same textured band the numeral uses -- both are textured quads that must sit above the vertex-coloured overlay tier', () => {
    const batch = new ChevronBatch(16, '#E8C33A');
    expect(batch.mesh.renderOrder).toBe(BADGE_NUMERAL_RENDER_ORDER);
    expect(batch.mesh.renderOrder).not.toBe(OVERLAY_RENDER_ORDER);
  });

  it('starts with no texture bound (map: null) -- built lazily on first push(), not in the constructor', () => {
    const batch = new ChevronBatch(16, '#E8C33A');
    expect((batch.mesh.material as THREE.MeshBasicMaterial).map).toBeNull();
  });

  it('never frustum-culls, matching NumeralBatch/OverlayBatch', () => {
    const batch = new ChevronBatch(16, '#E8C33A');
    expect(batch.mesh.frustumCulled).toBe(false);
  });

  it('starts with an empty draw range -- nothing pushed yet, nothing drawn', () => {
    const batch = new ChevronBatch(16, '#E8C33A');
    expect(batch.mesh.geometry.drawRange.count).toBe(0);
  });
});

describe('cachedDesaturate', () => {
  it('agrees with the pure function it memoises, on every shipped team colour', () => {
    const team = (paletteJson as { reserved: { team: { colors: Record<string, string>; variants: Record<string, Record<string, string>> } } }).reserved.team;
    const hexes = [team.colors, ...Object.values(team.variants)].flatMap((b) =>
      ['kedem', 'hostile', 'neutral'].map((k) => b[k])
    );
    for (const hex of hexes) {
      for (const amount of [0, 0.5, RANGE_FILL_DESATURATE, 1]) {
        expect(cachedDesaturate(hex, amount)).toBe(desaturateHex(hex, amount));
      }
    }
  });

  // The cache exists to stop `ThreeRenderer`'s ring block building a string
  // per drawn envelope per frame, so a second call must not pay for a second
  // one -- and, since the key carries the amount, two amounts of the same hex
  // must not collide into one entry.
  it('returns the identical string on a repeat call, and does not collide across amounts', () => {
    const first = cachedDesaturate('#2F6FD9', RANGE_FILL_DESATURATE);
    expect(cachedDesaturate('#2F6FD9', RANGE_FILL_DESATURATE)).toBe(first);
    expect(cachedDesaturate('#2F6FD9', 0)).not.toBe(first);
    expect(cachedDesaturate('#2F6FD9', 0)).toBe('#2f6fd9');
  });
});

describe('suppressionBarVisible (pass C2/C4, P4)', () => {
  it('draws for a selected or hovered unit and for nobody else', () => {
    expect(suppressionBarVisible(false, false, false)).toBe(false);
    expect(suppressionBarVisible(true, false, false)).toBe(true);
    expect(suppressionBarVisible(false, true, false)).toBe(true);
    expect(suppressionBarVisible(false, false, true)).toBe(true);
  });
});

describe('hpBarVisible (GH-186)', () => {
  const MAX = 300 << 16;
  it('full health with no flags draws no bar', () => {
    expect(hpBarVisible(MAX, MAX, false, false, false)).toBe(false);
  });
  it('one raw unit of damage draws a bar', () => {
    expect(hpBarVisible(MAX - 1, MAX, false, false, false)).toBe(true);
  });
  it('selected, hostile hover and friendly hover each draw a bar alone', () => {
    expect(hpBarVisible(MAX, MAX, true, false, false)).toBe(true);
    expect(hpBarVisible(MAX, MAX, false, true, false)).toBe(true);
    expect(hpBarVisible(MAX, MAX, false, false, true)).toBe(true);
  });
});

/**
 * VR-38: a palette-key constant nothing but a test reads is a dead mark that
 * still looks like a decision (`WRECK_MARKER_COLOR_KEY` outlived the sprite
 * wreck cross it named). Every `*_COLOR_KEY` this module exports must be read
 * by production code, comments stripped, so a mention in prose cannot keep one
 * alive.
 */
describe('overlay colour keys are all live', () => {
  const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = `${dir}/${name}`;
      if (name === 'node_modules') return [];
      if (statSync(full).isDirectory()) return walk(full);
      return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
    });
  const packages = fileURLToPath(new URL('../../../../', import.meta.url));
  const production = [...walk(`${packages}render/src`), ...walk(`${packages}app/src`)].map((f) => ({
    file: f,
    code: stripComments(readFileSync(f, 'utf8')),
  }));
  const own = production.find((f) => f.file.endsWith('three/units/overlays.ts'));

  it('reads this module as production source (the guard cannot pass on an empty scan)', () => {
    expect(own).toBeDefined();
    expect(production.length).toBeGreaterThan(50);
  });

  it('has no *_COLOR_KEY export that only a test reads', () => {
    const declared = [...(own?.code ?? '').matchAll(/^export const ([A-Z0-9_]*COLOR_KEY)\b/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(10);
    const dead = declared.filter((name) => {
      const re = new RegExp(`\\b${name}\\b`, 'g');
      const uses = production.reduce((n, f) => n + (f.code.match(re)?.length ?? 0) - (f === own ? 1 : 0), 0);
      return uses === 0;
    });
    expect(dead).toEqual([]);
  });
});

/**
 * VR-35: one legibility halo in the world. Three adjacent shadow steps did one
 * job (rings and marks on shadow.1, the objective zone on shadow.2, the refuge
 * ring on shadow.0). Falsified: putting `OBJECTIVE_ZONE_HALO_COLOR_KEY` back to
 * 'shadow.2' turns the first spec red; putting a literal
 * `overlayColor('shadow.1', ...)` back on the contact-mark halo turns the
 * second.
 */
describe('one world halo (VR-35)', () => {
  it('every halo and frame key is WORLD_HALO_COLOR_KEY, and its fallback is the palette entry', () => {
    expect(OBJECTIVE_ZONE_HALO_COLOR_KEY).toBe(WORLD_HALO_COLOR_KEY);
    expect(REFUGE_RING_EDGE_COLOR_KEY).toBe(WORLD_HALO_COLOR_KEY);
    expect(HP_BG_COLOR_KEY).toBe(WORLD_HALO_COLOR_KEY);
    expect(OBJECTIVE_ZONE_HALO_FALLBACK).toBe(WORLD_HALO_FALLBACK);
    expect(REFUGE_RING_EDGE_FALLBACK_COLOR).toBe(WORLD_HALO_FALLBACK);
    const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
    const [band, i] = WORLD_HALO_COLOR_KEY.split('.');
    expect(ramps[band].colors[Number(i)]).toBe(WORLD_HALO_FALLBACK);
  });

  it('ThreeRenderer resolves no halo shade of its own', () => {
    const tr = readFileSync(fileURLToPath(new URL('../ThreeRenderer.ts', import.meta.url)), 'utf8');
    const haloLines = tr.split('\n').filter((l) => /halo|resolveShadow/i.test(l) && /overlayColor\(/.test(l));
    // The scan must see the halo reads it is guarding, or it guards nothing.
    expect(haloLines.length).toBeGreaterThanOrEqual(5);
    expect(haloLines.filter((l) => !/WORLD_HALO_COLOR_KEY|OBJECTIVE_ZONE_HALO_COLOR_KEY|REFUGE_RING_EDGE_COLOR_KEY/.test(l))).toEqual([]);
  });
});

/**
 * VR-34: a selected unit's ring is its TEAM colour wherever it stands. The flat
 * billboard fallback (a garrisoned unit, or a ring the batch refused) used to
 * take the control group's colour, or tracer lime. Falsified: restoring
 * `groupColor || accentDefault` on that ellipse turns this red.
 */
describe('the selected ring has one colour (VR-34)', () => {
  it('the flat fallback ring draws in the same ringHex the ground ring is pushed with', () => {
    const tr = readFileSync(fileURLToPath(new URL('../ThreeRenderer.ts', import.meta.url)), 'utf8');
    const at = tr.indexOf('this.pushSelectionRing(i, type, ix, iy, side, this.selectionRing, SELECTED_RING_SCALE, ringHex)');
    expect(at).toBeGreaterThan(0);
    const block = tr.slice(at, tr.indexOf('}', at));
    const fallback = /ellipseRing\(ringCenter,[^;]*\);/.exec(block)?.[0] ?? '';
    expect(fallback).toMatch(/,\s*ringHex,\s*1\);$/);
  });
});
