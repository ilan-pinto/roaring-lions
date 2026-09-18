# Infantry Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mesh infantry blend between clips instead of cutting, die by playing their supplied fall (or a generic per-figure topple when the asset has none), and the three sliding crews stand up and walk.

**Architecture:** Every change is renderer or art pipeline. `mesh-clip.ts` gains an owned weight ramp and a per-clip scale signature that decides cut-vs-blend from the bytes; `mesh-death.ts` gains three phases (`falling`, `toppling`, `settling`) in front of the existing wreck handoff and loses the fade for anything that becomes a wreck; two new canonical clips `fall`/`fallAlt` are bound by the four Meshy importers; `rig.py` grows a third root per crew figure so a kneeling crew walks standing. Gates: a node-side clip test suite, a fall gate in the existing gait sweep, the importers' own build-time semantics check, a live capture sheet, and a perf re-measure.

**Tech Stack:** TypeScript (three.js `AnimationMixer`/`AnimationAction`, vitest in `environment: 'node'`), Python inside Blender 5.2 (`bpy`, `mathutils`), Playwright for the capture sheet, `pnpm` scripts.

**Spec:** `docs/superpowers/specs/2026-09-17-infantry-animation-design.md` — read it first; every task below cites its decision (D1–D6) and gate number (§4).

## Global Constraints

- **Nothing in `packages/sim` changes.** No new event, no tuning constant, no read of `rng(entityId)`. `pnpm test:determinism`, `pnpm playtest` and `pnpm balance` must be byte-identical before and after (Task 11 runs all three).
- `three` is imported only under `packages/render/src/three/**`. `mesh-anim.ts` must keep importing no three.js (`tools/src/mesh_gait.test.ts` pins that on its bytes) — every helper that touches `THREE.AnimationClip` lives in `mesh-clip.ts` or `mesh-death.ts`.
- Constants, verbatim from the spec: `MESH_CLIP_FADE_SECONDS = 0.15`; `TOPPLE_SECONDS = 0.5`, angle 90°, ease `p²`; `TOPPLE_STAGGER_SECONDS = 0.1`; importer `FALL_STAGGER_S = 0.1`; fall gate: hips horizontal travel `< 0.05 m`, first-frame hips height within 10 % of `idle`'s, last-frame hips height `<= 0.35 m`, duration `0.5–2.0 s`, last frame vs paired wreck: hips within `0.01 m`, every live joint rotation within `1°`.
- Canonical clip vocabulary after Task 3: `idle, move, fire, down, wreck, work, moveFire, wreckAlt, fall, fallAlt`. Only `mesh-death.ts` ever asks for `fall`/`fallAlt`; `resolveClip` is untouched.
- Every new gate arrives with its falsification RUN and named in the commit message (CLAUDE.md, "Every check gets an input that makes it fail").
- Git in this worktree: `/usr/bin/git` by absolute path, ONE plain git command per Bash call, explicit paths, never `-A`, never stash. Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never kill a dev server you did not start (`stopDevServer` only kills the child it spawned). Scratch files go under the session scratchpad, captures under `.superpowers/art-captures/infantry-anim/` (gitignored).
- Blender is `/Applications/Blender.app/Contents/MacOS/Blender`. The Meshy sources are gitignored and live only in the main checkout: from this worktree, `art/blend` must be a symlink to `/Users/ilpinto/dev/roaring-lions/art/blend` (Task 6 makes it).
- Post-export order is load-bearing: `pnpm gait:meshes` (writes `rl_gait` into `art/meshes/`) THEN `pnpm encode:meshes` (mirrors into `assets/meshes/`). A re-imported GLB has lost its `rl_gait` and must go through both again.
- Task 9 halts for the project lead's numbers before Blender renders anything. The `blender-art` agent takes that approval from the lead directly.

---

## File structure

| file | responsibility after this plan |
|---|---|
| `packages/render/src/three/units/mesh-clip.ts` | `ClipPlayer` (now with `clipScale`, `fades`), `scaleSignature`, `transitionIsCut`, `applyMeshClip` (blend or cut, `once`, `cut`), `advanceMeshClipFades` |
| `packages/render/src/three/units/mesh-clip.test.ts` | NEW — gates 1–2 |
| `packages/render/src/three/units/mesh-fixture.ts` | fixture grows `scaleClips` and `rootOffset` so a test can author a scale-swap rig with an offset figure root |
| `packages/render/src/three/units/mesh-unit.ts` | template carries `clipScale`; entity carries `clipScale` + `fades` |
| `packages/render/src/three/units/mesh-vehicle.ts` | same two fields on the vehicle template/entity |
| `packages/render/src/three/units/mesh-anim.ts` | vocabulary + `pickDeathClips` pair (no three.js import, unchanged rule) |
| `packages/render/src/sheet.ts` | `ClipName` union gains `fall`, `fallAlt` |
| `packages/render/src/three/units/mesh-death.ts` | phases `falling`/`toppling`/`fading`/`settling`; topple math (`toppleAngle`, `toppleDirection`, `liveFigureRoots`, `beginTopple`, `applyTopple`, `yawCorpseRoots`); D4 |
| `packages/render/src/three/ThreeRenderer.ts` | `killerX`/`killerY` written in `onEvents`, read in the prune loop; `advanceMeshClipFades` before both draw loops' `mixer.update` |
| `packages/render/src/three/units/mesh-evac.ts`, `mesh-vehicle-death.ts` | `advanceMeshClipFades` before their `mixer.update` |
| `tools/src/mesh_gait.ts` | NEW exports `measureRootTravel`, `measureJointPoses`, `rotationDeltaDeg`, `clipSeconds` |
| `tools/src/mesh_gait.test.ts` | fall clips exempt from facing sweeps; new `describe('mesh unit death -- the fall clips')` (gate 3); `GAIT_EXEMPT` shrinks to `moto_rpg`; counts 12→15, 15→18 |
| `tools/import_meshy_soldier.py`, `tools/import_meshy_soldier_irregular.py`, `tools/import_meshy_yahalom.py`, `tools/units/import_meshy_rpg_team.py` | bind `fall` (+`fallAlt` where a second fall exists), horizontal hips hold, per-figure stagger, semantics rows |
| `tools/units/rig.py` | `move_posture="standing"` figures get a walker under `{prefix}w_root`; visibility keys the third root; `prop` hidden on `move` |
| `tools/src/perf/death-captures.ts` | NEW — the before/after capture sheet (gate 9) |
| `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` | v4 section |
| `CLAUDE.md`, `docs/PERFORMANCE.md` | the death bullet and the crew-served line go current; perf entry |

---

### Task 1: The "before" instruments — capture sheet and perf reading, taken before any runtime change

**Files:**
- Create: `tools/src/perf/death-captures.ts`
- Output (gitignored): `.superpowers/art-captures/infantry-anim/before/`, `.superpowers/perf-before.json`

**Interfaces:**
- Consumes: `ensureDevServer(port, repoRoot, tag)`, `stopDevServer(child, tag)` from `tools/src/golden-diff/browser.ts`; `FREEZE_FRAME_LOOP_SCRIPT` from `tools/src/golden-diff/capture-protocol.ts`; the sandbox console API `window.__lions` (`step`, `sim.spawn`, `sim.debugKill`, `sim.queueCommand`, `renderer.frame`, `renderer.camera`, `renderer.worldToScreen`, `renderer.meshUnitEntities`).
- Produces: `npx tsx tools/src/perf/death-captures.ts --label=<before|after> [--out=<dir>] [--only=<type>]` writing `<out>/<label>/*.png` and `<out>/<label>/sheet.md`. Task 11 runs it again with `--label=after`.

The script is the same shape as `tools/src/perf/gait-captures.ts` (read its header comment first: it explains why the frame loop is frozen, why `__lions` must never be lost to a page reload, and why every `page.evaluate` is one call rather than one per tick). Differences: it starts its own dev server on 5179 through `ensureDevServer` (reusing one already there), it photographs a TIME SERIES after a kill rather than one phase of a gait, and it has no request interception — "before" here is the working tree at the branch base, which is why this task runs first.

- [ ] **Step 1: Write the capture script**

```ts
// tools/src/perf/death-captures.ts
/**
 * Death and crew-walk capture sheet for the infantry-animation branch
 * (docs/superpowers/specs/2026-09-17-infantry-animation-design.md, gate 9).
 *
 * Same skeleton as `gait-captures.ts` (read that file's header first):
 * the live renderer on a sandbox, frame loop frozen, one `page.evaluate`
 * per step. What differs: each death subject is killed with
 * `sim.debugKill` (or, for the `killed` subject, by a real enemy) and then
 * photographed at fixed times after death by advancing
 * `renderer.frame(1, FRAME_MS)` by hand, since the death sequence runs on
 * the FRAME clock, not the tick clock. Nothing is intercepted: run it once
 * at the branch base with `--label=before` and once at the head with
 * `--label=after`.
 *
 *   npx tsx tools/src/perf/death-captures.ts --label=before
 *   npx tsx tools/src/perf/death-captures.ts --label=after --only=inf_squad
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { FREEZE_FRAME_LOOP_SCRIPT } from '../golden-diff/capture-protocol';

const PORT = 5179;
const VIEWPORT = { width: 1400, height: 900 } as const;
const ZOOMS = [1.0, 2.5] as const;
const CLOSE_CROP = { width: 600, height: 400 } as const;
const CLOSE_CROP_LIFT_PX = 50;
/** Seconds after death at which a frame is photographed. */
const SAMPLE_SECONDS = [0, 0.15, 0.25, 0.5, 1.0, 1.5] as const;
const FRAME_MS = 16;
const SUBJECT_Y = 7;
const MESH_WAIT_MS = 300000;
const STEP_TIMEOUT_MS = 120000;
const WALK_SETTLE_TICKS = 40;
const KILL_TICK_CAP = 600;

interface Subject {
  readonly id: string;
  readonly x: number;
  readonly bodies: number;
  readonly mode: 'death' | 'walk' | 'killed';
}

const SUBJECTS: readonly Subject[] = [
  { id: 'inf_squad', x: 4, bodies: 1, mode: 'death' },
  { id: 'sarim_rifles', x: 8, bodies: 2, mode: 'death' }, // two entities: both fall variants
  { id: 'yahalom_squad', x: 13, bodies: 1, mode: 'death' },
  { id: 'rpg_team', x: 17, bodies: 1, mode: 'death' },
  { id: 'militia_cell', x: 21, bodies: 1, mode: 'death' }, // kit rig: the topple
  { id: 'civilians', x: 25, bodies: 1, mode: 'death' }, // topple then fade, no wreck
  { id: 'sniper_team', x: 29, bodies: 1, mode: 'death' }, // already down
  { id: 'moto_rpg', x: 33, bodies: 1, mode: 'death' },
  { id: 'inf_squad', x: 37, bodies: 1, mode: 'killed' }, // a real killer: direction
  { id: 'atgm_cell', x: 41, bodies: 1, mode: 'walk' },
  { id: 'mortar_crew', x: 44, bodies: 1, mode: 'walk' },
  { id: 'digger_crew', x: 47, bodies: 1, mode: 'walk' },
];
const KILLER_TYPE = 'mbt_lavi';

interface LionsWindow {
  __lions: {
    step(n: number): number;
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      meshUnitEntities: Map<number, { currentClip: string | null; actions: Map<string, unknown> }>;
      meshDying?: { entityId: number; phase?: string; entity: { currentClip: string | null } }[];
    };
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array; posX: Int32Array; posY: Int32Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      debugKill(id: number): void;
      queueCommand(cmd: { kind: string; ids: number[]; x?: number; y?: number }): void;
    };
  };
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const label = arg('label', '');
if (label !== 'before' && label !== 'after') throw new Error('--label=before|after is required');
const outRoot = arg('out', path.join(process.cwd(), '.superpowers', 'art-captures', 'infantry-anim'));
const out = path.join(outRoot, label);
const only = arg('only', '');
const wanted = only ? SUBJECTS.filter((s) => s.id === only) : SUBJECTS;
if (wanted.length === 0) throw new Error(`--only=${only} names no subject`);
fs.mkdirSync(out, { recursive: true });

interface Cell {
  subject: string;
  mode: string;
  entity: number;
  seconds: number;
  zoom: number;
  clip: string | null;
  phase: string | null;
  file: string;
}
const cells: Cell[] = [];
const notes: string[] = [];

interface Placed {
  subject: Subject;
  ids: number[];
  killer: number | null;
}

async function spawnAll(page: Page): Promise<Placed[]> {
  return page.evaluate(
    ([rows, killerType, y]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const FIXED = 65536;
      const out: { subject: (typeof rows)[number]; ids: number[]; killer: number | null }[] = [];
      for (const row of rows) {
        const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === row.id);
        if (typeIdx < 0) throw new Error(`no unit type "${row.id}" in this build`);
        const ids: number[] = [];
        for (let b = 0; b < row.bodies; b++) ids.push(L.sim.spawn(typeIdx, 0, (row.x + b) * FIXED, y * FIXED));
        let killer: number | null = null;
        if (row.mode === 'killed') {
          const kIdx = L.sim.unitTypes.findIndex((t) => t.id === killerType);
          if (kIdx < 0) throw new Error(`no unit type "${killerType}" in this build`);
          killer = L.sim.spawn(kIdx, 1, row.x * FIXED, (y - 3) * FIXED);
        }
        out.push({ subject: row, ids, killer });
      }
      return out;
    },
    [wanted, KILLER_TYPE, SUBJECT_Y] as const
  );
}

async function waitForMeshes(page: Page, ids: number[]): Promise<void> {
  const deadline = Date.now() + MESH_WAIT_MS;
  let first = true;
  for (;;) {
    const missing = await page.evaluate(
      ([want, tick]) => {
        const L = (window as unknown as LionsWindow).__lions;
        if (tick) L.step(20);
        return want.filter((id) => {
          const e = L.renderer.meshUnitEntities.get(id);
          return !e || e.actions.size === 0;
        });
      },
      [ids, !first] as const
    );
    first = false;
    if (missing.length === 0) return;
    if (Date.now() > deadline) {
      notes.push(`entities ${missing.join(', ')} never got a mesh -- captured anyway`);
      return;
    }
    await page.waitForTimeout(400);
  }
}

/** Frame the camera on `id` at `zoom`, repaint, and report what the renderer holds for it. */
async function frameOn(page: Page, id: number, zoom: number, bodies: number) {
  return page.evaluate(
    ([e, z, n]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const FIXED = 65536;
      const wx = L.sim.state.posX[e] / FIXED;
      const wy = L.sim.state.posY[e] / FIXED;
      const c = L.renderer.camera;
      c.x = wx + (n - 1) / 2;
      c.y = wy;
      c.zoom = z;
      L.renderer.frame(1, 0);
      const live = L.renderer.meshUnitEntities.get(e);
      const dying = L.renderer.meshDying?.find((d) => d.entityId === e);
      const screen = L.renderer.worldToScreen(wx, wy);
      return {
        clip: live?.currentClip ?? dying?.entity.currentClip ?? null,
        phase: dying?.phase ?? (dying ? 'dying' : live ? 'alive' : 'gone'),
        screenX: screen.x,
        screenY: screen.y,
      };
    },
    [id, zoom, bodies] as const
  );
}

async function shoot(page: Page, p: Placed, seconds: number): Promise<void> {
  for (const zoom of ZOOMS) {
    const state = await frameOn(page, p.ids[0], zoom, p.subject.bodies);
    const name = `${p.subject.id}-${p.subject.mode}-${seconds.toFixed(2)}s-${label}-z${zoom}.png`;
    const clip =
      zoom === Math.max(...ZOOMS)
        ? {
            x: Math.min(Math.max(0, state.screenX - CLOSE_CROP.width / 2), VIEWPORT.width - CLOSE_CROP.width),
            y: Math.min(
              Math.max(0, state.screenY - CLOSE_CROP.height / 2 - CLOSE_CROP_LIFT_PX),
              VIEWPORT.height - CLOSE_CROP.height
            ),
            width: CLOSE_CROP.width,
            height: CLOSE_CROP.height,
          }
        : undefined;
    await page.screenshot({ path: path.join(out, name), ...(clip ? { clip } : {}) });
    cells.push({
      subject: p.subject.id,
      mode: p.subject.mode,
      entity: p.ids[0],
      seconds,
      zoom,
      clip: state.clip,
      phase: state.phase,
      file: name,
    });
    console.log(`  saved ${name}  clip=${state.clip} phase=${state.phase}`);
  }
}

/** Advance the renderer's own frame clock by `ms`, in FRAME_MS steps. */
async function advanceFrames(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    ([total, step]) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (let done = 0; done < total; done += step) L.renderer.frame(1, Math.min(step, total - done));
    },
    [ms, FRAME_MS] as const
  );
}

async function captureDeath(page: Page, p: Placed): Promise<void> {
  const id = p.ids[0];
  if (p.subject.mode === 'killed') {
    const ticks = await page.evaluate(
      ([e, cap]) => {
        const L = (window as unknown as LionsWindow).__lions;
        let n = 0;
        while (L.sim.state.alive[e] !== 0 && n < cap) {
          L.step(1);
          n++;
        }
        return n;
      },
      [id, KILL_TICK_CAP] as const
    );
    if (ticks >= KILL_TICK_CAP) {
      notes.push(`${p.subject.id} (killed): the ${KILLER_TYPE} never killed it in ${KILL_TICK_CAP} ticks`);
      return;
    }
    console.log(`  ${p.subject.id}: killed by ${KILLER_TYPE} after ${ticks} ticks`);
  } else {
    await page.evaluate((e) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (const each of e) L.sim.debugKill(each);
      L.step(1);
    }, p.ids);
  }
  let elapsed = 0;
  for (const s of SAMPLE_SECONDS) {
    const ms = Math.round(s * 1000) - elapsed;
    if (ms > 0) await advanceFrames(page, ms);
    elapsed += Math.max(0, ms);
    await shoot(page, p, s);
  }
}

async function captureWalk(page: Page, p: Placed): Promise<void> {
  await page.evaluate(
    ([ids, n]) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (const id of ids) L.sim.queueCommand({ kind: 'move', ids: [id], x: L.sim.state.posX[id], y: 0 });
      L.step(n);
    },
    [p.ids, WALK_SETTLE_TICKS] as const
  );
  await shoot(page, p, 0);
}

function writeIndex(): void {
  const lines = [
    `# Infantry animation capture sheet -- ${label}`,
    ``,
    `Live three.js renderer, ${VIEWPORT.width}x${VIEWPORT.height}, frame loop frozen, deaths advanced by`,
    `\`renderer.frame(1, ${FRAME_MS})\` from the tick the kill landed. z${Math.max(...ZOOMS)} cells are cropped`,
    `${CLOSE_CROP.width}x${CLOSE_CROP.height} around the subject.`,
    ``,
    `| subject | mode | t (s) | zoom | clip | phase | file |`,
    `|---|---|---|---|---|---|---|`,
    ...cells.map(
      (c) => `| \`${c.subject}\` | ${c.mode} | ${c.seconds.toFixed(2)} | ${c.zoom} | ${c.clip ?? '—'} | ${c.phase ?? '—'} | \`${c.file}\` |`
    ),
  ];
  if (notes.length) lines.push(``, `## Notes`, ``, ...notes.map((n) => `- ${n}`));
  fs.writeFileSync(path.join(out, 'sheet.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'sheet.json'), JSON.stringify({ label, cells, notes }, null, 2) + '\n');
  console.log(`index at ${path.join(out, 'sheet.md')}`);
}

async function main(): Promise<void> {
  const server = await ensureDevServer(PORT, process.cwd(), 'death-captures');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.on('pageerror', (err) => console.log('  page error:', err.message));
    await page.goto(`http://localhost:${PORT}/?sandbox=beit_sahwan_outskirts`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer);
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    const placed = await spawnAll(page);
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(1));
    await waitForMeshes(page, placed.flatMap((p) => p.ids));
    for (const p of placed) {
      console.log(`${label}: ${p.subject.id} (${p.subject.mode}) entity ${p.ids[0]}`);
      if (p.subject.mode === 'walk') await captureWalk(page, p);
      else await captureDeath(page, p);
    }
    writeIndex();
    await page.close();
  } finally {
    await browser.close();
    stopDevServer(server, 'death-captures');
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
```

- [ ] **Step 2: Typecheck the script**

Run: `pnpm --filter @lions/tools exec tsc --noEmit -p .` (the tools package's own typecheck; if the package has no `tsconfig` target for this, `pnpm typecheck` from the root covers it).
Expected: no errors in `death-captures.ts`.

- [ ] **Step 3: Run the BEFORE capture**

Run: `npx tsx tools/src/perf/death-captures.ts --label=before`
Expected: a dev server on 5179 starts (or is reused), `.superpowers/art-captures/infantry-anim/before/` holds 2 PNGs per (subject, sample) — 9 death subjects × 6 samples × 2 zooms = 108, plus 3 walk × 2 = 6 — and `sheet.md`. Open three cells (`inf_squad-death-0.25s`, `militia_cell-death-0.50s`, `atgm_cell-walk`) and confirm they show the instant swap and the sliding crew the spec describes. If the `killed` subject never dies, the note appears in `sheet.md`; leave it.

- [ ] **Step 4: Take the BEFORE perf reading**

Run: `npx tsx tools/src/perf/backend-curve-gate.ts --port=5190 --out=.superpowers/perf-before.json`
Expected: the JSON lands. Record the 300-checkpoint `render p95` for `measureThreeMesh` in your task report (read `docs/PERFORMANCE.md` §"How to reproduce" and §"Capture conditions" first: the number is only valid with the hardware GPU confirmed, which the gate prints).

- [ ] **Step 5: Commit the script**

```bash
/usr/bin/git add tools/src/perf/death-captures.ts
```
```bash
/usr/bin/git commit -m "tools: death/crew capture sheet, and the before sheet is taken

Photographs each Meshy biped, a kit rig, a civilian, the sniper and the
motorcycle at 0/0.15/0.25/0.5/1.0/1.5 s after a debugKill (plus one real
kill for the direction), and the three crews ordered to move, at zoom 1
and 2.5. Run once now at the branch base; Task 11 runs it again.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 2: Crossfades with an owned weight ramp, and the scale-signature cut (D1, D2; gates 1–2)

**Files:**
- Modify: `packages/render/src/three/units/mesh-clip.ts` (whole file rewritten below)
- Modify: `packages/render/src/three/units/mesh-fixture.ts:110-228` (`scaleClips`, `rootOffset`)
- Modify: `packages/render/src/three/units/mesh-unit.ts:61-84` (template field), `:107-170` (compute it), `:213-225` (entity fields)
- Modify: `packages/render/src/three/units/mesh-vehicle.ts:140-150` (template field), `:412-431` (compute), `:520-582` (entity fields)
- Modify: `packages/render/src/three/ThreeRenderer.ts:4621-4626`, `:5072-5075` (call `advanceMeshClipFades` before `mixer.update`)
- Modify: `packages/render/src/three/units/mesh-death.ts:384-386, 404-406`, `mesh-evac.ts:154-156`, `mesh-vehicle-death.ts:204-206, 223-225` (same call)
- Create: `packages/render/src/three/units/mesh-clip.test.ts`
- Modify: `packages/render/src/three/units/mesh-vehicle-shipped.test.ts` (one new `it`)

**Interfaces:**
- Produces: `MESH_CLIP_FADE_SECONDS`, `SCALE_ANIMATED`, `interface ClipFade { from; to; t }`, `ClipPlayer` with `readonly clipScale: ReadonlyMap<ClipName, string | null>` and `readonly fades: Map<ClipName, ClipFade>`, `scaleSignature(clip: THREE.AnimationClip): string | null`, `clipScaleSignatures(clips: ReadonlyMap<ClipName, THREE.AnimationClip>): ReadonlyMap<ClipName, string | null>`, `transitionIsCut(from, to): boolean`, `applyMeshClip(player, desired, opts?: { once?: boolean; cut?: boolean })`, `advanceMeshClipFades(player, dtSeconds)`. `MeshUnitTemplate.clipScale`, `VehicleMeshTemplate.clipScale`. Fixture opts `scaleClips?: Record<string, { root: number; deathRoot: number }>`, `rootOffset?: [number, number, number]`.
- Tasks 4–5 rely on `cut: true` and on `clipScale` on the entity.

Why the ramp is owned rather than `AnimationAction.fadeIn`: read from three.js's source, `fadeIn(d)` is `_scheduleFading(d, 0, 1)`, which sets the interpolant's first sample to weight ZERO at `mixer.time`; and `PropertyMixer.apply` mixes the accumulated pose toward the binding's ORIGINAL (bind-pose) value by `1 − cumulativeWeight`. A clip re-selected while still fading out would therefore drop the summed weight below 1 for a few frames and blend a Meshy biped toward its T-pose. Gate 1 pins the sum at exactly 1 across a re-selection.

- [ ] **Step 1: Extend the fixture so a test can author a scale-swap rig with an offset root**

In `mesh-fixture.ts`, add two options to `buildFixtureGlb`'s `opts` type, after `sceneExtras`:

```ts
  /**
   * Per clip, a constant scale to key on the root joint and on a third,
   * PARENTLESS `death_root` joint -- the bone-scale swap every kit rig,
   * the sniper, the Meshy mortar team and every vehicle use to switch
   * geometry sets. Any clip named here gets two STEP scale channels; the
   * `death_root` node and its third inverse-bind matrix exist only when
   * this is non-empty, so every caller that omits it is byte-identical to
   * before. Added for `mesh-clip.test.ts` (D2) and the topple tests.
   */
  scaleClips?: Record<string, { root: number; deathRoot: number }>;
  /**
   * Where the root joint (and `death_root`) stand, in metres -- default the
   * origin. A topple pivots each figure about ITS OWN feet, and a fixture
   * whose only figure stands on the entity origin cannot tell that apart
   * from pivoting on the entity root. The inverse-bind matrices follow it.
   */
  rootOffset?: [number, number, number];
```

Then replace everything from `const inverseBind = f32([` down to the closing `return packGlb(json, bytes);` with:

```ts
  const off = opts.rootOffset ?? [0, 0, 0];
  const scaleClips = opts.scaleClips ?? {};
  const hasDeathRoot = Object.keys(scaleClips).length > 0;
  // Column-major translate(x, y, z).
  const tr = (x: number, y: number, z: number): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  // bone0 (root) at `off`; bone1 at `off + (0,1,0)`; death_root at `off`.
  const inverseBind = f32([
    ...tr(-off[0], -off[1], -off[2]),
    ...tr(-off[0], -off[1] - 1, -off[2]),
    ...(hasDeathRoot ? tr(-off[0], -off[1], -off[2]) : []),
  ]);
  const animInput = f32([0, clipSeconds]);
  // Quaternion (x,y,z,w): identity, then 90 deg about X.
  const HALF = Math.SQRT1_2;
  const animOutput = f32([0, 0, 0, 1, HALF, 0, 0, HALF]);
  // One VEC3 pair (same value at both keys) per (clip, joint) scale channel.
  const scaleParts: Uint8Array[] = [];
  const scaleAccessorOf = new Map<string, number>();
  for (const [clip, s] of Object.entries(scaleClips)) {
    for (const [which, v] of [
      ['root', s.root],
      ['deathRoot', s.deathRoot],
    ] as const) {
      scaleAccessorOf.set(`${clip}:${which}`, 8 + scaleParts.length);
      scaleParts.push(f32([v, v, v, v, v, v]));
    }
  }

  const { bytes, views } = packBufferViews([
    position,
    normal,
    joints,
    weights,
    indices,
    inverseBind,
    animInput,
    animOutput,
    ...scaleParts,
  ]);

  const bufferViews = views.map((v) => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength }));

  const accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.1, 1, 0], max: [0.1, 1, 0.2] }, // 0 POSITION
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }, // 1 NORMAL
    { bufferView: 2, componentType: 5123, count: 3, type: 'VEC4' }, // 2 JOINTS_0
    { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' }, // 3 WEIGHTS_0
    { bufferView: 4, componentType: 5123, count: 3, type: 'SCALAR' }, // 4 indices
    { bufferView: 5, componentType: 5126, count: hasDeathRoot ? 3 : 2, type: 'MAT4' }, // 5 inverseBindMatrices
    { bufferView: 6, componentType: 5126, count: 2, type: 'SCALAR' }, // 6 anim input
    { bufferView: 7, componentType: 5126, count: 2, type: 'VEC4' }, // 7 anim output
    ...scaleParts.map((_, i) => ({ bufferView: 8 + i, componentType: 5126, count: 2, type: 'VEC3' })),
  ];

  const nodeExtras: Record<string, unknown> = {};
  if (extrasRole !== null) nodeExtras.rl_role = extrasRole;
  const rootNode: Record<string, unknown> = { name: 'root_joint', children: [1] };
  if (opts.rootOffset) rootNode.translation = off;

  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.byteLength }],
    bufferViews,
    accessors,
    meshes: [
      {
        name: 'fixture-mesh',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 },
            indices: 4,
          },
        ],
      },
    ],
    skins: [{ joints: hasDeathRoot ? [0, 1, 3] : [0, 1], inverseBindMatrices: 5 }],
    nodes: [
      rootNode,
      { name: 'bone1', translation: [0, 1, 0] },
      {
        name: nameRole ?? '',
        mesh: 0,
        skin: 0,
        ...(Object.keys(nodeExtras).length > 0 ? { extras: nodeExtras } : {}),
      },
      ...(hasDeathRoot ? [{ name: 'death_root', translation: off }] : []),
    ],
    scenes: [
      {
        nodes: hasDeathRoot ? [0, 2, 3] : [0, 2],
        ...(opts.sceneExtras !== undefined ? { extras: opts.sceneExtras } : {}),
      },
    ],
    scene: 0,
    animations: clipNames.map((name) => {
      const s = scaleClips[name];
      const channels: { sampler: number; target: { node: number; path: string } }[] = [
        { sampler: 0, target: { node: 1, path: 'rotation' } },
      ];
      const samplers: { input: number; output: number; interpolation: string }[] = [
        { input: 6, output: 7, interpolation: 'LINEAR' },
      ];
      if (s) {
        samplers.push({ input: 6, output: scaleAccessorOf.get(`${name}:root`) as number, interpolation: 'STEP' });
        channels.push({ sampler: 1, target: { node: 0, path: 'scale' } });
        samplers.push({ input: 6, output: scaleAccessorOf.get(`${name}:deathRoot`) as number, interpolation: 'STEP' });
        channels.push({ sampler: 2, target: { node: 3, path: 'scale' } });
      }
      return { name, channels, samplers };
    }),
  };

  return packGlb(json, bytes);
```

Run: `pnpm --filter @lions/render test -- mesh-unit mesh-death mesh-evac fire-latch gait`
Expected: PASS — no caller passes the new options, so every existing fixture is byte-identical.

- [ ] **Step 2: Write the failing tests for the ramp and the cut**

Create `packages/render/src/three/units/mesh-clip.test.ts`:

```ts
/**
 * `mesh-clip.ts` -- the owned crossfade ramp (D1) and the scale-signature
 * cut (D2). `environment: 'node'`; every action here is a real
 * `THREE.AnimationAction` on a real `AnimationMixer` bound to a parsed
 * fixture GLB, so `getEffectiveWeight` and `isRunning` are three.js's own.
 *
 * Falsifications, each run by hand and reverted (named in the commit):
 *   - ramp -> `action.fadeIn`: 'sum of weights is 1 across a re-selection' reads < 1
 *   - drop the signature comparison in `applyMeshClip`: 'a scale swap cuts' sees weight 0.5
 *   - `advanceMeshClipFades` never calls `stop()`: 'outgoing action is stopped at the end' fails
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildMeshUnitTemplate, instantiateMeshUnit, type MeshUnitEntity } from './mesh-unit';
import { parseFixture } from './mesh-fixture';
import {
  MESH_CLIP_FADE_SECONDS,
  SCALE_ANIMATED,
  applyMeshClip,
  advanceMeshClipFades,
  scaleSignature,
  transitionIsCut,
} from './mesh-clip';

async function entityWith(opts: Parameters<typeof parseFixture>[0]): Promise<MeshUnitEntity> {
  const gltf = await parseFixture({ roleName: 'uniform', ...opts });
  return instantiateMeshUnit(buildMeshUnitTemplate(gltf, 'kdf'), 'inf_squad');
}

function weight(e: MeshUnitEntity, name: string): number {
  const a = e.actions.get(name as never);
  return a ? a.getEffectiveWeight() : 0;
}

function sumOfWeights(e: MeshUnitEntity): number {
  let s = 0;
  for (const a of e.actions.values()) if (a.isRunning()) s += a.getEffectiveWeight();
  return s;
}

/** One frame: ramps, then the mixer, exactly the order every call site uses. */
function frame(e: MeshUnitEntity, dt: number): void {
  advanceMeshClipFades(e, dt);
  e.mixer.update(dt);
}

describe('scaleSignature', () => {
  const track = (name: string, values: number[]) =>
    new THREE.VectorKeyframeTrack(name, [0, 1], values);
  it('is null for a clip with no scale track', () => {
    const clip = new THREE.AnimationClip('idle', 1, [new THREE.QuaternionKeyframeTrack('b.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
    expect(scaleSignature(clip)).toBeNull();
  });
  it('names every constant scale track and its value, sorted', () => {
    const clip = new THREE.AnimationClip('down', 1, [track('root.scale', [0, 0, 0, 0, 0, 0]), track('death_root.scale', [1, 1, 1, 1, 1, 1])]);
    expect(scaleSignature(clip)).toBe('death_root.scale=1.000;root.scale=0.000');
  });
  it('reads a scale track whose value changes as animated', () => {
    const clip = new THREE.AnimationClip('x', 1, [track('root.scale', [1, 1, 1, 0.5, 0.5, 0.5])]);
    expect(scaleSignature(clip)).toBe(SCALE_ANIMATED);
  });
});

describe('transitionIsCut', () => {
  it('blends two scale-free clips, and two clips keying the same scales', () => {
    expect(transitionIsCut(null, null)).toBe(false);
    expect(transitionIsCut('root.scale=1.000', 'root.scale=1.000')).toBe(false);
  });
  it('cuts when the signatures differ, when either is animated, and when there is no previous clip', () => {
    expect(transitionIsCut('root.scale=1.000', 'root.scale=0.000')).toBe(true);
    expect(transitionIsCut(null, 'root.scale=0.000')).toBe(true);
    expect(transitionIsCut(SCALE_ANIMATED, SCALE_ANIMATED)).toBe(true);
    expect(transitionIsCut(undefined, null)).toBe(true);
  });
});

describe('applyMeshClip -- the crossfade (D1)', () => {
  it('ramps the incoming clip 0 -> 1 and the outgoing 1 -> 0 over MESH_CLIP_FADE_SECONDS', async () => {
    const e = await entityWith({ clipName: ['idle', 'move'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'move');
    expect(e.currentClip).toBe('move');
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'idle')).toBeCloseTo(0.5, 6);
    expect(weight(e, 'move')).toBeCloseTo(0.5, 6);
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'move')).toBeCloseTo(1, 6);
    expect(e.actions.get('idle')?.isRunning()).toBe(false); // outgoing action is stopped at the end
    expect(e.fades.size).toBe(0);
  });

  it('keeps the sum of running weights at exactly 1 across a re-selection mid-fade', async () => {
    const e = await entityWith({ clipName: ['idle', 'move', 'fire'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'move');
    frame(e, 0.05); // idle 2/3, move 1/3
    applyMeshClip(e, 'idle'); // re-select the clip that is fading out
    for (let i = 0; i < 12; i++) {
      frame(e, 0.025);
      expect(sumOfWeights(e)).toBeCloseTo(1, 6);
    }
    applyMeshClip(e, 'fire');
    frame(e, 0.02);
    applyMeshClip(e, 'move'); // three actions live at once
    for (let i = 0; i < 12; i++) {
      frame(e, 0.025);
      expect(sumOfWeights(e)).toBeCloseTo(1, 6);
    }
    expect(e.currentClip).toBe('move');
    expect(weight(e, 'move')).toBeCloseTo(1, 6);
  });

  it('a re-selected clip keeps its own time rather than restarting', async () => {
    const e = await entityWith({ clipName: ['idle', 'move'] });
    applyMeshClip(e, 'move');
    frame(e, 0.4);
    applyMeshClip(e, 'idle');
    frame(e, 0.05);
    const before = e.actions.get('move')?.time ?? -1;
    applyMeshClip(e, 'move');
    expect(e.actions.get('move')?.time).toBeCloseTo(before, 6);
  });

  it('plays the very first clip at weight 1 with no ramp', async () => {
    const e = await entityWith({ clipName: ['idle'] });
    applyMeshClip(e, 'idle');
    expect(weight(e, 'idle')).toBe(1);
    expect(e.fades.size).toBe(0);
  });

  it('a once clip is entered with the fade and still holds its last frame', async () => {
    const e = await entityWith({ clipName: ['idle', 'wreck'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'wreck', { once: true });
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'wreck')).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 20; i++) frame(e, 0.1);
    expect(e.actions.get('wreck')?.paused).toBe(true);
    expect(weight(e, 'wreck')).toBeCloseTo(1, 6);
  });
});

describe('applyMeshClip -- the cut (D2)', () => {
  it('a scale swap switches in one step: no intermediate weight, the outgoing action stopped', async () => {
    const e = await entityWith({
      clipName: ['idle', 'down'],
      scaleClips: { idle: { root: 1, deathRoot: 0 }, down: { root: 0, deathRoot: 1 } },
    });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'down');
    expect(weight(e, 'down')).toBe(1);
    expect(e.actions.get('idle')?.isRunning()).toBe(false);
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'down')).toBe(1); // a cut has nothing to ramp
  });

  it('two clips keying the SAME scales still blend', async () => {
    const e = await entityWith({
      clipName: ['idle', 'move'],
      scaleClips: { idle: { root: 1, deathRoot: 0 }, move: { root: 1, deathRoot: 0 } },
    });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'move');
    frame(e, MESH_CLIP_FADE_SECONDS / 2);
    expect(weight(e, 'move')).toBeCloseTo(0.5, 6);
  });

  it('`cut: true` forces the one-step switch on a scale-free pair', async () => {
    const e = await entityWith({ clipName: ['idle', 'wreck'] });
    applyMeshClip(e, 'idle');
    frame(e, 0.5);
    applyMeshClip(e, 'wreck', { once: true, cut: true });
    expect(weight(e, 'wreck')).toBe(1);
    expect(e.actions.get('idle')?.isRunning()).toBe(false);
  });

  it('the template carries one signature per clip, and the entity sees the same map', async () => {
    const gltf = await parseFixture({
      roleName: 'uniform',
      clipName: ['idle', 'down'],
      scaleClips: { idle: { root: 1, deathRoot: 0 }, down: { root: 0, deathRoot: 1 } },
    });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    expect(template.clipScale.get('idle')).toBe('death_root.scale=0.000;root_joint.scale=1.000');
    expect(template.clipScale.get('down')).toBe('death_root.scale=1.000;root_joint.scale=0.000');
    const e = instantiateMeshUnit(template, 'inf_squad');
    expect(e.clipScale).toBe(template.clipScale);
  });
});
```

- [ ] **Step 3: Run the new file and watch it fail**

Run: `pnpm --filter @lions/render test -- mesh-clip`
Expected: FAIL — `MESH_CLIP_FADE_SECONDS`, `scaleSignature`, `advanceMeshClipFades` are not exported; `template.clipScale` does not exist.

- [ ] **Step 4: Rewrite `mesh-clip.ts`**

Replace the file's contents below its top-of-file comment (keep that comment, and add the paragraph on why the ramp is owned) with:

```ts
import * as THREE from 'three';
import type { ClipName } from '../../sheet';
import { meshClipOrFallback } from './mesh-anim';

/** Design D1: one blend window for every transition that is not a cut. */
export const MESH_CLIP_FADE_SECONDS = 0.15;

/** `scaleSignature`'s answer for a clip whose scale is not constant --
 *  incomparable with anything, so every transition touching it is a cut. */
export const SCALE_ANIMATED = 'animated';

/** One weight ramp in flight: `from` at `t = 0`, `to` at
 *  `t = MESH_CLIP_FADE_SECONDS`, linear between. */
export interface ClipFade {
  from: number;
  to: number;
  t: number;
}

/**
 * The animation state `applyMeshClip` reads and writes. `MeshUnitEntity`
 * (infantry) and `VehicleMeshEntity` both satisfy it structurally.
 *
 * `clipScale` is computed ONCE per template at load (`clipScaleSignatures`)
 * and carried by reference; `fades` is per entity and usually empty. An
 * EMPTY `actions` map is a legitimate state (a vehicle GLB with no
 * animations) and leaves `applyMeshClip` a no-op -- see its `!next` guard.
 */
export interface ClipPlayer {
  readonly actions: ReadonlyMap<ClipName, THREE.AnimationAction>;
  currentClip: ClipName | null;
  readonly clipScale: ReadonlyMap<ClipName, string | null>;
  readonly fades: Map<ClipName, ClipFade>;
}

/**
 * Design D2's per-clip key. `null` when the clip keys no `.scale` track;
 * otherwise the sorted `trackName=value` list of its scale tracks, each of
 * which must be constant over the clip -- `SCALE_ANIMATED` if any is not.
 * Two clips with equal signatures show the same geometry set, so blending
 * between them cannot interpolate a scale swap.
 */
export function scaleSignature(clip: THREE.AnimationClip): string | null {
  const parts: string[] = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.scale')) continue;
    const v = track.values;
    const stride = track.times.length > 0 ? v.length / track.times.length : v.length;
    for (let i = stride; i < v.length; i++) {
      if (Math.abs(v[i] - v[i % stride]) > 1e-6) return SCALE_ANIMATED;
    }
    parts.push(`${track.name}=${v[0].toFixed(3)}`);
  }
  return parts.length === 0 ? null : parts.sort().join(';');
}

/** `scaleSignature` for every clip of a template, keyed like its clips. */
export function clipScaleSignatures(
  clips: ReadonlyMap<ClipName, THREE.AnimationClip>
): ReadonlyMap<ClipName, string | null> {
  const out = new Map<ClipName, string | null>();
  for (const [name, clip] of clips) out.set(name, scaleSignature(clip));
  return out;
}

/**
 * Whether switching from a clip with signature `from` to one with `to` must
 * be a hard cut. `undefined` means "no previous clip" (a fresh entity), and
 * that is a cut too: there is nothing to blend from.
 */
export function transitionIsCut(from: string | null | undefined, to: string | null | undefined): boolean {
  if (from === undefined || to === undefined) return true;
  if (from === SCALE_ANIMATED || to === SCALE_ANIMATED) return true;
  return from !== to;
}

function setLoop(action: THREE.AnimationAction, once: boolean): void {
  if (once) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  }
}

/**
 * Switches `player` to `desired`, falling back through `meshClipOrFallback`.
 * A no-op when the resolved clip is already `currentClip`.
 *
 * Two shapes. A CUT (`opts.cut`, or a first clip, or a scale-signature
 * change -- `transitionIsCut`) is the old behaviour verbatim: stop every
 * other action, `reset().play()` the new one at weight 1. A BLEND starts a
 * `ClipFade` on every action that carries weight -- each from its CURRENT
 * effective weight, all restarted together so their sum stays 1 -- and one
 * on the incoming action toward 1. A re-selected action that is still
 * fading out keeps its own clip time (no `reset()`); anything else is
 * reset. The ramps advance in `advanceMeshClipFades`, which every mixer
 * site calls right before `mixer.update`.
 *
 * `opts.once` keeps its meaning (`LoopOnce` + `clampWhenFinished`), and is
 * set explicitly either way so a clip once played one-shot cannot inherit
 * that setting when re-selected as a loop.
 */
export function applyMeshClip(
  player: ClipPlayer,
  desired: ClipName,
  opts?: { once?: boolean; cut?: boolean }
): void {
  const available = new Set(player.actions.keys());
  const resolved = meshClipOrFallback(available, desired);
  if (player.currentClip === resolved) return;
  const next = player.actions.get(resolved);
  if (!next) return; // No idle clip either -- nothing to play (a vehicle GLB with no animations).

  const previous = player.currentClip;
  const cut =
    opts?.cut === true ||
    previous === null ||
    transitionIsCut(player.clipScale.get(previous), player.clipScale.get(resolved));
  setLoop(next, opts?.once === true);

  if (cut) {
    for (const [name, action] of player.actions) {
      if (name !== resolved) action.stop();
    }
    player.fades.clear();
    next.reset().setEffectiveWeight(1).play();
    player.currentClip = resolved;
    return;
  }

  for (const [name, action] of player.actions) {
    if (name === resolved) continue;
    if (!action.isRunning() && !player.fades.has(name)) continue;
    const w = action.getEffectiveWeight();
    if (w <= 0) {
      action.stop();
      player.fades.delete(name);
      continue;
    }
    player.fades.set(name, { from: w, to: 0, t: 0 });
  }
  const resuming = next.isRunning();
  const startWeight = resuming ? next.getEffectiveWeight() : 0;
  if (!resuming) next.reset();
  next.setEffectiveWeight(startWeight);
  next.play();
  player.fades.set(resolved, { from: startWeight, to: 1, t: 0 });
  player.currentClip = resolved;
}

/**
 * Advances every in-flight ramp by `dtSeconds` and writes the weights. An
 * action that reaches 0 is stopped; a fade that reaches its end is dropped.
 * Cheap when nothing is fading (one size check), which is nearly always.
 */
export function advanceMeshClipFades(player: ClipPlayer, dtSeconds: number): void {
  if (player.fades.size === 0) return;
  for (const [name, fade] of player.fades) {
    const action = player.actions.get(name);
    if (!action) {
      player.fades.delete(name);
      continue;
    }
    fade.t = Math.min(MESH_CLIP_FADE_SECONDS, fade.t + dtSeconds);
    const p = fade.t / MESH_CLIP_FADE_SECONDS;
    action.setEffectiveWeight(fade.from + (fade.to - fade.from) * p);
    if (fade.t >= MESH_CLIP_FADE_SECONDS) {
      player.fades.delete(name);
      if (fade.to === 0) action.stop();
    }
  }
}
```

- [ ] **Step 5: Carry `clipScale` and `fades` on both templates and entities**

`mesh-unit.ts`: add to `MeshUnitTemplate` (after `geometries`):

```ts
  /** Design D2: `scaleSignature` per clip, computed once here. */
  readonly clipScale: ReadonlyMap<ClipName, string | null>;
```

In `buildMeshUnitTemplate`, after the `clips` map is filled, add `const clipScale = clipScaleSignatures(clips);` and include `clipScale` in the returned object. Import `clipScaleSignatures` from `./mesh-clip`. In `instantiateMeshUnit` return `{ typeId, root, mixer, actions, currentClip: null, clipScale: template.clipScale, fades: new Map() }`.

`mesh-vehicle.ts`: same field on `VehicleMeshTemplate`; in `buildVehicleMeshTemplate` add `clipScale: clipScaleSignatures(clips)` to the returned object; in `instantiateVehicleMesh` add `clipScale: template.clipScale, fades: new Map()` to the returned literal (the `VehicleMeshEntity` interface extends `ClipPlayer`, so `tsc` names every other literal that needs the two fields — fix each the same way).

- [ ] **Step 6: Call the ramp at every mixer site**

Insert `advanceMeshClipFades(entity, dtSeconds);` immediately before:
- `ThreeRenderer.ts:4626` `entity.mixer.update(dtSeconds);` (after `applyGaitRate`)
- `ThreeRenderer.ts:5074` `entity.mixer.update(dtSeconds);` (inside `if (entity.mixer)`)
- `mesh-death.ts:386` and `:406` (`d.entity.mixer.update(dtSeconds);`, both branches) — use `advanceMeshClipFades(d.entity, dtSeconds);`
- `mesh-evac.ts:156`
- `mesh-vehicle-death.ts:206` and `:225` (`if (mixer) mixer.update(dtSeconds);`) — `advanceMeshClipFades(d.entity, dtSeconds);` before each

Import the function from `./mesh-clip` (or `./units/mesh-clip` in `ThreeRenderer.ts`).

- [ ] **Step 7: Pin that every shipped vehicle's `idle → wreck` is a cut**

In `mesh-vehicle-shipped.test.ts`, inside the existing `describe` over shipped vehicles, add:

```ts
  it.each(shippedVehicleIds())('%s: idle -> wreck is a CUT under D2 (both clips key node scale, differently)', async (id) => {
    const template = await templateFor(id);
    const idle = template.clipScale.get('idle');
    const wreck = template.clipScale.get('wreck');
    expect(idle, `${id}: idle signature`).not.toBeNull();
    expect(wreck, `${id}: wreck signature`).not.toBeNull();
    expect(transitionIsCut(idle, wreck)).toBe(true);
  });
```

Import `transitionIsCut` from `./mesh-clip`.

- [ ] **Step 8: Run the render suite**

Run: `pnpm --filter @lions/render test`
Expected: PASS, including `mesh-clip`, `mesh-vehicle-shipped`, `mesh-unit`, `mesh-death`, and the four `ThreeRenderer.*` files. If a test elsewhere asserted that the OUTGOING action stopped in the same call as the switch on a scale-free pair, advance the fade in that test (`advanceMeshClipFades(entity, MESH_CLIP_FADE_SECONDS)`) rather than weakening the ramp — and name it in the commit.

- [ ] **Step 9: Falsify gate 1 and gate 2 by hand, then revert**

1. In `applyMeshClip`'s blend branch replace the two `player.fades.set(...)` lines with `action.fadeOut(MESH_CLIP_FADE_SECONDS)` / `next.fadeIn(MESH_CLIP_FADE_SECONDS)`: run `pnpm --filter @lions/render test -- mesh-clip` → 'keeps the sum of running weights at exactly 1' must FAIL. Revert.
2. Change `const cut = ... transitionIsCut(...)` to `const cut = opts?.cut === true || previous === null`: 'a scale swap switches in one step' must FAIL. Revert.
Record both outcomes in the task report and the commit message.

- [ ] **Step 10: Typecheck and lint, then commit**

Run: `pnpm typecheck` then `pnpm lint`
Expected: clean.

```bash
/usr/bin/git add packages/render/src/three/units/mesh-clip.ts packages/render/src/three/units/mesh-clip.test.ts packages/render/src/three/units/mesh-fixture.ts packages/render/src/three/units/mesh-unit.ts packages/render/src/three/units/mesh-vehicle.ts packages/render/src/three/units/mesh-death.ts packages/render/src/three/units/mesh-evac.ts packages/render/src/three/units/mesh-vehicle-death.ts packages/render/src/three/units/mesh-vehicle-shipped.test.ts packages/render/src/three/ThreeRenderer.ts
```
```bash
/usr/bin/git commit -m "feat(render): clips crossfade over 150 ms; a scale swap still cuts

Owned weight ramp (three.js fadeIn restarts at zero and blends toward bind
pose on a re-select; the sum-of-weights test reads < 1 with it). Per-clip
scale signature computed at template load decides cut vs blend, so every
bone-scale-swap rig and all eleven vehicles keep their cut. Falsified:
fadeIn in place of the ramp (sum test red), signature comparison removed
(scale-swap test red).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: `fall` and `fallAlt` join the vocabulary; `pickDeathClips` pairs them with the wreck (D3)

**Files:**
- Modify: `packages/render/src/sheet.ts:31` (union + comment above it)
- Modify: `packages/render/src/three/units/mesh-anim.ts:27-58` (set, fallback), `:440-448` (pick)
- Modify: `packages/render/src/three/units/mesh-anim.test.ts:29-60`, `:156-180`
- Modify: `tools/src/mesh_gait.test.ts:718` (`CORPSE_CLIPS` → add `FALL_CLIPS`), `:1633-1641`, `:2326-2330`
- Modify: `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` (append v4)

**Interfaces:**
- Produces: `ClipName` includes `'fall' | 'fallAlt'`; `CLIP_NAMES` lists ten; `meshClipOrFallback` chain `fallAlt → fall → down → idle`; `interface DeathClipPick { fall: 'fall' | 'fallAlt'; wreck: 'wreck' | 'wreckAlt' }`; `pickDeathClips(entityId, available: ReadonlySet<ClipName>): DeathClipPick`; `pickDeathClip(entityId, hasWreckAlt)` unchanged (vehicles keep using it). `tools/src/mesh_gait.test.ts` exports `FALL_CLIPS`.
- Task 4 consumes `pickDeathClips`; Task 8's gate consumes `FALL_CLIPS`.

- [ ] **Step 1: Update the vocabulary tests so they fail**

In `mesh-anim.test.ts` change the first test to:

```ts
  it('lists exactly the ten canonical clip names', () => {
    expect(new Set(CLIP_NAMES)).toEqual(
      new Set(['idle', 'move', 'fire', 'down', 'wreck', 'work', 'moveFire', 'wreckAlt', 'fall', 'fallAlt'])
    );
  });
```

In the `meshClipOrFallback` describe add:

```ts
  it('falls back fallAlt -> fall -> down -> idle, so a death module never plays a missing name', () => {
    expect(meshClipOrFallback(new Set<ClipName>(['idle', 'down', 'fall', 'fallAlt']), 'fallAlt')).toBe('fallAlt');
    expect(meshClipOrFallback(new Set<ClipName>(['idle', 'down', 'fall']), 'fallAlt')).toBe('fall');
    expect(meshClipOrFallback(new Set<ClipName>(['idle', 'down']), 'fallAlt')).toBe('down');
    expect(meshClipOrFallback(new Set<ClipName>(['idle', 'down']), 'fall')).toBe('down');
    expect(meshClipOrFallback(new Set<ClipName>(['idle']), 'fall')).toBe('idle');
  });
```

After the `pickDeathClip` describe add:

```ts
describe('pickDeathClips', () => {
  const all = new Set<ClipName>(['idle', 'fall', 'fallAlt', 'wreck', 'wreckAlt']);
  it('pairs the fall with the wreck it ends in -- the same variant bit decides both', () => {
    for (let id = 0; id < 40; id++) {
      const pick = pickDeathClips(id, all);
      expect(pick.fall === 'fallAlt').toBe(pick.wreck === 'wreckAlt');
      expect(pick.wreck).toBe(pickDeathClip(id, true));
    }
  });
  it('never names a clip the file lacks', () => {
    for (let id = 0; id < 40; id++) {
      expect(pickDeathClips(id, new Set<ClipName>(['idle', 'wreck'])).wreck).toBe('wreck');
      expect(pickDeathClips(id, new Set<ClipName>(['idle', 'fall', 'wreck'])).fall).toBe('fall');
      // Break: drop the `available.has('fallAlt')` guard -- an alt wreck
      // with no alt fall then names 'fallAlt' here and goes red.
      expect(pickDeathClips(id, new Set<ClipName>(['idle', 'fall', 'wreck', 'wreckAlt'])).fall).toBe('fall');
    }
  });
});
```

Import `pickDeathClips` beside `pickDeathClip`.

Run: `pnpm --filter @lions/render test -- mesh-anim`
Expected: FAIL (set mismatch; `pickDeathClips` not exported).

- [ ] **Step 2: Add the names**

`sheet.ts:31`:

```ts
export type ClipName =
  | 'idle' | 'move' | 'fire' | 'down' | 'wreck' | 'work' | 'moveFire' | 'wreckAlt'
  | 'fall' | 'fallAlt';
```

Add to the comment above it: "`fall`/`fallAlt` (2026-09-17, design D3) are the supplied death animations, one-shot, played only by `units/mesh-death.ts` — `resolveClip` never returns them, because `down` is looped for suppression and a fall is a transition with an end. `fallAlt` pairs with `wreckAlt`."

`mesh-anim.ts`: add `fall: true, fallAlt: true,` to `CLIP_NAME_SET`; change the `isMeshClipName` comment's "six" to "ten"; replace `meshClipOrFallback`'s body:

```ts
export function meshClipOrFallback(available: ReadonlySet<ClipName>, clip: ClipName): ClipName {
  if (available.has(clip)) return clip;
  if (clip === 'fallAlt' && available.has('fall')) return 'fall';
  if ((clip === 'fall' || clip === 'fallAlt') && available.has('down')) return 'down';
  return 'idle';
}
```

After `pickDeathClip` add:

```ts
/** The fall a dying body plays and the corpse it becomes, as one pick. */
export interface DeathClipPick {
  readonly fall: 'fall' | 'fallAlt';
  readonly wreck: 'wreck' | 'wreckAlt';
}

/**
 * Design D3: the variant bit is decided ONCE per entity (`pickDeathClip`'s
 * own hash) and applied to both halves, so the fall a body plays always
 * ends in the pose the wreck holds. `fallAlt` is named only when the file
 * carries it -- a file with `wreckAlt` and no `fallAlt` (none shipped; the
 * gait gate forbids it on a file that has `fall`) plays the primary fall.
 */
export function pickDeathClips(entityId: number, available: ReadonlySet<ClipName>): DeathClipPick {
  const wreck = pickDeathClip(entityId, available.has('wreckAlt'));
  const fall = wreck === 'wreckAlt' && available.has('fallAlt') ? 'fallAlt' : 'fall';
  return { fall, wreck };
}
```

Run: `pnpm --filter @lions/render test -- mesh-anim mesh-team-death-shipped civilian-mesh-shipped`
Expected: PASS.

- [ ] **Step 3: Exempt the fall clips from the facing sweeps**

`tools/src/mesh_gait.test.ts:718`, after `CORPSE_CLIPS`:

```ts
/** Clips that are a fall in progress -- the body turns as it goes down, so
 *  no facing is asserted (a corpse is the same exemption one frame later).
 *  Exported: the fall gate below sweeps exactly these names. */
export const FALL_CLIPS: ReadonlySet<string> = new Set(['fall', 'fallAlt']);
```

At `:1638` change `if (CORPSE_CLIPS.has(clip)) {` to `if (CORPSE_CLIPS.has(clip) || FALL_CLIPS.has(clip)) {` and the pushed label to `` `${rig.file} ${clip} (${CORPSE_CLIPS.has(clip) ? 'corpse' : 'fall'})` ``. At `:2328` change `.filter((c) => !CORPSE_CLIPS.has(c))` to `.filter((c) => !CORPSE_CLIPS.has(c) && !FALL_CLIPS.has(c))`. Grep the file for any other `r.clips`/`rig.clips` loop and apply the same exemption there.

Run: `pnpm --filter @lions/tools test -- mesh_gait`
Expected: PASS (no shipped file has a fall yet, so nothing is exempted; the gate simply compiles).

- [ ] **Step 4: Contract v4**

Append to `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`:

```markdown
---

# v4 — `fall` and `fallAlt`

**Pinned 2026-09-17** (`docs/superpowers/specs/2026-09-17-infantry-animation-design.md`, D3).

The clip vocabulary is `idle, move, fire, down, wreck, work, moveFire,
wreckAlt, fall, fallAlt`. Two additions, both ONE-SHOT and both played only
by `units/mesh-death.ts` — `resolveClip` never returns them, because `down`
loops for suppression and a fall has an end.

- **`fall`** starts standing (first-frame hips height within 10 % of the
  file's own `idle`), ends prone (last-frame hips height ≤ 0.35 m), lasts
  0.5–2.0 s, carries **no horizontal root motion** (the hips' horizontal
  position is held at its first-frame value throughout; vertical kept),
  and its **last frame is the `wreck` pose** — the same source frame,
  re-centred the same way — so the switch to the persistent wreck moves
  nothing. Figures in a team are staggered 0.1 s apart, holding their
  first frame, so a squad does not drop as clones.
- **`fallAlt`** is the same for `wreckAlt`. A file with `fallAlt` must have
  `wreckAlt`; a file with `fall` and `wreckAlt` must have `fallAlt`
  (`pickDeathClips` decides both halves with one bit); `wreckAlt` without
  `fall` stays legal.
- A file with neither `fall` nor `fallAlt` is legal and dies by the
  runtime's generic topple (D5). `pnpm gait:meshes` ignores both names.

The runtime guarantees: `fall`/`fallAlt` are entered through the same
crossfade as any clip (D1), never faded out mid-way, and followed by the
wreck with no opacity fade (D4). The gate is `tools/src/mesh_gait.test.ts`,
"mesh unit death -- the fall clips".
```

- [ ] **Step 5: Typecheck, then commit**

Run: `pnpm typecheck && pnpm --filter @lions/render test -- mesh-anim`
Expected: clean, PASS.

```bash
/usr/bin/git add packages/render/src/sheet.ts packages/render/src/three/units/mesh-anim.ts packages/render/src/three/units/mesh-anim.test.ts tools/src/mesh_gait.test.ts docs/superpowers/specs/2026-08-28-mesh-unit-contract.md
```
```bash
/usr/bin/git commit -m "feat(render): fall and fallAlt join the clip vocabulary, paired with wreck/wreckAlt

Contract v4. pickDeathClips decides the fall and the corpse with one bit
so a body ends in the pose its wreck holds. Falsified: the fallAlt guard
dropped -> 'never names a clip the file lacks' red.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The death module plays the fall, skips the fade, and knows "already down" (D3 runtime, D4; gate 4)

**Files:**
- Modify: `packages/render/src/three/units/mesh-death.ts:250-330` (`DyingMeshUnit`, `beginMeshDeath`), `:378-430` (`stepMeshDeath`)
- Modify: `packages/render/src/three/units/mesh-death.test.ts:176-400`
- Modify: `packages/render/src/three/ThreeRenderer.ts:1980-2045` (dispose reads `d.swaps` — unchanged shape, verify only)

**Interfaces:**
- Consumes: `pickDeathClips`, `applyMeshClip(..., { once, cut })`, `advanceMeshClipFades`, `entity.clipScale`.
- Produces: `type MeshDeathPhase = 'falling' | 'toppling' | 'fading' | 'settling'`; `DyingMeshUnit` = `{ entity, entityId, t, baseWorldY, swaps (mutable, empty until a fade begins), phase, wreckAction, fallAction, topple: ToppleState | null }`; `beginMeshDeath(entity, entityId = 0, killer: KillerRef | null = null)` with `interface KillerRef { readonly x: number; readonly y: number }` (tile coordinates); `stepMeshDeath` return type unchanged (`'fading'` still means "still dying"). `startWreck(d, cut)` and `beginFadePhase(d)` are module-private helpers Task 5 reuses. The `'toppling'` phase is declared here and entered only in Task 5; until then a no-fall, not-already-down template takes the OLD path (`down` + fade → wreck), so this task ships on its own.

- [ ] **Step 1: Rewrite the tests that pin the old contract, and add the new ones**

In `mesh-death.test.ts` replace the `describe('beginMeshDeath', ...)` block with:

```ts
describe('beginMeshDeath', () => {
  it('a GLB with a fall clip plays it once, no fade clone, phase falling (D3/D4)', async () => {
    const entity = await buildEntity(['idle', 'fall', 'wreck']);
    entity.root.position.set(2, 5, 3);
    const dying = beginMeshDeath(entity, 3);
    // Break (verified by hand, then reverted): make beginMeshDeath play
    // `down` instead of `pick.fall` -- this reads 'down'.
    expect(entity.currentClip).toBe('fall');
    expect(dying.phase).toBe('falling');
    expect(dying.swaps).toHaveLength(0);
    expect(dying.fallAction).toBe(entity.actions.get('fall'));
    expect(dying.t).toBe(0);
    expect(dying.baseWorldY).toBe(5);
  });

  it('picks fallAlt for the ids that pick wreckAlt, so the fall ends in its own corpse', async () => {
    const entity = await buildEntity(['idle', 'fall', 'fallAlt', 'wreck', 'wreckAlt']);
    const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const seen = new Set<string>();
    for (const id of ids) {
      const fresh = await buildEntity(['idle', 'fall', 'fallAlt', 'wreck', 'wreckAlt']);
      beginMeshDeath(fresh, id);
      seen.add(fresh.currentClip ?? 'none');
    }
    expect(seen).toEqual(new Set(['fall', 'fallAlt']));
    void entity;
  });

  it('"already down": a living clip that keys the same scales as wreck goes straight to settling', async () => {
    const entity = await buildEntity({
      clips: ['idle', 'move', 'wreck'],
      scaleClips: { idle: { root: 0, deathRoot: 1 }, move: { root: 1, deathRoot: 0 }, wreck: { root: 0, deathRoot: 1 } },
    });
    applyMeshClip(entity, 'idle'); // the sniper on overwatch: prone rig live
    const dying = beginMeshDeath(entity);
    expect(dying.phase).toBe('settling');
    expect(entity.currentClip).toBe('wreck');
    expect(dying.swaps).toHaveLength(0);
  });

  it('the same rig killed on the move (standing rig live) does NOT take the already-down path', async () => {
    const entity = await buildEntity({
      clips: ['idle', 'move', 'wreck'],
      scaleClips: { idle: { root: 0, deathRoot: 1 }, move: { root: 1, deathRoot: 0 }, wreck: { root: 0, deathRoot: 1 } },
    });
    applyMeshClip(entity, 'move');
    const dying = beginMeshDeath(entity);
    expect(dying.phase).not.toBe('settling');
  });

  it('no fall, no wreck-shaped living clip: the pre-topple path still plays down and fades (until Task 5)', async () => {
    const entity = await buildEntity(['idle', 'down', 'wreck']);
    const dying = beginMeshDeath(entity);
    expect(entity.currentClip).toBe('down');
    expect(dying.phase).toBe('fading');
    expect(dying.swaps).toHaveLength(1);
  });
});
```

`buildEntity` must accept either a clip list or `{ clips, scaleClips }` — change the helper at the top of the file to:

```ts
async function buildEntity(
  spec: string | string[] | { clips: string[]; scaleClips?: Record<string, { root: number; deathRoot: number }>; rootOffset?: [number, number, number] }
): Promise<MeshUnitEntity> {
  const opts =
    typeof spec === 'string' || Array.isArray(spec)
      ? { roleName: 'uniform', clipName: spec }
      : { roleName: 'uniform', clipName: spec.clips, scaleClips: spec.scaleClips, rootOffset: spec.rootOffset };
  const gltf = await parseFixture(opts);
  const template = buildMeshUnitTemplate(gltf, 'kdf');
  return instantiateMeshUnit(template, 'inf_squad');
}
```

and import `applyMeshClip` from `./mesh-clip`.

In `describe('stepMeshDeath', ...)`, every existing test that reads `dying.settling` now reads `dying.phase === 'settling'`; the three that build `['idle', 'down', 'wreck']` still exercise the old path unchanged. Add two new tests to that describe:

```ts
  it('falling: no opacity write, no sink, mixer advances; becomes settling only once the fall action pauses', async () => {
    const entity = await buildEntity(['idle', 'fall', 'wreck']); // fixture clips are 1 s
    entity.root.position.set(1, 4, 1);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const dying = beginMeshDeath(entity, 5);
    const env = makeEnv({ scene });
    const material = findMeshMaterial(entity);

    expect(stepMeshDeath(dying, 0.5, env)).toBe('fading');
    expect(dying.phase).toBe('falling');
    expect(material.opacity).toBe(1); // Break: call beginMeshDeathFade in the fall path -- a clone at < 1 appears
    expect(entity.root.position.y).toBe(4);

    expect(stepMeshDeath(dying, 0.6, env)).toBe('fading'); // fall (1 s) has now paused; wreck starts
    expect(dying.phase).toBe('settling');
    expect(entity.currentClip).toBe('wreck');
    expect(dying.swaps).toHaveLength(0);

    stepMeshDeath(dying, 0.5, env);
    const done = stepMeshDeath(dying, 0.6, env);
    expect(done).not.toBe('fading');
    expect(done).not.toBe('removed');
    expect((done as MeshWreck).root).toBe(entity.root);
    expect(material.opacity).toBe(1);
  });

  it('a template with fall but no wreck is impossible by contract; the module still removes it after the fall', async () => {
    const entity = await buildEntity(['idle', 'fall']);
    const scene = new THREE.Scene();
    scene.add(entity.root);
    const dying = beginMeshDeath(entity);
    const env = makeEnv({ scene });
    stepMeshDeath(dying, 1.1, env);
    expect(dying.phase).toBe('fading');
    let result: ReturnType<typeof stepMeshDeath> = 'fading';
    for (let i = 0; i < 6 && result === 'fading'; i++) result = stepMeshDeath(dying, 0.1, env);
    expect(result).toBe('removed');
    expect(scene.children).not.toContain(entity.root);
  });
```

Run: `pnpm --filter @lions/render test -- mesh-death`
Expected: FAIL (`phase`, `fallAction` do not exist; `beginMeshDeath` plays `down`).

- [ ] **Step 2: Rewrite `DyingMeshUnit`, `beginMeshDeath`, `stepMeshDeath`**

Replace the `DyingMeshUnit` interface and `beginMeshDeath` with (keep the existing doc comments' content where it still holds; the new comments below say what changed):

```ts
export type MeshDeathPhase = 'falling' | 'toppling' | 'fading' | 'settling';

/** Where the round that killed this entity came from, in tile coordinates
 *  -- `ThreeRenderer.killerX/killerY`, written from the `destroyed` event's
 *  `by`. `null` when nothing shot it (`debugKill`, a tunnel collapse). */
export interface KillerRef {
  readonly x: number;
  readonly y: number;
}

/** One entity mid-death. `phase` replaces the old `settling` boolean:
 *   - `falling`  -- playing `fall`/`fallAlt` once (D3); no fade clone exists
 *   - `toppling` -- the generic per-figure topple (D5, Task 5)
 *   - `fading`   -- Pixi's 0.4 s fade-to-half + sink; reached only by a
 *                   body that has nothing persistent to become (D4)
 *   - `settling` -- the wreck one-shot until it pauses, then `MeshWreck`
 *  `t` is seconds since the CURRENT phase began. `swaps` is empty until
 *  the fading phase starts. */
export interface DyingMeshUnit {
  readonly entity: MeshUnitEntity;
  readonly entityId: number;
  t: number;
  readonly baseWorldY: number;
  swaps: readonly MeshFadeSwap[];
  phase: MeshDeathPhase;
  wreckAction: THREE.AnimationAction | null;
  readonly fallAction: THREE.AnimationAction | null;
  topple: ToppleState | null;
  readonly killer: KillerRef | null;
}

/** Task 5 fills this in; declared here so the phase union is complete. */
export interface ToppleState {
  readonly totalSeconds: number;
}

/** Switches the entity onto its picked wreck clip and enters `settling`.
 *  `cut` forces a one-frame switch (the topple's swap, D5); otherwise D2
 *  decides. */
function startWreck(d: DyingMeshUnit, cut: boolean): void {
  const pick = pickDeathClips(d.entityId, new Set(d.entity.actions.keys()));
  applyMeshClip(d.entity, pick.wreck, { once: true, cut });
  d.wreckAction = d.entity.actions.get(pick.wreck) ?? null;
  d.phase = 'settling';
  d.t = 0;
}

/** Enters the Pixi fade for a body with no wreck: clones the materials now
 *  (not at `beginMeshDeath`), so a body that falls or topples into a wreck
 *  never pays for clones it will not use. */
function beginFadePhase(d: DyingMeshUnit): void {
  d.swaps = beginMeshDeathFade(d.entity.root);
  d.phase = 'fading';
  d.t = 0;
}

export function beginMeshDeath(entity: MeshUnitEntity, entityId: number = 0, killer: KillerRef | null = null): DyingMeshUnit {
  const available = new Set(entity.actions.keys());
  const pick = pickDeathClips(entityId, available);
  const base = {
    entity,
    entityId,
    t: 0,
    baseWorldY: entity.root.position.y,
    swaps: [] as readonly MeshFadeSwap[],
    wreckAction: null as THREE.AnimationAction | null,
    topple: null as ToppleState | null,
    killer,
  };

  // D3: the supplied fall, entered through the ordinary crossfade.
  if (available.has(pick.fall)) {
    applyMeshClip(entity, pick.fall, { once: true });
    return { ...base, phase: 'falling', fallAction: entity.actions.get(pick.fall) ?? null };
  }

  // "Already down": the living clip shows the corpse geometry (equal scale
  // signatures -- the sniper on overwatch). Nothing to topple; straight to
  // the wreck, blending or cutting by D2.
  if (
    available.has('wreck') &&
    entity.currentClip !== null &&
    entity.clipScale.get(entity.currentClip) === entity.clipScale.get(pick.wreck)
  ) {
    const d: DyingMeshUnit = { ...base, phase: 'settling', fallAction: null };
    startWreck(d, false);
    return d;
  }

  // Everything else: Task 5 replaces this with the topple. Until then the
  // old path -- `down`, Pixi's fade, then the wreck -- verbatim.
  applyMeshClip(entity, 'down', { once: true });
  return { ...base, phase: 'fading', swaps: beginMeshDeathFade(entity.root), fallAction: null };
}
```

Replace `stepMeshDeath`'s body with:

```ts
export function stepMeshDeath(d: DyingMeshUnit, dtSeconds: number, env: MeshDeathEnv): 'fading' | 'removed' | MeshWreck {
  if (d.phase === 'settling') {
    const action = d.wreckAction;
    advanceMeshClipFades(d.entity, dtSeconds);
    d.entity.mixer.update(dtSeconds);
    if (!action || !action.paused) return 'fading';

    const x = d.entity.root.position.x;
    const y = d.entity.root.position.z;
    d.entity.root.position.y = groundWorldY(env.elevation, env.width, env.height, x, y);
    const shown = env.isExplored(x, y);
    d.entity.root.visible = shown;
    return { root: d.entity.root, x, y, shown };
  }

  if (d.phase === 'falling') {
    advanceMeshClipFades(d.entity, dtSeconds);
    d.entity.mixer.update(dtSeconds);
    d.t += dtSeconds;
    if (!d.fallAction || !d.fallAction.paused) return 'fading';
    // D4: the body is already lying in its final pose -- no fade, no sink.
    if (d.entity.actions.has('wreck')) startWreck(d, false);
    else beginFadePhase(d);
    return 'fading';
  }

  if (d.phase === 'toppling') {
    // Task 5.
    return 'fading';
  }

  // 'fading' -- Pixi's curve, verbatim.
  d.t += dtSeconds;
  setMeshDeathOpacity(d.swaps, meshDeathOpacity(d.t));
  d.entity.root.position.y = d.baseWorldY - meshDeathSinkPx(d.t) * WORLD_Y_PER_LIFT_PIXEL;
  advanceMeshClipFades(d.entity, dtSeconds);
  d.entity.mixer.update(dtSeconds);
  if (d.t < MESH_DEATH_SECONDS) return 'fading';

  endMeshDeathFade(d.swaps);
  d.swaps = [];
  if (!d.entity.actions.has('wreck')) {
    env.scene.remove(d.entity.root);
    disposeMeshUnitEntity(d.entity);
    return 'removed';
  }
  startWreck(d, false);
  return 'fading';
}
```

Import `pickDeathClips` (replacing `pickDeathClip`) and `advanceMeshClipFades`. Update the top-of-file comment: the fade is no longer the whole death, and say why (D4). Check `ThreeRenderer.ts:1980-2045` (`dispose`) still compiles — it calls `endMeshDeathFade(d.swaps)` for each `meshDying`, which is now correct for an empty array too.

Run: `pnpm --filter @lions/render test -- mesh-death ThreeRenderer.mesh-death`
Expected: PASS. (`ThreeRenderer.mesh-death.test.ts`'s round-trip uses `['idle','down','wreck']` — the old path — and must still pass unchanged.)

- [ ] **Step 3: Falsify, then revert**

1. In the fall branch of `beginMeshDeath`, replace `pick.fall` with `'down'` → 'a GLB with a fall clip plays it once' FAILS. Revert.
2. In `beginMeshDeath`'s fall branch add `swaps: beginMeshDeathFade(entity.root)` → 'falling: no opacity write' FAILS on `material.opacity`. Revert.

- [ ] **Step 4: Commit**

Run: `pnpm typecheck && pnpm --filter @lions/render test`
Expected: clean, PASS.

```bash
/usr/bin/git add packages/render/src/three/units/mesh-death.ts packages/render/src/three/units/mesh-death.test.ts
```
```bash
/usr/bin/git commit -m "feat(render): a mesh death plays its fall clip and skips the fade into the wreck

Phases falling/toppling/fading/settling replace the settling boolean. A
template with fall plays it once (crossfaded in), waits for it to pause,
then swaps to the paired wreck at full opacity (D4). A living clip that
already shows the corpse geometry goes straight to settling. Falsified:
fall replaced by down (red), a fade clone added on the fall path (red).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: The generic per-figure topple, and the killer's position reaching it (D5; gates 5–6)

**Files:**
- Modify: `packages/render/src/three/units/mesh-death.ts` (topple math; `beginMeshDeath`'s last branch; `stepMeshDeath`'s `toppling` and `settling` branches)
- Modify: `packages/render/src/three/units/mesh-death.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts:1631-1633` (allocate), `:2704-2725` (write in `onEvents`), `:4678` (read at `beginMeshDeath`)
- Modify: `packages/render/src/three/ThreeRenderer.mesh-death.test.ts`

**Interfaces:**
- Consumes: `applyMeshClip(..., { once: true, cut: true })`, `KillerRef`, `startWreck`, `beginFadePhase`.
- Produces (exported from `mesh-death.ts`): `TOPPLE_SECONDS = 0.5`, `TOPPLE_STAGGER_SECONDS = 0.1`, `toppleAngle(t)`, `toppleDirection(entity, killer)`, `liveFigureRoots(root)`, `interface ToppleFigure`, `interface ToppleState { direction; figures; totalSeconds; liveRoots; corpseYaw }`, `beginTopple(entity, direction)`, `applyTopple(state, t)`, `yawCorpseRoots(entity, state)`. `ThreeRenderer` private fields `killerX: Float64Array`, `killerY: Float64Array` (NaN = no killer).

Geometry, so the implementer does not re-derive it: with `up = (0,1,0)` and fall direction `d` (unit, horizontal, world), the rotation that lays `up` down along `d` is `angle` about `axis = up × d` (right-hand rule; checked: `up × (1,0,0) = (0,0,−1)`, and +90° about −z takes +y to +x). Each live figure root is rotated about the horizontal line through the ground point beneath its own origin: in the bone's PARENT space, `pivot = parent.worldToLocal((boneWorld.x, groundY, boneWorld.z))`, `axisLocal = axis` rotated by the inverse of the parent's world quaternion, and per frame `bone.quaternion = q · rest`, `bone.position = pivot + q·(restPosition − pivot)`. The root's origin is at the feet on every kit rig and projects to the feet on a Meshy `Hips`, so the feet never move — which is the assertion that distinguishes this from pivoting on the entity root.

- [ ] **Step 1: Write the failing tests**

Replace the "pre-topple path" test from Task 4 and add a `describe('the generic topple (D5)')` in `mesh-death.test.ts`:

```ts
/** The fixture's live root is `root_joint` (scale 1) with `death_root` at 0
 *  -- one figure, standing `rootOffset` away from the entity origin so the
 *  per-figure pivot is distinguishable from an entity-root pivot. */
const KIT_LIKE = {
  clips: ['idle', 'move', 'down', 'wreck'],
  scaleClips: {
    idle: { root: 1, deathRoot: 0 },
    move: { root: 1, deathRoot: 0 },
    down: { root: 0, deathRoot: 1 },
    wreck: { root: 0, deathRoot: 1 },
  },
  rootOffset: [0.5, 0, 0] as [number, number, number],
};

function boneNamed(entity: MeshUnitEntity, name: string): THREE.Bone {
  let hit: THREE.Bone | null = null;
  entity.root.traverse((o) => {
    if ((o as THREE.Bone).isBone && o.name === name) hit = o as THREE.Bone;
  });
  if (!hit) throw new Error(`no bone ${name}`);
  return hit;
}

function rotationDeg(b: THREE.Bone): number {
  return (2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))) * 180) / Math.PI;
}

async function standing(): Promise<MeshUnitEntity> {
  const entity = await buildEntity(KIT_LIKE);
  entity.root.position.set(10, 0, 10); // ground at y = 0
  applyMeshClip(entity, 'move');
  entity.mixer.update(0.01); // writes the scale keys onto the bones
  entity.root.updateWorldMatrix(true, true);
  return entity;
}

describe('the generic topple (D5)', () => {
  it('toppleAngle is 90 deg * p^2 -- 22.5 at a quarter second, 90 at the end, clamped', () => {
    expect((toppleAngle(0.25) * 180) / Math.PI).toBeCloseTo(22.5, 6); // Break: drop the square -> 45
    expect((toppleAngle(0.5) * 180) / Math.PI).toBeCloseTo(90, 6);
    expect(toppleAngle(-0.1)).toBe(0);
    expect((toppleAngle(9) * 180) / Math.PI).toBeCloseTo(90, 6);
  });

  it('falls away from the killer, and straight back from its facing with no killer', async () => {
    const e = await standing();
    e.root.rotation.y = 0; // facing local +X = world +X
    expect(toppleDirection(e, { x: 9, y: 10 }).x).toBeCloseTo(1, 6); // killer to the -x side
    expect(toppleDirection(e, { x: 10, y: 12 }).z).toBeCloseTo(-1, 6);
    expect(toppleDirection(e, null).x).toBeCloseTo(-1, 6); // backward
    e.root.rotation.y = Math.PI / 2; // three.js: +90 deg yaw turns +X toward -Z
    expect(toppleDirection(e, null).z).toBeCloseTo(1, 6);
  });

  it('a no-fall rig enters toppling with its live root pitched about its OWN feet; the feet never move', async () => {
    const e = await standing();
    const root = boneNamed(e, 'root_joint');
    const feetBefore = root.getWorldPosition(new THREE.Vector3());
    const d = beginMeshDeath(e, 4, { x: 9, y: 10 }); // falls toward +x
    expect(d.phase).toBe('toppling');
    expect(e.currentClip).toBe('move'); // no clip applied: the pose freezes
    const env = makeEnv();

    stepMeshDeath(d, 0.25, env);
    expect(rotationDeg(root)).toBeCloseTo(22.5, 4);
    e.root.updateWorldMatrix(true, true);
    // Break (verified, reverted): pivot on the entity root instead -- this
    // point moves by 0.5 m, the figure's own offset from the origin.
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(feetBefore)).toBeLessThan(1e-6);
    const time = e.actions.get('move')?.time ?? -1;

    stepMeshDeath(d, 0.25, env);
    expect(rotationDeg(root)).toBeCloseTo(90, 4);
    expect(e.actions.get('move')?.time).toBe(time); // the mixer did not advance
    // The head (bone1, +1 up from the root) now lies +1 along the fall direction.
    e.root.updateWorldMatrix(true, true);
    const head = boneNamed(e, 'bone1').getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeCloseTo(feetBefore.y, 4);
    expect(head.x - feetBefore.x).toBeCloseTo(MESH_SCALE, 4); // 1 m in the GLB, scaled to world
  });

  it('after the last figure lands: a one-frame cut to the wreck, the corpse root yawed to the bearing, then a MeshWreck', async () => {
    const e = await standing();
    e.root.rotation.y = 0;
    const scene = new THREE.Scene();
    scene.add(e.root);
    const d = beginMeshDeath(e, 4, { x: 10, y: 12 }); // falls toward -z: bearing +90 deg from +x
    const env = makeEnv({ scene });
    stepMeshDeath(d, 0.5, env);
    expect(d.phase).toBe('settling');
    expect(e.currentClip).toBe('wreck');
    expect(e.actions.get('wreck')?.getEffectiveWeight()).toBe(1); // a cut, not a blend
    expect(e.actions.get('move')?.isRunning()).toBe(false);
    stepMeshDeath(d, 0.1, env);
    const corpse = boneNamed(e, 'death_root');
    const yawDeg = (2 * Math.atan2(corpse.quaternion.y, corpse.quaternion.w) * 180) / Math.PI;
    expect(Math.abs(yawDeg)).toBeCloseTo(90, 3);
    let result: ReturnType<typeof stepMeshDeath> = 'fading';
    for (let i = 0; i < 20 && result === 'fading'; i++) result = stepMeshDeath(d, 0.1, env);
    expect(result).not.toBe('fading');
    expect(result).not.toBe('removed');
    expect(findMeshMaterial(e).opacity).toBe(1); // D4: never faded
  });

  it('a no-wreck rig topples, then takes the Pixi fade and is removed', async () => {
    const e = await buildEntity(['idle', 'down']); // civilians' shape: no wreck
    e.root.position.set(3, 0, 3);
    applyMeshClip(e, 'idle');
    e.mixer.update(0.01);
    const scene = new THREE.Scene();
    scene.add(e.root);
    const d = beginMeshDeath(e);
    expect(d.phase).toBe('toppling');
    const env = makeEnv({ scene });
    stepMeshDeath(d, 0.5, env);
    expect(d.phase).toBe('fading');
    expect(d.swaps.length).toBeGreaterThan(0);
    let result: ReturnType<typeof stepMeshDeath> = 'fading';
    for (let i = 0; i < 10 && result === 'fading'; i++) result = stepMeshDeath(d, 0.1, env);
    expect(result).toBe('removed');
  });

  it('stagger: the second live figure starts 0.1 s after the first', () => {
    // Pure arithmetic on the state, no GLB with two figures needed.
    expect(toppleAngle(0.25 - TOPPLE_STAGGER_SECONDS)).toBeLessThan(toppleAngle(0.25));
    expect(toppleAngle(0.05)).toBeGreaterThan(0);
    expect(toppleAngle(0.05 - TOPPLE_STAGGER_SECONDS)).toBe(0);
  });
});
```

Import `toppleAngle`, `toppleDirection`, `TOPPLE_STAGGER_SECONDS` from `./mesh-death` and `MESH_SCALE` from `./mesh-anim`.

Run: `pnpm --filter @lions/render test -- mesh-death`
Expected: FAIL (nothing exported; `phase` reads `'fading'`).

- [ ] **Step 2: Implement the topple**

In `mesh-death.ts` replace the placeholder `ToppleState` with:

```ts
/** Design D5 -- one live figure root and the frame it topples in. */
export interface ToppleFigure {
  readonly bone: THREE.Bone;
  readonly restQuaternion: THREE.Quaternion;
  readonly restPosition: THREE.Vector3;
  /** Ground point beneath the bone's origin, in the bone's PARENT space. */
  readonly pivot: THREE.Vector3;
  /** `up x direction`, in the bone's parent space. */
  readonly axis: THREE.Vector3;
  readonly delaySeconds: number;
}

export interface ToppleState {
  readonly direction: THREE.Vector3;
  readonly figures: readonly ToppleFigure[];
  readonly totalSeconds: number;
  /** The roots that were live at death -- NOT yawed at the swap. */
  readonly liveRoots: ReadonlySet<THREE.Bone>;
  /** Signed angle from the entity's forward to `direction`, about up. */
  readonly corpseYaw: number;
}

export const TOPPLE_SECONDS = 0.5;
export const TOPPLE_STAGGER_SECONDS = 0.1;
const TOPPLE_ANGLE = Math.PI / 2;
const UP = new THREE.Vector3(0, 1, 0);
const LIVE_SCALE = 0.5;

/** `90 deg * p^2`, `p = t / TOPPLE_SECONDS`, clamped -- a body accelerates. */
export function toppleAngle(t: number): number {
  const p = Math.min(1, Math.max(0, t / TOPPLE_SECONDS));
  return TOPPLE_ANGLE * p * p;
}

/** World-space unit direction the body falls in: away from the killer,
 *  else straight back from its facing. `entity.root.position` is
 *  `(tileX, groundY, tileY)`, the same frame `killer` is in. */
export function toppleDirection(entity: MeshUnitEntity, killer: KillerRef | null): THREE.Vector3 {
  if (killer && Number.isFinite(killer.x) && Number.isFinite(killer.y)) {
    const d = new THREE.Vector3(entity.root.position.x - killer.x, 0, entity.root.position.z - killer.y);
    if (d.lengthSq() > 1e-9) return d.normalize();
  }
  return new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, entity.root.rotation.y).negate();
}

/** Every parentless bone currently at scale 1: a kit `{prefix}_root`, a
 *  Meshy `Hips`, `m_root` on the motorcycle. Sorted by name for a stable
 *  stagger order. Structural, not by name -- the contract forbids the
 *  runtime depending on bone names. */
export function liveFigureRoots(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone) return;
    if ((b.parent as THREE.Bone | null)?.isBone) return;
    if (b.scale.x > LIVE_SCALE) out.push(b);
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function beginTopple(entity: MeshUnitEntity, direction: THREE.Vector3): ToppleState {
  entity.root.updateWorldMatrix(true, true);
  const groundY = entity.root.position.y;
  const axisWorld = UP.clone().cross(direction).normalize();
  const roots = liveFigureRoots(entity.root);
  const figures = roots.map((bone, i) => {
    const parent = bone.parent ?? entity.root;
    const worldPos = bone.getWorldPosition(new THREE.Vector3());
    const pivot = parent.worldToLocal(new THREE.Vector3(worldPos.x, groundY, worldPos.z));
    const parentInverse = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    return {
      bone,
      restQuaternion: bone.quaternion.clone(),
      restPosition: bone.position.clone(),
      pivot,
      axis: axisWorld.clone().applyQuaternion(parentInverse).normalize(),
      delaySeconds: i * TOPPLE_STAGGER_SECONDS,
    };
  });
  const forward = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, entity.root.rotation.y);
  const corpseYaw = Math.atan2(forward.clone().cross(direction).dot(UP), forward.dot(direction));
  return {
    direction,
    figures,
    totalSeconds: TOPPLE_SECONDS + TOPPLE_STAGGER_SECONDS * Math.max(0, roots.length - 1),
    liveRoots: new Set(roots),
    corpseYaw,
  };
}

/** Writes every figure's pitch for time `t` since the topple began. */
export function applyTopple(state: ToppleState, t: number): void {
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (const f of state.figures) {
    q.setFromAxisAngle(f.axis, toppleAngle(t - f.delaySeconds));
    f.bone.quaternion.copy(q).multiply(f.restQuaternion);
    v.copy(f.restPosition).sub(f.pivot).applyQuaternion(q).add(f.pivot);
    f.bone.position.copy(v);
  }
}

/** After the swap: every parentless bone that is visible now and was NOT a
 *  live root at death is corpse geometry that just appeared; yaw it about
 *  its own origin so its head lies along the fall direction (the kit prone
 *  build has its head at local +X). Applied after each `mixer.update` in
 *  the settle phase, since the wreck clip re-keys the bone every update;
 *  once the wreck stops being updated the last write persists. An authored
 *  wreck POSE (no swap: the live root stays the live root) is untouched. */
export function yawCorpseRoots(entity: MeshUnitEntity, state: ToppleState): void {
  if (state.corpseYaw === 0) return;
  const q = new THREE.Quaternion();
  entity.root.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone) return;
    if ((b.parent as THREE.Bone | null)?.isBone) return;
    if (state.liveRoots.has(b) || b.scale.x <= LIVE_SCALE) return;
    const parent = b.parent ?? entity.root;
    const upLocal = UP.clone().applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    q.setFromAxisAngle(upLocal, state.corpseYaw);
    b.quaternion.premultiply(q);
  });
}
```

In `beginMeshDeath`, replace the last branch (the `down` + fade path) with:

```ts
  // D5: the generic topple. The pose freezes (no clip applied, mixer not
  // advanced); each live figure root pitches about its own feet.
  const topple = beginTopple(entity, toppleDirection(entity, killer));
  return { ...base, phase: 'toppling', fallAction: null, topple };
```

In `stepMeshDeath`, replace the `toppling` placeholder with:

```ts
  if (d.phase === 'toppling') {
    const topple = d.topple;
    if (!topple) throw new Error('mesh-death: toppling with no ToppleState');
    d.t += dtSeconds;
    applyTopple(topple, d.t);
    if (d.t < topple.totalSeconds) return 'fading';
    // The swap is always a cut: a blend would have the mixer lay the wreck
    // pose under a figure still pitched 90 deg (spec 3.3).
    if (d.entity.actions.has('wreck')) startWreck(d, true);
    else beginFadePhase(d);
    return 'fading';
  }
```

and in the `settling` branch, after `d.entity.mixer.update(dtSeconds);` add `if (d.topple) yawCorpseRoots(d.entity, d.topple);`. The `fading` branch's tail (`startWreck(d, false)` when a wreck exists) is now unreachable for a wreck-bearing template — replace it with `env.scene.remove(...); disposeMeshUnitEntity(...); return 'removed';` unconditionally and delete the `has('wreck')` check, with a comment: "only a body with no wreck ever fades (D4)".

Run: `pnpm --filter @lions/render test -- mesh-death`
Expected: PASS.

- [ ] **Step 3: Plumb the killer through `ThreeRenderer`**

At `ThreeRenderer.ts:1631` (beside `curX`/`curY`) add:

```ts
    this.killerX = new Float64Array(n).fill(NaN);
    this.killerY = new Float64Array(n).fill(NaN);
```

and the two `private readonly killerX: Float64Array; private readonly killerY: Float64Array;` field declarations next to `curX`'s, with the comment: "Where the round that killed entity `i` came from, tile coordinates, written by `onEvents` on `destroyed` and read once by `updateMeshUnits`' prune loop (D5). NaN = no killer (`by < 0`: `debugKill`, tunnel collapse). Entity slots are never reused, so a stale value cannot alias a later unit."

In `onEvents`' `destroyed` branch (`:2704`), first statement:

```ts
        this.killerX[e.entity] = e.by >= 0 ? this.curX[e.by] : NaN;
        this.killerY[e.entity] = e.by >= 0 ? this.curY[e.by] : NaN;
```

At `:4678` replace `else this.meshDying.push(beginMeshDeath(entity, id));` with:

```ts
      else {
        const kx = this.killerX[id];
        this.meshDying.push(beginMeshDeath(entity, id, Number.isNaN(kx) ? null : { x: kx, y: this.killerY[id] }));
      }
```

- [ ] **Step 4: Renderer-level test (gate 6)**

In `ThreeRenderer.mesh-death.test.ts` add `killerX: Float64Array; killerY: Float64Array; onEvents(events: unknown[]): void;` to `ThreeRendererPrivates` and a test:

```ts
  it('records the killer\'s position on destroyed, NaN when nothing shot it', async () => {
    const { sim, renderer, priv, id } = await setUp('idle');
    const typeIdx = sim.addUnitType({ ...INF, id: 'mesh_test_killer' });
    const killer = sim.spawn(typeIdx, 1, fx.from(1.5), fx.from(2.5));
    renderer.snapshot();
    renderer.onEvents([{ kind: 'destroyed', tick: 1, entity: id, by: killer }]);
    expect(priv.killerX[id]).toBeCloseTo(1.5, 6);
    expect(priv.killerY[id]).toBeCloseTo(2.5, 6);
    renderer.onEvents([{ kind: 'destroyed', tick: 1, entity: id, by: -1 }]);
    expect(Number.isNaN(priv.killerX[id])).toBe(true);
  });

  it('hands the killer to beginMeshDeath: the topple direction points away from it', async () => {
    const { sim, renderer, priv, id } = await setUp('idle');
    priv.updateMeshUnits(1, 16);
    const typeIdx = sim.addUnitType({ ...INF, id: 'mesh_test_killer2' });
    const killer = sim.spawn(typeIdx, 1, fx.from(4.5), fx.from(2.5)); // north of the unit at (4.5, 6.5)
    renderer.snapshot();
    renderer.onEvents([{ kind: 'destroyed', tick: 1, entity: id, by: killer }]);
    sim.state.alive[id] = 0;
    priv.updateMeshUnits(1, 16);
    const dying = priv.meshDying[0];
    expect(dying.phase).toBe('toppling');
    expect(dying.topple?.direction.z).toBeCloseTo(1, 6); // away from the killer: toward +y tiles
  });
```

The existing round-trip test in that file (`['idle', 'down', 'wreck']`, 20 frames of 200 ms) still ends in a `MeshWreck` — the topple takes 0.5 s and the wreck one-shot 1 s, well inside 4 s. If `sim.addUnitType` refuses a second type after spawns, spawn the killer of the same type (`INF`) instead.

Run: `pnpm --filter @lions/render test -- ThreeRenderer.mesh-death mesh-death`
Expected: PASS.

- [ ] **Step 5: Falsify, then revert**

1. `toppleAngle`: `TOPPLE_ANGLE * p * p` → `TOPPLE_ANGLE * p`: the 22.5° assertion reads 45. Revert.
2. `beginTopple`: replace `pivot` with `parent.worldToLocal(new THREE.Vector3(entity.root.position.x, groundY, entity.root.position.z))` (entity-root pivot): 'the feet never move' fails by ~0.5 m. Revert.
3. `ThreeRenderer.onEvents`: drop the two `killerX/killerY` writes: gate 6 reads NaN. Revert.

- [ ] **Step 6: Full render suite, typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @lions/render test`
Expected: clean, PASS.

```bash
/usr/bin/git add packages/render/src/three/units/mesh-death.ts packages/render/src/three/units/mesh-death.test.ts packages/render/src/three/ThreeRenderer.ts packages/render/src/three/ThreeRenderer.mesh-death.test.ts
```
```bash
/usr/bin/git commit -m "feat(render): every rig without a fall clip topples, per figure, away from its killer

Each parentless live root pitches 90 deg over 0.5 s (p^2) about the ground
point beneath its own origin, figures staggered 0.1 s; the pose freezes
meanwhile. The swap to the wreck is a one-frame cut and each corpse root
is yawed to the fall bearing. onEvents records the killer's position from
destroyed.by; NaN means backward from the facing. Falsified: linear angle
(22.5 reads 45), entity-root pivot (feet move 0.5 m), killer writes
dropped (gate 6 reads NaN).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: The KDF soldier and the Sarim irregular bind their falls (D3 assets, part 1; gate 7)

**Files:**
- Modify: `tools/import_meshy_soldier.py` (`CLIP_ORDER:303`, new constants after `FALL_SOURCE:~365`, `CLIP_SEMANTICS:~400-470`, `build_wreck_src:1184` deleted, `write_combined_clip:1965`, `check_clip_semantics:2054`, `main:2726-2800`)
- Modify: `tools/import_meshy_soldier_irregular.py` (`CLIP_ORDER:234`, `CLIP_SEMANTICS:317-437`, `build_wreck_src:722` deleted, `write_combined_clip:1160`, `check_clip_semantics:1313`, `main:1570-1640`)
- Output: `art/meshes/meshy_soldier.glb`, `art/meshes/sarim_rifles.glb` (re-exported)
- Setup: `art/blend` symlink (gitignored)

**Interfaces:**
- Consumes: the Meshy sources under `art/blend/KDF/soldier/…` and `art/blend/enemy/Sarim irregular/…` (main checkout).
- Produces: `meshy_soldier.glb` with clips `idle, move, fire, moveFire, down, wreck, fall`; `sarim_rifles.glb` with `…, wreck, wreckAlt, fall, fallAlt`. Both files then need Task 8's `pnpm gait:meshes` + `pnpm encode:meshes`.

Run with the `blender-art` agent or with Blender on PATH. Each script's module docstring gives its exact invocation; use it verbatim.

- [ ] **Step 1: Make the sources reachable from this worktree**

```bash
ls art/blend 2>/dev/null || ln -s /Users/ilpinto/dev/roaring-lions/art/blend art/blend
```
Then `ls art/blend/KDF/soldier` and `ls "art/blend/enemy/Sarim irregular"` must list the `Meshy_AI_*` folders the scripts' `SRC_DIR` constants name. `git status` must NOT show `art/blend` (it is in `.gitignore:78`).

- [ ] **Step 2: Soldier importer -- constants and the semantics rows**

`CLIP_ORDER = ("idle", "move", "fire", "moveFire", "down", "wreck", "fall")`.

After `FALL_SOURCE` add:

```python
#: Design D3 (`2026-09-17-infantry-animation-design.md`): the supplied fall is
#: bound WHOLE as `fall`, one-shot, with its horizontal root motion held
#: (`hold_hips_horizontal`), and `wreck` is that held clip's own last frame
#: -- so the runtime's switch from the finished fall to the persistent wreck
#: moves nothing. `FALL_SOURCE` is therefore read by two builders now.
FALL_STAGGER_S = 0.1
#: Clips whose figures start `FALL_STAGGER_S` apart (holding their first
#: frame) so a squad does not drop as three clones. Non-cyclic by nature.
STAGGERED_CLIPS = frozenset({"fall", "fallAlt"})
#: Metres the Hips may drift horizontally across a fall after the hold --
#: the runtime gate (`tools/src/mesh_gait.test.ts`) uses the same 0.05.
FALL_HORIZONTAL_CEILING_M = 0.05
```

Add to `CLIP_SEMANTICS` (after the `wreck` entry, same shape as the others; `"heading"` must be present and `None` so `mesh_gait.test.ts`'s `headingCeilings()` parser still finds every entry):

```python
    "fall": {
        "means": (
            "the supplied death fall, played ONCE by mesh-death.ts from standing to prone; "
            "Hips DROP by design (no vertical ceiling) but may not travel horizontally."
        ),
        "ceiling": lambda idle_travel: None,
        "horizontal_m": FALL_HORIZONTAL_CEILING_M,
        # A falling body turns; neither bearing is a thing to gate.
        "heading": None,
        "weapon": None,
    },
```

- [ ] **Step 3: Soldier importer -- the hold, the pose-action writer, and the horizontal travel**

Add after `_hips_world_z_travel`:

```python
def _hips_armature_translation(pose, hips_rest):
    """`Hips`' evaluated ARMATURE-space position for one sampled pose."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    q, loc, sc = pose["Hips"]
    return (hips_rest @ Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc))).translation


def hold_hips_horizontal(frames, hips_rest, anchor_pose):
    """A copy of `frames` with every frame's Hips armature-space x/y replaced
    by `anchor_pose`'s own, z (height) kept -- `import_meshy_yahalom.py`'s
    `build_wreck_src` re-centring, applied to EVERY frame of a fall rather
    than only its last. Hips is a root bone, so its own (quat, loc, scale)
    alone determines its pose matrix and the inverse is exact."""
    from mathutils import Vector  # noqa: PLC0415

    rot3 = hips_rest.to_3x3()
    inv = rot3.inverted()
    t_live = _hips_armature_translation(anchor_pose, hips_rest)
    out = []
    for pose in frames:
        t = _hips_armature_translation(pose, hips_rest)
        target = Vector((t_live.x, t_live.y, t.z))
        q, _loc, sc = pose["Hips"]
        held = dict(pose)
        held["Hips"] = (q, tuple(inv @ (target - hips_rest.translation)), sc)
        out.append(held)
    return out


def _hips_horizontal_travel_m(frames, hips_rest, arm_world):
    """Largest horizontal distance (world x/y, metres) the Hips get from
    their first-frame position across `frames` -- the number
    `CLIP_SEMANTICS[...]["horizontal_m"]` bounds."""
    from mathutils import Matrix, Quaternion, Vector  # noqa: PLC0415

    pts = []
    for f in frames:
        q, loc, sc = f["Hips"]
        world = arm_world @ (hips_rest @ Matrix.LocRotScale(Vector(loc), Quaternion(q), Vector(sc)))
        pts.append((world.translation.x, world.translation.y))
    x0, y0 = pts[0]
    return max(math.hypot(x - x0, y - y0) for x, y in pts)


def write_pose_action(arm, name, frames):
    """`frames` is a `sample_clip`-style list; writes them onto a new action,
    one keyframe per index -- `import_meshy_yahalom.py`'s `_write_pose_action`,
    copied verbatim."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data.action = action
    arm.animation_data.action_slot = None
    for i, pose in enumerate(frames):
        for pb in arm.pose.bones:
            q, loc, sc = pose[pb.name]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.scale = sc
            pb.keyframe_insert(data_path="rotation_quaternion", frame=i)
            pb.keyframe_insert(data_path="location", frame=i)
            pb.keyframe_insert(data_path="scale", frame=i)
    return action
```

Delete `build_wreck_src` (its docstring's history moves into `hold_hips_horizontal`'s).

In `check_clip_semantics`, after the Hips-travel `for name in CLIP_ORDER:` loop's ceiling check, add inside the same loop:

```python
        horizontal_ceiling = CLIP_SEMANTICS[name].get("horizontal_m")
        if horizontal_ceiling is not None:
            drift = _hips_horizontal_travel_m(frames_by_clip[name], hips_rest, arm_world)
            print(f"  {name}: Hips horizontal drift {drift:.4f} m (ceiling {horizontal_ceiling})")
            if drift > horizontal_ceiling:
                raise RuntimeError(
                    f"{name}: Hips drift {drift:.3f} m exceeds {horizontal_ceiling} m -- "
                    "the horizontal hold is not holding"
                )
```

- [ ] **Step 4: Soldier importer -- the stagger in `write_combined_clip`**

Change the signature to `def write_combined_clip(merged_arm, figures, clip_name, frames, cyclic=False, stagger=0):` and the loop to:

```python
    n = len(frames)
    total = n + stagger * (len(figures) - 1)
    for step in range(total):
        for i, (prefix, _dx, _dy) in enumerate(figures):
            if cyclic:
                shift = round(n * GAIT_PHASE_FRACTIONS[i % len(GAIT_PHASE_FRACTIONS)])
                sampled = frames[(step + shift) % n]
            else:
                # `stagger` frames per figure, first frame held until its turn.
                sampled = frames[min(n - 1, max(0, step - stagger * i))]
```

Add to the docstring: "`stagger` (frames, `fall`/`fallAlt` only): figure `i` holds `frames[0]` for `stagger * i` output frames and then plays; the clip grows by `stagger * (len(figures) - 1)` frames and every figure is at its own last frame by the end."

- [ ] **Step 5: Soldier importer -- `main()`**

Replace `wreck_src = build_wreck_src(scratch_arm, fall_src)` (`:2742`) with:

```python
    idle_frames = sample_clip(scratch_arm, idle_src)
    fall_frames = hold_hips_horizontal(sample_clip(scratch_arm, fall_src), hips_rest, idle_frames[0])
    fall_held_src = write_pose_action(scratch_arm, "fall_held_src", fall_frames)
    wreck_src = write_pose_action(scratch_arm, "wreck_src", [fall_frames[-1], fall_frames[-1]])
```

Add `"fall": fall_held_src,` to `src_by_clip`. Add `fall_held_src` to the cleanup tuple at `:2790`. In the export loop (`:2900`), change the `write_combined_clip(...)` call to pass `stagger=round(FALL_STAGGER_S * bpy.context.scene.render.fps) if clip_name in STAGGERED_CLIPS else 0`.

- [ ] **Step 6: Run the soldier importer**

Run it exactly as its module docstring shows (Blender `--background --python tools/import_meshy_soldier.py`).
Expected: the log prints `fall: Hips horizontal drift 0.0000 m` (or ≤ 0.05), the bearings table has a `fall` row marked "NOT gated (exempt)", and the final line lists `clips=['idle', 'move', 'fire', 'moveFire', 'down', 'wreck', 'fall']`. `art/meshes/meshy_soldier.glb` is rewritten.

- [ ] **Step 7: Falsify gate 7 on the soldier, then revert**

Temporarily make `hold_hips_horizontal` return `frames` unchanged and re-run: the build must RAISE `fall: Hips drift … exceeds 0.05 m` (record the measured drift — this is the root motion the sweep counted). Revert and re-run so the shipped file is the held one.

- [ ] **Step 8: Sarim importer -- the same edits, its own names**

- `CLIP_ORDER = ("idle", "move", "fire", "moveFire", "down", "wreck", "wreckAlt", "fall", "fallAlt")`.
- The same three constants after `FALL_SOURCE_ALT`.
- `CLIP_SEMANTICS` gains `"fall"` and `"fallAlt"` rows identical to the soldier's (the `fallAlt` `means` says "the SECOND supplied fall, the forward one, paired with wreckAlt").
- The same `_hips_armature_translation`, `hold_hips_horizontal`, `_hips_horizontal_travel_m`, `write_pose_action` after `_hips_world_z_travel` (`:1300`); delete `build_wreck_src` (`:722`).
- `check_clip_semantics` (`:1313`) gets the same horizontal block.
- `write_combined_clip` (`:1160`) gets the same `stagger` parameter and loop.
- In `main()` replace `:1603-1604` with:

```python
    idle_frames = sample_clip(scratch_arm, idle_src)
    fall_frames = hold_hips_horizontal(sample_clip(scratch_arm, fall_src), hips_rest, idle_frames[0])
    fall_alt_frames = hold_hips_horizontal(sample_clip(scratch_arm, fall_alt_src), hips_rest, idle_frames[0])
    fall_held_src = write_pose_action(scratch_arm, "fall_held_src", fall_frames)
    fall_alt_held_src = write_pose_action(scratch_arm, "fall_alt_held_src", fall_alt_frames)
    wreck_src = write_pose_action(scratch_arm, "wreck_src", [fall_frames[-1], fall_frames[-1]])
    wreck_alt_src = write_pose_action(scratch_arm, "wreck_alt_src", [fall_alt_frames[-1], fall_alt_frames[-1]])
```

  add `"fall": fall_held_src, "fallAlt": fall_alt_held_src,` to `src_by_clip`, the two new actions to the cleanup tuple (`:1632`), and the `stagger=` argument to the export loop's `write_combined_clip` call.

Run the Sarim importer per its docstring.
Expected: `clips=[…, 'wreck', 'wreckAlt', 'fall', 'fallAlt']`, both drift lines ≤ 0.05 m.

- [ ] **Step 9: Commit both importers and both files**

```bash
/usr/bin/git add tools/import_meshy_soldier.py tools/import_meshy_soldier_irregular.py art/meshes/meshy_soldier.glb art/meshes/sarim_rifles.glb
```
```bash
/usr/bin/git commit -m "art: the KDF soldier and the Sarim irregular play their supplied falls

fall (and fallAlt for the Sarim) bound whole, one-shot, horizontal root
motion held so the body dies where it stood; wreck/wreckAlt are now the
held fall's own last frame. Figures staggered 0.1 s. AI-generated
(Meshy), disclosed. Falsified: hold removed -> the build raises on the
measured drift (soldier <n> m).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Replace `<n>` with the number Step 7 printed. `rl_gait` on both files is stale until Task 8 re-runs the gait pass; do not run `pnpm test` on tools in between and expect green.)

---

### Task 7: The Yahalom engineer and the RPG team bind their falls (D3 assets, part 2)

**Files:**
- Modify: `tools/import_meshy_yahalom.py` (`CLIP_ORDER:144`, constants after `FALL_SOURCE:163`, `CLIP_SEMANTICS:188-225`, `build_wreck_src:697` deleted, `write_combined_clip:808`, `check_clip_semantics:848`, `main:~1075-1150`)
- Modify: `tools/units/import_meshy_rpg_team.py` (`CLIP_SOURCES:90`, `CLIP_ORDER:105`, `CLIP_STANDING:~108`, the clip loop `:~430-470`)
- Output: `art/meshes/yahalom_engineer.glb`, `art/meshes/rpg_team.glb`

**Interfaces:**
- Produces: `yahalom_engineer.glb` clips `idle, move, down, work, wreck, wreckAlt, fall, fallAlt`; `rpg_team.glb` clips `idle, move, fire, down, wreck, fall`.

- [ ] **Step 1: Yahalom importer**

- `CLIP_ORDER = ("idle", "move", "down", "work", "wreck", "wreckAlt", "fall", "fallAlt")`.
- After `FALL_SOURCE`: `FALL_SOURCE_ALT = SRC_PREFIX + "Shot_and_Fall_Forward_withSkin.glb"` (the file the module docstring's table lists as UNUSED — update that table: it is `fallAlt`/`wreckAlt` now), plus `FALL_STAGGER_S`, `STAGGERED_CLIPS`, `FALL_HORIZONTAL_CEILING_M` as in Task 6.
- `CLIP_SEMANTICS` gains `"wreckAlt"` (copy the `wreck` row), `"fall"` and `"fallAlt"` rows: this file's rows have only `means`/`ceiling`, so each fall row is `{"means": ..., "ceiling": lambda idle_travel: None, "horizontal_m": FALL_HORIZONTAL_CEILING_M}`.
- Replace `build_wreck_src` with `hold_hips_horizontal` (Task 6's, but this file already has `_pose_at`/`_write_pose_action`/`sample_clip`; the anchor is `living_pose = _pose_at(scratch_arm, move_src, 0)` exactly as the old `build_wreck_src` used) and `_hips_horizontal_travel_m`.
- `check_clip_semantics` (`:848`): the same horizontal block inside its loop.
- `write_combined_clip` (`:808`): the same `stagger` parameter.
- `main()`: replace `wreck_src = build_wreck_src(scratch_arm, fall_src, living_pose)` with:

```python
    fall_alt_src = import_clip(os.path.join(SRC_DIR, FALL_SOURCE_ALT), "fall_alt_src")  # beside the other import_clip calls
    ...
    fall_frames = hold_hips_horizontal(sample_clip(scratch_arm, fall_src), hips_rest, living_pose)
    fall_alt_frames = hold_hips_horizontal(sample_clip(scratch_arm, fall_alt_src), hips_rest, living_pose)
    fall_held_src = _write_pose_action(scratch_arm, "fall_held_src", fall_frames)
    fall_alt_held_src = _write_pose_action(scratch_arm, "fall_alt_held_src", fall_alt_frames)
    wreck_src = _write_pose_action(scratch_arm, "wreck_src", [fall_frames[-1], fall_frames[-1]])
    wreck_alt_src = _write_pose_action(scratch_arm, "wreck_alt_src", [fall_alt_frames[-1], fall_alt_frames[-1]])
```

  extend `src_by_clip` with `"wreckAlt"`, `"fall"`, `"fallAlt"`, the cleanup tuple with the four new actions and `fall_alt_src`, and the export loop's `write_combined_clip` with `stagger=`.

Run per its docstring (set `RL_YAHALOM_SRC` only if the symlinked default path does not resolve).
Expected: eight clips listed; both drift lines ≤ 0.05 m; the docstring's own "`Shot_and_Fall_Backward` carries real root motion — the Hips travel 1.34 m" is now exactly what the hold removes, so the falsification here is the same as Task 6 Step 7 and must raise at ~1.3 m.

- [ ] **Step 2: RPG team importer**

This script works on f-curves, not sampled poses. Changes:

- `CLIP_ORDER = ("idle", "move", "fire", "down", "wreck", "fall")`; `CLIP_STANDING["fall"] = True`.
- Constants `FALL_STAGGER_S = 0.1`, `FALL_HORIZONTAL_CEILING_M = 0.05`.
- A helper after `key_scale`:

```python
def hips_location_fcurves(act, bone):
    """The three `location` f-curves of `bone` in `act`, index-ordered."""
    fcs = [fc for fc in read_fcurves(act) if fc.data_path == f'pose.bones["{bone}"].location']
    fcs.sort(key=lambda fc: fc.array_index)
    if len(fcs) != 3:
        raise RuntimeError(f"{act.name}: expected 3 location f-curves on {bone}, got {len(fcs)}")
    return fcs


def held_hips_location(arm, prefix, src_act, frame, hold_xy):
    """`{prefix}_Hips`' pose-space location at `frame` of `src_act`, with its
    WORLD x/y replaced by `hold_xy` (z kept) -- the horizontal hold the
    sampled-pose importers do in `hold_hips_horizontal`, on an f-curve."""
    from mathutils import Matrix, Vector  # noqa: PLC0415

    rest = arm.data.bones[f"{prefix}_Hips"].matrix_local
    rot3 = rest.to_3x3()
    loc = Vector([fc.evaluate(frame) for fc in hips_location_fcurves(src_act, "Hips")])
    world = arm.matrix_world @ (rest @ Matrix.Translation(loc))
    target = arm.matrix_world.inverted() @ Vector((hold_xy[0], hold_xy[1], world.translation.z))
    return rot3.inverted() @ (target - rest.translation)
```

  (`src_act`'s curves still address `Hips`, not `{prefix}_Hips`: they are read BEFORE `retarget`; `arm` is `merged_arm` after `rename_bones`, so the rest matrix is looked up under the prefixed name. Verify against the file's own flow at `:436-470` and adjust which name each side uses.)

- In the clip loop, for a standing clip the source is `_fall` for everything but `move`. Add before the loop: `fall_start = int(src_actions["_fall"].frame_range[0])`, `stagger = round(FALL_STAGGER_S * bpy.context.scene.render.fps)`, and per figure `hold_xy = (world x, y of that figure's Hips at fall_start, computed once via the same rest/world composition)`. Then:
  - for `clip == "fall"`: `span = range(0, fall_end - fall_start + 1 + stagger * (len(FIGURES) - 1))`; for each source f-curve, insert keys at `f + stagger * i` for `f` in the fall's range, plus a held key at frame 0 (`fc.evaluate(fall_start)`) for figure `i > 0`; for the three `Hips.location` curves write `held_hips_location(...)[axis]` instead of the raw value.
  - for `down`/`wreck` (existing branch, `fc.evaluate(fall_end)` into `span = range(0, 2)`): the Hips location keys use `held_hips_location(merged_arm, prefix, src, fall_end, hold_xy)` so the corpse sits where the figure stood and equals the fall's last frame.
- After the loop, a build-time check mirroring `check_clip_semantics`: evaluate `{prefix}_Hips` world position across `fall`'s frames for each figure and raise if the horizontal drift exceeds `FALL_HORIZONTAL_CEILING_M`; log the number.

Run: `Blender --background --python tools/units/import_meshy_rpg_team.py -- art/meshes/rpg_team.glb`
Expected: `clip fall: standing geometry, … frames 0..N`, drift ≤ 0.05 m per figure, file written.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add tools/import_meshy_yahalom.py tools/units/import_meshy_rpg_team.py art/meshes/yahalom_engineer.glb art/meshes/rpg_team.glb
```
```bash
/usr/bin/git commit -m "art: the Yahalom engineer (both falls) and the RPG team play their supplied falls

Same shape as the soldier: held horizontally, staggered, wreck = the held
fall's last frame; the engineer's second fall becomes fallAlt/wreckAlt.
AI-generated (Meshy), disclosed. Falsified: hold removed on the engineer
raises at the 1.3 m its own docstring recorded.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: The fall gate on the shipped bytes, then gait pass, encode and the mesh gate (gate 3)

**Files:**
- Modify: `tools/src/mesh_gait.ts` (new exports after `measureRoleTravelByFigure`)
- Modify: `tools/src/mesh_gait.test.ts` (new `describe` after the facing sweeps)
- Output: `art/meshes/{meshy_soldier,sarim_rifles,yahalom_engineer,rpg_team}.glb` (gait pass re-declares `rl_gait`), `assets/meshes/*` (encoder)

**Interfaces:**
- Produces: `measureRootTravel(path, clip): RootTravel[]` with `interface RootTravel { root: string; horizontalM: number; startY: number; endY: number; liveAtStart: boolean }` (one per parentless joint of skin 0); `measureJointPoses(path, clip, at: 'start' | 'end'): JointPose[]` with `interface JointPose { name: string; translation: [number, number, number]; rotation: [number, number, number, number]; scale: number }`; `rotationDeltaDeg(a, b): number`; `clipSeconds(path, clip): number`.
- Consumes: `FALL_CLIPS` (Task 3), `RIGS` (existing).

- [ ] **Step 1: The measurement exports**

Append to `tools/src/mesh_gait.ts`:

```ts
export interface RootTravel {
  readonly root: string;
  /** Largest horizontal (x/z) distance from the first sample, metres. */
  readonly horizontalM: number;
  readonly startY: number;
  readonly endY: number;
  readonly liveAtStart: boolean;
}

/** The parentless joints of skin 0 -- one per figure on every shipped rig. */
function skinRoots(glb: GlbFile): number[] {
  const nodes = glb.json.nodes ?? [];
  const skin = glb.json.skins?.[0];
  if (!skin) throw new Error('no skin');
  const jointSet = new Set(skin.joints);
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => { for (const c of n.children ?? []) parent[c] = i; });
  return skin.joints.filter((j) => parent[j] < 0 || !jointSet.has(parent[j]));
}

/** Where each figure's root joint goes over `clip`: the fall gate's
 *  "no horizontal root motion, starts standing, ends prone" instrument. */
export function measureRootTravel(path: string, clip: string): RootTravel[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const { tracks, start, end } = readClip(glb, clip);
  const roots = skinRoots(glb);
  const first = nodeWorlds(glb, tracks, start);
  const out = roots.map((r) => ({
    root: nodes[r]?.name ?? `node${r}`,
    x0: first[r][12], y0: first[r][13], z0: first[r][14],
    liveAtStart: jointScale(first[r]) > HIDDEN_SCALE,
    horizontalM: 0, endY: first[r][13],
  }));
  for (let s = 1; s <= SAMPLES; s++) {
    const t = start + ((end - start) * s) / SAMPLES;
    const worlds = nodeWorlds(glb, tracks, t);
    roots.forEach((r, i) => {
      const m = worlds[r];
      const o = out[i];
      o.horizontalM = Math.max(o.horizontalM, Math.hypot(m[12] - o.x0, m[14] - o.z0));
      o.endY = m[13];
    });
  }
  return out.map((o) => ({ root: o.root, horizontalM: o.horizontalM, startY: o.y0, endY: o.endY, liveAtStart: o.liveAtStart }));
}

export function clipSeconds(path: string, clip: string): number {
  const glb = readGlb(path);
  const { start, end } = readClip(glb, clip);
  return end - start;
}

export interface JointPose {
  readonly name: string;
  readonly translation: [number, number, number];
  /** Unit quaternion (x, y, z, w) of the world rotation, scale removed. */
  readonly rotation: [number, number, number, number];
  readonly scale: number;
}

function quatFromMat(m: Mat4, scale: number): [number, number, number, number] {
  const s = scale > 0 ? 1 / scale : 0;
  const m00 = m[0] * s, m01 = m[4] * s, m02 = m[8] * s;
  const m10 = m[1] * s, m11 = m[5] * s, m12 = m[9] * s;
  const m20 = m[2] * s, m21 = m[6] * s, m22 = m[10] * s;
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const k = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / k; x = (m21 - m12) * k; y = (m02 - m20) * k; z = (m10 - m01) * k;
  } else if (m00 > m11 && m00 > m22) {
    const k = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / k; x = 0.25 * k; y = (m01 + m10) / k; z = (m02 + m20) / k;
  } else if (m11 > m22) {
    const k = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / k; x = (m01 + m10) / k; y = 0.25 * k; z = (m12 + m21) / k;
  } else {
    const k = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / k; x = (m02 + m20) / k; y = (m12 + m21) / k; z = 0.25 * k;
  }
  return [x, y, z, w];
}

/** Every skin-0 joint's world pose at the first or last frame of `clip`. */
export function measureJointPoses(path: string, clip: string, at: 'start' | 'end'): JointPose[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const skin = glb.json.skins?.[0];
  if (!skin) throw new Error(`${path}: no skin`);
  const { tracks, start, end } = readClip(glb, clip);
  const worlds = nodeWorlds(glb, tracks, at === 'start' ? start : end);
  return skin.joints.map((j) => {
    const m = worlds[j];
    const scale = jointScale(m);
    return {
      name: nodes[j]?.name ?? `node${j}`,
      translation: [m[12], m[13], m[14]],
      rotation: quatFromMat(m, scale),
      scale,
    };
  });
}

/** Angle between two unit quaternions, degrees, sign-agnostic. */
export function rotationDeltaDeg(a: readonly number[], b: readonly number[]): number {
  const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(d) * 180) / Math.PI;
}
```

(`jointScale`, `HIDDEN_SCALE`, `SAMPLES`, `readClip`, `nodeWorlds`, `Mat4` already exist in the file above this point.)

- [ ] **Step 2: The gate**

Append to `tools/src/mesh_gait.test.ts`:

```ts
describe('mesh unit death -- the fall clips (design D3, gate 3)', () => {
  const FALL_FILES = ['meshy_soldier.glb', 'rpg_team.glb', 'sarim_rifles.glb', 'yahalom_engineer.glb'];
  const FALL_ALT_FILES = ['sarim_rifles.glb', 'yahalom_engineer.glb'];
  const withFall = RIGS.filter((r) => r.clips.includes('fall'));
  const withFallAlt = RIGS.filter((r) => r.clips.includes('fallAlt'));

  it('exactly the four Meshy bipeds carry fall, and the two with a second fall carry fallAlt', () => {
    expect(withFall.map((r) => r.file).sort()).toEqual(FALL_FILES);
    expect(withFallAlt.map((r) => r.file).sort()).toEqual(FALL_ALT_FILES);
  });

  it('fallAlt implies wreckAlt, and fall + wreckAlt implies fallAlt -- the pick has one bit', () => {
    for (const r of withFallAlt) expect(r.clips, r.file).toContain('wreckAlt');
    for (const r of withFall) if (r.clips.includes('wreckAlt')) expect(r.clips, r.file).toContain('fallAlt');
    for (const r of withFall) expect(r.clips, r.file).toContain('wreck');
  });

  const pairs = [
    ...withFall.map((r) => [r.file, 'fall', 'wreck', r] as const),
    ...withFallAlt.map((r) => [r.file, 'fallAlt', 'wreckAlt', r] as const),
  ];

  it.each(pairs)('%s %s: 0.5-2.0 s, starts standing, ends prone, no horizontal root motion', (_file, clip, _wreck, r) => {
    const seconds = clipSeconds(r.path, clip);
    expect(seconds).toBeGreaterThanOrEqual(0.5);
    expect(seconds).toBeLessThanOrEqual(2.0);
    const idle = measureRootTravel(r.path, 'idle');
    const fall = measureRootTravel(r.path, clip);
    const live = fall.filter((f) => f.liveAtStart);
    expect(live.length, `${r.file}: live figure roots`).toBeGreaterThan(0);
    for (const f of live) {
      const rest = idle.find((i) => i.root === f.root);
      expect(rest, `${r.file} ${clip}: ${f.root} has no idle counterpart`).toBeDefined();
      // Falsified by pointing this at 'move': the run reads metres, not centimetres.
      expect(f.horizontalM, `${r.file} ${clip} ${f.root}: horizontal drift`).toBeLessThan(0.05);
      expect(Math.abs(f.startY - (rest as RootTravel).startY) / (rest as RootTravel).startY, `${r.file} ${clip} ${f.root}: starts standing`).toBeLessThan(0.1);
      expect(f.endY, `${r.file} ${clip} ${f.root}: ends prone`).toBeLessThanOrEqual(0.35);
    }
  });

  it.each(pairs)('%s %s: its last frame IS %s -- hips within 1 cm, every live joint within 1 degree', (_file, clip, wreck, r) => {
    const end = measureJointPoses(r.path, clip, 'end');
    const corpse = measureJointPoses(r.path, wreck, 'start');
    expect(corpse.map((j) => j.name)).toEqual(end.map((j) => j.name));
    let compared = 0;
    for (let i = 0; i < end.length; i++) {
      if (end[i].scale <= 1e-6 || corpse[i].scale <= 1e-6) continue;
      compared++;
      const dt = Math.hypot(...end[i].translation.map((v, k) => v - corpse[i].translation[k]));
      expect(dt, `${r.file} ${clip}->${wreck} ${end[i].name}: translation`).toBeLessThan(0.01);
      // Falsified by comparing against 'idle' instead of the wreck: tens of degrees.
      expect(rotationDeltaDeg(end[i].rotation, corpse[i].rotation), `${r.file} ${clip}->${wreck} ${end[i].name}: rotation`).toBeLessThan(1);
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('no kit rig, civilian, sniper, mortar team or motorcycle acquired a fall by accident', () => {
    for (const r of RIGS) {
      if (FALL_FILES.includes(r.file)) continue;
      for (const c of r.clips) expect(FALL_CLIPS.has(c), `${r.file} ${c}`).toBe(false);
    }
  });
});
```

Import `measureRootTravel`, `measureJointPoses`, `rotationDeltaDeg`, `clipSeconds`, `type RootTravel` from `./mesh_gait`.

- [ ] **Step 3: Gait pass, encode, then the gate**

Run, in this order:
```bash
pnpm gait:meshes -- --id=inf_squad --id=sarim_rifles --id=yahalom_squad --id=rpg_team
```
```bash
pnpm encode:meshes
```
```bash
pnpm --filter @lions/tools test -- mesh_gait
```
Expected: the four files re-declare `rl_gait` (the pass prints each stride), the encoder mirrors every changed file, and the whole gait spec passes — including the existing declared-vs-measured checks, which would have failed on the un-passed re-exports.

- [ ] **Step 4: Falsify gate 3, then revert**

1. In the 'no horizontal root motion' test change `measureRootTravel(r.path, clip)` to `measureRootTravel(r.path, 'move')`: FAIL on every pair (a run travels metres). Revert.
2. In the 'last frame IS' test change `measureJointPoses(r.path, wreck, 'start')` to `measureJointPoses(r.path, 'idle', 'start')`: FAIL. Revert.

- [ ] **Step 5: The mesh gate and the shipped-death test**

Run: `pnpm validate:meshes` (needs Blender; ~45–70 s) and `pnpm --filter @lions/render test -- mesh-team-death-shipped mesh-vehicle-shipped civilian-mesh-shipped`
Expected: PASS. The importers moved no geometry, so no silhouette pair changes; a red there means an importer changed something else. `tools/src/unit_icons.test.ts` is unaffected (icons come from sprite sheets).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tools/src/mesh_gait.ts tools/src/mesh_gait.test.ts art/meshes/meshy_soldier.glb art/meshes/sarim_rifles.glb art/meshes/yahalom_engineer.glb art/meshes/rpg_team.glb assets/meshes
```
```bash
/usr/bin/git commit -m "test: the fall clips are gated on the shipped bytes; gait re-declared, mirror re-encoded

Four files carry fall (two carry fallAlt); each starts standing, ends
prone, drifts under 5 cm, lasts 0.5-2 s, and ends in exactly its wreck
pose. Falsified: drift check pointed at move (metres), pose check
against idle (tens of degrees).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 9: Crew figures get a standing walker for `move` in `rig.py` — then HALT for the lead's numbers (D6, part 1)

**Files:**
- Modify: `tools/units/rig.py` (`_f:1044`, the three crew entries `:1105-1140`, `_add_figure:1231`, `_key_death_visibility:1898`, `build_move_clip:1976`, `build_and_export:2337`; `_KNEEL_BONES` docstring `:375`)

**Interfaces:**
- Produces: `_f(..., move_posture=None)`; `spec["move_posture"] == "standing"` builds a second, standing body under `{prefix}w_root` (`_standing_bones(f"{prefix}w", x, y)`), kept for `move` only; `_walker_specs(figures)`; `_key_death_visibility(pbones, figures, has_prop, alive, frame=0, moving=False)`; `print_crew_gait_table(team_ids)`.
- Task 10 consumes all of it. Nothing is exported in this task.

Shape, so nobody re-derives it: the kneeling body and its own kneel skeleton stay exactly as built today (they still breathe in `idle` and stay deployed in `fire`). A THIRD root is added beside `root`/`death_root`: a full standing walker, `kit.figure(posture="standing")` bound to `_standing_bones` under the prefix `{prefix}w`, so its parts and bones collide with nothing. Visibility per clip: `idle`/`fire` → `{prefix}_root 1, {prefix}w_root 0, death 0`; `move` → `0, 1, 0`; `down`/`wreck` → `0, 0, 1`. The team's `prop` bone (deployed launcher/mortar) is keyed 0 on `move` for a team that has walkers. The digger's spoil heap is on the `ground` bone, keyed by nothing, and stays.

- [ ] **Step 1: The spec field and the three entries**

`_f` gains `move_posture=None` and stores it: `move_posture=move_posture` in the returned dict. In `TEAM_FIGURES`, add `move_posture="standing"` to every `_f(...)` of `mortar_crew`, `atgm_cell` and `digger_crew` (six calls). Replace the `digger_crew` entry's "deliberate simplification" comment with: "Stands to relocate for `move`, as `teams.digger_crew` itself does -- design D6 (`2026-09-17-infantry-animation-design.md`); the walker is the third root `_add_figure` builds."

- [ ] **Step 2: The walker in `_add_figure`**

Add before `_add_figure`:

```python
def _walker_prefix(spec):
    return f"{spec['prefix']}w"


def _walker_specs(figures):
    """A synthetic standing spec per figure that walks standing (design D6):
    same placement, prefix `{prefix}w`, `animates=True`, no weapon, no
    death parts of its own (the kneeling half already owns the corpse)."""
    return [
        dict(s, prefix=_walker_prefix(s), posture="standing", animates=True, weapon=None, move_posture=None)
        for s in figures if s.get("move_posture") == "standing"
    ]
```

In `_add_figure`, after `parts += death_parts` and before `return`, add:

```python
    if spec.get("move_posture") == "standing":
        assert spec["posture"] == "kneeling", spec
        wp = _walker_prefix(spec)
        walker = kit.figure(
            wp, (spec["x"], spec["y"], 0.0), posture="standing", yaw=0.0,
            headgear=spec["headgear"], stride=0.0, arms=True, leader=spec["leader"],
            mirror=spec["mirror"], loadout=spec["loadout"], smoke=None,
        )
        parts += walker
        bones += _standing_bones(wp, spec["x"], spec["y"])
```

(`rig_parts` binds the walker's parts through `PART_BONE` against the `{prefix}w` prefix -- Step 4 adds that prefix to `figure_prefixes`; `_death_root_bone`/`_figure_death_parts` are NOT called for the walker.)

- [ ] **Step 3: Visibility keys the third root; `move` walks it**

Replace `_key_death_visibility`'s body with:

```python
    alive_scale = 1.0 if alive else 0.0
    dead_scale = 0.0 if alive else 1.0
    walkers = False
    for spec in figures:
        prefix = spec["prefix"]
        has_walker = spec.get("move_posture") == "standing"
        walkers = walkers or has_walker
        # A figure with a walker shows its deployed body in every living
        # clip but `move`, where the walker shows instead (design D6).
        deployed = alive_scale if not (has_walker and moving) else 0.0
        _key_scale(pbones[f"{prefix}_root"], deployed, _VIS_FRAMES)
        _key_scale(pbones[f"{prefix}_death_root"], dead_scale, _VIS_FRAMES)
        if has_walker:
            _key_scale(pbones[f"{_walker_prefix(spec)}_root"], 1.0 if (alive and moving) else 0.0, _VIS_FRAMES)
    if has_prop:
        # The deployed launcher/mortar is carried, not modelled, while a crew
        # walks -- a tripod gliding beside a walking crew is the bug D6 fixes.
        _key_scale(pbones["prop"], 0.0 if (moving and walkers) else alive_scale, _VIS_FRAMES)
```

and its signature to `def _key_death_visibility(pbones, figures, has_prop, alive, frame=0, moving=False):` (docstring: add the `moving` sentence).

In `build_move_clip`: the visibility call becomes `_key_death_visibility(pbones, figures, "prop" in pbones, alive=True, moving=True)` and `walkers = [s for s in figures if s["animates"]]` becomes `walkers = [s for s in figures if s["animates"]] + _walker_specs(figures)`. Nothing else in the loop changes: every bone it keys is `{walker prefix}_thigh_L` etc., which `_standing_bones` built.

- [ ] **Step 4: Bind the walker parts**

In `build_and_export`, replace `figure_prefixes = {spec["prefix"] for spec in TEAM_FIGURES[team_id]}` with:

```python
    figure_prefixes = {spec["prefix"] for spec in TEAM_FIGURES[team_id]}
    figure_prefixes |= {s["prefix"] for s in _walker_specs(TEAM_FIGURES[team_id])}
```

(`rig_parts` sorts prefixes longest-first, so `atgm_crew0w` matches its own parts before `atgm_crew0` can.)

- [ ] **Step 5: The numbers table, and the halt**

Add to `rig.py`:

```python
def print_crew_gait_table(team_ids):
    """The numbers the project lead approves BEFORE Blender renders a crew
    walker (memory: approve art numbers before rendering): standing height,
    the stride `gait_amplitudes` sizes from the unit's own speed, whether
    the thigh cap clipped it, and the cycle length."""
    print("team          speed  ground/cycle  stride scale  capped  cycle s  standing m")
    for team_id in team_ids:
        g = gait_for_team(team_id)
        print(
            f"{team_id:12s}  {g['speed']:5.2f}  {g['ground_m']:12.3f}  {g['scale']:12.3f}  "
            f"{'yes' if g['capped'] else 'no ':6s}  {move_seconds():7.3f}  {kit.FIGURE_H:10.3f}"
        )
```

(`kit.FIGURE_H` is `kit.py`'s own standing height, 1.8 m -- the number every rifleman is built to.)

Run it inside Blender without exporting anything:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python-expr "import sys; sys.path.insert(0, 'tools/units'); sys.path.insert(0, 'tools'); import rig; rig.print_crew_gait_table(['atgm_cell', 'mortar_crew', 'digger_crew'])"
```

Expected: three rows. Speeds 0.7 / 0.6 / 0.5 tiles/s.

- [ ] **Step 6: Commit the rig change, then STOP**

Run: `python3 -c "import ast,sys; ast.parse(open('tools/units/rig.py').read())"` (syntax only — Blender is what imports it) and `pnpm --filter @lions/tools test -- mesh_gait` (still green: no file changed).

```bash
/usr/bin/git add tools/units/rig.py
```
```bash
/usr/bin/git commit -m "art(rig): crew figures carry a standing walker for move (not yet exported)

A third root per figure with move_posture='standing': kneeling body for
idle/fire, walker for move, prone corpse for down/wreck; the deployed prop
hides while the crew walks. print_crew_gait_table prints the numbers the
lead approves before any export.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**HALT.** Put the table in front of the project lead with the three look calls (deployed weapon hidden on `move`; standing height 1.8 m; stride from speed, capped or not) and wait. The `blender-art` agent takes the approval from the lead directly. Do not start Task 10 on a relayed "ok".

---

### Task 10: Export the three crews, pass and encode them, and let the gait gate demote its own exemptions (D6, part 2; gate 8)

**Files:**
- Output: `art/meshes/atgm_cell.glb`, `art/meshes/mortar_crew.glb`, `art/meshes/digger_crew.glb`, `assets/meshes/*`
- Modify: `tools/src/mesh_gait.test.ts:706-713` (`GAIT_EXEMPT`), `:984`, `:1000` (counts), plus any outlier table a fresh measurement demands

**Interfaces:**
- Consumes: Task 9's rig, the lead's approval.
- Produces: three GLBs with a real `move`, `rl_gait.move` declared on each; `GAIT_EXEMPT` = `{ moto_rpg }`.

- [ ] **Step 1: Export**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/export_mesh_team.py -- atgm_cell mortar_crew digger_crew
```
Expected: three `[team] wrote art/meshes/<team>.glb` lines, each `gait[<team>] speed=… scale=…` line matching the approved table, and `rig_parts` raising on nothing (an unmapped walker part is the failure to expect first; fix `figure_prefixes`, not `PART_BONE`).

- [ ] **Step 2: Gait pass, then encode**

```bash
pnpm gait:meshes -- --id=atgm_cell --id=mortar_crew --id=digger_crew
```
```bash
pnpm encode:meshes
```
Expected: the pass prints a `move` stride for each (it used to skip them as "no boot travel" — `MIN_GAIT_TRAVEL_M`), and the encoder mirrors them.

- [ ] **Step 3: Let the gate demote the exemptions**

Run: `pnpm --filter @lions/tools test -- mesh_gait`
Expected: FAIL in 'every rigged type is either gaited or exempt with a stated reason' — the three now DECLARE a gait while still listed. That is the demotion assertion working. Then:
- delete the `atgm_cell`, `mortar_crew`, `digger_crew` entries from `GAIT_EXEMPT` (leave `moto_rpg`);
- `expect(new Set(declaring).size).toBe(12)` → `15`; `expect(gaited).toHaveLength(15)` → `18`;
- re-run. Any remaining red is a real measurement (cadence band, ground coverage per figure, facing on the walker's `{prefix}w_head`, the weapon-axis sweep if it lists these files): record the measured number in the relevant outlier table WITH a reason, exactly as the existing entries do, and never widen a band. If the kneeling figure reads as `hiddenInClip` on `move` and the walker as visible, that is the mortar-team precedent and correct.

- [ ] **Step 4: The mesh gate and a look**

Run: `pnpm validate:meshes`
Expected: PASS. Then `npx tsx tools/src/perf/death-captures.ts --label=after --only=atgm_cell` (and the other two) and look at the `walk` cells: a standing figure mid-stride, no tripod beside it.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add art/meshes/atgm_cell.glb art/meshes/mortar_crew.glb art/meshes/digger_crew.glb assets/meshes tools/src/mesh_gait.test.ts
```
```bash
/usr/bin/git commit -m "art: atgm_cell, mortar_crew and digger_crew walk instead of sliding

Exported with the approved numbers (<stride/cycle per team>), gait-passed
and encoded. GAIT_EXEMPT shrinks to moto_rpg; its demotion assertion went
red on the three stale entries before they were deleted.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 11: The "after" sheet, the perf reading, sim silence, and the docs (gates 9–11)

**Files:**
- Output (gitignored): `.superpowers/art-captures/infantry-anim/after/`, `.superpowers/perf-after.json`
- Modify: `docs/PERFORMANCE.md` (new section before "## Known limitations of this evidence"), `CLAUDE.md:1205-1216` (the death bullet) and the gait bullet's "the four crew-served/motorcycle files" sentence

**Interfaces:**
- Consumes: Task 1's `before` sheet and `perf-before.json`.

- [ ] **Step 1: The AFTER sheet**

Run: `npx tsx tools/src/perf/death-captures.ts --label=after`
Expected: the same cell set as `before`. Read `after/sheet.md`'s `phase` column: the four Meshy subjects show `falling` at 0.15–0.5 s and `settling` by 1.5 s; `militia_cell`, `moto_rpg`, `civilians` show `toppling` at 0.15–0.25 s; `sniper_team` shows `settling` from 0.15 s; the `killed` cell's topple points away from the tank (north of it, so the body falls south); the three `walk` cells show a standing stride. Open the six matching before/after pairs at z2.5 and confirm by eye. Put both sheet paths in the task report.

- [ ] **Step 2: The AFTER perf reading**

Run: `npx tsx tools/src/perf/backend-curve-gate.ts --port=5190 --out=.superpowers/perf-after.json`
Expected: `measureThreeMesh` at the 300 checkpoint, `render p95`, within +0.5 ms of Task 1's `perf-before.json` on the same machine with the hardware GPU confirmed. If it is over, that is a finding to report with both numbers, not a threshold to move.

- [ ] **Step 3: Sim silence**

Run all three:
```bash
pnpm test:determinism
```
```bash
pnpm playtest
```
```bash
pnpm balance
```
Expected: the golden hash unchanged, the playtest table byte-identical to `main`'s (compare against a run on the base commit if in doubt), balance targets unchanged. `git diff --stat main -- packages/sim` must be empty.

- [ ] **Step 4: Docs**

`docs/PERFORMANCE.md`: add before "## Known limitations of this evidence":

```markdown
## Infantry animation: crossfades and falls (2026-09-17)

`worktree-art-phase1-infantry` (design `2026-09-17-infantry-animation-design.md`)
made every clip change a 150 ms blend (two actions evaluated per figure for
the window), replaced the 0.04 s death swap with a supplied fall or a
0.5 s topple, and gave three crews a real walk. Same instrument and
conditions as "Backend curve" above (`backend-curve-gate.ts`, hardware GPU
confirmed), before at the branch base and after at its head:

| checkpoint | living | render p95 before | render p95 after |
|---|---|---|---|
| 300 | <n> | <ms> | <ms> |

<one sentence on whether the +0.5 ms budget held, and what the transitions
cost when measured>.
```

`CLAUDE.md`: in the "Known scaling debts" death bullet (`:1205-1216`), after "`units/mesh-death.ts` plays them: 0.4 s fade, then a persistent `MeshWreck`." add: "**Since 2026-09-17 that is the exception, not the rule** (design `2026-09-17-infantry-animation-design.md`): the four Meshy bipeds carry `fall`/`fallAlt` (contract v4) and play them once, every other rig topples per figure about its own feet away from its killer over 0.5 s, and neither path fades — the fade survives only for evacuation and for a body with no wreck (civilians). Clip changes crossfade over 150 ms unless the two clips key different bone scales, which is decided from the bytes at load (`mesh-clip.ts`'s `scaleSignature`)." In the gait bullet, change "the four crew-served/motorcycle files" to "the motorcycle (the three crews walk since 2026-09-17, on a third root per figure)".

- [ ] **Step 5: Full gates, then commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui && pnpm validate:data`
Expected: clean.

```bash
/usr/bin/git add docs/PERFORMANCE.md CLAUDE.md
```
```bash
/usr/bin/git commit -m "docs: infantry animation measured -- perf entry, CLAUDE.md death and crew lines current

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review (done while writing; kept so the executor knows what was checked)

- **Spec coverage.** D1 → Task 2; D2 → Task 2; D3 → Tasks 3, 6, 7, 8; D4 → Task 4; D5 → Task 5; D6 → Tasks 9, 10; §3.5 sim silence → Task 11; gates 1–2 → Task 2, 3 → Task 8, 4 → Task 4, 5–6 → Task 5, 7 → Tasks 6–7, 8 → Task 10, 9 → Tasks 1 and 11, 10 → Tasks 1 and 11, 11 → Task 11; spec §5 build order kept except the capture instrument, which runs FIRST because "before" cannot be produced by GLB interception (two of the three changes are runtime code).
- **Names used across tasks.** `applyMeshClip(player, desired, { once?, cut? })`, `advanceMeshClipFades`, `ClipPlayer.clipScale`/`.fades`, `MeshUnitTemplate.clipScale`, `pickDeathClips` → `DeathClipPick { fall, wreck }`, `KillerRef`, `DyingMeshUnit.phase` (`'falling' | 'toppling' | 'fading' | 'settling'`), `ToppleState.{direction, figures, totalSeconds, liveRoots, corpseYaw}`, `TOPPLE_SECONDS`, `TOPPLE_STAGGER_SECONDS`, `FALL_CLIPS`, `measureRootTravel`/`measureJointPoses`/`rotationDeltaDeg`/`clipSeconds`, `hold_hips_horizontal`/`write_pose_action`/`_hips_horizontal_travel_m`/`FALL_STAGGER_S`/`STAGGERED_CLIPS`/`FALL_HORIZONTAL_CEILING_M`, `_walker_specs`/`_walker_prefix`/`print_crew_gait_table`, `_key_death_visibility(..., moving=False)` — each defined in the task that first needs it and spelled the same afterwards.
- **Known soft spots, stated rather than hidden.** (a) The RPG importer works on f-curves and Task 7 Step 2 gives the helper and the rule but not a line-by-line diff of its clip loop; the implementer reads `:436-470` and adapts. (b) `mesh_gait.test.ts` line numbers are as of the branch base; grep for `CORPSE_CLIPS`, `GAIT_EXEMPT`, `declaring` rather than trusting them. (c) The `killed` capture cell depends on a tank killing a squad inside 600 ticks; if it does not, the sheet notes it and the direction test in Task 5 is the proof instead.

