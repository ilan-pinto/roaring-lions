// Every carrying `locate` secondary needs the ledger key it claims to feed.
//
// `carries: true` on a secondary is a promise: a later mission's `requires` can
// read what it produced. For a `locate`, that channel is `intel.marked_positions`
// -- `mission.ts`'s union of `this.marked`/`this.markedThisMission`, read by
// `spawnPlacement`'s `preMarked` branch (WP-G-E3 Task 1/2; see the `led3` comment
// in `tools/src/backtest/playtest.ts`). A mission that flags a `locate` secondary
// `carries: true` without declaring `intel.marked_positions` in `ledger.produces`
// makes a promise the campaign ledger never keeps -- the sightings never leave
// the mission, and whatever a downstream mission's `requires` expected stays an
// empty set, silently.
//
// This walks the shipped catalogue straight off disk rather than through the
// hand-maintained `missions` map `@lions/data` exports for the harness -- that
// map is a literal object one import per file, the same shape as `main.ts`'s
// `SPRITE_MAP`, and carries the identical staleness risk: a new mission dropped
// into data/missions/ without an entry there would never reach this check. A
// directory read cannot go stale that way.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const MISSIONS_DIR = `${REPO}data/missions`;

interface Objective {
  id: string;
  type: string;
  primary: boolean;
  carries?: boolean;
}

interface MissionJson {
  id?: string;
  objectives?: Objective[];
  ledger?: { requires?: string[]; produces?: string[] };
}

function missionFiles(): string[] {
  return readdirSync(MISSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

function loadMission(file: string): MissionJson {
  return JSON.parse(readFileSync(`${MISSIONS_DIR}/${file}`, 'utf8')) as MissionJson;
}

describe('a carrying locate secondary produces intel.marked_positions', () => {
  for (const file of missionFiles()) {
    const mission = loadMission(file);
    const carryingLocates = (mission.objectives ?? []).filter(
      (o) => o.primary !== true && o.carries === true && o.type === 'locate'
    );
    if (carryingLocates.length === 0) continue;

    it(`${file} declares the key its carrying locate secondary needs`, () => {
      const produces = mission.ledger?.produces ?? [];
      expect(
        produces,
        `${file} flags ${carryingLocates.map((o) => o.id).join(', ')} as a carrying ` +
          `locate secondary but ledger.produces does not include intel.marked_positions -- ` +
          `a downstream mission's requires would read an empty set`
      ).toContain('intel.marked_positions');
    });
  }
});
