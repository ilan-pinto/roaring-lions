// GH-317, gate G-V2: the Roar-coin wallet is fenced out of the sim, the renderer, the net
// package and the app's versus plumbing by `no-restricted-imports` (eslint.config.mjs). A
// fence nobody has watched fail is a comment, so this feeds the real config a file that
// crosses it, from each side, and a control that must stay legal.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: root });

async function restricted(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

const FENCED: [string, string][] = [
  ['packages/app/src/net/match-world.ts', "import { emptyRoar } from '../roar-wallet';\nvoid emptyRoar;\n"],
  ['packages/app/src/net/match-world.ts', "import { roarEarn } from '../roar-earn';\nvoid roarEarn;\n"],
  ['packages/app/src/net/connect.ts', "import { accountView } from '../account-view';\nvoid accountView;\n"],
  ['packages/sim/src/index.ts', "import { emptyRoar } from '../../app/src/roar-wallet';\nvoid emptyRoar;\n"],
  ['packages/render/src/index.ts', "import { emptyRoar } from '../../app/src/roar-wallet';\nvoid emptyRoar;\n"],
  ['packages/render/src/three/units/x.ts', "import { emptyRoar } from '../../../../app/src/roar-wallet';\nvoid emptyRoar;\n"],
  ['packages/net/src/index.ts', "import { emptyRoar } from '../../app/src/roar-wallet';\nvoid emptyRoar;\n"],
  ['packages/app/src/net/match-world.ts', "import { networkView } from '@lions/economy';\nvoid networkView;\n"],
  ['packages/worker/src/match/match-room.ts', "import { emptyRoar } from '@lions/economy';\nvoid emptyRoar;\n"],
  ['packages/worker/src/match/routes.ts', "import { emptyRoar } from '../../../app/src/roar-wallet';\nvoid emptyRoar;\n"],
];

describe('G-V2: the wallet is fenced out of versus and the sim', () => {
  for (const [file, code] of FENCED) {
    it(`${file} cannot import ${/'([^']+)'/.exec(code)?.[1]}`, async () => {
      const found = await restricted(file, code);
      expect(found.length).toBe(1);
      expect(found[0]).toMatch(/single-player/);
    });
  }

  it('the control: the shell (main.ts) and the Stores may import the wallet', async () => {
    expect(await restricted('packages/app/src/main.ts', "import { emptyRoar } from './roar-wallet';\nvoid emptyRoar;\n")).toEqual([]);
    expect(await restricted('packages/app/src/ui/stores.ts', "import { EARN } from '../roar-earn';\nvoid EARN;\n")).toEqual([]);
  });

  it('the control: the Worker account routes may import @lions/economy', async () => {
    expect(await restricted('packages/worker/src/account/routes.ts', "import { emptyRoar } from '@lions/economy';\nvoid emptyRoar;\n")).toEqual([]);
  });

  it('the fence EXTENDS the bundle rule in the app net folder, never replaces it', async () => {
    const found = await restricted('packages/app/src/net/match-world.ts', "import { ThreeRenderer } from '@lions/render/three';\nvoid ThreeRenderer;\n");
    expect(found.length).toBe(1);
    expect(found[0]).toMatch(/dynamic import/);
  });
});
