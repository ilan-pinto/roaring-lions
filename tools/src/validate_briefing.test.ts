// The data gate's briefing-section and briefing-image checks (GH-119), against
// fixtures it must reject and against the shipped missions, which it must pass.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTION_IDS, briefingFailures } from '../validate_briefing.mjs';

const ROOT = join(__dirname, '..', '..');
const onDisk = (p: string): boolean => existsSync(join(ROOT, 'assets', p));
const all = (): boolean => true;

const ok = {
  briefing: 'Idit has the picture. Take the ridge. Bring them home.',
  briefing_sections: [
    { id: 'situation', text: 'Idit has the picture.', image: 'ui/portraits/idit_zohar.png' },
    { id: 'execution', text: 'Take the ridge.' },
    { id: 'notes', text: 'Bring them home.' },
  ],
  briefing_image: ['ui/plates/units/inf_squad.jpg'],
};

describe('briefingFailures', () => {
  it('passes a clean sectioned mission, and one with no sections at all', () => {
    expect(briefingFailures('m', ok, onDisk)).toEqual([]);
    expect(briefingFailures('m', { briefing: 'Orders.' }, onDisk)).toEqual([]);
  });

  it('refuses an unknown section id, by name', () => {
    const bad = { ...ok, briefing_sections: [{ id: 'enemy', text: 'Idit has the picture.' }, ...ok.briefing_sections.slice(1)] };
    const f = briefingFailures('m', bad, all);
    expect(f.some((x) => x.includes('"enemy"') && x.includes('is not one of'))).toBe(true);
  });

  it('refuses a repeated section and one out of order', () => {
    const twice = { ...ok, briefing_sections: [ok.briefing_sections[0], { id: 'situation', text: 'Take the ridge.' }, ok.briefing_sections[2]] };
    expect(briefingFailures('m', twice, all).some((x) => x.includes('appears twice'))).toBe(true);
    const swapped = { ...ok, briefing_sections: [ok.briefing_sections[1], ok.briefing_sections[0], ok.briefing_sections[2]] };
    // The texts no longer spell the briefing either; the order failure must still be named.
    expect(briefingFailures('m', swapped, all).some((x) => x.includes('out of order'))).toBe(true);
  });

  it('refuses sections that do not spell the briefing', () => {
    const drift = { ...ok, briefing: ok.briefing.replace('ridge', 'hill') };
    expect(briefingFailures('m', drift, all).some((x) => x.includes('do not spell briefing'))).toBe(true);
  });

  it('refuses a missing section image and a missing pool entry', () => {
    const lost = {
      ...ok,
      briefing_sections: [{ ...ok.briefing_sections[0], image: 'ui/portraits/nobody.png' }, ...ok.briefing_sections.slice(1)],
      briefing_image: ['ui/plates/units/inf_squad.jpg', 'ui/plates/units/ghost.jpg'],
    };
    const f = briefingFailures('m', lost, onDisk);
    expect(f.some((x) => x.includes('ui/portraits/nobody.png'))).toBe(true);
    expect(f.some((x) => x.includes('ui/plates/units/ghost.jpg'))).toBe(true);
    expect(f).toHaveLength(2);
  });

  it('refuses a missing single briefing_image', () => {
    expect(briefingFailures('m', { briefing: 'Orders.', briefing_image: 'ui/plates/units/ghost.jpg' }, onDisk)).toHaveLength(1);
  });

  it('agrees with the schema enum', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'data/schemas/mission.schema.json'), 'utf8'));
    expect(schema.properties.briefing_sections.items.properties.id.enum).toEqual(SECTION_IDS);
  });

  it('passes every shipped mission, and at least one ships sections', () => {
    const dir = join(ROOT, 'data/missions');
    let sectioned = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (m.briefing_sections) sectioned++;
      expect(briefingFailures(f.replace('.json', ''), m, onDisk), f).toEqual([]);
    }
    expect(sectioned).toBeGreaterThanOrEqual(2);
  });
});
