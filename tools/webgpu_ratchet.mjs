// GH-943 WebGPU-primary migration (P0): the ESLint ratchet.
//
// A "ported file" is one whose look now lives in TSL (an `X.node.ts` twin, P1-P5). GLSL hooks are banned in it, so a ported area
// cannot quietly grow a hand-written shader back: `onBeforeCompile`, `ShaderMaterial` / `RawShaderMaterial`, `customProgramCacheKey`,
// the legacy `three/addons/postprocessing/*` passes, and a `glsl` tagged template. (A `/* glsl */` comment cannot be selected by
// ESLint; `tools/src/lint/webgpu-ratchet.test.ts` scans each ported file's text for it.)
//
// PORTED_FILES STARTS EMPTY and only ever GAINS entries, one per ported file, in the PR that ports it (the same-PR rule, design
// section 8). A flat-config `files: []` is invalid, so with an empty list no block is emitted at all.
export const PORTED_FILES = [
  // GH-943 P1 (T2): the node post chain. The ratchet lists the NODE twin: it is the file that must stay GLSL-free. Its legacy
  // twin (post-chain.ts, the EffectComposer) keeps its passes until P8, so it is not listed here.
  'packages/render/src/three/post-chain.node.ts',
];

/**
 * GH-943 P1 T1: the TWINS table, legacy GLSL file -> its node twin. The same-PR rule (design section 8): once a twin EXISTS on
 * disk, a PR that touches the legacy file must touch the twin too (`tools/src/ci/twin-check.ts`). A row whose twin does not exist
 * yet is not armed, so a row can be declared before the port lands. Rows are APPENDED by the task that owns the area and only
 * removed at the P7 cutover, when the legacy file itself goes. Paths are repo-relative.
 */
const THREE = 'packages/render/src/three/';
export const TWINS = Object.freeze({
  [`${THREE}post-chain.ts`]: `${THREE}post-chain.node.ts`,
  [`${THREE}output-grade.ts`]: `${THREE}output-grade.node.ts`,
  [`${THREE}vignette-pass.ts`]: `${THREE}vignette-pass.node.ts`,
  [`${THREE}fog-pass.ts`]: `${THREE}fog-pass.node.ts`,
  [`${THREE}bloom.ts`]: `${THREE}bloom.node.ts`,
  [`${THREE}environment.ts`]: `${THREE}environment.node.ts`,
});

/** The identifiers that mean "this file still carries GLSL" (also scanned for as text by the test). */
export const BANNED_NAMES = ['onBeforeCompile', 'customProgramCacheKey', 'ShaderMaterial', 'RawShaderMaterial'];

const MESSAGE =
  'GH-943 ratchet: this file is ported to TSL (see tools/webgpu_ratchet.mjs). Hand-written GLSL hooks (onBeforeCompile, ' +
  'ShaderMaterial, RawShaderMaterial, customProgramCacheKey, glsl templates, three/addons/postprocessing/*) are banned here. ' +
  'Write the effect as a node.';

/**
 * `base` is the standing fences a ported file already has (tools/webgpu_fences.mjs RATCHET_BASE). The block ADDS to them: flat config
 * replaces a rule's options wholesale, so passing nothing would silently drop the roar-wallet and @lions/app|data fences.
 * A ported file outside packages/render/src/three/ would not have these exact fences, so it is refused here.
 */
export function portedFilesBlocks(files, base) {
  if (files.length === 0) return [];
  if (!base) throw new Error('portedFilesBlocks: pass RATCHET_BASE, or a ported file loses the standing import fences');
  for (const f of files) {
    if (!f.startsWith('packages/render/src/three/')) {
      throw new Error(`ported file ${f} is outside packages/render/src/three/: the ratchet's base fences are that folder's`);
    }
  }
  return [
    {
      name: 'webgpu-ratchet/ported-files',
      files: [...files],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...base.syntax,
          ...BANNED_NAMES.map((name) => ({ selector: `Identifier[name="${name}"]`, message: MESSAGE })),
          { selector: 'TaggedTemplateExpression[tag.name="glsl"]', message: MESSAGE },
        ],
        'no-restricted-imports': [
          'error',
          {
            ...base.imports,
            patterns: [
              ...base.imports.patterns,
              { group: ['three/addons/postprocessing/*', 'three/examples/jsm/postprocessing/*'], message: MESSAGE },
            ],
          },
        ],
      },
    },
  ];
}
