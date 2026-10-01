import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paletteColor } from '@lions/data';
import { garageColors, garageGroundTexture, garageModelSource } from './garage-model-source';

const KDF_DIR = resolve(__dirname, '../../../data/units/kdf');
const kdfIds = readdirSync(KDF_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

describe('garageModelSource', () => {
  it('finds a model for every unit the garage can show', () => {
    expect(kdfIds.length).toBeGreaterThan(10);
    for (const id of kdfIds) expect(garageModelSource(id, (f) => f), id).not.toBeNull();
  });

  it('draws the GLB the mission draws, through the same catalogue', () => {
    expect(garageModelSource('inf_squad', (f) => f)).toEqual({ kind: 'rigged', url: 'meshy_soldier.glb', faction: 'kdf' });
    expect(garageModelSource('yahalom_squad', (f) => f)).toEqual({
      kind: 'rigged',
      url: 'yahalom_engineer.glb',
      faction: 'kdf',
    });
    expect(garageModelSource('mbt_lavi', (f) => f)).toEqual({ kind: 'vehicle', url: 'vehicles/mbt_lavi.glb' });
  });

  it('answers null for a type with no mesh, which keeps its plate', () => {
    expect(garageModelSource('made_up_unit', (f) => f)).toBeNull();
  });
});

describe('the stage colours', () => {
  it('come from the palette keys the mission light uses', () => {
    const c = garageColors();
    expect(c.key).toBe(paletteColor('limestone.0'));
    expect(c.fill).toBe(paletteColor('water.0'));
    expect(c.bounce).toBe(paletteColor('dust.4'));
    expect(c.ground).toBe(paletteColor('limestone.3'));
  });

  it('stand the model on the arid ground image', () => {
    expect(garageGroundTexture('/base/')).toBe('/base/textures/desert_sand_tile.jpg');
  });
});
