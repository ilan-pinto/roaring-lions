# Phase C outcome — parity, and the first measurement of it

**Date:** 2026-08-28
**Branch:** `feat/three-renderer`
**Predecessors:** phase outcomes B1-B4, `2026-08-28-phase-r0-verdict.md`

Phase C is "VFX, overlays, trails, fog, order markers, tutorial focus, picking.
Measured by the golden-image diff." Every feature has now landed, and — for the
first time in the migration — the two backends have been compared by something
other than a human looking at two screenshots.

---

## The measurement

`beit_sahwan_outskirts`, tick 100, camera at `town_center`, both backends at
identical position and zoom, same deterministic sim state:

| metric | value |
|---|---|
| pixels differing | **0.128%** (1,298 of 1,012,200) |
| mean channel delta | 1.03 / 255 |
| shape of the difference | **entirely edge-shaped** |
| solid-interior colour mismatch | **none, anywhere** |

The diff image is the finding: every differing pixel sits on a fog boundary, a
dome or minaret silhouette, or a tree/unit edge. No region of flat colour
disagrees. That is the signature of antialiasing being deliberately off in
three (a blended edge pixel is by definition not a palette colour) rather than
of any parity defect, and it means the two renderers agree on **what colour
everything is** while disagreeing only about how their edges are resolved.

**No real difference was found.**

## The methodology error is worth more than the number

The first run measured **0.834%** — 6.5× higher — and it was not a renderer
difference. It was a downscaled screenshot resampling edges, plus a font-load
race captured mid-settle. Both runs are recorded rather than only the clean one.

The lesson generalises past this harness: at these magnitudes the *capture
pipeline* is a larger error source than the thing being measured, so a parity
number without its capture conditions stated is not a number. A related trap hit
the same run — **the OS mouse cursor is shared across tabs** and leaked into one
capture as a false positive.

## The instrument

`tools/src/golden-diff/` — `diff.ts` (pure Node: pixelmatch + pngjs, no
browser), `capture-protocol.ts` (how to capture comparably), and
`expected-differences.ts`.

```
npx tsx tools/src/golden-diff/diff.ts <pixi.png> <three.png> <outDir>
```

**It is not in CI**, and cannot be without adding Playwright or Puppeteer — the
same gap `tools/src/backtest/playtest.ts` already has and which CLAUDE.md
already records as unpaid. Two manual gates now, not one.

## Eight expected differences, five of them found by reading

`expected-differences.ts` encodes divergences that are deliberate, so they do
not read as failures. Three were known going in; **five were found by reading
the B1-B4 outcome docs end to end**, which is the argument for those docs
existing:

- **`structureLastAlpha`** — three starts a collapse at up to alpha 1.0; Pixi's
  event ordering floors it to 0.55 for every ordinary combat kill. **Every
  building destruction differs.**
- Antialiasing off in three, by design.
- Mesh units have no Pixi equivalent at all.
- Tracer TTL: frame-count in Pixi vs time-based in three, aggravated by
  `step(n)` batching.
- Turret bearing gated on `isSoft` — Pixi never turns a `gun_truck` or
  `technical` turret.
- The turret `fire` clip is never rendered in Pixi, ever.
- The badge numeral's render-order band.
- The dead road-rut branch — catalogued to rule out, not to flag.

**Five of the eight are documented but not yet demonstrated**, because the run
never exercised combat. That is the honest limit of this result: it measures a
static-ish scene well and has never watched a building fall.

## What Phase D inherits

- **The flip-the-default gate now has an instrument**, and its first reading is
  clean. That is necessary and not sufficient: no combat has been diffed.
- **Run it over a fight before flipping.** Five expected-difference entries and
  the entire VFX/collapse surface are unexercised.
- **State capture conditions with every number.** The 6.5× methodology error
  above is the reason.
