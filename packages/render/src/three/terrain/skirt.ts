/**
 * The ground BEYOND the map, so the world does not end in a hard diagonal.
 *
 * A map is a rectangle of tiles and the camera is dimetric, so at minimum
 * zoom the playable ground is a lozenge in the middle of a frame whose other
 * 55% is `scene.background` -- one flat palette colour, meeting lit terrain
 * along four dead-straight, hard-edged lines. The skirt is a single flat
 * quad three map-widths by three map-heights, centred on the map, carrying
 * the same open-ground albedo at a dark, desaturated tone: the boundary
 * moves a whole map-width outward and lands in ground that is already close
 * to the background it meets. `../vignette-pass.ts` does the other half --
 * it darkens wherever that boundary ends up.
 *
 * Four things about it are deliberate, and three of them were nearly wrong.
 *
 * **It sits `MARK_EPSILON` BELOW the map's base level, not at it.** A flat
 * map's terrain is at exactly y = 0, so coplanar at base level the skirt
 * would z-fight the entire playable area. The repo's own mark epsilon is the
 * right size for the opposite reason it was chosen (`shared.ts`: under 4% of
 * a terrace step, and it clears one orthographic depth-buffer step with room
 * to spare), and it is what makes the step at the map edge invisible.
 * **`polygonOffset` is NOT the fix here**, tempting as it looks: `GTAOPass`
 * re-renders the scene through its own `MeshNormalMaterial`, which carries
 * its own offset state, so the z-fight would come straight back in the AO
 * G-buffer and scatter occlusion noise over the whole map.
 *
 * **G5: the geometry is a RING, not a rectangle, and that is not tidiness --
 * it is the fix for a real defect.** It used to be one rectangle spanning the
 * map's own footprint as well as the ground around it, relying on `SKIRT_Y`
 * sitting below y = 0 to keep it hidden under the map's own terrain. That
 * stopped being true when the ground surface went from flat terraces to
 * Catmull-Rom bicubic over tile centres (`ground.ts`): the curve UNDERSHOOTS
 * between authored heights, and on `tel_marum` it dips to -0.077 -- nearly 8x
 * past the skirt's -0.01. Wherever the smoothed surface dipped below the
 * skirt, the skirt showed THROUGH it: a flat, uniformly dark, desaturated
 * patch of the wrong ground colour bleeding through relief, photographed as
 * blue-grey bands. `SKIRT_Y` cannot be lowered to fix this -- the whole point
 * of that number is to be barely below y = 0, and -0.077 is already most of
 * a terrace step; chasing the undershoot down would just move the z-fight
 * risk back onto a shallower one. `skirtRing` instead removes the footprint
 * `[0,w]x[0,h]` from the quad entirely (see its own doc comment below), so
 * there is no skirt geometry left for the ground to dip below -- the fix is
 * geometric, not a tolerance.
 *
 * **The albedo is applied as a RATIO, exactly as the ground applies it.**
 * `desert_sand_tile` is not a colour, it is a variation field measured
 * against its own mean (`mesh.ts`'s `GROUND_ALBEDOS`), which is why it is
 * tagged `NoColorSpace`. So the material's `color` is `SKIRT_TONE` divided
 * by that mean, and the product averages to `SKIRT_TONE` -- a warm grey.
 * Binding the image as a plain `map` at a grey multiplier instead would give
 * the skirt the raw photograph's own saturated sand hue at 48% brightness,
 * which is darker but not desaturated, and the map edge would still read as
 * a tone change rather than as a fade.
 *
 * **It takes no shadow and casts none.** The sun's shadow box is fitted to
 * the map (`../lighting.ts`, `shadowBoxRadius`), so two thirds of this quad
 * is outside it in every direction; receiving would sample past the map's
 * edge and casting would achieve nothing, a flat plane having no relief to
 * throw.
 *
 * **It is not a second playable floor.** `SKIRT_TONE` is low enough that the
 * tiling repeat does not read at gameplay zoom; if it ever does, that number
 * is the one to lower (the brief's own fallback is 0.35), never the
 * vignette's.
 */
import * as THREE from 'three';
import { MARK_EPSILON } from './shared';
import { WORLD_RENDER_ORDER } from '../units/render-order';

/** How many map-widths (and map-heights) the skirt spans, centred on the
 *  map -- so it reaches one full map out in every direction. On a 48x48 map
 *  at zoom 0.35 that is ~1075 screen px of margin against a 960 px frame
 *  half-width, which is what makes it cover the frame corners. */
export const SKIRT_EXTENT = 3;

/**
 * The warm grey the skirt AVERAGES to, in linear light -- what the sand
 * ratio field is multiplied into.
 *
 * Warm rather than neutral (r > g > b) because the ground it continues is
 * desert, and a neutral grey beyond a sand-toned map reads as a different
 * material rather than as the same ground going dark. Dark enough that the
 * eye takes it for unlit distance, light enough that a wreck or a unit that
 * strays past the boundary is still legible against it.
 */
export const SKIRT_TONE = new THREE.Color(0.48, 0.45, 0.42);

/**
 * How far below the map's base level the quad lies. See this module's header
 * -- it is the z-fight fix, and `MARK_EPSILON` is reused rather than a new
 * number invented because it is the same question (how far apart do two
 * nominally-coplanar surfaces have to be in this camera's depth buffer)
 * asked in the other direction.
 */
export const SKIRT_Y = -MARK_EPSILON;

/** The default repeat until the real image lands, matching
 *  `GROUND_ALBEDOS.desert_sand_tile.tiles`. Only the `uv` attribute this
 *  seeds is affected, and nothing samples it while `map` is null. */
const DEFAULT_TILES_PER_REPEAT = 4;

export type SkirtMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** The quad's world-space bounds in tile units: `-width .. 2*width` and
 *  `-height .. 2*height`, i.e. `SKIRT_EXTENT` maps across, centred. */
export function skirtBounds(
  width: number,
  height: number
): { x0: number; x1: number; z0: number; z1: number } {
  const marginX = width * ((SKIRT_EXTENT - 1) / 2);
  const marginZ = height * ((SKIRT_EXTENT - 1) / 2);
  return { x0: -marginX, x1: width + marginX, z0: -marginZ, z1: height + marginZ };
}

/**
 * One tile is one world unit (`ground.ts` emits its quads at raw tile
 * coordinates), so the skirt's UVs are the same function of world position
 * the ground shader uses -- `vGroundUv / uSandTiles`, with `vGroundUv` the
 * vertex's own `(x, z)`. Writing it into the `uv` attribute rather than into
 * `map.repeat` matters: the texture object is SHARED with the ground
 * material's `uSand` sampler, and mutating a shared texture's transform to
 * serve one of its two consumers is the kind of coupling that breaks the
 * other one silently later.
 */
function writeSkirtUv(geometry: THREE.BufferGeometry, tilesPerRepeat: number): void {
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tilesPerRepeat;
    uv[i * 2 + 1] = pos.getZ(i) / tilesPerRepeat;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * The ring of eight vertices and eight triangles `buildSkirt` draws: the
 * outer rectangle `o0..o3` from `skirtBounds`, then the map's own footprint
 * `i0=(0,0) i1=(w,0) i2=(w,h) i3=(0,h)`, both at `SKIRT_Y`. Four trapezoids,
 * one per edge of the rectangle, each split into two triangles -- covering
 * the margin between the two rectangles and NOTHING inside the inner one, so
 * there is no skirt geometry left for the smoothed ground to dip below (see
 * this module's header, "G5").
 *
 * Pure, and exported so `skirt.test.ts` can check the geometry directly
 * without going through a `THREE.Mesh`.
 *
 * Each trapezoid is wound `[o_k, o_{k+1}, i_{k+1}, i_k]` and split with
 * `pushPolygon`'s UNFLIPPED fan, `(0, i+1, i)` over that four-point list --
 * `(o_k, i_{k+1}, o_{k+1})` then `(o_k, i_k, i_{k+1})` -- the same fan
 * `buildSkirt` always used for its one rectangle, applied per edge instead of
 * once. That is what points every triangle's front face at +Y; the obvious
 * winding points it at the ground, and with `FrontSide` culling the skirt
 * then draws nothing at all. `skirt.test.ts` computes each face normal from
 * the geometry rather than reading the `normal` attribute, so it catches
 * exactly that.
 */
export function skirtRing(
  width: number,
  height: number
): { positions: Float32Array; indices: Uint16Array } {
  const { x0, x1, z0, z1 } = skirtBounds(width, height);
  const outer: ReadonlyArray<readonly [number, number]> = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const inner: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const positions = new Float32Array(8 * 3);
  for (let k = 0; k < 4; k++) {
    positions[k * 3] = outer[k][0];
    positions[k * 3 + 1] = SKIRT_Y;
    positions[k * 3 + 2] = outer[k][1];
    positions[(4 + k) * 3] = inner[k][0];
    positions[(4 + k) * 3 + 1] = SKIRT_Y;
    positions[(4 + k) * 3 + 2] = inner[k][1];
  }
  const indices: number[] = [];
  for (let k = 0; k < 4; k++) {
    const kn = (k + 1) % 4;
    indices.push(k, 4 + kn, kn);
    indices.push(k, 4 + k, 4 + kn);
  }
  return { positions, indices: new Uint16Array(indices) };
}

/**
 * The skirt mesh for a `width` x `height` map. Add it to the scene where the
 * ground goes; dispose it with the ground.
 *
 * `renderOrder` is the world band (-1), the same band mesh buildings draw
 * in: this is opaque, depth-writing world geometry that units stand in front
 * of, and the band costs nothing while keeping it out of every translucent
 * tier's sort.
 */
export function buildSkirt(width: number, height: number): SkirtMesh {
  const { positions, indices } = skirtRing(width, height);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  writeSkirtUv(geometry, DEFAULT_TILES_PER_REPEAT);

  const material = new THREE.MeshStandardMaterial({
    color: SKIRT_TONE.clone(),
    roughness: 1,
    metalness: 0,
    depthWrite: true,
  });
  const mesh: SkirtMesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = WORLD_RENDER_ORDER;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  // A quad this large around a camera that never leaves the map cannot be
  // culled correctly by a bounding sphere the map's own size, and it is one
  // draw call of two triangles either way.
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Bind the open-ground albedo once `ThreeRenderer.loadGroundTexture` has it.
 *
 * `mean` is the image's own mean in 0..1 (`mesh.ts`'s `albedoMean`), and
 * dividing `SKIRT_TONE` by it is what turns a plain `map` multiply into the
 * ratio form the ground uses -- see this module's header. Until this runs,
 * and for ever on a map whose tile 404s, the skirt draws flat `SKIRT_TONE`,
 * which is the same average colour with none of the variation: the
 * fail-soft path is a duller skirt, never a differently-coloured one.
 */
export function setSkirtAlbedo(
  mesh: SkirtMesh,
  map: THREE.Texture,
  mean: THREE.Vector3,
  tilesPerRepeat: number
): void {
  writeSkirtUv(mesh.geometry, tilesPerRepeat);
  mesh.material.map = map;
  mesh.material.color.setRGB(
    SKIRT_TONE.r / mean.x,
    SKIRT_TONE.g / mean.y,
    SKIRT_TONE.b / mean.z,
    THREE.LinearSRGBColorSpace
  );
  mesh.material.needsUpdate = true;
}

/** Geometry and material both, in the one place that owns them. */
export function disposeSkirt(mesh: SkirtMesh): void {
  mesh.geometry.dispose();
  mesh.material.dispose();
}
