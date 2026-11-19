# Naming review: age rating and the neutral register

**Status:** **RULED and applied (lead, 18 Nov 2026).** Four renames are applied, display text only: "Suicide Squad" to **"Charge Squad"**, "Explosive vests" to **"Satchel charges"**, the "kamikaze" dock bucket to **"one-way"**, and "civilians killed" (`conduct.cause.civilians`, `intel.strike.civilians`) to **"civilians lost"**. "Execution" (the orders heading) stays. The cluster-munition names stay a separate, later decision. Written 2026-11-18 against `origin/dev` `74f9a0ff3`; the sections below are the proposal as put to the lead, kept for the record, and §7 says what was applied.
**Why:** PR 1581 (the legal pack) found the enemy `charge_squad` named "Suicide Squad", carrying "Explosive vests", placed in 7 of 35 missions. The age-rating boards ask about exactly these themes, and `docs/campaign/storyline.md` §2.4 holds a neutral register (doctrine, never a people or a faith) that D18 (18 Nov: civilians in danger, in play) makes stricter, not looser.
**Scope rule (the lead's, binding):** **display text only.** Never a unit id, a weapon id, an ability id, a section id or a save key. `charge_squad`, the weapon id `vest`, the ability `kamikaze` and the section id `execution` all stay.

## 1. What was counted

Every string a player can read in English, as a value (keys and ids are not text):

| source | what it holds | strings scanned |
|---|---|---|
| `data/locales/en/missions.json` | every mission's `name`, `briefing` and `sections`, `dispatch`, `aftermath`, `hostages_place`, `debrief`, objective `text`, trigger `label`, every radio line (`say`, `objective_say`, `trigger_say`, `wave_say`) | generated from `data/missions/*.json` (`pnpm locales:en`; `validate:data` holds the parity) |
| `data/locales/en/units.json` | every unit `name` and `blurb` | generated from `data/units/**` |
| `packages/app/src/i18n/en.json` | the whole chrome catalogue: menus, HUD, after-action, dock, weapon labels, free-play blurbs, Stores | the file itself |

**Terms searched** (case-insensitive, whole-stem): `suicid*`, `martyr*`, `execut*`, `terror*`, `kamikaze`, `vest`, `bomber`, `massacre`, `slaughter`, `genocid*`, `torture`, `rape`, `blood`, `gore`, `behead*`, `corpse`, `jihad`, `infidel`, `crusad*`, `holy war`, plus the context words `kill*`, `abduct*`, `kidnap*`, `hostage*`, `civilian*`, `bomb*`, `cluster`.

**Not scanned, and why:** `data/chat/*` (the word-filter lists contain slurs on purpose; they are data the filter reads, never shown); the translations (`de`, `fr`, `es-ES`, `ru`), which follow English: each rename below lists the translated names it touches; docs and design files (not player text); art filenames and audio.

## 2. The census

Nothing in the English text uses `martyr`, `terror*`, `massacre`, `slaughter`, `genocid*`, `torture`, `rape`, `blood`, `gore`, `behead*`, `corpse`, `jihad`, `infidel`, `crusad*` or `holy war`: **zero hits** on all of them. The hits that matter are four strings:

| # | where | text | what it is |
|---|---|---|---|
| F1 | `data/locales/en/units.json` `charge_squad.name` (from `data/units/enemy/charge_squad.json` `name`) | **Suicide Squad** | the enemy unit that closes on a target and detonates; placed in 7 of 35 missions (`beit_sahwan_breach`, `_3_clearance`, `_4_subterranean`, `deir_amun_2_foothold`, `_3_subterranean`, `khan_rafid_2_foothold`, `_3_clearance`) |
| F2 | `packages/app/src/i18n/en.json` `weapon.vest` | **Explosive vests** | the weapon label on the same unit (weapon id `vest`, `data/units/enemy/charge_squad.json:38`) |
| F3 | `packages/app/src/i18n/en.json` `dock.bucket.kamikaze` | **kamikaze** | the reinforcement-dock bucket for one-way units (a code constant `roleBucket()` returns; `dock-model.ts:161`); also the drone class |
| F4 | `packages/app/src/i18n/en.json` `briefing.section.execution` | **Execution** | the briefing heading for the orders paragraph (the five-paragraph order: Situation, Mission, Execution...). A false positive for a rater's word search, but the word is in the build |

Context words, **no change proposed** (they are the vocabulary of a combat game, and the rating tier is the lead's call, not a naming one): `kill*` appears in 53 English strings (38 `kill`, 8 `kills`, 5 `killed`, 2 `killing`), mostly objective texts and the after-action ("{n} enemy killed"); `hostage*` and `abduct*` carry the Beit Sahwan plot and are D18's ground; `civilian*` 16; `cluster`/`bomblet` name real artillery munitions (see §5).

**The mission prose is already neutral.** The four missions whose text names the unit say "charge squad" (`beit_sahwan_breach`, `deir_amun_2_foothold`, `deir_amun_3_subterranean`, `khan_rafid_2_foothold`), never "suicide"; only the unit's own display name and its weapon label say otherwise.

**D18-touched, by the register rule rather than by a rating term:** the after-action lines `conduct.cause.civilians` ("Civilians killed") and `intel.strike.civilians` ("{n} civilians killed") use a word D18's story voice avoids ("fell, taken, a number"). They are chrome, not story voice, so this is a proposal, not a fault (F5).

## 3. Proposed renames (display text only)

Each row gives the conservative proposal **A** and an alternative **B**; the lead picks one or leaves the row alone.

| # | now | A (recommended) | B | reason |
|---|---|---|---|---|
| F1 | Suicide Squad | **Charge Squad** | Demolition Cell | Drops the word; the mission prose already says "charge squad" in four missions, so A removes an inconsistency rather than adding a name. B is more neutral still, but "cell" is already the militia's own word (`militia_cell`, `atgm_cell`) and would blur two unit kinds. |
| F2 | Explosive vests | **Satchel charges** | Carried charges | The vest is the suicide-bomber image; a satchel or carried charge is the sapper's image, and describes the same weapon without the body-worn picture. The weapon id `vest` stays. |
| F3 | kamikaze | **charge** | one-way | A historic term for a deliberate sacrifice; the drone class reads naturally as "charge" too (they are one-way units). The ability id `kamikaze` and the bucket constant stay; only the label moves. The dock model's own comment (`dock-model.ts:161`) already treats the word as a label. |
| F4 | Execution | **Tasks** | Plan | The word is a standard order heading and not a violence word, so this is the lowest priority. Propose only if a rater tool word-matches "execut*". The section id `execution` (mission data) stays, and `briefing.section.execution` keeps its key. |
| F5 | Civilians killed / {n} civilians killed | **Civilians lost** / **{n} civilians lost** | leave | Matches D18's register ("fell, taken, a number") in the one place the after-action says the word. "lost" does not distinguish downed from taken, which D18 also does not distinguish in a count. Not a rating fix. |

### Files and ids each rename touches (all display text; none is an id)

| rename | English source | generated / derived | translations (staged, AI-translated) | docs and tools that quote the old name |
|---|---|---|---|---|
| F1 | `data/units/enemy/charge_squad.json` `name` | `data/locales/en/units.json` (`pnpm locales:en -- --write`, which carries the new `src` hash) | `data/locales/de/units.json` ("Selbstmordtrupp"), `fr` ("Groupe kamikaze"), `es-ES` ("Escuadra suicida"), `ru` (PR 1542), each with a new `src` hash | `README.md`, `data/locales/README.md`, `docs/ASSET_PROVENANCE.md`, `docs/art/meshy-prompts-ashwar.md`, `docs/art/meshy-prompts-units.md`, `tools/units/teams.py` (a label in the export tooling; check whether it is player-facing), `docs/superpowers/plans/2026-08-11-enemy-raider-units.md` (history, leave) |
| F2 | `packages/app/src/i18n/en.json` `weapon.vest` | none | `packages/app/src/i18n/{de,fr,es-ES,ru}.json` + `chrome.src.json` hashes | none found |
| F3 | `en.json` `dock.bucket.kamikaze` | none | `{de,fr,es-ES,ru}.json` (de "Kamikaze") + sidecar hashes | the pseudo-locale and `dock-model` tests read the label through `t()`, not the literal |
| F4 | `en.json` `briefing.section.execution` | none | same four + sidecars | `ui/briefing-sections.ts` (`SECTION_IDS` keeps the id) |
| F5 | `en.json` `conduct.cause.civilians`, `intel.strike.civilians` | none | same four + sidecars | `ui/conduct-invoice.ts`, `ui/intel-copy.ts` (read the key) |

Never touched: unit ids, weapon ids, ability ids, mission and section ids, the save keys (`lions.*`), the `charge_squad` mesh and art filenames.

## 4. The GH-1440 overlap

GH-1440 (15 Nov) ruled the other way: **real equipment and real unit names are admitted** (`storyline.md` §2.4 rule 6, `docs/campaign/naming-retirement.md`). So this review does **not** propose retiring any real name: Lavi, Namer, Eitan, Yahalom, Peten, Spike, Kornet and the rest stay, and so do the real munition terms "Loitering Munition" and "Cluster Howitzer". "Suicide Squad" is not a real equipment or unit name; it is a doctrine label the game invented, so rule 6 does not protect it and renaming it does not re-open the ruling. If the lead wants the cluster-munition names reconsidered on rating grounds (several states have banned the class), that is a separate decision against GH-1440, and the strings are `spg_cluster` (unit name and blurb), `weapon.dpicm_155` ("155 mm cluster shells") and `weapon.bomblet_dive`.

## 5. What this PR adds: the guard

`tools/src/neutral_register.test.ts` scans the three English sources of §1.

- **Zero-tolerance list** (`martyr`, `terror*`, `massacre`, `slaughter`, `genocid*`, `torture`, `rape`, `behead*`, `jihad`, `infidel`, `crusad*`, `holy war`): the test fails if any appears in English text, now or later. This is the "listed term reappears" guard.
- **Recorded census** (the four terms of §2: `suicid*`, `explosive vest`, `kamikaze`, `execut*`): each is pinned to the exact string it occupies today, by literal. A *new* occurrence anywhere fails the test; so does a recorded one that has gone (the **demotion assertion**: when the lead's rename is applied, delete that entry in the same commit, which is what makes the rename visible).
- The scanner itself is checked on constructed corpora (a banned word, a new census hit, a vanished one), and every check was run against a one-line mutation of the real data: see the commit message.

The test passes today and changes nothing in the build. **No rename is applied until the lead picks**; picking is one commit per row (the files in §3) that also deletes the matching census entry.

## 6. Questions for the lead

1. **F1 and F2**: apply A (Charge Squad, Satchel charges), B, or neither? These two are the age-rating fix; the others are polish.
2. **F3**: rename the bucket label ("charge"), or keep "kamikaze" as a common drone term?
3. **F4**: leave "Execution" (a standard heading) or rename to "Tasks"?
4. **F5**: align the after-action wording with D18 ("lost"), or keep "killed"?
5. **Rating tier**: the `kill*` vocabulary (53 strings) and the cluster-munition names are not naming fixes; they are inputs to the rating questionnaire in `docs/legal/age-rating-questionnaire-draft.md`. Say which tier the game is aiming for and the review can be re-run against it.

## 7. What was applied

| row | applied | English source | also changed |
|---|---|---|---|
| F1 | **Charge Squad** | `data/units/enemy/charge_squad.json` `name`, `data/locales/en/units.json` (regenerated) | de "Ladungstrupp", fr "Groupe de charge", es-ES "Escuadra de cargas" (unit names, new `src` hashes); the fr and es-ES mission lines that had rendered the same unit "groupe kamikaze" / "escuadra suicida" (7 lines each); README's enemy table; `data/locales/README.md` glossary; `docs/ASSET_PROVENANCE.md` and the two art-prompt files (display name only: the prompts and a Meshy folder name are the historical record); `tools/units/teams.py` docstring |
| F2 | **Satchel charges** | `en.json` `weapon.vest` | de "Trageladungen", fr "Charges portées", es-ES "Cargas portadas" (+ sidecar hashes) |
| F3 | **one-way** | `en.json` `dock.bucket.kamikaze` | de "Einweg", fr "sens unique", es-ES "de un solo uso" (+ hashes); `dock-model.test.ts` expects `one-way`; the comment in `dock-model.ts` |
| F4 | **kept** ("Execution") | none | none (it stays the one recorded exception in the test) |
| F5 | **civilians lost** | `en.json` `conduct.cause.civilians`, `intel.strike.civilians` | de "Zivilisten verloren", fr "Civils perdus", es-ES "Civiles perdidos" (+ hashes); the `conduct-invoice.ts` comment |

Not done here: **ru** (PR 1542 is not on `dev` yet; its four chrome strings and the unit name follow when it lands, via `locales:pending`). Translations are machine translation by Claude, not proofread. No id, weapon id, ability id, section id or save key changed. The guard now lists `suicid*`, `explosive vest(s)` and `kamikaze` in its zero-tolerance set, so none of the three can return in English text.
