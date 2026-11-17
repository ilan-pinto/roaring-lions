/**
 * GH-1400 (G2): the quality presets' two dark features, wired and LEFT DARK. The lead's rulings (16 Nov 2026):
 *
 * - **Ragdolls** (GH-1223): `high` 16 figures, `medium` 8, `low` 0, after ONE Metal browser read confirms the headless bench.
 * - **Soft particles** (GH-1227): `high` only, after ONE Metal G-cost read of 2 ms or less with smoke on screen.
 *
 * Each feature is behind ONE switch, below. Both are `false`, so no preset changes: with a switch off `liveQuality`
 * hands back the very object it was given, and the renderer builds today's frame on every preset, `high` included
 * (`quality.ts`'s header: `high` is pinned to the pre-preset constants). Flipping a switch is the follow-up PR, after
 * its Metal read, and that PR carries the CI bless.
 *
 * Why the caps are not in `QUALITY_PRESETS`: `quality.ts` is on the entry's STATIC closure (`main.ts` reads the table
 * before the renderer's chunk loads), and the entry is at its byte ceiling (`webgpu-bundle-census.ts`). This file is
 * imported only by `ThreeRenderer.ts` and the menu's `front/scene-host.ts`, both behind a dynamic import, so neither
 * switch, the caps nor the resolution costs the entry a byte, on or off.
 *
 * Three-free (types and `QUALITY_PRESETS` only). Presentation only: nothing here reaches the sim (invariant 4).
 */
import { QUALITY_PRESETS, type PhysicsQuality, type RenderQuality } from '../quality';

/** GH-1223 / GH-1400: give `medium` and `high` their ragdoll caps (`RAGDOLL_PRESET_CAPS`). OFF until the Metal read. */
export const RAGDOLL_PRESETS_LIVE: boolean = false;

/** GH-1227 / GH-1400: give `high` soft particles (`SOFT_PARTICLES_PRESETS`). OFF until the Metal G-cost read. */
export const SOFT_PARTICLES_PRESET_LIVE: boolean = false;

export type PresetTier = 'low' | 'medium' | 'high';

/** The ragdoll cap per preset while `RAGDOLL_PRESETS_LIVE` is on (design L4). `low` is 0 BY TYPE: at 0 the WASM is never fetched. */
export const RAGDOLL_PRESET_CAPS: { readonly low: 0; readonly medium: PhysicsQuality['ragdolls']; readonly high: PhysicsQuality['ragdolls'] } = {
  low: 0,
  medium: 8,
  high: 16,
};

/** Which preset draws soft particles while `SOFT_PARTICLES_PRESET_LIVE` is on (design D2). `low` never, by type. */
export const SOFT_PARTICLES_PRESETS: { readonly low: false; readonly medium: boolean; readonly high: boolean } = {
  low: false,
  medium: false,
  high: true,
};

export interface PresetSwitches {
  readonly ragdolls: boolean;
  readonly softParticles: boolean;
}

/** The two switches as the renderer reads them. One place: a test that needs them on mocks this, never the constants' callers. */
export const PRESET_SWITCHES: PresetSwitches = { ragdolls: RAGDOLL_PRESETS_LIVE, softParticles: SOFT_PARTICLES_PRESET_LIVE };

const TIERS: readonly PresetTier[] = ['low', 'medium', 'high'];
/** The two fields this file writes, and the two the sandbox flags `&ragdoll` and `&soft` write over a preset. */
const LIVE_KEYS: ReadonlySet<string> = new Set(['physics', 'softParticles']);

/**
 * The shipped preset `q` is, or null. A preset itself matches by identity; a sandbox copy (`{ ...preset, softParticles: true }`,
 * `{ ...preset, physics: { ragdolls: 16 } }`) matches when every other field is the preset's own value, by reference, which a
 * spread keeps. Anything else (a test fake, a hand-built quality) is no preset, and keeps exactly what it says.
 */
export function presetTierOf(q: RenderQuality): PresetTier | null {
  for (const t of TIERS) if (q === QUALITY_PRESETS[t]) return t;
  const qr = q as unknown as Readonly<Record<string, unknown>>;
  for (const t of TIERS) {
    const pr = QUALITY_PRESETS[t] as unknown as Readonly<Record<string, unknown>>;
    let same = true;
    for (const k of new Set([...Object.keys(pr), ...Object.keys(qr)])) {
      if (!LIVE_KEYS.has(k) && qr[k] !== pr[k]) {
        same = false;
        break;
      }
    }
    if (same) return t;
  }
  return null;
}

/**
 * `q` with the switched-on features of its preset. With both switches off, or for no preset, it is `q` ITSELF (the same
 * object, so nothing downstream can tell). An explicit opinion wins: a `physics` that is not the preset's own object (the
 * `&ragdoll` showcase's 16, the menu's 0) and a `softParticles` that is set at all (`&soft`) are kept as they are.
 * Absent `q` stays absent: "no opinion" is a test fake's, and the renderer reads its own defaults for it as before.
 */
export function liveQuality(q: RenderQuality | undefined, switches: PresetSwitches): RenderQuality | undefined {
  if (q === undefined || (!switches.ragdolls && !switches.softParticles)) return q;
  const tier = presetTierOf(q);
  if (tier === null) return q;
  const preset = QUALITY_PRESETS[tier];
  const cap = RAGDOLL_PRESET_CAPS[tier];
  const ragdolls = switches.ragdolls && cap > 0 && q.physics === preset.physics;
  const soft = switches.softParticles && SOFT_PARTICLES_PRESETS[tier] && q.softParticles === undefined;
  if (!ragdolls && !soft) return q;
  return { ...q, ...(ragdolls ? { physics: { ragdolls: cap } } : {}), ...(soft ? { softParticles: true } : {}) };
}

/** `opts` with `liveQuality` applied; `opts` ITSELF when its quality does not change. */
export function liveRendererOptions<T extends { readonly quality?: RenderQuality }>(opts: T, switches: PresetSwitches): T {
  const quality = liveQuality(opts.quality, switches);
  return quality === opts.quality ? opts : { ...opts, quality };
}

/**
 * The menu's scene host (`front/scene-host.ts`) drives a never-ticked `Sim`: nothing dies there, so a ragdoll cap buys
 * nothing and would fetch the WASM on `/` (the design: "the menu, the board and the `low` preset download nothing").
 * With the ragdoll switch on it pins `physics` to an explicit 0, which `liveQuality` keeps; with it off it is `opts` ITSELF.
 */
export function menuRendererOptions<T extends { readonly quality?: RenderQuality }>(opts: T, switches: PresetSwitches): T {
  if (!switches.ragdolls || opts.quality === undefined) return opts;
  return { ...opts, quality: { ...opts.quality, physics: { ragdolls: 0 } } };
}
