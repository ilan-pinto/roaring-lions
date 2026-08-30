/**
 * The muzzle-flash "light": a bounded pool of transient ramp-index shifts,
 * shared by every registered `toonRampMaterial`/`toonRampSkinnedMaterial`/
 * terrain-material instance. See `./palette-material.ts`'s own doc comment
 * ("The muzzle-flash 'light'") for why this is an index shift and not a
 * `THREE.PointLight` or additive RGB, and for `FLASH_CAPACITY`'s own budget
 * reasoning.
 *
 * Pure aside from the `register()` method's own material-uniform wiring --
 * `spawn`/`step` touch nothing GPU-facing, so this is exercised directly in
 * `environment: 'node'` the same way `units/fx.ts`'s pure half is (`THREE.
 * Vector2` needs no WebGL/DOM, only `THREE.ShaderMaterial` construction and
 * actual rendering do).
 *
 * Invariant 4: this is presentation state fed by ALREADY-EMITTED sim events
 * (`onFire` in `ThreeRenderer.ts` calls `spawn` from an `EmitterSpec.light`
 * it already reads for particles) -- it reads sim-derived data and writes
 * nothing back, exactly like every other VFX consumer in this backend.
 */
import * as THREE from 'three';
import { FLASH_CAPACITY } from './palette-material';

/** The `light` sub-object shape this manager consumes -- `EmitterSpec`'s own
 *  field (`../vfx/emitters.ts`), narrowed to what `spawn` reads so this file
 *  does not need to import the whole emitter type. */
export interface FlashLightSpec {
  intensity?: number;
  radius_tiles?: number;
  decay_ms?: number;
}

/**
 * Ramp steps a flash shifts by AT FULL STRENGTH (the peak of its own
 * `sin(progress * PI)` curve, `step`'s own doc comment) -- `round(intensity)`
 * clamped to this. Half of `RAMP_MAX` (9): a shipped `fire_apfsds`/
 * `catastrophic_kill` (`intensity` 3.5-3.8, the two brightest of the eight
 * declarations) round to exactly this cap, reading as a strong, unmistakable
 * pop without collapsing every ramp to its single lightest entry regardless
 * of how many bands it actually has.
 */
const MAX_SHIFT_STEPS = 4;

interface ActiveFlash {
  x: number;
  y: number;
  radiusTiles: number;
  /** `round(intensity)`, clamped to `[1, MAX_SHIFT_STEPS]` -- `spawn` never
   *  stores a flash whose rounded intensity is 0 (see its own doc comment). */
  maxShift: number;
  decayMs: number;
  ageMs: number;
}

export class FlashLightManager {
  private readonly flashes: ActiveFlash[] = [];
  private readonly capacity: number;
  /** World-space (x, z) centre per slot -- shared BY REFERENCE with every
   *  registered material's `uFlashPos.value` (`register` below), so mutating
   *  these in place (`step`) updates every material with no per-material
   *  write loop. Unused slots (beyond `flashes.length`) sit far off any
   *  authored map (`1e6`), matching `defaultFlashUniforms`'s own inert
   *  default. */
  readonly posArray: THREE.Vector2[];
  readonly radiusArray: number[];
  readonly shiftArray: number[];

  constructor(capacity = FLASH_CAPACITY) {
    this.capacity = capacity;
    this.posArray = Array.from({ length: capacity }, () => new THREE.Vector2(1e6, 1e6));
    this.radiusArray = new Array(capacity).fill(0);
    this.shiftArray = new Array(capacity).fill(0);
  }

  /**
   * Spawns one flash at `(x, y)` (game tile coordinates, which this backend
   * maps 1:1 onto world X/Z -- see `palette-material.ts`'s `FLASH_SHIFT_GLSL`
   * doc comment) from an `EmitterSpec.light`. A no-op when `decay_ms` is
   * absent/zero (nothing to animate) or when `round(intensity)` rounds to 0
   * -- `cigarette_ember`'s declared `intensity: 0.3` is the one shipped
   * emitter this excludes: reading `light` now does not mean every
   * declaration becomes visible, and a light this faint genuinely should not
   * move a toon band by a whole step. Over capacity, drops the OLDEST active
   * flash before pushing the new one -- the identical "keep what the player
   * is looking at" reasoning `units/fx.ts`'s `writeTracerInstances` already
   * uses for tracer overflow.
   */
  spawn(x: number, y: number, light: FlashLightSpec): void {
    const decayMs = light.decay_ms ?? 0;
    if (decayMs <= 0) return;
    const maxShift = Math.min(MAX_SHIFT_STEPS, Math.round(light.intensity ?? 0));
    if (maxShift <= 0) return;
    if (this.flashes.length >= this.capacity) this.flashes.shift();
    this.flashes.push({ x, y, radiusTiles: Math.max(0, light.radius_tiles ?? 0), maxShift, decayMs, ageMs: 0 });
  }

  /**
   * Ages every active flash by `dtMs`, retires any past its own `decay_ms`,
   * and rewrites `posArray`/`radiusArray`/`shiftArray` in place from what
   * remains -- called once a frame from `ThreeRenderer.frame()`, mirroring
   * `ParticleSystem.step`'s own per-frame shape.
   *
   * `sin(progress * PI)` (progress = ageMs / decayMs, clamped [0, 1]) is the
   * intensity curve, not a linear fade -- rises from 0, peaks at the flash's
   * own midlife, falls back to 0, "grow fast, shrink out" rather than
   * starting at full brightness and ticking down. `shiftArray[i]` is that
   * curve's value at THIS frame, ROUNDED to a whole ramp step (not
   * interpolated) -- the spatial falloff is already stepped (inside `radius`
   * or not, `flashShiftSteps` in the shared GLSL), and rounding the temporal
   * curve too keeps every sampled fragment colour an exact `uRamp` entry at
   * every instant, provable by direct pixel comparison against
   * `data/palette.json` rather than merely argued.
   */
  step(dtMs: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.ageMs += dtMs;
      if (f.ageMs >= f.decayMs) this.flashes.splice(i, 1);
    }
    for (let i = 0; i < this.capacity; i++) {
      const f = this.flashes[i];
      if (!f) {
        this.radiusArray[i] = 0;
        this.shiftArray[i] = 0;
        continue;
      }
      const progress = Math.min(1, f.ageMs / f.decayMs);
      const strength = Math.sin(progress * Math.PI);
      this.posArray[i].set(f.x, f.y);
      this.radiusArray[i] = f.radiusTiles;
      this.shiftArray[i] = Math.round(strength * f.maxShift);
    }
  }

  /**
   * Points `material`'s `uFlash*` uniforms at THIS manager's own live
   * arrays, by reference -- after this call, `step()` alone keeps `material`
   * current with no further per-material write. Safe to call more than once
   * on the same material (idempotent: re-pointing at the same arrays is a
   * no-op in effect) and safe on a material this manager never spawns a
   * flash near (its slot values simply never move off their inert default).
   *
   * Requires `material` to have been built with `defaultFlashUniforms()`
   * (`toonRampMaterial`, `toonRampSkinnedMaterial`, and the terrain
   * material all are) -- narrowed to a structural shape rather than
   * `THREE.ShaderMaterial` so a test fixture needs no full material.
   */
  register(material: { uniforms: Record<string, { value: unknown }> }): void {
    material.uniforms.uFlashPos.value = this.posArray;
    material.uniforms.uFlashRadius.value = this.radiusArray;
    material.uniforms.uFlashShift.value = this.shiftArray;
  }

  /** Test/debug hook: how many flashes are currently alive. */
  get liveCount(): number {
    return this.flashes.length;
  }
}
