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
  queuedRouteLegs,
  ROUTE_LINE_WIDTH_PX,
  ROUTE_LINE_ALPHA,
  ROUTE_NODE_RADIUS_PX,
  ROUTE_NODE_ALPHA,
  cachedHexToUnit,
  HP_BG_COLOR_KEY,
  SUPPRESSION_COLOR_KEY,
  OVERLAY_ACCENT_COLOR_KEY,
  BADGE_TEXT_COLOR_KEY,
  ORDER_MARKER_TTL,
  objectiveZoneColorKey,
  objectiveZoneFallbackColor,
  objectiveZonePulse,
  OBJECTIVE_ZONE_STROKE_INSET_TILES,
  AIR_SHADOW_COLOR_KEY,
  WRECK_MARKER_COLOR_KEY,
  MOBILITY_KILL_COLOR_KEY,
  FIREPOWER_KILL_COLOR_KEY,
  FIREPOWER_KILL_FALLBACK_COLOR,
  buildingIntegrityColorKey,
  CHARGE_RING_TRACK_COLOR_KEY,
  CHARGE_RING_FILL_COLOR_KEY,
  CHARGE_RING_FILL_FALLBACK_COLOR,
  ISO_K,
  tileRadiusToEllipsePx,
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

  it('objectiveZoneColorKey\'s three states resolve to Pixi\'s own three literals', () => {
    expect(resolve(objectiveZoneColorKey('contested'))).toBe('#D93A2B');
    expect(resolve(objectiveZoneColorKey('unheld'))).toBe('#E8C33A');
    expect(resolve(objectiveZoneColorKey('held'))).toBe('#B8FF5A');
  });

  it('AIR_SHADOW_COLOR_KEY -> #0A0A08, Pixi\'s air-lift shadow ellipse fill (same swatch fog-mesh.ts names shadow.2)', () => {
    expect(resolve(AIR_SHADOW_COLOR_KEY)).toBe('#0A0A08');
  });

  it('WRECK_MARKER_COLOR_KEY -> #5C625F, Pixi\'s permanent-wreck cross-marker stroke (same swatch renderer.ts:2402 names gunmetal.2)', () => {
    expect(resolve(WRECK_MARKER_COLOR_KEY)).toBe('#5C625F');
  });

  it('MOBILITY_KILL_COLOR_KEY -> #8E9491, Pixi\'s own mobility-kill pip literal, exactly', () => {
    expect(resolve(MOBILITY_KILL_COLOR_KEY)).toBe('#8E9491');
  });

  it('buildingIntegrityColorKey\'s three tiers resolve to Pixi\'s own three literals (0.6/0.3 thresholds, NOT hpBarColorKey\'s 0.5/0.25)', () => {
    expect(resolve(buildingIntegrityColorKey(1))).toBe('#8E9491');
    expect(resolve(buildingIntegrityColorKey(0.4))).toBe('#E8C33A');
    expect(resolve(buildingIntegrityColorKey(0.1))).toBe('#D93A2B');
  });

  it('CHARGE_RING_TRACK_COLOR_KEY -> #5C625F, CHARGE_RING_FILL_COLOR_KEY -> #E8541E, Pixi\'s own charge-ring resolveColor fallbacks', () => {
    expect(resolve(CHARGE_RING_TRACK_COLOR_KEY)).toBe('#5C625F');
    expect(resolve(CHARGE_RING_FILL_COLOR_KEY)).toBe('#E8541E');
    expect(resolve(CHARGE_RING_FILL_COLOR_KEY)).toBe(CHARGE_RING_FILL_FALLBACK_COLOR);
  });

  it('FIREPOWER_KILL_COLOR_KEY resolves to its own stated fallback -- Pixi\'s own #8B1E12 has no palette match at all (see this key\'s own doc comment)', () => {
    expect(resolve(FIREPOWER_KILL_COLOR_KEY)).toBe(FIREPOWER_KILL_FALLBACK_COLOR);
    expect(resolve(FIREPOWER_KILL_COLOR_KEY)).not.toBe('#8B1E12');
  });
});

describe('FIREPOWER_KILL_COLOR_KEY is genuinely the nearest palette entry to Pixi\'s off-palette #8B1E12', () => {
  it('beats every other entry in the palette by squared RGB distance', () => {
    const target = { r: 0x8b, g: 0x1e, b: 0x12 };
    const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;
    const reserved = paletteJson.reserved as Record<string, { colors: Record<string, string> }>;
    const hex = (h: string): { r: number; g: number; b: number } => ({
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    });
    const dist = (h: string): number => {
      const c = hex(h);
      return (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    };
    let best = Infinity;
    for (const ramp of Object.values(ramps)) for (const c of ramp.colors) best = Math.min(best, dist(c));
    for (const group of Object.values(reserved)) for (const c of Object.values(group.colors)) best = Math.min(best, dist(c));
    expect(dist(FIREPOWER_KILL_FALLBACK_COLOR)).toBe(best);
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

describe('OverlayBatch.polygonFillWorld / polygonStrokeWorld', () => {
  const square: readonly [number, number, number][] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 4],
    [0, 0, 4],
  ];

  it('polygonFillWorld fan-triangulates a 4-point polygon into exactly 6 vertices (2 triangles)', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.polygonFillWorld(square, '#FF0000', 0.05);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(6);
  });

  it('polygonFillWorld writes literal world positions, not anchor-relative pixel offsets', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.polygonFillWorld(square, '#FF0000', 0.05);
    batch.endFrame();
    const pos = (batch.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    // First vertex is the polygon's own first corner, verbatim.
    expect(pos[0]).toBe(0);
    expect(pos[1]).toBe(0);
    expect(pos[2]).toBe(0);
  });

  it('polygonStrokeWorld writes 2 triangles (6 vertices) per edge of a closed loop', () => {
    const batch = new OverlayBatch(64);
    batch.beginFrame();
    batch.polygonStrokeWorld(square, 0.1, '#FF0000', 0.5);
    batch.endFrame();
    expect(batch.mesh.geometry.drawRange.count).toBe(square.length * 6);
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
