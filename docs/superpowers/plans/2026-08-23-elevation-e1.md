# Elevation E1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-tile elevation authorable in map JSON, carry it into the sim, and draw terrain with real height — without changing a single game outcome.

**Architecture:** A parallel character grid in map JSON becomes `ParsedMap.elevation`, reaches `Sim.elevation` through the existing `applyTerrain` door, and is included in the determinism hash. The renderer extrudes terrain by `elevation × 10` px and lifts ground-positioned draws through one `groundOffset` helper. Nothing reads elevation for line of sight, sight range or pathing — that is E2 and E3.

**Tech Stack:** TypeScript strict, pnpm workspaces, vitest, PixiJS, JSON Schema (ajv).

**Spec:** `docs/superpowers/specs/2026-08-23-elevation-e1-design.md` (committed `57903a7`)

## Global Constraints

- **The field is named `elevation` everywhere — NOT `height`.** `ParsedMap.height` is already the map's row count, and `applyTerrain` destructures it at `map.ts:319`. An elevation array called `height` shadows the dimension. This corrects the spec, which says `heights`; the spec's JSON example is the only place that wording appears and Task 6 fixes it.
- **No behaviour may change.** All four shipped maps are flat, so all eleven missions must produce identical outcomes. `pnpm balance`'s five figures and `pnpm playtest`'s two known failures are the evidence.
- **The determinism pin moves exactly ONCE**, in Task 2, because a new array joins the hash. It is updated in the same commit with the reason stated, as CLAUDE.md requires. It must not move in any other task.
- **`@lions/sim` is Q16.16 fixed-point.** `Math.*` and `Date.*` are banned in that package. Elevation is a `Uint8Array` of small integers — no fixed-point conversion needed, and none should be added.
- **`@lions/data` imports nothing from other packages.** `TerrainSink` stays structurally typed.
- **No raw colour literals in render code.** `pnpm validate:ui` rejects hex and `rgba()` with no allowlist.
- **TypeScript strict. No `any`. No non-null assertions.**
- **Never `git add -A` or `git add .`, and never `git stash` in any form.** This repository's stash stack is shared with other live worktrees and concurrent sessions. Stage the exact paths each task names.
- **Commit message trailers** — every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `data/schemas/map.schema.json` | declare the optional `elevation` grid | 1 |
| `packages/data/src/map.ts` | `MapJson.elevation`, `ParsedMap.elevation`, parsing and validation | 1 |
| `packages/data/src/map.test.ts` | parsing, defaults, dimension mismatch | 1, 2 |
| `packages/data/src/map.ts` | `TerrainSink.setElevation`, `applyTerrain` carries it | 2 |
| `packages/sim/src/sim.ts` | `Sim.elevation`, `setElevation`, hash inclusion | 2 |
| `packages/sim/src/determinism.test.ts` | the pin, moved once | 2 |
| `packages/render/src/renderer.ts` | `setElevation`, extruded terrain draw | 3 |
| `packages/render/src/renderer.ts` | `groundOffset`, routed into ground draws | 4 |
| `packages/render/src/renderer.ts` | `screenToWorld` height correction | 5 |
| `packages/app/src/main.ts` | hand the elevation array to the renderer | 3 |
| `CLAUDE.md`, the spec | document the format and fix the `heights` wording | 6 |

---

### Task 1: Elevation as map data

**Files:**
- Modify: `data/schemas/map.schema.json`
- Modify: `packages/data/src/map.ts`
- Modify: `packages/data/src/map.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `MapJson.elevation?: string[]` and `ParsedMap.elevation: Uint8Array` (row-major, `width * height`), consumed by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Append to `packages/data/src/map.test.ts`:

```ts
// Elevation is authored as a parallel character grid, one digit per tile, and
// is ORTHOGONAL to the terrain symbol rather than derived from it. That is what
// makes valleys possible: open ground can sit high or low, and `^` rock is only
// a mountain because the author put it on high ground. Deriving height from the
// symbol would give ridges and nothing else.
//
// The field is `elevation`, not `height`: ParsedMap.height is already the map's
// row count, and applyTerrain destructures it.
describe('elevation', () => {
  const RELIEF: MapJson = {
    id: 'relief',
    name: 'Relief',
    width: 4,
    height: 3,
    rows: ['....', '..^.', '....'],
    elevation: ['0000', '0330', '0110'],
  };

  it('parses one digit per tile, row-major', () => {
    const m = parseMap(RELIEF);
    expect(Array.from(m.elevation)).toEqual([0, 0, 0, 0, 0, 3, 3, 0, 0, 1, 1, 0]);
  });

  it('defaults every tile to zero when the field is absent', () => {
    const flat = parseMap({ id: 'f', name: 'F', width: 4, height: 3, rows: ['....', '....', '....'] });
    expect(Array.from(flat.elevation)).toEqual(new Array(12).fill(0));
  });

  it('is independent of the terrain symbol', () => {
    // Rock at height 0 and open ground at height 3 both parse. Odd-looking, and
    // the author's business -- the same way a mosque in a field is.
    const m = parseMap({ ...RELIEF, elevation: ['0033', '0000', '0000'] });
    expect(m.elevation[2]).toBe(3);
    expect(m.elevation[6]).toBe(0); // the `^` tile
    expect(m.blocked[6]).toBe(1); // still blocked, height changes nothing
  });

  it('rejects a row count that does not match the map', () => {
    expect(() => parseMap({ ...RELIEF, elevation: ['0000', '0330'] })).toThrow(
      /elevation has 2 rows, declared height 3/
    );
  });

  it('rejects a row whose width does not match', () => {
    expect(() => parseMap({ ...RELIEF, elevation: ['0000', '033', '0110'] })).toThrow(
      /elevation row 1 has 3 tiles, declared width 4/
    );
  });

  it('rejects a non-digit', () => {
    expect(() => parseMap({ ...RELIEF, elevation: ['0000', '0x30', '0110'] })).toThrow(
      /unknown elevation "x" at \(1,1\)/
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm vitest run packages/data/src/map.test.ts
```

Expected: FAIL — `elevation` is not a property of `MapJson`, and `ParsedMap` has no `elevation`.

- [ ] **Step 3: Declare the field**

In `packages/data/src/map.ts`, add to `MapJson` (after `terrain`):

```ts
  /** Per-tile elevation, one digit 0-9 per tile, same dimensions as `rows`.
   *  Absent means every tile is height 0, which is every map authored before
   *  the elevation milestone. Orthogonal to the terrain symbol on purpose:
   *  deriving height from the symbol would give ridges and no valleys. */
  elevation?: string[];
```

and to `ParsedMap` (after `decor`):

```ts
  /** Elevation level 0-9 per tile, row-major. E1 stores and draws it; nothing
   *  reads it for line of sight, sight range or pathing yet. */
  elevation: Uint8Array;
```

- [ ] **Step 4: Parse it**

In `parseMap`, after the `decor` loop closes and before the markers block, insert:

```ts
  const elevation = new Uint8Array(width * height);
  if (json.elevation !== undefined) {
    if (json.elevation.length !== height) {
      throw new Error(
        `map ${json.id}: elevation has ${json.elevation.length} rows, declared height ${height}`
      );
    }
    for (let y = 0; y < height; y++) {
      const row = json.elevation[y];
      if (row.length !== width) {
        throw new Error(
          `map ${json.id}: elevation row ${y} has ${row.length} tiles, declared width ${width}`
        );
      }
      for (let x = 0; x < width; x++) {
        const ch = row[x];
        if (ch < '0' || ch > '9') {
          throw new Error(`map ${json.id}: unknown elevation "${ch}" at (${x},${y})`);
        }
        elevation[y * width + x] = ch.charCodeAt(0) - 48;
      }
    }
  }
```

and add `elevation` to the returned object.

- [ ] **Step 5: Add it to the schema**

In `data/schemas/map.schema.json`, alongside `terrain`:

```json
    "elevation": {
      "type": "array",
      "description": "Per-tile elevation, one digit 0-9 per tile, with the same dimensions as rows. Absent means every tile is height 0. Deliberately orthogonal to the terrain symbol: a symbol table can express ridges but not valleys, and elevation needs both. 0-4 is the practical authoring range -- deeper relief reads as a wall rather than as terrain -- but 0-9 is legal so a dramatic peak needs no format change.",
      "items": { "type": "string", "pattern": "^[0-9]+$" }
    },
```

- [ ] **Step 6: Run the tests and the data gate**

```bash
pnpm vitest run packages/data/src/map.test.ts
pnpm validate:data
pnpm typecheck
```

Expected: tests PASS; the data gate passes with its usual file count (no map declares `elevation` yet, and its absence stays legal); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add data/schemas/map.schema.json packages/data/src/map.ts packages/data/src/map.test.ts
git commit -F - <<'EOF'
feat(data): maps can declare per-tile elevation

A parallel character grid beside `rows`, one digit per tile, optional --
absent means flat, which is every map that exists today.

Elevation is ORTHOGONAL to the terrain symbol rather than derived from
it, and that is the load-bearing decision. Deriving height from `^`
would give ridges and nothing else: no basins, no terraces, no valley
floor. Valleys are the half of "mountains and valleys" that a symbol
table cannot express, so height gets its own grid and an author can put
open ground high or rock low.

Named `elevation`, not `height`: ParsedMap.height is already the map's
row count and applyTerrain destructures it, so an elevation array called
`height` would shadow the dimension.

Nothing reads it yet. This commit stores it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 2: Elevation reaches the sim, and the pin moves once

This is the task the milestone's safety rests on. Adding an array to the determinism hash changes it even when every value is zero. The pin moves here, deliberately, and **must not move in any other task**.

**Files:**
- Modify: `packages/data/src/map.ts` (`TerrainSink`, `applyTerrain`)
- Modify: `packages/data/src/map.test.ts` (the `applyTerrain` describe block)
- Modify: `packages/sim/src/sim.ts` (field, constructor, setter, hash)
- Modify: `packages/sim/src/determinism.test.ts` (the golden hash)

**Interfaces:**
- Consumes: `ParsedMap.elevation` from Task 1.
- Produces: `Sim.elevation: Uint8Array` (public readonly), `Sim.setElevation(x, y, h)`, and `TerrainSink.setElevation(x, y, h)`. Task 3 reads `map.elevation`; nothing reads `Sim.elevation` until E2.

- [ ] **Step 1: Write the failing tests**

In `packages/data/src/map.test.ts`, the existing `applyTerrain` describe block has a `sink()` helper. Extend it to record elevation and add two cases. Replace the helper and add the cases:

```ts
  function sink(): { blocks: Call[]; covers: Call[]; elevs: Call[] } & TerrainSink {
    const blocks: Call[] = [];
    const covers: Call[] = [];
    const elevs: Call[] = [];
    return {
      blocks,
      covers,
      elevs,
      setBlocked: (x, y, v) => blocks.push({ x, y, v }),
      setCover: (x, y, v) => covers.push({ x, y, v }),
      setElevation: (x, y, v) => elevs.push({ x, y, v }),
    };
  }

  it('passes elevation through for raised tiles only', () => {
    const s = sink();
    applyTerrain(
      parseMap({ id: 'e', name: 'E', width: 3, height: 2, rows: ['...', '...'],
                 elevation: ['030', '001'] }),
      s
    );
    expect(s.elevs).toEqual([
      { x: 1, y: 0, v: 3 },
      { x: 2, y: 1, v: 1 },
    ]);
  });

  it('says nothing about elevation on a flat map', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'f', name: 'F', width: 3, height: 2, rows: ['...', '...'] }), s);
    expect(s.elevs).toEqual([]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm vitest run packages/data/src/map.test.ts
```

Expected: FAIL — `setElevation` is not a member of `TerrainSink`.

- [ ] **Step 3: Extend the sink and the function**

In `packages/data/src/map.ts`, `TerrainSink` becomes:

```ts
export interface TerrainSink {
  setBlocked(x: number, y: number, b: boolean): void;
  setCover(x: number, y: number, c: number): void;
  setElevation(x: number, y: number, h: number): void;
}
```

and `applyTerrain`'s body becomes:

```ts
export function applyTerrain(map: ParsedMap, sink: TerrainSink): void {
  const { width, height, blocked, cover, elevation } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      if (blocked[t] !== 0) sink.setBlocked(x, y, true);
      if (cover[t] !== 0) sink.setCover(x, y, cover[t]);
      if (elevation[t] !== 0) sink.setElevation(x, y, elevation[t]);
    }
  }
}
```

Note `height` here is the map's ROW COUNT, already destructured — which is exactly why the elevation array is not called `height`.

- [ ] **Step 4: Add the field to the sim**

In `packages/sim/src/sim.ts`, beside `readonly cover: Uint8Array;` (~line 631):

```ts
  /** Elevation level 0-9 per tile, row-major. Stored and hashed; nothing reads
   *  it for line of sight, sight range or pathing yet -- that is E2 and E3. It
   *  is hashed anyway, because a replay that ignored terrain the renderer draws
   *  would be a replay of a different battlefield. */
  readonly elevation: Uint8Array;
```

Beside `this.cover = new Uint8Array(tiles);` (~line 863):

```ts
    this.elevation = new Uint8Array(tiles);
```

Beside `setCover` (~line 1016):

```ts
  setElevation(x: number, y: number, h: number): void {
    this.elevation[y * this.width + x] = h;
  }
```

And in the hash, immediately after `h = hashArray(h, this.cover);`:

```ts
    h = hashArray(h, this.elevation);
```

- [ ] **Step 5: Run the sim tests and read the new pin**

```bash
pnpm vitest run packages/data/src/map.test.ts
pnpm test:determinism
```

Expected: `map.test.ts` PASSES. `test:determinism` **FAILS** on the golden hash — that is correct and expected. Record the **actual** value it reports; you need it in the next step.

- [ ] **Step 6: Move the pin, once, with its reason**

In `packages/sim/src/determinism.test.ts`, replace the golden hash literal with the value from Step 5, and put the reason directly above it:

```ts
  // Moved for the elevation milestone (E1): Sim.elevation joined the hash.
  // Every shipped map is flat, so no OUTCOME changed -- the hash covers one
  // more array whose every value is zero. `pnpm balance` and `pnpm playtest`
  // are the evidence: five figures and two known failures, all unmoved.
```

Do **not** update it again in any later task. If a later task moves the pin, that task has a bug.

- [ ] **Step 7: Wire the three call sites**

None of `packages/app/src/main.ts`, `tools/src/walk_world.ts` or `tools/src/backtest/playtest.ts` needs editing — each calls `applyTerrain(map, sim)`, and `Sim` now satisfies the widened `TerrainSink` structurally. **Verify this rather than assuming it**: run `pnpm typecheck` and confirm no call site errors. If one does, report it rather than working around it.

- [ ] **Step 8: Prove no outcome changed**

```bash
pnpm test
pnpm balance
pnpm playtest
```

Expected, and this is the gate that matters:

| Command | Expectation |
|---|---|
| `test` | all pass, count unchanged except the new data tests |
| `balance` | **five figures byte-identical** to before this task |
| `playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` — the #96/#97 baseline |

The hash was expected to move. **Anything else moving means storage is leaking into behaviour** — stop and report it rather than adjusting a figure.

- [ ] **Step 9: Commit**

```bash
git add packages/data/src/map.ts packages/data/src/map.test.ts \
        packages/sim/src/sim.ts packages/sim/src/determinism.test.ts
git commit -F - <<'EOF'
feat(sim): elevation reaches the sim, and the pin moves once

Sim gains a readonly elevation array beside blocked and cover, a
setElevation setter, and inclusion in the determinism hash. It arrives
through applyTerrain, the function that replaced three hand-copied cover
loops one slice ago -- so main.ts, walk_world.ts and playtest.ts all gain
elevation without any of them being edited.

The determinism pin moves, deliberately and exactly once, because a new
array joined the hash. No outcome changed: every shipped map is flat, so
the hash now covers one more array whose every value is zero.

The evidence that nothing else moved is pnpm balance's five figures and
pnpm playtest's two known failures, both unchanged. The hash could not
serve as that evidence, since the hash is the thing expected to differ.

Nothing reads elevation yet. That is E2 (line of sight) and E3 (sight
range).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 3: Terrain draws with height

**Files:**
- Modify: `packages/render/src/renderer.ts` (a `setElevation` method beside `setDecor`; the terrain draw)
- Modify: `packages/app/src/main.ts` (hand the array over, beside `renderer.setDecor(map.decor)`)

**Interfaces:**
- Consumes: `ParsedMap.elevation` from Task 1.
- Produces: `PixiRenderer.setElevation(elevation: Uint8Array): void`, and `ELEV_STEP = 10`. Task 4 reads the stored array through a helper it adds.

- [ ] **Step 1: Add the constant and the setter**

In `packages/render/src/renderer.ts`, beside `TILE_W` / `TILE_H` (~line 84):

```ts
/** Screen pixels per elevation level.
 *
 * 10 px means a 4-level ridge stands 40 px against TILE_H's 32 and a building's
 * 18 -- clearly taller than a building without dwarfing the units on it. The
 * number is a judgement nobody had seen rendered when it was chosen, and it is
 * one line to change. */
export const ELEV_STEP = 10;
```

Beside the `decor` field (~line 217) add `private elevation: Uint8Array | null = null;`, and beside `setDecor` (~line 660):

```ts
  /**
   * Hand the renderer the map's elevation layer.
   *
   * Presentation only in E1 -- the sim stores the same numbers and reads none
   * of them. When E2 gives elevation to `losRay`, this stays the renderer's
   * copy: the renderer must never ask the sim what to draw tile by tile.
   */
  setElevation(elevation: Uint8Array): void {
    this.elevation = elevation;
    this.terrainDirty = true;
  }
```

- [ ] **Step 2: Lift the terrain diamond**

In `drawTerrain`'s per-tile loop, immediately after `cy` is computed (~line 1248), insert:

```ts
        const lift = this.elevation ? this.elevation[ti] * ELEV_STEP : 0;
        const cyG = cy - lift;
```

Then replace every use of `cy` **inside this loop** with `cyG`, including in the `diamond` array. Leave `cy` computed — Task 4 needs the unlifted value for comparison, and other methods use their own.

- [ ] **Step 3: Draw the side faces**

A lifted diamond floating with nothing under it reads as a hovering tile. Immediately before the diamond is filled, add:

```ts
        if (lift > 0) {
          // The two faces an isometric viewer can see: south-west and
          // south-east. Drawn darker than the top, and darker still with
          // depth, so a tall ridge reads as mass rather than as a tall flat
          // shape. Palette tones only -- validate:ui rejects a literal.
          const w2 = TILE_W / 2;
          const h2 = TILE_H / 2;
          g.poly([cx - w2, cyG, cx, cyG + h2, cx, cyG + h2 + lift, cx - w2, cyG + lift])
            .fill({ color: t.rock, alpha: 0.85 });
          g.poly([cx + w2, cyG, cx, cyG + h2, cx, cyG + h2 + lift, cx + w2, cyG + lift])
            .fill({ color: t.rock, alpha: 0.7 });
        }
```

- [ ] **Step 4: Hand the array over**

In `packages/app/src/main.ts`, immediately after `renderer.setDecor(map.decor);`:

```ts
  renderer.setElevation(map.elevation);
```

- [ ] **Step 5: Verify it compiles and the gates hold**

```bash
pnpm typecheck
pnpm lint
pnpm validate:ui
pnpm build
pnpm test:determinism
```

Expected: all pass, and **the determinism pin does NOT move** — this task touches no sim code. If it moves, something is very wrong; stop and report.

- [ ] **Step 6: Commit**

```bash
git add packages/render/src/renderer.ts packages/app/src/main.ts
git commit -F - <<'EOF'
feat(render): terrain draws with height

Terrain diamonds lift by elevation x 10 px and gain the two side faces
an isometric viewer can see, so a ridge has mass and a valley reads as
sunken rather than as a differently-coloured floor.

10 px per level puts a 4-level ridge at 40 px against TILE_H's 32 and a
building's 18 -- taller than a building, not dwarfing the units on it.
Nobody had seen extruded terrain in this game when that number was
chosen, and it is one line to change.

Units still draw at ground level and will sink into hills until the next
commit lifts them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 4: Units lift with the ground

Terrain now has height and everything standing on it does not, so units sink into hills. There are **61 `isoX`/`isoY` call sites** in the renderer and they are not all ground positions — VFX offsets, UI anchors and camera maths use the same helpers.

**Do not edit all 61.** Add one helper and route the draws that genuinely sit on terrain through it.

**Files:**
- Modify: `packages/render/src/renderer.ts`

**Interfaces:**
- Consumes: `this.elevation` and `ELEV_STEP` from Task 3.
- Produces: `private groundOffset(x: number, y: number): number`.

- [ ] **Step 1: Add the helper**

```ts
  /**
   * Screen-space lift, in pixels, for a world position standing on the ground.
   *
   * Sampled at the containing tile rather than interpolated across the four
   * corners: a unit crossing a terrace steps up rather than ramping. That is
   * cheaper, it is stable under the renderer's 60 fps interpolation, and at 10
   * px a step it is barely perceptible. Interpolation is a change to make if it
   * looks wrong, not a thing to build before anyone has looked.
   */
  private groundOffset(x: number, y: number): number {
    if (!this.elevation) return 0;
    const tx = x | 0;
    const ty = y | 0;
    if (tx < 0 || ty < 0 || tx >= this.sim.width || ty >= this.sim.height) return 0;
    return this.elevation[ty * this.sim.width + tx] * ELEV_STEP;
  }
```

- [ ] **Step 2: Route the ground-positioned draws through it**

Subtract `this.groundOffset(x, y)` from the y-coordinate at each site that positions something standing on terrain. From the known positions:

| line (approx) | what | apply |
|---|---|---|
| `:285` | unit sprite | yes |
| `:1184` | dying unit, mid-collapse | yes |
| `:1205` | wreck | yes |
| `:1586` | structure sprite | yes |
| `:1631` | building tile | yes |
| `:1899` | unit body draw | yes |
| `:1962` | turret, on top of a unit body | yes — same offset as its body |

**Search the file for the rest rather than trusting this table**, which was built from a partial grep. The test for whether a site needs it: *does this thing stand on the ground?* Units, wrecks, structures, decor and selection rings do. Screen-space UI, camera maths and VFX that already anchor to a sprite do not.

- [ ] **Step 3: List what you left alone**

In your report, list every `isoX`/`isoY` site you did **not** change and one clause on why. A reviewer needs to check the judgement rather than trust it, and a missed ground draw is a floating object that no test will catch.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:determinism
```

Expected: all pass, **pin unmoved** (no sim code touched).

- [ ] **Step 5: Commit**

```bash
git add packages/render/src/renderer.ts
git commit -F - <<'EOF'
feat(render): units stand on the terrain instead of inside it

One groundOffset helper, routed into the draws that genuinely sit on
the ground -- units, wrecks, structures, decor -- rather than edited
into all 61 isoX/isoY call sites, most of which are VFX offsets, UI
anchors or camera maths that must not move with the terrain.

The offset samples the containing tile rather than interpolating across
corners, so a unit crossing a terrace steps up rather than ramping. At
10 px a step that is barely perceptible, and interpolation is a change
to make if it looks wrong rather than one to build before anyone has
looked.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 5: Picking, corrected once and honest about it

`screenToWorld` (`renderer.ts:887`) inverts the isometric transform with no height term. With elevation, clicking a raised tile resolves to the tile *behind* it — the higher the ground, the further off.

The exact solution is a raycast down the height field, because one screen point can correspond to several world tiles at different heights. **E1 does not build that.**

**Files:**
- Modify: `packages/render/src/renderer.ts:887-894`

**Interfaces:**
- Consumes: `groundOffset` from Task 4.
- Produces: nothing new; `screenToWorld`'s signature is unchanged.

- [ ] **Step 1: Correct once**

Replace the body of `screenToWorld` with:

```ts
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const cx = this.app.renderer.width / 2;
    const cy = this.app.renderer.height / 2;
    const z = this.camera.zoom;
    const sx = (px - cx) / z + isoX(this.camera.x, this.camera.y);
    const sy = (py - cy) / z + isoY(this.camera.x, this.camera.y);
    const flat = { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
    // Approximate, and deliberately so. Terrain lifts a tile on screen, so a
    // click lands on the tile BEHIND a raised one -- further off the taller the
    // ground. Exactly inverting that needs a raycast down the height field,
    // because one screen point can correspond to several tiles at different
    // heights.
    //
    // Instead: read the height where the flat projection lands, undo that much
    // lift, and project again. Accurate on flat and gently sloped ground, and
    // it drifts on steep relief. That is a real limitation, not a rounding
    // error -- worth replacing with the raycast if it proves annoying in play,
    // and not worth building before anyone has found it annoying.
    const lift = this.groundOffset(flat.x, flat.y);
    if (lift === 0) return flat;
    const ly = sy + lift;
    return { x: sx / TILE_W + ly / TILE_H, y: ly / TILE_H - sx / TILE_W };
  }
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all pass. There is no test for this — picking accuracy on sloped ground is a judgement made with a mouse, and the comment says as much.

- [ ] **Step 3: Commit**

```bash
git add packages/render/src/renderer.ts
git commit -F - <<'EOF'
fix(render): picking accounts for terrain height, approximately

Terrain lifts a tile on screen, so before this a click landed on the
tile behind a raised one -- further off the taller the ground.

Corrected once rather than exactly: read the height where the flat
projection lands, undo that much lift, project again. Accurate on flat
and gently sloped ground, drifting on steep relief.

The exact answer is a raycast down the height field, because one screen
point can correspond to several tiles at different heights. That is
worth building if this proves annoying with a mouse in hand, and not
before -- the comment in the function says so, so the next reader knows
this is a chosen limitation rather than an oversight.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 6: Documentation, the spec's wording, and the full sweep

**Files:**
- Modify: `CLAUDE.md` (the "A map" bullet under Adding content)
- Modify: `docs/superpowers/specs/2026-08-23-elevation-e1-design.md` (the `heights` → `elevation` wording)

**Interfaces:** consumes everything above; produces nothing.

- [ ] **Step 1: Fix the spec's field name**

The spec's "How height is authored" section shows the JSON field as `"heights"`. The implemented field is `"elevation"`, because `ParsedMap.height` is already the map's row count and `applyTerrain` destructures it. Correct the example and any prose using `heights`, and add one clause recording *why* the name changed — a reader comparing spec to code otherwise sees a discrepancy with no explanation.

- [ ] **Step 2: Update `CLAUDE.md`**

The map bullet currently reads:

```
**A map:** JSON in `data/maps/`, validated against `map.schema.json`. A character grid (`.` open, `1`–`3` cover, `#` building, `^` rock ridge) plus named markers and zones — authorable in a text editor. The loader is `parseMap` in `@lions/data`, and `applyTerrain(map, sim)` is the one way its mechanical layer reaches a `Sim` — use it rather than writing a fourth cover loop. `^` is the only blocked tile that is not a building: impassable, sight-blocking, and with no HP, garrison or ROE penalty.
```

Append to it:

```
An optional `elevation` grid gives each tile a height 0–9, one digit per tile, same dimensions as `rows`; absent means flat. It is orthogonal to the terrain symbol on purpose — a symbol table can express ridges but not valleys. E1 stores and draws it at 10 px per level; nothing reads it for line of sight, sight range or pathing yet.
```

- [ ] **Step 3: Run every gate**

```bash
pnpm test
pnpm test:determinism
pnpm typecheck
pnpm lint
pnpm validate:data
pnpm validate:ui
pnpm build
pnpm balance
pnpm playtest
```

| Gate | Expectation |
|---|---|
| `test` | all pass |
| `test:determinism` | passes at the pin **Task 2** set — unmoved since |
| `balance` | five §5.7 figures **byte-identical** to the branch point |
| `playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |
| the rest | clean |

- [ ] **Step 4: Author a relief map and look at it**

No test can tell you whether 10 px per level reads correctly, and **nobody has seen extruded terrain in this game.**

Write a scratch map with relief — a ridge a few levels high, a valley floor, a slope — load it, and look. Do **not** commit it, and do not edit a shipped map: put it in a temporary file, view it, and delete it. If you edit anything under `data/maps/`, undo the edit rather than using `git checkout`, which in this repository has previously destroyed unrelated uncommitted work.

Report what you saw: whether a ridge reads as impassable mass, whether units sit on the ground convincingly, whether the side faces look like rock or like a coloured skirt, and whether clicking a raised tile selects what you aimed at.

If it reads wrong, **say so rather than committing** — the pixel numbers are one line and no authored data depends on them yet.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-23-elevation-e1-design.md
git commit -F - <<'EOF'
docs: the elevation grid, and the name it actually shipped under

CLAUDE.md gains the optional elevation grid, and the spec's `heights`
wording is corrected to `elevation` -- ParsedMap.height is already the
map's row count and applyTerrain destructures it, so the spec's name
would have shadowed the dimension.

Gates: test / determinism at the pin E1 set in its second commit and
unmoved since / typecheck / lint / validate:data / validate:ui / build /
balance five figures unchanged / playtest still red on exactly the two
missions tracked as #96 and #97.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

## Self-review

**Spec coverage.**

| Spec section | Task |
|---|---|
| Height authored as a parallel grid, optional, orthogonal to symbol | 1 |
| `ParsedMap` gains the array | 1 |
| `TerrainSink.setElevation` + `applyTerrain` carries it | 2 |
| `Sim` gains the field and hashes it | 2 |
| Pin moves exactly once, with reason | 2 |
| Nothing reads it — no LOS, sight or pathing change | Global Constraints; verified in 2 Step 8 |
| Terrain extruded at 10 px per level, side faces | 3 |
| Practical range 0–4, schema 0–9 | 1 Step 5 (schema description) |
| Units lift with the ground via one helper, not 61 edits | 4 |
| Picking approximate, documented as such | 5 |
| Existing missions unchanged — balance + playtest as evidence | 2 Step 8, 6 Step 3 |
| Looked at by eye | 6 Step 4 |

**One correction to the spec, carried as a Global Constraint and fixed in Task 6:** the spec names the JSON field `heights`. It ships as `elevation`, because `ParsedMap.height` is the map's row count and `applyTerrain` destructures it at `map.ts:319` — `heights` in JSON parsing to a `height` array would have shadowed the dimension inside the one function that touches both.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Task 4's site table is explicitly marked partial with a test for judging the rest, which is an instruction rather than a deferral — the alternative, listing all 61, would be a table nobody checks.

**Type consistency.** `elevation` is the name in `MapJson`, `ParsedMap`, `Sim`, `TerrainSink.setElevation`, `Sim.setElevation` and `PixiRenderer.setElevation`. `ELEV_STEP` is defined once in Task 3 and consumed in Task 4. `groundOffset(x, y): number` is defined in Task 4 and consumed in Task 5.

**One risk the plan cannot remove.** Task 6 Step 4 is a human judgement — whether 10 px per level looks right — and the implementer can only report, not decide. If it reads wrong, the number changes and Task 3's commit is amended or followed. That is cheaper than any alternative: no authored map depends on the value yet, and it will not be true for much longer.
