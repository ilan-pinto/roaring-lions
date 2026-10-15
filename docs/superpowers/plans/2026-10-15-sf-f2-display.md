# S-F: F2's display — held ground, the purse and the supply lines (Lane A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: written 15 Oct, NOT to be built until F2's sim half lands on `main`** (Lane C,
`feat/gf2-held-ground`, plan `docs/superpowers/plans/2026-10-04-gf2-held-ground-income.md`; at the time
of writing it stands at Task 4 of 10). Every runtime name below marked **(verify at F2 merge)** is the
F2 plan's own name, not yet on any branch; the first step of Task 1 is to re-read them on `main` and
correct this plan in place before any code is written.

**Goal:** The player sees which ground pays, what the purse earns a minute and why it is halved, and
where a supply line runs and where it is cut — the lead's approved design (15 Oct): **Z-B** for held
zones, **C3** for the corridor (on demand in the world; the cut stretch dashed `--warn`; always on the
minimap), and the **`½` suffix in `--warn`** on the strip's rate.

**Architecture:** One pure read model (`ui/income-view.ts`) turns the runtime's F2 surface into
presentation data once per HUD beat; every surface (world zone look, minimap, strip, tip, alerts,
the world route) reads that model, never the runtime and never a re-derived game rule (CLAUDE.md:
no second copy of a rule in `app`). The world route is a renderer seam member written like
`aimFootprint`, drawn as a ground-draped ribbon in its own render-order band.

**Tech Stack:** TypeScript, vitest + jsdom, three.js (`packages/render/src/three/`), `theme.css` tokens,
`t()`/`en.json`.

**Spec:** the F2 plan's "For the lead" P2-1 … P2-10 and "Lane A needs (WP-S-F #184)"; the approved mock
`/Users/ilpinto/dev/roaring-lions-ep/_coord/f2-shell-mock/` (`proposal.md` — "Status" and "What the
implementation would need"; `questions.md`; `sheet.png`); the F2 controller's ledger
`/Users/ilpinto/dev/roaring-lions-ep/_coord/s4-f2-progress.md` (C-R1: F2 ships **no** mission with a zone;
C-R10: the two new event kinds arrive with `silent` cue rows that this plan flips).

## The F2 runtime surface this plan consumes (verify at F2 merge)

| what | F2 plan name | status on 15 Oct |
|---|---|---|
| who holds a zone | `Holder = 0 \| 1 \| -1`, `zoneHolder(view, rect)` (`packages/sim/src/income.ts`) | **landed** on `feat/gf2-held-ground` (662a08af). `-1` means empty OR contested |
| per-zone state | `interface ZoneIncome { zone; rect; ratePerMin; holder; cut: CutCause; route: Int32Array \| null }` | Task 7, **private** in the plan |
| why a line is cut | `type CutCause = 'unreachable' \| 'interdicted' \| 'vent' \| null` (`corridor.ts`) | Task 6 |
| the rate | `get incomePerMin(): { base: number; zones: number; halvedBy: CutCause \| null }` | Task 7 |
| events | `{ kind: 'zoneHolder'; tick; zone; holder: Holder }`, `{ kind: 'corridor'; tick; zone: string \| null; cut: CutCause }` (`zone` null = the convoy) | Task 7, with `silent` rows in `ui/cues.ts` (C-R10) |
| the purse | `logistics` (side 0, floored) and `logisticsOf(side)` | **landed** (Task 1, df48a80c) |
| zones on the map | `income_zones` in the mission JSON, `supply_entry` marker | schema landed (Task 3); **no shipped mission authors a zone** (C-R1) |

**Four asks of Lane C** (raise on the F2 PR before it merges; each has a fallback so this plan does not
block on it):

- **A1. Contested vs empty.** `Holder -1` conflates them, and P2-1 draws them differently (`contested`
  vs `unheld`). Ask: a public per-zone state `'held0' | 'held1' | 'contested' | 'empty'` (or a
  `contested: boolean` beside `holder`). *Fallback:* none in `app` — re-deriving D3 from unit positions
  is a second copy of a game rule. Without A1, `-1` draws `unheld` and the `contested` state and its
  alert are dropped from Tasks 2 and 4 (record it).
- **A2. A public read of the zones and routes.** `ZoneIncome[]` is private in the plan. Ask:
  `get incomeZones(): readonly Readonly<ZoneIncome>[]` and `get convoyRoute(): { route: Int32Array |
  null; cut: CutCause } | null` (side 0's view; read-only; nothing hashed). *Fallback:* the minimap and
  world routes cannot be drawn; Tasks 3 and 6 ship without routes and say so.
- **A3. Where a line is cut.** C3 dashes only the cut STRETCH and P2-4's alert jumps to "the first cut
  tile"; `corridorCut` returns a cause only. Ask: per route, the route indices that are cut
  (`cutSpan: readonly [first, last] | null`, indices into `route`). *Fallback:* the whole route dashes
  `--warn` (the mock's C1 look) and the jump goes to the route's midpoint.
- **A4. The rate's parts.** The tip's breakdown (Z-B) wants base, each zone's contribution and the
  halving per zone. `incomePerMin` has the totals only; `incomeZones[].ratePerMin` + `holder` + `cut`
  give the parts if A2 lands. *Fallback:* the tip shows the totals and the one `halvedBy` cause.

## Global Constraints

- App and render only; never `packages/sim`, never `data/missions`. Determinism pins, `balance` and
  `playtest` unchanged.
- Reuse the vocabulary: zone states through #461's four (`held` `--live` solid, `unheld` `--warn`
  dashed, `contested` `--bad` dashed, never `target` for income); logistics is `--info` (#454); a cut
  is `--warn`, **never `--bad`** (P2-3, P2-8). No new colour token; minimap colours through `CHROME`.
- **Z-B:** the WORLD look of an income zone is the existing objective-zone outline + ground band, no
  new world mark; what a zone pays is said by the minimap mark's logistics glyph (corner) and the
  logistics tip's breakdown. An income zone that is also an active objective's zone is drawn once, by
  its objective (P2-1).
- **C3:** the world route draws only while the strip's logistics figure is hovered or focused, or for
  `ROUTE_JUMP_SHOW_MS` (4000) after a Space jump lands on a supply alert; the open route is a thin
  `--info` line, only the cut stretch dashed `--warn`; the minimap always draws every route. The world
  route sits in its own render band **0.2** (`SUPPLY_ROUTE_RENDER_ORDER`, between `ZONE_BAND` 0 and the
  tunnel x-ray 0.25 / selection ring 0.5), depth-tested, not depth-writing; **never** band 4.
- **Purse:** the strip's `+N/min` reads `incomePerMin.base + incomePerMin.zones`; when anything is
  halved it adds a `½` suffix in `.rl-warn`; the cause lives in the logistics tip, not on the strip.
- Alerts (P2-4): gained `minor`/`good`; contested `minor`/`warn`; lost `important`/`warn`; supply cut
  `important`/`warn` (Space jumps to the first cut tile); supply open `minor`/`good`. Place-only wording
  (P2-7: no zone names). Merged by the feed's 8 s rule. Cues per P2-5: flip the two `silent` rows to
  `ALERT_CUE.minor`/`important` in the same commit as the alert. No announcer line.
- First-use hint `income` (P2-6): `hud.hint.first.income` = "zones you hold alone pay on top; an enemy
  inside pays nobody", predicate `income_zones`.
- Strings through `t()`; label tables as accessor functions; checked under `?pseudo=1`; `pnpm validate:ui`
  passes; chrome/type register tests updated for new classes.
- Every new check is seen red by a one-line mutation.

## Review Focus

1. **A mission with no `income_zones` and no `supply_corridor`** (every shipped mission today): no
   minimap glyph, no route, no `½`, strip and tip byte-identical to before, no alert, no hint.
2. **A zone flickering at its edge** (holder 0 ↔ -1 every few ticks): one merged feed line, one cue a
   tick, the minimap state follows without a pulse storm.
3. **A route through a building that collapses** (the runtime recomputes it): the minimap/world line
   follows the new route on the next HUD beat; no stale geometry is kept.
4. **The logistics figure focused by keyboard** shows the world route exactly as hover does, and
   blurring it hides it; a dialog open hides it.
5. **Reduced motion / colour-vision variants:** dashed vs solid carries the cut without colour; nothing
   in the route animates.

---

### Task 1: re-verify the F2 surface, then the read model

**Files:** this plan (corrections in place); create `packages/app/src/ui/income-view.ts`
(+ `income-view.test.ts`).

```ts
// income-view.ts (names on the runtime side are verify-at-F2-merge)
export type IncomeZoneState = 'held' | 'unheld' | 'contested';
export interface IncomeZoneView {
  id: string;                                   // the zone's key in income_zones
  rect: readonly [number, number, number, number];
  ratePerMin: number;                           // as authored
  paysPerMin: number;                           // 0 unless side 0 holds it; halved when cut
  state: IncomeZoneState;                       // P2-1 mapping (A1)
  cut: CutCause;
  route: ArrayLike<number> | null;              // tile indices
  cutSpan: readonly [number, number] | null;    // A3, else null
}
export interface IncomeView {
  base: number; zones: number; total: number;   // per minute
  halved: boolean; halvedBy: CutCause | null;
  zoneViews: readonly IncomeZoneView[];
  convoy: { route: ArrayLike<number> | null; cut: CutCause; cutSpan: readonly [number, number] | null } | null;
}
/** Null when the mission has neither income zones nor a supply corridor (Review Focus 1). */
export function incomeViewOf(rt: IncomeRuntime): IncomeView | null;
```

- [ ] **Step 0: Re-verify on `main`.** Read F2's merged `mission.ts`/`income.ts`/`corridor.ts` and its
  PR. Replace every "(verify at F2 merge)" name in this plan with the real one; record which of A1–A4
  landed and strike the fallbacks that no longer apply. Commit the corrected plan alone.
- [ ] **Step 1: failing tests** with a literal fake runtime: no zones and no corridor → null; a held,
  uncut zone pays its rate; a cut held zone pays half and `halved` is true with its cause; a side-1-held
  zone pays 0 and reads `unheld`; contested reads `contested` (only with A1); totals equal the runtime's
  `incomePerMin` (no recomputation: the view copies, it does not derive).
- [ ] **Steps 2–6:** run red, implement, gates (`pnpm lint && pnpm typecheck && pnpm test`), see red by a
  mutation, commit `app: the F2 income read model (S-F)`.

### Task 2: held zones in the world and on the minimap (Z-B)

**Files:** `packages/app/src/objective-zones.ts` (`incomeZonesFor` beside `objectiveZonesFor`),
`packages/app/src/ui/minimap.ts` (`incomeMarks` beside `objectiveMarks`, an `ObjectiveMark.glyph` flag
drawing the `logistics` symbol in the mark's corner — the mock found the centre hidden under the
holders' unit dots), `packages/app/src/main.ts` (concatenate onto `renderer.objectiveZones` at the same
5-tick write; feed the minimap), tests.

- `incomeZonesFor(view: IncomeView, activeObjectiveZones: ReadonlySet<string>): ObjectiveZoneView[]`
  → id `income:<zone>`, state per P2-1, skipping a zone an active objective already draws.
- [ ] Tests: the four state mappings; the objective-dedupe; the minimap mark carries the glyph flag and
  the `zoneMarkStyle` of its state; no income zones → no marks (Review Focus 1). Steps as Task 1; commit
  `app: held ground on the map and the minimap (F2 Z-B, S-F)`.

### Task 3: supply routes on the minimap (always on)

**Files:** `packages/app/src/ui/minimap.ts` (route polylines from tile indices, `CHROME.route:
'var(--info)'` and `CHROME.routeCut: 'var(--warn)'`, constants beside `ZONE_STROKE`), tests.

- Open stretch solid `route`; the cut stretch (A3's `cutSpan`, else the whole route) dashed `routeCut`.
  Routes redraw from the read model each beat (Review Focus 3). Without A2, this task ships empty and
  says so in its commit.
- [ ] Tests: an open route draws one solid path through the tile centres; a cut span draws dashed only
  over its indices; a recomputed route replaces the old one; no route → nothing. Commit
  `app: supply routes on the minimap (F2 C3, S-F)`.

### Task 4: the purse readout and the logistics tip

**Files:** `packages/app/src/ui/hud-model.ts` (`income?: IncomeView` replaces `logisticsRate` for the
rate; keep `logisticsRate` as the fallback when `income` is null), `packages/app/src/ui/hud.ts`
(`renderStrip` ~L1605; `stripTipHtml('logistics')`), `packages/app/src/main.ts` (~L2722),
`packages/app/src/i18n/en.json`, tests.

Strings: `hud.strip.rate.halved` = `½` (wrapped in `.rl-warn`); `hud.strip.logistics.convoy` = `Convoy
{n}/min`; `.held` = `Held ground +{n}/min`; `.cut.interdicted` = `supply line cut: enemy on the road`;
`.cut.vent` = `supply line cut: a tunnel vent beside the road`; `.cut.unreachable` = `supply line cut: no
road through`; `.contested` = `pays nothing: enemy inside` (P2-2).

- [ ] Tests: no income → the strip and tip are byte-identical to today (Review Focus 1); total = base +
  zones; halved adds the `½` `.rl-warn` suffix and the tip names the cause; a contested zone's line
  reads "pays nothing: enemy inside"; under `?pseudo=1` no unbracketed word. Commit
  `app: the purse readout and its tip read held-ground income (F2 P2-8, S-F)`.

### Task 5: the alerts and their cues

**Files:** `packages/app/src/ui/alerts.ts` (`Alert.kind` gains `zone` and `supply`; `AlertWorld.zoneAt(zone)`
and a route-tile place), `packages/app/src/ui/alert-world.ts`, `packages/app/src/ui/cues.ts` (flip the
two rows from `silent` to `ALERT_CUE.minor`/`important` — P2-5), `packages/app/src/i18n/en.json`
(`alert.zone.gained/contested/lost`, `alert.supply.cut/open`, in the `alert.*` shape
`<b>…</b> — …{where, select, yes { · {place}} other {}}`), tests (`alerts.test.ts`, `cues.test.ts`).

- Tiers/tones per Global Constraints; the cut alert's `at` is the first cut tile (A3) or the route
  midpoint; Space jumps there and, for `ROUTE_JUMP_SHOW_MS`, shows the world route (Task 6).
- [ ] Tests: one alert per event with its tier/tone/place; a flicker (gained, lost, gained inside 8 s)
  merges per the feed rule and raises at most one cue a tick (Review Focus 2); the `zone: null` corridor
  event words the convoy; the cue rows are no longer silent and `cues.test.ts` still requires a reason
  wherever one remains. Commit `app: held-ground and supply-line alerts (F2 P2-4/P2-5, S-F)`.

### Task 6: the world supply route on demand (C3)

**Files:** `packages/render/src/api.ts` (`supplyRoutes?: readonly SupplyRouteView[] | null`, documented
like `aimFootprint`), create `packages/render/src/three/supply-route.ts` (ribbon builder; pure geometry
in a three-free `supply-route-maths.ts` + test), `packages/render/src/three/units/render-order.ts`
(`SUPPLY_ROUTE_RENDER_ORDER = 0.2`, with its table row), `packages/render/src/three/debug-layers.ts`
(`supply-route`), `packages/render/src/three/ThreeRenderer.ts` (build/update/dispose), `packages/app/src/main.ts`
(write `renderer.supplyRoutes` only while the logistics figure is hovered/focused or within
`ROUTE_JUMP_SHOW_MS` of a supply-alert jump; null otherwise and on teardown), tests.

```ts
export interface SupplyRouteView {
  readonly tiles: ArrayLike<number>;                 // tile indices, in order
  readonly cutSpan: readonly [number, number] | null; // indices into tiles
}
```

- Ribbon: a strip of quads along the tile-centre polyline, smoothed only by the road's own centreline
  if F2 exposes one (else tile centres — the mock found the road drawn with curves; record it), sampled
  on `groundWorldY` per vertex, lifted by the decal lift cap, colours via `overlayColor` from palette
  keys (open `water.0`/`--info`'s key, cut `--warn`'s key), the cut span dashed by a per-vertex
  distance attribute; depth-tested, `depthWrite: false`, band 0.2; one draw call per route set.
- [ ] Tests (render, the vfx-triggers harness style): null → no mesh; a route → one mesh at band 0.2 with
  `depthWrite` false; a cut span marks only its vertices dashed; replacing the routes disposes the old
  geometry; the debug layer hides it; `render-order.test` (or the table pin) holds 0.2 between 0 and
  0.25. App test: the logistics figure's hover/focus sets `supplyRoutes`, blur clears it, an open dialog
  clears it (Review Focus 4). Commit `render, app: the supply route on demand in the world (F2 C3, S-F)`.

### Task 7: teaching it, and the UI proof hooks

**Files:** `data/hints/first_use.json` (rule `income`, predicate `income_zones`),
`packages/app/src/ui/hint-rules.ts` (the predicate: the mission has `income_zones`),
`packages/app/src/i18n/en.json` (`hud.hint.first.income`), tests (`hint-rules.test.ts`); `pnpm
validate:data`.

- [ ] Tests: the hint fires once on a mission with zones, never on one without. Commit
  `app: a first-use hint for held ground (F2 P2-6, S-F)`.

## Controller close-out

1. Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:ui && pnpm validate:data && pnpm
   build && pnpm test:determinism`; balance/playtest identical.
2. Golden: zones and routes appear only on a mission with `income_zones`/`supply_corridor`; no gated
   scenario has one (all `sandbox=`), and the world route is on demand. Expect no band to move.
3. **UI proof without a shipped zone (C-R1):** one browser on a free port (not 5177), music off. Boot
   `umm_zeitoun_4_clearance` (supply corridor) with Playwright intercepting the dev server's module
   request for that mission's JSON (`page.route` on `**/data/missions/umm_zeitoun_4_clearance.json*`,
   the gait-captures technique) to add one `income_zones` entry (the mock's hamlet stand-in), no file on
   disk changed. Drive: hold the zone, contest it, cut its road with an enemy; read back the minimap
   state, the strip rate and `½`, the tip lines, the feed lines and `renderer.supplyRoutes` on hover;
   capture at 1400x900 and 1920x1080. Stop the server by process group.
4. Ready PR against `main`.

## Self-review notes (15 Oct)

- Spec coverage: P2-1 (Task 2), P2-2 (Task 4 tip), P2-3 + C3 (Tasks 3, 6), P2-4 (Task 5), P2-5 (Task 5),
  P2-6 (Task 7), P2-7 (Task 5 wording), P2-8 (Task 4), P2-9/P2-10 (Lane C's; P2-10's memory note: the
  ribbon adds no GLB). Lane A row "Zone holders on the minimap" (Task 2), "Income readout" (Task 4),
  "Alerts" (Task 5), "Strings through t()" (Global Constraints).
- Every runtime name is the F2 plan's and marked; Task 1 Step 0 corrects them before code.
