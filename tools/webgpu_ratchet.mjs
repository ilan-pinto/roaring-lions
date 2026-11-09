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
  // GH-943 P1 (T4): the fog, haze, shroud and beam-shimmer stage. Its legacy twin (fog-pass.ts) keeps its GLSL until P8.
  'packages/render/src/three/fog-pass.node.ts',
  // GH-943 P1 (T3): the grade LUT + dither, and the vignette, as nodes of the output stage.
  'packages/render/src/three/output-grade.node.ts',
  'packages/render/src/three/vignette-pass.node.ts',
  // GH-943 P1 (T5): the node bloom (BloomNode). Twin of bloom.ts, which keeps UnrealBloomPass until P8.
  'packages/render/src/three/bloom.node.ts',
  // GH-943 P1 (T6): the node sky environment.
  'packages/render/src/three/environment.node.ts',
  // GH-943 P1 (T8): the async ground photograph and view capture.
  'packages/render/src/three/capture-view.node.ts',
  // GH-943 P2 (T3): the node ground (the dry blend, the macro and the road). Its legacy twin (terrain/mesh.ts) keeps its splice until P8.
  'packages/render/src/three/terrain/mesh.node.ts',
  // GH-943 P2 (T6): the swaying foliage and trunk (the wind). Its legacy twin (terrain/decor-mesh.ts) keeps its splice until P7.
  'packages/render/src/three/terrain/decor-mesh.node.ts',
  // GH-943 P2 (T5): the selection, team and wound rings. Its legacy twin (units/selection-ring.ts) keeps its GLSL until P8.
  'packages/render/src/three/units/selection-ring.node.ts',
  // GH-943 P3 (T5): the occlusion and smoke outline. Its legacy twin (units/silhouette.ts) keeps its GLSL until P8.
  'packages/render/src/three/units/silhouette.node.ts',
  // GH-943 P3 (T8): the overlay batch, zone band, supply route and tunnel trail. Their legacy twins keep their GLSL until P8.
  'packages/render/src/three/units/overlays.node.ts',
  'packages/render/src/three/units/zone-band.node.ts',
  'packages/render/src/three/supply-route.node.ts',
  'packages/render/src/three/trail-mesh.node.ts',
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
  [`${THREE}capture-view.ts`]: `${THREE}capture-view.node.ts`,
  [`${THREE}terrain/mesh.ts`]: `${THREE}terrain/mesh.node.ts`,
  // GH-943 P2 (T4). relief-read.ts feeds the ground twin's slope light and contours: a change to it must touch mesh.node.ts too.
  [`${THREE}terrain/relief-read.ts`]: `${THREE}terrain/mesh.node.ts`,
  // GH-943 P2 (T6). wind.ts also feeds the rain and the banners: a rain-only change to it must touch the twin too (intended).
  [`${THREE}terrain/decor-mesh.ts`]: `${THREE}terrain/decor-mesh.node.ts`,
  [`${THREE}terrain/wind.ts`]: `${THREE}terrain/decor-mesh.node.ts`,
  // GH-943 P2 (T5)
  [`${THREE}units/selection-ring.ts`]: `${THREE}units/selection-ring.node.ts`,
  // GH-943 P3 (T5)
  [`${THREE}units/silhouette.ts`]: `${THREE}units/silhouette.node.ts`,
  // GH-943 P3 (T8). supply-route-maths.ts holds the dash the route twin shares (a change to it must touch the twin too, intended).
  [`${THREE}units/overlays.ts`]: `${THREE}units/overlays.node.ts`,
  [`${THREE}units/zone-band.ts`]: `${THREE}units/zone-band.node.ts`,
  [`${THREE}supply-route.ts`]: `${THREE}supply-route.node.ts`,
  [`${THREE}supply-route-maths.ts`]: `${THREE}supply-route.node.ts`,
  [`${THREE}trail-mesh.ts`]: `${THREE}trail-mesh.node.ts`,
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
