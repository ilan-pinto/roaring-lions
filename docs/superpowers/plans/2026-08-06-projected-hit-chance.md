# Projected Hit Chance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering an enemy shows, for each selected unit that can engage it, the projected P(hit) and the factors degrading it — reusing the sim's own calculation rather than a second copy of it.

**Architecture:** `fireAt` already computes the probability and its six factors, then rolls. Extract the pure part into `hitFactors`, call it from both `fireAt` and a new public `projectHit`, and render the result in the overlay. `projectHit` never touches the RNG.

**Tech Stack:** TypeScript strict, Q16.16 fixed-point (`fx`), Vitest, PixiJS 8 (DOM overlay, not canvas).

## Global Constraints

- **`projectHit` must never call `this.rng`.** Invariant 3 makes randomness a seeded per-entity stream; advancing it from a hover desyncs replays and makes the determinism hash depend on mouse position. The roll stays exclusively in `fireAt`.
- **`pnpm test:determinism` must pass with hash `484379662` unchanged.** The extraction is pure, so the hash is the proof it changed no behaviour. If it moves, the refactor is wrong — do not update the golden value.
- **`@lions/sim` is fixed-point only.** No `Math.*`, no `Date.*`, no floating point inside `packages/sim` — lint enforces it. Use `fx.mul`, `fx.div`, `fx.expNeg`, `fx.sqrt`. `Fx` is a plain `number` holding Q16.16.
- **TypeScript strict. No `any`. No non-null assertions in sim code.**
- **Dependency direction:** `app → render → sim`. `@lions/render` imports `@lions/sim` and `pixi.js` only, never `@lions/data`.
- Every task ends green on: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm test:determinism`, `pnpm validate:data`, `pnpm validate:assets`.

## Refinement to the spec

The spec has `projectHit` return `{...} | null`. **It returns a discriminated union instead**, because of something found while writing this plan:

`contactState` latches. It is set to 2 when confidence crosses `IDENTIFIED_AT` (0.70) and only falls back when confidence drops under `LOST_AT` (0.20) — it never goes 2 → 1 (`sim.ts:1330-1340`). Meanwhile `bestTargetFor` gates on **confidence**, not level: `this.contact[...] < IDENTIFIED_AT` (`sim.ts:1362`).

So across the whole 0.70 → 0.20 band, `contactLevel()` reports "identified" while the sim would refuse the shot. A panel gated on `contactLevel` would confidently show a projection for a shot that cannot happen. The union lets the panel say which of "unidentified" and "no firing solution" applies, and forces the eligibility check to use the same threshold the sim uses.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/sim/src/sim.ts` | Modify: extract `hitFactors`, add `projectHit` |
| `packages/sim/src/index.ts` | Modify: export `HitProjection`, `HitFactors` |
| `packages/sim/src/projection.test.ts` | Create: all sim-side tests |
| `packages/render/src/overlay.ts` | Modify: `hoverEntity` callback + the panel section |
| `packages/render/src/renderer.ts` | Modify: `hoverEntity` field |
| `packages/app/src/main.ts` | Modify: set `hoverEntity`, pass the callback |

---

### Task 1: Extract the pure hit calculation

**Files:**
- Modify: `packages/sim/src/sim.ts` — `fireAt` at line 1556
- Modify: `packages/sim/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface HitFactors { p: Fx; accuracy: Fx; rangeFalloff: Fx; coverMod: Fx; motionMod: Fx; stanceMod: Fx; suppressionMod: Fx }`
  - `private hitFactors(shooter: number, w: WeaponStats, target: number): HitFactors`

  Task 2 calls `hitFactors` and re-exports `HitFactors`.

**Background:** this task must change no behaviour at all. Lines 1557–1588 of `fireAt` are pure — they read state and produce a probability. Line 1591 (`const roll = this.rng.nextU32(shooter) >>> 16;`) begins the mutation. Move the pure part out, call it, leave everything else alone. The determinism hash is the test.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/src/projection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

const RIFLES: UnitTypeJson = {
  id: 'p_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.6, penetration: 8, damage: 15, suppression: 40, rof_per_min: 300 },
  ],
};

function world(): { sim: Sim; inf: number } {
  // SimConfig is { seed, width, height, capacity }. Unit types are registered
  // with addUnitType, which returns the index spawn() expects.
  const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 16 });
  const inf = sim.addUnitType(RIFLES);
  return { sim, inf };
}

/** Run n ticks, returning every event produced. */
function run(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

describe('hitFactors extraction', () => {
  it('leaves the factors on the fire event unchanged', () => {
    // A pure extraction must not move a single number. Two stationary squads
    // in the open: the first fire event's factors are fully determined.
    const { sim, inf } = world();
    sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    const events = run(sim, 20 * TICKS_PER_SECOND);
    const fire = events.find((e) => e.kind === 'fire');
    expect(fire).toBeDefined();
    if (fire?.kind !== 'fire') throw new Error('no fire event');

    // accuracy 0.6, no veterancy, so accuracy is exactly 0.6.
    expect(fx.toNumber(fire.breakdown.accuracy)).toBeCloseTo(0.6, 3);
    // Neither unit moves and neither is suppressed at first contact.
    expect(fx.toNumber(fire.breakdown.motionMod)).toBe(1);
    expect(fx.toNumber(fire.breakdown.stanceMod)).toBe(1);
    // pHit is the product of all six factors.
    const b = fire.breakdown;
    const product =
      fx.toNumber(b.accuracy) *
      fx.toNumber(b.rangeFalloff) *
      fx.toNumber(b.coverMod) *
      fx.toNumber(b.motionMod) *
      fx.toNumber(b.stanceMod) *
      fx.toNumber(b.suppressionMod);
    expect(fx.toNumber(fire.pHit)).toBeCloseTo(product, 2);
  });
});
```

- [ ] **Step 2: Run it to see it pass against the CURRENT code**

Run: `pnpm vitest run packages/sim/src/projection.test.ts`
Expected: PASS.

This test is deliberately written to pass *before* the refactor. It is a
characterisation test: it pins the current numbers so the extraction cannot
silently change them. Do not proceed until it passes on unmodified code — a test
that fails here is testing the wrong thing.

- [ ] **Step 3: Extract `hitFactors`**

In `packages/sim/src/sim.ts`, add this interface beside the other exported interfaces (near `WeaponStats`):

```ts
/** Every multiplier behind one shot's hit probability, and their product.
 *  GDD 5.2. Pure: computing these touches no state and no RNG. */
export interface HitFactors {
  p: Fx;
  accuracy: Fx;
  rangeFalloff: Fx;
  coverMod: Fx;
  motionMod: Fx;
  stanceMod: Fx;
  suppressionMod: Fx;
}
```

Add this method immediately before `fireAt`:

```ts
  /**
   * The hit probability for one shot, and every factor behind it.
   *
   * Pure by construction: it reads state and returns numbers. In particular it
   * does NOT roll — the RNG is a seeded per-entity stream (invariant 3), and
   * advancing it from anywhere but an actual shot would desync replays. `fireAt`
   * rolls; `projectHit` does not.
   */
  private hitFactors(shooter: number, w: WeaponStats, target: number): HitFactors {
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const dist = fx.sqrt(dSq);

    // GDD 5.2 — every factor is on the event for the overlay. Veterans shoot
    // straighter: the ledger's carry-over must be worth protecting.
    const accuracy = fx.min(
      fx.mul(w.accuracy, fx.add(ONE, this.veterancy[shooter] * VET_ACC_BONUS)),
      ONE
    );
    const ratio = fx.div(dist, w.effectiveRange);
    const rangeFalloff = fx.expNeg(fx.mul(FALLOFF_SCALE[w.cls], fx.mul(ratio, ratio)));
    let coverMod = COVER_HIT[this.cover[(ty >> 16) * this.width + (tx >> 16)]];
    // Shooting through a screen: every tile of it degrades the shot, with a
    // floor because blind fire still occasionally connects.
    const smokeOnLine = this.raySmoke(px >> 16, py >> 16, tx >> 16, ty >> 16);
    if (smokeOnLine > 0) {
      const tiles = 1 + ((smokeOnLine / SMOKE_MAX) | 0);
      let mult = ONE;
      for (let k = 0; k < tiles && mult > SMOKE_HIT_FLOOR; k++) mult = fx.mul(mult, SMOKE_HIT_MULT);
      coverMod = fx.mul(coverMod, mult < SMOKE_HIT_FLOOR ? SMOKE_HIT_FLOOR : mult);
    }
    const motionMod = this.isEffectivelyMoving(target) ? TARGET_MOTION_MOD : ONE;
    const stanceMod = this.isEffectivelyMoving(shooter) ? MOVING_STANCE_MOD : ONE;
    const suppressionMod = fx.div(ONE, fx.add(ONE, fx.mul(SUPP_K, this.suppression[shooter])));
    let p = fx.mul(accuracy, rangeFalloff);
    p = fx.mul(p, coverMod);
    p = fx.mul(p, motionMod);
    p = fx.mul(p, stanceMod);
    p = fx.mul(p, suppressionMod);
    return { p, accuracy, rangeFalloff, coverMod, motionMod, stanceMod, suppressionMod };
  }
```

Now replace lines 1557–1588 of `fireAt` — everything from `const px = this.posX[shooter];` down to and including the five `p = fx.mul(...)` lines — with:

```ts
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const dist = fx.sqrt(dSq);
    const { p, accuracy, rangeFalloff, coverMod, motionMod, stanceMod, suppressionMod } =
      this.hitFactors(shooter, w, target);
```

`px`, `py`, `tx`, `ty`, `dSq` and `dist` are still needed by the code below the
roll — the projectile's origin and aim point, and the flight-time calculation —
so they stay. `hitFactors` recomputes them internally; that duplication is
deliberate and keeps `hitFactors` self-contained and callable without a shot.

- [ ] **Step 4: Verify the characterisation test still passes and the hash has not moved**

```bash
pnpm vitest run packages/sim/src/projection.test.ts
pnpm test
pnpm test:determinism
pnpm exec tsc --noEmit
pnpm lint
```
Expected: all pass. `test:determinism` must still assert `484379662`. If the hash
moved, the extraction changed behaviour — revert and find the difference rather
than updating the golden value.

- [ ] **Step 5: Export the type**

In `packages/sim/src/index.ts`, add `type HitFactors` to the existing export block from `./sim`.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/index.ts packages/sim/src/projection.test.ts
git commit -m "refactor(sim): extract the pure hit-chance calculation

fireAt interleaved a pure probability computation with mutation. Lines
1557-1588 read state and produce six factors and their product; the RNG roll on
1591 begins the side effects. Split on that boundary so the probability can be
asked for without firing.

hitFactors is pure by construction and in particular does not roll. The RNG is
a seeded per-entity stream, so advancing it anywhere but an actual shot would
desync replays.

Characterisation test written first and confirmed passing against unmodified
code, so it pins the current numbers rather than describing new ones.
Determinism hash unchanged at 484379662, which is the real proof the extraction
altered no behaviour."
```

---

### Task 2: `projectHit`

**Files:**
- Modify: `packages/sim/src/sim.ts`
- Modify: `packages/sim/src/index.ts`
- Modify: `packages/sim/src/projection.test.ts`

**Interfaces:**
- Consumes: `hitFactors(shooter, w, target): HitFactors` and `HitFactors` from Task 1.
- Produces:
  - ```ts
    export type HitProjection =
      | { kind: 'shot'; weaponId: string; pHit: Fx; hurts: boolean; factors: HitFactors }
      | { kind: 'unidentified' }
      | { kind: 'noSolution' };
    ```
  - `projectHit(shooter: number, target: number): HitProjection` — public on `Sim`.

  Task 3 calls `projectHit` and renders the result.

**Background:** eligibility must match `bestTargetFor` (`sim.ts:1340` onward) exactly, or the panel will offer shots the unit refuses. Its conditions, in order:

1. `this.alive[t] !== 0`, `this.side[t] !== shooterSide`, `this.side[t] <= 1` (side 2 is civilians and never a target)
2. `this.garrisonedIn[t] < 0` and `this.carriedBy[t] < 0`
3. `this.contact[sSide * cap + t] >= IDENTIFIED_AT` — **confidence, not `contactState`**
4. `dSq <= w.rangeSq && dSq >= w.minRangeSq`
5. line of sight — `this.losRay(...) >= 0` — unless `(INDIRECT_MASK & (1 << w.cls)) !== 0`

`hurts` is `bestTargetFor`'s own heuristic: `tType.isSoft || w.penetration >= tType.armorSide >> 2`. It measures against `armorSide` whatever face is presented.

`cap` is `this.capacity`. `IDENTIFIED_AT` and `INDIRECT_MASK` are already imported/defined in the file.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim/src/projection.test.ts`. Add these unit types beside `RIFLES`:

```ts
const MG_JEEP: UnitTypeJson = {
  id: 'p_mg',
  name: 'MG Jeep',
  role: 'technical',
  hull: { hp: 300, armor: { front: 14, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.8 },
  weapons: [
    { id: 'dshk', type: 'hmg', range_tiles: 9, effective_range_tiles: 7, accuracy: 0.5, penetration: 25, damage: 40, suppression: 55, rof_per_min: 500 },
  ],
};

const TANK: UnitTypeJson = {
  id: 'p_tank',
  name: 'Tank',
  role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1, sight_tiles: 14, signature: 1 },
  weapons: [
    { id: 'main', type: 'apfsds', range_tiles: 20, effective_range_tiles: 16, accuracy: 0.8, penetration: 900, damage: 500, rof_per_min: 8 },
    { id: 'coax', type: 'hmg', range_tiles: 9, effective_range_tiles: 7, accuracy: 0.5, penetration: 20, damage: 35, suppression: 60, rof_per_min: 500 },
  ],
};

function tankWorld(): { sim: Sim; inf: number; tank: number; jeep: number } {
  const sim = new Sim({ seed: 11, width: 64, height: 64, capacity: 16 });
  const inf = sim.addUnitType(RIFLES);
  const tank = sim.addUnitType(TANK);
  const jeep = sim.addUnitType(MG_JEEP);
  return { sim, inf, tank, jeep };
}
```

Then the tests:

```ts
describe('projectHit', () => {
  it('agrees exactly with the shot the sim actually takes', () => {
    // The whole point of the feature: the projection is the sim's own number,
    // not a second implementation that can drift.
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));

    let projectedAtFire: number | null = null;
    let firedPHit: number | null = null;
    for (let i = 0; i < 20 * TICKS_PER_SECOND && firedPHit === null; i++) {
      const before = sim.projectHit(shooter, target);
      const events = sim.tick();
      const fire = events.find((e) => e.kind === 'fire' && e.shooter === shooter);
      if (fire?.kind === 'fire') {
        if (before.kind !== 'shot') throw new Error(`projected ${before.kind} but the sim fired`);
        projectedAtFire = before.pHit;
        firedPHit = fire.pHit;
      }
    }
    expect(firedPHit).not.toBeNull();
    expect(projectedAtFire).toBe(firedPHit);
  });

  it('does not advance the RNG', () => {
    // A hover must not change the game. If projectHit rolls, the state hash
    // becomes a function of mouse position and every replay desyncs.
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    run(sim, 5 * TICKS_PER_SECOND);
    const before = sim.hash();
    for (let i = 0; i < 1000; i++) sim.projectHit(shooter, target);
    expect(sim.hash()).toBe(before);
  });

  it('reports no solution beyond weapon range', () => {
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
    const target = sim.spawn(inf, 1, fx.from(40.5), fx.from(2.5));
    run(sim, 5 * TICKS_PER_SECOND);
    expect(sim.projectHit(shooter, target).kind).toBe('noSolution');
  });

  it('reports unidentified before the target is identified', () => {
    // Tick zero: nothing has been detected yet.
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    expect(sim.projectHit(shooter, target).kind).toBe('unidentified');
  });

  it('picks the weapon with the better chance, not the first one', () => {
    // At 5 tiles both the tank's weapons reach. The main gun is accuracy 0.8
    // against the coax's 0.5, so the projection must report the main gun.
    const { sim, inf, tank } = tankWorld();
    const shooter = sim.spawn(tank, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(15.5), fx.from(10.5));
    run(sim, 8 * TICKS_PER_SECOND);
    const p = sim.projectHit(shooter, target);
    expect(p.kind).toBe('shot');
    if (p.kind !== 'shot') throw new Error('expected a shot');
    expect(p.weaponId).toBe('main');
  });

  it('flags a machine gun as unable to hurt a tank, but fine against infantry', () => {
    // The jeep carries ONLY an hmg, penetration 25. Against the tank's
    // armorSide 300 the heuristic threshold is 300 >> 2 = 75, so it cannot
    // hurt it. A shooter with a main gun would mask this, because projectHit
    // would report the main gun instead.
    const { sim, inf, tank, jeep } = tankWorld();
    const gunner = sim.spawn(jeep, 0, fx.from(10.5), fx.from(10.5));
    const armour = sim.spawn(tank, 1, fx.from(14.5), fx.from(10.5));
    run(sim, 8 * TICKS_PER_SECOND);

    const vsArmour = sim.projectHit(gunner, armour);
    expect(vsArmour.kind).toBe('shot');
    if (vsArmour.kind !== 'shot') throw new Error('expected a shot');
    expect(vsArmour.weaponId).toBe('dshk');
    expect(vsArmour.hurts).toBe(false);

    // Same gun, soft target: infantry always qualify.
    const gunner2 = sim.spawn(jeep, 0, fx.from(30.5), fx.from(30.5));
    const soft = sim.spawn(inf, 1, fx.from(33.5), fx.from(30.5));
    run(sim, 8 * TICKS_PER_SECOND);
    const vsSoft = sim.projectHit(gunner2, soft);
    expect(vsSoft.kind).toBe('shot');
    if (vsSoft.kind !== 'shot') throw new Error('expected a shot');
    expect(vsSoft.hurts).toBe(true);
  });

  it('reports no solution for a firepower-killed shooter', () => {
    const { sim, inf } = world();
    const shooter = sim.spawn(inf, 0, fx.from(10.5), fx.from(10.5));
    const target = sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    run(sim, 8 * TICKS_PER_SECOND);
    expect(sim.projectHit(shooter, target).kind).toBe('shot');
    sim.state.firepowerKilled[shooter] = 1;
    expect(sim.projectHit(shooter, target).kind).toBe('noSolution');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/sim/src/projection.test.ts`
Expected: the `projectHit` tests FAIL with `sim.projectHit is not a function`. The `hitFactors` characterisation test from Task 1 still passes.

- [ ] **Step 3: Implement `projectHit`**

Add beside `HitFactors` in `packages/sim/src/sim.ts`:

```ts
/**
 * What the overlay can say about a hovered target. Three outcomes rather than
 * a nullable shot, because "you have not identified that" and "you cannot
 * reach that" are different facts and the player needs to know which.
 */
export type HitProjection =
  | { kind: 'shot'; weaponId: string; pHit: Fx; hurts: boolean; factors: HitFactors }
  | { kind: 'unidentified' }
  | { kind: 'noSolution' };
```

Add this public method next to `contactLevel`:

```ts
  /**
   * What would happen if `shooter` engaged `target` right now — the sim's own
   * hit calculation, without taking the shot. GDD 5.8: the player should know
   * what a shot will cost before paying for it.
   *
   * Eligibility deliberately mirrors bestTargetFor rather than inventing its
   * own rules, so the panel can never offer a shot the unit would refuse.
   *
   * Note the identification test is on contact CONFIDENCE, not contactState.
   * contactState latches at 2 once confidence passes IDENTIFIED_AT and only
   * falls back below the much lower LOST_AT, so there is a wide band where the
   * level claims "identified" while bestTargetFor would skip the target.
   */
  projectHit(shooter: number, target: number): HitProjection {
    const cap = this.capacity;
    if (this.alive[shooter] === 0 || this.alive[target] === 0) return { kind: 'noSolution' };
    if (this.firepowerKilled[shooter] === 1) return { kind: 'noSolution' };
    const sSide = this.side[shooter];
    // Civilians are never aimpoints; collateral comes from ordnance.
    if (this.side[target] === sSide || this.side[target] > 1) return { kind: 'noSolution' };
    // Men inside a building or aboard a vehicle cannot be shot at.
    if (this.garrisonedIn[target] >= 0 || this.carriedBy[target] >= 0) {
      return { kind: 'noSolution' };
    }
    if (this.contact[sSide * cap + target] < IDENTIFIED_AT) return { kind: 'unidentified' };

    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
    const dSq = distSqFx(fx.sub(tx, px), fx.sub(ty, py));
    const type = this.unitTypes[this.typeIdx[shooter]];
    const tType = this.unitTypes[this.typeIdx[target]];

    let best: HitProjection = { kind: 'noSolution' };
    let bestP = -1;
    for (const w of type.weapons) {
      if (dSq > w.rangeSq || dSq < w.minRangeSq) continue;
      if ((INDIRECT_MASK & (1 << w.cls)) === 0) {
        if (this.losRay(px >> 16, py >> 16, tx >> 16, ty >> 16) < 0) continue;
      }
      const factors = this.hitFactors(shooter, w, target);
      if (factors.p <= bestP) continue;
      bestP = factors.p;
      best = {
        kind: 'shot',
        weaponId: w.id,
        pHit: factors.p,
        // bestTargetFor's own heuristic: a quarter of side armour, whatever
        // face is presented. Soft targets always qualify.
        hurts: tType.isSoft || w.penetration >= tType.armorSide >> 2,
        factors,
      };
    }
    return best;
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/sim/src/projection.test.ts`
Expected: all pass.

If the agreement test fails with a mismatch rather than an error, that is the
important signal: the projection and the shot disagree, which is exactly the bug
this feature must not ship. Do not loosen the assertion to `toBeCloseTo` —
`toBe` is correct, because both sides are the same fixed-point integer from the
same function.

- [ ] **Step 5: Verify the whole suite and the hash**

```bash
pnpm test && pnpm test:determinism && pnpm exec tsc --noEmit && pnpm lint
```
Expected: all pass, hash still `484379662`.

- [ ] **Step 6: Export the type**

In `packages/sim/src/index.ts`, add `type HitProjection` to the export block from `./sim`.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/index.ts packages/sim/src/projection.test.ts
git commit -m "feat(sim): projectHit answers what a shot would cost, without firing

GDD 5.8 wants a hovered target to show projected P(hit). The numbers already
existed; they were only ever reported after the round left the barrel.

Eligibility mirrors bestTargetFor rather than inventing its own rules, so the
overlay can never offer a shot the unit would refuse: range band, line of sight
unless the class is indirect, not garrisoned or aboard, and identified.

The identification test is on contact confidence, not contactState. State
latches at 2 once confidence passes IDENTIFIED_AT and only falls back below the
much lower LOST_AT, so between 0.70 and 0.20 the level claims identified while
bestTargetFor skips the target. Gating on the level would have shown
projections for impossible shots across that whole band.

Returns a three-way result rather than a nullable shot, because 'you have not
identified that' and 'you cannot reach that' are different facts.

Carries the hurts heuristic too: a coax MG on a tank projects a high P(hit) and
achieves nothing, and an unqualified 85% is the exact 'indistinguishable from
bad RNG' failure 5.8 warns about.

Two tests carry the weight: the projection equals the pHit on the fire event
the sim actually produces, and a thousand projections leave the state hash
untouched — the RNG is a seeded per-entity stream and a hover must not advance
it."
```

---

### Task 3: Show it on hover

**Files:**
- Modify: `packages/render/src/renderer.ts` — beside `hoverStructure` at line 177
- Modify: `packages/render/src/overlay.ts` — constructor at line 52, and a new render method
- Modify: `packages/app/src/main.ts` — near line 550 and the `DebugOverlay` construction at line 331

**Interfaces:**
- Consumes: `projectHit(shooter, target): HitProjection` and the `HitProjection` type from Task 2; `getSelection(): number[]` already in the overlay constructor.
- Produces: user-visible behaviour only.

**Background:** the overlay is DOM over the Pixi canvas. `hoverStructure` is already plumbed exactly this way — a `() => number` callback in the `DebugOverlay` constructor (`overlay.ts:57`), fed from `main.ts:336` as `() => renderer.hoverStructure`, with the app setting `renderer.hoverStructure` from its pointer handler near `main.ts:550`. Copy that shape for `hoverEntity`; do not invent a new mechanism.

- [ ] **Step 1: Add the renderer field**

In `packages/render/src/renderer.ts`, beside `hoverStructure`:

```ts
  /** Entity under the cursor, -1 when none. Set by the app. */
  hoverEntity = -1;
```

- [ ] **Step 2: Set it from the app's pointer handler**

In `packages/app/src/main.ts`, in the same `pointermove` handler that sets `renderer.hoverStructure` near line 550, add a nearest-entity hit test. Insert after the existing `renderer.hoverStructure = hs;` line:

```ts
    // Nearest living enemy within half a tile of the cursor — the same
    // generosity the click-to-select test uses.
    let he = -1;
    let bestD = 0.5 * 0.5;
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.alive[i] === 0 || sim.state.side[i] === 0) continue;
      const dx = fx.toNumber(sim.state.posX[i]) - hw.x;
      const dy = fx.toNumber(sim.state.posY[i]) - hw.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        he = i;
      }
    }
    renderer.hoverEntity = he;
```

`hw` is the cursor in world coordinates, already computed on the line above as
`const hw = renderer.screenToWorld(hp.x, hp.y);` and used for the structure
test. Reuse it rather than recomputing.

- [ ] **Step 3: Pass the callback into the overlay**

In `packages/render/src/overlay.ts`, add a sixth constructor parameter after `hoverStructure`:

```ts
    private readonly hoverEntity: () => number = () => -1
```

In `packages/app/src/main.ts`, extend the `DebugOverlay` construction:

```ts
  const overlay = new DebugOverlay(
    document.body,
    sim,
    () => renderer.selection,
    getMission,
    () => renderer.hoverStructure,
    () => renderer.hoverEntity
  );
```

- [ ] **Step 4: Render the panel section**

In `packages/render/src/overlay.ts`, add this method beside `hoveredStructureHtml`:

```ts
  /**
   * Projected P(hit) for each selected unit against the hovered enemy.
   *
   * GDD 5.8: the player should know what a shot costs before taking it. Rows
   * are capped because selecting the whole force must not bury the map, and
   * units that cannot engage are counted rather than listed — "3 cannot reach"
   * is information, three empty rows are not.
   */
  private hoveredTargetHtml(): string {
    const t = this.hoverEntity();
    if (t < 0 || this.sim.state.alive[t] === 0) return '';
    const sel = this.getSelection().filter((i) => this.sim.state.alive[i] === 1);
    if (sel.length === 0) return '';

    const MAX_ROWS = 6;
    const rows: string[] = [];
    let cannot = 0;
    let unidentified = 0;
    for (const s of sel) {
      const p = this.sim.projectHit(s, t);
      if (p.kind === 'unidentified') {
        unidentified++;
        continue;
      }
      if (p.kind === 'noSolution') {
        cannot++;
        continue;
      }
      if (rows.length >= MAX_ROWS) continue;
      const name = this.sim.unitTypes[this.sim.state.typeIdx[s]].name;
      const pct = Math.round(fx.toNumber(p.pHit) * 100);
      // Name only the factors actually degrading the shot, worst first.
      // accuracy is the weapon's baseline, not a penalty the player can act on.
      const penalties: [string, number][] = [
        ['range', fx.toNumber(p.factors.rangeFalloff)],
        ['cover', fx.toNumber(p.factors.coverMod)],
        ['target moving', fx.toNumber(p.factors.motionMod)],
        ['firing on the move', fx.toNumber(p.factors.stanceMod)],
        ['suppressed', fx.toNumber(p.factors.suppressionMod)],
      ];
      const worst = penalties
        .filter(([, v]) => v < 0.995)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2)
        .map(([label, v]) => `${label} ${Math.round(v * 100)}%`);
      const why = worst.length > 0 ? ` · ${worst.join(' · ')}` : '';
      const bounce = p.hurts ? '' : ' · <span style="color:#D93A2B">cannot penetrate</span>';
      rows.push(`<div>${name} <b>${pct}%</b> <span style="color:#8E9491">${p.weaponId}${why}</span>${bounce}</div>`);
    }

    if (rows.length === 0 && unidentified > 0 && cannot === 0) {
      return '<div style="color:#8E9491">contact not identified — no firing solution</div>';
    }
    if (rows.length === 0) return '<div style="color:#8E9491">no unit can engage</div>';

    const shown = rows.length;
    const extra = sel.length - shown - cannot - unidentified;
    const tail: string[] = [];
    if (extra > 0) tail.push(`and ${extra} more`);
    if (cannot > 0) tail.push(`${cannot} cannot reach`);
    if (unidentified > 0) tail.push(`${unidentified} unidentified`);
    const foot = tail.length > 0 ? `<div style="color:#8E9491">${tail.join(' · ')}</div>` : '';
    return `<div style="margin-top:6px"><b>projected fire</b></div>${rows.join('')}${foot}`;
  }
```

- [ ] **Step 5: Call it where the structure panel is rendered**

Find where `hoveredStructureHtml()` is used to build the card's HTML, and append `this.hoveredTargetHtml()` alongside it in the same string. Do not create a second panel — one card.

- [ ] **Step 6: Verify it compiles and nothing regressed**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm test:determinism && pnpm build
```
Expected: all pass, hash unchanged.

- [ ] **Step 7: Verify in the running app**

Start the preview with the Browser pane tools (`lions-dev` in `.claude/launch.json`; do not run a dev server with Bash). Load `M0 sandbox (no mission)`.

Check all of these by driving the UI, not by calling methods from the console:

1. Select a tank, hover an enemy militia cell across the map → panel shows a row with a percentage and the weapon.
2. Hover an enemy that has not been identified yet (at mission start, before contact) → "contact not identified".
3. Select an infantry squad far from the enemy and hover → "no unit can engage".
4. Select several units with `ctrl+a` and hover → at most six rows, then a summary line.
5. Select a tank and hover an enemy `technical` at close range, then compare against hovering an enemy tank — confirm the `cannot penetrate` marker appears only where the heuristic says it should.
6. Move a unit and hover while it is moving → "firing on the move" appears as a factor.

Take a screenshot of a populated panel as evidence.

- [ ] **Step 8: Commit**

```bash
git add packages/render/src/renderer.ts packages/render/src/overlay.ts packages/app/src/main.ts
git commit -m "feat(render): hovering an enemy shows what each selected unit's shot would cost

One row per selected unit that can engage: its chance, the weapon, and the two
factors actually degrading the shot, worst first. accuracy is left out of that
list deliberately — it is the weapon's baseline, not something the player can
reposition to fix.

Rows cap at six with a summary tail, so ctrl+a does not bury the map, and units
that cannot engage are counted rather than listed.

Rides the existing hoverStructure plumbing rather than inventing a second
mechanism: a getter callback into the overlay, fed from the app's pointer
handler.

Also marks rows where the weapon cannot penetrate. A coax MG on a tank reads
85% and does nothing, which is precisely the failure GDD 5.8 calls
indistinguishable from bad RNG."
```

---

## Verification checklist

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:determinism   # MUST be 484379662 — this feature changes no sim behaviour
pnpm validate:data
pnpm validate:assets
pnpm build
```

And in the running sandbox:

- A hovered, identified enemy shows a percentage per capable selected unit.
- An unidentified contact shows no number.
- Out-of-range selections are counted, not listed.
- The projected percentage matches what the roll feed reports when the shot is actually taken.
