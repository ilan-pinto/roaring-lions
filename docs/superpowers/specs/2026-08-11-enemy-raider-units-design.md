# Enemy raider units — five sheets, design

**Date:** 2026-08-11
**Status:** approved, ready for implementation
**Depends on:** `2026-08-07-unit-rig-contract-design.md` (rig contract),
`2026-08-08-unit-kit-infantry-design.md` (figure kit, posture-as-composition),
`2026-08-10-enemy-technical-design.md` (vehicle kit conventions, per-role
palette, `turretAxisPx`).

## What this is

Five new enemy sheets, authored in a live Blender session the same way every
existing sheet was: script-built from the part kits, visually iterated live,
the saved `.blend` the authority for anything refined by hand. Art and
animation only.

The original request listed six units. Two collapsed on inspection: the
"mortar squad" is `mortar_crew`, which already has its own sheet from the
infantry kit, and the "old armed vehicle" turned out to mean something *new
and heavier* than the existing armed technical — settled below as an AA gun
truck.

| unit | sheet(s) |
|---|---|
| suicide squad | `INF_CHARGE` |
| armed motorcycle (rider + RPG passenger) | `MOTO_RPG` |
| AA gun truck (flatbed + twin cannon) | `GUNTRUCK_HULL` + `GUNTRUCK_TURR` |
| powered parachute (paramotor trike) | `PARA_MOTOR` |
| suicide drone (fixed-wing loitering munition) | `DRONE_LOITER` |

## Scope, and the split

The same split the technical used for mounted delivery. This spec delivers
`.blend` sources in `art/src/`, one author script per unit, and rendered
sheets + manifests passing all four CI gates. It deliberately does **not**
deliver:

- **Unit JSON or stats.** None of these five exists in `data/units/` yet, and
  a stats file must pass the cost-curve validator — that is balance work with
  its own spec.
- **`SPRITE_MAP` wiring.** There is no unit type to wire until the JSON
  exists.
- **Sim behaviours.** The suicide squad and drone need detonate-on-proximity;
  the paramotor needs airborne movement and land-and-dismount. All of that is
  schema + sim work that touches the determinism canary and deserves its own
  specs, per the CLAUDE.md rule that missions get behaviours by extending the
  schema.

The sheets land first anyway because the silhouette gate validates them
against the whole roster immediately, and because the art is the long pole —
the follow-up specs become wiring, not invention.

Faction tags (`rif` vs Ashwar/Sarim) are also deferred to the stats specs.
The palette identity chosen here is faction-neutral "irregular forces" and
does not pre-commit that choice.

## Palette identity

Enemy infantry stay in `dust` uniforms with no helmets, per the infantry kit.
The one deliberate move: the gun truck's body is **`dust.1` faded ochre, not
the technical's `limestone.0` white** — the two enemy trucks separate by ramp
before silhouette even matters, and dust is how "old and sun-rotted" is said
in a 42-colour locked palette that has no rust.

## The five units

Numbers below were approved before rendering, per project practice.

### Suicide squad — `INF_CHARGE`

2 figures, 1.8 m, `infantry` class, dust uniforms. The collision risk is
`INF_MILITIA` — also two standing dust figures — so posture and spacing do
the separating: both figures in a **full sprint, torso leaned ~20° forward,
single file** with a 0.9 m gap. No other infantry sheet runs. Vest bulk as a
thickened torso block front and back; one figure carries a slung satchel.

**No weapon parts at all.** Every other infantry sheet carries a rifle line
or a tube; the absence is itself a silhouette lever.

### Armed motorcycle — `MOTO_RPG`

2.2 × 0.8 m machine, `light_vehicle` class, `real_metres: 2.2`, ~55 parts.
Rider leaned to the bars; pillion passenger upright with an **RPG tube over
the right shoulder, angled 30° up and rearward** — the tallest point,
breaking the roofline the way the technical's gun does. Wheels are
14-segment cylinders, mudguards, single headlamp block. Total height with
passenger ~1.9 m — taller than it is long, which is what keeps it from
reading as a low car at 25 px. Gunmetal machine, dust riders.

### AA gun truck — `GUNTRUCK_HULL` + `GUNTRUCK_TURR`

6.6 × 2.35 m, cab roof 2.5 m, `light_vehicle` class, `real_metres: 6.6` — a
full step above the technical's 5.0. Flat-nosed medium truck built with the
technical's lessons: slab flanks with squared arch cut-outs from `prism`,
upright windscreen, **dual rear wheels**, drop-side flatbed.

The turret is a ZU-23-style **twin parallel-barrel cannon, 2.0 m barrel
reach, elevated 15°**, seated-gunner cradle, ammo box each side, on a low
ring at the bed centre — ~50 parts, `turret_axis` declared so
`render_vehicle.py` writes `turretAxisPx`. The correction shipped with the
technical exists precisely for off-centre bed guns.

| role | palette |
|---|---|
| `hull` | `dust.1` |
| `plate` | `dust.2` |
| `metal` | `gunmetal.2` |
| `rubber` | `shadow.0` |
| `glass` | `gunmetal.3` |
| `recess` | `shadow.1` |

Separation from `TECH_HULL`: longer body, twin elevated barrels against a
single level barrel, dust against limestone.

### Powered parachute — `PARA_MOTOR`

`air` class (1.5× compression). A paramotor trike: seated pilot, tricycle
undercarriage, **prop cage as a 16-segment open ring** behind him, ~1.4 m
tall. The canopy is a rectangular parafoil **arc, 9.5 m span, lofted as a
curved prism** — scripted, ~24 verts, not hand-sculpted — 5.5 m above the
cart on 6 line edges. Canopy `dust.0`, lines `gunmetal.3`, cage `gunmetal.2`,
pilot dust.

The canopy is ~85% of the silhouette, and nothing else on the roster has
mass floating above a point.

### Suicide drone — `DRONE_LOITER`

`air` class. **Delta wing, 1.6 m span**, stubby fuselage with a blunt
warhead nose, pusher prop disc at the tail, small twin fins. ~20 parts, dust
airframe — enemy air against the KDF's gunmetal/olive quads. Against
`DRONE_RECON` it is a solid triangle against an open cross, expected to be
the loosest pair on the matrix.

Ground shadows for both air units follow the recon drone's convention —
carried by the render rig, verified during implementation, not invented
here.

## Animation

Frame-pose compositions, no armature, per the infantry kit. Missing clips
fall back to `idle` via `clipOrFallback`, which is already how the recon
drone handles `move`.

| sheet | idle | move | fire | down | wreck |
|---|---|---|---|---|---|
| `INF_CHARGE` | 1 | 4 @ 10 fps sprint cycle | 1 — lunge frame | 1 — crouch | 1 |
| `MOTO_RPG` | 1 | 4 — 2 px bob + fork dip | 1 — tube levelled | — | 1 — bike on its side |
| `GUNTRUCK_HULL` | 1 | — | — | — | 1 — burnt, barrels askew |
| `GUNTRUCK_TURR` | 1 | — | 1 — recoil frame | — | — |
| `PARA_MOTOR` | 4 — hover bob + canopy sway | — | 1 | 1 — **landed, canopy collapsed behind** | 1 — crumpled canopy |
| `DRONE_LOITER` | 4 — bank wobble | — | — | — | 1 — debris |

The paramotor's `down` clip is the one novelty: it repurposes the slot as the
*landed* state — exactly the frame the future land-and-dismount behaviour
will need, authored now while the model is open.

Detonations are VFX (`catastrophic_kill` ramp), never baked into sprites.
The reserved bands stay reserved.

## Silhouette risks, fallbacks decided now

The infantry-kit rule governs: **one facing per sheet renders first, the IoU
matrix is measured, and massing is fixed while a fix costs a minute.** Only
then do the full renders run.

| pair | why it is close | fallback |
|---|---|---|
| `INF_CHARGE` / `INF_MILITIA` | both 2 standing dust figures | deepen the sprint lean, widen the file gap; last resort a 3rd figure |
| `GUNTRUCK` / `TECH` | both bed-gun trucks | lengthen barrels, stretch the flatbed overhang |
| `MOTO_RPG` / infantry sheets | figure-scale mass | steepen the RPG angle; the wheel base line is a shape no infantry has |
| `DRONE_LOITER` / `DRONE_RECON` | both small air | expected loose; no action anticipated |

## Verification

- Full pairwise IoU matrix printed and recorded, every pair < 0.88 across
  the full roster — 25 existing sheets plus these six. If a pair will not separate, the massing changes —
  the limit does not move.
- `pnpm validate:assets` — palette, reserved bands, binary alpha, minimum
  fill. `MIN_FILL` is a live risk for `DRONE_LOITER`, which is a thin shape.
- `python3 tools/test_dimetric.py` — author scripts take lighting from
  `build_lights()`, so the sun guard must stay green.
- `pnpm test`, `pnpm lint`.
- `pnpm test:determinism` with the hash **unmoved** — this session touches no
  sim code, and the canary proves it.
- A preview render of the gun truck against a limestone ground plane — the
  same check that validated the technical's white-on-pale risk, now pointed
  at dust-on-pale.
- Live Blender screenshots at each massing step, so massing is judged before
  render minutes are spent.

## Out of scope

- Unit JSON, stats, cost-curve balance, faction tags — one follow-up spec
  per doctrine group.
- Detonate-on-proximity, airborne movement, land-and-dismount — sim + schema
  specs.
- `SPRITE_MAP` wiring — lands with the JSON.
- Damage states beyond `wreck`, carried-vs-deployed states — same reasoning
  as the infantry kit.
