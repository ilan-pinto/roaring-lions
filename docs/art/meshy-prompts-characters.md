# Meshy prompts — the named characters

The five people the campaign names (`docs/campaign/storyline.md` §2): the two
voices of the HUD, **Shai Hammai** and **Idit Zohar**, and the three villains,
**Nadir Sahim** (Marj, file SPADE), **Karim Adhal** (Sur, file LANTERN) and
**Jubran Hallaq** (Naharin, file FERRY). Sibling of `meshy-prompts-ashwar.md`,
and it follows that document's revision of 2026-09-03: figures, not props;
the figure holding its thing; clips named by body behaviour; the rigged
`_biped.zip` AND the textured blend.

## Read this before generating anything

**Where each figure goes — the placeholders that exist today.**

| figure | where the player meets them | the placeholder | file to produce |
|---|---|---|---|
| Shai Hammai | every mission: the commander bar's plate and beats; the deploy screen header | `.rl-cmd__face`, the hatched 60 × 60 frame beside the plate (`packages/app/src/ui/theme.css:827` — *"when it lands, the background is the only line that changes"*); the deploy screen's 512 × 640 portrait panel is specced (`2026-08-21-commander-brief-design.md`) and not built | `assets/ui/portraits/shai_hammai.png` |
| Idit Zohar | every `say` line with `speaker: idit` — the bar shows plate **ZOHAR** | the same frame; it needs one small lookup, speaker → portrait, which does not exist yet (`render-vfx`, an afternoon) | `assets/ui/portraits/idit_zohar.png` |
| Nadir Sahim | named in Beit Sahwan III–IV's briefings and objective labels; stands at the shaft head in IV as `bs4_hvt_spade` | none today — the enemy is deliberately never given a face on the bar; his portrait is for the debrief and the radio overlay when those land (storyline §7 G11, the overlay art) | `assets/ui/portraits/nadir_sahim.png` |
| Karim Adhal | one unnamed `enemy` line in Umm Zeitoun IV; `uz_hvt_lantern` on the crest | same as Sahim | `assets/ui/portraits/karim_adhal.png` |
| Jubran Hallaq | Wadi Halam V, *"whoever is holding the gate"* (`wh_gate_rpg`) | same as Sahim | `assets/ui/portraits/jubran_hallaq.png` |

Three consequences worth stating before a single generation:

- **One generation serves two placeholders.** Each character is generated once
  as a full rigged figure, in the same form the Ashwar prompts ask for. The
  portrait is a **render** of that figure (chest-up, three-quarter turn, eyes to
  camera, 512 × 640), so the same asset can stand on the map later. Today no
  villain has his own mesh on the map — `bs4_hvt_spade` draws as the
  `militia_cell` figure, because a placement cannot name a mesh (engine gap,
  small; recorded in `docs/campaign/tel_marum/design.md` §7). Shai and Idit never
  stand on the map: the player *is* their force.
- **Portraits are UI art and are not palette-gated.** `assets/ui/` has no gate
  (`docs/ASSET_PROVENANCE.md`), so a photographed texture ships as-is here the
  way the textured buildings do. The figure GLB, if it ever goes on the map,
  meets the open decision at the end of the Ashwar document (infantry have no
  textured exemption yet).
- **Rank is not baked into Shai.** He is a Captain in Act I, a Major in Act II,
  a Lieutenant Colonel in Act III and a Colonel at the end (storyline §2.1); the
  plate carries the rank in text and the KDF's own insignia is stars on a plain
  khaki slip. The figure wears the slip **blank**. Nothing on any of these
  figures may resemble a real army's insignia, flag, patch or headgear pattern
  (GDD §2, `CONTRIBUTING.md`).

**Numbers to approve before generating.** Change them here, not after a
generation.

| item | number | why |
|---|---|---|
| figure height | Shai 1.78 m · Idit 1.66 m · Sahim 1.70 m · Adhal 1.74 m · Hallaq 1.72 m | real-world scale, as every figure prompt asks |
| portrait source | 512 × 640 PNG, 4:5 | the commander-brief spec's number; scales to the 60 px frame and to the 200 × 250 deploy panel |
| portrait framing | chest-up, three-quarter turn toward camera-left, eyes to camera, flat overcast light, plain dark backdrop | the spec's framing; a plain backdrop composites onto the panel colours |
| texture bake | ask for 2048; ship 1024 | the supplied 4096 bake wrote 22 MB for one figure (`meshy-prompts-ashwar.md` §6) |
| portrait file size | ≤ 150 KiB | the menu banner is 74 KiB; nothing in `assets/ui` should dwarf it |
| age reads | Shai 31 · Idit 28 · Sahim mid-fifties · Adhal mid-forties · Hallaq late thirties | Shai's is canon; the others are proposals |

## The KDF character — put this in both KDF prompts

Repeat verbatim at the top of the Shai and Idit prompts, the way the Ashwar
document repeats its shared fighter. It matches the supplied KDF soldier
(`art/blend/KDF/soldier/`, a Meshy image-to-3D) and the kit's own tactical
helmet, and it names nothing real:

> A Kedem Defense Forces officer of a fictional army: plain olive-drab field
> uniform, sleeves rolled to the forearm, dust in every crease; a black nylon
> plate carrier with two magazine pouches and a radio handset clipped at the
> left shoulder; a blank khaki cloth slip stitched on the chest with nothing on
> it; tan suede combat boots; no patches, no flags, no badges, no insignia of
> any kind. A modern tactical helmet with a plain olive cover, carried under
> the arm rather than worn, so the face is fully visible.

## Every figure prompt asks for the same five things

Repeat these too — they are what the pipeline enforces
(`meshy-prompts-ashwar.md`, "Every figure prompt asks for the same five things"):

> Deliver BOTH the rigged biped export (the `_biped.zip`, humanoid skeleton, one
> animation per file) AND the textured model. Real-world scale in metres. No
> ground plane, no base, no plinth, no baked shadows, no separate stand.
> Anything the figure carries is modelled IN THE FIGURE'S HANDS or on the body,
> not as a separate object. Single base-colour texture; no metallic, roughness
> or normal maps.

And the clips, by body behaviour, with the root-motion rule:

> Animations: **Walking** (normal gait). An **Idle** in which the figure simply
> stands still, weight settled, feet planted, with only breathing and small
> weight shifts — no acrobatics of any kind: no flip, no cartwheel, no jump; the
> hips must barely move. A **Talking** idle: the same stance, the head turning
> slightly and one hand gesturing low, feet planted. A **death** that falls and
> comes to rest close to where it started.

The portrait is then rendered from the figure, not generated separately — see
"The portrait render" at the end.

---

## Prompt 1 — Shai Hammai (`shai_hammai`)

> *[the KDF character paragraph]*
>
> He is Shai Hammai, thirty-one, a company commander six years in, competent and
> unremarkable until the morning the perimeter went: lean, average height,
> close-cropped dark hair, three days of stubble, a dust-lined face with tired,
> steady eyes and a mouth that does not smile. A thin healed cut above the left
> eyebrow. He holds a folded field map in his right hand, down at his side, and
> the helmet under his left arm. Posture: standing square, weight even, the
> stance of a man who has been awake for two days and is not going to say so.
>
> *[the five things]* *[the clips]*
>
> Figure height 1.78 m. Ask for a 2048 base-colour bake.

**Why the map and not a weapon.** His half of a briefing is the plan and the
cost. A rifle in his hands makes him a rifleman; the map makes him the man the
plate names. The helmet under the arm keeps the face clear for the portrait
and reads as "off the line, for a minute".

## Prompt 2 — Idit Zohar (`idit_zohar`)

> *[the KDF character paragraph]*
>
> She is Idit Zohar, twenty-eight, an intelligence officer: dark hair tied back
> tight, an attentive, unhurried face with sharp eyes, no make-up, a small scar
> on the chin; a radio headset pushed down around her neck with the boom mic
> swung aside; a clear plastic map case slung across the chest on a strap and a
> marker pen clipped to the carrier; a small notebook in the chest pocket. She
> holds a handset to her ear with the left hand and the map case's edge with the
> right. Posture: standing, half-turned as if listening to two things at once.
>
> *[the five things]* *[the clips]*
>
> Figure height 1.66 m. Ask for a 2048 base-colour bake.

**Why the headset and the handset.** She spent First Light reading the attack
off a radio net and a wall. Everything she says on the bar is the picture and
its confidence; the gear says that before a word does.

## The Ashwar character — Sahim's faction look

Sahim must read as one of the Ashwar fighters the other document is producing,
or the front reads as two armies. Repeat the Ashwar shared paragraph verbatim
(`meshy-prompts-ashwar.md`, "The shared character"), then the one change a
portrait needs — the face uncovered.

## Prompt 3 — Nadir Sahim, file SPADE (`nadir_sahim`)

> *[the Ashwar shared-character paragraph, verbatim]* — except that the
> keffiyeh is worn open and pushed back off the head onto the shoulders, so the
> face is fully visible.
>
> He is Nadir Sahim, in his mid-fifties, the man who spent years digging under
> a town before the war reached it: a heavy, weathered face with a short grey
> beard, deep lines, calm and patient eyes, hands and forearms grey with tunnel
> dust ground into the skin; a small miner's headlamp on an elastic band worn
> above the brow, switched off; a short-handled entrenching spade slung across
> the back on a cord; a hand-cranked field telephone in a canvas case on a
> shoulder strap. He holds a coil of detonation wire in his right hand, loosely.
> No rifle. Posture: standing at ease, slightly stooped, the stance of a man
> used to low ceilings.
>
> *[the five things]* *[the clips]*
>
> Figure height 1.70 m. Ask for a 2048 base-colour bake.

**Why no rifle.** He is the digger. His weapon is under the player's feet, and
a figure holding a rifle is another militiaman. The headlamp and the spade are
the only two objects the campaign ever attributes to him.

## The Sarim character — Adhal's faction look

The Sarim Brigades are the best-trained front and the one that holds ground
properly (`docs/superpowers/specs/2026-08-23-sarim-roster-design.md`). The
supplied Sarim irregular (`art/blend/enemy/Sarim irregular/`) is a leaner,
better-equipped fighter than the Ashwar militia. Describe Adhal against that:
mountain kit, not robes.

## Prompt 4 — Karim Adhal, file LANTERN (`karim_adhal`)

> A Sarim observer of a fictional mountain brigade: a dark-olive field jacket
> with the collar up over a grey wool sweater, grey cargo trousers tucked into
> laced mountain boots, a dark wool watch cap, a black chest rig carrying a
> handheld radio, a laser rangefinder in a pouch and a folded map; no patches,
> no flags, no badges, no insignia of any kind. He holds a pair of binoculars
> raised in both hands, half-lowered from the eyes as if he has just seen what
> he was looking for. A small brass oil lantern, unlit, hangs from the pack
> strap at his hip.
>
> He is Karim Adhal, mid-forties, the eyes the batteries fire on: a narrow,
> wind-burned face, close grey-flecked beard, steady grey eyes, a thin mouth;
> the composure of a man who has stood on cold rock for a week and would stand
> another. Posture: standing on the balls of the feet, leaning slightly into
> the wind, feet apart for balance.
>
> *[the five things]* *[the clips]*
>
> Figure height 1.74 m. Ask for a 2048 base-colour bake.

**Why the lantern.** It is Idit's file name for him, and the one object the
player is told he has: a light seen on a hill at night, before any rocket. It
is unlit in the portrait on purpose.

## Prompt 5 — Jubran Hallaq, file FERRY (`jubran_hallaq`)

> A Rif logistician of a fictional river-basin cell, dressed for a truck rather
> than a fight: an oil-stained tan mechanic's jacket over a loose grey shirt,
> brown cargo trousers, worn leather driving boots, dust goggles pushed up onto
> a faded blue head scarf, a canvas money belt at the waist, a ring of keys on a
> cord, a ledger book in a plastic sleeve in the chest pocket; a pistol in a
> hip holster and no rifle; no patches, no flags, no badges, no insignia of any
> kind. He holds a clipboard against his chest with the left hand and a
> two-way radio in the right.
>
> He is Jubran Hallaq, late thirties, the smuggler whose road fed both other
> fronts: a round, quick face with a short dark beard, alert eyes, an easy
> half-smile; the manner of a man who counts things. Posture: standing with the
> weight on one leg, relaxed, one boot on a raised step, as if leaning on a
> tailgate.
>
> *[the five things]* *[the clips]*
>
> Figure height 1.72 m. Ask for a 2048 base-colour bake.

**Why the clipboard.** He is a logistician with guns, not a commander: the
depot is his, the gate is his, and the shipped objective text already names him
without naming him — *"Kill or capture whoever is holding the gate."*

---

## The portrait render

The portrait is rendered from the delivered figure, once per character, by
`blender-art`:

| item | value |
|---|---|
| camera | 50 mm, eye height, three-quarter from camera-left, framing chest-up with the head in the upper third |
| light | one large soft key from camera-left at 80 W, a 20 W fill, exposure −0.3 EV; no rim, no coloured light. The first pass at 220 / 55 / 0 double-lit the bake and read blown out; the bake is already a lit photograph, so the lights only add form |
| backdrop | plain, dark, uniform — `--panel` composites over it |
| output | 512 × 640 PNG, sRGB, ≤ 150 KiB, `assets/ui/portraits/<id>.png` |
| pose | the **Idle** clip's first frame; for Adhal the binoculars half-lowered |

This is a new small script beside `tools/render_rig.py` — the locked dimetric
rig cannot frame a face — and it is the one piece of tooling this document
needs. The shipped `portrait.ts` stand-in (facing-3 idle sprite frames, GH-153)
stays for units; these five are people, not units.

## What lands where

| character | Meshy output | portrait | map |
|---|---|---|---|
| Shai Hammai | **delivered 2026-09-04** as `art/blend/KDF/Shai Hammi/` — the textured remesh only (5,147 verts, 2048 bake), no rigged `_biped.zip` yet | **rendered and wired 2026-09-04**: `assets/ui/portraits/shai_hammai.png` (56 KiB) shows on the commander bar and the deploy panel (`tools/render_portrait.py`) | never on the map |
| Idit Zohar | **delivered 2026-09-04** as `art/blend/KDF/idit zohar/` — a concept image approved against the brief, then its image-to-3D blend (170 MB, unremeshed; no rig) | **rendered and wired 2026-09-04**: `assets/ui/portraits/idit_zohar.png` (50 KiB) shows on the bar on her lines | never on the map |
| Nadir Sahim | `art/blend/enemy/nadir_sahim/` | `assets/ui/portraits/nadir_sahim.png` → debrief / overlay, when built | `bs4_hvt_spade`, once a placement can name a mesh |
| Karim Adhal | `art/blend/enemy/karim_adhal/` | `assets/ui/portraits/karim_adhal.png` | `uz_hvt_lantern` |
| Jubran Hallaq | `art/blend/enemy/jubran_hallaq/` | `assets/ui/portraits/jubran_hallaq.png` | `wh_gate_rpg` |

**Disclosure.** Every one of these is AI-generated art and the PR that ships
any of them says so (`CONTRIBUTING.md`). Everything under `assets/` is CC BY-SA
4.0; Meshy's terms must grant redistribution for the output, which is the same
bar the buildings already cleared.

**Open decisions, the lead's.** Idit's, Sahim's, Adhal's and Hallaq's ages and
faces above are proposals. Whether a villain ever gets his own mesh on the map
is an engine call (a `mesh` field on a placement). Whether Shai's portrait
changes with rank — four renders of one figure with a different number of
stars painted on the slip — is cheap once the first render exists and is
deliberately not asked for here.
