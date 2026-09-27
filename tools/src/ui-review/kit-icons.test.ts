import { describe, expect, it } from 'vitest';
import { kitIconFailures, type IconRead } from './kit-icons';

const ROOT = 16;
const chip = (over: Partial<IconRead> = {}): IconRead => ({
  surface: 'chip',
  type: 'inf_squad',
  kit: '1',
  icon: { x: 100, y: 50, w: 40, h: 40 },
  sign: { x: 120, y: 50, w: 20, h: 20 },
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
    expect(kitIconFailures([chip({ sign: { x: 124, y: 50, w: 16, h: 16 } })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: sign 16x16 px, want 20 (1.25rem at 16 px)',
    ]);
    // --ui-scale 1.15: 20 px is now too small.
    expect(kitIconFailures([chip()], { inf_squad: 1 }, 18.4)).toEqual([
      'chip inf_squad: sign 20x20 px, want 23 (1.25rem at 18.4 px)',
    ]);
  });

  it('names a sign out of the top-right corner', () => {
    expect(kitIconFailures([chip({ sign: { x: 100, y: 50, w: 20, h: 20 } })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: sign top-right at (120,50), want (140,50)',
    ]);
  });

  // The card frame and the dock tile draw their sign at `KIT_ICON_SIGN.small`
  // (1rem, 16 px at scale 1) -- the lead's G-N2 FINAL split "20 px on the
  // chip" and 1rem everywhere else (`kit-sign.ts`, `theme.css`'s
  // `.rl-kit-icon svg` base rule). Only the chip draws at 1.25rem/20px.
  it('steps the card and the tile in by their border and their own corner margin', () => {
    const card: IconRead = {
      surface: 'card',
      type: 'mbt_lavi',
      kit: '3',
      icon: { x: 0, y: 0, w: 72, h: 72 },
      sign: { x: 52, y: 4, w: 16, h: 16 }, // 72 - 1 border - 3 margin - 16
    };
    const tile: IconRead = {
      surface: 'tile',
      type: 'mbt_lavi',
      kit: '3',
      icon: { x: 0, y: 0, w: 60, h: 60 },
      sign: { x: 41, y: 3, w: 16, h: 16 }, // 60 - 1 - 2 - 16
    };
    expect(kitIconFailures([card, tile], { mbt_lavi: 3 }, ROOT)).toEqual([]);
    expect(kitIconFailures([{ ...card, sign: { x: 56, y: 0, w: 16, h: 16 } }], { mbt_lavi: 3 }, ROOT)).toEqual([
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
      sign: { x: 41, y: 3, w: 16, h: 16 },
    };
    expect(kitIconFailures([locked], { mbt_lavi: 3 }, ROOT)).toEqual(['tile mbt_lavi: a sign drawn, want none']);
    expect(kitIconFailures([{ ...locked, sign: null }], { mbt_lavi: 3 }, ROOT)).toEqual([]);
  });

  it('refuses to pass on nothing read', () => {
    expect(kitIconFailures([], { inf_squad: 1 }, ROOT)).toEqual(['no icons were read']);
  });
});
