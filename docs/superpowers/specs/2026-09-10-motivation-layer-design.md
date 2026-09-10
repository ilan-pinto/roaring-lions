# The motivation layer — design

**Date:** 2026-09-10. **Status:** decided by the lead, ready for an implementation plan.
**Owner of this document:** whoever writes the plan; the decisions are the lead's and are
not reopened here.

## 1. The problem

The lead's brief: *"The game is good but misses gamification and motivation to continue.
The player has no motivation to continue apart from pure fun."*

The census behind it (2026-09-10) found that the game already earns the player things and
shows almost none of them. Veterancy is real (0–3 stripes, +6% accuracy and −8% suppression
per stripe, `tuning.ts` `VET_ACC_BONUS` / `VET_SUPP_BONUS`) and invisible: roster entries are
anonymous `{type, veterancy}`. Nine of fourteen KDF units gate on the campaign Conduct rating
and no threshold crossing is announced. Recon carry-over changes the next mission and the
next mission never says so. Fourteen of eighteen missions carry secondaries that pay nothing
visible. The end screen prints two numbers. Ranks change silently.

Six project agents reviewed the first draft (campaign-designer, narrative-designer,
sim-guard, balance-analyst, render-vfx, playtest); their corrections are folded in below and
the measurements that drove them are cited where a number is load-bearing.

## 2. Decisions taken by the lead (2026-09-10)

| # | decision | consequence |
|---|---|---|
| D1 | The mission grade is three tiers in the brigade's own paperwork: **Entered in the log**, **Named in brigade orders**, **Ari'im citation** | §4.1 |
| D2 | The third tier is *every consequential secondary complete*. Losses and elapsed time are shown on the debrief, never graded | §4.1; `carries` flag on secondaries |
| D3 | Stars unlock **special units designed for this purpose**, not stat perks and not roster repairs | §4.6; a new `unlock.stars_min` gate; three new units, one per act |
| D4 | **No ironman.** Defeat keeps writing nothing; replay stays free | ironman removed from scope entirely |
| D5 | **The account of the taken** ships: a standing count of abducted people on the campaign board, moved only by rescues | §4.4; one ledger key, one mission field |
| D6 | The player-facing name of the ROE rating is **Conduct** (shipped in `706125a`) | every new surface says Conduct |

Also carried from the review, not reopened: Conduct is a **threshold** in the grade, never a
summed component and never spent; nothing ever grades kills; no XP bars, daily rewards or
loot.

## 3. Scope

**In:** the grade and its storage; a debrief screen; the campaign board's stars, villain
cards and the account of the taken; the deploy screen's "what you brought" panel; promotion
beats; unlock announcements; the star-gated special units; named units with a service record;
the veterancy earn rule; the headless assertions that keep the grade honest.

**Out:** ironman (D4); stat perks or any doctrine tree; commendation spending of any kind;
leaderboards, replays and modifiers (they wait on the replay recorder and skirmish);
any change to `packages/sim/src/tuning.ts`.

## 4. Design

### 4.1 The grade

Three tiers, ascending. Conduct is printed beside the tier unchanged.

| tier | name | rule |
|---|---|---|
| ★ | Entered in the log | victory |
| ★★ | Named in brigade orders | ★ and Conduct ≥ the mission's own `roe.fail_below` + 20, or ≥ 70 where no floor is declared |
| ★★★ | Ari'im citation | ★★ and every secondary objective with `carries: true` complete |

Why these numbers: every shipped optimal plan in `tools/src/backtest/playtest.ts` clears ★★
under +20/70 (the lowest ROE any plan posts is 75, on `beit_sahwan_breach` and
`umm_zeitoun_3_clearance`), and every passive control already loses, so the gradient
*optimal ≥ ★★, passive = 0* exists today with no tuning. "No losses" was rejected because it
cannot be counted in the three missions that build units, the optimal plans lose 11→5 and
8→4 in the clearance missions by design, and the roster already prices losses as next
mission's force.

`carries: true` is a new optional boolean on an objective in `mission.schema.json`, legal
only where `primary` is false. It marks a secondary whose result a later mission reads: a
`locate` whose tag reappears in a later mission's `intel.marked_positions`, or an
`evacuate_before` whose count feeds §4.4. Eight of seventeen optimal plans already complete
all secondaries; three secondaries are bare `survive_until` clocks that the passive control
completes (`tel_marum_1_recon`, `umm_zeitoun_1_recon`, `wadi_halam_5_depot`) and stay
unflagged. A mission with no `carries` secondary caps at ★★, and `mission-author` closes
that per mission rather than the rule pretending otherwise.

**Storage.** `campaign.mission_results` on the ledger, `Record<missionId, {stars, roe,
ticks, lost, secondaries}>`, produced in `MissionRuntime.checkEnd` in the same loop that
produces `roe.mission_ratings` (`mission.ts` ~1625–1641) and filtered by the mission's
`produces` contract like every other key. Best-of is decided without division: `stars` is an
integer 0–3, ties broken by `roe`, then by lower `ticks`. All fields are integers; `ticks` is
`sim.tickCount` at the end, and `lost` is counted over `playerIds` whose `alive` is 0
(`typeIdx` survives death, so losses by type are derivable). No floating point enters the
sim. The tutorial produces no result.

**Display.** Stars appear on the debrief screen (§4.2), on both campaign boards beside
each town's done/total (§4.3), and as the sum on the brigade screen (§4.6).

### 4.2 The debrief screen

A second screen after a mission, reached from the existing end panel, which keeps its
portrait, plate and quoted line. Storyline O7 asked for exactly this and the 420 px end panel
cannot hold a card. It shows: result and tier with the tier's line; Conduct with its
deductions listed by reason (accumulated in the app from the `roe` mission events, the sim
keeps no presentation log); elapsed time against `target_minutes`; units lost by type;
secondaries done, with the `carries` ones marked; positions marked; units promoted; any
unit newly unlocked, with the sentence `unlockReason` already produces; and the promotion
beat when a rank changed (§4.5).

The tier lines, by the narrative-designer, fixed here so they are not rewritten per screen:

- ★ Shai: "It is in the log. That is what the log is for."
- ★★ Idit: "Brigade read the file to the end and put the company in Thursday's orders. They do not read many to the end."
- ★★★ Shai: "A citation. Put it with the slip and get the men fed."

The next mission is named on this screen with one villain line (from the villain card's
current state, §4.3).

### 4.3 The campaign board

Both boards (`worldmap.ts` for Pixi, `worldmap3d.ts` for three) gain the same three things,
because these are DOM and data, not GPU effects, so Pixi parity is owed here.

- **Stars per town**: `earned / possible` beside the existing `done/total`, from
  `campaign.mission_results`. Khan Rafid, Deir Amun and Qarn Hadid are authored on main as of
  2026-09-10, so the "dead pins" prerequisite the review raised is already closed.
- **Villain cards**: one per region, portrait from `commander.json` `villains`, three states
  read from the ledger: *at large* until the region's last mission is in
  `campaign.completed_missions`, then *captured* or *killed* by which objective completed
  that mission (a `capture` primary means captured; `eliminate_hvt` means killed). Idit speaks:

  | | at large | captured | killed |
  |---|---|---|---|
  | SPADE | "The digger. Four years under the Marj, and still under it." | "Taken at the shaft head with his hands empty." | "Killed at the shaft head. The routes were his; so was the map of them." |
  | LANTERN | "He has never fired at us. He has seen every round that came back." | "Taken on the crest. He gave us the road before he gave us his name." | "Off the crest, with the basin still in front of him." |
  | FERRY | "Everything under the Marj and over Sur came up his road." | "Taken at his own gate. He asks what happens to the road." | "Dead at the gate he would not leave." |

- **The account of the taken** (§4.4).

### 4.4 The account of the taken

The story's own pull: the enemy took people on the first morning and Act I is the search
for them. The board carries one line that keeps that score and moves only when a mission
brings someone home.

- `data/campaign/world.json` gains `"taken": 19` at the root, the story constant.
- `mission.schema.json`: an `evacuate_before` objective gains optional `hostages: true`.
  When such an objective completes, the runtime writes this mission's `count` into the
  ledger key `civ.hostages_recovered`, a `Record<missionId, integer>` merged best-of per
  mission exactly like `roe.mission_ratings`, so a replay cannot double-count. The app sums
  it with integer addition. The mission must list the key in `produces`.
- The board line: `"<taken − recovered> still out."`, and after a mission that recovered
  any, `"<n> still out. <k> came back at <place>."` where `place` is the mission's own
  authored `hostages_place` string (a new optional mission field, ≤ 40 characters). The line
  is Idit's and sits under the region cards.
- The first mission to write it is `beit_sahwan_4_subterranean`, whose evacuation at the
  shaft head is already authored as five people; `mission-author` flags it `hostages: true`
  and gives it a place.

### 4.5 Promotion beats and unlock announcements

Ranks already live in `commander.json` `ranks[].until_mission` and match the act ends. The
debrief screen renders the beat from that table with the insignia when the completed mission
is a rank's `until_mission`. The three act-end `aftermath` lines already announce each star,
so no new prose repeats the count; the beat's line is:

- → Major, Idit: "Third star. Nobody said promotion — they handed him a wider map and a longer list of towns."
- → Lt Col, Idit: "Fourth star. The north has not been shelled in two days and he has not mentioned it once."
- → Colonel, Shai: "Five. They are giving me the brigade because the corridor is cut, and it is cut because you kept off the village."

Unlocks: after a mission, every KDF unit whose `unlockReason` was non-null before and is
null after is listed on the debrief as newly available, in the form "Campaign Conduct
58 → 62: Namer IFV available" or "12 stars: <special unit> available".

### 4.6 Star-gated special units (D3)

Three new units, one per act, that exist only to be earned. Each is a unit JSON in
`data/units/kdf/` with `unlock.stars_min` (a new integer gate in `unit.schema.json` and in
`UnlockGate`, read by `unlockReason` as the sum of best-of stars over
`campaign.mission_results`, computed with integer addition only), a mesh through the
Blender pipeline, and a `SPRITE_MAP` / mesh-catalogue entry so it actually draws. The
thresholds are set so a ★★ player reaches the first inside Act I and a ★★★ player reaches
the third before the last town: with 17 gradable missions (the tutorial produces no
result) and a ceiling of 51 stars, provisional gates are 8, 21 and 36, to be re-fitted once the harness reports the optimal
plans' star totals.

What the three units are is the campaign designer's brief, not this document's: each must be
a new role no shipped unit fills, must pass the cost-curve band and `pnpm balance`, and must
not raise armour, penetration, rate of fire or APS beyond the shipped roster (the §5.7
inputs). The brigade screen (a new full screen from the menu) lists every KDF unit with its
lock state and the sentence that opens it, and the star total.

A gate on `starting_force` is the same rule inverted: an optional `upgrades_to` on a
placement fields the named unit instead when its gate is open, never a downgrade, so no
proven starting force can regress.

### 4.7 Named units and the service record

Squads get callsigns, single common nouns in the materiel register (Sela, Barzel, Tzur,
Marom, Keshet, Migdal); vehicles a hull number and a painted name (1-2 Ayil, 2-1 Gachelet,
2-4 Yated); drones a task number (Eye Two, Kite One); civilians never. The table is
`data/campaign/names.json`, each entry carrying `screened: "YYYY-MM-DD"`, never built by
crossing two lists. The name is assigned **in the app**, deterministically from (mission id,
roster index, unit type), and stored as `name` on `LedgerRosterEntry`. It never draws from
the sim's per-entity RNG: `Rng.state` is folded into the state hash and `Sim.spawn` consumes
zero draws today, so one draw would move the golden hash and every later roll for that
entity.

Prerequisite sim fix: `checkEnd` currently rebuilds the roster from `playerIds` only, so a
pool entry that was not fielded is silently dropped; unfielded entries carry forward
unchanged. The record (missions served, stripes, kills, whether it has ever been lost and
replaced) shows in the single-unit card (`hud.ts` `cardHtml`, which already prints stripes)
and never in the type chips. A chevron draws at render band 1.5 as its own atlas quad, both
mesh and billboard paths.

### 4.8 The veterancy earn rule

Today a stripe needs a kill. A unit that survives **and contributed to a completed
objective** earns one instead: kill credit, or standing in the zone of a `hold_for` /
`capture` / `survive_until` at completion, or being the identifying unit of a `locate` or a
`mark_tunnel` sight. This rewards the observe-decide-commit-consolidate loop rather than body
count. The golden replay builds no `MissionRuntime`, so the determinism hash is untouched by
construction; `pnpm playtest` rosters change and the harness is re-run. Stripe magnitude is
unchanged (a separate balance decision: felt in a rifle fight at 8/10, not in a tank duel at
16/13 over 30 seeds).

## 5. What the player sees, first session to last

Deploy screen: "what you brought" (roster with names and stripes, positions marked, the
recon-carry sentence such as "Because you found the ATGM cell in Recon, it is on your map
now"). Mission: unchanged, plus the chevron and the card. End panel: unchanged. Debrief
screen: tier, Conduct and reasons, card, promotions, unlocks, next mission named, villain
line. Board: stars, villain state, the account of the taken. Menu: the campaign line, with
the dead Conduct figure fixed (it reads `roe.cumulative_rating`, which nothing produces;
`campaignRoe()` is the right source).

## 6. Testing

- `MissionRuntime` produces `campaign.mission_results` under the same contract filter as
  every key; integer-only, pinned in `mission.test.ts` beside the `roe.mission_ratings`
  tests. `civ.hostages_recovered` likewise.
- `unlockReason` with `stars_min`: sums with integer addition, pinned in `unlock.test.ts`.
- The harness: `starFor(rt, startCount)` in `playtest.ts`, an `expectStar` per plan, and a
  `fieldedCount` getter on `MissionRuntime`; CI asserts optimal ≥ the authored star and
  passive ≤ ★ with the same shape as today's VICTORY/DEFEAT assertion.
- UI: each new surface tested the way `menu.test.ts`, `hud.test.ts` and `worldmap.test.ts`
  test the existing ones; a new `--commend` colour token in `theme.css` (the existing stripe
  stars borrow `--warn`, a team-band colour) and `pnpm validate:ui` stays clean.
- Schema: `pnpm validate:data` over every mission and the three new units; the tutorial is
  untouched by the grade.

## 7. Sequencing for the plan

1. **Surface** (app, one ledger key): the grade and its storage; harness assertions;
   `carries` on the secondaries that qualify; debrief screen; board stars; villain cards;
   the account of the taken; deploy panel and recon-carry sentence; promotion beats;
   unlock announcements; the menu fix; the `--commend` token.
2. **Own** (sim + app): unfielded-pool carry; named units and the card; chevron; the
   veterancy earn rule; harness re-run.
3. **Earn** (content): `stars_min` gate; brigade screen; `upgrades_to`; the three special
   units through campaign-designer → balance-analyst → blender-art → mission-author.

Each step is shippable on its own and the earlier one is what makes the later one visible.
