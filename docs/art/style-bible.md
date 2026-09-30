# Roaring Lions — art style bible and Meshy prompt template

**WP-A3.1 (GH-179) · Status: draft for the lead's approval · 2026-09-28 · §6 reordered 2026-09-29 for the priority batch B0 (GH-286)**

Governs every mesh entering `art/meshes/**` from October on. Written before the first
batch because a rule changed here costs a line and a rule changed after a generation
costs credits. Numbers are measured (and say where) or proposals (and say so). Read
with `docs/ART_PIPELINE.md` §1 and §7, the mesh unit contract
(`docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`), the lit renderer spec
(`2026-09-14-lit-renderer-design.md`) and `docs/ASSET_PROVENANCE.md`.

---

## 1. The register

**One sun.** Azimuth 135°, altitude 55° (`tools/dimetric.py`), mirrored by the
runtime `DirectionalLight` with a hemisphere bounce, a shadow map and SSAO. Every mesh
is lit at frame time, so **no asset bakes light**: no painted highlights or AO, no
shadow in a texture, no ground plane. A baked sun fights the real one, and on a unit
that turns it becomes a shadow rotating with the hull. Texture requests set Meshy's
`remove_lighting` (CLI gap, §4). The camera is 2:1 dimetric, 30° elevation, azimuth
225°: nobody sees an underside, and detail facing `-X`/`-Z` is detail nobody sees.

**One scale reference per class.** Built at real metres (a tile is 3 m), checked
against its class's reference first:

| class | reference | why that one |
|---|---|---|
| infantry | the 1.78 m KDF rifleman (`meshy_soldier.glb`) | the thing every other unit is judged against |
| vehicles | `technical.glb` (enemy light) / `mbt_lavi.glb` (heavy) | the two ends of the ground roster |
| air | `recon_drone`, drawn at `SIZE_CLASS["air"]` 1.5 | an air unit must be at least as clickable as a soldier (25.8 px vs 25.7) |
| buildings | the tile (3 m) and the storey (3 m) | a building's base *is* a tile diamond |
| props / decor | a 1.8 m figure standing beside it | a prop is read at the size of the man next to it |

Size is compressed only through `SIZE_CLASS`, never per asset.

**Silhouette first.** A soldier is ~25 px tall at gameplay zoom, a vehicle 90–125 px
long. The player reads the black shape, then the tone band, then motion; surface
detail last. Every unit stays under **IoU 0.88 at 64 px** against every other
(`pnpm validate:meshes`), and is told apart by **posture, weapon angle and mass** —
`teams.py`'s levers: RPG tube at 38°, MANPAD at 78°, recoilless low at the hip —
never by colour or texture.

**Palette roles, not colours.** `data/palette.json` is the INPUT to lighting; a mesh
decides its own colour only under a named textured exemption. Hulls, uniforms and
masonry stay in the desaturated bands (limestone, dust, olive, gunmetal, scrub) —
that is what makes VFX pop. **Saturated colour is reserved** for VFX and team
markers; team regions are authored `#FF00FF`. KDF reads olive; Sarim irregulars
dust and limestone with keffiyeh heads. A new unit takes its faction's bands.

**Nothing real.** No real army's insignia, flag, patch, camouflage or markings
(GDD §2, `CONTRIBUTING.md`). Every prompt says so.

---

## 2. Per-class rules

### Infantry teams (`art/meshes/<team_id>.glb`)

- **Contract v1 unchanged:** one file per team, 2–3 figures, one armature, bones
  prefixed `f<N>_`, clips exactly `idle, move, fire, down, wreck` (+ optional
  `moveFire, work, fall, fallAlt, wreckAlt`); the closed ten roles (`uniform, webbing,
  boot, face, skin_shadow, metal, weapon, wood, charge, keffiyeh`) in both node name
  and `extras.rl_role`, split in Blender (the `import_meshy_*.py` classifier is the
  precedent).
- **Generated in A-pose, posed in Blender.** Auto-rigging needs a standing humanoid,
  so no prompt asks for a kneeling, prone or seated figure.
- **Crew weapons** are separate `weapon`/`metal` objects; default is `kit.py`'s
  existing geometry, which already passes IoU (Q3).
- **Falls last 0.9–1.2 s** (G0 #13), trimmed while the importer is open.
- **Faction** is written in `mesh-catalogue.ts`, never inferred from the look.
- **Footprint:** figures within ±1.2 m of the origin, feet at z = 0, `+X` forward.

### Vehicles (`art/meshes/vehicles/<id>.glb`)

Contract v2: meshes `{part}_{role}` from `hull, plate, rubber, metal, glass, recess`;
a `turret_pivot` (`extras.rl_pivot = "turret"`) wherever anything traverses; `+X`
forward, origin at ground centre. The wreck is procedural (`pnpm wreck:meshes`), so
ship only the live model; `idle`/`wreck` are reserved clip names. Faction is baked by
unit type.

### Buildings, props, decor (not in these batches)

Buildings: two rigid files (`<type>` + `_wreck`), origin at the footprint anchor,
facade toward `+X`/`+Z` with openings in the `glass` role (`building_facing.py`).
Props: preview then remesh at the cap — jersey barrier 120, rebar 140, laundry line
160, dish 180, water tank 220, tyre pile 260, wrecked car 400 tris (as shipped on
`feat/ground-plan2`). Supplied textured assets are used as-is.

---

## 3. Polycount and footprint targets

Rendering is draw-call-bound, not vertex-bound (`docs/PERFORMANCE.md`), so these caps
serve **download size** (`perf:load`) and **clean shapes at 25 px**, not frame time.

| class | remesh `--polycount` | shipped cap | footprint / size | measured neighbours |
|---|---|---|---|---|
| infantry figure | 2,000 | 2,500 per figure | 1.66–1.80 m tall | civilians 2,960–4,588; kit figures ~2,750 |
| infantry team file | — | 8,000 incl. weapons | within its tile | kit teams 6,732–13,120 |
| crew weapon part | 400 | 600 | real metres | — |
| drone | 800 | 1,000 | real metres × 1.5 (air) | recon 0.9 m, attack 1.05 m, loiter 1.62 m (sprite manifests) |
| light vehicle | 5,000 | 8,000 | real metres, 1.0 | `mbt_lavi` 8,346; `technical` 49,268 (legacy, too dense) |
| wheeled APC (proposal, B0) | 8,000 | 10,000 | real metres, 1.0; `apc_eitan` 7.13 m | `apc_eitan` 63,492 (kit-built, to be replaced); `apc_kipod` 404; `mbt_lavi` 8,346 |
| prop | the cap | 120–400 | real metres | seven props on ground-plan2 |
| building (palette) | — | 20,000 | tile multiples | clinic 19,225, hall 19,491 |

Counts are glTF triangles, measured 2026-09-28 from the shipped `art/meshes/**`
(`apc_eitan` re-measured 2026-09-29). **Drone size on the mesh path:** `SIZE_CLASS["air"]`
is a sprite-sheet multiplier; a vehicle mesh is scaled by `MESH_SCALE` only
(`mesh-vehicle.ts`), so the ×1.5 in the drone row is not applied to a GLB. See §7
question 10.

**This week's lesson.** A Meshy preview arrives at its default 30,000 tris, and
plain Blender decimation to 120–400 **collapsed thin shapes** (dish, laundry line,
rebar, car). Meshy's remesh at the target (5 credits) gave clean shapes that shipped
untouched or with one small trim (water tank 226→220, tyre pile 272→260). So:
**remesh at the target in Meshy; Blender trims at most ~10%.**

---

## 4. The Meshy pipeline, step by step

The lead's rule: *Meshy for the initial robust base model and for new parts; Blender
for everything after.* One unit, in order:

| # | step | tool | credits |
|---|---|---|---|
| 0 | Numbers table (height, footprint, polycount, roles, faction) approved | this doc | 0 |
| 1 | `pnpm meshy -- estimate text` (and `estimate remesh`); **announce the call and its cost**; wait for the lead's go | CLI, no API call | 0 |
| 2 | **One** preview from the §5 template (`text`; `image` only when a reference image exists) | `pnpm meshy -- text "<prompt>" --name <id>` | 20 |
| 3 | Texture it, only if the class ships a bake (infantry, per GH-160; `gun_truck`, per Q2) | `--refine --tex 2k` | 10 |
| 4 | Remesh at the class target | `pnpm meshy -- remesh <task> --polycount N --name <id>` | 5 |
| 5 | Rig, figures only (Meshy humanoid rig; clips are retargeted from the supplied Meshy libraries in Blender, not bought) | Meshy rigging | 5 |
| 6 | Download at once to `art/meshy/<slug>-<date>-<id>/` (Meshy keeps files **three days**); commit the folder | CLI does this | 0 |
| 7 | Blender: scale to metres, `+X` forward, origin, pose, split into roles, crew weapons, trim, clips, fall 0.9–1.2 s | importer / `export_*.py` | 0 |
| 8 | Gates: `pnpm validate:meshes` (roles, palette, IoU < 0.88), `pnpm encode:meshes -- --check`, `pnpm perf:load`, look at it at zoom 1.0 in `?sandbox` | local | 0 |
| 9 | Provenance: paste the CLI's line into `docs/ASSET_PROVENANCE.md` (preview AND remesh task ids), disclose AI art in the PR | docs | 0 |

**Per-unit cost:** figure team **40** (20 + 10 + 5 + 5); textured vehicle **35**;
palette vehicle, drone or crew-weapon part **25**. At the CLI's default estimate of
$0.02/credit, that is $0.80 / $0.70 / $0.50.

**Unverified until the first textured unit of B0 (the `apc_eitan`):** that remesh of a
*refined* task keeps its texture. If it does not, step 3 moves after step 4 (refine cannot take a remesh
task, so the fallback is `retexture`, also 10). Measure it once; do not guess twice.

**Rules that are not optional:**

- **One preview per concept.** A wrong preview is fixed in Blender. A re-roll is a
  new spend with its own announcement and go, never speculative.
- **Every call is announced first** with its estimate; `--yes` is for runs the lead
  already approved.
- **Supplied `.blend`/`.glb` files are used as-is** unless the lead says otherwise.
- **Zero materials in a GLB**, except named textured exemptions
  (`TEXTURED_BUILDING_TYPES` / `TEXTURED_MESH_EXEMPT`). Infantry has its own list,
  `TEXTURED_INFANTRY_TYPES`, empty until B0b fills it (Q1).
- **Every spend is in `art/meshy/ledger.jsonl`**; `pnpm meshy -- spent` answers "how
  much".

**CLI prerequisites** (small tasks, before the first figure — now B0b): `remesh` has
landed on `main` (checked 2026-09-29; this line said it had not); the A-pose flag has
landed too (`--pose a-pose`, #293); refine does not send `remove_lighting`; and
there is no `rig` command (priced at 5 in `pricing.ts`). Until it lands, rigging runs
in the Meshy web UI and is logged by hand.

The infantry bake list has landed too (GH-286): `TEXTURED_INFANTRY_TYPES` in
`packages/render/src/three/units/textured-infantry.ts`, mirrored by
`TEXTURED_INFANTRY_EXEMPT` in `tools/validate_mesh_assets.py` and pinned by
`textured-infantry.test.ts`. It is **empty by design**: B0b adds `at_team` and
`demo_squad` to both sides in the same change that ships each GLB. Until then an
infantry GLB that ships a texture throws at load.

**Riggable figures use `--pose`.** `text` and `image` take `--pose a-pose|t-pose|none`
(default `none`, which sends the empty `pose_mode` as before). Batch B0b of GH-286
(`at_team`, `demo_squad`) needs the text preview in A-pose so the figures can be
rigged:

```bash
pnpm meshy -- text "<prompt from section 5>" --pose a-pose --name at_team
```

Check the request first with `MESHY_DRY_RUN=1` (prints the body, spends nothing) and
`pnpm meshy -- estimate text`; the printout shows `"pose_mode": "a-pose"`.

---

## 5. The prompt template

One template, every unit; fill the slots, add nothing between them; stay under the
CLI's 800 characters. Never ask for bases, stands, baked shadows, PBR maps, readable
text, several objects, or "high detail" — polycount comes from remesh, not adjectives.

```
A single low-poly game-ready {SUBJECT}, {FACTION_LOOK}. {POSE}. {SIGNATURE}.
Real-world scale, {SIZE}. {MATERIALS}. Plain even lighting, no baked shadows,
no ground, no base, no plinth, centred, one object, facing forward.
No insignia, flags, patches, text or markings of any kind.
```

| slot | what goes in it | rule |
|---|---|---|
| `{SUBJECT}` | the one thing, named plainly | "irregular fighter", "light pickup truck with an anti-aircraft gun" — never a real designation |
| `{FACTION_LOOK}` | the faction line below, verbatim | copied, never paraphrased |
| `{POSE}` | figures: "standing in a relaxed A-pose, arms slightly away from the body"; vehicles/drones: "at rest, level" | never kneeling, prone or seated |
| `{SIGNATURE}` | the ONE feature that separates it from its nearest silhouette neighbour | named from `teams.py`'s docstring for that team |
| `{SIZE}` | height or length in metres | from the numbers table |
| `{MATERIALS}` | at most three, in palette words | "dusty tan cloth", "worn olive paint", "gunmetal" |

**Faction lines:**

- **KDF:** "a soldier of a fictional army in a plain olive-drab field uniform, black
  nylon plate carrier, tan suede boots, modern helmet with a plain olive cover".
- **Sarim irregular:** "an irregular militia fighter in a mix of dusty civilian
  clothes and a worn tan chest rig, a keffiyeh wrapped over the head and lower face,
  sandals or worn boots".
- **Sarim vehicle:** "a civilian vehicle crudely converted for war, sun-faded dusty
  paint, welded plates".
- **KDF machine (proposed 2026-09-29, GH-286 — no KDF vehicle or drone line existed):**
  "a machine of a fictional army in plain matte olive-drab paint with dark gunmetal
  fittings, clean and military".

### Worked example 1 — `gun_truck` (AA Gun Truck, enemy, light vehicle)

Nearest neighbour `technical`; the lever is the twin-barrel gun elevated at 28°.
Numbers: length 5.4 m (proposal; drawn size stays `target_scale` 1.84), remesh 5,000, textured (Q2), cost **35**.

```
A single low-poly game-ready light pickup truck carrying a twin-barrel anti-aircraft
gun on a pedestal mount in the bed, a civilian vehicle crudely converted for war,
sun-faded dusty paint, welded plates. At rest, level. The twin gun barrels are raised
steeply at about 28 degrees, clearly taller than the cab. Real-world scale, 5.4 metres
long. Faded tan paint, gunmetal gun, black tyres. Plain even lighting, no baked
shadows, no ground, no base, no plinth, centred, one object, facing forward. No
insignia, flags, patches, text or markings of any kind.
```

Blender: split `hull_*` from `turret_*`, put `turret_pivot` at the mount ring
(`render_gun_truck.py`'s `turret_axis` (-1.65, 0) is the existing number), roles
from the vehicle six.

### Worked example 2 — `manpad_team` (MANPAD Team, enemy, crew 2)

Nearest neighbour `rpg_team`; the levers are the tube at 78° **on the gunner's
shoulder** and a spotter kneeling with binoculars. The kneel is posed in Blender.
Remesh 2,000 per figure, textured, rigged, cost **40**.

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a
mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the
head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away
from the body. A slim shoulder-fired missile launcher tube slung across the back.
Real-world scale, 1.74 metres tall. Dusty tan cloth, olive webbing, gunmetal tube.
Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one
object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

The tube is slung in the prompt because an A-pose figure cannot shoulder it; Blender
separates it and lays it at 78°. The spotter is the same figure re-posed, with
`kit.binoculars` — no second generation.

### Worked example 3 — `recoilless_team` (Recoilless Team, enemy, crew 3)

Nearest neighbour `at_team`; the levers are that **no figure stands**, and the short
fat tube held 0.30 m lower, at the hip. Cost **40**.

```
A single low-poly game-ready irregular fighter, an irregular militia fighter in a
mix of dusty civilian clothes and a worn tan chest rig, a keffiyeh wrapped over the
head and lower face, worn boots. Standing in a relaxed A-pose, arms slightly away
from the body. A heavy bandolier of large rounds across the chest. Real-world
scale, 1.72 metres tall. Dusty tan cloth, olive webbing, gunmetal. Plain even
lighting, no baked shadows, no ground, no base, no plinth, centred, one object,
facing forward. No insignia, flags, patches, text or markings of any kind.
```

Blender: both crew kneel; the tube and two spare rounds are `kit.py`'s
`rcl_tube`/`rcl_round*` geometry (Q3).

**Filled prompts for the B0 units** (`recon_drone`, `attack_drone`, `at_team`,
`demo_squad`, `apc_eitan`), each with its numbers table, are in
`meshy-prompts-units.md`, not repeated here.

---

## 6. Batch plan

**Scope.** The six units with no GLB (`gun_truck`, `loiter_drone`, `attack_drone`,
`recon_drone`, `manpad_team`, `recoilless_team`), the twelve kit-built teams in
`tools/units/teams.py`, and — since 29 Sep — the kit-built `apc_eitan`. Two names sit in
both of the first two lists — `manpad_team` and `recoilless_team` are kit-built teams
that never exported a GLB — so the work is **17 distinct units**, not 19. The other ten
kit-built teams: `demo_squad`, `at_team`, `breach_team` (KDF); `militia_cell`,
`rpg_team`, `atgm_cell`, `mortar_crew`, `charge_squad`, `digger_crew`, `moto_rpg`
(enemy). Already Meshy-sourced and out of scope: `inf_squad`, `sarim_rifles`,
`mortar_team`, `yahalom_squad`, `sniper_team`.

Three units per session, one importer run and one gate run each, two batches per
visual bless (from CI numbers only).

**B0 is the lead's priority batch (29 Sep, GH-286).** It takes five units out of the
plan below and jumps the queue: `recon_drone` and `attack_drone` (from B1),
`demo_squad` and `at_team` (from B5), and `apc_eitan`, which is **new spend**: it was
A3.2's ramp-vehicle scope and moves up, so it is the one line that raises the total.
B1 is dissolved: it kept `loiter_drone` alone at 25 credits, and a one-unit batch buys
nothing, so `loiter_drone` folds into B2 (B1's other purpose — proving the
remesh-to-roles path on units — is B0a's now). B5 keeps `breach_team`. B0 is five units,
so it runs as two sessions, B0a (drones and the Eitan) and B0b (the two figure teams);
the numbers tables and ready prompts for all five are in `meshy-prompts-units.md`.

| batch | units | why this order | credits |
|---|---|---|---|
| **B0a** | `recon_drone`, `attack_drone`, `apc_eitan` | lead priority, GH-286; no rig; the Eitan is the first textured vehicle, so the refine-then-remesh texture question is measured here | 25 + 25 + 35 = 85 |
| **B0b** | `at_team`, `demo_squad` | lead priority, GH-286; the first rigged figures; needs the A-pose CLI flag (landed) and the infantry bake list (§7 q1, landed empty) | 40 + 40 = 80 |
| | *B0 subtotal* | *ceiling 330: one re-roll per unit, on the lead's go only* | *165* |
| B2 | `gun_truck`, `manpad_team`, `recoilless_team`, `loiter_drone` | closes the no-GLB list; four units because B1 folded in (the drone is the cheap one) | 35 + 40 + 40 + 25 = 140 |
| — | *bless 1 (B0 + B2)* | | |
| B3 | `militia_cell`, `rpg_team`, `atgm_cell` | sets the irregular look B4 is judged against | 120 |
| B4 | `mortar_crew`, `charge_squad`, `digger_crew` | | 120 |
| — | *bless 2* | | |
| B5 | `breach_team` | the last KDF team, judged beside `meshy_soldier`, `at_team` and `demo_squad` | 40 |
| B6 | `moto_rpg` + 2 reserve slots | the bike is a 25-credit vehicle part; its riders are B3's rigged figures re-posed seated | 25 |
| — | *bless 3* | | |
| | **planned total** | 165 + 140 + 120 + 120 + 40 + 25 | **610** |
| | reserve: two slots × 40, spent only on the lead's go | unchanged | +80 |
| | B0 re-roll allowance (GH-286: ceiling 330 less 165 planned) | one re-roll each, on the lead's go | +165 |
| | **ceiling** | 610 + 80 + 165 | **855** |

Reconciled against the old plan: 575 planned, less B1's recon and attack (50) and B5's
demo and at_team (80), plus B0's 165, gives 610 — the difference is exactly the Eitan's
35. That is about **$12.20 planned, $17.10 at the ceiling**, at $0.02/credit (was $11.50
and $13.10). The G1 figure (454 held on 18 Sep against ~540) predates the reorder and
is not re-checked here (a balance query is an API call): GH-286 says B0 waits on the
October credits, and everything after B0 waits behind it.

## 7. Open questions for the lead

Each has a recommended default; the batches run on the default unless you say
otherwise.

1. **Where does a shipped infantry bake get its exemption?** GH-160 was answered
   "ship the bakes". **Done:** `TEXTURED_INFANTRY_TYPES`
   (`packages/render/src/three/units/textured-infantry.ts`) sits beside the
   building and vehicle lists, pinned against `TEXTURED_INFANTRY_EXEMPT` in
   `tools/validate_mesh_assets.py` by the same Python-vs-TS test. It is empty
   now and B0b fills it one team at a time as each lands.
2. **Does `gun_truck` ship a bake?** **Default: yes**, to match `technical` beside
   it (+10 credits). Drones stay palette-painted — at 26 px a bake buys nothing.
3. **Crew weapons: kit geometry or new Meshy parts?** **Default: kit geometry**
   (mortar, ATGM post, recoilless tube, MANPAD tube already pass IoU). Meshy parts
   would add 25 credits each, ~150 in all.
4. **One base per team, or one per faction look?** Per team is 40 × 11. Sharing
   three rigged figures (KDF, irregular plain, irregular keffiyeh) and re-posing
   them in Blender would cost ~120 + parts and finish in two sessions, at the risk of
   the roster looking cloned. **Default: per team**, as GH-179 reads.
5. **Should `gun_truck` and the drones export their existing sources instead?**
   `art/src/vehicles/gun_truck.blend` and `tools/drones/author_attack_drone.py`
   already exist and would ship for 0 credits in the palette look. **Default: Meshy**,
   so the roster reads as one register; say the word and the drones (B0a's two, B2's
   one) drop to 0 credits.
6. **Trial smart-topology once?** Image-to-3D smart-topology with texture is 15
   credits and might replace preview + refine + remesh (35). **Default: no** — the
   remesh path is measured; smart-topology is not, and a trial is a spend.
7. **Rigging through the web UI until the CLI has `rig`.** **Default: yes**, logged
   by hand in the ledger; the CLI task lands before B2 if it can.
8. **Does the Eitan ship a texture bake?** (GH-286, B0a.) **Default: yes**, at the 35
   credits the issue prices: it needs `apc_eitan` added to `TEXTURED_VEHICLE_TYPES` and
   `TEXTURED_VEHICLE_EXEMPT` together, so the palette and fill checks skip it and only
   silhouette IoU runs, exactly like the Lavi and the Namer it drives beside. The
   alternative is a palette-painted Eitan at 25 (−10) — one register less than its
   neighbours, and a bake-free hull is what the kit build already is.
9. **Is `loiter_drone` distinct from `attack_drone`?** They share the display name
   "Loitering Munition" but are different units on opposite sides. **Default: distinct,
   two generations** — the KDF `attack_drone` a blunt cylinder with a cross tail, the
   Sarim `loiter_drone` a swept delta wing — because one shared mesh recoloured is an
   IoU of ~1.0 and the gate reads alpha only (`render_attack_drone.py` records this).
   `loiter_drone` is 25 credits inside B2.
10. **How big is a drone drawn as a mesh?** The sprites draw air at `SIZE_CLASS`
    ×1.5 (recon 25.8 px against a soldier's 25.7), but a vehicle GLB has no such
    multiplier: a real 0.9 m recon drone would draw at 0.3 tile, roughly a third the
    size the player sees today. **Default: bake the ×1.5 into the GLB** (recon 1.35 m,
    attack 1.58 m, loiter 2.43 m) and record the real metres in the provenance line —
    zero code, same on-screen size, at the cost of "size is compressed only through
    `SIZE_CLASS`". The alternative is a one-line air multiplier in the mesh-vehicle
    path (`render-vfx`).
11. **Wheel pivots on the Eitan.** GH-286 and A1.3 speak as if wheel pivots exist. They
    do not: A1.3 shipped the hull half only (four-corner conform, pitch, roll) and
    left wheel spin out as R-J, because no shipped GLB has an addressable wheel. A
    Meshy Eitan is one welded mesh, so it also loses the one advantage the kit Eitan
    had (eight wheels still separate in `author_eitan.py`). **Default: B0 keeps
    `turret_pivot` and nothing else**; the axle positions are recorded in
    `meshy-prompts-units.md` for a later wheel package. Cutting eight wheels out of the
    scan inside B0 is art-lane work several times the size of the batch.
12. **The Eitan's remote weapon station.** **Default: kit geometry** (`kit.rws`) on a
    ring the Meshy hull is asked to leave empty, 0 credits, `turret_pivot` placed by
    measurement. A Meshy RWS part is +25.

## 8. Measured in B2 (2026-09-30)

- **§4's open question is closed: a Meshy remesh of a refined task keeps its
  bake.** The gun truck's remesh (5,000 tris) arrived with base colour, normal and
  metallic-roughness maps in one `BakedMaterial`; no `retexture` was needed and
  the unit stayed at 35 credits.
- **§3's team-file cap does not account for `rig.py`'s copies.** A kneeling
  figure ships three geometries (deployed kneel, D6 standing walker, prone
  corpse), so a Meshy figure remeshed at the bible's 2,000 would put a two-man
  crew near 11k. B2 remeshed at 1,500 and decimated corpses to half: 7,368 and
  8,936 tris for the two teams.
- **A rigged figure without a bought Meshy rig works:** cut at `rig.py`'s joints,
  rigid-bound, `rig.py`'s own clips (`tools/units/import_meshy_crew_team.py`).
  Its cost is the four per-figure copies above and a corpse that is the A-pose
  body laid flat rather than a posed fall.
- **Sarim machine line, used for `loiter_drone` and proposed for §5:** "a crude
  workshop-built machine of an irregular militia in sun-faded dusty paint with
  rough welded seams".
- **Meshy honours the silhouette, not the angle or the count.** The gun truck's
  "28 degrees" came back at 7.6 (fixed in Blender about the trunnion); the drone's
  "two wingtip fins" came back as one tail fin, its "pusher" prop on the nose,
  plus landing gear; the MANPAD figure's head wrap came back as a bare head.
  Every one was fixed in Blender rather than re-rolled.

## 9. Measured in B3 (2026-09-30)

- **A refine-then-remesh figure ships its bake through rig.py.** The
  remesh's `BakedMaterial` survives every cut (`_piece` keeps UVs and the
  slot); a `kit.blob` joint or a kit keffiyeh joining a textured role borrows
  the material and ONE uv from the nearest source face (or from the shirt,
  for a head wrap), so it takes the local cloth colour. Kit weapons keep no
  UV and stay palette-painted -- `buildMeshUnitTemplate` decides per mesh.
- **Meshy paints a head wrap pink.** Both B3 previews that honoured the wrap
  (rpg, atgm) made it rose/pink-white -- saturated colour on the one part of
  an enemy figure the eye goes to. The importer remaps red-magenta texels on
  the head and collar faces to the faction's tan/limestone at their own
  luminance (`RECOLOUR`). Cheaper than a re-roll and the hue window leaves
  skin and shirt alone. The militia preview ignored the wrap AND the open
  jacket; kit's keffiyeh, coloured from the shirt bake, covers the head.
- **A 2,000-tri A-pose figure is not B2's 1,500 one.** Its arms are near
  horizontal and bent at the elbow, its hands cup upward, and its chest rig
  is wider than the 0.105 H torso half-width B2 assumed. The cut now MEASURES
  the torso edge (|y| bands above the armpit line), the elbow (the lowest
  band mid-arm), the wrist (a band inside the fingertips), classifies a face
  by its OUTERMOST vertex (a 6 cm triangle straddling the armpit otherwise
  stays behind as a spike), and hangs upper arm and forearm separately.
  Rifle carriers get both forearms bent forward at the elbow so the kit rifle
  sits at the hands.
- **The neck and head bones sit on the head's own centre**, not the figure
  axis: `mesh_gait.test.ts` reads facing as the bearing from the head joint
  to the face strip, and a head 5 cm off-axis read 26 degrees for a man
  looking straight ahead.
- **The corpse is posed, not laid flat** (B2's weakest point): the cut parts
  re-arranged rigidly before the lay-down, then welded (`remove_doubles`) and
  decimated ONCE -- collapsing each open piece on its own shreds every seam.
- Counts: militia 7,746 / rpg 7,082 / atgm 7,228 glTF triangles, all under
  the 8,000 team cap with the corpse and (for the kneelers) the walker
  included; 333-369 KB each shipped with a 1024 JPEG bake.
