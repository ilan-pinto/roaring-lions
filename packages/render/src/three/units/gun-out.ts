/**
 * A knocked-out main gun, drawn on the tank itself (the 4 Nov lead report, part 2; the lead's ruling
 * of 4 Nov after the mock sheet): the barrel droops 14 degrees, the weapon mount of a short or
 * roof-mounted gun tilts with it, and the last of the barrel is charred black.
 *
 * Presentation only. It reads `firepowerKilled` (the sim's own component state, the one the card's
 * "Gun out" reads) and never writes it. It is the model showing its damage, like the scarred hulls
 * and the wrecks (`vehicle-damage.ts`): no overlay, no badge, no mark in the world.
 *
 * ## How
 *
 * The GLBs ship the barrel inside `turret_metal` (no separate node), so the droop is a vertex bend of
 * that mesh's geometry about the MANTLET, `mantletX` -- the front of the turret body, read off the
 * entity's own sibling turret meshes (`turret_hull`, `turret_plate`, ...), so no per-type table can
 * drift from a re-export. Vertices ahead of the mantlet rotate about the axis across the hull by
 * `-GUN_OUT_DROOP_DEG * smoothstep(t)`, `t` the vertex's fraction of the barrel's length, so the barrel
 * bends as one tube rather than hinging at a seam. A barrel shorter than `GUN_OUT_SHORT_BARREL` (the
 * Namer's roof gun, the technical's mount) would barely read at 14 degrees, so the WHOLE mount first
 * pitches `GUN_OUT_MOUNT_TILT_DEG` about its own rear-bottom corner.
 *
 * The char is a second, thin mesh: the barrel's last `GUN_OUT_SCORCH_FRAC` triangles, copied from the
 * BENT geometry, pushed `GUN_OUT_SCORCH_INFLATE` out along their normals and drawn in one dark
 * palette material. A vertex colour on the host would need its own material, and the hull's scar
 * (`vehicle-damage.ts`) already owns every live material; a textured barrel also swallows a vertex
 * tint (the mock's first reading), where a black shell over it does not.
 *
 * The bent geometry and the shell are built once per SOURCE geometry (`GunOutVariants`), shared by
 * every vehicle of a type with its gun out, and swapped onto the entity's own mesh. The template's
 * geometry is never touched, so a healthy twin is the shipped model, byte for byte.
 */
import * as THREE from 'three';
import { paletteHex } from '../palette-hex';
import { TURRET_RENDER_ORDER } from './render-order';
import type { VehicleMeshEntity } from './mesh-vehicle';

/** The lead's ruling: "ship the 14 degree barrel droop". */
export const GUN_OUT_DROOP_DEG = 14;
/** A barrel shorter than this (mesh units, 3 per tile) gets its whole mount tilted too. The Lavi's is 2.8, the Namer's 1.5. */
export const GUN_OUT_SHORT_BARREL = 2.0;
/** The extra pitch of a short gun's whole mount, degrees. */
export const GUN_OUT_MOUNT_TILT_DEG = 8;
/** The share of the barrel's length, from the muzzle back, that is charred (the mock's 30%, enlarged). */
export const GUN_OUT_SCORCH_FRAC = 0.4;
/** How far the char shell stands off the barrel, mesh units. */
export const GUN_OUT_SCORCH_INFLATE = 0.014;
/** The mesh that carries the barrel, by node name. */
export const GUN_OUT_MESH_NAME = 'turret_metal';
/** The palette key of the char. */
export const GUN_OUT_SCORCH_KEY = 'shadow.0';
/** The share of the barrel's first stretch averaged for the bend axis' height. */
const AXIS_STRETCH = 0.12;

export interface GunOutVariant {
  /** The turret metal with its barrel bent, same attributes and groups as the source. */
  readonly bent: THREE.BufferGeometry;
  /** The charred tip as its own geometry, or null if no triangle lay wholly in it. */
  readonly scorch: THREE.BufferGeometry | null;
  /** Where the barrel starts (mesh-local x). */
  readonly mantletX: number;
}

/** The front of the turret body: the largest x of the sibling turret meshes, else null. */
export function mantletXOf(siblings: readonly THREE.BufferGeometry[]): number | null {
  let best: number | null = null;
  for (const g of siblings) {
    g.computeBoundingBox();
    const bb = g.boundingBox;
    if (bb === null) continue;
    if (best === null || bb.max.x > best) best = bb.max.x;
  }
  return best;
}

/**
 * The bent geometry and the char shell for `src`, a `turret_metal` geometry. `mantletX` null (no
 * sibling turret mesh) falls back to 55% of the mesh's own forward span. Pure: `src` is read, never
 * written.
 */
export function buildGunOutVariant(src: THREE.BufferGeometry, mantletX: number | null): GunOutVariant {
  const g = src.clone();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const x0 = mantletX !== null && mantletX < maxX ? mantletX : minX + (maxX - minX) * 0.55;
  const len = maxX - x0;

  // The whole mount pitches first when the barrel is short (a roof gun reads nothing at 14 degrees alone).
  const tilt = len < GUN_OUT_SHORT_BARREL ? (-GUN_OUT_MOUNT_TILT_DEG * Math.PI) / 180 : 0;
  const tc = Math.cos(tilt);
  const ts = Math.sin(tilt);

  // The mantlet's own point: the barrel's first stretch, mean height. It rides the tilt with the mount, and it
  // is where the bend axis sits afterwards.
  let sy = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x >= x0 && x <= x0 + len * AXIS_STRETCH) {
      sy += pos.getY(i);
      n++;
    }
  }
  const ym = n > 0 ? sy / n : (minY + maxY) / 2;
  const mdx = x0 - minX;
  const mdy = ym - minY;
  const x0t = minX + mdx * tc - mdy * ts;
  const cy = minY + mdx * ts + mdy * tc;
  const lenT = Math.max(1e-6, maxX - x0) * tc;

  const droop = (-GUN_OUT_DROOP_DEG * Math.PI) / 180;
  const tOf = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let nx = nor ? nor.getX(i) : 0;
    let ny = nor ? nor.getY(i) : 0;
    if (tilt !== 0) {
      const dx = x - minX;
      const dy = y - minY;
      x = minX + dx * tc - dy * ts;
      y = minY + dx * ts + dy * tc;
      const rx = nx * tc - ny * ts;
      ny = nx * ts + ny * tc;
      nx = rx;
    }
    const t = len > 0 ? Math.min(1, Math.max(0, (x - x0t) / lenT)) : 0;
    tOf[i] = t;
    const e = t * t * (3 - 2 * t);
    const a = droop * e;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = x - x0t;
    const dy = y - cy;
    pos.setXYZ(i, x0t + dx * c - dy * s, cy + dx * s + dy * c, pos.getZ(i));
    if (nor) {
      const rx = nx * c - ny * s;
      ny = nx * s + ny * c;
      nor.setXYZ(i, rx, ny, nor.getZ(i));
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();

  return { bent: g, scorch: buildScorch(g, tOf), mantletX: x0 };
}

/** The triangles of `bent` lying wholly in the last `GUN_OUT_SCORCH_FRAC` of the barrel, inflated along their normals. */
function buildScorch(bent: THREE.BufferGeometry, tOf: Float32Array): THREE.BufferGeometry | null {
  const pos = bent.getAttribute('position');
  const nor = bent.getAttribute('normal');
  const index = bent.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const from = 1 - GUN_OUT_SCORCH_FRAC;
  const keep: number[] = [];
  for (let f = 0; f < triCount; f++) {
    const a = index ? index.getX(f * 3) : f * 3;
    const b = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const c = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    if (tOf[a] >= from && tOf[b] >= from && tOf[c] >= from) keep.push(a, b, c);
  }
  if (keep.length === 0) return null;
  const outPos = new Float32Array(keep.length * 3);
  const outNor = new Float32Array(keep.length * 3);
  for (let k = 0; k < keep.length; k++) {
    const v = keep[k];
    const nx = nor ? nor.getX(v) : 0;
    const ny = nor ? nor.getY(v) : 1;
    const nz = nor ? nor.getZ(v) : 0;
    outPos[k * 3] = pos.getX(v) + nx * GUN_OUT_SCORCH_INFLATE;
    outPos[k * 3 + 1] = pos.getY(v) + ny * GUN_OUT_SCORCH_INFLATE;
    outPos[k * 3 + 2] = pos.getZ(v) + nz * GUN_OUT_SCORCH_INFLATE;
    outNor[k * 3] = nx;
    outNor[k * 3 + 1] = ny;
    outNor[k * 3 + 2] = nz;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(outNor, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** One dark char material for every barrel (a palette key, never a raw hex). */
let scorchMaterial: THREE.MeshStandardMaterial | null = null;
function scorchMaterialShared(): THREE.MeshStandardMaterial {
  if (scorchMaterial === null) {
    scorchMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(paletteHex(GUN_OUT_SCORCH_KEY)), roughness: 0.95, metalness: 0 });
  }
  return scorchMaterial;
}

/** The variants for a whole renderer, one per source geometry. */
export class GunOutVariants {
  private readonly bySource = new Map<THREE.BufferGeometry, GunOutVariant>();

  variantFor(src: THREE.BufferGeometry, siblings: readonly THREE.BufferGeometry[]): GunOutVariant {
    let v = this.bySource.get(src);
    if (!v) {
      v = buildGunOutVariant(src, mantletXOf(siblings));
      this.bySource.set(src, v);
    }
    return v;
  }

  /** How many variants exist: what the memo is measured by. */
  get size(): number {
    return this.bySource.size;
  }

  dispose(): void {
    for (const v of this.bySource.values()) {
      v.bent.dispose();
      v.scorch?.dispose();
    }
    this.bySource.clear();
  }
}

/** Every mesh's own geometry from before the droop, so a repair puts it back. */
const originalGeometry = new WeakMap<THREE.Mesh, THREE.BufferGeometry>();
/** The char shell hung on a mesh. */
const shellOf = new WeakMap<THREE.Mesh, THREE.Mesh>();
/** Whether an entity is DRAWN with its gun out. */
const drawnGunOut = new WeakMap<VehicleMeshEntity, boolean>();

/** True if `entity` is drawn with its gun bent. */
export function vehicleGunOutDrawn(entity: VehicleMeshEntity): boolean {
  return drawnGunOut.get(entity) ?? false;
}

/** The live barrel meshes of an entity: `turret_metal` under its turret pivot, never a wreck twin or an outline. */
function barrelMeshes(entity: VehicleMeshEntity): { meshes: THREE.Mesh[]; siblings: THREE.BufferGeometry[] } {
  const meshes: THREE.Mesh[] = [];
  const siblings: THREE.BufferGeometry[] = [];
  entity.turretPivot?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.rl_wreck === true) return;
    if (m.name === GUN_OUT_MESH_NAME) meshes.push(m);
    else if (m.name.startsWith('turret_') && !m.name.endsWith('__silhouette') && !m.name.startsWith(`${GUN_OUT_MESH_NAME}_`)) {
      siblings.push(m.geometry);
    }
  });
  return { meshes, siblings };
}

/**
 * Draws `entity` with its gun bent (`on`) or as shipped. Idempotent: a call that changes nothing is
 * one WeakMap read. Returns whether any barrel was found (a hull with no `turret_metal` -- a jeep, a
 * rocket battery -- has no gun to bend and is left alone).
 */
export function applyGunOut(entity: VehicleMeshEntity, on: boolean, variants: GunOutVariants): boolean {
  if (vehicleGunOutDrawn(entity) === on) return false;
  const { meshes, siblings } = barrelMeshes(entity);
  drawnGunOut.set(entity, on);
  for (const mesh of meshes) {
    if (on) {
      const src = originalGeometry.get(mesh) ?? mesh.geometry;
      originalGeometry.set(mesh, src);
      const v = variants.variantFor(src, siblings);
      mesh.geometry = v.bent;
      if (v.scorch !== null && !shellOf.has(mesh)) {
        const shell = new THREE.Mesh(v.scorch, scorchMaterialShared());
        shell.name = `${GUN_OUT_MESH_NAME}__scorch`;
        shell.renderOrder = TURRET_RENDER_ORDER;
        shell.castShadow = false;
        shell.receiveShadow = false;
        mesh.add(shell);
        shellOf.set(mesh, shell);
      }
    } else {
      const src = originalGeometry.get(mesh);
      if (src) mesh.geometry = src;
      const shell = shellOf.get(mesh);
      if (shell) {
        mesh.remove(shell);
        shellOf.delete(mesh);
      }
    }
  }
  return meshes.length > 0;
}
