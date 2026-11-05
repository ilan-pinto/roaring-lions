// GH-943 WebGPU-primary migration (P0): the ESLint ratchet.
//
// A "ported file" is one whose look now lives in TSL (an `X.node.ts` twin, P1-P5). GLSL hooks are banned in it, so a ported area
// cannot quietly grow a hand-written shader back: `onBeforeCompile`, `ShaderMaterial` / `RawShaderMaterial`, `customProgramCacheKey`,
// the legacy `three/addons/postprocessing/*` passes, and a `glsl` tagged template. (A `/* glsl */` comment cannot be selected by
// ESLint; `tools/src/lint/webgpu-ratchet.test.ts` scans each ported file's text for it.)
//
// PORTED_FILES STARTS EMPTY and only ever GAINS entries, one per ported file, in the PR that ports it (the same-PR rule, design
// section 8). A flat-config `files: []` is invalid, so with an empty list no block is emitted at all.
export const PORTED_FILES = [];

/** The identifiers that mean "this file still carries GLSL" (also scanned for as text by the test). */
export const BANNED_NAMES = ['onBeforeCompile', 'customProgramCacheKey', 'ShaderMaterial', 'RawShaderMaterial'];

const MESSAGE =
  'GH-943 ratchet: this file is ported to TSL (see tools/webgpu_ratchet.mjs). Hand-written GLSL hooks (onBeforeCompile, ' +
  'ShaderMaterial, RawShaderMaterial, customProgramCacheKey, glsl templates, three/addons/postprocessing/*) are banned here. ' +
  'Write the effect as a node.';

export function portedFilesBlocks(files) {
  if (files.length === 0) return [];
  return [
    {
      name: 'webgpu-ratchet/ported-files',
      files: [...files],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...BANNED_NAMES.map((name) => ({ selector: `Identifier[name="${name}"]`, message: MESSAGE })),
          { selector: 'TaggedTemplateExpression[tag.name="glsl"]', message: MESSAGE },
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['three/addons/postprocessing/*', 'three/examples/jsm/postprocessing/*'], message: MESSAGE },
            ],
          },
        ],
      },
    },
  ];
}
