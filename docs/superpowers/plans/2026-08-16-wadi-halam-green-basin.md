# Wadi Halam green basin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five 5–7 minute raid missions on one new green open-terrain map in Naharin, reachable from the campaign world map, each proven winnable by the headless playtest harness.

**Architecture:** A map declares `terrain: "arid" | "green"`; the loader carries it; `main.ts` resolves it into a `terrainTones` bundle of already-resolved hex passed to the renderer, which branches its open-ground scatter once on a `scatter` discriminator. A new zone-scoped `raze` objective lives entirely in `MissionRuntime` and reads `sim.structures.alive` without touching `sim.ts`. Content is JSON.

**Tech Stack:** TypeScript strict, PixiJS, Vitest, pnpm workspaces, Ajv (JSON Schema), tsx for headless tools.

**Spec:** [docs/superpowers/specs/2026-08-16-wadi-halam-green-basin-design.md](../specs/2026-08-16-wadi-halam-green-basin-design.md)

## Global Constraints

- **Sim runs at a fixed 20 Hz tick** (`TICKS_PER_SECOND = 20`). Never drive simulation from frame time.
- **`@lions/sim` is Q16.16 fixed-point. No floating point.** `Math.*` and `Date.*` are lint-banned inside the sim package. Use `fx.mul`, `fx.div`, `fx.sin`.
- **All randomness is a seeded per-entity PRNG.** Never `Math.random()`.
- **Data flows one way: commands in → sim → state + events out.** Nothing outside the sim mutates sim state. Decor and terrain theme are presentation and must never reach `Sim`.
- **Dependency direction:** `app → render → sim`; `data` is a leaf. `@lions/render` must NOT import `@lions/data`.
- **TypeScript strict. No `any`. No non-null assertions in sim code.**
- **The determinism golden hash is `4029834894`** in `packages/sim/src/determinism.test.ts`. **It must not move in this work.** If it does, stop and investigate — do not update the constant.
- **`target_minutes` must be 5–7** for every new mission (schema still allows 25; CLAUDE.md and GDD §6 say 5–7).
- **Palette:** every colour is a key from `data/palette.json`. No hex literals in new code.
- **This working tree is shared with other sessions. Never `git add -A`.** Stage the exact paths listed in each commit step.
- **Full gate list** (CI runs all of these): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm validate:data`, `pnpm validate:assets`, `pnpm validate:ui`, `pnpm validate:audio`, `python3 tools/validate_balance.py --units data/units`, `pnpm balance`, `pnpm build`, `pnpm test:determinism`.

---

### Task 1: The `terrain` field — schema and loader

Adds a declared, validated terrain theme to the map format. Nothing renders differently yet; this is the data spine.

**Files:**
- Modify: `data/schemas/map.schema.json`
- Modify: `packages/data/src/map.ts` (`MapJson` ~:25, `ParsedMap` ~:56, `parseMap` ~:129)
- Test: `packages/data/src/map.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type TerrainTheme = 'arid' | 'green'`; `ParsedMap.terrain: TerrainTheme`; `MapJson.terrain?: string`. Tasks 3 and 7 rely on both names.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('parseMap', ...)` block in `packages/data/src/map.test.ts`:

```ts
  it('defaults the terrain theme to arid', () => {
    expect(parseMap(TINY).terrain).toBe('arid');
  });

  it('carries a declared green terrain theme', () => {
    expect(parseMap({ ...TINY, terrain: 'green' }).terrain).toBe('green');
  });

  it('throws on an unknown terrain theme', () => {
    expect(() => parseMap({ ...TINY, terrain: 'lunar' })).toThrow(/unknown terrain theme/);
  });

  it('still decodes exactly seven terrain symbols', () => {
    // The green basin is a look, not new mechanics. If this count moves, a
    // symbol was added and validate_data.mjs's TERRAIN_SYMBOLS must move with it.
    expect(Object.keys(TERRAIN_LEGEND).sort()).toEqual(['.', '1', '2', '3', 'n', 'o', 'r']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run packages/data/src/map.test.ts
```

Expected: the first three FAIL — `terrain` is not a property of `MapJson`, so TypeScript errors and the assertions cannot pass. The fourth passes already.

- [ ] **Step 3: Add the type, the field, and the validation**

In `packages/data/src/map.ts`, add above `MapJson`:

```ts
/**
 * Which palette and ground texture a map is drawn with.
 *
 * Presentation only, exactly like `decor`: the sim never sees it, because
 * whether a tile is grass or gravel changes no outcome. What it changes is the
 * tone bundle `main.ts` hands the renderer and the shape of the open-ground
 * scatter. Adding a theme is a renderer change; adding a MAP is not.
 */
export type TerrainTheme = 'arid' | 'green';

const TERRAIN_THEMES: ReadonlySet<string> = new Set<TerrainTheme>(['arid', 'green']);
```

Add to `MapJson` (after `rows`):

```ts
  /** Terrain theme. Absent means 'arid', which is every map authored before Naharin. */
  terrain?: string;
```

Add to `ParsedMap` (after `height`):

```ts
  /** Terrain theme. Presentation only -- never given to Sim. */
  terrain: TerrainTheme;
```

In `parseMap`, immediately after the `const { width, height, rows } = json;` line:

```ts
  const terrain = json.terrain ?? 'arid';
  if (!TERRAIN_THEMES.has(terrain)) {
    throw new Error(
      `map ${json.id}: unknown terrain theme "${terrain}" (known: arid, green)`
    );
  }
```

and add `terrain: terrain as TerrainTheme,` to the returned object literal.

- [ ] **Step 4: Declare it in the schema**

In `data/schemas/map.schema.json`, inside `properties` (alongside `width`/`height`/`rows`):

```json
    "terrain": {
      "type": "string",
      "enum": ["arid", "green"],
      "default": "arid",
      "description": "Terrain theme: which tone bundle and ground texture the renderer draws this map with. Presentation only -- it never reaches the sim, exactly like the decor layer. 'arid' is the Sahar limestone-and-dust look every map before Naharin uses; 'green' is the Naharin river basin. Adding a theme is a renderer change; adding a map that uses one is not."
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm vitest run packages/data/src/map.test.ts && pnpm typecheck && pnpm validate:data
```

Expected: all PASS; `validate:data` reports the same file count as before, still green.

- [ ] **Step 6: Commit**

```bash
git add data/schemas/map.schema.json packages/data/src/map.ts packages/data/src/map.test.ts
git commit -m "feat(data): a map declares whether it is arid or green"
```

---

### Task 2: The grass ramp

Five new palette entries. No consumer yet — Task 3 wires them.

**Files:**
- Modify: `data/palette.json`

**Interfaces:**
- Consumes: nothing.
- Produces: palette keys `grass.0` … `grass.4`. Task 3 resolves them by name.

- [ ] **Step 1: Add the ramp**

In `data/palette.json`, add to `ramps` immediately after the `scrub` entry:

```json
    "grass": {
      "role": "procedural terrain only -- open sward, hedgerow, pasture. NOT for sprite art.",
      "colors": [
        "#D9E294",
        "#C0CE7E",
        "#A6BC66",
        "#8AB04E",
        "#6E9E33"
      ],
      "note": "Added for the Naharin green basin. Neither existing green could carry open ground: olive is a desaturated grey-green for hulls and tarps, and scrub is two entries whose declared role is sparse vegetation. Five steps of 39-43 RGB distance, coarser than limestone's ~31 because five entries span what nine limestone steps span. The ramp stops at grass.4 (#6E9E33) rather than continuing down, because scrub.0 (#6B8A4A) is 31 away and already owns that band -- extending further produced duplicates, not steps. Vegetation is therefore seven steps across two ramps: grass.0-4 then scrub.0 then scrub.1. grass.2 is the open-ground wash: its luminance (177) sits within 5 of limestone.3 (182), which every unit silhouette was tuned for figure-ground against, so the change is hue and not value."
    },
```

- [ ] **Step 2: Bump `total_colors`**

Change `"total_colors": 53` to `"total_colors": 58`.

- [ ] **Step 3: Verify the gates**

```bash
pnpm validate:data && pnpm validate:assets
```

Expected: `validate:data` passes — it asserts `total_colors` equals the real count, so a mismatch fails loudly here. `validate:assets` passes unchanged: it gates on every opaque pixel being *a* palette entry, a subset test, so widening the palette cannot invalidate an existing quantized sprite.

- [ ] **Step 4: Commit**

```bash
git add data/palette.json
git commit -m "feat(data): a grass ramp, because olive is a hull colour and scrub is two entries"
```

---

### Task 3: The `terrainTones` bundle

Replaces twelve hardcoded palette keys in the renderer with one resolved bundle chosen by theme. **The arid bundle must be byte-identical to today's values** — this task changes no pixel.

**Files:**
- Modify: `packages/render/src/renderer.ts` (`RendererOptions` :22–44, `drawTerrain` :1061–1244, `drawOliveTree` :1255–1316)
- Modify: `packages/app/src/main.ts` (renderer options ~:288–312)

**Interfaces:**
- Consumes: `ParsedMap.terrain` (Task 1), `grass.*` palette keys (Task 2).
- Produces: `export interface TerrainTones` and `export type TerrainScatter = 'stone' | 'sward'` from `@lions/render`; `RendererOptions.terrainTones: TerrainTones`. Task 4 branches on `terrainTones.scatter`.

- [ ] **Step 1: Add the interface to the renderer**

In `packages/render/src/renderer.ts`, above `RendererOptions`:

```ts
/** How open ground is grained. Tones are data; mark shape is drawing code. */
export type TerrainScatter = 'stone' | 'sward';

/**
 * Every tone `drawTerrain` needs, already resolved to hex by the app.
 *
 * These used to be twelve `resolveColor('dust.3')` calls scattered through
 * `drawTerrain` and `drawCanopy`, which put "what does this region look like"
 * inside the engine. The app owns the palette; the renderer owns the marks.
 */
export interface TerrainTones {
  open: string;
  cover: [string, string, string];
  blocked: string;
  underBuilding: string;
  road: string;
  rut: string;
  rock: string;
  rockLit: string;
  earth: string;
  /** The sparse low plant on open ground: dry bush, or tussock. */
  low: string;
  trunk: string;
  trunkLit: string;
  leafDark: string;
  leafMid: string;
  leafLit: string;
  /** Crown aspect: olive is wide and squat (0.52), poplar is tall (0.95). */
  crownRatio: number;
  scatter: TerrainScatter;
}
```

- [ ] **Step 2: Replace the three loose terrain fields**

In `RendererOptions`, delete these three lines:

```ts
  terrainOpen: string;
  terrainCover: [string, string, string];
  terrainBlocked: string;
```

and add:

```ts
  /** Terrain tones and grain for this map's theme. */
  terrainTones: TerrainTones;
```

- [ ] **Step 3: Point every reader at the bundle**

Replace every `this.opts.terrainOpen` with `this.opts.terrainTones.open`, every `this.opts.terrainCover` with `this.opts.terrainTones.cover`, and every `this.opts.terrainBlocked` with `this.opts.terrainTones.blocked` throughout `renderer.ts`.

```bash
grep -n "opts.terrainOpen\|opts.terrainCover\|opts.terrainBlocked" packages/render/src/renderer.ts
```

Expected after the edit: no output.

- [ ] **Step 4: Delete the hardcoded tone resolves in `drawTerrain`**

Replace lines :1079–1091 (the `underBuilding` through `bushTone` block) with:

```ts
    const t = this.opts.terrainTones;
```

and rename the uses inside the loop: `underBuilding` → `t.underBuilding`, `roadTone` → `t.road`, `rutTone` → `t.rut`, `rockTone` → `t.rock`, `rockLit` → `t.rockLit`, `dirtTone` → `t.earth`, `bushTone` → `t.low`.

- [ ] **Step 5: Rename `drawOliveTree` to `drawCanopy` and take its tones from the bundle**

Replace lines :1258–1262 with:

```ts
    const t = this.opts.terrainTones;
    const { trunk, trunkLit, leafDark, leafMid, leafLit } = t;
```

Change the signature to `private drawCanopy(x: number, y: number, cx: number, cy: number): void`, update its one call site in `drawTerrain`, and change line :1292 from:

```ts
      const ry = rx * 0.52;
```

to:

```ts
      const ry = rx * t.crownRatio;
```

- [ ] **Step 6: Build the theme table in the app**

In `packages/app/src/main.ts`, above the `const opts: RendererOptions = {` block:

```ts
  // Terrain tones by theme. The arid bundle is byte-identical to the values that
  // were hardcoded in drawTerrain -- drawTerrain has no tests, so "Beit Sahwan
  // renders unchanged" is proven by these numbers not moving and by looking at it.
  // Typing this as a Record makes a missing theme a compile error, not a test.
  const TERRAIN_THEMES: Record<TerrainTheme, TerrainTones> = {
    arid: {
      open: paletteColor('limestone.3'),
      cover: [paletteColor('limestone.2'), paletteColor('dust.1'), paletteColor('dust.0')],
      blocked: paletteColor('limestone.4'),
      underBuilding: paletteColor('shadow.0'),
      road: paletteColor('dust.3'),
      rut: paletteColor('dust.5'),
      rock: paletteColor('limestone.6'),
      rockLit: paletteColor('limestone.3'),
      earth: paletteColor('terracotta.2'),
      low: paletteColor('olive.1'),
      trunk: paletteColor('dust.5'),
      trunkLit: paletteColor('dust.3'),
      leafDark: paletteColor('olive.2'),
      leafMid: paletteColor('olive.1'),
      leafLit: paletteColor('olive.0'),
      crownRatio: 0.52,
      scatter: 'stone',
    },
    green: {
      open: paletteColor('grass.2'),
      cover: [paletteColor('grass.3'), paletteColor('scrub.0'), paletteColor('scrub.1')],
      // Buildings stay limestone. Stone in a green valley is correct, not a
      // compromise, and it ties the village to the dry-stone terrace walls.
      blocked: paletteColor('limestone.4'),
      underBuilding: paletteColor('shadow.0'),
      road: paletteColor('dust.4'),
      rut: paletteColor('dust.6'),
      // A knoll in the basin is a dry-stone terrace wall, so it stays limestone
      // in both themes rather than becoming a green rock.
      rock: paletteColor('limestone.6'),
      rockLit: paletteColor('limestone.3'),
      earth: paletteColor('dust.5'),
      low: paletteColor('scrub.0'),
      trunk: paletteColor('dust.5'),
      trunkLit: paletteColor('dust.3'),
      leafDark: paletteColor('scrub.1'),
      leafMid: paletteColor('grass.4'),
      leafLit: paletteColor('grass.2'),
      // A poplar is a tall narrow crown where an olive is wide and squat.
      crownRatio: 0.95,
      scatter: 'sward',
    },
  };
```

Replace the three `terrainOpen` / `terrainCover` / `terrainBlocked` lines in `opts` with:

```ts
    terrainTones: TERRAIN_THEMES[map.terrain],
```

Add `TerrainTones`, `TerrainScatter` and `TerrainTheme` to the existing import statements from `@lions/render` and `@lions/data` respectively.

- [ ] **Step 7: Verify nothing moved**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS.

Then diff the arid bundle against git history by eye — this is the regression check that no test can do:

```bash
git show HEAD~2:packages/render/src/renderer.ts | sed -n '1079,1091p'
```

Expected: `shadow.0`, `dust.3`, `dust.5`, `limestone.6`, `limestone.3`, `terracotta.2`, `olive.1` — each appearing in the `arid` bundle against the same role. Any mismatch is a regression in every existing map.

- [ ] **Step 8: Look at Beit Sahwan**

Start the preview from this tree (`preview_start` is pinned to its launch directory — a worktree serves the wrong tree and the failure looks like a broken feature), open a Beit Sahwan mission, and confirm the ground, roads, knolls and olive canopies are unchanged.

- [ ] **Step 9: Commit**

```bash
git add packages/render/src/renderer.ts packages/app/src/main.ts
git commit -m "refactor(render): terrain tones arrive as one bundle, not twelve palette keys"
```

---

### Task 4: The `sward` scatter

The green look. One branch, at the one place the drawing logic genuinely differs.

**Files:**
- Modify: `packages/render/src/renderer.ts` (`drawTerrain` open-ground block, :1181–1225 pre-refactor numbering)

**Interfaces:**
- Consumes: `TerrainTones.scatter`, `TerrainTones.low`, `TerrainTones.earth` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Branch the open-ground pass**

Replace the open-ground block (the `{ const n = 3 + Math.floor(rnd * 5); ... }` scatter and the `if (rnd > 0.84 && cover === 0)` dry-bush block) with:

```ts
        if (t.scatter === 'sward') {
          // Grass is denser than gravel and its mark is a blade, not a pebble.
          // Ellipses recoloured green read as green rocks; short vertical strokes
          // at high frequency read as sward. Same tile hash as the stone pass, so
          // the ground is stable between rebuilds.
          const n = 8 + Math.floor(rnd * 7);
          for (let k = 0; k < n; k++) {
            const a = PixiRenderer.h2(x * 19 + k * 7, y * 23 + k * 5);
            const b = PixiRenderer.h2(x * 41 + k * 3, y * 7 + k * 11);
            const px = cx + (a - 0.5) * (TILE_W - 12);
            const py = cy + (b - 0.5) * (TILE_H - 6);
            const h = 2 + a * 1.2;
            g.moveTo(px, py).lineTo(px, py - h);
            g.stroke({ color: b > 0.4 ? t.leafLit : t.leafDark, alpha: 0.45 + a * 0.3 });
          }
          if (rnd > 0.9) {
            // Bare earth: cool and rare. Some exposed ground keeps a green map
            // from reading as a billiard table, but red laterite is not what a
            // river basin's stock paths look like.
            const a = PixiRenderer.h2(x * 19, y * 23);
            g.ellipse(cx + (a - 0.5) * 22, cy, 3 + a * 2.4, 1.6 + a * 1.2).fill({
              color: t.earth,
              alpha: 0.22,
            });
          }
          if (rnd > 0.84 && cover === 0) {
            // A tussock, drawn as three strokes fanning from a point rather than
            // one blob -- the mark that separates a clump of grass from a bush.
            const a = PixiRenderer.h2(x * 31, y * 3);
            const bx = cx + (a - 0.5) * 30;
            const by = cy + (rnd - 0.9) * 18;
            for (let k = -1; k <= 1; k++) {
              g.moveTo(bx, by).lineTo(bx + k * 2.6, by - 4.2 - a * 1.6);
            }
            g.stroke({ color: t.low, alpha: 0.8, width: 1.2 });
          }
        } else {
          // ... the existing stone scatter and dry bush, unchanged ...
        }
```

Keep the existing stone scatter and dry-bush code verbatim inside the `else`, with `dirtTone` → `t.earth`, `rockLit` → `t.rockLit`, `rockTone` → `t.rock`, `bushTone` → `t.low`.

- [ ] **Step 2: Verify it compiles and nothing regressed**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS.

- [ ] **Step 3: Look at Beit Sahwan again**

The `stone` branch must be pixel-identical to Task 3's output. Open a Beit Sahwan mission in the preview and compare. There is no green map yet — Task 7 makes one — so this step only proves the arid path survived the branch.

- [ ] **Step 4: Commit**

```bash
git add packages/render/src/renderer.ts
git commit -m "feat(render): grass is a blade, not a recoloured pebble"
```

---

### Task 5: The `raze` objective

**Files:**
- Modify: `data/schemas/mission.schema.json` (objective `type` enum, ~:183)
- Modify: `packages/sim/src/mission.ts` (`SUPPORTED` :220, class fields ~:276, `start()` :493, `stepObjectives` :1085)
- Modify: `docs/GDD.md` (§6 objective list, :236)
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Consumes: `sim.structureAt(x, y): number` (`sim.ts:991`), `sim.structures.alive: Uint8Array` (`sim.ts:723`).
- Produces: objective `type: 'raze'` with `target` naming a map zone. Task 13 authors one.

- [ ] **Step 1: Write the failing tests**

Add to `packages/sim/src/mission.test.ts`. Follow the file's existing world-building helper for structures; the assertions are what matter:

```ts
describe('raze objective', () => {
  it('completes when every structure in the zone is dead', () => {
    const { sim, rt } = razeWorld();          // depot zone holds 2 structures
    expect(rt.objectiveList[0].status).toBe('active');
    sim.destroyStructure(0);
    sim.tick();
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('active');   // one still standing
    sim.destroyStructure(1);
    sim.tick();
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('complete');
  });

  it('is not completed by a structure outside the zone', () => {
    const { sim, rt } = razeWorld({ outsider: true });
    sim.destroyStructure(0);
    sim.destroyStructure(1);
    sim.tick();
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('complete');  // outsider irrelevant
  });

  it('counts a structure with only one tile inside the zone', () => {
    const { sim, rt } = razeWorld({ straddle: true });
    sim.tick();
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('active');    // the straddler counts
  });

  it('counts a structure destroyed by the enemy', () => {
    // The objective asks whether the depot is down, not who dropped it.
    const { sim, rt } = razeWorld();
    sim.destroyStructure(0, 99);   // `by` is an enemy entity id
    sim.destroyStructure(1, 99);
    sim.tick();
    rt.step([]);
    expect(rt.objectiveList[0].status).toBe('complete');
  });

  it('throws when the zone does not resolve', () => {
    expect(() => razeWorld({ zone: 'nowhere' })).toThrow(/needs a valid zone/);
  });

  it('throws when the zone holds no structures', () => {
    expect(() => razeWorld({ empty: true })).toThrow(/would complete on the first tick/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm vitest run packages/sim/src/mission.test.ts -t raze
```

Expected: FAIL — `mission ...: objective type "raze" is not supported by the runtime yet`, thrown from the constructor.

- [ ] **Step 3: Add `raze` to the supported set and the schema**

In `packages/sim/src/mission.ts` line 220:

```ts
const SUPPORTED = new Set([
  'locate', 'eliminate_hvt', 'capture', 'hold_for', 'survive_until', 'destroy_all',
  'evacuate_before', 'raze',
]);
```

In `data/schemas/mission.schema.json`, add `"raze"` to the objective `type` enum, and extend that property's description with:

> `raze`: every structure inside the zone named by `target` is destroyed. The set is snapshotted at mission start, so a zone holding no structures is an authoring error rather than an instant win.

In `docs/GDD.md:236`, add `raze` to the objective list.

- [ ] **Step 4: Add the snapshot field and the load-time gate**

In `packages/sim/src/mission.ts`, beside the other private maps (~:276):

```ts
  /** Objective id -> the structure indices its zone held at mission start.
   *
   *  Snapshotted, not rescanned. `structureAt` returns -1 once a structure is
   *  dead and `destroyStructure` clears `blocked` on its tiles, so a per-tick
   *  rescan would find fewer structures each time one fell and would report
   *  "all zero are destroyed" the moment the last one dropped -- the right
   *  answer for the wrong reason, and a silent completion at t=0 for a zone
   *  that never held anything. Sorted, because an insertion-ordered array whose
   *  order depends on a scan is a latent determinism question. */
  private readonly razeTargets = new Map<string, readonly number[]>();
```

In `start()`, inside the existing `for (const o of this.objectives)` loop:

```ts
      if (o.def.type === 'raze') {
        const z = this.zone(o.def.target);
        if (!z) {
          throw new Error(`mission ${this.mission.id}: objective "${o.def.id}" needs a valid zone`);
        }
        const found = new Set<number>();
        for (let y = z[1]; y < z[1] + z[3]; y++) {
          for (let x = z[0]; x < z[0] + z[2]; x++) {
            const s = this.sim.structureAt(x, y);
            if (s >= 0) found.add(s);
          }
        }
        if (found.size === 0) {
          throw new Error(
            `mission ${this.mission.id}: raze "${o.def.id}" zone "${o.def.target}" contains ` +
              `no structures, so it would complete on the first tick`
          );
        }
        this.razeTargets.set(o.def.id, [...found].sort((a, b) => a - b));
      }
```

- [ ] **Step 5: Add the completion branch**

In `stepObjectives` (~:1091), beside `destroy_all`:

```ts
      } else if (d.type === 'raze') {
        const targets = this.razeTargets.get(d.id) ?? [];
        complete =
          targets.length > 0 && targets.every((s) => this.sim.structures.alive[s] === 0);
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm vitest run packages/sim/src/mission.test.ts && pnpm typecheck && pnpm lint
```

Expected: all PASS.

- [ ] **Step 7: Prove the determinism hash did not move**

```bash
pnpm test:determinism
```

Expected: 4/4 PASS with `4029834894` unchanged. `determinism.test.ts` imports only `Sim` and never constructs a `MissionRuntime`, and `raze` reads `structures.alive` without writing anything — so an unchanged hash is the *expected* result and a moved one is a bug. **If it moves, stop and investigate. Do not update the constant.**

- [ ] **Step 8: Commit**

```bash
git add data/schemas/mission.schema.json packages/sim/src/mission.ts packages/sim/src/mission.test.ts docs/GDD.md
git commit -m "feat(sim): raze completes when a zone's buildings are all down"
```

---

### Task 6: The `raze` validator cross-check

Catches the two structure classes a demolisher silently refuses to level on its own initiative, at `pnpm validate:data` rather than in playtest.

**Files:**
- Modify: `tools/validate_data.mjs` (mission cross-check block, ~:127–300)

**Interfaces:**
- Consumes: the `raze` objective type (Task 5).
- Produces: nothing.

- [ ] **Step 1: Add the check**

In the mission cross-check block, which already loads `structures.json` and every map:

```js
// A demolisher working on its own initiative skips two classes of structure:
// `per_tile`/low-profile types (a wall run is N separate structures, each
// needing its own click) and types at or above the protected ROE threshold
// (the mosque). A raze zone containing either is a mission that demands forty
// clicks or feels quietly impossible, and neither shows up until playtest.
const PROTECTED_ROE = 20;
for (const obj of mission.objectives ?? []) {
  if (obj.type !== 'raze') continue;
  const rect = map.zones?.[obj.target];
  if (!rect) {
    failures.push(`${missionRel}: raze "${obj.id}" names zone "${obj.target}", which map "${mission.map.file}" does not declare`);
    continue;
  }
  const [zx, zy, zw, zh] = rect;
  const bad = new Map();
  for (let y = zy; y < zy + zh; y++) {
    for (let x = zx; x < zx + zw; x++) {
      const sym = map.rows[y]?.[x];
      const typeId = structureSymbols.get(sym);
      if (!typeId) continue;
      const spec = structureCatalogue.types[typeId];
      if (spec.per_tile) bad.set(typeId, `per_tile at (${x},${y})`);
      else if ((spec.roe_penalty ?? 0) >= PROTECTED_ROE) bad.set(typeId, `protected (roe_penalty ${spec.roe_penalty}) at (${x},${y})`);
    }
  }
  for (const [typeId, why] of bad) {
    failures.push(`${missionRel}: raze "${obj.id}" zone "${obj.target}" contains "${typeId}" -- ${why}. A demolisher will not level it unattended.`);
  }
}
```

- [ ] **Step 2: Verify it passes on the current content**

```bash
pnpm validate:data
```

Expected: PASS — no mission declares a `raze` objective yet, so the loop is inert.

- [ ] **Step 3: Verify it actually fires**

Temporarily add a `raze` objective naming a zone containing the mosque to any Beit Sahwan mission, run `pnpm validate:data`, confirm it fails with the "protected" message, then revert the edit.

```bash
git checkout data/missions/
```

- [ ] **Step 4: Commit**

```bash
git add tools/validate_data.mjs
git commit -m "feat(tools): a raze zone may not contain a wall or a mosque"
```

---

### Task 7: The map, the region unlock, and the canon

**Files:**
- Create: `data/maps/wadi_halam_basin.json`
- Modify: `packages/data/src/index.ts` (map import ~:10, `maps` object ~:75)
- Modify: `data/campaign/world.json` (`naharin.unlock`, `naharin.blurb`)
- Modify: `docs/GDD.md` (:35 table row, :49–51 layout bullet)

**Interfaces:**
- Consumes: `terrain: "green"` (Task 1).
- Produces: map id `wadi_halam_basin` with the markers and zones Tasks 9–13 reference by name.

- [ ] **Step 1: Generate the grid**

Hand-typing 2304 characters is where off-by-ones hide, so build it from the band spec and assert the invariants. Write this to the scratchpad (it is a one-off, not a committed tool):

```python
# scratchpad/build_wadi_halam.py
import json
W = H = 48
g = [['.'] * W for _ in range(H)]

def fill(x0, y0, x1, y1, ch):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = ch

# The wadi: poplar gallery x7-12, with two fords cut through it.
fill(7, 4, 12, 43, 'o')
fill(7, 15, 12, 15, 'r')
fill(7, 32, 12, 32, 'r')

# Cultivation x13-23: hedgerow bunds on alternate rows, terrace walls at corners.
for y in range(14, 34, 3):
    fill(13, y, 23, y, '1')
for (x, y) in [(13, 14), (22, 14), (13, 32), (22, 32), (17, 23)]:
    fill(x, y, x + 1, y + 1, 'n')

# The village x25-33.
fill(25, 16, 28, 18, 'h'); fill(30, 16, 33, 18, 'h')
fill(25, 27, 28, 29, 'h'); fill(30, 27, 33, 29, 'h')
fill(28, 22, 30, 24, 'm')
fill(26, 20, 27, 20, 's'); fill(32, 20, 33, 20, 's')

# The southern track, then north to the depot gate.
fill(13, 34, 34, 34, 'r')
fill(33, 25, 33, 34, 'r')

# The depot wall ring, gate gap at (34,24).
fill(34, 16, 42, 16, '='); fill(34, 31, 42, 31, '=')
fill(34, 16, 34, 31, '='); fill(42, 16, 42, 31, '=')
g[24][34] = '.'

# The seven depot structures.
fill(36, 18, 38, 19, 'w'); fill(36, 21, 38, 22, 'w')
fill(40, 18, 41, 19, '#'); fill(40, 21, 41, 22, '#')
fill(36, 24, 37, 24, 's'); fill(39, 24, 40, 24, 's')
fill(37, 27, 39, 28, 'w')

rows = [''.join(r) for r in g]
markers = {
    "kdf_crossing": [3, 24], "ford_north": [10, 15], "ford_south": [10, 32],
    "pump_house": [17, 20], "hide_north": [22, 9], "hide_south": [22, 38],
    "village_center": [29, 24], "depot_gate": [34, 24],
    "rif_north": [44, 9], "rif_east": [44, 24], "rif_south": [44, 39],
    "civ_refuge": [22, 36],
}
zones = {
    "ford_watch": [7, 12, 6, 24], "pasture": [13, 14, 11, 20],
    "village": [25, 15, 9, 18], "mosque_block": [28, 22, 4, 4],
    "depot": [35, 17, 7, 14], "refuge": [19, 34, 8, 6], "east_road": [42, 22, 6, 4],
}

# --- invariants, asserted rather than eyeballed -------------------------------
assert len(rows) == H and all(len(r) == W for r in rows), "grid is not 48x48"
zx, zy, zw, zh = zones["depot"]
depot_syms = {rows[y][x] for y in range(zy, zy + zh) for x in range(zx, zx + zw)}
assert '=' not in depot_syms, "wall inside the raze zone"
assert 'm' not in depot_syms, "mosque inside the raze zone"
assert depot_syms & set('w#s'), "raze zone holds no structures"
for name, (mx, my) in markers.items():
    assert rows[my][mx] in '.123ron', f"marker {name} is on a blocked tile"
rx, ry, rw, rh = zones["refuge"]
cx, cy = markers["civ_refuge"]
assert rx <= cx < rx + rw and ry <= cy < ry + rh, "civ_refuge outside the refuge zone"
assert rows[24][34] == '.', "the depot gate is walled shut"

json.dump({"id": "wadi_halam_basin", "name": "Wadi Halam — The Basin",
           "width": W, "height": H, "terrain": "green",
           "rows": rows, "markers": markers, "zones": zones},
          open("data/maps/wadi_halam_basin.json", "w"), indent=2)
print("\n".join(rows))
```

Run it and read the printed grid:

```bash
python3 "$SCRATCH/build_wadi_halam.py"
```

Expected: no assertion fires, and the printed grid shows the seven bands.

- [ ] **Step 2: Register the map**

In `packages/data/src/index.ts`, add the import beside the other three maps:

```ts
import wadiHalamBasin from '../../../data/maps/wadi_halam_basin.json';
```

and the entry in the `maps` object:

```ts
  wadi_halam_basin: wadiHalamBasin,
```

**This step has no data-validation gate and its failure is silent:** `main.ts:228` resolves an unregistered map with `?? maps.beit_sahwan_outskirts`, so a mission whose map is missing here loads Beit Sahwan and every marker resolves to a Beit Sahwan coordinate. The only gates are the `MapId` type and Task 14's playtest runs.

- [ ] **Step 3: Open the region**

In `data/campaign/world.json`, change `naharin.unlock`:

```json
      "unlock": { "after_mission": "beit_sahwan_3_clearance" },
```

and the blurb:

```json
      "blurb": "A green river basin of terraced pasture and cultivation. The corridor that supplied the Marj's tunnels and Sur's rocket stocks.",
```

The old value named `umm_zeitoun_1`, a mission that does not exist, which passed silently because the validator only checks unlocks naming missions that *do* exist. `beit_sahwan_3_clearance` is in `marj` (region index 0) against `naharin` (index 2), so the earlier-region ordering constraint holds. Sur is no longer on Naharin's critical path.

- [ ] **Step 4: Amend the canon**

In `docs/GDD.md`, line 35:

```
| **Naharin** | eastern river basin — irrigated green highland | Rif Cells | technicals, raids, smuggling, mobility |
```

and lines 49–51:

```
- **Naharin — east, river basin.** Green highland: terraced pasture, cultivation and
  poplar galleries along the water, with the smuggling corridor that supplied the
  Marj's tunnels and Sur's rocket stocks running through it. Last, because cutting
  supply is only decisive once the fronts it feeds are contained.
```

Leave the closing line — *"Every region is defined by terrain and doctrine, never by a people"* — untouched.

- [ ] **Step 5: Verify**

```bash
pnpm validate:data && pnpm typecheck && pnpm test && pnpm build
```

Expected: PASS. The file count `validate:data` reports goes up by one.

- [ ] **Step 6: Commit**

```bash
git add data/maps/wadi_halam_basin.json packages/data/src/index.ts data/campaign/world.json docs/GDD.md
git commit -m "feat(data): Naharin is a green basin, and Wadi Halam has ground to fight on"
```

---

### Task 8: `walk_placements` — see the grid, do not trust the `at`

**Files:**
- Create: `tools/src/walk_placements.ts`

**Interfaces:**
- Consumes: `makeWorld(missionId, opts)` from `tools/src/walk_world.ts`, which loads mission JSON off disk by id and so works *before* a mission is registered in `@lions/data`.
- Produces: `npx tsx tools/src/walk_placements.ts <mission-id>`, exit 1 on any body landing blocked or off-map. Tasks 9–13 each run it.

- [ ] **Step 1: Write the tool**

```ts
/**
 * Print a mission's map with every placement overlaid, and fail on a bad one.
 *
 *   npx tsx tools/src/walk_placements.ts wadi_halam_5_depot
 *
 * Why this exists. `assertGroundClear` spreads a placement's bodies 1.25 tiles
 * apart -- body k lands at x + (k % 3) * 1.25, y + floor(k / 3) * 1.25 -- so a
 * count-3 group occupies its declared tile PLUS roughly three tiles east, and a
 * count-6 adds a second row two tiles south. A clear `at` therefore does not mean
 * clear ground. Its own docstring records a civilian group whose `at` was open
 * street putting its middle body inside a mosque, and that survived a hand audit
 * and a code review.
 *
 * Lives under tools/src so `pnpm typecheck` covers it. Read-only: nothing is
 * written, nothing is rendered.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorld } from './walk_world';

const missionId = process.argv[2];
if (!missionId) {
  console.error('usage: npx tsx tools/src/walk_placements.ts <mission-id>');
  process.exit(1);
}

const mission = JSON.parse(
  readFileSync(join(process.cwd(), `data/missions/${missionId}.json`), 'utf8')
) as {
  map: { file: string };
  starting_force?: Placement[];
  civilians?: { groups?: Placement[] };
  enemy?: { garrison?: Placement[]; waves?: { units: Placement[] }[] };
  triggers?: { do?: { units?: Placement[] } }[];
};
type Placement = { unit: string; count?: number; at?: [number, number]; marker?: string };

const { sim } = makeWorld(missionId);
const map = JSON.parse(
  readFileSync(join(process.cwd(), `data/maps/${mission.map.file}.json`), 'utf8')
) as { width: number; height: number; rows: string[]; markers?: Record<string, [number, number]>; zones?: Record<string, [number, number, number, number]> };

const W = map.width;
const H = map.height;
const cell: string[][] = [];
for (let y = 0; y < H; y++) {
  cell.push([]);
  for (let x = 0; x < W; x++) {
    cell[y].push(sim.blocked[y * W + x] ? '#' : sim.cover[y * W + x] ? String(sim.cover[y * W + x]) : '.');
  }
}
for (const [name, [mx, my]] of Object.entries(map.markers ?? {})) {
  if (cell[my]?.[mx] !== undefined) cell[my][mx] = '+';
  void name;
}

let bad = 0;
function place(p: Placement, label: string): void {
  const at = p.at ?? (p.marker ? map.markers?.[p.marker] : undefined);
  if (!at) {
    console.error(`  ${label} ${p.unit}: neither at nor a resolvable marker`);
    bad++;
    return;
  }
  const n = p.count ?? 1;
  for (let k = 0; k < n; k++) {
    const bx = Math.floor(at[0] + (k % 3) * 1.25);
    const by = Math.floor(at[1] + Math.floor(k / 3) * 1.25);
    if (bx < 0 || bx >= W || by < 0 || by >= H) {
      console.error(`  ${label} ${p.unit} body ${k}: OFF-MAP at (${bx},${by})`);
      cell[at[1]]?.[at[0]] !== undefined && (cell[at[1]][at[0]] = '!');
      bad++;
      continue;
    }
    if (sim.blocked[by * W + bx]) {
      console.error(`  ${label} ${p.unit} body ${k}: BLOCKED at (${bx},${by})`);
      cell[by][bx] = 'X';
      bad++;
      continue;
    }
    cell[by][bx] = 'o';
  }
}

for (const p of mission.starting_force ?? []) place(p, 'starting_force');
for (const p of mission.enemy?.garrison ?? []) place(p, 'garrison');
for (const p of mission.civilians?.groups ?? []) place(p, 'civilians');
for (const w of mission.enemy?.waves ?? []) for (const p of w.units) place(p, 'wave');
for (const t of mission.triggers ?? []) for (const p of t.do?.units ?? []) place(p, 'trigger');

console.log(cell.map((r) => r.join('')).join('\n'));
console.log(`\nzones: ${Object.entries(map.zones ?? {}).map(([k, v]) => `${k}[${v}]`).join(' ')}`);
console.log(bad === 0 ? '\nall placements clear' : `\n${bad} bad placement(s)`);
process.exitCode = bad === 0 ? 0 : 1;
```

- [ ] **Step 2: Verify it works on an existing mission**

```bash
npx tsx tools/src/walk_placements.ts beit_sahwan_3_clearance
```

Expected: a 48×48 grid printed, `all placements clear`, exit 0. If it reports a bad placement on a shipped mission, that is a real finding — investigate before continuing.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add tools/src/walk_placements.ts
git commit -m "feat(tools): print the grid with every body on it, and fail on a bad one"
```

---

### Tasks 9–13: The five missions

Each mission is one task with the same five-step shape. Author the JSON, register it in **both** `packages/data/src/index.ts` and `data/campaign/world.json` (a mission file no town lists fails `pnpm validate:data`), then walk it.

Common to all five: `"town": "wadi_halam"`, `"map": { "file": "wadi_halam_basin", ... }`, `"enemy": { "faction": "rif", ... }`, `target_minutes` 5–7. The Rif roster is three vehicles and no infantry, so `militia_cell` and `rpg_team` are borrowed for anything dismounted — existing practice, since `beit_sahwan_3_clearance` is `faction: ashwar` and garrisons `technical`, `gun_truck` and `atgm_cell`.

The per-mission JSON, objectives, enemy composition and triggers are specified in full in the spec's "The five missions" section — author each exactly as written there, including the tag names, since Tasks 9–13's objectives reference each other's tags through `intel.marked_positions`.

**Per-mission step sequence** (repeat for each of I–V):

- [ ] **Step 1: Write `data/missions/wadi_halam_<n>_<name>.json`** per the spec section for that mission.

- [ ] **Step 2: Register it.** Import + `missions` entry in `packages/data/src/index.ts`; id appended to `wadi_halam.missions` in `data/campaign/world.json`, in play order.

- [ ] **Step 3: Validate and walk.**

```bash
pnpm validate:data && pnpm typecheck
npx tsx tools/src/walk_placements.ts wadi_halam_<n>_<name>
npx tsx tools/src/walk_mission.ts wadi_halam_<n>_<name> 0 30 60 120 240 360
```

Expected: `validate:data` green, `all placements clear`, and the walk showing both sides alive and the objectives reachable at each mark. **The walk is the only thing that sees what an authored mission actually does** — every unit test builds its own fixture world. Specifically check: III's HVT is still alive when his `withdraw_to` fires; IV's civilians are within shepherding reach before the 300s deadline; V's `wh_gate_rpg` has not been killed incidentally by a wave before the objective can register it.

- [ ] **Step 4: Play it in the browser.** Start the preview from this tree, open the mission from the world map, and confirm it loads, reads green, and its objectives can be driven. Drive the UI — console shortcuts skip the code that breaks and have already cost two false "it works" claims on this project.

- [ ] **Step 5: Commit.**

```bash
git add data/missions/wadi_halam_<n>_<name>.json packages/data/src/index.ts data/campaign/world.json
git commit -m "feat(data): <mission name>"
```

**Task 9 — I `wadi_halam_1_fords` "The Fords"** · recon · 6 min. Must run from an **empty ledger** — it is the entry point to the region. Five garrisoned bodies against `picture`'s `count: 4`; a bare-count `locate` counts identified *units*, not tags.

**Task 10 — II `wadi_halam_2_laager` "Grazing Ground"** · foothold · 7 min. `resources`: `logistics_start: 400`, `logistics_rate_per_min: 120`. **`supply_corridor` must be absent** — the flag is inert and setting it would claim a mechanic that does not exist.

**Task 11 — III `wadi_halam_3_counterraid` "The Cattle Track"** · buildup · 6 min. The HVT rides a `technical` via the placement's `passengers` array — `eliminate_hvt` checks tag existence, not garrisoning, despite what its error message says.

**Task 12 — IV `wadi_halam_4_village` "Wadi Halam"** · clearance · 7 min. `civilians.refuge: "civ_refuge"` must sit inside the `refuge` zone or `start()` throws — the map generator in Task 7 asserts this.

**Task 13 — V `wadi_halam_5_depot` "Break the Depot"** · clearance · 6 min. **One `dozer_d9` in `starting_force`, not built.** `unlock.roe_rating_min: 60` is enforced only in `requestBuild` (`mission.ts:389`); `spawnPlacement` (`:493`) never consults it, so a starting-force D9 arrives at any campaign ROE and the mission stays completable. Requiring the player to build one makes it unwinnable below 60. `structure_penalty_mult: 1`, `fail_below: 40` — the sanctioned demolition costs 19 ROE.

---

### Task 14: The playtest harness — two fixes and six runs

**Files:**
- Modify: `tools/src/backtest/playtest.ts` (`run` signature :8–14, `unitInfo` :40–44)

**Interfaces:**
- Consumes: all five registered missions (Tasks 9–13).
- Produces: the winnability proof.

- [ ] **Step 1: Fix `unitInfo` — it ignores unit unlocks**

`playtest.ts:40–44` omits `unlock`, unlike `main.ts:270–280`. So `requestBuild` in a playtest ignores every ROE gate, and a plan that buys a D9 proves nothing about what the app would allow. Change:

```ts
    unitInfo: (u) => {
      const d = (units as Record<string, { faction: string; unlock?: unknown; cost: { logistics: number; build_time_s?: number } } | undefined>)[u];
      return d && d.faction === 'kdf'
        ? { logistics: d.cost.logistics, buildTimeS: d.cost.build_time_s ?? 20, unlock: d.unlock }
        : null;
    },
```

- [ ] **Step 2: Widen `expect` so a run can be required not to resolve**

```ts
function run(
  id: keyof typeof missions,
  plan: Plan,
  ledger: LedgerData = {},
  expect: 'victory' | 'defeat' | 'ongoing' = 'victory',
  label: string = id
): LedgerData {
```

No other change is needed — `run` already compares `rt.result` against `expect` directly, and `rt.result` is `'ongoing' | 'victory' | 'defeat'`.

- [ ] **Step 3: Add the five chained runs**

At the end of the file, threading each produced ledger into the next exactly as the Beit Sahwan chain does:

```ts
// --- Naharin: Wadi Halam ------------------------------------------------------
const wh1 = run('wadi_halam_1_fords', (sim, rt, ids, at) => { /* orders per the mission */ });
const wh2 = run('wadi_halam_2_laager', (sim, rt, ids, at) => { /* ... */ }, wh1);
const wh3 = run('wadi_halam_3_counterraid', (sim, rt, ids, at) => { /* ... */ }, wh2);
const wh4 = run('wadi_halam_4_village', (sim, rt, ids, at) => { /* ... */ }, wh3);
run('wadi_halam_5_depot', (sim, rt, ids, at) => { /* ... */ }, wh4);
```

Write each plan body as a sensible scripted attack: select by type with `ids('inf_squad')`, issue moves and attack-moves through `sim.queueCommand`, and time them with `at(seconds, fn)`. Follow the Beit Sahwan plans in the same file for the command shapes.

- [ ] **Step 4: Add the control run**

```ts
// A player who gives no orders must not WIN the depot. This is the executable
// falsification of raze's worst failure mode: if the target set is ever empty,
// or `every()` degenerates on an empty array, this turns VICTORY and the harness
// fails. It also proves the D9's automatic demolition search does not level the
// depot unattended from the start line.
//
// `ongoing` rather than `defeat`: a passive force here is neither wiped nor
// victorious, it simply runs out the 20-minute cap.
run('wadi_halam_5_depot', () => {}, wh4, 'ongoing', 'wadi_halam_5_depot (no orders)');
```

- [ ] **Step 5: Run it**

```bash
cd tools && npx tsx src/backtest/playtest.ts; cd ..
```

Expected: all five report `VICTORY` inside their `target_minutes`, the control reports `ONGOING`, and exit code 0. **If a mission loses, the mission is too hard — tune the wave counts, `hold_for` durations or the depot's structure count and re-run.** Difficulty is measured here, not assumed; losses compound by design and a single extra vehicle has swung a mission by five minutes on this project.

- [ ] **Step 6: Commit**

```bash
git add tools/src/backtest/playtest.ts
git commit -m "test(tools): the Wadi Halam arc is winnable, and doing nothing is not"
```

---

### Task 15: Full gate sweep and the honest issue update

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run every gate**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && \
pnpm validate:assets && pnpm validate:ui && pnpm validate:audio && \
python3 tools/validate_balance.py --units data/units && pnpm balance && pnpm build
```

Expected: all PASS.

- [ ] **Step 2: Determinism, on the pinned hash**

```bash
pnpm test:determinism
```

Expected: 4/4 with `4029834894` **unchanged**.

- [ ] **Step 3: Drive the whole arc in the browser**

Complete (or seed) the Marj arc, confirm Naharin shows **live** on the world map rather than locked, then play each of the five. Confirm the basin reads as green highland rather than recoloured desert, that blade ticks read as grass and not noise, and that a Beit Sahwan mission is visually unchanged. Screenshots at the end — this is the half no gate covers.

- [ ] **Step 4: Report honestly on #21**

**Do not close #21.** Two of its acceptance lines are not met and both are deliberate:

- *"Missions built around raids and the supply corridor"* — the corridor half is unmet. `resources.supply_corridor` remains inert (`mission.ts:571–573`, *"interdiction is a later slice"*). Open a separate issue for corridor interdiction and link it.
- GDD §5.7's **Raid (Rif)** target is unimplemented in `tools/src/backtest/targets.ts`, so "mobility is their armour" — the premise this whole arc rests on — is unmeasured, and `pnpm balance` stays green because it does not test it. Flag as blocking for M2.

Say both plainly in the PR body rather than letting a green gate list imply more than it proves.

---

## Self-Review

**Spec coverage.** Scope items 1–8 map to tasks: canon → 7; grass ramp → 2; terrain theme → 1, 3, 4; `raze` → 5, 6; the map → 7; five missions → 9–13; unlock retarget → 7; harness fixes → 14. The spec's `walk_placements` tool → 8; its full gate list → 15.

**Known gaps, stated rather than hidden.** Tasks 9–13 delegate the mission JSON bodies to the spec's mission section rather than reprinting five 100-line files, and Task 14's `run()` plan bodies are described by shape rather than written out — the orders depend on unit ids that only exist at runtime, and they will be tuned against playtest output anyway. An executor needs the spec open for those two tasks. Everything else is literal.

**Type consistency.** `TerrainTheme` (Task 1, `@lions/data`) and `TerrainTones` / `TerrainScatter` (Task 3, `@lions/render`) are distinct on purpose — `@lions/render` must not import `@lions/data`, so `main.ts` is the one module holding both and indexing `TERRAIN_THEMES` by the data-side type. `drawOliveTree` → `drawCanopy` is renamed in Task 3 and referenced under the new name thereafter. `razeTargets` (Task 5) is written in `start()` and read in `stepObjectives` under the same name.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-16-wadi-halam-green-basin.md`.
