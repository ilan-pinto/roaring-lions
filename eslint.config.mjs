import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const SIM_MSG =
  'Banned in @lions/sim (invariant 2, CLAUDE.md): the sim is Q16.16 fixed-point. ' +
  'Math.sin/cos/pow/exp are not bit-identical across JS engines. Use fx.* from packages/sim/src/fixed.ts.';

const TIME_MSG =
  'Banned in @lions/sim (invariant 1, CLAUDE.md): the sim runs a fixed 20 Hz tick and never reads wall time.';

export default tseslint.config(
  {
    // `.claude/worktrees/` holds throwaway checkouts of this same repository.
    // Without this, eslint walks into them and lints a second copy of the tree
    // whose env is never resolved -- 45 no-undef errors on `console`/`process`
    // in files that are already clean here. A red gate made entirely of false
    // positives is worse than no gate, because people learn to skip it.
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '.claude/worktrees/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['packages/app/**/*.ts', 'packages/render/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['tools/**/*.ts', 'tools/**/*.mjs', '*.mjs', 'packages/app/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // ------------------------------------------------------------------
  // Invariant enforcement for @lions/sim. This block is the mechanical
  // form of CLAUDE.md's invariants 1 and 2 — it exists so they can never
  // be violated by accident. Test files are exempt below: tests may use
  // Math as a floating-point *oracle* to verify fixed-point results.
  // ------------------------------------------------------------------
  {
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'Math', message: SIM_MSG },
        { name: 'Date', message: SIM_MSG },
        { name: 'parseFloat', message: SIM_MSG },
        { name: 'performance', message: TIME_MSG },
        { name: 'setTimeout', message: TIME_MSG },
        { name: 'setInterval', message: TIME_MSG },
        { name: 'requestAnimationFrame', message: TIME_MSG },
        {
          name: 'crypto',
          message:
            'Banned in @lions/sim (invariant 3): randomness comes from the seeded per-entity PRNG, rng(entityId).',
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: SIM_MSG },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=type(number)][raw=/\\./]',
          message:
            'Float literals are banned in @lions/sim (invariant 2). All values are Q16.16 — build them with fx.from at the boundary or integer expressions inside.',
        },
        {
          selector: 'Literal[value=type(number)][raw=/^[0-9][0-9_]*[eE]/]',
          message:
            'Exponent-notation literals are banned in @lions/sim (invariant 2). Use explicit integers.',
        },
        {
          selector: 'ImportDeclaration[source.value=/^[^.]/]',
          message: '@lions/sim imports NOTHING (CLAUDE.md package layout). Only relative imports are allowed.',
        },
        {
          selector: 'ExportNamedDeclaration[source.value=/^[^.]/]',
          message: '@lions/sim imports NOTHING (CLAUDE.md package layout). Only relative re-exports are allowed.',
        },
        {
          selector: 'ExportAllDeclaration[source.value=/^[^.]/]',
          message: '@lions/sim imports NOTHING (CLAUDE.md package layout). Only relative re-exports are allowed.',
        },
      ],
    },
  },
  {
    files: ['packages/sim/src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // Dependency direction is one-way: app → render → sim, data is a leaf.
  {
    files: ['packages/render/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^@lions\\u002F(app|data)/]',
          message: '@lions/render may import @lions/sim only (CLAUDE.md dependency direction).',
        },
      ],
    },
  },
  {
    files: ['packages/data/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^@lions/]',
          message: '@lions/data is a leaf and imports no other package (CLAUDE.md dependency direction).',
        },
      ],
    },
  },
  {
    files: ['tools/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^@lions\\u002F(app|render)/]',
          message: 'tools may import @lions/sim and @lions/data only.',
        },
      ],
    },
  },

  // Bundle regression guard (CLAUDE.md's "standing bundle rule"): three.js
  // must never reach the default Pixi player's main chunk. That happened
  // once already, live through all of Phase B1, and cost 464 kB -- every
  // player on the Pixi default downloading a second renderer. Nothing but
  // convention stopped `packages/app/src` production code from statically
  // importing one of the three doors that reach three.js
  // (`@lions/render/three`, `/terrain`, `/three-camera`) and putting the
  // regression right back.
  //
  // `no-restricted-imports` only inspects static `ImportDeclaration`/
  // `ExportNamedDeclaration` nodes; a dynamic `import()` is a distinct
  // `ImportExpression` node the rule does not look at (verified directly:
  // a scratch file with `await import('three')` against this same rule
  // lints clean), so `main.ts:582`'s `await import('@lions/render/three')`
  // -- the dynamic import that keeps `ThreeRenderer` in its own lazy chunk
  // -- is untouched by this rule while a static import of the same
  // specifier is not.
  //
  // Test files are exempt: `terrain-parity.test.ts` legitimately imports
  // `@lions/render/terrain` and `@lions/render/three-camera` statically, to
  // build real geometry against shipped map data in `environment: 'node'`
  // (see that file's own doc comment) -- tests never ship in the
  // player-facing bundle, so a static import there carries none of the
  // bundle risk this rule exists to prevent.
  {
    files: ['packages/app/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@lions/render/three',
              message:
                'ThreeRenderer must reach packages/app only via a dynamic import() (see main.ts) -- a static ' +
                'import puts three.js in the default Pixi player\'s main chunk. See CLAUDE.md\'s standing bundle rule.',
            },
            {
              name: '@lions/render/terrain',
              message:
                'The terrain barrel exists for terrain-parity.test.ts (and packages/render\'s own test suite) to ' +
                'build real geometry from shipped map data -- production app code has no use for the pure ' +
                'builders directly, and this path is also how ../camera and its three.js import used to leak in.',
            },
            {
              name: '@lions/render/three-camera',
              message:
                'three/camera.ts is three.js-dependent. Production app code asks the renderer for projection ' +
                '(Renderer.worldToScreen) rather than importing either backend\'s arithmetic directly.',
            },
          ],
        },
      ],
    },
  }
);
