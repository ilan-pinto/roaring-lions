# Tel Marum Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author `data/maps/tel_marum.json` — the first map with real relief — prove its sight lines assert the Sur front's doctrine, teach `validate:data` to see a malformed elevation grid, and make raised terrain able to occlude a unit standing behind it.

**Architecture:** The map is data. Three code changes support it: an extracted grid-check module the gate can call and a test can exercise directly; a depth-band change in the renderer that moves elevated tiles from the unsorted `terrainG` into the sorted `spriteLayer`; and a new test file in `tools/` — the only package that may import both `@lions/data` and `@lions/sim` — holding the doctrine assertions.

**Tech Stack:** TypeScript (strict), vitest, PixiJS v8, Node `.mjs` for the data gate, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-24-tel-marum-map-design.md`

## Global Constraints

- **The determinism pin must NOT move.** It reads `1639983699` in `packages/sim/src/determinism.test.ts`. Nothing in this plan touches `packages/sim`. **A moved pin is a BLOCKED report, never a value to update.**
- **No floating point in `@lions/sim`.** `Math.*` and `Date.*` are banned there and lint-enforced. This plan adds no sim code; the constraint is stated because Task 3's tests import sim types.
- **Elevation is orthogonal to the terrain symbol.** A tile's symbol says what is on it; the `elevation` grid says how high the ground is. Both are authored independently over the same coordinates.
- **Blocked tiles stand `BLOCK_RISE` (2) above their own ground.** A `^` on an elevation-3 tile has sight height 5. Open ground has sight height equal to its elevation.
- **Observers have `EYE_HEIGHT` (1).** A one-level rise sits exactly at eye level and obscures nothing: **terrain needs two levels or more to obscure ground troops.**
- **Never** run `git add -A`, `git add .`, `git stash` in any form, or `git checkout <file>` / `git restore <file>`. The stash stack is shared with other live worktrees where concurrent sessions push and pop it, and this repository has lost an entire uncommitted feature to `git checkout <file>`. Stage files by name.
- **Palette keys only in render code.** `pnpm validate:ui` rejects a hex or `rgba()` literal in UI source with no allowlist.
- Every commit message ends with these two lines exactly:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tools/validate_map_grid.mjs` | **Create.** Pure elevation-grid checks, exported so both the gate and a test can call them. | 1 |
| `tools/validate_data.mjs` | **Modify** (~line 817). Call the new module. | 1 |
| `tools/src/map_grid.test.ts` | **Create.** Proves the checks reject each malformation. | 1 |
| `data/maps/tel_marum.json` | **Create.** The map: terrain grid, elevation grid, markers, zones. | 2 |
| `packages/data/src/index.ts` | **Modify** (~lines 10-13, 91-97). Register the map. | 2 |
| `packages/data/src/map.test.ts` | **Modify.** Parse assertions against the real file. | 2 |
| `tools/src/tel_marum_sight.test.ts` | **Create.** The doctrine, as paired assertions. | 3 |
| `packages/render/src/renderer.ts` | **Modify** (~lines 204-220, 1283-1350). Depth bands. | 4 |
| `packages/render/src/depth.test.ts` | **Create.** The sorting arithmetic. | 4 |

---

## The map's geometry

**Every coordinate below is load-bearing** — Task 3's assertions were derived from these numbers with the real line-of-sight arithmetic, and they are reproduced in Task 3 so the implementer can check them. Read `y = 0` as north; the player enters from the south.

Features are applied **in order**, each overwriting what came before:

| # | Feature | Rect (x0, y0, x1, y1) inclusive | Symbol | Elevation |
|---|---|---|---|---|
| 1 | base | 0, 0, 47, 47 | `.` | 0 |
| 2 | north band | 0, 0, 47, 11 | `.` | 1 |
| 3 | west wall | 0, 0, 5, 47 | `^` | 3 |
| 4 | east wall | 42, 0, 47, 47 | `^` | 3 |
| 5 | ridge line | 6, 12, 41, 17 | `^` | 4 |
| 6 | wide saddle | 22, 12, 26, 17 | `.` | 2 |
| 7 | narrow saddle | 10, 12, 11, 17 | `.` | 3 |
| 8 | west shoulder | 19, 15, 21, 17 | `.` | 3 |
| 9 | east shoulder | 27, 15, 29, 17 | `.` | 3 |
| 10 | spur | 13, 10, 17, 16 | `^` | 4 |
| 11 | centre outcrop | 23, 20, 25, 21 | `^` | 1 |
| 12 | the lip | 18, 25, 30, 26 | `.` | 2 |
| 13 | town buildings | 24, 3, 26, 4 | `#` | 1 |

**Markers:**

```
start_line        [24, 44]
hollow            [24, 29]
approach          [24, 24]
saddle_wide       [24, 14]
saddle_narrow     [10, 14]
pass              [24, 12]
overwatch_east    [28, 16]
overwatch_west    [20, 16]
battery_position  [25, 6]
town_edge         [25, 2]
```

**Zones** (`[x, y, w, h]`):

```
valley_floor    [6, 18, 36, 30]
pass            [22, 12, 5, 6]
overwatch_east  [27, 15, 3, 3]
overwatch_west  [19, 15, 3, 3]
```

Why it is shaped this way, in one line each: the ridge line is impassable except at two gaps; the **wide saddle** is the obvious one and both shoulders overlook the open ground in front of it at 8–10 tiles, which is Kornet's reach; the **narrow saddle** is two tiles wide and the spur hides it from the eastern shoulder; the **centre outcrop** stops the player reading the pass from the start line; the **lip** puts a two-level screen in front of the **hollow**, which is the only dead ground on the map.

---

### Task 1: The gate learns to see an elevation grid

**Files:**
- Create: `tools/validate_map_grid.mjs`
- Modify: `tools/validate_data.mjs` (the map loop, currently around line 817)
- Test: `tools/src/map_grid.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `elevationFailures(m: object, label: string): string[]` — returns a list of human-readable failure strings, empty when the map is fine or has no `elevation` key. Task 2's map must produce zero failures from it.

**Why this exists.** `tools/validate_data.mjs` re-implements its grid checks rather than importing `parseMap`, deliberately, so the gate stays a standalone Node script with no build step. But it only checks `rows`. The elevation dimension checks live *only* inside `packages/data/src/map.ts`'s `parseMap`, which the gate never calls — so **a malformed elevation grid passes `pnpm validate:data` green** and throws later at load. No shipped map has ever had an `elevation` key, so this has never been reachable. Task 2 makes it reachable with a 48-row grid of 48 digits.

Only the *elevation* checks are extracted. The existing `rows` checks stay exactly where they are, untouched — this gate guards 69 files and is not the place for a tidy-up.

- [ ] **Step 1: Write the failing test**

Create `tools/src/map_grid.test.ts`:

```ts
// The data gate's elevation checks.
//
// These live in their own module because validate_data.mjs runs its whole
// sweep at import time and exits the process -- a test cannot import it. The
// rows checks stay inline in the gate; only elevation was extracted, because
// only elevation had no coverage at all.
//
// Tel Marum is the first map with an `elevation` key. A 48-row grid of 48
// digits is exactly the artifact that gets one row wrong, and until this
// module existed a wrong row passed the gate green and threw at load instead.
import { describe, expect, it } from 'vitest';
import { elevationFailures } from '../validate_map_grid.mjs';

const good = {
  width: 4,
  height: 3,
  rows: ['....', '....', '....'],
  elevation: ['0123', '0000', '4321'],
};

describe('the data gate on an elevation grid', () => {
  it('passes a grid whose dimensions match', () => {
    expect(elevationFailures(good, 'good.json')).toEqual([]);
  });

  it('passes a map with no elevation at all — every shipped map today', () => {
    const { elevation, ...flat } = good;
    expect(elevationFailures(flat, 'flat.json')).toEqual([]);
  });

  it('rejects too few rows', () => {
    const bad = { ...good, elevation: ['0123', '0000'] };
    const out = elevationFailures(bad, 'bad.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('2 elevation rows but declared height 3');
  });

  it('rejects a short row, naming which one', () => {
    const bad = { ...good, elevation: ['0123', '000', '4321'] };
    const out = elevationFailures(bad, 'bad.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('elevation row 1 has 3 tiles but declared width 4');
  });

  it('rejects a non-digit, naming where it is', () => {
    const bad = { ...good, elevation: ['0123', '00x0', '4321'] };
    const out = elevationFailures(bad, 'bad.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('(2,1)');
  });

  it('reports every broken row rather than stopping at the first', () => {
    const bad = { ...good, elevation: ['012', '000', '432'] };
    expect(elevationFailures(bad, 'bad.json')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `pnpm vitest run tools/src/map_grid.test.ts`
Expected: FAIL — cannot resolve `../validate_map_grid.mjs`. Every case fails at import. If any case *passes*, stop: the module already exists and this plan is out of date.

- [ ] **Step 3: Write the module**

Create `tools/validate_map_grid.mjs`:

```js
// Elevation-grid checks for the data gate.
//
// The gate deliberately does not import `parseMap` -- it stays a standalone
// Node script with no build step, and re-implements the `rows` checks inline
// for that reason. Elevation had no such re-implementation, so `parseMap` was
// the only thing that ever checked it and the gate never calls `parseMap`.
// Extracted rather than inlined so a test can call it directly: a validation
// check that has never rejected anything is not a validation check.
export function elevationFailures(m, label) {
  const out = [];
  if (!Array.isArray(m.elevation)) return out;
  if (m.elevation.length !== m.height) {
    out.push(`${label}: ${m.elevation.length} elevation rows but declared height ${m.height}`);
  }
  m.elevation.forEach((row, y) => {
    if (typeof row !== 'string') {
      out.push(`${label}: elevation row ${y} is not a string`);
      return;
    }
    if (row.length !== m.width) {
      out.push(`${label}: elevation row ${y} has ${row.length} tiles but declared width ${m.width}`);
      return;
    }
    for (let x = 0; x < row.length; x++) {
      if (row[x] < '0' || row[x] > '9') {
        out.push(`${label}: elevation "${row[x]}" at (${x},${y}) is not a digit 0-9`);
        return;
      }
    }
  });
  return out;
}
```

Note the two `return`s inside `forEach`: a row that is the wrong length reports once rather than also reporting every out-of-range character, and a row with a bad character reports its first only. The last test case (three short rows → three failures) is what pins that behaviour.

- [ ] **Step 4: Run the test again**

Run: `pnpm vitest run tools/src/map_grid.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into the gate**

In `tools/validate_data.mjs`, add to the imports at the top of the file:

```js
import { elevationFailures } from './validate_map_grid.mjs';
```

Then inside the `for (const file of jsonFilesIn(join(ROOT, 'data/maps')))` loop, immediately after the existing block that ends with the `row ${y} has ${row.length} tiles` check, add:

```js
  failures.push(...elevationFailures(m, rel(file)));
```

- [ ] **Step 6: Prove the wiring by breaking a map on purpose**

The check must be shown to fire through the gate, not only in a unit test. There is no map with an `elevation` key yet, so add one temporarily to an existing map, run the gate, and then **undo the edit by hand** — never with `git checkout`.

Run: `pnpm validate:data`
Expected before the temporary edit: `data gate passed: 69 file(s) validated`.

Now add `"elevation": ["000"]` to `data/maps/tutorial_ground.json` (a three-character row against a declared width of 48 and height of 48).

Run: `pnpm validate:data`
Expected: **exit 1**, with two failures naming `tutorial_ground.json` — one for the row count, one for the row length.

Remove the `"elevation"` key you added, by editing the file. Run `pnpm validate:data` once more and confirm it is back to `69 file(s) validated`, then `git status --porcelain` and confirm `data/maps/tutorial_ground.json` is **not** listed.

- [ ] **Step 7: Commit**

```bash
git add tools/validate_map_grid.mjs tools/validate_data.mjs tools/src/map_grid.test.ts
git commit
```

Message: `fix(tools): the data gate could not see a malformed elevation grid` — say in the body that the checks existed only in `parseMap`, that the gate never calls it, and that Tel Marum is the first content able to reach the hole.

---

### Task 2: Tel Marum's ground

**Files:**
- Create: `data/maps/tel_marum.json`
- Modify: `packages/data/src/index.ts`
- Test: `packages/data/src/map.test.ts`

**Interfaces:**
- Consumes: `elevationFailures` from Task 1, indirectly — `pnpm validate:data` must pass on the new map.
- Produces: map id `tel_marum`, the markers and zones listed in **The map's geometry** above. Task 3 reads those marker names; Task 5's sandbox mission references `tel_marum.json`.

**Do not hand-author the grid.** Ninety-six lines of 48 characters, hand-aligned, is the single most likely place for this task to go wrong, and the failure is invisible on inspection. Compose it with a script.

- [ ] **Step 1: Write the composer**

Create a scratch script (NOT in the repo — put it in the session scratchpad directory) that builds the grid from the feature table:

```js
// compose.mjs — writes data/maps/tel_marum.json from the feature table.
import { writeFileSync } from 'node:fs';

const W = 48, H = 48;
const sym = Array.from({ length: H }, () => Array(W).fill('.'));
const elv = Array.from({ length: H }, () => Array(W).fill(0));

/** Paint a rect, inclusive of both corners. */
const rect = (x0, y0, x1, y1, s, e) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { sym[y][x] = s; elv[y][x] = e; }
};

rect(0, 0, 47, 47, '.', 0);   // base
rect(0, 0, 47, 11, '.', 1);   // north band
rect(0, 0, 5, 47, '^', 3);    // west wall
rect(42, 0, 47, 47, '^', 3);  // east wall
rect(6, 12, 41, 17, '^', 4);  // ridge line
rect(22, 12, 26, 17, '.', 2); // wide saddle
rect(10, 12, 11, 17, '.', 3); // narrow saddle
rect(19, 15, 21, 17, '.', 3); // west shoulder
rect(27, 15, 29, 17, '.', 3); // east shoulder
rect(13, 10, 17, 16, '^', 4); // spur
rect(23, 20, 25, 21, '^', 1); // centre outcrop
rect(18, 25, 30, 26, '.', 2); // the lip
rect(24, 3, 26, 4, '#', 1);   // town buildings

const map = {
  id: 'tel_marum',
  name: 'Tel Marum — The Gateway',
  width: W,
  height: H,
  markers: {
    start_line: [24, 44], hollow: [24, 29], approach: [24, 24],
    saddle_wide: [24, 14], saddle_narrow: [10, 14], pass: [24, 12],
    overwatch_east: [28, 16], overwatch_west: [20, 16],
    battery_position: [25, 6], town_edge: [25, 2],
  },
  zones: {
    valley_floor: [6, 18, 36, 30], pass: [22, 12, 5, 6],
    overwatch_east: [27, 15, 3, 3], overwatch_west: [19, 15, 3, 3],
  },
  rows: sym.map((r) => r.join('')),
  elevation: elv.map((r) => r.join('')),
};

writeFileSync(process.argv[2], JSON.stringify(map, null, 1) + '\n');
```

- [ ] **Step 2: Run it**

Run: `node <scratchpad>/compose.mjs data/maps/tel_marum.json`

Then sanity-check by eye — print rows 12-17 and confirm you can see two gaps in the ridge:

```bash
node -e "const m=require('./data/maps/tel_marum.json');m.rows.slice(12,18).forEach(r=>console.log(r))"
```

Expected: six lines, each with `^` from column 6 to 41 **except** columns 10-11, 22-26, and (on the last three lines) 19-21 and 27-29.

- [ ] **Step 3: Register the map**

In `packages/data/src/index.ts`, add the import beside the other four maps (keep them alphabetical by variable — this one sorts after `marjPerimeter`):

```ts
import telMarum from '../../../data/maps/tel_marum.json';
```

and add to the `maps` record:

```ts
  tel_marum: telMarum,
```

**`MapId` is a union derived from this record**, so adding a member changes a type that call sites narrow on. `pnpm typecheck` is the only gate that catches a break here — `pnpm test` will not.

- [ ] **Step 4: Write the parse test**

Append to `packages/data/src/map.test.ts`:

```ts
describe('tel_marum, the first shipped map with relief', () => {
  const map = parseMap(maps.tel_marum as MapJson);

  it('parses at its declared size with an elevation grid', () => {
    expect(map.width).toBe(48);
    expect(map.height).toBe(48);
    expect(map.elevation).toHaveLength(48 * 48);
  });

  it('puts the valley floor at 0 and the ridge line above it', () => {
    const at = (x: number, y: number): number => map.elevation[y * 48 + x];
    expect(at(24, 44)).toBe(0); // start line
    expect(at(24, 29)).toBe(0); // the hollow
    expect(at(24, 26)).toBe(2); // the lip — two levels, deliberately
    expect(at(24, 14)).toBe(2); // wide saddle
    expect(at(10, 14)).toBe(3); // narrow saddle
    expect(at(28, 16)).toBe(3); // east shoulder
    expect(at(8, 14)).toBe(4);  // ridge line
  });

  it('leaves both saddles passable and the ridge between them not', () => {
    const blocked = (x: number, y: number): number => map.blocked[y * 48 + x];
    expect(blocked(24, 14)).toBe(0); // wide saddle
    expect(blocked(10, 14)).toBe(0); // narrow saddle
    expect(blocked(16, 14)).toBe(1); // ridge between them
    expect(blocked(35, 14)).toBe(1); // ridge east of the wide saddle
  });

  it('places every marker on ground a unit can stand on', () => {
    // A marker on a blocked tile cannot spawn a unit and cannot be walked to.
    // The battery position in particular sits NEXT TO the town buildings, not
    // on them.
    for (const [name, [x, y]] of Object.entries(maps.tel_marum.markers)) {
      expect(`${name}:${map.blocked[y * 48 + x]}`).toBe(`${name}:0`);
    }
  });
});
```

If `map.test.ts` does not already import `maps` and `MapJson`, add them to its existing import from `./index` and `./map` respectively — match whatever that file already does.

- [ ] **Step 5: Run the tests and the gate**

Run: `pnpm vitest run packages/data/src/map.test.ts`
Expected: PASS.

Run: `pnpm validate:data`
Expected: `data gate passed: 70 file(s) validated` — one more than before.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add data/maps/tel_marum.json packages/data/src/index.ts packages/data/src/map.test.ts
git commit
```

Message: `feat(data): Tel Marum, a valley with two ways out of it`. Say in the body which features carry the doctrine and that the sight lines are asserted in the next commit.

---

### Task 3: The sight lines the map claims

**Files:**
- Create: `tools/src/tel_marum_sight.test.ts`

**Interfaces:**
- Consumes: map id `tel_marum` and its markers from Task 2.
- Produces: nothing further tasks consume.

**Why here.** `packages/sim` imports nothing and `packages/data` is a leaf, so `tools/` is the only place that may hold both ends. `tools/src/rock_terrain.test.ts` and `tools/src/protected_sites.test.ts` exist for exactly this reason and are the pattern to copy.

**Every blocking assertion is paired with one that must see.** "Cannot see" on its own also passes for a broken spawn, a sight range that is too short, or too few ticks — this project has shipped three tests that passed with the code under test fully disabled. `sight_tiles` is set to 48 so that range is never the reason for a negative result; the only variable is terrain.

- [ ] **Step 1: Write the failing test**

Create `tools/src/tel_marum_sight.test.ts`:

```ts
// Tel Marum's doctrine, as assertions.
//
// The Sur front design says the map is "half the doctrine": Sarim cannot
// out-range anyone (Kornet 10 tiles against KDF mortars at 18 and snipers at
// 15), so what they have is ambush from ground you cannot see into. That makes
// these sight lines the actual deliverable of the map -- not the picture.
//
// Every negative is paired with a positive on the same geometry. A test that
// only asserts "cannot see" passes when the spawn is broken, when sight range
// is too short, or when detection never ran.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

/** Sight range far past anything on this map, so only terrain can hide. */
const OBSERVER: UnitTypeJson = {
  id: 't_observer',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
};

type Pt = readonly [number, number];

/** Two observers on opposing sides at the given tiles; does the first see the second? */
function sees(a: Pt, b: Pt, override?: (m: MapJson) => MapJson): boolean {
  const json = override ? override(structuredClone(maps.tel_marum) as MapJson) : (maps.tel_marum as MapJson);
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const t = sim.addUnitType(OBSERVER);
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return sim.debugDetection(watcher, target)?.visible === true;
}

const START = [24, 44] as const;
const HOLLOW = [24, 29] as const;
const APPROACH = [24, 24] as const;
const SADDLE_WIDE = [24, 14] as const;
const SADDLE_NARROW = [10, 14] as const;
const PASS = [24, 12] as const;
const OVERWATCH_E = [28, 16] as const;
const OVERWATCH_W = [20, 16] as const;
const BATTERY = [25, 6] as const;
const DEEP_VALLEY = [24, 35] as const;

describe('the centre outcrop hides the pass from the start line', () => {
  it('does not show the pass from where the player enters', () => {
    // (24,44) -> (24,12): 32 steps, sight line rises 1 -> 3. The outcrop at
    // y=22 is a `^` on elevation 1, so it stands at 1 + BLOCK_RISE = 3:
    // 3 * 32 = 96 > 32 + 2 * 22 = 76. Blocked.
    expect(sees(START, PASS)).toBe(false);
  });

  it('shows it from the valley floor north of the outcrop — the control', () => {
    // Same target, 8 steps, nothing but open ground between. If THIS fails the
    // test above proves nothing: the target may simply be unreachable.
    expect(sees([24, 20], PASS)).toBe(true);
  });
});

describe('the lip makes the hollow dead ground', () => {
  it('hides the hollow from the eastern shoulder', () => {
    // (28,16) -> (24,29): 13 steps, sight line falls 4 -> 1. The lip at y=26
    // is open ground at elevation 2: 2 * 13 = 26 > 4 * 13 - 3 * 10 = 22.
    expect(sees(OVERWATCH_E, HOLLOW)).toBe(false);
  });

  it('hides it from the western shoulder too', () => {
    expect(sees(OVERWATCH_W, HOLLOW)).toBe(false);
  });

  it('does NOT hide the approach in front of it — the killing ground', () => {
    // (28,16) -> (24,24) is 8 tiles, inside Kornet's reach of 10, and the lip
    // is not between them. This is the whole point of the hollow: the ground
    // you must cross to leave it is covered.
    expect(sees(OVERWATCH_E, APPROACH)).toBe(true);
  });

  it('does not hide the valley further south either — the shadow is a band', () => {
    // (28,16) -> (24,35) is 19 steps: 2 * 19 = 38 is NOT > 4 * 19 - 3 * 10 = 46.
    // A rise shadows a finite band behind it, not everything beyond it. Stated
    // as a test because it is surprising, and because a map author who assumes
    // otherwise will put a force somewhere it can be seen.
    expect(sees(OVERWATCH_E, DEEP_VALLEY)).toBe(true);
  });
});

describe('the lip has to be two levels', () => {
  // E3 gave observers EYE_HEIGHT = 1, so a one-level rise sits exactly at eye
  // level and hides nothing. A lip authored one level shallow looks identical
  // in the JSON and does nothing at all -- this is the single easiest way to
  // author this map wrong, so it gets a test rather than a comment.
  const lowerTheLip = (m: MapJson): MapJson => {
    const rows = [...(m.elevation ?? [])];
    for (const y of [25, 26]) {
      const r = rows[y].split('');
      for (let x = 18; x <= 30; x++) r[x] = '1';
      rows[y] = r.join('');
    }
    return { ...m, elevation: rows };
  };

  it('hides the hollow at two levels', () => {
    expect(sees(OVERWATCH_E, HOLLOW)).toBe(false);
  });

  it('and hides nothing at one — the same map, one digit shallower', () => {
    expect(sees(OVERWATCH_E, HOLLOW, lowerTheLip)).toBe(true);
  });
});

describe('the spur separates the two saddles', () => {
  it('keeps the narrow saddle out of the eastern shoulder’s arc', () => {
    // (28,16) -> (10,14): 18 steps. The spur is `^` on elevation 4, standing
    // at 6: 6 * 18 = 108 > 4 * 18 = 72. Blocked.
    expect(sees(OVERWATCH_E, SADDLE_NARROW)).toBe(false);
  });

  it('while the wide saddle is covered from it — the control', () => {
    expect(sees(OVERWATCH_E, SADDLE_WIDE)).toBe(true);
  });
});

describe('the battery is behind the pass, which is the point of taking it', () => {
  it('is not visible from the hollow', () => {
    // The wide saddle itself, at elevation 2, screens a ground-level observer
    // 23 tiles back: 2 * 23 = 46 > 23 + 12 = 35.
    expect(sees(HOLLOW, BATTERY)).toBe(false);
  });

  it('is visible from the crest of the wide saddle', () => {
    expect(sees(PASS, BATTERY)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tools/src/tel_marum_sight.test.ts`
Expected: **all 12 cases pass on the first run.** This is not TDD — the map from Task 2 was authored against this arithmetic, and the test is checking that the authoring is faithful.

**If a case fails, the map is wrong, not the test.** The assertions encode the design; the grid is the thing that is allowed to move. Adjust `data/maps/tel_marum.json` (re-run the composer with an edited feature table — do not hand-edit the grid), and record in your report exactly which feature you changed and why. Report any map change before making it, rather than treating any fix as pre-authorised: an earlier draft of this plan pre-authorised two specific changes ("the lip may go to elevation 3 if either shoulder can see the hollow" and "the centre outcrop may grow by a row to `23, 20, 25, 22` if the pass is visible from the start line") on the theory that their arithmetic sat close enough to its threshold to trust blind. Round 2 review proved both unsound: the lip-to-3 change flips the start-line control and one more case, and the outcrop-grows change (which only ever extended it northward, never narrowed it) blinds both shoulders to the killing ground. Neither survives; there is no standing pre-authorisation left.

- [ ] **Step 3: Run the whole suite**

Run: `pnpm test`
Expected: all files pass. Note the new total in your report.

- [ ] **Step 4: Commit**

```bash
git add tools/src/tel_marum_sight.test.ts
git commit
```

If Step 2 required a map change, add `data/maps/tel_marum.json` to the same commit and say what moved.

Message: `test(tools): Tel Marum's doctrine, as twelve assertions`.

---

### Task 4: Terrain that can hide a unit

**Files:**
- Modify: `packages/render/src/renderer.ts`
- Test: `packages/render/src/depth.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (works against any map with elevation).
- Produces: `bandZ(x: number, y: number): number`, exported from `renderer.ts` — the zIndex an elevated tile's graphics take.

**The gap is a layer, not an algorithm.** Units are *already* depth-sorted against buildings: unit bodies go into `spriteLayer` (`sortableChildren = true`) keyed by tile depth, and only HP bars, suppression bars and selection rings live in the always-on-top `unitsG`. The renderer says so at line ~534:

> Depth sorting: a unit behind a building must be drawn before it, so the building covers it.

Terrain never joined that layer. Everything in `drawTerrain` paints into `terrainG`, which is added to the world **before** `spriteLayer` and therefore sits underneath everything unconditionally. A four-level ridge is painted first and can never cover anything.

**The arithmetic.** `depthZ(x, y)` is `Math.round((x + y) * 64)`. A unit at tile `(x, y)` is drawn at `depthZ(x + 0.5, y + 0.5)` = `(x + y + 1) * 64`. So for an elevated tile at `(x, y)`:

| who | zIndex | wanted |
|---|---|---|
| unit standing **on** the tile | `(x + y + 1) * 64` | above the tile |
| unit standing directly **behind** it, at `(x, y - 1)` | `(x + y) * 64` | **below** the tile |
| the tile's own band | ? | between those two |

`depthZ(x, y)` alone ties with the unit behind, and Pixi breaks ties by insertion order — which puts the unit on top, exactly the case that needs occluding. **So the band takes `depthZ(x, y) + 1`**, the same `+1` trick buildings already use.

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/depth.test.ts`:

```ts
// The depth arithmetic that lets a ridge hide a unit behind it.
//
// Rendering does not generally get tests in this repo. This is arithmetic, not
// rendering: three numbers whose ORDER is the whole feature, and an off-by-one
// puts a unit in front of the hill it is standing behind.
import { describe, expect, it } from 'vitest';
import { bandZ, unitZ } from './renderer';

describe('elevated terrain against the units around it', () => {
  const x = 10, y = 20;

  it('draws over a unit standing directly behind it', () => {
    // The case that ties if the band uses depthZ(x, y) unadjusted, and ties
    // resolve by insertion order -- which puts the unit on top, which is the
    // bug.
    expect(bandZ(x, y)).toBeGreaterThan(unitZ(x, y - 1));
  });

  it('draws under a unit standing on top of it', () => {
    expect(bandZ(x, y)).toBeLessThan(unitZ(x, y));
  });

  it('draws under a unit one tile in front of it', () => {
    expect(bandZ(x, y)).toBeLessThan(unitZ(x, y + 1));
  });

  it('gives every tile on a diagonal the same band', () => {
    // The bucketing is what keeps this to ~95 objects instead of ~2300.
    expect(bandZ(12, 18)).toBe(bandZ(10, 20));
    expect(bandZ(11, 20)).toBeGreaterThan(bandZ(10, 20));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/render/src/depth.test.ts`
Expected: FAIL — `bandZ` and `unitZ` are not exported.

- [ ] **Step 3: Export the two depth helpers**

In `packages/render/src/renderer.ts`, beside the existing `depthZ` (around line 183), add:

```ts
/** The zIndex an elevated tile's band takes: one above the unit behind it, so
 *  a ridge covers what is standing on its far side. Buildings use the same +1
 *  for the same reason. */
export function bandZ(x: number, y: number): number {
  return depthZ(x, y) + 1;
}

/** The zIndex a unit standing on tile (x, y) takes. Mirrors the call in
 *  drawUnits; exported so the ordering can be asserted without a canvas. */
export function unitZ(x: number, y: number): number {
  return depthZ(x + 0.5, y + 0.5);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/render/src/depth.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Move elevated tiles into the sorted layer**

Three edits in `renderer.ts`.

**(a)** Beside the other layer fields (around line 204-221), add:

```ts
  /** One Graphics per view diagonal, holding every raised tile on it. Flat
   *  ground stays in terrainG: it cannot occlude anything, so sorting it would
   *  cost objects and buy nothing. */
  private elevBands = new Map<number, Graphics>();
```

**(b)** In `drawTerrain`, beside the existing teardown of `buildingTiles` / `buildingSprites` / `decorSprites` (around line 1288), add:

```ts
    for (const band of this.elevBands.values()) this.spriteLayer.removeChild(band);
    this.elevBands.clear();
```

**(c)** Inside the tile loop, the local `g` currently refers to the `terrainG` constant captured at the top of `drawTerrain`. Rename that outer constant to `flat`:

```ts
  private drawTerrain(): void {
    const flat = this.terrainG;
    flat.clear();
```

and then at the top of the per-tile body — immediately after `const lift = ...` and **before** the `if (this.elevation)` block that draws the side faces — introduce the per-tile target:

```ts
        // A raised tile draws into its diagonal's band inside the sorted layer,
        // so units behind it are covered. Flat ground stays batched in
        // terrainG, which keeps the draw cost on the four flat shipped maps
        // exactly where it was.
        const g = lift > 0 ? this.bandFor(x, y) : flat;
```

Everything else in the loop body already writes to `g` and needs no edit. Add the helper next to `groundOffset`:

```ts
  private bandFor(x: number, y: number): Graphics {
    const key = x + y;
    let band = this.elevBands.get(key);
    if (!band) {
      band = new Graphics();
      band.zIndex = bandZ(x, y);
      this.spriteLayer.addChild(band);
      this.elevBands.set(key, band);
    }
    return band;
  }
```

**Check before you finish:** search the tile loop for any remaining bare `terrainG` reference. If the loop body writes to `this.terrainG` directly anywhere instead of `g`, that write bypasses the band and must be changed to `g`.

- [ ] **Step 6: Verify nothing changed on flat maps**

Run: `pnpm test`
Expected: all pass, including the existing renderer tests.

Run: `pnpm lint` and `pnpm typecheck`
Expected: clean.

Run: `pnpm validate:ui`
Expected: `18 file(s) clean`. The new code adds no colour literal — it reuses the existing `t.rock` tones.

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/renderer.ts packages/render/src/depth.test.ts
git commit
```

Message: `feat(render): a ridge can hide what is standing behind it`. Say in the body that units already sorted against buildings and elevated terrain simply never joined that layer, and that flat ground deliberately stays batched.

---

### Task 5: Walk it, then sweep the gates

**Files:**
- Create, then **delete before the branch merges**: `data/missions/_tel_marum_sandbox.json`
- No committed source changes.

**Interfaces:**
- Consumes: everything above.
- Produces: the report that says whether the ground reads right.

**Why a throwaway.** A map with no mission cannot be reached in the app. A half-authored real mission would later have to be reconciled with Tel Marum's actual recon mission, so the sandbox is explicitly disposable — and this project has a standing rule that console shortcuts do not count as verification, because they skip the code that breaks.

- [ ] **Step 1: Write the sandbox mission**

Create `data/missions/_tel_marum_sandbox.json`. Copy the smallest shipped mission (`data/missions/beit_sahwan_breach.json` is a good donor) and change: its `id` to `_tel_marum_sandbox`, its `map.file` to `tel_marum.json`, its `town` to `tel_marum`, and its `starting_force` to a handful of `inf_squad` placements at the `start_line` marker. Give it one `survive_until` objective so it validates.

Run: `pnpm validate:data`
Expected: `71 file(s) validated` — Tel Marum plus the sandbox. If it fails, the message names what the schema wants; fix the sandbox, not the map.

- [ ] **Step 2: Walk the ground**

Run: `pnpm dev`, open the app, and start the sandbox mission.

Look at four things and write down what you saw for each:

1. **Move a squad into the hollow** (24, 29). Does the lip in front of it read as ground you are behind, or as a flat stripe?
2. **Move a squad along the ridge line.** Do units behind the ridge disappear behind it? This is Task 4's whole deliverable, and it is the one thing no test proves.
3. **Cross both saddles.** Does the wide one read as a way through, and the narrow one as a squeeze?
4. **Select a unit standing mid-slope** on a shoulder. Does the selection ring land on the unit, or offset from it? Picking mid-slope is a known-untested E1 gap and is *out of scope to fix* — but note what you see, because the missions slice needs to know.

- [ ] **Step 3: Delete the sandbox**

Delete `data/missions/_tel_marum_sandbox.json` by removing the file. Do not use `git checkout` or `git restore` for anything in this step.

Run: `pnpm validate:data`
Expected: back to `70 file(s) validated`.

Run: `git status --porcelain`
Expected: **empty**. If the sandbox still appears, it was staged — unstage it by name and delete it.

- [ ] **Step 4: The full sweep**

Run each, and record the real numbers:

| Gate | Expectation |
|---|---|
| `pnpm test` | passes; note the total |
| `pnpm test:determinism` | **`1639983699`, UNMOVED** — nothing here touched the sim |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm validate:data` | **70 files** |
| `pnpm validate:ui` | 18 files clean |
| `pnpm build` | succeeds |
| `pnpm balance` | five §5.7 figures unchanged — no unit data changed |
| `pnpm playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |

**A moved pin is a BLOCKED report.** So is a change in any balance figure.

- [ ] **Step 5: Report**

No commit unless Step 2 revealed something that needs fixing. Report what you saw at each of the four viewing checks, in words — "the ridge occludes correctly" is worth less than "a squad at (24,20) was hidden by the ridge until it stepped onto the saddle".

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: the ground → Task 2; the two-level lip and its trap → Tasks 2 and 3; the doctrine assertions table → Task 3 (all four rows, plus the killing-ground pair and the shadow-is-a-band case the arithmetic turned up); depth-band occlusion → Task 4; the `validate:data` hole and its proof-by-failing → Task 1; the throwaway sandbox and the browser walk → Task 5; the gate sweep → Task 5. The spec's Out list adds no tasks by construction.

**One thing the spec asserted that the plan had to change.** The spec put the ATGM overwatch "at roughly ten tiles" from the wide saddle. Worked through, shoulders adjacent to the saddle put the engagement at four tiles — point-blank, not standoff, and close enough to risk the firepower-kill deadlock filed as issue #105. The geometry instead has the shoulders covering the **open approach** at 8–10 tiles, which is Kornet's reach and is where the crossing actually hurts. Task 3 asserts that pair directly.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Every code step carries its code; the map grid is generated by a script that is written out in full rather than described.

**Type consistency.** `elevationFailures(m, label)` is defined in Task 1 and called with `rel(file)` in the same task. `bandZ`/`unitZ` are defined in Task 4 Step 3 and used in Task 4 Steps 1 and 5 under those exact names. `maps.tel_marum` is registered in Task 2 Step 3 and read in Task 2 Step 4 and Task 3. Marker names in the geometry table match the constants in Task 3 and the parse test in Task 2.
