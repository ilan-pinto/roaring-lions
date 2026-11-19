// GH-1418: the desktop build's security and content policy, as plain data and pure functions.
//
// Everything `main.mjs` decides about what the page may do (its webPreferences, where it may navigate, which links leave
// for the player's browser, which permission prompts it may answer yes to, whether a run may become the smoke check) and
// everything `build-local.mjs` decides about the binary (its Electron fuses, the demo's content cut) is written here, so
// `tools/src/desktop_policy.test.ts` can pin each rule without Electron. Neither file restates a rule: they import it.
// No I/O, no Electron import. Spec: docs/superpowers/specs/2026-11-17-desktop-wrapper-spike.md, section 9.

export const SCHEME = 'app';
/**
 * The page's host. It MUST end in `.local`: the app's own host gate (`packages/app/src/telemetry/enabled.ts`'s `LOCAL`,
 * shared by `account/enabled.ts`, mirrored by `feedback/gate.ts`) reads `*.local` as this machine, so the packaged build
 * sends no telemetry, never reaches `/api/account/*` and never posts feedback. `desktop_policy.test.ts` runs those three
 * gates against this constant.
 */
export const HOST = 'roaring-lions.local';
export const ORIGIN = `${SCHEME}://${HOST}`;

/**
 * Every BrowserWindow's webPreferences. No preload: the page reaches nothing but the web platform. `main.mjs` passes this
 * object and nothing else (`desktop_policy.test.ts` reads its source for that), and also calls `app.enableSandbox()`.
 */
export const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
});

/**
 * The hosts a link may open in the player's browser (`shell.openExternal`), exactly (no subdomains). Today these are the
 * Credits screen's links (`packages/app/src/credits-data.ts`; `desktop_policy.test.ts` fails when a credit links a host
 * missing here). Anything else a page tries to open is dropped.
 */
export const EXTERNAL_HOSTS = Object.freeze(['github.com', 'threejs.org', 'rapier.rs', 'creativecommons.org']);

/** May `url` leave for the player's browser? `https:` only, an exact allow-listed host, no credentials, no port. */
export function externalUrlAllowed(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '' || u.port !== '') return false;
  return EXTERNAL_HOSTS.includes(u.hostname);
}

/** Is `url` a page of the bundle itself (the only place the window may navigate)? */
export function isAppUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === `${SCHEME}:` && u.host === HOST && u.username === '' && u.password === '';
}

/**
 * The permission prompts the page may be granted, by Electron's permission name. The game asks for two: the settings
 * panel's fullscreen toggle (`requestFullscreen`) and copying a share code or a public id (`navigator.clipboard.writeText`).
 * Every other permission (camera, microphone, geolocation, notifications, MIDI, HID, serial, ...) is refused.
 */
export const ALLOWED_PERMISSIONS = Object.freeze(['fullscreen', 'clipboard-sanitized-write']);

/** Answer a permission request or check: yes only for an allowed permission asked by the bundle's own origin. */
export function permissionAllowed(permission, requestingUrl) {
  return ALLOWED_PERMISSIONS.includes(permission) && typeof requestingUrl === 'string' && isAppUrl(requestingUrl);
}

/**
 * The `/*` block of a Cloudflare `_headers` file (`assets/_headers`, copied into every build) as a header map. The
 * desktop scheme answers every file with these, so the page runs under the deployed Content-Security-Policy.
 */
export function parseStaticHeaders(text) {
  const headers = {};
  let inAll = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      inAll = line.trim() === '/*';
      continue;
    }
    if (!inAll) continue;
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return headers;
}

/** Fail closed: a header map without a Content-Security-Policy is refused (at package time and at launch). */
export function requireCsp(headers) {
  const csp = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-security-policy');
  if (csp === undefined || csp[1].trim() === '') {
    throw new Error('the bundled _headers has no Content-Security-Policy for /*: refusing to run the page without one');
  }
  return csp[1];
}

/**
 * May this run be the headless smoke check (SwiftShader, a scripted probe, a forced exit)? Only when the bundle was
 * PACKAGED as a smoke bundle (`desktop-build.json`'s `smoke: true`, written by `build-local.mjs --smoke` into a separate
 * bundle) AND the environment asks for it. A shipped bundle carries `smoke: false`, so its environment cannot switch it.
 */
export function smokeAllowed(build, env) {
  return build !== null && typeof build === 'object' && build.smoke === true && env.RL_DESKTOP_SMOKE === '1';
}

// The runtime: exact, and at least two weeks old when chosen (45.2.1 was published 2026-10-31). Bumping it is its own change, and
// re-pins ELECTRON_SHA256 from the release's SHASUMS256.txt.
export const ELECTRON_VERSION = '45.2.1';
// From https://github.com/electron/electron/releases/download/v45.2.1/SHASUMS256.txt, read 19 Nov 2026. @electron/get
// checks the zip against these instead of downloading the checksum file, so a swapped release asset fails the build.
export const ELECTRON_SHA256 = Object.freeze({
  'electron-v45.2.1-linux-x64.zip': '616efc1ae4784af1a4f3f0e8774e73e7030e7bd1708da9d09bcf543dfa499beb',
  'electron-v45.2.1-linux-arm64.zip': 'e04e635e7312f4b361664e18319aefddbcaaebfdee9c8d9a521e520aa8d385bb',
});

/**
 * The Electron fuses every packaged binary is flipped to (`@electron/fuses`, `FuseV1Options` names; all nine are set, so
 * an Electron upgrade that adds a fuse makes the flip refuse rather than inherit a default silently). `build-local.mjs`
 * flips them and reads the wire back.
 */
export const FUSES = Object.freeze({
  // `ELECTRON_RUN_AS_NODE` would turn the game's binary into a general Node.js.
  RunAsNode: false,
  // Off (Electron's default): the game keeps no cookies, and on Linux encryption asks the desktop keyring, which can
  // put an unlock prompt in front of a player.
  EnableCookieEncryption: false,
  // `NODE_OPTIONS` and `--inspect` would let the environment or a launch option run code in the main process.
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  // The app code ships in `app.asar` and only from there; the packager embeds its hash on Windows and macOS, where
  // Electron validates it. Linux has no embedded integrity (Electron validates on macOS and Windows only).
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  // The page is served from `app://`, never `file://`.
  GrantFileProtocolExtraPrivileges: false,
  // Electron's default: WebAssembly (the Draco decoder) keeps its fast bounds checks.
  WasmTrapHandlers: true,
});

/**
 * The demo's content cut, read from `tools/desktop/demo.json`. HOLD FOR LEAD: the slice is undecided (GH-1379 proposes the
 * tutorial plus Beit Sahwan I to IV), so `missions` is `null` and the bundle carries the whole build. A non-null value is
 * REFUSED until the cut is built, so the config can never claim a cut the bundle does not make.
 */
export function readDemoConfig(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('demo.json: expected an object');
  const known = new Set(['$comment', 'missions']);
  for (const k of Object.keys(json)) if (!known.has(k)) throw new Error(`demo.json: unknown key ${k}`);
  if (!('missions' in json)) throw new Error('demo.json: missing "missions"');
  if (json.missions !== null) {
    throw new Error('demo.json: "missions" must be null until the demo content cut is built (HOLD FOR LEAD, GH-1379)');
  }
  return { missions: null };
}
