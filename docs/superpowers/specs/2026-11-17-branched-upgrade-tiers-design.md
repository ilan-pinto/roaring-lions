# Branched upgrade tiers: an either/or choice at tier 3 (GH-1384)

**HOLD FOR LEAD.** Design only. Nothing here is built, and no unit JSON, schema, code or
`tuning.ts` line changes with this document. Audit dimension D2, size L. The issue asks for
"a short spec and a mock for the lead before any build"; this is both.

- **Date:** 2026-11-17, written against `origin/main` at `5147ce2`. Revised the same day after a
  design review (CHANGES): every code reference was re-checked against `origin/main` at
  `387d865`, and none of the cited files moved in between.
- **Section numbers.** A bare "§N" is this document. A section of the upgrade-tracks document
  is always written "`upgrades.md` §N" (`docs/campaign/economy/upgrades.md`).
- **Issue:** GH-1384, which has no comments yet. Done means: at least ten unit types offer two
  exclusive branches at one tier, expressed in the upgrade data and applied through `applyUpgrades`;
  the Garage shows the branch and what is given up; the kit reads on the unit icon; and a test
  fails if both branches can be owned at once.
- **Constraints carried from the issue and CLAUDE.md:** no new unit, no `tuning.ts` change, no
  combat-model change, no kit mark in the world (CLAUDE.md:313), credits are never sold and this
  adds no purchase path, and art numbers and any Meshy budget need the lead's approval first.

## 0. What exists today (the history check)

**The tier model.** Every KDF type carries two or three tracks (`armour`, `sensors`, `firepower`)
of exactly three tiers each, 30 types in all (`data/units/kdf/*.json`). A tier's `patch` is the
cumulative DELTA over base, not over the tier below. `price` is the incremental price of that one
tier (`packages/data/src/upgrades.ts:14-19`; `docs/campaign/economy/upgrades.md:29-37`). The
patch whitelist is closed: `hull.hp`, `hull.armor.front|side|rear`, `hull.suppression_resistance`,
`sensors.optics`, `sensors.sight_tiles`, `weapons[i].accuracy|penetration`
(`upgrades.ts:43-50`, mirrored in `data/schemas/unit.schema.json:105` and up, the
`propertyNames.pattern`, and in `tools/validate_balance.py:69-85`). `validate:data` requires every
tier to be monotone over the one below it (`tools/validate_data.mjs:113`, `:399-425`).

**`applyUpgrades`** (`upgrades.ts:213-264`) is pure. Within a track the highest tier owned wins
per path; across tracks the deltas sum, walked in sorted track order. It runs before
`addUnitType` in the app (`packages/app/src/upgrade-prepass.ts:45-66`), the versus match world
(`packages/app/src/net/special-tiers.test.ts` pins it with literal Q16.16 hp), the playtest
(`tools/src/backtest/playtest.ts`, `tiers: 'max'`) and the backtest
(`tools/src/backtest/harness.ts:15-20`, `unitsAtMaxTier`), "so the sim never learns a tier exists"
(CLAUDE.md:285). Nothing in this design changes that.

**The tier budgets** (the numbers every branch below must stay inside):

- **Price rule** (GH-1077): `price = round5(cost.logistics x m[track][tier])`, with
  `m.armour = 0.40 / 0.60 / 0.85`, `m.sensors = 0.33 / 0.50 / 0.70` and
  `m.firepower = 0.50 / 0.75 / 1.05` (`upgrades.md:50-56`). It reproduces all 46 shipped tracks
  of the earned-gate and starting units; "a fit may move a DELTA, never a price: a price moves
  only by the lead's ruling" (`upgrades.md:64-65`).
- **Delta curve:** armour 7 / 15 / 25 % of base on hp and all faces; sensors 8 / 15 / 25 % of base
  optics plus +1 / +2 / +3 sight tiles; firepower +0.03 / +0.06 / +0.10 accuracy plus
  8 / 16 / 25 % of base penetration (`upgrades.md:90-96`). There are four measured exceptions:
  `at_team` firepower accuracy is capped at +0.07 (`upgrades.md` §4.1); `mbt_lavi` armour is cut
  to 2 / 3.5 / 5 % (`upgrades.md` §4.2); `inf_squad` sight is capped at +1 / +2 / +2
  (`upgrades.md` §4.3); and `heli_peten` armour is cut to 5 / 8 / 12 % (`upgrades.md` §4.4).
- **Cost-curve factor:** `k = 0.02` (`upgrades.md:2615`). CI runs the max-tier cost curve as
  `validate_balance.py --max-tier --upgrade-cost-factor 0.02` (`.github/workflows/ci.yml:171-172`).

**Ownership** lives in two stores, which the single-player view merges:

- **Credits.** `BrigadeAccount.upgrades[unit][track] = tier`, under `lions.brigade.account`
  (`packages/economy/src/brigade.ts:35-56`, `ACCOUNT_VERSION` 2 at `:24`). It is migrated on every
  read (`migrateAccount`, `:149`; `migrateUpgrades`, `:105`) and bought one tier, or a run of tiers,
  at a time with no refunds (`buyUpgradeRun` `:238`, `buyUpgrade` `:274`). For a member it is
  synced as `campaign_state.brigade`, "through migrateAccount"
  (`packages/worker/migrations-accounts/0001_members.sql:95-103`).
- **Coins.** `RoarWallet.entitlements.upgrades[unit][track] = { tier, paidTiers }`, under
  `lions.roar` (`packages/economy/src/wallet.ts:36-39`, `:63-72`), bought with
  `buyTierWithCoins` (`:271`). Each purchase leaves a `tier` receipt carrying its `CoinSplit`. For
  a member every coin moves only through a server route, journalled in `coin_journal`, whose
  `kind` CHECK is closed (`migrations-accounts/0004_admin.sql:15`).
- **The merge.** `singlePlayerView` takes `max(earned, coins)` per track (`wallet.ts:364-379`;
  `packages/app/src/account-view.ts:22-26`). `networkView` reads `earned` only (`wallet.ts:382`),
  but **no production path calls it**: `git grep networkView` finds only its definition, a
  re-export and tests.
  Since GH-1143 a credit run can pay again for a tier the coins already hold, so both stores can
  legitimately hold the same tier.
- **Versus rooms read the single-player view.** The room claim is
  `tiers: () => accountState().ownedTiers` (`packages/app/src/main.ts:1437`), and
  `accountState()` is the `earned OR coins` view, so coin tiers are in it. Three gates keep it out
  of a matched room: the create body sends `{}` when `kit === 'matched'`
  (`packages/app/src/net/connect.ts:344`; a JOIN always sends the claim, since a guest cannot know
  the room's rule); the room mints a seat's tiers only for `kit === 'brigade' && faction === 'kdf'`
  (`packages/worker/src/match/match-room.ts:509`); and the world reads them only for such a seat
  (`seatKitTiers`, `packages/app/src/net/match-world.ts:441-443`). A friends' brigade room
  carrying coin tiers is the ruled D4 exception (coin-wallet spec
  `2026-11-04-roar-coin-wallet-design.md` §6, D4, 11 Oct), and gate G-V1
  (`packages/app/src/net/coin-claim.test.ts`) covers matched rooms only.
- **Save slots** (`lions.saves`) snapshot the brigade account but NOT the wallet (CLAUDE.md:271).
  A member's server save slots (`packages/worker/src/account/slots.ts`) hold the same
  `SaveSlot`, parsed by the one `parseSlot`, which runs `migrateAccount`
  (`packages/economy/src/slot.ts:45`).
- **Mid-mission resume** (GH-1393). A suspended mission is rebuilt from its frozen
  `StartInputs` (`packages/app/src/mission-resume.ts:15-24`), whose `tiers` is the only kit it
  carries. `whatMoved` (`:73-80`) compares the ledger, the units and the tiers. A content change
  is NOT a refusal (`contentChanged`, `mission-save.ts:294`): it is worded, and the resume goes on.

**Kit reading.** `kitCounts` and `kitLevel` (`upgrades.ts:178-195`) turn the tiers owned into 0-3
steel Stars of David on every unit icon (`packages/app/src/ui/kit-sign.ts:127`,
`kitIconSignHtml(level)`). The world draws no kit mark. The renderer grafts bought kit PARTS onto
kitted vehicles by tier (`upgrade-prepass.ts:80-92`, `effectiveKitTiers`; GH-238).

**History.** There is no earlier spec, plan or ruling on branches: a search of `docs/` for GH-1384,
"branched" and "exclusive" found nothing on tiers. The merged work this design builds on is
GH-1077 (the nine bought-only units' tracks and the price rule), GH-1143 and GH-1146 (credit runs
over coin-held tiers), GH-1102 (per-seat kit in brigade rooms) and GH-238 (kitted vehicles). The
falsification passes of GH-1385 (PR 1512, `brigade-account.test.ts`; PR 1517,
`roar-wallet.test.ts`) set the style the test in §5 follows: one guard at a time, with literal
oracles.

## 1. The data shape

### 1.1 Decision

The LAST tier of a track may be **branched**. Instead of one `patch` it carries exactly two
`branches`, and both branches share the tier's one `price`. Every other tier stays as it is.

```jsonc
// data/units/kdf/mbt_lavi.json, upgrades.firepower (today: lines 146-169)
"firepower": {
  "tiers": [
    { "price": 455, "patch": { "weapons[0].accuracy": 0.03, "weapons[0].penetration": 104 } },
    { "price": 680, "patch": { "weapons[0].accuracy": 0.06, "weapons[0].penetration": 208 } },
    {
      "price": 950,
      "branches": [
        {
          "id": "fire_control",
          "label": "garage.branch.mbt_lavi.fire_control",
          "patch": { "weapons[0].accuracy": 0.10, "weapons[0].penetration": 208 }
        },
        {
          "id": "long_rod",
          "label": "garage.branch.mbt_lavi.long_rod",
          "patch": { "weapons[0].accuracy": 0.06, "weapons[0].penetration": 325 }
        }
      ]
    }
  ]
}
```

**Schema** (`unit.schema.json`, under `upgrades.<track>.tiers.items`): a tier is `oneOf` two
shapes. The first is `{ price, patch }`, today's shape, unchanged. The second is
`{ price, branches }`, where `branches` has `minItems: 2, maxItems: 2`. Each branch is
`{ id, label, patch }`, with `additionalProperties: false`. `id` matches `^[a-z][a-z_]{1,23}$`.
`label` matches `^garage\.branch\.` and is an i18n KEY in `en.json`, never text, as formation
`label`s are (`data/schemas/formation.schema.json:11`). `patch` is today's patch definition,
shared by `$ref`.

**Cross-field rules** (`validate:data`, in a new `tools/validate_branches.mjs` beside
`validate_formations.mjs`):

- **B1.** Only a track's LAST tier may be branched, and a unit may branch at most ONE track
  (slice 1; see Q3).
- **B2.** The two branch `id`s differ, and both `label` keys exist in `en.json`.
- **B3.** Both branches patch exactly the set of paths that the tier below patches.
- **B4. The split rule: the FLOOR.** For every path, the smaller of the two branch values equals
  the tier below's value, and the larger is at least that. So a branch either keeps a path at the
  tier below or raises it, and on every path at least one of the two branches gives the raise up
  entirely. B4 says nothing about how far the larger value may rise: on its own it does not keep
  a branch inside the budget.
- **B5. No dominance.** Each branch is strictly above the tier below on at least one path, and
  strictly below the other branch on at least one path. A branch that wins or ties everywhere is
  refused.
- **B6.** The per-path MAXIMUM over the two branches (the envelope) is the budget. For the
  thirteen units in §2, the envelope equals today's linear tier 3 to the digit.
- **B7. The CEILING.** For every path, the envelope is at most a literal ceiling, held in a
  table `BRANCH_CEILING[unit][track][path]` inside `tools/validate_branches.mjs`. The table is
  written by hand from today's shipped tier-3 deltas (the "T3 today" column of §2.1), never read
  from the unit JSON it guards, because an oracle takes literals. A later edit that raises one
  branch above it fails `validate:data`, naming the unit, the path, the value and the ceiling. A
  unit that branches with no row in the table is refused too, so a new branched unit cannot skip
  the ceiling by omission. Raising a ceiling is an edit to that table, which a reviewer sees, and
  it still has to pass both balance gates (§6).
  - *Alternative, for the lead:* derive the ceiling from the delta curve (`upgrades.md:90-96`)
    and the unit's base, with the four `upgrades.md` §4.1-§4.4 exceptions as literals. That
    follows a base-stat change automatically, but it needs the curve's own rounding (the jeep's
    front +3.5 ships as +4, the AT team's optics +0.275 as +0.28) written into the validator.
    The literal table is the smaller change, and it is what this design proposes.
  - Without B7, only the two balance gates (§6) would hold the ceiling.

`tierRegressions` (`validate_data.mjs:113`) runs per branch against the tier below, so B4's
"at least" is the existing monotone rule, applied twice.

**Three tier readers in `tools/` must learn the new shape, and must RAISE on one they do not
know.** None is typed, so the compiler cannot find them (R3):

- `validate_balance.py:156` reads `tier_list[i].get("patch", {})`. Left unmirrored, a branched
  tier reads as `{}`, the max-tier unit is measured at tier 2, and the cost curve passes. That is
  the casebook's "empty input, every caller passes" shape.
- `validate_data.mjs:412` reads `tier.patch ?? {}` to check that every patched path exists on the
  unit. Left unmirrored, a branch that patches a path the unit lacks is never checked. That is
  silent too.
- `validate_data.mjs:118-119` (`tierRegressions`) reads `prev.patch ?? {}` and
  `curr.patch ?? {}`. This one is NOT silent: left unmirrored, it reports every path of tier 2 as
  "missing" on a branched tier 3, so it refuses every branched unit. That is a false red, not a
  false green. It still has to learn branches, but it cannot let one through.

The rule for all three: a tier is read through one helper per language (`tier_patches(tier)` in
Python, `tierPatches(tier)` in the validator) that returns the one patch of a plain tier, or both
branch patches of a branched tier, and throws on a tier with neither `patch` nor `branches`, or
with both. `apply_upgrades` additionally throws on a branched tier reached with no `--branch`.
Mutations M7 and M8 (§5.3) prove the throw.

### 1.2 `applyUpgrades` and its neighbours

```ts
// packages/data/src/upgrades.ts
export type BranchPick = 1 | 2;
/** Per track: which branch of the track's branched last tier is owned. */
export type BranchPicks = Readonly<Record<string, BranchPick>>;

export interface UpgradeBranch { id: string; label: string; patch: Record<string, number> }
export type UpgradeTier =
  | { price: number; patch: Record<string, number> }
  | { price: number; branches: readonly [UpgradeBranch, UpgradeBranch] };

// BEFORE: applyUpgrades<T extends UpgradableUnit>(unit: T, tiers: Readonly<Record<string, number>>): T
export function applyUpgrades<T extends UpgradableUnit>(
  unit: T,
  tiers: Readonly<Record<string, number>>,
  picks: BranchPicks,          // REQUIRED, no default: the compiler lists every caller
): T;

export function maxTiers(unit: UpgradableUnit): Record<string, number>;              // unchanged
export function maxPicks(unit: UpgradableUnit, pick: BranchPick): Record<string, BranchPick>; // new
export function branchOf(unit: UpgradableUnit, track: string): readonly [UpgradeBranch, UpgradeBranch] | null; // new
```

How the walk changes, on the same loop at `upgrades.ts:239-257`:

- For a branched tier `i`, the patch read is `tier.branches[picks[track] - 1].patch`.
- **A branched tier with no pick, or with a pick that is not 1 or 2, is not applied, and the
  walk stops below it** (the track resolves as if owned to `i`). So an unpicked tier 3 is never
  free stats, and never "both".
- Nothing else moves. The sum across tracks, the clamp to the track's length and the sorted walk
  all stay as they are.

The third parameter is required on purpose. 29 files name `applyUpgrades` today
(`git grep -l applyUpgrades -- packages tools` at `387d865`, tests included). A default of `{}`
would let any of them silently drop a player's tier 3 on a branched track. A required parameter
makes the compiler the audit, which is the house rule for `api.ts` too ("checked by the compiler
rather than a grep").

**Alternatives rejected:**

- *Encode the pick in the tier integer* (3 means branch 1, 4 means branch 2). The `max(earned,
  coins)` merge would then silently pick branch 2. `kitCounts` would count four tiers. And the
  clamp-to-length rule would erase the pick.
- *A reserved key in the same map* (`{ "firepower": 3, "firepower.pick": 2 }`). This rides every
  existing carrier unchanged. But it is a convention the type checker cannot see, and `isTiers`
  (`packages/net/src/config.ts:480`) would accept a pick as a tier. A missed carrier would then
  drop the pick with no error. A separate `picks` field fails to compile instead.
  - **What this rejection did not weigh (review finding 3):** the reserved key SURVIVES an older
    build. `migrateUpgrades` (`brigade.ts:105-116`) keeps any non-negative integer under any
    key. `migrateRoar` keeps any track key whose value carries an integer `tier`
    (`wallet.ts:135-142`), so the wallet could carry the same trick as
    `"firepower.pick": { tier: 2, paidTiers: 0 }`, though it rebuilds every entitlement as
    `{ tier, paidTiers }` and would strip a `branch` field beside them. An old build's
    `kitCounts` and `applyUpgrades` walk the unit's own tracks and ignore an unknown key
    (`upgrades.ts:178-188`, `:239-243`), so it is inert there; any other old reader of the map
    is to be checked before this option is chosen. A separate `picks` field is
    stripped by every older build that writes the store. §4.4 sets out what that costs. The
    choice is Q9, the lead's; this document keeps the separate field as its proposal, with §4.4's
    server-side guard.
- *Branching across tracks* ("armour III or firepower III"). This needs no new stats, but it takes
  a whole tier from every player who owns both today, and it fits the issue's "two branches at
  one tier" less well.

### 1.3 Every carrier of a tiers map gains a picks sibling

| carrier | today | adds |
|---|---|---|
| `BrigadeAccount` (`economy/src/brigade.ts:35`) | `upgrades` | `picks: Record<unit, Record<track, 1\|2>>` and `legacy: Record<unit, Record<track, true>>` (§4). Both migrate to `{}` when absent, as `coupons` did, so `ACCOUNT_VERSION` does not move |
| `TrackEntitlement` (`economy/src/wallet.ts:36`) | `{ tier, paidTiers }` | `branch?: 1\|2`, `legacy?: true` |
| `resetFree` (`wallet.ts:307-313`) | keeps `{ tier: paidTiers, paidTiers }` | keeps `branch` too when `paidTiers` reaches the branched tier; drops it (and any `legacy`) otherwise. While `PURCHASES_OPEN` is false `paidTiers` is 0 and nothing is kept |
| `singlePlayerView` (`wallet.ts:377-379`) | `ownedTiers` | `ownedPicks` (merge rule in §4.3). This is the view the game AND the versus room claim read (`main.ts:1437`) |
| `networkView` (`wallet.ts:382-384`) | `ownedTiers` | `ownedPicks`, earned only, for symmetry. It has no production caller today, so it guards nothing on a room path |
| `upgradePrepass` (`app/src/upgrade-prepass.ts:45`) | `ownedTiers` | `ownedPicks`, passed to `applyUpgrades` and `kitSummary` |
| sandbox `&kit` (`app/src/sandbox-force.ts:171-195`, `sandboxKitTiers`, `bootTiers`) | `SANDBOX_KIT_LEVELS` | `sandboxKitPicks(roster)`: pick 1 for every branched track the ladder puts at its last tier (today `mbt_lavi`, `mortar_team` and `dozer_d9` sit at level 3), so `&kit` stays one reproducible picture. Branch 2 would be a flag value (`&kit=2`), parsed in the one flag table `sandbox-help.ts`; it is optional |
| mid-mission resume (`app/src/mission-resume.ts`, GH-1393) | `StartInputs.tiers` | `StartInputs.picks`, written by `startInputsJson`, required by `parseStartInputs` and compared by `whatMoved` (a change reads as `'upgrades'`). A record with no `picks` is REFUSED, never resumed with `{}`: §4.5 |
| versus room claim (`app/src/net/connect.ts:344`) | `{ tiers, specials }` unless `kit === 'matched'` | `picks`, from the same `accountState()` view as `tiers`, INSIDE the same `kit === 'matched' ? {} : {...}` ternary |
| room mint (`worker/src/match/match-room.ts:509`) and world (`app/src/net/match-world.ts:441`, `seatKitTiers`) | a seat's tiers for `brigade` + `kdf` only | a seat's picks under the same condition (`seatKitPicks`), and `{}` otherwise |
| `SeatConfig` (`net/src/config.ts:17`, `isTiers` `:480`, `isSeatConfig` `:487`) | `tiers` | `picks`, bounded as `tiers` is (`TIERS_MAX_TYPES`, `TIERS_MAX_TRACKS`, leaf 1 or 2). OPTIONAL on read, defaulting to `{}`, so a config stored before this change ("read back from a replay or the room's own storage", `config.ts:463`) still parses; always written |
| room cleaning (`worker/src/match/kit-tracks.ts:11`, `seatTiersField`) | `KIT_TRACKS` | `KIT_BRANCHES` (unit to its branched track), pinned both ways by `kit-tracks.test.ts` |
| coin spend route (`worker/src/account/spend.ts:62-69`, `parseAsk`) | `{ item: 'tier', unitId, track, tier }` | `branch` on the branched tier; recorded in `detail`, whose JSON needs no SQL change |
| member claim (`worker/src/account/claim.ts`, `askOrder` `:104`) | the device's entitlements, as asks | the device's `branch` rides an ask as the spend route's does. A device's `legacy` is never read: §4.2 |
| telemetry (`data/schemas/telemetry_event.schema.json`) | `tier` `unit.track.N` (`:156`) and the purchase `item` (`:103`) | `unit.track.3a` / `.3b` in both patterns. Writers: `app/src/telemetry/events.ts:84`, `main.ts:1410`, `app/src/credit-buy.ts:31,35`. The `/stats` readers are `worker/src/stats.ts:223` (parses the array) and `worker/src/stats-page.ts:91` (prints each string with its dots as spaces); neither parses `N` as an integer today, and any reader that does must learn the suffix in the same slice |

**Old replays.** A stored replay's config carries its `build` and `dataDigest`. One recorded
before this change has no `picks`, which reads as `{}`, so a tier-3 claim on a branched track
would rebuild at tier 2. That is the same as any unit edit: a data change moves `dataDigest`,
and a replay is only faithful on the data it was recorded with.

**Two more key formats** build `tier:<unit>.<track>.<N>` strings for DOM state, not for data:
`app/src/ui/brigade.ts:778-780` and `app/src/ui/stores.ts:782`. Where one names a branched tier
it carries the branch too, so the two cards cannot share one key.

The renderer's `unitKitTiers` needs no pick: §3.3 keeps the world's kit parts per TIER.

## 2. Which units: thirteen, one branched track each

**How the branches were chosen.** Every branch is built from numbers already in the shipped JSON.
On the branched track, branch 1 takes today's tier-3 value on one path group and today's tier-2
value on the other; branch 2 takes the reverse. Three things follow:

- Every number in the table below is already in that unit's file, so the budget is met
  literally (B4, B6).
- Neither branch dominates the other (B5).
- Both branches are monotone over tier 2.

The price of the branched tier is today's tier-3 price, unchanged, since a price moves only by the
lead's ruling (`upgrades.md:64-65`; see Q1). Tiers 1 and 2 are untouched.

The path groups, and what each choice means in the combat model:

- **firepower:** `accuracy` (the hit roll) against `penetration` (the margin over armour). One
  buys hits; the other buys kills through plate.
- **armour:** `hull.hp` against the three faces. Faces decide whether a round penetrates at all,
  and the overmatch it gets (`penetrationHpCost`, GH-560). hp decides how many penetrations the
  hull survives.
- **sensors:** `optics` (detection strength, `optics x signature / distance^2`,
  `packages/sim/src/sim.ts:7098`) against `sight_tiles` (the hard radius). One finds camouflaged
  teams inside the circle; the other draws a bigger circle.

Each unit is placed on a track where tier 3 moves BOTH groups above tier 2. That is why the
infantry armour tracks (faces 2 / 2 / 2 at tiers 2 and 3) and the `at_team` firepower track
(accuracy +0.06 against +0.07, `upgrades.md` §4.1's cap) are not used. Their branch would be close to a
strict upgrade.

### 2.1 The table

Δ is the delta over base. "T2" and "T3 today" are the shipped tier-2 and tier-3 deltas. The
file:line given is the tier-3 `price` line in `data/units/kdf/<id>.json`.

| unit (tier-3 price, file:line) | path | base | T2 Δ | T3 Δ today | **Branch 1** Δ | **Branch 2** Δ |
|---|---|---|---|---|---|---|
| `mbt_lavi` firepower (950, `:163`) | accuracy | 0.85 | +0.06 | +0.10 | **Fire-control computer** +0.10 | **Long-rod round** +0.06 |
| | penetration | 1300 | +208 | +325 | +208 | +325 |
| `ifv_namer` firepower (660, `:135`) | accuracy | 0.70 | +0.06 | +0.10 | **Stabilised sight** +0.10 | **Tungsten belt** +0.06 |
| | penetration | 120 | +19 | +30 | +19 | +30 |
| `apc_eitan` firepower (545, `:131`) | accuracy | 0.60 | +0.06 | +0.10 | **Gyro mount** +0.10 | **Armour-piercing belt** +0.06 |
| | penetration | 25 | +4 | +6 | +4 | +6 |
| `sniper_team` firepower (275, `:135`) | accuracy | 0.88 | +0.06 | +0.10 | **Match-grade optic** +0.10 | **Tungsten-core round** +0.06 |
| | penetration | 45 | +7 | +11 | +7 | +11 |
| `heli_peten` firepower (420, `:126`) | accuracy | 0.60 | +0.06 | +0.10 | **Helmet-cued sight** +0.10 | **Heavy 30 mm rounds** +0.06 |
| | penetration | 120 | +19 | +30 | +19 | +30 |
| `inf_squad` firepower (305, `:129`) | accuracy | 0.60 | +0.06 | +0.10 | **Red-dot optics** +0.10 | **Steel-core ammunition** +0.06 |
| | penetration | 8 | +1 | +2 | +1 | +2 |
| `jeep_shoded` armour (270, `:75`) | hp | 520 | +78 | +130 | **Run-flat and spall liner** +130 | **Frontal plate** +78 |
| | front / side / rear | 14 / 10 / 10 | +2 / +2 / +2 | +4 / +2 / +2 | +2 / +2 / +2 | +4 / +2 / +2 |
| `dozer_d9` armour (500, `:45`) | hp | 2400 | +360 | +600 | **Reinforced frame** +600 | **Add-on plates** +360 |
| | front / side / rear | 240 / 170 / 110 | +36 / +26 / +16 | +60 / +42 / +28 | +36 / +26 / +16 | +60 / +42 / +28 |
| `apc_kipod` armour (480, `:85`) | hp | 1750 | +262 | +438 | **Spall liner** +438 | **Appliqué armour** +262 |
| | front / side / rear | 260 / 160 / 100 | +39 / +24 / +15 | +65 / +40 / +25 | +39 / +24 / +15 | +65 / +40 / +25 |
| `at_team` sensors (165, `:104`) | optics | 1.10 | +0.17 | +0.28 | **Launcher optic** +0.28 | **Forward spotter** +0.17 |
| | sight tiles | 9 | +2 | +3 | +2 | +3 |
| `scout_shachaf` sensors (285, `:113`) | optics | 1.90 | +0.28 | +0.47 | **Long-lens camera** +0.47 | **Raised mast** +0.28 |
| | sight tiles | 16 | +2 | +3 | +2 | +3 |
| `mortar_team` sensors (145, `:107`) | optics | 0.90 | +0.14 | +0.23 | **Spotting scope** +0.23 | **Forward observer** +0.14 |
| | sight tiles | 7 | +2 | +3 | +2 | +3 |
| `recon_drone` sensors (145, `:82`) | optics | 2.00 | +0.30 | +0.50 | **Stabilised gimbal** +0.50 | **Wide-angle camera** +0.30 |
| | sight tiles | 16 | +2 | +3 | +2 | +3 |

That is thirteen types, so three can be struck and the issue's ten still met. The mix is six
firepower, three armour and four sensors. It covers every arm: tank, IFV, two APCs, a jeep, the
D9, a gunship, a drone, and rifle, sniper, AT and mortar teams.

**Why these splits and not others, unit by unit, for the lead's veto:**

- The `inf_squad` firepower split leaves its sensors track alone, so `upgrades.md` §4.3's sight cap is not
  touched.
- `heli_peten` branches firepower, which `upgrades.md` §4.4 measured clean, and not the armour track that broke
  the AA target.
- `mbt_lavi` branches firepower and not armour. `MBT_BARE` copies the Lavi's HULL into the ATGM Pk
  target (`tools/src/backtest/targets.ts:58`, `upgrades.md` §4.2), and its `weapons: []` means no firepower
  number can reach that target.
- `at_team` branches sensors: its Spike reaches 13 tiles against a sight of 9, so sight is worth
  something to it, unlike the rifle squad's 8 against 8.
- The two armour vehicles with a team mark and kit parts (`apc_kipod`; the D9 has no mark) keep
  every part. §3.3 explains why parts follow the tier, not the branch.

The names are proposals. Each is an `en.json` key (`garage.branch.<unit>.<id>`), so the lead can
rename any of them without touching a number.

### 2.2 What each branch costs in strength, against today's tier 3

On every path, each branch EQUALS either tier 2 or today's tier 3, never a value between them,
and at least one of the two branches is at tier 2. Where tier 2 and tier 3 already coincide (the
jeep's side and rear faces, +2 at both), both branches equal both. Each branch is therefore
below today's tier 3 on at least one path and never above it on any. **So branching is a nerf of
the top end, by design**: the old tier 3 was the envelope of the two. A player gives up
one group's last step to choose the other. This is the decision the rubric asks for, and §4 is how
a player who already paid for the old tier 3 is kept whole.

## 3. The Garage

### 3.1 The branched rung

`garage-board.ts` gives each rung a state: `owned`, `next` or `future` (`rungState`, `:46`). Only
the `next` rung is expanded. The branched rung keeps those three states and draws a fork:

```
 FIREPOWER                                    tier 2 of 3 · 1135 spent · 950 to max
 ┌ Tier 1 · 455 ─────────────────────────────────────────────────────── Owned ┐
 ├ Tier 2 · 680 ─────────────────────────────────────────────────────── Owned ┤
 └ Tier 3 · 950 · choose one ────────────────────────────────────────────────┘
   ┌──────────────────────────────┐   ┌──────────────────────────────┐
   │ Fire-control computer         │   │ Long-rod round                │
   │ Accuracy 91% → 95%            │   │ Penetration 1508 → 1625       │
   │ Gives up: Penetration         │   │ Gives up: Accuracy            │
   │   stays 1508 (not 1625)       │   │   stays 91% (not 95%)         │
   │ [ Choose · 950 credits ]      │   │ [ Choose · 950 credits ]      │
   └──────────────────────────────┘   └──────────────────────────────┘
   This choice is final. The branch you do not choose cannot be bought later.
```

The numbers above are the Lavi's own:

| | accuracy | penetration |
|---|---|---|
| base | 0.85 | 1300 |
| after tier 2 | 0.91 | 1508 |
| after Fire-control computer | 0.95 | 1508 |
| after Long-rod round | 0.91 | 1625 |

**The rules for each card:**

- **The benefit lines** come from `upgradeBenefits` run on that branch's patch, read against
  tier 2. It is the same function and the same `readPath`, so the card cannot print a number the
  sim will not run (`upgrade-benefit.ts` header; `visibleBenefits` drops a line that does not
  move).
- **"Gives up"** is computed, never authored. It lists every path where the OTHER branch's value is
  higher, with both numbers: this branch's value, and the value the other branch would give. Each
  line is a `t()` string, `garage.branch.givesUp`, `"{label} stays {mine} (not {theirs})"`. That is
  plain, and it carries the number, which is what "state plainly what is given up" asks for.
- **The Buy** goes through the existing confirm dialog (`confirmDialog`, `{ answer, close }`)
  because it cannot be undone. The dialog repeats both lines: "You are choosing Fire-control
  computer. Long-rod round is given up for good."
- **The other states:**
  - *Owned:* the rung collapses to `Tier 3 · Fire-control computer · Owned`. Under it a muted,
    read-only line names `Given up: Long-rod round` with its numbers, so the choice stays legible
    later. It is muted ink (`--ink-muted`), not `--bad`: giving up a branch is not an error.
  - *Future:* `Tier 3 · 950 · choice of Fire-control computer or Long-rod round`, one line, with
    the full text in `title`, as a future rung is drawn today.
- **The coin path** draws the same two cards with coin prices (`coinPrice(950)`). The credit-run
  wording (`garage.buy.run`, "pays for tiers 1-2 again, on credits") is unchanged, and the run's
  last tier carries the chosen branch.
- **Accessibility:** each card is one labelled group, and its Buy names the branch
  (`garage.branch.buy.aria`, "choose {branch} for {name}, {price} credits, gives up {other}").
  Tab order is card 1, then card 2. A digit jump (`brigade.ts`) still lands on the track.
- **UI law:** no colour literals (`validate:ui`). The cards use the semantic tokens
  `--kit` / `--ink` / `--ink-muted`. Every string goes through `t()`, and branch names are
  `garage.branch.<unit>.<id>`.

### 3.2 The HUD card and the pips

`kitPipsHtml` (`kit-sign.ts:230`) draws one square per tier. A branched track's third pip
is drawn SPLIT: a diagonal half-fill, the left half for branch 1 and the right half for branch 2.
Its `aria-label` names the branch: `kit.pips.trackBranch`,
"{track}: {n} of {m}, {branch}". `KitSummary` (`kit-sign.ts:168`) gains
`branch: { track, pick, label } | null`.

### 3.3 The kit on the unit icon: `kitIconSignHtml`, no world overlay

The sign stays 1 to 3 steel Stars of David, counted exactly as today. A branched tier counts as
ONE tier toward `kitCounts`, so `kitLevel` does not move for any account. One thing is added:
when a branch is owned, the CORNER star (the one that holds still, `kitStarsSvg`) is drawn split
like the pip, with its left half solid for branch 1 or its right half solid for branch 2, and the
other half outlined in the same `--kit` steel.

```ts
// BEFORE: kitIconSignHtml(level: KitLevel): string
export function kitIconSignHtml(level: KitLevel, branch?: { pick: BranchPick; label: string }): string;
export function kitIconSignDecorHtml(level: KitLevel, branch?: { pick: BranchPick }): string;
export function withKitSign(iconHtml: string, level: KitLevel, branch?: { pick: BranchPick; label: string }): string;
```

- **Accessible name:** `aria-label` becomes `kit.level.branch`, "{level}, {branch}". The decor
  variant stays `aria-hidden`.
- **Shape, not colour,** carries the branch, so a colour-vision setting changes nothing.
- **Level 0 is untouched, byte for byte.** A branch implies tier 3 is owned, so the level is at
  least 1. Every gated golden frame boots a fresh account, with one exception: `kitted` boots
  `&kit`, which puts three branched units (`mbt_lavi`, `mortar_team`, `dozer_d9`) at level 3.
  With `sandboxKitPicks` choosing branch 1 (§1.3), its world parts do not move, because parts
  follow the tier. Whether a unit icon is in that frame is to be confirmed in slice 3. If the
  frame moves, it is blessed from CI and looked at, never blessed from the branch (CLAUDE.md).
- **Mock for the lead** (two sizes, `KIT_ICON_SIGN.chip` 10 px and `.small` 8 px): the split star
  at 8 px is the risk. **Alternatives, if it does not read:**
  - (b) a 2 px steel tick under the corner star, left or right;
  - (c) no visual change, with the branch named only in `title` and `aria-label`.
  - The G-P3 stars are FINAL (the lead, 2026-10-09, `kit-sign.ts:12`), so this is the lead's call
    (Q5).
- **No world overlay** (CLAUDE.md:313). Kitted vehicles keep grafting their tier's PARTS
  (GH-238): both branches of tier 3 draw today's tier-3 parts, so the world shows exactly what it
  shows now. Branch-specific parts would be new art, which needs art numbers and a Meshy budget
  from the lead. That is out of scope here (Q6).

## 4. Save and ledger migration

### 4.1 What "owns both" means today

Under B4 and B6, today's linear tier-3 patch IS the per-path maximum of the two branches. On the
Lavi, the linear tier 3 is accuracy +0.10 and penetration +325, which is Fire-control computer's
accuracy and Long-rod round's penetration at once. **So any store holding tier 3 on a track that
becomes branched owns both branches today.**

This can happen three ways:

- the account alone (`upgrades[u][t] === 3`);
- the wallet alone (`entitlements.upgrades[u][t].tier === 3`);
- both at once (GH-1143: credits paid again for a tier the coins hold).

Tiers 1 and 2 are not affected.

### 4.2 The rule: keep the slot, take the default, and full value back on request

The migration is pure and idempotent, and it lives inside `migrateAccount` and `migrateRoar`. They
run on every read: on the client, and on the server, where `campaign_state.brigade` goes through
`migrateAccount` (`0001_members.sql:95-103`), the member's wallet row goes through `migrateRoar`
in `readWallet` (`worker/src/account/coin.ts:57-64`), and a server save slot goes through
`parseSlot` (§0). It is driven by data: a `BRANCHED` table derived from `@lions/data` (`economy`
may import `data`). For each (unit, track) whose last tier is branched, a store holding that tier
with NO pick gets:

1. **`pick = 1`.** Branch 1 is authored as the one closer to the unit's job (the first column in
   §2.1). The track stays at tier 3, so the mission runs with a branch and never with the old
   envelope.
2. **A `legacy` marker** for that (unit, track): `legacy[u][t] = true` in the account, and
   `legacy: true` on the wallet's `TrackEntitlement`. **The marker carries no number.** The
   account never recorded what a tier cost, so "the price it was bought at" cannot be known, and
   a stored price would be a number the client can forge (for a member, `campaign_state.brigade`
   is a body the client sends). The refund is priced from data when it is taken, which is
   `buyUpgradeRun`'s own rule: "priced HERE. There is no caller-supplied total to trust or forge"
   (`brigade.ts:231-233`).

While the marker stands, the Garage shows the rung as **"Your Tier 3 became a choice"** and offers
two actions. **The player may take one of the two, once**, because either one clears the marker:

- **Switch, free.** Move to the other branch at no cost. This clears the marker.
- **Return it.** The track drops to tier 2 and the store that paid is refunded in full:
  - credits: `balance +=` the branched tier's `price`, read from the unit's JSON at that moment
    (the same `prices` table `buyUpgradeRun` reads). Today that is the tier-3 price the player
    paid, because a price moves only by the lead's ruling. If the lead rules a new branch price
    (Q1), the slice that changes it also records the pre-branch price as DATA beside it (a
    `legacy_price` on the branched tier), and the refund reads that. It is never read from the
    store;
  - coins, for a guest: the newest `tier` receipt for that (unit, track, tier) gives the exact
    `CoinSplit`, or `coinPrice(price)` as free coins if the receipt was pruned past
    `RECEIPT_CAP`;
  - coins, for a member: the server's own journal (`receiptsOf`, `coin.ts:134`), never a
    receipt the device sends; with no `tier` row for it, `coinPrice(price)` as free coins.

  This also clears the marker. The player can then buy either branch fresh at today's price.

The marker has no expiry. No buy can happen in the store that holds it, since its track is at
its last tier. A buy in the OTHER store does not touch it (§4.3 and Q11). `resetAccount` clears
the account's markers, and `resetFree` clears the wallet's along with the free tiers it discards.

**The server recomputes; it never carries a device's flags.** On the server, `legacy` and
`branch` come only from the server's own migration of rows the server holds, from `BRANCHED`.
The claim route (`worker/src/account/claim.ts`) already treats everything a device sends as
"evidence, a ceiling or an ask, never an amount" (its header, `:1-12`): a device's coin
entitlements are carried as asks and charged against the coins this claim credited (`askOrder`,
`:104`). A carried branched tier is therefore a fresh buy of the device's pick, and it gets no
marker, whatever the device's wallet says. For credits, the campaign write keeps the server's own
marker state (§4.4).

**Why this rule never takes away value a player paid for:**

- **The price paid can always be recovered,** to the credit or the coin, on the store that paid
  it, at any time. A player who would rather have the money than a branch gets the money.
- **No silent zero.** Until the player acts, the unit fields a full tier-3 branch, never tier 2.
  The first visit to `/brigade` after the migration shows one notice naming each affected unit,
  with `t()` strings.
- **Credits stay inside the earned bound.** A credit refund adds back only what was spent, so the
  balance stays at or below the grants log (`migrateAccount`'s bound, `brigade.ts:149` and on).
  `earned_total` and `grants` do not move: a refund is a spend reversed, not an earning (guard G3).
- **Paid coins** are 0 while `PURCHASES_OPEN` is false (`wallet.ts:25`). If that opens before this
  ships, `paidTiers` already counts which tiers paid coins bought, so the split refund is exact.

**Save slots, local and server.** A slot from before the migration re-migrates on load, through
`parseSlot` and so `migrateAccount`, whether it comes from `lions.saves` or from a member's
server slot (`worker/src/account/slots.ts`, the same `SaveSlot`). That is consistent, because a
slot restores the whole account: the tier, the balance and the marker together. It is also not
an exploit:

- Refund, then load an older slot: the refund's credits leave with the newer account, so nothing
  is gained.
- Switch, then load a slot from before the switch: the player gets the older account back, marker
  included. That undoes the switch exactly as loading a slot undoes any purchase made after it.
  It is not a new respec.
- The wallet is not in a slot (CLAUDE.md:271), so a coin refund cannot be replayed by loading one.
- To confirm in slice 2: the canonical forms `canonicalCampaign` and `canonicalSlot`
  (`economy/src/canonical.ts`) run `migrateAccount`, so they change for any body that holds a
  branched tier 3. Any digest stored before the deploy must be compared only after both sides
  are migrated.

**Members (Accounts A2).** Credits sync as `campaign_state.brigade` through the same pure function.
Coins move only through server routes, so "Return it" on the coin path is a new route, journalled
as a positive `free_delta` row. The A2-8 invariant (`wallet.free = SUM(free_delta)`) holds. It
needs either a new `coin_journal.kind` (`refund`, which means a table rebuild like
`0004_admin.sql`) or a `tier` row carrying `detail.refund: true` (Q4). The wallet row's marker is
written by the server's own `migrateRoar` on read, and persisted by the next `walletWrite`. Only
the server writes that row, so an old client cannot strip it.

**Rejected rules:**

- *Grandfathering* (legacy owners keep the envelope). This is "both owned" forever, and §5's test
  would need a carve-out that makes it unable to fail.
- *Automatic refund plus a free pick.* This pays the price twice, which is free credits.
- *Silent pick-1 with no refund.* This takes paid-for stats with nothing back.
- *A stored legacy price.* It cannot be known, and it can be forged (above).

### 4.3 The merge, and the two stores together

- **A buy of branch `p` is REFUSED when either store already holds the branched tier with the
  other pick** (`buyBranch` for credits, `buyBranchWithCoins` for coins; same-object-back on a
  refusal, like every buy today). Buying the SAME branch in the second store stays legal, as a
  GH-1143 double payment is today.
- **Picks can disagree without a hand-edit.** A legacy Switch taken in one store, while the other
  store also holds a legacy tier 3 (the GH-1143 case, where credits paid again for a tier the
  coins hold), would leave the two stores on different picks. An older build's strip (§4.4) can
  do it too. So:
  - **Switch acts on every store that holds a marker on that (unit, track), in one write**, and
    clears every one of those markers. For a guest, the account and the wallet are written
    together, all or none, as `settleVictory` already writes the ledger, the account and the
    wallet (`roar-earn.ts:51`). For a member, the wallet and the campaign go in one `budgetedOp`
    batch (`worker/src/account/budget.ts:48`), whose revision guards already serialise two writes.
  - **Switch is offered only when every store that holds the branched tier holds a marker.** If
    one store bought its branch fresh (no marker), a Switch would split the picks, so only
    Return is offered. This is this document's proposal; Q11 asks the lead.
  - **Return refunds every store that paid**, each in its own currency, and drops the track to
    tier 2 in each, in the same single write. Whether Return should instead be per store is Q11.
- **`singlePlayerView`:** where both stores hold the branched tier and their picks still disagree
  (a hand-edit, or a strip that the rules above did not repair), the EARNED pick wins. The result
  is still one pick.
- **Versus rooms (this corrects the first draft of this section).** The first draft said a
  brigade room reads `networkView` and so fields only what credits bought. That was wrong. No room
  path calls `networkView`: the room claim is `accountState().ownedTiers` (`main.ts:1437`), the
  single-player view, so a friends' brigade room carries coin-bought tiers, under the ruled D4
  exception (§0). So:
  - **picks go wherever tiers go, from the same view**: the claim sends
    `accountState().ownedPicks` beside `ownedTiers`, inside the same
    `kit === 'matched' ? {} : { ... }` ternary at `connect.ts:344`, and the room mint and the
    world read them under the same `brigade` + `kdf` condition as the tiers (§1.3);
  - so **a coin-bought branch reaches a friends' brigade room**, as a coin-bought tier does today.
    Whether it should is Q10, the lead's; this document does not decide it;
  - **G-V1 grows to cover picks** (§5.2, case 7): a coin-only account holding a coin-bought
    branch sends no `picks` key in a matched create, and a matched room built from a claim with
    picks is the room built from none.
- **`networkView`** gains `ownedPicks` (earned only) for symmetry. It has no production caller,
  so it is not a gate, and this document does not lean on it.
- **No respec in slice 1** beyond the legacy free switch. Whether to sell a paid switch is Q2.

### 4.4 An older build can undo the migration

**What happens.** `migrateAccount` rebuilds a fixed set of fields and drops every other one
(`brigade.ts:143-178`; its own comment says "Unknown fields are dropped"). `migrateRoar` rebuilds
each entitlement as `{ tier, paidTiers }` (`wallet.ts:142`). So any build from before this change
that reads and then writes a store strips `picks`, `legacy` and `branch`. That happens with a tab
left open across a deploy, or with a member's second device on a cached bundle. The account routes
do not gate on the build.

The next new-build read then sees "tier 3, no pick" again. It sets pick 1 and writes a fresh
legacy marker. Two results:

- a player who chose branch 2 is silently moved to branch 1, which takes away what they chose;
- they get a new free Switch, or a full refund of a purchase that was never legacy. That is a free
  respec, and it defeats Q2's "final".

The credit refund stays inside the grants bound, so no credits are created from nothing. But the
choice is no longer final.

**Where a guard exists.**

- **Members' credits (the server's campaign write).** The server holds the stored
  `campaign_state.brigade` and can keep its own state. The rule: where the stored row holds a pick
  at the branched tier and the incoming body holds the same tier with no pick, the stored pick and
  the stored marker state are KEPT. A pick leaves only with its tier (Return, or a reset). A pick
  that CHANGES is accepted only where the stored row held a marker (a Switch). The body's own
  `legacy` is never read. A body with tier 3 and no pick, where the stored row held tier 2 or
  less, is an old build buying the old linear tier 3, which is a genuine legacy purchase, and it
  gets a marker. This also holds the "final" rule on the server.
- **Members' coins.** Only the server writes the wallet row (§4.2), so an old client cannot strip
  it.
- **Guests (`lions.brigade.account` and `lions.roar` on one device).** There is no server to keep
  the truth. With a separate `picks` field, nothing exists that an old build cannot strip, so a
  guest who keeps an old tab open across the deploy can lose their pick and regain a Switch. The
  guards an old build cannot strip are:
  - a key it never reads, inside a map it keeps whole: the reserved key in `upgrades` (§1.2,
    rejected alternatives). `migrateUpgrades` keeps any non-negative integer under any key
    (`brigade.ts:105-116`), and `isTiers` accepts it;
  - a new `localStorage` key that the old build never touches. That one is not in a slot
    snapshot, and it needs its own single reader and writer (CLAUDE.md:271).

  Either costs the compiler check that a separate field buys. This is Q9, the lead's. Until it is
  decided, the exposure is a guest with an old tab open across one deploy, and the loss is a pick
  that a free Switch puts back.

### 4.5 A suspended mission (GH-1393)

A suspended mission is rebuilt from its frozen `StartInputs`, so the picks must be frozen with the
tiers:

- `StartInputs` gains `picks`; `startInputsJson` writes it; `parseStartInputs` requires it, with
  every leaf 1 or 2; `whatMoved` compares it with the live picks (`loadResume`'s `live` gains
  them), and a change reads as `'upgrades'`, the same refusal-and-keep as a tier bought since the
  suspend. That catches a legacy Switch made between suspend and resume. Without it the resume
  would go on and rebuild the type table from live picks.
- **A record without `picks` is REFUSED, and kept**, never resumed with `{}`. A record from before
  this change that holds tier 3 on a branched track would otherwise be rebuilt at tier 2. A
  content change alone is not a refusal (`contentChanged`, `mission-save.ts:294`), so the shape
  check is the only thing that can stop it. Today `parseStartInputs` returning null takes the
  `'failed'` path, which keeps the save and notes the problem (`loadResume`,
  `mission-resume.ts:130-135`). A wording of its own ("this save is from before branched
  upgrades") is slice 2's choice.
- `&kit` never reaches a mission (`bootTiers`, `sandbox-force.ts:189-195`), so it never reaches a
  record.
- Naming: `main.ts:3254` already calls the deploy selection `picks`. The boot code that writes
  `StartInputs` should name the branch map `branchPicks` locally, so the two cannot be swapped.

## 5. The test: both branches can never be owned at once

### 5.1 The invariant

> For every account and wallet REACHABLE through the public operations, from `emptyAccount()` and
> `emptyRoar()` AND from the literal legacy roots of §5.2, the resolved kit of a branched (unit,
> track) is exactly branch 1 or exactly branch 2 (or a tier below the branched one), and NEVER
> the envelope. And at the level of the stores: no operation leaves the two stores holding two
> different picks for one (unit, track) where they held at most one before, and a store's pick
> changes only through the legacy Switch (or leaves with its tier, by Return or a reset).
>
> The public operations are: credit buy, run buy and branch buy; coin tier buy and branch buy; the
> legacy switch and refund; `migrateAccount` and `migrateRoar`; and `singlePlayerView`.

The legacy states cannot be reached from the empty account and the empty wallet: no public
operation writes a tier 3 with no pick. So the first draft's search, which started only from the
empty pair, never fired the Switch or the Return. The roots below fix that.

### 5.2 Where it lives, and its fixtures

The test is `packages/economy/src/branch-exclusive.test.ts`. `economy` owns the buy rules, the
migrations and the merge, and it may import `@lions/data` for `applyUpgrades`.

**The fixtures are literal,** never read through the code under test, because an oracle takes
literals (CLAUDE.md, falsification casebook). There are TWO inline branched units, and both
branch the SAME track name, `firepower`. A picks map keyed by track alone, instead of by (unit,
track), then conflates them, and the search sees it.

- `fx_tank`: weapon 0 at accuracy 0.85 and penetration 1300; firepower tiers `455 {0.03, 104}`,
  then `680 {0.06, 208}`, then `950` branched into `a {0.10, 208}` and `b {0.06, 325}`.
- `fx_ifv`: weapon 0 at accuracy 0.70 and penetration 120; firepower tiers `330 {0.03, 10}`, then
  `495 {0.06, 19}`, then `660` branched into `a {0.10, 19}` and `b {0.06, 30}`.

The expected patched pairs, computed by hand:

| unit | state | accuracy | penetration | expected |
|---|---|---|---|---|
| `fx_tank` | `ONE` (branch a) | 0.95 | 1508 | allowed |
| | `TWO` (branch b) | 0.91 | 1625 | allowed |
| | `T2` (tier 2 only) | 0.91 | 1508 | allowed |
| | `BOTH` (the envelope) | 0.95 | 1625 | must never appear |
| `fx_ifv` | `ONE` | 0.80 | 139 | allowed |
| | `TWO` | 0.76 | 150 | allowed |
| | `T2` | 0.76 | 139 | allowed |
| | `BOTH` | 0.80 | 150 | must never appear |

Accuracy is compared to 1e-9 (the float sum `0.85 + 0.10`); penetration exactly.

**The literal legacy roots** (each a raw store, as an old build wrote it, fed through
`migrateAccount` / `migrateRoar`; written for `fx_tank`, and again for `fx_ifv`):

- **L1, account only:** `{ upgrades: { fx_tank: { firepower: 3 } } }`, no `picks`, no `legacy`.
- **L2, wallet only:** `entitlements.upgrades.fx_tank.firepower = { tier: 3, paidTiers: 0 }`,
  with its `tier` receipt.
- **L3, both:** L1 and L2 together (the GH-1143 case).
- **L4, both, disagreeing:** the account at tier 3 with pick `b` and no marker, and the wallet as
  L2 (a guest strip of the wallet alone, §4.4). After migration the wallet takes pick 1.
- **L5, the hand-edit:** the account with pick `a` and the wallet with `branch: b`, neither
  legacy.

**Cases:**

1. **Exhaustive reachability.** A breadth-first search over the operations above, from the empty
   pair and from L1 to L5, with the balance and coins funded at 5,000 each, to depth 8,
   deduplicating states. The run prints the number of states it visited. At every state, for
   each fixture unit `u`:
   - `applyUpgrades(u, view.ownedTiers[u.id], view.ownedPicks[u.id])` reads `ONE`, `TWO`, `T2` or
     lower, and never `BOTH`;
   - **(s1)** no edge takes a state where the two stores hold at most one distinct pick for
     (`u`, `firepower`) to one where they hold two;
   - **(s2)** along every edge, a store's pick for (`u`, `firepower`) is unchanged, or the edge is
     a Switch, or the pick left with its tier (Return, reset).

   The search also asserts that it reached a `ONE` state and a `TWO` state for EACH unit, that at
   least one Switch fired and at least one Return fired, and that at least one state held both
   units at their branched tier on different picks. So the run cannot pass by reaching nothing
   (the casebook's "empty array, every caller loops" shape).
2. **The single guards, one each, with everything else permitting** (PR 1512's style):
   - credits own `a`; a credit buy of `b` in the SAME store, with the balance to cover it, is
     refused, and returns the same object;
   - credits own `a`; a coin buy of `b` with the coins on hand is refused;
   - the same two, coins first.
3. **The hand-edited conflict.** Root L5 resolves to `ONE`, from the earned pick.
4. **The legacy migration, one store.** Root L1 migrates to pick `a` and
   `legacy.fx_tank.firepower === true` (the marker holds no number), and the view reads `ONE`,
   not `BOTH`.
   - Switch once: it reads `TWO`, the marker is gone, and then a second Switch AND a Return are
     both refused, returning the same object. "One of the two, once."
   - From L1 again, Return: it reads `T2`, the balance is up by exactly 950 (a literal; the price
     is read from the fixture's data, not from the store), and a second Return is refused with the
     balance unchanged. So the balance rises by 950 exactly once.
   - From L2, Return refunds the receipt's literal `CoinSplit`; with the receipt pruned, it
     refunds `coinPrice(950)` as free coins, a literal.
5. **The legacy migration, both stores.** From L3, Switch moves BOTH stores to `b` in one write
   and clears both markers; Return drops both to tier 2 and refunds each store in its own
   currency. From L4 (one store with a fresh pick, one with a marker), Switch is not offered and
   Return is (§4.3; the rule is Q11's to change).
6. **No pick, no stats.** `applyUpgrades(fx_tank, { firepower: 3 }, {})` reads `T2`.
7. **The shipped sweep.** For each of the thirteen branched units in `data/units/kdf`:
   - each pick reads exactly that branch's literal values from §2.1's table, written into the test
     as literals (base plus delta, for example `dozer_d9` branch 2 hp 2760 and front armour 300);
   - the envelope of the two equals the pre-branch tier 3 recorded as literals from today's JSON.
     This is where B6 is checked; B7 then holds it on every `validate:data`.
8. **The server's sticky pick (members, §4.4).** A stored `campaign_state.brigade` at tier 3 with
   pick `b` and no marker, and an incoming body at tier 3 with no `picks` (an old build's strip):
   the merged result keeps pick `b` and has no marker. A body that changes the pick with no stored
   marker is refused. (This one is a Worker test, beside the campaign route's.)

**Outside `economy`:**

- **Case 9, G-V1 for picks** (`packages/app/src/net/coin-claim.test.ts`). The coin-only fixture
  gains a coin-bought branch (`mbt_lavi` firepower, tiers 1 to 3, branch 2).
  - The matched-create case adds `'picks'` to the keys that must be absent.
  - The matched room built from that claim's picks is the room built from none: the same kit
    tables and the same state hash.
  - Positive control, so the check can fail: a brigade create carries the picks, and a brigade
    room built from pick 1 and from pick 2 reads two different Lavi penetrations.
- **Case 10, resume** (`packages/app/src/mission-resume.test.ts`). `parseStartInputs` on a
  literal record with `tiers` and no `picks` returns null; `whatMoved` with only a pick changed
  returns `['upgrades']`.
- **The validators** (`tools/src/branches.test.ts`), against hand-built bad units, each refused
  by `validate:data` with the error naming the rule:
  - three branches;
  - a branch on tier 2;
  - a dominating branch (`{0.10, 325}` against `{0.06, 208}`);
  - a branch below tier 2 on a path;
  - a missing `label` key;
  - **B7:** a branch raised one step above its `BRANCH_CEILING` row, and a branched unit with no
    row at all;
  - **`:412`:** a branch that patches a path the unit does not have.

  The same file spawns `validate_balance.py` (as `e5_staged.test.ts:144-146` does) on a fixture
  roster with one branched unit: `--max-tier` with no `--branch` must exit non-zero, and
  `--branch=1` and `--branch=2` must print different power figures for that unit.

### 5.3 The mutations that must turn it red

Each mutation is a small change to ONE function. Most are one line; M1, M9 and M10 are a few. The
first draft claimed each was one line and that M2 and M3 turned case 1 red; neither claim held, and
both are corrected here.

| | mutation | goes red | why |
|---|---|---|---|
| **M1** | in `applyUpgrades`, resolve a branched tier as the per-path max of both branches | 1, 4, 7 | `BOTH` is reached |
| **M2** | in `buyBranch`, delete the "other store holds the other pick" guard | 2, and 1 by (s1) | without (s1), case 1 SURVIVES M2: the merge still yields one pick (earned wins), so the kit never reads `BOTH` |
| **M3** | in `buyBranchRun`, relax `from !== current + 1` so a held tier 3 can be bought again at the other pick | 2, and 1 by (s2) | without (s2), case 1 SURVIVES M3: it only overwrites one store's single pick |
| **M4** | in `migrateAccount`, leave a legacy tier 3 with no pick (skip the `pick = 1` line) | 4 | it reads `T2`, not `ONE` |
| **M5** | in `applyUpgrades`, treat a missing pick as branch 1 | 6 | this is why the no-pick rule is tested on its own |
| **M6** | in `singlePlayerView`, take `max(earnedPick, coinPick)` | 3 | it reads `TWO` |
| **M7** | in `validate_balance.py`, restore `tier_list[i].get("patch", {})` in `apply_upgrades` | the `validate_balance.py` spawn in `branches.test.ts` | no `--branch` no longer exits non-zero, and both branches print tier 2's figure |
| **M8** | in `validate_data.mjs`, restore `tier.patch ?? {}` at `:412` | the `:412` bad unit | the bad path is never checked |
| **M9** | in the Worker's campaign merge, drop the sticky-pick rule | 8 | the result reads pick `a` with a fresh marker |
| **M10** | in `connect.ts`, move `picks` outside the `kit === 'matched'` ternary | 9 | the matched create carries `picks` |
| **M11** | in `parseStartInputs`, default a missing `picks` to `{}` | 10 | the pre-branch record parses |
| **M12** | key the account's picks by track only, not by (unit, track) | 1 | the second fixture unit's pick follows the first's, and (s2) fails |

The commit that adds each test carries its rows of this table, as CLAUDE.md requires of a new
gate, with each mutation's red run named. Any survivor is disclosed, not hidden.

## 6. The balance gate

### 6.1 The cost curve (`validate_balance.py`): measured for this document

The `apply_upgrades` / `max_tiers` / `total_tier_price` mirror (`validate_balance.py:129-198`)
learns branches in the same way: `--max-tier --branch=1|2`. `total_tier_price` counts the branched
tier's price ONCE, since one branch is ever bought, so a unit's price total does not change.
`--max-tier` on a roster that holds a branched tier with no `--branch` is an error (§1.1), so a
forgotten line cannot fall back to tier 2 silently. CI has TWO max-tier lines today, and both are
doubled, once per branch, for four lines in all:

- `ci.yml:171`, `--units data/units --max-tier --upgrade-cost-factor 0.02`;
- `ci.yml:172`, the same with `--also docs/campaign/special_units/e5 --also
  docs/campaign/special_units/gh709`.

The measurement below is of the first line only. The second, with the staged E5 and GH-709 units
on the curve, was NOT measured for this document. No staged unit is branched, but they refit the
curve, so slice 5 measures that line on both branches and reports it with its conditions.

I measured it without touching the repo. The roster was copied to the scratchpad with each of the
thirteen tier-3 patches replaced by branch 1 everywhere (A), then branch 2 everywhere (B), and the
shipped command was run on each.

**Measurement conditions:**

- `python3 tools/validate_balance.py --units <dir> --max-tier --upgrade-cost-factor 0.02 --report`;
- Python 3.13.18;
- `origin/main` `5147ce2`;
- 47 units on the curve.

| unit | dev at max tier today | all branch 1 | all branch 2 |
|---|---|---|---|
| mbt_lavi | −5.9% | −6.3% | −6.7% |
| ifv_namer | −8.2% | −8.5% | −8.8% |
| apc_eitan | +0.5% | +0.3% | +0.0% |
| sniper_team | −2.6% | −2.0% | −2.7% |
| heli_peten | +1.2% | +1.0% | +0.9% |
| inf_squad | +1.5% | +1.3% | +1.3% |
| jeep_shoded | +0.9% | +0.9% | +2.1% |
| dozer_d9 | −4.3% | −2.6% | −1.0% |
| apc_kipod | −4.0% | −2.5% | −1.3% |
| at_team | −7.3% | −6.9% | −7.2% |
| scout_shachaf | +1.4% | +1.4% | +1.1% |
| mortar_team | −0.8% | −0.1% | −0.6% |
| recon_drone | −2.9% | −1.9% | −2.3% |

The fitted curves were:

| roster | fitted curve |
|---|---|
| today | `300.825 * power^0.483` |
| all branch 1 | `301.218 * power^0.484` |
| all branch 2 | `301.230 * power^0.486` |

The worst unit in every run is the unbranched `heli_yanshuf` (+15.3, +15.0, +15.0). **All 47 pass
±18% in all three runs. The worst branched unit is ifv_namer B at −8.8%.** So prices need no
change to pass the gate (Q1 asks whether they should change anyway).

**This measures the uniform vectors only.** A mixed vector (some units on 1, some on 2) moves the
refit by less than either uniform run here. Even so, CI should run the two uniform lines, and the
document should say that it does not run all 2^13 mixes.

### 6.2 The GDD §5.7 backtest (`pnpm balance`): specified, NOT run here

There is no `node_modules` in this worktree, and the brief asked for no install. Today
`tools/src/balance/cli.ts:27-28` prints a base table and a max-tier table (`unitsAtMaxTier`).
`unitsAtMaxTier` becomes `unitsAtMaxTier(pick)`, built from `maxTiers` plus `maxPicks(u, pick)`,
and the CLI prints **two max-tier tables, "max tier, branch 1" and "max tier, branch 2".** Both
must pass, and the exit code is the AND.

The uniform vectors are not enough on their own, because a branch can move a target that the
envelope passed. `upgrades.md` §4.3 found sight past weapon range to be non-monotone. The gate therefore also
runs, for each target, the full cross product of the branched units that THAT target registers.
By the `addUnitType` calls in `targets.ts` that is at most three:

- `[mbt_lavi, inf_squad, apc_eitan]` at `:899`;
- `[inf_squad, apc_eitan]` at `:640-641`;
- `heli_peten` at `:550`;
- `at_team` and the bare Lavi at `:57-58`.

That is at most 8 runs per target, and well under the 2^13 mixes. The same pick parameter goes to:

- the other `unitsAtMaxTier` readers: `standoff-gate.test.ts`, `doctrine-targets.test.ts`,
  `vehicle-health-probe.ts`, `vehicle_health_bounds.test.ts`, `e5-probes*`;
- the playtest's `tiers: 'max'` pass (`playtest.ts:3171`), run once per uniform vector.

**Expected readings, to be confirmed by the run:**

- **ATGM Pk** cannot move: the `at_team` branch is sensors, and `MBT_BARE` carries no weapons.
- **Air contested by AA** reads at or below today's max tier (1aa = 100%, 3aa = 30%), since
  `heli_peten` firepower only shrinks.
- **The urban force ratio** (`inf_squad` firepower) is the one to watch. At max tier it read 3:1 =
  80% against a floor of 65%. Both branches are below the envelope, so they shift that number, and
  the run decides it.
- If any target fails on either branch, that branch's deltas move and no price moves
  (`upgrades.md:64-65`), the same way `upgrades.md` §4 settled the four exceptions.

`pnpm test:determinism` is unaffected (no sim code changes). `dataDigest` moves with the JSON, as
it does with any unit edit. `pnpm store:threats` regenerates if the threat table reads max-tier
stats.

### 6.3 Risks

- **R1. A nerf at the top.** Every max-tier player is weaker on one group than the old tier 3.
  §4 makes them whole in price, not in stats. Telemetry can count the legacy markers taken,
  switched and refunded.
- **R2. The split star at 8 px may not read.** That is why §3.3 offers two fallbacks.
- **R3. Carrier drift.** §1.3 lists fifteen carriers. A required `picks` parameter and a `picks`
  field in each type catch most of them at compile time. `seatTiersField` cleans by table, and
  `kit-tracks.test.ts` is the guard there. Three readers the compiler cannot see are untyped:
  `validate_balance.py:156` and `validate_data.mjs:412` read a branched tier as `{}` without a
  word, and `validate_data.mjs:118-119` refuses it loudly (§1.1). All three go through one
  tier helper that raises on a shape it does not know, proved by M7 and M8 (§5.3). The
  `/stats` readers of the telemetry `tier` string are untyped too (§1.3).
- **R6. An older build strips the picks.** A tab open across the deploy, or a cached bundle,
  rewrites a store without `picks`, `legacy` and `branch` (§4.4). Members are guarded by the
  server; guests are not, until Q9 is decided.
- **R4. Uniform runs miss a mixed-vector failure.** Mitigated by the per-target cross product
  (§6.2). The cost curve runs only the uniform vectors (§6.1).
- **R5. A coin refund is a server write.** It needs a route, a journal row and an admin-page
  reading. It is the one part of this design that touches production data paths, so it should be
  its own slice behind its own flag.

## 7. Slices (each 1 to 5 days, in order)

1. **Data and `applyUpgrades`:** the schema `oneOf`, B1-B7 (the `BRANCH_CEILING` table empty
   until slice 5), the raising tier helpers in both validators and the Python mirror,
   `applyUpgrades` with required `picks`, `maxPicks`, `branchOf`, §5's case 6 and the validator
   cases, with M1, M5, M7 and M8. No unit is branched yet. Every caller passes `{}`.
2. **Account, wallet and view:** `picks` and `legacy` (a boolean marker), the migration, the
   refund priced from data, `buyBranch` and `buyBranchWithCoins`, Switch and Return across both
   stores, the merge rule, `resetFree` keeping `branch`, mid-mission resume (§4.5) and the
   sandbox `&kit` picks, and §5's cases 1-5 and 10 with M2-M4, M6, M11 and M12.
3. **The Garage and the icon:** the fork rung, "Gives up", the confirm dialog, split pips, and the
   split corner star. A mock capture for the lead (one Metal browser check, on its own port, with
   music off).
4. **Net and worker carriers:** the room claim inside the matched ternary, the room mint and
   `seatKitPicks`, `SeatConfig.picks` (optional on read), `KIT_BRANCHES`, the spend route's and
   the claim's `branch`, the server's sticky-pick campaign merge, and the telemetry patterns with
   their `/stats` readers; §5's cases 8 and 9 with M9 and M10.
5. **Content:** the thirteen JSON edits, the `BRANCH_CEILING` rows, the `en.json` names, and both
   balance gates measured and reported with their conditions: all four cost-curve lines, and the
   two backtest tables.
6. **The legacy coin refund route** for members (behind a flag; Q4).

## 8. Open questions for the lead

- **Q1. Price.** Each branch is a strict subset of today's tier 3 and costs the same 950 (on the
  Lavi). The gate passes as is (§6.1). Keep the price, or rule a branch multiplier (for example
  `m[track][3]` lowered toward the mean of tiers 2 and 3)?
- **Q2. Respec.** Slice 1 sells no switch. Should a paid switch exist (for example at the full
  tier-3 price, with the first branch's price not refunded), or is the choice final?
- **Q3. Scope.** One branched track per unit, and only on the last tier. Is that the shape, or
  should a unit be able to branch two tracks later?
- **Q4. The coin refund journal.** A new `coin_journal.kind = 'refund'` (a table rebuild, like
  `0004_admin.sql`) or a `tier` row with `detail.refund: true`? And does it ship with slice 2, or
  wait for slice 6?
- **Q5. The icon.** The split corner star, (b) a tick under it, or (c) text only? The G-P3 stars
  are final, so any change is yours to make.
- **Q6. World parts.** Should the two branches ever draw different kit parts on kitted vehicles?
  That is new art, so it needs art numbers and any Meshy budget from you first. Until then both
  draw today's tier-3 parts.
- **Q7. The roster.** Thirteen units are proposed for the ten required. Strike any, and rename any
  branch (they are `en.json` keys).
- **Q8. The default pick for legacy owners.** Branch 1 is the first column in §2.1. Is that the
  right default for each unit?
- **Q9. Where the pick is stored.** As a separate `picks` field, which the compiler checks at
  every carrier but which an older build strips (§4.4)? Or as a reserved key inside `upgrades`,
  which survives an older build (`migrateUpgrades` keeps any non-negative integer under any key)
  but which the compiler cannot see, and which `isTiers` would accept as a tier (§1.2)? A third
  option is a new `localStorage` key that no older build touches, which is outside the save
  slots. Members are guarded on the server whichever is chosen; the choice decides whether guests
  are. This document proposes the separate field and does not decide it.
- **Q10. Coin-bought branches in a friends' brigade room.** Under the D4 exception a coin-bought
  TIER reaches a friends' brigade room today (`main.ts:1437`, `connect.ts:344`). Should a
  coin-bought BRANCH reach it the same way, as this document's carrier plan would have it (§4.3)?
  Matched rooms carry neither, and G-V1 grows to prove it for picks.
- **Q11. Both stores holding a legacy tier 3.** Does the player get one Switch that moves both
  stores (this document's proposal, §4.3), and is Return all at once (the proposal) or per store?
  And when one store holds a legacy tier 3 and the other bought the same branch fresh, is Switch
  withheld (the proposal) and does a later buy in the other store void the first store's refund
  (the proposal: it does not)?
