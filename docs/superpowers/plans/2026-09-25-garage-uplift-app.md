# The Garage Uplift, Plan 1 (Lane A, App): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make kit something you can see and buying it something you feel, everywhere the app draws a unit. A purchase re-renders the garage in place: no blank frame, and the selection, the tab, all three scroll offsets and focus are kept. It then sweeps, stamps, counts and sounds. Every rail card carries three pip columns and says **Earned**, **Bought** or **Maxed**. The bay shows a kitted plate framed in steel with the kit mark, and its stat panel draws base, kit and preview as three segments that stay in view. The board shows three compact tracks at once, prices spent and to-max, and never prints a line that changes nothing. A locked unit shows its tracks read-only. The keyboard reaches the bay in two Tab stops. The HUD card shows the same kit in a mission.

**Architecture:** Everything lives in `packages/app` and `tools/src/ui-review`, plus four edits outside lane A that the spec requires (R-1, R-2, R-9). The repository's pattern holds: **pure model code with its own `*.test.ts`, under a thin DOM layer.** The new pure modules are:
- `ui/kit-sign.ts`: the kit's vocabulary. It holds the placeholder glyph sheet behind one constant, the pips, and `kitSummary`.
- `ui/garage-model.ts`: the screen's decisions. Selection, focus, card status, roving, purchase outcome and the count.

`showBrigade` loses its stat panel and its board to two new modules. Each has an exported, tested pure half and a DOM builder under it:
- `ui/garage-stats.ts`: `previewDeltas`, `statBar` and `statPanel`.
- `ui/garage-board.ts`: `trackSummary`, `rungState`, `visibleBenefits` and `trackEl`.

`kitLevel` joins `applyUpgrades` in `@lions/data`. The purchase protocol keeps its shape: the screen still only asks. The caller then answers with the account as `LedgerStore` now holds it (`GarageState`), and the screen redraws itself around that answer.

**Tech Stack:** TypeScript strict, vitest (node for pure modules, jsdom for DOM ones), Vite, Playwright (tools only), Python 3 + numpy + ffmpeg (Task 12 only). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-garage-uplift-design.md` (WP-S3g, #238), merged 24 Sep with D1–D9 accepted at their recommended defaults. It is binding. Its §1 audit (F1–F10) is what this plan fixes. Its §3.1, §3.2, §3.4 (the HUD card), §3.5 and §4 are what this plan builds, and its §6 supplies the numbers. §8 names this as **plan 1, lane A**. Plans 2 (renderer) and 3 (art) are out of scope.

**Status and entry.** This plan runs on `feat/garage-uplift-app`, cut from `main` at `e3b80317`, in `/Users/ilpinto/dev/roaring-lions-ep/s3g-app`. `main` at that commit already carries #237, the garage filter fix (`bucketVisible` in `role.ts`, `.rl-garage__card[hidden]`), and #234, the win-credits screen. Neither changes a line this plan edits, apart from the filter rule's own CSS. Task 0 re-checks `main` before Task 1. No numbers wait on approval: spec §6 was approved with D1–D9.

## Global Constraints

These are binding on every task. They come from the spec, CLAUDE.md and the brief.

- **Lane A.** Write only under `packages/app/**` and `tools/src/ui-review/**`. There are four named exceptions, each confined to one task:
  - `packages/data/src/upgrades.ts` and `index.ts` (Task 1, R-1).
  - `packages/render/src/audio.ts` and its test (Task 11, R-2).
  - `data/audio.json` (Tasks 11 and 12).
  - `tools/gen_audio.py` and `assets/audio/ui_*/**` (Task 12, R-9).

  **No `packages/render/src/three/**`, no `ThreeRenderer.ts`, no `packages/sim/**`, no art.** `git diff --stat e3b80317..HEAD -- packages/sim packages/render/src/three` is EMPTY at every commit.
- **The sim is untouched** (invariant 4). The HUD reads kit from the app's own account read, never from sim state it did not already read.
- **Colour only from semantic tokens.** Task 2 adds `--kit` (`--rl-gunmetal-0`, D3) and `--kit-edge` (`--rl-shadow-0`) to `theme.css`. From then on, nothing outside `theme.css` names an `--rl-*` variable. There are no hex, `rgb()` or `rgba()` literals anywhere in UI source; use `color-mix()` for translucency. Every new length is a `rem`. A `px` ≥ 4 in `theme.css` fails `validate:ui` unless it is tagged `/* px-ok */`, and only a media-query breakpoint needs that tag here. **Never write a glob such as `**/*.ts` inside a CSS comment:** the `*/` closes the comment early, PostCSS returns a 500, and `ui:routes` then times out in a way that looks like load.
- **Text only through `t()` and `en.json`.** Task 2 adds every catalogue key the plan needs in one place. No later task adds a key, and Task 13 deletes the one key that no source names any more. A proper noun is tagged `/* i18n-ok */`, but nothing here needs one. A glyph is SVG, never a Unicode dingbat. Phase 3's `dingbatFailures` gate is coming, and the kit's glyphs must not be what trips it.
- **The brigade account is read only through `LedgerStore`.** `main.ts`'s garage answers a purchase by re-reading `accountState()`, which calls `ledgerStore.readAccount()`. No screen names a storage key. The tools' seed writes the two keys directly: it is a harness standing in for a player, not app code, and it is checked by reading its own output back through `memoryLedgerStore` (Task 4).
- **The screen only asks.** `showBrigade` never mutates an account. Its three purchase callbacks may now *return* `GarageState`, and a returned state is the only thing that moves the screen.
- **Symbols are placeholders behind one constant.** The S3e family is not drawn yet (G1, #165). The kit mark and the three track glyphs live in `ui/kit-sign.ts` as `KIT_SYMBOLS`, the one line G1's approved sheet replaces. Every consumer draws through `kitSymbolSvg`. The placeholders are tested against the family's properties (one viewBox, `currentColor`, ink at 10 px, the chevron's sweep), so an approved drawing does not rewrite the tests. The pips are CSS squares (spec §6), not glyphs.
- **Pure logic goes into pure, exported, tested functions.** DOM tests open with `// @vitest-environment jsdom`. There is no `any`, and **no non-null assertion in new code, tests included**: narrow, or throw a named error in a fixture helper. Any storage read takes an injected store: `window.localStorage` is a bare `{}` on local Node 25 and a real `Storage` on CI's Node 22.
- **Frame loops call the bare global `requestAnimationFrame` at call time**, never a captured reference, so `FREEZE_FRAME_LOOP_STATEMENTS` still freezes them. A screen cancels its own rAF in its disposer.
- **Every check has an input that makes it fail, and that input has been run.** Each task's last step names its mutations. Each is applied, seen red, and undone **by reverting the edit**, never with `git checkout -- <file>`. The commit body says what was seen red.
- **Visual verification uses `ui:shots` and `ui:routes`** on ports **5193–5199** only, always with an explicit `--port`. `claimPort` refuses a busy port with exit 2; pick the next free one. Port 5177 belongs to the lead. **Never kill a process you did not start. Never `pkill`**; a server you started is stopped by its own tool. The garage is not in the golden gate's captures, and the gate's scenarios boot a fresh account. No bless is budgeted. The local darwin baseline is stale (since 2026-09-03), so a local `golden-baseline` run is not evidence. CI's `visual` job on the PR is.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus `pnpm validate:audio` in Tasks 11–12, plus whatever the task names. Then `git diff --stat e3b80317..HEAD -- packages/sim` must be empty.
- **Git hygiene.** Call `/usr/bin/git` by absolute path, one command per call. Stage with `git add <paths>`, then `git commit -s -F <msgfile> -- <paths>`. Never use `-A`, never `git checkout -- <file>`, never amend, and never push from a task. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Size.** Each task touches at most five authored files and about 400 changed lines, tests included. Task 12's four encoded clips are the tool's output and are listed, not counted.

## Rulings taken while planning

Each ruling settles a conflict between the spec, the brief and today's code, and says which way it went.

- **R-1: `kitLevel` goes in `@lions/data`, although the lane is `packages/app`.** The spec (§3.1) puts it "beside `applyUpgrades`, shared by garage, HUD and renderer option", and plan 2's `unitKit` feed needs the same rule. `data` is a leaf that every lane reads. The edit is one pure function plus a counts helper and their tests, and nothing else in the package changes.
- **R-2: the synth branch is the plan's one edit under `packages/render`, against the brief's "no `packages/render`".** Spec §3.5 and §8 put the branch in plan 1, in `audio.ts`, "not a `three/` file". Without it, `playUi` sends an unknown set name to the *alert's* falling tone, which is the one outcome the spec rules out ("a missing clip never sounds like an alert"). The edit is two `else if` arms, it never touches `three/**` or `ThreeRenderer.ts`, and it is isolated in Task 11. If the lead holds `packages/render` closed, that task's `audio.ts` and `audio.test.ts` lift out whole into a render-lane PR, and the app wiring still stands.
- **R-3: re-rendering in place goes through the callbacks' return value, not a second exported `update()`.** The router's mount still returns a `Disposer`, and "the screen only asks" still holds. A callback that returns nothing keeps today's behaviour: the Buy stays disabled for that render. That keeps every existing test and caller valid.
- **R-4: focus follows a key, not a node.** Every focusable control carries `data-focus-key`: `tab:<bucket>`, `card:<id>`, `unit-buy`, `track:<name>`, `rung:<name>:<tier>`, `buy:<name>` or `reset`. A Buy's key names its track and not its tier, so after a purchase the same key finds the *next* Buy, which is what "moves focus to the next Buy" means. Where the key is gone, `restoreFocus` has a fixed fallback chain.
- **R-5: the bars scale against the roster's *fully kitted* maximum.** Scaling against base JSON, as today, leaves the strongest unit no room to draw its kit segment: the Lavi's 3000 hp is the roster's maximum, so its 750 of kit would clamp to zero. Every existing bar test still holds, because none of its fixtures upgrades the roster-maximum unit.
- **R-6: a *future* rung's preview is also corrected, not only F5's owned rung.** Today's code applies `after − before` of the hovered rung, which is tier N minus tier N−1. With armour 1 owned, hovering tier 3 therefore previews 300 hp where the truth is 540. `previewDeltas` computes tier N minus the owned tier on that track, and the sweep test checks it against `applyUpgrades` for every shipped unit.
- **R-7: F9's layout (height fixed inside the viewport; board widens at ≥ 2200 px) goes in the board task.** Spec §4 has it, but §8's plan 1 list does not name it. It belongs here because the compact board is what makes the height fit. **Spec §4 "Comparison"** (ghosting on Shift, and sorting by kit level) is in §4 and in none of §8's three plans. It is **not** in this plan; see Open questions.
- **R-8: the card's pip columns carry no glyph heads.** Spec §3.2 lists "the card's pip columns" as a use of the track glyphs, but at 0.375 rem a glyph is about 7 px and cannot be read. The columns are identified by their fixed order (armour, sensors, firepower, the board's own order) and by the pips' `aria-label`. When G1's sheet lands, it can revisit this.
- **R-9: the two clips are generated here (Task 12), although spec §8 lists "`gen_audio.py` clips" under plan 3.** The brief asks for the sound in plan 1 with the asset generation in a task of its own. The UI voices are **dry and RNG-free**, and they are generated with `--only`. A clip run therefore never re-encodes the 33 battle clips, and a full run produces byte-for-byte the same UI samples. Plan 3 drops that line.
- **R-10: the plan has 13 tasks, not the spec's 11.** The spec's 11 are all here: the preview fixes F5 and F6 fold into the bay and board tasks. Four tasks stand alone because of the five-file cap, or because the brief asks:
  - the kit's vocabulary (Task 2);
  - the instruments that see the garage, landed early so every later look is at the seeded state (Task 4);
  - keyboard plus the fit legs (Task 9);
  - the clip generation (Task 12).
- **R-11: card status precedence is Locked, then Maxed, then Bought, then Earned.** An ungated starting unit reads **Earned**, because it is the brigade's own issue. A unit that is level 3 is not necessarily Maxed: `ceil(3 × 7 ÷ 9)` is 3 while two tiers are still for sale. Maxed means every tier on every track is owned.
- **R-12: the kit colour matches `--ink-label`.** `--rl-gunmetal-0` already backs `--ink-label` and `--band-ink-dim`. D3 chose it anyway. The kit reads as kit by *shape* (pips, plate, bevelled mark) and by its `--kit-edge` outline, never by hue alone, and `--kit` is its own token so a later change moves one line.
- **R-13: kitted plates are not wired.** Spec §3.1 swaps in a kitted plate at L ≥ 2 "where one exists". Plan 3 owns the files and their naming (`plates:units --kit`), so the `plate` resolver's shape is left alone here. The steel frame and the mark land now, on the base plate.

## File structure

| File | Responsibility | Task | Est. lines |
|---|---|---|---|
| `packages/data/src/upgrades.ts` (+test), `index.ts` | `kitCounts`, `kitLevel`, `KitLevel` | 1 | 90 |
| `packages/app/src/ui/kit-sign.ts` (+test) | `KIT_SYMBOLS` (placeholder sheet), `kitSymbolSvg`, `KIT_TRACKS`, `kitSummary`, `kitPipsHtml`, `kitLevelLabel` | 2 | 330 |
| `packages/app/src/ui/theme.css` | `--kit`, `--kit-edge`, pips (2); cards (5); bay (6); board, F9 (7); states (8); stamps (10); HUD kit (13) | 2, 5–8, 10, 13 | — |
| `packages/app/src/i18n/en.json` | every new key (2); drop `garage.chip.owned` (13) | 2, 13 | 25 |
| `packages/app/src/ui/garage-model.ts` (+test) | `retainSelection`, `restoreFocus` (3); `cardStatus` (5); `rovingStep`, `trackForDigit` (9); `PurchaseAsk`, `purchaseLanded`, `cueFor`, `CUE_SET`, `countAt`, timings (10) | 3, 5, 9, 10 | 330 |
| `packages/app/src/ui/brigade.ts` (+test) | in place (3); cards (5); bay (6); board delegation (7); states (8); keyboard (9); purchase event (10) | 3, 5–10 | — |
| `packages/app/src/main.ts` | garage answers with `GarageState` (3); `onCue` → `playUi` (11); HUD `kitOf` (13) | 3, 11, 13 | 90 |
| `packages/app/src/ui/garage-stats.ts` (+test) | `PANEL_PATHS`, `previewDeltas`, `statBar`, `statPanel` | 6 | 330 |
| `packages/app/src/ui/garage-board.ts` (+test) | `rungState`, `trackSummary`, `visibleBenefits`, `trackEl`; locked mode (8) | 7, 8 | 450 |
| `tools/src/ui-review/garage-seed.ts` (+test) | the spec's audit seed, and the init script that writes it | 4 | 130 |
| `tools/src/ui-review/shoot.ts` | `--only=garage`; `03b-brigade-kitted`, `03c-brigade-preview`, `07c-hud-card-kitted` | 4 | 90 |
| `tools/src/ui-review/routes-check.ts` | purchase-in-place leg (4); fit and Tab legs (9); first-Buy sound leg (11) | 4, 9, 11 | 260 |
| `packages/render/src/audio.ts` (+test) | `ui_purchase` / `ui_upgrade` synth arms | 11 | 90 |
| `data/audio.json` | two `ui` sets (11); their variants (12) | 11, 12 | 20 |
| `tools/gen_audio.py`, `assets/audio/ui_purchase/*`, `assets/audio/ui_upgrade/*` | two dry voices, `--only` | 12 | 80 |
| `packages/app/src/ui/hud.ts` (+test) | `HudDeps.kitOf`; pips and `+N kit` on the single-unit card | 13 | 120 |

---

### Task 0: Entry, main as it stands, and a baseline

This is not a code task. The coordinator runs it; it needs no model.

- [ ] **Step 1:** `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/s3g-app fetch origin`, then `/usr/bin/git -C … log --oneline HEAD..origin/main -- packages/app/src/ui/brigade.ts packages/app/src/main.ts packages/app/src/ui/hud.ts packages/app/src/ui/theme.css packages/render/src/audio.ts data/audio.json tools/src/ui-review`. If anything is listed, `/usr/bin/git merge origin/main` and re-read what moved before Task 1. Every `file:line` citation here was taken at `e3b80317`.
- [ ] **Step 2:** `/usr/bin/git worktree list`, and `git status --short`. The tree must be clean apart from this plan.
- [ ] **Step 3: Baseline gates**, recorded in the ledger (`.superpowers/garage-uplift/ledger.md`, git-ignored, mirrored to the session scratchpad) so a later red can be attributed:
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm validate:audio`.
  - `pnpm ui:routes -- --port=5194`, which must pass, the GH-237 filter leg included.
  - `pnpm ui:shots -- --port=5193 --res=1400x900,1920x1080,2560x1440 --out=.superpowers/garage-uplift/t0`. Keep `03-brigade` at all three sizes as the "before" pictures.
- [ ] **Step 4:** Confirm the Task 12 tools exist, and record the result: `python3 -c 'import numpy; print(numpy.__version__)'` and `ffmpeg -version | head -1`. On 24 Sep this machine reported numpy 1.26.4 and `/opt/homebrew/bin/ffmpeg`. If either is missing, Tasks 1–11 and 13 still run: Task 11 works without clips, and Task 12 waits.

---

### Task 1: `kitLevel` in `@lions/data`

**Model:** sonnet. A pure function beside `applyUpgrades` (R-1).

**Files:**
- Modify: `packages/data/src/upgrades.ts`, `packages/data/src/upgrades.test.ts`, `packages/data/src/index.ts`

**Interfaces (Task 2 consumes these, and so will plan 2):**
- `type KitLevel = 0 | 1 | 2 | 3`
- `interface KitCounts { readonly owned: number; readonly available: number }`
- `function kitCounts(unit: UpgradableUnit, tiers: Readonly<Record<string, number>>): KitCounts`
- `function kitLevel(unit: UpgradableUnit, tiers: Readonly<Record<string, number>>): KitLevel`

- [ ] **Step 1: Write the failing tests.** Append the following to `upgrades.test.ts`. It already imports `readFileSync`, `join` and `__dirname`; add `kitCounts` and `kitLevel` to its import from `./upgrades`.

```ts
/** A shipped KDF unit, read off disk the way the sweep tests above read them. */
function kdf(id: string): UpgradableUnit {
  return JSON.parse(readFileSync(join(__dirname, '../../../data/units/kdf', `${id}.json`), 'utf8')) as UpgradableUnit;
}

describe('kitLevel (garage uplift §3.1, §6: ceil(3 × owned ÷ available))', () => {
  it('reads the audit seed the spec was written against', () => {
    expect(kitLevel(kdf('inf_squad'), { armour: 2, sensors: 1 })).toBe(1); // 3 of 9
    expect(kitLevel(kdf('at_team'), { firepower: 1 })).toBe(1); // 1 of 9
    expect(kitLevel(kdf('mbt_lavi'), { armour: 3, sensors: 3, firepower: 3 })).toBe(3); // 9 of 9
  });

  it('is 0 with nothing bought, and for a unit with no tracks at all', () => {
    expect(kitLevel(kdf('mbt_lavi'), {})).toBe(0);
    expect(kitLevel({ id: 'bare' }, { armour: 3 })).toBe(0);
  });

  it('is one rule for a nine-tier type and a six-tier one', () => {
    const d9 = kdf('dozer_d9');
    expect(kitCounts(d9, {}).available).toBe(6);
    const six = [1, 2, 3, 4, 5, 6].map((n) =>
      kitLevel(d9, { armour: Math.min(n, 3), sensors: Math.max(0, n - 3) })
    );
    expect(six).toEqual([1, 1, 2, 2, 3, 3]);
    const lavi = kdf('mbt_lavi');
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
      kitLevel(lavi, {
        armour: Math.min(n, 3),
        sensors: Math.min(Math.max(0, n - 3), 3),
        firepower: Math.max(0, n - 6),
      })
    );
    expect(nine).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  // R-11: level 3 is not "maxed". The garage asks that separately.
  it('rounds UP: seven of nine is level 3 with two tiers still for sale', () => {
    const tiers = { armour: 3, sensors: 3, firepower: 1 };
    expect(kitCounts(kdf('mbt_lavi'), tiers)).toEqual({ owned: 7, available: 9 });
    expect(kitLevel(kdf('mbt_lavi'), tiers)).toBe(3);
  });

  it('clamps to what the data still declares, and ignores unknown tracks, negatives and junk', () => {
    expect(kitCounts(kdf('mbt_lavi'), { armour: 9, rockets: 3, sensors: -2, firepower: Number.NaN })).toEqual({
      owned: 3,
      available: 9,
    });
  });
});
```

- [ ] **Step 2: Run to see them fail:** `pnpm vitest run packages/data/src/upgrades.test.ts` fails on the missing export.
- [ ] **Step 3: Implement**, in `upgrades.ts` after `maxTiers`:

```ts
/** How kitted a unit is, as one number the garage, the HUD and the renderer
 *  all read (garage uplift §3.1, §6): tiers owned across every track over the
 *  sum of the tracks' lengths, in thirds, rounded UP -- so any purchase at all
 *  shows, and 7 of 9 already reads as the top level. "Every tier owned" is a
 *  different question (`kitCounts` answers it), and the two are kept apart. */
export type KitLevel = 0 | 1 | 2 | 3;

export interface KitCounts {
  readonly owned: number;
  readonly available: number;
}

/** Owned tiers clamped to each track's current length (data may SHRINK a
 *  track after a purchase -- `applyUpgrades`'s own rule), over the tiers
 *  the unit's own tracks declare. A tier map naming a track the unit does
 *  not have counts nothing; a negative or non-finite tier counts as 0. */
export function kitCounts(unit: UpgradableUnit, tiers: Readonly<Record<string, number>>): KitCounts {
  let owned = 0;
  let available = 0;
  for (const [name, track] of Object.entries(unit.upgrades ?? {})) {
    const len = track.tiers.length;
    available += len;
    const raw = tiers[name];
    owned += Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), len) : 0;
  }
  return { owned, available };
}

export function kitLevel(unit: UpgradableUnit, tiers: Readonly<Record<string, number>>): KitLevel {
  const { owned, available } = kitCounts(unit, tiers);
  if (available === 0 || owned === 0) return 0;
  const thirds = Math.ceil((3 * owned) / available);
  return thirds >= 3 ? 3 : thirds === 2 ? 2 : 1;
}
```

  Then export `kitCounts`, `kitLevel`, `type KitCounts` and `type KitLevel` in `index.ts`'s `./upgrades` block.
- [ ] **Step 4: Gates, falsify, commit.** Run the gates line. Each of these must be **seen red**, then undone:
  - (a) `Math.round` in place of `Math.ceil` turns "one rule" red, with `[0, 1, 1, …]`.
  - (b) Dropping the `Math.min(…, len)` clamp turns "clamps" red, with `owned: 9`.
  - (c) Iterating `Object.keys(tiers)` instead of the unit's own tracks turns "clamps" red, because `rockets` gets counted.

  Commit `packages/data/src/upgrades.ts packages/data/src/upgrades.test.ts packages/data/src/index.ts` with the message `feat(data): kitLevel -- one rule for how kitted a unit is (WP-S3g T1, #238)`.

---

### Task 2: The kit's vocabulary: glyphs behind one constant, pips, summary, token, catalogue

**Model:** sonnet. It is pure: an SVG string sheet, arithmetic, and a CSS/JSON addition.

**Files:**
- Create: `packages/app/src/ui/kit-sign.ts`, `packages/app/src/ui/kit-sign.test.ts`
- Modify: `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`

**Interfaces (Tasks 5, 6, 7 and 13 consume these):**
- `const KIT_TRACKS: readonly ['armour', 'sensors', 'firepower']`; `type KitTrack`; `function isKitTrack(name: string): name is KitTrack`
- `type KitSymbolId = 'kit' | KitTrack`; `const CHEVRON_SWEEP: number` (14 / 24)
- `interface KitSymbolSheet { readonly viewBox: string; readonly track: Readonly<Record<KitTrack, string>>; readonly mark: (level: 1 | 2 | 3) => string }`
- `const KIT_SYMBOLS: KitSymbolSheet`: **the one line G1's sheet replaces**
- `function kitSymbolSvg(id: KitSymbolId, size: number, level?: 1 | 2 | 3, className?: string): string`
- `interface TrackPip { readonly track: KitTrack; readonly owned: number; readonly length: number }`
- `interface KitSummary { readonly level: KitLevel; readonly maxed: boolean; readonly pips: readonly TrackPip[]; readonly hpKit: number; readonly spent: number; readonly total: number }`
- `function kitSummary(unit: UpgradableUnit, owned: Readonly<Record<string, number>>): KitSummary`
- `function kitPipsHtml(pips: readonly TrackPip[]): string`, whose classes are `rl-kit-pips`, `rl-kit-pips__col[data-track][data-len]` and `rl-kit-pips__pip[data-on]`
- `function kitLevelLabel(level: 1 | 2 | 3): string`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/kit-sign.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { units, type UpgradableUnit } from '@lions/data';
import {
  CHEVRON_SWEEP,
  KIT_SYMBOLS,
  KIT_TRACKS,
  kitLevelLabel,
  kitPipsHtml,
  kitSummary,
  kitSymbolSvg,
  type KitSymbolId,
} from './kit-sign';

const IDS: readonly KitSymbolId[] = ['kit', ...KIT_TRACKS];
/** One pixel of ink at 10 px, in the sheet's 24-unit box. */
const MIN_STROKE = 2.4;
const kdf = (id: keyof typeof units): UpgradableUnit => units[id] as unknown as UpgradableUnit;

/** Every diagonal segment in a glyph's paths, as |dx| over |dy|. The sheet
 *  uses absolute M/L/Z only, which is itself a property worth keeping. */
function slopes(svg: string): number[] {
  const out: number[] = [];
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    for (const sub of (m[1] ?? '').split('Z')) {
      const pts = [...sub.matchAll(/[ML]\s*([\d.]+)\s+([\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);
      if (pts.length > 2) pts.push(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
        const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
        if (dx > 0 && dy > 0) out.push(dx / dy);
      }
    }
  }
  return out;
}

// The S3e family's properties, as phase 3's gated `symbol.test.ts` pins them
// (docs/superpowers/plans/2026-09-19-shell-upgrade-phase-3-app.md, Task 11):
// these four move into `ui/symbol.ts` with the glyphs when G1 approves the
// sheet, and a different drawing passes them without a test edit.
describe('the kit glyphs (placeholders until G1, #165)', () => {
  it('fill and stroke with currentColor, and name no colour of their own', () => {
    for (const id of IDS) {
      const svg = kitSymbolSvg(id, 16, 3);
      expect(svg).toContain('currentColor');
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3}/);
      expect(svg).not.toContain('var(--');
    }
  });

  it('share one viewBox and honour the size asked for', () => {
    const boxes = new Set(IDS.map((id) => /viewBox="([^"]+)"/.exec(kitSymbolSvg(id, 16))?.[1]));
    expect(boxes.size).toBe(1);
    expect(kitSymbolSvg('armour', 40)).toContain('width="40"');
    expect(kitSymbolSvg('kit', 48, 2)).toContain('height="48"');
  });

  it('carry at least a pixel of ink at 10 px', () => {
    for (const id of IDS) {
      for (const m of kitSymbolSvg(id, 10, 3).matchAll(/stroke-width="([\d.]+)"/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(MIN_STROKE);
      }
    }
  });

  it('bevel at the chevron’s own sweep, 14 across over 24 up (mark.ts)', () => {
    const all = IDS.flatMap((id) => slopes(kitSymbolSvg(id, 24, 3)));
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const s of all) expect(s).toBeCloseTo(CHEVRON_SWEEP, 9);
  });

  it('hold one bar per kit level on the mark', () => {
    expect(([1, 2, 3] as const).map((l) => (kitSymbolSvg('kit', 24, l).match(/<rect /g) ?? []).length)).toEqual([
      1, 2, 3,
    ]);
  });

  it('draw from KIT_SYMBOLS and nowhere else, so G1’s sheet is a one-line swap', () => {
    expect(kitSymbolSvg('armour', 24)).toContain(KIT_SYMBOLS.track.armour);
    expect(kitSymbolSvg('kit', 24, 2)).toContain(KIT_SYMBOLS.mark(2));
    expect(kitSymbolSvg('sensors', 24)).toContain(`viewBox="${KIT_SYMBOLS.viewBox}"`);
  });
});

describe('kitSummary', () => {
  it('reads the audit seed: level, pips, the kit’s share of the hit points, and what it cost', () => {
    expect(kitSummary(kdf('inf_squad'), { armour: 2, sensors: 1 })).toEqual({
      level: 1,
      maxed: false,
      pips: [
        { track: 'armour', owned: 2, length: 3 },
        { track: 'sensors', owned: 1, length: 3 },
        { track: 'firepower', owned: 0, length: 3 },
      ],
      hpKit: 60, // tier 2's cumulative patch, not 28 + 60
      spent: 385, // 115 + 175 + 95
      total: 1655,
    });
  });

  it('calls a fully bought unit maxed, and prices it whole', () => {
    const s = kitSummary(kdf('mbt_lavi'), { armour: 3, sensors: 3, firepower: 3 });
    expect([s.level, s.maxed, s.hpKit, s.spent, s.total]).toEqual([3, true, 750, 5150, 5150]);
  });

  it('draws a track the type does not have as an empty column', () => {
    const s = kitSummary(kdf('dozer_d9'), {});
    expect(s.pips.map((p) => [p.track, p.length])).toEqual([
      ['armour', 3],
      ['sensors', 3],
      ['firepower', 0],
    ]);
    expect([s.level, s.maxed, s.spent, s.total]).toEqual([0, false, 0, 1985]);
  });

  it('clamps an owned tier past its track, in the pips and in the spend', () => {
    const s = kitSummary(kdf('recon_drone'), { armour: 9 });
    expect(s.pips[0]).toEqual({ track: 'armour', owned: 3, length: 3 });
    expect([s.level, s.spent]).toEqual([2, 390]);
  });

  it('never throws on a unit whose JSON cannot take its own patch', () => {
    const broken: UpgradableUnit = {
      id: 'broken',
      hull: { hp: 10 },
      upgrades: { armour: { tiers: [{ price: 5, patch: { 'hull.armor.front': 5 } }] } },
    };
    expect(() => kitSummary(broken, { armour: 1 })).not.toThrow();
    expect(kitSummary(broken, { armour: 1 }).hpKit).toBe(0);
  });
});

describe('kitPipsHtml', () => {
  const pips = kitSummary(kdf('inf_squad'), { armour: 2, sensors: 1 }).pips;
  /** Parsed, not regexed: the HUD builds a string, the garage sets innerHTML. */
  const parse = (html: string): HTMLElement => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  };
  it('draws three columns in track order, filled from the account', () => {
    const root = parse(kitPipsHtml(pips));
    const cols = [...root.querySelectorAll('.rl-kit-pips__col')];
    expect(cols.map((c) => c.getAttribute('data-track'))).toEqual(['armour', 'sensors', 'firepower']);
    expect(cols.map((c) => c.querySelectorAll('[data-on="1"]').length)).toEqual([2, 1, 0]);
    expect(cols.map((c) => c.querySelectorAll('.rl-kit-pips__pip').length)).toEqual([3, 3, 3]);
  });

  it('says the kit in words for a screen reader, skipping a track the type lacks', () => {
    expect(kitPipsHtml(pips)).toContain('aria-label="Kit: Armour 2 of 3, Sensors 1 of 3, Firepower 0 of 3"');
    const d9 = kitSummary(kdf('dozer_d9'), { armour: 1 }).pips;
    expect(kitPipsHtml(d9)).toContain('aria-label="Kit: Armour 1 of 3, Sensors 0 of 3"');
    expect(kitPipsHtml(d9)).toContain('data-track="firepower" data-len="0"');
  });

  it('labels a level for the plate', () => {
    expect([kitLevelLabel(1), kitLevelLabel(2), kitLevelLabel(3)]).toEqual(['Kit I', 'Kit II', 'Kit III']);
  });
});
```

- [ ] **Step 2: Run to see them fail:** `pnpm vitest run packages/app/src/ui/kit-sign.test.ts`.
- [ ] **Step 3: Implement `kit-sign.ts`**

```ts
// The kit's vocabulary (garage uplift §2 goal 4, §3.1, §3.2, §6).
//
// Veterancy is EARNED, per named unit, and it is stars and gold chevrons.
// Kit is BOUGHT, per type, and it is a steel plate. Nothing on this page may
// borrow a shape or a colour from the other register -- which is why the
// mark is a bevelled plate with bars, never a chevron or a star, and why its
// colour is `--kit` and never `--commend`.
//
// The glyphs are PLACEHOLDERS. The S3e symbol family is not drawn yet (G1,
// #165), and these four join its addendum (D8). Until the sheet is approved
// they live here, drawn to the family's properties (one viewBox,
// currentColor, a pixel of ink at 10 px, the chevron's 14:24 sweep on every
// diagonal); `KIT_SYMBOLS` is the one line the approved sheet replaces, and
// everything draws through `kitSymbolSvg` so nothing else changes when it does.
import { applyUpgrades, kitCounts, kitLevel, readPath, type KitLevel, type UpgradableUnit } from '@lions/data';
import { t } from '../i18n/t';
import { escapeHtml } from './escape-html';

export const KIT_TRACKS = ['armour', 'sensors', 'firepower'] as const;
export type KitTrack = (typeof KIT_TRACKS)[number];
export type KitSymbolId = 'kit' | KitTrack;

export function isKitTrack(name: string): name is KitTrack {
  return (KIT_TRACKS as readonly string[]).includes(name);
}

/** `mark.ts`'s chevron: 14 across for every 24 up. */
export const CHEVRON_SWEEP = 14 / 24;

export interface KitSymbolSheet {
  readonly viewBox: string;
  readonly track: Readonly<Record<KitTrack, string>>;
  readonly mark: (level: 1 | 2 | 3) => string;
}

const STROKE = 2.5;
/** The plate: upper corners bevelled 3.5 across over 6 down -- the chevron's sweep at this box's scale. */
const PLATE = 'M2 22 L2 8 L5.5 2 L18.5 2 L22 8 L22 22 Z';
/** Bar 1 at the bottom: a level is climbed, like the board's ladder. */
const BAR_Y = [16.5, 12, 7.5] as const;

const PLACEHOLDER_KIT_SYMBOLS: KitSymbolSheet = {
  viewBox: '0 0 24 24',
  mark: (level) =>
    `<path d="${PLATE}" fill="none" stroke="currentColor" stroke-width="${STROKE}"/>` +
    BAR_Y.slice(0, level)
      .map((y) => `<rect x="6.5" y="${y}" width="11" height="3" fill="currentColor"/>`)
      .join(''),
  track: {
    // A slab with a riveted panel cut out of it.
    armour: `<path d="M3 21 L3 10 L6.5 4 L17.5 4 L21 10 L21 21 Z M7 12 L7 17 L17 17 L17 12 Z" fill="currentColor" fill-rule="evenodd"/>`,
    // A lens: ring and pupil. No diagonal, so nothing to sweep.
    sensors: `<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="${STROKE}"/><circle cx="12" cy="12" r="3" fill="currentColor"/>`,
    // A round: body and a nose at the sweep.
    firepower: `<path d="M8.5 22 L8.5 9 L12 3 L15.5 9 L15.5 22 Z" fill="currentColor"/>`,
  },
};

/** THE line G1's approved sheet replaces (#165). */
export const KIT_SYMBOLS: KitSymbolSheet = PLACEHOLDER_KIT_SYMBOLS;

export function kitSymbolSvg(id: KitSymbolId, size: number, level: 1 | 2 | 3 = 1, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  const body = id === 'kit' ? KIT_SYMBOLS.mark(level) : KIT_SYMBOLS.track[id];
  return (
    `<svg${cls} width="${size}" height="${size}" viewBox="${KIT_SYMBOLS.viewBox}" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

export interface TrackPip {
  readonly track: KitTrack;
  readonly owned: number;
  readonly length: number;
}

export interface KitSummary {
  readonly level: KitLevel;
  /** Every tier on every track owned -- NOT the same as level 3 (R-11). */
  readonly maxed: boolean;
  readonly pips: readonly TrackPip[];
  /** Hit points the kit adds: applied minus base. 0 when either is unreadable. */
  readonly hpKit: number;
  /** Credits spent on this type's owned tiers, and the price of all of them. */
  readonly spent: number;
  readonly total: number;
}

function clampTier(v: number | undefined, len: number): number {
  return v !== undefined && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), 0), len) : 0;
}

function hpKitOf(unit: UpgradableUnit, owned: Readonly<Record<string, number>>): number {
  const base = readPath(unit, 'hull.hp');
  if (base === undefined) return 0;
  try {
    const kitted = readPath(applyUpgrades(unit, owned), 'hull.hp');
    return kitted === undefined ? 0 : Math.round((kitted - base) * 100) / 100;
  } catch {
    // `applyUpgrades` refuses a patch path the JSON does not declare. The
    // garage already says so in the console when it draws the unit; a pip
    // strip must not be what takes a screen down.
    return 0;
  }
}

export function kitSummary(unit: UpgradableUnit, owned: Readonly<Record<string, number>>): KitSummary {
  const tracks = unit.upgrades ?? {};
  let spent = 0;
  let total = 0;
  for (const [name, track] of Object.entries(tracks)) {
    const n = clampTier(owned[name], track.tiers.length);
    track.tiers.forEach((tier, i) => {
      total += tier.price;
      if (i < n) spent += tier.price;
    });
  }
  const counts = kitCounts(unit, owned);
  return {
    level: kitLevel(unit, owned),
    maxed: counts.available > 0 && counts.owned === counts.available,
    pips: KIT_TRACKS.map((track) => {
      const length = tracks[track]?.tiers.length ?? 0;
      return { track, owned: clampTier(owned[track], length), length };
    }),
    hpKit: hpKitOf(unit, owned),
    spent,
    total,
  };
}

/** Three columns of 0.375rem squares, tier 1 at the bottom (the stylesheet's
 *  `column-reverse`). HTML rather than nodes: the HUD card is a string. */
export function kitPipsHtml(pips: readonly TrackPip[]): string {
  const said = pips
    .filter((p) => p.length > 0)
    .map((p) => t('kit.pips.track', { track: t(`garage.track.${p.track}`), n: p.owned, m: p.length }));
  const cols = pips
    .map(
      (p) =>
        `<span class="rl-kit-pips__col" data-track="${p.track}" data-len="${p.length}">` +
        Array.from({ length: p.length }, (_, i) => `<i class="rl-kit-pips__pip" data-on="${i < p.owned ? 1 : 0}"></i>`).join('') +
        `</span>`
    )
    .join('');
  return `<span class="rl-kit-pips" role="img" aria-label="${escapeHtml(t('kit.pips.aria', { tracks: said.join(', ') }))}">${cols}</span>`;
}

export function kitLevelLabel(level: 1 | 2 | 3): string {
  return t(`kit.level.${level}`);
}
```

- [ ] **Step 4: The token, the pips, the catalogue.** In `theme.css`, add the following right after `--commend` in the state block. It adds no deuteranopia or protanopia override, because gunmetal is not a team hue.

```css
  /* Bought, per type (garage uplift §2 goal 4, D3): steel, never gold -- gold
     is veterancy and credits. Shares its value with --ink-label by D3's own
     choice; kit is told apart by SHAPE (pips, the bevelled mark) and by the
     --kit-edge outline, never by hue alone. */
  --kit: var(--rl-gunmetal-0);
  --kit-edge: var(--rl-shadow-0);
```

  Add the pips block immediately before `/* The garage (ui/brigade.ts) */`, because the pips are shared with the HUD:

```css
/* Kit pips (ui/kit-sign.ts): three columns, 0-3 filled, tier 1 at the
   bottom. 0.375rem squares with 0.125rem gaps (spec §6). A column of
   length 0 is a track the type does not have: it keeps its width so the
   three columns stay aligned from card to card. */
.rl-kit-pips {
  display: inline-flex;
  align-items: flex-end;
  gap: 0.125rem;
}
.rl-kit-pips__col {
  display: inline-flex;
  flex-direction: column-reverse;
  gap: 0.125rem;
  min-width: 0.375rem;
}
.rl-kit-pips__pip {
  display: block;
  width: 0.375rem;
  height: 0.375rem;
  border: 1px solid var(--kit-edge);
  background: color-mix(in srgb, var(--kit) 22%, transparent);
}
.rl-kit-pips__pip[data-on='1'] {
  background: var(--kit);
}
.rl-kit-mark {
  color: var(--kit);
}
```

  Add these keys to `en.json`. They are **every** key this plan uses, placed after `garage.reset.confirm`, apart from `hud.card.kit`, which sits after `hud.card.hp`:

```json
  "kit.level.1": "Kit I",
  "kit.level.2": "Kit II",
  "kit.level.3": "Kit III",
  "kit.pips.aria": "Kit: {tracks}",
  "kit.pips.track": "{track} {n} of {m}",
  "garage.chip.earned": "Earned",
  "garage.chip.bought": "Bought",
  "garage.chip.maxed": "Maxed",
  "garage.plate.enlisted": "Enlisted",
  "garage.stat.kit": "+{n} kit",
  "garage.kit.total": "{n, plural, one {# credit} other {# credits}} of kit",
  "garage.track.tierOf": "tier {n} of {m}",
  "garage.track.spent": "{spent} spent · {toMax} to max",
  "garage.track.spentMaxed": "{spent} spent · maxed",
  "garage.locked.unlockFirst": "Unlock first",
  "garage.empty.credits": "Credits come from winning missions.",
  "hud.card.kit": "+{n} kit",
```

- [ ] **Step 5: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Change `L5.5 2` to `L6 2` in `PLATE`. The sweep test goes red.
  - (b) Set `STROKE = 2`. The ink test goes red.
  - (c) Drop `clampTier` from the pips map, using `owned: owned[track] ?? 0`. The recon clamp test goes red with `owned: 9`. The spend loop cannot show this, because `forEach` never walks past the declared tiers.
  - (d) Add `fill="#C3C7C4"` to the armour glyph, and `pnpm validate:ui` fails naming `kit-sign.ts`.
  - (e) Put `color: #fff;` in `.rl-kit-mark`, and `pnpm validate:ui` fails naming `theme.css`.

  Commit the four paths with the message `feat(app): the kit's vocabulary -- a steel mark, three track glyphs behind one constant, pips (WP-S3g T2)`. The body names `KIT_SYMBOLS` as G1's swap point.

---

### Task 3: A purchase re-renders in place (F3)

**Model:** opus. It touches `main.ts` and the screen's lifecycle.

F3 as measured: the route remounts; the screen is blank from 7–9 ms to 210–217 ms; the wallet flash runs on a removed node; the selection jumps to the first card; focus drops to `<body>`; the scroll resets. The fix follows R-3 and R-4.

**Files:**
- Create: `packages/app/src/ui/garage-model.ts`, `packages/app/src/ui/garage-model.test.ts`
- Modify: `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`, `packages/app/src/main.ts`

**Interfaces:**
- `brigade.ts` exports: `interface GarageState { readonly units: BrigadeUnit[]; readonly credits?: number; readonly owned?: Record<string, Record<string, number>> }`.
- `BrigadeOptions.onReset?: () => GarageState | void`, `onBuy?: (unitId, price) => GarageState | void` and `onBuyUpgrade?: (unitId, track, tier, price) => GarageState | void` have widened return types. A `void` return behaves as today.
- `garage-model.ts` exports: `function retainSelection(prev: string, ids: readonly string[]): string` and `function restoreFocus(asked: string | null, present: readonly string[], selectedId: string): string | null`.
- DOM contract: `data-focus-key` on tabs, cards, the unit Buy, each `.rl-garage__track`, each tier Buy and the reset control. The wallet figure `.rl-garage__wallet-n` carries `data-value`, the true balance, from now on. Task 10 animates its text.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/garage-model.test.ts
import { describe, expect, it } from 'vitest';
import { restoreFocus, retainSelection } from './garage-model';

describe('retainSelection', () => {
  it('keeps the unit in the bay while it is still on the roster', () => {
    expect(retainSelection('at_team', ['mbt_lavi', 'at_team'])).toBe('at_team');
  });
  it('falls to the first card only when the unit has gone', () => {
    expect(retainSelection('gone', ['mbt_lavi', 'at_team'])).toBe('mbt_lavi');
    expect(retainSelection('', [])).toBe('');
  });
});

describe('restoreFocus', () => {
  const keys = ['tab:all', 'card:inf_squad', 'track:armour', 'buy:armour', 'track:sensors', 'reset'];
  it('returns the asking control when it still exists -- the NEXT tier on the same track', () => {
    expect(restoreFocus('buy:armour', keys, 'inf_squad')).toBe('buy:armour');
  });
  it('falls from a maxed track’s Buy to the track itself', () => {
    expect(restoreFocus('buy:sensors', keys, 'inf_squad')).toBe('track:sensors');
  });
  it('falls from a unit Buy to the first tier Buy the unit now has', () => {
    expect(restoreFocus('unit-buy', keys, 'inf_squad')).toBe('buy:armour');
  });
  it('falls to the unit’s own card when nothing closer exists', () => {
    expect(restoreFocus('unit-buy', ['card:inf_squad'], 'inf_squad')).toBe('card:inf_squad');
    expect(restoreFocus('buy:rockets', ['card:inf_squad'], 'inf_squad')).toBe('card:inf_squad');
  });
  it('asks for nothing when nothing asked, or nothing is left', () => {
    expect(restoreFocus(null, keys, 'inf_squad')).toBeNull();
    expect(restoreFocus('buy:armour', [], 'inf_squad')).toBeNull();
  });
});
```

  Append to `brigade.test.ts`, and add `type BrigadeUnit` to its import from `./brigade`:

```ts
/** Mounted IN the document, which `focus()` needs; disposes and detaches. */
function mountLive(opts: Partial<BrigadeOptions>): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = showBrigade(host, { missionName: noMissionNames, baseOf, units: [], ...opts } as BrigadeOptions);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

const focusKey = (): string | null => document.activeElement?.getAttribute('data-focus-key') ?? null;

describe('showBrigade — a purchase re-renders in place (F3)', () => {
  it('keeps the screen, the tab, the unit and focus on the same track’s next Buy', () => {
    let owned: Record<string, Record<string, number>> = {};
    let credits = 999;
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits,
      owned,
      onBuyUpgrade: (unitId, track, tier, price) => {
        owned = { ...owned, [unitId]: { ...(owned[unitId] ?? {}), [track]: tier } };
        credits -= price;
        return { units, credits, owned };
      },
    });
    const screen = host.querySelector('.rl-menu--garage');
    host.querySelector<HTMLButtonElement>('.rl-garage__tab[data-bucket="soft"]')?.click();
    const rail = host.querySelector<HTMLElement>('.rl-garage__cards');
    if (rail) rail.scrollTop = 40; // jsdom does not clamp; ui:routes (Task 4) is this line's falsification
    host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')?.click();

    expect(host.querySelector('.rl-menu--garage')).toBe(screen);
    expect(host.querySelector('.rl-garage__tab[aria-selected="true"]')?.getAttribute('data-bucket')).toBe('soft');
    expect(host.querySelector('.rl-garage__card[aria-selected="true"]')?.getAttribute('data-unit')).toBe('inf_squad');
    expect(host.querySelector<HTMLElement>('.rl-garage__cards')?.scrollTop).toBe(40);
    expect(host.querySelector<HTMLElement>('.rl-garage__wallet-n')?.dataset.value).toBe('799');
    const next = host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier');
    expect(next?.textContent).toBe('Buy tier 2 · 300');
    expect(document.activeElement).toBe(next);
    dispose();
  });

  it('keeps the unit that was bought in the bay (F3: an at_team buy landed on the Lavi)', () => {
    const roster: BrigadeUnit[] = units.map((u) =>
      u.id === 'breach_team' ? { ...u, unlock: { starsMin: 12, price: 850 } } : u
    );
    const { host, dispose } = mountLive({
      units: roster,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      onBuy: (unitId) => ({
        units: roster.map((u) => (u.id === unitId && u.unlock ? { ...u, unlock: { ...u.unlock, bought: true } } : u)),
        credits: 149,
        owned: {},
      }),
    });
    select(host, 'breach_team');
    host.querySelector<HTMLButtonElement>('.rl-garage__buy')?.click();
    expect(host.querySelector('.rl-garage__card[aria-selected="true"]')?.getAttribute('data-unit')).toBe('breach_team');
    expect(host.querySelector('.rl-garage__card[data-unit="breach_team"]')?.getAttribute('data-locked')).toBe('0');
    expect(host.querySelector('.rl-garage__buy')).toBeNull();
    // No unit Buy any more and no tracks on this fixture: focus lands on its own card.
    expect(focusKey()).toBe('card:breach_team');
    dispose();
  });

  it('re-renders a refused purchase off the caller’s answer, with the Buy live again', () => {
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      owned: {},
      onBuyUpgrade: () => ({ units, credits: 999, owned: {} }), // the store refused: nothing moved
    });
    const buy = (): HTMLButtonElement | null =>
      host.querySelector('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier');
    buy()?.click();
    expect(buy()?.textContent).toBe('Buy tier 1 · 200');
    expect(buy()?.disabled).toBe(false);
    dispose();
  });

  it('leaves the screen as it was when the callback answers nothing (a legacy caller)', () => {
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      onBuyUpgrade: () => undefined,
    });
    const buy = host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier');
    buy?.click();
    expect(host.querySelector('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')).toBe(buy);
    expect(buy?.disabled).toBe(true);
    dispose();
  });

  it('answers the reset in place too', () => {
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 500,
      owned: { inf_squad: { armour: 1 } },
      onReset: () => ({ units, credits: 0, owned: {} }),
    });
    const screen = host.querySelector('.rl-menu--garage');
    const reset = (): HTMLButtonElement | null => host.querySelector('.rl-garage__reset');
    reset()?.click();
    reset()?.click();
    expect(host.querySelector('.rl-menu--garage')).toBe(screen);
    expect(host.querySelector<HTMLElement>('.rl-garage__wallet-n')?.dataset.value).toBe('0');
    expect(host.querySelector('.rl-garage__rung[data-owned="1"]')).toBeNull();
    expect(reset()?.textContent).toBe('reset brigade account');
    expect(reset()?.disabled).toBe(false);
    dispose();
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement `garage-model.ts`**

```ts
// The garage's decisions, as pure functions (garage uplift §3.5, §4). The DOM
// layer (`brigade.ts`) asks these and paints the answer.

/** The unit that stays in the bay across a re-render: the same one while it
 *  is still on the roster (F3: a buy used to land the bay on the first card). */
export function retainSelection(prev: string, ids: readonly string[]): string {
  return ids.includes(prev) ? prev : (ids[0] ?? '');
}

/** Where focus goes after a re-render the control with key `asked` caused
 *  (R-4). A Buy's key names its TRACK, so the same key is the next tier's
 *  Buy; when that track is maxed, the track itself; when a unit Buy has done
 *  its job, the first tier Buy the unit now shows; failing all of those, the
 *  unit's own card. */
export function restoreFocus(asked: string | null, present: readonly string[], selectedId: string): string | null {
  if (asked === null) return null;
  const has = (k: string): boolean => present.includes(k);
  if (has(asked)) return asked;
  if (asked.startsWith('buy:')) {
    const track = `track:${asked.slice(4)}`;
    if (has(track)) return track;
  }
  if (asked === 'unit-buy') {
    const firstBuy = present.find((k) => k.startsWith('buy:'));
    if (firstBuy !== undefined) return firstBuy;
  }
  const card = `card:${selectedId}`;
  return has(card) ? card : null;
}
```

- [ ] **Step 4: Implement the in-place path in `brigade.ts`.** This is a refactor of the mount, not of its content. It keeps the file's existing blocks and moves as little as possible, so as not to re-indent the whole screen:
  1. **State:** `let state: GarageState = { units: opts.units, credits: opts.credits, owned: opts.owned };`. Every read of `opts.units`, `opts.credits` and `opts.owned` becomes `state.*`. `rows` becomes `let rows: Row[]`, rebuilt by `classify()`, which is the existing map plus sort, moved into a function. `rosterMax`, `present` and `buckets` are computed once: a purchase changes neither a unit's type nor its base JSON.
  2. **The wallet is persistent.** The header is built once. `renderWallet()` sets the figure's `textContent` and `dataset.value = String(state.credits)`, and the pluralised word. `spend()` now flashes a node that survives the purchase, which fixes the flash that ran on a removed node.
  3. **The cards** move from the top-level loop into `renderCards()`, which `cards.replaceChildren()` and rebuilds `cardEls`. It is called once at mount and again in `answer()`. The `.rl-garage__cards` container itself is never replaced. Each card gets `card.dataset.focusKey = `card:${u.id}``, and each tab gets `tab:${b}`.
  4. **Focus keys** go on the unit Buy (`unit-buy`), each tier Buy (`buy:${trackName}`), each `.rl-garage__track`, which also gets `tabIndex = -1` so a fallback can land there (`track:${trackName}`), and the reset control (`reset`).
  5. **`answer()`:**

```ts
  /** The caller's answer to a purchase or a reset: the account as the store
   *  holds it now (R-3). Redraws around it -- same screen node, same tab,
   *  same unit, same scroll -- and puts focus where `restoreFocus` says. */
  function answer(next: GarageState | void, asked: string | null): void {
    if (next === undefined) return; // a caller that answers nothing: as before
    const scroll = { rail: cards.scrollTop, bay: bay.scrollTop, board: board.scrollTop };
    state = next;
    rows = classify();
    selectedId = retainSelection(selectedId, rows.map((r) => r.u.id));
    renderWallet();
    renderCards();
    syncTabs();
    syncCards();
    renderBay();
    resetUi();
    // Children replaced under a scroller clamp its offset to the new height
    // for a frame; put it back after the content is whole again.
    cards.scrollTop = scroll.rail;
    bay.scrollTop = scroll.bay;
    board.scrollTop = scroll.board;
    const keys = [...wrap.querySelectorAll<HTMLElement>('[data-focus-key]')];
    const want = restoreFocus(asked, keys.map((e) => e.dataset.focusKey ?? ''), selectedId);
    keys.find((e) => e.dataset.focusKey === want)?.focus({ preventScroll: true });
  }
```

  6. **The three callbacks answer.** The tier Buy's click becomes `buy.disabled = true; spend(); answer(opts.onBuyUpgrade?.(u.id, trackName, tier, price), `buy:${trackName}`);`. The unit Buy becomes `answer(opts.onBuy?.(u.id, price), 'unit-buy')`. The reset's second click becomes `answer(opts.onReset?.(), 'reset')`, and `resetUi()` puts back `armed = false`, `disabled = false` and the first label.
  7. Update the file-head comment's "unchanged" list: the purchase protocol still only asks, and now also accepts the answer.
- [ ] **Step 5: `main.ts`'s `mountBrigade` answers instead of remounting.**
  - `accountState()` gains `balance: account.balance`. That is additive; its other callers destructure what they already use.
  - The `kdfUnits` construction becomes a local `garageUnits(bought: ReadonlySet<string>): BrigadeUnit[]`. Portraits are still loaded once, since the set of ids never changes.
  - Replace `redraw` with the following, and make `onReset`, `onBuy` and `onBuyUpgrade` each end in `return now();`. A refusal returns `now()` too, which is the "stale account" case the old `redraw()` comment describes.

```ts
    /** The answer to every purchase and to the reset: the account as the
     *  store holds it NOW, read through `accountState()` (which reads
     *  `ledgerStore.readAccount()`), never a copy this mount kept. A refusal
     *  answers the same way -- the store is the truth either way. */
    const now = (): GarageState => {
      const a = accountState();
      return { units: garageUnits(a.boughtUnits), credits: a.balance, owned: a.ownedTiers };
    };
```

  Import `type BrigadeUnit, type GarageState` from `./ui/brigade`. The router's `force: true` remount is no longer used by the garage, so delete it with its comment.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line plus `pnpm ui:routes -- --port=5194`, which must stay green, the GH-237 filter leg included. Each of these must be seen red, then undone:
  - (a) In `answer()`, replace the body with `host.replaceChildren(); showBrigade(host, { ...opts, ...next });`. "keeps the screen" goes red.
  - (b) `selectedId = rows[0]?.u.id ?? ''` in place of `retainSelection`. The unit-buy test goes red.
  - (c) Make `restoreFocus` always return `card:${selectedId}`. The first test goes red on `activeElement`.
  - (d) Drop `resetUi()`. The reset test goes red on the label.

  The scroll restore's falsification is Task 4's browser leg: jsdom neither clamps nor resets `scrollTop`. Commit the five paths with the message `fix(app): a garage purchase re-renders in place -- no blank frame, nothing moves (WP-S3g T3, F3)`.

---

### Task 4: The instruments see the garage: a seeded state, three shots, and the purchase leg

**Model:** sonnet. This is harness code. It lands before the look tasks so that every later look is at the spec's seeded state rather than at a fresh account, which has no kit to see.

**Files:**
- Create: `tools/src/ui-review/garage-seed.ts`, `tools/src/ui-review/garage-seed.test.ts`
- Modify: `tools/src/ui-review/shoot.ts`, `tools/src/ui-review/routes-check.ts`

**Interfaces:** `GARAGE_SEED_ACCOUNT: BrigadeAccount`, `GARAGE_SEED_LEDGER: CampaignLedger`, and `garageSeedScript(ledger?, account?): string`, an init-script string that writes both keys. `ui:shots` gains `--only=garage`.

- [ ] **Step 1: Write the failing tests**

```ts
// tools/src/ui-review/garage-seed.test.ts
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { kitLevel, units, type UpgradableUnit } from '@lions/data';
import { starsEarned } from '@lions/sim';
import { ACCOUNT_KEY, migrateAccount } from '../../../packages/app/src/brigade-account';
import { campaignRoe } from '../../../packages/app/src/campaign';
import { memoryLedgerStore } from '../../../packages/app/src/ledger-store';
import { LEDGER_KEY } from '../../../packages/app/src/main-keys';
import { GARAGE_SEED_ACCOUNT, GARAGE_SEED_LEDGER, garageSeedScript } from './garage-seed';

describe('the garage seed (spec §1, "Audit conditions")', () => {
  it('reads back through LedgerStore as the audit state', () => {
    const store = memoryLedgerStore({
      [LEDGER_KEY]: JSON.stringify(GARAGE_SEED_LEDGER),
      [ACCOUNT_KEY]: JSON.stringify(GARAGE_SEED_ACCOUNT),
    });
    const account = store.readAccount();
    expect(account.balance).toBe(2400);
    expect(account.unlocks).toEqual(['mbt_lavi']);
    expect(account.upgrades).toEqual({
      inf_squad: { armour: 2, sensors: 1 },
      at_team: { firepower: 1 },
      mbt_lavi: { armour: 3, sensors: 3, firepower: 3 },
    });
    const ledger = store.readLedger();
    expect(starsEarned(ledger)).toBe(11);
    expect(campaignRoe(ledger)?.mean).toBe(83);
  });

  it('is the seed the spec read its kit levels off: L1, L1, L3', () => {
    const lvl = (id: keyof typeof units): number =>
      kitLevel(units[id] as unknown as UpgradableUnit, GARAGE_SEED_ACCOUNT.upgrades[id] ?? {});
    expect([lvl('inf_squad'), lvl('at_team'), lvl('mbt_lavi')]).toEqual([1, 1, 3]);
  });

  it('is a fixed point of the account migration', () => {
    expect(migrateAccount(JSON.parse(JSON.stringify(GARAGE_SEED_ACCOUNT)))).toEqual(GARAGE_SEED_ACCOUNT);
  });

  it('writes both keys as JSON strings, from a script a page can run', () => {
    const map = new Map<string, string>();
    runInNewContext(garageSeedScript(), { localStorage: { setItem: (k: string, v: string) => void map.set(k, v) } });
    expect(JSON.parse(map.get(ACCOUNT_KEY) ?? 'null')).toEqual(GARAGE_SEED_ACCOUNT);
    expect(JSON.parse(map.get(LEDGER_KEY) ?? 'null')).toEqual(GARAGE_SEED_LEDGER);
  });
});
```

- [ ] **Step 2: Implement `garage-seed.ts`.** The account is `{ version: ACCOUNT_VERSION, balance: 2400, earned_total: 0, paid: {}, unlocks: ['mbt_lavi'], upgrades: <as above>, grants: [{ source: 'granted', amount: 5000, at: 1 }] }`. The ledger is `'campaign.mission_results'` for `beit_sahwan_1_recon`, `beit_sahwan_2_foothold`, `beit_sahwan_3_clearance` (3 stars each, `roe: 83`) and `beit_sahwan_breach` (2 stars), plus `'roe.mission_ratings'` giving each of the four 83. `garageSeedScript` returns `try { localStorage.setItem(<LEDGER_KEY>, <json>); localStorage.setItem(<ACCOUNT_KEY>, <json>); } catch (e) {}`, with every literal produced by `JSON.stringify` so no quote can break it. It is a **string**, because tsx's `__name` helper does not exist in the page (`routes-check.ts`'s own note on `frameCadence`). The keys are imported from the app, never retyped. If `migrateAccount` normalises a field, the seed takes the normalised shape, since the point of that test is that the seed is a fixed point.
- [ ] **Step 3: `ui:shots`.**
  - Add `--only=garage`. It must be `''` or `garage`; anything else is refused with exit 2, the tool's own convention.
  - Extract `async function garageStates(browser, res, dir)`, called in the normal walk right after `03-brigade`. Under `--only=garage` the per-resolution loop shoots **only** `03-brigade` on the unseeded page, runs `garageStates`, then `continue`s.
  - `garageStates` opens a **new context** with the resolution's viewport and `addInitScript(garageSeedScript())`. That is the same isolation `plateCtx` uses, so the seed never leaks onto the main page's missions. In it:
    - `goto('/brigade')`, `settle(page, 1500)`.
    - Click `.rl-garage__card[data-unit="mbt_lavi"]`, `settle(page, 600)`, then shoot **`03b-brigade-kitted`**.
    - Click `at_team`, hover `.rl-garage__track[data-track="firepower"] .rl-garage__rung[data-tier="2"]`, `settle(page, 400)`, then shoot **`03c-brigade-preview`**.
    - `goto('/free-play/beit_sahwan_outskirts')`, and wait up to 60 s for `window.__lions`. A timeout logs `07c skipped: <reason>` and does not throw: shots are evidence, not a gate.
    - Select the first `inf_squad` from `units()`, centre the camera on it, `settle(page, 700)`, then shoot **`07c-hud-card-kitted`**.
    - Close the context.
  - Update the header comment's list of states and its usage line.
- [ ] **Step 4: The purchase leg in `ui:routes`.** Place it after the GH-237 filter leg, on its own context at 1920×1080 with the seed. Attach the walk's `console`/`pageerror` collectors to the new page exactly as the main page's are attached. Then:

```ts
  // --- the garage buys in place (WP-S3g F3) ------------------------------
  // The old remount read ONE flat colour for ~210 ms (spec F3, capture
  // `05-buy-upgrade-120ms`), then landed the bay on the first card with focus
  // on <body>. Everything below is a DOM read in the real page -- jsdom
  // cannot clamp a scroller or paint a frame.
  await g.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
  await g.waitForSelector('.rl-garage__card[data-unit="at_team"]');
  await g.click('.rl-garage__card[data-unit="at_team"]');
  await g.evaluate(GARAGE_ARM); // string: scroll the rail to 120, remember the screen node, start a 40-frame blank counter
  const railBefore = await g.$eval('.rl-garage__cards', (e) => e.scrollTop);
  await g.click('.rl-garage__track[data-track="firepower"] .rl-garage__buy-tier');
  await g.waitForFunction('window.__rlFrames >= 40');
  const after = await g.evaluate(GARAGE_READ);
  console.log(`[${TAG}] garage buy: ${JSON.stringify(after)} (rail was ${railBefore})`);
  expect(after.same, 'garage: a purchase replaced the screen instead of re-rendering it in place (F3)');
  expect(after.blank === 0, `garage: ${after.blank} frame(s) with no roster on screen while the purchase landed (F3)`);
  expect(after.selected === 'at_team', `garage: the bay moved to "${after.selected}" after an at_team purchase (F3)`);
  expect(after.focus === 'buy:firepower', `garage: focus is on "${after.focus}", not the next firepower Buy (F3/F8)`);
  expect(Math.abs(after.rail - railBefore) <= 1, `garage: the rail scrolled from ${railBefore} to ${after.rail} (F3)`);
  expect(after.value === '2225', `garage: the wallet reads ${after.value}, expected 2400 - 175 = 2225`);
  expect(after.boots === 1, `garage: ${after.boots} boot marks -- the purchase reloaded the page`);
```

  `GARAGE_ARM` and `GARAGE_READ` are string constants beside the leg:
  - `GARAGE_ARM` sets `window.__rlGarage = document.querySelector('.rl-menu--garage')`. It sets the rail's `scrollTop = 120`. It sets `__rlBlank = 0` and `__rlFrames = 0`, and starts a `requestAnimationFrame` loop that counts frames in which `.rl-garage__card` is absent, stopping at 40.
  - `GARAGE_READ` returns `{ same, blank, selected, focus, rail, value, boots }`, where `boots` is `performance.getEntriesByName('rl:boot').length`.
- [ ] **Step 5: Look.** Run `pnpm ui:shots -- --port=5193 --only=garage --out=.superpowers/garage-uplift/t4` at the three default sizes. Read `03b`, `03c` and `07c` at 1920×1080. These are the "before" of every look task that follows: the Lavi plate is unmarked (F1), and 03c's preview panel is scrolled away (F4). Record both in the ledger.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line, plus `pnpm vitest run tools/src/ui-review/garage-seed.test.ts` and `pnpm ui:routes -- --port=5194`, which must be GREEN with the new leg's line printed. Each of these must be seen red, then undone:
  - (a) Temporarily restore Task 3's old remount in `main.ts`'s `onBuyUpgrade` (`void router.navigate(routes.brigade(), { replace: true, force: true }); return;`). The leg goes red on `same`, `blank` and `selected`.
  - (b) Comment out the three `scrollTop` restores in `answer()`. The leg goes red on `rail`. This is Task 3's scroll falsification.
  - (c) Change the seed balance to 0. `garage-seed.test.ts` goes red.

  Commit the four paths with the message `test(tools): the instruments see the garage -- a seeded audit state, three shots, a purchase that must land in place (WP-S3g T4)`.

---

### Task 5: Rail cards: three pip columns, and Earned, Bought, Maxed (§3.1)

**Model:** sonnet.

**Files:**
- Modify: `packages/app/src/ui/garage-model.ts`, `packages/app/src/ui/garage-model.test.ts`, `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`, `packages/app/src/ui/theme.css`

**Interfaces:** `type CardStatus = 'locked' | 'maxed' | 'bought' | 'earned'` and `function cardStatus(s: { locked: boolean; bought: boolean; maxed: boolean }): CardStatus`. The DOM gains `card.dataset.status`, `card.dataset.kit` (0–3) and `.rl-garage__card-kit` holding `kitPipsHtml`.

- [ ] **Step 1: Write the failing tests.** Add to `garage-model.test.ts`:

```ts
describe('cardStatus (R-11)', () => {
  it('reads Locked before anything a locked unit might also be', () => {
    expect(cardStatus({ locked: true, bought: false, maxed: true })).toBe('locked');
  });
  it('reads Maxed over Bought over Earned', () => {
    expect(cardStatus({ locked: false, bought: true, maxed: true })).toBe('maxed');
    expect(cardStatus({ locked: false, bought: true, maxed: false })).toBe('bought');
    expect(cardStatus({ locked: false, bought: false, maxed: false })).toBe('earned');
  });
});
```

  Add to `brigade.test.ts`:

```ts
describe('the rail card — status and kit (WP-S3g §3.1, F1)', () => {
  const four: BrigadeUnit[] = [
    units[0], // inf_squad: no gate -> Earned
    { ...units[1], unlock: { roeMin: 40, price: 520, bought: true } }, // bought, no tracks -> Bought
    {
      ...units[1],
      id: 'namer_kitted',
      name: 'Namer (kitted)',
      unlock: { roeMin: 40, price: 520, bought: true },
      upgrades: { armour: { tiers: [{ price: 250, patch: { 'hull.hp': 154 } }] } },
    }, // bought and every tier owned -> Maxed
    units[2], // breach_team: locked by stars
  ];
  const read = (host: HTMLElement, id: string): [string | undefined, string | null | undefined] => [
    text(host, `.rl-garage__card[data-unit="${id}"] .rl-garage__card-chip`),
    host.querySelector(`.rl-garage__card[data-unit="${id}"]`)?.getAttribute('data-status'),
  ];

  it('says Earned, Bought or Maxed where it used to say Owned', () => {
    const host = mount({ units: four, ledger: {}, possibleStars: 78, owned: { namer_kitted: { armour: 1 } } });
    expect(read(host, 'inf_squad')).toEqual(['Earned', 'earned']);
    expect(read(host, 'ifv_namer')).toEqual(['Bought', 'bought']);
    expect(read(host, 'namer_kitted')).toEqual(['Maxed', 'maxed']);
    expect(read(host, 'breach_team')).toEqual(['Locked · 12★', 'locked']);
  });

  it('draws a pip column per track, filled from the account', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const col = (track: string): Element | null =>
      host.querySelector(`.rl-garage__card[data-unit="inf_squad"] .rl-kit-pips__col[data-track="${track}"]`);
    const count = (track: string, sel: string): number => col(track)?.querySelectorAll(sel).length ?? -1;
    expect([count('armour', '[data-on="1"]'), count('armour', '.rl-kit-pips__pip')]).toEqual([1, 2]);
    expect([count('sensors', '[data-on="1"]'), count('sensors', '.rl-kit-pips__pip')]).toEqual([0, 1]);
    expect(count('firepower', '.rl-kit-pips__pip')).toBe(0); // the fixture has no firepower track
    expect(host.querySelector('.rl-garage__card[data-unit="inf_squad"]')?.getAttribute('data-kit')).toBe('1');
  });

  it('draws no pips on a card whose unit has no tracks', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"] .rl-kit-pips')).toBeNull();
    expect(host.querySelector('.rl-garage__card[data-unit="ifv_namer"]')?.getAttribute('data-kit')).toBe('0');
  });

  it('fills the new pip when a tier is bought in place', () => {
    let owned: Record<string, Record<string, number>> = {};
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      credits: 999,
      owned,
      onBuyUpgrade: (id, track, tier) => {
        owned = { [id]: { [track]: tier } };
        return { units, credits: 799, owned };
      },
    });
    host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')?.click();
    expect(
      host.querySelectorAll('.rl-garage__card[data-unit="inf_squad"] .rl-kit-pips__col[data-track="armour"] [data-on="1"]')
    ).toHaveLength(1);
    dispose();
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `cardStatus` goes in `garage-model.ts`, as in the tests. In `renderCards()`:

```ts
    const merged: UpgradableUnit = { ...opts.baseOf(u.id), id: u.id, upgrades: u.upgrades };
    const kit = kitSummary(merged, ownedTiers(u, state.owned));
    const status = cardStatus({ locked: row.locked, bought: u.unlock?.bought === true, maxed: kit.maxed });
    card.dataset.status = status;
    card.dataset.kit = String(kit.level);
    // chip: row.locked ? t('garage.chip.locked', { why: row.short }) : t(`garage.chip.${status}`)
    if (u.upgrades !== undefined && Object.keys(u.upgrades).length > 0) {
      const pips = el('span', 'rl-garage__card-kit');
      pips.innerHTML = kitPipsHtml(kit.pips);
      card.appendChild(pips);
    }
```

  `garage.chip.owned` now has no reader. It stays in `en.json` until Task 13 deletes it, because this task's file budget is spent.

  In `theme.css`, replace the `[data-locked='0'] .rl-garage__card-chip` rule with:

```css
.rl-garage__card[data-status='earned'] .rl-garage__card-chip,
.rl-garage__card[data-status='bought'] .rl-garage__card-chip {
  color: var(--good);
}
.rl-garage__card[data-status='maxed'] .rl-garage__card-chip {
  color: var(--kit);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
/* The kit, where a type has any, sits at the card's far edge; a kitted card
   also takes a steel edge (§3.1) so the rail reads "kitted" at a glance. */
.rl-garage__card-kit {
  margin-left: auto;
  flex: none;
}
.rl-garage__card:not([data-kit='0']) {
  border-left-color: var(--kit);
}
```

- [ ] **Step 4: Look.** Run `pnpm ui:shots -- --port=5193 --only=garage --out=.superpowers/garage-uplift/t5`. In `03b` at 1400, 1920 and 2560 the following must hold:
  - The Lavi's card reads MAXED with nine filled pips.
  - The squad and the AT team read Earned with 3 and 1 filled.
  - No card name is clipped beyond today's ellipsis.
  - No overflow is printed for the garage states.
- [ ] **Step 5: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Swap `maxed` and `bought` in `cardStatus`. Both suites go red.
  - (b) Read `opts.owned` instead of `state.owned` in `renderCards`. "fills the new pip" goes red, which ties this task to Task 3.
  - (c) Pass `KIT_TRACKS` reversed into the pips. "draws a pip column" goes red.

  Commit the five paths with the message `feat(app): garage cards carry their kit, and say Earned, Bought or Maxed (WP-S3g T5)`.

---

### Task 6: The bay: a kitted plate, and a stat panel that stays in view (§3.1, F4, F5)

**Model:** sonnet.

**Files:**
- Create: `packages/app/src/ui/garage-stats.ts`, `packages/app/src/ui/garage-stats.test.ts`
- Modify: `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`, `packages/app/src/ui/theme.css`

**Interfaces (Task 7 consumes `previewDeltas` and `StatPanel.preview`):**
- `const PANEL_PATHS: readonly string[]` (moved from `brigade.ts`)
- `function previewDeltas(unit: UpgradableUnit, track: string, owned: number, tier: number): ReadonlyMap<string, number>`
- `interface StatBar { readonly basePct: number; readonly kitPct: number; readonly previewPct: number; readonly figure: string; readonly kit: string | null }`
- `function statBar(i: { base: number | undefined; owned: number | undefined; preview: number; max: number; kind: BenefitUnitKind }): StatBar`
- `interface StatPanel { readonly el: HTMLElement; preview(deltas: ReadonlyMap<string, number> | null): void }`
- `function statPanel(base: UpgradableUnit, asOwned: UpgradableUnit, rosterMax: ReadonlyMap<string, number>): StatPanel`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/garage-stats.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyUpgrades, readPath, units, type UpgradableUnit } from '@lions/data';
import { PANEL_PATHS, previewDeltas, statBar, statPanel } from './garage-stats';

const kdf = (id: keyof typeof units): UpgradableUnit => units[id] as unknown as UpgradableUnit;

describe('previewDeltas (F5, R-6)', () => {
  const lavi = kdf('mbt_lavi');
  it('previews nothing for a rung already owned (F5: the Lavi read 3750 → 3960)', () => {
    expect(previewDeltas(lavi, 'armour', 1, 1).size).toBe(0);
  });
  it('previews a future rung against the OWNED tier, not the tier below it (R-6)', () => {
    const d = previewDeltas(lavi, 'armour', 1, 3);
    expect(d.get('hull.hp')).toBe(540); // 750 - 210, not 750 - 450
    expect(d.get('hull.armor.front')).toBe(21);
  });
  it('previews the next rung from nothing as the tier itself', () => {
    expect(previewDeltas(lavi, 'armour', 0, 2).get('hull.hp')).toBe(450);
  });
  it('is empty outside the track, never a throw', () => {
    expect(previewDeltas(lavi, 'armour', 0, 4).size).toBe(0);
    expect(previewDeltas(lavi, 'rockets', 0, 1).size).toBe(0);
  });
  it('agrees with applyUpgrades for every shipped unit, track, owned tier and rung', () => {
    let checked = 0;
    for (const raw of Object.values(units)) {
      const u = raw as unknown as UpgradableUnit;
      for (const [track, spec] of Object.entries(u.upgrades ?? {})) {
        for (let owned = 0; owned <= spec.tiers.length; owned++) {
          const from = applyUpgrades(u, { [track]: owned });
          for (let tier = owned + 1; tier <= spec.tiers.length; tier++) {
            const to = applyUpgrades(u, { [track]: tier });
            const d = previewDeltas(u, track, owned, tier);
            for (const path of PANEL_PATHS) {
              const a = readPath(from, path);
              const b = readPath(to, path);
              if (a === undefined || b === undefined) continue;
              expect(d.get(path) ?? 0).toBeCloseTo(b - a, 9);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('statBar', () => {
  it('splits a kitted bar into base and kit, with the figure over a small kit line', () => {
    expect(statBar({ base: 3000, owned: 3750, preview: 0, max: 3750, kind: 'hp' })).toEqual({
      basePct: 80,
      kitPct: 20,
      previewPct: 0,
      figure: '3750',
      kit: '+750 kit',
    });
  });
  it('adds a preview segment and prints before → after', () => {
    expect(statBar({ base: 400, owned: 440, preview: 40, max: 2000, kind: 'hp' })).toEqual({
      basePct: 20,
      kitPct: 2,
      previewPct: 2,
      figure: '440 → 480',
      kit: '+40 kit',
    });
  });
  it('writes a percent stat as a percent, kit included', () => {
    const b = statBar({ base: 0.6, owned: 0.66, preview: 0, max: 1, kind: 'percent' });
    expect([b.figure, b.kit]).toEqual(['66%', '+6% kit']);
  });
  it('never overflows its track', () => {
    expect(statBar({ base: 1900, owned: 2100, preview: 200, max: 2000, kind: 'hp' })).toMatchObject({
      basePct: 95,
      kitPct: 5,
      previewPct: 0,
    });
  });
  it('reads an undeclared stat as an em-dash with nothing drawn', () => {
    expect(statBar({ base: undefined, owned: undefined, preview: 0, max: 100, kind: 'hp' })).toEqual({
      basePct: 0,
      kitPct: 0,
      previewPct: 0,
      figure: '—',
      kit: null,
    });
  });
});

describe('statPanel', () => {
  const inf = kdf('inf_squad');
  const max = new Map([['hull.hp', 2000]]);
  const row = (el: HTMLElement, sel: string): HTMLElement | null =>
    el.querySelector<HTMLElement>(`.rl-garage__stat[data-path="hull.hp"] ${sel}`);

  it('draws base and kit as two segments, and says what the kit added', () => {
    const p = statPanel(inf, applyUpgrades(inf, { armour: 1 }), max);
    expect(row(p.el, '.rl-garage__stat-n')?.textContent).toBe('428');
    expect(row(p.el, '.rl-garage__stat-fill')?.style.width).toBe('20%');
    expect(row(p.el, '.rl-garage__stat-kit')?.style.width).toBe('1.4%');
    expect(row(p.el, '.rl-garage__stat-kitn')?.textContent).toBe('+28 kit');
    expect(row(p.el, '.rl-garage__stat-kitn')?.hidden).toBe(false);
  });
  it('hides the kit line on a stat nothing was bought for', () => {
    expect(row(statPanel(inf, inf, max).el, '.rl-garage__stat-kitn')?.hidden).toBe(true);
  });
  it('previews on top of what is bought, and clears', () => {
    const p = statPanel(inf, applyUpgrades(inf, { armour: 1 }), max);
    p.preview(new Map([['hull.hp', 32]]));
    expect(row(p.el, '.rl-garage__stat-n')?.textContent).toBe('428 → 460');
    expect(row(p.el, '.rl-garage__stat-delta')?.style.width).toBe('1.6%');
    p.preview(null);
    expect(row(p.el, '.rl-garage__stat-n')?.textContent).toBe('428');
    expect(row(p.el, '.rl-garage__stat-delta')?.style.width).toBe('0%');
  });
});
```

  Add to `brigade.test.ts`:

```ts
describe('showBrigade — the bay carries the kit (§3.1, F4, F5)', () => {
  it('moves the stat panel into the bay, straight under the name and role', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__bay .rl-garage__stats')).not.toBeNull();
    expect(host.querySelector('.rl-garage__board .rl-garage__stats')).toBeNull();
    const kids = [...(host.querySelector('.rl-garage__bay')?.children ?? [])].map((e) => e.classList[0]);
    expect(kids.indexOf('rl-garage__stats')).toBe(kids.indexOf('rl-garage__role') + 1);
  });
  it('frames a kitted plate in steel and marks it with the level', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    expect(host.querySelector('.rl-garage__plate')?.getAttribute('data-kit')).toBe('1');
    expect(host.querySelector('.rl-garage__plate .rl-garage__plate-kit svg')).not.toBeNull();
    expect(text(host, '.rl-garage__plate-kit-label')).toBe('Kit I');
  });
  it('leaves an unkitted plate as it was', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-garage__plate')?.getAttribute('data-kit')).toBe('0');
    expect(host.querySelector('.rl-garage__plate-kit')).toBeNull();
    expect(host.querySelector('.rl-garage__kit-total')).toBeNull();
  });
  it('says what the kit on this unit cost', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1, sensors: 1 } } });
    expect(text(host, '.rl-garage__kit-total')).toBe('350 credits of kit');
  });
  // R-5: against a base-JSON maximum, the roster's strongest unit fills its
  // bar with base and has no room left to draw what it bought.
  it('leaves the roster’s strongest unit room to draw its kit', () => {
    const host = mount({ units: [units[0]], ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const kit = host.querySelector<HTMLElement>('.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-kit');
    expect(kit?.style.width).not.toBe('0%'); // 40 of a fully kitted 480
  });
  it('previews nothing over a rung already owned, and the next one from what is owned (F5)', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 1 } } });
    const hp = (): string | undefined => text(host, '.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-n');
    const rung = (tier: number): Element | null =>
      host.querySelector(`.rl-garage__track[data-track="armour"] .rl-garage__rung[data-tier="${tier}"]`);
    rung(1)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(hp()).toBe('440');
    rung(2)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(hp()).toBe('440 → 480');
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement `garage-stats.ts`.** The pure half is shown in full:

```ts
import { readPath, type UpgradableUnit, type UpgradeTrack } from '@lions/data';
import { t } from '../i18n/t';
import { asPercent, benefitLabel, type BenefitUnitKind } from './upgrade-benefit';

export const PANEL_PATHS: readonly string[] = [
  'hull.hp', 'hull.armor.front', 'hull.armor.side', 'hull.armor.rear', 'sensors.sight_tiles', 'weapons[0].accuracy',
];

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** One track at tier `n`, per path: `applyUpgrades`'s per-track rule (a
 *  tier's patch is cumulative over BASE, and the last tier to name a path
 *  wins), for this one track. */
function trackPatchAt(track: UpgradeTrack, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < Math.min(n, track.tiers.length); i++) Object.assign(out, track.tiers[i].patch);
  return out;
}

/** What hovering tier `tier` would change, over the unit as bought: tier
 *  `tier` of this track minus the OWNED tier of this track (R-6), per path,
 *  zeros dropped. Empty for an owned rung (F5) or a tier outside the track. */
export function previewDeltas(unit: UpgradableUnit, track: string, owned: number, tier: number): ReadonlyMap<string, number> {
  const spec = unit.upgrades?.[track];
  const out = new Map<string, number>();
  if (spec === undefined || tier <= owned || tier < 1 || tier > spec.tiers.length) return out;
  const to = trackPatchAt(spec, tier);
  const from = trackPatchAt(spec, owned);
  for (const path of new Set([...Object.keys(to), ...Object.keys(from)])) {
    const d = round2((to[path] ?? 0) - (from[path] ?? 0));
    if (d !== 0) out.set(path, d);
  }
  return out;
}

export function statNumber(value: number, kind: string): string {
  return kind === 'percent' ? t('garage.stat.percent', { n: asPercent(value) }) : String(value);
}

export interface StatBar { readonly basePct: number; readonly kitPct: number; readonly previewPct: number; readonly figure: string; readonly kit: string | null }

/** One row's three segments, in percent of the roster's fully kitted
 *  maximum (R-5), each clamped so the three never overflow the track. */
export function statBar(i: { base: number | undefined; owned: number | undefined; preview: number; max: number; kind: BenefitUnitKind }): StatBar {
  if (i.base === undefined || i.owned === undefined) {
    return { basePct: 0, kitPct: 0, previewPct: 0, figure: t('garage.stat.none'), kit: null };
  }
  const pct = (v: number): number => (i.max > 0 ? (Math.max(0, v) * 100) / i.max : 0);
  const basePct = Math.min(100, pct(i.base));
  const kitDelta = round2(i.owned - i.base);
  const kitPct = Math.min(100 - basePct, pct(kitDelta));
  const previewPct = Math.min(100 - basePct - kitPct, pct(i.preview));
  const after = round2(i.owned + i.preview);
  return {
    basePct,
    kitPct,
    previewPct,
    figure: i.preview !== 0
      ? t('garage.stat.preview', { before: statNumber(i.owned, i.kind), after: statNumber(after, i.kind) })
      : statNumber(i.owned, i.kind),
    kit: kitDelta > 0 ? t('garage.stat.kit', { n: statNumber(kitDelta, i.kind) }) : null,
  };
}
```

  `statPanel` builds `.rl-garage__stats` with its `h3` title (`garage.board.stats`). It then builds one `.rl-garage__stat[data-path]` per `PANEL_PATHS` entry that `benefitLabel` knows. Each row holds `.rl-garage__stat-label`, a `.rl-garage__stat-bar` containing `-fill`, `-kit` and `-delta` in that order, `.rl-garage__stat-n`, and `.rl-garage__stat-kitn`. `preview(deltas)` repaints every row from `statBar`, with `preview = deltas?.get(path) ?? 0`, and `preview(null)` clears. Widths are written `${n}%`.

  In `brigade.ts`:
  - Delete `PANEL_PATHS`, `statNumber`, `barWidth` and `showPreview`, and import them from `garage-stats.ts`.
  - `rosterMax` reads each unit's **fully kitted** values: `applyUpgrades(merged, maxTiers(merged))`, guarded, falling back to `merged` (R-5).
  - `renderBay()` appends the plate, then name, role, `statPanel(...).el`, the kit total, the blurb, and finally the gate and unit Buy.
  - The plate gets `dataset.kit` and, when `kit.level !== 0`, a `.rl-garage__plate-kit.rl-kit-mark` holding `kitSymbolSvg('kit', 48, kit.level)` and `.rl-garage__plate-kit-label` (`kitLevelLabel`).
  - `.rl-garage__kit-total` (`garage.kit.total`) is added when `kit.spent > 0`.
  - Each rung's hover and focus calls `panel.preview(tier <= owned ? null : previewDeltas(upgradable, trackName, owned, tier))`.
- [ ] **Step 4: CSS.**
  - `.rl-garage__plate` gets `position: relative` and a `max-height` (below).
  - `.rl-garage__plate:not([data-kit='0'])` gets `border-color: var(--kit)` and `box-shadow: 0 0 0 1px var(--kit-edge)`.
  - `.rl-garage__plate-kit` is absolute at `top/left: var(--s2)`, flex, gap `var(--s2)`, with `font-family: var(--font-display)`, `font-size: var(--t-h3)`, uppercase and `--track-label`. Its `svg` is `3rem` square.
  - The stat segments: `.rl-garage__stat-fill { background: var(--ink); }` (base is ink, §3.1), `.rl-garage__stat-kit { background: var(--kit); }`, and `-delta` stays `--good`.
  - `.rl-garage__stat-kitn` spans the grid's third column under the figure, at `--t-small`, `--kit`, right-aligned. **It declares no `display`**, so `hidden` works without the GH-237 trap.
  - `.rl-garage__kit-total` is at `--t-small`, `--ink-mute`.
  - **The plate's `max-height` is set by measurement.** Start at `42vh`. Run the look below, and lower it until, in `03c` at 1400×900, the whole stat panel and the hovered rung are both on screen. Record the chosen value and the three sizes' readings in the ledger and in the rule's comment. Task 9's fit leg makes this a vote.
- [ ] **Step 5: Look.** Run `pnpm ui:shots -- --port=5193 --only=garage --out=.superpowers/garage-uplift/t6`, then check:
  - In `03b`, the Lavi plate has a steel frame, the mark with three bars reading `Kit III`, the HP row at `3750` over `+750 kit`, and the kit segments on every bar.
  - In `03c`, the AT team's preview (`--good` segments) is **visible** in the same frame as the hovered rung (F4). Compare against Task 4's `03c`.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) In `previewDeltas`, subtract `trackPatchAt(spec, tier - 1)` instead of `owned`. The R-6 test and the sweep go red.
  - (b) Drop the `tier <= owned` guard. The F5 test goes red.
  - (c) Compute `rosterMax` off base JSON. "leaves the roster's strongest unit room" goes red with `0%`.
  - (d) Give `.rl-garage__stat-kitn` `display: block`, and read in `03b` that `hidden` stops working.

  Commit the five paths with the message `feat(app): the bay shows the kit -- steel frame, mark, base/kit/preview bars in view (WP-S3g T6, F1, F4, F5)`.

---

### Task 7: The board: three compact tracks, no empty lines, and a garage that fits (§4, F6, F9)

**Model:** sonnet.

**Files:**
- Create: `packages/app/src/ui/garage-board.ts`, `packages/app/src/ui/garage-board.test.ts`
- Modify: `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`, `packages/app/src/ui/theme.css`

**Interfaces (Tasks 8 and 9 consume these):**
- `type RungState = 'owned' | 'next' | 'future'`; `function rungState(tier: number, owned: number): RungState`
- `interface TrackSummary { readonly owned: number; readonly length: number; readonly spent: number; readonly toMax: number; readonly next: number | null }`; `function trackSummary(track: UpgradeTrack, owned: number): TrackSummary`
- `function visibleBenefits(lines: readonly BenefitLine[]): BenefitLine[]`
- `interface TrackDeps { readonly unit: UpgradableUnit; readonly unitId: string; readonly unitName: string; readonly owned: number; readonly buy?: { readonly credits: number; readonly onBuy: (tier: number, price: number, asked: string) => void }; readonly preview: (d: ReadonlyMap<string, number> | null) => void }`
- `function trackEl(trackName: string, track: UpgradeTrack, deps: TrackDeps): HTMLElement`

  The DOM contract: `.rl-garage__track[data-track][data-state]`; `.rl-garage__track-head[data-focus-key="track:<n>"][tabindex=-1]` holding `-glyph`, `-name`, `-pips`, `-tier` and `-spend`; `.rl-garage__rung[data-tier][data-owned][data-state][data-focus-key="rung:<n>:<t>"]`; the next rung alone carries `.rl-garage__benefits` and `.rl-garage__buy-tier[data-focus-key="buy:<n>"]`; the others carry `title` and `.rl-garage__rung-gist`; and `.rl-garage__track-max`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/garage-board.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { units, type UpgradableUnit, type UpgradeTrack } from '@lions/data';
import { rungState, trackEl, trackSummary, visibleBenefits, type TrackDeps } from './garage-board';
import { upgradeBenefits } from './upgrade-benefit';

const kdf = (id: keyof typeof units): UpgradableUnit => units[id] as unknown as UpgradableUnit;
function track(id: keyof typeof units, name: string): UpgradeTrack {
  const found = kdf(id).upgrades?.[name];
  if (found === undefined) throw new Error(`fixture: ${String(id)} has no ${name} track`);
  return found;
}
const lavi = kdf('mbt_lavi');
const deps = (over: Partial<TrackDeps> = {}): TrackDeps => ({
  unit: lavi, unitId: 'mbt_lavi', unitName: 'Lavi MBT', owned: 1, preview: () => {}, ...over,
});

describe('rungState', () => {
  it('is owned up to the owned tier, next one above it, future beyond', () => {
    expect([1, 2, 3].map((tier) => rungState(tier, 1))).toEqual(['owned', 'next', 'future']);
    expect([1, 2, 3].map((tier) => rungState(tier, 3))).toEqual(['owned', 'owned', 'owned']);
  });
});

describe('trackSummary (§4 "spent 360 · 1315 to max")', () => {
  it('prices what is spent and what is left', () => {
    expect(trackSummary(track('mbt_lavi', 'armour'), 1)).toEqual({ owned: 1, length: 3, spent: 360, toMax: 1315, next: 2 });
  });
  it('has no next tier once maxed, and clamps an owned tier past the track', () => {
    expect(trackSummary(track('mbt_lavi', 'armour'), 9)).toEqual({ owned: 3, length: 3, spent: 1675, toMax: 0, next: null });
  });
});

describe('visibleBenefits (F6)', () => {
  it('drops a line that changes nothing: inf_squad armour tier 3 no longer reads "Front armour 12 → 12"', () => {
    const lines = upgradeBenefits(kdf('inf_squad'), 'armour', 3);
    expect(lines).toHaveLength(4); // the data still patches four paths
    expect(visibleBenefits(lines).map((l) => l.path)).toEqual(['hull.hp']);
  });
});

describe('trackEl', () => {
  it('heads the track with its glyph, name, pips, tier and spend', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps());
    expect(el.querySelector('.rl-garage__track-glyph svg')).not.toBeNull();
    expect(el.querySelector('.rl-garage__track-name')?.textContent).toBe('Armour');
    expect(el.querySelectorAll('.rl-garage__track-pips [data-on="1"]')).toHaveLength(1);
    expect(el.querySelector('.rl-garage__track-tier')?.textContent).toBe('tier 1 of 3');
    expect(el.querySelector('.rl-garage__track-spend')?.textContent).toBe('360 spent · 1315 to max');
    expect(el.querySelector('.rl-garage__track-head')?.getAttribute('data-focus-key')).toBe('track:armour');
  });

  it('expands only the next rung: price, benefits, Buy; the rest are one line with their lines a hover away', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ buy: { credits: 5000, onBuy: () => {} } }));
    expect([...el.querySelectorAll('.rl-garage__rung')].map((r) => [r.getAttribute('data-tier'), r.getAttribute('data-state')])).toEqual([
      ['3', 'future'], ['2', 'next'], ['1', 'owned'],
    ]);
    const next = el.querySelector('.rl-garage__rung[data-state="next"]');
    expect(next?.querySelectorAll('.rl-garage__benefit').length).toBeGreaterThan(0);
    expect(next?.querySelector('.rl-garage__buy-tier')?.textContent).toBe('Buy tier 2 · 545');
    for (const r of el.querySelectorAll('.rl-garage__rung:not([data-state="next"])')) {
      expect(r.querySelector('.rl-garage__benefit')).toBeNull();
      expect(r.getAttribute('title')?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('keeps a short-balance Buy legible and disabled', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ buy: { credits: 100, onBuy: () => {} } }));
    expect(el.querySelector<HTMLButtonElement>('.rl-garage__buy-tier')?.disabled).toBe(true);
  });

  it('asks with the tier, its price and the key focus returns to, once', () => {
    const asked: [number, number, string][] = [];
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ buy: { credits: 5000, onBuy: (t, p, k) => asked.push([t, p, k]) } }));
    const buy = el.querySelector<HTMLButtonElement>('.rl-garage__buy-tier');
    buy?.click();
    buy?.click();
    expect(asked).toEqual([[2, 545, 'buy:armour']]);
    expect(buy?.getAttribute('data-focus-key')).toBe('buy:armour');
  });

  it('previews a future rung from the owned tier, nothing on an owned one, and clears', () => {
    const seen: (number | null)[] = [];
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ preview: (d) => seen.push(d === null ? null : (d.get('hull.hp') ?? 0)) }));
    const rung = (t: number): Element | null => el.querySelector(`.rl-garage__rung[data-tier="${t}"]`);
    rung(3)?.dispatchEvent(new MouseEvent('mouseenter'));
    rung(3)?.dispatchEvent(new MouseEvent('mouseleave'));
    rung(1)?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(seen).toEqual([540, null, null]);
  });

  it('says Maxed, with no Buy, on a full track', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ owned: 3, buy: { credits: 5000, onBuy: () => {} } }));
    expect(el.querySelector('.rl-garage__track-max')?.textContent).toBe('Maxed');
    expect(el.querySelector('.rl-garage__buy-tier')).toBeNull();
    expect(el.querySelector('.rl-garage__track-spend')?.textContent).toBe('1675 spent · maxed');
  });

  it('prints no zero-change line (F6)', () => {
    const el = trackEl('armour', track('inf_squad', 'armour'), { unit: kdf('inf_squad'), unitId: 'inf_squad', unitName: 'Rifle Squad', owned: 2, preview: () => {} });
    expect([...el.querySelectorAll('.rl-garage__rung[data-tier="3"] .rl-garage__benefit')].map((b) => b.textContent)).toEqual([
      'Hit points 460 → 500',
    ]);
  });
});
```

  In `brigade.test.ts`, **replace** `prints every rung’s benefit lines verbatim from formatBenefit` with the following. The other rung tests keep passing as written, because the class names, `data-tier`, `data-owned`, `-owned`, `-price` and `-track-max` are all kept.

```ts
  it('prints the next rung’s lines verbatim from formatBenefit, and the rest one hover away', async () => {
    const { formatBenefit, upgradeBenefits } = await import('./upgrade-benefit');
    const host = mount({ units, ledger: {}, possibleStars: 78 });
    const armour = host.querySelector('.rl-garage__track[data-track="armour"]');
    const lines = (tier: string): string[] =>
      [...(armour?.querySelectorAll(`.rl-garage__rung[data-tier="${tier}"] .rl-garage__benefit`) ?? [])].map((l) => l.textContent ?? '');
    expect(lines('1')).toEqual(['Hit points 400 → 440']); // nothing owned: tier 1 is next
    expect(lines('2')).toEqual([]);
    const unitJson = { ...BASE.inf_squad, upgrades: units[0].upgrades } as never;
    expect(armour?.querySelector('.rl-garage__rung[data-tier="2"]')?.getAttribute('title')).toBe(
      upgradeBenefits(unitJson, 'armour', 2).map(formatBenefit).join('\n')
    );
    expect([...host.querySelectorAll('.rl-garage__track[data-track="sensors"] .rl-garage__benefit')].map((l) => l.textContent)).toEqual([
      'Sight 8 → 9 tiles',
    ]);
  });
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement `garage-board.ts`.**
  - The pure half: `rungState`, `trackSummary` (spent is the prices of tiers `< owned`, clamped; `toMax` is the rest; `next` is `owned + 1` or `null`) and `visibleBenefits` (`lines.filter((l) => l.before !== l.after)`).
  - `trackEl` builds what the contract above names. Track labels keep `brigade.ts`'s rule: `t('garage.track.<n>')`, falling back to the humanised key.
  - The glyph is `kitSymbolSvg(name, 40)` when `isKitTrack(name)`, otherwise the hatch alone, which is the case of the underscored-name test.
  - The pips are `length` squares with `data-on`.
  - `tier` is `garage.track.tierOf`, and `spend` is `garage.track.spent` or `spentMaxed`.
  - Rungs run from `length` down to 1:
    - The **next** rung carries `rl-garage__benefits`, built from `visibleBenefits(upgradeBenefits(unit, name, tier)).map(formatBenefit)`. When `deps.buy` is set, the Buy's click disables itself and calls `onBuy(tier, price, `buy:${name}`)`.
    - The **others** carry a one-line head (tier, price, and `garage.rung.owned` on an owned one), `title` holding the visible lines joined `\n`, and `.rl-garage__rung-gist` holding the first visible line.
  - Rungs are `tabIndex = -1`. On `mouseenter` and `focusin` they call `deps.preview(state === 'owned' ? null : previewDeltas(unit, name, owned, tier))`; on `mouseleave` and `focusout`, `preview(null)`.
  - With `deps.buy` set and the track full, it appends `.rl-garage__track-max`.

  `brigade.ts`'s track loop becomes one `board.appendChild(trackEl(...))` per track, with `buy` set only when `state.credits !== undefined && opts.onBuyUpgrade`. Its `onBuy` is the Task 3 path: `spend(); answer(opts.onBuyUpgrade?.(u.id, name, tier, price), asked)`.
- [ ] **Step 4: CSS, including F9.**
  - The track head is a two-row grid: glyph on the left, spanning both rows, over the hatch, which is `.rl-garage__plate[data-noplate]`'s `repeating-linear-gradient` at `2.5rem`; name, pips and tier on row 1; spend on row 2 at `--t-small`.
  - Compact rungs are one line. `.rl-garage__rung[data-state='owned']` keeps today's friendly tint, and `[data-state='future']` is dimmed with `color-mix(in srgb, var(--ink) 60%, transparent)` on its text.
  - `.rl-garage__rung-gist { display: none; }`.
  - Replace `.rl-menu--garage`'s `max-height: 96vh` with a fixed height by the width's own arithmetic, with the reason in its comment (spec F9: the box was 14 px taller than a 1080 viewport, 12 px at 1440): `height: calc(100vh - 2 * var(--s6) - 2px); /* px-ok */`.
  - The wide layout:

```css
@media (min-width: 2200px) { /* px-ok */
  .rl-garage__body { grid-template-columns: minmax(16rem, 20rem) minmax(0, 1fr) minmax(20rem, 34rem); }
  .rl-garage__rung[data-state='future'] .rl-garage__rung-gist { display: block; }
}
```

- [ ] **Step 5: Look.** Run `pnpm ui:shots -- --port=5193 --only=garage --out=.superpowers/garage-uplift/t7`, then check:
  - In `03b` at 1920×1080 and 2560×1440, all three Lavi tracks are visible in the board column without scrolling (§2 goal 3), and the garage's bottom edge and footer are on screen (F9).
  - At 2560, future rungs carry their gist line.
  - At 1400×900, record whether the board scrolls. It is allowed to; the spec's fit figure is for 1920.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Return `lines` unfiltered from `visibleBenefits`. Both F6 tests go red.
  - (b) Give future rungs their benefit block. The "expands only the next rung" test goes red.
  - (c) Have the owned rung call `preview(previewDeltas(...))`. It goes red with `[540, null, 0]`.
  - (d) Spend counted `<= owned`. `trackSummary` goes red.

  Commit the five paths with the message `feat(app): the garage board -- three compact tracks, no empty lines, a screen that fits (WP-S3g T7, F6, F9)`.

---

### Task 8: Locked, empty and maxed (§4, F7)

**Model:** sonnet.

**Files:**
- Modify: `packages/app/src/ui/garage-board.ts`, `packages/app/src/ui/garage-board.test.ts`, `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`, `packages/app/src/ui/theme.css`

**Interfaces:** `TrackDeps.locked?: boolean`. When it is true, the track reads-only: `data-locked="1"`, tier 1 is `next` and expanded with its price and benefits, `.rl-garage__track-lock` (`garage.locked.unlockFirst`) sits where a Buy would, and no Buy is drawn even if `buy` is set. The DOM also gains `.rl-garage__empty` and `.rl-garage__plate-maxed`.

- [ ] **Step 1: Write the failing tests.** Add to `garage-board.test.ts`:

```ts
describe('trackEl — locked (F7)', () => {
  it('shows a locked unit’s track read-only: tier-1 price and benefits, "Unlock first", no Buy', () => {
    const el = trackEl('armour', track('mbt_lavi', 'armour'), deps({ owned: 0, locked: true, buy: { credits: 5000, onBuy: () => {} } }));
    expect(el.getAttribute('data-locked')).toBe('1');
    const first = el.querySelector('.rl-garage__rung[data-tier="1"]');
    expect(first?.getAttribute('data-state')).toBe('next');
    expect(first?.querySelector('.rl-garage__rung-price')?.textContent).toBe('360');
    expect(first?.querySelectorAll('.rl-garage__benefit').length).toBeGreaterThan(0);
    expect(first?.querySelector('.rl-garage__track-lock')?.textContent).toBe('Unlock first');
    expect(el.querySelector('.rl-garage__buy-tier')).toBeNull();
    expect(el.querySelector('.rl-garage__track-max')).toBeNull();
  });
});
```

  In `brigade.test.ts`, **replace** `renders no board rungs at all on a locked unit` with the following, and add the two after it:

```ts
  it('shows a locked unit’s tracks read-only, tier-1 prices and "Unlock first" (F7)', () => {
    const fixture = units.map((u) =>
      u.id === 'breach_team' ? { ...u, upgrades: { armour: { tiers: [{ price: 100, patch: { 'hull.hp': 10 } }] } } } : u
    );
    const host = mount({ units: fixture, ledger: {}, possibleStars: 78, credits: 999, onBuyUpgrade: () => {} });
    select(host, 'breach_team');
    expect(host.querySelector('.rl-garage__track[data-track="armour"]')?.getAttribute('data-locked')).toBe('1');
    expect(text(host, '.rl-garage__track-lock')).toBe('Unlock first');
    expect(host.querySelector('.rl-garage__buy-tier')).toBeNull();
    expect(host.querySelectorAll('.rl-garage__stat')).toHaveLength(6); // still a unit you can read
  });

  it('says where credits come from at zero, and only at zero', () => {
    const at = (credits: number | undefined): string | undefined =>
      text(mount({ units, ledger: {}, possibleStars: 78, credits, onBuyUpgrade: () => {} }), '.rl-garage__empty');
    expect(at(0)).toBe('Credits come from winning missions.');
    expect(at(5)).toBeUndefined();
    expect(at(undefined)).toBeUndefined(); // no account: as today
  });

  it('stamps Maxed on a maxed unit’s plate, and not on one at level 2 still for sale', () => {
    const maxed = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 2, sensors: 1 } } });
    expect(text(maxed, '.rl-garage__plate-maxed')).toBe('Maxed');
    const two = mount({ units, ledger: {}, possibleStars: 78, owned: { inf_squad: { armour: 2 } } });
    expect(two.querySelector('.rl-garage__plate')?.getAttribute('data-kit')).toBe('2');
    expect(two.querySelector('.rl-garage__plate-maxed')).toBeNull();
  });
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
  - `trackEl`: `const locked = deps.locked === true`, and then `effectiveOwned = locked ? 0 : owned`.
  - `brigade.ts`'s board draws the tracks for a locked unit too, with `locked: true`. It prepends `.rl-garage__empty` to the board when `state.credits === 0`.
  - The plate appends `.rl-garage__plate-maxed` (`garage.chip.maxed`) when `kit.maxed`.
  - The file-head comment's "a locked one shows no board" line in `BrigadeUnit.upgrades`' doc is rewritten to say read-only.
- [ ] **Step 4: CSS.**
  - `.rl-garage__track[data-locked='1']` gets `border-style: dashed`, and its rung text is `--ink-dim`.
  - `.rl-garage__track-lock` is `--warn`, uppercase, `--track-label`.
  - `.rl-garage__empty` is `--t-body`, `--ink-mute`, in a `--well` panel with a `1px solid var(--panel-frame)` border.
  - `.rl-garage__plate-maxed` is absolute at `right/bottom: var(--s2)`, display face `--t-h3`, uppercase, `color: var(--kit)`, `border: 2px solid var(--kit)`, `padding: 0 var(--s2)`, and `transform: rotate(-4deg)`.
- [ ] **Step 5: Look.** Run `pnpm ui:shots -- --port=5193 --only=garage --out=.superpowers/garage-uplift/t8` and check `03b`: the Lavi shows MAXED on the plate. Then capture a locked unit as a one-off. In the Browser pane, against a dev server **you start** with `pnpm --filter @lions/app exec vite --port 5195 --strictPort`, seed with `garageSeedScript()`'s text pasted into the console, and select `ifv_namer`, which is locked at Conduct 83 < 85. Read the capture: the Namer shows three read-only tracks and "Unlock first" (F7, compare the spec's `07-locked-ifv_namer`). Stop that server by its own terminal, never with `pkill`.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line. Each of these must be seen red, then undone:
  - (a) Draw the Buy when `locked && buy`. Both locked tests go red.
  - (b) Use `credits <= 0 || credits === undefined` for the empty line. The `undefined` case goes red.
  - (c) Stamp Maxed on `kit.level === 3`. Add a 7-of-9 fixture; the level-2 test's sibling assertion goes red.

  Commit the five paths with the message `feat(app): locked units show what they could become; empty and maxed say so (WP-S3g T8, F7)`.

---

### Task 9: Keyboard, plus the garage fits, measured (F8, F4, F9)

**Model:** sonnet.

**Files:**
- Modify: `packages/app/src/ui/garage-model.ts`, `packages/app/src/ui/garage-model.test.ts`, `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`, `tools/src/ui-review/routes-check.ts`

**Interfaces:** `function rovingStep(key: string, at: number, count: number): number | null` and `function trackForDigit(key: string, tracks: readonly string[]): string | null`.

- [ ] **Step 1: Write the failing tests.** Add to `garage-model.test.ts`:

```ts
describe('rovingStep', () => {
  it('moves and wraps, and starts at an end from nowhere', () => {
    expect(rovingStep('ArrowDown', 0, 3)).toBe(1);
    expect(rovingStep('ArrowDown', 2, 3)).toBe(0);
    expect(rovingStep('ArrowUp', 0, 3)).toBe(2);
    expect(rovingStep('ArrowRight', -1, 3)).toBe(0);
    expect(rovingStep('ArrowLeft', -1, 3)).toBe(2);
    expect([rovingStep('Home', 2, 3), rovingStep('End', 0, 3)]).toEqual([0, 2]);
  });
  it('ignores every other key, and an empty list', () => {
    expect(rovingStep('Enter', 0, 3)).toBeNull();
    expect(rovingStep('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('trackForDigit', () => {
  it('maps 1-3 onto the tracks in board order', () => {
    const tracks = ['armour', 'sensors', 'firepower'];
    expect(['1', '2', '3'].map((k) => trackForDigit(k, tracks))).toEqual(tracks);
  });
  it('is null past the board, and for anything that is not a digit', () => {
    expect(trackForDigit('3', ['armour', 'sensors'])).toBeNull();
    expect(trackForDigit('0', ['armour'])).toBeNull();
    expect(trackForDigit('a', ['armour'])).toBeNull();
  });
});
```

  In `brigade.test.ts`, **replace** `moves focus down the rail on an arrow, without changing the selection` with the following block:

```ts
describe('showBrigade — keyboard (F8)', () => {
  const stops = (host: HTMLElement, sel: string): number =>
    [...host.querySelectorAll<HTMLElement>(sel)].filter((e) => e.tabIndex >= 0).length;

  it('is one Tab stop for the tabs and one for the cards', () => {
    const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78 });
    expect(stops(host, '.rl-garage__tab')).toBe(1);
    expect(stops(host, '.rl-garage__card')).toBe(1);
    expect(host.querySelector<HTMLElement>('.rl-garage__card[aria-selected="true"]')?.tabIndex).toBe(0);
    dispose();
  });

  it('moves focus AND the selection down the rail on an arrow', () => {
    const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78 });
    host.querySelector<HTMLButtonElement>('.rl-garage__card[data-unit="inf_squad"]')?.focus();
    host.querySelector('.rl-garage__cards')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.getAttribute('data-unit')).toBe('ifv_namer');
    expect(host.querySelector('.rl-garage__card[aria-selected="true"]')?.getAttribute('data-unit')).toBe('ifv_namer');
    expect(text(host, '.rl-garage__name')).toBe('Namer IFV');
    expect(stops(host, '.rl-garage__card')).toBe(1);
    dispose();
  });

  it('moves the tab with the arrows, filtering as it goes, and keeps the card stop on a visible card', () => {
    const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78 });
    host.querySelector<HTMLButtonElement>('.rl-garage__tab[data-bucket="all"]')?.focus();
    host.querySelector('.rl-garage__tabs')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement?.getAttribute('data-bucket')).toBe('transport');
    expect(host.querySelector('.rl-garage__tab[aria-selected="true"]')?.getAttribute('data-bucket')).toBe('transport');
    // inf_squad is still in the bay but hidden by the filter: the one card stop moves to a visible card.
    const stop = [...host.querySelectorAll<HTMLButtonElement>('.rl-garage__card')].find((c) => c.tabIndex === 0);
    expect(stop?.getAttribute('data-unit')).toBe('ifv_namer');
    dispose();
  });

  it('jumps to a track on 1-3, landing on its next rung', () => {
    const { host, dispose } = mountLive({ units, ledger: {}, possibleStars: 78, credits: 999, onBuyUpgrade: () => undefined });
    host.querySelector('.rl-menu--garage')?.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    expect(focusKey()).toBe('rung:sensors:1');
    dispose();
  });

  it('buys the focused next tier on Enter', () => {
    const asked: [string, string, number, number][] = [];
    const { host, dispose } = mountLive({
      units, ledger: {}, possibleStars: 78, credits: 999,
      onBuyUpgrade: (u, tr, tier, price) => void asked.push([u, tr, tier, price]),
    });
    host.querySelector('.rl-menu--garage')?.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(asked).toEqual([['inf_squad', 'armour', 1, 200]]);
    dispose();
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The pure half follows the tests: `rovingStep` handles the arrows, `Home` and `End`, and `trackForDigit` matches `/^[1-9]$/`. In `brigade.ts`:
  - `syncTabs` sets `tabIndex` to 0 on the selected tab and -1 on the rest.
  - The tablist's `keydown` handles Left, Right, Home and End only, not Up or Down: it steps, sets `bucket`, calls `syncTabs`, and focuses the tab.
  - `syncCards` sets `tabIndex` to 0 on the selected card if it is visible, otherwise on the first visible card, and -1 on the rest.
  - The cards' `keydown` steps across visible cards, **selects** (setting `selectedId`, then `syncCards()` and `renderBay()`), and focuses. That is listbox semantics: selection follows focus.
  - A `keydown` on `wrap` ignores events whose target is an `input` or a `textarea`. Otherwise `trackForDigit` over the board's `data-track` values focuses that track's `[data-state="next"]` rung, or its head when the track is maxed, and calls `preventDefault`.
  - A `keydown` on the board, for `Enter` on a `.rl-garage__rung`, clicks that rung's enabled `.rl-garage__buy-tier`.
- [ ] **Step 4: Two legs in `ui:routes`,** on a seeded context each. Both evaluation scripts are strings, for the `__name` reason given in Task 4.
  - **(a) Fit (F4, F9, §2 goal 3).** At 1400×900, 1920×1080 and 2560×1440, for `mbt_lavi` and for `at_team`, read the following and print them every run:
    - `.rl-menu--garage`'s rect bottom against `innerHeight`;
    - `.rl-garage__stats`'s bottom against `.rl-garage__bay`'s;
    - `.rl-garage__board`'s `scrollHeight − clientHeight`.

    The votes are:
    - The box bottom is ≤ `innerHeight + 0.5` at all three sizes: `garage WxH <unit>: the screen ends Npx below the viewport (F9)`.
    - The stats bottom is ≤ the bay bottom + 0.5 at all three: `the stat panel is scrolled out of the bay (F4)`.
    - The board overflow is ≤ 1 at 1920 and 2560: `the board scrolls Npx: three tracks do not fit (§2 goal 3)`. At 1400 it is printed only.
    - Then hover the AT team's `firepower` next rung, and require `weapons[0].accuracy`'s `.rl-garage__stat-n` to read `… → …` with its rect inside the viewport: `the preview landed off-screen (F4)`.
  - **(b) Tab (F8).** At 1920×1080, focus the selected tab and press `Tab` until `document.activeElement.closest('.rl-garage__bay, .rl-garage__board')` is non-null, capped at 10 presses. Vote: presses ≤ 3, with the message `F8: N Tab stops before the bay (the audit counted 25)`.
- [ ] **Step 5: Gates, falsify, commit.** Run the gates line plus `pnpm ui:routes -- --port=5194`, GREEN with the fit readings printed. Each of these must be seen red, then undone:
  - (a) Every tab at `tabIndex = 0`. The unit test and leg (b) both go red.
  - (b) An arrow that does not select. The unit test goes red.
  - (c) `tracks[Number(key)]` in `trackForDigit`. Its tests go red.
  - (d) Revert Task 7's `height` rule to `max-height: 96vh`. Leg (a) goes red at 1920×1080 on the box bottom, which is the F9 falsification.
  - (e) Remove Task 6's plate `max-height`. Leg (a) goes red on the stats bottom, which is the F4 falsification.

  Delete nothing from `en.json` here; that is Task 13's. Commit the five paths with the message `feat(app): the garage by keyboard -- two Tab stops, arrows select, 1-3 and Enter buy; fit measured (WP-S3g T9, F8, F4, F9)`.

---

### Task 10: A purchase is an event: sweep, stamp, bars, count and cue (§3.5)

**Model:** opus. This is lifecycle work: a rAF loop that must die with the screen, and timers that must not reach a removed node.

**Files:**
- Modify: `packages/app/src/ui/garage-model.ts`, `packages/app/src/ui/garage-model.test.ts`, `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`, `packages/app/src/ui/theme.css`

**Interfaces (Task 11 consumes `CUE_SET` and `onCue`):**
- `type PurchaseAsk = { readonly kind: 'unit'; readonly unitId: string } | { readonly kind: 'upgrade'; readonly unitId: string; readonly track: string; readonly tier: number }`
- `type PurchaseCue = 'purchase' | 'upgrade'`; `const CUE_SET: Readonly<Record<PurchaseCue, string>>`, which maps to `ui_purchase` and `ui_upgrade`
- `const STAMP_MS = 240`, `BAR_GROW_MS = 300`, `WALLET_COUNT_MS = 400` (spec §6)
- `function purchaseLanded(ask: PurchaseAsk, next: { readonly units: readonly { readonly id: string; readonly unlock?: { readonly bought?: boolean } }[]; readonly owned?: Readonly<Record<string, Readonly<Record<string, number>>>> }): boolean`
- `function cueFor(ask: PurchaseAsk): PurchaseCue`
- `function countAt(from: number, to: number, elapsedMs: number, durMs: number): number`
- `BrigadeOptions.onCue?: (cue: PurchaseCue) => void` and `BrigadeOptions.reducedMotion?: () => boolean`

- [ ] **Step 1: Write the failing tests.** Add to `garage-model.test.ts`:

```ts
describe('purchaseLanded', () => {
  const units = [{ id: 'at_team' }, { id: 'mbt_lavi', unlock: { bought: true } }];
  it('reads an upgrade as landed when the account holds the tier', () => {
    const ask = { kind: 'upgrade', unitId: 'at_team', track: 'firepower', tier: 2 } as const;
    expect(purchaseLanded(ask, { units, owned: { at_team: { firepower: 2 } } })).toBe(true);
    expect(purchaseLanded(ask, { units, owned: { at_team: { firepower: 1 } } })).toBe(false);
    expect(purchaseLanded(ask, { units })).toBe(false);
  });
  it('reads a unit as landed when the account lists it bought', () => {
    expect(purchaseLanded({ kind: 'unit', unitId: 'mbt_lavi' }, { units })).toBe(true);
    expect(purchaseLanded({ kind: 'unit', unitId: 'at_team' }, { units })).toBe(false);
  });
});

describe('cueFor / CUE_SET', () => {
  it('sounds a unit as a purchase and a tier as an upgrade, each its own set', () => {
    expect(cueFor({ kind: 'unit', unitId: 'x' })).toBe('purchase');
    expect(cueFor({ kind: 'upgrade', unitId: 'x', track: 'armour', tier: 1 })).toBe('upgrade');
    expect(CUE_SET).toEqual({ purchase: 'ui_purchase', upgrade: 'ui_upgrade' });
  });
});

describe('countAt', () => {
  it('starts at from, lands exactly on to, and clamps outside the window', () => {
    expect(countAt(2400, 2225, 0, 400)).toBe(2400);
    expect(countAt(2400, 2225, 400, 400)).toBe(2225);
    expect(countAt(2400, 2225, 9999, 400)).toBe(2225);
    expect(countAt(2400, 2225, -5, 400)).toBe(2400);
  });
  it('counts down in whole credits, never overshooting', () => {
    const seq = [0, 50, 100, 200, 300, 399].map((ms) => countAt(2400, 2225, ms, 400));
    for (const v of seq) expect(Number.isInteger(v)).toBe(true);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
    expect(Math.min(...seq)).toBeGreaterThanOrEqual(2225);
  });
  it('is the answer at once for a zero duration', () => {
    expect(countAt(10, 3, 0, 0)).toBe(3);
  });
});
```

  Add to `brigade.test.ts`, and add `vi` to its vitest import:

```ts
describe('showBrigade — a purchase is an event (§3.5)', () => {
  function buyer(over: Partial<BrigadeOptions> = {}): { host: HTMLElement; dispose: () => void; cues: string[] } {
    const cues: string[] = [];
    let owned: Record<string, Record<string, number>> = {};
    const live = mountLive({
      units, ledger: {}, possibleStars: 78, credits: 999, owned,
      reducedMotion: () => true,
      onCue: (c) => void cues.push(c),
      onBuyUpgrade: (id, track, tier) => {
        owned = { [id]: { [track]: tier } };
        return { units, credits: 799, owned };
      },
      ...over,
    });
    return { ...live, cues };
  }
  const buyArmour = (host: HTMLElement): void =>
    host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')?.click();

  it('cues an upgrade once, only when it landed, and stamps its rung and its pip', () => {
    const { host, dispose, cues } = buyer();
    buyArmour(host);
    expect(cues).toEqual(['upgrade']);
    expect(host.querySelector('.rl-garage__rung[data-tier="1"]')?.classList.contains('rl-garage__rung--stamp')).toBe(true);
    const pip = host.querySelector('.rl-garage__card[data-unit="inf_squad"] .rl-kit-pips__col[data-track="armour"] .rl-kit-pips__pip');
    expect(pip?.classList.contains('rl-kit-pips__pip--new')).toBe(true);
    dispose();
  });

  it('stays silent and unstamped when the store refused', () => {
    const { host, dispose, cues } = buyer({ onBuyUpgrade: () => ({ units, credits: 999, owned: {} }) });
    buyArmour(host);
    expect(cues).toEqual([]);
    expect(host.querySelector('.rl-garage__rung--stamp')).toBeNull();
    dispose();
  });

  it('cues a unit purchase as a purchase, and stamps Enlisted on the plate', () => {
    const roster: BrigadeUnit[] = units.map((u) => (u.id === 'breach_team' ? { ...u, unlock: { starsMin: 12, price: 850 } } : u));
    const { host, dispose, cues } = buyer({
      units: roster,
      onBuy: (unitId) => ({
        units: roster.map((u) => (u.id === unitId && u.unlock ? { ...u, unlock: { ...u.unlock, bought: true } } : u)),
        credits: 149,
        owned: {},
      }),
    });
    select(host, 'breach_team');
    host.querySelector<HTMLButtonElement>('.rl-garage__buy')?.click();
    expect(cues).toEqual(['purchase']);
    expect(text(host, '.rl-garage__stamp')).toBe('Enlisted');
    dispose();
  });

  it('steps the wallet at once under reduced motion', () => {
    const { host, dispose } = buyer();
    buyArmour(host);
    expect(text(host, '.rl-garage__wallet-n')).toBe('799');
    dispose();
  });

  it('counts the wallet down over 400 ms, landing exactly on the balance', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const { host, dispose } = buyer({ reducedMotion: () => false });
      buyArmour(host);
      const n = (): number => Number(text(host, '.rl-garage__wallet-n'));
      expect(n()).toBe(999);
      vi.advanceTimersByTime(200);
      expect(n()).toBeLessThan(999);
      expect(n()).toBeGreaterThan(799);
      vi.advanceTimersByTime(400);
      expect(n()).toBe(799);
      expect(host.querySelector<HTMLElement>('.rl-garage__wallet-n')?.dataset.value).toBe('799');
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops counting when the screen is left', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    try {
      const { host, dispose } = buyer({ reducedMotion: () => false });
      buyArmour(host);
      dispose();
      expect(cancel).toHaveBeenCalled();
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    } finally {
      cancel.mockRestore();
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The pure half follows the tests. `countAt` is an ease-out cubic, `Math.round`ed, clamped at both ends, with `durMs <= 0` returning `to`. In `brigade.ts`:
  - `answer(next, asked, ask?: PurchaseAsk)`. The tier and unit Buys pass their `PurchaseAsk`; the reset passes none. Before rendering, it snapshots `fromCredits = state.credits`, the previous kit level of `ask.unitId`, and each stat row's fill and kit widths. After rendering and restoring, if `ask && purchaseLanded(ask, next)`, it calls `celebrate(ask, …)`:
    - `opts.onCue?.(cueFor(ask))`.
    - `countWallet(fromCredits, state.credits)`. This is `cancelAnimationFrame(countRaf)` and then, if reduced or equal, the text is set to `to` at once. Otherwise the text is set to `from`, and a `requestAnimationFrame(step)` loop, **the bare global, called at call time**, writes `countAt(from, to, now − start, WALLET_COUNT_MS)` until it reads `to`.
    - For an upgrade: `flash(rung, 'rl-garage__rung--stamp', STAMP_MS)` on `.rl-garage__track[data-track=T] .rl-garage__rung[data-tier=N]`, and `flash(pip, 'rl-kit-pips__pip--new', STAMP_MS)` on that card's column's N-th pip. If the level changed, it also flashes `.rl-garage__plate-kit` with `'rl-garage__plate-kit--stamp'`.
    - The bars grow. It adds `rl-garage__stats--grow` to the panel for `BAR_GROW_MS` (via `flash`), writes each row's old widths, forces a reflow (`void panel.offsetWidth`), and writes the new ones. The transition exists only under that class, so changing the selection never animates.
    - For a unit: it appends `.rl-garage__stamp` (`garage.plate.enlisted`) to the plate and flashes `'rl-garage__plate--enlisted'` for 900 ms. The card chip is already Bought, because it was re-rendered.
  - `reduced()` is `opts.reducedMotion?.() ?? defaultReducedMotion()`. The default is a three-line copy of `scene-host.ts`'s `defaultReducedMotion` (`data-motion`, then the media query), with a comment naming its twin. Extracting both into `motion.ts` is a follow-up; see Out of scope. The file cap rules it out here.
  - The disposer calls `cancelAnimationFrame(countRaf)` before `wrap.remove()`.
- [ ] **Step 4: CSS.** Each keyframe lives beside its selector:
  - `rl-garage-stamp` scales 1.3 → 1 over `240ms var(--ease)`, for `.rl-garage__plate-kit--stamp` and `.rl-garage__stamp`.
  - `.rl-garage__rung--stamp` sweeps its background from `var(--kit)` to its owned tint over 240 ms.
  - `.rl-kit-pips__pip--new` pulses from scale 1.6 to 1 over 240 ms.
  - `.rl-garage__stats--grow .rl-garage__stat-fill, .rl-garage__stats--grow .rl-garage__stat-kit { transition: width 300ms var(--ease); }`.
  - `.rl-garage__stamp` is absolute and centred, display face `--t-h2`, uppercase, `color: var(--kit)`, `border: 2px solid var(--kit)`, rotated -6deg.
  - `.rl-garage__plate--enlisted` lifts the hatch: `[data-noplate]`'s gradient goes to `opacity: 0.35` over the beat.

  Under `prefers-reduced-motion` and `data-motion='reduce'`, the sheet's existing global rules collapse every duration to 1 ms, so colour still reports and figures step. No new reduced-motion rule is needed; say so in the comment.
- [ ] **Step 5: Look.** The event is motion, which a still cannot hold. Use `ui:routes`' existing Task 4 leg: it buys, and it now prints the counted value path if you add `console.log` of three `textContent` samples taken at 0, 200 and 450 ms after the click (**as a printed line, not a vote**). Also run `pnpm ui:shots -- --port=5193 --only=garage --out=.superpowers/garage-uplift/t10` for regressions.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line plus `pnpm ui:routes -- --port=5194`. Each of these must be seen red, then undone:
  - (a) Call `celebrate` without `purchaseLanded`. "stays silent" goes red.
  - (b) Remove `cancelAnimationFrame(countRaf)` from the disposer. "stops counting" goes red.
  - (c) Let `countAt` return `from + (to − from) * p` without rounding. The integer test goes red.
  - (d) Capture `const raf = window.requestAnimationFrame` at module load and call `raf(step)`. The fake-timer count test goes red, because the loop never ticks, which is the `FREEZE_FRAME_LOOP_STATEMENTS` rule made visible.

  Commit the five paths with the message `feat(app): a garage purchase is an event -- sweep, stamp, bars, a counted wallet, a cue (WP-S3g T10)`.

---

### Task 11: Sound: two UI sets, a rising synth arm, the mixer wiring, and a first Buy that is heard

**Model:** opus, because it touches `main.ts`. This is R-2's single `packages/render` edit.

**Files:**
- Modify: `packages/render/src/audio.ts`, `packages/render/src/audio.test.ts`, `data/audio.json`, `packages/app/src/main.ts`, `tools/src/ui-review/routes-check.ts`

This task works **with or without** Task 12's clips. `playUi` plays a set's clip when it has decoded one, and its synth arm otherwise.

- [ ] **Step 1: Write the failing tests.** Add to `audio.test.ts`, and give `FakeContext`'s oscillator a recorded `stop`: add `readonly stops: number[] = []` to the class and `stop: (t: number) => void stops.push(t)` inside `createOscillator`, closing over `const stops = this.stops`. Add `vi` to its import.

```ts
describe('playUi — the garage’s two cues (WP-S3g §3.5, R-2)', () => {
  const freqs = (ctx: FakeContext): number[] =>
    ctx.oscillators.map((o) => (o as { frequency: { value: number } }).frequency.value);

  it('a purchase rises, where an alert falls', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attached();
      audio.playUi('ui_purchase');
      vi.advanceTimersByTime(250);
      const up = freqs(ctx);
      expect(up).toHaveLength(2);
      expect(up[1]).toBeGreaterThan(up[0]);
      ctx.oscillators.length = 0;
      audio.playUi('ui_alert');
      vi.advanceTimersByTime(250);
      const down = freqs(ctx);
      expect(down[1]).toBeLessThan(down[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an upgrade ratchets, then lands on a note above the purchase’s', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attached();
      audio.playUi('ui_upgrade');
      vi.advanceTimersByTime(250);
      const f = freqs(ctx);
      expect(f.length).toBeGreaterThanOrEqual(3);
      expect(f[f.length - 1]).toBeGreaterThan(294);
    } finally {
      vi.useRealTimers();
    }
  });

  it('both finish inside 250 ms (spec §6)', () => {
    vi.useFakeTimers();
    try {
      for (const set of ['ui_purchase', 'ui_upgrade']) {
        const { audio, ctx } = attached();
        audio.playUi(set);
        vi.advanceTimersByTime(100); // every voice has started by 100 ms...
        const started = ctx.oscillators.length;
        vi.advanceTimersByTime(400);
        expect(ctx.oscillators.length).toBe(started);
        for (const s of ctx.stops) expect(s).toBeLessThanOrEqual(0.15); // ...and none rings past 150 ms more
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unknown name still falls -- the one meaning a garage cue must never borrow', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attached();
      audio.playUi('ui_nope');
      vi.advanceTimersByTime(250);
      const f = freqs(ctx);
      expect(f[1]).toBeLessThan(f[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run to see them fail.** `ui_purchase` currently falls, like an alert.
- [ ] **Step 3: Implement.** In `playUi`'s synth fallback, add the two arms between `ui_objective` and the alert's `else`:

```ts
    } else if (setName === 'ui_purchase') {
      // A shop, not an alarm (garage uplift §3.5): a low clunk under a rising
      // pair. Rising is the objective's meaning ("something went your way"),
      // kept deliberately short of the objective's own pitch.
      this.tone(196, 0.08, 'triangle', 0.06);
      window.setTimeout(() => this.tone(294, 0.12, 'sine', 0.045), 70);
    } else if (setName === 'ui_upgrade') {
      // Two pawl clicks of a ratchet, then the higher note.
      this.tone(1175, 0.02, 'square', 0.02);
      window.setTimeout(() => this.tone(1175, 0.02, 'square', 0.02), 35);
      window.setTimeout(() => this.tone(880, 0.1, 'sine', 0.045), 90);
    } else {
```

  In `data/audio.json`, after `ui_objective`, add the following. Gain 0.45 sits under `ui_alert`'s 0.5 (spec §6), and empty variants are legal: the synth plays.

```json
    "ui_purchase":  { "event": "ui", "gain": 0.45, "variants": [] },
    "ui_upgrade":   { "event": "ui", "gain": 0.45, "variants": [] }
```

  In `main.ts`'s `mountBrigade`, add `onCue: (cue) => battleAudio().playUi(CUE_SET[cue])`, importing `CUE_SET` from `./ui/garage-model`. A Buy click is itself the first gesture: `attach()`'s `pointerdown` listener builds the context before the click handler runs. Mute is honoured inside `playUi`.
- [ ] **Step 4: The first-Buy leg in `ui:routes` (spec §9 "First gesture").** Open a new seeded context at 1920×1080. **Before** `goto`, add this init script string:

```js
(function () {
  var w = window; w.__rlAudio = { osc: [], buf: 0 };
  var C = w.AudioContext || w.webkitAudioContext; if (!C) return;
  var mk = C.prototype.createOscillator;
  C.prototype.createOscillator = function () {
    var o = mk.call(this); var rec = { f: null }; w.__rlAudio.osc.push(rec);
    setTimeout(function () { rec.f = o.frequency.value; }, 0); return o;
  };
  var mb = C.prototype.createBufferSource;
  C.prototype.createBufferSource = function () { w.__rlAudio.buf++; return mb.call(this); };
})();
```

  Then `goto('/brigade')` and, **without any other click first**, click the selected unit's first enabled `.rl-garage__buy-tier`. Wait 500 ms, read `window.__rlAudio`, and print it. The votes are:
  - `osc.length + buf > 0`: `garage: a session's first Buy made no sound (spec §9)`.
  - If there are any oscillators, `osc[0].f !== 520`: `garage: the first Buy played the ALERT's falling tone (R-2)`.
- [ ] **Step 5: Gates, falsify, commit.** Run the gates line plus `pnpm validate:audio && pnpm vitest run packages/render/src/audio.test.ts && pnpm ui:routes -- --port=5194`. Each of these must be seen red, then undone:
  - (a) Swap the purchase arm's two pitches. "rises" goes red.
  - (b) Delete the `ui_upgrade` arm. The upgrade test goes red, and the routes leg goes red on 520.
  - (c) Drop `onCue` from `main.ts`. The routes leg goes red on "no sound".
  - (d) Set the manifest gain to 2.0. `pnpm validate:audio` goes red.

  Commit the five paths with the message `feat(audio): the garage sounds -- a rising purchase, a ratchet for kit, never the alert (WP-S3g T11)`. The body names R-2 and the `packages/render` exception.

---

### Task 12: The two clips, from `tools/gen_audio.py` (D4)

**Model:** sonnet. It is mechanical Python with one rule: the output must not touch the battle clips. **Entry:** Task 0 Step 4 found numpy and ffmpeg. If either is missing, stop and report; Task 11 already ships a sounding garage.

**Files:**
- Modify: `tools/gen_audio.py`, `data/audio.json`, which the tool fills
- Generated: `assets/audio/ui_purchase/ui_purchase_01.{ogg,m4a}`, `assets/audio/ui_upgrade/ui_upgrade_01.{ogg,m4a}`

- [ ] **Step 1: Implement the two voices** after `destroyed()`. They are **dry and RNG-free** (R-9): no `noise()`, no `tail()`, and so no draw from the module's seeded `RNG`.

```python
# --- UI voices (garage uplift §3.5, §6) -------------------------------------
# Dry and RNG-free: a UI cue is "nowhere" (BattleAudio.playUi has no panner),
# and drawing nothing from RNG means generating these can never shift a battle
# clip's noise, and `--only` and a full run write the same samples.
UI_PEAK = 0.5   # -6 dBFS
UI_MAX_S = 0.25


def _at(n, start_s, voice):
    out = np.zeros(n)
    s = int(SR * start_s)
    out[s:s + len(voice)] = voice[: max(0, n - s)]
    return out


def ui_purchase(seed_shift=0.0):
    """A low clunk under a rising pair: a shop, not an alarm."""
    n = int(SR * 0.24)
    clunk = sine(n, 110, 70) * env(n, 0.002, 0.06, 4.0)
    m1, m2 = int(SR * 0.08), int(SR * 0.10)
    note1 = _at(n, 0.07, sine(m1, 330) * env(m1, 0.004, 0.07, 2.0))
    note2 = _at(n, 0.13, sine(m2, 494) * env(m2, 0.004, 0.09, 2.0))
    return norm(clunk + 0.6 * note1 + 0.6 * note2, UI_PEAK)


def ui_upgrade(seed_shift=0.0):
    """A ratchet (three pawl clicks, 30 ms apart), then the higher note."""
    n = int(SR * 0.24)
    m = int(SR * 0.012)
    click = np.sign(sine(m, 1800)) * env(m, 0.0005, 0.01, 6.0) * 0.5
    out = sum(_at(n, 0.03 * i, click) for i in range(3))
    k = int(SR * 0.13)
    out = out + _at(n, 0.10, sine(k, 880) * env(k, 0.004, 0.12, 2.0))
    return norm(out, UI_PEAK)


UI_SETS = {
    "ui_purchase": (ui_purchase, 1),
    "ui_upgrade": (ui_upgrade, 1),
}
```

  In `main()`:
  - Parse `--only=a,b`, where each name must be in `SETS` or `UI_SETS`; an unknown name makes it `sys.exit(2)`. Iterate over `{**SETS, **UI_SETS}` filtered by `--only`.
  - For a `UI_SETS` voice, check before encoding: `assert len(x) <= int(UI_MAX_S * SR), f"{name}: {len(x) / SR:.3f}s exceeds {UI_MAX_S}s"` and `assert np.max(np.abs(x)) <= UI_PEAK + 1e-9`.
  - Update the docstring's usage line.

  One variant per UI set is deliberate: a UI cue should be recognisable, so the README's "3–4 variants" is for battlefield one-shots only. Say so in the comment.
- [ ] **Step 2: Generate:** `python3 tools/gen_audio.py --only=ui_purchase,ui_upgrade`. Then `git status --short assets/audio data/audio.json` must show exactly the four new files and `data/audio.json`. `git diff data/audio.json` must touch only the two `ui_*` sets' `variants`.
- [ ] **Step 3: Verify.**
  - `pnpm validate:audio`.
  - `ffprobe -v error -show_entries stream=channels,duration -of csv=p=0 assets/audio/ui_purchase/ui_purchase_01.ogg`, and the same for the upgrade clip, must report `1` channel and ≤ 0.25 s.
  - Re-run the generator. `git status` must show no *new* change to any battle clip. The UI clips may re-encode byte-identically or not, depending on ffmpeg; record which.
  - `pnpm ui:routes -- --port=5194` is still green. Task 11's first-Buy leg then passes on either path, and prints which.
- [ ] **Step 4: Falsify, commit.** Each of these must be seen red, then undone:
  - (a) Set `ui_purchase`'s `n` to `int(SR * 0.3)`. The assertion fires, naming the set.
  - (b) Give one variant `"license": "proprietary"`. `pnpm validate:audio` goes red.
  - (c) Run with `--only=ui_nope`. It exits 2.

  Commit with `/usr/bin/git add` on the six paths, then `commit -s -F msg -- tools/gen_audio.py data/audio.json assets/audio/ui_purchase assets/audio/ui_upgrade`. The message is `feat(audio): two garage clips from gen_audio.py -- dry, mono, under 250 ms, -6 dBFS (WP-S3g T12, D4)`. The body states that the clips are CC0, generated by the project's own tool, and that no AI generation and no third-party source is involved.

---

### Task 13: The HUD card shows the kit (§3.4, D2)

**Model:** opus, because it touches `main.ts`.

**Files:**
- Modify: `packages/app/src/ui/hud.ts`, `packages/app/src/ui/hud.test.ts`, `packages/app/src/main.ts`, `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`

**Interfaces:** `HudDeps.kitOf?: (typeId: string) => KitSummary | null`.

- [ ] **Step 1: Write the failing tests.** Add to `hud.test.ts`, importing `type KitSummary` from `./kit-sign` and `fx` if it is not imported already:

```ts
describe('the single-unit card — kit (WP-S3g §3.4, D2)', () => {
  const summary = (over: Partial<KitSummary> = {}): KitSummary => ({
    level: 1,
    maxed: false,
    pips: [
      { track: 'armour', owned: 2, length: 3 },
      { track: 'sensors', owned: 1, length: 3 },
      { track: 'firepower', owned: 0, length: 3 },
    ],
    hpKit: 750,
    spent: 385,
    total: 1655,
    ...over,
  });

  it('draws all three tracks’ pips and the kit’s share of the hit points', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], { kitOf: () => summary() }, world);
    const card = r.host.querySelector('.rl-card');
    expect(card?.querySelectorAll('.rl-card__kit .rl-kit-pips__col')).toHaveLength(3);
    expect(card?.querySelector('.rl-card__hp')?.textContent).toMatch(/ · \+750 kit$/);
  });

  it('draws a fresh account’s card exactly as it did before', () => {
    const a = makeForce();
    const plain = clusterRig(() => [a.namer], {}, a).host.querySelector('.rl-card')?.innerHTML;
    const b = makeForce();
    const zero = clusterRig(() => [b.namer], { kitOf: () => summary({ level: 0, hpKit: 0, spent: 0 }) }, b).host.querySelector(
      '.rl-card'
    )?.innerHTML;
    expect(zero).toBe(plain);
  });

  it('never marks a unit the player does not command', () => {
    const world = makeForce();
    const enemy = world.sim.spawn(world.sim.state.typeIdx[world.namer], 1, fx.from(6), fx.from(6));
    const r = clusterRig(() => [enemy], { kitOf: () => summary() }, world);
    expect(r.host.querySelector('.rl-card .rl-kit-pips')).toBeNull();
    expect(r.host.querySelector('.rl-card__hp')?.textContent).not.toContain('kit');
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** In `cardHtml`, add `const kit = st.side[id] === 0 ? (this.deps.kitOf?.(type.id) ?? null) : null;` and `const kitted = kit !== null && kit.level !== 0;`:
  - After the veterancy stars, and before the hp span, add `(kitted ? `<span class="rl-card__kit">${kitPipsHtml(kit.pips)}</span>` : '')`.
  - The hp span becomes `t('hud.card.hp', …) + (kitted && kit.hpKit > 0 ? ` · ${t('hud.card.kit', { n: kit.hpKit })}` : '')`.
  - A level-0 or absent summary adds **nothing**, so every gated golden scenario, which boots a fresh account, draws unchanged.

  In `main.ts`, inside `bootBattlefield` right after `accountState()`, build:

```ts
  /** The kit on each KDF type, for the HUD card (WP-S3g §3.4): tiers are
   *  type-wide and fixed for the mission (brigade D3), so one summary per type,
   *  read once from the account through `accountState()`. */
  const kitByType = new Map<string, KitSummary>();
  for (const u of Object.values(units)) {
    if (u.faction === 'kdf') kitByType.set(u.id, kitSummary(u as unknown as UpgradableUnit, ownedTiers[u.id] ?? {}));
  }
```

  Pass `kitOf: (typeId) => kitByType.get(typeId) ?? null` in the `new Hud(...)` deps.

  In `theme.css`: `.rl-card__kit { display: inline-flex; margin-left: var(--s1); vertical-align: middle; }`.

  In `en.json`, delete `"garage.chip.owned"`. `grep -rn "garage.chip.owned" packages/app/src` must return nothing first.
- [ ] **Step 4: Look.** Run `pnpm ui:shots -- --port=5193 --only=garage --out=.superpowers/garage-uplift/t13` and read `07c-hud-card-kitted` at 1920×1080. The rifle squad's card shows three pip columns (2, 1, 0) and `· +60 kit`. Compare against Task 4's `07c`, which was unmarked. D6 says the card, not the map, is the low-zoom read, so check at the default zoom only.
- [ ] **Step 5: Gates, falsify, commit.** Run the gates line and `pnpm ui:routes -- --port=5194`. The golden gate is **not** run locally: its darwin baseline is stale. CI's `visual` job is the evidence, and it is expected green with no bless. Each of these must be seen red, then undone:
  - (a) Drop the `side === 0` guard. "never marks" goes red.
  - (b) Draw pips at level 0. "exactly as before" goes red.
  - (c) Pass `ownedTiers` of the *wrong* id (`ownedTiers[u.name]`). `07c` shows no kit, a visual red recorded in the ledger.

  Commit the five paths with the message `feat(app): the HUD card carries the kit -- three tracks' pips and the hit points it bought (WP-S3g T13, D2)`.

---

## Out of scope

- **Plan 2, lane B (renderer), 8 tasks:**
  - `RendererOptions.unitKit` and the app's feed of it (`kitLevel` per KDF type from `accountState()`, which Task 1 already provides);
  - the three overlay atlas cells in `ChevronBatch`, the draw and placement at (0, r+16), colour through `resolveColor`;
  - a `kit` debug layer with a visible-toggle check;
  - draw calls measured unchanged;
  - captures at 0.35, 1 and 2.5;
  - the golden scenario that sees the mark, which needs one bless from CI numbers.

  It is scheduled when no other lane holds `ThreeRenderer.ts`.
- **Plan 3, lane B (art), with S3a #180:**
  - kit numbers per vehicle, and the Blender kits for the 8 vehicle types;
  - the variant picked at load, and `validate:meshes` on variants;
  - `plates:units --kit` and the kitted plates. Wiring them into the bay (R-13) is a small app follow-up once their naming exists.
  - the close-up rig and the 49 close-ups that replace Task 7's glyph-over-hatch track headers;
  - Meshy only for genuinely new parts, announced with a credit estimate;
  - the textured-vehicle question for the lead;
  - provenance and disclosure.

  **Plan 3 drops "`gen_audio.py` clips"**: Task 12 made them (R-9).
- **Spec §4 "Comparison"**: ghosting a type's bars on Shift, and sorting the rail by kit level. See Open questions.
- **Moving the four glyphs into `ui/symbol.ts`** when G1 approves the sheet (#165). It is one import change per consumer, plus swapping `KIT_SYMBOLS`. The property tests move with them.
- **One `prefersReducedMotion()` in `motion.ts`**, replacing `scene-host.ts`'s `defaultReducedMotion` and Task 10's copy of it.
- **A lazy, per-roster GLB load**, which the kitted variants make more pressing (spec §9).
- **`packages/sim/**`**, which is untouched. **CLAUDE.md, HANDOVER.md** and the spec's status line are updated at landing from a main worktree, by the lead's protocol, not from this branch.

## Open questions for the lead

1. **Spec §4 "Comparison" has no plan.** §8 lists three plans, and none carries ghosting on Shift or sorting by kit level. Default: a one-task lane-A follow-up after this lands, using `statBar`'s preview segment for the ghost and `kitSummary.level` for the sort.
2. **R-2 edits `packages/render/src/audio.ts`** against the brief's "no `packages/render`". Default: keep it in Task 11, because the spec names it in plan 1 and without it a missing clip sounds like an alert. If the render package is held closed, Task 11's two render files lift out into a render-lane PR, and the app wiring (`onCue`) stays.

## Self-review

**Spec coverage.**

| Spec item | Task |
|---|---|
| F1 an upgrade changes nothing you can see | 5 (card pips and Maxed), 6 (plate frame and mark, kit segments) |
| F2 nor in the game | 13 (HUD card); the map mark is plan 2 |
| F3 purchase blanks the screen and moves you | 3 (in place, state kept), 4 (browser leg: same node, 0 blank frames, selection, focus, rail scroll, no reload) |
| F4 preview off-screen | 6 (panel in the bay; plate height by measurement), 9 (fit leg votes) |
| F5 an owned rung previews as if bought again | 6 (`previewDeltas`; R-6 also fixes future rungs) |
| F6 zero-change lines | 7 (`visibleBenefits`) |
| F7 locked unit shows an empty column | 8 |
| F8 keyboard | 9 (two stops, arrows select, 1–3, Enter; Tab leg), 3 (focus survives a buy) |
| F9 layout and height | 7 (height and ≥ 2200 px), 9 (fit leg votes) |
| F10 #237 | already on `main`; Task 3 and later keep its leg green |
| §2 goal 1: kit wherever the unit is | 5 (card), 6 (bay), 13 (HUD card); map in plan 2 |
| §2 goal 2: a purchase is an event | 3 (stays put), 10 (stamp, count, bars, cue), 11–12 (sound) |
| §2 goal 3: three tracks at once, preview in view | 6, 7, 9 |
| §2 goal 4: two registers apart | 2 (steel `--kit`, bevelled plate, no chevron or star shape), R-12 |
| §3.1 kit level `ceil(3·owned/available)` | 1 |
| §3.1 card pips; Earned, Bought, Maxed | 2 (pips), 5 |
| §3.1 plate frame and mark, 48 px and `KIT II` | 6 (kitted-plate swap: R-13, plan 3) |
| §3.1 stat delta: base, kit, preview; `3750` over `+750 kit`; panel in the bay | 6 |
| §3.2 kit mark and three track glyphs, the family's properties, a garage-local module | 2 (`KIT_SYMBOLS`, one line to swap) |
| §3.3 "now": track header glyph at 40 px over the hatch | 7 |
| §3.4 HUD card pips and delta; side 0 only | 13 |
| §3.5 visual: in place, sweep 240 ms, stamp 130 → 100%, bars 300 ms, wallet 400 ms mono, focus to next Buy, `ENLISTED`, Bought chip, reduced motion | 3, 5, 10 |
| §3.5 sound: two sets, a rising synth arm, `battleAudio()`, first gesture | 11, 12 |
| §4 hierarchy | 6 (bay), 7 (board) |
| §4 what you are buying: spent and to-max, kit total, F5, F6 | 6, 7 |
| §4 comparison | **not in any plan**: Open question 1 |
| §4 locked, empty, maxed, no account | 8 (no account: unchanged, pinned by the existing tests) |
| §4 keyboard | 9 |
| §4 1920 and 2560 | 7, 9 |
| §6 kit colour, kit level, card pips, plate mark, stamp, bars and wallet, sounds | 2, 1, 2, 6, 10, 10, 11 and 12 |
| §6 overlay mark, on-screen sizes, vehicle geometry, kitted plate and close-up | plans 2 and 3 |
| D1 overlay now, GLB later | plans 2 and 3 |
| D2 summary L on the map, three tracks on the HUD card and in the garage | 5, 7, 13 |
| D3 steel | 2 |
| D4 `gen_audio.py` | 12 (a CC0 swap stays possible: the manifest shape is unchanged) |
| D5 Blender close-ups | plan 3; Task 7's placeholders stand in |
| D6 no screen-constant mark | plan 2; Task 13 is the low-zoom read |
| D7 G1 Q5 answered "stars" | honoured: pips mean kit only; no veterancy surface uses them |
| D8 four glyphs to G1 | 2 (`KIT_SYMBOLS`, tested to the family's properties) |
| D9 no confirm, no refund | 3 and 7 (one click; the economy is unchanged; `buyUpgrade` untouched) |
| §9 risk: the golden gate cannot see the mark | plan 2; this plan moves no gated frame (Task 13's "exactly as before" test) |
| §9 risk: first gesture | 11 (the first-Buy leg) |

**Every check has an input that makes it fail**, named in its task: Task 1 (3), 2 (5), 3 (4, plus the scroll check in 4), 4 (3), 5 (3), 6 (4), 7 (4), 8 (3), 9 (5), 10 (4), 11 (4), 12 (3), 13 (3).

**Type consistency.**
- `KitLevel` and `KitCounts` (Task 1) are consumed only through `kitSummary` (Task 2) in the app, and by plan 2 directly.
- `KitSummary`, `TrackPip`, `KitTrack`, `KIT_TRACKS`, `isKitTrack`, `kitSymbolSvg`, `kitPipsHtml` and `kitLevelLabel` (Task 2) are consumed by name in Tasks 5, 6, 7 and 13.
- `GarageState` (Task 3) is the callbacks' return type, `main.ts`'s `now()`, and structurally the second argument of `purchaseLanded` (Task 10), which takes a narrower shape so that it stays pure.
- The focus-key scheme (R-4) is written in Task 3 and kept by name in Task 7 (`track:` on the head, `buy:` on the Buy, plus `rung:`) and Task 9 (digits).
- `TrackDeps.buy.onBuy(tier, price, asked)` (Task 7) feeds Task 3's `answer(…, asked)`, which Task 10 widens with its `PurchaseAsk`.
- `previewDeltas` (Task 6) is called by `trackEl` (Task 7). `StatPanel.preview` (Task 6) is the `TrackDeps.preview` Task 7 hands in.
- `CUE_SET` and `PurchaseCue` (Task 10) are consumed by `main.ts` (Task 11), and `CUE_SET`'s values are the two `data/audio.json` set names (Task 11), which Task 12 fills.
- `HudDeps.kitOf` (Task 13) returns Task 2's `KitSummary`.

**Placeholder scan.**
- Three values are deliberately set by measurement, and each says how:
  - Task 6's plate `max-height`: lowered from 42vh until the 1400×900 `03c` shows the panel and the hovered rung together, then voted by Task 9's leg.
  - Task 7's height `calc`: voted by Task 9's leg at three sizes.
  - Task 12's re-encode identity: recorded, not asserted.
- The four glyphs are **intentional placeholders** behind `KIT_SYMBOLS` (G1).
- These bodies are specified by their steps rather than written out:
  - `trackEl`'s and `statPanel`'s DOM (Tasks 6 and 7): they are DOM builders whose contract is given class by class and whose behaviour the tests pin.
  - `brigade.ts`'s edits (Tasks 3 and 5–10): these are edits to an existing 766-line file, given as the code that changes.
  - The three `ui:routes` legs and the `ui:shots` states (Tasks 4, 9, 11): harness code whose votes and messages are written out.
- No TBD remains.
- One string goes stale mid-plan, deliberately: `garage.chip.owned` has no reader from Task 5 until Task 13 deletes it.

**Model tiering.**
- **Opus:** Task 3 (`main.ts`, the mount's lifecycle), Task 10 (a rAF loop that must die with the screen), Task 11 (`main.ts`, and the plan's one `packages/render` edit) and Task 13 (`main.ts`), plus the final whole-branch review.
- **Sonnet:** Tasks 1, 2, 4, 5, 6, 7, 8, 9 and 12, each with its tests written out.
- **Haiku:** scoped re-reviews of a fix round.

Nothing inherits opus by default.

**Execution order.** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13, serially, on this one branch.
- Task 4 comes right after Task 3 on purpose: every look from Task 5 on is at the seeded audit state, and Task 4's leg is Task 3's browser falsification.
- Task 12 may run at any point after Task 11, which adds the manifest entries it fills.
- Task 13 needs only Task 2, but it follows Task 11 so that the three `main.ts` edits land in order and never conflict.
- Tasks 1–4 are a landable floor on their own (in place, instrumented, no visual change). Tasks 5–9 are the look. Tasks 10–13 are the event, the sound and the game.

**R-n at landing.** R-1 … R-13 become deviations in the spec's record when the lead lands the branch. Open questions 1 and 2 go with them.
