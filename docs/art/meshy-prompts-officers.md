# Meshy prompts and numbers tables — the officers (GH-298)

**2026-09-30 · art only, Stage 5 wiring deferred · numbers approved by the lead as
"155 credits planned, 310 cap" (figure teams 40 each; tank 35 if a new base is needed).**

Sibling of `meshy-prompts-units.md` (batch B0) and `meshy-prompts-characters.md`. The four
officers are `docs/superpowers/specs/2026-09-30-field-commanders-design.md` §2 and §7; the
names, bios and look notes are `docs/campaign/heroes/names.md`. Every prompt below is the
style bible §5 template with its slots filled. The credit figures are `pnpm meshy -- estimate`
(no API call) and B0b's measured per-unit cost (style bible §8).

**Held, not wired.** No unit JSON is added, so nothing here has a `mobility.speed_tiles_s`,
a `SPRITE_MAP` row or a `mesh-catalogue.ts` entry. The four GLBs are listed in
`HELD_MESH_FILES` (the GH-277 field-works precedent) and named there by the unit type that
claims them at Stage 5 (spec §8.2 E1). Two consequences are stated rather than hidden:

- `rig.py` sizes a walker's stride from the team's OWN unit JSON and refuses to guess one.
  The officer teams walk with a rifle company, so the importer reads **`inf_squad.json`'s
  `speed_tiles_s`** through `rig.unit_speed_tiles_s("inf_squad")` and says so in its log. When
  the staged JSON lands with a different speed, re-run the importer.
- `pnpm gait:meshes` is scoped to `RIGGED_UNIT_MESHES`, so a held team GLB carries no
  `rl_gait` extra until Stage 5 adds its catalogue entry and re-runs the pass. The runtime
  reads a missing gait as "no rate-match", nothing worse (`mesh-unit.ts`).

## Credits, planned against the 155

| unit | class | steps | credits | cap |
|---|---|---|---|---|
| `officer_infantry` | figure team | preview 20 + refine 10 + remesh 5 | **35** | 80 |
| `officer_fires` | figure team | preview 20 + refine 10 + remesh 5 | **35** | 80 |
| `officer_engineer` | figure team | preview 20 + refine 10 + remesh 5 | **35** | 80 |
| `officer_armour` | Blender variant of the shipped `mbt_lavi.glb` | none | **0** | 35 (a new textured base, only if the variant cannot clear IoU 0.88 against `mbt_lavi`) |
| **total** | | | **105 planned** (≈ $2.10) | 155 planned / 310 cap unchanged |

The 5-credit Meshy rig in the bible's §4 row is not bought, as B0b measured (§8): a remesh
cut into `rig.py`'s parts is driven by `rig.py`'s own clips. The preview and its refine are
one CLI call (`text ... --pose a-pose --refine --tex 2k`), which is how B0b spent them: the
CLI has no separate refine command, so a preview cannot be inspected before its refine is
charged. That is why a bad preview costs 30, not 20, and why a re-roll on any unit is a
STOP-and-report, never a second call on this author's own judgement.

**Second figures cost 0.** Each officer team is the officer (one new Meshy figure) plus one
figure cut from a B0b remesh already in the tree — `art/meshy/at-team-…-01a0f2fd/model.glb`
(the KDF man with the box rucksack, which reads as a manpack radio) for the two signallers,
and `art/meshy/demo-squad-…-01a0f302/model.glb` (goggles, knee pads, tool bag) for Dalia's
sapper. That gives every team two DIFFERENT people rather than a cloned officer, which is
what "reads as a distinct person at zoom 2.5" needs. Both bakes ship in one atlas per team
(two 1024 squares side by side, UVs remapped), so each role stays one primitive with one
material, as the mesh contract and `import_meshy_kdf_team.py`'s own join check require.

## Shared numbers (all three teams)

| item | number | source |
|---|---|---|
| remesh `--polycount` | **2,000** per figure | bible §3 |
| shipped cap | 2,500 per figure, **8,000** per team file incl. kit parts | bible §3 |
| bake | yes: ask 2048, ship **1024**, JPEG q85, base colour only; team listed in `TEXTURED_INFANTRY_TYPES` + `TEXTURED_INFANTRY_EXEMPT` in the same change | B0b |
| footprint | feet at z = 0, `+X` forward, figures within ±1.2 m | bible §2 |
| rig | `rig.py` bones and clips through `import_meshy_kdf_team.py`'s cut (`tools/units/import_meshy_officers.py` reuses it); rigid bind, no weight painting; clips `idle, move, fire, down, wreck`; a prone corpse per figure | B0b |
| faction | KDF (`teams.TEAMS` has no row, so the gate defaults to `kdf` with its named warning) | `render_mesh_gate.py` |
| the officer tell at 64 px | a **whip antenna** on the second figure (kit tube, 1.0–1.35 m, pitched 80°), in every team | task brief |
| the person tell at 2.5 | headgear silhouette per officer (cap / boonie / helmet-with-headset), a woman's build for Maya and Dalia, kit in the bake | task brief |

## 1. `officer_infantry` — Capt. Maya Pereg, infantry company commander (officer + signaller)

| item | number |
|---|---|
| figures | `maya` standing at (0.16, −0.36), 1.68 m, no rifle (map case in her hands is the bake's); `sig` (at_team remesh) standing at (−0.24, 0.36), 1.78 m, kit rifle at the hung right hand, whip antenna 1.35 m at 80° rising from the rucksack top |
| headgear | soft olive patrol cap (the one deviation from the KDF faction line's helmet clause, for the headgear tell the brief asks for) |
| nearest neighbours | `yahalom_engineer` (two standing, horizontal mast), `meshy_soldier` (three standing), `officer_engineer` (below). Levers: side-by-side pair, the whip's height doubling the frame, the map case |
| IoU | measured by `pnpm validate:meshes`; anchors are free to move if it reads ≥ 0.88 |

```
A single low-poly game-ready woman infantry officer, a soldier of a fictional army in a plain
olive-drab field uniform, black nylon plate carrier, tan suede boots, and a soft olive patrol
cap with a short brim instead of a helmet, dark hair tied back. Standing in a relaxed A-pose,
arms slightly away from the body. A flat clear-fronted map case hanging on the chest from a
neck strap, and a radio handset clipped at the left shoulder. Real-world scale, 1.68 metres
tall. Olive drab cloth, black webbing, tan canvas. Plain even lighting, no baked shadows, no
ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches,
text or markings of any kind.
```

## 2. `officer_fires` — Capt. Sagi Sharav, forward observer (observer + radio operator)

| item | number |
|---|---|
| figures | `sagi` KNEELING at (0.26, 0.30), 1.80 m, `kit.binoculars` at his kneeling eye height on the head bone; a laser designator on a squat kit tripod at (0.74, 0.30) on the team `prop` bone (legs 0.50 m, head box 0.30 × 0.16 × 0.16 at z 0.62); `rto` (at_team remesh) standing at (−0.30, −0.34) with the kit rifle and the whip antenna 1.35 m |
| headgear | wide-brimmed boonie hat |
| nearest neighbours | `at_team` (kneeling gunner + standing spotter, LEVEL tube), `demo_squad`. Levers: mirrored layout, no tube at all, a low tripod in front of the kneeler, the whip |
| IoU | measured by the gate |

```
A single low-poly game-ready forward observer, a soldier of a fictional army in a plain
olive-drab field uniform, black nylon plate carrier, tan suede boots, and a wide-brimmed olive
boonie hat instead of a helmet. Standing in a relaxed A-pose, arms slightly away from the body.
Binoculars hanging on a strap on the chest, a boxy laser rangefinder pouch on the right hip,
and a small radio with a short stub antenna on the left hip. Real-world scale, 1.80 metres
tall. Olive drab cloth, black webbing, gunmetal. Plain even lighting, no baked shadows, no
ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches,
text or markings of any kind.
```

## 3. `officer_engineer` — Capt. Dalia Charsit, engineer commander (officer + sapper)

| item | number |
|---|---|
| figures | `dalia` standing at (0.50, −0.14), 1.70 m, a mine probe (kit tube 1.50 m, r 0.015) held in the right hand and pitched 35° down-forward so its tip nearly touches the ground ahead; `sap` (demo_squad remesh) standing at (−0.42, 0.24), 1.78 m, kit rifle, a satchel charge (`kit.box` 0.34 × 0.14 × 0.24, role `charge`) slung on the left hip, whip antenna 1.0 m |
| headgear | helmet with a bulky headset over it (the helmet clause kept; the headset widens the head profile) |
| nearest neighbours | `officer_infantry` (two standing + whip), `yahalom_engineer`, `demo_squad`. Levers: the pair is IN FILE along `+X` rather than side by side, the diagonal probe, the shorter whip |
| IoU | measured by the gate |

```
A single low-poly game-ready woman combat engineer officer, a soldier of a fictional army in a
plain olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with
a plain olive cover, with a bulky headset with ear cups worn over the helmet, dark hair in a
braid. Standing in a relaxed A-pose, arms slightly away from the body. A small folded map in a
chest pocket, a canvas satchel slung on the left hip, and elbow pads. Real-world scale, 1.70
metres tall. Olive drab cloth, black webbing, tan canvas. Plain even lighting, no baked
shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia,
flags, patches, text or markings of any kind.
```

## 4. `officer_armour` — Capt. Ronen Heled, command Lavi (0 credits)

| item | number |
|---|---|
| source | the shipped `art/meshes/vehicles/mbt_lavi.glb` (Meshy, `art/blend/KDF/tank/`, disclosed), imported with its bake, re-exported as `art/meshes/vehicles/officer_armour.glb` by `tools/vehicles/export_officer_armour.py` |
| nodes | the Lavi's own four (`hull_hull`, `hull_rubber`, `turret_hull`, `turret_metal`) and its `turret_pivot`; the kit additions are joined INTO `turret_hull` / `turret_metal` with UVs pinned to the nearest face of the part they sit on, so every mesh stays textured and one-material |
| additions | a raised commander's cupola on the turret roof (prism r 0.32→0.30, h 0.30, plus a periscope block); a telescoping mast behind the turret in three stepped tubes (r 0.05 / 0.04 / 0.03) to a top at about **z 4.6 m**, with a short crossbar antenna head; two whip antennas 1.6 m at the turret rear corners |
| size | real metres as the Lavi ships them (6.3 m over the barrel, 2.9 m wide); the mast is what changes the silhouette, and it changes the FRAME the gate fits, which is why a thin mast can move IoU at all |
| bake | textured: `officer_armour` in `TEXTURED_VEHICLE_TYPES` + `TEXTURED_VEHICLE_EXEMPT` |
| wreck | `pnpm wreck:meshes -- --id=officer_armour` with a `{ hull: 'tracked', turretPivot: 'turret_pivot' }` recipe |
| IoU risk | **R8**: vs `mbt_lavi` (mesh) and `TNK_HULL`/`TNK_TURR` (sprites). Measured on the export before anything else is decided; if the variant cannot get under 0.88 the fallback is a new Meshy base at 35, announced first |

## Process, per unit

1. `pnpm meshy -- estimate text --refine --tex 2k` (30) and `estimate remesh` (5); announce.
2. `pnpm meshy -- text "<prompt>" --pose a-pose --refine --tex 2k --name <id> --yes`, then
   `pnpm meshy -- remesh <refine task id> --polycount 2000 --name <id> --yes`.
3. `Blender -b --factory-startup --python tools/units/import_meshy_officers.py -- <id>`.
4. `pnpm encode:meshes`; `pnpm validate:meshes`; `pnpm validate:assets`; `pnpm test`;
   `pnpm typecheck`; `pnpm lint`.
5. Provenance in `docs/ASSET_PROVENANCE.md`; one commit per unit; push.
