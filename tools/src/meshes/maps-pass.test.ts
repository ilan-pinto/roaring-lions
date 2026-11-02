/**
 * The maps pass's refusals (L3, GH-943). It is not idempotent and its position in the pipeline is
 * load-bearing, so each way of running it out of order must throw BEFORE the minutes of numpy, and the
 * well-ordered input must get past every refusal.
 */
import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { MAPS_EXTRAS_KEY } from './maps-contract';
import { applyMaps, parseMapsArgs, teamRegionLuma, type GeneratedMaps } from './maps-pass';
import { RG_EXTRAS_KEY } from './running-gear-contract';
import { RESCALE_EXTRAS_KEY } from './rescale-contract';

const report = (over: Partial<GeneratedMaps['report']> = {}): GeneratedMaps['report'] => ({
  size: 2048,
  generator_sha256: 'x',
  team_fraction: 0.0215,
  team_area_m2: 2.4,
  surface_area_m2: 114,
  swatches: {},
  probes: [],
  ...over,
});
const maps = (over: Partial<GeneratedMaps['report']> = {}): GeneratedMaps => ({
  normalPng: new Uint8Array(),
  ormPng: new Uint8Array(),
  report: report(over),
});

function docOf(extras: Record<string, unknown>, nodes: string[] = []): Document {
  const doc = new Document();
  const buf = doc.createBuffer();
  void buf;
  doc.createScene('s').setExtras(extras);
  for (const n of nodes) doc.createNode(n);
  doc.createMaterial('material').setBaseColorTexture(doc.createTexture('base_color').setImage(new Uint8Array([1])).setMimeType('image/jpeg'));
  return doc;
}
const good = { [RESCALE_EXTRAS_KEY]: { factor: 1.18 }, [RG_EXTRAS_KEY]: { version: 1 } };

describe('maps pass refusals', () => {
  it('refuses a file that already carries rl_maps', () => {
    expect(() => applyMaps(docOf({ ...good, [MAPS_EXTRAS_KEY]: {} }), 'mbt_lavi', maps())).toThrow(/already carries extras\.rl_maps/);
  });
  it('refuses a file that is not rescaled', () => {
    expect(() => applyMaps(docOf({ [RG_EXTRAS_KEY]: {} }), 'mbt_lavi', maps())).toThrow(/not rescaled/);
  });
  it('refuses a file with no running gear (it adds the vertices the maps must cover)', () => {
    expect(() => applyMaps(docOf({ [RESCALE_EXTRAS_KEY]: { factor: 1.18 } }), 'mbt_lavi', maps())).toThrow(/running-gear/);
  });
  it('refuses a file that is already kitted or wrecked (the maps come BEFORE kit and wreck)', () => {
    expect(() => applyMaps(docOf(good, ['kit_armour_1_turret_hull']), 'mbt_lavi', maps())).toThrow(/BEFORE kit and wreck/);
    expect(() => applyMaps(docOf(good, ['death_root']), 'mbt_lavi', maps())).toThrow(/BEFORE kit and wreck/);
  });
  it('refuses a team mask outside the approved 1.5-2.5% band, and a generator that wrote the wrong size', () => {
    expect(() => applyMaps(docOf(good), 'mbt_lavi', maps({ team_fraction: 0.05 }))).toThrow(/outside 1\.5-2\.5%/);
    expect(() => applyMaps(docOf(good), 'mbt_lavi', maps({ team_fraction: 0.001 }))).toThrow(/outside/);
    expect(() => applyMaps(docOf(good), 'mbt_lavi', maps({ size: 1024 }))).toThrow(/1024 px maps/);
  });
  it('past every refusal it reaches the base colour decode (and fails there on a 1-byte image)', () => {
    expect(() => applyMaps(docOf(good), 'mbt_lavi', maps())).not.toThrow(/already|not rescaled|running-gear|BEFORE|outside/);
  });
  it('maps:meshes names its vehicle: no default, no unknown id', () => {
    expect(() => parseMapsArgs([])).toThrow(/at least one --id/);
    expect(() => parseMapsArgs(['--id=jeep_shoded'])).toThrow(/no recipe/);
    expect(parseMapsArgs(['--', '--id=mbt_lavi'])).toEqual(['mbt_lavi']);
  });
});

describe('the team-region luma', () => {
  it('averages the BASE colour over the alpha-0 texels only, in linear light', () => {
    // two texels: alpha 0 on a white bake, alpha 255 on black -> the mean over the team texel alone is 1
    const base = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]);
    const orm = new Uint8Array([255, 200, 0, 0, 255, 200, 0, 255]);
    expect(teamRegionLuma(base, orm)).toEqual({ luma: 1, texels: 1 });
  });
  it('refuses an ORM with no team texel', () => {
    expect(() => teamRegionLuma(new Uint8Array(4), new Uint8Array([0, 0, 0, 255]))).toThrow(/no team texel/);
  });
});
