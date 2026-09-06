# Mission Design Document — Act I · The Marj Strip · **Beit Sahwan**

**Date:** 2026-09-03 · **Status:** proposal. Nothing here is canon until the lead
signs §10.
**Written against** `feat/story-act-1` at `ff0808e`, censused this session; every
content claim cites a path or a measurement taken today.
**Read first:** `docs/campaign/README.md` (the contract), `docs/campaign/storyline.md`
(the war), `docs/campaign/research-2026-09-03.md` (the digest).
**Downstream:** `narrative-designer` (§5.6, §7 story hooks), `level-scripter`
(§5, §6, §7, §9), `mission-author` (all of it), `playtest` (§5.5, §11).

---

## 0. Decisions of record

| # | decision | source | consequence here |
|---|---|---|---|
| **D12** | The lead's structural reference for how the war opens is the surprise attack on Israel of 7 October 2023, transposed **entirely** into the fiction — no real name, place, date, flag, faith or people anywhere in the design. | lead, 2026-09-03 (`storyline.md` §0.2) | *This is the only sentence in this document that names anything real.* Everything below is Kedem, the KDF 401st "Ari'im", the Marj Strip and the Ashwar Front. |
| D4 | One villain per front, atrocity at the opening, captured or killed at the end | lead | **Nadir Sahim**, Idit's file **SPADE**, the digger. Atrocity: First Light. End: Beit Sahwan IV |
| D1/D2 | Shai Hammai, Idit Zohar; two voices of the HUD | lead | Shai is a **Captain** for the whole of Act I. No promotion inside the town |
| D9 | Static continuity, authored text only | 2026-08-21 spec | **No line in Act I may branch on the ledger.** The taking is stated, never conditionally narrated |
| O8 | Start from the beginning, in campaign order | lead | Act I is the first town through the pipeline |

**The register.** The atrocity is shown through mechanics and stated in the story
voice. Never depicted. Consequence, not sermon — the GDD's own rule. The strongest
line in the shipped tree is `beit_sahwan_breach`'s *"nobody is coming back for them
afterwards"*, and that is the ceiling this design writes to, not a floor to exceed.

---

## 1. Premise and plot options

### The premise

A perimeter compound on the Beit Sahwan road, held by a company of the 401st. At
dawn the Ashwar Front comes over and through the wire at every approach at once,
under mortar fire, with a spotter already aloft. The villages outside the wire are
hit in the same minute as the compound. A forward section is overrun. Relief takes
five minutes to arrive and the ring closes thirty seconds before it does.

Two families come inside. Nine people do not, and they are not left — **they are
taken, back across the line, together with whoever was still alive at the forward
post.** Act I is the war that opens as the search for them.

Three plots follow. They differ in **where the chain of events lives** and in
**what the player decides**, not in names.

---

### Option A — *"The whole chain inside First Light"*

The entire sequence is an authored in-mission timeline inside the shipped
`beit_sahwan_breach`, in its existing 300-second budget. No new mission, no change
to Act I's shape.

- **Phase ladder:** unchanged — breach, recon, foothold, clearance, subterranean.
- **What the player decides:** the shipped decision (who leaves the wire for the
  families, and when) plus three new ones the timeline creates — the spotter aloft
  versus the assault for the sniper's attention, counter-battery versus the wire for
  the mortar, and whether to pull the forward section in at t=0.
- **How the villain ends:** unchanged — `capture` at the shaft head in IV.
- **Cost:** the abductions land in the last thirty seconds of a five-minute mission
  and have no consequence anywhere else. SPADE is introduced by an atrocity and then
  absent from the game until III's briefing. The act's question stays *"can you
  hold?"* and never gains a second half.
- **Buys:** the lowest risk of anything here. Every element is expressible today
  except the two removal verbs, and it degrades cleanly without them (§6.3).

### Option B — *"First Light, then the villages"*

Option A plus **one new breach-phase mission**, `beit_sahwan_villages` — *"Beit
Sahwan — The Villages"*, 6 minutes, on `marj_perimeter`. The relief column has
arrived, the compound holds, and the four village blocks outside the wire are
retaken house by house. The people who were taken are already gone; what the player
finds is the ground they were taken off.

- **Phase ladder:** breach, **breach**, recon, foothold, clearance, subterranean.
  Two consecutive breach missions. Legal — the ladder must ascend and equal is not
  descending — and there is precedent: Wadi Halam runs two clearances
  (`wadi_halam_4_village`, `_5_depot`).
- **What the player decides:** pursue the rearguard toward the line (fast, produces
  `intel.marked_positions` on the route, costs men) or clear the four blocks
  methodically (slow, finds the survivors in the rubble, produces
  `civ.settlements_evacuated`). Primaries: `capture(village_west, 15)`,
  `capture(village_east, 15)`; secondaries `locate(bs_v_rearguard)`,
  `evacuate_before(compound, 2, 300)`.
- **Cost, stated plainly:** Beit Sahwan goes to **six campaign missions**, one over
  the GDD §6 / README guideline of three to five per town, and becomes the largest
  town in the game — while still not gaining the phase it is actually missing
  (`buildup`). The storyline's own reading of Act I — *"phases 1, 2, 3, 5, 6 — no
  build-up, because the brigade got no breathing room in the Marj"* — survives, but
  the act gets longer without getting fuller. New content: 1 mission JSON, 2 new
  zones + 2 markers on `marj_perimeter`, 1 `world.json` entry, 1 `playtest` plan.
- **Buys:** the only option in which the player *is* the relief that came late, and
  the only one that plays the villages rather than referring to them.

### Option C — *"The hostage spine"* — **RECOMMENDED**

Option A's timeline **plus** the abductions as the spine of the four shipped
missions. No new mission. I–IV are re-purposed, not re-authored: three of them keep
every objective they ship with.

| mission | what the hostage spine changes |
|---|---|
| **I Recon** | the question becomes *where did the column that took them go*. Objectives unchanged (`locate ×6` primary, `locate(bs_hvt_atgm)` secondary); **+1 tagged ambush placement** on the northern track (`bs_track_north`) that pays off in IV, **+1 secondary** naming it |
| **II Foothold** | the western route the digger is cutting is the route they went down. `hold_west` unchanged. `collapse(tunnel_mouth_west)` stays a secondary and becomes a **real decision**: bring it down and you have sealed the way they went; leave it and the two `rpg_team` already authored `in_tunnel: bs_tn_west` vent behind your line. Both halves ship today |
| **III Clearance** | unchanged mechanically. SPADE fights from inside the clinic block because that is where the human terrain is, and the block is where he keeps what he took. The strongest ROE writing in the tree stays verbatim |
| **IV Subterranean** | **the rescue.** `collapse(town, 300)` stays the primary. **+`evacuate_before(collection_point, 5, 240)`** primary, **+`capture(shaft_head, 10)`** primary — SPADE's end. A `civilians` group of four at the shaft head, SPADE tagged beside them, and a guard force whose death is worth an autocannon burst the hostages are standing two tiles inside |

- **Phase ladder:** unchanged. Five campaign missions, inside the guideline.
- **What the player decides, act-wide:** whether a rushed recon in I is worth the
  ambush it leaves live on the road to the shaft head in IV; whether to seal the
  route in II; and in IV, the order — get them out, then bring the roof down, with a
  240-second evacuation deadline inside a 300-second collapse deadline.
- **How the villain ends:** `capture` of a 3×3 zone at the shaft head. Live today
  (10 s uninterrupted, contest resets), zero engine work, and it gives the prisoner
  theme its first beat without GH-18 (`storyline.md` §7 G8).
- **Cost:** 2 new zones and 1 new marker on `beit_sahwan_outskirts` (**additive** —
  the character grid is shared by four missions and is not touched, and a zone
  nothing names is inert), 1 civilians group, 1 tagged placement, 2 objectives in
  IV, 1 tagged placement in each of I and IV, 1 changed `civilians.refuge` in IV.
  Two engine verbs for the taking itself (§6), with a stated fallback.

### Recommendation

**Option C, whose first mission is Option A.** They are not alternatives: A is C's
opening. B is held as a clean later addition — it slots between First Light and
Recon, produces the same ledger keys, and disturbs nothing in C.

Why C:

1. **It is the only option in which the atrocity has a mechanical consequence in
   every mission of the act.** A introduces SPADE and then loses him for two
   missions; C makes I's recon quality, II's collapse decision and IV's evacuation
   all descend from one morning.
2. **It closes the act on its own premise.** GDD §4 says a breach mission is
   *"survive, get the families inside the wire, and still hold the ground."* C makes
   the last mission of the town the second half of that sentence.
3. **It needs no new mission and no new art.** The whole of it is markers, zones,
   placements and objective rows, plus two schema verbs whose absence degrades to
   text rather than to a broken mission.
4. **It gives `capture` a reason to be the villain's end.** Taking the ground he is
   standing on, with the people he took standing behind him, is a better ending than
   killing him — and it is the live objective type.

### Killing my own favourite

**If the lead rejects C, Act I survives.** Option A alone is a complete opening: the
chain plays, the villages are lost on the clock, and the taking reaches the player
through `dispatch` and `aftermath` (two unbuilt strings, `storyline.md` §7 G3) and
through the objective the HUD already announces as failed. I–IV then ship exactly as
they are, SPADE gains his `capture` in IV as the storyline already proposes, and the
act's question stays *"can you hold?"* — which is the question GDD §4 assigns the
breach phase, so nothing is broken. What is lost is the second half of the act's
sentence, and one mission's worth of meaning in IV. That is a real loss and not a
fatal one.

---

## 2. Place in the global storyline

| | |
|---|---|
| **Act** | I of III. The Marj Strip · Ashwar Front · Beit Sahwan. *Proximity*, the first of GDD §2's three (`storyline.md` §1) |
| **Shai's rank on entry** | **Captain**, 2 stars. He is the senior officer left inside the compound, which is how he comes to command it |
| **Shai's rank on exit** | **Captain.** Promoted to Major at the **act boundary**, after `beit_sahwan_4_subterranean`, never inside the town (`storyline.md` §2.1) |
| **Idit's intel thread** | I: her first picture — six positions and the ATGM. II: she reads spoil, disturbed earth as intelligence. III: `requires intel.marked_positions`, so a thin recon means ambushes under fire. IV: which crew is reopening the western route, and **where the shaft head is**. Under Option C the whole thread is one question asked four times: *where did they go, and who is still down there* |
| **The villain's atrocity** | First Light itself, played rather than told: eleven civilians in four groups, a primary that counts **two** in, and a ring that closes at 270 s |
| **The villain's end** | Beit Sahwan IV. `capture(shaft_head, 10)` — the ground he is standing on, taken with him on it. `locate(bs4_hvt_spade)` is how the player finds him; `eliminate_hvt` is deliberately **not** used (§9 G4) |
| **Ledger in** | Nothing. First Light `requires: []` — it is the first mission of the war |
| **Ledger out of the act** | `roster.surviving_units`, `roe.mission_ratings`, `campaign.completed_missions`, `intel.marked_positions` (produced by I and IV), and — new here — `civ.settlements_evacuated` from First Light and IV |
| **What Act II inherits** | a roster, an ROE rating that has already gated up to nine KDF unlocks, and `intel.marked_positions` accumulated across I and IV. `world.json` C1/C2 (`storyline.md` §3.4) should make Sur unlock on `beit_sahwan_4_subterranean` rather than on `_3_clearance`, so SPADE's end is the act's end |

**`civ.settlements_evacuated` is a live ledger key produced by exactly one shipped
mission** (`wadi_halam_4_village`) **and read by nothing.** Adding it to First
Light's and IV's `produces` costs nothing, cannot change any measurement, and is
required the day the lead retires D9. Until then **no line may branch on it** —
that is the constraint, not the key.

---

## 3. Map overview

Act I uses **two shipped maps and needs no new one.** Both are 48×48, both flat (no
`elevation` grid), both `arid` by inference — neither declares a `biome` key.

### 3.1 `marj_perimeter` — First Light

`data/maps/marj_perimeter.json` · 48×48 · no elevation · symbols counted from the
rows: `.` 2080, `h` 32, `s` 32, `=` 52, `r` 39, `o` 14, `n` 12, `#` 13, `2` 12,
`1` 10, `m` 4.

**Topology.** A walled compound in the middle of open ground with four village
blocks on the diagonals and a road running east–west straight through it.

- **The compound** — `wall` (`=`) from x17 to x31, y16 to y30. Zone `compound`
  `[18,17,13,13]`. **Two gates, both on the road**: west at x17, y21–22; east at
  x31, y24–25. **Two blind faces** — the north wall (row 16) and the south wall
  (row 30) have no opening at all, which is the briefing's *"two blind faces they
  will cut straight through rather than walk round."*
- **The wall is not a sight-blocker.** `wall` is `low_profile: true` and `per_tile:
  true` with `standing_cover: 2` and `roe_penalty: 0` (`data/structures.json`). So
  the defenders shoot over it and take cover behind it, an attacker can see them,
  and knocking a hole in your own wall costs nothing on the ROE score. This is
  load-bearing for the whole fight and is easy to get wrong by eye.
- **Chokepoints:** the two gates. **Dead ground:** none — the map is flat and open,
  which is the point of a breach mission. The only cover on the approach is the
  grove (`o`) and knoll (`n`) scatter at radius 8–16 from the centre.
- **Protected structure:** zone `clinic` `[37,2,3,3]`, the `concrete` block at rows
  2–4, x37–39 (`roe_penalty` 3). It sits **behind the north-east village**, twenty
  tiles from the compound, so it only bites a player who pushes out that far —
  today, with `mortar_60` at range 18. There are also **4 `mosque` tiles** at
  (23–24, 8–9), `roe_penalty` 30, unflagged and directly under the northern
  approach.
- **Markers, all shipped:** `compound_centre [24,23]`, `civ_refuge [24,26]`,
  `assault_nw [20,15]`, `assault_ne [28,15]`, `assault_sw [20,31]`,
  `assault_se [28,31]`, and **eight** raid markers on the map edges — `raid_n
  [24,2]`, `raid_ne [42,3]`, `raid_e [43,26]`, `raid_se [42,43]`, `raid_s [24,43]`,
  `raid_sw [4,43]`, `raid_w [2,26]`, `raid_nw [4,3]`.
- **The eight `raid_*` markers are the fence breached at many points at once.** They
  exist; nothing has ever used more than two in one wave.

**New map data for First Light — additive only, no grid change:**

| kind | id | value | why |
|---|---|---|---|
| marker | `outpost` | `[20,14]` | the forward post's ground, north of the blind face. Tile is `.` |
| zone | `outpost_ground` | `[19,12,4,4]` | x19–22, y12–15. Every tile passable (`.` and one `o` at (21,13)). Deliberately excludes the wall row 16 |
| marker | `families_nw` | `[12,18]` | the shipped civilian group's own tile |
| marker | `families_ne` | `[35,18]` | " |
| marker | `families_sw` | `[12,27]` | " |
| marker | `families_se` | `[35,27]` | " |
| marker *(optional)* | `village_nw/ne/sw/se` | `[8,8] [39,8] [8,39] [39,39]` | withdraw destinations, if `level-scripter` wants the ring to leave with what it took |

**2026-09-06 — the perimeter made visible (`mission-author`).** The lead's ask:
"the perimeter that needs to be held in all the fortress missions should be
surrounded by fences and guards so it's more visible." This is the fence half,
on First Light, as the pattern the other eight hold/survive missions follow;
guards are a separate balance change and are not added here. The fence is
raised through `beit_sahwan_breach.json`'s own `structures[]` — **not** the
base map's rows, which the doctrine tests above and the visual gate both pin —
as thirty-three `fence` bodies (60 hp/tile, `per_tile`, `roe_penalty: 0`,
`low_profile`, so it never blocks sight, only movement): a run hugging the
wall's west face at x=16 (y17–20, y24–29; gap y21–23, the wall's own gate at
y21–22 plus the road tile at y23), a mirror at x=32 on the east face (y17–22,
y26–29; gap y23–25, road at y23–24 plus the gate at y24–25), and a run two
tiles south of the wall at y=32 (x15–18, x22–26, x30–33; gaps at x19–21 and
x27–29, centred on `assault_sw`/`assault_se`). **The north face is
deliberately left unfenced** — the outpost already stands on that ground, and
fencing it would contradict the briefing's own "outside the wire."

Measured, not assumed (`tools/src/first_light_fence.test.ts`): every
civilian's foot route to `civ_refuge` is **byte-identical** before and after
(nw 12, ne 14, sw 13, se 11 tiles); every one of the mission's own wave routes
from a `raid_*` marker to its `to` target still exists, with at most a
1-tile detour; `walk_placements.ts beit_sahwan_breach` reads "all placements
clear"; and the two `playtest` verdicts hold — passive control still DEFEATs
at 4.5 min (ROE 97, `evac_settlements=failed`, byte-identical to the fenceless
baseline), and the scripted plan still VICTORYs in the same 5.0 min, with ROE
moving 75→100 and roster-out moving 14→12. Both of those last two numbers move
because the fence bends the enemy's own approach lanes by a tile or two, not
because the plan's orders changed (none did): the raiders arrive by a
marginally different line, so the exchange that follows lands two fewer
friendly hits and two more stray rounds land clear of the flagged zones than
before.

**A wider first draft is worth recording as a trap for the other eight
missions, not just a footnote.** The first attempt stood the fence two tiles
out (x=14/x=33) rather than hugging the wall at one. Every route still
existed and every detour was still small (1–3 tiles) — but the passive
control stopped DEFEATing: with the fence at that stand-off (west or east
alone, independently — the south run never did this), the civilians in
`families_nw`/`families_ne` crossed `CIV_FLEE_AT` (suppression 0.3) within the
first 30–70 seconds of a run with **zero player orders** and walked
themselves to `civ_refuge`, satisfying `evacuate_before`'s count of 2 for
free. `evac_settlements` is First Light's *only* passive-loss condition
(§5.1); a fence that lets it complete unattended is a fence too many, exactly
as this file's brief warned. Hugging the wall at one tile out removes it
entirely — the civilian routes go back to byte-identical rather than moving
1–3 tiles each, which is the more reliable tell than the passive verdict
itself. The lesson for I–V of the other hold missions: stand a perimeter
fence on the wall it echoes, not a symbolic distance out from it, and re-run
the mission's own passive control (not just a route-exists check) before
trusting the layout — a fence with every route intact can still hand a
passive player an objective the mission was built to deny.

### 3.2 `beit_sahwan_outskirts` — I, II, III, IV

`data/maps/beit_sahwan_outskirts.json` · 48×48 · no elevation.

- **Markers, shipped:** `kdf_assembly [4,23]`, `town_center [31,22]`,
  `mortar_line [44,24]`, `civ_refuge [22,45]`.
- **Zones, shipped:** `town [19,9,22,31]`, `west_approach [0,8,17,32]`,
  `clinic [29,23,6,6]`, `tunnel_mouth_west [29,21,3,3]`.
- **Tunnels, shipped — four:** `bs_tn_west` mouth `[30,22]`, vent `[7,22]`,
  `dig_tiles_per_s 0.16`, **not** pre-dug; `bs_tn_north` mouth `[27,13]`, vent
  `[32,17]`, pre-dug; `bs_tn_souk` mouth `[22,29]`, vent `[26,24]`, pre-dug;
  `bs_tn_clinic` mouth `[35,26]`, vent `[31,21]`, pre-dug. **All four mouths are
  inside the `town` zone**, which is why `collapse(town)` in IV means all four.
- **Chokepoints:** the road at rows 21–22 (x19–40) is the town's spine; the twin
  road at x26–27 runs south from it. The mosque block at (20–22, 18–20) and the
  warehouse block at (30–33, 24–27) narrow the centre.
- **Protected structures:** zone `clinic [29,23,6,6]` (flagged in III and IV,
  `fail_below 40`) and **9 `mosque` tiles** at (20–22, 18–20), `roe_penalty` 30,
  never flagged by any mission and never needing to be — the structure's own penalty
  does the work.

**New map data for Option C — additive only, no grid change:**

| kind | id | value | why |
|---|---|---|---|
| zone | `shaft_head` | `[25,12,3,3]` | x25–27, y12–14, containing `bs_tn_north`'s mouth `[27,13]`. All nine tiles passable (`.` and cover `2`). SPADE's `capture` target |
| zone | `collection_point` | `[28,32,4,3]` | x28–31, y32–34, three tiles from IV's `player_start [26,34]`. All twelve tiles `.` |
| marker | `civ_collection` | `[29,33]` | inside `collection_point` — **the runtime throws if the refuge marker is outside its evacuation zone** (`mission.ts`, `evacuate_before` setup) |

**Zero-map-edit fallback**, if the lead will not take a map change at all:
`evacuate_before(target: "west_approach")` with `civilians.refuge: "kdf_assembly"`
— `[4,23]` is inside `[0,8,17,32]`, verified. It works, and it makes the hostages
walk twenty-three tiles off the mission's axis. Recommended against.

### 3.3 Reuse

Nothing new. `marj_perimeter` and `beit_sahwan_outskirts` both PRESENT;
`tutorial_ground` PRESENT and untouched.

---

## 4. Mission ladder

Phases ascend across the five campaign missions: breach(1) → recon(2) → foothold(3)
→ clearance(5) → subterranean(6). `beit_sahwan_0_tutorial` is phase `recon` but is
**not in the campaign chain** — `data/campaign/world.json` omits it and it produces
no ledger keys — so it does not break the ordering.

Ledger keys: **R** `roster.surviving_units` · **M** `roe.mission_ratings` ·
**C** `campaign.completed_missions` · **I** `intel.marked_positions` ·
**E** `civ.settlements_evacuated`. **Bold** = new in this design.

| # | id · name | phase | min | primaries (type · target) | secondaries | ledger req / prod | econ |
|---|---|---|---|---|---|---|---|
| 0 | `beit_sahwan_0_tutorial` · Working Up | recon | 10¹ | `survive_until` 600 s | `destroy_all` | — / — | n |
| 1 | `beit_sahwan_breach` · **First Light** | breach | **5** | `survive_until` 300 s · `evacuate_before` `compound` ×2 @270 s | `hold_for` `compound` 180 s · **`hold_for` `outpost_ground` 120 s** | — / R M C **E** | **y** 400 + 200/min, intel 60 |
| 2 | `beit_sahwan_1_recon` · Recon | recon | 7 | `locate` ×6 | `locate` `bs_hvt_atgm` · **`locate` `bs_track_north`** | R / R M C I | n |
| 3 | `beit_sahwan_2_foothold` · Foothold | foothold | 7 | `hold_for` `west_approach` 300 s | `collapse` `tunnel_mouth_west` | R / R M C | y 400 + 120/min |
| 4 | `beit_sahwan_3_clearance` · Clearance | clearance | 7 | `eliminate_hvt` `bs_hvt_atgm` · `capture` `town` 20 s | `locate` ×4 | R I / R M C | y 600 + 100/min |
| 5 | `beit_sahwan_4_subterranean` · Subterranean | subterranean | 6 | `collapse` `town` @300 s · **`evacuate_before` `collection_point` ×5 @240 s** · **`capture` `shaft_head` 10 s** | `locate` `bs4_digger` · **`locate` `bs4_hvt_spade`** | R I / R M C I **E** | y 500 + 90/min |

¹ the one named schema exemption (`mission.schema.json` root `if/then`).

Every objective type above is one of the **nine the runtime runs**
(`SUPPORTED`, `packages/sim/src/mission.ts:265`). `mark`, `escort` and
`no_collateral_above` are in the schema and **throw**; none is used.

**Economy, and why each mission has one.** Only 6 of 14 shipped missions declare
any. First Light's is the corridor: 400 up front and 200/min, spent on `inf_squad`
(and `mortar_team` when a squad is unaffordable) as it lands, because banking is the
losing move and GDD §4 says so. II's 400 + 120/min buys the line that holds the
approach. III's 600 + 100/min replaces losses inside a clearance. IV's 500 + 90/min
buys the escort the engineers need while they stand still. **I Recon has none and
must not gain one** — recon is not a phase about spending.

---

## 5. First Light — the event chain

This section is the level-scripter's brief. Everything else in the act is smaller.

### 5.1 What ships today, and what must not move

Measured **this session** by `pnpm playtest` on this worktree:

```
beit_sahwan_breach (passive control): DEFEAT in 4.5 min, ROE 82,
    survive_relief=active hold_compound=complete evac_settlements=FAILED, roster out 9
beit_sahwan_breach:                   VICTORY in 5.0 min, ROE 69,
    survive_relief=c hold_compound=c evac_settlements=c, roster out 14
```

**Read that carefully, because it constrains everything below.** The passive control
loses on **one thing only**: `evac_settlements` failing at 270 s. `hold_compound`
completes by itself — a passive player holds the yard — and `survive_relief` would
complete at 300 s. So:

> **`evacuate_before(compound, count 2, seconds 270)` is the sole loss condition for
> a passive player at First Light.** Do not raise its `seconds` past 300, do not
> lower its `count` to 0, and do not demote it to a secondary. Any of those turns
> the passive control into a VICTORY and `playtest` goes red on a line whose comment
> says the premise is catastrophe.

Two stale comments in `tools/src/backtest/playtest.ts` that will mislead anyone
reading it as documentation: it says *"104 attackers… over thirteen minutes"*,
*"a gate on each face"*, *"Six families is the objective"* and *"400 up front and
120/min"*. The JSON today has **36 wave bodies + 7 garrison**, **two** gates,
**count 2**, and **400 + 200/min**. The code is right; the comment is old.

### 5.2 The chain, as a timeline

`to` on a wave and on `commit` resolves through **markers only**
(`markerPos`); `zone_entered` and `hold_for` take **zones**. Both namespaces are
separate, which is why `outpost` (marker) and `outpost_ground` (zone) can coexist.

| t (s) | event | mechanism, in the real vocabulary | what the player decides | status |
|---|---|---|---|---|
| **0** | **Dawn. A spotter is already aloft and the mortars are already laid.** | `enemy.garrison` +2: `paramotor ×1` at `[24.5,10.5]`, `stance patrol` waypoints `[[14,10],[34,10]]`, `tag bs0_spotter_aloft`; `mortar_crew ×1` at `[21.5,10.5]`, `hold_position`, `group barrage`, `tag bs0_barrage` | **the sniper's attention.** `paramotor` sight 14 sees the yard from 13 tiles; the only KDF weapon in the compound that reaches it is `sniper_team`'s `amr` at range 15 (`rws_50` 9, `pintle_mg` 8, `rifles` 8). Kill the eye and the barrage goes blind — and the sniper is not shooting the assault while it does | **expressible** — measurement required (§5.5) |
| **0** | **A forward section is outside the wire.** | `starting_force`: **move** one `inf_squad` from `[21,18]` to `[20,14]`, add `group: "outpost_section"`. New secondary `hold_for(outpost_ground, 120)` | **pull them in or leave them.** In: the compound's north-west corner is manned again. Out: they are 4.1 tiles from the enemy mortar — inside `rifles` range 8 — so the forward post is the only position that can silence the barrage without leaving the wire | `group` on `starting_force` is a **schema** field (§6.2); the rest **expressible** |
| **0–60** | **Counter-battery, or not.** | shipped `mortar_team` (`mortar_60`, range 18, `collateral_risk` 0.7) versus `bs0_barrage`: `[24,25]` to `(21,10)` is **15.3 tiles**, inside range 18 and well outside effective 12 | spend the yard's only indirect asset on the enemy mortar, or hold it for the wire. `collateral_risk` 0.7 ≥ the 0.5 heavy-ordnance threshold, so **the same tube is the mission's ROE bait** the moment it fires near the families | **expressible** |
| **18** | **The wire, at every approach at once.** | **two waves at `at_seconds: 18`** (a wave has one `to`): W1a `to compound_centre`, `militia_cell ×2` from each of `raid_nw raid_n raid_ne raid_w raid_e`; W1b `to assault_sw`, `militia_cell ×2` from each of `raid_sw raid_s raid_se`. **Eight breach points, all eight `raid_*` markers, one clock tick** | which face to reinforce first — and both blind faces have no gate, so the wall is all there is | **expressible** |
| **50** | **Paramotors over the wire.** | wave `to compound_centre`: `paramotor ×2` from `raid_n`. `domain: air`, so they cross a wall the ground waves must go through | keep an air-capable mount looking up. In the yard that is `inf_squad`, `sniper_team`, `demo_squad`, `apc_eitan` and `jeep_shoded` — **and the jeep is the shepherd** | **expressible** |
| **~55** | **The villages are hit in the same minute as the compound.** | re-split the shipped ambush garrison into four groups — `ring_nw` (`militia_cell ×2` @ `[6,8]`), `ring_ne` (`×2` @ `[37,8]`), `ring_sw` (`×2` @ `[6,39]`), `ring_se` (`rpg_team ×1` @ `[38,39]`) — and give each a trigger `commit`ing it to its own `families_*` marker: `villages_rise` (`first_contact` → `ring_ne`), `they_take_the_south_village` (`first_contact` → `ring_se`), `they_come_for_the_west_families` (`timer_s 150` → `ring_nw`), `the_last_village_goes` (`timer_s 190` → `ring_sw`) | **which two families, and with what.** The jeep is 2.9 tiles/s with 2 slots; the Eitan is 1.8 with 2 and smoke. Staggering the west pair last preserves the shipped plan's route and reads as *the far side went first* | **expressible.** Trigger `id`s are shown verbatim as `enemy reacts (<id>)` — these are written to be read |
| **120** | **The forward post is overrun.** | wave `to outpost`: `militia_cell ×3` from `raid_nw`, `charge_squad ×1` from `raid_n`. `charge_squad` is the Ashwar vest — `demolition`, 420 damage, 1.6 splash, `suppression_resistance 0.85` — the doctrine's answer to a dug-in section, and it ships | nothing new; this is the consequence of t=0. `hold_for(outpost_ground, 120)` completes just as the assault lands, which is the beat: *they held for two minutes and then they were gone* | **expressible** |
| **160** | The ring tightens on the near ground. | wave `to compound_centre`: `technical ×2` from `raid_w`, `rpg_team ×2` from `raid_sw` (the shipped t=140 wave, moved) | where to spend the corridor | **expressible** |
| **165** | **A soldier is taken from the post.** | `triggers`: `they_take_the_section`, `on timer_s 165` → `do { kind: "remove", group: "outpost_section", zone: "outpost_ground" }` | nothing — but the outcome was decided at t=0. Three endings: withdrawn (they live), killed (they died fighting), still out there and alive (**taken**) | **engine** — §6.2. Fallback §6.3 |
| **205** | The armour. | wave `to assault_se`: `moto_rpg ×3` from `raid_se`, `militia_cell ×4` from `raid_s` (shipped t=190) | — | **expressible** |
| **250** | The second lift. | wave `to compound_centre`: `paramotor ×2` from `raid_n`, `militia_cell ×4` from `raid_e` (shipped t=245) | the last of the logistics | **expressible** |
| **270** | **The ring closes.** | `evac_settlements` resolves — **completely unchanged**, `count 2`, `seconds 270` | — | **live** |
| **272** | **The families still outside are taken.** | `triggers`: `the_ring_closes`, `on timer_s 272` → `do { kind: "remove", group: "families" }`, with `group: "families"` on all four shipped `civilians.groups` | — | **engine** — §6.1. Fallback §6.3 |
| **300** | **Relief.** | `survive_until 300` completes | — | **live** |

**Why 272 and not 270.** `stepTriggers` runs *before* `stepObjectives` in the same
tick (`MissionRuntime.step`). Firing the removal at exactly 270 would put a trigger
and the evacuation deadline on the same tick with the trigger first. It happens not
to matter — `evacuatedCount` is latched by `CivilianFlight`, so anyone already
inside stays counted — but two seconds costs nothing and makes the ordering not
load-bearing. **And the removal needs no zone filter**, because a civilian who
reached the refuge already has `alive = 0`: every living civilian at t=272 is by
definition still outside.

### 5.3 Player starting state

`starting_force`, 11 units, all shipped, unchanged except the one move:

`inf_squad ×1` @ `[27,18]`, `[21,28]`, `[27,28]` (the yard's corners) · **`inf_squad
×1` @ `[20,14]`, `group: "outpost_section"`** (was `[21,18]`) · `at_team ×1` @
`[22,23]`, `[27,23]` · `sniper_team ×1` @ `[24,21]` · `mortar_team ×1` @ `[24,25]` ·
`demo_squad ×1` @ `[26,26]` · `apc_eitan ×1` @ `[22,26]` · `jeep_shoded ×1` @
`[25,23]`.

No `from_ledger` — this is the first mission of the war and it `requires: []`.
Resources `logistics_start 400`, `logistics_rate_per_min 200`, `intel_start 60`,
`supply_corridor true`.

**Known hole, recorded not fixed:** `sniper_team` (`roe_rating_min 60`) and
`demo_squad` (50) are fielded here by a campaign that has earned no rating at all.
`spawnPlacement` never consults `unlock` (CLAUDE.md, "Known scaling debts").
First Light relies on it exactly as Wadi Halam V does.

**Carriers.** `hull.transport_slots`: `jeep_shoded` 2, `apc_eitan` 2 (`ifv_namer`
5, `technical` 3 — neither is present here). A family group of 3 cannot all ride
one jeep; the two groups of 3 and the group of 2 are why `count: 2` is the right
number and why the shipped plan takes the two western groups.

### 5.4 Enemy stance, in words

Ashwar doctrine, converging raid, all approaches at once. Nine at t=0, thirty-nine
arriving in seven waves.

- **The eye and the tube** hold at 10–13 tiles north: one `paramotor` on a lateral
  patrol beat, one `mortar_crew` `hold_position` behind it. Neither closes.
- **Four ring groups** sit in the four village blocks in `ambush` (tiles 3–4) and do
  not move until their trigger. Then they go for the **families**, not the wall.
  They cannot shoot civilians — civilians are untargetable by either side and are
  hurt only by ordnance — so what the commit does is put armed men between the
  shepherd and the family, and put a firefight beside people the player's own
  heavy ordnance is judged for.
- **The waves** arrive on a clock at 18 (×2), 50, 120, 160, 205, 250 and
  attack-move to `compound_centre`, `assault_sw`, `assault_se` or `outpost`.
- **Cadence:** a beat every 35–55 seconds for five minutes, front-loaded. What
  changes across the mission is not volume but *direction* — first the wire, then
  the sky, then the villages, then the forward post, then the near ground.

**Volume delta:** 48 bodies against the shipped 43, +11.6%. CLAUDE.md records that
scaling this mission's waves from 36 to 131 attackers walked the passive run's
survivors from 9 to 2 **and did not flip the result**, so the margin is wide — but
that cuts both ways and §5.5 is not optional.

### 5.5 What `playtest` must re-measure, and in what order

1. **`beit_sahwan_breach (passive control)` must still be DEFEAT.** It will be: the
   loss condition is untouched and the mission is harder. Confirm anyway.
2. **`beit_sahwan_breach` must still be VICTORY.** This is the one at risk. The
   shipped plan wins at exactly 5.0 min with `roster out 14`. Three of the changes
   can break it: the mortar crew (one round per 20 s from first contact), W1's
   sixteen bodies at t=18, and the forward section standing in the open.
3. **Tune in this order if it goes red:** W1's per-marker `count` from 2 to 1 (16
   → 8) first, then the `mortar_crew` out, then the spotter. Do **not** touch
   `evac_settlements`, and do not add `roe.fail_below` to this mission — the opening
   mission of the war should not be losable on the score.
4. **Watch `roster out`.** It feeds every later mission's `from_ledger`. A drop from
   14 to single figures re-prices the whole act and `beit_sahwan_1_recon` onward
   must be re-run, not just this line.
5. **Duration.** `playtest` measures only "did it finish inside 20 minutes"
   (GH-84). First Light is one of the seven missions with an **endure-clock**, so
   its ratio is informative: 1.00 of target today, plan +0.0 min above its own
   floor. If that moves, something is wrong with the floor, not the plan.

### 5.6 Story hooks for `narrative-designer`

- **`dispatch` (unbuilt).** The campaign's opening line. One sentence, before
  anything is on screen. It is the only place the word *dawn* should appear.
- **`briefing` (live, ≤240 chars per beat).** The shipped text already carries the
  atrocity in full and **must not gain narration** — the orders voice stays orders.
  What it needs is two clauses it does not have: the forward section, and the eye
  aloft. Idit's picture, Shai's plan, alternating.
- **`objectives[].text` (live).** Three shipped strings stay verbatim. One new:
  the outpost secondary. Name the position, not the men.
- **Trigger ids (live, leaked verbatim).** Six of them, each read by the player as
  `enemy reacts (<id>)`. `villages_rise` is shipped and good; the other five are
  written above to be read as prose.
- **`aftermath` (unbuilt).** Where the taking is said. Under Option A this is the
  *only* place it is said. The number is nine.
- **`debrief` (needed, unbuilt).** The end screen shows a rating and a survivor
  count and nothing else. This is where Shai does not say the number and Idit does.
- **The register:** stated, never depicted. Consequence, not sermon.

### 5.7 Twist candidates — First Light

For `level-scripter` to classify. One line each.

- **T-A1 "The eye is the mission."** Killing `bs0_spotter_aloft` silences the
  barrage for the rest of the mission. *Expressible today* — indirect fire is gated
  on per-side identification, so this falls out of the existing model with no new
  content; needs measuring, not building.
- **T-A2 "They came for the people, not the post."** The ring groups `commit` to the
  families rather than to `compound_centre`. *Expressible today* — four groups, four
  `commit` triggers, four markers.
- **T1 (storyline) "The families that did not get in."** At 272 s the nine outside
  are taken. *Engine* — `do.kind: remove` (§6.1).
- **T-A3 "The section is gone."** The forward post's men are taken if they are alive
  and still out there at 165 s. *Engine* — `remove` plus `group` on `starting_force`
  (§6.2).
- **T-A4 "The wall was never the line."** A wave arrives `from raid_e` and
  attack-moves to `compound_centre` *through* the east gate the player's own
  reinforcements are using. *Expressible today* — a `to` marker inside the compound.
- **T-A5 "They fire on the block they are standing in."** A `mortar_crew` round
  lands inside the flagged `clinic` zone and the player's score does not move,
  because the penalty is only ever on the player. *Needs a round to land where an
  author chose* — `spawn` can stage the shooter, sim work to guarantee the impact.
  Same shape as the storyline's T8.

---

## 6. The abductions

Two mechanics are needed and **neither exists**. `do.kind` is
`commit | withdraw_to | spawn | reinforce | dismount` — nothing removes and nothing
kills (`mission.schema.json`; `stepTriggers`, `mission.ts:1312`).

Three things were checked before proposing anything, because each would have made a
verb unnecessary:

- **A trigger cannot walk civilians away.** `CivilianFlight.step` re-orders any
  *fled* civilian who has stopped moving back to the refuge, every tick. A
  `withdraw_to` on a civilian group is overwritten by the game's own rule within a
  second.
- **A buried civilian is a trap, not a hostage.** `in_tunnel` is legal on a civilian
  placement (schema and `validate_data.mjs` both allow it), and `collapseTunnel`
  kills every occupant attributed to the collapsing unit — 8 ROE each. But
  `stepSurfacing` skips any unit with `type.weapons.length === 0`, and `civilians`
  has no weapons, so **a buried civilian can never come up**, can never be
  shepherded, and can never be collected. Burying hostages produces a mission whose
  only two outcomes are "do not collapse that route" and "kill them". See §9 G3.
- **`locate` cannot find a civilian.** `identified` only admits targets with
  `side === 1` (`mission.ts:756`). "Find the hostages" is not an objective the
  runtime can express; the *guard* beside them can be.

### 6.1 A civilian group taken when the ring closes

**Proposal — `do.kind: "remove"`.**

```
do: { kind: "remove", group: "families", zone?: "<zone id>" }
```

- **Semantics:** every living entity registered under `group` — and, if `zone` is
  given, only those whose tile is inside it — leaves play. `alive = 0`, one event
  per entity.
- **Why it is small:** civilian placements already accept `group`
  (`civilians.groups` items are the shared `$defs/placement`), and `spawnPlacement`
  registers `p.group` into `this.groups` **for every side, including side 2**
  (`mission.ts:1039`). So the data half needs nothing at all; only the verb is new.
- **Where the write goes:** a new `sim.removeFromPlay(id)`, **not** `destroy()`.
  `destroy()` emits `destroyed` with a `by`, and `stepRoe` turns a civilian
  `destroyed` by a player unit into an 8-point deduction. An abduction is the
  enemy's act, not a failure of the player's restraint, and must not touch the
  score. Precedent for the single state write already exists inside the sim package:
  `CivilianFlight.collect` clears `alive` for a civilian who reached the refuge.
- **The event.** A new `SimEvent`/`MissionEvent` kind is **required, not optional**.
  `alive = 0` is the identical record a casualty leaves, which is exactly the
  problem the `evacuated` event was added to solve — without a distinct event the
  renderer draws the death pose for an abduction. Owner `render-vfx` for the notice.
- **Determinism:** a command resolved on a tick boundary, no float, no RNG.
  `packages/sim/src/determinism.test.ts`'s golden replay uses no missions, so the
  hash cannot move. `pnpm balance` cannot see it.
- **Guard:** `validate_data.mjs` must refuse a `remove` naming an unknown group.
- **Owner:** `sim-guard` (schema + `mission.ts` + `sim.ts`), `render-vfx` (notice).

### 6.2 A soldier taken from an overrun post

**Player units are not addressable by group today.** `starting_force` is
deliberately **not** the shared placement `$def`: its shape is `unit count
from_ledger at` with `additionalProperties: false`.

**Proposal — one schema key.** Add `group: { type: "string" }` to the
`starting_force` item shape. **The runtime needs zero changes**: `spawnPlacement`
already registers `p.group` regardless of side, and `do.kind: "reinforce"` already
routes the full shared placement — group and tag included — through the same
function for side 0. A player unit arriving by `reinforce` can already carry a group
and a tag today; only the ones placed at the start cannot.

Then `remove(group: "outpost_section", zone: "outpost_ground")` does the rest.

**Two consequences to state before anyone builds it:**

1. **A removed player unit is not in `roster.surviving_units`.** `checkEnd` walks
   `playerIds` and skips anyone with `alive !== 1`. That is exactly right and it is
   the mechanical consequence the story wants: the man who was taken does not
   deploy next mission.
2. **Removing the last living player unit reads as a wipe.** `checkEnd`'s
   `wiped` test is `playerIds.every(alive === 0)`. `validate_data.mjs` must refuse a
   `remove` whose player-side group covers the entire `starting_force`.

**How he comes back.** Under Option C the man is rescued in IV — but he is **not**
the same entity, and the document should say so plainly. The runtime has no prisoner
side: what stands at the shaft head in IV is a `civilians` placement, because that
is the one side that is untargetable, hurt only by ordnance, counted by
`evacuate_before`, and scored at 8 points if the player kills it. The
representation is a design choice, not a limitation being hidden.

### 6.3 If Act I ships before either verb exists

Nothing in the design breaks. The taking is **stated** and **shown by arithmetic**:

- **Stated** in `dispatch` (opening), `aftermath` (victory banner) and `debrief`
  (end screen) — three optional strings, `storyline.md` §7 G3, the cheapest gap in
  the tree.
- **Shown** by the count that did not get inside: eleven placed, two required, and
  the HUD already announces `OBJECTIVE FAILED — Get two families inside the wire
  before the ring closes` on the deadline, with no new surface at all.
- **Recorded** by adding `civ.settlements_evacuated` to First Light's `produces`.
  Live key, zero risk, read by nothing yet — and **no line may branch on it while
  D9 stands.**
- The forward section then simply lives or dies. The `hold_for(outpost_ground, 120)`
  secondary and the t=0 decision are unaffected; only the third outcome disappears.

**This fallback is the recommended shipping order.** Author the act, prove it with
`playtest`, and land the verbs after.

---

## 7. Per mission — I to IV under the hostage spine

Three of the four keep every objective they ship with. What changes is listed
exactly; anything not listed is unchanged.

### I — `beit_sahwan_1_recon` · *Recon* · 7 min

| | |
|---|---|
| **player start** | unchanged. `recon_drone ×1 [8,23]`; `inf_squad ×3 [5,20]`, `at_team ×1 [5,26]` **from_ledger**; `apc_eitan [3,22]`, `mbt_lavi [3,18]`, `ifv_namer [3,28]`, `mortar_team [2,24]`. `player_start [4,23]`. No economy — correct, and it must stay that way |
| **enemy** | unchanged, **+1**: `bs_track_north` — `militia_cell ×1` at `[26.5,16.5]`, `stance ambush(3)`, `tag bs_track_north`. Tile `(26,16)` is `.` and free of every shipped placement in both I and IV |
| **objectives** | `locate ×6` primary unchanged (it counts identifications, not tags, so a twelfth body changes nothing). `locate(bs_hvt_atgm)` secondary unchanged. **+1 secondary** `locate(bs_track_north)` |
| **the decision** | how far east to push the drone and the screen before the technicals commit (`hunt_the_scouts`, `first_contact`). The new position sits **north of the road**, off the shipped plan's east-west axis — so identifying it costs a deliberate detour, which is the whole point |
| **why it matters later** | `intel.marked_positions` accumulates by **tag**. A tag marked here spawns **pre-identified and forfeits its ambush** in a later mission (`spawnPlacement`, `preMarked`). `bs_track_north` appears again in IV, on the road to the shaft head. **A rushed recon leaves a live 3-tile ambush on the rescue's approach; a thorough one disarms it before the mission starts.** That is GDD §4's carry-over, made concrete in one placement |
| **ROE bait** | `roe.enabled` only, no flagged zones, no `fail_below` — and it should stay that way. The temptation is the `mbt_lavi`'s main gun answering two `technical`s in a district with three civilians. *Optional*: add `flagged_zones: ["clinic"]`; the zone exists on the map and the mission never goes near it, so the cost is zero and the signal is early |
| **twists** | **T2 (storyline) "The picture is old"** — one `locate` target was abandoned and the real cell is four tiles off. *Expressible today* — two tagged placements plus a `spawn`. **T-B1 "They are counting you too"** — `bs_observer_aloft` (the shipped patrolling paramotor) is what tells the town the KDF is coming. *Radio line only* |
| **story hooks** | Idit's first picture, and the first mission in which she is on a net rather than in a room. Her question is not *what is in the town* but *where did the column go*. The northern track is her answer and she is not sure of it |

### II — `beit_sahwan_2_foothold` · *Foothold* · 7 min

| | |
|---|---|
| **player start** | unchanged. `apc_eitan`, `ifv_namer`, `inf_squad ×2` and `at_team ×1` **from_ledger**, `mortar_team`, `yahalom_squad ×1`. `structures`: one `camp` at `[2,20]` — the only shipped mission that raises a structure. Economy 400 + 120/min |
| **enemy** | unchanged. `digger_crew` `digs: bs_tn_west`; `rpg_team ×2` `in_tunnel: bs_tn_west`; a `technical` carrying an `rpg_team` as `passengers`, committed at 60 s and dismounted at 67 s |
| **objectives** | unchanged. `hold_for(west_approach, 300)` primary; `collapse(tunnel_mouth_west)` secondary |
| **the decision** | **the secondary is the mission.** `collapse` here is not scenery: bring the route down and the two `rpg_team` inside die with it (`collapseTunnel` — everyone below dies, attributed to the charge); leave it and the route vents at `[7,22]`, **behind the line the player is holding**, and they come up shooting. Under the hostage spine the same act has a second price: this is the route they went down |
| **ROE bait** | no civilians on this map for this mission, and no flagged zone. The bait is structural: the `mortar_team` at range 18 reaches the `clinic` zone from the approach. *Optional*: add `flagged_zones: ["clinic"]`, cost zero unless the player shoots there |
| **twists** | **T3 (storyline) "The spoil was a decoy"** — the western shaft is real and empty and the route under the line is a second one. *Expressible today* — two routes, one `collapse` target. **T-B2 "It is not a shaft, it is a door"** — the vent at `[7,22]` is inside the player's own laager, and the briefing already says a route behind your line is worth more than every man in front of it. *Radio line only* |
| **story hooks** | Idit reads spoil. Shai has to choose between closing a door and keeping a thread, and neither of them says which one they would pick. The briefing must not resolve it |

### III — `beit_sahwan_3_clearance` · *Clearance* · 7 min

| | |
|---|---|
| **player start** | unchanged. `mbt_lavi ×1`, `ifv_namer ×2`, `inf_squad ×3`, `at_team ×1`, `mortar_team ×1` **from_ledger**; `apc_eitan`, `recon_drone`, `demo_squad` fresh. Economy 600 + 100/min |
| **enemy** | unchanged. Twelve placements including `bs_cell_north_block` **garrisoned** in the building at `[28,12]`, two `ambush(3)` RPG teams, a `charge_squad` in `ambush(4)` at the town centre, `bs_hvt_atgm`, and a `reserve` group on `casualties_pct(50) → commit town_center` |
| **objectives** | unchanged. `eliminate_hvt(bs_hvt_atgm)` and `capture(town, 20)` primaries; `locate ×4` secondary |
| **the decision** | the clinic block. `roe.flagged_zones: ["clinic"]`, `fail_below: 40`. Measured (CLAUDE.md): the scripted plan lost **55 of 61 points** to eleven deductions for firing into the clinic — 107 rounds of `cannon_30`, whose `collateral_risk` 0.35 clears the 0.3 structural threshold where `rifles`, `coax_mg` and `rws_50` do not. Keeping the armour off the zone takes the same plan to **ROE 94**. The block is genuinely takeable with rifles and the Eitan's remote gun, and genuinely not with autocannon |
| **ROE bait** | shipped and the strongest in the tree. **Change nothing.** Under the spine, Sahim holds the clinic block because that is where the human terrain is, and because it is where he keeps what he took — which the player does not learn until IV |
| **twists** | **T4 (storyline) "He is in the block"** — SPADE is identified inside the flagged block and leaves during the fight; the player knows exactly where he is and cannot shoot there. *Expressible today* — a tagged placement plus `withdraw_to`. **T-B3 "The reserve is not a reserve"** — the `casualties_pct(50)` group counter-attacks *from* the clinic block, so pushing the fight forward pulls the enemy into the one place ordnance is judged. *Expressible today* — change the group's `at` |
| **story hooks** | Sahim named for the first time in orders voice. The clinic-block passage stays verbatim; the only addition is that he is a person now. The line about being billed for every second they can see it is the act's thesis and should not be paraphrased |

### IV — `beit_sahwan_4_subterranean` · *Subterranean* · 6 min — **the rescue**

| | |
|---|---|
| **player start** | unchanged: `yahalom_squad ×2` `[25,35]` `[27,35]`, `recon_drone [24,36]`, `inf_squad ×3` and `ifv_namer ×1` **from_ledger**, `apc_eitan [26,35]`. `player_start [26,34]`. Economy 500 + 90/min. **The `ifv_namer`'s 5 transport slots are the rescue vehicle** — a hostage group of four rides out in one lift |
| **enemy** | unchanged, **+3**: `bs4_hvt_spade` — `militia_cell ×1` at `[25.5,13.5]`, `hold_position`, `tag bs4_hvt_spade`, `group spade_party` (a digger does not leave his hole; **no `withdraw_to`**, deliberately). `spade_guard` — `rpg_team ×1` at `[27.5,15.5]`, `ambush(3)`, `group spade_party`. `bs_track_north` — `militia_cell ×1` at `[26.5,16.5]`, `ambush(3)`, **same tag as in I**, so a thorough recon disarms it |
| **civilians** | **`refuge` changes from `civ_refuge` to `civ_collection`** (this moves where *all* of IV's civilians flee, from `[22,45]` to `[29,33]` — three tiles from the player start, and better). Groups: the two shipped (`×2 [28.5,14.5]`, `×2 [24.5,33.5]`) **+ `hostages`**: `civilians ×4` at `[24.5,14.5]`, `group: "hostages"`. Bodies land on `(24,14) (25,14) (27,14) (24,15)`, all `.`, all clear of every other placement |
| **objectives** | `collapse(town, 300)` primary unchanged. **+`evacuate_before(collection_point, count 5, seconds 240)` primary. +`capture(shaft_head, 10)` primary.** `locate(bs4_digger)` secondary unchanged, **+`locate(bs4_hvt_spade)` secondary** |
| **the count arithmetic, and why it is 5** | `evacuate_before` counts **every** civilian who reaches the refuge zone — `civFlight.evacuatedCount` is global and cannot name a group. Eight civilians exist: 4 hostages + 4 residents. The two residents beside the player start walk out for free the moment a soldier is within 4 tiles. **`count: 5` therefore forces at least one hostage out and, in practice, three**, because the northern resident pair is at the shaft head too. If the lead wants the requirement exact, the schema gap is §9 G5 |
| **the decision** | **order, under two clocks.** The route collapse has 300 s and the evacuation 240 s, both inside a 6-minute mission. The shaft head is 20 tiles from the start through a town with a live ambush on the road; the Yahalom must stand still in the open beside each of four routes to set a charge. Send the Namer north for the hostages and the engineers work unescorted; escort the engineers and the 240 s runs out |
| **ROE bait** | shipped `flagged_zones: ["clinic"]`, `fail_below: 40`. **New and better:** the hostages stand two tiles from `spade_guard`. Any weapon at `collateral_risk ≥ 0.5` fired within 2 tiles of a civilian is "heavy ordnance danger-close" and deducts 3 per event; killing one deducts 8. The `ifv_namer`'s `cannon_30` is the obvious answer to an ambushing RPG team and it is the one weapon that will cost the mission. **Restraint is the superior play and the arithmetic says so**: four hostages killed is 32 points against a floor of 40 |
| **SPADE's end** | `capture(shaft_head, 10)` — 10 s uninterrupted, contest resets, civilians (side 2) do **not** contest. He holds position, so the ground and the man are the same objective. This is `storyline.md` §7 G8's recommendation taken literally: it works today, with no engine work, and upgrades in place when GH-18 lands |
| **twists** | **T5 (storyline) "A soldier under the road"** — the man taken at First Light is one of the four at the shaft head. *Expressible today as a `civilians` placement*; a true friendly-tagged prisoner is engine work (§9 G6). **T-B4 "The route they went down is the one you have to bring down"** — hostages held **inside** `bs_tn_north`, freed by venting it and killed by collapsing it. *Engine* — needs G3, and it is the version of this mission the design actually wants (§9). **T-B5 "He waits"** — Sahim does not run when his guard dies; the `capture` is uncontested and the mission ends on a man standing still. *Expressible today* — the absence of a `withdraw_to` |
| **story hooks** | Idit's last question of the act, and the only one she has been asking since the first morning. Shai does not get to level the block he has spent four missions being told not to level; he has to walk into it. The `aftermath` is where the number nine is finally set against the number that came back |

---

## 8. Asset manifest

Every row is **PRESENT (path)** or **MISSING (gate + pipeline)**. Censused
2026-09-03 in this worktree; gate names are the ones in `package.json`.

### 8.1 Units — all PRESENT

| unit | data | mesh | sprite |
|---|---|---|---|
| `inf_squad` | `data/units/kdf/inf_squad.json` | `art/meshes/inf_squad.glb` | `assets/sprites/INF_SQUAD` |
| `at_team` | `data/units/kdf/at_team.json` | `art/meshes/at_team.glb` | `assets/sprites/INF_AT` |
| `mortar_team` | `data/units/kdf/mortar_team.json` | `art/meshes/mortar_team.glb` | `assets/sprites/INF_MORTAR` |
| `sniper_team` | `data/units/kdf/sniper_team.json` | `art/meshes/sniper_team.glb` | `assets/sprites/INF_SNIPER` |
| `demo_squad` | `data/units/kdf/demo_squad.json` | `art/meshes/demo_squad.glb` | `assets/sprites/INF_DEMO` |
| `yahalom_squad` | `data/units/kdf/yahalom_squad.json` | `art/meshes/yahalom_squad.glb`, `yahalom_engineer.glb` | `assets/sprites/INF_YAHALOM` |
| `apc_eitan` | `data/units/kdf/apc_eitan.json` | `art/meshes/vehicles/apc_eitan.glb` | `EITAN_HULL`, `EITAN_TURR` |
| `ifv_namer` | `data/units/kdf/ifv_namer.json` | `art/meshes/vehicles/ifv_namer.glb` | `NAMER_HULL`, `NAMER_TURR` |
| `mbt_lavi` | `data/units/kdf/mbt_lavi.json` | `art/meshes/vehicles/mbt_lavi.glb` | `TNK_HULL`, `TNK_TURR` |
| `jeep_shoded` | `data/units/kdf/jeep_shoded.json` | `art/meshes/vehicles/jeep_shoded.glb` | `JEEP_HULL` |
| `recon_drone` | `data/units/kdf/recon_drone.json` | **none — sprite-only by design** | `assets/sprites/DRONE_RECON` |
| `militia_cell` | `data/units/enemy/militia_cell.json` | `art/meshes/militia_cell.glb` | `INF_MILITIA` |
| `rpg_team` | `data/units/enemy/rpg_team.json` | `art/meshes/rpg_team.glb` | `INF_RPG` |
| `mortar_crew` | `data/units/enemy/mortar_crew.json` | `art/meshes/mortar_crew.glb` | `INF_MORTAR_E` |
| `digger_crew` | `data/units/enemy/digger_crew.json` | `art/meshes/digger_crew.glb` | `INF_DIGGER` |
| `charge_squad` | `data/units/enemy/charge_squad.json` | `art/meshes/charge_squad.glb` | `INF_CHARGE` |
| `paramotor` | `data/units/enemy/paramotor.json` | `art/meshes/vehicles/paramotor.glb` | `PARA_MOTOR` |
| `atgm_cell` | `data/units/enemy/atgm_cell.json` | `art/meshes/atgm_cell.glb` | `INF_ATGM` |
| `technical` | `data/units/enemy/technical.json` | `art/meshes/vehicles/technical.glb` | `TECH_HULL`, `TECH_TURR` |
| `moto_rpg` | `data/units/enemy/moto_rpg.json` | `art/meshes/moto_rpg.glb` | `MOTO_RPG` |
| `gun_truck` | `data/units/enemy/gun_truck.json` | **none — sprite-only** | `GUNTRUCK_HULL`, `GUNTRUCK_TURR` |
| `loiter_drone` | `data/units/enemy/loiter_drone.json` | **none — sprite-only** | `DRONE_LOITER` |
| `civilians` | `data/units/civilians.json` | `art/meshes/civilians/{civilian_woman,office_worker,farm_worker,civilian_child}.glb` | **MISSING — see below** |

**One real hole.** `civilians` has **no `SPRITE_MAP` entry and no sprite sheet**, by
design (`packages/app/src/main.ts`, `mesh-catalogue.ts:129`). On `?renderer=pixi` or
`&nomesh` a civilian **draws nothing**. Act I places 11 at First Light, 3 in I, 5 in
III and 8 in IV under this design, and three of those missions score on them.

> **`civilians` billboard sheet — MISSING.** Gate `pnpm validate:assets` (palette,
> reserved bands, binary alpha, silhouette IoU, framing) **and** a `SPRITE_MAP`
> entry, which no gate checks — three complete sheets have shipped and drawn nothing
> for want of one. Pipeline: `tools/units/kit.py` → `render_team.py`. **Owner:**
> `blender-art`. **Priority:** whatever the lead's answer is to "does Pixi still
> have to be playable" (§10 O-D).

### 8.2 Structures — all PRESENT

`data/structures.json`, 8 types, each with an idle and a wreck GLB in
`art/meshes/buildings/`. Act I uses seven of them: `wall` (=), `house` (h),
`shanty` (s), `mosque` (m), `concrete` (#), `warehouse` (w), `apartment` (a), and
`camp` (c, raised by II's `structures[]`). `house`, `apartment` and `warehouse` ship
their supplied photo-textured bakes and are the named palette exemption.

### 8.3 Decor — all PRESENT

`art/meshes/decor/`: `grass_0-2`, `sand_0-2`, `bush_0-2`, `tree_0-2` (`o`),
`rock_0-2` (`n`), `slab_0-2` (`^`), `boulder_0-2` (`b`), `ditch_0` (`d`). Act I's
two maps use `o`, `n` and the cover tiers only; road (`r`) has no decor family, by
design.

### 8.4 Maps

| row | status |
|---|---|
| `data/maps/marj_perimeter.json` | **PRESENT** |
| `data/maps/beit_sahwan_outskirts.json` | **PRESENT** |
| `data/maps/tutorial_ground.json` | **PRESENT** |
| 6 markers + 1 zone on `marj_perimeter` (§3.1) | **MISSING — new, additive.** Gate `pnpm validate:data` (marker/zone bounds). Pipeline: hand-edit JSON — `mission-author` |
| 1 marker + 2 zones on `beit_sahwan_outskirts` (§3.2) | **MISSING — new, additive.** Same gate and owner. **The character grid is not touched**, so the four missions sharing it are unaffected: a zone nothing names is inert |

### 8.5 VFX

| row | status |
|---|---|
| 15 emitters in `data/vfx/` including `tunnel_collapse.json`, `structure_collapse.json`, `catastrophic_kill.json`, `shell_impact.json` | **PRESENT** |
| `art/meshes/vfx/{explosion_burst,muzzle_flash,smoke_plume}.glb` | **PRESENT** |
| **A "taken" surface** — a distinct notice and effect for an entity removed from play, which must read as neither a death nor a rescue | **MISSING.** Gate `pnpm validate:data` (`vfx_emitter.schema.json`, palette keys only, never raw hex). Pipeline: `data/vfx/*.json` + `packages/render/src/three/` — **owner `render-vfx`**. Blocked on §9 G1 |

### 8.6 Audio

| row | status |
|---|---|
| 11 weapon/impact sets, 31 `.ogg` + 31 `.m4a`, CC0 from `tools/gen_audio.py` | **PRESENT** (`assets/audio/`) |
| **EVA announcement set** (objective complete/failed, unit lost, reinforcements, **taken**) | **MISSING.** Gate `pnpm validate:audio` — **fails by construction**: `KNOWN_EVENTS` is `{fire, penetration, ricochet, near_miss, aps_intercept, destroyed}`, all weapon events, and a voice set has none of them. Pipeline: GH-110; the gate must widen first (`storyline.md` §7 G4) |
| Shai / Idit / Sahim voice lines | **MISSING.** Same gate; every variant needs a redistribution-safe licence **and** a source URL. GH-110. `storyline.md` §2.4(5) binds hardest here — accent, language and idiom carry ethnicity |
| Unit barks by role | **MISSING.** Same gate. GH-110 |
| Music | **MISSING.** GH-133 — out of scope for Act I |

### 8.7 UI art and the narrative layer — what **Act I specifically** needs first

Ordered by what Act I cannot ship without. Every row also appears in
`storyline.md` §6.2.

| # | row | status | gate | pipeline / owner |
|---|---|---|---|---|
| 1 | **`data/campaign/commander.json`** — Shai, Idit, the rank ladder, per-mission `{speaker, rank}` | **MISSING** | `pnpm validate:data` — needs a new `data/schemas/commander.schema.json` *and* a line in `tools/validate_data.mjs`, which names `data/campaign` files individually | hand-authored JSON — `mission-author`; `hud.ts` reader — `render-vfx`. **Act I is the reason this is first**: `ui/hud.ts:68` is `const COMMANDER = { rank: 'Lt Col Shai Hammai' … }` and Shai is a **Captain** for all five of these missions |
| 2 | **`dispatch` / `aftermath` / `debrief` fields** | **MISSING (fields do not exist)** | `pnpm validate:data` | schema — `sim-guard`; surfaces — `render-vfx`. **Act I is the reason this is second**: under the §6.3 fallback these three strings are the *only* place the taking is said |
| 3 | Shai portrait `assets/ui/shai_portrait.png` (512×640) | **MISSING** | **no gate** — `tools/validate_assets.py` defaults to `--sprites assets/sprites`, so `assets/ui/` is ungated, same footing as `menu_banner.jpg` | generative, PR disclosure required (`CONTRIBUTING.md`); brief in `2026-08-21-commander-brief-design.md` |
| 4 | Idit portrait | **MISSING** | no gate | as above |
| 5 | Sahim portrait | **MISSING** | no gate | as above. **Must resemble no real person and carry no real insignia** |
| 6 | KDF rank insignia, 2 stars (Captain) — the only rank Act I needs | **MISSING** | no gate; `pnpm validate:ui` if drawn in CSS (no colour literals) | vector; must resemble no real force |
| 7 | Ashwar Front faction mark | **MISSING** | no gate | vector. The only insignia shipping is `assets/campaign/flag_brigade.png` (KDF) — **PRESENT** |
| 8 | `say: { speaker, text }` on `triggers[].do` and `objectives[]` + radio overlay | **MISSING** | `pnpm validate:data`; `pnpm test:determinism` must stay unmoved | `sim-guard` (schema, emit) + `render-vfx` (overlay). §9 G7 |
| 9 | Debrief screen | **MISSING** | `pnpm validate:ui`, `pnpm test` | `ui/menu.ts` `showEndScreen` has zero authorable text today |
| 10 | `assets/ui/menu_banner.jpg` | **PRESENT** | — | — |
| 11 | Campaign board — `world_map.png`, 3 region layers, `sahar_basin.svg`, `flag_brigade.png`, `art/meshes/campaign/sahar_basin.glb`, `data/campaign/world.json` | **PRESENT** | — | Act I needs only a `world.json` edit if Option B adds a mission |

---

## 9. Engine and schema gaps this act depends on

Ranked by how much of Act I each blocks. Every one has a stated fallback; **none of
them stops the act shipping.**

| # | gap | smallest proposal | owner | Act I impact |
|---|---|---|---|---|
| **G1** | **No verb removes anything.** `do.kind` is `commit / withdraw_to / spawn / reinforce / dismount`. The taking — of a family group and of a soldier — has no mechanism, and neither does the storyline's T1, T5 or T12 | `do: { kind: "remove", group, zone? }` → `sim.removeFromPlay(id)`, a single `alive = 0` write on a tick boundary, plus a **new event kind** so the renderer can tell an abduction from a death (the exact reason `evacuated` exists). Explicitly **not** `destroy()`, so no ROE deduction: an abduction is the enemy's act. `validate_data.mjs` refuses an unknown group and refuses a player group covering the whole `starting_force` | `sim-guard` + `render-vfx` | **First Light's last beat.** Fallback §6.3: the taking is stated in three strings and shown by a count |
| **G2** | **`starting_force` cannot carry a `group`**, so no player unit placed at the start is addressable by any trigger | Add `group: {type: "string"}` to the `starting_force` item shape. **Zero runtime change** — `spawnPlacement` already registers `p.group` for every side, and `do.kind: reinforce` already routes group and tag through it for side 0 | `sim-guard` | The forward section's abduction (T-A3). Fallback: the section simply lives or dies |
| **G3** | **A buried civilian can never come up.** `stepSurfacing` requires `type.weapons.length > 0`; `civilians` has none. So an `in_tunnel` civilian is unreachable, unrescuable, and killed by any collapse — the one shape in which "get them out before you bring the roof down" would be a real ordering constraint is the one shape the runtime turns into a trap | Two halves. **Now:** `validate_data.mjs` refuses an `in_tunnel` placement of a unit with no weapons, so nobody authors the trap. **Later:** let a weaponless side-2 body surface when its route vents, so hostages can be freed by opening a route and must then be walked out before it is brought down | `sim-guard` (+ `content-validator` for the guard) | **T-B4 — the version of IV the design actually wants.** Fallback: surface hostages at the shaft head, which loses the ordering and keeps the rescue |
| **G4** | **A `capture` cannot require its target to be alive.** SPADE's end is a zone hold; killing him captures the ground just the same, so the runtime cannot tell taking a man from shooting him | Optional `requires_alive: "<tag>"` on a `capture` objective: the objective **fails** if every unit with the tag is dead. Failure, not "stays incomplete" — an incomplete primary with no failure path is the softlock the raze and collapse deadlines exist to close. It is also exactly the ROE theme: a stray autocannon round loses the mission, and the mission is **lost, not stuck**. Upgrades in place when GH-18 (prisoners) lands | `sim-guard`; `mission-author` uses `capture` alone today | SPADE's ending is honest but unenforced. Fallback: `capture(shaft_head)` + `locate(bs4_hvt_spade)` + `aftermath` |
| **G5** | **`evacuate_before` cannot name a group.** `civFlight.evacuatedCount` is global, so IV's hostages and IV's residents are one number | Optional `group: "<placement group>"` on an `evacuate_before` objective; `collect` filters `civIds` by group membership, which `spawnPlacement` already records | `sim-guard` | IV's requirement is expressed as count arithmetic (`count: 5` of 8) instead of exactly. Works; reads as a puzzle it is not meant to be |
| **G6** | **No friendly-tagged HVT.** A KDF soldier held by the enemy has no representation; the storyline's T12 needs the same thing in Act III | A `side` or `captive: true` field on a placement, or accept the `civilians` representation permanently and say so | `sim-guard` | Act I ships on the `civilians` representation, which is honest and stated (§6.2) |
| **G7** | **Nothing can speak after the deploy screen.** `stepTriggers` fires and the player sees `enemy reacts (<trigger id>)` and nothing else. Six of First Light's beats are trigger-driven | `say: { speaker, text }` on `triggers[].do` and `objectives[]`, emitted as a new `MissionEvent`. **No sim state changes**, so invariant 4 holds and the determinism hash cannot move. The tutorial's step machine is the working precedent | `sim-guard` + `render-vfx` | The chain reaches the player as six trigger ids. It works — the ids are written as prose — but it is the difference between a timeline and a story |
| **G8** | **A trigger cannot fire on an objective, and cannot see the sim.** The forward post's abduction is on a bare `timer_s` because there is no "the enemy holds this zone" condition and no `objective` condition | Two `on.kind`s: `objective` (an objective id) and `sim` (one of the 24 `SimEvent` kinds). The tutorial's `await` already gates on every `SimEvent`, so the predicate is reused | `sim-guard` | The 165 s removal is a clock rather than a consequence. Acceptable; the zone filter does most of the work |
| **G9** | **`intel.marked_positions` cannot pre-reveal a tunnel route**, and after the tunnel playtest it should not — a route is identified only while a `mark_tunnel` carrier holds a sight line | Nothing. Recorded so nobody authors GDD §4's *"thorough recon → tunnel mouths pre-marked"* literally. Act I honours the carry-over contract through **surface** tags instead (`bs_track_north`), which is the same promise by a mechanism that works | `sim-guard` (doc) | None — the design is already written this way |
| **G10** | **The audio gate cannot accept a voice file.** `KNOWN_EVENTS` is six weapon events | A non-weapon set kind and its events (`objective_complete`, `objective_failed`, `unit_lost`, `reinforcements`, `taken`, `line`). The licence and source-URL checks stay — they are that gate's load-bearing half | `render-vfx` + `content-validator`; GH-110 | Every audio row in §8.6 |

---

## 10. Open decisions for the lead

| # | decision | in plain words | recommendation |
|---|---|---|---|
| **O-A** | **Which plot?** A (chain inside First Light), B (+ a new "The Villages" mission), C (the hostage spine) | A is the cheapest and the atrocity has no consequence after minute five. B is the only one that plays the villages, and it takes Beit Sahwan to six missions, one over the guideline. C makes the act about the people who were taken and needs no new mission | **C, whose first mission is A.** Hold B as a later addition — it slots in cleanly and disturbs nothing |
| **O-B** | **Does First Light stay 5 minutes?** | The chain has ten beats. Five minutes is 300 s, so a beat every 30–45 s | **Stay at 5.** The `survive_until 300` is the mission's spine, and the pair of measurements that make it a mission — passive DEFEAT at 4.5 min, plan VICTORY at 5.0 — are both pinned to it. Moving to 6 or 7 means moving `survive_until`, which re-opens both. Put the new material *inside* the existing clock, which is what §5.2 does |
| **O-C** | **Is a new mission added?** | Option B's `beit_sahwan_villages` | **Not now.** It is the best single piece of unbuilt Act I content and it should follow the act shipping, not delay it |
| **O-D** | **How graphic may the story voice be about the abductions?** | The lead's reference is an event with a real register. The shipped ceiling is *"nobody is coming back for them afterwards"* | **Stay at that ceiling.** Name what happened — *taken*, *across the line*, a number — and never a method, never a body, never a scene. The mechanics carry the weight: eleven placed, two counted, nine gone, and a score that only ever falls. `narrative-designer` should treat this as a hard limit, not a target |
| **O-E** | **Do the two removal verbs get built for Act I, or after it?** | §6.3 is a complete fallback | **After.** Author and prove the act first; the verbs land into a design that is already measured |
| **O-F** | **Does Pixi still have to be playable?** | `civilians` draws nothing on Pixi or `&nomesh`, and Act I places up to eleven of them in a mission that scores on them | The lead's. If yes, the `civilians` sheet (§8.1) is the act's one genuinely missing art asset and it is `blender-art` work |
| **O-G** | **Should Sur unlock on `beit_sahwan_4_subterranean` rather than `_3_clearance`?** | Today both Sur and Naharin unlock on III, so a player can finish the Marj's clearance and never meet Sahim | **Yes** — `storyline.md` §3.4 C1/C2. SPADE's end should be the act's end. One `world.json` edit |
| **O-H** | **Is `roe.fail_below` added to First Light?** | It has none today. III and IV have 40 | **No.** The opening mission of the war should be losable on the wire and the clock, not on the score. The bait is there — the mortar, the mosque tiles, the clinic — and it should cost the *campaign* (unlocks) rather than the mission |

---

## Appendix — the census this was written from

Run 2026-09-03 in `/Users/ilpinto/dev/roaring-lions-story` at `ff0808e`. Anything
not listed here was not checked this session.

```
git status --short; git log --oneline -5
ls data/units/kdf data/units/enemy data/units/civilians.json      # 14 + 15 + 1 = 30
ls art/meshes art/meshes/{vehicles,buildings,civilians,decor,vfx,campaign}
ls assets/{sprites,audio,ui,campaign}; ls data/vfx                # ui: 1 file; 15 emitters
python3 - <<'…'  data/maps/marj_perimeter.json                    # rows, markers, zones
python3 - <<'…'  data/maps/beit_sahwan_outskirts.json             # + tunnels
jq '.types|keys' data/structures.json                             # 8
jq -r '.objectives[].type' data/missions/*.json | sort | uniq -c  # 38 objectives, 9 types
jq -r '.ledger' data/missions/*.json                              # req/prod per mission
sed -n '265,268p' packages/sim/src/mission.ts                     # SUPPORTED: the nine
grep -n "kind ===" packages/sim/src/mission.ts                    # trigger on/do kinds
sed -n '1287,1360p' packages/sim/src/mission.ts                   # stepTriggers, stepWaves
sed -n '1420,1490p' packages/sim/src/mission.ts                   # every objective check
sed -n '655,700p'  packages/sim/src/mission.ts                    # evacuate_before setup
sed -n '1020,1105p' packages/sim/src/mission.ts                   # spawnPlacement, group/tag
sed -n '1108,1160p' packages/sim/src/mission.ts                   # stepRoe
cat packages/sim/src/civilians.ts                                 # CivilianFlight
sed -n '4418,4440p' packages/sim/src/sim.ts                       # collapseTunnel
sed -n '2517,2560p' packages/sim/src/sim.ts                       # stepSurfacing (weapons gate)
jq '.properties, .$defs.placement, .if, .then, .else' data/schemas/mission.schema.json
grep -n "civilians|in_tunnel|collapse|raze|refuge" tools/validate_data.mjs
grep -n "KNOWN_EVENTS" -A 6 tools/validate_audio.py               # six weapon events
grep -n "COMMANDER" packages/app/src/ui/hud.ts                    # :68, one hard-coded rank
grep -n "enemy reacts" -B4 -A6 packages/app/src/main.ts           # trigger id leaks verbatim
grep -n "civilians" packages/app/src/mesh-catalogue.ts            # mesh-only, 4 variants
pnpm playtest                                                     # 19 lines, exit 0
```

**Measured, not asserted** — every number in §5.1 and §7 III comes from the
`pnpm playtest` run above or from CLAUDE.md's recorded measurements, which are
cited where used.

**Not verified this session, and flagged as such:** whether any name added here
collides with a real public figure (`storyline.md` §2.4(3) — that check happens
outside this repo); the enemy detection timings that decide when the barrage
actually opens (§5.2, t=0 — marked *measurement required*); and any claim in
`docs/campaign/research-2026-09-03.md` not re-run above.
