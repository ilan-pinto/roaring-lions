/**
 * GH-748: the air strike's ground shock ring -- a flat additive annulus that
 * races out from the detonation to `radiusTiles` over `durationMs` and fades.
 *
 * A small fixed pool of meshes, always in the scene and hidden when idle, so a
 * strike never allocates. Aged on the FRAME clock (`step(dtMs)`), like the
 * flash lights it accompanies: it is a one-shot burst, not world state.
 *
 * The `support-blast` debug layer hides the pool through a FLAG `step`
 * consults, since `step` writes each mesh's `visible` every frame.
 */
import * as THREE from 'three';
import { FX_RENDER_ORDER_ADDITIVE } from './render-order';

export const SHOCK_RING_CAPACITY = 4;
/** World-Y above the ground, so the ring never z-fights the decals. */
const SHOCK_RING_LIFT = 0.04;
/** The annulus' width as a fraction of its current radius. */
const SHOCK_RING_WIDTH = 0.22;

/** The ring's radius and opacity at `ageMs`: ease-out growth, linear fade. */
export function shockRingState(ageMs: number, durationMs: number, radiusTiles: number): { radius: number; opacity: number } | null {
  if (!(durationMs > 0) || ageMs < 0 || ageMs >= durationMs) return null;
  const k = ageMs / durationMs;
  const grow = 1 - (1 - k) * (1 - k);
  return { radius: Math.max(0.05, radiusTiles * grow), opacity: 0.75 * (1 - k) };
}

interface Ring {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  ageMs: number;
  durationMs: number;
  radiusTiles: number;
}

export class ShockRingPool {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.RingGeometry(1 - SHOCK_RING_WIDTH, 1, 48, 1);
  private readonly rings: Ring[] = [];
  private next = 0;
  private debugHidden = false;

  constructor(color: THREE.ColorRepresentation, capacity = SHOCK_RING_CAPACITY) {
    this.group.name = 'shock-rings';
    this.geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = FX_RENDER_ORDER_ADDITIVE;
      this.group.add(mesh);
      this.rings.push({ mesh, material, ageMs: 0, durationMs: 0, radiusTiles: 0 });
    }
  }

  spawn(x: number, groundY: number, z: number, radiusTiles: number, durationMs: number): void {
    const r = this.rings[this.next];
    this.next = (this.next + 1) % this.rings.length;
    r.ageMs = 0;
    r.durationMs = durationMs;
    r.radiusTiles = radiusTiles;
    r.mesh.position.set(x, groundY + SHOCK_RING_LIFT, z);
    this.write(r);
  }

  /** Live rings (a harness and test read). */
  get liveCount(): number {
    let n = 0;
    for (const r of this.rings) if (shockRingState(r.ageMs, r.durationMs, r.radiusTiles)) n++;
    return n;
  }

  step(dtMs: number): void {
    for (const r of this.rings) {
      if (r.durationMs > 0) r.ageMs += dtMs;
      this.write(r);
    }
  }

  setDebugHidden(hidden: boolean): void {
    this.debugHidden = hidden;
    for (const r of this.rings) this.write(r);
  }

  private write(r: Ring): void {
    const s = shockRingState(r.ageMs, r.durationMs, r.radiusTiles);
    if (s === null) {
      r.mesh.visible = false;
      r.durationMs = 0;
      return;
    }
    r.mesh.visible = !this.debugHidden;
    r.mesh.scale.set(s.radius, 1, s.radius);
    r.material.opacity = s.opacity;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const r of this.rings) r.material.dispose();
  }
}
