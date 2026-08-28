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
  pushTrianglePx,
  pushEllipseFanPx,
  pushEllipseRingPx,
  billboardPoint,
  OVERLAY_RING_SEGMENTS,
  type TriangleSoup,
  type OverlayColor,
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
