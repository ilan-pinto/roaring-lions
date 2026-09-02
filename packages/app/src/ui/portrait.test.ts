// Which frame stands in for a unit in the HUD.
//
// The manifests these read are real shapes taken from `assets/sprites/`: the
// two conventions that actually ship (a sheet with clips, and TNK_HULL's
// clipless one) are the two cases a filename template would get wrong.

import { describe, expect, it } from 'vitest';
import { PORTRAIT_FACING, portraitFile, portraitUrl } from './portrait';

/** A sheet with clips, as INF_SQUAD's manifest is shaped. */
const withClips = {
  files: [
    { clip: 'down', facing: 3, frame: 0, file: 'down_f03_000.png' },
    { clip: 'idle', facing: 0, frame: 0, file: 'idle_f00_000.png' },
    { clip: 'idle', facing: 3, frame: 0, file: 'idle_f03_000.png' },
    { clip: 'idle', facing: 3, frame: 1, file: 'idle_f03_001.png' },
    { clip: 'move', facing: 3, frame: 0, file: 'move_f03_000.png' },
  ],
};

/** TNK_HULL: no `clips` key at all, so no `clip` on any file. */
const clipless = {
  files: [
    { facing: 0, frame: 0, file: 'f00_000.png' },
    { facing: 3, frame: 0, file: 'f03_000.png' },
  ],
};

describe('portrait frame', () => {
  it('takes the idle frame at the chosen facing', () => {
    expect(portraitFile(withClips)).toBe(`idle_f0${PORTRAIT_FACING}_000.png`);
  });

  it('never takes a death or movement frame as the portrait', () => {
    // `down_f03_000.png` is first in the list and matches the facing exactly.
    // Filtering by clip is the only thing keeping a corpse out of the chip.
    expect(portraitFile(withClips)).not.toContain('down');
    expect(portraitFile(withClips)).not.toContain('move');
  });

  it('reads a sheet that declares no clips at all', () => {
    // Absent `clip` means "this sheet has one pose and every frame is it",
    // not "this frame belongs to some other clip". Treating it as the latter
    // gives the shipped tank no picture.
    expect(portraitFile(clipless)).toBe('f03_000.png');
  });

  it('reads an unclipped frame as the idle one even where a clipped frame precedes it', () => {
    // The line above passes either way, because a sheet with NO idle frames
    // falls back to the whole file list and lands on the same picture. This is
    // the case where treating an absent `clip` as "some other clip" actually
    // costs something: the fallback would hand back the wreck, because it
    // comes first and matches the facing.
    expect(
      portraitFile({
        files: [
          { clip: 'wreck', facing: 3, frame: 0, file: 'wreck_f03_000.png' },
          { facing: 3, frame: 0, file: 'f03_000.png' },
        ],
      })
    ).toBe('f03_000.png');
  });

  it('falls back to another facing, and still to that facing’s first frame', () => {
    // Two rungs, and the second is only load-bearing when the list does not
    // happen to open on frame 0 — a sheet whose facing this build does not
    // reach must still show a settled pose rather than whatever frame of the
    // idle loop the manifest listed first.
    expect(
      portraitFile({
        files: [
          { clip: 'idle', facing: 7, frame: 2, file: 'idle_f07_002.png' },
          { clip: 'idle', facing: 7, frame: 0, file: 'idle_f07_000.png' },
        ],
      })
    ).toBe('idle_f07_000.png');
  });

  it('falls back past the clip filter when a sheet has no idle', () => {
    expect(portraitFile({ files: [{ clip: 'wreck', facing: 3, frame: 0, file: 'wreck_f03_000.png' }] })).toBe(
      'wreck_f03_000.png'
    );
  });

  it('returns null for a manifest that lists no files', () => {
    expect(portraitFile({})).toBeNull();
    expect(portraitFile({ files: [] })).toBeNull();
  });
});

describe('portrait url', () => {
  it('joins the sheet path the SPRITE_MAP already carries', () => {
    expect(portraitUrl('/sprites/INF_SQUAD/', withClips)).toBe('/sprites/INF_SQUAD/idle_f03_000.png');
  });

  it('stays null when there is no frame, so the HUD can draw its own gap', () => {
    expect(portraitUrl('/sprites/NOTHING/', {})).toBeNull();
  });
});
