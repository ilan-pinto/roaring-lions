/**
 * GH-1393 slice 2: `main.ts` cannot be booted by a unit test, so the edit points that make Save and Resume work are held by what they say.
 * Each assertion names one thing a regression would remove; each was seen red under that removal (the commit lists them). The behaviour behind
 * them is tested where it can be: `mission-save`, `mission-resume`, `mission-shell`, the pause menu, the resume row, and the campaign
 * mission round trip in `tools/src/mission_save_campaign.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_PARAMS, unknownParams } from './sandbox-help';
import { routes } from './shell/links';

const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const at = (re: RegExp): number => main.search(re);

describe('the resume boot (main.ts bootBattlefield)', () => {
  it('reads and checks the save BEFORE anything is built, and a save that will not start sends the player to the board', () => {
    const load = at(/const got = await loadedKit\.loadResume\(/);
    const destructure = at(/const \{ boughtUnits, ownedTiers \} = accountState\(\);/);
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(destructure);
    expect(main).toMatch(/if \(!got\.ok\) \{\s*req\.navigate\(routes\.campaign\(\), \{ replace: true \}\);\s*return \(\) => undefined;/);
    expect(main).toMatch(/params\.has\('resume'\) && req\.missionId !== null && !inRoom/);
  });

  it('presets the deploy pick, answers the deploy itself, and skips the intro', () => {
    expect(main).toMatch(/let deploySelection: DeploySelection \| null = resumed\?\.inputs\.deploy == null \? null : \{ chosen: new Set\(resumed\.inputs\.deploy\) \};/);
    expect(main).toMatch(/if \(resumed !== null\) loading\.deployNow\(\);/);
    expect(main).toMatch(/resumed: resumed !== null,/);
  });

  it('restores onto the world startMission built, proves it, re-seeds the renderer, and drops the sim on a refusal', () => {
    expect(main).toMatch(/const r = sk\.restoreMission\(resumed\.prepared, \{ sim, runtime \}\);\s*if \(!r\.ok\) \{\s*sk\.noteResumeProblem\('failed'\);\s*teardown\(\);\s*req\.navigate\(routes\.campaign\(\), \{ replace: true \}\);\s*return \(\) => undefined;\s*\}\s*sk\.clearResumeProblem\(\);\s*renderer\.reseed\(\);\s*renderer\.settleDead\?\.\(\);/);
  });

  it('puts every part of the shell record back, and the replay log is not begun mid-mission', () => {
    for (const part of [
      /Object\.assign\(missionLog, sh\.log\);/,
      /deductions\.push\(\.\.\.sh\.deductions\);/,
      /lostThisMission\.push\(\.\.\.sh\.lost\);/,
      /narratedRoeReasons\.add\(reason\)/,
      /evacuatedSoFar = sh\.evacuated;/,
      /deadlinesWarned = new Set\(sh\.deadlinesWarned\);/,
      /limitWarned = sh\.limitWarned;/,
      /if \(resumed === null\) replayLog\.begin\(/,
    ]) expect(main, String(part)).toMatch(part);
  });

  it('lands paused', () => {
    expect(main).toMatch(/if \(introPlanned === null\) reveal\(\);\s*\/\/[^\n]*\n\s*if \(resumed !== null\) pause\(\);/);
  });
});

describe('Save and quit (main.ts)', () => {
  it('is offered only for a running campaign mission, and cuts, seals, writes with read-back, and only then leaves', () => {
    expect(main).toMatch(/\.\.\.\(runtime !== null && startInputs !== null && resolvedMission !== undefined && !isTutorialMission && netSeat === null && !spectating && netEnd === null && runtime\.result === 'ongoing'\s*\? \{ onSave: saveAndQuit \}\s*: \{\}\)/);
    const body = main.slice(at(/const saveAndQuit = async/), at(/const pauseMenuDeps = \(\): PauseDeps/));
    const order = ['cutMission(', 'sealMission(', 'writeSuspended(', 'req.navigate(routes.campaign())'].map((s) => body.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // every failure is a line, never a throw or a silent return of null before the write is kept
    expect(body.match(/return saveFailureText\(/g)?.length).toBe(4);
    expect(body).toMatch(/return null;\s*\};?\s*$/);
  });

  it('what is saved is what the mission was started from, and the shell', () => {
    expect(main).toMatch(/startInputs = sk\?\.startInputsJson\(\{ ledger, tiers: bootKit, unlocks: boughtUnits, deploy: picks === null \? null : picks\.chosen \}\) \?\? null;/);
    expect(main).toMatch(/shell: shellJson\(captureShell\(\{ log: missionLog, deductions, lost: lostThisMission, narratedRoe: narratedRoeReasons, evacuated: evacuatedSoFar, deadlinesWarned, limitWarned \}\)\),/);
  });
});

describe('the save is dropped when its mission is over', () => {
  it('on a victory or a defeat, on Quit and on Restart of a resumed mission', () => {
    expect(main).toMatch(/if \(mev\.kind === 'missionEnd'\) \{\s*\/\/[^\n]*\n\s*if \(mission\) dropSavedMission\(mission\.id\);/);
    expect(main).toMatch(/if \(resumed !== null && mission\) dropSavedMission\(mission\.id\);\s*req\.navigate\(quitHref\(/);
    expect(main).toMatch(/if \(resumed !== null && mission\) dropSavedMission\(mission\.id\);\s*req\.restart\(\);/);
  });

  it('dropSavedMission removes only this mission\'s save', () => {
    const fn = main.slice(at(/function dropSavedMission/), at(/function accountState\(\)/));
    expect(fn).toMatch(/r\.state === 'ready' && r\.record\.missionId === id/);
  });

  it('a Restart of the mission route does not carry `resume` along', () => {
    expect(main).toMatch(/const q = new URLSearchParams\(req\.query\);\s*q\.delete\('resume'\);\s*void router\.navigate\(router\.href\(req\.path, q\)/);
  });
});

describe('the lazy boundary (main red since PR 1478: the entry chunk went over its guard)', () => {
  // `pnpm --filter @lions/tools webgpu:bundle` is the byte gate; this is the cheap one that names the cause.
  const LAZY = ['mission-save', 'mission-save-store', 'mission-shell', 'mission-resume', 'ui/resume-copy', 'mission-save-kit'];
  it('main.ts imports none of the save modules except as a type, and reaches them through one dynamic import of the kit', () => {
    for (const mod of LAZY) {
      const staticValue = new RegExp(`^import (?!type )[^;]*from '\\./${mod}';`, 'm');
      expect(main, mod).not.toMatch(staticValue);
    }
    expect(main).toMatch(/importWithRetry\(\(\) => import\('\.\/mission-save-kit'\)\)/);
    expect(main.match(/import\('\.\/mission-(?:save|resume|shell)/g)?.length).toBe(1);
  });

  it('a chunk that will not load costs the Resume row or the Save button, never the board or the mission', () => {
    expect(main).toMatch(/const kit = await saveKit\(\)\.catch\(\(\) => null\);\s*if \(req\.signal\.aborted\) return \(\) => undefined;/);
    expect(main).toMatch(/\.\.\.\(kit === null \? \{\} : \{ resume: \{/);
    expect(main).toMatch(/const sk: typeof SaveKit \| null = resumeKit \?\? \(resolvedMission \? await saveKit\(\)\.catch\(\(\) => null\) : null\);/);
  });

  it('the kit re-exports everything main.ts uses', () => {
    const kit = readFileSync(join(__dirname, 'mission-save-kit.ts'), 'utf8');
    for (const name of ['cutMission', 'restoreMission', 'sealMission', 'discardSuspended', 'openSuspendStore', 'readSuspended', 'writeSuspended', 'captureShell', 'shellJson', 'clearResumeProblem', 'loadResume', 'noteResumeProblem', 'peekResumeProblem', 'startInputsJson', 'saveFailureText']) expect(kit, name).toContain(name);
  });
});

describe('the board and the URL', () => {
  it('the board reads the one store and opens the saved mission with `resume`', () => {
    expect(main).toMatch(/resume: \(id\) => void router\.navigate\(routes\.mission\(id, \{ resume: true \}\)\)/);
    expect(main).toMatch(/discard: \(\) => \{\s*const ok = kit\.discardSuspended\(/);
  });

  it('routes.mission spells the flag, the flag is a known parameter, and nothing else names the path', () => {
    expect(routes.mission('tel_marum_2_foothold', { resume: true })).toMatch(/^\/?.*mission\/tel_marum_2_foothold\?resume=1$/);
    expect(routes.mission('tel_marum_2_foothold')).not.toContain('resume');
    expect(KNOWN_PARAMS.some((p) => p.name === 'resume')).toBe(true);
    expect(unknownParams(new URLSearchParams('resume=1'))).toEqual([]);
    expect(unknownParams(new URLSearchParams('resum=1'))).toEqual(['resum']);
  });
});
