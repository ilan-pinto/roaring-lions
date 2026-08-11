# Enemy raider units — five sheets, design

**Date:** 2026-08-11
**Status:** **built and shipped.** Six sheets on disk; art gate green at 2630
sprites / 26 units. The design below is preserved as approved; **"What the build
changed" at the end is the authoritative record** of where it turned out to be
wrong. Read that section before trusting a number in this one.
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

---

# What the build changed

Written after the fact, from a live Blender session. Every item here is a place
the design above was wrong, with the evidence that settled it. The pattern worth
naming: **almost every correction came from measuring something rather than
looking at it**, and three of them were invisible at full size.

## Construction

**The gun truck is a chassis-rail flatbed, not slab flanks with arch cut-outs.**
The spec carried the technical's pickup construction over. Built, it buried the
running gear — the body ran to 0.55 the whole length and the tyres showed only as
bumps below it — and the "arch cut-outs" notched *downward*, adding a skirt over
each wheel instead of opening one. A flatbed gun truck rides on a visible rail
with the wheels open beneath. Cab plus bonnet also went from 30% of the body to
45%, the same "reads as a flatbed" failure the technical's spec already records.

**Every part carries a bevel, width scaled per part.** Not in the spec at all.
The older scripts use one global 0.010; this file has a 2.35 m cab and 0.10 m
barrels in it, and a flat width is nearly half a barrel's diameter. Each bevel
clamps to 22% of its own part's smallest dimension, at 3 segments — at 2 a wide
bevel is a chamfer, one flat cut, and segments are what make it read curved.
Organic parts (figures, canopies, prop blades) are excluded; they already curve.

**The paramotor is a tandem with a two-man crew.** The spec had a single pilot
built from boxes. Both crew are now infantry-kit figures — `kit.figure` has no
seated posture, so they compose the same limb/blob/keffiyeh parts into one, which
is the kit's own stated contract. The gunner sits **forward**: behind the pilot
his machine gun fires straight through him.

## Geometry that had to be solved, not chosen

**The cannon is at 28°, on a mount raised 0.80 m.** The spec's 15° puts a 2.0 m
barrel through the cab at z≈2.07 against a 2.50 roof — the technical's first
recorded failure, verbatim. A turret sheet traverses independently of its hull,
so the barrels point forward on some facings and posing cannot dodge it. Mount
height was solved by sweep for the first offset giving ≥0.10 m of clearance on
the barrel *surface*: perpendicular radius projects into z as `r / cos(pitch)`,
so the jacket eats about half the axis figure. Result 0.119 m. The axis-only
number would have been 0.24 m and would have shipped a gun clipping the cab.

**The loitering munition's prop sits on a raised pylon, blades canted 40°/220°.**
At wing height the blades hid behind the wing from every downward-looking facing,
which is every facing; and a vertical two-blade disc is edge-on to a camera at
30° elevation. Its warhead is `gunmetal`, not `shadow` — 0.30 m of near-black on
a 1.4 m airframe read as a brick glued to the nose.

## Scale — the correction that mattered most

`scale` is proportional to the measured frame, and **neither size class restrains
it**: `light_vehicle` and `heavy_vehicle` are both multiplier 1.0. So a tall
protrusion silently inflates a unit, and two of the three vehicles needed
`target_scale` — the field that exists precisely so "a shape change cannot
silently resize a vehicle".

| unit | declared metres would give | shipped | why |
|---|---|---|---|
| gun truck | **158 px** — larger than the tank (126) and the 8×8 APC (126) | `target_scale` 1.84 → **118 px** | the frame must hold the elevated gun at every facing |
| paramotor | **296 px** — mosque-sized, 2.4× a tank, for one soldier | `target_scale` 1.5 → **96 px** | the `air` multiplier exists to rescue a 0.9 m quadcopter; on a 9.5 m canopy it inflates what is already large |
| loitering munition | 46 px | honest `real_metres` 1.62 | sits correctly between the recon drone's 31 px and the infantry band — nothing to fix |

Consequence worth stating plainly: **`realMetres` in the paramotor and gun truck
manifests is a drawing decision, not a physical claim.** The canopy really spans
9.5 m; the manifest says 2.99.

The gun truck's inflation was only caught by compositing the roster at true
relative scale. The manifest number alone did not look alarming.

## Clips

- **The paramotor has no `fire` clip.** The gunner's MG never stows, so firing
  changes no geometry. `clipOrFallback` resolves the miss back to `idle`, and
  muzzle flash is VFX — which `ART_PIPELINE.md` §5 says is where the firing read
  belongs anyway.
- **`MOTO_RPG` has no `down`.** A bike cannot go prone. `TEAM_CLIP_DROP` makes
  the omission explicit rather than accidental.
- **`INF_CHARGE`'s `down` is prone, not the crouch the spec described** — all
  nine existing sheets go prone, and a tenth that crouched would read as a bug.

## One tooling change

`VehicleSpec` gained **`lit_gain`**. `render_team.py` measured that a figure
lights to roughly half its palette base and carries a gain table; the vehicle rig
is darker still — black world, no ambient, tuned for hulls, which are mostly
horizontal surface — so the paramotor's crew rendered as silhouettes. Defaults to
`None`, so no existing sheet moves. The material cache is now keyed on
`(palette key, role)` rather than key alone: two roles sharing an entry could
otherwise hand each other a brightened material.

## Verification, as measured

Art gate **2630 sprites / 26 units**; 316 tests; determinism 4/4 with the hash
unmoved; lint, `validate:data` and the dimetric sun guard all clean.

| sheet | frames | fill | worst IoU (limit 0.88) |
|---|---|---|---|
| `GUNTRUCK_HULL` + `_TURR` | 32 + 32 | 12.3% | 0.513 vs `TNK_HULL` |
| `PARA_MOTOR` | 96 | 8.5% | 0.316 — most distinct on the roster |
| `DRONE_LOITER` | 80 | 16.3% | 0.590 vs `JEEP_HULL`; 0.343 vs `DRONE_RECON` |
| `INF_CHARGE` | 128 | 8.2% | 0.457 vs `INF_MORTAR` |
| `MOTO_RPG` | 112 | 7.0% | 0.394 vs `INF_CHARGE` |

Two predictions from the design were wrong in opposite directions:

- **`DRONE_LOITER` was the named MIN_FILL risk and came in at 16.3%** — a delta
  seen from 30° elevation is mostly planform.
- **`MOTO_RPG` was not flagged and failed at 5.96%.** `render_team` frames from
  the union over every clip, so the wreck's sprawled riders sized a frame that
  `idle` then under-filled. Riders brought in close recovered 6.08%; panniers and
  a bedroll took it to 7.01%. Lateral mass was the only lever — more length or a
  taller tube makes the ratio worse.

`INF_CHARGE` vs `INF_MILITIA`, the collision the design worried most about, does
not appear in its top five. The sprint lean did the work.

## Two hazards found the hard way

**Leftover preview geometry participates in later passes.** A 60 m ground plane
left in the scene reported the model's extent as 60 m and would have sized the
render frame to the plane. The same class of bug as the import-time re-render
`render_technical.py` records. Every preview here now strips its ground, lights
and camera before saving.

**A/B comparison by eye can be inconclusive where a difference test is not.**
Two candidate uniform tones for the paramotor pilot looked identical; hiding the
figure entirely settled it at 11.9% of pixels changed.

## Still not done

The split this spec declared holds: **no unit JSON, no stats, no `SPRITE_MAP`
wiring, no sim behaviour.** Six sheets are on disk that nothing in the game
references yet. They are art assets awaiting the balance and sim specs —
detonate-on-proximity, airborne movement, land-and-dismount.
