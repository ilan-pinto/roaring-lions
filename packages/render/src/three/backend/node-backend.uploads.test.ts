/**
 * GH-943 P3 (T14, GH-1152): the node backend installs both fixes on its renderer, after `init` (the `Attributes` instance exists only
 * from `init`) and before the first `compileAsync` (every program is built through the builder hook), and takes both down in `dispose`.
 *
 * `createNodeBackend` needs a real GPU, so this reads the wiring off the source, in order; what the two modules DO is gated in
 * `attribute-uploads.test.ts` and `bone-texture.test.ts`, and what they SAVE is the T14 Metal hold (the ABBA, the fix reverted on the
 * same hold).
 *
 * Falsification (run by hand, in the commit message): delete the `installVersionedUploads(` line, then the `installBoneTextureSkinning(`
 * line: each makes its spec red. T14b: `walk.run(() => chain?.render())` back to `chain?.render()` makes the F2/F8 spec red.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./node-backend.ts', import.meta.url), 'utf8');
const at = (needle: string): number => {
  const i = src.indexOf(needle);
  expect(i, needle).toBeGreaterThanOrEqual(0);
  return i;
};

describe('node backend wiring (P3 T14)', () => {
  it('the versioned uploads go on the renderer\'s own Attributes instance with three\'s DynamicDrawUsage, after init', () => {
    const install = at('installVersionedUploads((renderer as unknown as { _attributes: AttributesLike })._attributes, THREE.DynamicDrawUsage)');
    expect(install).toBeGreaterThan(at('await renderer.init();'));
    expect(src.indexOf('uploads?.dispose();')).toBeGreaterThan(at('dispose() {'));
  });

  it('the bone-texture hook goes on the renderer after init and before any program is compiled', () => {
    const install = at('installBoneTextureSkinning(renderer as unknown as BuilderHookHostLike)');
    expect(install).toBeGreaterThan(at('await renderer.init();'));
    expect(install).toBeLessThan(at('await renderer.compileAsync(scene, camera);'));
    expect(src.indexOf('boneTexture?.dispose();')).toBeGreaterThan(at('dispose() {'));
  });

  // GH-943 P3 (T14b): `uploads: 'three'` installs NEITHER 1205 fix (N2 read through a switch, the main before 1205).
  it("both 1205 installs are gated on uploads === 'versioned'", () => {
    expect(at("const uploads = draw.uploads === 'versioned' ? installVersionedUploads(")).toBeGreaterThan(at('const draw = resolveNodeDraw(opts.nodeDraw);'));
    at("const boneTexture = draw.uploads === 'versioned' ? installBoneTextureSkinning(");
  });

  // GH-943 P3 (T14b): F2 goes on the renderer's own `_nodes`, F8 around the pass counter's wrap and around the chain's render, each
  // from its own switch, and both are taken down (the walk first: it wraps the pass counter's wrap).
  it('F2 and F8 are installed from their switches, the frame runs inside the walk, and dispose takes them down in reverse', () => {
    expect(at('draw.refreshPolicy,')).toBeGreaterThan(at('installRefreshPolicy(\n    (renderer as unknown as { _nodes: NodesLike })._nodes,'));
    const walk = at("installMatrixWalk(renderer as unknown as PassRendererLike, draw.matrixWalk === 'once')");
    expect(walk).toBeGreaterThan(at('installPassCounter(renderer as unknown as PassRendererLike, classifyPass)'));
    at('walk.run(() => chain?.render());');
    const d = at('dispose() {');
    expect(src.indexOf('walk.dispose();', d)).toBeLessThan(src.indexOf('passes.dispose();', d));
    expect(src.indexOf('refresh.dispose();', d)).toBeGreaterThan(d);
  });

  // GH-1152 (12 Nov): the batch upload switch is resolved in THIS chunk and handed to ThreeRenderer on the backend. ThreeRenderer
  // value-importing `node-draw-options.ts` hoisted `resolveNodeDraw` into the ThreeRenderer chunk, and the node backend then loaded that
  // chunk (the legacy composer, `material-maths.ts`): `webgpu:bundle` FINDINGS on PR 1292. Falsification (run by hand, in the commit
  // message): put `import { resolveNodeDraw } from './backend/node-draw-options';` back in ThreeRenderer.ts: the second spec goes red.
  it('the backend hands ThreeRenderer the resolved batchUploads', () => {
    expect(at('batchUploads: draw.batchUploads,')).toBeGreaterThan(at('const draw = resolveNodeDraw(opts.nodeDraw);'));
  });
  it('ThreeRenderer never value-imports node-draw-options (it would pull the ThreeRenderer chunk into a node boot)', () => {
    const tr = readFileSync(new URL('../ThreeRenderer.ts', import.meta.url), 'utf8');
    const valueImports = [...tr.matchAll(/^import\s+(?!type\b)[^;]*from\s+'\.\/backend\/node-draw-options';/gm)].map((m) => m[0]);
    expect(valueImports).toEqual([]);
  });
});
