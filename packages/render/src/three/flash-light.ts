/**
 * The muzzle flash and blast "light" -- real `THREE.PointLight`s now.
 *
 * Under the palette pipeline this was a ramp-index shift baked into every
 * material's shader; a light could not be a light because nothing consumed
 * three.js lighting. Everything world-side is `MeshStandardMaterial` since
 * Phase 0, so an emitter's `light` block (`data/vfx/*.json`: `color`,
 * `intensity`, `radius_tiles`, `decay_ms`) drives a pooled point light.
 *
 * The pool is FIXED at `FLASH_CAPACITY` lights that are always in the scene:
 * three.js compiles the light COUNT into every shader, so toggling `visible`
 * per flash would recompile every material on the first shot of a fight.
 * Idle lights sit at intensity 0. Overflow evicts the oldest flash -- the
 * newest is what the player is looking at.
 */
import * as THREE from 'three';

export const FLASH_CAPACITY = 8;
/** Emitter `intensity` is 0.3-3.5 across `data/vfx/`; point-light intensity
 *  under physically correct lights is candela-ish, so a flash needs an order
 *  of magnitude more to read on a sunlit surface. Judged on screen. */
export const FLASH_INTENSITY_SCALE = 12;
/** World units above the ground the light sits: a rifle's muzzle height. */
export const FLASH_HEIGHT = 0.6;

export interface FlashLightSpec {
  color?: string;
  intensity?: number;
  radius_tiles?: number;
  decay_ms?: number;
}

interface ActiveFlash {
  x: number;
  y: number;
  z: number;
  peak: number;
  radius: number;
  decayMs: number;
  ageMs: number;
  color: THREE.Color;
}

export class FlashLightManager {
  readonly lights: readonly THREE.PointLight[];
  private readonly active: ActiveFlash[] = [];

  constructor(capacity = FLASH_CAPACITY) {
    this.lights = Array.from({ length: capacity }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 0.01, 2);
      light.castShadow = false;
      light.visible = true;
      return light;
    });
  }

  get liveCount(): number {
    return this.active.length;
  }

  addTo(scene: THREE.Object3D): void {
    for (const light of this.lights) scene.add(light);
  }

  spawn(x: number, z: number, groundY: number, spec: FlashLightSpec, colorHex: string): void {
    const decayMs = spec.decay_ms ?? 0;
    if (decayMs <= 0) return;
    const rounded = Math.round(spec.intensity ?? 0);
    if (rounded <= 0) return;
    if (this.active.length >= this.lights.length) this.active.shift();
    this.active.push({
      x,
      y: groundY + FLASH_HEIGHT,
      z,
      peak: (spec.intensity ?? 0) * FLASH_INTENSITY_SCALE,
      radius: Math.max(0.01, spec.radius_tiles ?? 0),
      decayMs,
      ageMs: 0,
      color: new THREE.Color(colorHex),
    });
  }

  /** Ages every flash, retires the finished ones, and writes the survivors
   *  into the pool. `sin(progress * PI)`: rise fast, peak at midlife, fall. */
  step(dtMs: number): void {
    for (const f of this.active) f.ageMs += dtMs;
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].ageMs >= this.active[i].decayMs) this.active.splice(i, 1);
    }
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const f = this.active[i];
      if (!f) {
        light.intensity = 0;
        continue;
      }
      const progress = Math.min(1, f.ageMs / f.decayMs);
      light.position.set(f.x, f.y, f.z);
      light.color.copy(f.color);
      light.distance = f.radius;
      light.intensity = f.peak * Math.sin(progress * Math.PI);
    }
  }

  dispose(): void {
    for (const light of this.lights) light.dispose();
    this.active.length = 0;
  }
}
