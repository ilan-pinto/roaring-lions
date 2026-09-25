# Unit voices — design (WP-AU1, #245)

**Date:** 2026-09-25 · **Status:** draft for the lead; nothing recorded or built. **Placement:** an
Add. Spec in Stage 2; build in Stage 4, lane A, beside S-F and A4; assets in parallel once §6's
rights are settled. **Part of:** GH-110's voice programme (with #133 music, #134 SFX). **Out:**
EVA announcements, briefing voice-over, `say` lines, battle chatter.

## 1. Status and problem

The lead: *"Need to add voices when a unit gets a new order. Moving, attacking, demolishing or when
units die. For KDF units, it should be in Hebrew. For the others, use Arabic."*

**What exists.** `data/audio.json` has 11 battle sets (31 clips, all `tools/gen_audio.py`, CC0),
4 UI sets (two clips; `ui_alert` and `ui_objective` use the synth) and one music track.
`BattleAudio` (`packages/render/src/audio.ts`) has a master bus with an `sfx` bus under it; music is
an `<audio>` element; `playSet` places a sound by camera distance (`AUDIBLE_TILES` 26), `playUi`
does not. Settings carry `audio.master/music/sfx`; `m` mutes. `tools/validate_audio.py` checks
licence, source, format, 512 KB and gain — **not loudness, not duration**. Nothing speaks; the
`bark` channel in `docs/campaign/README.md` is *approved target, unbuilt*.

**The samples** (`.superpowers/voices-samples/`, git-ignored). **I cannot listen to them.** What
follows is the filenames, `ffprobe` and `ffmpeg -af ebur128`.

| File | Length | Speech (−45 dB) | Integrated | True peak | The name suggests |
|---|---|---|---|---|---|
| `attack.mp3` | 1.80 s | 0.25–1.80 s | −9.3 LUFS | −0.3 dBFS | an attack line, language unknown |
| ` inshouts2. .mp3` | 1.80 s | all | −18.0 | −1.9 | "shouts", unknown |
| ` inshouts3 .mp3` | 3.40 s | 0–1.29 s | −11.0 | −0.6 | "shouts"; 2.1 s trailing silence |
| `od ktana etlecha.mp3` | 1.41 s | 0.16–1.20 s | −31.7 | −15.2 | transliterated Hebrew, meaning unsettled |
| `on my way kdf infentry.mp3` | 2.04 s | 0–0.89 s | −13.1 | −0.8 | KDF infantry, "on my way" |
| ` alláhuwakbar! .mp3` | 1.57 s | all | −22.2 | −8.9 | a religious exclamation (§5) |
| `אוחתי מועלימה .mp3` | 5.72 s | 0.67–4.82 s | −23.0 | −4.1 | Arabic *ukhti mu'allima*, "my sister is a teacher", in Hebrew letters: a phrasebook sentence |

All seven are mono MP3, 44.1 kHz, 128 kb/s, one muxer tag (`Lavf60.16.101`); loudness spans 22
LU. `attack` and `inshouts2` share an exact length (69 MP3 frames), common for a fixed-length
generator, rare for a read — a question for D5, not evidence.

## 2. Triggers

The voice speaks for the **gesture**, never per unit. One right-click can dispatch `demolish`,
`garrison` and `attackMove` at once (`resolvePointer`); the director ranks them with the cursor's
own `winningVerb` (`input/cursor.ts`: demolish > charge > attack > garrison > mount > dismount >
smoke, else move), so the voice says what the cursor promised.

| Trigger | Source | Pool |
|---|---|---|
| `move` | `order` intent, cursor `move` | class `move` |
| `attack` | `order` intent, cursor `attack` (hostile under it) | class `attack` |
| `demolish` | `demolish` intent | engineer `task` |
| `garrison` `smoke` `mount` `dismount` `halt` `charge` | their intents and keys | shared verb line |
| `death`, KDF | `destroyed` SimEvent, side 0 | class `death` |
| `death`, enemy | `destroyed`, enemy side, visible | class `death`, placed |
| enemy order (D7) | `trigger` MissionEvent whose `do` is `commit`/`withdraw_to` | Arabic `move`/`attack` |

Silent: `select`, `group`, `overlay`, `support`, `removed` (an abduction is not a death), civilians.
**Speaker:** the voice class with most units in the winning intent; a tie goes to the first
selected.

**Numbers to approve before anything is recorded:**

| # | Item | Proposed | Why |
|---|---|---|---|
| N1 | Lines per order | 1 per gesture, whatever the unit or intent count | the lead's rule |
| N2 | Repeat window | same verb and selection within 4.0 s: 2nd → `ack` line, 3rd+ → silent until 4 s pass | click-spam must not nag |
| N3 | Class cooldown | a class that spoke < 1.5 s ago answers from `ack` | short, never silent |
| N4 | Interrupt | a new order line cuts the last one (40 ms fade) | feedback never late |
| N5 | Concurrency | 2 voices; order > KDF death > enemy death; the loser is dropped, not queued | a queued line describes the past |
| N6 | KDF death | 4 s per class, 2.5 s global; many deaths in one tick = one call | a salvo is one call |
| N7 | Enemy death | `renderer.isVisible` and ≤ 18 tiles from camera; 6 s global | only what is seen |
| N8 | Enemy order (D7) | needs a visible enemy unit; 10 s global | rare |
| N9 | Duration | order/`ack` 0.4–1.4 s, death ≤ 1.8 s; ≤ 40 ms head, ≤ 150 ms tail silence | samples carry up to 2.1 s of dead air |
| N10 | Loudness | −18 LUFS integrated ± 1 LU; true peak ≤ −3 dBTP | below |
| N11 | Gain | line gain 0.8; Voices slider default 1 | ≈ −20 LUFS as heard |
| N12 | Duck | SFX −4 dB, music −3 dB under a voice; 80 ms / 300 ms | speech over a tank gun |
| N13 | Radio colour | band-pass 300–3,400 Hz at runtime | reads as the net; hides source mismatch |
| N14 | Format | mono 44.1 kHz, OGG q4 + M4A 64 kb/s `alt`, ≤ 48 KB | gate's 512 KB stays |
| N15 | Volume | 90 lines × 2 takes = 180 files; first batch 57 lines | §4 |
| N16 | Decoded memory | ≤ 16 MB PCM (1.2 s at 48 kHz float ≈ 230 KB); roster factions only | |

N10, against what ships (measured): `destroyed_01` −17.3 LUFS at gain 1.0; music −13.5 at 0.4,
≈ −21.5 heard; UI clips are 240 ms, too short for ebur128, and are set by peak (−6 dBFS). A voice at
≈ −20 sits just above the music.

## 3. Language by faction

The rule reads unit JSON **`faction`** (`kdf | ashwar | sarim | rif | civilian`) through data, not
code: `audio.json` `voices.languages: { "kdf": "he", "ashwar": "ar", "sarim": "ar", "rif": "ar" }`.
`civilian` is absent, so civilians never speak.

**Voice class** is a new optional unit field, `voice: infantry | crew | engineer | air`, defaulted
from `role` — infantry, at_team, sniper, support, artillery → `infantry`; mbt, ifv, apc, technical,
recon, aa → `crew`; engineer → `engineer`; drone, gunship → `air`. Role alone is wrong twice, the
trap `mobility.wheeled` already records: `artillery` holds a truck and `aa` holds a foot team. So
JSON overrides `rocket_battery: crew`, `manpad_team: infantry`, `paramotor: air`. Drones, vehicles
and aircraft speak as crew on the radio (N13).

## 4. The line sheet

> **The rule, before any line:** doctrine, never a people (GDD §2; storyline §2.4(5)). Both sides
> speak as trained soldiers on a net — the same verbs, the same number of lines, the same restraint.
> Neither side speaks a religious phrase, slogan, taunt, real call sign, real unit name, proword or
> regional dialect; Arabic is a standard, MSA-leaning military register. A death call is a radio
> call, never a scream. Nothing is said about civilians. A native speaker reviews every line before
> it is recorded.

Keyed by class, never per unit; engineers answer `attack` from the infantry pool. **Status:** R to
record (default route), G to generate (if D4 picks TTS), S? a sample may exist — unverified, unusable
until D5. As narrative channels, all 90 lines are `engine`: `bark` is unbuilt.

### 4.1 Hebrew (KDF)

| Class | Trigger | Lines: script (transliteration, meaning) | Status |
|---|---|---|---|
| infantry | move | זזים (*zazim*, "moving") · בתנועה (*bi-tnu'a*, "on the move") · בדרך (*ba-derekh*, "on the way") | R R S?¹ |
| infantry | attack | יש מגע, פותחים באש (*yesh maga, potchim ba-esh*, "contact, opening fire") · מסתערים (*mista'arim*, "assaulting") · על המטרה (*al ha-matara*, "on the target") | S?² R R |
| infantry | death | נפגענו (*nifga'nu*, "we're hit") · יש נפגעים (*yesh nifga'im*, "casualties") · איבדנו קשר עם החוליה (*ibadnu kesher im ha-khulya*, "lost contact with the section") | R R R |
| crew | move | נהג, סע (*nahag, sa*, "driver, go") · נהג, קדימה (*nahag, kadima*, "driver, forward") · זזים לנקודה (*zazim la-nekuda*, "moving to the point") | R R R |
| crew | attack | מטרה מזוהה, אש (*matara mezuha, esh*, "target identified, fire") · תותחן, על המטרה (*totchan, al ha-matara*, "gunner, on target") · יורים (*yorim*, "firing") | R R R |
| crew | death | הכלי נפגע (*ha-kli nifga*, "vehicle hit") · נפגענו, נוטשים (*nifga'nu, notshim*, "hit, bailing out") · חדירה, כולם החוצה (*chadira, kulam ha-khutza*, "penetration, everyone out") | R R R |
| engineer | move | חבלנים בתנועה (*khablanim bi-tnu'a*, "sappers moving") · זזים עם הציוד (*zazim im ha-tziyud*, "moving with the kit") · בדרך למבנה (*ba-derekh la-mivne*, "on the way to the structure") | R R R |
| engineer | task (demolish) | מתחילים הריסה (*matchilim harisa*, "starting demolition") · מתחילים לעבוד על המבנה (*matchilim la'avod al ha-mivne*, "starting work on the structure") · מטען מוכן, להתרחק (*mit'an mukhan, lehitrachek*, "charge set, stand clear") | R R R |
| engineer | death | החבלנים נפגעו (*ha-khablanim nifge'u*, "sappers hit") · צוות ההנדסה נפגע (*tzevet ha-handasa nifga*, "engineer team hit") · נפגענו ליד המבנה (*nifga'nu leyad ha-mivne*, "hit at the structure") | R R R |
| air | move | עולה לגובה (*ole la-gova*, "climbing") · בדרך לגזרה (*ba-derekh la-gizra*, "en route to the sector") · מתמקם מעל הנקודה (*mitmakem me'al ha-nekuda*, "taking station over the point") | R R R |
| air | attack | יש לי זיהוי (*yesh li zihui*, "I have identification") · מסמן מטרה (*mesamen matara*, "marking the target") · נכנס לתקיפה (*nikhnas li-tkifa*, "going in") | R R R |
| air | death | איבדנו תמונה (*ibadnu tmuna*, "we've lost the picture") · נפגעתי, מאבד גובה (*nifga'ti, ma'aved gova*, "hit, losing height") · אין קשר (*ein kesher*, "no contact") | R R R |
| verbs | garrison · smoke · mount · dismount · halt · charge | נכנסים למבנה (*nikhnasim la-mivne*, "entering the building") · זורקים עשן (*zorkim ashan*, "popping smoke") · עולים לכלי (*olim la-kli*, "mounting up") · רמפה, יורדים (*rampa, yordim*, "ramp down, out") · עוצרים (*otzrim*, "halting") · מניחים מטען בפיר (*manichim mit'an ba-pir*, "charge into the shaft") | R ×6 |
| ack | repeat or cooldown | קיבלתי (*kibalti*, "copy") · ברור (*barur*, "clear") · בסדר (*beseder*, "okay") | R R R |

¹ `on my way kdf infentry.mp3` · ² `attack.mp3`, language unknown.

### 4.2 Arabic (Ashwar, Sarim, Rif)

| Class | Trigger | Lines: script (transliteration, meaning) | Status |
|---|---|---|---|
| infantry | move | نتحرك (*nataharrak*, "moving") · في الطريق (*fi at-tariq*, "on the way") · عُلم، نتحرك (*'ulim, nataharrak*, "understood, moving") | R R R |
| infantry | attack | اشتباك (*ishtibak*, "engaging") · افتحوا النار (*iftahu an-nar*, "open fire") · نتقدم نحو الهدف (*nataqaddam nahwa al-hadaf*, "advancing on the target") | R R R |
| infantry | death | أُصبنا (*usibna*, "we're hit") · لدينا إصابات (*ladayna isabat*, "casualties") · فقدنا الاتصال بالمجموعة (*faqadna al-ittisal bil-majmu'a*, "lost contact with the group") | R R R |
| crew | move | ننطلق (*nantaliq*, "rolling out") · السائق، تقدّم (*as-sa'iq, taqaddam*, "driver, forward") · متجهون إلى النقطة (*mutajjihun ila an-nuqta*, "heading for the point") | R R R |
| crew | attack | الهدف أمامنا، نار (*al-hadaf amamana, nar*, "target ahead, fire") · الرامي، على الهدف (*ar-rami, 'ala al-hadaf*, "gunner, on target") · نرمي (*narmi*, "firing") | R R R |
| crew | death | أُصيبت العربة (*usibat al-'araba*, "vehicle hit") · أُصبنا، اخرجوا (*usibna, ukhruju*, "hit, get out") · العربة تحترق (*al-'araba tahtariq*, "vehicle burning") | R R R |
| engineer | move | ننقل المعدات (*nanqul al-mu'iddat*, "moving the equipment") · في الطريق إلى الموقع (*fi at-tariq ila al-mawqi'*, "on the way to the site") · فريق العمل يتحرك (*fariq al-'amal yataharrak*, "work team moving") | R R R |
| engineer | task (demolish, dig) | نبدأ العمل (*nabda' al-'amal*, "starting work") · نبدأ الحفر (*nabda' al-hafr*, "starting to dig") · الشحنة جاهزة، ابتعدوا (*ash-shihna jahiza, ibta'idu*, "charge set, stand clear") | R R R |
| engineer | death | أُصيب فريق العمل (*usiba fariq al-'amal*, "work team hit") · أُصبنا عند الموقع (*usibna 'inda al-mawqi'*, "hit at the site") · فقدنا الفريق (*faqadna al-fariq*, "we've lost the team") | R R R |
| air | move | الطائرة في الجو (*at-ta'ira fi al-jaww*, "aircraft up") · في الطريق إلى القطاع (*fi at-tariq ila al-qita'*, "en route to the sector") · نتمركز فوق النقطة (*natamarkaz fawqa an-nuqta*, "taking station over the point") | R R R |
| air | attack | الهدف مرصود (*al-hadaf marsud*, "target observed") · أرسل الإحداثيات (*ursil al-ihdathiyyat*, "sending coordinates") · ننقضّ على الهدف (*nanqadd 'ala al-hadaf*, "diving on the target") | R R R |
| air | death | فقدنا الصورة (*faqadna as-sura*, "we've lost the picture") · أُصبت، أفقد الارتفاع (*usibtu, afqid al-irtifa'*, "hit, losing height") · انقطع الاتصال (*inqata'a al-ittisal*, "contact lost") | R R R |
| verbs | garrison · smoke · mount · dismount · halt · charge | ندخل المبنى (*nadkhul al-mabna*, "entering the building") · نطلق الدخان (*nutliq ad-dukhan*, "laying smoke") · اصعدوا (*is'adu*, "mount up") · انزلوا (*inzilu*, "dismount") · نتوقف (*natawaqqaf*, "halting") · نزرع الشحنة (*nazra' ash-shihna*, "setting the charge") | R ×6 |
| ack | repeat or cooldown | عُلم (*'ulim*, "understood") · حاضر (*hadir*, "ready") · تمام (*tamam*, "all right") | R R R |

The sheets mirror line for line, down to "we've lost the picture" on both sides. Two takes per line
are two reads, not two texts. The player never commands an enemy unit (every selection filters on
`side === 0`), so Arabic plays only as deaths (N7) and, with D7, enemy orders. **First batch:** the
45 Hebrew lines and the 12 Arabic death lines. The inshouts pair is unmapped until the lead says
what it is; the religious exclamation and the phrasebook sentence are not used.

## 5. Tone and sensitivity

**Recommendation (D2): the opposing side speaks military acknowledgements and orders, exactly as
the KDF does — never a religious exclamation.** One sample is *Allahu akbar*. The factions are
fictional and GDD §2 defines the enemy by doctrine, never by faith. A faction whose one distinctive
voice is a religious phrase reads as a caricature of Arabs and Muslims: the player hears the faith
as the enemy. That is a real risk with players, with reviewers and at the Steam launch, and it
breaks the symmetric, professional portrayal the canon keeps — `mosque` was retired for `hall` on
the same reasoning (storyline O10). The rule binds Hebrew equally.

**The alternative, plainly:** keep the exclamation as a rare Arabic variant, say on an enemy death
or a suicide charge — which gives, in play, the enemy's faith as its reason to fight. `charge_squad`
(`kamikaze`) is where the pull is strongest; it takes the ordinary infantry pool and leaves its
blast to SFX. The lead decides.

**The language choice moves canon (D1).** Storyline §2.4(5) says voice binds hardest because
"accent, language and idiom all carry it". Real languages are now the lead's call; symmetry is what
keeps them inside the fiction. Proposed GDD §2 text, to apply on the lead's word:

> **Voice.** KDF units speak Hebrew; units of the three enemy doctrines speak Arabic, in a standard
> military register with no regional dialect. Neither side speaks a religious phrase, a slogan or a
> real call sign. Language is the one real-world marker the game admits, and it admits it
> symmetrically; faith and ethnicity stay excluded.

**Who voices (D4).** Native speakers, one per language. An accent put on by a speaker of the other
language is exactly the caricature this section prevents. A TTS voice is chosen for a neutral read,
never a comic or "foreign" one, and no real person's voice is cloned without written consent.

## 6. Production and rights

**The samples stay uncommitted.** Provenance unknown; CONTRIBUTING.md applies to audio "exactly as
it does to art" — no explicit redistribution rights, no file. The lead names each file's source and
licence (D5); until then they are reference reads.

**Routes:**

1. **The lead records** (Hebrew at least): he owns the output; ≈ 30 minutes for 45 lines × 2 takes.
2. **Voice actors**, native Hebrew and Arabic, under a written release assigning the rights (or an
   exclusive perpetual licence) for a commercial game with a source-available repository — the same
   grant the CLA takes.
3. **TTS or a voice service** — e.g. ElevenLabs, which GH-134's commenter already drives from a
   manifest. Check on the plan in use, on the day of generation: output **ownership** versus a use
   licence; **commercial** use; **redistribution** of the files in a repository; **sublicensing** to
   players and stores; whether a library voice carries its creator's terms; Hebrew and Arabic
   quality. Free tiers have historically been non-commercial. Disclose in the PR (CONTRIBUTING) and
   in the `generator` field.

**Manifest.** A top-level `voices` section beside `sets` (so `KNOWN_EVENTS` stays about the
battlefield): `gain`, `languages`, `lines` keyed `<lang>.<class>.<trigger>`; each variant carries
`file`, `alt`, `license`, `source`, `credit`, `generator`, `text`, `translit`, `en`.

**Licence id (D9).** `ALLOWED_LICENSES` is CC0/CC-BY only and predates the 2026-08-30 move to all
rights reserved; owned or commissioned voice is neither. Recommended: `LicenseRef-owned`, whose
`source` must name the release or session record. Alternative: the music track's `CC-BY-4.0` +
`credit`.

**Gate.** Each voice variant passes licence/source; its path matches
`voice/<lang>/<class>/<trigger>_<nn><take>.ogg` in ASCII `[a-z0-9_]` — no spaces, no Hebrew or
Arabic in filenames; it has `text`, `translit`, `en`; duration and loudness fall inside N9/N10,
re-measured by ffmpeg (**CI's `gates` job has none today**). Every key the director can ask for
resolves or is declared empty — speech has no synth fallback, so empty means silent. A new
`tools/voice_prep.py` trims, normalises, encodes and names.

## 7. Engine design

- **Director** (`packages/app/src/voice/`, pure, node-tested): one gesture's intents plus read-only
  lookups (type, faction, side, alive, position) and a clock in; a `VoiceCue { key, speaker,
  positional, priority }` or nothing out. It subscribes to `main.ts`'s existing `intentListeners`
  (the tutorial's stream) and coalesces a gesture's intents before ranking. Deaths come from the
  tick's `events`, beside `audio.onEvents`; visibility from `renderer.isVisible`.
- **Mixer:** a `voice` GainNode under master beside `sfx`; `AudioGains.voice`; Settings
  `audio.voice` (default 1; the field-tolerant parse keeps old saves); a **Voices** slider
  (`settings.audio.voice`). `BattleAudio.playVoice` enforces N4, N5, N12, N13 and checks mute where
  it plays, as `playUi` does. Decode order becomes ui → voice → battle, so the first order after a
  gesture can speak. Rename `MAX_VOICES_PER_TICK` (it counts sound sources) to avoid the collision.
- **No sim change.** Invariant 4: the director reads state and events, never queues a command, and
  picks variants with the presentation PRNG. Nothing under `packages/sim` changes, so the
  determinism hash, `balance` and `playtest` cannot move.
- **Placement.** Orders and KDF deaths are **unplaced**, like `playUi`: they are the radio in the
  player's ear, and an order given from the minimap far from the camera must still be answered —
  `playSet`'s distance early-out would silence it. Enemy deaths are **placed** through `playSet`:
  they are events the player watches, and N7 already demands they be on screen.
- **Captions (D8):** default **off**, an Accessibility toggle; when on, the line's `en` shows for
  its length + 1 s in one slot above the dock, never in the notice feed. Off, because every line
  repeats what the cursor and order marker already show.

## 8. Decisions for the lead

| # | Question | Recommended default |
|---|---|---|
| D1 | Adopt the language rule into canon (§5 text; storyline §2.4(5)) | yes, with the symmetry rules |
| D2 | Arabic tone | military acknowledgements only; no religious exclamation, either side |
| D3 | Arabic register | standard military, no regional dialect |
| D4 | Who voices | native speakers — the lead or an actor for Hebrew, an actor for Arabic; TTS only if §6's checklist passes |
| D5 | The seven samples | the lead states source and licence; uncommitted, reference only, until then |
| D6 | Enemy deaths | voiced when visible (N7); alternative: never |
| D7 | Enemy order lines on `commit`/`withdraw_to` | yes, phase 2, from the visible enemy unit nearest the camera |
| D8 | Captions | off by default; toggle; English meaning |
| D9 | Licence id for owned/commissioned voice | `LicenseRef-owned` with a release record |
| D10 | Civilians | silent |
| — | N1–N16 | as proposed |

## 9. Phasing

**One plan, lane A: 11 engine tasks and the asset task.** It touches `packages/app`,
`render/src/audio.ts` (not a `three/` file, so the `ThreeRenderer.ts` lock does not apply), `data/`
and `tools/`.

1. `voices` manifest types, `languages`; unit `voice` field, role defaults, three overrides.
2. `validate_audio.py` voice checks (N9, N10, names, text, keys, D9); ffmpeg in CI `gates`.
3. `tools/voice_prep.py`.
4. `BattleAudio`: `voice` bus, `playVoice`, cap and priority, duck, band-pass, mute, decode order.
5. Settings `audio.voice`, slider, i18n.
6. Director, orders: coalescing, `winningVerb`, speaker, N2, N3, `ack`; fake-clock tests.
7. Director, deaths: side/faction filter, `removed` and civilians silent, visibility, N6, N7.
8. `main.ts` wiring, plus a read-back (`__lions.voiceLog()`).
9. Captions (D8).
10. Enemy order lines (D7).
11. Verify by driving the UI — canvas, minimap and key orders, counted from the read-back; hash
    unchanged; `ui:routes` AudioContext count unchanged; README `bark` row → live.
12. **Assets** (parallel; gated on D4, D5, D9): native review, record or generate the 57-line first
    batch, prep, manifest, gate. The other 33 Arabic lines follow D7.

## 10. Risks

- **Translation.** I wrote both sheets and am a native speaker of neither. Native review of idiom and
  register is part of task 12, not an extra.
- **Perception.** A real language ties the fiction to real people even when symmetric; D1–D3
  reduce that, not remove it. Store copy and reviewers hear it before they read the GDD.
- **Rights drift.** TTS terms change; record the plan and date in `source`.
- **Repetition.** 3 lines × 2 takes per pool may grate; N2/N3 are playtest numbers.
- **Size.** ≈ 2.7 MB fetched (180 × ~15 KB); N16 caps the decode.
- **A silent first order** if decoding lags the first gesture: task 4's order, task 11's drive.
- **Role is not class.** `manpad_team` is role `aa`, on foot, and inherits `mobility.wheeled = true`
  from the role default; the explicit `voice` overrides keep voices off that inference.
