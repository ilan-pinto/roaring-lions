// GH-1414: crash reporting for the packaged desktop build, as plain data and pure functions.
//
// What a report is, what it may say, when one may be made and where it may go are all decided here, so
// `tools/src/desktop_crash.test.ts` can pin each rule with literal inputs and without Electron. `main.mjs` only wires the
// events in, and `build-local.mjs` copies this file into the bundle beside `policy.mjs`. No Electron import; the only I/O
// is what a caller injects (the outbox's `read`/`write`, the sender's `post`).
//
// The rulings it implements (GH-1414): no third-party service, so a report goes to OUR Worker (`POST /api/crash`, the
// same pattern as `/api/feedback`) and nowhere else; no personal data, so no minidump is ever written or uploaded
// (Electron's `crashReporter` is never started: a minidump is a copy of process memory, and process memory holds save
// data, typed text and paths); the player's "Anonymous usage and crash reports" switch (Settings, Privacy, GH-1410) turns
// it off. What IS sent is a small whitelisted record (`data/schemas/crash_report.schema.json`, whose Worker twin
// `packages/worker/src/crash-meta.ts` checks it again): the kind of failure and its reason or exit code, the game version
// and commit, the Electron and Chromium versions, the OS family and CPU architecture, the graphics card's FAMILY (never
// its raw string), the screen, the seconds since launch, a random id that lives for one launch, and for a JavaScript
// error its class name, a scrubbed one-line message and a stack whose locations are reduced to bundle-relative paths.
// Spec: docs/superpowers/specs/2026-11-17-desktop-wrapper-spike.md, section 9.6.

/** The ONE place a report may go: the deployed Worker. A constant of the bundle, never read from the page, the
 *  environment or a file (a smoke bundle's loopback sink, below, is the only other destination, and only there). */
export const CRASH_ORIGIN = 'https://roaring-lions.pint12.workers.dev';
export const CRASH_ENDPOINT = `${CRASH_ORIGIN}/api/crash`;
export const CRASH_VERSION = 1;

/** The page's opt-out key (`packages/app/src/telemetry/identity.ts`'s OPTOUT_KEY; `desktop_crash.test.ts` pins the two). */
export const OPTOUT_KEY = 'lions.telemetry.optout';
/** What `main.mjs` runs in the page to read the switch. Reads one key and nothing else; a blocked storage reads as null. */
export const OPTOUT_PROBE = `(() => { try { return window.localStorage.getItem(${JSON.stringify(OPTOUT_KEY)}); } catch { return null; } })()`;

/**
 * What `main.mjs` runs in the page ONCE, after the first load, to learn the graphics card: the unmasked WebGL renderer
 * string, read from a throwaway 1x1 context that is released at once (the same string the web build's telemetry reduces,
 * GH-1410). Electron's own `app.getGPUInfo` carries no renderer string (measured on 45.2.1: no `glRenderer`). The raw
 * string goes no further than `gpuFamily`, in the main process.
 */
export const GPU_PROBE = `(() => { try { const c = document.createElement('canvas'); c.width = 1; c.height = 1; const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return null; const ext = gl.getExtension('WEBGL_debug_renderer_info'); const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); gl.getExtension('WEBGL_lose_context')?.loseContext(); return typeof r === 'string' ? r : null; } catch { return null; } })()`;

/** The User-Agent a report is sent with: the product and nothing about the machine (the Worker stores no header). */
export const CRASH_USER_AGENT = 'roaring-lions-desktop';

export const CRASH_KINDS = Object.freeze(['renderer_gone', 'child_gone', 'main_exception', 'main_rejection', 'page_exception', 'page_rejection']);
export const GONE_KINDS = Object.freeze(['renderer_gone', 'child_gone']);
export const SCREENS = Object.freeze(['menu', 'campaign', 'brigade', 'mission', 'tutorial', 'sandbox', 'other']);

/** Wire caps. The Worker refuses a body over BODY_MAX_BYTES; `fitRecord` trims the stack until it fits. */
export const BODY_MAX_BYTES = 6144;
export const FRAMES_MAX = 16;
export const FRAME_MAX = 200;
export const MESSAGE_MAX = 120;

// ---------------------------------------------------------------------------------------------------------------------
// When a report may be made

/** The switches that turn reporting off whatever the manifest says. A player can pass `--no-crash-reports` as a Steam
 *  launch option; CI and the packager's own launch check set the variables. */
export const OFF_SWITCH = '--no-crash-reports';
export const OFF_ENV = 'RL_DESKTOP_NO_CRASH_REPORTS';
const set = (v) => typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

/**
 * How this run reports: `'send'` (to CRASH_ENDPOINT), `'record'` (a smoke bundle: kept in memory for the RL_SMOKE line,
 * never sent) or `'off'`. `'send'` needs EVERY one of: a packaged app, a manifest packaged `crashReports: true`
 * (`build-local.mjs --crash-reports`; a local `pnpm desktop:package` without the flag sends nothing), not a smoke bundle,
 * no `CI`, no `RL_DESKTOP_NO_CRASH_REPORTS`, no `--no-crash-reports`. The page's own switch is read on top of this, at
 * every report and every send.
 */
export function crashMode({ build, env, argv, isPackaged, smoke }) {
  if (build === null || typeof build !== 'object') return 'off';
  if (smoke === true && build.smoke === true) return 'record';
  if (build.smoke !== false || build.crashReports !== true || isPackaged !== true) return 'off';
  if (set(env.CI) || set(env[OFF_ENV])) return 'off';
  if (Array.isArray(argv) && argv.includes(OFF_SWITCH)) return 'off';
  return 'send';
}

/**
 * Where this run's reports go. `'send'`: CRASH_ENDPOINT, always. `'record'`: only a loopback `http://127.0.0.1:<port>/`
 * sink named by RL_DESKTOP_SMOKE_CRASH_SINK (the smoke check's local stand-in for the Worker), else nowhere. `'off'`:
 * nowhere.
 */
export function crashDestination(mode, env) {
  if (mode === 'send') return CRASH_ENDPOINT;
  if (mode !== 'record') return null;
  const sink = env.RL_DESKTOP_SMOKE_CRASH_SINK;
  if (typeof sink !== 'string') return null;
  let u;
  try {
    u = new URL(sink);
  } catch {
    return null;
  }
  return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port !== '' && u.username === '' && u.password === '' ? u.toString() : null;
}

/** The page's switch, as `OPTOUT_PROBE` read it: only the exact stored `'1'` opts out (the page's own rule). */
export const optedOutValue = (v) => v === '1';

// ---------------------------------------------------------------------------------------------------------------------
// Scrubbing. A twin of `packages/app/src/telemetry/errors.ts`'s `scrubMessage` (GH-1410), pinned to it on a corpus by
// `desktop_crash.test.ts`: this file is plain JavaScript inside the asar and cannot import the app's TypeScript.

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const DOUBLE_QUOTED_RE = /"[^"]{2,}"/g;
const SINGLE_QUOTED_RE = /'[^']{3,}'/g;
const BACKTICKED_RE = /`[^`]{2,}`/g;
const QUERY_RE = /[?&][^\s]+/g;
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6_RE = /(?<![\w:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi;
const PATH_RE = /(?:[A-Za-z]:\\[^\s]*|\\\\[^\s]+|(?:\/[^\s/]+){2,})/g;
const BACKSLASH_PATH_RE = /[\w.-]+(?:\\[\w.-]+)+/g;
const DOTTED_TOKEN_RE = /[\w-]{8,}(?:\.[\w-]{8,})+/g;
const GROUPED_NUMBER_RE = /\+?\d{1,4}(?:[-\s.]\d{2,4}){2,}\b/g;
const LONG_NUMBER_RE = /\d{5,}/g;
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{24,}/g;

/** One line of an error message with every URL, email, quoted literal, query, address, path, token and long number
 *  replaced, non-printable-ASCII dropped, at most 120 characters. */
export function scrubMessage(raw) {
  const firstLine = String(raw).split(/\r?\n/, 1)[0] ?? '';
  const scrubbed = firstLine
    .replace(URL_RE, '<url>')
    .replace(EMAIL_RE, '<email>')
    .replace(DOUBLE_QUOTED_RE, '<str>')
    .replace(SINGLE_QUOTED_RE, '<str>')
    .replace(BACKTICKED_RE, '<str>')
    .replace(QUERY_RE, '<q>')
    .replace(IPV4_RE, '<ip>')
    .replace(IPV6_RE, '<ip>')
    .replace(PATH_RE, '<path>')
    .replace(BACKSLASH_PATH_RE, '<path>')
    .replace(DOTTED_TOKEN_RE, '<id>')
    .replace(LONG_TOKEN_RE, '<id>')
    .replace(GROUPED_NUMBER_RE, '<n>')
    .replace(LONG_NUMBER_RE, '<n>')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > MESSAGE_MAX ? scrubbed.slice(0, MESSAGE_MAX) : scrubbed;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const FN_RE = /^[A-Za-z0-9_$.<>]{1,64}$/;
const REL_RE = /^[A-Za-z0-9_./-]{1,160}$/;
const NODE_RE = /^node:[A-Za-z0-9_/.-]{1,80}$/;

/** A function name as code wrote it, or `<anon>`: `async ` and `new ` are dropped, anything that is not plain identifier
 *  characters (a computed key could hold any text) is replaced whole. */
export function scrubFunctionName(raw) {
  const s = String(raw ?? '').replace(/^(?:async|new)\s+/, '').trim();
  return FN_RE.test(s) ? s : '<anon>';
}

/**
 * A stack location reduced to where it is INSIDE the game, or a placeholder. The only locations kept:
 *  - the page's own files, `app://roaring-lions.local/<path>` -> `web/<path>` (query and fragment dropped);
 *  - the main process's own files, anything up to and including `app.asar/` dropped -> `asar/<path>` (so the install
 *    directory, and the user name in it, never leaves);
 *  - Node and Electron internals, `node:<module>`.
 * Everything else (an absolute path, another origin, a `file://` URL outside the asar, `native`, an eval) becomes
 * `<other>` or `<native>`. A kept path must be plain path characters, or it is `<other>` too.
 */
export function scrubLocation(raw, appOrigin) {
  const s = String(raw ?? '').trim();
  if (s === 'native') return '<native>';
  if (s.startsWith(`${appOrigin}/`)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      return '<other>';
    }
    const rel = u.pathname.replace(/^\/+/, '');
    return rel !== '' && REL_RE.test(rel) ? `web/${rel}` : '<other>';
  }
  if (s.startsWith('node:')) return NODE_RE.test(s) ? s : '<other>';
  let p = s;
  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      return '<other>';
    }
  }
  p = p.replace(/\\/g, '/');
  const at = p.lastIndexOf('app.asar/');
  if (at >= 0) {
    const rel = p.slice(at + 'app.asar/'.length);
    return REL_RE.test(rel) && !rel.split('/').includes('..') ? `asar/${rel}` : '<other>';
  }
  return '<other>';
}

const frame = (fn, where, line, col) => {
  const l = Number.isInteger(line) && line >= 0 && line < 1e7 ? line : 0;
  const c = Number.isInteger(col) && col >= 0 && col < 1e7 ? col : 0;
  const keepPos = where !== '<other>' && where !== '<native>';
  return `${scrubFunctionName(fn)} (${where}:${keepPos ? l : 0}:${keepPos ? c : 0})`.slice(0, FRAME_MAX);
};

const V8_AT = /^\s*at\s+(.*)$/;
const LOC_RE = /^(.*):(\d+):(\d+)$/;

/** A V8 `err.stack` (the main process's) as at most 16 scrubbed frames: `fn (where:line:col)`. The first line (the
 *  message) is never read here; `scrubMessage` takes it separately. */
export function framesFromV8Stack(stack, appOrigin) {
  if (typeof stack !== 'string') return [];
  const out = [];
  for (const line of stack.split('\n')) {
    const m = V8_AT.exec(line);
    if (!m) continue;
    const body = m[1].trim();
    let fn = '<anon>';
    let loc = body;
    const paren = /^(.*?)\s+\((.*)\)$/.exec(body);
    if (paren) {
      fn = paren[1];
      loc = paren[2];
    }
    const pos = LOC_RE.exec(loc);
    out.push(pos ? frame(fn, scrubLocation(pos[1], appOrigin), Number(pos[2]), Number(pos[3])) : frame(fn, scrubLocation(loc, appOrigin), 0, 0));
    if (out.length === FRAMES_MAX) break;
  }
  return out;
}

/** CDP `Runtime.StackTrace.callFrames` (the page's) as at most 16 scrubbed frames. CDP lines and columns are 0-based;
 *  the wire's are 1-based, as a V8 stack prints them. */
export function framesFromCdp(callFrames, appOrigin) {
  if (!Array.isArray(callFrames)) return [];
  return callFrames
    .slice(0, FRAMES_MAX)
    .map((f) => frame(f?.functionName === '' ? '<anon>' : f?.functionName, scrubLocation(f?.url, appOrigin), Number(f?.lineNumber) + 1, Number(f?.columnNumber) + 1));
}

/** An error's class name if it is a plain identifier, else `Error` (or `NonError` for a thrown non-object). */
export function errorName(value) {
  const isErr = typeof value === 'object' && value !== null;
  const n = isErr ? value.name : undefined;
  return typeof n === 'string' && NAME_RE.test(n) ? n : isErr ? 'Error' : 'NonError';
}

// ---------------------------------------------------------------------------------------------------------------------
// The graphics card's family. A twin of `@lions/data/telemetry`'s `gpuFamily` (GH-1410), pinned on a corpus by
// `desktop_crash.test.ts`. Never the raw string, which on Windows and Linux carries PCI ids and driver versions.

export function gpuFamily(gpu) {
  if (gpu === null || gpu === undefined || String(gpu).trim() === '') return 'Unknown';
  const g = String(gpu);
  if (/swiftshader|llvmpipe|software|softpipe|microsoft basic render/i.test(g)) return 'Software (no GPU)';
  const apple = /Apple (M\d+|A\d+)/i.exec(g);
  if (apple?.[1]) return `Apple ${apple[1].toUpperCase()}`;
  if (/Apple/i.test(g)) return 'Apple (other)';
  const nv = /(RTX|GTX)\s*(\d{2})\d{2}/i.exec(g);
  if (nv?.[1] && nv[2]) return `NVIDIA ${nv[1].toUpperCase()} ${nv[2]}-series`;
  if (/NVIDIA|GeForce|Quadro/i.test(g)) return 'NVIDIA (other)';
  const amd = /Radeon\s*(RX|Pro|Vega|HD)?\s*(\d)?/i.exec(g);
  if (/AMD|Radeon/i.test(g)) {
    if (amd?.[1]?.toUpperCase() === 'RX' && amd[2]) return `AMD Radeon RX ${amd[2]}000-series`;
    return 'AMD (other)';
  }
  if (/Intel/i.test(g)) {
    if (/Arc/i.test(g)) return 'Intel Arc';
    if (/Iris(?:\(R\))?\s*Xe/i.test(g)) return 'Intel Iris Xe';
    if (/Iris/i.test(g)) return 'Intel Iris';
    if (/UHD/i.test(g)) return 'Intel UHD';
    if (/HD Graphics/i.test(g)) return 'Intel HD';
    return 'Intel (other)';
  }
  const adreno = /Adreno.*?(\d)\d{2}/i.exec(g);
  if (adreno?.[1]) return `Qualcomm Adreno ${adreno[1]}xx`;
  if (/Adreno/i.test(g)) return 'Qualcomm Adreno (other)';
  if (/Mali/i.test(g)) return 'ARM Mali';
  return 'Other';
}

/** Electron's `app.getGPUInfo('complete')` reduced to a family: its GL renderer string when it gave one, else the
 *  active device's PCI vendor id (NVIDIA, AMD, Intel), else `Unknown`. */
export function gpuFamilyFromInfo(info) {
  const renderer = info?.auxAttributes?.glRenderer;
  if (typeof renderer === 'string' && renderer.trim() !== '') return gpuFamily(renderer);
  const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
  const dev = devices.find((d) => d?.active) ?? devices[0];
  const vendor = { 0x10de: 'NVIDIA (other)', 0x1002: 'AMD (other)', 0x8086: 'Intel (other)', 0x106b: 'Apple (other)' }[dev?.vendorId];
  return vendor ?? 'Unknown';
}

// ---------------------------------------------------------------------------------------------------------------------
// The record

/** The screen a page URL is on, by its first path segment, and the mission id on `/mission/<id>`. Nothing else of the
 *  URL is read (no query, no fragment). */
export function screenOf(url, appOrigin) {
  if (typeof url !== 'string' || !url.startsWith(`${appOrigin}/`) && url !== appOrigin) return {};
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return {};
  }
  const [first = '', second] = path.split('/').filter(Boolean);
  if (first === '') return { screen: 'menu' };
  if (first === 'campaign') return { screen: 'campaign' };
  if (first === 'brigade') return { screen: 'brigade' };
  if (first === 'free-play') return { screen: 'sandbox' };
  if (first === 'mission' || first === 'briefing') {
    const mission = typeof second === 'string' && /^[a-z0-9_]{1,64}$/.test(second) ? second : undefined;
    const screen = mission?.endsWith('_tutorial') ? 'tutorial' : 'mission';
    return mission === undefined ? { screen } : { screen, mission };
  }
  return { screen: 'other' };
}

const VERSION_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const SEMVER_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
const CHROME_RE = /^[0-9]{1,4}(?:\.[0-9]{1,6}){3}$/;
const LABEL_RE = /^[A-Za-z][A-Za-z0-9 ._-]{0,47}$/;
const REASON_RE = /^[a-z][a-z-]{0,23}$/;
const PLATFORMS = ['linux', 'win32', 'darwin'];
const ARCHES = ['x64', 'arm64', 'ia32'];

/**
 * What every record carries. `ctx`: `{ build, versions, platform, arch, gpu, launch, now, uptimeMs, url, appOrigin }`.
 * Null when the bundle cannot say what it is (no manifest version), so nothing unattributable is ever sent.
 */
export function envelope(kind, ctx) {
  if (!CRASH_KINDS.includes(kind)) return null;
  const version = ctx?.build?.version;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return null;
  const electron = ctx.versions?.electron;
  const chrome = ctx.versions?.chrome;
  if (typeof electron !== 'string' || !SEMVER_RE.test(electron)) return null;
  const rec = {
    v: CRASH_VERSION,
    t: Math.max(0, Math.floor(Number(ctx.now) || 0)),
    kind,
    launch: ctx.launch,
    uptimeS: Math.min(10_000_000, Math.max(0, Math.floor((Number(ctx.uptimeMs) || 0) / 1000))),
    version,
    electron,
    platform: PLATFORMS.includes(ctx.platform) ? ctx.platform : 'linux',
    arch: ARCHES.includes(ctx.arch) ? ctx.arch : 'x64',
    gpu: typeof ctx.gpu === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ().+-]{0,39}$/.test(ctx.gpu) ? ctx.gpu : 'Unknown',
  };
  if (typeof chrome === 'string' && CHROME_RE.test(chrome)) rec.chrome = chrome;
  const commit = ctx.build.commit;
  if (typeof commit === 'string' && COMMIT_RE.test(commit)) rec.commit = commit;
  Object.assign(rec, screenOf(ctx.url, ctx.appOrigin));
  return rec;
}

/** A process that went away. `details` is Electron's `render-process-gone` / `child-process-gone` object. A clean exit
 *  is not a crash: null. */
export function goneRecord(kind, details, ctx) {
  if (!GONE_KINDS.includes(kind)) return null;
  const reason = details?.reason;
  if (typeof reason !== 'string' || !REASON_RE.test(reason) || reason === 'clean-exit') return null;
  const rec = envelope(kind, ctx);
  if (rec === null) return null;
  rec.reason = reason;
  const code = details.exitCode;
  if (Number.isInteger(code) && code >= -2147483648 && code <= 4294967295) rec.exitCode = code;
  if (kind === 'child_gone') {
    rec.process = typeof details.type === 'string' && LABEL_RE.test(details.type) ? details.type : 'Unknown';
    const service = details.name ?? details.serviceName;
    if (typeof service === 'string' && LABEL_RE.test(service)) rec.service = service;
  }
  return rec;
}

/** An uncaught error in the main process (`uncaughtExceptionMonitor`: `origin` is `uncaughtException` or
 *  `unhandledRejection`). */
export function mainErrorRecord(err, origin, ctx) {
  const rec = envelope(origin === 'unhandledRejection' ? 'main_rejection' : 'main_exception', ctx);
  if (rec === null) return null;
  rec.name = errorName(err);
  const raw = typeof err === 'object' && err !== null ? err.message : err;
  rec.message = scrubMessage(typeof raw === 'string' ? raw : '');
  const stack = typeof err === 'object' && err !== null ? framesFromV8Stack(err.stack, ctx.appOrigin) : [];
  if (stack.length > 0) rec.stack = stack;
  return rec;
}

/** An uncaught exception or unhandled rejection in the page, from CDP's `Runtime.exceptionThrown` `exceptionDetails`. */
export function pageErrorRecord(details, ctx) {
  const rejection = /in promise/i.test(String(details?.text ?? ''));
  const rec = envelope(rejection ? 'page_rejection' : 'page_exception', ctx);
  if (rec === null) return null;
  const ex = details?.exception;
  const className = ex?.className;
  rec.name = typeof className === 'string' && NAME_RE.test(className) ? className : ex?.type === 'object' ? 'Error' : 'NonError';
  // `description` is `Name: message\n    at ...` for an Error, the value itself for a primitive: its first line only,
  // with the class name taken off the front, then scrubbed.
  const first = String(ex?.description ?? ex?.value ?? details?.text ?? '').split(/\r?\n/, 1)[0] ?? '';
  rec.message = scrubMessage(first.startsWith(`${rec.name}: `) ? first.slice(rec.name.length + 2) : first.replace(/^Uncaught(?: \(in promise\))?\s*/, ''));
  const stack = framesFromCdp(details?.stackTrace?.callFrames, ctx.appOrigin);
  if (stack.length > 0) rec.stack = stack;
  return rec;
}

const utf8Bytes = (s) => new TextEncoder().encode(s).length;

/** The record's JSON, dropping stack frames from the bottom until it fits BODY_MAX_BYTES. */
export function fitRecord(rec) {
  const r = { ...rec };
  if (Array.isArray(r.stack)) r.stack = [...r.stack];
  let body = JSON.stringify(r);
  while (utf8Bytes(body) > BODY_MAX_BYTES && Array.isArray(r.stack) && r.stack.length > 0) {
    r.stack.pop();
    if (r.stack.length === 0) delete r.stack;
    body = JSON.stringify(r);
  }
  return utf8Bytes(body) <= BODY_MAX_BYTES ? body : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// How many, and the outbox

/** At most `max` reports a launch, at most `page` of them from the page's own errors, and never the same one twice
 *  (kind, name, message and the first frame). */
export function launchBudget({ max = 6, page = 3 } = {}) {
  const seen = new Set();
  let total = 0;
  let pageN = 0;
  return {
    take(rec) {
      const isPage = rec.kind === 'page_exception' || rec.kind === 'page_rejection';
      const key = [rec.kind, rec.reason ?? '', rec.process ?? '', rec.name ?? '', rec.message ?? '', rec.stack?.[0] ?? ''].join('|');
      if (seen.has(key) || total >= max || (isPage && pageN >= page)) return false;
      seen.add(key);
      total++;
      if (isPage) pageN++;
      return true;
    },
  };
}

export const OUTBOX_MAX = 5;
export const OUTBOX_MAX_AGE_MS = 7 * 86_400_000;

/**
 * Reports waiting to go, in one small JSON file in the profile (`crash-outbox.json`), so a report made as the main
 * process dies, or while the machine is offline, goes at the next launch. `read()` returns the file's text or null;
 * `write(text)` replaces it. The file also remembers the page's switch, so a launch that crashes before the page loads
 * still honours an earlier opt-out. Anything unreadable is an empty outbox.
 */
export function outbox({ read, write }) {
  const load = () => {
    let x;
    try {
      x = JSON.parse(read() ?? 'null');
    } catch {
      x = null;
    }
    const records = Array.isArray(x?.records) ? x.records.filter((r) => Number.isFinite(r?.at) && typeof r?.body === 'string') : [];
    return { optedOut: x?.optedOut === true, records };
  };
  const save = (state) => {
    try {
      write(JSON.stringify({ v: 1, optedOut: state.optedOut, records: state.records }));
    } catch {
      // A profile that cannot be written loses the report; it never breaks the game.
    }
  };
  return {
    optedOut: () => load().optedOut,
    /** Remember the page's switch; turning it off empties the outbox at once. */
    setOptedOut(on) {
      const s = load();
      if (s.optedOut === on && (!on || s.records.length === 0)) return;
      save({ optedOut: on, records: on ? [] : s.records });
    },
    add(body, now) {
      const s = load();
      if (s.optedOut) return false;
      s.records.push({ at: now, body });
      save({ optedOut: false, records: s.records.slice(-OUTBOX_MAX) });
      return true;
    },
    /** The records still worth sending, oldest first; expired ones are dropped from the file. */
    pending(now) {
      const s = load();
      if (s.optedOut) return [];
      const live = s.records.filter((r) => now - r.at <= OUTBOX_MAX_AGE_MS && r.at <= now + 60_000);
      if (live.length !== s.records.length) save({ optedOut: false, records: live });
      return live;
    },
    remove(at, body) {
      const s = load();
      save({ optedOut: s.optedOut, records: s.records.filter((r) => !(r.at === at && r.body === body)) });
    },
  };
}

/** What a send's HTTP status means for the record: `sent` (stored), `drop` (it will never be accepted: malformed,
 *  refused, or the endpoint is closed) or `retry` (rate-limited, the server failed, or the network did: status 0). */
export function sendOutcome(status) {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 0 || status === 429 || status >= 500) return 'retry';
  return 'drop';
}

/**
 * Send what the outbox holds, oldest first, one at a time, stopping at the first `retry`. `post(url, body)` resolves to
 * an HTTP status (0 for a network failure). `optedOut()` is asked before EVERY send, so a switch turned off mid-drain
 * stops it.
 */
export async function drain({ box, post, url, now, optedOut }) {
  const sent = [];
  for (const r of box.pending(now)) {
    if (optedOut()) break;
    const outcome = sendOutcome(await post(url, r.body));
    if (outcome === 'retry') break;
    box.remove(r.at, r.body);
    sent.push(outcome);
  }
  return sent;
}
