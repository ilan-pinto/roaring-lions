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

## GH-826 step 2 (hands): checks that could not have caught what they were written for

- **`mesh_hold.test.ts`'s `measureHold` read "a hand" as the far tenth of the FOREARM bone's vertices and passed anything within
  0.1 m of the weapon.** With hands on their own bones, with 0.268 m forearms, it still read 0.03 m: green while the hand was a
  fist-width off its grip, and blind to a hand that was on its station at two keys and 7 cm off between them. `measureGrip`
  reads the hand bone's posed vertices, between keys, against stations carried onto the weapon by a Horn fit against the part's
  own bytes; the gate was run on a figure with the weapon moved 4 cm and with a hand turned 40 degrees, and both go red.
- **A station literal that was the solver's own other point.** The first support-station literal (the handguard's UNDERSIDE) read
  0.040 m in every clip: the solver put the palm's axis point on the handguard's AXIS. The constant offset was the tell; an
  instrument that agrees with the solver to 0.000 m everywhere is as suspect as one that disagrees by a constant.
- **A reading that stayed at 0.000 m through a 100 degree forearm flip.** The solver's own "worst grip gap" is taken at the keys;
  between two keys the IK had turned the forearm 100 to 180 degrees (the shortest arc is ill-conditioned when a short upper arm
  folds the forearm back on itself). Found only by sampling at 60 Hz between keys and by a per-key rotation-step census
  (`mesh_arm_pops.test.ts`), which carries a constructed failing input (one key turned 150 degrees) and, since 1 Nov, a rate limit
  with no named exemption: HEAD's own bytes read 16,014 deg/s in `kneelIn`, and the gate is red on them.
- **A weapon-axis gate that read the carbine's SHAPE as its aim.** `measureWeaponAxis` takes the first principal component of
  the weapon's vertices; the raked grip and the magazine drag it 5.87 degrees above the bore, in every clip. The pinned idle
  literal (-30) went red by 5.87, which looked like a hold that had moved; the bore had not. The bias is now a literal checked
  against the part's own bytes (`pcaElevationDeg`), so a re-shaped carbine cannot move it unnoticed.
- **Contact and depth read three ways, three answers.** Palm-side contact by VERTICES reads 10-29%, by AREA 25-36%; the generator's
  hull census read weapon-in-hand 2.1-2.8 mm where the glove's real triangles read 1.0-8.8. The spec names vertices; the lead
  approved the area figure at R0c. The gate says which it reads (area) and reports the other; the 3 mm depth limit is NOT met by the
  instrument that reads the mesh, and the test says so instead of passing a ceiling it did not earn.

- **A depth gate that sampled each triangle's first vertex and centre.** `measureGrip` read the weapon inside the glove from two points of
  every weapon triangle; the handguard's triangles run 100 mm and more, so the support fingers were never sampled. It read 2.0 mm where the
  real depth was 9.0, in every clip, from the first commit, and the PR said "3 mm met". The Opus re-review found it with a dense sampler
  (the same bytes, read both ways, are now a test: `sparseWeaponSamples`). It measured one plane of a surface, not its members.
- **A seam nothing read.** The arm-pop gate read key to key inside a clip; a looping clip also plays its last key into its first, and
  `moveFire`'s support arm turned 38 degrees there while every in-clip step passed. The gate now reads the wrap in world space.
- **A census with one direction.** `inf_kit_clash.py` counted BODY vertices inside a kit part. The EUD is a 3 mm trimmed pad: the firing
  hand's knuckles went through it and out the back, and the parity test (an even count) saw nothing for the whole of kneel and pinned. It now
  also counts the kit's vertices inside the glove.
