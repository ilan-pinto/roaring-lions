/**
 * `toonRampSkinnedMaterial`'s `uOpacity` uniform -- added for the mesh death
 * fade (`mesh-death.ts`), documented in full in this material's own top
 * comment, "uOpacity, added for the death fade". These tests pin the two
 * things that section promises: the uniform exists with a harmless default,
 * and the RGB computation it sits next to is untouched -- `outColor` is
 * still driven only by `uRamp`/`uSteps`/`uLightDir`, never by `uOpacity`.
 *
 * `environment: 'node'` (`vitest.config.ts`): `THREE.ShaderMaterial` is
 * plain JS-side construction, no `WebGLRenderer` needed -- the same
 * precedent `palette-material.test.ts` already established for
 * `toonRampMaterial`, this file's non-skinned sibling.
 */
import { describe, it, expect } from 'vitest';
import { toonRampSkinnedMaterial } from './mesh-material';
import { RAMP_MAX } from '../palette-material';

const OLIVE = ['#8F9464', '#6E7449', '#4E5433', '#333821'];

describe('toonRampSkinnedMaterial uOpacity', () => {
  it('defaults to fully opaque', () => {
    const m = toonRampSkinnedMaterial(OLIVE);
    expect(m.uniforms.uOpacity.value).toBe(1.0);
  });

  it('leaves `transparent` at three.js\'s own default (false) -- only a caller that clones and flips it turns blending on', () => {
    const m = toonRampSkinnedMaterial(OLIVE);
    expect(m.transparent).toBe(false);
    // Break check (verified by hand, then reverted): set `transparent: true`
    // unconditionally in `toonRampSkinnedMaterial`'s returned
    // `THREE.ShaderMaterial({...})` call. This assertion goes red
    // (`expected true to be false`) -- the regression it guards is every
    // LIVING unit's material picking up real alpha-blend compositing (and
    // three.js's opaque-vs-transparent sort) for no reason, not merely a
    // dying one's per-entity clone.
  });

  it('is declared in the fragment shader source, feeding gl_FragColor.a alongside the untouched RGB', () => {
    const m = toonRampSkinnedMaterial(OLIVE);
    expect(m.fragmentShader).toMatch(/uniform float uOpacity;/);
    expect(m.fragmentShader).toMatch(/gl_FragColor = vec4\(outColor, uOpacity\);/);
    // Break check (verified by hand, then reverted): change the final line
    // back to `vec4(outColor, 1.0)`. Both regexes above still match the
    // uniform DECLARATION (harmless dead code), but the second goes red on
    // its own -- exactly the failure mode worth catching: a uOpacity that
    // exists but is never wired to the output.
  });

  it('does not change RGB output shape -- uRamp/uSteps/uLightDir are still the only STATIC colour inputs', () => {
    // uFlashPos/uFlashRadius/uFlashShift joined this set for the muzzle-flash
    // ramp-shift effect (`../palette-material.ts`'s "The muzzle-flash
    // 'light'" doc comment) -- they default inert (`defaultFlashUniforms`)
    // and only move once a `FlashLightManager` registers this material, so
    // this test's own name ("does not change RGB output shape") still holds
    // for anything that does not call `register()`.
    const m = toonRampSkinnedMaterial(OLIVE);
    expect(Object.keys(m.uniforms).sort()).toEqual([
      'uFlashPos',
      'uFlashRadius',
      'uFlashShift',
      'uLightDir',
      'uOpacity',
      'uRamp',
      'uSteps',
    ]);
    expect(m.uniforms.uRamp.value).toHaveLength(RAMP_MAX);
    expect(m.uniforms.uSteps.value).toBe(OLIVE.length);
  });
});
