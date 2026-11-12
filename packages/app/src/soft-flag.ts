/**
 * `&soft` -- soft particles for an A/B look (GH-1227 slice 2).
 *
 * Sandbox only, like `&gpu=` and `&tod=`: a mission never reads it, so no mission, score or outcome can depend on it.
 * Presentation only. ABSENT leaves `RendererOptions.quality` exactly as the preset built it (every preset has
 * `softParticles` off, pinned by `flipbook-soft.test.ts`), so the shipped frame is untouched. ON turns
 * `quality.softParticles` on for this boot, and only this boot: nothing is written to settings.
 * Both backends receive the option; the node backend is inert until its depth copy lands (slice 3).
 */
import type { RendererOptions } from '@lions/render';
import { readFlags } from './sandbox-help';

export interface SoftChoice {
  readonly options: RendererOptions;
  readonly warning?: string;
}

export function withSoftParticles(options: RendererOptions, params: URLSearchParams, inSandbox: boolean): SoftChoice {
  if (!readFlags(params).soft) return { options };
  if (!inSandbox) return { options, warning: '&soft is sandbox-only; a mission draws with its preset' };
  if (options.quality === undefined) return { options, warning: '&soft needs a quality preset to extend; ignored' };
  return { options: { ...options, quality: { ...options.quality, softParticles: true } } };
}
