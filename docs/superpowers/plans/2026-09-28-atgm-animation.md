# The Anti-Tank Missile (GH-250, Lane B): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ATGM reads as a missile. It launches with an ignition flash, a backblast and ground dust. It flies as a small body with a bright motor glow and a thin trail that lingers and drifts. Its path is guided, and the Spike flies top-attack. It lands in a HEAT flash with spall. The lead judges it on a ten-second capture, never a still.

**Architecture:**
- **Pure model code with its own `*.test.ts`**, under one thin controller and the smallest possible renderer touch:
  - `three/units/missiles.ts` (pure) covers variants, profiles, the sim-synced flight time, the path, guidance, the miss point, stepping, landing and intercept.
  - `three/units/missile-trail.ts` (pure) covers the trail-puff ring, emission by distance, drift and fade, the glow flicker, the look read from JSON, and the sprite and body writers.
  - `three/units/missile-fx.ts` holds `MissileFx`, the one controller. It owns the models, the pool and three meshes: body, soft sprites and hot cores.
- **Launch and impact are data:** `fire_missile.json` (reauthored), plus the new `missile_trail.json` and `missile_impact.json`.
- **`ThreeRenderer.ts` changes in exactly one task (Task 6):**
  - one field;
  - the `onFire` branch;
  - one call each in `updateFx`, `aps`, `useEmitters`, `dispose` and the scene add;
  - a `missiles` debug case;
  - the new `spawnMissileImpactFx`.
- The sim is not touched.

**Tech Stack:** TypeScript strict, vitest (node environment; `three` constructs without a GPU, as `ThreeRenderer.*.test.ts` already relies on), Playwright (tools only). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-28-atgm-animation-design.md`. It is binding. **Its numbers table (N1–N18) must be approved by the lead before Task 1's after-half, and before Tasks 2–7 run.** Task 0 records the approval, and any number the lead changes, in the ledger. A changed number is edited in exactly the place this plan puts it: `MISSILE_PROFILES` and the constants in Task 2, `missile-trail.ts` in Task 3, the JSON in Task 4.

**Status and entry:** branch `feat/atgm-animation`, worktree `/Users/ilpinto/dev/roaring-lions-ep/atgm`, cut from `origin/main@9e9b0640`. Every line citation below was taken at that commit.

## Global Constraints

- **Files.** Write only these paths, each confined to its task:
  - `packages/render/src/three/units/{missiles,missile-trail,missile-fx}.ts` and their tests (Tasks 2, 3, 5)
  - `packages/render/src/three/units/{shells,fx}.ts` and their tests (Tasks 5, 6)
  - `packages/render/src/vfx/particles.ts` (Task 3: two `export` keywords)
  - `packages/render/src/three/ThreeRenderer.ts`, `ThreeRenderer.indirect-projectile.test.ts`, the new `ThreeRenderer.missile.test.ts` and `debug-layers.ts` (Task 6 only)
  - `data/vfx/{fire_missile,missile_trail,missile_impact}.json`, `packages/data/src/index.ts`, `packages/data/src/index.test.ts` (Task 4)
  - `tools/src/perf/atgm-captures{,.test}.ts`, root `package.json`, `tools/package.json` (Tasks 1, 7)
  - `CLAUDE.md` (Task 7: the shells bullet)

  **No `packages/sim/**`, no `packages/render/src/renderer.ts` (Pixi, frozen), no `data/schemas/**`, no art.**
- **The sim is untouched (invariant 4).** `/usr/bin/git diff --stat 9e9b0640..HEAD -- packages/sim packages/render/src/renderer.ts data/schemas` is EMPTY at every commit.
  - The renderer reads `fire` and `aps` events and its own `curX`/`curY`/`sim.state.alive`, and writes nothing back.
  - The sim's `PROJ_SPEED` is COPIED, and a test parses `tuning.ts` as text. It is never exported for this.
  - Every presentation choice (the miss offset, the flicker phase) is `hash01(tick, shooter)`, never `Math.random`, so a capture is repeatable.
- **Frame clock only.** Every age is `frameDtSeconds(dtMs)`, and a missile lands when `t + dt >= duration` (the `shellHasLanded` rule). No sim `impact` event triggers the HEAT flash (spec D1/D7).
- **Three only.** No Pixi code. A Pixi session keeps whatever its own `fire` path draws.
- **Render order.** No new band. `units/render-order.ts` is the single source.
  - Body and soft sprites: `FX_RENDER_ORDER` (2).
  - Cores: `FX_RENDER_ORDER_ADDITIVE` (2.5).
  - All three meshes set `depthTest: true` and `depthWrite: false`.
- **Palette keys only** in JSON (`vfx.*`, `limestone.*`, `dust.*`, `gunmetal.*`).
  - The body colour is the TS constant key `MISSILE_BODY_COLOR_KEY = 'gunmetal.1'`, resolved through the same `resolve` `useEmitters` receives.
  - `hotCore` stays the opaque on-palette overwrite (`fx.ts`, `createParticleMaterial`). There is no GPU additive blending.
- **Budget.** The three meshes use `visible = count > 0 && !debugHidden`, so an idle scene costs +0 draw calls and flight costs +3.
  - Capacities: `MISSILE_CAPACITY = 64`, `TRAIL_CAPACITY = 768`.
  - The writers allocate nothing per frame: preallocated typed arrays, and missiles stepped in place.
- **Tests.** Pure specs run in the node environment. There is no `any` and no non-null assertion, tests included: narrow the value, or throw a named error in a fixture helper.
- **Every check has an input that makes it fail, and that input has been run.** Each task's last step names its mutations. Apply each one, see it go red, and undo it **by reverting the edit** (never `git checkout -- <file>`). The commit body says what was seen red.
- **Ports: 5197 and 5198 only**, always with an explicit `--port`.
  - A server you started is stopped by its own PID (`stopDevServer` kills the process group).
  - `ensureDevServer` REUSES a server already on the port and will not kill it. Check `lsof -i :5197` first; if something else is there, use 5198.
  - **Never `pkill`, never kill a process you did not start.**
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data`, plus whatever the task names. Then check the invariant diff above.
- **Git hygiene.**
  - Call `/usr/bin/git` by absolute path, one command per call.
  - Stage with `/usr/bin/git add <paths>`, then commit with `/usr/bin/git commit -s -F <msgfile> -- <paths>`.
  - Never use `-A`, never `git checkout -- <file>`, never amend, never push from a task.
  - Write messages to a file in the scratchpad, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Size.** At most five authored files and about 450 changed lines per task, tests included. Task 6 is the one named exception (seven files, all of them the wiring's own).
- **Model tiers.** Sonnet by default. Opus for the capture instrument (Tasks 1 and 7) and for the one `ThreeRenderer.ts` task (Task 6), plus the final whole-branch review. Nothing inherits opus by default.

## Rulings taken while planning

- **P-1: the sim-synced duration is `max(1, n − 1)` ticks, over the renderer's own distance.** `n = ceil(dist / (speed × 0.05))` is `prTicksLeft`. `stepProjectiles` runs in the same tick as combat and decrements on the fire tick, so the round resolves `n − 1` ticks after the `fire` event. This was measured at `9e9b0640`: a 4-tile `rpg7` resolved 13 ticks after firing, and 7-tile and 6-tile Spikes 34 and 29.

  On distance: the sim measures `posX/posY` shooter to target in Q16.16. The renderer measures `curX/curY`, the last-tick snapshot `onFire` already aims from. The two agree to well under a tile, so the tick count agrees to ±1 (50 ms). Task 6's wiring test measures that agreement against a real `Sim` rather than assuming it. The path starts at the muzzle (`mzX`, `mzY`); the DURATION uses the shooter-centre distance, because that is what the sim counts.
- **P-2: `ShellKind` loses `'missile'`, and `shellKindFor` returns `ProjectileKind = ShellKind | 'missile'`.**
  - Keeping a `SHELL_PROFILES.missile` that nothing draws would be a dead profile, and a test could still pass against it.
  - Routing stays in one function, so the tracer suppression for these classes (`shellKind === null` pushes a tracer) is unchanged.
- **P-3: the glow and trail look is read from `missile_trail.json` by LAYER ROLE, not by index.**
  - The `additive: true` layer is the core.
  - The `smoke_puff` layer is the trail.
  - The remaining layer is the halo.

  `trailLookFrom` throws on an emitter with a missing role. A reordered file cannot silently swap the halo and the smoke.
- **P-4: the impact's light and shake are the emitter's authored values × `scale`.** `scale` is 1 for a hit and 0.5 for an intercept, and `impactPower` is NOT used for them. `blastLightSpec(em, power)` multiplies by power, so passing 0.25 would give a 0.65-intensity light, a quarter of N13. `impactPower` sizes the burst mesh and the particle magnitude only.
- **P-5: the `missiles` debug layer is a flag, not a `visible` write.** `MissileFx.step` rewrites `visible` every frame, which would undo a plain write on the very repaint the toggle photographs. This is the `blast-light` shape: the flag is consulted after stepping, and `REPAINT_SCRIPT`'s `frame(1, 0)` still runs `updateFx`, so it applies.
- **P-6: the harness drives the sim in lockstep without `__lions.step`.** `step(1)` ends in `renderer.frame(1, lastFrameMs)`, and `lastFrameMs` is latched by the freeze at an unknown value (the blast harness's own note). Per 50 ms of pumped time the harness calls `sim.tick()`, `renderer.snapshot()` and `renderer.onEvents(events)`, which are `main.ts`'s `runTick` renderer calls at `:3783-3785`. The remaining time is pumped as `renderer.frame(1, 16)` pieces, with an exact remainder. Mission runtime and audio are skipped: the sandbox has neither.
- **P-7: one page, subjects run one after another.** Each pair is removed with `removeFromPlay` after its window, so no hostile shooter from one subject fires into the next. The subjects stand on the open northern band (rows 0–7 of `beit_sahwan_outskirts`), per `blast-captures.ts`'s reasoning.

## File structure

| File | Responsibility | Task | Est. lines |
|---|---|---|---|
| `tools/src/perf/atgm-captures.ts` (+test), `package.json`, `tools/package.json` | the instrument: ladder, subjects, lockstep, sheet, flip, toggle | 1, 7 | 700 |
| `units/missiles.ts` (+test) | flight model | 2 | 420 |
| `units/missile-trail.ts` (+test), `vfx/particles.ts` | trail pool, emission, look, writers | 3 | 430 |
| `data/vfx/*.json` ×3, `packages/data/src/index.ts` (+test) | launch, trail look, impact | 4 | 170 |
| `units/fx.ts` (+test), `units/missile-fx.ts` (+test) | `liftedSegmentQuad`, material exports, the controller | 5 | 400 |
| `ThreeRenderer.ts`, `units/shells.ts` (+test), `units/fx.test.ts`, `ThreeRenderer.indirect-projectile.test.ts`, `ThreeRenderer.missile.test.ts`, `debug-layers.ts` | the wiring | 6 | 450 |
| `CLAUDE.md` | shells/missiles bullet | 7 | 30 |

---

### Task 0: Entry, the approval, and a baseline

The coordinator runs this task, and no model is needed.

- [ ] **Step 1:** Run `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/atgm fetch origin`. Then run `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/atgm log --oneline 9e9b0640..origin/main --` on these paths:
  - `packages/render/src/three/ThreeRenderer.ts`
  - `packages/render/src/three/units/shells.ts`
  - `packages/render/src/three/units/fx.ts`
  - `packages/render/src/three/debug-layers.ts`
  - `data/vfx`
  - `packages/data/src/index.ts`
  - `tools/src/perf/blast-captures.ts`
  - `tools/src/golden-diff`

  If anything is listed, `/usr/bin/git merge origin/main` and re-read what moved. `feat/ground-plan2` edits `ThreeRenderer.ts` and `debug-layers.ts` (spec § Overlap). If it has landed, re-take this plan's line numbers before Task 6.
- [ ] **Step 2:** Run `/usr/bin/git worktree list` and `/usr/bin/git status --short`. The tree must be clean apart from this plan's docs.
- [ ] **Step 3:** Record the lead's approval of N1–N18 and the answers to Q1–Q3 in the ledger (`.superpowers/atgm/ledger.md`, git-ignored, mirrored to the session scratchpad).
  - **Q1** default: keep the sim's speed.
  - **Q2** default: keep `TOP_ATTACK_WEAPON_IDS`.
  - **Q3** default: Hellfire guided, keep the ring.

  A changed number is applied in its own task, not in a later patch.
- [ ] **Step 4: Baseline gates.** Record `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm test:determinism` with its counts, so that a later red can be attributed.

---

### Task 1: The instrument, and the before-set

**Model: opus.** The acceptance instrument. Its failure modes are the ones this project has paid for repeatedly: a throttled rAF, a latched `lastFrameMs`, a subject that never fires, and a dev server that is not ours.

**Files:**
- Create: `tools/src/perf/atgm-captures.ts`, `tools/src/perf/atgm-captures.test.ts`
- Modify: `tools/package.json` (`"atgm:capture": "tsx src/perf/atgm-captures.ts"`), `package.json` (`"atgm:capture": "pnpm --filter @lions/tools atgm:capture"`)

**Interfaces (the pure half; Task 7 reads `ATGM_LAYER_FLOORS`):**
- `ATGM_WINDOW_MS = 10_000`, `ATGM_DENSE_UNTIL_MS = 3_000`, `ATGM_DENSE_EVERY_MS = 50`, `ATGM_SPARSE_EVERY_MS = 250`
- `function atgmLadder(): number[]`: 0..3000 every 50, then 3250..10000 every 250. That is 61 + 28 = **89** rungs.
- `ATGM_LADDER_MS: readonly number[]`
- `interface AtgmSubject { id; shooter; shooterSide: 0 | 1; target; targetSide: 0 | 1; x; y; gapTiles; expectVariant: 'top_attack' | 'guided' | 'unguided'; why }`
- `ATGM_SUBJECTS: readonly AtgmSubject[]`: the four pairs of spec § Capture protocol.
- `function lockstepPlan(ms: number, tickMs: number, frameMs: number): { ticks: number; frames: number[] }`
- `function flipHtml(label: string, frames: readonly { file: string; tMs: number }[]): string`
- `function atgmSheetIndex(label: string, env: string, cells: readonly AtgmCell[]): string`
- `ATGM_LAYER_FLOORS: Record<'missiles', { minDiffPixels: number; minMeanAbsChannelDelta: number; measured: string }>`. It is `{ missiles: { minDiffPixels: 0, minMeanAbsChannelDelta: 0, measured: 'not yet measured (Task 7)' } }` until Task 7.

- [ ] **Step 1: Write the failing tests.** Create `tools/src/perf/atgm-captures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATGM_LADDER_MS,
  ATGM_SUBJECTS,
  ATGM_WINDOW_MS,
  atgmLadder,
  atgmSheetIndex,
  flipHtml,
  lockstepPlan,
} from './atgm-captures';

const UNITS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/units');

function shippedUnitIds(): Set<string> {
  const ids = new Set<string>();
  for (const dir of ['kdf', 'enemy']) {
    for (const f of readdirSync(path.join(UNITS, dir))) {
      if (!f.endsWith('.json')) continue;
      const u = JSON.parse(readFileSync(path.join(UNITS, dir, f), 'utf8')) as { id: string };
      ids.add(u.id);
    }
  }
  return ids;
}

describe('the ATGM ladder', () => {
  it('is dense through the flight and sparse through the aftermath: 89 rungs over ten seconds', () => {
    expect(ATGM_LADDER_MS).toEqual(atgmLadder());
    expect(ATGM_LADDER_MS).toHaveLength(89);
    expect(ATGM_LADDER_MS[0]).toBe(0);
    expect(ATGM_LADDER_MS[60]).toBe(3000);
    expect(ATGM_LADDER_MS[61]).toBe(3250);
    expect(ATGM_LADDER_MS[ATGM_LADDER_MS.length - 1]).toBe(ATGM_WINDOW_MS);
  });

  it('never skips the flight: every 50 ms rung up to 3 s, so a 0.65 s RPG spans 13 of them', () => {
    const inFlight = ATGM_LADDER_MS.filter((t) => t > 0 && t <= 650);
    expect(inFlight).toHaveLength(13);
    for (let i = 1; i <= 60; i++) expect(ATGM_LADDER_MS[i] - ATGM_LADDER_MS[i - 1]).toBe(50);
  });
});

describe('the subjects', () => {
  it('covers each drawn variant exactly as spec § Capture protocol names it', () => {
    expect(ATGM_SUBJECTS.map((s) => [s.shooter, s.target, s.gapTiles, s.expectVariant])).toEqual([
      ['at_team', 'technical', 7, 'top_attack'],
      ['atgm_cell', 'jeep_shoded', 8, 'guided'],
      ['heli_peten', 'technical', 8, 'guided'],
      ['rpg_team', 'jeep_shoded', 4, 'unguided'],
    ]);
  });

  it('spawns only units that ship, on the open northern band, inside the map', () => {
    const ids = shippedUnitIds();
    for (const s of ATGM_SUBJECTS) {
      expect(ids.has(s.shooter), s.shooter).toBe(true);
      expect(ids.has(s.target), s.target).toBe(true);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(7);
      expect(s.x + s.gapTiles).toBeLessThan(48);
      expect(s.shooterSide).not.toBe(s.targetSide);
    }
  });
});

describe('lockstep', () => {
  it('ticks once per 50 ms of pumped time and pumps frames of at most 16 ms with an exact remainder', () => {
    expect(lockstepPlan(50, 50, 16)).toEqual({ ticks: 1, frames: [16, 16, 16, 2] });
    expect(lockstepPlan(250, 50, 16).ticks).toBe(5);
    const p = lockstepPlan(250, 50, 16);
    expect(p.frames.reduce((a, b) => a + b, 0)).toBe(250);
    expect(Math.max(...p.frames)).toBeLessThanOrEqual(16);
    expect(lockstepPlan(0, 50, 16)).toEqual({ ticks: 0, frames: [] });
  });
});

describe('the flip page', () => {
  it('plays every frame in order at its own timestamp, loops, and loads nothing from outside', () => {
    const html = flipHtml('after', [
      { file: 'at_team-0000.png', tMs: 0 },
      { file: 'at_team-0050.png', tMs: 50 },
      { file: 'at_team-3250.png', tMs: 3250 },
    ]);
    const a = html.indexOf('at_team-0000.png');
    const b = html.indexOf('at_team-0050.png');
    const c = html.indexOf('at_team-3250.png');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(html).toContain('[0,50,3250]');
    expect(html).toMatch(/loop/i);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('the sheet index', () => {
  it('names the capture conditions with every number', () => {
    const md = atgmSheetIndex('before', 'darwin-arm64 ANGLE/Metal 1400x900 dsf1', [
      { subject: 'at_team', tMs: 0, tick: 812, zoom: 2, inFlight: 1, file: 'at_team-0000.png' },
    ]);
    expect(md).toContain('# ATGM capture sheet -- before');
    expect(md).toContain('darwin-arm64 ANGLE/Metal 1400x900 dsf1');
    expect(md).toContain('89 rungs');
    expect(md).toContain('| at_team | 0 | 812 | 2 | 1 | `at_team-0000.png` |');
  });
});
```

- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run tools/src/perf/atgm-captures.test.ts`. The module does not exist.
- [ ] **Step 3: Implement the pure half.** Export the constants and functions exactly as named in *Interfaces*.
  - `ATGM_SUBJECTS`, west to east on rows 3–5:

    | id | shooter | side | target | side | x | y | gap |
    |---|---|---|---|---|---|---|---|
    | `spike` | `at_team` | 0 | `technical` | 1 | 4 | 3 | 7 |
    | `kornet` | `atgm_cell` | 1 | `jeep_shoded` | 0 | 4 | 4 | 8 |
    | `hellfire` | `heli_peten` | 0 | `technical` | 1 | 4 | 5 | 8 |
    | `rpg` | `rpg_team` | 1 | `jeep_shoded` | 0 | 4 | 3 | 4 |

    Each `why` is one sentence naming what the subject alone shows.
  - `lockstepPlan` returns `ticks = Math.floor(ms / tickMs)`, and `frames` as full 16 ms pieces plus the exact remainder (none when it is 0).
  - `flipHtml` is one self-contained page:
    - `<img id="f">`;
    - a `const T=[...]` timestamp array and a `const F=[...]` file array;
    - a `setTimeout` chain waiting `T[i+1]-T[i]` (divided by the chosen speed);
    - a speed `<select>` for 1×, 0.5× and 0.25×;
    - a pause button;
    - a `loop` back to 0 after a one-second hold.

    It uses no external script and no URL.
- [ ] **Step 4: Implement the browser half**, retargeting `blast-captures.ts`'s `main()`. Reuse, by import, `ensureDevServer`/`stopDevServer`/`readUnmaskedRenderer` (`../golden-diff/browser`), `FREEZE_FRAME_LOOP_SCRIPT`/`REPAINT_SCRIPT`/`layerToggleScript` (`../golden-diff/capture-protocol`) and `computeDiff` (`../golden-diff/diff`). Do not copy them. The sequence:
  1. `--label=before|after` is required. `--port` is required, and refuses 5173 and any port outside {5197, 5198}. `--only=<id,...>` is optional.
  2. Start the server with `ensureDevServer(port, REPO_ROOT, 'atgm-captures')`. If it prints "reusing", abort with exit 2 and the message `port <p> is not ours -- pick the other of 5197/5198`. A reused server is someone else's.
  3. Open one page at `?sandbox=beit_sahwan_outskirts&renderer=three` (explicit renderer: `renderer-choice.ts` persists per origin). Settle at 320×200 exactly as `blast-captures.ts` does (its `settleScript`), then put 1400×900 back and `FREEZE_FRAME_LOOP_SCRIPT`. Record `readUnmaskedRenderer` and the viewport in `env`.
  4. Per subject:
     - resolve type indices by id;
     - `sim.spawn` the shooter at `(x, y)` and the target at `(x + gap, y)` (`FIXED = 65536`);
     - centre the camera on the midpoint at zoom 2.0.
  5. Tick (the P-6 triple, no frames) until the events hold a `fire` with `shooter === theShooter`, capped at 1200 ticks. On timeout, note it and skip the subject. Never fabricate a rung.
  6. Rung 0 is the frame the `fire` event was handed over. For each later rung, run `lockstepPlan(rung - previous, 50, 16)`: `ticks` P-6 triples, each `frames` entry `renderer.frame(1, f)`. Screenshot a 600 × 400 clip centred on the pair's midpoint (`worldToScreen`, lifted 40 px), named `<id>-<tMs padded to 5>.png`. Record `tick` and `inFlight`:
     - `renderer.missileFx?.missiles.length`;
     - on the BEFORE set, where `missileFx` does not exist, the count of `renderer.bolts` instead.
  7. At rung 600, run the toggle A/B for `missiles` (the `blast-captures.ts` `runToggles` shape). The before-set has no such layer: `layerToggleScript` throws in the page. Catch it, record `available: false` with the note `layer not in this build`, and continue.
  8. `sim.removeFromPlay` both bodies, then 20 P-6 triples so nothing lingers into the next subject.
  9. After the per-subject loop, capture one zoom-1.0 establishing still of the first pair, at its rung 600.
  10. Write `sheet.md` (`atgmSheetIndex`), `sheet.json` (the same cells plus env, port and toggle readings) and `flip-<id>.html` per subject (`flipHtml`) into `.superpowers/art-captures/atgm/<label>/`.
  11. `stopDevServer`, then `process.exit(process.exitCode ?? 0)` under an `invokedDirectly` guard (copy `blast-captures.ts`'s, so the spec imports the module without booting a browser).
- [ ] **Step 5: Take the BEFORE set at the branch base,** before any renderer code moves: `lsof -i :5197`, then `pnpm atgm:capture -- --label=before --port=5197`. Read `sheet.md`. Every subject must have fired. Put the frame count, the first `fire` tick per subject, and the number of rungs with `inFlight >= 1` into the ledger. Expected: the RPG about 16 rungs and the Kornet about 32, since today's missile flies at 5 tiles/s. The after-set reads 13 and 31: the sim's own n − 1 ticks.
- [ ] **Step 6: Gates, falsify, commit.** Run the gates line. Each mutation must be seen red, then undone:
  - (a) `ATGM_DENSE_EVERY_MS = 100`: the ladder tests go red.
  - (b) Rename a subject's target to `technical_v2`: the "only units that ship" test goes red.
  - (c) Make `lockstepPlan` drop the remainder: the sum test goes red.
  - (d) Put `<script src="x.js">` into `flipHtml`: the flip test goes red.

  Commit the four paths with the message `feat(tools): an ATGM motion instrument and its before-set (GH-250 T1)`. The body quotes the before-set's frame counts and `env` line.

---

### Task 2: The flight model

**Model: sonnet.** A pure module whose every number is in the approved table.

**Files:**
- Create: `packages/render/src/three/units/missiles.ts`, `packages/render/src/three/units/missiles.test.ts`

**Interfaces (Tasks 3, 5 and 6 consume these):**

```ts
export type MissileVariant = 'top_attack' | 'guided' | 'unguided' | 'warhead';
export type MissileClass = 'atgm' | 'rpg' | 'heat';
export interface MissileProfile {
  shape: 'parabola' | 'climb_dive';
  apexPxPerTile: number; apexMinPx: number; apexMaxPx: number;
  apexU: number;            // where the apex sits, 0..1 (climb_dive only; parabola is 0.5)
  weaveTiles: number; weaveCycles: number;
  ignitionTiles: number;    // no body glow or trail before this much ground distance
  tracks: boolean;          // follows the live target
  drawn: boolean;           // false: nothing in flight, impact only
  impactPower: number;
  trailLifeScale: number;   // x missile_trail's smoke lifetime
}
export const MISSILE_PROFILES: Record<MissileVariant, MissileProfile>;
export const TOP_ATTACK_WEAPON_IDS: ReadonlySet<string>;          // {'spike_atgm'}
export const SIM_PROJ_SPEED_TILES_S: Readonly<Record<MissileClass, number>>; // {atgm: 4, rpg: 6, heat: 10}
export const SIM_TICK_S = 0.05;
export const MISSILE_GROUND_LIFT_PX = 6;
export const MISSILE_AIR_LIFT_PX: number;                        // = AIR_LIFT_PX (14)
export const MISS_OVERSHOOT_TILES = 0.8;
export const MISS_LATERAL_TILES = 0.4;
export const INTERCEPT_SCALE = 0.5;
export const MISSILE_MAX_DURATION_S = 6;
export const MISSILE_CAPACITY = 64;
export const TOP_ATTACK_DIVE_EXPONENT = 4;  // 1 - q^4: level at the apex, steepest at the hull (N4)
export interface MissileLaunch {
  sx: number; sy: number; tx: number; ty: number; simDistTiles: number;
  side: number; cls: number; weaponId: string; target: number; willHit: boolean;
  shooterAir: boolean; targetAir: boolean; tick: number; shooter: number;
}
export interface MissileModel {
  sx: number; sy: number; tx: number; ty: number;
  side: number; variant: MissileVariant; mclass: MissileClass; target: number;
  tracking: boolean; miss: boolean;
  launchLiftPx: number; impactLiftPx: number; apexPx: number;
  duration: number; t: number; seed: number; trailTiles: number;
}
export interface TargetTrack { x: ArrayLike<number>; y: ArrayLike<number>; alive: ArrayLike<number> }
export interface MissileLanding {
  x: number; y: number; liftPx: number; headingTurns: number;
  power: number; scale: number; miss: boolean; variant: MissileVariant; side: number;
}
export function hash01(a: number, b: number): number;
export function missileClassOf(cls: number): MissileClass | null;
export function missileVariantFor(cls: number, weaponId: string): MissileVariant | null;
export function missileDurationS(cls: number, distTiles: number): number;
export function spawnMissile(l: MissileLaunch): MissileModel | null;
export function missilePointAt(m: MissileModel, u: number): { x: number; y: number; liftPx: number };
export function missileProgress(m: MissileModel): number;
export function missileHeadingTurns(m: MissileModel, u: number): number;
export function missileGroundDist(m: MissileModel): number;
export function pushMissile(list: MissileModel[], m: MissileModel, capacity?: number): void;
export function stepMissiles(list: MissileModel[], dt: number, track: TargetTrack): MissileLanding[];
export function interceptMissiles(list: MissileModel[], target: number): MissileLanding[];
```

- [ ] **Step 1: Write the failing tests.** Create `missiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPON_CLASS } from '@lions/sim';
import { AIR_LIFT_PX } from './frame-state';
import {
  INTERCEPT_SCALE,
  MISSILE_AIR_LIFT_PX,
  MISSILE_CAPACITY,
  MISSILE_GROUND_LIFT_PX,
  MISSILE_PROFILES,
  MISS_LATERAL_TILES,
  MISS_OVERSHOOT_TILES,
  SIM_PROJ_SPEED_TILES_S,
  SIM_TICK_S,
  TOP_ATTACK_WEAPON_IDS,
  hash01,
  interceptMissiles,
  missileDurationS,
  missileHeadingTurns,
  missilePointAt,
  missileVariantFor,
  pushMissile,
  spawnMissile,
  stepMissiles,
  type MissileLaunch,
  type MissileModel,
  type TargetTrack,
} from './missiles';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TUNING = path.resolve(HERE, '../../../../sim/src/tuning.ts');
const UNITS = path.resolve(HERE, '../../../../../data/units');

function launch(over: Partial<MissileLaunch> = {}): MissileLaunch {
  return {
    sx: 0, sy: 0, tx: 8, ty: 0, simDistTiles: 8, side: 0, cls: WEAPON_CLASS.atgm, weaponId: 'kornet',
    target: 1, willHit: true, shooterAir: false, targetAir: false, tick: 100, shooter: 0, ...over,
  };
}
function spawned(over: Partial<MissileLaunch> = {}): MissileModel {
  const m = spawnMissile(launch(over));
  if (m === null) throw new Error('fixture: spawnMissile refused a missile class');
  return m;
}
function track(x: number, y: number, alive = 1): TargetTrack {
  return { x: [0, x], y: [0, y], alive: [1, alive] };
}

describe('the flight time is the sim\'s own (spec D1)', () => {
  it('copies PROJ_SPEED for the three missile classes, read from tuning.ts as text', () => {
    const src = readFileSync(TUNING, 'utf8');
    const block = /export const PROJ_SPEED = new Int32Array\(\[([\s\S]*?)\]\)/.exec(src);
    if (block === null) throw new Error('PROJ_SPEED not found in tuning.ts -- the pin must be re-pointed, not deleted');
    const byName = new Map<string, number>();
    for (const m of block[1].matchAll(/(\d+),\s*\/\/\s*([a-z_]+)/g)) byName.set(m[2], Number(m[1]) / 65536);
    expect(SIM_PROJ_SPEED_TILES_S.atgm).toBe(byName.get('atgm'));
    expect(SIM_PROJ_SPEED_TILES_S.rpg).toBe(byName.get('rpg'));
    expect(SIM_PROJ_SPEED_TILES_S.heat).toBe(byName.get('heat'));
  });

  // n = ceil(dist / (speed x 0.05)) is prTicksLeft; the round resolves n - 1
  // ticks AFTER the fire tick, because stepProjectiles runs in the same tick
  // as combat (sim.ts's tick order) and decrements on the tick it was fired.
  // Measured at 9e9b0640: a 4-tile rpg7 fired at tick 17 resolved at 30 (n 14,
  // delta 13); a 7-tile Spike fired at 50 resolved at 84 (n 35, delta 34).
  it('quantises to whole 50 ms ticks, n - 1 of them, the way the sim resolves prTicksLeft', () => {
    expect(SIM_TICK_S).toBe(0.05);
    expect(missileDurationS(WEAPON_CLASS.atgm, 6)).toBeCloseTo(1.45, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 7)).toBeCloseTo(1.7, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 9)).toBeCloseTo(2.2, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 6.01)).toBeCloseTo(1.5, 9);
    expect(missileDurationS(WEAPON_CLASS.rpg, 4)).toBeCloseTo(0.65, 9);
    expect(missileDurationS(WEAPON_CLASS.rpg, 5.5)).toBeCloseTo(0.9, 9);
    expect(missileDurationS(WEAPON_CLASS.heat, 1.2)).toBeCloseTo(0.1, 9);
    // A same-tick resolution still draws for one tick: never zero.
    expect(missileDurationS(WEAPON_CLASS.atgm, 0)).toBeCloseTo(0.05, 9);
    expect(missileDurationS(WEAPON_CLASS.atgm, 1e6)).toBe(6);
  });
});

describe('missileVariantFor (spec D2)', () => {
  it('flies the Spike top-attack and every other ATGM guided', () => {
    expect(missileVariantFor(WEAPON_CLASS.atgm, 'spike_atgm')).toBe('top_attack');
    for (const id of ['kornet', 'hellfire', 'manpad']) expect(missileVariantFor(WEAPON_CLASS.atgm, id)).toBe('guided');
  });

  it('flies every rpg-class weapon unguided and every heat warhead as a warhead', () => {
    for (const id of ['rpg7', 'rpg', 'spg9']) expect(missileVariantFor(WEAPON_CLASS.rpg, id)).toBe('unguided');
    expect(missileVariantFor(WEAPON_CLASS.heat, 'warhead')).toBe('warhead');
    // A top-attack id fired from a non-atgm class is not top-attack: the set
    // names a missile, not a string.
    expect(missileVariantFor(WEAPON_CLASS.rpg, 'spike_atgm')).toBe('unguided');
  });

  it('claims no other class', () => {
    for (const name of ['apfsds', 'he', 'small_arms', 'hmg', 'autocannon', 'mortar', 'rocket', 'interceptor', 'demolition']) {
      expect(missileVariantFor(WEAPON_CLASS[name], 'x')).toBeNull();
    }
  });

  it('names only weapons that ship, so a rename cannot silently drop the Spike to guided', () => {
    const ids = new Set<string>();
    for (const dir of ['kdf', 'enemy']) {
      for (const f of readdirSync(path.join(UNITS, dir))) {
        if (!f.endsWith('.json')) continue;
        const u = JSON.parse(readFileSync(path.join(UNITS, dir, f), 'utf8')) as { weapons?: { id: string; type: string }[] };
        for (const w of u.weapons ?? []) if (w.type === 'atgm') ids.add(w.id);
      }
    }
    expect(TOP_ATTACK_WEAPON_IDS.size).toBeGreaterThan(0);
    for (const id of TOP_ATTACK_WEAPON_IDS) expect(ids.has(id), id).toBe(true);
  });
});

describe('the path', () => {
  it('starts at the tube and ends at the hull, each at its own height (N7)', () => {
    const m = spawned();
    const start = missilePointAt(m, 0);
    expect(start.x).toBeCloseTo(0, 9);
    expect(start.y).toBeCloseTo(0, 9);
    expect(start.liftPx).toBeCloseTo(MISSILE_GROUND_LIFT_PX, 9);
    const end = missilePointAt(m, 1);
    expect(end.x).toBeCloseTo(8, 9);
    expect(end.y).toBeCloseTo(0, 9);
    expect(end.liftPx).toBeCloseTo(MISSILE_GROUND_LIFT_PX, 9);
    expect(MISSILE_AIR_LIFT_PX).toBe(AIR_LIFT_PX);
    const heli = spawned({ shooterAir: true });
    expect(missilePointAt(heli, 0).liftPx).toBe(MISSILE_AIR_LIFT_PX);
    const manpad = spawned({ weaponId: 'manpad', targetAir: true });
    expect(missilePointAt(manpad, 1).liftPx).toBeCloseTo(MISSILE_AIR_LIFT_PX, 9);
  });

  it('top-attack climbs to its apex at u = 0.40 and dives steeper than it climbed (N4)', () => {
    const m = spawned({ weaponId: 'spike_atgm', tx: 7, simDistTiles: 7 });
    expect(m.variant).toBe('top_attack');
    expect(m.apexPx).toBe(42); // 7 tiles x 6 px, inside 30..60
    const h = (u: number): number => missilePointAt(m, u).liftPx - MISSILE_GROUND_LIFT_PX;
    expect(h(0.4)).toBeCloseTo(42, 9);
    for (const u of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) expect(h(u)).toBeLessThan(42);
    const climb = (h(0.1) - h(0)) / 0.1;
    const dive = (h(0.9) - h(1)) / 0.1;
    expect(dive).toBeGreaterThan(climb);
    expect(spawned({ weaponId: 'spike_atgm', tx: 2, simDistTiles: 2 }).apexPx).toBe(30);
    expect(spawned({ weaponId: 'spike_atgm', tx: 20, simDistTiles: 20 }).apexPx).toBe(60);
  });

  it('guided weaves sideways and settles onto the line by impact (N5)', () => {
    const m = spawned();
    const off = [0.1, 0.25, 0.5, 0.75].map((u) => Math.abs(missilePointAt(m, u).y));
    expect(Math.max(...off)).toBeGreaterThan(0.02);
    for (const o of off) expect(o).toBeLessThanOrEqual(MISSILE_PROFILES.guided.weaveTiles + 1e-9);
    expect(Math.abs(missilePointAt(m, 0).y)).toBeLessThan(1e-9);
    expect(Math.abs(missilePointAt(m, 1).y)).toBeLessThan(1e-9);
  });

  it('unguided flies a flat hump with no weave (N6)', () => {
    const m = spawned({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7', tx: 4, simDistTiles: 4 });
    expect(m.variant).toBe('unguided');
    expect(m.apexPx).toBe(4); // 4 tiles x 1.0, inside 2..8
    for (const u of [0.2, 0.5, 0.8]) expect(missilePointAt(m, u).y).toBe(0);
  });

  it('reports its heading along the ground, in turns', () => {
    const east = spawned({ weaponId: 'rpg7', cls: WEAPON_CLASS.rpg });
    expect(missileHeadingTurns(east, 0.5)).toBeCloseTo(0, 6);
    const south = spawned({ weaponId: 'rpg7', cls: WEAPON_CLASS.rpg, tx: 0, ty: 8 });
    expect(missileHeadingTurns(south, 0.5)).toBeCloseTo(0.25, 6);
  });
});

describe('guidance and misses', () => {
  it('a guided missile follows its live target and freezes on the last place it saw it', () => {
    const list = [spawned()];
    stepMissiles(list, 0.1, track(9, 1));
    expect(list[0].tx).toBe(9);
    expect(list[0].ty).toBe(1);
    stepMissiles(list, 0.1, track(12, 5, 0));
    expect(list[0].tx).toBe(9);
    expect(list[0].tracking).toBe(false);
  });

  it('an unguided rocket keeps its launch aim', () => {
    const list = [spawned({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7' })];
    stepMissiles(list, 0.1, track(9, 1));
    expect(list[0].tx).toBe(8);
  });

  it('a miss flies 0.8 tiles past the target, a hashed step to the side, and does not track (N17)', () => {
    const m = spawned({ willHit: false });
    expect(m.miss).toBe(true);
    expect(m.tracking).toBe(false);
    expect(m.tx).toBeCloseTo(8 + MISS_OVERSHOOT_TILES, 9);
    expect(Math.abs(m.ty)).toBeLessThanOrEqual(MISS_LATERAL_TILES);
    // Deterministic by (tick, shooter): a capture is repeatable.
    expect(spawned({ willHit: false }).ty).toBe(m.ty);
    expect(spawned({ willHit: false, tick: 101 }).ty).not.toBe(m.ty);
  });

  it('hash01 is in [0, 1) and stable', () => {
    for (let i = 0; i < 200; i++) {
      const v = hash01(i, 7 - i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash01(3, 4)).toBe(hash01(3, 4));
  });
});

describe('stepping, landing and intercept', () => {
  it('lands on the frame its sim-synced duration elapses, with its profile\'s power (N14)', () => {
    // 8 tiles at 4 tiles/s: n = 40, so 39 ticks = 1.95 s. dt = 1/64 is exact
    // in binary, so the frame count is not at the mercy of float summation.
    const list = [spawned()];
    let landed: ReturnType<typeof stepMissiles> = [];
    let frames = 0;
    while (list.length > 0 && frames < 1000) {
      landed = stepMissiles(list, 1 / 64, track(8, 0));
      frames++;
    }
    expect(frames).toBe(125);
    expect(landed).toHaveLength(1);
    expect(landed[0].x).toBeCloseTo(8, 9);
    expect(landed[0].power).toBe(MISSILE_PROFILES.guided.impactPower);
    expect(landed[0].scale).toBe(1);
    expect(landed[0].miss).toBe(false);
  });

  it('a warhead draws nothing and still lands (N3)', () => {
    const m = spawned({ cls: WEAPON_CLASS.heat, weaponId: 'warhead', tx: 1.2, simDistTiles: 1.2 });
    expect(MISSILE_PROFILES[m.variant].drawn).toBe(false);
    const list = [m];
    const out = stepMissiles(list, 0.2, track(1.2, 0));
    expect(out).toHaveLength(1);
    expect(out[0].power).toBe(0.3);
  });

  it('an APS intercept detonates the missiles aimed at that target, where they are, at half scale (spec D4)', () => {
    const list = [spawned(), spawned({ target: 2 })];
    stepMissiles(list, 0.975, { x: [0, 8, 8], y: [0, 0, 0], alive: [1, 1, 1] }); // half of 1.95 s
    const out = interceptMissiles(list, 1);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(4, 1);
    expect(out[0].scale).toBe(INTERCEPT_SCALE);
    expect(out[0].power).toBeCloseTo(MISSILE_PROFILES.guided.impactPower * INTERCEPT_SCALE, 9);
    expect(list).toHaveLength(1);
    expect(list[0].target).toBe(2);
  });

  it('holds at most MISSILE_CAPACITY, evicting the oldest', () => {
    const list: MissileModel[] = [];
    for (let i = 0; i < MISSILE_CAPACITY + 3; i++) pushMissile(list, spawned({ tick: i }));
    expect(list).toHaveLength(MISSILE_CAPACITY);
    expect(list[0].seed).toBe(spawned({ tick: 3 }).seed);
  });
});
```

- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run packages/render/src/three/units/missiles.test.ts`.
- [ ] **Step 3: Implement.** A top comment gives the whole account: spec D1–D4, why the time is copied rather than exported, and why the path is presentation over the sim's own tick. The load-bearing code:

```ts
import { WEAPON_CLASS } from '@lions/sim';
import { AIR_LIFT_PX } from './frame-state';

export const MISSILE_PROFILES: Record<MissileVariant, MissileProfile> = {
  top_attack: { shape: 'climb_dive', apexPxPerTile: 6, apexMinPx: 30, apexMaxPx: 60, apexU: 0.4,
    weaveTiles: 0, weaveCycles: 0, ignitionTiles: 0, tracks: true, drawn: true, impactPower: 0.25, trailLifeScale: 1 },
  guided: { shape: 'parabola', apexPxPerTile: 2.2, apexMinPx: 8, apexMaxPx: 26, apexU: 0.5,
    weaveTiles: 0.12, weaveCycles: 1.5, ignitionTiles: 0, tracks: true, drawn: true, impactPower: 0.25, trailLifeScale: 1 },
  unguided: { shape: 'parabola', apexPxPerTile: 1.0, apexMinPx: 2, apexMaxPx: 8, apexU: 0.5,
    weaveTiles: 0, weaveCycles: 0, ignitionTiles: 0.3, tracks: false, drawn: true, impactPower: 0.2, trailLifeScale: 0.5625 },
  warhead: { shape: 'parabola', apexPxPerTile: 0, apexMinPx: 0, apexMaxPx: 0, apexU: 0.5,
    weaveTiles: 0, weaveCycles: 0, ignitionTiles: 0, tracks: false, drawn: false, impactPower: 0.3, trailLifeScale: 0 },
};

export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function missileDurationS(cls: number, distTiles: number): number {
  const mc = missileClassOf(cls);
  if (mc === null) return SIM_TICK_S;
  const perTick = SIM_PROJ_SPEED_TILES_S[mc] * SIM_TICK_S;
  // The epsilon absorbs 6 / 0.2 landing a hair above 30 in float; the sim's
  // own Q16.16 division lands a hair BELOW it and ceil()s to the same 30.
  const n = Math.max(1, Math.ceil(distTiles / perTick - 1e-9));
  // The sim resolves n - 1 ticks after the fire tick (projectiles step in the
  // tick they are fired); a same-tick round still draws for one.
  return Math.min(Math.max(1, n - 1) * SIM_TICK_S, MISSILE_MAX_DURATION_S);
}

export function missilePointAt(m: MissileModel, u: number): { x: number; y: number; liftPx: number } {
  const p = u < 0 ? 0 : u > 1 ? 1 : u;
  const prof = MISSILE_PROFILES[m.variant];
  const dx = m.tx - m.sx;
  const dy = m.ty - m.sy;
  let x = m.sx + dx * p;
  let y = m.sy + dy * p;
  if (prof.weaveTiles > 0) {
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const w = prof.weaveTiles * Math.sin(2 * Math.PI * prof.weaveCycles * p) * (1 - p);
      x += (-dy / len) * w;
      y += (dx / len) * w;
    }
  }
  let arc: number;
  if (prof.shape === 'climb_dive') {
    arc = p < prof.apexU
      ? m.apexPx * Math.sin((Math.PI / 2) * (p / prof.apexU))
      : m.apexPx * (1 - ((p - prof.apexU) / (1 - prof.apexU)) ** TOP_ATTACK_DIVE_EXPONENT);
  } else {
    arc = m.apexPx * 4 * p * (1 - p);
  }
  return { x, y, liftPx: m.launchLiftPx + (m.impactLiftPx - m.launchLiftPx) * p + arc };
}
```

  - **`spawnMissile`:**
    - Return `null` for a non-missile class.
    - `seed = hash01(tick, shooter)`.
    - `apexPx = clamp(hypot(tx-sx, ty-sy) × apexPxPerTile, apexMinPx, apexMaxPx)`; it is 0 when `apexPxPerTile` is 0.
    - `duration = missileDurationS(cls, simDistTiles)`.
    - End heights: `shooterAir ? MISSILE_AIR_LIFT_PX : MISSILE_GROUND_LIFT_PX`, and the same for the target.
    - `tracking = prof.tracks && willHit && target >= 0`.
    - On a miss, move `(tx, ty)` by the heading unit vector × `MISS_OVERSHOOT_TILES` plus the perpendicular × `(hash01(tick + 7919, shooter) - 0.5) × 2 × MISS_LATERAL_TILES`.
  - **`missileHeadingTurns(m, u)`** is the normalised `atan2` of `point(u) - point(max(0, u - 0.02))` in turns, in `[0, 1)`. At `u = 0` it uses the launch-to-target line.
  - **`stepMissiles`:**
    - It mutates in place and compacts the list with a write index (no `filter`, no allocation but the returned landings).
    - For each missile: if tracking, and `track.alive[target] === 1`, copy `track.x/y[target]` into `tx/ty`. If tracking and the target is dead, set `tracking = false`.
    - Then, if `t + dt >= duration`, push a landing at `point(1)` with `headingTurns(m, 1)`, `power = prof.impactPower` and `scale = 1`. Otherwise set `t += dt`.
  - **`interceptMissiles`** removes every missile with `target === target && !miss`. Each lands at `point(progress)` with `scale = INTERCEPT_SCALE` and `power = impactPower × INTERCEPT_SCALE`.
  - **`pushMissile`** does `list.shift()` while `list.length >= capacity`, then pushes.
- [ ] **Step 4: Gates, falsify, commit.** Each mutation must be seen red, then undone:
  - (a) Change `SIM_PROJ_SPEED_TILES_S.atgm` to 5: the tuning pin goes red.
  - (b) Drop the `- 1e-9`: the 6-tile 1.45 s case goes red, or stays green, whichever this Node does. **Record which.** If it stays green, the epsilon is defensive, and the body says so.
  - (c) Change `apexU` to 0.5: the top-attack test goes red.
  - (d) Drop `* (1 - p)` from the weave: the settle test goes red.
  - (e) Remove `willHit &&` from `tracking`: the miss test goes red.
  - (f) Add `'spike_atgm_lr'` to `TOP_ATTACK_WEAPON_IDS`: the "names only weapons that ship" test goes red.

  Commit with the message `feat(render): the ATGM flight model -- sim-synced time, top-attack, guidance (GH-250 T2)`.

---

### Task 3: The trail, the glow, and their writers

**Model: sonnet.** A pure ring buffer and two writers, with `writeParticleInstances` as the pattern.

**Files:**
- Create: `packages/render/src/three/units/missile-trail.ts`, `packages/render/src/three/units/missile-trail.test.ts`
- Modify: `packages/render/src/vfx/particles.ts` (add `export` to `sampleStep` and `sampleLerp`, nothing else)

**Interfaces:**

```ts
export const TRAIL_SPACING_TILES = 0.2;
export const TRAIL_RISE_PX_S = 5;
export const TRAIL_DRIFT_TILES_S = 0.15;
export const TRAIL_DRIFT_TURNS = 0.875;          // toward screen upper-right; one map-wide presentation wind
export const TRAIL_CAPACITY = 768;
export const GLOW_FLICKER = 0.15;
export const GLOW_FLICKER_HZ = 23;
export const MISSILE_BODY_TILES = 0.3;
export const MISSILE_BODY_WIDTH_PX = 2.5;
export const MISSILE_BODY_COLOR_KEY = 'gunmetal.1';
export interface TrailLook {
  lifeS: number; radiusPx: number; sizeCurve: number[]; alphaCurve: number[]; colors: string[];
  coreRadiusPx: number; coreColor: string; haloRadiusPx: number; haloColor: string; haloAlpha: number;
}
export function trailLookFrom(em: EmitterSpec | null, resolve: (key: string) => string): TrailLook | null;
export class TrailPool {
  constructor(capacity: number);
  readonly capacity: number;
  get live(): number;
  emit(x: number, y: number, worldY: number, lifeS: number): void;
  step(dt: number): void;
  forEachLive(fn: (x: number, y: number, worldY: number, ageFrac: number) => void): void;
}
export function emitAlongFlight(pool: TrailPool, m: MissileModel, look: TrailLook,
  worldYAt: (x: number, y: number, liftPx: number, u: number) => number): number;
export function glowScale(t: number, seed: number): number;
export interface SpriteBuffers { positions: Float32Array; colors: Float32Array; alphas: Float32Array; scales: Float32Array; softs: Float32Array }
export function writeMissileSprites(missiles: readonly MissileModel[], pool: TrailPool, look: TrailLook,
  worldYAt: (m: MissileModel, u: number) => number, soft: SpriteBuffers, core: SpriteBuffers): { soft: number; core: number };
export function missileIgnited(m: MissileModel): boolean;
```

- [ ] **Step 1: Write the failing tests.** Create `missile-trail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import type { EmitterSpec } from '../../vfx';
import { spawnMissile, type MissileLaunch, type MissileModel } from './missiles';
import {
  GLOW_FLICKER,
  TRAIL_DRIFT_TILES_S,
  TRAIL_RISE_PX_S,
  TRAIL_SPACING_TILES,
  TrailPool,
  emitAlongFlight,
  glowScale,
  missileIgnited,
  trailLookFrom,
  writeMissileSprites,
  type SpriteBuffers,
  type TrailLook,
} from './missile-trail';

const TRAIL_EMITTER: EmitterSpec = {
  id: 'missile_trail', trigger: 'projectile_trail', layer: 'above_units',
  particles: [
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 2.5, color_over_life: ['vfx.white_hot'], additive: true },
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 6, color_over_life: ['vfx.fire'], alpha_over_life: [0.55] },
    { sprite: 'smoke_puff', count: 1, lifetime_ms: 1600, size_px: 2.5, size_over_life: [1.0, 3.2],
      color_over_life: ['limestone.1', 'limestone.3', 'gunmetal.1'], alpha_over_life: [0.7, 0.0] },
  ],
};
const HEX: Record<string, string> = {
  'vfx.white_hot': '#FFF6D0', 'vfx.fire': '#FFB43C', 'limestone.1': '#E6D8BE', 'limestone.3': '#C8B494', 'gunmetal.1': '#8E9491',
};
const resolve = (k: string): string => {
  const hex = HEX[k];
  if (hex === undefined) throw new Error(`fixture: unknown palette key ${k}`);
  return hex;
};
function look(): TrailLook {
  const l = trailLookFrom(TRAIL_EMITTER, resolve);
  if (l === null) throw new Error('fixture: no look');
  return l;
}
function missile(over: Partial<MissileLaunch> = {}): MissileModel {
  const m = spawnMissile({
    sx: 0, sy: 0, tx: 8, ty: 0, simDistTiles: 8, side: 0, cls: WEAPON_CLASS.atgm, weaponId: 'kornet',
    target: 1, willHit: true, shooterAir: false, targetAir: false, tick: 1, shooter: 0, ...over,
  });
  if (m === null) throw new Error('fixture: not a missile');
  return m;
}
function buffers(n: number): SpriteBuffers {
  return { positions: new Float32Array(n * 3), colors: new Float32Array(n * 3), alphas: new Float32Array(n),
    scales: new Float32Array(n), softs: new Float32Array(n) };
}
const flatY = (_x: number, _y: number, liftPx: number): number => liftPx;

describe('trailLookFrom (P-3)', () => {
  it('reads the three layers by role, not by position, with every colour resolved (N9, N10)', () => {
    const l = look();
    expect(l.coreRadiusPx).toBe(2.5);
    expect(l.coreColor).toBe('#FFF6D0');
    expect(l.haloRadiusPx).toBe(6);
    expect(l.haloColor).toBe('#FFB43C');
    expect(l.haloAlpha).toBe(0.55);
    expect(l.lifeS).toBeCloseTo(1.6, 9);
    expect(l.colors).toEqual(['#E6D8BE', '#C8B494', '#8E9491']);
    const reversed = { ...TRAIL_EMITTER, particles: [...TRAIL_EMITTER.particles].reverse() };
    expect(trailLookFrom(reversed, resolve)).toEqual(l);
  });

  it('is null with no emitter, and throws on an emitter missing a role', () => {
    expect(trailLookFrom(null, resolve)).toBeNull();
    const noSmoke = { ...TRAIL_EMITTER, particles: TRAIL_EMITTER.particles.slice(0, 2) };
    expect(() => trailLookFrom(noSmoke, resolve)).toThrow(/smoke_puff/);
  });
});

describe('TrailPool', () => {
  it('is a ring: past capacity the oldest puff is the one overwritten', () => {
    const pool = new TrailPool(4);
    for (let i = 0; i < 6; i++) pool.emit(i, 0, 0, 10);
    expect(pool.live).toBe(4);
    const xs: number[] = [];
    pool.forEachLive((x) => xs.push(x));
    expect(xs.sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('ages, rises and drifts on the dt it is given, and dies at its own life (N10, spec D8)', () => {
    const pool = new TrailPool(8);
    pool.emit(0, 0, 0, 1.0);
    pool.step(0.5);
    let seen = 0;
    pool.forEachLive((x, y, worldY, ageFrac) => {
      seen++;
      expect(ageFrac).toBeCloseTo(0.5, 9);
      expect(Math.hypot(x, y)).toBeCloseTo(TRAIL_DRIFT_TILES_S * 0.5, 6);
      expect(worldY).toBeGreaterThan(0);
    });
    expect(seen).toBe(1);
    pool.step(0); // hit-stop: nothing moves
    pool.forEachLive((_x, _y, _w, ageFrac) => expect(ageFrac).toBeCloseTo(0.5, 9));
    pool.step(0.51);
    expect(pool.live).toBe(0);
    expect(TRAIL_RISE_PX_S).toBe(5);
  });
});

describe('emitAlongFlight', () => {
  it('drops one puff every 0.20 tiles of ground travelled, and never the same stretch twice', () => {
    const pool = new TrailPool(256);
    const m = missile();
    m.t = m.duration * 0.25; // 2.0 tiles of an 8-tile shot
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(Math.floor(2.0 / TRAIL_SPACING_TILES + 1e-9));
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(0);
    m.t = m.duration * 0.5;
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(10);
  });

  it('an RPG leaves no smoke before its motor lights at 0.3 tiles (N6)', () => {
    const pool = new TrailPool(64);
    const m = missile({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7', tx: 4, simDistTiles: 4 });
    m.t = m.duration * (0.25 / 4);
    expect(missileIgnited(m)).toBe(false);
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(0);
    m.t = m.duration * (1.0 / 4);
    expect(missileIgnited(m)).toBe(true);
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(4); // 0.4, 0.6, 0.8, 1.0
  });

  it('a warhead leaves nothing at all', () => {
    const pool = new TrailPool(64);
    const m = missile({ cls: WEAPON_CLASS.heat, weaponId: 'warhead', tx: 1.2, simDistTiles: 1.2 });
    m.t = m.duration * 0.9;
    expect(emitAlongFlight(pool, m, look(), flatY)).toBe(0);
  });
});

describe('the glow', () => {
  it('flickers inside +-15 % and is a pure function of (t, seed) (N9)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const g = glowScale(i / 60, 0.3);
      expect(g).toBeGreaterThanOrEqual(1 - GLOW_FLICKER - 1e-9);
      expect(g).toBeLessThanOrEqual(1 + GLOW_FLICKER + 1e-9);
      seen.add(Math.round(g * 1000));
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(glowScale(0.5, 0.3)).toBe(glowScale(0.5, 0.3));
  });
});

describe('writeMissileSprites', () => {
  it('writes a halo per lit missile and every live puff to the soft buffer, and a core per lit missile to the hot one', () => {
    const pool = new TrailPool(64);
    const m = missile();
    m.t = m.duration * 0.25;
    emitAlongFlight(pool, m, look(), flatY);
    const soft = buffers(128);
    const core = buffers(8);
    const counts = writeMissileSprites([m], pool, look(), (mm, u) => u + mm.launchLiftPx, soft, core);
    expect(counts.core).toBe(1);
    expect(counts.soft).toBe(1 + pool.live);
    expect(core.softs[0]).toBe(0);
    expect(soft.softs[0]).toBe(1);
    expect(soft.alphas[0]).toBeCloseTo(0.55, 9); // the halo is written first
  });

  it('writes nothing for a warhead or an unlit RPG', () => {
    const pool = new TrailPool(8);
    const w = missile({ cls: WEAPON_CLASS.heat, weaponId: 'warhead', tx: 1.2, simDistTiles: 1.2 });
    const r = missile({ cls: WEAPON_CLASS.rpg, weaponId: 'rpg7', tx: 4, simDistTiles: 4 });
    w.t = w.duration * 0.5;
    r.t = 0;
    const counts = writeMissileSprites([w, r], pool, look(), () => 0, buffers(8), buffers(8));
    expect(counts).toEqual({ soft: 0, core: 0 });
  });
});
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **`TrailPool`** is a struct of arrays: `x`, `y`, `worldY`, `age` and `life` as `Float32Array(capacity)`, plus `alive` as a `Uint8Array`, with a `head` index that wraps. `emit` writes at `head` and advances it. `step(dt)`:
    - ages every live puff by `dt`;
    - kills a puff at `age >= life`;
    - otherwise adds `TRAIL_DRIFT_TILES_S × dt` along `TRAIL_DRIFT_TURNS` to `x/y`, and `TRAIL_RISE_PX_S × dt × WORLD_Y_PER_LIFT_PIXEL` to `worldY`.

    Import `WORLD_Y_PER_LIFT_PIXEL` from `../../project`.
  - **`emitAlongFlight`:**
    - Return 0 if the missile is not drawn.
    - `travelled = missileProgress(m) × missileGroundDist(m)`, and `from = max(m.trailTiles, prof.ignitionTiles)`.
    - Emit for `k = floor(from / TRAIL_SPACING_TILES + 1e-9) + 1` upward, while `k × TRAIL_SPACING_TILES <= travelled + 1e-9`. Each puff sits at `u = d / groundDist`, with `life = look.lifeS × prof.trailLifeScale`.
    - Set `m.trailTiles` to the last EMITTED distance, and leave it alone when nothing was emitted, so an unlit RPG's first lit frame starts from its ignition point. The tests pin exactly this: 10 puffs to 2.0 tiles, 10 more to 4.0, and an RPG's first four at 0.4–1.0.
  - **`glowScale(t, seed)`** is `1 + GLOW_FLICKER × sin(2π(GLOW_FLICKER_HZ × t + seed))`.
  - **`missileIgnited(m)`** is `drawn && progress × groundDist >= ignitionTiles`.
  - **`writeMissileSprites`:**
    - For each ignited missile, one halo (soft, alpha `haloAlpha`, radius `haloRadiusPx × glowScale`) and one core (hot, radius `coreRadiusPx × glowScale`), both at `point(progress)`.
    - Then every live puff: radius `radiusPx × sampleLerp(sizeCurve, ageFrac)`, alpha `sampleLerp(alphaCurve, ageFrac)`, colour `sampleStep(colors, ageFrac)` through `hexToLinear` (`../terrain/shared`).
    - Stop at each buffer's capacity.
  - **`trailLookFrom`** takes the core from `additive === true`, the smoke from `sprite === 'smoke_puff'`, and the halo from the remaining one. It throws `missile_trail: no <role> layer` naming `additive`, `smoke_puff` or `halo`. `lifeS` is the midpoint of `lifetime_ms` / 1000. It resolves every colour key once, here.
- [ ] **Step 4: Gates, falsify, commit.** Each mutation must be seen red, then undone:
  - (a) Make the core role `layers[0]` instead of by `additive`: the reversed-order test goes red.
  - (b) Let `step` age by `dt × 2`: the ageing test goes red.
  - (c) Drop `ignitionTiles` from `from`: the RPG test goes red.
  - (d) Change the flicker to `± 0.3`: the glow test goes red.

  Commit the three paths with the message `feat(render): the missile trail ring, the motor glow and their writers (GH-250 T3)`.

---

### Task 4: The launch, trail and impact data

**Model: sonnet.** Three JSON files and a registration, with every value from the approved table.

**Files:**
- Modify: `data/vfx/fire_missile.json`, `packages/data/src/index.ts`, `packages/data/src/index.test.ts`
- Create: `data/vfx/missile_trail.json`, `data/vfx/missile_impact.json`

- [ ] **Step 1: Write the failing tests.** Append this to `packages/data/src/index.test.ts`. It already imports `vfxEmitters`, `readFileSync` and `path`.

```ts
describe('the ATGM emitters (GH-250, spec N9-N16)', () => {
  const byId = (id: string): { particles: Record<string, unknown>[]; [k: string]: unknown } => {
    const em = vfxEmitters.find((e) => (e as { id: string }).id === id);
    if (em === undefined) throw new Error(`no emitter ${id}`);
    return em as { particles: Record<string, unknown>[]; [k: string]: unknown };
  };

  it('fire_missile throws an ignition flash, a rear backblast cone and a ground ring (N11, N12)', () => {
    const em = byId('fire_missile');
    expect(em.light).toEqual({ color: 'vfx.fire', intensity: 2.0, radius_tiles: 3.0, decay_ms: 180 });
    const [flash, blast, ring] = em.particles;
    expect(flash.additive).toBe(true);
    expect(flash.count).toEqual([3, 4]);
    expect(blast.direction_offset_deg).toBe(180);
    expect(blast.cone_deg).toBe(30);
    expect(blast.count).toEqual([8, 12]);
    expect(ring.cone_deg).toBe(360);
    expect(ring.count).toEqual([6, 9]);
  });

  it('missile_trail carries one layer per role: core, halo, smoke (P-3)', () => {
    const em = byId('missile_trail');
    expect(em.trigger).toBe('projectile_trail');
    expect(em.particles.filter((p) => p.additive === true)).toHaveLength(1);
    expect(em.particles.filter((p) => p.sprite === 'smoke_puff')).toHaveLength(1);
    expect(em.particles).toHaveLength(3);
  });

  it('missile_impact is a HEAT hit, not a mortar bomb: burst, spall, light and shake, and no hit-stop (N13, N15, N16)', () => {
    const em = byId('missile_impact');
    expect(em.trigger).toBe('impact_armor');
    expect(em.hit_stop_ms).toBeUndefined();
    expect(em.screen_shake).toEqual({ amplitude_px: 2, duration_ms: 140, falloff_tiles: 8 });
    expect(em.light).toEqual({ color: 'vfx.fire', intensity: 2.6, radius_tiles: 3.5, decay_ms: 200 });
    expect(em.particles.filter((p) => p.mesh_burst === true)).toHaveLength(1);
    const spall = em.particles.find((p) => p.sprite === 'shard');
    expect(spall?.cone_deg).toBe(70);
    expect(em.particles.some((p) => p.mesh_plume === true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** The two new ids are missing from `vfxEmitters`, and the existing "carries every emitter file on disk" test also goes red the moment the files exist without registration. That is the guard working.
- [ ] **Step 3: Implement.**
  - Replace `fire_missile.json`'s `light` with N12. Keep its `id`, `trigger`, `layer`, `weapon_classes` and `budget_priority`. Replace its `particles` with exactly three layers:
    1. **Flash:** `soft_dot`, `[3,4]`, `[120,200]` ms, speed `[1.2,2.4]`, cone 24, size `[8,12]`, `size_over_life [1.0,0.5]`, `["vfx.white_hot","vfx.fire"]`, `alpha_over_life [1,0]`, `additive: true`.
    2. **Backblast:** `smoke_puff`, `[8,12]`, `[600,1200]`, speed `[1.5,4.5]`, cone 30, `direction_offset_deg` 180, drag 0.55, size `[8,14]`, `size_over_life [1.0,2.4]`, `["limestone.2","dust.3","limestone.4"]`, alpha `[0.85,0]`.
    3. **Ring:** `smoke_puff`, `[6,9]`, `[500,900]`, speed `[0.5,1.2]`, cone 360, drag 0.8, size `[6,10]`, `size_over_life [0.8,2.0]`, `["dust.2","dust.4"]`, alpha `[0.6,0]`.
  - `missile_trail.json` is `{"id":"missile_trail","trigger":"projectile_trail","layer":"above_units","budget_priority":6,"particles":[…]}`, with Task 3's `TRAIL_EMITTER` layers verbatim. `lifetime_ms: 16` on the two glow layers means "one frame: a glow is redrawn, never aged". A `_comment` is not allowed (`additionalProperties: false`), so that meaning is carried in `missile-trail.ts`'s top comment.
  - `missile_impact.json` gets N13, N15 and N16:
    - **Flash:** `soft_dot`, `[4,6]`, `[90,160]`, speed `[0.6,1.6]`, cone 360, size `[8,13]`, `size_over_life [1.0,0.5]`, `["vfx.white_hot","vfx.fire"]`, alpha `[1,0]`, `additive: true`, `mesh_burst: true`.
    - **Spall:** `shard`, `[8,12]`, `[250,450]`, speed `[2.5,5.0]`, cone 70, gravity 3, drag 0.2, size `[2,4]`, `size_over_life [1.0,0.5]`, `["vfx.white_hot","vfx.ember","gunmetal.2"]`, alpha `[1,0]`.
    - **Smoke:** `smoke_puff`, `[4,6]`, `[600,1100]`, speed `[0.3,0.9]`, cone 360, gravity −0.4, drag 0.7, size `[7,12]`, `size_over_life [0.6,2.0]`, `["gunmetal.2","gunmetal.3"]`, alpha `[0.75,0]`.
    - `budget_priority` 7, `layer` `above_units`.
  - In `packages/data/src/index.ts`, import both files beside `shellImpact` (`import missileImpact from '../../../data/vfx/missile_impact.json'`, `import missileTrail from …`) and add both to the `vfxEmitters` array.
- [ ] **Step 4: Gates, falsify, commit.** `pnpm validate:data` matters here, because the schema is the only thing that checks sprite names and palette keys. Each mutation must be seen red, then undone:
  - (a) Set a colour to `"#FFFFFF"`: `pnpm validate:data` goes red.
  - (b) Add `"hit_stop_ms": 20` to `missile_impact`: the impact test goes red.
  - (c) Remove `missileTrail` from `vfxEmitters`: the on-disk pin goes red.

  Commit the five paths with the message `feat(data): the ATGM launch, trail look and HEAT impact emitters (GH-250 T4)`.

---

### Task 5: The segment extraction and the `MissileFx` controller

**Model: sonnet.** One extraction that the existing suite guards, plus a controller in the pooled-manager shape.

**Files:**
- Modify: `packages/render/src/three/units/fx.ts`, `packages/render/src/three/units/fx.test.ts`
- Create: `packages/render/src/three/units/missile-fx.ts`, `packages/render/src/three/units/missile-fx.test.ts`

**Interfaces:**
- `fx.ts`:
  - `export function liftedSegmentQuad(ax: number, ay: number, aY: number, bx: number, by: number, bY: number, widthAPx: number, widthBPx: number): Float32Array`
  - `shellSegmentQuad` becomes a caller of it.
  - `createParticleMaterial` and `createTracerMaterial` gain `export`.
- `missile-fx.ts`:
  - `export const MISSILE_TRAIL_EMITTER_ID = 'missile_trail'`
  - `export const MISSILE_IMPACT_EMITTER_ID = 'missile_impact'`
  - `export const MISS_SCORCH_POWER = 0.15`
  - `export class MissileFx`:
    - `readonly missiles: MissileModel[]`
    - `readonly trail: TrailPool`
    - `readonly bodyMesh`, `readonly spriteMesh`, `readonly coreMesh`
    - `get meshes(): THREE.Object3D[]`
    - `setLook(em: EmitterSpec | null, resolve: (k: string) => string): void`
    - `launch(l: MissileLaunch): MissileModel | null`
    - `step(dt: number, track: TargetTrack, elevation: ElevationSource, w: number, h: number): MissileLanding[]`
    - `intercept(target: number): MissileLanding[]`
    - `setDebugHidden(hidden: boolean): number`
    - `dispose(): void`

- [ ] **Step 1: Write the failing tests.** Append this to `fx.test.ts`:

```ts
describe('liftedSegmentQuad is the one segment maths (GH-250 T5)', () => {
  it('reproduces shellSegmentQuad exactly for every kind, at several points of flight', () => {
    for (const kind of ['mortar', 'rocket', 'bolt'] as const) {
      const s = spawnShell(1, 2, 11, 6, 0, kind);
      for (const [uA, uB] of [[0, 0.1], [0.4, 0.55], [0.9, 1]] as const) {
        const a = shellPointAt(s, uA);
        const b = shellPointAt(s, uB);
        const y = (u: number, lift: number): number =>
          groundWorldY(null, 0, 0, s.sx, s.sy) +
          (groundWorldY(null, 0, 0, s.tx, s.ty) - groundWorldY(null, 0, 0, s.sx, s.sy)) * u +
          (SHELL_LIFT_PX + lift) * WORLD_Y_PER_LIFT_PIXEL;
        expect(liftedSegmentQuad(a.x, a.y, y(uA, a.liftPx), b.x, b.y, y(uB, b.liftPx), 5, 3)).toEqual(
          shellSegmentQuad(s, uA, uB, null, 0, 0, 5, 3)
        );
      }
    }
  });
});
```

  Add `liftedSegmentQuad` to that file's `./fx` import, and `groundWorldY` from `../ground-height`, if not already imported. The file already imports `spawnShell`, `shellPointAt`, `SHELL_LIFT_PX` and `WORLD_Y_PER_LIFT_PIXEL`; check, and add any that are missing.

  Create `missile-fx.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import type { EmitterSpec } from '../../vfx';
import { FX_RENDER_ORDER, FX_RENDER_ORDER_ADDITIVE } from './render-order';
import { MissileFx } from './missile-fx';
import type { MissileLaunch, TargetTrack } from './missiles';

const TRAIL: EmitterSpec = {
  id: 'missile_trail', trigger: 'projectile_trail', layer: 'above_units',
  particles: [
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 2.5, color_over_life: ['vfx.white_hot'], additive: true },
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 6, color_over_life: ['vfx.fire'], alpha_over_life: [0.55] },
    { sprite: 'smoke_puff', count: 1, lifetime_ms: 1600, size_px: 2.5, size_over_life: [1, 3.2],
      color_over_life: ['limestone.1', 'limestone.3', 'gunmetal.1'], alpha_over_life: [0.7, 0] },
  ],
};
const resolve = (k: string): string =>
  k.startsWith('vfx') ? '#FFB43C' : k.startsWith('gunmetal') ? '#8E9491' : '#E6D8BE';
const LAUNCH: MissileLaunch = {
  sx: 0, sy: 0, tx: 8, ty: 0, simDistTiles: 8, side: 0, cls: WEAPON_CLASS.atgm, weaponId: 'spike_atgm',
  target: 1, willHit: true, shooterAir: false, targetAir: false, tick: 5, shooter: 0,
};
const TRACK: TargetTrack = { x: [0, 8], y: [0, 0], alive: [1, 1] };

describe('MissileFx', () => {
  it('owns three meshes in the bands the spec names, all depth-tested, none writing depth', () => {
    const fx = new MissileFx();
    expect(fx.meshes).toHaveLength(3);
    expect(fx.bodyMesh.renderOrder).toBe(FX_RENDER_ORDER);
    expect(fx.spriteMesh.renderOrder).toBe(FX_RENDER_ORDER);
    expect(fx.coreMesh.renderOrder).toBe(FX_RENDER_ORDER_ADDITIVE);
    for (const m of fx.meshes) {
      const mat = (m as unknown as { material: { depthTest: boolean; depthWrite: boolean } }).material;
      expect(mat.depthTest).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    fx.dispose();
  });

  it('costs nothing idle and three draws in flight (N18)', () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolve);
    fx.step(1 / 60, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(0);
    fx.launch(LAUNCH);
    fx.step(0.5, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(3);
    fx.dispose();
  });

  it('reports a landing on the frame the flight ends, and keeps the trail after it', () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolve);
    fx.launch(LAUNCH); // 8 tiles at 4 tiles/s: 39 ticks = 1.95 s = 124.8 frames of 1/64
    let landings = 0;
    for (let f = 0; f < 124; f++) landings += fx.step(1 / 64, TRACK, null, 0, 0).length;
    expect(landings).toBe(0);
    landings += fx.step(1 / 64, TRACK, null, 0, 0).length;
    expect(landings).toBe(1);
    expect(fx.missiles).toHaveLength(0);
    expect(fx.trail.live).toBeGreaterThan(0);
    expect(fx.spriteMesh.visible).toBe(true);
    fx.dispose();
  });

  it('models and lands a missile before any look is set, drawing no trail or glow', () => {
    const fx = new MissileFx();
    fx.launch(LAUNCH);
    fx.step(0.5, TRACK, null, 0, 0);
    expect(fx.missiles).toHaveLength(1);
    expect(fx.trail.live).toBe(0);
    expect(fx.spriteMesh.visible).toBe(false);
    expect(fx.coreMesh.visible).toBe(false);
    fx.dispose();
  });

  it('the debug flag hides all three through the next step, and answers 3 (P-5)', () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolve);
    fx.launch(LAUNCH);
    expect(fx.setDebugHidden(true)).toBe(3);
    fx.step(0, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(0);
    fx.setDebugHidden(false);
    fx.step(0, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(3);
    fx.dispose();
  });

  it('refuses a non-missile class without throwing', () => {
    const fx = new MissileFx();
    expect(fx.launch({ ...LAUNCH, cls: WEAPON_CLASS.small_arms })).toBeNull();
    expect(fx.missiles).toHaveLength(0);
    fx.dispose();
  });
});
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **`liftedSegmentQuad`** is the body of today's `shellSegmentQuad` from `const dxScreen` down, taking the six endpoint numbers and two widths. `shellSegmentQuad` computes `a`, `b`, `aY` and `bY` exactly as today, then returns `liftedSegmentQuad(a.x, a.y, aY, b.x, b.y, bY, widthAPx, widthBPx)`. Add `export` to the two material factories. Change nothing else in `fx.ts`.
  - **`MissileFx`:**
    - **Body mesh.** A `THREE.Mesh` over a `BufferGeometry` with `position`/`aColor`/`aAlpha`, `DynamicDrawUsage`, and index `tracerIndexBuffer(MISSILE_CAPACITY)`. Material: `createTracerMaterial(true)`. Settings: `renderOrder = FX_RENDER_ORDER`, `frustumCulled = false`.
    - **Sprite and core meshes.** Two `THREE.InstancedMesh`es over `particleBillboardGeometry()`, with the `aColor`/`aAlpha`/`aSoft` instanced attributes exactly as `ParticleInstancer` builds them. Materials: `createParticleMaterial(true, false)` for sprites and `createParticleMaterial(true, true)` for cores. Capacities: `TRAIL_CAPACITY + MISSILE_CAPACITY` and `MISSILE_CAPACITY`. Band 2 and band 2.5. `frustumCulled = false`.
    - **`setLook`** stores `trailLookFrom(em, resolve)` and `bodyHex = resolve(MISSILE_BODY_COLOR_KEY)`.
    - **`launch`** does `spawnMissile`, then `pushMissile`.
    - **`step`:**
      1. `stepMissiles`.
      2. If a look is set, `emitAlongFlight` for each missile, using `worldYAt = missileWorldY` (below).
      3. `trail.step(dt)`.
      4. Write the body quads for each ignited drawn missile, via `liftedSegmentQuad` from `point(max(0, u − MISSILE_BODY_TILES / groundDist))` to `point(u)`, width `MISSILE_BODY_WIDTH_PX`, alpha 1, `bodyHex` through `hexToLinear`.
      5. `writeMissileSprites` into preallocated scratch arrays, then `setMatrixAt` exactly as `ParticleInstancer.update` does.
      6. Set `count`/`drawRange`, `needsUpdate`, and `visible = count > 0 && !debugHidden` on each.
      7. Return the landings.
    - **`missileWorldY(m, u)`** is `groundWorldY(launch) + (groundWorldY(impact) − groundWorldY(launch)) × u + point(u).liftPx × WORLD_Y_PER_LIFT_PIXEL`. It is the `shellSegmentQuad` rule without `SHELL_LIFT_PX`, since `liftPx` already carries N7. A puff stores the absolute `worldY` it was emitted at, so it never bulges over a ridge it drifts across.
    - **`intercept`** is `interceptMissiles(this.missiles, target)`.
    - **`setDebugHidden`** sets the flag and returns 3.
    - **`dispose`** disposes the three geometries and materials.

  The top comment says why this is a controller and not three `ThreeRenderer` fields: spec D5, and the ground lane's overlap.
- [ ] **Step 4: Gates, falsify, commit.** The existing `fx.test.ts` suite must stay green, unchanged: it is the extraction's guard. Each mutation must be seen red, then undone:
  - (a) Swap `widthAPx`/`widthBPx` inside `liftedSegmentQuad`: the new equality test and GH-149's width test go red.
  - (b) Make the core mesh `createParticleMaterial(true, false)`: nothing red? **Expected, and recorded.** The band test does not see the material's hot flag. Add `expect((fx.coreMesh.material as THREE.ShaderMaterial).fragmentShader).toContain('float a = 1.0')` and see it red.
  - (c) Drop `&& !debugHidden`: the debug test goes red.
  - (d) Drop `trail.step`: the kept-trail test stays green, but `trail.live` never falls. Add `for (let f = 0; f < 200; f++) fx.step(1 / 60, TRACK, null, 0, 0); expect(fx.trail.live).toBe(0);` to the landing test and see it red.

  Commit the four paths with the message `feat(render): MissileFx -- one controller for body, glow and trail, three draws in flight (GH-250 T5)`.

---

### Task 6: The wiring: `shells.ts` routing and the one `ThreeRenderer.ts` region

**Model: opus.** A 9,000-line file under edit on another branch, an event wiring that only a real `Sim` can prove, and a test rewrite of GH-149's own suite.

**Files (seven; the named exception):**
- Modify: `packages/render/src/three/units/shells.ts`, `units/shells.test.ts`, `units/fx.test.ts`, `ThreeRenderer.ts`, `ThreeRenderer.indirect-projectile.test.ts`, `debug-layers.ts`
- Create: `packages/render/src/three/ThreeRenderer.missile.test.ts`

- [ ] **Step 0: Rebase if the ground lane landed.** `/usr/bin/git fetch origin`, then `/usr/bin/git log --oneline HEAD..origin/main -- packages/render/src/three/ThreeRenderer.ts packages/render/src/three/debug-layers.ts`. If anything is listed, `/usr/bin/git merge origin/main`, and re-find every anchor below by its text, not its line number.
- [ ] **Step 1: Write the failing tests.**
  - **(a) `shells.test.ts`:**
    - Keep the `shellKindFor` cases as they are: `'missile'` is still its answer for the three classes, now typed `ProjectileKind`.
    - Delete `expect(isIndirectShell('missile')).toBe(false);`, since `'missile'` is no longer a `ShellKind`.
    - Replace the "outruns a missile" case with:

```ts
  it('outruns every missile the sim flies, so a Hellfire and a sabot round do not read alike', () => {
    expect(SHELL_PROFILES.bolt.speedTilesS).toBeGreaterThan(SIM_PROJ_SPEED_TILES_S.rpg * 4);
    expect(Object.keys(SHELL_PROFILES).sort()).toEqual(['bolt', 'mortar', 'rocket']);
  });
```

    with `import { SIM_PROJ_SPEED_TILES_S } from './missiles';`.
  - **(b) `fx.test.ts`:** in the width test, narrow `headWidthPx` to `'mortar' | 'bolt'`, and delete the `missile` line.
  - **(c) `ThreeRenderer.indirect-projectile.test.ts`:** add `missileFx: { missiles: MissileModel[] }` to `Privates` (import the type from `./units/missiles`). Replace the "Hellfire spawns a missile" case with:

```ts
  it("a helicopter's Hellfire leaves the bolt batch for MissileFx -- and flies longer than the tank's round", () => {
    const tankRun = firstFireEvents(TANK);
    const heliRun = firstFireEvents(HELI);
    const tankRenderer = rendererAfter(tankRun.sim, tankRun.events);
    const heliRenderer = rendererAfter(heliRun.sim, heliRun.events);
    const bolt = privates(tankRenderer).bolts[0];
    const hp = privates(heliRenderer);
    expect(hp.bolts).toHaveLength(0);
    expect(hp.tracers).toHaveLength(0);
    expect(hp.missileFx.missiles).toHaveLength(1);
    const missile = hp.missileFx.missiles[0];
    expect(missile.variant).toBe('guided');
    expect(missile.duration).toBeGreaterThan(bolt.duration * 4);
    tankRenderer.dispose();
    heliRenderer.dispose();
  });
```

  - **(d) Create `ThreeRenderer.missile.test.ts`.** Copy the `vi.mock('three', …)` block, `TONES` and `makeOpts` verbatim from `ThreeRenderer.indirect-projectile.test.ts`. Its first line comment names that file as the source. Then:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { EmitterSpec } from '../vfx';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { MissileLanding, MissileModel } from './units/missiles';
import { MISSILE_IMPACT_EMITTER_ID } from './units/missile-fx';

// (vi.mock('three', ...), TONES, makeOpts: copied verbatim, see above)

const SPIKE: UnitTypeJson = {
  id: 't_at', role: 'at_team',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1.2, sight_tiles: 20 },
  weapons: [{ id: 'spike_atgm', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78,
    penetration: 900, damage: 800, suppression: 60, rof_per_min: 3, min_range_tiles: 1 }],
};
const RPG: UnitTypeJson = {
  id: 't_rpg', role: 'at_team',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1.2, sight_tiles: 20 },
  weapons: [{ id: 'rpg7', type: 'rpg', range_tiles: 5, effective_range_tiles: 4, accuracy: 0.6,
    penetration: 500, damage: 600, suppression: 50, rof_per_min: 4 }],
};
// Armour 300, not 10: below SOFT_ARMOR_LIMIT a hit is plain damage with no
// `impact` event, and the resolution test below reads that event.
const HULL: UnitTypeJson = {
  id: 't_hull', role: 'mbt',
  hull: { hp: 100000, armor: { front: 300, side: 300, rear: 300 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1, sight_tiles: 1 }, weapons: [],
};
const IMPACT: EmitterSpec = {
  id: 'missile_impact', trigger: 'impact_armor', layer: 'above_units',
  screen_shake: { amplitude_px: 2, duration_ms: 140, falloff_tiles: 8 },
  light: { color: 'vfx.fire', intensity: 2.6, radius_tiles: 3.5, decay_ms: 200 },
  particles: [{ sprite: 'shard', count: [8, 12], lifetime_ms: [250, 450], cone_deg: 70, color_over_life: ['vfx.fire'] }],
};

interface Privates {
  missileFx: { missiles: MissileModel[] };
  bolts: unknown[];
  tracers: unknown[];
  flashLights: { liveCount: number };
  updateFx(ms: number): void;
  spawnMissileImpactFx(l: MissileLanding): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

function fire(shooterJson: UnitTypeJson, gap: number): { sim: Sim; shooter: number; target: number; events: SimEvent[]; tick: number } {
  const sim = new Sim({ seed: 11, width: 32, height: 32, capacity: 8 });
  const s = sim.addUnitType(shooterJson);
  const t = sim.addUnitType(HULL);
  const shooter = sim.spawn(s, 0, fx.from(4), fx.from(4));
  const target = sim.spawn(t, 1, fx.from(4 + gap), fx.from(4));
  for (let i = 0; i < 600; i++) {
    const events = sim.tick();
    if (events.some((e) => e.kind === 'fire' && e.shooter === shooter)) return { sim, shooter, target, events, tick: sim.tickCount };
  }
  throw new Error(`${shooterJson.id} never fired`);
}
function rendererFor(sim: Sim, events: SimEvent[]): ThreeRenderer {
  const r = new ThreeRenderer(sim, makeOpts());
  r.snapshot();
  r.onEvents(events);
  return r;
}

describe('an ATGM is a missile, not a bolt (GH-250)', () => {
  it('the Spike flies top-attack in MissileFx, with no bolt and no tracer', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    expect(priv(r).missileFx.missiles.map((m) => m.variant)).toEqual(['top_attack']);
    expect(priv(r).bolts).toHaveLength(0);
    expect(priv(r).tracers).toHaveLength(0);
    r.dispose();
  });

  it('an RPG flies unguided', () => {
    const { sim, events } = fire(RPG, 4);
    const r = rendererFor(sim, events);
    expect(priv(r).missileFx.missiles.map((m) => m.variant)).toEqual(['unguided']);
    r.dispose();
  });

  it('lands on the sim\'s own resolution tick, give or take one (spec D1, P-1)', () => {
    for (const [json, gap] of [[SPIKE, 7], [RPG, 4]] as const) {
      const { sim, shooter, events, tick } = fire(json, gap);
      const r = rendererFor(sim, events);
      const duration = priv(r).missileFx.missiles[0].duration;
      let resolvedAt = -1;
      for (let i = 0; i < 400 && resolvedAt < 0; i++) {
        const ev = sim.tick();
        if (ev.some((e) => (e.kind === 'impact' || e.kind === 'nearMiss' || e.kind === 'aps') && e.shooter === shooter)) {
          resolvedAt = sim.tickCount;
        }
      }
      expect(resolvedAt).toBeGreaterThan(0);
      expect(Math.abs((resolvedAt - tick) * 0.05 - duration)).toBeLessThanOrEqual(0.05 + 1e-9);
      r.dispose();
    }
  });

  it('throws the HEAT impact once, on the frame the missile lands, at its own power and heading', () => {
    const { sim, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    r.useEmitters([IMPACT], (k) => (k.startsWith('#') ? k : '#FFB43C'));
    const calls: MissileLanding[] = [];
    const real = priv(r).spawnMissileImpactFx.bind(r);
    priv(r).spawnMissileImpactFx = (l) => {
      calls.push(l);
      real(l);
    };
    const frames = Math.ceil(priv(r).missileFx.missiles[0].duration * 60);
    for (let i = 0; i < frames - 2; i++) priv(r).updateFx(1000 / 60);
    expect(calls).toHaveLength(0);
    for (let i = 0; i < 4; i++) priv(r).updateFx(1000 / 60);
    expect(calls).toHaveLength(1);
    expect(calls[0].power).toBe(0.25);
    expect(calls[0].x).toBeCloseTo(11, 0);
    expect(priv(r).flashLights.liveCount).toBeGreaterThan(0);
    r.dispose();
  });

  it('an APS intercept detonates the in-flight missile at that target, at half scale (spec D4)', () => {
    const { sim, target, events } = fire(SPIKE, 7);
    const r = rendererFor(sim, events);
    const calls: MissileLanding[] = [];
    priv(r).spawnMissileImpactFx = (l) => calls.push(l);
    priv(r).updateFx(300);
    const aps: SimEvent = { kind: 'aps', tick: 1, target, shooter: 0, pIntercept: 0, roll: 0, intercepted: true };
    r.onEvents([aps]);
    expect(calls).toHaveLength(1);
    expect(calls[0].scale).toBe(0.5);
    expect(priv(r).missileFx.missiles).toHaveLength(0);
    r.dispose();
  });

  it('names the impact emitter the data ships', () => {
    expect(MISSILE_IMPACT_EMITTER_ID).toBe('missile_impact');
  });
});
```

  - **(e) The debug layer.** If `debug-layers.test.ts` pins `DEBUG_LAYERS` as a literal list, append `'missiles'` there too, which makes a sixth test-bearing file. If it does not, add to `ThreeRenderer.missile.test.ts`:

```ts
it('the missiles debug layer hides all three meshes and answers 3', () => {
  const { sim, events } = fire(SPIKE, 7);
  const r = rendererFor(sim, events);
  expect(r.setDebugLayerVisible('missiles', false)).toBe(3);
  r.dispose();
});
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **`shells.ts`:**
    - `export type ShellKind = 'mortar' | 'rocket' | 'bolt';`
    - `export type ProjectileKind = ShellKind | 'missile';`
    - `shellKindFor(cls): ProjectileKind | null`, same body.
    - Delete `SHELL_PROFILES.missile`.
    - Rewrite the top comment's `missile` paragraph to say that `units/missiles.ts` owns missiles since GH-250 and why (spec D5).
  - **`ThreeRenderer.ts`:** these are the hunks, anchored by text.
    1. **Imports.** Beside `from './units/shells'`, import `MissileFx`, `MISSILE_IMPACT_EMITTER_ID`, `MISSILE_TRAIL_EMITTER_ID` and `MISS_SCORCH_POWER` from `./units/missile-fx`, and `type MissileLanding` from `./units/missiles`.
    2. **Field**, after the `boltBatch` field: `private readonly missileFx = new MissileFx();`, with a doc comment naming GH-250 and spec D5.
    3. **Scene add**, in the constructor call that adds `this.boltBatch.mesh`: append `...this.missileFx.meshes`.
    4. **`dispose`**, after `this.boltBatch.dispose();`: `this.missileFx.dispose();`.
    5. **`setDebugLayerVisible`**, after the `blast-light` case: `case 'missiles': return this.missileFx.setDebugHidden(!visible);` with a comment on P-5.
    6. **`onEvents`**, in the `aps` + `intercepted` branch after the flat puff: `for (const l of this.missileFx.intercept(e.target)) this.spawnMissileImpactFx(l);`.
    7. **`onFire`.** Replace `if (shellKind !== null) { const shell = spawnShell(...); … }` with:

```ts
    if (shellKind === 'missile') {
      // GH-250: a missile is MissileFx's, not a bolt -- see units/missiles.ts.
      // The DURATION uses the shooter-centre distance the sim counts (P-1);
      // the PATH starts at the muzzle, like every round.
      const targetAir = !atStruct && e.target >= 0 && this.sim.unitTypes[st.typeIdx[e.target]].isAir;
      this.missileFx.launch({
        sx: mzX, sy: mzY, tx, ty,
        simDistTiles: Math.hypot(tx - this.curX[e.shooter], ty - this.curY[e.shooter]),
        side: st.side[e.shooter], cls, weaponId: e.weaponId,
        target: atStruct ? -1 : e.target, willHit: e.willHit,
        shooterAir: type.isAir, targetAir, tick: e.tick, shooter: e.shooter,
      });
    } else if (shellKind !== null) {
      const shell = spawnShell(mzX, mzY, tx, ty, st.side[e.shooter], shellKind);
      if (isIndirectShell(shellKind)) this.shells.push(shell);
      else this.bolts.push(shell);
    }
```

    8. **`useEmitters`**, after `this.collapseShrouds.setColors(resolve);`: `this.missileFx.setLook(this.emitterLibrary.byName(MISSILE_TRAIL_EMITTER_ID), resolve);`.
    9. **`updateFx`**, after the `boltBatch.update` line:

```ts
    // GH-250: missiles on the same frame clock; a landing throws the HEAT
    // impact on this frame, the shellHasLanded rule (spec D7).
    const landings = this.missileFx.step(
      dtSeconds, { x: this.curX, y: this.curY, alive: this.sim.state.alive }, elevation, this.sim.width, this.sim.height
    );
    for (const l of landings) this.spawnMissileImpactFx(l);
```

    10. **New method**, after `spawnShellImpactFx`:

```ts
  /**
   * GH-250: the HEAT impact -- `missile_impact.json`, spawned where the
   * missile visibly lands, off the frame clock (spec D7). `spawnCollapseFx`'s
   * loop, except the particles leave along the missile's own heading (a spall
   * cone, not a column), light and shake are the emitter's authored values x
   * `scale` rather than x `impactPower` (P-4), and there is no hit-stop and no
   * crater: a kill already owns the blast. A miss marks the ground.
   */
  private spawnMissileImpactFx(l: MissileLanding): void {
    const em = this.emitterLibrary.byName(MISSILE_IMPACT_EMITTER_ID);
    const worldY = groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, l.x, l.y);
    if (em && this.particleSystem) {
      const prio = em.budget_priority ?? 7;
      for (const layer of em.particles) {
        if (layer.mesh_burst && this.explosionBursts.ready) {
          this.explosionBursts.spawn(l.x, worldY, l.y, tileHash(Math.floor(l.x), Math.floor(l.y)), l.power, EXPLOSION_BURST_DEFAULT_DURATION_MS);
          continue;
        }
        const offset = (layer.direction_offset_deg ?? 0) / 360;
        this.particleSystem.spawn(layer, l.x, l.y, l.headingTurns + offset, l.power, prio, fxLayerIndex(em.layer, layer.additive ?? false));
      }
    }
    const light = blastLightSpec(em, l.scale);
    if (light) this.flashLights.spawn(l.x, l.y, worldY, light, this.overlayColor(light.color ?? 'vfx.fire', '#FFB43C'));
    this.shakeState = pushShake(this.shakeState, blastShake(em, l.scale), l.x, l.y);
    if (l.miss) this.stampGroundDecal(this.persistentStamp('scorch', l.x, l.y, scorchRadiusTiles(MISS_SCORCH_POWER)));
  }
```

  - **`debug-layers.ts`:** append `'missiles'` after `'blast-light'` in `DEBUG_LAYERS`, and add a bullet to the top list: *`missiles` — MissileFx's body, glow and trail (GH-250). A flag, not a `visible` write, because `step` rewrites visibility every frame; see `blast-light`.*
- [ ] **Step 4: Gates, falsify, commit.** Also run `pnpm test:determinism`, which must be unchanged, and confirm the invariant diff is empty. Each mutation must be seen red, then undone:
  - (a) In `onFire`, launch with `simDistTiles: Math.hypot(tx - mzX, ty - mzY)`, the muzzle distance. The resolution-tick test may stay green, because the muzzle is 0.4 tiles out and that is 0.1 s at 4 tiles/s, inside ±1 tick at some ranges. **Record the result.** Then launch with `simDistTiles: 0`: it goes red.
  - (b) Route `'missile'` into `this.bolts` again: the Spike test goes red.
  - (c) Drop the `updateFx` landing loop: the HEAT impact test goes red.
  - (d) Drop the `aps` line: the intercept test goes red.
  - (e) Pass `l.power` instead of `l.scale` to `blastLightSpec`. The impact test's `liveCount` stays green. **Recorded**: P-4 is guarded by Task 7's capture, not by this unit test. Say so in the commit body.

  Commit the seven paths with the message `feat(render): ATGMs fly MissileFx -- guided, top-attack, a HEAT impact on the frame they land (GH-250 T6)`. The body lists the ThreeRenderer hunks, and says `packages/sim` and `renderer.ts` are untouched.

---

### Task 7: The after-set, the floor, the doc, and the gate

**Model: opus.** Floor calibration is judgement against measurement, and whether a bless is needed has to be read, not executed.

**Files:**
- Modify: `tools/src/perf/atgm-captures.ts` (`ATGM_LAYER_FLOORS`), `tools/src/perf/atgm-captures.test.ts`, `CLAUDE.md`

- [ ] **Step 1: The after-set.** `lsof -i :5197`, then `pnpm atgm:capture -- --label=after --port=5197`. Read `sheet.md`. Each subject must satisfy all of these, and a failure is a defect to find before anything else:
  - it fired;
  - `inFlight` reads 1 from rung 50 until the rung after its sim-synced duration, and 0 after it;
  - the `missiles` toggle is `available: true` with a non-zero delta.

  Open each `flip-<id>.html` and look, at 1× and at 0.25×. The ledger records, per subject:
  - the backblast visible behind the shooter on rungs 0–150;
  - the glow visible every in-flight rung;
  - a trail present at impact and still present at rung 2000;
  - the Spike's apex rung near 40 % of its flight;
  - the HEAT flash on the landing rung.
- [ ] **Step 2: Calibrate the floor.** Run `pnpm atgm:capture -- --label=after --port=5197` twice more. The floor is **one third of the smallest of the three readings**, per metric, on each subject. `ATGM_LAYER_FLOORS.missiles` gets those numbers. `measured` names the machine, the GL string, the viewport, zoom 2.0, rung 600 and the three raw readings. Then add this test, which fails until the floors are real:

```ts
describe('the missiles floor', () => {
  it('is calibrated, not zero -- a zero floor passes a layer that draws nothing', () => {
    expect(ATGM_LAYER_FLOORS.missiles.minDiffPixels).toBeGreaterThan(0);
    expect(ATGM_LAYER_FLOORS.missiles.minMeanAbsChannelDelta).toBeGreaterThan(0);
    expect(ATGM_LAYER_FLOORS.missiles.measured).toMatch(/rung 600/);
  });
});
```

  The harness now sets `process.exitCode = 1` when a reading falls below its floor, following the blast harness.
- [ ] **Step 3: Falsify the instrument against a broken renderer.** Each mutation is seen red **in the harness** (exit 1, the reading printed), then undone:
  - (a) Make `MissileFx.step`'s sprite `visible` always `false`: the toggle delta collapses.
  - (b) Make `writeMissileSprites` write alpha 0: same.
  - (c) Change `trailLifeScale` for `guided` to 0: the `sheet.json` trail at rung 2000 is absent. This one is read, not auto-failed, and the ledger says so.
- [ ] **Step 4: The doc.** In `CLAUDE.md`, "Every shot that is one round draws a travelling projectile" bullet, replace the `missile` half with one paragraph:
  - since GH-250, `atgm`/`rpg`/`heat` fly `units/missile-fx.ts`, not a `ShellBatch`;
  - the flight time is the sim's own, to the tick (copied, and pinned against `tuning.ts` as text);
  - top-attack is a named weapon set;
  - the trail cannot live in `ParticleSystem`, which has no height;
  - the HEAT impact is `missile_impact.json`, on the frame clock, with light and shake × `scale`, not × `impactPower`;
  - `pnpm atgm:capture` is the instrument, and the lead judges `flip.html`.

  Keep it under 180 words.
- [ ] **Step 5: Gates and the golden gate.**
  - Run the full gates line plus `pnpm test:determinism`, and confirm the invariant diff is empty.
  - Do **not** run a local bless: the darwin baseline is stale.
  - Push is the coordinator's, not this task's. After the PR opens, read CI's `visual` job:
    - **every gated scenario (`quiet`, `open-ground`, `vehicle`, `relief`, `aftermath`) must be unchanged**. A red one is a defect: a missile path firing in a frame where nothing fires;
    - `combat` is report-only and is expected to move. Quote its numbers in the PR body, not as a verdict.
  - If a bless is needed at all, it happens **after merge, from CI's numbers only**, through `visual-baseline-bless`, with a `--reason` naming GH-250. No bless is budgeted.
  - A job that never starts is the Actions billing block: read the run annotation first.
- [ ] **Step 6: Falsify, commit.** Mutation: set `ATGM_LAYER_FLOORS.missiles.minDiffPixels = 0`, and the new test goes red. Commit the three paths with the message `feat(tools): the ATGM after-set, the missiles floor, and the shells bullet (GH-250 T7)`. The body quotes:
  - the before and after `inFlight` rung counts per subject;
  - the three toggle readings and the floor;
  - the `env` line.

---

## Execution order

| Order | Task | Model | Depends on | Touches `ThreeRenderer.ts` |
|---|---|---|---|---|
| 0 | Entry, approval, baseline | coordinator | — | no |
| 1 | Instrument + **before-set** | opus | 0 | no |
| 2 | Flight model | sonnet | 0 (numbers) | no |
| 3 | Trail, glow, writers | sonnet | 2 | no |
| 4 | Emitter data | sonnet | 0 (numbers) | no |
| 5 | Extraction + `MissileFx` | sonnet | 2, 3 | no |
| 6 | Wiring | opus | 1 (before-set taken), 4, 5 | **yes, the only one** |
| 7 | After-set, floor, doc, gate | opus | 6 | no |

Task 1's before-set must be taken before Task 6 changes what the renderer draws. Tasks 2 and 4 can run in parallel after Task 0, and Task 3 follows 2. Nothing touches `ThreeRenderer.ts` until Task 6, which rebases first if the ground lane has landed. The final whole-branch review (opus) reads the diff against the spec's D1–D9 and the invariant diff.

## Out of scope

- Any `packages/sim` change, including a faster ATGM (spec Q1).
- Pixi.
- Game-speed-aware FX.
- A gated missile scenario.
- A `flight` schema field (Q2).
- Sound.
- GPU additive blending.
- Growing `FLASH_CAPACITY`: missiles add a light a launch and a light an impact, the same order as today's muzzle flashes.
