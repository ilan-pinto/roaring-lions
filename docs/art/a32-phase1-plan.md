# WP-A3.2 art consistency -- phase 1: plan and Meshy estimate (GH-185)

**Status: plan for the lead's approval, 2026-10-11. No Meshy call was made and
nothing was exported. Every number below is from the tree at `origin/main`
(`87d213e6`), the shipped GLB bytes, `pnpm validate:meshes` run on this
worktree (exit 0, log quoted in §5), `pnpm meshy -- estimate` (free) and the
reference sheets in `docs/art/a32-phase1/`.**

## 0. The premise is stale, and the plan starts from that

The brief names "the four ramp-coloured buildings (concrete, shanty, wall,
camp) and four ramp-coloured vehicles (apc_eitan, dozer_d9, apc_kipod,
scout_shachaf)" to be textured or replaced. **All eight already ship a Meshy
bake on `main`, since 30 Sep 2026:**

| asset | landed | how | prompt and numbers |
|---|---|---|---|
| `concrete`, `shanty`, `wall`, `camp` | PR #314 (`8be8f470`, `7fe5ea36`, `12933c12`, `48ad958c`) | Meshy text-to-3D, refine **2k**, remesh; `tools/buildings/export_meshy_ramp.py`; own 2048 bake | `docs/art/meshy-prompts-ramp.md` |
| `apc_eitan`, `apc_kipod` | PR #310 (`123996c2`, `67395cf0`, GH-286 B0a) | same, `tools/vehicles/export_meshy_apc.py` | `docs/art/style-bible.md` §6, B0a |
| `dozer_d9`, `scout_shachaf` | PR #314 (`6826474b`, `f31900e0`) | same, `tools/vehicles/export_meshy_ramp.py` | `meshy-prompts-ramp.md` |

Both exemption lists carry them (`TEXTURED_BUILDING_TYPES` /
`TEXTURED_BUILDING_EXEMPT`, `TEXTURED_VEHICLE_TYPES` / `TEXTURED_VEHICLE_EXEMPT`,
pinned by the two `textured-*.test.ts`), the kit pass has grafted `kit_*` nodes
into the four vehicles (#433, 8 Oct), and GH-185's own checklist ticks all
eight. `docs/art/a32-remainder-plan.md` (2 Oct) planned what was left AFTER
the ramp set -- the relay hut, the pump house, damage states (#359, landed)
and the licensing pass (#412, landed) -- and never re-judged the ramp set
itself. That is the one thing this plan does: **do the eight, now that they
are textured, match the photographed set?** Measured below, the honest answer
is "nearly, with five tone defects and one shape defect, all but one fixable
in Blender at 0 credits".

What is still open on GH-185 after this: the Meshy commercial-tier
confirmation (the lead's own read of the plan terms; nothing in the tree can
do it), and the hall wreck's weight (a32-remainder-plan decision 4).

## 1. The reference sheet

`docs/art/a32-phase1/buildings.jpg` and `vehicles.jpg`: the A3.2 set on the
top row, the photographed / supplied set on the bottom row. Each tile is the
shipped GLB with its own bake (nothing repainted; kit hidden, wreck twin
hidden, so it is what a fresh-campaign player sees), the 512 px still, the
same still at 64 px (`GAMEPLAY_ZOOM`), and its pure-black silhouette.

**Capture conditions** (state them with any number read off the sheet):
headless Blender 5.2.0, Eevee 64 samples, `render_rig.frame_camera` (the
locked dimetric camera, each asset framed to its own bounds, so px/m differs
per tile and is printed in `render_ref.py`'s log), one sun toward azimuth
135 deg / altitude 55 deg in the camera frame (`lighting.ts`'s
`SUN_DIRECTION`, the camera's left), limestone.0 at 3.2, the portraits' sky /
bounce hemisphere at 0.7 / pi, `Standard` view transform, film transparent.
Material-less role meshes (the palette weapon stations) take the game's own
`liftTone(rampForVehicleRole)` from `tools/src/portrait-roles.ts`
(`roles.json` beside the sheets). It is an approximation of the game's light
for a side-by-side judgement, not a golden capture; the gate renderer could
not be used because it repaints every textured mesh from the palette before
rendering. `render_ref.py` and `composite.py` beside the sheets re-make
them; no RNG, no `mathutils.noise`.

**Register, measured over the opaque pixels of each 512 px still** (mean
luminance, mean HSV saturation, circular-mean hue):

| asset | L | sat | hue (deg) | reads as |
|---|---|---|---|---|
| `concrete` | 0.323 | **0.098** | **60** | cool neutral grey; the only desaturated building |
| `shanty` | 0.255 | 0.301 | 41 | in register -- but a **red hipped tile roof**, see §2 |
| `wall` | **0.405** | 0.277 | 40 | pale limestone block; brightest building bar the warehouse roof |
| `camp` | 0.258 | 0.417 | 52 | olive canvas and tan sandbags, in register |
| `house` | 0.253 | 0.288 | 33 | the reference: warm tan stone |
| `apartment` | 0.219 | 0.296 | 36 | warm tan |
| `warehouse` | 0.441 | 0.197 | 40 | pale (its white roof dominates the plan) |
| `apc_eitan` | 0.173 | 0.269 | **95** | the one **blue-green** hull in an olive fleet |
| `dozer_d9` | 0.155 | **0.401** | 71 | olive, the most saturated hull |
| `apc_kipod` | 0.172 | 0.352 | 73 | olive -- the fleet's reference tone |
| `scout_shachaf` | 0.171 | 0.230 | 76 | dusty olive (its `olive_shift` already applied) |
| `mbt_lavi` | 0.223 | 0.271 | 56 | **camouflage** -- the only patterned hull |
| `ifv_namer` | 0.202 | 0.326 | 65 | sand-olive (`sand_olive` applied at export) |
| `jeep_shoded` | 0.155 | 0.204 | 64 | dark olive |

Two things the sheet settles. **Geometry is not the problem**: every one of
the eight is a Meshy remesh at the bible's class target, with the same
read at 64 px as its neighbours (fill 0.17-0.29 of frame, every silhouette
distinct), and the gate passes with headroom stated in §5. **Tone is**: the
four KDF hulls sit at four different olives (hue 71-95, sat 0.23-0.40), the
Eitan is visibly a different paint from the vehicle parked beside it, and
the concrete is the one cold object on a warm map. One shape defect: the
shanty's roof.

## 2. Per asset

Legend. **Keep+bake** = keep the shipped geometry and bake, change texels in
Blender (`export_meshy_*.py` already carries `scrub_white`, `olive_shift`,
`sand_olive` -- HSV passes over a texel band, UV-preserving, 0 credits).
**Regenerate** = a new Meshy model at maximum detail (the lead's rule since
2 Oct: `text --refine --tex 8k` 35 + `remesh` 5 = **40 credits**), i.e. a
NEW silhouette with every downstream step in §4 re-done. Triangle budgets
are the style bible's §3 class rows; "today" is the shipped count from the
GLB bytes (vehicles: live tris, kit nodes in brackets).

### Buildings

| asset | today | budget (remesh / cap) | recommendation | prompt, if regenerated | credits |
|---|---|---|---|---|---|
| `concrete` | 7,650 tris; 3.6 x 5.3 x 9.0 m; directional front 171 / 11 px (15.6x) | 8,000 / 20,000 | **Keep+bake, optional warm pass**: pull hue 60 -> ~45 and sat 0.10 -> ~0.18 so it sits with the house/apartment tan instead of reading as a different climate. A blockhouse is grey by nature, so this is the lead's taste call, not a defect. | not proposed; the shipped prompt (`meshy-prompts-ramp.md`) stands | 0 |
| `shanty` | 7,415 tris; 5.2 x 5.5 x 4.2 m; directional 840 / 0 | 8,000 / 20,000 | **The one real miss.** The prompt asked for a breeze-block shed with a single-pitch corrugated roof weighted with stones; the preview returned a hipped **red clay-tile** roof and shipped as such. Beside the house and apartment it reads as a Mediterranean cottage. **Option A (recommended, 0 credits): keep+bake, retexture the roof band** -- the roof's texels (the `roof` role is its own mesh, so the UV island is known) go from red tile to rust-streaked grey corrugated sheet, hue/sat/value moved and a sheet-rib pattern drawn over them; the hipped shape stays. **Option B (40): regenerate** with the prompt at right and a negative prompt. | *A single low-poly game-ready small single-room breeze-block shed, vernacular construction of a fictional arid river-basin region: unrendered grey breeze-block walls with mismatched patches of faded paint, a SINGLE-PITCH flat lean-to roof of rust-streaked grey corrugated metal sheets sloping down toward the back, weighted with a few stones, no tiles, no hip, no ridge, a plank door standing ajar and one small shuttered window on the front face, a low rooftop water tank, a stack of crates against one side wall, dust and weathering. Real-world scale, 5.5 metres square, 4 metres tall at the front. Grey block, rust-streaked corrugated metal, sun-bleached timber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.* -- negative: *clay tiles, terracotta, hipped roof, pitched roof, cottage, villa* | A 0 / B 40 |
| `wall` | 3,087 tris; 3.0 x 0.6 x 1.4 m; symmetric (no glass, unjudged by design) | 3,000 / 20,000 | **Keep.** Pale limestone block is right for the region; it is the brightest building (L 0.405) and reads a shade chalky at zoom 1. Optional value x0.9 in the same pass as the concrete. | -- | 0 |
| `camp` | 9,543 tris; 7.5 x 7.5 x 3.9 m; symmetric | 10,000 / 20,000 | **Keep.** Olive canvas, tan sandbags, in register with the KDF hulls. The remesh dropped the mast TIP (provenance); rebuilt as a kit `metal` cylinder in Blender if the lead wants the 6 m mast back, 0 credits. | -- | 0 |

### Vehicles

| asset | today | budget | recommendation | prompt, if regenerated | credits |
|---|---|---|---|---|---|
| `apc_eitan` | 7,961 live (+3,266 kit) tris; 7.13 m; hue **95** | 8,000 / 10,000 heavy | **Keep+bake, `olive_shift`** of the green band toward the Kipod's 72 deg (the Shachaf's own pass, -22 deg hue / x0.62 sat / x0.80 value, re-measured for this bake). The four KDF hulls should share ONE olive; the Kipod is the reference because it is the fleet's median and the lead approved it beside the Eitan. | shipped B0a prompt + "plain matte OLIVE-DRAB paint, not forest green" | 0 |
| `dozer_d9` | 7,901 (+2,758) tris; 6.83 m; sat **0.40** | 8,000 / 10,000 | **Keep+bake, optional sat x0.85** toward the fleet (0.27-0.35). The scrubbed white star leaves no visible ghost at any zoom on the sheet. | -- | 0 |
| `apc_kipod` | 8,052 (+3,222) tris; 7.20 m | 8,000 / 10,000 | **Keep as is.** The reference tone. | -- | 0 |
| `scout_shachaf` | 5,076 (+1,906) tris; 4.60 m; sat 0.23 | 5,000 / 8,000 light | **Keep.** Already shifted from grass green at export; the lowest saturation of the four -- if the fleet pass lands, re-measure it against the Kipod and nudge sat up rather than down. | -- | 0 |

**One fleet-level fact outside this scope, for the lead to rule on**: the
Lavi is the only camouflaged hull; every other KDF vehicle is plain olive.
A supplied asset used as-is, so it is not touched here -- but "consistency"
cuts both ways, and the choice is either "the MBT wears camo, the rest do
not" (plausible; accept) or a later Lavi retexture. Named, not planned.

**One cheap improvement that falls out of the fleet pass.** The kit exporter
(`export_vehicle_kit.py`) prints a DEVIATION for the Eitan, Kipod, Shachaf, D9
and Namer because their bakes carry a **uniform metallic map and no
textured `*_metal` node**, so the "third metal rule" paints the kit's
sensors and firepower in the greyest PAINT texel -- the "metal-versus-paint
contrast is weak" note in CLAUDE.md. While the bake is open for the tone
pass, a flat 16 x 16 gunmetal patch (`gunmetal.3`, neutral normal, metallic
1) painted into an unused UV island gives each bake an honest metal texel at
0 credits and 0 bytes, and the next kit export pins to it. The patch must be
in an island no face maps to (the exporters already read the UV layout to
split `hull_rubber`).

### The 8k question

All eight were refined at **2k** (B0a and the ramp set predate the 2 Oct
"maximum detail" rule); `textured.TEXTURE_PX` ships every bake at 2048
anyway, so 8k buys "a sharper 2048" (B8's measurement). At the 25-75 px a
unit occupies in play it buys nothing visible; in the garage turntable and
the 600 px unit plates it buys some. Two routes, neither recommended now:

- **Re-refine the existing previews at 8k** -- `pnpm meshy -- refine
  <preview-task-id> --tex 8k` (15) + `remesh` (5) = **20 a model, 160 for
  eight**, IF Meshy still resolves the 30 Sep preview tasks. Files are
  retained three days; whether the task itself can still be refined is
  unverified. `pnpm meshy -- status <id>` is free and answers it before
  anything is spent. A re-refine re-bakes onto a NEW remesh, so the
  silhouette changes slightly and §4 is re-done in full.
- **Regenerate at max detail** -- 40 a model, **320 for eight**. New
  silhouettes, every risk in §5.

## 3. Memory and draw calls -- what a texture costs, measured

- **Draw calls: +0 on every option.** One `BakedMaterial` per asset; the kit
  is merged into its host at template build (`kit-drawcalls.ts` reads 12
  submissions per vehicle, 6 for the D9, at tiers 0 and 3). A texel edit, a
  re-refine or a regeneration keeps one material.
- **GPU memory per texture**: a 2048 x 2048 RGBA8 upload with its mip chain
  is **21.3 MiB** (PERFORMANCE.md, "Memory": "almost all 2048x2048 RGBA8 at
  21.3 MiB each with mips"); 1024 x 1024 is **5.3 MiB**. Logical bytes, the
  same on Metal and SwiftShader.
- **Per asset today**: the eight ship THREE maps each (base colour, normal,
  metallic-roughness, all 2048) = **64 MiB each on the GPU** when drawn; the
  supplied `house`, `apartment`, `warehouse`, `mbt_lavi` and `jeep_shoded`
  ship base colour alone = **21.3 MiB each**. So the "cheap" Meshy-CLI assets
  cost three times the GPU memory of the supplied ones. At 1024 the eight
  would be 16 MiB each (5.3 base-only).
- **Against the budget**: `MEMORY_BUDGETS.mission.gpuMiB` = 1015 on both
  environments, derived from an 882 MiB reading x 1.15; GLB textures were 587
  MiB of that (30 textures). Every option in §2 is byte-neutral on the GPU
  (same maps, same size), so no option here moves `pnpm perf:memory`.
  Dropping the normal and metallic-roughness maps from the eight (as the
  infantry importers do) would free up to 341 MiB with all eight fielded, at
  the cost of the relief the bakes carry; PERFORMANCE.md's option 3
  (2048 -> 1024 in `encode:meshes`) is "the lead's call" and stays so.
- **Download** (Draco, `assets/meshes/`): concrete 1.13 MB, shanty 1.37,
  wall 1.01, camp 1.37; Eitan 1.15, D9 1.29, Kipod 1.33, Shachaf 1.15 --
  the JPEG maps dominate, geometry is under 100 KB each. A texel edit
  changes these by the JPEG's own delta only.

## 4. What is re-done downstream, per route

| step | texel edit (keep+bake) | re-refine / regenerate |
|---|---|---|
| exporter (`export_meshy_ramp.py` / `export_meshy_apc.py`) re-run | yes -- the HSV pass is a function in the exporter, so the GLB is re-exported from the committed `art/meshy/` download | yes, against the new download; scale/turn/split re-measured and printed |
| `pnpm kit:meshes` (vehicles) | **yes** -- the graft keeps every live accessor byte-identical, so the shipped `art/parts/kit/<id>.glb` re-grafts unchanged; the kit's pinned texels move WITH the bake (same UVs), so the kit follows the hull's new tone by construction. Re-run `export_vehicle_kit.py` only if the metal-texel patch above is added (it re-picks the three tones and prints the DEVIATION lines) | **yes, and the kit itself is re-exported**: parts are placed by ray-casts off the hull and refused if off the mock's numbers or clashing (`kit_clash.py`, 72 headings); a new hull needs the mock numbers re-read and any new DEVIATION / CLASH_EXEMPTION named |
| `pnpm wreck:meshes` | yes (idempotent; recipe fractions of measured bounds -- unchanged bounds, unchanged pose) | yes; recipe re-tuned if the bounds moved |
| `pnpm encode:meshes` | yes | yes |
| `pnpm validate:meshes` | yes (textured: silhouette IoU, facing, kit owed, kit renders) | yes -- and the IoU and facing numbers in §5 are the ones that can go red |
| `tools/render_unit_portraits.py --only=<id>` (vehicles) | yes | yes |
| `pnpm plates:units -- --only=<id>` (vehicles; `plates:units` with no `--only` is the reliable full set) | yes | yes |
| `unit-footprints.ts` -> `selection-ring` tables (generated, never hand-edited) | no (bounds unchanged) | yes |
| golden visual gate | `quiet`, `vehicle` and `kitted` frame the parked sandbox force (Eitan, Kipod, Shachaf, D9 are in it); a hull tone change moves those frames -> one bless from CI numbers; `aftermath`/`relief`/`open-ground` should read 0 | same, plus the silhouette and kit toggles |
| `docs/ASSET_PROVENANCE.md` | one line per asset ("bake tone pass, date") | new task ids, AI-art disclosure in the PR |
| buildings only: `building_facing.py` | no change (texels do not move pixels) | a regenerated shanty must keep its door on the camera half -- see §5 |

## 5. Risks, with the gate's own numbers

`pnpm validate:meshes` on this worktree, 2026-10-11: `mesh gate passed: 87
mesh unit(s) rendered and checked against each other`, exit 0. The kitted
block prints each vehicle's worst neighbour (limit 0.88, own base excluded):

```
apc_eitan:     shipped demo_tzav 0.838 -> F2 vs gun_truck 0.854
apc_kipod:     shipped apc_eitan 0.820 -> A3 vs gun_truck 0.829
dozer_d9:      shipped ifv_namer 0.845 -> A3 vs ifv_namer 0.864
scout_shachaf: shipped gun_truck 0.787 -> L2 vs gun_truck 0.823
```

- **Silhouette IoU.** The D9 at armour tier 3 sits **0.016 under the limit**
  against the Namer, the Eitan at firepower 2 is 0.026 under against the gun
  truck. A texel edit moves IoU by exactly 0. A regenerated D9 or Eitan is
  more likely than not to collide somewhere in its twelve kit variants, and
  the fix would then be a distinguishing profile (blade, stack, ripper for
  the D9), never the threshold. Buildings: no collision today; a regenerated
  shanty's nearest neighbours are `house` and `pump_house` (same shed
  grammar), and the lean-to roof is the lever that separates it.
- **Facing gate.** `concrete` reads directional 171 / 11 px (15.6x),
  `shanty` 840 / 0 -- both from their `glass` split on the camera half.
  `wall` and `camp` are "ships a photographed facade but models no glass
  role -- this gate cannot see its front" (log), by design, like the
  warehouse. A regenerated shanty goes through the exporter's own yaw rule
  (dark-opening area on `+X`/`-Y`, printed for all four candidates); if the
  bake's openings do not read (the relay's board-form concrete did not), the
  yaw is set by hand and printed.
- **The metal-texel rule (K3).** Any bake edit must keep the three pinned
  windows flat (luminance spread < 0.02 linear over 16 x 16, neutral normal):
  a global HSV shift keeps flatness, a local repaint near a pinned window
  does not. `export_vehicle_kit.py` refuses otherwise; re-run it after the
  edit and read its tone lines. The `--preview` stills are the check.
- **Kit on a replaced hull.** Contract v5 (vehicles): a kit part shares its
  host's parent, local TRS, attribute set and material; `applyVehicleKit`
  merges host-first. A regenerated hull with a different UV layout breaks
  every pinned texel (wrong colour, not a crash) until the kit is
  re-exported; `check_kit_owed` goes red if a (track, tier) node is missing.
- **Three days.** Meshy keeps files three days; a `refine`/`remesh` on a
  30 Sep task is unverified -- probe with `status` (free) before counting on
  the 20-credit route.
- **Visual bless.** Every vehicle tone change moves `quiet`/`vehicle`/
  `kitted`; one bless from CI numbers, not from the branch, after the
  pictures are looked at.

## 6. Credits and USD -- from `pnpm meshy -- estimate`, 2026-10-11, no API call

```
estimate text --refine --tex 8k : 20 + 15 = 35 credits (~$0.70)
estimate image --tex 8k         : 35 credits (~$0.70)
estimate refine --tex 8k        : 15 credits (~$0.30)
estimate remesh                 : 5 credits  (~$0.10)
spent: 176 task(s) -- 2190 estimated, 2185 consumed, ~$43.80
```

($0.02/credit is the CLI's Pro-plan assumption, "stated as an estimate";
the pricing page was quoted 2026-09-18 and has held across 2,185 consumed.
Note for anyone re-running it in zsh: `pnpm meshy -- estimate text --refine
--tex 8k` reaches the CLI with the flags intact only when each flag is its
own shell word; a quoted variable arrives as one word and the CLI prints its
help.)

| asset | recommended route | credits | option, if the lead wants it | credits |
|---|---|---|---|---|
| `concrete` | keep (+ optional warm pass, Blender) | 0 | re-refine 8k (20) / regenerate (40) | 20 / 40 |
| `shanty` | keep + roof retexture (Blender) | 0 | **regenerate at max detail, lean-to roof** | 40 |
| `wall` | keep | 0 | re-refine 8k / regenerate | 20 / 40 |
| `camp` | keep (+ optional mast tip, Blender) | 0 | re-refine 8k / regenerate | 20 / 40 |
| `apc_eitan` | keep + `olive_shift` to the fleet tone (Blender) | 0 | re-refine 8k / regenerate | 20 / 40 |
| `dozer_d9` | keep (+ optional sat x0.85) | 0 | re-refine 8k / regenerate | 20 / 40 |
| `apc_kipod` | keep (reference) | 0 | re-refine 8k / regenerate | 20 / 40 |
| `scout_shachaf` | keep | 0 | re-refine 8k / regenerate | 20 / 40 |
| metal-texel patch, five bakes | Blender | 0 | -- | -- |
| **recommended total** | | **0 credits, $0.00** | | |
| shanty regeneration alone | | | | **40 (~$0.80)** |
| 8k re-refine, all eight (if the previews still resolve) | | | | **160 (~$3.20)** |
| full regeneration, all eight (not recommended) | | | | **320 (~$6.40)** |

Proposed cap for phase 2, should the lead take the shanty option: **80**
(one model and one re-roll, the re-roll only on the lead's own go after the
preview, per the bible). Any other spend is a stop and a report.

## 7. Phase 2, as it would run (the 0-credit path)

1. **Fleet tone pass** (one task): measure the four KDF bakes' hue/sat/value
   bands in the linear buffer the way `sand_olive` did for the Namer; shift
   the Eitan onto the Kipod's band, nudge the D9 and Shachaf; add the
   gunmetal patch to the five bakes; re-export; `kit:meshes`,
   `wreck:meshes`, `encode:meshes`; `export_vehicle_kit.py --preview` to
   read the kit tones; `validate:meshes`. Capture sheet: the four at zoom
   1.0 and 2.5 beside the Lavi and the Namer, before and after (the
   `gait-captures.ts` pattern -- "before" served from `git show`), one Metal
   browser, closed after.
2. **Shanty roof** (one task): roof-island retexture in the ramp exporter,
   re-export, `collapse()` wreck re-run, `validate:meshes` (facing must
   still read directional), capture beside the house.
3. **Concrete / wall warm pass** (one task, only if the lead takes it).
4. **Portraits and plates** for the four vehicles; `mesh_roster.test.ts`,
   `pnpm test`, `typecheck`, `lint`.
5. **Provenance lines**, PR, CI `visual` numbers, one bless.

Every change is a texel pass over a committed Meshy download, so nothing
here is new AI art; the PR still carries the standing Meshy disclosure for
the eight, as #310 and #314 did.

## 8. Decisions for the lead

1. **Accept the reframing**: the eight are textured; phase 2 is a tone and
   roof pass at 0 credits, not a texturing or replacement job.
2. **Fleet olive**: the Kipod's tone as the KDF reference, the Eitan shifted
   onto it (recommended); or leave the four as they are.
3. **The shanty roof**: A, Blender retexture of the tile roof to corrugated
   sheet, hipped shape kept (recommended, 0); or B, regenerate with the §2
   prompt at max detail (40, cap 80).
4. **Concrete and wall**: warm / darken toward the house's register, or keep
   the grey blockhouse and pale wall as the region's own variety.
5. **8k**: not now (recommended); or probe the previews and re-refine the
   eight for 160.
6. **The Lavi's camouflage** against an all-olive fleet: accept as the MBT's
   own scheme, or name a later retexture. Out of this package either way.
7. **The metal-texel patch** on the five "third-rule" bakes: take it with
   the tone pass (recommended) or leave the kit on paint tones.
