/**
 * GH-748: the fire-support witness -- photographs a mortar barrage and an air
 * strike through the running game and runs the `support-air` and
 * `support-blast` debug-layer toggle A/B on them, `blast:capture`'s method
 * (R-M) on a smaller harness.
 *
 *   pnpm support:capture -- [--out=<dir>] [--port=<n>] [--gpu=metal|swiftshader]
 *
 * No gated golden scenario calls fire support, so this is the only
 * instrument that can see the aircraft or the support detonations at all.
 *
 * What it does, on one page of `?sandbox=beit_sahwan_outskirts`:
 *
 *  1. Waits for the two aircraft meshes (`debugSupport()`), then freezes the
 *     frame loop (`FREEZE_FRAME_LOOP_SCRIPT`), so `step()`'s own paint is the
 *     last paint and every photograph is a frame this script chose.
 *  2. Finds open, seen ground 5-9 tiles from the friendly force and calls a
 *     barrage on it the way the app does: the sim's `callStrike` (profile 1)
 *     plus `renderer.supportCalled`. Steps to the third round, photographs
 *     it, and toggles each layer: shown, a zero-time repaint control, and
 *     hidden.
 *  3. Does the same for an air strike, twice: on the pass (the jet over the
 *     aim point, the bomb falling) and on the detonation.
 *  4. **The falsification, in the same run**: it makes the renderer's emitter
 *     library answer `null` for `air_strike_impact` -- exactly what an
 *     emitter missing from `vfxEmitters` does (`catastrophic_kill`'s
 *     lesson, CLAUDE.md "Mesh units") -- calls a second strike and requires
 *     `support-blast` to read UNDER its floor there. A run whose falsified
 *     pass still clears the floor exits 1: the gate could not fail.
 *
 * Floors are PROVISIONAL and deliberately low (a few hundred pixels where the
 * readings are thousands): they come from one Metal run, n = 1, because the
 * lead's machine takes one browser check per stream. They are not the
 * one-third-of-three-runs rule; re-derive them before anything gates on CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';
import { claimPort } from '../ui-review/port';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 5193;
const MAP = 'beit_sahwan_outskirts';
const VIEWPORT = { width: 1400, height: 900 } as const;
/** The world crop every photograph is taken through, centred on the aim
 *  point (the camera is): clear of the HUD strip and the minimap, which
 *  redraw on their own DOM timers and would move a zero-time repaint. */
const CLIP = { x: 250, y: 120, width: 900, height: 620 } as const;
const STEP_TIMEOUT_MS = 120_000;
const MESH_WAIT_MS = 90_000;

/** Provisional floors, changed exact pixels (see the header). */
export const FLOORS = {
  'support-air': 500,
  'support-blast': 500,
} as const;

export type Layer = keyof typeof FLOORS;

export interface Reading {
  readonly shot: string;
  readonly layer: Layer;
  readonly changedPx: number;
  readonly meanDelta: number;
  readonly controlPx: number;
  readonly objects: number;
}

/** Pass/fail for one reading: the toggle must move the frame by its floor and
 *  the zero-time repaint control must not move it at all. */
export function verdict(r: Reading): 'pass' | 'below-floor' | 'control-moved' {
  if (r.controlPx > 0) return 'control-moved';
  return r.changedPx >= FLOORS[r.layer] ? 'pass' : 'below-floor';
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

interface LionsWindow {
  __lions: {
    sim: {
      tickCount: number;
      width: number;
      height: number;
      blocked: Uint8Array;
      queueCommand(cmd: unknown): void;
    };
    renderer: {
      frame(alpha: number, dtMs: number): void;
      camera: { x: number; y: number; zoom: number };
      isVisible(x: number, y: number): boolean;
      supportCalled(call: string, x: number, y: number, tick: number): void;
      debugSupport(): { flights: number; heli: boolean; jet: boolean; warm: boolean; rings: number; lights: number };
      setDebugLayerVisible(name: string, visible: boolean): number;
      emitterLibrary: { byName(id: string): unknown };
    };
    step(n: number): number;
    units(side?: number): { id: number; type: string; x: number; y: number }[];
  };
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT, REPAINT_SCRIPT, layerToggleScript } = await import('../golden-diff/capture-protocol');
  const { computeDiff } = await import('../golden-diff/diff');

  if (arg('port', '') === '5177' || arg('port', '') === '5173') throw new Error('refusing a port a human dev server uses');
  const port = await claimPort('support-captures', 'SUPPORT_CAPTURE_PORT', PORT);
  const out = path.resolve(REPO_ROOT, arg('out', path.join('.superpowers', 'art-captures', 'support')));
  const prefix = arg('prefix', 'built-');
  fs.mkdirSync(out, { recursive: true });

  const server = await ensureDevServer(port, REPO_ROOT, 'support-captures');
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(resolveGpuBackend(process.argv, process.platform)) });
  const readings: Reading[] = [];
  const falsified: Reading[] = [];
  const notes: string[] = [];
  let exit = 0;
  try {
    const gl = await readUnmaskedRenderer(browser);
    notes.push(`gpu: ${gl}`);
    console.log(`gpu: ${gl}`);
    const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.on('pageerror', (err) => console.log('  page error:', err.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('  console error:', m.text());
    });
    await page.goto(`http://localhost:${port}/?sandbox=${MAP}&renderer=three`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
    // The aircraft load after the first frame (`main.ts`, afterFirstFrame).
    await page.waitForFunction(
      () => {
        const d = (window as unknown as LionsWindow).__lions.renderer.debugSupport();
        return d.heli && d.jet;
      },
      undefined,
      { timeout: MESH_WAIT_MS }
    );
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);

    // Open, seen ground 5-9 tiles from the friendly ground force.
    // A STRING script: tsx compiles a named arrow inside an evaluated function
    // into a `__name(...)` call the page does not define.
    const aim = (await page.evaluate(`(() => {
      const L = window.__lions;
      const own = L.units(0);
      const cx = own.reduce((s, u) => s + u.x, 0) / Math.max(1, own.length);
      const cy = own.reduce((s, u) => s + u.y, 0) / Math.max(1, own.length);
      const w = L.sim.width, h = L.sim.height, blocked = L.sim.blocked;
      function clear(x, y) {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h || blocked[ty * w + tx] !== 0) return false;
        }
        return L.renderer.isVisible(x + 0.5, y + 0.5);
      }
      for (let r = 5; r <= 9; r++) for (let a = 0; a < 32; a++) {
        const x = Math.round(cx + r * Math.cos((a / 32) * 2 * Math.PI));
        const y = Math.round(cy + r * Math.sin((a / 32) * 2 * Math.PI));
        if (clear(x, y)) return { x: x + 0.5, y: y + 0.5, caller: own.length > 0 ? own[0].id : -1, cx, cy };
      }
      return null;
    })()`)) as { x: number; y: number; caller: number; cx: number; cy: number } | null;
    if (aim === null || aim.caller < 0) throw new Error('no open, seen ground 5-9 tiles from the force');
    const aimNote = `aim (${aim.x}, ${aim.y}); friendly centroid (${aim.cx.toFixed(1)}, ${aim.cy.toFixed(1)}); caller ${aim.caller}`;
    console.log(aimNote);
    notes.push(aimNote);
    await page.evaluate(([x, y]) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      r.camera.x = x;
      r.camera.y = y;
      r.camera.zoom = 1;
      r.frame(1, 0);
    }, [aim.x, aim.y] as const);

    const call = async (kind: 'mortar_barrage' | 'air_strike'): Promise<number> =>
      (await page.evaluate(`(() => {
        const L = window.__lions;
        const cmd = { kind: 'callStrike', caller: ${aim.caller}, x: ${Math.round(aim.x * 65536)}, y: ${Math.round(aim.y * 65536)} };
        if (${JSON.stringify(kind)} === 'mortar_barrage') cmd.profile = 1;
        L.sim.queueCommand(cmd);
        L.renderer.supportCalled(${JSON.stringify(kind)}, ${aim.x}, ${aim.y}, L.sim.tickCount + 1);
        return L.sim.tickCount;
      })()`)) as number;
    // One tick at a time, each with its own frame (`step(1)` paints once),
    // so every frame-clock burst -- the flash lights, the shock ring, the
    // particles -- ages as it does in play instead of surviving a long
    // `step(n)` that paints only at its end.
    const stepTo = async (tick: number): Promise<void> => {
      await page.evaluate((t) => {
        const L = (window as unknown as LionsWindow).__lions;
        while (L.sim.tickCount < t) L.step(1);
      }, tick);
    };
    /** Steps one tick at a time until `pred` holds, at most `max` ticks. */
    const stepUntil = async (pred: 'lights' | 'rings', max: number): Promise<boolean> => {
      for (let i = 0; i < max; i++) {
        const ok = await page.evaluate((p) => {
          const L = (window as unknown as LionsWindow).__lions;
          L.step(1);
          return L.renderer.debugSupport()[p] > 0;
        }, pred);
        if (ok) return true;
      }
      return false;
    };
    /** Paints `n` frames of `dtMs` with no sim tick: the frame-clock bursts
     *  age (and the strike's 60 ms hit-stop runs out) while the sim-clocked
     *  aircraft hold still. A blast photographed on its own first frame is at
     *  age 0, where a flash light's `sin` envelope and the ring's radius are
     *  both 0 -- a toggle there reads 0 px on a healthy tree. */
    const ageFx = async (n: number, dtMs: number): Promise<void> => {
      await page.evaluate(
        ([k, dt]) => {
          const r = (window as unknown as LionsWindow).__lions.renderer;
          for (let i = 0; i < k; i++) r.frame(1, dt);
        },
        [n, dtMs] as const
      );
    };
    const toggle = async (shot: string, layer: Layer, into: Reading[]): Promise<Reading> => {
      const shown = path.join(out, `${prefix}${shot}.png`);
      const control = path.join(out, `${prefix}${shot}-control.png`);
      const hidden = path.join(out, `${prefix}${shot}-no-${layer}.png`);
      await page.evaluate(REPAINT_SCRIPT);
      await page.screenshot({ path: shown, clip: CLIP });
      await page.evaluate(REPAINT_SCRIPT);
      await page.screenshot({ path: control, clip: CLIP });
      const off = JSON.parse(await page.evaluate(layerToggleScript(layer, false))) as { objects: number };
      await page.screenshot({ path: hidden, clip: CLIP });
      await page.evaluate(layerToggleScript(layer, true));
      const c = computeDiff(shown, control, { outDir: out, diffFileName: `${prefix}${shot}-${layer}-control-diff.png` });
      const d = computeDiff(shown, hidden);
      if (c.changedPixels === 0) {
        fs.rmSync(control, { force: true });
        if (c.diffImagePath) fs.rmSync(c.diffImagePath, { force: true });
      }
      const r: Reading = {
        shot,
        layer,
        changedPx: d.changedPixels,
        meanDelta: d.meanAbsChannelDelta,
        controlPx: c.changedPixels,
        objects: off.objects,
      };
      into.push(r);
      console.log(
        `  ${shot} ${layer}: ${r.changedPx} px / ${r.meanDelta.toFixed(4)} (objects ${r.objects}, control ${r.controlPx} px) -> ${verdict(r)}`
      );
      return r;
    };

    // --- the barrage: the third round ---
    const b0 = await call('mortar_barrage');
    // The aircraft load COLD and decode on the first call; the decode is a
    // browser task, so it lands between evaluates, never inside a step loop.
    await page.waitForFunction(() => (window as unknown as LionsWindow).__lions.renderer.debugSupport().warm, undefined, {
      timeout: MESH_WAIT_MS,
    });
    await stepTo(b0 + 120 + 2 * 36 - 2);
    if (!(await stepUntil('lights', 8))) throw new Error('barrage: round three never threw its light');
    await toggle('barrage-round3', 'support-air', readings);
    await toggle('barrage-round3', 'support-blast', readings);
    // Let the barrage finish and the helicopter leave before the strike.
    await stepTo(b0 + 120 + 5 * 36 + 120);

    // --- the air strike: the pass, then the detonation ---
    const s0 = await call('air_strike');
    await stepTo(s0 + 56);
    await toggle('airstrike-pass', 'support-air', readings);
    if (!(await stepUntil('rings', 10))) throw new Error('air strike: the detonation never threw its shock ring');
    await ageFx(8, 16);
    await toggle('airstrike-impact', 'support-blast', readings);
    await toggle('airstrike-impact', 'support-air', readings);

    // --- the falsification: an unregistered air_strike_impact ---
    await stepTo(s0 + 200);
    await page.evaluate(`(() => {
      const lib = window.__lions.renderer.emitterLibrary;
      const real = lib.byName.bind(lib);
      lib.byName = function (id) { return id === 'air_strike_impact' ? null : real(id); };
    })()`);
    const f0 = await call('air_strike');
    await stepTo(f0 + 60);
    await stepUntil('rings', 4); // expected never to hold: no emitter, no ring
    await ageFx(8, 16);
    await toggle('falsified-airstrike-impact', 'support-blast', falsified);

    for (const r of readings) if (verdict(r) !== 'pass') exit = 1;
    const caught = falsified.length > 0 && falsified.every((r) => verdict(r) === 'below-floor');
    if (!caught) {
      console.error('FALSIFICATION FAILED: support-blast cleared its floor with air_strike_impact unregistered');
      exit = 1;
    } else {
      console.log('falsification: support-blast reads under its floor with air_strike_impact unregistered (red, as it must)');
    }
    fs.writeFileSync(
      path.join(out, `${prefix}readings.json`),
      JSON.stringify({ notes, floors: FLOORS, readings, falsified, verdicts: readings.map(verdict) }, null, 2) + '\n'
    );
    await page.close();
  } finally {
    await browser.close();
    stopDevServer(server, 'support-captures');
  }
  console.log(exit === 0 ? 'support-captures: PASS' : 'support-captures: FAIL');
  process.exit(exit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(2);
  });
}
