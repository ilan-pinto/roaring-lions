**DRAFT for the lead and his lawyer. Not legal advice.**

# Terms of use (draft)

Not in force. Not served anywhere. Nothing in the game, the Worker or a store page links to it.

Written 18 Nov 2026 by an AI coding assistant from the repository at `origin/dev` `e1845a77e`. It replaces the draft of 15 Nov (PR 1475). The lead decides what goes to the lawyer. The lawyer decides what is true in law.

How to read it:

- **Square brackets** hold a fact or a choice only the lead or the lawyer can supply. Nothing in brackets is a guess to keep.
- **Basis** under each clause names the file the clause rests on. If the game changes, the clause may need to change too.
- **Open PR** marks a clause that describes a pull request not merged yet. Read it as "true once that PR lands".
- **Qn** points to the numbered open questions at the end. Those are legal choices. This draft does not make them.

---

## 1. Who we are

These terms are between you and [OPERATOR LEGAL NAME] of [OPERATOR ADDRESS] ("we", "us"). They cover Roaring Lions, a real-time strategy game that runs in your web browser at [GAME ADDRESS], and the online services behind it.

If you get the game through a store, that store's terms also apply. [Which terms win if they conflict: Q3.]

*Basis:* the hosted game is a static app plus a Cloudflare Worker (`wrangler.jsonc`, `packages/worker/src/index.ts`). The address today is `roaring-lions.pint12.workers.dev` (`README.md`, "Play it"). The repository names no legal entity (Q1).

## 2. Accepting these terms

By playing you accept these terms. [How they are shown, and whether acceptance is recorded: Q2.]

*Basis:* GH-1417 asks that "a terms document is served and shown at first run". Nothing serves or shows terms today, and no acceptance is recorded (searched `packages/app/src` and `packages/worker/src` for "terms"; not an exhaustive proof).

## 3. The game is free

The web game costs nothing to play. You do not need an account.

*Basis:* `README.md` ("Play it"); the campaign, free play and versus all run as a guest (`packages/worker/src/privacy-page.ts`, first paragraph).

## 4. Playing as a guest

As a guest, your progress is kept in your browser, on your device. We do not keep it on our server. If you clear your browser's site data, or use another browser, that progress is gone. We cannot bring it back.

*Basis:* the guest stores are browser `localStorage` keys `lions.settings`, `lions.saves`, `lions.brigade.account` and `lions.roar` (`CLAUDE.md`, "The shell"). A guest creates no account and stores no personal details on the server (`privacy-page.ts`).

## 5. An account (optional)

- An account keeps your progress on our server, so you can use it on more than one device.
- You sign in with Google. Steam sign-in is paused.
- We ask Google only for an account number. We do not get your email, name or picture.
- You must be at least [MINIMUM AGE] to sign in. [Whether a younger person may play as a guest: Q5.]
- You choose a display name. It must not pretend to be someone else, and it must follow section 8.
- You are responsible for what is done with your account.
- You can download your data and delete your account at any time, on the profile screen. Deletion cannot be undone.
- An account with no sign-in for 36 months is deleted.
- The person who runs the game can see your display name, Player ID and balances, can correct a coin balance, and can clear a display name. Every view and every change is logged. A change appears in your data download.

*Basis:* `privacy-page.ts` ("What is stored for a signed-in player", "What the team can see", "For how long", "Your copy and your deletion"; `PRIVACY_MIN_AGE = 16`, the lead's number); the Google `openid` scope only ("Signing in with Google"); Steam paused (`CLAUDE.md`, "Google sign-in (GH-1075 G1 to G5)"); the admin members page and its "blank" action (`packages/worker/src/stats.ts`, `/stats/api/members/blank`; `CLAUDE.md`, `/stats/members`). Nothing in the sign-in flow checks age; the page only states it (not verified by an exhaustive search).

## 6. Roar coins and brigade credits

The game has two in-game currencies. Neither costs money today.

- **Brigade credits** are earned by winning campaign missions. They unlock and upgrade units. They cannot be bought.
- **Roar coins** are free. You earn them by playing (a welcome grant, first wins, stars, the campaign, challenges) or from a coupon code. No coupon codes are issued today.
- **You cannot buy coins with real money.** Paid purchases are switched off.
- Today, coins can open a unit or an upgrade early, for **single-player** play only. Everything coins open can also be earned by playing.
- Coins, and anything bought with them, are never used in a match against another person. They never change a versus result.
- There are no random or chance-based items. You see what you get before you spend.
- Coins and credits have no cash value. You cannot sell them, swap them, or give them to another person. [Whether to call them a licence and not property: Q7.]
- We may change what coins buy. We plan to make coins buy **cosmetics only** (looks that never change a fight). When that happens, anything you already bought with coins stays yours.
- If real-money purchases ever open, these terms will change first. [Price, tax, refunds, chargebacks and store wallet terms: Q6.]

*Basis:* `PURCHASES_OPEN = false`, and the paid half clamped to 0 (`packages/economy/src/wallet.ts`); the earn sources `welcome`, `first_win`, `star`, `campaign`, `backfill`, `challenge` (same file, `EarnSource`); `data/coupons.json` is `{"coupons": []}`; coin buys of units and upgrade tiers (`wallet.ts`, `RoarReceipt` kinds `unit` and `tier`; `packages/economy/src/stores.ts`); `singlePlayerView` reads earned or coin-bought, `networkView` reads earned only (`wallet.ts` header); no random or paid-chance item (`docs/superpowers/specs/2026-09-28-st8-monetisation-content-plan.md`, test T7); credits (`README.md`, "The brigade"; `packages/sim/src/credits.ts`). **Open PR 1565** (HOLD FOR LEAD: money) adds the switch `COINS_COSMETIC_ONLY` beside `PURCHASES_OPEN`. It ships **off**. When on, coins buy cosmetics only, and coin-bought units and tiers are kept, through a brigade reset too. The cosmetics shelf is empty today.

## 7. Versus play and chat

- Versus is a one-against-one match. You open a room, or join one with its six-character room code. There is no public room list and no matchmaking.
- A seat can be a person (a guest or a member) or a computer opponent (a bot). A bot's operator may declare which AI model plays it.
- A player may invite an **AI advisor** that they run themselves. It talks only to that player. With "assist" it can also propose orders. A proposal is carried out after two seconds unless the player vetoes it. You are responsible for any bot or advisor you bring.
- Spectators are allowed only in bot-against-bot rooms. They see no chat.
- **Chat.** In a room you can type short messages (up to 280 characters) or pick a preset quick-chat phrase. The other player sees them.
- The room passes messages on and keeps none of them. We do not read chat, and nobody checks it before it is shown.
- **Your controls:** turn chat off in Settings; mute the other player for the rest of the room.
- **Word filter** (open PR 1492): your game hides lines with the worst words, and shows other swear words as `***`. It runs on your device only. You can turn the `***` masking off. You cannot turn the hiding off. A name with a filtered word shows as "Lion".
- **Block and report** (open PR 1502): you can block a signed-in player on this device. You can report a player's chat to us. A report holds the last messages your game received in that room (up to ten), the reason, your note, the map, the other player's public ID if they are a member, and a random session ID. We keep a report for 180 days. Only the person who runs the game reads reports. Nothing happens to the other player automatically, except that your game mutes them for the rest of that room.
- If you play versus while signed in, the match is recorded: the map, the sides, the result, the date, and whether the opponent was a member, a guest or a bot.

*Basis:* room codes (`packages/worker/src/match/code.ts`, `routes.ts`; `docs/superpowers/specs/2026-11-16-versus-chat-safety-design.md` section 1: "no public listing or matchmaking route was found"; lead ruling D10 on GH-1417: none until S1 to S4 ship); bot seats and `botModel` (`packages/worker/src/match/routes.ts`); the advisor (`packages/net/src/advisor.ts`, `packages/app/src/ui/advisor.ts`, `PROPOSAL_MS = 2000`); spectators (the chat safety design, D11; PR 1490); `CHAT_MAX_CHARS = 280` (`packages/net/src/protocol.ts`), one line per seat per 500 ms (`packages/worker/src/match/room-core.ts`, `CHAT_MIN_GAP_MS`), control and bidi characters removed (`packages/net/src/callsign.ts`); quick chat (`packages/app/src/ui/quick-chat.ts`, PR 1488); chat off and mute (`packages/app/src/ui/chat-inbox.ts`, `packages/app/src/settings.ts` `chat.enabled`, PR 1479); filter, block and report: open PRs 1492 and 1502, and the `/privacy` paragraph PR 1502 adds; recorded matches (`privacy-page.ts`, last bullet of "What is stored"). [What we may do about a player who breaks section 8: Q8.]

## 8. How you must behave

Do not:

- harass, threaten, bully or abuse anyone;
- post hateful content, or content that demeans people for their race, ethnicity, nationality, religion, sex, sexuality or disability;
- post sexual content, or anything that sexualises a minor;
- share anyone's personal details, your own included, in chat or in a name;
- pretend to be another player, the person who runs the game, or anyone else;
- cheat in versus: change the game to gain an edge, or interfere with a match or a room;
- attack, overload, probe or scrape our servers or other players' accounts;
- send false or abusive reports, or flood the feedback or report forms;
- use the game for anything unlawful.

If you find a security problem, tell us privately (section 13). [Whether to promise not to act against good-faith security research: Q9.]

*Basis:* the Worker is origin-checked and rate-limited (`packages/worker/src/origin.ts`, `rate-day.ts`); reports are capped at 5 a session per 10 minutes (lead ruling D7 on GH-1417; open PR 1502); versus is lockstep and both machines check every order (`packages/net`; `CLAUDE.md`, package layout).

## 9. Feedback you send

- The Feedback link on the menu, and a tab in the pause menu, send us a note. It carries the game version, the graphics card, the screen size and the mission state.
- You choose whether to add a screenshot, a replay (bugs only) and a way to contact you.
- After 180 days the screenshot, the replay, your contact and the IDs that link the note to you are removed. The note text and the game details stay.
- We may copy what a note says into a public issue on GitHub. That copy never carries your name, tester label, contact or IDs. A screenshot goes public only if we attach it by hand.
- Do not put other people's personal details in feedback.
- [What permission you give us to use your feedback: Q10.]

*Basis:* `README.md` ("Feedback"); `POST /api/feedback` (`packages/worker/src/feedback-ingest.ts`); the optional `contact`, up to 120 characters (`data/schemas/feedback.schema.json`); the 180-day purge (`packages/worker/src/feedback-triage.ts`, `RETENTION_MS`, `purgeExpired`); the prefilled GitHub issue is a step the lead takes by hand, and never carries a tester name, contact or id (`docs/superpowers/specs/2026-10-08-in-game-feedback-design.md` section 5.4; `CLAUDE.md`, "Hosting, telemetry, feedback"). The privacy request form and chat reports travel through the same endpoint, under their own rules (sections 7 and 13).

## 10. Usage reports

On the live site, the game sends anonymous usage, crash and performance reports, tied to a random ID. They are kept until about 180 days after the ID was last seen. Turn them off in Settings (Privacy), with `?notrack` in the address, or with your browser's Do Not Track or Global Privacy Control setting. The privacy page at `/privacy` lists exactly what is sent.

*Basis:* `privacy-page.ts`, "Anonymous usage, crash and performance reports"; `EVENTS_RETENTION_MS` = 180 days (`packages/worker/src/ingest.ts`).

## 11. The code, the art and the data

- **The code** is source-available under the PolyForm Noncommercial License 1.0.0 (the file `LICENSE`). That licence, not these terms, says what you may do with the code. Copies taken while the code was under MIT (before 18 Sep 2026) stay under MIT.
- **Contributions** are accepted under the Contributor License Agreement (`CLA.md`), with a DCO sign-off.
- **The art, sound, data and text** (everything under `data/`, `art/` and `assets/`) are all rights reserved, apart from the third-party material below. You may play the game. You may not copy, sell or share the art or data outside it. Copies taken while it was under CC BY-SA 4.0 (before 30 Aug 2026) stay under that licence.
- **Third-party material keeps its own licence.** These terms take away no right you have under it:
  - libraries such as three.js (MIT) and Rapier (Apache-2.0);
  - fonts under the SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`);
  - sound under CC0, each file with its source (`data/audio.json`);
  - a courtesy credit to Meshy, under CC BY 4.0, for AI-generated 3D art (`art/ATTRIBUTION.md`);
  - chat word lists adapted from LDNOOBW, CC BY 4.0, Shutterstock (`data/chat/LICENSES.md`; the lists arrive with open PR 1492).
- The credits screen lists the libraries, the fonts and the AI-generated material.

*Basis:* `LICENSE`; `CONTRIBUTING.md`, "Licensing and sign-off"; `CLA.md`; `data/LICENSE.md`; `art/ATTRIBUTION.md`; `data/chat/LICENSES.md`; the credits screen (`packages/app/src/credits-data.ts`, `packages/app/src/ui/credits.ts`). Licence counts read from `data/audio.json` on 18 Nov: 60 `CC0-1.0`, 25 `LicenseRef-owned`, 3 `CC-BY-4.0`. The three CC BY files are the project's own AI-generated music, credited to the project lead, with "generator and plan unrecorded" (`data/audio.json` `music`; `docs/ASSET_PROVENANCE.md`, Status item 3). See Q11 and Q18.

## 12. The setting

The game is fiction. Its countries, towns, factions and people are invented. Enemies are defined by how they fight, never by ethnicity, nationality or faith. The game shows war, including harm to civilians and people taken captive, without blood or gore.

*Basis:* `docs/GDD.md` section 2; `docs/campaign/storyline.md` (the naming rule in section 2.4; D12). The detail is in `age-rating-questionnaire-draft.md`. [Whether to say anything about the story's real-world reference: Q12.]

## 13. Contact

- **Your data** (a copy, an export, a deletion or a correction): use the private request form at `/privacy/request`. It is read only by the person who runs Roaring Lions, and it is never posted to GitHub.
- **Security problems:** use GitHub's private vulnerability reporting, as `SECURITY.md` and `/.well-known/security.txt` say.
- **Anything else about these terms:** [LEGAL CONTACT: Q4].

*Basis:* open PR 1481 (the form, `SECURITY.md`, `security.txt`); the lead's rulings C1 to C5 on GH-1417. The exact wording is in `privacy-contact-paragraph.md`.

## 14. No promises about availability

- The game is provided "as is" and "as available".
- It may have bugs. It may be slow, offline, changed or stopped at any time.
- Features can be switched off without a new release: accounts, Google sign-in, feedback, the privacy form and chat reports each have a switch.
- Saves and progress can be lost, on your device or on our server.
- [Warranty wording, any cap on liability, and the consumer rights no contract can remove: Q13.]

*Basis:* the D1 `flags` rows `accounts`, `google`, `steam`, `admin` and `feedback`, and the `FEEDBACK_CLOSED` switch (`CLAUDE.md`, "Dev instruments"); Steam sign-in is paused today.

## 15. Ending

- **You** can stop playing at any time. With an account, you can delete it on the profile screen.
- **We** may [suspend or close an account, or keep a player out of versus,] if these terms are broken (Q8).
- **We** may close the online services. [The notice period, and what happens to accounts and coins then: Q14.]
- [Which sections survive the end of these terms: Q15.]

*Basis:* "Delete my account" (`privacy-page.ts`). No tool to suspend or ban an account was found. The admin page can clear a display name and correct a balance, nothing more (`packages/worker/src/stats.ts`, `packages/worker/src/admin/`; not an exhaustive search).

## 16. Changes to these terms

We may change these terms. The date at the foot shows the latest change. [How we tell players about an important change, and whether they must accept again: Q16.]

## 17. Law and disputes

[Governing law, courts, and any dispute process: Q17.]

---

Last updated [DATE AT PUBLICATION].

---

## Open questions for the lead and the lawyer

This draft answers none of these. Each lists options, not a choice.

1. **Q1 Operator.** Who is the contracting party: the lead as a person, or a company? Its name and address are needed here and on the privacy page.
2. **Q2 Showing and accepting.** Options: a Worker-served, script-free `/terms` page like `/privacy`, linked from the menu; a first-run notice in the shell with a link; a click-to-accept at sign-in only; a click-to-accept for everyone. Must acceptance be recorded, and where? A guest has no server record.
3. **Q3 Store terms.** When a store build exists (Steam, GH-200), which terms win: the store's, these, or a split by topic?
4. **Q4 General contact.** C1 ruled out an email address for privacy requests. Do the terms need a general or legal contact? Options: the feedback form; a GitHub link; a postal address; a role address on a domain the operator owns.
5. **Q5 Minimum age.** The privacy page says 16 (`PRIVACY_MIN_AGE`). Options: 16 everywhere; a floor per market; a separate floor for versus chat. Is stating the age enough, or is an age question needed? What do the terms say about a guest under the floor?
6. **Q6 Paid coins.** Before `PURCHASES_OPEN` is ever true: price display, tax, refund and withdrawal rules, chargebacks, and whether the store's wallet terms cover the sale.
7. **Q7 What coins are.** Say coins are a revocable licence with no property right, or say nothing? What may happen to a balance when an account is deleted or closed, or the service ends?
8. **Q8 Enforcement.** What may the operator do to a rule-breaker? Options: nothing beyond the player's own mute and block; clear a name (possible today); keep a member out of versus; close an account. Anything beyond clearing a name needs a tool that does not exist yet. What notice or appeal is owed?
9. **Q9 Security research.** Promise not to act against good-faith research, or stay silent?
10. **Q10 Feedback permission.** What does a sender grant: nothing stated; a licence to use the note to improve the game; a licence to publish a summary on GitHub?
11. **Q11 `data/LICENSE.md` carve-out.** The file claims all rights over `data/`. CC BY 4.0 forbids adding restrictions to the word lists in `data/chat/third_party/`. The carve-out text (proposed in PR 1484, flagged again in PR 1492) is the lead's; the review is the lawyer's.
12. **Q12 Real-world reference.** The opening's chain of events follows a real attack, moved entirely into fiction (`docs/campaign/storyline.md`, D12). Options: say nothing; a short note in the terms; a note on the store page only.
13. **Q13 Liability.** Warranty wording, any cap, and the consumer protections that apply anyway in each market where the game is offered.
14. **Q14 Shutdown.** How much notice before the online services close? Is a final data download offered?
15. **Q15 Survival.** Which sections outlast the terms (licences, feedback permission, liability, law)?
16. **Q16 Changes.** How is a change announced: a date on the page only; a notice at next sign-in; a fresh acceptance?
17. **Q17 Law and venue.** Governing law and courts, or a dispute process.
18. **Q18 Music provenance.** The main theme and the mission music cut from it are AI-generated, with the generator and plan unrecorded (`docs/ASSET_PROVENANCE.md`, Status item 3), yet `data/audio.json` lists them as CC BY 4.0. What rights does the operator hold in them, and is CC BY the right label?
