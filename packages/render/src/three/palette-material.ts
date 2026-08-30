/**
 * The colour pipeline that keeps the three.js backend inside `data/palette.json`.
 *
 * Phase 0 (`docs/superpowers/specs/2026-08-26-phase-0-verdict.md`) measured the
 * obvious setup -- `Color.convertSRGBToLinear()` plus three.js's default
 * `outputColorSpace` -- at ZERO of 65 colours in palette. The linear/sRGB round
 * trip moves every value off its palette entry, and it fails silently: the
 * render looks fine, it is merely not the palette. Getting to zero-off-palette
 * needs three settings, all here:
 *
 *   1. LUT colours built with `setStyle(hex, LinearSRGBColorSpace)` -- no
 *      conversion (`paletteColorNoConvert`).
 *   2. `renderer.outputColorSpace = LinearSRGBColorSpace` -- pass-through, no
 *      output transform.
 *   3. The clear colour given the same treatment, or the background alone
 *      lands off-palette -- it read `#93744C` instead of `#C8B494` until
 *      fixed.
 *
 * Settings 2 and 3 are one function, `applyPalettePipeline`, not two: three.js
 * reads `renderer.outputColorSpace` SYNCHRONOUSLY, at the moment
 * `setClearColor()` is called (`WebGLBackground.setClear` ->
 * `color.getRGB(_rgb, getUnlitUniformColorSpace(renderer))`), so a caller that
 * sets the clear colour before setting `outputColorSpace` bakes in a
 * conversion against three.js's default instead of this pipeline's
 * pass-through -- silently, since nothing about that ordering fails to
 * compile or fails a headless test. Two separate exported functions leave
 * that ordering to every call site to get right by memory; one function that
 * does both, in the correct order, internally, makes the wrong order
 * unrepresentable rather than merely documented.
 *
 * Antialiasing is the fourth requirement and lives at the `WebGLRenderer`
 * call site in `ThreeRenderer`, not here: a blended edge pixel is by
 * definition not a palette colour, and the sprite pipeline quantizes rather
 * than blends.
 */
import * as THREE from 'three';
import { VIEW_DIRECTION } from './camera';

/** The longest ramp in `data/palette.json` (limestone, 9 steps) and the
 *  shader's `uRamp` array length. Every shorter ramp is padded up to this so
 *  three.js always uploads a fixed-size `vec3[RAMP_MAX]` uniform. */
export const RAMP_MAX = 9;

/**
 * The muzzle-flash "light": ramp-index shift, not a `THREE.PointLight`.
 *
 * `EmitterSpec.light` (`data/vfx/*.json`) declared and validated since the
 * emitter schema's own first draft; nothing read it. A `THREE.PointLight`
 * cannot fix that here -- `toonRampMaterial`'s fragment shader quantizes
 * `N·L` against its own fixed `uLightDir` uniform and reads the fragment
 * colour out of `uRamp`; it does not participate in three.js's lighting
 * system at all, so a `PointLight` added anywhere would illuminate nothing.
 * Nor is summed RGB available: the palette guarantee here is per-material,
 * by construction (this file's own top comment), and `AdditiveBlending` was
 * already tried and rejected for exactly this reason one task earlier (see
 * `units/fx.ts`'s `createParticleMaterial` doc comment, "the dead-schema-
 * field fix, and why it is NOT GPU additive blending" -- the identical
 * argument: summing two on-palette colours produces a third the palette does
 * not name, and `#FFFFFF` has zero hits in `data/palette.json` either).
 *
 * The mechanism that stays on-palette by construction: a surface near an
 * active flash steps its OWN ramp toward index 0 (the lightest step, per
 * this file's own "Index 0... is the LIGHTEST step" note) for the flash's
 * duration, rather than being lit by anything. The only values this can ever
 * emit are still `uRamp` entries -- the identical guarantee the shader
 * already gives static shading, extended to a transient input.
 *
 * `FLASH_CAPACITY` bounds how many flashes can be simultaneously active,
 * GLOBALLY, not per material -- every `toonRampMaterial`/
 * `toonRampSkinnedMaterial`/terrain-material instance samples the SAME
 * uniform arrays (`FlashLightManager` owns the arrays; `register()` points
 * every material's `uFlash*` uniforms at them by reference, so updating the
 * arrays once a frame updates every material with no per-material write
 * loop). 8 is a deliberate ceiling, not the literal "eight emitters declare
 * `light`" coincidence: unlike a tracer (which persists for its whole
 * ballistic flight -- Task B3.14 measured 268 CONCURRENT tracers from a
 * dozen shooters in a real firefight, `units/fx.ts`'s `TRACER_CAPACITY` doc
 * comment), a flash is tied 1:1 to a `fire` event and decays fast (70-500ms
 * across the eight declarations, 130ms median) -- expected concurrent count
 * even in a 400-unit battle is bounded by (fleet-wide shots/second x mean
 * decay time), not by ballistic flight time, and low single digits to a
 * dozen is the plausible range from that arithmetic. The real cost this
 * ceiling bounds is a per-FRAGMENT loop -- unlike tracers/particles (their
 * own bounded draw calls), the terrain material's flash check runs on every
 * on-screen terrain pixel, every frame, so this is deliberately smaller than
 * `TRACER_CAPACITY`/`PARTICLE_CAPACITY`. Overflow drops the OLDEST active
 * flash (`FlashLightManager.spawn`), the same "keep the newest, that is what
 * the player is looking at" reasoning `writeTracerInstances` already uses.
 * This is an ASSUMPTION, not a measurement -- no 400-unit browser run of
 * this feature exists yet to confirm 8 is enough headroom, the same caveat
 * `TRACER_CAPACITY`'s own doc comment carries for its own number.
 */
export const FLASH_CAPACITY = 8;

/**
 * Ramp-shift GLSL, shared verbatim between `toonRampMaterial` (below),
 * `toonRampSkinnedMaterial` (`units/mesh-material.ts`) and the terrain
 * material (`terrain/mesh.ts`) -- a single exported string rather than
 * hand-copied into three fragment shaders, the exact "copied N times,
 * diverged silently" failure `terrain/shared.ts`'s own top comment records
 * against Phase B2's five separately-reviewed builders. `flashShiftSteps`
 * returns the MAX (not the sum) of every active flash's own contribution at
 * `worldPos.xz` -- summing could push a bunched cluster of simultaneous
 * flashes past what any single flash's own `light.intensity` authorises, to
 * a shift the ramp itself may have no entry for once clamped; `max()` keeps
 * every possible output exactly one flash's own authored contribution, never
 * a combination the data never asked for. Distance is XZ-only (world
 * height/elevation is not part of the check) -- deliberately: 1 world unit
 * is 1 game tile on X/Z (`units/fx.ts`'s `tracerQuadPositions` doc comment,
 * "Game (x, y) maps directly onto world (X, Z)"), so `radius_tiles` needs no
 * conversion, but height uses a wholly different, much smaller scale
 * (`WORLD_PER_LEVEL`, ~0.255 world units per elevation level) that would
 * either do nothing or dominate the check depending on how it were mixed in
 * -- this is a cosmetic muzzle-flash radius, not a gameplay sight check, and
 * a flat XZ distance is the simpler, correct-enough answer.
 */
export const FLASH_UNIFORMS_GLSL = /* glsl */ `
  uniform vec2 uFlashPos[${FLASH_CAPACITY}];
  uniform float uFlashRadius[${FLASH_CAPACITY}];
  uniform float uFlashShift[${FLASH_CAPACITY}];
`;

export const FLASH_SHIFT_GLSL = /* glsl */ `
  int flashShiftSteps(vec3 worldPos) {
    float shift = 0.0;
    for (int i = 0; i < ${FLASH_CAPACITY}; i++) {
      float d = distance(worldPos.xz, uFlashPos[i]);
      if (d < uFlashRadius[i]) {
        shift = max(shift, uFlashShift[i]);
      }
    }
    return int(shift);
  }
`;

/**
 * Fresh `uFlashPos`/`uFlashRadius`/`uFlashShift` uniform entries, harmless
 * until a `FlashLightManager` calls `register()` on the material and points
 * these at its own live arrays by reference (see that class's own doc
 * comment). Positions default far off the map (`1e6`) rather than the
 * origin -- the origin is real, occupied ground, and a zero-radius default
 * already makes distance irrelevant, but a far-off default costs nothing and
 * removes any doubt. Every `toonRampMaterial`/`toonRampSkinnedMaterial`/
 * terrain-material instance gets its OWN set of these THREE objects at
 * construction (never shared before registration) so an unregistered
 * material -- a test fixture, or a material built before any
 * `FlashLightManager` exists -- is fully inert rather than accidentally
 * aliasing another instance's state.
 */
export function defaultFlashUniforms(): {
  uFlashPos: { value: THREE.Vector2[] };
  uFlashRadius: { value: number[] };
  uFlashShift: { value: number[] };
} {
  return {
    uFlashPos: { value: Array.from({ length: FLASH_CAPACITY }, () => new THREE.Vector2(1e6, 1e6)) },
    uFlashRadius: { value: new Array(FLASH_CAPACITY).fill(0) },
    uFlashShift: { value: new Array(FLASH_CAPACITY).fill(0) },
  };
}

/**
 * A palette colour whose bytes survive to the framebuffer.
 *
 * `new THREE.Color(hex)` (or `.set(hex)`) treats the string as sRGB and
 * converts it to three.js's working linear space -- correct for lit,
 * continuously-shaded geometry, wrong for a colour meant to come back out
 * byte-identical. `setStyle(hex, LinearSRGBColorSpace)` tells three.js the
 * string is *already* in the working space, so no conversion happens in
 * either direction at write time.
 *
 * Reading it back is a separate operation with its own default: `Color#getHex`/
 * `getHexString` default their `colorSpace` argument to `SRGBColorSpace`
 * regardless of how the value was written, so a bare `c.getHexString()` on a
 * colour built here re-encodes it and will NOT reproduce the original hex --
 * pass `THREE.LinearSRGBColorSpace` explicitly to read the exact bytes back
 * (`palette-material.test.ts` does this). `ColorManagement` stays enabled
 * (its default): disabling it globally would make this function's output
 * indistinguishable from the naive `new THREE.Color(hex)` path it exists to
 * replace, erasing the exact bug class this module guards against.
 */
export function paletteColorNoConvert(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
}

/**
 * The renderer-mutating half of the pipeline, typed as the narrow structural
 * shape it actually touches rather than `THREE.WebGLRenderer` itself.
 *
 * `THREE.WebGLRenderer` cannot be constructed in the headless `node` test
 * environment this package runs its tests under (no WebGL, no DOM) -- see
 * `palette-material.test.ts`. `outputColorSpace` is a plain data property and
 * `setClearColor` a real method, so a structural type lets a plain object
 * stand in for the renderer in tests while a real `THREE.WebGLRenderer`
 * still satisfies it at the `ThreeRenderer` call site unchanged.
 *
 * `outputColorSpace` is typed as `string` rather than `THREE.ColorSpace`: the
 * installed `@types/three` (0.170) types `WebGLRenderer#outputColorSpace` as
 * `string`, not the narrower `ColorSpace` union, and a mutable property must
 * match exactly for a real renderer to satisfy this structurally --
 * `ColorSpace` here would make `THREE.WebGLRenderer` itself fail to
 * typecheck against this interface, defeating the point.
 */
export interface PaletteTarget {
  outputColorSpace: string;
  setClearColor(color: THREE.Color): void;
}

/**
 * Sets the renderer's output colour space to pass-through, then sets the
 * clear colour from `background` through `paletteColorNoConvert` -- in that
 * order, always, as one call. See the module doc comment for why the order
 * is load-bearing rather than cosmetic, and why this is one function instead
 * of two a call site could sequence wrong.
 */
export function applyPalettePipeline(renderer: PaletteTarget, background: string): void {
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(paletteColorNoConvert(background));
}

/**
 * Cel specular: a hard-edged highlight that SELECTS the ramp's own lightest
 * entry (`uRamp[0]`) rather than adding light -- palette-safe by the exact
 * same construction as the muzzle-flash shift above: the only values this
 * can ever emit are ramp entries the data already names, never a synthesised
 * highlight colour blended in on top. Optional per material (the `specular`
 * flag `toonRampMaterial` takes below) rather than always-on: the ask this
 * exists for is metal/glass/vehicle-hull surfaces reading as hard, not a
 * highlight on every toon-ramp surface in the scene regardless of what it
 * represents -- `units/mesh-vehicle.ts` turns this on; `units/mesh-building
 * .ts` deliberately does not (see that call site's own comment for why).
 *
 * Blinn-Phong (`N·H`, half-vector), not Phong (`N·R`, reflection vector):
 * the cheaper of the two standard formulations (no `reflect()` call), and
 * this is a flat threshold CUT rather than a shaded curve, so the two
 * forms' well-known shape difference where the curve is smooth is not in
 * play here -- both produce the same hard yes/no per fragment for a
 * suitably chosen threshold.
 *
 * `uLightDir` and `uViewDir` are both fixed world vectors already, not
 * per-frame state: `uLightDir` is `toonRampMaterial`'s own long-standing
 * `(0.5, 1, 0.3)` constant, and `uViewDir` defaults to `./camera.ts`'s
 * `VIEW_DIRECTION` -- the exact vector that camera's own `position` is
 * built from (`target + VIEW_DIRECTION * CAMERA_DISTANCE`), correct here
 * because this dimetric camera never orbits (`terrain/grove.ts`'s own top
 * comment makes the identical argument for its billboards' fixed axes) --
 * a TRUE parallel/orthographic view direction is the same constant vector
 * everywhere in the scene, which `normalize(cameraPosition - vWorldPos)`
 * would NOT be (that expression is only exact for a perspective camera).
 * So the half-vector between them is itself a build-time constant in
 * spirit; it is still computed in-shader from two uniforms, matching
 * `uLightDir`'s own existing pattern (also always the same value, still a
 * uniform, not a hand-baked GLSL literal) rather than introducing a second
 * convention.
 *
 * `SPECULAR_POWER`/`SPECULAR_THRESHOLD` were tuned by eye against real
 * shipped vehicle meshes at gameplay zoom (~3), not derived -- see this
 * task's report for what was actually looked at and why these two numbers.
 */
export const SPECULAR_POWER = 6.0;
export const SPECULAR_THRESHOLD = 0.15;

export const SPECULAR_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uViewDir;
`;

/** Depends on `uLightDir` already being in scope -- both `toonRampMaterial`
 *  and `units/mesh-material.ts`'s `toonRampSkinnedMaterial` declare it
 *  unconditionally, so this is safe wherever `FLASH_SHIFT_GLSL` already is,
 *  the identical implicit-dependency shape that one already has on
 *  `FLASH_UNIFORMS_GLSL`. */
export const SPECULAR_GLSL = /* glsl */ `
  bool specularHit(vec3 n) {
    vec3 halfDir = normalize(normalize(uLightDir) + normalize(uViewDir));
    float nh = max(dot(normalize(n), halfDir), 0.0);
    return pow(nh, ${SPECULAR_POWER.toFixed(1)}) > ${SPECULAR_THRESHOLD.toFixed(2)};
  }
`;

/**
 * A toon-shaded material that quantizes `N·L` into `uSteps` bands and reads
 * the fragment colour out of `uRamp` -- never computed. A shaded fragment
 * cannot emit an off-palette colour because the only values it can write are
 * the ones read out of the ramp (Phase 0's "stronger guarantee than
 * `validate:assets`" finding).
 *
 * Index 0 of every ramp in `data/palette.json` is the LIGHTEST step, so
 * brighter light means a LOWER index -- the shader below quantizes
 * `max(N·L, 0)` from 1 down to 0 across `uSteps` bands for exactly that
 * reason. Getting this backwards inverts every unit's shading, which reads
 * as "the art looks wrong" rather than as a bug.
 *
 * `specular` (default `false`) splices in this file's own "Cel specular" GLSL
 * above -- see that doc comment for the full account. Left `false`, the
 * generated shader source is BYTE IDENTICAL to what this function produced
 * before the flag existed (every conditional GLSL splice below
 * collapses to the empty string), so every caller that does not opt in is
 * provably unaffected rather than merely expected to be.
 */
export function toonRampMaterial(
  rampHexes: readonly string[],
  opts: { specular?: boolean } = {}
): THREE.ShaderMaterial {
  if (rampHexes.length === 0) {
    throw new Error('toonRampMaterial: ramp must have at least one colour');
  }
  if (rampHexes.length > RAMP_MAX) {
    throw new Error(
      `toonRampMaterial: ramp has ${rampHexes.length} colours, longer than RAMP_MAX (${RAMP_MAX})`
    );
  }
  const specular = opts.specular ?? false;

  const padded: THREE.Color[] = rampHexes.map((hex) => paletteColorNoConvert(hex));
  // Pad to RAMP_MAX with the ramp's own darkest (last) entry so three.js can
  // upload a fixed-size vec3[RAMP_MAX] uniform regardless of the ramp's true
  // length -- reading past the true length in the shader (guarded by
  // uSteps) never reaches the padding, but the array must still be full
  // length or three.js errors uploading it.
  const last = padded[padded.length - 1];
  while (padded.length < RAMP_MAX) {
    padded.push(last.clone());
  }

  return new THREE.ShaderMaterial({
    uniforms: {
      uRamp: { value: padded },
      uSteps: { value: rampHexes.length },
      uLightDir: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
      ...(specular ? { uViewDir: { value: VIEW_DIRECTION.clone() } } : {}),
      ...defaultFlashUniforms(),
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRamp[${RAMP_MAX}];
      uniform int uSteps;
      uniform vec3 uLightDir;
      ${specular ? SPECULAR_UNIFORMS_GLSL : ''}
      ${FLASH_UNIFORMS_GLSL}
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      ${FLASH_SHIFT_GLSL}
      ${specular ? SPECULAR_GLSL : ''}

      void main() {
        float nl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
        // Quantize into uSteps bands, brightest band -> index 0.
        int band = int(floor((1.0 - nl) * float(uSteps)));
        band = min(band, uSteps - 1);
        // Muzzle-flash ramp shift: a nearby active flash steps this
        // fragment's band toward 0 (brighter), never past it -- see this
        // file's own "The muzzle-flash 'light'" doc comment above.
        band = max(0, band - flashShiftSteps(vWorldPos));
        // Cel specular: a hard highlight always wins outright, the same
        // "push all the way to the lightest entry" outcome flashShiftSteps
        // already produces at its own maximum -- see this file's own "Cel
        // specular" doc comment above.
        ${specular ? 'if (specularHit(vNormal)) band = 0;' : ''}
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
