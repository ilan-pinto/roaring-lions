import { describe, it, expect } from 'vitest';
import {
  COLLAPSE_SHROUD_SHADES,
  collapseShroudPaletteKey,
  collapseShroudShadeForRow,
} from './collapse-shroud-role';
import { smokePlumePaletteKey, SMOKE_PLUME_ROLES } from './smoke-plume-role';
import palette from '../../../../../data/palette.json';

describe('collapseShroudPaletteKey', () => {
  it('resolves every shade to a real entry of the dust ramp', () => {
    const dust = (palette as { ramps: Record<string, { colors: string[] }> }).ramps.dust.colors;
    for (const shade of COLLAPSE_SHROUD_SHADES) {
      const key = collapseShroudPaletteKey(shade);
      const [ramp, idx] = key.split('.');
      expect(ramp, `${shade} must come from the dust ramp`).toBe('dust');
      expect(Number(idx)).toBeGreaterThanOrEqual(0);
      expect(Number(idx)).toBeLessThan(dust.length);
    }
  });

  it('darkens toward the ground -- the ramp descends in brightness, index 0 lightest', () => {
    // The inversion CLAUDE.md warns about ("higher terrain = higher index
    // comes out inverted, and it cost three renders"). `deep` is packed
    // against the rubble and must be the DARKER stop, which on this ramp
    // means the HIGHER index.
    const idx = (s: (typeof COLLAPSE_SHROUD_SHADES)[number]): number =>
      Number(collapseShroudPaletteKey(s).split('.')[1]);
    expect(idx('deep')).toBeGreaterThan(idx('body'));
    expect(idx('body')).toBeGreaterThan(idx('crown'));
  });

  it('shares its middle two stops with the authored collapse dust', () => {
    // `data/vfx/structure_collapse.json`'s own particle layer grades
    // ["dust.2", "dust.4"] for this same event and draws in the same frame.
    // If the mesh shroud drifted onto a different ramp the two would read as
    // two materials.
    const keys = COLLAPSE_SHROUD_SHADES.map(collapseShroudPaletteKey);
    expect(keys).toContain('dust.2');
    expect(keys).toContain('dust.4');
  });

  it('does NOT share the smoke plume\'s family -- warm masonry dust, cold engine soot', () => {
    const plume = SMOKE_PLUME_ROLES.map(smokePlumePaletteKey);
    for (const shade of COLLAPSE_SHROUD_SHADES) {
      expect(plume).not.toContain(collapseShroudPaletteKey(shade));
    }
  });
});

describe('collapseShroudShadeForRow', () => {
  it('gives a one-row lattice the middle stop, not the darkest', () => {
    // Every `low_profile` structure in the game -- a compound wall, a fence --
    // lays out one row. Reading it as `deep` would make the shortest thing on
    // the map also the darkest, which is backwards: `deep` means "the bottom
    // of a column with more dust above it" and a wall panel has no column.
    expect(collapseShroudShadeForRow(0, 1)).toBe('body');
    expect(collapseShroudShadeForRow(0, 0)).toBe('body');
  });

  it('runs dark at the bottom to light at the top for a real column', () => {
    expect(collapseShroudShadeForRow(0, 4)).toBe('deep');
    expect(collapseShroudShadeForRow(1, 4)).toBe('body');
    expect(collapseShroudShadeForRow(2, 4)).toBe('body');
    expect(collapseShroudShadeForRow(3, 4)).toBe('crown');
  });

  it('uses all three shades on a lattice tall enough to have a middle', () => {
    const used = new Set([0, 1, 2].map((r) => collapseShroudShadeForRow(r, 3)));
    expect(used).toEqual(new Set(['deep', 'body', 'crown']));
  });
});
