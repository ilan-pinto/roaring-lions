# The officers' names: rule-3 screen (GH-298)

**2026-09-30** · status: **proposal, docs only.** The names below are screened, and they wait for
the lead. Nothing ships until the lead accepts them. · task A1 of
`docs/superpowers/specs/2026-09-30-field-commanders-design.md` §8.2 · rules: `storyline.md` §2.4
(rules 3, 4 and 5) and `docs/campaign/names.md` §2–§3 · source names: `heroes/concepts.md` §2 and
the spec's lead rulings.

The spec (Q1, R10) keys every officer by **function**, so a rename changes only `name`. The ids
below are the spec's own. This screen changes none of them.

---

## 1. The result

| unit id | concept name | **proposed `name`** | `plate` | short form (lines, debrief) | rank | verdict |
|---|---|---|---|---|---|---|
| `officer_infantry` | Maya | **Maya Pereg** | Pereg | Maya | Captain (2 stars) | given name kept; surname added |
| `officer_fires` | Yoav | **Sagi Sharav** | Sharav | Sagi | Captain (2 stars) | **given name replaced**; surname added |
| `officer_armour` | Ronen | **Ronen Heled** | Heled | Ronen | Captain (2 stars) | given name kept; surname added |
| `officer_engineer` | Dalia | **Dalia Charsit** | Charsit | Dalia | Captain (2 stars) | given name kept; surname added |

**One name had to change.** *Yoav* is the name of a real military operation: **Operation Yoav**,
15–22 October 1948, in the Negev (en.wikipedia, "Operation Yoav"). That is ground (b) of
`names.md` §3, the same ground that rejected *Kilshon* and *Avak*. Two further hits make the name
worse. Yoav was the Palmach codename of Yitzhak Dubno, and it gives its name to the Yoav Regional
Council (en.wikipedia, "Yoav"). The best-known bearer is Yoav Gallant, Defence Minister during the
war that storyline D12 transposes. Its replacement is **Sagi** (§2.2).

**Rank.** All four are Captains. The storyline ladder (§2.1) defines no rank below Captain, so this
screen coins none. Maya taking Shai's company when he makes Major needs exactly this rank: she
commands what he commanded. The table above writes rank and name together for reading only. In
data they are separate fields, following `data/campaign/commander.json`'s `people` shape:
`name` "Maya Pereg", `plate` "Pereg", and the rank carried apart from both, the way Shai's rank
comes from `ranks` rather than from his `name`.

**One timing fact the spec should absorb.** `commander.json` keeps Shai a Captain
`until_mission: deir_amun_3_subterranean`. Khan Rafid and Deir Amun landed inside Act I after the
concept was written. The spec's Maya gate, `after_mission beit_sahwan_4_subterranean` (§3.2), is
therefore four missions before the promotion that hands her the company. Either the gate moves to
`deir_amun_3_subterranean` or her bio line changes. That is a `mission-author` and lead call, and
this screen does not decide it.

**Status of every string on this page.** The display names are `schema` status. They are written
into `name` when the staged JSON lands (spec §8.2 A5, then E1). Nothing here is `live`. The bios
are canon notes, not player-facing text. The two trigger labels (§4) are `schema` status and wait
for `tag_killed` (spec A6).

---

## 2. What was checked, and how

### 2.1 The procedure

The procedure is `names.md` §3, adapted for a **person**, and it was run on 2026-09-30.

- **Every given name and every surname, as a single word**, went through the three English
  Wikipedia API probes of `names.md` §3:
  1. the exact title (`prop=extracts&exintro&redirects`);
  2. a bare full-text search;
  3. a search beside armed-force vocabulary: `(brigade OR battalion OR missile OR militia OR
     "armed group" OR general OR politician OR operation OR IDF)`.

  Two Hebrew Wikipedia probes were added: the exact title of the Hebrew spelling, and the Hebrew
  spelling beside `צה"ל`. The Hebrew probes exist because the E5 screen showed that a collision can
  live in only one of the two languages. *Zikit* was an example (`special_units/e5/numbers.md`).
  The Hebrew probes matter more now that the KDF speaks Hebrew (GDD §2 **Voice**). A name is also
  something a player will *hear*.
- **Every full name**, per `storyline.md` §2.4 rule 3, went through a quoted-phrase search on
  English and Hebrew Wikipedia. Each also got a quoted-phrase general web search on DuckDuckGo;
  the limits of that search are stated in §5.
- **Against this tree.** `grep -rliw` found no match for any of the eight final words in `data/`,
  `packages/`, `docs/` or `tools/src/`, apart from the two design documents that introduced the
  concept names. The names were also compared against the protagonists (Shai Hammai, Idit Zohar),
  the retired HUD name (Lt Col Dagan), the villains (Nadir Sahim, Karim Adhal, Jubran Hallaq), the
  file names (SPADE, LANTERN, FERRY), the deferred officer (Omer), every entry of
  `data/campaign/names.json`, every place in `data/campaign/world.json` and every unit `name` in
  `data/units/`. There is no collision. Two near-sounds are recorded in §5.

**Two standards, stated so the lead can overrule either.**

- **A given name** is judged on ground (b), a real unit, formation, operation, platform or system.
  It is also judged on whether the name's search surfaces a specific event of the war D12
  transposes. It is **not** rejected because other people bear it. Every common Hebrew given name
  has an IDF officer among its bearers: Shai and Idit do. Nor is it rejected when a disambiguation
  page lists an unrelated people or deity under the same letters. A given name standing before a
  surname reads as a person, not as a word. This is the refinement `names.md` §3 already applies to
  ground (a).
- **A surname** gets the full `names.md` §3 standard: grounds (a) to (d) and legibility. Unlike a
  given name, a surname can be heard alone ("Sharav, fire"), and so it can read as a word.
- **A full name** must match no real public figure (rule 3). Wikipedia is the proxy for "public
  figure" here, as it is in `names.md`.

### 2.2 The given names

| name | exact title (en / he) | military probe | verdict |
|---|---|---|---|
| **Maya** | en: disambiguation. It leads with the Maya peoples and with *māyā* in Indian religions. he: the Maya civilisation | no unit, operation or system. Hits are incidental (order-of-battle pages that contain the string) | **keep.** The given name is among the most common Israeli female names, and a KDF officer called Maya attaches no people or faith to any faction (rule 5 is about attaching). The disambiguation is recorded as residual |
| **Yoav** | en: "a male given name… Joab… Yitzhak Dubno, a 1940s Palmach soldier whose codename was Yoav… namesake of… Yoav Regional Council" | **Operation Yoav** (1948), the first hit | **replace**, on ground (b) |
| **Ronen** | en: "a Hebrew surname and given name" | no unit or operation. People: Ronen Manelis (IDF spokesman) and Ronen Bar (Shin Bet director). On he.wikipedia, two armour colonels share the given name: **Ronen Itzik** (commanded the Harel brigade) and **Ronen Tamim** (last commander of the 847th "Merkavot HaPlada") | **keep**, with the residual stated. The armour bearers are given-name coincidences with the same role, and they are the closest miss on this page. If the lead wants zero role overlap even at the given-name level, this is the name to change |
| **Dalia** | en: disambiguation, listing Kibbutz Dalia, the Dalia River, a Lithuanian goddess and an Angolan oil field. he: the dahlia flower | no unit, operation or system | **keep.** The same reasoning applies as for Maya. The place and the goddess are recorded as residual |

**Finding the replacement for Yoav.** Twenty-three given names were probed. The replacement had to
be a male given name, modern (not a scriptural figure's name, which reads as that figure), with no
unit, operation or system, and not surfaced by the war's events. Those rules keep the officers two
women and two men, as the concept set was.

| candidate | why not |
|---|---|
| Oded | **Oded Brigade**, a real IDF formation (ground b). Oded Lifshitz was a hostage |
| Nir | Nir Oz and the Nir Oz attack are the first hits |
| Yotam | *Killing of Alon Shamriz, Yotam Haim, and Samer Talalka* surfaces in the military probe |
| Roi | Col. Roi Levy, killed in the war D12 transposes, surfaces in the military probe |
| Eran | the exact title is an Indian archaeological site, and *Eran* is the Middle Persian name for Iran (a nationality) |
| Niv | NIV, the New International Version of the Bible (faith), and the Nipah virus |
| Lior | Dov Lior, a rabbi (faith, and inside the real conflict) |
| Tamir | Tamir Yadai (Ground Forces commander) and Tamir Hayman (Military Intelligence chief) lead the military probe |
| Nadav, Boaz, Amit | a biblical priest, a biblical figure and Temple pillar, and "a Hindu and Jewish given name" (faith) |
| Matan, Yinon | the exact title of each is a real settlement |
| Itai | the first bare hit is *Itai-itai disease* |
| Ziv | Israel Ziv, IDF major general, leads the military probe |
| Idan, Raz, Stav, Nitai, Ofri, Liran, Yahav | weaker than Sagi: an unrelated exact title, a first sense that is a common word, or too little on record to judge |

**Sagi** is the pick. The en exact title is "an Israeli male given name, of Hebrew origin, meaning
'great, elevated, sublime'" (he: "a word meaning elevated, exalted"). The military probe finds no
unit, operation or system. Its military hits are the **surname** Sagi: Uri Sagi and Yehoshua Sagi
(both chiefs of Military Intelligence) and Tsuri Sagi (paratroopers). These are recorded as
residual. None is a fires officer, and none is the given name. *Elevated* suits a man whose whole
kit is standing where he can see.

### 2.3 The surnames

The register is `storyline.md` §2.4 rule 4: Hebrew-derived, and plain nouns of ground, weather and
growth, like Idit's *Zohar*. None of the chosen nouns is in `names.json`, so no officer shares a
word with a squad callsign or a painted hull name.

| surname | Hebrew | meaning | en exact / bare | military probe (en / he) | verdict |
|---|---|---|---|---|---|
| **Pereg** | פרג | poppy | no article. Two private-scale bearers: Nira Pereg (artist) and Lily Pereg (microbiologist) | none / none. The one he hit is the Maharal *of Prague* (the same letters) | **pass** |
| **Sharav** | שרב | the khamsin, a heatwave | disambiguation: a Scottish snooker player, Mongolian given names, and "known as *sharav* in Hebrew" | none / none | **pass** |
| **Heled** | חלד | lifespan, the world that lasts | no article. Bearers: Yuval Heled (exercise physiologist) and Joseph Heled (bioinformatician) | none / none | **pass** |
| **Charsit** | חרסית | clay | no article. **0** bare hits | **0** / none | **pass**, the cleanest word on this page. Romanised with `Ch` for ח, as `names.json` does (*Chatzatz*, *Charitz*). The `H` spelling was rejected because *Harşit* is a river in Turkey |

**The pairing.** Each name-plus-surname pairing was chosen to avoid a *known* private namesake.
The first general-web queries found an Instagram account and a physician (Dr Maya Heled Akiva)
under **"Maya Heled"**, and an Instagram and Facebook account under **"Sagi Pereg"**. Private
people fall outside rule 3, but a shipped character wearing a living stranger's exact name is
avoidable. The surnames were therefore rotated. No quoted full name returns a hit on English or
Hebrew Wikipedia:

`"Maya Pereg"`, `"Sagi Sharav"`, `"Ronen Heled"`, `"Dalia Charsit"`, and
`"מאיה פרג"`, `"שגיא שרב"`, `"רונן חלד"`, `"דליה חרסית"`: **0 hits each.**

### 2.4 Rejected surnames: the record, so nobody proposes them again

Some of these are traps worth knowing. They are real Israeli materiel or units hiding behind
ordinary nouns.

| word | ground | the hit |
|---|---|---|
| **Kalanit** (anemone) | (b) | **the Kalanit, IMI's 120 mm APAM-MP-T multipurpose tank round** (en.wikipedia, "Kalanit (shell)"). It is also a settlement |
| **Sirpad** (nettle) | (b) | **a real Military Police combat unit** (en.wikipedia, "Military Police Corps (Israel)": "merged with the Sirpad combat unit") |
| **Afor** (grey) | (b) | AFOR, a real NATO force (en.wikipedia bare and military probes) |
| **Zakif** (sentry, stalagmite) | legibility | clean in English. In Hebrew, however, it is the translation of *Sentry* and *Sentinel*: the E-3 Sentry, the RQ-170 Sentinel and NATO's *Operation Eastern Sentry*. It is also a guard-duty role word, so on a Hebrew radio net "Zakif" addresses a sentry and not a man |
| **Tzalaf** (caper) | legibility | in Hebrew it is also *sniper*, and its he-military hits run straight into the real war (the *Lachatz* rule of `names.md` §3) |
| **Tzahor** | (a) | Giora Tzahor, a Mossad and military officer (the exact title) |
| **Gavish** | (a) | Yeshayahu Gavish, head of IDF Southern Command in 1967 (surname index) |
| **Shenhav**, **Mishol**, **Peles** | (a) | a surname index, the poet Agi Mishol, and the singer Keren Peles |
| **Gidron** | (a) | Moshe Gidron, an IDF officer (military probe) |
| **Tzafrir** | legibility | its he-military hit is the October 7 inquiries |
| **Arzi** | legibility | bare hits run to the Netanyahu family (Ben-Artzi) |
| **Bazelet** | (c) | the en exact title redirects to Golan Brewery, whose beer is *Bazelet*. It is also a river |
| **Maor**, **Mishor**, **Dardar**, **Rekem**, **Nof** | (c) | a moshav; Mishor Adumim; a Tajik village; Petra and a Belgian town; Tel Nof Airbase |
| **Elgavish**, **Leshem**, **Kadkod**, **Nogah**, **Gesem**, **Tzela**, **Mishkal** | (d) | Ezekiel's hailstones; a High Priest's breastplate stone; gemstones and angels; a son of David; Goshen; Eve's rib; a mosque |
| **Matar**, **Arnav** | register | an Arabic surname, and an Indian given name, which read as the wrong side or no side |
| **Tzuki**, **Zarkor**, **Rom**, **Ogen**, **Sitvanit**, **Mishkolet**, **Tzameret**, **Sheled**, **Kidmi** | legibility | a wrestler, a B-movie, ROM and Romania, a drug brand, too long, too long, "the top brass", "skeleton", too close to *Kedem* |

These were **not probed, because the answer is known**: *Tzuk* (Tzuk Eitan is Operation Protective
Edge), *Shavit* (the launcher), *Matzpen* (a real political organisation), *Hadar* (Hadar Goldin),
*Arad* (Ron Arad), *Rimon*, *Egoz*, *Duvdevan*, *Shaked* (units), *Tavor*, *Galil*, *Kfir*, *Ofek*
(materiel), *Givati*, *Carmeli*, *Harel* (brigades), *Sadeh*, *Alon*, *Gur*, *Harpaz* (people), and
*Tzabar* (Sabra).

---

## 3. Bios, one line each

These are consistent with `storyline.md` §2.1, D12 and the spec's rulings: always wounded, never
killed; officers never brief; no third briefing voice.

- **Capt. Maya Pereg**, infantry company commander (`officer_infantry`). She was the platoon
  leader beside Shai inside the compound at First Light. When he makes Major, his company becomes
  hers, and she is the one person who still gets his rank wrong.
- **Capt. Sagi Sharav**, forward observer (`officer_fires`). He was attached for Sur to do to
  LANTERN what LANTERN does to Kedem. He is an observer sent to hunt an observer, and he is only
  useful where he can be seen.
- **Capt. Ronen Heled**, armour commander in a command Lavi (`officer_armour`). He led the tank
  platoon that was the relief that came late to First Light. Everything he has done since is an
  answer to those hours, and he never explains it.
- **Capt. Dalia Charsit**, engineer commander (`officer_engineer`). She is the Yahalom officer who
  read SPADE's routes in Beit Sahwan II and IV as disturbed earth. In Naharin she is the one
  arguing that the D9 takes the southern road.

The "never says it aloud" rule that binds Shai binds Ronen's line too: the bio states his motive,
and no bark may.

---

## 4. The two enemy leader labels (`tag_killed`, spec §4)

Enemy leaders stay **disposable and unnamed** (GDD §2 asymmetry, spec §4). They carry a tag and a
trigger label, never a personal name: the villains are the only enemies with names. Each label is
what the player reads in the feed when the trigger fires. It is at most 48 characters with no full
stop, per `docs/campaign/README.md`.

| doctrine | tag (spec §4) | `do` | label | chars | status |
|---|---|---|---|---|---|
| Sarim | `sr_observer` | `withdraw_to` the ATGM group's fallback | **Their observer is down — the cells fall back** | 44 | `schema` (waits for A6) |
| Rif | `rf_leader` | `withdraw_to` an exit marker | **Raid leader down — the raid is breaking up** | 42 | `schema` (waits for A6) |

Each label names the consequence rather than the kill. That follows the house rule that restraint
is a mechanic: the player is told what the death changed, not congratulated for it.

---

## 5. Residual risk, stated rather than hidden

1. **The general-web screen of the final pairings did not finish.** DuckDuckGo answered the first
   two queries and then served its bot challenge for the rest of the session, across several
   paced retries. The Wikipedia screen, which is the `names.md` standard, is complete. A general
   web search for the four quoted full names was not done. It is **four queries for a human
   before the names go into JSON**.
2. **Ronen** shares its given name with two he.wikipedia armour colonels (§2.2). This is the
   closest miss on this page.
3. **Maya** and **Dalia** lead disambiguation pages that list a people, a religion and a goddess.
   They are kept by the given-name standard in §2.1, and the lead may rule otherwise.
4. **Near-sounds.** *Sagi* and *Sahim* (the Marj villain) share an opening. So do *Sharav* and
   *Shai*. Neither pair lands on the same front: Sagi arrives in Sur, after Sahim's arc has ended.
   On the net, "Sharav" and "Shai" differ in length and stress. The pairs are recorded so that
   the bark writer does not put two of them in one line.
5. **Found while screening, out of scope, and not acted on.** The military probe for *Yoav*
   surfaced **"401st Brigade (Israel)"**. The real IDF 401st is an armoured brigade, "Iron
   Tracks", in the 162nd Division. Canon's **KDF 401st "Ari'im"** (GDD §2, `storyline.md` §2.1)
   carries the same number. Whether a shared number breaks rule 5 ("never a real insignia") is a
   canon question for the lead, and it is recorded here only because this screen is where it
   turned up.

---

## 6. Hand-off

- **`mission-author` / A5 staging.** `name` becomes the display name above once the lead accepts
  it. Ids, types and every other field are untouched.
- **`narrative-designer`, next.** The spec §5.4 bark list (two to four lines per officer, keyed
  `he.<pool>.<event>`). The GH-110 rule is written at the top before any line. Every line is
  `engine` until the bark channel and the D5 licence land.
- **`level-scripter`.** The two labels in §4 go on the `tag_killed` rows when A6 lands.
