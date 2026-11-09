/**
 * GH-943 WebGPU-primary P1 (T2): the AO pieces that are NOT a pass, split out of `post-chain.ts` so the node twin
 * (`post-chain.node.ts`, and the node AO of T7) can share them without importing a `three/addons/postprocessing` module (which
 * would drag the legacy composer into the node chunk: the bundle census fails on that).
 *
 * Contents: the AO constants, `isAoOccluder` (which meshes belong in the AO G-buffer), and the seeded Poisson-denoise noise.
 * `post-chain.ts` re-exports every name here, so each legacy importer is unchanged to the byte.
 *
 * Imports `three` and the addon-free `three/addons/math/SimplexNoise.js` only.
 */
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

/**
 * Ambient occlusion's reach, in WORLD units -- which on this map means
 * tiles, because the scene is authored one unit to the tile. 0.6 is a
 * contact shadow: the dark seam where a hull meets the ground and where a
 * wall meets the dirt it stands on, and nothing at the scale of a building
 * darkening the street beside it.
 *
 * It is a world figure rather than a screen one because `screenSpaceRadius`
 * is false below, and that is the deliberate opposite of the occlusion
 * outline (`units/silhouette.ts`), whose width is constant in PIXELS. An
 * outline is a readability device and has to stay legible at zoom 0.35; a
 * contact shadow is a claim about the world, so half a tile has to stay half
 * a tile when the camera pulls back or the shading swims as the player
 * zooms.
 */
export const AO_RADIUS_TILES = 0.6;
/** How hard the occlusion falls, before `blendIntensity` decides how much of
 *  it reaches the picture. Above 1 darkens the contact seam without widening
 *  it, which is what this scene wants -- the radius is already small. */
export const AO_SCALE = 1.2;
/**
 * The fraction of the frame the AO's own targets run at, and the reason this
 * pass ships at all. Measured, not chosen -- `docs/PERFORMANCE.md`, "Lit
 * renderer frame cost (2026-09-14)", on an M3 Pro through ANGLE/Metal at
 * 1440x900 and pixel ratio 2, two samples of each shipped configuration. AO
 * at FULL resolution lands the p95 of the acceptance view (zoom 0.5) at
 * 15.40 ms against a 16.7 ms frame budget -- and takes the two closer views
 * to 20.3-21.7 ms, 3.6-5.0 ms over. At half it costs 2.8-3.7 ms of median
 * across all three and every p95 stays under 13.2. What full resolution buys
 * back is sharpness in the occlusion TERM alone, which a Poisson denoise has
 * already blurred and which the blend lays over a full-resolution frame.
 */
export const AO_RESOLUTION_SCALE = 0.5;

/**
 * Whether an object belongs in the AO pass's G-buffer -- that is, whether it
 * is a piece of the opaque world whose shape should occlude light.
 *
 * **This scene cannot hand `GTAOPass` its own scene graph unfiltered, and
 * the failure is spectacular rather than subtle.** GTAO re-renders
 * everything through `scene.overrideMaterial = MeshNormalMaterial`, which
 * knows nothing about alpha, stencils or draw order -- so before this filter
 * existed, every unit, vehicle and building on screen came out SOLID BLACK,
 * over correct ground and correct trees. To see it again, or to check
 * anything else about this pass: set `pass.output = GTAOPass.OUTPUT.Normal`
 * in `createAoPass` and the frame becomes the G-buffer GTAO is working from,
 * where the defect is obvious and this predicate's three clauses were read
 * off rather than guessed.
 *
 * 1. **No `normal` attribute.** `units/silhouette.ts`'s inverted outline
 *    hull carries `position` and `aExpand` and nothing else, because its
 *    shader needs nothing else. `MeshNormalMaterial` normalises the missing
 *    attribute's zero vector, gets NaN, and writes BLACK -- and since that
 *    hull is the unit's own silhouette pushed outward, it covers the unit
 *    in both the normal buffer AND the depth buffer GTAO derives from it.
 *    Every billboard, tracer, trail and particle batch in this renderer is
 *    in the same position: a quad whose shape lives in a shader.
 * 2. **Transparent.** The override material draws a cut-out sprite as the
 *    full RECTANGLE and a unit mid-death-fade as a solid body, so a
 *    transparent mesh occludes a shape it does not have.
 * 3. **`depthWrite: false`.** The frame itself does not let these occlude
 *    anything -- decals, overlays, FX. Something that cannot hide what is
 *    behind it must not darken it either.
 * 4. **`userData.rlAoExempt`.** An opt-out by name, for an asset whose
 *    occlusion is already baked: the valley backdrop's kit (GH-161).
 *
 * Non-meshes pass: only meshes are drawn by the override material, and
 * `GTAOPass` already hides points and lines itself.
 *
 * Nothing opaque in this scene is caught by the first three -- terrain,
 * decor, buildings, mesh units and their wrecks all carry normals and draw
 * opaque, which is exactly the set that should cast AO.
 */
export function isAoOccluder(object: THREE.Object3D): boolean {
  if (!(object instanceof THREE.Mesh)) return true;
  // The valley backdrop's kit bakes its own ambient occlusion into its atlas (GH-161, lead ruling of 26 Oct), so a
  // screen-space term over it would be a second, wrong one: it opts out (`terrain/backdrop.ts`, rule 4).
  if ((object.userData as { rlAoExempt?: unknown }).rlAoExempt === true) return false;
  if (!object.geometry.getAttribute('normal')) return false;
  const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
  // A part-built construction clone is cut by a per-material clip plane, which the AO
  // pre-pass's MeshNormalMaterial override ignores: it would cast AO from its full height.
  if (materials.some((material) => (material.clippingPlanes?.length ?? 0) > 0)) return false;
  return materials.every((material) => !material.transparent && material.depthWrite);
}

/**
 * `GTAOPass` taught the four things this scene needs: that only the opaque
 * world belongs in its G-buffer (`isAoOccluder` above -- without it the
 * picture is unusable, not merely imperfect), that its own targets may run
 * at a fraction of the frame, that its G-buffer render must not drag the
 * sun's shadow map along with it, and that a throw inside that render must
 * not leave half the renderer invisible.
 *
 * **Half resolution has to live in `setSize`**, because the constructor's
 * `width`/`height` are overwritten by `EffectComposer.addPass` (see
 * `createAoPass`). It is sound because every one of the pass's own targets
 * is internal -- the normals, the raw AO and the denoised AO -- while the
 * two quads it draws into the CHAIN's buffer (`copyMaterial`, then
 * `blendMaterial`) are sized by that buffer, not by these. So the frame
 * stays full resolution and the occlusion term is sampled up, which is what
 * a half-res AO is.
 *
 * The constructor does not call `setSize`, so the subclass field is safe to
 * read by the time anything calls it -- verified against r170 and r186 source
 * rather than assumed, because a constructor that DID call it would read
 * `resolutionScale` as `undefined` and size every target NaN.
 */
/**
 * The seed for the AO pass's Poisson-denoise noise texture, and the reason
 * this renderer builds that texture itself.
 *
 * `GTAOPass`'s own `generateNoise` does `new SimplexNoise()`, and three's
 * `SimplexNoise` defaults its random source to `Math` -- so the 64x64 RGBA
 * texture the denoise samples is a fresh draw from `Math.random()` in every
 * process. Within one process the frame is bit-identical (the visual gate's
 * zero-time repaint control reads 0 px / 0.0000), which is exactly why this
 * hid until the gate compared two SEPARATE captures: with AO in the chain,
 * `quiet` moved 20 px / 0.1021, `relief` 2 px / 0.1418 and `vehicle` 57 px /
 * 0.1051 against a freshly-blessed baseline of the same commit, where the
 * pre-AO renderer read 0-1 px / 0.0000-0.0001 over 73 runs. Almost every
 * pixel shifting by a fraction of a level is the signature: a different
 * denoise kernel offset, not a different scene.
 *
 * A gate whose primary metric is `meanAbsChannelDelta` cannot live with
 * that, and `baseline.ts` is explicit that the fix is to find the drift
 * rather than widen the ceiling. So the noise is seeded instead: the same
 * texture in every process, on every machine, for ever.
 */
export const AO_NOISE_SEED = 0x5ea50f21;

/** mulberry32 -- three lines, no dependency, and the only property asked of
 *  it is that it give the same stream from the same seed in every engine.
 *  Shaped as `{ random() }` because that is the interface
 *  `SimplexNoise(r)` wants. */
export function seededRandomSource(seed: number): { random(): number } {
  let state = seed >>> 0;
  return {
    random(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * The seeded Poisson-denoise noise texture -- r170's own noise loop with a
 * SEEDED simplex. See `AO_NOISE_SEED` for the measurement that made it
 * necessary.
 *
 * The loop is copied rather than delegated because `GTAOPass` builds its
 * `SimplexNoise` inline, so there is no seam to inject through short of
 * swapping the global `Math.random` around a `super` call. The output
 * contract is the part that matters and it is narrow: a 64x64 RGBA
 * `DataTexture`, repeat-wrapped, sampled by the Poisson denoise for a
 * per-pixel kernel rotation. Any noise field satisfies it; only
 * REPEATABILITY is at stake here.
 */
export function seededAoNoiseTexture(size = 64): THREE.DataTexture {
  const simplex = new SimplexNoise(seededRandomSource(AO_NOISE_SEED));
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const at = (i * size + j) * 4;
      data[at] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
      data[at + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[at + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
      data[at + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
  }
  const noiseTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  noiseTexture.wrapS = THREE.RepeatWrapping;
  noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}
