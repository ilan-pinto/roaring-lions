// Where does a level's load time go?
//
//   pnpm perf:load -- --mission=beit_sahwan_1_recon            # dev server (started if needed)
//   pnpm perf:load -- --sandbox=tel_marum --mbps=20            # throttled to a 20 Mbit/s downlink
//   pnpm perf:load -- --mission=tel_marum_2_foothold --serve=preview   # the production build in dist/
//   pnpm perf:load -- --mission=... --warm                     # HTTP cache AND service worker ON (a second visit)
//   pnpm perf:load -- --mission=... --tail=5000                # keep counting 5 s past first-frame (late loads)
//   pnpm perf:load -- --mission=... --cpu=6 --gpu=swiftshader --viewport=1366x768   # a low-end proxy
//
// `--cpu=N` is CDP `Emulation.setCPUThrottlingRate` (the renderer's main
// thread only -- not the GPU process, not the network), `--gpu` takes
// `ui-review/gpu.ts`'s two backends (default Metal, the hardware GPU), and
// `--viewport` the CSS size at deviceScaleFactor 1 (default 1400x900). The
// low-end assessment (docs/PERFORMANCE.md, "Low-end") is what they are for.
//
// Loads one mission or sandbox in headless Chromium with the HTTP cache
// DISABLED (a first visit, or a visit after GitHub Pages' 10-minute max-age
// has lapsed -- which for a player between two levels is most visits) and
// reports, from the browser's own network events, every byte fetched and
// when the four boot milestones fell:
//
//   loading-screen   the deploy screen appears. Everything before it is the
//                    MESH phase: `main.ts` awaits every GLB the roster needs
//                    BEFORE `showLoading`, so until here the player sees the
//                    title card and nothing else.
//   sheets           the loading bar reaches N / N -- sprite sheets, structure
//                    sprites, portraits.
//   ready            the deploy button can be clicked (`loading.done()`).
//   first-frame      `window.__lions` exists after the click: the sim and
//                    renderer are up and the first frame has been asked for.
//
// Bytes are grouped by what they are (mesh / sprite sheet / image / code / data / audio /
// video / texture / font / other) so the answer to "what should we make
// smaller or lazier first" is a table, not an impression. Sizes are
// `Network.loadingFinished.encodedDataLength` -- what crossed the wire, which
// under `vite dev` is uncompressed and under `vite preview` is whatever that
// server sends; a real host's compression is a property of the host.
//
// The GL path is headless Chromium's default (SwiftShader), so GPU-side work
// (texture upload, shader compile) reads slower here than on a player's
// machine -- the NETWORK bytes and the ORDER of the milestones are the
// portable part of this report; the absolute milliseconds are this machine's.
// State capture conditions with every number you quote from it.
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, type CDPSession } from 'playwright';
import { driveBoot, startPreview } from './boot';
import { ensureDevServer, isServerUp, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs, resolveGpuBackend, type GpuBackend } from '../ui-review/gpu';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const TAG = 'load-profile';

type Args = {
  mission: string | null;
  sandbox: string | null;
  port: number;
  serve: 'dev' | 'preview';
  mbps: number | null;
  warm: boolean;
  runs: number;
  timeoutMs: number;
  /** Keep counting this long after first-frame, so the after-first-frame
   *  loads (wreck sheets, deferred buildables) are on the bill too. */
  tailMs: number;
  /** CDP CPU throttling rate; 1 is none. */
  cpu: number;
  gpu: GpuBackend;
  viewport: { width: number; height: number };
};

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  const serve = (get('serve') ?? 'dev') as Args['serve'];
  if (serve !== 'dev' && serve !== 'preview') throw new Error(`--serve must be dev or preview, got ${serve}`);
  const mission = get('mission') ?? null;
  const sandbox = get('sandbox') ?? null;
  if (!mission && !sandbox) throw new Error('pass --mission=<id> or --sandbox=<map id>');
  return {
    mission,
    sandbox,
    port: Number(get('port') ?? (serve === 'preview' ? 5188 : 5187)),
    serve,
    mbps: get('mbps') ? Number(get('mbps')) : null,
    warm: has('warm'),
    runs: Number(get('runs') ?? 1),
    timeoutMs: Number(get('timeout') ?? 180_000),
    tailMs: Number(get('tail') ?? 0),
    cpu: Number(get('cpu') ?? 1),
    // 'darwin' pins the default to Metal, which this tool has always used.
    gpu: resolveGpuBackend(argv, 'darwin'),
    viewport: parseViewport(get('viewport') ?? '1400x900'),
  };
}

function parseViewport(v: string): { width: number; height: number } {
  const [width, height] = v.split('x').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`--viewport must be WIDTHxHEIGHT, got ${v}`);
  return { width, height };
}

type Category = 'mesh' | 'sprite' | 'image' | 'code' | 'data' | 'audio' | 'video' | 'texture' | 'font' | 'other';

function categorise(url: string, mimeType: string): Category {
  const p = url.split('?')[0];
  if (/\.glb$/i.test(p)) return 'mesh';
  if (/\/sprites\//.test(p)) return 'sprite';
  if (/\/audio\//.test(p) || /^audio\//.test(mimeType)) return 'audio';
  if (/\/video\//.test(p) || /^video\//.test(mimeType)) return 'video';
  if (/\/textures\//.test(p)) return 'texture';
  if (/\/fonts\//.test(p) || /\.woff2?$/i.test(p)) return 'font';
  if (/\.(js|mjs|ts|css|html)$/i.test(p) || /@vite|@fs.*\.ts|node_modules/.test(p) || /javascript|css|html/.test(mimeType)) return 'code';
  if (/\.json$/i.test(p) || /json/.test(mimeType)) return 'data';
  // `sprite` is a sheet under /sprites/ and nothing else; every other picture
  // (portraits, plates, UI art) is `image`, so the sheet count reads alone.
  if (/\.(png|jpe?g|webp)$/i.test(p)) return 'image';
  return 'other';
}

type Req = { url: string; mime: string; bytes: number; start: number; end: number; category: Category };

async function attachNetwork(cdp: CDPSession, warm: boolean, mbps: number | null): Promise<() => Req[]> {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !warm });
  // The service worker (level load time step 5) has to be bypassed on a COLD
  // run, and this is not a tidy-up -- without it this tool silently stops
  // measuring what it says it measures. A worker that has claimed the client
  // serves requests out of the Cache API, and Chrome reports
  // `encodedDataLength: 0` for those, so the run still counts 161 requests
  // and reports 0.39 MiB while printing "cache=OFF (cold)". Measured the day
  // the worker landed, against a real 16.59 MiB.
  //
  // `--warm` deliberately leaves it ON: with the worker in the build, "warm"
  // is no longer just the HTTP cache, it is the returning player, and that is
  // the thing step 5 exists to improve.
  await cdp.send('Network.setBypassServiceWorker', { bypass: !warm });
  if (mbps !== null) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 20,
      downloadThroughput: (mbps * 1_000_000) / 8,
      uploadThroughput: (5 * 1_000_000) / 8,
    });
  }
  const open = new Map<string, { url: string; mime: string; start: number }>();
  const done: Req[] = [];
  let t0: number | null = null;
  cdp.on('Network.requestWillBeSent', (e) => {
    if (t0 === null) t0 = e.timestamp;
    open.set(e.requestId, { url: e.request.url, mime: '', start: e.timestamp });
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = open.get(e.requestId);
    if (r) r.mime = e.response.mimeType;
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = open.get(e.requestId);
    if (!r || t0 === null) return;
    open.delete(e.requestId);
    done.push({
      url: r.url,
      mime: r.mime,
      bytes: e.encodedDataLength,
      start: (r.start - t0) * 1000,
      end: (e.timestamp - t0) * 1000,
      category: categorise(r.url, r.mime),
    });
  });
  return () => done.slice();
}

function fmtMiB(b: number): string {
  return (b / 1048576).toFixed(2).padStart(7);
}
function fmtMs(v: number | null): string {
  return v === null ? '    -' : String(Math.round(v)).padStart(6);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let server: ChildProcess | null = null;
  if (args.serve === 'preview') {
    if (!(await isServerUp(args.port))) server = await startPreview(args.port, REPO_ROOT, TAG);
  } else {
    server = await ensureDevServer(args.port, REPO_ROOT, TAG);
  }
  const query = args.mission ? `?mission=${args.mission}` : `?sandbox=${args.sandbox}`;
  const url = `http://localhost:${args.port}/${query}`;
  console.log(
    `[${TAG}] ${url}  serve=${args.serve}  ` +
      `cache=${args.warm ? 'ON, service worker ON (warm -- a returning player)' : 'OFF, service worker BYPASSED (cold -- a first visit)'}  ` +
      `${args.mbps ? `downlink ${args.mbps} Mbit/s, 20 ms latency` : 'unthrottled'}  runs=${args.runs}` +
      `  cpu=${args.cpu}x  gpu=${args.gpu}  viewport=${args.viewport.width}x${args.viewport.height}@1x` +
      (args.tailMs > 0 ? `  tail=${args.tailMs} ms after first-frame` : '')
  );
  // **The real GPU, and printing which one.** This harness measures SPEED, and
  // a player never runs on a software rasteriser -- so it takes the same
  // arguments `perf/backend-curve-gate.ts` takes, for the reason
  // `docs/PERFORMANCE.md` gives at length: Playwright's default headless
  // launch renders WebGL through SwiftShader, and that was "the single largest
  // confound found while producing this doc".
  //
  // This file went four steps of the load-time plan without them (2026-09-07
  // to 09-08), so every `first-frame` it reported in that window was a
  // software-rasteriser number. The bytes and request counts were never
  // affected -- the network does not care what draws -- but the milestone that
  // step 6 exists to attack was measured through the wrong renderer, and
  // nothing in the output said so. That is the point of the header line below:
  // a number from this tool can no longer be quoted without its renderer.
  //
  // The golden-image gate makes the OPPOSITE choice deliberately, and both are
  // right: speed wants the GPU, reproducibility wants the CPU
  // (`golden-diff/browser.ts`'s `launchCaptureBrowser`).
  const browser = await chromium.launch({
    headless: true,
    args: gpuLaunchArgs(args.gpu),
  });
  try {
    // Read, never assumed -- the same probe the visual gate keys its baselines
    // on. If this ever prints SwiftShader again, every millisecond below is a
    // CPU rasteriser's and the `first-frame` figure means something else.
    console.log(`[${TAG}] renderer: ${await readUnmaskedRenderer(browser)}`);
    for (let run = 1; run <= args.runs; run++) {
      const context = await browser.newContext({ viewport: args.viewport, deviceScaleFactor: 1 });
      await context.addInitScript(musicOffInitScript());
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      if (args.cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: args.cpu });
      const requests = await attachNetwork(cdp, args.warm, args.mbps);
      const m = await driveBoot(page, url, args.timeoutMs);
      if (args.tailMs > 0 && m.firstFrame !== null) await page.waitForTimeout(args.tailMs);
      const reqs = requests();
      await context.close();

      if (m.bootError) {
        console.error(`[${TAG}] run ${run}: BOOT FAILED -- ${m.bootError}`);
        process.exitCode = 2;
        continue;
      }
      const byCat = new Map<Category, { n: number; bytes: number; lastEnd: number }>();
      for (const r of reqs) {
        const c = byCat.get(r.category) ?? { n: 0, bytes: 0, lastEnd: 0 };
        c.n++;
        c.bytes += r.bytes;
        c.lastEnd = Math.max(c.lastEnd, r.end);
        byCat.set(r.category, c);
      }
      const total = reqs.reduce((a, r) => a + r.bytes, 0);
      console.log(`\n[${TAG}] run ${run}: ${reqs.length} requests, ${fmtMiB(total).trim()} MiB over the wire`);
      console.log(`  milestones (ms from navigation):  loading-screen ${fmtMs(m.loadingScreen)}   sheets ${fmtMs(m.sheets)}   ready ${fmtMs(m.ready)}   first-frame ${fmtMs(m.firstFrame)}`);
      console.log('  category       requests      MiB   last byte (ms)');
      for (const [cat, c] of [...byCat.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
        console.log(`  ${cat.padEnd(12)} ${String(c.n).padStart(10)} ${fmtMiB(c.bytes)} ${String(Math.round(c.lastEnd)).padStart(14)}`);
      }
      console.log('  largest fetches:');
      for (const r of [...reqs].sort((a, b) => b.bytes - a.bytes).slice(0, 15)) {
        const name = r.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '').split('/').slice(-2).join('/');
        console.log(`  ${fmtMiB(r.bytes)} MiB  ${String(Math.round(r.start)).padStart(6)}-${String(Math.round(r.end)).padEnd(6)} ms  ${name}`);
      }
      if (m.firstFrame === null) {
        console.error(`[${TAG}] run ${run}: never reached first-frame inside ${args.timeoutMs} ms`);
        process.exitCode = 1;
      }
    }
  } finally {
    await browser.close();
    stopDevServer(server, TAG);
  }
}

main().catch((err: unknown) => {
  console.error(`[${TAG}] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
