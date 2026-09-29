# Pinned feedback: design (GH-262)

**Status:** proposed, 2026-09-28. **Plan:** `docs/superpowers/plans/2026-09-28-pinned-feedback.md`.
**Scope:** presentation only. Nothing under `packages/sim` changes (invariant 4).

## 1. The problem, measured

Players do not understand why a unit won't move. The lead (28 Sep): a pinned unit must say so, with a sign and with a voice line.

**A move order to a pinned unit is queued, not refused.**
- `applyCommands` (`sim.ts:1934-2175`) sets the goal, the field and `moving = 1` for a pinned unit as for any other. It never reads `pinned`.
- `stepMovement` moves it at `step >> PIN_SPEED_SHIFT` (`sim.ts:4947-4948`), which is ÷64 (`tuning.ts:164`). An `inf_squad` (0.9 tiles/s) crawls about a tile a minute.
- When the pin lifts, the unit goes at full speed to the same goal.
- **The order can be lost.** A soft unit pinned for 200 ticks (10 s) routs (`sim.ts:5109-5119`). `startRout` overwrites its goal (`:3394`). The rally at unpin sets `moving = 0` (`:5099-5104`), so the old order is gone. While routed, a new move is **silently refused** (`:2074`).

**What ends a pin** (`sim.ts:5089-5122`, `tuning.ts:80-100`):
- A unit pins above suppression 0.70 and unpins below 0.45. Suppression decays at λ = 0.15/s, so with no fire the pin lasts 3.0 s from threshold, and up to 9.9 s from the 2.0 cap.
- Suppression comes from fire landing within 1.2 tiles, so the pin ends when that fire stops: the shooter dies, stops shooting, or loses sight (for example through smoke).
- Cover cuts incoming suppression to 47%, 14% and 9% at cover 1, 2 and 3. Veterancy cuts it by 8% a level.
- A pinned unit also holds fire (`sim.ts:2701, 3485`).

**What the HUD shows today:**
- Strip: `▼ {n} pinned` in `--hot`, only when n > 0 (`hud.ts:1206`), with a tooltip. `▼` is on GH-261's undrawn-dingbat list (`tools/validate_ui_palette.mjs:131`).
- Card: `PINNED` in `--hot` plus `suppression {pct}%` (`hud.ts:1777, 1784`). No tooltip.
- Chips: a text status line `{n} PINNED` in `--hot` (`selection-model.ts:305`). There is no mark on the art, and the chip tooltip says only "select only".
- Cursor: no pinned state. `cursorFor` (`input/cursor.ts:181`) reads no unit state.
- Feed and voice: nothing for an order to a pinned unit. The director answers it with the ordinary `move` line, "Moving!", which is untrue.
- Captions: only a line that *played* is captioned (`voice-runtime.ts:162`), and every `variants` list in `data/audio.json` is empty, so no caption ever shows today.

"Dock icon": the reinforcements dock holds unit *types*, and a type cannot be pinned. This design reads the phrase as the unit's icon: the chip art and the card art (the control-group bar is Q3).

## 2. Design

### 2.1 The mark

`symbol.ts` gains a status mark, `pinned`, which takes `SYMBOL_IDS` from 19 to 20. It keeps the G1 rules: filled shapes only, `W = 2.5` on the 24 box, `currentColor`, and at least a pixel of ink at 10 px. The mockup offers three shapes:
- **A, "pressed flat"** (recommended): a solid bar over a wide, shallow, filled down-chevron. It keeps the reading the strip's `▼` already taught.
- **B, "ducked"**: the APP-6 infantry cross squashed under a bar.
- **C, "incoming"**: three slanting strikes over a ground line.

The colour is `--hot`, which already means pinned in the strip, card and chip, with a 1 px halo from a new token `--mark-edge`.

| Surface | Where |
|---|---|
| Chip art | Bottom-left corner. The kit sign holds top-right. Shown when ≥1 unit is pinned and none is broken, following `chipStatus` precedence |
| Card frame | Bottom-left corner. The role badge holds top-left, the kit sign top-right |
| Card flag, strip | The mark replaces `▼` and stands before `PINNED`. `▼` joins `RETIRED_DINGBATS` |
| Cursor | New housing state (§2.3) |
| World | **None.** Mock option W only (§4) |

### 2.2 The order-feedback line

When a `move` or `attackMove` order carries ≥1 pinned unit, the feed gets one `warn` line:

> **Pinned**: 2 units can't move under fire. They go once the fire lifts.

For a group with infantry the line adds ", unless they break". An observer on `main.ts`'s `intentListeners` raises it, so every pointing surface is covered through the one `dispatch`. The observer reads unit state before the command applies. The line is throttled per pinned-id set.

### 2.3 The cursor

A new `CursorName` `pinned` is added to `UNBADGED_NAMES`.
- `cursorFor` returns it in place of `move` or `attack` when **every** id in the order intent is pinned. It reads that from a new hint, `CursorHints.pinned?: boolean`, set by the hover ticker (`main.ts:4533`).
- If only some units are pinned, the cursor stays `move`.
- The plugin draws the housing in `hot` with the mark as its payload.
- The click still issues the order.

### 2.4 The voice cue

- **Key: `<lang>.common.pinned`.** It lives in a new `COMMON_CALLS` list, since it is a call rather than a verb. `data/audio.json` declares `he.common.pinned` and `ar.common.pinned` with `variants: []` until D5.
- **Trigger: the order.** `decideOrder` asks a new optional `DirectorLook.isPinned`. If the verb is `move` or `attack` and ≥1 of its ids is pinned, the gesture answers with the pinned call rather than the move line.
  - The speaker is `speakerOf(pinned ids)`, priority `order`, and the cue is unplaced.
  - Only the pinned units are news; the rest visibly obey.
- **Throttle, like the death calls.** A pinned call inside `pinnedRepeatMs` for the same pinned-id set, or inside `pinnedGlobalMs` of any pinned call, is `silent:throttle`. It never falls back to "Moving!".
- **Script** (D2 military register; drafts for D4's native review):
  - he: «לא יכול לזוז, תחת אש!»
  - ar: «لا أستطيع التحرك، تحت النار!»
  - en: "Can't move — under fire!"
- **The caption ships now.** `VoiceCue` gains an optional `caption` i18n key. When the mixer answers `missing` or `placeholder`, the runtime captions `t(caption)` instead. Only the pinned cue carries the key, and captions stay behind `accessibility.captions` (D8). The feed line is the always-on text.

### 2.5 The explanation

One shared tooltip text, `hud.pinned.explain`, goes on the strip count, the card flag and the chip status line:

> Pinned: pressed flat by incoming fire. Barely moves and can't shoot back. Lifts a few seconds after the fire stops: kill or blind the shooter (smoke), or get out of its line. Cover pins less. Infantry pinned for 10 s break and run.

Every clause is sourced in §1. The tutorial's `pinned` step (`beit_sahwan_0.json:79-90`) teaches pinning the enemy, and it is unchanged.

### 2.6 i18n keys (`en.json`)

| Key | Text |
|---|---|
| `hud.strip.pinned` | `{n} pinned` (`▼` removed; `hud.ts` draws the mark) |
| `hud.strip.pinned.tip` | the §2.5 text |
| `hud.pinned.explain` | the §2.5 text |
| `hud.pinned.label` | `Pinned` (aria label) |
| `order.pinned.note` | `<b>Pinned</b>: {n, plural, one {# unit} other {# units}} can't move under fire. {n, plural, one {It goes} other {They go}} once the fire lifts.` |
| `order.pinned.note.soft` | the same, ending `…lifts, unless {n, plural, one {it breaks} other {they break}}.` |
| `order.broken.note` | `<b>Broken</b>: {n, plural, one {# unit} other {# units}} won't take orders until {n, plural, one {it rallies} other {they rally}}.` (Q4) |
| `voice.caption.pinned` | `Can't move — under fire!` |

## 3. Numbers for the lead

| Item | Value | Why |
|---|---|---|
| Mark on chip art (40 px) | 12 px, bottom-left, 1 px inset | The chip's kit star is 10 px, and r2 proved legibility at 10 |
| Mark on card frame (72 px) | 16 px, bottom-left, 3 px inset | Mirrors the role badge's inset |
| Mark in strip and flag | 1em (`.rl-sym`) | It replaces a character |
| Colour | `--hot` (`vfx.fire`), halo `--mark-edge` | Pinned is already `--hot` everywhere |
| Cursor | housing in `hot` + mark, unbadged | Same housing as `blocked`/`costly` |
| Voice trigger | a `move`/`attack` gesture with ≥1 pinned id | The moment of "why won't it go" |
| `pinnedRepeatMs` | 4000 ms per pinned-id set | = `kdfDeathClassMs` |
| `pinnedGlobalMs` | 2500 ms | = `kdfDeathGlobalMs` |
| Caption hold | 1.5 s + 1 s extra | Stands in for a take's length |
| Feed-line throttle | 4000 ms per pinned-id set | One line per burst of clicks |

## 4. Gate: the mockup comes first

Plan Task 1 draws the candidate marks and produces a mockup sheet. It shows A, B and C on the chip, the card, the strip and the cursor, at gameplay size and at ×4, on the real plate colours.

**Option W**, the mark over a pinned unit's head in the world, appears on that sheet only as an option. It is labelled "not recommended: no status marks in the world (27 Sep)".

Nothing visible is wired until the lead picks. The voice, the feed line and the tooltip text do not depend on the choice and may land first.

## 5. Open questions

| # | Question | Recommended default |
|---|---|---|
| Q1 | Which mark? | **A**, "pressed flat" |
| Q2 | Also speak on the `pinned` event for a selected unit? | **No.** The event flaps under sustained fire, and an unprompted line is noise |
| Q3 | Mark on the control-group bar? | **No.** The bar has no art for a corner mark, and the strip covers the force |
| Q4 | A feed line for an order refused to a routed unit? | **Yes.** It is the one truly dropped order, and it is silent today |
| Q5 | Show the pinned caption with captions off? | **No.** D8 stands; the feed line is the always-on text |
| Q6 | Any in-world mark? | **None.** Option W in the mock only |
| Q7 | The §2.4 scripts | Drafts until D4's native review; text only until D5 |
