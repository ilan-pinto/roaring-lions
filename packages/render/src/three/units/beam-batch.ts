/**
 * E6 (GH-274) chunk C: every laser beam in the world, ONE mesh, ONE draw call.
 * Spec 2026-10-24 (e6-art) section 6.1; what the beam looks like is `beam-look.ts`'s business and
 * this file only turns a look and two endpoints into quads.
 *
 * ## Geometry
 *
 * Capacity 16 beams, five quads each, written back to front into one index-ordered draw so the
 * blend order inside the single call is the order below (a transparent mesh sorts its triangles
 * not at all):
 *
 *  1. the SHEATH ribbon, `vfx.ember`, soft across its width;
 *  2. the LENS glow, a billboard disc at the muzzle, `vfx.ember`;
 *  3. the TARGET glow, a billboard disc at the end, `vfx.ember`;
 *  4. the target's hot centre, a smaller disc, `vfx.white_hot`;
 *  5. the CORE ribbon, `vfx.white_hot`, a hard-edged solid line.
 *
 * Both ribbons are camera-facing strips whose width is constant in SCREEN pixels at any zoom
 * (the silhouette's lesson: a world-unit width vanishes zoomed out and becomes a pipe zoomed in;
 * the app clamps zoom to 0.35-2.5). The camera never rotates (`VIEW_DIRECTION` is a constant) so
 * the billboard basis is computed once; only the zoom is a per-frame input. The glows are world
 * sized, in tiles, as the spec has them, so they scale with the zoom like every overlay does.
 *
 * ## The material
 *
 * The shell batch's look: `transparent`, `depthWrite: false`, NORMAL blending, the colour an
 * authored palette value times a gain, never a sum of colours no palette entry names. `depthTest`
 * is ON (the bolt's rule): a beam needs a line of sight to exist, so anything in front of it
 * should hide it. Band `FX_RENDER_ORDER` (2), see `render-order.ts`.
 *
 * ## Cost
 *
 * +1 draw call while any beam is live (main pass only: transparent, no normals, so neither the
 * shadow nor the AO pre-pass takes it), 0 when empty (`visible = false`). Fixed: it does not grow
 * with the number of beams. `beam-drawcalls.test.ts` measures it through three's own render lists.
 *
 * Nothing here reads or writes the sim.
 */
import * as THREE from 'three';
import { VIEW_DIRECTION } from '../camera';
import { hexToLinear } from '../terrain/shared';
import { FX_RENDER_ORDER } from './render-order';
import { tracerIndexBuffer } from './fx';
import { HDR_GAINS } from './hdr-gains';
import { beamPxToWorld, type BeamLook } from './beam-look';
import { parseFireExtras, type FirePoint } from './fire-points';

/** Beams the batch carries. */
export const BEAM_CAPACITY = 16;
/** Quads per beam: sheath, lens, target glow, target centre, core. */
export const BEAM_QUADS_PER_BEAM = 5;

/** The shape kinds the fragment shader branches on (`aShape.z`). */
const KIND_SHEATH = 0;
const KIND_CORE = 1;
const KIND_DISC = 2;

/** The target's hot centre is this fraction of its glow radius. */
const TARGET_CENTRE_FRACTION = 0.5;

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute vec3 aShape;
varying vec3 vColor;
varying float vAlpha;
varying vec3 vShape;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vShape = aShape;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// aShape.x is across a ribbon (-1..1) or x on a disc; aShape.y is along a ribbon or y on a disc;
// aShape.z is the kind: below 0.5 the sheath, below 1.5 the core, otherwise a glow disc.
const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying vec3 vShape;
void main() {
  float a = vAlpha;
  if (vShape.z < 0.5) {
    // The sheath: alpha falls off across its width.
    a *= 1.0 - vShape.x * vShape.x;
  } else if (vShape.z > 1.5) {
    // A glow disc: solid at the centre, soft at the rim.
    float r = length(vShape.xy);
    if (r > 1.0) discard;
    a *= 1.0 - smoothstep(0.35, 1.0, r);
  }
  // The core is a solid, hard-edged hot line: alpha as authored.
  gl_FragColor = vec4(vColor, a);
}
`;

/** One beam to draw: both ends in world space and the look `stepBeamLook` decided. */
export interface BeamDraw {
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  /** The target end; ignored when `look.ribbon` is false (a lens glow fading on its own). */
  readonly ex: number;
  readonly ey: number;
  readonly ez: number;
  readonly look: BeamLook;
}

// The camera basis. The camera looks along -VIEW_DIRECTION and never rolls.
const FORWARD = VIEW_DIRECTION.clone().negate().normalize();
const RIGHT = new THREE.Vector3().crossVectors(FORWARD, new THREE.Vector3(0, 1, 0)).normalize();
const CAM_UP = new THREE.Vector3().crossVectors(RIGHT, FORWARD).normalize();

const tmpD = new THREE.Vector3();
const tmpSide = new THREE.Vector3();

export class BeamBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly capacity: number;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly shapeAttr: THREE.BufferAttribute;
  private readonly coreLinear: [number, number, number] = [1, 1, 1];
  private readonly sheathLinear: [number, number, number] = [1, 0.5, 0.1];
  private beams = 0;
  private zoom = 1;
  private debugHidden = false;
  private disposed = false;

  constructor(scene: THREE.Object3D, opts: { capacity?: number } = {}) {
    this.capacity = opts.capacity ?? BEAM_CAPACITY;
    const quads = this.capacity * BEAM_QUADS_PER_BEAM;
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(quads * 4 * 3), 3);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(quads * 4 * 3), 3);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(quads * 4), 1);
    this.shapeAttr = new THREE.BufferAttribute(new Float32Array(quads * 4 * 3), 3);
    for (const a of [this.positionAttr, this.colorAttr, this.alphaAttr, this.shapeAttr]) a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setAttribute('aShape', this.shapeAttr);
    geometry.setIndex(new THREE.BufferAttribute(tracerIndexBuffer(quads), 1));
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // The bolt's rule: the beam needs line of sight, so a roof in front of it hides it.
      depthTest: true,
      depthWrite: false,
      // The ribbon is rebuilt every frame from two arbitrary points: no winding to prove once.
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'beam-batch';
    this.mesh.renderOrder = FX_RENDER_ORDER;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Transparent, no normals: not an AO occluder, casts no shadow.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  /** The palette colours, as hex (`vfx.white_hot`, `vfx.ember`); stored as LINEAR, the rule for a uniform or vertex colour. */
  setColors(coreHex: string, sheathHex: string): void {
    const c = hexToLinear(coreHex);
    const s = hexToLinear(sheathHex);
    this.coreLinear[0] = c[0];
    this.coreLinear[1] = c[1];
    this.coreLinear[2] = c[2];
    this.sheathLinear[0] = s[0];
    this.sheathLinear[1] = s[1];
    this.sheathLinear[2] = s[2];
  }

  /** The `beam` debug layer: a FLAG `finish` consults, because it re-derives `visible` every frame. */
  setDebugHidden(hidden: boolean): void {
    this.debugHidden = hidden;
    if (hidden) this.mesh.visible = false;
  }

  /** Beams written since `beginFrame`. */
  get count(): number {
    return this.beams;
  }

  beginFrame(zoom: number): void {
    this.beams = 0;
    this.zoom = zoom;
  }

  /** Writes one beam. False (and nothing written) when the batch is full. */
  add(b: BeamDraw): boolean {
    if (this.beams >= this.capacity) return false;
    const look = b.look;
    let quad = this.beams * BEAM_QUADS_PER_BEAM;
    const hw = beamPxToWorld(look.sheathPx, this.zoom) / 2;
    const cw = beamPxToWorld(look.corePx, this.zoom) / 2;
    const [cr, cg, cb] = this.coreLinear;
    const [sr, sg, sb] = this.sheathLinear;
    const gs = HDR_GAINS.beamSheath;
    const gg = HDR_GAINS.beamGlow;
    const gc = HDR_GAINS.beamCore;

    if (look.ribbon) {
      tmpD.set(b.ex - b.ox, b.ey - b.oy, b.ez - b.oz);
      // The strip faces the camera: its width axis is perpendicular to both the beam and the view.
      tmpSide.crossVectors(tmpD, FORWARD);
      if (tmpSide.lengthSq() < 1e-10) tmpSide.copy(RIGHT);
      else tmpSide.normalize();
      this.ribbonQuad(quad++, b, tmpSide, hw, KIND_SHEATH, sr * gs, sg * gs, sb * gs, look.sheathAlpha);
    } else {
      this.emptyQuad(quad++);
    }
    // The lens glow, at the muzzle, while it has any alpha (it outlives a broken beam by 150 ms).
    if (look.lens) this.discQuad(quad++, b.ox, b.oy, b.oz, look.lensGlowTiles, sr * gg, sg * gg, sb * gg, look.lensGlowAlpha);
    else this.emptyQuad(quad++);
    if (look.ribbon) {
      this.discQuad(quad++, b.ex, b.ey, b.ez, look.targetGlowTiles, sr * gg, sg * gg, sb * gg, look.targetGlowAlpha);
      this.discQuad(
        quad++, b.ex, b.ey, b.ez, look.targetGlowTiles * TARGET_CENTRE_FRACTION, cr * gg, cg * gg, cb * gg, look.targetGlowAlpha
      );
      this.ribbonQuad(quad, b, tmpSide, cw, KIND_CORE, cr * gc, cg * gc, cb * gc, look.coreAlpha);
    } else {
      this.emptyQuad(quad);
      this.emptyQuad(quad + 1);
      this.emptyQuad(quad + 2);
    }
    this.beams++;
    return true;
  }

  /** Uploads the frame: the draw range, the dirty flags, and `visible` (0 draws when empty). */
  finish(): void {
    const quads = this.beams * BEAM_QUADS_PER_BEAM;
    this.mesh.geometry.setDrawRange(0, quads * 6);
    if (this.beams > 0) {
      this.positionAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.shapeAttr.needsUpdate = true;
    }
    this.mesh.visible = this.beams > 0 && !this.debugHidden;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private emptyQuad(q: number): void {
    // A degenerate quad at the origin with alpha 0: nothing rasterised, nothing blended.
    this.positionAttr.array.fill(0, q * 12, q * 12 + 12);
    this.alphaAttr.array.fill(0, q * 4, q * 4 + 4);
  }

  private setVertex(q: number, v: number, x: number, y: number, z: number, r: number, g: number, bl: number, a: number, su: number, sv: number, kind: number): void {
    const pi = (q * 4 + v) * 3;
    const p = this.positionAttr.array as Float32Array;
    p[pi] = x;
    p[pi + 1] = y;
    p[pi + 2] = z;
    const c = this.colorAttr.array as Float32Array;
    c[pi] = r;
    c[pi + 1] = g;
    c[pi + 2] = bl;
    (this.alphaAttr.array as Float32Array)[q * 4 + v] = a;
    const s = this.shapeAttr.array as Float32Array;
    s[pi] = su;
    s[pi + 1] = sv;
    s[pi + 2] = kind;
  }

  private ribbonQuad(q: number, b: BeamDraw, side: THREE.Vector3, halfWidth: number, kind: number, r: number, g: number, bl: number, a: number): void {
    const sx = side.x * halfWidth;
    const sy = side.y * halfWidth;
    const sz = side.z * halfWidth;
    this.setVertex(q, 0, b.ox - sx, b.oy - sy, b.oz - sz, r, g, bl, a, -1, 0, kind);
    this.setVertex(q, 1, b.ox + sx, b.oy + sy, b.oz + sz, r, g, bl, a, 1, 0, kind);
    this.setVertex(q, 2, b.ex + sx, b.ey + sy, b.ez + sz, r, g, bl, a, 1, 1, kind);
    this.setVertex(q, 3, b.ex - sx, b.ey - sy, b.ez - sz, r, g, bl, a, -1, 1, kind);
  }

  private discQuad(q: number, cx: number, cy: number, cz: number, radius: number, r: number, g: number, bl: number, a: number): void {
    const rx = RIGHT.x * radius;
    const ry = RIGHT.y * radius;
    const rz = RIGHT.z * radius;
    const ux = CAM_UP.x * radius;
    const uy = CAM_UP.y * radius;
    const uz = CAM_UP.z * radius;
    this.setVertex(q, 0, cx - rx - ux, cy - ry - uy, cz - rz - uz, r, g, bl, a, -1, -1, KIND_DISC);
    this.setVertex(q, 1, cx + rx - ux, cy + ry - uy, cz + rz - uz, r, g, bl, a, 1, -1, KIND_DISC);
    this.setVertex(q, 2, cx + rx + ux, cy + ry + uy, cz + rz + uz, r, g, bl, a, 1, 1, KIND_DISC);
    this.setVertex(q, 3, cx - rx + ux, cy - ry + uy, cz - rz + uz, r, g, bl, a, -1, 1, KIND_DISC);
  }
}

/**
 * `rl_fire.muzzle` of a vehicle GLB, from the template root's extras. For the laser carrier it is
 * TURRET-LOCAL - relative to `turret_pivot`, in the GLB's own frame (+X forward, +Y up, metres) -
 * which is why it is transformed by the clone's live pivot world matrix and not by the hull's. Null
 * when the GLB declares none (the caller falls back to the hull).
 */
export function vehicleMuzzleOf(userData: Record<string, unknown>, label: string): FirePoint | null {
  return parseFireExtras(userData.rl_fire, label)?.muzzle ?? null;
}
