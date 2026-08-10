import { describe, expect, it } from 'vitest';
import {
  clipOrFallback,
  frameFileName,
  parseManifest,
  parseStructureManifest,
  turretAxisOffset,
} from './sheet';

/** A modern clip-layout manifest, as render_*.py will emit it. */
const CLIP_MANIFEST = {
  unit: 'infantry_soldier',
  facings: 16,
  size: 256,
  facingOffset: 5,
  facingReverse: true,
  scale: 1.0,
  clips: {
    idle: { frames: 1, fps: 0 },
    move: { frames: 4, fps: 10, loop: true },
    fire: { frames: 3, fps: 20, loop: false },
    down: { frames: 1, fps: 0 },
    wreck: { frames: 1, fps: 0 },
  },
};

/** The layout shipped today: flat files, frame 0 idle, rest walk. */
const LEGACY_MANIFEST = {
  unit: 'infantry_soldier',
  facings: 16,
  size: 256,
  frames: 5,
  files: [{ facing: 0, frame: 0, file: 'f00_000.png' }],
};

describe('parseManifest — clip layout', () => {
  it('reads the rig conventions instead of making the app hardcode them', () => {
    // The whole point of the issue: facingOffset was a hand-measured constant
    // in main.ts. The rig that caused it should be the one reporting it.
    const s = parseManifest(CLIP_MANIFEST);
    expect(s.facingOffset).toBe(5);
    expect(s.facingReverse).toBe(true);
    expect(s.facings).toBe(16);
    expect(s.scale).toBe(1.0);
    expect(s.layout).toBe('clip');
  });

  it('exposes every declared clip', () => {
    const s = parseManifest(CLIP_MANIFEST);
    expect(Object.keys(s.clips).sort()).toEqual(['down', 'fire', 'idle', 'move', 'wreck']);
    expect(s.clips.fire).toMatchObject({ frames: 3, fps: 20, loop: false });
    expect(s.clips.move).toMatchObject({ frames: 4, fps: 10, loop: true });
  });

  it('defaults optional rig fields rather than throwing', () => {
    const s = parseManifest({ facings: 16, clips: { idle: { frames: 1 } } });
    expect(s.facingOffset).toBe(0);
    expect(s.facingReverse).toBe(false);
    expect(s.scale).toBe(1);
    expect(s.clips.idle.fps).toBe(0);
    expect(s.clips.idle.loop).toBe(false);
  });
});

describe('parseManifest — legacy fallback', () => {
  // This fallback is load-bearing: it is what lets the asset roster (#44)
  // land unit-by-unit without breaking sheets that have not been re-authored.

  it('reads a flat sheet as an implicit idle + move pair', () => {
    const s = parseManifest(LEGACY_MANIFEST);
    expect(s.layout).toBe('legacy');
    expect(Object.keys(s.clips).sort()).toEqual(['idle', 'move']);
    expect(s.clips.idle.frames).toBe(1);
    expect(s.clips.move?.frames).toBe(4); // 5 total, minus the idle frame
  });

  it('reads a single-frame sheet as idle only, with no phantom walk', () => {
    // The tank hull and turret are one frame each. Inventing a move clip for
    // them would animate a sheet that has nothing to animate.
    const s = parseManifest({ facings: 16, frames: 1 });
    expect(Object.keys(s.clips)).toEqual(['idle']);
    expect(s.clips.move).toBeUndefined();
  });

  it('treats a missing frames count as a single static frame', () => {
    const s = parseManifest({ facings: 16 });
    expect(s.clips.idle.frames).toBe(1);
    expect(s.clips.move).toBeUndefined();
  });
});

describe('parseManifest — rejection', () => {
  it('rejects a manifest with no facings', () => {
    expect(() => parseManifest({ clips: { idle: { frames: 1 } } })).toThrow(/facings/i);
  });

  it('rejects a non-object', () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest('nope')).toThrow();
  });

  it('rejects a clip layout declaring no idle clip', () => {
    // idle is the universal fallback target; without it a missing clip has
    // nowhere to fall back to.
    expect(() => parseManifest({ facings: 16, clips: { move: { frames: 4 } } })).toThrow(/idle/i);
  });
});

describe('frameFileName', () => {
  it('names clip-layout files with the clip prefix', () => {
    const s = parseManifest(CLIP_MANIFEST);
    expect(frameFileName(s, 'move', 0, 1)).toBe('move_f00_001.png');
    expect(frameFileName(s, 'fire', 15, 2)).toBe('fire_f15_002.png');
    expect(frameFileName(s, 'idle', 3, 0)).toBe('idle_f03_000.png');
  });

  it('names legacy files flat, with the walk cycle offset past the idle frame', () => {
    // Legacy sheets store idle at index 0 and the walk cycle at 1..N-1, so
    // move frame 0 must resolve to file 001, not 000.
    const s = parseManifest(LEGACY_MANIFEST);
    expect(frameFileName(s, 'idle', 0, 0)).toBe('f00_000.png');
    expect(frameFileName(s, 'move', 0, 0)).toBe('f00_001.png');
    expect(frameFileName(s, 'move', 5, 3)).toBe('f05_004.png');
  });

  it('pads facing and frame the way the render scripts write them', () => {
    const s = parseManifest(CLIP_MANIFEST);
    expect(frameFileName(s, 'idle', 9, 0)).toBe('idle_f09_000.png');
  });
});

describe('clipOrFallback', () => {
  it('returns the requested clip when the sheet has it', () => {
    const s = parseManifest(CLIP_MANIFEST);
    expect(clipOrFallback(s, 'fire')).toBe('fire');
  });

  it('falls back to idle for a clip the sheet has not authored yet', () => {
    // A legacy sheet has no fire or down. Asking for them must degrade, not
    // throw — otherwise no unit can ship until every unit is re-authored.
    const s = parseManifest(LEGACY_MANIFEST);
    expect(clipOrFallback(s, 'fire')).toBe('idle');
    expect(clipOrFallback(s, 'down')).toBe('idle');
    expect(clipOrFallback(s, 'wreck')).toBe('idle');
  });

  it('still serves the clips a legacy sheet does have', () => {
    const s = parseManifest(LEGACY_MANIFEST);
    expect(clipOrFallback(s, 'move')).toBe('move');
  });

  it('falls back for a single-frame sheet asked to walk', () => {
    const s = parseManifest({ facings: 16, frames: 1 });
    expect(clipOrFallback(s, 'move')).toBe('idle');
  });
});

describe('parseStructureManifest', () => {
  /** A building sheet as render_building.py emits it. */
  const BUILDING = {
    unit: 'house',
    kind: 'building',
    facings: 1,
    size: 512,
    scale: 4.666,
    footprintTiles: 4,
    badgeTopPx: 140.86,
    clips: { idle: { frames: 1, fps: 0, loop: false } },
    files: [{ clip: 'idle', facing: 0, frame: 0, file: 'idle_f00_000.png' }],
  };

  it('reads the derived scale and badge offset', () => {
    const s = parseStructureManifest(BUILDING);
    expect(s.scale).toBeCloseTo(4.666);
    expect(s.badgeTopPx).toBeCloseTo(140.86);
    expect(s.file).toBe('idle_f00_000.png');
  });

  it('reports a missing badgeTopPx as null rather than guessing', () => {
    // A sheet rendered before the field existed. Returning 0 would silently draw
    // the badge on the footprint centre; null lets the renderer fall back to
    // heightPx, which is wrong but at least wrong in a known way.
    const { badgeTopPx, ...older } = BUILDING;
    expect(badgeTopPx).toBeDefined();
    expect(parseStructureManifest(older).badgeTopPx).toBeNull();
  });

  it('rejects a non-finite badgeTopPx', () => {
    expect(parseStructureManifest({ ...BUILDING, badgeTopPx: NaN }).badgeTopPx).toBeNull();
  });

  it('falls back to the conventional file name when files is absent', () => {
    const { files, ...noFiles } = BUILDING;
    expect(files).toBeDefined();
    expect(parseStructureManifest(noFiles).file).toBe('idle_f00_000.png');
  });

  it('defaults scale to 1 rather than 0, so a bad sheet is visible not invisible', () => {
    expect(parseStructureManifest({}).scale).toBe(1);
  });

  it('throws on a non-object', () => {
    expect(() => parseStructureManifest(null)).toThrow(/expected an object/);
  });
});

describe('turretAxisPx', () => {
  const axis = Array.from({ length: 16 }, (_, f) => [f * 2, f * -3]);
  const withAxis = (turretAxisPx: unknown) =>
    parseManifest({ ...CLIP_MANIFEST, turretAxisPx });

  it('parses a full-length array of pairs', () => {
    expect(withAxis(axis).turretAxisPx).toEqual(axis.map(([x, y]) => [x, y]));
  });

  it('is absent when the rig wrote no axis', () => {
    expect(parseManifest(CLIP_MANIFEST).turretAxisPx).toBeUndefined();
  });

  // Dropped rather than partially honoured: offsetting some facings and not
  // others reads as a turret that jitters only at certain headings, which is far
  // harder to diagnose than a field that is simply not there.
  it.each([
    ['short', axis.slice(0, 8)],
    ['not an array', { 0: [1, 2] }],
    ['a triple', [...axis.slice(1), [1, 2, 3]]],
    ['a non-number', [...axis.slice(1), ['1', 2]]],
    ['NaN', [...axis.slice(1), [Number.NaN, 2]]],
    ['Infinity', [...axis.slice(1), [1, Number.POSITIVE_INFINITY]]],
  ])('drops a malformed array (%s)', (_label, bad) => {
    expect(withAxis(bad).turretAxisPx).toBeUndefined();
  });
});

describe('turretAxisOffset', () => {
  const sheet = parseManifest({
    ...CLIP_MANIFEST,
    turretAxisPx: Array.from({ length: 16 }, (_, f) => [f * 2, f * -3]),
  });

  it('is zero when hull and turret face the same way', () => {
    for (let f = 0; f < 16; f++) {
      expect(turretAxisOffset(sheet, f, f)).toEqual([0, 0]);
    }
  });

  it('is the difference between the two facings, and antisymmetric', () => {
    expect(turretAxisOffset(sheet, 6, 2)).toEqual([8, -12]);
    expect(turretAxisOffset(sheet, 2, 6)).toEqual([-8, 12]);
  });

  it('is zero for a sheet with no axis, so old sheets are unchanged', () => {
    expect(turretAxisOffset(parseManifest(CLIP_MANIFEST), 6, 2)).toEqual([0, 0]);
  });

  it('is zero rather than NaN when an index is out of range', () => {
    expect(turretAxisOffset(sheet, 99, 2)).toEqual([0, 0]);
    expect(turretAxisOffset(sheet, 2, -1)).toEqual([0, 0]);
  });
});
