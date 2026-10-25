# Falsification casebook

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 86-138, section "Every check gets an input that makes it fail" -->

### Every check gets an input that makes it fail — constructed, and run

Not "can I imagine one". Write the failing input, run it, watch the check go
red, then put it back. This is the single most expensive habit this repository
has learned, and it is not a hypothetical: one eight-task branch
(`feat/infantry-gait`, 2026-09-15/16) found **nine separate checks unable to
fail**, spread across Python build gates, vitest specs and a shipped
measurement instrument. The shapes repeat, which is why the instances are
listed rather than summarised:

- **It normalised by the very thing it measured.** `build_idle_src` yawed the
  pose by the circular mean of exactly the bearings `check_clip_semantics`
  then tested. The gate read zero for every possible input — arithmetically,
  not usually.
- **`x * 1.0 == x`.** Four of `_check_gait_identity_at_reference`'s five
  assertions. The fifth recomputed its own right-hand side.
- **It gated a residual that later code forces to 1.** The gait check was
  specified as "the post-rate-match residual sits near 1.0" — but the renderer
  computes `timeScale = entitySpeed / clipGroundSpeed`, so that residual is
  1.0 for any stride whatsoever, including none at all. It gates the
  MULTIPLIER now, which nothing normalises.
- **The "independent" oracle imported its arguments from the code under
  test.** Pointing the gait pass at the torso instead of the boot left BOTH
  declared-vs-measured tests green, because both sides shifted together. The
  oracle takes literals now.
- **It returned an empty array, and every caller looped over it.**
  `measureFacing`'s head-joint pattern matched nothing on any single-figure
  rig, so all four civilian meshes passed every assertion vacuously, in zero
  milliseconds. Not a wrong answer — an absent one, which is worse, because
  nothing looks wrong.
- **It measured one file.** `mesh_gait.test.ts` gated `mortar_team` alone, the
  file the bug was raised against, while fourteen sliding rigs shipped green
  beside it.
- **It measured one plane.** The facing gate read the ground-plane bearing
  only, so a rifle pointed 43° at the sky read as correct.
- **It measured a team and not its members.** A per-FILE gait check cannot see
  one figure of three going still while the other two walk.
- **It was a comment.** `export_meshy_sniper.py` stated that its declared
  standing height and its measured one "are asserted to agree at build time".
  No such assertion had ever been written — and behind it the exporter was
  anchoring on its own previous output, a fixed 1.02489 gain per export:
  1.670 m → 1.753 → 1.796, a sniper pair 7.5% taller than every other
  infantryman in the game, on a passing gate.

Two corollaries. **A green gate is evidence about the gate, not about the
thing it guards, until someone has watched it go red** — so a new gate arrives
with its falsification in the commit message or it does not arrive. And **the
cheapest falsification is a one-line mutation of the implementation, not a
synthetic fixture**: 31 mutations across three files, 30 red, is what "this
gate works" looked like in practice here, and the one survivor was disclosed
rather than papered over.

---
