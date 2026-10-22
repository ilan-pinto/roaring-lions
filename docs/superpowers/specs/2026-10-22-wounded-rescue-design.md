# Wounded and rescue: medic units and medic buildings (design)

GH-707, with GH-709's three medic units (#5 `veh_ambulance`, #6 `air_medevac_heli`,
#7 `inf_medic_squad`). Lane C (sim), stream 1. **Design only: nothing here is built.**
Read against `origin/main` at `a886c3b2` (22 Oct 2026). Section 9 lists the questions;
section 0 records the lead's rulings on them, and where a ruling and the text below
differ, **the ruling wins**. The plan is
`docs/superpowers/plans/2026-10-22-wounded-rescue.md`.

## 0. Lead rulings (22 Oct 2026, PR #728)

1. **Model A** (a squad sheds a one-man `wounded_<faction>` entity with a bleed timer
   and a crawl to cover; rescue reuses the transport, carrier and landing code).
2. **Scope: ALL infantry, everywhere** -- not a per-mission opt-in (Q1's
   recommendation is overruled). Every shipped foot unit with more than one figure on
   both sides gets `hull.wounds`, and civilians go down in place (section 6). The
   golden hash, versus pins, §5.7 balance, playtest, and possibly `LADDER_CREDITS` and
   `ROSTER_MAX` are expected to move; each is measured and re-pinned with its reason
   in the content-on step (P3). **Any §5.7 target that fails goes back to the lead
   before re-tuning.** There is no `wounded: true` mission flag and no `&wounded`
   sandbox flag.
3. **Conduct gains approved**: +2 per enemy wounded rescued (admitted or evacuated),
   +3 per civilian wounded, capped at +10 per mission, never above 100. The civilian
   deduction moves from the hit to the death.
4. **Meshy approved, about 120-150 credits**, for the medic team, stretcher and tent.
   An Opus agent at high effort writes the prompts; every call is announced with its
   credit estimate first. The ambulance and medevac reuse the Namer and Yanshuf GLBs.
   Because the tent is funded, **Q7 resolves to a NEW `kdf_aid_post` tent structure**;
   `kdf_medic_station` keeps its aura and is not extended.
5. **Last man down: the squad dies as today** (memorial row). He may still leave a
   wounded body; his rescue counts as evacuated and creates no roster entry (Q3, the
   spec's recommendation, taken by the PM).

The questions not ruled on (Q4, Q5, Q6, Q8, Q9, Q11) take the recommendation written
under each in section 9. Build order is three phases (section 10): **P1** the engine
with no content turned on and no pin moved, **P2** the content (medic team, stretcher,
aid post tent, ambulance, medevac, `wounded_*` types) still not attached to any
shipped infantry, **P3** `hull.wounds` on all infantry, measured and re-pinned.

## 1. What the sim does today (the ground this stands on)

- **A squad is one entity with one pooled `hp`.** `inf_squad` is `hull.hp` 400 and
  `hull.crew` 8, and **`crew` is read by nothing in `packages/sim`** (schema-only).
  `applyDamage` (`sim.ts:6225`) subtracts from `hp[target]` and calls `destroy` at
  <= 0; there is no per-man state anywhere in the sim.
- **The renderer does not drop figures as hp falls.** `units/squad-rig.ts` gives each
  figure (`extras.rl_figures`) its own clip player and path to its slot; every figure
  stands until the ENTITY dies, then `mesh-death.ts` topples them all (D5) or plays
  the Meshy `fall`/`fallAlt`. A squad at 5% hp draws three healthy men.
- **Field recovery already abstracts walking wounded.** After `REGEN_DELAY_TICKS`
  (200, 10 s) undamaged, a unit regains `REGEN_FRAC` of max hp a tick up to
  `REGEN_CAP` (0.7). The field-works aura (#277/#703) raises rate and cap:
  `kdf_medic_station` (`data/structures.json`, 250 logistics, 2x2, 20 s build) is
  `radius 4, affects foot, heal_per_s 0.01, heal_cap 1.0`, read in the same regen
  block (`sim.ts:~8092`).
- **Carriers.** `stepTransport` (`sim.ts:6528`) pins a carried unit to its carrier
  every tick; `canEmbark` (`hull.can_embark`, default `FOOT_ROLES`) gates who boards;
  `transport_slots` counts ENTITIES (a squad is one slot: Namer 5, Kipod 6,
  `heli_yanshuf` 6). The Yanshuf is the first air carrier (GH-698): `airState` /
  `airTimer` / `airWant`, land then load, and its columns are folded into the hash
  only once `addUnitType` registers an air carrier (`airLive`).
- **The deferred-fold precedent.** Field works (`fwLive`) and air carriers
  (`airLive`) fold their columns into `hash()` only once content uses them, with a
  marker word and no length word, so adding the engine moved **no** golden, versus,
  net or economy pin. This design copies that shape (`woundLive`).
- **Ids are never recycled.** Per-entity RNG (`rng.ts`, mulberry32 per id) is why a
  mid-mission spawn reshuffles nobody else's rolls, and every per-tick scan bounds on
  `this.count`, the LIFETIME spawn count (CLAUDE.md, "Known scaling debts").
- **Conduct is deduction-only.** `MissionRuntime.stepRoe` starts at 100 and deducts
  (civilian casualties 8, fire into a flagged zone 5, structures), floored at 0, judged
  on player-caused harm only. There is no gain path today.
- **Roster.** `roster.surviving_units` is written in the app's victory write
  (`applyRosterCarryover`), capped at `ROSTER_CAP` 150, R-2 replacing re-enlisted
  bodies; losses are memorialised (WP-G-E4, GH-417). `pnpm playtest` pins
  `ROSTER_MAX` 29 and `LADDER_CREDITS` 5920.

## 2. The three models

All three keep vehicles out of scope (crew bail-out is a follow-up) and apply to
foot units that carry `hull.wounds` in data (section 4); by ruling 2 that is every
infantry unit once P3 lands.

### Model A -- a squad sheds a `wounded` entity

A squad of F drawn figures has F **figure shares** of its hp (`hp / F`). When a hit
carries `hp` across a share boundary, one man falls: a per-entity roll on the
squad's own stream (`wound_chance`, default 0.6) decides **killed** or **wounded**.
Wounded spawns a new single-man entity of the side's `wounded_<faction>` type at the
squad's position, holding `woundParent` (the squad id) and the squad's `scars`.
The squad keeps fighting; a new column `figuresUp` drops by one either way, and its
hp ceiling (regen and aura) becomes `figuresUp / F` of type hp.

- **A wounded entity is a unit like any other**, so everything rescue needs already
  exists: flow fields, `stepTransport` boarding (one slot), carriers, the Yanshuf's
  land/load/lift, `evacuated` events, per-side identification (a medic needs to SEE
  him), fog, selection, the HUD card.
- **Sim cost at 300 units.** Wounded have no weapon (or one pistol, Q5), sight 0 and
  no observer role, so `selectTarget` and the observer half of `stepDetection` skip
  them in one branch; they cost only as TARGETS of detection, O(N x W). With W capped
  (`MAX_WOUNDED_PER_SIDE` 24) that is <= +16% detection pairs, on a tick measured at
  2.08 ms for 300 units (4.2% of budget). The real cost is `this.count`: every shed
  man is a new lifetime id. A heavy 7-minute fight sheds ~100-200; at the measured
  slope this is well under 1 ms, but it compounds the existing debt and must be named
  in `docs/PERFORMANCE.md`.
- **Determinism.** New columns (`woundParent`, `bleedTicks`, `figuresUp`, `scars`,
  `stabilised`) fold under `woundLive`, set only when a type with a `wounds` block is
  registered. The wound roll draws from the SQUAD's stream only at a share crossing,
  which never happens without the opt-in, so worlds with no `wounds` content are
  bit-identical. Spawned wounded take the next id, exactly as mid-mission
  reinforcements do.
- **Presentation fits naturally**: `figuresUp` tells `squad-rig` which figures to hide
  or topple (a real gain: squads finally visibly lose men), and the wounded entity
  draws as one prone figure with its own clips.
- **Weakness.** A spawn per fallen man; `this.count` grows; a man is pooled again once
  he rejoins (per-man identity is not kept).

### Model B -- per-figure health columns

Replace pooled hp with `figHp[i * MAX_FIG + k]` (MAX_FIG 4). Every hit picks a figure
(an RNG draw) and damages it; a figure at 0 is down; squad hp is the sum.

- **Cost.** 4x hp storage (300 x 4 x Int32, trivial) but an extra RNG draw and figure
  pick on **every hit in the game**, wounded content or not.
- **Determinism.** The extra draw shifts every squad's stream: golden, versus, net,
  `pnpm balance` (§5.7 urban), `playtest` all move on day one, and cannot be deferred.
- **Rescue fits badly.** A down figure has no position of its own: it travels with
  the squad entity, so a squad cannot leave him, a medic cannot drag him, and an
  ambulance cannot carry him without spawning an entity anyway, which is Model A
  plus B's cost.
- **Its one advantage**, true per-man identity (named casualties, "weaker" per man),
  is a roster nicety the pooled squad cannot use elsewhere.

### Model C -- a casualty pool per squad

Each squad gets K = 3 casualty slots: `casX/casY` (fixed point, where he fell),
`casBleed` (ticks left), `casState` (down / stabilised / carried / gone). A man falls
as in A, but no entity is spawned; a medic in reach of a slot works it; "carried"
is a medic column naming (squad, slot); an aid post or carrier consumes the token.

- **Cost.** Cheapest: no ids, 3 x 4 columns, a slot loop only for squads with a live
  casualty. Deferred fold as in A.
- **Rescue fits partly.** Treat-in-place and drag (medic carries a token) are fine,
  but every carrier path (ambulance, Yanshuf medevac, `canEmbark`, `stepTransport`,
  APS of the unloaded, fog of the casualty, picking him on screen) needs a parallel
  token path, and enemy and civilian wounded need the same slots on civilians. Two
  code paths for "a body that is carried" is the shape CLAUDE.md warns about (a
  fourth cover loop).
- **Presentation** must invent a drawn figure from slot columns with no entity, no
  selection and no HUD card.

### Side by side

| | A shed entity | B per-figure hp | C casualty pool |
|---|---|---|---|
| Per-tick cost at 300 | +<=16% detection pairs, + lifetime ids | + RNG pick per hit | ~0 |
| Pins moved by the ENGINE alone | none (deferred fold) | all of them | none |
| Drag / stretcher / ambulance / medevac | reuse transport | needs A anyway | parallel token path |
| Enemy / civilian wounded | same type, other side | squad-only | slots on civilians too |
| Renderer | `figuresUp` + one prone unit | per-figure truth | synthesised figures |
| Per-man identity | no | yes | no |

## 3. Recommendation: Model A, opt-in by data, deferred hash fold (RULED: A, all infantry)

A is the only model where the rescue chain (treat, drag, stretcher, ambulance, medevac,
aid post) is built from parts the sim already proves: transport, air carriers, flow
fields and identification. It costs nothing until content opts in, so the engine can
land with every pin standing, and switching it on for shipped infantry becomes one
measured, separately-blessed step (Q1). **Ruled:** Model A; the switch-on (P3) covers
all infantry, not one Act.

## 4. Model A in full

**Data.** A unit opts in with `hull.wounds`:
`{ "wound_chance": 0.6, "bleed_s": 60, "crawl_tiles_s": 0.12, "type": "wounded_kdf" }`.
F is taken from the GLB's figure count, mirrored as `hull.figures` in JSON (the sim
must not read art; `mesh_roster.test.ts` pins the two equal). `wounded_kdf` and
`wounded_sarim` are ordinary unit JSON (role `wounded`, hp 30, no weapon, sight 0,
`can_embark: true`, signature 0.3, not buildable, not in any store), so the cost
curve and `validate_balance.py` skip them by role.

**Falling.** At a share crossing: roll on the squad's stream; wounded spawns unless
`MAX_WOUNDED_PER_SIDE` alive is reached (then killed). The LAST man's crossing is the
squad's death as today (`destroy`, memorial), and may still leave a wounded body
(ruling 5): that body's parent is dead, so his admission or evacuation counts as
evacuated and creates no roster entry. A single-figure unit (`hull.figures` 1: the
civilians) does not spawn: it goes down IN PLACE (`hull.wounds.in_place`), the same
entity becoming wounded, so its id, `civIds` membership and refuge latches are kept.

**Bleed-out.** `bleedTicks` counts down from `bleed_s`; at 0 the wounded entity is
destroyed (`destroyed`, `by` = the original shooter, so Conduct and kill credit stay
honest). Halved while suppressed past the pin threshold; paused while `stabilised`.
Any hit on a wounded is lethal (hp 30).

**Crawl to cover.** On spawn and every 2 s while unstabilised and not carried, he
crawls at `crawl_tiles_s` toward the best-cover open tile within 2 tiles (a 5x5 scan
of `cover`, ties broken by tile index, no flow field); he stops on cover >= 2 or
when a medic is adjacent. No player orders (he is selectable only to read his timer).

**Targeting.** `selectTarget` skips role `wounded` for both sides (hors de combat);
splash and strays still hit him. Player fire that kills an enemy or civilian wounded
deducts Conduct (section 6).

**The medic.** `inf_medic_squad` carries a new ability `rescue` and a stance-like
automatic behaviour (precedent: `CivilianFlight`, auto-shepherding): an idle medic
picks the nearest friendly IDENTIFIED wounded within `rescue_radius` (8 tiles),
paths to him, then:
1. **Treat** (`treat_s` 6): sets `stabilised` (bleed stops). Kneels; takes cover bonus.
2. **Drag** (no stretcher): boards him as a passenger (1 slot) and walks at
   `drag_speed_mult` 0.5 to the nearest aid post, ambulance or LZ. The squad may
   throw smoke (existing `smoke` ability) on the way out (Q6).
3. **Stretcher** (a two-man medic team carries one): `carry_speed_mult` 0.75.
A player order overrides the automatic choice (right-click a wounded = `rescue`
order, the `attack` order's shape: `focusTarget` reuse). **Medic speed-up:** a
wounded inside any friendly medic's 2-tile treat reach bleeds at 0 and recovers at
the aid post twice as fast.

**The aid post / medic tent.** A new field-works structure `kdf_aid_post` (2x3,
footprint `buildable`, 200 logistics) beside the existing `kdf_medic_station`
(Q7 RULED by ruling 4: the new tent; the station is not extended). The engine reads an
optional structure `aid` block (`admit_radius`, `treat_s`, `dispatch_radius`), so any
structure type may admit; P2 gives it to the tent only. Its aura keeps the station's heal; new: wounded
unloaded within 1 tile are **admitted** (entity removed, `evacuated`-shaped event),
treated for `treat_s` 20, then **rejoin**; and a `dispatch` field auto-assigns its
idle medics within 12 tiles (the "sends stretcher teams out" ask) without a new
spawner.

**Ambulance and medevac.** `veh_ambulance` is a carrier with a NEW `can_carry` filter (schema field), here
role `wounded` (4 slots) with a moving stabilise aura (radius 1.5); unloading at an
aid post admits, and reaching a map-edge `evac` marker evacuates. `air_medevac_heli`
is the Yanshuf airframe and state machine with the same `can_carry` filter;
lift-off with wounded aboard **evacuates** them (out of this fight, alive for the
roster: Q4).

**Rejoin and "weaker each time".** On admission completion the parent squad, if alive,
gets `figuresUp + 1` and hp `+ share x max(0.4, 1 - 0.2 x scars)`, then `scars + 1`;
he "walks back" abstractly (no entity, Q8). If the parent is dead he joins the
nearest same-type squad below full, else he counts as evacuated. `scars` is a
mission-scoped squad column (Q9).

## 5. Pins

| Step | Golden | versus | playtest | LADDER_CREDITS | ROSTER_MAX | §5.7 balance |
|---|---|---|---|---|---|---|
| P1 engine + deferred fold, no content | no | no | no | no | no | no |
| P2 medic units, aid post tent, `wounded_*` types, ambulance, medevac (no infantry carries `hull.wounds`) | no | no | no | no | no | no (role skipped) |
| P3 `hull.wounds` on all shipped KDF + Sarim infantry, civilians down in place | **yes** (replay has infantry) | **yes** | **likely** (losses, timings) | possibly (grades read losses) | possibly (rejoined/evacuated) | **yes**: hp ceiling `figuresUp` changes regen; cap-only effects |

P3 is the only step that moves anything and is its own PR with its measurements and
bless. The per-mission escape (`wounded: true`) was offered and **declined** (ruling 2).
A §5.7 target that fails in P3 goes back to the lead before any re-tuning.

## 6. Roster and Conduct

- **Roster.** A squad that ends the mission alive carries `figuresUp`-weighted hp as
  today (no new field). A new optional service-record line `wounded_in_action` (count)
  and `rescued` (count) per entry; memorial rows unchanged. Evacuated wounded of a
  DEAD squad are not a new roster entry (they are pooled men, not a named unit): the
  debrief prints "N evacuated" (Q4). `ROSTER_CAP` and R-2 untouched.
- **Conduct gains** (RULED, ruling 3: approved as written). Friendly rescue earns nothing (it is
  tactics, and it pays in hp). **Enemy wounded admitted or evacuated: +2 each**;
  **civilian wounded admitted or evacuated: +3 each**; both capped at 100 and at +10
  per mission. A civilian hit by the player becomes a wounded civilian (a `downed`
  column on the civilian entity, which is already a single man) and the casualty
  deduction moves from the hit to the **death**, so a rescued civilian costs nothing.
  Killing a wounded enemy or civilian with player fire: the civilian penalty (8) for
  a civilian, 3 for an enemy wounded. Prisoners: a follow-up on the same admission
  path.

## 7. Presentation

- **Clips.** Wounded: `down` (exists on every team rig), `crawl`, `idleWounded`,
  `dragged` (on his back, heels trailing), `carried` (stretcher). Medic: `treat`
  (kneel), `drag` (walking backwards, both hands at a collar), `carry` (two-man
  stretcher). Authored in `rig.py` tables like every other clip; the motion, gait and
  ground passes apply (a dragged body is exempt from foot planting, named in
  `BELOW_GROUND_BY_DESIGN` if needed).
- **Squads lose men visibly**: `squad-rig` hides the topmost-index figure per lost
  share (the wounded entity draws him on the ground), the first time hp reads per man.
- **Feed and radio**: a `woundedDown` sim event becomes a feed line "Man down --
  <squad>" and, through the existing voice channel, a "Medic!" radio call, rate-
  limited to one per 8 s per side. **No world speech bubble** (lead's standing rule).
  A wounded icon on the minimap and a bleed ring on the unit card (DOM, not a world
  mark: "no status marks in the world").
- **Strings** through `t()`; none in mission data.

## 8. Art and Meshy

| Asset | Route | Credits (estimate, `pnpm meshy -- estimate`) |
|---|---|---|
| `inf_medic_squad` (two figures, trauma pack, folded stretcher) | text preview 20 + refine 10, 2 rolls, remesh 5 | ~65 |
| stretcher prop (carried, and on the ground) | text preview 20 + remesh 5 | ~25 |
| `kdf_aid_post` tent (2x3) and `_wreck` | text preview 20 + refine 10 + wreck pass | ~30 |
| `wounded_kdf` / `wounded_sarim` | `kit.py` prone figures in team kit (as death figures today) | 0 |
| `veh_ambulance` | `ifv_namer` GLB + Blender raised-roof kit graft (plan 3 path) | 0 (or ~30 if new base) |
| `air_medevac_heli` | `heli_yanshuf` GLB + hoist boom part in Blender | 0 |

**~120 credits (~$2.40), up to ~150 with the ambulance base.** Per the standing rules:
the prompts are written later by an Opus agent at high effort from the lead's drafts
in #709, every call is announced with its estimate first, max detail, no red cross
(star-of-life band or plain panel), team colour not baked, `validate:meshes` IoU
against `inf_squad`, `ifv_namer` and `heli_yanshuf` siblings (the variants will need
a distinct roof and boom to clear 0.88).

## 9. Questions for the lead (ruled 22 Oct: see section 0)

1. **Where do wounds apply?** Every infantry squad on both sides (moves golden,
   versus, §5.7, playtest), or only missions that declare `wounded: true` plus
   free-play `&wounded`? **Recommend: per-mission opt-in first** (one new mission, or
   one Act's missions), all-infantry later after a measured A3.
2. **Model.** **Recommend A** (shed entity, deferred fold). B moves every pin for the
   engine alone and still needs A for drag; C duplicates the carrier path.
3. **Last man down:** does the squad die (memorial) with his body left wounded, or does
   it survive as a 0-standing remnant until he bleeds out? **Recommend: the squad dies
   as today**; his rescue counts as evacuated, never a resurrected squad.
4. **Does an evacuated man return?** **Recommend: not this mission; the debrief
   reports "N evacuated", and no roster entry is created** (pooled men have no name).
5. **Can the wounded fire** (Defilade's pistol while dragged)? **Recommend: no** in v1:
   it needs a weapon on a sight-0 unit and puts him back into `selectTarget`.
6. **Covering smoke**: automatic when a medic goes out under fire, or player-ordered
   only? **Recommend: player-ordered** (`smoke` exists; automatic smoke changes fights
   nobody asked to change).
7. **Aid post**: a new `kdf_aid_post`, or extend `kdf_medic_station` with admission
   and dispatch? **Recommend: extend the station** (one building, already buildable,
   already art-gated) and save the tent for later.
8. **Rejoin**: abstract (hp returns to the parent) or a walking entity? **Recommend:
   abstract**, after the 20 s treatment.
9. **"Weaker each time"**: mission-scoped `scars` (0.8, 0.6, floor 0.4 of a share), or
   carried in the roster? **Recommend: mission-scoped**, with `wounded_in_action` on
   the service record as honour only.
10. **Conduct gains**: allow scores above today's deductions (+2 enemy, +3 civilian,
    +10 per mission, never above 100)? **Recommend: yes**, and move the civilian
    deduction from hit to death.
11. **Enemy AI medics**: does Sarim rescue its own? **Recommend: no in v1** (the
    director has no use for it yet); Sarim wounded exist only to be left or admitted.
12. **Meshy spend ~120-150 credits** for medic team, stretcher and tent. **Recommend:
    approve after Q7**, which can save the tent's 30.

## 10. Build order (ruled)

- **P1 engine, no content, no pin moved.** Schema fields, type parsing, the `woundLive`
  deferred fold, falling (spawn and in-place), bleed, crawl, the targeting skip, the
  medic's automatic rescue and `rescue` order, drag and stretcher carry through the
  transport code, the `can_carry` carrier filter and stabilise aura, aid admission,
  treatment, rejoin with scars, dispatch, evacuation at an `evac` marker or on a
  medevac's lift-off, the events, and Conduct gains and deductions in the mission
  runtime. Every behaviour is proved with test-only types; nothing under `data/units`
  or `data/structures.json` uses a new field. `pnpm test:determinism`, versus, net,
  balance and playtest byte-identical.
- **P2 content, still no pin moved.** `inf_medic_squad`, the stretcher, `kdf_aid_post`
  (tent and `_wreck`), `veh_ambulance` (Namer GLB + roof kit), `air_medevac_heli`
  (Yanshuf GLB + hoist boom), `wounded_kdf` / `wounded_sarim` (kit.py prone figures),
  clips, `squad-rig` figure hiding, feed/radio lines, the HUD bleed ring, roster
  service-record counts. Meshy ~120-150 credits, prompts by an Opus agent at high
  effort, each call announced first. No shipped infantry carries `hull.wounds` yet.
- **P3 turn wounds on for all infantry**, measure, re-pin each moved pin with its
  reason, re-check §5.7 balance (a failing target goes to the lead first).
