# The monetisation content plan — design (WP-ST8, #207)

**Date:** 2026-09-28 · **Status:** proposal, written against G7's default (#199, due
2026-10-30). If the lead answers G7 differently, this document is rewritten, not patched.
**Downstream:** WP-ST6 (#205, two balances in `LedgerStore`), WP-ST7 (#206, the Steam
catalogue), WP-G-E5 (#181, bought-only units for credits), the garage (WP-S3g). No code, and
the sim is untouched.

## 1. The rule

1. There are **two currencies**.
2. **Brigade credits** are earned only, by play (`creditsFor`, brigade spec §4.2). They are
   never sold, never granted for money, and never converted from anything bought.
3. A second, cosmetic currency, working name **marks** (§9 Q1), is the only thing Steam Wallet
   sells.
4. Marks buy **only cosmetics**: faction liveries, unit badges and episodic operation passes.
5. Marks buy **no unit, no upgrade, no brigade credit, no Conduct tier and no Conduct
   advantage**, directly or through anything they buy.

Why now: WP-G-E5 sells three bought-only special forces for brigade credits. The day it lands,
"what buys a unit" must already have one answer, and that answer must not be money.

Not G7's option 2 (sell credits, disable them in multiplayer): a purchasable credit makes a
Conduct-gated unit purchasable, which is the one thing the grade is supposed to mean.

### 1.1 The test: any store item, before it is listed

A reviewer answers every line. **One "no" and the item is not sold.** The checklist goes in
the PR description of any change that adds or edits a store item.

| # | Question | Pass means |
|---|---|---|
| T1 | **Currency.** Is it priced in marks only? | Never in credits, never in both, and there is no conversion in either direction |
| T2 | **Sim-blind.** Does owning it leave every value the sim reads unchanged? | It reaches only the renderer and the DOM. It never passes through `applyUpgrades`, unit JSON, a mission, or any `Sim` call. The determinism hash cannot tell an owner from a non-owner |
| T3 | **Score-blind.** Does it leave the grade, stars, Conduct, the ROE rating and `creditsFor` unchanged? | Byte-identical debrief with and without it |
| T4 | **Gate-blind.** Does it leave `unlockReason`, `gateSentence`, the roster cap, the reserve and deploy unchanged? | No door opens earlier or wider |
| T5 | **Legibility-neutral.** Does it leave silhouette, team colour, selection rings, the symbol family, fog and overlays unchanged, for both the owner and whoever faces them? | It passes the mesh gate's silhouette IoU unchanged. It is not harder to see, identify or count, and it never reads as camouflage |
| T6 | **Register-distinct.** Does it avoid every earned sign? | No stars, chevrons, `--commend` gold, the kit's steel Stars of David, or the rank slip. A bought thing never looks earned |
| T7 | **Known contents.** Does the buyer see exactly what they get before paying? | No random or paid-chance item of any kind |
| T8 | **Kept.** Is it permanent? | No rental, no expiry, no "limited time" removal of something already bought |
| T9 | **Fiction.** Does it pass GDD §2 and the storyline's naming rule (§2.4)? | Fictional insignia only. No faith, people, real place or real unit. Nothing depicts, commemorates or makes light of First Light, the abducted or civilian harm |
| T10 | **No earned twin.** Does it avoid commemorating a feat? | "I cleared Tel Marum" is earned, never sold (§7) |
| T11 | **Removable.** Is every mission, unit, tier and ending still reachable with it absent? | Yes, always |

T2 to T4 are also enforced by structure. Cosmetic ownership lives in the app's account and
never enters `@lions/sim` or `@lions/data`'s pre-pass, so invariant 4 would have to break for a
cosmetic to change an outcome.

## 2. The cosmetic catalogue

Categories and examples only. The art for each is a later package and passes the same gates
as any art (palette exemption rules, silhouette IoU, provenance, AI disclosure).

### 2.1 Faction liveries

A hull and uniform paint scheme on KDF units, per type or brigade-wide. It changes albedo only:
team markings, silhouette and kit geometry stay. The garage spec already rejected a per-type
tint that is "confusable with team colour" (§3.4 option C), and T5 generalises that finding.

- **Sahar Dust**: the standard scheme, free, the reference every other livery is judged against.
- **Sur Winter**: rock grey-white for the northern mountain front.
- **Naharin Olive**: green highland drab for the river-basin front.
- **Ari'im Dress**: the 401st's parade scheme, lion-head brigade patch on the turret side.
- **Marj Coastal Grey**: harbour-concrete grey for the coastal enclave.

A livery that measurably blends into its own front's ground fails T5 and is recoloured, not
sold. Liveries are **KDF only** in the first catalogue (§9 Q8).

### 2.2 Unit badges

A company or crew mark shown **on the unit's icons**: dock tile, selection chip, HUD card and
garage rail. Never in the world, because the lead rejected on-map status marks (garage plan 2,
27 Sep). It must stay clear of the kit's stars and the veterancy chevrons (T6).

- **Company tabs**: Alef, Bet, Gimel company plates of the 401st, fictional heraldry.
- **Crew nameplates**: a Lavi named *Ari 1*, a Namer named *Sahar*, in the materiel register
  (storyline §2.4 rule 4).
- **Brigade patches**: the Ari'im lion head in three frames (roundel, shield, tab).
- **Front tapes**: a plain text tape reading MARJ, SUR or NAHARIN. It is a geographic tape,
  not a campaign honour. The honour for finishing a front is earned (§7).

## 3. Operation passes

An **operation pass** is an episodic cosmetic track attached to a new operation: a set of
missions on a front, such as Khan Rafid, Deir Amun, or a future skirmish season.

**What it contains:** about 8 to 12 cosmetic items from §2, themed on the operation. Each item is
unlocked by play in that operation's missions: completion, objectives, grade. Everything is
listed before purchase (T7).

**What it does not contain:** the missions. **Every mission is free to every player**, pass or
no pass (§9 Q3). The pass sells the cosmetic track, never the content or its payout. This is
the load-bearing choice. A paid mission would pay credits on victory (brigade spec §4.2), so
marks would buy credits one step removed. Selling missions would also paywall the story.

**Why it is not pay-to-win (P2W):**

- The missions, their credits, stars and Conduct are identical for owners and non-owners.
  `creditsFor` never reads pass ownership.
- Pass progress comes from play. It is never sold as tier skips (§9 Q5), so money shortens
  nothing, not even cosmetic time.
- Items stay earnable after the episode ends, with no expiry and no countdown (§9 Q4).
- Nothing in a pass can be a credit, a booster, a unit, a tier, a roster slot or a Conduct
  item, because everything in it has to pass §1.1 individually.

## 4. The garage: two prices without confusion

- **Two surfaces.** Units and tiers stay on the brigade screen, priced in credits.
  Cosmetics get their own tab, the **Stores**, priced in marks. **No row ever shows both
  currencies**, and no locked unit ever reads "or N marks".
- **Two signs.** Credits keep their shipped glyph, their noun and the `--commend` token.
  Marks get their own glyph and a new semantic token. They share neither shape nor colour,
  the same rule the garage spec applied to veterancy and kit (goal 4).
- **Two balances, apart.** The brigade header shows credits. The Stores header shows marks
  and the Wallet top-up. Neither header shows the other's balance.
- **Honest words.** The noun is always printed beside the number: "400 credits", "120 marks".
  A bare number is never a price.
- **No conversion anywhere.** No exchange rate, no "worth N credits", no bundle mixing the two.

## 5. Pricing principles

No numbers yet: they come with ST7 and Valve's catalogue.

1. **Items are priced before packs.** A pack price means something only against what it buys.
2. **No orphaned remainders.** Pack sizes line up with item prices, so a player is not left
   holding marks that buy nothing, which pushes a second purchase.
3. **Show the whole price.** Every item's marks price, and the real-money price of the
   cheapest pack that covers it, are both visible before the Wallet opens (§9 Q9).
4. **Fewer, better items.** A small permanent catalogue beats a rotating shop. No daily
   deals and no countdown timers.
5. **The free player is the reference.** Sahar Dust and the base badges must look finished. A paid item is an alternative, never a fix for a deliberately drab
   default.
6. **Refunds follow Valve's policy** (to confirm in ST7). If a refund reaches marks already
   spent, the item they bought is revoked.

## 6. Co-op and skirmish

- **Earned credits and tiers are advantages in skirmish and co-op by design** (G7's framing).
  That is exactly why they cannot be sold.
- **Co-op (M4, G5).** Credits follow whatever G5 decides (default: shared Conduct, grade and
  credits). Marks and cosmetics are never shared, pooled or traded.
  Each player sees the other's liveries and badges, which pass T5 by construction. A client
  setting, "show standard liveries", draws every unit as Sahar Dust for anyone who wants
  pure legibility.
- **Skirmish and a later 1v1.** Cosmetics are visual only, so they need no rule beyond T5.
  Earned tiers in a ranked 1v1 are a separate question for the 1v1 design (§9 Q10).
- **Replays and determinism.** A replay records commands, never cosmetics. It plays back
  identically with or without the viewer's inventory.

## 7. Things we will never sell

Not for marks, not for Wallet money, not in a bundle, not as a pass reward.

- Brigade credits, directly or as a pack bonus, and any credit or payout multiplier.
- Units, including E5's bought-only special forces, which are credits-only.
- Upgrade tiers, or anything that patches a unit's numbers.
- Stars, grades, Conduct points, ROE forgiveness, or a lower Conduct floor.
- Mission skips, revives, reinforcements, extra logistics or intel, or time.
- Roster slots or reserve capacity.
- Campaign missions, acts, endings or operation missions (§3).
- Paid random items of any kind: loot boxes, crates, gacha.
- Earned honours: front-completion ribbons, ★★★ marks, rank. These are earned only (T10).
- Anything that makes a unit harder to see or identify (T5).
- Anything that depicts, commemorates or trades on First Light, the abducted, civilians or
  civilian harm, or that celebrates any side's killing.
- Real-world insignia, real units, or anything else GDD §2 excludes.
- Trading, Steam Community Market listings, or any cash-out path (§9 Q6).

## 8. Valve policies this plan depends on

To confirm in ST1 (#200) and ST7 (#206); none is asserted here:

- whether and how a premium virtual currency sold through Steam Wallet / `ISteamMicroTxn` is
  permitted, and what the store page must disclose about it;
- Valve's refund rules for in-game purchases, and how a refund reaches our backend;
- Valve's revenue share as it applies to microtransactions (ST7's issue states 30%);
- regional pricing and currency rules for Wallet purchases;
- any age-rating descriptor that in-game purchases require;
- whether opting out of trading and the Community Market needs any setting or declaration.

**One text correction for ST7:** its issue calls the packs "credit packages (500 / 1,200 /
2,500)". Under this rule they are **marks packs**, and the issue should say so before ST7 is
planned.

## 9. Open questions for the lead

| # | Question | Recommended default |
|---|---|---|
| Q1 | **The currency's name** | **Rename "marks" to "chits"** (quartermaster's chits). "Mark" already means four things in this game: `mark_tunnel`, `intel.marked_positions`, the kit mark and `mark.ts`. A chit is plain, reads as stores and not merit, and collides with nothing. If you prefer to keep "marks", this plan reads the same |
| Q2 | Can the cosmetic currency be earned in play? | **No.** It is sold only, so the one money-bearing balance stays server-authoritative (ST6). Play earns cosmetic **items** directly: honours, pass items |
| Q3 | Are operation missions free to everyone? | **Yes.** The pass sells the cosmetic track only. If a paid mission is ever wanted, it pays **zero** credits |
| Q4 | Do pass items expire when the episode ends? | **No.** Every item stays earnable afterwards |
| Q5 | Can pass tiers be bought outright? | **No.** Progress is play only |
| Q6 | Trading, gifting, the Community Market? | **None.** Cosmetics are bound to the account |
| Q7 | The lead's 15 Sep ask, "sell coins so users can upgrade without the need to win" | **Retired by G7's default.** Brigade spec D6 and §4.6 are amended: the `granted` credit source is reserved for non-money cases such as a support restore, and nothing sold ever writes one |
| Q8 | Cosmetics for the enemy doctrines, if skirmish lets a player command one | **None in the first catalogue.** Decide per doctrine under T9 when skirmish exists |
| Q9 | Show a real-money price beside the marks price? | **Yes**, the cheapest covering pack (§5.3), if Valve's rules allow it |
| Q10 | Earned tiers in a ranked 1v1 | **Not decided here.** Record it for the 1v1 design. The likely answer is base tier or matched tiers |
| Q11 | Contributor-made cosmetics in the store | **Not in the first catalogue.** The CLA allows it, and the licensing decision keeps selling with the lead |
| Q12 | A fourth category, command-post dressing: campaign-board plinths, briefing-folder styles, menu diorama presets, garage backdrops. Never the cursor, symbols or HUD colours, which are functional and carry CVD variants | **Yes**, under the same test, after the first three categories ship |
