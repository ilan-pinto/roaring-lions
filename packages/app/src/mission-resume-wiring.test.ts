/**
 * GH-1393 slice 2: `main.ts` cannot be booted by a unit test, so the edit points that make Save and Resume work are held by what they say.
 * Each assertion names one thing a regression would remove; each was seen red under that removal (the commit lists them). The behaviour behind
 * them is tested where it can be: `mission-save`, `mission-resume`, `mission-shell`, the pause menu, the resume row, and the campaign
 * mission round trip in `tools/src/mission_save_campaign.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './i18n/en.json';
import { KNOWN_PARAMS, unknownParams } from './sandbox-help';
import { routes } from './shell/links';

const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const at = (re: RegExp): number => main.search(re);

describe('the resume boot (main.ts bootBattlefield)', () => {
  it('reads and checks the save BEFORE anything is built, and a save that will not start sends the player to the board', () => {
    const load = at(/const got = await loadedKit\.loadResume\(/);
    const destructure = at(/const \{ boughtUnits, ownedTiers, ownedPicks \} = accountState\(\);/);
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
    // every failure is a line, never a throw or a silent return of null before the write is kept (a torn-down battlefield aside, below)
    // (5: the content digest's on-demand load is the fifth, since the kit stopped carrying every map's JSON)
    expect(body.match(/return saveFailureText\(/g)?.length).toBe(5);
    expect(body).toMatch(/return null;\s*\};?\s*$/);
  });

  it('stops after every await once the battlefield is gone: no cut, no write, no navigation from a torn-down mission', () => {
    // The disposer contract: a Back press or another route during the kit load or the gzip tears the battlefield down, and the
    // continuation must not then write a save of a mission the player left, or navigate them off the screen they went to.
    const body = main.slice(at(/const saveAndQuit = async/), at(/const pauseMenuDeps = \(\): PauseDeps/));
    const awaits = [...body.matchAll(/\bawait\b[^;]*;/g)];
    expect(awaits.length).toBeGreaterThanOrEqual(2); // saveKit() and sealMission(): never a vacuous pass over none
    for (const a of awaits) {
      const after = body.slice((a.index ?? 0) + a[0].length).replace(/^(?:\s|\/\/[^\n]*\n)*/, '');
      expect(after.startsWith('if (disposed || stale()) return null;'), `after \`${a[0]}\` the next statement is: ${after.split('\n')[0]}`).toBe(true);
    }
  });

  it('stops after every await once its pause is over: Resume, Escape or the end while a chunk loads means no cut, no write, no leave', () => {
    // Resume and Escape stay live while a save is out (pause.ts), and the content digest's first load is a real fetch: a sim that ticked
    // since the menu opened must not be cut, and a player who went back to the mission must not be navigated off it.
    const body = main.slice(at(/const saveAndQuit = async/), at(/const pauseMenuDeps = \(\): PauseDeps/));
    expect(body).toMatch(/const menu = pauseHandle;\s*const stale = \(\): boolean => !paused \|\| pauseHandle !== menu \|\| runtime\?\.result !== 'ongoing';\s*const kit = await saveKit\(\)/);
    const awaits = [...body.matchAll(/\bawait\b[^;]*;/g)];
    expect(awaits.length).toBeGreaterThanOrEqual(4); // the kit, the replace question, the digest and the gzip
    for (const a of awaits) {
      const after = body.slice((a.index ?? 0) + a[0].length).replace(/^(?:\s|\/\/[^\n]*\n)*/, '');
      expect(/^if \([^)]*\bstale\(\)[^)]*\) return null;/.test(after), `after \`${a[0]}\` the next statement is: ${after.split('\n')[0]}`).toBe(true);
    }
    // the cut and the write come after the last stale check
    const lastCheck = body.lastIndexOf('stale()) return null;');
    expect(lastCheck).toBeLessThan(body.indexOf('writeSuspended(openSuspendStore'));
    expect(body.indexOf('if (disposed || stale()) return null; // left, resumed or ended while the digest loaded')).toBeLessThan(body.indexOf('const cut = cutMission('));
  });

  it('what is saved is what the mission was started from, and the shell', () => {
    expect(main).toMatch(/startInputs = sk\?\.startInputsJson\(\{ ledger, tiers: bootKit, picks: branchPicks, unlocks: boughtUnits, deploy: picks === null \? null : picks\.chosen \}\) \?\? null;/);
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

  it("a resumed mission's Restart confirm says the saved game stays, and a fresh mission's does not change", () => {
    expect(main).toMatch(/body: t\(resumed !== null \? 'pause\.restart\.confirm\.body\.resumed' : 'pause\.restart\.confirm\.body'\),/);
    expect(en['pause.restart.confirm.body.resumed']).toBe('This attempt is lost. Your saved game stays on the campaign map.');
    expect(en['pause.restart.confirm.body']).toBe('This attempt is lost.');
  });

  it('Save and quit asks BEFORE it cuts or writes when another mission\'s save is in the slot, and a "no" changes nothing', () => {
    const body = main.slice(at(/const saveAndQuit = async/), at(/const pauseMenuDeps = \(\): PauseDeps/));
    const ask = body.indexOf('savedMissionOtherThan(');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(body.indexOf('cutMission('));
    expect(body.indexOf('confirmReplaceOther(')).toBeLessThan(body.indexOf('cutMission('));
    expect(body).toMatch(/if \(!\(await confirmReplaceOther\(other, [^\n]*\)\) return \{ declined: true \};/);
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

describe('the lazy boundary (main red since PR 1478: the entry chunk went over its guard)', () => {
  // `pnpm --filter @lions/tools webgpu:bundle` is the byte gate; this is the cheap one that names the cause.
  const LAZY = ['ui/resume-row', 'mission-save', 'mission-save-store', 'mission-shell', 'mission-resume', 'ui/resume-copy', 'mission-save-kit'];
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
    expect(main).toMatch(/\.\.\.\(kit === null \? \{\} : \{ resume: \(\) => kit\.resumeRow\(\{/);
    expect(main).toMatch(/const sk: typeof SaveKit \| null = resumeKit \?\? \(resolvedMission \? await saveKit\(\)\.catch\(\(\) => null\) : null\);/);
  });

  it('menu.ts takes only the TYPE of the Resume row and is handed a builder; the kit carries the row', () => {
    const menu = readFileSync(join(__dirname, 'ui', 'menu.ts'), 'utf8');
    expect(menu).not.toMatch(/^import (?!type )[^;]*from '\.\/resume-row';/m);
    expect(menu).toMatch(/opts\.resume\(\)/);
    expect(readFileSync(join(__dirname, 'mission-save-kit.ts'), 'utf8')).toContain("export { resumeRow } from './ui/resume-row';");
    expect(main).toMatch(/resume: \(\) => kit\.resumeRow\(/);
  });

  it('the kit re-exports everything main.ts uses', () => {
    const kit = readFileSync(join(__dirname, 'mission-save-kit.ts'), 'utf8');
    for (const name of ['cutMission', 'restoreMission', 'sealMission', 'discardSuspended', 'openSuspendStore', 'readSuspended', 'writeSuspended', 'captureShell', 'shellJson', 'clearResumeProblem', 'loadResume', 'noteResumeProblem', 'peekResumeProblem', 'startInputsJson', 'saveFailureText']) expect(kit, name).toContain(name);
  });
});

describe('a boot left after the renderer exists tears it down (main.ts bootBattlefield)', () => {
  // The router RUNS the disposer a stale mount returns (`seq !== this.seq` in `shell/router.ts`); it does not tear down for it. So from
  // `new ThreeRenderer` on, an abort answered with a bare `() => undefined` keeps the WebGL context, the canvas, the transport and the
  // loading screen. PR 1499 shipped exactly that after the lazy save-kit await.
  const boot = main.slice(at(/^async function bootBattlefield\(/m));
  const body = boot.slice(0, boot.search(/^\}$/m));
  const built = body.slice(body.indexOf('const three = new ThreeRenderer('));

  it('every abort check after the renderer is built goes through `abandon`', () => {
    expect(body.length).toBeGreaterThan(0);
    expect(built.length).toBeLessThan(body.length);
    const checks = [...built.matchAll(/if \((?:req\.)?signal\.aborted\)\s*([^\n]*)/g)].map((m) => m[1] ?? '');
    // Not vacuous: meshes, renderer, ground photo, deploy, save kit.
    expect(checks.length).toBeGreaterThanOrEqual(5);
    for (const then of checks) expect(then, then).toMatch(/^abandon\('[^']+'\);$/);
  });

  it('no early return after the renderer is built hands back a no-op without having run the teardown', () => {
    const at0 = [...built.matchAll(/return \(\) => undefined;/g)].map((m) => m.index);
    for (const i of at0) expect(built.slice(Math.max(0, i - 160), i), built.slice(i - 160, i + 25)).toMatch(/teardown\(\);/);
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
