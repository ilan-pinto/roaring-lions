// GH-1414: the Worker's crash-report validator agrees with data/schemas/crash_report.schema.json on every fixture, and
// both refuse every way a client could leak something personal. Fixtures are literals.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, it, expect } from 'vitest';
import { crashReportProblem } from './crash-meta';
import { CAPTURED } from './crash-captured.test-helper';

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../data/schemas/crash_report.schema.json', import.meta.url)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const BASE = {
  v: 1,
  t: 1_795_000_000_000,
  launch: '0f8fad5b-d9cb-469f-a165-70867728950e',
  uptimeS: 312,
  version: '0.134.1',
  commit: 'a8b15c424',
  electron: '45.2.1',
  chrome: '156.0.8078.75',
  platform: 'linux',
  arch: 'x64',
  gpu: 'NVIDIA RTX 30-series',
};
const RENDERER = { ...BASE, kind: 'renderer_gone', reason: 'crashed', exitCode: 133, screen: 'mission', mission: 'beit_sahwan_2_foothold' };
const CHILD = { ...BASE, kind: 'child_gone', reason: 'crashed', exitCode: -1, process: 'GPU' };
const PAGE = {
  ...BASE,
  kind: 'page_exception',
  name: 'TypeError',
  message: "Cannot read properties of undefined (reading <str>)",
  stack: ['stepMovement (web/assets/index-Dk2a9.js:1:23456)', '<anon> (web/assets/index-Dk2a9.js:2:10)', 'loop (<other>:0:0)'],
  screen: 'menu',
};
const MAIN = { ...BASE, kind: 'main_exception', name: 'Error', message: 'ENOENT <path>', stack: ['readBuild (asar/main.mjs:52:5)', 'Module._compile (node:internal/modules/cjs/loader:1:2)', '<anon> (<native>:0:0)'] };

const VALID: Record<string, unknown>[] = [
  ...CAPTURED.map((b) => JSON.parse(b) as Record<string, unknown>),
  RENDERER,
  { ...RENDERER, reason: 'oom', exitCode: undefined, screen: undefined, mission: undefined, commit: undefined, chrome: undefined },
  CHILD,
  { ...CHILD, process: 'Utility', service: 'Network Service', reason: 'killed', exitCode: 4294967295 },
  PAGE,
  { ...PAGE, kind: 'page_rejection', name: 'NonError', message: '', stack: undefined },
  MAIN,
  { ...MAIN, kind: 'main_rejection', stack: undefined },
  { ...PAGE, gpu: 'Software (no GPU)', platform: 'win32', arch: 'arm64' },
  { ...PAGE, gpu: 'Unknown', platform: 'darwin', arch: 'ia32', screen: 'tutorial', mission: 'beit_sahwan_0_tutorial' },
  { ...PAGE, stack: Array.from({ length: 16 }, () => 'f (web/a.js:1:1)') },
];

// Each one a real way a broken client would leak: a path with a user name, a URL query, an email, free text, a raw GPU
// string with a device id, a field the record does not have.
const INVALID: [string, unknown][] = [
  ['not an object', 'crashed'],
  ['an array', []],
  ['wrong version', { ...PAGE, v: 2 }],
  ['an unknown field (an IP)', { ...PAGE, ip: '203.0.113.9' }],
  ['an unknown field (a player id)', { ...PAGE, player: '0f8fad5b-d9cb-469f-a165-70867728950e' }],
  ['unknown kind', { ...PAGE, kind: 'hang' }],
  ['launch not a uuid', { ...PAGE, launch: 'dana-laptop' }],
  ['float uptime', { ...PAGE, uptimeS: 1.5 }],
  ['bad version', { ...PAGE, version: 'dev' }],
  ['bad commit', { ...PAGE, commit: 'HEAD' }],
  ['bad electron', { ...PAGE, electron: '45' }],
  ['bad chrome', { ...PAGE, chrome: '156' }],
  ['unknown platform', { ...PAGE, platform: 'android' }],
  ['unknown arch', { ...PAGE, arch: 'riscv64' }],
  ['a raw GPU string', { ...PAGE, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)' }],
  ['unknown screen', { ...PAGE, screen: 'settings' }],
  ['bad mission', { ...PAGE, mission: 'Beit Sahwan' }],
  ['a message with an email', { ...PAGE, message: 'from dana@example.com' }],
  ['a message with a POSIX path', { ...PAGE, message: 'ENOENT /home/dana/.config/x' }],
  ['a message with a Windows path', { ...PAGE, message: 'open C:\\Users\\Dana failed' }],
  ['a message with a UNC share', { ...PAGE, message: 'open \\\\server\\dana failed' }],
  ['a message with a URL', { ...PAGE, message: 'fetch app://roaring-lions.local/x failed' }],
  ['a message over 120', { ...PAGE, message: 'x'.repeat(121) }],
  ['a message with a newline', { ...PAGE, message: 'a\nb' }],
  ['a message with non-ASCII (a Hebrew name)', { ...PAGE, message: 'דנה' }],
  ['a name that is text', { ...PAGE, name: 'Dana said hi' }],
  ['a frame with an absolute POSIX path', { ...PAGE, stack: ['f (/home/dana/lions/main.mjs:1:1)'] }],
  ['a frame with a Windows path', { ...PAGE, stack: ['f (C:\\Users\\Dana\\lions\\main.mjs:1:1)'] }],
  ['a frame with the app URL unscrubbed', { ...PAGE, stack: ['f (app://roaring-lions.local/assets/a.js?tester=dana:1:1)'] }],
  ['a frame with a query', { ...PAGE, stack: ['f (web/assets/a.js?tester=dana:1:1)'] }],
  ['a frame with a file URL', { ...PAGE, stack: ['f (file:///home/dana/a.js:1:1)'] }],
  ['a frame with spaces in the name', { ...PAGE, stack: ['dana smith (web/a.js:1:1)'] }],
  ['a frame with no position', { ...PAGE, stack: ['f (web/a.js)'] }],
  ['a frame over 200', { ...PAGE, stack: [`f (web/${'a'.repeat(160)}:1234567:1234567)`.padEnd(201, 'x')] }],
  ['an empty stack', { ...PAGE, stack: [] }],
  ['17 frames', { ...PAGE, stack: Array.from({ length: 17 }, () => 'f (web/a.js:1:1)') }],
  ['a stack that is a string', { ...PAGE, stack: 'f (web/a.js:1:1)' }],
  ['a process report with no reason', { ...RENDERER, reason: undefined }],
  ['a clean exit is not a crash', { ...RENDERER, reason: 'clean-exit' }],
  ['a reason that is text', { ...RENDERER, reason: 'Crashed!' }],
  ['a process report carrying a message', { ...RENDERER, message: 'x' }],
  ['a process report carrying a stack', { ...RENDERER, stack: ['f (web/a.js:1:1)'] }],
  ['a renderer report naming a process', { ...RENDERER, process: 'GPU' }],
  ['a child report with no process', { ...CHILD, process: undefined }],
  ['a service with odd characters', { ...CHILD, service: 'C:\\x' }],
  ['exit code out of range', { ...CHILD, exitCode: 4294967296 }],
  ['an error report with no name', { ...PAGE, name: undefined }],
  ['an error report with no message', { ...PAGE, message: undefined }],
  ['an error report with a reason', { ...PAGE, reason: 'crashed' }],
  ['an error report with an exit code', { ...MAIN, exitCode: 1 }],
  ['an error report naming a service', { ...MAIN, service: 'Network Service' }],
];

const strip = (o: unknown): unknown => (o !== null && typeof o === 'object' && !Array.isArray(o) ? JSON.parse(JSON.stringify(o)) : o);

describe('crash_report.schema.json and crash-meta.ts agree', () => {
  it.each(VALID.map((v, i) => [i, v] as const))('valid fixture %i passes both', (_i, fx) => {
    const x = strip(fx);
    expect(validate(x), JSON.stringify(validate.errors)).toBe(true);
    expect(crashReportProblem(x)).toBeNull();
  });
  it.each(INVALID)('%s: refused by both', (_what, fx) => {
    const x = strip(fx);
    expect(validate(x)).toBe(false);
    expect(crashReportProblem(x)).not.toBeNull();
  });
});
