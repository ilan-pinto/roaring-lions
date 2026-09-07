# Qarn Hadid — Narrative Trigger Sheet

**Act II · Sur · Sarim Brigades · the pass road between Tel Marum and Umm
Zeitoun. Shai Hammai is a Major throughout, and is not promoted here.**

**Date:** 2026-09-07 · **Status:** authored text waiting on two things — the
lead signing `design.md` §8, and `mission-author`, who owns
`data/missions/qarn_hadid_*.json`, every field in them, `world.json`,
`commander.json` and the map's one new marker. **Nothing in this pass was
applied to any file.** The three mission JSONs do not exist yet; `qarn_hadid`
is not in `mission.schema.json`'s `town` enum; the town is not in
`world.json`. Writing text into a tree that cannot hold it is how a sheet
starts lying about itself.

**Written against** `feat/story-act-1` in `/Users/ilpinto/dev/roaring-lions-story`.
Every schema shape below was read from `data/schemas/mission.schema.json` this
session rather than recalled; every map id, marker, zone, elevation and terrain
symbol was read from `data/maps/qarn_hadid.json`; every seat count, sight range
and weapon range was read from `data/units/**`; every briefing was split with a
port of `briefingBeats` (`packages/app/src/ui/loading.ts`) rather than counted by
eye. Route, cost and sight figures are **quoted from `design.md` §3.2 and §3.3
and not re-derived** — that document measured them through the real `FlowField`
and the real detection path and pairs each one against a control.

**Contract:** `docs/campaign/README.md`. **Canon:** `docs/campaign/storyline.md`
§0.2, §2.1–§2.4, §3.2, §4.3. **Upstream:** `docs/campaign/qarn_hadid/design.md`
— Option A *"The Two Gates"*, §0 decisions, §4 ladder, §5 per mission and story
hooks, §5.4 Karim Adhal's table. **Neighbours, for continuity of voice and
thread:** `docs/campaign/tel_marum/narrative.md` (which covers Tel Marum I–III
and Umm Zeitoun I–IV; there is no separate `umm_zeitoun/` directory — censused
this session, `docs/campaign/` holds `beit_sahwan`, `qarn_hadid`, `tel_marum`,
`wadi_halam` and nothing else).

**Downstream:** `mission-author` (three mission files, `dispatch`, `debrief`,
every `say`, `world.json`, the `clinic_yard` marker), `level-scripter` (trigger
ids and bindings, §8), `render-vfx` (radio overlay, portraits, the `evacuated`
toast), `sim-guard` (§10), `content-validator`.

---

## 0. How to read this sheet

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | the surface exists in shipped code and the text can reach a player the moment `mission-author` pastes it |
| `schema` | the field is specced and the runtime ignores it |
| `engine` | the surface is an approved target with no implementation — the radio overlay's art, `eva`, `bark`, a trigger that can watch a `SimEvent`, a briefing that can branch on the ledger, or any hard-coded toast string |

Every row's rightmost cell is one of those three words. The count is §12.

**`schema` is 0 in this arc**, as it is in Act II's, and for the same reason: the
narrative engine slice of 2026-09-03 and 2026-09-06 landed everything an
authored line needs. Verified in this worktree, not recalled —
`mission.schema.json` `$defs.say` is `{speaker ∈ {shai, idit, net, enemy}, text
≤ 240}` and is referenced by `objectives[].say`, `objectives[].say_on_fail`,
`triggers[].say`, `enemy.waves[].say`, `debrief.victory` and `debrief.defeat`;
`dispatch` and `aftermath` are plain strings capped at 240. What is still
`engine` is what a line *looks* like, not whether it arrives.

### 0.2 The two voices, and why the JSON reads as one

The deploy screen and the commander bar carry one speaker at a time and the
`briefing` is a single string, so in the JSON the briefing is Shai's orders voice
end to end. In **this sheet** each briefing is a two-hander with one speaker per
beat, because that is how it must be written and read aloud even where the
surface cannot show it. The `say` lines carry a real `speaker` field, so Idit,
the net and the enemy speak in their own right inside a mission.

Beat boundaries below are **not editorial.** They are what `briefingBeats`
produces from the string — at most two sentences and 240 characters, whichever
comes first — checked with a port of that function. Each briefing's full string
is printed whole under its beat table, exactly as it should be pasted.

### 0.3 The villain

**Karim Adhal**, KDF file **LANTERN** — *the observer* (`storyline.md` §2.3).
His end is `umm_zeitoun_4_clearance` and **nothing here may pre-empt it**
(`design.md` D13/D14). He is not on this map in person, there is no
`qh_hvt_lantern`, and no objective, `say` or `debrief` in this arc claims him.

His atrocity was told a town ago, in `tel_marum_1_recon`'s `dispatch`, and
Qarn Hadid does **not** add a second one. What it adds is his signature —
three objects and one act:

| mission | what he did | where the player meets it |
|---|---|---|
| **I** | put a tube on the floor of the one bowl on the map nothing can see into, and its eyes eight tiles forward on a boulder bench | rounds on the pass road with nobody visible to have called them; and `they_move_the_road_party_off`, which is the closest this arc comes to an atrocity and is a **removal**, not a killing |
| **II** | poured four tiles of concrete across the only gate armour can use, before the brigade was in Sur | a five-minute engineering job under fire, while his garrison walks to the other gate |
| **III** | left a mast on a blind hill above the only road into the town, and an anti-tank ditch through that town's own fields | the last climb, and a clinic yard filling with people who live on the wrong side of his obstacle |

**He does not speak in this arc.** The one line written for him is **HELD** and
the argument is §4.

### 0.4 The rule that binds every line here

**Doctrine, never a people.** No real place, faith, ethnicity, nationality,
accent, idiom or insignia, on either side. The Sarim Brigades are standoff —
rockets, ATGMs, the best-trained infantry on the board — and nothing else. No
line in this sheet gives a population to a faction: the four on the pass road and
the families in the village are people who live on a road two armies are fighting
over, and the text says only that. The village is never *his* village and the
ditch is never cut through *his own* fields; it is cut through the fields of a
town he was not defending, which is the whole point and is also the only way to
say it.

**No new proper noun is coined anywhere in this arc.** *Qarn Hadid* is already
canon (`storyline.md` §4.3, `data/maps/qarn_hadid.json`, whose own `name` is
*"Qarn Hadid — The Two Gates"*), and `design.md` C2 gives it its `world.json`
entry. Every other name on the page — the shoulder, the notch, the terraces, the
hollow, the scree, the olive grove, the clinic — is a **feature**, not a place
name, and resolves to a marker or a zone in that file. This binds hardest on the
`eva` and `bark` rows, which are the ones that would be recorded (GH-110).

### 0.5 What this arc can say, and what it still cannot

| | |
|---|---|
| **can, today** | a line on an objective completing, an objective **failing**, a trigger firing or a wave arriving, in four voices, reaching the notice feed and the commander bar; `dispatch` on the title card; `aftermath` on the victory banner; a `debrief` that tells a win from a loss |
| **cannot** | a trigger cannot fire on a `SimEvent` or on an objective, so every line bound to *"the drone died"* or *"that gate opened"* is on a clock or on `casualties_pct` instead (§10 G-E) |
| **cannot, and it is this arc's own gap** | **a briefing cannot branch on the ledger.** Mission III's picture genuinely differs by what mission I found, and `briefing` is one static string. §9 writes both clauses, the engine proposal, and the single fallback that ships |
| **cannot** | a civilian reaching the refuge is silent — `describeMissionEvent` has no `evacuated` case. This arc scores on civilians in **two of three** missions (§10 G-H) |

### 0.6 One decision recorded before the text, because it breaks a shipped pattern

**Mission I carries a `dispatch`, and three shipped missions carry one:
`beit_sahwan_breach`, `tel_marum_1_recon`, `wadi_halam_1_fords` — the first
mission of each act.** Censused this session. Qarn Hadid I would be the fourth,
and it is the first that opens neither an act nor a front.

**Written and recommended anyway**, for one reason: the arc's premise is a road
nobody ever fought for, priced by a machine before anybody arrived, and that is a
story fact. Shai cannot say it without the orders voice starting to narrate, and
`README.md` rule 1 forbids exactly that. The line is four sentences, names no
man, and cannot be mistaken for an act opening — it opens onto a road, not onto a
dead settlement.

**The zero-risk alternative, if the lead wants dispatch kept to act openings:**
cut it, and let the briefing's beat 1 absorb the two weeks as a situation clause.
That costs the arc its only story-voice line before the debrief and is a real
loss, not a neutral swap. It is the lead's call and the sheet does not assume it.

**Mission III carries no `aftermath`.** The three shipped ones are all act or
campaign closes (`beit_sahwan_4_subterranean`, `umm_zeitoun_4_clearance`,
`wadi_halam_5_depot`), and Act II closes at Umm Zeitoun IV with the promotion in
it. A victory banner at the pass would make the four missions after it read as an
epilogue — the same argument `tel_marum/narrative.md` §3.3 makes for Tel Marum
III, and it is the same act. A line is written and **HELD** at §3.8 in case the
lead disagrees.

---

## 1. `qarn_hadid_1_recon` — Qarn Hadid I — Both Gates

`recon` · **Major** · `qarn_hadid` · requires **R** · produces **R M C I E** ·
`target_minutes` 6 · no economy. **The mission where the map is the
intelligence.**

Ledger letters as `design.md` §4 uses them: **R** `roster.surviving_units`,
**M** `roe.mission_ratings`, **C** `campaign.completed_missions`, **I**
`intel.marked_positions`, **E** `civ.settlements_evacuated`.

### 1.1 `name`

`Qarn Hadid I — Both Gates`

The title-card convention is the town, a numeral, then the name — `Tel Marum I —
The Gateway`, `Umm Zeitoun I — Cold Ground`, `Beit Sahwan IV — Subterranean`.
*Both Gates* is the design's own name and it is also the objective list: two
`locate` primaries, one per gate, and a drone that can have both in a single
sortie where nothing on the ground can have either.

### 1.2 `dispatch` — 211 chars

> *Twelve kilometres of pass road join Tel Marum to the basin, and for two weeks
> the brigade has driven round them. Nobody ever fought for that road. Somebody
> came through it with a machine, priced it, and went on.*

Narrator, story voice. It names no man — Adhal is *somebody* here exactly as he
was *somebody* in Tel Marum I, and the last clause is the whole of his doctrine
said as a fact about a road. See §0.6 for why an interlude gets one at all.

`dispatch` is live (`main.ts` `hud.announce(name, "N primary objective(s)",
mission.dispatch)`); the title card's hold is `render-vfx`'s standing item and is
the only thing between this line and a reader. Status **`live`**; owner
`mission-author`.

### 1.3 `briefing` — 1,006 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The wall across this pass has two ways through it: a shoulder at the crest, and a notch at plain level with the road in it. Somebody has cut an anti-tank ditch across the notch, so your men go low and your vehicles go high. | 223 |
| 2 | **Shai** | Push the drone through the notch and identify the post over each gate. It can have both in one sortie; nothing on the ground can, because neither gate sees the other from any range on this map. | 193 |
| 3 | **Idit** | What the drone cannot buy is the eastern pocket. A missile team on the scree covers it out to thirteen tiles, air only, and the battery it protects sits in a bowl nothing here can see into. | 189 |
| 4 | **Shai** | Four families are stopped on the pass road east of the staging ground, inside that battery's arc. Get two of them back to the staging ground inside four minutes. | 161 |
| 5 | **Shai** | The jeep and the Eitan carry two each, and the same men are the only ones who can reach anything east. Driving is how you beat that clock; walking is how you lose it. | 166 |
| 6 | **Shai** | Bring back both gate posts, and do not buy the pocket with the drone. | 69 |

Idit / Shai / Idit / Shai / Shai / Shai — the picture, the plan, the price of the
part of the picture she cannot have, the cost. Tel Marum I is Idit / Shai / Shai
and Umm Zeitoun I is Idit / Shai / Idit / Shai / Shai; the run of Shai at the end
is the tree's own shape, not a slip.

**Beat 1 is the design's Idit hook and it is the reason this map exists.** She
states a route fact before anybody has seen an enemy: *your men go low and your
vehicles go high*, which is `design.md` §3.2's measured result — foot takes the
saddle at 332 against 354, a vehicle takes the shoulder at 354 because the ditch
shuts the saddle to it, and flattening the map reverses the foot answer. This is
the first ground in the war where the terrain is the intelligence, and the
briefing says so without saying it about itself.

**Beat 2 is the arc's thesis in one clause.** `design.md` §3.3.1: a post in the
shoulder gap sees 20/20 shoulder tiles and **0/20** saddle tiles, and the mirror
holds, at sight 9, 12 and 48. *Neither gate sees the other from any range on this
map* is a terrain statement, which is why it is safe to say at 48.

**Beats 4 and 5 are the cost, and both numbers are measured.** `jeep_shoded` and
`apc_eitan` both declare `hull.transport_slots: 2` (read this session);
`CivilianFlight` boards a civilian into any player carrier with a free slot
inside four tiles (`SHEPHERD_RADIUS_SQ` = 1048576 in Q16.16, which is 4²). The
road party sits inside the scree bench's 8-tile eye and inside the Hollow tube's
20-tile arc (`design.md` §5.1), and the same men who fetch it are the only ones
who can identify anything east, because the MANPAD's 13-tile air-only envelope
means the drone cannot buy the pocket at all.

**Beat 6 closes on the cost, which is the house rule.** *"Bring back the picture,
not casualties"* (Tel Marum I), *"Do not chase what runs"* (Wadi Halam I).

**The JSON string, to be pasted whole:**

> The wall across this pass has two ways through it: a shoulder at the crest, and a notch at plain level with the road in it. Somebody has cut an anti-tank ditch across the notch, so your men go low and your vehicles go high. Push the drone through the notch and identify the post over each gate. It can have both in one sortie; nothing on the ground can, because neither gate sees the other from any range on this map. What the drone cannot buy is the eastern pocket. A missile team on the scree covers it out to thirteen tiles, air only, and the battery it protects sits in a bowl nothing here can see into. Four families are stopped on the pass road east of the staging ground, inside that battery's arc. Get two of them back to the staging ground inside four minutes. The jeep and the Eitan carry two each, and the same men are the only ones who can reach anything east. Driving is how you beat that clock; walking is how you lose it. Bring back both gate posts, and do not buy the pocket with the drone.

### 1.4 Objectives

Objective **ids are proposals** — `mission-author` and `level-scripter` own them.
The `text` is this sheet's, and it is read twice below because it is read twice
in the game: once on the deploy screen as an order, once in the notice feed as
`OBJECTIVE COMPLETE — <text>`.

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `find_the_high_gate_post` | `locate` · `qh_watch_shoulder` · **primary** | Identify the post over the high gate | `OBJECTIVE COMPLETE — Identify the post over the high gate` |
| `find_the_low_gate_post` | `locate` · `qh_watch_notch` · **primary** | Identify the post over the low gate | `OBJECTIVE COMPLETE — Identify the post over the low gate` |
| `get_the_road_party_clear` | `evacuate_before` · `south_staging` ×2 @240 s · **primary** | Get two families off the pass road inside four minutes | `OBJECTIVE COMPLETE — Get two families off the pass road inside four minutes` |
| `find_the_tube` | `locate` · `qh_hvt_tube` · secondary | Find the rocket battery in the hollow behind the start line | `OBJECTIVE COMPLETE — Find the rocket battery in the hollow behind the start line` |
| `find_the_bench_post` | `locate` · `qh_watch_bench` · secondary | Identify the observer on the boulder bench | `OBJECTIVE COMPLETE — Identify the observer on the boulder bench` |
| `find_the_ditch_gun` | `locate` · `qh_atgm_ditch` · secondary | Identify the ATGM cell over the west ditch end | `OBJECTIVE COMPLETE — Identify the ATGM cell over the west ditch end` |
| `screen_out` | `survive_until` 300 s · secondary | Stay in the field for five minutes | `OBJECTIVE COMPLETE — Stay in the field for five minutes` |

**"high gate" and "low gate" rather than "shoulder" and "saddle" in the two
primaries**, deliberately. Those two toasts are the first thing the player reads
about this town, and *high* and *low* teach the arc's idea in two words where the
map's own marker names teach nothing. The features are called the shoulder and
the notch everywhere else, including mission II's title.

`screen_out` reuses `tel_marum_1_recon`'s and `umm_zeitoun_1_recon`'s id and the
shape of their label — three recons in one act should give the same order the
same way. Only the number moves, 240 s to 300 s, and the tree spells minutes out
and seconds as digits (checked against all eighteen shipped missions).

`find_the_ditch_gun` names the ATGM cell the way `beit_sahwan_1_recon` does
(*"Identify the ATGM cell overlooking the east road"*). It is the tag that comes
back in III as an `ambush`, and it is the reason the secondaries are worth the
clock.

**`screen_out` cannot fail.** `survive_until` is not one of the three types
`checkEnd` can drive to `failed`, so a `say_on_fail` on it would never fire and
must not be authored.

### 1.5 `debrief` — victory 149 chars, defeat 120 chars

> **victory** · Idit — *This is the first ground where the map was the
> intelligence. I could tell you which gate your vehicles could use before
> anybody had seen a man on it.*

> **defeat** · Shai — *We had four minutes and two vehicles and we spent them on
> the wall. The road party was eleven tiles away the whole time.*

Idit's is the design's own hook said at the one moment it can be said without the
briefing turning into commentary. **Eleven tiles is measured** (`design.md` §5.1:
the road party is 11 tiles from `player_start` for both a rifleman and a jeep),
and Shai's line is a report, not a reproach — the failure is the plan's, and he
says the distance rather than the word. Status **`live`**.

### 1.6 The thread in, from Tel Marum III

`tel_marum_3_clearance`'s shipped victory debrief is Shai: *"The pass is a road
now. The block behind it is still standing, which is the only part of this I will
be asked about."* Qarn Hadid I opens on the next road and on the same problem one
size larger — a wall with two ways through it, one of which is a road already,
and a man who priced both without standing on either. Idit's `find_the_tube` line
(§1.7) is the direct continuation of her act-long argument that the eyes are what
this front is made of: the tube is in a hole and its eyes are eight tiles
forward, which is the Tel Marum finding restated on ground the player is standing
on rather than looking at.

### 1.7 Trigger table

The mission does not exist; every trigger below is `level-scripter`'s to author
and every id is proposed as prose, because `main.ts` prints it verbatim as
`enemy reacts (<id>)` (§8).

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qarn Hadid I — Both Gates` · *3 primary objectives* | `hud.announce`; shipped | live |
| mission start | `dispatch` | narrator | §1.2 | wants a longer title-card hold; `render-vfx` | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §1.3 | one speaker on screen today | live |
| `objective(find_the_high_gate_post, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the post over the high gate` | shipped | live |
| `objective(find_the_high_gate_post, complete)` | `radio` | **Idit** | "The post over the shoulder holds eight of that gate's twenty tiles and not one tile of the other. From where he is standing the low gate does not exist." | `objectives[].say`; the 8/20 is `design.md` §3.3.3 at his own sight 9 | live |
| `objective(find_the_low_gate_post, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the post over the low gate` | shipped | live |
| `objective(find_the_low_gate_post, complete)` | `radio` | **Idit** | "The one over the notch is in heavy cover and has the whole of it, twenty tiles out of twenty. Anything that crosses low crosses in front of him." | `objectives[].say`; 20/20 from `[32,15]` at sight 9, `design.md` §3.3.2. **This is the sentence mission II is about** | live |
| `objective(find_the_tube, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Find the rocket battery in the hollow behind the start line` | shipped | live |
| `objective(find_the_tube, complete)` | `radio` | **Idit** | "The battery is on the floor of the bowl behind you, on your own side of the wall. Nothing here can see into that hollow and it does not need to: its eyes are eight tiles forward, on the boulder bench." | `objectives[].say`; **T-QH1.** The Sur thesis on ground the player is standing on | live |
| `objective(find_the_bench_post, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the observer on the boulder bench` | shipped | live |
| `objective(find_the_bench_post, complete)` | `radio` | **Idit** | "That is the tube's eye. Take him off the bench and the battery is firing at the last place somebody told it about." | `objectives[].say`; sets up II's `eliminate_hvt` on the same tag | live |
| `objective(find_the_ditch_gun, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the ATGM cell over the west ditch end` | shipped | live |
| `objective(find_the_ditch_gun, complete)` | `radio` | **Idit** | "ATGM cell seventeen tiles past the notch, laid on the west end of a second ditch nobody has been close enough to draw. That gun is on the board now." | `objectives[].say`; **the carry-over, said at the moment it is bought.** In III this tag spawns pre-identified and forfeits its ambush | live |
| `objective(screen_out, complete)` @300 s | `toast` | system | `OBJECTIVE COMPLETE — Stay in the field for five minutes` | shipped | live |
| `screen_out` failing | — | — | **cannot happen**; no `say_on_fail` (§1.4) | authorial | live |
| `evacuated` (a civilian reaches `south_staging`) | `toast` | system | **nothing at all** — `describeMissionEvent` has no `evacuated` case | §10 **G-H**; `render-vfx` | engine |
| `objective(get_the_road_party_clear, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get two families off the pass road inside four minutes` | shipped | live |
| `objective(get_the_road_party_clear, complete)` | `radio` | **Shai** | "Two into the staging ground. Whatever is still on that road is not worth a second run east." | `objectives[].say`; the order stops at two, which is what makes the other two a cost rather than a task | live |
| `objective(get_the_road_party_clear, failed)` @240 s | `toast` | system | `OBJECTIVE FAILED — Get two families off the pass road inside four minutes` | **the only way to lose this mission**; a failed primary loses it in `checkEnd` | live |
| `objective(get_the_road_party_clear, failed)` @240 s | `radio` | **Shai** | "Four minutes, and nothing of ours got within four tiles of that road. They will be moved by somebody else now." | `objectives[].say_on_fail`; **four tiles is the boarding rule stated as the failure**, and the last clause is what the next trigger then does | live |
| wave t=150 s (1 `sarim_rifles`, `north_junction` → `saddle_gate`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded string | live |
| wave t=150 s | `radio` | **Idit** | "One section walking down to the notch from the junction. They are reinforcing the low gate while you are still photographing it." | `enemy.waves[].say`, live since 2026-09-06 | live |
| wave t=260 s (1 `sarim_rifles`, `north_junction` → `shoulder_gate`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded; **no `say`, deliberately** — the second gate being reinforced while the first was is the beat, and Idit narrating both makes it a pattern instead of a discovery | live |
| **T-QH-a** `zone_entered(scree)` → `something_is_living_in_the_scree` (`spawn` 1 `sarim_rifles` at `scree_north`) | `toast` | system | `enemy reacts (something_is_living_in_the_scree)` | id proposed as prose (§8) | live |
| **T-QH-a** same trigger | `radio` | **Idit** | "There is a section in the boulders and it did not walk in behind you. That pocket has been held since before anybody came up this road." | `triggers[].say`; the pocket the drone could not buy, answering | live |
| **T-QH-b** `casualties_pct(40)` → `he_will_not_leave_the_tube` (`withdraw_to village_square`, group `tube`) | `toast` | system | `enemy reacts (he_will_not_leave_the_tube)` | id proposed as prose | live |
| **T-QH-b** same trigger | `radio` | **Idit** | "The tube is out of the hollow and driving for the high gate. He does not leave one standing on a floor he can be walked onto." | `triggers[].say`. `rocket_battery` declares `mobility.wheeled: true` (read this session), so the shoulder is the only gate it can use — which is also why it is north of the wall in mission II | live |
| **T-QH-c** `timer_s(250)` → `they_move_the_road_party_off` (`remove`, group `road_party`) | `toast` | system | `enemy reacts (they_move_the_road_party_off)` | id proposed as prose; `do.kind: "remove"` is shipped and used by `umm_zeitoun_1_recon` | live |
| **T-QH-c** same trigger | `toast` | system | `taken (1)` ×N | `removedNotice`, side 2; one line per body, by design | live |
| **T-QH-c** same trigger | `radio` | **Idit** | "The road is empty. Nobody fought over it — they were walked off it while the drone was over the wall." | `triggers[].say`; **T-QH3, and the nearest thing to an atrocity in this arc.** It costs the player nothing on ROE — `stepRoe` only bills a `destroyed` whose `by` is a player unit — which is the point | live |
| `SimEvent destroyed` on the `recon_drone` | `radio` | **Idit** | "Drone is gone. Both gates are still a question and the only thing left that can ask it walks." | needs a trigger that can watch the sim (§10 **G-E**) | engine |
| `SimEvent fire` from `qh_hvt_tube` onto the road party | `radio` | **Shai** | "That is indirect, on the road, and nothing of ours has seen the thing that fired it. Get somebody to those people." | same gap; the tube firing is the mission's central fact and it currently arrives silently | engine |
| `missionEnd(victory)` | `toast` | system | `MISSION ACCOMPLISHED — ROE n, k units survive` | hard-coded | live |
| `missionEnd(victory)` | `debrief` | **Idit** | §1.5 | end screen, above the rating | live |
| `missionEnd(defeat)` | `debrief` | **Shai** | §1.5 | end screen | live |

---

## 2. `qarn_hadid_2_foothold` — Qarn Hadid II — The Shoulder

`foothold` · **Major** · `qarn_hadid` · requires **R I** · produces **R M C** ·
`target_minutes` 7 · **economy: yes** (`logistics_start` 500, 130/min).
**The mission where what you buy is constrained by which obstacle it can cross.**

### 2.1 `name`

`Qarn Hadid II — The Shoulder`

The design's own name, and the right one: the shoulder is the gate the mission is
about, the gate the player spends five minutes opening, and the gate the enemy
walks away from while he does it.

### 2.2 `briefing` — 1,011 chars, 6 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | The high gate is shut. Four tiles of poured concrete across the shoulder gap at the crest — the drone brought back men, not masonry, so it was never on the board. | 162 |
| 2 | **Shai** | The infantry crosses low, then, and it crosses alone. The notch is open on foot from the first second and it is covered end to end from the cover above it, so they are seen the whole way through. | 195 |
| 3 | **Idit** | That concrete was poured before the brigade was in Sur. He did not garrison this pass — he priced it, and he set a different price for men and for vehicles. | 156 |
| 4 | **Shai** | Engineers take the revetment down inside five minutes or this is over. Until it comes down nothing on wheels or tracks goes north of the wall at all, and the camp behind you is the only place anything new comes from. | 216 |
| 5 | **Shai** | Buy accordingly: a Namer bought at two minutes cannot use a road the engineers have not opened yet. Then hold both gates for three minutes. | 139 |
| 6 | **Shai** | Nothing crossing the notch can be supported from the shoulder, or the other way round. Send them anyway, and know how long they are alone. | 138 |

Idit / Shai / Idit / Shai / Shai / Shai.

**Beat 1 is T-QH4 and it is an admission, not an excuse.** `intel.marked_positions`
reveals **units by tag** and nothing else — no terrain, no structure
(`design.md` §7 G6) — so a recon could never have pre-revealed a poured
revetment. *The drone brought back men, not masonry* is Idit stating the limit of
her own instrument, which is her register exactly: what is known, how well, and
what knowing more costs.

**Beat 3 is Karim Adhal's character in one sentence and it is the arc's best line
about him.** He did not garrison the pass; he priced it, per domain, before the
brigade was in Sur. Nothing in it is second person and nothing in it is a
judgement.

**Beat 4 is the failable primary and it is stated as a consequence.** `raze` is
one of the three types `checkEnd` can drive to `failed`, a failed primary is a
defeat, and the deadline is in the line rather than in a warning about it.

**Beat 5 is the only economy line in the game that is about a road.** At 130
logistics a minute the player can buy roughly one Namer or three rifle sections
across the mission, and a Namer bought at t=120 cannot use any road until the
engineers finish. *Buy accordingly* is the whole mechanic, said in two words.

**Beat 6 is the design's Shai hook**, and it is the line a Major says and a
Captain does not: he is going to send men through a gate he cannot support, on
purpose, and the only thing he can give them is the number.

**The JSON string, to be pasted whole:**

> The high gate is shut. Four tiles of poured concrete across the shoulder gap at the crest — the drone brought back men, not masonry, so it was never on the board. The infantry crosses low, then, and it crosses alone. The notch is open on foot from the first second and it is covered end to end from the cover above it, so they are seen the whole way through. That concrete was poured before the brigade was in Sur. He did not garrison this pass — he priced it, and he set a different price for men and for vehicles. Engineers take the revetment down inside five minutes or this is over. Until it comes down nothing on wheels or tracks goes north of the wall at all, and the camp behind you is the only place anything new comes from. Buy accordingly: a Namer bought at two minutes cannot use a road the engineers have not opened yet. Then hold both gates for three minutes. Nothing crossing the notch can be supported from the shoulder, or the other way round. Send them anyway, and know how long they are alone.

### 2.3 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `open_the_shoulder` | `raze` · `the_gates` @300 s · **primary** | Raze the revetment on the high gate inside five minutes | `OBJECTIVE COMPLETE — Raze the revetment on the high gate inside five minutes` |
| `hold_the_gates` | `hold_for` · `the_gates` 180 s · **primary** | Hold both gates for three minutes | `OBJECTIVE COMPLETE — Hold both gates for three minutes` |
| `take_the_hollow` | `capture` · `hollow` 15 s · secondary | Take the hollow behind the start line and hold it for 15 seconds | `OBJECTIVE COMPLETE — Take the hollow behind the start line and hold it for 15 seconds` |
| `kill_the_bench_post` | `eliminate_hvt` · `qh_watch_bench` · secondary | Kill the observer on the boulder bench | `OBJECTIVE COMPLETE — Kill the observer on the boulder bench` |

`open_the_shoulder` uses the tree's own raze construction — *"Raze the depot
inside five minutes"* (`wadi_halam_5_depot`), *"Raze the stockpile inside five
minutes"* (`umm_zeitoun_4_clearance`). *Revetment* is a doctrine word for a
poured obstacle and attaches to nobody.

`take_the_hollow` spells its seconds as digits and says *hold it for 15 seconds*,
matching all four shipped `capture` labels.

`kill_the_bench_post` is the same man mission I could have identified, named the
same way in both missions — *the observer on the boulder bench* — because a
player who found him in I should recognise the label, and a player who did not
should be told what he is by reading it.

### 2.4 `debrief` — victory 142 chars, defeat 130 chars

> **victory** · Shai — *The crest is a road. It took five minutes of standing
> still under fire to make it one, and he poured it in an afternoon a year before
> we came.*

> **defeat** · Idit — *The concrete is still across the shoulder. Everything we
> sent through the low gate is on the wrong side of a wall we never opened.*

The victory line is the arc's cost arithmetic and it is the only place the
asymmetry is said outright. The defeat line is the two-piece force stated as
what it becomes when half of it never arrives — and it is hers because it is a
statement of position, not a reproach. Status **`live`**.

### 2.5 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qarn Hadid II — The Shoulder` · *2 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–6, §2.2 | shipped | live |
| `objective(open_the_shoulder, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Raze the revetment on the high gate inside five minutes` | shipped | live |
| `objective(open_the_shoulder, complete)` | `radio` | **Shai** | "Revetment is down and the crest is a road. Nothing on tracks has had one since we got to this pass." | `objectives[].say`; a destroyed building leaves passable rubble (`sim.ts` ~4569), so the line is literally true | live |
| `objective(open_the_shoulder, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Raze the revetment on the high gate inside five minutes` | **the only way to lose this mission**; loses it | live |
| `objective(open_the_shoulder, failed)` @300 s | `radio` | **Shai** | "Five minutes. The concrete is standing, the armour has not moved a tile north, and the men who crossed low are still over there." | `objectives[].say_on_fail`; **states the real failure** — the split force never reunited | live |
| `objective(hold_the_gates, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Hold both gates for three minutes` | shipped | live |
| `objective(hold_the_gates, complete)` | `radio` | **net** | "Both gates held. Nothing crossed this wall tonight that we did not put through it." | `objectives[].say`; flat, because holding two gates you cannot see between is not a speech | live |
| `objective(take_the_hollow, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the hollow behind the start line and hold it for 15 seconds` | shipped | live |
| `objective(take_the_hollow, complete)` | `radio` | **Idit** | "The bowl is empty. He took the tube north through a gate you have not opened yet, and while you stand in this one he cannot bring it back." | `objectives[].say`; **T-QH6.** The displacement made legible by its absence, and the reason a 15-second capture of empty ground is worth doing — the camp is 13.6 tiles from the hollow | live |
| `objective(kill_the_bench_post, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the observer on the boulder bench` | shipped | live |
| `objective(kill_the_bench_post, complete)` | `radio` | **Idit** | "Bench is clear. The battery still has its range card and nobody left to read it out." | `objectives[].say` | live |
| wave t=120 s (2 `sarim_rifles`, `north_junction` → `shoulder_gate`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; **no `say`** — the first push arriving at the gate the player is opening needs no gloss | live |
| wave t=240 s (1 `recoilless_team`, `village_square` → `saddle_gate`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded | live |
| wave t=330 s (2 `sarim_rifles`, `village_square` → `saddle_gate`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=330 s | `radio` | **Idit** | "Two more sections off the square, and they are going to the notch rather than to the shoulder. He is fighting for the gate you did not choose." | `enemy.waves[].say`; the cadence's argument, said once at the third push | live |
| **T-QH-d** `zone_entered(the_gates)` → `the_shoulder_garrison_walks_to_the_notch` (`commit` group `gate` → `saddle_gate`) | `toast` | system | `enemy reacts (the_shoulder_garrison_walks_to_the_notch)` | id proposed as prose (§8) | live |
| **T-QH-d** same trigger | `radio` | **Idit** | "The section in the revetment has left it and gone east to the notch. You are five minutes into opening a gate they have stopped defending." | `triggers[].say`; **T-QH5, the sharpest twist in the arc.** The player cannot see it happen from where his armour is, which is why it needs a line at all | live |
| **T-QH-e** `casualties_pct(40)` → `he_takes_the_tube_into_the_village` (`withdraw_to village_square`, group `tube`) | `toast` | system | `enemy reacts (he_takes_the_tube_into_the_village)` | id proposed as prose | live |
| **T-QH-e** same trigger | `radio` | **net** | "Battery is displacing onto the village square. It will not be where the drone last had it and it still reaches both gates." | `triggers[].say`; **net rather than Idit** — it is a position report, and Idit's tube line in this mission was already spent on the empty bowl | live |
| the garrisoned revetment taking structure fire | `toast` | system | hard-coded structure-damage copy | a garrisoned `concrete` can be shot down by the Lavi; an empty one only demolished. **No line** — the second road to the primary should be discovered, not announced | live |
| `built` at the camp | `toast` | system | `reinforcement deployed — inf_squad` | prints a raw unit id; §10 **G-I** | engine |
| `SimEvent destroyed` on the `demo_squad` | `radio` | **Shai** | "That was the demolition party. Whatever is still across the shoulder at five minutes stays across it." | needs a trigger that can watch the sim (§10 **G-E**) | engine |
| `missionEnd(victory)` | `debrief` | **Shai** | §2.4 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Idit** | §2.4 | end screen | live |

---

## 3. `qarn_hadid_3_clearance` — Qarn Hadid III — The Village Road

`clearance` · **Major** · `qarn_hadid` · requires **R I** · produces
**R M C I E** · `target_minutes` 7 · economy: `logistics_start` 400, 80/min.
**The town closes here; Karim Adhal does not.**

### 3.1 `name`

`Qarn Hadid III — The Village Road`

The design's own name. Flat, and it should be: the arc's last mission is a road
being opened, and the title must not promise a duel with a man who is two towns
away.

### 3.2 `briefing` — 1,213 chars, 7 beats

| beat | speaker | line | chars |
|---|---|---|---|
| 1 | **Idit** | There is a second ditch and it is not at the gates. He cut an anti-tank line across the fields on the village's own approach, with the town beyond it and two narrow ways round the ends. | 185 |
| 2 | **Shai** | Two roads into that town and you take one. Seventeen tiles round the west end, twenty-three round the east through the olive grove, and there is an eye in the grove. | 165 |
| 3 | **Idit** | The west end runs under the terraced knoll, and a post on its east shoulder sees eight of its ten tiles. Whatever you identified here last week comes back with its ambush spent; whatever you did not gets its first shot. | 219 |
| 4 | **Shai** | Take the knoll first with foot and the armour walks in behind you. Take it second and it walks in under a Kornet. | 113 |
| 5 | **Idit** | The mast up there sees the shoulder gate and nothing else on this map — not the village, not the junction, not its own road. It watches nothing; it tells the basin what the eyes here saw. | 187 |
| 6 | **Shai** | Clear the village and hold it, and kill the relay crew on the knoll. Three families are in it and the yard they walk to is the clinic's own. | 140 |
| 7 | **Shai** | That yard is flagged: heavy ordnance into it is billed by the round, and they are inside it for five minutes. Open the road — everything this brigade does after this town is on the other side of it. | 198 |

Idit / Shai / Idit / Shai / Idit / Shai / Shai — a clean two-hander for six
beats, and the run of Shai at the end is the orders and the cost, which is where
this tree always ends a briefing.

**Every number in beats 2, 3 and 5 is measured and quoted, not estimated**
(`design.md` §3.2, §3.3.4): the two armour roads into the village are **17
tiles** from the shoulder gate's north exit (crossing the ditch at its west end,
x=19) and **23** from the saddle gate's north exit (crossing at the east end,
x=37, through the olive grove); `[15,8]` on the knoll's east shoulder sees **8 of
the 10** tiles of the western leg at sight 8; and `knoll_top [10,9]` at sight 48
sees the shoulder gate and **nothing else on the map**. **Do not paraphrase beat
5** — it is the pinned measurement and its whole force is that it is exact.

**Beat 3's second sentence is the recon-dependent clause, and it is written as a
rule rather than as a state.** §9 has the two branch clauses the mission would
carry if a briefing could read the ledger, the engine proposal, and why this
single sentence is the correct fallback: it is true whether or not mission I
found `qh_atgm_ditch`, it teaches the carry-over mechanic, and it makes the
player's own memory the thing that resolves it.

**Beat 7 is the ROE line and it is arithmetic, not a sermon.** `flagged_zones:
["clinic"]`, `fail_below: 45`, and the yard the families are walking to is the
zone. From `beit_sahwan_3_clearance`'s measured lesson the penalty arms at
`collateral_risk >= 0.3`, so the Namer's `cannon_30` trips it and rifles, the
`coax_mg` and the Eitan's `rws_50` do not — which means **infantry can fight in
that yard and armour cannot**, and that is a decision rather than a tax. The
briefing says the bill, never the wrong.

**The JSON string, to be pasted whole:**

> There is a second ditch and it is not at the gates. He cut an anti-tank line across the fields on the village's own approach, with the town beyond it and two narrow ways round the ends. Two roads into that town and you take one. Seventeen tiles round the west end, twenty-three round the east through the olive grove, and there is an eye in the grove. The west end runs under the terraced knoll, and a post on its east shoulder sees eight of its ten tiles. Whatever you identified here last week comes back with its ambush spent; whatever you did not gets its first shot. Take the knoll first with foot and the armour walks in behind you. Take it second and it walks in under a Kornet. The mast up there sees the shoulder gate and nothing else on this map — not the village, not the junction, not its own road. It watches nothing; it tells the basin what the eyes here saw. Clear the village and hold it, and kill the relay crew on the knoll. Three families are in it and the yard they walk to is the clinic's own. That yard is flagged: heavy ordnance into it is billed by the round, and they are inside it for five minutes. Open the road — everything this brigade does after this town is on the other side of it.

### 3.3 `briefing_video`

**None.** `design.md` O-QH5 recommends none for I and II and *optional* for III,
and the lead cuts these himself — this sheet writes no video and declares no
field. `validate_data.mjs` requires the file to exist if the field is declared,
so an aspirational path would fail the gate. If the lead wants one, the asset is
`assets/video/qarn_hadid_3_briefing.mp4` and the field is
`"briefing_video": "video/qarn_hadid_3_briefing.mp4"`; the two shipped cuts
(`tel_marum_2_briefing.mp4`, `tel_marum_3_briefing.mp4`) are the reference for
length and shape.

### 3.4 Objectives

| id | type · target | as an order | as a toast |
|---|---|---|---|
| `take_the_village` | `capture` · `village` 20 s · **primary** | Clear the village and hold it for 20 seconds | `OBJECTIVE COMPLETE — Clear the village and hold it for 20 seconds` |
| `kill_the_relay` | `eliminate_hvt` · `qh_hvt_relay` · **primary** | Kill the relay crew on the terraced knoll | `OBJECTIVE COMPLETE — Kill the relay crew on the terraced knoll` |
| `get_the_families_clear` | `evacuate_before` · `clinic` ×3 @300 s · **primary** | Get three families out of the village to the clinic yard inside five minutes | `OBJECTIVE COMPLETE — Get three families out of the village to the clinic yard inside five minutes` |
| `take_the_terraces` | `capture` · `the_terraces` 15 s · secondary | Take the terraces and hold them for 15 seconds | `OBJECTIVE COMPLETE — Take the terraces and hold them for 15 seconds` |
| `find_the_grove_post` | `locate` · `qh_watch_grove` · secondary | Identify the post in the olive grove | `OBJECTIVE COMPLETE — Identify the post in the olive grove` |

`take_the_village` follows `wadi_halam_4_village` (*"Clear and hold the village
for 20 seconds"*) and `beit_sahwan_3_clearance` (*"Clear the town centre and hold
it for 20 seconds"*) — same type, same 20 s, and the tree should say it the same
way.

**`kill_the_relay` names the crew and not the mast**, because `eliminate_hvt`
kills units and the tag sits on two `sarim_rifles` in `ambush(2)` on the cover-3
benches. A label promising a structure would be a label the mechanic cannot keep.

`get_the_families_clear` names the destination — *the clinic yard* — because that
is also the flagged zone, and the player should read the two facts in the same
line. The refuge is the new marker `clinic_yard [44,10]` (`design.md` C4); the
map's own `civ_refuge [10,43]` **cannot** be used, because it sits inside no
declared zone and `evacuate_before` throws at load (§10 **G-J**).

### 3.5 `debrief` — victory 133 chars, defeat 136 chars

> **victory** · Shai — *The road is open. It was cut by a man who has never been
> here, and opening it cost a climb, a demolition and a clinic full of people.*

> **defeat** · Idit — *The ditch is still across the fields and the mast is still
> on the hill. Whatever the basin's guns are told tomorrow, they are told fast.*

Shai's is the design's hook — the road being open and what it cost — and it names
the ditch's author without naming him, which is the only way the arc is allowed
to. Idit's is the thread out (§3.6) inverted: what the next town inherits when
this one is lost. Status **`live`**.

### 3.6 The thread out, into Umm Zeitoun I

Idit's `kill_the_relay` line (§3.7) is the hand-off and it is the only sentence in
the arc that reaches forward: *from tonight the basin's guns are slower to be
told.* `umm_zeitoun_1_recon`'s shipped beat 1 then opens — *"Umm Zeitoun is a
basin: no wall across it, no gate to force, crossable anywhere on its width"* —
and lands as the exact inversion of the two gates. A pass is forced; a basin is
crossed. Nothing in Umm Zeitoun I needs a word changed for this to work, and
**this sheet changes nothing there**: the continuity is carried by what Qarn
Hadid III says on its way out, not by a re-brief of a mission that is already
written.

`design.md` §2 also records the ledger continuity — `intel.marked_positions` is
the same key Tel Marum I produced and both Qarn Hadid I and III produce, so
Idit's file is one list two towns long by the time the basin opens.

### 3.7 Trigger table

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| mission start | `title` | system | `Qarn Hadid III — The Village Road` · *3 primary objectives* | shipped | live |
| mission start | `brief` | Idit / Shai | beats 1–7, §3.2 | shipped | live |
| `objective(take_the_village, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Clear the village and hold it for 20 seconds` | shipped | live |
| `objective(take_the_village, complete)` | `radio` | **net** | "Village is held. The pass road runs from the staging ground into the basin without stopping now." | `objectives[].say`; the road is the objective's meaning and the net is the right voice for a road being open | live |
| `objective(kill_the_relay, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Kill the relay crew on the terraced knoll` | shipped | live |
| `objective(kill_the_relay, complete)` | `radio` | **Idit** | "The mast is down. It never saw one thing on this map but the high gate — it was the wire, and from tonight the basin's guns are slower to be told." | `objectives[].say`; **T-QH7 and the hand-off to Umm Zeitoun.** Measured (`design.md` §3.3.4) — do not paraphrase the first clause | live |
| `evacuated` (a civilian reaches the clinic yard) | `toast` | system | **nothing at all** | §10 **G-H** | engine |
| `objective(get_the_families_clear, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Get three families out of the village to the clinic yard inside five minutes` | shipped | live |
| `objective(get_the_families_clear, complete)` | `radio` | **Shai** | "Three in the clinic yard. Nothing heavier than a rifle goes into that yard while they are standing in it." | `objectives[].say`; the ROE rule restated as an order at the moment it starts costing | live |
| `objective(get_the_families_clear, failed)` @300 s | `toast` | system | `OBJECTIVE FAILED — Get three families out of the village to the clinic yard inside five minutes` | **the only way to lose this mission on a clock**; a failed primary loses it | live |
| `objective(get_the_families_clear, failed)` @300 s | `radio` | **Shai** | "Five minutes. They are still in the village and the village is still being fought over, and that is on the plan, not on them." | `objectives[].say_on_fail`; he takes it, which is the character and is not a sermon | live |
| `objective(take_the_terraces, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Take the terraces and hold them for 15 seconds` | shipped | live |
| `objective(take_the_terraces, complete)` | `radio` | **net** | "Terraces are ours. The armour's road out of the west ditch end is unwatched for the first time." | `objectives[].say`; states the mechanical payoff of the climb | live |
| `objective(find_the_grove_post, complete)` | `toast` | system | `OBJECTIVE COMPLETE — Identify the post in the olive grove` | shipped | live |
| `objective(find_the_grove_post, complete)` | `radio` | **Idit** | "One post in the olive grove, over the east ditch end. He goes into the file for the basin — the same idea is waiting for us there." | `objectives[].say`; the tag Umm Zeitoun inherits, said as an intel act and never as an order | live |
| first `roe` deduction inside `clinic` | `toast` | system | hard-coded `roeNotice` copy | strings are not authorable; this is the deduction beat 7 priced | live |
| first `roe` deduction inside `clinic` | `radio` | **Shai** | "That was the clinic, not the town. Whatever fired that is off the yard now and stays off it." | needs a trigger that can watch the sim (§10 **G-E**) | engine |
| wave t=120 s (2 `sarim_rifles`, `village_square` → `north_junction`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded; no `say` | live |
| wave t=240 s (1 `recoilless_team`, `knoll_top` → `shoulder_gate`) | `toast` | system | `enemy reinforcements — 1 unit(s) inbound` | hard-coded; no `say` | live |
| wave t=330 s (2 `sarim_rifles`, `village_square` → `clinic_yard`) | `toast` | system | `enemy reinforcements — 2 unit(s) inbound` | hard-coded | live |
| wave t=330 s | `radio` | **Idit** | "Two sections off the square and they are going to the clinic, not to you. He knows which yard we told those families to walk to." | `enemy.waves[].say`; **T-QH8's cheap half** — the wave, without the garrison. See §7 for why the garrison version is `playtest`'s call and not this sheet's | live |
| **T-QH-f** `zone_entered(village)` → `they_come_out_of_the_square` (`commit` group `village` → `village_square`) | `toast` | system | `enemy reacts (they_come_out_of_the_square)` | id proposed as prose (§8) | live |
| **T-QH-f** same trigger | `radio` | **net** | "The garrison is out of the buildings and forming on the square." | `triggers[].say`; deliberately flat and short — a position report, and the mission's talking is already spent on the knoll | live |
| **T-QH-g** `casualties_pct(45)` → `the_town_falls_back_onto_the_hill` (`withdraw_to knoll_top`, group `village`) | `toast` | system | `enemy reacts (the_town_falls_back_onto_the_hill)` | id proposed as prose | live |
| **T-QH-g** same trigger | `radio` | **Idit** | "They have left the houses and gone up onto the terraces. He is giving you the town and keeping the hill you have to climb." | `triggers[].say`; **T-QH9.** `tel_marum/design.md` records that a `withdraw_to` can walk a fight out of a scripted plan's reach — `playtest` re-runs after this lands | live |
| `SimEvent fire` from an enemy indirect weapon into `clinic` | `radio` | **Idit** | "That round was his and it landed in the yard, and the rating does not move for it. It only ever moves for ours." | **T-QH10** in its literal form; `stepRoe` only bills a `destroyed` whose `by` is a player unit. Needs a sim-watching trigger (§10 **G-E**), and choosing where a round lands is out of reach entirely (§10 **G-F**) | engine |
| `missionEnd(victory)` | `debrief` | **Shai** | §3.5 | end screen | live |
| `missionEnd(defeat)` | `debrief` | **Idit** | §3.5 | end screen | live |
| `missionEnd(victory)` | `aftermath` | narrator | **none, deliberately** — §0.6; the held line is §3.8 | victory banner | live |

### 3.8 The held `aftermath` — 181 chars

**Not for this arc.** Printed so the lead can overrule §0.6 with a line in front
of him rather than a description of one.

> *The pass road carried a convoy the next morning, the first in three weeks.
> Nobody had ever defended it. It had only been priced, by a man two towns away
> who has still not been seen.*

It claims nothing the mission cannot stage, promotes nobody, and hands forward
rather than closing. If it ships, `umm_zeitoun_4_clearance`'s aftermath is
unaffected — that one carries the act boundary and the fourth star, and this one
carries a convoy.

---

## 4. Karim Adhal at Qarn Hadid — why he does not speak

`tel_marum/narrative.md` §7.5 records that Adhal speaks **once in Act II**, on
`the_tube_goes_west` in `umm_zeitoun_4_clearance`, and that it is the only line
any villain speaks in the act. That was written before this town existed. Adding
a second line here would make it two, and it would spend the act's scarcest
effect on an interlude in which he is not present, has not been found, and does
not lose anything he cannot replace.

**So: no `enemy` line ships in this arc**, and his portrait does not appear at
Qarn Hadid. He is carried entirely by three objects and one removal (§0.3). This
is the same construction Tel Marum uses for him and it is why the crest lands.

One line is written and **HELD**, for the trigger it would sit on if the lead
wants his face in the interlude — `the_shoulder_garrison_walks_to_the_notch`,
mission II, which is the one moment on this map that is purely his:

> *Leave the shoulder. They are opening a gate we are not standing in — let them
> have it, and be at the other one when they arrive.* — 128 chars

It is an instruction to his own people, never addressed to the player, and there
is no second person in it that means the player. `sayNotice` renders `enemy` with
no name at all and tone `warn`, so it reads as intercepted rather than spoken to
somebody — which only works because he is not answering anything.

| event | channel | speaker | line | overlay / audio | status |
|---|---|---|---|---|---|
| **HELD** · II `the_shoulder_garrison_walks_to_the_notch` | `radio` | **enemy** | the line above | `triggers[].say`; the field is live and the portrait ships (`assets/ui/portraits/karim_adhal.png`). **Not to be authored in this arc** unless the lead overrules §4 | live |

---

## 5. Ambient lore — secondary locations

Ground the player crosses that no objective names. Every marker, zone and tile
range below was read from `data/maps/qarn_hadid.json` this session; all twelve
markers and all seven zones resolve. Every line fires once and stops the game for
nobody.

**All sixteen rows are `engine`, and for two reasons at once**: there is no event
to fire them on (a trigger cannot watch a `SimEvent`, and `zone_entered` is
one-shot and already spent on the twists), and there is no surface to fire them
into (the radio overlay does not exist). They are written now because the ground
is measured now.

| location | marker / zone | channel | speaker | line | status |
|---|---|---|---|---|---|
| the staging ground | `kdf_start [24,39]` / zone `south_staging [16,34,17,12]` | `radio` | Idit | "Nothing on this map has ever seen this ground. That is not cover — it is just how far away the wall is." | engine |
| the southern plain | `south_plain [24,33]` | `radio` | Shai | "You can park the whole brigade on this plain and it will not see two tiles of either gate. A tank sitting here is not in overwatch; it is absent." | engine |
| the high gate | `shoulder_gate [20,20]` / zone `the_gates [17,16,17,9]` | `radio` | Idit | "Four tiles of open ground at the crest, five levels above the plain on both sides. The climb costs fifty and it is the only road north for anything on tracks." | engine |
| the low gate | `saddle_gate [30,22]` | `radio` | Idit | "The notch is at plain level with the road still in it, and somebody has cut a ditch across all four tiles. It is the cheap way through and it is closed to everything with wheels." | engine |
| the horn between them | `[24,20]`, elevation 7 | `radio` | Shai | "The two gates are nine tiles apart with a rock horn between them, and it is the highest ground on the map. Whatever goes through one of them is on its own until it is out the far side." | engine |
| the junction | `north_junction [24,12]` | `radio` | Idit | "Everything that reinforces this wall comes down through the junction, and it can go to either gate from there. We cannot." | engine |
| the village | `village_square [28,5]` / zone `village [20,1,18,10]` | `radio` | Idit | "One apartment, three houses, a walled yard and a road running east through all of it. It was a stop on the way to the basin before either army was here." | engine |
| the clinic | zone `clinic [42,6,5,5]` | `radio` | Shai | "One building in its own walled yard at the east end of the town. It is the only zone on this map holding exactly one thing, and that is what the flag is for." | engine |
| the terraces | `knoll_top [10,9]` / zone `the_terraces [8,5,7,7]` | `radio` | Idit | "Benched terraces around a rock core, and the heaviest cover authored anywhere in this war. A section on those benches loses under a fifth of what it loses in the open." | engine |
| the second ditch | `d`, x20–34, y=11 | `radio` | Idit | "Fifteen tiles of anti-tank line across the fields, with two ways round the ends and the town on the far side. It was dug against armour and it is the people behind it who live with it." | engine |
| the olive grove | `o`, x35–43, y11–15 | `radio` | Shai | "Grove on the eastern approach, cover one, rising to four. It is the long road into that town and it is the only one with anything growing on it." | engine |
| the cover-3 block | `3`, x26–33, y14–16 | `radio` | Idit | "Heavy cover straddling the road just north of the wall. From its eastern end a man sees every tile of the low gate and not one tile of the high one." | engine |
| the scree | zone `scree [33,23,15,6]`, `scree_north [40,23]`, `scree_south [40,30]` | `radio` | Shai | "Boulder fan across the eastern flank. Eight tiles on foot, twenty on tracks, and one column at its western edge that armour can use." | engine |
| the hollow | zone `hollow [31,31,15,15]`, `hollow_floor [38,38]` | `radio` | Idit | "A bowl with its floor at nothing and its rim at three. Nothing outside it sees in, and from the floor you see your own rim and no further." | engine |
| the eastern lip | `east_post [45,33]` | `radio` | Idit | "The far lip of the bowl. Whoever sat here was not watching the road — he was making sure nobody walked up on what was in the bottom." | engine |
| the old refuge | `civ_refuge [10,43]` | `radio` | Shai | "There is a collection point marked behind the staging ground and it is thirty-six tiles from the town. Nobody in that village is walking to it." | engine |

**The last row is a story line doing a validator's job**, and that is deliberate.
`civ_refuge` sits inside no declared zone, so an `evacuate_before` naming it
throws at load (§10 **G-J**); the line is the fiction's version of the same
warning, and it is the reason mission III's families walk east to the clinic yard
instead.

---

## 6. EVA announcements — the Qarn Hadid delta

**There is none.** The campaign's set is Act I's
(`docs/campaign/beit_sahwan/narrative.md` §8) plus Act II's four additions
(`tel_marum/narrative.md` §9): a civilian group taken, indirect fire inbound, an
enemy group displacing, and a `raze` target's last structure down. Checked
event by event against this arc: `they_move_the_road_party_off` is the first;
the Hollow tube is the second; three `withdraw_to` triggers are the third; the
revetment coming down is the fourth. **Every EVA-worthy moment in Qarn Hadid is
already covered, and inventing a fifth line to have a delta would be padding.**

`tools/validate_audio.py`'s `KNOWN_EVENTS` is six weapon and impact events, so
`pnpm validate:audio` cannot accept a voice file at all. The gate widens before
anything is recorded (GH-110, `storyline.md` §7 G4).

## 6a. Barks

**Not written here**, for the same reason as Act I and Act II. Barks are keyed by
unit **role**, never per unit (GH-110), and **the doctrine-not-people rule has to
head that sheet before a single line exists on it**, because it constrains
accent, idiom and phrasing — the things that carry ethnicity in a recording and
the things that cannot be edited out of one afterwards. Qarn Hadid fields eleven
KDF roles and six Sarim roles and adds none; a role-keyed set for the campaign is
its own deliverable and must not arrive at the bottom of a briefing sheet.

---

## 7. The twist lines — T-QH1 to T-QH10

The classification is `level-scripter`'s; the lines are this sheet's. The
"mechanic" column is what is needed **besides** a voice — the voice itself is
live.

| # | mission | twist | speaker | line | mechanic | status |
|---|---|---|---|---|---|---|
| **T-QH1** | I | *The tube is behind you.* The Grad is in the Hollow on the player's own side of the wall, with its eyes eight tiles forward | Idit | "The battery is on the floor of the bowl behind you, on your own side of the wall. Nothing here can see into that hollow and it does not need to: its eyes are eight tiles forward, on the boulder bench." | a placement and an `objectives[].say`. The firing is the engine's own per-side identification rule | live |
| **T-QH2** | I | *Two gates, one drone.* Which gate the picture is about | Idit | **no separate line, deliberately** — the two `locate` `say`s in §1.7 each state their own gate's blindness to the other, which is the twist twice instead of a third time | none | live |
| **T-QH3** | I | *They are on the road, not in a house.* The road party is taken off it | Idit | "The road is empty. Nobody fought over it — they were walked off it while the drone was over the wall." | `timer_s(250)` → `remove` group `road_party`; shipped verb, used by `umm_zeitoun_1_recon` | live |
| **T-QH4** | II | *The high gate was closed after the picture was taken* | Idit | briefing beat 1 — *"the drone brought back men, not masonry, so it was never on the board."* | none; `intel.marked_positions` reveals units by tag and nothing else, so the surprise is structural | live |
| **T-QH5** | II | *The gate you opened is not the gate they defend* | Idit | "The section in the revetment has left it and gone east to the notch. You are five minutes into opening a gate they have stopped defending." | `zone_entered(the_gates)` → `commit` group `gate` → `saddle_gate` | live |
| **T-QH6** | II | *The tube went north* | Idit | "The bowl is empty. He took the tube north through a gate you have not opened yet, and while you stand in this one he cannot bring it back." | none — a placement in II and an `objectives[].say` on the `capture hollow` secondary. **The displacement is told by its absence**, which is the cheapest real twist in the arc | live |
| **T-QH7** | III | *The mast is not an eye* | Idit | "The mast is down. It never saw one thing on this map but the high gate — it was the wire, and from tonight the basin's guns are slower to be told." | none — an `objectives[].say`. **Measured; do not paraphrase** | live |
| **T-QH8** | III | *The clinic fills up.* Rifles go where the families are walking | Idit | "Two sections off the square and they are going to the clinic, not to you. He knows which yard we told those families to walk to." | the 330 s wave `to: clinic_yard` + `enemy.waves[].say`. **The garrison version** (`zone_entered(clinic)` → `spawn` with `stance: garrison`) is `playtest`'s call per O-QH3, not this sheet's — the line above works for both | live |
| **T-QH9** | III | *He gives the town back* | Idit | "They have left the houses and gone up onto the terraces. He is giving you the town and keeping the hill you have to climb." | `casualties_pct(45)` → `withdraw_to knoll_top`. **Re-run `playtest`** — a `withdraw_to` can walk a fight out of a plan's reach | live |
| **T-QH10** | III | *His fire kills them and your score does not move* | Idit | "That round was his and it landed in the yard, and the rating does not move for it. It only ever moves for ours." | as a **placement**, live and authored (families on the axis his indirect fire walks); as a **line bound to the round landing**, it needs both a sim-watching trigger and a way to choose where an enemy round lands (§10 G-E, G-F) | engine |

**T-QH6 is the one to build first**, and not because it is cheapest. It is the
only twist in the arc that pays a player for taking ground that is empty — the
bowl is worth 15 seconds precisely because of what is no longer in it — and every
part of it is live today with no engine work at all.

---

## 8. Trigger ids — proposals, because an id is player-facing prose

`main.ts` prints a trigger's `id` verbatim as `enemy reacts (<id>)` and
`mission.schema.json` puts no pattern on it. **`level-scripter` owns these; none
exists in JSON, because no mission file exists.**

| mission | proposed id | why |
|---|---|---|
| I | `something_is_living_in_the_scree` | `enemy reacts (something_is_living_in_the_scree)` is the twist's own sentence, and *living* is right for a pocket that was held before anybody arrived |
| I | `he_will_not_leave_the_tube` | states the doctrine, not the mechanic. A player who reads it knows why the Grad is moving |
| I | `they_move_the_road_party_off` | the verb is deliberately *move*, mirroring `umm_zeitoun_1_recon`'s `they_move_the_families_off` — they are taken, not killed, and the id must not say otherwise |
| II | `the_shoulder_garrison_walks_to_the_notch` | long, and worth it: it is the whole twist and the player cannot see it happen |
| II | `he_takes_the_tube_into_the_village` | distinct from Tel Marum III's proposed `the_tube_backs_into_the_town`, which is a different act on different ground. Note it does **not** say *his* village |
| III | `they_come_out_of_the_square` | plain, because the line on the same tick is plain |
| III | `the_town_falls_back_onto_the_hill` | names what the player will see and what it will cost him — a climb |

**The hard-coded `enemy reacts` prefix is correct on all seven**, because every
trigger in this arc is an enemy act: a spawn, two displacements, a commit, a
group taken. The tutorial's friendly `deliver_*` triggers remain the only place
that prefix lies (Act I **G-C**).

---

## 9. The recon-dependent briefing — both clauses, and why one string ships

**The requirement is real.** Mission I's three secondary `locate`s are worth the
clock precisely because two of the tags come back in III as `ambush`
placements: a tag identified in I spawns pre-identified and **forfeits its
ambush** (`spawnPlacement`'s `preMarked`), so `qh_atgm_ditch` — the Kornet over
the armour's short road — is either a known gun or a first shot from nowhere. A
player who flew the drone north and never sent anybody east gets it live.
Mission III's picture genuinely differs by what mission I found.

**The surface cannot express it.** `briefing` is a plain `string` in
`mission.schema.json`. `ledger.requires` is not read by the runtime or by
`campaign.ts` at all, so even declaring `intel.marked_positions` buys no branch;
`say` texts are static; and no `on.kind` can test a ledger key.

**The two clauses, for the record and for whoever builds the field:**

| the ledger says | Idit's clause | chars |
|---|---|---|
| `qh_atgm_ditch` **was** identified in mission I | *"The Kornet over the west ditch end is on the board from last week. It is where it was, and it does not get a first shot."* | 120 |
| it **was not** | *"Nothing of ours has been past the notch, so the west ditch end is unread. Take the short road on the assumption there is a gun on it, and be right."* | 145 |

**What ships is one sentence that is true in both worlds**, and it is beat 3's
second sentence:

> *Whatever you identified here last week comes back with its ambush spent;
> whatever you did not gets its first shot.*

That is not a compromise. It states the **rule** rather than the state, so it is
correct whichever way the ledger fell; it teaches GDD §4's carry-over, which no
shipped briefing says out loud; and it makes the player's own memory of mission I
the thing that resolves it, which is the only branch the game can currently
execute. A player who found the gun reads it as reassurance and a player who did
not reads it as a warning, from the same nineteen words.

**The engine proposal**, smallest first:

| # | proposal | shape | owner | status |
|---|---|---|---|---|
| **P1** | `briefing_variants` — an optional array of `{ requires_ledger: <key>, briefing: <string> }` checked in order, falling back to `briefing`. Nothing else changes: `briefingBeats` still splits whichever string wins | `mission.schema.json` + wherever the briefing is handed to `showLoading` | `sim-guard` + `render-vfx` | engine |
| **P2** | cheaper and worse: a `say` at `timer_s(1)` gated on the same key, so the branch arrives as a transmission instead of as orders. Rejected — it puts story in the orders slot's place and a one-second transmission reads as a bug | — | — | engine |

Until P1 exists, **the single fallback above is the shipped text** and the
mechanical difference still lands, because the ambush forfeit happens whether or
not anybody says so.

---

## 10. Gaps this sheet could not write around

| # | gap | smallest fix | owner |
|---|---|---|---|
| **G-A** | **A briefing cannot branch on the ledger**, so mission III cannot say what mission I found. §9 has both clauses, the proposal and the fallback. New with this arc — no shipped mission has ever needed it, because no shipped clearance changes its *picture* on a recon, only its ambushes | `briefing_variants` (§9 P1) | `sim-guard` + `render-vfx` |
| **G-B** | **A trigger cannot fire on a `SimEvent` or on an objective.** Every displacement here is on `casualties_pct` or a clock. Five `radio` rows in this sheet are `engine` for this and nothing else | two `on.kind`s — `sim` (one of the 24 `SimEvent` kinds) and `objective`; the tutorial's `await` already gates on every `SimEvent`, so the predicate is reused | `sim-guard`; Act II **G-E** |
| **G-C** | **An author cannot choose where an enemy round lands**, so T-QH10's literal form is unbuildable. Delivered by placement instead — the families walk the axis his indirect fire already walks | out of scope | `sim-guard`; Act II **G-F** |
| **G-D** | **The radio overlay does not exist.** Every `say` row lands in the notice feed and on the commander bar with no portrait, no plate art and no voice, so the four speakers are told apart by an uppercase initial (`sayNotice`) and by `speakerPlate`. **Not blocking** — the lines arrive. It is the single largest thing standing between this sheet and the reader | frame, plate and portrait slot; the five portraits already ship | `render-vfx`; Act II **G-J** |
| **G-E** | *(see G-B)* — recorded once, referenced from the tables as G-E for continuity with `tel_marum/narrative.md`'s numbering | — | — |
| **G-F** | *(see G-C)* — same | — | — |
| **G-H** | **A civilian reaching the refuge is silent.** `describeMissionEvent` has no `evacuated` case, so it falls to `default: return null`. Two of this arc's three missions score on civilians and the mechanic produces no toast, no sound and no line until the objective's own count lands | one `case 'evacuated'` | `render-vfx`; Act I **G-B**, still open |
| **G-I** | **`built` prints a raw unit id** — `reinforcement deployed — inf_squad`. Mission II buys squads across seven minutes, so it fires repeatedly | look the display name up from the unit JSON | `render-vfx`; Act I **G-D**, still open |
| **G-J** | **`civ_refuge [10,43]` is in no declared zone**, so an `evacuate_before` naming it throws at load. This is a content trap for anyone authoring from the marker list, and it is why mission III needs the `clinic_yard` marker (`design.md` C4). §5's last ambient row states the same fact in the fiction | C4's marker, or a zone around `civ_refuge`; **say which in the map, not in a comment** | `mission-author`; `design.md` **G9** |
| **G-K** | **`pnpm validate:audio` cannot accept a voice file.** `KNOWN_EVENTS` is six weapon and impact events, so every `eva` line in the campaign and every voice recording is blocked on the gate widening first | a non-weapon set kind and its events | `content-validator`; GH-110 |
| **G-L** | **A town cannot say it is unwritten.** `world.schema.json` has no `planned` property, so the moment `qarn_hadid` lands in `world.json` with three mission ids and no files, the campaign board is worse than it was. **`world.json` and the mission files must land in the same commit** | `planned: true`, excluded from `regionProgress` | `sim-guard` + `app`; Act II **G-L** |
| **G-M** | **The campaign board reads towns from the GLB.** A `world.json` town with no marker node fails `world-scene.test.ts` and draws an invisible pin on the default renderer. Qarn Hadid needs one (`design.md` C6/O-QH2) | one line in `TOWN_SITES` and a re-export | `blender-art`; `design.md` **G8** |

---

## 11. GDD amendments

**§11 needs one correction, and it is not this arc's doing.** Checked clause by
clause against what Qarn Hadid does: Shai a Major throughout with no promotion
inside a town (§1–§3, and `design.md` C3 confirms `commander.json` needs no
change); Idit supplying the picture and never giving an order — every `say`
attributed to her in this sheet was re-read for an imperative and none carries
one; one villain per front, opened by an atrocity and ended captured or killed,
present in between through what he does (§0.3, §4); and *"missions may turn the
plot inside the level… where the declarative vocabulary can express it"*, which
is §7's classification exactly.

The one sentence that is **false against shipped data** is this, from §11's
second paragraph:

> *"…and every mid-mission transmission comes from one of them."*

`mission.schema.json` `$defs.say.speaker` is `shai | idit | net | enemy`, and the
shipped tree already uses all four: `net` in `wadi_halam_4_village` and three
Umm Zeitoun missions, `enemy` in `umm_zeitoun_4_clearance` and
`wadi_halam_5_depot`. **Exact replacement text for §11:**

> **Idit Zohar**, an intelligence officer who was in the same compound at First
> Light, grows beside him and provides the intelligence in every mission. The two
> of them are the voices of the HUD: every briefing is a two-hander, Idit's
> picture and Shai's plan, and mid-mission transmissions come from them, from the
> brigade net, or — rarely, and only through something he has just done — from
> the enemy.

+1 clause, no decision moved. **Version line: 1.2.1 → 1.2.2.**

**Not applied this pass**, deliberately. `docs/GDD.md` was not edited. The
correction is independent of Qarn Hadid and should land in whichever commit the
lead takes, rather than in a documents-only pass on a design that §8 has not
signed. Say the word and it goes in as one sentence and one version bump.

### 11.1 GDD §2 — the town list, gated

`design.md` **C5** requires one word in §2's town list:

> **Towns:** Beit Sahwan, Khan Rafid, Deir Amun (Marj) · Tel Marum, **Qarn
> Hadid**, Umm Zeitoun (Sur) · Wadi Halam (Naharin).

**Proposed, not applied, and it must not be applied first.** Qarn Hadid is not in
`mission.schema.json`'s `town` enum (six values, censused this session), not in
`world.json`, and has no mission files. A town in the GDD that the tree cannot
load is a document telling a reader something the game will deny. It lands with
C1 and C2 or it does not land. Owner `narrative-designer`, gated on
`mission-author`.

### 11.2 `storyline.md`

**No edit needed.** §3.2's Act II table, §4.3's Qarn Hadid sketch and §2.3's
LANTERN entry are all still true of what is written here. Two of the sketch's
rows are now stale in a *different* document and `design.md` §4 already supersedes
them — §4.3's ladder names `qh_gate_watch` (count 3) and *The Terraces*, where
the adopted Option A has two separate gate tags and calls the third mission *The
Village Road*. That is the design's correction to make, not this sheet's, and it
is recorded here so nobody later reads the sketch as canon over the MDD.

---

## 12. Row counts

Every table row in this file whose last cell is `live`, `schema` or `engine`,
counted by script rather than by eye.

**118 rows** carry one.

| status | rows | what they are |
|---|---|---|
| `live` | **91** | `toast` 38 · `radio`, i.e. a `say` on a trigger, an objective or a wave, 29 (I 11 · II 8 · III 9 · the HELD enemy line 1) · `title` 3 · `brief` 3 · `debrief` 6 · `dispatch` 1 · `aftermath` 1 (the deliberate none) · twist rows 9 · one row recording a **deliberate silence** (the `survive_until` that cannot fail) |
| `schema` | **0** | none. Every field this arc needs exists |
| `engine` | **27** | ambient lore 16 (`radio`) · `radio` bound to a `SimEvent` 5 · `toast` 3 · the T-QH10 twist row 1 · the two `briefing_variants` proposals in §9 2 |

**One of the 91 `live` rows is HELD and must not be authored** — Karim Adhal's
line in §4. Its status is `live` because the surface and the portrait both exist,
not because the line ships. **90 rows are text `mission-author` can paste.**

**27 `engine` rows.** They are blocked on exactly four things and nothing else:

1. **A trigger that can watch a `SimEvent` or an objective** (§10 G-B) — five
   `radio` rows: the drone dying and the tube firing in I, the demolition party
   dying in II, the first ROE deduction in III, and T-QH10's literal form. Every
   one of them is a line the mission already earns and cannot say.
2. **Two hard-coded toast paths** (§10 G-H, G-I) — three rows: the silent
   `evacuated` in I and III, and the raw unit id on `built` in II.
3. **A briefing that can branch on the ledger** (§10 G-A) — three rows: T-QH10's
   entry in §7 and the two proposals in §9. New with this arc.
4. **No event and no surface at once** — the sixteen ambient rows in §5, which
   have nothing to fire on and nowhere to appear. They are written because the
   ground is measured, not because they are close.

**23 % of the writing in this arc reaches nobody**, against 22 % in the rest of
Act II and 40 % in Act I. It is level with Act II rather than better, and the
whole of the difference is §5: sixteen ambient rows are a larger fraction of a
three-mission sheet than twenty-five are of a seven-mission one. **Excluding
ambient lore the figure is 11 of 102, or 11 %** — every other line in this arc is
a field that exists and a string somebody can paste.

**What was applied to any file this pass: nothing.** The three mission JSONs do
not exist; `qarn_hadid` is not in the `town` enum; the town is not in
`world.json`; `docs/GDD.md` was not touched. What was *run* was the beat check —
a port of `briefingBeats` over all three briefing strings — and it is the only
claim in this document that needed a machine:

| mission | chars | beats | every beat ≤ 240 and ≤ 2 sentences | inside the shipped 385–1,225 band |
|---|---|---|---|---|
| I — Both Gates | 1,006 | 6 | yes | yes |
| II — The Shoulder | 1,011 | 6 | yes | yes |
| III — The Village Road | 1,213 | 7 | yes | yes |

All thirty-seven `dispatch`, `say`, `say_on_fail`, `debrief` and held lines were
length-checked against the schema's 240-character cap; the longest is the
`dispatch` at 211.

**What `mission-author` applies from here**, in order of what unblocks the most:
`mission.schema.json`'s `town` enum value and `world.json`'s town entry together
(§10 G-L — neither alone); the `clinic_yard [44,10]` marker (§10 G-J); then the
three mission files, each with the `briefing` string printed whole above, its
objective labels, its `say` and `say_on_fail` lines, its `debrief`, and — on
mission I only — the `dispatch`. Then `pnpm validate:data`, `pnpm test`
(`loading.test.ts` covers the beats), and `playtest`'s three passive controls
before its three plans, in that order, because a passive control that comes back
`ongoing` is a finding about the ground and not a number to tune.
