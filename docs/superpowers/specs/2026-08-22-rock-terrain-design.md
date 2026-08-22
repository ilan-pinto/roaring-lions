# Rock terrain — design

**Date:** 2026-08-22
**Slice:** 1 of 5 in [the Sur front](./2026-08-22-sur-front-design.md)
**Issues:** [#15](https://github.com/ilan-pinto/roaring-lions/issues/15), [#20](https://github.com/ilan-pinto/roaring-lions/issues/20) (both closed by later slices, not this one)
**Status:** approved, pending implementation plan.

## The problem

Sur's doctrine is rock. From the front design: *"Rock that blocks sight. Fields of fire and dead ground — the map becomes half the doctrine."* Nothing in the game can author it.

`losRay` already returns `-1` for a blocked tile carrying no structure, so sight-blocking terrain **works**. It is merely unreachable: `TERRAIN_LEGEND` has no blocked entry, and every blocked tile in the game today comes from `STRUCTURE_SYMBOLS`. A ridge built the only way currently possible — from concrete buildings — would be destructible, garrisonable and ROE-scored, which is wrong three times over.

## Four findings, each checked against the tree

### The bulk `setBlocked` path is unnecessary

The front design called for one: *"`setBlocked` calls `recomputeFields()` on every call, so painting a ridge tile-by-tile at load would recompute flow fields hundreds of times."*

That is wrong, and the error is worth recording because it was the slice's only engine work.

`recomputeFields` (`sim.ts:1009`) iterates `fieldByGoal`. That map is populated exclusively by `fieldFor` (`sim.ts:1371`), which runs when a command needs a destination — never during setup. **At map-load time `fieldByGoal` is empty, so each `setBlocked` call loops zero times.**

The precedent settles it: `addStructure` already calls `recomputeFields()` once per building (`sim.ts:1070`), and Beit Sahwan raises dozens at load without trouble.

**Consequence: this slice contains no `@lions/sim` code at all.**

### `map.blocked` is computed and handed to nobody

`parseMap` fills a `blocked` array. No call site reads it. Every blocked tile reaching a `Sim` gets there through `addStructure` setting `this.blocked[t] = 1` directly.

So the loop that consumes `map.blocked` is new, not modified.

### The terrain loop is triplicated

| Call site | Terrain wiring today |
|---|---|
| `packages/app/src/main.ts:243` | `if (map.cover[t] !== 0) sim.setCover(...)` |
| `tools/src/walk_world.ts:81` | `if (c !== undefined && c !== 0) sim.setCover(...)` |
| `tools/src/backtest/playtest.ts:24` | `if (map.cover[t]) sim.setCover(...)` |

Three hand-copied versions of one idea, none consuming `blocked`.

This is the finding that shapes the design. Adding a fourth thing to remember in three places is **precisely** how tunnel registration went missing from `playtest.ts`: the harness died at Beit Sahwan II with `unknown tunnel "bs_tn_west"` and stayed broken for two days, because `playtest.ts` had drifted from `main.ts` and no gate ran it.

### Rock blocks air as well as ground

`losRay` (`sim.ts:1770`) is tile-Bresenham over `blocked` with no observer-type parameter. A ridge stops a `recon_drone` exactly as it stops a rifleman.

**Decided: keep it that way.** Recon into Sur means crossing the ridge line into MANPAD range rather than standing off behind it, which is the front's doctrine rather than an accident of it. Realism is the cost — a drone at altitude would see over a ridge — and it is worth paying, because the alternative hands the player every Sarim firing position before contact and the doctrine leans on you *not* having looked.

Revisit only if Tel Marum measures the drone as dead weight rather than repositioned.

## The design

### 1. One symbol

In `TERRAIN_LEGEND` (`packages/data/src/map.ts`):

```ts
'^': { blocked: 1, cover: 0, decor: DECOR.ridge },
```

`^` reads as a ridge in a text editor, is unclaimed by the structure catalogue, and is already legal under the schema's permissive `^\S+$` row pattern.

Three properties follow from the entry rather than from new code:

- **No cover.** Nobody stands on a blocked tile. An author who wants a firing position at the base of a ridge paints a `1` or `2` beside it — authoring, not engine.
- **Permanent.** No HP, no breach, no rubble. That is the whole reason it is not a building.
- **One kind only.** `n` (rocky knoll, cover 2) already covers *passable* rock. The new symbol is the impassable case, and a second variant would be a mechanic nobody has asked for.

### 2. `applyTerrain`, replacing the triplication

`@lions/data` gains one exported function:

```ts
export interface TerrainSink {
  setBlocked(x: number, y: number, b: boolean): void;
  setCover(x: number, y: number, c: number): void;
}

export function applyTerrain(map: ParsedMap, sink: TerrainSink): void;
```

Structural typing only. `data` never imports `sim`, so it stays a leaf and the one-way dependency direction holds; `Sim` satisfies `TerrainSink` without knowing the interface exists.

All three call sites collapse to `applyTerrain(map, sim)`. **This deletes the existing duplication rather than extending it**, which is the reason the function earns its place: the next person to add a terrain concept edits one file and cannot forget the third.

Structure tiles are also `blocked` in `map.blocked`, so `applyTerrain` sets them too. Harmless and idempotent — `addStructure` sets the same bit in the same array, and `demolish` clears it (`sim.ts:3978`). Order relative to `addStructure` does not matter.

### 3. Rendering

`DECOR.ridge = 4` in `@lions/data`, mirrored as `TERRAIN_DECOR.ridge` in `@lions/render`. The divergence guard already in `main.ts:422` — *"decor enums have diverged between @lions/data and @lions/render"* — catches a mismatch, so no new safety net is needed.

The draw extends the knoll branch (`renderer.ts:1311`, already commented *"Rock, not height"*): the same family, larger and darker. Palette keys only, never raw hex. Rock reads as mountain without inventing a third terrain theme.

### 4. The second symbol list

`tools/validate_data.mjs:775` hardcodes `TERRAIN_SYMBOLS` because it is a Node script that cannot load TypeScript. `^` goes there too.

The existing guard is weaker than it looks. `packages/data/src/map.test.ts:71` asserts `TERRAIN_LEGEND`'s keys equal a **hardcoded array**, with a comment that `validate_data.mjs`'s list "must move with it". That is a tripwire, not a cross-check: adding `^` fails the test and forces the author to read the comment, but nothing verifies the validator was actually edited. An author who updates the test and forgets the `.mjs` gets green tests and a map the data gate rejects.

**This slice upgrades it to a real cross-check.** `validate_data.mjs` executes at import — it is a top-level script ending in `process.exit` — so a test cannot import it and compare. The test instead reads the validator's source as text and extracts the `TERRAIN_SYMBOLS` literal, asserting set equality with `TERRAIN_LEGEND`'s keys.

Reading source and regexing a literal is ugly, and it is worth it here: drift between duplicated lists is the failure mode this document already cites twice — the triplicated terrain loop, and the tunnel registration that went missing from `playtest.ts` for two days. A tripwire relies on the next author reading a comment. A cross-check does not.

`data/schemas/map.schema.json`'s row `description` gains `^`. The pattern needs no change.

## Testing

RED first, per the repo's TDD discipline.

- `^` parses to the blocked / cover / decor triple.
- `TERRAIN_LEGEND`'s keys equal the `TERRAIN_SYMBOLS` literal read out of `tools/validate_data.mjs` — the cross-check replacing the hardcoded tripwire, and it must be watched failing with the validator un-edited before the validator is touched.
- `applyTerrain` against a fake sink: ridge tiles get `setBlocked(true)`, cover tiles get `setCover`, open ground gets neither.
- A `Sim` built with a ridge column: detection **fails** across it, and pathing routes **around** it. Asserted through the public detection surface — `losRay` is private and reaching into it would test the implementation rather than the behaviour.

## What must not move

No `@lions/sim` code changes and no `data/maps` file changes, therefore:

- **`pnpm test:determinism` — pin unchanged.** Movement here is a bug in the work, not a deliberate retune.
- **`pnpm balance`** — the five §5.7 figures unchanged.
- **`pnpm validate:data`** — green on all five existing maps.

Plus the usual: `pnpm test`, `typecheck`, `lint`, `validate:ui`, `build`, and `pnpm playtest` no worse than its known-red baseline (#96, #97).

## Scope

**In:** the legend entry, `applyTerrain` and the three call-site conversions, the decor kind and its render treatment, the validator and schema entries, the symbol-list cross-check replacing the tripwire, and the tests above.

**Out, deliberately:**

- **A bulk `setBlocked` path.** Shown above to optimise nothing.
- **Air seeing over rock.** Decided; `losRay` is untouched.
- **Any map file.** A legend entry with no consumer is the dead-ability pattern the front design named — `hidden_setup`, `tunnel_travel` and `breach` are all authored and honoured by nothing. The mitigation here is tests that exercise the full chain, not a map that ships to be looked at. Tel Marum (slice 3) is the first real consumer.
- **The Sarim roster** (slice 2), **Tel Marum** (slice 3), **Umm Zeitoun** (slice 4), **the campaign re-sequencing** (slice 5).
- **The `nextMissionAfter` fall-through bug.** `campaign.ts:189` takes the first live region and gives up if none of its towns has a next mission, rather than continuing to the region after. Once the Marj completes, the first live region is Sur — which is empty — so the tutorial's next-mission link returns `undefined` instead of pointing at Wadi Halam. Real, found while confirming Sur's emptiness, and a campaign bug rather than a terrain one. It wants its own fix.
