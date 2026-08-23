# Elevation E1 — height as data, drawn

**Date:** 2026-08-23
**Slice:** 1 of 3 in the elevation milestone (E1 data + render, E2 line of sight, E3 sight range)
**Status:** approved, pending implementation plan.

## The problem

The game is dimetric and its terrain is flat. Rock ridges — added in the Sur front's first slice — are drawn as flat scatter on a flat tile, because *"the sim has no elevation. Drawing a ridge tall would promise dead ground behind it that the sight model does not actually grant."*

That comment was written honestly, and it names the real constraint: you cannot draw height the game does not have without lying to the player. **This milestone gives the game the height, so the drawing can stop being a lie.**

E1 is the foundation: height becomes authorable, reaches the sim, and is drawn. **It changes no outcome.** E2 and E3 make it matter.

## Reversing an earlier decision, deliberately

`2026-08-22-sur-front-design.md` ruled elevation out: *"Elevation. #20 asked; sight-blocking terrain answers it."* That was the right call for a slice whose job was rock. It is the wrong call for a game whose next front is a mountain range, and the decision is reversed knowingly rather than forgotten.

What that document got right, and what survives: sight-blocking terrain does most of elevation's tactical work. E2 will add height to `losRay` as a refinement of a mechanic that already exists, not as a replacement for one that does not.

## How height is authored

A parallel character grid, in the same text-editor spirit as `rows`:

```json
"rows":      ["....", "..^.", "...."],
"elevation": ["0000", "0330", "0110"]
```

One digit per tile, `0`–`9`, dimensions matching `rows` exactly. The field is **optional**; absent means every tile is height 0, which is every map that exists today.

**The field is named `elevation`, not `heights` as an earlier draft of this spec had it.** `ParsedMap.height` already names the map's row count, and `applyTerrain` is the one function that destructures both the grid dimensions and the per-tile array in the same scope — parsing `heights` into a `height` array would have shadowed the dimension right there. `elevation` avoids the collision, so that is the name in `MapJson`, `ParsedMap`, `TerrainSink.setElevation` and `Sim.elevation` alike.

**Height is orthogonal to terrain symbol, not derived from it.** This is the load-bearing design decision and it is what makes valleys possible: open ground can sit high or low, a road can climb, and `^` rock is only a mountain because the author put it on high ground. Deriving height from the symbol would give you ridges and nothing else — no basins, no terraces, no valley floor.

The cost of orthogonality is that an author can write a ridge at height 0, which will look odd. That is the author's business, the same way a mosque in the middle of a field is.

## Into the sim

`ParsedMap` gains `elevation: Uint8Array`, row-major, alongside `blocked` and `cover`.

`TerrainSink` gains `setElevation(x, y, h)`, and `applyTerrain` carries it. The function that replaced three hand-copied cover loops in the previous slice is now the single door terrain data walks through, and it pays for itself a second time: three call sites gain elevation without any of them being edited twice.

`Sim` gains `readonly elevation: Uint8Array` beside `blocked` and `cover`, and **includes it in the determinism hash**.

### Nothing reads it

No LOS change, no sight change, no pathing change, no cost model. E1 stores height and draws it. That restraint is the point: it lets the format, the plumbing and the look be reviewed and looked at before any behaviour depends on them.

## What must not change, and the check that proves it

**The determinism pin moves exactly once, because a new array is hashed — not because any outcome changed.**

All four shipped maps are flat. All eleven missions must therefore play *identically*: same seed, same orders, same end state, same events. The pin's new value is committed in the same change with that reason stated, as CLAUDE.md requires.

The load-bearing test is a replay: run a mission before and after, compare the full end state rather than the hash. If anything but the hash differs, E1 has a bug — the storage is leaking into behaviour somewhere it should not.

## Drawing it

Terrain diamonds lift by `height × STEP` pixels and gain side faces, so a ridge has mass and a valley reads as sunken rather than as a differently-coloured floor.

| | value | why |
|---|---|---|
| `STEP` | **10 px** per height level | a 4-level ridge stands 40 px against `TILE_H` 32 and buildings at `H` 18 — clearly taller than a building without dwarfing units |
| practical map range | 0–4 | what an author should use; deeper relief reads as a wall rather than terrain |
| schema range | 0–9 | a dramatic peak stays possible without a format change |

These numbers are approved as a starting point and are one line to change. Nobody has seen them rendered.

### Units lift with the ground

A unit standing on a height-3 tile must draw 30 px up, or it sinks into the hill.

There are **61 `isoX`/`isoY` call sites** in the renderer. They are not all ground positions — VFX, UI anchors and camera maths use the same helpers. Rather than editing all 61, a single `groundOffset(x, y)` helper is introduced and routed into the draws that genuinely sit on terrain: units, wrecks, structures and decor. Everything else is left alone, and the ones that were left alone are listed in the implementation report so a reviewer can check the judgement rather than trust it.

### Picking is approximate, and says so

`screenToWorld` (`renderer.ts:928`) inverts the isometric transform with no height term. With elevation, a single screen point can correspond to several world tiles at different heights — the general solution is a raycast down the height field.

E1 does not do that. It projects flat, reads the height at that tile, and corrects once. This is accurate on flat and gently sloped ground and drifts on steep relief. It is documented as approximate in the function's own comment rather than presented as exact, and it is revisited if it proves annoying in play. Guessing wrong about how annoying is cheap; building a raycast nobody needed is not.

`unitsInScreenRect` (drag-select) received the same elevation correction during execution, but the two pickers now behave differently: it walks every living unit and projects each one forward with its own true lift (`isoY(x, y) - groundOffset(x, y)`), so drag-select is exact regardless of relief. `screenToWorld` (click-select) still inverts a single screen point with one sampled correction, so it stays the approximate one. That asymmetry is intentional — a rect test can afford to visit every candidate unit, a click cannot invert to one — but it means the two selection paths no longer share one accuracy story.

## Verification

- **A mission replays identically** — full end state, not just the hash. This is the gate that matters.
- `pnpm test:determinism` — pin moves **once**, updated in the same commit, reason stated.
- `pnpm validate:data` on all maps; the new `elevation` field validates and its absence stays legal.
- `pnpm validate:ui`, `typecheck`, `lint`, `build`.
- A map authored with relief, looked at by eye. **Nobody has seen extruded terrain in this game**, and no test will tell us whether 10 px per level reads correctly.

**What actually proves "nothing reads it" is a static check, not `pnpm balance` or `pnpm playtest`.** `elevation` appears in `packages/sim/src/sim.ts` exactly four times: the field declaration, its allocation, the setter's write, and the hash. Nothing else reads it. That grep is the evidence for the claim in "Nothing reads it" above.

`pnpm balance` and `pnpm playtest` are worth running and are still part of the gate sweep, but neither is capable of falsifying a leak here, so they are demoted to a weaker, complementary signal rather than cited as proof:

- `pnpm balance` never calls `parseMap` or `applyTerrain` — it builds synthetic scenarios directly. It is evidence unrelated combat maths did not regress, not evidence about elevation.
- `pnpm playtest` does route through `applyTerrain`, but every shipped map is flat, so `elevation[t] !== 0` is false for every tile and `setElevation` is never invoked. A leak of exactly the shape being guarded against — code that reads elevation and branches on it — would produce byte-identical output on an all-zero input either way. Passing tells you nothing distinguishes "nothing reads elevation" from "something reads it but every current map makes the read a no-op."

So: `pnpm balance` five §5.7 targets unmoved, and `pnpm playtest` still red on exactly #96 and #97 with no new failure, remain expected results worth checking — just not the thing that proves this slice changed no outcome. The static check does that.

## Scope

**In:** the `elevation` map field and its schema entry, `ParsedMap.elevation`, `TerrainSink.setElevation` and `applyTerrain`, `Sim.elevation` and its hashing, the extruded terrain draw, `groundOffset` and the ground-positioned draws it serves, and the approximate picking correction.

**Out, deliberately:**

- **E2 — line of sight reading height.** The mechanic. Its own slice, because it changes outcomes and needs its own balance pass.
- **E3 — sight range reading height.** High ground seeing further.
- **Slope movement cost.** The most invasive piece — it changes `FlowField.compute`, the pathing core every unit uses every tick — and the least of what elevation is for. Mountains that block sight and grant vantage are the feature; mountains that slow you down are polish. Revisit after E2 and E3 are measured.
- **Exact picking.** A raycast down the height field, if the approximation proves annoying.
- **Terrain art beyond extrusion.** No new symbols, no third theme, no rendered rock faces from Blender. `^` already exists and now simply has somewhere to stand.
- **Tel Marum.** Its design waits for elevation, because authoring a 48×48 map against flat terrain and then re-authoring it is the one clearly wasteful order. It becomes the first map that uses relief, which is a better mission than the flat one it would otherwise have been.

**A warning for E2 and E3, recorded here because it follows directly from the previous section:** the moment elevation is actually read — for line of sight or for sight range — a flat test corpus proves nothing. Every read is a no-op on flat ground, the same way `setElevation` is a no-op against every map shipped today. E2 must author a map with real relief into the playtest harness *before* any "unmoved" gate result on that slice means anything. Skipping that step ships E2 behind a green gate that tested nothing, exactly the failure mode this slice had to reason its way around in the Verification section above.
