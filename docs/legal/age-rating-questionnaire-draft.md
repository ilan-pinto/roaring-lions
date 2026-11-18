**DRAFT for the lead and his lawyer. Not legal advice.**

# Age-rating questionnaire: prepared answers (draft)

Not submitted to any rating body or storefront. Written 18 Nov 2026 by an AI coding assistant from the repository at `origin/dev` `e1845a77e`. It replaces the draft of 15 Nov (PR 1475).

**What this is.** Storefronts that use IARC, and the rating boards, ask about the same themes: violence, fear, sex, language, drugs, gambling, discrimination, and the interactive elements (players talk to each other, location is shared, things can be bought, the open web can be reached). I do not have any form's current wording. So the questions below are in plain words, grouped by theme, to be matched by hand to whatever form the store shows. **I do not predict a rating.**

**The certainty column:**

- **FACT**: read straight from the file in the source column.
- **CHECKED**: I searched for it and found nothing. That is weaker than proof that it is absent.
- **JUDGEMENT**: the facts are given; the label (how realistic, how strong) is the rater's.
- **UNCERTAIN**: I could not settle it from the repository. Someone must check before a form is filed. Every one of these is also listed in section 10.

Answers describe the game **as built on `dev` today**. "Open PR" marks an answer that changes when that pull request lands.

---

## 0. A short description for the form's free text

Roaring Lions is a real-time strategy game, played in a web browser, set in an invented region. The player commands a modern army brigade (infantry, tanks, drones, aircraft, artillery) from a high, fixed camera. Missions mix combat with protecting civilians, and harming civilians costs the player. Enemies are defined by their tactics, never by ethnicity, nationality or faith. There is no blood or gore. There is an optional one-against-one online mode with text chat, an optional account, and a free in-game currency that cannot be bought with money.

*Source:* `docs/GDD.md` section 2 and 5.5a; `README.md`; `packages/economy/src/wallet.ts` (`PURCHASES_OPEN`).

---

## 1. Violence

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 1.1 | Does the game show violence against people? | **Yes.** Soldiers fight with rifles, machine guns, rockets, tanks, missiles, mortars, artillery, drones and air strikes. Soldiers can be killed. Civilians can be killed or wounded by area fire and strikes. | units and weapons in `data/units/**`; civilians are a unit with 200 hp in 25 of the 35 mission files (`data/units/civilians.json`, `data/missions/*.json`); strikes shake "everyone nearby ... including civilians" (`packages/sim/src/sim.ts`, `stepStrikes`) | FACT |
| 1.2 | Can the player target civilians directly? | **No.** An order to attack a civilian is refused. Civilians are hurt only as collateral, and that is charged to the player. | `canFocus` refuses a civilian target (`packages/sim/src/sim.ts`; test "attack on a civilian ... is refused" in `packages/sim/src/focus.test.ts`) | FACT |
| 1.3 | Is harming civilians rewarded or punished? | **Punished.** A rules-of-engagement (ROE) score falls with harm to civilians and protected buildings, and a mission can fail on it. Routed enemies who are approached, not shot, surrender and become prisoners. Prisoners score where kills score nothing. | `docs/GDD.md` 5.5a; mission `roe` block (`data/schemas/mission.schema.json`, `no_collateral_above`, `fail_below`); civic-hall `m` tiles on nine maps (`CLAUDE.md`, "ROE") | FACT |
| 1.4 | How close and how detailed is it? | **Distant and small.** A fixed high (dimetric) camera. A soldier is a few pixels tall at play zoom; a face is about six pixels. | `CLAUDE.md` ("dimetric RTS"); `data/palette.json`, the skin note ("a face is about six pixels at gameplay zoom") | FACT; "detailed" is JUDGEMENT |
| 1.5 | Realistic or fantasy? | **Realistic modern military setting**, with invented countries. Combat is resolved realistically (armour, penetration, suppression). Shown at a strategic distance. | `docs/GDD.md` sections 2 and 5; `CLAUDE.md` ("realistic combat resolution") | JUDGEMENT |
| 1.6 | Blood? | **None found.** No blood effect, decal or texture. The ground marks are crater, scorch, oil, rubble, tread, tyre, churn and scuff. A fallen soldier is "a subdued prone form". | decal kinds (`packages/render/src/three/decal-maths.ts`, `DecalKind`); the 40 files in `data/vfx/` (impacts, fire, smoke, dust, wrecks; none for blood); `docs/superpowers/specs/2026-08-04-unit-animation-design.md` ("No gore, no blood decals"); the word "blood" appears in the repository data only in a palette note about skin tone (`data/palette.json`) | CHECKED |
| 1.7 | Gore, dismemberment, torture? | **None found.** | same sources as 1.6 | CHECKED |
| 1.8 | Wounded people? | **Yes, as a game state.** A hit soldier or civilian may become "wounded": one prone figure that bleeds out on a timer (a ring with a "bleed arc" shows the time) unless a medic reaches him. Players can rescue enemy and civilian wounded too, and are rewarded for it. | `docs/superpowers/specs/2026-10-22-wounded-rescue-design.md` (sections 0 and 1; conduct gains for rescued enemy and civilian wounded); `hull.wounds` on 21 unit types (`CLAUDE.md`, "Wounds and rescue"); the `wounded-read` layer (`packages/render/src/three/debug-layers.ts`) | FACT; how it reads on screen is JUDGEMENT |
| 1.9 | Bodies falling with physics (ragdolls)? | **Not shipped.** Ragdolls exist in code but are **0 on every quality preset**. A dying figure plays an animated fall. Re-answer if ragdolls are switched on. | `packages/render/src/quality.ts` (`physics: { ragdolls: 0 }` on `low`, `medium` and `high`; the lead's ruling L4, 10 Nov) | FACT |
| 1.10 | Vehicles destroyed? | **Yes.** Destroyed vehicles become burnt, damaged wrecks that smoulder. Buildings can be holed and collapse. | vehicle `wreck` clips and the damage pass (`CLAUDE.md`, "Mesh units"); `data/vfx/catastrophic_kill.json`, `wreck_smoulder.json`, `structure_collapse.json` | FACT |
| 1.11 | Suicide attacks? | **Yes, as an enemy unit.** One enemy unit, the "Suicide Squad", carries explosive vests and blows itself up next to its target. It appears in 7 mission files. The detonation is an explosion effect; no gore. | `data/units/enemy/charge_squad.json` (`"name": "Suicide Squad"`, ability `kamikaze`, weapon `vest`, type `demolition`); `data/locales/en/units.json`; 7 files in `data/missions/` name `charge_squad` | FACT. **UNCERTAIN** how a board weighs it: flag for the lawyer |
| 1.12 | Violence in the story? | **Yes, told, not shown.** The story includes a surprise attack on a base and villages, families killed, and people abducted. These are told in briefings and radio lines and through mission goals, "never depicted". Later missions include rescuing a captive from a house and the handover of four captives during a pause in fighting. An enemy holds a position inside a clinic block among sheltering residents. | `docs/campaign/storyline.md` D12 ("shown through mechanics and stated in the story voice, never depicted"); mission text in `data/locales/en/missions.json` (the "people taken at First Light", "bring all four of the taken south of the Cut", the clinic block) | FACT for the text. **UNCERTAIN** that nothing is shown on screen: this rests on the design and the data, not on a playthrough |
| 1.13 | Based on real events? | **The setting is fiction:** no real name, place, date, flag, faith or people. **But** the lead's structural reference for the opening is a real attack (7 October 2023), "transposed entirely into the fiction". | `docs/GDD.md` section 2; `docs/campaign/storyline.md` D12 | FACT. **UNCERTAIN** how to answer a form that asks this: the lawyer's call |

## 2. Fear and horror

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 2.1 | Horror, jump scares, the supernatural? | **None.** | no horror genre or content in the design documents (`docs/GDD.md`, `docs/campaign/storyline.md`) | CHECKED |
| 2.2 | Disturbing themes? | **War, loss, civilian harm, captives.** See 1.11 to 1.13. | as above | JUDGEMENT |
| 2.3 | Distressing sound? | One shipped Hebrew voice take is "a shout ... check it is a call and not a scream". A medic call ("Medic!") exists. | `data/audio.json` `voices.lines` (`en` glosses) | **UNCERTAIN**: not heard |

## 3. Sex and nudity

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 3.1 | Sexual content or nudity? | **None found.** The figures are uniformed soldiers and dressed civilians. No sexual words in the game's English text. | search of `packages/app/src/i18n/en.json` and `data/locales/en/*.json` (about 40,800 words, keys included) for sex, sexual, naked, nude, rape, kiss: 0 hits; `art/meshes/` | CHECKED |

## 4. Language

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 4.1 | Swearing in the game's own text? | **None found.** | the same search for fuck, shit, bitch, bastard, cunt, piss, whore, damn, hell, crap: 0 hits | CHECKED |
| 4.2 | Swearing in recorded voice? | **Probably none, not confirmed.** 12 Hebrew voice takes ship; no Arabic yet. Their English glosses hold no swearing. Several glosses say "unverified by ear", and one says "colloquial ... check by ear". Some takes are AI-generated stand-ins, to be left out of a commercial release. | `data/audio.json` `voices.lines` (`he` 12 variants, `ar` 0); `en` glosses; `packages/app/src/i18n/en.json` `credits.ai.audio` | **UNCERTAIN**: a Hebrew speaker should hear every shipped take |
| 4.3 | Swearing from other players? | **Possible.** Players can type free text in versus chat. See section 7. | `packages/net/src/protocol.ts` (`CHAT_MAX_CHARS`) | FACT |

## 5. Drugs, alcohol, tobacco

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 5.1 | Shown or mentioned? | **None found.** Hits for "smoke" are smoke screens and burning. One enemy faction's doctrine includes "smuggling"; no goods are named in the text. | search of the English text for drug, alcohol, beer, wine, cigarette, tobacco, cocaine, heroin, hashish, narcotic, drunk: 0 hits; `docs/GDD.md` section 2 (Rif Cells: "technicals, raids, smuggling") | CHECKED |

## 6. Gambling and chance

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 6.1 | Real or simulated gambling? | **None found.** | search for gamble, gambling, casino, bet: 0 hits | CHECKED |
| 6.2 | Loot boxes or random paid items? | **No.** No random, mystery or chance item of any kind, paid or free. Every item is shown before it is bought, and is permanent. | the store rule T7, "No random or paid-chance item of any kind" (`docs/superpowers/specs/2026-09-28-st8-monetisation-content-plan.md`); search of `packages/economy/src` and the Stores UI for loot, crate, mystery, spin, gacha: 0 hits | FACT (a rule) + CHECKED |

## 7. Players interacting

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 7.1 | Can players talk to each other? | **Yes, in versus rooms only.** Typed text (up to 280 characters, one line per 500 ms) and preset quick-chat phrases, between the two players of one room. No voice chat. Spectators (bot-against-bot rooms only) get no chat. | `packages/net/src/protocol.ts` (`CHAT_MAX_CHARS`, quick chat by id); `packages/worker/src/match/room-core.ts` (`CHAT_MIN_GAP_MS`); `packages/app/src/ui/quick-chat.ts`; D11 (PR 1490) | FACT |
| 7.2 | Who can a player meet? | **Anyone who has the room code.** Rooms are opened and joined by a six-character code. There is no public room list and no matchmaking. A code posted in public can still seat a stranger. | `packages/worker/src/match/code.ts`, `routes.ts`; the chat safety design, section 1; lead ruling D10 (no public listing until S1 to S4 ship) | FACT |
| 7.3 | Is chat checked or filtered? | **Not checked by anyone before it is shown.** The room passes lines on and stores none. Controls on `dev` today: chat off (Settings), and mute a player for the rest of the room. **Open PR 1492** adds a word filter on the receiving device (hide the worst words, mask others; English sorted, de, es-ES, fr, ru mask-only; filtered names show as "Lion"). **Open PR 1502** adds block (members, this device) and report (sent to the person who runs the game, kept 180 days, no automatic action). An operator kill switch for reports is ruled (D8). | `packages/app/src/ui/chat-inbox.ts`, `packages/app/src/settings.ts` (`chat.enabled`, PR 1479); PRs 1492 and 1502; lead rulings D1 to D12 on GH-1417 | FACT for `dev`. **UNCERTAIN** wording: re-answer when 1492 and 1502 land; how to describe "unmoderated chat with controls" is the lawyer's |
| 7.4 | Can players share personal details? | **They could type them.** Chat, a callsign, a display name and the feedback contact field are free text. The game asks for no personal details. Report text and privacy requests go only to the person who runs the game. | `packages/net/src/callsign.ts`; `data/schemas/feedback.schema.json` (`contact`); `packages/worker/src/privacy-page.ts` | FACT |
| 7.5 | Content made by players that others see? | **Names and chat only.** A callsign (24 characters) and, for members, a display name. Avatars are preset crests. No shared maps, mods or pictures. | `packages/net/src/callsign.ts`; `data/avatars/presets.json`; an avatar upload is designed and its validator exists (`packages/worker/src/account/avatar-image.ts`) but no upload route was found, and the design says only the owner would see one (`docs/superpowers/specs/2026-11-14-avatars-and-profile-design.md` 5.5) | FACT; **UNCERTAIN** if avatar upload ships |
| 7.6 | Computer-controlled players? | **Yes.** A seat can be a bot. A player can also invite an AI advisor they run themselves; its text reaches only that player. | `packages/worker/src/match/routes.ts` (`kind`, `botModel`); `packages/net/src/advisor.ts` | FACT |

## 8. Location, web access, data

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 8.1 | Does the game share or collect the player's location? | **No.** No location is collected or shown to other players. The game stores no IP address. Cloudflare's own request logs record the address of each request. | `privacy-page.ts`, "What is never stored" (location, IP address) and "What Cloudflare keeps"; no `navigator.geolocation` in `packages/app/src` | FACT + CHECKED |
| 8.2 | Open web access, a browser, social sharing? | **No.** No in-game browser, no social feed, no friends list, no share button. External links found in the app: the three.js and Rapier sites on the credits screen. Google sign-in opens Google's page. | search of `packages/app/src` (non-test) for external URLs, `navigator.share` and social sites | CHECKED |
| 8.3 | Personal data collected? | **Little.** With an optional account: Google's account number (or a SteamID64 if Steam was linked), a display name, a random Player ID, progress, coins and save slots. No email, name or picture. On the live site, anonymous usage, crash and performance reports tied to a random ID, kept until about 180 days after last seen; they can be turned off. Feedback can carry an optional contact, removed after 180 days. | `privacy-page.ts`; `packages/worker/src/ingest.ts` (`EVENTS_RETENTION_MS`); `packages/worker/src/feedback-triage.ts` (`RETENTION_MS`) | FACT |
| 8.4 | Minimum age? | **16 to sign in** (the lead's number). No age check in the sign-in flow; the page states it. Playing as a guest needs no account. | `PRIVACY_MIN_AGE = 16` (`privacy-page.ts`) | FACT. **UNCERTAIN** whether that is enough: Q5 in the terms draft |

## 9. Purchases

| # | Question | Draft answer | Source in repo | Certainty |
|---|---|---|---|---|
| 9.1 | Can players spend real money? | **No, not today.** Paid purchases are switched off, and no code raises the paid balance. | `PURCHASES_OPEN = false` and the paid half clamped to 0 (`packages/economy/src/wallet.ts`) | FACT. **Re-answer the day purchases open** |
| 9.2 | Is there a digital currency? | **Yes, free.** Roar coins, earned by play or from a coupon (none issued). Today they open single-player units and upgrades early; all can also be earned by play. **Open PR 1565** adds a switch (shipped off) so coins buy cosmetics only. | `wallet.ts` (`EarnSource`, receipts `unit`, `tier`); `data/coupons.json` (empty); PR 1565 (`COINS_COSMETIC_ONLY`) | FACT |
| 9.3 | Do coins affect play against others? | **No.** Versus reads earned items only; coins never change a result. | `networkView` reads earned items only (`packages/economy/src/wallet.ts` header); versus pays 0 coins (`docs/HANDOVER.md`, the Roar-coin row) | FACT |
| 9.4 | Planned? | **Yes.** The plan is to sell coin packs through Steam later, for cosmetics, operation passes and early single-player access. | `docs/superpowers/specs/2026-09-28-st8-monetisation-content-plan.md`; `docs/HANDOVER.md` (lane D: ST7, Steam Wallet) | FACT (a plan) |

## 10. The uncertain answers, in one list

1. **1.11 Suicide Squad.** An enemy unit with explosive vests, in 7 mission files. How a board weighs a suicide-bomber unit, and how to describe it.
2. **1.12 "Told, not shown".** The atrocity, the killings and the abductions are said to be never depicted. This rests on the design and the data. Someone should play the opening missions and confirm.
3. **1.13 Real-world reference.** How to answer "based on real events" when the opening's structure follows the 7 October 2023 attack, moved into fiction.
4. **2.3 and 4.2 Voice.** Twelve Hebrew takes, several "unverified by ear", one possibly a scream, one "colloquial". A Hebrew speaker should hear all of them. Some are AI stand-ins meant to be left out of a commercial build.
5. **7.3 Chat controls.** The answer changes when PRs 1492 (filter) and 1502 (block, report) land. The wording for "free chat, no human moderation, with player controls" is the lawyer's.
6. **7.5 Avatar upload.** Not served today. Re-answer if uploads ship, and again if other players can see them.
7. **8.4 Age.** Whether stating 16 is enough, per market.
8. **9.1 Purchases.** Re-answer the day `PURCHASES_OPEN` becomes true.
9. **1.9 Ragdolls.** Re-answer if a preset turns them on.

## 11. What may draw a board's attention

I am **not** predicting a rating. For planning only, the items most likely to draw questions are: the suicide-bomber unit (1.11); the civilian killings and abductions in the story and their real-world reference (1.12, 1.13); free-text chat with people who share a room code (7.2, 7.3); and paid coins, once they open (9.1).
