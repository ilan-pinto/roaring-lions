/**
 * GH-941: the KDF autocannon (`ifv_namer`, left) and the Sarim AA gun truck
 * (`gun_truck`, right) firing in one frame, so the two tracers are judged under
 * the same light, camera and bloom.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/aa-tracer-capture.ts --label=after --port=5251 --gpu=metal
 *
 * Method: the frame loop is frozen, and the sim, the renderer snapshot and the
 * event hand-off are stepped by hand in lockstep (20 Hz ticks, three 16 ms
 * frames a tick), exactly as `grenade-captures.ts` does. Both scenes are staged
 * far enough apart that neither shooter ever sees the other's target. Output
 * goes to `--out=<dir>` (default the `_coord/aa-tracers/<label>` directory).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const VIEWPORT = { width: 1400, height: 900 } as const;
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;
const FIXED = 65536;
const TICK_MS = 50;
const FRAMES_PER_TICK = 3;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_ROOT = '/Users/ilpinto/dev/roaring-lions-ep/_coord/aa-tracers';
const MAP = 'beit_sahwan_outskirts';

/** One staged firing pair. `side` is the SHOOTER's; the target is the other. */
interface Scene {
  name: string;
  shooter: string;
  target: string;
  side: 0 | 1;
  x: number;
  y: number;
  gap: number;
}
const SCENES: readonly Scene[] = [
  { name: 'kdf', shooter: 'ifv_namer', target: 'digger_crew', side: 0, x: 4, y: 4, gap: 7 },
  { name: 'enemy', shooter: 'gun_truck', target: 'veh_ambulance', side: 1, x: 24, y: 4, gap: 7 },
];

interface SimEvent { kind: string; weaponId?: string; shooter?: number; target?: number }
interface LionsWindow {
  __lions: {
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      snapshot(): void;
      onEvents(events: unknown[]): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      bolts?: { kind: string; side: number; t: number; duration: number }[];
      meshUnitTemplates?: Map<string, unknown>;
      vehicleMeshTemplates?: Map<string, unknown>;
      failedMeshTypes?(): ReadonlySet<string>;
    };
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      tick(): SimEvent[];
      removeFromPlay(id: number): void;
    };
    step(n: number): void;
  };
}

function arg(name: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT } = await import('../golden-diff/capture-protocol');
  const { settleScript, parseSettleResult, settleLine } = await import('./blast-captures');

  const label = arg('label') || 'after';
  const gpu = arg('gpu') || 'metal';
  const port = await claimPort('aa-tracer-capture', 'AA_TRACER_CAPTURE_PORT', 5251);
  if (port === 5177 || port === 5173) throw new Error(`port ${port} is someone else's`);
  const out = arg('out') || path.join(OUT_ROOT, label);
  fs.mkdirSync(out, { recursive: true });
  const server = await ensureDevServer(port, REPO_ROOT, 'aa-tracer-capture');
  if (server === null) {
    console.error(`port ${port} is not ours`);
    process.exitCode = 2;
    return;
  }
  const browser = await chromium.launch({
    headless: true,
    args: gpu === 'metal' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'] : [],
  });
  const notes: string[] = [`load ${os.loadavg().map((n) => n.toFixed(2)).join('/')} on ${os.cpus().length} cpus`];
  try {
    const gl = (await readUnmaskedRenderer(browser)).replace(/\|/g, '/');
    if (gpu === 'metal' && !/Metal/i.test(gl)) throw new Error(`asked for Metal, got "${gl}"`);
    notes.push(`${process.platform}-${process.arch} ${gl} ${VIEWPORT.width}x${VIEWPORT.height} dsf1, port ${port}, ?sandbox=${MAP}`);
    const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    page.setDefaultTimeout(120_000);
    page.on('pageerror', (err) => console.log('  page error:', err.message));
    await page.goto(`http://localhost:${port}/?sandbox=${MAP}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
    await page.evaluate(() => document.fonts.ready);
    notes.push(settleLine(MAP, parseSettleResult(await page.evaluate(settleScript(30_000)))));

    // Warm-up before the freeze: the unit GLBs load late, through a 1 Hz sweep.
    const types = [...new Set(SCENES.flatMap((s) => [s.shooter, s.target]))];
    const warm = await page.evaluate(
      async ([ids, fixed]) => {
        const L = (window as unknown as LionsWindow).__lions;
        const spawned: number[] = [];
        let k = 0;
        for (const id of ids) {
          const ti = L.sim.unitTypes.findIndex((t) => t.id === id);
          if (ti < 0) throw new Error(`${id} not in this build`);
          spawned.push(L.sim.spawn(ti, k % 2, (4 + 2 * k++) * fixed, 3 * fixed));
        }
        L.step(20);
        const t0 = performance.now();
        let missing: string[] = ids.slice();
        while (performance.now() - t0 < 60000) {
          const vk = [...(L.renderer.vehicleMeshTemplates?.keys() ?? [])];
          missing = ids.filter((i) => !(L.renderer.meshUnitTemplates?.has(i) ?? false) && !vk.some((k) => k === i || k.startsWith(i + ':') || k.startsWith(i + '|')));
          if (missing.length === 0) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        const failed = [...(L.renderer.failedMeshTypes?.() ?? [])];
        for (const id of spawned) if (L.sim.state.alive[id] === 1) L.sim.removeFromPlay(id);
        L.renderer.frame(1, 0);
        return { missing, failed, ms: Math.round(performance.now() - t0) };
      },
      [types, FIXED] as const
    );
    notes.push(`mesh warm-up: missing [${warm.missing.join(',')}], failed [${warm.failed.join(',')}], ${warm.ms} ms`);
    if (warm.missing.length > 0 || warm.failed.length > 0) throw new Error(`REFUSED: ${notes[notes.length - 1]}`);

    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.setViewportSize({ ...VIEWPORT });
    await page.waitForFunction(
      ([w, h]) => {
        const c = document.querySelector('canvas');
        return c !== null && c.clientWidth === w && c.clientHeight === h;
      },
      [VIEWPORT.width, VIEWPORT.height] as const
    );

    // Clear the sandbox's own task force so nothing else fires into the frame.
    const staged = await page.evaluate(
      ([scenes, fixed]) => {
        const L = (window as unknown as LionsWindow).__lions;
        const n = L.sim.state.alive.length;
        for (let i = 0; i < n; i++) if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
        const ids: { name: string; shooter: number; target: number }[] = [];
        (window as unknown as { __aaScenes: unknown }).__aaScenes = ids;
        for (const s of scenes) {
          const si = L.sim.unitTypes.findIndex((t) => t.id === s.shooter);
          const ti = L.sim.unitTypes.findIndex((t) => t.id === s.target);
          const shooter = L.sim.spawn(si, s.side, s.x * fixed, s.y * fixed);
          const target = L.sim.spawn(ti, 1 - s.side, (s.x + s.gap) * fixed, s.y * fixed);
          ids.push({ name: s.name, shooter, target });
        }
        const mid = scenes.reduce((a, s) => a + s.x + s.gap / 2, 0) / scenes.length;
        const cam = L.renderer.camera;
        cam.x = mid;
        cam.y = scenes[0].y;
        L.renderer.frame(1, 0);
        return { ids, zoom: cam.zoom, mid };
      },
      [SCENES, FIXED] as const
    );
    notes.push(`staged ${JSON.stringify(staged.ids)}; camera zoom ${staged.zoom}, centred x=${staged.mid}`);
    console.log(notes.join('\n'));

    // Run: step, and photograph every tick that has a round up in BOTH scenes.
    const frames: string[] = [];
    let firstFire = -1;
    for (let n = 1; n <= 160; n++) {
      const r = await page.evaluate(
        ([ticks, frameMs, scenes, fixed]) => {
          const L = (window as unknown as LionsWindow).__lions;
          const ids = (window as unknown as { __aaScenes: { name: string; shooter: number; target: number }[] }).__aaScenes;
          // A target that dies is replaced where it stood, so the shooter keeps firing.
          for (let k = 0; k < ids.length; k++) {
            if (L.sim.state.alive[ids[k].target] !== 1) {
              const sc = scenes[k];
              const ti = L.sim.unitTypes.findIndex((t) => t.id === sc.target);
              ids[k].target = L.sim.spawn(ti, 1 - sc.side, (sc.x + sc.gap) * fixed, sc.y * fixed);
            }
          }
          const ev = L.sim.tick();
          L.renderer.snapshot();
          L.renderer.onEvents(ev);
          for (let f = 0; f < ticks; f++) L.renderer.frame((f + 1) / ticks, frameMs);
          const bolts = L.renderer.bolts ?? [];
          return {
            tick: L.sim.tickCount,
            fires: ev.filter((e) => e.kind === 'fire').map((e) => e.weaponId ?? ''),
            bolts: bolts.filter((b) => b.t >= 0).map((b) => `${b.kind}/s${b.side}`),
          };
        },
        [FRAMES_PER_TICK, TICK_MS / FRAMES_PER_TICK, SCENES, FIXED] as const
      );
      if (r.fires.length > 0 && firstFire < 0) firstFire = r.tick;
      const sides = new Set(r.bolts.map((b) => b.split('/')[1]));
      if (firstFire >= 0 && sides.has('s0') && sides.has('s1') && frames.length < 14) {
        const file = `aa-${label}-t${String(r.tick).padStart(4, '0')}.png`;
        await page.screenshot({ path: path.join(out, file) });
        frames.push(`${file}: ${r.bolts.join(' ')}`);
      }
      if (frames.length >= 14) break;
    }
    notes.push(`first fire at tick ${firstFire}`, ...frames);
    await page.close();
  } finally {
    await browser.close();
    stopDevServer(server, 'aa-tracer-capture');
  }
  fs.writeFileSync(path.join(out, 'notes.txt'), notes.join('\n') + '\n');
  console.log(notes.join('\n'));
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  }
);
