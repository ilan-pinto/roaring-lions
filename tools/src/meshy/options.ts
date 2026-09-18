/**
 * The shared vocabulary of the Meshy API surface this CLI drives -- the enums
 * the API contract fixes, plus the range/length guard rails the task brief
 * calls for explicitly ("refuse a prompt over 800 chars", "refuse
 * `--polycount` outside the documented range"). Kept separate from
 * `api-types.ts` (the request/response shapes) and `args.ts` (the flag
 * parser) so a constant used by both has exactly one definition.
 */

export const MODEL_TYPES = ['standard', 'smart-topology', 'lowpoly'] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

export const AI_MODELS = ['meshy-6-lite', 'meshy-6', 'meshy-7', 'latest'] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const TOPOLOGIES = ['quad', 'triangle'] as const;
export type Topology = (typeof TOPOLOGIES)[number];

export const POSE_MODES = ['a-pose', 't-pose', ''] as const;
export type PoseMode = (typeof POSE_MODES)[number];

export const TARGET_FORMATS = ['glb', 'obj', 'fbx', 'stl', 'usdz', '3mf'] as const;
export type TargetFormat = (typeof TARGET_FORMATS)[number];

export const TEXTURE_RESOLUTIONS = ['2k', '4k', '8k'] as const;
export type TextureResolution = (typeof TEXTURE_RESOLUTIONS)[number];

export const ORIGIN_ATS = ['bottom', 'center'] as const;
export type OriginAt = (typeof ORIGIN_ATS)[number];

export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_KINDS = ['text', 'image'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** A task is done, one way or another -- polling stops here. */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['SUCCEEDED', 'FAILED', 'CANCELED']);

export const PROMPT_MAX_CHARS = 800;

/**
 * Polycount range depends on `model_type`: `smart-topology` tops out at
 * 15,000, everything else at 300,000. Both floors are 100. Documented at
 * docs.meshy.ai (quoted in the task brief), not derived.
 */
export function polycountRange(modelType: ModelType): { min: number; max: number } {
  return modelType === 'smart-topology' ? { min: 100, max: 15000 } : { min: 100, max: 300000 };
}

export function assertPolycountInRange(polycount: number, modelType: ModelType): void {
  const { min, max } = polycountRange(modelType);
  if (!Number.isFinite(polycount) || !Number.isInteger(polycount) || polycount < min || polycount > max) {
    throw new Error(
      `--polycount ${polycount} is out of range for model-type "${modelType}" -- must be an integer in [${min}, ${max}]`
    );
  }
}

export function assertPromptLength(prompt: string): void {
  if (prompt.length === 0) {
    throw new Error('prompt must not be empty');
  }
  if (prompt.length > PROMPT_MAX_CHARS) {
    throw new Error(`prompt is ${prompt.length} chars, over the ${PROMPT_MAX_CHARS}-char Meshy limit`);
  }
}

function memberOf<T extends string>(values: readonly T[], value: string, label: string): T {
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`invalid ${label} "${value}" -- expected one of: ${values.join(', ')}`);
  }
  return value as T;
}

export const asModelType = (v: string): ModelType => memberOf(MODEL_TYPES, v, 'model-type');
export const asAiModel = (v: string): AiModel => memberOf(AI_MODELS, v, 'ai-model');
export const asTopology = (v: string): Topology => memberOf(TOPOLOGIES, v, 'topology');
export const asTextureResolution = (v: string): TextureResolution => memberOf(TEXTURE_RESOLUTIONS, v, 'tex');
export const asTaskKind = (v: string): TaskKind => memberOf(TASK_KINDS, v, 'kind');

/** Comma-separated `--formats glb,obj,fbx` -> a validated, de-duplicated list. */
export function parseTargetFormats(raw: string): TargetFormat[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) {
    throw new Error('--formats must name at least one format');
  }
  const out: TargetFormat[] = [];
  for (const part of parts) {
    const fmt = memberOf(TARGET_FORMATS, part, 'formats entry');
    if (!out.includes(fmt)) out.push(fmt);
  }
  return out;
}

/** The default polycount for a model type -- valid on its own range without a flag. */
export function defaultPolycount(modelType: ModelType): number {
  return modelType === 'smart-topology' ? 10000 : 30000;
}
