# Field commanders ("heroes"): concept options (GH-298)

**2026-09-30** · status: **concept menu, docs only.** The lead picks. After that come G-NUM,
G-MOCK and the Meshy estimate. · base `main` `3c4cd941` · downstream: `narrative-designer`
(names, bios, voice), `balance-analyst` (every number marked **P**), `sim-guard` (every
concept marked **S4**, Stage 4 or later, sequenced after FW #277 and E6 #274).

Every number below is marked **P**, a placeholder for G-NUM. Every code claim was read
this session, and its path is cited.

**Hard constraints this menu is written against.**
- **The combat model is the product.** A commander changes how troops fight: nerve,
  timing, coordination and fire control. He never makes a rifle hit harder. No ability
  here adds damage or penetration.
- **No permanent status marks in the world.** Status goes on the HUD and the icons.
- **GDD §2 asymmetry.** The enemy's leaders are not mirror heroes.
- **Roar coins never buy advantage** (GDD §9). A commander is never bought for Roar coins,
  and never for credits either.
- **The fictional Kedem layer.** Every name needs a rule-3 screen (storyline §2.4).

---

## 0. What exists today, measured in code

These facts decide what a commander can be.

| fact | where | consequence for commanders |
|---|---|---|
| Suppression decays by a global `SUPP_DECAY` (λ 0.15/s). A unit pins above 0.70 and unpins below 0.45. | `tuning.ts:82-84`, `sim.ts:5090-5105` | Leaving 0.70 takes about 2.9 s once the fire lifts. A "presence" effect is a per-unit decay term. |
| A soft unit pinned for 200 ticks (10 s) routs. It rallies only when its suppression falls under `UNPIN_AT`. | `tuning.ts:165-169`, `sim.ts:5108-5118` | "Rally" and "hold the line" are two numbers, the rout delay and the unpin, and both live in one loop. |
| Veterancy is 0–3. Each level gives +6% accuracy and −8% incoming suppression. | `tuning.ts:133-135`, `sim.ts:4120` | "Fights one level steadier" is already a legible unit of measure. |
| **Contact is per SIDE, not per unit.** | `sim.ts:2673` `contact[side * capacity + target]` | Everything one KDF unit identifies, every KDF unit knows. **A "share contact" ability would do nothing.** The intelligence officer below is built around this fact. |
| A precision strike picks the **first living player unit** as its caller. It makes no line-of-sight test. | `mission.ts:651-663`, `sim.ts:2218-2234` | An observer who actually has to see the target is new. Strike: 600 damage, 2-tile splash, 3 s delay, 0.3-tile scatter (`tuning.ts:216-221`). |
| `call_strike` is in the ability enum. No unit carries it and nothing reads it. | `unit.schema.json` abilities, `sim.ts:492-494` | This is the free hook for the fires officer. |
| `mark_target` only earns Intel, 5/min, for a stationary carrier. | `mission.ts:1061` | "Marking" as a combat effect is new. |
| Smoke: 3-tile radius, 9-tile reach, 45 s cooldown, per unit. | `sim.ts:2176-2199`, `tuning.ts:196-205` | A multi-unit smoke order is an app-side fan-out of existing commands, with **no sim change**. |
| An enemy trigger's `casualties_pct` counts the whole mission's enemy. There is no "this tagged unit died" condition. | `mission.ts:1628-1640`, `mission.schema.json:511-520` | An enemy leader whose death matters needs one new trigger condition. |
| FW's `aura` block is structure-sourced. `stepAuras` fills per-unit SoA arrays every 10 ticks, taking the MAX over sources. | FW spec §3, §7 | A commander's command radius is the same reader with a unit as the source. |
| A defeat writes nothing to the ledger. | brigade economy §4.2, motivation D4 | A commander's death sticks only on a victory, which is the rule `roster.surviving_units` already follows. |

---

## 1. What a field commander IS in this model

Three shapes are possible. They differ in what the sim must learn, what the art costs, and
how the player finds the commander without a mark over his head.

| | **A. Command team** (recommended default) | **B. Command hull** | **C. Attachment** |
|---|---|---|---|
| what it is | Its own foot unit, crew 2: the officer and a signaller. Role `support` (the E5 G3 precedent: `recon` reads as a vehicle). | A vehicle type that *is* the commander's tank or APC, e.g. a Lavi with a command mast. | A commander rides on an existing unit and has no body of his own. The host carries a `commanderOf` index. |
| data | New unit JSON plus a `command` block (§5.1). | The same `command` block on a hull JSON. | A `commanders/*.json` file with no hull, plus a mission `commander_slots` that names a host. |
| pathing | Foot domain. Nothing new. | Vehicle domain. Nothing new. | Moves with the host. Nothing new. |
| RNG | Own entity, own stream (invariant 3). His rolls never perturb another unit's stream. | Same as A. | Draws from the **host's** stream. Attaching mid-mission shifts that stream, so attaching must be fixed at spawn. |
| death | Team destroyed: roll wounded or killed on his own stream (§3.1). | Component table (GDD §5.4): crew shaken suspends command, a mobility or firepower kill wounds him, a catastrophic kill kills him. | The host dies: roll as for A. |
| found without a world mark | A portrait slot on the HUD strip (click to select, double-click to go to him). His radius draws only while he is selected, hovered or arming an order (FW treatment B, the dashed ring). Covered units get a card chip. Silhouette lever: a whip antenna and a map case. | Same HUD slot. The hull's silhouette lever is a tall mast. | HUD slot only. The host looks like any other Lavi. **This is the weakest to read.** |
| art | One figure team, 40 cr. | Textured vehicle 35 cr, or a Blender variant of the parent hull at 0 cr with an IoU-≥0.88 risk against that parent. | 0 cr. |
| sim cost | Low. Unit-sourced aura and charged orders (§5.2 N1, N2). | Low, plus the component-to-command mapping. | **Highest.** A host index, carried death, and a new "who is the commander" read in every consumer. |

**Recommendation: A for foot concepts, B only if the armour commander is chosen.** C is
cheap in art and expensive in sim. It also fails the legibility rule (GDD §5.8): a commander
the player cannot find on the field is a stat buff. **Shai is never a unit.** He is the
player's command, the voice on the bar, and the man the ROE bill is addressed to. Putting
him on the map would make his death end the campaign.

---

## 2. Five commander concepts

The names are **placeholders**: given names only, pending `narrative-designer`'s rule-3
screen (storyline §2.4). The squad callsign table forbids given-name-plus-surname
(`names.md` §2). A commander is a *person*, which is exactly why he needs his own register
and screen.

### 2.1 Infantry company commander: "Maya" (placeholder) · shape A

**Bio hook.** She was a platoon leader inside the compound at First Light, the officer
beside Shai when the perimeter went. When Shai makes Major at the Act I boundary, *his
company becomes hers*. She is the player's old job, done by someone else. That is also why
she is the one person who says his rank wrong. **Earned** at the Act I boundary
(`after_mission: beit_sahwan_4_subterranean`). She is the story's gift, not a purchase.

| ability | mechanism | cost / cooldown | counterplay |
|---|---|---|---|
| **Presence** (passive, radius 5 **P**, foot) | Foot units in radius decay suppression at λ 0.225/s instead of 0.15 (**P**, ×1.5), and rout after 15 s pinned instead of 10 (**P**). **Off while she herself is pinned**: a pinned officer is not commanding. | none | 5 tiles is inside an enemy rifle's 8, so presence means exposure. Fire on the command team switches the whole radius off. |
| **Rally** (order) | Routed or pinned own foot within 4 tiles (**P**) have suppression set to 0.44, just under `UNPIN_AT`. That fires the existing `rallied` path (`sim.ts:5099-5105`) and they take orders again. Her team's signature is ×2 for 10 s: she stood up. | 2 charges a mission, 30 s cooldown (**P**) | Troops still under fire re-pin in seconds. Rally is timing, not a shield, and it paints her. |
| **Assault on my mark** (order, time window) | For 20 s (**P**), selected foot within 6 tiles pin at 0.85 instead of 0.70 and take ×0.8 incoming suppression. They push through. For 20 s afterwards they recover at half rate: the price of the push. | 1 charge a mission | An ambush (`ambush(3)`) still springs. The window is fixed. The after-cost lands if the assault stalls. |

**Wounded or killed.** When the team is destroyed, roll on her stream: **wounded 65%, killed
35% (P)**. Wounded means out for the next mission. Killed means gone for this campaign.
**The player loses** faster recovery, the rally and the one assault order. The company still
fights, at the model's base nerve.

### 2.2 Forward observer / fires officer: "Yoav" (placeholder) · shape A

**Bio hook.** He was attached for Sur, and he is Kedem's answer to LANTERN: *an observer
sent to hunt an observer* (storyline §2.3; `rocket_battery` fires on what someone else
sees). Act II's question is "can you reach?", and his whole kit is reach bought with
exposure. **Earned** by stars (`stars_min` about 20 **P**, which falls between the Tzinah's
12 and the Shachaf's 30).

| ability | mechanism | cost / cooldown | counterplay |
|---|---|---|---|
| **Observed fire** (passive) | KDF indirect rounds (`mortar_team`, precision strike) aimed at a target he has line of sight to land with **half scatter (P)**. Unobserved fire is unchanged. This is the real difference between adjusted and predicted fire. | none | Kill him, or smoke his line: `raySmoke` already blocks sight. Sarim spotters hunt observers too. |
| **Priority call for fire** (order) | He calls the precision strike himself. The strike **needs his line of sight** to the aim point, scatter 0.3 → 0.15 tiles (**P**), same 3 s delay. The **first call each mission is free**. Later calls cost Intel as today (250). | 1 free, then Intel. 60 s cooldown (**P**) | ROE: 600 damage in a 2-tile splash near a flagged zone costs Conduct, and the collateral preview still shows it. He must stand where he can see, which is where he can be seen. |
| **Registered target** (order, **S4**) | He pre-plots 1 point (**P**) at deploy or in a halt. Mortar fire on that point arrives with scatter 0.1 and no adjustment delay. This is defensive fire. | 1 point, re-plot 90 s (**P**) | Needs a new "fire at ground" command for indirect units. An enemy that avoids the point is untouched. |

**Wounded or killed.** As 2.1. **The player loses** observed fire and the free call. The
mortars go back to predicted fire, and the strike goes back to any caller at 0.3 scatter.

### 2.3 Armour commander: "Ronen" (placeholder) · shape B, or A embarked

**Bio hook.** He commanded the tank platoon that was *the relief that came late* at First
Light (storyline D12). He was not there when it mattered, and everything after is
answering that. Act II and III, where the ground opens and the Lavi and the Namer carry the
fight. **Earned** by Conduct (`roe_rating_min` 85 **P**): armour with restraint, the same
shape that gates the Namer.

| ability | mechanism | cost / cooldown | counterplay |
|---|---|---|---|
| **Fire distribution** (passive, radius 6 **P**, vehicles) | Vehicles in radius prefer an identified target that no other vehicle in radius is already engaging, before falling back to `selectTarget`'s existing order. That stops three tanks killing one technical. This is the realistic core of a company commander's job, and it adds no accuracy. | none | Scatter the targets and the effect is nothing. It touches `selectTarget` (`sim.ts:3155`), the hottest O(N²) path, so it carries the **highest §5.7 risk** (Lanchester). |
| **Crew drill** (passive, vehicles) | `crew_shaken` suppression on hulls in radius decays at ×1.5 (**P**). | none | A catastrophic or mobility kill is untouched. |
| **Smoke and bound** (order) | One click fires the `smoke` of every smoke-capable hull within 6 tiles as a single screen line across the threat axis. It is **an app-side fan-out of existing `smoke` commands**, with no sim change. Each hull spends its own 45 s cooldown. | uses the hulls' cooldowns | Smoke buys exactly one ratio step (D1). This spends it faster; it does not add a second one. |

**Wounded or killed** (shape B): crew shaken suspends command until the crew recovers; a
mobility or firepower kill wounds him, and he is out for the next mission; a catastrophic
kill kills him. **The player loses** fire distribution and crew drill. The fan-out smoke is
lost with him.

### 2.4 Engineer commander: "Dalia" (placeholder) · shape A

**Bio hook.** She is the Yahalom officer who read SPADE's routes in Beit Sahwan II and IV:
disturbed earth as intelligence. In Act III she is the one arguing that the D9 takes the
southern road (storyline §2.3, FERRY's bait). **Earned** by stars (`stars_min` about 30
**P**).

| ability | mechanism | cost / cooldown | counterplay |
|---|---|---|---|
| **Work site** (passive, radius 4 **P**) | Engineers in radius set charges in 0.7× the time (`demolition_time_s`, `tunnel_charge_time_s`) and build FW works in 0.75× the time (**P**). | none | Still held-station, still exposed. It shortens the window and does not remove it. |
| **Prove the route** (passive) | Enemy in `ambush` within 3 tiles of her team read signature ×2 to KDF detection (**P**): engineers who know what a firing point looks like. | none | Ambushes out of her 3 tiles are untouched. She has to walk point, and a walker is exposed. |
| **Dig in** (order) | Foot units in radius 3 that stay put for 20 s (**P**) raise their tile's cover by one level, capped at 2, for the rest of the mission. These are scrapes, not works. | 2 charges | Takes 20 s stationary. Mortars. Cover 0→1 is the big rung (`COVER_HIT`), so this is strong and needs its own probe. |

**Wounded or killed.** As 2.1. **The player loses** tempo on every demolition and collapse,
and the ambush read. **Overlap:** FW (build time) and E6 (the placed charge). Choose her
only if FW and E6 land first.

### 2.5 Field intelligence officer: "Omer" (placeholder) · shape A

**Bio hook.** He is Idit's forward man from her section. She stays on the net and never
gives an order; he walks her questions onto the ground. Act III, "Do not chase what runs":
the Rif disperse the moment they are seen, and he is the one who knows which of them is
worth following. **Earned** by Conduct (`roe_rating_min` 80 **P**).

Contact is already shared side-wide (§0), so none of these abilities "share contact".

| ability | mechanism | cost / cooldown | counterplay |
|---|---|---|---|
| **Hold the picture** (passive, radius 8 **P**) | Enemy contacts inside his radius decay at half rate (**P**, `CONTACT_DECAY` 0.995 → 0.9975) once unwatched. The picture outlives the eye that made it. It is **not** frozen: the playtest ruling against latched contact stands. | none | Move out of radius and it decays as normal. |
| **Exploit the find** (passive) | When a unit tagged by `locate` is identified inside his radius, every other member of its placement group becomes *suspected*: a blip, no ID. One man found tells you the cell exists. | none | A suspected blip cannot be targeted by direct fire. The player still has to confirm. |
| **Direction finding** (order) | While his team is stationary for 30 s (**P**), enemy **leaders** (§4) within 12 tiles become suspected blips. Radios give away the people who use them. | 60 s cooldown (**P**) | Only leaders show. Moving or firing breaks it. Idit's economy is thin (storyline §2.2), so this costs time, not Intel. |

**Wounded or killed.** As 2.1. **The player loses** the slow-decay picture and the leader
hunt, which is the one KDF answer to §4's enemy leaders. **Risk:** his abilities sit on
Idit's lane, and the two-voice rule needs care (Q6).

---

## 3. Campaign integration: options

### 3.1 Persistence (a new ledger key)

A new, app-written key is needed: `roster.commanders`, shaped like
`[{ id, state: 'fit' | 'wounded' | 'killed', out_until_mission?, missions, first_mission }]`.
**It is flagged as new.** None of today's keys can carry a person across missions: `roster.
surviving_units` carries types and veterancy, not identities.

| option | rule | feel | risk |
|---|---|---|---|
| **P1 (recommended)** | Wounded is the common outcome and costs the next mission. Killed is gone for this campaign. It sticks only on a victory, like any roster loss. A new campaign brings them back. | Loss matters without ending a run. | Savescum by losing on purpose: the same affordance the roster has today. Accept it. |
| P2 | Never killed, only wounded (1–2 missions out). | Safe. | A commander with no real stakes becomes a stat buff. |
| P3 | Killed → the second-in-command takes over with no service tiers (§3.3). | Continuity. | A second portrait and name per concept. |

### 3.2 How a commander is earned

Commanders reuse `unit.schema.json`'s `unlock` shape **minus `price`**, and a new rule in
`validate_data.mjs` refuses a `price` on a commander. That puts credits and Roar coins both
out of reach by construction.
- **Story entry at an act boundary** (Maya: Act I end). This matches the rule that
  promotions are act-level beats, so a new officer arrives when Shai's command widens.
- **Stars** (`stars_min`): Yoav, Dalia.
- **Conduct** (`roe_rating_min`): Ronen, Omer. Restraint earns the officers who make
  restraint cheaper, which is the §2 pillar paying out.

### 3.3 Brigade economy

| option | what improves | pro | con |
|---|---|---|---|
| **U1 service (recommended for v1)** | Missions survived. At 3: radius +1. At 6: +1 charge on the first order (**P**). Shown on the card. | Losing a 6-mission commander hurts, and the ledger already counts `missions`. | Nothing to spend credits on here. |
| U2 credit tracks | A `command.*` upgrade block via the §4.3 pre-pass. **Needs the patch whitelist extended.** | A credit sink. | It prices a person like a hull, which drifts toward "buying advantage". |
| U3 none | none | Simplest. | Flat across a campaign. |

### 3.4 Slots

A mission declares `commander_slots` (0–2). **Absent means 0**, so every shipped mission and
`playtest` stay byte-identical. The player picks at deploy (the Phase 3 "deploy as a
decision" spread). **Recommendation: 1 slot in foothold, buildup and clearance missions,
none in breach or recon.** A breach is `survive_until`, and a passive player with a free
suppression aura on a static perimeter is the exact case the passive probe exists to catch.

---

## 4. The enemy side: leaders, not heroes

**The asymmetry to keep.** KDF commanders are few and named. They persist, are earned, and
are carried by the ledger. Enemy leaders are authored per mission and are disposable,
tag-named placements. The villains are the only ones who persist, and they already do.
Killing one breaks *something different per doctrine*:

| doctrine | leader | what his death does | shape | status |
|---|---|---|---|---|
| **Ashwar** | the digger's foreman, a `militia_cell` tagged `leader` | **Ambush discipline breaks.** His group's `ambush(N)` units spring at their own weapon range instead of N. They fire early, unmask and lose the first volley. Killing him makes the enemy *worse at ambush*; they do not run. | enemy `leader` aura: group-scoped `ambush` hold | **S4** (sim) |
| **Sarim** | the section's observer, on an FW `militia_observation_post` | **They withdraw in good order.** Standoff troops who lose their eyes leave (`withdraw_to`). They do not break. | trigger `on: tag_killed` → `withdraw_to` | **schema + runtime** (no sim) |
| **Rif** | the raid leader in a `technical` (the `wh_hvt_amir` pattern) | **The raid disperses.** Technicals scatter to exits and leave (`remove`). Mobility is their armour, and leaderless it becomes flight. | `tag_killed` → `withdraw_to` / `remove` | **schema + runtime** |

`tag_killed(tag)` is **one new trigger condition** beside `casualties_pct`
(`mission.schema.json:511-520`, `mission.ts:1628`). It is the cheapest enemy half and
expressible with no sim change. The Ashwar leader aura is the only enemy item that needs
Stage 4. Leaders are **ROE bait by design**: a leader standing in human terrain is the
villain's job done small.

---

## 5. Systems reuse, and what is new

### 5.1 Reuse

| existing | reused as |
|---|---|
| FW `aura` block, `stepAuras`, MAX-not-stack, 10-tick cadence, per-unit SoA (FW §3, §7) | The command radius: `stepAuras` gains unit sources, and the same MAX rule means two commanders never stack. |
| FW treatment B (dashed ring, no fill, only while selected, hovered or armed) and the card status chip | The radius and "Under command: Maya", with no world mark. |
| E5 staged-data pattern (`docs/campaign/special_units/e5/`, `validate_balance.py --also`) | Stage the commander JSON outside the roster until the art lands. |
| `unlock` gates (`after_mission`, `stars_min`, `roe_rating_min`) | How a commander is earned (§3.2). |
| `smoke` (per-unit cooldowns) | Ronen's fan-out, app-side only. |
| Strike and sweep costs (`mission.ts:412-413`), `call_strike` (unread enum) | Yoav's priority call. |
| `rallied` event and `UNPIN_AT` | Maya's rally, with no new state. |
| `names.json` screening discipline | The commander register. |

### 5.2 New sim concepts (every one **S4**, after FW and E6; each moves the golden hash once)

| id | concept | needed by |
|---|---|---|
| N1 | Unit-sourced auras: `stepAuras` over units carrying `command`, plus new per-unit arrays `auraSuppDecay`, `auraRoutTicks`, `auraPinAt` | all |
| N2 | Charged, cooled orders: SoA `cmdCharges`, `cmdCooldown`; command kinds `rally`, `assaultOrder`, `priorityFire`, `digIn` | all |
| N3 | Casualty resolution: a wounded/killed roll on his own stream, and a `commanderDown` event | all |
| N4 | Observed fire: the indirect-shot scatter reads "does a side-0 FO see this target" | Yoav |
| N5 | Fire distribution: an "already engaged" tie-break in `selectTarget` | Ronen |
| N6 | Detection modifiers: ambusher signature near Dalia; contact decay near Omer; leader blips | Dalia, Omer |
| N7 | Cover edit at runtime (dig in) | Dalia |
| N8 | Enemy `leader` aura holding group `ambush` | Ashwar leader |

**Not sim:** the `commander_slots` and `tag_killed` schema and runtime changes, the
`roster.commanders` key (app), the smoke fan-out (app), and the HUD portrait strip and chips
(`render-vfx`, three only).

**§5.7 guard.** Like smoke (D1), §5.7 is measured **without** commanders. Add a pinned
case: *a commander buys at most one ratio step. 2:1 with Maya lands at or under the smoke
band. 1:1 with Maya **and** smoke still fails (≤ 25%).* Also re-run every passive control
with the slot filled.

---

## 6. Comparison

Art uses style bible §4: a figure team is 40 (20 + 10 + 5 + 5); a textured vehicle 35; a
Blender variant 0. Portraits come from the GH-153 Blender pipeline at 0.

| concept | fun | realism | sim cost | art cost (Meshy) | risk to §5.7 |
|---|---|---|---|---|---|
| **Maya**, infantry CO | high: rally and assault are big, readable moments | high: nerve and timing | low (N1–N3) | 40 | **medium**: the urban 3:1 curve; needs the one-step guard |
| **Yoav**, fires officer | high: a hunter's game, the LANTERN mirror | very high: observed vs predicted fire | medium (N4; the registered target needs a fire-at-ground order) | 40, or 0 as a kneeling tripod variant if IoU passes | low: mortar and strike are outside the four targets |
| **Ronen**, armour CO | medium: the effect is invisible unless explained | high | **high** (N5 in the O(N²) targeting path) | 0–35 (Lavi variant, IoU risk vs `mbt_lavi`) | **high**: Lanchester and the ATGM exchange |
| **Dalia**, engineer CO | medium: tempo rather than drama | high | medium (N6, N7) | 40, or 0 as a `demo_squad` variant | medium: dig-in cover is the big rung |
| **Omer**, field intel | medium-high on recon missions, low elsewhere | high: the per-side fact is respected | medium (N6) | 40, or 0 as a Zikit variant | low |
| enemy leaders | high: they make targets worth choosing | high | none (`tag_killed`) to S4 (N8) | 0 (tag an existing unit) | low |

**The favourite killed.** My favourite is Yoav. Without him the set is Maya plus Ronen,
which still works but carries the one high-risk sim change. That is why the fallback pair
is Maya plus Dalia, not Maya plus Ronen.

---

## 7. Recommended starting set, and questions for the lead

**v1: Maya (infantry company commander) plus Yoav (fires officer), with the Sarim and Rif
leaders through `tag_killed`.**
- They cover the two things the model is about: suppression (GDD §5.5, "the highest-value
  mechanic") and fires.
- Both are shape A, so there is one body type and one sim stream (N1–N4).
- Both enter the story at act beats that already exist.
- Art is **80 credits planned, 160 at the ceiling (≈ $1.60 / $3.20)**.
- The enemy half costs no sim.

| # | question | recommended default |
|---|---|---|
| Q1 | Which shape: team (A), hull (B) or attachment (C)? | **A**. B only for Ronen, if chosen. |
| Q2 | Death: wounded common, killed = gone for this campaign, and it sticks only on a victory? | **Yes (P1).** 65/35 wounded/killed (**P**). |
| Q3 | Earned by story, stars and Conduct only, with the validator refusing a `price`? | **Yes.** No credits, no Roar coins. |
| Q4 | Slots: a mission-authored `commander_slots`, absent = 0; 1 slot in foothold, buildup and clearance; none in breach or recon? | **Yes.** |
| Q5 | Improvement by service (missions survived) rather than credit tracks? | **Service in v1.** Credit tracks revisited later. |
| Q6 | Voice: commanders speak only in barks, and briefings stay the Shai/Idit two-hander? | **Yes.** No third briefing voice. |
| Q7 | Shai is never a unit on the map? | **Yes.** |
| Q8 | New pinned balance case: a commander buys at most one ratio step, and 1:1 with commander plus smoke still fails? | **Yes**, the D1 smoke rule applied to commanders. |
| Q9 | Starting set? | **Maya + Yoav**. Fallback Maya + Dalia. |
| Q10 | Enemy v1 = `tag_killed` (Sarim withdraw, Rif disperse), and the Ashwar ambush-discipline leader later? | **Yes.** |
| Q11 | Player-facing term: "commander" collides with the commander bar (Shai). Use **"officers"**? | **"Officers"** in the UI. "Field commander" stays the design term. |
| Q12 | Names: given-name placeholders here, rule-3 screen by `narrative-designer` before any JSON? | **Yes.** |
