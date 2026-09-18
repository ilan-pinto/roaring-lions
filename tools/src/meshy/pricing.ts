/**
 * Credit costs, quoted from https://docs.meshy.ai/en/api/pricing on
 * 2026-09-18 into this table rather than fetched -- the API has no pricing
 * endpoint, so this is the CLI's only source and it can go stale. If a real
 * spend ever reports `consumed_credits` that disagrees with `estimateCredits`
 * for the same request, this table is what to re-check first.
 *
 * USD-per-credit is NOT published there at all; `resolveUsdPerCredit` reads
 * `MESHY_USD_PER_CREDIT` (env or the key file) when set, else falls back to
 * the Pro plan's advertised $20 / 1,000 credits, and every printed USD figure
 * is captioned as an estimate for exactly that reason.
 */
import type { ModelType, TextureResolution } from './options';

export const PRICING_SOURCE = {
  url: 'https://docs.meshy.ai/en/api/pricing',
  quotedAt: '2026-09-18',
} as const;

export const DEFAULT_USD_PER_CREDIT = 0.02; // $20 / 1000 credits, Pro plan, stated as an estimate.
export const USD_PER_CREDIT_ENV_VAR = 'MESHY_USD_PER_CREDIT';

/**
 * The table, as printed in the brief. Each row is named for what it prices,
 * not for the CLI command that spends it -- `remesh`/`retexture`/`rigging`/
 * `animation` have no CLI command yet, but are pinned here (and by
 * `estimateCredits`'s tests) so a future command has nothing left to guess.
 */
export const PRICING = {
  textPreviewStandard: 20, // model_type standard|lowpoly, any ai_model
  textPreviewSmartTopology: 5,
  textPreviewUltraSurcharge: 5, // ultra_mode, meshy-7 only; smart-topology has no ultra tier
  textRefine2kOr4k: 10,
  textRefine8k: 15,
  imageStandardNoTexture: 20,
  imageStandardWithTexture: 30,
  imageStandardWithTexture8k: 35,
  imageUltraSurcharge: 5,
  imageSmartTopologyNoTexture: 5,
  imageSmartTopologyWithTexture: 15,
  imageSmartTopologyWithTexture8k: 20,
  remesh: 5,
  retexture2kOr4k: 10,
  retexture8k: 15,
  rigging: 5,
  animationPerAction: 3,
} as const;

export const ESTIMATE_KINDS = [
  'text-preview',
  'text-refine',
  'image',
  'remesh',
  'retexture',
  'rigging',
  'animation',
] as const;
export type EstimateKind = (typeof ESTIMATE_KINDS)[number];

export interface EstimateOptions {
  /** text-preview, image */
  readonly modelType?: ModelType;
  /** text-preview (meshy-7 only in practice, not enforced here), image */
  readonly ultra?: boolean;
  /** text-refine, image, retexture */
  readonly textureResolution?: TextureResolution;
  /** image: should_texture, default true per the API */
  readonly shouldTexture?: boolean;
  /** animation: number of actions, default 1 */
  readonly actions?: number;
}

const isSmartTopology = (modelType: ModelType | undefined): boolean => modelType === 'smart-topology';

/** Pure: no network, no I/O. Every row of `PRICING` has a covering test. */
export function estimateCredits(kind: EstimateKind, opts: EstimateOptions = {}): number {
  switch (kind) {
    case 'text-preview': {
      const smart = isSmartTopology(opts.modelType);
      let credits: number = smart ? PRICING.textPreviewSmartTopology : PRICING.textPreviewStandard;
      if (opts.ultra && !smart) credits += PRICING.textPreviewUltraSurcharge;
      return credits;
    }
    case 'text-refine':
      return opts.textureResolution === '8k' ? PRICING.textRefine8k : PRICING.textRefine2kOr4k;
    case 'image': {
      const smart = isSmartTopology(opts.modelType);
      const textured = opts.shouldTexture !== false;
      let credits: number;
      if (!textured) {
        credits = smart ? PRICING.imageSmartTopologyNoTexture : PRICING.imageStandardNoTexture;
      } else if (opts.textureResolution === '8k') {
        credits = smart ? PRICING.imageSmartTopologyWithTexture8k : PRICING.imageStandardWithTexture8k;
      } else {
        credits = smart ? PRICING.imageSmartTopologyWithTexture : PRICING.imageStandardWithTexture;
      }
      // Important 2 (review, 2026-09-18): unlike text-preview above, this
      // adds the surcharge even under smart-topology. Checked against
      // https://docs.meshy.ai/en/api/pricing on 2026-09-18: that page
      // documents `ultra_mode`'s +5 credits only under the "Meshy-7 models"
      // row, in BOTH the text-to-3d and image-to-3d sections, and never
      // mentions it under either section's "Smart Topology (Meshy T2)
      // models" row -- so the page does not explicitly say whether the two
      // combine for image-to-3d, only that they're never written together.
      // Kept unconditional deliberately: this is the number a spend gate
      // shows the user before they confirm, and adding the surcharge is the
      // conservative direction (an over-estimate, never an under-estimate).
      // UNVERIFIED against a real spend -- if a real `consumed_credits` for
      // image + smart-topology + ultra ever disagrees, this is the line to
      // revisit, and the fix would be to exclude it, matching text-preview.
      if (opts.ultra) credits += PRICING.imageUltraSurcharge;
      return credits;
    }
    case 'remesh':
      return PRICING.remesh;
    case 'retexture':
      return opts.textureResolution === '8k' ? PRICING.retexture8k : PRICING.retexture2kOr4k;
    case 'rigging':
      return PRICING.rigging;
    case 'animation':
      return PRICING.animationPerAction * (opts.actions ?? 1);
  }
}

/** `MESHY_USD_PER_CREDIT` if a caller supplies one (env, or the key file's own
 *  vars merged in by `config.ts`), else the documented estimate. Never throws
 *  on a bad value -- an unparsable override falls back rather than crashing
 *  a balance/estimate printout. */
export function resolveUsdPerCredit(vars: Readonly<Record<string, string | undefined>>): number {
  const raw = vars[USD_PER_CREDIT_ENV_VAR];
  if (raw === undefined) return DEFAULT_USD_PER_CREDIT;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_PER_CREDIT;
}

export function estimateUsd(credits: number, usdPerCredit: number): number {
  return credits * usdPerCredit;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
