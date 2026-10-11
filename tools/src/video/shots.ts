/**
 * The storyboard as data: `docs/cinematics/shots.json`, one entry per shot,
 * each naming its source still, its prompt, and the takes planned at each
 * stage. `docs/cinematics/storyboard.md` is the human page; this file is what
 * `pnpm video -- estimate` prices and `generate --shot` sends, so the numbers
 * in the page are the tool's numbers and not a second sum kept by hand.
 *
 * Validation here is the shape a request needs; the CONTENT rules (no people,
 * no flags, no insignia, no text) are appended to every prompt by
 * `request.ts`, and the per-shot review checklist lives in the storyboard.
 */
import { readFileSync } from 'node:fs';
import { estimateTakeUsd, MODEL_KEYS, RESOLUTIONS, takeSpecProblem, type TakeSpec } from './pricing';

export const STAGES = ['explore', 'final'] as const;
export type Stage = (typeof STAGES)[number];

export interface StagePlan extends TakeSpec {
  readonly takes: number;
}

export interface Shot {
  readonly id: string;
  /** `intro`, a town id, or `regen` for a replacement of a shipped file. */
  readonly group: string;
  readonly title: string;
  /** Repo-relative path of the source still (image-to-video input). */
  readonly still: string;
  /** When true, the still is sent as BOTH the first and the last frame. */
  readonly loop: boolean;
  readonly prompt: string;
  /** Where the encoded result ships, under assets/ (or the intro's file). */
  readonly ships_as: string;
  readonly explore: StagePlan;
  readonly final: StagePlan;
  /** How `pnpm stills:cinematics` photographs `still`; not read by this CLI. */
  readonly capture?: { readonly sandbox: string; readonly tod: string; readonly at: readonly [number, number]; readonly zoom: number };
}

export interface Storyboard {
  readonly shots: readonly Shot[];
}

const SHOT_ID = /^[a-z0-9_]+$/;
const PROMPT_MAX = 1500;

function stageProblems(id: string, stage: Stage, plan: unknown): string[] {
  const p = plan as Partial<StagePlan> | undefined;
  if (!p || typeof p !== 'object') return [`${id}: ${stage} is missing`];
  const out: string[] = [];
  if (!(MODEL_KEYS as readonly unknown[]).includes(p.model)) out.push(`${id}: ${stage}.model "${String(p.model)}" is not one of ${MODEL_KEYS.join(', ')}`);
  if (!(RESOLUTIONS as readonly unknown[]).includes(p.resolution)) out.push(`${id}: ${stage}.resolution "${String(p.resolution)}" is unknown`);
  if (typeof p.seconds !== 'number') out.push(`${id}: ${stage}.seconds must be a number`);
  if (typeof p.takes !== 'number' || !Number.isInteger(p.takes) || p.takes < 0 || p.takes > 10) {
    out.push(`${id}: ${stage}.takes must be an integer 0..10`);
  }
  if (out.length === 0) {
    const problem = takeSpecProblem(p as StagePlan);
    if (problem !== null) out.push(`${id}: ${stage}: ${problem}`);
  }
  return out;
}

/** Every reason this storyboard cannot be priced or sent. Empty when clean. Pure. */
export function storyboardProblems(raw: unknown): string[] {
  const board = raw as { shots?: unknown };
  if (!board || !Array.isArray(board.shots)) return ['storyboard: "shots" must be an array'];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of board.shots as Partial<Shot>[]) {
    const id = typeof s?.id === 'string' ? s.id : '(no id)';
    if (!SHOT_ID.test(id)) out.push(`${id}: id must match ${SHOT_ID}`);
    if (seen.has(id)) out.push(`${id}: appears twice`);
    seen.add(id);
    for (const k of ['group', 'title', 'still', 'prompt', 'ships_as'] as const) {
      if (typeof s?.[k] !== 'string' || (s[k] as string).length === 0) out.push(`${id}: ${k} must be a non-empty string`);
    }
    if (typeof s?.loop !== 'boolean') out.push(`${id}: loop must be true or false`);
    if (typeof s?.prompt === 'string' && s.prompt.length > PROMPT_MAX) out.push(`${id}: prompt is over ${PROMPT_MAX} characters`);
    if (typeof s?.still === 'string' && !/\.(jpe?g|png)$/.test(s.still)) out.push(`${id}: still must be a .jpg or .png`);
    for (const stage of STAGES) out.push(...stageProblems(id, stage, s?.[stage]));
  }
  return out;
}

export function loadStoryboard(file: string): Storyboard {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const problems = storyboardProblems(raw);
  if (problems.length > 0) throw new Error(`${file}:\n  ${problems.join('\n  ')}`);
  return raw as Storyboard;
}

export const imagesFor = (shot: Shot): number => (shot.loop ? 2 : 1);

/** USD for one take of `shot` at `stage`, with the prompt length as sent. */
export function shotTakeUsd(shot: Shot, stage: Stage, promptChars: number): number {
  return estimateTakeUsd(shot[stage], { images: imagesFor(shot), promptChars });
}

export interface ShotEstimate {
  readonly id: string;
  readonly exploreUsd: number;
  readonly finalUsd: number;
  readonly totalUsd: number;
}

export function estimateShot(shot: Shot, promptChars: number): ShotEstimate {
  const exploreUsd = shot.explore.takes * shotTakeUsd(shot, 'explore', promptChars);
  const finalUsd = shot.final.takes * shotTakeUsd(shot, 'final', promptChars);
  return { id: shot.id, exploreUsd, finalUsd, totalUsd: exploreUsd + finalUsd };
}
