/**
 * The loud fallback for a unit whose GLB failed to load (WP-A3.3, the lead's
 * ruling 2: "a failed GLB must never draw an invisible unit silently").
 *
 * Until the billboard path was retired, a unit type with no mesh template
 * quietly drew its sprite sheet instead, so a GLB that 404'd or would not
 * parse cost a model and nothing else. With the sheets gone there is nothing
 * left to fall back to, and the honest failure would be a unit that is
 * selected, shot at and killed while drawing NOTHING -- the shape CLAUDE.md
 * records twice for `SPRITE_MAP` and once for civilians. So a failed type
 * draws this instead: a plain box in its side's team colour at the unit's own
 * footprint, ugly on purpose, beside a `console.error` naming the GLB
 * (`ThreeRenderer.noteMeshFailure`) and the HUD note `main.ts` already raises
 * for a failed mesh.
 *
 * This is NOT the not-yet-loaded state. A deferred KDF buildable whose GLB is
 * still in flight draws nothing until it lands (ruling 1); only a load that
 * has FAILED reaches this batch.
 *
 * One `InstancedMesh`, one draw call for every proxy on the map, grown in
 * powers of two. Sized from the same generated footprint tables the selection
 * ring reads (`readability.ts`), so a proxy covers the ground the real hull
 * would.
 */
import * as THREE from 'three';
import { ELLIPSE_BY_TYPE, ELLIPSE_PAD_TILES, ringRadiusFor, type RingClass } from './readability';
import { hexToLinear } from '../terrain/shared';
import { HULL_RENDER_ORDER } from './render-order';

/** Box size in tiles (= world units): half-extents along and across the
 *  heading, and the full height. */
export interface ProxyBoxDims {
  readonly halfAlong: number;
  readonly halfAcross: number;
  readonly height: number;
  /** Where the hull's centre sits along the heading from the unit's origin
   *  (the ring ellipse's own `offsetAlong`), so the box covers the hull. */
  readonly offsetAlong: number;
}

/** A man is ~1.8 m and a tile 3 m; a hull roughly 2.4 m. Air keeps the hull
 *  height -- its lift comes from the caller, as for a mesh. */
const HEIGHT_BY_CLASS: Readonly<Record<RingClass, number>> = { foot: 0.6, light: 0.7, armour: 0.8, air: 0.5 };

/** The box for a type: a ground vehicle's own hull half-extents (its ring
 *  ellipse less the ring's pad), else a square inside its ring circle. */
export function proxyBoxDims(typeId: string, cls: RingClass): ProxyBoxDims {
  const e = ELLIPSE_BY_TYPE[typeId];
  const height = HEIGHT_BY_CLASS[cls];
  if (e !== undefined) {
    return {
      halfAlong: Math.max(0.15, e.along - ELLIPSE_PAD_TILES),
      halfAcross: Math.max(0.15, e.across - ELLIPSE_PAD_TILES),
      height,
      offsetAlong: e.offsetAlong,
    };
  }
  const half = Math.max(0.15, ringRadiusFor(typeId, cls) * 0.7);
  return { halfAlong: half, halfAcross: half, height, offsetAlong: 0 };
}

/** One proxy this frame. `yaw` is radians about +Y, the mesh yaw a vehicle
 *  of this facing would take. */
export interface ProxyBoxEntry {
  readonly x: number;
  readonly groundY: number;
  readonly z: number;
  readonly yaw: number;
  readonly dims: ProxyBoxDims;
  readonly side: number;
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpColor = new THREE.Color();

export class ProxyBoxBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private teamLinear: readonly [number, number, number][];
  private capacity: number;

  constructor(scene: THREE.Scene, teamColors: readonly string[], initialCapacity = 8) {
    this.teamLinear = teamColors.map((c) => hexToLinear(c));
    // A unit cube whose base sits on y = 0, so `scale.y` is the height and
    // `position.y` is the ground.
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.geometry.translate(0, 0.5, 0);
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    this.capacity = Math.max(1, initialCapacity);
    this.mesh = this.makeMesh(this.capacity);
    scene.add(this.mesh);
  }

  private makeMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = 'unit-proxy-boxes';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.renderOrder = HULL_RENDER_ORDER;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    return mesh;
  }

  /** VR-01: a colour-vision change mid-mission. The next `update` writes
   *  every instance from these, so nothing else needs touching. */
  setTeamColors(teamColors: readonly string[]): void {
    this.teamLinear = teamColors.map((c) => hexToLinear(c));
  }

  /** How many boxes drew this frame (tests and the debug layer read it). */
  get count(): number {
    return this.mesh.count;
  }

  /** Rewrites every instance from scratch; `entries` is this frame's list. */
  update(entries: readonly ProxyBoxEntry[]): void {
    if (entries.length > this.capacity) {
      let next = this.capacity;
      while (next < entries.length) next *= 2;
      const parent = this.mesh.parent;
      const old = this.mesh;
      const grown = this.makeMesh(next);
      grown.visible = old.visible;
      parent?.remove(old);
      old.dispose();
      parent?.add(grown);
      (this as { mesh: THREE.InstancedMesh }).mesh = grown;
      this.capacity = next;
    }
    const colors = this.mesh.instanceColor;
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k];
      tmpPos.set(e.x, e.groundY, e.z);
      tmpQuat.setFromAxisAngle(UP, e.yaw);
      tmpScale.set(e.dims.halfAlong * 2, e.dims.height, e.dims.halfAcross * 2);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      this.mesh.setMatrixAt(k, tmpMatrix);
      const rgb = this.teamLinear[e.side] ?? this.teamLinear[1] ?? [1, 0, 1];
      tmpColor.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
      this.mesh.setColorAt(k, tmpColor);
    }
    this.mesh.count = entries.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colors) colors.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
