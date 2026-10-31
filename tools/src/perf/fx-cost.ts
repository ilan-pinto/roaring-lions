/**
 * The FX frame-cost instrument (smoke uplift P1; reused by P2 and P3+P4).
 *
 *   pnpm perf:fx -- --root=<tree> --port=<n> --label=<name> [--query=<extra>]
 *
 * Serves <tree> (run the SAME script against BEFORE and AFTER trees by pointing
 * --root at each), boots `?sandbox=beit_sahwan_outskirts` on HARDWARE Metal and,
 * per quality preset (high/medium/low, or `--presets=high,medium`), times
 * `renderer.frame(1, 0)` synced by a 1x1 `readPixels` (GPU wall, rAF frozen) for:
 *   quiet z0.5 / z2.5 / z1.6 -- the three mocked views
 *   smoke                    -- a dense screen: ten side-0 Eitans lay at tiles
 *                               ringed round the zoom-1.6 centre
 *   kill                     -- 8 Lavi kills, one per 250 ms of FX time; timed
 *                               500 ms and 4 s after the last
 *   grad                     -- 24 Grad landings, timed at 250 ms and 1.75 s
 * Draw calls come from `renderer.info` with autoReset off. The 60 Hz verdict is
 * p95 <= 16.7 ms. Refuses SwiftShader (exit 2). Frame time only: tick time is a
 * different budget and is not measured here.
 *
 * GH-829 `--breakdown` (with `--map=<id> --dpr=<n> --rounds=<n> --burn=<k>`): swaps the FX rows
 * for a per-pass frame breakdown on one map. Each config switches ONE thing off (a composer
 * pass's `enabled`, the shadow casting pass, or a debug layer), is timed readPixels-synced, and
 * switches it back; rounds interleave the configs so load drift lands on all of them. Rows carry
 * the median over rounds, the per-round medians, p95, CPU submit time (`cpu`, frame() return
 * before the sync) and draw calls / triangles read by hand with `autoReset` off. A toggle that
 * does nothing shows as unchanged calls AND a ~0 delta. It first prints the free-running rAF
 * CADENCE (app loop live) per view: the synced rows are serialised latency, the cadence is what
 * a player's loop sees, and the two disagree (docs/PERFORMANCE.md, GH-829). `--burn=2` draws two
 * extra frames per rAF, the falsification: the cadence must stop reading 16.7 ms.
 *
 * WHY readPixels AND NOT gl.finish() (GH-777, `_coord/high-perf/report.md` point 1):
 * on ANGLE/Metal `gl.finish()` does not wait for the whole frame when no pass
 * samples a render target back -- `medium` read 3 ms with it and 13.9 ms with a
 * 1x1 readPixels, `low` ~3 -> 10.5 ms. A readPixels cannot return before every
 * command that writes the default framebuffer has run.
 */
import { chromium, type Page } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import {
  BASELINE,
  buildSchedule,
  deltaRow,
  formatDelta,
  formatLoadLine,
  formatNetLayers,
  formatNetTotal,
  medianOf as planMedianOf,
  netCost,
  totalNetCost,
  parseCostArgs,
  resolveWetConfigs,
  wetConfigList,
  type Resolution,
  type ViewSpec,
  type WetFacts,
} from './fx-cost-plan';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd()));
// `--port=<n>`, else FX_COST_PORT, else 5211; a port something already holds
// is refused (`ui-review/port.ts`), so this never times someone else's server.
const port = await claimPort('fx-cost', 'FX_COST_PORT', 5211);
const label = arg('label', 'run');
const extra = arg('query', '');
const BUDGET_MS = 16.7;
// GH-829: `--breakdown` replaces the FX rows with a per-pass frame breakdown on
// `--map=<id>` at `--dpr=<n>` (default 2), `--rounds=<n>` interleaved passes.
// The options are parsed by the pure half (`fx-cost-plan.ts`, tested): the GH-829 command line
// (`--breakdown --map=<id>`) parses as it always did; `--maps=<a>,<b>` is the wet two-map mode
// (GH-871 P4 T10), `--views=`, `--frames=` and `--rounds=` shaping it.
const COST = parseCostArgs(args);
const BREAKDOWN = COST.breakdown;
const MAP = COST.maps[0] as string;
const DPR = COST.dpr;
const ROUNDS = COST.rounds;
const FRAMES = COST.frames;
// `--burn=<k>`: draw k extra frames per rAF in the cadence rows. The falsification
// of the cadence check: at k=2 it must stop reading 16.7 ms.
const BURN = COST.burn;

const VIEWS: [number, number, number][] = [
  [22, 24, 0.5],
  [5, 22, 2.5],
  [26, 22, 1.6],
];

const PRESETS = arg('presets', 'high,medium,low')
  .split(',')
  .map((q) => q.trim())
  .filter((q): q is 'high' | 'medium' | 'low' => q === 'high' || q === 'medium' || q === 'low');
if (PRESETS.length === 0) throw new Error('--presets names no preset (high, medium, low)');

const stop = devServerStopper(await ensureDevServer(port, root, 'fx-cost'), 'fx-cost');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});

/** Boots `?sandbox=<mapId>` on a fresh page at the requested preset and refuses (exit 2)
 *  anything but hardware GPU. Shared by the GH-829 single-map run and the wet two-map run. */
async function bootPage(quality: 'high' | 'medium' | 'low', mapId: string): Promise<{ page: Page; gpu: string }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
  await page.addInitScript(musicOffInitScript({}, { quality }));
  await page.addInitScript('window.__name = (f) => f;');
  await page.goto(`http://localhost:${port}/?sandbox=${mapId}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const gpu = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  if (/swiftshader|llvmpipe|software/i.test(gpu) || gpu === 'unknown') {
    console.error(`fx-cost: refusing to time on "${gpu}" (need hardware Metal)`);
    await browser.close();
    stop();
    process.exit(2);
  }
  return { page, gpu };
}

/** Free-running cadence with the app's own loop on (GH-829): rAF-to-rAF intervals per view,
 *  BEFORE the loop is frozen. This is what a player sees; the readPixels rows are serialised GPU
 *  latency. `tag` (e.g. ` map=ein_qasab quality=high`) is empty in the single-map run. */
async function reportCadence(page: Page, tag: string): Promise<void> {
  const cadence = await page.evaluate(async (burn) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).__lions;
    const r = L.renderer;
    const base = { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom };
    const out: Record<string, { med: number; p95: number; over20: number; over25: number; frames: number }> = {};
    for (const z of [base.zoom, 1.6, 2.5]) {
      r.camera.x = base.x;
      r.camera.y = base.y;
      r.camera.zoom = z;
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
      const d: number[] = [];
      let last = performance.now();
      for (let i = 0; i < 300; i++) {
        const now = await new Promise<number>((res) =>
          requestAnimationFrame((t) => {
            for (let b = 0; b < burn; b++) r.frame(1, 0);
            res(t);
          })
        );
        d.push(now - last);
        last = now;
      }
      const sorted = [...d].sort((a, b) => a - b);
      out[`z${z}`] = { med: sorted[150], p95: sorted[285], over20: d.filter((v) => v > 20).length / d.length, over25: d.filter((v) => v > 25).length / d.length, frames: d.length };
    }
    r.camera.x = base.x;
    r.camera.y = base.y;
    r.camera.zoom = base.zoom;
    return out;
  }, BURN);
  console.log(`${label} CADENCE${tag} burn=${BURN} (app loop live, rAF intervals, loadavg ${os.loadavg().map((v) => v.toFixed(1)).join('/')}, visibility ${await page.evaluate(() => document.visibilityState)})`);
  for (const [k, v] of Object.entries(cadence)) {
    console.log(`  ${k.padEnd(6)} med ${v.med.toFixed(2)} ms  p95 ${v.p95.toFixed(2)}  >20ms ${(v.over20 * 100).toFixed(1)}%  >25ms ${(v.over25 * 100).toFixed(1)}%  (${v.frames} frames)`);
  }
}

// ---------------------------------------------------------------------------
// GH-871 P4 T10: `--breakdown --maps=<a>,<b>`, the wet two-map run.
//
// One page per map per preset, booted and cadence-read one after the other (each page's own
// rAF loop is frozen before the next boots, so a cadence never shares the GPU with another
// page), then ONE interleaved timing loop over `buildSchedule`: round -> view slot -> map ->
// config, so the reference map shares the run's load drift. Each timing is one `page.evaluate`
// that switches ONE thing off, times it readPixels-synced, and switches it back.
// ---------------------------------------------------------------------------

interface WetCell {
  med: number;
  p95: number;
  cpu: number;
  calls: number;
  tris: number;
}

interface WetInstall {
  facts: WetFacts;
  pixelRatio: number;
  canvas: [number, number];
  passes: string;
  entities: number;
  mapSize: [number, number];
  boot: { x: number; y: number; zoom: number };
}

/** Installs `window.__fx` on a page whose rAF loop is about to be frozen: the config table, the
 *  view setter and the timer. Reads the renderer's wet facts, which `resolveWetConfigs` turns
 *  into which configs have something to act on. A renderer that no longer has the private
 *  fields this reads throws (never a silently-dry reading). */
async function installWetHarness(page: Page, frames: number): Promise<WetInstall> {
  return page.evaluate((n) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).__lions;
    const r = L.renderer;
    for (const k of ['opts', 'rain', 'groundMat', 'reducedNow', 'ripplesAllowed']) {
      if (!(k in r)) throw new Error(`fx-cost: the renderer has no "${k}" (ThreeRenderer renamed it? the wet facts cannot be read)`);
    }
    window.requestAnimationFrame = () => 0; // freeze the app's loop; we pump frames
    const canvas: HTMLCanvasElement = r.canvas;
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    const info = r.renderer.info;
    const syncPx = new Uint8Array(4);
    const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sun: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.scene.traverse((o: any) => {
      if (!sun && o.isDirectionalLight && o.castShadow) sun = o;
    });
    const boot = { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom };
    const shadowCurrent: number | null = sun ? sun.shadow.mapSize.x : null;
    const q = r.opts?.quality;
    const shadowPreset: number | null = q && typeof q.shadowMapSize === 'number' ? q.shadowMapSize : null;
    const facts = {
      rainMap: r.opts?.weather === 'rain',
      wetGround: r.groundMat?.wet === true,
      rainBatch: r.rain != null,
      wetDefine: r.groundMat?.defines?.THEME_WET !== undefined,
      ripplesAllowed: r.ripplesAllowed() === true,
      reducedMotion: r.reducedNow === true,
      shadowCurrent,
      shadowPreset,
    };

    interface Cfg {
      off: () => void;
      on: () => void;
      check?: () => void;
    }
    const layers = (names: string[], what: string): Cfg => {
      const flip = (visible: boolean): void => {
        let changed = 0;
        for (const l of names) changed += r.setDebugLayerVisible(l, visible);
        if (changed === 0) throw new Error(`fx-cost: ${visible ? 'showing' : 'hiding'} ${what} changed nothing (layer(s) ${names.join('+')})`);
      };
      return { off: () => flip(false), on: () => flip(true) };
    };
    // The shadow map back at the preset's own size: set mapSize, drop the render target so three
    // reallocates it on the next shadow pass, and restore both afterwards.
    const reshape = (size: number): void => {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) sun.shadow.map.dispose();
      sun.shadow.map = null;
      if (sun.shadow.mapPass) {
        sun.shadow.mapPass.dispose();
        sun.shadow.mapPass = null;
      }
    };
    const cfgs: Record<string, Cfg> = {
      baseline: { off: () => {}, on: () => {} },
      rain: layers(['rain'], 'the rain'),
      wet: layers(['wet'], 'the puddle and water amplitude'),
      marsh: layers(['marsh'], 'the marsh water'),
      ripples: layers(['ripples'], 'the ripples'),
      'wet-all': layers(['rain', 'wet', 'marsh', 'ripples'], 'the wet layers'),
    };
    // The wet ground PROGRAM off (`wet-program`): `wet-all` only zeroes uniforms, and the compiled
    // THEME_WET blocks (control-C fetch, rim derivatives, mix, roughness, normal) run in both of its
    // arms. Deleting the define changes the program's cache key (three folds `defines` into it) and
    // `needsUpdate` makes it relink; the blocks are `#ifdef THEME_WET`, so the dry ground results.
    // The rain and the ripples are hidden too. Asserted, not assumed: the program's own cacheKey
    // must differ from the wet one after the warm frames, or this throws instead of timing a no-op.
    if (facts.wetGround && facts.wetDefine) {
      const gm = r.groundMat;
      const progKey = (): string => {
        const prog = r.renderer.properties.get(gm).currentProgram;
        if (!prog || typeof prog.cacheKey !== 'string') throw new Error('fx-cost: the ground material has no current program to read a cacheKey from');
        return prog.cacheKey as string;
      };
      let wetKey = '';
      const hide = layers(['rain', 'ripples'], 'the rain and the ripples');
      cfgs['wet-program'] = {
        off: () => {
          if (gm.defines.THEME_WET === undefined) throw new Error('fx-cost: wet-program: the ground has no THEME_WET define to remove');
          r.frame(1, 0); // the previous restore has not drawn yet: make the current program the wet one before reading it
          wetKey = progKey();
          hide.off();
          delete gm.defines.THEME_WET;
          gm.needsUpdate = true;
        },
        on: () => {
          gm.defines.THEME_WET = '';
          gm.needsUpdate = true;
          hide.on();
        },
        check: () => {
          const dry = progKey();
          if (dry === wetKey) throw new Error('fx-cost: wet-program: removing THEME_WET left the same compiled program (' + dry.slice(0, 80) + '), the timing would be a no-op');
        },
      };
    }
    if (sun && shadowPreset !== null && shadowCurrent !== null && shadowPreset > shadowCurrent) {
      cfgs['shadow-full'] = {
        off: () => reshape(shadowPreset),
        on: () => reshape(shadowCurrent),
        check: () => {
          const w = sun.shadow.map?.width;
          if (w !== shadowPreset) throw new Error(`fx-cost: shadow-full timed a ${String(w)} px shadow map, expected ${shadowPreset}`);
        },
      };
    }
    const time = (): WetCell => {
      for (let i = 0; i < 20; i++) r.frame(1, 16);
      info.autoReset = false;
      info.reset();
      r.frame(1, 16);
      const calls = info.render.calls;
      const tris = info.render.triangles;
      info.autoReset = true;
      sync();
      const w: number[] = [];
      const c: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        r.frame(1, 0);
        const t1 = performance.now();
        sync();
        w.push(performance.now() - t0);
        c.push(t1 - t0);
      }
      w.sort((a, b) => a - b);
      c.sort((a, b) => a - b);
      return { med: w[Math.floor(n / 2)], p95: w[Math.floor(n * 0.95)], cpu: c[Math.floor(n / 2)], calls, tris };
    };
    const setView = (v: { at: { kind: string; marker?: string; x?: number; y?: number }; zoom: number | null }): void => {
      if (v.at.kind === 'boot') {
        r.camera.x = boot.x;
        r.camera.y = boot.y;
      } else if (v.at.kind === 'marker') {
        const p = L.goto(v.at.marker);
        if (!p) throw new Error(`fx-cost: marker "${v.at.marker}" is not on this map (goto returned null)`);
      } else {
        r.camera.x = v.at.x;
        r.camera.y = v.at.y;
      }
      r.camera.zoom = v.zoom ?? boot.zoom;
    };
    (window as unknown as { __fx: unknown }).__fx = { cfgs, time, setView };
    return {
      facts,
      pixelRatio: r.renderer.getPixelRatio(),
      canvas: [canvas.width, canvas.height] as [number, number],
      passes: r.post.passNames.join('>'),
      entities: L.sim.entityCount,
      mapSize: [L.sim.width, L.sim.height] as [number, number],
      boot,
    };
  }, frames);
}

/** One timing: set the view, switch ONE config off, time it, and switch it back (always). */
async function timeWetStep(page: Page, view: ViewSpec, config: string): Promise<WetCell> {
  return page.evaluate(
    ([v, cfgName]) => {
      const fx = (window as unknown as {
        __fx: { cfgs: Record<string, { off: () => void; on: () => void; check?: () => void } | undefined>; time: () => WetCell; setView: (v: unknown) => void };
      }).__fx;
      const cfg = fx.cfgs[cfgName as string];
      if (!cfg) throw new Error(`fx-cost: config "${String(cfgName)}" was scheduled but never built (its resolution said it could run)`);
      fx.setView(v);
      cfg.off();
      try {
        const cell = fx.time();
        cfg.check?.();
        return cell;
      } finally {
        cfg.on();
      }
    },
    [view, config] as const
  );
}

async function runWet(): Promise<void> {
  const configs = wetConfigList();
  for (const quality of PRESETS) {
    const loadBefore = os.loadavg();
    const booted = new Map<string, { page: Page; gpu: string; install: WetInstall; res: Record<string, Resolution> }>();
    for (const mapId of COST.maps) {
      const { page, gpu } = await bootPage(quality, mapId);
      await page.waitForTimeout(4000);
      await reportCadence(page, ` map=${mapId} quality=${quality}`);
      const install = await installWetHarness(page, FRAMES);
      const res: Record<string, Resolution> = { [BASELINE]: { resolves: true }, ...resolveWetConfigs(install.facts) };
      booted.set(mapId, { page, gpu, install, res });
    }
    const schedule = buildSchedule({ maps: COST.maps, rounds: ROUNDS, views: COST.views, configs });
    // cells[map][view][config] = one Cell per round.
    const cells: Record<string, Record<string, Record<string, WetCell[]>>> = {};
    let last: Page | null = null;
    for (const step of schedule) {
      const b = booted.get(step.map) as NonNullable<ReturnType<typeof booted.get>>;
      if (!(b.res[step.config] as Resolution).resolves) continue;
      if (last !== b.page) {
        await b.page.bringToFront();
        last = b.page;
      }
      const view = (COST.views[step.map] as readonly ViewSpec[])[step.viewIndex] as ViewSpec;
      const cell = await timeWetStep(b.page, view, step.config);
      (((cells[step.map] ??= {})[step.view] ??= {})[step.config] ??= []).push(cell);
    }
    for (const mapId of COST.maps) {
      const b = booted.get(mapId) as NonNullable<ReturnType<typeof booted.get>>;
      const i = b.install;
      console.log(
        `${label} BREAKDOWN map=${mapId} quality=${quality} dprRequested=${DPR} pixelRatio=${i.pixelRatio} canvas=${i.canvas.join('x')} gpu=${b.gpu} rounds=${ROUNDS} frames=${FRAMES} passes=${i.passes} entities=${i.entities} map=${i.mapSize.join('x')} boot=${JSON.stringify(i.boot)} facts=${JSON.stringify(i.facts)}`
      );
      for (const view of COST.views[mapId] as readonly ViewSpec[]) {
        console.log(` view ${view.name}`);
        const byCfg = cells[mapId]?.[view.name] ?? {};
        const base = planMedianOf((byCfg[BASELINE] ?? []).map((c) => c.med));
        for (const name of configs) {
          const resolution = b.res[name] as Resolution;
          const cs = byCfg[name];
          if (!resolution.resolves) {
            console.log(`  ${name.padEnd(26)} ${formatDelta(deltaRow(base, base, resolution))}`);
            continue;
          }
          if (!cs) throw new Error(`fx-cost: ${mapId} view ${view.name} config ${name} resolved but was never timed (the schedule skipped it)`);
          const meds = cs.map((c) => c.med);
          const m = planMedianOf(meds);
          console.log(
            `  ${name.padEnd(26)} med ${m.toFixed(2)} ms (rounds ${meds.map((v) => v.toFixed(1)).join('/')})  p95 ${planMedianOf(cs.map((c) => c.p95)).toFixed(2)}  cpu ${planMedianOf(cs.map((c) => c.cpu)).toFixed(2)}  ${formatDelta(deltaRow(base, m, resolution))}  calls ${(cs[0] as WetCell).calls}  tris ${((cs[0] as WetCell).tris / 1000).toFixed(0)}k`
          );
        }
        const medOf = (name: string): number => planMedianOf((byCfg[name] ?? []).map((c) => c.med));
        const rainCalls = byCfg['rain']?.[0]?.calls;
        const baseCalls = byCfg[BASELINE]?.[0]?.calls;
        if (rainCalls !== undefined && baseCalls !== undefined && rainCalls !== baseCalls - 1) {
          console.log(`  WARN: hiding the rain changed draw calls ${baseCalls} -> ${rainCalls}, expected exactly -1 (one instanced draw)`);
        }
        const netIn = {
          base,
          wetAll: { med: byCfg['wet-all'] ? medOf('wet-all') : 0, resolution: b.res['wet-all'] as Resolution },
          wetProgram: { med: byCfg['wet-program'] ? medOf('wet-program') : 0, resolution: b.res['wet-program'] as Resolution },
          shadowFull: { med: byCfg['shadow-full'] ? medOf('shadow-full') : 0, resolution: b.res['shadow-full'] as Resolution },
        };
        console.log(`  ${formatNetLayers(netCost(netIn))}`);
        console.log(`  ${formatNetTotal(quality, totalNetCost(netIn))}`);
        console.log('  note: `wet` zeroes the ripple branch as well, so the rain/wet/marsh/ripples deltas are not additive; wet-program removes the whole wet ground program and the rain and ripples.');
      }
    }
    // The whole frame against the reference map's, view slot by view slot (the plan's decision-13 target).
    if (COST.maps.length >= 2) {
      const [a, ref] = COST.maps as [string, string, ...string[]];
      const av = COST.views[a] as readonly ViewSpec[];
      const rv = COST.views[ref] as readonly ViewSpec[];
      for (let k = 0; k < Math.min(av.length, rv.length); k++) {
        const ma = planMedianOf((cells[a]?.[(av[k] as ViewSpec).name]?.[BASELINE] ?? []).map((c) => c.med));
        const mr = planMedianOf((cells[ref]?.[(rv[k] as ViewSpec).name]?.[BASELINE] ?? []).map((c) => c.med));
        console.log(`WHOLE-FRAME ${quality} ${a}[${(av[k] as ViewSpec).name}] ${ma.toFixed(2)} ms vs ${ref}[${(rv[k] as ViewSpec).name}] ${mr.toFixed(2)} ms  gap ${(ma - mr).toFixed(2)}`);
      }
    }
    console.log(formatLoadLine(quality, loadBefore, os.loadavg()));
    for (const b of booted.values()) await b.page.close();
  }
}

interface Row {
  med: number;
  p95: number;
  calls: number;
  note?: string;
}

try {
  if (COST.wet) await runWet();
  // The GH-829 breakdown and the FX rows: a wet run has done its work above and has no preset left here.
  for (const quality of COST.wet ? [] : PRESETS) {
    const { page, gpu } = await bootPage(quality, MAP);
    if (BREAKDOWN) {
      await page.waitForTimeout(4000);
      await reportCadence(page, '');
      const out = await page.evaluate(
        ([rounds, n]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const L = (window as any).__lions;
          const r = L.renderer;
          window.requestAnimationFrame = () => 0; // freeze the app's loop; we pump frames
          const canvas: HTMLCanvasElement = r.canvas;
          const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
          const info = r.renderer.info;
          const syncPx = new Uint8Array(4);
          const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPx);
          const post = r.post;
          const passes: { constructor: { name: string }; enabled: boolean }[] = post.composer.passes;
          const byName = (nm: string) => passes.find((p) => p.constructor.name === nm);
          const sun = (() => {
            let found: { castShadow: boolean } | null = null;
            r.scene.traverse((o: { isDirectionalLight?: boolean; castShadow?: boolean }) => {
              if (!found && o.isDirectionalLight && o.castShadow) found = o as { castShadow: boolean };
            });
            return found as { castShadow: boolean } | null;
          })();
          const sm = r.renderer.shadowMap;
          interface Cfg {
            name: string;
            off: () => void;
            on: () => void;
          }
          const passCfg = (label: string, nm: string): Cfg => ({
            name: `-${label}`,
            off: () => {
              const p = byName(nm);
              if (!p) throw new Error(`no pass ${nm}`);
              p.enabled = false;
            },
            on: () => {
              const p = byName(nm);
              if (p) p.enabled = true;
            },
          });
          const layerCfg = (label: string, layer: string): Cfg => ({
            name: `-${label}`,
            off: () => r.setDebugLayerVisible(layer, false),
            on: () => r.setDebugLayerVisible(layer, true),
          });
          const present = (nm: string): boolean => !!byName(nm);
          const cfgs: Cfg[] = [{ name: 'baseline', off: () => {}, on: () => {} }];
          // Shadow casting pass only (map goes stale, sampling remains) vs the whole shadow (light stops casting).
          cfgs.push({ name: '-shadow-cast-pass', off: () => { sm.autoUpdate = false; sm.needsUpdate = false; }, on: () => { sm.autoUpdate = true; } });
          if (sun) cfgs.push({ name: '-shadow-all', off: () => { sun.castShadow = false; }, on: () => { sun.castShadow = true; } });
          cfgs.push(passCfg('RenderPass(scene)', 'RenderPass'));
          if (present('FogOfWarPass')) cfgs.push(passCfg('fog-pass', 'FogOfWarPass'));
          if (present('WorldGTAOPass')) cfgs.push(passCfg('GTAO', 'WorldGTAOPass'));
          const bloomName = passes.map((p) => p.constructor.name).find((nm) => /bloom/i.test(nm));
          if (bloomName) cfgs.push(passCfg('bloom', bloomName));
          cfgs.push(passCfg('OutputPass', 'OutputPass'));
          cfgs.push(passCfg('vignette', 'VignettePass'));
          if (present('SMAAPass')) cfgs.push(passCfg('SMAA', 'SMAAPass'));
          for (const [l, k] of [['units', 'units'], ['buildings', 'buildings'], ['decals', 'decals'], ['scatter', 'scatter'], ['decor', 'decor'], ['props', 'props'], ['overlays', 'overlays'], ['ground-albedo', 'ground-albedo'], ['macro', 'macro'], ['roads', 'roads'], ['haze', 'haze']] as const) {
            cfgs.push(layerCfg(l, k));
          }
          // Ground only: every object layer hidden, the ground shader still drawn.
          const OBJECT_LAYERS = ['units', 'buildings', 'decals', 'scatter', 'decor', 'props', 'overlays'];
          cfgs.push({
            name: '-ALL-objects(ground only)',
            off: () => { for (const l of OBJECT_LAYERS) r.setDebugLayerVisible(l, false); },
            on: () => { for (const l of OBJECT_LAYERS) r.setDebugLayerVisible(l, true); },
          });
          // Everything but the scene + output: the post chain's whole cost by difference.
          const postNames = passes.map((p) => p.constructor.name).filter((nm) => nm !== 'RenderPass' && nm !== 'OutputPass');
          cfgs.push({
            name: '-ALL-POST(except Output)',
            off: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = false; } },
            on: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = true; } },
          });
          cfgs.push({
            name: '-ALL-POST+shadow-cast',
            off: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = false; } sm.autoUpdate = false; sm.needsUpdate = false; },
            on: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = true; } sm.autoUpdate = true; },
          });

          interface Cell {
            med: number;
            p95: number;
            cpu: number;
            calls: number;
            tris: number;
          }
          const time = (): Cell => {
            for (let i = 0; i < 20; i++) r.frame(1, 16);
            info.autoReset = false;
            info.reset();
            r.frame(1, 16);
            const calls = info.render.calls;
            const tris = info.render.triangles;
            info.autoReset = true;
            sync();
            const w: number[] = [];
            const c: number[] = [];
            for (let i = 0; i < n; i++) {
              const t0 = performance.now();
              r.frame(1, 0);
              const t1 = performance.now();
              sync();
              w.push(performance.now() - t0);
              c.push(t1 - t0);
            }
            w.sort((a, b) => a - b);
            c.sort((a, b) => a - b);
            return { med: w[Math.floor(n / 2)], p95: w[Math.floor(n * 0.95)], cpu: c[Math.floor(n / 2)], calls, tris };
          };
          const views: Record<string, [number, number, number]> = {};
          const boot = { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom };
          views['boot'] = [boot.x, boot.y, boot.zoom];
          views['boot-z1.6'] = [boot.x, boot.y, 1.6];
          views['boot-z2.5'] = [boot.x, boot.y, 2.5];
          const res: Record<string, Record<string, Cell[]>> = {};
          for (const [vn, [x, y, z]] of Object.entries(views)) {
            r.camera.x = x;
            r.camera.y = y;
            r.camera.zoom = z;
            res[vn] = {};
            for (let round = 0; round < (rounds as number); round++) {
              for (const cfg of cfgs) {
                cfg.off();
                (res[vn][cfg.name] ??= []).push(time());
                cfg.on();
              }
            }
          }
          return { res, boot, passes: post.passNames.join('>'), size: [canvas.width, canvas.height], map: [L.sim.width, L.sim.height], pr: r.renderer.getPixelRatio(), sunFound: !!sun, entities: L.sim.entityCount };
        },
        [ROUNDS, FRAMES] as const
      );
      console.log(`${label} BREAKDOWN map=${MAP} quality=${quality} dprRequested=${DPR} pixelRatio=${out.pr} canvas=${out.size.join('x')} gpu=${gpu} loadavg=${os.loadavg().map((v) => v.toFixed(1)).join('/')} (before) passes=${out.passes} sun=${out.sunFound} entities=${out.entities} map=${out.map.join('x')} boot=${JSON.stringify(out.boot)}`);
      type Cell = { med: number; p95: number; cpu: number; calls: number; tris: number };
      const medianOf = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
      for (const [vn, cfgs] of Object.entries(out.res as Record<string, Record<string, Cell[]>>)) {
        console.log(` view ${vn}`);
        const base = medianOf(cfgs['baseline'].map((c) => c.med));
        for (const [name, cells] of Object.entries(cfgs)) {
          const meds = cells.map((c) => c.med);
          const m = medianOf(meds);
          console.log(
            `  ${name.padEnd(26)} med ${m.toFixed(2)} ms (rounds ${meds.map((v) => v.toFixed(1)).join('/')})  p95 ${medianOf(cells.map((c) => c.p95)).toFixed(2)}  cpu ${medianOf(cells.map((c) => c.cpu)).toFixed(2)}  delta ${(m - base).toFixed(2)}  calls ${cells[0].calls}  tris ${(cells[0].tris / 1000).toFixed(0)}k`
          );
        }
      }
      console.log(`loadavg after: ${os.loadavg().map((v) => v.toFixed(1)).join('/')}`);
      await page.close();
      continue;
    }
    // Warm the two vehicle types the stress spawns, off-view, with the app loop
    // still running so their meshes load; then take them out of play.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).__lions;
      const idx = (id: string): number => L.sim.unitTypes.findIndex((t: { id: string }) => t.id === id);
      const warm: number[] = [];
      for (const id of ['mbt_lavi', 'apc_eitan']) {
        if (idx(id) < 0) throw new Error(`fx-cost: unit type ${id} missing from the sandbox sim`);
        warm.push(L.sim.spawn(idx(id), 0, 3 * 65536, 3 * 65536));
      }
      (window as unknown as { __warm: number[] }).__warm = warm;
    });
    await page.waitForTimeout(6000);
    const res = await page.evaluate(
      ([views, budget]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const L = (window as any).__lions;
        const r = L.renderer;
        const FIXED = 65536;
        for (const id of (window as unknown as { __warm: number[] }).__warm) L.sim.removeFromPlay(id);
        window.requestAnimationFrame = () => 0; // freeze the app's loop; we pump frames
        const canvas: HTMLCanvasElement = r.canvas;
        const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
        const info = r.renderer.info;
        const syncPx = new Uint8Array(4);
        const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPx);
        const time = (n: number): Row => {
          for (let i = 0; i < 20; i++) r.frame(1, 16);
          info.autoReset = false;
          info.reset();
          r.frame(1, 16);
          const calls = info.render.calls;
          info.autoReset = true;
          sync();
          const w: number[] = [];
          for (let i = 0; i < n; i++) {
            const t0 = performance.now();
            r.frame(1, 0);
            sync();
            w.push(performance.now() - t0);
          }
          w.sort((a, b) => a - b);
          return { med: w[Math.floor(n / 2)], p95: w[Math.floor(n * 0.95)], calls };
        };
        const pump = (ms: number): void => {
          for (let t = 0; t < ms - 1e-6; t += 16.7) r.frame(1, 16.7);
        };
        const handTick = (): unknown[] => {
          const ev = L.sim.tick();
          r.snapshot();
          r.onEvents(ev);
          return ev;
        };
        const idx = (id: string): number => L.sim.unitTypes.findIndex((t: { id: string }) => t.id === id);
        const open = (x: number, y: number): boolean => L.sim.blocked[y * L.sim.width + x] === 0;
        const rows: Record<string, Row> = {};
        for (const [x, y, z] of views as [number, number, number][]) {
          r.camera.x = x;
          r.camera.y = y;
          r.camera.zoom = z;
          rows[`quiet z${z}`] = time(120);
        }
        const [cx, cy, cz] = (views as [number, number, number][])[2];
        r.camera.x = cx;
        r.camera.y = cy;
        r.camera.zoom = cz;

        // Open tiles on a ring-ish scatter round the view centre.
        const spots: [number, number][] = [];
        for (let dy = -6; dy <= 6; dy += 1) for (let dx = -8; dx <= 8; dx += 1) if (open(cx + dx, cy + dy)) spots.push([cx + dx, cy + dy]);
        spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
        // Thin to every other tile of the sorted list so units are not stacked.
        const spread = spots.filter((_, i) => i % 3 === 0);
        spots.length = 0;
        spots.push(...spread);

        // ---- smoke: ten Eitans, each laying at a tile 2-4 round the centre.
        const smokers: number[] = [];
        for (let i = 0; i < 10 && i < spots.length; i++) smokers.push(L.sim.spawn(idx('apc_eitan'), 0, spots[i][0] * FIXED, spots[i][1] * FIXED));
        r.snapshot();
        // Also every pre-existing side-0 unit that can smoke.
        const canSmokeIdx = new Set<number>();
        L.sim.unitTypes.forEach((t: { canSmoke?: boolean }, i: number) => {
          if (t.canSmoke) canSmokeIdx.add(i);
        });
        for (let i = 0; i < L.sim.entityCount; i++) {
          if (L.sim.state.alive[i] === 1 && L.sim.state.side[i] === 0 && canSmokeIdx.has(L.sim.state.typeIdx[i]) && !smokers.includes(i) && Math.hypot(L.sim.state.posX[i] / FIXED - cx, L.sim.state.posY[i] / FIXED - cy) < 5) smokers.push(i);
        }
        smokers.forEach((id, k) => {
          const a = (k / smokers.length) * Math.PI * 2;
          const d = 2 + (k % 3);
          L.sim.queueCommand({ kind: 'smoke', ids: [id], x: Math.round((cx + Math.cos(a) * d) * FIXED), y: Math.round((cy + Math.sin(a) * d) * FIXED) });
        });
        let laid = 0;
        let ticks = 0;
        while (ticks < 200 && laid < smokers.length) {
          const ev = handTick() as { kind: string }[];
          laid += ev.filter((e) => e.kind === 'smokeLaid').length;
          ticks++;
          r.frame(1, 50);
        }
        pump(1000);
        let smokedTiles = 0;
        for (let i = 0; i < L.sim.smoke.length; i++) if (L.sim.smoke[i] > 0) smokedTiles++;
        rows['smoke z1.6'] = { ...time(90), note: `smokers ${smokers.length}, smokeLaid ${laid} in ${ticks} ticks, smoked tiles ${smokedTiles}` };

        // Let the screen decay away in the SIM (SMOKE_DECAY 1 a tick from 255),
        // so the kill and grad rows below time no smoke. Before this, the
        // screen was still drawn in every later row (P1 review).
        for (let i = 0; i < 260; i++) handTick();
        pump(100);

        // ---- kill: 8 Lavis, one every 250 ms of FX time.
        const victims: number[] = [];
        const used = new Set(spots.slice(0, 10).map((s) => `${s[0]},${s[1]}`));
        for (const s of spots.slice(10)) {
          if (victims.length >= 8) break;
          if (used.has(`${s[0]},${s[1]}`)) continue;
          victims.push(L.sim.spawn(idx('mbt_lavi'), 0, s[0] * FIXED, s[1] * FIXED));
        }
        handTick();
        pump(500);
        let killed = 0;
        for (const v of victims) {
          L.sim.debugKill(v);
          handTick();
          pump(250);
        }
        for (const v of victims) if (L.sim.state.alive[v] === 0) killed++;
        pump(250); // settle to 500 ms after the last kill (250 already pumped after it)
        rows['kill z1.6 @500ms'] = { ...time(90), note: `kills ${killed}/${victims.length} (spawned ${victims.length})` };
        pump(3500);
        rows['kill z1.6 @4s'] = time(90);

        // ---- grad: 24 landings.
        pump(6000);
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const d = 2 + (k % 4) * 1.5;
          r.spawnShellLandingAt('rocket', cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        }
        pump(250);
        rows['grad z1.6 @250ms'] = time(90);
        pump(1500);
        rows['grad z1.6 @1.75s'] = time(90);
        return { rows, budget, passes: r.post.passNames.join('>') };
      },
      [VIEWS, BUDGET_MS] as const
    );
    console.log(`${label} quality=${quality} gpu=${gpu} passes=${res.passes}`);
    for (const [k, v] of Object.entries(res.rows as Record<string, Row>)) {
      const verdict = v.p95 <= BUDGET_MS ? 'holds 60' : 'LOSES 60';
      console.log(`  ${k.padEnd(18)} med ${v.med.toFixed(2)} ms  p95 ${v.p95.toFixed(2)} ms  calls ${v.calls}  ${verdict}${v.note ? `  [${v.note}]` : ''}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
