import { describe, expect, it } from 'vitest';
import { maps, paletteColor, paletteTeamColors, parseMap } from '@lions/data';
import { QUALITY_PRESETS } from '@lions/render';
import { dracoDecoderPath } from './mesh-catalogue';
import { rendererOptionsFor } from './renderer-options';
import { TERRAIN_THEMES } from './terrain-themes';

const arid = parseMap(maps.beit_sahwan_outskirts);
const green = parseMap(maps.wadi_halam_basin);
const HIGH = { colorVision: 'default', quality: 'high' } as const;

describe('rendererOptionsFor', () => {
  // The two reads bootBattlefield made off `map.terrain` (main.ts:1583, :1623
  // at 2d92cbad). A theme that drew the wrong ground is a map in the wrong biome.
  it('chooses the tones and the open-ground albedo by the map theme', () => {
    const a = rendererOptionsFor(arid, HIGH, '/');
    const g = rendererOptionsFor(green, HIGH, '/');
    expect(a.terrainTones).toBe(TERRAIN_THEMES.arid);
    expect(g.terrainTones).toBe(TERRAIN_THEMES.green);
    expect(a.groundTextureUrl).toBe('/textures/desert_sand_tile.jpg');
    expect(g.groundTextureUrl).toBe('/textures/green_basin_tile.jpg');
  });

  // GH-322: the Sur highland is a third theme, and Umm Zeitoun overrides
  // its grove species inside it.
  it('resolves the highland theme for a Sur map, with its own ground image', () => {
    const hill = parseMap(maps.tel_marum);
    expect(hill.terrain).toBe('highland');
    const o = rendererOptionsFor(hill, HIGH, '/');
    expect(o.terrainTones).toBe(TERRAIN_THEMES.highland);
    expect(o.terrainTones.groveFamily).toBe('cedar');
    expect(o.terrainTones.openScatter?.tree).toBe('cedar');
    expect(o.terrainTones.paletteRamps).toEqual(['karst']);
    expect(o.terrainTones.open).toBe(paletteColor('dust.5'));
    expect(o.terrainTones.decorColors?.['cedar:foliage']).toBe(paletteColor('scrub.1'));
    expect(o.groundTextureUrl).toBe('/textures/highland_v2_tile.jpg');
  });

  it('keeps olive groves on Umm Zeitoun and changes nothing else about the highland', () => {
    for (const id of ['umm_zeitoun', 'umm_zeitoun_3', 'umm_zeitoun_4'] as const) {
      const m = parseMap(maps[id]);
      expect(m.grove, id).toBe('olive');
      const t = rendererOptionsFor(m, HIGH, '/').terrainTones;
      expect(t.groveFamily, id).toBe('tree');
      // The open-ground cedars stay: only the `o` tiles are olive terraces.
      expect(t.openScatter?.tree, id).toBe('cedar');
      expect({ ...t, groveFamily: 'cedar' }).toEqual(TERRAIN_THEMES.highland);
    }
  });

  it('hands a map without a grove override its theme bundle by identity', () => {
    expect(arid.grove).toBeNull();
    expect(green.grove).toBeNull();
    expect(rendererOptionsFor(parseMap(maps.qarn_hadid), HIGH, '/').terrainTones).toBe(TERRAIN_THEMES.highland);
  });

  it('gives arid and green none of the highland-only fields, so they draw as before', () => {
    for (const t of [TERRAIN_THEMES.arid, TERRAIN_THEMES.green]) {
      expect(t.paletteRamps).toBeUndefined();
      expect(t.decorColors).toBeUndefined();
      expect(t.openScatter).toBeUndefined();
      expect(t.macroHue).toBeUndefined();
    }
  });

  it('serves every ground texture from the deploy base', () => {
    const o = rendererOptionsFor(arid, HIGH, '/roaring-lions/');
    const urls = [o.groundTextureUrl, o.rockTextureUrl, o.scrubTextureUrl, o.groveTextureUrl, o.knollTextureUrl];
    for (const url of urls) expect(url?.startsWith('/roaring-lions/textures/'), String(url)).toBe(true);
  });

  it('no longer asks for a road image', () => {
    // #226: the road is drawn procedurally from control texture B's
    // distance field, tone and grain both -- there is no wheel-track image
    // left for `RendererOptions` to name.
    expect('roadTextureUrl' in rendererOptionsFor(arid, HIGH, '/')).toBe(false);
  });

  it('carries the player quality preset by identity', () => {
    expect(rendererOptionsFor(arid, { colorVision: 'default', quality: 'low' }, '/').quality).toBe(QUALITY_PRESETS.low);
  });

  // Task 12 of Phase 1: the tuple AND the string-keyed resolver must agree, or
  // the silhouette, HP bars and zone tints stay on the default palette.
  it('routes the team colours through the chosen variant, tuple and resolver alike', () => {
    const o = rendererOptionsFor(arid, { colorVision: 'deuteranopia', quality: 'high' }, '/');
    const v = paletteTeamColors('deuteranopia');
    expect(o.teamColors).toEqual(v);
    expect(o.resolveColor?.('team.hostile')).toBe(v[1]);
    expect(o.resolveColor?.('dust.0')).toBe(paletteColor('dust.0'));
  });

  it('asks for the Draco decoder at the catalogue’s one spelling', () => {
    expect(rendererOptionsFor(arid, HIGH, '/').dracoDecoderPath).toBe(dracoDecoderPath());
  });

  it('keeps the palette entries bootBattlefield always used', () => {
    const o = rendererOptionsFor(arid, HIGH, '/');
    expect(o.background).toBe(paletteColor('shadow.1'));
    expect(o.hullColors).toEqual([paletteColor('olive.1'), paletteColor('dust.2'), paletteColor('limestone.1')]);
    expect(o.infantryColors).toEqual([paletteColor('olive.0'), paletteColor('dust.0'), paletteColor('limestone.1')]);
    expect(o.shellColors).toEqual([paletteColor('vfx.fire'), paletteColor('vfx.ember')]);
    expect(o.groupColors).toHaveLength(9);
    expect(o.groupColors[8]).toBe(paletteColor('group.g9'));
  });
});
