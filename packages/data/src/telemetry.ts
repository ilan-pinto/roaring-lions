/**
 * The telemetry event contract (WP-T1, spec docs/superpowers/specs/2026-09-24-telemetry-design.md).
 *
 * `data/schemas/telemetry_event.schema.json` is the authority. This file is its
 * hand-written twin for the two places that cannot carry Ajv: the browser bundle
 * (size) and the Worker (no `new Function` in the Workers runtime).
 * `telemetry.test.ts` runs every fixture through both and fails on any
 * disagreement, so a change to one without the other cannot pass.
 */

export const TELEMETRY_VERSION = 1;

export const TELEMETRY_EVENT_TYPES = [
  'session_start',
  'heartbeat',
  'tutorial_step',
  'mission_start',
  'objective',
  'mission_end',
  'campaign_progress',
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export const TELEMETRY_SCREENS = ['menu', 'campaign', 'brigade', 'mission', 'tutorial', 'sandbox', 'other'] as const;
export type TelemetryScreen = (typeof TELEMETRY_SCREENS)[number];

export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TESTER_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;
export const MISSION_PATTERN = /^[a-z0-9_]{1,64}$/;
export const BUILD_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
const OBJECTIVE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const OBJECTIVE_TYPE_PATTERN = /^[a-z_]{1,32}$/;
const CAUSE_PATTERN = /^(force_destroyed|roe_collapse|objective:[A-Za-z0-9_.-]{1,64})$/;

export interface TelemetryEnvelope {
  v: 1;
  player: string;
  session: string;
  tester?: string;
  build: string;
  /** Client epoch milliseconds. */
  t: number;
  /** Present only on sandbox traffic, which `/stats` excludes by default. */
  dev?: true;
}

export type TelemetryEvent = TelemetryEnvelope &
  (
    | { type: 'session_start'; screen: TelemetryScreen; renderer: 'three' | 'pixi'; viewport: [number, number]; returning: boolean }
    | { type: 'heartbeat'; mission: string; tick: number }
    | { type: 'tutorial_step'; step: number; steps: number; prevMs: number }
    | { type: 'mission_start'; mission: string; replay: boolean }
    | {
        type: 'objective';
        mission: string;
        objective: string;
        objectiveType: string;
        primary: boolean;
        status: 'complete' | 'failed';
        tick: number;
      }
    | {
        type: 'mission_end';
        mission: string;
        result: 'victory' | 'defeat' | 'abandoned';
        /** `force_destroyed`, `roe_collapse` or `objective:<id>`; defeats only. */
        cause?: string;
        tick: number;
        roe: number;
        fielded: number;
        lost: number;
        objectivesDone: number;
        objectivesTotal: number;
      }
    | { type: 'campaign_progress'; mission: string; missionsWon: number }
  );

type Rec = Record<string, unknown>;
const ENVELOPE_KEYS = ['v', 'type', 'player', 'session', 'tester', 'build', 't', 'dev'];
const BODY_KEYS: Record<TelemetryEventType, readonly string[]> = {
  session_start: ['screen', 'renderer', 'viewport', 'returning'],
  heartbeat: ['mission', 'tick'],
  tutorial_step: ['step', 'steps', 'prevMs'],
  mission_start: ['mission', 'replay'],
  objective: ['mission', 'objective', 'objectiveType', 'primary', 'status', 'tick'],
  mission_end: ['mission', 'result', 'cause', 'tick', 'roe', 'fielded', 'lost', 'objectivesDone', 'objectivesTotal'],
  campaign_progress: ['mission', 'missionsWon'],
};

const isInt = (x: unknown, min: number, max: number): boolean =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const matches = (x: unknown, re: RegExp): boolean => typeof x === 'string' && re.test(x);
const isBool = (x: unknown): boolean => typeof x === 'boolean';
const TICK_MAX = 1_000_000_000;
const COUNT_MAX = 100_000;

function bodyValid(e: Rec, type: TelemetryEventType): boolean {
  switch (type) {
    case 'session_start':
      return (
        (TELEMETRY_SCREENS as readonly unknown[]).includes(e.screen) &&
        (e.renderer === 'three' || e.renderer === 'pixi') &&
        Array.isArray(e.viewport) &&
        e.viewport.length === 2 &&
        e.viewport.every((n) => isInt(n, 0, 20000)) &&
        isBool(e.returning)
      );
    case 'heartbeat':
      return matches(e.mission, MISSION_PATTERN) && isInt(e.tick, 0, TICK_MAX);
    case 'tutorial_step':
      return isInt(e.step, 0, 200) && isInt(e.steps, 1, 200) && isInt(e.prevMs, 0, Number.MAX_SAFE_INTEGER);
    case 'mission_start':
      return matches(e.mission, MISSION_PATTERN) && isBool(e.replay);
    case 'objective':
      return (
        matches(e.mission, MISSION_PATTERN) &&
        matches(e.objective, OBJECTIVE_PATTERN) &&
        matches(e.objectiveType, OBJECTIVE_TYPE_PATTERN) &&
        isBool(e.primary) &&
        (e.status === 'complete' || e.status === 'failed') &&
        isInt(e.tick, 0, TICK_MAX)
      );
    case 'mission_end':
      return (
        matches(e.mission, MISSION_PATTERN) &&
        (e.result === 'victory' || e.result === 'defeat' || e.result === 'abandoned') &&
        (e.cause === undefined || matches(e.cause, CAUSE_PATTERN)) &&
        isInt(e.tick, 0, TICK_MAX) &&
        isInt(e.roe, 0, 100) &&
        isInt(e.fielded, 0, COUNT_MAX) &&
        isInt(e.lost, 0, COUNT_MAX) &&
        isInt(e.objectivesDone, 0, COUNT_MAX) &&
        isInt(e.objectivesTotal, 0, COUNT_MAX)
      );
    case 'campaign_progress':
      return matches(e.mission, MISSION_PATTERN) && isInt(e.missionsWon, 0, COUNT_MAX);
  }
}

export function isTelemetryEvent(x: unknown): x is TelemetryEvent {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const e = x as Rec;
  if (!(TELEMETRY_EVENT_TYPES as readonly unknown[]).includes(e.type)) return false;
  const type = e.type as TelemetryEventType;
  const allowed = new Set([...ENVELOPE_KEYS, ...BODY_KEYS[type]]);
  for (const k of Object.keys(e)) if (!allowed.has(k)) return false;
  const required = BODY_KEYS[type].filter((k) => k !== 'cause');
  for (const k of required) if (!(k in e)) return false;
  if (e.v !== TELEMETRY_VERSION) return false;
  if (!matches(e.player, ID_PATTERN) || !matches(e.session, ID_PATTERN)) return false;
  if (e.tester !== undefined && !matches(e.tester, TESTER_PATTERN)) return false;
  if (!matches(e.build, BUILD_PATTERN)) return false;
  if (!isInt(e.t, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (e.dev !== undefined && e.dev !== true) return false;
  return bodyValid(e, type);
}
