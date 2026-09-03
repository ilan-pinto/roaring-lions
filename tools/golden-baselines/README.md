# Golden baselines for the visual gate

Committed PNG captures of the **three.js** renderer at a fixed scenario, tick
and camera. `pnpm golden-baseline` re-captures and compares against them; the
whole mechanism is documented in `tools/src/golden-diff/baseline.ts`, which is
worth reading before changing anything here.

## Why the directory name is an environment, not a commit

`<platform>-<arch>-<glFamily>` — `darwin-arm64-swiftshader`,
`linux-x64-swiftshader`. A baseline is only valid for the environment that
captured it, because the same commit rendered through different GL backends is
measurably different: on one machine, SwiftShader against ANGLE/Metal read 230
differing pixels / 0.0320 meanAbsChannelDelta on the `quiet` scenario alone —
roughly 100× that scenario's run-to-run noise, and enough to hide the defect the
gate exists to catch. A capture environment with no directory here is **exit 3**
from the gate, loudly, never a silent pass.

**Read what exit 3 does and does not check.** The run still captures every
scenario and still votes on the reference-free checks that need no stored
picture — the **visible-toggle A/B**: hide a named draw layer, repaint, capture,
and require the frame to change (`BaselineSpec.layerChecks`; the renderer seam is
`packages/render/src/three/debug-layers.ts`). Ten of them run, across `quiet`,
`open-ground` and `relief`, covering scatter, decor, ground albedo and buildings.
Both defects this gate has ever been broken with now exit **1** from an empty
baseline directory, measured on this branch:

| defect | reading with no baseline |
|---|---|
| decor erase (`decor-place.ts`'s `familyFor` → `return null`) | `decor` toggle 0 px / 0.0000 on all three scenarios, against floors of 4700/0.4, 300/0.15, 12800/0.92 |
| stone-grain scatter no-op (`671acdb`) | `scatter` **tone** ratio 0.5927 / 0.6938 / 0.6359 against a 0.8 floor (clean tree: 0.9306 / 0.9544 / 0.9377) |

The decor erase is the one this section used to record as walking straight past
exit 3 with the old `groundTextureCheck` reading the clean tree's own number.
That check is **gone** — see "What happened to groundTextureCheck" below.

Exit 3 still means "nothing was COMPARED", and that is not nothing: `vehicle`
and `combat` declare no reference-free check at all and are captured, not
judged, and every check that runs is a statement about ONE layer in ONE framing.
A regression in something no layer check names — unit meshes, fog, overlays, a
wrong colour that is still a colour — passes here at any size. The fix is to
bless a baseline here.

## What happened to groundTextureCheck

It was deleted, 2026-09-03, and nothing replaced it in kind.

It cropped `open-ground`'s ground and failed if more than 95% of the crop was a
single flat colour: 0.9542 with the scatter defect present, 0.9408 without, and
for a while that 1.3% margin was the gate's only reference-free vote. Then
`c38f770` put a photographic sand tile on every open-ground pixel. Textured
ground is never one flat colour, so the same crop now reads **0.2330 with 6,721
distinct colours** — measured on both stored baselines — against a `<0.95`
budget it can no longer approach from any direction, on any tree. It could not
fire on the defect class it was built for, or on anything, and it went on
printing PASS.

The lesson is in the shape of the question, not the number: a reference-free
check that asks what the frame LOOKS LIKE can be blinded by content someone adds
later. One that asks whether a layer CONTRIBUTES pixels cannot — it never looks
at what is underneath. Do not reintroduce an appearance statistic here without a
defect it catches that the toggles do not.

**Floors are not per-environment, and that was measured rather than assumed.**
The same three scenarios captured through ANGLE/Metal instead of SwiftShader —
a rasteriser difference worth 230 px / 0.0320 against a stored baseline — move
every layer delta by under 2% except one (`relief`'s `ground-albedo` pixel
count, 1015 → 906, still 2.7× its floor), and move the three tone ratios by at
most 0.0004. One set of floors covers both backends, so a new environment needs
a blessed baseline but not a recalibration.

**Cross-OS portability of the stored PIXELS is unmeasured.** Linux SwiftShader
and macOS SwiftShader may or may not agree; nobody has diffed one against the
other. Do not assume the macOS set covers CI. (The reference-free floors above
are a different question and are measured across two GL backends.)

## The bytes

**464.3 KiB per environment**: four PNGs plus a manifest — `quiet` 107.5 KiB,
`open-ground` 111.6 KiB, `vehicle` 169.1 KiB, `relief` 74.4 KiB. Only *gated*
scenarios are stored — `combat` is captured on every run and reported, but it
never votes (its own same-commit noise is wider than the signal), so storing a
baseline for it would have cost another 362 KiB for a number that cannot decide
anything. Its frame is uploaded as a CI artifact instead.

`relief` is the newest and the cheapest, and it is what gives the gate any
coverage of `tel_marum` — the only shipped map with elevation and the only one
with `b` boulder tiles. Deleting every boulder decor object used to leave the
whole gate green; it now reads 36001 px / 2.6292 there. 74.4 KiB was judged
worth that.

## Changing a baseline

Never by hand. `manifest.json` carries a sha256 of every PNG and the gate
refuses to compare against a file that does not match it.

```bash
pnpm golden-baseline:bless -- --reason="what changed and why the new picture is correct"
```

`--reason` is required and is printed on every future mismatch. On CI the same
thing happens through the `visual-baseline-bless` workflow, which **commits the
new baseline straight to `main`** (the project lead's call, 2026-09-02). It used
to open a pull request so somebody looked at the picture first; nothing does
now. A wrong baseline landed here silently disarms the gate for everything it
would otherwise have caught, and the `--reason` is the only audit trail — so
write one that would tell a stranger whether the new picture is correct. To
review after the fact, read the commit's PNG diff on GitHub and revert it if the
change was not intended.

**Do not widen a threshold in `baseline.ts` to clear a red run.** Each one is
calibrated against a real repeated-capture measurement of its own scenario, and
the margins are small on purpose. That applies in both directions now: the
baseline thresholds are ceilings calibrated against run-to-run noise, and the
layer floors are minimums set at one third of a measured signal that was
bit-identical across five consecutive runs. Lowering a floor to clear a red run
is the same act as widening a ceiling.
