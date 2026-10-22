# Special units Phase 8: the Chadaf Recon Robot (`ugv_recon_dog`): numbers and art spec

**Date:** 2026-10-22 · **Status:** waiting for the lead's art-numbers approval. Nothing is rendered and no Meshy
call is made until then. **Issue:** GH-709, unit 10. **Parent spec:**
`docs/superpowers/specs/2026-10-22-special-units-design.md` §1.10, §4 and §5 (Phase 8). **Base:** `origin/main` at
`8eeea195b`.

This is the last of the nine units. It is the only one that needs a new rig shape: every rigged unit in the repo is a
biped or a motorcycle.

## 1. Numbers

### 1.1 The staged JSON against the spec

The staged JSON is `docs/campaign/special_units/gh709/ugv_recon_dog.json`. Every field that §1.10 names matches it:

| field | §1.10 | staged |
|---|---|---|
| hp | 160 | 160 |
| speed | 1.3 tiles/s | 1.3 |
| sight / optics / thermal | 12 / 1.6 / yes | 12 / 1.6 / true |
| signature | 0.35 | 0.35 |
| abilities | `mark_target`, `mark_tunnel` | the same |
| suppression resistance | 1.0 | 1.0 |
| crew / population | 0 / 0 | 0 / 0 |
| weapons | none | `[]` |
| logistics / credits | 190 / 4,000 | 190 / 4,000 |
| domain | ground | absent, so the schema default `ground` applies |
| `wheeled` | false | false |

The staged file adds these fields, which §1.10 does not list: armour 6/6/6, turn rate 200°/s, build time 10 s,
`firing_signature_mult` 1.0 and `can_embark: true`. The first four are unremarkable for an unarmed light body.
`can_embark` is §2's question.

### 1.2 Probe 10 (re-run on this base)

Probe 10 is the tunnel claim: the first tick at which a `pre_dug` route is identified on the synthetic map. Re-run with
`special-units-probes.test.ts -t "probe 10"`. Both specs pass, and the readings are unchanged from Phase 1:

| carrier | first tick (s) |
|---|---|
| `recon_drone` | 92 (4.6) |
| **`ugv_recon_dog`** | **217 (10.9)** |
| `yahalom_squad` | 425 (21.3) |

**The claim is met.** The dog finds the route after the drone and before the yahalom squad. The bands are ±15%.

### 1.3 The cost curve, both passes (re-run on this base)

Both runs use `--units data/units --also docs/campaign/special_units/e5 --also docs/campaign/special_units/gh709`.
These are the same steps that CI runs.

| pass | curve | `ugv_recon_dog` (power, cost, fitted, residual) | tightest unit | gate |
|---|---|---|---|---|
| plain | `283.814 * power^0.481` (n=45) | 0.5, 190, 196, **-3.1%** | `attack_drone` +13.8% | passed, 45 within ±18% |
| max tier (`--max-tier --upgrade-cost-factor 0.02`) | `304.471 * power^0.481` (n=45) | 0.4, 190, 200, **-5.0%** | `heli_yanshuf` +15.0% | passed |

For comparison, `recon_drone` reads -2.0% and -5.3%. The dog carries no premium, as the spec intended: the curve reads
everything it is for (sight, speed, hull). Nothing moved since Phase 1, which read -3.2% and -5.1%; the last digit is
from Phase 7's re-fit.

**Numbers verdict:** no change is proposed. The JSON matches the spec, probe 10 is met, and the dog is inside the band
in both passes.

## 2. Open question: may it ride in transports (`can_embark`)?

**Recommendation: yes, keep `can_embark: true`.**

1. **The shipped rule requires it.** `tools/src/embark.test.ts` (GH-730) sweeps every shipped unit and says a ground
   unit rides if and only if it is on foot: `canEmbark === !wheeled`. The dog is ground and `wheeled: false`. The
   default `FOOT_ROLES.has('drone')` is false, which is why the field is in the JSON at all. Measured through
   `unitTypeFromJson` on the staged file:

   | `can_embark` | wheeled | canEmbark | the GH-730 sweep |
   |---|---|---|---|
   | `true` (staged) | false | true | **passes** |
   | `false` | false | false | **fails** |
   | absent | false | false | **fails** |

   Dropping the field would therefore need a named exemption in a sweep whose point is that it has none.
2. **It is a dismount in every mechanical sense.** It paths in the foot domain (boulders are open ground to it), and
   that is the whole of its value against the Shachaf. Its pathing, its terrain and its boarding all follow the same
   rule.
3. **It costs a seat, which is the right price.** `canSeat` counts units and not population, so a carried dog takes
   one seat that a squad could have used. Population 0 does not make it free to carry.
4. **It is what the real thing does.** Quadruped UGVs go forward in the rear of an APC and are let out at the alley
   mouth. It also gives the player the one pairing this unit begs for: a Namer drops the dog at the tunnel field.

Nothing else is needed. When the dog moves into `data/units/kdf/`, the existing sweep pins it automatically.

## 3. Art spec

### 3.1 What it is

The dog is a fictional four-legged recon robot. It is a box body on four two-segment legs, with a sensor head at the
front and a short whip antenna. It has no weapon and no markings. It wears dull olive paint with dark gunmetal joints and
black rubber feet. Team colour is not baked into the texture, as for every unit (the runtime ramp applies). It must not
copy a real product's shape or livery. In particular: no Spot-yellow, no Spot-style face cameras, no maker's form.

**Size (real scale, like every unit):**

| part | size |
|---|---|
| body | 0.95 m long × 0.36 m wide × 0.20 m deep |
| top of body | 0.62 m above the ground standing |
| legs (each) | upper 0.30 m, lower 0.30 m, foot pad Ø 0.07 m |
| sensor head | 0.16 m cube, front top |
| whip antenna | 0.35 m |
| overall | about 1.0 m long, 0.80 m tall to the antenna tip |

That is about a third of a tile long, and about half a rifleman's height. At zoom 1 it draws at roughly 10-12 px tall
against a soldier's 25 px. **Question A1** (§4) asks whether to keep real scale or add a presentation factor. The
recommendation is to keep real scale, as `recon_drone` does at 0.9 m: the selection ring, the icon and the plate do the
reading, and a dog-sized robot that reads as a pony would be wrong.

**Triangle budget: 4,000 target, 5,000 cap**, measured on the remesh. That is one infantry figure's worth (3,500-4,500
per figure in `at_team`, `sniper_team` and `sarim_rifles`). It is one skinned mesh, so one draw call (plus its shadow and
AO passes, like any rigged unit). The max-detail rule holds: simplify only down to this measured cap.

### 3.2 How to build a quadruped walker: three ways, one recommended

| option | how | credits | verdict |
|---|---|---|---|
| **R1. Meshy base model, rig authored in `rig.py` (recommended)** | Meshy text-to-3D for the body and legs in a standing pose. Blender cuts it into rigid parts, as the `moto_rpg` and Meshy-team importers do. Each part binds rigidly to a bespoke quadruped bone table in `rig.py`, with clips authored as Python tables. | 35 / 75 | **Recommended.** It follows the house rule (Meshy for the base model only, Blender for the rest), and it has the `moto_rpg` precedent (a bespoke topology with its own rest and clip builders). |
| R2. Meshy auto-rigging + animation API | Meshy rigs and animates the model itself. | +5 rigging, +3 per action (`pricing.ts`); no CLI command exists | **Rejected.** Meshy's auto-rigger is built for humanoid characters (its documented use; not tested here on a quadruped, and no credit was spent to find out). The house policy keeps Meshy to the base model, and its clips would bypass `rig.py`'s authored, measurable gaits. |
| R3. Blender primitives only (`kit.py` style) | Every part is a primitive. | 0 | **The fallback**, if the Meshy legs come out fused or wrongly posed and a re-roll fails too. A box-and-cylinder robot is honest kit geometry. It loses the bake's surface detail, but keeps the rig, the clips and every gate below. |

**Why rigid binding is exactly right here.** `kit.py`'s "no weight painting, one part to one bone" rule is a
simplification for a soldier. For a robot it is literally true: a robot's legs are rigid links with joints at their
ends. R1's skin is rigid binding, the same as every rig in the repo, with no new skinning technique.

**R1 pipeline:**

1. **Meshy** (prompt by an Opus agent at high effort, every call announced in a ledger first). Text preview (20) →
   refine at 2k (10) → remesh to 4,000 (5) = **35 planned**. The ceiling, **75**, allows one preview re-roll and a
   second remesh. The prompt asks for these, so that each leg is a separable piece:
   - legs straight, standing square;
   - a hand's width of daylight between the legs and under the body;
   - the head clear of the body.

   The known failure is `inf_medic_squad`'s, where Meshy dropped a requested part twice. If the legs fuse, they are
   rebuilt as kit parts on the Meshy body. That is the stretcher and trauma-pack precedent, and it costs no credit.
2. **`tools/units/import_meshy_dog.py`** (new; owner of `art/meshes/ugv_recon_dog.glb` in `rig.TEAM_MESH_OWNER`). It
   orients and scales the remesh, and finds the hips, knees and feet by measurement (`moto_rpg`'s island and centroid
   method, every number read off the remesh, never guessed). It cuts 14 rigid parts and binds each to its bone.
3. **`rig.py`**: `_dog_bone_table`, `_dog_rest` and `build_dog_clips`, a fifth topology beside `sniper_team` and
   `moto_rpg`. The bones are:
   - `dog_root` (the body);
   - `dog_head` (pan and tilt);
   - per leg, `dog_{fore,hind}_thigh_{L,R}`, `dog_{fore,hind}_lower_{L,R}` and `dog_{fore,hind}_foot_{L,R}`;
   - one `dog_death_root`.

   That is 15 bones. The knees fold rearward on all four legs: one consistent, readable robot convention, and not an
   animal's.

   **The names are chosen so that two shipped instruments work unchanged:**
   - `measurePlantedGround` matches `_foot_[LR]$`, so `dog_fore_foot_L` is read as a foot with no edit to
     `mesh_gait.ts`.
   - The lower leg is `_lower_` and not `_shin_`, so `motion/feet.ts`'s `shinPrefixes` does not graft a biped ankle
     onto it.
4. **The pass order is the rigged one**: export → `pnpm motion:meshes` → `pnpm gait:meshes` → `pnpm encode:meshes`.
   §3.4 lists what each pass needs.
5. `RIGGED_UNIT_MESHES` gets the dog (faction `kdf`). Then:
   - `mesh_roster.test.ts` (the team needs `down` or `wreck`);
   - the regenerated `unit-footprints.ts` tables (selection ring);
   - a Blender portrait (`render_unit_portraits.py`);
   - a garage plate (`pnpm plates:units --only=ugv_recon_dog`);
   - `pnpm validate:meshes`.

   **No runtime code is expected.** The rigged path already plays `idle`/`move`/`down`/`wreck`, and it rate-matches
   `move` through `rl_gait` (`gaitTimeScale`).

### 3.3 The clips

| clip | what | notes |
|---|---|---|
| `idle` | Standing. The sensor head pans ±25° on a slow cycle, the body sways about 1 cm, and the antenna does not move. | 32 frames, a loop. A robot does not breathe; the head pan is what says "alive". |
| `move` | **A trot**: diagonal pairs (FL+HR, FR+HL) alternate, with a short flight phase and the body level. The feet are solved by two-bone IK in `rig.py` onto **planted footpaths**: a foot in stance is fixed in world space, so the foot skate reads about 0 by construction rather than by later correction. | One cycle per clip. See the gait numbers below. |
| `down` | Collapsed: the legs folded under, the body on the ground and rolled about 20° onto one side, the head drooped. | A static frame, as for infantry. |
| `wreck` | The same pose as `down`, with one leg thrown out straight. | It stays on the field like every rigged wreck. It is not charred (that treatment is the vehicle path's). |

There is no `fire` or `moveFire`: it is unarmed. There is no `kneel` or `pinned`: `suppression_resistance` is 1.0, so
it is never pinned, and the runtime's `pinned` fallback already resolves to `idle` when no `kneel` clip exists
(`mesh-anim.ts`). There is no `fall`/`fallAlt`; the rigged topple-and-wreck path handles its death.

**Gait numbers, and the one flag in them.** The sim speed is 1.3 tiles/s, which is **3.9 m/s**. That is fast for a
0.6 m leg; a real robot of this size trots at about 1.5-3 m/s. That is the same truth as "every rifleman in this game is
already running" (CLAUDE.md, gait). The art answers it with a flying trot. These numbers are a design target, to be
measured after the build and never asserted:
- cycle 0.40 s (2.5 Hz, 5 diagonal footfalls a second);
- stride, the ground covered by the planted feet per cycle, about 1.56 m.

Played at sim speed, the rate-match multiplier then sits at about 1.0. A clip with a short stride would play too fast
and read as scurrying. **The speed is not proposed to change**; it is the probe's number.

### 3.4 Gait pass and motion pass: what breaks

Both passes and their gates were written for bipeds, and `moto_rpg` is the one non-biped precedent. Walked file by
file:

**`pnpm motion:meshes`** (`tools/src/meshes/motion/`):
- The dog gets the `moto_rpg` shape of entry in `MOTION_TEAMS`: `{ figures: [], hold: false, kneel: false, formation:
  false, stride: false, ground: true }`. The hold (weapon IK), kneel, formation, stride re-solve and carry do not apply,
  so they stay off, and nothing in them needs to learn about four legs.
- **`feet.ts`** adds biped ankles to every `*_shin_L/R` prefix. The dog's lower legs are named `_lower_`, so it is
  skipped, and the dog has its own foot bones. **If the bone were named `_shin_`, this pass would bolt a second ankle on
  each leg.** The bone names are load-bearing, and the spec pins them.
- **`ground.ts`**: with no figures, it treats the file as a rigid body (wheels and props). The dog's feet are planted
  at y = 0 by the IK, so the pass should find nothing to correct. The check is the existing gate "on the ground in the
  living clips". This needs proving on the bytes after the build; it is not assumed here.
- **Pins that move:** the grounded-team count goes from 22 to 23 (`mesh_gait.test.ts`), with a `GROUNDED_DRAWN` entry.

**`pnpm gait:meshes`** (`tools/src/meshes/gait-pass.ts`):
- It measures `measureRoleFootprint(file, 'boot', 'move')` on the dog's `boot` role (the four foot pads), then
  `measurePlantedGround` over every `_foot_[LR]` bone group.
- That function is not biped-specific. It weights every contact vertex near the ground and averages their backward
  speed, so 4 feet read the same way as 2 (`feet` = 4).
- `countTracePeaks` reads one foot's trace, which is one peak per cycle in a trot.
- **Expected: no code change.** The declaring-file count goes from 18 to 19.

**`tools/src/mesh_gait.test.ts`**, the sweeps over every rigged file. This is where the biped assumptions actually
live:

| gate | what happens to the dog | needed |
|---|---|---|
| cadence (`HUMAN_CADENCE`: 2.5-3.1 steps/s at 2-4 m/s) | A trot at 3.9 m/s steps at about 5/s and **fails the human band**. A human-cadence trot would need a 3 m stride on 0.6 m legs. | A **quadruped band**, from a stated source (a trotting animal's frequency at this leg length), keyed on a declared kind and never on the file name, and falsified (the trot played 1.8x reads red). |
| facing (head-to-face bearing) | It reads if the sensor head carries a `face` role. | Give the head a `face` role. Otherwise, a named `FACING_EXEMPT`. |
| weapon axis (PCA) | It is unarmed. | A named reason ("unarmed"), as other unarmed rigs have. |
| walk-and-fire | It is unarmed. | Named in the rest list. |
| upright in motion (hips ≥ fraction of standing height) | It reads the biped's hips. | Either read `dog_root`'s height in `move` against rest (a real check: the trot must not crouch), or a named exemption. **Recommended: the real check.** |
| per figure | One figure, root `dog_root`. | Whatever the figure count reads, extended. |
| foot skate oracle | It is generic over planted feet. | Should pass by construction. It is the gate that proves the IK. |
| below-ground census | Generic. | Should read 0. |

**The parent spec's named risk (a), "drone means air", was audited:**
- `role.ts`'s `roleBucket` puts it in the `drone` icon bucket. That is right for a robot.
- `engines.ts` gives a foot unit (`!wheeled`) no engine loop. A silent robot is acceptable in v1; a servo whine is a
  later sound item.
- `names.json` already has the gap that §4 of the parent spec records.

Nothing found assumes that a drone flies.

### 3.5 Silhouette (IoU ≤ 0.88 against every mesh)

| neighbour | risk | lever |
|---|---|---|
| `recon_drone` (box body, four arms, about 0.9-1.2 m) | **The highest.** Four limbs about a box, the same size class. | Vertical legs with a knee break, and the body standing 0.42 m off the ground. The drone's arms are flat and splayed, with no daylight under it. |
| `attack_drone` | Lower. | The same lever. |
| `moto_rpg` | Low. | It is longer and has riders. |
| civilians and the infantry figures | Low. | They are upright, 1.7 m against 0.8 m. |

The gate renders each mesh framed in its own view, so a size difference alone does not separate the dog from the
drone; the shape has to.

**The check:** `validate:meshes` on the first export. If the dog reads above about 0.80 against `recon_drone`, the
levers are, in order:
1. a taller stance;
2. a raised sensor mast;
3. a visible gap between the legs in the gate's view.

All three are Blender levers, at 0 credits.

### 3.6 Meshy credits

**This unit: 35 planned / 75 ceiling.** That is the parent spec's §4 row, unchanged.

**GH-709 so far.** This was read from every worktree's `art/meshy/ledger.jsonl`, de-duplicated by task id, at 13:29 on
22 Oct. Spending in other streams is still going on, so these are a snapshot.

| stream | consumed on disk |
|---|---|
| Te'o (`spg_long_range`) | 35 |
| medic (`inf_medic_squad`, 2 previews + refine + remesh) | 55 |
| NLOS launcher (2 previews + refine) | 50 |
| grenadier (preview; refine and remesh still to come) | 20 |
| **GH-709 total** | **160** |

The wounded stream's stretcher and aid post (GH-707) consumed 40 more, with one aid-post re-roll in flight (20). That
gives **200 consumed and 220 including the call in flight**, across both issues.

The coordinator's working figure of **about 280** is the conservative one: it counts the approved remainder of the
in-flight phases. Against the 600 ceiling, either figure leaves the dog's 75 with room: 600 − 280 − 75 = **245 to
spare**, even at the dog's ceiling.

### 3.7 Cost and effort for the rig work

These are agent-days at the house's pace, judged against the `moto_rpg` B6 batch, which was the last bespoke topology:

| item | estimate |
|---|---|
| Meshy prompt (Opus, high), preview judged, refine, remesh | 0.5 day, 35 credits |
| `import_meshy_dog.py`: orient, measure, cut 14 parts, bind | 1-1.5 days |
| `rig.py`: the bone table, the rest pose, the four clips, the trot IK on planted footpaths | 1.5-2 days |
| motion and gait entries, proving `ground.ts` on the bytes | 0.5 day |
| `mesh_gait.test.ts`: the quadruped cadence band with a falsification; facing, upright, the named weapon and walk-and-fire reasons; the pins that move (18→19, 22→23) | 1 day |
| catalogue, roster, footprints regeneration, portrait, plate, `validate:meshes`, the move from `gh709/` to `data/units/kdf/` with the staged-test mirror pin | 0.5-1 day |
| **Total** | **about 5-6.5 agent-days**, one PR (Phase 8 lands art and data together) |

The biggest risk is the Meshy legs. The fallback (kit legs on a Meshy body, or R3) costs about half a day more and no
credit. The second risk is the cadence band: it is new, and it must be derived from a source and not fitted to the
first export.

## 4. Questions for the lead

1. **`can_embark`.** *Recommendation: keep `true`* (§2). The shipped GH-730 sweep requires it, and it costs a seat.
2. **A1, scale.** *Recommendation: real scale* (about 1.0 m long, 0.62 m to the body top), as for every unit. The
   alternative is a presentation factor of about 1.2 for legibility at zoom 1.
3. **Approach.** *Recommendation: R1*, a Meshy base model with the rig and clips in `rig.py`, with R3 (Blender only) as
   the fallback.
4. **Credits.** *Recommendation: approve 35 planned / 75 ceiling*, with each call announced.
5. **Triangles.** *Recommendation: 4,000 target, 5,000 cap* on the remesh.
6. **Clips and gait.** *Recommendation:* `idle`/`move`/`down`/`wreck`, a flying trot of about 0.40 s and about 1.56 m
   as the design target, with a new quadruped cadence band in the gate, and the sim speed (1.3) unchanged.

## Amended 22 Oct: scaled 1.2x (the lead)

After the first screenshots the lead ruled A1 the other way: **the dog is 1.2x the real-scale table in §3.1** (voice
stays `air`). One named constant, `rig.DOG_SCALE = 1.2`, multiplies every length the rig and the importer derive;
angles, the 0.40 s cycle, the 120 fps keying and the sim speed are unchanged. New sizes: body 1.14 x 0.432 x 0.264 m,
body top 0.744 m, hip height 0.612 m (read 0.613 off the bytes), legs 0.36 + 0.36 m, foot pad 0.084 m, sensor head
0.192 m, antenna tip 1.02 m. Tris unchanged at 4,985 (3,923 living). The planted-foot sweep grows with the legs, but
the stride the legs describe stays tied to speed x cycle (1.56 m), so `rl_gait.move` reads 1.4960 m / 0.400 s (was
1.4592), multiplier 1.043 (was 1.07), and the cadence reads 5.21 steps/s against a recentred band of 3.35-5.24
(centre 4.19 at hip 0.612 m, was 4.76 and 3.81-5.95). It sits 0.6% inside the top of the band; a slower cycle is the
lever if the lead wants it more central, and it is not pulled here.
