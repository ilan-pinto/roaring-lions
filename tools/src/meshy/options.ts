/**
 * The shared vocabulary of the Meshy API surface this CLI drives -- the enums
 * the API contract fixes, plus the range/length guard rails the task brief
 * calls for explicitly ("refuse a prompt over 800 chars", "refuse
 * `--polycount` outside the documented range"). Kept separate from
 * `api-types.ts` (the request/response shapes) and `args.ts` (the flag
 * parser) so a constant used by both has exactly one definition.
 */

/**
 * `model_type`, as the text-to-3d and image-to-3d pages list it (re-read 2026-11-09): `standard` or `smart-topology`.
 * `lowpoly` was retired by Meshy on 2026-10-30 and is no longer a valid value, so it is refused here rather than sent.
 */
export const MODEL_TYPES = ['standard', 'smart-topology'] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

/** `ai_model` values valid under `model_type: standard` (2026-11-09). `meshy-7` is deprecated by Meshy (it now runs as
 *  `meshy-7.1`) but still accepted, so it stays. `latest` is Meshy 7.1. */
export const STANDARD_AI_MODELS = ['meshy-6-lite', 'meshy-6', 'meshy-7.1', 'meshy-7', 'latest'] as const;
/** `ai_model` values valid under `model_type: smart-topology` (2026-11-09); `meshy-t2.5` is the API's default there. */
export const SMART_TOPOLOGY_AI_MODELS = ['meshy-t2', 'meshy-t2.5'] as const;
export const AI_MODELS = [...STANDARD_AI_MODELS, ...SMART_TOPOLOGY_AI_MODELS] as const;
export type AiModel = (typeof AI_MODELS)[number];

/**
 * The `ai_model` a command sends when `--ai-model` is not given. `standard` keeps this CLI's long-standing `meshy-6`
 * (the API's own default is `latest`; changing ours would re-price nothing but would change every unflagged call's
 * model). `smart-topology` takes the API's default, `meshy-t2.5`: before 2026-11-09 the CLI sent `meshy-6` with
 * `smart-topology`, a pairing the API does not list.
 */
export function defaultAiModel(modelType: ModelType): AiModel {
  return modelType === 'smart-topology' ? 'meshy-t2.5' : 'meshy-6';
}

/** Refuse an `ai_model` that does not belong to the `model_type` (e.g. `meshy-6` under `smart-topology`). */
export function assertModelPairing(modelType: ModelType, aiModel: AiModel): void {
  const allowed: readonly string[] = modelType === 'smart-topology' ? SMART_TOPOLOGY_AI_MODELS : STANDARD_AI_MODELS;
  if (!allowed.includes(aiModel)) {
    throw new Error(
      `--ai-model ${aiModel} is not a ${modelType} model -- under model-type "${modelType}" it must be one of: ${allowed.join(', ')}`
    );
  }
}

/** Smart Topology accepts only triangle output (the API answers 400 to `quad` with `meshy-t2` / `meshy-t2.5`). */
export function assertTopologyForModel(modelType: ModelType, topology: 'quad' | 'triangle'): void {
  if (modelType === 'smart-topology' && topology !== 'triangle') {
    throw new Error(`--topology ${topology} is not accepted by model-type "smart-topology" -- it outputs triangles only`);
  }
}

export const TOPOLOGIES = ['quad', 'triangle'] as const;
export type Topology = (typeof TOPOLOGIES)[number];

export const POSE_MODES = ['a-pose', 't-pose', ''] as const;
export type PoseMode = (typeof POSE_MODES)[number];

/** What `--pose` accepts. `none` is the flag's spelling of the API's empty
 *  `pose_mode` (no pose constraint), so the default stays today's behaviour. */
export const POSE_FLAGS = ['a-pose', 't-pose', 'none'] as const;
export type PoseFlag = (typeof POSE_FLAGS)[number];

/** `--pose` value -> the API's `pose_mode`: `none` -> `''`, the rest verbatim. */
export function poseModeFor(pose: PoseFlag): PoseMode {
  return pose === 'none' ? '' : pose;
}

export const TARGET_FORMATS = ['glb', 'obj', 'fbx', 'stl', 'usdz', '3mf'] as const;
export type TargetFormat = (typeof TARGET_FORMATS)[number];

export const TEXTURE_RESOLUTIONS = ['2k', '4k', '8k'] as const;
export type TextureResolution = (typeof TEXTURE_RESOLUTIONS)[number];

export const ORIGIN_ATS = ['bottom', 'center'] as const;
export type OriginAt = (typeof ORIGIN_ATS)[number];

export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** `image` is image-to-3D (the CLI's oldest command); `t2i` / `i2i` are the image GENERATORS (text-to-image,
 *  image-to-image, GH-746 SC2). */
export const TASK_KINDS = ['text', 'image', 'remesh', 't2i', 'i2i'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** A task is done, one way or another -- polling stops here. */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['SUCCEEDED', 'FAILED', 'CANCELED']);

export const PROMPT_MAX_CHARS = 800;

/**
 * Polycount range, from the text-to-3d page (re-read 2026-11-09): standard remesh 100-300,000; `meshy-t2` 100-15,000;
 * `meshy-t2.5` 100-30,000. With no `aiModel`, a model type's range is its default model's -- except that
 * `smart-topology` with no model named stays at the narrower `meshy-t2` ceiling, so a value valid for it is valid for
 * either Smart Topology model.
 */
export function polycountRange(modelType: ModelType, aiModel?: AiModel): { min: number; max: number } {
  if (modelType !== 'smart-topology') return { min: 100, max: 300000 };
  return aiModel === 'meshy-t2.5' ? { min: 100, max: 30000 } : { min: 100, max: 15000 };
}

export function assertPolycountInRange(polycount: number, modelType: ModelType, aiModel?: AiModel): void {
  const { min, max } = polycountRange(modelType, aiModel);
  if (!Number.isFinite(polycount) || !Number.isInteger(polycount) || polycount < min || polycount > max) {
    throw new Error(
      `--polycount ${polycount} is out of range for model-type "${modelType}"${aiModel ? ` (${aiModel})` : ''} -- must be an integer in [${min}, ${max}]`
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
export const asPoseFlag = (v: string): PoseFlag => memberOf(POSE_FLAGS, v, 'pose');
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
