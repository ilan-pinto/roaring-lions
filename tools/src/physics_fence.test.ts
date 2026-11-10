// GH-1223: presentation-only physics is fenced (tools/physics_fence.mjs, wired in eslint.config.mjs). A fence nobody
// has watched fail is a comment, so this feeds the REAL config a crossing from each side -- static, re-export,
// dynamic `import()` and `require` -- and controls that must stay legal.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: root });

async function fenced(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
  return result.messages.filter((m) => m.ruleId === 'lions-physics/physics-fence').map((m) => m.message);
}

const RAPIER = '@dimforge/rapier3d-deterministic-compat';

const CROSSINGS: [string, string][] = [
  ['packages/sim/src/index.ts', `import R from '${RAPIER}';\nvoid R;\n`],
  ['packages/net/src/index.ts', `import R from '${RAPIER}';\nvoid R;\n`],
  ['packages/worker/src/index.ts', `export * from '${RAPIER}';\n`],
  ['packages/app/src/main.ts', `void import('${RAPIER}');\n`],
  ['packages/render/src/index.ts', `import R from '${RAPIER}';\nvoid R;\n`],
  // Inside the renderer's three folder, but outside the physics folder.
  ['packages/render/src/three/units/x.ts', `const R = await import('${RAPIER}');\nvoid R;\n`],
  ['packages/render/src/three/units/x.ts', `import R from '@dimforge/rapier3d-compat';\nvoid R;\n`],
  ['tools/src/x.ts', `// eslint-disable-next-line @typescript-eslint/no-require-imports\nconst R = require('${RAPIER}');\nvoid R;\n`],
  // The physics folder's door: only ThreeRenderer.ts.
  ['packages/render/src/three/units/x.ts', "import { loadRapier } from '../physics/rapier';\nvoid loadRapier;\n"],
  ['packages/render/src/three/decal-maths.ts', "export { RagdollSystem } from './physics/ragdoll-system';\n"],
  ['packages/app/src/main.ts', "import { loadRapier } from '../../render/src/three/physics/rapier';\nvoid loadRapier;\n"],
  ['packages/sim/src/index.ts', "import { loadRapier } from '../../render/src/three/physics/rapier';\nvoid loadRapier;\n"],
  // Design guard 3: the physics folder imports nothing from the sim, values or types.
  ['packages/render/src/three/physics/zz.ts', "import type { SimState } from '@lions/sim';\nexport type X = SimState;\n"],
  ['packages/render/src/three/physics/zz.ts', "import { fx } from '@lions/sim/fixed';\nvoid fx;\n"],
  ['packages/render/src/three/physics/zz.ts', "import { Sim } from '../../../../sim/src/index';\nvoid Sim;\n"],
];

const LEGAL: [string, string][] = [
  ['packages/render/src/three/physics/rapier.ts', `const m = await import('${RAPIER}');\nvoid m;\n`],
  ['packages/render/src/three/physics/ragdoll-world.ts', `import type R from '${RAPIER}';\nexport type X = typeof R;\n`],
  ['packages/render/src/three/ThreeRenderer.ts', "import { RagdollSystem } from './physics/ragdoll-system';\nvoid RagdollSystem;\n"],
  ['packages/render/src/three/ThreeRenderer.ragdoll.test.ts', "import { loadRapier } from './physics/rapier';\nvoid loadRapier;\n"],
];

describe('GH-1223: Rapier only under three/physics, that folder only through ThreeRenderer.ts', () => {
  for (const [file, code] of CROSSINGS) {
    it(`${file}: ${code.split('\n').find((l) => !l.startsWith('//'))}`, async () => {
      const found = await fenced(file, code);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/GH-1223/);
    });
  }
  for (const [file, code] of LEGAL) {
    it(`legal: ${file}`, async () => {
      expect(await fenced(file, code)).toEqual([]);
    });
  }
});
