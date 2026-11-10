// GH-1223: the presentation-only physics fence. Rapier (`@dimforge/*`) may be imported only under
// `packages/render/src/three/physics/`, and that folder only from `ThreeRenderer.ts` (the one door) and from the
// three folder's own specs. Nothing the physics computes may reach the sim, the network or an outcome (invariant 4);
// a fence is how "may not import" stays true without anyone remembering it.
//
// A rule of its own rather than one more `no-restricted-imports` pattern, for two measured reasons:
// - flat config keeps ONE `no-restricted-imports` option object per file, so a pattern added in one block is
//   REPLACED by every later block that sets that rule for the same file (see the roar-fence notes in
//   eslint.config.mjs); a separately named rule cannot be overwritten that way;
// - `no-restricted-imports` does not look at a dynamic `import()` (eslint.config.mjs measured it), and the physics
//   module IS loaded by a dynamic import. This rule checks static imports, re-exports, `import()` and `require()`.
//
// Pinned by tools/src/physics_fence.test.ts, which feeds the real config a crossing from each side.
import { dirname, relative, resolve, sep } from 'node:path';

export const PHYSICS_DIR = 'packages/render/src/three/physics';
export const PHYSICS_DOOR = 'packages/render/src/three/ThreeRenderer.ts';
const THREE_DIR = 'packages/render/src/three';

const posix = (p) => p.split(sep).join('/');

function check(context, node, source) {
  if (typeof source !== 'string') return;
  const cwd = context.cwd ?? process.cwd();
  const file = posix(relative(cwd, context.filename ?? context.getFilename()));
  const insidePhysics = file.startsWith(`${PHYSICS_DIR}/`);
  if (/^@dimforge(\/|$)/.test(source)) {
    if (!insidePhysics) context.report({ node, messageId: 'rapier', data: { source } });
    return;
  }
  if (!source.startsWith('.')) return;
  const target = posix(relative(cwd, resolve(dirname(resolve(cwd, file)), source)));
  if (target !== PHYSICS_DIR && !target.startsWith(`${PHYSICS_DIR}/`)) return;
  if (insidePhysics || file === PHYSICS_DOOR) return;
  if (file.startsWith(`${THREE_DIR}/`) && file.endsWith('.test.ts')) return;
  context.report({ node, messageId: 'door', data: { source } });
}

export const physicsFencePlugin = {
  rules: {
    'physics-fence': {
      meta: {
        type: 'problem',
        messages: {
          rapier:
            "'{{source}}': Rapier is presentation-only physics (GH-1223) and may be imported only under " +
            `${PHYSICS_DIR}/. Nothing it computes may reach the sim, the network or an outcome (invariant 4).`,
          door:
            "'{{source}}': the physics folder is reached only through ThreeRenderer.ts (GH-1223): one door, " +
            'so presentation-only physics cannot leak into the sim, the net package, the app or another renderer module.',
        },
        schema: [],
      },
      create(context) {
        return {
          ImportDeclaration: (node) => check(context, node, node.source.value),
          ExportNamedDeclaration: (node) => node.source && check(context, node, node.source.value),
          ExportAllDeclaration: (node) => check(context, node, node.source.value),
          ImportExpression: (node) => node.source.type === 'Literal' && check(context, node, node.source.value),
          CallExpression: (node) => {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.type === 'Literal') {
              check(context, node, node.arguments[0].value);
            }
          },
        };
      },
    },
  },
};
