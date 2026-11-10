/**
 * GH-943 P3 (T14, GH-1152): the node backend installs both fixes on its renderer, after `init` (the `Attributes` instance exists only
 * from `init`) and before the first `compileAsync` (every program is built through the builder hook), and takes both down in `dispose`.
 *
 * `createNodeBackend` needs a real GPU, so this reads the wiring off the source, in order; what the two modules DO is gated in
 * `attribute-uploads.test.ts` and `bone-texture.test.ts`, and what they SAVE is the T14 Metal hold (the ABBA, the fix reverted on the
 * same hold).
 *
 * Falsification (run by hand, in the commit message): delete the `installVersionedUploads(` line, then the `installBoneTextureSkinning(`
 * line: each makes its spec red.
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
    expect(src.indexOf('uploads.dispose();')).toBeGreaterThan(at('dispose() {'));
  });

  it('the bone-texture hook goes on the renderer after init and before any program is compiled', () => {
    const install = at('installBoneTextureSkinning(renderer as unknown as BuilderHookHostLike)');
    expect(install).toBeGreaterThan(at('await renderer.init();'));
    expect(install).toBeLessThan(at('await renderer.compileAsync(scene, camera);'));
    expect(src.indexOf('boneTexture.dispose();')).toBeGreaterThan(at('dispose() {'));
  });
});
