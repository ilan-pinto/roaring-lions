/**
 * Phase C: the unit overlay tier -- selection rings, HP bars, suppression
 * bars, control-group badges, a garrison hover highlight, order markers, and
 * the tutorial focus ring. `ThreeRenderer.addOrderMarker()` was an empty
 * function body and nothing else in this backend drew any of the above at
 * all, which is why clicking a unit visibly selected it (`ThreeRenderer
 * .selection` genuinely changed) while nothing appeared on screen to show
 * it -- the bug this phase exists to fix, not a cursor or input-handling
 * defect.
 *
 * `render-order.ts`'s own top comment is this module's spec for WHERE things
 * draw; this file's job is WHAT draws and in what shape, ported from
 * `renderer.ts`'s single per-entity unit loop (`renderer.ts:1898` onward,
 * `const g = this.unitsG`) and its trailing per-frame overlay passes
 * (weapon-envelope rings, the shepherd radius and engagement reticles are
 * NOT ported -- out of this phase's named scope, see the task brief's own
 * "Scope" list, which names exactly seven things and no others).
 *
 * Split the same way `units/fx.ts` and `units/structures.ts` already are:
 * `./overlay-geometry.ts` is the pure half (pixel-space triangle arithmetic,
 * no `THREE.*`, its own test file); everything below the divide here is
 * GPU-facing construction that needs a real `WebGLRenderer` to *use* (though
 * not to *construct* -- see `fx.test.ts`'s own precedent for why plain
 * `THREE.*` JS-side objects build fine under `environment: 'node'`).
 *
 * ## Two draw calls, not one, and why the numeral is its own class
 *
 * `OverlayBatch` is `TracerBatch`'s structural twin, generalised from fixed
 * quads to arbitrary triangles (`overlay-geometry.ts`'s own top comment) --
 * one non-instanced `THREE.Mesh`, vertex-coloured, rebuilt fully every
 * frame, `setDrawRange`-trimmed to what was actually pushed. It draws every
 * overlay this phase names except one: the control-group badge's NUMERAL.
 *
 * Pixi draws that numeral into a DIFFERENT container than its own badge
 * ring (`render-order.ts`'s closing paragraphs have the full trap), so
 * folding it into `OverlayBatch` -- one shared `renderOrder`, matching what
 * Pixi does for the ring -- would lift the numeral above FX where Pixi
 * covers it. It also needs a TEXTURE (nine pre-rendered glyphs, `1`-`9`,
 * the only values a control group's numeral is ever assigned), which
 * `OverlayBatch`'s vertex-coloured material has no attribute for. Both
 * differences are real, not incidental, so `NumeralBatch` is a second,
 * smaller batch of the same non-instanced-and-rebuilt shape, its own
 * texture, its own material, and `BADGE_NUMERAL_RENDER_ORDER` instead of
 * `OVERLAY_RENDER_ORDER`.
 *
 * ## `depthTest: false` on both, deliberately -- this is a port, not a fix
 *
 * Pixi's `unitsG` paints after `spriteLayer`/`fxAboveG` unconditionally,
 * with no depth buffer at all -- an overlay is never occluded by a building
 * or another unit's sprite, only by fog (`render-order.ts`'s own closing
 * paragraphs, "so in Pixi every overlay draws UNDER fog, never over it").
 * `depthTest: false` plus `OVERLAY_RENDER_ORDER`/`BADGE_NUMERAL_RENDER_ORDER`
 * sitting below `FOG_RENDER_ORDER` reproduces exactly that: real depth
 * buffer arbitration would be a BEHAVIOUR CHANGE from what Pixi ships (a
 * selected unit standing behind a building, from this camera's fixed
 * dimetric angle, would lose its ring to the building's own depth -- Pixi
 * never does that), not a faithful port of it.
 */
import * as THREE from 'three';
import { hexToUnit } from '../terrain/shared';
import {
  createTriangleSoup,
  resetSoup,
  pushRectPx,
  pushRectStrokePx,
  pushLinePx,
  pushTrianglePx,
  pushEllipseFanPx,
  pushEllipseRingPx,
  pushPolygonFillWorld,
  pushPolygonStrokeWorld,
  pushLineWorld,
  billboardPoint,
  OVERLAY_RING_SEGMENTS,
  type TriangleSoup,
  type OverlayColor,
  type WorldPoint,
} from './overlay-geometry';
import { OVERLAY_RENDER_ORDER, BADGE_NUMERAL_RENDER_ORDER } from './render-order';

// ---------------------------------------------------------------------------
// Pure: palette-key policy and small per-overlay-kind numeric formulas. No
// THREE.* below this line yet -- mirrors fx.ts's own split, for the same
// reason: "which colour key" and "how big is the crosshair at this fade
// fraction" are decisions, not GPU state, and belong where a test can reach
// them with no WebGLRenderer in sight.
// ---------------------------------------------------------------------------

/** Pixi's own unit-loop silhouette radius (`renderer.ts`'s `const r = type
 *  .isSoft ? 7 : 11`), redeclared here for the same import-boundary reason
 *  every other constant ported from `renderer.ts` in this backend is: that
 *  file pulls in pixi.js at module scope. Every HP bar/suppression bar/
 *  selection-ring/badge offset below is expressed relative to this, exactly
 *  as Pixi's own literals are. */
export function unitOverlayRadiusPx(isSoft: boolean): number {
  return isSoft ? 7 : 11;
}

/**
 * Palette key for an HP bar's fill colour at a given ratio -- Pixi's own
 * `hpRatio > 0.5 ? '#6B8A4A' : hpRatio > 0.25 ? '#E8C33A' : '#D93A2B'`
 * (`renderer.ts`'s unit loop), expressed as the palette keys those three
 * literals happen to equal (`scrub.0`, `team.neutral`, `team.hostile`) --
 * "colour is looked up, never computed" (this task's own constraint): this
 * function decides WHICH key, `ThreeRenderer` resolves it.
 */
export function hpBarColorKey(ratio: number): string {
  if (ratio > 0.5) return 'scrub.0';
  if (ratio > 0.25) return 'team.neutral';
  return 'team.hostile';
}

/** Palette key for the HP bar's dark backing rect -- Pixi's `#14150F`. */
export const HP_BG_COLOR_KEY = 'shadow.1';
/** Palette key for the suppression bar's fill -- Pixi's `#FFB43C`. */
export const SUPPRESSION_COLOR_KEY = 'vfx.fire';
/** Palette key for a selection ring/badge/order-marker/hover-highlight/
 *  tutorial-ring's DEFAULT colour (no control-group override) -- Pixi's
 *  `#B8FF5A`, used verbatim across every one of those five call sites. */
export const OVERLAY_ACCENT_COLOR_KEY = 'vfx.tracer';
/** Palette key for the badge numeral's own fixed fill -- Pixi's `#14150F`,
 *  the same value as `HP_BG_COLOR_KEY` (a different UI purpose, the same
 *  palette swatch, exactly as Pixi's own literal hex values coincide). */
export const BADGE_TEXT_COLOR_KEY = 'shadow.1';

/**
 * Palette key for the objective zone's outline and fill -- Pixi's own
 * `this.objectiveZoneState === 'contested' ? '#D93A2B' : this
 * .objectiveZoneState === 'unheld' ? '#E8C33A' : '#B8FF5A'` (`renderer.ts`'s
 * objective-zone block), expressed as the palette keys those three literals
 * happen to equal -- `team.hostile`, `team.neutral`, and `vfx.tracer` (the
 * same key `OVERLAY_ACCENT_COLOR_KEY` above already names for "held", since
 * both are Pixi's identical `#B8FF5A`).
 */
export function objectiveZoneColorKey(state: 'held' | 'unheld' | 'contested'): string {
  if (state === 'contested') return 'team.hostile';
  if (state === 'unheld') return 'team.neutral';
  return OVERLAY_ACCENT_COLOR_KEY;
}

/** `overlayColor(objectiveZoneColorKey(state), ...)`'s fallback when no
 *  `resolveColor` is supplied -- Pixi's own three literals verbatim, kept
 *  next to the key function above rather than folded into it so the two can
 *  be read side by side against `renderer.ts`'s own ternary. */
export function objectiveZoneFallbackColor(state: 'held' | 'unheld' | 'contested'): string {
  if (state === 'contested') return '#D93A2B';
  if (state === 'unheld') return '#E8C33A';
  return '#B8FF5A';
}

/**
 * Pixi's own `this.objectiveZoneState === 'held' ? 0.3 : 0.35 + 0.25 *
 * Math.sin(this.frameN * 0.09)` (`renderer.ts`'s objective-zone block) --
 * "held" sits at a fixed low alpha, anything else pulses. Returns exactly
 * the value Pixi's own local variable holds; the call site adds its own
 * `+ 0.25` for the stroke (mirroring Pixi's `pulse + 0.25`) and uses the bare
 * value for the fill, exactly as `renderer.ts` does.
 */
export function objectiveZonePulse(state: 'held' | 'unheld' | 'contested', frameN: number): number {
  if (state === 'held') return 0.3;
  return 0.35 + 0.25 * Math.sin(frameN * 0.09);
}

/** World-tile inset `pushPolygonStrokeWorld` uses for the objective zone's
 *  outline -- see that function's own doc comment for why this cannot be a
 *  literal screen-pixel width the way every anchor-based stroke in this file
 *  is. Derived from Pixi's own 2px stroke (`renderer.ts`'s `.stroke({width:
 *  2, ...})`) via `screenOffsetToWorld(2, 0)` -- the same "how far in tile
 *  space does N screen pixels of horizontal movement go" conversion
 *  `overlay-geometry.ts`'s `billboardPoint` is built from -- which resolves
 *  to about 0.044 tile units; rounded up slightly, to 0.05, so the outline
 *  reads as a visible line rather than vanishing at typical gameplay zoom. */
export const OBJECTIVE_ZONE_STROKE_INSET_TILES = 0.05;

/** Palette key for an airborne unit's ground shadow -- Pixi's own `#0A0A08`
 *  (`renderer.ts`'s air-lift shadow ellipse), the same swatch `fog-mesh.ts`
 *  already names `shadow.2` for the identical literal. */
export const AIR_SHADOW_COLOR_KEY = 'shadow.2';

/** Palette key for the permanent-wreck fallback cross marker -- a unit type
 *  with no `wreck` clip in its sheet (`mbt_lavi`'s `TNK_HULL`/`TNK_TURR`
 *  manifests among them: no `clips` object at all, so `clipOrFallback(sheet,
 *  'wreck')` resolves to `'idle'`, never `'wreck'`). Pixi's own literal,
 *  `'#5C625F'` (`renderer.ts:1240-1241`'s two-line X, drawn into `unitsG`
 *  itself rather than `wreckLayer`), is the SAME swatch `renderer.ts:2402`
 *  already names `gunmetal.2` for its tutorial-ring track colour. */
export const WRECK_MARKER_COLOR_KEY = 'gunmetal.2';

/** Ticks this many `frame()` calls a placed order marker survives -- Pixi's
 *  own `ttl: 80` (`renderer.ts`'s `addOrderMarker`). Counted in frames, not
 *  seconds: Pixi's own `frame()` runs at the display's refresh rate, not the
 *  sim's fixed 20 Hz tick, and this backend's `updateOverlays` decrements it
 *  on the identical cadence for the identical on-screen fade duration. */
export const ORDER_MARKER_TTL = 80;

/**
 * Crosshair half-length, in screen px, at fade fraction `a` (1 = just
 * placed, 0 = about to disappear) -- Pixi's own `s = 10 + (1 - a) * 6`
 * (`renderer.ts`'s order-marker loop): the crosshair grows slightly, from
 * 10px arms to 16px, as it fades out.
 */
export function orderMarkerSize(a: number): number {
  return 10 + (1 - a) * 6;
}

// ---------------------------------------------------------------------------
// Phase D readiness: the six overlay passes the Phase C brief named out of
// scope (this file's own top comment) -- weapon envelopes, the shepherd
// radius, engagement reticles, building integrity + garrison pips, the
// demolition/tunnel-charge progress ring, and mobility/firepower-kill pips.
// Same split as everything above: palette-key policy here, GPU construction
// below the divide.
// ---------------------------------------------------------------------------

/** Palette key for the mobility-kill pip -- Pixi's own `#8E9491`
 *  (`renderer.ts`'s `if (st.mobilityKilled[i] === 1) g.circle(...).fill(
 *  '#8E9491')`), an EXACT match for `gunmetal.1`. */
export const MOBILITY_KILL_COLOR_KEY = 'gunmetal.1';

/**
 * Palette key for the firepower-kill pip -- Pixi's own `#8B1E12`
 * (`renderer.ts`'s `if (st.firepowerKilled[i] === 1) g.circle(...).fill(
 * '#8B1E12')`). Unlike every other colour ported from this file's list,
 * `#8B1E12` is not IN `data/palette.json` at all -- checked by squared RGB
 * distance against all 58 entries, not by eye. `terracotta.2` (`#7A3B24`) is
 * the nearest at a distance of ~38 (`team.hostile`, the next closest
 * plausible "kill/damage" red, is ~87 away). This is Pixi's own pre-existing
 * gap, not introduced here -- `renderer.ts` is not subject to `validate:ui`
 * (that gate's own scope comment excludes the renderer package entirely) or
 * to `validate:assets` (that gate walks rendered sprites, not overlay
 * literals) -- so it was never caught. Recorded here rather than silently
 * matched, because "closest" is an approximation, not the palette-exactness
 * this backend's colour pipeline otherwise guarantees everywhere else. */
export const FIREPOWER_KILL_COLOR_KEY = 'terracotta.2';
/** `overlayColor(FIREPOWER_KILL_COLOR_KEY, ...)`'s fallback when no
 *  `resolveColor` is supplied -- `terracotta.2`'s own real value, NOT
 *  Pixi's `#8B1E12` (which is not a resolvable key), so a caller with no
 *  resolver still gets a genuine palette colour rather than reintroducing
 *  the off-palette literal through the back door. */
export const FIREPOWER_KILL_FALLBACK_COLOR = '#7A3B24';

/**
 * Palette key for a building's integrity-bar FILL at a given HP ratio --
 * Pixi's own `ratio > 0.6 ? '#8E9491' : ratio > 0.3 ? '#E8C33A' : '#D93A2B'`
 * (`renderer.ts`'s building-status block), three EXACT matches:
 * `gunmetal.1`, `team.neutral`, `team.hostile`. A different threshold set
 * from `hpBarColorKey` above (0.6/0.3 here, 0.5/0.25 there) and a different
 * top colour (`gunmetal.1` here, `scrub.0` there) -- Pixi's own two ratio
 * bars are not the same formula, so this is deliberately its own function
 * rather than a shared one with different call-site thresholds.
 */
export function buildingIntegrityColorKey(ratio: number): string {
  if (ratio > 0.6) return MOBILITY_KILL_COLOR_KEY;
  if (ratio > 0.3) return 'team.neutral';
  return 'team.hostile';
}

/** Palette key for the demolition/tunnel-charge progress ring's TRACK --
 *  Pixi's own `this.opts.resolveColor ? this.opts.resolveColor('gunmetal.2')
 *  : '#5C625F'` (`renderer.ts`'s charge-ring block) -- already resolved
 *  THROUGH a palette key on the Pixi side, so this is a direct port, not a
 *  derivation like `FIREPOWER_KILL_COLOR_KEY` above. Same key
 *  `WRECK_MARKER_COLOR_KEY` already names for its own, unrelated purpose
 *  (two different UI meanings, the same swatch, exactly as this file's own
 *  `BADGE_TEXT_COLOR_KEY` doc comment already notes happens elsewhere). */
export const CHARGE_RING_TRACK_COLOR_KEY = 'gunmetal.2';
/** Palette key for the progress ring's FILL -- Pixi's own
 *  `this.opts.resolveColor('vfx.ember')` fallback `'#E8541E'`, same block. */
export const CHARGE_RING_FILL_COLOR_KEY = 'vfx.ember';
/** `overlayColor(CHARGE_RING_FILL_COLOR_KEY, ...)`'s fallback -- Pixi's own
 *  literal, verbatim. */
export const CHARGE_RING_FILL_FALLBACK_COLOR = '#E8541E';

/**
 * World-tile radius of a weapon envelope ring, expressed in ON-SCREEN
 * pixels for a fixed dimetric camera -- Pixi's own `ring()` closure
 * (`renderer.ts`'s weapon-envelope block): `g.ellipse(ex, ey, tiles *
 * TILE_W * ISO_K, tiles * TILE_H * ISO_K)`, where `ISO_K = Math.SQRT1_2`.
 * Algebraically the SAME formula the tutorial focus ring already uses
 * (`ThreeRenderer.updateOverlays`'s own tutorial-ring block, and its own
 * comment on why a world-tile-radius circle in 2:1 dimetric is an
 * axis-aligned ellipse of these two radii) -- pulled out once here so the
 * weapon envelope, the shepherd radius, and the tutorial ring all compute it
 * the identical way rather than three separately-typed copies of one
 * formula.
 */
export const ISO_K = Math.SQRT1_2;
export function tileRadiusToEllipsePx(tiles: number, tileWPx: number, tileHPx: number): { rightR: number; upR: number } {
  return { rightR: tiles * tileWPx * ISO_K, upR: tiles * tileHPx * ISO_K };
}

/** RGB triple in 0..1, memoised -- the last step before a resolved palette
 *  hex becomes vertex colour, mirroring `fx.ts`'s own `cachedHexToUnit`
 *  (private there; this module needs its own for the identical reason:
 *  `writeParticleInstances`/`OverlayBatch` both convert a tiny, effectively
 *  fixed set of hex strings every frame, and a fresh `hexToUnit` parse per
 *  overlay per entity per frame would be the allocation churn that
 *  function's own doc comment already argues against). */
const colorCache = new Map<string, OverlayColor>();
export function cachedHexToUnit(hex: string): OverlayColor {
  let rgb = colorCache.get(hex);
  if (!rgb) {
    rgb = hexToUnit(hex);
    colorCache.set(hex, rgb);
  }
  return rgb;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction.
// ---------------------------------------------------------------------------

/**
 * Vertex-coloured, per-vertex-alpha material for `OverlayBatch` -- the
 * identical shape `fx.ts`'s own `createTracerMaterial` uses (`aColor`/
 * `aAlpha` attributes, flat passthrough shaders), `side: THREE.DoubleSide`
 * for the reason `overlay-geometry.ts`'s own top comment gives (no winding
 * to track per shape when a shape is never viewed edge-on), and
 * `depthTest: false` for the reason this file's own top comment gives (a
 * faithful port of Pixi's un-occluded `unitsG`, not a shortcut).
 */
function createOverlayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Every overlay this phase draws except the badge numeral (see this file's
 * top comment for why that one is separate): one non-instanced
 * `THREE.Mesh`, rebuilt fully every frame from a `TriangleSoup`
 * (`overlay-geometry.ts`), exactly the `TracerBatch` shape.
 */
export class OverlayBatch {
  readonly mesh: THREE.Mesh;
  private readonly soup: TriangleSoup;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;

  constructor(vertexCapacity: number) {
    this.soup = createTriangleSoup(vertexCapacity);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.soup.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.soup.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.soup.alphas, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, createOverlayMaterial());
    this.mesh.renderOrder = OVERLAY_RENDER_ORDER;
    // Overlays track every living/selected entity across the whole map,
    // exactly like UnitInstancer/ParticleInstancer/TracerBatch -- see
    // instances.ts's own identical `frustumCulled = false` and its comment
    // for why an origin-centred bounding sphere would be wrong here too.
    this.mesh.frustumCulled = false;
  }

  /** Clears last frame's triangles. Call once per `frame()`, before any
   *  push* call below. */
  beginFrame(): void {
    resetSoup(this.soup);
  }

  rect(
    anchor: readonly [number, number, number],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorHex: string,
    alpha: number
  ): void {
    pushRectPx(this.soup, anchor, x0, y0, x1, y1, cachedHexToUnit(colorHex), alpha);
  }

  rectStroke(
    anchor: readonly [number, number, number],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    strokeWidthPx: number,
    colorHex: string,
    alpha: number
  ): void {
    pushRectStrokePx(this.soup, anchor, x0, y0, x1, y1, strokeWidthPx, cachedHexToUnit(colorHex), alpha);
  }

  /** A stroked straight line segment -- see `pushLinePx`'s own doc comment
   *  (`overlay-geometry.ts`) for why this soup has no single-primitive
   *  equivalent to Pixi's `g.moveTo(...).lineTo(...).stroke(...)`. */
  line(
    anchor: readonly [number, number, number],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    widthPx: number,
    colorHex: string,
    alpha: number
  ): void {
    pushLinePx(this.soup, anchor, x0, y0, x1, y1, widthPx, cachedHexToUnit(colorHex), alpha);
  }

  triangle(
    anchor: readonly [number, number, number],
    points: readonly (readonly [number, number])[],
    colorHex: string,
    alpha: number
  ): void {
    pushTrianglePx(this.soup, anchor, points, cachedHexToUnit(colorHex), alpha);
  }

  ellipseFan(
    anchor: readonly [number, number, number],
    rightR: number,
    upR: number,
    colorHex: string,
    alpha: number,
    segments: number = OVERLAY_RING_SEGMENTS
  ): void {
    pushEllipseFanPx(this.soup, anchor, rightR, upR, cachedHexToUnit(colorHex), alpha, segments);
  }

  ellipseRing(
    anchor: readonly [number, number, number],
    rightR: number,
    upR: number,
    strokeWidthPx: number,
    colorHex: string,
    alpha: number,
    segments: number = OVERLAY_RING_SEGMENTS
  ): void {
    pushEllipseRingPx(this.soup, anchor, rightR, upR, strokeWidthPx, cachedHexToUnit(colorHex), alpha, segments);
  }

  /** The objective zone's fill -- see `overlay-geometry.ts`'s own top
   *  comment for why this is the one overlay drawn from literal world
   *  points rather than a single billboard anchor. */
  polygonFillWorld(points: readonly WorldPoint[], colorHex: string, alpha: number): void {
    pushPolygonFillWorld(this.soup, points, cachedHexToUnit(colorHex), alpha);
  }

  /** The objective zone's outline -- see `pushPolygonStrokeWorld`'s own doc
   *  comment for what `insetTiles` means and why it is not a literal
   *  screen-pixel width. */
  polygonStrokeWorld(points: readonly WorldPoint[], insetTiles: number, colorHex: string, alpha: number): void {
    pushPolygonStrokeWorld(this.soup, points, insetTiles, cachedHexToUnit(colorHex), alpha);
  }

  /** The engagement-reticle duel line -- see `pushLineWorld`'s own doc
   *  comment for why two independent world points, not one shared anchor. */
  lineWorld(p0: WorldPoint, p1: WorldPoint, widthPx: number, colorHex: string, alpha: number): void {
    pushLineWorld(this.soup, p0, p1, widthPx, cachedHexToUnit(colorHex), alpha);
  }

  /** Uploads this frame's triangles and trims the draw range to what was
   *  actually pushed -- call once per `frame()`, after every push* call. */
  endFrame(): void {
    this.mesh.geometry.setDrawRange(0, this.soup.count);
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Digits a control-group badge can ever carry -- groups run 1-9
 *  (`data/palette.json`'s own `reserved.group` has exactly nine entries,
 *  `g1`-`g9`, and `ThreeRenderer.unitGroup`/`opts.groupColors` both follow
 *  that range), so nine pre-rendered glyphs cover every real value; a
 *  caller passing anything else is silently skipped, mirroring `NumeralBatch
 *  .push`'s own bounds check below. */
const NUMERAL_DIGITS = 9;
/** Texture-space pixels per digit cell -- resolution of the pre-rendered
 *  glyph atlas, unrelated to the on-screen size a pushed quad ends up at
 *  (that is `widthPx`/`heightPx`, `NumeralBatch.push`'s own arguments). 64
 *  is comfortably sharp at any zoom this camera reaches. */
const NUMERAL_CELL_PX = 64;

/**
 * Builds the nine-digit glyph atlas `NumeralBatch` samples from -- one
 * canvas, `'1'`-`'9'` laid out left to right, `fillColorHex` already
 * resolved (this module's own "colour is looked up, never computed" rule:
 * the caller resolves the palette key, this function only paints with the
 * result).
 *
 * `flipY = false`, set explicitly rather than left at three.js's own
 * `Texture` default (`true`): a canvas's row 0 is visually its TOP, and
 * `NumeralBatch.push` assigns UV `v = 0` to its quad's own top edge
 * (`overlay-geometry.ts`'s Pixi y-down convention, same as everywhere else
 * in this file) -- with the default flip left on, three.js would sample the
 * atlas upside down, which for a digit is not a symmetric, invisible
 * mirroring the way `pushEllipseFanPx`'s own angle convention is: a `6`
 * flipped vertically reads as a `9`.
 */
function buildDigitTexture(fillColorHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = NUMERAL_CELL_PX * NUMERAL_DIGITS;
  canvas.height = NUMERAL_CELL_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('overlays: 2D canvas context unavailable for badge numerals');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fillColorHex;
  ctx.font = `bold ${Math.floor(NUMERAL_CELL_PX * 0.72)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let d = 1; d <= NUMERAL_DIGITS; d++) {
    const cx = (d - 1) * NUMERAL_CELL_PX + NUMERAL_CELL_PX / 2;
    ctx.fillText(String(d), cx, NUMERAL_CELL_PX / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The control-group badge's NUMERAL -- see this file's top comment for why
 * it is a second batch rather than folded into `OverlayBatch`. Same
 * non-instanced, rebuilt-every-frame shape, textured instead of vertex-
 * coloured: one quad per grouped, visible, living entity, UV-addressed into
 * `buildDigitTexture`'s nine-cell atlas by that entity's own group number.
 */
export class NumeralBatch {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  /** Built lazily, on the first digit actually pushed -- see `ensureTexture`'s
   *  own doc comment for why the constructor must not touch `document`. */
  private texture: THREE.CanvasTexture | null = null;
  private readonly fillColorHex: string;
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private count = 0;

  /** `entityCapacity` quads' worth of room -- 6 vertices (2 triangles)
   *  each, matching every other non-indexed shape in this file. */
  constructor(entityCapacity: number, fillColorHex: string) {
    this.fillColorHex = fillColorHex;
    const vertexCapacity = entityCapacity * 6;
    this.positions = new Float32Array(vertexCapacity * 3);
    this.uvs = new Float32Array(vertexCapacity * 2);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(this.uvs, 2);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('uv', this.uvAttr);
    geometry.setDrawRange(0, 0);

    // `map: null` here, not `buildDigitTexture(...)` -- see `ensureTexture`.
    this.material = new THREE.MeshBasicMaterial({
      map: null,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = BADGE_NUMERAL_RENDER_ORDER;
    this.mesh.frustumCulled = false;
  }

  /**
   * Builds `buildDigitTexture`'s canvas atlas on first use rather than in
   * the constructor. `ThreeRenderer` is constructed (and, in
   * `ThreeRenderer.test.ts`, disposed) under `environment: 'node'`, which
   * has no `document` at all -- unlike `new THREE.WebGLRenderer(...)`
   * (mocked in that suite for the identical reason), a `document.
   * createElement('canvas')` call has no such stand-in and would throw the
   * moment any mission with a control group constructed this class. Every
   * OTHER member this class's constructor builds (`BufferGeometry`,
   * `MeshBasicMaterial`, `Mesh`) is plain, GPU-free `THREE.*` JS-side
   * construction, exactly the shape `fx.test.ts`'s own top comment already
   * establishes as headless-safe -- this is the one exception, and this is
   * why it is deferred instead.
   */
  private ensureTexture(): void {
    if (this.texture) return;
    this.texture = buildDigitTexture(this.fillColorHex);
    this.material.map = this.texture;
    this.material.needsUpdate = true;
  }

  beginFrame(): void {
    this.count = 0;
  }

  /**
   * One digit quad, `widthPx` x `heightPx`, centred `centerRightPx`/
   * `centerUpPx` screen pixels from `anchor` (the same `billboardPoint`
   * convention every push* function in `overlay-geometry.ts` uses).
   * `digit` outside `1..9` (nothing to draw -- `unitGroup` reports 0 for
   * "no group") or past this batch's own capacity is silently skipped,
   * matching `TriangleSoup`'s own past-capacity behaviour.
   */
  push(
    anchor: readonly [number, number, number],
    centerRightPx: number,
    centerUpPx: number,
    widthPx: number,
    heightPx: number,
    digit: number
  ): void {
    if (digit < 1 || digit > NUMERAL_DIGITS) return;
    const vertexCapacity = this.positions.length / 3;
    if (this.count + 6 > vertexCapacity) return;
    this.ensureTexture();

    const x0 = centerRightPx - widthPx / 2;
    const x1 = centerRightPx + widthPx / 2;
    // Pixi y-down convention (overlay-geometry.ts's own): "up" is negative.
    const yTop = -centerUpPx - heightPx / 2;
    const yBot = -centerUpPx + heightPx / 2;
    const u0 = (digit - 1) / NUMERAL_DIGITS;
    const u1 = digit / NUMERAL_DIGITS;

    const corners: readonly [number, number, number, number][] = [
      [x0, yTop, u0, 0],
      [x1, yTop, u1, 0],
      [x1, yBot, u1, 1],
      [x0, yTop, u0, 0],
      [x1, yBot, u1, 1],
      [x0, yBot, u0, 1],
    ];
    for (const [xPx, yPx, u, v] of corners) {
      // billboardPoint's own upPx is positive-up; yPx above is Pixi's own
      // positive-down, so it negates going in -- identical convention to
      // pushVertexPx in overlay-geometry.ts.
      const [wx, wy, wz] = billboardPoint(anchor, xPx, -yPx);
      const i = this.count;
      this.positions[i * 3] = wx;
      this.positions[i * 3 + 1] = wy;
      this.positions[i * 3 + 2] = wz;
      this.uvs[i * 2] = u;
      this.uvs[i * 2 + 1] = v;
      this.count++;
    }
  }

  endFrame(): void {
    this.mesh.geometry.setDrawRange(0, this.count);
    this.positionAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}
