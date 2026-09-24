import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CAMPAIGN_ORDER, MISSION_TARGET_MINUTES } from './campaign-order';

const DIR = fileURLToPath(new URL('../../../data/missions/', import.meta.url));
const fromData: Record<string, number> = {};
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
  const m = JSON.parse(readFileSync(DIR + f, 'utf8')) as { id: string; target_minutes?: number };
  if (m.target_minutes !== undefined) fromData[m.id] = m.target_minutes;
}

describe('campaign order and targets', () => {
  it('MISSION_TARGET_MINUTES matches data/missions exactly', () => {
    expect(MISSION_TARGET_MINUTES, `paste this into campaign-order.ts:\n${JSON.stringify(fromData, null, 2)}`).toEqual(fromData);
  });
  it('the order starts at the tutorial and names only real missions, once each', () => {
    expect(CAMPAIGN_ORDER[0]).toBe('beit_sahwan_0_tutorial');
    expect(new Set(CAMPAIGN_ORDER).size).toBe(CAMPAIGN_ORDER.length);
    for (const id of CAMPAIGN_ORDER) expect(fromData, id).toHaveProperty(id);
  });
});
