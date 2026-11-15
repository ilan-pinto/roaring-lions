# Retiring the real names already in canon (GH-1440)

**2026-11-15** · status: **proposal, docs only.** The lead picks the names before any code PR. Nothing here changes
data, strings, ids or saves. · from the approved campaign arc *The Long Ground* (L-10) · rule: `storyline.md` §0.1 D11
and §2.4, `names.md` §2, GDD §2.

---

## 0. What this note says, in six lines

1. **The rule is already clear and the game already breaks it.** `names.md` §2 says never "a real force's unit or
   platform"; GDD §2 says all of it is fictional. `storyline.md` §2.4 rule 4 then lists real names as *the register to
   copy*: Lavi, Namer, Eitan, Yahalom, Peten. The rule and its own example list disagree.
2. **Confirmed real, by a web check on 15 Nov (§2):** the **401st Brigade** (a real IDF armoured brigade, the one in
   the README and GDD), **Yahalom** (a real IDF Combat Engineering special unit), **Namer** and **Eitan** (real IDF
   armoured carriers), **Peten** and **Yanshuf** (the IAF's names for the AH-64A and the UH-60), **Lavi** (the real
   IAI fighter) and **Shachaf** (a real IDF intelligence battalion).
3. **The brigade number never appears in the game.** It is in the README, the GDD and the campaign docs only; in game
   the brigade is "Ari'im". So retiring the number is a docs change, not a player-facing one.
4. **Yahalom is in the game**: a unit name, a Free Play option, and three mission briefings (eight strings).
5. **Thirteen more Hebrew materiel names and the real foreign weapon names are unchecked or are a decision (§3.3, §3.4).**
   The census lists them rather than guessing.
6. **Every proposal keeps the internal id** (`yahalom_squad`, `ifv_namer`, `mbt_lavi` ...) and so every save. Only the
   words a player reads change (§5).

## 1. The rule, and where it contradicts itself

| Where | What it says |
|---|---|
| GDD §2 | "All geography, factions, and place names are **fictional**." Enemies by doctrine, never by ethnicity, nationality or faith |
| `storyline.md` §0.1 D11, §2.4 rule 5 | "**Never** a faith, ethnicity, nationality, real place or real insignia, either side" |
| `names.md` §2 | "Never a real place, a faith, an ethnicity, a nationality, a real insignia, **a real force's unit or platform**, or a real public figure" |
| `storyline.md` §2.4 rule 4 | "KDF personal names sit in the register the materiel uses: **Lavi, Namer, Eitan, Yahalom, Peten, Shoded, Ari'im, Kedem, Sahar**" |
| `names.md` §2 (squads) | "Hebrew-derived, like the materiel (Lavi, Namer, Eitan, Yahalom, Peten, Shoded, Ari'im, Kedem, Sahar)" |
| ST8 T9 (store items) | "fictional insignia only, no real unit, faith, people or place" |

The last two rows copy the problem into every future name: a writer told to match the register matches real IDF
designations. This note's fix to that is in §6 (rewrite rule 4's example list, once the lead has chosen).

## 2. How the census was made, and what it cannot claim

- **Sources scanned**, token by token: `packages/app/src/i18n/en.json`; every `data/missions/*.json` field (`name`,
  `briefing`, `briefing_sections`, `objectives`, `triggers[].label`, `say`, `aftermath`); every `data/units/**/*.json`
  `name` and `blurb`; `data/campaign/*.json`; `data/structures.json`, `formations`, `doctrines`, `hints`, `tutorial`,
  `locales`; and the docs the public reads (`README.md`, `docs/GDD.md`, `docs/campaign/`).
- **Not scanned**: text baked into images or GLB textures, voice and audio, the plates and portraits. A reviewer
  should open the garage and the Stores once with the new names before anything ships (§6).
- **"Confirmed real"** means a web search on 15 Nov found it as a real force's name. Sources:
  [401st Brigade (Israel)](https://en.wikipedia.org/wiki/401st_Brigade_(Israel)) ("Ikvot HaBarzel", 162nd Division);
  [IAI Lavi](https://www.Wikipedia.org/wiki/IAI_Lavi) (cancelled 1987);
  [Eitan, M113 replacement](https://www.timesofisrael.com/defense-ministry-to-deliver-first-new-advanced-eitan-apc-to-idf/);
  [Peten, Yanshuf](https://wiki.warthunder.com/AH-64A_Peten_(Israel)) as the IAF's names for the AH-64A and UH-60.
  Namer and Yahalom came back as an IDF armoured carrier and an IDF Combat Engineering special unit in Israeli news
  reporting (casualty reports; no single page kept), and "Shachaf" as the 869th combat intelligence battalion in
  Ynet and Israel Hayom results. The sources are news and reference sites, not a primary IDF register.
- **"Not confirmed"** means the search found nothing. **That is not evidence the name is fictional**: the search was
  shallow, and most of these are ordinary Hebrew words that may also name a real thing. They need the `names.md` §3
  screen (grounds a to c) with a Hebrew-reading reviewer.

## 3. The census

All "in game" counts are strings a player can read. The mission fields `briefing` and `briefing_sections[].text` carry
the same sentence twice, so a count of 2 is one edit per field.

### 3.1 Tier A: a real unit, formation or insignia (breaks the rule on its face)

| Name | Real thing | In game | Docs and elsewhere |
|---|---|---|---|
| **401st** (the brigade number) | the IDF 401st Armoured Brigade, "Ikvot HaBarzel", Southern Command | **0 strings.** The sentence "401st 'Ari'im' Brigade" does not appear in `en.json`, missions or units | `README.md:3`; `docs/GDD.md:10,27,402`; `docs/campaign/storyline.md:120,503,663`; `docs/campaign/README.md:134`; design docs under `docs/campaign/`; `docs/superpowers/specs/*monetisation*`, `*roar-coin-shop*`, `*commander-brief*`; the menu-tiles mock and the Sahar Basin mock-up SVG |
| **Yahalom** | the IDF Combat Engineering Corps special unit | 8: unit name `yahalom_squad` ("Yahalom Engineers"); `freePlay.option.tunnel`; `beit_sahwan_2_foothold` (briefing, and its `notes` section); `beit_sahwan_4_subterranean` (briefing, section); `deir_amun_2_foothold` (briefing, section) | `storyline.md` §2.4, `names.md` §2, the shop and arc specs |
| **Shachaf** | an IDF intelligence battalion (869th) | 1: unit name `scout_shachaf` ("Shachaf Scout Car") | none found in the docs |
| **A star of David on the kit sign** | a faith symbol and part of a real national flag | the kit level on every unit icon, 1 to 3 six-pointed stars (`ui/kit-sign.ts`, `kitIconSignHtml`) | the lead's ruling of 27 Sep (G-P3, "Steel Stars of David"); ST8 T6 |

The last row is listed because rule 5 names "a faith" and "a real insignia". It is a **lead ruling**, so this note does
not propose changing it; it asks (D-N4) whether the rule or the sign is the thing to amend.

### 3.2 Tier B: a real platform name (breaks `names.md` §2)

| Unit id | Display name now | Real thing (confirmed) | Other player-facing text |
|---|---|---|---|
| `ifv_namer` | Namer IFV | the Namer heavy carrier | missions: `beit_sahwan_4_subterranean`, `ein_qasab_2_foothold`, `ein_qasab_3_buildup`, `khan_rafid_2_foothold`, `qarn_hadid_2_foothold` |
| `apc_eitan` | Eitan APC | the Eitan 8x8 carrier | 7 missions: `beit_sahwan_3_clearance`, `beit_sahwan_4_subterranean`, `deir_amun_3_subterranean`, `ein_qasab_1_recon`, `khan_rafid_1_recon`, `khan_rafid_2_foothold`, `qarn_hadid_1_recon` |
| `mbt_lavi`, `mbt_lavi_camo` | Lavi MBT, Lavi Ambush Tank | the IAI Lavi fighter | `deir_amun_3_subterranean` |
| `heli_peten`, `heli_peten_gunship` | AH-64 Peten, Peten Gunship | the AH-64A, IAF name Peten; "AH-64" is also the real US designation | the gunship blurb |
| `heli_yanshuf` | UH-60 Yanshuf | the UH-60, IAF name Yanshuf; "UH-60" is the real US designation | `tel_marum_3_clearance` trigger label |
| `dozer_d9` | D9 Dov | "D9" is Caterpillar's model number | `wadi_halam_5_depot` (briefing, 2 sections) |

### 3.3 Tier C: Hebrew materiel names not confirmed either way

`Nachlieli Medevac` (`air_medevac_heli`), `Kipod Screen Carrier` (`apc_kipod`), `Shoded Jeep` (`jeep_shoded`),
`Remetz Laser Carrier` (`aa_remetz`; also `umm_zeitoun_2_buildup`, 3 strings), `Zaron Missile Team` (`at_nlos_team`;
`weapon.zaron_missile`), `Tzinah Breach Team` (`breach_team`), `Shiryonan Demolition Carrier` (`demo_tzav`),
`Chomet Grenadier Squad` (`inf_grenadier`), `Nemala Medic Team` (`inf_medic_squad`; `beit_sahwan_breach`, 2 strings),
`Shmamit Deep Recon Team` (`recon_zikit`), `Pered Armoured Ambulance` (`veh_ambulance`), `Chadaf Recon Robot`
(`ugv_recon_dog`), `Te'o Howitzer` and `Te'o Cluster Howitzer` (`spg_long_range`, `spg_cluster`).
Also in `data/campaign/names.json`: the 25 vehicle names (for example `Gachelet`, `Ayil`, `Yated`, `Kardom`) and the
40 squad callsigns. **A search for Shachaf, Kipod, Shoded, Remetz, Zikit, Chomet, Nemala and Pered together found only
Shachaf.** Treated as unchecked, not as clean.

### 3.4 Tier D: real foreign weapon and platform designations

Not people, faith, place or insignia, so rule 5 does not forbid them; `names.md` §2's "platform" arguably does. This is a
decision (D-N2), not a finding.

| Shown as | Where | Real thing |
|---|---|---|
| Spike (`weapon.spike_atgm`; unit "Spike AT Team") | en.json, `at_team` | Rafael's Spike missile |
| Hellfire (`weapon.hellfire`; Peten blurb) | en.json, `heli_peten_gunship` | the US AGM-114 |
| Kornet (`weapon.kornet`; 8 mission strings) | `qarn_hadid_3`, `tel_marum_3`, `umm_zeitoun_3` briefings | the Russian 9M133 |
| RPG, RPG-7 (`weapon.rpg`, `rpg7`; unit "RPG Team"; 13 mission strings) | many missions, trigger labels | the Soviet launcher |
| SPG-9 (`weapon.spg9`) | en.json | the Soviet recoilless gun |
| Grad, "122 mm Grad rockets" (`weapon.grad_122`; faction blurb; 10 mission strings) | `tel_marum_1..3` | the BM-21 Grad |
| DShK, PKM, ZU-23 (`weapon.dshk`, `pkm`, `zu23_twin`) | en.json | Soviet weapons |
| MANPAD ("MANPAD Team") | `manpad_team` | a generic term, not a brand: **no change proposed** |

### 3.5 Checked and left alone

- **Places and nations** (Kedem, Sahar Basin, the Marj Strip, Sur, Naharin, Rimon Hills, Amar Steppe, all the towns,
  Ashwar, Sarim, Rif): fictional, in `data/campaign/countries.json` and `world.json`. The three-digit numbers there are
  map coordinates, not a unit.
- **Personal names** (Shai Hammai, Idit Zohar, the four field officers): already screened under rule 3 (`heroes/names.md`,
  GH-298). Not reopened.
- **Credits**: the real names are the licensors and authors of art, fonts and libraries. They are required
  attributions, not canon, and stay.
- **"Ari'im"** (lions): in game twice (`grade.tier.3` "Ari'im citation"; the `wadi_halam_5_depot` aftermath, which also
  has the callsign "Ari Actual"). No real unit of that name was found. Kept, subject to the same screen as Tier C.

## 4. Proposals

For each Tier A and B name, three candidates: **(1)** a plain Hebrew common noun from the tools-and-terrain register
`names.md` §2 already uses for squads, **(2)** a second noun from the same register, **(3)** a plain English functional
name (the task table, "Eye One", already shows English is admitted for air). The glosses are mine and **no Hebrew
speaker has reviewed them**: GDD §2 *Voice* requires a native reviewer, and each candidate needs the `names.md` §3
collision screen before adoption. I avoided words that name a real force's platform or that carry a place or faith
(for example `Kotel` was rejected for that reason, and `Barzel` because the real 401st is "Ikvot HaBarzel", "Iron Tracks").

### 4.1 The brigade number (Tier A)

| # | Candidate | Why |
|---|---|---|
| **1 (recommended)** | **"the Ari'im Brigade"**, the number dropped | The game never prints the number, only the docs do, so nothing player-facing moves. The name "Ari'im" and "the Roaring Lions" carry the identity |
| 2 | "the 1st Ari'im Brigade" | keeps an ordinal; must be screened against real brigade numbering |
| 3 | A letter-and-digit code, "Brigade A-4" | out of the IDF's numbering scheme altogether; reads colder |

**Replaces in:** `README.md:3`, `docs/GDD.md:10,27,402`, `storyline.md:120,503,663`, `docs/campaign/README.md:134`, and
the design docs and specs listed in §3.1. No `en.json`, mission or unit string.

### 4.2 Yahalom Engineers (`yahalom_squad`), Tier A

| # | Candidate | Gloss and fit |
|---|---|---|
| 1 | **Ma'ader Engineers** | *ma'ader*, a hoe: the digging tool; fits the unit's job (collapsing tunnels) |
| 2 | **Bor Engineers** | *bor*, a pit: the thing they collapse |
| 3 | **Sapper Squad** | English; no Hebrew review needed |

**Replaces in (8 strings):** the unit `name`; `freePlay.option.tunnel` ("two Yahalom engineer squads"); briefings and
sections of `beit_sahwan_2_foothold` (its `notes` section), `beit_sahwan_4_subterranean`, `deir_amun_2_foothold`.

### 4.3 Shachaf Scout Car (`scout_shachaf`), Tier A

| # | Candidate | Gloss and fit |
|---|---|---|
| 1 | **Mabat Scout Car** | *mabat*, a look or glance |
| 2 | **Tzofe Scout Car** | *tzofe*, an observer |
| 3 | **Scout Car** | English, plain |

**Replaces in (1 string):** the unit `name`.

### 4.4 Tier B platforms

| Unit id | Now | Candidate 1 | Candidate 2 | Candidate 3 (English) | Replaces in |
|---|---|---|---|---|---|
| `ifv_namer` | Namer IFV | **Mivtzar IFV** (*mivtzar*, fortress) | **Gader IFV** (*gader*, fence) | **Heavy IFV** | unit name; 5 missions (§3.2) |
| `apc_eitan` | Eitan APC | **Ma'avar APC** (*ma'avar*, a crossing) | **Gesher APC** (*gesher*, bridge) | **Wheeled APC** | unit name; 7 missions (§3.2) |
| `mbt_lavi` | Lavi MBT | **Gur MBT** (*gur*, a lion cub) | **Shachal MBT** (*shachal*, a poetic word for lion) | **Heavy MBT** | unit name; `deir_amun_3_subterranean` |
| `mbt_lavi_camo` | Lavi Ambush Tank | **Gur Ambush Tank** | **Shachal Ambush Tank** | **Ambush Tank** | unit name |
| `heli_peten` | AH-64 Peten | **Tzefa Attack Helicopter** (*tzefa*, a viper) | **Se'ara Attack Helicopter** (*se'ara*, a storm) | **Attack Helicopter** | unit name; drop "AH-64" |
| `heli_peten_gunship` | Peten Gunship | **Tzefa Gunship** | **Se'ara Gunship** | **Gunship** | unit name; blurb |
| `heli_yanshuf` | UH-60 Yanshuf | **Dror Transport Helicopter** (*dror*, a swift or sparrow, and "freedom") | **Tzipor Transport Helicopter** (*tzipor*, a bird) | **Transport Helicopter** | unit name; drop "UH-60"; `tel_marum_3_clearance` trigger label |
| `dozer_d9` | D9 Dov | **Armoured Dozer** | **Dov Dozer** (keeps *dov*, a bear; drops the model number) | **Combat Dozer** | unit name; `wadi_halam_5_depot` (3 strings) |

Candidate 1 for the Lavi is chosen to keep the game's lion theme without the aircraft's name; the lead may prefer to
drop the theme from vehicles. Two Hebrew names that carry the lion idea (*Kfir*, *Ari*) were rejected: *Kfir* is also a
real aircraft, and *Ari* is the callsign already used in `wadi_halam_5_depot`.

### 4.5 Tier C and D (decisions, not replacements)

- **Tier C** has no proposal because it has no finding: it needs a screen. Proposed: send the thirteen names and the
  `names.json` pools to a Hebrew-reading reviewer with the §3 grounds, and replace only those that come back real, using
  the same three-candidate form.
- **Tier D**: if the lead rules that real weapon designations must go too, the descriptive replacements are mechanical
  and need no Hebrew: Spike to "Guided anti-tank missile"; Hellfire to "Air-launched anti-tank missiles"; Kornet to
  "Heavy anti-tank missile"; RPG, RPG-7 to "Rocket launcher"; SPG-9 to "Recoilless gun"; Grad to "122 mm rocket
  artillery"; DShK, PKM, ZU-23 to "Heavy machine gun", "General-purpose machine gun", "Twin 23 mm AA cannon". Weapon ids
  (`spike_atgm`, `kornet`, `grad_122` ...) are data keys and stay. Unit names `Spike AT Team` and `RPG Team` follow
  ("Guided AT Team", "Rocket Team").

## 5. What stays untouched (ids and saves)

- **Unit ids** (`yahalom_squad`, `ifv_namer` ...), **weapon ids**, **mission ids**, `.blend` and GLB file names,
  `mesh-catalogue.ts` keys and **i18n keys** (for example `weapon.kornet`, `freePlay.option.tunnel`) do not change. Only
  `name`, `blurb`, label values and prose do.
- **Saves**: a save stores unit **ids**, so a rename cannot orphan a unit. The roster stores an issued **callsign**
  (`Sela`, `Barzel` ...) as text; renaming a `names.json` entry would not change a callsign already issued, so
  `names.json` is left to the Tier C screen and any change there is append-only for new issues.
- **Display names are data, resolved at read time**, so no migration. With GH-1406's overlay a translation file may
  still carry the old name; `unitOverlayFailures` checks ids, not names, so the overlay must be updated in the same PR.
- **Two side effects a rename has**, to be named in the code PR: `shippedContentDigest` hashes unit JSON including
  `name`, so it changes (any data edit does; versus peers on different builds already refuse each other); and a
  mid-mission save (GH-1393, when built) carries that digest, so saves made before the rename would be refused.

## 6. What the code PR would do, once the lead has chosen

1. `data/units/**/*.json` `name` and `blurb` for the chosen units; `en.json` (`freePlay.option.tunnel`, any weapon labels
   if D-N2 is yes); the `data/missions/*.json` fields in §3 (each is a sentence edit, then `validate:data`'s trigger-label
   length gate re-runs for `tel_marum_3_clearance`).
2. `README.md`, `docs/GDD.md`, `docs/campaign/` for the brigade number and any renamed unit.
3. **Rewrite `storyline.md` §2.4 rule 4 and `names.md` §2's register list**, so the example list is the *new* names and
   adds "never a name of a real force's unit or platform", with the collision screen as a step. Without this the next
   writer repeats the problem.
4. Pin it: a test that fails when a player-facing source contains a name from a short banned list (`tools/src/`, a source
   scan like `player-wording.test.ts`), with the mutation that turns it red, and the list kept in one data file.
5. Re-shoot anything that bakes a name into a picture (the garage plates and the Stores cards show `name` as DOM text, so
   likely none, but the first look must confirm), and run `pnpm ui:shots` on CI for overflow: "Mivtzar IFV" and "Heavy
   MBT" are not the same width as "Namer IFV".

## 7. Decisions for the lead

| # | Decision | Recommendation |
|---|---|---|
| D-N1 | Scope: Tier A and B (real units and platforms) now? | **Yes.** `names.md` §2 already forbids them |
| D-N2 | Tier D (real foreign weapon names): change them too? | **Your call.** They are not people, faith, place or insignia; the cost of changing is low and mechanical, the cost of keeping is a rule that says "platform" |
| D-N3 | Which candidate for each Tier A and B name, and whether the Lavi keeps the lion theme | the table in §4; **candidate 1 for the brigade (number dropped)** |
| D-N4 | The star on the kit sign: keep as a ruled exception and amend rule 5, or choose another shape | **Yours.** It is your 27 Sep ruling; rule 5 and the sign cannot both stand as written |
| D-N5 | Tier C: send to a Hebrew-reading reviewer, and who | **Yes**, before any code PR touches them |

## 8. What this note does not do

It does not rename anything, screen the candidates, or have a Hebrew speaker's review. It does not touch audio, voice
lines or baked pictures (§2). It does not re-screen personal names or the credits.
