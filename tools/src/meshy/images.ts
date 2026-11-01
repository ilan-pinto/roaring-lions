/**
 * Meshy IMAGE generation, the store-card pipeline's generator (GH-746 SC2): `t2i` (text-to-image) and `i2i`
 * (image-to-image). Pure: flag parsing, request building, reference resolution and the provenance line. Nothing
 * here touches the network or the key; `cli.ts` does that.
 *
 * Facts this file encodes, from https://docs.meshy.ai/en/api/{text-to-image,image-to-image,pricing} read on
 * 2026-11-01 (the API has no pricing endpoint, so these are quoted, not fetched):
 *
 * - `POST /openapi/v1/text-to-image` takes `ai_model`, `prompt`, `aspect_ratio`, `pose_mode`,
 *   `generate_multi_view`, `remove_background`. It takes NO reference image.
 * - `POST /openapi/v1/image-to-image` takes `ai_model`, `prompt`, ONE of `reference_image_urls` (1-5, each a public
 *   URL or a data URI, .jpg/.jpeg/.png/.webp, <= 20 MB, >= 32 x 32) or `input_task_id`, plus `aspect_ratio`,
 *   `generate_multi_view`, `remove_background`. **If both references and `input_task_id` are sent, Meshy uses
 *   `input_task_id` and drops the references.** So "edit the approved base card AND look at the tier's guide" has
 *   to pass BOTH as `reference_image_urls`; this parser refuses the combination rather than let a reference vanish.
 * - There is NO `negative_prompt` field on either image endpoint (the 3D text endpoint has one; these do not). The
 *   style brief's negative list therefore goes into the prompt text. `--negative` appends "Avoid: ...".
 * - `3:2` and `2:3` exist on the GPT Image models only; a nano-banana model answers 400. 1:1, 16:9, 9:16, 4:3 and
 *   3:4 are common. `aspect_ratio` and `generate_multi_view` cannot be sent together (400).
 * - `nano-banana-pro` needs a Pro plan or higher (402 below it), and so does `pose_mode` on a nano-banana model,
 *   which Meshy quietly runs as nano-banana-pro.
 * - Output size is not documented (the pilot measures it); the result is `image_urls`.
 * - Free-plan task creation is refused by Meshy ("no longer supported", 1 Nov), and free-plan output is Meshy's own
 *   (terms 3.2). A card is generated on a paid plan and the plan is recorded per task (G-C5), so `--plan free` is
 *   refused here and a real spend with no plan named is refused too.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertYesOrInteractive, parseKnownFlags } from './args';
import { isHttpUrl } from './naming';
import { asPoseFlag, type PoseFlag, type TaskStatus } from './options';

export const IMAGE_MODELS = [
  'nano-banana',
  'nano-banana-2',
  'nano-banana-2-lite',
  'nano-banana-pro',
  'gpt-image-2',
  'gpt-image-2-5-flare',
  'gpt-image-2-5-sunburst',
] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];

export const GPT_IMAGE_MODELS: ReadonlySet<ImageModel> = new Set(['gpt-image-2', 'gpt-image-2-5-flare', 'gpt-image-2-5-sunburst']);

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
const GPT_ONLY_RATIOS: ReadonlySet<AspectRatio> = new Set(['3:2', '2:3']);

export const MAX_REFERENCES = 5;
export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
export const REFERENCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

/** Plans that may spend. `free` is refused (see the header). The names are Meshy's tiers, lower-cased. */
export const PLAN_RE = /^[a-z0-9][a-z0-9-]*$/;

function memberOf<T extends string>(values: readonly T[], value: string, label: string): T {
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`invalid ${label} "${value}" -- expected one of: ${values.join(', ')}`);
  }
  return value as T;
}

export const asImageModel = (v: string): ImageModel => memberOf(IMAGE_MODELS, v, 'model');
export const asAspectRatio = (v: string): AspectRatio => memberOf(ASPECT_RATIOS, v, 'aspect');

export function assertAspectForModel(aspect: AspectRatio, model: ImageModel): void {
  if (GPT_ONLY_RATIOS.has(aspect) && !GPT_IMAGE_MODELS.has(model)) {
    throw new Error(
      `--aspect ${aspect} is for the GPT Image models only (${[...GPT_IMAGE_MODELS].join(', ')}); ${model} answers 400 -- use 4:3 or 3:4 with a nano-banana model`
    );
  }
}

export function parsePlan(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const plan = raw.trim().toLowerCase();
  if (!PLAN_RE.test(plan)) throw new Error(`invalid plan "${raw}" -- expected a tier name such as pro`);
  if (plan === 'free') {
    throw new Error('--plan free refused: task creation is not supported on the free plan, and a free-plan output is Meshy-owned (terms 3.2); generate on a paid plan');
  }
  return plan;
}

/** The model Meshy will actually run, and so the price: a pose on a nano-banana model runs nano-banana-pro. */
export function effectiveImageModel(model: ImageModel, pose: PoseFlag): ImageModel {
  if (pose !== 'none' && (model === 'nano-banana' || model === 'nano-banana-pro')) return 'nano-banana-pro';
  return model;
}

// ---------------------------------------------------------------------------
// request bodies
// ---------------------------------------------------------------------------

export interface TextToImageRequest {
  readonly ai_model: ImageModel;
  readonly prompt: string;
  readonly aspect_ratio?: AspectRatio;
  readonly pose_mode?: 'a-pose' | 't-pose';
  readonly generate_multi_view?: boolean;
  readonly remove_background?: boolean;
}

export interface ImageToImageRequest {
  readonly ai_model: ImageModel;
  readonly prompt: string;
  readonly reference_image_urls?: readonly string[];
  readonly input_task_id?: string;
  readonly aspect_ratio?: AspectRatio;
  readonly generate_multi_view?: boolean;
  readonly remove_background?: boolean;
}

export interface ImageGenTask {
  readonly id: string;
  readonly type?: 'text-to-image' | 'image-to-image';
  readonly ai_model?: string;
  readonly prompt?: string;
  readonly status: TaskStatus;
  readonly progress: number;
  readonly image_urls?: readonly string[];
  readonly task_error?: { readonly message: string };
  readonly consumed_credits?: number;
  readonly created_at?: number;
  readonly started_at?: number;
  readonly finished_at?: number;
  readonly expires_at?: number;
}

/** What the prompt actually carries: the brief, then the negative list as one sentence (the API has no field). */
export function composePrompt(prompt: string, negative: string | undefined): string {
  const base = prompt.trim();
  if (!negative || negative.trim().length === 0) return base;
  return `${base}\n\nAvoid: ${negative.trim().replace(/[.\s]+$/, '')}.`;
}

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

// ---------------------------------------------------------------------------
// flags
// ---------------------------------------------------------------------------

const COMMON_VALUED: readonly string[] = ['model', 'aspect', 'name', 'negative', 'plan'];
const COMMON_BOOLEAN: readonly string[] = ['multi-view', 'remove-background', 'yes', 'json'];

export interface ImageGenCommon {
  readonly model: ImageModel;
  readonly aspect: AspectRatio | undefined;
  readonly name: string | undefined;
  readonly negative: string | undefined;
  readonly plan: string | undefined;
  readonly multiView: boolean;
  readonly removeBackground: boolean;
  readonly yes: boolean;
  readonly json: boolean;
}

function parseCommon(options: ReadonlyMap<string, string>): ImageGenCommon {
  const model = options.has('model') ? asImageModel(options.get('model') as string) : 'nano-banana-2';
  const aspect = options.has('aspect') ? asAspectRatio(options.get('aspect') as string) : undefined;
  const multiView = options.get('multi-view') === 'true';
  if (aspect !== undefined) assertAspectForModel(aspect, model);
  if (aspect !== undefined && multiView) {
    throw new Error('--aspect and --multi-view cannot be sent together (Meshy answers 400); drop one');
  }
  return {
    model,
    aspect,
    name: options.get('name'),
    negative: options.get('negative'),
    plan: parsePlan(options.get('plan')),
    multiView,
    removeBackground: options.get('remove-background') === 'true',
    yes: options.get('yes') === 'true',
    json: options.get('json') === 'true',
  };
}

export interface T2iOptions extends ImageGenCommon {
  readonly prompt: string;
  readonly pose: PoseFlag;
}

export function parseT2iArgs(argv: readonly string[], ctx: { readonly isTTY: boolean }): T2iOptions {
  const { positionals, options } = parseKnownFlags(argv, {
    boolean: new Set(COMMON_BOOLEAN),
    valued: new Set([...COMMON_VALUED, 'pose']),
  });
  if (positionals.length === 0) throw new Error('t2i: missing required <prompt> argument');
  if (positionals.length > 1) {
    throw new Error(`t2i: unexpected extra argument(s): ${positionals.slice(1).join(' ')} (quote the prompt as one argument)`);
  }
  if (positionals[0].trim().length === 0) throw new Error('prompt must not be empty');
  const common = parseCommon(options);
  const pose = options.has('pose') ? asPoseFlag(options.get('pose') as string) : 'none';
  if (pose !== 'none' && common.aspect !== undefined && !GPT_IMAGE_MODELS.has(effectiveImageModel(common.model, pose))) {
    throw new Error(`--pose makes Meshy ignore --aspect on ${common.model} (the image is always 3:4); drop --aspect`);
  }
  assertYesOrInteractive(common.yes, ctx.isTTY);
  return { ...common, prompt: positionals[0], pose };
}

export interface I2iOptions extends ImageGenCommon {
  readonly prompt: string;
  /** 1-5 local paths or https URLs; empty when `fromTask` is set. */
  readonly references: readonly string[];
  readonly fromTask: string | undefined;
}

export function parseI2iArgs(argv: readonly string[], ctx: { readonly isTTY: boolean }): I2iOptions {
  const { positionals, options } = parseKnownFlags(argv, {
    boolean: new Set(COMMON_BOOLEAN),
    valued: new Set([...COMMON_VALUED, 'prompt', 'from-task']),
  });
  const prompt = options.get('prompt');
  if (prompt === undefined || prompt.trim().length === 0) throw new Error('i2i: --prompt "<text>" is required');
  const fromTask = options.get('from-task');
  if (fromTask !== undefined && positionals.length > 0) {
    throw new Error(
      'i2i: --from-task and reference images cannot be combined -- Meshy uses input_task_id and DROPS the references. ' +
        'To edit a finished image and show the generator a second picture, download it and pass both as references'
    );
  }
  if (fromTask === undefined && positionals.length === 0) {
    throw new Error('i2i: give 1-5 reference images (paths or https URLs) or --from-task <task-id>');
  }
  if (positionals.length > MAX_REFERENCES) {
    throw new Error(`i2i: ${positionals.length} reference images, Meshy takes at most ${MAX_REFERENCES}`);
  }
  const common = parseCommon(options);
  assertYesOrInteractive(common.yes, ctx.isTTY);
  return { ...common, prompt, references: positionals, fromTask };
}

export interface EstimateImageGenOptions {
  readonly model: ImageModel;
  readonly pose: PoseFlag;
  /** attempts: the estimate is per attempt times this */
  readonly count: number;
  readonly json: boolean;
}

export function parseEstimateImageGenArgs(argv: readonly string[], label: string): EstimateImageGenOptions {
  const { positionals, options } = parseKnownFlags(argv, {
    boolean: new Set(['json']),
    valued: new Set(['model', 'pose', 'count']),
  });
  if (positionals.length > 0) throw new Error(`estimate ${label}: unexpected argument(s): ${positionals.join(' ')}`);
  const model = options.has('model') ? asImageModel(options.get('model') as string) : 'nano-banana-2';
  const pose = options.has('pose') ? asPoseFlag(options.get('pose') as string) : 'none';
  const rawCount = options.get('count');
  const count = rawCount === undefined ? 1 : Number(rawCount);
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error(`--count must be an integer in [1, 1000], got "${rawCount}"`);
  return { model, pose, count, json: options.get('json') === 'true' };
}

// ---------------------------------------------------------------------------
// references (reads the files: the one impure part, still no network)
// ---------------------------------------------------------------------------

export interface ResolvedReference {
  /** What the user passed. */
  readonly source: string;
  /** What goes in `reference_image_urls`: an https URL as given, or a data URI. */
  readonly url: string;
  /** sha256 of the file's bytes (local files only) -- the guide hash G-C5 records. */
  readonly sha256: string | undefined;
  readonly bytes: number | undefined;
}

const MIME: Readonly<Record<string, string>> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export function resolveReference(source: string): ResolvedReference {
  if (isHttpUrl(source)) return { source, url: source, sha256: undefined, bytes: undefined };
  const ext = path.extname(source).toLowerCase();
  if (!(REFERENCE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`reference "${source}": unsupported extension "${ext}" -- expected ${REFERENCE_EXTENSIONS.join(', ')}`);
  }
  const size = statSync(source).size;
  if (size > MAX_REFERENCE_BYTES) {
    throw new Error(`reference "${source}" is ${size} bytes, over Meshy's 20 MB limit`);
  }
  const bytes = readFileSync(source);
  return { source, url: `data:${MIME[ext]};base64,${bytes.toString('base64')}`, sha256: sha256(bytes), bytes: size };
}

export function buildT2iRequest(opts: T2iOptions): TextToImageRequest {
  return {
    ai_model: opts.model,
    prompt: composePrompt(opts.prompt, opts.negative),
    ...(opts.aspect ? { aspect_ratio: opts.aspect } : {}),
    ...(opts.pose !== 'none' ? { pose_mode: opts.pose } : {}),
    ...(opts.multiView ? { generate_multi_view: true } : {}),
    ...(opts.removeBackground ? { remove_background: true } : {}),
  };
}

export function buildI2iRequest(opts: I2iOptions, refs: readonly ResolvedReference[]): ImageToImageRequest {
  return {
    ai_model: opts.model,
    prompt: composePrompt(opts.prompt, opts.negative),
    ...(opts.fromTask ? { input_task_id: opts.fromTask } : { reference_image_urls: refs.map((r) => r.url) }),
    ...(opts.aspect ? { aspect_ratio: opts.aspect } : {}),
    ...(opts.multiView ? { generate_multi_view: true } : {}),
    ...(opts.removeBackground ? { remove_background: true } : {}),
  };
}

/** The request as it is logged and written to task.json: a data URI is replaced by its length, never printed. */
export function loggableI2i(body: ImageToImageRequest): ImageToImageRequest {
  if (!body.reference_image_urls) return body;
  return {
    ...body,
    reference_image_urls: body.reference_image_urls.map((u) => (isHttpUrl(u) ? u : `<data-uri, ${u.length} chars, not printed>`)),
  };
}

// ---------------------------------------------------------------------------
// provenance (G-C5: generator, model, plan tier, date, task id, prompt hash, guide hash, disclosure)
// ---------------------------------------------------------------------------

export interface ImageProvenanceInput {
  readonly kind: 't2i' | 'i2i';
  readonly imagePath: string; // repo-relative
  readonly model: string;
  readonly plan: string;
  readonly taskId: string;
  readonly promptSha256: string;
  readonly referenceSha256: readonly string[];
  readonly generatedAt: string; // yyyy-mm-dd
}

export function buildImageProvenanceLine(input: ImageProvenanceInput): string {
  const method = input.kind === 't2i' ? 'Meshy AI text-to-image' : 'Meshy AI image-to-image';
  const refs = input.referenceSha256.length > 0 ? `, references sha256 ${input.referenceSha256.join('+')}` : '';
  return (
    `| ${input.imagePath} | TODO: draws as | ${method} (${input.model}, plan ${input.plan}, prompt sha256 ${input.promptSha256}${refs}) -- ` +
    `AI-generated, disclosed per CONTRIBUTING.md, task ${input.taskId}, generated ${input.generatedAt} |`
  );
}
