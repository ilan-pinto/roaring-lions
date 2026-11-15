# Real names in canon (GH-1440): the census and the lead's ruling

**2026-11-15** · status: **ruled.** Docs only. · rule: `storyline.md` §2.4 and `names.md` §2, both amended by this PR.

---

## 0. The ruling

> **Lead ruling, 15 Nov 2026:** keep all the names. No unit, vehicle, aircraft or weapon is renamed. Instead, change the
> rule: amend the naming rule (`storyline.md` §2.4 and `names.md` §2) so real equipment and real unit names are allowed,
> which resolves the contradiction with the example list. The bans on real places, real people, real operation names and
> faiths stay as they are (the *The Long Ground* arc depends on them).

This note began as a proposal to retire the real names (the census below, and two or three replacements for each). The
ruling made the replacements unnecessary, so they are removed from this file; they remain in the history of this PR.
The census stays, because it records which real names are in canon and where.

**What changed (three places):**

| File | Change |
|---|---|
| `docs/campaign/storyline.md` §2.4 | new **rule 6**: real equipment and real unit names (vehicles, aircraft, weapons, units) are admitted. Rules 1 to 5 are unchanged, word for word. Rule 6 restates what stays out: a real place, a faith, an ethnicity, a nationality and a real insignia (rule 5), a real person (rule 3), and the name of a real operation |
| `docs/campaign/names.md` §2, last bullet | the words "a real force's unit or platform" are removed; the other bans are unchanged; "Never the name of a real operation" is added as its own sentence; a bullet records the ruling |
| `docs/campaign/names.md` §3, ground (b) | now "the name of a real operation"; the unit, formation, platform and system rejections are marked as admitted since 15 Nov. The rejections already made (Plada, Egrof, Saf ...) stay in the table as a record, and **`names.json` is not changed** |

**Two readings I made, for the lead to confirm:**
1. **A name is admitted, a badge is not.** Rule 5's ban on "a real insignia" is unchanged, so admitting the name "Yahalom"
   does not admit that unit's emblem, flag or patch. Rule 6 says so in a parenthesis.
2. **"A real operation's name" is written down.** It was already a rejection ground in `names.md` §3 (Operation
   Kilshon, Avak, Halyard, Yoav), but no rule text said it. The ruling lists it as a ban that stays, so rule 6 and the §2
   bullet now state it in words. No existing ban was reworded.

## 1. What the census found

The census is the evidence that the rule and the shipped game disagreed, and the list of what the amendment now
covers. Counts are of strings a player can read. Nothing was changed or renamed.

- **Confirmed real** (§2): the **401st Brigade** (README and docs only, never printed in game), **Yahalom** (8 in-game
  strings), **Shachaf** (1), and the platform names **Namer, Eitan, Lavi, Peten, Yanshuf** and "D9".
- **Thirteen further Hebrew materiel names** are unchecked (§3.3). **Real foreign weapon names** (Spike, Kornet, Hellfire,
  RPG-7, SPG-9, Grad, DShK, PKM, ZU-23) are in the game too (§3.4).
- All of these are now admitted by rule 6.

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

### 3.1 Tier A: a real unit, formation or insignia

| Name | Real thing | In game | Docs and elsewhere |
|---|---|---|---|
| **401st** (the brigade number) | the IDF 401st Armoured Brigade, "Ikvot HaBarzel", Southern Command | **0 strings.** The sentence "401st 'Ari'im' Brigade" does not appear in `en.json`, missions or units | `README.md:3`; `docs/GDD.md:10,27,402`; `docs/campaign/storyline.md:120,503,663`; `docs/campaign/README.md:134`; design docs under `docs/campaign/`; `docs/superpowers/specs/*monetisation*`, `*roar-coin-shop*`, `*commander-brief*`; the menu-tiles mock and the Sahar Basin mock-up SVG |
| **Yahalom** | the IDF Combat Engineering Corps special unit | 8: unit name `yahalom_squad` ("Yahalom Engineers"); `freePlay.option.tunnel`; `beit_sahwan_2_foothold` (briefing, and its `notes` section); `beit_sahwan_4_subterranean` (briefing, section); `deir_amun_2_foothold` (briefing, section) | `storyline.md` §2.4, `names.md` §2, the shop and arc specs |
| **Shachaf** | an IDF intelligence battalion (869th) | 1: unit name `scout_shachaf` ("Shachaf Scout Car") | none found in the docs |
| **A star of David on the kit sign** | a faith symbol and part of a real national flag | the kit level on every unit icon, 1 to 3 six-pointed stars (`ui/kit-sign.ts`, `kitIconSignHtml`) | the lead's ruling of 27 Sep (G-P3, "Steel Stars of David"); ST8 T6 |

The last row is listed because rule 5 names "a faith" and "a real insignia", and the ruling leaves both bans as they
were. It is a **lead ruling** of 27 Sep, so this note does not propose changing it; it is the one real tension the
ruling does not resolve (§4, point 1).

### 3.2 Tier B: a real platform name

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
Shachaf.** Unchecked. Under the ruling it no longer matters whether they are real.

### 3.4 Tier D: real foreign weapon and platform designations

Not people, faith, place or insignia, so rule 5 never forbade them; `names.md` §2's "platform" arguably did. Admitted by
the ruling (§0).

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

## 4. Still open, not decided by the ruling

1. **The star on the kit sign.** `kitIconSignHtml` draws 1 to 3 six-pointed stars (the lead's G-P3 ruling of 27 Sep,
   "Steel Stars of David"). Rule 5 bars "a faith" and "a real insignia", and the ruling leaves both as they were. Either
   the sign is a ruled exception to rule 5, or it changes. Not touched here.
2. **Restatements of the old rule that still say "no real unit"** (not edited, because the ruling named only
   `storyline.md` §2.4 and `names.md` §2):
   - `docs/superpowers/specs/2026-09-28-st8-monetisation-content-plan.md` T9 and line 183, and
     `2026-10-11-monetisation-content-plan.md` line 403 ("fictional insignia only, no real unit, faith, people or place"):
     for store items. "No real insignia" stands; "no real unit" now reads as stricter than the rule.
   - `docs/superpowers/specs/2026-09-25-unit-voices-design.md` line 105 (units do not speak "a real unit name") and GDD §2
     *Voice* ("a real call sign"): spoken lines, which the ruling did not address.
   - `docs/superpowers/specs/2026-10-22-special-units-design.md` line 566 ("Avoid real platform names"): guidance for
     naming new units.
   - `docs/campaign/*/design.md` D11 rows repeat `storyline.md` D11 ("a real place or a real insignia") and are unaffected.
3. **Screening a new name.** `names.md` §3 still screens callsigns against real persons, places, religious terms and
   operations. A callsign that is also a real unit or platform now passes ground (b); a person's name, a place or a
   religious term still fails.

## 5. What this note does not do

It renames nothing, changes no data, string, id or save, and has no Hebrew speaker's review. It does not decide the kit
sign (§4, point 1) or edit the specs in §4, point 2.
