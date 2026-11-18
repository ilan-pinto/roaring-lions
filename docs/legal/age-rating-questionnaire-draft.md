# Age-rating questionnaire: pre-filled draft

**DRAFT. NOT LEGAL ADVICE. A starting point for the lead and the lawyer; not submitted to any rating body.** Written 15 Nov 2026 from the repository at `main` v0.133.10.

The usual rating questionnaires (IARC, which several storefronts use, and each board's own) ask about the same themes. I do not have any form's exact wording or current question list, so the answers below are organised by theme, in plain words, to be copied across onto whichever form a storefront shows. Every answer says what the game does, the repository fact behind it, and a confidence mark:

- **FACT**: read straight from a file I cite.
- **CHECKED**: I searched for evidence and found none; weaker than a proof of absence.
- **JUDGEMENT**: a classification a rater makes (how "realistic" violence is); the facts are listed, the label is theirs.

Answers describe the game **as built today**. Where a planned feature would change an answer, it says so.

---

## 0. One-paragraph description (for the form's free text)

Roaring Lions is a real-time strategy game set in a fictional region, played in a browser or through a store build. The player commands a modern-style army brigade (infantry, tanks, drones, air and artillery support) in missions that mix fighting with protecting civilians. Enemies are defined by their tactics, never by ethnicity, nationality or faith. Combat is resolved realistically but is shown without blood or gore. There is an optional online one-versus-one mode with text chat, an optional account, and a free in-game currency that cannot currently be bought.

*Basis:* `docs/GDD.md` section 2 (fiction; doctrine not ethnicity); `README.md`.

---

## 1. Violence

| Question | Draft answer | Basis | Mark |
|---|---|---|---|
| Does the game depict violence against humans? | **Yes.** Soldiers and, in some missions, civilians are units that can be killed. Combat is firepower from a distance (rifles, tanks, missiles, artillery, air strikes), seen from above at a strategic zoom. | Units have hit points and die (`data/units/*`); civilians are a unit type with 200 hp (`data/units/civilians.json`); the camera is a fixed dimetric view (`CLAUDE.md`, "dimetric RTS") | FACT |
| Is it realistic or fantasy? | **Realistic military setting** (modern-style weapons, a fictional country), stylised and distant. | GDD sections 2 and 5 | JUDGEMENT |
| Is there blood or gore? | **No.** There is no blood and no gore: infantry that fall leave a subdued prone form, and the art pipeline's palette gate would reject red-spectrum additions; the store catalogue rules bar "blood, or any mark that counts or celebrates killing". | `docs/superpowers/specs/2026-08-04-unit-animation-design.md` ("No gore, no blood decals"); `docs/superpowers/specs/2026-10-11-monetisation-content-plan.md` line 214; a search of `data/`, `docs/GDD.md` and the render/app source found "blood" only in a palette note about skin tone **(CHECKED)** | FACT + CHECKED |
| Dismemberment, graphic injury, torture? | **No.** | Same sources. A wounded infantryman is a one-man entity with a bleed timer who crawls to cover and can be rescued; it is a game state, not a graphic depiction (`docs/superpowers/specs/2026-10-22-wounded-rescue-design.md`, section 1: `bleed_s`, `crawl_tiles_s`). | FACT; the depiction itself is JUDGEMENT |
| Physics-driven falling bodies? | A dying infantry figure may fall as a linked-body "ragdoll" (presentation only). It is **off in every shipped quality preset today**; the plan is to switch it on at the higher presets. | `docs/superpowers/specs/2026-11-10-presentation-physics-design.md`; `GH-1400` brief (`physics.ragdolls` is 0 on every preset in `packages/render/src/quality.ts`). **Re-answer if it ships.** | FACT |
| Does the game encourage violence against civilians? | **No: it penalises it.** Harm to protected people and places costs the player a rules-of-engagement score that can fail a mission; restraint is rewarded, and a routed enemy that is approached surrenders and becomes a prisoner, which scores credit where kills score nothing. | `docs/GDD.md` sections 5.5a and the ROE rule ("you always know what a shot will cost before taking it"); mission `roe` block in `data/schemas/mission.schema.json` (`no_collateral_above`, `fail_below`) | FACT |
| Are real people, places or events depicted? | The setting is **entirely fictional**: no real name, place, date, flag, faith or people. **One point for the lawyer:** the lead's structural reference for the opening mission is a real event, "transposed entirely into the fiction" (`docs/campaign/storyline.md`, D12); that mission shows 11 civilians outside a wire and counts 2 in, with a briefing saying nobody is coming back for the rest. | `docs/GDD.md` section 2; `docs/campaign/storyline.md` D12 and the "atrocity" row for the mission `beit_sahwan_breach` | FACT; whether a board treats that as "based on real events" is the lawyer's |
| Violence in text or story? | The story contains war, loss and the aftermath of an attack on civilians, told in briefings and radio lines; the atrocity is **not shown** on screen as an event. | `data/missions/*`; the generated text catalogue `data/locales/en/missions.json` (631 strings) | FACT; the "not shown" is based on the mission data and design, not a playthrough **(not verified in play)** |

## 2. Fear, horror, disturbing content

**None intended.** No horror, jump scares or supernatural content. The subject matter (war, civilian harm) is the only disturbing theme. *Mark:* JUDGEMENT. *Basis:* GDD; no horror genre anywhere in the design documents **(CHECKED)**.

## 3. Sexual content, nudity

**None.** *Mark:* CHECKED. A search of the English text catalogues (chrome and missions) for sexual terms found none, and there are no character models other than uniformed soldiers and civilians. *Basis:* `packages/app/src/i18n/en.json`, `data/locales/en/missions.json`, `art/meshes/`.

## 4. Bad language

| Question | Draft answer | Basis | Mark |
|---|---|---|---|
| Profanity in text? | **None found.** A search of all 31,962 words of English text for eight common profanities returned zero hits (the words are fuck, shit, bitch, bastard, cunt, piss, whore, damn). | `packages/app/src/i18n/en.json`, `data/locales/en/missions.json`, `data/locales/en/units.json` | CHECKED |
| Profanity in recorded voice? | **Not reviewed.** Unit barks are in Hebrew (KDF) and Arabic (enemy factions). Only 24 Hebrew files exist today, none for Arabic yet; each line carries a transliteration and an English gloss in the manifest, which a reviewer can read. | `data/audio.json` `voices`; `CONTRIBUTING.md` (voice rules) | **(not verified)**: someone should read the `en` gloss of every shipped line before submitting |
| Language in player chat? | The game cannot control it: see section 7. | | |

## 5. Drugs, alcohol, tobacco, gambling

| Question | Draft answer | Basis | Mark |
|---|---|---|---|
| Drugs, alcohol, tobacco depicted or referenced? | **None found.** (Text search hits for "smoke" are smoke screens.) | text catalogues | CHECKED |
| Gambling or simulated gambling? | **No.** There are no chance-based purchases, loot boxes or random rewards, and the store rule forbids any. | `docs/superpowers/specs/2026-09-28-st8-monetisation-content-plan.md`, test T7 ("No random or paid-chance item of any kind") | FACT (a rule, not yet a store; re-check when purchases open) |

## 6. Digital purchases

| Question | Draft answer | Basis | Mark |
|---|---|---|---|
| Can players spend real money in the game? | **Not today.** A free currency, Roar coins, exists and is earned in play or granted by coupon; it buys units and upgrade tiers in the Stores, as brigade credits earned in play do. `PURCHASES_OPEN` is false and the paid balance is clamped to zero. **The plan** is to sell Roar coins through Steam; on 18 Nov 2026 the lead ruled that coins buy units, so coins bought with money are planned to buy units and upgrade tiers, beside cosmetics and operation passes. **Re-answer this section the day purchases open.** | `packages/app/src/roar-wallet.ts` header; `packages/economy/src/stores.ts`; the lead's ruling of 18 Nov 2026 (GH-1378, GH-1415) | FACT (today); FACT (a plan) |
| Do purchases affect competition between players? | **Only in a room that opts in.** A versus room ignores everything a player owns unless its host turns on "bring your brigade" (off by default); in such a room each player fields the units and upgrades they own, including those bought with coins (free coins today). Coins are never earned or spent in versus. Whether units bought with paid coins may be used against a person is not yet ruled. | `packages/app/src/net/connect.ts` (owned kit sent only for `kit: 'brigade'`); `packages/app/src/account-view.ts` (`singlePlayerView`); `packages/app/src/net/coin-claim.test.ts` | FACT (today); **UNCERTAIN** (the plan, lead to rule) |
| Is the currency tied to chance or to timers? | No. Items are known before purchase and are permanent. | tests T7, T8 | FACT |

## 7. Online interaction and user-generated content

| Question | Draft answer | Basis | Mark |
|---|---|---|---|
| Can players communicate with each other? | **Yes, in versus rooms only:** typed text messages of up to 280 characters, one every 500 ms, between the players in a room (and visible to spectators of that room **(not verified)**). No voice chat. | `packages/net/src/protocol.ts` (`CHAT_MAX_CHARS` 280); `packages/worker/src/match/room-core.ts` (`CHAT_MIN_GAP_MS` 500, `cleanChat` strips control and bidi characters) | FACT |
| Is chat moderated or filterable? | **No word filter, mute, block or report feature was found.** The only control is character cleaning and the rate limit. | search of `packages/net/src`, `packages/app/src/net`, `packages/worker/src/match` for profanity, moderat*, mute, block, report: only unrelated audio "mute" hits | CHECKED. **A gap a rating board and a lawyer will ask about.** |
| Can players share personal information? | A player could type it in chat or into the optional feedback contact field. The game does not ask players for personal details beyond an optional contact in the feedback form and a sign-in through Google (account number only). | `data/schemas/feedback.schema.json` (`contact`); `packages/worker/src/privacy-page.ts` | FACT |
| User-generated content other players see? | **Names and chat only.** A player-chosen display name and callsign (24 characters, cleaned) are shown to others. There is no player-made map, image or mod sharing in the product. | `packages/net/src/callsign.ts`; GDD section 10 (map editor and mod loader are deferred) | FACT |
| Does the game connect players to strangers? | Versus rooms are joined by invitation (a room) and can include bots; whether there is open matchmaking by stranger is a lobby detail **(not verified; the lead should state it)**. | `packages/net`, `packages/worker/src/match` | not verified |

## 8. Location, accounts, data

| Question | Draft answer | Basis | Mark |
|---|---|---|---|
| Does the game share the player's location? | **No.** No location is collected; no IP or user agent is stored. | `packages/worker/src/privacy-page.ts`, "What is never stored" | FACT |
| Does it collect personal information? | **Little.** Optional account: the identity provider's account number (Google "sub", or a SteamID64 if Steam is linked), a chosen display name, progress data; no email, name or picture. Anonymous usage reports use a random ID and can be turned off. | `privacy-page.ts` | FACT |
| Minimum age for an account | **16** (the lead's number); guests need no account. | `PRIVACY_MIN_AGE` in `privacy-page.ts` | FACT; the number is the lead's |
| Does it have unrestricted web access or social features? | **No** browser, no social feed, no friends list. | `CLAUDE.md` package layout | FACT |

## 9. Anything else a rater may want to know

- **No audio recordings of real events, no real military footage.** Audio assets are CC0 or owned/commissioned, declared in `data/audio.json` with a licence and source (`CONTRIBUTING.md`). *(FACT; the manifest enforces it with `pnpm validate:audio`.)*
- **AI-generated assets exist in the pack** (3D models from a generative tool, credited in `art/ATTRIBUTION.md`); some storefronts ask. *(FACT: `CLAUDE.md`, "What not to do".)*
- **Setting sensitivity.** A fictional region whose terrain and palette are modelled on the eastern Mediterranean (the project's terrain notes, `CLAUDE.md` "Domain skills"), with unit voices in Hebrew and Arabic. The GDD's rule is that language is the one real-world marker admitted, admitted symmetrically, with faith and ethnicity excluded (section 2). *(FACT; whether a board reads it as a real-world conflict is JUDGEMENT.)*

---

## What I expect a board to land on, and the three things that might move it

I am **not** predicting a rating. For the lawyer's planning: realistic military violence against humans with no blood is a common profile for strategy games; what could move it up or draw questions are (1) the authored civilian-atrocity mission and its real-world reference, (2) unmoderated player chat, and (3) paid currency once purchases open.

## To close before submitting

1. Read the English gloss of every shipped voice line (section 4).
2. State whether versus has stranger matchmaking (section 7).
3. Decide on a chat report/mute route, or answer the form's "unmoderated" question honestly (section 7).
4. Re-answer sections 1 (ragdoll) and 6 (purchases) when either ships.
5. Have the lawyer read the real-world-reference row (section 1) and decide how it is described.
