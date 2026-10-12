# N1a · Versus Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two seats in one room command OPPOSING KDF forces (seat 0 on side 0, seat 1 on side 1) on a sandbox map, each seeing only its own fog and its own force in the friendly colour, with the N0 robustness debts closed.

**Architecture:** One relation helper (`relationOf(side, viewer)`) in `@lions/render` replaces every "side 0 is the player" literal in the renderer and the app; `RendererOptions.viewerSide` carries the seat's side. The room mints a `mode: 'versus'` config (seat 1 on side 1, a per-match seed, ticket `player` split from `callsign`), and the app spawns a mirrored KDF force for each side. The ownership check gains map bounds and target existence; the room writes command-bearing frames through and keeps a watchdog alarm. No sim file is touched.

**Tech Stack:** TypeScript strict, vitest (node), three.js r170 (render only), Cloudflare Durable Objects with the Hibernation API and alarms.

**Spec:** `docs/superpowers/specs/2026-10-10-network-game-design.md` — §2.1–2.2 (config, seat versus side), §3.2.2 (clock), §3.3 (client), §3.5 (security), §5.1 (`viewerSide` and the two leaks), §9 row N1, §11a (what N0 left), §12 (tests). N0 as built is on `main` from PR #543.

## Global Constraints

- The four invariants: **no file under `packages/sim/` changes**. `pnpm test:determinism` stays green and its pins `922714084` and `3200430224` do not move.
- Dependency direction: `app → render → sim`, `app → net → sim`, `worker → net`. `packages/render` never imports `@lions/net`; the Worker never imports `@lions/sim`.
- **Viewer 0 is byte-identical to today.** With `viewerSide` absent or 0, every renderer and app path must produce exactly what it produces on `main`; the golden gate (`pnpm golden-baseline`, CI `visual`) must not move. A golden diff on this branch is a defect, not a bless.
- No battle state on the wire: the room never sees a position, HP value or fog tile.
- Single-player and the campaign keep working unchanged: `LocalTransport`, seat 0, side 0.
- Nothing stored in R2. Durable Object SQLite for the room; the alarm is the DO's own.
- UI strings through `t()`; colours only through palette keys and semantic tokens (`pnpm validate:ui`).
- Git in a worktree: `/usr/bin/git` by absolute path, one plain command per call, always with a pathspec; never `git add -A`, never `git stash`.
- Never start or kill a dev server from a subagent; never run `pnpm ui:routes` locally; test browsers start with music off (`tools/src/ui-review/music-off.ts`).
- Every check arrives with its falsification, watched red, in the task.

## Review Focus

1. **Seat 1 clicks a fogged enemy unit.** Expected: nothing is selected, and no route, range envelope or HUD card for that unit appears. Pinned in Task 4 (`pickableAt` refuses a hidden hostile).
2. **Seat 1 orders a side-0 unit through a crafted command.** Expected: dropped on both clients, hashes still equal. Pinned in Task 11 (versus two-client test).
3. **A move order to a point off the map, or a garrison into a structure id that does not exist.** Expected: dropped by the ownership check on both clients, never queued. Pinned in Task 9.
4. **The room restarts (deploy) mid-match after a frame carrying orders was sent but before its batch closed.** Expected: that frame is in storage and in any `log`, so a reconnecting client replays the same orders. Pinned in Task 10 (write-through of command frames).
5. **Single-player with no `viewerSide`.** Expected: identical behaviour to `main` everywhere. Pinned by the default-0 tests in Tasks 2–6 and by CI's golden gate.

---

## File Structure

**Create**
- `packages/render/src/relation.ts` — `Relation`, `relationOf`, `isOwnSide`, `isHostileSide`, exported from the barrel.
- `packages/render/src/three/fire-visible.ts` — `fireVisible`, the fog gate for fire VFX.
- `packages/render/src/side-literals.test.ts` — the source scan that keeps side literals out of the renderer.
- `packages/app/src/side-literals.test.ts` — the same scan for the app.
- `packages/app/src/net/versus-force.ts` — `versusSpawns`, the mirrored force.
- `packages/app/src/net/viewer.ts` — `viewerSideOf(config, seat)`.
- `docs/net/N1-mirror-match.md` — the mirror-match run protocol.

**Modify**
- `packages/render/src/api.ts` (`RendererOptions.viewerSide`), `packages/render/src/index.ts` (barrel), `packages/render/src/three/fog.ts`, `packages/render/src/three/units/observed.ts`, `packages/render/src/three/units/silhouette.ts`, `packages/render/src/three/units/pick.ts`, `packages/render/src/three/units/proxy-box.ts`, `packages/render/src/three/units/fx.ts`, `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/audio.ts`.
- `packages/app/src/main.ts`, `packages/app/src/input/pointer.ts`, `packages/app/src/ui/{hud,hud-model,minimap,alerts,alert-world,sandbox-feed,withdrew,intel-moments,stall-hint,idle}.ts`, `packages/app/src/voice/director.ts`, `packages/app/src/net/connect.ts`.
- `packages/net/src/{config,ownership,frames}.ts`.
- `packages/worker/src/match/{match-room,routes,room-core}.ts`, `packages/worker/src/do-types.ts`, `packages/worker/src/match/fake-do.ts`.
- `tools/src/net/two-client.test.ts`.

---

### Task 1: The relation helper

**Files:**
- Create: `packages/render/src/relation.ts`, `packages/render/src/relation.test.ts`
- Modify: `packages/render/src/index.ts` (append an export), `packages/render/src/api.ts` (add `viewerSide`)

**Interfaces:**
- Produces:
```ts
export type Relation = 'own' | 'hostile' | 'neutral';
export function relationOf(side: number, viewer: number): Relation;
export function isOwnSide(side: number, viewer: number): boolean;
export function isHostileSide(side: number, viewer: number): boolean;
/** The colour slot a side draws in for this viewer: 0 friendly, 1 hostile, 2 neutral. */
export function colorSlot(side: number, viewer: number): 0 | 1 | 2;
```
and `RendererOptions.viewerSide?: 0 | 1` (absent means 0).

- [ ] **Step 1: Write the failing test**

`packages/render/src/relation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { relationOf, isOwnSide, isHostileSide, colorSlot } from './relation';

describe('relationOf', () => {
  it('viewer 0 reproduces today: 0 own, 1 hostile, 2 neutral', () => {
    expect([0, 1, 2].map((s) => relationOf(s, 0))).toEqual(['own', 'hostile', 'neutral']);
    expect([0, 1, 2].map((s) => colorSlot(s, 0))).toEqual([0, 1, 2]);
  });
  it('viewer 1 swaps the combatants and keeps civilians neutral', () => {
    expect([0, 1, 2].map((s) => relationOf(s, 1))).toEqual(['hostile', 'own', 'neutral']);
    expect([0, 1, 2].map((s) => colorSlot(s, 1))).toEqual([1, 0, 2]);
  });
  it('the predicates agree with relationOf', () => {
    for (const v of [0, 1]) for (const s of [0, 1, 2]) {
      expect(isOwnSide(s, v)).toBe(relationOf(s, v) === 'own');
      expect(isHostileSide(s, v)).toBe(relationOf(s, v) === 'hostile');
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/render/src/relation.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/render/src/relation.ts`:
```ts
/**
 * Who a side is to the person looking (network design §5.1). Every place that
 * used to read "side 0 is the player" asks this instead, so the seat on side 1
 * sees its own force as friendly. Side 2 is civilians for every viewer.
 * Zero imports: the app's HUD and minimap call it too.
 */
export type Relation = 'own' | 'hostile' | 'neutral';

export function relationOf(side: number, viewer: number): Relation {
  if (side === 2) return 'neutral';
  return side === viewer ? 'own' : 'hostile';
}
export function isOwnSide(side: number, viewer: number): boolean {
  return side !== 2 && side === viewer;
}
export function isHostileSide(side: number, viewer: number): boolean {
  return side !== 2 && side !== viewer;
}
export function colorSlot(side: number, viewer: number): 0 | 1 | 2 {
  const r = relationOf(side, viewer);
  return r === 'own' ? 0 : r === 'hostile' ? 1 : 2;
}
```
Append to `packages/render/src/index.ts`:
```ts
// Network design §5.1: who a side is to the viewer. Zero imports, so the
// app's HUD and minimap share it with the renderer.
export { relationOf, isOwnSide, isHostileSide, colorSlot, type Relation } from './relation';
```
In `packages/render/src/api.ts`, inside `RendererOptions`, beside `teamColors`:
```ts
  /** The sim side the person at this screen commands (network design §5.1).
   *  Absent means 0, which is single-player and every campaign mission. */
  viewerSide?: 0 | 1;
```

- [ ] **Step 4: Run, falsify, commit**

PASS. Falsify: make `relationOf` return `'own'` for side 0 unconditionally → the viewer-1 test fails. Restore.
```bash
/usr/bin/git add packages/render/src/relation.ts packages/render/src/relation.test.ts packages/render/src/index.ts packages/render/src/api.ts
/usr/bin/git commit -m "render: relationOf and RendererOptions.viewerSide (N1a task 1)"
```

---

### Task 2: Fog and the draw gate take the viewer

**Files:**
- Modify: `packages/render/src/three/fog.ts` (`FogInput`, `computeFog` reveal line `:101` and its doc comment `:78`, `:99`), `packages/render/src/three/units/observed.ts` (`:43-49`), `packages/render/src/three/ThreeRenderer.ts` (`recomputeFog` `:4190-4206`; the three `unitIsObserved` callers `:5804`, `:6751`, `:7281`), `packages/app/src/ui/minimap.ts` (`unitIsObserved` caller `:682`)
- Test: `packages/render/src/three/fog.test.ts`, `packages/render/src/three/units/observed.test.ts` (extend; create if absent)

**Interfaces:**
- Consumes: `isOwnSide` (Task 1).
- Produces: `FogInput.viewerSide: number`; `unitIsObserved(side: number, viewer: number, wx: number, wy: number, fogVisible: (wx: number, wy: number) => boolean): boolean`; `ThreeRenderer` field `private readonly viewer: number` = `opts.viewerSide ?? 0`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/render/src/three/fog.test.ts` (reuse its existing input builder if there is one; otherwise this self-contained one):
```ts
import { computeFog, type FogInput } from './fog';

function oneUnitEach(viewerSide: number): FogInput {
  // 20x1 strip; a side-0 unit at x=2, a side-1 unit at x=17, sight 2.
  return {
    width: 20, height: 1, entityCount: 2,
    alive: new Uint8Array([1, 1]), side: new Uint8Array([0, 1]), typeIdx: new Uint16Array([0, 0]),
    posX: new Int32Array([Math.round(2.5 * 65536), Math.round(17.5 * 65536)]), posY: new Int32Array([32768, 32768]),
    sightByType: new Float64Array([2]), blocked: new Uint8Array(20), isLowProfile: () => false, viewerSide,
  };
}

describe('computeFog viewerSide', () => {
  it('reveals around the viewer\'s units only', () => {
    const f0 = computeFog(new Uint8Array(20), oneUnitEach(0));
    expect(f0[2]).toBe(2);
    expect(f0[17]).toBe(0);
    const f1 = computeFog(new Uint8Array(20), oneUnitEach(1));
    expect(f1[2]).toBe(0);
    expect(f1[17]).toBe(2);
  });
});
```
`packages/render/src/three/units/observed.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { unitIsObserved } from './observed';

describe('unitIsObserved', () => {
  const dark = () => false;
  it('own units always draw; hostile and civilian units need a lit tile', () => {
    expect(unitIsObserved(0, 0, 1, 1, dark)).toBe(true);
    expect(unitIsObserved(1, 0, 1, 1, dark)).toBe(false);
    expect(unitIsObserved(1, 1, 1, 1, dark)).toBe(true);
    expect(unitIsObserved(0, 1, 1, 1, dark)).toBe(false);
    expect(unitIsObserved(2, 1, 1, 1, dark)).toBe(false);
    expect(unitIsObserved(0, 1, 1, 1, () => true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch them fail** — `pnpm vitest run packages/render/src/three/fog.test.ts packages/render/src/three/units/observed.test.ts` → FAIL (`viewerSide` not in `FogInput`; `unitIsObserved` arity).

- [ ] **Step 3: Implement**

`fog.ts`: add to `FogInput`:
```ts
  /** The side whose units reveal (network design §5.1); 0 in single-player. */
  readonly viewerSide: number;
```
destructure it in `computeFog`, and change the reveal line to:
```ts
    if (alive[i] === 0 || side[i] !== viewerSide) continue;
```
Rewrite the two doc lines to say "Only living units on the VIEWER's side reveal" (the rule did not change for viewer 0).

`observed.ts`:
```ts
import { isOwnSide } from '../../relation';

export function unitIsObserved(
  side: number,
  viewer: number,
  wx: number,
  wy: number,
  fogVisible: (wx: number, wy: number) => boolean
): boolean {
  return isOwnSide(side, viewer) || fogVisible(wx, wy);
}
```
`ThreeRenderer.ts`: add `private readonly viewer: number;` and in the constructor `this.viewer = opts.viewerSide ?? 0;`. In `recomputeFog` add `viewerSide: this.viewer,` to the `FogInput` literal. The three callers become `unitIsObserved(st.side[i], this.viewer, x, z, this.fogVisibleAt)` (keep each call's own coordinate names).

`minimap.ts:682`: `unitDots` gains a third parameter `viewer: number` (default `0`) and calls `unitIsObserved(st.side[i], viewer, x, y, isVisible)`. Its caller in `minimap.ts` passes the minimap's own viewer, which Task 6 wires; until then pass `0`.

- [ ] **Step 4: Run, typecheck, falsify, commit**

`pnpm vitest run packages/render packages/app/src/ui/minimap && pnpm typecheck` → green. Falsify: in `computeFog` use `side[i] !== 0` again → the viewer-1 fog test fails. Restore.
```bash
/usr/bin/git add packages/render/src/three/fog.ts packages/render/src/three/fog.test.ts packages/render/src/three/units/observed.ts packages/render/src/three/units/observed.test.ts packages/render/src/three/ThreeRenderer.ts packages/app/src/ui/minimap.ts
/usr/bin/git commit -m "render: fog reveals and the draw gate admit the viewer's side (N1a task 2)"
```

---

### Task 3: Every renderer side literal reads the viewer

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/units/silhouette.ts` (`silhouetteSideIndex` `:352-355`), `packages/render/src/three/units/proxy-box.ts` (`:145`), `packages/render/src/three/units/fx.ts` (`:821`, `:1038`), `packages/render/src/audio.ts` (`:2235`)
- Create: `packages/render/src/side-literals.test.ts`

**Interfaces:**
- Consumes: `relationOf`, `isOwnSide`, `isHostileSide`, `colorSlot` (Task 1); `this.viewer` (Task 2).
- Produces: `silhouetteSideIndex(side: number, viewer: number): 0 | 1 | 2`; `ProxyBoxBatch` and the tracer/shell batches index colours by `colorSlot(side, viewer)`; `AudioDirector` gains `setViewer(side: number): void` (default 0).

The rule for every site: **a sim accessor that takes a side gets `this.viewer`; a comparison `side === 0` becomes `isOwnSide(side, this.viewer)`; `side === 1` (as "enemy") becomes `isHostileSide(side, this.viewer)`; a colour array indexed by a raw side is indexed by `colorSlot(side, this.viewer)`.** Side-2 checks (civilians, `:9484`) stay as they are.

- [ ] **Step 1: Write the failing guard test**

`packages/render/src/side-literals.test.ts`:
```ts
// Keeps "side 0 is the player" out of the renderer (network design §5.1).
// Reads the SOURCE: the point is that no new literal can be written, which no
// behavioural test of today's sites can promise.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PATTERNS: RegExp[] = [
  /\b(contactLevel|tunnelContactLevel|sideSeesTile|markerSeesTile)\(\s*0\s*,/,
  /side(\[[^\]]+\])?\s*[!=]==\s*[01]\b/,
  /\.side\s*[!=]==\s*[01]\b/,
  /teamColors\[\s*[01]\s*\]/,
];
/** Lines that are allowed: a comment, or a civilian (side 2) check. */
const allowed = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line) || /===\s*2\b|!==\s*2\b/.test(line);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe('no side literal in packages/render', () => {
  it('finds none outside comments and civilian checks', () => {
    const hits: string[] = [];
    for (const f of files(ROOT)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!allowed(line) && PATTERNS.some((p) => p.test(line))) hits.push(`${f.slice(ROOT.length)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run packages/render/src/side-literals.test.ts` → FAIL, listing roughly twenty sites. Keep that list in the task report; it is the checklist for Step 3.

- [ ] **Step 3: Replace every site**

Line numbers are `main` at `2cab662e`; find each by its text if it moved.

`ThreeRenderer.ts`:
- Tunnels `:3933`, `:3940`, `:3987`, `:3991`, `:4028`, `:4032`, `:4033`: replace the literal `0` argument with `this.viewer`. Update the `:3920` comment to "the viewer's side, as the trail's is".
- Tunnel discovery beat `:4326`: `e.side === 0` → `e.side === this.viewer`.
- Fire link `:4634`: `st.side[e.shooter] === 0` → `isOwnSide(st.side[e.shooter], this.viewer)`.
- Overlay-loop gate `:9083`: `side !== 0 && !this.isVisible(ix, iy)` → `!isOwnSide(side, this.viewer) && !this.isVisible(ix, iy)`.
- Air-shadow `:9122-9124`: `if (side !== 0)` → `if (!isOwnSide(side, this.viewer))`; `this.sim.contactLevel(0, i)` → `this.sim.contactLevel(this.viewer, i)`.
- Contact mark `:9211`: `if (side === 1) this.pushContactMark(anchor, type, r, this.sim.contactLevel(0, i), markScale);` → `if (isHostileSide(side, this.viewer)) this.pushContactMark(anchor, type, r, this.sim.contactLevel(this.viewer, i), markScale);`
- Contact-mark colour `:8984`: `this.opts.teamColors[1]` is the HOSTILE SLOT, which stays slot 1 for every viewer: rewrite as `this.opts.teamColors[colorSlot(1 - this.viewer, this.viewer)]` only if the guard flags it; otherwise leave `[1]` with a comment `// the hostile slot, whoever is watching` and add the line to the guard's allowlist by appending `|| /hostile slot/.test(line)` to `allowed`. Prefer the comment: the slot index is a colour slot, not a side.
- HP bar `:9168`: `hpBarColorKey(hpRatio, side === 0)` → `hpBarColorKey(hpRatio, isOwnSide(side, this.viewer))`.
- Chevron `:9254`: `st.side[i] === 0 && stripes > 0` → `isOwnSide(st.side[i], this.viewer) && stripes > 0`.
- Building holder `:9295`, `:9304`, `:9333`: `holder` is a SIDE; `friendlyStructure = (occ > 0 && isOwnSide(holder, this.viewer)) || isOwnSide(stype.producesFor, this.viewer)`; `const col = this.opts.teamColors[colorSlot(holder, this.viewer)];`.
- Raw side-indexed colours `:8718`, `:8813`, `:8840`, `:8856`, `:9222`, `:9449`: each `teamColors[side]` / `teamColors[st.side[x]]` → `teamColors[colorSlot(side, this.viewer)]` (fallbacks unchanged).
- `new ProxyBoxBatch(this.scene, this.opts.teamColors)` `:5824`: pass a slot function: `new ProxyBoxBatch(this.scene, this.opts.teamColors, (side) => colorSlot(side, this.viewer))`.

`silhouette.ts`: `silhouetteSideIndex(side: number, viewer: number): 0 | 1 | 2 { return colorSlot(side, viewer); }` and its caller `silhouetteMaterialFor(side)` passes `this.viewer`.

`proxy-box.ts:145`: the constructor takes `slotOf: (side: number) => number` (default `(s) => s`); `this.teamLinear[slotOf(e.side)] ?? this.teamLinear[1] ?? [1, 0, 1]`.

`fx.ts:821`, `:1038`: tracer and shell colour pairs are `[own, hostile]`. Thread a `viewer` into the two batches' constructors (default 0) and index `tracerColors[isOwnSide(t.side, viewer) ? 0 : 1]`. Pass `this.viewer` where `ThreeRenderer` constructs them (`:8283` and the tracer batch beside it).

`audio.ts:2235`: `const player = (id: number): boolean => id >= 0 && side[id] === this.viewer;` with `private viewer = 0;` and `setViewer(side: number): void { this.viewer = side; }`. Task 5 calls it.

- [ ] **Step 4: Run the guard, the render suite and typecheck**

`pnpm vitest run packages/render && pnpm typecheck` → green, guard empty. If a site cannot be expressed through the helpers, it is a design question: stop and report it rather than allowlisting it.

- [ ] **Step 5: Falsify and commit**

Falsify the guard: put back `sim.tunnelContactLevel(0, r)` at one site → the guard names that line. Restore.
```bash
/usr/bin/git add packages/render/src/three/ThreeRenderer.ts packages/render/src/three/units/silhouette.ts packages/render/src/three/units/proxy-box.ts packages/render/src/three/units/fx.ts packages/render/src/audio.ts packages/render/src/side-literals.test.ts
/usr/bin/git commit -m "render: every side literal reads the viewer; a source guard keeps them out (N1a task 3)"
```

---

### Task 4: The two leaks — picking hidden units, and fire seen through fog

**Files:**
- Modify: `packages/render/src/three/units/pick.ts` (`:49-88`, `:183`), `packages/render/src/three/ThreeRenderer.ts` (`pickUnit` `:5372-5383`, `unitAtScreen` `:5386-5401`, `unitsInScreenRect`, `drawsEnvelope` `:8962-8967`, route block `:9519-9536`, `onFire` `:4601-4897`, `drawFireLinkOverlays` `:8794-8815`, charge rings `:9374-9383`)
- Create: `packages/render/src/three/fire-visible.ts`, `packages/render/src/three/fire-visible.test.ts`
- Test: `packages/render/src/three/units/pick.test.ts` (extend)

**Interfaces:**
- Produces: pick functions take `pickable: (i: number) => boolean`; `fireVisible(shooterSide: number, viewer: number, shooterSeen: boolean, targetSeen: boolean): boolean`.

- [ ] **Step 1: Write the failing tests**

`packages/render/src/three/fire-visible.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fireVisible } from './fire-visible';

describe('fireVisible', () => {
  it('own fire always draws', () => {
    expect(fireVisible(1, 1, false, false)).toBe(true);
  });
  it('hostile fire draws when the shooter or the impact is in sight, never otherwise', () => {
    expect(fireVisible(0, 1, true, false)).toBe(true);
    expect(fireVisible(0, 1, false, true)).toBe(true);
    expect(fireVisible(0, 1, false, false)).toBe(false);
  });
  it('viewer 0 keeps today\'s own-fire behaviour', () => {
    expect(fireVisible(0, 0, false, false)).toBe(true);
  });
});
```
Extend `pick.test.ts` with a case: two units under the cursor, the nearer one excluded by `pickable` → the function returns the farther one; with `pickable = () => false` it returns -1. Use the file's existing fixture builder and add `pickable` as its last argument.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

`fire-visible.ts`:
```ts
import { isOwnSide } from '../relation';

/** Network design §5.1's second leak: a shot fired out of sight drew its
 *  tracer, flash and smoke on the other player's screen. Own fire always
 *  draws; hostile fire draws when either end of it is in sight. Audio is not
 *  gated: hearing distant fire is realistic and leaks no position the sound
 *  falloff does not. */
export function fireVisible(shooterSide: number, viewer: number, shooterSeen: boolean, targetSeen: boolean): boolean {
  return isOwnSide(shooterSide, viewer) || shooterSeen || targetSeen;
}
```
`pick.ts`: the pick and rect functions gain a final parameter `pickable: (i: number) => boolean = () => true` and `continue` when `!pickable(i)`. In `ThreeRenderer`:
```ts
  /** A unit the viewer may select: their own, or another they can see (§5.1). */
  private readonly pickable = (i: number): boolean =>
    unitIsObserved(this.sim.state.side[i], this.viewer, this.curX[i], this.curY[i], this.fogVisibleAt);
```
and pass it through `pickUnit`, `unitAtScreen` and `unitsInScreenRect`. `drawsEnvelope` and the route block add `if (!isOwnSide(st.side[i], this.viewer)) continue;` — a selected hostile shows neither its route nor its envelope. In `onFire`, compute once at the top:
```ts
    const seen = fireVisible(st.side[e.shooter], this.viewer,
      this.isVisible(this.curX[e.shooter], this.curY[e.shooter]), this.isVisible(tx, ty));
```
(using the target point `tx, ty` the function already computes) and wrap every visual spawn in `if (seen)`: tracer `:4637`, missile `:4766`, burst `:4783`, shell `:4793`, flash light `:4842`, muzzle flash `:4878`, particles `:4895`, backblast `:4674`. Leave the audio and the `linked` flag as they are. `drawFireLinkOverlays` and the charge rings add `if (!unitIsObserved(st.side[i], this.viewer, this.curX[i], this.curY[i], this.fogVisibleAt)) continue;` for the unit they decorate.

- [ ] **Step 4: Run, typecheck, falsify, commit**

`pnpm vitest run packages/render && pnpm typecheck` → green. Falsify: `fireVisible` returning `true` always → the hostile-out-of-sight test fails. Restore.
```bash
/usr/bin/git add packages/render/src/three/fire-visible.ts packages/render/src/three/fire-visible.test.ts packages/render/src/three/units/pick.ts packages/render/src/three/units/pick.test.ts packages/render/src/three/ThreeRenderer.ts
/usr/bin/git commit -m "render: a hidden enemy cannot be picked, and hostile fire out of sight draws nothing (N1a task 4)"
```

---

### Task 5: The app's selection and orders follow the seat's side

**Files:**
- Create: `packages/app/src/net/viewer.ts`, `packages/app/src/net/viewer.test.ts`, `packages/app/src/side-literals.test.ts`
- Modify: `packages/app/src/main.ts` (sites below), `packages/app/src/input/pointer.ts` (`:77`, `:120`), `packages/app/src/ui/idle.ts` (`:43`)
- Test: `packages/app/src/input/pointer.test.ts` and `packages/app/src/ui/idle.test.ts` (extend; create if absent)

**Interfaces:**
- Consumes: `isOwnSide`, `isHostileSide` from `@lions/render`; `MatchConfig`, `Seat` from `@lions/net`.
- Produces: `viewerSideOf(config: MatchConfig | null, seat: Seat | null): 0 | 1`; in `main.ts` a `const me = viewerSideOf(netConfig, netSeat);` passed to the renderer as `viewerSide: me`, to `audio.setViewer(me)`, and to every site below; `hostileUnder(sim, wx, wy, isVisible, viewer: number = 0)`; the idle filter takes `viewer`.

- [ ] **Step 1: Write the failing tests**

`packages/app/src/net/viewer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { MatchConfig } from '@lions/net';
import { viewerSideOf } from './viewer';

const seat = (s: 0 | 1, side: 0 | 1) => ({ seat: s, side, faction: 'kdf' as const, kit: 'matched' as const, tiers: {}, unlocks: [], player: 'p', callsign: 'c', kind: 'human' as const });
const config = (side1: 0 | 1): MatchConfig => ({
  matchId: 'm', code: 'ABCDEF', seed: 1, map: 'x', mode: 'versus', seats: [seat(0, 0), seat(1, side1)],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
});

describe('viewerSideOf', () => {
  it('is 0 in single-player', () => { expect(viewerSideOf(null, null)).toBe(0); });
  it('is the seat\'s own side in a room', () => {
    expect(viewerSideOf(config(1), 1)).toBe(1);
    expect(viewerSideOf(config(1), 0)).toBe(0);
    expect(viewerSideOf(config(0), 1)).toBe(0);
  });
});
```
`packages/app/src/side-literals.test.ts`: the same scanner as Task 3's, rooted at `packages/app/src`, scanning `main.ts`, `input/`, `ui/` and `voice/` only. `tutorial/`, `telemetry/`, `mission-log.ts` and `hold-outside.ts` are single-player by construction and go in a `SINGLE_PLAYER_ONLY` array at the top of the test with a one-line reason each. Copy the Task 3 test body verbatim and change only `ROOT`, the directory filter and the exclusion list. Add a `PENDING_TASK_6` array of the file names Task 6 owns (`ui/hud.ts`, `ui/hud-model.ts`, `ui/minimap.ts`, `ui/alerts.ts`, `ui/alert-world.ts`, `ui/sandbox-feed.ts`, `ui/withdrew.ts`, `ui/intel-moments.ts`, `ui/stall-hint.ts`, `voice/director.ts`) that the scan skips; Task 6 empties it.

Extend `pointer.test.ts`: with `viewer = 1`, `hostileUnder` finds a side-0 unit under the cursor and ignores a side-1 one. Extend `idle.test.ts`: with `viewer = 1` the idle list holds side-1 units only.

- [ ] **Step 2: Run and watch them fail** — the guard lists the remaining `main.ts`, `pointer.ts` and `idle.ts` sites; the other tests fail on missing parameters.

- [ ] **Step 3: Implement**

`packages/app/src/net/viewer.ts`:
```ts
import type { MatchConfig, Seat } from '@lions/net';

/** The sim side this screen commands (network design §5.1): the seat's own
 *  side in a room, 0 everywhere else (single-player, every mission). */
export function viewerSideOf(config: MatchConfig | null, seat: Seat | null): 0 | 1 {
  if (config === null || seat === null) return 0;
  return config.seats[seat].side;
}
```
In `main.ts`, right after `const netConfig = match.config;`: `const me = viewerSideOf(netConfig, netSeat);`. Add `viewerSide: me` to the `RendererOptions` the battlefield builds, and call `audio.setViewer(me)` where `audio` is created. Then, with `isOwnSide` and `isHostileSide` imported from `@lions/render`, replace (lines on `main` at `2cab662e`; find by text if moved):
- `:2608-2609` `myLiving`: `renderer.selection.filter((i) => isOwnSide(sim.state.side[i], me) && sim.state.alive[i] === 1)`.
- `:2677` halt, `:3854-3856` box select, `:4085` select-all, `:4165` idle cycle, `:4296-4297` control groups, `:5280-5283` `hoverCanGarrison`, `:5313` friendly hover, `:5377` cursor, `:2827`, `:2835` (the own-force count): `sim.state.side[i] === 0` → `isOwnSide(sim.state.side[i], me)`, and `!== 0` → `!isOwnSide(...)`.
- `:2845` (any hostile pinned): `sim.state.side[i] === 1` → `isHostileSide(sim.state.side[i], me)`.
- `:3850-3851` click select: no change here; the renderer's `pickable` (Task 4) already refuses a hidden hostile.
- `:5349` (tutorial projection), `:3065` (feedback), `:4765` (outcome beat): single-player only. Add a trailing comment `// single-player: no room reaches here` on each, and extend the guard's `allowed` with `|| /single-player: no room/.test(line)`.

`pointer.ts`: `hostileUnder(sim, wx, wy, isVisible, viewer = 0)`; `:77` becomes `if (sim.state.alive[i] === 0 || !isHostileSide(sim.state.side[i], viewer)) continue;`. Its caller at `:120` passes the view's viewer: add `viewer: number` to the view object `pointer.ts` already receives, and set it from `me` in `main.ts`.

`idle.ts:43`: the filter takes `viewer` and tests `isOwnSide(f.side, viewer)`; `main.ts` passes `me`.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app && pnpm typecheck && pnpm lint` → green, the guard empty apart from `PENDING_TASK_6`. Falsify: restore `sim.state.side[i] === 0` in `myLiving` → the guard names it. Restore.
```bash
/usr/bin/git add packages/app/src/net/viewer.ts packages/app/src/net/viewer.test.ts packages/app/src/side-literals.test.ts packages/app/src/main.ts packages/app/src/input/pointer.ts packages/app/src/input/pointer.test.ts packages/app/src/ui/idle.ts packages/app/src/ui/idle.test.ts
/usr/bin/git commit -m "app: selection, orders and hover follow the seat's side (N1a task 5)"
```

---

### Task 6: HUD, minimap, alerts and voice follow the seat's side

**Files:**
- Modify: `packages/app/src/ui/hud.ts` (`:1996`, `:2103`, `:2215`, `:2221`, `:2346`, `:2384`), `packages/app/src/ui/hud-model.ts` (`:304`), `packages/app/src/ui/minimap.ts` (`:334`, `:656-661`, `:682-684`, `:1251`), `packages/app/src/ui/alerts.ts` (`:302`, `:360`, `:366`, `:379`, `:387`, `:397`, `:407`, `:416`), `packages/app/src/ui/alert-world.ts` (`:85`), `packages/app/src/ui/sandbox-feed.ts` (`:34-35`), `packages/app/src/ui/withdrew.ts` (`:10`), `packages/app/src/ui/intel-moments.ts` (`:235`, `:328`, `:402`, `:406`), `packages/app/src/ui/stall-hint.ts` (`:67`), `packages/app/src/voice/director.ts` (`:407`, `:484`), `packages/app/src/side-literals.test.ts` (empty `PENDING_TASK_6`), `packages/app/src/main.ts` (wiring)
- Test: `packages/app/src/ui/minimap.test.ts`, `packages/app/src/ui/alerts.test.ts` (extend)

**Interfaces:**
- Consumes: `me` (Task 5); `colorSlot`, `isOwnSide`, `isHostileSide`, `relationOf`, `Relation`.
- Produces: each module that compared against 0 or 1 takes a `viewer: number` (a constructor dependency or a function parameter, default 0), named `viewer` everywhere; `MinimapDot` carries `relation: Relation` for its shape and colour.

- [ ] **Step 1: Write the failing tests**

`minimap.test.ts`: with `viewer = 1`, `unitDots` returns a side-1 unit as `'square'` (own) and a side-0 unit on a lit tile as `'triangle'` (hostile), and `suspected` reads `sim.contactLevel(1, i)`. Use the sim stub the file already has and add the side-1 unit. The side-1 dot's colour is `teamColors[colorSlot(1, 1)]`, which is slot 0.
`alerts.test.ts`: with `viewer = 1`, a `removed` event for a side-1 unit raises the "unit lost" alert, and one for a side-0 unit does not.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

Apply Task 3's rule at every listed line: `=== 0` → `isOwnSide(x, viewer)`, `!== 0` → `!isOwnSide(x, viewer)`, `=== 1` / `!== 1` meaning the enemy → `isHostileSide(x, viewer)` / `!isHostileSide(x, viewer)`, a sim accessor's literal `0` → `viewer`, `teamColors[d.side]` → `teamColors[colorSlot(d.side, viewer)]`. In `minimap.ts`, `dotShape(side, suspected)` becomes `dotShape(relation: Relation, suspected)`: `'own'` → `'square'`, `'hostile'` and suspected → `'hollow'`, `'hostile'` → `'triangle'`, `'neutral'` unchanged. `sandbox-feed.ts:35` emits `side: viewer` in its synthesised `unitLost`. Wire `viewer: me` into each module's construction in `main.ts`.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app && pnpm typecheck && pnpm lint && pnpm validate:ui` → green, the guard empty with `PENDING_TASK_6 = []`. Falsify: restore one `alerts.ts` literal → the guard names it and the viewer-1 alert test fails. Restore.
```bash
/usr/bin/git add packages/app/src/ui/hud.ts packages/app/src/ui/hud-model.ts packages/app/src/ui/minimap.ts packages/app/src/ui/minimap.test.ts packages/app/src/ui/alerts.ts packages/app/src/ui/alerts.test.ts packages/app/src/ui/alert-world.ts packages/app/src/ui/sandbox-feed.ts packages/app/src/ui/withdrew.ts packages/app/src/ui/intel-moments.ts packages/app/src/ui/stall-hint.ts packages/app/src/voice/director.ts packages/app/src/side-literals.test.ts packages/app/src/main.ts
/usr/bin/git commit -m "app: HUD, minimap, alerts and voice follow the seat's side (N1a task 6)"
```

---

### Task 7: The mirrored force, and each seat's camera on its own camp

**Files:**
- Create: `packages/app/src/net/versus-force.ts`, `packages/app/src/net/versus-force.test.ts`, `packages/app/src/net/versus-world.test-helper.ts`, `packages/app/src/sandbox-place.ts`
- Modify: `packages/app/src/main.ts` (`sandboxSpawns` `:402-467` uses `placeOnOpen`; the call `:1858-1862`; the camera start `:3382-3386`)

**Interfaces:**
- Consumes: `SANDBOX_KDF` from `../sandbox-force`; `SandboxAnchors` from `../sandbox-anchors`; `hostileFacing` from `../sandbox-facing`.
- Produces:
```ts
// sandbox-place.ts
export function placeOnOpen(sim: Sim, typeOf: Map<string, number>): (id: string, side: number, x: number, y: number, facing?: number) => number;
// versus-force.ts
export interface VersusForce { bySide: [number[], number[]] }
export function versusSpawns(sim: Sim, typeOf: Map<string, number>, anchors: SandboxAnchors): VersusForce;
export function campOf(anchors: SandboxAnchors, side: 0 | 1): readonly [number, number];
```

- [ ] **Step 1: Write the failing test**

`versus-world.test-helper.ts`: a `buildWorld(mapId)` returning `{ sim, typeOf, map }`, a bare `Sim` (seed 20260727, capacity 256) on the map with `applyTerrain`, its structures and every unit type registered. Copy the recipe from `tools/src/walk_world.ts` (read it; take only the world-building lines) rather than inventing one.

`versus-force.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { versusSpawns, campOf } from './versus-force';
import { SANDBOX_KDF } from '../sandbox-force';
import { sandboxAnchors } from '../sandbox-anchors';
import { buildWorld } from './versus-world.test-helper';

describe('versusSpawns', () => {
  for (const mapId of ['beit_sahwan_outskirts', 'tel_marum']) {
    it(`fields the same KDF force on each side, nothing else, on open ground (${mapId})`, () => {
      const { sim, typeOf, map } = buildWorld(mapId);
      const force = versusSpawns(sim, typeOf, sandboxAnchors(map));
      expect(force.bySide[0]).toHaveLength(SANDBOX_KDF.length);
      expect(force.bySide[1]).toHaveLength(SANDBOX_KDF.length);
      for (let i = 0; i < sim.entityCount; i++) {
        expect([0, 1]).toContain(sim.state.side[i]);
        const tx = sim.state.posX[i] >> 16;
        const ty = sim.state.posY[i] >> 16;
        expect(sim.blocked[ty * sim.width + tx]).toBe(0);
      }
    });
  }
  it('is deterministic: two worlds spawn identical states', () => {
    const a = buildWorld('beit_sahwan_outskirts');
    const b = buildWorld('beit_sahwan_outskirts');
    versusSpawns(a.sim, a.typeOf, sandboxAnchors(a.map));
    versusSpawns(b.sim, b.typeOf, sandboxAnchors(b.map));
    expect(a.sim.hash()).toBe(b.sim.hash());
  });
  it('each side\'s camp is its own anchor', () => {
    const anchors = { friendly: [5, 24] as const, hostile: [40, 24] as const };
    expect(campOf(anchors, 0)).toEqual([5, 24]);
    expect(campOf(anchors, 1)).toEqual([40, 24]);
  });
});
```
(Use the sim's actual public names for entity count and positions — `entityCount`, `state.posX` — as the N0 code does.)

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

Move `sandboxSpawns`' inner `open` and `spawn` helpers out of `main.ts` into `sandbox-place.ts` as `placeOnOpen(sim, typeOf)`, returning the `spawn` function, and have `sandboxSpawns` call it. Its behaviour must be byte for byte the same: the existing sandbox tests and `sandbox-anchors.pinned.json` guard that.

`versus-force.ts`:
```ts
import type { Sim } from '@lions/sim';
import { SANDBOX_KDF } from '../sandbox-force';
import type { SandboxAnchors } from '../sandbox-anchors';
import { hostileFacing } from '../sandbox-facing';
import { placeOnOpen } from '../sandbox-place';

export interface VersusForce { bySide: [number[], number[]] }

/** The mirror match (network design §9, N1): the sandbox's KDF force on each
 *  side, side 1's offsets mirrored through its own anchor so the two forces
 *  face each other in the same formation. No Sarim, no civilians: in a room
 *  the only opposition is the other seat. */
export function versusSpawns(sim: Sim, typeOf: Map<string, number>, anchors: SandboxAnchors): VersusForce {
  const place = placeOnOpen(sim, typeOf);
  const [ax, ay] = anchors.friendly;
  const [bx, by] = anchors.hostile;
  const faceA = hostileFacing(bx, by, ax, ay);   // side 0 looks at side 1
  const faceB = hostileFacing(ax, ay, bx, by);   // side 1 looks at side 0
  const bySide: [number[], number[]] = [[], []];
  for (const [id, dx, dy] of SANDBOX_KDF) bySide[0].push(place(id, 0, ax + dx, ay + dy, faceA));
  for (const [id, dx, dy] of SANDBOX_KDF) bySide[1].push(place(id, 1, bx - dx, by - dy, faceB));
  return { bySide };
}

export function campOf(anchors: SandboxAnchors, side: 0 | 1): readonly [number, number] {
  return side === 0 ? anchors.friendly : anchors.hostile;
}
```
In `main.ts`: when `netConfig?.mode === 'versus'`, call `versusSpawns(sim, typeOf, anchors)` instead of `sandboxSpawns(...)` and set `sandboxForce = { player: force.bySide[me], civilians: [] }`. Camera start: after the mission branch at `:3382-3386`, add `else if (netConfig !== null) { const [cx, cy] = campOf(anchors, me); renderer.camera.x = cx; renderer.camera.y = cy; }`.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/app && pnpm typecheck` → green, every existing sandbox test unchanged. Falsify: spawn side 1 with `+dx, +dy` → on `tel_marum` a unit lands off its open ground or the two forces overlap; at least one assertion fails. If none does, the test is not checking the mirror: add an assertion that side 1's centroid is nearer the hostile anchor than the friendly one, and watch that fail instead. Restore.
```bash
/usr/bin/git add packages/app/src/net/versus-force.ts packages/app/src/net/versus-force.test.ts packages/app/src/net/versus-world.test-helper.ts packages/app/src/sandbox-place.ts packages/app/src/main.ts
/usr/bin/git commit -m "app: the mirror match spawns a KDF force per side; each seat starts on its own camp (N1a task 7)"
```

---

### Task 8: The room mints a versus match

**Files:**
- Modify: `packages/worker/src/match/match-room.ts` (`RoomMeta`, `/create`, `/join`, `mintConfig`, the hello's `seatJoin` call `:302-303`), `packages/worker/src/match/routes.ts` (bodies and tickets), `packages/app/src/net/connect.ts`, `packages/app/src/main.ts` (the boot guard `:1418-1420`; `ConnectDeps.store`)
- Create: `packages/app/src/net/player-id.ts`, `packages/app/src/net/player-id.test.ts`
- Test: `packages/worker/src/match/match-room.test.ts`, `packages/worker/src/match/routes.test.ts`, `packages/app/src/net/connect.test.ts` (extend)

**Interfaces:**
- Produces: `RoomMeta` gains `mode: 'sandbox' | 'versus'`, `seed: number`, `callsigns: [string, string]`; create body `{ player, callsign, map, build, mode }`; join body `{ player, callsign }`; the ticket's `player` is the player id; `ConnectDeps.store: Pick<Storage, 'getItem' | 'setItem'> | null`; `connectMatch` reads `?mode=versus` (default `sandbox`).
- `playerId(store: Pick<Storage, 'getItem' | 'setItem'> | null, mint?: () => string): string`.

- [ ] **Step 1: Write the failing tests**

`match-room.test.ts` (with `fake-do.ts`): create with `mode: 'versus'`, join, both hello and ready → the `start` config has `mode: 'versus'`, `seats[0].side === 0`, `seats[1].side === 1`, both `faction: 'kdf'`, and the callsigns sent at create and join. Two versus rooms created in a row get different seeds. A `sandbox` room still mints both seats on side 0 with seed `20260727` (N0's behaviour, kept for the two-machine protocol).
`routes.test.ts`: the ticket's `player` is the body's `player`, not its callsign; a missing or empty `player` answers 400.
`player-id.test.ts`: the first call mints and stores; the second returns the stored id; a store whose `setItem` throws still returns an id, the same one on a second call.
`connect.test.ts`: `?net=new&mode=versus` posts `mode: 'versus'` and a `player`.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

`/create` reads `mode` (`'versus'`, else `'sandbox'`) and `player` (`textField`, required), and stores `meta = { map, build, mode, seed, callsigns: [callsign, ''], seat1Reserved: false }`, where `seed = mode === 'versus' ? (crypto.getRandomValues(new Uint32Array(1))[0] | 0) : SIM_SEED_N0`. `/join` stores `callsigns[1]`. `mintConfig` uses `meta.seed` and `meta.mode`, `side: meta.mode === 'versus' ? seat : 0`, and `callsign: meta.callsigns[seat]`. The hello calls `seatJoin(st, ticket.seat, ticket.player, this.meta?.callsigns[ticket.seat] ?? '', now, () => this.readLog())`; delete the "N1 splits them" comment. `routes.ts` passes `player` and `callsign` separately to `/create` and `/join` and signs the ticket with `player`.

`player-id.ts`:
```ts
const KEY = 'lions.versus.player';
let sessionOnly: string | null = null;

/** The anonymous player id a seat ticket carries (network design §4). Its own
 *  key, so the telemetry opt-out stays honest. ST5 replaces it with a
 *  Steam-validated id in the same ticket field. */
export function playerId(
  store: Pick<Storage, 'getItem' | 'setItem'> | null,
  mint: () => string = () => crypto.randomUUID()
): string {
  try {
    const have = store?.getItem(KEY);
    if (have) return have;
    const id = mint();
    store?.setItem(KEY, id);
    return id;
  } catch {
    sessionOnly ??= mint();
    return sessionOnly;
  }
}
```
`connect.ts` adds `player: playerId(deps.store)` and `mode` to the bodies; `main.ts` passes `store` as a guarded `window.localStorage` (property access in a `try`, `null` on a throw). `main.ts:1419`'s error text changes from "N0: a room runs the sandbox only" to "a room runs Free Play only".

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/worker packages/app/src/net && pnpm typecheck` → green. Falsify: mint `side: 0` for both seats in versus → the versus start test fails. Restore.
```bash
/usr/bin/git add packages/worker/src/match/match-room.ts packages/worker/src/match/match-room.test.ts packages/worker/src/match/routes.ts packages/worker/src/match/routes.test.ts packages/app/src/net/connect.ts packages/app/src/net/connect.test.ts packages/app/src/net/player-id.ts packages/app/src/net/player-id.test.ts packages/app/src/main.ts
/usr/bin/git commit -m "worker+app: versus rooms put seat 1 on side 1 with a per-match seed; ticket player split from callsign (N1a task 8)"
```

---

### Task 9: Ownership checks the map and the target

**Files:**
- Modify: `packages/net/src/ownership.ts`, `packages/app/src/net/frame-step.ts` (`seatWorldFor` `:53`)
- Test: `packages/net/src/ownership.test.ts`, `packages/app/src/net/frame-step.test.ts`, `tools/src/net/two-client.test.ts` (its `worldFor`)

**Interfaces:**
- Produces: `SeatWorld` gains `readonly width: number; readonly height: number; structureExists(id: number): boolean; tunnelExists(id: number): boolean;`. `seatWorldFor(config, sim)` fills them from the sim's width and height and its public structure and tunnel counts. Read `packages/sim/src/sim.ts` for the existing public names; do not add any to the sim.

- [ ] **Step 1: Write the failing tests**

Add to `ownership.test.ts`, with the test's `world` extended by `width: 48, height: 48, structureExists: (id) => id === 3, tunnelExists: (id) => id === 0`:
```ts
const F = 65536;
it('drops a point off the map', () => {
  expect(validateCommand({ kind: 'move', ids: [1], x: 10 * F, y: 10 * F }, 0, world)).toBe(true);
  expect(validateCommand({ kind: 'move', ids: [1], x: -1, y: 10 * F }, 0, world)).toBe(false);
  expect(validateCommand({ kind: 'move', ids: [1], x: 48 * F, y: 10 * F }, 0, world)).toBe(false);
  expect(validateCommand({ kind: 'smoke', ids: [1], x: 10 * F, y: 99 * F }, 0, world)).toBe(false);
  expect(validateCommand({ kind: 'callStrike', caller: 1, x: 10 * F, y: -F }, 0, world)).toBe(false);
});
it('drops a structure or tunnel id that does not exist', () => {
  expect(validateCommand({ kind: 'garrison', ids: [1], structure: 3 }, 0, world)).toBe(true);
  expect(validateCommand({ kind: 'garrison', ids: [1], structure: 4 }, 0, world)).toBe(false);
  expect(validateCommand({ kind: 'demolish', ids: [1], structure: -1 }, 0, world)).toBe(false);
  expect(validateCommand({ kind: 'chargeTunnel', ids: [1], tunnel: 0 }, 0, world)).toBe(true);
  expect(validateCommand({ kind: 'chargeTunnel', ids: [1], tunnel: 7 }, 0, world)).toBe(false);
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

In `validateCommand`, before the switch:
```ts
  const onMap = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < world.width * 65536 && y < world.height * 65536;
```
Add `&& onMap(cmd.x, cmd.y)` to `move`, `attackMove`, `smoke`, `reveal` and `callStrike`; `&& world.structureExists(cmd.structure)` to `garrison` and `demolish`; `&& world.tunnelExists(cmd.tunnel)` to `chargeTunnel`. `seatWorldFor` and the two-client test's `worldFor` fill the four new members.

- [ ] **Step 4: Run, falsify, commit**

`pnpm vitest run packages/net packages/app/src/net tools/src/net && pnpm typecheck` → green; the two-client test still passes, since its orders are on the map. Falsify: drop `&& onMap(...)` from `move` → the off-map test fails. Restore.
```bash
/usr/bin/git add packages/net/src/ownership.ts packages/net/src/ownership.test.ts packages/app/src/net/frame-step.ts packages/app/src/net/frame-step.test.ts tools/src/net/two-client.test.ts
/usr/bin/git commit -m "net: ownership refuses off-map points and missing structure or tunnel ids (N1a task 9)"
```

---

### Task 10: The room writes command frames through and keeps a watchdog alarm

**Files:**
- Modify: `packages/worker/src/match/match-room.ts` (`record`, `ensureClock`, a new `alarm()`, the header comment's R36 paragraph), `packages/worker/src/do-types.ts` (`DurableStorageLike`), `packages/worker/src/match/fake-do.ts` (`FakeStorage`)
- Test: `packages/worker/src/match/match-room.test.ts`, `packages/worker/src/match/room-loop.test.ts`

**Interfaces:**
- Produces: `DurableStorageLike` gains `setAlarm(scheduledTime: number): Promise<void>; getAlarm(): Promise<number | null>; deleteAlarm(): Promise<void>;`; `FakeStorage` implements them over a field `alarmAt: number | null`; `MatchRoom.alarm(): Promise<void>`; `export const WATCHDOG_MS = 1000`.

Why (spec §11a). **R36:** frames after the last closed batch lived in memory only, so a restart re-minted those ticks, and a re-minted copy of a frame that had carried orders lost the orders on both clients. Writing every frame that carries commands through to storage at once means only empty frames can be re-minted, and an empty re-mint equals the original. **R38:** the 50 ms `setInterval` dies with an eviction and restarts only on the next socket event; a 1 s storage alarm restarts it without anyone's help.

- [ ] **Step 1: Write the failing tests**

In `match-room.test.ts`, using the helpers `match-room.test.ts` and `room-loop.test.ts` already have for "create, join, hello both, ready both" and "run one clock tick" (add to `fake-do.ts` only what is missing, every test hook commented `test-only` and unused by production code):
- **Write-through:** seat 0 sends one `halt`; after one clock tick, the frame carrying it is in a persisted batch row.
- **Revive:** seat 0 sends one `halt`; three clock ticks; a NEW `MatchRoom` over the same `FakeStorage` reads its log; exactly one frame in it carries a command, at the tick it was first minted.
- **Alarm armed:** while the match runs, `storage.alarmAt` is not null; after a `bye`, it is null.
- **Alarm restarts the clock:** with the interval cleared (the test kills it through the room's own `ensureClock` path by ending and re-starting nothing; if no clean hook exists, construct a new `MatchRoom` over the running storage, which has no interval yet), calling `alarm()` leaves a running interval and a re-armed alarm.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

`record(frame)`: after `this.open.push(frame)`, add `if (frame.cmds.length > 0) this.writeOpenBatch();` before the batch-full check. `ensureClock()`: when it starts the interval, also `void this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);`; when it stops it, `void this.ctx.storage.deleteAlarm();`. New handler:
```ts
  /** R38: the watchdog. An eviction kills `setInterval`; a storage alarm
   *  survives it. Re-arms itself while the match lives. */
  async alarm(): Promise<void> {
    try {
      const st = await this.begin();
      if (st && (st.status === 'running' || st.status === 'stalled')) {
        await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
      }
    } finally {
      this.ensureClock();
    }
  }
```
Rewrite the header's R36 paragraph: command-bearing frames are written through, so only empty frames can be re-minted after a restart.

- [ ] **Step 4: Run, measure, falsify, commit**

`pnpm vitest run packages/worker && pnpm typecheck` → green. Re-run the room's simulated-match row count (the N0 budget test reading `rowsWritten` in `room-loop.test.ts`) with one order a second from each seat, and record rows per second in the task report; it must stay under 2 a second (Workers Free allows 100,000 rows a day). Falsify: remove the write-through line → the write-through and revive tests fail. Restore.
```bash
/usr/bin/git add packages/worker/src/match/match-room.ts packages/worker/src/match/match-room.test.ts packages/worker/src/match/room-loop.test.ts packages/worker/src/do-types.ts packages/worker/src/match/fake-do.ts
/usr/bin/git commit -m "worker: command frames written through (R36) and a watchdog alarm (R38) (N1a task 10)"
```

---

### Task 11: The versus two-client test and the mirror-match protocol

**Files:**
- Modify: `tools/src/net/two-client.test.ts`
- Create: `docs/net/N1-mirror-match.md`

**Interfaces:**
- Consumes: `versusSpawns` and `buildWorld` (Task 7), the Task 9 `SeatWorld`, `applyFrame`, `LockstepClock`.

- [ ] **Step 1: Write the test**

Add `describe('versus: two sides, one frame stream')` to `two-client.test.ts`. Build two worlds with Task 7's `buildWorld('beit_sahwan_outskirts')`, spawn `versusSpawns` in each, and run 1,000 ticks of a script in which seat 0 orders side-0 units toward the hostile camp and seat 1 orders side-1 units toward the friendly camp, plus one crafted command at tick 50 from seat 1 naming a side-0 unit. Use a `SeatWorld` with `sideOfSeat: (s) => s` and the Task 9 members. Assert:
- hashes are equal on every tick;
- `applyFrame` reports exactly one drop, at tick 50, on both runs;
- the final hash differs from the same run with seat 1's orders removed (the orders did something).

- [ ] **Step 2: Run, falsify**

PASS once Tasks 7 and 9 are in. Falsify: `sideOfSeat: () => 0` → the crafted command is accepted and "exactly one drop" fails. Restore.

- [ ] **Step 3: Write the protocol**

`docs/net/N1-mirror-match.md`:
```markdown
# N1 · The mirror match

**What it is:** two seats, two KDF forces, one map. Seat 0 commands side 0 at
the map's friendly camp, seat 1 commands side 1 at the hostile camp, and each
sees only its own fog. N1b adds the lobby; until then a room is opened by URL.

## Open a match
1. Window A: `/free-play/beit_sahwan_outskirts?net=new&mode=versus&callsign=A`.
   The URL rewrites to `?net=<CODE>&seat=0`.
2. Window B: `/free-play/beit_sahwan_outskirts?net=<CODE>&callsign=B`.
3. Keep both windows side by side and visible: a hidden tab stalls the room.

## What to check
- Each window sees its own force in the friendly colour at its own camp, and
  the other force only where its own units can see.
- Clicking an enemy hidden in fog selects nothing. Enemy fire out of sight
  draws no tracer or flash; you still hear it.
- At the end, before either window closes, run `__lions.net()` in both
  consoles and paste both on the N1 issue. Pass: `desyncTick: null` on both,
  and `hashOk.count` near `tickCount / 20`.
```

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add tools/src/net/two-client.test.ts docs/net/N1-mirror-match.md
/usr/bin/git commit -m "tools+docs: the versus two-client test and the mirror-match protocol (N1a task 11)"
```

---

## Self-review

**Spec coverage (N1 per §9 and §11a, the core half):** `viewerSide` through fog, the draw gate and every renderer and app literal (Tasks 1–6); both leaks closed (Task 4); the mirrored force and per-seat camera (Task 7); seat 1 on side 1, a per-match seed, the player id split from the callsign (Task 8); §11a's coordinate and target checks (Task 9), R36 and R38 (Task 10); the CI test and the run protocol (Task 11). **Left to N1b by design:** the `/versus` route and lobby with the code on screen (the black waiting page the lead hit on 12 Oct), pause and surrender, rejoin after a reload, the desync report to D1, chat and pings. **Left to N2:** seat tiers onto the sim (`brigade` kit needs per-seat unit types). **Open:** the Firefox WebGL2 reading on CI.

**Placeholders:** none. Two steps send the implementer to an existing file for a name instead of inventing one (Task 7's world recipe from `tools/src/walk_world.ts`; Task 9's structure and tunnel counts from `packages/sim/src/sim.ts`), and both forbid adding to the sim.

**Type consistency:** `viewer` is the parameter name everywhere and `me` the one value in `main.ts`; `relationOf`, `isOwnSide`, `isHostileSide`, `colorSlot` and `Relation` are defined once (Task 1) and imported from `@lions/render`; `SeatWorld`'s four new members are defined and filled in Task 9; `placeOnOpen` is defined in Task 7 and used by both spawners.

**Review Focus pins:** 1 → Task 4; 2 → Task 11; 3 → Task 9; 4 → Task 10; 5 → the default-0 cases in Tasks 1, 2 and 5, and CI's golden gate (Global Constraints).
