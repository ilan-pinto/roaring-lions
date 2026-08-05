import type { Graphics } from 'pixi.js';
import type { ParticleSpec, Range } from './emitters';

function pick(r: Range | undefined, fallback: number): number {
  if (r === undefined) return fallback;
  if (typeof r === 'number') return r;
  return r[0] + Math.random() * (r[1] - r[0]);
}

/** Sample a stepped curve. Stepped, not interpolated: interpolating palette
 *  colours would generate off-palette values the art gate rejects. */
function sampleStep<T>(curve: T[] | undefined, t: number, fallback: T): T {
  if (!curve || curve.length === 0) return fallback;
  const i = Math.min(curve.length - 1, Math.floor(t * curve.length));
  return curve[i];
}

/** Sample a numeric curve with linear interpolation across its whole span.
 *  Unlike sampleStep, this is for continuous ramps (alpha, size) rather than
 *  palette-quantised colours: stepping those makes every 2-entry fade snap
 *  instead of fading, and every growth curve only take effect for the
 *  invisible second half of a particle's life. */
function sampleLerp(curve: number[] | undefined, t: number, fallback: number): number {
  if (!curve || curve.length === 0) return fallback;
  if (curve.length === 1) return curve[0];
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const span = (curve.length - 1) * clamped;
  const i = Math.min(curve.length - 2, Math.floor(span));
  const frac = span - i;
  return curve[i] + (curve[i + 1] - curve[i]) * frac;
}

/**
 * Fixed-capacity particle pool in struct-of-arrays form.
 *
 * Weapon fire is the highest-frequency effect in the game, so this allocates
 * nothing per particle per frame. When the pool is full the lowest-priority
 * live particle is recycled, which is what budget_priority is for.
 */
export class ParticleSystem {
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly age: Float64Array;
  private readonly life: Float64Array;
  private readonly size: Float64Array;
  private readonly gravity: Float64Array;
  private readonly drag: Float64Array;
  private readonly priority: Uint8Array;
  private readonly alive: Uint8Array;
  /** Which draw layer a particle belongs to (0 = below units, 1 = above
   *  units). One shared pool, so priority-based eviction still competes
   *  across both layers rather than reserving capacity per layer. */
  private readonly layerIdx: Uint8Array;
  /** Resolved hex colours per particle, one ramp step per frame of life. */
  private readonly colors: string[][] = [];
  private readonly alphaCurve: (number[] | undefined)[] = [];
  private readonly sizeCurve: (number[] | undefined)[] = [];
  private readonly capacity: number;
  private readonly resolve: (key: string) => string;
  private liveCount = 0;

  constructor(capacity: number, resolve: (key: string) => string) {
    this.capacity = capacity;
    this.resolve = resolve;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.age = new Float64Array(capacity);
    this.life = new Float64Array(capacity);
    this.size = new Float64Array(capacity);
    this.gravity = new Float64Array(capacity);
    this.drag = new Float64Array(capacity);
    this.priority = new Uint8Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.layerIdx = new Uint8Array(capacity);
    this.colors.length = capacity;
    this.alphaCurve.length = capacity;
    this.sizeCurve.length = capacity;
  }

  get live(): number {
    return this.liveCount;
  }

  private freeSlot(priority: number): number {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) return i;
    }
    // Full: recycle the lowest-priority particle, and only if this one
    // outranks it. Otherwise the spawn is dropped.
    let worst = -1;
    let worstP = priority;
    for (let i = 0; i < this.capacity; i++) {
      if (this.priority[i] < worstP) {
        worstP = this.priority[i];
        worst = i;
      }
    }
    return worst;
  }

  /**
   * Emit one particle layer. `magnitude` is firePower's 0..1 output: it
   * scales count and size so a 120mm reads bigger than a coax MG without
   * needing its own emitter. `layerIdx` selects which draw call later
   * picks this particle up — the pool itself is not split by layer, so
   * priority-based eviction still competes globally.
   */
  spawn(
    spec: ParticleSpec,
    x: number,
    y: number,
    dirTurns: number,
    magnitude: number,
    priority: number,
    layerIdx: number
  ): void {
    const scale = 0.75 + magnitude * 1.25;
    const n = Math.max(1, Math.round(pick(spec.count, 1) * (0.5 + magnitude * 0.9)));
    const coneRad = ((spec.cone_deg ?? 360) * Math.PI) / 180;
    const dirRad = dirTurns * Math.PI * 2;
    const resolved = spec.color_over_life.map((k) => this.resolve(k));

    for (let k = 0; k < n; k++) {
      const i = this.freeSlot(priority);
      if (i < 0) return;
      if (this.alive[i] === 0) this.liveCount++;
      const a = dirRad + (Math.random() - 0.5) * coneRad;
      const speed = pick(spec.speed_tiles_s, 0);
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed;
      this.age[i] = 0;
      this.life[i] = pick(spec.lifetime_ms, 200) / 1000;
      this.size[i] = pick(spec.size_px, 6) * scale;
      this.gravity[i] = spec.gravity_tiles_s2 ?? 0;
      this.drag[i] = spec.drag ?? 0;
      this.priority[i] = priority;
      this.layerIdx[i] = layerIdx;
      this.alive[i] = 1;
      this.colors[i] = resolved;
      this.alphaCurve[i] = spec.alpha_over_life;
      this.sizeCurve[i] = spec.size_over_life;
    }
  }

  step(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.alive[i] = 0;
        this.liveCount--;
        continue;
      }
      const d = 1 - this.drag[i] * dt;
      this.vx[i] *= d;
      this.vy[i] *= d;
      this.vy[i] += this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  /** Draws only particles spawned with the matching `layerIdx`, so callers
   *  can render below-unit and above-unit effects onto separate Graphics
   *  in the correct order relative to unit sprites. */
  draw(
    g: Graphics,
    isoX: (x: number, y: number) => number,
    isoY: (x: number, y: number) => number,
    layerIdx: number
  ): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0 || this.layerIdx[i] !== layerIdx) continue;
      const t = this.age[i] / this.life[i];
      const color = sampleStep(this.colors[i], t, '#FFFFFF');
      const alpha = sampleLerp(this.alphaCurve[i], t, 1 - t);
      const sizeMul = sampleLerp(this.sizeCurve[i], t, 1);
      const r = this.size[i] * sizeMul;
      if (r <= 0 || alpha <= 0) continue;
      g.circle(isoX(this.x[i], this.y[i]), isoY(this.x[i], this.y[i]) - 3, r).fill({ color, alpha });
    }
  }
}
