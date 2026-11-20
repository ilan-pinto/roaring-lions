/**
 * The body of POST /api/crash (GH-1414): one desktop crash report.
 *
 * `data/schemas/crash_report.schema.json` is the authority the desktop client (`tools/desktop/crash.mjs`) builds
 * against. This file is its hand-written twin for the Worker, which cannot run Ajv (no `new Function` in the Workers
 * runtime), the same arrangement as `feedback-meta.ts`. `crash-meta.test.ts` runs every fixture through both and fails on
 * any disagreement. The one rule the schema cannot say lives only here and in its description: the body is at most
 * CRASH_BODY_MAX_BYTES.
 *
 * The record is a whitelist on purpose: every field is an enum, a number or a pattern-bounded string, and a stack frame
 * may only name a location INSIDE the game (`web/...`, `asar/...`, `node:...`) or a placeholder. A path with a user name,
 * a URL with a query, an email or free text cannot pass the patterns, so the Worker refuses a client that failed to
 * scrub rather than storing what it sent.
 */
import { BUILD_PATTERN, ERROR_MESSAGE_PATTERN, ERROR_NAME_PATTERN, GPU_PATTERN, ID_PATTERN, MISSION_PATTERN, TELEMETRY_SCREENS } from '@lions/data/telemetry';
import { COMMIT_PATTERN } from './feedback-meta';

export const CRASH_VERSION = 1;
export const CRASH_KINDS = ['renderer_gone', 'child_gone', 'main_exception', 'main_rejection', 'page_exception', 'page_rejection'] as const;
export type CrashKind = (typeof CRASH_KINDS)[number];
const GONE: readonly CrashKind[] = ['renderer_gone', 'child_gone'];
export const CRASH_PLATFORMS = ['linux', 'win32', 'darwin'] as const;
export const CRASH_ARCHES = ['x64', 'arm64', 'ia32'] as const;

/** Bytes. The desktop client trims its stack to fit (`crash.mjs` `fitRecord`). */
export const CRASH_BODY_MAX_BYTES = 6144;
export const CRASH_FRAMES_MAX = 16;
export const CRASH_FRAME_MAX = 200;

export const SEMVER_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
export const CHROME_PATTERN = /^[0-9]{1,4}(\.[0-9]{1,6}){3}$/;
export const REASON_PATTERN = /^[a-z][a-z-]{0,23}$/;
export const LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9 ._-]{0,47}$/;
export const FRAME_PATTERN =
  /^[A-Za-z0-9_$.<>]{1,64} \((web\/[A-Za-z0-9_./-]{1,160}|asar\/[A-Za-z0-9_./-]{1,160}|node:[A-Za-z0-9_/.-]{1,80}|<native>|<other>):[0-9]{1,7}:[0-9]{1,7}\)$/;
const UPTIME_MAX = 10_000_000;
/** The message's second lock (the schema's `not`): an email, a URL, a POSIX path of two segments or more, a Windows drive
 *  path or a UNC share means the client's scrubber failed, and the report is refused rather than stored. */
export const MESSAGE_LEAK_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+|:\/\/|(\/[^\s/]+){2,}|[A-Za-z]:\\|\\\\/;

export interface CrashReport {
  v: 1;
  t: number;
  kind: CrashKind;
  launch: string;
  uptimeS: number;
  version: string;
  commit?: string;
  electron: string;
  chrome?: string;
  platform: (typeof CRASH_PLATFORMS)[number];
  arch: (typeof CRASH_ARCHES)[number];
  gpu: string;
  screen?: (typeof TELEMETRY_SCREENS)[number];
  mission?: string;
  reason?: string;
  exitCode?: number;
  process?: string;
  service?: string;
  name?: string;
  message?: string;
  stack?: string[];
}

type Rec = Record<string, unknown>;
const KEYS = new Set([
  'v', 't', 'kind', 'launch', 'uptimeS', 'version', 'commit', 'electron', 'chrome', 'platform', 'arch', 'gpu',
  'screen', 'mission', 'reason', 'exitCode', 'process', 'service', 'name', 'message', 'stack',
]);
const isInt = (x: unknown, min: number, max: number): boolean => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const matches = (x: unknown, re: RegExp): boolean => typeof x === 'string' && re.test(x);
const oneOf = (x: unknown, xs: readonly string[]): boolean => typeof x === 'string' && xs.includes(x);
const optional = (e: Rec, k: string, ok: (v: unknown) => boolean): boolean => e[k] === undefined || ok(e[k]);
const absent = (e: Rec, ...ks: string[]): boolean => ks.every((k) => !(k in e));

/** Null when valid, otherwise a short reason (it goes back in the 400 body). */
export function crashReportProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'not an object';
  const e = x as Rec;
  for (const k of Object.keys(e)) if (!KEYS.has(k)) return 'unknown field';
  if (e.v !== CRASH_VERSION) return 'v';
  if (!isInt(e.t, 0, Number.MAX_SAFE_INTEGER)) return 't';
  if (!oneOf(e.kind, CRASH_KINDS)) return 'kind';
  if (!matches(e.launch, ID_PATTERN)) return 'launch';
  if (!isInt(e.uptimeS, 0, UPTIME_MAX)) return 'uptimeS';
  if (!matches(e.version, BUILD_PATTERN)) return 'version';
  if (!optional(e, 'commit', (v) => matches(v, COMMIT_PATTERN))) return 'commit';
  if (!matches(e.electron, SEMVER_PATTERN)) return 'electron';
  if (!optional(e, 'chrome', (v) => matches(v, CHROME_PATTERN))) return 'chrome';
  if (!oneOf(e.platform, CRASH_PLATFORMS)) return 'platform';
  if (!oneOf(e.arch, CRASH_ARCHES)) return 'arch';
  if (!matches(e.gpu, GPU_PATTERN)) return 'gpu';
  if (!optional(e, 'screen', (v) => oneOf(v, TELEMETRY_SCREENS))) return 'screen';
  if (!optional(e, 'mission', (v) => matches(v, MISSION_PATTERN))) return 'mission';
  if (!optional(e, 'reason', (v) => matches(v, REASON_PATTERN) && v !== 'clean-exit')) return 'reason';
  if (!optional(e, 'exitCode', (v) => isInt(v, -2147483648, 4294967295))) return 'exitCode';
  if (!optional(e, 'process', (v) => matches(v, LABEL_PATTERN))) return 'process';
  if (!optional(e, 'service', (v) => matches(v, LABEL_PATTERN))) return 'service';
  if (!optional(e, 'name', (v) => matches(v, ERROR_NAME_PATTERN))) return 'name';
  if (!optional(e, 'message', (v) => matches(v, ERROR_MESSAGE_PATTERN) && !MESSAGE_LEAK_PATTERN.test(v as string))) return 'message';
  const s = e.stack;
  if (s !== undefined) {
    if (!Array.isArray(s) || s.length < 1 || s.length > CRASH_FRAMES_MAX) return 'stack';
    if (!s.every((f) => typeof f === 'string' && f.length <= CRASH_FRAME_MAX && FRAME_PATTERN.test(f))) return 'stack frame';
  }
  const gone = GONE.includes(e.kind as CrashKind);
  if (gone) {
    if (e.reason === undefined) return 'reason missing';
    if (!absent(e, 'name', 'message', 'stack')) return 'error fields on a process report';
  } else {
    if (e.name === undefined || e.message === undefined) return 'name or message missing';
    if (!absent(e, 'reason', 'exitCode', 'process', 'service')) return 'process fields on an error report';
  }
  if (e.kind === 'child_gone' ? e.process === undefined : !absent(e, 'process', 'service')) return 'process';
  return null;
}

export const isCrashReport = (x: unknown): x is CrashReport => crashReportProblem(x) === null;
