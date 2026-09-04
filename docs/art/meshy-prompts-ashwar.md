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

## The shared character — put this in every figure prompt

The RPG fighter Meshy has already produced is now the Ashwar look, and the
other teams must match it or the faction reads as four different armies.
Repeat this description verbatim at the top of each figure prompt below:

> A Levantine irregular fighter: loose tan cotton robes over baggy trousers,
> worn and dust-stained, with a patched knee; a white-and-grey checkered
> keffiyeh wrapped over the head and across the face so only the eyes show; a
> black nylon chest rig with four magazine pouches and webbing straps; black
> fingerless gloves; scuffed brown leather boots.

## Every figure prompt asks for the same five things

Repeat these too. They are the requirements the pipeline actually enforces:

> Deliver BOTH the rigged biped export (the `_biped.zip`, humanoid skeleton,
> one animation per file) AND the textured model. Real-world scale in metres,
> a figure about 1.7 m tall. No ground plane, no base, no plinth, no baked
> shadows, no separate stand. The weapon or tool is modelled IN THE FIGURE'S
> HANDS, not as a separate object.

And ask for the clips by BODY BEHAVIOUR, with the root-motion rule stated —
this is the part Meshy gets wrong when left to interpret a mood:

> Animations: **Walking** and **Running** (normal gaits). An **Idle** in which
> the fighter simply stands still, weight settled, feet planted, with only
> breathing and small weight shifts — **no acrobatics of any kind: no flip, no
> cartwheel, no handspring, no jump**; the hips must barely move. A **firing**
> animation in which the feet stay planted and only the upper body recoils —
> the hips must not travel. A **death** that falls and comes to rest close to
> where it started.

---

## Prompt 1 — RPG fighter (`rpg_team`) — **DELIVERED**

Supplied 2026-09-03 as `art/blend/enemy/RPG team/`: a standing rigged biped
(19,339 verts, Walking / Running / Backflip / Fall_Dead) plus a separately
generated crouching firing posture. This is the prompt every one below copies
its shape from. What it still lacks is a **still idle** and a **stand-and-shoot**
— the two clips section 3 of the revision explains how to ask for.

---

## Prompt 2 — Mortar crew fighter (`mortar_crew`)

Two generations of one character.

> **[shared character description]**
>
> **Standing:** the fighter carries a disassembled 82-millimetre mortar — the
> 76-centimetre steel barrel shouldered and steadied with one hand, a folded
> steel bipod slung across his back, the square baseplate hanging at his hip on
> a strap. Both hands are on the load.
>
> **Kneeling:** the same fighter on one knee at a deployed 82-millimetre
> mortar, both hands raised over the muzzle in the act of dropping a finned
> bomb down the tube, head turned away from the blast. The mortar is part of
> this model: barrel elevated about 74 degrees, square steel baseplate 34 by 34
> centimetres bedded on the ground, thin steel bipod with a traversing screw
> and spade feet. An open wooden ammunition crate sits beside his knee with
> three finned bombs standing in it. Improvised weapon — mismatched paint, rust
> at the welds, a dented plate.
>
> **[shared five requirements]** · **[shared clip list]**

**Why the crate is in the figure and not a prop:** it is the widest thing in
the silhouette and it sits on the ground beside the man, so it reads as
*deployed*. Generated with him, it never needs placing.

---

## Prompt 3 — Heavy-rig fighter (`charge_squad`)

`charge_squad` is "Suicide Squad" in the data — `abilities: ["kamikaze"]`, and
a `vest` weapon of type `demolition` at 1.1 tiles with 420 damage and 0.85
collateral risk. So the thing being modelled is a suicide vest, and `charge`
sits in the closed ten-role vocabulary for exactly this.

**The prompt below never says so, and that is deliberate.** A 3D generator
asked in plain terms for an improvised explosive vest with detonator cord and a
firing switch is very likely to decline, and a refusal costs a generation to
discover. Everything that reads at gameplay size is silhouette — bulky chest
panels, cabling, a satchel at the hip — and none of it needs the words that
trip a filter. Ask for the shape; the unit's meaning is carried by
`data/units/enemy/charge_squad.json`, not by the prompt.

Two generations of one character. This is the one team whose "weapon" is worn
rather than held, so the standing figure already carries everything.

> **[shared character description]**, and over the chest rig a bulky
> load-bearing harness: front and back canvas panels, each holding four
> cylindrical grey canisters 12 centimetres long and 5 centimetres across in
> stitched fabric pockets, linked by red and black electrical cabling that runs
> up to a small taped switch box on the left shoulder strap. A closed canvas
> satchel 26 by 18 by 20 centimetres hangs from a long sling at his hip, with a
> short length of the same cabling emerging from under its flap. His hands are
> empty and open at his sides — no rifle, no launcher, nothing carried.
>
> **Crouching:** the same fighter low to the ground in a sprinter's crouch, one
> hand on the ground and the other closed around the shoulder switch box, head
> up and looking forward.
>
> **[shared five requirements]** · **[shared clip list]**, and additionally a
> **Sprinting** animation — a flat-out run, faster and lower than the normal
> run, arms driving.

**Why the hands are explicitly empty:** the supplied irregular has a rifle
fused into its right hand that had to be cut out by vertex weight after the
fact. Asking for empty hands up front is cheaper than removing a weapon later.

**Name the parts for the palette anyway**, unusually for a figure prompt: ask
for the panels and cabling as `vest_front_charge`, `vest_back_charge`,
`wire_charge`, `switch_metal`, `satchel_webbing`. If this figure ends up
palette-painted rather than shipping its bake, `charge` is the one role that
makes an explosive read as an explosive rather than as webbing, and it is
cheap to have and impossible to add later without re-exporting.

---

## Prompt 4 — Digging fighter (`digger_crew`)

Two generations of one character.

> **[shared character description]**
>
> **Standing:** the fighter carries a long-handled digging spade over one
> shoulder — a 95-centimetre wooden shaft worn smooth, a squared steel blade 22
> centimetres across with a chipped bright edge — held with both hands, and a
> galvanised bucket with a wire handle in the other hand.
>
> **Working:** the same fighter bent at the waist mid-stroke, both hands low on
> the spade shaft, driving the blade into the ground; a mattock with a
> 70-centimetre shaft lies beside his feet.
>
> **[shared five requirements]** · **[shared clip list]**, and additionally a
> **Digging** animation on the standing rig: bent at the waist, a repeated
> downward stroke, feet planted and the hips barely travelling.

**Note the extra clip.** `digger_crew` is the one Ashwar team whose sim state
reaches `work` (`resolveClip` returns it when `tunnelChargeProgress > 0`), so
a digging animation is not decoration here — it is a clip the runtime will
actually ask for and currently cannot get.

---

## Prompt 5 — The two things that are still genuinely props

Only what nobody holds. Both are palette-painted rather than textured, so
these two keep the "separable named parts" requirement that the figure prompts
drop.

> **Excavated spoil, for a tunnel mouth.** Three separate loose mounds of dry
> earth and rubble — the largest 90 centimetres across and 35 high, then 56,
> then 40 — each an irregular pile of fine dusty soil mixed with broken stone,
> chalky limestone chips and a few shards of concrete, steeper on one side as
> if tipped from a bucket. Three separate objects, not merged, named
> `heap_large_uniform`, `heap_mid_uniform`, `heap_small_uniform`. No ground
> plane beneath them, no baked shadow, no figure. Single base-colour texture,
> no metallic or normal maps. Real-world scale in metres.

**Why the heaps stay separate objects:** `teams.py` scatters them at three
different offsets, and the ground has been interpolated since `c38f770` — a
merged spoil mesh would float at one corner on any slope. Their role is
`uniform` because the closed ten has no soil entry; **flag this one** if it
reads wrong on screen, since the honest fix is a palette exemption like the
ditch's rather than a role invented off-table.

---

## What lands where

| Unit | Meshy art needed | Export |
|---|---|---|
| `militia_cell` | **none** — reuses `sarim_rifles.glb`'s figure | 2 figures, tight pair at `(0.0, -0.24)` / `(0.12, 0.26)` |
| `rpg_team` | **delivered** (prompt 1) | 2 figures, standing rig for `move`/`down`, crouch for `idle`/`fire` |
| `mortar_crew` | Prompt 2 | 3 figures; the mortar comes with the kneeling one |
| `charge_squad` | Prompt 3 | 2 figures, rig and satchel already on them |
| `digger_crew` | Prompt 4 + the spoil from prompt 5 | 1 figure + 3 heaps |

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
