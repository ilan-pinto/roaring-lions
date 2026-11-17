# Branched upgrade tiers: an either/or choice at tier 3 (GH-1384)

**HOLD FOR LEAD.** Design only. Nothing here is built, and no unit JSON, schema, code or
`tuning.ts` line changes with this document. Audit dimension D2, size L. The issue asks for
"a short spec and a mock for the lead before any build"; this is both.

- **Date:** 2026-11-17, against `origin/main` at `5147ce2`.
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
  `m.firepower = 0.50 / 0.75 / 1.05` (`upgrades.md:50-58`). It reproduces all 46 earned-gate
  tracks; "a fit may move a DELTA, never a price: a price moves only by the lead's ruling"
  (`upgrades.md:60-66`).
- **Delta curve:** armour 7 / 15 / 25 % of base on hp and all faces; sensors 8 / 15 / 25 % of base
  optics plus +1 / +2 / +3 sight tiles; firepower +0.03 / +0.06 / +0.10 accuracy plus
  8 / 16 / 25 % of base penetration (`upgrades.md:90-96`). There are four measured exceptions:
  `at_team` firepower accuracy is capped at +0.07 (§4.1); `mbt_lavi` armour is cut to
  2 / 3.5 / 5 % (§4.2); `inf_squad` sight is capped at +1 / +2 / +2 (§4.3); and `heli_peten`
  armour is cut to 5 / 8 / 12 % (§4.4).
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
  `packages/app/src/account-view.ts:22-26`). `networkView` reads `earned` only (`wallet.ts:382`).
  Since GH-1143 a credit run can pay again for a tier the coins already hold, so both stores can
  legitimately hold the same tier.
- **Save slots** (`lions.saves`) snapshot the brigade account but NOT the wallet (CLAUDE.md:271).

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
- **B4. The split rule** (this is what keeps a branch inside the budget). For every path, the
  smaller of the two branch values equals the tier below's value, and the larger is at least
  that. So a branch either keeps a path at the tier below or raises it, and on every path at least
  one of the two branches gives the raise up entirely.
- **B5. No dominance.** Each branch is strictly above the tier below on at least one path, and
  strictly below the other branch on at least one path. A branch that wins or ties everywhere is
  refused.
- **B6.** The per-path MAXIMUM over the two branches (the envelope) is the budget. For the
  thirteen units in §2, the envelope equals today's linear tier 3 to the digit. That is checked
  once, by literals, in the migration's test (§5.3); after that it is not re-derived.

`tierRegressions` (`validate_data.mjs:113`) runs per branch against the tier below, so B4's
"at least" is the existing monotone rule, applied twice.

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

The third parameter is required on purpose. About thirty files name `applyUpgrades` today
(`grep -rl` over `packages` and `tools`, tests included). A default of `{}` would let any of
them silently drop a player's tier 3 on a branched track. A required parameter makes the compiler the audit, which is the
house rule for `api.ts` too ("checked by the compiler rather than a grep").

**Alternatives rejected:**

- *Encode the pick in the tier integer* (3 means branch 1, 4 means branch 2). The `max(earned,
  coins)` merge would then silently pick branch 2. `kitCounts` would count four tiers. And the
  clamp-to-length rule would erase the pick.
- *A reserved key in the same map* (`{ "firepower": 3, "firepower.pick": 2 }`). This rides every
  existing carrier unchanged. But it is a convention the type checker cannot see, and `isTiers`
  (`packages/net/src/config.ts:480`) would accept a pick as a tier. A missed carrier would then
  drop the pick with no error. A separate `picks` field fails to compile instead.
- *Branching across tracks* ("armour III or firepower III"). This needs no new stats, but it takes
  a whole tier from every player who owns both today, and it fits the issue's "two branches at
  one tier" less well.

### 1.3 Every carrier of a tiers map gains a picks sibling

| carrier | today | adds |
|---|---|---|
| `BrigadeAccount` (`economy/src/brigade.ts:35`) | `upgrades` | `picks: Record<unit, Record<track, 1\|2>>` and `legacy` (§4). Both migrate to `{}` when absent, as `coupons` did, so `ACCOUNT_VERSION` does not move |
| `TrackEntitlement` (`economy/src/wallet.ts:36`) | `{ tier, paidTiers }` | `branch?: 1\|2`, `legacy?: true` |
| `singlePlayerView` / `networkView` (`wallet.ts:364-384`) | `ownedTiers` | `ownedPicks` (merge rule in §4.3) |
| `upgradePrepass` (`app/src/upgrade-prepass.ts:45`) | `ownedTiers` | `ownedPicks`, passed to `applyUpgrades` and `kitSummary` |
| `SeatConfig` (`net/src/config.ts:17`, `isTiers` `:480`) | `tiers` | `picks`, bounded as `tiers` is (`TIERS_MAX_TYPES`, `TIERS_MAX_TRACKS`, leaf 1 or 2) |
| room cleaning (`worker/src/match/kit-tracks.ts:11`, `seatTiersField`) | `KIT_TRACKS` | `KIT_BRANCHES` (unit to its branched track), pinned both ways by `kit-tracks.test.ts` |
| coin spend route (`worker/src/account/spend.ts:65`) | `{ item: 'tier', unitId, track, tier }` | `branch` on the branched tier; recorded in `detail`, whose JSON needs no SQL change |
| telemetry `tier` (`data/schemas/telemetry_event.schema.json:156`) | `unit.track.N` | `unit.track.3a` / `.3b`, a pattern change |

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
lead's ruling (`upgrades.md:64-66`; see Q1). Tiers 1 and 2 are untouched.

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
(accuracy +0.06 against +0.07, §4.1's cap) are not used. Their branch would be close to a
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

- The `inf_squad` firepower split leaves its sensors track alone, so §4.3's sight cap is not
  touched.
- `heli_peten` branches firepower, which §4.4 measured clean, and not the armour track that broke
  the AA target.
- `mbt_lavi` branches firepower and not armour. `MBT_BARE` copies the Lavi's HULL into the ATGM Pk
  target (`tools/src/backtest/targets.ts:58`, §4.2), and its `weapons: []` means no firepower
  number can reach that target.
- `at_team` branches sensors: its Spike reaches 13 tiles against a sight of 9, so sight is worth
  something to it, unlike the rifle squad's 8 against 8.
- The two armour vehicles with a team mark and kit parts (`apc_kipod`; the D9 has no mark) keep
  every part. §3.3 explains why parts follow the tier, not the branch.

The names are proposals. Each is an `en.json` key (`garage.branch.<unit>.<id>`), so the lead can
rename any of them without touching a number.

### 2.2 What each branch costs in strength, against today's tier 3

Both branches sit strictly between tier 2 and today's tier 3 on every path. **So branching is a
nerf of the top end, by design**: the old tier 3 was the envelope of the two. A player gives up
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
  least 1. Every gated golden frame boots a fresh account, so no baseline moves.
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
run on every read, on the client and on the server (`campaign_state.brigade`). It is driven by
data: a `BRANCHED` table derived from `@lions/data` (`economy` may import `data`). For each
(unit, track) whose last tier is branched, a store holding that tier with NO pick gets:

1. **`pick = 1`.** Branch 1 is authored as the one closer to the unit's job (the first column in
   §2.1). The track stays at tier 3, so the mission runs with a branch and never with the old
   envelope.
2. **A `legacy` marker** for that (unit, track):
   - in the account: `legacy[u][t] = price`, the tier-3 price it was bought at;
   - in the wallet: `legacy: true` on the `TrackEntitlement`, whose `tier` receipt carries the
     exact `CoinSplit` paid.

While the marker stands, the Garage shows the rung as **"Your Tier 3 became a choice"** and offers
two actions, each once:

- **Switch, free.** Move to the other branch at no cost. This clears the marker.
- **Return it.** The track drops to tier 2 and the store that paid is refunded in full:
  - credits: `balance += legacy price`;
  - coins: the receipt's exact `CoinSplit`, or `coinPrice(price)` as free coins if the receipt was
    pruned past `RECEIPT_CAP`.

  This also clears the marker. The player can then buy either branch fresh at today's price.

The marker has no expiry. Buying anything on that track clears it, and so does `resetAccount` or
`resetFree` (which already discard tiers).

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

**Save slots.** A slot from before the migration re-migrates on load. That is consistent, because
the slot restores the whole account: the tier, the balance and the marker together. It is also not
an exploit:

- Refund, then load an older slot: the refund's credits leave with the newer account, so nothing
  is gained.
- The wallet is not in a slot (CLAUDE.md:271), so a coin refund cannot be replayed by loading one.

**Members (Accounts A2).** Credits sync as `campaign_state.brigade` through the same pure function.
Coins move only through server routes, so "Return it" on the coin path is a new route, journalled
as a positive `free_delta` row. The A2-8 invariant (`wallet.free = SUM(free_delta)`) holds. It
needs either a new `coin_journal.kind` (`refund`, which means a table rebuild like
`0004_admin.sql`) or a `tier` row carrying `detail.refund: true` (Q4).

**Rejected rules:**

- *Grandfathering* (legacy owners keep the envelope). This is "both owned" forever, and §5's test
  would need a carve-out that makes it unable to fail.
- *Automatic refund plus a free pick.* This pays the price twice, which is free credits.
- *Silent pick-1 with no refund.* This takes paid-for stats with nothing back.

### 4.3 The merge, so two stores cannot add up to both

- **A buy of branch `p` is REFUSED when either store already holds the branched tier with the
  other pick** (`buyBranch` for credits, `buyBranchWithCoins` for coins; same-object-back on a
  refusal, like every buy today). Buying the SAME branch in the second store stays legal, as a
  GH-1143 double payment is today.
- **`singlePlayerView`:** where both stores hold the branched tier and their picks disagree (only a
  hand-edit can do that), the EARNED pick wins. The result is still one pick.
- **`networkView`:** earned only, as today. A brigade versus room fields only what credits bought.
- **No respec in slice 1** beyond the legacy free switch. Whether to sell a paid switch is Q2.

## 5. The test: both branches can never be owned at once

### 5.1 The invariant

> For every account and wallet REACHABLE from `emptyAccount()` and `emptyRoar()` through the
> public operations, and for every legacy save, the resolved kit of a branched (unit, track) is
> exactly branch 1 or exactly branch 2 (or a tier below the branched one), and NEVER the envelope.
>
> The public operations are: credit buy, run buy and branch buy; coin tier buy and branch buy; the
> legacy switch and refund; `migrateAccount` and `migrateRoar`; and `singlePlayerView`.

### 5.2 Where it lives, and its fixtures

The test is `packages/economy/src/branch-exclusive.test.ts`. `economy` owns the buy rules, the
migrations and the merge, and it may import `@lions/data` for `applyUpgrades`.

**The fixture is literal,** never read through the code under test, because an oracle takes
literals (CLAUDE.md, falsification casebook). It is an inline unit `fx_tank` with:

- weapon 0 at accuracy 0.85 and penetration 1300;
- firepower tiers `455 {0.03, 104}`, then `680 {0.06, 208}`, then `950` branched into
  `a {0.10, 208}` and `b {0.06, 325}`.

The expected patched pairs, computed by hand:

| state | accuracy | penetration | expected |
|---|---|---|---|
| `ONE` (branch a) | 0.95 | 1508 | allowed |
| `TWO` (branch b) | 0.91 | 1625 | allowed |
| `T2` (tier 2 only) | 0.91 | 1508 | allowed |
| `BOTH` (the envelope) | 0.95 | 1625 | must never appear |

Accuracy is compared to 1e-9 (the float sum `0.85 + 0.10`); penetration exactly.

**Cases:**

1. **Exhaustive reachability.** A breadth-first search over the operations above, with the balance
   and coins funded at 5,000 each, to depth 8, deduplicating states (the state space is under a
   few hundred). At every state, `applyUpgrades(fx_tank, view.tiers, view.picks)` reads `ONE`,
   `TWO`, `T2` or lower, and never `BOTH`. The search also asserts that it visited at least one
   `ONE` state and one `TWO` state, so the run cannot pass by reaching nothing (the casebook's
   "empty array, every caller loops" shape).
2. **The single guards, one each, with everything else permitting** (PR 1512's style):
   - credits own `a`; a credit buy of `b` with the balance to cover it is refused, and returns the
     same object;
   - credits own `a`; a coin buy of `b` with the coins on hand is refused;
   - the same two, coins first.
3. **The hand-edited conflict.** Account `{ picks: a }` with wallet `{ branch: b }` resolves to
   `ONE`, from the earned pick.
4. **The legacy migration.** A literal version-2 save,
   `{ upgrades: { fx_tank: { firepower: 3 } } }` with no `picks`, migrates to `picks a`, a
   `legacy` of 950, and the view reads `ONE`, not `BOTH`. Switching once reads `TWO`, and a second
   switch is refused. Returning it reads `T2` with the balance up by exactly 950.
5. **No pick, no stats.** `applyUpgrades(fx_tank, { firepower: 3 }, {})` reads `T2`.
6. **The shipped sweep.** For each of the thirteen branched units in `data/units/kdf`:
   - each pick reads exactly that branch's literal values from §2.1's table, written into the test
     as literals (base plus delta, for example `dozer_d9` branch 2 hp 2760 and front armour 300);
   - the envelope of the two equals the pre-branch tier 3 recorded as literals from today's JSON.
     This is where B6 is checked.

`tools/src/branches.test.ts` runs B1 to B5 against hand-built bad units:

- three branches;
- a branch on tier 2;
- a dominating branch (`{0.10, 325}` against `{0.06, 208}`);
- a branch below tier 2 on a path;
- a missing `label` key.

Each must be refused by `validate:data`, with the error naming the rule.

### 5.3 The mutations that must turn it red

Each mutation is one line in the implementation, and each turns a named case red:

- **M1.** In `applyUpgrades`, resolve a branched tier as the per-path max of both branches
  (`perTrack[path] = Math.max(perTrack[path] ?? 0, d)` over `tier.branches`). Cases 1, 4 and 6 go
  red (`BOTH` reached).
- **M2.** In `buyBranch`, delete the "other store holds the other pick" guard. Cases 1 and 2 go
  red.
- **M3.** In `buyBranchRun`, relax `from !== current + 1` so a held tier 3 can be bought again at
  the other pick. Cases 1 and 2 go red.
- **M4.** In `migrateAccount`, map a legacy tier 3 to "no pick, apply the old patch" by keeping
  the envelope as a hidden tier. Case 4 goes red.
- **M5.** In `applyUpgrades`, treat a missing pick as branch 1. Case 5 goes red. This is why the
  no-pick rule is tested on its own.
- **M6.** In `singlePlayerView`, take `max(earnedPick, coinPick)`. Case 3 goes red, because it
  reads `TWO`.

The commit that adds the test carries this table, as CLAUDE.md requires of a new gate, with each
mutation's red run named. Any survivor is disclosed, not hidden.

## 6. The balance gate

### 6.1 The cost curve (`validate_balance.py`): measured for this document

The `apply_upgrades` / `max_tiers` / `total_tier_price` mirror (`validate_balance.py:129-198`)
learns branches in the same way: `--max-tier --branch=1|2`. `total_tier_price` counts the branched
tier's price ONCE, since one branch is ever bought, so a unit's price total does not change. CI
runs the max-tier line twice, once per branch (`ci.yml:171-172`, each line doubled).

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

### 6.2 The §5.7 backtest (`pnpm balance`): specified, NOT run here

There is no `node_modules` in this worktree, and the brief asked for no install. Today
`tools/src/balance/cli.ts:27-28` prints a base table and a max-tier table (`unitsAtMaxTier`).
`unitsAtMaxTier` becomes `unitsAtMaxTier(pick)`, built from `maxTiers` plus `maxPicks(u, pick)`,
and the CLI prints **two max-tier tables, "max tier, branch 1" and "max tier, branch 2".** Both
must pass, and the exit code is the AND.

The uniform vectors are not enough on their own, because a branch can move a target that the
envelope passed. §4.3 found sight past weapon range to be non-monotone. The gate therefore also
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
  (`upgrades.md:64-66`), the same way §4 settled the four exceptions.

`pnpm test:determinism` is unaffected (no sim code changes). `dataDigest` moves with the JSON, as
it does with any unit edit. `pnpm store:threats` regenerates if the threat table reads max-tier
stats.

### 6.3 Risks

- **R1. A nerf at the top.** Every max-tier player is weaker on one group than the old tier 3.
  §4 makes them whole in price, not in stats. Telemetry can count the legacy markers taken,
  switched and refunded.
- **R2. The split star at 8 px may not read.** That is why §3.3 offers two fallbacks.
- **R3. Carrier drift.** There are eight carriers (§1.3). A required `picks` parameter and a
  `picks` field in each type catch most of them at compile time. `seatTiersField` cleans by table,
  and `kit-tracks.test.ts` is the guard there.
- **R4. Uniform runs miss a mixed-vector failure.** Mitigated by the per-target cross product
  (§6.2). The cost curve runs only the uniform vectors (§6.1).
- **R5. A coin refund is a server write.** It needs a route, a journal row and an admin-page
  reading. It is the one part of this design that touches production data paths, so it should be
  its own slice behind its own flag.

## 7. Slices (each 1 to 5 days, in order)

1. **Data and `applyUpgrades`:** the schema `oneOf`, B1-B5, `applyUpgrades` with required
   `picks`, `maxPicks`, `branchOf`, the Python mirror, and §5's cases 5 and 6 on fixtures. No unit
   is branched yet. Every caller passes `{}`.
2. **Account, wallet and view:** `picks` and `legacy`, the migration, `buyBranch` and
   `buyBranchWithCoins`, the merge rule, and §5's cases 1-4 with M1-M6.
3. **The Garage and the icon:** the fork rung, "Gives up", the confirm dialog, split pips, and the
   split corner star. A mock capture for the lead (one Metal browser check, on its own port, with
   music off).
4. **Net and worker carriers:** `SeatConfig.picks`, `KIT_BRANCHES`, the spend route's `branch`,
   and the telemetry pattern.
5. **Content:** the thirteen JSON edits, the `en.json` names, and both balance gates measured and
   reported with their conditions.
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
