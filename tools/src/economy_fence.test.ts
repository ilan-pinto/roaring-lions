// GH-1075 A0: @lions/economy is a leaf over @lions/sim and @lions/data. Feed the real eslint
// config a file that crosses the fence from each side, and a control that must stay legal.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: root });

async function restricted(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
  return result.messages
    .filter((m) => m.ruleId === 'no-restricted-syntax' || m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

const FILE = 'packages/economy/src/x.ts';

describe('@lions/economy imports @lions/sim and @lions/data only', () => {
  for (const pkg of ['app', 'render', 'worker', 'net']) {
    it(`cannot import @lions/${pkg}`, async () => {
      const found = await restricted(FILE, `import { t } from '@lions/${pkg}/src/i18n/t';\nvoid t;\n`);
      // A bare `@lions/x/src/..` specifier matches both selectors, so two reports of the same message.
      expect(found.length).toBeGreaterThanOrEqual(1);
      for (const m of found) expect(m).toMatch(/@lions\/economy imports @lions\/sim and @lions\/data only/);
    });
  }

  it('cannot reach the app by a relative path', async () => {
    const found = await restricted(FILE, "import { emptyRoar } from '../../app/src/roar-wallet';\nvoid emptyRoar;\n");
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it('cannot re-export from the app', async () => {
    const named = await restricted(FILE, "export { t } from '@lions/app';\n");
    const all = await restricted(FILE, "export * from '@lions/app';\n");
    expect(named.length).toBeGreaterThanOrEqual(1);
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(named[0]).toMatch(/@lions\/economy imports/);
    expect(all[0]).toMatch(/@lions\/economy imports/);
  });

  it('the control: sim and data are legal', async () => {
    expect(
      await restricted(FILE, "import { starsEarned } from '@lions/sim';\nimport { world } from '@lions/data';\nvoid starsEarned;\nvoid world;\n"),
    ).toEqual([]);
  });
});
