/**
 * GH-1394: `./posture` is loaded lazily by `main.ts` to keep the entry chunk under its `webgpu:bundle` ceiling, and the posture must be applied
 * before anything reads the mission. `main.ts` cannot be booted by a unit test, so the boundary is held by what the source says.
 *
 * GH-1395 (PR 1524 review, finding 2): the challenge code behind the posture (`./challenge`, `./victory-settle` and
 * `@lions/economy/challenge-earn`) must stay off the entry chunk too. A grep of main.ts cannot see a static import added
 * one module deeper, so the last block walks main.ts's STATIC graph: relative imports and `@lions/*` package exports,
 * through `import`, `export ... from` and side-effect imports, skipping `import type`, `export type` and `import()`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const at = (re: RegExp): number => main.search(re);

const REPO = resolve(__dirname, '../../..');
const PACKAGES = join(REPO, 'packages');

/** The file a specifier names, or null for anything that is not our TypeScript (assets, JSON, CSS, third-party packages). */
function resolveSpecifier(from: string, spec: string): string | null {
  const bare = spec.replace(/\?.*$/, '');
  let base: string;
  if (bare.startsWith('.')) {
    base = resolve(dirname(from), bare);
  } else {
    const m = /^@lions\/([^/]+)(\/.+)?$/.exec(bare);
    if (m === null) return null;
    const pkg = join(PACKAGES, m[1] ?? '');
    const exportsMap = (JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')) as { exports?: Record<string, string> }).exports ?? {};
    const target = exportsMap[`.${m[2] ?? ''}`];
    if (target === undefined) throw new Error(`${relative(REPO, from)}: '${spec}' is not an export of @lions/${m[1]}`);
    base = join(pkg, target);
  }
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (/\.tsx?$/.test(cand) && existsSync(cand)) return cand;
  }
  if (/\.(json|css|svg|png|jpe?g|glb|wasm|txt|md)$/.test(base)) return null;
  throw new Error(`${relative(REPO, from)}: cannot resolve '${spec}'`);
}

/** Every specifier a module loads at evaluation time: type-only imports and exports, and dynamic `import()`, are not edges. */
function staticSpecifiers(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: string[] = [];
  for (const node of src.statements) {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly === true) continue;
      if (ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) continue;
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    }
  }
  return out;
}

/** The static closure of `entry`, each file mapped to the file that first pulled it in. */
function staticGraph(entry: string): Map<string, string | null> {
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const spec of staticSpecifiers(file)) {
      const next = resolveSpecifier(file, spec);
      if (next === null || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return parent;
}

function chain(graph: Map<string, string | null>, file: string): string {
  const path: string[] = [];
  for (let f: string | null | undefined = file; f != null; f = graph.get(f)) path.unshift(relative(REPO, f));
  return path.join(' -> ');
}

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

describe('the challenge code stays off the entry chunk (main.ts static graph)', () => {
  const graph = staticGraph(join(__dirname, 'main.ts'));
  const files = [...graph.keys()].map((f) => relative(REPO, f));

  it('walks the real graph, not an empty one', () => {
    // Coverage self-check: the walk must cross into the shell, the renderer API, the sim, the data and the economy
    // packages, and reach far more than main.ts's own imports, or the checks below pass on nothing.
    for (const known of [
      'packages/app/src/shell/router.ts',
      'packages/app/src/shell/links.ts',
      'packages/render/src/index.ts',
      'packages/sim/src/index.ts',
      'packages/data/src/index.ts',
      'packages/economy/src/index.ts',
      'packages/app/src/roar-earn.ts',
    ]) {
      expect(files, known).toContain(known);
    }
    expect(files.length).toBeGreaterThan(300);
  });

  it.each([
    ['./victory-settle', 'packages/app/src/victory-settle.ts'],
    ['./challenge', 'packages/app/src/challenge.ts'],
    ['@lions/economy/challenge-earn', 'packages/economy/src/challenge-earn.ts'],
    ['./posture', 'packages/app/src/posture.ts'],
    // GH-1395 slice 2: the deploy panel and the board's mark. (The catalogue, `@lions/data`'s challenges.ts, IS in this
    // graph through the data barrel and is tree-shaken there; `webgpu:bundle`'s byte ceiling is its guard, not this walk.)
    ['./ui/amendments-ui', 'packages/app/src/ui/amendments-ui.ts'],
    ['./ui/challenge-board', 'packages/app/src/ui/challenge-board.ts'],
  ])('never reaches %s through a static import', (_spec, file) => {
    const target = join(REPO, file);
    expect(existsSync(target), `${file} must exist, or this check guards nothing`).toBe(true);
    // The failure message is the import chain from main.ts, so a red run names the offending edge.
    expect(graph.has(target), graph.has(target) ? `statically reached: ${chain(graph, target)}` : '').toBe(false);
  });
});

/**
 * GH-1395 slice 2: main.ts's call sites for the challenge UI. main.ts cannot be booted by a unit test, so, as above, the
 * wiring is held by what the source says; the rules each line calls are unit-tested (`challenge-ui.test.ts`,
 * `ui/amendments-ui.test.ts`). Each assertion was seen red under a one-line mutation of main.ts (the commit lists them).
 */
describe('the challenge UI wiring (main.ts, GH-1395 slice 2)', () => {
  it('judges the run’s ids once, after the posture chunk loads and before the posture is applied: a resume plays the save’s', () => {
    const load = at(/import\('\.\/posture'\)/);
    const judge = at(/posture\.amendmentsForRun\(\{ mission, ledger, requested: req\.amendments, saved: resumed === null \? null : \(resumed\.inputs\.amendments \?\? \[\]\) \}\)/);
    const apply = at(/mission = posture\.campaignMission\(mission, ledger, t\)/);
    const amend = at(/if \(mission !== undefined && runAmendments\.length > 0\) mission = posture\.amended\(mission, runAmendments\);/);
    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(judge);
    expect(judge).toBeLessThan(apply);
    expect(apply).toBeLessThan(amend);
    // A save whose ids the mission no longer offers is not loaded: the board, with the save kept.
    expect(main).toMatch(/if \('refused' in amendmentRun\) \{\s*resumeKit\?\.noteResumeProblem\('failed'\);\s*req\.navigate\(routes\.campaign\(\), \{ replace: true \}\);\s*return teardown;/);
    // Nothing reads the request's raw ids past the judgement.
    expect([...main.matchAll(/req\.amendments/g)].length).toBe(1);
  });

  it('draws the panel only on a new run the gate offered one to, and freezes it the moment Deploy is answered', () => {
    expect(main).toMatch(/if \(resumed === null && amendmentRun\.offer !== null\) \{\s*const panel = posture\.amendmentPanel\(\{ offer: amendmentRun\.offer, chosen: runAmendments, onChange: \(next\) => req\.restart\(\{ amendments: next \}\) \}\);/);
    expect(main).toMatch(/onDispose\(panel\.dispose\);\s*freezeAmendments = panel\.freeze;/);
    // Among the statements straight after `loading.done()` settles, before the abort check: the posture line's freeze
    // (GH-1394 slice 2) shares that run, in either order, and nothing but comments and the two freeze calls may stand there.
    expect(main).toMatch(
      /await loading\.done\(\{ keep: introPlanned !== null \}\);\s*\} catch \(err\) \{\s*teardown\(\);\s*throw err;\s*\}\s*(?:(?:\/\/[^\n]*|freezePostureLine\(\);)\s*)*freezeAmendments\(\);\s*(?:(?:\/\/[^\n]*|freezePostureLine\(\);)\s*)*if \(req\.signal\.aborted\) abandon\('left before deploy'\);/
    );
    expect(main.match(/freezeAmendments\(\)/g)?.length).toBe(1);
  });

  it('carries the run’s ids into the start inputs, the save record, the replay and Restart (D10)', () => {
    expect(main).toMatch(/sk\?\.startInputsJson\(\{ ledger, tiers: bootKit, unlocks: boughtUnits, deploy: picks === null \? null : picks\.chosen, amendments: runAmendments \}\)/);
    expect(main).toMatch(/campaign: startInputs,\s*(\/\/[^\n]*\n\s*)*\.\.\.\(runAmendments\.length > 0 \? \{ amendments: runAmendments \} : \{\}\),/);
    expect(main).toMatch(/deploy: picks === null \? null : \[\.\.\.picks\.chosen\],\s*(\/\/[^\n]*\n\s*)*\.\.\.\(runAmendments\.length > 0 \? \{ amendments: \[\.\.\.runAmendments\] \} : \{\}\),/);
    expect(main).toMatch(/req\.restart\(\{ amendments: runAmendments \}\);/);
    // The mission route hands a restart's ids to the NEXT mount of that mission only, once.
    expect(main).toMatch(/const carried = amendmentCarry !== null && amendmentCarry\.missionId === req\.params\.id \? amendmentCarry\.ids : undefined;\s*amendmentCarry = null;/);
    expect(main).toMatch(/amendmentCarry = ids\.length > 0 \? \{ missionId: req\.params\.id, ids: \[\.\.\.ids\] \} : null;/);
  });

  it('judges the victory, and words its rung, on the run’s own ids', () => {
    expect(main).toMatch(/posture\.victoryMark\(mission, ledger, runAmendments, runtime, mev\)/);
    expect(main).toMatch(/challenge: mev\.result === 'victory' \? posture\.victoryRung\(mission, runAmendments, challengeMark, runtime, mev\) : null,/);
  });

  it('the board fetches its mark lazily, and opens without it if that chunk will not load', () => {
    expect(main).toMatch(/const challengeBoardLoad = importWithRetry\(\(\) => import\('\.\/ui\/challenge-board'\)\)\.catch\(\(\) => null\);/);
    expect(main).toMatch(/\.\.\.\(challengeBoard === null \? \{\} : \{ townMark: challengeBoard\.challengeTownMark\(boardWorld, boardLedger\) \}\),/);
    expect(main).not.toMatch(/^import\s[^;]*from\s+'\.\/ui\/(challenge-board|amendments-ui)';/m);
  });
});
