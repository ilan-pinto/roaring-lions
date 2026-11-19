/**
 * GH-1394 slice 2: the posture UI (`ui/posture-ui.ts`, `ui/posture-copy.ts`) stays off the entry chunk, and `main.ts` wires
 * each of the lead's rulings at the place it applies. `main.ts` cannot be booted by a unit test, so, like
 * `posture-wiring.test.ts`, this holds what the source says: the shape and the order, not the behaviour.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const menu = readFileSync(join(__dirname, 'ui/menu.ts'), 'utf8');
const debrief = readFileSync(join(__dirname, 'ui/debrief.ts'), 'utf8');
const loading = readFileSync(join(__dirname, 'ui/loading.ts'), 'utf8');
const staticImport = (mod: string): RegExp => new RegExp(`^import\\s+(?!type\\b)[^;]*from\\s+'${mod.replace(/[./]/g, (c) => `\\${c}`)}';`, 'm');

describe('the posture UI lazy boundary', () => {
  it('main.ts, menu.ts, debrief.ts and loading.ts never statically import the posture UI', () => {
    for (const [name, src] of [['main', main], ['menu', menu], ['debrief', debrief], ['loading', loading]] as const) {
      for (const mod of ['./ui/posture-ui', './posture-ui', './ui/posture-copy', './posture-copy']) {
        expect(src, `${name} imports ${mod}`).not.toMatch(staticImport(mod));
      }
    }
  });

  it('the board fetches it through importWithRetry, beside the save kit, and opens without it on a failed load', () => {
    expect(main).toMatch(/const postureUiLoad = importWithRetry\(\(\) => import\('\.\/ui\/posture-ui'\)\)\.catch\(\(\) => null\);/);
    expect(main).toMatch(/const postureUi = await postureUiLoad;\s*if \(req\.signal\.aborted\) return \(\) => undefined;/);
    // Started before the save kit is awaited, so the two load side by side.
    expect(main.search(/const postureUiLoad = /)).toBeLessThan(main.search(/const kit = await saveKit\(\)/));
    // The deps are `boardPostureDeps`'s (unit-tested in `ui/posture-ui.test.ts`), handed the campaign store itself.
    expect(main).toMatch(/\.\.\.\(postureUi === null \? \{\} : \{ posture: \(\) => postureUi\.posturePicker\(postureUi\.boardPostureDeps\(ledgerStore\)\) \}\),/);
  });
});

describe('each ruling at its place in main.ts', () => {
  it('the deploy line: only on a new campaign briefing (never the tutorial or a resumed run), and a change restarts it with the run’s amendments', () => {
    // The whole block, exactly: the deps are `deployPostureDeps`'s (its `?fresh` guards are unit-tested in
    // `ui/posture-ui.test.ts`), fed the URL's `fresh`, the ledger this boot read, the campaign store and the restart; the line
    // is mounted under the orders (or in the box), and its disposer is registered where it is made. The restart carries this
    // run's amendments (GH-1395 slice 2, the lead's ruling on the review): a posture change keeps the picked set, and
    // `amendmentsForRun` judges it again on the new posture, so on Easier it drops (`challenge-ui.test.ts`).
    expect(main).toMatch(
      new RegExp(
        [
          String.raw`if \(resumed === null && posture\.showsPosture\(mission\)\) \{`,
          String.raw`const line = posture\.posturePicker\(posture\.deployPostureDeps\(\{ fresh: params\.get\('fresh'\) !== null, ledger, store: ledgerStore, restart: \(\) => req\.restart\(\{ amendments: runAmendments \}\) \}\)\);`,
          String.raw`\(stage\.querySelector\('\.rl-loading__orders'\) \?\? stage\.querySelector\('\.rl-loading__box'\)\)\?\.append\(line\.el\);`,
          String.raw`onDispose\(line\.dispose\);`,
        ].join(String.raw`\s*`)
      )
    );
    // `ledger` is the one this boot read: `{}` under `?fresh`, never the store.
    expect(main).toMatch(/const ledger: CampaignLedger = params\.get\('fresh'\) !== null \? \{\} : ledgerStore\.readLedger\(\);/);
    // No restart in main.ts sheds the run's amendments: every call names them (the posture line, the pause menu's Restart),
    // and only the amendments panel hands a NEW set.
    expect(main).not.toMatch(/req\.restart\(\s*\)/);
    // After the briefing exists, so the line has somewhere to go.
    expect(main.search(/posture\.posturePicker\(posture\.deployPostureDeps\(/)).toBeGreaterThan(main.search(/const loading = showLoading\(/));
  });

  it('the deploy line is frozen the moment Deploy is answered (review finding 2)', () => {
    // The line hands its `freeze` out where it is made, and the default does nothing (no line: the tutorial, a resumed run).
    expect(main).toMatch(/let freezePostureLine = \(\): void => undefined;\s*if \(resumed === null && posture\.showsPosture\(mission\)\) \{/);
    expect(main).toMatch(/onDispose\(line\.dispose\);\s*freezePostureLine = line\.freeze;\s*\}/);
    // Among the statements straight after `loading.done()` settles, before the abort check and before anything else can
    // yield. The amendments panel's freeze (GH-1395 slice 2) shares that run, in either order: nothing but comments and the
    // two freeze calls may stand between the catch block and the abort check.
    expect(main).toMatch(
      /await loading\.done\(\{ keep: introPlanned !== null \}\);\s*\} catch \(err\) \{\s*teardown\(\);\s*throw err;\s*\}\s*(?:(?:\/\/[^\n]*|freezeAmendments\(\);)\s*)*freezePostureLine\(\);\s*(?:(?:\/\/[^\n]*|freezeAmendments\(\);)\s*)*if \(req\.signal\.aborted\) abandon\('left before deploy'\);/
    );
    expect(main.match(/freezePostureLine\(\)/g)?.length).toBe(1);
  });

  it('an abort after the renderer exists tears the boot down: no exit between the renderer and the intro returns a bare no-op', () => {
    // The save library's await, after Deploy: the abort there (a posture click in that window, before the freeze existed, or
    // any navigation) must release the renderer and the sim, as every other abort check below the renderer does.
    expect(main).toMatch(
      /const sk: typeof SaveKit \| null = resumeKit \?\? \(resolvedMission \? await saveKit\(\)\.catch\(\(\) => null\) : null\);\s*(?:\/\/[^\n]*\n\s*)*if \(req\.signal\.aborted\) abandon\('[^']+'\);/
    );
    const from = main.search(/const \{ ThreeRenderer \} = await import\('@lions\/render\/three'\);/);
    const to = main.search(/const run = runMissionIntro\(\{/);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const boot = main.slice(from, to);
    expect(boot).not.toMatch(/if \(req\.signal\.aborted\) return \(\) => undefined;/);
    // Every remaining bare-no-op exit in that stretch has run `teardown()` just before it.
    const exits = [...boot.matchAll(/return \(\) => undefined;/g)].map((m) => m.index);
    for (const at of exits) expect(boot.slice(Math.max(0, at - 160), at), `exit at +${at}`).toMatch(/teardown\(\);/);
  });

  it('the defeat suggestion comes from the posture module and rides the debrief options; nothing else calls it', () => {
    expect(main).toMatch(
      /const suggestion = posture\.defeatSuggestion\(mev\.result, mission, ledger\);\s*const debriefOpts: DebriefOptions = \{[\s\S]{0,120}\.\.\.\(suggestion === null \? \{\} : \{ suggestion \}\),/
    );
    expect(main.match(/defeatSuggestion\(/g)?.length).toBe(1);
  });

  it('the brigade screen counts possible stars at the campaign posture', () => {
    expect(main).toMatch(/possibleStars: possibleStars\(worldData, missionManifest as Record<string, MissionSummary \| undefined>, ledgerStore\.readLedger\(\)\)/);
  });

  it('a refused resume carries the two postures to the board', () => {
    expect(main).toMatch(
      /const posture = kit\.peekResumePosture\(\);\s*return \{ state: 'refused', reason: 'moved', moved: kit\.peekResumeMoved\(\), \.\.\.\(posture === null \? \{\} : \{ posture \}\) \};/
    );
  });
});
