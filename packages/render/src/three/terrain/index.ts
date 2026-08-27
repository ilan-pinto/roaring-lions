/**
 * Barrel for the terrain pipeline's PURE builders only.
 *
 * `app`-level code (the terrain-parity conformance suite, `packages/app/src/
 * terrain-parity.test.ts`) needs `buildGround`/`buildScatter`/`buildGroves`/
 * `buildBuildings` to build real geometry from shipped map data, but
 * `packages/render/src/**\/*.ts` may not import `@lions/data` (see
 * `eslint.config.mjs`), so that suite cannot live inside this package -- and
 * the only pre-existing export paths were `.` (the Pixi renderer) and
 * `./three` (`ThreeRenderer` itself, which constructs a `WebGLRenderer` and
 * cannot run under `environment: 'node'`). This barrel is the missing import
 * surface: every file in this directory except `mesh.ts`, which is the one
 * file here that touches `THREE.*` (`BufferGeometry`, `MeshBasicMaterial`)
 * rather than plain arrays.
 *
 * Excluding `mesh.ts` is deliberate and load-bearing, not tidiness: it is
 * what makes importing this barrel cost nothing beyond the pure builders
 * themselves. `ThreeRenderer` stays out of every barrel for the same
 * reason it was pulled off this one and given `./three` as its own entry
 * point in Phase B1 -- re-exporting it (directly or transitively) puts all
 * of three.js back in the default Pixi player's main chunk, a regression
 * that was live through all of Phase B1 and cost 464 kB. Nothing in this
 * directory pulls `ThreeRenderer` in, so that risk does not apply here, but
 * the same discipline applies to this barrel too: it names no `ThreeRenderer`
 * import, directly or by re-export, now or later.
 *
 * `types.ts`'s `MeshData`/`TerrainInput` are re-exported redundantly by
 * `ground.ts` and `scatter.ts` as well (each states `export type { MeshData,
 * TerrainInput }` for its own module's readability) -- all three trace back
 * to the same declaration in `types.ts`, so re-exporting all of them here is
 * not an ambiguous export: ECMAScript module semantics only reject a `export
 * *` collision when two DIFFERENT bindings share a name, and these are the
 * same binding by construction.
 *
 * The "except `mesh.ts`" claim above was FALSE for a while and nothing
 * caught it: `ground.ts`, `buildings.ts` and `grove.ts` all reached
 * `WORLD_Y_PER_LIFT_PIXEL` via `import ... from '../camera'`, and importing
 * any binding from a module runs that module's own top-level imports too --
 * `camera.ts` does `import * as THREE from 'three'` unconditionally, so this
 * barrel was silently dragging all of three.js in, just like `ThreeRenderer`
 * is documented above as never being allowed to. `WORLD_Y_PER_LIFT_PIXEL`
 * (and the `ELEVATION` angle it is solved from) now live in `project.ts`,
 * which imports nothing, three.js included; those three files import it from
 * there directly, and `camera.ts` only re-exports it for its own,
 * already-three.js-dependent, importers. Verified by walking this barrel's
 * full transitive module graph and confirming no file in it imports `'three'`
 * -- checking `mesh.ts`'s exclusion alone is exactly the check that missed
 * the regression above.
 */
export * from './types';
export * from './tones';
export * from './ground';
export * from './scatter';
export * from './grove';
export * from './buildings';
export * from './clamp';
