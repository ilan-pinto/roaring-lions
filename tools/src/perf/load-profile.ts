// Where does a level's load time go?
//
//   pnpm perf:load -- --mission=beit_sahwan_1_recon            # dev server (started if needed)
//   pnpm perf:load -- --sandbox=tel_marum --mbps=20            # throttled to a 20 Mbit/s downlink
//   pnpm perf:load -- --mission=tel_marum_2_foothold --serve=preview   # the production build in dist/
//   pnpm perf:load -- --mission=... --warm                     # HTTP cache AND service worker ON (a second visit)
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
// Bytes are grouped by what they are (mesh / sprite / code / data / audio /
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
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, type CDPSession, type Page } from 'playwright';
import { ensureDevServer, isServerUp, stopDevServer } from '../golden-diff/browser';

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
  };
}

type Category = 'mesh' | 'sprite' | 'code' | 'data' | 'audio' | 'video' | 'texture' | 'font' | 'other';

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
  if (/\.(png|jpe?g|webp)$/i.test(p)) return 'sprite';
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

type Milestones = { loadingScreen: number | null; sheets: number | null; ready: number | null; firstFrame: number | null; bootError: string | null };

async function drive(page: Page, url: string, timeoutMs: number): Promise<Milestones> {
  const m: Milestones = { loadingScreen: null, sheets: null, ready: null, firstFrame: null, bootError: null };
  const startedAt = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  // One poll loop over the page's own DOM, so every milestone is read against
  // the same clock (`performance.now()` in the page).
  while (Date.now() - startedAt < timeoutMs) {
    const s = await page.evaluate(() => {
      const wrap = document.querySelector('.rl-loading');
      const count = document.querySelector('.rl-loading__count')?.textContent ?? '';
      const match = /^(\d+) \/ (\d+) sheets$/.exec(count.trim());
      const deploy = document.querySelector<HTMLButtonElement>('.rl-loading__deploy');
      const bootError = /boot failed/i.test(document.body.innerText) ? document.body.innerText.slice(0, 200) : null;
      return {
        now: performance.now(),
        loading: wrap !== null,
        sheetsDone: match !== null && match[1] === match[2] && Number(match[2]) > 0,
        deploy: deploy !== null,
        lions: typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined',
        bootError,
      };
    });
    if (s.bootError) {
      m.bootError = s.bootError;
      return m;
    }
    if (m.loadingScreen === null && s.loading) m.loadingScreen = s.now;
    if (m.sheets === null && s.sheetsDone) m.sheets = s.now;
    if (m.ready === null && m.sheets !== null) {
      // `loading.done()` attaches the click handler only once every art job
      // has settled; a click before that is silently lost (the gate's own
      // finding), so keep clicking until the screen goes.
      m.ready = s.now;
    }
    if (m.ready !== null && s.loading && s.deploy) {
      await page.evaluate(() => document.querySelector<HTMLButtonElement>('.rl-loading__deploy')?.click());
    }
    if (s.lions) {
      m.firstFrame = s.now;
      return m;
    }
    await page.waitForTimeout(50);
  }
  return m;
}

function fmtMiB(b: number): string {
  return (b / 1048576).toFixed(2).padStart(7);
}
function fmtMs(v: number | null): string {
  return v === null ? '    -' : String(Math.round(v)).padStart(6);
}

async function startPreview(port: number): Promise<ChildProcess> {
  const child = spawn('pnpm', ['--filter', '@lions/app', 'exec', 'vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isServerUp(port)) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  stopDevServer(child, TAG);
  throw new Error(`vite preview did not come up on :${port} -- run \`pnpm build\` first`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let server: ChildProcess | null = null;
  if (args.serve === 'preview') {
    if (!(await isServerUp(args.port))) server = await startPreview(args.port);
  } else {
    server = await ensureDevServer(args.port, REPO_ROOT, TAG);
  }
  const query = args.mission ? `?mission=${args.mission}` : `?sandbox=${args.sandbox}`;
  const url = `http://localhost:${args.port}/${query}`;
  console.log(
    `[${TAG}] ${url}  serve=${args.serve}  ` +
      `cache=${args.warm ? 'ON, service worker ON (warm -- a returning player)' : 'OFF, service worker BYPASSED (cold -- a first visit)'}  ` +
      `${args.mbps ? `downlink ${args.mbps} Mbit/s, 20 ms latency` : 'unthrottled'}  runs=${args.runs}`
  );
  const browser = await chromium.launch({ headless: true });
  try {
    for (let run = 1; run <= args.runs; run++) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const requests = await attachNetwork(cdp, args.warm, args.mbps);
      const m = await drive(page, url, args.timeoutMs);
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
