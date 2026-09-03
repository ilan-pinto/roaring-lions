# Meshy prompts — the Ashwar Front

GH-155, Ashwar half. Five units: `militia_cell`, `rpg_team`, `mortar_crew`,
`charge_squad`, `digger_crew`. (`paramotor` is the sixth Ashwar unit and its
Meshy source already ships — `art/blend/enemy/paramotor/`.)

## Read this before generating anything

**Four prompts, not five, and no new figure.** The lead's instruction was to
reuse the supplied Sarim irregular where possible, and the codebase says that
reaches further than it sounds: `tools/units/teams.py` already dresses **every**
irregular team — Ashwar and Sarim alike — in the identical costume
(`headgear="keffiyeh", loadout="irregular"`). `sarim_rifles`' own docstring
states what separates two irregular teams, and it is not the clothes:

> *Militia Cell, crew 6. Two figures in a touching pair … Held to two and kept
> tight so it reads lighter than the rifle squad's spread three — **the helmet
> difference is worth about two pixels and cannot carry this**.*

`militia_cell` is two figures in a tight pair; `sarim_rifles` is three in a
diagonal echelon. That separation is **figure count and arrangement**, decided
in the export script, not in Meshy. So:

- **`militia_cell` needs no Meshy art at all.** It is the shipped
  `sarim_rifles.glb` figure, re-exported as a tight pair of two at the
  offsets `teams.py` already uses — `(0.0, -0.24)` and `(0.12, 0.26)`.
- The other four teams are **the same figure plus one piece of gear**. Only the
  gear is new, and that is what the four prompts below are for.

**Why the gear must be its own file, unrigged.** The figure carries the rig;
the prop gets parented to a hand or shoulder bone at export, exactly as
`kit.launcher`/`kit.mortar` place a tube relative to a figure today. A prop
with its own skeleton fights the figure's.

**The one gap reuse does not close, and it is a clip gap, not a model gap.**
The supplied irregular ships seven clips, all of them **standing**
(`Idle_02`, `Walking`, `Running`, `Side_Shot`, `Walk_Forward_While_Shooting`,
and two falls). A deployed mortar crew kneels; so does an RPG loader and a man
digging. `import_meshy_mortar_team.py` had to hand-author all five clips
because its source had no rig at all, and its docstring records the cost:
*"All five clips are synthesized. Their quality is a function of authoring
effort alone."* The cheap fix is **prompt 5** — more clips on the character you
already have, not a new character.

**Roles are a closed set of ten** (`packages/render/src/three/units/mesh-role.ts`):
`uniform`, `webbing`, `boot`, `face`, `skin_shadow`, `metal`, `weapon`, `wood`,
`charge`, `keffiyeh`. A part named outside that list gets no colour. Note the
vocabulary already anticipates this batch: `wood` for an RPG heat shield and a
spade handle, `charge` for a suicide vest.

**Numbers to approve before generating.** Every dimension below is lifted from
what `kit.py` ships today, so a Meshy prop drops into the same slot the palette
box occupies now. Change them here rather than after a generation.

| Prop | Dimension in the shipped kit |
|---|---|
| RPG-7 tube | 1.24 m long, 0.075 m radius, bell 0.18 m at 0.128 m radius, carried at 1.46 m, 38° up |
| 82 mm mortar | tube 0.76 m; baseplate 0.34 × 0.34 × 0.06 m |
| Suicide vest | front and back panels on the chest; satchel 0.26 × 0.18 × 0.20 m |
| Spoil heap | three mounds, radius 0.45 / 0.28 / 0.20 m |

**Every prompt must also ask for**, because each one has cost a bug before: no
ground slab or base plinth, no baked shadows, no figure or hands included,
separable named parts, real-world metre scale, long axis along **+X** with
**+Z** up, and a single base-colour bake with no metallic/roughness or normal
map (there are no lights in this scene to consume them).

---

# REVISION, 2026-09-03 — what building the RPG team changed

Everything above was written before a single prompt had been through the
pipeline. One has now, and it invalidates the document's central assumption.
The prompts below the line still describe real objects; what changed is
**which of them should be a prop at all**, and what a figure prompt must say.

## 1. The biggest change: ask for the FIGURE HOLDING THE THING, not the thing

The original plan was one rigged figure plus a prop per team, parented at
export. That is what prompt 1 produced, and the prop itself came out well —
a clean RPG-7, 985k verts down to 8.8k, correct roles. Attaching it is where
it fell apart, over three separate rounds:

- The launcher **floated**, because a prop's pose has to be invented. Placing
  it took a measured shoulder surface, a bore axis, an outboard offset and a
  slide along its own axis — four numbers, each wrong at least once.
- The hands **closed on nothing**, so the arms had to be IK-solved onto grip
  anchors measured out of the prop's own geometry.
- Solving the arms **swung the figure's own fused rifle** into a horizontal
  bar across its chest, which forced cutting the rifle out of a supplied asset.
- The result still read as a weapon resting against a man rather than held by
  him, because the underlying pose was a walk cycle.

The project lead then supplied a **fighter generated holding the RPG**, in two
postures, and every one of those problems disappeared at once. No attachment,
no grip solve, no pose invention: the weapon is in the hands because Meshy put
it there.

**So: a weapon a figure CARRIES should be generated as part of that figure.**
Prompt 1 (RPG), prompt 2 (mortar) and prompt 4's tools were all written the
wrong way round. What genuinely stays a prop is scenery a figure does not
hold — spoil heaps, an ammunition crate, fences, a deployed tripod nobody is
touching.

## 2. Ask for the rigged export, not only the textured blend

Meshy's `..._biped.zip` carries a **19,339-vertex** rigged character with the
24-bone skeleton this pipeline already retargets, plus one clip per file. The
`image-to-3d-texture.blend` beside it is the same character at **966k-971k
vertices with no skeleton at all**. The rigged export is the shippable one and
needs no decimation; the hi-res blend is a source, and for a figure it is
mostly a detour. Always ask for both, and expect to use the rig.

## 3. Name the idle by BEHAVIOUR, because Meshy's idle was a backflip

The supplied clip set was Walking, Running, Backflip, and Fall_Dead. Measured
Hips travel (x100): Walking 34.6, Running 31.5 (in place, net 0.001),
Backflip 242.1 with 78.9 of vertical, Fall_Dead 265.1 with **136.3 of net
travel**. There was no idle and no firing clip in it at all.

A clip request must therefore describe the BODY, never the mood:

> "An idle: the fighter stands still, weight settled, feet planted, breathing
> and small weight shifts only. **No acrobatics — no flip, cartwheel,
> handspring or jump.** The hips must not travel: near-zero root motion."

The same discipline the contract already applies to `fire` ("stand-and-shoot,
feet planted, the body recoils and the root does not move") is what stops
`Side_Shot`-class mistakes, and it is exactly what was missing for `idle`.

## 4. Ask for the postures as SEPARATE GENERATIONS of the same character

Meshy would not animate a kneeling firing pose on the biped, but it generated
a **crouching fighter** as its own model, and that is the right shape: one
rigged standing character for `move`/`down`, one posed crouching character for
`idle`/`fire`. The project lead's instruction — "when shooting the unit should
be in crouch mode also when idle not shooting" — is a posture request, and
postures come as models here, not as clips.

Two cautions, both measured. The two generations' 4K bakes compare as
**different** by tone statistics (mean RGB 0.439/0.376/0.317 against
0.512/0.428/0.362, histogram intersection 0.66) while looking like plainly the
same man side by side — that metric compares whole atlases, including the
unused space a different UV layout moves around, so **do not trust it and do
look**. And ask for both postures in one session against the same character so
the man does not change between clips.

## 5. Drop "separable named parts" for figures; keep it for props

The ten-role vocabulary exists so the runtime can repaint a mesh from the
palette. A figure that ships its own bake never takes that path —
`buildBuildingMeshTemplate` reaches the texture branch before it ever asks
about roles. Asking a photogrammetry figure for named role parts buys nothing
and constrains the generation for no reason. Props that will be palette-painted
still need it.

## 6. State the texture budget

The supplied bake is **4096x4096**, and exporting it unchanged wrote a
**22,404 KiB** GLB for one unit — against a 55 MB library total, and against
every textured building here shipping a JPEG of 520-660 KiB. Downscaled to
1024 and re-encoded it lands near 174 KiB. The figure is drawn at roughly 30
px. Nothing is asked of Meshy here; it is a note so the next person does not
ship 22 MB by accident.

## 7. What a figure prompt should now contain

1. The character, described concretely (costume, gear, condition).
2. **The weapon in their hands**, described as held, not as an object beside them.
3. Two postures, same character, one session: **standing (rigged)** and
   **crouching/kneeling in the firing position (posed)**.
4. Clips on the rigged one, each named by body behaviour with its root-motion
   constraint stated: walk, run, **a still idle with no acrobatics**, a
   stand-and-shoot with the feet planted, and a death that ends where it began.
5. No ground slab, no baked shadows, no plinth.
6. Real-world scale in metres.
7. Both the `_biped.zip` rigged export and the textured blend.


---

## Prompt 1 — RPG-7 launcher (`rpg_team`)  
> **Superseded** by the figure-holding-the-weapon approach above — kept because the prop itself exported cleanly and the numbers in it are good reference.


> A single RPG-7 rocket-propelled grenade launcher, weapon only, no hands and no
> figure. One straight steel firing tube 1.24 metres long and 7.5 centimetres in
> radius, widening to a flared conical blast bell 18 centimetres long and 12.8
> centimetres in radius at the rear. A laminated wooden heat shield wraps the
> middle third of the tube, its grain visible and its lacquer worn. A pistol
> grip with a trigger guard hangs below the shield, a second forward grip ahead
> of it, and a small folding iron sight and optical sight bracket sit on top. A
> PG-7 rocket grenade is loaded at the front: a teardrop warhead 9 centimetres
> across on a thin stem, protruding 30 centimetres beyond the muzzle. Battered
> field condition — scratched paint, bare metal at the edges, dust in the
> recesses. Separate, named parts: `tube_weapon`, `bell_weapon`,
> `shield_wood`, `grip_wood`, `sight_metal`, `warhead_weapon`. Modelled with the
> bore along +X, muzzle toward +X, +Z up. No ground plane, no stand, no baked
> shadow, no character. Single base-colour texture, no metallic or normal maps.
> Real-world scale in metres.

**Why these parts:** `shield_wood`/`grip_wood` are the only reason the RPG reads
as an RPG and not a pipe at 25 px — the wood ramp is a different hue family from
`weapon`'s gunmetal. `warhead_weapon` separate so the export can hide it on the
post-firing frames if that ever matters.

---

## Prompt 2 — 82 mm mortar, deployed (`mortar_crew`)

> A single 82-millimetre infantry mortar, deployed and ready to fire, weapon
> only, no crew and no figures. A smooth-bore steel barrel 76 centimetres long
> and 9 centimetres in diameter, elevated steeply at about 74 degrees, seated in
> a square steel baseplate 34 by 34 centimetres and 6 centimetres thick. A
> two-legged bipod of thin steel tubing braces the barrel about two thirds of
> the way up, with a traversing screw and elevation crank between the legs and
> small spade feet at the bottom. A simple sight unit clamps to the left of the
> barrel. Beside it, an open wooden ammunition crate 50 by 30 by 25 centimetres
> with three finned 82 mm bombs standing upright inside, and one loose bomb lying
> on its side. Improvised field weapon: mismatched paint, rust bloom at the
> welds, dented plate. Separate, named parts: `barrel_weapon`, `plate_metal`,
> `bipod_metal`, `crank_metal`, `sight_metal`, `crate_wood`, `bombs_weapon`.
> Modelled with the bipod legs opening toward +X, +Z up. No ground plane beyond
> the baseplate itself, no baked shadow, no character. Single base-colour
> texture, no metallic or normal maps. Real-world scale in metres.

**Why a crate is in the prompt:** the KDF mortar tableau's open ammunition case
is what reads as *deployed* rather than *carried* from the game camera — it is
the silhouette's widest element and it sits on the ground where the shadow pass
can find it. `bombs_weapon` is one part, not four; nothing needs them
individually.

---

## Prompt 3 — Suicide vest and satchel charge (`charge_squad`)

> An improvised explosive vest and a separate satchel charge, equipment only, no
> figure and no body. The vest is a canvas load-bearing harness with front and
> back panels, each panel holding four cylindrical explosive blocks 12
> centimetres long and 5 centimetres in diameter in stitched fabric pockets,
> wired together with visible red and black detonator cord running up to a
> simple toggle switch taped to the left shoulder strap. Shoulder straps and a
> waist belt with a buckle. Beside it, a closed canvas satchel bag 26 by 18 by 20
> centimetres with a flap, a long shoulder sling, and a short length of the same
> wire emerging from under the flap. Worn, dirty canvas in dull olive and grey;
> tape and wire crudely applied by hand. Separate, named parts:
> `vest_front_charge`, `vest_back_charge`, `straps_webbing`, `wire_charge`,
> `switch_metal`, `satchel_webbing`, `sling_webbing`. Vest modelled as if worn on
> an upright torso, chest facing +X, +Z up, but with no body present — panels
> hollow on the inside. No ground plane, no baked shadow, no character. Single
> base-colour texture, no metallic or normal maps. Real-world scale in metres.

**Why hollow panels and no body:** the vest is parented onto the irregular's
own chest at export, the way `kit.py` attaches `chg{i}_vest_f`/`_vest_b` today.
A prop generated around a torso brings that torso's surface with it and
z-fights the figure's chest. `charge` is a real role in the closed set, and it
is the one role that exists so an explosive reads as an explosive rather than as
webbing.

---

## Prompt 4 — Digging kit and spoil (`digger_crew`)

> Improvised tunnelling tools and a heap of excavated spoil, no figures. A
> long-handled digging spade with a 95-centimetre wooden shaft, worn smooth, and
> a squared steel blade 22 centimetres across with a chipped, bright edge; a
> mattock with a 70-centimetre shaft and a two-ended steel head; and a galvanised
> bucket 28 centimetres tall with a wire handle and a coil of rope beside it.
> Separately, three loose mounds of dry excavated earth and rubble — the largest
> 90 centimetres across and 35 centimetres high, then 56 centimetres, then 40
> centimetres — each an irregular pile of fine dusty soil mixed with broken
> stone, chalky limestone chips and a few shards of concrete, steeper on one
> side as if tipped from a bucket. Everything dust-coated and site-worn.
> Separate, named parts: `spade_wood`, `spade_blade_metal`, `mattock_wood`,
> `mattock_head_metal`, `bucket_metal`, `rope_webbing`, `heap_large_uniform`,
> `heap_mid_uniform`, `heap_small_uniform`. Tools laid with their shafts along
> +X, +Z up; the three heaps as three separate objects, not merged. No ground
> plane under the heaps, no baked shadow, no character. Single base-colour
> texture, no metallic or normal maps. Real-world scale in metres.

**Why the heaps are separate objects:** `teams.py` scatters them at three
different offsets (`dig_heap`, `_b`, `_c`) and the surface they sit on is
interpolated ground since `c38f770` — a merged spoil mesh would float at one
corner on any slope. Their role is `uniform` rather than a new earth role
because the closed ten has no soil entry, and `uniform`'s Ashwar ramp is the
nearest dusty-olive family; **flag this one for the lead** — if spoil reads
wrong on screen, the honest fix is a palette exemption for the heaps like the
ditch got, not a role invented off-table.

---

## Prompt 5 — More clips on the character you already have (no new model)

Not a text-to-3D prompt. In Meshy, open the existing rigged character
(`Meshy_AI_irregular_fighter_rig_biped`, the source of `sarim_rifles.glb`) and
generate these additional animations on **that same rig**, exported the same way
the seven you already supplied were — one `*_withSkin.glb` per clip, 24-joint
skeleton, identical joint names:

| Wanted | Serves | Must satisfy |
|---|---|---|
| **Kneeling idle** — one knee down, weapon held, still | mortar/RPG/ATGM crew `idle` | root travel near zero |
| **Kneeling load** — reaching forward and up, as if feeding a round into a tube above | crew `fire` | **root travel near zero**, and the figure's height must not change |
| **Standing fire** — shouldered weapon, recoil, feet planted | every team's `fire` | **root travel near zero** |
| **Digging** — bent at the waist, repeated downward stroke | `digger_crew` `work` | root travel near zero |

**The one requirement that has already cost this project twice.** The contract
gates every clip on how far the Hips travel, and two supplied clips have been
mis-mapped onto `fire` and rejected. `Side_Shot` measured 14.14 (×100 Hips
travel) against idle's 0.955 — it is a **hit reaction**, not a firing pose. And
`Walk_Forward_While_Shooting` measured 5.53, real gait travel, so it is
disqualified from `fire` too, however much it sounds like the right clip. A
`fire` clip must be **stand-and-shoot with the feet planted**: the body recoils,
the root does not move. Say so explicitly when asking Meshy for it.

Similarly, do not expect a fall clip to serve `down` — both supplied falls carry
370–414 cm of root motion and the build gate refuses them. `down` is
synthesised as a held pose from `idle`'s last frame, and that already works.

---

## What lands where, once the four props exist

| Unit | Meshy art needed | Export |
|---|---|---|
| `militia_cell` | **none** — reuses `sarim_rifles.glb`'s figure | 2 figures, tight pair at `(0.0, -0.24)` / `(0.12, 0.26)` |
| `rpg_team` | Prompt 1 | 2 figures + tube on the gunner's shoulder |
| `mortar_crew` | Prompt 2 (+ kneeling clips) | 3 figures + deployed mortar |
| `charge_squad` | Prompt 3 | 2 figures + vest on each, satchel on one |
| `digger_crew` | Prompt 4 (+ digging clip) | 1 figure + tools + 3 heaps |

**One thing to measure, not assume.** `pnpm validate:meshes` fails any two
meshes whose silhouettes read as the same unit (IoU above 0.88), and it has
caught an exact-copy collision before at IoU 1.000. Five Ashwar teams built from
one figure is precisely the shape that gate exists to catch — `militia_cell`
against `sarim_rifles` most of all, since both are keffiyeh riflemen and only
count and spacing separate them. Run the gate after the first two land, before
building the rest; if a pair collides, the lever is arrangement, exactly as
`sarim_rifles`' docstring describes.

**Open decision, the lead's to make.** Infantry never received the textured
exemption that `house`/`apartment`/`warehouse` have, so `sarim_rifles.glb` today
ships **zero materials** and is painted from the palette ramp at runtime — the
supplied bake is on disk and unused. These four props inherit that: they will be
palette-painted unless the lead extends the exemption to figures and their gear.
A photographed uniform may read very differently at 25 px than a building facade
does at 200, which is why it is a decision rather than an oversight. Tracked in
the task queue.
