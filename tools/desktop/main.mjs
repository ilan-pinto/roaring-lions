// GH-1418 desktop spike: the Electron main process for an UNSIGNED local bundle of the web build.
//
// `tools/desktop/build-local.mjs` copies this file, unchanged, into the staging app as its `main`, next to a `web/`
// directory holding `packages/app/dist`. It is not imported by anything in `packages/`, and it changes no app code.
//
// Why a custom scheme and not `file://`: the Vite build uses `base: '/'`, so every chunk, GLB, texture, audio file and
// the Draco decoder is fetched by an ABSOLUTE path (`/assets/...`, `/draco/...`, `/meshes/...`). Under `file://` those
// resolve against the filesystem root and the game boots into 404s. A privileged standard scheme gives the page a real
// origin (`app://roaring-lions.local`) whose `/` is the bundled `web/` directory, so the build ships byte-for-byte as
// it deploys, with no second `VITE_BASE` build and no edit to the entry chunk.
//
// Why the host ends in `.local`: the app's own host gate (`packages/app/src/telemetry/enabled.ts`'s `LOCAL`, which
// `account/enabled.ts`, `feedback/gate.ts` and `ui/no-gpu.ts` share or mirror) treats `*.local` as this machine, so
// the packaged build sends no telemetry, never reaches `/api/account/*` and never posts feedback. A relative `/api/...`
// would otherwise land on this scheme and fail. Whether a Steam demo should talk to the Worker is an open question in
// the spike doc, not a decision this file makes.
//
// `RL_DESKTOP_SMOKE=1` turns the run into the headless launch check: load `index.html`, probe WebGL2 (and report
// WebGPU), write a screenshot and one `RL_SMOKE {json}` line to stdout, then exit 0 on a pass and 1 on a failure.
// Spec: docs/superpowers/specs/2026-11-17-desktop-wrapper-spike.md.

import { app, BrowserWindow, protocol, net, shell } from 'electron';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEME = 'app';
const HOST = 'roaring-lions.local';
const ORIGIN = `${SCHEME}://${HOST}`;
const WEB_ROOT = path.join(import.meta.dirname, 'web');
const SMOKE = process.env.RL_DESKTOP_SMOKE === '1';
const SMOKE_OUT = process.env.RL_DESKTOP_SMOKE_OUT ?? '';
// How long the smoke run lets the menu boot (dynamic imports, the menu diorama's GLBs) before it reads the page.
const SMOKE_SETTLE_MS = Number(process.env.RL_DESKTOP_SMOKE_SETTLE_MS ?? 8000);
const SMOKE_TIMEOUT_MS = 120_000;
// The screen path the smoke run opens (default the menu). A deep path (`/free-play`) exercises the SPA fallback.
const SMOKE_PATH = SMOKE ? (process.env.RL_DESKTOP_SMOKE_PATH ?? '/') : '/';

// The headers Cloudflare applies to every static file (`assets/_headers`, copied into the build). Read from the
// bundled copy so the desktop page runs under the same Content-Security-Policy as the deployed one: one source.
function staticHeaders() {
  const file = path.join(WEB_ROOT, '_headers');
  const headers = {};
  if (!existsSync(file)) return headers;
  let inAll = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!line.startsWith(' ')) {
      inAll = line.trim() === '/*';
      continue;
    }
    if (!inAll) continue;
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  // DENY / frame-ancestors are about framing by another site; harmless here, kept for parity.
  return headers;
}
const STATIC_HEADERS = staticHeaders();

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
  const url = new URL(request.url);
  if (url.host !== HOST) return notFound();
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return notFound();
  }
  const file = path.normalize(path.join(WEB_ROOT, rel));
  // Never serve outside the bundled build.
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) return notFound();
  let target = file;
  const isFile = isRegularFile(file);
  if (!isFile) {
    // The router's screens are PATHS (`/campaign`, `/mission/<id>`): a path with no extension is a screen, and gets
    // the SPA shell, as the Worker's asset fallback does. A missing file with an extension is a real 404.
    if (path.extname(rel) !== '') return notFound();
    target = path.join(WEB_ROOT, 'index.html');
  }
  const res = await net.fetch(pathToFileURL(target).toString());
  const headers = new Headers(STATIC_HEADERS);
  headers.set('content-type', MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream');
  const len = res.headers.get('content-length');
  if (len !== null) headers.set('content-length', len);
  return new Response(res.body, { status: res.status, headers });
}

if (SMOKE) {
  // A headless box has no GPU: let WebGL fall back to SwiftShader (Chromium no longer does that on its own). Smoke
  // runs only. A shipping build must not set this, so a player's machine never silently draws on the CPU.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
}

function smokeExit(result) {
  process.stdout.write(`RL_SMOKE ${JSON.stringify(result)}\n`);
  app.exit(result.pass ? 0 : 1);
}

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
    const canvases = [...document.querySelectorAll('canvas')].map((el) => ({
      w: el.width, h: el.height,
      webgl2: !!(el.getContext && (() => { try { return el.getContext('webgl2'); } catch { return null; } })()),
    }));
    return {
      href: location.href,
      title: document.title,
      secure: window.isSecureContext,
      webgl2: !!gl,
      renderer,
      webgpu,
      canvases,
      lionsMenu: document.body ? document.body.innerText.slice(0, 200) : '',
    };
  })()`);
  let screenshot = null;
  if (SMOKE_OUT !== '') {
    const image = await win.webContents.capturePage();
    screenshot = path.join(SMOKE_OUT, 'smoke.png');
    writeFileSync(screenshot, image.toPNG());
  }
  // index.html carries the game's <title>; a 404 body or a blank page has none.
  const loadedIndex = probe.href.startsWith(`${ORIGIN}/`) && probe.title !== '';
  smokeExit({
    pass: loadedIndex && probe.webgl2,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    ...probe,
    consoleErrors,
    screenshot,
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    show: !SMOKE,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The page never navigates away from the bundle; an outside https link (the feedback issue URL) opens in the
  // player's browser, and anything else is refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });

  if (SMOKE) {
    const consoleErrors = [];
    // Electron >= 35 passes one event object; older versions passed (event, level, message). Read both.
    win.webContents.on('console-message', (event, level, message) => {
      const lvl = typeof event.level === 'string' ? event.level : level;
      const msg = typeof event.message === 'string' ? event.message : message;
      if (lvl === 'error' || lvl === 3) consoleErrors.push(String(msg).slice(0, 400));
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      smokeExit({ pass: false, reason: `did-fail-load ${code} ${desc} ${url}` });
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      smokeExit({ pass: false, reason: `render-process-gone ${details.reason}` });
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
  protocol.handle(SCHEME, serve);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
