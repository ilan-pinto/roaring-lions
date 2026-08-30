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
 * A `spawn()` call whose spec set `emit_over_ms` and has particles still
 * owed to it. `step()` trickles `spawnOne` calls out of this list instead of
 * `spawn()` placing the whole count at once -- the mechanism `emit_over_ms`
 * needed and never had (it validated, typechecked, and was read by nothing).
 *
 * A plain array of small objects, not struct-of-arrays: unlike per-particle
 * state this is bounded by the number of *sustained emitters alive at once*
 * (a handful -- a burning wreck, a collapsing building), not by particle
 * count, so it is nowhere near the per-frame budget the pool itself has to
 * respect.
 */
interface PendingEmission {
  spec: ParticleSpec;
  x: number;
  y: number;
  dirRad: number;
  coneRad: number;
  scale: number;
  resolved: string[];
  priority: number;
  layerIdx: number;
  velX: number;
  velY: number;
  /** Total particles this emission owes, computed once at spawn() time --
   *  the same `pick(count) * (0.5 + magnitude*0.9)` burst has always used. */
  total: number;
  /** How many of `total` have been handed to spawnOne so far, including any
   *  that spawnOne dropped for a full pool -- a starved slot is not retried,
   *  matching the burst path's existing drop-on-full behaviour exactly. */
  spawned: number;
  elapsedMs: number;
  durationMs: number;
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
  /** Sustained (`emit_over_ms`) emissions still owed particles. See
   *  `PendingEmission`'s own doc comment. */
  private readonly pending: PendingEmission[] = [];

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
   *
   * `velX`/`velY` are the emitting entity's own world-space velocity in
   * tiles/s, both defaulting to 0 -- every call site today omits them, so
   * `spec.inherit_velocity` (a 0..1 fraction) blends in exactly nothing
   * until a caller starts passing real motion. That is a caller-side gap
   * once outside this file's scope, not a bug in the blend itself; see the
   * VFX dead-fields report for the constraint that keeps it that way.
   *
   * `spec.emit_over_ms` (absent or 0) is the burst path: every particle is
   * placed the instant this call returns, unchanged from before this field
   * existed. `> 0` spreads the remaining particles across that many
   * milliseconds via `pending`/`step()` -- the first particle still lands
   * immediately, so a sustained effect never has a silent gap at its start.
   */
  spawn(
    spec: ParticleSpec,
    x: number,
    y: number,
    dirTurns: number,
    magnitude: number,
    priority: number,
    layerIdx: number,
    velX = 0,
    velY = 0
  ): void {
    const scale = 0.75 + magnitude * 1.25;
    const n = Math.max(1, Math.round(pick(spec.count, 1) * (0.5 + magnitude * 0.9)));
    const coneRad = ((spec.cone_deg ?? 360) * Math.PI) / 180;
    const dirRad = dirTurns * Math.PI * 2;
    const resolved = spec.color_over_life.map((k) => this.resolve(k));
    const emitOverMs = spec.emit_over_ms ?? 0;

    // The first particle always lands now, burst or sustained alike -- a
    // sustained emitter with a 900ms window must not read as "nothing for
    // the first frame".
    this.spawnOne(spec, x, y, dirRad, coneRad, scale, resolved, priority, layerIdx, velX, velY);

    if (emitOverMs <= 0 || n <= 1) {
      // Burst path, byte-for-byte the loop this always was: same per-particle
      // work (spawnOne), same order, same count.
      for (let k = 1; k < n; k++) {
        this.spawnOne(spec, x, y, dirRad, coneRad, scale, resolved, priority, layerIdx, velX, velY);
      }
      return;
    }

    this.pending.push({
      spec,
      x,
      y,
      dirRad,
      coneRad,
      scale,
      resolved,
      priority,
      layerIdx,
      velX,
      velY,
      total: n,
      spawned: 1,
      elapsedMs: 0,
      durationMs: emitOverMs,
    });
  }

  /** Places exactly one particle from `spec` into a free (or reclaimed) pool
   *  slot. The entire per-particle body `spawn()`'s burst loop always ran,
   *  now shared with the `emit_over_ms` trickle in `step()` so the two paths
   *  cannot compute a particle's look differently. */
  private spawnOne(
    spec: ParticleSpec,
    x: number,
    y: number,
    dirRad: number,
    coneRad: number,
    scale: number,
    resolved: string[],
    priority: number,
    layerIdx: number,
    velX: number,
    velY: number
  ): void {
    const i = this.freeSlot(priority);
    if (i < 0) return;
    if (this.alive[i] === 0) this.liveCount++;
    const a = dirRad + (Math.random() - 0.5) * coneRad;
    const speed = pick(spec.speed_tiles_s, 0);
    const inherit = spec.inherit_velocity ?? 0;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = Math.cos(a) * speed + velX * inherit;
    this.vy[i] = Math.sin(a) * speed + velY * inherit;
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

    // Trickle sustained emissions. Iterated back-to-front so a finished
    // entry can be spliced out in place without disturbing the next index.
    for (let p = this.pending.length - 1; p >= 0; p--) {
      const e = this.pending[p];
      e.elapsedMs += dt * 1000;
      const t = Math.min(1, e.elapsedMs / e.durationMs);
      const due = Math.min(e.total, Math.round(t * e.total));
      while (e.spawned < due) {
        this.spawnOne(e.spec, e.x, e.y, e.dirRad, e.coneRad, e.scale, e.resolved, e.priority, e.layerIdx, e.velX, e.velY);
        e.spawned++;
      }
      if (e.spawned >= e.total) this.pending.splice(p, 1);
    }
  }

  /**
   * Backend-agnostic read path: visits every live particle on `layerIdx` and
   * hands the callback its drawable state -- world position, the colour and
   * alpha already sampled off that particle's curves for its current age,
   * and its current radius. No graphics library is named anywhere in this
   * signature (plain numbers and a string), so a three.js caller can build
   * instance-buffer writes directly from it.
   *
   * This applies the exact same skips `draw()` used to apply inline: a slot
   * that is not `alive`, or not on the requested `layerIdx`, is never
   * visited; one whose sampled radius or alpha has collapsed to zero or
   * below is visited by neither this nor `draw()` -- `sampleStep`/
   * `sampleLerp` are the one place curve sampling happens, so the two
   * backends cannot sample a palette-quantised colour or an alpha ramp
   * differently.
   *
   * Callback takes flat arguments rather than an object: this method runs
   * over up to `capacity` particles a frame (weapon fire is the
   * highest-frequency effect in the game), and the class-level contract
   * above -- "allocates nothing per particle per frame" -- has to hold for
   * this accessor exactly as it holds for `spawn`/`step`, or a three.js
   * caller adopting it inherits a GC-pressure regression `draw()` never had.
   */
  forEachLive(
    layerIdx: number,
    cb: (x: number, y: number, color: string, alpha: number, radius: number) => void
  ): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0 || this.layerIdx[i] !== layerIdx) continue;
      const t = this.age[i] / this.life[i];
      const color = sampleStep(this.colors[i], t, '#FFFFFF');
      const alpha = sampleLerp(this.alphaCurve[i], t, 1 - t);
      const sizeMul = sampleLerp(this.sizeCurve[i], t, 1);
      const r = this.size[i] * sizeMul;
      if (r <= 0 || alpha <= 0) continue;
      cb(this.x[i], this.y[i], color, alpha, r);
    }
  }

  /** Draws only particles spawned with the matching `layerIdx`, so callers
   *  can render below-unit and above-unit effects onto separate Graphics
   *  in the correct order relative to unit sprites.
   *
   *  Expressed entirely in terms of `forEachLive` -- there is no second copy
   *  of the curve-sampling or skip logic here, so this and the read path
   *  cannot diverge. */
  draw(
    g: Graphics,
    isoX: (x: number, y: number) => number,
    isoY: (x: number, y: number) => number,
    layerIdx: number
  ): void {
    this.forEachLive(layerIdx, (x, y, color, alpha, r) => {
      g.circle(isoX(x, y), isoY(x, y) - 3, r).fill({ color, alpha });
    });
  }
}
