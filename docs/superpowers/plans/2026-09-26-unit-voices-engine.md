# Unit Voices, the Engine (WP-AU1, #245, Lane A): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit answers the player when it gets an order and calls out when it dies. The engine speaks for the **gesture**, never per unit: one line per right-click, key or button, whatever the unit or intent count. The line is ranked by the cursor's own `winningVerb`, so it says what the cursor promised. KDF speaks Hebrew and the three enemy doctrines speak Arabic, picked by the unit's `faction` through data. A quick repeat is answered with an acknowledgement and then with silence. Two voices play at most, with orders on top. A voice ducks the battle and the music, and it sounds like the net. A **Voices** slider sits beside Effects, and captions show the line's English meaning when the player turns them on. The engine ships **with no voice assets at all**: a line that is not recorded plays nothing, and in dev it says so once, as information.

**Architecture:** App side (`packages/app/src/voice/`), the repository's pattern holds: **pure model code with its own `*.test.ts`, under a thin wiring layer.**
- `voice/lines.ts`: the vocabulary. Voice class by role and override, language by faction, the one key grammar, and the roster's languages.
- `voice/director.ts`: the decisions. `decideOrder` (N1–N3) and `decideDeaths` (N6, N7). State in, state and a `VoiceCue` out. It has no clock of its own, no DOM and no audio.
- `voice/voice-runtime.ts`: the glue. It coalesces a gesture's intents, calls the director, plays, captions, logs once in dev, and keeps the read-back ring `__lions.voiceLog()` reads.
- `ui/voice-caption.ts`: the caption slot (D8).

Render side, in `packages/render/src/audio.ts` only (the mixer the brief names):
- a `voice` bus under master beside `sfx`, and a duck stage on `sfx`;
- a radio band (N13), and `playVoice` with admission (N4, N5) and ducking (N12);
- roster-only decoding under a 16 MB cap (N16), and the dev-only placeholder tick.

`main.ts` wires the two halves. The sim is not touched.

**Tech Stack:** TypeScript strict, vitest (node for pure modules, jsdom for DOM and the mixer), Vite, Playwright (tools only), Python 3 (the audio gate). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-unit-voices-design.md` (WP-AU1, #245), merged 25 Sep in PR #246. It is binding. The lead's answers recorded on #246 on 25 Sep:
- **D2:** Arabic lines are military acknowledgements only. Neither side says a religious exclamation, which is the spec's default.
- **D5:** the seven samples are ElevenLabs output. They enter the repository only once the plan used is confirmed to grant a commercial licence to the output. Until then they are a tone reference and stay uncommitted.
- **Everything else** takes the spec's recommended default. D1 is therefore **yes**, and Task 13 applies its GDD text.

This plan builds:
- §2's order and death triggers;
- §3's language and voice class;
- §6's manifest shape and the licence-and-shape half of its gate;
- §7 whole;
- D8's captions;
- N1–N7, N11–N13 and N16.

It does **not** build the lines themselves (§4), the recording or TTS routes (§6), `tools/voice_prep.py`, the measured checks N9, N10 and N14, or D7's enemy-order lines. Those belong to the asset plan and to phase 2. See Out of scope.

**Status and entry.** This plan runs on `feat/unit-voices-engine`, cut from `main` at `165eb966` or later, in `/Users/ilpinto/dev/roaring-lions-ep/au1-engine`. `main` at `165eb966` carries the merged spec. Task 0 re-checks `main` before Task 1. No numbers wait on approval: N1–N16 were approved with the spec's defaults.

## Global Constraints

These are binding on every task. They come from the spec, CLAUDE.md and the brief.

- **Lane A.** Write only under `packages/app/**`, with these named exceptions, each confined to its task:
  - `packages/render/src/audio.ts`, `audio.test.ts` and `index.ts`: the mixer (Tasks 4 and 5, R-1).
  - `data/schemas/unit.schema.json`, `data/units/enemy/{manpad_team,rocket_battery,paramotor}.json` and `packages/data/src/index.test.ts` (Task 1, R-1).
  - `data/audio.json`, `tools/validate_audio.py`, `tools/test_validate_audio_voices.py` and `package.json` (Task 3, R-1).
  - `tools/src/ui-review/routes-check.ts` (Task 12).
  - `docs/**` and `CONTRIBUTING.md` (Task 13).

  **No `packages/sim/**`, no `packages/render/src/three/**`, no `ThreeRenderer.ts`, no art.** `git diff --stat 165eb966..HEAD -- packages/sim packages/render/src/three` is EMPTY at every commit.
- **The sim is untouched (invariant 4).**
  - The director reads sim state and events through read-only lookups (`DirectorLook`). It never queues a command and never writes sim state.
  - A variant is drawn by the mixer's presentation PRNG, never the sim's.
  - The throttles run on the wall clock (R-17), never the tick.

  The determinism hash, `balance` and `playtest` cannot move. Task 11 still runs `pnpm test:determinism` as the canary.
- **No voice assets.** Every task is green with every `voices.lines` entry empty. The seven samples in `.superpowers/voices-samples/` stay git-ignored and unread by any task (D5).
- **A missing line is not an error (R-9).** The engine plays nothing and reports status `missing`. The runtime `console.info`s it once per key per document, in dev builds only. A missing line never reaches `console.warn` or `console.error`, and no message calls it an error or a failure.
- **The brigade account is read only through `LedgerStore`.** Nothing in this plan reads or writes the account. The one new persisted state is two settings fields, and they go through `settings.ts`'s own store (`saveSettings`). No task names a storage key.
- **Colour only from semantic tokens.** Task 10's caption uses `--ink` and the existing `.rl-plate`. Nothing outside `theme.css` names an `--rl-*` variable. There are no hex, `rgb()` or `rgba()` literals in UI source. Every new length is a `rem`, or a `px` under 4. **Never write a glob such as `**/*.ts` inside a CSS comment**: the `*/` closes the comment early.
- **Text only through `t()` and `en.json`.**
  - Task 6 adds every catalogue key the plan needs, and no later task adds one.
  - A caption's *content* is manifest data (the line's `en`), not chrome (R-18).
  - `sandbox-help.ts`'s blurbs are console text by that file's own exemption.
- **Pure logic goes into pure, exported, tested functions.** DOM and mixer tests open with `// @vitest-environment jsdom`. There is no `any`, and **no non-null assertion in new code, tests included**: narrow, or throw a named error in a fixture helper. Any storage read takes an injected store: `window.localStorage` is a bare `{}` on local Node 25 and a real `Storage` on CI's Node 22.
- **Every check has an input that makes it fail, and that input has been run.** Each task's last step names its mutations. Each is applied, seen red, and undone **by reverting the edit**, never with `git checkout -- <file>`. The commit body says what was seen red.
- **Tools run on ports 5193–5194 and 5197–5199 only**, always with an explicit `--port`. The other lane holds 5195–5196, and 5177 is the lead's. `claimPort` refuses a busy port with exit 2; pick the next free one in this lane's set. **Never kill a process you did not start. Never `pkill`**; a server you started is stopped by its own tool. No golden scenario is expected to move, because no gated frame shows a caption (captions are off by default). The local darwin baseline is stale, so CI's `visual` job on the PR is the evidence.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm validate:audio`, plus whatever the task names. Then `git diff --stat 165eb966..HEAD -- packages/sim packages/render/src/three` must be empty.
- **Git hygiene.** Call `/usr/bin/git` by absolute path, one command per call. Stage with `git add <paths>`, then `git commit -s -F <msgfile> -- <paths>`. Never use `-A`, never `git checkout -- <file>`, never amend, and never push from a task. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Size.** Each task touches at most five authored files and about 400 changed lines, tests included.
- **Model tiers.** Sonnet by default. Opus for `main.ts`, lifecycle and the mixer: Tasks 4, 5, 9 and 11, plus the final whole-branch review. Nothing inherits opus by default.

## Rulings taken while planning

Each ruling settles a conflict between the spec, the brief and today's code, and says which way it went.

- **R-1: five paths outside lane A, each named and confined.**
  - The mixer lives in `packages/render/src/audio.ts` (the brief names it). `index.ts` there gains one export line.
  - The unit `voice` field is a schema change plus three one-line overrides (spec §3).
  - The manifest and its gate are `data/audio.json` and `tools/validate_audio.py` (spec §6). `package.json` gains one command in `validate:audio`.
  - The browser legs are `tools/src/ui-review/routes-check.ts` (the brief's item 9).
- **R-2: the music ducks through its `<audio>` element's volume, stepped every 20 ms.** Music is an element, not a node in the graph (`audio.ts` streams it on purpose). Routing it through a `MediaElementAudioSourceNode` would capture the element into a context for good. No context exists before a gesture, so the gesture-free carry-over of the theme from page to page would break. The SFX duck is a real `GainNode` automation.
- **R-3: a gesture is one task, and the pointing site supplies the hostile hint.** The spec says the director "subscribes to `intentListeners` and coalesces a gesture's intents". That holds: intents are buffered and flushed on a microtask, so one right-click's `demolish`, `garrison` and `attackMove` arrive as one gesture. An intent does not carry the cursor's `hostile` hint, though. Every right-click is `attackMove`, and `attack` versus `move` is the hover, not the intent. So each pointing site calls `voice.hint({ hostile })` before it dispatches:
  - the canvas and the armed left-click pass `renderer.hoverEntity >= 0`;
  - the minimap passes `false`, because it has no hover;
  - keys pass nothing, which defaults to `false`.
- **R-4: ranking reuses `winningVerb` literally.** The director calls it with `{ intents, roe: 'free', marker: false }` and `{ hostile, blocked: false }`. `blocked` feeds only `cursorFor`, never `winningVerb`. `winningVerb` has no `move` rung and no `halt` rung, so the director falls back to `order → move`, then `halt → halt`. `idsOf` in `input/cursor.ts` is exported rather than copied. A test pins that, for every pointer gesture, the voice's verb equals `cursorFor`'s name.
- **R-5: the key grammar is `<lang>.<class>.<trigger>`, with `common` as the class for the six shared verbs and `ack`.**
  - Engineers answer `attack` from `infantry` (spec §4).
  - `demolish` always speaks from `engineer.task`.
  - That makes **19 keys per language and 38 in all**, and every one is declared in `data/audio.json` with empty `variants`.
- **R-6: completeness is a vitest and per-variant rules are Python.** The director's vocabulary lives in TypeScript. So `lines.test.ts` pins that the declared keys *equal* `allLineKeys(languages)`, in both directions. `validate_audio.py` checks each key's shape and language, and each variant's licence, source, text fields and path. Neither file holds the other's list.
- **R-7: `LicenseRef-owned` is allowed for voices only (D9 default).** Battle sets stay CC0/CC-BY. ElevenLabs output (D5) can enter only as `LicenseRef-owned`, with a `source` naming the plan and date and a `generator` naming the tool. That happens in the asset plan, after the licence is confirmed. The gate requires `generator`, `text`, `translit` and `en` on every voice variant.
- **R-8: N9, N10 and N14 are the asset plan's.** They are measured checks (duration, loudness and encoded size, all by ffmpeg), and CI's `gates` job has no ffmpeg today. With no files, there is nothing to measure. The engine gate stays at shape and rights. The 512 KB ceiling covers voice files meanwhile.
- **R-9: `missing` covers "not recorded" and "not decoded yet" alike.** Both play nothing. The dev line reads `[voice] <key>: no decoded line (not recorded yet, or still decoding), so nothing plays`. That is information, never a warning.
- **R-10: the placeholder is a dev-only URL parameter, `?voicetick`.** It is not a Free play flag.
  - It sits in `KNOWN_PARAMS`, not `SANDBOX_FLAGS`, so the Free play picker never offers it and an unknown-parameter warning never fires for it.
  - It is read through `voicePlaceholderOn(params, import.meta.env.DEV)`, so a production build ignores it.
  - It plays **one sine oscillator per line class**, at a frequency no other sound here uses (`PLACEHOLDER_HZ`), through the full voice chain: admission, duck and radio band. Its status is `placeholder`, and it has no caption.
  - It exists because otherwise "with voices at 0, nothing plays" could not fail: with no assets, nothing plays either way.
- **R-11: `AudioGains.voice` is optional, and absent reads as 1.** The render package compiles before `Settings` carries the field. `settings.ts` then always writes it.
- **R-12: N3's cooldown is stamped by every line a class speaks**, orders and deaths alike, per `(language, class)`. The ear hears one voice.
- **R-13: N2's window opens at the first gesture of a run and is not extended by repeats.** Otherwise a player clicking every second would never hear a full line again. "Same selection" is the sorted ids of the winning intent.
- **R-14: the radio band is for unplaced lines only.** That means orders and KDF deaths. An enemy death is placed in the world, and it takes `playSet`'s distance lowpass and pan instead. It still goes to the `voice` bus, so the Voices slider governs it.
- **R-15: voice classes the spec's default table does not name.**
  - `eod` → `engineer`. No unit uses the role today, but the schema offers it.
  - `dozer_d9` keeps `engineer` from its role. It answers a demolition with the sapper lines, as the spec's table implies.
- **R-16: `manpad_team` speaks `infantry` by its explicit field.** Its role is `aa`, which defaults to `crew`. #247 tracks the separate sim bug: the role default also gives it `mobility.wheeled = true`. The voice field does not read `wheeled`, so the voice is right whichever way #247 lands, and this plan does not touch it.
- **R-17: the director's clock is the wall clock (`performance.now()`), not sim time.** The throttles ration what the ear gets, and a `__lions.step(1200)` fast-forward is one moment to the ear.
- **R-18: a caption's text is manifest data, not chrome.** It is the variant's `en`, shown verbatim, like a mission briefing. It is not a `t()` key. The caption region's `aria-label` does go through `t()`.
- **R-19: `MAX_VOICES_PER_TICK` becomes `MAX_SOURCES_PER_TICK`** (spec §7). It counts sound sources, and "voice" now means speech.
- **R-20: the plan has 12 code tasks, not the spec's 11 plus assets.**
  - The spec's tasks 3 (`voice_prep.py`) and 12 (assets) go to the asset plan, with 2's measured half (R-8). Its task 10 (D7) is phase 2.
  - The rest splits under the five-file cap: the unit field (Task 1) from the vocabulary (Task 2), the mixer in two (Tasks 4 and 5), and the director in two (Tasks 7 and 8).
  - Docs stand alone (Task 13).

## File structure

| File | Responsibility | Task | Est. lines |
|---|---|---|---|
| `data/schemas/unit.schema.json`, 3 enemy unit JSONs, `packages/data/src/index.test.ts` | optional `voice` field; `manpad_team: infantry`, `rocket_battery: crew`, `paramotor: air` | 1 | 50 |
| `packages/app/src/voice/lines.ts` (+test) | `VoiceClass`, `voiceClassOf`, `languageOf`, key grammar, `allLineKeys`, `rosterLanguages` (2); manifest completeness (3) | 2, 3 | 330 |
| `data/audio.json` | `voices`: `gain`, `languages`, 38 declared-empty lines | 3 | 50 |
| `tools/validate_audio.py`, `tools/test_validate_audio_voices.py`, `package.json` | voice licence, source, text, path and key checks | 3 | 260 |
| `packages/render/src/audio.ts` (+test), `index.ts` | voice types, buses, radio band, decoding, cap (4); `playVoice`, admission, duck, placement, placeholder (5) | 4, 5 | 750 |
| `packages/app/src/settings.ts` (+test), `ui/settings-panel.ts` (+test), `i18n/en.json` | `audio.voice`, `accessibility.captions`, the slider, the toggle, every key | 6 | 150 |
| `packages/app/src/voice/director.ts` (+test), `input/cursor.ts` | `decideOrder` (7); `decideDeaths` (8) | 7, 8 | 650 |
| `packages/app/src/voice/voice-runtime.ts` (+test) | coalescing, play, caption, dev log, read-back ring | 9 | 330 |
| `packages/app/src/ui/voice-caption.ts` (+test), `ui/hud.ts` (+test), `ui/theme.css` | the caption slot | 10 | 190 |
| `packages/app/src/main.ts`, `sandbox-help.ts` (+test) | wiring, `?voicetick`, `__lions.voiceLog()` | 11 | 120 |
| `tools/src/ui-review/routes-check.ts` | the three voice legs | 12 | 170 |
| `docs/GDD.md`, `docs/campaign/storyline.md`, `docs/campaign/README.md`, `CONTRIBUTING.md` | D1 text, the `bark` row, voice provenance | 13 | 40 |

---

### Task 0: Entry, main as it stands, and a baseline

This is not a code task. The coordinator runs it; it needs no model.

- [ ] **Step 1:** Run `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/au1-engine fetch origin`. Then run `/usr/bin/git -C … log --oneline 165eb966..origin/main --` on these paths:
  - `packages/render/src/audio.ts`
  - `packages/app/src/main.ts`, `settings.ts`, `ui/settings-panel.ts`, `ui/hud.ts` and `input/cursor.ts`
  - `data/audio.json`
  - `tools/validate_audio.py`
  - `tools/src/ui-review/routes-check.ts`

  If anything is listed, run `/usr/bin/git merge origin/main` and re-read what moved before Task 1. Every citation here was taken at `165eb966`.
- [ ] **Step 2:** Run `/usr/bin/git worktree list` and `git status --short`. The tree must be clean.
- [ ] **Step 3: Baseline gates.** Record the results in the ledger (`.superpowers/unit-voices/ledger.md`, git-ignored, mirrored to the session scratchpad), so that a later red can be attributed:
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm validate:audio && pnpm test:determinism`.
  - `pnpm ui:routes -- --port=5194`. It must pass as it stands, the garage's AudioContext-count leg included.
- [ ] **Step 4:** Confirm the samples are not tracked, and record the answer: `/usr/bin/git ls-files .superpowers/voices-samples` prints nothing. No task opens them.

---

### Task 1: The unit `voice` field, and the three units whose role voices them wrongly

**Model:** sonnet. A schema field and three one-line data edits (spec §3, R-1, R-16).

**Files:**
- Modify: `data/schemas/unit.schema.json`, `data/units/enemy/manpad_team.json`, `data/units/enemy/rocket_battery.json`, `data/units/enemy/paramotor.json`, `packages/data/src/index.test.ts`

**Interfaces:** an optional unit field `voice: "infantry" | "crew" | "engineer" | "air"`. Nothing in `packages/sim` reads it. Task 2 reads it.

- [ ] **Step 1: Write the failing tests.** Append the following to `packages/data/src/index.test.ts`. It already imports `readFileSync`, `path`, `units` and `DATA_ROOT`.

```ts
describe('the unit voice field (WP-AU1 §3)', () => {
  const declared = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const u of Object.values(units)) {
      // Read through a plain shape: before the field exists no JSON module type
      // declares it, and `'voice' in u` would narrow to `never`.
      const rec = u as { id: string; voice?: unknown };
      if (rec.voice !== undefined) out[rec.id] = rec.voice;
    }
    return out;
  };

  // Role alone is wrong three times (spec §3), the trap `mobility.wheeled`
  // already records: a truck under `artillery`, a foot team under `aa` (#247
  // tracks the same unit's sim bug), a paraglider under `support`. Nothing
  // else may override, or the role default stops being the rule.
  it('is declared by exactly the three units whose role would voice them wrongly', () => {
    expect(declared()).toEqual({ manpad_team: 'infantry', paramotor: 'air', rocket_battery: 'crew' });
  });

  it('the schema offers exactly the four classes, and the field stays optional', () => {
    const schema = JSON.parse(readFileSync(path.join(DATA_ROOT, 'schemas/unit.schema.json'), 'utf8')) as {
      required: string[];
      properties: Record<string, { enum?: string[] } | undefined>;
    };
    expect(schema.properties.voice?.enum).toEqual(['infantry', 'crew', 'engineer', 'air']);
    expect(schema.required).not.toContain('voice');
  });
});
```

- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run packages/data/src/index.test.ts`. The first test reads `{}` and the second reads `undefined`.
- [ ] **Step 3: Implement.** In `unit.schema.json`, add the following after `"role"`:

```json
    "voice": {
      "description": "Which voice pool answers for this unit (WP-AU1 §3). Optional: absent, it follows the role -- infantry, at_team, sniper, support, artillery -> infantry; mbt, ifv, apc, technical, recon, aa -> crew; engineer, eod -> engineer; drone, gunship -> air. Declare it only where the role is wrong, the way `mobility.wheeled` is declared where the role default is wrong. Presentation only: the sim never reads it.",
      "enum": ["infantry", "crew", "engineer", "air"]
    },
```

  Then add one line after `"role"` in each of the three units: `"voice": "infantry",` in `manpad_team.json`, `"voice": "crew",` in `rocket_battery.json`, and `"voice": "air",` in `paramotor.json`.
- [ ] **Step 4: Gates, falsify, commit.** Run the gates line. `pnpm typecheck` matters here: a new JSON field is a new property on a JSON module's type, and `tsc` is the only thing that would see a call site that minds. Each of these must be seen red, then undone:
  - (a) Delete `paramotor`'s field. The first test goes red.
  - (b) Set `manpad_team` to `"voice": "tank"`. `pnpm validate:data` goes red.
  - (c) Add `"voice"` to the schema's `required`. The second test and `pnpm validate:data` go red, the latter on 30 units.

  Commit the five paths with the message `feat(data): a unit may name its voice class; three do (WP-AU1 T1)`. The body names R-16 and #247.

---

### Task 2: The voice vocabulary: class, language and the key grammar

**Model:** sonnet. Pure (spec §3, §4; R-5, R-15).

**Files:**
- Create: `packages/app/src/voice/lines.ts`, `packages/app/src/voice/lines.test.ts`

**Interfaces (Tasks 3, 7, 8 and 11 consume these):**
- `type VoiceClass = 'infantry' | 'crew' | 'engineer' | 'air'`; `const VOICE_CLASSES: readonly VoiceClass[]`
- `type OrderVerb = 'move' | 'attack' | 'demolish' | 'charge' | 'garrison' | 'mount' | 'dismount' | 'smoke' | 'halt'`; `const ORDER_VERBS: readonly OrderVerb[]`
- `const COMMON_VERBS = ['garrison', 'smoke', 'mount', 'dismount', 'halt', 'charge'] as const`
- `type LineTrigger = 'move' | 'attack' | 'death' | 'task' | 'ack' | CommonVerb`
- `function voiceClassOf(u: { readonly id: string; readonly role: string; readonly voice?: unknown }): VoiceClass`
- `function languageOf(faction: string, languages: Readonly<Record<string, string>>): string | null`
- `function orderLineKey(lang: string, speaker: VoiceClass, verb: OrderVerb): string`
- `function deathLineKey(lang: string, cls: VoiceClass): string`; `function ackLineKey(lang: string): string`
- `function lineTriggerOf(verb: OrderVerb): LineTrigger`
- `function allLineKeys(langs: Iterable<string>): string[]`
- `function rosterLanguages(roster: Iterable<string>, factionOf: (unitId: string) => string | undefined, languages: Readonly<Record<string, string>>): string[]`

- [ ] **Step 1: Write the failing tests.** Create `lines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { units } from '@lions/data';
import {
  ORDER_VERBS,
  VOICE_CLASSES,
  ackLineKey,
  allLineKeys,
  deathLineKey,
  languageOf,
  orderLineKey,
  rosterLanguages,
  voiceClassOf,
  type VoiceClass,
} from './lines';

const SCHEMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data/schemas/unit.schema.json');
const LANGS = { kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' };

describe('voiceClassOf (spec §3)', () => {
  // Every shipped unit, written out: a new unit or a role change must be a
  // conscious edit here, not a silent new voice.
  const EXPECTED: Record<string, VoiceClass> = {
    apc_eitan: 'crew', apc_kipod: 'crew', at_team: 'infantry', attack_drone: 'air',
    breach_team: 'infantry', demo_squad: 'engineer', dozer_d9: 'engineer', heli_peten: 'air',
    ifv_namer: 'crew', inf_squad: 'infantry', jeep_shoded: 'crew', mbt_lavi: 'crew',
    mortar_team: 'infantry', recon_drone: 'air', scout_shachaf: 'crew', sniper_team: 'infantry',
    yahalom_squad: 'engineer',
    atgm_cell: 'infantry', charge_squad: 'infantry', digger_crew: 'engineer', gun_truck: 'crew',
    loiter_drone: 'air', manpad_team: 'infantry', militia_cell: 'infantry', mortar_crew: 'infantry',
    moto_rpg: 'crew', paramotor: 'air', recoilless_team: 'infantry', rocket_battery: 'crew',
    rpg_team: 'infantry', sarim_rifles: 'infantry', technical: 'crew',
    civilians: 'infantry', // a class, but no language: civilians never speak (languageOf)
  };

  it('gives every shipped unit the class spec §3 names, overrides first', () => {
    const got = Object.fromEntries(Object.values(units).map((u) => [u.id, voiceClassOf(u)]));
    expect(got).toEqual(EXPECTED);
  });

  it('covers every role the schema offers, eod included (R-15), and refuses one it does not', () => {
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as { properties: { role: { enum: string[] } } };
    for (const role of schema.properties.role.enum) {
      expect(() => voiceClassOf({ id: 'probe', role })).not.toThrow();
    }
    expect(voiceClassOf({ id: 'probe', role: 'eod' })).toBe('engineer');
    expect(() => voiceClassOf({ id: 'probe', role: 'submarine' })).toThrow(/submarine/);
  });

  it('ignores a voice value that is not a class, and falls back to the role', () => {
    expect(voiceClassOf({ id: 'probe', role: 'mbt', voice: 'tank' })).toBe('crew');
  });
});

describe('languageOf (spec §3, D10)', () => {
  it('KDF speaks Hebrew, the three doctrines Arabic, civilians nothing', () => {
    expect(languageOf('kdf', LANGS)).toBe('he');
    for (const f of ['ashwar', 'sarim', 'rif']) expect(languageOf(f, LANGS)).toBe('ar');
    expect(languageOf('civilian', LANGS)).toBeNull();
    expect(languageOf('constructor', LANGS)).toBeNull(); // not a prototype walk
  });
});

describe('the key grammar (R-5)', () => {
  it('is nineteen keys per language, distinct, and ASCII <lang>.<class>.<trigger>', () => {
    const he = allLineKeys(['he']);
    expect(he).toHaveLength(19);
    expect(new Set(he).size).toBe(19);
    for (const k of he) expect(k).toMatch(/^[a-z]{2}\.(infantry|crew|engineer|air|common)\.[a-z]+$/);
    expect(allLineKeys(['he', 'ar', 'he'])).toHaveLength(38);
  });

  it('engineers have a task and no attack; nobody else has a task', () => {
    const he = new Set(allLineKeys(['he']));
    expect(he.has('he.engineer.task')).toBe(true);
    expect(he.has('he.engineer.attack')).toBe(false);
    for (const c of ['infantry', 'crew', 'air']) expect(he.has(`he.${c}.task`)).toBe(false);
  });

  it('maps a verb to its pool: engineers attack from infantry, demolish is always the engineer task', () => {
    expect(orderLineKey('he', 'crew', 'move')).toBe('he.crew.move');
    expect(orderLineKey('he', 'engineer', 'attack')).toBe('he.infantry.attack');
    expect(orderLineKey('he', 'crew', 'demolish')).toBe('he.engineer.task');
    expect(orderLineKey('he', 'air', 'halt')).toBe('he.common.halt');
    expect(orderLineKey('he', 'infantry', 'charge')).toBe('he.common.charge');
    expect(deathLineKey('ar', 'air')).toBe('ar.air.death');
    expect(ackLineKey('he')).toBe('he.common.ack');
  });

  it('every key the director can ask for is inside the universe the manifest declares', () => {
    const all = new Set(allLineKeys(['he']));
    for (const c of VOICE_CLASSES) {
      for (const v of ORDER_VERBS) expect(all.has(orderLineKey('he', c, v)), `${c} ${v}`).toBe(true);
      expect(all.has(deathLineKey('he', c))).toBe(true);
    }
    expect(all.has(ackLineKey('he'))).toBe(true);
  });
});

describe('rosterLanguages (N16)', () => {
  const FACTION: Record<string, string> = { inf_squad: 'kdf', sarim_rifles: 'sarim', technical: 'rif', civilians: 'civilian' };
  const factionOf = (id: string): string | undefined => FACTION[id];

  it('names each spoken language once, sorted, and nothing for civilians or unknown ids', () => {
    expect(rosterLanguages(['inf_squad', 'civilians'], factionOf, LANGS)).toEqual(['he']);
    expect(rosterLanguages(['sarim_rifles', 'inf_squad', 'technical'], factionOf, LANGS)).toEqual(['ar', 'he']);
    expect(rosterLanguages(['nope'], factionOf, LANGS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail:** `pnpm vitest run packages/app/src/voice/lines.test.ts` fails on the missing module.
- [ ] **Step 3: Implement** `lines.ts`:

```ts
/**
 * The voice vocabulary (WP-AU1 §3, §4, §6): which pool a unit answers from,
 * which language its faction speaks, and the ONE key grammar the director
 * asks for and data/audio.json declares. Pure: no DOM, no audio, no sim.
 */
export type VoiceClass = 'infantry' | 'crew' | 'engineer' | 'air';
export const VOICE_CLASSES: readonly VoiceClass[] = ['infantry', 'crew', 'engineer', 'air'];

/** What a gesture can mean to the voice: the cursor's ranked verbs, plus the
 *  two `winningVerb` has no rung for (`move`, and the keyboard's `halt`). */
export type OrderVerb = 'move' | 'attack' | 'demolish' | 'charge' | 'garrison' | 'mount' | 'dismount' | 'smoke' | 'halt';
export const ORDER_VERBS: readonly OrderVerb[] = [
  'move', 'attack', 'demolish', 'charge', 'garrison', 'mount', 'dismount', 'smoke', 'halt',
];

/** The six verbs every class answers with one shared line (spec §4). */
export const COMMON_VERBS = ['garrison', 'smoke', 'mount', 'dismount', 'halt', 'charge'] as const;
export type CommonVerb = (typeof COMMON_VERBS)[number];
export type LineTrigger = 'move' | 'attack' | 'death' | 'task' | 'ack' | CommonVerb;

/** Spec §3's defaults, plus `eod` (R-15), which the table did not name. */
const ROLE_VOICE: Readonly<Record<string, VoiceClass>> = {
  infantry: 'infantry', at_team: 'infantry', sniper: 'infantry', support: 'infantry', artillery: 'infantry',
  mbt: 'crew', ifv: 'crew', apc: 'crew', technical: 'crew', recon: 'crew', aa: 'crew',
  engineer: 'engineer', eod: 'engineer',
  drone: 'air', gunship: 'air',
};

const isVoiceClass = (v: unknown): v is VoiceClass =>
  typeof v === 'string' && (VOICE_CLASSES as readonly string[]).includes(v);

/** The unit's own `voice` field when it names a class, else its role's. A role
 *  with no class is a data error and throws, naming the unit: a silent default
 *  would voice a new role as whatever came first. */
export function voiceClassOf(u: { readonly id: string; readonly role: string; readonly voice?: unknown }): VoiceClass {
  if (isVoiceClass(u.voice)) return u.voice;
  const c = ROLE_VOICE[u.role];
  if (c === undefined) throw new Error(`voice: unit "${u.id}" has role "${u.role}", which no voice class covers`);
  return c;
}

/** Null for a faction the manifest does not map: civilians (D10). */
export function languageOf(faction: string, languages: Readonly<Record<string, string>>): string | null {
  const l: unknown = Object.prototype.hasOwnProperty.call(languages, faction) ? languages[faction] : undefined;
  return typeof l === 'string' && l.length > 0 ? l : null;
}

export function orderLineKey(lang: string, speaker: VoiceClass, verb: OrderVerb): string {
  switch (verb) {
    case 'move':
      return `${lang}.${speaker}.move`;
    case 'attack':
      // Engineers answer `attack` from the infantry pool (spec §4).
      return `${lang}.${speaker === 'engineer' ? 'infantry' : speaker}.attack`;
    case 'demolish':
      return `${lang}.engineer.task`;
    default:
      return `${lang}.common.${verb}`;
  }
}

export const deathLineKey = (lang: string, cls: VoiceClass): string => `${lang}.${cls}.death`;
export const ackLineKey = (lang: string): string => `${lang}.common.ack`;

export function lineTriggerOf(verb: OrderVerb): LineTrigger {
  if (verb === 'demolish') return 'task';
  return verb;
}

/** Every key the director can ever ask for, in these languages. Task 3's
 *  test holds data/audio.json to exactly this set. */
export function allLineKeys(langs: Iterable<string>): string[] {
  const out: string[] = [];
  for (const lang of [...new Set(langs)].sort()) {
    for (const c of VOICE_CLASSES) {
      out.push(`${lang}.${c}.move`);
      if (c !== 'engineer') out.push(`${lang}.${c}.attack`);
      out.push(`${lang}.${c}.death`);
    }
    out.push(`${lang}.engineer.task`);
    for (const v of COMMON_VERBS) out.push(`${lang}.common.${v}`);
    out.push(`${lang}.common.ack`);
  }
  return out;
}

/** The languages a roster can speak (N16): only these are decoded. */
export function rosterLanguages(
  roster: Iterable<string>,
  factionOf: (unitId: string) => string | undefined,
  languages: Readonly<Record<string, string>>
): string[] {
  const out = new Set<string>();
  for (const id of roster) {
    const f = factionOf(id);
    const l = f === undefined ? null : languageOf(f, languages);
    if (l !== null) out.add(l);
  }
  return [...out].sort();
}
```

- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Delete `eod` from `ROLE_VOICE`. The role-coverage test goes red.
  - (b) Drop the `if (c !== 'engineer')` guard. The count goes to 20, red.
  - (c) Make `attack` return `${lang}.${speaker}.attack`. The closure test goes red on `engineer attack`.
  - (d) Test the role before the `voice` field. The sweep goes red on the three overrides.

  Commit both paths with the message `feat(voice): the vocabulary -- class, language, one key grammar (WP-AU1 T2)`.

---

### Task 3: The `voices` manifest and its gate

**Model:** sonnet (spec §6; R-5 to R-8).

**Files:**
- Modify: `data/audio.json`, `tools/validate_audio.py`, `package.json`, `packages/app/src/voice/lines.test.ts`
- Create: `tools/test_validate_audio_voices.py`

**Interfaces:**
- `data/audio.json` `voices: { gain: 0.8, languages: {kdf,ashwar,sarim,rif}, lines: { "<lang>.<class>.<trigger>": { variants: [] } } }`. There are 38 keys, all empty.
- `validate_audio.py` gains `check_voices(voices, failures, factions, audio_dir=AUDIO_DIR) -> set[str]` and `unit_factions() -> set[str]`. `check_licensed_file` gains `licenses=ALLOWED_LICENSES` and `audio_dir=AUDIO_DIR` keyword parameters, and its behaviour does not change at the existing call sites.

- [ ] **Step 1: Write the failing tests.**

  (i) Append the following to `lines.test.ts`, and add `audioManifest` to its `@lions/data` import:

```ts
describe('data/audio.json declares the director’s whole vocabulary (spec §6, R-6)', () => {
  const voices = (audioManifest as {
    voices?: { gain?: number; languages?: Record<string, string>; lines?: Record<string, unknown> };
  }).voices;

  it('maps the four fighting factions and leaves civilians silent (D10)', () => {
    expect(voices?.languages).toEqual({ kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' });
  });

  it('declares every key the director can ask for, and nothing else', () => {
    const langs = Object.values(voices?.languages ?? {});
    expect(Object.keys(voices?.lines ?? {}).sort()).toEqual(allLineKeys(langs).sort());
  });

  it('carries N11’s line gain', () => {
    expect(voices?.gain).toBe(0.8);
  });
});
```

  (ii) Create `tools/test_validate_audio_voices.py`:

```python
"""Guards validate_audio.py's voice half (WP-AU1 §6, R-6, R-7, R-8).

Run: python3 tools/test_validate_audio_voices.py
Exits non-zero on failure. Dependency-free, like test_gen_audio_args.py.
Every case builds a manifest fragment and a scratch audio directory, so
nothing under assets/ is read or written, and no sample is ever touched (D5).
"""
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FACTIONS = {"kdf", "ashwar", "sarim", "rif", "civilian"}


def load():
    spec = importlib.util.spec_from_file_location("validate_audio", os.path.join(HERE, "validate_audio.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def variant(**over):
    v = {
        "file": "voice/he/infantry/move_01a.ogg",
        "license": "LicenseRef-owned",
        "source": "session record 2026-10-01, release form RL-V-001",
        "generator": "recorded",
        "text": "זזים",
        "translit": "zazim",
        "en": "moving",
    }
    v.update(over)
    return {k: x for k, x in v.items() if x is not None}


def voices(lines, languages=None, gain=0.8):
    return {"gain": gain, "languages": languages or {"kdf": "he", "sarim": "ar"}, "lines": lines}


def run(mod, section, files=()):
    with tempfile.TemporaryDirectory() as d:
        for rel in files:
            p = os.path.join(d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as fh:
                fh.write(b"OggS")
        failures = []
        declared = mod.check_voices(section, failures, FACTIONS, audio_dir=d)
        return failures, declared


def main():
    mod = load()
    bad = []

    def check(label, failures, want):
        ok = (not failures) if want is None else any(want in f for f in failures)
        print(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f" -- got {failures}"))
        if not ok:
            bad.append(label)

    good = variant()
    f, declared = run(mod, voices({"he.infantry.move": {"variants": [good]}}), [good["file"]])
    check("an owned, sourced, scripted line passes", f, None)
    if declared != {good["file"]}:
        print(f"FAIL the passing line is returned for the undeclared-file sweep -- got {declared}")
        bad.append("declared")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": []}, "ar.crew.death": {"variants": []}}))
    check("every line empty passes -- the engine ships with no assets", f, None)

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(license=None)]}}), [good["file"]])
    check("no licence fails", f, "not redistribution-safe")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(license="ElevenLabs-free")]}}), [good["file"]])
    check("an unlisted licence fails (D5: the free tier is not commercial)", f, "not redistribution-safe")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(source=None)]}}), [good["file"]])
    check("no source fails", f, "no 'source'")

    for field in ("generator", "text", "translit", "en"):
        f, _ = run(mod, voices({"he.infantry.move": {"variants": [variant(**{field: None})]}}), [good["file"]])
        check(f"no {field} fails", f, f"no '{field}'")

    spaced = variant(file="voice/he/infantry/move 01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [spaced]}}), [spaced["file"]])
    check("a space in the path fails", f, "not voice/")

    hebrew = variant(file="voice/he/infantry/זזים_01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [hebrew]}}), [hebrew["file"]])
    check("a Hebrew filename fails", f, "not voice/")

    wrong = variant(file="voice/he/crew/move_01a.ogg")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [wrong]}}), [wrong["file"]])
    check("a file filed under another key fails", f, "different key")

    alt = variant(alt="voice/he/infantry/move_01a.m4a")
    f, _ = run(mod, voices({"he.infantry.move": {"variants": [alt]}}), [alt["file"], alt["alt"]])
    check("an m4a alt of the same key passes", f, None)

    f, _ = run(mod, voices({"fr.infantry.move": {"variants": []}}))
    check("a key in a language no faction speaks fails", f, "no faction speaks")

    f, _ = run(mod, voices({"he.infantry": {"variants": []}}))
    check("a key that is not <lang>.<class>.<trigger> fails", f, "is not <lang>")

    f, _ = run(mod, voices({}, languages={"kdf": "he", "civilian": "ar"}))
    check("civilians mapped to a language fail (D10)", f, "civilians never speak")

    f, _ = run(mod, voices({}, languages={"kdf": "he", "martians": "ar"}))
    check("an unknown faction fails", f, "unknown faction")

    f, _ = run(mod, voices({"he.infantry.move": {"variants": [good]}}))
    check("a declared file missing on disk fails", f, "missing from assets/audio/")

    f, _ = run(mod, voices({}, gain=1.2))
    check("a voice gain above 1 fails -- a voice is unplaced, like a UI cue", f, "outside 0..1")

    # R-7: the owned licence is for voices only; a battle clip stays CC0/CC-BY.
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "battle"))
        with open(os.path.join(d, "battle", "x.ogg"), "wb") as fh:
            fh.write(b"OggS")
        failures = []
        mod.check_licensed_file(
            {"file": "battle/x.ogg", "license": "LicenseRef-owned", "source": "x"}, failures, mod.MAX_BYTES, audio_dir=d
        )
        check("LicenseRef-owned stays voice-only", failures, "not redistribution-safe")

    if bad:
        print(f"\n{len(bad)} voice gate case(s) failed")
        return 1
    print("\nvoice gate: all cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run them to see them fail.** The vitest reads `undefined` languages. `python3 tools/test_validate_audio_voices.py` fails on the missing `check_voices`.
- [ ] **Step 3: Implement.**

  In `validate_audio.py`, update the docstring's check list with a sixth check: `VOICES -- licence/source/generator/text/translit/en on every voice variant; ASCII voice/<lang>/<class>/<trigger>_<nn><take>.ogg|m4a paths filed under their own key; keys in a language some faction speaks; civilians silent. Duration and loudness (N9, N10) are measured by the asset plan's tool, not here.` Then add:

```python
import re

UNIT_SCHEMA = os.path.join(ROOT, "data", "schemas", "unit.schema.json")
# D9 (WP-AU1 R-7): owned or commissioned voice is neither CC0 nor CC-BY. It is
# allowed HERE and nowhere else, and its `source` must name the release or
# session record -- or, for generated speech, the plan and the date (D5).
VOICE_LICENSES = dict(ALLOWED_LICENSES, **{"LicenseRef-owned": False})
VOICE_KEY = re.compile(r"^([a-z]{2})\.(infantry|crew|engineer|air|common)\.([a-z_]+)$")
VOICE_PATH = re.compile(r"^voice/([a-z]{2})/([a-z]+)/([a-z_]+)_(\d{2})([a-z])\.(ogg|m4a)$")
VOICE_TEXT_FIELDS = ("generator", "text", "translit", "en")


def unit_factions():
    with open(UNIT_SCHEMA) as fh:
        return set(json.load(fh)["properties"]["faction"]["enum"])


def check_voices(voices, failures, factions, audio_dir=AUDIO_DIR):
    """The `voices` section (WP-AU1 §6). Returns every file it declares, for
    the undeclared-file sweep. Key COMPLETENESS is a vitest (lines.test.ts,
    R-6): the vocabulary lives in TypeScript, and this file does not copy it."""
    declared = set()
    if voices is None:
        return declared
    gain = voices.get("gain", 1.0)
    if not 0 <= gain <= 1:
        failures.append(f"voices: gain {gain} outside 0..1 (a voice is unplaced, like a UI cue)")
    langs = voices.get("languages", {})
    for faction, lang in langs.items():
        if faction == "civilian":
            failures.append("voices: civilians never speak (D10) -- 'civilian' must not map to a language")
        elif faction not in factions:
            failures.append(f"voices: language for unknown faction '{faction}'")
        if not re.fullmatch(r"[a-z]{2}", str(lang)):
            failures.append(f"voices: faction '{faction}' maps to '{lang}', not a two-letter language")
    spoken = set(langs.values())
    for key, line in voices.get("lines", {}).items():
        m = VOICE_KEY.match(key)
        if not m:
            failures.append(f"voices: key '{key}' is not <lang>.<class>.<trigger>")
            continue
        if m.group(1) not in spoken:
            failures.append(f"voices: key '{key}' is in a language no faction speaks")
        for v in line.get("variants", []):
            f = v.get("file")
            if not f:
                failures.append(f"voices '{key}': variant with no file")
                continue
            for field in VOICE_TEXT_FIELDS:
                if not v.get(field):
                    failures.append(f"{f}: no '{field}' -- a voice line carries its script, transliteration, meaning and generator")
            for role in ("file", "alt"):
                rel = v.get(role)
                if rel is None:
                    continue
                pm = VOICE_PATH.match(rel)
                if not pm:
                    failures.append(f"{rel}: not voice/<lang>/<class>/<trigger>_<nn><take>.ogg|m4a in ASCII [a-z0-9_]")
                    continue
                if pm.group(1, 2, 3) != m.group(1, 2, 3):
                    failures.append(f"{rel}: filed under a different key than '{key}'")
                declared.add(rel)
            check_licensed_file(v, failures, MAX_BYTES, licenses=VOICE_LICENSES, audio_dir=audio_dir)
    return declared
```

  `check_licensed_file` becomes `def check_licensed_file(entry, failures, max_bytes, roles=("file", "alt"), licenses=ALLOWED_LICENSES, audio_dir=AUDIO_DIR):`. Read `licenses` where it read `ALLOWED_LICENSES`, and `audio_dir` where it read `AUDIO_DIR`. In `main()`, after the music block, call `declared_voice = check_voices(man.get("voices"), failures, unit_factions())`. Add `declared |= declared_voice` to the on-disk sweep's set, so that a declared voice file is never reported as undeclared. Also count voice variants into the passing message.

  In `data/audio.json`, add the following after `"sets"`. Key order is free; the test compares sorted sets.

```json
  "voices": {
    "$comment": "Unit voices (WP-AU1, docs/superpowers/specs/2026-09-25-unit-voices-design.md). Keyed <lang>.<class>.<trigger>; every key the director can ask for is declared, and an empty `variants` list means the line is not recorded yet -- the engine plays nothing for it. A variant carries file, alt, license, source, credit, generator, text, translit and en, and `pnpm validate:audio` enforces them. No file lands before its rights are confirmed (D5).",
    "gain": 0.8,
    "languages": { "kdf": "he", "ashwar": "ar", "sarim": "ar", "rif": "ar" },
    "lines": {
      "ar.air.attack": { "variants": [] }, "ar.air.death": { "variants": [] }, "ar.air.move": { "variants": [] },
      "ar.common.ack": { "variants": [] }, "ar.common.charge": { "variants": [] }, "ar.common.dismount": { "variants": [] },
      "ar.common.garrison": { "variants": [] }, "ar.common.halt": { "variants": [] }, "ar.common.mount": { "variants": [] },
      "ar.common.smoke": { "variants": [] }, "ar.crew.attack": { "variants": [] }, "ar.crew.death": { "variants": [] },
      "ar.crew.move": { "variants": [] }, "ar.engineer.death": { "variants": [] }, "ar.engineer.move": { "variants": [] },
      "ar.engineer.task": { "variants": [] }, "ar.infantry.attack": { "variants": [] }, "ar.infantry.death": { "variants": [] },
      "ar.infantry.move": { "variants": [] },
      "he.air.attack": { "variants": [] }, "he.air.death": { "variants": [] }, "he.air.move": { "variants": [] },
      "he.common.ack": { "variants": [] }, "he.common.charge": { "variants": [] }, "he.common.dismount": { "variants": [] },
      "he.common.garrison": { "variants": [] }, "he.common.halt": { "variants": [] }, "he.common.mount": { "variants": [] },
      "he.common.smoke": { "variants": [] }, "he.crew.attack": { "variants": [] }, "he.crew.death": { "variants": [] },
      "he.crew.move": { "variants": [] }, "he.engineer.death": { "variants": [] }, "he.engineer.move": { "variants": [] },
      "he.engineer.task": { "variants": [] }, "he.infantry.attack": { "variants": [] }, "he.infantry.death": { "variants": [] },
      "he.infantry.move": { "variants": [] }
    }
  }
```

  In `package.json`, `validate:audio` becomes `python3 tools/validate_audio.py && python3 tools/test_gen_audio_args.py && python3 tools/test_validate_audio_voices.py`.
- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Pass `licenses=ALLOWED_LICENSES` in `check_voices`. The passing case goes red.
  - (b) Delete the `VOICE_TEXT_FIELDS` loop. The four "no …" cases go red.
  - (c) Relax `VOICE_PATH` to `r"^voice/(.+)/(.+)/(.+)_(\d{2})(.)\.(ogg|m4a)$"`. The space and Hebrew cases go red.
  - (d) Delete `"he.common.halt"` from `data/audio.json`. The completeness vitest goes red.
  - (e) Map `"civilian": "ar"` in the real manifest. `pnpm validate:audio` goes red.

  Commit the five paths with the message `feat(audio): the voices manifest, declared empty, and its licence gate (WP-AU1 T3)`. The body names R-6, R-7 and R-8, and says that no sample is committed (D5).

---

### Task 4: The mixer, part 1: voice types, the bus, the radio band and roster-only decoding

**Model:** opus. The mixer (spec §7; N11, N13, N16; R-2, R-11, R-19, R-20).

**Files:**
- Modify: `packages/render/src/audio.ts`, `packages/render/src/audio.test.ts`, `packages/render/src/index.ts`

**Interfaces (Task 5 implements what is declared here; Tasks 7, 9 and 11 import the types):**
- `interface VoiceVariant extends AudioVariant { generator?: string; text?: string; translit?: string; en?: string }`
- `interface VoiceLine { variants?: VoiceVariant[] }`
- `interface VoiceManifest { gain?: number; languages?: Record<string, string>; lines?: Record<string, VoiceLine> }`
- `AudioManifest.voices?: VoiceManifest`; `AudioGains.voice?: number` (R-11)
- `busGain(...)` now returns `{ master: number; sfx: number; voice: number }`
- `type VoicePriority = 'order' | 'kdf_death' | 'enemy_death'`; `const VOICE_RANK: Readonly<Record<VoicePriority, number>>` (3, 2, 1)
- `interface VoicePlay { key: string; priority: VoicePriority; at?: { x: number; y: number } }`
- `type VoiceStatus = 'played' | 'placeholder' | 'missing' | 'muted' | 'volume-zero' | 'dropped' | 'no-context' | 'too-far'`
- `interface VoiceResult { status: VoiceStatus; seconds: number; en: string | null; cut: number }`
- `interface VoiceStats { languages: string[]; keys: number; bytes: number; overBudget: boolean; placeholder: boolean; active: number }`
- Constants: `VOICE_CAP = 2`, `VOICE_DECODE_BUDGET_BYTES = 16 * 1024 * 1024`, `RADIO_BAND_HZ = { low: 300, high: 3400 }`, `DUCK = { sfx: 0.631, music: 0.708, attackS: 0.08, releaseS: 0.3 }`, `VOICE_CUT_S = 0.04`, `PLACEHOLDER_HZ = { move: 1318, attack: 1480, task: 1661, death: 1244, ack: 2093, verb: 1865 }`, `PLACEHOLDER_S = 0.12`, `PLACEHOLDER_GAIN = 0.15`.
- `BattleAudio`: `setVoiceLanguages(langs: readonly string[]): void`, `voiceStats(): VoiceStats`, `setVoicePlaceholder(on: boolean): void`. `playVoice` and `stopVoices` come in Task 5.

- [ ] **Step 1: Write the failing tests.** In `audio.test.ts`, **replace** the `FakeContext` class and `attached()` with the recorder below. Every existing test keeps passing against it: `oscillators`, `sources` and `stops` keep their meaning, and an oscillator still exposes `frequency.value`. Update the one existing expectation that gains the new field: `busGain(0.9, { master: 0.5, music: 1, sfx: 0.25 })` now equals `{ master: 0.45, sfx: 0.25, voice: 1 }`. That is not a weakening; the old two keys are unchanged. Add `vi` and the new exports to the imports.

```ts
/** One AudioParam, recording every automation call as [method, value, time]. */
interface FakeParam {
  value: number;
  readonly events: [string, number, number][];
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}
function param(value: number): FakeParam {
  const events: [string, number, number][] = [];
  return {
    value,
    events,
    setValueAtTime: (v, t) => void events.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => void events.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => void events.push(['exp', v, t]),
    cancelScheduledValues: (t) => void events.push(['cancel', 0, t]),
  };
}
/** Every node remembers the ONE node it feeds, so a test can walk a chain. */
class FakeNode {
  to: unknown = null;
  connect<T>(n: T): T {
    this.to = n;
    return n;
  }
  disconnect(): void {
    this.to = null;
  }
}
class FakeGain extends FakeNode {
  readonly gain = param(1);
}
class FakeFilter extends FakeNode {
  type = '';
  readonly frequency = param(350);
  readonly Q = param(1);
}
class FakePanner extends FakeNode {
  readonly pan = param(0);
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  readonly playbackRate = param(1);
  onended: (() => void) | null = null;
  stoppedAt: number | null = null;
  start(): void {}
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}
class FakeOscillator extends FakeSource {
  type = '';
  readonly frequency = param(0);
  constructor(private readonly stops: number[]) {
    super();
  }
  override stop(t = 0): void {
    super.stop(t);
    this.stops.push(t);
  }
}
interface FakeBuffer {
  duration: number;
  length: number;
  numberOfChannels: number;
}
const LINE_BUFFER: FakeBuffer = { duration: 1.2, length: 57_600, numberOfChannels: 1 };
class FakeContext {
  static made: FakeContext[] = [];
  /** What the next `decodeAudioData` resolves to. */
  static nextBuffer: FakeBuffer = { ...LINE_BUFFER };
  readonly oscillators: FakeOscillator[] = [];
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  /** Every oscillator's `stop(t)` time, in context seconds. */
  readonly stops: number[] = [];
  state = 'running';
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  constructor() {
    FakeContext.made.push(this);
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createStereoPanner(): FakePanner {
    return new FakePanner();
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator(this.stops);
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(_channels: number, n: number): { getChannelData(): Float32Array } {
    return { getChannelData: () => new Float32Array(n) };
  }
  decodeAudioData(): Promise<FakeBuffer> {
    return Promise.resolve({ ...FakeContext.nextBuffer });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

const realAudioContext = globalThis.AudioContext;

/** An attached `BattleAudio` whose context is the recorder above; `setup` runs
 *  before `attach()`, which only builds the context inside its own gesture
 *  listeners, so the keydown is what brings it into being. */
function attachedWith(setup: (a: BattleAudio) => void): { audio: BattleAudio; ctx: FakeContext } {
  FakeContext.made.length = 0;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const audio = new BattleAudio();
  setup(audio);
  audio.attach();
  window.dispatchEvent(new KeyboardEvent('keydown'));
  const ctx = FakeContext.made[0];
  if (!ctx) throw new Error('attach() built no AudioContext');
  return { audio, ctx };
}
const attached = (): { audio: BattleAudio; ctx: FakeContext } => attachedWith(() => {});

/** Every URL `fetch` was asked for, in order; every answer is four bytes. */
function stubFetch(): string[] {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  });
  return fetched;
}

afterEach(() => {
  globalThis.AudioContext = realAudioContext;
  vi.unstubAllGlobals();
  FakeContext.nextBuffer = { ...LINE_BUFFER };
});

const V = (file: string, en: string): VoiceVariant => ({
  file, license: 'LicenseRef-owned', source: 'test', generator: 'test', text: 't', translit: 't', en,
});
/** A manifest with one ui set, one battle set and five voice keys: three
 *  Hebrew lines, one declared-empty Hebrew key, one Arabic line. */
const MANIFEST: AudioManifest = {
  master_gain: 1,
  sets: {
    tank_gun: { event: 'fire', weapon_classes: ['apfsds'], variants: [{ file: 'battle/tank_gun_01.ogg' }] },
    ui_alert: { event: 'ui', variants: [{ file: 'ui/alert_01.ogg' }] },
  },
  voices: {
    gain: 0.8,
    languages: { kdf: 'he', sarim: 'ar' },
    lines: {
      'he.infantry.move': { variants: [V('voice/he/infantry/move_01a.ogg', 'moving')] },
      'he.infantry.death': { variants: [V('voice/he/infantry/death_01a.ogg', 'we are hit')] },
      'he.common.ack': { variants: [V('voice/he/common/ack_01a.ogg', 'copy')] },
      'he.crew.death': { variants: [] },
      'ar.infantry.death': { variants: [V('voice/ar/infantry/death_01a.ogg', 'we are hit')] },
    },
  },
};
```

  Then add:

```ts
describe('the voice bus (WP-AU1 §7, N11, N13, R-11)', () => {
  it('busGain carries the Voices slider, and gains without one read it as 1', () => {
    expect(busGain(0.9, { master: 0.5, music: 1, sfx: 0.25, voice: 0.4 })).toEqual({ master: 0.45, sfx: 0.25, voice: 0.4 });
    expect(busGain(0.9, { master: 1, music: 1, sfx: 1 })).toEqual({ master: 0.9, sfx: 1, voice: 1 });
    expect(busGain(1, { master: 1, music: 1, sfx: 1, voice: 7 }).voice).toBe(1);
  });

  it('attach builds master, sfx, the sfx duck and the voice bus, and the radio band feeds the voice bus', () => {
    const { ctx } = attached();
    const [master, sfx, sfxDuck, voice] = ctx.gains;
    if (!master || !sfx || !sfxDuck || !voice) throw new Error('attach() built fewer than four gains');
    expect(master.to).toBe(ctx.destination);
    expect(sfx.to).toBe(sfxDuck);
    expect(sfxDuck.to).toBe(master);
    expect(voice.to).toBe(master);
    const [hp, lp] = ctx.filters;
    if (!hp || !lp) throw new Error('attach() built no radio band');
    expect([hp.type, hp.frequency.value, hp.to]).toEqual(['highpass', RADIO_BAND_HZ.low, lp]);
    expect([lp.type, lp.frequency.value, lp.to]).toEqual(['lowpass', RADIO_BAND_HZ.high, voice]);
  });

  it('the Voices slider drives the voice bus live, and leaves sfx alone', () => {
    const { audio, ctx } = attached();
    audio.setGains({ master: 1, music: 1, sfx: 0.5, voice: 0.25 });
    expect(ctx.gains[3]?.gain.value).toBe(0.25);
    expect(ctx.gains[1]?.gain.value).toBe(0.5);
  });
});

describe('voice decoding (N16, spec §7 decode order)', () => {
  it('fetches nothing before the first gesture, whatever the roster says', () => {
    const fetched = stubFetch();
    const a = new BattleAudio();
    a.useManifest(MANIFEST, '/a/');
    a.setVoiceLanguages(['he', 'ar']);
    expect(fetched).toEqual([]);
    expect(a.voiceStats()).toMatchObject({ languages: ['ar', 'he'], keys: 0, bytes: 0 });
  });

  it('decodes ui, then the roster’s voices, then the battle library -- and no other language', async () => {
    const fetched = stubFetch();
    attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(fetched).toHaveLength(5));
    expect(fetched).toEqual([
      '/a/ui/alert_01.ogg',
      '/a/voice/he/infantry/move_01a.ogg',
      '/a/voice/he/infantry/death_01a.ogg',
      '/a/voice/he/common/ack_01a.ogg',
      '/a/battle/tank_gun_01.ogg',
    ]);
  });

  it('a language that joins the roster later decodes then; one that leaves is freed', async () => {
    const fetched = stubFetch();
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(audio.voiceStats().keys).toBe(3));
    audio.setVoiceLanguages(['ar', 'he']);
    await vi.waitFor(() => expect(audio.voiceStats().keys).toBe(4));
    expect(fetched.filter((u) => u.includes('/voice/ar/'))).toEqual(['/a/voice/ar/infantry/death_01a.ogg']);
    audio.setVoiceLanguages(['ar']);
    expect(audio.voiceStats()).toMatchObject({ languages: ['ar'], keys: 1, bytes: LINE_BUFFER.length * 4 });
  });

  it('stops at 16 MB of decoded PCM and says so, rather than growing without bound', async () => {
    stubFetch();
    FakeContext.nextBuffer = { duration: 50, length: 48_000 * 50, numberOfChannels: 1 }; // 9.6 MB decoded
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(audio.voiceStats().overBudget).toBe(true));
    expect(audio.voiceStats().keys).toBe(1);
    expect(audio.voiceStats().bytes).toBeLessThanOrEqual(VOICE_DECODE_BUDGET_BYTES);
  });
});
```

- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run packages/render/src/audio.test.ts` fails on the missing exports.
- [ ] **Step 3: Implement.**
  - **Types and constants**, as listed under Interfaces, each with a one-line comment naming its N-number.
  - **Rename** `MAX_VOICES_PER_TICK` to `MAX_SOURCES_PER_TICK` (R-19).
  - **`busGain`** returns `voice: clamp01(g.voice ?? 1)`.
  - **`attach()`'s `start`** builds the graph in this order, which the test pins:

```ts
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.sfx = this.ctx.createGain();
        // The duck stage (N12) sits UNDER the sfx slider's own gain, so the
        // slider and the duck never fight over one AudioParam.
        this.sfxDuck = this.ctx.createGain();
        this.sfx.connect(this.sfxDuck).connect(this.master);
        this.voice = this.ctx.createGain();
        this.voice.connect(this.master);
        // The radio band (N13): every unplaced line enters here. Two filters,
        // not one bandpass, because a single biquad is not flat across 300-3400.
        this.radioIn = this.ctx.createBiquadFilter();
        this.radioIn.type = 'highpass';
        this.radioIn.frequency.value = RADIO_BAND_HZ.low;
        const top = this.ctx.createBiquadFilter();
        top.type = 'lowpass';
        top.frequency.value = RADIO_BAND_HZ.high;
        this.radioIn.connect(top).connect(this.voice);
        const bus = busGain(this.masterGain, this.user);
        this.master.gain.value = bus.master;
        this.sfx.gain.value = bus.sfx;
        this.voice.gain.value = bus.voice;
```

  - **`setGains`** also writes `this.voice.gain.value`. `user` keeps `voice` as given, clamped, or absent.
  - **`useManifest`** stores `manifest.voices` and `this.voiceGain = clamp01(manifest.voices?.gain ?? 1)`.
  - **Decoding.** Split `decodeAll`'s loop body into `private async fetchDecode(ctx, v): Promise<AudioBuffer | null>`, which tries `file` then `alt` exactly as today, and `private async decodeSet(ctx, name, spec)`. `decodeAll` then decodes every `ui` set, then `await this.queueVoiceDecode()`, then the rest, in `decodeOrder` order. `queueVoiceDecode` chains onto `this.voiceJob`, a promise that starts as `Promise.resolve()`, so two calls never decode at once.
  - **`decodeVoices`** walks `voices.lines` in manifest order. It skips a key whose language (`key.split('.')[0]`) is not wanted, or that is already loaded. For each variant it calls `fetchDecode`, then computes `bytes = b.length * b.numberOfChannels * 4`. If `this.voiceBytes + bytes > VOICE_DECODE_BUDGET_BYTES`, it sets `voiceOverBudget = true` and skips the variant. It stores `{ buffers, en, bytes }` per key, `en` holding each variant's `en ?? null`, and re-checks that the language is still wanted before storing.
  - **`setVoiceLanguages`** replaces the wanted set. It deletes every loaded key whose language left, subtracting its bytes, and calls `queueVoiceDecode()` if a context exists.
  - **`voiceStats`** reports the wanted languages sorted, loaded keys, bytes, `overBudget`, `placeholder` and `active` (0 until Task 5).
  - **`setVoicePlaceholder`** stores the flag.

  In `index.ts`, add `PLACEHOLDER_HZ`, `VOICE_DECODE_BUDGET_BYTES` and `type VoiceManifest, type VoicePlay, type VoicePriority, type VoiceResult, type VoiceStats, type VoiceStatus, type VoiceVariant` to the `./audio` export.
- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Decode the voices after the battle sets. The order test goes red.
  - (b) Ignore the wanted set, so every language decodes. The order test goes red on an `ar` URL.
  - (c) Drop the budget check. The budget test goes red.
  - (d) Connect the voice bus to `sfx` instead of `master`. The topology test goes red.
  - (e) Do not free a language that leaves. The last `toMatchObject` goes red.

  Commit the three paths with the message `feat(audio): a voice bus, the radio band, and roster-only decoding under 16 MB (WP-AU1 T4)`.

---

### Task 5: The mixer, part 2: `playVoice`, two voices, the interrupt, the duck and the placeholder

**Model:** opus. The mixer (N4, N5, N12, N13; R-2, R-9, R-10, R-14).

**Files:**
- Modify: `packages/render/src/audio.ts`, `packages/render/src/audio.test.ts`

**Interfaces:**
- `function admitVoice(active: readonly { id: number; priority: VoicePriority }[], incoming: VoicePriority, cap?: number): { play: boolean; cut: number[] }`
- `function duckRamp(from: number, to: number, elapsedMs: number, durMs: number): number`
- `interface Placement { audible: boolean; gain: number; pan: number; lowpassHz: number }`; `function placement(dx: number, dy: number): Placement`
- `BattleAudio.playVoice(p: VoicePlay): VoiceResult`; `BattleAudio.stopVoices(): void`

- [ ] **Step 1: Write the failing tests.** Append to `audio.test.ts`:

```ts
describe('admitVoice (N4, N5)', () => {
  const v = (id: number, priority: VoicePriority): { id: number; priority: VoicePriority } => ({ id, priority });
  it('plays into a free slot', () => {
    expect(admitVoice([], 'enemy_death')).toEqual({ play: true, cut: [] });
    expect(admitVoice([v(1, 'order')], 'kdf_death')).toEqual({ play: true, cut: [] });
  });
  it('a new order cuts the last order, whatever else is playing (N4)', () => {
    expect(admitVoice([v(1, 'order')], 'order')).toEqual({ play: true, cut: [1] });
    expect(admitVoice([v(1, 'order'), v(2, 'kdf_death')], 'order')).toEqual({ play: true, cut: [1] });
  });
  it('full: the lowest-ranked voice goes, oldest first; a tie or a loser is dropped, not queued (N5)', () => {
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'kdf_death')], 'order')).toEqual({ play: true, cut: [1] });
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'enemy_death')], 'order')).toEqual({ play: true, cut: [2] });
    expect(admitVoice([v(1, 'enemy_death'), v(2, 'kdf_death')], 'kdf_death')).toEqual({ play: true, cut: [1] });
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'kdf_death')], 'kdf_death')).toEqual({ play: false, cut: [] });
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'kdf_death')], 'enemy_death')).toEqual({ play: false, cut: [] });
  });
});

describe('duckRamp and placement', () => {
  it('ramps linearly and holds its target once the time is up (N12)', () => {
    expect(duckRamp(1, 0.5, 0, 80)).toBe(1);
    expect(duckRamp(1, 0.5, 40, 80)).toBeCloseTo(0.75);
    expect(duckRamp(1, 0.5, 80, 80)).toBe(0.5);
    expect(duckRamp(1, 0.5, 500, 80)).toBe(0.5);
  });
  it('is playSet’s own arithmetic, unchanged: gain atten², lowpass, pan, and a hard edge at 26 tiles', () => {
    expect(placement(0, 0)).toEqual({ audible: true, gain: 1, pan: 0, lowpassHz: 13_200 });
    const half = placement(13, 0);
    expect(half.gain).toBeCloseTo(0.25);
    expect(half.lowpassHz).toBeCloseTo(4200);
    expect(half.pan).toBeCloseTo(13 / 18.2);
    expect(placement(0, 13).pan).toBeCloseTo(-13 / 18.2);
    expect(placement(27, 0).audible).toBe(false);
  });
});

describe('playVoice (WP-AU1 §7)', () => {
  /** A context whose Hebrew (and, if asked, Arabic) lines have decoded. */
  async function ready(langs: string[] = ['he'], manifest: AudioManifest = MANIFEST) {
    stubFetch();
    const r = attachedWith((a) => {
      a.useManifest(manifest, '/a/');
      a.setVoiceLanguages(langs);
    });
    await vi.waitFor(() => expect(r.audio.voiceStats().keys).toBe(langs.includes('ar') ? 4 : 3));
    const [, , sfxDuck, voice] = r.ctx.gains;
    const [hp] = r.ctx.filters;
    if (!sfxDuck || !voice || !hp) throw new Error('attach() did not build the voice graph');
    return { ...r, sfxDuck, voice, hp };
  }
  const order = (key: string): VoicePlay => ({ key, priority: 'order' });
  const last = <T>(xs: T[]): T => {
    const x = xs.at(-1);
    if (x === undefined) throw new Error('nothing was created');
    return x;
  };

  it('is safe before attach, and says why nothing played', () => {
    expect(new BattleAudio().playVoice(order('he.infantry.move')).status).toBe('no-context');
  });

  it('plays an order over the radio band at the line gain, and hands back its meaning and length', async () => {
    const { audio, ctx, hp } = await ready();
    expect(audio.playVoice(order('he.infantry.move'))).toEqual({ status: 'played', seconds: 1.2, en: 'moving', cut: 0 });
    const line = last(ctx.sources).to as FakeGain;
    expect(line.gain.value).toBeCloseTo(0.8);
    expect(line.to).toBe(hp);
  });

  it('a missing line plays nothing and is not an error: status missing, no node made (R-9)', async () => {
    const { audio, ctx } = await ready();
    const before = ctx.sources.length + ctx.oscillators.length;
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' }).status).toBe('missing'); // declared, empty
    expect(audio.playVoice(order('he.nope.move')).status).toBe('missing'); // not declared at all
    expect(ctx.sources.length + ctx.oscillators.length).toBe(before);
  });

  it('plays nothing muted, at Voices 0 or at Master 0 -- and does not duck for a voice nobody hears', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.setVoicePlaceholder(true); // not even the dev tick
    expect(audio.toggle()).toBe(true);
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('muted');
    expect(audio.toggle()).toBe(false);
    audio.setGains({ master: 1, music: 1, sfx: 1, voice: 0 });
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('volume-zero');
    expect(audio.playVoice(order('he.crew.move')).status).toBe('volume-zero');
    audio.setGains({ master: 0, music: 1, sfx: 1, voice: 1 });
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('volume-zero');
    expect(ctx.sources).toEqual([]);
    expect(ctx.oscillators).toEqual([]);
    expect(sfxDuck.gain.events.filter((e) => e[0] === 'linear')).toEqual([]);
  });

  it('ducks sfx −4 dB in 80 ms under a voice and lets go over 300 ms when the LAST one ends (N12)', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.playVoice(order('he.infantry.move'));
    const first = last(ctx.sources);
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    const second = last(ctx.sources);
    expect(sfxDuck.gain.events).toContainEqual(['linear', DUCK.sfx, DUCK.attackS]);
    first.onended?.();
    expect(sfxDuck.gain.events).not.toContainEqual(['linear', 1, DUCK.releaseS]);
    second.onended?.();
    expect(sfxDuck.gain.events).toContainEqual(['linear', 1, DUCK.releaseS]);
  });

  it('ducks the music element −3 dB and brings it back (N12, R-2)', async () => {
    const withMusic: AudioManifest = { ...MANIFEST, music: { gain: 0.4, tracks: [{ file: 'music/t.mp3' }] } };
    const { audio, ctx } = await ready(['he'], withMusic);
    const els = document.querySelectorAll('audio');
    const el = els[els.length - 1];
    if (!el) throw new Error('no music element');
    expect(el.volume).toBeCloseTo(0.4);
    vi.useFakeTimers();
    try {
      audio.playVoice(order('he.infantry.move'));
      vi.advanceTimersByTime(100);
      expect(el.volume).toBeCloseTo(0.4 * DUCK.music);
      last(ctx.sources).onended?.();
      vi.advanceTimersByTime(400);
      expect(el.volume).toBeCloseTo(0.4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new order cuts the last order with a 40 ms fade (N4)', async () => {
    const { audio, ctx } = await ready();
    audio.playVoice(order('he.infantry.move'));
    const first = last(ctx.sources);
    expect(audio.playVoice(order('he.common.ack'))).toMatchObject({ status: 'played', cut: 1 });
    expect(first.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    expect((first.to as FakeGain).gain.events).toContainEqual(['linear', 0, VOICE_CUT_S]);
  });

  it('holds two voices: a losing death is dropped, an order takes the oldest lowest slot (N5)', async () => {
    const { audio, ctx } = await ready(['he', 'ar']);
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    const oldest = last(ctx.sources);
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    const made = ctx.sources.length;
    expect(audio.playVoice({ key: 'ar.infantry.death', priority: 'enemy_death', at: { x: 1, y: 1 } }).status).toBe('dropped');
    expect(ctx.sources.length).toBe(made);
    expect(audio.playVoice(order('he.infantry.move'))).toMatchObject({ status: 'played', cut: 1 });
    expect(oldest.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    expect(audio.voiceStats().active).toBe(2);
  });

  it('places an enemy death in the world, off the radio band, on the voice bus (R-14)', async () => {
    const { audio, ctx, hp, voice } = await ready(['he', 'ar']);
    expect(audio.playVoice({ key: 'ar.infantry.death', priority: 'enemy_death', at: { x: 3, y: 4 } }).status).toBe('played');
    const lp = last(ctx.sources).to as FakeFilter;
    expect(lp).not.toBe(hp);
    expect(lp.type).toBe('lowpass');
    const pan = lp.to as FakePanner;
    const g = pan.to as FakeGain;
    expect(g.to).toBe(voice);
    const made = ctx.sources.length;
    expect(audio.playVoice({ key: 'ar.infantry.death', priority: 'enemy_death', at: { x: 30, y: 0 } }).status).toBe('too-far');
    expect(ctx.sources.length).toBe(made);
  });

  it('the dev placeholder: one tick per line class through the same chain, only when asked (R-10)', async () => {
    const { audio, ctx, hp } = await ready();
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' }).status).toBe('missing');
    expect(ctx.oscillators).toEqual([]);
    audio.setVoicePlaceholder(true);
    expect(audio.voiceStats().placeholder).toBe(true);
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' })).toEqual({
      status: 'placeholder', seconds: PLACEHOLDER_S, en: null, cut: 0,
    });
    const tick = last(ctx.oscillators);
    expect(tick.frequency.value).toBe(PLACEHOLDER_HZ.death);
    expect((tick.to as FakeGain).to).toBe(hp);
    expect(tick.stoppedAt).toBeCloseTo(PLACEHOLDER_S);
    audio.playVoice(order('he.common.halt'));
    expect(last(ctx.oscillators).frequency.value).toBe(PLACEHOLDER_HZ.verb);
    // A recorded line always wins over the tick.
    const ticks = ctx.oscillators.length;
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('played');
    expect(ctx.oscillators.length).toBe(ticks);
  });

  it('stopVoices fades everything out and lets go of the duck -- a mission leave', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.playVoice(order('he.infantry.move'));
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    audio.stopVoices();
    for (const s of ctx.sources) expect(s.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    expect(audio.voiceStats().active).toBe(0);
    expect(sfxDuck.gain.events).toContainEqual(['linear', 1, DUCK.releaseS]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `playVoice`, `admitVoice`, `duckRamp` and `placement` do not exist.
- [ ] **Step 3: Implement.**

```ts
/** N4 and N5 as one pure rule. `active` is oldest-first. */
export function admitVoice(
  active: readonly { id: number; priority: VoicePriority }[],
  incoming: VoicePriority,
  cap = VOICE_CAP
): { play: boolean; cut: number[] } {
  const cut: number[] = [];
  let rest = active;
  if (incoming === 'order') {
    for (const v of active) if (v.priority === 'order') cut.push(v.id);
    rest = active.filter((v) => v.priority !== 'order');
  }
  if (rest.length < cap) return { play: true, cut };
  let low = rest[0];
  for (const v of rest) if (VOICE_RANK[v.priority] < VOICE_RANK[low.priority]) low = v;
  // A tie loses to what is already speaking: a queued line describes the past.
  if (VOICE_RANK[low.priority] >= VOICE_RANK[incoming]) return { play: false, cut: [] };
  return { play: true, cut: [...cut, low.id] };
}

export function duckRamp(from: number, to: number, elapsedMs: number, durMs: number): number {
  if (elapsedMs >= durMs) return to;
  return from + ((to - from) * elapsedMs) / durMs;
}

/** `playSet`'s placement arithmetic, lifted verbatim so a placed voice and a
 *  battle clip cannot drift. `gain` excludes the set's own gain. */
export function placement(dx: number, dy: number): Placement {
  const dist = Math.hypot(dx, dy);
  if (dist > AUDIBLE_TILES) return { audible: false, gain: 0, pan: 0, lowpassHz: 0 };
  const atten = 1 - dist / AUDIBLE_TILES;
  return {
    audible: true,
    gain: atten * atten,
    pan: Math.max(-1, Math.min(1, (dx - dy) / (AUDIBLE_TILES * 0.7))),
    lowpassHz: 1200 + atten * atten * 12000,
  };
}
```

  `playSet` then reads `placement(dx, dy)`: `if (!p.audible) return true`, `lp.frequency.value = p.lowpassHz`, `pan.pan.value = p.pan` and `g.gain.value = set.gain * p.gain`. That is the same numbers, now tested.

  `playVoice`, in this order. The status order is part of the contract:

```ts
  playVoice(p: VoicePlay): VoiceResult {
    const none = (status: VoiceStatus): VoiceResult => ({ status, seconds: 0, en: null, cut: 0 });
    // Mute first, and HERE, for playUi's reason: `m` is one flag the HUD reports.
    if (this.muted) return none('muted');
    const ctx = this.ctx;
    const bus = this.voice;
    const radio = this.radioIn;
    if (!ctx || !bus || !radio) return none('no-context');
    // Nothing is made and nothing ducks for a voice nobody can hear.
    if ((this.user.voice ?? 1) === 0 || this.user.master === 0) return none('volume-zero');
    const place = p.at ? placement(p.at.x - this.listener.x, p.at.y - this.listener.y) : null;
    if (place && !place.audible) return none('too-far');
    const line = this.voiceLines.get(p.key);
    if (!line && !this.voicePlaceholder) return none('missing');
    const admit = admitVoice(this.activeVoices, p.priority);
    if (!admit.play) return none('dropped');
    for (const id of admit.cut) this.cutVoice(id);
    …build the line gain (`voiceGain`, or `PLACEHOLDER_GAIN` for the tick, times `place.gain`);
       unplaced: gain → radio; placed: lowpass → panner → gain → bus;
       the source: a buffer drawn with `this.rand()`, or one sine oscillator at
       `placeholderHz(p.key)` stopped at `t + PLACEHOLDER_S`;
       push { id, priority, src, gain } onto `activeVoices`; `src.onended = () => this.voiceEnded(id)`;
       `src.start()`; `this.duck(true)`…
    return { status: line ? 'played' : 'placeholder', seconds, en, cut: admit.cut.length };
  }
```

  The helpers are private:
  - **`placeholderHz(key)`** reads `key.split('.')[2]` and returns `PLACEHOLDER_HZ[trigger]` for move, attack, task, death and ack, and `PLACEHOLDER_HZ.verb` otherwise.
  - **`cutVoice(id)`** does `cancelScheduledValues`, then `setValueAtTime(value, t)`, then `linearRampToValueAtTime(0, t + VOICE_CUT_S)`, then `src.stop(t + VOICE_CUT_S)`. It removes the voice from `activeVoices` and nulls its `onended`.
  - **`voiceEnded(id)`** removes the voice, and calls `duck(false)` when none is left.
  - **`duck(on)`** is idempotent. It automates `sfxDuck.gain` with the same three calls, to `DUCK.sfx` over `DUCK.attackS` or to 1 over `DUCK.releaseS`, and calls `rampMusic(on ? DUCK.music : 1, ms)`.
  - **`rampMusic(to, ms)`** steps `this.musicDuck` with `duckRamp` every `MUSIC_DUCK_STEP_MS = 20` on `window.setTimeout`, counting steps rather than reading a clock (fake timers do not fake `performance`). It then applies the result through one `applyMusicVolume()`: `musicVolume(...) * this.musicDuck`. `setGains` and `startMusic` apply it through the same function.
  - **`stopVoices()`** cuts every active voice, then calls `duck(false)`.
  - **`voiceStats().active`** is `activeVoices.length`.
- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Let a tie win in `admitVoice` (`>` for `>=`). The N5 tie case goes red.
  - (b) Release the duck on every `onended`, not only the last. The N12 test goes red on the first `not.toContainEqual`.
  - (c) Connect unplaced lines straight to `bus`. The radio test goes red.
  - (d) Check `volume-zero` after admission and ducking. The zero test goes red on the duck events.
  - (e) Create the placeholder tick without checking the flag. The first placeholder assertion goes red.

  Commit both paths with the message `feat(audio): playVoice -- two voices, orders on top, a duck and a radio band (WP-AU1 T5)`.

---

### Task 6: Settings: the Voices slider and the captions toggle, and every catalogue key

**Model:** sonnet (spec §7; N11; D8; R-11).

**Files:**
- Modify: `packages/app/src/settings.ts`, `packages/app/src/settings.test.ts`, `packages/app/src/ui/settings-panel.ts`, `packages/app/src/ui/settings-panel.test.ts`, `packages/app/src/i18n/en.json`

**Interfaces:**
- `Settings.audio.voice: number` (default 1)
- `Settings.accessibility.captions: boolean` (default `false`, D8)
- Catalogue keys: `settings.audio.voice`, `settings.captions`, `settings.captions.hint` and `hud.caption.label`. The last is used by Task 10; every key lands here.

- [ ] **Step 1: Write the failing tests.** Append the following to `settings.test.ts`, inside `describe('parseSettings', …)`:

```ts
  it('audio carries a voice level, default 1, parsed field by field like its neighbours (N11)', () => {
    expect(DEFAULT_SETTINGS.audio.voice).toBe(1);
    // A save from before voices keeps its three levels and gains the fourth.
    expect(parseSettings(JSON.stringify({ version: 1, audio: { master: 0.5, music: 0.2, sfx: 0.3 } })).audio).toEqual({
      master: 0.5, music: 0.2, sfx: 0.3, voice: 1,
    });
    expect(parseSettings(JSON.stringify({ version: 1, audio: { voice: 0 } })).audio.voice).toBe(0);
    expect(parseSettings(JSON.stringify({ version: 1, audio: { voice: 1.5, sfx: 0.4 } })).audio).toEqual({
      master: 1, music: 1, sfx: 0.4, voice: 1,
    });
  });
  it('captions are off by default, and a bad value reads as off (D8)', () => {
    expect(DEFAULT_SETTINGS.accessibility.captions).toBe(false);
    expect(parseSettings(JSON.stringify({ version: 1, accessibility: { captions: true } })).accessibility.captions).toBe(true);
    expect(parseSettings(JSON.stringify({ version: 1, accessibility: { captions: 'yes', motion: 'reduce' } })).accessibility).toEqual({
      motion: 'reduce', colorVision: 'default', captions: false,
    });
  });
```

  Three existing expectations gain the new fields. This is not a weakening: every old key keeps its value.
  - The `s.audio` expectation in "keeps every valid field…" adds `voice: 1`.
  - Its `s.accessibility` adds `captions: false`.
  - The round-trip literal's `audio` gains `voice: 0.4`.

  `tsc` names any other `Settings` literal that lacks a field, such as the `applySettings` test's `accessibility`; add `captions: false` there.

  Append the following to `settings-panel.test.ts`, inside `describe('settingsPanel', …)`. Its existing `music` test's `toHaveBeenCalledWith` gains `voice: 1`.

```ts
  it('the Voices slider reaches the mixer while dragged and persists on release (WP-AU1 §7)', () => {
    const { d, set, gains } = deps();
    const { el } = settingsPanel(document.body, d);
    const r = el.querySelector<HTMLInputElement>('input[name="voice"]');
    if (!r) throw new Error('no voice slider');
    expect(el.textContent).toContain('Voices');
    r.value = '0';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gains).toHaveBeenLastCalledWith({ master: 1, music: 1, sfx: 1, voice: 0 });
    expect(set).not.toHaveBeenCalled();
    r.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls[0][0].audio.voice).toBe(0);
  });
  it('Voice captions are off by default, persist on change, and say what they show (D8)', () => {
    const { d, set } = deps();
    const { el } = settingsPanel(document.body, d);
    const cb = el.querySelector<HTMLInputElement>('input[name="captions"]');
    if (!cb) throw new Error('no captions box');
    expect(cb.checked).toBe(false);
    expect(el.textContent).toContain('Voice captions');
    expect(el.textContent).toContain('in English');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set.mock.calls[0][0].accessibility.captions).toBe(true);
  });
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **`settings.ts`:** `audio: { master; music; sfx; voice: number }` and `accessibility: { motion; colorVision; captions: boolean }`. The defaults are `voice: 1` and `captions: false`. The parse reads `voice: unit(audio.voice, d.audio.voice)` and `captions: bool(acc.captions, false)`.
  - **`settings-panel.ts`:** `live`'s key union gains `'voice'`, and the audio loop gains `['voice', t('settings.audio.voice')]` after `sfx`. The Accessibility section gains, after colour vision, `row(table, t('settings.captions'), checkbox('captions', s.accessibility.captions, (v) => update((n) => { n.accessibility.captions = v; })), t('settings.captions.hint'))`.
  - **`en.json`**, beside their neighbours:

```json
  "settings.audio.voice": "Voices",
  "settings.captions": "Voice captions",
  "settings.captions.hint": "Shows what a unit’s radio line means, in English, above the orders.",
  "hud.caption.label": "Unit radio",
```

- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Default `captions` to `true`. Both D8 tests go red.
  - (b) Drop `voice` from the parse, so it always takes the default. The `voice: 0` assertion goes red.
  - (c) Leave the `voice` row out of the panel. The slider test goes red.

  Commit the five paths with the message `feat(settings): a Voices slider and voice captions, off by default (WP-AU1 T6)`.

---

### Task 7: The director, orders: one line per gesture, ranked by the cursor

**Model:** sonnet. Pure (spec §2; N1, N2, N3; R-3, R-4, R-5, R-12, R-13, R-17).

**Files:**
- Create: `packages/app/src/voice/director.ts`, `packages/app/src/voice/director.test.ts`
- Modify: `packages/app/src/input/cursor.ts` (export `idsOf`; no behaviour change)

**Interfaces (Tasks 8, 9 and 11 consume these):**

```ts
export interface VoiceCue {
  key: string;
  lang: string;
  speaker: VoiceClass;
  trigger: LineTrigger;
  priority: VoicePriority; // from @lions/render
  at: { x: number; y: number } | null;
}
export interface Gesture { intents: readonly PlayerIntent[]; hostile: boolean }
export interface DirectorLook {
  unitOf(id: number): { faction: string; voice: VoiceClass } | null;
  side(id: number): number;
  pos(id: number): { x: number; y: number };
  isVisible(x: number, y: number): boolean;
  camera(): { x: number; y: number };
}
export interface DirectorState {
  readonly run: { readonly verb: OrderVerb; readonly sel: string; readonly openedMs: number; readonly count: number } | null;
  readonly spoke: Readonly<Record<string, number>>; // `${lang}.${class}` → ms of its last line
  readonly kdfDeathByClass: Readonly<Record<string, number>>;
  readonly kdfDeathAt: number;
  readonly enemyDeathAt: number;
}
export type Why = 'line' | 'ack:repeat' | 'ack:cooldown' | 'silent:repeat' | 'silent:unvoiced' | 'silent:throttle' | 'silent:unseen' | 'silent:far';
export const VOICE_TIMING: { repeatWindowMs: 4000; classCooldownMs: 1500; kdfDeathClassMs: 4000; kdfDeathGlobalMs: 2500; enemyDeathGlobalMs: 6000; enemyDeathTiles: 18 };
export const INITIAL_DIRECTOR: DirectorState; // deeply frozen
export function gestureVerb(g: Gesture): { verb: OrderVerb; ids: readonly number[] } | null;
export function speakerOf(ids: readonly number[], look: DirectorLook, languages: Readonly<Record<string, string>>): { cls: VoiceClass; lang: string } | null;
export function decideOrder(s: DirectorState, g: Gesture, look: DirectorLook, languages: Readonly<Record<string, string>>, nowMs: number):
  { state: DirectorState; cue: VoiceCue | null; why: Why; trigger: OrderVerb | null };
```

- [ ] **Step 1: Write the failing tests.** Create `director.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PlayerIntent } from '../input/intents';
import { cursorFor } from '../input/cursor';
import { INITIAL_DIRECTOR, VOICE_TIMING, decideOrder, gestureVerb, type DirectorLook, type DirectorState, type Gesture } from './director';
import type { OrderVerb, VoiceClass } from './lines';

const LANGS = { kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' };
const UNITS: Record<number, { faction: string; voice: VoiceClass } | undefined> = {
  1: { faction: 'kdf', voice: 'infantry' },
  2: { faction: 'kdf', voice: 'infantry' },
  3: { faction: 'kdf', voice: 'crew' },
  4: { faction: 'kdf', voice: 'crew' },
  5: { faction: 'kdf', voice: 'engineer' },
  6: { faction: 'kdf', voice: 'air' },
  7: { faction: 'civilian', voice: 'infantry' },
};
const look: DirectorLook = {
  unitOf: (id) => UNITS[id] ?? null,
  side: () => 0,
  pos: () => ({ x: 0, y: 0 }),
  isVisible: () => true,
  camera: () => ({ x: 0, y: 0 }),
};
const order = (...ids: number[]): PlayerIntent => ({ kind: 'order', verb: 'attackMove', ids, x: 10, y: 10, append: false });
const g = (intents: PlayerIntent[], hostile = false): Gesture => ({ intents, hostile });
const once = (gesture: Gesture) => decideOrder(INITIAL_DIRECTOR, gesture, look, LANGS, 0);
/** A running director: each call advances its state. */
function director() {
  let s: DirectorState = INITIAL_DIRECTOR;
  return (ms: number, gesture: Gesture): [string, string | null] => {
    const d = decideOrder(s, gesture, look, LANGS, ms);
    s = d.state;
    return [d.why, d.cue?.key ?? null];
  };
}

describe('one line per gesture, ranked by the cursor (N1, R-4)', () => {
  it('a right-click that demolishes, garrisons and attack-moves at once says one thing: the demolition', () => {
    const d = once(g([{ kind: 'demolish', ids: [5], structure: 9 }, { kind: 'garrison', ids: [1], structure: 9 }, order(3, 4)], true));
    expect(d.cue?.key).toBe('he.engineer.task');
    expect(d.cue?.priority).toBe('order');
    expect(d.cue?.at).toBeNull();
    expect(d.why).toBe('line');
  });

  const POINTER: [string, PlayerIntent[], boolean, OrderVerb, string][] = [
    ['a plain order over open ground', [order(1)], false, 'move', 'he.infantry.move'],
    ['a plain order over a hostile', [order(1)], true, 'attack', 'he.infantry.attack'],
    ['attack outranks garrison', [{ kind: 'garrison', ids: [1], structure: 2 }, order(3)], true, 'attack', 'he.crew.attack'],
    ['garrison outranks a plain move', [{ kind: 'garrison', ids: [1], structure: 2 }, order(3)], false, 'garrison', 'he.common.garrison'],
    ['charge outranks attack', [{ kind: 'chargeTunnel', ids: [5], tunnel: 1 }, order(1)], true, 'charge', 'he.common.charge'],
    ['mount', [{ kind: 'mount', riders: [1], carrier: 3 }], false, 'mount', 'he.common.mount'],
    ['dismount', [{ kind: 'dismount', carriers: [3] }], false, 'dismount', 'he.common.dismount'],
    ['smoke', [{ kind: 'smoke', ids: [3], x: 1, y: 1 }], false, 'smoke', 'he.common.smoke'],
  ];

  it.each(POINTER)('%s', (_label, intents, hostile, verb, key) => {
    const d = once(g(intents, hostile));
    expect(d.trigger).toBe(verb);
    expect(d.cue?.key).toBe(key);
  });

  it('says what the cursor shows, for every pointer gesture', () => {
    for (const [label, intents, hostile, verb] of POINTER) {
      const shown = cursorFor({ intents, roe: 'free', marker: false }, { hostile, blocked: false });
      expect(gestureVerb(g(intents, hostile))?.verb, label).toBe(shown);
      expect(shown, label).toBe(verb);
    }
  });

  it('halt, which only a key issues, has a line of its own', () => {
    expect(once(g([{ kind: 'halt', ids: [1, 2] }])).cue?.key).toBe('he.common.halt');
  });

  it('selection, groups, the overlay and support calls are silent, and so is an order for nobody', () => {
    for (const intents of [
      [{ kind: 'select', ids: [1], via: 'click' }],
      [{ kind: 'group', slot: 1, action: 'recall' }],
      [{ kind: 'overlay', on: true }],
      [{ kind: 'support', call: 'strike', x: 1, y: 1, accepted: true }],
      [order()],
    ] as PlayerIntent[][]) {
      const d = once(g(intents));
      expect(d.cue).toBeNull();
      expect(d.why).toBe('silent:unvoiced');
    }
  });
});

describe('the speaker (spec §2, R-5)', () => {
  it('is the class with the most units in the winning intent', () => {
    expect(once(g([order(1, 3, 4)])).cue?.key).toBe('he.crew.move');
  });
  it('breaks a tie by who was selected first', () => {
    expect(once(g([order(3, 1)])).cue?.key).toBe('he.crew.move');
    expect(once(g([order(1, 3)])).cue?.key).toBe('he.infantry.move');
  });
  it('engineers move as engineers and attack from the infantry pool', () => {
    expect(once(g([order(5)])).cue?.key).toBe('he.engineer.move');
    expect(once(g([order(5)], true)).cue?.key).toBe('he.infantry.attack');
    expect(once(g([order(6)])).cue?.key).toBe('he.air.move');
  });
  it('a faction with no language never speaks (D10)', () => {
    expect(once(g([order(7)])).why).toBe('silent:unvoiced');
  });
});

describe('the repeat window and the class cooldown (N2, N3, R-12, R-13)', () => {
  it('the same verb and selection: a line, an ack, then silence until 4 s from the first', () => {
    const at = director();
    expect(at(0, g([order(1, 2)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(1000, g([order(2, 1)]))).toEqual(['ack:repeat', 'he.common.ack']); // same set, any order
    expect(at(2000, g([order(1, 2)]))).toEqual(['silent:repeat', null]);
    expect(at(3999, g([order(1, 2)]))).toEqual(['silent:repeat', null]);
    expect(at(VOICE_TIMING.repeatWindowMs, g([order(1, 2)]))).toEqual(['line', 'he.infantry.move']);
  });

  it('a different selection or verb is not a repeat', () => {
    const at = director();
    expect(at(0, g([order(1, 2)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(5000, g([order(1)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(10_000, g([order(1)], true))).toEqual(['line', 'he.infantry.attack']);
  });

  it('a class that spoke under 1.5 s ago answers from ack; another class answers in full', () => {
    const at = director();
    expect(at(0, g([order(1)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(100, g([order(3)]))).toEqual(['line', 'he.crew.move']);
    expect(at(1000, g([order(2)], true))).toEqual(['ack:cooldown', 'he.common.ack']);
    expect(at(2499, g([order(1, 2)]))).toEqual(['ack:cooldown', 'he.common.ack']); // the ack at 1000 was speech too
    expect(at(4000, g([order(2)]))).toEqual(['line', 'he.infantry.move']);
  });

  it('the cooldown ends at exactly 1.5 s', () => {
    const at = director();
    expect(at(0, g([order(1)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(VOICE_TIMING.classCooldownMs, g([order(2)]))).toEqual(['line', 'he.infantry.move']);
  });

  it('never mutates the state it is given', () => {
    expect(Object.isFrozen(INITIAL_DIRECTOR)).toBe(true);
    expect(Object.isFrozen(INITIAL_DIRECTOR.spoke)).toBe(true);
    expect(() => once(g([order(1)]))).not.toThrow();
    expect(INITIAL_DIRECTOR.run).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement.** In `cursor.ts`, change `function idsOf` to `export function idsOf`. In `director.ts`:

```ts
export function gestureVerb(g: Gesture): { verb: OrderVerb; ids: readonly number[] } | null {
  const pick = (kind: PlayerIntent['kind'], verb: OrderVerb): { verb: OrderVerb; ids: readonly number[] } | null => {
    const i = g.intents.find((x) => x.kind === kind);
    return i ? { verb, ids: idsOf(i) } : null;
  };
  // The cursor's own ranking, called literally (R-4): the voice says what the cursor promised.
  switch (winningVerb({ intents: [...g.intents], roe: 'free', marker: false }, { hostile: g.hostile, blocked: false })) {
    case 'demolish': return pick('demolish', 'demolish');
    case 'charge': return pick('chargeTunnel', 'charge');
    case 'attack': return pick('order', 'attack');
    case 'garrison': return pick('garrison', 'garrison');
    case 'mount': return pick('mount', 'mount');
    case 'dismount': return pick('dismount', 'dismount');
    case 'smoke': return pick('smoke', 'smoke');
    default: return pick('order', 'move') ?? pick('halt', 'halt');
  }
}
```

  **`speakerOf`** counts classes over `ids`, recording each class's first index and faction. The highest count wins; a tie goes to the lower first index. The language is `languageOf(winner's faction)`, and `null` means silent.

  **`decideOrder`:**
  1. Find the verb and the speaker. If either is missing, or the ids are empty, return `silent:unvoiced`.
  2. `sel` is the sorted ids joined with `,`.
  3. The run is the previous run with `count + 1` if the verb and `sel` match and `nowMs - openedMs < repeatWindowMs`. Otherwise it is a fresh run with count 1.
  4. `count >= 3` → `silent:repeat`, with no cue and the state carrying the run.
  5. Otherwise the line is an ack if `count === 2` (`ack:repeat`) or `nowMs - spoke[lang.cls] < classCooldownMs` (`ack:cooldown`). Otherwise it is `line`.
  6. The cue's key is `ackLineKey(lang)` or `orderLineKey(lang, cls, verb)`, and its trigger is `'ack'` or `lineTriggerOf(verb)`. The priority is `'order'` and `at` is `null`.
  7. The new state stamps `spoke[lang.cls] = nowMs`.

  `INITIAL_DIRECTOR` is `Object.freeze({ run: null, spoke: Object.freeze({}), kdfDeathByClass: Object.freeze({}), kdfDeathAt: Number.NEGATIVE_INFINITY, enemyDeathAt: Number.NEGATIVE_INFINITY })`. Every update spreads into a new object and never writes in place.
- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Replace the `winningVerb` call with `null`. The ranking table and the cursor test go red.
  - (b) Break ties by the last index. The tie test goes red.
  - (c) Silence at `count >= 4`. The N2 test goes red at 2000.
  - (d) Use `<=` for the cooldown. The 1.5 s boundary test goes red.

  Commit the three paths with the message `feat(voice): the director answers a gesture with one line, ranked by the cursor (WP-AU1 T7)`.

---

### Task 8: The director, deaths: KDF calls and seen enemy deaths

**Model:** sonnet. Pure (spec §2; N6, N7; D6, D10; R-12, R-14).

**Files:**
- Modify: `packages/app/src/voice/director.ts`, `packages/app/src/voice/director.test.ts`

**Interfaces:**
- `function decideDeaths(s: DirectorState, events: readonly SimEvent[], look: DirectorLook, languages: Readonly<Record<string, string>>, nowMs: number): { state: DirectorState; notes: { why: Why; cue: VoiceCue | null }[] }`
- A note exists for each `destroyed` unit of a *voiced* faction that the tick considered. Civilians, `removed` and non-`destroyed` events produce no note.

- [ ] **Step 1: Write the failing tests.** Append the following to `director.test.ts`, adding `decideDeaths` to the import and `import type { SimEvent } from '@lions/sim';`:

```ts
describe('death calls (N6, N7, D6, D10)', () => {
  const DEATH_UNITS: Record<number, { faction: string; voice: VoiceClass } | undefined> = {
    ...UNITS,
    10: { faction: 'sarim', voice: 'crew' },
    11: { faction: 'ashwar', voice: 'infantry' },
    12: { faction: 'civilian', voice: 'infantry' },
    13: { faction: 'ashwar', voice: 'infantry' },
    14: { faction: 'ashwar', voice: 'infantry' },
  };
  const SIDE: Record<number, number> = { 10: 1, 11: 1, 12: 2, 13: 1, 14: 1 };
  const POS: Record<number, { x: number; y: number } | undefined> = {
    10: { x: 5, y: 5 }, 11: { x: 30, y: 0 }, 13: { x: 18, y: 0 }, 14: { x: 18.01, y: 0 },
  };
  const deathLook = (over: Partial<DirectorLook> = {}): DirectorLook => ({
    unitOf: (id) => DEATH_UNITS[id] ?? null,
    side: (id) => SIDE[id] ?? 0,
    pos: (id) => POS[id] ?? { x: 0, y: 0 },
    isVisible: () => true,
    camera: () => ({ x: 0, y: 0 }),
    ...over,
  });
  const destroyed = (entity: number): SimEvent => ({ kind: 'destroyed', tick: 1, entity, by: 99 });
  const removed = (entity: number, side: number): SimEvent => ({ kind: 'removed', tick: 1, entity, side });
  function deaths(lk: DirectorLook = deathLook()) {
    let s: DirectorState = INITIAL_DIRECTOR;
    return (ms: number, ...ids: number[]): [string, string | null][] => {
      const d = decideDeaths(s, ids.map(destroyed), lk, LANGS, ms);
      s = d.state;
      return d.notes.map((n) => [n.why, n.cue?.key ?? null]);
    };
  }

  it('a KDF death is a radio call from its class pool: unplaced, KDF priority', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(1)], deathLook(), LANGS, 0);
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0]?.cue).toEqual({
      key: 'he.infantry.death', lang: 'he', speaker: 'infantry', trigger: 'death', priority: 'kdf_death', at: null,
    });
  });

  it('many KDF deaths in one tick are one call (N6)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(1), destroyed(3), destroyed(5)], deathLook(), LANGS, 0);
    expect(d.notes.filter((n) => n.cue !== null).map((n) => n.cue?.key)).toEqual(['he.infantry.death']);
  });

  it('4 s per class and 2.5 s across all KDF (N6)', () => {
    const at = deaths();
    expect(at(0, 1)).toEqual([['line', 'he.infantry.death']]);
    expect(at(1000, 3)).toEqual([['silent:throttle', null]]); // global
    expect(at(2600, 1)).toEqual([['silent:throttle', null]]); // infantry's own 4 s
    expect(at(2600, 3)).toEqual([['line', 'he.crew.death']]);
    expect(at(4000, 1)).toEqual([['silent:throttle', null]]); // global, from 2600
    expect(at(5100, 1)).toEqual([['line', 'he.infantry.death']]);
  });

  it('a salvo whose first death is throttled still gets its one call from the next', () => {
    const at = deaths();
    expect(at(0, 1)).toEqual([['line', 'he.infantry.death']]);
    expect(at(2600, 1, 3)).toEqual([['silent:throttle', null], ['line', 'he.crew.death']]);
  });

  it('an enemy death speaks Arabic, placed where it fell, at enemy priority (D6, R-14)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(10)], deathLook(), LANGS, 0);
    expect(d.notes[0]?.cue).toEqual({
      key: 'ar.crew.death', lang: 'ar', speaker: 'crew', trigger: 'death', priority: 'enemy_death', at: { x: 5, y: 5 },
    });
  });

  it('only when the player can see it, and within 18 tiles of the camera (N7)', () => {
    expect(deaths(deathLook({ isVisible: () => false }))(0, 10)).toEqual([['silent:unseen', null]]);
    expect(deaths()(0, 11)).toEqual([['silent:far', null]]);
    expect(deaths()(0, 13)).toEqual([['line', 'ar.infantry.death']]); // exactly 18
    expect(deaths()(0, 14)).toEqual([['silent:far', null]]);
  });

  it('one enemy call per 6 s (N7)', () => {
    const at = deaths();
    expect(at(0, 10)).toEqual([['line', 'ar.crew.death']]);
    expect(at(5999, 10)).toEqual([['silent:throttle', null]]);
    expect(at(VOICE_TIMING.enemyDeathGlobalMs, 10)).toEqual([['line', 'ar.crew.death']]);
  });

  it('a KDF death and an enemy death in one tick are two calls; the mixer arbitrates', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(10), destroyed(1)], deathLook(), LANGS, 0);
    expect(d.notes.map((n) => n.cue?.priority)).toEqual(['enemy_death', 'kdf_death']);
  });

  it('civilians and removals are silent, and leave no note (D10: an abduction is not a death)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(12), removed(1, 0)], deathLook(), LANGS, 0);
    expect(d.notes).toEqual([]);
  });

  it('a death call is speech: it holds its class’s order cooldown too (R-12)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(1)], deathLook(), LANGS, 0);
    expect(decideOrder(d.state, g([order(2)]), look, LANGS, 500).why).toBe('ack:cooldown');
  });
});
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** `decideDeaths`. Walk the events in order, looking only at `kind === 'destroyed'`. Look up `unitOf(entity)` and `languageOf`; with no unit or no language, skip without a note.
  - **Side 0.** Skip the event, without a note, once this tick has spoken for KDF. Throttle with a note if `now - kdfDeathAt < kdfDeathGlobalMs` or `now - kdfDeathByClass[cls] < kdfDeathClassMs`. Otherwise speak: the cue is `deathLineKey`, `kdf_death`, `at: null`. Stamp `kdfDeathAt`, `kdfDeathByClass[cls]` and `spoke[lang.cls]`.
  - **Any other side.** Skip the event once this tick has spoken for the enemy. Then check, in this order:
    1. the global throttle, `enemyDeathGlobalMs`, which notes `silent:throttle`;
    2. `isVisible(pos)`, which notes `silent:unseen`;
    3. `Math.hypot(pos - camera) > enemyDeathTiles`, which notes `silent:far`.

    Otherwise speak: the cue is `deathLineKey`, `enemy_death`, `at: pos`. Stamp `enemyDeathAt` and `spoke[lang.cls]`.
- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Drop the one-KDF-call-per-tick guard. The N6 salvo test goes red.
  - (b) Drop the visibility check. The unseen case goes red.
  - (c) Use `>=` for the 18-tile edge. The exactly-18 case goes red.
  - (d) Do not stamp `spoke`. The R-12 test goes red.

  Commit both paths with the message `feat(voice): death calls -- one KDF call a tick, enemy deaths only when seen (WP-AU1 T8)`.

---

### Task 9: The voice runtime: the gesture boundary, play, caption and a dev note once

**Model:** opus. It owns the gesture boundary and what happens after a leave (lifecycle; R-3, R-9, R-10, R-17).

**Files:**
- Create: `packages/app/src/voice/voice-runtime.ts`, `packages/app/src/voice/voice-runtime.test.ts`

**Interfaces (Task 11 consumes these):**

```ts
export interface VoiceRuntimeDeps {
  now(): number;                                   // performance.now in the app (R-17)
  schedule(fn: () => void): void;                  // queueMicrotask in the app
  look: DirectorLook;
  languages: Readonly<Record<string, string>>;
  play(cue: VoiceCue): VoiceResult;                // battleAudio().playVoice
  caption(text: string, seconds: number): void;    // no-op unless captions are on
  info(message: string): void;                     // console.info in dev, a no-op in production
}
export interface VoiceLogEntry {
  at: number; source: 'order' | 'death'; trigger: string | null; key: string | null; why: Why; status: VoiceStatus | null;
}
export const VOICE_LOG_SIZE = 64;
export class VoiceRuntime {
  constructor(deps: VoiceRuntimeDeps);
  hint(h: { hostile: boolean }): void;
  observe(intent: PlayerIntent): void;
  onTick(events: readonly SimEvent[]): void;
  log(): VoiceLogEntry[];
  dispose(): void;
}
export function voicePlaceholderOn(params: URLSearchParams, dev: boolean): boolean;
```

- [ ] **Step 1: Write the failing tests.** Create `voice-runtime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@lions/sim';
import type { VoiceResult } from '@lions/render';
import type { PlayerIntent } from '../input/intents';
import type { DirectorLook, VoiceCue } from './director';
import type { VoiceClass } from './lines';
import { VOICE_LOG_SIZE, VoiceRuntime, voicePlaceholderOn, type VoiceRuntimeDeps } from './voice-runtime';

const LANGS = { kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' };
const UNITS: Record<number, { faction: string; voice: VoiceClass } | undefined> = {
  1: { faction: 'kdf', voice: 'infantry' },
  3: { faction: 'kdf', voice: 'crew' },
  5: { faction: 'kdf', voice: 'engineer' },
};
const look: DirectorLook = {
  unitOf: (id) => UNITS[id] ?? null,
  side: () => 0,
  pos: () => ({ x: 0, y: 0 }),
  isVisible: () => true,
  camera: () => ({ x: 0, y: 0 }),
};
const order = (...ids: number[]): PlayerIntent => ({ kind: 'order', verb: 'attackMove', ids, x: 1, y: 1, append: false });
const MISSING: VoiceResult = { status: 'missing', seconds: 0, en: null, cut: 0 };

function rig(over: Partial<VoiceRuntimeDeps> = {}) {
  const queued: (() => void)[] = [];
  const played: VoiceCue[] = [];
  const infos: string[] = [];
  const captions: [string, number][] = [];
  let now = 0;
  let result: VoiceResult = MISSING;
  const rt = new VoiceRuntime({
    now: () => now,
    schedule: (fn) => void queued.push(fn),
    look,
    languages: LANGS,
    play: (c) => {
      played.push(c);
      return result;
    },
    caption: (t, s) => void captions.push([t, s]),
    info: (m) => void infos.push(m),
    ...over,
  });
  const flush = (): void => {
    for (let fn = queued.shift(); fn; fn = queued.shift()) fn();
  };
  return {
    rt, flush, played, infos, captions, queued,
    setNow: (n: number): void => { now = n; },
    setResult: (r: VoiceResult): void => { result = r; },
  };
}

describe('VoiceRuntime (WP-AU1 §7, R-3)', () => {
  it('coalesces one gesture’s intents into one cue, on one scheduled flush', () => {
    const r = rig();
    r.rt.hint({ hostile: true });
    r.rt.observe({ kind: 'demolish', ids: [5], structure: 9 });
    r.rt.observe({ kind: 'garrison', ids: [1], structure: 9 });
    r.rt.observe(order(3));
    expect(r.queued).toHaveLength(1);
    expect(r.played).toEqual([]);
    r.flush();
    expect(r.played.map((c) => c.key)).toEqual(['he.engineer.task']);
  });

  it('a hint belongs to its own gesture and no other', () => {
    const r = rig();
    r.rt.hint({ hostile: true });
    r.rt.observe(order(1));
    r.flush();
    r.setNow(10_000);
    r.rt.observe(order(3));
    r.flush();
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.attack', 'he.crew.move']);
  });

  it('a selection plays nothing and logs nothing', () => {
    const r = rig();
    r.rt.observe({ kind: 'select', ids: [1], via: 'click' });
    r.flush();
    expect(r.played).toEqual([]);
    expect(r.rt.log()).toEqual([]);
  });

  it('a missing line is noted ONCE, as information, and never called an error (R-9)', () => {
    const r = rig();
    r.rt.observe(order(1));
    r.flush();
    r.setNow(10_000);
    r.rt.observe(order(3, 1)); // a tie: the first selected, crew, speaks
    r.flush();
    r.setNow(20_000);
    r.rt.observe(order(1));
    r.flush();
    expect(r.infos).toHaveLength(2); // he.infantry.move once, he.crew.move once
    expect(r.infos[0]).toContain('he.infantry.move');
    for (const m of r.infos) expect(m).not.toMatch(/error|fail|warn/i);
    expect(r.rt.log().map((e) => e.status)).toEqual(['missing', 'missing', 'missing']);
  });

  it('captions a played line with its meaning and length, and nothing else (D8)', () => {
    const r = rig();
    r.setResult({ status: 'played', seconds: 1.2, en: 'moving', cut: 0 });
    r.rt.observe(order(1));
    r.flush();
    r.setResult({ status: 'placeholder', seconds: 0.12, en: null, cut: 0 });
    r.setNow(10_000);
    r.rt.observe(order(3));
    r.flush();
    expect(r.captions).toEqual([['moving', 1.2]]);
  });

  it('logs every voiced decision, silent ones included, for __lions.voiceLog()', () => {
    const r = rig();
    for (const ms of [0, 1000, 2000]) {
      r.setNow(ms);
      r.rt.observe(order(1));
      r.flush();
    }
    expect(r.rt.log().map((e) => [e.source, e.trigger, e.key, e.why])).toEqual([
      ['order', 'move', 'he.infantry.move', 'line'],
      ['order', 'move', 'he.common.ack', 'ack:repeat'],
      ['order', 'move', null, 'silent:repeat'],
    ]);
    expect(r.rt.log()[2]?.status).toBeNull();
  });

  it('hears deaths from the tick', () => {
    const r = rig();
    const dead: SimEvent = { kind: 'destroyed', tick: 1, entity: 1, by: 9 };
    r.rt.onTick([dead]);
    expect(r.played.map((c) => c.key)).toEqual(['he.infantry.death']);
    expect(r.rt.log()[0]).toMatchObject({ source: 'death', trigger: 'death', why: 'line' });
  });

  it('keeps the last 64 entries', () => {
    const r = rig();
    for (let i = 0; i < VOICE_LOG_SIZE + 10; i++) {
      r.setNow(i * 10_000);
      r.rt.observe(order(1));
      r.flush();
    }
    expect(r.rt.log()).toHaveLength(VOICE_LOG_SIZE);
  });

  it('after dispose, a gesture already in flight and a later tick both play nothing', () => {
    const r = rig();
    r.rt.observe(order(1));
    r.rt.dispose();
    r.flush();
    r.rt.onTick([{ kind: 'destroyed', tick: 1, entity: 1, by: 9 }]);
    r.rt.observe(order(3));
    r.flush();
    expect(r.played).toEqual([]);
  });
});

describe('voicePlaceholderOn (R-10)', () => {
  it('only in a dev build, and only when asked', () => {
    expect(voicePlaceholderOn(new URLSearchParams('voicetick'), true)).toBe(true);
    expect(voicePlaceholderOn(new URLSearchParams('voicetick'), false)).toBe(false);
    expect(voicePlaceholderOn(new URLSearchParams(''), true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement.** The class holds the director state, a pending intent list, the pending `hostile`, a `scheduled` flag, a `disposed` flag, the log ring and a `Set` of keys already reported.
  - **`hint`** stores `hostile` and arms a flush.
  - **`observe`** returns if disposed. Otherwise it pushes the intent and arms a flush.
  - **Arming** calls `deps.schedule(flush)` once per gesture.
  - **The flush** clears `scheduled`, takes the intents, and resets `hostile` to `false`. It returns if disposed or if there are no intents. Otherwise it calls `decideOrder`, stores the state, and returns on `silent:unvoiced` without a log entry. Otherwise it calls `speak('order', verb, cue, why)`.
  - **`onTick`** returns if disposed. Otherwise it calls `decideDeaths`, stores the state, and calls `speak('death', 'death', …)` for each note.
  - **`speak`** plays the cue if there is one. On `missing`, and only the first time for that key, it calls `deps.info(`[voice] ${key}: no decoded line (not recorded yet, or still decoding), so nothing plays`)`. On `played` with an `en`, it calls `deps.caption(en, seconds)`. It then pushes `{ at, source, trigger, key, why, status }` and trims the ring to `VOICE_LOG_SIZE`.
  - **`log()`** returns copies.
  - **`dispose()`** sets the flag and drops the pending intents.
  - **`voicePlaceholderOn`** is `dev && params.has('voicetick')`.
- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Flush synchronously in `observe`. The coalescing test goes red with three cues.
  - (b) Do not reset `hostile` in the flush. The hint test goes red on `he.crew.attack`.
  - (c) Drop the once-per-key `Set`. The info count goes to 3, red.
  - (d) Drop the disposed check in the flush. The dispose test goes red.

  Commit both paths with the message `feat(voice): the runtime -- a gesture is one task, a missing line is a note, not an error (WP-AU1 T9)`.

---

### Task 10: The caption slot (D8)

**Model:** sonnet. A DOM builder whose timer dies with it (R-18).

**Files:**
- Create: `packages/app/src/ui/voice-caption.ts`, `packages/app/src/ui/voice-caption.test.ts`
- Modify: `packages/app/src/ui/hud.ts`, `packages/app/src/ui/hud.test.ts`, `packages/app/src/ui/theme.css`

**Interfaces:**
- `const CAPTION_EXTRA_MS = 1000`
- `function captionHoldMs(seconds: number): number`
- `class VoiceCaption { readonly el: HTMLElement; show(text: string, seconds: number): void; clear(): void; dispose(): void }`
- `Hud.caption(text: string, seconds: number): void`

- [ ] **Step 1: Write the failing tests.** Create `voice-caption.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTION_EXTRA_MS, VoiceCaption, captionHoldMs } from './voice-caption';

afterEach(() => {
  vi.useRealTimers();
});

describe('the voice caption (WP-AU1 D8)', () => {
  it('holds a line for its length plus one second', () => {
    expect(captionHoldMs(1.2)).toBe(1200 + CAPTION_EXTRA_MS);
    expect(captionHoldMs(0)).toBe(CAPTION_EXTRA_MS);
    expect(captionHoldMs(-1)).toBe(CAPTION_EXTRA_MS);
  });

  it('starts hidden, shows the meaning, then clears itself', () => {
    vi.useFakeTimers();
    const c = new VoiceCaption();
    expect(c.el.hidden).toBe(true);
    c.show('moving', 1.2);
    expect([c.el.hidden, c.el.textContent]).toEqual([false, 'moving']);
    vi.advanceTimersByTime(2199);
    expect(c.el.textContent).toBe('moving');
    vi.advanceTimersByTime(1);
    expect([c.el.hidden, c.el.textContent]).toEqual([true, '']);
  });

  it('is one slot: a new line replaces the last and restarts the hold', () => {
    vi.useFakeTimers();
    const c = new VoiceCaption();
    c.show('moving', 1);
    vi.advanceTimersByTime(1500);
    c.show('copy', 1);
    vi.advanceTimersByTime(1500);
    expect(c.el.textContent).toBe('copy');
    vi.advanceTimersByTime(500);
    expect(c.el.hidden).toBe(true);
  });

  it('is a polite live region with a translated label, and never takes the pointer', () => {
    const c = new VoiceCaption();
    expect(c.el.getAttribute('role')).toBe('status');
    expect(c.el.getAttribute('aria-live')).toBe('polite');
    expect(c.el.getAttribute('aria-label')).toBe('Unit radio');
    expect(c.el.classList.contains('rl-caption')).toBe(true);
  });

  it('dispose takes its pending timer with it', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const c = new VoiceCaption();
    host.append(c.el);
    c.show('moving', 1);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(host.contains(c.el)).toBe(false);
  });
});
```

  Append the following to `hud.test.ts`, using its own `rig` and `mission` helpers:

```ts
describe('the voice caption slot (WP-AU1 D8)', () => {
  it('sits in the bottom stack right under the feed, never inside it', () => {
    const r = rig(mission());
    const feed = r.host.querySelector('.rl-feed');
    const cap = r.host.querySelector('.rl-caption');
    expect(cap?.parentElement?.classList.contains('rl-sel')).toBe(true);
    expect(feed?.nextElementSibling).toBe(cap);
    r.hud.caption('moving', 1);
    expect(cap?.textContent).toBe('moving');
    expect(feed?.textContent ?? '').not.toContain('moving');
  });

  it('goes down with the HUD', () => {
    const r = rig(mission());
    r.hud.caption('moving', 1);
    r.hud.destroy();
    expect(r.host.querySelector('.rl-caption')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **`VoiceCaption`** builds a `div.rl-caption.rl-plate` with `role="status"`, `aria-live="polite"`, `aria-label` set to `t('hud.caption.label')`, and `hidden = true`.
  - **`show`** stops any timer, sets the text, unhides the slot, and arms `window.setTimeout(clear, captionHoldMs(seconds))`.
  - **`clear`** stops the timer, empties the text, and hides the slot. **`dispose`** stops the timer and removes the element.
  - **`captionHoldMs`** is `Math.max(0, Math.round(seconds * 1000)) + CAPTION_EXTRA_MS`.
  - **In `Hud`:** add `private readonly captionBox = new VoiceCaption()`. Right after `this.sel.prepend(this.feed)`, add `this.feed.after(this.captionBox.el)`. Add `caption(text, seconds) { this.captionBox.show(text, seconds); }`, and call `this.captionBox.dispose()` first in `destroy()`.
  - **In `theme.css`**, after `.rl-notice`:

```css
/* --- voice caption (WP-AU1 D8) ------------------------------------------
   One slot under the notice feed, never inside it: the feed is for what
   happened, and a caption only repeats what a unit said. Off unless the
   player asks for it (Settings, Accessibility). */
.rl-caption {
  font-size: var(--t-read);
  font-style: italic;
  color: var(--ink);
  white-space: nowrap;
  pointer-events: none;
}
.rl-caption[hidden] {
  display: none;
}
```

- [ ] **Step 4: Gates, falsify, commit.** Each of these must be seen red, then undone:
  - (a) Drop `+ CAPTION_EXTRA_MS`. The hold tests go red.
  - (b) Append the caption into `this.feed`. The HUD test goes red.
  - (c) Leave the timer running in `dispose`. The timer-count test goes red.

  Commit the five paths with the message `feat(hud): a caption slot for unit voices, under the feed (WP-AU1 T10)`.

---

### Task 11: Wiring: the battlefield listens, speaks and reads back

**Model:** opus, because it touches `main.ts` and a mission's lifecycle (spec §7; N16; R-3, R-10, R-17).

**Files:**
- Modify: `packages/app/src/main.ts`, `packages/app/src/sandbox-help.ts`, `packages/app/src/sandbox-help.test.ts`

**Interfaces:**
- `KNOWN_PARAMS` gains `voicetick`.
- `window.__lions.voiceLog(): { entries: VoiceLogEntry[]; stats: VoiceStats }`

- [ ] **Step 1: Write the failing test.** Append the following to `sandbox-help.test.ts`:

```ts
describe('voicetick (WP-AU1 R-10)', () => {
  it('is a known URL parameter, never a Free play flag, and no typo warning', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('voicetick');
    expect(SANDBOX_FLAGS.map((f) => f.name as string)).not.toContain('voicetick');
    expect(unknownParams(new URLSearchParams('voicetick'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement.**
  - **`sandbox-help.ts`:** add `{ name: 'voicetick', blurb: 'dev builds only: a synth tick per voice line class where no line is recorded yet -- never shipped as a voice' }` to `KNOWN_PARAMS`.
  - **`main.ts`, `bootBattlefield`:**
    1. **Languages (N16).** Right after `meshRoster` is computed:

```ts
  // Only the roster's languages decode (N16). The roster is the one the mesh
  // plan already trusts; a unit it misses still plays -- as `missing` -- and
  // the dev note names the key.
  const voiceLangs = (audioManifest as AudioManifest).voices?.languages ?? {};
  const unitJson = units as Record<string, { id: string; faction: string; role: string; voice?: unknown } | undefined>;
  audio.setVoiceLanguages(rosterLanguages(meshRoster, (id) => unitJson[id]?.faction, voiceLangs));
  audio.setVoicePlaceholder(voicePlaceholderOn(params, import.meta.env.DEV));
```

    2. **The runtime.** Once `hud` exists and before the first `runTick`:

```ts
  const voice = new VoiceRuntime({
    now: () => performance.now(),
    schedule: (fn) => queueMicrotask(fn),
    languages: voiceLangs,
    look: {
      unitOf: (id) => {
        const u = unitJson[sim.unitTypes[sim.state.typeIdx[id]].id];
        return u ? { faction: u.faction, voice: voiceClassOf(u) } : null;
      },
      side: (id) => sim.state.side[id],
      pos: (id) => ({ x: fx.toNumber(sim.state.posX[id]), y: fx.toNumber(sim.state.posY[id]) }),
      isVisible: (x, y) => renderer.isVisible(x, y),
      camera: () => renderer.camera,
    },
    play: (cue) => audio.playVoice({ key: cue.key, priority: cue.priority, at: cue.at ?? undefined }),
    caption: (text, seconds) => {
      if (req.settings.get().accessibility.captions) hud.caption(text, seconds);
    },
    info: import.meta.env.DEV ? (m) => console.info(m) : () => {},
  });
  intentListeners.push((intent) => voice.observe(intent));
  onDispose(() => {
    voice.dispose();
    audio.stopVoices();
    audio.setVoicePlaceholder(false);
  });
```

    3. **The hostile hint (R-3).** In the `contextmenu` handler, before `issueOrder`, call `voice.hint({ hostile: renderer.hoverEntity >= 0 })`. In pointerup's armed attack-move branch, make the same call before its dispatch loop. In the minimap's `order:` closure, call `voice.hint({ hostile: false })` before `issueOrder`.
    4. **Deaths.** In `runTick`, right after `audio.onEvents(events, sim)`, call `voice.onTick(events)`.
    5. **The read-back.** Add to `__lions`: `voiceLog: () => ({ entries: voice.log(), stats: audio.voiceStats() })`. It reads the runtime's ring and the MIXER's own stats, not a recomputation.
- [ ] **Step 4: Verify by hand, then gates and commit.**
  - Run `pnpm dev -- --port=5197` and open `http://localhost:5197/free-play/beit_sahwan_outskirts?voicetick`.
  - Select a unit by dragging, right-click the ground, and hear the tick. Press `h` and hear a second.
  - In the console, `__lions.voiceLog()` shows two `order` entries with status `placeholder`.
  - Without `?voicetick`, the same right-click logs `missing` and prints the one `[voice]` info line per key, with no warning.
  - Stop the server you started with its own Ctrl-C.

  The browser falsification of this wiring is Task 12's; its mutations (a)–(d) are all edits to this file. Run the gates line plus `pnpm test:determinism`: it must be unchanged, because the sim is untouched. Commit the three paths with the message `feat(voice): the battlefield answers orders and calls its dead (WP-AU1 T11)`. The body names R-3, R-10 and N16.

---

### Task 12: `ui:routes` legs: one voice per gesture, a throttled repeat, silence at 0

**Model:** sonnet. Harness code (spec §9 item 11; the brief's item 9).

**Files:**
- Modify: `tools/src/ui-review/routes-check.ts`

- [ ] **Step 1: Write the legs.** Add the import `import { PLACEHOLDER_HZ } from '../../../packages/render/src/audio';`. Then add this block after the garage's first-Buy leg, reusing its `AUDIO_RECORDER`. Add one header line: `// Plus (WP-AU1 T12): a voiced order is one event per gesture, a burst is throttled, and Voices at 0 plays nothing.`

```ts
  // --- unit voices (WP-AU1 T12, spec §2 N1 N2, §7) ---------------------------
  //
  // Driven with `?voicetick`, the dev-only placeholder (R-10): no voice line
  // is recorded yet, so without it every gesture plays nothing and "nothing
  // plays at Voices 0" could not fail. Each placeholder is ONE oscillator at a
  // frequency nothing else here uses, so the recorder can count voices apart
  // from the battle synth. `sel`/`goto` choose WHERE to look; every order is a
  // real input event through the real handler.
  {
    const VOICE_HZ = new Set<number>(Object.values(PLACEHOLDER_HZ));
    type VoiceEntry = { source: string; trigger: string | null; key: string | null; why: string; status: string | null };
    type VoiceRead = { entries: VoiceEntry[]; placeholder: boolean; osc: (number | null)[]; constructed: number };
    const VOICE_READ =
      '(() => { var log = window.__lions.voiceLog(); return { entries: log.entries,' +
      ' placeholder: log.stats.placeholder, osc: window.__rlAudio.osc.map(function (r) { return r.f; }),' +
      ' constructed: window.__rlAudio.constructed }; })()';
    const tones = (r: VoiceRead): number[] => r.osc.filter((f): f is number => f !== null && VOICE_HZ.has(f));

    const vCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await vCtx.addInitScript(AUDIO_RECORDER);
    const v = await vCtx.newPage();
    v.setDefaultTimeout(ACTION_TIMEOUT_MS);
    v.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    v.on('pageerror', (e) => errors.push(String(e)));
    await v.goto(`http://localhost:${PORT}/free-play/beit_sahwan_outskirts?voicetick`, { waitUntil: 'load' });
    await v.waitForFunction('window.__lions !== undefined', null, { timeout: 90_000 });
    const read = (): Promise<VoiceRead> => v.evaluate<VoiceRead>(VOICE_READ);

    const booted = await read();
    console.log(`[${TAG}] voices at boot: placeholder=${booted.placeholder} contexts=${booted.constructed}`);
    expect(booted.placeholder, 'voices: ?voicetick did not reach the mixer -- the legs below would test nothing (R-10)');
    expect(booted.constructed === 0, `voices: ${booted.constructed} AudioContext(s) on a mission before any gesture`);

    const units = await v.evaluate<{ id: number; type: string; x: number; y: number }[]>('window.__lions.units()');
    const inf = units.find((u) => u.type === 'inf_squad');
    const lavi = units.find((u) => u.type === 'mbt_lavi');
    if (!inf || !lavi) throw new Error(`[${TAG}] voices: the sandbox force has no inf_squad or no mbt_lavi`);
    /** Centre the camera on `at`, select `ids`, and return `at`'s page point. */
    const aim = (ids: number[], at: { x: number; y: number }): Promise<{ x: number; y: number }> =>
      v.evaluate(
        ({ ids, at }) => {
          const L = (window as unknown as {
            __lions: {
              goto(x: number, y: number): unknown;
              sel(i: number[]): number[];
              renderer: { worldToScreen(x: number, y: number): { x: number; y: number } };
            };
          }).__lions;
          L.goto(at.x + 0.5, at.y + 0.5);
          L.sel(ids);
          const p = L.renderer.worldToScreen(at.x + 0.5, at.y + 0.5);
          const c = document.querySelector('#stage canvas');
          if (!c) throw new Error('no battlefield canvas');
          const r = c.getBoundingClientRect();
          return { x: r.left + p.x, y: r.top + p.y };
        },
        { ids, at }
      );

    // (a) One gesture, one voice event: the canvas, the minimap and a key.
    const p = await aim([inf.id, lavi.id], inf);
    await v.mouse.click(p.x, p.y, { button: 'right' });
    await v.waitForTimeout(300);
    const a1 = await read();
    console.log(`[${TAG}] voices (a) canvas: ${JSON.stringify(a1.entries)} tones=${tones(a1).join(',')}`);
    expect(a1.entries.length === 1, `voices (a): one right-click made ${a1.entries.length} voice events, not 1 (N1)`);
    expect(
      a1.entries[0]?.key === 'he.infantry.move' && a1.entries[0]?.status === 'placeholder',
      `voices (a): expected he.infantry.move as a placeholder, got ${JSON.stringify(a1.entries[0])}`
    );
    expect(tones(a1).length === 1, `voices (a): ${tones(a1).length} voice tones for one gesture, not 1`);
    const mm = await v.locator('.rl-minimap').boundingBox();
    if (!mm) throw new Error(`[${TAG}] voices: no minimap`);
    await v.mouse.click(mm.x + mm.width / 2, mm.y + mm.height / 2, { button: 'right' });
    await v.waitForTimeout(300);
    const a2 = await read();
    expect(a2.entries.length === 2 && tones(a2).length === 2, `voices (a): the minimap order made ${a2.entries.length - 1} events`);
    await v.keyboard.press('h');
    await v.waitForTimeout(300);
    const a3 = await read();
    expect(
      a3.entries.length === 3 && tones(a3).length === 3 && a3.entries[2]?.trigger === 'halt',
      `voices (a): the halt key made ${JSON.stringify(a3.entries.slice(2))}`
    );

    // (b) A quick repeat is throttled (N2). Three right-clicks inside a second,
    // one task apart -- real clicks cost seconds each under SwiftShader, which
    // would outrun the 4 s window this leg is about. Each is dispatched through
    // the canvas's own `contextmenu` listener, a macrotask apart, so each is its
    // own gesture (R-3).
    const q = await aim([lavi.id], lavi);
    const b0 = await read();
    await v.evaluate(async ({ x, y }) => {
      const c = document.querySelector('#stage canvas');
      if (!c) throw new Error('no battlefield canvas');
      for (let i = 0; i < 3; i++) {
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
        await new Promise((r) => setTimeout(r, 0));
      }
    }, q);
    await v.waitForTimeout(300);
    const b1 = await read();
    const burst = b1.entries.slice(b0.entries.length);
    console.log(`[${TAG}] voices (b) burst: ${JSON.stringify(burst)}`);
    expect(
      burst.map((e) => e.why).join() === 'line,ack:repeat,silent:repeat',
      `voices (b): a three-click burst read ${burst.map((e) => e.why).join()} (N2)`
    );
    expect(
      burst.map((e) => e.key ?? '-').join() === 'he.crew.move,he.common.ack,-',
      `voices (b): keys ${burst.map((e) => e.key ?? '-').join()}`
    );
    const heard = tones(b1).slice(tones(b0).length);
    expect(
      heard.join() === `${PLACEHOLDER_HZ.move},${PLACEHOLDER_HZ.ack}`,
      `voices (b): the burst sounded ${heard.join() || 'nothing'} -- two voices, move then ack, and a silence`
    );

    // (c) Voices at 0: nothing plays. The slider is driven through the pause
    // menu's own settings pane; its value is set and its own input/change
    // listeners fire (Playwright cannot fill a range input).
    await v.keyboard.press('Escape');
    await v.waitForSelector('.rl-pause');
    await v.locator('.rl-pause [data-tab="settings"]').click();
    await v.waitForSelector('.rl-pause input[name="voice"]');
    await v.evaluate(
      '(() => { var r = document.querySelector(\'.rl-pause input[name="voice"]\'); r.value = "0";' +
        ' r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); })()'
    );
    await v.locator('.rl-pause [data-act="resume"]').click();
    await v.waitForSelector('.rl-pause', { state: 'hidden' });
    const z = await aim([inf.id], inf);
    const c0 = await read();
    await v.mouse.click(z.x, z.y, { button: 'right' });
    await v.waitForTimeout(300);
    const c1 = await read();
    const lastEntry = c1.entries.at(-1);
    console.log(`[${TAG}] voices (c) at 0: ${JSON.stringify(lastEntry)} tones ${tones(c0).length} -> ${tones(c1).length}`);
    expect(c1.entries.length === c0.entries.length + 1, 'voices (c): the order at Voices 0 was not even decided');
    expect(lastEntry?.status === 'volume-zero', `voices (c): at Voices 0 the mixer said ${String(lastEntry?.status)}`);
    expect(tones(c1).length === tones(c0).length, 'voices (c): a voice sounded with Voices at 0');
    await vCtx.close();
  }
```

- [ ] **Step 2: Run it, falsify it, commit.** Run `pnpm ui:routes -- --port=5194`. It must pass with every earlier leg still green. Each of these must be seen red, then undone. Every one is an edit to Task 11's wiring or to the modules it wires, which is how this task falsifies Task 11:
  - (a) Comment out `intentListeners.push((intent) => voice.observe(intent))`. Leg (a) goes red on 0 events.
  - (b) Make the director's repeat silence start at `count >= 4`. Leg (b) goes red on `line,ack:repeat,ack:repeat`.
  - (c) Make `playVoice` ignore `user.voice`. Leg (c) goes red on status `placeholder`.
  - (d) Drop `audio.setVoicePlaceholder(...)` from `main.ts`. The boot vote goes red.

  Commit the one path with the message `test(ui-review): voices answer once per gesture, throttle a burst, and hush at 0 (WP-AU1 T12)`. The body carries the four red runs' lines.

---

### Task 13: Docs: D1's voice rule, the `bark` row, and voice provenance

**Model:** sonnet (D1; the spec's §9 item 11; CONTRIBUTING).

**Files:**
- Modify: `docs/GDD.md`, `docs/campaign/storyline.md`, `docs/campaign/README.md`, `CONTRIBUTING.md`

- [ ] **Step 1: Edit.**
  - **`docs/GDD.md` §2.** Before "Every region is defined by terrain and doctrine…", add the spec §5 paragraph verbatim, as D1 adopted it on 25 Sep: **Voice.** KDF units speak Hebrew; units of the three enemy doctrines speak Arabic, in a standard military register with no regional dialect. Neither side speaks a religious phrase, a slogan or a real call sign. Language is the one real-world marker the game admits, and it admits it symmetrically; faith and ethnicity stay excluded.
  - **`docs/campaign/storyline.md` §2.4 rule 5.** Append: "Language is admitted, and only symmetrically, by GDD §2 **Voice** (WP-AU1 D1, 25 Sep 2026): KDF in Hebrew, the three doctrines in standard military Arabic; faith, dialect, slogan and real call sign stay out, and a native speaker reviews every line before it is recorded."
  - **`docs/campaign/README.md`, the `bark` row:**

    `| \`bark\` | order acknowledgements and death calls, one line per gesture | units, keyed by voice class; KDF in Hebrew, the three doctrines in Arabic | on an order intent; on a death | **engine live, lines unrecorded** (WP-AU1): every key plays nothing until the asset plan lands (D5) | \`app/src/voice/\`, \`render/audio.ts\` \`playVoice\`, \`data/audio.json\` \`voices\` |`
  - **`CONTRIBUTING.md`**, after the audio paragraph: "**Voice lines** (`data/audio.json` `voices`) take the same bar, plus four fields: `generator` (a person for a read, or the tool and plan for generated speech), `text`, `translit` and `en`. Owned or commissioned speech uses `LicenseRef-owned`, and its `source` names the release form, the session record, or the service plan and date. A generated voice is disclosed in the PR. Filenames are ASCII: `voice/<lang>/<class>/<trigger>_<nn><take>.ogg`, never Hebrew or Arabic script. A free-tier TTS output is not licensed for commercial use and cannot be committed."
- [ ] **Step 2: Check, falsify, commit.** Run `grep -n "approved target, unbuilt" docs/campaign/README.md | grep bark`; it must print nothing. Seen red: before the edit, it printed the row. Run `pnpm validate:ui`, which is unaffected. Commit the four paths with the message `docs(voice): the voice rule in canon, the bark row, and voice provenance (WP-AU1 T13)`.

---

## Out of scope

- **The asset plan** (the spec's §9 tasks 2b, 3 and 12), gated on D4, D5 and D9:
  - native review of both sheets;
  - recording, or generation once a paid plan's commercial licence is confirmed for the seven ElevenLabs samples and their siblings (D5);
  - `tools/voice_prep.py` (trim, normalise, encode, name);
  - the measured gate: N9 duration, N10 loudness and N14 size by ffmpeg, with ffmpeg added to CI's `gates` job (R-8);
  - filling the 57-line first batch into `voices.lines`, each variant with `license`, `source`, `generator`, `text`, `translit` and `en`.

  The engine needs no change for any of it: a line that decodes simply stops reading `missing`.
- **D7, enemy-order lines (phase 2).** `commit` and `withdraw_to` trigger events are voiced from the visible enemy unit nearest the camera, with a 10 s throttle (N8). That needs the `MissionEvent` stream in the runtime and 33 more Arabic lines.
- **EVA announcements, briefing voice-over, `say` lines and battle chatter** (spec header).
- **#247**, `manpad_team`'s `mobility.wheeled` default. Its voice is set by its explicit field (R-16).
- **A lazy, per-roster decode of the BATTLE library**. N16 covers voices only.
- **`packages/sim/**`**, which is untouched. **CLAUDE.md, HANDOVER.md** and the spec's status line are updated at landing, from a main worktree, by the lead's protocol. That includes a dev-instruments line for `?voicetick` and `__lions.voiceLog()`.

## Open questions for the lead

1. **R-15: `dozer_d9` speaks the sapper lines.** Its role is `engineer`, so it answers a demolition with "starting demolition" and moves with "sappers moving". Default: keep it; the spec's table implies it. The alternative is a one-line `"voice": "crew"` override, which would make it "driver, forward" and still use `engineer.task` for demolish (R-5).
2. **R-14: enemy deaths are not radio-coloured.** Default: placed in the world, heard across the field. The alternative band-passes them too, as overheard traffic, which the spec's "hides source mismatch" would also argue for.

## Self-review

**Spec coverage.**

| Spec item | Task |
|---|---|
| §2 one line per gesture, `winningVerb` ranking | 7 (R-4, the cursor-equality test), 9 (coalescing), 12 (a) |
| §2 triggers: move, attack, demolish, the six verbs | 2 (keys), 7 |
| §2 death, KDF | 8, 9, 11 (`onTick`) |
| §2 death, enemy, visible | 8 (N7), 5 (placed) |
| §2 enemy order (D7) | **phase 2**, out of scope |
| §2 silent: select, group, overlay, support, removed, civilians | 7, 8 |
| §2 speaker: most units, tie to first selected | 7 |
| N1 | 7, 12 (a) |
| N2 | 7, 12 (b) |
| N3 | 7; 8 stamps it (R-12) |
| N4 | 5 |
| N5 | 5 |
| N6 | 8 |
| N7 | 8 |
| N8 | phase 2 (D7) |
| N9, N10, N14, N15 | asset plan (R-8) |
| N11 line gain 0.8, slider default 1 | 3 (manifest), 4 (bus), 5 (line gain), 6 (default) |
| N12 duck, SFX −4 dB and music −3 dB, 80/300 ms | 5 (R-2 for the music element) |
| N13 radio band 300–3,400 Hz | 4 (nodes), 5 (routing, R-14) |
| N16 ≤ 16 MB, roster factions only | 4 (cap, languages), 2 (`rosterLanguages`), 11 (wiring) |
| §3 language by `faction` through data; civilians absent | 2, 3 |
| §3 `voice` field, role defaults, three overrides | 1, 2 (R-15, R-16) |
| §6 manifest shape, keys, variant fields | 3 |
| §6 gate: licence, source, names, text, keys, D9 | 3 (R-6, R-7) |
| §6 gate: duration and loudness by ffmpeg | asset plan (R-8) |
| §7 director pure, node-tested, `intentListeners`, `events`, `isVisible` | 7, 8, 9, 11 |
| §7 mixer: `voice` bus, `AudioGains.voice`, `playVoice`, mute where it plays, decode order, rename | 4, 5 (R-11, R-19) |
| §7 settings `audio.voice`, Voices slider | 6 |
| §7 no sim change | every task (global constraint), 11 (`test:determinism`) |
| §7 placement: orders and KDF deaths unplaced, enemy deaths placed | 5, 8 |
| §7 captions (D8) | 6 (toggle), 10 (slot), 9 and 11 (feed) |
| §9 item 8's read-back `__lions.voiceLog()` | 9, 11 |
| §9 item 11: drive canvas, minimap and key; count from the read-back; hash unchanged; AudioContext count unchanged; README `bark` row | 12, 11, 13 |
| §10 "a silent first order if decoding lags" | 4 (ui → voice → battle), R-9 |
| D1 | 13 |
| D2 | honoured: the engine speaks no text of its own; the line sheet is the asset plan's |
| D5 | no sample committed (Task 0 step 4); R-7 is where licensed output enters |
| D6, D8, D9, D10 | 8; 6 and 10; 3; 2 and 3 |
| The brief: missing lines are not errors | R-9, 5 (status), 9 (once, info) |
| The brief: optional dev placeholder | R-10, 4, 5, 9, 11, 12 |
| The brief: `manpad_team` | 1 (explicit `infantry`), R-16 (#247 untouched) |

**Every check has an input that makes it fail**, named in its task: Task 1 (3), 2 (4), 3 (5), 4 (5), 5 (5), 6 (3), 7 (4), 8 (4), 9 (4), 10 (3), 12 (4, which are Task 11's wiring), 13 (1).

**Type consistency.**
- `VoiceClass`, `OrderVerb`, `LineTrigger`, the key functions and `rosterLanguages` come from Task 2. They are consumed by name in Tasks 3, 7, 8 and 11.
- `VoicePriority`, `VoicePlay`, `VoiceResult`, `VoiceStatus`, `VoiceStats` and `PLACEHOLDER_HZ` are declared in Task 4 and exported through `@lions/render`. Task 5 implements them. Tasks 7 and 9 import the types, and Task 12 imports `PLACEHOLDER_HZ` from the source file.
- `VoiceCue`, `DirectorLook`, `DirectorState`, `Why` and `VOICE_TIMING` come from Task 7. Task 8 adds `decideDeaths` without changing an interface. Task 9 consumes both.
- `VoiceRuntime`, `VoiceLogEntry` and `voicePlaceholderOn` come from Task 9. Task 11 consumes them. Task 12 reads `voiceLog()`'s `entries`, whose fields are `VoiceLogEntry`'s, and `stats.placeholder`, a `VoiceStats` field.
- `Settings.audio.voice` (Task 6) flows to `setGains` as `AudioGains.voice`, which is optional (R-11). `Settings.accessibility.captions` gates Task 11's caption closure.
- `Hud.caption` (Task 10) is what Task 11's closure calls.

**Placeholder scan.**
- No TBD remains.
- The placeholder **tick** is deliberate and named: dev-only, labelled `placeholder` in every status, never shipped (R-10).
- These bodies are specified by their steps rather than written out:
  - `playVoice`'s node building (Task 5): the order and wiring are given line by line, and the tests pin every edge of the graph.
  - `decideOrder`'s and `decideDeaths`' bodies (Tasks 7 and 8): given as numbered rules, and every rule has a test and a mutation.
  - `validate_audio.py`'s `main()` changes (Task 3): three named lines.
  - The `main.ts` insertions (Task 11): given as code, placed by the named statements they follow.
- One number is not the spec's own. `PLACEHOLDER_GAIN = 0.15` keeps a dev sine from being louder than speech. It is a dev instrument's level and never ships.

**Model tiering.**
- **Opus:** Tasks 4 and 5 (the mixer), Task 9 (the gesture boundary and the life after a leave) and Task 11 (`main.ts`), plus the final whole-branch review.
- **Sonnet:** Tasks 1, 2, 3, 6, 7, 8, 10, 12 and 13, each with its tests written out.
- **Haiku:** scoped re-reviews of a fix round.

Nothing inherits opus by default.

**Execution order.** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13, serially, on one branch.
- 2 needs 1: its sweep reads the three overrides.
- 3 needs 2: its completeness test reads `allLineKeys`.
- 7 needs 4 for the `VoicePriority` type.
- 9 needs 5's `VoiceResult` shape.
- 11 needs 5, 6, 9 and 10.
- 12 is 11's browser falsification and must follow it directly.
- 13 may run at any point after 11.

Tasks 1–5 form a landable floor on their own: data, gate and mixer, with nothing audible. Tasks 6–10 are the model and the UI. Tasks 11–12 make it speak.

**R-n at landing.** R-1 … R-20 become deviations in the spec's record when the lead lands the branch. Open questions 1 and 2 go with them.
