import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { menuUsesPlate, ShotLog, SHOT_TIMEOUT_MS } from './shot-policy';

describe('shot policy (GH-1409)', () => {
  it('the menu is shot on the plate path under software rendering, and live under Metal', () => {
    expect(menuUsesPlate('swiftshader')).toBe(true);
    expect(menuUsesPlate('metal')).toBe(false);
  });

  it('the screenshot backstop is well past the 30 s that failed on CI', () => {
    expect(SHOT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });

  it('records a failed shot with the first line of why, in order, and says how many are missing', () => {
    const log = new ShotLog();
    log.record('01-menu', new Error('page.screenshot: Timeout 30000ms exceeded.\nCall log:\n  - taking page screenshot'));
    log.record('02-campaign', 'plain string');
    expect(log.failed).toEqual([
      { name: '01-menu', reason: 'page.screenshot: Timeout 30000ms exceeded.' },
      { name: '02-campaign', reason: 'plain string' },
    ]);
    expect(log.summary()).toEqual([
      '  FAILED 01-menu: page.screenshot: Timeout 30000ms exceeded.',
      '  FAILED 02-campaign: plain string',
      'screenshots: 2 shot(s) FAILED and are missing from the output',
    ]);
  });

  it('a clean run says so, so silence is never the answer', () => {
    expect(new ShotLog().summary()).toEqual(['screenshots: every shot above was taken']);
  });
});

describe('shoot.ts uses the policy (a source guard: shoot.ts runs its whole walk at import, so it cannot be loaded here)', () => {
  const src = readFileSync(new URL('./shoot.ts', import.meta.url), 'utf8');

  it('gives every shot() the backstop timeout, records a failure instead of throwing, and shoots the menu on the plate path when told to', () => {
    expect(src).toContain('timeout: SHOT_TIMEOUT_MS });');
    expect(src).toContain('SHOTS.record(name, err);');
    expect(src).toContain("const platePath = menuUsesPlate(gpu);");
    expect(src).toContain("await page.emulateMedia({ reducedMotion: 'reduce' });");
    expect(src).toContain("await page.emulateMedia({ reducedMotion: 'no-preference' });");
  });

  it('asks shot() whether the PNG was taken before it asserts the outcome moment is still up, at both call sites', () => {
    expect(src).toContain('opts: { fullPage?: boolean } = {}): Promise<boolean> {');
    expect(src).toMatch(/\[SCREENSHOT FAILED\][^\n]*\n\s*return false;/);
    expect(src).toContain('let defeatShot = await shot(page, dir, \'25-outcome-defeat\');');
    expect(src).toContain('if (defeatShot) {');
    expect(src).toContain('defeatShot = !outcomeDismissed(');
    expect(src).toContain('victoryShot = !outcomeDismissed(');
    expect(src).toContain('let victoryShot = await shot(winPage, dir, \'24-outcome-victory\');');
    expect(src).toContain('if (victoryShot) {');
    expect(src).toContain("if (defeatShot || (await page.locator('.rl-outcome__skip').count()) > 0) await page.click('.rl-outcome__skip');");
  });

  it('turns a dismissed outcome moment into a recorded failure and a removed PNG, rethrowing anything else (the first CI run died here)', () => {
    expect(src).toContain('if (!(err instanceof OutcomeMomentDismissedError)) throw err;');
    expect(src).toContain('SHOTS.record(label, err);\n    fs.rmSync(path.join(dir, `${label}.png`), { force: true });');
    // the throwing guard is called only through the wrapper, never bare, at either site
    expect(src.match(/assertOutcomeStillPresent\(/g)?.length).toBe(1); // the one call, inside the wrapper's try
  });

  it('prints the failures at the end and exits non-zero when any shot is missing', () => {
    expect(src).toContain('for (const line of SHOTS.summary()) console.log(line);');
    expect(src).toContain('if (SHOTS.failed.length > 0) process.exitCode = 1;');
  });
});
