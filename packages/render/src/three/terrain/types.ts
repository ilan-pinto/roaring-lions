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
  /**
   * One float per vertex, same length and vertex order as `colors` -- how
   * far this vertex sits above its own object's ground anchor, in world-Y
   * units (0 at a trunk base or a flat ground mark, larger toward a
   * crown's own topmost highlight). Wind-sway weight, read only by
   * `mesh.ts`'s `groveMaterial` fragment/vertex pair -- `terrainMaterial`
   * (the shared material every other terrain sub-mesh draws through) never
   * declares a `sway` attribute, so leaving this absent is a correct no-op
   * for ground/scatter/residual/building-decor meshes, the same "OPTIONAL,
   * only one builder populates it" shape `litColors` above already
   * establishes. OPTIONAL: only `grove.ts`'s `buildGroves` computes this
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
}
