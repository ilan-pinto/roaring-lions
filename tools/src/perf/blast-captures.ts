/**
 * The blast contact sheet: ten seconds of motion after a vehicle dies and
 * after a mortar bomb lands, before and after the WP-A1.2 art change
 * (`docs/superpowers/specs/2026-09-19-art-blast-design.md`, Decisions R-E,
 * R-L, R-M).
 *
 *   pnpm blast:capture -- --label=before
 *   pnpm blast:capture -- --label=after --only=mbt_lavi
 *
 * R-L is why this file exists at all: the golden visual gate is structurally
 * blind to this package. `VEHICLE_SCENARIO` parks the sandbox force at tick
 * 140 with nothing dying and no indirect round in the air, and `combat` --
 * the one capture with real kills -- is `gated: false` with no layer checks
 * because its scene does not hold still. So a blast appears in no gated
 * frame, and this sheet is the only visual evidence the project can produce
 * for the work. R-E makes the BEFORE set come first, at the branch base:
 * an instrument built after the change is an instrument nobody can trust to
 * have seen the change.
 *
 * ## This is a retarget of `death-captures.ts`, not a new instrument
 *
 * Three behaviours are INHERITED from that file rather than re-derived here,
 * and each one was paid for once already:
 *
 * 1. **The frame loop is frozen with `FREEZE_FRAME_LOOP_SCRIPT`**, never a
 *    `sleep()`. `step()`'s own paint must be the last paint, or the picture
 *    is whichever frame the compositor happened to hold -- the failure that
 *    cost the golden gate a 28% false-red rate
 *    (`capture-protocol.ts`'s own note).
 * 2. **Every frame after that is pumped EXPLICITLY** (`renderer.frame(1,
 *    FRAME_MS)`), because rAF is throttled in a hidden tab and a
 *    frame-driven read comes back stale with no error.
 * 3. **The subjects are spawned, never found.** The sandbox force's own
 *    vehicles are placed by the map, several of the interesting ones are
 *    hostile, and a hostile draws nothing until a friendly sees its tile.
 *    A side-0 parade on the open northern band (rows 0-7 of
 *    `beit_sahwan_outskirts` are open ground end to end) is visible by
 *    construction and at a tile the camera can be centred on exactly --
 *    `wreck-captures.ts`'s reasoning, unchanged.
 *
 * ## What differs from the infantry sheet
 *
 * **The window is ten seconds, not 1.5.** G0 #14: the lead judges this on
 * motion, and the thing being judged is a smoke column that is supposed to
 * outlive the fireball by twenty times. 200 ms is the coarsest step at which
 * a 450 ms fireball (`EXPLOSION_BURST_DEFAULT_DURATION_MS`) still lands on
 * more than one frame; a ladder that could miss it entirely would photograph
 * the smoke and call it a blast.
 *
 * **One subject is not a unit at all.** `mode: 'impact'` drives a real
 * `mortar_team` to fire a real round and starts its ladder on the frame
 * `shellHasLanded` fires (`ThreeRenderer.updateFx`), which is the frame
 * `spawnShellImpactFx` spawns the burst on. There is no attack-ground
 * command in this sim, so the tube has to ACQUIRE something: a `digger_crew`
 * stands at the impact tile as bait (the one hostile in the roster with no
 * weapons at all, so it cannot shoot the tube off its feet while the round
 * is in the air) and is taken off the field with `removeFromPlay` -- an
 * abduction, not a death, so no wreck and no death clip -- the moment the
 * bomb is up. The bomb therefore lands on genuinely empty ground.
 *
 * **It runs the R-M toggle A/B**, and on the before-set that reports two
 * zeroes with a reason attached, because neither layer exists yet. That is
 * the correct before-reading, not a failure.
 *
 * ## The one uncertainty, measured rather than assumed
 *
 * `__lions.step(n)` ends with `renderer.frame(1, lastFrameMs)`, and
 * `lastFrameMs` is a closure variable in `main.ts` this harness cannot read
 * or set. A kill has to go through one `step(1)` (the `destroyed` event is
 * drained inside `runTick`), so the burst is already `lastFrameMs` old on
 * the frame it first draws. The FX managers are handed the RAW `dtMs`
 * (`updateFx`: `explosionBursts.step(dtMs)`), and `smokeClockMs` accumulates
 * exactly that same raw total -- so the offset is READ, once, from a dry
 * `step(1)` at boot, printed, written into the sheet, and compensated for:
 * every ladder rung from the second onwards lands on its nominal age
 * exactly, and rung zero records the age it actually has.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// The pure half. Imported by `blast-captures.test.ts`, which must not pull
// playwright into `pnpm test` -- so everything browser-shaped below is behind
// a dynamic import inside `main()`, the way `baseline.test.ts` keeps
// `capture-protocol.ts` importable without `browser.ts`.
// ---------------------------------------------------------------------------

/** The window the lead judges on (G0 #14), in milliseconds. */
export const SAMPLE_WINDOW_MS = 10_000;
/** The rung spacing. See `SAMPLE_MS`. */
export const SAMPLE_EVERY_MS = 200;

/**
 * The sample times, inclusive of both ends.
 *
 * Starts at 0 deliberately: frame zero is the only frame that shows the
 * flash, and a ladder that began at `everyMs` would photograph a blast whose
 * first act had already happened.
 *
 * Refuses a step that does not divide the window rather than silently
 * truncating -- a ladder that stops at 9.9 s of a 10 s window is a sheet
 * whose last rung is not the rung anyone quoted.
 */
export function sampleLadder(windowMs: number, everyMs: number): number[] {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`sampleLadder: windowMs must be a positive finite number, got ${windowMs}`);
  }
  if (!Number.isFinite(everyMs) || everyMs <= 0) {
    throw new Error(`sampleLadder: everyMs must be a positive finite number, got ${everyMs}`);
  }
  if (windowMs % everyMs !== 0) {
    throw new Error(
      `sampleLadder: a step of ${everyMs} ms does not divide a ${windowMs} ms window evenly ` +
        `(${windowMs} % ${everyMs} = ${windowMs % everyMs}). Pick a step that divides it, rather ` +
        'than accepting a ladder whose last rung is not the end of the window.'
    );
  }
  const out: number[] = [];
  for (let ms = 0; ms <= windowMs; ms += everyMs) out.push(ms);
  return out;
}

/** The ten-second ladder every subject is photographed on. 51 rungs. */
export const SAMPLE_MS: readonly number[] = sampleLadder(SAMPLE_WINDOW_MS, SAMPLE_EVERY_MS);

export type BlastMode = 'kill' | 'impact';

export interface BlastSubject {
  /** The unit type this subject is about. Distinct across the set, because
   *  `--only=<id>` selects on it. */
  readonly id: string;
  readonly mode: BlastMode;
  /** The tile the blast happens on, and the tile the camera is centred on.
   *  For `kill` that is where the vehicle stands; for `impact` it is where
   *  the bomb lands. */
  readonly x: number;
  readonly y: number;
  /** One line for the sheet: why this subject is in the set. */
  readonly why: string;
  /** `impact` only: how far west of the impact tile the tube stands. It has
   *  to clear the weapon's own `min_range_tiles` (`mortar_60`: 4) and sit
   *  inside its `sight_tiles` (7), because nothing else on this field can
   *  spot for it -- `selectTarget` (`sim.ts`) gates every shot on per-side
   *  identification, indirect weapons included. */
  readonly standoffTiles?: number;
  /** `impact` only: the hostile the tube must acquire. `digger_crew` is the
   *  one enemy type in the roster with an empty `weapons` array, so it can
   *  be a legal target (civilians, side 2, never are) without shooting back
   *  at a 350 hp crew during the seconds the round is in the air. */
  readonly baitId?: string;
}

/**
 * Both halves of the package, on one open row.
 *
 * A sheet that photographed only the vehicle would prove nothing about the
 * mortar sharing the same sequence at its own `impactPower` (0.3 against a
 * collapsing building's 1.0), which is half of what this package claims.
 *
 * Spacing: a tile step is `(32, 16)` px at zoom 1 (`project.ts`), so 12
 * tiles along x is 960 px at the ladder's 2.5 -- well outside the 600x400
 * crop's own +/-300 px, and no subject appears in another's frame. The
 * mortar's 6-tile standoff is 480 px, outside it too, so the tube itself
 * never crowds the impact.
 */
export const BLAST_SUBJECTS: readonly BlastSubject[] = [
  {
    id: 'mbt_lavi',
    mode: 'kill',
    x: 6,
    y: 3,
    why: 'the roster\'s largest vehicle -- the biggest silhouette a blast has to cover',
  },
  {
    id: 'apc_eitan',
    mode: 'kill',
    x: 18,
    y: 3,
    why: 'wheeled, and a different wreck recipe from the Lavi\'s',
  },
  {
    id: 'mortar_team',
    mode: 'impact',
    x: 34,
    y: 3,
    standoffTiles: 6,
    baitId: 'digger_crew',
    why: 'an arcing round landing at impactPower 0.3, the indirect half of the package',
  },
];

/** One photograph, and every condition it was taken under. */
export interface SheetCell {
  subject: string;
  mode: string;
  /** The nominal rung, in ms after the trigger. */
  ms: number;
  zoom: number;
  tick: number;
  file: string;
  /** The FX age this frame ACTUALLY carries, where it differs from `ms` --
   *  see the header's "one uncertainty". Absent when the two agree. */
  ageMs?: number;
}

/**
 * The half of the evidence that survives R-E's git-ignored storage.
 *
 * The PNGs live under `.superpowers/` and are never committed, so the
 * NUMBERS -- rung times, zooms, ticks, subject ids, file names -- are what
 * gets quoted into the task report and the PR body. A sheet that named only
 * the files would leave nothing behind once the directory was gone.
 */
export function sheetIndex(label: string, cells: readonly SheetCell[]): string {
  const subjects = [...new Set(cells.map((c) => c.subject))];
  const lines = [
    `# Blast capture sheet -- ${label}`,
    ``,
    `${cells.length} frame(s) over ${subjects.length} subject(s): ${subjects.join(', ') || '(none)'}.`,
    `Ladder: ${SAMPLE_MS.length} rungs, 0..${SAMPLE_WINDOW_MS} ms every ${SAMPLE_EVERY_MS} ms.`,
    ``,
    `| subject | mode | t (ms) | age (ms) | zoom | tick | file |`,
    `|---|---|---|---|---|---|---|`,
    ...cells.map(
      (c) =>
        `| \`${c.subject}\` | ${c.mode} | ${c.ms} | ${c.ageMs === undefined ? c.ms : c.ageMs} | ` +
        `${c.zoom} | ${c.tick} | \`${c.file}\` |`
    ),
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// The browser half. Nothing below is imported by the spec.
// ---------------------------------------------------------------------------

/** Ports in use by this repo's other harnesses: 5173 a human's own dev
 *  server, 5174 golden-diff, 5175 three-baseline, 5176 ui:shots, 5177
 *  ui:routes and plate-capture, 5178 wreck-captures, 5179 death-captures and
 *  unit-plates. This one takes the next free number and never touches
 *  another. */
const PORT = 5181;
const VIEWPORT = { width: 1400, height: 900 } as const;
/** The establishing still, then the ladder. The lead's figure for the ladder
 *  is 2.5, which is the top of `main.ts`'s own 0.35-2.5 camera clamp. */
const ESTABLISH_ZOOM = 1.0;
const LADDER_ZOOM = 2.5;
/** The crop the ladder rungs are taken at, centred on the blast. Same shape
 *  and lift as `death-captures.ts`: a 1400x900 frame of one detonation is
 *  mostly empty desert. */
const CLOSE_CROP = { width: 600, height: 400 } as const;
const CLOSE_CROP_LIFT_PX = 50;
/** One pumped frame. Below `FRAME_DT_CEILING_MS` (100) by a wide margin, so
 *  the raw and clamped frame clocks agree on every rung this harness drives
 *  itself. */
const FRAME_MS = 16;
/** The rung the R-M toggle A/B is performed at: inside the 450 ms fireball,
 *  and past the first frame, so a light and a scorch would both be at
 *  strength. */
const TOGGLE_AT_MS = 200;
/** R-M. Neither exists before Tasks 4 and 7, and `setDebugLayerVisible`
 *  throws on an unknown name BY DESIGN (`unknownDebugLayerMessage`) so a
 *  typo can never read as a layer that draws nothing. This reports 0 and
 *  says why rather than failing the run; Task 8 is where a zero becomes a
 *  failure. */
const LAYERS = ['scorch', 'blast-light'] as const;

/** The repo root, derived from this module's own location rather than from
 *  `process.cwd()`. `pnpm blast:capture` delegates through
 *  `pnpm --filter @lions/tools`, so the cwd is `tools/` -- exactly the trap
 *  that made the golden gate write every capture to
 *  `tools/visual-baseline-output` while its workflow uploaded the repo-root
 *  path and logged "No files were found" on every run (CLAUDE.md, the visual
 *  gate). Both the default output directory and the dev server's own root
 *  resolve against this. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** How long the app's own frame loop is left running before it is frozen.
 *  See its use site: this is what keeps `lastFrameMs` a steady-state frame
 *  rather than a boot-time GLB load. */
const SETTLE_MS = 2500;
/** The viewport the settle runs at, before the capture viewport is put back.
 *  See `main()`: a SwiftShader frame of the real 1400x900 scene costs
 *  hundreds of milliseconds, and `step(1)` latches exactly one of those into
 *  the fireball's age. Small enough to be cheap, large enough that the app
 *  and the renderer are doing all of their real work. */
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;

const MESH_WAIT_MS = 300_000;
const STEP_TIMEOUT_MS = 120_000;
const FIRE_TICK_CAP = 1200;
const FLIGHT_FRAME_CAP = 900;
const FIXED = 65536;

interface LionsWindow {
  __lions: {
    step(n: number): number;
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      smokeClockMs: number;
      shells: { kind: string; tx: number; ty: number; t: number; duration: number }[];
      meshUnitEntities: Map<number, { actions: Map<string, unknown> }>;
      vehicleMeshEntities: Map<number, unknown>;
      setDebugLayerVisible(name: string, visible: boolean): number;
    };
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array; posX: Int32Array; posY: Int32Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      debugKill(id: number): void;
      removeFromPlay(id: number): void;
    };
  };
}

interface LayerReading {
  subject: string;
  layer: string;
  available: boolean;
  diffPixels: number;
  meanAbsChannelDelta: number;
  note: string;
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT, REPAINT_SCRIPT, layerToggleScript } = await import(
    '../golden-diff/capture-protocol'
  );
  const { computeDiff } = await import('../golden-diff/diff');

  const label = arg('label', '');
  if (label !== 'before' && label !== 'after') {
    throw new Error('--label=before|after is required: the sheet is a comparison or it is nothing');
  }
  const port = Number(arg('port', String(PORT)));
  if (port === 5173) throw new Error("refusing --port=5173: that is the convention for a human's own dev server");
  const outRoot = path.resolve(REPO_ROOT, arg('out', path.join('.superpowers', 'art-captures', 'blast')));
  const out = path.join(outRoot, label);
  const only = arg('only', '');
  const wanted = only ? BLAST_SUBJECTS.filter((s) => s.id === only) : BLAST_SUBJECTS;
  if (only && wanted.length === 0) {
    throw new Error(`--only=${only} names no subject (have: ${BLAST_SUBJECTS.map((s) => s.id).join(', ')})`);
  }
  fs.mkdirSync(out, { recursive: true });

  const cells: SheetCell[] = [];
  const notes: string[] = [];
  const layerReadings: LayerReading[] = [];

  const server = await ensureDevServer(port, REPO_ROOT, 'blast-captures');
  const browser = await chromium.launch({ headless: true });
  let gl = 'unknown';
  try {
    gl = await readUnmaskedRenderer(browser);
    const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.on('pageerror', (err) => console.log('  page error:', err.message));
    // `&renderer=three` explicitly, never by omission: `renderer-choice.ts`
    // falls back to `localStorage['lions.renderer']`, which is per-ORIGIN and
    // shared with every other capture ever run against this dev server.
    await page.goto(`http://localhost:${port}/?sandbox=beit_sahwan_outskirts&renderer=three`, {
      waitUntil: 'load',
    });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
    await page.evaluate(() => document.fonts.ready);
    // THE SETTLE RUNS BEFORE THE FREEZE, AND AT A SMALL VIEWPORT. Both
    // invert what `capture()` does (`browser.ts`), both deliberately, and
    // the reason is one measured number.
    //
    // `main.ts`'s `__lions.step(n)` ends with `renderer.frame(1,
    // lastFrameMs)`, and `lastFrameMs` is written ONLY by the app's own rAF
    // loop -- so freezing the loop LATCHES whatever the last live frame
    // cost, for every `step()` this harness will ever make. A kill has to go
    // through one `step(1)` (the `destroyed` event is drained inside
    // `runTick`), and the FX managers are handed the RAW `dtMs`
    // (`updateFx`: `explosionBursts.step(dtMs)`), so that latched number is
    // the age the fireball already has on the frame it first draws.
    //
    // Measured on this scene, three ways. Freezing immediately, the way
    // `capture()` does, latched 5181.70 ms -- a boot frame, which is a GLB
    // load. Settling first at the capture's own 1400x900 latched 427.70 ms,
    // because a SwiftShader frame of this scene really does cost that: the
    // 450 ms fireball would have been 95% over before rung zero. Settling at
    // 320x200 and putting the capture viewport back afterwards latches an
    // ordinary frame of a scene doing all the same work with a twentieth of
    // the pixels.
    //
    // `capture()`'s own reason for freezing first is a repeatable absolute
    // tick for a stored baseline. This harness pins no tick and stores no
    // baseline, so it pays none of that.
    await page.waitForTimeout(SETTLE_MS);
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.setViewportSize({ ...VIEWPORT });
    // The renderer follows the host through a `ResizeObserver`
    // (`ThreeRenderer.init`), not through the frame loop, so this lands with
    // the loop frozen -- but it lands on the browser's own rendering
    // lifecycle rather than on anything this script awaits. Read the canvas
    // back off the DOM and refuse to continue if it did not take: every crop
    // rect below comes from `worldToScreen`, which would otherwise be
    // projecting into a 320x200 frame and cropping a 1400x900 screenshot
    // with it, off-centre and plausible-looking.
    await page.waitForFunction(
      ([w, h]) => {
        const c = document.querySelector('canvas');
        return c !== null && c.clientWidth === w && c.clientHeight === h;
      },
      [VIEWPORT.width, VIEWPORT.height] as const
    );
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

    // The dry read of `step()`'s own frame jump -- see the header. Done once,
    // before anything is spawned, because `lastFrameMs` never changes again
    // with the loop frozen.
    const stepJumpMs = await page.evaluate(() => {
      const L = (window as unknown as LionsWindow).__lions;
      const before = L.renderer.smokeClockMs;
      L.step(1);
      return L.renderer.smokeClockMs - before;
    });
    console.log(`step(1) advances the FX clock by ${stepJumpMs.toFixed(2)} ms (measured, not assumed)`);
    if (stepJumpMs > SAMPLE_EVERY_MS) {
      notes.push(
        `step(1) advances the FX clock by ${stepJumpMs.toFixed(2)} ms, which is past the ${SAMPLE_EVERY_MS} ms ` +
          'ladder step: a kill subject\'s early rungs are late by that much and are recorded with their real age.'
      );
    }

    // Everything that needs a GLB is spawned up front so one wait covers it.
    // The bait is NOT: a hostile on the field from tick zero would be shot at
    // (and would walk into) every other subject's frame for the whole run --
    // `death-captures.ts` learned the same lesson about its killer.
    const placed = await spawnSubjects(page, wanted);
    await waitForMeshes(page, placed, notes);

    for (const p of placed) {
      console.log(`${label}: ${p.subject.id} (${p.subject.mode}) at [${p.subject.x}, ${p.subject.y}]`);
      const trigger =
        p.subject.mode === 'kill'
          ? await triggerKill(page, p, stepJumpMs)
          : await triggerImpact(page, p, notes);
      if (trigger === null) continue;

      // `ageMs` is the FX age this frame really carries. It starts at the
      // trigger's own offset (zero for an impact, `stepJumpMs` for a kill)
      // and is then driven to each rung EXACTLY, rather than by adding a
      // fixed step per rung -- so a non-zero offset shifts rung zero alone
      // and every later rung still lands on its nominal age.
      let ageMs = trigger.ageMs;
      for (const ms of SAMPLE_MS) {
        if (ms > ageMs) {
          await advanceFrames(page, ms - ageMs);
          ageMs = ms;
        }
        const rect = await shoot(page, p.subject, ms, ageMs, label, out, cells);
        if (ms === TOGGLE_AT_MS) {
          await runLayerToggles(page, p.subject, label, out, rect, layerReadings, {
            REPAINT_SCRIPT,
            layerToggleScript,
            computeDiff,
          });
        }
      }
    }

    writeIndex(out, label, cells, notes, layerReadings, { gl, stepJumpMs, port });
    await page.close();
  } finally {
    await browser.close();
    stopDevServer(server, 'blast-captures');
  }
}

interface Placed {
  subject: BlastSubject;
  /** The subject's own entity, for a `kill`. -1 for an `impact`, whose
   *  subject is a tile rather than a body. */
  entity: number;
  /** `impact` only: the tube. */
  shooter: number;
}

async function spawnSubjects(
  page: import('playwright').Page,
  wanted: readonly BlastSubject[]
): Promise<Placed[]> {
  return page.evaluate(
    // NOTHING in this body may be a NAMED function expression -- not even a
    // `const f = () => ...` helper. `tsx`/esbuild wraps those in its own
    // `__name()` keep-names helper, which exists in the tsx runtime and not
    // in the page, and the whole evaluate dies with a bare
    // `ReferenceError: __name is not defined` that names nothing this file
    // wrote. Measured here once, on exactly such a helper.
    ([rows, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const out: { subject: (typeof rows)[number]; entity: number; shooter: number }[] = [];
      for (const row of rows) {
        const idx = L.sim.unitTypes.findIndex((t) => t.id === row.id);
        if (idx < 0) throw new Error(`no unit type "${row.id}" in this build`);
        if (row.mode === 'kill') {
          out.push({ subject: row, entity: L.sim.spawn(idx, 0, row.x * fixed, row.y * fixed), shooter: -1 });
        } else {
          const standoff = row.standoffTiles ?? 6;
          out.push({
            subject: row,
            entity: -1,
            shooter: L.sim.spawn(idx, 0, (row.x - standoff) * fixed, row.y * fixed),
          });
        }
      }
      return out;
    },
    [wanted, FIXED] as const
  );
}

/** Waits for every spawned body to hold a real mesh. A vehicle lands in
 *  `vehicleMeshEntities`; the mortar team is a rigged infantry rig and lands
 *  in `meshUnitEntities` with its clips bound. Steps ticks while it waits,
 *  which is safe precisely because no hostile is on the field yet. */
async function waitForMeshes(page: import('playwright').Page, placed: readonly Placed[], notes: string[]): Promise<void> {
  const want = placed.map((p) => ({ id: p.entity >= 0 ? p.entity : p.shooter, vehicle: p.entity >= 0 }));
  const deadline = Date.now() + MESH_WAIT_MS;
  let first = true;
  for (;;) {
    const missing = await page.evaluate(
      ([rows, tick]) => {
        const L = (window as unknown as LionsWindow).__lions;
        if (tick) L.step(20);
        return rows
          .filter((r) => {
            if (r.vehicle) return !L.renderer.vehicleMeshEntities.has(r.id);
            const e = L.renderer.meshUnitEntities.get(r.id);
            return !e || e.actions.size === 0;
          })
          .map((r) => r.id);
      },
      [want, !first] as const
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

interface Trigger {
  /** The FX age the ladder's rung zero actually carries. */
  ageMs: number;
}

/** Kills the vehicle and returns the age its burst already has on the frame
 *  the kill first draws -- `step(1)`'s own `frame(1, lastFrameMs)`, measured
 *  at boot. */
async function triggerKill(page: import('playwright').Page, p: Placed, stepJumpMs: number): Promise<Trigger> {
  await page.evaluate((e) => {
    const L = (window as unknown as LionsWindow).__lions;
    L.sim.debugKill(e);
    L.step(1);
  }, p.entity);
  return { ageMs: stepJumpMs };
}

/**
 * Drives the tube to fire for real and returns on the frame the bomb lands.
 *
 * Three stages, and the split matters. Ticking is what gets the round into
 * the air (a `fire` event is a sim event), but each `__lions.step(1)` also
 * paints one frame, so ticking through the whole flight would burn the arc
 * at `lastFrameMs` a tick. So: tick until the shell exists, take the bait
 * off the field, then pump FRAME_MS frames only -- no further ticks -- until
 * `updateFx`'s own `shellHasLanded` drops it, which is the frame
 * `spawnShellImpactFx` runs on. The burst is spawned AFTER the managers step
 * in that same call, so rung zero is a true zero here.
 */
async function triggerImpact(
  page: import('playwright').Page,
  p: Placed,
  notes: string[]
): Promise<Trigger | null> {
  const fired = await page.evaluate(
    ([shooter, baitId, bx, by, fixed, cap]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const idx = L.sim.unitTypes.findIndex((t) => t.id === baitId);
      if (idx < 0) throw new Error(`no unit type "${baitId}" in this build`);
      const bait = L.sim.spawn(idx, 1, bx * fixed, by * fixed);
      let ticks = 0;
      while (L.renderer.shells.length === 0 && ticks < cap) {
        L.step(1);
        ticks++;
      }
      const shell = L.renderer.shells[0];
      // Off the field, not killed: `removeFromPlay` emits `removed`, which
      // the renderer draws as neither a death clip nor a wreck -- so the
      // bomb lands on empty ground, which is what the sheet is about.
      L.sim.removeFromPlay(bait);
      return {
        ticks,
        shooterAlive: L.sim.state.alive[shooter] === 1,
        shell: shell === undefined ? null : { kind: shell.kind, tx: shell.tx, ty: shell.ty, duration: shell.duration },
      };
    },
    [p.shooter, p.subject.baitId ?? 'digger_crew', p.subject.x, p.subject.y, FIXED, FIRE_TICK_CAP] as const
  );
  if (fired.shell === null) {
    notes.push(
      `${p.subject.id} (impact): no round left the tube in ${FIRE_TICK_CAP} ticks ` +
        `(tube alive: ${fired.shooterAlive}) -- subject skipped`
    );
    return null;
  }
  console.log(
    `  ${p.subject.id}: a ${fired.shell.kind} is up after ${fired.ticks} ticks, ` +
      `impacting [${fired.shell.tx.toFixed(2)}, ${fired.shell.ty.toFixed(2)}] in ${fired.shell.duration.toFixed(2)} s`
  );
  const landed = await page.evaluate(
    ([step, cap]) => {
      const L = (window as unknown as LionsWindow).__lions;
      let frames = 0;
      while (L.renderer.shells.length > 0 && frames < cap) {
        L.renderer.frame(1, step);
        frames++;
      }
      return { frames, stillUp: L.renderer.shells.length };
    },
    [FRAME_MS, FLIGHT_FRAME_CAP] as const
  );
  if (landed.stillUp > 0) {
    notes.push(`${p.subject.id} (impact): the round was still in the air after ${FLIGHT_FRAME_CAP} frames -- subject skipped`);
    return null;
  }
  console.log(`  ${p.subject.id}: landed after ${landed.frames} pumped frames (${landed.frames * FRAME_MS} ms of flight)`);
  return { ageMs: 0 };
}

/** Advances the renderer's own frame clock by `ms`, in FRAME_MS steps with an
 *  exact remainder, so the accumulated age lands on the rung and not near it. */
async function advanceFrames(page: import('playwright').Page, ms: number): Promise<void> {
  await page.evaluate(
    ([total, step]) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (let done = 0; done < total; done += step) L.renderer.frame(1, Math.min(step, total - done));
    },
    [ms, FRAME_MS] as const
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frames the camera on a world tile at `zoom`, repaints at ZERO elapsed time
 *  so no clock moves, and reports where the tile landed on screen. */
async function frameAt(
  page: import('playwright').Page,
  wx: number,
  wy: number,
  zoom: number
): Promise<{ screenX: number; screenY: number; tick: number }> {
  return page.evaluate(
    ([x, y, z]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const c = L.renderer.camera;
      c.x = x;
      c.y = y;
      c.zoom = z;
      L.renderer.frame(1, 0);
      const screen = L.renderer.worldToScreen(x, y);
      return { screenX: screen.x, screenY: screen.y, tick: L.sim.tickCount };
    },
    [wx, wy, zoom] as const
  );
}

/** One rung: the establishing still at rung zero, then the cropped ladder
 *  frame. Returns the ladder crop's rect, which the toggle A/B re-photographs
 *  through. */
async function shoot(
  page: import('playwright').Page,
  subject: BlastSubject,
  ms: number,
  ageMs: number,
  label: string,
  out: string,
  cells: SheetCell[]
): Promise<Rect> {
  const push = (zoom: number, file: string, tick: number): void => {
    const cell: SheetCell = { subject: subject.id, mode: subject.mode, ms, zoom, tick, file };
    if (Math.abs(ageMs - ms) > 0.5) cell.ageMs = Math.round(ageMs * 100) / 100;
    cells.push(cell);
  };
  if (ms === 0) {
    const est = await frameAt(page, subject.x, subject.y, ESTABLISH_ZOOM);
    const file = `${subject.id}-${subject.mode}-establish-${label}-z${ESTABLISH_ZOOM}.png`;
    await page.screenshot({ path: path.join(out, file) });
    push(ESTABLISH_ZOOM, file, est.tick);
    console.log(`  saved ${file}`);
  }
  const state = await frameAt(page, subject.x, subject.y, LADDER_ZOOM);
  const rect: Rect = {
    x: Math.min(Math.max(0, state.screenX - CLOSE_CROP.width / 2), VIEWPORT.width - CLOSE_CROP.width),
    y: Math.min(
      Math.max(0, state.screenY - CLOSE_CROP.height / 2 - CLOSE_CROP_LIFT_PX),
      VIEWPORT.height - CLOSE_CROP.height
    ),
    w: CLOSE_CROP.width,
    h: CLOSE_CROP.height,
  };
  const file = `${subject.id}-${subject.mode}-${String(ms).padStart(5, '0')}ms-${label}-z${LADDER_ZOOM}.png`;
  await page.screenshot({
    path: path.join(out, file),
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  });
  push(LADDER_ZOOM, file, state.tick);
  return rect;
}

/**
 * R-M: the reference-free half. Hide the layer, repaint at ZERO elapsed
 * presentation time so every clock reads the same, capture, compare. It
 * never asks what the frame looks like -- only whether removing the layer
 * changes it -- which is why it can vote on a runner with no blessed
 * baseline.
 *
 * The control comes first, for the reason `three-baseline-gate.ts` makes it
 * a gated check of its own: if a zero-time repaint moves pixels, the scene
 * is drifting between photographs and every delta below is measuring the
 * drift too.
 */
async function runLayerToggles(
  page: import('playwright').Page,
  subject: BlastSubject,
  label: string,
  out: string,
  rect: Rect,
  readings: LayerReading[],
  api: {
    REPAINT_SCRIPT: string;
    layerToggleScript: (layer: string, visible: boolean) => string;
    computeDiff: (
      a: string,
      b: string,
      opts?: { outDir?: string; threshold?: number; diffFileName?: string }
    ) => { diffPixels: number; meanAbsChannelDelta: number };
  }
): Promise<void> {
  const dir = path.join(out, 'toggles');
  fs.mkdirSync(dir, { recursive: true });
  const clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
  const shown = path.join(dir, `${subject.id}-shown-${label}.png`);
  await page.evaluate(api.REPAINT_SCRIPT);
  await page.screenshot({ path: shown, clip });
  for (const layer of LAYERS) {
    const hidden = path.join(dir, `${subject.id}-${layer}-hidden-${label}.png`);
    try {
      await page.evaluate(api.layerToggleScript(layer, false));
      await page.screenshot({ path: hidden, clip });
      await page.evaluate(api.layerToggleScript(layer, true));
      const d = api.computeDiff(shown, hidden, { outDir: dir, diffFileName: `${subject.id}-${layer}-diff.png` });
      readings.push({
        subject: subject.id,
        layer,
        available: true,
        diffPixels: d.diffPixels,
        meanAbsChannelDelta: d.meanAbsChannelDelta,
        note: 'hidden, repainted at zero elapsed time, compared',
      });
      console.log(
        `  toggle "${layer}" on ${subject.id}: ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      readings.push({
        subject: subject.id,
        layer,
        available: false,
        diffPixels: 0,
        meanAbsChannelDelta: 0,
        note: `layer absent: ${message.split('\n')[0]}`,
      });
      console.log(`  toggle "${layer}" on ${subject.id}: not available yet -- ${message.split('\n')[0]}`);
    }
  }
}

function writeIndex(
  out: string,
  label: string,
  cells: readonly SheetCell[],
  notes: readonly string[],
  layers: readonly LayerReading[],
  conditions: { gl: string; stepJumpMs: number; port: number }
): void {
  const machine = `${process.platform}-${process.arch}, node ${process.version}`;
  const condLines = [
    ``,
    `## Capture conditions`,
    ``,
    `Every number in this sheet was taken under exactly these, and none of them is a default`,
    `left unexamined -- a first golden-diff run once read 6.5x high purely from screenshot`,
    `downscaling and a font-load race.`,
    ``,
    `- machine: ${machine}`,
    `- GL backend: ${mdSafe(conditions.gl)}`,
    `- viewport: ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 1, headless chromium`,
    `- map: \`beit_sahwan_outskirts\` sandbox, \`&renderer=three\`, dev server on :${conditions.port}`,
    `- zooms: ${ESTABLISH_ZOOM} establishing still (full frame), ${LADDER_ZOOM} ladder`,
    `  (${CLOSE_CROP.width}x${CLOSE_CROP.height} crop, lifted ${CLOSE_CROP_LIFT_PX} px)`,
    `- frame loop: frozen (FREEZE_FRAME_LOOP_SCRIPT); every ladder frame pumped by hand at ${FRAME_MS} ms`,
    `- \`step(1)\` frame jump: ${conditions.stepJumpMs.toFixed(2)} ms, measured at boot (see the module header)`,
  ];
  const layerLines = [
    ``,
    `## Layer toggles (R-M), at ${TOGGLE_AT_MS} ms`,
    ``,
    `| subject | layer | available | diff px | mean abs channel delta | note |`,
    `|---|---|---|---|---|---|`,
    ...layers.map(
      (l) =>
        `| \`${l.subject}\` | \`${l.layer}\` | ${l.available ? 'yes' : 'no'} | ${l.diffPixels} | ` +
        `${l.meanAbsChannelDelta.toFixed(4)} | ${l.note} |`
    ),
  ];
  const noteLines = notes.length > 0 ? [``, `## Notes`, ``, ...notes.map((n) => `- ${n}`)] : [];
  const md = sheetIndex(label, cells) + [...condLines, ...layerLines, ...noteLines].join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'sheet.md'), md);
  fs.writeFileSync(
    path.join(out, 'sheet.json'),
    JSON.stringify(
      {
        label,
        conditions: {
          machine,
          gl: conditions.gl,
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          map: 'beit_sahwan_outskirts',
          renderer: 'three',
          port: conditions.port,
          establishZoom: ESTABLISH_ZOOM,
          ladderZoom: LADDER_ZOOM,
          crop: CLOSE_CROP,
          frameMs: FRAME_MS,
          stepJumpMs: conditions.stepJumpMs,
          sampleMs: SAMPLE_MS,
        },
        subjects: BLAST_SUBJECTS,
        cells,
        layers,
        notes,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`index at ${path.join(out, 'sheet.md')} (${cells.length} frames)`);
}

/** Keeps a driver string that may contain a pipe out of a markdown table.
 *  `readUnmaskedRenderer` really does return one: "ANGLE (Google, Vulkan
 *  1.3.0 (SwiftShader Device ...))". */
function mdSafe(s: string): string {
  return s.replace(/\|/g, '/');
}

// Only when run as a script. The spec imports this module for its pure half,
// and a module that boots a browser on import would make `pnpm test` start a
// dev server.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    }
  );
}
