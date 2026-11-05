/**
 * GH-943 WebGPU-primary P1 (T2): what the legacy post chain (`post-chain.ts`, EffectComposer) and its node twin
 * (`post-chain.node.ts`, a TSL graph in a RenderPipeline) agree on. ADDON-FREE and type-light on purpose: the twin may import only
 * addon-free modules (a `three/addons/postprocessing` import would put the legacy composer in the node chunk, which the bundle
 * census refuses). `post-chain.ts` re-exports every name here.
 *
 * **The order is the code's, not design section 3's.** Design section 3 and item 11 put the grade and the vignette before the sRGB
 * encode; the code does the opposite: `OutputPass` tone maps (ACES, exposure 1.0), sRGB-encodes, THEN applies the grade LUT
 * (display-referred) and the vignette, then dithers, and SMAA runs last on that display-referred colour. Follow the code.
 */

/**
 * The legacy chain's `passNames`, in order, for the full (`high`) chain. A stage is present iff its quality gate and its
 * factory say so; `RenderPass` and `OutputPass` always are. Each name is what `passName()` in `post-chain.ts` reports for a
 * stand-in or real pass of that slot (`GTAOPass` is the slot label: the real AO pass reports `WorldGTAOPass`).
 */
export const POST_CHAIN_ORDER = ['RenderPass', 'FogOfWarPass', 'GTAOPass', 'QuarterBloomPass', 'OutputPass', 'SMAAPass'] as const;
export type PostStageName = (typeof POST_CHAIN_ORDER)[number];

/** The quality gates (`../quality.ts`) the chain reads, so a test can hand either chain the same preset. */
export interface PostQuality {
  readonly ao: boolean;
  readonly smaa: boolean;
  readonly bloom: 'off' | 'quarter';
}

/** What both chains offer the renderer: the pass list (for the order pin), a frame, and a release. */
export interface PostChainLike {
  readonly passNames: readonly string[];
  render(): void;
  dispose(): void;
}
