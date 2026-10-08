/**
 * #470: the hatched band an objective zone draws on the ground, inside its
 * own edge. It replaces the 0.12 fill that `OverlayBatch` used to lay over
 * the whole rectangle. That fill was depth-blind and in the over-everything
 * band (4), so over a town it tinted every roof, wall and hull lime. It was
 * also an unlit palette colour written into the pre-tone-map HalfFloat
 * target, so it outshone the lit ground under it: at dusk on Beit Sahwan II
 * it moved 31% of the frame by a mean of 9.3 levels. The lead chose option C
 * of `docs/polish/zone-tint.md` on 2026-10-08.
 *
 * What the band is, and why each part:
 *
 * - **On the ground only.** The material is depth-tested and does not write
 *   depth, so every building, unit and rock in front of the band hides it.
 *   It draws in `ZONE_BAND_RENDER_ORDER`, the fading-decal band (0).
 * - **Multiplied onto the lit ground**, the decal pool's own blend
 *   (`DstColor * SrcColor`). The band therefore takes the scene's light,
 *   shadow and fog instead of glowing. Multiplication commutes, so its order
 *   against the decals sharing band 0 cannot change a pixel.
 * - **Only inside the edge.** `ZONE_BAND_TILES` (0.5) deep, in
 *   `ZONE_BAND_CELL_TILES` (0.25) cells, each corner sampled on the drawn
 *   ground, so the band follows relief. The interior draws nothing.
 * - **Hatched.** Diagonal stripes in world space (`x + z`), so the hatch
 *   holds still on the ground as the camera pans.
 *
 * The STATE (held / not held / contested / target) is still the outline's
 * job: its colour, and its dash for not held and contested (VR-36). The band
 * wears the same colour key and changes nothing about the outline.
 *
 * One mesh for every zone on screen, hidden outright when there is none --
 * three.js submits a mesh whose draw range is empty, so an empty batch left
 * visible would still cost a draw call every frame. The debug layer toggles
 * the GROUP this mesh sits in (`ThreeRenderer`), never `mesh.visible`, which
 * `endFrame` owns.
 *
 * No `normal` attribute, so the AO pre-pass skips it (`post-chain.ts`,
 * `isAoOccluder`), and it casts no shadow.
 */
import * as THREE from 'three';
import { DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS, glslFloat } from '../decal-pool';
import { ZONE_BAND_RENDER_ORDER } from './render-order';
import { createTriangleSoup, pushPolygonFillWorld, resetSoup, type TriangleSoup } from './overlay-geometry';
import { cachedHexToLinear } from './overlays';

/** How deep the band reaches in from the zone's edge, in tiles. */
export const ZONE_BAND_TILES = 0.5;
/** Side of one band cell, in tiles. Small enough that a cell's chord sits on
 *  bicubic relief; two cells span the band. */
export const ZONE_BAND_CELL_TILES = 0.25;
/** How far a stripe's strength pulls the ground toward the zone colour: 1 is
 *  the full multiply, `ground * colour`. */
export const ZONE_BAND_STRENGTH = 1;
/** Stripe period across the diagonal, in world units (tiles). */
export const ZONE_HATCH_PERIOD_TILES = 0.45;
/** Share of each period that is stripe. */
export const ZONE_HATCH_DUTY = 0.5;
/** Lift off the drawn ground, in world units, on top of the decal polygon
 *  offset, so a cell's flat chord does not sink under a crest. */
export const ZONE_BAND_LIFT = 0.02;
/** Vertices the batch holds. A cell is 6; the 24x32 Beit Sahwan III town zone
 *  is 880 cells (5,280 vertices). A push past this is dropped, not grown. */
export const ZONE_BAND_VERTEX_CAPACITY = 6 * 6144;

/** One band cell, `[x0, y0, x1, y1]` in tiles. */
export type ZoneBandCell = readonly [number, number, number, number];

/**
 * The cells of a zone's band: every `cellTiles` square of the rectangle
 * `[zx, zy, zw, zh]` that lies within `bandTiles` of an edge, and no other.
 * A zone narrower than two bands is band all the way across. Cells at the
 * far edges are clipped to the rectangle. Every shipped zone is whole tiles,
 * which the cell divides, so the band is exactly 0.5 deep; a fractional zone
 * would get whole cells across the band's inner edge, never a gap.
 */
export function zoneBandCells(
  rect: readonly number[],
  bandTiles: number = ZONE_BAND_TILES,
  cellTiles: number = ZONE_BAND_CELL_TILES
): ZoneBandCell[] {
  const [zx, zy, zw, zh] = rect;
  const x1 = zx + zw;
  const y1 = zy + zh;
  const eps = 1e-9;
  const out: ZoneBandCell[] = [];
  for (let cy = zy; cy < y1 - eps; cy += cellTiles) {
    const cy1 = Math.min(cy + cellTiles, y1);
    for (let cx = zx; cx < x1 - eps; cx += cellTiles) {
      const cx1 = Math.min(cx + cellTiles, x1);
      // In the band when the cell's NEAREST point to any edge is within it.
      const inner = cx - zx >= bandTiles - eps && x1 - cx1 >= bandTiles - eps && cy - zy >= bandTiles - eps && y1 - cy1 >= bandTiles - eps;
      if (inner) continue;
      out.push([cx, cy, cx1, cy1]);
    }
  }
  return out;
}

/**
 * The band's material: depth-tested, not depth-writing, multiplied onto
 * what is already drawn (the decal pool's blend, alpha kept). The fragment
 * shader cuts the world-space diagonal hatch; `aAlpha` is the stripe's
 * strength.
 */
export function createZoneBandMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vWorld;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vWorld;
      void main() {
        float s = fract((vWorld.x + vWorld.y) / ${glslFloat(ZONE_HATCH_PERIOD_TILES)});
        // A soft-edged stripe: antialiasing is off for world materials.
        float stripe = smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(${glslFloat(ZONE_HATCH_DUTY - 0.06)}, ${glslFloat(ZONE_HATCH_DUTY)}, s));
        gl_FragColor = vec4(mix(vec3(1.0), vColor, vAlpha * stripe), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: DECAL_POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: DECAL_POLYGON_OFFSET_UNITS,
    side: THREE.DoubleSide,
  });
}

/** Every zone band on screen, as one mesh rebuilt each frame. */
export class ZoneBandBatch {
  readonly mesh: THREE.Mesh;
  private readonly soup: TriangleSoup;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;

  constructor(vertexCapacity: number = ZONE_BAND_VERTEX_CAPACITY) {
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
    this.mesh = new THREE.Mesh(geometry, createZoneBandMaterial());
    this.mesh.name = 'zone-band';
    this.mesh.renderOrder = ZONE_BAND_RENDER_ORDER;
    // Rebuilt in world space every frame, like `OverlayBatch`: an
    // origin-centred bounding sphere would cull it wrongly.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  beginFrame(): void {
    resetSoup(this.soup);
  }

  /** One zone's band. `groundY(x, y)` is the drawn ground's world height at
   *  tile point `(x, y)`; `colorHex` is the zone state's resolved colour. */
  pushZone(rect: readonly number[], colorHex: string, groundY: (x: number, y: number) => number): void {
    const color = cachedHexToLinear(colorHex);
    const y = (x: number, z: number): number => groundY(x, z) + ZONE_BAND_LIFT;
    for (const [x0, z0, x1, z1] of zoneBandCells(rect)) {
      pushPolygonFillWorld(
        this.soup,
        [
          [x0, y(x0, z0), z0],
          [x1, y(x1, z0), z0],
          [x1, y(x1, z1), z1],
          [x0, y(x0, z1), z1],
        ],
        color,
        ZONE_BAND_STRENGTH
      );
    }
  }

  /** Uploads the frame's cells and hides the mesh when there are none. */
  endFrame(): void {
    const n = this.soup.count;
    this.mesh.geometry.setDrawRange(0, n);
    this.mesh.visible = n > 0;
    if (n === 0) return;
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
