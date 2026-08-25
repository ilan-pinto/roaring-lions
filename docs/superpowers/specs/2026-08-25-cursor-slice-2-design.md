# Contextual cursor — slice 2: the cursor you can see

**Date:** 2026-08-25
**Slice:** 2 of 3.
**Issue:** #116
**Spec it builds on:** `docs/superpowers/specs/2026-08-24-contextual-cursor-design.md`
**Status:** approved, pending implementation plan.

## Where slice 1 left it

`resolvePointer(world, ctx) → Resolution` is pure, tested, and already answers the question a cursor asks. `Resolution` carries `intents`, `roe`, `marker`, `note` and `armed`. The right-click, the three keyboard verbs and armed support all go through it.

Nothing draws. Slice 2 draws.

## One refinement to what was pitched, and it removes work

I described slice 2 as CSS for the common states plus a Pixi overlay for the X. **Working it through, the overlay is not needed yet.**

Move, attack, blocked, the X and the costly warning are all **static shapes**. A static shape is a CSS cursor — zero lag, no stage changes, no hide/show flicker between tiers, and no `cursor: none` juggling as the pointer crosses a boundary.

The canvas tier earns its place when the cursor must be **composed** — a base reticle plus a per-unit badge, fourteen units against eight-odd verbs — and when it animates. That is slice 3, and it is exactly where the hybrid's second half belongs.

So slice 2 is the CSS tier, the machinery that decides which cursor to show, and the ROE gate. `app.stage` is not touched.

## How the images are made

`validate:ui` scans `.ts`, `.css`, `.html` and `.svg` under `packages/app/src` and `assets/campaign`, rejecting hex and `rgb()/rgba()` literals **with no allowlist**, and rejecting any raw `--rl-*` outside `theme.css`. So a cursor SVG carrying palette colours cannot live in the source tree, and a hand-authored PNG would sit outside the palette discipline and desync the first time a colour moves.

**A Vite plugin injecting a `<style>` block solves it, and the precedent is already in the repo.** `packages/app/vite-plugin-palette.ts` reads `data/palette.json` and injects `:root{--rl-*}` through `transformIndexHtml`, which runs in **both dev and build**. A sibling plugin does the same for cursors:

```
cursor: url("data:image/svg+xml,<svg …fill='%23…'…>") 12 12, auto;
```

The colours are baked into the data URI **from the palette at inject time**, so nothing on disk holds a literal, nothing new enters `validate:ui`'s scan, and a palette change moves the cursor with everything else. No files are emitted, no dev middleware is needed, and `publicDir` is untouched.

Each rule needs its **hotspot** — the `x y` after the URL. A reticle points from its centre; an arrow points from its tip. Getting this wrong is invisible in a screenshot and obvious in play.

## How it updates

**The pointer handler stops computing and starts recording.**

`main.ts`'s `pointermove` currently runs, on every raw pointer event: a `screenToWorld`, a `structureAt`, a `.some()` over the selection, and **an O(N) scan over every entity** to find the nearest enemy. It is unthrottled, and a high-poll-rate mouse fires it several times per frame.

Slice 2 moves that work into the existing Pixi ticker callback at `main.ts:1103`, which already drives `renderer.frame(...)` once per rendered frame. `pointermove` keeps only its position write.

**This lowers the cost rather than adding to it.** The hover work goes from once per pointer event to once per frame, and the cursor resolution rides along for free. It also puts the existing unthrottled scan somewhere a future staggering sweep can find it — CLAUDE.md already schedules one for detection before unit counts pass ~150.

## The rules of engagement gate

`Resolution.roe` already carries three tiers. Slice 2 gives each a shape and a consequence.

| Tier | Cursor | Click behaviour |
|---|---|---|
| `free` | ordinary reticle | unchanged |
| `costly` | reticle with a warning mark | unchanged — the order goes through, ROE grades it |
| `protected` | **a big X** | **refused** unless Alt is held |

**A second shade of red would not do.** Under pressure a player reads shape, not hue, and the X has to be legible in peripheral vision — which is where it will actually be seen.

### Alt, and why not Ctrl

The attack order comes from right-click. On macOS, **Ctrl + left-click also fires `contextmenu`, with `ctrlKey: true`**, and Ctrl-click is the standard Mac idiom for right-clicking. A Mac player reaching for a context menu near a mosque would have issued a *confirmed* attack on a protected site — the guard inverted exactly where it matters most, silently.

`altKey` appears **nowhere** in `packages/app/src`. Alt is free on the map surface and in the panels.

**The confirm fails safe.** Some window managers grab Alt-drag. If the modifier never arrives, the confirm never fires and the protected target is simply not attacked. A swallowed key means *refused*, never *confirmed* — a stated property, not an accident of implementation.

### Demolish is not touched

`sortStructureOrder` already refuses to level a protected site unless the selection is *nothing but* demolishers, because isolating the engineers is itself the act of taking responsibility, and it needs no modifier. That rule fixed a real bug and it passes through unchanged. **The Alt gate applies to the attack path, which has no ROE check at all today.**

## `inFlaggedZone` stops being a stub

Slice 1 wired it to `() => false`. Everything needed is already in scope where the adapter is built: `map.zones` holds `[x, y, w, h]` rectangles, and `mission.roe.flagged_zones` names the protected ones. Missions already author it — `beit_sahwan_breach` flags `clinic`.

**The containment test must not be duplicated.** `MissionRuntime.stepRoe` already performs it at `mission.ts:1033`, and that method is what actually scores the player. A second copy in the app that drifts by one tile would mean a cursor that says "safe" over ground the sim charges you for — the same class of failure slice 1 existed to prevent, one layer up.

So the test is **exported from `packages/sim` as a pure helper and used by both**. It is a comparison of four integers: no state, no `fx.*`, no tick-path work, so **the determinism pin must not move.**

## Verification

**Testable as pure functions, and therefore tested:**

- the tier → cursor-name mapping, all three tiers
- the Alt gate: a `protected` target without Alt produces no intents and a note; with Alt produces the same intents `free` would have
- the zone helper, including the boundary — a tile at `x + w` is outside, a tile at `x` is inside
- `inFlaggedZone` against a real mission's authored zones, so the wiring is proven rather than the helper alone

**Each blocking case paired with the case that must not block.** This project has shipped four tests that passed with the code under test disabled, and slice 1's own suite had five cases that did not discriminate until they were mutation-tested. Every new assertion gets the same treatment: state what breaks it.

**Not testable, and honestly named:** whether the cursors are legible at gameplay zoom, whether the hotspots feel right, and whether the X reads in peripheral vision. That is a browser check.

**Gates:** `pnpm test:determinism` unmoved at `1639983699`; `pnpm validate:ui` **18 files clean** — the gate that catches a colour literal sneaking into the cursor CSS; `pnpm test`, `typecheck`, `lint`, `validate:data`, `build`; `balance` and `playtest` unchanged, neither drives a mouse.

## Scope

**In:** the cursor Vite plugin and its palette-derived data URIs; frame-coalesced hover resolution; the tier → cursor mapping; the Alt confirm on the attack path; the exported zone helper and real `inFlaggedZone`; the states that prove the machinery — move, attack, blocked, costly, protected, and the armed-support reticle.

**Out, deliberately:**

- **The fourteen per-unit badges.** Slice 3, and pure composition once this exists.
- **The Pixi overlay.** Not needed for static shapes; it arrives with composition.
- **A spatial index.** The hover scan becomes once-per-frame here, which is strictly better than today. Making it sublinear is its own slice, alongside detection's staggering sweep.
- **The handler testability seam.** Recorded in slice 1: extract the `contextmenu` body into a dependency-injected function so a node test can drive it. The hover path makes it a second caller, so it becomes worth doing — but it is a refactor with its own review surface and it should not ride inside the slice that adds a feature.
- **`tunnelUnderTile`'s unguarded aliasing.** Unreachable now that `tunnelAt` guards. Recorded, not fixed.

## After this

Slice 3 composes: base shape by verb, badge by unit, across fourteen units — which is where the Pixi overlay finally earns its place, because composition at runtime is free when you draw and a file-per-combination when you do not.
