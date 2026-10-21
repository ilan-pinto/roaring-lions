# S-F: the fire-support menu in the shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player can use all four fire-support calls F1 (#625) put in the runtime (smoke screen 60,
mortar barrage 120, drone sweep 150, precision strike 250), and no chrome line still describes the intel
trickle F1 removed.

**Architecture:** One app-side table (`ui/support-kinds.ts`) keyed by the sim's own `SupportKind` holds
every per-kind presentation fact (catalogue keys, cursor, mark, hotkey action, telemetry verb, announcer
ids, copied round timings). The dock, the keymap, the pointer, the cursor, `IntelMoments`, the HUD strip
and telemetry all read it, so a fifth kind is one row. The renderer maps a `strike` event's `profile` to
a look and tells a called smoke round from a carrier's. `packages/sim` is not edited.

**Tech Stack:** TypeScript strict, vitest (+ jsdom for DOM specs), three.js renderer, i18n `t()` over
`packages/app/src/i18n/en.json`.

**Spec:** `docs/superpowers/plans/2026-10-04-gf1-fire-support-intel.md`, section "Lane A needs
(WP-S-F #184)" and rulings F-Q7, F-Q8, F-Q10, F-Q11; `docs/superpowers/plans/2026-10-04-stage4-order.md`
"Lane A beside it"; issue #184; `docs/polish/intel-moments.md` (GH-113 as built).

## Global Constraints

- Never edit anything under `packages/sim/`. The determinism pins (flat, relief, orders in
  `packages/sim/src/determinism.test.ts`), `pnpm balance` and every `pnpm playtest` line must be
  byte-identical to the branch base. Any move is a defect: stop and report.
- Never edit `data/missions/*.json`.
- Every chrome string goes through `t()`; tables hold catalogue KEYS resolved at render time, never text
  resolved at module load. `pnpm validate:ui` must pass (no colour literals, no bare chrome strings).
- Colour only through theme tokens: support tile and cost `--info`, armed `--live`, short of intel
  `--disabled-opacity`; a countdown is `--info`, never `--on`.
- The earn line and the call lines are feed lines only: **no world mark** for an earn or a call
  (standing ruling "no status marks in the world"). The aim footprint ring under the armed cursor already
  exists (GH-113) and is the one exception, per kind below.
- F-Q11 (lead, 14 Oct): the intel `+N/min` and the support tile's clock retire; logistics keeps its own
  `+N/min`. The strip shows the last earn instead.
- F-Q10 (lead, 11 Oct): every armed support click resolves through `pointerPoint`, so a click on a
  building wall aims at that building; a test per kind.
- F-Q8: `onStrike` keeps the 18-puff air-strike look for profile 0 only; a barrage round (profile 1)
  lands as a mortar shell (`shell_impact`); a smoke round lays its screen (the sim's grid, drawn by
  `SmokeMesh` already) and throws no launcher pop at its caller.
- F-Q7: an earn is a `minor` alert, tone `info`; an objective's earn writes no line of its own; the cue
  stays silent.
- Support calls take no unit voice ack. New announcer ids ship caption-only (`"audio": ""`).
- No new cursor or symbol art: the barrage reuses the strike sight and the smoke screen the smoke sight
  (the `CURSOR_ALIAS` precedent, "reuse, not draw"). New marks are a mock-first follow-up for the lead.
  *Superseded by the S-F support-marks plan (2026-10-15): the barrage and the smoke screen draw marks and cursors of their own.*
- Tile words must never collide with the unit order "smoke" (`f`): the smoke screen's tile word is
  "screen".
- Telemetry: a new verb is added to `data/schemas/telemetry_event.schema.json`'s `orderVerb` enum and
  `packages/data/src/telemetry.ts`'s `TELEMETRY_ORDER_VERBS` in one change (the Worker's `/stats` rows
  derive from that array).
- Every new check is seen RED by a one-line mutation of the implementation, then green; quote the
  mutation and its red output in the commit message.

## Review Focus

1. **A hotkey pressed while the feed/dialog/pause modal is open, or with no dock (a mission with no
   `resources`, a sandbox).** Expect: nothing happens, no throw, no cue. Task 3 pins both.
2. **Intel jumps past two prices in one tick (a +30 lump from 50 to 80 crosses 60; an objective lump
   crosses two).** Expect: every newly-affordable tile flashes, but exactly one feed line and one
   announcer line (for the dearest newly-ready call). Task 5 pins it.
3. **A barrage whose caller dies before the command runs, so no `strike` event ever arrives.** Expect:
   the in-flight record expires; no readout; the snapshot stops. Task 5 pins it.
4. **Armed call refused because no surface caller is left while intel is sufficient.** Expect the
   "no unit left to call it in" line, not "not enough intel", and the deny cue. Task 4 pins it.
5. **A carrier's own `smoke` order (`f`) after this change.** Expect the launcher pop at the carrier,
   exactly as before; only a called round (layer cannot smoke, or is beyond the carrier range) drops the
   pop. Task 8 pins both directions.

---

## Standing rules for every implementer (also in `_coord/sf-rules.md`)

Worktree `/Users/ilpinto/dev/roaring-lions-ep/sf-fire-support` (branch `feat/sf-fire-support`, off
`origin/main` c8123109). Run every command there. Never cd into, install in, or run git/pnpm in
`/Users/ilpinto/dev/roaring-lions`. Gates before every commit: `pnpm lint && pnpm typecheck && pnpm test`,
plus `pnpm validate:ui` for any app string or CSS change and `pnpm validate:data` for any `data/` change.
Never run `pnpm ui:routes`, `pnpm golden-baseline` or `pnpm ui:shots`; do not start dev servers or
browsers; never `pkill`/`killall`. Git: `/usr/bin/git` by absolute path; new files `git add -- <path>`;
commit with `/usr/bin/git commit -F <msgfile> -- <paths>` (never `git add -A`, never `git checkout --
<file>`, never rebase, force-push or push). Revert a mutation by editing it back. Message ends with a
blank line then `Co-Authored-By: Claude <your model name> <noreply@anthropic.com>`. Do not dispatch
subagents.

---

### Task 1: One support table, one kind type

**Files:**
- Create: `packages/app/src/ui/support-kinds.ts`, `packages/app/src/ui/support-kinds.test.ts`
- Modify: `packages/app/src/input/intents.ts` (~L38 `support` intent, ~L241 `armed`, ~L283
  `Resolution.armed`), `packages/app/src/input/pointer.ts` (~L169), `packages/app/src/input/keymap.ts`
  (`anyArmed` ~L245), `packages/app/src/input/cursor.ts` (`CursorName`, `UNBADGED_NAMES`,
  `CURSOR_ALIAS`, `ANIMATED_CURSORS`, the `if (res.armed) return res.armed;` line ~L254),
  `packages/app/src/telemetry/events.ts` (`orderVerbOf`, the "twelve" comment on `tallyVerb`),
  `packages/data/src/telemetry.ts`, `data/schemas/telemetry_event.schema.json` (~L117),
  `packages/app/src/main.ts` (`armedSupport` ~L3669, pointerup ~L4061-4081, footprint ~L5717),
  `packages/app/src/ui/production.ts` and `packages/app/src/ui/intel-moments.ts` (type only, see Step 3),
  every spec and tools test the rename breaks (`tools/src/intel_moments_world.test.ts` calls
  `moments.called('sweep', …)`).

**Interfaces:**
- Produces (exact):

```ts
// packages/app/src/ui/support-kinds.ts
import { FIRE_SUPPORT_KINDS, type SupportKind } from '@lions/sim';
import type { CursorName } from '../input/cursor';
import type { SightOrderId } from './order-sight';
import type { TelemetryOrderVerb } from '@lions/data/telemetry';
export type { SupportKind };
/** Dock order, cheapest first: the sim's own list. */
export const SUPPORT_KINDS: readonly SupportKind[] = FIRE_SUPPORT_KINDS;

export interface SupportSpec {
  /** Catalogue KEYS, resolved with t() where drawn. */
  readonly word: string;
  readonly name: string;
  readonly blurb: string;
  /** The tile glyph, `symbolSvg(mark)`. */
  readonly mark: SightOrderId;
  /** The armed cursor. `barrage`/`smokeScreen` are CURSOR_ALIAS names. */
  readonly cursor: CursorName;
  /** The keymap action that presses this tile (Task 3). */
  readonly action: 'supportScreen' | 'supportBarrage' | 'supportSweep' | 'supportStrike';
  readonly verb: TelemetryOrderVerb;
}
export const SUPPORT: Readonly<Record<SupportKind, SupportSpec>> = {
  smoke_screen: { word: 'dock.support.smoke_screen.word', name: 'dock.support.smoke_screen.name',
    blurb: 'dock.support.smoke_screen.blurb', mark: 'smoke', cursor: 'smokeScreen',
    action: 'supportScreen', verb: 'smokeScreen' },
  mortar_barrage: { word: 'dock.support.mortar_barrage.word', name: 'dock.support.mortar_barrage.name',
    blurb: 'dock.support.mortar_barrage.blurb', mark: 'strike', cursor: 'barrage',
    action: 'supportBarrage', verb: 'barrage' },
  drone_sweep: { word: 'dock.support.drone_sweep.word', name: 'dock.support.drone_sweep.name',
    blurb: 'dock.support.drone_sweep.blurb', mark: 'sweep', cursor: 'sweep',
    action: 'supportSweep', verb: 'sweep' },
  air_strike: { word: 'dock.support.air_strike.word', name: 'dock.support.air_strike.name',
    blurb: 'dock.support.air_strike.blurb', mark: 'strike', cursor: 'strike',
    action: 'supportStrike', verb: 'strike' },
};

/** COPIED from packages/sim/src/tuning.ts (the PROJ_SPEED rule: the app never
 *  imports tuning). support-kinds.test.ts reads tuning.ts as TEXT and fails on drift. */
export const FS_AIR_STRIKE = 0;
export const FS_MORTAR_BARRAGE = 1;
export interface RoundTiming { readonly rounds: number; readonly spacingTicks: number;
  readonly delayTicks: number; readonly scatterFx: number; readonly splashFx: number }
export const ROUNDS: Readonly<Record<'air_strike' | 'mortar_barrage' | 'smoke_screen', RoundTiming>> = {
  air_strike: { rounds: 1, spacingTicks: 0, delayTicks: 60, scatterFx: 19661, splashFx: 131072 },
  mortar_barrage: { rounds: 6, spacingTicks: 36, delayTicks: 120, scatterFx: 98304, splashFx: 65536 },
  smoke_screen: { rounds: 3, spacingTicks: 40, delayTicks: 80, scatterFx: 98304, splashFx: 0 },
};
export const SMOKE_RADIUS_TILES = 3; // tuning.ts SMOKE_RADIUS
export const SWEEP_RADIUS_SQ_FX = 3932160; // tuning.ts SWEEP_RADIUS_SQ (moved here from intel-moments.ts)

/** Ticks from the call to the last round landing. */
export function lastRoundTicks(kind: keyof typeof ROUNDS): number {
  const r = ROUNDS[kind];
  return r.delayTicks + (r.rounds - 1) * r.spacingTicks;
}
/** The ring under the armed cursor, tiles: where rounds can land and what
 *  they touch. Null for the sweep (decision 6 of GH-113: its circle is not drawn). */
export function footprintTiles(kind: SupportKind): number | null {
  switch (kind) {
    case 'air_strike': return ROUNDS.air_strike.splashFx / 65536; // 2.0, unchanged
    case 'mortar_barrage': return (ROUNDS.mortar_barrage.scatterFx + ROUNDS.mortar_barrage.splashFx) / 65536; // 2.5
    case 'smoke_screen': return ROUNDS.smoke_screen.scatterFx / 65536 + SMOKE_RADIUS_TILES; // 4.5
    case 'drone_sweep': return null;
  }
}
```

- The app's two old `SupportKind` declarations (`ui/production.ts` L29, `ui/intel-moments.ts` L44) are
  deleted and re-exported from `support-kinds.ts`. Every `'sweep' | 'strike'` literal type in
  `intents.ts`, `pointer.ts`, `keymap.ts`, `main.ts` becomes `SupportKind`.
- `CursorName` gains `'barrage' | 'smokeScreen'`; `CURSOR_ALIAS` becomes
  `{ moveOnly: 'move'; attack: 'advance'; barrage: 'strike'; smokeScreen: 'smoke' }`; both join
  `UNBADGED_NAMES` (and the `UnbadgedName` union); `ANIMATED_CURSORS` gains `barrage: anim('strike')`,
  `smokeScreen: anim('smoke')`; the armed rung returns `SUPPORT[res.armed].cursor`.
- Telemetry verbs gain `'barrage'` and `'smokeScreen'` (appended after `'sweep'`, so existing counts keep
  their keys); `orderVerbOf`'s `support` case returns `i.accepted ? SUPPORT[i.call].verb : null`.

- [ ] **Step 1: Write the failing tests** in `support-kinds.test.ts`:
  - "every runtime kind has one row, in the sim's order": `Object.keys(SUPPORT).sort()` equals
    `[...FIRE_SUPPORT_KINDS].sort()` and `SUPPORT_KINDS` equals `FIRE_SUPPORT_KINDS`.
  - "the copied round timings match tuning.ts": read
    `new URL('../../../sim/src/tuning.ts', import.meta.url)` as text; read `FS_AIR_STRIKE`,
    `FS_MORTAR_BARRAGE`, `FS_SMOKE_SCREEN`, `SMOKE_RADIUS`, `SWEEP_RADIUS_SQ`, `STRIKE_DELAY_TICKS`,
    `STRIKE_SCATTER`, `STRIKE_SPLASH` with `/export const NAME = (\d+);/`; slice the text from
    `export const FIRE_SUPPORT` to the next `\n];`, split it on the row comments `// air_strike`,
    `// mortar_barrage`, `// smoke_screen`, and read each row's `rounds: (\d+)`, `spacingTicks: (\d+)`,
    `delayTicks: (\d+)`, `scatter: (\d+)`, `splash: (\d+)` (the air-strike row names constants: compare
    it to the constants read above). Assert every `ROUNDS` field and the two `FS_*` copies, and that the
    row order index equals `FS_MORTAR_BARRAGE`/`FS_SMOKE_SCREEN`. Throw when a regex misses, so a renamed
    field is red, not vacuous.
  - "footprints": `footprintTiles('air_strike') === 2`, `'mortar_barrage' === 2.5`,
    `'smoke_screen' === 4.5`, `'drone_sweep' === null`.
  - "no two tiles share a word, and none is the unit order's word": resolve the four `word` keys through
    the real `en.json` and assert four distinct values, none equal to `en['keymap.smoke']` lower-cased
    or to `'smoke'`.
  - In `packages/app/src/telemetry/events.test.ts` (extend): an accepted `support` intent of each kind
    maps to `SUPPORT[kind].verb`; a refused one maps to null; every verb is in `TELEMETRY_ORDER_VERBS`.
  - In `packages/app/src/input/cursor.test.ts` (extend): an armed resolution of each kind ranks to its
    `SUPPORT[kind].cursor`; `badgeFor` is null for all four.
- [ ] **Step 2: Run** `pnpm --filter @lions/app exec vitest run src/ui/support-kinds.test.ts` — FAIL
  (module missing).
- [ ] **Step 3: Implement** the module above, the type rename, the cursor rows, the telemetry rows and
  schema enum. Add the eight new catalogue keys to `en.json` now (texts in Task 2's table) and delete
  `dock.support.sweep.*` / `dock.support.strike.*` once nothing reads them. `main.ts`'s pointerup keeps
  calling `runtime.requestSweep`/`requestStrike` for the two kinds the dock still offers; replace its
  ternary with `runtime.requestSupport(call, fx.from(w.x), fx.from(w.y))` (the wrappers are one-liners
  over it, `mission.ts` ~L833). `IntelMoments.called` keeps two branches keyed `'drone_sweep'` /
  `'air_strike'` (Task 5 adds the rest); `intel-moments.ts` imports `SWEEP_RADIUS_SQ_FX` from the table
  and its own copy test moves to `support-kinds.test.ts`.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm --filter @lions/app test && pnpm --filter @lions/tools test
  -- intel_moments` — PASS. Also `pnpm validate:data` (schema change) and `pnpm --filter @lions/worker
  test` (stats rows read the array).
- [ ] **Step 5: See it red:** change the copied `mortar_barrage.delayTicks` to 119 — the tuning test
  fails; swap `verb: 'barrage'` to `'strike'` — the telemetry test fails. Put both back.
- [ ] **Step 6: Commit** `app: one support table keyed by the sim's SupportKind (S-F)` with the paths
  touched.

---

### Task 2: The dock offers four calls

**Files:**
- Modify: `packages/app/src/ui/production.ts` (header comment, `SUPPORT` table → `SUPPORT_KINDS`,
  `ProductionRuntime`, `ProductionOptions.supportCharge`, `buildSupportTile`, `supportTipHtml`,
  `refresh` support loop ~L373-387), `packages/app/src/ui/theme.css` (~L3525-3605),
  `packages/app/src/i18n/en.json`, `packages/app/src/main.ts` (dock construction ~L3700-3770),
  `packages/app/src/ui/production.test.ts`.

**Interfaces:**
- Consumes: `SUPPORT`, `SUPPORT_KINDS`, `SupportKind` (Task 1).
- Produces:

```ts
export interface ProductionRuntime extends DockView {
  readonly intel: number;
  supportCost(kind: SupportKind): number; // MissionRuntime's own method
  requestBuild(unitId: string): boolean;
}
// ProductionOptions:
onDeny?: () => void;                       // plays CRITICAL_CUES.uiDeny in main.ts
supportCharge?: (kind: SupportKind) => { fraction: number; title: string }; // no clock
// ReinforcementDock:
/** The tile's click, callable from a hotkey: arms or disarms `kind`, or
 *  denies with a note and the cue when intel is short. Returns true if armed. */
press(kind: SupportKind): boolean;
```

Strings (all new keys; old `dock.support.charge.eta`, `.charge.none`, `.clock.minutes`, `.clock.none`
are deleted):

| key | text |
|---|---|
| `dock.support.smoke_screen.word` | `screen` |
| `dock.support.smoke_screen.name` | `Smoke screen` |
| `dock.support.smoke_screen.blurb` | `Three smoke rounds land around a point over four seconds. It hides; it hurts no one.` |
| `dock.support.mortar_barrage.word` | `barrage` |
| `dock.support.mortar_barrage.name` | `Mortar barrage` |
| `dock.support.mortar_barrage.blurb` | `Six rounds walk around a point over nine seconds. It pins men even inside buildings.` |
| `dock.support.drone_sweep.word` | `sweep` |
| `dock.support.drone_sweep.name` | `Drone sweep` |
| `dock.support.drone_sweep.blurb` | `Reveals what is on the ground in a circle, once. It shoots nothing.` |
| `dock.support.air_strike.word` | `strike` |
| `dock.support.air_strike.name` | `Precision strike` |
| `dock.support.air_strike.blurb` | `One round on one point. It does not ask whose building it is.` |
| `dock.support.charge.short` | `{name}: {have} of {cost} intel` |
| `dock.note.noIntel` | `not enough intel for {name}: spot the enemy, hold high ground, complete objectives` |
| `dock.tip.hotkey` | `Key {key}` |

- [ ] **Step 1: Write the failing tests** (`production.test.ts`; update `fakeRuntime` to
  `supportCost: (k) => ({ smoke_screen: 10, mortar_barrage: 20, drone_sweep: 30, air_strike: 60 })[k]`
  and the `support` helper's selector to the new `data-support` values):
  - "four support tiles, in the sim's order, each showing its own price": the
    `[data-support]` elements' `dataset.support` list equals `FIRE_SUPPORT_KINDS`, and each word text
    ends in its fake price.
  - "a short click denies: a note, the cue, nothing armed": intel 15, click barrage (20): `onDeny`
    called once, the note contains the barrage name, `onArm` not called, `data-armed` stays `'0'`.
  - "an affordable click arms it and only it; a second click disarms" for every kind.
  - "`press` is the click": `dock.press('air_strike')` with intel 100 arms the strike tile and returns
    true; with intel 10 returns false and calls `onDeny`.
  - "no clock on a charging tile": after `refresh()` with intel 5, every support tile's
    `.rl-tile__clock` is absent (delete the element in `buildSupportTile`) and the aria-label is the
    `supportCharge` title.
- [ ] **Step 2: Run** `pnpm --filter @lions/app exec vitest run src/ui/production.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Build tiles with `for (const kind of SUPPORT_KINDS)` and
  `opts.runtime.supportCost(kind)`; glyph `symbolSvg(SUPPORT[kind].mark, SUPPORT_GLYPH_PX)`; move the
  click body into `press(kind)` and have the click call it then `el.blur()`; the short branch calls
  `this.opts.onDeny?.()` after the note. Drop the clock span and the `clock` field of `SupportTile`;
  keep the charge bar and `data-charging`. The tip appends `t('dock.tip.hotkey', { key })` where `key`
  is the bound key label for `SUPPORT[kind].action` — pass a `hotkeyLabel?: (kind) => string` option
  (Task 3 wires it; absent prints nothing). In `theme.css` change the row-start rule to
  `.rl-tile--support[data-support='smoke_screen'] { grid-column-start: 1; }`, delete the
  `.rl-tile__clock` rules and update the two comments that say "two support tiles"/"pair". In `main.ts`
  pass `onDeny: () => audio.playCue(CRITICAL_CUES.uiDeny)` and a `supportCharge` that returns
  `{ fraction: min(1, intel/cost), title: intel >= cost ? t('dock.support.charge.ready', { name }) :
  t('dock.support.charge.short', { name, have: intel, cost }) }` (no `IntelMoments.charge` any more).
- [ ] **Step 4: Run** the spec, then `pnpm typecheck && pnpm lint && pnpm validate:ui` — PASS.
- [ ] **Step 5: See it red:** in `press`, drop the `this.opts.onDeny?.()` call — the deny test fails;
  build tiles from `FIRE_SUPPORT_KINDS.slice(2)` — the order test fails. Put both back.
- [ ] **Step 6: Commit** `app: the dock offers four fire-support calls, with a deny cue (S-F)`.

---

### Task 3: Hotkeys Z X C V

**Files:**
- Modify: `packages/app/src/input/keymap.ts` (`Action`, `ACTIONS`, the "free keys" comments),
  `packages/app/src/i18n/en.json`, `packages/app/src/main.ts` (keydown switch ~L4337-4460, dock
  `hotkeyLabel` option), `packages/app/src/input/keymap.test.ts`,
  `packages/app/src/ui/settings-keymap.test.ts` if it counts rows.

**Interfaces:**
- Consumes: `SUPPORT[kind].action`, `ReinforcementDock.press` (Task 2).
- Produces: four `Action` ids `supportScreen` (`z`), `supportBarrage` (`x`), `supportSweep` (`c`),
  `supportStrike` (`v`), rebindable, labels `keymap.supportScreen` "Call smoke screen",
  `keymap.supportBarrage` "Call mortar barrage", `keymap.supportSweep` "Call drone sweep",
  `keymap.supportStrike` "Call precision strike". The bottom row, left to right, matches the dock's
  left-to-right order. All four letters are unbound today (h n f g u o b m, ctrl+a, tab, space, f1, i,
  w s a d, escape).

- [ ] **Step 1: Write the failing tests** (`keymap.test.ts`):
  - "the four support keys resolve to their actions": `resolveKey(defaults, {key:'z'})` →
    `'supportScreen'`, and so on; and for every kind,
    `ACTIONS.find(a => a.id === SUPPORT[kind].action)` exists (the table and the keymap cannot drift).
  - "default bindings have no collisions" (existing test, if present, now includes them; otherwise add:
    the default key multiset of non-modifier actions has no duplicate except the documented `a`
    ctrl/pan pair).
  - "a support key passes no modal": `passesThroughModal('supportStrike')` is false (only pans pass).
- [ ] **Step 2: Run** the keymap spec — FAIL.
- [ ] **Step 3: Implement** the four rows and `Action` members. In `main.ts`'s keydown switch add one
  case per action, each `production?.press('<kind>');` (or one shared branch through a
  `SUPPORT_KINDS.find(k => SUPPORT[k].action === action)` lookup) — with no dock it does nothing and
  plays nothing. The handler's existing modal guard already runs before the switch (keep it so). Wire
  `hotkeyLabel: (k) => keyLabel(bindings[SUPPORT[k].action])` into the dock.
- [ ] **Step 4: Run** `pnpm --filter @lions/app test && pnpm typecheck && pnpm validate:ui` — PASS.
- [ ] **Step 5: See it red:** bind `supportBarrage` to `'z'` — the collision test fails. Put it back.
- [ ] **Step 6: Commit** `app: Z X C V call the four fire-support tiles (S-F)`.

---

### Task 4: The armed click aims through `pointerPoint`, and says why a call was refused

**Files:**
- Create: `packages/app/src/input/support-call.ts`, `packages/app/src/input/support-call.test.ts`
- Modify: `packages/app/src/main.ts` (pointerup armed branch ~L4061-4093, footprint ~L5717-5720),
  `packages/app/src/ui/intel-moments.ts` (delete `aimFootprintFor` and `STRIKE_SPLASH_TILES`; their test
  moves), `packages/app/src/i18n/en.json`.

**Interfaces:**
- Consumes: `pointerPoint`, `PointerView` (`input/pointer.ts`), `footprintTiles` (Task 1).
- Produces:

```ts
// input/support-call.ts
import { fx, type Sim, type SupportKind } from '@lions/sim';
export interface SupportRuntime {
  readonly intel: number;
  supportCost(kind: SupportKind): number;
  requestSupport(kind: SupportKind, x: number, y: number): boolean; // Fx args
}
export type SupportOutcome =
  | { ok: true; kind: SupportKind; x: number; y: number }
  | { ok: false; kind: SupportKind; x: number; y: number; why: 'intel' | 'caller' };
/** F-Q10 (lead, 11 Oct): the point marked is the point hit -- a wall pixel aims at its building. */
export function supportAim(view: PointerView, sim: Sim, px: number, py: number): { x: number; y: number };
export function callSupport(rt: SupportRuntime, kind: SupportKind, view: PointerView, sim: Sim,
  px: number, py: number): SupportOutcome;
/** The ring under the armed cursor, at the same point the click would spend it on. */
export function aimFootprint(kind: SupportKind | null, at: { x: number; y: number } | null):
  { x: number; y: number; radius: number } | null;
```

`why` is decided AFTER a refusal, read-only: `rt.intel < rt.supportCost(kind) ? 'intel' : 'caller'`.
New key `main.note.supportNoCaller`: `support call refused — no unit left to call it in`;
`main.note.supportRefused` keeps "not enough intel".

- [ ] **Step 1: Write the failing tests** (`support-call.test.ts`): build a `Sim` (`new Sim({ seed: 1,
  width: 32, height: 32, capacity: 8 })`) with one structure (`addStructureType({ id: 'house',
  hp_per_tile: 5000, height_px: 11, color: 'dust.1' })`, tiles covering x 10-11, y 10-11), and a stub
  `PointerView` whose `screenToWorld` returns `(14.2, 9.1)` (off the footprint, the ground behind the
  wall), `structureAtScreen` returns the house, `unitAtScreen` returns -1, `isVisible` true. A recording
  runtime stores each `requestSupport` call.
  - For EACH of the four kinds (a `describe.each(FIRE_SUPPORT_KINDS)`): "a wall click aims at the
    building": `callSupport` records `(kind, fx.from(11), fx.from(11))` (the footprint centre
    `(minX+maxX+1)/2`), and `ok` is true.
  - "a ground click aims at the ground": `structureAtScreen` → -1; the recorded point is
    `fx.from(14.2), fx.from(9.1)`.
  - "refused for intel": runtime refuses, intel 10, cost 60 → `why: 'intel'`.
  - "refused with intel in hand is the caller": runtime refuses, intel 500 → `why: 'caller'`.
  - `aimFootprint`: each kind's radius equals `footprintTiles(kind)`; null for the sweep, for
    `kind === null`, and for `at === null`.
- [ ] **Step 2: Run** `pnpm --filter @lions/app exec vitest run src/input/support-call.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `supportAim` returns `pointerPoint(view, sim, px, py)`'s `{x, y}`.
  `callSupport` converts with `fx.from`. In `main.ts` pointerup's armed branch call
  `callSupport(runtime, res.armed, pointerView, sim, p.x, p.y)` and use its `x/y` for `dispatch`, the
  order marker and `intelMoments.called`; the non-moments note chooses `main.note.supportRefused` or
  `main.note.supportNoCaller` from `why`; the deny cue stays on every refusal. The footprint each frame
  becomes `renderer.aimFootprint = aimFootprint(armedSupport, armedSupport ? supportAim(pointerView,
  sim, lastCursor.x, lastCursor.y) : null)`.
- [ ] **Step 4: Run** the spec, `pnpm --filter @lions/app test && pnpm typecheck && pnpm validate:ui`.
- [ ] **Step 5: See it red:** make `supportAim` return `view.screenToWorld(px, py)` — all four
  wall-click tests fail. Put it back.
- [ ] **Step 6: Commit** `app: armed support aims through pointerPoint, per kind (F-Q10, S-F)`.

---

### Task 5: Intel moments for four calls

**Files:**
- Modify: `packages/app/src/ui/intel-moments.ts`, `packages/app/src/ui/intel-moments.test.ts`,
  `packages/app/src/voice/announce.ts` (`AnnounceEventId`), `packages/app/src/voice/announce.test.ts`
  (~L221 id list), `data/audio.json` (announcements block ~L898-921, its `$comment`),
  `packages/app/src/i18n/en.json`, `packages/app/src/main.ts` (`sayIntel` ~L3686-3697 and the
  `IntelMoments` construction ~L3675), `tools/src/intel_moments_world.test.ts` (constructor).

**Interfaces:**
- Consumes: `SUPPORT`, `ROUNDS`, `lastRoundTicks`, `FS_AIR_STRIKE`, `FS_MORTAR_BARRAGE` (Task 1).
- Produces:

```ts
export interface IntelMomentsOptions {
  readonly supportCost: (kind: SupportKind) => number;
  readonly toFx: (n: number) => number;
  readonly viewer?: number;
}
export type AnnounceId =
  | 'screen_ready' | 'barrage_ready' | 'sweep_ready' | 'strike_ready'
  | 'screen_inbound' | 'barrage_inbound' | 'sweep_inbound' | 'strike_inbound';
export const READY_ANNOUNCE: Readonly<Record<SupportKind, AnnounceId>>;   // smoke_screen -> 'screen_ready', ...
export const INBOUND_ANNOUNCE: Readonly<Record<SupportKind, AnnounceId>>;
// IntelOutput: 'announce' carries `event: AnnounceId`; 'ready' carries `support: SupportKind`;
// new: | { kind: 'barrageResult'; down: number; hit: number; building: boolean; civiliansKilled: number }
```

Behaviour:
- `called(kind, x, y, tick)`:
  - `drone_sweep`: as today (note `intel.note.sweepInbound`, info, important; `sweep_inbound`; info ring).
  - `air_strike`: as today; in-flight record `{ kind: 'air_strike', until: tick + 60 + 20 }`.
  - `mortar_barrage`: note `intel.note.barrageInbound` `{ n: 6 }` (= `ROUNDS.mortar_barrage.delayTicks /
    20`), tone `warn`, tier `important`; `barrage_inbound`; warn ring. In-flight record
    `{ kind: 'mortar_barrage', until: tick + lastRoundTicks('mortar_barrage') + 20, landed: 0, killed:
    Set, hit: Set, building: false, civilians: 0 }`.
  - `smoke_screen`: note `intel.note.screenInbound` `{ n: 4 }`, tone `info`, tier `important`;
    `screen_inbound`; info ring. No in-flight record and no readout (the screen is the result).
- The snapshot is taken while a sweep, strike or barrage is in flight.
- `strike` events: `e.profile === FS_AIR_STRIKE` feeds today's strike readout (its record is the oldest
  air-strike record); `e.profile === FS_MORTAR_BARRAGE` feeds the oldest barrage record: kills by
  `e.by` inside `ROUNDS.mortar_barrage.splashFx` of `(e.x, e.y)` go to `killed` (hostile) or count as
  civilians; hostiles inside that splash whose hp fell versus the snapshot go to `hit`; a
  `structureHit` by `e.by` this tick sets `building`. On the sixth round, push one readout at
  `tick + STRIKE_READOUT_DELAY_TICKS`: `{ kind: 'barrageResult', down: killed.size, hit: |hit \ killed|,
  building, civiliansKilled }`, and drop the record. A record past `until` is dropped silently, with no
  readout if no round landed, and with the readout of what landed otherwise.
- Ready: after each tick, collect every kind newly affordable (`prev === false && now`). Push
  `{ kind: 'ready', support }` for each (each tile flashes) and ONE note + ONE announcement for the
  dearest of them by `supportCost`: note `intel.note.ready` `{ kind }`, tier `minor`, tone `info`;
  announce `READY_ANNOUNCE[kind]`.
- `charge()` and `IntelRate` stay until Task 6.

Strings (replace `intel.note.ready`, `intel.note.sweepInbound`, `intel.note.strikeInbound`,
`intel.note.sweepResult` texts; add the rest):

| key | text |
|---|---|
| `intel.note.ready` | `<b>{kind, select, smoke_screen {Smoke screen} mortar_barrage {Mortar barrage} drone_sweep {Drone sweep} other {Precision strike}}</b> ready` |
| `intel.note.sweepInbound` | `<b>Drone sweep</b> on the way` |
| `intel.note.strikeInbound` | `<b>Precision strike</b> inbound — {n} s` |
| `intel.note.barrageInbound` | `<b>Mortar barrage</b> inbound — {n} s` |
| `intel.note.screenInbound` | `<b>Smoke screen</b> inbound — {n} s` |
| `intel.note.sweepResult` | `<b>Drone sweep</b> — {n, plural, =0 {no contacts} one {# contact} other {# contacts}} identified` |
| `intel.note.barrageResult` | `Barrage: <b>{effect}</b>` |
| `announce.screenReady` | `Smoke is up.` |
| `announce.barrageReady` | `Mortars ready.` |
| `announce.screenInbound` | `Smoke inbound. Four seconds.` |
| `announce.barrageInbound` | `Mortars inbound. Six seconds.` |

`data/audio.json` gains `screen_ready`, `barrage_ready` (cooldown 20, `normal`) and `screen_inbound`,
`barrage_inbound` (cooldown 2, `high`), each `"audio": ""`, and the `$comment` sentence on GH-113 gains
"S-F (2026-10-15): screen_*/barrage_* for the two new calls, caption-only until recorded". `main.ts`
words a `barrageResult` exactly like `strikeLine` but with `intel.note.barrageResult` (extract a shared
`effectText(o)` from `strikeLine`).

- [ ] **Step 1: Write the failing tests** (`intel-moments.test.ts`, using its existing board fixtures):
  - per kind, `called` returns its note key, tone, `important` tier, its `INBOUND_ANNOUNCE` id and a ring
    of the right tone; smoke screen returns no in-flight state (`beforeTick` takes no snapshot after it
    alone — assert via a `take` spy or by a board mutated before the next tick being ignored).
  - "a barrage reports once, after its sixth round": six `strike` events with `profile: 1` at the
    barrage's ticks, one killing a hostile and one hurting another; no `barrageResult` before the sixth,
    exactly one `STRIKE_READOUT_DELAY_TICKS` after it, `down: 1, hit: 1`.
  - "a profile-1 round is never read as a precision strike": no `strikeResult` is ever produced for it.
  - "a barrage whose rounds never come expires silently" (Review Focus 3): `called('mortar_barrage')`,
    step past `until` with no events: no output, and `beforeTick` stops snapshotting.
  - "two prices crossed in one tick: every tile flashes, one line, one voice" (Review Focus 2): costs 60
    and 120, intel 50 → 130 in one tick: two `ready` outputs, one `note` with `{ kind: 'mortar_barrage' }`,
    one `announce` `barrage_ready`.
  - `announce.test.ts`: the id list includes the four new ids and each has a caption in `en.json` and a
    row in `data/audio.json` (extend the existing table check).
- [ ] **Step 2: Run** `pnpm --filter @lions/app exec vitest run src/ui/intel-moments.test.ts
  src/voice/announce.test.ts` — FAIL.
- [ ] **Step 3: Implement** as above; update the module's header doc ("Four jobs") to four calls;
  construct with `supportCost: (k) => runtime.supportCost(k)` in `main.ts` and in the tools test.
- [ ] **Step 4: Run** `pnpm --filter @lions/app test && pnpm --filter @lions/tools test --
  intel_moments && pnpm typecheck && pnpm validate:ui && pnpm validate:data` — PASS.
- [ ] **Step 5: See it red:** route profile-1 events to the strike readout — the "never read as a
  precision strike" test fails; announce every newly-ready kind — the two-prices test fails. Put back.
- [ ] **Step 6: Commit** `app: intel moments for the smoke screen and the barrage (GH-113, S-F)`.

---

### Task 6: The last earn replaces the rate and the clock (F-Q11), and the earn line (F-Q7)

**Files:**
- Modify: `packages/app/src/ui/intel-moments.ts` (delete `IntelRate`, `chargeClock`, `ChargeClock`,
  `CLOCK_SECONDS_UNDER`, `INTEL_RATE_WINDOW_TICKS`, `charge()`; add the earn half),
  `packages/app/src/ui/intel-moments.test.ts`, `packages/app/src/ui/hud-model.ts` (`intelRate` →
  `intelLastEarn`), `packages/app/src/ui/hud.ts` (~L1622-1631), `packages/app/src/ui/hud.test.ts`,
  `packages/app/src/main.ts` (mission view ~L2689; the mission-event loop ~L4788 hands `intelEarned`
  events to the moments), `packages/app/src/ui/cues.ts` (the `intelEarned` silent reason, L78),
  `packages/app/src/i18n/en.json`, `tools/src/intel_moments_world.test.ts` (claim 1).

**Interfaces:**
- Consumes: `MissionEvent` `intelEarned` (`{ amount, cause: 'identified'|'objective'|'highGround', at }`).
- Produces:

```ts
export const LAST_EARN_SHOW_TICKS = 30 * TICKS_PER_SECOND;
export interface LastEarn { readonly amount: number; readonly cause: 'identified' | 'objective' | 'highGround'; readonly tick: number }
// IntelMoments:
/** The tick's mission events; returns the earn feed lines. */
earned(events: readonly MissionEvent[], tick: number): IntelOutput[];
/** What the strip shows beside intel, or null once LAST_EARN_SHOW_TICKS have passed. */
lastEarn(tick: number): LastEarn | null;
// new IntelOutput member:
| { kind: 'earn'; cause: 'identified' | 'highGround'; amount: number; at: { x: number; y: number } }
// hud-model MissionView: intelLastEarn?: { amount: number; cause: 'identified' | 'objective' | 'highGround' }
```

Rules: every `intelEarned` updates the last earn (several in one tick: the last one, and amounts of the
same cause in that tick are summed). `identified` → one `earn` output per event (the feed's identical-line
merge turns three into "×3"); `highGround` → one `earn` with `at`; `objective` → no output (the objective
alert already says it). `main.ts` words `earn` as a `minor`, `info` note: identified
`t('intel.note.earnIdentified', { n })`, high ground `t('intel.note.earnHighGround', { n, place })` where
`place` is worded exactly as `ui/alerts.ts` words its `{place}` param (grep `alert.place.` there) from
`alertWorld.placeOf(at.x, at.y)`. The strip prints
`<span class="rl-dim">${t('hud.strip.intel.lastEarn', { n, cause })}</span>` after the word, only while
`intelLastEarn` is set; the logistics `+N/min` is untouched. The tile already lost its clock in Task 2.

| key | text |
|---|---|
| `hud.strip.intel.lastEarn` | `+{n} {cause, select, identified {spotted} objective {objective} other {high ground}}` |
| `intel.note.earnIdentified` | `+{n} intel — contact identified` |
| `intel.note.earnHighGround` | `+{n} intel — high ground · {place}` |

`cues.ts` L78 reason becomes "the feed carries each earn and the strip shows the last; a chime per
identification would nag" (still `silent`, still over 10 characters).

- [ ] **Step 1: Write the failing tests:**
  - `intel-moments.test.ts`: "identified pays a line each, objective none, high ground one with its
    tile"; "lastEarn is the latest, summed within a tick, and gone after LAST_EARN_SHOW_TICKS"
    (tick + 600 → null, tick + 599 → present); "an earn with nothing else going on takes no snapshot".
  - `hud.test.ts`: with `intelLastEarn: { amount: 30, cause: 'highGround' }` the intel span contains
    "+30 high ground"; with `intelLastEarn` absent and `logisticsRate: 12` the intel span contains no
    `/min` while the logistics span still shows `+12/min`.
  - `tools/src/intel_moments_world.test.ts` claim 1, rewritten: stand a minute on
    `umm_zeitoun_4_clearance` with no contact (keep its sim-event oracle `contacts === 0`), feed every
    tick's mission events to `moments.earned`; assert no `earn` output, `runtime.intel` unchanged and
    `moments.lastEarn(sim.tickCount) === null`. Replace the header paragraph for claim 1 accordingly.
- [ ] **Step 2: Run** the three specs — FAIL.
- [ ] **Step 3: Implement**; delete the rate and clock code and their tests; `main.ts` sets
  `intelLastEarn: intelMoments?.lastEarn(sim.tickCount) ?? undefined` and routes `earn` in `sayIntel`.
- [ ] **Step 4: Run** `pnpm --filter @lions/app test && pnpm --filter @lions/tools test --
  intel_moments && pnpm typecheck && pnpm lint && pnpm validate:ui` — PASS.
- [ ] **Step 5: See it red:** make `lastEarn` ignore the window — the expiry test fails; emit a line for
  `objective` — the "objective none" test fails. Put back.
- [ ] **Step 6: Commit** `app: the strip shows the last earn, the feed each earn; the intel rate retires (F-Q11, F-Q7, S-F)`.

---

### Task 7: Every chrome line F1 made false

**Files:**
- Create: `packages/app/src/i18n/fire-support-wording.test.ts`
- Modify: `packages/app/src/i18n/en.json`, `packages/app/src/ui/hud.ts` (~L2455, the `markTarget` cap),
  `packages/app/src/i18n/player-wording.test.ts` only if an exemption is needed.

Census (re-grep `en.json` for `intel`, `sweep`, `strike`, `watch`, `still`, `stationary`, `Satellite`,
`/min` before editing; and `data/tutorial/`, `data/hints/`, which at c8123109 name only
`hud.hint.first.intel`):

| key | today | after |
|---|---|---|
| `hud.card.cap.markTarget` | earns intel while stationary | deleted; `hud.ts` no longer pushes a cap for `canMarkTarget` (the ability has no effect since F1: any unit that identifies earns) |
| `hud.hint.first.sniper` | …earns intel while it sits still… | `a sniper outranges infantry: put it on high ground, where every enemy it identifies earns intel` |
| `hud.strip.intel.tip` | Intel — spent on sweep and precision-strike fire support. | `Intel — earned by identifying the enemy, holding high ground and completing objectives; spent on fire support.` |
| `hud.hint.first.intel` | intel, beside it, buys sweep and precision-strike fire support | `intel, beside it, buys fire support: smoke, mortars, a drone sweep or a precision strike` |
| `main.note.supportCalled` | `<b>{name} called</b> on ({x}, {y})` | `<b>{name} called</b>` (the fallback line when no moments run; grid coordinates no player reads) — drop `x`/`y` from its call in `main.ts` |

(`dock.note.noIntel`, `dock.support.*.name`, `intel.note.*` and `main.note.supportRefused` were fixed in
Tasks 2, 4 and 5; this task's test holds all of them.)

- [ ] **Step 1: Write the failing test** `fire-support-wording.test.ts`: walk every `en.json` value
  through `playerText` (exported by `player-wording.test.ts`; if importing a test file is refused by the
  linter, copy its ICU-stripping into a small shared `i18n/player-text.ts` and import it from both) and
  assert none matches `/watch longer|while (it sits )?still|while stationary|satellite|sweep and precision-strike|at the current intel rate|no intel coming in/i`; and that `en.json` has no
  `hud.card.cap.markTarget`, `dock.support.charge.eta`, `dock.support.charge.none`,
  `dock.support.clock.minutes` or `dock.support.clock.none` key.
- [ ] **Step 2: Run** — FAIL on the census rows.
- [ ] **Step 3: Implement** the table.
- [ ] **Step 4: Run** `pnpm --filter @lions/app test && pnpm typecheck && pnpm validate:ui` — PASS.
- [ ] **Step 5: See it red:** restore "watch longer" in `dock.note.noIntel` — the test fails. Put back.
- [ ] **Step 6: Commit** `app: no chrome line still describes the intel trickle (S-F)`.

---

### Task 8: A barrage lands as mortar shells, a called smoke round lays its screen

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts` (`smokeLaid` branch ~L4511-4529, `strike`
  branch ~L4530, `onStrike` ~L5316, `spawnShellImpactFx` ~L8902), `packages/render/src/overlay.ts`
  (~L219-224), `packages/render/src/three/ThreeRenderer.vfx-triggers.test.ts`.

**Interfaces:**
- Consumes: sim `strike` event `{ by, x, y, profile }`, `smokeLaid` `{ by, x, y }`.
- Produces (private, render-only):

```ts
// ThreeRenderer
/** COPIED from tuning.ts (FS_MORTAR_BARRAGE, SMOKE_RANGE_SQ); the vfx-triggers spec reads tuning.ts as text. */
const FS_MORTAR_BARRAGE = 1;
const CARRIER_SMOKE_RANGE_SQ_TILES = 5242880 / 65536; // tuning.ts SMOKE_RANGE_SQ, 80 tile^2
private onStrike(e: { x: Fx; y: Fx; tick: number; profile: number }): void; // profile 1 -> mortar landing, else the 18 puffs
private spawnShellLandingAt(kind: ShellKind, tx: number, ty: number): void; // spawnShellImpactFx's body
/** A smokeLaid whose layer cannot lay smoke itself, or stands beyond a carrier's own range of the point, is a called round. */
private isCalledSmoke(by: number, sx: number, sy: number): boolean;
```

Behaviour: `spawnShellImpactFx(s)` becomes a one-line call of `spawnShellLandingAt(s.kind, s.tx, s.ty)`
(no behaviour change for flown shells). `onStrike` with `profile === FS_MORTAR_BARRAGE` calls
`spawnShellLandingAt('mortar', x, y)` — the burst, light, shake, hit-stop, crater and scorch of a mortar
bomb at its own `impactPower` — and spawns none of the 18 flat puffs; any other profile draws the 18
puffs exactly as today. A `smokeLaid` that `isCalledSmoke` throws no `smoke_discharge` at the layer and
instead spawns the `mortar_base_dust` emitter at the point (a shell's thud; the screen itself is
`SmokeMesh`'s, from the sim grid); otherwise the carrier pop is unchanged, versus visibility rule
included. `isCalledSmoke`: `by < 0`, or `!sim.unitTypes[typeIdx[by]].canSmoke`, or squared distance from
the layer's `curX/curY` to `(sx, sy)` greater than `CARRIER_SMOKE_RANGE_SQ_TILES`. The debug overlay's
`strike` line reads `<b>MORTAR BARRAGE</b> round, called by …` for profile 1 and keeps
`PRECISION STRIKE` otherwise.

- [ ] **Step 1: Write the failing tests** (`ThreeRenderer.vfx-triggers.test.ts`, its `world`/`record`
  harness; import `shell_impact.json` and `mortar_base_dust.json` into `ALL` if absent):
  - "a barrage round lands as a mortar shell": `onEvents([{ kind: 'strike', tick: 1, by: shooter, x,
    y, profile: 1 }])` → log contains `shell_impact`; the flat-fx pool gained no 18 puffs (count
    `priv(r)` flat fx before/after, or spy `spawnFlatFx` and expect 0 calls).
  - "a precision strike keeps its 18 puffs and no shell burst": `profile: 0` → `spawnFlatFx` called 18
    times; log lacks `shell_impact`.
  - "a called smoke round throws no launcher pop at its caller" (Review Focus 5, half 1): a layer whose
    type has no `smoke` ability → log lacks `smoke_discharge`, contains `mortar_base_dust`.
  - "a carrier far from its point is a called round": a `GUNNER` (can smoke) 20 tiles from the point →
    no `smoke_discharge`.
  - The existing "laying smoke throws smoke_discharge at the unit that laid it" stays green (half 2).
  - "the copied numbers match tuning.ts": read `FS_MORTAR_BARRAGE` and `SMOKE_RANGE_SQ` as text.
- [ ] **Step 2: Run** `pnpm --filter @lions/render exec vitest run src/three/ThreeRenderer.vfx-triggers.test.ts` — FAIL.
- [ ] **Step 3: Implement** as above. Update `onStrike`'s doc comment (profile mapping, F-Q8).
- [ ] **Step 4: Run** `pnpm --filter @lions/render test && pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: See it red:** make `isCalledSmoke` return false — the two called-round tests fail; drop
  the profile check in `onStrike` — the barrage test fails. Put back.
- [ ] **Step 6: Commit** `render: a barrage round lands as a mortar shell, a called smoke round as a thud (F-Q8, S-F)`.

---

## Controller close-out (not a subagent task)

1. Whole-branch review (fresh dispatch), one fix wave if needed.
2. Pins: `pnpm test:determinism` green and the three hashes unchanged; `pnpm balance` and `pnpm playtest`
   byte-identical to the base outputs (excluding timing lines); `pnpm validate:data`, `pnpm validate:ui`.
3. Golden band: list every scenario in `tools/src/golden-diff/capture-protocol.ts`, name which carry a
   `mission=` URL with `resources` (the dock and the intel strip draw only there) and say in the PR which
   band moves and that a CI bless is needed after merge if CI's `visual` job goes red.
4. UI proof in one browser on a free port (not 5177), music off: a resources mission, press each of the
   four tiles and each hotkey, read back `canvas.dataset.cursor`, call each kind, read the feed.
5. Ready PR, not merged.
