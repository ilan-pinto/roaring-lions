/**
 * The automatic quality step-down (low-end assessment, 2026-10-09;
 * docs/PERFORMANCE.md, "Low-end").
 *
 * What it does, and all it does: it watches the presented-frame intervals of
 * a mission's opening, and when too many of them are slower than 30 fps it
 * LOWERS the saved render quality by one step, for the NEXT mission. Four
 * rules hold it to that, each one a test in `quality-auto.test.ts`:
 *
 * - **It only ever lowers.** There is no path from any verdict to a higher
 *   quality than the one in effect.
 * - **It never overrides the player.** A quality the player picked in
 *   Settings carries `qualitySource: 'player'`, and the sampler is not armed
 *   at all for one. Changing the quality there, in either direction, is
 *   the player taking the decision back.
 * - **It never changes the running mission.** The preset is read once at
 *   boot (`main.ts`), so a mid-mission pop of the ambient occlusion is not
 *   something this can cause; the player meets the lower preset at the next
 *   mission's start, as the Settings hint already says of a manual change.
 * - **A hidden tab voids the sample.** A backgrounded tab's rAF runs at about
 *   1 Hz, which reads as "every frame is slow" -- the same trap that put a
 *   false number into this repository once. Any non-visible frame inside the
 *   window throws the whole window away, and nothing is decided.
 *
 * - **Two slow openings in a row, not one.** A single opening is a weak
 *   witness: on the measuring machine the same view read 33-51 fps across
 *   sessions, with the GPU shared by other work (PERFORMANCE.md "Low-end").
 *   The first slow opening only records a strike (`video.qualityStrikes`);
 *   the second consecutive one at the same preset lowers it, and a fast
 *   opening clears the strike.
 *
 * Why one step, and why from the opening. Measured on the heaviest mission
 * under CDP CPU throttling (PERFORMANCE.md "Low-end"): `high`'s extra cost on
 * a slow CPU is the ambient-occlusion pass's second submission of the scene,
 * and `medium` removes it -- the share of frames over 33 ms falls several-fold
 * from high to medium, while medium to low buys almost nothing on a CPU-bound
 * machine. So the rule steps once per mission and lets the next opening
 * decide whether another step is warranted.
 */
import type { Quality, QualitySource, Settings } from './settings';

export const AUTO_QUALITY = {
  /** Ignored after the first frame: shader compiles and the deferred mesh
   *  loads land here, on every machine. */
  skipMs: 2000,
  /** The judged window, in presented time. */
  sampleMs: 8000,
  /** "Below 30 fps": an interval longer than two 60 Hz vsyncs. Display-rate
   *  independent -- a 120 Hz panel's fast frames are shorter, not longer. */
  slowFrameMs: 33.4,
  /** The share of slow frames that lowers the preset. See PERFORMANCE.md
   *  "Low-end" for the readings this sits between. */
  slowShare: 0.05,
  /** Consecutive slow openings at one preset before it is lowered. */
  strikes: 2,
} as const;

const STEP_DOWN: Record<Quality, Quality | null> = { high: 'medium', medium: 'low', low: null };

/** Whether a battlefield should watch its opening at all. */
export function autoQualityArmed(s: Settings): boolean {
  return s.video.qualitySource !== 'player' && STEP_DOWN[s.video.quality] !== null;
}

/** The quality to save for the next mission, or `null` to leave it. */
export function autoQualityTarget(current: Quality, source: QualitySource, slowShare: number): Quality | null {
  if (source === 'player') return null;
  if (!(slowShare >= AUTO_QUALITY.slowShare)) return null;
  return STEP_DOWN[current];
}

export interface AutoQualityVerdict {
  /** `void` when the window saw a hidden tab; nothing is decided then. */
  kind: 'judged' | 'void';
  frames: number;
  slowFrames: number;
  slowShare: number;
}

export interface QualitySampler {
  /** Feed one presented frame: the interval since the last one, and whether
   *  the page stayed visible across it. The CALLER must report `false` for a
   *  frame whose interval spanned a hidden period, not only for a frame drawn
   *  while hidden: Chrome runs no rAF at all in a hidden tab, so the frame
   *  that would carry the evidence is the first VISIBLE one after it.
   *  Returns the verdict exactly once, on the frame
   *  that closes the window, and `null` on every other call. */
  frame(frameMs: number, visible: boolean): AutoQualityVerdict | null;
}

export function createQualitySampler(cfg: { skipMs: number; sampleMs: number; slowFrameMs: number } = AUTO_QUALITY): QualitySampler {
  let elapsed = 0;
  let frames = 0;
  let slow = 0;
  let voided = false;
  let done = false;
  return {
    frame(frameMs, visible) {
      if (done) return null;
      if (!visible) voided = true;
      const before = elapsed;
      elapsed += frameMs;
      if (before < cfg.skipMs) return null;
      frames++;
      if (frameMs > cfg.slowFrameMs) slow++;
      if (elapsed < cfg.skipMs + cfg.sampleMs) return null;
      done = true;
      return { kind: voided ? 'void' : 'judged', frames, slowFrames: slow, slowShare: frames > 0 ? slow / frames : 0 };
    },
  };
}

/** The settings to save after a verdict, or `null` to save nothing: a strike
 *  recorded or cleared, or the preset lowered one step on the last strike. */
export function settingsAfterVerdict(s: Settings, v: AutoQualityVerdict): Settings | null {
  if (v.kind !== 'judged' || s.video.qualitySource === 'player') return null;
  const to = autoQualityTarget(s.video.quality, s.video.qualitySource, v.slowShare);
  if (to === null) {
    // Fast (or already at the floor): a standing strike is cleared, and
    // nothing else is written.
    return s.video.qualityStrikes > 0 ? { ...s, video: { ...s.video, qualityStrikes: 0 } } : null;
  }
  const strikes = s.video.qualityStrikes + 1;
  if (strikes < AUTO_QUALITY.strikes) return { ...s, video: { ...s.video, qualityStrikes: strikes } };
  return { ...s, video: { ...s.video, quality: to, qualitySource: 'auto', qualityStrikes: 0 } };
}
