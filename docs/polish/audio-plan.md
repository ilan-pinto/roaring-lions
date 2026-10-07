# Roaring Lions: the audio plan (polish pass F)

**Date:** 2026-10-06. **Status:** design and candidates, for the lead's decisions. Nothing here
ships, nothing is wired, no voice or music was generated and no API was called.
**Answers:** PA-02 (P0) in `docs/polish/commercial-polish-audit.md`; pass F (F1 to F4) of
`docs/polish/commercial-polish-plan.md`; the §22 blocker "important audio missing or placeholder".
**Inputs read:** `packages/render/src/audio.ts`, `packages/render/src/radio.ts` (#282),
`packages/app/src/voice/` (director, announcer, lines, runtime), `packages/app/src/ui/alerts.ts`,
`data/audio.json`, `tools/gen_audio.py`, `tools/validate_audio.py`, `docs/ASSET_PROVENANCE.md`
(open item 2, D5), `docs/superpowers/specs/2026-09-25-unit-voices-design.md` (WP-AU1),
`docs/superpowers/specs/2026-09-28-pinned-feedback-design.md`, GDD §2 and §11,
`docs/campaign/README.md` (the narrative surface contract), and #418 (K10, the kit-fitted cue).

**One limit, stated first.** Nobody has listened to the candidates in §4. They were judged by
construction, by measurement (length, peak, RMS, centroid) and by a spectrogram sheet. The lead
picks by ear, as with K10.

---

## 0. Summary

The game sounds unfinished at exactly the moments meant to feel biggest:

- A win or a loss makes no sound.
- An objective gained, completed or failed plays the SAME two-note oscillator rise.
- Every alert plays the same falling oscillator pair: under fire, a squad lost, a tank lost, a
  deadline a minute out.
- Mission start is silent. A refused order is silent. Menu buttons are silent.
- There is no ambience bed.
- One music track plays without a break from the menu to the debrief.
- 4 of 40 voice keys have a take. Announcements are caption-only, and captions are off by
  default, so an announcement today is nothing at all.

The engine underneath is good and is not the problem. It has buses, a voice director with
priority, interruption and repetition rules, an announcer, a radio chain and a ducker. What is
missing is **content, a tiered cue map, and a few mix rules**.

This plan does five things:

1. Defines the F1 hierarchy and a mix and ducking table (§2).
2. Ranks the missing cues (§3) and gives two CC0 candidates for each (§4): 22 WAVs, built only
   from `gen_audio.py`'s own blocks.
3. Writes the voice-director rules and the 36 missing voice lines, as text, plus the
   Shai/Idit announcer lines (§5).
4. Sets out music transitions and sourcing (§6), and the missing ambience layer (§7).
5. Proposes ten work packages with acceptance checks (§8). The decisions for the lead are in §9.

**Recommended order.** Most of the P0 can be closed without the D5 licence:

- Phase 1 needs no licence. Land the chosen cues (AU-2), wire them through a cue map with a
  coverage test (AU-1, AU-3), and set the mix (AU-4).
- Phase 2 needs the D5 answer: voices. Phase 3 needs a music decision.

---

## 1. What the game sounds like today (measured from the code)

| Moment | What plays | Where |
|---|---|---|
| Weapon fire, impacts, near misses, APS, kills | 11 recorded sets, 31 clips, all synthesised by `tools/gen_audio.py` (CC0). Each is placed by distance from the camera (`AUDIBLE_TILES` 26), panned and low-passed | `BattleAudio.onEvents` |
| Objective **active, complete AND failed** | `ui_objective`, which has no clip, so the synth plays: a 660 Hz sine, then 990 Hz 70 ms later. **The three statuses are identical** | `alerts.ts` (`sound: 'ui_objective'` for every `objective` event) → `playUi` |
| Unit lost, under fire, deadline in 1 min | `ui_alert`, which has no clip, so the synth plays 520 → 390 Hz triangles. **One sound for every severity** | `alerts.ts`, `main.ts:4288` |
| Purchase, upgrade (garage) | `ui_purchase_01`, `ui_upgrade_01` (CC0, `gen_audio.py`) | `CUE_SET` |
| Order given | a voice bark through the radio chain (#282), when a take exists: **4 of 40 keys** (`he.infantry.move/attack/death`, `he.common.ack`). The other 36 play nothing (a dev build with `?voicetick` plays a tick placeholder) | `voice/director.ts` → `playVoice` |
| Announcements (7 events) | **nothing.** `audio: ""` on all seven, and the caption path is a no-op while captions are off, which is the default (D8, PA-23). Only the feed's own toast shows | `voice/announce.ts`, `voice-runtime.ts:59` |
| Victory, defeat | **silent.** `outcomeMoment` mounts and the music plays on | `main.ts:4065` |
| Mission start (title card) | **silent** | `hud.announce`, `main.ts:2868` |
| Refused or invalid order | **silent** (cursor only) | n/a |
| Menu, settings, deploy buttons | **silent** | n/a |
| Ambience | **none.** No bed exists | n/a |
| Music | one track, "Holding the Perimeter" (2:41, D minor, 92 BPM), looping across every screen. Its position is saved across page loads | `startMusic`, `lions.music` |

**Levels as heard at default sliders** (ffmpeg `ebur128`, this pass):

| Source | Level |
|---|---|
| The theme file | −13.5 LUFS integrated, true peak **+0.2 dBFS**: an inter-sample over, to fix on the next music deliverable |
| The theme as heard (`gain` 0.4 × `master_gain` 0.9) | ≈ **−22.4 LUFS** |
| A voice take (−18 LUFS file × line gain 0.8 × master 0.9) | ≈ **−20.8 LUFS** |

So before the duck, a voice sits only about 1.6 LU above the music. With the shipped −3 dB music
duck the gap becomes about 4.6 LU. That is thin for a foreign-language radio line over a
firefight (§2.2).

---

## 2. F1: the hierarchy and the mix

### 2.1 The six layers

Ranked by **information value**, which decides who yields to whom. This is not loudness order.

| Rank | Layer | Job | Today | Bus (today → proposed) | Target as heard, default sliders |
|---|---|---|---|---|---|
| 1 | **Voice / radio**: barks, announcements, outcome lines | the highest-information sound: what my men did, what the mission did | engine live, 4/40 takes, announcements silent | `voice` (+ radio chain) → unchanged | −21 LUFS (N10/N11, shipped) |
| 2 | **Critical cues**: outcome stingers, objective new/complete/failed, major and important alerts | a state change the player must not miss with the screen out of sight | 2 synth sounds for all of it | `sfx` (ducked under voice) → a new **`cue` bus**, not ducked by voice, own gain | stinger peaks ≈ −10 dBFS; cues ≈ −14 dBFS |
| 3 | **Combat**: fire, impacts, kills, located | the fight, where it is, how big | live, procedural | `sfx` → unchanged | peaks to −3 dBFS on a kill; ducked −4 dB under voice |
| 4 | **Unit feedback**: order bark, selection, deny | that the click landed, or did not | barks only | `voice` for barks; deny/confirm → `cue` bus | confirm ≈ −22 dBFS peak, deny ≈ −18 |
| 5 | **Music** | the emotional line | one track, everywhere | `<audio>` element → two elements (crossfade, §6) | menu −22 LUFS; battle −26 LUFS (proposed gain 0.26) |
| 6 | **Ambience** | the place is alive | **absent** | new `amb` bus under `master` | −34 LUFS, never ducked below −40 |

Two structural changes follow from the table, both small:

- **A `cue` bus.** Today `playUi` connects to `sfx`, so a voice line ducks an objective chime
  by 4 dB. A critical cue is information, not combat, and must not lose to the bark it is
  coinciding with.
- **An `amb` bus**, so ambience has a slider-free home and a duck target. It gets no slider of
  its own; it rides the SFX slider.

### 2.2 The mix and ducking table

The rows are the trigger. Each cell is what happens to that layer while the trigger sounds. The
first row is shipped (N12). Every other row is proposed.

| Trigger | Ambience | Combat SFX | Cue bus | Voice | Music | Attack / release |
|---|---|---|---|---|---|---|
| Bark: order, ack, death (**shipped**) | — | −4 dB | — | (it is the voice) | −3 dB | 80 / 300 ms |
| Announcement (objective, deadline, wave, reinforcements, unit lost) | −3 dB | −6 dB | — | holds lower-ranked lines (`hold_s` 3, shipped) | −6 dB | 80 / 400 ms |
| Objective cue, important alert | — | −3 dB for the cue's length | (it is the cue) | — | −3 dB | 20 / 250 ms |
| Major alert | −3 dB | −6 dB | — | barks below `order` dropped for 1 s | −6 dB | 20 / 500 ms |
| **Outcome** (victory or defeat) | to −12 dB over 1 s | fade out 600 ms; the sim has stopped, so only tails remain | everything else blocked for 3 s | `stopVoices()`, then the outcome line (§5.4) starts when the stinger's head ends | fade out 600 ms → stinger → the outcome bed (§6) at −22 LUFS | 0 / 600 ms |
| Mission start (title card) | fades in from −inf over 1.5 s | — | the start cue | barks are silent for the first 2 s (§5.1) | the menu bed crossfades to the battle bed over 2 s | — |
| Pause menu open | −6 dB, low-pass 800 Hz | low-pass 800 Hz on tails (no new events: the sim is stopped) | confirm and deny only | `stopVoices()` | −6 dB | 150 / 300 ms |
| Briefing / deploy screen | — | — | confirm and deny | (future briefing voice-over) | briefing bed | — |
| Muted (`m`) | off | off | off | off | paused | (shipped) |

**Rules behind the numbers:**

- **The level stack.** Information > combat > music > ambience. Never turn combat down to
  make it "clean". The plan says "explosions don't flatten": a kill is allowed to peak, and
  the voice and cue buses step back from it by ducking SFX, never by limiting it.
- **No pumping.** Release times are 250 ms or longer, and a duck already applied is re-used,
  not re-triggered (`ducked` in `BattleAudio`, shipped).
- **One duck owner per parameter.** The shipped pattern is a duck stage UNDER the slider's gain
  node (`sfxDuck` under `sfx`). The `cue`, `amb` and outcome ducks follow it, so the slider
  and the duck never fight over one `AudioParam`.
- **Battle music comes down to gain ≈ 0.26** (−22.4 → −26 LUFS as heard) and the menu stays at
  0.4. That puts a bark about 5 LU over the music before the duck and about 8 LU under it.

### 2.3 Per-cue gains (proposed manifest `gain`, file peak −6 dBFS)

| Set | Gain | ≈ Peak as heard | Why |
|---|---|---|---|
| `ui_confirm` | 0.20 | −21 dBFS | restrained (plan F1: "UI restrained") |
| `ui_deny` | 0.30 | −17 dBFS | must be heard over combat, not louder than an alert |
| `alert_minor` | 0.25 | −19 dBFS | frequent, so it must not nag |
| `alert_important` | 0.45 | −14 dBFS | |
| `alert_major` | 0.60 | −11 dBFS | |
| `objective_new` | 0.40 | −15 dBFS | |
| `objective_complete` / `_failed` | 0.50 | −13 dBFS | |
| `mission_start` | 0.55 | −12 dBFS | |
| `victory` / `defeat` | 0.70 | −10 dBFS | the loudest cue in the game, under a tank shot's peak |
| `ui_purchase`, `ui_upgrade`, `ui_kit_fitted` | 0.45 (shipped) | −14 dBFS | |

These go through `uiSetGain` exactly as the shipped garage cues do. `validate_audio.py`'s
`MAX_GAIN` 1.5 is untouched.

---

## 3. F3: the critical missing cues, ranked by player value

Player value = what the sound tells the player × how often the moment happens × how much it
matters that the screen might be out of sight. This follows the audit's rule: priority is player
impact, never implementation convenience.

| # | Cue | Fires on (event source) | How often | What the player learns | Today | Candidates (§4) |
|---|---|---|---|---|---|---|
| 1 | **Victory** | `runtime.result === 'victory'` → `outcomeMoment` | every win | "it's over and you won". The biggest moment in a mission | silent | A "Perimeter held" · B "All clear" |
| 2 | **Defeat** | `result === 'defeat'` → `outcomeMoment` | every loss | "it's over and you lost". Today the audit calls it a debug state (§22) | silent | A "Unresolved" · B "Net dead" |
| 3 | **Objective complete** | `MissionEvent objective`, `status: 'complete'` | 2 to 5 a mission | progress. The most-repeated good news | shared rise | A "Rise" · B "Stamp" |
| 4 | **Objective failed** | `objective`, `status: 'failed'` | rare, decisive | a door just closed. Must never sound like #3 | **same rise as #3** | A "Fall" · B "Sink" |
| 5 | **Alert: important** | `unitLost` (foot unit), deadline at 60 s, `wave` (new contact), `removed` side 0 (a soldier taken), `ambushSprung`, `roe` penalty (D-A9) | several a mission | something went wrong, and here is where | shared fall | A "Falls" · B "Net beep" |
| 6 | **Objective new** | `objective`, `status: 'active'` (incl. mid-mission tasking) | 1 to 4 a mission | read the objectives again | shared rise | A "Tasking" · B "Up and hold" |
| 7 | **Alert: major** | `unitLost` of a vehicle, an aircraft or a named veteran; `structureDestroyed` of a flagged or protected building (ROE); `tunnelCollapsed` against you; an objective's guarded unit lost | 0 to 3 a mission | a loss that changes the plan | shared fall | A "Three down" · B "Stab" |
| 8 | **Mission start** | the title card (`hud.announce`), once the deploy gate clears | once | the clock is running, you're in command (H3 "no abrupt UI-to-world jump") | silent | A "Radio check" · B "Deploy" |
| 9 | **UI deny** | an order that resolves to nothing: an invalid target, unreachable ground, routed or unavailable units, a disabled button | often for new players | "that didn't work", before they wonder why nothing happened (A3, PA-08/PA-14) | silent | A "Buzz" · B "Thunk" |
| 10 | **Alert: minor** | `underFire` (per-entity 5 s cooldown, shipped); `pinned` on your unit (first in 4 s) | often | "your men are taking fire": glanceable, never nagging | shared fall | A "Tick" · B "Tap tap" |
| 11 | **UI confirm** | primary actions only: Deploy, Buy, Save, Apply, Continue. **Not** every hover, tab or checkbox (D-A8) | per screen | "that registered" | silent | A "Click" · B "Up-tick" |
| 12 | **Kit fitted** | a garage purchase that adds visible kit (#418) | rare | "something was bolted on" | n/a | **#418 owns it**: candidates A, B and C are in `docs/art/sheets/kitted-vehicles/audio/` on `design/kitted-vehicles`; K10 recommends A, "Bolt-on". Not duplicated here |

**Why this order.** 1 and 2 are the §22 blocker and the end of every play session. 3 to 6 carry
the mission's state, which no other channel delivers with the screen out of sight. Today they are
one ambiguous chime, and #4 actively misleads, because a failure sounds like a success. 7 is
rarer than 5 but needs its own sound, so that "a squad lost" and "the Lavi is gone" stop sounding
alike. 8 matters once per mission but frames everything after it. 9 to 11 are feedback, and
frequent: valuable, but the cursor already carries most of 9. 12 is a garage nicety, already
designed.

**Shape grammar** (so the categories read before the details do):

| Category | Instrument | Shape |
|---|---|---|
| Objective | bells and mallets, never squares | **new** stays level · **complete** rises · **failed** falls (the rule the shipped synth already keeps: "an objective rises") |
| Alert | squares and woodblocks, never bells | tier carried by length, pulse count and register: minor 1 short knock, important 2 pulses, major 3 pulses lower and longer. Loudness is the mix table's job, not the file's |
| Outcome | the theme's key, D minor | victory resolves (D major, a Picardy close); defeat does not |
| The radio | squelch click and static (N19's shape) | marks the cues that are "the net talking": candidates `*_b_all_clear`, `*_net_dead`, `*_tasking`, `*_net_beep`, `*_radio_check` |

---

## 4. The candidates (CC0, synthesised here)

**Files:** `docs/polish/audio/*.wav`. There are 22 files (2 for each of 11 cues), 16-bit mono at
44.1 kHz, 1.7 MB in total. `candidates-spectrograms.png` shows every one on a common 2.5 s axis.

**How they were made:** `python3 docs/polish/audio/cue_candidates.py docs/polish/audio`.

- Built **only** from `tools/gen_audio.py`'s blocks: `env`, `noise`, `lowpass`, `highpass`,
  `sine`, `tail`, `norm`, `_at`, `UI_PEAK`. Small helpers (bell, brass, square, drum, squelch)
  are compositions of those blocks.
- No sample, no model, no third-party input, so every file is **CC0 with no licence question**.
- Every noise-drawing candidate reseeds `gen_audio`'s RNG with its own constant, so a re-run is
  byte-identical (checked: two runs, identical MD5s for all 22).
- Every file peaks at exactly **−6 dBFS** (asserted) and stays under its tier's length ceiling
  (asserted): UI 0.25 s, cue 0.8 s, major 1.0 s, start 1.5 s, stinger 2.5 s.
- A chosen candidate moves into `gen_audio.py` unchanged. UI-length ones go into `UI_SETS`;
  longer ones go into a new `STINGER_SETS`, because `UI_MAX_S` 0.25 is asserted for UI sets.

| Cue | Candidate | What it is | Length | RMS | Centroid | Pick |
|---|---|---|---|---|---|---|
| Victory | `victory_a_perimeter_held.wav` | frame-drum hit, low brass D-minor fifth swelling, landing at 0.62 s on a second hit with an F♯: a D-major (Picardy) close, faint A5 bell | 2.45 s | −19.1 | 1.9 kHz | **A**: the theme's own key, resolved; weight without fanfare (the theme prompt says "not triumphant") |
| | `victory_b_all_clear.wav` | radio squelch, two rising call tones D5 → A5, soft D-major pad | 1.90 s | −18.0 | 5.1 kHz | B if the lead wants the radio as the narrator |
| Defeat | `defeat_a_unresolved.wav` | dull drum, D-minor brass whose top voice sinks A → G♯ while the filter closes; no cadence | 2.45 s | −20.3 | 1.7 kHz | **A**: pairs with victory A (same instruments, opposite resolution) |
| | `defeat_b_net_dead.wav` | squelch, static rising and then CUT (no squelch tail), one low tolled bell falling a tritone | 2.20 s | −21.1 | 6.2 kHz | B is the more literal "lost contact" |
| Objective complete | `objective_complete_a_rise.wav` | struck D-major triad D5 F♯5 A5, 70 ms apart | 0.75 s | −19.8 | 1.8 kHz | **A**: rises, and is clearly a bell, so it can't be mistaken for `ui_purchase` (pure sines over a clunk) |
| | `objective_complete_b_stamp.wav` | low stamp, then one bright A5 bell with octave shimmer | 0.70 s | −20.3 | 2.7 kHz | |
| Objective failed | `objective_failed_a_fall.wav` | darker bell A4 then D♯4 (tritone down), low-passed | 0.80 s | −18.2 | 0.6 kHz | **A**: the mirror of complete A |
| | `objective_failed_b_sink.wav` | two muffled low hits a semitone apart, falling, with a breath of noise | 0.75 s | −16.1 | 2.3 kHz | |
| Objective new | `objective_new_a_tasking.wav` | squelch, then two identical G5 pips: level, "listen" | 0.45 s | −18.6 | 5.7 kHz | **A**: level means "new", and the radio means "from HQ" |
| | `objective_new_b_up_and_hold.wav` | three soft mallet notes A4 D5 D5 | 0.60 s | −17.6 | 0.9 kHz | |
| Alert: minor | `alert_minor_a_tick.wav` | one soft woodblock knock | 0.14 s | −20.5 | 7.9 kHz* | **A** |
| | `alert_minor_b_tap_tap.wav` | two muffled clicks 60 ms apart | 0.13 s | −25.0 | 5.8 kHz | |
| Alert: important | `alert_important_a_falls.wav` | two falling round squares G5 → D5: the shipped synth's meaning, in a better voice | 0.45 s | −14.2 | 2.6 kHz | **A**: keeps what players already learned |
| | `alert_important_b_net_beep.wav` | squelch, then two A5 beeps | 0.45 s | −15.2 | 5.4 kHz | |
| Alert: major | `alert_major_a_three_down.wav` | low thud, three falling square pulses E5 D5 B4 | 0.95 s | −19.0 | 2.1 kHz | **A**: the important alert plus one pulse, lower and longer, so the tiers read as one family |
| | `alert_major_b_stab.wav` | low brass cluster D3 + E♭3 on a drum hit, then a falling A4 → A3 call | 0.95 s | −20.3 | 1.4 kHz | |
| Mission start | `mission_start_a_radio_check.wav` | squelch, call tones D5 → A5, drum hit over a low D | 1.35 s | −19.2 | 4.0 kHz | **A**: shares victory B's call tones, so start and end rhyme |
| | `mission_start_b_deploy.wav` | a frame-drum roll that quickens (6 strokes) into a hit with a low D–A fifth | 1.45 s | −21.1 | 2.5 kHz | |
| UI confirm | `ui_confirm_a_click.wav` | crisp 1.3 kHz tick with a breath of air | 0.07 s | −19.4 | 6.3 kHz | **A**: the least there is |
| | `ui_confirm_b_up_tick.wav` | two short rising ticks 1.1 → 1.48 kHz | 0.11 s | −17.9 | 1.4 kHz | |
| UI deny | `ui_deny_a_buzz.wav` | two low dull square pulses at D3 | 0.20 s | −12.6 | 1.1 kHz | B is gentler, A is unmistakable. **Lead's ear** |
| | `ui_deny_b_thunk.wav` | a dull falling thud, then a softer lower one | 0.20 s | −19.5 | 2.2 kHz | |

RMS is in dBFS over the audible span (to −40 dB below peak). For reference, the shipped
`ui_purchase` reads 240 ms, −16.2 RMS and 290 Hz; `ui_upgrade` reads 240 ms, −17.8 and 4.8 kHz.

\* The minor tick's centroid is high because of its 6 ms air transient; its body is an 880 Hz knock.

**Known weak points, to listen for:**

- Both stingers run through `gen_audio`'s `tail()`, a noise-convolution "room". The
  spectrogram shows it as broadband haze over the first 0.6 s. If it reads as hiss rather than
  room, the fix is `tail(x, 0.1, …)`.
- `defeat_b`'s static is deliberately loud, then cut. It may be too literal.
- `ui_deny_a` has the highest RMS of the set. At the proposed gain 0.30 it peaks at about
  −17 dBFS as heard, and it should be judged in a firefight, not alone.

---

## 5. F2: voice

### 5.1 The voice-director rules

What ships is good, and is kept. The proposals close the gaps the audit found.

**Priority.** One ladder for every line, highest first. Today `VOICE_RANK` is
`announce 4 > order 3 > kdf_death 2 > enemy_death 1`, and all announcements are equal. The
proposal splits `announce` by the manifest's own `priority` and adds the outcome line:

| Rank | Line | Why |
|---|---|---|
| 7 | outcome (Shai, victory/defeat, §5.4) | nothing outranks the verdict |
| 6 | announcement, `high`: objective new/complete/failed, deadline | mission state |
| 5 | order bark (the gesture just made) | feedback is never late (N4) |
| 4 | announcement, `normal`: wave, reinforcements | |
| 3 | KDF death call | |
| 2 | announcement, `low`: unit lost | its count is also in the feed |
| 1 | enemy death (seen, ≤ 18 tiles, N7) | |

**Interruption:**

- **An order cuts an order** (N4, shipped). A new gesture's line cuts the last order line with a
  40 ms fade.
- **A higher rank may cut a lower one only when the cap is full.** This is shipped (N5, the cap
  is 2, and the loser is dropped, not queued). The proposed rule ON TOP: **nothing cuts an
  announcement or the outcome line once it is 300 ms in**, because half an objective call is
  worse than none.
- **The outcome cuts everything.** `stopVoices()`, the stinger, then the outcome line once the
  stinger's head has played (0.6 s), never over it.
- **Pause stops all voices** (`stopVoices()`). A paused line describes a moment that has frozen.

**Repetition:**

- **Same gesture**: line → ack → silence inside 4 s (N2, shipped). **Same class**: ack within
  1.5 s (N3, shipped).
- **Proposed: a shuffle bag per key.** Today a take is picked by `rand()`, so with two takes the
  same one plays twice in a row half the time. Rule: never the same take twice running; cycle
  every take before any repeats.
- **Announcements**: the per-event `cooldown_s` (shipped: wave 20 s, reinforcements 8 s, unit
  lost 6 s) stays. Proposed addition: **unit-lost calls coalesce over 2 s** rather than a single
  tick, so a salvo that kills across three ticks is one call.

**Intentional silence.** Silence is a rule, not a gap:

- Nothing speaks on select, group, overlay or support, nor on an abduction (`removed` is not a
  death). Civilians never speak (D10). All of this is shipped.
- An enemy speaks only when seen (N7, shipped).
- **Proposed:**
  - No bark for the first 2 s of a mission, while the start cue and the title card own the
    moment.
  - Nothing at or below rank 3 for 1.5 s after a major alert.
  - No barks at all after the outcome.
  - The 4 s after the outcome line is silence plus the outcome bed, before the debrief's own
    sounds.

**Radio and captions:**

- Every unplaced line goes through the walkie-talkie chain (N13, N17 to N20, shipped, default
  on).
- **Proposed: announcements and the outcome line always caption, whatever the D8 toggle says.**
  They are mission information, and a Hebrew line nobody understands is noise. Barks follow the
  toggle. Whether that toggle defaults on is PA-23's own decision.

### 5.2 Which of the 36 missing keys can actually be heard

`allLineKeys` declares the same 20 keys per language. The player only ever commands side 0
(KDF), and enemy order lines (D7) are not built. So of the 36 empty keys, only these are
reachable today:

- all **16 Hebrew** keys;
- **4 Arabic death keys** (`ar.{infantry,crew,engineer,air}.death`, voiced when seen, N7).

That is **20 keys that would make sound the day they are recorded**. Of the other 16 Arabic keys:

- `ar.{infantry,crew,air}.{move,attack}` and `ar.engineer.move` become reachable with D7 (enemy
  order lines on `commit`/`withdraw_to`).
- The 8 `ar.common.*` keys and `ar.engineer.task` stay unreachable even then, unless an enemy
  verb vocabulary is added.

Recording order follows: **Hebrew 16, then Arabic deaths 4**, then the D7 set.

### 5.3 The 36 lines (text only)

The rule from the unit-voices spec §4 and GDD §2 binds every line:

- Doctrine, never a people. Both sides are trained soldiers on a net: the same verbs, the same
  restraint.
- No religious phrase, slogan, taunt, real call sign, real unit name, proword or regional
  dialect. Arabic is in a standard, MSA-leaning register.
- A death call is a radio call, never a scream.
- **Every line is a draft until a native speaker reviews it (D4).**

Lines come from the approved sheet in the unit-voices spec §4.1/§4.2 (one per key, the
radio-register pick; the sheet's other two lines per key are the next takes). The two `pinned`
lines come from the GH-262 spec. Length targets: an order or ack 0.4 to 1.4 s, a death call
≤ 1.8 s (N9).

**Hebrew (KDF), 16 keys. All reachable.**

| Key | Line | Transliteration | Meaning (caption `en`) |
|---|---|---|---|
| `he.crew.move` | נהג, סע | *nahag, sa* | "Driver, go." |
| `he.crew.attack` | מטרה מזוהה, אש | *matara mezuha, esh* | "Target identified, fire." |
| `he.crew.death` | הכלי נפגע | *ha-kli nifga* | "Vehicle hit." |
| `he.engineer.move` | חבלנים בתנועה | *khablanim bi-tnu'a* | "Sappers moving." |
| `he.engineer.task` | מתחילים הריסה | *matchilim harisa* | "Starting demolition." |
| `he.engineer.death` | החבלנים נפגעו | *ha-khablanim nifge'u* | "Sappers hit." |
| `he.air.move` | בדרך לגזרה | *ba-derekh la-gizra* | "En route to the sector." |
| `he.air.attack` | יש לי זיהוי | *yesh li zihui* | "I have identification." |
| `he.air.death` | איבדנו תמונה | *ibadnu tmuna* | "We've lost the picture." |
| `he.common.garrison` | נכנסים למבנה | *nikhnasim la-mivne* | "Entering the building." |
| `he.common.smoke` | זורקים עשן | *zorkim ashan* | "Popping smoke." |
| `he.common.mount` | עולים לכלי | *olim la-kli* | "Mounting up." |
| `he.common.dismount` | רמפה, יורדים | *rampa, yordim* | "Ramp down, out." |
| `he.common.halt` | עוצרים | *otzrim* | "Halting." |
| `he.common.charge` | מניחים מטען בפיר | *manichim mit'an ba-pir* | "Charge into the shaft." (the tunnel charge, `chargeTunnel`) |
| `he.common.pinned` | לא יכול לזוז, תחת אש | *lo yakhol lazuz, takhat esh* | "Can't move, under fire!" |

**Arabic (Ashwar, Sarim, Rif), 20 keys. Reachability in the last column.**

| Key | Line | Transliteration | Meaning | Reachable |
|---|---|---|---|---|
| `ar.infantry.death` | أُصبنا | *usibna* | "We're hit." | **yes** (N7) |
| `ar.crew.death` | أُصيبت العربة | *usibat al-'araba* | "Vehicle hit." | **yes** |
| `ar.engineer.death` | أُصيب فريق العمل | *usiba fariq al-'amal* | "Work team hit." | **yes** |
| `ar.air.death` | فقدنا الصورة | *faqadna as-sura* | "We've lost the picture." | **yes** |
| `ar.infantry.move` | نتحرك | *nataharrak* | "Moving." | D7 |
| `ar.infantry.attack` | اشتباك | *ishtibak* | "Engaging." | D7 |
| `ar.crew.move` | السائق، تقدّم | *as-sa'iq, taqaddam* | "Driver, forward." | D7 |
| `ar.crew.attack` | الهدف أمامنا، نار | *al-hadaf amamana, nar* | "Target ahead, fire." | D7 |
| `ar.engineer.move` | فريق العمل يتحرك | *fariq al-'amal yataharrak* | "Work team moving." | D7 |
| `ar.air.move` | في الطريق إلى القطاع | *fi at-tariq ila al-qita'* | "En route to the sector." | D7 |
| `ar.air.attack` | الهدف مرصود | *al-hadaf marsud* | "Target observed." | D7 |
| `ar.engineer.task` | نبدأ العمل | *nabda' al-'amal* | "Starting work." | no (needs an enemy task order) |
| `ar.common.ack` | عُلم | *'ulim* | "Understood." | no |
| `ar.common.garrison` | ندخل المبنى | *nadkhul al-mabna* | "Entering the building." | no |
| `ar.common.smoke` | نطلق الدخان | *nutliq ad-dukhan* | "Laying smoke." | no |
| `ar.common.mount` | اصعدوا | *is'adu* | "Mount up." | no |
| `ar.common.dismount` | انزلوا | *inzilu* | "Dismount." | no |
| `ar.common.halt` | نتوقف | *natawaqqaf* | "Halting." | no |
| `ar.common.charge` | نزرع الشحنة | *nazra' ash-shihna* | "Setting the charge." | no |
| `ar.common.pinned` | لا أستطيع التحرك، تحت النار | *la astati' at-taharruk, taht an-nar* | "Can't move, under fire!" | no (the pinned call answers a player order) |

The two sheets mirror each other line for line, down to "we've lost the picture" on both sides.
That symmetry is the point (GDD §2).

**One correction to carry into the manifest.** Of the 4 shipped takes, `he.common.ack` is
*od ktana alecha*, which the lead glossed as "one more small one on you". Its own `en` field says
it is "possibly not a military call". The sheet's `ack` lines are קיבלתי (*kibalti*, "copy"),
ברור (*barur*, "clear") and בסדר (*beseder*, "okay"). Re-record `ack` as *kibalti* in the same
session. The 3 other shipped takes are untranscribed (ASSET_PROVENANCE §Unit voices) and need
the same ear.

### 5.4 The announcer: the two voices (GDD §11)

The HUD's voices are **Shai Hammai**, the orders voice (decisions, costs, restraint), and
**Idit Zohar**, the intel voice (what is known, how well, what knowing more costs; she never
gives an order). The `eva` channel's speaker is "the brigade net". The proposal: the net speaks
in their two voices, split by the same rule as the briefing two-hander. Shai speaks for the plan
and its outcome. Idit speaks for what is known and when.

Rules for these lines:

- A spoken line cannot carry `{label}`, because the objective's text is authored per mission
  and per locale. So the voice says the generic line and the **caption and feed carry the
  label**, exactly as the `announce.*` keys do now.
- In Hebrew, per GDD §2 (KDF speak Hebrew), with the caption always on (§5.1).
- Through the radio chain like every unplaced line.

| Event (manifest key) | Speaker | Line | Transliteration | Caption (existing key) |
|---|---|---|---|---|
| mission start (new) | Shai | הפלוגה, אחריי. יוצאים. | *ha-pluga, acharai. yotz'im.* | "Company, on me. Moving out." (new key) |
| `objective_active` | Shai | משימה חדשה. תבדקו את המפה. | *mesima chadasha. tivdeku et ha-mapa.* | `announce.objective.active` "New tasking. {label}" |
| `objective_complete` | Shai | המשימה בוצעה. | *ha-mesima butz'a.* | `announce.objective.complete` |
| `objective_failed` | Shai | את זה הפסדנו. מחזיקים במה שיש. | *et ze hifsadnu. machzikim be-ma she-yesh.* | `announce.objective.failed` |
| `deadline` | Idit | דקה על השעון. | *daka al ha-sha'on.* | `announce.deadline` "One minute. {label}" |
| `wave` | Idit | מגע חדש, עוד כוחות בדרך. המספרים לא ברורים. | *maga chadash, od kochot ba-derekh. ha-misparim lo brurim.* | `announce.wave` |
| `reinforcements` | Shai | תגבורת בשטח. | *tigboret ba-shetach.* | `announce.reinforcements` |
| `unit_lost` | the net (Idit's read) | אבד הקשר. | *avad ha-kesher.* | `announce.unitLost` "Contact lost with {n}…" |
| ROE penalty (D-A9, new) | Shai | זהירות באש. | *zehirut ba-esh.* | "Check your fire." (new key) |
| victory (new) | Shai | השטח בידינו. מחזירים את כולם הביתה. | *ha-shetach be-yadeinu. machzirim et kulam ha-bayta.* | "The ground is ours. Bring everyone home." |
| defeat (new) | Shai | נסוגים. עוד נחזור לכאן. | *nesogim. od nachzor le-khan.* | "Pull back. We'll be back." |
| defeat, alternate (new) | Idit | איבדנו את התמונה. תוציא אותם. | *ibadnu et ha-tmuna. totzi otam.* | "We've lost the picture. Get them out." (breaks her never-an-order rule once, on purpose: the lead decides) |

That is **12 announcer lines × 2 takes**, beside the 36 barks: ≈ 48 lines, ≈ 96 files. Shai's
voice is one actor. Idit's is one actor, and **must not be the Arabic actor's voice** (§5.5).
Victory and defeat lines are "never says revenge" lines: Shai's motive is never said aloud
(`docs/campaign/README.md`).

### 5.5 Voice sourcing, and what each route means for the licence

Three routes. The bar is the same for all of them: `CONTRIBUTING.md` applies to audio "exactly
as it does to art". The file must carry explicit rights to **commercial use** and to
**redistribution in a source-available repository**, and its `source` must name the record
(D9, `LicenseRef-owned`). Code is PolyForm Noncommercial; art and data are all rights reserved;
the files live in a repository others can read. A licence that permits "use in your game" but
not "redistribution of the source file" fails here. That is the trap.

**A. ElevenLabs** (the route the 4 shipped takes used). **Needs the lead's D5 answer.**

- *What has to be true:* a paid plan whose terms grant commercial use of the output, and do not
  restrict redistributing the generated files or sublicensing them to players and stores. That
  must hold on **every generation date**.
- *Free tiers* have historically been non-commercial with attribution. That would disqualify the
  4 shipped takes outright. This plan does not rely on memory of the terms. **D5 needs the plan
  name, the dates of generation, and the terms as read on those dates.**
- *Voice choice:* a library voice can carry its creator's own terms. A cloned voice needs the
  speaker's written consent (unit-voices spec §5). Hebrew and Arabic quality must be checked by
  a native ear, line by line.
- *Cost:* the plan's subscription, plus regeneration of any line that fails review.
- *If D5 comes back no:* delete the 4 shipped variants (an empty `variants` list plays nothing)
  and take B or C. ASSET_PROVENANCE item 2 already records exactly that.
- *Disclosure:* AI-generated speech goes in the PR, in each variant's `generator` field, and in
  the credits' AI disclosure. Provenance item 10 already says that disclosure omits the voices.

**B. Our own TTS, self-run.** No account, no API, a model run locally. The licence question moves
from a vendor's terms to the **model's and its training data's** licence:

- **Excluded for licence:** Coqui XTTS-v2 (Coqui Public Model Licence, non-commercial), Meta
  MMS-TTS (CC-BY-NC), and macOS `say` voices (Apple's licence restricts system-voice output to
  personal, non-commercial use). All three are fine for a dev placeholder. None can ship.
- **Possible, each to verify:**
  - Piper (MIT engine, but **each voice has its own licence**, inherited from its dataset). An
    Arabic voice exists; Hebrew coverage is thin.
  - Community Hebrew models: each needs its model AND dataset licence read.
  - Cloud neural TTS (Azure, Google), whose service terms generally let a customer use the
    output in a product. Redistributing the files in a public repository, and any per-voice
    restriction, must be read.
- *Strength:* the radio chain (band-pass, crunch, AGC, static) hides most synthetic artefacts.
  A flat TTS read is far more acceptable on a walkie-talkie than in a cutscene.
- *Weakness:* Hebrew prosody, and a "foreign" read that becomes caricature (spec §5). The
  native-review gate (D4) applies all the same.
- *Cost:* zero cash, ≈ 1 to 2 days to stand up `voice_prep.py`-compatible output and review.

**C. Real voice actors.** The recommended route for shipping, and the spec's D4 default.

- *Who:* one native Hebrew speaker (or **the lead himself** for Hebrew, the spec's route 1: he
  owns the output; ≈ 30 min for 45 lines × 2 takes) and one native Arabic speaker. Plus the
  announcer: Shai, Idit, or one actor reading both if the lead accepts that.
- *Paper:* a written release that **assigns the rights, or grants an exclusive perpetual
  licence**, for a commercial game whose repository is readable by others. It must cover
  sublicensing to stores and players. It is the same grant the CLA takes for code, and it is
  recorded as the variant's `source` (D9).
- *Cost:* non-union indie rates for this volume (≈ 50 short lines per voice) are typically a few
  hundred US dollars per actor per session. This is a planning order of magnitude, not a quote;
  get quotes.
- *Strength:* the best read, no licence ambiguity, and the native speaker doubles as the D4
  reviewer.

**Recommendation:**

1. **The lead records the Hebrew barks** now. That is the cheapest, cleanest, and it is spec
   route 1.
2. **Commission one Arabic actor** for the 4 reachable death lines, plus the 7 D7 lines if D7
   is approved.
3. **Commission the announcer lines** (Shai, Idit) once §5.4 is approved.
4. **Use ElevenLabs only if D5 returns a written yes**, and keep the 4 shipped takes out of any
   commercial build until then. That last rule is already the provenance record's instruction.

---

## 6. Music

### 6.1 The transitions the game needs

Today one track loops everywhere. Five states, with the transitions between them:

| State | Where | Wants | Volume as heard |
|---|---|---|---|
| **Menu** | `/`, campaign board, brigade, garage, settings | the theme's identity: intro and melody | −22 LUFS |
| **Briefing** | the deploy screen | sparse, under the beats and the video: drone, ney, radio | −26 LUFS; ducked under briefing video audio |
| **Battle, calm** | the mission, no contact | low pulse, tension without drive | −28 LUFS |
| **Battle, tension** | the mission, contact | the theme's driving section: percussion and bass | −26 LUFS |
| **Victory** | after the stinger, under the outcome moment and debrief | the theme's resolve, short, then menu | −24 LUFS |
| **Defeat** | after the stinger, under the debrief | the theme's pull-back: cello and oud alone | −26 LUFS |

| Transition | How | Length |
|---|---|---|
| menu → briefing | crossfade | 2 s |
| briefing → battle (deploy, title card) | the start cue (§3 #8) masks a crossfade | 2 s |
| calm ↔ tension | crossfade on an **intensity** reading with hysteresis: tension when ≥ 6 player-side `fire`/`impact` events in 5 s, calm after 12 s below 2. Read from the events the mixer already receives, on presentation wall-clock: no sim influence (invariant 4) | 3 s up, 6 s down |
| battle → victory / defeat | music fades out 600 ms → stinger (§4) → outcome bed | per §2.2 |
| outcome → menu | when the debrief closes | 2 s |
| pause | −6 dB (§2.2); no change of state | 300 ms |

Mechanics: two `<audio>` elements for the crossfade (streaming, as now; never decoded whole).
The duck already steps the element's volume on a 20 ms timer (`MUSIC_DUCK_STEP_MS`), so a
crossfade is the same mechanism with two targets. The saved-position behaviour (`lions.music`)
stays for the menu state only.

### 6.2 Music sourcing, and what each route means for the licence

| Route | What it gives | Licence implication |
|---|---|---|
| **1. Re-cut the existing theme** | the theme prompt already built it in sections: a 6 s intro and a sparse 0:00 to 0:20 (briefing bed), the main melody at 0:45 (menu), the heavier 1:30 (tension), the pull-back at 2:15 (defeat bed). That covers 4 of 6 states for no new asset | **inherits provenance item 3** (the generator and its terms are unrecorded) and adds nothing new. The cheapest step, but it does not close item 3 |
| **2. Commission a composer** | adaptive stems (calm, tension, victory, defeat) in the theme's key and tempo, mixed to the targets in §6.1, true peak ≤ −1 dBTP | work-for-hire or a full buyout, covering redistribution in the repository and stems. Clean. The cost depends on minutes and stems; get quotes |
| **3. AI music generator** (the main theme's own route) | fast iteration on the existing prompt | **depends on the plan in force on the generation date**: paid plans typically grant commercial use of outputs and free plans typically do not. Separately, purely AI-generated music may carry no copyright at all, which makes a `CC-BY-4.0` grant of it hollow. The lead's call, with item 3 answered first |
| **4. Stock or royalty-free libraries** | quick, broad | most licences permit **use in a game but not redistribution of the source file**, so they fail the repository test. Usable only if the licence says otherwise in writing |
| **5. CC0 / CC-BY catalogues** | allowed by `validate_audio.py` today (CC-BY needs a `credit`) | clean; the risk is fit, since the theme's palette (oud, ney, darbuka, low brass) is specific |

**Recommendation:**

1. Answer provenance item 3 first.
2. If its terms are good, take **route 1 now**: re-cut the theme into 4 beds. That closes the
   "one track everywhere" finding for no new licence.
3. Then route 2 or 3 for a true calm/tension pair and a victory bed.
4. Generate nothing until the lead picks.
5. The next music file of any route ships with a true peak ≤ −1 dBTP. The current theme reads
   +0.2.

---

## 7. Ambience (the missing F1 layer)

There is no ambience bed, so a quiet battlefield is digitally silent between shots. The proposal
is one loop per map **theme**, never per map: desert, green highland, and town, after
`terrain-themes.ts`. Each is 30 to 60 s, a seamless loop, mono or narrow stereo, at −34 LUFS, on
the new `amb` bus. It is muted with everything else.

| Route | Licence |
|---|---|
| **Synthesise with `gen_audio.py`**: wind as low-passed noise under a slow (0.05 to 0.2 Hz) gain wander; a distant-town bed as band-limited noise with sparse filtered events; insects for green maps as amplitude-modulated narrow-band noise | **CC0, no question.** Same route as §4 |
| CC0 field recordings | CC0 only; CC-BY works with a credit; anything "royalty-free" fails the repository test (§6.2) |

Recommendation: the synthesised route first. It is the same pipeline and carries no licence
risk. No candidate was generated here, because ambience was not in this step's brief.

---

## 8. Work packages

Each package lands as its own PR with its gates. Every new check arrives with a falsification:
an input that makes it fail, run, in the commit message (CLAUDE.md, "every check gets an input
that makes it fail").

| ID | Package | Scope | Acceptance checks | Needs |
|---|---|---|---|---|
| **AU-1** | **Cue map and coverage test** | a `cues` table in `data/audio.json`: every critical game event → a set name, or an explicit `silent` with a reason. Events: `MissionEvent` kind × objective status, the alert tiers, outcome victory/defeat, mission start, ui confirm/deny, kit fitted. The app reads cues from the map, never a hard-coded set name | (1) `cue-coverage.test.ts`: every key of a **typed exhaustive record** over `MissionEvent['kind']`, `ObjectiveStatus` and the alert tiers is present, so a new event kind is a `tsc` error, not a silent gap. (2) Every mapped set exists in `sets` and has ≥ 1 variant **or** is on a named synth-allowed list. (3) No two of objective complete/failed/new map to the same set. **Falsify:** delete one mapping → red; point `failed` at `complete`'s set → red; add a dummy `MissionEvent` kind → `tsc` red | — |
| **AU-2** | **Land the chosen cues** | the lead's picks into `gen_audio.py` (`UI_SETS`, plus a new `STINGER_SETS` with its own length ceiling); `data/audio.json` sets with the §2.3 gains; ASSET_PROVENANCE rows (CC0, `gen_audio.py`) | `pnpm validate:audio` green; `gen_audio.py --only=<new sets>` leaves every existing file byte-identical (`git status`); every new file ≤ −6 dBFS and under its ceiling (asserted in `gen_audio.py`). **Falsify:** set a stinger to 3 s → the assertion trips | §9 A1 |
| **AU-3** | **Wire the cues** | `alerts.ts` grows the tier (minor/important/major) and the objective status → cue; vehicle and named-veteran losses → major; deadline → important; `outcomeMoment` plays victory/defeat; the title card plays mission start; a refused order plays deny; primary buttons play confirm (via one helper, not per screen) | unit tests on `alertsForTick`: a vehicle loss → `major`, an infantry loss → `important`, under fire → `minor`, complete ≠ failed ≠ active cue. **Falsify:** map every status to one cue → red. `pnpm ui:routes` stays green (no console error, no leaked listener) | AU-1 |
| **AU-4** | **Mix and buses** | `cue` and `amb` buses with duck stages under their gains; the §2.2 rows as pure functions beside `duckRamp`; battle music gain 0.26 / menu 0.4; outcome fade; pause behaviour | pure tests for each row (attack, release, depth). **A rendered mix check**, like `pnpm radio:clips`: an `OfflineAudioContext` render of a scripted 5 s firefight with a bark and an objective cue, with ffmpeg measuring that the bark is ≥ 6 LU over SFX+music during the line and the cue is never ducked by the voice. **Falsify:** route the cue through `sfx` → the measured cue level drops 4 dB → red | AU-2 |
| **AU-5** | **Voice director v2** | the §5.1 rank ladder (announce split by priority, outcome rank), the 300 ms no-cut floor, a shuffle bag per key, unit-lost coalescing over 2 s, the mission-start and post-major silences, announcement captions always on | pure tests on `admitVoice` and the announcer: the new ranks, the no-cut floor, a shuffle bag never repeating a take back to back over 1,000 draws. **Falsify:** revert to `rand()` → a back-to-back repeat appears → red | — |
| **AU-6** | **Voice assets** | the 16 Hebrew + 4 Arabic reachable lines first, then the 12 announcer lines (§5.4), then D7; 2 takes each; `voice_prep.py`; `text`/`translit`/`en` from §5.3; re-record `he.common.ack` | `pnpm validate:audio`: N9 duration, N10 loudness, D9 licence and source naming the release; the native reviewer's sign-off recorded in the PR; every recorded key reachable or explicitly marked D7 | **D4, D5, D9**; §9 A3 |
| **AU-7** | **Music states** | a two-element crossfader; the §6.1 state machine (menu/briefing/calm/tension/victory/defeat); the intensity reading on presentation time; beds from route 1 or the chosen route | pure tests for the state machine and the hysteresis (no flapping over a 0.5 s burst); `ui:routes` green; a stream never decoded whole (`validate_audio` 8 MB). **Falsify:** remove the hysteresis → a scripted burst flaps → red | §9 A6 |
| **AU-8** | **Ambience beds** | 3 synthesised CC0 loops (§7) on the `amb` bus | loop seam: the last and first 50 ms correlate ≥ 0.9 (measured); loudness −34 ± 2 LUFS; `validate:audio` green | AU-4 |
| **AU-9** | **Captions default** | PA-23's ruling applied; announcements always captioned (AU-5) | a settings test for the default; a pseudo-locale capture shows the caption | D8 / PA-23 |
| **AU-10** | **Provenance and credits** | ASSET_PROVENANCE rows for every new file; the credits' AI disclosure names voices and music (item 10); the 4 ElevenLabs takes removed or confirmed per D5 | the provenance checker green; the credits test updated | D5, item 3 |

**Order:** AU-1 → AU-2 → AU-3 → AU-4 close the cue half of PA-02 with no licence. AU-5 runs in
parallel. AU-6, AU-7 and AU-10 wait on the lead's licence answers. AU-8 and AU-9 can slot in
anywhere after AU-4.

---

## 9. Decisions for the lead

| # | Question | Recommended |
|---|---|---|
| A1 | The pick per cue, by ear (§4) | victory **A**, defeat **A**, objective complete **A**, failed **A**, new **A**, alert minor **A**, important **A**, major **A**, mission start **A**, confirm **A**, deny: the lead's ear (A is unmistakable, B is gentler). Kit fitted stays with K10 (#418) |
| A2 | The alert tiers and what lands in each (§3) | as the table: vehicle, aircraft or named veteran lost = major; foot unit lost, deadline, wave, abduction, ambush = important; under fire and pinned = minor |
| A3 | Voice route | the lead records the Hebrew barks; one native Arabic actor; announcer actors after §5.4 is approved; ElevenLabs only on a written D5 yes |
| A4 | Announcer language and speakers | Hebrew, in Shai's and Idit's voices per GDD §11, through the radio chain, with the caption and feed carrying the meaning |
| A5 | Announcements and outcome lines caption regardless of the D8 toggle | yes |
| A6 | Music | answer provenance item 3, then re-cut the existing theme into four beds (route 1); commission or generate a calm/tension pair after |
| A7 | The 4 shipped ElevenLabs takes | unchanged rule: out of any commercial build until D5; re-record `ack` as *kibalti* in the Hebrew session regardless |
| A8 | UI confirm scope | primary actions only (Deploy, Buy, Save, Apply, Continue), never hover, tab or checkbox |
| A9 | A Conduct (ROE penalty) cue and line | yes: important tier, plus Shai's "זהירות באש" ("Check your fire"). It is the game's distinguishing mechanic, and today it is silent |
| A10 | Battle music down to gain 0.26 (−26 LUFS as heard), menu stays 0.4 | yes; measured in §1, a bark sits only ≈ 1.6 LU over the music before the duck |
| A11 | Ambience: synthesised CC0 beds | yes, three themes |
| A12 | The Idit defeat alternate, which breaks her "never gives an order" rule once | no: keep Shai's line; the rule is worth more than the beat |
