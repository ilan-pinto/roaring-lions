/**
 * Sprite sheet manifests.
 *
 * A sheet describes its own conventions — how many facings it has, which
 * index faces world +x, which way the rig rotated, how big it draws, and
 * which animation clips it contains. Those are properties of the rendered
 * files, not of the game, so they belong next to the files rather than in
 * app code. `tools/render_*.py` writes the manifest, so the rig that caused
 * a convention is the thing that reports it.
 *
 * Pure parsing: no Pixi, no I/O, no sim state.
 */

/** Canonical clip names. A sheet need not contain all of them. */
export type ClipName = 'idle' | 'move' | 'fire' | 'down' | 'wreck';

export interface ClipSpec {
  /** Number of frames in this clip. */
  frames: number;
  /**
   * Playback rate for clips that run on their own clock — currently only
   * one-shot clips such as `fire`, whose latch expires after frames / fps.
   * Locomotion ignores this: `move` is paced by measured ground speed so the
   * feet track the terrain (see anim.ts).
   */
  fps: number;
  loop: boolean;
  /**
   * Index of this clip's first frame within the sheet's file numbering.
   * Zero for clip-layout sheets, where each clip has its own filename
   * prefix. Legacy sheets pack idle and walk into one flat sequence, so
   * their `move` starts at 1.
   */
  fileOffset: number;
}

export type SheetLayout = 'legacy' | 'clip';

export interface SheetSpec {
  facings: number;
  /** Sprite index that faces world +x. */
  facingOffset: number;
  /** True when the rig rotated the object the other way round. */
  facingReverse: boolean;
  /** Draw size multiplier, replacing the hardcoded isSoft ? 1.0 : 1.8. */
  scale: number;
  layout: SheetLayout;
  clips: Partial<Record<ClipName, ClipSpec>> & { idle: ClipSpec };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Parse a sheet manifest, accepting both the clip layout and the flat layout
 * shipped today.
 *
 * The legacy path is load-bearing rather than politeness: it lets units be
 * re-authored one at a time without the un-migrated ones breaking.
 */
export function parseManifest(raw: unknown): SheetSpec {
  if (!isRecord(raw)) throw new Error('sheet manifest: expected an object');

  const facings = num(raw.facings, 0);
  if (facings <= 0) throw new Error('sheet manifest: missing or invalid "facings"');

  const base = {
    facings,
    facingOffset: num(raw.facingOffset, 0),
    facingReverse: raw.facingReverse === true,
    scale: num(raw.scale, 1),
  };

  if (isRecord(raw.clips)) {
    const clips: Record<string, ClipSpec> = {};
    for (const [name, spec] of Object.entries(raw.clips)) {
      if (!isRecord(spec)) continue;
      const frames = num(spec.frames, 0);
      if (frames <= 0) continue;
      clips[name] = { frames, fps: num(spec.fps, 0), loop: spec.loop === true, fileOffset: 0 };
    }
    if (!clips.idle) {
      throw new Error('sheet manifest: clip layout must declare an "idle" clip to fall back to');
    }
    return { ...base, layout: 'clip', clips: clips as SheetSpec['clips'] };
  }

  // Legacy flat layout: frame 0 is idle, any remainder is the walk cycle.
  const total = Math.max(1, Math.floor(num(raw.frames, 1)));
  const clips: Record<string, ClipSpec> = {
    idle: { frames: 1, fps: 0, loop: false, fileOffset: 0 },
  };
  if (total > 1) {
    clips.move = { frames: total - 1, fps: 0, loop: true, fileOffset: 1 };
  }
  return { ...base, layout: 'legacy', clips: clips as SheetSpec['clips'] };
}

/** File name for one frame of one clip, in the sheet's own layout. */
export function frameFileName(
  sheet: SheetSpec,
  clip: ClipName,
  facing: number,
  frame: number
): string {
  const spec = sheet.clips[clip];
  const index = (spec?.fileOffset ?? 0) + frame;
  const f = facing.toString().padStart(2, '0');
  const n = index.toString().padStart(3, '0');
  return sheet.layout === 'clip' ? `${clip}_f${f}_${n}.png` : `f${f}_${n}.png`;
}

/**
 * Requested clip, or `idle` when this sheet has not authored it.
 *
 * Degrading rather than throwing is what makes the asset roster additive:
 * a sheet with no `fire` yet simply keeps standing there.
 */
export function clipOrFallback(sheet: SheetSpec, clip: ClipName): ClipName {
  return sheet.clips[clip] ? clip : 'idle';
}
