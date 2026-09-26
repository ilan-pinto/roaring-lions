/**
 * Shared types every terrain builder uses.
 *
 * Pulled out of `ground.ts` (which Task B2.3 creates) because `tones.ts`
 * (Task B2.2) needs `TerrainInput` and runs first -- a task cannot import a
 * type from a file that does not exist yet. `ground.ts` imports both of
 * these rather than redeclaring them.
 */
import type { GroveFamily } from '../../api';

/** Plain-array geometry. No three.js types, so builders stay headless. */
export interface MeshData {
  /** xyz triples, three.js world space: game tile (x, y) -> (x, height, y). */
  positions: Float32Array;
  /** rgb triples in 0..1, one per vertex. Always a palette entry. */
  colors: Float32Array;
  indices: Uint32Array;
  /**
   * xyz triples, one per vertex, same length and vertex order as `colors` --
   * the world-space surface normal the scene sun shades this surface by.
   *
   * OPTIONAL, and only `ground.ts`'s `buildGround` computes one today: its
   * analytic heightfield normals are smoother than any face average of the
   * same triangles. Every OTHER layer still ends up with a normal, because
   * every layer is lit now -- `toGeometry` fills one in, either straight up
   * (flat marks, canopy billboards) or computed from the faces (the extruded
   * structure boxes, whose walls must shade as walls). See `GeometryOptions`
   * in `mesh.ts` for which builder takes which.
   */
  normals?: Float32Array;
  /**
   * xy pairs, one per vertex: the WORLD-space coordinates the ground albedo
   * is sampled at, before the per-texture repeat scale.
   *
   * Needed because `vWorldPos.xz` is only the right projection for a
   * HORIZONTAL surface. A rock wall is vertical: an east face has a constant
   * world X, so an XZ projection would smear one column of the texture down
   * its whole height. So the builder emits the projection it knows is right
   * for each piece of geometry -- `(x, z)` for a tile top or an interpolated
   * patch, `(z, y)` for an east wall, `(x, y)` for a south wall -- rather
   * than the shader guessing from a normal that walls deliberately do not
   * carry (they carry the up normal, so the shade term stays exactly 1.0 on
   * them).
   *
   * OPTIONAL, `ground.ts` only.
   */
  groundUv?: Float32Array;
  /**
   * One float per vertex, same length and vertex order as `colors` --
   * `ground.ts`'s `WALL_ALBEDO_TOP` (-1) on every top, `WALL_ALBEDO_ROCK` (1)
   * on a ridge's cliff face, `WALL_ALBEDO_NONE` (0) on a building's wall.
   *
   * The one per-vertex surface fact left once `GroundMaterial` reads the
   * control map (R-5): a top samples the map, and a wall -- which sits exactly
   * on a texel boundary and cannot -- takes this instead. OPTIONAL,
   * `buildGround` only; absent, the attribute reads 0 in the shader, which is
   * the untextured building-wall case, so a geometry without it draws its
   * flat palette tone rather than anything invented.
   */
  wallAlbedo?: Float32Array;
  /**
   * One float per vertex, same length and vertex order as `colors` -- how
   * far this vertex sits above its own object's ground anchor, in world-Y
   * units (0 at a trunk base or a flat ground mark, larger toward a
   * crown's own topmost highlight). Wind-sway weight, read only by
   * `mesh.ts`'s `GroveMaterial` -- `vertexColorMaterial` (the shared material
   * every other terrain sub-mesh draws through) and `GroundMaterial` never
   * declare a `sway` attribute, so leaving this absent is a correct no-op
   * for ground/scatter/residual/building-decor meshes, the same "OPTIONAL,
   * only one builder populates it" shape `normals` and `wallAlbedo`
   * above already establish. OPTIONAL: only `grove.ts`'s `buildGroves` computes this
   * today, on tree trunk/crown vertices only -- a grove tile's own flat
   * ground shadow mark leaves it at the implicit zero-fill, so wind never
   * moves a shadow off the ground it is cast on.
   */
  sway?: Float32Array;
}

/** Everything a terrain builder is allowed to read. */
export interface TerrainInput {
  width: number;
  height: number;
  /** Per tile, TERRAIN_DECOR values. */
  decor: Uint8Array | null;
  /** Per tile, 0-9. Absent means flat. */
  elevation: Uint8Array | null;
  blocked: Uint8Array;
  cover: Uint8Array;
  /**
   * Per tile, 1 = a boulder tile (`Sim.boulder`): open on foot, a wall to
   * wheels and tracks. Optional, like `decor`/`elevation` -- most maps have
   * none, and only `decorPlacements` (the `boulder` family) reads it; every
   * other builder in this directory is indifferent to it, the same reason a
   * ridge's `^` blocks without needing its own layer here. Absent or all-zero
   * both mean "no boulders", so an existing fixture that omits this field
   * keeps testing exactly what it tested before this field existed.
   */
  boulder?: Uint8Array | null;
  /**
   * Which family a grove tile draws -- `TerrainTones.groveFamily`, passed
   * through by `composeTerrain`.
   *
   * Optional, and ABSENT MEANS `'desert_tree'`, which mirrors
   * `map.schema.json`'s own `"default": "arid"` for `terrain`: a fixture that
   * declares no theme is an arid map, and an arid map's grove is a desert
   * tree. That makes every pre-existing fixture correct rather than stale,
   * and it is the one default under which forgetting to thread this field
   * cannot put a Mediterranean olive back on a dune.
   */
  groveFamily?: GroveFamily;
}
