# Rock Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a sight-blocking, impassable rock ridge authorable in map JSON with the symbol `^`, and route map terrain into the sim through one shared function instead of three hand-copied loops.

**Architecture:** One entry in `TERRAIN_LEGEND` gives `^` the triple `{ blocked: 1, cover: 0, decor: DECOR.ridge }`. A new `applyTerrain(map, sink)` in `@lions/data` — structurally typed so `data` imports nothing and stays a leaf — replaces the duplicated cover loops in `main.ts`, `walk_world.ts` and `playtest.ts` and is the first thing to consume `map.blocked`. The renderer gains a `ridge` decor branch beside the existing `knoll` one. No `@lions/sim` code changes: `losRay` already returns `-1` on a structureless blocked tile, which is the entire mechanic.

**Tech Stack:** TypeScript strict, pnpm workspaces, vitest, PixiJS. Node script `tools/validate_data.mjs` for the data gate.

**Spec:** `docs/superpowers/specs/2026-08-22-rock-terrain-design.md` (committed `d4c9867`)

## Global Constraints

- **No `@lions/sim` source changes.** This slice touches `packages/data`, `packages/render`, `packages/app`, `tools`, `data/schemas` and docs only. A diff touching `packages/sim/src/*.ts` (tests excluded) means something has gone wrong — stop and raise it.
- **`pnpm test:determinism` pin must not move.** No sim code and no `data/maps` file changes, so the golden hash is unchanged. Movement is a bug in the work, never a deliberate retune.
- **No `data/maps/*.json` file is created or edited.** Tel Marum (slice 3) is the first real consumer. Test maps are inline object literals in test files.
- **`pnpm balance` figures unchanged** — the five §5.7 targets.
- **TypeScript strict. No `any`.** No non-null assertions.
- **Palette keys only in render code** — never a raw hex or `rgba()` literal. `pnpm validate:ui` rejects them with no allowlist.
- **Never `git add -A` or `git add .`.** Other sessions share this repository's stash stack and other worktrees are live. Stage the exact paths each task names.
- **Commit message trailers** — every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/data/src/map.ts` | `DECOR.ridge`, the `^` legend entry, `TerrainSink`, `applyTerrain` | 1, 2 |
| `packages/data/src/index.ts` | re-export `applyTerrain` and `TerrainSink` | 2 |
| `packages/data/src/map.test.ts` | `^` parses correctly; `applyTerrain` against a fake sink | 1, 2 |
| `tools/validate_data.mjs` | `^` in `TERRAIN_SYMBOLS` | 1 |
| `tools/src/terrain_symbols.test.ts` | **new** — cross-check the two symbol lists | 1 |
| `data/schemas/map.schema.json` | document `^` in two descriptions | 1 |
| `packages/app/src/main.ts` | call `applyTerrain`; extend the decor divergence guard | 2, 4 |
| `tools/src/walk_world.ts` | call `applyTerrain` | 2 |
| `tools/src/backtest/playtest.ts` | call `applyTerrain` | 2 |
| `tools/src/rock_terrain.test.ts` | **new** — end-to-end: map JSON → sim → detection blocked | 3 |
| `packages/render/src/renderer.ts` | `TERRAIN_DECOR.ridge` and its draw branch | 4 |
| `CLAUDE.md` | name `^` in the map section | 5 |

---

### Task 1: The `^` symbol, and a real cross-check for the two symbol lists

The terrain legend lives in TypeScript (`packages/data/src/map.ts`) and is duplicated in a Node script that cannot load TypeScript (`tools/validate_data.mjs`). Today's guard is a **tripwire**: `map.test.ts:71` compares `TERRAIN_LEGEND`'s keys to a hardcoded array with a comment telling you to update the validator. Nothing verifies you did. This task adds the symbol and upgrades the guard to a real cross-check in the same breath, because the cross-check is what proves the symbol landed in both places.

**Files:**
- Modify: `packages/data/src/map.ts` (header comment ~lines 1-8, `DECOR` at :99, `TERRAIN_LEGEND` at ~:150)
- Modify: `packages/data/src/map.test.ts` (the seven-symbols test at :68-72, and the decor describe at :74)
- Modify: `tools/validate_data.mjs:775`
- Modify: `data/schemas/map.schema.json` (top-level `description`, and `rows.items.description`)
- Create: `tools/src/terrain_symbols.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `DECOR.ridge = 4` and `TERRAIN_LEGEND['^'] = { blocked: 1, cover: 0, decor: DECOR.ridge }`, both used by Tasks 2, 3 and 4.

- [ ] **Step 1: Write the failing tests in `packages/data/src/map.test.ts`**

Replace the existing seven-symbols test (currently at lines 68-72) with this:

```ts
  it('still decodes exactly eight terrain symbols', () => {
    // If this count moves, a symbol was added and validate_data.mjs's
    // TERRAIN_SYMBOLS must move with it. That used to be the whole guard --
    // a comment asking the next author to remember. tools/src/terrain_symbols.test.ts
    // now checks the validator's actual source, so forgetting fails a test.
    expect(Object.keys(TERRAIN_LEGEND).sort()).toEqual(['.', '1', '2', '3', '^', 'n', 'o', 'r']);
  });
```

Then add this new `describe` block at the end of the file:

```ts
// Rock is the first blocked tile in the game that is not a building, which is
// the entire point: a ridge built from concrete would be destructible,
// garrisonable and ROE-scored, and a mountain is none of those. losRay already
// returns -1 for a structureless blocked tile, so the mechanic needs no sim
// code -- only a way to author it.
describe('rock ridge', () => {
  const RIDGE: MapJson = {
    id: 'ridge',
    name: 'Ridge',
    width: 4,
    height: 3,
    rows: ['.^^.', '..^.', '....'],
  };

  it('is impassable, carries no cover, and draws as ridge decor', () => {
    const m = parseMap(RIDGE);
    expect(Array.from(m.blocked.slice(0, 4))).toEqual([0, 1, 1, 0]);
    expect(Array.from(m.cover.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(m.decor.slice(0, 4))).toEqual([
      DECOR.none,
      DECOR.ridge,
      DECOR.ridge,
      DECOR.none,
    ]);
  });

  it('produces no structure, so it has no HP, no garrison and no ROE penalty', () => {
    // The whole reason rock is terrain rather than a building.
    expect(parseMap(RIDGE).structures).toEqual([]);
  });

  it('is not claimed by any building symbol', () => {
    expect(STRUCTURE_SYMBOLS['^']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing cross-check in `tools/src/terrain_symbols.test.ts`**

Create the file:

```ts
// The terrain legend against the data gate's copy of it.
//
// TERRAIN_LEGEND lives in packages/data/src/map.ts. tools/validate_data.mjs is a
// Node script that cannot load TypeScript, so it hardcodes the same set. Two
// lists, one truth.
//
// The old guard was a hardcoded array in map.test.ts plus a comment asking the
// next author to update the validator -- a tripwire, not a check. An author who
// updated the test and forgot the .mjs got green tests and a map the data gate
// rejects. This reads the validator's actual source instead, so the drift is
// impossible rather than merely rude.
//
// Reading source and regexing a literal is ugly. It is worth it: the last time
// two copies of one idea drifted in this repo, tunnel registration went missing
// from playtest.ts and the harness was dead for two days with every test green.
//
// tools/ is the only place that may look at both, which is why this lives here
// alongside protected_sites.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TERRAIN_LEGEND } from '@lions/data';

const ROOT = join(import.meta.dirname, '..', '..');

/** The TERRAIN_SYMBOLS set literal, read out of the validator's source. */
function validatorSymbols(): string[] {
  const src = readFileSync(join(ROOT, 'tools/validate_data.mjs'), 'utf8');
  const decl = /const TERRAIN_SYMBOLS = new Set\(\[([^\]]*)\]\)/.exec(src);
  if (decl === null) {
    throw new Error(
      'could not find `const TERRAIN_SYMBOLS = new Set([...])` in tools/validate_data.mjs — ' +
        'if it was renamed or reformatted, update this regex, do not delete this test'
    );
  }
  return [...decl[1].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]);
}

describe('the terrain legend and the data gate agree', () => {
  it('finds the validator declaration at all', () => {
    // Guards the regex itself: a silently-empty match would make every other
    // assertion here vacuously interesting rather than false.
    expect(validatorSymbols().length).toBeGreaterThan(0);
  });

  it('declares exactly the same symbols in both places', () => {
    expect(validatorSymbols().sort()).toEqual(Object.keys(TERRAIN_LEGEND).sort());
  });
});
```

- [ ] **Step 3: Run both test files and watch them fail**

```bash
pnpm vitest run packages/data/src/map.test.ts tools/src/terrain_symbols.test.ts
```

Expected: FAIL. `map.test.ts` fails on `unknown symbol "^" at (1,0)` and on the eight-symbol expectation; `terrain_symbols.test.ts` fails on the set comparison (validator has 7, legend has 7 but no `^` — they agree by accident right now, so this specific test may PASS at this moment).

**This is the important moment.** `terrain_symbols.test.ts` passing here is correct and expected — the lists genuinely do agree before the change. Its job is to fail in Step 5, after the legend gains `^` and before the validator does. Do not skip Step 5's run.

- [ ] **Step 4: Add the symbol to `packages/data/src/map.ts`**

Extend `DECOR` (line 99):

```ts
export const DECOR = { none: 0, road: 1, grove: 2, knoll: 3, ridge: 4 } as const;
```

Add to `TERRAIN_LEGEND` (after the `n` entry):

```ts
  '^': { blocked: 1, cover: 0, decor: DECOR.ridge },
```

Update the header comment at the top of the file — the second legend line currently reads:

```
//   r  dirt road            o  olive grove (cover 1)   n  rocky knoll (cover 2)
```

Replace it with:

```
//   r  dirt road            o  olive grove (cover 1)   n  rocky knoll (cover 2)
//   ^  rock ridge: impassable and blocks sight, the only non-building blocked tile
```

- [ ] **Step 5: Run again and watch the cross-check fail**

```bash
pnpm vitest run packages/data/src/map.test.ts tools/src/terrain_symbols.test.ts
```

Expected: `map.test.ts` PASSES (8 symbols, `^` parses). `terrain_symbols.test.ts` **FAILS** on `declares exactly the same symbols in both places` — the legend now has `^` and the validator does not.

If the cross-check passes here, it is not doing its job. Stop and fix the test before continuing.

- [ ] **Step 6: Add the symbol to the validator**

In `tools/validate_data.mjs:775`, change:

```js
const TERRAIN_SYMBOLS = new Set(['.', '1', '2', '3', 'r', 'o', 'n']);
```

to:

```js
const TERRAIN_SYMBOLS = new Set(['.', '1', '2', '3', 'r', 'o', 'n', '^']);
```

- [ ] **Step 7: Document `^` in the schema**

In `data/schemas/map.schema.json`, the top-level `description` contains:

```
'r' road, 'o' olive grove, 'n' rocky knoll, and any building symbol declared in data/structures.json.
```

Change to:

```
'r' road, 'o' olive grove, 'n' rocky knoll, '^' rock ridge (impassable, blocks sight), and any building symbol declared in data/structures.json.
```

And in `properties.rows.items.description`, which contains:

```
\"n\" rocky knoll (cover 2). Building symbols are whatever data/structures.json declares
```

Change to:

```
\"n\" rocky knoll (cover 2), \"^\" rock ridge (impassable, no cover, blocks line of sight -- the only blocked tile that is not a building, and therefore the only one with no HP, no garrison and no ROE penalty). Building symbols are whatever data/structures.json declares
```

- [ ] **Step 8: Run the tests and the data gate**

```bash
pnpm vitest run packages/data/src/map.test.ts tools/src/terrain_symbols.test.ts
pnpm validate:data
```

Expected: both test files PASS. `validate:data` prints `data gate passed: N file(s) validated` — the five existing maps use no `^`, so nothing changes for them.

- [ ] **Step 9: Commit**

```bash
git add packages/data/src/map.ts packages/data/src/map.test.ts \
        tools/validate_data.mjs tools/src/terrain_symbols.test.ts \
        data/schemas/map.schema.json
git commit -F - <<'EOF'
feat(data): rock that blocks sight, and a guard that actually guards

`^` joins the terrain legend as the first blocked tile in the game that
is not a building -- no HP, no garrison, no ROE penalty, which is the
whole reason Sur's ridges are terrain rather than concrete. losRay
already returns -1 for a structureless blocked tile, so the mechanic
needed no sim code; it needed a way to author it.

Also replaces a guard that was weaker than it looked. map.test.ts
compared TERRAIN_LEGEND against a hardcoded array with a comment asking
the next author to update validate_data.mjs's copy -- a tripwire, not a
check. Updating the test and forgetting the .mjs gave green tests and a
map the data gate rejects. tools/src/terrain_symbols.test.ts now reads
the validator's source and compares the literals, so the drift is
impossible instead of merely rude.

Reading source and regexing a literal is ugly, and it is worth it: the
last time two copies of one idea drifted here, tunnel registration went
missing from playtest.ts and the harness was dead for two days with the
whole suite green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 2: `applyTerrain`, replacing three hand-copied loops

`parseMap` fills a `blocked` array that no call site reads — every blocked tile reaching a `Sim` today arrives through `addStructure`. Meanwhile the *cover* loop is written out three times, slightly differently each time. This task adds the function that consumes `blocked` and collapses all three copies into it.

**Files:**
- Modify: `packages/data/src/map.ts` (append after `parseMap`)
- Modify: `packages/data/src/index.ts:73-82` (the re-export block)
- Modify: `packages/data/src/map.test.ts` (append a describe block)
- Modify: `packages/app/src/main.ts:241-245`
- Modify: `tools/src/walk_world.ts:77-83`
- Modify: `tools/src/backtest/playtest.ts:21-25`

**Interfaces:**
- Consumes: `ParsedMap` and `DECOR.ridge` from Task 1.
- Produces:
  ```ts
  export interface TerrainSink {
    setBlocked(x: number, y: number, b: boolean): void;
    setCover(x: number, y: number, c: number): void;
  }
  export function applyTerrain(map: ParsedMap, sink: TerrainSink): void;
  ```
  Task 3's end-to-end test calls `applyTerrain(map, sim)` directly.

- [ ] **Step 1: Write the failing test**

Append to `packages/data/src/map.test.ts`:

```ts
// The map's mechanical layer reaching the sim. This used to be a loop written
// out three times -- main.ts, walk_world.ts and playtest.ts -- none of which
// consumed `blocked` at all. The sink is structurally typed so @lions/data
// imports nothing and stays a leaf; Sim satisfies it without knowing it exists.
describe('applyTerrain', () => {
  interface Call {
    x: number;
    y: number;
    v: number | boolean;
  }

  function sink(): { blocks: Call[]; covers: Call[] } & TerrainSink {
    const blocks: Call[] = [];
    const covers: Call[] = [];
    return {
      blocks,
      covers,
      setBlocked: (x, y, v) => blocks.push({ x, y, v }),
      setCover: (x, y, v) => covers.push({ x, y, v }),
    };
  }

  it('blocks ridge tiles and nothing else on open ground', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'r', name: 'R', width: 3, height: 2, rows: ['.^.', '...'] }), s);
    expect(s.blocks).toEqual([{ x: 1, y: 0, v: true }]);
    expect(s.covers).toEqual([]);
  });

  it('passes cover levels through, including grove and knoll', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'c', name: 'C', width: 4, height: 2, rows: ['.12o', 'n3..'] }), s);
    expect(s.covers).toEqual([
      { x: 1, y: 0, v: 1 },
      { x: 2, y: 0, v: 2 },
      { x: 3, y: 0, v: 1 },
      { x: 0, y: 1, v: 2 },
      { x: 1, y: 1, v: 3 },
    ]);
    expect(s.blocks).toEqual([]);
  });

  it('blocks building tiles too, which is harmless and keeps it idempotent', () => {
    // addStructure sets the same bit in the same array and demolish clears it,
    // so order against the structure loop does not matter.
    const s = sink();
    applyTerrain(parseMap({ id: 'b', name: 'B', width: 3, height: 2, rows: ['.#.', '...'] }), s);
    expect(s.blocks).toEqual([{ x: 1, y: 0, v: true }]);
  });

  it('never unblocks a tile, so it cannot undo a structure', () => {
    const s = sink();
    applyTerrain(parseMap({ id: 'o', name: 'O', width: 3, height: 2, rows: ['...', '...'] }), s);
    expect(s.blocks).toEqual([]);
  });
});
```

Add `applyTerrain` and `type TerrainSink` to the existing import at the top of `map.test.ts`:

```ts
import {
  DECOR,
  PER_TILE_SYMBOLS,
  STRUCTURE_SYMBOLS,
  TERRAIN_LEGEND,
  applyTerrain,
  parseMap,
  type MapJson,
  type TerrainSink,
} from './map';
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run packages/data/src/map.test.ts
```

Expected: FAIL — `applyTerrain is not a function`, plus a TypeScript error on the missing `TerrainSink` export.

- [ ] **Step 3: Implement it**

Append to `packages/data/src/map.ts`, after `parseMap`:

```ts
/**
 * What `applyTerrain` writes into. Structural on purpose.
 *
 * `@lions/data` is a leaf and imports nothing, so it cannot name `Sim` — and it
 * does not need to. `Sim` satisfies this shape already, which is the entire
 * mechanism: the dependency direction holds and the duplication still dies.
 */
export interface TerrainSink {
  setBlocked(x: number, y: number, b: boolean): void;
  setCover(x: number, y: number, c: number): void;
}

/**
 * Hand a parsed map's mechanical layer to a sim.
 *
 * This existed three times before it existed once: main.ts, walk_world.ts and
 * backtest/playtest.ts each wrote their own cover loop, and none of them
 * consumed `blocked` at all -- so `parseMap` filled an array nobody read, and
 * rock terrain had nowhere to arrive.
 *
 * Three copies of one idea is how tunnel registration went missing from
 * playtest.ts: the harness died at Beit Sahwan II for two days with every test
 * green, because a tool had drifted from the app and nothing compared them.
 * One function is the fix, and the next terrain concept edits one file.
 *
 * Only ever sets blocked TRUE. Structure tiles are blocked in `map.blocked`
 * too, so this marks them as well -- harmless and idempotent, since
 * `addStructure` sets the same bit in the same array and `demolish` clears it.
 * Never unblocking means calling this after the structure loop cannot undo it.
 */
export function applyTerrain(map: ParsedMap, sink: TerrainSink): void {
  const { width, height, blocked, cover } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      if (blocked[t] !== 0) sink.setBlocked(x, y, true);
      if (cover[t] !== 0) sink.setCover(x, y, cover[t]);
    }
  }
}
```

- [ ] **Step 4: Export it from the package**

In `packages/data/src/index.ts`, the block at line 73 becomes:

```ts
export {
  parseMap,
  applyTerrain,
  DECOR,
  STRUCTURE_SYMBOLS,
  TERRAIN_LEGEND,
  type MapJson,
  type ParsedMap,
  type DecorKind,
  type TerrainSink,
  type TerrainTheme,
} from './map';
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
pnpm vitest run packages/data/src/map.test.ts
```

Expected: PASS, all four new `applyTerrain` cases plus everything that was already there.

- [ ] **Step 6: Convert `packages/app/src/main.ts`**

Replace lines 241-245 — currently:

```ts
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = y * map.width + x;
      if (map.cover[t] !== 0) sim.setCover(x, y, map.cover[t]);
    }
  }
```

with:

```ts
  // Cover AND blocked terrain, through the one function all three world
  // builders share. Rock ridges arrive here; before this existed, `map.blocked`
  // was filled by parseMap and read by nobody.
  applyTerrain(map, sim);
```

Add `applyTerrain` to the existing `@lions/data` import (the one that already brings in `parseMap` at line 36).

- [ ] **Step 7: Convert `tools/src/walk_world.ts`**

Replace lines 77-83 — currently:

```ts
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = y * map.width + x;
      const c = map.cover[t];
      if (c !== undefined && c !== 0) sim.setCover(x, y, c);
    }
  }
```

with:

```ts
  applyTerrain(map, sim);
```

Change the import at line 18 to:

```ts
import { applyTerrain, parseMap, structures as structureCatalogue } from '../../packages/data/src/index';
```

- [ ] **Step 8: Convert `tools/src/backtest/playtest.ts`**

Replace lines 21-25 — currently:

```ts
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = y * map.width + x;
      if (map.cover[t]) sim.setCover(x, y, map.cover[t]);
    }
```

with:

```ts
  applyTerrain(map, sim);
```

Change the import at line 5 to:

```ts
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain } from '@lions/data';
```

- [ ] **Step 9: Verify nothing moved**

```bash
pnpm test
pnpm typecheck
pnpm test:determinism
```

Expected: all pass. **`test:determinism` is the one that matters here** — the three call sites now block structure tiles slightly earlier than `addStructure` does, and the golden hash proves that changed no outcome. If the hash moved, stop: something about the conversion is not equivalent.

Note `walk_world.ts` previously guarded `c !== undefined`, which `applyTerrain` does not need — `map.cover` is a `Uint8Array` and an in-bounds index is never `undefined`. That guard was dead code, not behaviour.

- [ ] **Step 10: Commit**

```bash
git add packages/data/src/map.ts packages/data/src/map.test.ts packages/data/src/index.ts \
        packages/app/src/main.ts tools/src/walk_world.ts tools/src/backtest/playtest.ts
git commit -F - <<'EOF'
refactor(data): one terrain loop instead of three, and blocked finally lands

parseMap has always filled a `blocked` array that no call site read: every
blocked tile reaching a Sim got there through addStructure. Meanwhile the
cover loop was written out three times -- main.ts, walk_world.ts and
backtest/playtest.ts -- slightly differently in each.

applyTerrain(map, sink) replaces all three and consumes blocked, which is
what gives rock terrain somewhere to arrive. The sink is structurally
typed, so @lions/data names no sim type, imports nothing, and stays a
leaf; Sim satisfies the shape without knowing it exists.

Three copies of one idea is how tunnel registration went missing from
playtest.ts and left the harness dead for two days with every test green.
The next terrain concept edits one file.

Determinism pin unmoved, which is the proof the conversion is
behaviour-preserving: structure tiles are now blocked marginally earlier
than addStructure would, and the hash says no outcome noticed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 3: Prove rock blocks sight, end to end

Tasks 1 and 2 are unit-level. Neither proves the thing the Sur front is built on: that authoring `^` in map JSON actually stops a unit seeing through it. `packages/sim` cannot import `@lions/data` and `@lions/data` cannot import `packages/sim`, so this test belongs in `tools/` — the same reasoning that put `protected_sites.test.ts` there.

The test is self-controlling: the identical scenario with `.` instead of `^` must show the enemy seen. Without that control, a test asserting "not visible" passes for any reason at all, including a broken spawn.

**Files:**
- Create: `tools/src/rock_terrain.test.ts`

**Interfaces:**
- Consumes: `applyTerrain`, `parseMap` from Task 2; `TERRAIN_LEGEND['^']` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test**

Create `tools/src/rock_terrain.test.ts`:

```ts
// Rock terrain, from authored JSON to a broken sight line.
//
// map.test.ts proves `^` parses. This proves it MATTERS: a ridge between two
// units stops them seeing each other, which is the single mechanic the whole
// Sur front rests on ("rock that blocks sight -- fields of fire and dead
// ground"). losRay already returned -1 for a structureless blocked tile; what
// was missing was any way to author one, and any test that the authoring works.
//
// Every case is paired with the identical map using '.' instead of '^'. A test
// that only asserts "cannot see" passes when the spawn is broken, when the
// units are on the same side, or when detection is switched off entirely. The
// control is what makes the assertion mean anything.
//
// packages/sim imports nothing and packages/data is a leaf, so tools/ is the
// only place that may hold both ends of this -- same reasoning as
// protected_sites.test.ts.
import { describe, expect, it } from 'vitest';
import { applyTerrain, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

const SCOUT: UnitTypeJson = {
  id: 't_scout',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 16, signature: 0.6 },
};

/** A 16x5 corridor with a full-height wall of `fill` down column 8. */
function corridor(fill: '^' | '.'): MapJson {
  const row = (): string => `........${fill}.......`;
  return { id: `corridor_${fill === '^' ? 'rock' : 'open'}`, name: 'Corridor', width: 16, height: 5, rows: [row(), row(), row(), row(), row()] };
}

/** Build the world, put a scout each side of column 8, and let detection settle. */
function watch(fill: '^' | '.'): { sim: Sim; west: number; east: number } {
  const map = parseMap(corridor(fill));
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const scout = sim.addUnitType(SCOUT);
  const west = sim.spawn(scout, 0, fx.from(3.5), fx.from(2.5));
  const east = sim.spawn(scout, 1, fx.from(13.5), fx.from(2.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return { sim, west, east };
}

describe('a rock ridge authored as `^`', () => {
  it('is impassable to the sim, not merely to the parser', () => {
    const { sim } = watch('^');
    for (let y = 0; y < 5; y++) expect(sim.blocked[y * 16 + 8]).toBe(1);
  });

  it('breaks the sight line across it', () => {
    const { sim, west, east } = watch('^');
    expect(sim.debugDetection(west, east)?.visible).toBe(false);
  });

  it('and the same ground without it does not — the control', () => {
    // 10 tiles apart with 16 tiles of sight. If THIS fails, the test above
    // proves nothing: the units were never going to see each other anyway.
    const { sim, west, east } = watch('.');
    expect(sim.debugDetection(west, east)?.visible).toBe(true);
  });

  it('leaves the ridge tiles with no cover, so nothing gains concealment from it', () => {
    const { sim } = watch('^');
    for (let y = 0; y < 5; y++) expect(sim.cover[y * 16 + 8]).toBe(0);
  });
});
```

- [ ] **Step 2: Run it**

```bash
pnpm vitest run tools/src/rock_terrain.test.ts
```

Expected: PASS on all four.

Two API notes, both already accounted for in the code above — do not "fix" them back:

- `debugDetection(obs: number, tgt: number)` (`sim.ts:1987`) takes **two unit ids**. `smoke.test.ts:53` calls it as `sim.debugDetection(observer, 1)`, which reads like a side but is not: that scenario spawns units whose ids happen to equal their sides. Pass `west` and `east`.
- There is no `coverAt`. `sim.cover` is a public `readonly Uint8Array` (`sim.ts:631`), indexed row-major — hence `sim.cover[y * 16 + 8]`. `sim.blocked` (`sim.ts:630`) is public the same way, which `movement.test.ts:50` already relies on.

- [ ] **Step 3: Confirm the control can fail**

Temporarily change the control test's `watch('.')` to `watch('^')` and re-run. Expected: that test FAILS. Change it back.

This is the "watch it fail" step for a test whose subject already worked before the change — the point is proving the assertion discriminates, not that new code went green.

- [ ] **Step 4: Commit**

```bash
git add tools/src/rock_terrain.test.ts
git commit -F - <<'EOF'
test(tools): a ridge authored in JSON actually breaks the sight line

map.test.ts proves `^` parses. This proves it matters: two scouts ten
tiles apart with sixteen tiles of sight, and a rock column between them,
do not see each other -- while the identical map with open ground in
that column shows them plainly.

The control is the point. A test that only asserts "cannot see" passes
when the spawn is broken, when both units are on the same side, or when
detection is off entirely. Pairing each case with the open-ground twin
is what makes the assertion discriminate.

Lives in tools/ because packages/sim imports nothing and packages/data
is a leaf, so this is the only place that may hold both ends -- the same
reasoning that put protected_sites.test.ts here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 4: Draw the ridge

Rendering has no test requirement in this repo (CLAUDE.md: *"Combat maths requires tests; rendering does not"*), so the safety here is the enum divergence guard plus your eyes.

**Files:**
- Modify: `packages/render/src/renderer.ts:159` and the decor branches at ~:1311
- Modify: `packages/app/src/main.ts:417-421` (the divergence guard)

**Interfaces:**
- Consumes: `DECOR.ridge = 4` from Task 1.
- Produces: `TERRAIN_DECOR.ridge = 4`, exported from `@lions/render` via the existing `index.ts:10` re-export.

- [ ] **Step 1: Extend the render enum**

`packages/render/src/renderer.ts:159`:

```ts
export const TERRAIN_DECOR = { none: 0, road: 1, grove: 2, knoll: 3, ridge: 4 } as const;
```

- [ ] **Step 2: Extend the divergence guard**

`packages/app/src/main.ts:417-421` currently reads:

```ts
    DECOR.none !== TERRAIN_DECOR.none ||
    DECOR.road !== TERRAIN_DECOR.road ||
    DECOR.grove !== TERRAIN_DECOR.grove ||
    DECOR.knoll !== TERRAIN_DECOR.knoll
```

Add a line:

```ts
    DECOR.none !== TERRAIN_DECOR.none ||
    DECOR.road !== TERRAIN_DECOR.road ||
    DECOR.grove !== TERRAIN_DECOR.grove ||
    DECOR.knoll !== TERRAIN_DECOR.knoll ||
    DECOR.ridge !== TERRAIN_DECOR.ridge
```

- [ ] **Step 3: Add the draw branch**

In `packages/render/src/renderer.ts`, immediately after the closing brace of the `TERRAIN_DECOR.knoll` branch (~line 1328) and before the `TERRAIN_DECOR.grove` branch, insert:

```ts
        if (kind === TERRAIN_DECOR.ridge) {
          // The knoll's rock, scaled up until it reads as impassable. A knoll
          // is scatter you walk over; a ridge is the reason the valley has two
          // ways through, and the difference has to be legible at a glance or
          // the player will path into it and wonder why they stopped.
          //
          // Still flat, for the same reason the knoll is: the sim has no
          // elevation. Drawing a ridge tall would promise dead ground behind
          // it that the sight model does not actually grant -- what it grants
          // is a broken line THROUGH the tile, which is what covering the
          // whole tile says.
          g.poly(diamond).fill({ color: t.rock, alpha: 0.92 });
          for (let k = 0; k < 5; k++) {
            const a = PixiRenderer.h2(x * 13 + k, y * 29 + k);
            const b = PixiRenderer.h2(x * 7 + k, y * 19 + k);
            const px = cx + (a - 0.5) * (TILE_W - 8);
            const py = cy + (b - 0.5) * (TILE_H - 4);
            const r = 6 + a * 7;
            g.ellipse(px, py, r, r * 0.7).fill({ color: t.rock, alpha: 0.95 });
            g.ellipse(px - r * 0.24, py - r * 0.26, r * 0.55, r * 0.32).fill({
              color: t.rockLit,
              alpha: 0.9,
            });
          }
          continue;
        }
```

`t.rock` and `t.rockLit` are the existing tone-bundle keys the knoll branch already uses — no new palette entry, and therefore nothing for `validate:ui` to reject.

- [ ] **Step 4: Verify it compiles and the gates hold**

```bash
pnpm typecheck
pnpm lint
pnpm validate:ui
pnpm build
```

Expected: all pass. `validate:ui` should report its usual clean file count — the branch names no colour literal.

- [ ] **Step 5: Look at it**

There is no test for this, and screenshots of a ridge are the only way to know it reads as impassable rather than as a large knoll. `pnpm dev` serves the app; no shipped map contains `^` yet, so the fastest look is to temporarily paste a `^` run into a row of `data/maps/beit_sahwan_outskirts.json`, look, then **undo the edit** — do not `git checkout` the file, which would take any other uncommitted work in it with it.

Report what you saw. If it reads wrong, say so rather than committing it — a render treatment is cheap to change now and expensive to change once three maps are authored against it.

- [ ] **Step 6: Commit**

```bash
git add packages/render/src/renderer.ts packages/app/src/main.ts
git commit -F - <<'EOF'
feat(render): a ridge reads as ground you do not cross

The knoll's rock, scaled up until impassability is legible at a glance.
It has to be: a knoll is scatter you walk over and a ridge is the reason
a valley has two ways through, and a player who cannot tell them apart
paths into the second and wonders why they stopped.

Flat, like the knoll and for the same reason -- the sim has no
elevation. A tall ridge would promise dead ground behind it that the
sight model does not grant; what it grants is a broken line through the
tile, which is what covering the whole tile says.

Existing tone keys, so no new palette entry and nothing for validate:ui
to find. The DECOR/TERRAIN_DECOR divergence guard in main.ts gains the
ridge line, so the two enums cannot drift silently.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 5: Document the symbol, and run every gate

**Files:**
- Modify: `CLAUDE.md` (the "Adding content" → "A map" bullet)

**Interfaces:**
- Consumes: everything above. Produces nothing.

- [ ] **Step 1: Update `CLAUDE.md`**

The map bullet currently reads:

```
**A map:** JSON in `data/maps/`, validated against `map.schema.json`. A character grid (`.` open, `1`–`3` cover, `#` building) plus named markers and zones — authorable in a text editor. The loader is `parseMap` in `@lions/data`.
```

Replace with:

```
**A map:** JSON in `data/maps/`, validated against `map.schema.json`. A character grid (`.` open, `1`–`3` cover, `#` building, `^` rock ridge) plus named markers and zones — authorable in a text editor. The loader is `parseMap` in `@lions/data`, and `applyTerrain(map, sim)` is the one way its mechanical layer reaches a `Sim` — use it rather than writing a fourth cover loop. `^` is the only blocked tile that is not a building: impassable, sight-blocking, and with no HP, garrison or ROE penalty.
```

- [ ] **Step 2: Run the full gate sweep**

```bash
pnpm test
pnpm test:determinism
pnpm typecheck
pnpm lint
pnpm validate:data
pnpm validate:ui
pnpm build
pnpm balance
```

Expected, and **check each against the constraint it guards**:

| Gate | Expectation |
|---|---|
| `test` | 618 + new tests, 0 failures |
| `test:determinism` | **hash unchanged** — no sim code, no map file changed |
| `typecheck` | clean (CI runs it; CLAUDE.md's command list omits it) |
| `lint` | clean |
| `validate:data` | same file count as baseline, gate passed |
| `validate:ui` | clean, no allowlist |
| `build` | succeeds |
| `balance` | **five §5.7 figures unchanged** |

- [ ] **Step 3: Run the playtest harness**

```bash
pnpm playtest
```

Expected: **exits non-zero**, failing on the two missions tracked as #96 and #97 — that is its known baseline on `main`, not a regression from this work. Compare its output against `git stash`-free baseline by running it on `origin/main` in a scratch checkout if anything else fails.

Record in the commit which missions failed, so a future reader can tell this slice did not add one.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: name the rock symbol, and the one way terrain reaches the sim

`^` in the map bullet, plus the rule that made this slice worth doing:
applyTerrain is how a map's mechanical layer gets to a Sim, and a fourth
hand-written cover loop is the bug, not the shortcut.

Gates: test / determinism (pin unmoved) / typecheck / lint /
validate:data / validate:ui / build / balance (five §5.7 figures
unmoved). pnpm playtest still red on the two missions tracked as #96 and
#97, unchanged from origin/main.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task:

| Spec section | Task |
|---|---|
| §1 One symbol (`^`, no cover, permanent, one kind) | 1 |
| §2 `applyTerrain` + three call sites | 2 |
| §3 Rendering (`DECOR.ridge`, knoll-family draw, divergence guard) | 4 |
| §4 The second symbol list + the tripwire→cross-check upgrade | 1 |
| Testing: `^` parses | 1 |
| Testing: legend/validator cross-check | 1 |
| Testing: `applyTerrain` against a fake sink | 2 |
| Testing: detection fails across a ridge | 3 |
| "What must not move" (determinism, balance, validate:data) | 2 (determinism), 5 (all) |

**One deliberate deviation from the spec.** The spec's test list says *"pathing routes around it"*. `packages/sim/src/movement.test.ts:41` already proves exactly that — a full-height `setBlocked` wall, asserting the unit never ends a tick inside it — so Task 3 asserts impassability at the sim level (`sim.blocked` is 1 for every ridge tile) rather than re-testing flow-field avoidance that is already covered. Re-proving it would be duplication, which is the thing this slice exists to reduce.

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. Every API the plan names was checked against the tree while writing it, which caught two errors before they reached an implementer: `coverAt` does not exist (`sim.cover` is a public `readonly Uint8Array`), and `debugDetection` takes two unit ids rather than an id and a side — `smoke.test.ts` hides that by spawning units whose ids coincide with their sides.

**Type consistency.** `applyTerrain(map: ParsedMap, sink: TerrainSink): void` is spelled identically in Task 2's interface block, its implementation, its test, and Task 3's usage. `DECOR.ridge` / `TERRAIN_DECOR.ridge` are both `4` and are compared by the guard in Task 4. `TerrainSink` is exported as a type from both `map.ts` and `index.ts`.
