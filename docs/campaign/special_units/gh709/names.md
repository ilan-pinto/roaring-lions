# GH-709: the names screen (spec §6 Q13, storyline §2.4 rule 3), 2026-10-22

`narrative-designer` ran this screen before any name went into the staged JSON. It changed only `name` and `blurb`
in the nine files beside this one. **The ids stay**: tests, probes, the art plan and the
`mesh-catalogue` entries already use them, and a player never reads them.

## Method

E5's method, repeated (`../e5/numbers.md`, "The names screen"). Each candidate was searched with the MediaWiki
search API on en.wikipedia.org and he.wikipedia.org. Four queries per name: `intitle:"<transliteration>"`,
`"<transliteration>" Israel Defense Forces`, `intitle:"<Hebrew>"` and `"<Hebrew>" צה"ל`. Then the matching
articles were read where the hit was not self-evident. A candidate is rejected if any of five things is true:

1. **Real-world collision.** The word is a real platform or its service name, a real unit, a real operation, a real
   armed group, a real company in the same trade, or a faith term (storyline §2.4 rules 3 and 5).
2. **In-game collision.** The word is already a unit name (Lavi, Namer, Eitan, Kipod, Shoded, Tzinah, Dov, Peten,
   Yanshuf, Shmamit, Shiryonan, Shachaf, Yahalom), or one of the `data/campaign/names.json` squad, hull or task
   callsigns, or close enough to another name in this set to be misread in the store.
3. **Readability.** An English-reading player sees an unfortunate word, or a Hebrew reader sees a second meaning.
4. **Register.** Rule 4: a single Hebrew common noun, mostly an animal, followed by the shipped descriptive pattern
   (*Kipod Screen Carrier*, *Shachaf Scout Car*, *Shmamit Deep Recon Team*).
5. **Doctrine.** No faith, ethnicity, nationality, real place or real insignia (rule 5). Ruling Q12 also forbids
   medical emblem language, so no name or blurb mentions a red cross, crescent, crystal, star or star of life.
   The plain words *ambulance*, *medic* and *medevac* are descriptions, not emblems.

This is an encyclopaedia search, not a trademark or web search. The lead may still veto any name.

**Variants keep their parent's name.** The camouflaged Lavi and the cluster cannon are Blender variants of a hull the
player already knows. They follow the *Peten Gunship* precedent and take the parent's name plus a role. The
medevac helicopter is the exception. Its parent, *Yanshuf*, is the Israeli Air Force's real service name for the
UH-60, an inherited collision like *Peten* (`../design.md` §9.3). A new unit should not add one more, so it gets
its own name.

## The nine

| id | name | blurb | screen |
|---|---|---|---|
| `mbt_lavi_camo` | **Lavi Ambush Tank** | Waits under a net and is seen late. The net fouls its active protection, and a shot shows it. | *Lavi* is canon (rule 4) and the shipped `mbt_lavi`'s name. It is not the real tank's name; *IAI Lavi* is a cancelled aircraft, an inherited collision. Nothing new is added, and no unit is called "Lavi Ambush". **Pass.** |
| `spg_long_range` | **Te'o Howitzer** | Reaches deeper than any other gun and sees none of it. Every round is billed where it lands. | *Te'o* (תאו) is the buffalo: heavy, slow and patient. No platform, unit or operation was found in either language. Other hits: a Samoan surname (*Manti Te'o*) and the nature reserve *Ein Te'o*, which is a different word. It also avoids every artillery battalion name: Keren, Namer, Magen, Shfifon, Ha-Ra'am, Eitam. The apostrophe is already in the register (*Te'ala*, *Ma'ader*). **Pass.** |
| `at_nlos_team` | **Zaron Missile Team** | Kills what your side has spotted, without a sight line and at low collateral. Useless up close. | *Zaron* (זרון) is the harrier, a hawk that quarters low and strikes prey it hears rather than sees. Zero military hits in Hebrew. The English searches found nothing. **Pass.** |
| `veh_ambulance` | **Pered Armoured Ambulance** | Men on foot around it heal while it stands still. Four seats under armour, and no gun at all. | *Pered* (פרד) is the mule, which carries the load and does not fight. No military hit in Hebrew. In English the only hit is *Pered*, a Slovak village (Tešedíkovo) and a 1945 battle there. That is a foreign toponym, not a materiel or group name, and is recorded as a minor coincidence. **Pass.** |
| `air_medevac_heli` | **Nachlieli Medevac** | Heals what it carries while it flies, four squads at a time. Unarmed, and it lands to load. | *Nachlieli* (נחליאלי) is the white wagtail, the winter bird every Israeli child sings about. No platform, unit or operation was found. Other hits: one surname (*Eliav Nachlieli*). Readability: the longest name in the set, about as long as *Shmamit*. **Pass.** |
| `inf_medic_squad` | **Nemala Medic Team** | Heals the men on foot around it while it holds still. It cannot heal itself, and barely fights. | *Nemala* (נמלה) is the ant. Some ant species carry and treat their own wounded. Zero hits in English and no military hit in Hebrew. **Pass.** (*Team*, not *Squad*: it is six men, like the shipped *Sniper Team*.) |
| `inf_grenadier` | **Chomet Grenadier Squad** | Grenades reach men behind a wall, never inside a house. In a flagged street they cost Conduct. | *Chomet* (חומט) is the skink. No military hit in either language. Other hits: a French film-maker's surname (*Sylvain Chomet*). For an English reader it echoes *comet*, which suits a lobbed round. **Pass.** |
| `ugv_recon_dog` | **Chadaf Recon Robot** | Walks boulders and alleys no wheel can, and finds tunnel routes. Unarmed, and cheap to lose. | *Chadaf* (חדף) is the shrew: small, quick, nose-first into burrows. No military hit in either language. The one English hit was a fuzzy match that does not contain the word. **Pass.** |
| `spg_cluster` | **Te'o Cluster Howitzer** | Bomblets shred men and trucks in the open, not armour or houses. Conduct pays for every round. | Variant of `spg_long_range`'s chassis (ruling Q4), named the *Peten Gunship* way. *Cluster* puts the Conduct-heavy round in the name, so nobody buys it thinking it is the plain gun. **Pass.** |

**Checks on the blurbs.** Every blurb is two sentences and at most 95 characters, under the schema's `maxLength` of 96
(`unit.schema.json`). Each says what the unit does in play and what it costs. None promises anything beyond the
spec:

- No wounded, evacuation or rescue: GH-707 does not exist yet.
- Nothing about anti-aircraft fire or camouflaged riflemen: those units are held or dropped (Q3, Q9).
- No top-attack, duds or counter-battery: D2, D3 and D4 are deferred.

The healing lines depend on E1, the NLOS line on E2 and the cluster line on E3. Those are approved engine concepts
that are not built yet. The units stay staged until they land.

## Rejected candidates, and why

Each name below was searched as above, unless the entry says it was rejected on sight.

| candidate | meaning | for | rejected because |
|---|---|---|---|
| Atalef (עטלף) | bat | NLOS | Real: the IAF's name for the AS565 Panther naval helicopter (193 Squadron) |
| Shfifon (שפיפון) | horned viper | NLOS | Real: *Operation Shfifon* (1948) and Battalion 404 "Shfifon", an M109 artillery battalion |
| Tzefa (צפע) | viper | NLOS | Real: the IAF's name for the AH-1 Cobra, and the *Tzefa Shiryon* mine-breaching system |
| Oach (אוח) | eagle-owl | NLOS | Clean, but a second owl beside the shipped *Yanshuf*. Kept as the first alternate |
| Chafarperet (חפרפרת) | mole | NLOS / dog | "Mole" is the Hebrew idiom for a spy, and the searches hit a real intelligence plan and Unit 504. Also hard to read |
| Chasida (חסידה) | stork | medevac | Real: *Operation Hasida* |
| Saknai (שקנאי) | pelican | medevac | Real: the IAF's name for the Boeing 707 tanker. The pelican "in her piety" is also a Christian emblem (rule 5) |
| Barbur (ברבור) | swan | medevac | Real: the IAF's name for its ELINT Boeing 707s. *Neve Barbur* is also a real neighbourhood |
| Anafa (אנפה) | heron | medevac / SPG | Real: the IAF's name for the Bell 212. *Tel Anafa* is a real site |
| Shapirit (שפירית) | dragonfly | medevac | Real and on point: *Shapirit Air Services Ltd.* flies Magen David Adom's ambulance helicopters |
| Snunit (סנונית) | swallow | medevac / medic | Real: the IAF's name for the Grob G-120, and *Operation Snunit* |
| Tzufit (צופית) | sunbird | medic | Real: the IAF's name for the King Air, and a real moshav |
| Pashosh (פשוש) | warbler | medic | Real: the IAF's name for the Socata TB trainer |
| Efroni (עפרוני) | lark | medevac | Real: the IAF's name for the T-6 Texan II |
| Gozal (גוזל) | fledgling | medic | Real: *Operation Gozal* and the ship *Gozal* |
| Siksak (סיקסק) | spur-winged lapwing | medevac | Clean, but an English reader sees "sick sack" on a medical helicopter |
| Tor (תור) | turtledove | medevac | Collides in English with the Russian *Tor* missile system and the *Tor* network |
| Tachmas (תחמס) | nightjar | medevac | Rejected on sight (rule 5): it shares the root ח-מ-ס with the name of a real armed group active in the war the campaign transposes |
| Kafan (כפן) | spoonbill | medevac | Rejected on sight: *kafan* is the burial shroud in Arabic, Persian and Urdu. Never on a medevac |
| Racham (רחם) | Egyptian vulture | medevac | Rejected on sight: a carrion bird circling the wounded is the wrong picture |
| Nemiya (נמייה) | mongoose | dog / grenadier | Clean, the best fit for a burrow hunter. Rejected only because *Nemiya* and *Nemala* (the medic) would be misread for each other in one store |
| Samur (סמור) | weasel | dog | Real and on point: *Samur* is the Yahalom unit's tunnel company |
| Zarzir (זרזיר) | starling | grenadier | Real: the IDF's name for the M72 LAW. Also a real Bedouin village |
| Dorban (דרבן) | porcupine | grenadier | Real: *Hetz Dorban*, the Iron Fist active protection system |
| Neker (נקר) | woodpecker | grenadier | Real: *Operation Neker* |
| Chargol (חרגול) | grasshopper | grenadier | Real: *Operation Chargol* |
| Akavish (עכביש) | spider | grenadier / cluster | Real: *Akavish Road*, the axis of the Chinese Farm battle |
| Tzir'a (צרעה) | hornet | grenadier / cluster | Real: the navy vessel *Tzir'a* and a kibbutz. Also biblical: the hornet sent to drive out peoples, which is rule 5 |
| Rimon (רימון) | pomegranate, grenade | grenadier | Rejected on sight: the literal Hebrew for *grenade*, and *Sayeret Rimon* was a real unit |
| Chardon (חרדון) | agama lizard | grenadier | Real: an IDF outpost in Lebanon. In English, *Chardon, Ohio* is known for a 2012 school shooting |
| Chipushit (חיפושית) | beetle | grenadier | Real product: the Hebrew name of the Volkswagen Beetle |
| Parpar (פרפר) | butterfly | grenadier | Real: the *Parpar* armoured car of 1948 |
| Peres (פרס) | bearded vulture | grenadier | Rejected on sight: the name of a real public figure (rule 3) |
| Tzvua (צבוע) | hyena | grenadier | Clean, but a Hebrew reader sees *hypocrite* |
| Oger (אוגר) | hamster | dog | *Saudi Oger*, a real company. An English reader sees *ogre* |
| Yarbo'a (ירבוע) | jerboa | dog | The searches hit the French *Gerboise* ("jerboa") nuclear tests |
| Chuld (חולד) | mole-rat | dog / NLOS | Clean, but an English reader sees *child* |
| Tan (תן) | jackal | dog | Unreadable in English: *tan* |
| Klavlav (כלבלב) | puppy | dog | Clean, but too cute for the register |
| Pil (פיל) | elephant | SPG | Clean (*Pil, Iran* aside), but an English reader sees *pill*, beside three medical units in the same store |
| Re'em (ראם) | oryx | SPG | Not searched on its own. It sits too close to *Ro'em*, the IDF's new self-propelled gun (from memory, not searched). The Boeing 707 article also shows *Re'em* is the IAF's name for its 707 transport |
| Shor (שור) | ox | SPG | A common surname, including a named IDF officer. In English it reads as *shore* |
| Kore (קורא) | partridge | medevac | The same spelling is the everyday word *reader / caller* |
| Kela (קלע) | sling | grenadier | Real: *David's Sling* (Kela David) and *Kela Saar* |
| Akav (עקב) | buzzard | NLOS | Faith: *Parashat Ekev*, a weekly Torah portion (rule 5) |
| Sis (סיס) | swift | medevac | Collides in English with SIS, a real intelligence service |
| Chamor (חמור) | donkey | ambulance | Rejected on sight: Hebrew slang for *idiot* |
| Gamal (גמל) | camel | ambulance | Rejected on sight: a real public figure's given name (Nasser) |

## Open for the lead

- **Te'o / Te'o Cluster.** Two store items share a name. That follows the *Peten Gunship* precedent, but the
  cluster cannon is the most Conduct-expensive thing in the store. If the lead wants it to have its own name, the
  next clean candidate in this screen is *Oach* (eagle-owl). It would then not be available as the NLOS team's
  alternate.
- **Nachlieli** is the hardest name in the set for an English player. If it reads badly in the store, *Oach* is
  also the fallback here.
