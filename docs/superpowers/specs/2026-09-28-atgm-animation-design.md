# The anti-tank missile: launch, flight and impact (GH-250) — Design

> Lane B, art. Branch `feat/atgm-animation`, base `origin/main@9e9b0640`.
> Companion plan: `docs/superpowers/plans/2026-09-28-atgm-animation.md`.
> **Nothing renders until the lead approves the numbers table (§ Numbers).**

## What this is

Today an ATGM reads as a line. `atgm`, `rpg` and `heat` all fly GH-149's `missile`
kind (`units/shells.ts`): a 4.5 px streak in `tracerColors` at 5 tiles/s, with a
2.2 px/tile bend, landing with nothing (`impactPower: 0`). The lead wants this
sequence:
- **launch:** ignition flash, backblast, dust;
- **flight:** body, motor glow, a lingering trail, and a guided path (Spike: climb,
  then dive);
- **impact:** a HEAT flash and spall, through the blast path at `impactPower`.

It is judged on ten seconds of motion.

## What exists (read at `9e9b0640`)

- **Routing.** `shellKindFor` returns `'missile'` for the three classes.
  `ThreeRenderer.onFire` (`:4152`) pushes it into `this.bolts`. `updateFx` (`:7190`)
  ages it on frame seconds. `spawnShellImpactFx` (`:7216`) returns at
  `impactPower <= 0`.
- **The sim's flight time.** `tuning.ts:114` `PROJ_SPEED` is atgm 4, rpg 6 and heat
  10 tiles/s, and `prTicksLeft = ceil(dist / (speed × 0.05))`
  (`sim.ts:3683`). `PROJ_SPEED` is not exported, so `shells.ts` already copies these
  numbers.
- **What the events carry.** The `fire` event carries `shooter`,
  `target`/`structure`, `weaponId`, `willHit` and `tick`. It does **not** carry the
  miss aim point. An intercept arrives as `aps { target, intercepted }` on the
  resolution tick.
- **Shooters** (ranges in tiles): `spike_atgm` (9), `kornet` (10), `hellfire` (air,
  10.5) and `manpad` (at air, 13) are `atgm`; `rpg7`, `rpg` and `spg9` (5–7) are `rpg`.
  `heat` is only a loitering munition's `warhead` (1.2), so "direct-flight RPG/HEAT"
  means the `rpg` class.
- **Particles have no height** (`writeParticleInstances` lifts by
  `max(3 px, radius)`), so a trail at a Spike's apex cannot live in `ParticleSystem`.
- **The blast path.** `spawnCollapseFx(id, x, y, power, yaw)` handles `mesh_burst`,
  and `blast-spec.ts` scales `light`, `screen_shake` and `hit_stop_ms` by power. Its
  particles fire straight up, so a forward spall cone needs its own loop.
- **The clocks.** FX age on `frameDtSeconds`: clamped, zero during hit-stop, wall
  time through a pause and at any game speed.
- **No `ui:motion` script exists.** `pnpm blast:capture`
  (`tools/src/perf/blast-captures.ts`) is the precedent.

## Decisions

**D1 — Flight time is the sim's, to the tick.** With `n = ceil(dist / (PROJ_SPEED ×
0.05))` (`prTicksLeft`), `duration = max(1, n − 1) × 0.05 s`. The round resolves
n − 1 ticks after the `fire` tick, because projectiles step in the tick they are
fired. This was measured at `9e9b0640`: a 4-tile `rpg7` resolved 13 ticks after
firing, and a 7-tile Spike 34. It is copied, and a test parses `tuning.ts` as text
so the copy cannot drift. The HEAT flash lands when the sim resolves the round, so
the penetration puff, the jolt and a kill's blast follow the missile, not the other
way round.
- *Stated cost:* an ATGM takes **1.45 s at 6 tiles and 2.20 s at 9**, above the
  issue's 0.6–1.2 s.
- The RPG (0.65 s at 4 tiles) is inside that band.
- Faster ATGMs would need a sim change (Q1).

**D2 — Four variants: class, one named weapon set, and domain.**

| Variant | Weapons | Path | Tracks target |
|---|---|---|---|
| `top_attack` | `spike_atgm` | climbs to an apex at 40 % of the flight, then dives | yes |
| `guided` | `kornet`, `hellfire`, `manpad` | shallow arc, with a lateral weave settling to 0 | yes |
| `unguided` | class `rpg` | flat hump, motor lit 0.3 tiles out | no, aim fixed |
| `warhead` | class `heat` | nothing drawn in flight | — |

`TOP_ATTACK_WEAPON_IDS` is a render-side set, like `SHELL_PROFILES`. A test pins each
id to a shipped weapon by reading the unit JSON files. The ends of a flight sit at a
real height: ground 6 lift px, air `AIR_LIFT_PX` (14). So a Hellfire leaves the
helicopter, and a MANPAD meets it.

**D3 — A miss is presentational.** On `willHit: false` the missile flies to 0.8
tiles past the target, offset laterally by a hash of `(tick, shooter)`. It does not
track the target. It lands with the same impact plus a small scorch. The sim's own
`nearMiss` puff may land elsewhere, as it does for every round today.

**D4 — An APS intercept detonates the missile in the air.** An `aps` event with
`intercepted` detonates in-flight missiles aimed at that target, where they are, at
half power. That is what Trophy looks like. If the frame clock has already landed
the missile (at most a tick early), the HEAT flash has shown. That is accepted.

**D5 — New modules; minimal `ThreeRenderer.ts`.**
- `units/missiles.ts` is pure: variants, profiles, duration, path, guidance, miss,
  stepping.
- `units/missile-trail.ts` is pure: a struct-of-arrays puff ring, emission by
  distance, drift and fade, flicker, and the sprite writer.
- `units/missile-fx.ts` holds `MissileFx`, which owns the models, the pool and three
  meshes.

`ThreeRenderer.ts` gains one field, the `onFire` branch, one call each in `updateFx`,
`aps`, `useEmitters`, `dispose` and the scene add, a `missiles` debug case and
`spawnMissileImpactFx`. `shells.ts` drops `'missile'` from `ShellKind` and
`SHELL_PROFILES`. The routing answer becomes `ProjectileKind`, so there is no dead
profile.

**D6 — Launch and impact are data; flight is code plus data.**
- `fire_missile.json` is reauthored: ignition, a backblast cone, and a ground ring.
- `missile_trail.json` is new (`projectile_trail`). Its layers are: the core glow
  (`additive`), the halo (`soft_dot`) and the smoke (`smoke_puff`).
- `missile_impact.json` is new (`impact_armor`): a flash with `mesh_burst`, spall,
  smoke, a light and a shake.

Spacing, drift, profiles and the body are TS constants (the `SHELL_PROFILES`
precedent). No schema change: both triggers already exist.

**D7 — Impact runs off the frame clock, in its own loop.** `spawnMissileImpactFx`
mirrors `spawnCollapseFx`, but aims the spall along the missile's heading. It fires
when `MissileFx.step` reports a landing (the `shellHasLanded` rule). It keeps the
blast's light, shake and burst mesh. Light and shake are the emitter's authored
values × `scale` (1 for a hit, 0.5 for an intercept), because `blastLightSpec` × 0.25
would be a quarter of N13. `impactPower` sizes only the burst mesh and the
particles. It adds **no hit-stop and no crater**: a kill
already owns the blast. A miss adds `scorchRadiusTiles(0.15)`.

**D8 — The trail uses the FX clock.** The issue says "sim clock like the other
ground FX", but those FX age on `frameDtSeconds`, and that is the rule we follow. The
trail freezes under hit-stop and runs through a pause, as every particle does today.
Game-speed-aware FX are out of scope for shells too.

**D9 — Three only.** `renderer.ts` stays byte-identical.

## Invariants and budget

- **`packages/sim` is untouched.** `git diff --stat 9e9b0640..HEAD -- packages/sim`
  is empty at every commit.
  - Inputs are the events and the `curX`/`curY`/`alive` the renderer already reads.
    It writes nothing back.
  - Every random choice (miss offset, flicker phase, puff jitter) hashes
    `(tick, shooter)`. Nothing calls `Math.random`.
  - Hash, `balance` and `playtest` cannot move, and `test:determinism` still runs.
- **Draw calls: +3 while any missile flies, +0 idle** (`visible = count > 0`). The
  three meshes are:
  - body quads (tracer material);
  - soft sprites, halo plus trail (particle material);
  - hot cores (particle material, `hotCore`).
- **Pools.** 64 missiles and a 768-puff ring (oldest overwritten). One ATGM holds
  about 4 × 1.6 ÷ 0.2 = 32 puffs, so eight in flight is about 400.
- **Shared `ParticleSystem`.** Launch and impact add about 30 particles a shot to the
  2048 pool, the same order as today.
- **Allocation.** None per frame in the writers.
- **Render order.** No new band (`render-order.ts` is the single source).
  - Body and sprites draw at `FX_RENDER_ORDER` (2), cores at
    `FX_RENDER_ORDER_ADDITIVE` (2.5).
  - All three are depth-tested. Direct fire needs line of sight, so a building in
    front *should* hide a missile, and a top-attack apex passing behind a tower
    correctly goes hidden.

## Numbers — for approval before anything renders

Tile step is 32 × 16 px at zoom 1. One elevation level is 10 lift px.

| # | Quantity | Proposed |
|---|---|---|
| N1 | ATGM speed | **4 tiles/s** (the sim's): 1.45 s at 6 tiles, 2.20 s at 9 |
| N2 | RPG / SPG-9 speed | **6 tiles/s** (the sim's): 0.65 s at 4 tiles, 0.90 s at 5.5 |
| N3 | Warhead | no flight drawn; impact at 2 ticks (0.10 s) |
| N4 | Top-attack apex | **6 lift px/tile, clamped 30–60**; apex at u = **0.40** (7 tiles → 42 px); a sine climb, then a dive of 1 − q⁴ (steepest at the hull) |
| N5 | Guided | arc 2.2 px/tile, clamped 8–26 (GH-149's); weave **0.12 tiles × 1.5 cycles × (1 − u)** |
| N6 | Unguided | hump 1.0 px/tile, clamped 2–8; motor lit at **0.3 tiles** |
| N7 | End heights | ground **6 px**, air **14 px** |
| N8 | Body | **0.30 tiles** long, **2.5 px** wide, `gunmetal.1` |
| N9 | Motor glow | core **r 2.5 px** `vfx.white_hot` (hotCore); halo **r 6 px** `vfx.fire`, α 0.55; flicker **±15 % at 23 Hz** |
| N10 | Trail | puff every **0.20 tiles**; life **1.6 s** ATGM, **0.9 s** RPG; r **2.5 → 8 px**; α **0.7 → 0**; `limestone.1 → limestone.3 → gunmetal.1`; rise **5 lift px/s**; drift **0.15 tiles/s** |
| N11 | Backblast | rear 30° cone: **8–12 puffs**, 1.5–4.5 tiles/s, 600–1200 ms, 8–14 px ×2.4; ground ring **6–9 puffs**, 360°, 0.5–1.2 tiles/s, 500–900 ms |
| N12 | Ignition | **3–4 hot dots**, 8–12 px, 120–200 ms; light **2.0 × 3 tiles × 180 ms** |
| N13 | HEAT flash | light **2.6 × 3.5 tiles × 200 ms**; **4–6 hot dots**, 8–13 px, 90–160 ms; burst mesh at power |
| N14 | `impactPower` | ATGM **0.25**, RPG **0.20**, warhead **0.30**; intercept × 0.5 (mortar is 0.3) |
| N15 | Spall | **8–12 shards**, **70°** forward, 2.5–5 tiles/s, 250–450 ms, gravity 3 |
| N16 | Impact shake | **2 px, 140 ms, 8 tiles**; **no hit-stop** |
| N17 | Miss | overshoot **0.8 tiles**, ±0.4 lateral; scorch `scorchRadiusTiles(0.15)` |
| N18 | Pools and cost | **64** missiles, **768** puffs; **+3** draw calls in flight, **+0** idle |

## Capture protocol

`pnpm atgm:capture -- --label=before|after --port=5197`
(`tools/src/perf/atgm-captures.ts`) retargets `blast-captures.ts`.
- **Setup.** It starts its own dev server (stopped by PID) on
  `?sandbox=beit_sahwan_outskirts&renderer=three` and freezes the frame loop with
  `FREEZE_FRAME_LOOP_SCRIPT`.
- **Subjects** are spawned on the open northern band, with the camera on each pair's
  midpoint:
  - `at_team` vs hostile `technical`, 7 tiles (top-attack);
  - hostile `atgm_cell` vs `jeep_shoded`, 8 tiles (guided; no APS);
  - `heli_peten` vs `technical`, 8 tiles (air launch);
  - hostile `rpg_team` vs `jeep_shoded`, 4 tiles (unguided).
- **The window.** Tick to the shooter's `fire`, then run **10 s in lockstep**: one
  `__lions.step(1)` per 50 ms of pumped frame time, the rest `renderer.frame(1,
  ≤16)`. So the sim resolves and the target reacts in the picture.
- **Frames.** A 600 × 400 crop at **zoom 2.0**, every **50 ms to 3 s**, then every
  **250 ms to 10 s**. That is **89 frames** a subject, plus a zoom-1.0 establishing
  still.
- **Output.** `sheet.md`, `sheet.json` (t, tick, zoom, ids, missiles in flight) and
  **`flip.html`**, which plays the frames at their real timestamps. **The lead
  judges the flip.**
- **Toggle A/B** for `missiles` at a mid-flight rung. The floor is one third of the
  measured delta.
- **Before-set first, at base.** Output goes to
  `.superpowers/art-captures/atgm/<label>/` (git-ignored), and the numbers are quoted
  in the PR.

## Gate impact

No gated scenario (`quiet`, `open-ground`, `vehicle`, `relief`, `aftermath`) contains
missile fire: the sandbox force never fights and `vehicle` is parked.
- **Every gated scenario is expected unchanged. A red one is a defect, not drift.**
- `combat` (report-only, RPG and ATGM groups engaged) will move.
- No bless is budgeted. If one is needed, it runs after merge, from CI numbers only
  (`visual-baseline-bless`). The local darwin baseline is stale.
- A CI job that never starts is the billing block: read the annotation first.

## Overlap with the ground lane

`feat/ground-plan2` also edits `ThreeRenderer.ts`: imports `:220`, fields `:959`,
terrain dispose `:2670`, a `props` debug case `:3086`, and `:5384`, `:8090`, `:8207`.
It also edits `debug-layers.ts` (`props` after `decor`).

This package's hunks are:
- the shells import `:238`;
- a field after `boltBatch` `:1915`;
- the FX `scene.add` `:2338`;
- the FX dispose `:2816`;
- a `missiles` case after `blast-light` `:3218`;
- `aps` `:3772`;
- `onFire` `:4152`;
- `useEmitters` `:4823`;
- `updateFx` `:7190`;
- one new method;
- `missiles` appended after `blast-light` in `debug-layers.ts`.

No hunk is shared. Task 6 rebases first if ground-plan 2 has landed.

## Out of scope

- Any sim change (Q1).
- Pixi.
- Game-speed-aware FX.
- A gated missile scenario.
- A schema field for the flight profile (Q2).
- Sound.
- GPU additive blending (the blast's R-A).

## Open questions for the lead

1. **ATGM flight time.** Keep the sim's 1.45–2.20 s, so impact and kill stay in step
   (recommended)? Or have the balance lane raise `PROJ_SPEED[atgm]` to about
   8 tiles/s? That is a sim package of its own, and the golden hash moves.
2. **Top-attack selection.** Keep `TOP_ATTACK_WEAPON_IDS` (recommended, pinned by a
   test), or add a weapon field `flight: "top_attack"` to `unit.schema.json`? The
   field would widen `WeaponStats` in the sim, or need a raw-JSON read in render.
3. **Hellfire.** Should it fly top-attack rather than guided? Its backblast ring
   draws on the ground under the helicopter and reads as rotor wash. Keep that, or
   skip the ring for an air shooter?
