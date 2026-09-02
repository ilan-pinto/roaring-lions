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
    // `dist-*` as well as `dist`, and that is not tidiness. A browser check
    // in this tree means `vite build --outDir <somewhere>`, and a shared
    // worktree has several sessions doing it at once: observed 2026-09-02,
    // `packages/app/dist-campaign` and `packages/app/dist-cursorverify`
    // together turned `pnpm lint` red with **8,631 errors**, every one of
    // them `no-undef` on a minified bundle, in two directories neither
    // session had any reason to think eslint would walk. A gate made
    // entirely of another agent's build output is the same failure the
    // `.claude/worktrees/**` entry below already exists to prevent.
    //
    // `.superpowers/` is the same argument once more: `.gitignore` calls it
    // "never committed" scratch, and a throwaway Playwright driver left in
    // it should not be able to fail the repository's lint gate.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-*/**',
      '**/*.d.ts',
      '.claude/worktrees/**',
      '.superpowers/**',
    ],
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
              name: '@lions/render/pixi',
              message:
                'PixiRenderer must reach packages/app only via a dynamic import() (see main.ts) -- a static ' +
                'import puts pixi.js in the main chunk for every player, including one who chose ' +
                '?renderer=three. Symmetric with the @lions/render/three rule above: neither backend is ' +
                'privileged, so neither may be imported statically.',
            },
            {
              name: '@lions/render/three-campaign',
              message:
                'The campaign board is three.js. It must reach packages/app via a dynamic import() ' +
                '(see ui/worldmap3d.ts) -- a static one puts three.js in the main chunk for every ' +
                'player, including one on ?renderer=pixi who is served the flat PNG board instead ' +
                'and will never draw it. Same rule as @lions/render/three above.',
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
  },

  // The other half of the standing bundle rule, guarding the source rather
  // than the consumer.
  //
  // The rule above stops `packages/app` from taking a three.js door. This one
  // stops a three.js door from being opened somewhere it does not belong: only
  // `packages/render/src/three/**` may import three.js at all. Everything else
  // under `packages/render/src` -- `renderer.ts` above all, which Pixi's own
  // chunk is built from -- must stay three-free.
  //
  // This is the exact leak Phase B2's final review found: `ground.ts` imported
  // one constant from `three/camera.ts`, and `camera.ts` imports all of three,
  // so the "pure builders" barrel dragged the whole library while its own doc
  // comment said it did not. Nothing had shipped wrong -- no app code reached
  // it statically -- but the mechanism was identical to the one that put 464 kB
  // of three.js in the default player's main chunk through all of Phase B1.
  // A comment is not a guard; this is.
  {
    files: ['packages/render/src/**/*.ts'],
    ignores: ['packages/render/src/three/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              message:
                'Only packages/render/src/three/** may import three.js. Pixi\'s renderer and the shared ' +
                'projection code must stay three-free, or three.js lands in the default player\'s chunk. ' +
                'A pure constant both backends need belongs in project.ts (see ELEV_STEP, WORLD_Y_PER_LIFT_PIXEL).',
            },
          ],
        },
      ],
    },
  }
);
