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

  it('serves every ground texture from the deploy base', () => {
    const o = rendererOptionsFor(arid, HIGH, '/roaring-lions/');
    const urls = [o.groundTextureUrl, o.rockTextureUrl, o.roadTextureUrl, o.scrubTextureUrl, o.groveTextureUrl, o.knollTextureUrl];
    for (const url of urls) expect(url?.startsWith('/roaring-lions/textures/'), String(url)).toBe(true);
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
