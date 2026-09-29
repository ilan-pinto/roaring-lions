# Pinned feedback (GH-262). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pinned unit says so wherever the player looks when an order "does nothing":
- a drawn pinned mark on the chip art, the card and the strip;
- a `pinned` cursor over a wholly pinned selection;
- one feed line saying the order waits and why;
- a voice cue, "Can't move — under fire!", with its caption shipping now and its audio waiting on D5;
- one tooltip that explains what pinned is and what ends it.

**Architecture:**
- All of it reads `sim.state.pinned` / `sim.state.routed`, which the sim already exposes. Nothing writes to the sim (invariant 4).
- New pure pieces, each node-tested:
  - a `pinned` status mark in `ui/symbol.ts`;
  - `ui/pinned-order.ts`, which turns one order intent plus unit state into a note decision;
  - a pinned branch in `voice/director.ts`;
  - a `pinned` rung in `input/cursor.ts`.
- `main.ts` wires them at three existing seams:
  - the `intentListeners` observer list (feed line, voice);
  - `DirectorLook` (`isPinned`);
  - the hover ticker's `CursorHints` (`pinned`).
- The HUD draws the mark through `symbolSvg`, coloured only by `theme.css` tokens.

**Tech Stack:** TypeScript strict, vitest (node for pure modules, jsdom for `hud.ts`), the Vite cursor plugin, Playwright via `pnpm ui:shots` for captures. No new dependencies. Nothing under `packages/sim/**` or `packages/render/**`.

**Spec:** `docs/superpowers/specs/2026-09-28-pinned-feedback-design.md`. §1 holds the measured facts every string below must stay true to:
- The order is **queued**: `applyCommands` never reads `pinned`, and a pinned unit crawls at ÷64 (`sim.ts:4947`).
- The order is **lost** if a soft unit routs after 10 s (`sim.ts:5109-5119`, `:3394`, `:5099-5104`).
- An order to a routed unit is **refused** (`sim.ts:2074`).
- With no fire, the pin lifts after 3.0–9.9 s.

**Base:** branch `feat/pinned-feedback`, cut from `main` `72932b0b` (v0.89.0). Worktree `/Users/ilpinto/dev/roaring-lions-ep/pinned`.

**Order and the gate:**
1. **Task 1** draws the mark candidates and the mockup sheet, then **stops at gate G-PIN** for the lead's pick.
2. **Tasks 2–4** do not depend on the pick (voice, feed line, tooltip text) and may run while the gate is open.
3. **Tasks 5–6** (wiring the mark into the HUD and the cursor) start only after G-PIN.
4. **Task 7** lands.

---

## Pre-flight: open questions (spec §5)

**Default:** if the lead gives no answer, take the recommended ruling and record it in the Task 7 HANDOVER entry.

| # | Question | Recommended |
|---|---|---|
| Q1 | Mark A (pressed flat), B (ducked) or C (incoming)? | A |
| Q2 | Also voice the `pinned` event for a selected unit? | No, order trigger only |
| Q3 | Mark on the control-group bar? | No |
| Q4 | Feed line for an order refused to a routed unit (`order.broken.note`)? | Yes |
| Q5 | Pinned caption even with captions off? | No (D8) |
| Q6 | Any in-world mark? | None. Option W in the mock only |
| Q7 | Hebrew and Arabic scripts | Drafts until D4 review; text only until D5 |

---

## Global Constraints

- **The sim is untouched.** `git diff --stat 72932b0b..HEAD -- packages/sim packages/render` is empty at landing. `pnpm test:determinism` is unmoved.
- **No status marks in the world** (the lead, 27 Sep). Option W exists only on the Task 1 mock sheet. No task builds it. If the lead approves W at G-PIN, it becomes a new plan, not a task here.
- **Colour comes from the palette.**
  - `theme.css` is the only file that names an `--rl-*` variable.
  - `pnpm validate:ui` rejects hex and `rgb()`/`rgba()` literals.
  - The mark is `currentColor`. Its colour reaches it through `--hot` and the new `--mark-edge` token only.
  - The cursor plugin keeps resolving palette keys to hex at build time, as it already does.
- **No dingbats.** The mark is a drawn `symbol.ts` id. `▼` joins `RETIRED_DINGBATS` in Task 5.
- **Voices are military calls only (D2).** No audio file lands (D5). `data/audio.json` gains keys with `variants: []` only.
- **Strict TypeScript.**
  - No `any` and no non-null assertions outside tests.
  - Tests are colocated `*.test.ts`. DOM tests open with `// @vitest-environment jsdom`.
- **Every check is seen red.** Each task names mutations that must turn a named test red, and the commit message quotes the red line.
- **Drive the real UI** for anything visible (memory: console shortcuts skip the code that breaks).
  - `__lions.sim.debugSuppress(id, n)` may *create* a pin, since it is a sim hook for tests and the sandbox.
  - The order itself must be a real right-click on the canvas.
  - Use a **vehicle** (`mbt_lavi`) for long holds, because vehicles never rout. Infantry routs at 10 s.
  - Never `pkill` vite. Use the dev server that is already running, or `preview_start` from this worktree.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus `pnpm validate:audio` in Task 2.
- **Git.**
  - Stage explicit paths only: `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, never `git checkout -- <file>`.
  - Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Do not push. The lead merges.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/app/src/ui/symbol.ts` (+test) | `StatusId = 'pinned'`, `PINNED_CANDIDATES` (A/B/C until G-PIN), `SYMBOL_IDS` 19→20 | 1, 5 |
| `.superpowers/pinned-mock/` (git-ignored) | `gen.ts`, `sheet.html`, `sheet.png`, `sheet-x4.png`: the G-PIN mock | 1 |
| `packages/app/src/voice/lines.ts` (+test) | `COMMON_CALLS`, `pinnedLineKey`, `LineTrigger` + `'pinned'`, `allLineKeys` 19→20 per language | 2 |
| `data/audio.json` | `he.common.pinned`, `ar.common.pinned`, `variants: []` | 2 |
| `packages/app/src/voice/director.ts` (+test) | `DirectorLook.isPinned?`, `VOICE_TIMING.pinnedRepeatMs/pinnedGlobalMs`, `VoiceCue.caption?`, the pinned branch in `decideOrder` | 2 |
| `packages/app/src/voice/voice-runtime.ts` (+test) | Caption fallback for `missing`/`placeholder` when `cue.caption` is set; `PINNED_CAPTION_S` | 2 |
| `packages/app/src/ui/pinned-order.ts` (+test) | **New.** `pinnedOrderNote`, `PINNED_NOTE_MS` | 3 |
| `packages/app/src/i18n/en.json` | The keys in spec §2.6 | 2, 3, 4, 5 |
| `packages/app/src/ui/hud.ts` (+test), `ui/selection-model.ts` (+test) | Tooltips (4); the mark on the chip, card and strip (5) | 4, 5 |
| `packages/app/src/ui/theme.css` | `--mark-edge`, `.rl-pin-mark` placement | 5 |
| `tools/validate_ui_palette.mjs`, `tools/src/validate_ui_dingbats.test.ts` | `▼` retired | 5 |
| `packages/app/src/input/cursor.ts` (+test), `vite-plugin-cursors.ts` (+test) | `pinned` cursor name and body | 6 |
| `packages/app/src/main.ts` | Wiring: `isPinned`, note observer, cursor hint | 2, 3, 6 |
| `tools/src/ui-review/shoot.ts` | `28-pinned` capture | 5 |
| `docs/HANDOVER.md` | The landing entry, with the G-PIN ruling and the Q-defaults taken | 7 |

---

## Task 1: Draw the mark candidates and the mockup sheet (gate G-PIN)

**Model:** opus. This task is drawing judgement at 12 px, and it produces the lead's decision material.

**Files:**
- Modify `packages/app/src/ui/symbol.ts` and `symbol.test.ts`.
- Create, uncommitted, `.superpowers/pinned-mock/gen.ts` and its outputs.

**Interfaces (produced):**

```ts
// symbol.ts
export type StatusId = 'pinned';
export type SymbolId = RoleBucket | SightOrderId | UtilityId | StatusId;
/** The three G-PIN candidates. Task 5 deletes two of them and keeps the pick as STATUS_GLYPHS.pinned. */
export const PINNED_CANDIDATES: Readonly<Record<'A' | 'B' | 'C', string>>;
// SYMBOL_IDS gains 'pinned' (20 ids); symbolBody('pinned') draws candidate A until the ruling.
```

The candidates, all on the 24 box, filled only, weight `W`:
- **A, "pressed flat":** a bar `rect(2, 3, 22, 3 + W)`, and under it a wide, shallow filled chevron pointing down. Its apex is at (12, 20), its shoulders at (2, 9) and (22, 9), and it is W thick.
- **B, "ducked":** the same bar over the infantry cross, squashed to `B(3.5, 10, 20.5, 19)`.
- **C, "incoming":** three `band()` strikes leaning at `CHEVRON_SWEEP` from the top-right, over a ground bar `rect(2, 19, 22, 19 + W)`.

- [ ] **Step 1: Write the failing tests.**

```ts
// symbol.test.ts: extend the existing suite
import { PINNED_CANDIDATES, SYMBOL_IDS, symbolBody, symbolSvg, W } from './symbol';

it('is twenty distinct ids: seven roles, eight orders, four utility marks, one status mark', () => {
  expect(SYMBOL_IDS).toHaveLength(20);
  expect(new Set(SYMBOL_IDS).size).toBe(20);
  expect(SYMBOL_IDS).toContain('pinned');
});

describe('the pinned mark candidates (G-PIN)', () => {
  const ids = ['A', 'B', 'C'] as const;
  it('are three different drawings, each filled only and in currentColor', () => {
    expect(new Set(ids.map((k) => PINNED_CANDIDATES[k])).size).toBe(3);
    for (const k of ids) {
      expect(PINNED_CANDIDATES[k]).toContain('currentColor');
      expect(PINNED_CANDIDATES[k]).not.toMatch(/stroke|#[0-9a-fA-F]{3}|var\(--/);
    }
  });
  it('stay inside the 24 box: every coordinate in [0, 24]', () => {
    for (const k of ids) {
      const nums = [...PINNED_CANDIDATES[k].matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
      for (const n of nums) expect(n >= -24 && n <= 24).toBe(true); // relative arcs may be negative
    }
  });
  it('draws candidate A until the ruling', () => {
    expect(symbolBody('pinned')).toBe(PINNED_CANDIDATES.A);
    expect(symbolSvg('pinned', 12)).toContain('data-symbol="pinned"');
  });
  it('carries a pixel of ink at the chip size (12 px)', () => {
    expect((W * 12) / 24).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run and see red.** `pnpm vitest run packages/app/src/ui/symbol.test.ts` fails, because `PINNED_CANDIDATES` is not exported.
- [ ] **Step 3: Implement** the three bodies with `symbol.ts`'s own helpers (`poly`, `band`, `rect`, `path`). Add `STATUS_IDS = ['pinned']` to `SYMBOL_IDS`. Give `symbolBody` a status branch.
- [ ] **Step 4: Falsify.** Each mutation must turn the named test red:
  - Make B return A's string: "three different drawings" fails.
  - Add `stroke="currentColor"` to C: "filled only" fails.
  - Drop `'pinned'` from `SYMBOL_IDS`: "twenty distinct ids" fails.
- [ ] **Step 5: Build the mockup sheet** in `.superpowers/pinned-mock/`. It is git-ignored scratch and is not committed.
  - `gen.ts` imports `symbolSvg`/`PINNED_CANDIDATES` from the real module (the r5 `gen.ts` pattern). It writes `sheet.html` with one row per candidate (A, B, C), and in each row:
    1. **Chip:** a real chip's markup, with `rl-chip__art` 40 px holding a real unit icon (`inf_squad`, then `mbt_lavi`), the kit sign top-right at level 2, and the candidate at **12 px bottom-left** with a 1 px inset. The status line reads `1 PINNED`.
    2. **Card:** the 72 px `rl-card__frame` with the role badge top-left, the kit sign top-right, and the candidate at **16 px bottom-left** with a 3 px inset, plus the `PINNED` flag with the mark before it at 1em.
    3. **Strip:** `[mark] 2 pinned` at the strip's own font size, beside the unchanged `⚑ 1 broken`.
    4. **Cursor:** the housing in `hot` with the candidate as payload at 32 px, over `ctx-open.png` and `ctx-quiet.png` (reuse the G1 context crops).
    5. **Option W, one extra row labelled "OPTION ONLY — not recommended: no status marks in the world (27 Sep)":** candidate A at 12 px over a pinned unit's head in a real gameplay screenshot (`?sandbox=beit_sahwan_outskirts`, zoom 1.0 and 1.6).
  - Load `theme.css` itself, so every colour is the real token (`--hot`, `--mark-edge`, `--kit`, the plate colours), in both the default and the deuteranopia variant (`:root[data-cvd=deuteranopia]`).
  - Capture with Playwright at device scale 1 (`sheet.png`, gameplay size) and at scale 4 (`sheet-x4.png`). The lead judges zoomed in (memory "approve art numbers before rendering"), and the numbers are in spec §3.
- [ ] **Step 6: Commit** the `symbol.ts` change only (the mark is drawn, wired nowhere). Message: `feat(ui): pinned mark candidates A/B/C for G-PIN (GH-262)`.
- [ ] **Step 7: GATE G-PIN.** Publish `sheet.html`, with both PNGs embedded, as a private Artifact. Hand the link to the lead with Q1 and Q6 as the questions. **Stop.** Tasks 5–6 wait for the answer, and Tasks 2–4 may proceed.

---

## Task 2: The voice cue: key, director branch, caption fallback

**Model:** sonnet. The work is mechanical against a clear director contract.

**Files:**
- `packages/app/src/voice/lines.ts`, `lines.test.ts`
- `packages/app/src/voice/director.ts`, `director.test.ts`
- `packages/app/src/voice/voice-runtime.ts`, `voice-runtime.test.ts`
- `data/audio.json`
- `packages/app/src/i18n/en.json` (`voice.caption.pinned`)
- `packages/app/src/main.ts` (the `look.isPinned` wiring, `main.ts:2745`)

**Interfaces:**

```ts
// lines.ts
export const COMMON_CALLS = ['pinned'] as const;           // calls, not verbs: no gesture maps to them
export type LineTrigger = 'move' | 'attack' | 'death' | 'task' | 'ack' | 'pinned' | CommonVerb;
export const pinnedLineKey = (lang: string): string => `${lang}.common.pinned`;
// allLineKeys: + `${lang}.common.pinned` per language (19 -> 20)

// director.ts
export interface DirectorLook { /* ...existing */ isPinned?(id: number): boolean }  // absent = never pinned
export interface VoiceCue { /* ...existing */ caption?: string }                   // an i18n KEY, never text
export const VOICE_TIMING = { /* ...existing */ pinnedRepeatMs: 4000, pinnedGlobalMs: 2500 } as const;
export interface DirectorState { /* ...existing */
  readonly pinnedAt: number;                               // last pinned call, any selection
  readonly pinnedBySel: Readonly<Record<string, number>>;  // sorted pinned ids -> last call
}
// decideOrder's `trigger` widens to OrderVerb | 'pinned' | null.

// voice-runtime.ts
export const PINNED_CAPTION_S = 1.5;
// deps gain `text(key: string): string` (t in the app, identity in tests)
```

**The rule:** in `decideOrder`, after `gestureVerb`:
1. If `verb.verb` is `'move'` or `'attack'`, `look.isPinned` exists, and `pinned = verb.ids.filter(isPinned)` is non-empty, the gesture takes the pinned branch.
2. The speaker is `speakerOf(pinned)`. If there is none, the result is `silent:unvoiced`.
3. `sel` is the pinned ids, sorted and comma-joined. The gesture is `silent:throttle` if `now - pinnedBySel[sel] < pinnedRepeatMs` or `now - pinnedAt < pinnedGlobalMs`. **It never falls through to the move line.**
4. Otherwise the cue is `{ key: pinnedLineKey(lang), trigger: 'pinned', priority: 'order', at: null, caption: 'voice.caption.pinned' }`.
5. The branch stamps `pinnedAt`, `pinnedBySel[sel]` and `spoke[lang.cls]`, and leaves `run` untouched.

- [ ] **Step 1: Write the failing tests.**

```ts
// lines.test.ts
it('declares the pinned call once per language', () => {
  expect(allLineKeys(['he'])).toHaveLength(20);
  expect(allLineKeys(['he', 'ar'])).toContain('ar.common.pinned');
  expect(pinnedLineKey('he')).toBe('he.common.pinned');
});
// the existing "data/audio.json declares the director's whole vocabulary" test goes red until audio.json gains the two keys.

// director.test.ts
const PINNED = new Set([1, 3]);
const pinLook: DirectorLook = { ...look, isPinned: (id) => PINNED.has(id) };
const at = (s: DirectorState, ms: number, ...ids: number[]) => decideOrder(s, g([order(...ids)]), pinLook, LANGS, ms);

describe('a move to a pinned unit answers "can’t move", never "moving" (GH-262)', () => {
  it('speaks the pinned call, in the pinned unit’s voice, captioned', () => {
    const d = at(INITIAL_DIRECTOR, 0, 1);
    expect(d.cue).toMatchObject({ key: 'he.common.pinned', trigger: 'pinned', priority: 'order', at: null, caption: 'voice.caption.pinned' });
    expect(d.why).toBe('line');
  });
  it('a mixed group speaks for the pinned part only', () => {
    expect(at(INITIAL_DIRECTOR, 0, 2, 3).cue?.speaker).toBe('crew'); // 2 is free infantry, 3 is pinned crew
  });
  it('an attack-move over a hostile takes the pinned call too', () => {
    expect(decideOrder(INITIAL_DIRECTOR, g([order(1)], true), pinLook, LANGS, 0).cue?.key).toBe('he.common.pinned');
  });
  it('garrison and the other verbs are untouched', () => {
    expect(decideOrder(INITIAL_DIRECTOR, g([{ kind: 'garrison', ids: [1], structure: 2 }]), pinLook, LANGS, 0).cue?.key).toBe('he.common.garrison');
  });
  it('a repeat inside pinnedRepeatMs is silent, and never "moving"', () => {
    const first = at(INITIAL_DIRECTOR, 0, 1);
    const again = at(first.state, VOICE_TIMING.pinnedRepeatMs - 1, 1);
    expect(again.why).toBe('silent:throttle');
    expect(again.cue).toBeNull();
    expect(at(first.state, VOICE_TIMING.pinnedRepeatMs, 1).why).toBe('line');
  });
  it('a different pinned selection inside pinnedGlobalMs is silent too', () => {
    const first = at(INITIAL_DIRECTOR, 0, 1);
    expect(at(first.state, VOICE_TIMING.pinnedGlobalMs - 1, 3).why).toBe('silent:throttle');
    expect(at(first.state, VOICE_TIMING.pinnedGlobalMs, 3).why).toBe('line');
  });
  it('a look with no isPinned behaves exactly as before', () => {
    expect(decideOrder(INITIAL_DIRECTOR, g([order(1)]), look, LANGS, 0).cue?.key).toBe('he.infantry.move');
  });
});

// voice-runtime.test.ts
it('captions a pinned cue from its i18n key when no take exists', () => {
  const r = rig({ look: { ...look, isPinned: () => true }, text: (k) => `T:${k}` });
  r.rt.observe(order(1)); r.flush();
  expect(r.captions).toEqual([['T:voice.caption.pinned', PINNED_CAPTION_S]]);
});
it('never captions an ordinary missing line (R-9 unchanged)', () => {
  const r = rig({ text: (k) => `T:${k}` });
  r.rt.observe(order(1)); r.flush();
  expect(r.captions).toEqual([]);
});
```

(`rig` gains `flush()`, which drains `queued`, if it does not already expose one. Read `voice-runtime.test.ts:26-60` first and reuse its shape.)

- [ ] **Step 2: Run and see red.** `pnpm vitest run packages/app/src/voice` fails: the exports are missing and the manifest test fails.
- [ ] **Step 3: Implement.** Add the two keys to `data/audio.json`, keeping its sorted, three-per-line layout. Add `"voice.caption.pinned": "Can't move — under fire!"` to `en.json`. In `main.ts`, give `look` the member `isPinned: (id) => sim.state.pinned[id] === 1` and give the runtime deps `text: (k) => t(k)`.
- [ ] **Step 4: Falsify.** Each mutation must turn the named test red:
  - Let a throttled pinned gesture fall through to the normal path: "never moving" fails with `he.infantry.move`.
  - Remove `caption` from the pinned cue: the runtime caption test fails.
  - Caption every `missing` cue: "never captions an ordinary missing line" fails.
- [ ] **Step 5: Drive.**
  1. `?sandbox=beit_sahwan_outskirts&voicetick`, with captions ON in Settings → Accessibility.
  2. Select an `mbt_lavi` with a real click.
  3. In the console, run `__lions.sim.debugSuppress(<id>, 131072)`.
  4. Right-click open ground on the canvas.
  5. Expect the caption "Can't move — under fire!", and `__lions.voiceLog().entries.at(-1)` showing `{ trigger: 'pinned', key: 'he.common.pinned', status: 'placeholder' }`.
  6. Right-click again at once. Expect a `silent:throttle` entry, no caption, and no "Moving".
  7. Record the log lines in the commit.
- [ ] **Step 6: Gates** (including `pnpm validate:audio`), **then commit.** Message: `feat(voice): pinned call on an order to a pinned unit, caption before audio (GH-262)`.

---

## Task 3: The order-feedback line

**Model:** sonnet.

**Files:**
- Create `packages/app/src/ui/pinned-order.ts` and `pinned-order.test.ts`.
- Modify `packages/app/src/main.ts` (an observer beside the voice, `main.ts:3178`) and `packages/app/src/i18n/en.json`.

**Interfaces:**

```ts
// pinned-order.ts: pure, no DOM, no t() (the alerts.ts convention: keys and params out)
import type { PlayerIntent } from '../input/intents';
import type { AlertLine } from './alerts';
export const PINNED_NOTE_MS = 4000;
export interface PinnedOrderWorld { pinned(id: number): boolean; routed(id: number): boolean; soft(id: number): boolean }
export interface PinnedNoteState { readonly bySel: Readonly<Record<string, number>> }
export const INITIAL_PINNED_NOTE: PinnedNoteState;
export function pinnedOrderNote(
  s: PinnedNoteState, intent: PlayerIntent, w: PinnedOrderWorld, nowMs: number
): { state: PinnedNoteState; line: AlertLine | null };
```

**The rule:**
- Only `kind === 'order'` intents are read. For any other kind the result is `null` and the state is unchanged.
- `routed` ids produce `order.broken.note` in `bad` tone (Q4). This line outranks the pinned line, because that order is truly dropped.
- Otherwise, `pinned` ids that are not routed produce `order.pinned.note` in `warn` tone, or `order.pinned.note.soft` if any of them is `soft`.
- The params are `{ n }`. The key is throttled per sorted id set for `PINNED_NOTE_MS`.

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { INITIAL_PINNED_NOTE, PINNED_NOTE_MS, pinnedOrderNote, type PinnedOrderWorld } from './pinned-order';

const W = (pinned: number[], routed: number[] = [], soft: number[] = []): PinnedOrderWorld => ({
  pinned: (i) => pinned.includes(i) || routed.includes(i), // the sim flags a routed unit pinned too
  routed: (i) => routed.includes(i),
  soft: (i) => soft.includes(i),
});
const move = (...ids: number[]) => ({ kind: 'order' as const, verb: 'move' as const, ids, x: 1, y: 1, append: false });

describe('an order to a pinned unit says why it waits (GH-262)', () => {
  it('says nothing when nobody is pinned', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2), W([]), 0).line).toBeNull();
  });
  it('counts only the pinned units, in warn', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2, 3), W([2, 3]), 0).line).toEqual({ key: 'order.pinned.note', params: { n: 2 }, tone: 'warn' });
  });
  it('warns that infantry may break', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1), W([1], [], [1]), 0).line?.key).toBe('order.pinned.note.soft');
  });
  it('a routed unit’s dropped order outranks, in bad', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2), W([1], [2]), 0).line).toEqual({ key: 'order.broken.note', params: { n: 1 }, tone: 'bad' });
  });
  it('one line per burst: the same set inside PINNED_NOTE_MS is silent', () => {
    const a = pinnedOrderNote(INITIAL_PINNED_NOTE, move(1), W([1]), 0);
    expect(pinnedOrderNote(a.state, move(1), W([1]), PINNED_NOTE_MS - 1).line).toBeNull();
    expect(pinnedOrderNote(a.state, move(1), W([1]), PINNED_NOTE_MS).line).not.toBeNull();
  });
  it('ignores every non-order intent', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, { kind: 'halt', ids: [1] }, W([1]), 0).line).toBeNull();
  });
});
```

- [ ] **Step 2: Run and see red** (module not found).
- [ ] **Step 3: Implement.**
  - Add the three `order.*` keys from spec §2.6 to `en.json`.
  - Register the observer in `main.ts` right after the voice observer. It reads `sim.state.pinned/routed` and `unitTypes[..].isSoft`, and calls `hud.note(...alertNotice(line))`. `alertNotice` is already the renderer for `AlertLine`.
  - **Wiring note:** `dispatch` runs `applyIntent` first, but that only *queues* the command. `sim.state` is still pre-order, which is exactly the state wanted.
- [ ] **Step 4: Falsify.** Each mutation must turn the named test red:
  - Drop the routed branch: "outranks, in bad" fails.
  - Key the throttle by `intent.ids` instead of the pinned subset: "one line per burst" still passes. Add the case `move(1, 2)` then `move(1)` with only 1 pinned, which must be silent, and see it red under the mutation.
- [ ] **Step 5: Drive.**
  1. Pin an `mbt_lavi` as in Task 2, then right-click the canvas.
  2. Expect the feed line "**Pinned**: 1 unit can't move under fire. It goes once the fire lifts."
  3. Right-click again inside 4 s: no second line.
  4. Repeat from the **minimap**. The same line appears, which proves the one-`dispatch` seam.
  5. Pin an `inf_squad` and wait 10 s until the strip shows broken, then right-click. Expect the `Broken` line.
  6. Screenshot each state.
- [ ] **Step 6: Gates, then commit.** Message: `feat(hud): an order to a pinned or broken unit says why in the feed (GH-262)`.

---

## Task 4: The explanation tooltip

**Model:** sonnet.

**Files:**
- `packages/app/src/ui/hud.ts` and `hud.test.ts`: the strip tip, the card flag tip, and the chip status tip.
- `packages/app/src/i18n/en.json`: `hud.pinned.explain`; `hud.strip.pinned.tip` becomes the same text.

**Wiring:**
- The card's `PINNED` flag span gets `data-tip="pinned" tabindex="0"`. The card's tip resolver (the same `bindDelegatedTip` pattern as the strip, `hud.ts:1312`) answers `'pinned'` with `t('hud.pinned.explain')`.
- The chip status line, when its tone is `hot`, gets `data-tip="pinned"`. `chipTipHtml` is keyed by type id today, so resolve the status tip ahead of it: `if (target.dataset.tip === 'pinned') return t('hud.pinned.explain')`.

- [ ] **Step 1: Write the failing tests** (in `hud.test.ts`, reusing `rig`):

```ts
it('explains pinned on the strip, the card flag and the chip status', () => {
  const sel: number[] = [];
  const r = rig(mission(), { getSelection: () => sel });
  r.sim.state.pinned[r.ids[0]] = 1;
  const explain = /Lifts a few seconds after the fire stops/;
  for (const selection of [[], [r.ids[0]], [r.ids[0], r.ids[1]]]) {
    sel.splice(0, sel.length, ...selection);
    for (let i = 0; i < 5; i++) r.tick();
    const el = r.host.querySelector<HTMLElement>(
      selection.length === 1 ? '.rl-card__cond [data-tip="pinned"]'
      : selection.length === 2 ? '.rl-chip__status[data-tip="pinned"]'
      : '.rl-strip [data-tip="pinned"]')!;
    el.dispatchEvent(new Event('mouseover', { bubbles: true }));
    expect(r.host.querySelector<HTMLElement>('.rl-tip')!.textContent).toMatch(explain);
    closeTip();
  }
});
```

- [ ] **Step 2: Run and see red.** The card and chip selectors match nothing.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Falsify.**
  - Point the card's resolver at `hud.strip.broken.tip`: the test fails.
  - Put `data-tip` on the chip status line unconditionally: add the assertion that a holding chip carries no `data-tip`, and see it red.
- [ ] **Step 5: Drive.** Hover each of the three surfaces with a real pointer on a pinned vehicle. Tab to the card flag and check that the tip opens on focus. Screenshot the three tips.
- [ ] **Step 6: Gates, then commit.** Message: `feat(hud): one pinned explanation on strip, card and chip (GH-262)`.

---

## Task 5: Wire the approved mark (after G-PIN)

**Model:** sonnet.

**Files:**
- `ui/symbol.ts` (+test): keep the picked candidate as `STATUS_GLYPHS.pinned` and delete `PINNED_CANDIDATES`.
- `ui/selection-model.ts` (+test): `ChipView.pinned: boolean`.
- `ui/hud.ts` (+test): the mark on the chip art, the card frame, the card flag and the strip.
- `ui/theme.css`: the `--mark-edge` token (mapped to the same `--rl-*` entry `--kit-edge` uses) and `.rl-pin-mark`.
- `i18n/en.json`: `hud.strip.pinned` becomes `{n} pinned`; add `hud.pinned.label`.
- `tools/validate_ui_palette.mjs` and `tools/src/validate_ui_dingbats.test.ts`: `▼` joins `RETIRED_DINGBATS` and leaves the GH-261 comment block.
- `tools/src/ui-review/shoot.ts`: the `28-pinned` capture.

**Interfaces:**

```ts
// selection-model.ts
export interface ChipView { /* ...existing */ pinned: boolean } // ≥1 pinned and none routed (chipStatus precedence)
// hud.ts
const PIN_MARK_CHIP = 12;
const PIN_MARK_CARD = 16;
function pinMarkHtml(size: number): string; // `<span class="rl-pin-mark" role="img" aria-label="${t('hud.pinned.label')}">${symbolSvg('pinned', size)}</span>`
```

- [ ] **Step 1: Write the failing tests.**

```ts
// selection-model.test.ts
it('flags a chip pinned only when pinned is its worst condition', () => {
  const u = (o: Partial<UnitFacts>): UnitFacts => ({ typeId: 't', name: 'T', bucket: 'soft', hp: 1, hpMax: 1, routed: false, pinned: false, moving: false, aboard: false, ...o });
  expect(groupChips([u({ pinned: true })])[0].pinned).toBe(true);
  expect(groupChips([u({ pinned: true }), u({ routed: true, pinned: true })])[0].pinned).toBe(false); // broken outranks
  expect(groupChips([u({})])[0].pinned).toBe(false);
});

// hud.test.ts
it('draws the pinned mark on chip art, card frame, card flag and strip, and nowhere when nobody is pinned', () => {
  const sel: number[] = [];
  const r = rig(mission(), { getSelection: () => sel });
  const marks = () => r.host.querySelectorAll('[data-symbol="pinned"]').length;
  expect(marks()).toBe(0);
  r.sim.state.pinned[r.ids[0]] = 1;
  sel.push(r.ids[0]);
  for (let i = 0; i < 5; i++) r.tick();
  expect(r.host.querySelector('.rl-card__frame > .rl-pin-mark [data-symbol="pinned"]')?.getAttribute('width')).toBe('16');
  expect(r.host.querySelector('.rl-card__cond [data-symbol="pinned"]')).not.toBeNull();
  expect(r.host.querySelector('.rl-strip [data-symbol="pinned"]')).not.toBeNull();
  expect(r.strip()).toContain('1 pinned');
  expect(r.strip()).not.toContain('▼');
  sel.push(r.ids[1]);
  for (let i = 0; i < 5; i++) r.tick();
  expect(r.host.querySelector('.rl-chip .rl-pin-mark [data-symbol="pinned"]')?.getAttribute('width')).toBe('12');
});

// validate_ui_dingbats.test.ts
it('retires ▼ now that pinned is drawn', () => {
  expect(dingbatFailures('i18n/en.json', '"hud.strip.pinned": "▼ {n} pinned"')).toHaveLength(1);
});
```

- [ ] **Step 2: Run and see red.**
- [ ] **Step 3: Implement.**
  - The mark sits in a `.rl-pin-mark` span that is absolutely positioned bottom-left. Inside `.rl-kit-host` on the chip, `withKitSign` already supplies the positioned host; add one for an unkitted chip as that function does. On the card it sits in `.rl-card__frame`.
  - Colour is `color: var(--hot)` plus `filter: drop-shadow(0 0 1px var(--mark-edge))`, and `pointer-events: none`, as on the kit sign.
  - Insets are chip `left: 1px; bottom: 1px` and card `left: 0.1875rem; bottom: 0.1875rem`, in rem where the kit sign uses rem.
  - Rewrite `hud.test.ts:212-221` to the new strip text.
  - Add the `28-pinned` scenario to `shoot.ts`: the sandbox, one vehicle pinned through `debugSuppress`, then a card capture and a two-unit chip capture.
- [ ] **Step 4: Falsify.** Each mutation must turn the named test red:
  - Show the chip mark when `routed > 0`: "worst condition" fails.
  - Swap the chip and card sizes: the width assertions fail.
  - Remove `▼` from `RETIRED_DINGBATS`: the dingbat test fails.
- [ ] **Step 5: Drive.**
  1. Pin a vehicle and select it alone (card), then with a second unit (chips).
  2. Check the strip.
  3. Switch Settings → colour vision to deuteranopia and check again.
  4. Zoom the page to 200% (`--ui-scale`). The mark must hold its corner and never cover the kit stars.
  5. Run `pnpm ui:shots` and look at `28-pinned` at gameplay size.
- [ ] **Step 6: Visual gate.** Run `pnpm golden-baseline` locally for information only. The strip draws the mark only while something is pinned, so gated scenarios should not move (the local darwin baseline is stale; see memory). Check CI's `visual` job after the lead merges. Bless from CI numbers only if it moved.
- [ ] **Step 7: Gates, then commit.** Message: `feat(hud): the pinned mark on chip, card and strip; ▼ retired (GH-262)`.

---

## Task 6: The `pinned` cursor (after G-PIN)

**Model:** sonnet.

**Files:**
- `packages/app/src/input/cursor.ts` and `cursor.test.ts`
- `packages/app/vite-plugin-cursors.ts` and its test
- `packages/app/src/main.ts`: the hover ticker at `main.ts:4533`, hint `pinned`

**Interfaces:**

```ts
export type CursorName = /* ...existing */ | 'pinned';
export type UnbadgedName = /* ...existing */ | 'pinned';
export interface CursorHints { /* ...existing */ pinned?: boolean } // every id of the order intent is pinned
// cursorFor: after `const verb = winningVerb(...)` resolves to 'attack' or null and the fallback is move/attack,
// return 'pinned' when hints.pinned and the order intent exists.
```

In `main.ts`:
```ts
const orderIds = res.intents.find((i) => i.kind === 'order')?.ids ?? [];
const pinned = orderIds.length > 0 && orderIds.every((i) => sim.state.pinned[i] === 1);
```

- [ ] **Step 1: Write the failing tests.**

```ts
// cursor.test.ts
const orderRes = (ids: number[]) => ({ intents: [{ kind: 'order' as const, verb: 'move' as const, ids, x: 1, y: 1, append: false }], roe: 'free' as const, marker: true });
it('names pinned when the whole order is pinned, over open ground and over a hostile', () => {
  expect(cursorFor(orderRes([1]), { hostile: false, blocked: false, pinned: true })).toBe('pinned');
  expect(cursorFor(orderRes([1]), { hostile: true, blocked: false, pinned: true })).toBe('pinned');
});
it('keeps move when the hint is absent or false (some units will go)', () => {
  expect(cursorFor(orderRes([1]), { hostile: false, blocked: false })).toBe('move');
  expect(cursorFor(orderRes([1]), { hostile: false, blocked: false, pinned: false })).toBe('move');
});
it('never outranks armed support, protected or demolish', () => {
  expect(cursorFor({ ...orderRes([1]), armed: 'strike' }, { hostile: false, blocked: false, pinned: true })).toBe('strike');
  expect(cursorFor({ ...orderRes([1]), roe: 'protected' }, { hostile: false, blocked: false, pinned: true })).toBe('protected');
});
it('is unbadged', () => {
  expect(cursorKey('pinned', 'armour')).toBe('pinned');
});
// vite-plugin-cursors test: the generated CSS has a `[data-cursor="pinned"]` rule, and its body contains the pinned mark's path.
```

- [ ] **Step 2: Run and see red.**
- [ ] **Step 3: Implement.**
  - `pinnedBody(c)` is `fillPath(c.hot, housing())` plus the pinned symbol body, scaled into the housing's open middle. It is the same placement `costlyBody`'s payload uses, with the hotspot (16, 16) kept clear.
  - Add `'pinned'` to `BARE_NAMES`.
- [ ] **Step 4: Falsify.** Each mutation must turn the named test red:
  - Put the pinned rung above `res.armed`: the "never outranks armed support" test fails.
  - Drop `'pinned'` from `BARE_NAMES`: the plugin test fails, and `__lions.cursorKey()` would read `pinned` over an OS arrow.
- [ ] **Step 5: Drive.**
  1. Pin a vehicle, select it with a real click, and hover open ground.
  2. `__lions.cursorKey()` must read `'pinned'`, a DOM read (CLAUDE.md).
  3. Add a free unit to the selection: it reads `move` (or `move-<bucket>`).
  4. Wait until the pin lifts (about 10 s from the cap for a vehicle): it goes back to `move` with no re-hover.
- [ ] **Step 6: Gates, then commit.** Message: `feat(cursor): pinned state over a wholly pinned selection (GH-262)`.

---

## Task 7: Land

**Model:** haiku.

- [ ] Confirm `git diff --stat 72932b0b..HEAD -- packages/sim packages/render` is empty, and that `pnpm test:determinism`, `pnpm balance` and `pnpm playtest` are unchanged.
- [ ] Run the full gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm validate:audio && pnpm ui:routes`.
- [ ] Add a `docs/HANDOVER.md` entry covering:
  - the G-PIN ruling, with the lead's words and the date;
  - every Q-default taken;
  - that `he.common.pinned` and `ar.common.pinned` wait on D5.
- [ ] Post a comment on GH-262 with the drive screenshots and the voice-log excerpt.
- [ ] Open the PR from `feat/pinned-feedback`, only when the lead asks. The body names the Task 1 mock and states no AI-generated art.
