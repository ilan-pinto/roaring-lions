# Roaring Lions — art style bible and Meshy prompt template

**WP-A3.1 (GH-179) · Status: draft for the lead's approval · 2026-09-28**

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
| prop | the cap | 120–400 | real metres | seven props on ground-plan2 |
| building (palette) | — | 20,000 | tile multiples | clinic 19,225, hall 19,491 |

Counts are glTF triangles, measured 2026-09-28 from the shipped `art/meshes/**`.

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

**Unverified until unit 1 of B2:** that remesh of a *refined* task keeps its
texture. If it does not, step 3 moves after step 4 (refine cannot take a remesh
task, so the fallback is `retexture`, also 10). Measure it once; do not guess twice.

**Rules that are not optional:**

- **One preview per concept.** A wrong preview is fixed in Blender. A re-roll is a
  new spend with its own announcement and go, never speculative.
- **Every call is announced first** with its estimate; `--yes` is for runs the lead
  already approved.
- **Supplied `.blend`/`.glb` files are used as-is** unless the lead says otherwise.
- **Zero materials in a GLB**, except named textured exemptions
  (`TEXTURED_BUILDING_TYPES` / `TEXTURED_MESH_EXEMPT`); an infantry bake needs its
  own named list first (Q1).
- **Every spend is in `art/meshy/ledger.jsonl`**; `pnpm meshy -- spent` answers "how
  much".

**CLI prerequisites** (small tasks, before B2): `remesh` is on `feat/ground-plan2`
(`b764f0fd`), not yet `main`; the `text` preview hard-codes `pose_mode: ''`, so
riggable figures need an A-pose flag; refine does not send `remove_lighting`; and
there is no `rig` command (priced at 5 in `pricing.ts`). Until it lands, rigging runs
in the Meshy web UI and is logged by hand.

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

---

## 6. Batch plan

**Scope.** The six units with no GLB (`gun_truck`, `loiter_drone`, `attack_drone`,
`recon_drone`, `manpad_team`, `recoilless_team`) and the twelve kit-built teams in
`tools/units/teams.py`. Two names sit in both lists — `manpad_team` and
`recoilless_team` are kit-built teams that never exported a GLB — so the work is
**16 distinct units**, not 18. The other ten kit-built teams: `demo_squad`,
`at_team`, `breach_team` (KDF); `militia_cell`, `rpg_team`, `atgm_cell`,
`mortar_crew`, `charge_squad`, `digger_crew`, `moto_rpg` (enemy). Already
Meshy-sourced and out of scope: `inf_squad`, `sarim_rifles`, `mortar_team`,
`yahalom_squad`, `sniper_team`.

Three units per session, one importer run and one gate run each, two batches per
visual bless (from CI numbers only).

| batch | units | why this order | credits |
|---|---|---|---|
| B1 | `recon_drone`, `attack_drone`, `loiter_drone` | cheapest, no rig, no texture: proves the remesh-to-roles path on units | 75 |
| B2 | `gun_truck`, `manpad_team`, `recoilless_team` | closes the no-GLB list; first textured vehicle, first rigged figures | 115 |
| — | *bless 1 (B1 + B2)* | | |
| B3 | `militia_cell`, `rpg_team`, `atgm_cell` | sets the irregular look B4 is judged against | 120 |
| B4 | `mortar_crew`, `charge_squad`, `digger_crew` | | 120 |
| — | *bless 2* | | |
| B5 | `demo_squad`, `at_team`, `breach_team` | the KDF three, judged beside `meshy_soldier` | 120 |
| B6 | `moto_rpg` + 2 reserve slots | the bike is a 25-credit vehicle part; its riders are B3's rigged figures re-posed seated | 25 |
| — | *bless 3* | | |
| | **planned total** | | **575** |
| | reserve: two slots × 40, spent only on the lead's go | | +80 |
| | **ceiling** | | **655** |

That is about **$11.50 planned, $13.10 at the ceiling**, at $0.02/credit. The
G1 figure (454 held on 18 Sep against ~540) is below the plan: B1–B3 (310) fit in
the current balance; B4–B6 wait on the October top-up.

---

## 7. Open questions for the lead

Each has a recommended default; the batches run on the default unless you say
otherwise.

1. **Where does a shipped infantry bake get its exemption?** GH-160 was answered
   "ship the bakes", but infantry has no named textured list. **Default:** add
   `TEXTURED_INFANTRY_TYPES` beside the building and vehicle lists, pinned by the
   same Python-vs-TS test, filled one team at a time as it lands.
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
   so the roster reads as one register; say the word and B1 drops to 0 credits.
6. **Trial smart-topology once?** Image-to-3D smart-topology with texture is 15
   credits and might replace preview + refine + remesh (35). **Default: no** — the
   remesh path is measured; smart-topology is not, and a trial is a spend.
7. **Rigging through the web UI until the CLI has `rig`.** **Default: yes**, logged
   by hand in the ledger; the CLI task lands before B2 if it can.
