# GH-1102: store-bought special units in versus brigade rooms (design)

**2026-11-07** · status: design for the lead's approval, nothing built · base `origin/main` `4cdac8fdc` ·
issue GH-1102 (the lead's report: "my special unit was not present in the game", a bot game on
`wadi_tarfan_l`, rooms 487VTK and LRA4R7) · the lead's ruling of 7 Nov on that issue: **store-bought
special units come into ALL versus brigade rooms**, after a balance design · related: the network spec
(`2026-10-10-network-game-design.md`, decisions 5 and 22, the 11 Oct and 16 Oct rulings), the coin wallet
spec (`2026-11-04-roar-coin-wallet-design.md` §6, D4 of 11 Oct), the store/garage spec (PR 1094,
`2026-11-07-store-garage-benefits-design.md`), the accounts spec (PR 1101,
`2026-11-07-accounts-profiles-design.md`), the special-units spec (`2026-10-22-special-units-design.md`),
and `docs/campaign/economy/production-numbers.md` §6 (the medic team's fairness check, the precedent).

**No sim change.** The sim sees unit types and placements, through `addUnitType` and the placement path
every versus force already uses. "Bought", "owned", "special" and "reserve" are app, net and Worker
words; none reaches `packages/sim/`. Upgrade tiers still reach the sim only through `applyUpgrades` in
`upgradePrepass`, before `addUnitType`.

## 0. What reading the code found

1. **A brigade room carries upgrade tiers and nothing else.** The client sends
   `tiers: accountState().ownedTiers` (`packages/app/src/main.ts:1317`) in the create and join bodies
   only (`packages/app/src/net/connect.ts:320-327`). The Worker stores `claims[seat]`
   (`packages/worker/src/match/match-room.ts:786, 831`) and mints each seat as
   `{ kit, tiers, unlocks: [] }` (`match-room.ts:485`): `unlocks` is hard-coded to `[]`. The world reads
   tiers only (`seatKitTiers`, `packages/app/src/net/match-world.ts:353-376`), and only for a KDF seat on
   `kit: 'brigade'`.
2. **Two gates keep a bought unit out, both deliberate.** What a seat can build is its faction's doctrine
   menu ("No `unlock` -- the doctrine menu IS the gate (P-7)", `versusUnitInfo`, `match-world.ts:195-215`).
   Account ownership is never consulted. Separately, `VERSUS_HELD_UNITS`
   (`packages/app/src/net/versus-roster.ts:46`) keeps six store specials out of the registered roster:
   `at_nlos_team`, `demo_tzav`, `mbt_lavi_camo`, `spg_cluster`, `spg_long_range` and `ugv_recon_dog`
   (plus `veh_ambulance` and `air_medevac_heli`, held by the 3 Nov rescue ruling, and three that are not
   store units: `heli_yanshuf`, `drone_swarm`, `aa_remetz`). The header gives the reason: registering a
   type a versus side can never field moves the roster-count and hash pins for nothing.
3. **There are twelve store specials, and they sit in three places today.** "Special" here is
   `isBoughtOnly(gate)` (`packages/sim/src/unlock.ts:21`, a price and no earned field), which is also what
   the Stores' `specialForces` flag reads:

   | where it is today | units |
   |---|---|
   | on the KDF doctrine menu, for every seat | `inf_medic_squad` (ruled on, 3 Nov) |
   | registered in every room, on no menu | `heli_peten_gunship`, `inf_grenadier`, `recon_zikit` |
   | held out of the roster (`VERSUS_HELD_UNITS`) | `mbt_lavi_camo`, `demo_tzav`, `ugv_recon_dog`, `spg_long_range`, `spg_cluster`, `at_nlos_team`, `veh_ambulance`, `air_medevac_heli` |

4. **The bot's seat gets the room's kit and empty tiers.** A create sets `claims[1] = seatTiersField(null)`
   (`match-room.ts:786`), and a bot's join body has no `tiers` (`match-room.ts:831`).
5. **"Decision 22" is the trust posture for the tier claim**: friends only, structural checks, no server
   ledger (`connect.ts:322`, `worker/src/match/kit-tracks.ts:6`, `room-fields.ts:68`). It is not a ruling
   about units. The 11 Oct ruling (network spec, decision 5 row) already says "bring your brigade" brings
   "anything the player owns, earned or bought", and the 16 Oct note says "`unlocks` stays `[]` until N3's
   production can field one". This design is that follow-up.
6. **Two kinds of room have no production at all.** `economyRoom` (`packages/net/src/config.ts:234`) is
   true only for KDF v Sarim with no win mode. A mirror room (KDF v KDF, all seven `VERSUS_FAIR_MAPS`) and
   every win-mode room play a placed force and nothing else. So a camp-menu answer cannot reach most rooms.
7. **The placed forces are equal value.** `VERSUS_KDF` is 6,664 logistics at today's prices. `VERSUS_SARIM`
   is 6,501 (its header's 6,736 predates a re-price). The economy purses are 1,500 and 2,400, the 1.6x
   rule of G3 Q7 (`data/schemas/doctrine.schema.json`, `tools/validate_doctrine.mjs`).
8. **The type list's order is content.** `versusRoster()` is `units` order minus the held ids. Deleting an
   id from `VERSUS_HELD_UNITS` inserts it at its `units` position, and that shifts the index of every
   later type and moves every versus pin. Side 1's kit copies are APPENDED for exactly this reason
   (`match-world.ts:117-126`). The design below appends its new types the same way.

---

## 1. How a bought unit enters a match

### 1.1 The three options

| option | what it is | reaches | verdict |
|---|---|---|---|
| A. A camp-menu tile | the seat's own specials join its camp menu at their versus price; same purse | economy rooms only (3 maps, faction matchups, no win mode) | **rejected as the mechanism.** Mirror and win-mode rooms have no camp, so it breaks "all rooms". It also repeats the medic's lesson (production-numbers §6): the 1,500 opening purse is spent at tick 0 and the serial line builds the special last, so it arrives at about 90 s and late |
| B. A capped starting slot | one extra placement per seat for a bought unit; the have-not gets compensation | every room | **rejected.** A slot is not a quantity of value: `ugv_recon_dog` is 190, `mbt_lavi_camo` 960. Equivalence needs a per-unit compensation table, which is option C with extra steps |
| C. A points budget | both seats get the same budget and spend it before the match | every room | **recommended**, as "the reserve" (§1.2) |

### 1.2 The reserve (recommended)

- **Every seat in a brigade room has a reserve**: a budget `R` of logistics, the same for both seats of a
  faction, spent in the lobby before Ready on at most `K` units. A pick is either one of the seat's own
  open specials (§5) or a unit from its faction's doctrine menu. The picks spawn **at tick 0, with the
  placed force**, on fixed reserve slots behind it. They are ordinary units from then on.
- **Provisional numbers:** `R` = 1,000 for both factions, about 15% of the placed force. It covers the
  dearest open special (`mbt_lavi_camo`, 960). `K` = 4. Unspent budget does not carry over: not into a
  purse, not into another pick. All of these are data, fitted in phase 2 (§8).
- **The standard reserve** is the default fill for a seat that picks nothing, a bot, and a Sarim seat
  whose player does not open the picker:
  - KDF: `inf_squad`, `at_team`, `mortar_team`, `recon_drone` (947). Every one is already in `VERSUS_KDF`,
    so the default fill adds no type to the world.
  - Sarim: `atgm_cell`, `atgm_cell`, `gun_truck`, `recoilless_team` (999).
- **Always on in a brigade room** (decision 2). Every brigade room has a reserve, whether or not anyone
  brings a special. That is one rule to explain, the same for a bot game and a friend game. A matched room
  has no reserve and builds today's bytes.
- **Price:** a pick costs its `cost.logistics` from its own JSON, the one number the room already reads
  (`versusUnitInfo`, `unitCost`). A separate versus price is introduced only if a fit fails and the lead
  will not move the campaign price (decision 4, §2.3).
- **Where it lives:** a `reserve` block in each doctrine (`data/doctrines/*.json`,
  `doctrine.schema.json`):

  ```json
  "reserve": {
    "budget": 1000,
    "max_picks": 4,
    "status": "provisional",
    "default": ["inf_squad", "at_team", "mortar_team", "recon_drone"],
    "special": ["mbt_lavi_camo", "demo_tzav", "inf_grenadier", "recon_zikit", "ugv_recon_dog", "heli_peten_gunship"],
    "slots": [[-4, -3], [-4, 3], [-5, -1], [-5, 1]]
  }
  ```

  `special` is the open list (§5); Sarim's is `[]`. `slots` are offsets in the force's own frame, as
  `VERSUS_KDF`'s are (dx toward the enemy, dy along the line), and the hostile end mirrors them the same
  way. Doctrines are already in the content digest (`net/content-digest.ts`), so two clients on different
  reserve data desync on the first hash tick, as for any other content.

**Why C, in one line each:** it works in all four kinds of room through one code path (`versusSpawns`
plus an append); the fairness question is one number per faction plus one price per unit; the unit is on
the ground at tick 0, so it is never "bought and late"; and a forged claim gains choice, never value
(§4.4).

---

## 2. Fairness

### 2.1 The equivalent budget

A player without a special gets exactly what a player with one gets: `R`, spent on standard units. The
opponent of a special-holder is never short-handed; they hold the same budget in different units. The bot
gets the same (§3). A Sarim seat, which has no store, gets the Sarim reserve.

`R_sarim` starts equal to `R_kdf`, because the reserve spawns at tick 0 like the placed forces, and the
placed forces are already equal value. The 1.6x purse rule is about what each faction builds over a match,
not about what stands at tick 0. The control arm R1 (§2.2) decides, with the budget sweep knob. The
alternative is 1.6x (decision 3).

### 2.2 The probe arms (`pnpm versus:probe`, `tools/src/backtest/versus-probe.ts`)

The bar is the existing one: the leader's share at most 60% (`FAIR_MAX_PERCENT`), at **96 seeds** on
**offered cells only**, 192 where a reading sits within 3 points of the line (sim-and-orders.md, "Which
`pnpm versus:probe` invocation is the bar"). The offered cells are: the mirror on the seven
`VERSUS_FAIR_MAPS`; KDF v Sarim on `FACTION_MATCHUP_MAPS` (Tel Marum, Wadi Tarfan, Wadi Tarfan L) as a
placed force, as `--economy`, and as `--tunnels` cell 3; and the win modes on the maps each is offered on
(`winModeAllowed`). Each is read in both spawn orders.

New flags, every one an in-memory override, never written to disk (the `withOverrides` pattern):

| arm | flag | what both seats field | required reading |
|---|---|---|---|
| R0 | `--reserve=off` (default) | no reserve, today's room | **byte-identical to main, game for game.** A self-check (exit 2), not a bar |
| R1 | `--reserve=default` | the standard reserve, both seats | inside 60/40 in every offered cell. It is the reserve's own control: it asks whether `R` alone skews a map |
| R2 | `--reserve=<special>` | the special's END: the special plus the default list in order while it fits; the other end: the standard reserve | inside 60/40 in every offered cell, with the special at the friendly end and at the hostile end. The bar is symmetric, so it catches a special that is too strong AND one that is overpriced |
| R3 | `--reserve=<special> --reserve-both` | the same special at both ends | report only: does one special in both hands amplify a spawn bias |
| sweep | `--reserve-price=<special>=<n>` | R2 at price `n` | report: the price band inside which every cell passes |
| sweep | `--reserve-budget=<kdf>/<sarim>` | R1 at those budgets | report: the R1 band |
| tiers | `--reserve-tier=max` | R2 with the special at its max tier (if PR 1094's D1 gives it tracks) | report only. Tiers are the brigade room's accepted asymmetry |

**Each special needs a plan that uses it**, or the arm measures nothing. This is the medic's lesson: PR
907's arm "delivered 0.0 medics a game" and read fair. The probe's plan is a blob that attack-moves, so
the reserve units get role plans:

- `blob` (direct fire: `mbt_lavi_camo`, `demo_tzav`, `inf_grenadier`, `heli_peten_gunship`, `recon_zikit`):
  as today;
- `scout` (unarmed spotters: `ugv_recon_dog`): keeps 6 tiles ahead of its side's armed centroid;
- `standoff` (indirect, phase 4 only: `spg_long_range`): holds at the seat's anchor and is ordered on the
  nearest identified enemy inside its range and outside its minimum.

**Witness columns.** Every R2 cell prints, per game, the special's `spawned / fired / hits / kills`, as
the rescue arm prints `med/adm/rej`. A cell where the special fired in fewer than half the games prints
**NOT MEASURED**, never "inside". A NOT MEASURED cell does not open a unit. For the unarmed dog, the witness is
`spawned / marked` (enemies it marked with `mark_target`), and in tunnels cells the routes it identified;
NOT MEASURED applies to `marked` the same way.

**The tunnels cells matter for two specials.** `recon_zikit` and `ugv_recon_dog` both carry
`mark_tunnel`. Tunnels cell 3 ("the KDF answer") is where they move a reading, so both are read there
with the KDF answer plan using their marks.

### 2.3 What the fit can change, and in which order

1. The unit's place on the open list (§5): a special that cannot pass at any price in the sweep stays held.
2. `R`, `K` and the default lists, from R1.
3. A price. The twelve specials already sit inside the cost curve's ±18% band (special-units spec §3), so
   `validate_balance.py` passes today. A versus fit that wants a different price either moves the unit's
   `cost.logistics` (which moves the campaign dock price, and must still pass `validate_balance.py`, both
   CI invocations, and `pnpm playtest`), or adds a `reserve.prices` override in the doctrine
   (decision 4). An override must also sit inside the ±18% band, which `validate:data` checks.

`pnpm balance` (the §5.7 backtest) is blind to versus. It runs as a guard only if a JSON price moves.

### 2.4 The cost of reading it

Per special: 18 map cells (7 mirror, and 3 each of faction placed, economy and tunnels cell 3, plus 2
win-mode maps), times 2 spawn orders, times 96 seeds, is 3,456 games. Wave 1 (six specials) plus R1 is
about 24,000 games. These are CPU-heavy reads: they run on CI or a cloud session, never on the lead's
machine.

---

## 3. The bot's seat

**Yes, a mirror budget.** The bot holds the same `R` as its faction and fields the standard reserve. It
owns nothing, so it has no special to pick. The Worker mints the default for any seat that sent no picks,
so `pnpm bot` and the arena need no change to get it.

A bot that wants to pick (an arena preset, a model) sends the same lobby message a browser does (§4.2),
from the same eligible list minus specials. A bot seat's picks of a special are dropped: a bot has no
account to own one. The alternative, a strict mirror where the bot fields a copy of the human's reserve
(KDF v KDF only), is fair by construction but makes the special not special (decision 6).

The lobby states what the bot fields (§7). That also answers the diagnosis's point that "each of you" was
wrong in a bot game.

---

## 4. Trust and the claim

### 4.1 Posture: friends only (decision 22, unchanged)

The reserve is offered only where `kit: 'brigade'` is, and `brigade` is never offered outside a friends'
room (network spec §7.1, the 16 Oct note). The Worker checks shape and arithmetic. It cannot check
ownership until a server holds the account.

**Which ownership counts.** The picker offers what `accountState()` owns, which is the single-player view
(`singlePlayerView`: earned or coin-bought). That is the same view the tier claim already uses in a
brigade room: the coin wallet spec's ruled exception (D4, 11 Oct), "a friends' room on 'bring your
brigade' sends `ownedTiers` incl. coin tiers", and the 11 Oct "anything the player owns, earned or
bought". Matched rooms stay as G-V1 pins them: no unit key in the body, no reserve. Paid coins are
revisited at ST7 with the tiers (wallet spec, decision 8).

### 4.2 The claim field

- **Client to room: a lobby message**, `{ t: 'reserve'; picks: string[] }`, a new `ClientMsg` in
  `packages/net/src/protocol.ts` (`parseClientMsg` admits it with `picks` an array of at most
  `RESERVE_MAX_PICKS` strings). A seat may send it any number of times **until it sends Ready**. After
  Ready the room ignores it. The create and join bodies do not change: the picker belongs on the room
  screen, where both seats can see the map, the factions and each other.
- **Room to clients:** `SeatState` gains `reserve: string[]` (the cleaned picks, or the default when the
  seat has picked nothing), so both seats see both reserves before Ready. That is fairness by sight: a
  friend sees what the other side brings. It also makes a forged claim visible (§4.4).
- **The config:** `SeatConfig` gains `reserve?: string[]`. **Absent means no reserve**, so a matched
  room's config is byte-identical to today's, and every old config, replay file (`feedback/replay.ts`) and
  snapshot builds as it did. `validateConfig` admits the field with the same bounds as the message.
  `unlocks` stays `[]`: it is in the wire format, and nothing reads it.

### 4.3 The Worker's mint step

`packages/worker/src/match/reserve-table.ts` is a plain table, as `kit-tracks.ts` is, so the Worker does
not bundle unit data: per faction `{ budget, maxPicks, default, eligible: { id: price } }`.
`reserve-table.test.ts` pins it to `@lions/data`'s doctrines and unit costs in both directions.

`seatReserveField(picks, faction, kit)` in `room-fields.ts`:

1. Not `brigade`, or not an array: nothing. The room records no reserve.
2. Walk at most `maxPicks` entries. An entry that is not a string, not an own key of `eligible[faction]`
   (so `__proto__`, an unknown id, a held id, the other faction's id and a special on a Sarim seat all
   fail), is dropped.
3. Keep a running sum. **The first pick that would pass `budget` ends the list** (the prefix rule): it and
   everything after it are dropped. It never skips ahead to a cheaper pick, so the cleaned list is a
   prefix of what the player saw and arranged.
4. Output is bounded by construction: at most `maxPicks` ids, each from the table.

`mintConfig` (`match-room.ts:467-497`) then writes, per seat, in a brigade room only:
`reserve = cleaned.length > 0 ? cleaned : table[faction].default`. A bot seat (`kind: 'bot'`) has its
specials removed first. Behind `RESERVE_OPEN` (§8, phase 1) the Worker mints no reserve at all.

**The world cleans again.** `seatReserve(seat)` in `match-world.ts` repeats rules 1 to 4 against
`@lions/data`, as `seatKitTiers` repeats the tier clamp. A config read back from a replay or edited by hand
cannot field an over-budget reserve. Both machines run the same clean over the same data, so this cannot
desync.

### 4.4 A forged claim

Before any server account, a forged claim is an edited `lions.brigade.account` or `lions.roar` that
"owns" a special the player never bought, or a hand-sent `reserve` message. What happens:

- A malformed, over-budget, over-count, held, unknown or wrong-faction pick is **cleaned** (§4.3). Nothing
  is refused, and the room starts.
- A well-formed pick of an open special the player does not own is **accepted**. It is shown to the other
  seat in the lobby before Ready, by name.
- **It is bounded by `R`.** A forger fields what an honest owner of that special fields, inside the same
  budget. Forging buys choice, not value, and choice is exactly what the price fit makes fair. This is
  the property that makes the reserve safe under decision 22, and the reason option B, an unbudgeted slot,
  is not.

### 4.5 With accounts (PR 1101)

The accounts spec makes coins, coin entitlements included, server-authoritative once a player signs in
(§2.3 there). Credits, credit unlocks and tiers stay trusted (its decision L5) "until a stranger's room
reads them (GH-687)". It also attaches a seat to a member through the session cookie at create and join,
never through the body (§5.1 there). The reserve slots into that, in this order:

1. **Until A2 ships:** §4.3 and §4.4 as written. Friends only.
2. **After A2 and A3:** in a room where a seat is a member, the mint step looks up that member's
   `wallet.entitlements.units`. A special that is coin-bought is then **verified**. A special the server
   does not hold is still trusted, because a credit unlock lives in the trusted brigade account (L5). The
   lobby can mark a verified pick, which is a nicety and not a gate.
3. **Before any non-friends room offers a reserve** (public matchmaking, GH-687): every special pick must be
   server-held, coin or credit. That needs L5's alternative, server-validated credits. An unverifiable
   pick is then replaced by the default, never refused. Until then `brigade` stays friends only, which is
   today's rule.

Nothing in this design writes to the accounts database, and nothing moves coins or credits. Versus still
pays 0.

---

## 5. Which specials open, and which stay held

The open list is `reserve.special` in `kdf.json`. A unit opens only after its R2 arm passes (§2.2).

| unit | logistics | recommendation | why |
|---|---|---|---|
| `mbt_lavi_camo` | 960 | **wave 1** | the Lavi's hull and gun with a lower signature (0.55 against 1.0), and slower. The cleanest pair the probe can read, against the default reserve |
| `demo_tzav` | 680 | **wave 1** | an armoured engineer with `demolish` and `smoke`, both admitted in versus (`validateCommand`). It already has tracks in `KIT_TRACKS` |
| `inf_grenadier` | 320 | **wave 1** | direct-fire infantry. Already registered in every room, so it adds no type |
| `recon_zikit` | 290 | **wave 1** | marks targets and tunnels. Already registered. Read in tunnels cell 3 |
| `ugv_recon_dog` | 190 | **wave 1** | an unarmed spotter at population 0, with the `scout` plan. Read in tunnels cell 3 |
| `heli_peten_gunship` | 450 | **wave 1** | `heli_peten` is already on the menu and in the force, so the air fold is already on in every room. Already registered |
| `spg_long_range` | 400 | **wave 2** (phase 4) | a 28-tile howitzer, minimum 6, that sees 7. It needs the `standoff` plan before any reading means anything. On Wadi Tarfan the seats are (10,10) and (37,37), 38 tiles apart, so from its slot it reaches most of the way to the other spawn |
| `spg_cluster` | 400 | **stays held** | its campaign price is Conduct: collateral 0.95, against civilians and ROE. A versus room has neither, so the cost that balances it does not exist there. Its 12 bomblets a shell fall on the attack-move blob and on `VERSUS_SARIM`'s line of 13 foot ATGM teams, which the probe plan cannot disperse. It reopens only with a versus-only cost |
| `at_nlos_team` | 265 | **stays held** | an indirect ATGM: 24 tiles, penetration 1,000, damage 450, at 265. Its price was fitted in a campaign with no armoured enemy, so it has never met armour. In a mirror it is the one KDF weapon that kills a Lavi from beyond the Lavi's 12-tile sight, with no line of sight and no counter-battery in the sim. Top attack is unmodelled (special-units spec §1.4, D4: "versus only"). It reopens after a top-attack and APS ruling |
| `veh_ambulance`, `air_medevac_heli` | 540, 330 | **stay held** | the 3 Nov rescue ruling held both, and that stands. With on-demand registration (§6.1) the "pins move for nothing" reason goes away, but the rescue fairness check is a separate reading (production-numbers §6). They reopen with their own rescue arm |
| `inf_medic_squad` | 295 | unchanged | on the KDF menu for every seat since 3 Nov, so it is a standard pick for anyone |

So a player who owns `spg_cluster` sees it in the picker, greyed, with the line "stays out of versus for
now" (§7). The issue asked for exactly that honesty.

Earned units that are on no menu (`sniper_team`, `apc_kipod`, `breach_team`, `scout_shachaf`,
`attack_drone`, `demo_squad`) are not store specials and are out of scope. The reserve could take them
later as data.

---

## 6. Sim impact, and the pins

### 6.1 What changes, and where

| layer | change |
|---|---|
| `packages/sim/` | **nothing.** No column, no fold, no tuning |
| `packages/app/src/net/versus-roster.ts` | `versusRoster()` is unchanged. A new `reserveTypes(config)`: the distinct reserve ids of both seats that `versusRoster()` lacks, in shipped `units` order. The header comment for `VERSUS_HELD_UNITS` changes from "held until a versus design gives it a seat" to "never in the base roster, registered on demand when a reserve picks it" |
| `packages/app/src/net/match-world.ts` | after side 1's kit copies and before `addFormationType`: register `reserveTypes(config)` through each side's prepass (side 0 first, then a side-1 copy where the kit differs, the existing `sameTrackTiers` rule). `seatKitTiers` walks `versusRoster()` plus those types. After `versusSpawns`: the friendly end's reserve, then the hostile end's, on `reserve.slots` through `placeOnOpen`, each side through its own type map. The runtime is built after that, as now |
| `packages/app/src/net/versus-force.ts` | the mesh plan (`versusUnitTypes`, read at `main.ts:2323`) also takes the config's reserve ids. Without that a pick draws as a proxy box beside a `console.error`, and the CI route walk fails on the console error |
| `packages/app/src/net/outcome.ts` | nothing if the price stays the JSON price. With an override, `unitCost` reads it for a reserve unit, so the cap tiebreak and the points race value it at what it cost |
| `packages/net` | `SeatConfig.reserve?`, `validateConfig`, the `reserve` client message, `SeatState.reserve` |
| `packages/worker` | `reserve-table.ts`, `seatReserveField`, the lobby message, the mint, `RESERVE_OPEN` |
| `data/doctrines/*.json`, `doctrine.schema.json`, `tools/validate_doctrine.mjs` | the `reserve` block and its cross-file rules (§8, T16) |

Why it is safe for determinism: every input is in the config, and both machines derive the same type
list, the same order and the same placements from it. Entity ids of the placed force do not move, because
the reserve spawns after both forces. Per-entity RNG streams key on entity id (invariant 3), so the base
force's streams are where they were. The world gets more units, as a larger force always gives it.

Formations need no new rule: a reserve unit joins a group like any unit. Formations are open per map in
versus (`VERSUS_FORMATIONS_OPEN`, `formations_closed_in`), and the R1 control is read with the room's
shipped formation rule. The win modes need none either. The capture-the-flag set-up phase (GH-976, PR
1090 and PR 1091) acts on whatever stands at tick 0.

### 6.2 Pins that do not move

The determinism golden hash and every `packages/sim/` pin (`ECONOMY_PIN`, `RUNTIME_DIGEST_PIN`,
`WOUNDED_WORLD_PIN`, `FORMATION_WORLD_PIN`, `APS_STOCK_WORLD_PIN`, and the rest). `MATCHED_TYPES`, the
matched-room `PINS` and `VERSUS_ECONOMY_PINS` in `match-world.test.ts`, `per-seat-types.test.ts`'s
`2458018554`, the versus-force and versus-breach mirror hashes, the probe's table witness (R0 is
byte-identical), the snapshot format pin, `LADDER_CREDITS` and `ROSTER_MAX`. A matched room registers and
spawns what it does today.

### 6.3 Pins that move, each in its own commit with "Was <n>."

- **`match-world.test.ts`'s brigade describe.** "kit 'brigade' with empty tiers on both seats: the same
  pins" stops being true, because a brigade room now always has a reserve. It is split in two:
  - a brigade config with `reserve` ABSENT (an old config) still reads the matched pins: the back-compat
    witness;
  - a brigade config with the two default reserves gets new literal pins, `RESERVE_DEFAULT_PINS`, on
    `beit_sahwan_outskirts` and `tel_marum`.
- **New `RESERVE_SPECIAL_PINS`:** one per wave-1 special, seat 0 carrying it, on `tel_marum`.
- **The content digest's value** moves with the doctrine edit (any data change does). `snapshot-rejoin.test.ts`
  folds `shippedContentDigest()` into its mirror digest, so its premise seed may need re-picking, as it did
  for GH-560. Re-pick it; do not loosen it.
- **`versus-roster.test.ts`** gains the open-list rules (T15).

---

## 7. UI and lobby copy

Every string goes through `t()`, resolved at draw time and never at module load. Unit names are JSON
`name` values, which are data, as in the Garage. The CSS uses semantic tokens and `.rl-good`/`.rl-bad`
only.

### 7.1 Phase 0: now, before anything else ships

The lead asked for this "until it ships". It is the diagnosis's recommendation, `en.json` only:

| key | text |
|---|---|
| `versus.lobby.kit.hint` (on) | "Friends only: each of you fields the upgrades you bought. Special units from the Stores stay out of versus for now." |
| `versus.lobby.kit.hint.bot` (new, on, the other seat a bot) | "Your upgrades only: the bot fields the standard kit. Special units from the Stores stay out of versus for now." |
| `versus.room.kit.value` (brigade) | "Brigade upgrades (friends only)" |

`versus.ts` picks the bot variant when the other seat's `kind` is `bot`. `ui/versus.test.ts` pins the
exact strings.

### 7.2 Phase 3: the reserve

On the room screen, under the kit line, in a brigade room only:

| key | en text |
|---|---|
| `versus.reserve.title` | "Reserve" |
| `versus.reserve.budget` | "{spent} of {budget} spent" |
| `versus.reserve.hint` | "Each side has the same reserve. Spend it on your special units or on standard ones. It joins your force at the start." |
| `versus.reserve.special` | "Your special units" |
| `versus.reserve.standard` | "Standard units" |
| `versus.reserve.add` | "Add {name}, {price}" (the tile's accessible name) |
| `versus.reserve.remove` | "Remove {name}" |
| `versus.reserve.default` | "Use the standard reserve" |
| `versus.reserve.defaultNote` | "Pick nothing and you field the standard reserve." |
| `versus.reserve.full` | "{max, plural, one {One unit at most} other {# units at most}}" |
| `versus.reserve.over` | "Not enough reserve left" |
| `versus.reserve.leftover` | "{n} unspent: it does not carry over" |
| `versus.reserve.held` | "Stays out of versus for now" (on an owned special that is not open) |
| `versus.reserve.opponent` | "{callsign} brings: {list}" |
| `versus.reserve.bot` | "The bot fields the standard reserve" |
| `versus.reserve.locked` | "Ready locks your reserve" |
| `versus.lobby.kit.hint` (on, replaces 7.1) | "Friends only: each of you brings your upgrades and a reserve of {budget} for special units." |
| `versus.room.kit.value` (brigade, replaces 7.1) | "Brigades: upgrades and a reserve (friends only)" |

Rules for the picker:

- It lists the seat's owned specials that are on the open list, then the faction menu. Every number is
  read from the doctrine (`budget`, `max_picks`) and from unit JSON (the price), never written into copy.
- An owned special that is not open is shown greyed with `versus.reserve.held`.
- A Sarim seat sees the standard list only.
- The picker sends `reserve` on every change, and draws the room's echo (`SeatState.reserve`), so what the
  seat sees is what the room cleaned.
- It mounts inside the room screen's stage and registers no `window` listener: the disposer contract holds
  as is.
- The Stores' block F line (PR 1094 §1.2) gains a third case for an open special: "In a brigade room's
  versus reserve", `stores.adds.versusReserve`.

---

## 8. Phases and tests

### 8.1 Phases

| phase | what | size |
|---|---|---|
| P0 | the copy in §7.1 | 0.25 agent-day |
| P1 | data (`reserve` blocks, schema, `validate_doctrine.mjs`); `@lions/net` fields and message; the Worker table, clean, message and mint behind `RESERVE_OPEN = false`; the world (`reserveTypes`, registration, spawn, `seatReserve`, mesh plan); the pins of §6.3. No UI | 2.5 agent-days |
| P2 | the probe arms and witness columns (§2.2); R0, R1 and R2 for wave 1 on CI or a cloud session; the readings in a new section 7 of `production-numbers.md`; the fitted `R`, defaults, open list and any price, all as data | 2 to 3 agent-days, plus machine time |
| P3 | the picker and the lobby copy (§7.2); `RESERVE_OPEN = true`, with the open list exactly the wave-1 units whose R2 passed | 1.5 agent-days |
| P4 | wave 2: the `standoff` plan, `spg_long_range`'s R2, its slot in `reserve.special` if it passes | 1 agent-day |
| later | §4.5 step 2 with accounts A2 and A3; step 3 before GH-687 | with PR 1101's phases |

P1 can merge before P2 because `RESERVE_OPEN` keeps live brigade rooms unchanged. The flag follows the
`VERSUS_FORMATIONS_OPEN` precedent, a constant the gate's PR flips.

### 8.2 Tests: each with the input that makes it fail

Every new check arrives with its falsification run and recorded in the commit message (CLAUDE.md). The
oracles are literals, never values read from the code under test.

| # | test (file) | asserts | input that makes it fail |
|---|---|---|---|
| T1 | `match-world.test.ts` `seatReserve` prefix | picks `[ugv_recon_dog, mbt_lavi_camo, inf_squad]`, budget 1,000, clean to the literal `[ugv_recon_dog]` (190 + 960 passes the budget, so the list ends there) | `continue` for `break` at the overflow: it keeps `inf_squad` (482) |
| T2 | same, eligibility | `spg_cluster`, `__proto__`, `nope`, `sarim_rifles` on a KDF seat, `mbt_lavi_camo` on a Sarim seat: each dropped | remove the faction check: the Sarim seat keeps the camo Lavi |
| T3 | `room-fields.test.ts` `seatReserveField` | the same cases as T1 and T2, plus 9 valid picks clean to at most 4, and a matched kit gives nothing | drop the `maxPicks` bound: 9 picks in, 9 out (with a budget large enough to hold them) |
| T4 | `reserve-table.test.ts` | the Worker table equals the doctrines and unit costs, both ways | change `mbt_lavi_camo`'s `cost.logistics` to 961 in a fixture copy of the data |
| T5 | `match-room.test.ts` mint | matched room: no `reserve` key in either seat's config; brigade, picks `[]`: the default literal; a bot seat that sent `[mbt_lavi_camo]`: the default; a Sarim seat: the Sarim default | mint the claim into a matched room: the matched config gains a key |
| T6 | `match-room.test.ts` flag | `RESERVE_OPEN` false: a brigade room mints no reserve | ignore the flag |
| T7 | `match-room.test.ts` lobby | a `reserve` before Ready replaces the picks and is echoed in `SeatState`; one after Ready changes nothing | accept it after Ready |
| T8 | `match-world.test.ts` matched bytes (existing) | `MATCHED_TYPES`, `PINS`, `VERSUS_ECONOMY_PINS` unchanged | register the open held specials unconditionally: `MATCHED_TYPES` goes red |
| T9 | `match-world.test.ts` append | a brigade config, seat 0 picking `mbt_lavi_camo`: type count `MATCHED_TYPES + 1`; every base id's index equals the matched world's, by literal comparison; side 0 has one living `mbt_lavi_camo`; side 1's reserve entities are the literal default list, in order | insert the type at its `units` position (delete it from `VERSUS_HELD_UNITS`): base indices shift |
| T10 | `per-seat-types.test.ts` two machines | two worlds from one config hash equal after 200 ticks; the same config with two picks swapped hashes differently, so the equality can fail | drive the slot order from a `Set` iteration of the picks instead of the list |
| T11 | `match-world.test.ts` back-compat | a brigade config with no `reserve` key builds the matched pins | treat an absent reserve as the default |
| T12 | `match-world.test.ts` tiers on an appended type | seat 0 claims `demo_tzav` armour 2 and picks it: its hp is the tier-2 literal; the same pick with no claim: the base literal | walk `versusRoster()` alone in `seatKitTiers`: the tier is lost |
| T13 | `versus-force.test.ts` mesh plan | the plan for a config holds its picks | read `versusUnitTypes(factions)` alone |
| T14 | `match-world.test.ts` world clean | a validated config whose reserve is over budget spawns the cleaned prefix | trust the config: it spawns the whole list |
| T15 | `versus-roster.test.ts` | every id in `reserve.special` is `isBoughtOnly`, and is either in `versusRoster()` or in `VERSUS_HELD_UNITS`; none of the literal stay-held four (`spg_cluster`, `at_nlos_team`, `veh_ambulance`, `air_medevac_heli`) is in it | add `spg_cluster` to `kdf.json`'s `reserve.special` |
| T16 | `validate:data` (`validate_doctrine.mjs`) | `default` sums to at most `budget` and holds at most `max_picks` menu ids of its own faction; `special` is KDF-only; every `slots` entry is distinct; any `prices` override is inside the ±18% band | a default that sums to 1,001 |
| T17 | `versus-probe.test.ts` self-check | R0 equals the base probe game for game; an R2 cell whose special spawned 0 exits 2 | skip the reserve spawn in the probe's world |
| T18 | same, witness | an R2 cell where the special fired in under half the games prints NOT MEASURED | give the special a hold-fire stance: the cell must not read "inside" |
| T19 | `coin-claim.test.ts` (extends G-V1) | a matched room drops a `reserve` message; a coin-only account's open special is offered by the picker and minted in a brigade room (the D4 exception, as for tiers) | build the picker from `networkView`: the coin special vanishes |
| T20 | `ui/versus.test.ts` picker | the budget line reads the doctrine (a fixture budget of 1,200 shows 1,200); every visible picker string is bracketed under `?pseudo=1`; the disposer leaves the stage empty; an owned stay-held special shows the held line | write "1,000" into the copy, or one literal English string |
| T21 | `ui/versus.test.ts` P0 copy | the exact strings of §7.1; the bot variant when the other seat is a bot | drop the `kind` check: a bot room shows "each of you" |
| T22 | `room-capacity.test.ts` | two full reserves fit a 256 room on every map at the default capacity | a `max_picks` of 200 in a fixture |
| T23 | `pnpm test:determinism` | the golden hash does not move | any edit under `packages/sim/` that moves state |
| T24 | `outcome.test.ts`, only if an override ships | a reserve unit's `unitCost` is the override literal | read `cost.logistics` when an override exists |

---

## 9. Out of scope

A camp-menu tile for specials in economy rooms (option A; it can be added later as data, after the
reserve's readings). Earned units that are on no menu. Upgrade tracks for the specials (PR 1094's D1; if
it lands, `KIT_TRACKS` grows by its own test and the `--reserve-tier=max` arm reads it). Sarim specials
(Sarim has no store). Any server verification before PR 1101's A2. Public or ranked rooms (GH-687).
Versus pay, which stays 0.

---

## 10. Decisions for the lead

Each gives the recommendation first.

1. **The mechanism: the reserve.** Both seats in every brigade room hold the same budget, spent in the
   lobby on their own specials or standard units, and spawned at tick 0 with the placed force.
   *Alternatives:* a camp-menu tile (economy rooms only, so it fails "all rooms"); a capped slot plus a
   compensation table.
2. **Always on in a brigade room.** Every brigade room has a reserve, with the standard reserve as the
   default. *Alternative:* only when a seat brings a special. That keeps today's bytes for tier-only
   brigade rooms, but the picker then works only some of the time.
3. **`R` = 1,000 for both factions, `K` = 4, unspent budget lost, all provisional until R1 reads.**
   *Alternative:* Sarim at 1.6x, the purse rule.
4. **One price: the unit's own `cost.logistics`.** A doctrine `reserve.prices` override only if a fit fails
   and the campaign price must stay. *Alternative:* a versus price table from the start.
5. **The open list.** Wave 1 is `mbt_lavi_camo`, `demo_tzav`, `inf_grenadier`, `recon_zikit`,
   `ugv_recon_dog` and `heli_peten_gunship`, each only once its R2 arm passes. Wave 2 is `spg_long_range`,
   with the `standoff` plan. `spg_cluster`, `at_nlos_team`, `veh_ambulance` and `air_medevac_heli` stay
   held. *Alternative:* offer all twelve and let the probe close the failures.
6. **The bot gets the same budget and the standard reserve.** *Alternative:* a strict mirror of the human's
   reserve in KDF v KDF rooms.
7. **Trust: friends only, structural cleaning, both reserves shown in the lobby before Ready, and coin-bought
   specials travel as coin tiers already do (D4, 11 Oct).** Verification follows PR 1101's A2 and is
   required before any non-friends room. *Alternative:* earned-only specials (`networkView`) in versus.
8. **Ship the phase 0 copy now**, whatever is decided above.
