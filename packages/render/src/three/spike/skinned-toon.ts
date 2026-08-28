/**
 * SPIKE (Phase R0, `docs/superpowers/specs/2026-08-28-rigged-infantry-design.md`).
 * Throwaway. Not wired into any shipping path, not covered by tests, and
 * deletable in one `rm -rf` of this directory if R0 returns NO-GO.
 *
 * `../palette-material.ts`'s `toonRampMaterial` quantizes `N·L` into bands and
 * reads the fragment colour out of a ramp, so an off-palette colour is
 * unrepresentable. That guarantee was measured on STATIC geometry only (Phase
 * 0's verdict says so in as many words: "one unit type, one clip, one light
 * direction... stand-in geometry"). This module asks whether it survives
 * skeletal deformation, which is R0's Q1.
 *
 * ## Why deformation is a real question and not a formality
 *
 * The ramp is indexed by the fragment's normal. Skinning rewrites vertex
 * normals every frame, so the band boundaries MOVE ACROSS THE FIGURE as it
 * animates. That much is correct and desirable -- it is what makes a walk
 * cycle read as volume rather than as a flat cut-out sliding around.
 *
 * The failure mode worth measuring is different: a band boundary that crawls
 * frame to frame at a scale small enough to read as noise rather than as
 * shading. The sprite pipeline cannot produce this, because each frame is
 * quantized independently from a render that was already stable. A real-time
 * toon ramp can, because `floor()` at a band edge turns an arbitrarily small
 * normal change into a whole-band colour change. A normal sitting almost
 * exactly on a boundary flips back and forth every frame, and a row of such
 * fragments flickers.
 *
 * There is no way to answer this by reading the shader. It has to be watched.
 *
 * ## What changed from the shipping material, and what deliberately did not
 *
 * The fragment shader is byte-identical in behaviour to `toonRampMaterial`'s:
 * same quantization, same "index 0 is the LIGHTEST step" direction, same
 * `uRamp`/`uSteps`/`uLightDir` uniforms. If this spike's colours differ from
 * the shipping backend's, that is a bug in this file, not a finding.
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
 * `rampHexes` is a WHOLE RAMP out of `data/palette.json` (e.g. all four
 * `olive` steps), not a single base colour. This is the one place the spike
 * must not copy the sprite pipeline: `tools/render_team.py`'s `ROLE_PALETTE`
 * maps a role to ONE colour at the LIGHTEST end of a ramp, because that
 * pipeline multiplies it by a light and "a figure renders at roughly half its
 * base value" (its own comment). A toon LUT does not multiply -- it INDEXES --
 * so feeding it `ROLE_PALETTE`'s single base would light a uniform from
 * `olive.0` toward black instead of stepping it down the olive ramp, and the
 * figure would come out darker and flatter than the sprite for reasons that
 * look like a shader bug and are not.
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
