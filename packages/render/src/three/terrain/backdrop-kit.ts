/**
 * Placing the Wadi Halam backdrop kit: pieces in, one merged world-space mesh
 * out, with every vertex's height baked from the FLOOR at load (GH-161).
 *
 * Pure and three-free, like every builder in this directory: the same spec,
 * kit and floor always give the same arrays, so `backdrop-kit.test.ts` can run
 * it over the real GLB's bytes in a node environment.
 *
 * ## The frame of a piece
 *
 * A kit piece is authored in Blender, in metres, with its origin on the middle
 * of its map-facing (inner) edge, extending along local -X away from the map,
 * and `s` (the along-edge axis) along Blender +Y. The glTF export turns that
 * into Y-up: a GLB-local point is `(gx, gy, gz) = (x, up, -s)`. Everything here
 * is in tiles (the loader applies `MESH_SCALE`), so `gx <= 0` is "out from the
 * edge" and `s = -gz`.
 *
 * A placement `{ at, rot, mirror, ys, lift }` puts that frame on the map:
 *
 *     gz' = mirror ? -gz : gz            (the mirror flips the along-edge axis)
 *     x   = at.x + cos(rot) * gx - sin(rot) * gz'
 *     z   = at.z + sin(rot) * gx + cos(rot) * gz'
 *
 * so rot 0 stands the piece on the WEST side (it extends toward -x, `s` runs
 * north), 90 the NORTH side (extends toward -z, `s` east), 180 east, 270 south.
 * `backdrop-kit.test.ts` pins that convention against the layout tool's.
 *
 * ## Heights: the kit sits on the floor, vertex by vertex
 *
 *     y = floor(x, z) + lift + ys * gy - FOOT_BURY
 *
 * `floor` is the drawn floor mesh itself (`FloorSurface`: the same 1-tile grid
 * and the same triangulation `buildBackdrop` draws), so a piece neither floats
 * above the ground nor lets it poke through, and two neighbouring pieces, which
 * share their seam in plan, share their base there too. That replaces the
 * render-2 mock's per-piece tilt (a base height at each END of a piece), and it
 * is what closes the floor-beyond-the-rim gap the mock left (its floor rose a
 * metre against a wall's foot within 30 m). `lift` is the one authored
 * exception: a crest sits on top of a wall, a scree fan on a wall's surface, a
 * terrace on the corner's hillside. Normals follow: the floor's slope at the
 * vertex is added to the exported normal, to first order.
 */
import { tileHash } from '../../tile-hash';
import { HOUSE_PIECE, KIT_PIECES, UNPLACED_PIECES } from './textured-backdrop';

/** One placement of a kit piece, as a map's `backdrop.pieces` carries it. */
export interface BackdropPiece {
  readonly id: string;
  /** Map tiles: the midpoint of the piece's map-facing edge. */
  readonly at: readonly [number, number];
  readonly rot: 0 | 90 | 180 | 270;
  readonly mirror?: boolean;
  /** Y scale, 0.75-1.35 (default 1). */
  readonly ys?: number;
  /** Tiles above the floor that the piece's local z = 0 stands (default 0). */
  readonly lift?: number;
}

/** The part of a map's `backdrop` block this module reads. */
export interface PlacementSpec {
  readonly pieces: readonly BackdropPiece[];
}

/** One mesh of a kit piece, in TILES, GLB-local (x, up, z). */
export interface KitGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly index: Uint16Array | Uint32Array;
}

/** One kit piece's geometry and anchors, in TILES, GLB-local (x, up, z). */
export interface KitPieceSource extends KitGeometry {
  readonly name: string;
  /** The reduced twin (about 35% of the triangles over the same parameter plane) the renderer swaps in below
   *  `LOD1_BELOW_ZOOM`; absent on the olive. */
  readonly lod1?: KitGeometry;
  readonly anchors: readonly { readonly name: string; readonly p: readonly [number, number, number] }[];
  readonly olives: readonly (readonly [number, number, number])[];
}

export interface KitSource {
  readonly pieces: ReadonlyMap<string, KitPieceSource>;
}

/** A foot starts a hair under the floor, so no gap shows at the rim: 6 cm. */
export const FOOT_BURY = 0.06 / 3;

/** The height of the floor and its slope at a point (the drawn mesh's own). */
export interface FloorSurface {
  /** Writes `[y, dy/dx, dy/dz]` for `(x, z)` into `out`. */
  sample(x: number, z: number, out: Float64Array): void;
}

/**
 * The floor mesh as a surface: heights on the integer lattice `(x0 + i, z0 +
 * j)`, triangulated exactly as `buildBackdrop` indexes it (`a c b`, `b c d`
 * per cell, the diagonal from `b` to `c`), so the surface sampled here IS the
 * one drawn.
 */
export function floorSurface(heights: Float32Array, x0: number, z0: number, nx: number, nz: number): FloorSurface {
  return {
    sample(x: number, z: number, out: Float64Array): void {
      const fx = Math.min(Math.max(x - x0, 0), nx - 1 - 1e-6);
      const fz = Math.min(Math.max(z - z0, 0), nz - 1 - 1e-6);
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const u = fx - i;
      const v = fz - j;
      const ya = heights[j * nx + i];
      const yb = heights[j * nx + i + 1];
      const yc = heights[(j + 1) * nx + i];
      const yd = heights[(j + 1) * nx + i + 1];
      if (u + v <= 1) {
        out[0] = ya + u * (yb - ya) + v * (yc - ya);
        out[1] = yb - ya;
        out[2] = yc - ya;
      } else {
        out[0] = yd + (1 - u) * (yc - yd) + (1 - v) * (yb - yd);
        out[1] = yd - yc;
        out[2] = yd - yb;
      }
    },
  };
}

export interface PlacedOlive {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly scaleY: number;
}

export interface PlacedHouse {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** Width in tiles. */
  readonly size: number;
  /** Body height as a multiple of `size`'s unit house (see `backdrop.ts`). */
  readonly tall: number;
}

/** Placed geometry, merged into one mesh's arrays. */
export interface PlacedMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly triangles: number;
}

export interface PlacedKit extends PlacedMesh {
  readonly olives: readonly PlacedOlive[];
  readonly houses: readonly PlacedHouse[];
  readonly pieces: number;
  /** The same pieces from their LOD1 twins: what is drawn at minimum zoom. The hamlet houses are in both. */
  readonly lod1: PlacedMesh;
}

/** Below this zoom the kit draws its LOD1 twins (kit-spec section 1a: by zoom band, never by distance --
 *  the camera is orthographic). The minimum-zoom cost run is what put it there. */
export const LOD1_BELOW_ZOOM = 0.6;

/**
 * The pieces whose height is brought down onto the floor toward their far end: the near-side ground (the south and
 * east slopes, their corner and the outer corners). They end at 41-46 tiles as a cliff facing the camera; faded to the
 * scene background it showed as a ragged black silhouette against greener floor behind it. Tapered to the floor where the
 * fade completes, the ground simply runs on and dims into the background, with nothing standing up to be an edge.
 * Far-side pieces (walls, crests) are not touched: they are seen from the front, rising, and the approved look keeps them.
 */
export const TAPERED_PIECES: ReadonlySet<string> = new Set(['bd_slope_near_a', 'bd_slope_near_b', 'bd_slope_corner', 'bd_outer_corner']);

/** 1 where a point is at full height, falling to 0 where the ground has finished fading into the background. */
export type Taper = (x: number, z: number) => number;

/** The legal Y-scale range (kit-spec section 2). */
export const YS_MIN = 0.75;
export const YS_MAX = 1.35;

interface Transform {
  readonly cos: number;
  readonly sin: number;
  readonly flip: number;
  readonly ys: number;
  readonly lift: number;
  readonly atX: number;
  readonly atZ: number;
}

/** The height factor of a placement's piece at `(x, z)`: the taper for a near-side piece, else 1. */
function heightFactor(pl: BackdropPiece, taper: Taper | undefined, x: number, z: number): number {
  return taper !== undefined && TAPERED_PIECES.has(pl.id) ? taper(x, z) : 1;
}

function transformOf(pl: BackdropPiece): Transform {
  const r = (pl.rot * Math.PI) / 180;
  const ys = pl.ys ?? 1;
  if (!(ys >= YS_MIN - 1e-9 && ys <= YS_MAX + 1e-9)) throw new Error(`backdrop piece ${pl.id}: ys ${ys} outside ${YS_MIN}-${YS_MAX}`);
  if (pl.rot % 90 !== 0) throw new Error(`backdrop piece ${pl.id}: rot ${pl.rot} is not a quarter turn`);
  return { cos: Math.round(Math.cos(r)), sin: Math.round(Math.sin(r)), flip: pl.mirror === true ? -1 : 1, ys, lift: pl.lift ?? 0, atX: pl.at[0], atZ: pl.at[1] };
}

/** Plan position of a GLB-local point (x, z only; the height needs the floor). */
function planOf(t: Transform, gx: number, gz: number): [number, number] {
  const z2 = gz * t.flip; // the mirror flips the along-edge axis
  return [t.atX + t.cos * gx - t.sin * z2, t.atZ + t.sin * gx + t.cos * z2];
}

const scratch = new Float64Array(3);

/**
 * World position of a GLB-local point of a placement: plan from the
 * placement's transform, height from the floor under it.
 */
export function placePoint(pl: BackdropPiece, floor: FloorSurface, p: readonly [number, number, number], taper?: Taper): [number, number, number] {
  const t = transformOf(pl);
  const [x, z] = planOf(t, p[0], p[2]);
  floor.sample(x, z, scratch);
  return [x, scratch[0] + (t.lift + t.ys * p[1]) * heightFactor(pl, taper, x, z) - FOOT_BURY, z];
}

/**
 * Merge every placement's `pick(source)` geometry into one mesh: plan from the placement's transform, height from
 * the floor under each vertex, the winding kept right-way-up under a mirror.
 */
function mergePieces(spec: PlacementSpec, kit: KitSource, floor: FloorSurface, pick: (src: KitPieceSource) => KitGeometry, taper?: Taper): PlacedMesh {
  let nv = 0;
  let ni = 0;
  for (const pl of spec.pieces) {
    const src = kit.pieces.get(pl.id);
    if (src === undefined || UNPLACED_PIECES.has(pl.id) || !(pl.id in KIT_PIECES)) throw new Error(`backdrop: no kit piece "${pl.id}"`);
    const g = pick(src);
    nv += g.positions.length / 3;
    ni += g.index.length;
  }
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const uvs = new Float32Array(nv * 2);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const pl of spec.pieces) {
    const g = pick(kit.pieces.get(pl.id) as KitPieceSource);
    const t = transformOf(pl);
    const n = g.positions.length / 3;
    for (let k = 0; k < n; k++) {
      const gx = g.positions[k * 3];
      const gy = g.positions[k * 3 + 1];
      const gz = g.positions[k * 3 + 2];
      const [x, z] = planOf(t, gx, gz);
      floor.sample(x, z, scratch);
      positions[(vo + k) * 3] = x;
      positions[(vo + k) * 3 + 1] = scratch[0] + (t.lift + t.ys * gy) * heightFactor(pl, taper, x, z) - FOOT_BURY;
      positions[(vo + k) * 3 + 2] = z;
      // The normal: the height scale (the inverse transpose of a Y scale), the mirror, the turn, then the
      // floor's slope added to the surface's.
      let nx = g.normals[k * 3];
      const ny = g.normals[k * 3 + 1] / t.ys;
      let nz = g.normals[k * 3 + 2] * t.flip;
      const rx = t.cos * nx - t.sin * nz;
      const rz = t.sin * nx + t.cos * nz;
      nx = rx - scratch[1] * ny;
      nz = rz - scratch[2] * ny;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[(vo + k) * 3] = nx / len;
      normals[(vo + k) * 3 + 1] = ny / len;
      normals[(vo + k) * 3 + 2] = nz / len;
      uvs[(vo + k) * 2] = g.uvs[k * 2];
      uvs[(vo + k) * 2 + 1] = g.uvs[k * 2 + 1];
    }
    // A mirror reverses the handedness: swap two corners of every triangle so the front faces still face up.
    const m = g.index.length;
    if (t.flip < 0) {
      for (let k = 0; k < m; k += 3) {
        indices[io + k] = g.index[k] + vo;
        indices[io + k + 1] = g.index[k + 2] + vo;
        indices[io + k + 2] = g.index[k + 1] + vo;
      }
    } else {
      for (let k = 0; k < m; k++) indices[io + k] = g.index[k] + vo;
    }
    vo += n;
    io += m;
  }
  return { positions, normals, uvs, indices, triangles: ni / 3 };
}

/** One mesh after another, indices rebased. */
function concatMeshes(a: PlacedMesh, b: PlacedMesh): PlacedMesh {
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions);
  positions.set(b.positions, a.positions.length);
  const normals = new Float32Array(positions.length);
  normals.set(a.normals);
  normals.set(b.normals, a.normals.length);
  const uvs = new Float32Array(a.uvs.length + b.uvs.length);
  uvs.set(a.uvs);
  uvs.set(b.uvs, a.uvs.length);
  const base = a.positions.length / 3;
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices);
  for (let k = 0; k < b.indices.length; k++) indices[a.indices.length + k] = b.indices[k] + base;
  return { positions, normals, uvs, indices, triangles: a.triangles + b.triangles };
}

/** Every house as the placeholder box, scaled by its size, turned by its yaw, stood at its anchor. */
function plantHouses(src: KitGeometry, houses: readonly PlacedHouse[]): PlacedMesh {
  const nv = src.positions.length / 3;
  const ni = src.index.length;
  const positions = new Float32Array(houses.length * nv * 3);
  const normals = new Float32Array(houses.length * nv * 3);
  const uvs = new Float32Array(houses.length * nv * 2);
  const indices = new Uint32Array(houses.length * ni);
  houses.forEach((hs, h) => {
    const c = Math.cos(hs.yaw);
    const s = Math.sin(hs.yaw);
    for (let k = 0; k < nv; k++) {
      const px = src.positions[k * 3] * hs.size;
      const py = src.positions[k * 3 + 1] * hs.size;
      const pz = src.positions[k * 3 + 2] * hs.size;
      const o = (h * nv + k) * 3;
      // a turn about +Y by `yaw`, the way three's `setFromAxisAngle(up, yaw)` turns an instance
      positions[o] = hs.x + px * c + pz * s;
      positions[o + 1] = hs.y + py;
      positions[o + 2] = hs.z - px * s + pz * c;
      const nx = src.normals[k * 3];
      const nz = src.normals[k * 3 + 2];
      normals[o] = nx * c + nz * s;
      normals[o + 1] = src.normals[k * 3 + 1];
      normals[o + 2] = -nx * s + nz * c;
      uvs[(h * nv + k) * 2] = src.uvs[k * 2];
      uvs[(h * nv + k) * 2 + 1] = src.uvs[k * 2 + 1];
    }
    for (let k = 0; k < ni; k++) indices[h * ni + k] = src.index[k] + h * nv;
  });
  return { positions, normals, uvs, indices, triangles: (houses.length * ni) / 3 };
}

/**
 * Place every piece of `spec` on `floor`, merged into one mesh (and its LOD1 twin).
 *
 * `houseLimit(x, z)` is the highest a house top may stand there (the
 * near-side occlusion cap), or Infinity.
 */
export function assembleKit(
  spec: PlacementSpec,
  kit: KitSource,
  floor: FloorSurface,
  houseLimit: (x: number, z: number) => number = () => Infinity,
  taper?: Taper
): PlacedKit {
  const main = mergePieces(spec, kit, floor, (src) => src, taper);
  // A kit with no LOD1 twins (a test fixture, a future kit) draws its full mesh at every zoom.
  const hasLod1 = spec.pieces.every((pl) => kit.pieces.get(pl.id)?.lod1 !== undefined);
  const lod1 = hasLod1 ? mergePieces(spec, kit, floor, (src) => src.lod1 as KitGeometry, taper) : main;

  const olives: PlacedOlive[] = [];
  const houses: PlacedHouse[] = [];
  for (const pl of spec.pieces) {
    const src = kit.pieces.get(pl.id) as KitPieceSource;
    // Olives stand on the terrace treads; houses on the anchors. Both are hashed on a running count, so the
    // same layout always plants the same trees (and the render-2 mock, which counted the same way, agrees).
    for (const q of src.olives) {
      const [x, y, z] = placePoint(pl, floor, q, taper);
      const k = olives.length;
      const sc = 0.85 + 0.3 * tileHash(k, 17);
      olives.push({ x, y, z, yaw: tileHash(k, 5) * 6.28, scale: sc, scaleY: sc * (0.9 + 0.2 * tileHash(k, 23)) });
    }
    for (const a of src.anchors) {
      if (!a.name.startsWith('anchor_house')) continue;
      const [x, y, z] = placePoint(pl, floor, a.p, taper);
      const k = houses.length;
      const size = 0.85 + 0.5 * tileHash(k, 9);
      const tall = 0.9 * size;
      // The roof peaks about 0.45 of the body above it; keep the whole house under the near-side cap.
      if (y + tall * 1.5 > houseLimit(x, z)) continue;
      houses.push({ x, y, z, yaw: (tileHash(k, 3) - 0.5) * 1.2 - (pl.rot * Math.PI) / 180, size, tall });
    }
  }
  // Thin by a fixed hash order, so the first half of the list is a spatially even half of the trees: the renderer draws
  // only that half at minimum zoom (`Backdrop.setZoom`), where an olive is three pixels across.
  olives.sort((a, b) => tileHash(Math.round(a.x * 64), Math.round(a.z * 64)) - tileHash(Math.round(b.x * 64), Math.round(b.z * 64)));
  // The hamlet houses are part of the kit's mesh (no draw call of their own): planted, scaled and turned, into both.
  const house = kit.pieces.get(HOUSE_PIECE);
  const withHouses = house && houses.length > 0 ? (m: PlacedMesh): PlacedMesh => concatMeshes(m, plantHouses(house, houses)) : (m: PlacedMesh): PlacedMesh => m;
  const mainH = withHouses(main);
  const lod1H = lod1 === main ? mainH : withHouses(lod1);
  return { ...mainH, olives, houses, pieces: spec.pieces.length, lod1: lod1H };
}
