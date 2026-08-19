# The tunnel subsystem — design

**Date:** 2026-08-18
**Status:** built, with corrections. The design below is what was specified; where
the build diverged, *As built* at the end records what shipped and why. Read that
section before trusting any specific claim in this one.
**Part of:** subterranean warfare, piece 1 of 2. The mission that uses it is
tracked separately (see *Sequencing*).

## The problem

Tunnels are the Ashwar Front's entire doctrine. GDD §2 defines the Marj Strip as
"tunnels, IEDs, ambush, human terrain"; §4 makes Subterranean one of the six phases;
§3 lists "revealing subterranean networks" as an Intel sink; §6 lists `collapse` as an
objective type.

None of it exists. Every reference in the tree is a slot with nothing behind it:

| Where | What it promises |
|---|---|
| `unit.schema.json` | `mark_tunnel`, `tunnel_travel` — authored on `recon_drone`, `rpg_team`, `mortar_crew`, `militia_cell`; read by nothing |
| `mission.schema.json` phase enum | `subterranean` — zero missions use it |
| `mission.schema.json` wave `from` | *"Tunnels keep producing until located and collapsed"* — a self-replenishing spawner that does not exist |
| `mission.schema.json` objective enum | `collapse` — passes `validate:data`, then throws at runtime |
| `vfx_emitter.schema.json` | `tunnel_collapse` trigger — no emitter JSON authored |
| `map.schema.json` markers | *"spawn anchors, tunnel mouths, HVT positions"* |

The runtime is honest about it, as it was about the ledger. `LedgerData` explains that
it names marked *positions* rather than tunnel mouths because "there are no tunnels in
the sim yet, and a ledger key naming something unbuildable would be a lie in the save
file." A tutorial test asserts these abilities are *not* teachable precisely because
they are data-only.

The consequence is that one of three doctrines is scenery. Ashwar missions field the
same garrison-and-wave shapes as everyone else, and the `ambush` stance carries the
whole doctrinal load on its own.

## The key idea: a tunnel is a third kind of container

The temptation is to model "cannot be shot" as a special immunity flag. That would be
wrong, and the engine already says so. `selectTarget` skips two classes of unit:

```
// Men inside a building cannot be shot at: the building is in the way,
// and taking it down is the only way to reach them.
if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0) continue;
```

Garrison and carrier are the same idea twice: a unit inside a container is unreachable,
and the counterplay is destroying the container. A tunnel is that idea a third time.
This matters because it means the design adds no new *rule* — a digger underground is
not invulnerable, it is contained, and Yahalom is not a hard counter, it is the way you
destroy this particular container. Everything about how the shot resolves once someone
surfaces stays exactly as the combat model already has it.

The trail has a precedent too. The smoke grid is already a per-tile scalar with integer
decay (`SMOKE_MAX`, `SMOKE_DECAY` in `tuning.ts`). Surface spoil is that shape with a
slower burn.

## Declaring a tunnel

Route geometry lives in the **map**, not the mission. A map already declares markers and
zones that missions reference by id, and its own schema has anticipated tunnel mouths
since the format was written. Geometry belongs with geometry, and one map then supports
several missions with different tunnel activity.

```json
"tunnels": [
  {
    "id": "tn_north",
    "mouth": [4, 22],
    "waypoints": [[9, 20], [14, 18]],
    "vent": [18, 16],
    "dig_tiles_per_s": 0.15
  }
]
```

A mission activates routes and stocks them. A garrison placement gains one field:

```json
{ "unit": "rpg_team", "count": 2, "in_tunnel": "tn_north" }
```

A route the mission does not reference simply does not exist that mission — no digger,
no trail, no vent. This keeps the map reusable and keeps mission files declarative, per
CLAUDE.md's rule that missions are data and never TypeScript.

## State

New module `packages/sim/src/tunnels.ts`, sibling to `structures.ts`. `sim.ts` is 3425
lines; new mass belongs outside it.

Per-tunnel, struct-of-arrays over typed arrays as the hot loop requires:

| Column | Meaning |
|---|---|
| `tnAlive` | route is live; cleared on collapse |
| `tnProgress` | Fx, tiles dug along the route |
| `tnLength` | Fx, total route length, precomputed from the polyline |
| `tnVentOpen` | progress has reached the vent |
| `tnOccupants` | how many units are currently below |

Three new per-unit columns in the entity SoA:

| Column | Meaning |
|---|---|
| `tunnelIn` | route index, or −1 on the surface — the third containment index |
| `surfaceTicks` | remaining minimum exposure once surfaced |
| `volleyLeft` | shots remaining in the committed burst |

The trail is a per-tile `Uint8Array` with integer decay, allocated like the smoke grid.

## Systems

Three steps, called from `Sim.tick` in fixed order, before combat.

**`stepDigging`** advances `tnProgress` by the route's dig rate while a living digger is
assigned to it, stamps trail density on newly covered tiles, and opens the vent when
progress reaches length. A route with no living digger stops advancing but does not
collapse — the tunnel that exists still exists.

**`stepSurfacing`** governs the loop the player actually fights. A unit below, in a route
whose vent is open, surfaces *at the vent* when a hostile is inside its weapon's effective
range **of the vent tile and in line of sight from it** — the same `losRay` check firing
uses, evaluated from the vent rather than from the unit, since that is where the unit will
be standing. Without the sight-line condition a unit surfaces into a wall it cannot shoot
past and burns its whole exposure window doing nothing.

On surfacing, its position becomes the vent tile, `tunnelIn` clears, `volleyLeft` is set from its
weapon's burst, and `surfaceTicks` is set to the minimum exposure window. While up it is
an ordinary unit in every respect — detected by §5.1, hit by §5.2, penetrated by §5.3,
suppressed by §5.5. It submerges only when the volley is spent **and** the window has
elapsed, so there is always a guaranteed reaction slot. Suppression does not shorten the
window; a unit caught in the open is caught in the open.

**`stepTunnelCharge`** is Yahalom's dig-and-charge, modelled directly on `stepDemolition`.
The team must be stationary, unpinned and undisplaced, within charge range of a *revealed*
trail tile. Ticks accumulate; pinning, displacement or death resets them, exactly as
demolition charges reset today. On completion the route collapses: `tnAlive` clears, the
trail begins decaying, and every occupant is destroyed and attributed to the Yahalom so
that kill credit and ROE resolve through the normal path.

Occupants die rather than bailing out wounded. The carrier precedent (`BAILOUT_DAMAGE_FRAC`,
`BAILOUT_SHOCK`) was considered and rejected: a bailing squad has somewhere to bail *to*,
and a collapsing tunnel does not. Decisive is also more readable — one charge, one route,
one visible result.

The loop this produces is the point. Yahalom must stand still, in the open, beside a
tunnel that can vent shooters at it. Escorting it is the gameplay.

## Being untargetable, honestly

Containment leaks if it is only enforced at target selection. Three places need it:

1. `selectTarget` — `tunnelIn[t] >= 0` joins the existing skip.
2. `splashAt` — ordnance does not reach three metres of earth. Without this a mortar
   barrage over a trail kills the occupants and the counter-unit is pointless.
3. `applySuppression` — you cannot pin someone underground.

The second and third are the ones that would be forgotten, and each would silently
invalidate the whole feature rather than produce a visible bug.

## Detecting the trail

Trail visibility reuses §5.1 rather than building a parallel system. Contact confidence
accrues per side *against the tunnel* — not per trail tile, which would mean a second
contact array — driven by the nearest trail tile in line of sight with a low base
signature. The three-state ladder is the existing one: unknown → suspected → identified,
with `SUSPECTED_AT` / `IDENTIFIED_AT` / `LOST_AT` unchanged.

`mark_tunnel`, already authored on `recon_drone` and read by nothing, sets it to
identified immediately. That is what makes recon quality matter to this subsystem, and
it is the ability's first actual job.

A route may only be charged once identified. Suspected is a blip that tells you
something is under there; it is not a firing solution.

## The two units

**`digger_crew`** (Ashwar) — slow, unarmed, `dig_tunnel`. Naming matches `mortar_crew`.
It is not a combat unit and should not be: its threat is entirely what the route delivers.

**`yahalom_squad`** (KDF) — `tunnel_charge`, and the ordinary carbines its closest sibling
`demo_squad` carries. Naming matches `demo_squad`, whose shape it follows.

Both must clear `validate_balance.py` within the ±18% band. The cost curve refits from
the current roster on every run, so two additions shift it slightly and the gate must be
run on both together, not one at a time.

**One landmine to design around.** CLAUDE.md records that `starting_force` never consults
a unit's `unlock` gate — `spawnPlacement` has no equivalent of the `buildBlockedReason`
check `requestBuild` makes. If `yahalom_squad` is ROE-gated *and* is the only counter,
then any mission that expects the player to build one hands a low-ROE player a mission
that is unwinnable rather than hard. That is precisely the trap Wadi Halam V has with its
demolishers. The rule this sets for every tunnel mission: **Yahalom arrives in
`starting_force`; it is never something the player is expected to produce.**

## The `collapse` objective

Already in the schema enum, already throwing at `mission.ts`'s `SUPPORTED` gate.

It mirrors `raze`, whose rule the schema already states: *"every structure inside the zone
named by `target` is destroyed. The set is snapshotted at mission start, so a zone holding
no structures is an authoring error rather than an instant win."* `collapse` reads the same
way — every tunnel whose **mouth** lies inside the zone named by `target` must be destroyed,
the set is snapshotted at mission start, and a zone containing no tunnel mouths is an
authoring error rather than an instant win.

`target` is a single string in the schema and stays that way. Zone-scoped rather than
id-scoped is what makes "find and destroy all the tunnels under this district" one
objective rather than one objective per route, and it means an author who adds a sixth
route to a map does not have to remember to add a sixth objective to the mission.

It must also be **failable**, for the reason `raze` was given a failure branch in
[4e2fd21](https://github.com/ilan-pinto/roaring-lions/commit/4e2fd21): an objective that
can only ever be pending makes an impossible mission stuck rather than lost. `collapse`
fails when no living unit can carry a charge and none can be produced.

## Determinism

Nothing here draws randomness. Dig progress is Fx addition, trail decay is integer
subtraction, and every surfacing decision is a deterministic threshold comparison — the
surface/submerge choice deliberately takes no RNG draw, so entity counts changing
mid-mission cannot perturb it.

The determinism replay must gain a tunnel and the golden hash must be re-pinned in the
same commit, with the reason stated. Precedent: [cb494c2](https://github.com/ilan-pinto/roaring-lions/commit/cb494c2),
which did exactly this when buildings entered the replay.

## Validation

- `tunnels.test.ts` colocates. Combat maths requires tests per CLAUDE.md; this is combat
  maths.
- Containment is the highest-risk area and needs a test per leak point: a unit below
  cannot be selected as a target, cannot be splashed, cannot be suppressed.
- The exposure window needs a test that a surfaced unit stays up for the full window even
  under fire that would otherwise pin it.
- `pnpm validate:data` must reject three authoring errors the runtime would otherwise hit
  mid-mission: an `in_tunnel` naming a route the map does not declare, a `collapse` whose
  `target` is not a declared zone, and a `collapse` over a zone containing no tunnel mouths.
  Schema-versus-runtime drift is an existing wound here, since four objective types already
  pass the data gate and then throw at load, and this design must not widen it.

  The third check has no precedent to copy. `raze` is guarded at *runtime* — `complete`
  requires `targets.length > 0`, so an empty zone cannot produce an instant win — but the
  validator never checks it, since it validates that the zone exists and what it contains,
  never that it contains anything. The cost of that is displaced rather than absent: an
  empty `raze` zone becomes a primary that fails at its deadline, or a secondary that
  silently never completes, and either way the author finds out by playing instead of in
  CI. `collapse` should carry the same runtime guard *and* the authoring-time check, so
  the failure lands where it is cheapest to fix.
- `walk_mission` gains tunnel progress and trail extent in its world dump. No unit test
  sees an authored world; the walkers exist for exactly this.
- `pnpm balance` must still pass all five §5.7 targets unchanged. Nothing in this design
  touches the combat model, so any movement in those numbers is a bug in this work.

## Scope

**In:** the subsystem — geometry, digger, trail, detection, surfacing loop, Yahalom, the
charge, collapse, and the `collapse` objective type.

**Out, deliberately:**

- The mission that uses it. Separate spec, tracked as a GitHub issue.
- ROE cost for collapsing a route running under a civilian structure. Rich, and not
  needed to prove the subsystem.
- Segment-level collapse and re-digging after a collapse. The approved model is one
  charge, one route.
- Retrofitting `tunnel_travel` onto `rpg_team`, `mortar_crew` and `militia_cell`, which
  already declare it. Those three units currently work; changing them is a balance
  question, not a subsystem question.
- Intel as a gate on trail discovery. Six of ten missions cannot currently afford a
  single intel purchase, so gating this behind intel would gate it behind a separate
  re-pricing job.

## Sequencing

Four slices, each independently testable, risk front-loaded:

1. **Geometry, digger, trail, detection.** A visible threat that does nothing yet. Proves
   the map schema, the SoA, and the detection reuse before any combat depends on them.
2. **Surface → volley → submerge.** The combat loop, including all three containment leak
   points.
3. **Yahalom, the charge, collapse.** The counter, and the `collapse` objective type.
4. **The mission.** Its own spec, its own issue — Beit Sahwan IV, `subterranean` phase,
   which would be the first mission to use that phase and would take Beit Sahwan to five
   missions, GDD §6's stated ceiling.

Slices 1–3 are this spec. Slice 4 depends on all three.

---

## As built

Sixteen tasks, 35 commits. Every gate green: 567 tests, determinism pinned at
`3003042083`, all five §5.7 backtest figures unmoved, the cost curve holding 25 units in
band. What follows is where the built subsystem departs from the design above, because a
spec that quietly disagrees with its own implementation is worse than no spec.

### "Being untargetable, honestly" undercounted itself badly

The design says containment needs enforcing in *three* places — target selection, splash,
suppression. That was wrong by an order of magnitude, and the way it was wrong is the most
useful thing this document can pass on.

The real count is roughly two dozen. They arrived in four waves, each found by a review
rather than by design: the briefed three; then strikes, kamikaze dives, sight, and shells
already in flight; then movement orders and zone-holding; then a sweep that turned up
another twenty-two, of which twenty were gated only by the `in_tunnel` schema key not yet
existing. Writing the tests found two more the sweep had missed.

The lesson is not "we forgot some places". It is that **the enumeration was the wrong
shape of answer**. Containment finally converged only when it stopped being a list:

- one eligibility check where `applyCommands` expands `cmd.ids`, so every surface command
  refuses a buried unit by construction rather than by remembering
- `putInTunnel` clearing the *whole* order bundle, because `stepSweep`, `stepTransport` and
  kamikaze steering set `moving = 1` with no command at all
- a belt in `stepMovement` itself, so the next autonomous mover inherits containment for free

Worth recording honestly: those structural fixes closed only 8 of the 22 leaks. The
majority lived in mission-runtime *state readers* — predicates counting a buried unit as
present, endangered, evacuable or intel-generating — and each needed its own guard. The
diagnosis "leaks are writers" was half wrong, and the half that was wrong was the bigger half.

### Rules that changed during the build

- **An identified route's contact no longer decays.** Decay exists because units move; a
  tunnel is fixed geography. Observed live: a `mark_tunnel` handover expiring mid-charge at
  117 of 160 ticks, which made the ability defeat itself. Suspected contacts still decay.
  Consequence: `lost` is structurally unreachable at level 2.
- **Surfacing is level-triggered, not edge-triggered.** The design's literal reading
  stranded any unit whose burst outlived its exposure window — a slow rate of fire, or a
  pin across the window's end — permanently on the surface.
- **A charge keys on route geometry, not on a revealed trail tile.** A `pre_dug` route has
  no spoil, so trail-keyed charging made the counter-unit unusable against exactly the
  routes a mission is most likely to author.
- **`stepTunnelCharge` runs after upkeep**, and its in-range stop precedes its displaced
  gate, matching `stepDemolition`. Without the hoist a team walking to a route under a
  building grinds against the wall forever instead of charging.
- **`pre_dug` was invented during the build** and does not appear above. Routes start
  unfinished, so an `in_tunnel` garrison could never surface unless something dug the
  route — and whether a digger will dig a given route is not determinable from mission
  data. The validator could not express the check, so the schema grew the concept instead.
- **`volleyLeft` is a constant** (`SURFACE_VOLLEY`), not the weapon's burst.
- **Four per-unit columns**, not three: `homeTunnel` joined `tunnelIn`, `surfaceTicks` and
  `volleyLeft`, and the distinction between the first two is load-bearing — `tunnelIn >= 0`
  is *contained*, `homeTunnel >= 0` with `tunnelIn === -1` is *an ordinary surface unit*.
- **All map routes register unconditionally.** The design says a route a mission does not
  reference does not exist that mission; in fact unreferenced routes are inert but still
  count when a `collapse` objective tallies mouths in a zone.

### What is built but not yet reachable from content

The engine is complete; two content keys are not in the ignition. `assignDigger` and
`identifyTunnelTo` have **no production callers** — no declarative form assigns a digger to
a route, and nothing wires the `mark_tunnel` ability to the primitive that would honour it.

The chain matters: no authored dig means no spoil, and spoil is the only authorable
identification channel, so **no authored mission can currently identify a route** — which
means `chargeTunnel` and any `collapse` objective are completable today only through debug
APIs. The one playable shape this branch enables is a `pre_dug` route with an `in_tunnel`
garrison venting an ambush, counterable by shooting surfacers but never by collapsing the
tunnel.

Nothing shipped is broken, because no mission uses tunnels yet. But the first `collapse`
mission an author writes will validate green and fail at its deadline every time, and the
validator cannot warn about it. Wiring both is a prerequisite for the mission tracked in
issue #91 — not a nice-to-have.

### Still open

`walk_mission` prints route progress, vent state, occupants and contact, but not the trail
extent the design asked for. Collapsing a route leaves its contact state frozen rather than
cleared; that is inert only because every consumer checks `tnAlive` first, and fixing it
moves the determinism pin, so it wants its own deliberate commit.
