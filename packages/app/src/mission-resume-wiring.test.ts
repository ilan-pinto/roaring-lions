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
    const load = at(/const got = await loadResume\(/);
    const destructure = at(/const \{ boughtUnits, ownedTiers \} = accountState\(\);/);
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(destructure);
    expect(main).toMatch(/if \(!got\.ok\) \{\s*req\.navigate\(routes\.campaign\(\), \{ replace: true \}\);\s*return \(\) => undefined;/);
    expect(main).toMatch(/params\.has\('resume'\) && req\.missionId !== null && !inRoom/);
  });

  it('presets the deploy pick, answers the deploy itself, and skips the intro', () => {
    expect(main).toMatch(/let deploySelection: DeploySelection \| null = resumed\?\.inputs\.deploy == null \? null : \{ chosen: new Set\(resumed\.inputs\.deploy\) \};/);
    expect(main).toMatch(/if \(resumed !== null\) loading\.deployNow\(\);/);
    // anchored to the intro's own deps: the HUD's `resumed` line below it must not be able to satisfy this one (found by deleting the intro's)
    expect(main).toMatch(/tutorial: isTutorialMission,\s*reduced: prefersReducedMotion\(\),\s*resumed: resumed !== null,/);
  });

  it('restores onto the world startMission built, proves it, re-seeds the renderer, and drops the sim on a refusal', () => {
    expect(main).toMatch(/const r = restoreMission\(resumed\.prepared, \{ sim, runtime \}\);\s*if \(!r\.ok\) \{\s*noteResumeProblem\('failed'\);\s*teardown\(\);\s*req\.navigate\(routes\.campaign\(\), \{ replace: true \}\);\s*return \(\) => undefined;\s*\}\s*clearResumeProblem\(\);\s*renderer\.reseed\(\);\s*renderer\.settleDead\?\.\(\);/);
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
    expect(main).toMatch(/startInputs = startInputsJson\(\{ ledger, tiers: bootKit, unlocks: boughtUnits, deploy: picks === null \? null : picks\.chosen \}\);/);
    expect(main).toMatch(/shell: shellJson\(captureShell\(\{ log: missionLog, deductions, lost: lostThisMission, narratedRoe: narratedRoeReasons, evacuated: evacuatedSoFar, deadlinesWarned, limitWarned \}\)\),/);
  });
});

describe('the save is dropped when its mission is over, and only then', () => {
  it('on a victory or a defeat; NOT on Quit or Restart of a resumed mission, whose confirm says the saved game stays', () => {
    expect(main).toMatch(/if \(mev\.kind === 'missionEnd'\) \{\s*\/\/[^\n]*\n\s*if \(mission\) dropSavedMission\(mission\.id\);/);
    expect(main.match(/dropSavedMission\(/g)?.length).toBe(2); // the definition and the one call at the mission's end
    expect(main).toMatch(/if \(ok\) req\.navigate\(quitHref\(room !== null, !mission\)\);/);
    expect(main).toMatch(/if \(!ok\) return;\s*\/\/[^\n]*\n\s*req\.restart\(\);/);
    expect(main).toMatch(/leaveCopy\(!mission, resumed !== null\)/); // the pause menu's Quit says it
    expect(main).toMatch(/freePlay: !mission,\s*resumed: resumed !== null,/); // and so does the HUD's own leave
  });

  it('Save and quit asks BEFORE it cuts or writes when another mission\'s save is in the slot, and a "no" changes nothing', () => {
    const body = main.slice(at(/const saveAndQuit = async/), at(/const pauseMenuDeps = \(\): PauseDeps/));
    const ask = body.indexOf('savedMissionOtherThan(');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(body.indexOf('cutMission('));
    expect(body).toMatch(/if \(!replace\) return \{ declined: true \};/);
    expect(body.indexOf('return { declined: true }')).toBeLessThan(body.indexOf('writeSuspended('));
  });

  it('dropSavedMission removes only this mission\'s save', () => {
    const fn = main.slice(at(/function dropSavedMission/), at(/function accountState\(\)/));
    expect(fn).toMatch(/r\.state === 'ready' && r\.record\.missionId === id/);
  });

  it('a Restart of the mission route does not carry `resume` along', () => {
    expect(main).toMatch(/const q = new URLSearchParams\(req\.query\);\s*q\.delete\('resume'\);\s*void router\.navigate\(router\.href\(req\.path, q\)/);
  });
});

describe('the board and the URL', () => {
  it('the board reads the one store and opens the saved mission with `resume`', () => {
    expect(main).toMatch(/resume: \(id\) => void router\.navigate\(routes\.mission\(id, \{ resume: true \}\)\)/);
    expect(main).toMatch(/discard: \(\) => \{\s*const ok = discardSuspended\(/);
  });

  it('routes.mission spells the flag, the flag is a known parameter, and nothing else names the path', () => {
    expect(routes.mission('tel_marum_2_foothold', { resume: true })).toMatch(/^\/?.*mission\/tel_marum_2_foothold\?resume=1$/);
    expect(routes.mission('tel_marum_2_foothold')).not.toContain('resume');
    expect(KNOWN_PARAMS.some((p) => p.name === 'resume')).toBe(true);
    expect(unknownParams(new URLSearchParams('resume=1'))).toEqual([]);
    expect(unknownParams(new URLSearchParams('resum=1'))).toEqual(['resum']);
  });
});
