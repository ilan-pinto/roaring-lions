# The brigade economy — design

**Date:** 2026-09-15 · **Status:** approved by the lead in conversation, section by section;
this document is the record. **Downstream:** `writing-plans` (three plans, §8), then
`balance-analyst` (payout weights, prices, the upgrade tracks), `sim-guard` (the payout
function and the pre-pass), `render-vfx` (the shop and the debrief line), `playtest` (the
ladder assertions).

## 1. The problem

The motivation layer (spec 2026-09-10, shipped in three steps by 2026-09-14) gives a win a
grade, the campaign a star total, and the roster three earned units. What it does not give
the player is a **standing reason to play well and play again**: nothing accrues between
missions that can be spent, no unit ever gets better, and replaying a won mission is worth
nothing but the grade. The lead's ask, 2026-09-15: *"with every win, users can unlock new
units and upgrade existing ones. Lose fewer units, accomplish more tasks, gain more money,
and replay a game. In the future, I would like to sell coins so users can upgrade without the
need to win."*

Two economies already exist and are untouched by this design: the **in-mission** economy
(logistics and intel, GDD §3, `resources` on a mission, `buildBlockedReason` gating
production on `unlock`), and the **earned gates** (`unlock.roe_rating_min`, `after_mission`,
`stars_min`; `unlockReason` in `packages/sim/src/unlock.ts`). This design adds a third layer
between missions: **credits**, earned by performance, spent on unlocks and upgrades, kept in
a **brigade account** that outlives a campaign.

## 2. Decisions taken by the lead (2026-09-15)

| # | decision | consequence |
|---|---|---|
| D1 | Credits buy upgrades **and** can open any unit early, alongside the earned gates; the earned path stays free. The lead will design **special forces that can only be bought** — units whose only gate is a price. | `unlock.price`; three gate shapes: earned only, earned or bought, bought only (§4.4) |
| D2 | Replay pays for **improvement only**: a mission pays in full the first time, then only the difference when a run beats what it has paid for; an equal or worse run pays nothing. | the per-mission paid record in the account (§4.2) |
| D3 | An upgrade attaches to the **unit type**, bought once, applied to every unit of that type fielded afterwards. Per-veteran fittings are a later addition, not this design. | `upgrades` on a unit's JSON; the pre-pass (§4.3) |
| D4 | Credits and everything bought live in a **brigade account** beside the campaign ledger and survive a fresh campaign; stars, Conduct and the roster stay per campaign. | a second store, its own reset (§4.1) |
| D5 | Upgrades take effect through an **app-side pre-pass** that patches unit JSON before the sim registers types; the sim never learns the concept. | no sim-package change but one pure integer function; the golden hash cannot move (§4.3) |
| D6 | The **paid path is designed for, not built**: the account carries provenance so a granted entry has a shape, and no client code can create one. Money waits on the account moving behind a server or a store entitlement. | §4.6 |

**What this supersedes.** The motivation layer's D3 ("stars unlock special units, not stat
perks") and its scope line ("no commendation spending of any kind") were deliberate and are
deliberately reversed here: the lead has chosen a spendable currency and type-wide upgrades.
What it does **not** reverse: Conduct stays a threshold that is never spent, nothing grades
kills, and there are no XP bars, daily rewards or loot. The earned gates keep their meaning
because the earned path is always free and a bought unit is still built with logistics in
the mission.

**A note the lead has heard and decided on.** A purchasable currency in a single-player Steam
RTS is the feature that audience punishes hardest; the commercial plan targets that audience.
The design keeps the paid path out of the client entirely until the account can be trusted
(§4.6), and prices credits so that mastery, not repetition, is what earns them (D2).

## 3. Scope

**In:** the brigade account; the payout and the improvement rule; the price gate and buy-only
units; type-wide upgrade tracks, their schema, their pre-pass and their balance passes; the
brigade screen as the shop; the debrief's payout line; the harness assertions; the docs.

**Out:** the paid path's server, store or entitlement code; the special forces units
themselves (content the lead designs, built through the unit pipeline as the three star units
were); per-veteran fittings; any change to `packages/sim/src/tuning.ts`; any change to the
in-mission economy; Pixi-specific work (the shop is DOM).

## 4. Design

### 4.1 The brigade account

A second persistent store, `lions.brigade.account` in local storage today, read and written
by one pure module, `packages/app/src/brigade-account.ts`, and by nothing else. Versioned
with a `version` field and a migration table from day one, so a later server-side copy
starts from a known shape.

```
{
  version: 1,
  balance: 0,                    // integer credits on hand
  earned_total: 0,               // integer, every earned credit ever, never decremented
  paid: { [missionId]: number }, // what each mission has paid so far (§4.2)
  unlocks: string[],             // unit ids opened by purchase
  upgrades: { [unitId]: { [track]: number } },   // tier reached, 0 = none
  grants: [{ source: 'earned' | 'granted', amount: number, missionId?: string, at: number }]
}
```

`grants` is an append-only log with a **source**. Every entry the client writes is `earned`
and names the mission that paid it. `granted` is the shape a store entitlement would write
(§4.6); nothing in the client constructs it, and a test pins that.

Starting a fresh campaign (`?fresh`, the menu's new-campaign action) wipes the campaign ledger
and **leaves the account alone**. The account has its own explicit reset on the brigade
screen, behind a confirm, because a second campaign starting with the brigade you built is
the point of D4 and an accidental wipe would undo hours.

### 4.2 Credits and the payout

`creditsFor(input: CreditInput)` is a pure integer function beside the grade in
`packages/sim/src/credits.ts` — integer addition only, no division, no RNG, no `Math.*` —
and the only sim-package addition. It reads what the grade and the debrief already read:

| term | provisional weight | source |
|---|---|---|
| the win | 100 | `result === 'victory'`; a defeat pays nothing and writes nothing (motivation D4) |
| each carrying secondary completed | 40 | the same `carries: true` set the third star counts |
| each unit of the STARTING force brought home | 10 | `startingCount - (startingCount - startingHome)`, production neutral (ruling R4: a unit built from logistics mid-mission is mastery practice, not a second payout lever — spec §2) |
| each Conduct point over the two-star floor | 1 | `roe - starRoeFloor(mission)`, floored at 0 |

The weights are provisional and belong to the balance analyst. The **campaign-level target**
is set the way the star gates were, on the measured optimal ladder: an optimal two-star
campaign should afford about half the upgrade catalogue by its end, a three-star campaign most
of it, and no single mission should pay more than a fifth of the cheapest star-gated unit's
price. Exception: `breach_team` ships at 850 -- its own star gate opens at mission 6
(cumulative 1345 credits), so any cap-compliant price would make buying strictly worse than
waiting; measurement and ruling in `docs/campaign/economy/prices.md` §6. The harness asserts
the ladder's cumulative total (§6).

**Improvement only (D2).** At debrief, on a victory, the app computes `v = creditsFor(...)`,
reads `paid[missionId]` (0 if absent), pays `max(0, v - paid)` into `balance` and
`earned_total`, appends an `earned` grant, and sets `paid[missionId] = max(paid, v)`. A
replay that scores lower pays nothing and moves nothing. The debrief prints the line either
way: "+120 credits" or "no improvement over your best, nothing paid". This composes with the
best-of star rule (`betterResult`) without touching it: stars and credits each keep their own
best.

**No ledger key, no payout (ruling R5).** A mission that declares an empty or absent
`ledger.produces` pays nothing on victory -- `beit_sahwan_0_tutorial` is the only one today,
it sits outside `world.json` and therefore outside the pinned ladder, and CLAUDE.md already
says it is not a campaign mission.

### 4.3 Unit upgrades

A unit's JSON may carry an `upgrades` block:

```
"upgrades": {
  "armour":  { "tiers": [ { "price": 300, "patch": { "hull.armor.front": 10, "hull.armor.side": 5 } },
                          { "price": 600, "patch": { "hull.armor.front": 20, "hull.armor.side": 10 } } ] },
  "optics":  { "tiers": [ { "price": 250, "patch": { "sensors.optics": 0.2 } } ] }
}
```

A patch names whitelisted numeric paths and the **delta** each tier adds over base (tiers are
cumulative as written, so tier 2 states the total delta, and the validator requires each
tier's deltas and price to be at least the previous tier's — monotone). The whitelist is
closed and lives in `unit.schema.json`: `hull.hp`, `hull.armor.front|side|rear`,
`hull.suppression_resistance`, `sensors.optics`, `sensors.sight_tiles`, and per weapon
`weapons[i].accuracy` and `weapons[i].penetration`. Nothing else is patchable — not cost, not
speed, not rate of fire, not collateral risk — because the §5.7 targets and the ROE
thresholds were fitted to those.

`applyUpgrades(unit, tiers)` is a pure pre-pass in `packages/app/src/upgrades.ts`: given a
unit's JSON and the account's tier per track, it returns a new JSON with the deltas applied,
never mutating its input. The app calls it for every KDF type **before** `addUnitType`, the
way `resolveUpgrades` rewrites a mission before the runtime exists. The playtest harness and
the balance backtest call the same function, so the sim registers a patched type and never
sees a tier.

**Balance passes.** `pnpm balance` and `tools/validate_balance.py` run twice: at base, as
today, and at every track's maximum tier. The §5.7 targets must hold in both, and the
cost-curve band is checked at maximum tier against the unit's logistics cost plus the track's
total price scaled by a factor the balance analyst sets. A track that breaks either is content
to retune, never a gate to widen. Which tracks each of the seventeen KDF types gets, and their
prices, is the balance analyst's brief; the envelope is two to three tracks of two to three
tiers per unit, and the star-gated units take tracks like any other.

### 4.4 Unlocks by price

`unlock` gains `price` (integer credits). `unlockReason(gate, ledger, account)` opens a unit
when its earned conditions pass **or** `account.unlocks` lists it; a locked unit that has BOTH
an earned gate and a price keeps its earned sentence alone (the row's own Buy control, §4.5,
carries the price, so the rendered sentence never appends "or buy for N credits" — shipped as
`gateSentence`, `packages/app/src/gate-sentence.ts`). A unit with only a `price` is
**bought only** — the special forces shape — and its sentence is the price alone. The one
predicate serves every surface that already calls it: the production dock's lock label, the
brigade screen, `resolveUpgrades` (a bought unit is an open gate for an `upgrades_to` site),
and the harness. `price` beside `from_ledger` on a placement stays impossible for the same
reason `upgrades_to` is.

Buying is one step in the account module: refuse if the balance is short, else deduct and
append the id. No refunds. A bought unit is still built with logistics inside a mission; the
price opens it, it does not field it.

### 4.5 The surfaces

- **The brigade screen** (`ui/brigade.ts`) becomes the shop. The header gains the balance
  beside the star total. A locked row keeps its earned sentence and, when it has a price,
  shows a Buy control with the price, disabled when the balance is short; a bought-only row
  shows the price alone. An available row shows its tracks as tier pips with the next tier's
  price and a Buy control per track. The account's reset lives here, behind a confirm.
- **The debrief** (`ui/debrief.ts`) gains the payout line (§4.2).
- **The dock** already prints the gate sentence and picks up the "or buy" clause for free.
- Colour: the existing `--commend` token for credits and their controls; every other colour a
  semantic token. `pnpm validate:ui` applies.

### 4.6 The paid path, designed for and not built

No client code can write a `granted` entry, no UI mentions coins, and no price is shown in
any currency but credits. When the Steam phase arrives, the account moves behind a server or
a store entitlement check that writes granted entries; the client's account shape does not
change. Until then the account is as editable as the ledger is today, which is fine for a
single-player save and not for money — so the paid path is gated on that move, not on any
code here. The one rule the design already enforces for it: **the earned path can open
everything except bought-only units**, so a paid grant is a shortcut, never the only door.

## 5. What the player sees

First win: the debrief shows the grade, then "+160 credits". The brigade screen shows a
balance, two locked units with an "or buy for 900" clause, and pips on the rifle squad's
armour track. A replay of the same mission that brings everyone home shows "+30 credits" —
the improvement — and a replay that does worse shows "no improvement over your best, nothing
paid". A fresh campaign starts with the same balance and every tier bought; the star gates are
closed again and the roster is empty, as today.

## 6. Testing

- Pure and tested: `creditsFor`, the improvement rule, every account migration,
  `applyUpgrades` (input never mutated, deltas exact, unknown path refused), the predicate in
  `unlockReason` with and without an account.
- Schema and `validate_data.mjs`: a patch outside the whitelist, a non-monotone track, a
  non-integer price, `price` beside `from_ledger` (moot as stated — `price` is authored on
  the unit's own `unlock` block, `from_ledger` on a mission's *placement*, so the two can
  never appear "beside" each other; the check that matters is `unlock.price` on a non-`kdf`
  unit, which `validate_data.mjs` does enforce), `upgrades` on an enemy unit — each refused
  with a sentence, each falsified once.
- `pnpm playtest`: sums the optimal ladder's credits the way it sums stars and asserts the
  campaign total against the balance target; runs each mission once more with every track at
  maximum tier and requires the same result and stars.
- `pnpm balance` and `validate_balance.py` at base and at maximum tier.
- UI tests: the shop's disabled states, the bought-only row, the debrief line in both forms,
  the reset confirm; the account never touched by `?fresh`.
- The golden determinism hash cannot move: no sim file but `credits.ts` changes, and that
  file is never called by the sim.

## 7. Open items, recorded

- The balance target's exact fraction ("about half the catalogue at two stars") and every
  price are the balance analyst's numbers; the harness pins whatever they fit.
- The special forces units (D1) are content the lead designs; the unit pipeline and the
  `price`-only gate are ready for them the day they exist.
- A per-veteran fitting layer (rejected for now under D3) would attach to the named roster
  entry and die with it; nothing here blocks it later.

## 8. Sequencing for the plans

Three steps, each its own plan and its own branch, in the order the motivation layer used:

1. **Earn** — the account module and its reset; `creditsFor`; the improvement rule; the
   debrief line; the harness's cumulative assertion; the docs — landed 2026-09-15,
   ladder total 5544 (re-pinned same day from 5644 once "brought home" was scoped to
   the starting force only, ruling R4).
2. **Buy** — `unlock.price`; bought-only units; `unlockReason` with the account; the shop's
   locked rows; the dock sentence; the harness's bought-gate probe — landed 2026-09-16,
   prices in docs/campaign/economy/prices.md.
3. **Upgrade** — the `upgrades` schema and whitelist; `applyUpgrades`; the balance passes;
   the tracks and prices for the seventeen types; the tier pips; the maximum-tier harness
   run.
