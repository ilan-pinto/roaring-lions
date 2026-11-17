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
    expect(main).toMatch(/\.\.\.\(postureUi === null \? \{\} : \{ posture: \(\) => postureUi\.posturePicker\(\{\s*where: 'board',/);
  });
});

describe('each ruling at its place in main.ts', () => {
  it('the deploy line: only on a new campaign briefing (never the tutorial or a resumed run), and a change restarts it', () => {
    expect(main).toMatch(
      /if \(resumed === null && posture\.showsPosture\(mission\)\) \{[\s\S]{0,200}posture\.posturePicker\(\{\s*where: 'deploy',[\s\S]{0,300}onChanged: \(\) => req\.restart\(\),/
    );
    // After the briefing exists, so the line has somewhere to go.
    expect(main.search(/posture\.posturePicker\(\{\s*where: 'deploy'/)).toBeGreaterThan(main.search(/const loading = showLoading\(/));
  });

  it('the defeat suggestion comes from the posture module and rides the debrief options; nothing else calls it', () => {
    expect(main).toMatch(
      /const suggestion = posture\.defeatSuggestion\(mev\.result, mission, ledger\);\s*const debriefOpts: DebriefOptions = \{[\s\S]{0,120}\.\.\.\(suggestion === null \? \{\} : \{ suggestion \}\),/
    );
    expect(main.match(/defeatSuggestion\(/g)?.length).toBe(1);
  });

  it('the brigade screen counts possible stars at the campaign posture', () => {
    expect(main).toMatch(/possibleStars: possibleStars\(worldData, missions as Record<string, MissionJson \| undefined>, ledgerStore\.readLedger\(\)\)/);
  });

  it('a refused resume carries the two postures to the board', () => {
    expect(main).toMatch(
      /const posture = kit\.peekResumePosture\(\);\s*return \{ state: 'refused', reason: 'moved', moved: kit\.peekResumeMoved\(\), \.\.\.\(posture === null \? \{\} : \{ posture \}\) \};/
    );
  });
});
