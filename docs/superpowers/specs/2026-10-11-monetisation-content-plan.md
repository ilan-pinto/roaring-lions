# The monetisation content plan, non-pay-to-win — design (WP-ST8, #207, revision 2)

**Date:** 2026-10-11 · **Status:** the spec. The lead pulled ST8 forward on 2026-10-11 and
ruled the same day on D1–D5 (§10): early access **kept, fenced** (D1); coins **may** open
Conduct-gated units in single player (D2, reversed); the economy documents made to agree in
this PR (D3); "bring your brigade" uses **everything the player owns**, in friends' rooms only
(D4, reversed); paid-art storage **deferred** to the Steam stage (D5). D6–D10 are recommended,
not yet ruled. Docs only: no code, no data, and the sim is untouched.
**Supersedes:** the catalogue, pricing and guardrail sections of
`2026-09-28-st8-monetisation-content-plan.md` (revision 1, #270). Its store-item test (T1–T11)
and its never-sell list are carried forward here, amended where §1 says so. **Amends, in this
PR (D3):** GDD §9, brigade spec D6 and §4.6, `prices.md` §8, revision 1 §1, and the coin shop
spec's network ruling (its §0.1 item 3), so the tree states the economy once.
**Reads against:** G7 (#199, approved 29 Sep); the Roar coin shop design
(`2026-10-01-roar-coin-shop-design.md`, #329) and the lead's 30 Sep and 1 Oct rulings in it;
the shipped Stores (#349) and TEST coins (#351); the brigade economy
(`2026-09-15-brigade-economy-design.md`, `creditsFor`, the per-campaign improvement record of
GH-330); E5 (#181) and E6 (#274); ST5 (#204), ST6 (#205), ST7 (#206); the network game draft
(`2026-10-10-network-game-design.md`, draft PR #518); the licensing decision (GDD §9).

---

## 0. Why a second revision

Revision 1 (29 Sep) said Roar coins buy only cosmetics. Two days later the lead ruled that
coins buy **everything credits buy**, in place of the credit cost, for single-player only
(coin shop spec §0.1), and #351 shipped that behaviour behind `?testcoins`. The coin shop
spec wrote an amendment for revision 1 (its §1.8) "to land with this spec". It never landed.
So the tree states the economy two ways today.

**Findings, each checked against `origin/main` at `87d213e6` on 2026-10-11:**

| # | Finding | Where |
|---|---|---|
| F1 | **Four documents say coins buy no unit, and the code sells units for coins.** GDD §9, brigade spec D6 and §4.6, `prices.md` §8 and revision 1 §1 say Roar coins buy only cosmetics. The coin shop spec §0.1 and the shipped Stores say coins buy unit unlocks, the E5 units and every upgrade rung | `docs/GDD.md` §9; `packages/app/src/ui/stores-model.ts`; `packages/app/src/roar-test.ts` |
| F2 | **Coins open Conduct gates.** A credit price already opens a Conduct-gated unit (`unlock.ts`'s gate sentence: "Conduct N, or buy for P credits"), and coins replace the credit price, so nine units gated at Conduct 70–90 (`recon_drone` 70 to `mbt_lavi` 90) open for coins with no Conduct at all. G7 rejected selling credits for exactly this reason: "a purchasable credit makes a Conduct floor purchasable, which is the one thing the grade is supposed to mean" | `data/units/kdf/*.json` `unlock.roe_rating_min`; #199. **Ruled 2026-10-11 (D2): kept on purpose**; see §1.2 |
| F3 | **The earned-only network rule exists as a function nothing calls.** `networkView` reads earned entitlements only, and its own comment says nothing calls it. `accountView()`, which the garage, the dock and `resolveUpgrades` all read, includes coins. The network draft's `Seat` takes `tiers` and `unlocks` "from what the client claims under `brigade`", and does not name `networkView` | `roar-test.ts:260`; draft spec §2.1. **Ruled 2026-10-11 (D4): the owned view is right for a friends' room**; see §5 |
| F4 | **`?testcoins` is live on the public site** and unlocks units and tiers for free in that browser. #351 says it "must be removed or gated before release" | `roar-test.ts` header |
| F5 | **The repo is public and the art is all rights reserved.** A paid livery committed beside the free art is visible and downloadable by everyone, though not licensed for use. Nothing yet decides where paid art lives | GDD §9 licensing; repo public since 25 Sep. **Deferred 2026-10-11 (D5)** to the Steam stage |

This revision does not overturn the lead's 1 Oct rulings. It names them as one fenced lane
(§1.2), records the lead's 2026-10-11 rulings on F2 and F3 (§10 D2, D4), and makes the
documents in F1 agree in the same PR (D3).

---

## 1. Principles

### 1.1 What "not pay-to-win" means here

**No one can buy a win against another person, a better grade, or a story.** Concretely, money
never buys:

1. **Power in matched play.** Nothing bought changes what a unit does in a public or ranked
   match, or in any room on matched kit: both seats field the same base roster at the same
   tiers whatever either player owns (draft spec Decision 5). The one opt-in exception is a
   friends' room whose host turns on "bring your brigade" (§5, D4).
2. **Conduct.** No Conduct point, floor, forgiveness, ROE rating or grade is ever sold. Conduct
   is the game's moral spine (GDD pillar 2). **One ruled exception (D2, 2026-10-11):** in single
   player, coins may open a Conduct-gated **unit**, exactly as a credit price already can
   (§1.2).
3. **Campaign progress.** No mission, act, ending, star, grade, ledger key, roster slot,
   reserve capacity, revive, skip, extra logistics, intel or time inside a mission.
4. **Brigade credits.** Never sold, never granted for money, never converted from coins, never
   a pack bonus or a payout multiplier (G7).
5. **Units that beat units in matched play.** A unit only money can field never appears in a
   public or ranked room, or on matched kit. E5's bought-only units are bought with earned
   credits or, in single player, with coins (§1.2); they reach a match only through a friends'
   room on "bring your brigade" (D4).
6. **Chance.** No loot box, crate, gacha or paid random item of any kind (§9).
7. **Features.** Replays, spectating, photo views, accessibility, colour-vision variants,
   settings and the AI advisor are never sold.

### 1.2 The one fenced lane: single-player early access

The lead's 30 Sep and 1 Oct rulings let coins unlock early what play also unlocks: units,
E5's bought-only units and upgrade tiers, at 1 coin = 10 credits, rounded up to a multiple of
5. **The lead kept it on 2026-10-11 (D1), fenced, in these words:** single player only; coins
unlock early only what play can also reach; never usable in a match against a person; never
affects a score. Each wall is a check rather than a sentence (§7):

- **Single player only.** The Stores sells it for the campaign and the sandbox.
- **Reachable by play** (coin spec G1): nothing is sold for coins that a free player cannot earn
  in finite play. Since GH-330 a fresh campaign pays again, so the whole credit catalogue
  (70,090 credits) takes about 12.2 campaigns.
- **Never usable in a match against a person**: never in a public or ranked room and never on
  matched kit (guard S5). **D4, ruled the same day, makes one opt-in exception:** in a friends'
  room whose host turns on "bring your brigade", each seat brings everything its player owns,
  bought included (§5). Both players see the toggle before they ready up, and it is off by
  default.
- **Never affects a score**: stars, grade, Conduct and `creditsFor` compute the same with or
  without it (coin spec G4; guard S6).

**Conduct-gated units are inside the lane (D2, 2026-10-11).** The lead reversed this plan's
recommendation: coins may open the nine Conduct-gated units (Conduct 70–90) in single player,
as a credit price already can. **The trade-off, recorded with the ruling:** Conduct gating
becomes skippable with money in single player. A player can field `mbt_lavi` (Conduct 90)
without ever fighting at Conduct 90, which is the outcome G7 rejected credit sales to prevent
(F2). What stays unsellable is Conduct itself: points, floors, forgiveness, the ROE rating and
the grade. The Stores keeps the computed honest line ("Free at Conduct 85") on those cards, so
the earned door is always named beside the bought one.

### 1.3 What "horizontal" means

A horizontal item gives **another way to look, listen or play, never a stronger way to win**.
Two rules settle every case:

- **Anything that can appear in matched play is free to everyone the day it ships there**:
  maps in the match pool, factions, seats, units and rules. The match pool is never sold.
- **Anything sold changes only what a person sees or hears**, and passes the store-item test
  (§2).

So new fronts, operations and skirmish maps are horizontal **content**, and they ship free.
What is sold beside them is how they look and how you remember them (§3).

---

## 2. The store-item test, carried forward

Revision 1's T1–T11 stand, with three edits:

- **T1 (currency)** reads: priced in Roar coins only. Never in credits and coins on one button,
  and coins never convert into credits.
- **T2–T4 (sim-, score- and gate-blind)** apply to every cosmetic. An early-access item (§1.2)
  is judged by the guards in §7 instead, because it is meant to change what single player
  fields and which doors open there.
- **T5 (legibility-neutral)** is a measured check, not a reviewer's judgement (guard S9).

T6 (register-distinct: no stars, chevrons, `--commend` gold, kit Stars of David or rank slip),
T7 (known contents), T8 (kept forever), T9 (fiction: GDD §2 and storyline §2.4), T10 (no earned
twin) and T11 (removable) are unchanged. **One "no" and the item is not sold.**

---

## 3. The catalogue

Every item is KDF-side in the first catalogue. Sarim-seat cosmetics wait for the Sarim seat
(draft spec stage N3), and are then judged per doctrine under T9.

### 3.1 Brigade liveries

A paint scheme for every KDF type at once. Albedo only: geometry, kit parts, team colour,
selection rings and overlays are untouched.

| Livery | Look | Fiction |
|---|---|---|
| **Sahar Dust** | the shipped bakes | free, the reference every other livery is measured against |
| **Sur Winter** | rock grey-white | the northern mountain front |
| **Naharin Olive** | green highland drab | the river-basin front |
| **Marj Coastal Grey** | harbour-concrete grey | the coastal enclave |
| **Ari'im Dress** | parade scheme, brigade patch on the turret side | the 401st's own |

**Brigade-wide only at launch**, not per type. It keeps the SKU count small, avoids a
patchwork brigade, and makes one price mean one thing. Per-type liveries can follow if asked
for.

A livery that blends into its own front's ground is recoloured, not sold (S9). No camouflage
that reads as camouflage is ever an advantage, because the measure is against the free
livery's own contrast.

### 3.2 Unit badges

A company or crew mark **on the unit's icons only**: dock tile, selection chip, HUD card,
garage rail. Never in the world, by the lead's 27 Sep ruling on the kit mark ("The mark is
ugly maybe it should only show on the icons"). It sits in the icon's opposite corner from the
kit sign, and it shares no shape or colour with the kit's steel Stars of David, the per-level
chip border tint, or the veterancy chevrons (T6, S10).

- **Company tabs**: Alef, Bet and Gimel company plates of the 401st.
- **Crew nameplates**: a Lavi named *Ari 1*, a Namer named *Sahar*, in the materiel register
  (storyline §2.4 rule 4).
- **Brigade patches**: the Ari'im lion head in three frames (roundel, shield, tab). Never the
  Roar coin's Hex Seal, so a bought patch never looks like the currency.
- **Front tapes**: a plain text tape reading MARJ, SUR or NAHARIN. Geographic, not an honour.

### 3.3 Command-post dressing

Revision 1's Q12, now in the first catalogue because it is the cheapest category to make and
the furthest from play:

- **Menu diorama presets**: re-staged `data/front/menu_diorama.json` variants (a dawn parade, a
  winter laager), each with its re-shot plate (`pnpm plate:host`).
- **Campaign-board plinths**: the diorama's base and rim (`outland_scenery`), in stone, olive
  wood or map-table.
- **Briefing folder styles**: the deploy screen's paper, stamp and tab, as theme tokens.
- **Garage backdrops**: the bay behind the turntable.

Never the cursor, the symbols, the HUD colours or anything with a colour-vision variant. Those
are functional.

### 3.4 Radio voice sets (later, rights permitting)

An alternative voice for the Shai/Idit briefings and the unit barks, same lines, same channels.
Horizontal in the plain sense. It ships only with explicit redistribution rights for every
recording (CLAUDE.md), and never before the base voice set is complete.

### 3.5 Operation passes

An **operation** is a set of three to five missions on a front, or a skirmish season: content.
**Every operation's missions are free to every player** (revision 1 §3). The **pass** is the
operation's cosmetic track: 8–12 items from §3.1–3.4, themed on it, each unlocked by **play in
that operation**: finishing a mission, an objective, a grade. Everything in it is listed before
purchase (T7). It never expires, and its tiers are never sold as skips (revision 1 Q4, Q5).

**Why the missions stay free:** a paid mission pays credits on victory (`creditsFor`), so money
would buy credits one step removed, which G7 forbids, and would paywall the story. If the lead ever wants a paid story episode, it pays **zero** credits and its rewards are
cosmetic (guard S12).

### 3.6 Never sold, carried forward and extended

Revision 1 §7 stands, minus the lines the 1 Oct rulings moved into the early-access lane
(units, tiers and E5's units, for single-player only). Added:

- kill tallies, trophies, blood, or any mark that counts or celebrates killing;
- anything that depicts or trades on First Light, the abducted, civilians or civilian harm;
- a "victory" or "honour" look for a front not yet finished by that player (T10);
- the free match pool: maps, factions, seats, units, rules (§1.3).

---

## 4. Credits, coins and how they meet

| | Brigade credits | Roar coins |
|---|---|---|
| Source | play only (`creditsFor`, improvement per campaign, GH-330) | Steam Wallet only (ST7); never earned in play (revision 1 Q2) |
| Buys | unit unlocks, E5 bought-only units, upgrade tiers | cosmetics, operation passes; and early access in single player (D1) |
| Counts in a network match | only in a friends' room on "bring your brigade" (D4) | only in a friends' room on "bring your brigade" (D4); never in a public or ranked room |
| Opens a Conduct-gated unit | yes, by D1 of the brigade spec ("or buy for P credits") | yes, in single player (D2, ruled 2026-10-11) |
| Converted into the other | never | never |
| Shown | `--commend`, the noun "credits" | `--roar`, the Hex Seal glyph, the noun "Roar coins" |

**One button, one currency.** A card may show both prices, as the Stores does today, but every
Buy spends exactly one currency and says which.

**Skirmish pays nothing.** The network draft's Decision 20 pays no credits for a match result in
version one. That keeps matched play from becoming a credit farm. Any later skirmish payout is
an ST/G-G question, and it writes `earned` only: coins never become credits (S7).

---

## 5. Matched-kit multiplayer

- **Matched kit is the default and the only mode in any public or ranked room.** Both seats
  field base rosters at tier 0, `unlocks` and `tiers` empty (draft spec §2.1). Money, coins and
  credits are all invisible to the sim there.
- **"Bring your brigade" uses everything the player owns, in friends' rooms only (D4, ruled
  2026-10-11).** A `brigade` seat's `tiers` and `unlocks` come from the single-player view,
  earned plus bought (`max(earned, coins)` per track), never from `networkView`. It is never
  offered in a public or ranked room (guard S5). It reverses the coin spec's 1 Oct ruling 3
  ("network play uses only what each player earned") for friends' rooms; that spec is amended
  in this PR. The network session (#518) has been told. Until ST6 the room trusts the client's
  claim, which the draft spec already labels friends-only; once ST6 exists the room builds the
  seat from the server ledger. So money can tilt a match only between two friends who both
  agreed to bring their brigades.
- **Cosmetics cross the wire as ids, never as sim input.** The lobby exchanges each seat's
  selected livery and badges. The other client fetches the livery textures during the lobby, or
  draws Sahar Dust if they have not arrived by the deploy. A replay records commands, never
  cosmetics, and plays back identically with or without the viewer's inventory.
- **A client setting, "Show standard liveries"**, draws every unit as Sahar Dust for anyone who
  wants pure legibility. A ranked room may force it.

---

## 6. Pricing

### 6.1 The base game

The posture is **free-to-play on Steam** (the lead's roadmap, 19 Sep): the whole campaign, every
operation's missions and skirmish are free. The base game's price is **$0**, so the bands below
are set against two references instead:

- **a premium RTS of this scope**, about $30–40, and its expansions at about $25–35 (the coin
  spec's market check, retrieved 2026-10-01: Company of Heroes 3 expansions $24.99, Steel
  Division 2's History Pass $34.99);
- **the early-access lane's whole catalogue**, about 7,395 coins, ≈ $60 (coin spec §1.3).

Target: **a player who buys everything cosmetic for a year spends about one premium RTS plus
one expansion**, ≈ $55–65, and a player who buys nothing has a finished-looking game (revision 1
§5.5).

### 6.2 Bands

The packs stand as the coin spec set them: 500 / 1,100 / 2,400 / 6,500 coins at $4.99 / $9.99 /
$19.99 / $49.99, bonus +0 / 10 / 20 / 30%. So 1 coin ≈ $0.01 at the smallest pack. **Cosmetic
prices are multiples of 50 coins**, so every pack spends to zero (revision 1 §5.2):

| Band | Items | Coins | ≈ USD |
|---|---|---|---|
| Micro | one badge, one front tape | 50 | $0.50 |
| Small | a badge set (three company tabs), a nameplate set | 100–150 | $1.00–1.50 |
| Standard | one command-post dressing item | 200–400 | $2–4 |
| Major | one brigade livery | 800 | $8 |
| Episode | one operation pass | 1,000 | $10 |

No-orphan check: 500 = one 400 dressing + two badges; 1,100 = a pass + two badges;
2,400 = a livery + a pass + a 400 dressing + four badges.

### 6.3 What a year looks like

| | Items | Coins |
|---|---|---|
| Launch catalogue | 3 paid liveries, 12 badges, 4 dressing items | 2,400 + 600 + 1,200 = **4,200** (≈ $40) |
| Added per year | 4 passes, 2 liveries, about 24 badges | 4,000 + 1,600 + 1,200 = **6,800** (≈ $55–65 after bonuses) |

Prices are planning numbers. ST7 fixes them against Valve's catalogue and regional table; every
item price comes before any pack price (revision 1 §5.1).

---

## 7. Guardrails: P2W made structurally impossible

Each guard is a schema, a type or a test, with the one-line mutation that must turn it red
(CLAUDE.md, "Every check gets an input that makes it fail"). None exists yet; each is proposed
for the package named.

| # | Guard | Enforced by | Red by (mutation) | Package |
|---|---|---|---|---|
| S1 | **A cosmetic carries no number the sim reads.** `data/cosmetics/*.json` validates against a new `cosmetic.schema.json` with `additionalProperties: false` and a closed `kind` enum (`livery`, `badge`, `nameplate`, `dressing`, `voice`) | `pnpm validate:data`; a spec computes the intersection of the cosmetic schema's property names with `unit.schema.json`'s and requires it empty, so a unit field added later cannot leak in | add a `hp` property to the cosmetic schema → the intersection spec fails | cosmetics v1 |
| S2 | **A store item grants only what its type allows.** `data/store/catalogue.json` validates against `store_item.schema.json`: `grants` is a discriminated union of `cosmetic:<id>`, `pass:<id>` and, only while D1 keeps the lane, `early:<unitId>` / `early:<unitId>.<track>.<tier>`. No `credits`, `conduct`, `stars`, `mission`, `roster`, `xp` or `time` branch exists to write | `pnpm validate:data` | add `{ "credits": 500 }` to one item → schema refuses | ST7 |
| S3 | **No random grant.** The store schema has no `weight`, `chance`, `pool` or `random` key, and `grants` is a fixed array | `pnpm validate:data` | add `"chance": 0.1` → refused | ST7 |
| S4 | **Nothing that reaches the sim can import a cosmetic.** eslint `no-restricted-imports` over `packages/sim/**`, `@lions/data`'s `applyUpgrades`, `mission-start.ts` and the future `packages/net` seat builder, naming `cosmetics` and `stores-*`. The seat builder may read the owned loadout (D4); it may not read a cosmetic | `pnpm lint` | import a cosmetics module from the seat builder → lint red | cosmetics v1 |
| S5 | **Owned kit is never offered outside a friends' room (D4).** A room carries `kind: 'friends' \| 'public' \| 'ranked'`; the room refuses `kit: 'brigade'` unless `kind` is `friends`, and `matched` builds empty `tiers` and `unlocks`. A spec asks a public and a ranked room for `brigade` and requires refusal; a second spec builds a `brigade` seat in a friends' room from an account whose only entitlements are coin-bought and requires those tiers present, so D4 is honoured and not silently narrowed to earned-only | a room spec | let a public room accept `brigade` → red; build the friends' seat from `networkView` → the second spec red | network N1 |
| S6 | **Owning everything changes no outcome.** The golden replay (`determinism.test.ts`) and one `pnpm playtest` mission run twice, with an empty account and with every cosmetic owned and a livery selected; the state hash and the debrief (stars, Conduct, credits) are byte-identical | `pnpm test:determinism`, `pnpm playtest` | thread the selected livery id into one unit type's JSON before `addUnitType` → hash differs | cosmetics v1 |
| S7 | **Coins never become credits.** No coin path writes `grants`, `balance` or `earned_total` | the coin spec's G3 invariant over the account | make a coin buy push a grant → red (already falsified once in #351) | ST6 |
| S8 | **Withdrawn by the lead's D2 ruling (2026-10-11).** It would have refused coins on a Conduct-gated unit; coins may open those in single player. Kept as a row so the numbering holds. What still protects Conduct is S2 (no `conduct` grant exists to write) and S6 (owning anything moves no Conduct figure) | — | — | — |
| S9 | **A livery is no harder to see than the free one.** For every livery and type, rendered through the mesh gate's own camera on each front's ground: mean luminance contrast against the ground is at least the Sahar Dust livery's contrast on the same ground minus 10%, and ΔE to every team colour variant is at least Sahar Dust's. Relative to the free livery, so no fitted absolute threshold | `pnpm validate:meshes` (a cosmetics pass) | repaint one livery to the ground's own tone → red | cosmetics v1 |
| S10 | **A badge never looks earned.** Badge SVGs use only badge tokens (no `--commend`, no `--roar`); a shape check refuses any closed path with five or more alternating outer points (stars) or a hexagram (the kit sign) and any stacked V (chevrons). Heuristic, so a reviewer still signs T6 | `pnpm validate:ui` | add a five-point star badge → red | cosmetics v1 |
| S11 | **Kept forever.** `data/store/shipped.lock` lists every item id ever sold; a spec fails if the catalogue drops one, and receipts are append-only on the server | a spec | delete an id from the catalogue → red | ST6/ST7 |
| S12 | **A paid mission pays nothing.** If any mission is ever sold, the payout path refuses: `creditsFor` is never called for a mission flagged `paid` in its schema | a spec on the victory write | call `creditsFor` for a paid mission → red | only if ever needed |

Plus three release gates, not checks: **`?testcoins` is removed or server-gated before the
first real coin** (F4); **the early-access shelf stays disabled until ST6's server ledger
answers** (coin spec §2.7); and **no paid art ships until D5 picks its storage** at the Steam
stage.

**Source-available caveat.** Under PolyForm Noncommercial, anyone can build a client that
unlocks every cosmetic for themselves. That is acceptable: a cosmetic only matters to the
person looking at it. What must be server-held is the coin balance, the receipts and what
**other** players are shown, so a match only shows a livery the server says that seat owns.

---

## 8. What each item costs to make

Measured facts first: every KDF unit GLB carries a baked base-colour texture, and only the four
KDF deployable buildings do not (census of `art/meshes/**` on 2026-10-11: 74 GLBs textured,
all 19 KDF unit types among them; the Lavi's bake is a 2.4 MB JPEG, `inf_squad`'s 0.3 MB). Kit parts are UV-pinned to that
bake (plan 3, GH-238). So a livery is a **second base-colour texture per type**, painted on the
existing UV map, kit islands included, and never new geometry.

| Item | Pipeline | Effort (agent + lead review) | Meshy | Payload |
|---|---|---|---|---|
| Badge | hand-drawn SVG at 16/24/48 px, like `kitIconSignHtml`; S10 | 1–2 h each | none | < 2 KB |
| Nameplate set | data strings + one plate SVG | 1–2 h | none | < 1 KB |
| Brigade livery | Blender repaint of 19 bakes (masks over the shipped bake, palette keys only), kit islands included; S9 render pass; garage plates re-shot (`pnpm plates:units`) | 5–8 days | **none**: a repaint is Blender work under the Meshy policy | ≈ 20 MB, fetched only when owned and selected |
| Dressing item | diorama JSON + `pnpm plate:host`; or a Blender plinth; or theme tokens | 0.5–3 days | only for a genuinely new object (a plinth ornament); announce the estimate first, prompts by a Fable agent at high effort | 0.1–2 MB |
| Voice set | recording or licensed source with redistribution rights; mix and level | 1–2 weeks plus the rights | none | ≈ 10–30 MB |
| Operation (free content) | campaign-designer → narrative-designer → level-scripter → mission-author → playtest, 3–5 missions | 2–4 weeks | per new unit or prop only | maps and data |
| Operation pass | 8–12 items from the rows above, themed | 1–2 weeks beside the operation | as above | as above |

Every generated asset carries AI disclosure in its PR and a row in `docs/ASSET_PROVENANCE.md`;
every piece of art passes `pnpm validate:meshes` like any other. New looks are mocked and the
numbers approved by the lead before any render (the art-numbers rule).

### 8.1 Cadence

| Rhythm | What | Effort |
|---|---|---|
| Launch (with ST7) | Sahar Dust plus 3 paid liveries, 12 badges, 4 dressing items | ≈ 4–5 weeks of art lane |
| Quarterly | one free operation (3–5 missions) and its pass | ≈ 4–6 weeks of one lane |
| Half-yearly | one new brigade livery | ≈ 1.5 weeks |
| Monthly | 2–4 badges | ≈ 1 day |

Nothing rotates out. No daily deals, no countdown, no "last chance" (revision 1 §5.4).

---

## 9. Legal and rating notes

None of this is legal advice and none of it is asserted as Valve's or a regulator's current
rule. Each line is a question for ST1 (#200), ST7 (#206) or counsel.

- **Loot boxes: none.** No paid random item exists to regulate (S3). That keeps the game out of
  the loot-box regimes some jurisdictions apply (Belgium, the Netherlands' earlier rulings) and
  off any "includes random items" rating notice.
- **Rating descriptors.** ESRB and PEGI both mark games that sell in-game items. Expect that
  descriptor and confirm it at the store page (ST4, #203).
- **Virtual currency display.** EU consumer authorities have published principles on in-game
  virtual currencies (the CPC network, 2024): show the real-money price, do not force leftover
  currency, do not obscure the cost. The plan already shows the cheapest covering pack's price
  (revision 1 Q9), and §6.2's multiples of 50 leave no orphan. Confirm the current text.
- **Refunds.** The coin spec §1.9 stands: opt in to Valve's 48-hour refund for unspent packs; a
  chargeback removes unspent coins first, then coin-bought entitlements newest first; earned
  entitlements are never touched.
- **Minors.** The game is a military setting. Whatever rating it gets, the store has no
  pressure mechanics: no timers, no streaks, no "friends bought this".
- **AI-generated content.** Steam asks developers to disclose AI-generated content on the store
  page. Every Meshy-made asset is already recorded in `docs/ASSET_PROVENANCE.md`, which is the
  source for that disclosure.
- **Licensing.** Code is PolyForm Noncommercial plus the CLA; art and data are all rights
  reserved; only the lead sells. A contributor-made cosmetic needs a separate written revenue
  agreement beyond the CLA before it is sold (D10).
- **Fiction.** Every item passes GDD §2: fictional insignia only, no real unit, faith, people or
  place, and enemies by doctrine only (T9).

---

## 10. Decisions for the lead

| # | Decision | Ruling (2026-10-11) or recommendation |
|---|---|---|
| D1 | **Keep single-player early access (1 Oct rulings) as a fenced lane, or close it?** | **Ruled: KEEP, fenced.** Single player only; coins unlock early only what play can also reach; never usable in a match against a person; never affects a score (§1.2). D4 is the one opt-in exception, in friends' rooms |
| D2 | **Coins never open a Conduct-gated unit** | **Ruled: REVERSED.** Coins **may** open the Conduct-gated units in single player. Trade-off recorded in §1.2: Conduct gating becomes skippable with money in single player. Guard S8 withdrawn; Conduct points, floors, forgiveness, rating and grade stay unsellable (S2, S6). This plan had recommended "yes, never" |
| D3 | **One statement of the economy.** Amend GDD §9, brigade spec D6/§4.6, `prices.md` §8 and revision 1 §1 to match, in one docs PR | **Ruled: yes, in this PR.** The coin shop spec's 1 Oct network ruling is amended too, since D4 overturns it |
| D4 | **What does "bring your brigade" bring?** | **Ruled: REVERSED. Everything the player owns, earned plus bought, in friends' rooms only, never public or ranked** (§5). Guard S5 rewritten as "never offered outside a friends' room". The network session (#518) has been told. This plan had recommended earned-only |
| D5 | **Where paid art lives** | **Ruled: DEFERRED** to the Steam stage; Steam DLC is one option. No R2 now: it needs a payment method the lead has declined. Until then no paid art ships (§7 release gates). This plan had recommended a private repo served from R2 |
| D6 | **Operations and passes** | *Recommended, not yet ruled:* **missions free, the pass is the cosmetic track only, 1,000 coins, one a quarter.** Any paid story episode, if ever wanted, pays zero credits (S12) |
| D7 | **Price bands and SKU shape** | *Recommended, not yet ruled:* **approve §6.2 as planning numbers**: multiples of 50 coins, brigade-wide liveries only at launch, packs unchanged from the coin spec; final prices at ST7 |
| D8 | **Cosmetics in matches** | *Recommended, not yet ruled:* **shown by default, with a "Show standard liveries" setting**; a ranked room may force standard. A livery the other client has not fetched by deploy draws as Sahar Dust |
| D9 | **First catalogue** | *Recommended, not yet ruled:* **3 paid liveries (Sur Winter, Naharin Olive, Ari'im Dress), 12 badges, 4 dressing items, KDF only**, built after ST6 and shipped with ST7. Voice sets and Sarim-seat cosmetics later |
| D10 | **Contributor-made cosmetics** | *Recommended, not yet ruled:* **not in the first catalogue.** When allowed, a written revenue agreement beyond the CLA comes first |

---

## 11. What would implement this (not now)

- **D3 is done in this PR:** GDD §9, brigade spec D6/§4.6, `prices.md` §8, revision 1 §1, and
  the coin shop spec's network ruling.
- **Stores, next touch:** its copy still says co-op and skirmish use only what each player
  earned (the intro line, `stores.state.coins.networkNote`, "Earn it for network play").
  Under D4 that holds for public and ranked rooms and not for a friends' room on "bring your
  brigade"; the strings say which.
- **Cosmetics v1** (after ST6): `cosmetic.schema.json` (S1), the import rule (S4), the
  determinism parity run (S6), the livery and badge gates (S9, S10), the renderer's alternate
  base-colour load path, and the Cosmetics shelf in the Stores.
- **Network N1:** the room `kind` and the `brigade` refusal outside friends' rooms (S5), the
  `brigade` seat built from the owned view, the lobby's cosmetic id exchange.
- **The Steam stage:** D5's paid-art storage, before any paid art ships.
- **ST6/ST7:** `store_item.schema.json` (S2, S3), `shipped.lock` (S11), the server-held coin
  balance and receipts, the removal of `?testcoins`.
