/**
 * The shared GPU material recipe for every zone of every "modelled,
 * palette-shaded VFX mesh" asset class (`./vfx-mesh-role.ts`'s own top
 * comment names the two shipped so far: `muzzle-flash.ts`,
 * `explosion-burst.ts`). Extracted out of `muzzle-flash.ts`'s own
 * module-private `createMuzzleFlashMaterial` once a SECOND asset class
 * needed the byte-identical recipe -- see this task's report
 * ("explosion-burst-report.md") for the full account; `vfx-mesh-role.ts`'s
 * own top comment gives the identical reasoning for why the role
 * vocabulary moved here too.
 *
 * One flat, unlit, forced-opaque colour per zone -- meant to read as
 * EMITTING light, not reflecting it, so every fragment of one zone is the
 * same resolved `reserved.vfx` entry regardless of the mesh's own surface
 * normal. No lighting term at all (unlike `toonRampMaterial`'s quantized
 * `N·L`) -- there is no "dark side" of a flash or a fireball.
 *
 * `blending: THREE.NormalBlending` with alpha pinned to 1.0 in the
 * fragment shader (never real `AdditiveBlending`) is the recipe
 * `units/fx.ts`'s `createParticleMaterial` already proved keeps every
 * fragment on-palette -- the GPU's real additive blend stage runs AFTER the
 * fragment shader and sums two on-palette colours into a third the palette
 * does not name; see that function's own doc comment for the full argument
 * against summing blend modes. `depthTest: false` / `depthWrite: false`
 * matches the `above_units`, additive-tier particle layer this recipe's
 * callers each supersede -- an unconditional pass, never hidden behind a
 * unit or terrain, exactly the guarantee `FX_RENDER_ORDER_ABOVE_ADDITIVE`'s
 * own row in `render-order.ts` documents for its particle sibling.
 */
import * as THREE from 'three';

export function createVfxMeshMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: /* glsl */ `
      void main() {
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        // Opaque overwrite, not a sum -- every fragment this material ever
        // writes is EXACTLY uColor, on-palette by construction. See this
        // file's own top comment for the full argument against real
        // additive blending.
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  });
}
