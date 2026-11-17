/**
 * GH-1394: `./posture` is loaded lazily by `main.ts` to keep the entry chunk under its `webgpu:bundle` ceiling, and the posture must be applied
 * before anything reads the mission. `main.ts` cannot be booted by a unit test, so the boundary is held by what the source says.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const at = (re: RegExp): number => main.search(re);

describe('the posture lazy boundary (main.ts)', () => {
  it('never statically imports ./posture', () => {
    expect(main).not.toMatch(/^import\s[^;]*from\s+'\.\/posture';/m);
    expect(main).toMatch(/import\('\.\/posture'\)/);
  });

  it('loads it through importWithRetry, checks the abort, and sends a failed load to the board rather than booting another posture', () => {
    expect(main).toMatch(
      /const posture = await importWithRetry\(\(\) => import\('\.\/posture'\)\)\.catch\(\(\) => null\);\s*if \(req\.signal\.aborted\) return teardown;\s*if \(posture === null\) \{\s*req\.navigate\(routes\.campaign\(\), \{ replace: true \}\);\s*return teardown;/,
    );
  });

  it('applies the posture before the mission is first used, and before the loans are read', () => {
    const load = at(/import\('\.\/posture'\)/);
    const apply = at(/mission = posture\.campaignMission\(mission, ledger, t\)/);
    const loans = at(/posture\.withReliefOnLoan\(mission,/);
    const upgrades = at(/resolvedMission = resolveUpgrades\(mission/);
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(apply);
    expect(apply).toBeLessThan(loans);
    expect(apply).toBeLessThan(upgrades);
  });
});
