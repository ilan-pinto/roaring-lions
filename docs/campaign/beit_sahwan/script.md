# Beit Sahwan — Level Script

**Date:** 2026-09-03 · Written against `docs/campaign/beit_sahwan/design.md` (Option
C, the hostage spine, whose first mission is Option A) and
`docs/campaign/beit_sahwan/narrative.md`, both read in full this session.
Verified against `data/schemas/mission.schema.json`, `packages/sim/src/mission.ts`
and `packages/sim/src/civilians.ts` directly — every shape below is grepped, not
quoted from the design sheet's summary of it. Two missions in full
(`beit_sahwan_breach` / First Light, `beit_sahwan_4_subterranean` / IV); three in
short form (`beit_sahwan_1_recon`, `_2_foothold`, `_3_clearance`), each listing
only what design §7 changes.

**Status vocabulary**, same three words as the narrative sheet: `live` — the
mechanism exists in the schema and the runtime today. `schema` — needs a new
field, no runtime change. `engine` — needs new runtime logic (`stepTriggers`, a
new `SimEvent`, etc.). Applies to the **mechanism** in each ECA row; the separate
`toast`/`radio`/etc. surface status for the bound line is carried inside the
"narrative cue" cell, because the two can differ — a trigger can be `live` while
its only spoken line waits on the unbuilt `radio` overlay (design §9 G7).

Nothing here is written into `data/missions/`, `data/maps/`, or `packages/sim/`.
Every fragment in §§1.7, 3.7, 6 is copy-ready JSON for `mission-author` to
assemble and validate (`pnpm validate:data`, `walk_placements.ts`,
`walk_mission.ts`) outside this worktree's write scope for this agent.

---

## 1. `beit_sahwan_breach` — Beit Sahwan — First Light

`breach` · Captain · `marj_perimeter` · produces `roster.surviving_units`,
`roe.mission_ratings`, `campaign.completed_missions` (+ `civ.settlements_evacuated`,
design §2, zero-risk addition, not touched further here — narrative-designer/
mission-author's line to add, no mechanism attached to it).

### 1.1 Flags

| flag | kind | fiction |
|---|---|---|
| `hold_outpost` (new objective id, mine to name — not player-visible; only trigger ids are, per the vocabulary) | secondary, `hold_for(outpost_ground, 120)` | the forward section held its ground for two minutes before the post went under |
| `evac_settlements` | primary, `evacuate_before(compound, 2, 270)` — **unchanged, load-bearing** | the two families who got inside the wire before the ring closed |
| `hold_compound` | secondary, `hold_for(compound, 180)` — unchanged | the yard was never actually lost |
| `survive_relief` | primary, `survive_until(300)` — unchanged | the column reached the compound at all |
| `villages_rise` (trigger id, **shipped, kept**) | `first_contact` → `commit(ring_ne → families_ne)` | the north-east corner was manned before dawn, not after |
| `they_take_the_south_village` (trigger id, new) | `first_contact` → `commit(ring_se → families_se)` | the south-east cell moves the instant the first round is fired anywhere on the map |
| `they_come_for_the_west_families` (trigger id, new) | `timer_s(150)` → `commit(ring_nw → families_nw)` | the west corner waits — it is the one the shipped plan reaches first |
| `the_last_village_goes` (trigger id, new) | `timer_s(190)` → `commit(ring_sw → families_sw)` | the last corner, staggered latest on purpose (design §5.2: *"reads as the far side went first"*) |
| `they_take_the_section` (trigger id, new, **engine**) | `timer_s(165)` → `remove(outpost_section, outpost_ground)` | the forward post's fate, decided by whoever is still there when the post goes under |
| `the_ring_closes` (trigger id, new, **engine**) | `timer_s(272)` → `remove(families)` | the nine who did not get inside the wire |

**Group note.** `ring_nw/ne/sw/se` are the shipped ambush garrison's four physical
placements (`[6,8] [37,8] [6,39] [38,39]`), each given its **own** `group` string
instead of the shipped shared pair (`north_infiltrators`, `south_infiltrators`).
No new placement — a `group` value edited on four existing entries.

### 1.2 ECA rows — design §5.2 timeline

`markerPos` resolves `to`/`from`; `zone()` resolves `hold_for`/`capture`/
`evacuate_before` targets — confirmed at `packages/sim/src/mission.ts:863-870`.
`first_contact` is a single mission-wide latch set by **any** `fire` event or an
identified contact (`mission.ts:753-754`) — it is not scoped to one side or one
placement, confirmed by reading the digest loop directly.

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| Dawn — the eye and the tube | mission start | `enemy.garrison` +2: `paramotor×1` `[24.5,10.5]` `patrol[[14,10],[34,10]]` `tag bs0_spotter_aloft`; `mortar_crew×1` `[21.5,10.5]` `hold_position` `group barrage` `tag bs0_barrage` | none authored — no line exists for this beat in narrative.md; **hand to narrative-designer** | live |
| The forward section | mission start | `starting_force` entry moved `[21,18]`→`[20,14]`; new secondary `hold_outpost = hold_for(outpost_ground, 120)` | none authored; design §5.6 asks the objective `text` to "name the position, not the men" — **pending narrative-designer** | live |
| Counter-battery, or not | player agency: `mortar_team` (range 18, at `[24,25]`) vs `bs0_barrage` (`[21.5,10.5]`), 15.3 tiles | n/a — no `do`; this is standing unit stats plus map geometry, not an authored mechanism | none — not an event the runtime emits | live |
| The wire, every approach at once (north cluster) | `at_seconds: 18` | wave → `compound_centre`: `militia_cell×2` from each of `raid_nw raid_n raid_ne raid_w raid_e` (10 bodies) | `toast` (live, hard-coded): `enemy reinforcements — 10 unit(s) inbound` | live |
| The wire, every approach at once (south cluster) | `at_seconds: 18` | wave → `assault_sw`: `militia_cell×2` from each of `raid_sw raid_s raid_se` (6 bodies) | `toast` (live): `enemy reinforcements — 6 unit(s) inbound` | live |
| Paramotors over the wire | `at_seconds: 50` | wave → `compound_centre`: `paramotor×2` from `raid_n` | none authored for t=50 specifically — narrative.md's one paramotor line (see t=250 below) binds to the *later* pair, not this one; **hand to narrative-designer** | live |
| Villages rise (NE) | `first_contact` | `commit(ring_ne → families_ne)` | `toast` (live): `enemy reacts (villages_rise)`. `radio` (**engine**, narrative.md §2.5): Idit — *"Movement out of the north corners. Those positions were manned before dawn, not after."* Line still fits: it no longer describes both north placements, only the NE one, since `ring_nw` now waits for its own timer below | live |
| The south village goes too | `first_contact` | `commit(ring_se → families_se)` | `toast` (live): `enemy reacts (they_take_the_south_village)`. No `radio` line exists for this id — narrative.md's south-corner line was bound to the shipped `south_rises` (`timer_s 240`), which this redesign retires; **hand to narrative-designer**, do not reuse the old line unedited (it says "south corners committing" — plural — this trigger is only one) | live |
| The west families wait, then run | `timer_s: 150` | `commit(ring_nw → families_nw)` | none authored; **hand to narrative-designer** | live |
| The last corner goes | `timer_s: 190` | `commit(ring_sw → families_sw)` | none authored; **hand to narrative-designer** | live |
| The forward post is overrun | `at_seconds: 120` | wave → `outpost`: `militia_cell×3` from `raid_nw`, `charge_squad×1` from `raid_n` | none authored; this is the physical event `hold_outpost` is timed against (§1.3) — **hand to narrative-designer** | live |
| A soldier is taken from the post | `timer_s: 165` | `do:{kind:"remove", group:"outpost_section", zone:"outpost_ground"}` | none authored (new mechanism, no surface can speak on it yet either — design §9 G1+G7 stack) | **engine** — schema has no `remove` `do.kind` (`mission.schema.json` triggers.do.kind enum: `commit\|withdraw_to\|spawn\|reinforce\|dismount`) |
| The ring tightens on the near ground | `at_seconds: 160` (moved from shipped 140, content unchanged) | wave → `compound_centre`: `technical×2` from `raid_w`, `rpg_team×2` from `raid_sw` | `toast` (live): `enemy reinforcements — 4 unit(s) inbound` | live |
| The armour comes east | `at_seconds: 205` (moved from shipped 190, content unchanged) | wave → `assault_se`: `moto_rpg×3` from `raid_se`, `militia_cell×4` from `raid_s` | `radio` (**engine**, narrative.md §2.5, retimed 15s, content identical so the line still fits verbatim): Idit — *"South-east now. Same face, other corner — he is reading which one you reinforced."* | live |
| The second lift | `at_seconds: 250` (moved from shipped 245, content unchanged) | wave → `compound_centre`: `paramotor×2` from `raid_n`, `militia_cell×4` from `raid_e` | `radio` (**engine**, retimed 5s, content identical): Idit — *"Two aloft, north. They are coming in over the wire rather than through it."* | live |
| The ring closes | `seconds: 270` (unchanged) | `evac_settlements` resolves complete/failed | `toast` (live, applied): `OBJECTIVE FAILED — Get two families inside the wire before the ring closes` / `radio` (**engine**): Idit — *"The ring is closed. Whatever is still outside it is outside it."* | live |
| The families still outside are taken | `timer_s: 272` | `do:{kind:"remove", group:"families"}` | none authored yet beyond narrative.md's storyline-level T1 sketch (§9 T1): *"The ring is closed on the western villages. There is nothing out there left for us to reach."* — that line was written for a `timer_s(270)` execute-style twist and is close but not identical to this trigger's actual timing/id; **hand to narrative-designer to confirm or adjust** | **engine** — same missing `do.kind` |
| Relief | `seconds: 300` (unchanged) | `survive_relief` resolves complete | `toast` (live, applied): `OBJECTIVE COMPLETE — Still be standing when the relief column arrives` | live |

**Why 272 and not 270**, restated because it is load-bearing for the fragment
below: `stepTriggers` runs before `stepObjectives` in the same tick
(`mission.ts` `step()`), so firing the removal at 272 (not 270) keeps it two
ticks clear of the evacuation deadline — not load-bearing for correctness
(`evacuatedCount` is latched, `collect` already cleared `alive` for anyone who
reached the refuge), but it removes any ordering question, and the removal needs
no zone filter beyond `group` because every living civilian at t=272 is by
definition still outside the refuge.

### 1.3 AI director

**Cadence table**, waves and garrison-commit events combined so the whole
chronology reads in one table (wave objects carry no `id`/`name` field — "W1a"/
"W1b" below are exposition only, not schema). Wave `units[]` items have no
`stance` field (`mission.schema.json` — the inline shape under
`enemy.waves[].units` is `{unit,count,from,group,tag}`, not the shared
`$defs/placement`); a wave-spawned unit simply attack-moves to the wave's `to`
the instant it spawns. Only `enemy.garrison` placements carry a `stance`.

| t (s) | mechanism | size | from | to | group | stance |
|---|---|---|---|---|---|---|
| 0 | garrison | 1 | `[24.5,10.5]` | — (patrol) | — | `patrol` `[[14,10],[34,10]]` |
| 0 | garrison | 1 | `[21.5,10.5]` | — | `barrage` | `hold_position` |
| 0 | garrison | 2 | `[6,8]` | — | `ring_nw` | `ambush(4)` |
| 0 | garrison | 2 | `[37,8]` | — | `ring_ne` | `ambush(4)` |
| 0 | garrison | 2 | `[6,39]` | — | `ring_sw` | `ambush(4)` |
| 0 | garrison | 1 | `[38,39]` | — | `ring_se` | `ambush(3)` |
| 18 | wave | 10 | `raid_nw raid_n raid_ne raid_w raid_e` (×2) | `compound_centre` | — | (none; wave) |
| 18 | wave | 6 | `raid_sw raid_s raid_se` (×2) | `assault_sw` | — | (none) |
| ~0–20 | trigger×2 | (existing 4) | `ring_ne`, `ring_se` | `families_ne`, `families_se` | — | commit overrides ambush stance |
| 50 | wave | 2 | `raid_n` | `compound_centre` | — | (none) |
| 120 | wave | 4 | `raid_nw`(×3) `raid_n`(×1) | `outpost` | — | (none) |
| 150 | trigger | (existing 2) | `ring_nw` | `families_nw` | — | commit overrides ambush |
| 160 | wave | 4 | `raid_w raid_sw` | `compound_centre` | — | (none) |
| 165 | trigger (**engine**) | 1 | `outpost_section` (player) | — (removed) | — | n/a |
| 190 | trigger | (existing 2) | `ring_sw` | `families_sw` | — | commit overrides ambush |
| 205 | wave | 7 | `raid_se`(×3) `raid_s`(×4) | `assault_se` | — | (none) |
| 250 | wave | 6 | `raid_n`(×2) `raid_e`(×4) | `compound_centre` | — | (none) |
| 272 | trigger (**engine**) | 9 (up to) | `families` (civilians) | — (removed) | — | n/a |

**Body count delta, measured against what ships.** Shipped: 7 garrison + 36 wave
bodies = **43**. Redesigned: 9 garrison (+2: spotter, barrage) + 39 wave bodies =
**48**, +11.6% — matching design §5.4 exactly, and the arithmetic is the reason I
can say confidently that the shipped **t=55 and t=95 waves are retired outright**,
not merely unmentioned. Design's prose never states this — it lists the surviving
waves as "the shipped t=140/190/245 wave, moved" and never mentions t=55 or t=95
again — but the numbers only close if both are dropped: 39 = 10+6 (t18) + 2 (t50)
+ 4 (t120) + 4 (t160) + 7 (t205) + 6 (t250), with no room left for the old t=55
(6) or t=95 (6) bodies. Gross churn is larger than the net delta suggests: **12
bodies dropped** (two whole waves) against **21 added** across the enlarged t=18
wave and the two wholly new waves at t=50/t=120, netting +3 on the wave side and
+2 on the garrison side. I'm authoring the wave array on this basis (§1.7); flag
it to `mission-author` and `playtest` as an explicit decision, not an oversight,
since the prose alone doesn't say so.

**Pressure curve.** Nine bodies are live at t=0 and never close — the spotter
paces a lateral beat at sight 14, the barrage crew never moves — so the opening
threat is entirely about denying them a target, not fighting them. The wave
cadence is front-loaded and gets *more* frequent for the first two minutes (t=18,
50, 120 — roughly one beat every 40-70s) before spacing back out to 160/205/250,
and what changes across that curve is direction, not volume: first both flanks of
the wire at once (t=18), then the sky (t=50), then the four corners peeling off
one at a time on their own clock (first-contact ×2, then 150, then 190) while the
forward post falls (t=120) and its survivor's fate is sealed 45s later (t=165),
then three more waves (160/205/250) work the near ground while the evacuation
clock runs out underneath all of it (270) and the last of anyone still outside is
taken two ticks later (272), with relief arriving at 300. The shape a player
should read is: the compound's own wall is never the hard problem — the wall is
`low_profile`, defenders shoot over it for free — the hard problem is that
every minute asks a different question (who do you reinforce, who do you
shepherd, do you spend the mortar on the barrage or hold it for the wire, do you
leave men outside the wire) with the same finite eleven-unit force answering all
of them at once.

**Passive-control and scripted-plan consequences (design §5.5).** The passive
control (`beit_sahwan_breach (passive control)`, no orders at all) must keep
losing on exactly one thing: `evac_settlements` failing at 270s — `hold_compound`
completes by itself since a passive player still holds the yard, and
`survive_relief` would complete at 300s if the mission ran that long, so the
*only* authored floor under the premise "catastrophe" is the evacuation deadline.
Nothing in §1.7's fragments touches its `target`, `count` or `seconds`, so the
control's failure mode is unchanged in kind — but the control's own survivor
count will drop given +5 bodies (43→48) is worth re-measuring, not assuming. The
scripted plan (`led0`, shepherds the two western family groups by jeep+APC,
spends logistics on `inf_squad`/`mortar_team` every 25s) currently wins at
exactly 5.0 minutes with 14 survivors — the tightest of the two required
outcomes, and design §5.5 names three specific risks to it: the new mortar crew
(one round per ~20s at the compound from first contact), the t=18 wave's 16
bodies (more than double the shipped t=20's 7), and the forward section now
standing in the open at `[20,14]` rather than inside the wall at `[21,18]`. The
plan's own west-first shepherd route (toward `[13,19]` at t=5, `[20,21]` at t=45)
still clears both western family groups well before `they_come_for_the_west_families`
(150s) and `the_last_village_goes` (190s) fire, so the retiming of those two
corners should not by itself threaten the plan — but design's own tuning order
(W1's per-marker count 2→1 first, then drop the mortar crew, then the spotter, in
that order, never touching `evac_settlements`) is `playtest`'s to run, not mine to
predict. CLAUDE.md's own recorded stress test (scaling this mission from 36 to
131 attackers moved passive survivors from 9 to 2 without flipping the result)
is a wide historical margin, not a substitute for re-running the actual plan
against the actual +11.6% body count and the actual repositioned forward section.

### 1.4 Map requirements — `marj_perimeter`

All four checked directly against `data/maps/marj_perimeter.json`'s `rows` this
session (`python3` tile lookups, not eyeballing the grid).

| kind | id | tile(s) | purpose | exists today |
|---|---|---|---|---|
| marker | `outpost` | `[20,14]` — tile is `.` | the forward post's ground, and the t=120 wave's `to` | **missing — new, additive** |
| zone | `outpost_ground` | `[19,12,4,4]` — 16 tiles, 15× `.` + one `o` at `(21,13)` | `hold_outpost`'s target; deliberately excludes wall row 16 | **missing — new** |
| marker | `families_nw` | `[12,18]` — `.` | matches the floor of the shipped civilian group's `at:[12.5,18.5]`; `commit` destination for `ring_nw` | **missing — new** |
| marker | `families_ne` | `[35,18]` — `.` | matches `at:[35.5,18.5]`; `ring_ne`'s destination | **missing — new** |
| marker | `families_sw` | `[12,27]` — `.` | matches `at:[12.5,27.5]`; `ring_sw`'s destination | **missing — new** |
| marker | `families_se` | `[35,27]` — `.` | matches `at:[35.5,27.5]`; `ring_se`'s destination | **missing — new** |

Not proposed: the four optional `village_nw/ne/sw/se` withdraw markers design
lists as "if `level-scripter` wants the ring to leave with what it took." I'm not
authoring a withdraw-after-taking twist for the baseline (see §1.5), so these
would be dead weight on the map file. If a future twist wants the raiders to
carry the families off toward the map edge rather than simply vanish at 272s
under the `remove` verb, they're a one-line addition — noted, not added.

### 1.5 Twists

`level-scripter` classification of design §5.7's candidates, cross-checked
against §1.2's actual authored chain — two of the five turn out to already
**be** the baseline rather than an alternative to it, which is worth stating
plainly rather than filing them as options nobody will notice are already
adopted.

| id | twist | classification | note |
|---|---|---|---|
| T-A1 | The eye is the mission — killing `bs0_spotter_aloft` silences the barrage | **expressible today** | emergent from existing per-side identification gating on indirect fire (CLAUDE.md), not a new mechanism. Nothing to author; whether it reads clearly to a player is `playtest`'s to measure, not mine to assert |
| T-A2 | They came for the people, not the post — ring groups commit to families, not `compound_centre` | **expressible today — already the baseline**, not an option layered on top. §1.2's four `commit`-to-`families_*` triggers *are* this twist; the shipped mission's `villages_rise`/`south_rises` commit to `compound_centre` instead, so this design already replaces the shipped behaviour rather than proposing an alternative to it |
| T1 (storyline) | The families that did not get in — taken, not merely left, at 272s | **engine** | `do.kind:"remove"` + a new event kind (design §6.1, §9 G1). Fallback (§6.3, and the one I'm authoring pending the verb): `evac_settlements` already fails visibly at 270s with no new content |
| T-A3 | The section is gone — the forward post's survivors taken at 165s if still there | **engine** | `remove` (G1) **and** `group` on `starting_force` (G2) — the latter is the harder of the two here, since without it there is no way to select "just this squad" even once `remove` exists. Fallback: the section simply lives or dies, no third outcome |
| T-A4 | The wall was never the line — a wave threads the same gate the player's own reinforcements use | **expressible today — already the baseline** | the t=250 wave (`raid_e`→`compound_centre`) already routes past the east gate corridor (`[31,24-25]`); no new content needed |
| T-A5 | They fire on the block they are standing in — an enemy round lands inside `clinic` and the score does not move | **engine (unreliable as "expressible")** | the *staging* (a `mortar_crew`/spotter placed in range of `clinic`) is ordinary placement work, but nothing in the vocabulary can **guarantee** a round lands inside a specific zone — `selectTarget` picks targets, not aimpoints, and there is no scripted-impact verb. Confirmed the asymmetry is real, not assumed: the zone-penalty code filters on `st.side[e.shooter] === 0` (`mission.ts` roe digest, `fire`/`nearMiss`/`strike` branches) — an enemy round is structurally exempt today, so the twist's punchline is already true, it just cannot be staged reliably |

### 1.6 Gap report — First Light only

Ranked by what blocks a row in §1.2/§1.7, not restating design §9's full ten.

1. **G1 — no `do.kind` removes anything.** Blocks both `they_take_the_section`
   (165s) and `the_ring_closes` (272s) — the only two `engine` rows in the whole
   mission. Smallest proposal (design §6.1): `do:{kind:"remove", group, zone?}`
   → `sim.removeFromPlay(id)`, one `alive=0` write on a tick boundary, plus a new
   event kind so the renderer doesn't draw a death pose for an abduction.
   Explicitly not `destroy()` — no ROE deduction; the taking is the enemy's act.
   Owner: `sim-guard` (schema + `mission.ts` + `sim.ts`), `render-vfx` (the
   notice). **Fallback ships today** (§1.7 marks the civilians `group:"families"`
   field as addable now, inert until the verb lands): `evac_settlements` already
   fails visibly at 270s with no new content at all.
2. **G2 — `starting_force` cannot carry a `group`.** Blocks `they_take_the_section`
   specifically (G1 alone isn't enough — without this there is no selector for
   "the forward squad" among the player's units at all). One schema key,
   `group:{type:"string"}`, zero runtime change (`spawnPlacement` already
   registers `p.group` for every side). Owner: `sim-guard`.
3. **G7 — nothing can speak after the deploy screen.** Doesn't block any
   mechanism in §1.2 (every trigger/wave/objective there is otherwise `live`),
   but it is why the "narrative cue bound" column reads `engine` for every
   `radio` line — 9 of the 18 rows. `say:{speaker,text}` on `triggers[].do` and
   `objectives[]`, a new `MissionEvent`, no sim state change. Owner: `sim-guard`
   + `render-vfx`. Already tracked campaign-wide in narrative.md §11 G-E; not
   re-derived here, just ranked behind G1/G2 because it blocks a **surface**,
   not the mechanism the JSON needs to function or validate.

Not ranked (zero effect on this mission's baseline): G3 (buried civilians —
First Light has none), G4/G5/G6/G8 (IV-specific, see §5.6), G9/G10 (no tunnels,
no voice audio authored here).

### 1.7 Copy-ready fragments

Every field name below is grepped against `mission.schema.json` (line numbers
cited once per field the first time it's used, not repeated on every fragment):
`objectives[].{id,type,primary,text,target,count,seconds}` — objectives array
schema; `starting_force[].{unit,count,at}` — `additionalProperties:false`,
confirmed no `group`; `enemy.garrison[]` → `$defs/placement`
`{unit,count,at,facing_deg,group,tag,stance{kind,tiles,waypoints}}`;
`enemy.waves[].{at_seconds,to,units[].{unit,count,from}}`;
`triggers[].{id,on{kind,value,zone},do{kind,group,to,units}}`; `civilians.groups[]`
→ `$defs/placement` (same shape, `group` included). All eleven unit ids
(`inf_squad, at_team, sniper_team, mortar_team, demo_squad, apc_eitan,
jeep_shoded, paramotor, mortar_crew, militia_cell, rpg_team, technical, moto_rpg,
charge_squad, civilians`) resolve under `data/units/kdf/`, `data/units/enemy/` or
`data/units/civilians.json` — confirmed by directory listing this session.

#### (a) Expressible today

**Objectives — append one secondary to the shipped three:**

```json
{
  "id": "hold_outpost",
  "type": "hold_for",
  "primary": false,
  "target": "outpost_ground",
  "seconds": 120
}
```
*`text` intentionally omitted — pending `narrative-designer` (design §5.6: "name
the position, not the men").*

**`starting_force` — full array, one entry moved (`[21,18]` → `[20,14]`), no
`group` field (not in the schema — see §1.5/T-A3 and the engine-gated block
below for the reason):**

```json
[
  { "unit": "inf_squad", "count": 1, "at": [20, 14] },
  { "unit": "inf_squad", "count": 1, "at": [27, 18] },
  { "unit": "inf_squad", "count": 1, "at": [21, 28] },
  { "unit": "inf_squad", "count": 1, "at": [27, 28] },
  { "unit": "at_team", "count": 1, "at": [22, 23] },
  { "unit": "at_team", "count": 1, "at": [27, 23] },
  { "unit": "sniper_team", "count": 1, "at": [24, 21] },
  { "unit": "mortar_team", "count": 1, "at": [24, 25] },
  { "unit": "demo_squad", "count": 1, "at": [26, 26] },
  { "unit": "apc_eitan", "count": 1, "at": [22, 26] },
  { "unit": "jeep_shoded", "count": 1, "at": [25, 23] }
]
```

**`enemy.garrison` — full replacement of the shipped four-entry array (two new,
four renamed groups, bodies and positions otherwise identical):**

```json
[
  {
    "unit": "paramotor",
    "count": 1,
    "at": [24.5, 10.5],
    "tag": "bs0_spotter_aloft",
    "stance": { "kind": "patrol", "waypoints": [[14, 10], [34, 10]] }
  },
  {
    "unit": "mortar_crew",
    "count": 1,
    "at": [21.5, 10.5],
    "group": "barrage",
    "tag": "bs0_barrage",
    "stance": { "kind": "hold_position" }
  },
  {
    "unit": "militia_cell",
    "count": 2,
    "at": [6, 8],
    "facing_deg": 180,
    "group": "ring_nw",
    "stance": { "kind": "ambush", "tiles": 4 }
  },
  {
    "unit": "militia_cell",
    "count": 2,
    "at": [37, 8],
    "facing_deg": 180,
    "group": "ring_ne",
    "stance": { "kind": "ambush", "tiles": 4 }
  },
  {
    "unit": "militia_cell",
    "count": 2,
    "at": [6, 39],
    "facing_deg": 180,
    "group": "ring_sw",
    "stance": { "kind": "ambush", "tiles": 4 }
  },
  {
    "unit": "rpg_team",
    "count": 1,
    "at": [38, 39],
    "facing_deg": 180,
    "group": "ring_se",
    "stance": { "kind": "ambush", "tiles": 3 }
  }
]
```

**`enemy.waves` — full replacement of the shipped six-entry array with seven
entries (see §1.3 for which shipped waves this retires and why):**

```json
[
  {
    "at_seconds": 18,
    "to": "compound_centre",
    "units": [
      { "unit": "militia_cell", "count": 2, "from": "raid_nw" },
      { "unit": "militia_cell", "count": 2, "from": "raid_n" },
      { "unit": "militia_cell", "count": 2, "from": "raid_ne" },
      { "unit": "militia_cell", "count": 2, "from": "raid_w" },
      { "unit": "militia_cell", "count": 2, "from": "raid_e" }
    ]
  },
  {
    "at_seconds": 18,
    "to": "assault_sw",
    "units": [
      { "unit": "militia_cell", "count": 2, "from": "raid_sw" },
      { "unit": "militia_cell", "count": 2, "from": "raid_s" },
      { "unit": "militia_cell", "count": 2, "from": "raid_se" }
    ]
  },
  {
    "at_seconds": 50,
    "to": "compound_centre",
    "units": [{ "unit": "paramotor", "count": 2, "from": "raid_n" }]
  },
  {
    "at_seconds": 120,
    "to": "outpost",
    "units": [
      { "unit": "militia_cell", "count": 3, "from": "raid_nw" },
      { "unit": "charge_squad", "count": 1, "from": "raid_n" }
    ]
  },
  {
    "at_seconds": 160,
    "to": "compound_centre",
    "units": [
      { "unit": "technical", "count": 2, "from": "raid_w" },
      { "unit": "rpg_team", "count": 2, "from": "raid_sw" }
    ]
  },
  {
    "at_seconds": 205,
    "to": "assault_se",
    "units": [
      { "unit": "moto_rpg", "count": 3, "from": "raid_se" },
      { "unit": "militia_cell", "count": 4, "from": "raid_s" }
    ]
  },
  {
    "at_seconds": 250,
    "to": "compound_centre",
    "units": [
      { "unit": "paramotor", "count": 2, "from": "raid_n" },
      { "unit": "militia_cell", "count": 4, "from": "raid_e" }
    ]
  }
]
```

**`triggers` — full replacement of the shipped two-entry array with four
(`villages_rise` kept, `south_rises` retired and split into two new ids):**

```json
[
  {
    "id": "villages_rise",
    "on": { "kind": "first_contact" },
    "do": { "kind": "commit", "group": "ring_ne", "to": "families_ne" }
  },
  {
    "id": "they_take_the_south_village",
    "on": { "kind": "first_contact" },
    "do": { "kind": "commit", "group": "ring_se", "to": "families_se" }
  },
  {
    "id": "they_come_for_the_west_families",
    "on": { "kind": "timer_s", "value": 150 },
    "do": { "kind": "commit", "group": "ring_nw", "to": "families_nw" }
  },
  {
    "id": "the_last_village_goes",
    "on": { "kind": "timer_s", "value": 190 },
    "do": { "kind": "commit", "group": "ring_sw", "to": "families_sw" }
  }
]
```

**`civilians` — add `"group": "families"` to all four shipped entries.** Not
explicitly asked for in the brief, but required so the engine-gated
`the_ring_closes` trigger below has a `group` that resolves at all — the
vocabulary rule "every group you address is declared on a placement" applies to
civilian placements exactly as it does to enemy ones (`civilians.groups[]` is
the same `$defs/placement`, and `spawnPlacement` registers `p.group` for side 2
same as any other side, per `mission.ts:1039`). Schema-legal today, inert until
G1 lands:

```json
{
  "refuge": "civ_refuge",
  "groups": [
    { "unit": "civilians", "count": 3, "at": [12.5, 18.5], "group": "families" },
    { "unit": "civilians", "count": 3, "at": [35.5, 18.5], "group": "families" },
    { "unit": "civilians", "count": 3, "at": [12.5, 27.5], "group": "families" },
    { "unit": "civilians", "count": 2, "at": [35.5, 27.5], "group": "families" }
  ]
}
```

**Map additions (`marj_perimeter.json`), in `map.schema.json`'s shapes
(markers: name → `[x,y]` int pair; zones: name → `[x,y,w,h]` int rect):**

```json
{
  "markers": {
    "outpost": [20, 14],
    "families_nw": [12, 18],
    "families_ne": [35, 18],
    "families_sw": [12, 27],
    "families_se": [35, 27]
  },
  "zones": {
    "outpost_ground": [19, 12, 4, 4]
  }
}
```

#### (b) Engine-gated — NOT valid against today's schema

```json
// they_take_the_section — NOT VALID. "remove" is not in triggers[].do.kind's
// enum (commit | withdraw_to | spawn | reinforce | dismount). Proposed shape
// per design §6.2 / §9 G1+G2.
{
  "id": "they_take_the_section",
  "on": { "kind": "timer_s", "value": 165 },
  "do": { "kind": "remove", "group": "outpost_section", "zone": "outpost_ground" }
}
```

```json
// the_ring_closes — NOT VALID, same missing do.kind. Proposed shape per
// design §6.1 / §9 G1. Depends on the civilians "group":"families" addition
// above, which IS valid today.
{
  "id": "the_ring_closes",
  "on": { "kind": "timer_s", "value": 272 },
  "do": { "kind": "remove", "group": "families" }
}
```

```json
// The starting_force entry the removal above needs to address — NOT VALID.
// starting_force items are additionalProperties:false {unit, count, from_ledger,
// at}; "group" is refused. Proposed shape per design §6.2 / §9 G2. Once this
// lands, this is the ONLY line in §1.7(a)'s starting_force array that changes.
{ "unit": "inf_squad", "count": 1, "at": [20, 14], "group": "outpost_section" }
```

---

## 2. `beit_sahwan_1_recon` — Beit Sahwan I — Recon (short — design §7 changes only)

Everything else in the shipped mission is untouched: player start, the other six
garrison placements, `hunt_the_scouts`, both existing objectives' completion
logic. Only an addition.

**Flags.** `bs_track_north` — a tag shared with IV (same string, two missions).
`intel.marked_positions` accumulates by tag (`mission.ts:1060`, `preMarked`), so
identifying this placement here means it spawns pre-identified and forfeits its
`ambush` stance the next time the same tag appears — which is IV (§5.4). This is
the mechanism GDD §4's "thorough recon" carry-over runs on, made concrete in one
placement, exactly as design §9 G9 says it should be (no `intel.marked_positions`
change needed or wanted).

**ECA row:**

| Event Name | IF | THEN | narrative cue | status |
|---|---|---|---|---|
| A track north of the road | `locate` target `bs_track_north` (new secondary) identified | objective `find_the_column` completes; the SAME tag, spawned again in IV, is pre-identified there and its `ambush` stance is forfeited | none authored; design §7 I gives the fictional frame ("where did the column that took them go") but no line — **hand to narrative-designer** | live |

Note on the shipped `picture` primary: it counts **distinct identified
entities**, not named tags (`mission.ts:1437-1441`, the `d.target`-less branch:
`complete = this.identified.size >= (d.count ?? 1)`). Adding a seventh
identifiable body changes nothing about when `picture` completes — confirmed by
reading the branch directly, matching design's own claim.

**Tile check.** `(26,16)` on `beit_sahwan_outskirts` is `.` — clear of every I and
IV placement (nearest neighbours are `bs_cell_north_block` at `(27,12)` and
`bs_ambush_market_lane` at `(27,24)`, both well clear).

**Copy-ready fragment — expressible today, append to the shipped arrays:**

```json
{
  "unit": "militia_cell",
  "count": 1,
  "at": [26.5, 16.5],
  "tag": "bs_track_north",
  "stance": { "kind": "ambush", "tiles": 3 }
}
```
```json
{
  "id": "find_the_column",
  "type": "locate",
  "primary": false,
  "target": "bs_track_north"
}
```
*`text` pending `narrative-designer`.* No map change — the tile is already on
`beit_sahwan_outskirts`.

**Twists (design §7 I, for completeness, not part of the required baseline):**
T2 "the picture is old" — **expressible today** (two tagged placements + a
`spawn`, unchanged from design's own call). T-B1 "they are counting you too" —
radio line only, no mechanism, **engine**-gated purely on G7.

---

## 3. `beit_sahwan_2_foothold` — Beit Sahwan II — Foothold (short — design §7 changes only)

**No JSON changes at all.** Design §7 II is explicit that this mission is
"unchanged mechanically" — the hostage spine reframes what the shipped
`collapse(tunnel_mouth_west)` secondary *means*, not what it *does*.

**Flags — citing the exact shipped placements, read from
`data/missions/beit_sahwan_2_foothold.json` directly this session:**

- `digger_crew×1` at `[30.5,21.5]`, `digs: "bs_tn_west"` — the crew cutting the
  route, unchanged.
- `rpg_team×2` at `[30.5,22.5]`, `in_tunnel: "bs_tn_west"` — the two teams that
  vent behind the player's line if the route is left open, unchanged.
- Secondary `collapse_tunnel = collapse(tunnel_mouth_west)`, no `seconds`
  (cannot fail — it's a secondary, not a deadline-bearing primary), unchanged.

**ECA row (reframing, not a new mechanism):**

| Event Name | IF | THEN | narrative cue | status |
|---|---|---|---|---|
| Bring the route down, or leave it open | player charges the identified `bs_tn_west` route (or does not) | `collapse` → the two buried `rpg_team`s die with it, attributed to the charge (`collapseTunnel`); **or** the route finishes and vents at `[7,22]`, behind the player's own line, and the two teams surface firing | narrative.md §4.4, unchanged: `radio` (**engine**) Idit — *"A vent has opened behind the line. The shaft was finished before we got here."* / *"They are up on the surface. They will fire once and go back down."* | live |

Under the hostage spine this same act gains a second reading (design §7 II):
it's the route the taken went down. No mechanism change follows from that —
it's narrative framing on an already-live objective, which is
`narrative-designer`'s to write into the briefing, not mine to re-author.

**Twists (design §7 II, not part of the required baseline):** T3 "the spoil was
a decoy" — **expressible today** (a second route, one `collapse` target,
unchanged from design's call). T-B2 "it is not a shaft, it is a door" — radio
line only, **engine**-gated on G7.

---

## 4. `beit_sahwan_3_clearance` — Beit Sahwan III — Clearance (short — design §7 changes only)

**No JSON changes.** Design §7 III states this plainly: "unchanged mechanically."
The clinic-block ROE passage stays verbatim (narrative-designer's territory);
Sahim is named in orders voice for the first time, with no new placement behind
the name.

**Flags — none new.** The mission's existing `roe.flagged_zones:["clinic"]`,
`fail_below:40`, and the twelve shipped garrison placements (including the
`casualties_pct(50)`-triggered `reserve_counterattack` group) are untouched.

**Twists (design §7 III, proposed, not authored into the baseline):**

| id | twist | classification | note |
|---|---|---|---|
| T4 | He is in the block — Sahim identified inside `clinic`, then leaves during the fight | **expressible today** | a tagged placement inside the flagged zone + a `casualties_pct` (or other) → `withdraw_to` trigger. Design flags this as the twist to build first, since it states the campaign's whole ROE argument in one event — I agree with that call but am not authoring it here, since design §7 III does not list it under "what changes," only under "twists" |
| T4b | …and he leaves | **expressible today** | the same trigger's `withdraw_to`, not a second mechanism |
| T-B3 | The reserve is not a reserve — the shipped `casualties_pct(50)` counter-attack group starts *inside* the clinic block instead of outside it | **expressible today** | changes one placement's `at`, nothing schema-new |

If the lead wants T4 built, it is a `mission-author` JSON edit (one new tagged
`militia_cell` placement inside `clinic`, one new trigger) with no schema or
engine work — flagging it here rather than authoring it, since design's own §7
table scopes III to zero required changes and I'm holding to that scope.

---

## 5. `beit_sahwan_4_subterranean` — Beit Sahwan IV — Subterranean — the rescue

`subterranean` · Captain → Major at act end · `beit_sahwan_outskirts` ·
requires `roster.surviving_units`, `intel.marked_positions` · produces the same
plus `intel.marked_positions` (+ `civ.settlements_evacuated`, design §2, not
touched further here). **Act I closes here.**

### 5.1 Flags

| flag | kind | fiction |
|---|---|---|
| `bring_it_down` | primary, `collapse(town, 300)` — unchanged, can fail | four routes under the district, all four must come down |
| `read_the_ground` | secondary, `locate(bs4_digger)` — unchanged | the crew reopening the western route |
| `get_them_out` (new objective id, mine to name) | **new primary**, `evacuate_before(collection_point, 5, 240)` | at least three of the four hostages, plus at least one of the two resident pairs, reach the collection point before the 240s clock runs out |
| `take_the_shaft_head` (new objective id, mine to name) | **new primary**, `capture(shaft_head, 10)` | Nadir Sahim's end — the ground he stands on, taken with him on it |
| `find_spade` (new objective id, mine to name) | **new secondary**, `locate(bs4_hvt_spade)` | the player identifies the man before taking his ground |
| `bs4_hvt_spade` (tag) | garrison, `hold_position` — deliberately **no** `withdraw_to` anywhere in this mission's triggers (there are none) | a digger does not leave his hole. This is T-B5 ("he waits"), already the baseline by omission, not a twist layered on top |
| `spade_guard` (unnamed placement, `group: spade_party`) | garrison, `ambush(3)` | the guard whose death is the price of reaching Sahim |
| `bs_track_north` (tag, same string as I) | garrison, `ambush(3)` — **pre-identified and ambush-forfeited if I's `find_the_column` completed** | the payoff of I's recon quality, read literally: a thorough I disarms one gun on the road to the shaft head |
| `hostages` (group, civilians) | civilians placement, `count:4` at `[24.5,14.5]` | the four still at the shaft head. Not tagged — `locate` cannot target a civilian side (`mission.ts:756`, `identified` only admits `side===0` observing `side===1`), which is exactly why the secondary targets the guard's tag instead |
| `civilians.refuge` | changed `civ_refuge` → `civ_collection` | **every** civilian on this map now flees toward the collection point, not the old refuge — this is global, not per-group (design §7 IV, confirmed against `civFlight.step`'s single `refuge` parameter) |

### 5.2 ECA rows — design §7 IV

Every row below is `live` — Option C's rescue in IV needs **zero** engine work
in its baseline form, which is worth stating as plainly as design does: the two
`engine`-gated verbs from §1 belong to First Light, not to IV.

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| Sahim holds the shaft head | mission start | `enemy.garrison` +1: `militia_cell×1` `[25.5,13.5]` `hold_position` `tag bs4_hvt_spade` `group spade_party` | none authored; narrative.md never named this placement (it predates design's Option C addition) — **hand to narrative-designer** | live |
| The guard | mission start | `enemy.garrison` +1: `rpg_team×1` `[27.5,15.5]` `ambush(3)` `group spade_party` | none authored — **hand to narrative-designer** | live |
| The same track, watched again | mission start | `enemy.garrison` +1: `militia_cell×1` `[26.5,16.5]` `ambush(3)` `tag bs_track_north` — **if `intel.marked_positions` carries the tag from I, spawns pre-identified, `ambush` forfeited** (`mission.ts:1060-1094`) | none authored — **hand to narrative-designer**; thematically this is where I's "where did the column go" pays off | live |
| The hostages | mission start | `civilians.groups` +1: `civilians×4` `[24.5,14.5]` `group:"hostages"`; `civilians.refuge` → `civ_collection` | none authored — **hand to narrative-designer**; this is T5 ("a soldier under the road") in its shipped representation — a `civilians` placement, not a true prisoner entity (design §6.2, §9 G6) | live |
| He does not run | any casualties among `spade_party` | nothing — no trigger references `spade_party`'s casualties, deliberately | none authored | live (absence is the mechanism — T-B5) |
| Read his position | `locate` target `bs4_hvt_spade` identified | `find_spade` completes | narrative.md's proposed line for the *capture* (see below) implies this step but doesn't state it separately — **hand to narrative-designer** | live |
| Get them out | civilians (any of the 8 on this map) reach `collection_point`, count ≥ 5, before 240s | `get_them_out` completes/fails | none authored — **hand to narrative-designer** | live |
| The shaft head is taken | a living player unit stands in `shaft_head` uncontested for 10s | `take_the_shaft_head` completes | narrative.md §6.5 (written for the not-yet-existing objective, proposed toast): `OBJECTIVE COMPLETE — Hold the shaft head until Sahim is out of it` | live |
| Every route down | `collapse(town)` target set (4 mouths, all inside `town`), `seconds:300` — unchanged | complete/failed | narrative.md §6.5, unchanged: `radio` (**engine**) per-route lines on `tunnelCollapsed` | live (unchanged, listed for ordering context) |
| The crew reopening the west route | `locate(bs4_digger)` — unchanged | complete | narrative.md §6.5, unchanged | live (unchanged, context) |
| Two scripted waves | `at_seconds: 150` / `240`, from `mortar_line` to `town_center` — unchanged | wave spawns | narrative.md §6.5, unchanged | live (unchanged, context) |

### 5.3 AI director — light treatment (no new waves; three new garrison placements only)

| t (s) | mechanism | size | from | to | group | stance |
|---|---|---|---|---|---|---|
| 0 | garrison (new) | 1 | `[25.5,13.5]` | — | `spade_party` | `hold_position`, tag `bs4_hvt_spade` |
| 0 | garrison (new) | 1 | `[27.5,15.5]` | — | `spade_party` | `ambush(3)` |
| 0 | garrison (new) | 1 | `[26.5,16.5]` | — | — | `ambush(3)`, tag `bs_track_north` (may spawn pre-identified) |
| 0 | civilians (new) | 4 | `[24.5,14.5]` | — | `hostages` | shelter-in-place (civilian flight rule, not a stance) |
| 150 | wave (unchanged) | 2 | `mortar_line` | `town_center` | — | (none) |
| 240 | wave (unchanged) | 2 | `mortar_line` | `town_center` | — | (none) |

**Pressure/interaction note, not a full cadence table since design §7 IV adds no
new waves.** The shipped scripted plan (`tools/src/backtest/playtest.ts`,
`beit_sahwan_4_subterranean`) sends its escort to `[30,17]` at t=50 to help the
east Yahalom team fight `bs_tn_north`'s two buried `rpg_team`s and its garrisoned
`militia_cell` — and `[30,17]` sits four tiles from `spade_guard` at `[27.5,15.5]`
and inside weapon range of `bs_track_north` at `[26.5,16.5]`, both new. The plan
was proven against the shipped ten-placement garrison; it has not been re-run
against these three additions plus four hostages standing two tiles from the
guard. This is exactly the kind of difficulty delta CLAUDE.md and the agent brief
both say must be measured, not estimated — flagging it as a required `playtest`
re-run rather than asserting the plan still holds.

### 5.4 Map requirements — `beit_sahwan_outskirts`

All three checked directly against `data/maps/beit_sahwan_outskirts.json`'s
`rows` this session.

| kind | id | tile(s) | purpose | exists today |
|---|---|---|---|---|
| zone | `shaft_head` | `[25,12,3,3]` — 9 tiles: `.` ×7, cover `2` at `(27,12)` and `(27,13)` | `take_the_shaft_head`'s target; contains `bs_tn_north`'s mouth `[27,13]` | **missing — new, additive** |
| zone | `collection_point` | `[28,32,4,3]` — 12 tiles, all `.` | `get_them_out`'s target, 3 tiles from `player_start [26,34]` | **missing — new** |
| marker | `civ_collection` | `[29,33]` — `.` | the new `civilians.refuge`; **must sit inside `collection_point`** or the runtime throws (`mission.ts` `start()`, the `evacuate_before` setup check) — confirmed: `(29,33)` is inside `[28,32,4,3]` | **missing — new** |

### 5.5 Twists — design §7 IV

| id | twist | classification | note |
|---|---|---|---|
| T5 | A soldier under the road — the man taken at First Light is one of the four hostages | **expressible today — already the baseline** in its shipped representation (a `civilians` placement, not a true prisoner). The stronger version — a friendly-tagged HVT the enemy can hold — is **engine** (design §9 G6, a `side`/`captive` field on a placement) |
| T-B4 | The route they went down is the one you have to bring down — hostages held *inside* `bs_tn_north`, freed by venting, killed by collapsing | **engine** | needs G3: `stepSurfacing` requires `type.weapons.length > 0` (`sim.ts:~2517`) and `civilians` has none, so a buried civilian can never come up today. Two-part fix design proposes: refuse the authoring of the trap now (`validate_data.mjs`), let a weaponless side-2 body surface later. This is, per design, "the version of this mission the design actually wants" — I'm not authoring it into the baseline because it is explicitly engine-gated and the brief's recommended shipping order (design §6.3) is to ship without it first |
| T-B5 | He waits — Sahim does not flee when his guard dies | **expressible today — already the baseline**, by omission: no `casualties_pct`/`spade_party` trigger exists anywhere in §5.2's fragments, and none should be added for this to hold |

### 5.6 Gap report — IV only

Ranked by what touches a row above; **none of them block the baseline** — this
is IV's most load-bearing property (§5.2's header note) and worth restating
here rather than only once.

1. **G5 — `evacuate_before` cannot name a group.** `civFlight.evacuatedCount`
   (`civilians.ts:44-46`) is global across every civilian on the map, so
   `get_them_out`'s `count:5` cannot require "at least N *hostages*" specifically
   — it's satisfied by any 5 of the 8 civilians on this map reaching
   `collection_point`, hostages and residents alike. Design's own arithmetic
   (§7 IV): 4 hostages + 4 residents = 8; the two residents beside player start
   walk out for free the moment a soldier is within 4 tiles
   (`SHEPHERD_RADIUS_SQ`, `civilians.ts:27`), so `count:5` forces at least one
   hostage out and, per design, in practice three. This is a **works-but-imprecise**
   gap, not a blocking one — `get_them_out` is fully authorable and playable as
   written in §5.7. Smallest proposal: optional `group` on the objective,
   `collect` filters `civIds` by group membership (`spawnPlacement` already
   records it). Owner: `sim-guard`.
2. **G4 — `capture` cannot require its target alive.** `take_the_shaft_head`
   completes identically whether Sahim is standing there or already dead when
   the ground is taken — the objective can't distinguish "captured" from "the
   ground happened to be clear." Optional `requires_alive:"<tag>"` on a
   `capture` objective, failing (not merely staying incomplete) if every tagged
   unit is dead. Owner: `sim-guard`. Not blocking — `capture(shaft_head,10)`
   alone is, per design, "live today... zero engine work," and I've authored it
   exactly that way.
3. **G3 — buried civilians can't surface.** Only relevant to T-B4, which is not
   in the baseline (§5.5). Owner: `sim-guard` + `content-validator`.
4. **G6 — no friendly-tagged HVT.** Only relevant to the stronger form of T5,
   not the shipped baseline. Owner: `sim-guard`.

### 5.7 Copy-ready fragments

Unit ids `militia_cell`, `rpg_team`, `civilians` all resolve (same directories
cited in §1.7). Field names: `civilians.refuge` (string, marker id — schema
`civilians` object); `civilians.groups[]` and `enemy.garrison[]` both
`$defs/placement`; objectives as in §1.7.

**Note on scope vs. the brief's exact wording:** the task names "enemy.garrisons
additions (`bs4_hvt_spade`, `spade_guard`)" — design §7 IV's own "+3" list
includes a third, `bs_track_north`, which is the *entire mechanism* I's new
secondary exists to demonstrate (§2). I've included it below; omitting it would
leave I's carry-over with nothing in IV to attach to.

#### (a) Expressible today

**`civilians` — full replacement (refuge changed, one group added):**

```json
{
  "refuge": "civ_collection",
  "groups": [
    { "unit": "civilians", "count": 2, "at": [28.5, 14.5] },
    { "unit": "civilians", "count": 2, "at": [24.5, 33.5] },
    { "unit": "civilians", "count": 4, "at": [24.5, 14.5], "group": "hostages" }
  ]
}
```

**`enemy.garrison` — three new entries, appended to the shipped ten:**

```json
[
  {
    "unit": "militia_cell",
    "count": 1,
    "at": [25.5, 13.5],
    "group": "spade_party",
    "tag": "bs4_hvt_spade",
    "stance": { "kind": "hold_position" }
  },
  {
    "unit": "rpg_team",
    "count": 1,
    "at": [27.5, 15.5],
    "group": "spade_party",
    "stance": { "kind": "ambush", "tiles": 3 }
  },
  {
    "unit": "militia_cell",
    "count": 1,
    "at": [26.5, 16.5],
    "tag": "bs_track_north",
    "stance": { "kind": "ambush", "tiles": 3 }
  }
]
```

**`objectives` — three new entries, appended to the shipped two:**

```json
[
  {
    "id": "get_them_out",
    "type": "evacuate_before",
    "primary": true,
    "target": "collection_point",
    "count": 5,
    "seconds": 240
  },
  {
    "id": "take_the_shaft_head",
    "type": "capture",
    "primary": true,
    "target": "shaft_head",
    "seconds": 10,
    "text": "Hold the shaft head until Sahim is out of it"
  },
  {
    "id": "find_spade",
    "type": "locate",
    "primary": false,
    "target": "bs4_hvt_spade"
  }
]
```
*`get_them_out` and `find_spade` `text` fields pending `narrative-designer`;
`take_the_shaft_head`'s is narrative.md's own proposed toast (§6.5), quoted
directly.*

**Map additions (`beit_sahwan_outskirts.json`):**

```json
{
  "markers": {
    "civ_collection": [29, 33]
  },
  "zones": {
    "shaft_head": [25, 12, 3, 3],
    "collection_point": [28, 32, 4, 3]
  }
}
```

#### (b) Engine-gated

None specific to IV's baseline — see §1.7(b) for the two `remove`-trigger shapes
and the `starting_force.group` proposal, both First Light's. IV's only
engine-gated content is T-B4 (§5.5), which is not part of this fragment set.

---

## 6. Verification

**Schema fields, grepped, one citation each (not repeated per fragment):**
`objectives[].{id,type,primary,text,target,count,seconds}` —
`mission.schema.json` objectives block; `type` enum confirmed to include
`locate, collapse, hold_for, evacuate_before, eliminate_hvt, capture,
survive_until, destroy_all, raze` (12 listed in schema, 9 live per
`mission.ts:265-268`'s `SUPPORTED` set — `mark`, `escort`,
`no_collateral_above` excluded, none used here). `starting_force[].{unit,count,
from_ledger,at}`, `additionalProperties:false` — confirmed `group` absent.
`enemy.garrison[]`/`civilians.groups[]` → `$defs/placement`
`{unit,count,at,marker,facing_deg,group,tag,in_tunnel,digs,passengers,stance}`.
`enemy.waves[].{at_seconds,trigger,to,units[].{unit,count,from,group,tag}}` —
confirmed wave units have **no** `stance` field, unlike garrison placements.
`triggers[].{id,on{kind,value,zone},do{kind,group,to,units}}` — `on.kind` enum
`first_contact|casualties_pct|timer_s|zone_entered`; `do.kind` enum
`commit|withdraw_to|spawn|reinforce|dismount` — confirmed `remove` is not a
member, which is the whole of §9 G1.

**Unit ids** — `inf_squad, at_team, sniper_team, mortar_team, demo_squad,
apc_eitan, jeep_shoded, recon_drone, yahalom_squad, ifv_namer` under
`data/units/kdf/`; `paramotor, mortar_crew, militia_cell, rpg_team, technical,
moto_rpg, charge_squad, digger_crew, atgm_cell, gun_truck` under
`data/units/enemy/`; `civilians` at `data/units/civilians.json`. All confirmed
present by directory listing this session; none invented.

**Marker/zone discipline** — every `to`/`from` above names a marker
(`compound_centre, assault_sw, assault_se, outpost, raid_*, families_*,
town_center, mortar_line`); every `hold_for`/`capture`/`evacuate_before`
`target` names a zone (`outpost_ground, compound, collection_point,
shaft_head, town`). No trigger's `on.kind` is asked to fire twice — each of the
six First Light triggers has a distinct condition (two `first_contact`s are
independent trigger objects, each firing once off the same shared latch, which
is legal: `firedTriggers[i]` is tracked per trigger index, not per condition
kind). No wave uses a tunnel id in `from` — every `from` above is a map marker.

**Tile checks, computed from the actual grid (`python3` tile lookups against
`rows`, not read by eye):** `outpost_ground` `[19,12,4,4]` → 15× `.`, one `o` at
`(21,13)`. `families_nw/ne/sw/se` at `(12,18) (35,18) (12,27) (35,27)` → all `.`,
each matching the floor of its shipped civilian group's fractional `at`.
`shaft_head` `[25,12,3,3]` → `.` ×7, cover `2` at `(27,12)` and `(27,13)`, and
contains `bs_tn_north`'s mouth `(27,13)`. `collection_point` `[28,32,4,3]` → 12×
`.`. `civ_collection` marker `(29,33)` → `.`, inside `collection_point`.
`bs_track_north`'s tile `(26,16)` → `.`, clear of every I and IV placement.

**One arithmetic correction to design's own prose, surfaced rather than
silently applied:** design §7 IV describes the `hostages` placement's four
bodies landing on `(24,14) (25,14) (26,14) (24,15)`. Recomputing `spawnPlacement`'s
actual spread (`SPREAD = 81920` = 1.25 tiles, `mission.ts`) from base
`[24.5,14.5]` gives `(24,14) (25,14) (27,14) (24,15)` — the third body lands on
`(27,14)`, not `(26,14)`, because 2×1.25 = 2.5 tiles from 24.5 is exactly 27.0,
which floors to tile 27. Checked against the grid: `(27,14)` is `.`, clear of
every other placement (nearest neighbours are `bs4_hvt_spade` at `(25,13)` and
`spade_guard` at `(27,15)`), so the correction changes no outcome — the fragment
in §5.7(a) is unaffected — but the design doc's own worked tile list should be
corrected before anyone reads it as ground truth.

**Passive-control and scripted-plan consequences** — stated in full in §1.3;
summary: the passive control's sole loss condition (`evac_settlements` at 270s)
is untouched by every fragment here, so it should keep losing the same way; the
scripted plan's 5.0-minute, 14-survivor win is put at risk by three named
factors (the new mortar crew, the enlarged t=18 wave, the exposed forward
section) that design's own tuning order addresses, and by the newly-discovered
retirement of the shipped t=55/t=95 waves, which is not itself a risk (it
reduces mid-mission body count relative to a naive reading of "+11.6% on top of
everything") but must be `playtest`-verified rather than assumed either way.

**Row counts by status**, counted from §§1.2, 2, 5.2 (the ECA tables; §1.3/§5.3
AI-director rows are cadence, not ECA, and not counted twice):

| section | live | schema | engine | total |
|---|---|---|---|---|
| First Light (§1.2) | 16 | 0 | 2 | 18 |
| I (§2) | 1 | 0 | 0 | 1 |
| II (§3) | 1 | 0 | 0 | 1 |
| IV (§5.2) | 11 | 0 | 0 | 11 |
| **total** | **29** | **0** | **2** | **31** |

Zero `schema`-status rows: every mechanism used across both full missions is
either already in the schema (`live`) or needs runtime work in `stepTriggers`
(`engine`) — nothing here needs a bare new JSON field with no behaviour behind
it. The 2 `engine` rows are both First Light's, both `do.kind:"remove"`, both
written in the proposed shape and clearly fenced in §1.7(b) rather than faked as
live JSON.
