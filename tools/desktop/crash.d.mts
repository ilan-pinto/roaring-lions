// Types for crash.mjs, so tools/src/desktop_crash.test.ts typechecks.
export type CrashKind = 'renderer_gone' | 'child_gone' | 'main_exception' | 'main_rejection' | 'page_exception' | 'page_rejection';
export type CrashRecord = Record<string, unknown> & { v: 1; kind: CrashKind; stack?: string[] };
export interface CrashContext {
  build: unknown;
  versions: Record<string, string | undefined>;
  platform: string;
  arch: string;
  gpu: string;
  launch: string;
  now: number;
  uptimeMs: number;
  url?: string;
  appOrigin: string;
}
export declare const CRASH_ORIGIN: string;
export declare const CRASH_ENDPOINT: string;
export declare const CRASH_VERSION: 1;
export declare const OPTOUT_KEY: string;
export declare const OPTOUT_PROBE: string;
export declare const GPU_PROBE: string;
export declare const CRASH_USER_AGENT: string;
export declare const CRASH_KINDS: readonly CrashKind[];
export declare const GONE_KINDS: readonly CrashKind[];
export declare const SCREENS: readonly string[];
export declare const BODY_MAX_BYTES: number;
export declare const FRAMES_MAX: number;
export declare const FRAME_MAX: number;
export declare const MESSAGE_MAX: number;
export declare const OFF_SWITCH: string;
export declare const OFF_ENV: string;
export declare function crashMode(o: {
  build: unknown;
  env: Record<string, string | undefined>;
  argv: readonly string[];
  isPackaged: boolean;
  smoke: boolean;
}): 'send' | 'record' | 'off';
export declare function crashDestination(mode: string, env: Record<string, string | undefined>): string | null;
export declare function optedOutValue(v: unknown): boolean;
export declare function scrubMessage(raw: unknown): string;
export declare function scrubFunctionName(raw: unknown): string;
export declare function scrubLocation(raw: unknown, appOrigin: string): string;
export declare function framesFromV8Stack(stack: unknown, appOrigin: string): string[];
export declare function framesFromCdp(callFrames: unknown, appOrigin: string): string[];
export declare function errorName(value: unknown): string;
export declare function gpuFamily(gpu: string | null | undefined): string;
export declare function gpuFamilyFromInfo(info: unknown): string;
export declare function screenOf(url: unknown, appOrigin: string): { screen?: string; mission?: string };
export declare function envelope(kind: string, ctx: CrashContext): CrashRecord | null;
export declare function goneRecord(kind: string, details: unknown, ctx: CrashContext): CrashRecord | null;
export declare function mainErrorRecord(err: unknown, origin: string, ctx: CrashContext): CrashRecord | null;
export declare function pageErrorRecord(details: unknown, ctx: CrashContext): CrashRecord | null;
export declare function fitRecord(rec: CrashRecord): string | null;
export declare function launchBudget(o?: { max?: number; page?: number }): { take(rec: CrashRecord): boolean };
export declare const OUTBOX_MAX: number;
export declare const OUTBOX_MAX_AGE_MS: number;
export interface Outbox {
  optedOut(): boolean;
  setOptedOut(on: boolean): void;
  add(body: string, now: number): boolean;
  pending(now: number): { at: number; body: string }[];
  remove(at: number, body: string): void;
}
export declare function outbox(io: { read(): string | null; write(text: string): void }): Outbox;
export declare function sendOutcome(status: number): 'sent' | 'drop' | 'retry';
export declare function drain(o: {
  box: Outbox;
  post(url: string, body: string): Promise<number>;
  url: string;
  now: number;
  optedOut(): boolean;
}): Promise<('sent' | 'drop')[]>;
