/**
 * The toon material a mesh unit's skinned geometry draws through.
 *
 * Promoted out of `spike/skinned-toon.ts` after Phase R0's GO verdict
 * (`docs/superpowers/specs/2026-08-28-phase-r0-verdict.md`) -- Q1 answered
 * YES, twice over (a one-frame colour census and a band-crawl measurement
 * across five time steps, both in that verdict). `spike/rig-scene.ts`'s
 * throwaway comparison harness now imports this module rather than keeping
 * its own copy, so the shader has exactly one source of truth between the
 * spike and the shipped mesh-unit path (`mesh-unit.ts`).
 *
 * `../palette-material.ts`'s `toonRampMaterial` quantizes `N·L` into bands and
 * reads the fragment colour out of a ramp, so an off-palette colour is
 * unrepresentable. That guarantee was measured on STATIC geometry only (Phase
 * 0's verdict says so in as many words: "one unit type, one clip, one light
 * direction... stand-in geometry"). This module is R0's answer to whether it
 * survives skeletal deformation.
 *
 * ## Why deformation is a real question and not a formality
 *
 * The ramp is indexed by the fragment's normal. Skinning rewrites vertex
 * normals every frame, so the band boundaries MOVE ACROSS THE FIGURE as it
 * animates. That much is correct and desirable -- it is what makes a walk
 * cycle read as volume rather than as a flat cut-out sliding around.
 *
 * The failure mode worth measuring was different: a band boundary that
 * crawls frame to frame at a scale small enough to read as noise rather than
 * as shading. The sprite pipeline cannot produce this, because each frame is
 * quantized independently from a render that was already stable. A real-time
 * toon ramp can, because `floor()` at a band edge turns an arbitrarily small
 * normal change into a whole-band colour change. R0's band-crawl measurement
 * found change proportional to elapsed time with a zero intercept -- the
 * opposite shape from shimmer -- so the ramp below is safe to drive from a
 * live `AnimationMixer`.
 *
 * ## What changed from the shipping material, and what deliberately did not
 *
 * The fragment shader is byte-identical in behaviour to `toonRampMaterial`'s:
 * same quantization, same "index 0 is the LIGHTEST step" direction, same
 * `uRamp`/`uSteps`/`uLightDir` uniforms. If a mesh unit's colours differ from
 * the shipping sprite backend's, that is a bug in this file, not a finding.
 *
 * The vertex shader is the only real change. It runs three.js's own skinning
 * chunks so both the position AND the normal are deformed by the bone
 * matrices:
 *
 *   - `skinbase_vertex` builds `boneMatX..W` from the skin index/weight
 *     attributes and the bone texture.
 *   - `skinnormal_vertex` applies that skin matrix to `objectNormal`. Omitting
 *     it is the classic mistake: the mesh deforms correctly while its normals
 *     stay in bind pose, so the shading is frozen to a pose the geometry has
 *     left. With a toon ramp that reads as bands welded to the figure rather
 *     than to the light -- subtly wrong in a way that survives review, which
 *     is exactly why it is called out here.
 *   - `skinning_vertex` applies it to the position.
 *
 * `USE_SKINNING` is not defined here and must not be: three.js sets it from
 * the OBJECT, not the material -- `WebGLPrograms.js:311`, `skinning:
 * object.isSkinnedMesh === true` -- so it is switched on for a raw
 * `ShaderMaterial` exactly when the mesh is a `SkinnedMesh`, and hard-defining
 * it here would break the material on anything else.
 */
import * as THREE from 'three';
import { RAMP_MAX, paletteColorNoConvert } from '../palette-material';

/**
 * The shipping toon ramp, with three.js's skinning chunks in the vertex stage.
 *
 * `rampHexes` is a WHOLE RAMP or RAMP SLICE out of `data/palette.json` (e.g.
 * the whole `olive` ramp, or a few steps of `gunmetal`) -- see `mesh-role.ts`
 * for why a single base colour (`tools/render_team.py`'s `ROLE_PALETTE`)
 * must never be passed here instead: that pipeline multiplies a base colour
 * by a light, and a toon LUT indexes rather than multiplies.
 */
export function toonRampSkinnedMaterial(rampHexes: readonly string[]): THREE.ShaderMaterial {
  if (rampHexes.length === 0) {
    throw new Error('toonRampSkinnedMaterial: ramp must have at least one colour');
  }
  if (rampHexes.length > RAMP_MAX) {
    throw new Error(
      `toonRampSkinnedMaterial: ramp has ${rampHexes.length} colours, longer than RAMP_MAX (${RAMP_MAX})`
    );
  }

  // Pad to RAMP_MAX with the ramp's own darkest entry, exactly as
  // `toonRampMaterial` does and for the same reason: three.js uploads a
  // fixed-size `vec3[RAMP_MAX]` uniform, and `uSteps` keeps the shader from
  // ever reading into the padding.
  const padded: THREE.Color[] = rampHexes.map((hex) => paletteColorNoConvert(hex));
  const last = padded[padded.length - 1];
  while (padded.length < RAMP_MAX) {
    padded.push(last.clone());
  }

  return new THREE.ShaderMaterial({
    uniforms: {
      uRamp: { value: padded },
      uSteps: { value: rampHexes.length },
      uLightDir: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 vNormal;
      void main() {
        // Normal path: bind-pose normal -> bone matrices -> normalMatrix.
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        vNormal = normalize( transformedNormal );

        // Position path: bind-pose position -> bone matrices -> clip space.
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRamp[${RAMP_MAX}];
      uniform int uSteps;
      uniform vec3 uLightDir;
      varying vec3 vNormal;

      void main() {
        float nl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
        // Quantize into uSteps bands, brightest band -> index 0.
        int band = int(floor((1.0 - nl) * float(uSteps)));
        band = min(band, uSteps - 1);
        vec3 outColor = uRamp[0];
        for (int i = 0; i < ${RAMP_MAX}; i++) {
          if (i == band) {
            outColor = uRamp[i];
          }
        }
        gl_FragColor = vec4(outColor, 1.0);
      }
    `,
  });
}
