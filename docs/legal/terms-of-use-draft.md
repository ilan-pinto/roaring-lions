# Terms of use (DRAFT)

**DRAFT. NOT LEGAL ADVICE. For the lead's lawyer. Not in force and not published anywhere.** Written from the repository on 15 Nov 2026. Square brackets are decisions or facts only the lead or the lawyer can supply. Beside each clause, **Basis** names the repository fact it rests on, so the lawyer can check the clause against what the game does, and so a change to the game flags a change to the terms.

Scope: the hosted game at [GAME ADDRESS] (today `roaring-lions.pint12.workers.dev`, per `README.md`), its accounts, Roar coins, versus rooms and feedback form. It is not the licence of the source code, which has its own (clause 12).

---

## 1. Who we are and what this covers

These terms are between you and [OPERATOR LEGAL NAME], [ADDRESS] ("we"). They cover your use of Roaring Lions, a real-time strategy game that runs in your browser, and the services behind it. If you buy the game through a store, the store's own terms also apply, and [STORE-TERMS PRECEDENCE: lawyer].

*Basis:* the game is a static app plus a Cloudflare Worker (`wrangler.jsonc`, `packages/worker/src/index.ts`). The operator is not named in the repository.

## 2. Playing as a guest, and having an account

You can play the campaign and free play as a guest. A guest creates no account and we store no personal details on our server (`packages/worker/src/privacy-page.ts`, opening paragraph). An account is optional and exists to keep your progress on our server.

*Basis:* accounts are on by default in a production build and sit behind a server switch (`CLAUDE.md`, "Accounts (GH-1075 A1)"); sign-in is by Google, with Steam paused (same file, "Google sign-in").

## 3. Who may sign in

You must be at least **[16]** to sign in. If we learn that an account belongs to someone younger, we may close it. A person under that age may still play as a guest.

*Basis:* `PRIVACY_MIN_AGE = 16` in `privacy-page.ts` ("The minimum age to sign in is 16"). The number is the lead's (the file says so); nothing in the code enforces age beyond stating it **(not verified: no age check was found in the sign-in flow)**. Lawyer: is stating it enough, and what is the right number per market?

## 4. Your account

You are responsible for activity under your account. You choose a display name; do not impersonate anyone or use a name that is unlawful, abusive or hateful. You may download your data and delete your account at any time from the profile screen; deletion cannot be undone. An account unused for 36 months is deleted.

*Basis:* display name and random Player ID (`privacy-page.ts`, "What is stored"); "Download my data" and "Delete my account" and the 36-month rule (same file, "For how long" and "Your copy and your deletion"). Callsign cleaning rules: `packages/net/src/callsign.ts` (24 characters, control and bidi characters removed).

## 5. Your progress and our servers

We keep your campaign, brigade and save slots to give you the service. We may change, pause or end the service or any feature (Steam sign-in is paused today). We will try to give notice of a permanent shutdown of accounts and [REFUND/EXPORT COMMITMENT: lawyer].

*Basis:* the stored items (`privacy-page.ts`); feature switches closed by default (`CLAUDE.md`: accounts, google, steam, admin, feedback flags).

## 6. Roar coins and in-game currencies

There are two in-game currencies. **Brigade credits** are earned only by playing; they cannot be bought, sold or exchanged. **Roar coins** buy units and upgrade tiers in the Stores, as brigade credits do; every unit and tier coins buy can also be bought with credits earned in play. At present Roar coins are earned in play or granted by coupon and **cannot be bought with money**; if that changes, [PAID-COIN TERMS: price, tax, refund, chargeback, Steam Wallet terms: lawyer]. The plan is that coins keep buying units once they can be bought with money, and that units bought with coins can be used everywhere in the game, including in versus matches against other players. Coins and credits have no cash value, cannot be transferred between accounts, and are not property. Coins are never earned or spent in a versus match. A versus room ignores everything a player owns unless its host turns on "bring your brigade"; in such a room each player on the KDF side fields the units and upgrades they own, including those bought with coins, so the other player may face units bought with money.

*Basis:* `packages/app/src/roar-wallet.ts` header ("Every player has one, free", `PURCHASES_OPEN` is false and the paid half is clamped to 0); the lead's ruling of 18 Nov 2026, "I want users to be able to use coins to buy new units. That's the leading rule." (GH-1378, GH-1415), which reverses the 16 Nov ruling that paid coins buy cosmetics only at launch, and the lead's ruling of the same day on scope, "coin-bought units work EVERYWHERE, PvP included; the 29 Sep 'no pay-to-win' (G7) rule is RETIRED" (`docs/HANDOVER.md`, rows G7 and G7-R), scoped by the lead's third ruling of the same day, "standard-kit rooms stay EQUAL (no owned kit, coins or credits); coin-bought units reach PvP only through 'Bring your brigade' rooms. No code change."; coin buys of units and tiers (`packages/economy/src/stores.ts`; `wallet.ts` receipts `unit` and `tier`); the versus claim: the create body carries owned tiers and Store specials only for `kit: 'brigade'` (`packages/app/src/net/connect.ts`), read through `singlePlayerView`, earned or coin-bought (`packages/app/src/account-view.ts`), pinned by `packages/app/src/net/coin-claim.test.ts`; versus pays 0 coins; no random or paid-chance items (same spec, test T7); a purchase records free and paid halves so a chargeback takes back only what was paid (`roar-wallet.ts`, G-M2). Staff can correct a coin balance, and every change is journaled and shown in your export (`privacy-page.ts`, "What the team can see").

## 7. Versus rooms and chat

In a versus room you play another person (or a bot). Messages you send are visible to the other players in the room. Do not send content that is unlawful, harassing, hateful, sexual or that reveals other people's personal information. We may remove you from a room, restrict your access or close your account for breaking these rules, and [REPORTING ROUTE: lawyer/lead: none exists yet]. A match you play while signed in is recorded (map, sides, result, date, and whether your opponent was a member, a guest or a bot).

*Basis:* text chat of up to 280 characters, one message per 500 ms per seat, cleaned of control and bidi characters (`packages/net/src/protocol.ts` `CHAT_MAX_CHARS`; `packages/worker/src/match/room-core.ts` `CHAT_MIN_GAP_MS`, `cleanChat`). **No word filter, mute, block or report feature was found** in `packages/net`, `packages/app/src/net` or `packages/worker/src/match` **(not verified by an exhaustive search)**. The recorded fields: `privacy-page.ts` last bullet of "What is stored".

## 8. Feedback you send

If you send feedback you may attach a picture and a replay and, optionally, a way to contact you. You give us permission to use it to improve the game. Do not include personal information about other people.

*Basis:* `POST /api/feedback`, public and rate-limited (`packages/worker/src/feedback-ingest.ts`); optional `contact` up to 120 characters (`data/schemas/feedback.schema.json`); no IP stored. The prefilled GitHub issue never carries a token, name or contact (`CLAUDE.md`, "Hosting, telemetry, feedback"). [PUBLIC-ISSUE WARNING IF A FEEDBACK ITEM BECOMES A PUBLIC GITHUB ISSUE: lawyer].

## 9. Usage reports

When you play on the live site the game sends anonymous usage, crash and performance reports tied to a random ID. You can turn them off in Settings (Privacy), with `?notrack`, or with your browser's Do Not Track or Global Privacy Control signal. The privacy page says exactly what is sent and for how long it is kept.

*Basis:* `privacy-page.ts` sections "Anonymous usage, crash and performance reports" and "Play statistics"; opt-outs in `CLAUDE.md` ("?notrack").

## 10. Acceptable use

Do not cheat in versus, interfere with the service or other players, probe or attack our servers, scrape accounts, or use the game to harass anyone. You may report security problems to [SECURITY CONTACT, see `privacy-contact-proposal.md`]; we will not act against good-faith research.

*Basis:* the Worker is rate-limited and origin-checked (`packages/worker/src/origin.ts`, `rate-day.ts`); versus is lockstep with the Worker as relay (`CLAUDE.md`, package `net`).

## 11. Our rights in the game

The game's art, audio, data and text are [all rights reserved by OPERATOR]. You may play it for your own use; you may not copy, sell or redistribute the art and data. A few assets carry their own licences (credits screen, `art/ATTRIBUTION.md`).

*Basis:* art and data are "all rights reserved" since 2026-08-30 (`CONTRIBUTING.md`, `data/LICENSE.md`); Meshy-origin assets credited under CC BY 4.0 in `art/ATTRIBUTION.md` (`CLAUDE.md`, "What not to do"). Lawyer: reconcile with any open-licensed copies already distributed (`CONTRIBUTING.md` notes the irrevocable earlier grant).

## 12. The source code

The game's code is published separately under the PolyForm Noncommercial License 1.0.0 (`LICENSE`). That licence, and not these terms, governs what you may do with the code. Contributions are accepted under the Contributor License Agreement (`CLA.md`).

*Basis:* `LICENSE`, `CONTRIBUTING.md` "Licensing and sign-off", `CLA.md`.

## 13. Content and setting

The game is fiction. Its places, factions and people are invented, and its enemies are defined by tactics and doctrine, never by ethnicity, nationality or faith. It depicts armed conflict, including casualties among soldiers and civilians, without blood or gore. See the age-rating draft for the full description.

*Basis:* `docs/GDD.md` section 2; no gore: `docs/superpowers/specs/2026-08-04-unit-animation-design.md` ("No gore, no blood decals"). Lawyer: whether the story's real-world reference (see `README.md`, question 4) belongs here.

## 14. No guarantees, and our liability

The game is provided "as is". [WARRANTY DISCLAIMER, LIABILITY CAP, AND MANDATORY CONSUMER RIGHTS PER JURISDICTION: lawyer.]

## 15. Ending these terms

You may stop playing and delete your account at any time. We may suspend or end your access for breaking these terms. [SURVIVAL OF CLAUSES: lawyer.]

## 16. Changes, law and contact

We may change these terms; the date of the latest change is at the foot of the page, and we will tell signed-in players about material changes. These terms are governed by [GOVERNING LAW] and disputes go to [VENUE]. Contact: [LEGAL CONTACT, a role address, see `privacy-contact-proposal.md`].

---

### Items that need a lawyer before this can be used

1. Operator identity, governing law, venue, limitation of liability, and consumer-law carve-outs (clauses 1, 14, 16).
2. Whether a click-through acceptance is needed for guests, and how acceptance is recorded for accounts (the repository records none today **(not verified)**).
3. The paid-coin terms and refund regime before `PURCHASES_OPEN` is ever set (clause 6).
4. A reporting and moderation route for versus chat (clause 7).
5. The age number and how a younger person is handled (clause 3).
