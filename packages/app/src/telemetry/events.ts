import type { TelemetryEnvelope, TelemetryEvent, TelemetryScreen } from '@lions/data/telemetry';
import type { DefeatCause } from '@lions/sim';

/** What the builders read from a live mission. Built by the caller from
 *  `MissionRuntime` and `sim.tickCount` -- a read, never a write (invariant 4). */
export interface RuntimeView {
  tick: number;
  result: 'ongoing' | 'victory' | 'defeat';
  defeatCause: DefeatCause | undefined;
  roe: number;
  fielded: number;
  lost: number;
  objectives: readonly { id: string; type: string; primary: boolean; status: 'active' | 'complete' | 'failed' }[];
}

const int = (n: number): number => Math.max(0, Math.round(n));

export function causeString(c: DefeatCause | undefined): string | undefined {
  if (c === undefined) return undefined;
  return typeof c === 'string' ? c : `objective:${c.objective}`;
}

export function screenFor(pathname: string, base: string, tutorialId: string): TelemetryScreen {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  const [head, id] = rest.split('/');
  switch (head) {
    case '':
      return 'menu';
    case 'campaign':
      return 'campaign';
    case 'brigade':
      return 'brigade';
    case 'free-play':
      return 'sandbox';
    case 'mission':
      return id === tutorialId ? 'tutorial' : 'mission';
    default:
      return 'other';
  }
}

export const sessionStart = (
  env: TelemetryEnvelope,
  screen: TelemetryScreen,
  renderer: 'three' | 'pixi',
  viewport: [number, number],
  returning: boolean
): TelemetryEvent => ({ ...env, type: 'session_start', screen, renderer, viewport: [int(viewport[0]), int(viewport[1])], returning });

export const heartbeat = (env: TelemetryEnvelope, mission: string, tick: number): TelemetryEvent => ({
  ...env, type: 'heartbeat', mission, tick: int(tick),
});

export const tutorialStep = (env: TelemetryEnvelope, step: number, steps: number, prevMs: number): TelemetryEvent => ({
  ...env, type: 'tutorial_step', step: int(step), steps: int(steps), prevMs: int(prevMs),
});

export const missionStart = (env: TelemetryEnvelope, mission: string, replay: boolean): TelemetryEvent => ({
  ...env, type: 'mission_start', mission, replay,
});

export function objectiveEvent(
  env: TelemetryEnvelope,
  mission: string,
  view: RuntimeView,
  objectiveId: string,
  status: 'complete' | 'failed',
  tick: number
): TelemetryEvent | null {
  const o = view.objectives.find((x) => x.id === objectiveId);
  if (!o) return null;
  return { ...env, type: 'objective', mission, objective: o.id, objectiveType: o.type, primary: o.primary, status, tick: int(tick) };
}

export function missionEnd(env: TelemetryEnvelope, mission: string, view: RuntimeView, abandoned: boolean): TelemetryEvent {
  const result = abandoned || view.result === 'ongoing' ? 'abandoned' : view.result;
  const cause = result === 'defeat' ? causeString(view.defeatCause) : undefined;
  return {
    ...env,
    type: 'mission_end',
    mission,
    result,
    ...(cause === undefined ? {} : { cause }),
    tick: int(view.tick),
    roe: Math.min(100, int(view.roe)),
    fielded: int(view.fielded),
    lost: int(view.lost),
    objectivesDone: view.objectives.filter((o) => o.status === 'complete').length,
    objectivesTotal: view.objectives.length,
  };
}

export const campaignProgress = (env: TelemetryEnvelope, mission: string, missionsWon: number): TelemetryEvent => ({
  ...env, type: 'campaign_progress', mission, missionsWon: int(missionsWon),
});
