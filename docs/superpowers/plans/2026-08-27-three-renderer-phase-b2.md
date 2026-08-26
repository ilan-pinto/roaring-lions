# three.js Renderer — Phase B2: terrain as a height mesh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the whole map under `?renderer=three` — ground, elevation, decor, buildings — as real 3D geometry whose colours are provably palette entries.

**Architecture:** Every pixel of terrain logic lives in **pure builder functions** that take plain arrays and return plain arrays. `ThreeRenderer` turns their output into `BufferGeometry` and adds it to the scene, and does nothing else. That is what makes terrain testable in CI at all: `ThreeRenderer` constructs a `WebGLRenderer` in its constructor and cannot exist under `environment: 'node'`.

**Tech Stack:** TypeScript (strict), three.js 0.170, Vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-08-26-three-renderer-design.md`
**What B1 handed over (read this first):** `docs/superpowers/specs/2026-08-26-phase-b1-outcome.md`

## Global Constraints

- **Branch:** `feat/three-renderer`, in the worktree at `.claude/worktrees/three-renderer`. Never touch the primary tree at `~/dev/roaring-lions` — other sessions work there with uncommitted files.
- **Never run** `git reset --hard`, `git checkout <branch>`, `git stash`, `git add -A`, or `git commit -a`. Stage explicit paths.
- `@lions/sim` must not change. No file under `packages/sim/`. `data/` must not change.
- TypeScript strict mode. No `any`. No non-null assertions.
- Green on `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:ui` at every task boundary.
- `pnpm validate:ui` has **no allowlist** and reads `#` + three hex digits as a colour literal. It scans `packages/app/src` and `packages/render/src/overlay.ts` only — `packages/render/src/three/` is not scanned, which is why B1's palette hexes needed no handling. Still write `issue 123`, never `#123`, in prose.
- **Pixi stays the default renderer throughout B2.** `?renderer=three` is opt-in. Nothing a default-path player sees may change. Any edit to `renderer.ts` must be provably behaviour-preserving.
- **`ThreeRenderer` stays out of `packages/render/src/index.ts`.** It has its own entry point and is dynamically imported. Re-exporting it from the barrel puts all of three.js back in the default player's main chunk — that regression was live through all of B1 and cost 464 kB.
- `tsconfig.base.json` sets `noUnusedLocals`/`noUnusedParameters`; ESLint has no `argsIgnorePattern: '^_'`, so `_`-prefixed placeholders are lint errors.
- **Shared machine.** Stop background processes by their own PID, never `pkill -f <pattern>`. Create your own browser tab and pass its `tabId` explicitly; never navigate the active tab.
- Baseline entering B2: **901 tests / 54 files**, all green.

---

## Five rulings this plan is built on

**1. Pure builders, not an injected renderer.** B1 left this as B2's first decision. Terrain logic goes in `packages/render/src/three/terrain/*.ts` as functions over plain arrays returning plain arrays — no `THREE.Mesh`, no `WebGLRenderer`, no DOM. `ThreeRenderer` is a thin adapter that calls them and uploads the result.
*Why:* it is the only option that puts terrain under `pnpm test`. Injecting the renderer would make the tests need a GL context, which `environment: 'node'` cannot provide, and the spec's promise that picking and scene contents are tested in CI would stay unmet for a second phase running.
*Cost if wrong:* none identified. A pure builder can always be wrapped; a renderer-coupled one cannot be unwrapped.

**2. Terrain vertex colours are palette entries, always — and the composite is quantised, not reproduced.** Pixi layers alpha fills: open ground at `0.92 + rnd * 0.08`, a road tone at `0.85` over that, `underBuilding` at `0.22` over that. **Those composites are not palette colours.** Reproducing them faithfully would make the three.js backend emit off-palette values on most of the screen, destroying the guarantee Phase 0 measured and B1 installed.
So: compute Pixi's composite on the CPU at build time, then **snap it to the nearest entry in `data/palette.json`**. The mesh carries palette bytes and nothing else, and a test asserts it directly — *every vertex colour of a built terrain mesh is a palette entry*.
*Why this is the honest reading of "Pixi's flat tones":* the tones Pixi uses **are** palette entries; only its blending is not. Drawing them flat is what was asked for, and quantising is what makes "flat" true rather than approximate.
*Cost if wrong:* terrain reads in slightly fewer distinct tones than Pixi's continuous jitter. If that turns out to look banded, the fix is a longer ramp in `palette.json` — a data change, not a code change.

**3. A tile top is a flat quad at its own height. Terraces, not ramps.** Elevation is per tile, so corners are not interpolated between neighbours. This matches Pixi exactly: `groundOffset` samples "at the containing tile rather than interpolated across the four corners", deliberately, so a unit crossing a terrace steps up rather than ramping.
*Cost if wrong:* smooth slopes are a later change to one builder, and the sim never sees either.

**4. World height per elevation level is derived, not chosen.** Pixi lifts a tile by `ELEV_STEP = 10` **screen pixels** per level. Three.js works in world units. The bridge already exists — B1's `WORLD_Y_PER_LIFT_PIXEL` in `camera.ts` — so world height per level is `ELEV_STEP * WORLD_Y_PER_LIFT_PIXEL`, and a ridge stands exactly as tall on screen in both backends.
*Cost if wrong:* one constant, and the conformance suite would catch a mismatch immediately.

**5. Depth comes from the depth buffer. `zIndex`, `depthZ`, `bandZ` and `bandKey` are not ported.** Pixi fakes occlusion by sorting display objects on `x + y`, with a special band mechanism so raised tiles cover units behind them. In three.js a canopy occludes a soldier because it is geometrically in front of him.
*Why it matters now, with no units on screen until B3:* the four elevation debts in `CLAUDE.md` — VFX not lifted to terrain height, extruded terrain not occluding units, picking untested mid-slope, and wrecks/tracers sorting under a ridge they stand in front of — are all one missing depth buffer wearing four hats. B2 is where that stops being true.
*Cost if wrong:* none. The Pixi path keeps its own machinery untouched.

---

## What B2 does NOT do

- **No lighting.** Materials are unlit with vertex colours, per the chosen look. `toonRampMaterial` from B1 stays unused until units arrive in B3 — B2 does not wire it up, and the first GLSL compile of it is still B3's risk.
- **No units, no fog, no VFX, no overlays.** B3 and B4.
- **No structure sprites.** Buildings draw in their block form for every structure, including those with art. Sprited structures are billboards, which is B3's subject.
- **No golden-image diff.** Phase C/D. B2's parity check is positional, per the terrain decision: three.js terrain is deliberately not pixel-identical to Pixi's.

---

## File Structure

| file | responsibility |
|---|---|
| `packages/render/src/tile-hash.ts` | **new.** `tileHash(x, y)` — the deterministic per-tile hash, extracted verbatim from `PixiRenderer.h2` so both backends scatter identically. |
| `packages/render/src/three/terrain/ground.ts` | **new.** Pure. Tile tops and elevation side faces → positions, indices, colours. |
| `packages/render/src/three/terrain/tones.ts` | **new.** Pure. Pixi's alpha composites resolved and quantised to palette entries. |
| `packages/render/src/three/terrain/scatter.ts` | **new.** Pure. Grain, cover rubble, knolls, ridges, ruts. |
| `packages/render/src/three/terrain/grove.ts` | **new.** Pure. Trunk and crown geometry. |
| `packages/render/src/three/terrain/buildings.ts` | **new.** Pure. Block form, roof clutter, damage wear, wrecks. |
| `packages/render/src/three/terrain/mesh.ts` | **new.** The one adapter: builder output → `THREE.BufferGeometry` + `THREE.Mesh`. The only file in `terrain/` that imports three. |
| `packages/render/src/three/ThreeRenderer.ts` | modified. `setElevation`/`setDecor` stop being retained-and-unused. |

Every `terrain/*.ts` file except `mesh.ts` has a colocated `*.test.ts` and imports nothing from three.js.

---

## Shared types every task uses

Define these in `packages/render/src/three/terrain/ground.ts` in Task B2.1; later tasks import them.

```ts
/** Plain-array geometry. No three.js types, so builders stay headless. */
export interface MeshData {
  /** xyz triples, three.js world space: game tile (x, y) -> (x, height, y). */
  positions: Float32Array;
  /** rgb triples in 0..1, one per vertex. Always a palette entry. */
  colors: Float32Array;
  indices: Uint32Array;
}

/** Everything a terrain builder is allowed to read. */
export interface TerrainInput {
  width: number;
  height: number;
  /** Per tile, TERRAIN_DECOR values. */
  decor: Uint8Array | null;
  /** Per tile, 0-9. Absent means flat. */
  elevation: Uint8Array | null;
  blocked: Uint8Array;
  cover: Uint8Array;
}
```

---

## Task B2.1: the tile hash, extracted

**Files:**
- Create: `packages/render/src/tile-hash.ts`, `packages/render/src/tile-hash.test.ts`
- Modify: `packages/render/src/renderer.ts` (replace the private static with a call to the shared one)

**Interfaces:**
- Produces: `tileHash(x: number, y: number): number` — 0..1, deterministic.

This task exists on its own because it touches `renderer.ts`, the default player's renderer, and that edit must be provably behaviour-neutral. Every later task depends on it and none of them should be carrying that risk.

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/tile-hash.test.ts`:

```ts
/**
 * The ground's grain is deterministic: the same tile scatters the same way
 * every run, in both backends. That is the whole point of a hash here rather
 * than a PRNG -- terrain is rebuilt whenever it goes dirty, and a stream would
 * give a different map each time.
 *
 * These values were captured from PixiRenderer.h2 before it was extracted. If
 * they change, three.js terrain stops landing where Pixi's does.
 */
import { describe, it, expect } from 'vitest';
import { tileHash } from './tile-hash';

describe('tileHash', () => {
  it('is stable for known tiles', () => {
    // Replace these with the values you capture in Step 2 -- do not invent them.
    expect(tileHash(0, 0)).toBeCloseTo(CAPTURED_0_0, 12);
    expect(tileHash(7, 13)).toBeCloseTo(CAPTURED_7_13, 12);
    expect(tileHash(47, 47)).toBeCloseTo(CAPTURED_47_47, 12);
  });

  it('stays inside 0..1', () => {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const h = tileHash(x, y);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });

  it('differs between neighbouring tiles', () => {
    // A hash that returned a smooth function of x and y would pass the range
    // check above while making every tile look like its neighbour.
    expect(tileHash(4, 4)).not.toBeCloseTo(tileHash(5, 4), 3);
    expect(tileHash(4, 4)).not.toBeCloseTo(tileHash(4, 5), 3);
  });
});
```

- [ ] **Step 2: Capture the real values before extracting**

Do **not** guess the constants. Run the existing implementation and print them:

```bash
npx tsx -e "
const h2 = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
console.log(h2(0,0), h2(7,13), h2(47,47));
"
```

Paste the printed values into the test in place of `CAPTURED_*`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/render/src/tile-hash.test.ts`
Expected: FAIL — `Failed to resolve import "./tile-hash"`.

- [ ] **Step 4: Create the module**

```ts
/**
 * Deterministic per-tile hash for ground variation -- same look every run.
 *
 * Extracted from `PixiRenderer.h2` unchanged. It lives here because the three.js
 * backend has to scatter its grain onto the same tiles in the same places: two
 * hashes that merely both look random would put a limestone fleck in a different
 * spot in each backend, and every comparison between them would show noise no
 * one could attribute.
 */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
```

- [ ] **Step 5: Point `renderer.ts` at it**

`renderer.ts` has 28 call sites of `PixiRenderer.h2` and one private static definition near line 1290. Import `tileHash` and replace the **body** of the private static so every existing call site is untouched:

```ts
private static h2(x: number, y: number): number {
  return tileHash(x, y);
}
```

Keeping the private static as a one-line forwarder is deliberate: it makes this a two-line diff instead of a 28-site rewrite of the default player's renderer, and the risk of a behaviour change drops to nothing.

- [ ] **Step 6: Prove the Pixi path is unchanged**

Run: `npx vitest run packages/render` and `pnpm test`
Expected: PASS, 901 + 3 = **904 tests / 55 files**.

Then confirm the forwarder really forwards:

```bash
npx tsx -e "
const { tileHash } = await import('./packages/render/src/tile-hash.ts');
const old = (x, y) => { let h = (x*374761393 + y*668265263)|0; h = Math.imul(h ^ (h>>>13), 1274126177); return ((h ^ (h>>>16))>>>0)/4294967296; };
let worst = 0;
for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) worst = Math.max(worst, Math.abs(tileHash(x,y) - old(x,y)));
console.log('worst difference over 40,000 tiles:', worst);
"
```

Expected: exactly `0`. Report the number.

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/tile-hash.ts packages/render/src/tile-hash.test.ts packages/render/src/renderer.ts
git commit -m "refactor(render): the tile hash both backends need, in one place"
```

---

## Task B2.2: tones, composited and quantised to the palette

**Files:**
- Create: `packages/render/src/three/terrain/tones.ts`, `packages/render/src/three/terrain/tones.test.ts`

**Interfaces:**
- Consumes: `TerrainTones` from `../../api`, `tileHash` from `../../tile-hash`.
- Produces:
  - `composite(base: string, over: string, alpha: number): string` — sRGB-space blend, hex in, hex out.
  - `quantise(hex: string, palette: readonly string[]): string` — nearest palette entry.
  - `groundTone(input: TerrainInput, tones: TerrainTones, ti: number, palette: readonly string[]): string`
  - `PALETTE_HEXES: readonly string[]` — every colour in `data/palette.json`, flattened.

This is ruling 2 made concrete, and it is the task that keeps the palette guarantee alive through terrain.

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/three/terrain/tones.test.ts`:

```ts
/**
 * Pixi layers alpha fills to tint the ground: open at 0.92-1.00 by tile hash,
 * a road tone at 0.85 over that, underBuilding at 0.22 over that. The composite
 * of two palette entries is NOT a palette entry, so reproducing Pixi's blending
 * faithfully would put off-palette colour across most of the screen -- the exact
 * thing Phase 0 measured and Phase B1 installed a pipeline to prevent.
 *
 * So we composite the way Pixi does, then snap to the nearest palette entry.
 * The look survives; the guarantee survives with it.
 */
import { describe, it, expect } from 'vitest';
import { composite, quantise, PALETTE_HEXES } from './tones';

describe('composite', () => {
  it('at alpha 1 returns the top colour', () => {
    expect(composite('#C8B494', '#14150F', 1).toUpperCase()).toBe('#14150F');
  });

  it('at alpha 0 returns the base colour', () => {
    expect(composite('#C8B494', '#14150F', 0).toUpperCase()).toBe('#C8B494');
  });

  it('at alpha 0.5 lands between the two on every channel', () => {
    const mid = composite('#000000', '#FFFFFF', 0.5);
    const r = parseInt(mid.slice(1, 3), 16);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
  });
});

describe('quantise', () => {
  it('returns a palette entry unchanged', () => {
    for (const hex of PALETTE_HEXES.slice(0, 12)) {
      expect(quantise(hex, PALETTE_HEXES).toUpperCase()).toBe(hex.toUpperCase());
    }
  });

  it('always returns something from the palette', () => {
    // The property that matters: no input can produce an off-palette output.
    for (let i = 0; i < 200; i++) {
      const hex =
        '#' +
        ((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6).toUpperCase();
      expect(PALETTE_HEXES.map((h) => h.toUpperCase())).toContain(
        quantise(hex, PALETTE_HEXES).toUpperCase()
      );
    }
  });

  it('picks a near colour rather than an arbitrary one', () => {
    // A near-black input must not come back as the palette's lightest entry.
    const got = quantise('#000001', PALETTE_HEXES);
    const lum = (h: string) =>
      parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(got)).toBeLessThan(120);
  });
});

describe('PALETTE_HEXES', () => {
  it('is read from data/palette.json rather than transcribed', () => {
    // A transcribed copy goes stale silently the first time the palette changes.
    expect(PALETTE_HEXES.length).toBeGreaterThan(40);
    for (const h of PALETTE_HEXES) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/render/src/three/terrain/tones.test.ts`
Expected: FAIL — `Failed to resolve import "./tones"`.

- [ ] **Step 3: Implement**

`PALETTE_HEXES` must be derived from `data/palette.json` by importing it, not transcribed. `packages/data` already exposes the palette; check what it exports before adding a new reader — a second parser is a second thing to go stale.

`composite` blends in plain sRGB byte space, which is what Pixi's alpha fills do. Do **not** convert to linear here: the goal is to reproduce the number Pixi produces, then quantise it.

`quantise` uses squared Euclidean distance in RGB. That is not perceptually ideal and does not need to be — the inputs are always near-misses of palette entries by construction, so the nearest entry is unambiguous.

`groundTone` reproduces Pixi's per-tile decision from `drawTerrain`, in this order, then quantises once at the end:

| tile | Pixi source | composite |
|---|---|---|
| open, stone scatter | `renderer.ts:1514-1518` | `open` at `0.92 + rnd * 0.08` |
| open, sward scatter | same | `open` at `0.96 + rnd * 0.04` |
| road | `renderer.ts:1522-1525` | open wash, then `road` at `0.85` |
| under a sprited structure | `renderer.ts:1489-1491` | `open` at `0.92 + rnd * 0.08`, then `underBuilding` at `0.22` |
| blocked, ridge decor | `renderer.ts:1439-1452` | `rock` at `0.92` |

`rnd` is `tileHash(x, y)`. The base beneath the first fill is the renderer's clear colour, `RendererOptions.background`; take it as a parameter rather than importing it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/render/src/three/terrain/tones.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/three/terrain/tones.ts packages/render/src/three/terrain/tones.test.ts
git commit -m "feat(render): terrain tones that composite like Pixi and stay in the palette"
```

---

## Task B2.3: the ground mesh — tile tops and elevation faces

**Files:**
- Create: `packages/render/src/three/terrain/ground.ts`, `packages/render/src/three/terrain/ground.test.ts`

**Interfaces:**
- Consumes: `tileHash`, `groundTone`/`quantise`/`PALETTE_HEXES` from `./tones`, `TerrainTones` from `../../api`.
- Produces: `MeshData`, `TerrainInput` (the shared types above), and
  `buildGround(input: TerrainInput, tones: TerrainTones, background: string): MeshData`
  `WORLD_PER_LEVEL: number` — world units of height per elevation level.

- [ ] **Step 1: Export the height constant from `camera.ts` first**

`camera.ts` has `WORLD_Y_PER_LIFT_PIXEL` as a module-local. Export it, and add to `ground.ts`:

```ts
import { WORLD_Y_PER_LIFT_PIXEL } from '../camera';
import { ELEV_STEP } from '../../renderer';

/**
 * World units of height per elevation level.
 *
 * Derived, not chosen. Pixi raises a tile by ELEV_STEP screen pixels per level;
 * three.js works in world units, and WORLD_Y_PER_LIFT_PIXEL is the bridge B1
 * solved for. Going through it means a four-level ridge stands exactly as tall
 * on screen in both backends, and it keeps ELEV_STEP the single place that
 * number is decided.
 */
export const WORLD_PER_LEVEL = ELEV_STEP * WORLD_Y_PER_LIFT_PIXEL;
```

Importing `ELEV_STEP` from `renderer.ts` pulls Pixi into the three chunk. **Check whether it does** — if `renderer.ts` has module-level Pixi imports, move `ELEV_STEP` to `project.ts` (which is Pixi-free) and re-export it from `renderer.ts` for existing importers, exactly the shape B1.1 used for `RendererOptions`. Report which you did.

- [ ] **Step 2: Write the failing test**

Create `packages/render/src/three/terrain/ground.test.ts`:

```ts
/**
 * The ground mesh is where the palette guarantee either holds across the whole
 * screen or quietly stops applying. These tests assert it directly.
 */
import { describe, it, expect } from 'vitest';
import { buildGround, WORLD_PER_LEVEL } from './ground';
import { PALETTE_HEXES } from './tones';
import type { TerrainInput } from './ground';

const TONES = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'] as [string, string, string],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone' as const,
};

function flat(w: number, h: number): TerrainInput {
  return {
    width: w, height: h, decor: null, elevation: null,
    blocked: new Uint8Array(w * h), cover: new Uint8Array(w * h),
  };
}

describe('buildGround', () => {
  it('emits two triangles per tile on flat ground', () => {
    const m = buildGround(flat(4, 4), TONES, '#14150F');
    expect(m.indices.length).toBe(4 * 4 * 6);
  });

  it('every vertex colour is a palette entry', () => {
    // The guarantee. Phase 0 proved a LUT makes off-palette output
    // unrepresentable for shaded geometry; this is the equivalent claim for
    // terrain, which is unlit and carries its colour per vertex.
    const m = buildGround(flat(8, 8), TONES, '#14150F');
    const entries = new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));
    for (let i = 0; i < m.colors.length; i += 3) {
      const hex =
        '#' +
        [0, 1, 2]
          .map((k) => Math.round(m.colors[i + k] * 255).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      expect(entries).toContain(hex);
    }
  });

  it('puts a tile at the height its elevation says', () => {
    const input = flat(2, 1);
    input.elevation = new Uint8Array([0, 3]);
    const m = buildGround(input, TONES, '#14150F');
    let maxY = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]);
    expect(maxY).toBeCloseTo(3 * WORLD_PER_LEVEL, 10);
  });

  it('maps game (x, y) to three (x, height, y)', () => {
    // The world-space convention every later sub-plan depends on. If this
    // flips, terrain and units disagree about which way south is.
    const input = flat(2, 2);
    const m = buildGround(input, TONES, '#14150F');
    let maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      maxX = Math.max(maxX, m.positions[i]);
      maxZ = Math.max(maxZ, m.positions[i + 2]);
    }
    expect(maxX).toBeCloseTo(2, 10);
    expect(maxZ).toBeCloseTo(2, 10);
  });

  it('adds a side face only where a neighbour is lower', () => {
    // Two tiles at the same height share an internal edge with nothing to show.
    // Pixi sizes each face to the DROP for exactly this reason -- sizing off
    // absolute height drew a wall along the shared edge and left a visible
    // crack across what should read as one continuous slope.
    const level = flat(2, 1);
    level.elevation = new Uint8Array([2, 2]);
    const stepped = flat(2, 1);
    stepped.elevation = new Uint8Array([2, 0]);
    expect(buildGround(stepped, TONES, '#14150F').indices.length).toBeGreaterThan(
      buildGround(level, TONES, '#14150F').indices.length
    );
  });

  it('treats off-map as elevation zero, so a rim tile shows its full face', () => {
    const rim = flat(1, 1);
    rim.elevation = new Uint8Array([4]);
    const m = buildGround(rim, TONES, '#14150F');
    expect(m.indices.length).toBeGreaterThan(6);
  });

  it('is deterministic', () => {
    const a = buildGround(flat(6, 6), TONES, '#14150F');
    const b = buildGround(flat(6, 6), TONES, '#14150F');
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/render/src/three/terrain/ground.test.ts`
Expected: FAIL — `Failed to resolve import "./ground"`.

- [ ] **Step 4: Implement**

Each tile is a quad at `(x, x+1)` by `(y, y+1)` in three.js X/Z, at height `elevation[ti] * WORLD_PER_LEVEL`, two triangles, four vertices, all four carrying the same colour from `groundTone`. Do not share vertices between tiles — adjacent tiles differ in both height and colour, so shared vertices would interpolate across a terrace edge and produce an off-palette gradient, breaking the guarantee the second test asserts.

Side faces: for each tile, compare against the neighbour at `x + 1` and the neighbour at `y + 1`, exactly as `renderer.ts:1410` and `:1421` do. Where this tile is higher, emit a vertical quad of height `drop * WORLD_PER_LEVEL`. Off the map edge, treat the neighbour as elevation 0. Face colour is `quantise(composite(background, tones.rock, 0.7))` for the `x + 1` face and `0.85` for the `y + 1` face, matching Pixi's two alphas — the two faces differ so a ridge reads as mass rather than a flat shape.

Strata banding, the lit top edge, and scree at the foot (`drawSlopeFace`, `renderer.ts:1308-1350`) are **not** in this task. They are marks, and marks are Task B2.4.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/render/src/three/terrain/ground.test.ts`
Expected: PASS, 7 new tests.

- [ ] **Step 6: Commit**

```bash
git add packages/render/src/three/terrain/ground.ts packages/render/src/three/terrain/ground.test.ts packages/render/src/three/camera.ts
git commit -m "feat(render): the ground as real geometry, terraced and in-palette"
```

---

## Task B2.4: into the renderer — the map appears

**Files:**
- Create: `packages/render/src/three/terrain/mesh.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts`

**Interfaces:**
- Consumes: `MeshData` from `./ground`.
- Produces: `toGeometry(data: MeshData): THREE.BufferGeometry`, `terrainMaterial(): THREE.Material`.

This is the first task with something to look at, and it pays B1's outstanding debt: the palette has been proven byte-exact only for the clear colour, because nothing shader-drawn existed.

- [ ] **Step 1: Write `mesh.ts`**

`toGeometry` sets `position` and `color` as `BufferAttribute`s and the index. `terrainMaterial` returns a `THREE.MeshBasicMaterial({ vertexColors: true })` — **unlit**, per the chosen look, which also means the vertex colours reach the framebuffer unmultiplied.

Vertex colours are consumed by three.js in the working colour space. B1's `applyPalettePipeline` sets `outputColorSpace` to pass-through, and `paletteColorNoConvert` exists for exactly this. **Verify by readback, not by reasoning** — Step 4 is where that happens, and it is the point of this task.

- [ ] **Step 2: Wire it into `ThreeRenderer`**

`setElevation` and `setDecor` currently retain their argument and return. They keep retaining — but now also mark terrain dirty. Build the mesh lazily on the first `frame()` after a change, not inside the setter: both setters are called during boot, in an order this class does not control, and building on the first setter would build from half the data.

Dispose the old geometry when rebuilding. A rebuilt terrain that leaks its predecessor is invisible until a mission rebuilds terrain a few hundred times.

- [ ] **Step 3: Run the gate**

`pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui`. No new tests here — this file cannot be tested headless, which is the whole reason Tasks B2.2 and B2.3 exist.

- [ ] **Step 4: Prove the palette on a DRAWN fragment**

This is the task's real deliverable. In a browser tab you created yourself, with an explicit `tabId`:

1. `?sandbox=1&renderer=three` — the map is visible.
2. Read back a pixel that is **terrain**, not the clear colour — pick a tile centre away from the map edge, project it with `__lions.renderer.worldToScreen`, and `readPixels` there from a rAF callback registered *after* the app's own loop callback (that is the only window where `readPixels` returns real content with `preserveDrawingBuffer: false` — B1 established this).
3. Assert the byte you read is a palette entry.

Report the exact colour and the tile you sampled. If it is off palette, that is a real failure of the pipeline on drawn geometry and it is this task's job to find out why — do not proceed past it.

4. Compare against `?sandbox=1` side by side. The maps must be in the **same place**: same tiles, same elevation silhouette, same layout. Colours will differ slightly (quantisation) and there is no grain yet. Report what you see.

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/three/terrain/mesh.ts packages/render/src/three/ThreeRenderer.ts
git commit -m "feat(render): the map is on screen under ?renderer=three"
```

---

## Task B2.5: grain, cover, knolls, ridges, ruts

**Files:**
- Create: `packages/render/src/three/terrain/scatter.ts`, `packages/render/src/three/terrain/scatter.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts` (add the scatter mesh)

**Interfaces:**
- Produces: `buildScatter(input: TerrainInput, tones: TerrainTones, background: string): MeshData`
  `screenOffsetToWorld(dx: number, dy: number): { dx: number; dy: number }`

Pixi's scatter offsets are all in **screen pixels** relative to a tile centre. In three.js the marks lie on the ground plane, so every offset needs converting once. `screenOffsetToWorld` is that conversion — the inverse of `isoX`/`isoY` — and it lets every Pixi offset be ported verbatim and land in the same spot.

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/three/terrain/scatter.test.ts`. Assert, at minimum:

```ts
it('inverts the iso projection', () => {
  // isoX(1, 0) = TILE_W/2, isoY(1, 0) = TILE_H/2 -- one tile east.
  const got = screenOffsetToWorld(TILE_W / 2, TILE_H / 2);
  expect(got.dx).toBeCloseTo(1, 10);
  expect(got.dy).toBeCloseTo(0, 10);
});

it('keeps every mark inside its own tile', () => {
  // Pixi's offsets were bounded by hand against the tile diamond; the
  // conversion must not break that. A mark that escapes its tile lands on a
  // neighbour with different elevation and floats.
  // ...assert every scatter vertex is within 0.5 tiles of its tile centre
});

it('every vertex colour is a palette entry', () => { /* same shape as ground */ });

it('scatters the same way twice', () => { /* determinism */ });

it('puts marks on the tile top when the tile is raised', () => {
  // A fleck at elevation 0 on a tile raised three levels is buried inside
  // the ridge and invisible -- the failure is silent and looks like "the
  // grain stopped working on high ground".
});
```

- [ ] **Step 2: Run the test to verify it fails, then implement**

Port these, in order, from `renderer.ts`. Every constant is quoted at its source line — use the source, not this table, as the authority for anything ambiguous:

| mark | source | notes |
|---|---|---|
| stone grain: limestone flecks + earth | `:1616-1641` | `n = 3 + floor(rnd * 5)`; `rockLit` at `0.4 + b * 0.35`, `earth` at `0.24` when `b > 0.78` |
| sward grain: blades | `:1577-1596` | `n = 8 + floor(rnd * 7)`; blade height `2.6 + a * 1.8`; `bladeLit`/`bladeShade` on `b > 0.4` |
| bush / tussock | `:1597-1611`, `:1642-1648` | `rnd > 0.84 && cover === 0` |
| bare earth patch (sward) | `:1597-1605` | `rnd > 0.9` |
| cover rubble | `:1650-1660` | `cover + 2` marks, tone `cover[min(cover,3)-1]` |
| knoll | `:1533-1551` | 4 blobs, `rock` at `0.95` + `rockLit` highlight |
| ridge | `:1439-1470` | full-tile rock diamond then 5 larger blobs |
| road ruts | `:1526-1530` | two lines at `±rut` px, `rut` tone at `0.30` |
| slope face dressing | `:1308-1350` | strata bands, lit top edge, scree at drops ≥ 2 |

All colours go through `composite` then `quantise` — same rule as the ground. A mark drawn at alpha over the tile beneath it composites against **that tile's own quantised tone**, not against the background.

Marks sit at their tile's height plus a small epsilon so they do not z-fight the ground. State the epsilon and why you chose it.

- [ ] **Step 3: Verify in the browser and commit**

Compare `?sandbox=1` and `?sandbox=1&renderer=three` again. The grain should read as the same ground: same density, same places. Report what differs.

```bash
git add packages/render/src/three/terrain/scatter.ts packages/render/src/three/terrain/scatter.test.ts packages/render/src/three/ThreeRenderer.ts
git commit -m "feat(render): the ground gets its grain back"
```

---

## Task B2.6: groves, and the first real occlusion

**Files:**
- Create: `packages/render/src/three/terrain/grove.ts`, `packages/render/src/three/terrain/grove.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts`

**Interfaces:**
- Produces: `buildGroves(input: TerrainInput, tones: TerrainTones, background: string): MeshData`

Port `drawCanopy` (`renderer.ts:1675-1757`): one dominant tree per grove tile, a second smaller one when `tileHash(x * 3, y * 7) > 0.62`, a splayed two-stem trunk, and a three-lobe crown with `crownRatio` controlling how squat it is.

**The thing that makes this task worth doing on its own:** in Pixi a canopy is a separate depth-sorted `Graphics` with a `zIndex`, because terrain draws under every unit unconditionally and a soldier behind a tree must still be covered by it. In three.js the crown is geometry standing above the ground and the depth buffer handles it. **Do not port `zIndex`, `depthZ`, or the band mechanism.** Ruling 5.

Units do not exist until B3, so B2 cannot demonstrate a soldier being occluded. What it *can* demonstrate, and must: a crown occludes the **terrain behind it** — a tree on a low tile in front of a raised ridge covers part of that ridge. Verify that in the browser and report it.

- [ ] **Steps:** failing test → implement → browser check → commit

Test the pure builder for: palette-entry colours, determinism, the twin-tree threshold, crowns standing above their tile's ground height, and geometry staying within its tile footprint.

```bash
git commit -m "feat(render): groves, occluding by geometry rather than by sort order"
```

---

## Task B2.7: buildings and wrecks

**Files:**
- Create: `packages/render/src/three/terrain/buildings.ts`, `packages/render/src/three/terrain/buildings.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts`

**Interfaces:**
- Produces: `buildBuildings(input, structures, tones, resolveColor, background): MeshData`

Port `drawBuildingTile` (`renderer.ts:1825-1861`) and `drawWreckedStructures` (`:1759+`).

A building is a box: two visible side faces and a roof at `stype.heightPx`, darkened by `wear = 0.45 + 0.55 * integrity` so a battered wall goes dark, plus hash-placed roof clutter when `rnd > 0.4 && integrity > 0.6`.

**Two things to get right:**

1. `drawBuildingTile` uses three **hardcoded hex literals** — `'#1E1F1A'`, `'#3A3C33'`, `'#8E9491'` (`renderer.ts:1847`, `:1849`, `:1856`). `validate:ui` does not scan `renderer.ts`, which is why they survive there. Do not copy them into the three.js path as literals: resolve them to palette entries and say in the report which entries you chose and how close they are. If any is not close to a palette colour, report that as a finding rather than inventing one — it means the Pixi building is drawn off-palette today and someone should know.

2. Structures with art (`structureAtlas`) draw a **sprite** in Pixi, not a block. B2 draws the block form for every structure including those. That is deliberate and stated in "What B2 does NOT do" — sprited structures are billboards and belong to B3. Make sure the block still appears for them rather than being skipped, or every sprited building becomes an invisible hole.

Buildings need the sim's structure data, which the pure builder cannot import. Pass in the minimum as plain arrays — footprint tiles, `heightPx`, colour key, `hp`/`maxHp` — assembled by `ThreeRenderer`. Keep the builder ignorant of `Sim`.

- [ ] **Steps:** failing test → implement → browser check → commit

Browser check: buildings stand in the same places as Pixi's, at the same relative heights, and a building occludes terrain behind it.

```bash
git commit -m "feat(render): buildings as blocks the depth buffer can sort"
```

---

## Task B2.8: the positional parity check

**Files:**
- Create: `packages/render/src/three/terrain/parity.test.ts`

Terrain is deliberately not pixel-identical to Pixi, so the golden-image diff cannot gate B2. What *can* be gated, and is the failure that actually matters, is whether geometry lands in the right place.

Assert, for every shipped map (`data/maps/*.json`, loaded through `parseMap`):

- the ground mesh has exactly two triangles per tile plus the expected side faces
- **every** vertex colour across ground, scatter, groves and buildings is a palette entry — the guarantee, asserted across real map data rather than synthetic input
- the mesh's world-space bounding box matches the map's dimensions
- a tile's world position round-trips through `worldToScreenThree` to the same screen point `project.worldToScreen` gives for that tile at that elevation — **this is the check that would have caught B1's wrong camera angle**, and it is the one that ties terrain to the conformance suite

Run it against Tel Marum specifically, the only shipped map with relief. Every other map is flat and cannot exercise a single side face.

```bash
git commit -m "test(render): terrain lands where Pixi puts it, on every shipped map"
```

---

## Self-review

**Spec coverage.** B2's row in B1's table — "the map is visible and matches Pixi's terrain" — is covered by B2.3 (ground), B2.5 (grain), B2.6 (groves), B2.7 (buildings). The spec's "Terrain, elevation, buildings" for Phase B is covered; "units" is B3. The deferred `pickUnit`/`isVisible`/mid-slope tests the spec assigns to Phase B are **not** in B2 — they need units and fog, so they belong to B3 and B4, and the spec amendment of 2026-08-27 records why they cannot run against a constructed renderer at all.

**B1's inherited hazards.** Pure builders answer hazard 1 (B2.1 ruling). The shaded-fragment readback answers hazard 3 (Task B2.4 Step 4). Hazard 2 (the toon shader has never compiled) is explicitly out of scope and stays B3's risk. Hazards 4 and 5 — the conformance suite testing below the seam, and two height conventions — are **not** resolved here; B2.8 adds a positional check rather than rewriting the suite, and `WORLD_PER_LEVEL` derives from `WORLD_Y_PER_LIFT_PIXEL` rather than adding a third convention. Hazard 6 (per-call camera allocation) remains B3's.

**Placeholder scan.** Tasks B2.6 and B2.7 give their steps as a summary rather than full code blocks, with source line ranges and the exact thresholds to port. That is a deliberate deviation from the no-placeholders rule: both are ports of specific existing functions, and transcribing 80 lines of Pixi drawing into this document would produce a copy that goes stale rather than a specification. The implementer is told which function to read. Every *interface* is fully specified.

**Type consistency.** `MeshData` and `TerrainInput` are defined once in `ground.ts` (B2.3) and imported by B2.5, B2.6, B2.7. `buildGround`, `buildScatter`, `buildGroves`, `buildBuildings` all take `(input, tones, background)` plus their own extras and all return `MeshData`, so `ThreeRenderer` composes them uniformly.

**Ordering.** B2.1 and B2.2 are pure and independent. B2.3 needs B2.2. B2.4 needs B2.3 and is where anything becomes visible. B2.5–B2.7 each need B2.4 and are independent of each other. B2.8 needs all of them.
