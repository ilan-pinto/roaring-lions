import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HUD_ELEMENTS, isHudElement } from './hud-elements';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const schema = (name: string): { $defs: { hudElement: { enum: string[] } } } =>
  JSON.parse(readFileSync(`${ROOT}data/schemas/${name}`, 'utf8'));

describe('HUD_ELEMENTS', () => {
  // Both ways, both schemas: an id in the array and not the enum is a surface
  // no data can name; an id in the enum and not the array is one validate:data
  // accepts and nothing reads.
  for (const file of ['tutorial.schema.json', 'mission.schema.json']) {
    it(`is exactly ${file}'s hudElement enum`, () => {
      expect([...schema(file).$defs.hudElement.enum].sort()).toEqual([...HUD_ELEMENTS].sort());
    });
  }

  it('has no duplicate', () => {
    expect(new Set(HUD_ELEMENTS).size).toBe(HUD_ELEMENTS.length);
  });

  it('isHudElement refuses an id that is not in the list', () => {
    expect(isHudElement('minimap')).toBe(true);
    expect(isHudElement('radar')).toBe(false);
  });
});
