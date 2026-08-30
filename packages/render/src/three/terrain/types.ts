/**
 * Shared types every terrain builder uses.
 *
 * Pulled out of `ground.ts` (which Task B2.3 creates) because `tones.ts`
 * (Task B2.2) needs `TerrainInput` and runs first -- a task cannot import a
 * type from a file that does not exist yet. `ground.ts` imports both of
 * these rather than redeclaring them.
 */

/** Plain-array geometry. No three.js types, so builders stay headless. */
export interface MeshData {
  /** xyz triples, three.js world space: game tile (x, y) -> (x, height, y). */
  positions: Float32Array;
  /** rgb triples in 0..1, one per vertex. Always a palette entry. */
  colors: Float32Array;
  indices: Uint32Array;
  /**
   * rgb triples in 0..1, one per vertex, same length and vertex order as
   * `colors` -- each vertex's own tone shifted toward its ramp's lightest
   * step (`tones.ts`'s `rampNeighbor`), for the muzzle-flash effect
   * (`../palette-material.ts`'s "The muzzle-flash 'light'" doc comment).
   * OPTIONAL: only `ground.ts`'s `buildGround` computes this today (see its
   * own doc comment for why scatter/grove/residual/building-decor meshes
   * do not); `toGeometry` (`mesh.ts`) aliases the `litColor` GPU attribute
   * to `colors` itself when this is absent, which is a correct no-op (a
   * flash never has anywhere lighter to shift that geometry toward), not a
   * missing-attribute error.
   */
  litColors?: Float32Array;
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
}
