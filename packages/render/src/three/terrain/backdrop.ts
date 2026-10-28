/**
 * The valley backdrop: relief BEYOND the map, so a Wadi Halam frame reads as
 * the floor of a mountain valley (Lane B "Wadi Halam look", GH-161). The
 * record is `_coord/wadi-halam-look/` (proposal, kit spec, render-2 notes).
 *
 * Presentation only. Nothing here is read by the sim, by picking or by any
 * gate pin: it replaces `skirt.ts`'s flat dark ring on a map whose JSON
 * carries a `backdrop` block, and on every other map nothing changes.
 *
 * Two layers, in this order.
 *
 * 1. **The floor** (`floorHeight`, this file): a 1-tile grid ring around the
 *    map, 48 tiles out, that meets the map's rim to 1e-6 and settles to the
 *    rim's mean within 10 tiles. It is plain pasture, coloured by a baked
 *    4-texel-a-tile texture from palette keys. It is the prototype's floor
 *    with its procedural walls taken out: the walls are the kit.
 * 2. **The kit** (`backdrop-kit.ts`, `meshes/backdrop/<kit>.glb`): hand-built
 *    cliff, crest, scree, terrace and slope pieces, placed by the map's
 *    explicit `pieces` list, merged into ONE mesh whose every vertex height is
 *    baked from the floor under it. The olives on the terrace treads are one
 *    instanced batch and the placeholder hamlet houses another.
 *
 * Four rules shape it, each the answer to a way it could hurt play.
 *
 * 1. **It never covers the playable lozenge.** The camera looks down at 30
 *    degrees along (+1, +1) in world x/z (`camera.ts`'s VIEW_DIRECTION). A
 *    point beyond the FAR edges (x < 0 or z < 0) can never stand between the
 *    camera and the map, so the walls there rise as steeply as they like. A
 *    point beyond the NEAR edges can, exactly when the ray from it back along
 *    (-1, 0, -1) enters the map: it then hides map ground at the entry point
 *    once it stands more than `t0 * sqrt2 * tan30 = 0.816 t0` above it, `t0`
 *    tiles out. `NEAR_CAP_SLOPE` holds those points to 0.45 t0 -- 55% of the
 *    limit. The near slopes are authored under it (kit-spec section 2) and
 *    `backdrop.test.ts` checks the PLACED vertices of every shipped map against
 *    both the design cap and the hard limit, and that no piece stands up out
 *    of the playable rectangle.
 * 2. **It casts no shadow and takes none**, like the skirt: the shadow box is
 *    fitted to the view, and a 14-unit wall beyond the west edge under the
 *    side sun (from -x) would lay a 7-tile band of shade across play.
 * 3. **It is the fog of war's "explored" ground, not never-seen.** The fog
 *    pass's off-map fade goes to `BACKDROP_OFFMAP_SEEN` instead of 0 when a
 *    backdrop is on (see `fog-pass.ts`), so the valley is lit scenery -- dimmed
 *    and desaturated a little, which also pushes it back behind play --
 *    rather than a black frame. No information lives out there.
 * 4. **The kit is outside the AO pre-pass** (lead ruling, 26 Oct): its AO is
 *    baked into the atlas, and a screen-space term over a wall would be a
 *    second, wrong one. Its meshes carry `userData.rlAoExempt`
 *    (`post-chain.ts`'s `isAoOccluder` honours it); the floor stays in, as the
 *    skirt it replaces always was.
 *
 * Colour: every tone is a palette key (`paletteHex`), mixed in sRGB in the
 * bake, and the textures are `SRGBColorSpace` like every base-colour map. Noise
 * is the repo's own hand-rolled value noise (`noise.ts`), seeded from the
 * map's block, so a backdrop is identical on every load.
 */
import * as THREE from 'three';
import { fbm2, valueNoise2 } from './noise';
import { hexToUnit, hexToLinear } from './shared';
import { paletteHex } from '../palette-hex';
import { WORLD_RENDER_ORDER } from '../units/render-order';
import { assembleKit, floorSurface, LOD1_BELOW_ZOOM, type BackdropPiece, type KitSource, type PlacedKit } from './backdrop-kit';

/** A map's `backdrop` block (map.schema.json), as the renderer reads it. */
export interface BackdropSpec {
  /** The valley's axis in MAP terms (`ns` runs along the rows). The layout tool reads it; the renderer places
   *  only what `pieces` lists. */
  readonly valley: 'ns' | 'ew';
  /** Crest height above the valley floor, in elevation levels (the layout tool's input). */
  readonly crest: number;
  /** Noise seed for the floor's mottle and colour. */
  readonly seed: number;
  /** The kit GLB's id (`wadi_halam_kit`): `art/meshes/backdrop/<kit>.glb`. */
  readonly kit: string;
  /** The explicit piece list, written by `pnpm backdrop:layout` and then hand-edited. */
  readonly pieces: readonly BackdropPiece[];
}

/** World Y of the map's drawn ground at a point inside `[0,w]x[0,h]`. */
export type RimHeight = (x: number, z: number) => number;

/** How far the backdrop reaches past each edge, in map widths (the skirt's
 *  own extent, `skirt.ts`'s SKIRT_EXTENT 3 => one map out each way). */
const MARGIN_MAPS = 1;
/** Colour texels per tile in the floor bake. 4 => 576x576 on a 48x48 map. */
export const TEXELS_PER_TILE = 4;
/** See rule 1 in the header: 55% of the 0.816 occlusion slope. */
export const NEAR_CAP_SLOPE = 0.45;
/** The hard limit: `sqrt2 * tan30`, the camera's descent per tile along the view axis. */
export const NEAR_HARD_SLOPE = Math.SQRT2 * Math.tan(Math.PI / 6);
/** The fog pass's off-map value while a backdrop is on (0 never seen, 0.5
 *  explored, 1 in sight). 0.5 is a rule, not a taste: scenery is shown as
 *  explored ground -- dimmer than anything in sight, brighter than ground the
 *  player has never seen, so the unexplored play area never reads as a hole
 *  in a brighter frame. */
export const BACKDROP_OFFMAP_SEEN = 0.5;
/** The scene-background fade, as fractions of the margin (render-2: the kit's near slopes reach 40 tiles). */
export const FADE_FROM = 0.5;
export const FADE_TO = 0.8;
/** The share of the olives drawn below `LOD1_BELOW_ZOOM`: each is three pixels across there, and the atlas carries
 *  baked olive dots as well. */
export const OLIVE_SHARE_AT_MIN_ZOOM = 0.5;
/** The floor sits this far under the rim along the map's own boundary, so the two never z-fight (`skirt.ts`'s
 *  MARK_EPSILON reason). */
const RIM_EPSILON = 0.01;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
type Rgb = [number, number, number];
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tone = (key: string): Rgb => hexToUnit(paletteHex(key));
/** A brightness-ordered list of palette keys walked by a float index (the kit tools' `Ladder`). */
const ladder = (keys: readonly string[]): ((i: number) => Rgb) => {
  const rgb = keys.map(tone);
  return (idx: number): Rgb => {
    const i = clamp(idx, 0, rgb.length - 1);
    const i0 = Math.min(Math.floor(i), rgb.length - 2);
    return mix3(rgb[i0], rgb[i0 + 1], i - i0);
  };
};

/**
 * The floor's height. Pure: the same spec, rim and map size always give the
 * same surface. The rim blended to its own mean over 10 tiles, plus an
 * 18-tile swell fading in over 6 -- the render-2 mock's floor, which is the
 * one the lead approved.
 */
export function floorHeight(spec: Pick<BackdropSpec, 'seed'>, rim: RimHeight, w: number, h: number): (x: number, z: number) => number {
  const seed = spec.seed | 0;
  // The rim's mean along the four edges: where the floor settles a few tiles
  // out, so a building pad or a one-tile spike on the edge does not run on
  // across the whole backdrop.
  let rimSum = 0;
  let rimN = 0;
  for (let i = 0; i <= w; i++) {
    rimSum += rim(i, 0) + rim(i, h);
    rimN += 2;
  }
  for (let j = 0; j <= h; j++) {
    rimSum += rim(0, j) + rim(w, j);
    rimN += 2;
  }
  const rimMean = rimSum / rimN;
  return (x: number, z: number): number => {
    const out = Math.hypot(Math.max(-x, x - w, 0), Math.max(-z, z - h, 0));
    const base = rim(clamp(x, 0, w), clamp(z, 0, h));
    return base + (rimMean - base) * smooth(0, 10, out) + 0.3 * fbm2(x, z, 18, 2, seed + 6) * smooth(0, 6, out);
  };
}

/** The highest a point may stand at `(x, z)` (rule 1), or Infinity. */
export function nearCap(rim: RimHeight, w: number, h: number, x: number, z: number): number {
  const t0 = Math.max(x - w, z - h);
  if (t0 <= 0) return Infinity;
  const ex = x - t0;
  const ez = z - t0;
  if (Math.min(ex, ez) < -6) return Infinity;
  return rim(clamp(ex, 0, w), clamp(ez, 0, h)) + NEAR_CAP_SLOPE * t0;
}

/** A kit once the renderer has read it: the source geometry, its atlas and the olive. */
export interface LoadedBackdropKit {
  readonly source: KitSource;
  /** The one atlas, `SRGBColorSpace`, shared by the kit mesh and the olives. */
  readonly map: THREE.Texture;
  /** The olive piece's geometry, in tiles, base at the origin; null when the kit has none. */
  readonly olive: THREE.BufferGeometry | null;
}

export interface Backdrop {
  readonly group: THREE.Group;
  /** Swap the kit between its full meshes and their LOD1 twins, and thin the olives, for this camera zoom (per
   *  frame, cheap). */
  setZoom(zoom: number): void;
  readonly stats: {
    /** Floor + kit + olives + houses, with the kit at full detail. */
    readonly triangles: number;
    /** The same with the kit at LOD1: what is drawn below `LOD1_BELOW_ZOOM`. */
    readonly trianglesLod1: number;
    readonly pieces: number;
    readonly olives: number;
    readonly houses: number;
    readonly bakeMs: number;
    readonly assembleMs: number;
    readonly texels: number;
  };
}

/** The floor's lattice margin, in tiles. */
export function floorMargin(w: number, h: number): number {
  return Math.round(Math.max(w, h) * MARGIN_MAPS);
}

/** The floor as a lattice: heights at integer `(x0 + i, z0 + j)`, the drawn mesh's own vertices. */
export interface FloorGrid {
  readonly heights: Float32Array;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** The margin in tiles. */
  readonly M: number;
}

/** The floor's lattice heights for a `w` x `h` map (the rim a hair under on the map's own boundary). */
export function floorGrid(spec: Pick<BackdropSpec, 'seed'>, rim: RimHeight, w: number, h: number): FloorGrid {
  const M = floorMargin(w, h);
  const x0 = -M;
  const z0 = -M;
  const nx = w + 2 * M + 1;
  const nz = h + 2 * M + 1;
  const field = floorHeight(spec, rim, w, h);
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i;
      const z = z0 + j;
      const onRim = x >= 0 && x <= w && z >= 0 && z <= h;
      heights[j * nx + i] = field(x, z) - (onRim ? RIM_EPSILON : 0);
    }
  }
  return { heights, x0, z0, nx, nz, M };
}

/** Place the kit's pieces on the floor under `spec`: exactly what `buildBackdrop` draws, without the three objects. */
export function placeKit(spec: BackdropSpec, source: KitSource, rim: RimHeight, w: number, h: number): { grid: FloorGrid; placed: PlacedKit } {
  const grid = floorGrid(spec, rim, w, h);
  const placed = assembleKit(spec, source, floorSurface(grid.heights, grid.x0, grid.z0, grid.nx, grid.nz), (x, z) => nearCap(rim, w, h, x, z));
  return { grid, placed };
}

/**
 * Build the backdrop for a `w` x `h` map. `rim` samples the map's drawn
 * ground; call again (and dispose the old one) if the elevation changes. The
 * kit is shared and owned by the caller: `disposeBackdrop` releases only what
 * this call made.
 */
export function buildBackdrop(spec: BackdropSpec, kit: LoadedBackdropKit, rim: RimHeight, w: number, h: number, background: string): Backdrop {
  const t0 = performance.now();
  // The floor's lattice and the kit placed on it, in one call the tests also make: what they check is what is drawn.
  const { grid, placed } = placeKit(spec, kit.source, rim, w, h);
  const assembleMs = performance.now() - t0;
  const { heights, x0, z0, nx, nz, M } = grid;

  // --- the floor mesh: the grid minus the map's own footprint ---------------
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const at = (i: number, j: number): number => heights[clamp(j, 0, nz - 1) * nx + clamp(i, 0, nx - 1)];
  const n = new THREE.Vector3();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      positions[k * 3] = x0 + i;
      positions[k * 3 + 1] = heights[k];
      positions[k * 3 + 2] = z0 + j;
      n.set(-(at(i + 1, j) - at(i - 1, j)), 2, -(at(i, j + 1) - at(i, j - 1))).normalize();
      normals[k * 3] = n.x;
      normals[k * 3 + 1] = n.y;
      normals[k * 3 + 2] = n.z;
      uvs[k * 2] = i / (nx - 1);
      uvs[k * 2 + 1] = j / (nz - 1);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const cx = x0 + i;
      const cz = z0 + j;
      if (cx >= 0 && cx < w && cz >= 0 && cz < h) continue; // the map's own tile
      // Beyond the fade (`FADE_TO` of the margin) the frame is the scene background and nothing shows: those cells are
      // not drawn at all. Their heights still exist (the kit samples them), they just cost no triangles.
      if (Math.hypot(Math.max(0, -(cx + 1), cx - w), Math.max(0, -(cz + 1), cz - h)) > M * FADE_TO) continue;
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Front faces up (+Y), the winding `skirt.ts` documents. `floorSurface` triangulates the same way.
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));

  // --- the floor's colour bake ---------------------------------------------
  const T = TEXELS_PER_TILE;
  const tw = (nx - 1) * T;
  const th = (nz - 1) * T;
  const data = new Uint8Array(tw * th * 4);
  const seed = spec.seed | 0;
  const grass = ladder(['grass.2', 'grass.3', 'grass.4', 'scrub.0', 'scrub.1', 'olive.2']);
  const dust = ladder(['dust.0', 'dust.1', 'dust.2', 'dust.3', 'dust.4', 'dust.5', 'dust.6']);
  // Periods in metres in the kit tools (3 m a tile): 34 m, 8 m, 1.6 m.
  for (let ty = 0; ty < th; ty++) {
    const wz = z0 + (ty + 0.5) / T;
    for (let tx = 0; tx < tw; tx++) {
      const wx = x0 + (tx + 0.5) / T;
      const nBig = fbm2(wx, wz, 34 / 3, 3, seed + 81);
      const nMid = fbm2(wx, wz, 8 / 3, 3, seed + 82);
      const nFine = valueNoise2(wx, wz, 3 / 1.6, seed + 83);
      let col = grass(clamp(1.3 + 1.1 * nMid + 0.5 * nFine, 0, 5));
      col = mix3(col, dust(clamp(1.4 + 1.2 * nMid, 0, 6)), 0.35 * smooth(0, 0.6, nBig));
      const o = (ty * tw + tx) * 4;
      data[o] = clamp(Math.round(col[0] * 255), 0, 255);
      data[o + 1] = clamp(Math.round(col[1] * 255), 0, 255);
      data[o + 2] = clamp(Math.round(col[2] * 255), 0, 255);
      data[o + 3] = 255;
    }
  }
  const floorMap = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat, THREE.UnsignedByteType);
  floorMap.colorSpace = THREE.SRGBColorSpace;
  floorMap.wrapS = THREE.ClampToEdgeWrapping;
  floorMap.wrapT = THREE.ClampToEdgeWrapping;
  floorMap.magFilter = THREE.LinearFilter;
  floorMap.minFilter = THREE.LinearMipmapLinearFilter;
  floorMap.generateMipmaps = true;
  floorMap.anisotropy = 4;
  floorMap.needsUpdate = true;
  // DataTexture rows run bottom-up in GL; the uv above already maps j -> v.
  floorMap.flipY = false;
  const bakeMs = performance.now() - t0 - assembleMs;

  const floorMat = new THREE.MeshStandardMaterial({ map: floorMap, roughness: 1, metalness: 0 });
  fadeToBackground(floorMat, w, h, M, background);
  const ground = new THREE.Mesh(geometry, floorMat);
  ground.name = 'backdrop-ground';
  ground.renderOrder = WORLD_RENDER_ORDER;
  ground.castShadow = false;
  ground.receiveShadow = false;
  ground.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'backdrop';
  group.add(ground);

  // --- the kit: placed on the floor, merged into one mesh ----------------------
  const kitGeo = new THREE.BufferGeometry();
  kitGeo.setAttribute('position', new THREE.BufferAttribute(placed.positions, 3));
  kitGeo.setAttribute('normal', new THREE.BufferAttribute(placed.normals, 3));
  kitGeo.setAttribute('uv', new THREE.BufferAttribute(placed.uvs, 2));
  kitGeo.setIndex(new THREE.BufferAttribute(placed.indices, 1));
  // One material per mesh, one atlas between them (the olive instances draw through the second).
  const kitMat = new THREE.MeshStandardMaterial({ map: kit.map, roughness: 1, metalness: 0, envMapIntensity: 0 });
  fadeToBackground(kitMat, w, h, M, background);
  const kitMesh = new THREE.Mesh(kitGeo, kitMat);
  kitMesh.name = 'backdrop-kit';
  kitMesh.renderOrder = WORLD_RENDER_ORDER;
  kitMesh.castShadow = false;
  kitMesh.receiveShadow = false;
  kitMesh.frustumCulled = false;
  kitMesh.userData.rlAoExempt = true;
  group.add(kitMesh);
  // The LOD1 twin: same material, the reduced meshes, drawn instead of the full ones below LOD1_BELOW_ZOOM.
  const lodGeo = new THREE.BufferGeometry();
  lodGeo.setAttribute('position', new THREE.BufferAttribute(placed.lod1.positions, 3));
  lodGeo.setAttribute('normal', new THREE.BufferAttribute(placed.lod1.normals, 3));
  lodGeo.setAttribute('uv', new THREE.BufferAttribute(placed.lod1.uvs, 2));
  lodGeo.setIndex(new THREE.BufferAttribute(placed.lod1.indices, 1));
  const kitLod1 = new THREE.Mesh(lodGeo, kitMat);
  kitLod1.name = 'backdrop-kit-lod1';
  kitLod1.renderOrder = WORLD_RENDER_ORDER;
  kitLod1.castShadow = false;
  kitLod1.receiveShadow = false;
  kitLod1.frustumCulled = false;
  kitLod1.userData.rlAoExempt = true;
  kitLod1.visible = false;
  group.add(kitLod1);

  let triangles = index.length / 3 + placed.triangles;
  let oliveInst: THREE.InstancedMesh | null = null;
  if (placed.olives.length > 0 && kit.olive !== null) {
    const oliveMat = new THREE.MeshStandardMaterial({ map: kit.map, roughness: 1, metalness: 0, envMapIntensity: 0 });
    fadeToBackground(oliveMat, w, h, M, background);
    const inst = new THREE.InstancedMesh(kit.olive, oliveMat, placed.olives.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let k = 0; k < placed.olives.length; k++) {
      const o = placed.olives[k];
      q.setFromAxisAngle(up, o.yaw);
      m.compose(pos.set(o.x, o.y, o.z), q, sc.set(o.scale, o.scaleY, o.scale));
      inst.setMatrixAt(k, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'backdrop-olives';
    inst.renderOrder = WORLD_RENDER_ORDER;
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.frustumCulled = false;
    inst.userData.rlAoExempt = true;
    group.add(inst);
    oliveInst = inst;
    triangles += placed.olives.length * (kit.olive.index ? kit.olive.index.count / 3 : 0);
  }

  // --- the placeholder hamlet houses, at the kit's anchors -----------------------
  if (placed.houses.length > 0) {
    const houseGeo = houseGeometry();
    const houseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    fadeToBackground(houseMat, w, h, M, background);
    const inst = new THREE.InstancedMesh(houseGeo, houseMat, placed.houses.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let k = 0; k < placed.houses.length; k++) {
      const hs = placed.houses[k];
      q.setFromAxisAngle(up, hs.yaw);
      m.compose(pos.set(hs.x, hs.y, hs.z), q, sc.set(hs.size, hs.tall, hs.size));
      inst.setMatrixAt(k, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'backdrop-houses';
    inst.renderOrder = WORLD_RENDER_ORDER;
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.frustumCulled = false;
    inst.userData.rlAoExempt = true;
    group.add(inst);
    triangles += placed.houses.length * 14;
  }

  const extra = triangles - placed.triangles; // floor + olives + houses
  const oliveTris = kit.olive?.index ? kit.olive.index.count / 3 : 0;
  return {
    group,
    setZoom(zoom: number): void {
      const low = zoom < LOD1_BELOW_ZOOM;
      kitMesh.visible = !low;
      kitLod1.visible = low;
      // The list is in a fixed hash order, so the first half is an even half of the trees.
      if (oliveInst) oliveInst.count = low ? Math.ceil(placed.olives.length * OLIVE_SHARE_AT_MIN_ZOOM) : placed.olives.length;
    },
    stats: {
      triangles,
      trianglesLod1: extra - (placed.olives.length - Math.ceil(placed.olives.length * OLIVE_SHARE_AT_MIN_ZOOM)) * oliveTris + placed.lod1.triangles,
      pieces: placed.pieces,
      olives: placed.olives.length,
      houses: placed.houses.length,
      bakeMs,
      assembleMs,
      texels: tw * th,
    },
  };
}

/**
 * The mesh ends `M` tiles out and the camera, at minimum zoom, sees past that
 * on the near sides (the ramp lifts its own far edge up the screen), so an
 * unfaded edge is a hard line against the clear colour. Fade the lit colour
 * to the scene background over `FADE_FROM`-`FADE_TO` of the margin, in the
 * fragment shader and in linear light (the colour pass is HalfFloat,
 * tone-mapped later), so the edge is exactly the background and never a step.
 */
function fadeToBackground(mat: THREE.MeshStandardMaterial, w: number, h: number, M: number, background: string): void {
  const bg = hexToLinear(background);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBdBg = { value: new THREE.Vector3(bg[0], bg[1], bg[2]) };
    shader.uniforms.uBdSize = { value: new THREE.Vector2(w, h) };
    shader.uniforms.uBdFade = { value: new THREE.Vector2(M * FADE_FROM, M * FADE_TO) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBdXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n  vBdXZ = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz;\n#else\n  vBdXZ = (modelMatrix * vec4(position, 1.0)).xz;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBdXZ;\nuniform vec3 uBdBg;\nuniform vec2 uBdSize;\nuniform vec2 uBdFade;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n  {\n    vec2 bdOut = max(vec2(0.0), max(-vBdXZ, vBdXZ - uBdSize));\n    float bdF = smoothstep(uBdFade.x, uBdFade.y, length(bdOut));\n    gl_FragColor.rgb = mix(gl_FragColor.rgb, uBdBg, bdF);\n  }'
      );
  };
}

/** A unit house: a limestone box with a terracotta hip roof, vertex
 *  coloured (linear, like every vertex colour in this backend), one
 *  geometry for the whole instanced batch. 14 triangles. Sized to the render-2
 *  mock's placeholder: a body 0.9 wide-units tall, a roof peaking 0.45 of it higher. */
function houseGeometry(): THREE.BufferGeometry {
  const wall = hexToLinear(paletteHex('limestone.2'));
  const wallShade = hexToLinear(paletteHex('limestone.4'));
  const roof = hexToLinear(paletteHex('terracotta.1'));
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], cc: readonly number[]): void => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(cc[0], cc[1], cc[2]);
  };
  const H = 1;
  const r = 0.5;
  // Four walls, outward-facing.
  quad([-r, 0, r], [r, 0, r], [r, H, r], [-r, H, r], wall);
  quad([r, 0, -r], [-r, 0, -r], [-r, H, -r], [r, H, -r], wallShade);
  quad([r, 0, r], [r, 0, -r], [r, H, -r], [r, H, r], wall);
  quad([-r, 0, -r], [-r, 0, r], [-r, H, r], [-r, H, -r], wallShade);
  // The hip roof: four triangles to a ridge point, with a small overhang.
  const o = 0.58;
  const top = [0, H + 0.45, 0];
  const e = [
    [-o, H, o],
    [o, H, o],
    [o, H, -o],
    [-o, H, -o],
  ];
  for (let k = 0; k < 4; k++) {
    pos.push(...e[k], ...e[(k + 1) % 4], ...top);
    for (let i = 0; i < 3; i++) col.push(roof[0], roof[1], roof[2]);
  }
  // Roof underside, so a low camera never sees through the eaves.
  pos.push(...e[0], ...e[2], ...e[1], ...e[0], ...e[3], ...e[2]);
  for (let i = 0; i < 6; i++) col.push(wallShade[0], wallShade[1], wallShade[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Releases what `buildBackdrop` made: the floor and kit geometry, the floor's
 *  texture and every material. The kit's own atlas and olive geometry belong to
 *  the loader (`disposeBackdropKit`) and survive a rebuild. */
export function disposeBackdrop(b: Backdrop): void {
  b.group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) {
      // The olive geometry is the kit's; the house geometry is ours.
      if (o.name === 'backdrop-houses') o.geometry.dispose();
      o.dispose();
    } else if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
    }
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial && o.name === 'backdrop-ground') m.map?.dispose();
        m.dispose();
      }
    }
  });
}

/** Releases a loaded kit's atlas and olive geometry. */
export function disposeBackdropKit(kit: LoadedBackdropKit): void {
  kit.map.dispose();
  kit.olive?.dispose();
}
