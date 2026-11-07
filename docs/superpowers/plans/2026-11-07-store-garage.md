# Store "What it adds" panel and Garage upgrades for bought units (GH-1076, GH-1077). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** before a player buys a unit in the Stores, one "What it adds" panel shows what the unit brings, what can
hurt it, how it compares with the closest unit the brigade already has, the gap it fills, where it can be used and
what it can be upgraded to. After it is bought, all nine bought-only units that have no tracks today can be upgraded
in the Garage and in the Stores, with credits or coins. A credit purchase on a track that coins started no longer
hits a dead button.

**Architecture:** no sim change. The panel is one pure model, `unitAdds` (`packages/app/src/ui/stores-adds.ts`),
drawn by the Stores. It reads unit JSON, `unitTypeFromJson` (read-only), the open set, the ledger and missions, and
one generated table: `threat-table.json`, written by a tools-side generator that asks a headless `Sim`'s own
`focusHurts`. Payment gets one pure function, `creditAsk` (`packages/app/src/upgrade-pay.ts`), and one account
writer, `buyUpgradeRun`. The Garage's credit Buy and a new Stores tier-row credit Buy both route through them. The
nine new tracks are data. They reach the sim only through `applyUpgrades` in `upgradePrepass`, before
`addUnitType`, as every track does today.

**Tech stack:** TypeScript strict, vitest with jsdom, the Python cost-curve check (`tools/validate_balance.py`), the
headless playtest, and `pnpm closeups:garage` (the bay's own three.js turntable, in headless Chromium).

**Spec:** `docs/superpowers/specs/2026-11-07-store-garage-benefits-design.md` (PR 1094, branch
`docs/store-garage-design`, head `b5fb216a0`). Read it from that branch if PR 1094 has not merged. The lead's
rulings are the last comment on GH-1076 and on GH-1077 (7 Nov, identical). Where the rulings and the spec disagree,
the rulings win. Where this plan's §0 settles a contradiction between the spec and the code, §0 wins. R0.1 is
already ruled by the lead (7 Nov, on PR 1109's review). The lead review confirms the other §0 defaults.

**Base:** `origin/main` `4cdac8fdc`. Find code by SYMBOL, never by line: `showStores`, `StoresOptions`,
`creditBuyEnabled`, `creditBuy`, `storeItems`, `tierItem`, `TierItem`, `coinPrice`, `buyEnabled`,
`buyTierWithCoins`, `networkView`, `singlePlayerView`, `accountView`, `accountState`, `buyUpgrade`,
`migrateUpgrades`, `resetAccount`, `resetFree`, `renderBay`, `trackEl`, `TrackDeps`, `onBuyUpgrade`, `answer`,
`ghostBar`, `upgradePrepass`, `applyUpgrades`, `unitTypeFromJson`, `roleLabel`, `roleBucket`, `roleBadgeSvg`,
`ROLE_KEYS`, `isMountCarrier`, `isBoughtOnly`, `loanedPlacements`, `loanedReinforcements`, `VERSUS_HELD_UNITS`,
`focusHurts`, `isAirborne`, `HEAVY_COLLATERAL`, `closeupPlan`, `assertCloseupCount`, `seatKitTiers`.

**History checked (7 Nov).**
- GH-1076 and GH-1077: no comment except the lead's rulings block (D1 to D6, 7 Nov), quoted under Global
  Constraints.
- PR 1094 (the spec) is open, docs only.
- **PR 1110, GH-1102, branch `versus/brigade-specials`** (open; head `d667dd5c0` when this plan was revised). The
  ruling it builds (lead, 7 Nov 19:12, superseding the reserve design PR 1107): with "Bring your brigade" on, every
  special a player owns joins that player's starting force. What it already does:
  - `@lions/net` exports `specialRefusal` and `VERSUS_REFUSED_SPECIALS` (`packages/net/src/specials.ts`), which refuse
    `veh_ambulance`, `air_medevac_heli` (`rescue`) and `spg_cluster` (`conduct`);
  - the claim carries `accountState().boughtUnits` (coin-bought included) beside `tiers`;
  - `buildMatchWorld` APPENDS each held special a seat brings after the roster and side 1's copies
    (`appendedSpecials`, `versus-specials.ts`). It walks tiers over that walked roster:
    `seatKitTiers(seat, roster = versusRoster())`, called as `seatKitTiers(seats[s], walked)`;
  - it tests `demo_tzav`'s armour tier 1 on an appended special, and pins `BRIGADE_CAMO_PIN = 422407671` (tel_marum,
    seed 20260727, seat 0 brings `mbt_lavi_camo`, 200 ticks) in `packages/app/src/net/versus-specials.test.ts`;
  - it changes `packages/app/src/net/versus-roster.ts`, in the `VERSUS_HELD_UNITS` header only: the held specials
    stay out of the BASE roster.

  See **Conflicts**.
- **PR 1101** (accounts spec, GH-1075, open, docs only): coins become server-authoritative. Its A0 moves
  `coinPrice`, `buyTierWithCoins`, `storeItems`, `resetFree`, `migrateRoar` and the other coin rules byte for byte
  into a new leaf package, `@lions/economy`, with app re-exports. Credits and the brigade account stay trusted from
  the client. See **Conflicts**.
- The 22 Oct ruling "no upgrade tracks on the special units in v1" (special-units spec, Q1) is reversed by D1.
- E5's three bought-only units (`recon_zikit`, `demo_tzav`, `heli_peten_gunship`) already carry tracks and keep
  their own prices.

---

## Global Constraints

- **The lead's rulings (7 Nov), as recommended:**
  - D1: tracks for all nine bought-only units with none, with no premium for bought units. The balance analyst fits
    them first.
  - D2: 11 engine close-up renders are approved. No Meshy. The lead sees the sheet before merge.
  - D3: R3, credits fill the earned path below the tier they buy, with one button whose label states the run.
  - **R0.1 (lead, 7 Nov, on PR 1109's review):** DROP the "Count online" run. Credits still fill the earned path below
    the tier they buy, as D3 ruled.
  - D4: a sim-generated Hurt-by table.
  - D5: Buy with credits on the Stores' tier rows.
  - D6: one "What it adds" panel, opened from the card.
- **No sim change.** No edit under `packages/sim/`. `pnpm test:determinism` passes with the golden hash unmoved on
  every PR. `git diff --stat origin/main -- packages/sim` is empty on every PR, and the PR body says so.
- **`applyUpgrades` runs before `addUnitType`.** The new tracks are data. They reach a sim only through
  `upgradePrepass` (mission boot, sandbox, replay, versus world, playtest, backtest). No code path learns that a tier
  or a payment path exists. `LADDER_CREDITS` and `CAMPAIGN_CREDITS` do not move.
- **Order:** the balance fit (WP1) is committed before any `upgrades` block lands in `data/units/kdf/`. The tracks
  and their 11 close-ups land in ONE PR, because `garage_closeups.test.ts` derives the owed count from the unit JSON.
- **Art:** the close-ups are rendered by the `blender-art` agent through `pnpm closeups:garage`. There is no Meshy
  call: `art/meshy/ledger.jsonl` and `art/meshy/**` are unchanged in the PR, and no GLB changes (`git diff --stat
  origin/main -- art assets/meshes` is empty).
- **Every chrome string goes through `t()`**, keys in `packages/app/src/i18n/en.json`, resolved at draw time, never
  at module load. Unit `name` values are data. No colour literal in UI source: semantic tokens and
  `.rl-good`/`.rl-bad` only. `pnpm validate:ui` stays green with no allowlist.
- **Price rule (spec §2.2):** tier price = `logistics x m`, rounded to the nearest 5, halves to even. Armour 0.40 /
  0.60 / 0.85, sensors 0.33 / 0.50 / 0.70, firepower 0.50 / 0.75 / 1.05. The fit may move a delta. It moves a price
  only by a ruling, and a ruling is a stop for the lead.
- **Coins never become credits, and credits never become coins (G3).** No refund, resale or conversion. A tier
  purchase writes no grant and never moves `earned_total`.
- **House rules:** never `git add -A` (use `git commit -- <paths>`); never `git checkout <file>`; never `git stash`;
  never pkill or killall, never kill a dev server; port 5177 is the lead's; no local `ui:routes`, `golden-baseline`
  or `ui:shots`; one browser at a time, on your own port, Metal, music off (`tools/src/ui-review/music-off.ts`);
  never write `lions.settings` by hand; issue refs as GH-NNN; no deploys. Every brief repeats this line.

## Review Focus

The six inputs most likely to bite a player that the spec does not name. Each one has its test in the task that owns
the code.

1. **Credits cover one tier but not the run.** Coins own armour tier 2 on the howitzer, nothing is earned, and the
   balance is 345: it covers tier 3 alone (340) but not the run 1-3 (740). Expected: no credit Buy anywhere. The
   tier row's coin Buy is unaffected. A button keyed on `TierItem.state` (one tier's price) would show. Test in WP7
   ("short of the run").
2. **A stale ask.** The Garage drew "Tier 2 · 400" and then a coin Buy in the Stores raised the coin tier before the
   press (two tabs, or a redraw race). Expected: the main.ts handler recomputes `creditAsk` from a fresh read, finds
   `to` or `price` changed, and answers `landed: false`. The account is untouched. Test in WP5 ("stale ask").
3. **A locked bought unit with dormant credit tiers** (ruling L2: the unit was bought, a slot from before the purchase
   was loaded). Expected: the Garage draws the kept tiers read-only, the tier row shows "unlock the unit first", and
   no credit Buy appears in either place. Test in WP5 and WP7.
4. **The panel open across a purchase.** The player opens "What it adds" on the medic and buys it with credits. The
   card leaves the shelf (owned, `showOwned` off). Expected: the panel closes with it. Focus goes where the Stores'
   existing `focusKey` restore sends it, and never to a detached node. Test in WP6 ("buy with the panel open").
5. **Preview mode** (no durable storage). Expected: the panel draws in full. No credit Buy appears on any card or
   tier row, and nothing reads the wallet. Test in WP6 and WP7.
6. **A run in telemetry.** The event schema admits `item` as `unit.track.<1-9>` and nothing else. Expected: a run
   reports `item: '<unit>.<track>.<to>'` with `price` the run's total, and the event passes the schema. Test in WP5.

---

## §0 Rulings: the spec checked against the code

**R0.1 The "Count online" run is dropped. RULED by the lead, 7 Nov, on PR 1109's review.** Credits still fill the
earned path below the tier they buy, as D3 ruled. The spec's R3 sold, after coins had maxed a track, a credit run
whose only effect was that "the coin tiers count in network play". On `origin/main` nothing on a room path reads
`networkView`:
- a matched room sends no tiers (`coin-claim.test.ts`, "a matched create sends no tiers");
- a brigade room sends `accountState().ownedTiers`, the single-player view with coin tiers included. That is the
  ruled exception (D4 of 11 Oct, the same test).

PR 1110 extends the same single-player view to the specials. So the catch-up would have sold nothing observable.
As built:
- `creditAsk` returns `null` when the single-player tier is at the top of the track, whoever paid for it;
- there is no "Count online" label;
- the run label says what is true: "Tier 3 · 740 credits (pays for tiers 1-2 again, on credits)".

This is settled and does not wait for the sheet. Only the run label's wording goes on the sheet.

**R0.2 `creditAsk` takes `(prices, earned, owned)`, not the coin tier.** `owned` is `max(earned, coins)`, the view
the Garage and the Stores already hold (`ownedTiers`, `TierItem.owned`), and `earned` is the account's own
`upgrades`. When `owned > earned`, the coin tier is `owned`. Otherwise the coin tier cannot change the ask, because
`T = earned + 1`. So no caller reads the wallet to price a credit Buy, and that is what T20 asks.

**R0.3 Defect 2 is confirmed in code.** `renderBay` hands `trackEl` `owned = tiers[track]` from `ownedTiers` (the
max view). `buyUpgrade` refuses unless `tier === account.upgrades[unit][track] + 1`. WP5's first test reproduces the
refusal on `origin/main` before any fix.

**R0.4 `storeItems` and `tierItem` stay byte-identical.** PR 1101's A0 moves them byte for byte. `TierItem.next.credits`
is one tier's price and `TierItem.state === 'affordable'` keys on it, so neither may decide a credit Buy. The tier-row
credit Buy is computed in `stores.ts` from `creditAsk(prices, item.earned, item.owned)` and `opts.credits`. `buyTierWithCoins`
(R2) is unchanged.

**R0.5 The telemetry item.** `data/schemas/telemetry_event.schema.json` pins `item` to
`^[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}\.[1-9])?$`. A run reports `<unit>.<track>.<to>` with `price` the total. No
range form and no schema change.

**R0.6 `garage_closeups.test.ts` moves THREE literals, not two.** The spec names 36 → 47 and 13 → 18. The
teams-with-tracks literal `8` also moves, to `12`: `inf_medic_squad`, `inf_grenadier`, `at_nlos_team` and
`ugv_recon_dog` are all rigged teams (`RIGGED_UNIT_MESHES`), so they owe no close-up, but the test counts them.
The 11 close-ups are owed by the five vehicles and aircraft: `mbt_lavi_camo` 3, and `spg_long_range`, `spg_cluster`,
`veh_ambulance` and `air_medevac_heli` 2 each.

**R0.7 The close-up tool is a browser, not Blender.** `pnpm closeups:garage` photographs the shipped
`mountGarageView` turntable in headless Chromium (Playwright, Metal on macOS, music off installed by the tool). It is
the engine render D2 approved, run by the `blender-art` agent. It is that task's one browser, on its own port
(`--port=5236`), with `--only=` the five ids, so the 36 shipped JPEGs are untouched. A textured hull may give an
empty `hull`/`glass`/`metal` region. `garage-focus.ts` then frames the whole model and warns by name. WP9 lists
every such warning on the sheet. Changing the focus rules or adding kit parts is out of scope (spec §5).

**R0.8 The panel's versus line follows PR 1110.** The spec's block F has two values: "Also on the versus camp menu"
(in `kdf.json`'s `menu`, not held) and "Campaign and free play only". Under PR 1110 every owned bought-only unit
except the refused three joins a brigade room's starting force, so "campaign and free play only" would be false for
nine of the twelve. The rule, for block F's versus line:
- a bought-only unit (`isBoughtOnly`) with `specialRefusal(id) === null` shows `brigadeRoom`, "Joins your force in
  brigade versus rooms";
- a unit in `kdf.json`'s `menu` and not in `VERSUS_HELD_UNITS` shows `versus`, "Also on the versus camp menu". It can
  show beside `brigadeRoom`;
- `campaignOnly` shows only when neither holds. That covers the refused three: `veh_ambulance`, `air_medevac_heli`
  and `spg_cluster`.

`unitAdds` takes the refusal as an injected `AddsInput.refusal: (id: string) => string | null`, so WP3 stays
independent and is tested with a literal fixture. WP6 wires `@lions/net`'s `specialRefusal` and therefore
HARD-DEPENDS on PR 1110 merging. The app never keeps its own copy of the refused list.

**R0.9 The threat table needs airborne targets.** `focusHurts` reads `isAirborne(target)` to choose a weapon's
air or ground slot. The generator asserts `isAirborne` for every KDF `isAir` type before it records a row. A landed
medevac would answer the ground slots and list rifles as a threat. It also asserts the KDF unit presents its SIDE
plate to the shooter, by literal (R0.10). `focusHurts` tests no range, so the four-tile spacing fixes the face and
nothing else.

**The facing value.** Angles in the sim are turns x 65536 (`ARC_60 = 10923`, `ARC_120 = 21845`, `tuning.ts`), and
`presentedArmor` takes the bearing `fx.atan2(oy - ty, ox - tx)` against `facing[target]`. The KDF unit spawns at tile
(6, 8) with `facing = 16384` (90°), and the shooter at (10, 8), due east, bearing 0. So `rel = 16384`, which lies
strictly between `ARC_60` and `ARC_120`: the side plate. The literal: `presentedArc` reads `1` after a `focusHurts`
call on that pair. It is the scratch the sim documents `focusHurts` as writing, and the generator reads it before the
next call. If `presentedArc` is not readable from tools, compare against `facing = 0` (front, `rel = 0`) on
`mbt_lavi` against `rpg_team`, where front and side give different answers. Pick that pair by reading the JSON
(`hull.armor.side` < its penetration < `hull.armor.front`) and name it in the test.

**R0.10 The threat table's literal oracles.** The spec's T5 gives two: `sarim_rifles` is not in `mbt_lavi`'s list,
and `atgm_cell` is. This plan adds two more:
- `manpad_team` IS in `air_medevac_heli`'s list (air slot);
- `wounded_sarim` is in nobody's list. It is excluded by `role === 'wounded'`, never by id.

**R0.11 `HEAVY_COLLATERAL` is `32768` in `packages/sim/src/mission.ts`.** It is private (`const`). The app copies
`0.5`, and T4 parses the raw `32768` from the source text and divides by 65536.

---

## Conflicts

**PR 1110, GH-1102, `versus/brigade-specials` (owned specials join a brigade room's force).**
- **Tracks on specials travel with tiers.** PR 1110 already walks tiers over the walked roster
  (`seatKitTiers(seat, walked)`, the base roster plus the appended specials) and tests it on `demo_tzav`. What it
  cannot test yet is the nine's NEW tracks, because they do not exist until WP8. So WP8 adds
  `packages/app/src/net/special-tiers.test.ts` against PR 1110's signatures (`buildMatchWorld`, `seatKitTiers(seat,
  roster)`, `MatchWorld.specialsBySide`), with Q16.16 literals as PR 1110's own `demo_tzav` test writes them:
  - `inf_grenadier`, a special that is in the BASE roster. A brigade KDF seat with `unlocks: ['inf_grenadier']` and
    `tiers: { inf_grenadier: { armour: 2 } }` fields it at the tier-2 `hull.hp`, a literal computed by hand from
    `inf_grenadier.json`'s base hp and WP1's fitted tier-2 delta. The same claim in a matched room fields no
    `inf_grenadier` at all (`unlocks` is ignored there and the type is never registered; PR 1110's matched pins
    read the same), so that case asserts the absence, not a base-hp unit;
  - `mbt_lavi_camo`, an APPENDED special, the same way at armour tier 2. Its tracks copy `mbt_lavi`'s, so the
    literal is `mbt_lavi`'s tier-2 hp.

  Falsification: call `seatKitTiers(seats[s])` (the default `versusRoster()`) in `buildMatchWorld`, and the
  `mbt_lavi_camo` case goes red while the `inf_grenadier` case stays green. That is why there are two cases.
- **WP6 hard-depends on PR 1110 merging.** `brigadeRoom` is built on `@lions/net`'s `specialRefusal` (R0.8). WP8
  also starts after PR 1110 merges, because `special-tiers.test.ts` needs its signatures.
- **Coin tiers in a brigade room.** PR 1110 reads `accountState()`, so coin-bought specials and their coin tiers
  travel, consistent with D4 of 11 Oct. That is the fact R0.1's ruling rests on.
- **Shared files.**
  - `packages/app/src/main.ts`: PR 1110 edits the `openRoom` deps near `tiers: () => accountState().ownedTiers`;
    WP5 and WP7 edit the Garage and Stores handlers. Resolve by hunk.
  - `packages/app/src/i18n/en.json`: PR 1110's lobby copy. Resolve by key.
  - `packages/app/src/ui/theme.css`: PR 1110's lobby line-up styles and WP6's panel. Resolve by block.
  - `packages/app/src/net/versus-roster.ts`: PR 1110 changes it (the `VERSUS_HELD_UNITS` header). This plan only
    reads `VERSUS_HELD_UNITS`, in WP3, and edits nothing there.
- **Pins after WP8.**
  - `shippedContentDigest()` moves, on purpose. Since PR 1110, the nine's tiers can change a brigade room's world (an
    owned special wears its owner's tiers). So two builds that disagree on the nine's `upgrades` must not rejoin each
    other's rooms, and the digest is what refuses it. The digest is recomputed, never a literal
    (`content-digest.test.ts`). WP8 runs `git grep -n shippedContentDigest` and the connect and rejoin suites to
    confirm that no literal holds it.
  - `BRIGADE_CAMO_PIN` (PR 1110, `versus-specials.test.ts`) must NOT move. Its seat brings `mbt_lavi_camo` with no
    tiers, and an untiered type is the base JSON whatever tracks it declares (`applyUpgrades` at tier 0). WP8
    re-runs it. If it moves, a track reached the sim without a tier. That breaks the `applyUpgrades`-before-
    `addUnitType` rule: stop and raise it, never re-pin.
  - No roster-count pin moves: the nine's ids do not change, and the held ones stay out of the base roster.

**PR 1101, accounts (coins server-authoritative later).**
- **A0's byte-for-byte move.** This plan edits none of `coinPrice`, `buyTierWithCoins`, `storeItems`, `tierItem`,
  `resetFree` or `migrateRoar` (R0.4). New credit logic lives in `upgrade-pay.ts` and `brigade-account.ts`, which
  stay in the app. Block G imports `coinPrice` through `stores-model`, the path A0's re-export keeps.
- **The server prices coin tiers from unit JSON** (`POST spend {item:'tier', unitId, track, tier}`, A2-7). The nine's
  tracks become coin-sellable on the server with no extra work. The server's next-tier check must be R2's
  (`max(earned, coins) + 1`, through the moved `buyTierWithCoins` and the synced brigade account).
- **A stale cache under A2.** `creditAsk` reads the coin tier through the cache. A coin spend still in the outbox can
  leave the cache one tier low, and the credit run would then re-buy a tier coins already own (R4). This is not this
  plan's work. WP11 records it in `docs/agent-notes/shell-and-ui.md` as an A2 requirement: disable the credit Buy on
  a track with a pending coin spend for that track.
- **No account schema change.** `buyUpgradeRun` writes only `balance` and `upgrades`, so `ACCOUNT_VERSION` stays 2
  and PR 1101's shape check (`migrateAccount`) does not move.

---

## Tasks, order, parallelism, model tier

| WP | what | size | depends on | parallel with | implementer (model) | reviewer |
|---|---|---|---|---|---|---|
| WP1 | balance fit of the nine tracks | M | — | WP2, WP3, WP4 | `balance-analyst` (Opus: fitting is judgement) | Sonnet |
| WP2 | threat table generator (D4) | S-M | — | WP1, WP3, WP4 | general-purpose (Sonnet) | Sonnet |
| WP3 | `unitAdds` pure model | M | — (fixture table) | WP1, WP2, WP4 | general-purpose (Sonnet) | Sonnet |
| WP4 | `creditAsk` and `buyUpgradeRun` (R3) | S | — | WP1, WP2, WP3 | general-purpose (Sonnet) | Opus (the G2/G3 money invariants) |
| WP5 | Garage credit Buy through `creditAsk` | S-M | WP4 | WP6 | general-purpose (Sonnet) | Sonnet |
| WP6 | the panel in the Stores (D6), copy, CSS | M | WP2, WP3, **PR 1110 merged** | WP5 | general-purpose (Sonnet) | Sonnet |
| WP7 | Stores tier-row credit Buy (D5) | S | WP4, WP5, WP6 | WP8 | general-purpose (Sonnet) | Sonnet |
| WP8 | the nine tracks land (data, tests, docs) | S-M | WP1, WP5 and PR 1110 merged | WP7 | general-purpose (Sonnet) | Sonnet |
| WP9 | the 11 close-ups (same branch and PR as WP8) | S | WP8's commit | WP7 | `blender-art` (Sonnet) | Sonnet |
| WP10 | the look sheet for the lead | S | WP6, WP7, WP9 branches | — | general-purpose (Sonnet); the coordinator publishes | — |
| Lead review | | — | WP10 | — | — | — |
| WP11 | merge order and notes | S | the lead's answer | — | general-purpose (Haiku: mechanical) | Sonnet |

Waves: **A** = WP1, WP2, WP3, WP4 (four streams). **B** = WP5, and WP6 once PR 1110 has merged. **C** = WP7,
then WP8+WP9 as one PR (also gated on PR 1110). **D** = WP10, the lead review, WP11. If PR 1110 is still open when
wave B starts, WP5 proceeds alone and the coordinator waits on PR 1110 for WP6. No task works around it.

**Merge policy.** WP1 to WP5 change no screen a player sees (WP5 changes the Garage label only on a coin-started
track) and merge on green under the standing grant. The UI PRs (WP6, WP7) and the data and art PR (WP8+WP9) open
ready, labelled "held for the lead's sheet (D2)" in the body, and merge only after the lead answers. The merge order
after the answer is WP6 → WP7 → WP8+WP9. R3 is already on main by then (WP5), so no new track ever ships with the
dead button.

**Shared files** (a merge order is needed only where a row names two tasks):
- `packages/app/src/i18n/en.json`: WP5 (run labels), WP6 (panel and `role.*.purpose`), WP7 (tier-row labels). Resolve
  by key.
- `packages/app/src/ui/stores.ts`, `stores.test.ts`: WP6, then WP7. Serial.
- `packages/app/src/main.ts`: WP5 (`buyTierWithCredits`), then WP7 (wiring). Serial. PR 1110: by hunk.
- `packages/app/src/ui/stores-adds.ts`: WP3 only. WP6 passes `@lions/net`'s `specialRefusal` in as `refusal`.
- `packages/app/src/ui/theme.css`: WP6 only (WP7 reuses `rl-stores__buy--credits`). PR 1110 also edits it, for the
  lobby; resolve by block.
- `packages/app/src/net/versus-roster.ts`: changed by PR 1110 (the header only). No task here edits it; WP3 reads
  `VERSUS_HELD_UNITS`.
- `packages/app/src/brigade-account.ts`, `upgrade-pay.ts`: WP4 only.
- `packages/app/src/ui/brigade.ts`, `garage-board.ts`: WP5 only.
- `data/units/kdf/*.json`, `tools/src/garage_closeups.test.ts`, `assets/ui/garage/closeups/`: WP8+WP9 only.
- `docs/campaign/economy/upgrades.md`: WP1 (fit and rule), WP8 (each §3 entry marked shipped). Serial.

Every task runs in its own worktree under `/Users/ilpinto/dev/roaring-lions-ep/`, off `origin/main`, and never in
`/Users/ilpinto/dev/roaring-lions`.

---

### Task WP1: the balance fit of the nine tracks (before any track data lands)

**Branch:** `balance/store-garage-tracks`. **Implementer:** `balance-analyst`, Opus.

**Files:**
- Modify: `docs/campaign/economy/upgrades.md`: §3, one entry per new unit in the existing entry shape. §1 states the
  price rule as a formula. §8 adds the new catalogue total.
- Create: `docs/campaign/special_units/gh1077/tracks.json`, the staged hand-off: `{ "<unitId>": <upgrades block> }`
  for the nine, in `unit.schema.json`'s `upgrades` shape. It is deleted by WP8 in the commit that lands the data,
  which is the staged-unit convention ("moves to `data/units/` in the same commit").
- Create: `tools/src/gh1077_staged.test.ts`. Each staged block validates against `unit.schema.json`'s `upgrades`
  subschema (Ajv), and every price equals the price rule from LITERAL multipliers. It is deleted with the file in WP8,
  where T12 replaces it.
- **Not modified:** anything under `data/units/`. The fit runs on a local, uncommitted patch of the nine JSONs in the
  WP1 worktree. Undo the edit at the end, never `git checkout` the files. The commit carries docs and the staged file
  only.

**What the fit must hold** (spec §2.2; the draft table there is the starting point):
- shape: `armour` and `sensors` for all nine; `firepower` only on `mbt_lavi_camo`, `at_nlos_team` and `inf_grenadier`;
- `mbt_lavi_camo` copies `mbt_lavi`'s three tracks verbatim;
- foot faces +1/2/2 on the three foot teams, and sight +1/2/2 on the two rifle-armed ones;
- `air_medevac_heli` front +0 on every tier;
- `ugv_recon_dog` armour is hp only;
- no soft unit turns hard at tier 3 (`HARD_TYPES` stays 16).

- [ ] **Step 1: Apply the drafts locally** to the nine `data/units/kdf/*.json` (uncommitted), exactly as spec §2.2's
  table and delta list. Run `pnpm validate:data`.
- [ ] **Step 2: Run the four measurements** and record each one verbatim:
  1. `python tools/validate_balance.py --units data/units --max-tier --upgrade-cost-factor 0.02`, and the `--also`
     form CI runs (both, ±18%);
  2. `pnpm balance` (a guard: §5.7 targets inside their bands);
  3. `pnpm playtest`: the max-tier replay keeps every victory a victory and drops no star. The medic is exercised in
     29 missions;
  4. `pnpm --filter @lions/tools su:probes` with each of the nine at max tier (report-only). A claim that flips is a
     stop for the lead, never a widened band. If a probe arm runs longer than 10 minutes locally, brief a cloud
     session (the base commit, "no questions, report on GH-1077 via `gh api` comments", "never edit data on the
     cloud branch: post the table").
- [ ] **Step 3: Fit.** Move a DELTA where a measurement goes outside its band. Follow `upgrades.md` §4's method:
  name the target that broke, shrink the one delta that breaks it, and re-run the combined pass. A price moves only
  if the lead rules it.
- [ ] **Step 4: Falsify each gate, watch it go red, then undo the edit:**
  - T15: `spg_long_range` armour tier 3 `hull.hp` +5000, and `validate_balance.py --max-tier` goes red on that unit;
  - T16: `inf_medic_squad` armour tier 3 `hull.hp` −300 (local only), and at least one max-tier replay goes red. If
    none does, the PR says "the playtest cannot see the medic's armour track" and does not claim it as a gate;
  - T14: `inf_medic_squad` armour tier 3 front +20, and `vehicle_health_bounds.test.ts` goes red;
  - `gh1077_staged.test.ts`: move one staged tier price by 5, and the test goes red. Multiplier 0.40 → 0.41 in the
    TEST's own literal, and it goes red too, which proves the literal is what the test reads.
- [ ] **Step 5: Write the fit table** into `upgrades.md` §3 (one entry per unit: tracks, tiers, deltas, prices, the
  four measurements), and the staged `tracks.json`. Post the summary table on GH-1077.
- [ ] **Step 6: Undo the local data patch** (undo the edits). `git status --porcelain -uall data/units` is empty.
- [ ] **Step 7: Commit** with `git commit -- docs/campaign/economy/upgrades.md docs/campaign/special_units/gh1077/tracks.json tools/src/gh1077_staged.test.ts`.
  The message lists each falsification and its red line.

**Gate:** none is enforced here. CI cannot see the fit: no `upgrades` block is in `data/units/` yet, so every CI
balance step runs on today's data, and a green run says nothing about the nine. WP1's evidence is:
- the four measurements, posted verbatim on GH-1077 and in `upgrades.md` §3;
- the Step 4 reds, each one in the commit message. Keep BOTH WP1 mutations, T15's +5000 hp and T16's −300 hp:
  T15 proves the cost-curve check sees an absurd tier, and T16 proves (or disproves) that the playtest sees the medic.

`gh1077_staged.test.ts` is enforced, but it guards only the staged prices. **WP8 is the first enforced gate on the
fit**, when CI's two `--max-tier` invocations, `pnpm balance` and `pnpm playtest` first run on the landed data.
**Falsification:** Step 4.

---

### Task WP2: the threat table generator (D4)

**Branch:** `store/threat-table`. **Implementer:** Sonnet.

**Files:**
- Create: `tools/src/store/threat-table.ts` (`buildThreatTable(): Record<string, string[]>` and a CLI `main` that
  writes the file)
- Create: `packages/app/src/ui/generated/threat-table.json` (generated, never hand-edited). JSON carries no comment,
  so the "do not edit" note lives in the generator's header, and the regenerate-and-compare test is the guard.
- Create: `tools/src/store_threat_table.test.ts`
- Modify: `tools/package.json` (`"store:threats": "tsx src/store/threat-table.ts"`), root `package.json`
  (`"store:threats": "pnpm --filter @lions/tools store:threats"`)

**Interfaces (Produces):**
```ts
// tools/src/store/threat-table.ts
/** For every KDF unit type (data/units/kdf), the sorted ids of the enemy types (data/units/enemy, armed, role !== 'wounded')
 *  whose `focusHurts(enemy, kdf)` is true with the KDF unit presenting its SIDE plate, four tiles away. Base JSON (tier 0). */
export function buildThreatTable(): Record<string, string[]>;
// packages/app/src/ui/generated/threat-table.json:  { "<kdfId>": ["<enemyId>", ...], ... }  keys sorted, lists sorted
```

Method: one headless `Sim` per (enemy, KDF) pair on a 16x16 open map. Register both types through `unitTypeFromJson`
and `addUnitType`. Spawn the KDF unit at side 0 on tile (6, 8) with `facing = 16384` (90°, R0.9), and the enemy at
side 1 on (10, 8), due east and four tiles away, so the shooter stands on the KDF unit's side plate. No tick runs:
`focusHurts` is a read. Assert R0.9 (`isAirborne` for every KDF `isAir` type) before recording.

- [ ] **Step 1: Write the failing test** `store_threat_table.test.ts`:
  - `buildThreatTable()` deep-equals the committed JSON;
  - the literals (R0.10): `atgm_cell` ∈ `mbt_lavi`; `sarim_rifles` ∉ `mbt_lavi`; `manpad_team` ∈ `air_medevac_heli`;
    `wounded_sarim` in no list;
  - the side-face literal: `facing = 16384` against a shooter at bearing 0 gives `presentedArc === 1` (side), and
    `facing = 0` gives `0` (front). If `presentedArc` is not readable from tools, use R0.9's named front/side pair;
  - every KDF id in `data/units/kdf` is a key, and every soft KDF type's list holds every armed enemy **whose weapons
    can target the unit's domain** (`can_target` has `air` for an aircraft or drone, `ground` for a ground unit).
    Soft means every compatible weapon hurts it, not that every weapon can reach it. `atgm_cell`'s Kornet is
    `can_target: ["ground"]`, so it is correctly absent from the air-domain `recon_drone`'s list, and a literal asserts
    that absence;
  - **the loops cannot pass empty:**
    - the KDF id list the test walks has at least 30 entries (32 on the base: `data/units/kdf` holds 32 files, so a
      bound of 40 would fail on today's data);
    - the armed-enemy list has at least 12 (16 on the base: 17 files less `wounded_sarim`);
    - at least one KDF type is soft, and at least one is not;
    - the not-soft type's list is a strict subset of the domain-compatible armed enemies, so "soft means everything
      compatible" cannot be the rule for all.
- [ ] **Step 2: Run** `pnpm vitest run tools/src/store_threat_table.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the generator and run `pnpm store:threats` to write the JSON.
- [ ] **Step 4: Falsify, then undo:**
  - hand-edit one cell of the JSON, and the deep-equal goes red;
  - make the generator record every armed enemy, and the `sarim_rifles` literal goes red;
  - face the KDF unit toward the shooter (front plate), and the side-face literal goes red. `atgm_cell` may still
    hurt the Lavi, which is why the face has its own literal;
  - spawn the medevac landed, and the R0.9 assertion throws;
  - read the KDF list from an empty directory, and the "at least 30" bound goes red where the per-id loop would have
    passed vacuously.
- [ ] **Step 5: Run** `pnpm vitest run tools/src`, `pnpm typecheck` and `pnpm lint`. `git diff --stat origin/main --
  packages/sim` is empty.
- [ ] **Step 6: Commit** with `git commit -- <paths>`. The message lists the falsifications.

**Gate:** the deep-equal plus four literals. **Falsification:** Step 4.

---

### Task WP3: `unitAdds`, the pure model (spec §1.2)

**Branch:** `store/adds-model`. **Implementer:** Sonnet.

**Files:**
- Create: `packages/app/src/ui/stores-adds.ts`, `packages/app/src/ui/stores-adds.test.ts`
- Modify: none outside these two. The model imports `@lions/data` (`readPath`, `applyUpgrades`, `missions`, world
  data), `@lions/sim` (`unitTypeFromJson`, `loanedPlacements`, `loanedReinforcements`), `./role` (`roleBucket`,
  `isMountCarrier`), `./stores-model` (`coinPrice`), and `../net/versus-roster` (`VERSUS_HELD_UNITS`).

**Interfaces (Produces):**
```ts
export const APP_HEAVY_COLLATERAL = 0.5;   // copy of mission.ts HEAVY_COLLATERAL (32768 / 65536), pinned by T4
export type AddsTag = 'heal' | 'rescue' | 'evacuate' | 'transport' | 'markTunnel' | 'markTarget' | 'indirect' | 'area'
  | 'coverIgnore' | 'beam' | 'structure' | 'demolish' | 'construct' | 'smoke' | 'garrison' | 'thermal' | 'crush'
  | 'engagesAir' | 'flies';                                          // spec §1.2 B, in priority order (ADDS_TAGS)
export type WeakTag =
  | { kind: 'soft' } | { kind: 'unarmed' } | { kind: 'minRange'; n: number }
  | { kind: 'needsSpotter'; sight: number; range: number } | { kind: 'groundBound' } | { kind: 'conduct' };
export interface AddsInput {
  readonly unit: UnitJson;                                // the candidate
  readonly kdf: readonly UnitJson[];                      // every KDF unit
  readonly enemies: readonly UnitJson[];                  // for names and roles in Hurt by
  readonly open: ReadonlySet<string>;                     // accountView open set minus wounded_kdf
  readonly ownedTiers: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly ledger: LedgerData;
  readonly missions: readonly MissionJson[];
  readonly worldMissionIds: readonly string[];            // data/campaign/world.json
  readonly versusMenu: ReadonlySet<string>;               // data/doctrines/kdf.json menu
  readonly threats: Readonly<Record<string, readonly string[]>>;   // threat-table.json (WP2), injected
  /** Why a Store special is refused in a versus room, or null (R0.8). WP6 passes `@lions/net`'s `specialRefusal`
   *  (PR 1110); tests pass a literal fixture. Never a copied list. */
  readonly refusal: (id: string) => string | null;
}
export interface UnitAdds {
  readonly role: { role: string; bucket: string };
  readonly brings: { shown: readonly { tag: AddsTag; n?: number }[]; more: readonly AddsTag[] };   // first 4, then the rest
  readonly watch: { shown: readonly WeakTag[]; more: readonly WeakTag[] };
  readonly hurtBy: null | { groups: readonly { role: string; names: readonly string[] }[]; moreGroups: number; shrugs: readonly string[] };
  readonly compare: { against: string | null; rows: readonly { stat: 'range' | 'armourFront' | 'hp' | 'speed' | 'sight'; mine: number; theirs: number | null }[] };
  readonly gap: readonly ({ kind: 'firstRole'; role: string } | { kind: 'newTags'; tags: readonly AddsTag[] }
    | { kind: 'reach'; n: number; d: number } | { kind: 'plusOne'; role: string; name: string })[];
  readonly where: readonly ({ kind: 'dock'; n: number } | { kind: 'fieldedAs'; base: string; mission: string }
    | { kind: 'loaned'; n: number } | { kind: 'versus' } | { kind: 'brigadeRoom' } | { kind: 'campaignOnly' }
    | { kind: 'coinsSinglePlayer' })[];
  readonly upgrades: null | { tracks: readonly string[]; tiers: number; credits: number; coins: number };
}
export function unitAdds(input: AddsInput): UnitAdds;
```

Rules (spec §1.2), with the points the spec leaves open settled:
- Predicates read `unitTypeFromJson(json)` or a JSON field. **No unit id appears in `stores-adds.ts`**: a test greps
  the source for every KDF id and finds none.
- `hurtBy` is `null` when the unit is `soft`. Otherwise its groups are the armed enemies in `threats[unit.id]`,
  grouped by `role`, at most three groups. `shrugs` is the armed enemies not in that list.
- `compare`: the closest unit by same `role`, then same `roleBucket`, then nobody. Ties go to the smallest
  `|Δ cost.logistics|`, then to id order. Both units are read at their own owned tiers through `applyUpgrades`.
- `gap` is computed over `open`, never the catalogue.
- `upgrades.coins` is the SUM of `coinPrice(tier.price)` over every tier, never `coinPrice(sum)`.

- [ ] **Step 1: Write the failing tests** (spec §4, T1, T3, T4, T6, T7, T8; T9 on a LITERAL fixture here, because
  the shipped howitzer has no tracks until WP8):
  - T1: the starting roster open (`apc_eitan`, `at_team`, `inf_squad`, `jeep_shoded`, `mortar_team`). Against
    `spg_long_range` the closest unit is `mortar_team`; against `inf_medic_squad` it is `inf_squad`. Add a literal
    fixture case, because `spg_long_range` and `mortar_team` share the role `artillery` and the starting roster has no
    unit that matches the howitzer's bucket but not its role: an open unit of ANOTHER role in the howitzer's
    `roleBucket`. Role-first still answers `mortar_team`; bucket-first would
    answer the fixture unit;
  - T3: per tag, a literal fixture with the field gets the tag and the same fixture without it does not. Over the
    shipped KDF roster every tag holds on at least one unit and not on all;
  - T4: `APP_HEAVY_COLLATERAL === Number(/HEAVY_COLLATERAL = (\d+)/.exec(missionTs)[1]) / 65536`, reading
    `packages/sim/src/mission.ts` as text;
  - T6: on a starting-roster brigade, the medic reads `firstRole`, with `newTags ⊇ {heal, rescue}`; the howitzer reads
    `reach` with `d: 10`;
  - T7: `mortar_team` at armour tier 2 compares at hp `402` (literal);
  - T8: fixture missions put the medic in two starting forces, one `from_ledger: true`, which gives `loaned: 1`. A
    mission without `resources` adds nothing to `dock`;
  - T9 (fixture): a unit with tiers priced 160, 240 and 340 gives `credits` 740. `coins` is the literal sum of each
    tier's coin price, which differs from `coinPrice(740)`. Pick a fixture where the two differ, and say so in the
    test;
  - the threat literal: a fixture `threats` that names `atgm_cell` for the candidate puts it in a group;
  - the versus line (R0.8), with a literal fixture `refusal` that refuses `spg_cluster` only:
    - `spg_long_range` (bought-only, not refused) shows `brigadeRoom`;
    - `spg_cluster` (refused) shows `campaignOnly` and no `brigadeRoom`;
    - an earned unit on the fixture menu shows `versus` and no `brigadeRoom`;
  - no unit id in the source (the grep above). **The loops cannot pass empty:** the KDF id list the grep walks has
    at least 30 entries (32 on the base), and the T3 sweep runs over every `ADDS_TAGS` entry (19) against that same
    list. An empty roster makes "holds on at least one" fail, never pass.
- [ ] **Step 2: Run** `pnpm vitest run packages/app/src/ui/stores-adds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `unitAdds`. The versus line follows R0.8 through the injected `refusal`. Nothing
  imports `@lions/net`'s specials here, so WP3 does not wait for PR 1110.
- [ ] **Step 4: Falsify, then undo:**
  - T1: swap steps 1 and 2 (bucket first), and the fixture case answers the other-role unit instead of
    `mortar_team`. On the starting roster alone this swap changes nothing, which is why the fixture exists;
  - T3: `minRange` `> 0` → `>= 0`, and "not on all" goes red;
  - T4: the copy set to 0.4;
  - T6: coverage over `kdf` instead of `open`, and the medic is no longer "first";
  - T7: the comparison unit read from base JSON (350);
  - T8: drop the `from_ledger` filter (2), or count every mission for `dock`;
  - T9: `coinPrice(sum)`;
  - id grep: add `if (unit.id === 'spg_long_range')` anywhere;
  - R0.8: ignore `refusal` (every bought-only unit gets `brigadeRoom`), and the `spg_cluster` case goes red;
  - the empty-loop bound: feed the grep an empty id list, and the "at least 30" assertion goes red.
- [ ] **Step 5: Run** `pnpm vitest run packages/app/src/ui`, `pnpm typecheck` and `pnpm lint`.
- [ ] **Step 6: Commit** with `git commit -- <paths>`.

**Gate:** the tests above. **Falsification:** Step 4.

---

### Task WP4: `creditAsk` and `buyUpgradeRun` (R3, with R0.1 and R0.2)

**Branch:** `garage/credit-run`. **Implementer:** Sonnet. **Reviewer:** Opus.

**Files:**
- Create: `packages/app/src/upgrade-pay.ts`, `packages/app/src/upgrade-pay.test.ts`
- Modify: `packages/app/src/brigade-account.ts` (`buyUpgradeRun`; `buyUpgrade` becomes the `from === to` case and
  keeps its signature), `packages/app/src/brigade-account.test.ts`, `packages/app/src/profile.test.ts`

**Interfaces (Produces):**
```ts
// upgrade-pay.ts (pure; credits only, never reads the wallet)
export interface CreditAsk { readonly from: number; readonly to: number; readonly price: number; readonly again: number }
/** R3 as ruled, with R0.1: null when `owned` is at the top of the track. Else `to = owned + 1`, `from = earned + 1`,
 *  `price` = sum of prices[from-1 .. to-1], `again` = owned - earned (tiers in the run the coin path already holds). */
export function creditAsk(prices: readonly number[], earned: number, owned: number): CreditAsk | null;
// brigade-account.ts
/** Refuses unless from === earned + 1, to >= from, price a positive integer, balance >= price. Sets earned = to.
 *  Writes no grant; earned_total does not move. */
export function buyUpgradeRun(account: BrigadeAccount, unitId: string, track: string, from: number, to: number, price: number): { account: BrigadeAccount; ok: boolean };
```

- [ ] **Step 1: Write the failing tests:**
  - T17 `creditAsk` on prices `[160, 240, 340]`:
    - `(0, 0)` → `{1, 1, 160, 0}`;
    - `(0, 2)` → `{1, 3, 740, 2}`;
    - `(0, 3)` → `null` (R0.1);
    - `(3, 3)` → `null`;
    - `(2, 2)` → `{3, 3, 340, 0}`;
    - `(1, 2)` → `{2, 3, 580, 1}`;
  - T18 the G2 invariant: a seeded random walk of 200 operations over R2 (coin buys through `buyTierWithCoins`,
    unchanged) and R3 (`creditAsk` + `buyUpgradeRun`) on one three-tier track priced `[160, 240, 340]`. The test
    keeps its OWN shadow record, written only from the literal prices and each call's `ok`:
    - `shadowEarned`, set to `to` on each accepted credit run and never read from the account;
    - `shadowSpent`, the running sum of each accepted run's price;
    - `shadowCoins`, set on each accepted coin buy.

    After every step:
    - `account.upgrades[u][t] === shadowEarned`;
    - `networkView(...).ownedTiers[u][t] === shadowEarned`. The network view is checked against the independent
      counter, never against the account it is derived from: `networkView ≤ earned` would be an identity;
    - `shadowSpent >= [160, 240, 340].slice(0, shadowEarned)` summed (literal prices), and the balance equals the
      start minus `shadowSpent`;
    - `max(shadowEarned, shadowCoins)` never decreases, and equals the single-player view;
  - T22 G3: `buyUpgradeRun` pushes no grant, `earned_total` does not move, and the balance falls by exactly `price`;
  - the refusals: `from !== earned + 1`, `to < from`, `price` 0 or not an integer, `balance < price` each give
    `ok: false` with the account identical (`toBe`, the same object);
  - T21: `resetAccount` drops a bought unit's credit tiers; `resetFree` keeps paid coin tiers; a slot load restores
    the earned tiers and leaves coin tiers alone (`profile.test.ts`).
- [ ] **Step 2: Run** them. Expected: FAIL (the module does not exist).
- [ ] **Step 3: Implement.** Express `buyUpgrade` as `buyUpgradeRun(account, u, t, tier, tier, price)` so there is
  one writer. Its existing tests must stay green unchanged.
- [ ] **Step 4: Falsify, then undo:**
  - `from = owned + 1`: T17 case 2 prices tier 3 alone (340) and goes red;
  - record `earned = to` while charging only tier `to` (`price = prices[to-1]`): T18's `shadowSpent` bound goes red;
  - make `networkView` return the single-player view: T18's network-view assertion goes red on the first coin buy.
    (`networkView ≤ earned` measured against the account could not catch this);
  - push a grant on purchase: T22;
  - return `{1, 3, …}` for `(0, 3)`: the R0.1 case goes red;
  - write the coin tiers into the slot snapshot: T21.
- [ ] **Step 5: Run** `pnpm vitest run packages/app/src`, `pnpm typecheck` and `pnpm lint`.
- [ ] **Step 6: Commit** with `git commit -- <paths>`.

**Gate:** T17, T18, T21, T22 and the refusals. **Falsification:** Step 4.

---

### Task WP5: the Garage's credit Buy asks `creditAsk`

**Branch:** `garage/credit-run-ui` (after WP4 merges). **Implementer:** Sonnet.

**Files:**
- Modify: `packages/app/src/ui/brigade.ts`. `GarageState` gains `earned` (the account's `upgrades`, from the same
  `now()` read). `renderBay` passes each track its `CreditAsk | null`.
- Modify: `packages/app/src/ui/garage-board.ts`. `TrackDeps['buy']` carries `ask: CreditAsk | null`. The button shows
  `ask.to` and `ask.price`. When `ask.again > 0` the label is the run label. When `ask` is null on a track that coins
  maxed, the board shows the existing maxed state.
- Modify: `packages/app/src/main.ts`. A new local `buyTierWithCredits(unitId, track, to, price)` re-reads the
  account and the view, recomputes `creditAsk`, and refuses (`landed: false`) unless `ask.to === to &&
  ask.price === price`. It then calls `buyUpgradeRun` and writes, and sends telemetry `item: '<unit>.<track>.<to>'`
  (R0.5). The `onBuyUpgrade` callback calls it.
- Modify: `packages/app/src/i18n/en.json` (`garage.buy.run`: "Tier {to} · {price} credits (pays for tiers
  {from}-{last} again, on credits)", and its aria form; R0.1)
- Test: `packages/app/src/ui/brigade.test.ts`, `garage-board.test.ts`, and a main-level handler test where the
  handler is reachable (else `brigade-model.test.ts`)

- [ ] **Step 1: Write the failing tests:**
  - T19 the mixed track: coins own `mbt_lavi` armour tier 1, earned 0. The Garage credit Buy shows "Tier 2", lands
    (`landed: true`), and the account reads earned 2. Run this test on the WP5 base BEFORE the fix and record the
    red (`landed: false`) in the commit message: that is defect 2;
  - the run label: coins 2, earned 0 shows the run label with `{from}` 1 and `{last}` 2, through `t()` (bracketed under
    pseudo);
  - Review Focus 2, the stale ask: a press carrying `to: 2, price: 400` after the coin tier moved to 2 gives
    `landed: false`, and the account is identical;
  - Review Focus 3: a locked bought unit with dormant tiers shows no credit Buy;
  - Review Focus 6: the telemetry event of a run validates against `telemetry_event.schema.json` (Ajv, the shipped
    schema).
- [ ] **Step 2: Run** them. Expected: FAIL (T19 red on `main`, as recorded).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Falsify, then undo:**
  - the handler trusts the button's `price` without recomputing: the stale-ask test goes red;
  - the board reads `owned` as `from`: T19's account reads earned 2 but the price is one tier's. Assert the balance
    literal so this goes red;
  - item `'<unit>.<track>.1-3'`: the schema test goes red.
- [ ] **Step 5: Run** `pnpm vitest run packages/app/src`, `pnpm validate:ui`, `pnpm typecheck` and `pnpm lint`.
- [ ] **Step 6: Commit** with `git commit -- <paths>`.

**Gate:** T19 and the four tests above. **Falsification:** Step 4, plus T19's recorded red on `main`.

---

### Task WP6: the "What it adds" panel in the Stores (D6), its copy and CSS

**Branch:** `store/adds-panel`. It starts after WP2, WP3 **and PR 1110** merge. **HARD dependency:** the panel's
versus line is built on `@lions/net`'s `specialRefusal` (R0.8). If PR 1110 has not merged, WP6 waits. It never
copies the refused list and never builds against an unmerged branch. **Implementer:** Sonnet.

**Files:**
- Modify: `packages/app/src/ui/stores.ts`. It passes `refusal: specialRefusal` (imported from `@lions/net`) into
  `unitAdds`, and draws `where.brigadeRoom` as `stores.adds.where.brigadeRoom`: "Joins your force in brigade versus
  rooms". It also adds:
  - the "What it adds" control on each unit card (`data-focus="adds:<id>"`, `aria-expanded`, `aria-controls`);
  - one panel (`role="region"`, labelled with the unit's name) under that card's grid row;
  - `StoresOptions.adds?: string` and `onAdds?: (id: string | null) => void`, kept through redraws like `shelf`.
- Modify: `packages/app/src/main.ts`, only to thread `adds` and `onAdds` through the Stores mount (the WP7 hunk sits
  elsewhere in the same function).
- Modify: `packages/app/src/i18n/en.json`:
  - about 45 keys: `stores.adds.*` (headings, the 19 tags, 6 weaknesses, Hurt by and Shrugs off, the five stat rows,
    gap, where, upgrades);
  - `role.<role>.purpose` for every role in `ROLE_KEYS` (14);
  - one speed stat key.
- Modify: `packages/app/src/ui/theme.css` (panel layout, semantic tokens and `.rl-good`/`.rl-bad` only)
- Test: `packages/app/src/ui/stores.test.ts` (T10), `packages/app/src/ui/role.test.ts` (T2)

- [ ] **Step 1: Write the failing tests:**
  - T2: every shipped KDF role has `role.<role>.purpose` in `en.json`;
  - T10:
    - opening B closes A (exactly one `[role=region]`), and `aria-expanded` follows;
    - focus moves to the panel heading, and closing returns it to the control;
    - the disposer leaves `host` empty;
    - under `?pseudo=1` every visible text node in the panel is bracketed (unit names excepted: data, as in the
      Garage blurb);
  - Review Focus 4: buy with the panel open. The card leaves the shelf, the panel goes with it, and focus lands on a
    connected node;
  - Review Focus 5: preview mode draws the panel, and the panel's draw path never calls the wallet (a spy on
    `readRoar`);
  - the versus line, against the REAL `specialRefusal`, over all twelve bought-only units (the list is asserted
    to have 12 entries, so the loop cannot pass empty):
    - each of the nine that may come shows "Joins your force in brigade versus rooms" (its `t()` key);
    - `veh_ambulance`, `air_medevac_heli` and `spg_cluster` do not, and show "Campaign and free play only" unless they
      are on the menu.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** The panel calls `unitAdds` with the injected `threat-table.json`. Each block is drawn
  from the discriminated values, one `t()` sentence each. Signed stat differences take `.rl-good` / `.rl-bad` by
  sign. There are no bars.
- [ ] **Step 4: Falsify, then undo:**
  - skip closing the previous panel, and two regions exist;
  - write one literal English string into the panel, and the pseudo test goes red;
  - delete `role.artillery.purpose`, and T2 goes red;
  - T11: add a hex literal to the panel CSS, and `pnpm validate:ui` goes red;
  - pass `refusal: () => null`: the three refused units show the brigade line, and the versus-line test goes red.
- [ ] **Step 5: Run** `pnpm vitest run packages/app/src/ui`, `pnpm validate:ui`, `pnpm typecheck` and `pnpm lint`.
  `player-wording.test.ts` stays green.
- [ ] **Step 6: Commit** with `git commit -- <paths>`. Open the PR as "held for the lead's sheet (D2)".

**Gate:** T2, T10, T11 and Review Focus 4 and 5. **Falsification:** Step 4.

---

### Task WP7: "Buy with credits" on the Stores' tier rows (D5)

**Branch:** `store/tier-credit-buy` (after WP5 and WP6). **Implementer:** Sonnet.

**Files:**
- Modify: `packages/app/src/ui/stores.ts`. The tier row gains a credit Buy beside the coin Buy
  (`data-buy="credits:<unit>.<track>"`), computed from `creditAsk(prices, item.earned, item.owned)` and
  `opts.credits` (R0.4). **The row's credit price line follows the ask too:** `priceLine(item.next.credits, ...)`
  (`stores.ts:593`) shows the single tier's 340, so while the ask is a run (`ask.again > 0`) the credit figure is
  `ask.price` (740) and the coin figure stays `item.next.coins`. The button and the figure beside it never disagree. `StoresOptions.onBuyTierCredits?: (unitId, track, to, price) => void`. Absent: no button.
  `tierCreditBuyEnabled(ask, credits, unitOpen, canBuy)` is exported and pure.
- Modify: `packages/app/src/main.ts`. `onBuyTierCredits` calls WP5's `buyTierWithCredits` and redraws the Stores
  with the existing `focusKey`.
- Modify: `packages/app/src/i18n/en.json` (`stores.buy.tier.credits` and its aria form; the run form reuses WP5's
  wording under a `stores.` key)
- Test: `packages/app/src/ui/stores.test.ts` (T20)

- [ ] **Step 1: Write the failing tests:**
  - T20: the button shows only when the credits cover the ASK. With zero credits and plenty of coins it does not
    show. Nothing on the path reads `wallet.coins`;
  - Review Focus 1, short of the run: coins 2, earned 0, credits 345 (tier 3 is 340, the run 740) shows no credit
    Buy. With credits 740 it shows the run label;
  - Review Focus 3: a locked unit shows no credit Buy;
  - Review Focus 5: preview shows no credit Buy;
  - a press routes `('spg_long_range', 'armour', 3, 740)` to `onBuyTierCredits`;
  - the price line: in the same fixture the row's credit figure reads 740 (not 340) and its coin figure is unchanged.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Falsify, then undo:**
  - read `wallet.coins` instead of `credits`: T20 goes red;
  - key the button on `item.state === 'affordable'`: Review Focus 1 goes red. Its 345 credits cover tier 3 alone
    (340) and not the run (740), so a state-keyed button shows;
  - drop the `unitOpen` test: the locked-unit test goes red;
  - pass `item.next.credits` to `priceLine` again: the price-line test goes red (340 for 740).
- [ ] **Step 5: Run** `pnpm vitest run packages/app/src/ui`, `pnpm validate:ui`, `pnpm typecheck` and `pnpm lint`.
- [ ] **Step 6: Commit** with `git commit -- <paths>`. Open the PR as "held for the lead's sheet (D2)".

**Gate:** T20 and Review Focus 1, 3 and 5. **Falsification:** Step 4.

---

### Task WP8: the nine tracks land (data, tests, docs)

**Branch:** `data/bought-unit-tracks`. It starts after WP1, WP5 and PR 1110 merge: `special-tiers.test.ts` needs PR
1110's `seatKitTiers(seat, roster)` and `BRIGADE_CAMO_PIN`. WP9 commits to the SAME branch, and both go in one PR.
**Implementer:** Sonnet. This is the FIRST task whose gates enforce WP1's fit: CI's balance steps now see the
nine's tracks.

**Files:**
- Modify: `data/units/kdf/{mbt_lavi_camo,spg_long_range,spg_cluster,at_nlos_team,veh_ambulance,air_medevac_heli,inf_medic_squad,inf_grenadier,ugv_recon_dog}.json`
  (`upgrades` blocks copied verbatim from `docs/campaign/special_units/gh1077/tracks.json`)
- Delete: `docs/campaign/special_units/gh1077/tracks.json`, `tools/src/gh1077_staged.test.ts`
- Create: `tools/src/bought_unit_tracks.test.ts` (T12)
- Modify: `tools/src/garage_closeups.test.ts`: 36 → 47, 13 → 18, and the teams-with-tracks 8 → 12 (R0.6). The 36 sits
  in FIVE places in "owes one per KDF vehicle or aircraft type" and "refuses a run that wrote a different count": the
  test title, `toHaveLength(36)`, the `declares 36 vehicle and aircraft` regex, `assertCloseupCount(36, plan)` not
  throwing, and the wrong-count case `assertCloseupCount(37, plan)` (becomes 48, so it stays one off). These
  literals go red on this commit and are green only after WP9's commit. CI runs on the PR head, after both.
- Modify: `packages/app/src/ui/stores-adds.test.ts`. T9 on the shipped `spg_long_range`: 1,350 credits and **145**
  coins (literal, from WP1's fit; update the literal if the fit moved a price by ruling).
- Modify: `docs/campaign/economy/upgrades.md` (each new §3 entry marked shipped, with the commit)
- Create: `packages/app/src/net/special-tiers.test.ts`. Its two cases, `inf_grenadier` in the base roster and
  `mbt_lavi_camo` appended, each at armour tier 2 with a literal Q16.16 hp, are described under **Conflicts**.

- [ ] **Step 1: Write the failing tests:**
  - T12: every `isBoughtOnly` KDF unit declares at least two tracks. The nine's prices equal the price rule from
    LITERAL multipliers, halves to even. The exemptions are named, and the test asserts that each exemption
    actually deviates, so a stale exemption goes red: E5's three, `attack_drone`, `heli_yanshuf`;
  - the shipped T9 literal;
  - `special-tiers.test.ts`, both cases. Each hp is hand-computed into a literal from the unit JSON's base hp plus
    WP1's tier-2 delta. It is never read through `applyUpgrades`, because the oracle takes literals.
- [ ] **Step 2: Copy** the staged blocks into the nine JSONs. Diff them against the staged file:
  `node -e` deep-equal, printed in the PR. Delete the staged file and its test in the same commit.
- [ ] **Step 3: Run** `pnpm validate:data`, then the two `validate_balance.py --max-tier` invocations CI runs, `pnpm
  balance`, `pnpm playtest`, `pnpm test:determinism` (the hash unmoved) and `pnpm vitest run tools/src packages`.
  Two versus pins follow:
  - `pnpm vitest run packages/app/src/net/versus-specials.test.ts`: `BRIGADE_CAMO_PIN` (PR 1110) is UNCHANGED. Its seat
    brings `mbt_lavi_camo` with no tiers, so the new tracks must not reach that world. If it moves, stop and raise
    it, never re-pin (see **Conflicts**);
  - `git grep -n shippedContentDigest` and the connect and rejoin suites: the digest moves on purpose, because the
    nine's tiers can now change a brigade room. It is recomputed and no literal holds it. If a literal does, update it
    and give that reason in the commit.
- [ ] **Step 4: Falsify, then undo:**
  - delete `spg_long_range`'s `upgrades`: T12 goes red;
  - move one tier price by 5: T12 goes red;
  - remove `heli_yanshuf` from the exemptions: T12 goes red. Then replace its prices with rule prices in a scratch
    copy and keep it exempt: the "exemption deviates" assertion goes red;
  - `garage_closeups.test.ts` with no JPEGs: red by name (this is the state before WP9, recorded, not undone);
  - in `buildMatchWorld`, call `seatKitTiers(seats[s])` (the default base roster) instead of `seatKitTiers(seats[s],
    walked)`: `special-tiers.test.ts`'s `mbt_lavi_camo` case goes red and the `inf_grenadier` case stays green;
  - drop the `inf_grenadier` tier-2 delta in a scratch copy of its JSON: the `inf_grenadier` literal goes red.
- [ ] **Step 5: Commit** with `git commit -- <paths>`. The commit message lists the red lines and says that
  `garage_closeups.test.ts` turns green at WP9.

**Gate:** T12, T13 (after WP9), T14, T15, T16, T23, `special-tiers.test.ts`, and `BRIGADE_CAMO_PIN` unchanged. This
is the first enforced gate on WP1's fit. **Falsification:** Step 4, and WP1's for T14 to T16.

---

### Task WP9: the 11 close-ups (D2; same branch and PR as WP8)

**Implementer:** `blender-art`, Sonnet. **No Meshy.** This task is its one browser.

**Files:**
- Create: `assets/ui/garage/closeups/{mbt_lavi_camo_armour,mbt_lavi_camo_sensors,mbt_lavi_camo_firepower,spg_long_range_armour,spg_long_range_sensors,spg_cluster_armour,spg_cluster_sensors,veh_ambulance_armour,veh_ambulance_sensors,air_medevac_heli_armour,air_medevac_heli_sensors}.jpg`
  (the track names follow WP1's fit; the firepower close-up exists only where the fit kept a firepower track)
- Modify: `assets/ui/garage/closeups/manifest.json` (11 entries, written by the tool)

- [ ] **Step 1: Pre-flight.** Run `git status --porcelain -uall art/ assets/meshes/ art/meshy/` and save the output.
  The port must be free (the tool refuses a busy port). No other browser may be running for this session.
- [ ] **Step 2: Render:** `pnpm closeups:garage -- --only=mbt_lavi_camo,spg_long_range,spg_cluster,veh_ambulance,air_medevac_heli --port=5236`.
  The tool reports the GPU backend; record it. Record every "region empty, whole model" warning by name (R0.7).
- [ ] **Step 3: Check:**
  - `pnpm vitest run tools/src/garage_closeups.test.ts` is GREEN: 47, 18, 12, the manifest equals the plan, and each
    JPEG is 480x320;
  - `git diff --stat origin/main -- assets/ui/garage/closeups` shows exactly 11 new JPEGs plus the manifest, and no
    shipped JPEG changed byte-wise (`--only` kept the 36);
  - `git diff --stat origin/main -- art assets/meshes` is empty;
  - `art/meshy/ledger.jsonl` is unchanged. Compare `git status --porcelain -uall art/meshy/` with Step 1.
- [ ] **Step 4: Falsify, then undo:** delete one of the 11 JPEGs, and the test goes red by name. Drop one manifest
  entry, and it goes red again.
- [ ] **Step 5: Commit** with `git commit -- assets/ui/garage/closeups/<the 11>.jpg assets/ui/garage/closeups/manifest.json`.
  Push and open the WP8+WP9 PR as "held for the lead's sheet (D2)". Its body states the backend, the warnings, and
  "no Meshy call; ledger unchanged".

**Gate:** T13 green. The diff census in Step 3. **Falsification:** Step 4.

---

### Task WP10: the look sheet for the lead (the panel, the Garage, the close-ups)

**Branch:** `tools/store-garage-sheet`, plus a LOCAL integration worktree (never pushed) that merges WP6, WP7 and
WP8+WP9 onto `origin/main`. **Implementer:** Sonnet. **Publisher:** the coordinator.

**Files:**
- Create: `tools/src/ui-review/store-garage-sheet.ts`, modelled on `coin-wallet-check.ts`:
  - `claimPort`, refusing 5177; default port 5239;
  - `claimGpuBackend` (Metal);
  - `musicOffInitScript()`;
  - one browser, exit on finish (`stopDevServer`, process group).
- Create: `tools/src/ui-review/store-garage-seed.ts` and its test (`store-garage-seed.test.ts`), modelled on
  `garage-seed.ts`. The account and wallet seed is a `migrateAccount` / `migrateRoar` fixed point:
  - the starting roster open;
  - `spg_long_range` bought with credits, with coin armour tier 2 and earned 0 (the mixed track);
  - `inf_medic_squad` not bought;
  - 800 credits.
- Modify: `tools/package.json` (`"store-garage:sheet": "tsx src/ui-review/store-garage-sheet.ts"`)

The sheet: PNGs and an `index.html` written to `/Users/ilpinto/dev/roaring-lions-ep/_coord/store-garage/sheet/`,
never into the repo. It holds:
1. the Stores with "What it adds" open on `spg_long_range`, and then on `inf_medic_squad`, at 1920x1080 and
   1280x720;
2. the same two under `?pseudo=1`, to catch strings that skipped `t()`;
3. the tier rows on the howitzer, showing the run label and the credit Buy beside the coin Buy;
4. the Garage bay on `spg_long_range` with its two tracks and the run-labelled credit Buy;
5. a contact sheet of the 11 new close-ups beside the shipped `mbt_lavi` three, for scale and framing. This part
   needs no browser: an HTML grid of the JPEGs. Every R0.7 whole-model warning is captioned.

- [ ] **Step 1: Write the failing test** `store-garage-seed.test.ts`: the seed survives `migrateAccount` and
  `migrateRoar` unchanged, and `creditAsk` on the seeded howitzer armour reads `{1, 3, …, again: 2}` (literal).
- [ ] **Step 2: Implement** the seed and the sheet tool. Run it ONCE in the integration worktree.
- [ ] **Step 3: Falsify:** a seed whose `balance` exceeds what its grants cover is changed by `migrateAccount`, and the
  seed test goes red. Undo.
- [ ] **Step 4: Commit** the tool and the seed with `git commit -- <paths>`. Open a PR; it merges on green, because
  it is a tool.
- [ ] **Step 5: The coordinator publishes** the sheet as a private Artifact and posts ONE comment on GH-1076 and
  GH-1077 (decisions go on issues, never in HANDOVER). The comment links the sheet and names the three held PRs.
  It asks:
  - D2: approve the 11 close-ups as rendered, with any whole-model framing named?
  - the panel: does it read before buying, and is any block noise?
  - the run label wording ("pays for tiers 1-2 again, on credits"). R0.1 itself is already ruled and is not asked
    again.

**Gate:** the seed test. The sheet itself is evidence, not a gate.

---

### Lead review (after WP10, before WP11)

WP11 does not start until the lead answers on GH-1076/1077. A rejected close-up goes back to WP9 on the same branch,
with a new render after the lead approves its framing, per the house rule. A rejected panel block goes back to WP6.

---

### Task WP11: merge order and notes

**Implementer:** Haiku. **Reviewer:** Sonnet.

**Files:**
- Modify: `docs/agent-notes/shell-and-ui.md`, one section, "Stores: What it adds, and credit runs":
  - `unitAdds` and the generated threat table (`pnpm store:threats`; its test goes red on any roster or tuning change
    until regenerated);
  - R3 with R0.1, and `creditAsk` (prices, earned, owned);
  - the A2 stale-cache requirement from **Conflicts**.
- Modify: `CLAUDE.md` "Commands": one line, `pnpm store:threats` (the Hurt-by table, regenerate after a roster or
  tuning change).

- [ ] **Step 1: Merge in order:** WP6, then WP7, then WP8+WP9, each on green, each after the lead's yes. After each
  merge, run `gh run list` and check the run.
- [ ] **Step 2:** After the WP8+WP9 merge, re-run `versus-specials.test.ts` (`BRIGADE_CAMO_PIN`) and
  `special-tiers.test.ts` on `main`. Both stay green.
- [ ] **Step 3: Commit** the notes with `git commit -- <paths>`. Comment on GH-1076 and GH-1077 with the merged PRs.
  Close neither issue: the lead does.

---

## Spec §4 tests: where each lands

| test | task |
|---|---|
| T1, T3, T4, T6, T7, T8 | WP3 |
| T9 | WP3 (fixture), WP8 (shipped) |
| T2, T10, T11 | WP6 |
| T12 | WP1 (staged form), WP8 |
| T13 | WP8 + WP9 (one PR) |
| T14, T15, T16 | WP1 (fit and falsification), WP8 (re-run on landed data) |
| T17, T18, T21, T22 | WP4 (T17's `(0, 3)` case is `null` by R0.1) |
| T19 | WP5 |
| T20 | WP7 |
| T23 | every PR |
| T5 | WP2 (plus R0.10's two literals) |

## Self-review notes

- Coverage:
  - spec §1.1 and §1.5: WP6;
  - §1.2: WP3;
  - §1.3: WP3's literals (T1, T6, T7);
  - §1.4: WP2;
  - §2.1 and §2.2: WP1 and WP8;
  - §2.2's art: WP9;
  - §2.3: WP4, WP5 and WP7, with R0.1 and R0.2;
  - §2.4 and §2.5: WP4 (T21, T22);
  - §3: the Files lists;
  - §4: the table above;
  - §5: out of scope, kept (no kit parts, no Garage panel, no enemy tiers);
  - §6: the lead's rulings.
- Order constraints:
  - the fit before the data: WP1 before WP8, with the staged hand-off;
  - renders through `blender-art`, no Meshy: WP9's census;
  - tracks and close-ups in one PR: WP8+WP9;
  - `applyUpgrades` before `addUnitType`: data only, T23, and the empty `packages/sim` diff;
  - `t()` and no colour literals: WP6 and WP7 (pseudo test, `validate:ui`).
- Names are used consistently across tasks: `unitAdds`, `AddsInput`, `UnitAdds`, `APP_HEAVY_COLLATERAL`,
  `buildThreatTable`, `creditAsk`, `CreditAsk`, `buyUpgradeRun`, `buyTierWithCredits`, `tierCreditBuyEnabled`,
  `onBuyTierCredits`, `StoresOptions.adds`/`onAdds`, `AddsInput.refusal`, `brigadeRoom`, `special-tiers.test.ts`,
  `store:threats`, `store-garage:sheet`.
- Revised 7 Nov after PR 1109's review:
  - R0.1 is ruled (dropped);
  - the Conflicts section is rewritten against PR 1110 (head `d667dd5c0`);
  - WP6 and WP8 depend on PR 1110;
  - T18 checks an independent shadow counter;
  - WP1's evidence is stated, and WP8 is the first enforced gate;
  - the empty-loop bounds are added;
  - WP2's facing value is named (16384).
