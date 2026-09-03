# The campaign storyline

**Date:** 2026-09-03 · **Status:** proposal. Nothing here is canon until the lead
signs §0.
**Written against** `main` at `81406c7`, censused this session; every content
claim cites a path. **Read `docs/campaign/README.md` first** — it is the contract
this is written against and it holds the narrative-surface table referred to
throughout.

Downstream: `narrative-designer` (voice, briefings, GDD §11), `level-scripter`
(twists, ECA rows), `mission-author` (JSON).

---

## 0. Status and decisions

### 0.1 Taken by the lead

| # | Decision | Source | Consequence here |
|---|---|---|---|
| D1 | Protagonist **Shai Hammai**, company commander at First Light, promoted to Colonel ("a five-star colonel" — the KDF's own fictional insignia) | lead, 2026-09-03 | §2.1 ladder. The HUD constant is wrong for 9 of 14 shipped missions (§7 G2) |
| D2 | **Idit**, intelligence officer and First Light survivor, grows beside him and supplies the intel each mission | lead | §2.2. She is the voice of every `locate` and of `intel.marked_positions` |
| D3 | Shai and Idit are the **two voices of the HUD** | lead | Needs a speaker; there is exactly one, hard-coded (`packages/app/src/ui/hud.ts:68`) |
| D4 | **One villain per front**, atrocity at the front's opening, captured or killed at its end | lead | §2.3 — all three already exist mechanically |
| D5 | **EVA announcements, voice audio and a radio overlay are approved targets** | lead | §6.2; §7 G1, G4 |
| D6 | The **level scripter proposes in-level twists**, classified by what the runtime can do | lead | §3 — I propose, `level-scripter` classifies |
| D7 | The GDD needs a story section, kept by `narrative-designer` | lead | §8 |
| D8 | The campaign is a **fixed sequence**, not selectable fronts | `2026-08-21-campaign-storyline-design.md` D1 | §3.4 |
| D9 | **Static continuity, authored text only**; the ledger-conditioned layer is out | ibid. D4 | No line below branches on the ledger |
| D10 | War order **proximity → standoff → source** (Marj → Sur → Naharin) | GDD §2 | §1, §3.4 |
| D11 | Doctrine, never a people, a faith, a real place or a real insignia | GDD §2, `CONTRIBUTING.md` | §2.4 |

**One decision is now stale.** The 2026-08-21 spec's D3 was *"the story lives in
briefings and the title card — no new screens."* D5 approves a radio overlay and
a voice layer, which are new surfaces. Read it as retired, not quietly broken
(**O7**).

### 0.2 Decided by the lead on 2026-09-03 (answers to the open questions)

| # | question | decision | consequence |
|---|---|---|---|
| O1 | Protagonist spelling | **`Hammai`** — heard as Hammai / Hammai / Hammami; the lead chose Hammai | `ui/hud.ts:68` and every document here now read *Shai Hammai* |
| O2, O3 | Idit's spelling and surname | **Idit Zohar** | the name approved in `2026-08-21-commander-brief-design.md` is reused for the intel officer |
| O4, O5 | Villain handles | **Personal names in the fictional register the towns use**; the KDF case name stays as Idit's file handle | Marj: **Nadir Sahim** (SPADE). Sur: **Karim Adhal** (LANTERN). Naharin: **Jubran Hallaq** (FERRY). Each full name was web-searched the same day and matched no real public figure or armed-group figure; *Ghazi Tureim* was dropped because *ghazi* is itself a religious warrior title (GDD §2). Veto welcome |
| O6 | The KDF rank ladder as insignia | **Accepted**: stars on a plain khaki slip — Captain 2 · Major 3 · Lt Col 4 · Colonel 5 | §2.1 stands |
| O8 | Where to start | **From the beginning** — Act I, Beit Sahwan, in campaign order | the pipeline runs on the six shipped Beit Sahwan missions first (`docs/campaign/beit_sahwan/`); Umm Zeitoun and the other unbuilt plots wait |
| D12 | **The opening's chain of events** — the lead's structural reference is the surprise attack of 7 October 2023, transposed entirely into the fiction (GDD §2: no real name, place, date, flag, faith or people): a dawn surprise under rocket and mortar cover, the fence breached at many points, paramotors over the wire, the base and the villages hit at once, an outpost overrun, families killed and **abducted** with soldiers taken from the overrun positions, small groups holding alone, relief that comes late, and a war that opens as the search for the people who were taken | shown through mechanics and stated in the story voice, never depicted; the abductions become Act I's spine — see `docs/campaign/beit_sahwan/design.md` |
| D13 | **Act I is landed; move to Act II** (Sur: Tel Marum shipped, Umm Zeitoun to design) | lead, 2026-09-03 | `docs/campaign/tel_marum/design.md` is the Act II MDD; Karim Adhal's ending decides whether Umm Zeitoun is authored now or the act ends at the pass |
| D14 | **Act II is landed** (2026-09-03): the four Umm Zeitoun missions ship on `data/maps/umm_zeitoun.json`, `world.json` enforces proximity → standoff → source (Sur after Beit Sahwan IV, Naharin after Umm Zeitoun IV), Shai is a Major through the act and Karim Adhal ends on the crest | pipeline, measured by `pnpm playtest` | GH-122's content exists; the ending (O9) can now be written against a war with a middle; Act III (Naharin) is next |

### 0.3 Still open — for the lead

| # | open decision | in plain words | recommendation |
|---|---|---|---|
| O7 | Is "no new screens" retired? | An earlier spec said the story may only use screens that already exist (the deploy screen and the title card). You have since asked for a radio overlay, which is a new screen. The remaining question is whether to **also** build a debrief screen at the end of a mission where Shai and Idit close the story beat — today the end screen shows only a ROE number and a survivor count | **Build both.** The debrief is the cheaper half and the end of every mission is where the player has time to read |
| O9 | The ending | §5 Option 1 "Ari Actual" (the brigade is handed to Shai) · Option 2 "The Quiet Ground" (the ground is handed back) | can wait until Act III is re-briefed; nothing in Act I depends on it |
| O10 | A structure type named for a place of worship of a real faith (`roe_penalty` 30, on three maps) | GDD §2 says never a faith | the lead's; no beat here depends on it |

> **Two corrections found by census.**
> **(1)** `CLAUDE.md` ("Two ROE facts a visual check needs") says only `wadi_halam_basin`
> contains a mosque. **Three maps carry the `m` structure tile** — `beit_sahwan_outskirts` (9 tiles),
> `wadi_halam_basin` (9), `marj_perimeter` (4).
> `jq -r '.rows|join("")' data/maps/<id>.json | tr -cd 'm' | wc -c`
> **(2)** The README says "a new town is a schema edit". `mission.schema.json`'s
> `town` enum already holds all six GDD §2 towns. **Plots (a) and (b) need no
> schema edit at all**; only (c) does.

---

## 1. The war in one page

**The through-line.** *You begin holding a perimeter someone else chose, and you
end choosing what not to destroy.*

The old one — *"…and end demolishing a depot you chose, and it still is not
finished"* — was written when Sur was going to stay unbuilt and its absence was
the ending's meaning. Tel Marum shipped, so the war has a middle and therefore an
end, and the end must mean something other than incompleteness.

Across three acts the player's power rises monotonically — at First Light Shai
holds a compound with four rifle squads, two AT teams, a sniper, a mortar, an
engineer squad, one Eitan and one jeep
(`data/missions/beit_sahwan_breach.json`); by Break the Depot he is escorting a
bulldozer that levels a house by standing beside it. What carries the arc is that
the *question* changes:

- **Act I asks: can you hold?** Surprised, outnumbered, losing ground — and
  losing ground is the design (GDD §4, breach).
- **Act II asks: can you reach?** You are never surprised again and it does not
  help. `rocket_battery` is range 20, sight 6, so the battery fires on what
  someone else sees. Information is the weapon: kill the eyes and it goes blind.
- **Act III asks: can you stop?** You can level anything on the map, the corridor
  you are cutting is somebody's road and pasture, and the last mission hands you
  a D9 that destroys whatever it halts beside.

**The revenge-versus-restraint engine.** Shai's motive is authored, not asserted:
`beit_sahwan_breach` places **eleven civilians in four groups** with a primary of
`evacuate_before(compound, count 2, 270s)`. Two get in. Nine do not, and the
briefing says why — *"nobody is coming back for them afterwards."* His discipline
is ROE: 0–100, falling only, gating nine of fourteen KDF unlocks
(`unlock.roe_rating_min` 35–65) and losing the mission below `fail_below`. So the
campaign is a squeeze — what makes Shai fight would cost him the tools to fight
with.

**The villains' job is to close that squeeze**, each in his doctrine's register:
the digger fights from inside the houses, the observer puts his gun two tiles from
a protected block, the smuggler runs his road through a village. All three baits
are already authored (§2.3). This storyline needs no new mechanic for any of them
— it needs a name and a through-line attached to fights that exist.

---

## 2. Characters

### 2.1 Shai Hammai

1. A company commander in the 401st "Ari'im" Brigade, thirty-one, six years in,
   competent and unremarkable until the morning of First Light.
2. He was the senior officer left inside the compound when the perimeter went,
   which is how he came to command it — not by selection.
3. He got two families through the wire and nine did not come in. He has never
   said the number aloud and has never had to.
4. Not a talker. His half of a briefing is the plan and the cost: what moves,
   what it takes, what it will be billed for.
5. Promoted three times; each is somebody handing him a wider piece of the same
   problem. He celebrates none of them.
6. What he becomes is not braver — it is a man who can be handed a town and
   choose not to level it, which is the only thing the war tests.

**Orders voice** (unchanged from what ships): second-person imperative, present
tense, one concrete tile-level fact, closing on a cost. *"Bring back the picture,
not casualties."* — `tel_marum_1_recon`. No prowords.

**The rank ladder.** Promotions at act boundaries only, never mid-town. The KDF
marks rank in stars on a plain khaki slip; five is a Colonel, which makes the
lead's phrase literal and resembles no real force.

| missions | rank | stars | what earned it |
|---|---|---|---|
| `beit_sahwan_0_tutorial` | Captain | 2 | pre-war — the training area, before any of it |
| `beit_sahwan_breach` → `_1_recon` → `_2_foothold` → `_3_clearance` → `_4_subterranean` (Act I) | Captain | 2 | he holds the compound because nobody senior is left, and spends the act taking back the ground that was taken from him |
| **act boundary** | **→ Major** | **3** | **the Marj: the district's routes came down, with the man who dug them** |
| `tel_marum_1_recon` → `_2_foothold` → `_3_clearance`, then Umm Zeitoun ×4 (Act II, §4a) | Major | 3 | — |
| **act boundary** | **→ Lieutenant Colonel** | **4** | **Sur: the batteries stopped firing on Kedem's north** |
| `wadi_halam_1_fords` → `_2_laager` → `_3_counterraid` → `_4_village` → `_5_depot` (Act III) | Lt Col | 4 | — |
| **campaign end** | **→ Colonel** | **5** | **the corridor is cut and the brigade is his** (§5) |

**This ladder is why the HUD constant is a bug, not a placeholder.**
`ui/hud.ts:68` reads `const COMMANDER = { rank: 'Lt Col Shai Hammai', plate:
'Hammai' };` — correct for exactly the five Wadi Halam missions, wrong for the
other nine, so the player is told he is a Lieutenant Colonel while holding a
company at First Light. Fix is §7 G2.

### 2.2 Idit Zohar

1. An intelligence officer attached to the brigade, in the compound at First
   Light because that is where the map board was.
2. She spent that morning reading the attack off a radio net and a wall, telling
   Shai what was coming from which approach about ninety seconds before it
   arrived. That is the whole basis of the relationship.
3. She is why the war has a *picture*: ten of the thirty-six shipped objectives
   are `locate`, and every one is her asking a question.
4. She grows from the officer who could only report what she saw to the one who
   runs what the brigade knows. By Act III she chooses which questions are worth
   a life.
5. She never gives an order. Her half of a briefing is the picture and its
   confidence: what is known, how well, what knowing more costs.
6. She is the one who says the number Shai will not.

| Idit's thread | the mechanism | where |
|---|---|---|
| "here is the picture" | `locate` — completes when units carrying `target` are identified, or on `count` identifications | `packages/sim/src/mission.ts` `SUPPORTED`; 10 shipped |
| "here is what we carried out of last time" | `intel.marked_positions`. A tagged garrison recon identified **spawns pre-identified and forfeits its ambush** | produced by `beit_sahwan_1_recon`, `_4_subterranean`, `tel_marum_1_recon`, `wadi_halam_1_fords`, `_3_counterraid`; required by `beit_sahwan_3_clearance`, `_4_subterranean`, `tel_marum_2_foothold`, `wadi_halam_3_counterraid` |
| "this is what certainty costs" | the Intel resource — sweep 150, precision strike 250 | **barely exists.** One shipped mission declares any (`beit_sahwan_breach`, `intel_start: 60`); none declares a rate |

That last row shapes what `narrative-designer` can write: **Idit's voice cannot
lean on the Intel economy, because the campaign does not have one.** Her
mechanical surface is `locate` + `marked_positions`. Trading certainty for
logistics on screen needs an `intel_rate_per_min` in some missions first —
`mission-author` work, not writing (§7 G10).

### 2.3 The three villains

**All three already exist mechanically.** Each front's shipped missions contain a
named tagged HVT, a signature bait that pressures ROE, and a mid-arc presence
expressed as things the player finds. Nothing below invents a mechanic. Two need
**one new tagged placement each** to have an ending; the third needs none.

Characterised by doctrine, per GDD §2. Each carries a **personal name in the
fictional register the towns use** (O4/O5, decided 2026-09-03); the KDF **case
name** is Idit's file handle for him and the second thing the player hears.

**Nadir Sahim, file SPADE — the Marj Strip · Ashwar Front · *the digger***

| | |
|---|---|
| doctrine | tunnels, IEDs, ambush, human terrain. He prepared Beit Sahwan for years before the war reached it |
| **atrocity** | First Light itself, authored: 11 civilians in 4 groups outside the wire, a primary that counts **2** in, a briefing saying nobody is coming back for the rest |
| **mid-arc — what he *does*** | **II** spoil creeping west, and the `collapse(tunnel_mouth_west)` secondary. **III** his fire plan — `bs_hvt_atgm` on the east road, `bs_ambush_west_alley` and `bs_ambush_market_lane` in `ambush`, militia **inside the clinic block**. **IV** four routes under the district, one reopened by `bs4_digger` |
| **his bait** | the human terrain. `beit_sahwan_3_clearance` flags `clinic`, `fail_below: 40`, and already says fire near it *"will be billed for every second they can see it."* Shai wants to level the block; levelling it loses the mission |
| **his end** | Beit Sahwan IV, **+1 placement**; the existing `locate(bs4_digger)` is how you find him. Recommend **`capture`** of a 3×3 zone at the shaft head over `eliminate_hvt`: `capture` is live (10 s uninterrupted, contest resets), so "take him alive" works **today** with zero engine work and gives the prisoner theme its first beat without GH-18 |

**Karim Adhal, file LANTERN — Sur · Sarim Brigades · *the observer***

| | |
|---|---|
| doctrine | rockets, ATGMs, standoff. Not a gunner — `rocket_battery` is range 20, sight 6, so the battery fires on what someone else sees. LANTERN *is* the eyes |
| **atrocity** | told, not played: a week of rockets onto Kedem's north with nobody able to say from where. `tel_marum_1_recon` opens on it; `dispatch` makes it concrete — one settlement, one morning, off-map |
| **mid-arc** | he is never the man you kill. `tm_spotter_west` (a primary in II), `tm_spotter_narrow`, `tm_picket_wide`, `tm_manpad` are all his. `tel_marum_2_foothold` already carries the characterisation whole: *"he is not the only pair of eyes on that ground, so do not expect it to stop."* |
| **his bait** | `tel_marum_3_clearance` puts `tm_hvt_battery` two tiles from a flagged `town_block`, `fail_below: 45`. Counter-battery fire is the trap and the mission says so |
| **his end** | **Umm Zeitoun's last mission** (§4a), the front's climax per `2026-08-22-sur-front-design.md`. `eliminate_hvt`, not `capture` — an observer's doctrine is not being where you are looking. **Fallback if Umm Zeitoun is not authored:** +1 placement beside `tm_hvt_battery`, and Act II ends at the pass. Decide before `mission-author` starts |

**Jubran Hallaq, file FERRY — Naharin · Rif Cells · *the smuggler***

| | |
|---|---|
| doctrine | technicals, raids, smuggling, mobility. Not a commander — a logistician with guns. The charges under Beit Sahwan and the rockets over Tel Marum came up his road, which is why he is last (GDD §2) |
| **atrocity** | told at `wadi_halam_1_fords`: what he does to people of the corridor who stop carrying for him. **Shown** at `wadi_halam_4_village`, which already places 4 civilians, a protected block and a failable `evacuate_before(refuge, 3, 300s)` |
| **mid-arc** | `wh_hvt_amir` in III is his — a militia cell riding a technical, group `amir`, `casualties_pct(40) → withdraw_to rif_east`; the briefing calls catching him *"a mobility problem, not a firepower one."* `wh_hvt_cache` in IV is his quartermaster; the depot in V is his |
| **his bait** | the road, already written in full: the straight line east runs through the village and the D9 *"levels whatever it halts beside — the houses will come down one at a time with nobody ordering it, and each one is judged."* The southern road costs a little time and nothing else |
| **his end** | `wadi_halam_5_depot`, **needing no new placement at all.** `eliminate_hvt(wh_gate_rpg)`'s shipped text is *"Kill or capture whoever is holding the gate"* — already a voice naming a person without naming him. FERRY is the smuggler who will not leave his own gate. Re-brief only |

### 2.4 The naming rule

Binding on every proper noun added downstream.

1. **Place names** are fixed by GDD §2 and `data/campaign/world.json`. Coin no
   more without a world entry.
2. **An enemy carries a personal name in the towns' fictional register** — Nadir
   Sahim, Karim Adhal, Jubran Hallaq (decided 2026-09-03) — and a **KDF case
   name**, a plain noun in small caps assigned by Idit's section, as his file
   handle. Every personal name is screened under rule 3 before it is written down.
3. **A personal name must be checked** against a real public figure of that full
   name, a known figure of any real armed group, and the kunya pattern (`Abu …` /
   `Umm …` prefixed to a *person*), which belongs to real organisations. `Umm
   Zeitoun` is a toponym and already canon — a different use of the word, and fine.
4. **KDF personal names** sit in the register the materiel uses: Lavi, Namer,
   Eitan, Yahalom, Peten, Shoded, Ari'im, Kedem, Sahar.
5. **Never** a faith, ethnicity, nationality, real place or real insignia, either
   side. This binds hardest on voice lines — accent, language and idiom all carry
   it, and GH-110 already says write the rule before recording.

---

## 3. The acts and the mission ladder

Two tables per act, because the brief's columns do not fit one readable row.
**Table A** places the mission; **Table B** says what changes and what could
twist. All fourteen shipped missions appear.

Ledger keys, verbatim from the JSON: **R** `roster.surviving_units` · **M**
`roe.mission_ratings` · **C** `campaign.completed_missions` · **I**
`intel.marked_positions` · **E** `civ.settlements_evacuated`.

### 3.1 Act I — The Marj Strip · Ashwar Front · Beit Sahwan · Shai: **Captain**

| id | name | phase | rank | Idit's intel beat | SPADE's presence |
|---|---|---|---|---|---|
| `beit_sahwan_0_tutorial` | Beit Sahwan 0 — Working Up | recon | Capt (pre-war) | none — not yet attached | absent, deliberately |
| `beit_sahwan_breach` | Beit Sahwan — First Light | breach | Capt | she is *in* the compound, not on a net; the mission produces no `I`, and that is the point | **his atrocity**: 11 civilians, 2 counted in |
| `beit_sahwan_1_recon` | Beit Sahwan I — Recon | recon | Capt | her first picture: `locate` ×6 + the ATGM. Produces `I` | his fire plan, seen for the first time |
| `beit_sahwan_2_foothold` | Beit Sahwan II — Foothold | foothold | Capt | she reads spoil — disturbed earth as intelligence | he digs while you hold |
| `beit_sahwan_3_clearance` | Beit Sahwan III — Clearance | clearance | Capt | requires `I`; a thin recon means ambushes under fire | **his bait**: militia in the clinic block, `fail_below 40` |
| `beit_sahwan_4_subterranean` | Beit Sahwan IV — Subterranean | subterranean | Capt → **Major** at act end | her last question of the act: which crew is reopening the west route | **his end** |

| id | briefing today vs what must change | re-brief? | twist candidates |
|---|---|---|---|
| `_0_tutorial` | *"nothing you learn here is free later."* Already a training voice | **n** | — |
| `_breach` | Carries the atrocity in full. Needs the campaign's **opening `dispatch`** and nothing else — the orders voice must not gain narration | **y** (new field only) | **T1 "The families that did not get in."** At `timer_s(270)` the civilians still outside are killed, not merely left. Shai's motive shown, not asserted. Needs a `do.kind` that kills a named group — engine |
| `_1_recon` | *"what you find and who you bring home is what the brigade fights with next week"* — already states the carry-over | **n** | **T2 "The picture is old."** One `locate` target was abandoned days ago; the real cell is four tiles off. Expressible today — two tagged placements plus a `spawn` |
| `_2_foothold` | Already names the digging and the Yahalom | **n** | **T3 "The spoil was a decoy."** The western shaft is real and empty; the route under the line is a second one. Expressible today — two routes, one `collapse` target |
| `_3_clearance` | The clinic-block warning is the strongest ROE writing in the tree. Keep verbatim | **n** | **T4 "He is in the block."** SPADE is identified inside the flagged block and leaves during the fight — the player knows exactly where he is and cannot shoot there. Expressible today (tagged placement + `withdraw_to`) |
| `_4_subterranean` | Ends on routes, not a person. Must gain SPADE's capture as a primary and say so | **y** (+1 placement, +1 objective) | **T5 "A soldier under the road."** A `yahalom_squad` is taken when a route is identified — removed from the player's side, held as an HVT to reach before the last collapse. Needs player-side removal — engine |

**Ledger, as shipped.** `_0_tutorial` — / —. `_breach` — / **R M C**. `_1_recon`
**R** / **R M C I**. `_2_foothold` **R** / **R M C**. `_3_clearance` **R I** /
**R M C**. `_4_subterranean` **R I** / **R M C I**.

**Act I's shape is a story fact worth keeping.** Beit Sahwan runs phases 1, 2, 3,
5, 6 — **no build-up**. True rather than absent: the brigade got no breathing room
in the Marj. §4(b) puts that at risk and says so.

### 3.2 Act II — Sur · Sarim Brigades · Tel Marum · Shai: **Major**

| id | name | phase | rank | Idit's intel beat | LANTERN's presence |
|---|---|---|---|---|---|
| `tel_marum_1_recon` | Tel Marum I — The Gateway | recon | Maj | the densest intel mission in the game — **four `locate` primaries**, one explicitly *"whoever is spotting for the battery"*. Produces `I` | his network, seen whole for the first time |
| `tel_marum_2_foothold` | Tel Marum II — The Start Line | foothold | Maj | requires `I`; her finding is that killing one eye eases the shelling and does not stop it | **one of his** dies (`tm_spotter_west`); he replaces it |
| `tel_marum_3_clearance` | Tel Marum III — The Pass | clearance | Maj (→ Lt Col only after Umm Zeitoun) | the corridor's unwatched length — *"most of its length goes unwatched"* | **his bait** (battery two tiles from `town_block`, `fail_below 45`); **his gun** dies, he does not |

| id | briefing today vs what must change | re-brief? | twist candidates |
|---|---|---|---|
| `_1_recon` | *"Rockets have been falling on the north for a week and nobody can say from where."* That is his atrocity already. Needs only a `dispatch` naming the settlement | **y** (new field only) | **T6 "The eye is behind you."** On `zone_entered(valley_floor)` a `sarim_rifles` spawns *behind* the hollow. Expressible today |
| `_2_foothold` | *"he is not the only pair of eyes on that ground"* — already the exact characterisation | **n** | **T7 "He was never in the pocket."** The `eliminate_hvt` completes and the shelling does not ease for 30 s. Needs nothing new — the wave clock already does it; it needs *saying*, i.e. a `radio` line |
| `_3_clearance` | The two-routes briefing is measured and correct (pinned in `tools/src/tel_marum_doctrine.test.ts`). Only the ending changes | **y** if Act II ends here (+1 placement); **n** if Umm Zeitoun is authored | **T8 "The battery fires into its own town."** He drops a rocket into the block the player may not shoot into, and the ROE score does not move — the penalty is on the player, always. The purest statement of the bait. `spawn` can stage it; making a round *land* there needs sim work |

**Ledger, as shipped.** `_1_recon` **R** / **R M C I**. `_2_foothold` **R I** /
**R M C**. `_3_clearance` **R** / **R M C**.

> **A gap `mission-author` should close either way:** `tel_marum_3_clearance`
> requires only **R**, not **I**, so Act II's clearance does not read the recon
> the act spent two missions building — unlike `beit_sahwan_3_clearance`. One-line
> fix, real story consequence: it is the mission where Idit's work is meant to pay.

### 3.3 Act III — Naharin · Rif Cells · Wadi Halam · Shai: **Lieutenant Colonel**

| id | name | phase | rank | Idit's intel beat | FERRY's presence |
|---|---|---|---|---|---|
| `wadi_halam_1_fords` | Wadi Halam I — The Fords | recon | Lt Col | `locate` ×4 dispersal sites against an enemy who *"disperse the moment they are seen"*. Produces `I` | told, not seen — the corridor is named |
| `wadi_halam_2_laager` | Wadi Halam II — Grazing Ground | foothold | Lt Col | **none** — produces no `I` and requires none | his raiders, in waves |
| `wadi_halam_3_counterraid` | Wadi Halam III — The Cattle Track | buildup | Lt Col | requires `I`, produces `I`. The only build-up in the war | **`wh_hvt_amir` is his lieutenant** — flees at 40% casualties |
| `wadi_halam_4_village` | Wadi Halam IV — Wadi Halam | clearance | Lt Col | none | **his quartermaster** (`wh_hvt_cache`) and **his atrocity shown** |
| `wadi_halam_5_depot` | Wadi Halam V — Break the Depot | clearance | Lt Col → **Colonel** at campaign end | none | **his end** — `wh_gate_rpg` |

| id | briefing today vs what must change | re-brief? | twist candidates |
|---|---|---|---|
| `_1_fords` | *"Do not chase what runs."* Perfect. Needs Act III's `dispatch` | **y** (new field only) | **T9 "The riders are carrying."** One dispersing technical carries civilians, not fighters; killing it is the mission's ROE cliff. Expressible today only as a civilian group riding as `passengers` — `level-scripter` to confirm |
| `_2_laager` | *"the Rif know the ground as well as you do."* Fine | **n** | **T10 "The pump house is the cache."** What you hold is what he wants back, and he says so. Radio line only |
| `_3_counterraid` | Names the commander and the mobility problem; should say **whose** | **y** (text only) | **T11 "He is worth more talking."** `wh_hvt_amir` routs rather than dies and can be taken — the second prisoner beat, and the one that hands Idit the depot. Expressible **today** as a `capture` zone around a routed unit; properly, GH-18 |
| `_4_village` | The protected-block and ordnance warning is shipped and correct | **n** | **T12 "The cache guard is one of ours."** `wh_hvt_cache` is a KDF soldier taken at First Light and left holding the cache. Killing him is the ROE catastrophe and the campaign's cruellest decision. Needs a friendly-tagged HVT — schema field at least |
| `_5_depot` | The D9-and-the-village passage is the finest bait writing in the tree; **the HVT text already reads as FERRY.** Needs the campaign's `aftermath` | **y** (new field + a line naming him) | **T13 "The corridor runs both ways."** A wave arrives from the **west**, out of ground the player already took. Expressible today — a wave `from` a marker behind the player |

**Ledger, as shipped.** `_1_fords` **R** / **R M C I**. `_2_laager` **R** /
**R M C**. `_3_counterraid` **R I** / **R M C I**. `_4_village` **R** /
**R M C E**. `_5_depot` **R** / **R M C**.

### 3.4 Where Sur sits, and what `world.json` must change

**Sur sits after the Marj and before Naharin** — GDD §2's *proximity, standoff,
source*, and the only order §5's ending can be written against. Three changes to
`data/campaign/world.json`:

| # | change | why |
|---|---|---|
| C1 | **Naharin's `unlock.after_mission`: `beit_sahwan_3_clearance` → the last Sur mission** (`tel_marum_3_clearance` today; Umm Zeitoun's last if §4a is built) | Today **both** Sur and Naharin unlock on `beit_sahwan_3_clearance`, so a player can skip Sur entirely and nothing enforces the fixed sequence (D8) |
| C2 | **Sur's `unlock.after_mission` → `beit_sahwan_4_subterranean`** | The Marj should finish before the next front opens — SPADE's end is Act I's end. Proposed for Naharin by the 2026-08-21 spec for the same reason |
| C3 | **`planned: true` on `khan_rafid`, `deir_amun`, `umm_zeitoun`**, excluded from region progress | Without it the Marj cannot read complete on Beit Sahwan alone, and Sur reads complete on Tel Marum alone. **Censused: `world.schema.json` has no `planned` property.** All three towns carry `"missions": []` today |

---

## 4. The unbuilt content — three plots

Each poses a decision no shipped mission poses. All `target_minutes` are 5–7
(`mission.schema.json` caps at 7, one named exemption for the tutorial); all
objective types are among the nine the runtime runs; all unit and map ids resolve
or are marked **new**.

### 4.1 (a) Umm Zeitoun — Sur's climax · *"hunting eyes across open ground"*

**Distinguishing mechanic: the cost of a look.** Tel Marum is a pass — one axis,
two saddles, the puzzle is *forcing a gap*. Umm Zeitoun is a basin of dispersed
knolls with no chokepoint, several isolated peaks each holding an observer, and a
battery that displaces. The puzzle is *which knoll is worth the crossing*, against
a `manpad_team` (range 13, air-only) that makes the drone's free look expensive —
the shape `2026-08-22-sur-front-design.md` and GH-122 both scope. **The only plot
that closes Act II's villain.**

| # | id / name | phase | target | primaries (type · target) | secondaries | map | econ |
|---|---|---|---|---|---|---|---|
| 1 | `umm_zeitoun_1_recon` · *Cold Ground* | recon | 6 | `locate` · `uz_eyes` (count 4) | `survive_until` 240 | **new** `umm_zeitoun` | n |
| 2 | `umm_zeitoun_2_buildup` · *The Long Look* | buildup | 7 | `hold_for` · `staging` 300 | `capture` · `knoll_south` 15 | reuses | **y** |
| 3 | `umm_zeitoun_3_clearance` · *Blinding* | clearance | 7 | `eliminate_hvt` · `uz_observer_net`; `capture` · `basin_floor` 20 | `locate` · `uz_hvt_lantern` | reuses | n |
| 4 | `umm_zeitoun_4_clearance` · *The Stockpile* | clearance | 7 | `raze` · `stockpile` 300; `eliminate_hvt` · `uz_hvt_lantern` | `survive_until` 300 | reuses | **y** |

Phases ascend 2 → 4 → 5 → 5; foothold is skipped on purpose, and it is a story
fact — after Tel Marum the brigade already has its foothold in Sur. Mission 2 is
the war's **second** build-up, GDD §4's one phase with breathing room.

**Ledger.** 1 `R`/`R M C I` · 2 `R I`/`R M C` · 3 `R I`/`R M C I` · 4 `R I`/`R M C`.

**What separates mission 4 from `wadi_halam_5_depot`**, also a `raze`: there is no
D9 (`dozer_d9` gates at ROE 60 and Sur fields none), so the stockpile comes down
under `demo_squad` charges and tank fire while `manpad_team` and
`recoilless_team` price every approach. The decision is *what to bring*, not
*which road to take*.

**Cost:** one new 48×48 map (arid, relief) + four missions. **Closes GH-122.**

### 4.2 (b) Khan Rafid and Deir Amun — completing the Marj

**Distinguishing mechanic: keeping a town, not taking one.** Khan Rafid is the
Marj's dense enclave and it is inhabited. `evacuate_before` is a **primary** — one
of only three types that can *fail* — with a high `fail_below`. The player is not
asked whether he can win but how much of the town he still has when he does. Only
two shipped missions use `evacuate_before` at all, and only `beit_sahwan_breach`
as a primary. **This is Shai's second chance at what he failed at in mission
one**, and the strongest story beat available anywhere in the tree. Deir Amun is
GH-19's asked-for subterranean showcase: the whole map is the network, and
`collapse` carries a deadline.

| # | id / name | phase | target | primaries | secondaries | map | econ |
|---|---|---|---|---|---|---|---|
| 1 | `khan_rafid_1_recon` · *House Numbers* | recon | 6 | `locate` · (count 5) | `locate` · `kr_hvt_ward` | **new** `khan_rafid` | n |
| 2 | `khan_rafid_2_foothold` · *The Ward* | foothold | 7 | `hold_for` · `ward` 300; `evacuate_before` · `refuge` (count 4) 300 | `capture` · `market` 15 | reuses | **y** |
| 3 | `khan_rafid_3_clearance` · *What You Keep* | clearance | 7 | `capture` · `old_town` 20; `evacuate_before` · `refuge` (count 6) 300 | `eliminate_hvt` · `kr_hvt_ward` | reuses | n |
| 4 | `deir_amun_1_recon` · *Read the Ground* | recon | 6 | `locate` · `da_routes` (count 4) | `survive_until` 240 | **new** `deir_amun` | n |
| 5 | `deir_amun_2_foothold` · *Set the Charges* | foothold | 7 | `hold_for` · `shaft_head` 300 | `capture` · `pump` 15 | reuses | **y** |
| 6 | `deir_amun_3_subterranean` · *All Four* | subterranean | 7 | `collapse` · `district` 300; `destroy_all` | `survive_until` 300 | reuses | **y** |

Phases ascend within each town (2/3/5 and 2/3/6). Ledger chains across the whole
Marj as GH-19 asks: each requires `R` (+`I` from the mission before) and produces
`R M C` (+`I` on the two recons and the subterranean); Khan Rafid 2 and 3 also
produce `E`.

**The cost the lead must accept.** Mission 5 is a foothold, not a build-up,
because a Marj build-up steals a line: the 2026-08-21 spec wrote the Marj's
*missing* build-up as meaningful and made `wadi_halam_3_counterraid` "the only
breathing room the brigade ever gets." **Keep it a foothold** — the Marj having
no rest is a better fact than a sixth mission having a build-up. If the lead
prefers the build-up, the Cattle Track's line is rewritten in the same commit.

**Cost:** two new 48×48 maps + six missions. The largest of the three.

### 4.3 (c) Qarn Hadid — the two gates · *the plot nobody asked for*

**The map exists and nothing uses it.** `data/maps/qarn_hadid.json` — 48×48,
`terrain: arid`, elevation 0–7 (every other map tops out at 4), the **only** map
carrying all ten terrain symbols and the only place cover-3 and the anti-tank
ditch `d` are authored at all. Markers `kdf_start south_plain shoulder_gate
saddle_gate north_junction village_square knoll_top scree_south scree_north
hollow_floor east_post civ_refuge`; zones `village clinic the_gates hollow scree
south_staging the_terraces`. Measured and pinned in
`tools/src/qarn_hadid_relief.test.ts`. No mission uses it.

**Distinguishing mechanic: your force arrives in two pieces.** The rock wall has
two ways through — a high shoulder gate and a low saddle notch — and the ditch
seals the cheap one to armour while the scree splits the eastern flank (foot 8
tiles, vehicle 20). Every route has a **different cost per domain**, measured
through the real `FlowField`. No shipped mission poses that: Tel Marum's boulder
corridor makes the split *optional*; here it is structural. Infantry arrives first
and alone, or armour goes the long way and the infantry waits.

Fiction: the pass road **between** Tel Marum and Umm Zeitoun — Sur's third town,
an interlude inside Act II, where Shai first has to divide a force he has only
just been given.

| # | id / name | phase | target | primaries | secondaries | map | econ |
|---|---|---|---|---|---|---|---|
| 1 | `qarn_hadid_1_recon` · *Both Gates* | recon | 6 | `locate` · `qh_gate_watch` (count 3); `hold_for` · `south_staging` 180 | `survive_until` 240 | reuses **`qarn_hadid`** | n |
| 2 | `qarn_hadid_2_foothold` · *The Shoulder* | foothold | 7 | `hold_for` · `the_gates` 300 | `capture` · `hollow` 15 | reuses | **y** |
| 3 | `qarn_hadid_3_clearance` · *The Terraces* | clearance | 7 | `capture` · `village` 20; `eliminate_hvt` · `qh_hvt_relay` | `evacuate_before` · `civ_refuge` (count 3) 300 | reuses | n |

Phases ascend 2 → 3 → 5. Every marker and zone named resolves in the shipped map.
`civ_refuge` at `[10,43]` is a marker, so the `evacuate_before` zone must be
authored around it — the runtime throws if the refuge marker is not inside the
arrival zone (`packages/sim/src/mission.ts:682`).

**Cost:** three missions, **zero new art**, and the only schema work in the three
plots: `qarn_hadid` into `mission.schema.json`'s `town` enum, a town entry under
Sur in `world.json`, one line in GDD §2's town list.

*Variant, if the lead prefers a post-campaign hook to a third Sur town:*
`data/campaign/countries.json` names five regions with no fiction at all — Amar
Steppe, Rimon Hills, **Kharat Badlands**, Zol Erg, Milh Flats. Kharat is the
obvious far end of FERRY's corridor: a one-mission epilogue on `qarn_hadid`, after
the ending, about where the road went.

### 4.4 Recommended order of authoring

**(a) Umm Zeitoun → (c) Qarn Hadid → (b) Khan Rafid and Deir Amun.**

1. **(a) first, because the war has no middle without it.** Sur is a live region
   with one town, LANTERN has no ending, and the war order the setting rests on
   (D10) is not playable until Sur is more than a gateway. Closes GH-122.
2. **(c) second, because it is nearly free.** A complete, measured, test-pinned
   48×48 relief map sits in the tree used by nothing; three missions and a schema
   enum value is the best content-per-hour ratio available, and it gives Act II
   the three-town weight Act I has.
3. **(b) last: two maps and six missions**, and the campaign has a coherent ending
   without it. It is also the only one that can damage something already written
   (§4.2).

**The honest counter-argument, so the lead can overrule me:** (b)'s Khan Rafid
carries the strongest emotional beat in the proposal. If the lead wants the
story's best moment first, (b) is it, at the price of two new maps.

---

## 5. Endings

Both end on the Colonel promotion; both are `aftermath` on the campaign's last
mission, `wadi_halam_5_depot` today. Story voice, not orders voice.

### Option 1 — *"Ari Actual"* **(recommended)**

The corridor is cut; Sur has been quiet since the batteries stopped and the Marj
since the winter. Brigade signs Shai's file the same hour of the same day the war
started, and what he is given is the 401st itself — the brigade whose company he
held a compound with in mission one. The last beat is Idit handing him the
callsign she used to hand him picture on: **Ari Actual**, an approved fictional
asset (`2026-08-21-commander-brief-design.md`), so the ending reuses canon rather
than inventing it. It lands on a person the player knows rather than a narrator,
and the promotion is written on his ROE rating — what he protected, not what he
took.

> `aftermath` — 234 chars
> *"The corridor is cut. Brigade signed it at first light, the same hour it started. They are giving you the Ari'im — the whole of it, not a company in a yard. Idit hands you the callsign herself. Ari Actual. Five stars, and quiet ground."*

### Option 2 — *"The Quiet Ground"*

The war ends with a handover, not a promotion. Shai is made Colonel and the first
thing he does with it is give the ground back — the towns pass to a civil
authority and the brigade goes home. The closing image is the Beit Sahwan compound
a year on, wire down, road open at night. Stronger on restraint, weaker on
revenge: it closes the loop on the families rather than on the men who took them.

> `aftermath` — 203 chars
> *"They took the wire down at Beit Sahwan this morning. Nobody fired a shot to make that happen — you spent a year not firing them. Colonel's slip in the post, five stars, and a road you can drive at night."*

---

## 6. Asset manifest

Every row is **PRESENT (path)** or **MISSING (gate + pipeline)**. Gate names are
the ones in `package.json`.

### 6.1 Per act — what the shipped missions already draw

Verified: 28 of 30 unit types are fielded by some shipped mission. `heli_peten` is
fielded by none; `civilians` arrives through the `civilians` block, not a
placement. **Structures** — all 8 (`shanty house apartment warehouse concrete wall
mosque camp`) are PRESENT in `data/structures.json` with idle + wreck GLBs in
`art/meshes/buildings/`. **VFX** — all 15 PRESENT in `data/vfx/`, including
`tunnel_collapse.json` and `structure_collapse.json`. **Decor** — all eight
families PRESENT in `art/meshes/decor/`.

| act | units (all PRESENT) | maps |
|---|---|---|
| **I — Marj** | KDF `inf_squad at_team mortar_team apc_eitan jeep_shoded recon_drone ifv_namer mbt_lavi demo_squad yahalom_squad sniper_team`; Ashwar/Rif `militia_cell rpg_team mortar_crew digger_crew charge_squad paramotor technical moto_rpg gun_truck atgm_cell loiter_drone` — `data/units/kdf/`, `data/units/enemy/` | `data/maps/marj_perimeter.json`, `beit_sahwan_outskirts.json`, `tutorial_ground.json` — **PRESENT** |
| **II — Sur** | adds `sarim_rifles recoilless_team manpad_team rocket_battery` | `data/maps/tel_marum.json` — **PRESENT**. `umm_zeitoun` — **MISSING**; gate `pnpm validate:data`; pipeline: hand-authored JSON |
| **III — Naharin** | adds `dozer_d9` (`art/meshes/vehicles/dozer_d9.glb`) | `data/maps/wadi_halam_basin.json` — **PRESENT** |
| **(c) Qarn Hadid** | no new units | `data/maps/qarn_hadid.json` — **PRESENT, unused** |

**No act needs new art for units, structures, terrain or effects.** The whole
missing surface is the narrative layer.

### 6.2 The narrative layer — exhaustive

| row | status | gate | pipeline |
|---|---|---|---|
| Commander data (`data/campaign/commander.json`: Shai, Idit, rank ladder, per-mission rank and speaker) | **MISSING** | `pnpm validate:data` — needs a new `data/schemas/commander.schema.json` **and** a line in `tools/validate_data.mjs`, which names `world.json` and `countries.json` individually (`data/campaign` is a "mixed directory") | hand-authored JSON — `mission-author` |
| Shai portrait (`assets/ui/shai_portrait.png`, 512×640) | **MISSING** | **no gate** — `tools/validate_assets.py` defaults to `--sprites assets/sprites` (line 315), so `assets/ui/` is ungated, same footing as `menu_banner.jpg` | generative, PR disclosure required (`CONTRIBUTING.md`); art brief exists in `2026-08-21-commander-brief-design.md` |
| Idit portrait | **MISSING** | no gate | as above |
| Villain portraits ×3 | **MISSING** | no gate | as above. **Must not resemble a real person and must carry no real insignia** |
| KDF rank insignia, 2–5 stars | **MISSING** | no gate; `pnpm validate:ui` applies if drawn in CSS (no colour literals) | vector; **must resemble no real force** (O6) |
| Faction marks ×3 (Ashwar, Sarim, Rif) | **MISSING** | no gate | vector. The only insignia shipping today is `assets/campaign/flag_brigade.png` (KDF) — **PRESENT** |
| Radio overlay art (frame, speaker plate, portrait slot) | **MISSING** | `pnpm validate:ui` | CSS + `packages/render` — `render-vfx` |
| Debrief screen | **MISSING** | `pnpm validate:ui`, `pnpm test` | `ui/menu.ts` `showEndScreen` (line 341) has zero authorable text today |
| EVA announcement set (objective complete/failed, unit lost, reinforcements) | **MISSING** | `pnpm validate:audio` — **fails by construction today**: `tools/validate_audio.py`'s `KNOWN_EVENTS` is `{fire, penetration, ricochet, near_miss, aps_intercept, destroyed}`, all weapon/impact. A voice set has no known event | GH-110; gate must widen first (§7 G4) |
| Shai voice lines (briefing beats, radio) | **MISSING** | `pnpm validate:audio` — every variant needs a redistribution-safe licence **and** a source URL | GH-110 |
| Idit voice lines | **MISSING** | same | GH-110 |
| Villain voice lines ×3 | **MISSING** | same | GH-110. **§2.4(5) binds hardest here** — accent, language and idiom carry ethnicity |
| Unit acknowledgement barks, keyed by role | **MISSING** | same | GH-110 |
| Music | **MISSING** | `pnpm validate:audio` | GH-133 — out of scope here |
| `dispatch` / `aftermath` / `debrief` text | **MISSING** (fields do not exist) | `pnpm validate:data` | schema + `mission-author` (§7 G3) |
| `say` / `speaker` on triggers and objectives | **MISSING** | `pnpm validate:data`; `pnpm test:determinism` unmoved | `sim-guard` (§7 G1) |
| `planned` flag on a town | **MISSING** | `pnpm validate:data` | `sim-guard` / `app` (§7 G5) |

Existing audio for reference: 11 sets, all weapons and impacts, 31 `.ogg` + 31
`.m4a`, CC0 from `tools/gen_audio.py`. **No voice, dialogue, narration or music
exists.**

---

## 7. Engine and schema gaps this storyline depends on

Ordered by how much of the storyline each blocks.

> **Status 2026-09-03 (later):** Act II shipped on the engine slice below — see D14.
>
> **Status 2026-09-03 (evening):** G1 (`say`, as a `MissionEvent` into the notice
> feed and the commander bar), G2 (`data/campaign/commander.json`, rank per
> mission), G3 (`dispatch`, `aftermath`, `debrief`) and G7's `remove` verb with
> `group` on `starting_force` **landed** on main — see
> `docs/superpowers/specs/2026-09-03-narrative-layer-engine-design.md`. The radio
> overlay's art, G4, G5, G6, G8, G9 and G10 stand as written.


| # | gap | smallest proposal | owner |
|---|---|---|---|
| **G1** | **No speaker, and no mid-mission line at all.** D3 wants two voices; there is one, hard-coded, and nothing can speak after the deploy screen — `stepTriggers` fires and the player sees only `enemy reacts (<trigger id>)` | `say: { speaker, text }` on `triggers[].do` and `objectives[]`, emitted as a new `MissionEvent` kind. **No sim state changes**, so invariant 4 holds and the determinism hash cannot move. Copy the tutorial's step machine (`title`/`teach`/`nudge` + `await`) — it is the working precedent | `sim-guard` (schema, emit) + `render-vfx` (overlay) |
| **G2** | **The commander is a TypeScript constant with one rank**, printed in all fourteen missions; §2.1 says it is right in five | `data/campaign/commander.json` — people, the ladder, a per-mission `{speaker, rank}`; `hud.ts` reads it. CLAUDE.md's "content is JSON" rule is exactly this case, and the commander-brief spec already asked for the file | `mission-author` (data) + `render-vfx` (`hud.ts`, `loading.ts`) |
| **G3** | **No story voice anywhere.** `dispatch`, `aftermath`, `debrief` do not exist; the end screen has no authorable text | Three optional strings. `dispatch` → title card with a longer hold (`titleCard` is `holdMs = 900`, `ui/motion.ts:49`, and dismisses on any input); `aftermath` → victory banner; `debrief` → end screen. All specced 2026-08-21 but `debrief`, which the README marks **needed** | `sim-guard` (schema) + `render-vfx` |
| **G4** | **The audio gate cannot accept a voice file.** Every audio row in §6.2 is blocked on it — the whole of D5 | A non-weapon set kind and its events (`objective_complete`, `objective_failed`, `unit_lost`, `reinforcements`, `line`). Licence and source-URL checks stay — they are that gate's load-bearing half | `render-vfx` + `content-validator`; GH-110 |
| **G5** | **A town cannot say it is unwritten**, so progress reads the Marj complete on one town of three, Sur on one of two | `planned: true` on a town, excluded from `regionProgress`; and fix `nextMissionAfter`'s dead end at a town boundary. Both specced 2026-08-21, neither built | `sim-guard` (schema), `app` (`campaign.ts`) |
| **G6** | **A trigger cannot fire on an objective, and cannot see the sim.** Only waves take an objective id; most §3 twists want one or the other | Two `on.kind`s — `objective` (an objective id) and `sim` (one of the 24 `SimEvent` kinds). The tutorial's `await` already gates on every `SimEvent`, so the predicate is reused, not written | `sim-guard` |
| **G7** | **The execute and abduction twists (T1, T5, T12) have no verb.** `do.kind` is `commit / withdraw_to / spawn / reinforce / dismount` — nothing removes or kills | Two symmetric verbs: `remove` (a group leaves play — abduction; `reinforce` already writes to the player's side, so this is its mirror) and `execute` (a named civilian group dies). Both are commands on a tick boundary, so determinism holds. **T12 also wants a friendly-tagged HVT** — a schema field on a placement | `sim-guard` |
| **G8** | **Taking a villain alive is a zone hold, not a capture of him.** GH-18 is M2; GDD §5.5a says prisoners score ROE credit where kills score nothing — exactly this storyline's restraint theme | **Do not wait for it.** `capture` is live (10 s uninterrupted zone hold), so SPADE's end and T11 work today as a small zone around where he stands, and upgrade in place when GH-18 lands | `mission-author` now; `sim-guard` for GH-18 |
| **G9** | **`mark`, `escort`, `no_collateral_above` throw.** `escort` is the obvious shape for T5 and for a D9 mission | Out of scope; recorded so nobody authors one by reading the schema. `SUPPORTED` (`packages/sim/src/mission.ts`) lists exactly nine (GH-2, GH-4) | `sim-guard` |
| **G10** | **No Intel economy for Idit to spend.** One mission declares `intel_start`; none declares a rate | An `intel_rate_per_min` on Sur and Naharin missions, so the sweep (150) and precision strike (250) are choices rather than lore. Content, not engine | `mission-author` |
| **G11** | **`debrief` is one string shown on every mission end**, where `aftermath` shows on victory only, so a debrief cannot say different things for a win and a loss and the paired Shai/Idit lines in the Act I sheet stay `engine` | `debrief_victory` / `debrief_defeat` (or `debrief: { victory, defeat }`), read by `showEndScreen` off `missionEnd.result` | `sim-guard` (schema) + `render-vfx` (`ui/menu.ts`) |

---

## 8. Proposed GDD §11 — *Story* (ready to paste, 278 words)

> ## 11. Story
>
> The campaign follows one officer. **Shai Hammai** is a company commander in the
> 401st "Ari'im" Brigade on the morning the Marj comes across the wire at Beit
> Sahwan. He is the senior officer left inside the compound, which is how he comes
> to be holding it. He gets two families through the wire before the ring closes.
> Nine do not come in.
>
> Beside him is **Idit Zohar**, an intelligence officer in the same compound that
> morning. She grows with him and supplies the picture in every mission; he
> decides, and she never gives an order. They are the campaign's two voices.
>
> The war runs in the order the geography sets — **proximity, then standoff, then
> source**: the Marj Strip, then Sur, then Naharin. Shai is promoted at each
> boundary, Captain to Major to Lieutenant Colonel, and ends the war a Colonel
> with the brigade. The KDF marks rank in stars on a plain slip; a Colonel wears
> five.
>
> **Each front has one adversary, defined by his doctrine and never by a people** —
> the digger in the Marj, the observer in Sur, the smuggler in Naharin. Each opens
> his front with an atrocity and ends it captured or killed. Each fights from
> behind something the player is forbidden to destroy, because the campaign's
> engine is a squeeze: the dead of First Light are Shai's motive, rules of
> engagement are his discipline, and the rating that gates his equipment is the
> same number that measures his restraint.
>
> *You begin holding a perimeter someone else chose, and you end choosing what not
> to destroy.*
>
> *(Recommended plot for the unwritten front: Umm Zeitoun as Sur's climax —
> `docs/campaign/storyline.md` §4a.)*

---

## Appendix — the census this was written from

Run 2026-09-03 against `81406c7`. Anything not listed was not checked.

```
ls data/units/kdf data/units/enemy data/units/civilians.json     # 14 + 15 + 1 = 30 types
ls art/meshes art/meshes/{vehicles,buildings,decor,civilians,campaign,vfx}
ls assets/{sprites,audio,ui,campaign,textures,fonts}             # ui: 1 file. no voice.
jq -r '.id' data/maps/*.json                                     # 6 playable + 4 tile studies
jq -r '.types|keys[]' data/structures.json                       # 8
jq -r '.objectives[].type' data/missions/*.json | sort | uniq -c # 36 objectives, 9 types
grep -n "kind ===" packages/sim/src/mission.ts                   # trigger on/do kinds
sed -n '265,268p' packages/sim/src/mission.ts                    # SUPPORTED: the nine
jq -r '.properties.town.enum' data/schemas/mission.schema.json   # all six towns already
jq -r '.rows|join("")' data/maps/<id>.json | fold -w1 | sort -u  # symbols per map
grep -n "COMMANDER" packages/app/src/ui/hud.ts                   # :68, one hard-coded rank
grep -n "showEndScreen" -A 30 packages/app/src/ui/menu.ts        # :341, no authorable text
grep -n "KNOWN_EVENTS" -A 4 tools/validate_audio.py              # six weapon events
grep -n "assets/sprites" tools/validate_assets.py                # :315, assets/ui ungated
grep -n "holdMs" packages/app/src/ui/motion.ts                   # :49, titleCard 900 ms
```

**Not verified this session, and flagged as such:** whether any villain personal
name in **O5** collides with a real public figure (§2.4(3) — that check happens
outside this repo), and any claim in `docs/campaign/research-2026-09-03.md` not
re-run above.
