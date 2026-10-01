# The Roar coin shop and the coin — design (GH-317)

**Date:** 2026-10-01 · **Status:** draft for the lead. Design only: no money flows, no shipping
code, and the sim is untouched.
**Mock-ups:** `docs/superpowers/specs/2026-10-01-roar-coin-shop-mock.html` (self-contained;
open it in a browser).
**Extends:** WP-ST8 (`2026-09-28-st8-monetisation-content-plan.md`, #207), G7 (#199).
**Waits on:** ST5 (#204, auth), ST6 (#205, server-held account), ST7 (#206, Wallet pipeline).
Money moves only once the account is server-held.

## 0. The rule this design serves (lead, 30 Sep)

**Early access only.**

- Roar coins unlock **early** what the player can also earn with credits, stars or Conduct:
  units, building abilities (field works, #277), and the rest of the earned path.
- It is a time-saver, **never exclusive**. The earned path stays free and complete.
- Co-op and skirmish use **only what each player earned**.

### 0.1 This rule amends ST8, and the amendment has to be written down

ST8's rule (approved 29 Sep) says Roar coins buy **only cosmetics** and **no unit, no upgrade**
(§1 rules 4–5). Its §4 says no locked unit ever reads "or N Roar coins", and §7 lists units
and upgrade tiers as never sold. The 30 Sep rule overturns those lines for one new class of
item, the **early-access advance** (§1.2). Everything else in ST8 stands. That includes two
currencies, credits never sold, no Conduct points, no loot boxes, no trading, and the T1–T11
test for cosmetics. The amendment text is in §1.7. It lands with this spec, so ST8 and this
document never disagree.

## 1. Economy

### 1.1 What the earned path pays today: measured

All figures are from `pnpm playtest`, run on this branch (`origin/main` at `fc0fc13e`) on
2026-10-01. The ladder is the optimal-play proof: 26 missions in `world.json` order, and
`LADDER_CREDITS` = **5,849**, matching the pin.

| figure | value | source |
|---|---|---|
| credits, whole campaign | **5,849** | `credit ladder: 5849 over 26 missions` |
| credits per mission | mean **225**, min 159 (`wadi_halam_5_depot`), max 310 (`khan_rafid_1_recon`, `qarn_hadid_1_recon`) | the 26 `<mission>: credits N` lines |
| cumulative after mission 1 / 4 / 8 / 14 / 18 / 26 | 217 / 977 / 1,916 / 3,279 / 4,268 / 5,849 | running sum |
| star gates open (measured) | `breach_team` after mission **5**, `scout_shachaf` after **13**, `apc_kipod` after **19** | `gate … OPEN after mission N` |
| Conduct gates (70–90) | all nine open after mission **1** on this ladder | `gate … (Conduct floor N)` |
| mission length | `target_minutes` 5–7; **no real-player duration has ever been measured** (CLAUDE.md) | mission schema |

**The hour figure is an assumption, and it is labelled as one everywhere it appears.** One
mission is taken as **~10 minutes** of wall clock: the 5–7 minute target, plus the briefing,
deploy and debrief. On that assumption, a campaign is ~4.3 hours. The shop never prints hours
for this reason. It prints **missions**, which the account can count exactly (§2.4).

Current prices, from `data/units/kdf/*.json` and the staged and designed packages:

| class | items | credit prices | total |
|---|---|---|---|
| earned-or-bought units | 9 Conduct-gated (`recon_drone` … `mbt_lavi`) | 220–720 | 4,880 |
| | 3 star-gated (`breach_team`, `scout_shachaf`, `apc_kipod`) | 850 / 1,800 / 3,200 | 5,850 |
| upgrade tiers | 147 rungs over 17 types | 25–950 | **34,965** |
| E5 special forces (bought only, staged) | `recon_zikit`, `demo_tzav`, `heli_peten_gunship` | 4,250 / 6,500 / 8,000 | 18,750 |
| field commanders (designed, not shipped) | Maya, Yoav, Dalia, Ronen | 1,200 / 1,500 / 1,800 / 2,400 | 6,900 |
| field works (#277) | 4 KDF works | no gate or price yet (Stage 5, G-NUM) | — |
| **credit catalogue** | | | **≈ 70,345** |

### 1.2 Finding F1: today the earned path cannot reach most of the credit catalogue

`payMission` (`packages/app/src/brigade-account.ts`) pays **only improvement**. Its `paid`
record lives in the brigade account, which **survives a fresh campaign** (brigade spec D4).
A second campaign therefore pays nothing for a mission it does not beat, so a player's
**lifetime** credits are bounded by one campaign's ceiling: about 5,849, plus the few hundred
a ★★★ re-run adds. That is **~8% of the ≈ 70,345 catalogue**. `demo_tzav` (6,500) and
`heli_peten_gunship` (8,000) each cost more than a whole lifetime pays.

This bears directly on the rule. **An item the earned path cannot reach is not early access.
Selling it is selling it exclusively.** The upgrades study's line that maxing every track
takes "several campaigns' worth of earning" (`upgrades.md` §6.3) is true of the prices but
false of the payout rule. One concrete fix: reset `paid` on a fresh campaign, so a second
campaign pays again. That makes the catalogue reachable in about **12 campaigns (~52 hours
on the 10-minute assumption)**. But that is an economy change, and it belongs to the
balance analyst and the lead, not to this shop. Until it is decided, guard **G1** (§1.6)
keeps every item the earned path cannot reach **out of the shop**.

### 1.3 The three models, each priced

The shop has to answer three questions: what a coin buys, whether it frees credits, and what
happens when the item is later earned. The options below differ on exactly those.

**Option A — Flat unlock.** Coins buy the item permanently, exactly as a credit purchase
does, at a fixed price per item: **1 coin ≈ 8 credits**, rounded to 25, with a floor of 50.
Examples: `recon_drone` 50, `mbt_lavi` 100, `breach_team` 100, `scout_shachaf` 225,
`apc_kipod` 400.
*Weakness:* every coin spent on a unit **frees the credits** the player would otherwise have
spent on it, and those credits go into upgrade tiers. So coins become credits one step
removed, at a fixed rate. That is precisely what G7 rejected. The rule's "early" also means
nothing here: the price is the same at mission 1 and at mission 18.
Packs: 500 / 1,000 / 2,000 coins at $4.99 / $9.99 / $19.99, no bonus.

**Option B — The advance, priced by time saved. (Recommended.)** Coins open the item **now**.
The item still costs its **credit price**: the brigade **settles that price from the next
mission payouts** (100% of each payout, oldest advance first) until it is paid. The advance
ends the moment either of these happens:
- the credits settle. The item then becomes a normal credit purchase: earned, and permanent
  across campaigns (brigade D4).
- the earned gate opens first (stars, Conduct, story). Any credits already withheld are
  **released back to the balance**, because they were earned credits and never coins, and
  the item is earned on its gate, like anyone else's.

From that point the player is **identical** to a player who never paid. The coin bought
exactly the missions in between, and nothing else.
- Coins never free a credit.
- Coins never become one.
- Coins never touch stars or Conduct.

The price is set by the **missions saved**, measured for this player at this moment (§1.4),
not by the unit's power.
Packs: **500 / 1,050 / 2,200 coins at $4.99 / $9.99 / $19.99** (§1.5).

**Option C — Campaign key.** A flat **75 coins** opens a **gate-earned** item for the current
campaign only, until its gate opens. Nothing is permanent and no credits are involved.
Credit-only items (tiers, E5) are never sold.
*Weakness:* it covers only part of "the rest of the earned path"; the rule names units *and*
building abilities *and* the rest. Its value also collapses for every Conduct-gated unit,
which opens after mission 1.
Packs: 300 / 800 coins at $2.99 / $7.99.

|  | A flat | **B advance** | C key |
|---|---|---|---|
| frees credits (a hidden coin→credit rate) | **yes** | no | no |
| price tracks time saved (the rule's "early") | no | **yes** | partly |
| covers credit-only items once reachable | yes | **yes** | no |
| parity with a non-payer once earned | no (credits freed) | **exact** | exact |
| complexity | low | medium (an advance ledger) | low |
| everything listed in v1, from mission 0 | ≈ 2,125 coins | **≈ 1,400 coins** | ≈ 525 coins |

### 1.4 The exchange rate: bands of missions saved (Option B)

**Missions saved** is the smaller of two counts, each taken from the player's own position:
- **missions to the gate:** stars or Conduct still needed, divided by this player's own
  per-mission rate so far. Before the first mission, it falls back to the measured ladder
  (§1.1).
- **missions to settle:** `(credit price − credit balance) / this player's mean payout`. Before
  the first mission, the mean falls back to 225. Settlement draws on the balance first, then on
  payouts. If the balance already covers the price, the item is **not sold for coins**: the
  card says "Affordable now with credits" and links to the garage.

The result is rounded **down**, in the player's favour.

| missions saved | price | per mission saved | example (fresh account, mission 0, ladder fallback) |
|---|---|---|---|
| 0–1 | **not sold** (G3) | — | every Conduct-gated unit for a clean player (gate after mission 1) |
| 2 | 50 | 25 | `recon_drone`, for a player below Conduct 70 (settles after mission 2) |
| 3–5 | 100 | 20–33 | `breach_team` (settles after 4, gate after 5): **100**; `mbt_lavi` below Conduct 90 (settles after 4): 100; Maya (gate after 5): 100 |
| 6–9 | 200 | 22–33 | `scout_shachaf` (settles after 8, gate after 13): **200**; Yoav (settles after 7): 200; Dalia (8): 200 |
| 10–14 | 300 | 21–30 | `apc_kipod` (settles after 14, gate after 19): **300**; Ronen (gate and settle after 12): 300 |
| 15+ | 400 | ≤ 27 | `recon_zikit` (settles after 18), once G1 admits it |

So the rate is **~25 coins per mission saved** (≈ $0.25 a mission, or ≈ $1.50 an hour on the
10-minute assumption), and it is flat by design. Three properties follow from it.
- **The price falls as the earned path closes in.** For a player who spends credits as they
  earn them, the same Kipod costs 300 at mission 0, 200 at mission 10, 100 at mission 14 and 50
  at mission 17, and is not sold from mission 18. Prices never rise, and a quote holds for 24
  hours.
- **Everything early from mission 0, v1 catalogue:** the three star units (100 + 200 + 300)
  plus the four officers once they ship (100 + 200 + 200 + 300) come to **1,400 coins ≈ $14**.
  The nine Conduct units are 0–100 depending on the player.
- **Against the market (web, retrieved 2026-10-01; see Sources):** Company of Heroes 3's
  Hammer & Shield battlegroup pack is $13.99, and Steel Division 2's campaign DLCs are
  $14.99–16.99. A Total War: Warhammer III legendary-lord pack is $8.99. Those sell **content
  the buyer could never otherwise get**. Ours sells **only time**, so "everything early"
  should land at or below one such DLC, and at $14 it does. Going higher would make the time
  look like content.

### 1.5 Packs, bonuses and Steam Wallet

| pack | coins | bonus | price (USD; Valve sets regional) | net after Valve's 30% (ST7's figure) |
|---|---|---|---|---|
| Patrol | 500 | — | $4.99 | ≈ $3.49 |
| Company | 1,050 | +5% | $9.99 | ≈ $6.99 |
| Brigade | 2,200 | +10% | $19.99 | ≈ $13.99 |

- **Every pack and every band price is a multiple of 50**, so a remainder always buys a
  2-mission advance or sits at zero (ST8 §5.2, no orphaned coins).
- **The largest pack (2,200) covers the whole v1 catalogue (1,400) with room to spare, and
  there is no larger pack.** A $49.99 or $99.99 pack would sell coins the catalogue cannot
  absorb, and ST6 names a new account buying the largest package as the fraud pattern that
  matters. A new account is limited to the Patrol pack for its first 24 hours (ST6's limits).
- **The bonus is fixed and permanent.** There are no first-purchase doublers, no timers and
  no "sale ends" (ST8 §5.4).
- The 4.99 / 9.99 / 19.99 ladder is the common Steam free-to-play convention. That is a
  general observation, not a sourced figure. Regional prices come from Valve's suggested
  table at ST7.

### 1.6 Guards: how the rule is checked, item by item

Each guard is written so it can fail.

| # | guard | ties to the rule | how it is checked |
|---|---|---|---|
| G1 | **Reachable.** An item is listed only if the earned path reaches it within one lifetime of earning (today: one campaign, F1) | "never exclusive" | a catalogue spec walks the measured ladder and fails on an item the ladder cannot afford or open |
| G2 | **Time, not power.** The price is a function of missions saved only; a unit's power, cost curve or tier never enters it | "a time-saver" | the price function takes `(missionsSaved)` and nothing else |
| G3 | **Not sold under 2 missions.** | an advance of under 2 missions is noise sold as value | band table |
| G4 | **No credit freed.** An advance settles the full credit price from earned payouts; coins never write a credit grant, and `granted` stays non-money (ST8 Q7) | two currencies, credits never sold | an account invariant: `balance` is always earned grants minus spending, with advances included |
| G5 | **Earned-only in co-op and skirmish.** An item in the `advance` state is absent from every co-op and skirmish loadout until it settles or its gate opens | "co-op and skirmish use only what each player earned" | the loadout reads provenance; replays record commands only (ST8 §6) |
| G6 | **Score-blind.** Stars, grade, Conduct and `creditsFor` are computed exactly as for any fielded unit | Conduct cannot be bought | measured: the six `(gate open)`/`(bought)` probes in today's playtest move **stars by 0** in every case, and credits by +0 to +33 per mission (`qarn_hadid_3_clearance` 212 → 245), all of it withheld by the advance anyway |
| G7 | **Mission rules win.** A mission's allow list (e.g. #277's no intel centre on a tunnel mission) and `gate_only` placements ignore advances | the earned path is not reshaped | `resolveUpgrades` and the build allow list never read the advance ledger |
| G8 | **No Conduct item.** A Conduct floor, Conduct points, ROE forgiveness and stars are never items | G7 (#199) | ST8 §7, unchanged |
| G9 | **Known, kept, not random.** The exact item, the band and the missions saved are shown before payment; no loot, no expiry, no countdown | ST8 T7, T8 | unchanged |
| G10 | **The honest line is computed, never written.** "Earned free in ~N missions" comes from the same function as the price | honesty | one function feeds the line and the price |

### 1.7 The ST8 amendment (text to land with this spec)

- **§1 rule 4** becomes: "Roar coins buy cosmetics, and **early access** to items the earned
  path also reaches (the advance, spec 2026-10-01)."
- **§1 rule 5** becomes: "Roar coins buy no brigade credit, no Conduct tier, no Conduct
  advantage and no star, directly or through anything they buy. A unit or tier is bought only
  as an advance, which settles its full credit price from earned payouts."
- **T2–T4** do not apply to an advance; **G1–G10** apply instead.
- **§4**: the Stores is the only surface showing a coin price. A locked unit on the brigade
  board shows a **link** ("Early access in the Stores"), never a coin figure.
- **§7**: "Units" and "Upgrade tiers" move from *never sold* to *sold only as an advance*.
  Everything else in §7 stands.

### 1.8 Refunds (Steam constrains this)

Steam's published policy (web, retrieved 2026-10-01, Sources):
- **in-game purchases** in Valve's own games are refundable within 48 hours if not consumed,
  modified or transferred, and **third-party developers may opt in** on the same terms
  (otherwise they are non-refundable);
- unused **Steam Wallet funds** are refundable within 14 days.

Recommended policy:
1. **Opt in to the 48-hour refund for unspent coin packs.**
2. **An advance is cancelled for its coins within 48 hours if the item has not been fielded in
   a mission.** It is "consumed" by its first deploy. Cancelling is coin-to-coin, in game.
   Withheld credits are released.
3. **Chargeback or Valve-side reversal:** unspent coins are removed first. If they were spent,
   the advances they paid for are revoked, newest first: the item returns to its earned-path
   state, and settled credits stay with the player, since they were earned (ST8 §5.6).
4. **ST7 confirms** how Valve's refund notice reaches our backend. Nothing here is asserted
   about Valve's internal rules beyond the published page.

### 1.9 Bought, then earned: one answer

**Recommended: the advance simply ends. No coins come back, except a price guarantee.** If
the item is earned in **fewer missions than its band assumed**, the difference between the
paid band and the band of the missions actually saved is returned in coins.

*Example.* A Kipod is advanced at mission 0 for 300 (10–14 missions). A strong player opens
it at mission 9. Nine missions saved puts it in the 6–9 band (200), so 100 coins come back.

Both alternatives were rejected:
- **A full coin refund on earning** makes the advance free for anyone patient. It turns a
  purchase into a deposit and teaches players to buy everything at mission 0.
- **No guarantee at all** lets an optimistic quote overcharge a strong player, which the
  honest line would then have misstated.

The receipt records the outcome ("Earned after mission 9. You had it 9 missions early. 100
coins returned.").

## 2. The shop screen

### 2.1 Where it lives: a garage tab (recommended)

| | **Garage tab, "Stores"** | main-menu entry |
|---|---|---|
| beside the earned path it shortcuts | **yes**: same unit cards, same progress figures | no |
| matches ST8 §4 ("the Stores", its own tab and header) | **yes** | no |
| pressure | low: the player comes to the garage to spend earned credits first | a store on the title screen sells before anyone has played |
| discoverability | a "Stores" tab beside the board, plus one link per locked card | high |

**Recommended: the garage tab.** The menu gets no shop button. The Stores tab has three
shelves: **Early access**, **Cosmetics** (ST8's catalogue) and **Receipts**. Its header shows
the Roar coin balance and the Wallet top-up, and **never the credit balance** (ST8 §4).

### 2.2 Item states

Every Early-access card shows the unit (or work, or tier), its earned path in words, and how
far the player has come along it. The state is one of:

| state | what the card says | control |
|---|---|---|
| **Earned** | "Earned — after mission 9" (gate) or "Earned — bought with credits" | none; links to the garage card |
| **Advance** (bought early) | "Bought early. Settling: 1,240 of 3,200 credits" **or** "Gate: 31 of 44 stars", whichever is closer, with a two-segment bar | "Cancel (until first deploy, 48 h)" |
| **Earnable** (locked) | the honest line, "Earned free in ~6 missions (13 of 30 stars)", and the band price | "Unlock early — 200 Roar coins" |
| **Next mission** | "Earned next mission. Not for sale" (G3) | none |
| **Affordable with credits** | "You can buy this now with credits" | a link to the garage card; no coin price |
| **Not reachable yet** | "Not yet reachable by play. Not for sale" (G1, F1) | none; this state disappears if the lead resets `paid` per campaign |

Progress is **always two figures**, so the player sees both earned paths and which one is
nearer: the gate (stars, Conduct, story mission) and the credits. Only the nearer one sets the
price.

### 2.3 Confirmation and receipts

**Confirm** reuses `confirmDialog` (`ui/confirm.ts`: one open dialog, focus-trapped, closed by
the router on leave). It reads, in this order:
1. the item;
2. the honest line ("You would earn this free in ~6 missions");
3. what settles ("Your next payouts settle its 1,800 credits, as if you had bought it with
   credits");
4. the price, in coins, and in money as the cheapest covering pack (ST8 Q9);
5. the 48-hour cancel window.

The two buttons are **"Unlock early"** and **"Not now"**. "Not now" holds focus by default.

**Receipts.** One row per purchase, kept forever and shown newest first:
- date and time;
- the item;
- the coins paid and the band;
- missions saved as quoted;
- the outcome, when it comes ("Settled after mission 8", "Earned on gate after mission 9,
  100 coins returned", "Cancelled, 200 coins returned");
- the server order id.

Pack purchases are receipts too, showing pack, coins and the Steam transaction reference.
Money amounts come from Steam, never from the client.

### 2.4 The honest line

The line is computed (G10), counted in **missions**, never in hours, and states the gate in
its own terms. Examples:
- "Earned free in ~2 missions";
- "Earned free in ~6 missions (13 of 30 stars)";
- "Earned free once your Conduct reaches 85 (now 82)", when credits are not nearer;
- "Earned with 1,800 credits, about 8 missions of pay".

A Conduct gate has **no mission estimate** when the player's average sits below the floor,
because Conduct is behaviour, not time. The line then shows the credits path only.

### 2.5 Strings (every one through `t()`)

New keys, all under `stores.*` in `en.json`:
- `stores.tab`, `stores.shelf.early`, `stores.shelf.cosmetic`, `stores.shelf.receipts`;
- `stores.wallet.word` ("{n, plural, one {Roar coin} other {Roar coins}}");
- `stores.state.earned`, `stores.state.earnedBy.gate`, `stores.state.earnedBy.credits`,
  `stores.state.advance.settling`, `stores.state.advance.gate`, `stores.state.next`,
  `stores.state.unreachable`;
- `stores.honest.missions` (plural), `stores.honest.stars`, `stores.honest.conduct`,
  `stores.honest.credits`;
- `stores.buy` and `stores.buy.aria` (with the name, coins and missions);
- `stores.confirm.title`, `.line`, `.settles`, `.price`, `.money`, `.window`, `.yes`, `.no`;
- `stores.cancel`, `stores.receipt.*`;
- `stores.offline`, `stores.mock`.

Two rules from `CLAUDE.md` apply.
- **No label table is resolved at module load**; state labels are accessor functions.
- **The pseudo-locale capture must show every Stores string bracketed.**

The noun always sits beside the number ("200 Roar coins"); a bare figure is never a price.

### 2.6 Accessibility

- **Keyboard:** roving tabindex over shelf, cards and buttons (the garage's F8 pattern), and
  Enter on a card opens the confirm.
- **Screen reader:** each card's state is a sentence, not only a colour or a bar
  ("Breach team. Bought early. Settling 400 of 850 credits.").
- **Colour vision:** state never rests on hue. Each state carries a word and a shape: a solid
  bar for settling, a hollow one for the gate.
- **Reduced motion:** the purchase animation (§3.4) becomes an instant state change.
- **Text size:** `--ui-scale` and `--text-size` apply as in the garage.
- **Focus** returns to the card after a purchase. A buy losing focus is the garage's own F8
  bug, so it is not repeated here.

### 2.7 Before the account is server-held (ST5–ST7)

- **Production builds show no Stores tab and no coin anywhere** until the server account
  answers. A client-side coin balance is "a suggestion, not a balance" (ST6), and ST8 Q2
  makes coins unearnable in play, so there is nothing local to show.
- **A dev mock** (proposed flag `&shop=mock`, sandbox-style, documented in `sandbox-help.ts`'s
  table if built) renders the Stores tab from the real catalogue and the real honest lines. It
  shows a balance of **0**, every buy control disabled, and a banner: "The Stores open when
  your account is online." That is the instrument the lead judges the screen with, before any
  money path exists.
- **Offline, after launch:** the tab shows cached receipts and advances read-only, with
  "Offline — purchases resume when you reconnect". Advances keep settling locally against
  earned payouts and reconcile on reconnect, the server being authoritative.

## 3. Visual identity

### 3.1 Register: the coin must not look earned or look like credits

- ST8 T6: no stars, no chevrons, no `--commend` gold, no kit Stars of David, no rank slip.
- ST8 §4: a different shape *and* colour from credits. Credits are a figure in `--commend`
  (`dust.0`) with no glyph.
- The coin also must not look like the **Ari'im lion-head patch** sold as a badge (ST8 §2.2:
  roundel, shield, tab). A coin in one of those frames would read as that cosmetic.

**Colour: copper, the terracotta ramp.** New semantic tokens in `theme.css`, mapped from
palette keys only:

| token | palette key | use |
|---|---|---|
| `--roar` | `terracotta.0` | coin face, price figures, the Stores accent |
| `--roar-mid` | `terracotta.1` | relief, mane |
| `--roar-deep` | `terracotta.2` | rim, the line art at 16 px |
| `--roar-hi` | `limestone.1` | the glint, the 48 px highlight |
| `--roar-ink` | `shadow.1` | the mouth, outline on light grounds |

Terracotta is not a team, VFX or group colour. It stays apart from `--commend` by
**lightness as well as hue**, which survives all three CVD simulations: `terracotta.0` has luma
≈ 125 against ≈ 189 for `dust.0`. That needs confirming with `tools/src/cvd.test.ts`'s
method when the token lands.

### 3.2 Three emblem directions (SVG in the mock)

**A — Roaring Roundel.** A front three-quarter lion face, jaws open, with the mane as a
notched rim around a round coin.
- Strong at 48 px.
- At 16 px it collapses to a brown disc with a dark hole.
- Round is also the credits' implied shape and the patch's roundel.

**B — Hex Seal. (Recommended.)** A pointy-top **hexagon** coin, with a lion's head **in
profile, roaring left**, struck as one flat silhouette and the mane as a jagged back edge.
- The hexagon is the campaign board's own shape (the Sahar basin diorama).
- It is none of the patch's three frames.
- It cannot be mistaken for a star.
- A profile silhouette survives 16 px: open jaw, mane, hex.

**C — Mane Burst.** An abstract roar: twelve mane rays around an open-jaw glyph.
- Best pure legibility at 16 px.
- But rays around a centre **read as a star or a medal**, which is T6's earned register. That
  is the reason it is not recommended.

### 3.3 The in-game coin icon at 16 / 24 / 48 px

- **16 px** (inline in prices and the wallet): the hex is filled `--roar-deep`, with the lion
  silhouette in `--roar` and the mouth as one cut-out. There is no eye, no rim and no
  gradient. It is drawn pixel-aligned as its own SVG, not scaled from 48.
- **24 px** (cards and buttons): adds the rim (a `--roar-deep` stroke inside the hex), the
  mane notches and the eye.
- **48 px** (the confirm, receipts, the Stores header): the full strike, with a raised rim,
  mane relief in `--roar-mid`, a `--roar-hi` glint on the upper-left facets (the sun's side,
  as in the garage viewer's key light), and teeth.

All three are SVG in DOM, like the kit sign (`kitIconSignHtml`), so both renderers draw them
identically and they stay crisp. No world overlay, ever (CLAUDE.md, "no kit mark in the
world").

### 3.4 The Stores' look, the purchase animation and the sound

**Look.** The Stores tab is the garage's own panel:
- `--panel-bg`, `--panel-frame` and `--panel-rule`, the `--font-display` header and the mono
  wallet;
- `--roar` replaces `--commend` as the accent;
- cards are the garage's `rl-garage__card` with a copper keyline in place of the steel one.

Settling bars are `--roar` (solid) and gate bars are `--ink-mute` (hollow). "Earned" uses
`--good`. "Not for sale" states use `--ink-dim`. **Nothing in the Stores uses `--commend`.**

**Purchase animation** (≤ 700 ms, on `--ease`):
1. the 48 px coin drops onto the card's corner (120 ms);
2. it turns once by **60°**, one hex face, rather than spinning (250 ms);
3. a `--roar-hi` glint sweeps it (160 ms);
4. the card flips from *Earnable* to *Advance* and its settling bar draws from zero (170 ms).

The wallet figure counts down in mono. Under `prefers-reduced-motion`, or `data-motion`
reduced, the state changes at once and the coin appears static.

**Sound brief.** One cue of ≤ 600 ms:
- a **struck copper coin** (a low metallic "thunk", not a bright jingle);
- a **short, low growl tail** at about −12 dB under the strike, so it reads as *Roar* without
  becoming a roar sample;
- mono-compatible, normalised to the game's SFX level, not ducking music, and **distinct from
  the credit-purchase cue** (S3g item 5).

The source needs explicit redistribution rights (CLAUDE.md), **the lead's call**. It can be
recorded or synthesised; it may not come from a paid pack.

### 3.5 A 3D coin: Blender first, Meshy only if wanted

The coin is a hexagonal prism with a relief, so **Blender builds it from the 48 px SVG**:
import the curve, extrude it, bevel the rim, and apply the terracotta ramp. That costs **0
credits** and is the recommended path under the Meshy policy (Blender for everything Meshy is
not needed for).

If the lead wants a sculpted lion relief Blender cannot easily make, the brief for the later
Fable agent is below. **Meshy is not called by this design.**

> *Prompt (text-to-3D):* "A single hexagonal coin, pointy-top hexagon, thick raised rim,
> centre relief of a lion's head in profile facing left with jaws wide open roaring and a
> jagged mane, struck metal, copper, simple game-asset style, centred, no text, no
> background, no other objects."
> *Settings:* one preview, low poly (target ≈ 3,000 triangles), then one refine only if the
> bake is wanted as-is. Otherwise repaint from the palette in Blender.

*Estimate:* preview 20 credits plus refine 10 = **30 credits** (≈ $0.60 at the unverified
$0.02 per credit), with a cap of **60** to allow one re-roll. The asset needs AI disclosure
per CONTRIBUTING.md and a row in `docs/ASSET_PROVENANCE.md`.

## 4. What implementation would touch (not now)

This is for scoping the later plan only.
- **Server (ST6):** a `roarCoins` balance, an `advances[]` ledger
  (`{item, coins, band, quotedMissions, creditsOwed, creditsSettled, state, at}`),
  `receipts[]`.
- **Brigade account:** `unlocks` gains provenance (`credits` | `advance`), and `payMission`
  learns to route a payout to open advances first. That is still integer-only and still never
  constructs a credit from coins.
- **App:** the Stores tab in `ui/brigade.ts`'s screen, `stores.*` strings, the `--roar`
  tokens, and the coin SVGs.
- **Sim:** nothing. The sim never learns coins, advances or prices exist (invariant 4,
  brigade D5).
- **Gates to add with it:** the G1 reachability spec over the ladder, a G4 account invariant,
  and a G5 loadout-provenance test. Each arrives with a mutation that turns it red (CLAUDE.md,
  "every check gets an input that makes it fail").

## 5. Decisions for the lead

| # | decision | recommended default |
|---|---|---|
| 1 | **The model** | **Option B, the advance.** Coins open the item now; its credit price settles from earned payouts; it ends on settlement or on the earned gate, whichever comes first |
| 2 | **Pack prices** | **500 / 1,050 / 2,200 Roar coins at $4.99 / $9.99 / $19.99**; no larger pack; new accounts limited to 500 for 24 h |
| 3 | **The exchange rate** | **Bands by missions saved: 2 → 50, 3–5 → 100, 6–9 → 200, 10–14 → 300, 15+ → 400 (~25 coins a mission); not sold under 2 missions.** Prices only fall; a quote holds 24 h |
| 4 | **Where the shop lives** | **A garage tab, "Stores"** (shelves: Early access, Cosmetics, Receipts); no main-menu button |
| 5 | **The emblem** | **B, Hex Seal**: a lion's head in profile roaring, on a hexagon, in the terracotta ramp (`--roar` = `terracotta.0`) |
| 6 | **Bought, then earned** | **The advance ends; withheld credits are released; no coin refund, except the price guarantee** (earned sooner than the band → the difference back in coins) |
| 7 | **The ST8 amendment** (§1.7) | **Land it with this spec**, so the two documents agree |
| 8 | **Unreachable items (F1)** | **Exclude from the shop** every item one lifetime cannot reach (today: upgrade tiers beyond ~5,849 credits, `demo_tzav`, `heli_peten_gunship`). Separately, ask the balance analyst whether a fresh campaign should reset `paid` (catalogue reachable in ~12 campaigns) |
| 9 | **Refunds** | **Opt in to Steam's 48 h for unspent packs; an advance is cancellable for 48 h until first deployed; chargebacks revoke unspent coins first, then advances newest-first** |
| 10 | **Before ST5–ST7** | **No Stores tab in production; a `&shop=mock` dev view with a zero balance and disabled buys** |
| 11 | **The purchase sound's source** | a recorded or synthesised copper strike with a low growl tail, with explicit redistribution rights. The lead names the source |
| 12 | **3D coin** | **Blender from the SVG, 0 credits**; Meshy (≈ 30 credits, cap 60) only if the lead wants a sculpted relief |

## Sources (web, retrieved 2026-10-01)

- Steam refund policy, in-game purchases and Wallet funds: <https://store.steampowered.com/steam_refunds/>
- Company of Heroes 3 DLC prices (Hammer & Shield battlegroup pack $13.99; expansions $24.99): <https://steampulse.org/dlc/4095900>, <https://sysrqmts.com/prices/company-of-heroes-3-fire-steel>
- Steel Division 2 DLC prices ($14.99–$16.99): <https://steampulse.org/dlc/1165510>, <https://steampulse.org/dlc/3761870>, <https://steampulse.org/dlc/1307600>
- Total War: Warhammer III legendary-lord pack price ($8.99): <https://www.pcgamesn.com/total-war-warhammer-3/dlc-price>

All other numbers in this document are measured in this repository on 2026-10-01, or stated as
assumptions where they are not.
