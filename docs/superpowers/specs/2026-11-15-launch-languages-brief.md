# GH-1407 lead brief: which languages to ship first

Status: **BRIEF FOR A LEAD DECISION. Docs only; nothing here changes code, data or text.** 15 Nov 2026.

The question: which 3 to 5 languages should a PC RTS with this setting ship first, what does that cost, what does it break, and what has to be decided. Every decision at the end has a recommended default. Where a number could not be verified it says so; a number marked **(secondary)** comes from a blog, vendor page or news article quoting Valve, not from Valve's own page.

**What I could and could not check.** The session's network blocks `store.steampowered.com`, `partner.steamgames.com` and `gamingonlinux.com`, so I read no Valve page directly. Survey shares come from search-result text quoting Valve's monthly survey; comp language lists come from SteamDB and third-party mirrors of the store tables. Before money is spent, someone with network access should re-read the three Valve pages named in "Verify before spending". **I found no public number for the language mix of RTS or strategy buyers specifically**; the genre argument below rests on what comparable RTS titles chose to ship, not on a measured genre share.

---

## 1. Who is on Steam, by language

Valve's monthly Hardware & Software Survey classifies a response by the client's language setting, not by country. It is an opt-in sample and swings: February 2026 showed Simplified Chinese at 54.60% (a Chinese New Year sampling anomaly that corrected itself the next month), and October 2026 showed it at 21.98%, down 9.41 points from September.

| Language (Steam code) | Share, latest figure found | Month | Source |
|---|---|---|---|
| English | 39.04% | Oct 2026 | KitGuru / HWBusters (secondary) |
| Simplified Chinese (`schinese`) | 21.98% (swings 22-55%) | Oct 2026 | HWBusters (secondary) |
| Russian (`russian`) | 10.14% | Oct 2026 | HWBusters (secondary) |
| Spanish, Spain (`spanish`) + Latin America (`latam`) | 4.81% + 0.82% = about 5.6% | Mar 2026 | Quantumrun citing Logrus IT (secondary) |
| Portuguese, Brazil (`brazilian`) | 4.0% to 4.42% | Jun / Mar 2026 | blog chart and Logrus IT (secondary) |
| German (`german`) | 2.7% to 2.96% | Jun / Mar 2026 | same |
| French (`french`) | 2.3% to 2.46% | Jun / Mar 2026 | same |
| Japanese (`japanese`) | 2.24% to 2.6% | Mar / Jun 2026 | same |
| Polish (`polish`) | 1.7% to 1.82% | Jun / Mar 2026 | same |
| Turkish (`turkish`) | 1.27% to 1.3% | Mar / Jun 2026 | same |

Two cautions on reading it. A language's share of the install base is not its share of RTS buyers or of revenue: a vendor guide says only about a third of Chinese players accept an English-only game (one vendor blog, so indicative). Spend per head by language is something I could **not** source, so this brief ranks by install share and by what comparable titles chose, not by revenue. And Steam deprioritises a game in recommendations for users whose language it does not list (vendor guide, secondary), so a store-page translation matters even before the game is translated.

Hebrew and Arabic: the survey excerpts I found carry no figure for either, so I make no claim about their size. Steam fully supports a fixed list (Valve's page says 29 languages; one third-party table says 30). Arabic is on it with a caveat that its support is "a little different"; **I could not confirm Hebrew is on it**. A language not on the list can still be ticked as supported on the store page, but is not an API language.

## 2. What comparable RTS titles ship

| Title | Languages on Steam | Full audio | Source |
|---|---|---|---|
| WARNO (Eugen) | English, French, German, Spanish (Spain), Russian, Simplified Chinese: six | English only | SteamDB depots, GamesGeeker, GOG (one mirror also lists Polish; no other source does) |
| Company of Heroes 3 (Relic) | 15 per SteamDB, including French, Italian, German, Spanish, Czech, Korean, Polish, with Japanese, Russian, Brazilian Portuguese, both Chinese and Turkish on other listings | English only | SteamDB `ufs`, Steam community thread (listings disagree) |
| Broken Arrow (Steel Balalaika / Slitherine) | 13 | English full; others interface and subtitles, audio unclear | SteamDB `ufs`, press release names English, Russian, French, Italian, German, Spanish |

The pattern: **text-only localisation, English voice**, and a core of French, German, Spanish, Russian plus Simplified Chinese. WARNO, the nearest in scale and in being a modern-combat RTS, ships exactly that six. None of the three lists Hebrew or Arabic.

## 3. What there is to translate today

Counted from the generated files on this branch (`packages/app/src/i18n/en.json`, `data/locales/en/missions.json`, `data/locales/en/units.json`), words split on whitespace:

| Catalogue | Strings | Words | Notes |
|---|---|---|---|
| Chrome (`en.json`: menus, HUD, hints, settings) | 1,949 | 12,068 | includes `{placeholders}` and plural forms; a human counts these as words |
| Mission text (30 missions) | 631 | 19,244 | briefings 5,860 + sections 5,252 (the sections repeat the briefing text, see below), objectives 1,022, radio lines 4,799 (objective 2,229, trigger 1,200, wave 781, on-fail 589), debriefs 1,304, triggers 371, names 178, dispatch 287, aftermath 168 |
| Units (50 units: name, blurb) | 83 | 650 | |
| **Total** | **2,663** | **31,962** | about 32,000 words |

Two honest adjustments. The briefing sections (5,252 words) are the same sentences as the briefing (5,860 words) split into labelled parts, and the validator requires the translated sections to join to the translated briefing exactly, so a translator translates the sections once and the briefing is their join: **real new words are about 26,700**, and a vendor should be briefed to translate the sections only. And not in these numbers: the Steam store page (roughly 1,000 to 2,000 words, not drafted), the credits, anything in `data/campaign/` or other data files that is not overlaid yet (a sweep has not been done; the three catalogues are what the overlay system can carry today), and voice (there is none to translate).

The tooling is ready for this: the overlay loads per locale, the generated English templates carry a source-hash per string (GH-1406 part 5, so an English edit after translation goes red), and caps are enforced (trigger label 48 characters, radio line, dispatch and aftermath 240, hostage place 40). German and Russian often run longer than English, so the caps will bite; the validator tells the translator which line.

## 4. Fonts are the first real blocker (found while writing this)

`assets/fonts/` ships **Latin subsets only**: `barlow-latin-400/600.woff2`, `big-shoulders-display-latin.woff2`, `ibm-plex-mono-latin-400/600.woff2` (OFL, self-hosted; a CDN is forbidden by `CLAUDE.md`). `theme.css` falls back to `'Oswald', 'Haettenschweiler', sans-serif` for display and generic stacks for the rest, which are the player's system fonts. So:

- **Russian** needs a Cyrillic face for Barlow and the display font (whether the shipped Barlow and display faces have Cyrillic glyphs is unchecked; the shipped files are the Latin subsets).
- **Polish and Turkish** need Latin-Extended, which the Latin subset omits.
- **Simplified Chinese and Japanese** need a CJK face; a usable one is typically several megabytes even subset and would be the largest font in the shell. Self-hosting rules out a CDN, so it is a size and licence decision (OFL fonts exist; measure before choosing).
- **Hebrew and Arabic** need their own faces plus shaping and RTL, see section 5.

This is why the language set affects engineering, not only translation spend: French, German and Spanish render today with the shipped fonts (accents are inside Latin); Russian and Chinese do not.

## 5. Right-to-left (Hebrew, Arabic)

What exists: `?pseudo=rtl` forces `dir="rtl"` and the `qps-plocm` tag over the English strings (`applyLocale`), and a guard test (`logical-properties.test.ts`) holds the shell to logical CSS properties with a seven-site allowlist of inline styles. That is the layout groundwork. What does not exist and would have to be done and QA'd per RTL language:

1. A face with Hebrew or Arabic glyphs (section 4), plus Arabic joining, which pseudo-RTL cannot show.
2. Mixed-direction text: unit names, numbers, clocks and the English-named things inside a translated sentence need bidi isolation; the pseudo-locale forces the whole string RTL with an override, which hides this.
3. Mirroring decisions for the HUD (minimap, command dock, order glyphs with arrows) and whether the camera pan keys stay as they are. A mirrored game board is not the same as a mirrored shell; the map itself must not mirror.
4. Canvas and WebGL text (overlays, labels) are not covered by CSS logical properties.

**Setting.** `docs/GDD.md` section 2 makes every place, faction and nation fictional and defines enemies by doctrine only, and its voice rule (same section) has KDF units speaking Hebrew and the enemy doctrines speaking Arabic, symmetrically, with faith and ethnicity excluded. The GDD's deferred list (section 10) says "localisation beyond English and Hebrew" is out of scope for v1.0, so Hebrew was the one non-English language ever planned. Shipping the game's text in Hebrew or Arabic puts the fictional-doctrine framing next to the real languages of the real region it echoes; that is a **lead and lawyer question, not a localisation one**, and it is the reason this brief does not recommend either in the first wave.

## 6. Ways to get it translated, and what each costs

Rates are public vendor and guide figures (secondary); none is a quote and I contacted no vendor. Applied to the **31,962-word** total (about 26,700 if the sections are translated once, which the table below uses as "words").

| Route | Per-word rate | Per language, 26,700 to 32,000 words | Fits | Risk |
|---|---|---|---|---|
| Human vendor, translation only | EUR 0.09 to 0.12 for EN to FR/DE/ES/RU/pt-BR/zh (indie guide); USD 0.07 to 0.09 (Allcorrect list), up to 0.10 to 0.20 (Pangea) | about EUR 2,400 to 3,800 | the narrative: briefings, radio lines, debriefs | needs the style guide (Shai and Idit's voices) and context, or lines come back flat |
| Plus proofreading | about 50% of the translation rate (LocalizeDirect) | +EUR 1,200 to 1,900 | all mission text | |
| Linguistic QA in the running game | USD 45 to 65 per hour (Allcorrect) | **my assumption:** 20 to 30 hours = USD 900 to 2,000 | catches overflow, tone, wrong context | a vendor guide puts a whole mid-size game at USD 3,000 to 5,000 per language, which brackets the sum |
| Machine translation plus human post-edit | **no sourced rate**; vendors say AI is eroding per-word prices (Allcorrect) | **estimate, unsourced:** roughly half of the human rate, to be quoted | chrome and units (short, literal) | idiom and tone in the narrative; a post-editor must read in context |
| Community / volunteer | none | none in cash; coordination and review time | later, for languages beyond the first wave | uneven quality, no deadline, stale-hash churn on every English edit |
| Store page only | USD 100 to 300 per language (vendor guide) | | before the game is translated | |

Reading it: **about EUR 4,000 to 6,000 per language for human translation plus proofreading, plus the QA hours, so about EUR 5,000 to 8,000 each, EUR 25,000 to 40,000 for five.** That is a range from vendor price lists, to be replaced by a real quote. Retranslation is the hidden cost: the stale-hash guard makes every post-translation English edit visible per locale, so **a text freeze before the briefs go out** is worth more than any rate negotiation.

## 7. QA each language needs

Per shipped language, in this order:

1. `pnpm validate:data`: unknown keys, over-cap lines, sections that do not join, stale or missing source hashes. Already in CI.
2. `__lionsI18n.missingKeys()` and `pnpm ui:routes` (CI only): keys the catalogue lacks; ui:routes fails on any console error.
3. `pnpm ui:shots` overflow report at three resolutions for the language. **Today `ui:shots` takes `--pseudo`, not `--lang`**: a `--lang=<id>` option is a small tooling item to add before the first translation lands. The report is a deliberate report, not a gate (an ellipsis can be the design), so a human reads it per language. Pseudo (bracketed, accented) already approximates length growth; it does not model Chinese (shorter, taller glyphs) or Russian and German (longer words, no break points).
4. A native-speaker read of all 30 mission briefings in the game, not in a spreadsheet, for the caps and for voice.
5. Fonts rendering (section 4): a screenshot per screen proving no tofu boxes, per script.
6. For RTL only: the four items in section 5.

## 8. Decisions

| # | Decision | Recommended default |
|---|---|---|
| D1 | The launch set | **Five: Simplified Chinese, Russian, German, French, Spanish (Spain).** This is WARNO's set minus English and keeps the three cheapest-to-render Latin languages (de, fr, es) beside the two biggest by share. Add Brazilian Portuguese (4%, shares a pipeline with Spanish) as the first post-launch language. Japanese, Polish and Turkish follow on wishlist data. |
| D2 | Depth | **Text only, English voice**, as WARNO, Company of Heroes 3 and Broken Arrow ship. |
| D3 | Method | **Human translation plus proofreading for mission text; machine plus post-edit allowed for chrome and units.** No community translation for launch. |
| D4 | Store page | **Translate the five store pages first**, before the game text: cheapest, and Steam ranks by supported language. |
| D5 | RTL (Hebrew, Arabic) | **Not in the first wave.** Keep `?pseudo=rtl` and the logical-properties guard as the groundwork; revisit with the lead and lawyer (section 5), and decide whether the GDD's "English and Hebrew" line still stands. |
| D6 | Fonts | **Decide before the first brief goes out:** Cyrillic for the shipped faces (small), a self-hosted CJK face for Simplified Chinese (the one with a download-size cost; measure it), Latin-Extended added for later Polish and Turkish. |
| D7 | Freeze | **A mission and chrome text freeze** before translation, and a rule that an English edit after it is a localisation ticket (the stale-hash gate will say which lines). |
| D8 | Budget line | **EUR 25,000 to 40,000 for D1 on vendor list prices**, to be replaced by one real quote per language; no vendor was contacted for this brief. |
| D9 | Tooling | `ui:shots --lang=<id>` before the first file lands; Crowdin-style hosting is not needed for five languages and one translator each. |

## Verify before spending

1. `partner.steamgames.com/doc/store/localization/languages`: the exact supported list, whether Hebrew is on it, the Arabic caveat, and the interface / audio / subtitles ticks.
2. `store.steampowered.com/hwsurvey`: the current language table (the figures above are secondary and the sample swings monthly).
3. Steamworks wishlist-by-region data for this game, when the page exists; it beats every number here.

## Sources

- Steam survey language shares and the Simplified Chinese swings: [KitGuru Oct 2026](https://www.kitguru.net/?p=750761), [HWBusters Oct 2026](https://hwbusters.com/?p=121916), [GamingOnLinux Sept 2026](https://www.gamingonlinux.com/2026/10/steam-survey-for-september-2026-shows-a-drop-in-linux-with-simplified-chinese-rising/), [GamingOnLinux Feb 2026](https://www.gamingonlinux.com/2026/03/steam-survey-for-february-2026-shows-a-big-swing-to-simplified-chinese), [Quantumrun](https://www.quantumrun.com/consulting/steam-language-statistics/), [Logrus IT via Lingobright](https://www.lingobright.com/statistics/steam-language-statistics/).
- Steam language support levels and list: [Steamworks: Languages supported on Steam](https://partner.steamgames.com/doc/store/localization/languages), [Steamworks: Localization](https://partner.steamgames.com/doc/store/localization), [API codes table](https://www.ibabbleon.com/Steam-Supported-Languages-API-Codes.html).
- Localisation priority guides (vendor, indicative): [uhiyama-lab, Steam priority guide](https://uhiyama-lab.com/en/blog/gamedev/steam-game-localization-language/), [Steam Page Analyzer](https://www.steampageanalyzer.com/blog/steam-localization-languages), [GameDiscoverCo case study](https://www.gamedeveloper.com/game-platforms/case-study-how-localization-amps-up-game-discovery).
- Comparable titles: [WARNO on SteamDB](https://steamdb.info/app/1611600), [Company of Heroes 3 on SteamDB](https://steamdb.info/app/1677280/ufs), [Broken Arrow on SteamDB](https://steamdb.info/app/1604270/ufs), [Broken Arrow press release](https://www.gamedeveloper.com/press-release/broken-arrow-everything-we-know-so-far).
- Rates: [Allcorrect pricing](https://allcorrectgames.com/localization-pricing/), [LocalizeDirect: which languages](https://localizedirect.com/posts/which-languages), [Pangea: game localization cost](https://www.pangea.global/blog/game-localization-cost-budget-planning-and-roi-for-studios/), [Game Developer: how much does localisation cost](https://www.gamedeveloper.com/programming/how-much-does-game-localization-cost-), [Centus](https://centus.com/blog/localization-costs).
- This repository: `docs/GDD.md` sections 2 and 10; `data/locales/README.md`; `packages/app/src/i18n/locales.ts`; `assets/fonts/`; `docs/agent-notes/shell-and-ui.md` (ui:shots, pseudo-RTL).

---

*Written by Claude Code for the lead's decision. Rates and shares are third-party figures as described; none is a quote.*
