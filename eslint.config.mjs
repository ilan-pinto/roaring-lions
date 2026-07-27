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
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
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
  }
);
