/**
 * What one generated take costs, in USD, on the paid Gemini API.
 *
 * Quoted from https://ai.google.dev/gemini-api/docs/pricing on 2026-10-11
 * into this table rather than fetched: the API has no pricing endpoint, so
 * this is the CLI's only source and it can go stale. Every number a spend
 * gate prints comes from here, so when a real bill disagrees with an
 * estimate, this table is the first thing to re-read.
 *
 * Two rules keep the estimate on the conservative side, because it is the
 * number a budget check refuses on:
 *
 * - **Veo bills per second of output**, with audio (audio is always on for
 *   Veo 3.1; there is no without-audio row). The pricing page says Veo is
 *   charged "only if your video is successfully generated" -- the ledger
 *   counts every SUBMITTED take anyway (see `ledger.ts`), which over-counts
 *   a filtered take and never under-counts one.
 * - **Gemini Omni Flash bills output tokens** (5,792 tokens per second of
 *   720p video at $17.50 per 1M, "approximately $0.10 per second"), and its
 *   request has NO duration parameter (docs/omni: length is steered by the
 *   prompt; a clip is 3 to 10 s). So an Omni take is priced at its MAXIMUM,
 *   10 s, whatever the shot asks for, plus a fixed allowance for the input
 *   images and prompt. The 1080p and 4K options are UPSCALED and their
 *   billing is not published, so this table refuses them rather than guess.
 */

export const PRICING_SOURCE = {
  url: 'https://ai.google.dev/gemini-api/docs/pricing',
  quotedAt: '2026-10-11',
} as const;

/** The models this CLI drives, by the short name a storyboard uses. */
export const MODELS = {
  'omni-flash': 'gemini-omni-1.1-flash',
  'veo-3.1': 'veo-3.1-generate-preview',
  'veo-3.1-fast': 'veo-3.1-fast-generate-preview',
  'veo-3.1-lite': 'veo-3.1-lite-generate-preview',
} as const;
export type ModelKey = keyof typeof MODELS;
export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

export const RESOLUTIONS = ['360p', '720p', '1080p', '4k'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

type VeoKey = Exclude<ModelKey, 'omni-flash'>;

/** USD per second of output, with audio (the only rows the page has). A
 *  missing entry is a combination the model does not offer. */
export const VEO_USD_PER_SECOND: Readonly<Record<VeoKey, Partial<Record<Resolution, number>>>> = {
  'veo-3.1': { '720p': 0.4, '1080p': 0.4, '4k': 0.6 },
  'veo-3.1-fast': { '720p': 0.1, '1080p': 0.12, '4k': 0.3 },
  'veo-3.1-lite': { '720p': 0.05, '1080p': 0.08 },
};

/** docs/veo: `durationSeconds` is 4, 6 or 8, and 1080p / 4k need 8. */
export const VEO_DURATIONS = [4, 6, 8] as const;

export const OMNI = {
  outputTokensPerSecond: 5792,
  usdPerMillionOutputVideoTokens: 17.5,
  usdPerMillionInputTokens: 1.5,
  /** The longest clip one request can return (docs/omni: 3 to 10 s). */
  maxSeconds: 10,
  /** Per input image. Not published for Omni; 1,600 is above the 258
   *  tokens a 768 px tile costs on other Gemini models times the two tiles a
   *  1280x720 still needs, so it errs high. */
  inputTokensPerImageAllowance: 1600,
  /** Resolutions whose billing is published: native output only. */
  resolutions: ['360p', '720p'] as readonly Resolution[],
} as const;

export interface TakeSpec {
  readonly model: ModelKey;
  readonly resolution: Resolution;
  /** Requested length. Veo: billed exactly. Omni: ignored for billing (see header). */
  readonly seconds: number;
}

export interface TakeInputs {
  readonly images: number;
  readonly promptChars: number;
}

export const isVeo = (model: ModelKey): model is VeoKey => model !== 'omni-flash';

/** Why this take cannot be requested as written, or null. Pure. */
export function takeSpecProblem(spec: TakeSpec): string | null {
  if (!(MODEL_KEYS as readonly string[]).includes(spec.model)) return `unknown model "${spec.model}"`;
  if (!(RESOLUTIONS as readonly string[]).includes(spec.resolution)) return `unknown resolution "${spec.resolution}"`;
  if (isVeo(spec.model)) {
    if (!(VEO_DURATIONS as readonly number[]).includes(spec.seconds)) {
      return `${spec.model}: seconds must be 4, 6 or 8 (got ${spec.seconds})`;
    }
    if (VEO_USD_PER_SECOND[spec.model][spec.resolution] === undefined) {
      return `${spec.model} has no ${spec.resolution} output`;
    }
    if ((spec.resolution === '1080p' || spec.resolution === '4k') && spec.seconds !== 8) {
      return `${spec.model}: ${spec.resolution} needs seconds 8 (got ${spec.seconds})`;
    }
    return null;
  }
  if (!OMNI.resolutions.includes(spec.resolution)) {
    return `omni-flash ${spec.resolution} is upscaled and its billing is unpublished; use 720p`;
  }
  if (!(spec.seconds >= 3 && spec.seconds <= OMNI.maxSeconds)) {
    return `omni-flash: seconds must be 3 to ${OMNI.maxSeconds} (got ${spec.seconds})`;
  }
  return null;
}

/** The seconds a take is BILLED for: Veo exactly as asked, Omni at its maximum. */
export function billedSeconds(spec: TakeSpec): number {
  return isVeo(spec.model) ? spec.seconds : OMNI.maxSeconds;
}

/** USD for one take. Throws on a spec `takeSpecProblem` refuses. Pure. */
export function estimateTakeUsd(spec: TakeSpec, inputs: TakeInputs): number {
  const problem = takeSpecProblem(spec);
  if (problem !== null) throw new Error(problem);
  if (isVeo(spec.model)) {
    const rate = VEO_USD_PER_SECOND[spec.model][spec.resolution] as number;
    return rate * spec.seconds;
  }
  const outputTokens = OMNI.outputTokensPerSecond * OMNI.maxSeconds;
  const inputTokens = inputs.images * OMNI.inputTokensPerImageAllowance + Math.ceil(inputs.promptChars / 4);
  return (
    (outputTokens * OMNI.usdPerMillionOutputVideoTokens) / 1_000_000 +
    (inputTokens * OMNI.usdPerMillionInputTokens) / 1_000_000
  );
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
