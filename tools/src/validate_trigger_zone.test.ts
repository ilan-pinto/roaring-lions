// GH-1438 E5: `do.zone` only on the kinds whose runtime reads it, and only naming a zone the map has
// (docs/campaign/civilian-drama.md §10.2, N24, L-2). Its own module for the reason every validate_*.mjs is one:
// validate_data.mjs runs its whole sweep at import time and exits, so a test cannot import it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { triggerZoneFailures, ZONED_TRIGGER_KINDS } from '../validate_trigger_zone.mjs';

const ROOT = join(__dirname, '..', '..');
const MAP = { zones: { pen: [0, 0, 4, 4] } };

function mission(kind: string, zone: string): Record<string, unknown> {
  return { triggers: [{ id: 't', on: { kind: 'timer_s', value: 1 }, do: { kind, group: 'g', to: 'm', zone } }] };
}

describe('triggerZoneFailures', () => {
  it('accepts a zone the map has on remove, commit and withdraw_to', () => {
    // Literals, not ZONED_TRIGGER_KINDS: the oracle must not import the list it checks.
    for (const kind of ['remove', 'commit', 'withdraw_to']) {
      expect(triggerZoneFailures(mission(kind, 'pen'), MAP, 'f.json')).toEqual([]);
    }
    expect([...ZONED_TRIGGER_KINDS].sort()).toEqual(['commit', 'remove', 'withdraw_to']);
  });

  it('refuses a zone on a kind the runtime does not read it on', () => {
    for (const kind of ['spawn', 'reinforce', 'dismount']) {
      expect(triggerZoneFailures(mission(kind, 'pen'), MAP, 'f.json')).toEqual([
        `f.json: trigger "t" (${kind}) carries do.zone "pen", which only remove, commit and withdraw_to read (GH-1438 E5)`,
      ]);
    }
  });

  it('refuses a zone the map lacks, on every kind that reads one', () => {
    for (const kind of ['remove', 'commit', 'withdraw_to']) {
      expect(triggerZoneFailures(mission(kind, 'pne'), MAP, 'f.json')).toEqual([
        `f.json: trigger "t" (${kind}) do.zone names unknown zone "pne"; with no zone it would act on the whole group`,
      ]);
    }
  });

  it('says nothing about a trigger with no do.zone', () => {
    expect(triggerZoneFailures({ triggers: [{ on: { kind: 'timer_s', value: 1 }, do: { kind: 'spawn', units: [] } }] }, MAP, 'f.json')).toEqual([]);
  });

  it('every shipped mission passes', () => {
    const maps = new Map<string, unknown>();
    for (const f of readdirSync(join(ROOT, 'data/maps'))) {
      if (!f.endsWith('.json')) continue;
      maps.set(f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(ROOT, 'data/maps', f), 'utf8')));
    }
    let read = 0;
    const failures: string[] = [];
    for (const f of readdirSync(join(ROOT, 'data/missions'))) {
      if (!f.endsWith('.json')) continue;
      const m = JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')) as { map: { file: string } };
      failures.push(...triggerZoneFailures(m, maps.get(m.map.file), f));
      read++;
    }
    expect(read).toBeGreaterThanOrEqual(40); // 40 on dev today: a glob that read nothing would pass vacuously
    expect(failures).toEqual([]);
  });
});
