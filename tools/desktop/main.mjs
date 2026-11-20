// GH-1418: the Electron main process of the UNSIGNED local desktop build (`pnpm desktop:package`).
//
// `tools/desktop/build-local.mjs` copies this file, unchanged, into the bundle's `app.asar` with `policy.mjs`,
// `resolve.mjs` and a `desktop-build.json` manifest; the web build (`packages/app/dist`, built with the demo's content
// cut baked in, GH-1418) ships beside it as loose files in `resources/web/`. It is not imported by anything in `packages/`, and it changes no app code.
//
// Why a custom scheme and not `file://`: the Vite build uses `base: '/'`, so every chunk, GLB, texture, audio file and
// the Draco decoder is fetched by an ABSOLUTE path (`/assets/...`, `/draco/...`, `/meshes/...`). Under `file://` those
// resolve against the filesystem root and the game boots into 404s. A privileged standard scheme gives the page a real
// origin (`app://roaring-lions.local`) whose `/` is the bundled `web/` directory, so the build ships byte-for-byte as
// it deploys, with no second `VITE_BASE` build and no edit to the entry chunk.
//
// Why the host ends in `.local`: see `policy.mjs`'s HOST. Telemetry, accounts and feedback stay off; so do the
// production-only notices that share that gate (the software-renderer card, the slow-frames hint, What's new opening on
// its own). Versus rooms are NOT behind that gate: the lobby POSTs `${location.origin}/api/match` (`net/connect.ts`),
// which lands on this scheme, so `resolve.mjs` answers every `/api/` path with a 404 and the lobby fails cleanly.
//
// Every security rule (webPreferences, navigation, external links, permissions, the CSP, the smoke gate) is in
// `policy.mjs` and pinned by `tools/src/desktop_policy.test.ts`; this file only wires them into Electron.
//
// Crash reports (GH-1414): `crash.mjs` decides what a report is, whether this run makes one and where it goes; this file
// only hands it Electron's events. NO minidump: `crashReporter` is never started. The main process does the POST, never
// the page, so the page's CSP and navigation rules are unchanged. Off unless the bundle was packaged with
// `--crash-reports`, and the player's Settings switch ("Anonymous usage and crash reports") turns it off.
//
// The smoke check: a bundle packaged with `--smoke` (its manifest says `smoke: true`) and run with `RL_DESKTOP_SMOKE=1`
// loads `index.html`, probes WebGL2 (and reports WebGPU), probes the policy from inside the page, writes a screenshot and
// one `RL_SMOKE {json}` line to stdout, then exits 0 on a pass and 1 on a failure. A shipped bundle (`smoke: false`)
// ignores the variable. Every bundle prints one `RL_DESKTOP_READY {json}` line when the first page has loaded.
// Spec: docs/superpowers/specs/2026-11-17-desktop-wrapper-spike.md, section 9.

import { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ORIGIN,
  SCHEME,
  HOST,
  WEB_PREFERENCES,
  externalUrlAllowed,
  isAppUrl,
  parseStaticHeaders,
  permissionAllowed,
  requireCsp,
  smokeAllowed,
} from './policy.mjs';
import { resolveRequest } from './resolve.mjs';
import {
  CRASH_USER_AGENT,
  GPU_PROBE,
  OPTOUT_PROBE,
  crashDestination,
  crashMode,
  drain,
  fitRecord,
  goneRecord,
  gpuFamily,
  gpuFamilyFromInfo,
  launchBudget,
  mainErrorRecord,
  optedOutValue,
  outbox,
  pageErrorRecord,
} from './crash.mjs';

// The web build sits OUTSIDE the asar, as loose files (`extraResource`), so a patch moves only the files it changed.
const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(import.meta.dirname, 'web');

/** `desktop-build.json`, written by build-local.mjs: version, commit, smoke. Null when absent or unreadable. */
function readBuild() {
  try {
    return JSON.parse(readFileSync(path.join(import.meta.dirname, 'desktop-build.json'), 'utf8'));
  } catch {
    return null;
  }
}
const BUILD = readBuild();
const SMOKE = smokeAllowed(BUILD, process.env);
const SMOKE_OUT = SMOKE ? (process.env.RL_DESKTOP_SMOKE_OUT ?? '') : '';
// How long the smoke run lets the menu boot (dynamic imports, the menu diorama's GLBs) before it reads the page.
const SMOKE_SETTLE_MS = Number(process.env.RL_DESKTOP_SMOKE_SETTLE_MS ?? 8000);
const SMOKE_TIMEOUT_MS = 120_000;
// The screen path the smoke run opens (default the menu). A deep path (`/free-play`) exercises the SPA fallback.
const SMOKE_PATH = SMOKE ? (process.env.RL_DESKTOP_SMOKE_PATH ?? '/') : '/';
// The smoke run never opens the player's browser: it records what WOULD have been opened.
const externalOpened = [];
// The smoke run's crash check: after the policy probe, force a page error and a renderer crash, and read back the
// reports the run made (which a smoke bundle records and never sends).
const SMOKE_CRASH = SMOKE && process.env.RL_DESKTOP_SMOKE_CRASH === '1';

// ---- GH-1414: crash reports -----------------------------------------------------------------------------------------
const CRASH_MODE = crashMode({ build: BUILD, env: process.env, argv: process.argv, isPackaged: app.isPackaged, smoke: SMOKE });
const CRASH_URL = crashDestination(CRASH_MODE, process.env);
const CRASH_POST_TIMEOUT_MS = 10_000;
// How often the page's switch is read again while nothing navigates (the Settings panel is also a modal in a mission).
const CRASH_SWITCH_POLL_MS = 15_000;
// A random id for THIS launch, in memory only: it groups one launch's reports and names nothing.
const LAUNCH_ID = randomUUID();
const LAUNCHED_AT = Date.now();
const crashBudget = launchBudget();
const crashRecorded = [];
let crashGpu = 'Unknown';
let crashOptedOut = false;
let crashPageUrl = '';
let crashBox = null;
let crashSending = null;
let expectRendererGone = false;

/** The outbox (send mode only), made on first use so `userData` is final. Its remembered switch is read at once. */
function crashOutbox() {
  if (CRASH_MODE !== 'send') return null;
  if (crashBox === null) {
    const file = path.join(app.getPath('userData'), 'crash-outbox.json');
    crashBox = outbox({
      read: () => (existsSync(file) ? readFileSync(file, 'utf8') : null),
      write: (text) => {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text);
      },
    });
    crashOptedOut = crashBox.optedOut();
  }
  return crashBox;
}

const crashContext = () => ({
  build: BUILD,
  versions: process.versions,
  platform: process.platform,
  arch: process.arch,
  gpu: crashGpu,
  launch: LAUNCH_ID,
  now: Date.now(),
  uptimeMs: Date.now() - LAUNCHED_AT,
  url: crashPageUrl,
  appOrigin: ORIGIN,
});

/** POST one report with Electron's network stack (the system proxy applies; no cookie, no redirect). Resolves to the
 *  HTTP status, 0 for a network failure or a timeout. */
function crashPost(url, body) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (status) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(status);
    };
    let req;
    try {
      req = net.request({ method: 'POST', url, origin: ORIGIN, credentials: 'omit', useSessionCookies: false, redirect: 'error' });
    } catch {
      done(0);
      return;
    }
    timer = setTimeout(() => {
      req.abort();
      done(0);
    }, CRASH_POST_TIMEOUT_MS);
    req.setHeader('content-type', 'application/json');
    req.setHeader('user-agent', CRASH_USER_AGENT);
    req.on('response', (res) => {
      done(res.statusCode);
      res.on('data', () => {});
      res.on('error', () => {});
    });
    req.on('error', () => done(0));
    req.on('abort', () => done(0));
    req.end(body);
  });
}

/** Send what the outbox holds; one drain at a time. */
function sendCrashes() {
  const box = crashOutbox();
  if (box === null || CRASH_URL === null || !app.isReady()) return Promise.resolve();
  crashSending ??= drain({ box, post: crashPost, url: CRASH_URL, now: Date.now(), optedOut: () => crashOptedOut })
    .catch(() => [])
    .finally(() => {
      crashSending = null;
    });
  return crashSending;
}

/** One report: dropped when reporting is off, the player opted out, or the launch's budget is spent. */
function reportCrash(rec) {
  try {
    if (CRASH_MODE === 'off' || rec === null || crashOptedOut || !crashBudget.take(rec)) return;
    const body = fitRecord(rec);
    if (body === null) return;
    if (CRASH_MODE === 'record') {
      crashRecorded.push(JSON.parse(body));
      if (CRASH_URL !== null && app.isReady()) void crashPost(CRASH_URL, body);
      return;
    }
    if (crashOutbox()?.add(body, Date.now())) void sendCrashes();
  } catch {
    // A report never makes a failure worse.
  }
}

if (CRASH_MODE !== 'off') {
  // `uncaughtExceptionMonitor` observes and changes nothing: Electron's own handling of a main-process error is as before.
  // It also sees unhandled rejections (`origin` says which). The outbox write is synchronous, so a report made as the
  // process dies goes at the next launch.
  process.on('uncaughtExceptionMonitor', (err, origin) => reportCrash(mainErrorRecord(err, origin, crashContext())));
  app.on('render-process-gone', (_event, _contents, details) => reportCrash(goneRecord('renderer_gone', details, crashContext())));
  app.on('child-process-gone', (_event, details) => reportCrash(goneRecord('child_gone', details, crashContext())));
}

/** The page side, for the window's contents: the player's switch, the screen, and the page's uncaught errors. */
function watchForCrashes(contents) {
  const readSwitch = () => {
    if (contents.isDestroyed()) return;
    crashPageUrl = contents.getURL();
    contents
      .executeJavaScript(OPTOUT_PROBE)
      .then((v) => {
        crashOptedOut = optedOutValue(v);
        crashOutbox()?.setOptedOut(crashOptedOut);
      })
      .catch(() => {});
  };
  contents.on('did-finish-load', readSwitch);
  contents.once('did-finish-load', () => {
    contents
      .executeJavaScript(GPU_PROBE)
      .then((raw) => {
        if (typeof raw === 'string') crashGpu = gpuFamily(raw);
      })
      .catch(() => {});
  });
  contents.on('did-navigate-in-page', readSwitch);
  const poll = setInterval(readSwitch, CRASH_SWITCH_POLL_MS);
  poll.unref?.();
  contents.once('destroyed', () => clearInterval(poll));
  // The page's uncaught exceptions and unhandled rejections, with their stacks, through the DevTools protocol: no
  // preload, no IPC and nothing added to the page. A debugger already attached (a developer's DevTools) means no page
  // reports this launch.
  try {
    contents.debugger.attach('1.3');
    contents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') reportCrash(pageErrorRecord(params?.exceptionDetails, crashContext()));
    });
    contents.debugger.sendCommand('Runtime.enable').catch(() => {});
  } catch {
    // Not attached: process and main reports still go.
  }
}
// ---------------------------------------------------------------------------------------------------------------------

function smokeExit(result) {
  process.stdout.write(`RL_SMOKE ${JSON.stringify(result)}\n`);
  app.exit(result.pass ? 0 : 1);
}

/** Refuse to start: an error box for a player, an RL_SMOKE failure for the smoke run. */
function refuse(message) {
  if (SMOKE) smokeExit({ pass: false, reason: message });
  else {
    dialog.showErrorBox('Roaring Lions', message);
    app.exit(1);
  }
}

// The headers Cloudflare applies to every static file (`assets/_headers`, copied into the build), read from the bundled
// copy so the page runs under the deployed Content-Security-Policy. Fail closed: no CSP, no page.
let STATIC_HEADERS = {};
let refused = false;
try {
  const file = path.join(WEB_ROOT, '_headers');
  STATIC_HEADERS = parseStaticHeaders(existsSync(file) ? readFileSync(file, 'utf8') : '');
  requireCsp(STATIC_HEADERS);
} catch (err) {
  refused = true;
  refuse(String(err?.message ?? err));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

// Must run before `ready`. `standard` gives the scheme real URL parsing and an origin; `secure` makes it a secure
// context (WebGPU, crypto.subtle); `supportFetchAPI` lets `fetch()` reach it; `stream` lets <audio> play from it.
// Service workers are NOT allowed on the scheme: every file is already on disk, and the deployed worker would copy
// the whole build into the profile's cache. `registerServiceWorker` warns once and the game runs without it.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
// Every renderer sandboxed, whatever a window asks for. Not when the launch has already turned Chromium's sandbox off
// with `--no-sandbox` (a root container run; possibly the Steam Linux Runtime, spec section 5 question 6): there the
// sandbox is off whatever this says, and enableSandbox only crash-loops the network service (measured: "Running as root
// without --no-sandbox is not supported", 3,000 times in 90 s, and no page).
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

function notFound() {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** ENOENT and ENOTDIR (`/index.html/x`) both mean "no such file", never a thrown handler. */
function isRegularFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

async function serve(request) {
  const resolved = resolveRequest(request.url, { host: HOST, webRoot: WEB_ROOT, isFile: isRegularFile });
  if (resolved.status !== 200) return notFound();
  const target = resolved.file;
  const res = await net.fetch(pathToFileURL(target).toString());
  const headers = new Headers(STATIC_HEADERS);
  headers.set('content-type', MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream');
  const len = res.headers.get('content-length');
  if (len !== null) headers.set('content-length', len);
  return new Response(res.body, { status: res.status, headers });
}

if (SMOKE) {
  // A headless box has no GPU: let WebGL fall back to SwiftShader (Chromium no longer does that on its own). Smoke
  // bundles only: a shipped bundle never sets this, so a player's machine never silently draws on the CPU.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  // Its own profile, set before `ready`: a smoke run never writes into the player's `~/.config/Roaring Lions`.
  const profile = SMOKE_OUT !== '' ? path.join(SMOKE_OUT, 'profile') : mkdtempSync(path.join(os.tmpdir(), 'rl-desktop-smoke-'));
  app.setPath('userData', profile);
}

/** Applied to EVERY web contents the app creates (windows, and anything a page might try to open). */
function lockDown(contents) {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // The page never navigates away from the bundle. An allow-listed https link opens in the player's browser; anything
  // else a page tries to open is dropped.
  contents.setWindowOpenHandler(({ url }) => {
    if (externalUrlAllowed(url)) {
      if (SMOKE) externalOpened.push(url);
      else void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  const stayInBundle = (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  };
  contents.on('will-navigate', stayInBundle);
  contents.on('will-redirect', stayInBundle);
}
app.on('web-contents-created', (_event, contents) => lockDown(contents));

async function runSmoke(win, consoleErrors) {
  await new Promise((resolve) => setTimeout(resolve, SMOKE_SETTLE_MS));
  const probe = await win.webContents.executeJavaScript(`(async () => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    let renderer = null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
    let webgpu = 'absent';
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        webgpu = adapter ? 'adapter' : 'no-adapter';
      } catch (err) {
        webgpu = 'error: ' + String(err);
      }
    }
    const canvases = [...document.querySelectorAll('canvas')].map((el) => ({ w: el.width, h: el.height }));
    const perm = async (name) => { try { return (await navigator.permissions.query({ name })).state; } catch (e) { return 'error'; } };
    // The policy, seen from inside the page: no Node, permissions refused, only an allow-listed link leaves.
    const node = typeof require !== 'undefined' || typeof process !== 'undefined' || typeof module !== 'undefined';
    window.open('https://github.com/ilan-pinto/roaring-lions');
    window.open('https://example.com/');
    window.open('http://github.com/');
    return {
      href: location.href,
      title: document.title,
      secure: window.isSecureContext,
      webgl2: !!gl,
      renderer,
      webgpu,
      canvases,
      node,
      geolocation: await perm('geolocation'),
      notifications: await perm('notifications'),
      lionsMenu: document.body ? document.body.innerText.slice(0, 200) : '',
    };
  })()`);
  let screenshot = null;
  if (SMOKE_OUT !== '') {
    const image = await win.webContents.capturePage();
    screenshot = path.join(SMOKE_OUT, 'smoke.png');
    writeFileSync(screenshot, image.toPNG());
  }
  // A navigation off the bundle must be refused: the page stays where it was.
  await win.webContents.executeJavaScript(`location.assign('https://example.com/'); 0`).catch(() => 0);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const afterNavigate = win.webContents.getURL();
  const crash = SMOKE_CRASH ? await forceCrashes(win) : null;
  // index.html carries the game's <title>; a 404 body or a blank page has none.
  const loadedIndex = probe.href.startsWith(`${ORIGIN}/`) && probe.title !== '';
  const policy = {
    noNodeInPage: probe.node === false,
    permissionsDenied: probe.geolocation === 'denied' && probe.notifications === 'denied',
    externalOnlyAllowListed: JSON.stringify(externalOpened) === JSON.stringify(['https://github.com/ilan-pinto/roaring-lions']),
    navigationRefused: isAppUrl(afterNavigate),
  };
  smokeExit({
    pass: loadedIndex && probe.webgl2 && Object.values(policy).every(Boolean) && (crash === null || crash.pass),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    build: BUILD,
    policy,
    externalOpened,
    afterNavigate,
    ...probe,
    consoleErrors,
    screenshot,
    crash,
  });
}

/**
 * The smoke run's crash check (RL_DESKTOP_SMOKE_CRASH=1). Throws in the page (an exception whose message holds a home
 * path, an email and a query) and rejects a promise, then crashes the renderer, and reads back what the run recorded:
 * a page exception, a page rejection and a renderer crash, none holding any of the personal strings.
 */
async function forceCrashes(win) {
  await win.webContents
    .executeJavaScript(
      `setTimeout(() => { throw new TypeError('smoke crash /home/dana/.config/x.json dana@example.com ?tester=dana'); }, 0);
       setTimeout(() => { Promise.reject(new Error('smoke rejection C:\\\\Users\\\\Dana\\\\x')); }, 10); 0`,
    )
    .catch(() => 0);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expectRendererGone = true;
  win.webContents.forcefullyCrashRenderer();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const kinds = crashRecorded.map((r) => r.kind);
  const text = JSON.stringify(crashRecorded);
  const leaked = ['dana', 'Dana', 'example.com', 'tester', '/home', 'Users'].filter((s) => text.includes(s));
  return {
    pass: ['page_exception', 'page_rejection', 'renderer_gone'].every((k) => kinds.includes(k)) && leaked.length === 0,
    kinds,
    leaked,
    gpu: crashGpu,
    recorded: crashRecorded,
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: !SMOKE,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: WEB_PREFERENCES,
  });
  if (CRASH_MODE !== 'off') watchForCrashes(win.webContents);
  win.webContents.once('did-finish-load', () => {
    const ready = { href: win.webContents.getURL(), smoke: SMOKE, version: BUILD?.version ?? null, commit: BUILD?.commit ?? null };
    process.stdout.write(`RL_DESKTOP_READY ${JSON.stringify(ready)}\n`);
  });

  if (SMOKE) {
    const consoleErrors = [];
    // Electron >= 35 passes one event object; older versions passed (event, level, message). Read both.
    win.webContents.on('console-message', (event, level, message) => {
      const lvl = typeof event.level === 'string' ? event.level : level;
      const msg = typeof event.message === 'string' ? event.message : message;
      if (lvl === 'error' || lvl === 3) consoleErrors.push(String(msg).slice(0, 400));
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // A refused navigation aborts a load; only a failure of the bundle's own page fails the run.
      if (isMainFrame && isAppUrl(url)) smokeExit({ pass: false, reason: `did-fail-load ${code} ${desc} ${url}` });
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      if (!expectRendererGone) smokeExit({ pass: false, reason: `render-process-gone ${details.reason}` });
    });
    win.webContents.once('did-finish-load', () => {
      runSmoke(win, consoleErrors).catch((err) => smokeExit({ pass: false, reason: String(err) }));
    });
    setTimeout(() => smokeExit({ pass: false, reason: `timeout after ${SMOKE_TIMEOUT_MS} ms` }), SMOKE_TIMEOUT_MS).unref();
  }
  // `/` is the menu route; the scheme answers it with `index.html`, as it does every screen path.
  void win.loadURL(`${ORIGIN}${SMOKE_PATH.startsWith('/') ? SMOKE_PATH : `/${SMOKE_PATH}`}`);
}

app.whenReady().then(() => {
  if (refused) return;
  // No application menu: no reload, no developer tools, no zoom accelerators in front of a player.
  Menu.setApplicationMenu(null);
  // Every permission prompt is answered here, and only the two the game uses are granted (policy.mjs).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permissionAllowed(permission, details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permissionAllowed(permission, requestingOrigin));
  session.defaultSession.setDevicePermissionHandler(() => false);
  protocol.handle(SCHEME, serve);
  if (CRASH_MODE !== 'off') {
    // The graphics card's family until the page has said (GPU_PROBE): the PCI vendor, when Electron knows it. Then what
    // an earlier launch left in the outbox.
    app
      .getGPUInfo('basic')
      .then((info) => {
        if (crashGpu === 'Unknown') crashGpu = gpuFamilyFromInfo(info);
      })
      .catch(() => {});
    crashOutbox();
    setTimeout(() => void sendCrashes(), 3000).unref?.();
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
