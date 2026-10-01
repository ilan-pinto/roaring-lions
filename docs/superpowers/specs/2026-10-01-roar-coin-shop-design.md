# The Roar coin shop and the coin — design (GH-317)

**Date:** 2026-10-01 · **Revised:** 2026-10-01, to the lead's rulings of 1 Oct (§0.1).
**Status:** draft for the lead. Design only: no money flows, no shipping code, and the sim is
untouched.
**Mock-ups:** `docs/superpowers/specs/2026-10-01-roar-coin-shop-mock.html` (self-contained;
open it in a browser).
**Extends:** WP-ST8 (`2026-09-28-st8-monetisation-content-plan.md`, #207) and G7 (#199).
**Waits on:** ST5 (#204, auth), ST6 (#205, server-held account), ST7 (#206, Wallet pipeline).
Money moves only once the account is server-held.

## 0. The rules this design serves

### 0.1 The lead, 30 Sep and 1 Oct

**30 Sep — early access.** Roar coins unlock early what the player can also earn with
credits, stars or Conduct: units, building abilities (field works, #277), and the rest of the
earned path. The earned path stays free and complete.

**1 Oct — the rulings, which replace this spec's first draft (Option B, "the advance").**

1. **Coins buy everything credits buy.** That means:
   - early unit unlocks;
   - the bought-only special forces (E5: `recon_zikit`, `demo_tzav`, `heli_peten_gunship`);
   - upgrade tiers.

   In the lead's words: *"Whenever you have coins, your advance is faster across the board."*
2. **Coins replace the credit cost.** An item paid in coins costs no credits, and the player
   keeps their credits. It is not an advance and nothing is settled later.
3. **Network play uses only what each player earned.** Co-op and skirmish ignore everything
   bought with coins.

### 0.2 These rulings amend ST8, so the amendment is written down

ST8 (approved 29 Sep) says:
- Roar coins buy **only cosmetics** (§1 rules 4–5);
- no row shows both currencies (§4);
- units and tiers are **never sold** (§7).

The 1 Oct rulings overturn those lines. Everything else in ST8 stands:
- two currencies;
- **credits are never sold**, and coins never convert into a credit balance;
- no Conduct points, stars or grades;
- no loot boxes, no trading;
- the T1–T11 test for cosmetics.

The amendment text is in §1.8 and lands with this spec.

## 1. Economy

### 1.1 What the earned path pays today: measured

The figures come from `pnpm playtest`, run on `origin/main` at `fc0fc13e` on 2026-10-01. That
is the optimal-play ladder: 26 missions in `world.json` order, and `LADDER_CREDITS` = **5,849**,
matching the pin.

| figure | value | source |
|---|---|---|
| credits, whole campaign | **5,849** | `credit ladder: 5849 over 26 missions` |
| credits per mission | mean **225**, min 159, max 310 | the 26 `<mission>: credits N` lines |
| cumulative after mission 1 / 4 / 8 / 14 / 18 / 26 | 217 / 977 / 1,916 / 3,279 / 4,268 / 5,849 | running sum |
| star gates open (measured) | `breach_team` after mission **5**, `scout_shachaf` after **13**, `apc_kipod` after **19** | `gate … OPEN after mission N` |
| Conduct gates (70–90) | all nine open after mission **1** on this ladder | `gate … (Conduct floor N)` |
| mission length | `target_minutes` 5–7; **no real-player duration has ever been measured** (CLAUDE.md) | mission schema |

**The hour figures are an assumption, and they are labelled as one wherever they appear.** A
mission is taken to be **~10 minutes** of wall clock: the 5–7 minute target, plus the briefing,
the deploy and the debrief. On that basis a campaign is ~4.3 hours.

The priced catalogue: everything credits buy, from `data/units/kdf/*.json`, the staged E5 JSON
and the field-commanders spec.

| class | items | credit prices | total credits |
|---|---|---|---|
| earned-or-bought units | 12 (9 Conduct-gated, 3 star-gated) | 220–3,200 | 9,730 |
| upgrade tiers | 147 rungs over 17 types | 25–950 | **34,965** |
| E5 special forces (bought only, staged) | 3 | 4,250 / 6,500 / 8,000 | 18,750 |
| field commanders (designed, not shipped) | 4 | 1,200 / 1,500 / 1,800 / 2,400 | 6,900 |
| field works (#277) | 4 KDF works | no gate or price yet (Stage 5, G-NUM) | — |
| **catalogue** | **166 items** | | **70,345** |

### 1.2 Finding F1: play cannot reach most of what coins would sell

`payMission` (`packages/app/src/brigade-account.ts`) pays **only improvement**. Its `paid`
record lives in the brigade account, and that account **survives a fresh campaign** (brigade
D4). So a second campaign pays nothing for any mission it does not beat. **Lifetime earned
credits are bounded by one campaign: ≈ 5,849, about 8% of the catalogue.** Two consequences:
- `demo_tzav` (6,500) and `heli_peten_gunship` (8,000) each cost more than a lifetime pays;
- maxing one tank's three upgrade tracks (`mbt_lavi`, 5,150) uses 88% of it.

Under the 1 Oct rulings, coins buying these items is the intended "faster across the board".
But an item play cannot reach becomes **coin-exclusive in practice**, which breaks the 30 Sep
rule that the earned path stays complete. It also leaves network play, which counts only
earned items, permanently short of most of the catalogue. **This is a decision (§5, D3)**, and
the recommendation is to restore reachability before coins go live:

| option | what it does | effect |
|---|---|---|
| **R1. A fresh campaign resets `paid` (recommended, with R2 later)** | each campaign pays in full again; within a campaign, replay still pays improvement only (D2 unchanged) | catalogue reachable in **70,345 ÷ 5,849 ≈ 12 campaigns ≈ 52 hours** (10-minute assumption). One line in `payMission`'s caller, owned by the balance analyst |
| R2. New earned sources | skirmish and co-op payouts (network games, so earned by definition), operations (ST8 §3) | spreads the 52 hours over more modes. Needs those modes, so it comes later |
| R3. Lower catalogue prices | rescale tiers and E5 toward one lifetime | breaks the cost-curve fits (`upgrades.md`, E5 `numbers.md`); not recommended |
| R4. Accept | coin-exclusive in practice | contradicts the 30 Sep rule; not recommended |

**Guard G1** (§1.7) carries this into the shop. An item is sellable for coins only while a
measured instrument shows play can reach it. Since money waits on ST5–ST7 anyway, R1 has time
to land first.

### 1.3 The exchange rate: three options

Coins replace credits at a fixed rate. Every item's coin price is
`ceil(credits ÷ rate)`, rounded **up** to a multiple of 5. The totals below are computed over
all 166 items.

| | **A. 1 coin = 5 credits** | **B. 1 coin = 10 credits (recommended)** | **C. 1 coin = 20 credits** |
|---|---|---|---|
| whole catalogue, in coins | 14,400 | **7,395** | 3,910 |
| whole catalogue, in money (packs below) | ≈ $120 | **≈ $60** | ≈ $35 |
| one campaign's pay (5,849 cr), in coins | 1,170 | **585** | 295 |
| the $4.99 pack (500 coins) buys | 2,500 cr ≈ 11 missions of pay (~2 h) | **5,000 cr ≈ 22 missions, 85% of a campaign (~3.7 h)** | 10,000 cr ≈ 1.7 campaigns |
| reads as | coins slower than playing well | **one pack is a real jump; the catalogue is a real spend** | one small pack outbuys a whole campaign: trivially cheap |

**B, item prices** (credits → coins):

| item | credits | coins |
|---|---|---|
| `recon_drone` | 220 | 25 |
| `mbt_lavi` | 720 | 75 |
| `breach_team` | 850 | 85 |
| `scout_shachaf` | 1,800 | 180 |
| `apc_kipod` | 3,200 | 320 |
| `recon_zikit` | 4,250 | 425 |
| `demo_tzav` | 6,500 | 650 |
| `heli_peten_gunship` | 8,000 | 800 |
| an upgrade rung | 25–950 | 5–95 |
| the four officers | 1,200–2,400 | 120–240 |

By class, B comes to:
- tiers 3,830 coins;
- E5 1,875;
- units 1,000;
- officers 690.

**Why B.**
- **The whole catalogue at ≈ $60 is not trivially cheap.** Against the market (web, retrieved
  2026-10-01, Sources) it sits above Steel Division 2's History Pass ($34.99) and above two
  Company of Heroes 3 expansions ($24.99 each). That is because it is the largest bundle of
  game-changing items this game sells, and every one is still earnable.
- **One $4.99 pack is a meaningful jump**: 85% of a campaign's pay, landing in one go.
- C undercuts play so far that the earned path stops mattering. A undercuts the coins.

### 1.4 Packs and Steam Wallet (rate B)

| pack | coins | bonus | price (USD; Valve sets regional) | ≈ credits | net after Valve's 30% (ST7's figure) |
|---|---|---|---|---|---|
| Patrol | 500 | — | $4.99 | 5,000 | ≈ $3.49 |
| Company | 1,100 | +10% | $9.99 | 11,000 | ≈ $6.99 |
| Brigade | 2,400 | +20% | $19.99 | 24,000 | ≈ $13.99 |
| Division | 6,500 | +30% | $49.99 | 65,000 | ≈ $34.99 |

- **No orphans.** Every pack is a multiple of 100 and every price a multiple of 5, so a
  remainder always buys something (ST8 §5.2). The cheapest items are 5-coin upgrade rungs.
- **Division + Company (7,600 coins, $59.98) covers the whole catalogue (7,395).** There is no
  larger pack, because the catalogue cannot absorb one.
- **Fraud limit (ST6).** For its first 24 hours a new account can buy the Patrol and Company
  packs only. ST6 names a brand-new account buying the largest package as the pattern that
  matters.
- **Bonuses are fixed and permanent.** No first-purchase doubler, no timer, no "sale ends"
  (ST8 §5.4).
- The 4.99 / 9.99 / 19.99 / 49.99 ladder is the common Steam free-to-play convention. That is
  a general observation, not a sourced figure. Regional prices follow Valve's suggested table
  at ST7.

### 1.5 The account: earned and coin-bought, held apart (for ST6 to enforce)

Every entitlement carries its **source**, and the network rule reads nothing else. Today the
brigade account stores `unlocks: string[]` and `upgrades[unit][track] = tier`. ST6's
server-held account splits both:

```
entitlements: {
  units:    { [unitId]: { earned: boolean, coins: boolean } },
  upgrades: { [unitId]: { [track]: { earned: number, coins: number } } }   // tier reached on each path
}
receipts: [ { id, at, item, coins, creditsEquivalent, state, steamOrder? } ]
roarCoins: number            // server-authoritative balance; never a client field
```

- **`earned`** is set by play only:
  - a gate opening (stars, Conduct, story; `unlockReason`);
  - a credit purchase (`buyUnlock`, `buyUpgrade`). Credits are earned, so whatever they buy
    is earned.
- **`coins`** is set only by a server-confirmed coin purchase (ST7's `FinalizeTxn`, then the
  debit). No client path writes it, exactly as no client path writes a `granted` credit
  today.
- **Single-player** (campaign, sandbox) uses `earned OR coins`, and for a tier,
  `max(earned, coins)`.
- **Network** (co-op, skirmish, any later 1v1) uses **`earned` only**. The pre-pass
  (`applyUpgrades`, brigade D5) takes the tier map the mode hands it, so the sim never learns
  either word and the determinism hash cannot tell them apart. The server builds the network
  loadout itself; the client's copy is display only.
- **Tiers are bought in order on each path.** A coin-bought tier 3 over an earned tier 1 plays
  as tier 3 offline and tier 1 online. The garage shows both rungs (§2.2).
- **Credits are never touched by coins.** Paying in coins debits `roarCoins` only, so
  `balance` stays "earned grants minus credit spending" (the G4 invariant).

### 1.6 Bought with coins, then earned

There are three cases, and one rule covers all of them: **the item gains `earned: true`, and
no coins come back.**

| case | what happens | why |
|---|---|---|
| A gate opens on something bought with coins (e.g. `scout_shachaf` at 30 stars) | `earned` flips to true automatically; it now counts online | play reached it; nothing to charge or refund |
| A credit-only item the player wants online (an E5 unit, a tier) | the card offers **"Earn it for network play: 3,200 credits"**; paying sets `earned` | credits are the earned path for these; the player chooses whether network play matters to them |
| The player could already afford it in credits when buying with coins | the confirm says so first ("You have 3,400 credits, enough to earn this") | honesty, not a block: the lead's ruling is that coins replace credits |

**Rejected: refunding coins when the item is later earned.** It would turn every coin purchase
into a deposit that play pays back, the opposite of "faster across the board". It would also
make a player's coin balance depend on their star count. The coins bought the item **sooner**.
Once it is earned, the receipt records that ("Earned on gate after mission 13; bought with
coins 8 missions earlier").

### 1.7 Guards

Each guard is written so it can fail.

| # | guard | ties to | how it is checked |
|---|---|---|---|
| G1 | **Reachable by play.** An item is sold for coins only while play can reach it in finite play (after R1: across campaigns) | 30 Sep: never exclusive | a catalogue spec walks the measured ladder against each price and fails on an unreachable item |
| G2 | **Network is earned-only.** No coin-sourced entitlement enters a co-op or skirmish loadout | 1 Oct ruling 3 | a loadout test with a coin-only account fields base units and base tiers; mutation: read `earned OR coins` → red |
| G3 | **Coins never become credits.** No coin path writes a credit grant, and `balance` never rises from a coin purchase | ST8 rule 2, G7 | an account invariant over grants and spending |
| G4 | **Score-blind.** Stars, grade, Conduct and `creditsFor` compute exactly as for any fielded unit. Conduct points, floors and stars are never items | G7 (#199) | today's six `(gate open)`/`(bought)` probes move **stars by 0** and credits by +0 to +33 a mission; the probe stays pinned |
| G5 | **Mission rules win.** A mission's build allow list (e.g. #277's no intel centre on a tunnel mission) and `gate_only` placements ignore coin entitlements, as they ignore credit ones | the earned path is not reshaped | `resolveUpgrades` and the allow list read no source field |
| G6 | **Known, kept, not random.** The exact item and both prices are shown before payment. No loot, no expiry, no countdown | ST8 T7, T8 | unchanged |
| G7 | **The honest line is computed.** "Earned free in ~N missions" comes from the account, never from copy | honesty | one function feeds the line and the card |

A note on Conduct gates. `unlockReason` already lets a credit price open a Conduct-gated unit
(`unlock.ts`, "a price opens the gate"). Coins do the same and no more. What stays unsellable
is Conduct itself: points, floors and forgiveness.

### 1.8 The ST8 amendment (text to land with this spec)

- **§1 rule 4** becomes: "Roar coins buy cosmetics, and **anything brigade credits buy** —
  unit unlocks, bought-only units and upgrade tiers — at a fixed rate, in place of the credit
  cost (spec 2026-10-01)."
- **§1 rule 5** becomes: "Roar coins buy no brigade credit, no Conduct point, floor or
  forgiveness, no star and no grade. A coin purchase never changes the credit balance.
  **Co-op and skirmish use only what was earned**; a coin-bought entitlement is single-player
  only."
- **§1.1:**
  - T2–T4 apply to cosmetics only.
  - A credit-catalogue item sold for coins is checked against G1–G7 instead.
  - T5–T11 still apply to every item.
- **§4:** the Stores shows **both prices** on every credit-catalogue item (credits and Roar
  coins). The brigade board shows the credit price and a link to the Stores. Neither header
  shows the other currency's balance.
- **§5.2:** item prices are multiples of 5 coins and packs multiples of 100.
- **§7:** "Units", "Upgrade tiers" and E5's bought-only units move from *never sold* to *sold
  for coins, single-player only*. "Brigade credits", "Stars, grades, Conduct …" and every
  other line stand.

### 1.9 Refunds (Steam constrains this)

Steam's published policy (web, retrieved 2026-10-01; Sources):
- in-game purchases in Valve's own games are refundable within 48 hours if not consumed,
  modified or transferred, and **third-party developers may opt in** on the same terms;
- unused **Steam Wallet funds** are refundable within 14 days.

Recommended:
1. **Opt in to the 48-hour refund for unspent coin packs.**
2. **A coin purchase is refundable in coins within 48 hours** if the unit has not been fielded
   in a mission, or, for a tier, no mission has been played since buying it. Fielding or
   playing counts as consumed.
3. **Chargeback or Valve-side reversal:** unspent coins are removed first. If they were spent,
   the coin-sourced entitlements they paid for are revoked, newest first. **Earned
   entitlements are never touched.**
4. **ST7 confirms** how Valve's refund notice reaches the backend. Nothing here is asserted
   about Valve beyond the published page.

## 2. The shop screen

### 2.1 Where it lives: a garage tab (recommended)

| | **Garage tab, "Stores"** | main-menu entry |
|---|---|---|
| beside the earned path it shortcuts | **yes**: same unit cards, same progress figures | no |
| matches ST8 §4 ("the Stores", its own tab and header) | **yes** | no |
| pressure | low: the player comes to the garage to spend earned credits first | a store on the title screen sells before anyone has played |

**Recommended: the garage tab.** The main menu gets no shop button. The Stores has three
shelves: **Brigade** (units, E5, tiers), **Cosmetics** (ST8) and **Receipts**. Its header shows
the Roar coin balance and the Wallet top-up. The credit balance appears only as the "you have"
figure on a card, never in the Stores header (ST8 §4).

### 2.2 Item states

Every card shows **both prices** and the earned path's progress.

| state | what the card says | controls |
|---|---|---|
| **Earned** | "Earned — after mission 5" or "Earned — bought with credits". Counts in network play | none; a link to the brigade |
| **Bought with coins** | "Bought with 320 Roar coins. Single-player only". The earned path's progress, e.g. "Earn it for network play: 31 of 44 stars, or 3,200 credits" | "Earn it with credits" when affordable; "Refund (48 h, not yet fielded)" |
| **Affordable in credits** | "3,200 credits (you have 3,400) · or 320 Roar coins". The honest line: "Earned free in ~6 missions" when a gate exists | "Buy · 3,200 credits" (primary, earned) and "Buy · 320 Roar coins" |
| **Locked** | "3,200 credits (you have 1,240) · or 320 Roar coins". The honest line: "Earned free in ~13 missions (18 of 44 stars), or about 9 missions of pay" | "Buy · 320 Roar coins"; the credit button shows the shortfall, disabled |

A tier card shows the two paths as two rows of pips: **earned** (solid, `--commend`, as in the
garage today) and **coins** (hollow, `--roar`). The rung that plays online is always the
earned one, and the card says so.

**G1 holds until R1 or R2 lands.** Until then, an item play cannot reach shows "Not yet
reachable by play — not sold" in place of the coin button.

### 2.3 Confirmation and receipts

**Confirm** reuses `confirmDialog` (`ui/confirm.ts`: one open dialog, focus-trapped, closed by
the router on leave). It reads, in order:
1. the item;
2. the price in coins and the credits it replaces ("320 Roar coins, in place of 3,200
   credits; your credits stay as they are");
3. the honest line ("You would earn it free in ~13 missions");
4. **"Single-player only. Co-op and skirmish use what you earn"**;
5. the money equivalent: the cheapest covering pack (ST8 Q9);
6. the 48-hour refund window.

The buttons are **"Buy with coins"** and **"Not now"**, and "Not now" holds focus by default.

**Receipts.** One row per purchase, kept forever, newest first:
- date and time;
- item;
- coins paid;
- credits replaced;
- the outcome when it comes ("Earned on gate after mission 13", "Earned with credits",
  "Refunded, 320 coins");
- the server order id.

Pack purchases show the pack, the coins and the Steam transaction reference. Money amounts
come from Steam, never from the client.

### 2.4 The honest line

The line is computed (G7) and counts **missions**, not hours. Examples:
- "Earned free in ~2 missions";
- "Earned free in ~13 missions (18 of 44 stars)";
- "Earned free once your Conduct reaches 85 (now 82)";
- "About 9 missions of pay in credits".

A Conduct gate gets no mission estimate when the average sits below its floor, because
Conduct is behaviour, not time. For an item no gate opens (E5, tiers), the line is the credit
path alone.

### 2.5 Strings (every one through `t()`)

New keys sit under `stores.*` in `en.json`:
- shelves and tabs: `stores.tab`, `stores.shelf.brigade`, `.cosmetic`, `.receipts`;
- the wallet: `stores.wallet.word` ("{n, plural, one {Roar coin} other {Roar coins}}");
- states: `stores.state.earned`, `.earnedBy.gate`, `.earnedBy.credits`, `.coins`,
  `.coins.networkNote`, `.affordable`, `.locked`, `.unreachable`;
- the two-price line: `stores.price.both`, `stores.price.have`;
- the honest line: `stores.honest.missions`, `.stars`, `.conduct`, `.credits`;
- buy buttons: `stores.buy.credits`, `stores.buy.coins` and their `.aria` forms;
- `stores.earnForNetwork`;
- the confirm: `stores.confirm.*`;
- `stores.refund`, `stores.receipt.*`, `stores.offline`, `stores.mock`.

Two rules apply, both from `CLAUDE.md`:
- no label table is resolved at module load;
- every Stores string must appear bracketed in the pseudo-locale capture.

The noun always sits beside the number, so a bare figure is never a price.

### 2.6 Accessibility

- **Keyboard:** roving tabindex over shelf, cards and buttons (the garage's F8 pattern), and
  Enter opens the confirm.
- **Screen reader:** each card's state reads as a sentence ("Kipod APC. Bought with coins.
  Single-player only. 18 of 44 stars toward earning it.").
- **Colour vision:** the two currencies differ in shape (the hex coin glyph versus the word
  "credits") as well as colour, and earned pips are solid while coin pips are hollow.
- **Reduced motion:** the purchase animation becomes an instant state change.
- **Scaling:** `--ui-scale` and `--text-size` apply.
- **Focus** returns to the card after a purchase.

### 2.7 Before the account is server-held (ST5–ST7)

- **Production builds show no Stores tab and no coin anywhere** until the server account
  answers. A client-side coin balance "is a suggestion, not a balance" (ST6), and ST8 Q2 makes
  coins unearnable in play.
- **A dev mock** (proposed flag `&shop=mock`, entered in `sandbox-help.ts`'s table if built)
  draws the Stores from the real catalogue and the real honest lines, with a balance of **0**,
  every coin button disabled, and a banner: "The Stores open when your account is online."
  The lead judges the screen there before any money path exists.
- **Offline after launch:** coin entitlements already confirmed stay usable in single-player
  from the cached account, receipts are read-only, and new purchases wait for the reconnect.

## 3. Visual identity

### 3.1 Register: the coin must not look earned, or look like credits

- No earned signs (ST8 T6): no stars, no chevrons, no `--commend` gold, no kit Stars of David,
  no rank slip.
- A different shape and colour from credits (ST8 §4). Credits are a figure in `--commend`
  (`dust.0`) with no glyph.
- It must not read as the **Ari'im lion-head patch** sold as a badge (ST8 §2.2: roundel,
  shield, tab).

**Colour: copper, the terracotta ramp.** These are new semantic tokens in `theme.css`, mapped
from palette keys only:

| token | palette key | use |
|---|---|---|
| `--roar` | `terracotta.0` | coin face, coin prices, the Stores accent |
| `--roar-mid` | `terracotta.1` | relief, mane |
| `--roar-deep` | `terracotta.2` | rim, the 16 px line art |
| `--roar-hi` | `limestone.1` | glint, the 48 px highlight |
| `--roar-ink` | `shadow.1` | the mouth, an outline on light grounds |

Terracotta is not a team, VFX or group colour. It stays apart from `--commend` in
**lightness** as well as hue: luma ≈ 125 against ≈ 189 for `dust.0`, a gap that survives all
three CVD simulations. Confirm it with `tools/src/cvd.test.ts`'s method when the token lands.

### 3.2 Three emblem directions (SVG in the mock)

**A, Roaring Roundel.** A front three-quarter lion face with jaws open; the mane is a notched
rim on a round coin.
- Strong at 48 px.
- At 16 px it collapses to a brown disc with a hole.
- The roundel is the Ari'im patch's own frame.

**B, Hex Seal (recommended).** A pointy-top **hexagon** coin bearing a lion's head **in
profile, roaring left**, struck as one flat silhouette with the mane as a jagged back edge.
- The hexagon is the campaign board's own shape.
- It is none of the patch's frames, and it cannot be mistaken for a star.
- The silhouette survives 16 px.

**C, Mane Burst.** Twelve mane rays around an open-jaw glyph.
- The most legible at 16 px.
- But rays around a centre read as a star or a medal, which is the earned register (T6).

### 3.3 The coin icon at 16 / 24 / 48 px

- **16 px** (inline prices, the wallet): the hex in `--roar-deep` with the lion silhouette in
  `--roar` and the mouth as one cut-out. No eye, no rim, no gradient. It is drawn
  pixel-aligned as its own SVG, not scaled down from 48.
- **24 px** (cards, buttons): adds the rim, the mane notches and the eye.
- **48 px** (the confirm, receipts, the Stores header): the full strike, with a raised rim,
  the mane in `--roar-mid`, a `--roar-hi` glint on the upper-left facets (the sun's side) and
  teeth.

All three are SVG in the DOM, like the kit sign (`kitIconSignHtml`), so both renderers draw
them identically. The coin is never drawn in the world.

### 3.4 The Stores' look, the purchase animation and the sound

**Look.** The Stores uses the garage's own panel:
- `--panel-bg`, `--panel-frame` and `--panel-rule`;
- the `--font-display` header and the mono wallet;
- the garage card.

The coin's register is `--roar`. Credit figures keep `--commend` wherever they appear,
**including beside a coin price**, so each currency always wears its own colour. "Earned" uses
`--good`, and states that are not for sale use `--ink-dim`.

**Purchase animation** (700 ms or less, on `--ease`), in four steps:
1. the 48 px coin drops onto the card's corner (120 ms);
2. it turns once by **60°**, one hex face (250 ms);
3. a `--roar-hi` glint sweeps across it (160 ms);
4. the card flips to *Bought with coins* (170 ms).

Meanwhile the wallet counts down in mono and the credit figure on the card **does not move**,
which shows that coins replaced credits. Under reduced motion the change is instant and
static.

**Sound brief.** One cue of 600 ms or less:
- a **struck copper coin**: a low metallic thunk, not a bright jingle;
- under it, a **short low growl tail** at about −12 dB;
- mono-compatible, at the SFX level, with no music ducking;
- **distinct from the credit-purchase cue** (S3g item 5).

The source needs explicit redistribution rights (CLAUDE.md), and choosing it is **the lead's
call**.

### 3.5 A 3D coin: Blender first, Meshy only if wanted

The coin is a hexagonal prism with a relief, so **Blender builds it from the 48 px SVG** for
**0 credits**: import the curve, extrude, bevel the rim, apply the terracotta ramp.

If the lead wants a sculpted relief, this is the brief for the later Fable agent. **Meshy is
not called by this design.**

> *Prompt (text-to-3D):* "A single hexagonal coin, pointy-top hexagon, thick raised rim,
> centre relief of a lion's head in profile facing left with jaws wide open roaring and a
> jagged mane, struck metal, copper, simple game-asset style, centred, no text, no
> background, no other objects."
>
> *Settings:* one preview at low poly (≈ 3,000 triangles), then one refine only if the bake is
> wanted as-is; otherwise repaint from the palette in Blender.

*Estimate:* preview 20 credits plus refine 10, so **30 credits** (≈ $0.60 at the unverified
$0.02 a credit), capped at **60** to allow one re-roll. The coin also needs AI disclosure per
CONTRIBUTING.md and a row in `docs/ASSET_PROVENANCE.md`.

## 4. What implementation would touch (not now)

- **Server (ST6):**
  - `roarCoins`;
  - `entitlements` with an `earned`/`coins` source per unit and per track (§1.5);
  - `receipts`;
  - the network loadout built from `earned` alone.
- **Brigade account:** `unlocks` and `upgrades` gain a source. `payMission` gains R1's
  per-campaign reset if D3 is taken (the balance analyst's call). Nothing writes a credit from
  coins.
- **App:** the Stores tab in `ui/brigade.ts`'s screen, `stores.*` strings, the `--roar` tokens,
  the coin SVGs, and the mode-aware tier map handed to `applyUpgrades`.
- **Sim:** nothing. The sim never learns that coins, sources or prices exist (invariant 4,
  brigade D5).
- **Gates added with it:**
  - G1 reachability over the ladder;
  - the G2 network-loadout test;
  - the G3 account invariant.

  Each arrives with a mutation that turns it red (CLAUDE.md).

## 5. Decisions for the lead

The 1 Oct rulings (coins buy everything credits buy, coins replace the credit cost, network
is earned-only) are taken as settled. These remain open:

| # | decision | recommended default |
|---|---|---|
| 1 | **The exchange rate** | **B: 1 Roar coin = 10 credits**, prices rounded up to 5 coins (whole catalogue 7,395 coins ≈ $60; one campaign's pay ≈ 585 coins) |
| 2 | **Pack prices** | **500 / 1,100 / 2,400 / 6,500 Roar coins at $4.99 / $9.99 / $19.99 / $49.99** (bonus 0 / 10 / 20 / 30%); no larger pack; new accounts limited to the first two packs for 24 h |
| 3 | **Reachability (F1)** | **Ask the balance analyst to land R1: a fresh campaign resets `paid`, making the catalogue reachable in ~12 campaigns (~52 h)**, with skirmish and co-op payouts (R2) later. Until it lands, G1 keeps unreachable items off sale for coins |
| 4 | **Bought with coins, then earned** | **The item gains `earned`; no coins come back.** A gate flips it automatically, and credit-only items offer "Earn it for network play" for their credit price |
| 5 | **How the account separates sources** | **`earned`/`coins` per unit and per upgrade track, server-held (ST6); network reads `earned` only** |
| 6 | **The ST8 amendment** (§1.8) | **Land it with this spec** |
| 7 | **Where the shop lives** | **A garage tab, "Stores"** (Brigade, Cosmetics, Receipts); no main-menu button |
| 8 | **The emblem** | **B, Hex Seal**: a profile lion roaring on a hexagon, in the terracotta ramp (`--roar` = `terracotta.0`) |
| 9 | **Refunds** | **Opt in to Steam's 48 h for unspent packs; a coin purchase is refundable for 48 h until fielded or played; chargebacks revoke unspent coins first, then coin entitlements newest-first, and never touch earned ones** |
| 10 | **Before ST5–ST7** | **No Stores tab in production; a `&shop=mock` dev view with a zero balance and disabled coin buttons** |
| 11 | **The purchase sound's source** | a recorded or synthesised copper strike with a low growl tail, with explicit redistribution rights; the lead names the source |
| 12 | **3D coin** | **Blender from the SVG, 0 credits**; Meshy (≈ 30 credits, cap 60) only for a sculpted relief |

## Sources (web, retrieved 2026-10-01)

- Steam refund policy (in-game purchases, Wallet funds): <https://store.steampowered.com/steam_refunds/>
- Company of Heroes 3 DLC prices (expansions $24.99; Hammer & Shield battlegroup pack $13.99): <https://steampulse.org/dlc/4095900>, <https://sysrqmts.com/prices/company-of-heroes-3-fire-steel>
- Steel Division 2 DLC prices (History Pass $34.99; campaign DLCs $14.99–$16.99): <https://steampulse.org/dlc/988171>, <https://steampulse.org/dlc/1165510>, <https://steampulse.org/dlc/1307600>
- Total War: Warhammer III legendary-lord pack ($8.99): <https://www.pcgamesn.com/total-war-warhammer-3/dlc-price>

Every other number here was measured in this repository on 2026-10-01, or is stated as an
assumption.
