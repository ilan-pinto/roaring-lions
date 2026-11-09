# GH-317: a free Roar-coin wallet, earned in play (design, as built)

**Built 4 Nov 2026** (P1 wallet, P2 earning, P3 Stores copy, P4 fences and docs). Lead rulings, 4 Nov, GH-317 last comment: the earn table is approved as proposed (100 / 10 / 5 per star / 100, lifetime-only, 0 for replays, Conduct points and versus); one price list, two ways to pay; versus pays 0 until ST6 can verify a result; `?testcoins` is removed; every other recommendation is taken as written. As built, the campaign-complete bonus pays on the win that leaves every region complete (`campaignComplete`), not on "the last mission" alone, so a mission won out of order cannot finish the campaign early.


Opus design agent, 4 Nov 2026; saved by the coordinator. Serves the lead's 4 Nov ruling: every player gets a free wallet; coins are granted and earned in play; packs stay off (PURCHASES_OPEN false until ST7). No sim change.

## 1. What exists
- Price rule: CREDITS_PER_COIN 10, COIN_STEP 5 (stores-model.ts:17,19); coinPrice(c) = ceil(c/50)*5, integer, rounds up (a coin is never the cheaper way to pay).
- Catalogue: 26 priced KDF units = 78,700 credits = 7,900 coins (nine Conduct-gated 25-75; three star-gated breach_team 85, scout_shachaf 180, apc_kipod 320; twelve bought-only 400-800, heli_peten_gunship 800). 177 upgrade rungs = 43,505 credits = 4,740 coins (5-95 each). One campaign pays CAMPAIGN_CREDITS 6979 over LADDER_MISSIONS 29 (~241 credits, ~24 coins' worth a mission).
- TEST wallet (roar-test.ts): key lions.roar.test v1 {coins, seeded, entitlements, receipts}, MAX 1,000,000, seeded by ?testcoins, buyUnitWithCoins/buyTierWithCoins, coupon coins land here (grantCouponCoins, redeemCoupon brigade-account.ts:315), read/written only via ledgerStore.readRoarTest/writeRoarTest.
- buyWithTestCoins (stores-model.ts:356-373) via storeItems + buyEnabled (needs wallet.test, cost > 0, coins enough). main.ts:1141-1148 seeds/gates on walletLive(); 1207-1240 wires the Stores.
- A coin-bought unit: entitlements.units[id].coins = true -> singlePlayerView -> boughtUnits -> open in garage/dock/deploy/resolveUpgrades; tier = max(earned, coins); credits, stars, Conduct, creditsFor untouched; a gate opened later flips it to earned, no refund; networkView unused.

## 2. Earning (each pays once per account lifetime; record in lions.roar)
| source | coins | rule |
|---|---|---|
| Welcome issue | 100 | once, on the first campaign victory (never before play) |
| First win of a campaign mission | 10 | first victory ever on the account; tutorial pays nothing |
| Each new star on a mission | 5 a star | when the lifetime best rises |
| Campaign complete | 100 | once, first win of the last mission in world.json |
| Replays, Conduct points, time, losses | 0 | a replay pays only a star improvement |
| Versus | 0 for now | decision 4 |
Conduct is paid via the second star (the Conduct line). Ceiling 68 stars -> 100 + 290 + 340 + 100 = 830 coins; typical (~1.8 stars) ~750. ~22 coins/mission at the ceiling vs ~24 coins' worth of credits: coins roughly double what a first campaign opens.
| unit | coins | with coins | free |
|---|---|---|---|
| recon_drone .. mbt_lavi | 25-75 | after mission 1 | Conduct 70-90 |
| breach_team | 85 | after mission 1 | 12 stars (~mission 6) |
| scout_shachaf | 180 | ~5 missions | 30 stars (~15) |
| apc_kipod | 320 | ~11 | 44 stars (~22) |
| recon_zikit | 425 | ~16 | 4,250 credits (~18) |
| heli_peten_gunship | 800 | the whole campaign | 8,000 credits (~1.15 campaigns) |
Target (gate G-E2): one campaign's coins buy any single store unit, the dearest included. No dark patterns: no expiry, timers, streaks, daily logins, loss-aversion; "Not now" keeps focus; every number shown before a buy; nothing random.

## 3. Coins vs brigade credits
One price list, two ways to pay; not a second economy. Prices authored in credits; coin price always coinPrice(credits); no conversion either way; no split purchase; credits = the wage (every win, no ceiling); coins = a lifetime milestone bonus; coins never cheaper (recon_drone 220 credits or 25 coins). Rejected: coins replace credits (rewrites creditsFor, ladder, campaign_credits.test, migrates balances, and at ST7 sells the earned path, breaking ST8). Rejected: coins on every win (doubles pay permanently).

## 4. Storage
- New lions.roar, sole reader/writer packages/app/src/roar-wallet.ts, via ledgerStore readRoar/writeRoar, safeStorageLike, try/catch, migrateRoar drops malformed parts. v1 shape: { version 1, coins {free, paid}, entitlements {units {id: {free}|{paid}}, upgrades {unit {track {tier, paidTiers}}}}, earn {welcomed, campaignDone, missions {id {won, stars}}}, receipts [{kind, id, at, coins {free, paid}, unitId?, track?, tier?, credits?, source?}] }.
- Survives ?fresh and "New campaign" (like lions.brigade.account). Brigade Reset clears the free half (balance, free entitlements, earn record), never paid.
- Save slots keep the three campaign keys only; a slot load or import earns nothing (coins paid only at the victory event); slots never carry paid.
- writeVictory becomes both-or-neither over ledger + account + lions.roar (separate byte snapshot of the wallet).
- Migration from lions.roar.test: once, then delete; coin entitlements and receipts carry over as free (source 'test'); only coupon coins carry over (sum of coupon receipts, capped at the balance); ?testcoins grants dropped; old key into RETIRED_STORAGE_KEYS one release later. ?testcoins and Grant removed (closes WP-ST8 F4); tests seed via memoryLedgerStore.
- Client-local is acceptable before ST6: free coins only open early what single player already opens, never reach a public match, and paid is never written by client code. ST6 decides server re-derivation.

## 5. Real money later (ST7), no migration
Split balance free/paid from v1; paid display-only, clamped to 0 while PURCHASES_OPEN false (G-M1). Spend free first, then paid; each receipt records {free, paid}. Refunds/chargebacks per coin-shop spec §1.9: unspent paid removed first, then paid>0 entitlements newest first; free-only purchases never revoked; free-coin purchases final; 48 h refund for the paid part only from ST7. Entitlements record which kind bought them (supports a later D4 narrowing).

## 6. Versus
Coin-bought units never enter a room: the seat claim carries tiers only (net/connect.ts:321); units from fixed doctrine menus (data/doctrines, VERSUS_HELD_UNITS); matched kit sends {}; seatKitTiers ignores non-brigade-kit seats (match-world.ts:286). Ruled exception: a friends' room on "bring your brigade" sends ownedTiers incl. coin tiers (D4, 11 Oct); revisit paid tiers at ST7. Tests: G-V1 a coin-only account in a matched room sends no tiers/units and gets the base doctrine menu (falsify: add unlocks: boughtUnits to the claim); G-V2 eslint no-restricted-imports fences roar-wallet out of sim, render and net/match-world.ts.

## 7. UX
Stores header shows the live free balance; CoinWallet.test becomes live (true when storage is available; blocked storage keeps the preview + stores.offline). Honest line stores.about: "Roar coins are free. You earn them in the campaign: 100 on your first win, 10 for each mission's first win, 5 for each new star, 100 when the campaign is done. They open early what play and credits open, in single player. Nothing here costs money." Packs keep "Coin packs arrive with Steam", disabled. A "How to earn" panel from the same constants (stores.earn.*). Debrief rows beside credits (debrief.coins.welcome/firstWin/star/campaign/total); never on the battlefield or world map. Every string via t(); no label table at module load; pseudo-locale bracketed.

## 8. Gates (each falsified)
G-E1 replay without a new star best pays 0 (drop lifetime check). G-E2 roar_earn.test walks the playtest ladder, pins lifetime coins >= coinPrice of the dearest unit (price the gunship at 8,500 credits). G-E3 importing an all-3-star slot earns 0 (derive from ledger state). G-E4 balance and earned_total unmoved by coins (earn writes a credit grant). G-S1 only roar-wallet.ts names 'lions.roar'; nothing else reads lions.roar.test (read the key in main.ts). G-S2 throwing store -> empty wallet, Buy disabled, no throw (remove try/catch). G-S3 ?fresh, New campaign, slot load leave lions.roar byte-identical (add to snapshotCampaign). G-S4 refused wallet write at victory restores ledger + account (write outside the guard). G-S5 migration keeps entitlements, only coupon coins, deletes the old key (carry the whole TEST balance). G-M1 nothing raises coins.paid; migrateRoar clamps to 0 (coupon to paid). G-M2 free first, receipt free+paid = price (paid first). G-P1 live wallet: Buy enabled exactly when covered; packs disabled (flip PURCHASES_OPEN). G-V1/G-V2 as §6. G-U1 new keys in pseudo capture; copy reads numbers from constants (hard-code "10").

## 9. Phases (~4 agent-days)
P1 wallet (1.5 d): roar-wallet.ts, lions.roar v1, door methods, migration, accountView, buyWithTestCoins -> buyWithCoins on wallet.live, remove ?testcoins + Grant, coupon coins to free; G-S1-S5, G-M1-M2, G-P1. P2 earning (1.5 d): pure roarEarn(record, missionId, stars, world), three-key victory write, welcome + campaign grants, debrief rows; G-E1-E4. P3 Stores (0.5 d): balance, honest line, earn panel, strings, pseudo capture, ui-review shots; G-U1. P4 fences + docs (0.5 d): G-V1, G-V2; amend coin-shop spec decision 10 and §2.7, HANDOVER, CLAUDE.md storage line. P3/P4 parallel to P2.
Numbers to approve: 100 welcome, 10 per first win, 5 per new star, 100 campaign complete, 0 replays/Conduct points/versus, lifetime-only, 830 max at 68 stars, one campaign buys the dearest unit (800).

## 10. Decisions for the lead
1. Earn table and lifetime-only payouts (rec). Alternative: coins again each campaign (coin-farm risk).
2. One price list, two ways to pay (rec); coins replacing credits rejected.
3. Welcome issue on the first campaign victory, not first boot (rec).
4. Versus pays 0 until ST6 can verify (rec). If wanted: 5 per finished match, max 25 a week.
5. Remove ?testcoins outright (rec; closes F4).
6. Migration keeps TEST entitlements + coupon coins, drops ?testcoins balances (rec).
7. Free-coin purchases final; 48 h refund for paid only from ST7 (rec).
8. D4 at ST7 (paid tiers in friends' "bring your brigade"): no decision now.

Critical files: packages/app/src/roar-test.ts (-> roar-wallet.ts), ui/stores-model.ts, ledger-store.ts, main.ts (1141-1240 Stores, ~5796-5822 victory pay + debrief, 1309 versus tiers), net/connect.ts:321.
