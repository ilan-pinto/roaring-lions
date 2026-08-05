# Weapon-fire VFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every weapon class produce a distinct muzzle signature, scaled by how powerful the shot is, so a player can tell a rifle from a shell from a mortar at a glance.

**Architecture:** The `fire` event already carries `weaponId`; the renderer looks up `WeaponStats` on the shooter's `UnitType` to get `cls` and the stats behind a power scalar. Weapon class selects a JSON emitter from `data/vfx/`, the scalar sets its magnitude. Emitters are loaded in `@lions/data`, passed into the renderer by the app, and played by a new particle system — mirroring exactly how `audio.ts` already handles per-weapon-class sound.

**Tech Stack:** TypeScript strict, PixiJS 8, Vitest, AJV (data gate), pnpm workspaces.

## Global Constraints

- **No sim changes.** Nothing in this plan touches `packages/sim`. `pnpm test:determinism` must pass with an unchanged hash after every task.
- **Dependency direction is `app → render → sim`, `data` is a leaf.** `@lions/render` depends only on `@lions/sim` and `pixi.js`. It must NOT import `@lions/data`. Emitter JSON is loaded in `data`, imported by `app`, and handed to the renderer — the same route `audioManifest` already takes.
- **TypeScript strict. No `any`.**
- **Palette keys only in VFX JSON, never raw hex.** The schema enforces `^[a-z_]+\.[a-z0-9_]+$`. Available: `vfx.white_hot`, `vfx.fire`, `vfx.ember`, `vfx.interceptor`, `vfx.tracer`, and ramps `limestone`/`dust`/`olive`/`gunmetal`/`shadow`/`scrub`/`water` indexed numerically (e.g. `dust.3`).
- **`vfx_emitter.schema.json` has `additionalProperties: false`** at the emitter level and on `particle_layer`. Any new field must be added to the schema or validation fails.
- **Struct-of-arrays in anything per-frame.** No per-particle object allocation per frame.
- Every task ends green on: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:determinism`, `pnpm validate:data`.

---

## Refinements to the spec

Two things discovered while reading the code, both deliberate deviations:

1. **`weapon_classes` (plural array), not `weapon_class` (singular).** The audio manifest already uses `weapon_classes: string[]` for exactly this purpose (`audio.ts:100`). Matching it keeps one convention, and lets a single emitter serve both `atgm` and `rpg`, which share a backblast character.

2. **A `vfx/` directory rather than one `vfx.ts`.** The spec said one module to keep it out of `renderer.ts`. Three focused files serve that intent better and stay individually reviewable.

## File structure

| File | Responsibility |
|---|---|
| `data/schemas/vfx_emitter.schema.json` | Modify: add `weapon_classes` |
| `data/vfx/fire_*.json` | Create: eight emitters, one per weapon character |
| `packages/data/src/index.ts` | Modify: export `vfxEmitters` |
| `packages/render/src/vfx/power.ts` | Create: `firePower()` — pure, no Pixi |
| `packages/render/src/vfx/power.test.ts` | Create: ordering, clamping, degenerate input |
| `packages/render/src/vfx/emitters.ts` | Create: `EmitterLibrary` — index by class, fallback |
| `packages/render/src/vfx/emitters.test.ts` | Create: indexing and fallback |
| `packages/render/src/vfx/particles.ts` | Create: `ParticleSystem` — SoA pools |
| `packages/render/src/vfx/index.ts` | Create: re-exports |
| `packages/render/src/renderer.ts` | Modify: spawn on `fire`, scale recoil by power |
| `packages/app/src/main.ts` | Modify: pass emitters to the renderer |

---

### Task 1: Add `weapon_classes` to the emitter schema

**Files:**
- Modify: `data/schemas/vfx_emitter.schema.json`

**Interfaces:**
- Consumes: nothing.
- Produces: emitter JSON may carry `weapon_classes: string[]`. Tasks 3 and 5 rely on it.

- [ ] **Step 1: Confirm the gate currently rejects the new field**

Create a scratch file `data/vfx/_probe.json`:

```json
{
  "id": "_probe",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["small_arms"],
  "particles": [
    { "count": 1, "lifetime_ms": 100, "color_over_life": ["vfx.fire"] }
  ]
}
```

Run: `pnpm validate:data`
Expected: FAIL, complaining about an additional property `weapon_classes`.

- [ ] **Step 2: Add the property to the schema**

In `data/schemas/vfx_emitter.schema.json`, inside the top-level `properties` object, add:

```json
"weapon_classes": {
  "type": "array",
  "minItems": 1,
  "uniqueItems": true,
  "description": "Weapon classes this emitter serves, matched against WEAPON_CLASS in @lions/sim. Only meaningful when trigger is weapon_fire. Mirrors the audio manifest's weapon_classes field so presentation uses one vocabulary.",
  "items": {
    "type": "string",
    "enum": [
      "apfsds", "heat", "he", "atgm", "rpg", "small_arms",
      "hmg", "autocannon", "mortar", "rocket", "interceptor", "demolition"
    ]
  }
}
```

- [ ] **Step 3: Verify the gate now accepts it**

Run: `pnpm validate:data`
Expected: PASS.

- [ ] **Step 4: Verify a bad class is still rejected**

Change `_probe.json`'s `weapon_classes` to `["not_a_weapon"]`.
Run: `pnpm validate:data`
Expected: FAIL on the enum.

- [ ] **Step 5: Remove the probe and confirm green**

```bash
rm data/vfx/_probe.json
pnpm validate:data
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/vfx_emitter.schema.json
git commit -m "feat(data): emitters can declare the weapon classes they serve"
```

---

### Task 2: The power scalar

**Files:**
- Create: `packages/render/src/vfx/power.ts`
- Create: `packages/render/src/vfx/power.test.ts`

**Interfaces:**
- Consumes: `WeaponStats` and `fx` from `@lions/sim`.
- Produces: `firePower(w: WeaponStats): number` returning 0..1. Tasks 4 and 6 call it.

**Background the implementer needs:** `WeaponStats` fields are Q16.16 fixed-point ints — convert with `fx.toNumber()`. It exposes `suppPerMiss`, not the raw `suppression` from JSON: the sim divides by `SUPP_STAT_DIVISOR = 700`, which is not re-exported from `@lions/sim`'s index. So the spec's `2 × suppression` term becomes `1400 × suppPerMiss`, folding the constant in.

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/vfx/power.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { firePower } from './power';

/** Minimal WeaponStats stand-in — firePower only reads these four fields. */
function w(penetration: number, damage: number, splash: number, suppression: number) {
  return {
    id: 'test',
    cls: 0,
    range: 0, rangeSq: 0, effectiveRange: 0, effectiveRangeSq: 0, minRangeSq: 0,
    accuracy: 0,
    penetration: fx.from(penetration),
    damage: fx.from(damage),
    splash: fx.from(splash),
    suppPerMiss: fx.div(fx.from(suppression), fx.fromInt(700)),
    ticksBetweenShots: 1,
    collateralRisk: 0,
  };
}

// The real roster, so the test fails if tuning drifts away from the design.
const GUN_120 = w(1300, 520, 0, 40);
const MORTAR_82 = w(35, 200, 2.0, 95);
const CANNON_30 = w(120, 90, 0, 45);
const COAX_MG = w(20, 35, 0, 60);
const RIFLES = w(8, 15, 0, 50);
const CARBINES = w(8, 12, 0, 40);

describe('firePower', () => {
  it('ranks a tank gun above a mortar above an MG above rifles', () => {
    expect(firePower(GUN_120)).toBeGreaterThan(firePower(MORTAR_82));
    expect(firePower(MORTAR_82)).toBeGreaterThan(firePower(COAX_MG));
    expect(firePower(COAX_MG)).toBeGreaterThan(firePower(RIFLES));
  });

  it('puts a mortar above an autocannon that out-penetrates it', () => {
    // The composite's whole purpose: penetration alone would rank these the
    // other way round, and it would be wrong to.
    expect(fx.toNumber(CANNON_30.penetration)).toBeGreaterThan(fx.toNumber(MORTAR_82.penetration));
    expect(firePower(MORTAR_82)).toBeGreaterThan(firePower(CANNON_30));
  });

  it('spans the roster across the full 0..1 range', () => {
    expect(firePower(GUN_120)).toBeCloseTo(1, 2);
    expect(firePower(CARBINES)).toBeCloseTo(0, 2);
  });

  it('clamps beyond the roster instead of exceeding 0..1', () => {
    expect(firePower(w(99999, 99999, 50, 200))).toBe(1);
    expect(firePower(w(0, 0, 0, 0))).toBe(0);
  });

  it('returns a finite number for a zero-stat weapon', () => {
    const p = firePower(w(0, 0, 0, 0));
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/render/src/vfx/power.test.ts`
Expected: FAIL — cannot resolve `./power`.

- [ ] **Step 3: Write the implementation**

Create `packages/render/src/vfx/power.ts`:

```ts
import { fx, type WeaponStats } from '@lions/sim';

/**
 * How big an event a shot is, 0..1 — the magnitude knob behind every
 * weapon-fire effect.
 *
 * The blend is deliberate. Penetration alone ranks by armour defeat, which
 * gets indirect fire backwards: a 30mm autocannon (penetration 120) would
 * outrank an 82mm mortar (penetration 35), when the mortar is by far the
 * louder event. Splash and suppression carry the weight mortars actually
 * have, and the composite puts the mortar above the autocannon.
 */
const SPLASH_WEIGHT = 300;
/** 2 x raw suppression. WeaponStats carries suppPerMiss, which the sim has
 *  already divided by SUPP_STAT_DIVISOR (700); that constant is not exported,
 *  so it is folded in here: 2 * 700. */
const SUPP_WEIGHT = 1400;

/** Roster extremes: carbines sit at 100, a 120mm APFSDS at 1900. Fixed rather
 *  than derived, so adding one large gun cannot silently resize every
 *  existing effect. Anything outside clamps. */
const WEIGHT_MIN = 100;
const WEIGHT_MAX = 1900;
const LOG_MIN = Math.log(WEIGHT_MIN);
const LOG_SPAN = Math.log(WEIGHT_MAX) - LOG_MIN;

export function firePower(w: WeaponStats): number {
  const weight =
    fx.toNumber(w.penetration) +
    fx.toNumber(w.damage) +
    SPLASH_WEIGHT * fx.toNumber(w.splash) +
    SUPP_WEIGHT * fx.toNumber(w.suppPerMiss);
  if (weight <= WEIGHT_MIN) return 0;
  // Log-compressed: raw weight spans roughly nineteenfold across the roster.
  const p = (Math.log(weight) - LOG_MIN) / LOG_SPAN;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/render/src/vfx/power.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the whole suite and the sim are untouched**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm test:determinism
```
Expected: all pass, determinism hash unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/render/src/vfx/power.ts packages/render/src/vfx/power.test.ts
git commit -m "feat(render): weapon power scalar drives shot magnitude"
```

---

### Task 3: Emitter library

**Files:**
- Create: `packages/render/src/vfx/emitters.ts`
- Create: `packages/render/src/vfx/emitters.test.ts`
- Create: `packages/render/src/vfx/index.ts`

**Interfaces:**
- Consumes: `WEAPON_CLASS` from `@lions/sim`.
- Produces:
  - `interface EmitterSpec` — the typed shape of one emitter JSON.
  - `interface ParticleSpec` — one entry in `EmitterSpec.particles`.
  - `type Range = number | [number, number]`
  - `class EmitterLibrary` with `useEmitters(list: EmitterSpec[]): void` and `fireEmitterFor(cls: number): EmitterSpec | null`.

  Task 4 consumes `ParticleSpec`; Task 6 calls `fireEmitterFor`.

**Background:** this mirrors `AudioManager.useManifest` (`audio.ts:94`) — the app owns loading, the render package owns indexing. `render` must not import `@lions/data`.

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/vfx/emitters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import { EmitterLibrary, type EmitterSpec } from './emitters';

const spec = (id: string, classes: string[]): EmitterSpec => ({
  id,
  trigger: 'weapon_fire',
  layer: 'above_units',
  weapon_classes: classes,
  particles: [{ count: 1, lifetime_ms: 100, color_over_life: ['vfx.fire'] }],
});

describe('EmitterLibrary', () => {
  it('indexes an emitter under every class it declares', () => {
    const lib = new EmitterLibrary();
    lib.useEmitters([spec('fire_missile', ['atgm', 'rpg'])]);
    expect(lib.fireEmitterFor(WEAPON_CLASS.atgm)?.id).toBe('fire_missile');
    expect(lib.fireEmitterFor(WEAPON_CLASS.rpg)?.id).toBe('fire_missile');
  });

  it('returns null for a class no emitter claims', () => {
    const lib = new EmitterLibrary();
    lib.useEmitters([spec('fire_small_arms', ['small_arms'])]);
    // Callers fall back to the generic puff, which is what lets this ship
    // one class at a time.
    expect(lib.fireEmitterFor(WEAPON_CLASS.mortar)).toBeNull();
  });

  it('ignores emitters whose trigger is not weapon_fire', () => {
    const lib = new EmitterLibrary();
    const kill: EmitterSpec = { ...spec('catastrophic_kill', ['apfsds']), trigger: 'catastrophic_kill' };
    lib.useEmitters([kill]);
    expect(lib.fireEmitterFor(WEAPON_CLASS.apfsds)).toBeNull();
  });

  it('ignores an unknown class name rather than throwing', () => {
    const lib = new EmitterLibrary();
    lib.useEmitters([spec('bad', ['not_a_weapon'])]);
    expect(lib.fireEmitterFor(WEAPON_CLASS.small_arms)).toBeNull();
  });

  it('is empty before any emitters are registered', () => {
    expect(new EmitterLibrary().fireEmitterFor(WEAPON_CLASS.apfsds)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/render/src/vfx/emitters.test.ts`
Expected: FAIL — cannot resolve `./emitters`.

- [ ] **Step 3: Write the implementation**

Create `packages/render/src/vfx/emitters.ts`:

```ts
import { WEAPON_CLASS } from '@lions/sim';

/** A scalar or an inclusive [min, max] band, matching the schema's `range`. */
export type Range = number | [number, number];

/** One particle layer of an emitter. Mirrors particle_layer in the schema. */
export interface ParticleSpec {
  sprite?: string;
  count: Range;
  lifetime_ms: Range;
  emit_over_ms?: number;
  speed_tiles_s?: Range;
  cone_deg?: number;
  inherit_velocity?: number;
  gravity_tiles_s2?: number;
  drag?: number;
  size_px?: Range;
  size_over_life?: number[];
  color_over_life: string[];
  alpha_over_life?: number[];
  additive?: boolean;
  heat_shimmer?: boolean;
}

/** One emitter, as authored in data/vfx/*.json. */
export interface EmitterSpec {
  id: string;
  trigger: string;
  layer: string;
  weapon_classes?: string[];
  persistent?: boolean;
  budget_priority?: number;
  hit_stop_ms?: number;
  screen_shake?: { amplitude_px?: number; duration_ms?: number; falloff_tiles?: number };
  light?: { color?: string; intensity?: number; radius_tiles?: number; decay_ms?: number };
  particles: ParticleSpec[];
}

/**
 * Indexes weapon_fire emitters by weapon class.
 *
 * The app loads the JSON and hands it over — @lions/render must not import
 * @lions/data. Same arrangement as AudioManager.useManifest.
 */
export class EmitterLibrary {
  private byFireClass = new Map<number, EmitterSpec>();

  useEmitters(list: EmitterSpec[]): void {
    this.byFireClass.clear();
    for (const em of list) {
      if (em.trigger !== 'weapon_fire') continue;
      for (const name of em.weapon_classes ?? []) {
        const idx = WEAPON_CLASS[name];
        // An unknown class is ignored, not fatal: a data typo should not
        // take the renderer down mid-mission.
        if (idx !== undefined) this.byFireClass.set(idx, em);
      }
    }
  }

  /** The emitter for a weapon class, or null to use the generic puff. */
  fireEmitterFor(cls: number): EmitterSpec | null {
    return this.byFireClass.get(cls) ?? null;
  }
}
```

- [ ] **Step 4: Create the barrel export**

Create `packages/render/src/vfx/index.ts`:

```ts
export { firePower } from './power';
export { EmitterLibrary, type EmitterSpec, type ParticleSpec, type Range } from './emitters';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/render/src/vfx/emitters.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify everything is green**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm test:determinism
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/vfx/emitters.ts packages/render/src/vfx/emitters.test.ts packages/render/src/vfx/index.ts
git commit -m "feat(render): index weapon-fire emitters by weapon class"
```

---

### Task 4: Particle system

**Files:**
- Create: `packages/render/src/vfx/particles.ts`
- Modify: `packages/render/src/vfx/index.ts`

**Interfaces:**
- Consumes: `ParticleSpec`, `Range` from `./emitters`; `Graphics` from `pixi.js`.
- Produces: `class ParticleSystem` with:
  - `constructor(capacity: number, resolve: (paletteKey: string) => string)`
  - `spawn(spec: ParticleSpec, x: number, y: number, dirTurns: number, magnitude: number, priority: number): void`
  - `step(dt: number): void`
  - `draw(g: Graphics, isoX: (x: number, y: number) => number, isoY: (x: number, y: number) => number): void`
  - `get live(): number`

  Task 6 calls all of these.

**Background:** `resolve` converts a palette key to a hex string. The renderer cannot import `@lions/data`, so the app injects `paletteColor`. Pools are fixed-size typed arrays — no per-particle objects, since at 400 units weapon fire is the highest-frequency effect in the game. Randomness here is presentation-only and may use `Math.random()`; that ban applies to `@lions/sim`, not the renderer.

- [ ] **Step 1: Write the implementation**

There is no test for this task — particle motion is visual, and asserting numbers nobody can eyeball proves nothing. `live` is exposed so Task 6 can verify spawning in the running app.

Create `packages/render/src/vfx/particles.ts`:

```ts
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
   * needing its own emitter.
   */
  spawn(
    spec: ParticleSpec,
    x: number,
    y: number,
    dirTurns: number,
    magnitude: number,
    priority: number
  ): void {
    const scale = 0.5 + magnitude * 1.5;
    const n = Math.max(1, Math.round(pick(spec.count, 1) * (0.5 + magnitude * 0.9)));
    const coneRad = ((spec.cone_deg ?? 0) * Math.PI) / 180;
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

  draw(
    g: Graphics,
    isoX: (x: number, y: number) => number,
    isoY: (x: number, y: number) => number
  ): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) continue;
      const t = this.age[i] / this.life[i];
      const color = sampleStep(this.colors[i], t, '#FFFFFF');
      const alpha = sampleStep(this.alphaCurve[i], t, 1 - t);
      const sizeMul = sampleStep(this.sizeCurve[i], t, 1);
      const r = this.size[i] * sizeMul;
      if (r <= 0 || alpha <= 0) continue;
      g.circle(isoX(this.x[i], this.y[i]), isoY(this.x[i], this.y[i]) - 3, r).fill({ color, alpha });
    }
  }
}
```

- [ ] **Step 2: Add to the barrel export**

In `packages/render/src/vfx/index.ts`, append:

```ts
export { ParticleSystem } from './particles';
```

- [ ] **Step 3: Verify it compiles and nothing regressed**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm test:determinism
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/render/src/vfx/particles.ts packages/render/src/vfx/index.ts
git commit -m "feat(render): fixed-capacity particle pool for VFX emitters"
```

---

### Task 5: Author the eight emitters

**Files:**
- Create: `data/vfx/fire_small_arms.json`, `fire_hmg.json`, `fire_autocannon.json`, `fire_apfsds.json`, `fire_heat.json`, `fire_missile.json`, `fire_mortar.json`
- Modify: `packages/data/src/index.ts`

**Interfaces:**
- Consumes: the `weapon_classes` field from Task 1.
- Produces: `export const vfxEmitters` from `@lions/data` — an array of emitter objects. Task 6 imports it in `main.ts`.

**Note on coverage:** seven files, eight classes — `fire_missile.json` serves both `atgm` and `rpg`, which share a backblast character. `demolition` deliberately gets no emitter: `charges` are placed by `demo_squad`, not fired, so a muzzle flash would misrepresent what happened. `he`, `rocket` and `interceptor` have no unit using them today and fall through to the generic puff.

- [ ] **Step 1: Author the small-arms emitter**

Create `data/vfx/fire_small_arms.json`:

```json
{
  "id": "fire_small_arms",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["small_arms"],
  "budget_priority": 1,
  "particles": [
    {
      "sprite": "hard_dot",
      "count": 1,
      "lifetime_ms": [60, 110],
      "speed_tiles_s": [0.5, 1.2],
      "cone_deg": 18,
      "size_px": [2, 3],
      "size_over_life": [1.0, 0.4],
      "color_over_life": ["vfx.white_hot", "vfx.fire"],
      "alpha_over_life": [1.0, 0.0],
      "additive": true
    }
  ]
}
```

Lowest `budget_priority` in the set: this will be the overwhelming majority of spawns, so it is the first thing culled under pressure.

- [ ] **Step 2: Author the HMG emitter**

Create `data/vfx/fire_hmg.json`:

```json
{
  "id": "fire_hmg",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["hmg"],
  "budget_priority": 2,
  "light": { "color": "vfx.fire", "intensity": 0.6, "radius_tiles": 1.2, "decay_ms": 70 },
  "particles": [
    {
      "sprite": "hard_dot",
      "count": [2, 3],
      "lifetime_ms": [80, 150],
      "speed_tiles_s": [0.8, 2.0],
      "cone_deg": 26,
      "size_px": [2.5, 4],
      "size_over_life": [1.0, 0.3],
      "color_over_life": ["vfx.white_hot", "vfx.fire", "vfx.ember"],
      "alpha_over_life": [1.0, 0.0],
      "additive": true
    },
    {
      "sprite": "smoke_puff",
      "count": 1,
      "lifetime_ms": [220, 340],
      "speed_tiles_s": [0.2, 0.5],
      "cone_deg": 40,
      "drag": 0.5,
      "size_px": [3, 5],
      "size_over_life": [0.6, 1.4],
      "color_over_life": ["dust.3"],
      "alpha_over_life": [0.5, 0.0]
    }
  ]
}
```

- [ ] **Step 3: Author the autocannon emitter**

Create `data/vfx/fire_autocannon.json`:

```json
{
  "id": "fire_autocannon",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["autocannon"],
  "budget_priority": 4,
  "screen_shake": { "amplitude_px": 1.5, "duration_ms": 90, "falloff_tiles": 8 },
  "light": { "color": "vfx.fire", "intensity": 1.2, "radius_tiles": 2.0, "decay_ms": 90 },
  "particles": [
    {
      "sprite": "spark",
      "count": [3, 5],
      "lifetime_ms": [100, 190],
      "speed_tiles_s": [1.5, 3.5],
      "cone_deg": 30,
      "size_px": [3, 5],
      "size_over_life": [1.0, 0.3],
      "color_over_life": ["vfx.white_hot", "vfx.fire", "vfx.ember"],
      "alpha_over_life": [1.0, 0.0],
      "additive": true
    },
    {
      "sprite": "smoke_puff",
      "count": [1, 2],
      "lifetime_ms": [300, 460],
      "speed_tiles_s": [0.3, 0.7],
      "cone_deg": 50,
      "drag": 0.6,
      "size_px": [4, 7],
      "size_over_life": [0.5, 1.5],
      "color_over_life": ["dust.3", "dust.2"],
      "alpha_over_life": [0.6, 0.0]
    }
  ]
}
```

- [ ] **Step 4: Author the tank-gun emitter**

Create `data/vfx/fire_apfsds.json`:

```json
{
  "id": "fire_apfsds",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["apfsds"],
  "budget_priority": 8,
  "screen_shake": { "amplitude_px": 5, "duration_ms": 220, "falloff_tiles": 16 },
  "light": { "color": "vfx.white_hot", "intensity": 3.0, "radius_tiles": 5.0, "decay_ms": 140 },
  "particles": [
    {
      "sprite": "soft_dot",
      "count": [5, 7],
      "lifetime_ms": [90, 170],
      "speed_tiles_s": [3.0, 6.5],
      "cone_deg": 46,
      "size_px": [8, 14],
      "size_over_life": [1.2, 0.3],
      "color_over_life": ["vfx.white_hot", "vfx.fire"],
      "alpha_over_life": [1.0, 0.0],
      "additive": true
    },
    {
      "sprite": "ring",
      "count": 1,
      "lifetime_ms": [260, 380],
      "speed_tiles_s": 0,
      "size_px": [10, 14],
      "size_over_life": [0.4, 2.2],
      "color_over_life": ["dust.3"],
      "alpha_over_life": [0.7, 0.0]
    },
    {
      "sprite": "smoke_puff",
      "count": [4, 6],
      "lifetime_ms": [500, 850],
      "speed_tiles_s": [0.6, 1.6],
      "cone_deg": 70,
      "drag": 0.7,
      "size_px": [7, 13],
      "size_over_life": [0.6, 1.8],
      "color_over_life": ["dust.3", "dust.2", "gunmetal.4"],
      "alpha_over_life": [0.75, 0.0]
    }
  ]
}
```

The `ring` layer is a ground dust ring at the muzzle — the visual signature of a tank gun firing over dry ground, and the fastest way to recognise one.

- [ ] **Step 5: Author the HEAT emitter**

Create `data/vfx/fire_heat.json`:

```json
{
  "id": "fire_heat",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["heat"],
  "budget_priority": 7,
  "screen_shake": { "amplitude_px": 3, "duration_ms": 170, "falloff_tiles": 12 },
  "light": { "color": "vfx.fire", "intensity": 2.4, "radius_tiles": 4.0, "decay_ms": 130 },
  "particles": [
    {
      "sprite": "soft_dot",
      "count": [4, 6],
      "lifetime_ms": [110, 210],
      "speed_tiles_s": [2.0, 4.5],
      "cone_deg": 54,
      "size_px": [7, 12],
      "size_over_life": [1.1, 0.4],
      "color_over_life": ["vfx.white_hot", "vfx.fire", "vfx.ember"],
      "alpha_over_life": [1.0, 0.0],
      "additive": true
    },
    {
      "sprite": "smoke_puff",
      "count": [2, 4],
      "lifetime_ms": [420, 700],
      "speed_tiles_s": [0.5, 1.2],
      "cone_deg": 80,
      "drag": 0.65,
      "size_px": [6, 10],
      "size_over_life": [0.6, 1.7],
      "color_over_life": ["dust.3", "gunmetal.4"],
      "alpha_over_life": [0.7, 0.0]
    }
  ]
}
```

- [ ] **Step 6: Author the missile emitter**

Create `data/vfx/fire_missile.json`:

```json
{
  "id": "fire_missile",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["atgm", "rpg"],
  "budget_priority": 6,
  "light": { "color": "vfx.fire", "intensity": 1.6, "radius_tiles": 3.0, "decay_ms": 160 },
  "particles": [
    {
      "sprite": "soft_dot",
      "count": [2, 3],
      "lifetime_ms": [130, 220],
      "speed_tiles_s": [1.2, 2.4],
      "cone_deg": 24,
      "size_px": [5, 8],
      "size_over_life": [1.0, 0.5],
      "color_over_life": ["vfx.white_hot", "vfx.fire"],
      "alpha_over_life": [1.0, 0.0],
      "additive": true
    },
    {
      "sprite": "smoke_puff",
      "count": [5, 8],
      "lifetime_ms": [600, 1000],
      "speed_tiles_s": [1.8, 3.6],
      "cone_deg": 34,
      "inherit_velocity": -1.0,
      "drag": 0.55,
      "size_px": [6, 11],
      "size_over_life": [0.7, 2.0],
      "color_over_life": ["dust.3", "dust.2", "limestone.4"],
      "alpha_over_life": [0.85, 0.0]
    }
  ]
}
```

`inherit_velocity: -1.0` on the smoke layer is the backblast — it fires *backwards* along the bearing. It is the most diagnostic signature in the set: it identifies an AT team from its shape alone, which is what makes the GDD's Ashwar ambush target legible to a player.

- [ ] **Step 7: Author the mortar emitter**

Create `data/vfx/fire_mortar.json`:

```json
{
  "id": "fire_mortar",
  "trigger": "weapon_fire",
  "layer": "above_units",
  "weapon_classes": ["mortar"],
  "budget_priority": 5,
  "screen_shake": { "amplitude_px": 2, "duration_ms": 140, "falloff_tiles": 9 },
  "light": { "color": "vfx.fire", "intensity": 0.9, "radius_tiles": 2.0, "decay_ms": 100 },
  "particles": [
    {
      "sprite": "soft_dot",
      "count": [2, 3],
      "lifetime_ms": [90, 150],
      "speed_tiles_s": [0.6, 1.4],
      "cone_deg": 90,
      "size_px": [4, 7],
      "size_over_life": [1.0, 0.4],
      "color_over_life": ["vfx.fire", "vfx.ember"],
      "alpha_over_life": [0.9, 0.0],
      "additive": true
    },
    {
      "sprite": "smoke_puff",
      "count": [4, 7],
      "lifetime_ms": [550, 900],
      "speed_tiles_s": [0.4, 1.0],
      "cone_deg": 360,
      "gravity_tiles_s2": -0.6,
      "drag": 0.7,
      "size_px": [7, 12],
      "size_over_life": [0.5, 2.0],
      "color_over_life": ["dust.3", "dust.2"],
      "alpha_over_life": [0.7, 0.0]
    }
  ]
}
```

A wide soft ring rising rather than a directional flash — a mortar's tube signature, and unmistakably not direct fire.

- [ ] **Step 8: Verify all seven pass the data gate**

Run: `pnpm validate:data`
Expected: PASS, with the file count risen by seven.

- [ ] **Step 9: Export the emitters from `@lions/data`**

In `packages/data/src/index.ts`, add imports beside the existing JSON imports:

```ts
import fireApfsds from '../../../data/vfx/fire_apfsds.json';
import fireAutocannon from '../../../data/vfx/fire_autocannon.json';
import fireHeat from '../../../data/vfx/fire_heat.json';
import fireHmg from '../../../data/vfx/fire_hmg.json';
import fireMissile from '../../../data/vfx/fire_missile.json';
import fireMortar from '../../../data/vfx/fire_mortar.json';
import fireSmallArms from '../../../data/vfx/fire_small_arms.json';
```

Match the relative-path style already used by the neighbouring unit imports; adjust the depth if it differs.

Then add the export:

```ts
/** Weapon-fire emitters, indexed by the renderer by weapon class. */
export const vfxEmitters = [
  fireSmallArms,
  fireHmg,
  fireAutocannon,
  fireApfsds,
  fireHeat,
  fireMissile,
  fireMortar,
];
```

- [ ] **Step 10: Verify and commit**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm validate:data && pnpm test:determinism
```
Expected: all pass.

```bash
git add data/vfx packages/data/src/index.ts
git commit -m "feat(data): eight weapon-fire signatures, one per weapon character"
```

---

### Task 6: Wire it into the renderer

**Files:**
- Modify: `packages/render/src/renderer.ts` (the `fire` branch of `onEvents`, the recoil block, `frame`)
- Modify: `packages/app/src/main.ts`

**Interfaces:**
- Consumes: `firePower`, `EmitterLibrary`, `ParticleSystem` from `./vfx`; `vfxEmitters`, `paletteColor` from `@lions/data`.
- Produces: `PixiRenderer.useEmitters(list: EmitterSpec[]): void`.

**Background:** the existing `fire` branch pushes hardcoded puffs based on `type.isSoft` and already computes the muzzle position (`mzX`, `mzY`) and `facingRad`. Reuse those — do not recompute. The weapon lookup mirrors `audio.ts:172`.

- [ ] **Step 1: Add the system to the renderer**

In `packages/render/src/renderer.ts`, add to the imports:

```ts
import { EmitterLibrary, ParticleSystem, firePower, type EmitterSpec } from './vfx';
```

Add fields beside the other private members:

```ts
  private readonly emitters = new EmitterLibrary();
  private particles: ParticleSystem | null = null;
```

Add the registration method beside `loadSprites`:

```ts
  /**
   * Register weapon-fire emitters. The app loads the JSON and resolves
   * palette keys, because @lions/render must not depend on @lions/data.
   */
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void {
    this.emitters.useEmitters(list);
    this.particles = new ParticleSystem(2048, resolve);
  }
```

- [ ] **Step 2: Spawn from the fire event**

In `onEvents`, inside the `e.kind === 'fire'` branch, replace the existing puff block:

```ts
        if (type.isSoft) {
          this.puffs.push({ x: mzX, y: mzY, ttl: 7, color: this.opts.flashColor, r: 5 });
        } else {
          this.puffs.push({ x: mzX, y: mzY, ttl: 4, color: this.opts.flashColor, r: 14 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 8, color: this.opts.flashColor, r: 10 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 18, color: '#6B6355', r: 7 });
        }
```

with:

```ts
        // Which weapon fired decides the signature — not whether the shooter
        // is soft. A tank's coax and its 120mm are the same unit and must not
        // look the same. Lookup mirrors AudioManager's.
        const wp = type.weapons.find((x) => x.id === e.weaponId);
        const cls = wp?.cls ?? WEAPON_CLASS.small_arms;
        const emitter = this.emitters.fireEmitterFor(cls);
        const power = wp ? firePower(wp) : 0;
        if (emitter && this.particles) {
          const dirTurns = facingRad / (Math.PI * 2);
          const prio = emitter.budget_priority ?? 4;
          for (const layer of emitter.particles) {
            const back = (layer.inherit_velocity ?? 0) < 0;
            this.particles.spawn(
              layer,
              mzX,
              mzY,
              back ? dirTurns + 0.5 : dirTurns,
              power,
              prio
            );
          }
        } else if (type.isSoft) {
          // No emitter for this class yet: the original puffs still stand in.
          this.puffs.push({ x: mzX, y: mzY, ttl: 7, color: this.opts.flashColor, r: 5 });
        } else {
          this.puffs.push({ x: mzX, y: mzY, ttl: 4, color: this.opts.flashColor, r: 14 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 8, color: this.opts.flashColor, r: 10 });
          this.puffs.push({ x: mzX, y: mzY, ttl: 18, color: '#6B6355', r: 7 });
        }
        this.recoilPower[e.shooter] = power;
```

Add `WEAPON_CLASS` to the existing `@lions/sim` import.

- [ ] **Step 3: Scale recoil by power**

Add the field beside `recoilT`:

```ts
  /** Power of the shot that caused the current recoil, 0..1. */
  private recoilPower: Float64Array;
```

Initialise it in the constructor beside the others:

```ts
    this.recoilPower = new Float64Array(n);
```

In the recoil block inside the draw loop, replace:

```ts
          const px = type.isSoft ? RECOIL_PX_SOFT : RECOIL_PX_VEHICLE;
```

with:

```ts
          // Recoil now tracks the weapon, not the chassis: a tank's coax
          // nudges, its main gun shoves.
          const px = RECOIL_PX_SOFT + (RECOIL_PX_VEHICLE - RECOIL_PX_SOFT) * this.recoilPower[i];
```

- [ ] **Step 4: Step and draw the particles**

In `frame`, immediately after the existing `this.stepDeaths(dtSeconds, g);` call:

```ts
    if (this.particles) this.particles.step(dtSeconds);
```

And where puffs are drawn (`for (const p of this.puffs)`, on `fg`), immediately after that loop:

```ts
    if (this.particles) this.particles.draw(fg, isoX, isoY);
```

- [ ] **Step 5: Wire the app**

In `packages/app/src/main.ts`, add `vfxEmitters` to the existing `@lions/data` import, and after the renderer is constructed — beside the `renderer.loadSprites` loop — add:

```ts
  renderer.useEmitters(vfxEmitters as EmitterSpec[], paletteColor);
```

Import the type from `@lions/render`, adding it to that package's public exports in `packages/render/src/index.ts` if it is not already exported:

```ts
export { type EmitterSpec } from './vfx';
```

- [ ] **Step 6: Verify it compiles and nothing regressed**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm validate:data && pnpm test:determinism
```
Expected: all pass, determinism hash unchanged.

- [ ] **Step 7: Verify in the running app**

Start the preview, load `M0 sandbox`, and run in the console:

```js
const L = window.__lions, rd = L.renderer, sim = L.sim, st = sim.state;
const mine = [], theirs = [];
for (let i = 0; i < sim.entityCount; i++) { if (!st.alive[i]) continue; (st.side[i] === 0 ? mine : theirs).push(i); }
sim.queueCommand({ kind: 'move', ids: mine, x: st.posX[theirs[0]], y: st.posY[theirs[0]] });
for (let n = 0; n < 20; n++) L.step(20);
rd.particles.live;
```

Expected: a non-zero particle count once firing starts.

Then confirm the two weapons on one tank differ — the core bug this fixes:

```js
const t = sim.unitTypes.find(u => u.id === 'mbt_lavi');
[t.weapons.find(w => w.id === 'gun_120'), t.weapons.find(w => w.id === 'coax_mg')]
  .map(w => rd.constructor.name && w.id + ' cls=' + w.cls);
```

Expected: different `cls` values, therefore different emitters — `fire_apfsds` versus `fire_hmg`.

Take a screenshot of a firefight and confirm by eye that tank fire, MG fire and mortar fire are visibly different events.

- [ ] **Step 8: Commit**

```bash
git add packages/render/src/renderer.ts packages/render/src/index.ts packages/app/src/main.ts
git commit -m "feat(render): shot signatures differ by weapon, scaled by power"
```

---

## Verification checklist

Run before declaring the feature complete:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:determinism   # hash MUST be unchanged — nothing here touches the sim
pnpm validate:data
pnpm validate:assets
pnpm build
```

And by eye, in a running firefight:

- A tank's main gun and its coaxial MG produce visibly different events.
- Mortar fire reads as indirect — a rising ring, not a directional flash.
- An RPG or ATGM launch throws backblast *behind* the shooter.
- Rifle fire is small and cheap and does not swamp the screen at scale.
