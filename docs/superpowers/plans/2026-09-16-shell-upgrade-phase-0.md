# Shell Upgrade Phase 0 — The Floor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the store-page blockers and first-minute embarrassments the 2026-09-16 shell review found — the generator banner, the void beyond the map, developer ids in the DOM, the pixel-fixed HUD, unreadable over-world text, the feed over the buttons, unconfirmed destructive links, a briefing with no back edge, colliding campaign labels and four dead ends — without changing any screen's structure and without touching the simulation.

**Architecture:** Eleven tasks in three layers. App/HUD (Tasks 1–8): DOM and CSS in `packages/app/src/ui/`, one new `confirm.ts`, one new `label-layout.ts`, one new `gate-sentence.ts`; every player-facing string produced app-side from data the sim already exposes. Renderer (Task 9): a `VignettePass` in the post chain and a ground skirt mesh, both registered as debug layers so the visual gate can toggle them. Tooling (Tasks 0 and 10): the review's capture harness promoted into `tools/`, and a plate capture that renders the key art from the running game. Every task ends green on `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm validate:ui`, `pnpm validate:data`; Task 9 is the one that moves the golden captures and carries the phase's single bless.

**Tech Stack:** TypeScript strict, vitest (jsdom per file via `// @vitest-environment jsdom`), three.js (only under `packages/render/src/three/`), Playwright via `tools/`, Ajv 2020 for `validate:data`, plain CSS with `color-mix()`.

**Spec:** `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md` — §6 "Phase 0" is the section this plan implements; §5 holds the binding constraints.

## Global Constraints

- `packages/sim/**` changes only by TYPE-ONLY additions to `MissionJson` in `packages/sim/src/mission.ts` (a schema field's mirror); no runtime statement in the sim changes; `pnpm test:determinism` hash is unchanged in every commit.
- `packages/app/src/ui/theme.css` is the only file naming an `--rl-*` variable; every other file uses semantic tokens; `pnpm validate:ui` runs with an empty allowlist. No hex, no `rgba()` outside `theme.css`'s token block; translucency is `color-mix()`.
- `three` is imported only under `packages/render/src/three/**`; `app` reaches the renderer through `packages/render/src/api.ts`'s `Renderer` interface.
- No `any`, no non-null assertions, no `Math.random` in app code, strict TypeScript. Tests colocate as `*.test.ts`.
- No `px` value ≥ 4 in `theme.css` after Task 3 except on a line ending in `/* px-ok */` (borders, hairlines, shadows).
- No mission id, map id, URL flag or gate expression reaches the DOM after Task 2. The only mission text shown is `name`, `briefing`, `objectives[].text`, and after Task 1 `triggers[].label`.
- Every `show*(stage, opts)` stays a pure function of its arguments (no new `window.location` reads inside a screen).
- The visual gate (`tools/src/golden-diff/baseline.ts`) thresholds are never widened. Task 9 is the only task expected to move the four gated scenarios; it is blessed ONCE, from CI numbers, through `visual-baseline-bless.yml`, with the `visual-baseline-bless-captures` artifact downloaded and looked at.
- Commits are one plain `/usr/bin/git` command per call, `-m` before `--`, explicit paths, never `git add -A`. Trailer verbatim: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never `pkill` or kill a process you did not start; never `preview_start` from this worktree; the dev server for captures is started by the harness itself (`tools/src/golden-diff/browser.ts`'s pattern) on a port it chooses.
- Worktree: `/Users/ilpinto/dev/roaring-lions-shell`, branch `feat/shell-upgrade`, based on `origin/main` at `0532611` (v0.65.0).

---

## File map

| file | task | responsibility |
|---|---|---|
| `tools/src/ui-review/shoot.ts` (new) | 0 | the eleven-state, three-resolution capture pass; the review instrument |
| `tools/package.json`, root `package.json` | 0 | `pnpm ui:shots` |
| `data/schemas/mission.schema.json` | 1 | `triggers[].label` |
| `packages/sim/src/mission.ts` (type only) | 1 | `label?: string` on the trigger JSON type |
| `packages/app/src/main.ts` | 1, 5, 6, 8 | `describeMissionEvent` trigger/say cases; unknown-mission error screen; ⌂ confirm wiring |
| `tools/validate_narrative.mjs`, `tools/src/validate_narrative.test.ts` | 1 | `triggerLabelFailures` |
| `data/missions/*.json` | 1 | one `label` per non-`remove` trigger |
| `packages/app/src/gate-sentence.ts` (new) + test | 2 | one human sentence per `UnlockGate`, app-side |
| `packages/app/src/campaign.ts`, `ui/brigade.ts`, `ui/worldmap.ts` | 2 | consume `gateSentence` and mission names |
| `packages/app/src/ui/menu.ts` | 2, 6, 10 | Free play relabel, no URL readout; confirm on reset; plate |
| `packages/app/src/ui/theme.css` | 3, 4, 5, 6, 7 | rem scale, `--ui-scale`, `.rl-plate`, `--bad-text`, cluster, DEPLOY, focus ring, board width |
| `tools/validate_ui_palette.mjs` + `tools/src/validate_ui_px.test.ts` (new) | 3 | the px rule |
| `data/palette.json` + `tools/src/bad-text-contrast.test.ts` (new) | 4 | `team.hostile_text` and its contrast pin |
| `packages/app/src/ui/hud.ts`, `hud.test.ts` | 4, 5, 6 | plates, feed inside the cluster, ⌂ as a confirmed button |
| `packages/app/src/ui/mission-notice.ts` + test | 5 | `sayNotice` removed |
| `packages/app/src/ui/confirm.ts` (new) + test | 6 | `confirmDialog` |
| `packages/app/src/ui/loading.ts`, `loading.test.ts` | 6 | Escape means back; DEPLOY |
| `packages/app/src/ui/label-layout.ts` (new) + test, `ui/worldmap3d.ts`, `ui/worldmap.ts` | 7 | label nudge pass, leader lines |
| `packages/app/src/ui/debrief.ts` + test, `data/tutorial/beit_sahwan_0.json` | 8 | dead ends |
| `packages/render/src/three/vignette-pass.ts` (new), `post-chain.ts`, `debug-layers.ts`, `ThreeRenderer.ts`, `terrain/skirt.ts` (new) | 9 | map edge |
| `tools/src/golden-diff/baseline.ts` | 9 | `vignette`/`skirt` layer checks with measured floors |
| `tools/src/perf/plate-capture.ts` (new), `assets/ui/menu_plate.jpg` (new), `assets/ui/menu_banner.jpg` (deleted) | 10 | key art |

---

### Task 0: Promote the review's capture harness

**Files:**
- Create: `tools/src/ui-review/shoot.ts` (from `.superpowers/ui-review-2026-09-16/shoot.ts`, which is on disk in this worktree, git-ignored)
- Modify: `tools/package.json` (scripts), root `package.json` (scripts)

**Interfaces:**
- Produces: `pnpm ui:shots [--res=1400x900,1920x1080,2560x1440] [--out=.superpowers/ui-shots]` writing `<out>/<WxH>/NN-<state>.png` for the eleven states: `01-menu`, `02-campaign`, `03-brigade`, `04-sandboxes`, `05-briefing`, `06-hud-idle`, `07-hud-selection-squad`, `08-hud-selection-mixed`, `09-hud-zoom2.5`, `10-hud-zoom0.5`, `11-hud-combat`. Every later task's acceptance is read off these files.

- [ ] **Step 1: Copy the script and read it**

```bash
mkdir -p tools/src/ui-review
cp .superpowers/ui-review-2026-09-16/shoot.ts tools/src/ui-review/shoot.ts
```

Read it end to end. It boots the app with Playwright, navigates the shell routes (`/`, `?campaign`, `?brigade`, `?sandboxes`, `?mission=beit_sahwan_1_recon`), waits for `document.fonts.status === 'loaded'`, drives the HUD states through `window.__lions` (`step`, `units`, `sel`, `renderer.camera.zoom`), and screenshots. Two things it must keep, both learned the hard way: **never abort `/@vite/client`** (Vite dev injects CSS-module styles through it; aborting it produces blank PNGs) and the output directory must be OUTSIDE the watched tree (a PNG written inside `packages/app` or `assets/` triggers `vite-plugin-asset-watch` and reloads the page being photographed) — `.superpowers/` is git-ignored and unwatched.

- [ ] **Step 2: Make the output directory and resolutions arguments**

Replace the script's hard-coded constants with:

```ts
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const OUT = path.resolve(arg('out', '.superpowers/ui-shots'));
const RESOLUTIONS = arg('res', '1400x900,1920x1080,2560x1440')
  .split(',')
  .map((s) => {
    const [w, h] = s.split('x').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error(`bad --res entry "${s}"`);
    return { width: w, height: h };
  });
```

- [ ] **Step 3: Wire the script**

`tools/package.json` scripts: `"ui:shots": "tsx src/ui-review/shoot.ts"`. Root `package.json` scripts: `"ui:shots": "pnpm --filter @lions/tools ui:shots"`.

- [ ] **Step 4: Run it once, at the branch base, and keep the output as the before-set**

```bash
pnpm ui:shots -- --out=.superpowers/ui-shots/before
```

Expected: 33 PNGs, none blank (`ls -la` shows every file > 50 KB). Open three by eye (`01-menu` at 2560, `08-hud-selection-mixed` at 1400, `02-campaign` at 1400) and confirm they show the review's defects: the stamp-sized menu, the feed over the buttons, the label smear.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm lint
pnpm typecheck
/usr/bin/git add tools/src/ui-review/shoot.ts tools/package.json package.json
/usr/bin/git commit -m "tools: the shell review's capture pass, promoted to pnpm ui:shots" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- tools/src/ui-review/shoot.ts tools/package.json package.json
```

---

### Task 1: Trigger labels — no developer id on the battlefield

**Files:**
- Modify: `data/schemas/mission.schema.json` (the `triggers.items.properties` block, ~line 496)
- Modify (type only): `packages/sim/src/mission.ts:254-268` (the inline `triggers?:` element type)
- Modify: `packages/app/src/main.ts:321-338` (`describeMissionEvent`)
- Modify: `tools/validate_narrative.mjs`, `tools/validate_data.mjs` (call site beside `removeTriggerFailures`, ~line 803)
- Test: `tools/src/validate_narrative.test.ts`, `packages/app/src/main.test.ts` if it exists, otherwise a new `packages/app/src/mission-event-text.test.ts` (see Step 5)
- Modify: every `data/missions/*.json` with a trigger whose `do.kind` is not `remove` (55 of 60 triggers today: 18 `commit`, 14 `withdraw_to`, 11 `spawn`, 6 `reinforce`, 1 `dismount`; the 5 `remove` triggers are silent housekeeping and get no label)

**Interfaces:**
- Produces: `MissionJson.triggers[i].label?: string`; `describeMissionEvent` returns `[label, 'warn']` for a labelled trigger and `null` for an unlabelled one — the `enemy reacts (id)` string ceases to exist.

- [ ] **Step 1: Write the failing schema test**

In `tools/src/validate_narrative.test.ts` add:

```ts
import { triggerLabelFailures } from '../validate_narrative.mjs';

describe('triggerLabelFailures', () => {
  it('names every non-remove trigger without a label', () => {
    const mission = {
      triggers: [
        { id: 'a', on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'g' } },
        { id: 'b', on: { kind: 'timer_s', value: 5 }, do: { kind: 'remove', group: 'g' } },
        { id: 'c', on: { kind: 'timer_s', value: 5 }, do: { kind: 'spawn', units: [] }, label: 'Enemy reinforcements arrive' },
      ],
    };
    expect(triggerLabelFailures('m.json', mission)).toEqual(['m.json: trigger "a" (commit) has no label']);
  });
  it('rejects a label over 48 characters or with a trailing full stop', () => {
    const mission = {
      triggers: [
        { id: 'a', on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'g' }, label: 'x'.repeat(49) },
        { id: 'b', on: { kind: 'timer_s', value: 5 }, do: { kind: 'commit', group: 'g' }, label: 'Enemy commits.' },
      ],
    };
    expect(triggerLabelFailures('m.json', mission)).toEqual([
      'm.json: trigger "a" label is 49 characters (max 48)',
      'm.json: trigger "b" label ends in a full stop',
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run tools/src/validate_narrative.test.ts
```
Expected: FAIL, `triggerLabelFailures` is not exported.

- [ ] **Step 3: Implement the check and the schema field**

In `tools/validate_narrative.mjs`, beside `removeTriggerFailures`:

```js
/** Every trigger a player can see fire carries a human label (spec §5: no id
 *  reaches the DOM). `remove` is silent housekeeping and is exempt. */
export function triggerLabelFailures(file, mission) {
  const out = [];
  for (const [i, t] of (mission.triggers ?? []).entries()) {
    const name = t.id ?? `trigger_${i}`;
    if (t.do?.kind === 'remove') continue;
    if (typeof t.label !== 'string' || t.label.length === 0) {
      out.push(`${file}: trigger "${name}" (${t.do?.kind}) has no label`);
      continue;
    }
    if (t.label.length > 48) out.push(`${file}: trigger "${name}" label is ${t.label.length} characters (max 48)`);
    if (t.label.endsWith('.')) out.push(`${file}: trigger "${name}" label ends in a full stop`);
  }
  return out;
}
```

Call it from `tools/validate_data.mjs` exactly where `removeTriggerFailures` is called (~line 803), pushing its failures into the same failure list.

Schema, `data/schemas/mission.schema.json`, inside `triggers.items.properties` after `"id"`:

```json
"label": {
  "type": "string",
  "maxLength": 48,
  "description": "What the player reads when this fires, in the feed. One clause, no full stop: 'Enemy reserves commit'. Required by validate:data for every trigger except do.kind = remove."
},
```

Type mirror, `packages/sim/src/mission.ts` in the inline `triggers?:` element type, after `id?: string;`: `label?: string;` — a type-only line; nothing in the sim reads it.

- [ ] **Step 4: Run the test to see it pass, then run validate:data to see it fail on the shipped missions**

```bash
pnpm exec vitest run tools/src/validate_narrative.test.ts
pnpm validate:data
```
Expected: the unit test passes; `validate:data` lists 55 unlabelled triggers by file and id.

- [ ] **Step 5: Change the HUD text, with a test**

`packages/app/src/main.ts:337-338` currently:

```ts
case 'trigger':
  return [`<b>enemy reacts</b> (${e.id})`, 'warn'];
```

becomes:

```ts
case 'trigger': {
  const label = triggerLabel(mission, e.id);
  return label === null ? null : [escapeHtml(label), 'warn'];
}
```

Add to `packages/app/src/ui/mission-notice.ts` (it already holds the pure text helpers `removedNotice`/`evacuatedNotice`):

```ts
/** The label a mission authored for the trigger that just fired, or null when
 *  it authored none -- and then the player sees NOTHING, never an id. `id` is
 *  what the runtime emitted: the trigger's own id, or `trigger_<index>` when it
 *  has none (mission.ts's fallback). */
export function triggerLabel(
  mission: { triggers?: readonly { id?: string; label?: string }[] } | undefined,
  id: string
): string | null {
  const triggers = mission?.triggers ?? [];
  const byId = triggers.find((t) => t.id === id);
  if (byId) return byId.label ?? null;
  const m = /^trigger_(\d+)$/.exec(id);
  if (!m) return null;
  return triggers[Number(m[1])]?.label ?? null;
}
```

`escapeHtml` — if `main.ts` has no HTML escaper already (grep `escapeHtml`), add the five-entity replace to `mission-notice.ts` and export it. `describeMissionEvent` builds `innerHTML`, so a label must be escaped.

Test, in `packages/app/src/ui/mission-notice.test.ts`:

```ts
describe('triggerLabel', () => {
  const mission = { triggers: [{ id: 'hunt', label: 'Enemy scouts hunt the drone' }, { label: 'Reserves commit' }, { id: 'silent' }] };
  it('reads the authored label by id', () => expect(triggerLabel(mission, 'hunt')).toBe('Enemy scouts hunt the drone'));
  it('reads the label of an id-less trigger through the runtime index fallback', () => expect(triggerLabel(mission, 'trigger_1')).toBe('Reserves commit'));
  it('is null for a trigger with no label, so nothing is shown', () => expect(triggerLabel(mission, 'silent')).toBeNull());
  it('is null for an unknown id', () => expect(triggerLabel(mission, 'nope')).toBeNull());
});
```

- [ ] **Step 6: Author the 55 labels**

One clause each, ≤ 48 characters, no full stop, written from what the player SEES happen, not from the trigger's mechanics. Read each trigger's `on`, `do`, `group` and the mission's briefing before writing it. Defaults by `do.kind` when the context adds nothing: `commit` → "Enemy reserves commit"; `withdraw_to` → "Enemy falls back"; `spawn` / `reinforce` → "Enemy reinforcements arrive"; `dismount` → "Enemy infantry dismounts". Prefer the specific: `hunt_the_scouts` → "Enemy scouts hunt the drone". A `say` on the same trigger is the commander's line, not the label; the label is the feed's own.

```bash
pnpm validate:data
pnpm exec vitest run packages/app/src/ui/mission-notice.test.ts
grep -rn "enemy reacts" packages/ && echo "STILL PRESENT" || echo "gone"
```
Expected: validate:data green; tests green; `gone`.

- [ ] **Step 7: Full gate and commit**

```bash
pnpm test
pnpm test:determinism
pnpm lint
pnpm typecheck
/usr/bin/git add data/schemas/mission.schema.json packages/sim/src/mission.ts packages/app/src/main.ts packages/app/src/ui/mission-notice.ts packages/app/src/ui/mission-notice.test.ts tools/validate_narrative.mjs tools/validate_data.mjs tools/src/validate_narrative.test.ts data/missions
/usr/bin/git commit -m "feat(missions): a trigger carries a label, and the feed shows that or nothing" -m "The battlefield printed 'enemy reacts (hunt_the_scouts)' -- a developer id, in eight of the eleven review captures. Every shipped trigger now authors what the player sees happen; validate:data refuses a non-remove trigger without one. The sim gains one optional type line and no runtime change: the determinism hash is unmoved." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- data/schemas/mission.schema.json packages/sim/src/mission.ts packages/app/src/main.ts packages/app/src/ui/mission-notice.ts packages/app/src/ui/mission-notice.test.ts tools/validate_narrative.mjs tools/validate_data.mjs tools/src/validate_narrative.test.ts data/missions
```

---

### Task 2: Human strings — campaign cards, Free play, brigade gates

**Files:**
- Create: `packages/app/src/gate-sentence.ts`, `packages/app/src/gate-sentence.test.ts`
- Modify: `packages/app/src/campaign.ts:179` (`lockedBecause`), `packages/app/src/ui/brigade.ts:68` (row reason), `packages/app/src/ui/menu.ts:42` (`CampaignOptions.missionOf` return type) and `main.ts:519` (its implementation), `packages/app/src/ui/menu.ts:288-370` (`showSandbox`), `packages/app/src/ui/menu.ts:115` (the aside label)
- Test: `packages/app/src/ui/brigade.test.ts`, `packages/app/src/ui/sandbox-menu.test.ts`, `packages/app/src/ui/worldmap.test.ts`

**Interfaces:**
- Consumes: `UnlockGate` (`roeMin? starsMin? afterMission?`), `LedgerData`, `conductAtLeast`, `starsEarned` from `@lions/sim` (already imported by `brigade.ts`).
- Produces: `gateSentence(gate: UnlockGate | undefined, ledger: LedgerData | undefined, missionName: (id: string) => string | undefined): string | null` — `null` when open; otherwise one human sentence. The sim's `unlockReason` is left untouched for the sim's own use; the app never renders its string again.

- [ ] **Step 1: Failing tests**

`packages/app/src/gate-sentence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gateSentence } from './gate-sentence';

const names = (id: string): string | undefined => ({ beit_sahwan_2_foothold: 'Foothold' })[id];

describe('gateSentence', () => {
  it('is null for no gate and for an open gate', () => {
    expect(gateSentence(undefined, {}, names)).toBeNull();
    expect(gateSentence({ afterMission: 'beit_sahwan_2_foothold' }, { beit_sahwan_2_foothold: { result: 'victory', roe: 80, stars: 2 } } as never, names)).toBeNull();
  });
  it('names the mission, never its id', () => {
    expect(gateSentence({ afterMission: 'beit_sahwan_2_foothold' }, {}, names)).toBe('Clear Foothold first');
  });
  it('falls back to a neutral sentence when the mission is unknown to the catalogue', () => {
    expect(gateSentence({ afterMission: 'zz' }, {}, names)).toBe('Clear an earlier mission first');
  });
  it('speaks Conduct as a standing, not a number to reach', () => {
    expect(gateSentence({ roeMin: 35 }, {}, names)).toBe('Needs a campaign Conduct of 35 or better');
  });
  it('counts stars', () => {
    expect(gateSentence({ starsMin: 3 }, {}, names)).toBe('Needs 3 stars (you have 0)');
  });
});
```

The `LedgerData` entry shape in the second test must match `packages/sim/src/ledger.ts` (grep `export interface LedgerData`) — adjust the literal to the real shape rather than casting through `never` if the shape is simple.

- [ ] **Step 2: Run to fail**

```bash
pnpm exec vitest run packages/app/src/gate-sentence.test.ts
```

- [ ] **Step 3: Implement**

```ts
import { conductAtLeast, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';

/** One human sentence per closed gate, app-side. The sim's `unlockReason`
 *  returns `requires clearing <mission_id>` because the sim does not know
 *  mission NAMES; the shell does, so it writes its own sentence and never
 *  renders an id. Branch order matches `unlockReason` (Conduct, stars, named
 *  mission) so both agree on WHICH gate is the binding one. */
export function gateSentence(
  gate: UnlockGate | undefined,
  ledger: LedgerData | undefined,
  missionName: (id: string) => string | undefined
): string | null {
  if (!gate) return null;
  if (gate.roeMin !== undefined && !conductAtLeast(ledger, gate.roeMin)) {
    return `Needs a campaign Conduct of ${gate.roeMin} or better`;
  }
  if (gate.starsMin !== undefined) {
    const have = starsEarned(ledger);
    if (have < gate.starsMin) return `Needs ${gate.starsMin} star${gate.starsMin === 1 ? '' : 's'} (you have ${have})`;
  }
  if (gate.afterMission !== undefined && ledger?.[gate.afterMission]?.result !== 'victory') {
    const name = missionName(gate.afterMission);
    return name ? `Clear ${name} first` : 'Clear an earlier mission first';
  }
  return null;
}
```

Check `conductAtLeast`/`starsEarned` signatures in `packages/sim/src/unlock.ts` and the ledger's victory shape (`result === 'victory'` — confirm the literal in `packages/sim/src/ledger.ts`) and match them.

- [ ] **Step 4: Wire the three consumers**

- `packages/app/src/campaign.ts:179`: `const lockedBecause = gateSentence(region.unlock, ledger, missionName);` — thread a `missionName` argument into the function that computes it (it is called from the campaign screen, which has `missionOf`; widen `CampaignOptions.missionOf`'s return type in `menu.ts:42` to include `name?: string`, and pass `(id) => opts.missionOf(id)?.name`).
- `packages/app/src/ui/brigade.ts:68`: `const reason = gateSentence(u.unlock, ledger, missionName);` — `BrigadeOptions` gains `missionName: (id: string) => string | undefined`; `main.ts:541` passes `(id) => missions[id]?.name`.
- `showSandbox` (`menu.ts:288-370`): the screen's heading becomes "Free play"; the map list shows each map's human name (`maps[id].name` — confirm `MapJson` carries `name`; if not, title-case the id with underscores as spaces, in a `mapTitle(id)` helper beside `showSandbox`, tested); delete the `readout` element (`menu.ts:360`, the `?sandbox=MAP_ID` line) and the flag names next to each checkbox — the checkbox label is the `blurb` alone, with the flag's name in `title` for the curious. `menu.ts:115`: `addAside('free play — any map', '?sandboxes')`.

- [ ] **Step 5: Update the screen tests**

`brigade.test.ts`: the locked row's `.rl-brigade__why` reads `Needs a campaign Conduct of 35 or better`. `sandbox-menu.test.ts`: no element's text contains `?sandbox=` or `MAP_ID`; a map's link text has no underscore. `worldmap.test.ts`: a locked region's `.rl-world__cardprogress` reads `Clear <name> first`.

```bash
pnpm exec vitest run packages/app/src
grep -rn "requires clearing\|MAP_ID\|requires campaign Conduct" packages/app/src --include=*.ts | grep -v test && echo "STILL PRESENT" || echo gone
```

- [ ] **Step 6: Gate and commit**

```bash
pnpm test && pnpm lint && pnpm typecheck
/usr/bin/git add packages/app/src/gate-sentence.ts packages/app/src/gate-sentence.test.ts packages/app/src/campaign.ts packages/app/src/ui/brigade.ts packages/app/src/ui/brigade.test.ts packages/app/src/ui/menu.ts packages/app/src/ui/sandbox-menu.test.ts packages/app/src/ui/worldmap.test.ts packages/app/src/main.ts
/usr/bin/git commit -m "feat(ui): every gate is a sentence, every map is a name, and no URL reaches the player" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/gate-sentence.ts packages/app/src/gate-sentence.test.ts packages/app/src/campaign.ts packages/app/src/ui/brigade.ts packages/app/src/ui/brigade.test.ts packages/app/src/ui/menu.ts packages/app/src/ui/sandbox-menu.test.ts packages/app/src/ui/worldmap.test.ts packages/app/src/main.ts
```

---

### Task 3: UI scale — one number, rem everywhere

**Files:**
- Modify: `packages/app/src/ui/theme.css` (whole file, mechanically), `packages/app/index.html` (root font-size is set in CSS, not here — nothing to change unless a `font-size` appears; confirm)
- Modify: `tools/validate_ui_palette.mjs`; Create: `tools/src/validate_ui_px.test.ts`
- Modify: `packages/app/src/ui/menu.ts:58-59` (banner width/height attributes stay; they are intrinsic-size hints, not layout)

**Interfaces:**
- Produces: `:root { --ui-scale: 1 }` with viewport defaults; `html { font-size: calc(16px * var(--ui-scale)) /* px-ok */ }`; every token and dimension in `rem`. Phase 1's settings will write `--ui-scale` on `document.documentElement.style`.

Why this is safe to do mechanically: at `--ui-scale: 1` the root is 16px, and every px value in the sheet is a multiple of 1 px, so `N px → (N/16) rem` renders to the SAME device pixels (rem resolves to N × 16 / 16). The 1400×900 captures in Step 6 prove it: byte-identical PNGs before and after, at scale 1.

- [ ] **Step 1: Write the px rule test first**

`tools/src/validate_ui_px.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pxFailures } from '../validate_ui_palette.mjs';

describe('pxFailures', () => {
  it('rejects a layout px value and accepts hairlines and tagged lines', () => {
    const css = [
      '.a { width: 460px; }',
      '.b { border: 1px solid red; }',
      '.c { border-width: 2px; }',
      '.d { height: 42px; /* px-ok */ }',
      '.e { text-shadow: 0 1px 12px black; }',
      'html { font-size: calc(16px * var(--ui-scale)); /* px-ok */ }',
    ].join('\n');
    expect(pxFailures('theme.css', css)).toEqual(['theme.css:1: 460px -- use rem (or tag the line /* px-ok */ for a hairline)']);
  });
});
```

Rule: any `(\d+)px` with the number ≥ 4 fails unless the line ends in `/* px-ok */` or the value sits inside a `text-shadow`/`box-shadow`/`filter` declaration (blur radii are optical, not layout).

- [ ] **Step 2: Run to fail; implement `pxFailures` in `tools/validate_ui_palette.mjs`**

```js
const SHADOW_PROPS = /\b(text-shadow|box-shadow|filter|drop-shadow)\b/;
/** Layout must scale with --ui-scale (spec §5: UI scale is one number), so a
 *  px value of 4 or more in UI CSS is a defect unless the line says why. */
export function pxFailures(file, css) {
  const out = [];
  css.split('\n').forEach((line, i) => {
    if (line.includes('/* px-ok */') || SHADOW_PROPS.test(line)) return;
    for (const m of line.matchAll(/(\d+(?:\.\d+)?)px\b/g)) {
      if (Number(m[1]) >= 4) out.push(`${file}:${i + 1}: ${m[0]} -- use rem (or tag the line /* px-ok */ for a hairline)`);
    }
  });
  return out;
}
```

Run it from the script's main sweep over `packages/app/src/ui/theme.css` (and any other `.css` the sweep already reads), failing the run like the colour-literal rule does. Note the file's existing structure: if its main sweep runs at import time (as `validate_data.mjs` does), split the checkers into exported functions the way `validate_narrative.mjs` is, and keep the test importing only the pure function.

- [ ] **Step 3: Convert the sheet**

Write `tools/px_to_rem.mjs` (throwaway, not committed) that rewrites `theme.css`: every `(\d+)px` with N ≥ 4 outside `text-shadow`/`box-shadow`/`filter` declarations and outside `@font-face` blocks becomes `${N/16}rem` (print with up to 4 decimals, trimmed: `10px → 0.625rem`, `460px → 28.75rem`, `1140px → 71.25rem`, `150px → 9.375rem`). Values inside `clamp()`, `min()`, `max()` and `calc()` are converted too (`min(460px, 92vw)` → `min(28.75rem, 92vw)`; `clamp(34px, 7vw, 52px)` → `clamp(2.125rem, 7vw, 3.25rem)`). `1px`, `2px`, `3px` stay. Then add at the top of `:root` (`theme.css:56`):

```css
  /* UI scale (spec 2026-09-16 §5): every dimension below is rem, so this one
     number sizes the whole shell. Viewport defaults; Phase 1's settings
     override it on the root element's style. */
  --ui-scale: 1;
```

and immediately after the `:root` block:

```css
@media (min-width: 1900px) { :root { --ui-scale: 1.15; } }
@media (min-width: 2400px) { :root { --ui-scale: 1.35; } }
html { font-size: calc(16px * var(--ui-scale)); /* px-ok */ }
```

(`body` keeps `font-size: var(--t-body)`; `--t-body` is now `0.75rem`.)

- [ ] **Step 4: Verify the sheet is otherwise unchanged**

```bash
pnpm validate:ui
git diff --stat packages/app/src/ui/theme.css
```
Expected: validate:ui green (no px ≥ 4 untagged); the diff touches only lines that had px values plus the new block.

- [ ] **Step 5: Prove pixel identity at scale 1 and growth at 2560**

```bash
pnpm ui:shots -- --out=.superpowers/ui-shots/task3
```
Compare `before/1400x900/*.png` with `task3/1400x900/*.png` with a pixel diff (`pnpm exec tsx -e` a 20-line pngjs/pixelmatch script, both are in `tools/node_modules`): expected 0 differing pixels on every 1400×900 pair (the HUD states may differ by unit animation noise inside the canvas; compare with the canvas region masked, or compare only the five shell screens which hold still). Then look at `task3/2560x1440/01-menu.png`: the column must now be ≥ 28% of the frame width (`min(28.75rem, 92vw)` at a 21.6 px root = 621 px, 24% — if the measurement reads under 28%, raise the 2400px breakpoint's scale to 1.5 and re-shoot; record the number chosen and why in the commit).

- [ ] **Step 6: Gate and commit**

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:ui
/usr/bin/git add packages/app/src/ui/theme.css tools/validate_ui_palette.mjs tools/src/validate_ui_px.test.ts
/usr/bin/git commit -m "feat(ui): the shell scales -- every dimension in rem behind one --ui-scale" -m "Byte-identical at 1400x900 (measured: 0 differing pixels on the five shell screens); the menu column at 2560x1440 goes from 18% of the frame to <measured>%. validate:ui now refuses an untagged layout px." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/ui/theme.css tools/validate_ui_palette.mjs tools/src/validate_ui_px.test.ts
```

---

### Task 4: Plates under over-world text, a readable red, no 10 px reading

**Files:**
- Modify: `packages/app/src/ui/theme.css` (`.rl-onmap` ~715, `.rl-hint` ~1047, `.rl-notice` ~1039, `.rl-clock` ~829, `.rl-titlecard*` ~1422-1465, `.rl-bad` 609, token block), `packages/app/src/ui/hud.ts:359-360, 559-562`, `packages/app/src/ui/motion.ts` (`titleCard`), `packages/app/src/ui/hud.test.ts` (the assertion at ~489 that a feed line has `rl-onmap` and not `rl-panel`)
- Modify: `data/palette.json` (`team` block, beside `"hostile": "#D93A2B"`)
- Create: `tools/src/bad-text-contrast.test.ts`

**Interfaces:**
- Produces: `.rl-plate` (panel ground behind any text drawn over the world), `--bad-text` (≥ 4.5:1 on the panel ground), and the five `--bad` text sites moved to `.rl-bad-text`.

- [ ] **Step 1: The contrast test, failing**

`tools/src/bad-text-contrast.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('the red that renders as text', () => {
  const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8'));
  const panel: string = palette.ramps.shadow.colors[1]; // --rl-shadow-1, the panel ground
  it('team.hostile_text reads at AA over the panel ground, where team.hostile does not', () => {
    expect(contrast(palette.team.colors.hostile, panel)).toBeLessThan(4.5); // the review's 4.01 -- the reason the token exists
    expect(contrast(palette.team.colors.hostile_text, panel)).toBeGreaterThanOrEqual(4.5);
  });
});
```

Confirm the palette's JSON paths (`ramps.shadow.colors[1]`, `team.hostile`) by reading `data/palette.json`; adjust the accessors, not the assertion.

- [ ] **Step 2: Add the palette entry and the tokens**

`data/palette.json`, `team` block: `"hostile_text": "#F26A55"` (5.7:1 on `#14150F`, computed). `theme.css` token block, after `--bad`: `--bad-text: var(--rl-team-hostile-text);` — check the Vite palette plugin's naming rule for an underscore key (grep `packages/app/vite-plugin-palette.ts`); if it does not kebab an underscore, name the key `hostile-text` instead. Then:

```css
.rl-bad-text { color: var(--bad-text); }
.rl-plate {
  background: var(--panel-bg);
  padding: 0.125rem 0.5rem;
  border-radius: 2px; /* px-ok */
}
```

- [ ] **Step 3: Apply**

- `hud.ts:360`: `this.hint.className = 'rl-hint rl-plate';` (the halo stays available through `.rl-onmap` for glyph-only marks; the hint no longer uses it).
- `hud.ts:561`: `` el.className = `rl-notice rl-enter rl-plate rl-${tone}`; ``
- `motion.ts` `titleCard`: the title, subtitle and dispatch elements get `rl-plate` in addition to their own class; `.rl-titlecard` gets `display: grid; gap: 0.25rem; justify-items: center;` so each line is its own plate.
- `theme.css` `.rl-clock`: add `background: var(--panel-bg); padding: 0.125rem 0.5rem;` (it is a number over the world too).
- The five `--bad` text sites in `hud.ts` (lines 708, 753, 856, 1100, 1104): `rl-bad` → `rl-bad-text`. `.rl-bad` stays for the fills and the debrief list.
- `--t-xs` consumers that a player reads: `.rl-tile__cost`, `.rl-tile__left`, `.rl-tile__lock`, `.rl-card__record`, `.rl-brigade__why`, `.rl-loading__label`, `.rl-loading__count`, `.rl-loading__commander`, `.rl-loading__brought-head`, `.rl-sandbox__mapid` → `--t-s`. `.rl-loading__deploy` is Task 6's. The remaining `--t-xs` uses (`.rl-panel__tag`, `.rl-label`, `.rl-score__k`, `.rl-world__bearing`, `.rl-wordmark__unit`, `.rl-tile--support`) are labels, not reading, and stay.

- [ ] **Step 4: Update `hud.test.ts` and run**

The feed-line assertion becomes: className contains `rl-plate` and not `rl-panel`; the hint's className contains `rl-plate`. Add: a failed primary in the strip carries `rl-bad-text`.

```bash
pnpm exec vitest run packages/app/src/ui/hud.test.ts tools/src/bad-text-contrast.test.ts
pnpm validate:ui
```

- [ ] **Step 5: Look, gate, commit**

```bash
pnpm ui:shots -- --res=1400x900 --out=.superpowers/ui-shots/task4
```
`06-hud-idle.png`: the hint line sits on a dark plate; sample its glyph and backdrop with the review's method (`A-visibility-report.md` §F1) — expected ≥ 4.5:1.

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:ui && pnpm validate:assets
/usr/bin/git add data/palette.json tools/src/bad-text-contrast.test.ts packages/app/src/ui/theme.css packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/motion.ts
/usr/bin/git commit -m "fix(ui): a plate under every string drawn over the world, and a red that reads" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- data/palette.json tools/src/bad-text-contrast.test.ts packages/app/src/ui/theme.css packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/motion.ts
```

`pnpm validate:assets` is in this task's gate because it reads the palette; a new reserved-band entry must not change any sprite's verdict.

---

### Task 5: The bottom cluster stacks; a commander line is said once

**Files:**
- Modify: `packages/app/src/ui/hud.ts:443-452` (host append order), `theme.css` `.rl-feed` (~1027), `.rl-sel` (~1116), `.rl-card` (~1288)
- Modify: `packages/app/src/main.ts:321-338` (`describeMissionEvent` `case 'say'`) and `2039-2043`
- Modify: `packages/app/src/ui/mission-notice.ts` (`sayNotice` deleted), `mission-notice.test.ts`
- Test: `packages/app/src/ui/hud.test.ts`

**Interfaces:**
- Produces: the feed is the FIRST child of `.rl-sel` (so it always sits above the order row and the card, separated by the column's `gap`); `.rl-card` scrolls inside `max-height: calc(100vh - 12rem)`; a `say` event drives `Hud.say` only.

- [ ] **Step 1: Failing HUD test**

In `hud.test.ts`, in the event-feed block:

```ts
it('stacks the feed above the selection cluster instead of over it', () => {
  const feed = host.querySelector('.rl-feed');
  expect(feed?.parentElement?.classList.contains('rl-sel')).toBe(true);
  expect(feed?.parentElement?.firstElementChild).toBe(feed);
});
```

and in `mission-notice.test.ts` delete the `sayNotice` tests.

- [ ] **Step 2: Implement**

`hud.ts:443-452`: remove `this.feed` from `host.append(...)` and, where `this.sel` is built, `this.sel.prepend(this.feed)`. `theme.css` `.rl-feed`: delete `position: absolute; left; bottom: 150px; transform;` — keep `width: 35rem; display: flex; flex-direction: column-reverse; gap: 2px; text-align: center; pointer-events: none;` and add `align-self: center; margin-bottom: 0.375rem;`. `.rl-card`: add `max-height: calc(100vh - 12rem); overflow-y: auto;`.

`main.ts` `describeMissionEvent`: `case 'say': return null;` (the bar is the one surface; `hud.say` at line 2043 already runs for every `say`). Delete `sayNotice` from `mission-notice.ts` and its import.

- [ ] **Step 3: Run, look, commit**

```bash
pnpm exec vitest run packages/app/src/ui
pnpm ui:shots -- --res=1400x900 --out=.superpowers/ui-shots/task5
```
`08-hud-selection-mixed.png`: the feed line sits above the order row with clear space; the card's bottom edge is on screen. `11-hud-combat.png` (a `say` fires in the first minute of `beit_sahwan_1_recon`): the sentence appears in the commander bar and NOT in the feed.

```bash
pnpm test && pnpm lint && pnpm typecheck
/usr/bin/git add packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/theme.css packages/app/src/main.ts packages/app/src/ui/mission-notice.ts packages/app/src/ui/mission-notice.test.ts
/usr/bin/git commit -m "fix(hud): the feed stacks above the cluster, the card scrolls, and a commander line is said once" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/theme.css packages/app/src/main.ts packages/app/src/ui/mission-notice.ts packages/app/src/ui/mission-notice.test.ts
```

---

### Task 6: Confirm what destroys; Escape means back; DEPLOY is a button

**Files:**
- Create: `packages/app/src/ui/confirm.ts`, `packages/app/src/ui/confirm.test.ts`
- Modify: `packages/app/src/ui/hud.ts:280-284` (⌂), `packages/app/src/ui/menu.ts:116` (reset), `packages/app/src/ui/loading.ts:377-380, 454-471`, `packages/app/src/ui/loading.test.ts:159-188`, `theme.css` (`.rl-loading__deploy` ~2407, a global `:focus-visible`, `.rl-strip__link`)

**Interfaces:**
- Produces: `confirmDialog(host: HTMLElement, opts: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean>` — modal panel, focus on Cancel, Escape = false, Enter on the confirm button = true, removes itself.
- `LoadingOptions` (or whatever `showLoading`'s options type is called) gains `onBack?: () => void`; `main.ts` passes `() => window.location.assign('?campaign')` for a mission and nothing for a sandbox.

- [ ] **Step 1: Failing tests for the dialog**

`confirm.test.ts` (`// @vitest-environment jsdom`):

```ts
it('resolves false on Escape and true on the confirm button, and removes itself either way', async () => {
  const host = document.createElement('div');
  const p = confirmDialog(host, { title: 'Leave the fight?', body: 'This attempt is lost.', confirm: 'Leave', danger: true });
  expect(host.querySelector('.rl-confirm')).not.toBeNull();
  host.querySelector<HTMLButtonElement>('.rl-confirm__yes')?.click();
  await expect(p).resolves.toBe(true);
  expect(host.querySelector('.rl-confirm')).toBeNull();
  const q = confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await expect(q).resolves.toBe(false);
});
it('focuses Cancel, so an Enter that was meant for the game does not confirm', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  void confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
  expect(document.activeElement?.classList.contains('rl-confirm__no')).toBe(true);
});
```

- [ ] **Step 2: Implement `confirm.ts`**

```ts
export interface ConfirmOptions { title: string; body: string; confirm: string; danger?: boolean }

/** One modal for everything that destroys: leaving a mission, wiping the
 *  ledger. Cancel takes focus, Escape cancels, and the panel names what is
 *  lost in `body` -- a confirm that says only "are you sure?" is decoration. */
export function confirmDialog(host: HTMLElement, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'rl-confirm';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    const panel = document.createElement('div');
    panel.className = 'rl-confirm__panel rl-panel';
    const h = document.createElement('div'); h.className = 'rl-band'; h.textContent = opts.title;
    const b = document.createElement('p'); b.className = 'rl-confirm__body'; b.textContent = opts.body;
    const row = document.createElement('div'); row.className = 'rl-confirm__row';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'rl-btn rl-confirm__no'; no.textContent = 'Cancel';
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'rl-btn rl-confirm__yes'; yes.textContent = opts.confirm;
    if (opts.danger) yes.dataset.danger = '1';
    const done = (v: boolean): void => { window.removeEventListener('keydown', onKey); scrim.remove(); resolve(v); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') done(false); };
    no.addEventListener('click', () => done(false));
    yes.addEventListener('click', () => done(true));
    scrim.addEventListener('click', (e) => { if (e.target === scrim) done(false); });
    window.addEventListener('keydown', onKey);
    row.append(no, yes); panel.append(h, b, row); scrim.appendChild(panel); host.appendChild(scrim);
    no.focus();
  });
}
```

Use the real band/panel/button class names the sheet defines (`rl-panel`, `rl-band`, `rl-btn` — confirm by grep; the stamped band is the identity the review says to keep). CSS: `.rl-confirm { position: fixed; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--scrim) 60%, transparent); z-index: 50; }`, `.rl-confirm__panel { width: min(26rem, 92vw); }`, `.rl-confirm__row { display: flex; justify-content: flex-end; gap: var(--s2); }`, `.rl-confirm__yes[data-danger='1'] { border-color: var(--bad); color: var(--bad-text); }`.

- [ ] **Step 3: Wire ⌂ and reset**

`hud.ts:280-284`: the anchor becomes a `<button type="button" class="rl-strip__link">` with `textContent = '⌂ leave'` and `title = 'leave the mission'`; on click: `void confirmDialog(document.body, { title: 'Leave the mission?', body: 'This attempt is lost. The campaign keeps everything from before it.', confirm: 'Leave', danger: true }).then((ok) => { if (ok) window.location.assign('?campaign'); });`. Move it to the strip's far LEFT (before the objective text), out of the speed/mute cluster on the right: find where the strip's children are appended and insert it first. `Hud` must not import `window.location` reads — a `deps.leave?: () => void` in the Hud deps is the pure shape; `main.ts` passes the `location.assign`. Do that.

`menu.ts:116`: the aside becomes a button: on click `confirmDialog(stage, { title: 'Start the campaign over?', body: 'Your campaign progress, brigade account and tutorial completion are erased.', confirm: 'Erase and restart', danger: true })` then `window.location.assign('?fresh=1')` — `showMenu` takes `opts.reset: () => void` from `main.ts` for the navigation.

- [ ] **Step 4: The briefing's back edge and DEPLOY**

`loading.ts:454-471`: delete the `window.addEventListener('pointerdown', dismiss)` line and its removal; `onKey` becomes `if (e.key === 'Escape' && opts.onBack) { cleanup(); opts.onBack(); }` where `cleanup` removes the listeners and the wrap WITHOUT resolving (the mission never starts; the page navigates away). Only `deploy`'s click resolves. `loading.test.ts:174` ("still deploys on Escape…") becomes "goes back on Escape when the briefing has somewhere to go back to, and never deploys" — assert `onBack` was called and the promise is still pending after a macrotask; `loading.test.ts:159` keeps asserting a scroll key does nothing; add "a click on the briefing text does not deploy".

`deploy.textContent = 'Deploy'`; CSS `.rl-loading__deploy`: `font-family: var(--font-display); font-size: var(--t-xl); letter-spacing: 0.04em; text-transform: uppercase; padding: var(--s2) var(--s6); background: var(--band-mission); color: var(--ink); border: 0;` with `:hover` lightening via `color-mix(in srgb, var(--band-mission) 80%, var(--ink))`. Add a back link under it when `opts.onBack` exists: `<button class="rl-btn rl-loading__back">← campaign map</button>` calling the same `onBack`.

Global ring, at the end of the token block's consumers (near `.rl-btn:focus-visible` ~580):

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } /* px-ok */
```

and delete `outline: none` at `.rl-tile:focus-visible` (~1525) only if that rule draws no ring of its own; if it does (a border change), leave it.

- [ ] **Step 5: Run, look, commit**

```bash
pnpm exec vitest run packages/app/src/ui
pnpm ui:shots -- --res=1400x900 --out=.superpowers/ui-shots/task6
```
`05-briefing.png`: DEPLOY in the display face on a filled olive band; a back link beneath. Drive it: in the harness's briefing state, press Escape and assert the URL becomes `?campaign` (add that assertion to `shoot.ts` as a console line, not a gate).

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:ui
/usr/bin/git add packages/app/src/ui/confirm.ts packages/app/src/ui/confirm.test.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/menu.ts packages/app/src/ui/loading.ts packages/app/src/ui/loading.test.ts packages/app/src/ui/theme.css packages/app/src/main.ts
/usr/bin/git commit -m "feat(ui): confirm what destroys, Escape means back on the briefing, and DEPLOY is a button" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/ui/confirm.ts packages/app/src/ui/confirm.test.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/menu.ts packages/app/src/ui/loading.ts packages/app/src/ui/loading.test.ts packages/app/src/ui/theme.css packages/app/src/main.ts
```

---

### Task 7: Campaign board — labels that do not collide, an exit on screen, a board that grows

**Files:**
- Create: `packages/app/src/ui/label-layout.ts`, `packages/app/src/ui/label-layout.test.ts`
- Modify: `packages/app/src/ui/worldmap3d.ts:366-375` (`onFrame`), `packages/app/src/ui/worldmap.ts` (the flat board places its pins once; apply the same pass), `packages/app/src/ui/menu.ts:256-264` (back nav), `theme.css` (`.rl-world__town` ~304/345-364, `.rl-world__board` 301, `.rl-menu:has(.rl-world)` ~1783)

**Interfaces:**
- Produces: `nudgeLabels(items: readonly { id: string; x: number; y: number; w: number; h: number }[], gap: number): ReadonlyMap<string, number>` — a vertical offset per id such that no two label boxes overlap, greedy in y order, offsets always downward, deterministic.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { nudgeLabels } from './label-layout';

describe('nudgeLabels', () => {
  it('leaves separated labels alone', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 0, y: 40, w: 80, h: 16 }], 4);
    expect([...m.values()]).toEqual([0, 0]);
  });
  it('pushes the lower of two overlapping labels down by exactly the overlap plus the gap', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 10, y: 6, w: 80, h: 16 }], 4);
    expect(m.get('a')).toBe(0);
    expect(m.get('b')).toBe(14); // a's bottom is 16, b wants top 6 -> 20 with the gap: +14
  });
  it('does not push labels that overlap only horizontally', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 100, y: 6, w: 80, h: 16 }], 4);
    expect(m.get('b')).toBe(0);
  });
  it('chains: three stacked labels each clear the one above', () => {
    const m = nudgeLabels([{ id: 'a', x: 0, y: 0, w: 80, h: 16 }, { id: 'b', x: 0, y: 4, w: 80, h: 16 }, { id: 'c', x: 0, y: 8, w: 80, h: 16 }], 0);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual([0, 12, 24]);
  });
});
```

- [ ] **Step 2: Implement**

```ts
export interface LabelBox { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Greedy top-down: sort by y, and push each label below every already-placed
 *  label whose horizontal span it shares. Offsets are downward only, so a pin
 *  keeps its label near it and the pass is stable frame to frame. O(n²) over
 *  a dozen towns, called once per frame while the board turns. */
export function nudgeLabels(items: readonly LabelBox[], gap: number): ReadonlyMap<string, number> {
  const placed: { x0: number; x1: number; y1: number }[] = [];
  const out = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let top = it.y;
    for (const p of placed) {
      const sharesX = it.x < p.x1 && it.x + it.w > p.x0;
      if (sharesX && top < p.y1 + gap) top = p.y1 + gap;
    }
    out.set(it.id, top - it.y);
    placed.push({ x0: it.x, x1: it.x + it.w, y1: top + it.h });
  }
  return out;
}
```

- [ ] **Step 3: Apply in `onFrame` and the flat board**

In `worldmap3d.ts` `onFrame`: after positioning each pin, build the boxes from the projected `t.x, t.y` and each label's cached size (`label.offsetWidth/offsetHeight`, measured once when `data-placed` flips to `'1'` and stored in a `Map<string, {w,h}>`), call `nudgeLabels(boxes, 4)`, and for each pin set `pin.style.setProperty('--dy', `${dy}px`)` and `pin.style.setProperty('--leader', `${Math.max(0, dy - 4)}px`)`. CSS: the 3D town label's `transform: translate(14px, -50%)` becomes `translate(0.875rem, calc(-50% + var(--dy, 0px)))`, and a `::before` on `.rl-world__town` draws the leader: `content: ''; position: absolute; left: 0.4375rem; bottom: 100%; width: 1px; height: var(--leader, 0px); background: var(--ink-dim);` (`1px` → `/* px-ok */`). The flat board (`worldmap.ts`) places pins once; run the same pass once after placement.

- [ ] **Step 4: The exit and the width**

`menu.ts:256-264`: the `nav` gets `className = 'rl-menu__nav rl-menu__nav--sticky'`; CSS: `.rl-menu__nav--sticky { position: sticky; bottom: 0; background: var(--panel-bg); padding-block: var(--s2); }` — inside the scrolling `.rl-menu` a sticky bottom nav stays on screen at 1400×900. `.rl-world__board`: `max-width: 71.25rem` → `max-width: none;` and `.rl-menu:has(.rl-world)`: `width: min(1200px, …)` → `width: min(112.5rem, calc(98vw - 2 * var(--s6) - 2px))` (1800 px at scale 1). The board fits its frustum once for the worst yaw (CLAUDE.md) so a larger canvas is a larger board, not a different one.

- [ ] **Step 5: Run, look, commit**

```bash
pnpm exec vitest run packages/app/src/ui
pnpm ui:shots -- --out=.superpowers/ui-shots/task7
```
`02-campaign.png` at all three sizes: no two town labels overlap; the back link is visible at 1400×900 without scrolling; at 2560 the board is wider than 1140 px. `worldmap3d.test.ts` must still pass unchanged (it asserts pins are placed, not where).

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:ui
/usr/bin/git add packages/app/src/ui/label-layout.ts packages/app/src/ui/label-layout.test.ts packages/app/src/ui/worldmap3d.ts packages/app/src/ui/worldmap.ts packages/app/src/ui/menu.ts packages/app/src/ui/theme.css
/usr/bin/git commit -m "fix(campaign): town labels clear each other, the exit stays on screen, the board fills a large display" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/ui/label-layout.ts packages/app/src/ui/label-layout.test.ts packages/app/src/ui/worldmap3d.ts packages/app/src/ui/worldmap.ts packages/app/src/ui/menu.ts packages/app/src/ui/theme.css
```

---

### Task 8: Dead ends — the tutorial's first sentence, an unknown mission, the debrief's way home

**Files:**
- Modify: `data/tutorial/beit_sahwan_0.json:9`, `packages/app/src/main.ts:598-604` (unknown mission), `packages/app/src/ui/debrief.ts:120-137`, `packages/app/src/ui/debrief.test.ts`

- [ ] **Step 1: Tutorial text**

`"teach": "Click a squad to select it. Drag a box to select several. The panel at the bottom of the screen reads whatever you have selected."` Run `pnpm validate:data`.

- [ ] **Step 2: Unknown mission — an error screen, not a sandbox**

`main.ts:598-604` currently warns and falls through to a sandbox on `beit_sahwan_outskirts`. Replace the warn with: build the same `.rl-boot-error` surface `main.ts:2649` uses (extract that block into `function bootError(stage: HTMLElement, title: string, body: string, home = '?'): void` if it is not one already), text `Unknown mission "<id>"` / `This link points at a mission that does not exist in this build.` / a `← main menu` link, and `return` — never boot a sim for an id that resolves to nothing. `?sandbox=` is untouched (a bare `?sandbox` still means the default map, by design).

- [ ] **Step 3: Debrief's menu link, test first**

`debrief.test.ts`: `it('offers the main menu, like the end panel does', () => { … expect([...host.querySelectorAll('.rl-endnav a')].some((a) => a.textContent === 'menu' && a.getAttribute('href') === '?')).toBe(true); })`. Implement: `debrief.ts:137` add `back('menu', '?');` after `back('campaign map', '?campaign');`.

- [ ] **Step 4: Gate and commit**

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:data
/usr/bin/git add data/tutorial/beit_sahwan_0.json packages/app/src/main.ts packages/app/src/ui/debrief.ts packages/app/src/ui/debrief.test.ts
/usr/bin/git commit -m "fix(ui): three dead ends -- the tutorial's first sentence, an unknown mission id, the debrief's way home" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- data/tutorial/beit_sahwan_0.json packages/app/src/main.ts packages/app/src/ui/debrief.ts packages/app/src/ui/debrief.test.ts
```

---

### Task 9: The map edge — a vignette and a ground skirt

**Files:**
- Create: `packages/render/src/three/vignette-pass.ts`, `packages/render/src/three/terrain/skirt.ts`, `packages/render/src/three/vignette-pass.test.ts`
- Modify: `packages/render/src/three/post-chain.ts` (`rebuild`, `setVignettePass`, the `PostChain` interface), `packages/render/src/three/debug-layers.ts:84` (`DEBUG_LAYERS`), `packages/render/src/three/ThreeRenderer.ts` (~1821-1842 chain setup, ~2062-2070 teardown, `setDebugLayerVisible` ~2254), `tools/src/golden-diff/baseline.ts` (layer checks for `quiet` and `relief`)

**Interfaces:**
- Produces: `VignettePass extends Pass` with uniforms `uStrength` (0.55), `uRadius` (0.62, fraction of the half-diagonal where darkening starts), `uSoftness` (0.45); `PostChain.setVignettePass(pass | null)` inserted AFTER `outputPass` and BEFORE `smaa` (it darkens display-referred colour, so it belongs after tone-mapping, and SMAA wants the final image); `buildSkirt(input: TerrainInput, material: GroundMaterial-compatible): THREE.Mesh` — a flat quad from `-width` to `2·width` and `-height` to `2·height` in tile space at ground level 0, drawn under the terrain (renderOrder band -1, `depthWrite: true`), with the sand albedo at 0.45 brightness and 40% saturation; debug layers `vignette` (`pass.enabled`) and `skirt` (`mesh.visible`).

- [ ] **Step 1: A test for the pass's shader constants and the chain order**

`vignette-pass.test.ts` (node environment; no WebGL needed): construct `new VignettePass()` and assert `uniforms.uStrength.value === 0.55`, and that `createPostChain`'s pass array after `setVignettePass(p)` reads `[RenderPass, OutputPass, VignettePass, SMAAPass]` by constructor name when no fog/AO pass is set — look at how `post-chain.ts`'s existing test (if any; grep `post-chain.test`) constructs a chain without a GPU, and follow it; if none exists, test the pure `orderPasses(...)` helper you extract from `rebuild()` instead.

- [ ] **Step 2: Implement the pass**

```ts
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** A radial darkening of the frame's corners, after tone-mapping. It does one
 *  job the review priced highest: the world stops ending in a hard black
 *  diagonal, because the frame's edge is already dark before the map's is. It
 *  is display-referred (after OutputPass) on purpose -- a vignette in linear
 *  light before ACES changes the tone curve at the corners. */
export class VignettePass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.55 },
    uRadius: { value: 0.62 },
    uSoftness: { value: 0.45 },
  };
  private readonly quad: FullScreenQuad;
  constructor() {
    super();
    this.needsSwap = true;
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uStrength, uRadius, uSoftness; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float d = length(vUv - 0.5) / 0.7071;           // 0 at centre, 1 at a corner
          float v = smoothstep(uRadius, uRadius + uSoftness, d);
          gl_FragColor = vec4(c.rgb * (1.0 - uStrength * v), c.a);
        }`,
      depthTest: false, depthWrite: false,
    }));
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) renderer.setRenderTarget(null); else renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
  }
  dispose(): void { this.quad.material.dispose(); this.quad.dispose(); }
}
```

Match `FogOfWarPass`'s `render` signature and clear handling exactly (`fog-pass.ts:176-186`), including `renderer.autoClear` handling if that pass toggles it.

- [ ] **Step 3: Chain and layer wiring**

`post-chain.ts`: `let vignettePass: Pass | null = null;` in `createPostChain`; `rebuild()` adds it after `outputPass`; `setVignettePass(pass)` with the same ownership contract as `setFogPass` (the chain never disposes it). `ThreeRenderer.ts` beside the fog/AO setup: `this.vignettePass = new VignettePass(); this.post.setVignettePass(this.vignettePass);` and in teardown `this.post?.setVignettePass(null); this.vignettePass?.dispose();`. `debug-layers.ts:84`: `[..., 'units', 'vignette', 'skirt']`; `setDebugLayerVisible` gains `case 'vignette': { const was = this.vignettePass?.enabled ?? false; if (this.vignettePass) this.vignettePass.enabled = visible; return was === visible ? 0 : 1; }` and `case 'skirt': return setObjectsVisible(visible, this.skirtMesh);`. The `units` case's comment explains why a toggle must survive the next frame's re-assertion; a pass's `enabled` and a mesh's `visible` are not re-asserted anywhere — confirm by grep before relying on it.

- [ ] **Step 4: The skirt**

`terrain/skirt.ts`: `buildSkirt(width: number, height: number, surface: SurfaceTextures)` returns a `THREE.Mesh` — a `PlaneGeometry` sized `3·width × 3·height` tiles in the ground mesh's own world units (read how `terrain/mesh.ts` maps tiles to world units and reuse its constant), centred on the map, at the ground's base level, rotated to lie flat, `renderOrder` from `render-order.ts`'s world band, material `new THREE.MeshStandardMaterial({ map: surface.sandAlbedo, color: new THREE.Color(0.45, 0.45, 0.45), roughness: 1, metalness: 0 })` with the map's `repeat` matching the ground's 4-tiles-per-repeat, `NoColorSpace` left as the ground has it, and `receiveShadow = false`. Desaturation: since the albedo is a ratio field, saturation lives in the multiplier — use a warm grey `color` (0.48, 0.45, 0.42) rather than a chroma multiplier. Add it to the scene where the ground is added, keep the handle as `this.skirtMesh`, dispose with the ground.

- [ ] **Step 5: Look before measuring**

```bash
pnpm ui:shots -- --res=1920x1080,2560x1440 --out=.superpowers/ui-shots/task9
```
`06-hud-idle.png` and `10-hud-zoom0.5.png`: no hard diagonal; the map's edge fades into a dark, desaturated ground that the vignette carries to black at the corners; the playable centre is unchanged in brightness (sample a mid-map sand pixel before/after: within 2/255). If the skirt reads as a second, obviously tiled floor, lower its `color` to 0.35 before touching the vignette's numbers. Record every number you change.

- [ ] **Step 6: The gate — measure the layer deltas, set floors at a third, then bless from CI**

Run the visual gate locally ONLY to read the toggle deltas it prints (its stored darwin baseline is stale and its diff verdict is not the point):

```bash
pnpm golden-baseline 2>&1 | tee .superpowers/ui-shots/task9/gate.log
```

Read each scenario's printed layer-toggle numbers for `vignette` and `skirt`. Add to `baseline.ts`: on `quiet` and `relief` (full-frame scenarios) a `layerChecks` entry for `vignette` with `minDiffPixels`/`minMeanAbsChannelDelta` at ONE THIRD of the measured delta, and for `skirt` the same on `relief` (the only gated framing whose viewport reaches past the map edge — confirm from the capture; if none does, `skirt` gets no check and the commit says so). `open-ground` is region-scoped to `{x:950,y:500,w:450,h:400}` of a 1400×900 frame — the bottom-right, inside the vignette's fall-off. Measure its region's mean delta with the vignette on vs off; if it exceeds the scenario's 0.02 magnitude threshold, move the region toward the centre (`x:700,y:350` keeps the same size) with the measurement in the commit, rather than widening anything.

Then push the branch and let CI's `visual` job go red on the four gated scenarios, dispatch `visual-baseline-bless.yml` with `--reason="Phase 0 Task 9: vignette + ground skirt; quiet/open-ground/relief/vehicle move by <CI numbers>"`, download `visual-baseline-bless-captures`, look at all four, and only then continue. Do NOT bless from the local darwin run.

- [ ] **Step 7: Gate and commit**

```bash
pnpm test && pnpm lint && pnpm typecheck
/usr/bin/git add packages/render/src/three/vignette-pass.ts packages/render/src/three/vignette-pass.test.ts packages/render/src/three/terrain/skirt.ts packages/render/src/three/post-chain.ts packages/render/src/three/debug-layers.ts packages/render/src/three/ThreeRenderer.ts tools/src/golden-diff/baseline.ts
/usr/bin/git commit -m "feat(render): the world no longer ends in a hard diagonal -- a vignette after tone-mapping and a ground skirt beyond the map" -m "<the measured numbers: centre-pixel delta, corner darkening, layer toggle deltas and the floors set at a third>" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/render/src/three/vignette-pass.ts packages/render/src/three/vignette-pass.test.ts packages/render/src/three/terrain/skirt.ts packages/render/src/three/post-chain.ts packages/render/src/three/debug-layers.ts packages/render/src/three/ThreeRenderer.ts tools/src/golden-diff/baseline.ts
```

---

### Task 10: The key-art plate, from the running game

**Files:**
- Create: `tools/src/perf/plate-capture.ts`, `assets/ui/menu_plate.jpg`
- Delete: `assets/ui/menu_banner.jpg`
- Modify: `packages/app/src/ui/menu.ts:52-61`, `tools/package.json` + root `package.json` (`plate:capture`)

**Interfaces:**
- Produces: `pnpm plate:capture` — boots `?sandbox=beit_sahwan_outskirts` in a 2560×1440 Playwright page with `deviceScaleFactor: 1`, hides every DOM child of `body` that is not the canvas, frames the camera on the sandbox force's `mbt_lavi` at zoom 1.6 with the sun-lit side toward the viewer (the sun is the camera's left — `lighting.ts`; put the tank on the RIGHT third of the frame so its lit flank faces in), steps the sim 40 ticks so the dust settles, freezes the frame loop (`FREEZE_FRAME_LOOP_SCRIPT`), repaints once (`REPAINT_SCRIPT`), and screenshots a `clip` of 2360×1000 (2.36:1, the banner's ratio) as JPEG quality 86 to `assets/ui/menu_plate.jpg`.

- [ ] **Step 1: Write the script**

Start from `tools/src/perf/gait-captures.ts`'s boot (`waitForFunction(__lions.renderer)`), its `frameOn` camera placement (`__lions.renderer.camera.{x,y,zoom}`) and its freeze/repaint calls (lines ~588-594 and ~957-999), and `wreck-captures.ts`'s `shot`. The dev server: reuse `tools/src/golden-diff/browser.ts`'s server start/stop (it kills the process GROUP on exit — `stopDevServer` — which is the one that works on Linux). Hide the HUD:

```ts
await page.evaluate(() => {
  for (const el of Array.from(document.body.children)) {
    if (el.tagName !== 'CANVAS') (el as HTMLElement).style.display = 'none';
  }
});
```

Find the subject: `const units = await page.evaluate(() => window.__lions.units(0))` and pick the entry whose `type === 'mbt_lavi'` (the sandbox force fields one on that map; if the map's force ever changes, fail loudly naming the types present). Frame: `camera.x = tank.x + 1.2; camera.y = tank.y; camera.zoom = 1.6` (the +1.2 tiles puts the tank right of centre). Screenshot: `page.screenshot({ path: 'assets/ui/menu_plate.jpg', type: 'jpeg', quality: 86, clip: { x: 100, y: 220, width: 2360, height: 1000 } })`.

- [ ] **Step 2: Run, look, adjust once**

```bash
pnpm plate:capture
```
Open `assets/ui/menu_plate.jpg`. It must show the lit sand, the Lavi with its shadow on the ground beside it, an infantry squad in frame, no HUD, no fog rectangle, no map edge. If the map edge or void intrudes, move the camera one tile toward the map's centre; if the tank is in fog (it should not be — its own side sees it), step more ticks. One adjustment pass, then stop: the composed key art is Phase 3's; this is the floor.

- [ ] **Step 3: Swap the asset**

`menu.ts:56-59`: `banner.src = \`${opts.base}ui/menu_plate.jpg\`; banner.width = 2360; banner.height = 1000;` (intrinsic size hints; the CSS keeps `width: 100%; height: auto`). `/usr/bin/git rm assets/ui/menu_banner.jpg`. Grep for `menu_banner` across the tree (README, docs, tests) and update every reference.

- [ ] **Step 4: Gate, look, commit**

```bash
pnpm ui:shots -- --res=1400x900,2560x1440 --out=.superpowers/ui-shots/task10
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:assets
/usr/bin/git add tools/src/perf/plate-capture.ts assets/ui/menu_plate.jpg packages/app/src/ui/menu.ts tools/package.json package.json
/usr/bin/git commit -m "feat(menu): the key art is a plate from the running game, not a generated painting" -m "assets/ui/menu_banner.jpg carried a generator watermark, a real M1 Abrams marked 41 and pseudo-Arabic signage. The plate is captured by pnpm plate:capture from beit_sahwan_outskirts through the mission's own camera, sun and tone-mapping, so it is re-taken whenever the world improves. The source is the committed GLBs and the script; no .blend is involved. Meshy-generated meshes are disclosed in CONTRIBUTING.md." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- tools/src/perf/plate-capture.ts assets/ui/menu_plate.jpg packages/app/src/ui/menu.ts tools/package.json package.json
```

`validate:assets` is in the gate because it sweeps `assets/`; a JPEG under `assets/ui/` must not be mistaken for a sprite sheet — if the sweep complains, exclude `assets/ui/*.jpg` by the same rule that already exempts the old banner (grep the validator for `menu_banner` or `ui/`).

---

## Acceptance for the phase (run last, from the branch tip)

```bash
pnpm ui:shots -- --out=.superpowers/ui-shots/after
grep -rn "enemy reacts\|requires clearing\|MAP_ID\|menu_banner" packages/ tools/src assets/ui && echo FAIL || echo ok
pnpm validate:ui && pnpm validate:data && pnpm test && pnpm lint && pnpm typecheck && pnpm test:determinism
```

Then, against `.superpowers/ui-shots/before`, by eye and by number, per the spec's Phase 0 acceptance: no raw id anywhere; no unpanelled text (every over-world string on a plate, ≥ 4.5:1 sampled); the 2560 menu column ≥ 28% of the frame; a plate with no watermark; a map edge with no hard diagonal at zoom 0.5 and 1; the feed above the cluster and the card fully on screen at 1400×900; DEPLOY in the display face; no colliding town labels; the back link on screen. Record the numbers in the ledger's completion entry. One bless, from CI, in Task 9 — and none other.

## Not in this plan (the spec says where)

Settings and `--ui-scale` exposure (Phase 1); the router (Phase 1); alerts, objectives, minimap, groups (Phase 2); the in-engine scene host, the board's biome, portraits, the symbol family, the armoury, deploy-as-a-decision, victory/defeat moments (Phase 3); controller and Deck (Phase 4). The distance fade (spec §6 Phase 0 item b) is decided by Task 9's capture and, if needed, is its own follow-up commit with its own measurement.
