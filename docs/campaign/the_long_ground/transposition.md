# The Long Ground: transposition map

**Date:** 2026-11-15 · **Author:** `campaign-historian` · **Status:** proposal. Nothing
here is canon until the lead signs it.
**Reads:** `dossier.md` (cited only by beat ID), `docs/campaign/README.md`,
`docs/campaign/storyline.md` §0, §2.4 and §3, and `docs/GDD.md` §2, §4 and §6.
**Hands to:** `arc-outline.md`, then `campaign-designer`.

This file maps each real beat to the fiction. Every row says what is **kept** (the
structure) and what is **changed** (names, identities, exact geography). No real place,
person, operation, formation or insignia appears below, and the PR body shows the
deny-list check that proves it.

---

## 1. The ground: real geography to the Marj Strip

The Marj Strip is already the territory (GDD §2: a dense coastal enclave pressed between
the sea and Kedem, with the Ashwar Front's doctrine of tunnels, IEDs, ambush and human
terrain). The arc keeps its three shipped towns and adds four. Every new name was
searched once on 2026-11-15 for a real place, person or armed group of that exact name.
None was found, and one candidate failed (below). A single search is weak screening, and
it is L-2 in the outline.

| real feature (dossier) | fictional feature | status | kept | changed |
|---|---|---|---|---|
| the northern towns and the first ground entry (P1-b) | **Beit Sahwan**, the perimeter town | shipped | the war opens on the enclave's edge, and the first ground taken is the town around the perimeter | everything nameable |
| the main city, its ring and its coastal quarter (P1-c to P1-i) | **Qasr Liwan**, the Marj's city, up the coast road from Beit Sahwan | **new** town | a large inhabited city that is encircled, cut off from the south, and raided from above and below | the name, the layout and the institutions; the hospital becomes a *clinic* (an existing structure type), and the aid agency's headquarters becomes a *relief depot* |
| the dividing corridor (P1-d, T8) | **the Cut**, a road the brigade holds across the enclave south of Qasr Liwan | **new** map feature | it splits the enclave, is held for the rest of the war, and later phases rest on it | its length, its name, and the demolition along it (the fiction never razes houses to widen it) |
| the second city and the central camps (P2-a to P2-c) | **Khan Rafid** (the dense, inhabited middle) and **Deir Amun** (the junction where the routes meet) | shipped | the main effort shifts to the enclave's second stronghold: dense, inhabited, fought above and below ground | both are already fiction. **Observation for the lead:** *Khan Rafid* reads as a blend of the real second city's and the real border city's names (L-9) |
| the border city, its crossing and the border corridor (P3-a to P3-c) | **Bir Tarsha**, at the Marj's southern end. **The Gate** is the crossing; **the Fence Road** is the strip along the border | **new** town | the last stronghold is on the far border; the fight is for a crossing and then for the whole strip, to cut what runs under it | the neighbour is the **Kharat Badlands**, an existing region in `data/campaign/countries.json` with no fiction yet, given only one fact: it is neutral ground across a fence that nobody fires across |
| the three northern towns of the siege (P4-a to P4-d) | **Jurf Nadi**, the camp quarter north of Beit Sahwan, fought in three parts (the camp, the orchard edge and the fence hamlet) | **new** town | ground taken in the first month, reconstituted and fought again; evacuation orders; IED-rigged streets; a final complex; a withdrawal to a buffer | three towns become one town's three quarters, because a mission carries one `town` |
| the main city in the last offensive (P5-b, P5-c) | **Mina Sahil**, Qasr Liwan's harbour district | **new** town | the city is encircled and entered a second time, and the war stops on a marked line | the line is **the Line**: a fictional boundary, never a real map line, colour or name |
| **name that failed screening** | *Ras Ghadir* (an alternate spelling of a real border crossing) | **dropped** | | |

**Also coined:** *the Cut*, *the Gate*, *the Fence Road* and *the Line*. These are plain
English nouns for features, and they stay so.

---

## 2. Phases: real to acts and towns

The game's war order is proximity, then standoff, then source (D10): the Marj, then Sur,
then Naharin. The real phases split cleanly across that order. Phases 1 to 3 belong to the
first winter in the Marj. Phases 4 and 5 are a *return*, after the other fronts: reconstituted
ground, then capture and hold, then a line. `arc-outline.md` §1 sets out the placement
options, and this table assumes the recommended one, Plot A.

| real phase (dossier) | fictional act and town | kept | changed |
|---|---|---|---|
| P0, the attack | Act I · Beit Sahwan, *First Light* (shipped) | settled canon, D12 | not reopened |
| P1, entry, ring, cut, truce, the hospital and the bunkers below the city | Act I · **Beit Sahwan I to IV** (shipped), then **Qasr Liwan I to V** (new) | entry on the edge first, then the city: a ring, a cut, a pause, a clinic yard and a grid below the shore | the order inside the phase (§5) |
| P2, the main effort shifts south and the brigades pull out | Act I · **Khan Rafid I to IV** (three shipped, one new) and **Deir Amun I to III** (shipped) | the second stronghold, dense and inhabited, fought above and below; the act's brigades go home, and one battalion stays on the Cut | the withdrawal (P2-d) is told, never played: a `dispatch` on Bir Tarsha I |
| P3, the border town and corridor | Act I · **Bir Tarsha I to V** (new), the act's last town | the crossing, the whole strip, the routes under it, two rescues, the dozers | the act boundary moves from Deir Amun III to Bir Tarsha V |
| (the other fronts) | Act II, Sur, and Act III, Naharin (shipped, unchanged) | | |
| P4, the siege of the north | **Act IV · Jurf Nadi I to IV** (new) | the return: the same enemy reconstituted on ground taken a year before; a ring, evacuation, rigged streets, a final complex, a withdrawal to a buffer | three towns become one; the leader's death is not made its cause (dossier D-1) |
| I-1, the second pause | told, between Jurf Nadi IV and Mina Sahil I: an `aftermath` and a `dispatch` | the pause and its end | not played: the Act I pause already is the war's buildup (§4, the pause) |
| P5, capture and hold, then the city, then the line | **Act IV · Mina Sahil I to IV** (new), the campaign's last town | ground held as territory, the city entered again, and a stop on a marked line | control is ground the player *takes and holds* (income zones), never a percentage the fiction asserts (dossier D-2) |

---

## 3. Operation shapes to mission archetypes

| beat | real shape | mission archetype (GDD phase · objectives) | mission |
|---|---|---|---|
| P1-b | entry on several axes, at night, into the edge towns | already Beit Sahwan I and II | shipped |
| P1-c | encirclement of a city | **foothold** · `hold_for` on two ring zones, `capture`, waves from vents | Qasr Liwan II, *The Ring* |
| P1-d | a corridor cutting the territory, held from then on | the same mission: the second ring zone **is** the Cut. The civilians moving south across it are an `evacuate_before` (residents, not captives) | Qasr Liwan II |
| P1-f | a truce with daily releases, aid and a no-fly window | **buildup**, GDD §4's "one phase where the player has breathing room" · `evacuate_before` (`hostages: true`) from a handover point, `hold_for` staging, and `no_collateral_above` as the ceiling. The pause ends on a `timer_s` | Qasr Liwan III, *The Pause* |
| P1-e | a hospital compound encircled and entered, a shaft found, a contested claim | **clearance** · `capture` of the yard, `evacuate_before` for the clinic's people, a `collapse` on the route whose mouth is in the yard, and a ceiling. The clinic must stand | Qasr Liwan IV, *The Clinic Yard* |
| T3, T4, P1-g, P1-i | detection before entry, flooding, a multi-level grid, a node under a relief compound | **subterranean** · map first (`mark_tunnel` carriers), then the pumps (a `hold_for` stand-in, gap G-4), then `collapse`; the relief depot is flagged and must not come down | Qasr Liwan V, *The Pumps* |
| P2-a to P2-c | the main effort to the second stronghold | shipped as Khan Rafid I to III and Deir Amun I to III; re-briefed only (dispatch lines) | shipped |
| P3-a | seize a border crossing | **recon**, then **foothold** · `locate`, then `hold_for` and `capture` at the Gate, with a never-fire-across border zone flagged | Bir Tarsha I and II |
| P3-b, T6, T8 | take the whole border strip; demolish fortifications and shafts | **clearance** · the lead's **dozer escort**: `escort` + `raze` + `collapse` + `no_collateral_above` | Bir Tarsha IV, *The Blade Line* |
| P3-c, P1-h | cross-border routes; a vehicle-wide route near a crossing | **subterranean** · `collapse` along the Fence Road | Bir Tarsha V, *Under the Fence* |
| P4-a to P4-c | a ring around a reconstituted camp; evacuation orders; IEDs | **recon**, **foothold**, **clearance** · `locate`, `evacuate_before` (residents), `hold_for`, `capture`; ambush and charge stances | Jurf Nadi I to III |
| P4-d, P4-e | a final complex destroyed; a ceasefire and a withdrawal to a buffer | **subterranean** · `collapse` + `raze`, then the `aftermath` | Jurf Nadi IV, *The Complex* |
| P5-a | take and hold most of the territory | **buildup** · income zones as held ground, several `hold_for`, production | Mina Sahil I, *Held Ground* |
| P5-b | encircle the city and enter it | **clearance** · `capture`, `evacuate_before` (residents), `eliminate_hvt` | Mina Sahil II and III |
| P5-c | a ceasefire on a fixed line, then a withdrawal to it | **clearance** · `escort` of the forward force back behind the Line, `survive_until` the hour, and a ceiling | Mina Sahil IV, *The Line* |

---

## 4. Rescue raids to fictional rescues

The rule binds hardest here. **The taken are fictional people,** introduced at First Light
(D12): soldiers from the overrun outpost and families from the villages. No rescue below
depicts, names or paraphrases a real captive. Each keeps only the **operational shape**:
time of day, building, number of sites, cover and extraction.

| beat | shape kept | fiction | mechanic | changed |
|---|---|---|---|---|
| **R1** | night; the first ground days; one taken soldier freed by a ground raid | Qasr Liwan I, *The Lookout*: the night after the ring begins, Idit has one house. One lookout taken from the outpost at First Light is inside it | `time_of_day: night` (presentation only: `docs/agent-notes/` and CLAUDE.md; darkness changes nothing in the sim, gap G-11). `locate` the house's guard, then `evacuate_before` with `hostages: true` and a count of 1. The taken soldier is a `civilians` placement, because a friendly-tagged prisoner does not exist (gap G-7) | the place, the person and the unit |
| **R2** | night; a second-storey apartment; guards killed on entry; strikes as covering fire for the extraction; a firefight on the way out | Khan Rafid IV, *Second Floor*: two of the taken on the upper floor of an apartment block in the souk. The guards are a `garrison` in the block. Covering fire is the air strike (250 Intel), and **where the player drops it is the Conduct decision** | `evacuate_before` (`hostages: true`, count 2), `eliminate_hvt` on the guard tag, and the strike as covering fire. The block is not flagged, and its neighbours are | the city and the people. One apartment block stands for the whole building |
| **R3** | daytime; two apartment buildings about 200 m apart, entered at once; a heavy gunfight on the way out | Bir Tarsha III, *Two Houses*: two blocks about ten tiles apart in the town's camp quarter, with two of the taken in one and two in the other | two guard tags (`eliminate_hvt` ×2); `evacuate_before` (`hostages: true`, count 4); one shared extraction zone; `no_collateral_above`. Holding the first block while the second is still being entered is the decision | the record's camp becomes the border town's camp quarter (dossier D-4) |
| **R4** | the taken found **alone** in an underground chamber by troops searching the complex; no resistance | Bir Tarsha V, *Under the Fence*: while mapping the Fence Road's routes, the engineers find a chamber at one route's head with one of the taken in it, left there | **a surface stand-in, flagged:** player units cannot be placed `in_tunnel` (`tools/validate_data.mjs` refuses it), and a buried civilian can never surface (Beit Sahwan design §9 G3). The chamber is a `concrete` structure at a mouth, with the captive placed beside it. It is a carrying secondary, `evacuate_before` (`hostages: true`, count 1), and it must be done **before** that route is collapsed | below ground becomes a sealed surface chamber at the shaft head |

Every rescue writes `civ.hostages_recovered` through `hostages: true` and needs
`hostages_place` (`mission.schema.json`). `evacuate_before` counts **every** civilian who
reaches the refuge, and cannot name a group (Beit Sahwan design G5). Counts are therefore
set as Beit Sahwan IV's are: high enough that at least one of the taken must come out.

---

## 5. Engineering problems to game mechanics

| real problem | game mechanic today | gap (`arc-outline.md` §9) |
|---|---|---|
| detect and map before entry (T3) | `mark_tunnel` carriers: `ugv_recon_dog` (the camera robot, standing in for the dogs and robots), `recon_drone`, `scout_shachaf`, `recon_zikit` and `yahalom_squad`. A route is identified only while a carrier holds a sight line (`docs/agent-notes/mission-findings.md`) | `locate` targets units, never routes, so "map N routes" is not an objective. Fallback: `collapse` already needs the route found |
| flooding (T4) | none | G-4: a `flood` trigger action. Fallback: `hold_for` the pump yard as the fiction of pumping, with the collapse as the real kill. Carry the record honestly: the water does not reach the deep tier |
| command-bunker raids (T5) | `collapse` of every route with a mouth in a zone; `in_tunnel` garrisons that vent; `capture` of the shaft head | G-5: player troops cannot go below ground. Raids stay at the shaft head, as Beit Sahwan IV does |
| border-corridor demolition (T6) | `collapse` along a long zone with `yahalom_squad`; a primary collapse needs `seconds` | G-12: wave `from` a tunnel is unimplemented (`mission-findings.md`), so routes "producing until collapsed" are `in_tunnel` garrisons |
| vehicle-wide tunnel (P1-h) | `tunnel_travel` is unit data only; no vehicle moves underground | G-13: told, not played. One route is drawn wider, the briefing says a truck could pass, and nothing in the sim changes |
| clearing fortifications, shafts and weapons sites for a buffer (T7, T8) | `dozer_d9` (blade, `demolition_time_s` 2, speed 0.6 tiles/s, unarmed, `wheeled: true`) and `demo_squad`; `raze` on the enemy-owned works (`militia_firing_position`, `militia_observation_post`, `militia_weapons_workshop`, all `owner: 1`, `roe_penalty` 0) | G-1, G-2, G-3: the escort semantics, and a dozer that cannot set a tunnel charge (the outline's dozer section) |
| dividing corridor (P1-d) | a held zone (`hold_for`), income zones and a `supply_corridor` | none |

---

## 6. Constraints to the game's systems

| real constraint | game system | how |
|---|---|---|
| civilians in the fighting | **Conduct** (ROE): `flagged_zones`, `fail_below`, `no_collateral_above`, the evacuation objectives | every mission with civilians makes protecting them a **scored, achievable** objective, and no win needs civilian harm. `no_collateral_above` gets its first shipped use in this arc |
| evacuation orders (P2-a, P4-b) | `civilians` groups and an `evacuate_before` refuge | residents walk out through a checkpoint the player must hold. Failing it is a lost mission, never a win by other means |
| the captives | `hostages: true`, `civ.hostages_recovered`, `hostages_place`, and the board's "N came back at <place>" | the taken are fictional (D12). They are never killed by a scripted line in this arc: the T1 "execute" verb (storyline §7 G7) is not used |
| truces and pauses (P1-f, I-1, P5-c) | the buildup phase; `timer_s` triggers; `no_collateral_above` | G-6: there is no mission-side "weapons held" window. The versus set-up (`Sim.beginSetup`, `setupActive`) holds fire for both sides and could be reused |
| ceasefire clocks | `time_limit_s` (at least twice `target_minutes`) and `survive_until` | the Line's hour is a `survive_until`. The mission's `time_limit_s` stays the separate, longer backstop |
| the share of territory held (P5-a) | `resources.income_zones` pay only while held | control is earned, measurable ground, and the fiction states no percentage |
| troops withdrawn, one force kept on the corridor (P2-d) | `roster.surviving_units` and the act boundary | told in the story voice; the ledger carries what survived |
| a commander killed by chance (P3-e) | `eliminate_hvt` on a tag the briefing never mentions, as a secondary | **only the structural hinge** is kept: the front's commander falls in the border town and the remnant regroups in the north. The manner of the real death is not reproduced (outline L-4) |

---

## 7. What the fiction could not carry

| real beat | why not | what stands in |
|---|---|---|
| a captive met *underground* (R4) | player units cannot enter tunnels, and buried civilians cannot surface (G-5) | a sealed chamber at the shaft head |
| flooding as a mechanic (T4) | no flood verb (G-4) | a pump-yard hold, plus the collapse |
| vehicles underground (P1-h) | no underground vehicle movement (G-13) | told in the briefing |
| a truce in which neither side fires (P1-f) | no mission-side weapons hold (G-6) | the buildup phase, with the enemy held back by stance and distance |
| the leader's death in its real manner (P3-e) | it would paraphrase a real person's death | a nameless block commander, killed in a firefight the player chooses to have |
| three northern towns (P4) | one mission carries one `town` | three quarters of one town |
| the real buffer clearing, which reportedly took homes and farmland (T8) | the civilian rule: no win may need civilian harm | the dozers raze enemy works, shafts and berms on emptied ground beside, and never inside, a flagged inhabited edge |
| the hospital's contested command centre (P1-e) | the fiction must not take a side on a disputed claim, and the clinic must never be the target | the shaft is in the **yard**: found, mapped and collapsed, while the clinic stands and its people walk out |
