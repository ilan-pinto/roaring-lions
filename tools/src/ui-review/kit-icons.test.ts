import { describe, expect, it } from 'vitest';
import { kitIconFailures, type IconRead } from './kit-icons';

const ROOT = 16;
const chip = (over: Partial<IconRead> = {}): IconRead => ({
  surface: 'chip',
  type: 'inf_squad',
  kit: '1',
  icon: { x: 100, y: 50, w: 40, h: 40 },
  // One star at 0.625rem (10 px) tall, sqrt(3)/2 as wide: 8.66 x 10.
  sign: { x: 131.34, y: 50, w: 8.66, h: 10 },
  ...over,
});

describe('kitIconFailures', () => {
  it('passes a sign of the right level, size and corner', () => {
    expect(kitIconFailures([chip()], { inf_squad: 1 }, ROOT)).toEqual([]);
  });

  it('names a wrong level', () => {
    expect(kitIconFailures([chip({ kit: '2' })], { inf_squad: 1 }, ROOT)).toEqual(['chip inf_squad: kit 2, want 1']);
  });

  it('names a missing sign, and a sign where none is due', () => {
    expect(kitIconFailures([chip({ kit: null, sign: null })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: no sign, want kit 1',
    ]);
    expect(kitIconFailures([chip()], {}, ROOT)).toEqual(['chip inf_squad: a sign drawn, want none']);
  });

  it('names a sign drawn at the wrong size for this rem', () => {
    // The small surfaces' 8 px star, drawn on the chip.
    expect(kitIconFailures([chip({ sign: { x: 133.07, y: 50, w: 6.93, h: 8 } })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: sign 6.93x8 px, want 8.7x10.0 (1 star(s), 0.625rem tall at 16 px)',
    ]);
    // --ui-scale 1.15: 10 px is now too small.
    expect(kitIconFailures([chip()], { inf_squad: 1 }, 18.4)).toEqual([
      'chip inf_squad: sign 8.66x10 px, want 10.0x11.5 (1 star(s), 0.625rem tall at 18.4 px)',
    ]);
    // Right height, wrong count of stars: a level-2 row where one star is due.
    expect(kitIconFailures([chip({ sign: { x: 121.85, y: 50, w: 18.15, h: 10 } })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: sign 18.15x10 px, want 8.7x10.0 (1 star(s), 0.625rem tall at 16 px)',
    ]);
  });

  it('names a sign out of the top-right corner', () => {
    expect(kitIconFailures([chip({ sign: { x: 100, y: 50, w: 8.66, h: 10 } })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: sign top-right at (109,50), want (140,50)',
    ]);
  });

  // The card frame and the dock tile draw their stars at `KIT_ICON_SIGN.small`
  // (0.5rem, 8 px tall at scale 1) -- "Bigger stars", the lead, after G-P3:
  // 10 px on the chip, 8 px everywhere else (`theme.css`'s `.rl-kit-icon svg`
  // base rule). Three stars at 8 px: 22.12 px wide.
  it('steps the card and the tile in by their border and their own corner margin', () => {
    const card: IconRead = {
      surface: 'card',
      type: 'mbt_lavi',
      kit: '3',
      icon: { x: 0, y: 0, w: 72, h: 72 },
      sign: { x: 45.88, y: 4, w: 22.12, h: 8 }, // 72 - 1 border - 3 margin - 22.12
    };
    const tile: IconRead = {
      surface: 'tile',
      type: 'mbt_lavi',
      kit: '3',
      icon: { x: 0, y: 0, w: 60, h: 60 },
      sign: { x: 34.88, y: 3, w: 22.12, h: 8 }, // 60 - 1 - 2 - 22.12
    };
    expect(kitIconFailures([card, tile], { mbt_lavi: 3 }, ROOT)).toEqual([]);
    expect(kitIconFailures([{ ...card, sign: { x: 49.88, y: 0, w: 22.12, h: 8 } }], { mbt_lavi: 3 }, ROOT)).toEqual([
      'card mbt_lavi: sign top-right at (72,0), want (68,4)',
    ]);
  });

  it('requires a locked tile to draw no sign, whatever its type carries', () => {
    const locked: IconRead = {
      surface: 'tile',
      type: 'mbt_lavi',
      kit: '3',
      locked: true,
      icon: { x: 0, y: 0, w: 60, h: 60 },
      sign: { x: 34.88, y: 3, w: 22.12, h: 8 },
    };
    expect(kitIconFailures([locked], { mbt_lavi: 3 }, ROOT)).toEqual(['tile mbt_lavi: a sign drawn, want none']);
    expect(kitIconFailures([{ ...locked, sign: null }], { mbt_lavi: 3 }, ROOT)).toEqual([]);
  });

  it('refuses to pass on nothing read', () => {
    expect(kitIconFailures([], { inf_squad: 1 }, ROOT)).toEqual(['no icons were read']);
  });
});
