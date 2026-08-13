# Apache gunship and D9 dozer — design

**Date:** 2026-08-13
**Status:** designed; not implemented

## What this is

Two KDF units. Both are `faction: "kdf"`, player-built, ROE-gated — friendly, not
enemy.

- **`heli_peten`** — AH-64 Peten, an assault helicopter. Rides the `mobility.domain:
  "air"` rule that landed with the raider set, so it needs no new sim concept at all.
- **`dozer_d9`** — D9 Dov, an armoured bulldozer that brings buildings down faster
  than Combat Engineers can.

The Apache is data and art plus one role-enum entry. The D9 needs one schema field
and a handful of lines of sim, because demolition speed is currently not a property a
unit can have.

## The engine changes

Two schema edits — `demolition_time_s` and a `gunship` role — and one sim path.

`stepDemolition` (`packages/sim/src/sim.ts:2546`) counts every demolisher against a
single global `DEMO_TICKS = 100` from `packages/sim/src/structures.ts:76`. There is
no per-unit term anywhere in the path. "Destroys buildings faster" is therefore not
expressible in data today, and per CLAUDE.md a unit that requires an engine change is
a signal that the data model is missing a concept.

### Schema

`data/schemas/unit.schema.json` is `additionalProperties: false`, so the field has to
be declared. One new optional top-level key:

```json
"demolition_time_s": {
  "type": "number",
  "minimum": 0.5,
  "default": 5.0,
  "description": "Seconds a `demolish` unit must hold station to bring a building down. Absent means 5.0, which is what every demolisher did before the field existed."
}
```

Seconds, not ticks. `build_time_s`, `reload_s`, `speed_tiles_s` and
`turn_rate_deg_s` are all in real units; data does not know the tick rate.

The `role` enum gains `gunship`. Reasoning is under the Apache below.

### What a new role touches

Four places read `role`, and a new value has to fall through all of them acceptably:

- `sim.ts:361` — `FOOT_ROLES` decides `can_embark`. `gunship` is not in the set, so
  the Apache correctly cannot ride inside a transport. This is the reason the role is
  being added at all.
- `mission.ts:529` — `role === 'drone'` grants `INTEL_PER_MIN_DRONE`. A gunship
  correctly earns none.
- `renderer.ts:1553` — a procedural fallback blob for units with no sheet. `gunship`
  falls through to the generic vehicle shape, which only matters in the window before
  `APACHE_HULL` exists.
- `hud.ts:386` — the selection-card glyph. `gunship` falls past `drone` (`⬡`) and
  `sniper` (`✛`) to the generic `■`. **Add a `gunship` case with an aircraft glyph**;
  a helicopter carrying the same mark as a tank is a small but permanent wart.
  `dozer_d9` keeps `■`, which is right for it.

### Sim

`unitTypeFromJson` (`sim.ts:334`) gains one field, copying the conversion
`apsReloadTicks` already uses on the line above it, so no `Math.*` enters the sim
package:

```ts
demolitionTicks: fx.toInt(fx.mul(fx.from(json.demolition_time_s ?? DEMO_SECONDS), fx.fromInt(TICKS_PER_SECOND))),
```

`DEMO_SECONDS` is `DEMO_TICKS / TICKS_PER_SECOND` = 5, kept in `structures.ts` beside
the constant it derives from.

Two reads then move off the global:

- `sim.ts:2578` — `if (++this.demoTicks[i] >= type.demolitionTicks)`
- `sim.ts:957` — `demolitionProgress` divides by `DEMO_TICKS` today. **This is the
  easy one to miss.** Left alone, the D9's HUD bar fills to 40% and the building
  falls, which reads as a rendering bug rather than a missed line.

### The invariant that proves it

Every existing unit omits `demolition_time_s`, resolves to 5.0 s, and converts back
to exactly 100 ticks. **The determinism golden hash must not move.** If it does, the
change is wrong. That is the cheapest available test of the whole edit, and it
should be the first one run.

### Rejected alternatives

- **Derive the timer from the `demolition`-type weapon's `rof_per_min`.**
  `demo_squad` already carries such a weapon at 3/min. Rejected: the demolition
  *weapon* and the `demolish` *ability* are separate mechanisms — one fires at
  structures through `fireAtStructure`, the other plants charges while stationary —
  and coupling them would force the D9 to carry a weapon it does not have.
- **A `demolition: { time_s }` object** for future room. YAGNI for one number.

## The two units

### `heli_peten` — AH-64 Peten

`data/units/kdf/heli_peten.json`

```
faction kdf · role gunship · domain air · pop 2 · unlock roe_rating_min 65
logistics 880 · build_time_s 42                (mbt_lavi: 906 / 45 / 3)
hp 640 · armor 45/28/20 · crew 2 · supp_res 0.70
speed 3.4 · turn 110 deg/s                     (fastest in the roster; jeep_shoded 2.9)
optics 1.6 · sight 15 · thermal · signature 1.2 · firing_sig_mult 2.5
```

| weapon | type | rng / eff | acc | pen | dmg | rof | supp | coll | targets |
|---|---|---|---|---|---|---|---|---|---|
| `chain_gun_30` | autocannon | 7.5 / 6.0 | 0.60 | 120 | 85 | 625 | 90 | 0.50 | ground, air, structure |
| `hellfire` | atgm | 10.5 / 9.0 | 0.80 | 900 | 420 | 6 | 15 | 0.20 | ground, structure |

Front armour 45 mm sits deliberately above `SOFT_ARMOR_LIMIT` (30 mm, `tuning.ts:67`),
so the airframe is not classed soft. Signature 1.2 is the highest in the roster: the
player's best asset is the most visible thing on the field, which is pillar 3.

**The Hellfire's 9.0 effective range is the counterplay.** The enemy AA envelope is
`gun_truck`'s ZU-23 at 11 tiles / 8.5 effective, `technical`'s DShK at 9 / 7.2, and
militia rifles at 7 / 5.5. At 9.0 the Apache can strike from outside the gun truck's
*effective* range while remaining inside its *reach*, so the exchange turns on who
fires first — information, not raw range. Penetration 900 matches the Kornet and
Spike, so it threatens armour without outclassing the MBT's 1300.

The chain gun's `collateral_risk` of 0.50 is the second highest in the game after the
MBT main gun's 0.55. Firing it into a built-up block should visibly cost ROE rating.

`role: "gunship"` is a new entry in the role enum. The existing enum has nothing that
fits: `support` and `engineer` are in `FOOT_ROLES` (`sim.ts:175`), so the unit would
default to `can_embark: true` — an Apache riding inside a Namer. Labelling it `drone`
would be a lie the UI repeats.

### `dozer_d9` — D9 Dov

`data/units/kdf/dozer_d9.json`

```
faction kdf · role engineer · hull.can_embark false · pop 1 · unlock roe_rating_min 60
logistics 430 · build_time_s 26
hp 2400 · armor 240/170/110 · crew 2 · supp_res 0.75
speed 0.6 · turn 45 deg/s                      (slowest vehicle; mortar_team 0.65)
optics 0.8 · sight 7 · signature 1.15
abilities ["demolish"] · demolition_time_s 2.0
no weapons array
```

The armour numbers are the design. Against militia rifles (pen 8), the DShK (25) and
the ZU-23 (40) it simply bounces; small-arms fire is noise. Against `rpg_team`'s
RPG-7 (550), `moto_rpg` (300) and either ATGM (900) it dies, front or side. So the
enemy answer is not volume of fire but bringing the right tool, and committing a D9
means committing an escort.

No `weapons` key at all. `recon_drone` already ships without one, so the path is
proven.

`hull.can_embark: false` is required: `engineer` is a `FOOT_ROLE`, and the schema
documents this key as the explicit override.

**Deliberately not set:** `can_crush` and `reshapes_terrain`. Both are declared in the
schema and read by nothing in the sim — `reshapes_terrain` is touched only by
`tools/validate_balance.py:155`, where it applies a ×1.25 mobility multiplier. Setting
it would price the D9 higher for a capability that does not exist. CLAUDE.md already
lists stub-data-without-sim among the known debts; this spec does not add to it.

### Costs are opening bids

Both `logistics` figures must be fitted, not trusted. `validate_balance.py` fits a
power curve across the roster and rejects anything outside ±18%. The D9 is an awkward
shape for it — zero offence, extreme defence, worst-in-game mobility — and the
Apache's two-weapon offence score will be high. Expect to move both.

## Art

### Drawn size

The roster's ceiling is the MBT at 126 px (64 px/tile). `tools/render_gun_truck.py`
records rejecting `real_metres=6.8` because it derived 158 px, "larger than the main
battle tank at 126", so exceeding it is a deliberate act. Both of these earn a little.

| sheet | size_class | target_scale | drawn px |
|---|---|---|---|
| `APACHE_HULL` | `air` | 2.00 | 128 (plus the renderer's 14 px air lift) |
| `D9_HULL` | `heavy_vehicle` | 2.05 | 131 |

Both use `target_scale`, not `real_metres`, as the paramotor and gun truck did. True
scale is unusable: `UNITS_PER_TILE` is 3.0 m, so a 14.6 m rotor disc would draw at
275 px.

### Clips and frames

| sheet | clips | frames | files |
|---|---|---|---|
| `APACHE_HULL` | `idle` (16 facings × 4 rotor phases), `wreck` (16 × 1) | 80 | 81 |
| `D9_HULL` | `idle` (16 × 1), `wreck` (16 × 1) | 32 | 33 |

Identical in structure to `DRONE_LOITER` (81 files) and `TECH_HULL` / `GUNTRUCK_HULL`
(33 files). Nothing new for the rig.

**No `fire` clip on the Apache.** If `idle` animates the rotor across four phases and
`fire` does not, the rotor freezes the instant the unit shoots. Giving `fire` its own
four phases costs 64 more renders to fix a problem created by having the clip. Omitted,
`clipOrFallback` resolves back to `idle`, the rotor keeps turning, and the shot is
already carried by the muzzle flash, `firingTimer` and recoil the renderer runs anyway.
The same reasoning omits `move`: a nose-down attitude is invisible at 128 px.

**No `work` clip on the D9.** A blade-down demolishing pose needs a renderer animation
state that does not exist; `demolitionProgress` currently feeds only a HUD bar. That is
a separate change.

### Modelling notes, from the massing preview

A blocked-out massing was rendered at the rig's own angle (elevation `asin(0.5)`,
azimuth 225°) on a 3 m grid before any of these numbers were fixed. It changed two of
them.

- **Rotor: four discrete blades at ~9.6 m span, not a solid disc at 14.6 m.** At true
  scale the disc is a grey pancake that swallows the entire airframe; nothing about
  that sprite says "helicopter". A 4-blade rotor also has 90° rotational symmetry, so
  four phases at 22.5° each covers exactly one visual cycle and loops seamlessly — a
  solid disc would have nothing to animate.
- **Airframe shortened to ~11.5 m overall, from 15 m true.** At full length the
  tailboom drives the frame and the sprite is mostly empty, which is a real
  `MIN_FILL ≥ 6%` risk. 77% foreshortening is ordinary RTS convention.
- **The D9's silhouette holds.** Cab set back and high, exhaust stack breaking the
  roofline, blade raked forward of the tracks, ripper tine behind. Against `TNK_HULL`
  it reads as a different machine, front to back.

At 2.00 with the shortened airframe the Apache gets ~11 px/m: rotor 107 px, stub wings
58 px, fuselage 13 px wide.

### Sources and scripts

```
art/src/aircraft/apache.blend      (new directory)
art/src/vehicles/d9.blend
tools/render_apache.py             modelled on tools/render_gun_truck.py
tools/render_d9.py
```

Geometry from `from_pydata` at real coordinates, object scale 1, every part carrying
`rl_role`, lighting only from `dimetric.build_lights()`. `facing_offset` is 0 for both
since the source orientation is ours — confirmed by silhouette fit against rendered
frames, not assumed. Every sheet runs through `tools/quantize_sprites.py` before any
gate check. Palette is locked; no new entries.

Rendering is headless. The live Blender MCP session is for visual checks only, and it
currently holds a 163-block `marj_shelf` scene belonging to another workstream — that
scene must not be modified or overwritten.

## Integration

- `packages/data/src/index.ts` — import both JSON files, add to the `units` map.
- `packages/app/src/main.ts` — two `SPRITE_MAP` entries: `heli_peten` →
  `sprites/APACHE_HULL/`, `dozer_d9` → `sprites/D9_HULL/`. Neither has a turret layer,
  so neither takes a `turretPath`.
- `packages/app/src/ui/hud.ts:386` — a `gunship` glyph case, per the role note above.
- `sandboxSpawns` — both join the KDF task force on `side 0` at the west edge,
  alongside the Lavi and the Namer. Not in the militia band.

## Testing

Combat maths requires tests; rendering does not.

- **`pnpm test:determinism` with the golden hash unmoved.** The load-bearing one, per
  the invariant above.
- A sim test that a demolisher with `demolition_time_s: 2.0` levels a structure in 40
  ticks and one without the field takes 100.
- A sim test that `demolitionProgress` reports against the unit's own timer — the
  regression guard for `sim.ts:957`.
- A sim test that a weaponless unit with `demolish` neither crashes `selectTarget` nor
  acquires a target.
- `pnpm validate:data` (both files against the extended schema), `pnpm validate:assets`
  (palette, binary alpha, `MIN_FILL ≥ 6%`, pairwise IoU < 0.88 at 64 px),
  `pnpm lint`, `pnpm test`.
- `pnpm balance` — all four §5.7 targets still pass, and the cost curve accepts both
  units within ±18%.

## Risks

1. **`demolitionProgress` divides by the global constant.** Silent, cosmetic, and easy
   to skip. Covered by a named test above.
2. **Cost-curve rejection.** Likely on first attempt for the D9. Fit against
   `validate_balance.py`, do not hand-tune to make the gate pass without understanding
   which axis moved.
3. **`MIN_FILL` on the Apache.** Mitigated by the shortened airframe; verify before
   committing 80 frames.
4. **The Apache shifts the §5.7 urban ratio.** A fast, thermal, two-weapon air unit the
   enemy can barely reach may move the 3:1 urban assault target. `pnpm balance` is the
   check, and if it moves, the Hellfire's effective range is the dial — not its
   penetration.
