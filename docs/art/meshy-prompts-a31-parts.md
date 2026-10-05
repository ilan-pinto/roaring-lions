# Meshy prompts and numbers tables — the A3.1 remainder (parts, drones, bike)

**WP-A3.1 (GH-179), batches C1–C4 of `a31-remaining.md` · 2026-10-05 · stage 1 of 2:
PREVIEWS ONLY, approved by the lead on 5 Oct at ~440 credits for the eleven items.**

Sibling of `meshy-prompts-units.md` (the unit bodies, B0–B8), `meshy-prompts-ashwar.md`,
`meshy-prompts-characters.md` and `meshy-prompts-buildings.md`. This one holds the
**parts** the audit `a31-remaining.md` §2 ranks: the hand weapons and launchers still
drawn by `kit.py` tubes on Meshy bodies, the three untextured drones, and the `moto_rpg`
bike. Every prompt is the style bible's §5 template with its slots filled, read under
the lead's standing rule of 2 Oct: **every model at maximum detail** — prompts name the
gear, the wear and the mechanism (never adjectives; polycount comes from the remesh),
the refine goes at `--tex 8k`, and simplification is only to a measured budget.

Two things were checked for free savings before any call, as the brief asked:

- **The Ashwar RPG-7 source is on disk** — both `.blend` files
  `tools/units/export_meshy_rpg.py` names, under the main checkout's gitignored
  `art/blend/enemy/wepons/` (193.5 MB textured image-to-3D bake and 146.3 MB
  part-segmentation, 3 Sep). **Item 4 therefore costs 0 credits** and is Blender work
  in stage 2 (§4 below); no preview is sent for it.
- **The 30 Sep drone previews are gone from Meshy.** `pnpm meshy -- status <id>` on all
  three preview ids in the ledger (`01a0f292…` recon v2, `01a0f26b…` attack,
  `01a0f2ac…` loiter) answers `no text task found` — the three-day retention has run
  out, as the audit's §2 said it might. The drones get fresh previews at 20 each.
- Item 5, the KDF RWS, is the audit's OPTIONAL line and not one of the eleven the lead
  approved; it is not in this batch.

**Stage 1 (this document and PR): 10 previews × 20 = 200 credits.** Stage 2, on the
lead's approval of the contact sheet: refine `--tex 8k` 15 + remesh 5 = 20 per item,
plus the RPG export, 200 more; 400 in all against the 440 approved. One re-roll per
item (20) stays inside the audit's 720 ceiling and needs the lead's go each time.

Balance read 2026-10-05 before the batch: **3,045 credits** (`pnpm meshy -- balance`),
the audit's figure to the credit.

## The flow, per item

The B8 flow: `pnpm meshy -- text "<prompt>" --name <id> [--negative "..."] --yes`
(preview, 20); the preview GLB is rendered to the contact sheet in this PR
(`docs/art/sheets/a31-parts-previews.png`, four yaws through
`tools/render_meshy_sheet.py`); the lead judges; then and only then
`pnpm meshy -- refine <preview-id> --tex 8k` (15) and `pnpm meshy -- remesh <refine-id>
--polycount N` (5) in stage 2. A bad preview costs 20, not 40. Every call lands in
`art/meshy/ledger.jsonl` and every download in `art/meshy/<slug>-<date>-<id>/`.

Faction lines used in the prompts, verbatim in every one of their class:

- **KDF weapon** (B8's line): "a weapon of a fictional army in plain matte olive-drab
  paint with dark gunmetal fittings, clean and military".
- **KDF machine** (B0's line): "a machine of a fictional army in plain matte olive-drab
  paint with dark gunmetal fittings, clean and military".
- **Irregular weapon** (new, this batch): "a weapon of an irregular militia, worn and
  field-repaired, scratched gunmetal under sun-faded paint, grips wrapped in tape".
- **Irregular machine** (B1's line): "a crude workshop-built machine of an irregular
  militia in sun-faded dusty paint with rough welded seams".
- **Sarim vehicle** (bible §5): "a civilian vehicle crudely converted for war, sun-faded
  dusty paint, welded plates".

Every part prompt ends "centred, one object, facing forward" and "No insignia, flags,
patches, text or markings of any kind", the template's own close; the parts are hand
weapons and a stencil on a rifle is a real-army tell.

Shared numbers (bible §3): a crew weapon part remeshes at **400** and ships under
**600**; a drone remeshes at **800** under **1,000**; the bike is a light vehicle part
at **1,500** (the audit's number) under 8,000. Every part bakes into its team's
figure atlas the way B8's mortar and rifle did (`import_meshy_crew_team.py`: the 8k
bake scaled to 1024 and composed BESIDE the figure's 1024 bake, one material, one
primitive per role). A part shared by several teams is baked into each team's atlas
from the same source.

---

## 1. `sarim_rifle` — the irregular rifle (shared part: `militia_cell`, `sarim_rifles`, `rpg_team` loader)

Today: `kit.rifle`, a 0.78 m eight-sided tube at chest height (`kit.py:952`), on the
two `militia_cell` figures, the three `sarim_rifles` figures and the `rpg_team`
loader — the most numerous figures on every enemy map.

| item | number | source |
|---|---|---|
| class | crew weapon part, textured, shared — ONE preview, baked into three atlases | audit §2 #1 |
| real size | **0.88 m** overall (the kit tube is 0.78; a stamped-steel rifle with a fixed wooden stock is 0.87–0.88) | `kit.py` |
| remesh / cap | **400** / 600 per copy; `sarim_rifles` is already over the team cap (12,898) and gains 3 × (400 − 48) | bible §3 |
| signature | a curved box magazine and a long gas tube over the barrel — the AK-pattern read, at 25 px a curve under the receiver | `teams.py` |
| placement | replaces each `kit.rifle` tube in place: same anchor, same yaw, scaled by its own measured length, role `weapon` | `rig.py` |
| what is lost | nothing; the kit tube has no feature | |

```
A single low-poly game-ready assault rifle, a weapon of an irregular militia, worn and field-repaired, scratched gunmetal under sun-faded paint, grips wrapped in tape. At rest, level, lying flat. A stamped-steel receiver with a long gas tube above the barrel, a slanted muzzle brake, a curved thirty-round box magazine, a ribbed wooden handguard, a wooden pistol grip and a fixed wooden stock with a steel butt plate, a canvas sling hanging slack. Worn blued steel rubbed bright at the edges, scuffed varnished wood, dust in the seams. Real-world scale, 0.88 metres long. Gunmetal, dark varnished wood, tan canvas. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 2. `recon_drone` — Recon Drone, textured re-make (KDF, air)

Today: `vehicles/recon_drone.glb`, 881 tris, the B0a v2 quadcopter with rotor guards
added in Blender, palette-painted (the bible's "drones stay palette" call, overtaken
by the max-detail rule). The lead judged the v2 shape (a boxy military quad with
guarded rotors, mast, rails, battery pack, gimbal ball) and accepted it; this prompt
asks for that shape again, feature by feature, and the preview is gone so it is a new
roll.

| item | number | source |
|---|---|---|
| class | drone, textured, **40** (preview 20 + refine 8k 15 + remesh 5) | audit §2 #2 |
| real size | **0.9 m** across, drawn at `SIZE_CLASS["air"]` 1.5 | bible §1, sprite manifest |
| remesh / cap | **800** / 1,000 | bible §3 |
| bake | new: `recon_drone` joins `TEXTURED_VEHICLE_TYPES` / `TEXTURED_VEHICLE_EXEMPT` in stage 2, at `textured.TEXTURE_PX` | `textured.py` |
| negative prompt | "consumer drone, smooth white plastic, delta wing, aeroplane, propeller nose" — B0a's first roll was a consumer quad, the attack drone's grew a delta wing | provenance B0a |
| nearest neighbour | `attack_drone` (a cylinder with fins), `loiter_drone` (a delta); the lever is four guarded rotors in an X | `validate:meshes` |

```
A single low-poly game-ready ruggedised military quadcopter reconnaissance drone, a machine of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level. Four rotor arms in an X from a boxy angular central body, each two-blade rotor inside a round protective guard ring, a chunky battery pack strapped on top, accessory rails along both sides, a stubby antenna mast, a gimballed sensor ball with a glass lens under the nose, two landing skids. Matte paint scuffed at the edges. Real-world scale, 0.9 metres across. Olive paint, gunmetal, black carbon rotors. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 3. `spike_launcher` — the Spike tube (KDF crew weapon part: `at_team`)

Today: `kit.launcher("at_tube", …, pitch 0, length 1.16)` on `at_fire`'s `forearm_R`
(`rig._at_extras`), a plain tube with a rear bell, level, on a kneeling firer —
"level reads as a guided AT launcher" is the whole of the kit's silhouette argument.

| item | number | source |
|---|---|---|
| class | crew weapon part, textured, 40 | audit §2 #3 |
| real size | **1.2 m** canister, the launcher's own length; the kit's 1.16 was the same number rounded | `rig.py:1423` |
| remesh / cap | **400** / 600; `at_team` gains 400 − 40 | bible §3 |
| signature | a square-section sealed canister on a boxy command unit with a thermal sight — a box, not a tube, so it is not the RPG, and level, so it is not the MANPAD | `teams.py` |
| placement | as the kit tube: `at_fire_forearm_R`, level, muzzle +X, scaled by its measured length | `_at_extras` |
| what is lost | the kit's bell; a real guided launcher has a flat rear cap | |

```
A single low-poly game-ready shoulder-fired guided anti-tank missile launcher, a weapon of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level. A long square-section missile canister with a sealed front cap and flat rear cover, clipped onto a boxy command launch unit with a thermal sight, rubber eyecup and folding display hood, a pistol grip and a padded shoulder rest underneath, a short folded bipod at the front, a carrying strap. Matte paint worn at the corners, rubber bumpers. Real-world scale, 1.2 metres long. Olive paint, gunmetal, black rubber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 4. The RPG launcher (shared part: `rpg_team`, `moto_rpg`) — 0 credits, Blender only

No preview. The source `tools/units/export_meshy_rpg.py` was written for is on disk
in the main checkout:

- `art/blend/enemy/wepons/Meshy_AI_RPG_7_launcher_parts_0903143621_part-segmentation.blend`
  (eight parts, 985k verts, zero materials — the one the exporter uses);
- `art/blend/enemy/wepons/Meshy_AI_RPG_7_launcher_0903143528_image-to-3d-texture.blend`
  (one welded object, a 4096 base colour, 2048 metallic-roughness, 4096 normal).

Stage 2 runs the exporter, decimates to the 400 target (the cap 600) and seats the
part on `rpg_fire_forearm_R` at 38° where `rig._rpg_extras`' 1.24 m kit tube sits,
and on the `moto_rpg` pillion rider. **One decision for the lead in stage 2:** the
exporter chose the zero-material segmentation file in September because infantry had
no textured exemption. Under the max-detail rule and with every infantry team now in
`TEXTURED_INFANTRY_TYPES`, the textured file's 4k bake is the better source and can be
composed into the atlas like a refine's — the same scale as the segmentation file to
four figures, so nothing about the exporter's seating changes.

## 6. `atgm_post` — the ATGM tripod launcher (Sarim crew weapon part: `atgm_cell`)

Today: `kit.atgm_tripod` (`kit.py:1017`): three splayed box legs, a box post, a 0.86 m
tube at 0.74 m and a box sight — "a low triangle rather than a vertical mass,
deliberately the opposite of the mortar", on `prop` at (0.24, 0, 0).

| item | number | source |
|---|---|---|
| class | crew weapon part, textured, 40 | audit §2 #6 |
| real size | **1.2 m** tube on a tripod **0.9 m** tall; the kit is 0.86 on 0.74 and the team is read against `at_team`'s level tube and `mortar_crew`'s steep one | `kit.py` |
| remesh / cap | **600** (the cap: tripod, cradle, tube, sight — the mortar's own argument) | bible §3, units doc §25 |
| signature | the splayed tripod under a level tube; nothing else on the roster stands on three legs | `kit.py` docstring |
| placement | the whole part is role `weapon` on `prop` at kit's (0.24, 0, 0), tripod feet on the ground, tube level toward +X, scaled by the measured tube | `_atgm_extras` |
| what is lost | nothing; the kit post is five boxes and a tube | |

```
A single low-poly game-ready tripod-mounted heavy anti-tank guided missile launcher, a weapon of an irregular militia, worn and field-repaired, scratched gunmetal under sun-faded paint, grips wrapped in tape. At rest, level, tube horizontal. A long missile tube with a flared rear cap in a cradle on a squat tripod with widely splayed legs and spiked feet, a boxy thermal sight with a rubber eyepiece beside the tube, a traverse hand wheel under the cradle, a coiled cable. Chipped paint, bare metal at the clamps, dust. Real-world scale, 1.2 metre tube, 0.9 metres tall. Faded green-grey paint, gunmetal, black rubber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 7. `moto_rpg` — the bike, textured re-make (Rif, crew 2)

Today: the B6 preview + remesh, no UV, `kit.tube` wheels, palette, under two textured
B3 riders. The B6 prompt (ledger `01a0f62f…`) produced a bike the lead accepted; this
asks for the same bike with its mechanism named. The riders stay (B3's figures,
re-posed seated); the RPG is item 4.

| item | number | source |
|---|---|---|
| class | light vehicle part, textured, 40 | audit §2 #7 |
| real size | **2.2 m** long, as B6 | units doc §17 |
| remesh / cap | **1,500** (the audit's figure) / 8,000; the two riders ride on top | audit §2 |
| bake | the team is in `TEXTURED_INFANTRY_TYPES`; the bike's bake joins the riders' atlas the way a part does, or ships as its own material under the file — a stage-2 importer call, recorded here | `import_meshy_crew_team.py` |
| negative prompt | "rider, person, sidecar, road bike, chrome" — the saddle must come empty | B6 |
| signature | a long two-person saddle with panniers behind — a loaded dirt bike, not a scooter | `teams.py` |

```
A single low-poly game-ready rugged off-road motorcycle with knobbly tyres and a long two-person saddle, a civilian vehicle crudely converted for war, sun-faded dusty paint, welded plates. At rest, level, no rider. Spoked wheels with deep-tread tyres, long front forks with a high mudguard, an exposed single-cylinder engine with a dented exhaust, a tube frame with welded crash bars, a round headlamp, a welded rear rack with two canvas panniers, a bedroll and a jerry can behind the empty saddle. Chipped paint, rust at the welds, mud on the tyres. Real-world scale, 2.2 metres long. Faded tan paint, gunmetal, black rubber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 8. `recoilless_rifle` — the recoilless tube and rounds (Sarim crew weapon part: `recoilless_team`)

Today: `kit.launcher("rcl_tube", …, pitch 0, length 0.86, radius 0.115)` at the hip of
a kneeling firer, plus two `kit.tube` rounds (0.52 m) beside the loader. The team's
levers against `at_team` are that no figure stands and the tube is short, fat and
0.30 m lower (bible §5, example 3) — so this is a **shoulder-fired** recoilless rifle,
not a tripod gun, whatever the unit's weapon id suggests.

| item | number | source |
|---|---|---|
| class | crew weapon part, textured, 40 — ONE preview carrying the tube and two spare rounds, split in Blender by connectivity (B8's sniper-and-scope precedent) | audit §2 #8 |
| real size | **1.1 m** tube (the kit's 0.86 was sized to the kneeling figure; a real shoulder-fired recoilless is 1.0–1.1), rounds 0.5 m | `teams.py:652` |
| remesh / cap | **600** for the three pieces together (the cap) | bible §3 |
| placement | tube: `weapon` on `rcl_fire`'s forearm at the hip, level, muzzle +X; rounds: `weapon` beside `rcl_load` at kit's offsets, yawed 90° | `teams.py` |
| what is lost | nothing | |

```
A single low-poly game-ready shoulder-fired recoilless rifle with two spare rounds lying beside it, a weapon of an irregular militia, worn and field-repaired, scratched gunmetal under sun-faded paint, grips wrapped in tape. At rest, level, all on the ground as one object. A short fat tube with a wide flared venturi at the rear, a hinged breech ring, an optical sight on a side bracket, a pistol grip under the middle, a padded shoulder rest, a carrying handle; beside it two long finned rounds with blunt warheads. Scratched steel, chipped paint, dust. Real-world scale, 1.1 metre tube. Gunmetal, faded green-grey paint, tan tape. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 9. `kdf_carbine` — the KDF rifle (shared part: `mortar_team` No.3, `yahalom_squad` yah_b, `breach_team`)

Today: `kit.rifle` on one man per team; `inf_squad` keeps its own baked carbine (B7)
and is the reference this one is matched against in the atlas.

| item | number | source |
|---|---|---|
| class | crew weapon part, textured, shared — ONE preview, baked into three atlases | audit §2 #9 |
| real size | **0.85 m** with the stock extended (the kit tube is 0.78) | `kit.py` |
| remesh / cap | **400** / 600 per copy | bible §3 |
| signature | a flat-top receiver with a red-dot optic and a railed handguard with a foregrip — a modern carbine beside item 1's wooden rifle, told apart by the straight magazine and the optic | |
| placement | replaces each `kit.rifle` in place, role `weapon` | `rig.py` |

```
A single low-poly game-ready modern short-barrelled assault carbine, a weapon of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level, lying flat. A flat-top receiver with a small red-dot optic on the rail, a quad-rail handguard with a short vertical foregrip, a birdcage flash hider, a straight thirty-round translucent polymer magazine, a collapsible stock extended with a rubber butt pad, a pistol grip, a padded sling. Matte finish worn at the edges, fine scratches on the rails. Real-world scale, 0.85 metres long. Gunmetal, olive polymer, tan sling. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 10. `manpad_tube` — the MANPAD launcher (Sarim crew weapon part: `manpad_team`)

Today: `kit.launcher("mpd_tube", …, pitch 78°, length 0.94, radius 0.065)` — "the
angle, 78 degrees against the RPG's 38, and the shorter, thinner tube are the levers".

| item | number | source |
|---|---|---|
| class | crew weapon part, textured, 40 | audit §2 #10 |
| real size | **1.4 m** (a real shoulder-fired SAM is 1.4–1.6; the kit's 0.94 was sized to the figure, and the 78° angle is the lever, which a longer tube only sharpens) | `teams.py:677` |
| remesh / cap | **400** / 600 | bible §3 |
| signature | a slim tube with a bulbous gripstock under the front third — thin where the RPG is fat, and raised at 78° in Blender | `teams.py` |
| placement | as the kit tube, on the gunner's shoulder at 78°, scaled by the measured length | `manpad_team` |

```
A single low-poly game-ready shoulder-fired surface-to-air missile launcher, a weapon of an irregular militia, worn and field-repaired, scratched gunmetal under sun-faded paint, grips wrapped in tape. At rest, level, lying flat. A slim launch tube with a flared front cap and an open rear, a bulbous gripstock under the front third with a pistol grip and a trigger, a small battery coolant cylinder screwed into the gripstock, a folding open sight on top, a shoulder strap, rubber end bands. Faded paint rubbed through to metal, dust. Real-world scale, 1.4 metres long. Faded olive paint, gunmetal, tan canvas strap. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 11. `loiter_drone` — Loitering Munition, textured re-make (Sarim, air)

Today: `vehicles/loiter_drone.glb`, 630 tris, the B1 delta (preview + remesh, palette).
The lead accepted the B1 shape; the prompt asks for it again with its workshop build
named.

| item | number | source |
|---|---|---|
| class | drone, textured, 40 | audit §2 #11 |
| real size | **1.6 m** wingspan, drawn at `SIZE_CLASS["air"]` 1.5 | bible §1 |
| remesh / cap | **800** / 1,000 | bible §3 |
| bake | joins `TEXTURED_VEHICLE_TYPES` / `TEXTURED_VEHICLE_EXEMPT` in stage 2 | `textured.py` |
| negative prompt | "quadcopter, rotors, military grey, sleek" | |
| signature | a flat delta with a pusher propeller — the only wing on the roster | B1 |

```
A single low-poly game-ready loitering munition drone with a swept delta wing, a crude workshop-built machine of an irregular militia in sun-faded dusty paint with rough welded seams. At rest, level. A flat swept delta wing of foam and plywood with taped edges, a slim boxy fuselage with a taped hatch, a short blunt seeker nose with a small camera window, a two-blade pusher propeller on a small petrol engine at the tail, a small vertical fin at each wingtip, exposed wiring and a strapped battery pack on top. Patchy paint, bare plywood, tape. Real-world scale, 1.6 metres wingspan. Dusty tan paint, bare plywood, black propeller. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 12. `attack_drone` — Loitering Munition, textured re-make (KDF, air, garage unlock)

Today: `vehicles/attack_drone.glb`, 706 tris, the B0a cylinder-and-fins after Blender
cut the delta wing the preview grew unasked. Same shape, named, with the wing in the
negative prompt this time.

| item | number | source |
|---|---|---|
| class | drone, textured, 40 | audit §2 #12 |
| real size | **1.05 m** long, drawn at `SIZE_CLASS["air"]` 1.5 | bible §1 |
| remesh / cap | **800** / 1,000 | bible §3 |
| bake | joins `TEXTURED_VEHICLE_TYPES` / `TEXTURED_VEHICLE_EXEMPT` in stage 2 | `textured.py` |
| negative prompt | "delta wing, aeroplane wings, quadcopter, rotors, missile fins at the nose" | provenance B0a |
| signature | a blunt cylinder with a cross of four small tail fins — no wing, no rotor | B0a |

```
A single low-poly game-ready tube-launched loitering munition drone, a machine of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level. A blunt cylindrical fuselage with a tapered sensor pod on the nose carrying a small glass lens window, fine panel lines and flush latches along the body, a small cross-shaped tail of four short fins, a folded two-blade pusher propeller at the tail, a short antenna stub on top, rubber bump rings at both ends. Paint scuffed on the fin edges. Real-world scale, 1.05 metres long. Olive paint, gunmetal nose pod, black fins. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

---

## Order and cost, stage 1

Sent in the audit's rank order, one preview each, `--yes` on the lead's 5 Oct approval:

| # | `--name` | preview |
|---|---|---|
| 1 | `sarim_rifle` | 20 |
| 2 | `recon_drone` | 20 |
| 3 | `spike_launcher` | 20 |
| 4 | RPG from disk | 0 |
| 6 | `atgm_post` | 20 |
| 7 | `moto_rpg` | 20 |
| 8 | `recoilless_rifle` | 20 |
| 9 | `kdf_carbine` | 20 |
| 10 | `manpad_tube` | 20 |
| 11 | `loiter_drone` | 20 |
| 12 | `attack_drone` | 20 |
| | **stage 1** | **200** (~$4.00) |

Task ids, consumed credits and the balance after are in the "Sent" section below,
appended once the batch has run; the ledger is the record.

## Sent 2026-10-05 — ten previews, 200 credits, balance 3,045 → 2,845

All ten previews succeeded first time (`art/meshy/ledger.jsonl`, `credits_consumed`
20 each; `pnpm meshy -- balance` read 2,845 after, the 200 to the credit). Each
download is in `art/meshy/<slug>-20261005-<id>/` — `task.json` and `thumbnail.png`
are committed as every batch before; the preview `model.glb` is not (the precedent:
one preview GLB in 141 ledger lines), and Meshy holds it for three days, so stage 2
starts with `pnpm meshy -- download <id>` if the file is wanted locally again. The
contact sheet is `docs/art/sheets/a31-parts-previews.png` (four yaws each through
`tools/render_meshy_sheet.py`, Workbench cavity shading, untextured). One fact the
sheet's labels show that the prompts could not control: **every preview comes back
normalised to 1.90 m on its longest axis** — Meshy's own frame, not the metres the
prompt asked for — so real size is set at import, as every batch before.

| # | `--name` | preview task | tris | reads as asked? | what to look at |
|---|---|---|---|---|---|
| 1 | `sarim_rifle` | `01a10c2d-a7b5-750e-a603-6e4030a645a3` | 167k | **yes** | stamped receiver, curved magazine, wooden furniture, slack sling; the muzzle brake is plain |
| 2 | `recon_drone` | `01a10c2f-177b-768e-aeb2-690b70446bb2` | 414k | mostly | a boxy military quad with gimbal ball, battery, rails, skids — but **no rotor guard rings**, exactly as B0a's v2 (added in Blender then; the same fix is available) |
| 3 | `spike_launcher` | `01a10c30-4ca3-74b9-befa-ba935597d8b7` | 231k | mostly | a round tube rather than a square canister, the bipod EXTENDED rather than folded, the CLU box and sight present; still reads as a guided launcher, level, not an RPG |
| 6 | `atgm_post` | `01a10c31-11f4-75ef-ba5e-9addcad63428` | 197k | partly | a tripod with a sight and hand wheel, but the tripod is TALL and spindly, not squat, and the tube carries a pointed missile nose; the "low triangle" silhouette the kit argues for is weaker than the kit's |
| 7 | `moto_rpg` | `01a10c31-ea45-70f1-bef0-b06f3d51d4e2` | 1,211k | **yes** | dirt bike, long saddle, panniers, bedroll, headlamp, no rider; the heaviest preview of the batch (the remesh takes it to 1,500) |
| 8 | `recoilless_rifle` | `01a10c3f-d3cd-705d-9e0d-ad4a6737fa20` | 141k | **no** | came as an assault rifle with a stock, scope and a long thin barrel — no fat tube, no venturi, no rounds beside it. Re-roll candidate (20): the prompt should drop "rifle" and name "a short fat tube launcher, 0.11 m bore, no stock" |
| 9 | `kdf_carbine` | `01a10c40-aa15-7125-9c3b-2fc18e0a0224` | 280k | **yes** | flat-top carbine, optic, railed handguard, foregrip, collapsible stock, sling |
| 10 | `manpad_tube` | `01a10c41-a7cc-7653-a8d8-d549bec79b17` | 101k | mostly | slim tube with gripstock and strap, raised; but a POINTED nose cone (a missile tip) where a launcher carries a flat cap, so end-on it reads as a rocket |
| 11 | `loiter_drone` | `01a10c42-8c25-70f2-bfa5-33e6862b52a9` | 177k | **no** | a straight-wing twin-boom aircraft with pods, not the swept delta the lead accepted in B1. Re-roll candidate (20): lead with "flying wing, no fuselage, no tail booms" and put "straight wing, twin boom, aeroplane" in the negative |
| 12 | `attack_drone` | `01a10c43-ae9f-7219-b923-62eb52ac13fb` | 159k | partly | the cylinder, nose pod and tail propeller came, and so did a straight wing the negative prompt forbade — B0a's delta wing again, in a different shape. Blender cut it then; cutting it again costs nothing, a re-roll 20 |

Stage 1 stops here. Nothing has been refined; no remesh has run. Stage 2 waits on
the lead's word per item: approve, cut in Blender, or re-roll (20 each, inside the
audit's 720 ceiling).

---

# Stage 2 — the lead's rulings of 5 Oct (~260 credits approved)

- **Refine now** (`--tex 8k` 15 + remesh 5): 1 `sarim_rifle`, 2 `recon_drone` (rotor
  guard rings added in Blender, as B0a), 3 `spike_launcher`, 7 `moto_rpg`, 9 `kdf_carbine`.
- **Refine, then fix in Blender:** 10 `manpad_tube` (the pointed nose cut to a flat
  cap), 12 `attack_drone` (the straight wing cut, as B0a).
- **Re-roll previews only, 20 each, then STOP for approval:** 8, 11, 6 below.
- **RPG (4):** Blender-only, from the TEXTURED 4k source on disk, because every
  infantry team is in `TEXTURED_INFANTRY_TYPES` now.

Planned: 7 × 20 + 3 × 20 = **200** of the ~260.

## 8 v2. `recoilless_rifle` — re-roll

The first roll heard "rifle" and built one. The word is gone; the bore, the venturi
and the absent stock are named; the negative prompt lists what a rifle has.

| negative prompt | "rifle, assault rifle, stock, scope, thin barrel, magazine, bayonet" |
|---|---|

```
A single low-poly game-ready shoulder-fired recoilless anti-tank launcher with two spare rounds beside it, a weapon of an irregular militia, worn and field-repaired, scratched gunmetal under sun-faded paint. At rest, level, on the ground as one object. A short fat steel tube of wide bore, open at both ends, a wide cone-shaped venturi nozzle flaring at the rear, a hinged breech ring, a periscope sight on one side, a pistol grip, a shoulder rest, no stock; beside it two finned rounds with blunt warheads. Scratched steel, chipped paint. Real-world scale, 1.1 metre tube, 0.11 metre bore. Gunmetal, faded green-grey paint, tan tape. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 11 v2. `loiter_drone` — re-roll

A flying wing with no fuselage and no booms, which the first roll added on its own.

| negative prompt | "straight wing, twin boom, tail boom, fuselage, aeroplane, quadcopter, rotors, pods" |
|---|---|

```
A single low-poly game-ready flying-wing loitering munition drone, a crude workshop-built machine of an irregular militia in sun-faded dusty paint with rough welded seams. At rest, level. One flat swept delta flying wing of foam and plywood, no separate fuselage, a short blunt seeker nose at the centre of the leading edge with a camera window, a two-blade pusher propeller on a small engine at the centre of the trailing edge, a small vertical fin at each wingtip, exposed wiring and a strapped battery on top. Patchy paint, bare plywood, tape. Real-world scale, 1.6 metres wingspan. Dusty tan paint, bare plywood, black propeller. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## 6 v2. `atgm_post` — re-roll

Squat and low, flat-capped: the kit's "low triangle, the opposite of the mortar".

| negative prompt | "missile nose cone, pointed tip, fins, tall tripod, long legs, camera tripod, telescope" |
|---|---|

```
A single low-poly game-ready tripod-mounted anti-tank guided missile launcher, a weapon of an irregular militia, worn and field-repaired, scratched gunmetal under sun-faded paint. At rest, level, tube horizontal. A long plain cylindrical launch tube with flat sealed caps at both ends, in a cradle on a squat low tripod with short widely splayed legs and spiked feet, only knee height off the ground, a boxy thermal sight beside the tube, a traverse hand wheel under the cradle, a coiled cable. Chipped paint, bare metal. Real-world scale, 1.2 metre tube, 0.7 metres tall. Faded green-grey paint, gunmetal, black rubber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## Sent 2026-10-05 — three re-roll previews, 60 credits; STOPPED for the lead

Contact sheet: `docs/art/sheets/a31-parts-rerolls.png` (same renderer, four yaws).

| # | `--name` | v2 preview task | tris | reads as asked? | what to look at |
|---|---|---|---|---|---|
| 6 v2 | `atgm_post` | `01a10c4f-a611-776f-9bca-d720f1b947b2` | 342k | **yes** | a squat splayed tripod with spiked feet, a cradle, a boxy sight, a coiled cable, the tube knee-high and level; one tube end is still slightly rounded (a cut to a flat cap in Blender, 0 credits). Recommend: refine |
| 8 v2 | `recoilless_rifle` | `01a10c4c-319f-710d-9d1d-12d43c8955ce` | 491k | yes, on a base | the right weapon this time — a fat open tube with a flared venturi, breech ring, periscope sight, two finned rounds beside — but Meshy put the lot on a DIRT PATCH with tufts of grass, which "no ground, no base" did not stop. The patch is one flat island under the pieces and separates by connectivity (the B8 sniper-kit `_separate_islands` path); the tufts go with it. Recommend: refine, cut the base in Blender |
| 11 v2 | `loiter_drone` | `01a10c4d-c19c-7086-a1bb-0043ff6e1603` | 136k | **no** | a conventional small aircraft again: a pod fuselage, tapered straight wings, a tail with fins and a pusher prop — not a flying wing, and the negative prompt ("straight wing, fuselage, aeroplane") was ignored twice. Two misses on this item. Options for the lead: (a) accept it as a small fixed-wing UAV — it is still unlike the quad and the finned cylinder, which is the silhouette gate's whole question; (b) keep the shipped B1 delta (palette, 630 tris) and drop the textured re-make; (c) one more roll by `image` (image-to-3D from a drawn delta reference), which is a different generator path from the one that has failed twice |

Stage 2 of the re-rolls stops here: nothing refined, nothing remeshed, pending the
lead's word on each of the three.

## The lead's rulings on the re-rolls (5 Oct)

- **6 v2 `atgm_post`: refine (`--tex 8k`) and remesh at 600.** The tube's front is
  flattened to a cap in Blender.
- **8 v2 `recoilless_rifle`: refine and remesh at 600.** The dirt-and-grass base is
  cut in Blender by connectivity.
- **11 `loiter_drone`: the re-make is DROPPED at 0 more credits.** The shipped B1
  delta (`vehicles/loiter_drone.glb`, 630 tris, palette-painted) stays, and it is
  **the one untextured exception on the roster, by the lead's ruling** — two text
  rolls produced a fuselage-and-wings aircraft, and the delta the lead accepted in B1
  is the silhouette the gate reads. The two v1/v2 previews (`01a10c42…`, `01a10c43…`
  is the attack drone; `01a10c4d…`) stay in the ledger as spent, 40 credits.

Stage 2 is therefore 7 + 2 = 9 refine-and-remesh pairs (180) + 3 re-rolls (60) =
**240 of the ~260 approved**; expected balance after the batch **2,605**.

## Sent — stage 2 (2026-10-05): nine refine-and-remesh pairs, 180 credits

Every refine at `--tex 8k` (15 credits), every remesh 5 credits; ids from
`art/meshy/ledger.jsonl` (refines are `kind: text`, `mode: refine`). The 8k
downloads and the 8k-carrying remesh `model.glb`s stay uncommitted (bible §15);
each is downscaled into its team's atlas or the vehicle's own texture at export.
The day's ledger total is 440 credits: stage 1's ten previews (200), the three
re-rolls (60) and these 180 -- 260 of the ~260 approved.

| # | `--name` | preview | refine (8k) | remesh | credits | ships in |
|---|---|---|---|---|---|---|
| 1 | `sarim_rifle` | `01a10c2d-a7b5-750e-a603-6e4030a645a3` | `01a10c51-668c-7167-989e-f821fbb74854` | `01a10c53-aa02-7283-933d-a36bb3e1103a` | 20 | `militia_cell` ×2, `sarim_rifles` ×3, `rpg_team` loader (339 tris a copy) |
| 2 | `recon_drone` | `01a10c2f-177b-768e-aeb2-690b70446bb2` | `01a10c57-cf0b-75ce-92c0-9574434b8631` | `01a10c59-eede-7009-82ba-125e709bbe8e` | 20 | `vehicles/recon_drone.glb` (1,890 tris) |
| 3 | `spike_launcher` | `01a10c30-4ca3-74b9-befa-ba935597d8b7` | `01a10c5d-97ab-777d-98c9-1775e9c5348d` | `01a10c61-808f-7626-9ebd-8abddc4e01b6` | 20 | `at_team` (350 tris, extended bipod cut) |
| 7 | `moto_rpg` | `01a10c31-ea45-70f1-bef0-b06f3d51d4e2` | `01a10c65-0225-775d-8dfd-e5f11040b216` | `01a10c69-8fc1-740c-acb1-1e25cd415d57` | 20 | `moto_rpg` bike (team file 8,926 tris) |
| 9 | `kdf_carbine` | `01a10c40-aa15-7125-9c3b-2fc18e0a0224` | `01a10c6d-dee5-73ab-bab3-2246e541f8c1` | `01a10c6f-fd2f-71bb-9da3-6955d73f2a16` | 20 | `mortar_team` No.3, `yahalom_squad` yah_b, `breach_team` ×2 (315 tris, sling cut) |
| 10 | `manpad_tube` | `01a10c41-a7cc-7653-a8d8-d549bec79b17` | `01a10c73-d0c2-7786-9026-53fc1dd45155` | `01a10c75-f46e-7277-b9bb-03d72a1f13da` | 20 | `manpad_team` (354 tris, nose capped flat, strap cut) |
| 12 | `attack_drone` | `01a10c43-ae9f-7219-b923-62eb52ac13fb` | `01a10c79-b7bf-7749-aaa8-1be09178f0f5` | `01a10c7c-2354-70e0-be0e-d47776620bb6` | 20 | `vehicles/attack_drone.glb` (948 tris) |
| 6 v2 | `atgm_post` | `01a10c4f-a611-776f-9bca-d720f1b947b2` | `01a10c80-1c2d-72be-9217-621d55e07b6a` | `01a10c82-1470-7159-8a6a-d25809fb6c95` | 20 | `atgm_cell` on `prop` (611 tris, front capped flat) |
| 8 v2 | `recoilless_rifle` | `01a10c4c-319f-710d-9d1d-12d43c8955ce` | `01a10c86-56c3-7145-b9a0-dea4f527b0d8` | `01a10c88-87de-7586-8a66-47c0c2997c3a` | 20 | `recoilless_team` (dirt patch and tufts dropped, rounds laid by the loader, front leg and its remnant cut, orange band re-painted olive) |

Not sent: 11 `loiter_drone` (dropped, the lead's ruling above) and 4, the RPG-7
(0 credits, Blender only from the on-disk textured source).

In-game review: `docs/art/sheets/a31-parts/ingame-sheet.png` (13 rows, close-up
beside gameplay); the orange bike against a render-only dusty tan,
`docs/art/sheets/a31-parts/moto_rpg-muted.png`.
