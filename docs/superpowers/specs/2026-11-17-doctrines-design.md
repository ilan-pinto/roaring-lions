# Doctrines: three per side, one picked before a match (GH-1383) -- design for the lead

**Date:** 2026-11-17 · **Status: approved as a design by the lead, 19 Nov 2026.** Docs only: no code, no data, no
schema, no sim change, no `tuning.ts` change. Every number in §3 is a proposal for the lead, computed with the shipped
cost curve and nothing else.
**Issue:** GH-1383, "Doctrines: three per side, one picked before a match" (audit dimension D2, now 42, target 80).
**Done means (from the issue, in full):**
- a design approved by the lead: three doctrines per playable side, each a different unit menu, cap and one signature
  call, as data; *(the design half is met: approved by the lead, 19 Nov 2026; the data lands with the slices
  in §7)*
- the lobby, the skirmish setup and free play ask for one doctrine before the match; the choice is a `Command`-safe part
  of the room config and folds into the match digest;
- no doctrine is a superset of another (a data check that fails on a constructed superset);
- in tester session 3, testers can say what they gave up by choosing.

**Constraints (from the issue and the brief):** design first; content is JSON validated against a schema, with no doctrine
logic in TypeScript; nothing new in `packages/sim`, so the four invariants hold by construction and `pnpm
test:determinism` cannot move; fairness BETWEEN doctrines is parked until the lead rules (the issue carries no fairness
criterion), so §3's gate is a cost-curve gate, not a win-rate claim.

**What I read to write this** (`dev` at `e049ba7a0`): GH-1383 (no comments yet); PRs 947 and 978 (body and files);
`data/doctrines/*.json`, `data/schemas/doctrine.schema.json`, `tools/validate_doctrine.mjs`; `data/units/**`;
`packages/data/src/upgrades.ts`, `overlays.ts`, `versus.ts`, `index.ts`; `packages/app/src/upgrade-prepass.ts`,
`main.ts` (the registration loop and the dock), `packages/app/src/net/match-world.ts`, `versus-roster.ts`,
`versus-formations.ts`, `frame-step.ts`, `content-digest.ts`, `replay-file.ts`, `offline-match.ts`, `room-economy.ts`,
`outcome.ts`, `computer/economy-view.ts`; `packages/net/src/config.ts`, `digest.ts`, `protocol.ts`;
`packages/worker/src/match/match-room.ts`, `kit-tracks.ts`, `store-specials.ts`; `tools/validate_balance.py`;
`docs/campaign/economy/upgrades.md` and `production-numbers.md`; the GH-1394 overlay design. **Run:** only
`python3 tools/validate_balance.py --units data/units --report` (read-only) and a scratch script, reproduced in Appendix
A, that imports that file's own scoring functions. Nothing was built.

---

## 0. The one-paragraph answer

A doctrine is a small JSON file, `data/doctrines/picks/<id>.json`, that **extends** its faction's existing skirmish file
(`data/doctrines/kdf.json` or `sarim.json`, unchanged) with a **closed list of four operations**: take units off the camp
menu, put units on it, set the population cap, and set a unit's price. It names **one signature formation** (a
doctrine-gated formation file, composed only from the formation grammar that already exists). A pure function in
`@lions/data` resolves it, and the app runs it **in the same pre-pass as `applyUpgrades`, before `addUnitType`**, doctrine
first and kit second. The sim receives unit JSON exactly as it does today and nothing else: v1's operations touch only the
menu, the cap and `cost.logistics`, and the sim reads none of the three. The pick travels as an optional
`SeatConfig.doctrine`, validated against a twin id table in `@lions/net`, minted by the room, carried by replays inside the
config they already store, and folded into the match digest only when a seat has one, so **every room without a doctrine
(its sim, its runtime and its network hash) and every replay ever recorded is byte for byte what it was**. v1 offers doctrines in **KDF-v-Sarim economy rooms only**
(the only rooms with a menu, a purse and a cap), on the three faction maps. The first set is six trade-offs, each with a
net cost-curve value within half a percent of its faction's base menu.

---

## 1. What exists

### 1.1 What PRs 947 and 978 built

Neither PR touched doctrines. What they built is the **measurement discipline and the data levers of a versus room**
that a doctrine will be judged against, and one finding a doctrine design has to plan for.

- **PR 947 (GH-945, merged 2 Nov): Wadi Tarfan levelled with data alone.** Seats moved to the map's own markers,
  `VERSUS_SEATS.wadi_tarfan` `(10,10)/(37,37)` (`packages/app/src/net/versus-seats.ts:139`, and the validator's copy,
  `tools/validate_versus_rules.mjs:45`); every tunnel route at capacity 3 (`data/versus/wadi_tarfan.json:10-15`); Wadi
  taken out of the closed-formation list. Method: 100 seat pairs screened at 192 seeds, the finalists re-read on fresh seeds
  (the best screen pick regressed 7 points: selection bias is real), the final S4 on a third range nobody had picked on.
  Every pin that moved did so in its own commit with "Was <n>." (`VERSUS_ECONOMY_PINS`, the `room-capacity` tick-0 hashes,
  the `versus-probe` witness, the `two-client` tunnel count); the determinism golden hash did not move. Falsified by
  putting the map back in the list (4 tests red).
- **PR 978 (GH-913, merged 3 Nov): formations on the big maps.** The same S4 on fresh seeds 30000-30383 opened
  `rujm_sawda` and `milh_flats_l` and kept `wadi_tarfan_l` closed on one trip of 21 cells. Falsified three ways (5, 7 and 8
  tests red).
- **Since then** (today's tree): `VERSUS_FORMATIONS_CLOSED_MAPS` is empty (`versus-formations.ts:26`, the lead's ruling of
  7 Nov), and a rules file can close a room KIND instead: `data/versus/tel_marum.json:4` closes Tel Marum's economy rooms
  (`formations_closed_in`, read through `formationsOpenIn`, `versus-formations.ts:81`).
- **The finding that binds this design.** PR 947 measured that a formation **amplifies a base lean 2.5 to 5 times**. A
  doctrine changes force composition on purpose, so it will move S4 cells; and its signature formation (§2.5) needs its own
  S4 run before it opens in a room. Both are measurement work for the lead's parked fairness ruling, not for this design.

### 1.2 The "doctrine" that already exists

N3 shipped a one-per-faction skirmish file under the same name:

- `data/doctrines/kdf.json` and `sarim.json`: `menu` (12 KDF ids, 6 Sarim ids, dock order), `pop_cap` (40 and 56) and
  `budget.logistics_start` (1500 and 2400, status `provisional`). Schema `data/schemas/doctrine.schema.json` (its `pop_cap`
  description still says "not set in any shipped doctrine yet", which is stale).
- `tools/validate_doctrine.mjs`: a doctrine's id IS its faction, exactly one per faction, a Sarim menu holds only
  opposition units (sarim, rif, ashwar), no menu holds `loiter_drone` (LD3), and Sarim's purse is 8/5 of the KDF's (G3 Q7).
  It is run by `tools/validate_data.mjs:267`, through `validateDir`, which accepts `skipDirs` (`:166`).
- `@lions/data` exports `doctrines`, keyed by faction (`packages/data/src/index.ts:376-381`, type `DoctrineJson`,
  `versus.ts:89-97`).
- **Its readers, all by `doctrines[faction]`:** `packages/app/src/net/match-world.ts:314` (the economy runtime's menus,
  caps and purses), `room-economy.ts:63` (the dock), `outcome.ts:261` (`productionFor`, whether a side can still field
  armed production), `computer/economy-view.ts:64,67,100` (the AI harness's view), `tools/src/net/snapshot-witness.ts:197`.
  `main.ts:4790` takes the dock menu through `roomDockMenu`.

So GH-1383's "doctrine" is a **variant of this file**, and §2 keeps the file as the base every variant extends.

### 1.3 The pre-pass the doctrine joins

- `applyUpgrades(unit, tiers)` (`packages/data/src/upgrades.ts:213-264`): pure, returns a new unit, cumulative deltas over
  base on a closed path whitelist (`UPGRADE_PATHS`, `:43-50`), tracks summed in sorted order so float addition cannot
  depend on key order.
- `upgradePrepass(roster, ownedTiers)` (`packages/app/src/upgrade-prepass.ts:45-66`): the ONE loop whose output is the
  registered types, the HUD card's kit and the renderer's kit tiers, so they cannot disagree.
- Single-player registers through it at `main.ts:2384-2388` (`sim.addUnitType(localizedUnit(registered))`).
- A versus room registers in `buildMatchWorld` (`match-world.ts:92`): each SIDE's kit comes from the config alone
  (`seatKitTiers`, `:441-465`); side 0 registers the roster, side 1 appends a copy only of a KDF type whose kit differs
  (`copyForSide1`, `:145-155`), so no earlier type index moves.
- `versusUnitInfo(menus)` (`:274-291`) prices a menu item from the RAW catalogue (`versusRoster()`), not from the registered
  copy: "cost is not patchable" today. The sim reads only `cost.population` from a unit's cost (`packages/sim/src/sim.ts:1052`);
  price and build time reach the runtime through `MissionContext.unitInfo` (`packages/sim/src/mission.ts:437`).

### 1.4 The overlay pre-pass (GH-1394 / GH-1395)

`applyOverlays(mission, choice)` (`packages/data/src/overlays.ts:201`) is the mission-level twin: a closed op set
(`OverlayOp`), the posture first and the amendments after, and **no ops returns the mission itself by reference**. It acts
on mission JSON, never on a unit, and no versus room has a posture. §2.3 fixes how the two compose.

### 1.5 The versus config path

- `SeatConfig` (`packages/net/src/config.ts:8-26`): `seat`, `side`, `faction`, `kit`, `tiers`, `unlocks`, `player`,
  `callsign`, `kind`. `validateConfig` (`:503-519`) checks every field structurally; `isTiers` (`:480`) bounds a claim and
  refuses `__proto__`, `constructor` and `prototype` keys.
- The Worker mints the config (`packages/worker/src/match/match-room.ts:492-534`, `mintConfig`), cleaning each seat's claims
  against plain twin tables that a test pins to `@lions/data` both ways: `KIT_TRACKS` (`kit-tracks.ts:11`) and
  `STORE_SPECIALS` (`store-specials.ts:13`). "The Worker imports net and not data" is why the twins exist.
- `economyRoom(config)` (`config.ts:317-320`): a versus room whose seats field DIFFERENT factions, with no win mode. LD1 puts
  the KDF seat on side 0 and the Sarim seat on side 1 (`sidesOfFactions`, `:304`). `FACTION_MATCHUP_MAPS` (`:382`) is
  `tel_marum`, `wadi_tarfan`, `wadi_tarfan_l`.
- **The match digest** is `matchDigest(sim.hash(), runtimeDigest, dataDigest)` (`packages/net/src/digest.ts:11`), where the
  data digest is the client's OWN content (`content-digest.ts:62-72`, today units, structures, maps, doctrines, versus
  rules, versus modes and formations), so two clients on different data desync at the first hash tick.
- **Replays** store the whole config in the header (`packages/app/src/net/replay-file.ts:46`) and re-validate it on read
  (`:116`); a file from another build is refused before anything else is read.

### 1.6 Constraints found on the way

1. **Only economy rooms have a menu, a purse and a cap.** Mirror rooms (KDF v KDF) play placed forces; win-mode rooms are
   goals-only with production off. So a doctrine means something in a KDF-v-Sarim economy room and nowhere else today.
2. **In an economy room each faction is fielded by exactly one side.** That is why the runtime's single `typeIdOf` lookup
   (`mission.ts:419`, "side 0's (Q7) ... exact for both", `match-world.ts:316-317`) is correct, and why a doctrine needs no
   per-side copy there (§2.4). In a mirror room it would (the kit machinery already does it), and the runtime would then
   need a by-side lookup, which is a sim change. That is the second reason for "economy rooms only".
3. **The computer opponent is mirror-only** (`offline-match.ts:75-80`: "Economy pairings wait for a computer that builds").
   The issue's "skirmish setup" therefore has nothing to pick for until GH-1388's follow-up lands (§2.7).
4. **Fire support acts for side 0 and is dropped in every versus room** (CLAUDE.md, Production). A doctrine "call" built on
   fire support is a sim change; a call built on a formation is not (§2.5, Q4).
5. **The name is taken twice already.** The GDD's three enemy "doctrines" (Sarim, Rif, Ashwar, GDD §2) and N3's faction
   file both say "doctrine". Q1.

---

## 2. The data shape

### 2.1 Files

- `data/doctrines/kdf.json` and `data/doctrines/sarim.json` stay **byte for byte** as they are: they are the BASE, and
  every rule `validate_doctrine.mjs` holds today keeps holding without an exception.
- Each pickable doctrine is `data/doctrines/picks/<id>.json`, against a new `data/schemas/doctrine_pick.schema.json`.
  `validate_data.mjs` validates `data/doctrines` with `skipDirs: ['picks']` and `data/doctrines/picks` with the new schema.
  (A flat `data/doctrines/<id>.json` with a `oneOf` schema is the alternative; it makes the base validator branch. Q1.)
- `@lions/data` exports `doctrinePicks` (keyed by id, in a fixed id order) beside `doctrines`; `index.test.ts` pins the
  record to the directory, as it pins `formations` and `vfxEmitters`.

### 2.2 The schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://roaringlions.dev/schemas/doctrine_pick.schema.json",
  "title": "Doctrine pick",
  "description": "One doctrine a seat picks before a match (GH-1383): its faction's base doctrine (data/doctrines/<faction>.json) and a closed list of operations on it. Applied by @lions/data's resolveDoctrine/applyDoctrine before addUnitType; the sim never sees this file.",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "extends", "label", "blurb", "gives_up", "signature", "ops", "status"],
  "properties": {
    "id": { "type": "string", "pattern": "^(kdf|sarim)_[a-z0-9_]+$" },
    "extends": { "enum": ["kdf", "sarim"], "description": "The base doctrine's id, which is its faction. The id's prefix must match (validator)." },
    "label": { "$ref": "#/$defs/key" },
    "blurb": { "$ref": "#/$defs/key" },
    "gives_up": { "$ref": "#/$defs/key", "description": "The one line that says what this doctrine gives up (the issue's tester criterion)." },
    "signature": {
      "type": "object", "additionalProperties": false, "required": ["formation"],
      "properties": { "formation": { "type": "string", "pattern": "^[a-z0-9_]+$" } }
    },
    "status": { "enum": ["proposed", "probed", "ruled"], "description": "No balance claim beyond the cost-curve gate while it reads proposed." },
    "ops": { "type": "array", "minItems": 2, "maxItems": 24, "items": { "$ref": "#/$defs/op" } }
  },
  "$defs": {
    "key": { "type": "string", "pattern": "^doctrine\\.[a-z0-9_]+\\.[a-z_]+$" },
    "unitId": { "type": "string", "pattern": "^[a-z0-9_]+$" },
    "op": {
      "oneOf": [
        { "type": "object", "additionalProperties": false, "required": ["op", "units"],
          "properties": { "op": { "const": "menu_remove" }, "units": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "$ref": "#/$defs/unitId" } } } },
        { "type": "object", "additionalProperties": false, "required": ["op", "units"],
          "properties": { "op": { "const": "menu_add" }, "units": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "$ref": "#/$defs/unitId" } } } },
        { "type": "object", "additionalProperties": false, "required": ["op", "value"],
          "properties": { "op": { "const": "set_pop_cap" }, "value": { "type": "integer", "minimum": 1 } } },
        { "type": "object", "additionalProperties": false, "required": ["op", "unit", "logistics"],
          "properties": { "op": { "const": "set_price" }, "unit": { "$ref": "#/$defs/unitId" }, "logistics": { "type": "integer", "minimum": 1 } } }
      ]
    }
  }
}
```

**Why these four and no more.** The issue names a menu, a cap and a call; a price is the one lever that turns a menu
change into a priced trade-off without touching combat. Deliberately absent from v1:

- **No stat patch.** A `patch` op on `UPGRADE_PATHS` (hp, armour, accuracy, penetration, optics, sight) is the obvious v2,
  and its applier would be `applyUpgrades`'s own `addDeltaAlongPath`. It is combat tuning in all but name, so it waits for
  the lead (Q5).
- **No purse op.** `logistics_start` stays the base's, so G3 Q7's 8/5 ratio holds for every one of the nine pairings
  without a new rule.
- **No `build_time_s` or `population` op.** Build time is line throughput, which the curve does not price; population is
  read by the sim (`sim.ts:1052`), and keeping it out is what lets v1 say "the sim reads nothing a doctrine changes".
- **No new formation grammar.** The signature is a formation FILE (§2.5), composed from shapes, drills and calls that
  already exist, so "a new shape, drill or call is a schema and engine change" (CLAUDE.md) is not triggered.

**Cross-file rules** (`tools/validate_doctrine.mjs`, extended; each one a line in `pnpm validate:data`):

| # | Rule |
|---|---|
| P1 | `extends` names a base doctrine, and the id's prefix is that faction. |
| P2 | Exactly three picks per faction (the lead's "three"; a constant to change, not a loop bound). |
| P3 | Ops are in canonical order: `menu_remove`, `menu_add`, `set_pop_cap`, then `set_price` sorted by unit id; each kind at most once except `set_price`, at most once per unit. One resolution order, whatever the author typed. |
| P4 | Every `menu_remove` id is on the base menu. Every `menu_add` id is a unit of the doctrine's side (the existing KDF / opposition rule), not on the base menu, not `loiter_drone` (LD3), and not a Store special (`STORE_SPECIALS`; Q7). That it is in `versusRoster()` (not `VERSUS_HELD_UNITS`) needs app code, so `tools/src/validate_doctrine.test.ts` checks it, as it checks the base menu today. |
| P5 | Each pick removes at least one base unit and adds at least one (it gives something up and gets something). |
| P6 | **No superset.** For any two doctrines of one faction, base included, neither resolved menu contains the other's as a set. With P5 the base check is redundant but cheap; it stays, because P5 is the one that will be argued with. |
| P7 | `set_price` names a unit on the RESOLVED menu, within ±10% of that unit's own JSON price (proposal), and the price passes §3's gate. |
| P8 | `set_pop_cap` equals the neutral cap (§3.2) exactly. A cap off the rule is a lever the lead has not priced (Q6). |
| P9 | `signature.formation` names a file in `data/formations/doctrine/` whose `doctrines` list is exactly `[<this id>]`; every file there is named by exactly one doctrine, and no file in `data/formations/` itself carries `doctrines` (§2.5; `index.test.ts`'s directory pin for `formations` skips the subfolder, and a second pin holds `doctrineFormations` to it). |
| P10 | `label`, `blurb` and `gives_up` are keys in `data/locales/en.json` (the formations' rule). |

### 2.3 The order against upgrades and overlays

`@lions/data` gains `packages/data/src/doctrines.ts`, a leaf module like `upgrades.ts`:

```ts
/** A base doctrine with its pick applied. `pick === null` returns the base's OWN arrays, by reference. */
export function resolveDoctrine(base: DoctrineJson, pick: DoctrinePickJson | null): ResolvedDoctrine;
/** The unit as this doctrine fields it: `cost.logistics` from a `set_price`, nothing else. A unit no op names is
 *  returned ITSELF, by reference (the identity the golden hash depends on). */
export function applyDoctrine<T extends DoctrinableUnit>(unit: T, resolved: ResolvedDoctrine): T;

interface ResolvedDoctrine {
  readonly id: string | null;            // null: the base, unpicked
  readonly faction: 'kdf' | 'sarim';
  readonly menu: readonly string[];      // base order, removals dropped, additions appended in op order
  readonly popCap: number | null;
  readonly logisticsStart: number;       // always the base's in v1
  readonly prices: Readonly<Record<string, number>>;
  readonly signature: string | null;
}
```

The pipeline, for every unit a world registers and every menu it prices:

```
fielded(u)   = applyUpgrades(applyDoctrine(u, D[sideOf(u)]), tiers[sideOf(u)][u.id] ?? {})
registered(u) = localizedUnit(fielded(u))          -> sim.addUnitType
price(u)      = fielded(u).cost.logistics           -> MissionContext.unitInfo, the dock, the AI view
menu(side)    = D[side].menu;  popCap(side) = D[side].popCap;  purse(side) = D[side].logisticsStart
mission       = applyOverlays(mission, choice)      (campaign only; a room has none)
```

- **Doctrine before upgrades.** A doctrine says what the brigade fields; the kit is bought on top of that. In v1 the two
  touch disjoint fields (`cost.logistics` against `UPGRADE_PATHS`) and commute exactly, but the order is fixed now so a v2
  stat patch has one meaning: a tier's cumulative delta is over the doctrine's unit. It also matches how
  `validate_balance.py --max-tier` prices a kitted unit (`logistics + K x total tier price`, with `logistics` the doctrine's).
- **Overlays are independent.** They act on mission JSON, a doctrine on unit JSON and the room's menu; nothing reads both.
  If the campaign ever takes a doctrine (Q10), the mission is overlaid first and a doctrine never edits a mission's own
  `production` block.
- **One place.** `packages/app/src/doctrine-prepass.ts`, beside `upgrade-prepass.ts`, is the one loop that produces the
  registered roster, the menus, the caps and the price lookup, and `upgradePrepass` takes its output. It is called by
  `buildMatchWorld`, by the battlefield boot for free play, and by the probes (`versus:probe`, the snapshot witness).
  `MatchWorld` gains `doctrineBySide: readonly [ResolvedDoctrine, ResolvedDoctrine]`, and the five `doctrines[faction]`
  readers listed in §1.2 read it instead. `versusUnitInfo` takes the fielded catalogue instead of `versusRoster()`'s raw
  one, so the price the dock shows is the price the runtime charges.

### 2.4 Registration in a room

v1 offers a doctrine only where `economyRoom(config)` is true. There each faction is fielded by one side (§1.6, item 2), so
the doctrine-fielded type is registered **in the base slot, in roster order**: KDF ids take the KDF seat's doctrine, every
opposition id (sarim, rif, ashwar) takes the Sarim seat's. No copy, no new type index, no change to `copyForSide1` (it never
runs in an economy room: side 1 is Sarim), and the runtime's single `typeIdOf` stays exact. Nothing in `packages/sim` changes.

**What a v1 doctrine moves.** Menu, cap and price are read by the runtime (the purse, the line, the cap check), never by
`sim.hash()`: `cost.logistics` reaches `addUnitType` inside the JSON and the sim reads only `cost.population` from it. So at
tick 0 a doctrine room's `sim.hash()` equals the same room's without a doctrine, and the first difference is a purchase.
That is a test (T2c) and the reason for the digest fold below.

### 2.5 The signature formation

`formation.schema.json` gains an optional `doctrines: string[]`. A formation without it is what it is today (the three
shipped files keep no such field and stay open to every seat of their factions). A formation with it is fielded for a seat
only when the seat's resolved doctrine id is in the list. The gate is the app's, beside the faction clause that already
exists: `formationFielded(table, faction, id)` (`frame-step.ts:92`) gains the seat's doctrine, and both the sender strip
and the receiver gate (`:132-133`) read it, so a forced client's order drops on both machines. The app hands the sim the
formation with `doctrines` stripped (the sim's parser, `formation-template.ts:481`, validates `factions` and must never see
the new key). Single-player and the campaign have no doctrine, so a doctrine-gated formation is never offered there.

**Where the files live, so no other room moves.** Every world registers `formations` in order (`match-world.ts`, "the ORDER
is match content"), and `Content` hashes that array. Six more files there would move the content digest, and so the network
hash, of every room. So the doctrine-gated files live in `data/formations/doctrine/`, exported separately
(`doctrineFormations`), registered by `buildMatchWorld` only for the doctrines the config fields, AFTER the shipped table (a
group row's index into the shipped three never moves), and folded through the doctrine word (§2.6), not `Content`. This is
GH-1102's rule for a Store special, applied to a formation.

The first set's six signatures (§3.4) are intents in one line each, composed only from the existing grammar; each is its
own data file, needs the formation's own design pass, and opens in a room only after **its own S4 run** (PR 947's finding).
Until then a doctrine ships with its signature closed in rooms by the existing `formationsOpenIn` mechanism, and the HUD's
inert reason line says so. **Note:** Tel Marum's economy rooms close every formation (`tel_marum.json:4`), so on that map
no signature can open while that ruling stands.

### 2.6 How a doctrine travels in a versus config

**The field.** `SeatConfig.doctrine?: string`. Absent is the base doctrine, unpicked: every room before this, every
mirror, placed and win-mode room, and every replay file already written.

**Validation** (`validateConfig`, `config.ts:503`), refusing (never coercing) when:
- `doctrine` is present and not a string, or empty, or a reserved key (`__proto__`, `constructor`, `prototype`);
- it is present in a config that is not `economyRoom` (sandbox, mirror, win mode);
- it is not in `DOCTRINE_IDS[seat.faction]`: a KDF seat holding a Sarim id is refused, not cleaned;
- `DOCTRINES_OPEN` is false and the field is present at all (the room minted it from a build where it was open: a stale
  client must fail loudly, as a build mismatch does).

**The twin table.** `packages/net/src/doctrines.ts` holds `DOCTRINE_IDS: Readonly<Record<Faction, readonly string[]>>` and
`DOCTRINES_OPEN` (false until the lead opens it, like `VERSUS_FORMATIONS_OPEN`). `tools/src/validate_doctrine.test.ts` pins
`DOCTRINE_IDS` to `@lions/data`'s `doctrinePicks` both ways, as `kit-tracks.test.ts` pins `KIT_TRACKS`.

**The room** (`match-room.ts`). The host's `/create` body and the guest's join body may carry `doctrine`; a new lobby
message `{ t: 'doctrine'; id: string }` changes a seat's pick until that seat is Ready (refused after `start`). The room
checks it against `DOCTRINE_IDS[faction]` and answers an invalid one with an `error` (proposal: refuse, do not clean; Q14);
a valid one clears that seat's Ready and goes out in the next `lobby` as `SeatState.doctrine`. While `DOCTRINES_OPEN`, a
seat in an economy room cannot be Ready without a pick. A bot seat's pick is minted by the room from the room seed (Q9).
`mintConfig` writes `doctrine` into a seat only when the room is an economy room and the gate is open; the lobby, the mint
and the config read one helper, as `seatSpecials` is read by both the lobby and the mint today.

**The digest.** The issue asks for the choice to fold into the match digest. In a room where either seat has a doctrine,
the data digest passed to `matchDigest` is `fold(contentDigest, fnv1a32(canonicalJson([resolved(side 0), resolved(side
1)])))`: the RESOLVED doctrines of both sides (id, menu, cap, purse, prices, signature, and the signature formation file
itself), computed from this client's own files. A client that ignores the config's pick, applies it wrongly, or ships a
pick file that differs from its peer's in anything that is in play, reports a different hash at tick 20, before any shot
and before any purchase that would show it in `sim.hash()` (§2.4). In a room with no doctrine the fold is skipped.

The pick files are deliberately NOT added to `Content` (`content-digest.ts:26-41`): a file that is not in play changes
nothing a match computes, and leaving it out keeps `shippedContentDigest()`, and with it the network hash of every room
without a doctrine and every fixture that holds a literal content digest, exactly where it is. (The base files are in
`Content` already, as `doctrines`.) The cost: two peers whose unpicked pick files differ see different cards in the lobby
until one of them picks; presentation only.

**Snapshots and replays.** A snapshot rejoin and a replay both rebuild the world from the config, so the pick comes back
with it. A replay header's config is re-validated on read (`replay-file.ts:116`), so a v1 or v2 file with no `doctrine` reads
as before, and a file whose pick names an id this build does not ship is refused as malformed. A replay is already refused
across builds, so a pick file edited between builds can never replay against the wrong numbers.

**Not a `Command`.** The pick is config, fixed before tick 0; no `Command` carries it and `cleanCommand` gains no field.
That is the issue's "Command-safe".

### 2.7 How each surface picks

| Surface | v1 | How |
|---|---|---|
| **Versus lobby** (play with a friend) | yes, economy rooms on the three faction maps | §2.6 and §4 |
| **Skirmish setup** (play the computer) | **not yet**: the offline opponent is mirror-only (`offline-match.ts:75-80`) | when the computer builds (GH-1388's follow-up), `OfflineRequest` takes the human's `doctrine` and `offlineConfig` mints the computer's from the seed, through the same validator |
| **Free play** (`/free-play/<map>`) | yes, as a sandbox flag | `&doctrine=<id>` in `sandbox-help.ts`'s table (its parser, help line, unknown-value warning and the picker all come from that one table); side 0 only; the unit ops and the menu wherever free play lists buildable units, and the signature formation. A sandbox flag never changes how a real mission scores |
| **Campaign** | **no** | the campaign's forced choice is the brigade's kit and Stores; every mission is authored against its own starting force and production block, and `pnpm playtest` would have to prove each mission at four menus. Q10 |

---

## 3. A balance-neutral first set

### 3.1 The metric

Everything comes from `tools/validate_balance.py`'s own functions (`build_power_fn`, `fit_curve`, `effective_cost`),
called, not copied (Appendix A). On today's roster the fitted curve is `cost = 282.314 x power^0.4818` (n = 47).

- **Surplus** of a unit at a price: `s(u) = ln(expected(u) / price(u))`. Positive is a bargain on the curve.
- **Menu value** of a doctrine: the mean of `s` over its resolved menu. Base KDF: **+0.0274** (12 units). Base Sarim:
  **+0.0203** (6 units).
- **Net value** of a doctrine: `Δ = menu value(doctrine) - menu value(base)`, scored on the **frozen base fit** (the curve,
  the axis medians and the exponent are the base roster's; the doctrine's prices are scored against it, never refitted
  into it). The gate (§5, T4) asks `|Δ| <= 0.005` (half a percent of price on the average menu item) and every priced unit
  inside the existing ±18% band.
- **Kitted KDF** (a brigade room): the same at max tier, with `--max-tier --upgrade-cost-factor 0.02` (the value
  `upgrades.md` §5 records), KDF doctrines only. Sarim fields no kit; under the max-tier refit its Δ moves only because the
  KDF rows moved the fit (raid reads +0.0088 there against +0.0000 at base), which is a reading of the curve, not of Sarim.

This is a statement about PRICES ON THE CURVE: no doctrine buys more power per logistic, on average over what it can
build, than its base. It is not a statement about win rates, which the issue parks.

### 3.2 The neutral cap

A cap is not on the curve, so v1 moves it only to keep the cap the same in "average menu items":
`cap(d) = round(cap(base) x meanPop(menu(d)) / meanPop(menu(base)))`, with population from each unit's `cost.population`
(drones 0). KDF base: 16 / 12 = 1.333 a menu item, cap 40. Sarim base: 9 / 6 = 1.5, cap 56. A doctrine of lighter units
gets a lower cap, a heavier one a higher. **Whether the cap ever binds in a versus match is unmeasured** (the purse usually
binds first; GH-1387's design found the campaign purse binds nowhere): the build slice reads peak population in the
economy cells of `pnpm versus:probe` before anyone argues about a cap (Q13).

### 3.3 The six (proposals)

Unit prices are the units' own JSON today; the dev column is the curve deviation after the doctrine's price.

**KDF base menu** (12): `mbt_lavi` 906, `ifv_namer` 630, `apc_eitan` 520, `inf_squad` 292, `at_team` 236, `mortar_team` 209,
`jeep_shoded` 317, `recon_drone` 210, `dozer_d9` 586, `heli_peten` 402, `yahalom_squad` 260, `inf_medic_squad` 295.
KDF ids available to add (in the versus roster, not on the base menu, not Store specials): `apc_kipod`, `scout_shachaf`,
`sniper_team`, `breach_team`, `demo_squad` (and `attack_drone`, left out: population 0 and a kamikaze, the LD3 shape).

| Doctrine (placeholder id) | Gives up | Gets | Prices (was -> is, curve dev) | Cap | Δ base | Δ max tier |
|---|---|---|---|---|---|---|
| `kdf_armour` | `heli_peten`, `jeep_shoded`, `yahalom_squad` (air, fast recon, engineers) | `apc_kipod` | `mbt_lavi` 906 -> 860 (-13.2%), `ifv_namer` 630 -> 605 (-10.7%), `inf_squad` 292 -> 308 (+5.4%), `at_team` 236 -> 245 (-5.6%) | 40 -> **42** | **-0.0036** | +0.0021 |
| `kdf_airmobile` | `mbt_lavi`, `dozer_d9` (the tank and the dozer) | `scout_shachaf`, `sniper_team` | `heli_peten` 402 -> 375 (-9.8%), `jeep_shoded` 317 -> 300 (-8.6%), `ifv_namer` 630 -> 665 (-1.8%), `apc_eitan` 520 -> 525 (+1.1%) | 40 -> **35** | **+0.0031** | -0.0032 |
| `kdf_urban` | `ifv_namer`, `heli_peten` (the IFV and air) | `breach_team`, `demo_squad` | `breach_team` 306 -> 290 (-7.1%), `demo_squad` 300 -> 283 (-3.0%), `mbt_lavi` 906 -> 915 (-7.7%) | 40 -> **35** | **-0.0009** | -0.0009 |

**Sarim base menu** (6): `sarim_rifles` 340, `atgm_cell` 235, `gun_truck` 324, `manpad_team` 210, `rocket_battery` 201,
`recoilless_team` 205. Opposition ids available to add (Ashwar and Rif units already in every room's roster): `mortar_crew`,
`technical`, `moto_rpg`, `militia_cell`, `rpg_team`, `charge_squad`, `paramotor`, `digger_crew` (the last left out until a
digger's place in a versus room is designed).

| Doctrine (placeholder id) | Gives up | Gets | Prices (was -> is, curve dev) | Cap | Δ base |
|---|---|---|---|---|---|
| `sarim_standoff` | `gun_truck` (its mobile gun and AA) | `mortar_crew` | `atgm_cell` 235 -> 222 (-6.7%), `sarim_rifles` 340 -> 355 (+15.1%) | 56 -> **56** | **+0.0007** |
| `sarim_raid` | `rocket_battery`, `atgm_cell` (the rockets and the Kornet wall) | `technical`, `moto_rpg` | `technical` 331 -> 315 (-5.7%), `gun_truck` 324 -> 345 (+3.1%), `manpad_team` 210 -> 218 (-6.6%) | 56 -> **44** | **+0.0000** |
| `sarim_militia` | `manpad_team`, `rocket_battery` (AA and the rockets) | `militia_cell`, `rpg_team` | `militia_cell` 280 -> 258 (-7.8%), `recoilless_team` 205 -> 212 (-6.6%), `sarim_rifles` 340 -> 345 (+11.9%) | 56 -> **44** | **-0.0003** |

Every price moves by at most 7.9% of the unit's own price; every priced unit stays inside ±18% (the widest is
`sarim_rifles` at +15.1% in `sarim_standoff`, already +10.3% at base). Every net value is within ±0.0036 at base tier, and
every KDF one within ±0.0032 at max tier.

**No superset, checked by hand** (P6 checks it in data): each KDF doctrine holds a unit no other KDF menu does (`apc_kipod`,
`scout_shachaf`/`sniper_team`, `breach_team`/`demo_squad`), each Sarim one likewise (`mortar_crew`, `technical`/`moto_rpg`,
`militia_cell`/`rpg_team`), and each drops a base unit, so none contains another or the base.

**What the set does not claim.** It changes no combat number, no `tuning.ts` constant and no purse. §5.7's targets (`pnpm
balance`) price exchanges with unit costs, so a doctrine's prices move their margins: the gate runs them per doctrine as a
REPORT (T4d), and whether any becomes a gate is Q12. The menus are judgement, offered for the lead to change; the arithmetic
re-runs in seconds on any change.

### 3.4 The six signatures (intent only)

Each is a formation file with `doctrines: [<id>]`, from the existing grammar (shapes `rank`/`files`/`ring`/`point`, drills
`press`/`halt`/`spring`, calls `contact`/`casualty`), and closed in rooms until its own S4 run:

- `kdf_armour` -> an armoured thrust: attack-move, armour in two ranks leading, infantry one rank behind, drill `press`,
  aircraft excluded.
- `kdf_airmobile` -> air cover: move, recon point ahead, infantry in files, the aircraft element answering `contact`,
  drill `halt`.
- `kdf_urban` -> a casualty drill: move, infantry in files with the medic answering `casualty`, drill `halt`.
- `sarim_standoff` -> a Kornet screen: move, support weapons and infantry in a ring with `cover_pref`, drill `spring`.
- `sarim_raid` -> a raid column: attack-move, light vehicles in two files, infantry behind, drill `press`.
- `sarim_militia` -> a swarm: attack-move, infantry in one wide rank, drill `press`.

The cost curve cannot price a formation (an order costs nothing). Its balance is S4's question, at the lead's bar.

---

## 4. The UI touchpoint

**Where.** The versus ROOM screen (`showVersusRoom`, `packages/app/src/ui/versus.ts:1013`), below the face-off and above
Ready, in an economy room only. One row per seat: your own as three selectable cards, the friend's as one read-only card (or
"choosing" until they pick; whether a pick is shown before Start is Q8). Ready is disabled until you have picked. The host
screen (`showVersus`) does not pick: the matchup is chosen there, and the pick belongs to the seat, not the host.

**A card** (placeholders; every string through `t()`, resolved when asked for, never at module load):

```
[doctrine.kdf_armour.name]                      <- label
[doctrine.kdf_armour.blurb]                     <- one line
Gives up: [doctrine.kdf_armour.gives_up]        <- versus.room.doctrine.gives_up, the tester's line
  - Peten  - Shoded  - Yahalom   + Kipod         <- unit icons from the resolved menu's diff against the base
  Cap 42 (was 40)   Lavi 860 (was 906) ...       <- the prices and the cap the dock will charge
  Signature: [formation.<sig>.name]              <- with the inert reason when it is closed in this room
```

- Keys, all placeholders: `doctrine.<id>.name`, `doctrine.<id>.blurb`, `doctrine.<id>.gives_up`, `versus.room.doctrine`
  (the row's heading), `versus.room.doctrine.pick`, `versus.room.doctrine.choosing`, `versus.room.doctrine.gives_up`,
  `versus.room.doctrine.signature`, `versus.room.doctrine.cap`, `versus.room.doctrine.ready_needs_pick`, and the free-play
  flag's help line in `sandbox-help.ts`. `validate:ui` holds colour and bare strings, as for every screen.
- The cards are a `radiogroup`: arrow keys move, Space picks, and the picked card is announced through the existing
  `aria-live` line. Unit icons come from `unitIcon` (`ui/portrait.ts`), with the kit sign as today.
- **In the match:** the dock lists the resolved menu at the resolved prices (it already reads the runtime's menu and
  `unitInfo`, so it follows `doctrineBySide` with no second source); the HUD's population read shows the resolved cap; the
  pause menu names the doctrine. The scoreboard and the match record carry each seat's pick, so tester session 3 can ask
  about it (Q11).
- **Free play:** the `/free-play` picker gains a doctrine select fed by the same flag table.

A mock is the build's first UI slice (§7); this design does not ship one.

---

## 5. Test plan

Each check arrives with the input that makes it fail, run (CLAUDE.md). Literals in an oracle are literals, never values
imported from the code under test.

**T1. The sim never learns a doctrine exists.**
- (a) Static: a test reads every file under `packages/sim/src`, strips comments, and finds no token matching `/doctrine/i`.
  Positive control: WITH comments kept it must find exactly the three comment lines there today (`tunnels.ts:1`,
  `mission.ts:456`, `mission.test.ts:3078`), so a stripper that strips everything cannot pass vacuously. Falsification: add
  `const doctrineId = 0;` to a sim file -> red; break the stripper so it returns `''` -> the control goes red.
- (b) Behavioural: build one world through `doctrinePrepass` with `kdf_armour` and `sarim_raid`, and a second from
  hand-written literal unit JSON carrying the same prices and the same menus; `sim.hash()` and the runtime digest are equal
  at tick 0 and after the same 600 ticks of commands, purchases included. The sim saw only JSON. Falsification: give the
  literal world `mbt_lavi` 861 -> the runtime digest differs at the first Lavi purchase.
- (c) Existing: eslint already refuses any import into `packages/sim`; a new `@lions/data` module changes nothing there.

**T2. No doctrine, no change.**
- (a) `pnpm test:determinism` passes with the golden hash in `packages/sim/src/determinism.test.ts` unmoved (single-player
  never resolves a pick).
- (b) Identity by reference: for every shipped unit, `applyDoctrine(u, resolveDoctrine(base, null)) === u` (`toBe`, not
  `toEqual`), and `resolveDoctrine(base, null).menu === base.menu`. Falsification: return `{ ...u }` from the identity path ->
  red.
- (c) Every pinned room is a room with no doctrine: the `room-capacity` tick-0 hashes, `VERSUS_ECONOMY_PINS`, the
  `two-client` witnesses and the snapshot witness stay at their literals. Falsification: default the prepass to `kdf_armour`
  when the config has no pick -> at least one literal pin must go red. **If none does, the pins are blind to price** (they
  may make no purchase in 200 ticks), and the build adds one that does: an economy room that queues one `mbt_lavi` at tick 1,
  pinned on the purse, red under the same mutation.
- (d) §2.4's claim: a doctrine room's `sim.hash()` at tick 0 equals the same config without the field. Falsification: let
  `applyDoctrine` write `cost.population` -> red.

**T3. Versus validation and anti-tamper.**
- (a) `validateConfig` refuses, one mutation each from a valid doctrine config: a number; `''`; `'__proto__'`; a Sarim id on
  a KDF seat; an unknown id; the field in a mirror room; in a win-mode room; in sandbox; any field while `DOCTRINES_OPEN` is
  false. And it ACCEPTS the valid one (the control that makes each refusal the mutation's).
- (b) The twin: `DOCTRINE_IDS` equals `doctrinePicks` grouped by faction, both ways. Falsification: add an id to one side ->
  red.
- (c) The room: a `/create` or join body with an invalid pick is refused; `{t:'doctrine'}` after Ready or after `start` is
  refused; Ready without a pick is refused while open; the minted config carries exactly the lobby's picks. Falsification:
  mint from the client's last message instead of the cleaned record -> red.
- (d) The digest: two clients, one forced to resolve `kdf_urban` while the config says `kdf_armour`, desync at tick 20
  (`desync` on the first hash tick) with no shot fired. Falsification: drop the doctrine word from the fold -> the same pair
  reports equal hashes at tick 20, red. A client whose PICKED file differs by one logistic desyncs at tick 20 too; one whose
  unpicked file differs does not, by design (§2.6). And a config with no doctrine reports exactly today's network hash:
  `shippedContentDigest()` is pinned unmoved by the change (literal), and the fold is skipped. Falsification: add the
  picks to `Content` -> the literal goes red.
- (e) The formation gate: a seat without `kdf_airmobile` cannot field its signature, on the sender and the receiver.
  Falsification: drop the doctrine clause from `formationFielded` -> red.

**T4. Balance neutrality** (`tools/validate_balance.py --doctrines data/doctrines`, or a sibling script that imports it;
in `pnpm validate:data` or `pnpm balance`, the lead's call).
- (a) For every pick: `|Δ| <= 0.005` on the frozen base fit; KDF picks also at max tier (`--upgrade-cost-factor 0.02`);
  every `set_price` unit inside ±18%; every `set_pop_cap` equal to the neutral cap.
- (b) The gate's own oracle pins each shipped pick's Δ as a LITERAL to four decimals (§3.3's table), so a gate that reads
  zero for every input fails its own pins.
- (c) Falsification, data mutations, each computed for this document (Appendix A):

  | Mutation | Reads | Verdict |
  |---|---|---|
  | `kdf_armour`'s `mbt_lavi` 860 -> 760 | Δ +0.0088; `mbt_lavi` at -23.3% | red twice (Δ and band) |
  | `sarim_raid` without its two price rises | Δ +0.0167 | red |
  | `sarim_militia` with no prices at all | Δ -0.0059 | red |
  | `sarim_standoff`'s `sarim_rifles` 355 -> 370 | Δ -0.0062; `sarim_rifles` at +20.0% | red twice |

  Implementation mutations, one line each: score Δ against the doctrine's own menu instead of the base's (the casebook's
  "normalised by the very thing it measured": reads 0 everywhere) -> the literal pins go red; refit the curve with the
  doctrine's prices in it instead of freezing it -> the pins move, red; skip the menu ops and score the base menu with the
  new prices -> the pins move, red; drop the max-tier pass -> a max-tier literal fails to be produced, red.
- (d) Report only: `pnpm balance` (§5.7) once per doctrine, the tables printed beside the base run.

**T5. No superset.** `validate:data` refuses a constructed pick that is the base plus `scout_shachaf` with nothing removed
(P5 and P6), and one whose menu is `kdf_urban`'s plus `kdf_armour`'s (P6 against `kdf_armour`). Both are written as
fixtures, run, and seen red; the shipped six pass.

**T6. The replay round-trip.** Record a short economy match with both seats picked (the match recorder, v2 with `checks`),
write the file, read it back (`replay-file.ts`), replay it in a fresh world: the end `sim.hash()` equals `referee.hash` and
every periodic check matches. Falsification: rewrite the header's `doctrine` to another valid id of the same faction -> the
file still validates, the replay diverges, and `checks` names the first window after the first purchase the two doctrines
price differently. A v1 arena file and a v2 file with no `doctrine` still read and replay as today.

**T7. One reader.** No file under `packages/app/src` or `tools/src` indexes `doctrines[` except `doctrine-prepass.ts` and its
test. Falsification: restore `room-economy.ts:63` as it is today -> red. (The shape of PR 978's "every `main.ts` consumer
passes the room's map" test.)

---

## 6. Open questions for the lead

The lead's approval of the design (19 Nov 2026) does not answer these; each is still open.

1. **The name.** "Doctrine" already means the GDD's three enemy doctrines and N3's faction file. Keep it in player copy and
   call the files "picks" in code (this design), or rename one of them? And: picks in `data/doctrines/picks/` (this
   design) or flat in `data/doctrines/` with a `oneOf` schema?
2. **Where doctrines apply.** v1 is KDF-v-Sarim economy rooms only, on the three faction maps. Mirror, placed and win-mode
   rooms have no menu, cap or purse; a doctrine there would be its signature alone, and a KDF-v-KDF economy room would need
   the runtime's `typeIdOf` by side, which is a sim change. Accept?
3. **A forced choice.** Is the base pickable, as a fourth "standard" card? This design says no: while doctrines are open a
   seat must pick one of three, and the base exists only for rooms and replays from before.
4. **The signature call.** A doctrine-gated formation (this design: data only, no sim change, needs its own S4), or a
   fire-support call, which today acts for side 0 and is dropped in every room, so it needs a sim change and a design of
   its own?
5. **The op set.** v1 is menu, cap and price, with no stat patch, purse, build-time or population op. Is a `patch` op on
   `UPGRADE_PATHS` wanted in a v2, and is that "combat tuning"?
6. **The neutrality metric.** Equal-weight mean of log surplus over the menu, frozen base fit, `|Δ| <= 0.005`, the neutral
   cap rule. Accept the metric, the tolerance and the cap rule, or weight the mean by what a player is likely to buy?
7. **Store specials on a menu.** Refused by P4 (a doctrine would hand out free what the Store sells, e.g.
   `heli_peten_gunship`). Accept?
8. **The friend's pick.** Shown in the lobby once made, or revealed only at Start? Both seats' clients receive both picks in
   the config either way; hiding is presentation only.
9. **A bot seat's pick.** Minted by the room from the seed (this design), from the bot's join body, or fixed per bot?
10. **The campaign.** No doctrine in v1. A later "brigade doctrine", chosen at campaign start as a ledger key and applying
    unit ops only, would cost a fourfold `pnpm playtest` matrix. Wanted later, or never?
11. **Fairness, parked.** The cost-curve gate is not a fairness claim. When the lead rules, the read is nine pairings on
    three maps, both ends (54 economy cells), on fresh seeds, PR 947's protocol. What bar, and before or after the open?
    And should the match record carry each seat's pick so tester session 3's answers can be matched to games?
12. **§5.7 per doctrine.** Report only (this design), or gated?
13. **The cap.** Measure peak population in the economy cells first? If the cap never binds, the cap lever is cosmetic in
    v1 and the menu and prices carry the doctrine.
14. **An invalid claim.** Refused at `/create` and join (this design), or cleaned to "no pick" as tier claims are cleaned?
15. **The Sarim roster.** The issue depends on growing the playable Sarim roster to 15 types. This set uses the Ashwar and
    Rif units every room already registers; when the roster grows, the three Sarim menus are redrawn. Build before or after?
16. **The numbers.** Every menu, price and cap in §3.3 is a proposal: change any, and the arithmetic re-runs.

---

## 7. Slices (tickets of 1 to 5 days, after the lead rules)

1. **Data and gate** (2-3 d): `doctrine_pick.schema.json`, `doctrines.ts` (`resolveDoctrine`, `applyDoctrine`), the six
   files at `status: proposed`, P1-P10, T4 and T5, the en.json keys. No app change.
2. **The pre-pass** (2-3 d): `doctrine-prepass.ts`, `MatchWorld.doctrineBySide`, the five readers, `versusUnitInfo` on the
   fielded catalogue; T1, T2, T7. Still unreachable (no config carries a pick).
3. **The config** (3-4 d): `SeatConfig.doctrine`, `DOCTRINE_IDS`, `DOCTRINES_OPEN` false, the Worker's claim, lobby message
   and mint, the digest fold (the picks stay out of `Content`); T3 (a-d), T6.
4. **The lobby** (2-3 d): a mock for the lead first, then the cards, the dock and HUD reads, the free-play flag.
5. **The signatures** (3-5 d each pair): the formation `doctrines` field and gate (T3e), the six files, each one's S4 run.
6. **Open** (the lead): flip `DOCTRINES_OPEN` after the fairness read the lead asks for.
7. **The computer** (after GH-1388's economy follow-up): `OfflineRequest.doctrine`.

---

## Appendix A: the arithmetic, reproducible

The script imports `tools/validate_balance.py` and calls its own `build_power_fn`, `fit_curve` and `effective_cost` on
`data/units/**` (civilians and `wounded` roles left out, as the validator leaves them out), then scores each doctrine's
resolved menu on that frozen fit. The max-tier variant first runs the validator's own `patch_to_max_tier(units, 0.02)` and
adds a doctrine's price change on top of the kitted cost. Inputs are the six doctrines as `{add, remove, price}`; outputs
are §3.3's columns. Per-unit inputs it printed, for checking by hand (power, own price, curve price, surplus, population):

| unit | power | price | curve | surplus | pop |
|---|---|---|---|---|---|
| `mbt_lavi` | 13.546 | 906 | 991.0 | +0.0897 | 3 |
| `ifv_namer` | 6.146 | 630 | 677.2 | +0.0722 | 2 |
| `apc_kipod` | 4.520 | 562 | 584.0 | +0.0384 | 2 |
| `dozer_d9` | 4.466 | 586 | 580.6 | -0.0093 | 1 |
| `apc_eitan` | 3.544 | 520 | 519.4 | -0.0012 | 2 |
| `heli_peten` | 2.234 | 402 | 415.9 | +0.0339 | 2 |
| `scout_shachaf` | 2.210 | 410 | 413.7 | +0.0090 | 1 |
| `jeep_shoded` | 1.367 | 317 | 328.2 | +0.0348 | 1 |
| `breach_team` | 1.233 | 306 | 312.3 | +0.0205 | 1 |
| `inf_squad` | 1.074 | 292 | 292.1 | +0.0005 | 1 |
| `demo_squad` | 1.071 | 300 | 291.8 | -0.0277 | 1 |
| `yahalom_squad` | 0.959 | 260 | 276.7 | +0.0621 | 1 |
| `sniper_team` | 0.930 | 260 | 272.7 | +0.0475 | 1 |
| `inf_medic_squad` | 0.921 | 295 | 271.3 | -0.0839 | 1 |
| `at_team` | 0.840 | 236 | 259.6 | +0.0952 | 1 |
| `mortar_team` | 0.562 | 209 | 213.9 | +0.0229 | 1 |
| `recon_drone` | 0.554 | 210 | 212.5 | +0.0117 | 0 |
| `gun_truck` | 1.422 | 324 | 334.5 | +0.0318 | 1 |
| `technical` | 1.419 | 331 | 334.1 | +0.0094 | 1 |
| `sarim_rifles` | 1.201 | 340 | 308.3 | -0.0978 | 2 |
| `militia_cell` | 0.981 | 280 | 279.8 | -0.0008 | 1 |
| `moto_rpg` | 0.774 | 244 | 249.6 | +0.0225 | 1 |
| `atgm_cell` | 0.701 | 235 | 237.9 | +0.0123 | 1 |
| `manpad_team` | 0.673 | 210 | 233.4 | +0.1054 | 1 |
| `recoilless_team` | 0.635 | 205 | 226.9 | +0.1015 | 1 |
| `rpg_team` | 0.588 | 210 | 218.5 | +0.0399 | 1 |
| `mortar_crew` | 0.502 | 198 | 202.5 | +0.0223 | 1 |
| `rocket_battery` | 0.463 | 201 | 194.8 | -0.0312 | 3 |

A worked line, `kdf_armour` at base tier: the base menu's twelve surpluses sum to 0.3286 (mean 0.0274). Remove
`heli_peten` (+0.0339), `jeep_shoded` (+0.0348) and `yahalom_squad` (+0.0621), add `apc_kipod` (+0.0384): 0.2362 over 10
items. The prices add ln(906/860) + ln(630/605) - ln(308/292) - ln(245/236) = +0.0521 + 0.0405 - 0.0533 - 0.0374 = +0.0018,
so the menu value is (0.2362 + 0.0018) / 10 = 0.0238, and Δ = 0.0238 - 0.0274 = -0.0036. Cap: (3+2+2+1+1+1+0+1+1+2) / 10 = 1.4 a unit, and
40 x 1.4 / 1.333 = 42.
