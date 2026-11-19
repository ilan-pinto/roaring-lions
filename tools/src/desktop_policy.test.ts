// GH-1418: the packaged desktop build's security and content policy (`tools/desktop/policy.mjs`), and the wiring of it
// into Electron (`tools/desktop/main.mjs`) and into the packager (`tools/desktop/build-local.mjs`), read from source
// because both need Electron or a real build to run. Oracles are literals: a flag, a URL, a host, a permission name.
// The live counterpart (the same rules seen from inside a packaged page) is `pnpm desktop:package --smoke`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_PERMISSIONS,
  ELECTRON_SHA256,
  ELECTRON_VERSION,
  EXTERNAL_HOSTS,
  FUSES,
  HOST,
  ORIGIN,
  WEB_PREFERENCES,
  externalUrlAllowed,
  isAppUrl,
  parseStaticHeaders,
  permissionAllowed,
  readDemoConfig,
  requireCsp,
  smokeAllowed,
} from '../desktop/policy.mjs';
import { telemetryEnabled } from '../../packages/app/src/telemetry/enabled';
import { accountsEnabled } from '../../packages/app/src/account/enabled';
import { feedbackSends } from '../../packages/app/src/feedback/gate';
import { CREDITS } from '../../packages/app/src/credits-data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with `//` line comments and `/* *\/` blocks removed, so a comment can never satisfy a pin. */
const code = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
const count = (s: string, needle: string): number => s.split(needle).length - 1;

describe('the page host is not a real host (telemetry, accounts, feedback stay off)', () => {
  it('serves from app://roaring-lions.local', () => {
    expect(HOST).toBe('roaring-lions.local');
    expect(ORIGIN).toBe('app://roaring-lions.local');
  });

  // Each gate is run on the desktop host AND on the deployed host, so a gate that read "off" for every input fails here.
  const REAL = 'roaring-lions.pint12.workers.dev';
  const q = () => new URLSearchParams();
  const tele = (hostname: string) => telemetryEnabled({ prod: true, hostname, query: q(), gpc: false, dnt: false, optedOut: false });

  it('telemetry: off on the desktop host, on on the deployed one', () => {
    expect(tele(HOST)).toBe(false);
    expect(tele(REAL)).toBe(true);
  });
  it('accounts: off on the desktop host, on on the deployed one', () => {
    expect(accountsEnabled(q(), { prod: true, hostname: HOST })).toBe(false);
    expect(accountsEnabled(q(), { prod: true, hostname: REAL })).toBe(true);
  });
  it('feedback (and the notices that share its gate): off on the desktop host, on on the deployed one', () => {
    expect(feedbackSends({ prod: true, hostname: HOST })).toBe(false);
    expect(feedbackSends({ prod: true, hostname: REAL })).toBe(true);
  });
  it('main.mjs serves and loads that one host', () => {
    const main = code('tools/desktop/main.mjs');
    expect(main).toMatch(/resolveRequest\(request\.url, \{ host: HOST,/);
    expect(main).toMatch(/win\.loadURL\(`\$\{ORIGIN\}/);
    expect(main).not.toMatch(/roaring-lions\.[a-z]/);
  });
});

describe('webPreferences', () => {
  it('pins every flag', () => {
    expect(WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
    expect(Object.isFrozen(WEB_PREFERENCES)).toBe(true);
  });

  it('main.mjs passes WEB_PREFERENCES and nothing else, has no preload, and sandboxes every renderer', () => {
    const main = code('tools/desktop/main.mjs');
    expect(count(main, 'webPreferences:')).toBe(1);
    expect(main).toContain('webPreferences: WEB_PREFERENCES,');
    for (const flag of ['contextIsolation', 'nodeIntegration', 'sandbox:', 'webSecurity', 'preload']) expect(main).not.toContain(flag);
    expect(main).toMatch(/^if \(!app\.commandLine\.hasSwitch\('no-sandbox'\)\) app\.enableSandbox\(\);$/m);
  });
});

describe('navigation and external links', () => {
  it.each([
    ['app://roaring-lions.local/', true],
    ['app://roaring-lions.local/mission/beit_sahwan_0_tutorial', true],
    ['app://roaring-lions.local', true],
    ['app://evil.local/', false],
    ['app://roaring-lions.local.evil.com/', false],
    ['app://u:p@roaring-lions.local/', false],
    ['https://roaring-lions.local/', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
  ])('isAppUrl(%s) is %s', (url, want) => {
    expect(isAppUrl(url)).toBe(want);
  });

  it('allow-lists exactly four hosts', () => {
    expect([...EXTERNAL_HOSTS]).toEqual(['github.com', 'threejs.org', 'rapier.rs', 'creativecommons.org']);
  });

  it.each([
    ['https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words', true],
    ['https://threejs.org', true],
    ['https://creativecommons.org/licenses/by/4.0/', true],
    ['http://github.com/', false],
    ['https://evil.example/', false],
    ['https://github.com.evil.example/', false],
    ['https://gist.github.com/', false],
    ['https://user@github.com/', false],
    ['https://github.com:8443/', false],
    ['javascript:alert(1)', false],
    ['app://roaring-lions.local/licenses/x.txt', false],
    ['', false],
  ])('externalUrlAllowed(%s) is %s', (url, want) => {
    expect(externalUrlAllowed(url)).toBe(want);
  });

  it('every link on the Credits screen opens (its host is allow-listed)', () => {
    const urls = JSON.stringify(CREDITS).match(/https?:\/\/[^"\s]+/g) ?? [];
    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const u of urls) expect(externalUrlAllowed(u), u).toBe(true);
  });

  it('main.mjs gates openExternal and every navigation on the policy, for every web contents', () => {
    const main = code('tools/desktop/main.mjs');
    expect(main).toMatch(/app\.on\('web-contents-created', \(_event, contents\) => lockDown\(contents\)\);/);
    expect(count(main, 'shell.openExternal(')).toBe(1);
    expect(main).toMatch(/if \(externalUrlAllowed\(url\)\) \{\s*if \(SMOKE\) externalOpened\.push\(url\);\s*else void shell\.openExternal\(url\);/);
    expect(main).toMatch(/return \{ action: 'deny' \};/);
    expect(main).toMatch(/if \(!isAppUrl\(url\)\) event\.preventDefault\(\);/);
    expect(main).toContain("contents.on('will-navigate', stayInBundle);");
    expect(main).toContain("contents.on('will-redirect', stayInBundle);");
    expect(main).toContain("contents.on('will-attach-webview', (event) => event.preventDefault());");
  });
});

describe('permissions', () => {
  it('grants only fullscreen and clipboard writes', () => {
    expect([...ALLOWED_PERMISSIONS]).toEqual(['fullscreen', 'clipboard-sanitized-write']);
  });
  it.each([
    ['fullscreen', 'app://roaring-lions.local/', true],
    ['clipboard-sanitized-write', 'app://roaring-lions.local', true],
    ['fullscreen', 'https://evil.example/', false],
    ['fullscreen', undefined, false],
    ['geolocation', 'app://roaring-lions.local/', false],
    ['media', 'app://roaring-lions.local/', false],
    ['notifications', 'app://roaring-lions.local/', false],
    ['clipboard-read', 'app://roaring-lions.local/', false],
    ['openExternal', 'app://roaring-lions.local/', false],
  ])('%s from %s is %s', (permission, from, want) => {
    expect(permissionAllowed(permission, from)).toBe(want);
  });
  it('main.mjs answers every request, check and device prompt through the policy', () => {
    const main = code('tools/desktop/main.mjs');
    expect(main).toMatch(/setPermissionRequestHandler\(\(_wc, permission, callback, details\) => \{\s*callback\(permissionAllowed\(permission, details\.requestingUrl\)\);/);
    expect(main).toMatch(/setPermissionCheckHandler\(\(_wc, permission, requestingOrigin\) => permissionAllowed\(permission, requestingOrigin\)\)/);
    expect(main).toContain('setDevicePermissionHandler(() => false)');
  });
});

describe('the Content-Security-Policy fails closed', () => {
  it('reads the deployed CSP from assets/_headers', () => {
    expect(requireCsp(parseStaticHeaders(read('assets/_headers')))).toMatch(/^default-src 'self'; script-src 'self' 'wasm-unsafe-eval';/);
  });
  it('refuses a headers file with no CSP, an empty one, and a CSP outside the /* block', () => {
    expect(() => requireCsp(parseStaticHeaders(''))).toThrow(/no Content-Security-Policy/);
    expect(() => requireCsp(parseStaticHeaders('/*\n  X-Frame-Options: DENY\n'))).toThrow(/no Content-Security-Policy/);
    expect(() => requireCsp(parseStaticHeaders('/*\n  Content-Security-Policy:   \n'))).toThrow(/no Content-Security-Policy/);
    expect(() => requireCsp(parseStaticHeaders("/api/*\n  Content-Security-Policy: default-src 'self'\n"))).toThrow(/no Content-Security-Policy/);
  });
  it('main.mjs refuses to start, and build-local.mjs to package, without one', () => {
    expect(code('tools/desktop/main.mjs')).toMatch(/requireCsp\(STATIC_HEADERS\);\s*\} catch \(err\) \{\s*refused = true;/);
    expect(code('tools/desktop/build-local.mjs')).toMatch(/requireCsp\(parseStaticHeaders\(/);
  });
});

describe('the smoke run is a build-time property', () => {
  it.each([
    [{ smoke: true }, { RL_DESKTOP_SMOKE: '1' }, true],
    [{ smoke: false }, { RL_DESKTOP_SMOKE: '1' }, false],
    [{ smoke: 'true' }, { RL_DESKTOP_SMOKE: '1' }, false],
    [{}, { RL_DESKTOP_SMOKE: '1' }, false],
    [null, { RL_DESKTOP_SMOKE: '1' }, false],
    [{ smoke: true }, {}, false],
    [{ smoke: true }, { RL_DESKTOP_SMOKE: 'true' }, false],
  ])('smokeAllowed(%j, %j) is %s', (build, env, want) => {
    expect(smokeAllowed(build, env)).toBe(want);
  });
  it('main.mjs reads it from the manifest and gates the SwiftShader switches on it', () => {
    const main = code('tools/desktop/main.mjs');
    expect(main).toContain('const SMOKE = smokeAllowed(BUILD, process.env);');
    // The variable alone is never read: only smokeAllowed, which also needs the manifest, decides.
    expect(main).not.toMatch(/RL_DESKTOP_SMOKE\b(?!_)/);
    expect(main).toMatch(/if \(SMOKE\) \{\s*app\.commandLine\.appendSwitch\('enable-unsafe-swiftshader'\);/);
    expect(count(main, 'enable-unsafe-swiftshader')).toBe(1);
  });
  it('build-local.mjs packages the shipped bundle with smoke:false', () => {
    expect(code('tools/desktop/build-local.mjs')).toMatch(/const shipped = await packageBundle\(\{ smoke: false \}\);/);
  });
});

describe('the binary', () => {
  it('pins every fuse', () => {
    expect(FUSES).toEqual({
      RunAsNode: false,
      EnableCookieEncryption: false,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      EnableEmbeddedAsarIntegrityValidation: true,
      OnlyLoadAppFromAsar: true,
      LoadBrowserProcessSpecificV8Snapshot: false,
      GrantFileProtocolExtraPrivileges: false,
      WasmTrapHandlers: true,
    });
  });
  it('names exactly the fuses @electron/fuses knows', async () => {
    const { FuseV1Options } = await import('@electron/fuses');
    const names = Object.keys(FuseV1Options).filter((k) => Number.isNaN(Number(k)));
    expect(Object.keys(FUSES).sort()).toEqual(names.sort());
  });
  it('pins the Electron runtime by version and SHA-256', () => {
    expect(ELECTRON_VERSION).toBe('45.2.1');
    expect(ELECTRON_SHA256).toEqual({
      'electron-v45.2.1-linux-x64.zip': '616efc1ae4784af1a4f3f0e8774e73e7030e7bd1708da9d09bcf543dfa499beb',
      'electron-v45.2.1-linux-arm64.zip': 'e04e635e7312f4b361664e18319aefddbcaaebfdee9c8d9a521e520aa8d385bb',
    });
  });
  it('build-local.mjs ships an asar, checks the download, flips the fuses and reads them back', () => {
    const build = code('tools/desktop/build-local.mjs');
    expect(build).toMatch(/^\s*asar: true,$/m);
    expect(build).toContain('download: { cacheRoot: CACHE, checksums: ELECTRON_SHA256 },');
    expect(build).toContain('await flipFuses(binary, config);');
    expect(build).toContain('const wire = await getCurrentFuseWire(binary);');
    expect(build).not.toMatch(/unsafelyDisableChecksums|mirrorOptions/);
  });
});

describe('the demo content cut (HOLD FOR LEAD)', () => {
  it('ships as null: no cut yet', () => {
    expect(readDemoConfig(JSON.parse(read('tools/desktop/demo.json')))).toEqual({ missions: null });
  });
  it('refuses a cut it cannot make, an unknown key and a missing one', () => {
    expect(() => readDemoConfig({ missions: ['beit_sahwan_0_tutorial'] })).toThrow(/HOLD FOR LEAD/);
    expect(() => readDemoConfig({ missions: null, maps: [] })).toThrow(/unknown key maps/);
    expect(() => readDemoConfig({})).toThrow(/missing "missions"/);
    expect(() => readDemoConfig([])).toThrow(/expected an object/);
  });
});
