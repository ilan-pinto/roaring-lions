/**
 * GH-1226 S5: the app half of the height blend's wiring. `packages/render` may not import `@lions/data`, so the tones and the map
 * opt-out are pinned here.
 *  - `highland` and `arid` carry `heightBlend`, resolved from the same palette KEYS the render side's table names
 *    (`HEIGHT_BLEND_THEMES`, read as the independent oracle for the keys; the hexes come from the palette, not retyped), with the
 *    design's amplitudes as literals; arid has no joint and no `aJ`; `green` and `wetland` carry none (decision 1);
 *  - `ground_blend: false` is on Rujm Sawda and on no other shipped map, `parseMap` reads it, and `terrainTonesFor` hands that map its
 *    theme without the blend (every other field of the bundle untouched), while every other map gets its theme by identity.
 *
 * Falsified by (commit message): dropping the `groundBlend === false` branch of `terrainTonesFor` (Rujm Sawda keeps the blend);
 * a wrong palette key in a theme; `ground_blend: false` removed from `data/maps/rujm_sawda.json`.
 */
import { describe, expect, it } from 'vitest';
import { maps, parseMap, paletteColor, type MapId } from '@lions/data';
import { HEIGHT_BLEND_THEMES } from '../../render/src/three/terrain/height-blend';
import { TERRAIN_THEMES, terrainTonesFor } from './terrain-themes';

const MAP_IDS = Object.keys(maps) as MapId[];

describe('GH-1226 S5: the theme tones', () => {
  it('highland: karst.1 rock at 0.75, terracotta.1 joints at 0.6 and hollows at 0.45, chips softened 40%', () => {
    const t = TERRAIN_THEMES.highland.heightBlend;
    const k = HEIGHT_BLEND_THEMES.highland;
    expect(t).toEqual({
      rock: paletteColor(k.rock.key),
      joint: paletteColor(k.joint?.key ?? 'missing'),
      hollow: paletteColor(k.hollow.key),
      aR: 0.75,
      aJ: 0.6,
      aH: 0.45,
      kH: 0.4,
    });
    expect([k.rock.key, k.joint?.key, k.hollow.key]).toEqual(['karst.1', 'terracotta.1', 'terracotta.1']);
  });

  it('arid: karst.0 rock at 0.7, loess (limestone.4) hollows at 0.6, no joint and no aJ', () => {
    const t = TERRAIN_THEMES.arid.heightBlend;
    const k = HEIGHT_BLEND_THEMES.arid;
    expect(t).toEqual({ rock: paletteColor(k.rock.key), hollow: paletteColor(k.hollow.key), aR: 0.7, aH: 0.6, kH: 0.5 });
    expect(t).not.toHaveProperty('joint');
    expect(t).not.toHaveProperty('aJ');
    expect([k.rock.key, k.hollow.key]).toEqual(['karst.0', 'limestone.4']);
  });

  it('green and wetland carry no blend (decision 1)', () => {
    expect(TERRAIN_THEMES.green.heightBlend).toBeUndefined();
    expect(TERRAIN_THEMES.wetland.heightBlend).toBeUndefined();
  });
});

describe('GH-1226 S5: the map opt-out', () => {
  it('ground_blend: false is on rujm_sawda and on no other shipped map', () => {
    const off = MAP_IDS.filter((id) => (maps[id] as { ground_blend?: boolean }).ground_blend === false);
    expect(off).toEqual(['rujm_sawda']);
    expect(MAP_IDS.filter((id) => parseMap(maps[id]).groundBlend === false)).toEqual(['rujm_sawda']);
  });

  it('rujm_sawda draws its arid theme without the blend, every other field of the bundle unchanged', () => {
    const pm = parseMap(maps.rujm_sawda);
    expect(pm.terrain).toBe('arid');
    const tones = terrainTonesFor(pm);
    expect(tones.heightBlend).toBeUndefined();
    expect(tones).toEqual({ ...TERRAIN_THEMES.arid, heightBlend: undefined });
    expect(Object.keys(tones)).not.toContain('heightBlend');
  });

  it('every other highland and arid map gets the blend, by identity unless its grove overrides', () => {
    let blended = 0;
    for (const id of MAP_IDS) {
      if (id === 'rujm_sawda') continue;
      const pm = parseMap(maps[id]);
      const tones = terrainTonesFor(pm);
      if (pm.terrain === 'highland' || pm.terrain === 'arid') {
        expect(tones.heightBlend, id).toBe(TERRAIN_THEMES[pm.terrain].heightBlend);
        blended++;
      } else {
        expect(tones.heightBlend, id).toBeUndefined();
      }
      if (pm.grove === null) expect(tones, id).toBe(TERRAIN_THEMES[pm.terrain]);
    }
    expect(blended).toBeGreaterThan(20);
  });
});
