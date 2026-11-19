// GH-1414: the desktop build's crash reports (`tools/desktop/crash.mjs`), their wiring into `main.mjs` and
// `build-local.mjs` (read from source: neither runs under vitest), and the pins that hold the desktop client, the app and
// the Worker together. Oracles are literals: a path with a user name, an email, a stack, an HTTP status.
// The live counterpart is `pnpm desktop:package --skip-build --smoke --smoke-crash` (spec section 9.6).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BODY_MAX_BYTES,
  CRASH_ENDPOINT,
  CRASH_ORIGIN,
  CRASH_USER_AGENT,
  GPU_PROBE,
  OFF_ENV,
  OFF_SWITCH,
  OPTOUT_KEY,
  OPTOUT_PROBE,
  OUTBOX_MAX,
  crashDestination,
  crashMode,
  drain,
  envelope,
  fitRecord,
  framesFromCdp,
  framesFromV8Stack,
  goneRecord,
  gpuFamily,
  gpuFamilyFromInfo,
  launchBudget,
  mainErrorRecord,
  optedOutValue,
  outbox,
  pageErrorRecord,
  screenOf,
  scrubFunctionName,
  scrubLocation,
  scrubMessage,
  sendOutcome,
  type CrashContext,
  type CrashRecord,
} from '../desktop/crash.mjs';
import { ORIGIN } from '../desktop/policy.mjs';
import { scrubMessage as appScrubMessage } from '../../packages/app/src/telemetry/errors';
import { OPTOUT_KEY as APP_OPTOUT_KEY } from '../../packages/app/src/telemetry/identity';
import { gpuFamily as dataGpuFamily } from '../../packages/data/src/telemetry';
import { crashReportProblem } from '../../packages/worker/src/crash-meta';
import { DESKTOP_ORIGIN } from '../../packages/worker/src/crash-ingest';
import { PINNED_ORIGINS } from '../../packages/worker/src/account/config';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

const APP = 'app://roaring-lions.local';
const PERSONAL = ['dana', 'Dana', 'DANA', 'example.com', '/home', 'Users', 'AppData', 'tester=', '192.168', '0541234567'];
const CTX: CrashContext = {
  build: { version: '0.134.1', commit: 'a8b15c424', smoke: false, crashReports: true },
  versions: { electron: '45.2.1', chrome: '156.0.8078.75', node: '24.11.0' },
  platform: 'linux',
  arch: 'x64',
  gpu: 'NVIDIA RTX 30-series',
  launch: '0f8fad5b-d9cb-469f-a165-70867728950e',
  now: 1_795_000_000_000,
  uptimeMs: 312_400,
  url: `${APP}/mission/beit_sahwan_2_foothold?tester=dana`,
  appOrigin: APP,
};
const noPersonal = (x: unknown): void => {
  const s = JSON.stringify(x);
  for (const needle of PERSONAL) expect(s, needle).not.toContain(needle);
};

describe('the pins between the desktop client, the app and the Worker', () => {
  it('reports go to the deployed Worker, and only there', () => {
    expect(CRASH_ORIGIN).toBe('https://roaring-lions.pint12.workers.dev');
    expect(CRASH_ORIGIN).toBe(PINNED_ORIGINS[0]);
    expect(CRASH_ENDPOINT).toBe('https://roaring-lions.pint12.workers.dev/api/crash');
  });
  it("the Worker's desktop origin is the bundle's page origin", () => {
    expect(DESKTOP_ORIGIN).toBe(ORIGIN);
    expect(DESKTOP_ORIGIN).toBe('app://roaring-lions.local');
  });
  it("the switch the desktop build reads is the page's Settings switch", () => {
    expect(OPTOUT_KEY).toBe(APP_OPTOUT_KEY);
    expect(OPTOUT_KEY).toBe('lions.telemetry.optout');
    expect(OPTOUT_PROBE).toContain(`getItem("${APP_OPTOUT_KEY}")`);
    // The probe reads one key and writes nothing.
    expect(OPTOUT_PROBE).not.toMatch(/setItem|removeItem|clear\(|fetch|XMLHttpRequest/);
    // Run it against a fake page: the stored opt-out reads '1', a blocked storage reads null.
    const run = (storage: unknown): unknown => new Function('window', `return ${OPTOUT_PROBE};`)({ localStorage: storage });
    expect(run({ getItem: (k: string) => (k === APP_OPTOUT_KEY ? '1' : 'x') })).toBe('1');
    expect(run({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(optedOutValue('1')).toBe(true);
    for (const v of ['0', null, '', 'true', 1]) expect(optedOutValue(v)).toBe(false);
  });
});

// The corpus the app's own scrubber is tested on (packages/app/src/telemetry/errors.test.ts), plus desktop strings.
const MESSAGES = [
  'Failed to fetch https://roaring-lions.pint12.workers.dev/api/account/me?x=1',
  'Bad input from dana.cohen@example.com today',
  'ENOENT /Users/dana/Projects/lions/a.json',
  'Cannot open C:\\Users\\Dana\\lions\\a.json now',
  'player 0541234567 failed',
  'bad token AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  'no player 0f8fad5b-d9cb-469f-a165-70867728950e here',
  'Cannot load /campaign?tester=dana_k',
  'IP 192.168.1.23 failed',
  'peer 2001:db8::ff00:42:8329 refused',
  `Unexpected token 'd', "dana's save slot" is not valid JSON`,
  "Cannot read properties of undefined (reading 'dana_slot')",
  'bad value `dana k` here',
  'call +972 54 123 4567 now',
  'bad jwt eyJhbGci.eyJzdWIi.SflKxwRJ here',
  'open Users\\Dana\\saves\\a.json failed',
  'open \\\\fileserver\\dana\\a.json failed',
  "ENOENT: no such file or directory, open '/home/dana/.config/Roaring Lions/crash-outbox.json'",
  'EACCES C:\\Users\\Dana\\AppData\\Roaming\\Roaring Lions\\x',
  'x is not a function',
  'line one\nline two',
  'x'.repeat(500),
  '\u{1F600} דנה',
  '',
];

describe('scrubMessage is the twin of the app scrubber (GH-1410)', () => {
  it.each(MESSAGES.map((m) => [m.slice(0, 50), m]))('%s', (_label, raw) => {
    expect(scrubMessage(raw)).toBe(appScrubMessage(raw));
  });
  it('a home path, a user name, an email and a query are gone (literal outputs)', () => {
    expect(scrubMessage("ENOENT: no such file or directory, open '/home/dana/.config/Roaring Lions/x.json'")).toBe('ENOENT: no such file or directory, open <str>');
    expect(scrubMessage('EACCES C:\\Users\\Dana\\AppData\\Roaming\\x')).toBe('EACCES <path>');
    expect(scrubMessage('sent by dana.cohen@example.com')).toBe('sent by <email>');
    expect(scrubMessage('load /mission/x?tester=dana')).toBe('load <path>');
    for (const m of MESSAGES) noPersonal(scrubMessage(m));
  });
});

describe('gpuFamily is the twin of @lions/data (never the raw string)', () => {
  const GPUS = [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Adreno (TM) 650',
    'Mali-G78',
    'NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2',
    'Some Unknown Card 9000',
    '',
    null,
  ];
  it.each(GPUS.map((g) => [String(g).slice(0, 40), g]))('%s', (_l, g) => {
    expect(gpuFamily(g)).toBe(dataGpuFamily(g));
  });
  it("reads Electron's GPU info: the GL renderer, else the PCI vendor, else Unknown", () => {
    expect(gpuFamilyFromInfo({ auxAttributes: { glRenderer: GPUS[0] } })).toBe('NVIDIA RTX 30-series');
    expect(gpuFamilyFromInfo({ auxAttributes: { glRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' } })).toBe('Software (no GPU)');
    expect(gpuFamilyFromInfo({ gpuDevice: [{ vendorId: 0x8086, active: false }, { vendorId: 0x10de, active: true }] })).toBe('NVIDIA (other)');
    expect(gpuFamilyFromInfo({ gpuDevice: [{ vendorId: 0x1234 }] })).toBe('Unknown');
    expect(gpuFamilyFromInfo(null)).toBe('Unknown');
  });
});

describe("the page's graphics card, read once and reduced in main", () => {
  const fakeDoc = (renderer: string | null, ext: boolean) => {
    const lost: string[] = [];
    const gl = {
      RENDERER: 0x1f01,
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? (ext ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null) : name === 'WEBGL_lose_context' ? { loseContext: () => lost.push('lost') } : null,
      getParameter: (p: number) => (p === 0x9246 ? renderer : p === 0x1f01 ? 'WebKit WebGL' : null),
    };
    const document = { createElement: () => ({ width: 0, height: 0, getContext: (k: string) => (k === 'webgl2' ? gl : null) }) };
    return { run: () => new Function('document', `return ${GPU_PROBE};`)(document) as unknown, lost };
  };
  it('reads the unmasked renderer from a throwaway context and releases it', () => {
    const d = fakeDoc('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11)', true);
    expect(d.run()).toBe('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11)');
    expect(d.lost).toEqual(['lost']);
    expect(gpuFamily(d.run() as string)).toBe('NVIDIA RTX 30-series');
  });
  it('falls back to the masked renderer, and to null with no WebGL or a throw', () => {
    expect(fakeDoc(null, false).run()).toBe('WebKit WebGL');
    expect(new Function('document', `return ${GPU_PROBE};`)({ createElement: () => ({ getContext: () => null }) })).toBeNull();
    expect(new Function('document', `return ${GPU_PROBE};`)({ createElement: () => { throw new Error('x'); } })).toBeNull();
  });
  it('main.mjs runs it once, and only the family is kept', () => {
    const main = code('tools/desktop/main.mjs');
    expect(main).toMatch(/contents\.once\('did-finish-load', \(\) => \{\s*contents\s*\.executeJavaScript\(GPU_PROBE\)\s*\.then\(\(raw\) => \{\s*if \(typeof raw === 'string'\) crashGpu = gpuFamily\(raw\);/);
    expect(main.split('GPU_PROBE').length - 1).toBe(2);
  });
});

describe('stack locations keep only where in the GAME a frame is', () => {
  it.each([
    ['the page, with a query and fragment', `${APP}/assets/index-Dk2a9.js?tester=dana#x`, 'web/assets/index-Dk2a9.js'],
    ['the page root', `${APP}/`, '<other>'],
    ['the main process, a Linux install under a home', '/home/dana/Games/Roaring Lions/resources/app.asar/main.mjs', 'asar/main.mjs'],
    ['the main process, a Windows install', 'C:\\Users\\Dana\\AppData\\Local\\Programs\\Roaring Lions\\resources\\app.asar\\crash.mjs', 'asar/crash.mjs'],
    ['the main process, as a file URL', 'file:///C:/Users/Dana/AppData/Local/Roaring%20Lions/resources/app.asar/main.mjs', 'asar/main.mjs'],
    ['the main process, a macOS bundle', 'file:///Users/dana/Applications/Roaring%20Lions.app/Contents/Resources/app.asar/policy.mjs', 'asar/policy.mjs'],
    ['an asar path with a space after it', '/home/dana/x/app.asar/my dir/a.mjs', '<other>'],
    ['an asar path climbing out', '/home/dana/x/app.asar/../../secret.mjs', '<other>'],
    ['a file outside the asar', '/home/dana/.config/Roaring Lions/x.js', '<other>'],
    ['another origin', 'https://evil.example/x.js', '<other>'],
    ['the desktop scheme on another host', 'app://evil.local/x.js', '<other>'],
    ['a Node internal', 'node:internal/process/task_queues', 'node:internal/process/task_queues'],
    ['an Electron internal', 'node:electron/js2c/browser_init', 'node:electron/js2c/browser_init'],
    ['native', 'native', '<native>'],
    ['an eval', 'eval at foo (/home/dana/x.js:1:1), <anonymous>', '<other>'],
    ['empty', '', '<other>'],
  ])('%s', (_what, raw, want) => {
    expect(scrubLocation(raw, APP)).toBe(want);
  });
  it.each([
    ['stepMovement', 'stepMovement'],
    ['async loop', 'loop'],
    ['new Sim', 'Sim'],
    ['Object.<anonymous>', 'Object.<anonymous>'],
    ['dana smith', '<anon>'],
    ['', '<anon>'],
    ['x'.repeat(65), '<anon>'],
  ])('function name %j -> %j', (raw, want) => {
    expect(scrubFunctionName(raw)).toBe(want);
  });

  it('a main-process V8 stack from a Windows install keeps its shape and loses the user', () => {
    const stack = [
      "Error: ENOENT: no such file or directory, open 'C:\\Users\\Dana\\x'",
      '    at readBuild (file:///C:/Users/Dana/AppData/Local/Programs/Roaring%20Lions/resources/app.asar/main.mjs:52:12)',
      '    at async Promise.all (index 0)',
      '    at Object.<anonymous> (C:\\Users\\Dana\\AppData\\Local\\Programs\\Roaring Lions\\resources\\app.asar\\main.mjs:60:1)',
      '    at Module._compile (node:internal/modules/cjs/loader:1554:14)',
      '    at /home/dana/evil.js:1:1',
    ].join('\n');
    expect(framesFromV8Stack(stack, APP)).toEqual([
      'readBuild (asar/main.mjs:52:12)',
      'Promise.all (<other>:0:0)',
      'Object.<anonymous> (asar/main.mjs:60:1)',
      'Module._compile (node:internal/modules/cjs/loader:1554:14)',
      '<anon> (<other>:0:0)',
    ]);
  });
  it('CDP call frames are 1-based on the wire, and keep at most 16', () => {
    const frames = [
      { functionName: 'stepMovement', url: `${APP}/assets/index-Dk2a9.js?v=1`, lineNumber: 0, columnNumber: 23455 },
      { functionName: '', url: '', lineNumber: 4, columnNumber: 2 },
      { functionName: 'x', url: 'https://dana.example.com/a.js', lineNumber: 1, columnNumber: 1 },
    ];
    expect(framesFromCdp(frames, APP)).toEqual(['stepMovement (web/assets/index-Dk2a9.js:1:23456)', '<anon> (<other>:0:0)', 'x (<other>:0:0)']);
    expect(framesFromCdp(Array.from({ length: 40 }, () => frames[0]), APP)).toHaveLength(16);
    expect(framesFromCdp(undefined, APP)).toEqual([]);
  });
});

describe('a record is small, whitelisted and accepted by the Worker', () => {
  const pageDetails = {
    text: 'Uncaught',
    exception: { type: 'object', className: 'TypeError', description: "TypeError: Cannot open /home/dana/x.json for dana@example.com\n    at f (app://roaring-lions.local/a.js:1:1)" },
    stackTrace: { callFrames: [{ functionName: 'loadSave', url: `${APP}/assets/index-Dk2a9.js`, lineNumber: 9, columnNumber: 99 }] },
  };

  it('a page exception', () => {
    const rec = pageErrorRecord(pageDetails, CTX);
    expect(rec).toEqual({
      v: 1, t: 1_795_000_000_000, kind: 'page_exception', launch: CTX.launch, uptimeS: 312, version: '0.134.1', commit: 'a8b15c424',
      electron: '45.2.1', chrome: '156.0.8078.75', platform: 'linux', arch: 'x64', gpu: 'NVIDIA RTX 30-series', screen: 'mission',
      mission: 'beit_sahwan_2_foothold', name: 'TypeError', message: 'Cannot open <path> for <email>', stack: ['loadSave (web/assets/index-Dk2a9.js:10:100)'],
    });
    expect(crashReportProblem(rec)).toBeNull();
    noPersonal(rec);
  });
  it('a page rejection of a primitive', () => {
    const rec = pageErrorRecord({ text: 'Uncaught (in promise)', exception: { type: 'string', value: 'dana@example.com said no' } }, CTX);
    expect(rec).toMatchObject({ kind: 'page_rejection', name: 'NonError', message: '<email> said no' });
    expect(rec).not.toHaveProperty('stack');
    expect(crashReportProblem(rec)).toBeNull();
    noPersonal(rec);
  });
  it('a main-process exception and rejection', () => {
    const err = new Error("ENOENT: no such file or directory, open '/home/dana/.config/Roaring Lions/x'");
    err.stack = `${err.message}\n    at readBuild (/home/dana/Games/Roaring Lions/resources/app.asar/main.mjs:52:12)`;
    const rec = mainErrorRecord(err, 'uncaughtException', CTX);
    expect(rec).toMatchObject({ kind: 'main_exception', name: 'Error', message: 'ENOENT: no such file or directory, open <str>', stack: ['readBuild (asar/main.mjs:52:12)'] });
    expect(crashReportProblem(rec)).toBeNull();
    noPersonal(rec);
    const rej = mainErrorRecord('dana@example.com', 'unhandledRejection', CTX);
    expect(rej).toMatchObject({ kind: 'main_rejection', name: 'NonError', message: '<email>' });
    expect(crashReportProblem(rej)).toBeNull();
  });
  it('a renderer and a GPU process that went away; a clean exit is no report', () => {
    const r = goneRecord('renderer_gone', { reason: 'crashed', exitCode: 133 }, CTX);
    expect(r).toMatchObject({ kind: 'renderer_gone', reason: 'crashed', exitCode: 133 });
    expect(crashReportProblem(r)).toBeNull();
    const g = goneRecord('child_gone', { type: 'GPU', reason: 'oom', exitCode: -1 }, CTX);
    expect(g).toMatchObject({ kind: 'child_gone', process: 'GPU', reason: 'oom', exitCode: -1 });
    expect(crashReportProblem(g)).toBeNull();
    const u = goneRecord('child_gone', { type: 'Utility', serviceName: 'network.mojom.NetworkService', name: 'Network Service', reason: 'crashed', exitCode: 1 }, CTX);
    expect(u).toMatchObject({ process: 'Utility', service: 'Network Service' });
    expect(crashReportProblem(u)).toBeNull();
    expect(goneRecord('renderer_gone', { reason: 'clean-exit', exitCode: 0 }, CTX)).toBeNull();
    expect(goneRecord('renderer_gone', { reason: 'Crashed at /home/dana' }, CTX)).toBeNull();
  });
  it('no manifest version, or a bad Electron version, means no report at all', () => {
    expect(envelope('renderer_gone', { ...CTX, build: { version: 'dev' } })).toBeNull();
    expect(envelope('renderer_gone', { ...CTX, build: null })).toBeNull();
    expect(envelope('renderer_gone', { ...CTX, versions: { electron: 'x' } })).toBeNull();
    expect(envelope('hang', CTX)).toBeNull();
  });
  it('the screen comes from the path alone', () => {
    expect(screenOf(`${APP}/`, APP)).toEqual({ screen: 'menu' });
    expect(screenOf(`${APP}/mission/beit_sahwan_0_tutorial`, APP)).toEqual({ screen: 'tutorial', mission: 'beit_sahwan_0_tutorial' });
    expect(screenOf(`${APP}/free-play/qarn_hadid`, APP)).toEqual({ screen: 'sandbox' });
    expect(screenOf(`${APP}/settings?tester=dana`, APP)).toEqual({ screen: 'other' });
    expect(screenOf(`${APP}/mission/Dana's%20save`, APP)).toEqual({ screen: 'mission' });
    expect(screenOf('https://evil.example/mission/x', APP)).toEqual({});
  });
  it('fitRecord trims the stack until the body fits 6144 bytes', () => {
    const rec = { ...(pageErrorRecord(pageDetails, CTX) as CrashRecord), stack: Array.from({ length: 16 }, () => `f (web/${'a'.repeat(160)}:1:1)`) };
    expect(JSON.stringify(rec).length).toBeLessThan(BODY_MAX_BYTES);
    const big = { ...rec, stack: Array.from({ length: 40 }, () => `f (web/${'a'.repeat(160)}:1:1)`) };
    const body = fitRecord(big);
    expect(body).not.toBeNull();
    expect(new TextEncoder().encode(body ?? '').length).toBeLessThanOrEqual(6144);
    expect((JSON.parse(body ?? '{}') as CrashRecord).stack?.length).toBeLessThan(40);
  });
});

describe('when a report may be made: nothing sends unless every condition holds', () => {
  const SHIPPED = { version: '0.134.1', smoke: false, crashReports: true };
  const base = { build: SHIPPED, env: {}, argv: ['roaring-lions'], isPackaged: true, smoke: false };
  it.each([
    ['a shipped bundle packaged --crash-reports', base, 'send'],
    ['packaged without --crash-reports', { ...base, build: { ...SHIPPED, crashReports: false } }, 'off'],
    ['an older manifest with no crashReports', { ...base, build: { version: '0.134.1', smoke: false } }, 'off'],
    ['crashReports as a string', { ...base, build: { ...SHIPPED, crashReports: 'true' } }, 'off'],
    ['not packaged (electron . in a checkout)', { ...base, isPackaged: false }, 'off'],
    ['no manifest', { ...base, build: null }, 'off'],
    ['CI', { ...base, env: { CI: 'true' } }, 'off'],
    ['CI=1', { ...base, env: { CI: '1' } }, 'off'],
    [`${OFF_ENV}=1`, { ...base, env: { [OFF_ENV]: '1' } }, 'off'],
    [`${OFF_ENV}=0 is not an opt-out`, { ...base, env: { [OFF_ENV]: '0' } }, 'send'],
    [`the ${OFF_SWITCH} launch option`, { ...base, argv: ['roaring-lions', OFF_SWITCH] }, 'off'],
    ['a smoke bundle in its smoke run records, never sends', { ...base, build: { ...SHIPPED, smoke: true }, smoke: true }, 'record'],
    ['a smoke bundle outside its smoke run', { ...base, build: { ...SHIPPED, smoke: true }, smoke: false }, 'off'],
    ['a shipped bundle whose environment asks for the smoke run', { ...base, smoke: true }, 'send'],
  ])('%s: %s', (_what, input, want) => {
    expect(crashMode(input as Parameters<typeof crashMode>[0])).toBe(want);
  });
  it('a send goes to the Worker; a smoke run only to a loopback sink; off goes nowhere', () => {
    expect(crashDestination('send', { RL_DESKTOP_SMOKE_CRASH_SINK: 'http://127.0.0.1:9/' })).toBe(CRASH_ENDPOINT);
    expect(crashDestination('record', {})).toBeNull();
    expect(crashDestination('record', { RL_DESKTOP_SMOKE_CRASH_SINK: 'http://127.0.0.1:4567/api/crash' })).toBe('http://127.0.0.1:4567/api/crash');
    for (const sink of ['https://evil.example/', 'http://localhost:4567/', 'http://127.0.0.1/', 'http://u:p@127.0.0.1:1/', 'http://10.0.0.1:80/', 'nope']) {
      expect(crashDestination('record', { RL_DESKTOP_SMOKE_CRASH_SINK: sink }), sink).toBeNull();
    }
    expect(crashDestination('off', { RL_DESKTOP_SMOKE_CRASH_SINK: 'http://127.0.0.1:4567/' })).toBeNull();
  });
});

describe('the outbox and the sender', () => {
  const file = () => {
    let text: string | null = null;
    return { io: { read: () => text, write: (t: string) => void (text = t) }, peek: () => text };
  };
  it('keeps at most 5 records for at most 7 days, oldest first', () => {
    const f = file();
    const box = outbox(f.io);
    for (let i = 0; i < 7; i++) expect(box.add(`r${i}`, 1000 + i)).toBe(true);
    expect(box.pending(2000).map((r) => r.body)).toEqual(['r2', 'r3', 'r4', 'r5', 'r6']);
    expect(OUTBOX_MAX).toBe(5);
    expect(box.pending(1000 + 7 * 86_400_000 + 3).map((r) => r.body)).toEqual(['r3', 'r4', 'r5', 'r6']);
    box.remove(1003, 'r3');
    expect(box.pending(2000).map((r) => r.body)).toEqual(['r4', 'r5', 'r6']);
  });
  it('the opt-out empties it at once, refuses new records, and survives a restart', () => {
    const f = file();
    const box = outbox(f.io);
    box.add('r0', 1);
    box.setOptedOut(true);
    expect(f.peek()).not.toContain('r0');
    expect(box.add('r1', 2)).toBe(false);
    expect(box.pending(3)).toEqual([]);
    expect(outbox(f.io).optedOut()).toBe(true);
    box.setOptedOut(false);
    expect(box.add('r2', 4)).toBe(true);
  });
  it('an unreadable or foreign file is an empty outbox, and a write that throws breaks nothing', () => {
    for (const text of ['{', 'null', '[]', '{"records":"x"}', '{"records":[{"at":"1","body":2}]}']) {
      expect(outbox({ read: () => text, write: () => {} }).pending(10)).toEqual([]);
    }
    const box = outbox({ read: () => { throw new Error('EACCES /home/dana'); }, write: () => { throw new Error('EROFS'); } });
    expect(() => box.add('r', 1)).not.toThrow();
  });
  it.each([
    [204, 'sent'], [201, 'sent'], [400, 'drop'], [403, 'drop'], [404, 'drop'], [405, 'drop'], [410, 'drop'], [413, 'drop'], [415, 'drop'],
    [429, 'retry'], [500, 'retry'], [503, 'retry'], [0, 'retry'],
  ])('HTTP %i: %s', (status, want) => {
    expect(sendOutcome(status)).toBe(want);
  });
  it('drain sends oldest first, removes what was stored or refused, and stops at the first retry', async () => {
    const f = file();
    const box = outbox(f.io);
    for (const b of ['a', 'b', 'c', 'd']) box.add(b, b.charCodeAt(0));
    const statuses: Record<string, number> = { a: 204, b: 410, c: 503, d: 204 };
    const posted: string[] = [];
    const out = await drain({ box, url: CRASH_ENDPOINT, now: 200, optedOut: () => false, post: async (url, body) => (posted.push(`${url} ${body}`), statuses[body] ?? 0) });
    expect(posted).toEqual([`${CRASH_ENDPOINT} a`, `${CRASH_ENDPOINT} b`, `${CRASH_ENDPOINT} c`]);
    expect(out).toEqual(['sent', 'drop']);
    expect(box.pending(200).map((r) => r.body)).toEqual(['c', 'd']);
  });
  it('NOTHING is posted while the player is opted out, even mid-drain', async () => {
    const f = file();
    const box = outbox(f.io);
    box.add('a', 1);
    box.add('b', 2);
    let calls = 0;
    await drain({ box, url: CRASH_ENDPOINT, now: 10, optedOut: () => true, post: async () => (calls++, 204) });
    expect(calls).toBe(0);
    let off = false;
    await drain({ box, url: CRASH_ENDPOINT, now: 10, optedOut: () => off, post: async () => ((off = true), calls++, 204) });
    expect(calls).toBe(1);
  });
  it('a launch makes at most 6 reports, at most 3 from the page, never the same one twice', () => {
    const b = launchBudget();
    const page = (m: string) => ({ v: 1, kind: 'page_exception', name: 'TypeError', message: m }) as CrashRecord;
    expect(b.take(page('a'))).toBe(true);
    expect(b.take(page('a'))).toBe(false);
    expect(b.take(page('b'))).toBe(true);
    expect(b.take(page('c'))).toBe(true);
    expect(b.take(page('d'))).toBe(false);
    const gone = (reason: string) => ({ v: 1, kind: 'renderer_gone', reason }) as CrashRecord;
    expect(['crashed', 'oom', 'killed', 'launch-failed'].map((r) => b.take(gone(r)))).toEqual([true, true, true, false]);
  });
});

describe('main.mjs and build-local.mjs wire it as crash.mjs says', () => {
  const main = code('tools/desktop/main.mjs');
  const build = code('tools/desktop/build-local.mjs');
  it('no minidump: crashReporter is never started', () => {
    expect(main).not.toMatch(/crashReporter/);
    expect(read('tools/desktop/crash.mjs')).not.toMatch(/crashReporter\.start|submitURL/);
  });
  it('the mode and the destination come from crash.mjs alone, and the page never names a URL', () => {
    expect(main).toContain('const CRASH_MODE = crashMode({ build: BUILD, env: process.env, argv: process.argv, isPackaged: app.isPackaged, smoke: SMOKE });');
    expect(main).toContain('const CRASH_URL = crashDestination(CRASH_MODE, process.env);');
    expect(main).not.toMatch(/workers\.dev|CRASH_ENDPOINT|CRASH_ORIGIN|RL_DESKTOP_SMOKE_CRASH_SINK/);
    // crashPost is handed CRASH_URL and nothing else.
    expect(main.match(/crashPost\([^)]*\)/g)).toEqual(['crashPost(url, body)', 'crashPost(CRASH_URL, body)']);
    expect(main.split('net.request(').length - 1).toBe(1);
    expect(main).toMatch(/net\.request\(\{ method: 'POST', url, origin: ORIGIN, credentials: 'omit', useSessionCookies: false, redirect: 'error' \}\)/);
    expect(main).toContain("req.setHeader('user-agent', CRASH_USER_AGENT);");
    expect(CRASH_USER_AGENT).toBe('roaring-lions-desktop');
  });
  it('every report checks the mode, the opt-out and the budget; every send the opt-out', () => {
    expect(main).toMatch(/if \(CRASH_MODE === 'off' \|\| rec === null \|\| crashOptedOut \|\| !crashBudget\.take\(rec\)\) return;/);
    expect(main).toMatch(/drain\(\{ box, post: crashPost, url: CRASH_URL, now: Date\.now\(\), optedOut: \(\) => crashOptedOut \}\)/);
    expect(main).toMatch(/crashOptedOut = optedOutValue\(v\);\s*crashOutbox\(\)\?\.setOptedOut\(crashOptedOut\);/);
    expect(main).toMatch(/\.executeJavaScript\(OPTOUT_PROBE\)/);
  });
  it('nothing is listened to when reporting is off, and the main-process hook only observes', () => {
    expect(main).toMatch(/if \(CRASH_MODE !== 'off'\) \{\s*process\.on\('uncaughtExceptionMonitor'/);
    expect(main).not.toMatch(/process\.on\('uncaughtException'|process\.on\('unhandledRejection'/);
    expect(main).toContain("if (CRASH_MODE !== 'off') watchForCrashes(win.webContents);");
    expect(main).toContain("app.on('render-process-gone', (_event, _contents, details) => reportCrash(goneRecord('renderer_gone', details, crashContext())));");
    expect(main).toContain("app.on('child-process-gone', (_event, details) => reportCrash(goneRecord('child_gone', details, crashContext())));");
    expect(main).toMatch(/if \(method === 'Runtime\.exceptionThrown'\) reportCrash\(pageErrorRecord\(params\?\.exceptionDetails, crashContext\(\)\)\);/);
  });
  it('a smoke bundle records and sends only to its loopback sink', () => {
    expect(main).toMatch(/if \(CRASH_MODE === 'record'\) \{\s*crashRecorded\.push\(JSON\.parse\(body\)\);\s*if \(CRASH_URL !== null && app\.isReady\(\)\) void crashPost\(CRASH_URL, body\);\s*return;/);
  });
  it('build-local copies crash.mjs, sets crashReports only on a shipped bundle with the flag, and its launch check never sends', () => {
    expect(build).toContain("for (const f of ['main.mjs', 'policy.mjs', 'resolve.mjs', 'crash.mjs']) cpSync(");
    expect(build).toContain("const crashReports = !smoke && args.has('--crash-reports');");
    expect(build).toMatch(/const manifest = \{ version: rootPkg\.version, commit, electron: ELECTRON_VERSION, smoke, crashReports, demo, commercial \};/);
    expect(build).toMatch(/RL_DESKTOP_SMOKE_OUT: OUT,\s*RL_DESKTOP_NO_CRASH_REPORTS: '1',/);
    expect(OFF_ENV).toBe('RL_DESKTOP_NO_CRASH_REPORTS');
  });
});
