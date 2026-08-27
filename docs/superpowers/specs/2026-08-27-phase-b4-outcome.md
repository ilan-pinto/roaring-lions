# Phase B4 outcome — what Phase C inherits

**Date:** 2026-08-27
**Branch:** `feat/three-renderer`
**Plan:** `docs/superpowers/plans/2026-08-27-three-renderer-phase-b4.md`
**Predecessors:** `2026-08-26-phase-b1-outcome.md`, `2026-08-27-phase-b2-outcome.md`,
`2026-08-27-phase-b3-outcome.md`

Phase B4's goal was one sentence: *`isVisible` tells the truth under
`?renderer=three` — unobserved ground and everything standing on it are hidden —
and a building being ground down finally throws dust.* It delivers on all three
clauses. Fog is computed by pure functions (`three/fog.ts`), drawn as one
instanced quad per unobserved tile (`three/fog-mesh.ts`), lifts with terrain
elevation, and hostiles standing in it are skipped on their interpolated
position rather than their tile. A demolished building falls and throws dust
instead of vanishing.

What follows is what a Phase C author needs that the code does not say by
itself.

---

## The band table is now a scheme with reserved room, and it points the right way

`packages/render/src/three/units/render-order.ts` is the single source of truth
for every `Object3D.renderOrder` this backend sets. **Read it before adding an
overlay.** Two things changed at the end of B4 and both matter to Phase C:

**`FOG_RENDER_ORDER` moved from 4 to 10.** Bands 4-9 are reserved, deliberately
undeclared, for Phase C's overlay tier. No constant exists for them yet, on
purpose: the module's own argument against inventing a band nobody consumes
still holds, and reserving the numbers costs nothing where reserving unconsumed
constants would recreate the hazard the file exists to prevent.

**The reason fog had to move is the finding worth carrying.** The module's
closing paragraph used to tell Phase C to put its overlays *above* fog, citing
three facts about the Pixi renderer. All three were false. `hpBarG` and
`selectionG` do not exist — `grep -c` returns 0; there is exactly one overlay
container, `unitsG` (`renderer.ts:197`), and every overlay draws into it in one
place (`renderer.ts:1898`). Nothing is added to `world` after `fogG`: `:551` is
the last `addChild`, `:552` is `stage.addChild(world)`. And `unitsG` is added at
`:548`, three lines *below* fog.

**So in Pixi, every overlay draws under fog.** The difference is not pedantic.
An order marker or queued route on unexplored ground, a selected unit's weapon
envelope crossing into fog, or a tutorial focus ring on an unexplored objective
must be *covered*. Overlays on a unit you can currently see are unaffected
either way — that tile is fog level 2 and draws no quad at all. The cases that
differ are exactly the ones that reach onto ground you cannot see, which is also
why nothing on screen would have looked wrong until Phase D's golden diff.

The directive was wrong for a whole phase and nothing caught it, because a doc
comment has no test. That is the general lesson: **this file's prose is
load-bearing, and prose does not fail a gate.** `render-order.test.ts` now pins
the ordering relationally — never by literal integer — so the scheme is checked
even though the reasoning still is not.

**Two traps the table now names explicitly, both on Phase C's own list.**
Trails are not in the overlay tier: Pixi's `trailG` is `world`'s second child
(`renderer.ts:539`), below `fxG`, `wreckLayer` and `spriteLayer` alike — under
everything, not over it. A trail is flat, depth-tested ground geometry, so the
depth buffer settles it rather than a band; if it needs one, at or below
`HULL_RENDER_ORDER`, never band 1 (which is the *turret* band, above every
hull).

And a **control-group badge is split across two containers in Pixi**: its ring
draws into `unitsG` (`renderer.ts:2310`) like every other overlay, but its
numeral is a `Text` in `spriteLayer` (`:2307`) carrying `zIndex =
Number.MAX_SAFE_INTEGER` (`:2315`). That puts the numeral above every sprite in
its own layer but *below* `fxAboveG`, `unitsG` and `fogG` — so Pixi paints
above-units FX over a group numeral. Porting the whole badge into bands 4–9
would lift the numeral over FX where Pixi covers it. The ring and the numeral
do not share a band in Pixi, and should not be assumed to share one here.

---

## `ThreeRenderer` has almost no headless coverage, and the phase's headline claim lives there

This is the largest single thing Phase C inherits, and it is a gap, not a
defect.

Fog's *model* is well covered — `fog.ts` is pure, `fog-mesh.ts` splits its pure
geometry arithmetic above the `THREE.*` divider and tests that half directly.
But the claim the phase is named for — *a hostile standing in fog is not drawn* —
lives in `ThreeRenderer.frame()`, which needs a real `WebGLRenderer`. It is
proven by one browser observation, and that observation does not isolate fog as
the cause: position, `alive` and `side` all correlate with the unit disappearing.

Phase C adds selection rings, HP bars, group badges, hover, order markers and a
focus ring into the same untestable class, and Phase D's golden-image diff is
the first automated cross-check of any of it.

**A seam is worth more than any single Phase C feature.** The shape that would
pay for itself: a pure `visibleEntityIndices(state, fog, …) => number[]` that
`frame()` calls, so the skip decision is testable without a GPU. B4's fix round
opened the door a crack — `ThreeRenderer.test.ts` now exists and constructs the
class headlessly behind a scoped `vi.mock('three', …)` standing in for
`WebGLRenderer` — but it guards exactly one thing (that `dispose()` disposes what
it owns) and should not be mistaken for coverage of `frame()`. **It is also this
codebase's first use of `vi.mock` anywhere**; if Phase C extends the pattern,
that is a precedent being set deliberately rather than a convention being
followed.

---

## An expected difference for Phase D's harness, not a bug report

`structureLastAlpha` is a deliberate divergence from Pixi, and **every building
destruction will differ in a golden-image diff.**

The mechanism, which is easy to get backwards: `damageStructure` pushes
`structureHit` for the *killing* blow before `destroyStructure`, and Pixi reads
live `hp` — so Pixi begins a collapse at its most-battered alpha (floored to
0.55) for every ordinary combat kill. Three starts a collapse at up to alpha
1.0. Pixi only keeps a building's full brightness when the kill arrives through
a path with no preceding damage event: a demolition tick, or a debug destroy.

This belongs in Phase D's harness as an expected-difference entry with that
explanation attached. Filed as a diff to investigate, it will cost someone an
afternoon.

---

## Two smaller things carried forward

**Comment task tags on the collapse port are wrong.** `collapseBillboardGeometry`,
`COLLAPSE_SECONDS`, `COLLAPSE_SQUASH`, `structureAliveAlpha`, `footprintCentre`,
`structureLastAlpha`, `beginCollapse`, `stepCollapses` and
`STRUCTURE_RENDER_ORDER` all say "Task B4.4". They landed in the `beginCollapse`
fast-follow; `task-B4.4-report.md` is a perf measurement. A reader tracing the
rationale lands nowhere. Not worth a commit on its own — worth fixing in the
first Phase C commit that touches any of them.

**"The Pixi backend is untouched" is true per-phase, not versus `main`.** B1–B4
each left `packages/render/src/renderer.ts` byte-identical, and that is the
claim their reviews checked. Against `main` it is not: Phase A changed it by
design across seven commits (`7f29f11`, `d1e9f0b`, `6035351`, `d5ecc5d`,
`b290344`, `f6ecfce`, `50177cb` — extracting the projection into `project.ts`,
introducing the `Renderer` interface, sharing the tile hash), 78 insertions and
92 deletions in all. That was the seam extraction the whole migration rests on,
it was reviewed on its own terms, and the user verified no visible behaviour
change. Worth stating plainly because the shorter phrasing invites the wrong
inference, and Phase D's golden diff will be run against a Pixi backend that
Phase A edited.

**The bundle split holds.** `dist/assets/ThreeRenderer-*.js` is its own lazy
chunk; `index-*.js` has zero hits for `BufferGeometry`, `InstancedMesh`,
`WebGLRenderer`, `shadowMap`, `PerspectiveCamera` or `aAlpha`. This regression —
three.js leaking into the main chunk — is the one that has survived undetected
longest across B1-B4, and it is only ever caught by building and grepping the
chunks. **Do that at the end of Phase C**, not at the end of the migration.

---

## On testing — the same lesson, a fifth time

B4's own review found two more tests that could not fail, both already
identified during B4.2, queued for a fix round, and then dropped when the round
never came:

- `FOG_COLOR` was asserted only as an exported string. Nothing checked the
  `uColor` uniform the shader actually reads — swapping `hexToUnit(FOG_COLOR)`
  for `hexToUnit('#FFFFFF')` in `createFogMaterial` left every test green. Fog's
  colour is a palette-exactness claim this whole migration rests on, and it was
  unguarded end to end for two phases.
- `expect(scale.x).toBeCloseTo(1, 5)` on a matrix built by
  `Matrix4.makeTranslation`, which always yields unit scale. The assertion
  tested three.js, not us.

Both are closed. The count across B1-B4 is now **25 tests that passed while
checking nothing**, every one of them found by breaking the thing and watching
what happened, and not one found by reading.

The second lesson is procedural and is the more expensive of the two: **a
finding queued for "a fix round after the next task lands" is a finding
dropped.** Both of these were correctly identified when they were introduced.
The queue is where they died. Fix it in the round that finds it, or file it
where a gate will trip on it.
