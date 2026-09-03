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
   * xyz triples, one per vertex, same length and vertex order as `colors` --
   * the world-space surface normal `mesh.ts`'s `groundSurfaceMaterial` reads
   * for its shade term.
   *
   * OPTIONAL, and only `ground.ts`'s `buildGround` computes one today, the
   * same shape `litColors` above already establishes. Scatter marks, grove
   * billboards, building boxes and the residual layer all draw through the
   * plain `terrainMaterial`, which declares no `normal` attribute and reads
   * none -- leaving this absent for them is a correct no-op, not a missing
   * attribute. `toGeometry` therefore uploads it only when present rather
   * than aliasing a default the way it does for `litColor`: there is no
   * sensible default normal for a flat mark, and no shader asking for one.
   */
  normals?: Float32Array;
  /**
   * One float per vertex, same length and vertex order as `colors` -- 1 where
   * this vertex is allowed to sample the ground albedo tile
   * (`mesh.ts`'s `groundSurfaceMaterial`, `uSand`), 0 where it is not.
   *
   * Not a redundant restatement of "is this an interpolated patch": a ROAD
   * tile is drawn as an interpolated patch and is deliberately masked OFF, so
   * the authored road tone keeps reading as a road rather than as sand with a
   * rut on it. Terrace tops and walls are masked off too.
   *
   * OPTIONAL, `ground.ts` only, exactly like `normals` above. Where it is 0
   * -- and where the whole attribute is absent -- the material's texture term
   * is exactly 1.0 and the fragment is the palette byte it always was.
   */
  sandMask?: Float32Array;
  /**
   * One float per vertex -- 1 where this vertex samples the ROCK albedo
   * (`mesh.ts`, `uRock`), 0 where it does not.
   *
   * Separate from `sandMask` rather than one enum, because they are two
   * different decisions about two different surfaces and each is asserted on
   * its own: sand is "interpolated open ground that is not a road", rock is
   * "a `^` ridge -- its flat top and the cliff faces below it". A building's
   * footprint and its walls are in NEITHER: a structure pad is not bedrock,
   * and `groundTone`'s `underBuilding` wash is what belongs there.
   *
   * OPTIONAL, `ground.ts` only. Both masks 0 -- and the attributes absent
   * entirely -- means the albedo term is exactly 1.0 and the fragment is the
   * palette byte it always was.
   */
  rockMask?: Float32Array;
  /**
   * One float per vertex -- 1 where this vertex samples the ROAD albedo
   * (`mesh.ts`, `uRoad`), 0 where it does not. Exactly the `r` tiles.
   *
   * Until 2026-09-03 a road was masked OUT of every albedo so its authored
   * tone would keep reading as navigation. It now has an albedo of its own --
   * a wheel track, applied as a ratio to its own mean like every other, so
   * the tile still AVERAGES to the `tones.road` composite it always did and
   * only the rut arrives from the image.
   *
   * OPTIONAL, `ground.ts` only, like every mask above.
   */
  roadMask?: Float32Array;
  /**
   * One float per vertex, and the only entry here that is not a mask: which
   * axis this road tile's ruts run along. 0 north-south (the image's own
   * orientation), 1 east-west (its coordinates swapped), 0.5 the average of
   * the two.
   *
   * Separate from `roadMask` rather than packed into it because a mask of 0
   * and an axis of 0 are different facts: packed, "no road here" would be
   * indistinguishable from "a road running north-south", and every non-road
   * vertex on the map would claim an orientation. `ground.ts`'s `roadAxisAt`
   * is the rule that fills it.
   *
   * Meaningless where `roadMask` is 0, and left at 0 there.
   *
   * OPTIONAL, `ground.ts` only.
   */
  roadAxis?: Float32Array;
  /**
   * One float per vertex -- how strongly this vertex samples the SCRUB
   * albedo (`mesh.ts`, `uScrub`). Unlike every mask above it is not 0-or-1:
   * it carries the cover TIER, as the mix weight toward the image's full
   * variation (`ground.ts`'s `SCRUB_TIER_STRENGTH`), so a light cover tile
   * is faintly rough ground and a garrison-grade one is a thicket.
   *
   * Set on the `1`/`2`/`3` symbols only -- a cover tile whose `decor` is
   * `none`. An `o` grove is cover 1 and takes the orchard floor instead; an
   * `n` knoll is cover 2 and is deliberately left as it was, since neither
   * the brief nor the art named it and quietly restyling a symbol is how a
   * map stops looking like the one its author drew.
   *
   * OPTIONAL, `ground.ts` only.
   */
  scrubMask?: Float32Array;
  /**
   * One float per vertex -- 1 on an `o` olive grove's floor, where the
   * orchard albedo is sampled (`mesh.ts`, `uGrove`), 0 elsewhere.
   *
   * The trees themselves are `grove.ts`'s own mesh and are untouched by
   * this: they draw through the unlit `terrainMaterial` and are still
   * palette-only, including the flat trunk shadows they cast on this ground.
   *
   * OPTIONAL, `ground.ts` only.
   */
  groveMask?: Float32Array;
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
