# Meshy prompts and numbers tables — wounded and rescue (GH-707 P2)

**GH-707 (with GH-709 #7) · P2 content · 2026-10-22 · draft for the lead's go, nothing sent.**
Sibling of `meshy-prompts-e5.md` and `meshy-prompts-units.md`, written to the same rule:
every number below is approved **before any Meshy call**, every prompt is the style
bible's §5 template with its slots filled, and the credits come from
`pnpm meshy -- estimate` (local, no API call: `text` 20, `refine --tex 2k` 10,
`refine --tex 8k` 15, `remesh` 5, checked 2026-10-22). Design:
`docs/superpowers/specs/2026-10-22-wounded-rescue-design.md` §0 ruling 4, §4, §7, §8;
`docs/superpowers/specs/2026-10-22-special-units-design.md` §1.7 and §4 "Medical markings".

Three Meshy models, nothing else. The ambulance (`ifv_namer` + a Blender roof kit), the
medevac (`heli_yanshuf` + a Blender hoist boom) and the `wounded_kdf`/`wounded_sarim`
prone figures (`kit.py`, as the death figures today) are 0 credits and have no prompt here.

**Two house rules shape every prompt below.** (1) **No protected or real medical
emblem**: no Red Cross, Red Crescent, Red Crystal, Star of Life or Magen David Adom star
(Geneva Conventions; the ruling in the special-units design §4/Q12). The medical marking
is a plain WHITE band, beside the team colour, and the team colour is never baked: it is
applied at runtime. (Note: the wounded-rescue spec §8 still says "star-of-life band or
plain panel"; that line predates the ruling and is not followed.) (2) **The refine paints
emblems it was told not to** (the D9's white star, the Yanshuf's star and stripe on each
flank, `export_meshy_yanshuf.py`), and "medic" is the strongest red-cross cue there is.
So no prompt here says "medic" or "medical", the figure's refine carries a
`--texture-prompt`, and the importer scrubs any red-hue texel on the band islands to white
(a `scrub_red` beside the vehicles' `scrub_white`), 0 credits.

## The credit plan, against the 120-150 approved (ruling 4)

| model | class (bible §4) | steps | planned | ceiling (one re-roll) |
|---|---|---|---|---|
| `inf_medic_squad` figure | figure team, textured, no bought rig | preview 20 → judge → refine 2k 10 → remesh 5 | **35** | **55** |
| stretcher prop | crew/team part, **palette** | preview 20 → judge → remesh 5 | **25** | **45** |
| `kdf_aid_post` tent | field-works building, **palette** | preview 20 → judge → remesh 5 | **25** | **45** |
| | | **total** | **85** (~$1.70) | **145** (~$2.90) |

**Why the ceiling is +20 and not +35.** Every preview is judged BEFORE anything else is
spent on it: the figure's refine is a separate `refine <preview-id>` call (B7's command,
`style-bible.md` §14), and the two palette models have no refine at all. A re-roll is
therefore one more preview (20), and the bad preview's refine or remesh is never bought.
A second remesh at a different polycount (5) fits the slack: 145 + 5 = 150.

**Why 85 and not the spec's ~120.** The spec priced the medic at ~65 (two rolls with a
refine each) and the tent at ~30 (with a refine). Measured since: a figure team is 35, not
40 (no Meshy rig, bible §9), a re-roll is caught at the preview (20, not 30), and the tent
is palette-painted like every KDF field work (Q11 of GH-277: `kdf_medic_station` was
preview + remesh, 25), so it takes no refine.

**The 8k option.** The lead's standing "maximum detail" rule (bible §4, 2 Oct) reads
`--tex 8k` (15) for a refine. The brief for this batch says 2k, the latest textured
figure teams (B0b, E5) and the Yanshuf (18 Oct) were 2k, and a figure ships its bake at
1024 (B8: an 8k source buys "a sharper 2048, not a bigger file"). Taking 8k on the one
refine here costs +5: **90 planned, 150 ceiling**, still inside the approval. The lead
picks; the commands below show 2k.

**Hard rules.** One preview per concept; a re-roll is a new spend with its own
announcement and go. Every call is announced with its estimate first; `--yes` is only for
a run the lead has already approved. Every spend lands in `art/meshy/ledger.jsonl`.

## Order

1. Stretcher first (25): the cheapest, and its measured length and handle positions set
   the medic team's `carry` spacing.
2. Medic figure: preview (20), judged at 64 px against `at_team` and `demo_squad` through
   `render_mesh_gate.py`'s rig before the refine (the Yanshuf's method: its preview read
   0.481 against the Peten before the refine was paid for); then refine (10), remesh (5).
3. Aid post tent: preview (20), judged against `kdf_medic_station`; then remesh (5).
4. Blender (0 credits): the importer, the stretcher grafted into the team file, the tent's
   exporter with its wreck and construction states, the gates, provenance.

---

## 1. `inf_medic_squad` — Medic Squad (KDF, two figures drawn)

| item | number | source |
|---|---|---|
| class | figure team, textured, **35** credits (preview 20 + refine 2k 10 + remesh 5; no Meshy rig) | bible §4, §9 |
| base figure | **one** Meshy A-pose KDF figure, cut twice into `rig.py` parts (the B0b/B5 method; `at_team` was two copies of one preview) | bible §5 |
| height | **1.78 m**, the KDF rifleman reference; the folded stretcher's top at ~2.08 m | bible §1 |
| remesh `--polycount` | **2,000** per figure. Budget, two standing men: 2 × (2,000 + ~340 blobs) + 2 posed corpses × ~1,000 + 2 kit carbines × ~90 + the open stretcher 600 ≈ **7,460**, under the **8,000** file cap (`breach_team`'s sum, same cut, read ~7,100). This assumes `treat` is the motion pass's kneel (as `at_team`'s gunner kneels on the sim's brace since 6 Oct), not a third body per figure; a `yahalom_squad`-style `work` body would put the file near 11,900, and then 1,500 per figure (~9,400) is the number | bible §3, §9, §14 |
| bake | **yes**: ask 2048, ship 1024 JPEG q85 on `uniform`/`boot`/`face`; `inf_medic_squad` in `TEXTURED_INFANTRY_TYPES` and `TEXTURED_INFANTRY_EXEMPT`, same commit | B0b |
| white band | painted by the refine (prompt + `--texture-prompt`). If it does not arrive, the importer fills the helmet-band, left-arm and pack-flap UV islands with white texels (one material kept), 0 credits. Any red-hue texel on those islands is scrubbed to white either way | §0 of this doc |
| weapon: held, not slung, and NOT in the Meshy figure | a compact carbine is **kit geometry** (`rig._weapon_parts`, barrel shortened in Blender), held at low ready at the right hand through the crew importer's `_rifle_at_hand` with the forearms bent to it (`FORE_BEND`, `inf_squad`/`breach_team`'s cut), riding `{prefix}_weapon` so the motion pass's hold IK's both arms onto it and `fire` has a gun. **Why not in the prompt:** a weapon in the hands comes back welded across the chest (B7: "rifleman" and "sniper" beat "A-pose" both times, nine of twenty-one previews), which forces `ARMS_ON_TORSO` and kills the hung arms the `carry` clip needs on the stretcher handles. **Why not slung:** a baked slung carbine cannot fire, and the team would draw two guns per man (the Zikit's reason). In `carry`, `drag` and `treat` the weapon bone is keyed to a slung seat on the back, 0 credits | bible §14, `import_meshy_crew_team.py`, CLAUDE.md "The motion pass" |
| the folded stretcher | generated ON the figure, standing upright against the pack, top ~0.30 m above the helmet. The importer cuts it as its own rigid part on `spine` (a new `PART_BONE` suffix; `rig.py` raises on an unmapped part and that guard stays), so `carry` can hide the rear man's bundle while the open stretcher (section 2) is shown | `rig.py` |
| clips | `idle, move, moveFire, fire, down, wreck` (rig.py) + `treat` (kneel), `drag` (backwards, hands at a collar), `carry` (two-man stretcher, the hung arms at the handles at ~0.75 m) — design §7. Then `motion:meshes` → `gait:meshes` → `encode:meshes`, in that order | design §7, special-units §4 |
| footprint | rest: within ±1.2 m, feet at z = 0, `+X` forward (e.g. `at_team`'s anchors (0.24, −0.30) / (−0.32, 0.34)). **`carry` does not fit it**: a 2.2 m litter puts the two men about ±1.35 m apart on X. Flagged below | bible §2 |
| nearest neighbours | **`at_team`** (two standing KDF men, a box-shaped tan rucksack: the boxy pack alone is NOT a lever), **`demo_squad`** (two standing men, a cable-spool disc on the back), then `breach_team` (two standing riflemen and a shield plate; its back pole was removed 7 Oct), `recon_zikit` (a boxy radio pack, three men, a whip at 80°) and `inf_squad` | `teams.py`, E5 §2 |
| the lever | **the upright stretcher bundle standing a head-height clear of the helmet on both men**: no KDF team carries anything above its own helmet line except the Zikit's thin whip (which the gate barely reads) and `at_team`'s Spike, which lies along the shoulder at cheek height. Second lever: two carbines at low ready, no launcher, no binoculars. The white bands are not a lever (1-2 px at gameplay zoom) | |
| gate pose | `render_mesh_gate.py` renders frame 0 of `idle`, where the open stretcher is scaled to 0: put that part's origin inside the team's footprint so its collapsed point does not stretch the framed bounds (the vehicle `death_root` trap the gate's own comment names) | `render_mesh_gate.py` |

**From the lead's draft to this prompt.** "Combat medic" became "stretcher-bearer" (the
role, with no emblem cue). "Team-color markings" are gone (runtime only) and "high-contrast
white" became plain white bands. "Holding a compact carbine at low ready" moved to kit (above).
"Rolled stretchers attached to the top" became ONE folded stretcher standing upright, because
that is what clears the helmet line and a two-man team carries one litter. "So it reads
clearly from a 2:1 dimetric camera" was dropped: camera words are not geometry (the
Yanshuf's lesson). The template's closing sentence names crosses and emblems and says
"other markings", because the bands are a marking the prompt does ask for.

```
A single low-poly game-ready stretcher-bearer, a soldier of a fictional army in a plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain olive cover. Standing in a relaxed A-pose, arms slightly away from the body, hands empty. A large boxy trauma backpack with side pouches, and a folded stretcher strapped upright to it, poles bundled in rolled canvas, its top 30 centimetres above the helmet; plain white bands round the helmet and the left upper arm, a plain white flap on the pack top. Real-world scale, 1.78 metres tall. Olive drab cloth, black webbing, tan canvas. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, crosses, emblems, text or other markings.
```

796 characters (CLI cap 800). Negative (preview only; 179 characters):

```
red cross, crescent, star, emblem, symbol, logo, patch, flag, text, letters, numbers, rifle, gun, carbine, weapon in hands, holding anything, kneeling, sitting, base, ground plane
```

Texture prompt (refine only; 327 characters):

```
Plain olive-drab uniform and helmet cover, black webbing, tan canvas backpack and stretcher bundle, tan boots, dusty and worn. The helmet band, the left arm band and the pack's top flap are plain solid white cloth with nothing printed on them. No red anywhere, no crosses, no emblems, no symbols, no text, no flags, no patches.
```

Calls, each announced with its estimate and run only on the lead's go:

```bash
pnpm meshy -- estimate text            # 20
pnpm meshy -- text "<prompt>" --pose a-pose --negative "<negative>" --name inf_medic_squad --yes
# judge the preview (below); then
pnpm meshy -- estimate refine --tex 2k # 10
pnpm meshy -- refine <preview-id> --tex 2k --texture-prompt "<texture prompt>" --name inf_medic_squad --yes
pnpm meshy -- estimate remesh          # 5
pnpm meshy -- remesh <refine-id> --polycount 2000 --name inf_medic_squad --yes
```

`MESHY_DRY_RUN=1` first prints each body (it must show `"pose_mode": "a-pose"` and the
`negative_prompt`) and spends nothing.

**Check in the preview before refining:** the stretcher bundle is a separate upright mass
standing clear above the helmet and not flattened into the pack (it is the lever: if it is
missing or lies flat, that is the one re-roll); the A-pose held with empty hands (a gun
across the chest is NOT a re-roll, the crew importer copes, but say so before the refine);
no cross or emblem modelled in relief; then the 64 px IoU against `at_team` and
`demo_squad` through the gate's rig, recorded before the 10 credits are spent.

---

## 2. The stretcher prop — open folding litter (KDF, part of the medic team)

| item | number | source |
|---|---|---|
| class | **palette** part, **25** credits (preview 20 + remesh 5, no refine) | bible §4 |
| real size | **2.2 m × 0.55 m**, bed ~0.15 m off the ground on its stirrups; scaled uniformly to the measured pole length in Blender | the brief |
| remesh `--polycount` | **600** (the crew-weapon cap: two poles, a bed, two spreader bars, four stirrups, four grips). Measured budget: the team file at ~7,460 of 8,000 with it (section 1). §3's prop lesson applies: thin members collapse under plain decimation, so the remesh sits at the target and Blender trims at most ~10% | bible §3 |
| roles | poles, spreaders, stirrups → `metal` (gunmetal); canvas bed → `wood` (dust 3-6: a tan bed against olive men, and faction-blind, so an enemy wounded carried on it still reads); grips stay `metal`. Zero materials | `mesh-role.ts` |
| where it is drawn | (a) inside `inf_medic_squad.glb`, on the team's `prop` bone, shown only in `carry` (scaled 0 elsewhere), the handles at the two men's hung hands; (b) lying on the ground beside `kdf_aid_post`, re-roled to the building set (`metal`, `wood`) at export; (c) optionally racked inside the ambulance kit (a palette part in a textured vehicle is legal by the per-mesh rule). The `wounded_*` figure's `carried` clip lies at bed height and draws no stretcher of its own | design §7 |
| why palette, not textured | it is drawn ~30 × 8 px at gameplay zoom, so a bake resolves nothing; a **palette** mesh drops into the textured team GLB by the per-MESH rule (B0b: textured figure + palette kit weapons, one GLB) with no atlas work, while a textured part would need B8's 2048×1024 atlas in every textured host and would be illegal in the zero-material building and wounded files without a new exemption; and it is 25, not 35. One source serves three hosts | bible §9, §15 |
| IoU | not a gated mesh of its own (no standalone GLB); scaled to 0 in the team's `idle`, which the gate renders. It is judged as part of the aid post's silhouette only if (b) is taken | `render_mesh_gate.py` |

```
A single low-poly game-ready military folding litter, field equipment of a fictional army in plain matte olive-drab canvas with dark gunmetal fittings, clean and military. Lying open and empty, flat and level. Two long straight carrying poles ending in short handle grips at both ends, a taut canvas bed stretched between them, a folding steel spreader bar under the bed near each end, and four short steel stirrup feet under the poles holding it a hand's width off the ground. Real-world scale, 2.2 metres long and 0.55 metres wide. Olive canvas, gunmetal steel, black rubber grips. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, crosses, emblems, text or markings of any kind.
```

767 characters. "Litter" over "stretcher" in the subject, because "stretcher" invites a hospital
gurney; the faction line is the KDF machine line with "paint" → "canvas" (there is no
equipment line). Negative (141 characters):

```
person, patient, body, blanket, pillow, wheels, castors, trolley, gurney, hospital bed, tall legs, folded, rolled up, red cross, emblem, text
```

```bash
pnpm meshy -- estimate text            # 20
pnpm meshy -- text "<prompt>" --negative "<negative>" --name medic_stretcher --yes
pnpm meshy -- estimate remesh          # 5
pnpm meshy -- remesh <preview-id> --polycount 600 --name medic_stretcher --yes
```

**Check in the preview before remeshing:** open, empty and flat (no body, no wheels, no
frame bed on legs); the two poles run straight past the bed at both ends so there are
handles for the hands to close on; the stirrups are short. A gurney or a rolled litter is
the re-roll.

---

## 3. `kdf_aid_post` — KDF field aid post (2×3 field work)

| item | number | source |
|---|---|---|
| class | field-works building, **palette**, **25** credits (preview 20 + remesh 5), as `kdf_medic_station` (GH-277 Q11: KDF works palette-painted) | `meshy-prompts-buildings.md` "Field works" |
| footprint | **2×3 tiles, 6 × 9 m**, one storey; crown **3.0 m** (the station's ridge is 3.2), side walls ~1.6 m; the body ~4.8 m wide so the porch fits inside 6 m | design §4 |
| remesh `--polycount` → cap | **6,000 → 8,000**. The field works sat at 3,000-4,000 for 2×2 (before the 2 Oct maximum-detail rule); this one is 1.5× the area, its arches need segments to read round, and guy ropes and stakes are exactly the thin members a low count drops. Palette building cap is 20,000 (bible §3) | bible §3 |
| roles | canvas → `wall` (the type's `color`, proposed `olive.1` like the station); frame hoops, porch posts, stakes → `metal`; crates → `wood`; the open doorway → a kit `glass` pane set in the porch opening (the station's `store_door` method), so `building_facing.py` can judge the front. Split by height band and position in `export_fw_works.py` as the other works | `export_fw_works.py` |
| front rule | the porch and its open flap face Blender `+X` or `−Y` (the two faces the camera sees); the exporter sets the yaw, so the long side carrying the porch is the camera-facing long side | buildings doc, field works rule (1) |
| white band (optional) | if the lead wants the medical marking on the tent, it is a Blender kit strip across the porch gable in the `dome` role (`limestone.1`, the palest building role: off-white, not pure white; a building role set has no white). Not asked of Meshy: a palette mesh carries no paint | `building-mesh-role.ts` |
| nearest neighbours | **`kdf_medic_station`** (2×2, a hip-roof tent pushed to the rear plus a store container, sandbag skirt and drums), `warehouse` (gable ends with roller doors, square plan), `militia_field_clinic` (masonry hut + canvas annex + sandbag ring), `camp` (5×5 ring with a command tent), `kdf_workshop` (open canopy), `shanty` (mono-pitch shed) | buildings doc |
| the lever | **a curved roof line** (no shipped building has one: hip, gable, mono-pitch, flat), **the 1:1.5 plan** (the gate frames each render to its own bounds, so only proportion and outline separate buildings), and **the porch knob on one long side**, which breaks the barrel's symmetry. If Meshy returns a straight ridge instead of an arch, it still differs from the station's hip roof and is kept; a square or hip-roofed tent is the re-roll | buildings doc, rule (2) |
| wreck (Blender, 0 credits) | **the frame hoops fold and the canvas lies flat over the crates; ONE arched hoop at the far gable end stays standing with a torn flap hanging from it; the porch is down** — a long low heap with a single arch, against the station wreck's tipped container | field-works wrecks |
| construction (Blender, 0 credits) | the standing mesh bisected at 45% (low walls and arch stubs) + the shared scaffold/pallet/spoil kit, as the other KDF works | field-works construction states |
| catalogue | `HELD_MESH_FILES` until the `kdf_aid_post` structure lands in the same P2 change, then `BUILDING_MESHES` | `mesh-catalogue.ts` |

The structure faction line is copied verbatim from the field works, "tan sandbags" included
(the rule is "copied, never paraphrased"); a low skirt, if one arrives, does not touch the
outline. "Facing forward" becomes "porch facing forward", the field works' form.

```
A single low-poly game-ready military field aid tent, a field work of a fictional army in plain matte olive-drab canvas and paint with dark gunmetal fittings and tan sandbags, clean and military. One long modular shelter with a rounded arched roof over curved frame hoops, low side walls, flat closed ends, and a small gabled entrance porch with its flap rolled up, jutting from the middle of one long side. Guy ropes to ground stakes along both long sides, stacked wooden supply crates by the porch. Long footprint about 6 by 9 metres, roof 3 metres high at the crown. Olive canvas, gunmetal frame, tan crates. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, porch facing forward. No insignia, flags, crosses, crescents, text or markings of any kind.
```

794 characters. Negative (134 characters):

```
pyramid roof, hip roof, square tent, shipping container, sandbag wall, flag, red cross, crescent, star, emblem, text, people, vehicles
```

```bash
pnpm meshy -- estimate text            # 20
pnpm meshy -- text "<prompt>" --negative "<negative>" --name kdf_aid_post --yes
pnpm meshy -- estimate remesh          # 5
pnpm meshy -- remesh <preview-id> --polycount 6000 --name kdf_aid_post_remesh --yes
```

The remesh name follows the field works' ledger (`kdf_medic_station` / `_remesh`), so
`export_fw_works.py`'s `meshy_dir("kdf-aid-post-remesh")` finds it.

**Check in the preview before remeshing:** a long plan (not square), a roof that is not a
hip or pyramid, the porch on a LONG side; then its 64 px silhouette against
`kdf_medic_station` through the gate's rig. The container the station's prompt asked for
never generated, so expect props to be dropped: missing crates or stakes are Blender kit
pieces, not a re-roll.

---

## Gates and provenance

Per model: `git status art/meshes/` first (strangers' scratch GLBs fail the gate),
`pnpm validate:meshes` (roles, palette, IoU < 0.88 against every mesh, the tent's facing),
`pnpm encode:meshes` then `-- --check`, the team's `motion:meshes` → `gait:meshes` →
`encode:meshes` order, `pnpm test`, `pnpm typecheck`, `pnpm lint`. Then the look at zoom 1
and 2.5 in `?sandbox`, with the bands checked for any red at 2.5. Provenance: preview,
refine and remesh task ids in `docs/ASSET_PROVENANCE.md`; AI-generated art disclosed in
the PR (CONTRIBUTING.md).

## For the lead

1. **The `carry` footprint.** A 2.2 m litter carried end to end puts the two men about
   ±1.35 m apart, past the bible's ±1.2 m team footprint. Options: allow it for `carry`
   only (the rule was written for the rest pose), carry a shorter 2.0 m litter, or carry
   it slightly diagonal. Recommendation: allow it for `carry`.
2. **2k or 8k on the one refine** (+5, still inside the approval either way).
3. **The white band on the tent**: off-white `dome` strip on the porch, or no marking on
   the building. Recommendation: the strip, so the post reads as medical beside the
   station.
