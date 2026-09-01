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
 * ## Coursing: masonry and form-work, generated rather than textured
 *
 * `tools/render_building.py` has given SPRITE buildings coursed brick since
 * the building set shipped (`BuildingSpec.brick`, `brick_material()`), and
 * the mesh path had no equivalent at all -- `toonRampMaterial` picked one
 * flat ramp per role, so a mesh house was a slab of `limestone.3` where its
 * own sprite is visibly masonry. This is the mesh answer to that gap, and it
 * is deliberately NOT a port of the sprite's method.
 *
 * ### Why not a texture
 *
 * A shipped GLB carries zero materials, zero images, zero textures
 * (`tools/validate_mesh_assets.py` enforces it; `ART_PIPELINE.md` states the
 * rule as "every opaque pixel is exactly a palette entry -- cohesion is
 * mechanical"). The sprite pipeline gets to be off-palette mid-render and
 * relies on `quantize_sprites.py` afterwards to snap every pixel back onto
 * the 41 ramp entries; a real-time renderer has no quantizer downstream, and
 * this backend's whole palette guarantee (this file's top comment) is that
 * the fragment shader can only ever WRITE a `uRamp` entry, never compute a
 * colour. Sampling a brick texture would break that on the first bilinear
 * tap -- Phase 0 measured the naive setup at 0 of 65 colours on-palette and
 * it still looked fine, which is exactly why the guarantee is structural
 * here rather than eyeballed.
 *
 * So the pattern selects a STEP of the role's own existing ramp instead of
 * contributing a colour: `courseShiftSteps` returns an integer in
 * `[-1, +1]`, the caller adds it to the shading band and re-clamps into
 * `[0, uSteps - 1]`. Palette-exact by construction, the same property the
 * muzzle-flash shift and the cel specular above already have -- and the
 * pattern is free to be as fine as it likes without any risk of inventing a
 * mortar colour the palette does not name.
 *
 * ### What the shift means, and why it is signed
 *
 * `+1` (a step DARKER) is the mortar joint; `-1` (a step lighter) is the
 * alternate brick tone, chosen per brick from a hash so courses are not a
 * regular two-tone stripe. Signed rather than "mortar only" because the wall
 * ramp is three steps wide (`building-mesh-role.ts`'s `sliceFrom`) and the
 * dimetric camera's two visible wall faces do NOT sit on the same band: with
 * `uLightDir` at `(0.5, 1, 0.3)`, a `+X` face lands on band 1 and a `+Z`
 * face on band 2, the ramp's darkest step. A mortar-only `+1` would clamp
 * away to nothing on every `+Z` wall in the scene -- half the visible
 * masonry, flat again. With the shift signed, the mortar carries the light
 * face and the brick tint carries the dark one, so no face can be pattern-
 * less no matter which band it shades to.
 *
 * ### Scale is NOT the sprite's scale
 *
 * `render_building.py`'s `brick_scale = 6.0` is per BLENDER unit, and its
 * own comment tunes it against a 512px offline render: with the brick node's
 * `Row Height` of 0.25 that is `6 / 0.25 = 24` courses per Blender unit, and
 * at three Blender units per game tile (`units/mesh-anim.ts`'s
 * `MESH_UNITS_PER_TILE`) that is 72 courses per tile. Reproduced here that
 * would be well under a pixel per course at gameplay zoom -- pure moire on a
 * renderer with antialiasing switched off. These numbers are in WORLD units
 * (one world unit = one game tile) and were measured on screen instead; see
 * this task's report for the pixel sizes.
 */
export const COURSE_SURFACES = ['brick', 'panel'] as const;

/** Which generated wall surface a coursed material draws. `brick` is
 *  masonry coursing (the sprite pipeline's `BuildingSpec.brick`); `panel` is
 *  poured concrete -- form-work banding at a much larger scale, since a
 *  poured wall has panel seams and pour variation, not courses. */
export type CourseSurface = (typeof COURSE_SURFACES)[number];

/** One surface's geometry, in world units (= game tiles) except
 *  `tintChance`, which is the fraction of bricks/panels taking the lighter
 *  step. `joint` is the distance from a brick's edge at which the joint
 *  starts, so a course's joint reads `2 * joint` thick. */
export interface CourseSpec {
  readonly course: number;
  readonly length: number;
  readonly joint: number;
  readonly tintChance: number;
}

/**
 * Measured at gameplay zoom (`camera.zoom = 1`), where one world unit of
 * WALL HEIGHT is `TILE_W * cos(ELEVATION) / sqrt(2)` = 39.2 screen px (the
 * dimetric camera's square-pixel scale, `camera.ts`), and one world unit of
 * horizontal run is 35.8 px.
 *
 *  - `brick` 0.15 -> 6.7 courses per tile, 5.9 px a course at zoom 1 and
 *    2.1 px at the 0.35 minimum. A compound wall (`wall.glb`, 0.58 tiles
 *    tall) therefore carries four courses rather than one stripe.
 *  - `panel` 0.55 -> 21.6 px a band at zoom 1: seams on a poured wall, not
 *    a pattern. `tintChance` is a third of brick's so most panels are plain
 *    and the variation reads as pour rather than as checkerboard.
 */
export const COURSE_SPECS: Record<CourseSurface, CourseSpec> = {
  brick: { course: 0.15, length: 0.3, joint: 0.018, tintChance: 0.45 },
  panel: { course: 0.35, length: 0.7, joint: 0.016, tintChance: 0.25 },
};

/** Declared next to `varying vec3 vWorldPos;` in BOTH shaders, and only when
 *  coursing is on. Leading newline so the non-coursing source is byte
 *  identical -- see `toonRampMaterial`'s own note on the splice points. */
export const COURSE_VARYING_GLSL = /* glsl */ `
      varying vec3 vWorldNormal;`;

/** The vertex-shader half. `mat3(modelMatrix)` rather than a full inverse-
 *  transpose: every caller that opts in is a building mesh, uniformly scaled
 *  by `MESH_SCALE`, and a uniform scale leaves a normal's DIRECTION alone --
 *  which is all `courseShiftSteps` reads it for (it picks a projection
 *  plane; it never shades with it). `vNormal` cannot be reused for this:
 *  that one is transformed by `normalMatrix` into VIEW space, and the
 *  triplanar choice has to be made in world space or courses stop running
 *  level. */
export const COURSE_VERTEX_GLSL = /* glsl */ `
        vWorldNormal = mat3(modelMatrix) * rlNormal;`;

/** Applied straight after the shading band is quantized and before the
 *  muzzle-flash shift, so a flash still brightens whatever the coursing
 *  left. `min`/`max` rather than `clamp` because integer `clamp` is a
 *  GLSL ES 3.00 overload and this shader compiles as ESSL1 -- the two lines
 *  around it already bound `band` the same way. */
export const COURSE_APPLY_GLSL = /* glsl */ `
        band = min(max(band + courseShiftSteps(vWorldPos, vWorldNormal), 0), uSteps - 1);`;

/**
 * The fragment-shader half for one surface: a hash and `courseShiftSteps`.
 *
 * Triplanar by DOMINANT AXIS (a hard `if`, not a blend): the wall's rows
 * must run along world Y, so a face whose normal is mostly X is patterned in
 * ZY and one mostly Z in XY. Blending three projections is the usual
 * triplanar recipe and is wrong here twice over -- it would mix two integer
 * shifts into a fractional one, and there is nothing to hide a seam on
 * geometry that is all box faces meeting at right angles.
 *
 * The hash is Dave Hoskins' `hash12` rather than the `fract(sin(...))` form:
 * `sin` at large arguments is where that idiom loses precision, and a wall
 * 40 tiles out from the origin is 260 courses up the row counter.
 *
 * Pattern phase comes from WORLD position, not from model-local position,
 * so two houses standing side by side course continuously into each other
 * instead of each restarting at its own origin.
 */
export function courseShiftGlsl(surface: CourseSurface): string {
  const s = COURSE_SPECS[surface];
  return /* glsl */ `
  float rlCourseHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  int courseShiftSteps(vec3 worldPos, vec3 worldNormal) {
    vec3 an = abs(normalize(worldNormal));
    vec2 uv;
    if (an.y >= max(an.x, an.z)) {
      uv = worldPos.xz;
    } else if (an.x >= an.z) {
      uv = vec2(worldPos.z, worldPos.y);
    } else {
      uv = vec2(worldPos.x, worldPos.y);
    }
    float row = floor(uv.y / ${s.course.toFixed(4)});
    // Running bond: every other course offsets by half a brick.
    float u = uv.x + mod(row, 2.0) * ${(s.length * 0.5).toFixed(4)};
    float col = floor(u / ${s.length.toFixed(4)});
    float fu = u - col * ${s.length.toFixed(4)};
    float fv = uv.y - row * ${s.course.toFixed(4)};
    float edge = min(min(fu, ${s.length.toFixed(4)} - fu), min(fv, ${s.course.toFixed(4)} - fv));
    if (edge < ${s.joint.toFixed(4)}) {
      return 1;
    }
    return rlCourseHash(vec2(col, row)) < ${s.tintChance.toFixed(3)} ? -1 : 0;
  }
`;
}

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
 *
 * ## Why the vertex shader includes three.js's batching chunks
 *
 * `THREE.BatchedMesh` applies its per-instance transform IN THE VERTEX
 * SHADER, through `<batching_pars_vertex>`/`<batching_vertex>`. A hand-written
 * vertex shader that omits them ignores every instance matrix, so every
 * instance collapses onto raw local geometry coordinates and the batch draws
 * NOTHING recognisable. That is not hypothetical: `terrain/decor-mesh.ts`
 * gives every decor batch a material from this function, and until these two
 * `#include`s existed the whole decor layer drew zero pixels -- proven by
 * toggling `decorGroup.visible` and diffing the framebuffer, which showed no
 * change at all.
 *
 * Four facts make this work for a raw `THREE.ShaderMaterial`, each read out of
 * the installed three.js 0.170 build rather than assumed:
 *
 *  1. `WebGLProgram` runs `resolveIncludes()` on `vertexShader` for EVERY
 *     material, `ShaderMaterial` included -- only `RawShaderMaterial` skips
 *     the GLSL-3 prefix, and this is not one.
 *  2. `WebGLPrograms` sets `batching: IS_BATCHEDMESH` from
 *     `object.isBatchedMesh`, and `WebGLProgram` emits `#define USE_BATCHING`
 *     from it into the non-raw prefix. Nothing about the material gates it.
 *  3. `batchingTexture` and `batchingIdTexture` are bound by
 *     `WebGLRenderer.setProgram` straight onto the PROGRAM's uniforms from the
 *     object (`p_uniforms.setValue(_gl, 'batchingTexture', object.
 *     _matricesTexture, textures)`), never merged in from `material.uniforms`
 *     -- so this material needs no `UniformsLib` merge and no uniform entries
 *     of its own. Same for `_gl_DrawID`, which `WebGLRenderer` sets per draw
 *     when `WEBGL_multi_draw` is unavailable.
 *  4. Both chunks are wholly wrapped in `#ifdef USE_BATCHING`, so for the
 *     THREE non-batched callers -- `units/mesh-vehicle.ts`,
 *     `units/mesh-building.ts`, and the tests -- the preprocessor deletes
 *     every line of this and the emitted program is the one that shipped
 *     before. `rlNormal`/`rlPos` reduce to `normal` and `vec4(position, 1.0)`
 *     verbatim.
 *
 * The normal is transformed too, not just the position. Skipping it is the
 * quiet half of this bug: geometry would appear in the right place while
 * every instance shaded off a normal in the wrong frame, which on a toon ramp
 * reads as flat-shaded blobs rather than as an obvious error.
 */
export function toonRampMaterial(
  rampHexes: readonly string[],
  opts: { specular?: boolean; coursing?: CourseSurface } = {}
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
  // `undefined`, not `'flat'`: coursing is opt-in and every splice below
  // collapses to the empty string without it, which is what keeps the
  // generated source byte-identical for units, vehicles and decor.
  const coursing = opts.coursing;

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
      #include <batching_pars_vertex>
      varying vec3 vNormal;
      varying vec3 vWorldPos;${coursing ? COURSE_VARYING_GLSL : ''}
      void main() {
        #include <batching_vertex>
        vec3 rlNormal = normal;
        vec4 rlPos = vec4(position, 1.0);
        #ifdef USE_BATCHING
          // Byte-for-byte the transform three.js's own <defaultnormal_vertex>
          // and <project_vertex> chunks apply under USE_BATCHING -- the
          // inverse-square divide is what keeps a non-uniformly scaled
          // instance's normal perpendicular to its surface.
          mat3 rlBatch = mat3(batchingMatrix);
          rlNormal /= vec3(
            dot(rlBatch[0], rlBatch[0]),
            dot(rlBatch[1], rlBatch[1]),
            dot(rlBatch[2], rlBatch[2])
          );
          rlNormal = rlBatch * rlNormal;
          rlPos = batchingMatrix * rlPos;
        #endif
        vNormal = normalize(normalMatrix * rlNormal);
        vWorldPos = (modelMatrix * rlPos).xyz;${coursing ? COURSE_VERTEX_GLSL : ''}
        gl_Position = projectionMatrix * modelViewMatrix * rlPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRamp[${RAMP_MAX}];
      uniform int uSteps;
      uniform vec3 uLightDir;
      ${specular ? SPECULAR_UNIFORMS_GLSL : ''}
      ${FLASH_UNIFORMS_GLSL}
      varying vec3 vNormal;
      varying vec3 vWorldPos;${coursing ? COURSE_VARYING_GLSL : ''}

      ${FLASH_SHIFT_GLSL}
      ${specular ? SPECULAR_GLSL : ''}${coursing ? courseShiftGlsl(coursing) : ''}

      void main() {
        float nl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
        // Quantize into uSteps bands, brightest band -> index 0.
        int band = int(floor((1.0 - nl) * float(uSteps)));
        band = min(band, uSteps - 1);${coursing ? COURSE_APPLY_GLSL : ''}
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
