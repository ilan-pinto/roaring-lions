/**
 * Task B3.7: structures as billboards.
 *
 * `terrain/buildings.ts` draws a procedural box for EVERY blocked, non-ridge
 * tile, deliberately, because Phase B2 shipped "no structure sprites" -- see
 * that module's own top comment. This module is what an arted structure
 * draws INSTEAD of that box: one billboard sprite per living structure of a
 * type with a loaded sheet, plus a second billboard for a DEAD one with
 * wreck art, following the same split `terrain/` and `units/instances.ts`
 * already draw between pure decision functions (testable in
 * `environment: 'node'`) and GPU-facing construction (not).
 *
 * ## The ground tone needs no separate handling here
 *
 * The orchestrator brief for this task restates Pixi's own hazard verbatim:
 * `renderer.ts:1489-1491` has to paint the ground under a sprited structure
 * ITSELF, in the sprite branch, because Pixi's `drawTerrain` never paints a
 * blocked tile's ground diamond at all outside that branch or
 * `drawBuildingTile`'s own box -- skip that paint call and the mosque sits
 * over bare page background.
 *
 * `terrain/ground.ts` does not have that hazard. `buildGround`'s tile loop
 * paints EVERY tile's top quad unconditionally, sprited-structure or not,
 * ridge or open ground, through `groundTone` -- which already returns the
 * `underBuilding`-washed tone for any blocked, non-ridge tile regardless of
 * what (if anything) `terrain/buildings.ts` draws on top of it
 * (`tones.ts:126-153`, and `terrain/buildings.ts`'s own top comment: "on the
 * understanding that a box is coming to sit on top of it"). So the ground
 * tone under an arted structure was already correct, unconditionally,
 * before this task existed -- it does not move with the sprite because it
 * never depended on the box in the first place. What THIS module has to get
 * right is the opposite direction: making sure `terrain/buildings.ts` skips
 * its OWN box for an arted structure's tiles, without also skipping (or
 * asking `buildGround` to skip) the ground tone underneath -- see
 * `composeTerrain` and `withoutLiveStructures` in `ThreeRenderer.ts` (Task
 * B3.9's own split of what used to be this module's own `maskArtedStructures`
 * helper): buildings alone are fed a per-structure-masked view, never
 * `buildGround`/`buildScatter`/`buildGroves`.
 *
 * ## Anchor convention: centred, like Pixi -- like units, now too
 *
 * `units/instances.ts` anchored a unit billboard at the feet (local up = 0)
 * for most of this migration, on the belief that Pixi's own unit anchor
 * point (`spawnAmbient`'s "ground contact point") already meant the same
 * thing on both backends. It did not: Pixi's unit-sprite path
 * (`renderer.ts:1283`, `:1256`) makes the IDENTICAL `anchor: 0.5` call this
 * file's own structure sprites use, so there was never a real difference for
 * the two modules to diverge over. That module's own top comment ("Anchored
 * at the centre, matching Pixi") now carries the correction and the
 * golden-image-diff measurement that forced it -- a unit billboard is
 * centred exactly like a structure one. This section's own reasoning below,
 * for WHY a structure billboard is centred, is unchanged by that fix -- it
 * was always right, and is restated here for structures specifically. Pixi's
 * `drawStructureSprite`/`drawWreckedStructures` both
 * construct `new Sprite({ texture, anchor: 0.5 })` and position it at
 * `isoY(fx0, fy0) - groundOffset(fx0, fy0)` -- the SCREEN point of the
 * footprint's own ground centre, with the sprite's GEOMETRIC MIDDLE (both
 * axes) pinned there, not its base. `tools/render_building.py` confirms this
 * is deliberate, not an accident of Pixi's API: "The camera aims at the
 * footprint's ground centre... the renderer anchors the sprite here", so the
 * render rig frames every building canvas with equal padding above and
 * below that point on purpose. `roofTopPx`/`badgeTopPx` are measured from
 * that SAME point (`sheet.ts`'s own doc comment, "px from the anchor up to
 * the roof plane"), and `frame-state.ts` already adds `roofPx *
 * WORLD_Y_PER_LIFT_PIXEL` on top of a garrisoned occupant's OWN ground
 * height for the footprint tile -- so "the anchor" a roofPx offset is
 * measured from has to be that same ground-level point, not the sprite's
 * feet. `structureBillboardGeometry` below reproduces that directly: local
 * up runs from `-halfDrawHeightPx` to `+halfDrawHeightPx`, not `0` to
 * `drawHeightPx`.
 *
 * ## The 512px frame size: read off the decoded bitmap, not hardcoded
 *
 * `units/atlas.ts` freezes `FRAME_PX = 256` because every UNIT sheet is
 * square at that size and packs many frames (up to 272) into one
 * `DataArrayTexture` layer stack, where every layer must agree on one pixel
 * size before decoding starts. A structure sheet is a completely different
 * shape: one frame (`idle`), plus at most one more (`wreck`) -- never packed
 * into layers, never facinged, never clipped beyond those two. There is
 * nothing here that needs to know a frame's pixel size BEFORE decoding it,
 * so this module never hardcodes one (256, 512, or otherwise): `loadStructureFrame`
 * decodes the PNG first and reads `bitmap.width`/`bitmap.height` back,
 * exactly the way Pixi's own `Texture.width` already does implicitly via
 * `Assets.load`. `parseStructureManifest`'s `spec.scale` (screen px per tile,
 * matching a unit sheet's own `scale`) is the only sizing input this module
 * takes from the manifest; the manifest's `"size": 512` field is read by
 * nothing on either backend (Pixi does not read it either -- `sheet.ts`'s
 * `StructureSpec` has no `size` field). That sidesteps the orchestrator
 * note's "generalise the packing" option entirely: there is no packing
 * problem to generalise when a sheet never has more than two frames and
 * each is decoded, sized and uploaded independently.
 */
import * as THREE from 'three';
import type { Sim } from '@lions/sim';
import { TILE_W, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { screenOffsetToWorld } from '../terrain/shared';
import { groundWorldY, type ElevationSource } from '../ground-height';
import { GROUND_CLIP_DEPTH_CLAMP_GLSL } from './ground-clip';

// ---------------------------------------------------------------------------
// Pure: geometry, per-entity arithmetic and Sim -> plain-array snapshots. No
// THREE.* GPU objects below this line yet, and no I/O -- everything here is
// callable under `environment: 'node'`, exactly like `terrain/*` and
// `units/instances.ts`'s own pure half. `Sim` itself IS imported (unlike
// `frame-state.ts`, which stays Sim-blind by design): the precedent is
// `ThreeRenderer.structureFootprintsFor`, which already takes a real `Sim`
// and returns a plain-array snapshot, for the identical reason -- a
// structure's footprint/hp/alive state has no `EntityFrameInput`-shaped
// per-frame input to be handed instead, so *something* has to cross that
// boundary, and keeping it here (rather than duplicating it a second time
// inside `ThreeRenderer.ts`) is what makes it directly unit-testable.
// ---------------------------------------------------------------------------

/** One billboard instance's placement -- what `StructureInstancer.update`
 *  (the GPU half, below) needs per living or dead structure of one type. */
export interface StructurePlacement {
  /** Footprint centre, tile units (fractional) -- world X/Z this instance
   *  translates to. `(minX + maxX + 1) / 2`, Pixi's own `drawStructureSprite`
   *  formula (`renderer.ts:1817-1818`) verbatim: +1 because `maxX`/`maxY` are
   *  inclusive tile indices, not a half-open bound. */
  fx: number;
  fy: number;
  /** World Y (height) of the ground at the footprint centre, elevation-
   *  adjusted -- `groundWorldY`, the same query a unit standing there reads. */
  worldY: number;
  /** `0.55 + 0.45 * integrity` for a LIVE structure -- Pixi's own
   *  `drawStructureSprite` alpha (`renderer.ts:1824-1825`), so a battered
   *  building's sprite darkens exactly as its procedural box would have.
   *  Always exactly `1` for a DEAD one: `drawWreckedStructures` sets no
   *  alpha override at all (`renderer.ts:1774`, default opacity). */
  alpha: number;
}

/** Exported (Task B4.4) so `ThreeRenderer.beginCollapse` can find a dying
 *  structure's own footprint centre without re-deriving Pixi's `(min + max +
 *  1) / 2` formula a second time -- the exact same call `structurePlacements`
 *  below already makes for every LIVE/DEAD billboard. */
export function footprintCentre(sim: Sim, sIdx: number): { fx: number; fy: number } {
  const st = sim.structures;
  return {
    fx: (st.minX[sIdx] + st.maxX[sIdx] + 1) / 2,
    fy: (st.minY[sIdx] + st.maxY[sIdx] + 1) / 2,
  };
}

/**
 * Task B4.4: `0.55 + 0.45 * integrity` for a single LIVE structure -- the
 * same formula `structurePlacements` computes per placement below, pulled
 * out standalone so `ThreeRenderer` can cache "what alpha this structure's
 * billboard was actually drawn at" every frame (`cacheStructureAlpha`),
 * independent of building a whole type's placement list. `beginCollapse`
 * reads that cache the instant a structure dies rather than recomputing this
 * formula fresh from `hp`/`maxHp` at that moment, because
 * `Sim.destroyStructure` zeroes `hp` unconditionally before the
 * `structureDestroyed` event ever reaches the renderer
 * (`packages/sim/src/sim.ts:4092-4095`) -- a fresh read at death would
 * answer "fully battered" (`0.55`) for EVERY combat kill, no matter how
 * gradual or sudden.
 *
 * That is not a hypothetical Pixi avoids: it is what Pixi's own
 * `structureWear` ALSO shows for an ordinary combat kill. `damageStructure`
 * pushes the killing blow's `structureHit` event before calling
 * `destroyStructure` (`sim.ts:4073-4084`), but `destroyStructure` runs
 * synchronously within that same tick, before `pendingEvents` is ever
 * drained -- so by the time `bumpStructureWear` (`renderer.ts:1792-1806`)
 * reads LIVE `st.hp` for that very event, `hp` is already the zeroed value
 * `destroyStructure` just wrote. `structureHpBand(0, max)` is `0`, so
 * Pixi's own `alpha0` is `0.55` for every combat kill too -- gradual siege
 * or one-shot from full health alike. Pixi's band only diverges from that
 * floor for a kill with NO preceding `damageStructure` call at all (a
 * non-blade demolition finishing its tick countdown, or the
 * `debugDestroyStructure` dev hook): `structureWear` never left its `0xff`
 * sentinel, so `beginCollapse` there reads the clamped max band and shows
 * full brightness instead.
 *
 * This cache is a deliberate departure from that, not merely this backend's
 * own route to the identical result. It captures the alpha ACTUALLY ON
 * SCREEN one frame before death -- true pre-kill integrity, continuously --
 * rather than state read at or after it, which is always zeroed regardless
 * of path. A building ground down over a long fight starts its fall near
 * `0.55` either way; one dropped by a single overwhelming hit from near-full
 * health starts near `1` here, where Pixi's event-ordering quirk floors it
 * to `0.55` regardless. Reading what the player was already looking at, the
 * instant before it changed, is judged the better behaviour -- but it is a
 * genuine divergence from Pixi's shipped result, not merely a different
 * implementation of the same one.
 */
export function structureAliveAlpha(hp: number, maxHp: number): number {
  const integrity = maxHp > 0 ? Math.max(0, hp / maxHp) : 1;
  return 0.55 + 0.45 * integrity;
}

function structurePlacements(
  sim: Sim,
  structureId: string,
  elevation: ElevationSource,
  wantAlive: boolean
): StructurePlacement[] {
  const st = sim.structures;
  const out: StructurePlacement[] = [];
  for (let s = 0; s < sim.structureCount; s++) {
    if ((st.alive[s] === 1) !== wantAlive) continue;
    const type = sim.structureTypes[st.typeIdx[s]];
    if (type.id !== structureId) continue;
    const { fx, fy } = footprintCentre(sim, s);
    const worldY = groundWorldY(elevation, sim.width, sim.height, fx, fy);
    const alpha = wantAlive ? structureAliveAlpha(st.hp[s], st.maxHp[s]) : 1;
    out.push({ fx, fy, worldY, alpha });
  }
  return out;
}

/** Every LIVING structure of `structureId`, as a billboard placement --
 *  what the idle `StructureInstancer` draws this frame. Reads `Sim` fresh
 *  every call rather than caching anything, exactly like `entityFrame`
 *  reads live entity state: `ThreeRenderer.updateStructures` calls this once
 *  a frame per arted structure type, see its own doc comment for why that
 *  (not `terrainDirty`) is what keeps a battered building's alpha current. */
export function liveStructurePlacements(
  sim: Sim,
  structureId: string,
  elevation: ElevationSource
): StructurePlacement[] {
  return structurePlacements(sim, structureId, elevation, true);
}

/** Every DEAD structure of `structureId` -- what the wreck `StructureInstancer`
 *  draws this frame, for a type whose sheet declared a `wreckFile`. Empty for
 *  a type with none: `ThreeRenderer.loadStructureSprite` never constructs a
 *  wreck instancer for one, so nothing calls this for that structureId at all. */
export function deadStructurePlacements(
  sim: Sim,
  structureId: string,
  elevation: ElevationSource
): StructurePlacement[] {
  return structurePlacements(sim, structureId, elevation, false);
}

/**
 * `roofTopPx ?? badgeTopPx ?? heightPxFallback` -- Pixi's own fallback chain
 * for where a garrisoned occupant stands (`renderer.ts:1948-1950`), pulled
 * out as its own pure function so it is unit-tested directly rather than
 * only indirectly through `ThreeRenderer.updateUnits`'s inline arithmetic
 * (which cannot be exercised under `environment: 'node'` at all -- it lives
 * on a class that needs a real `WebGLRenderer` to construct). `art` is
 * `undefined` for a structure type with no loaded sheet -- the "ThreeRenderer
 * has no structure sprite atlas yet" case B3.3's review measured (house
 * +2.81, apartment +3.92, mosque +1.79, warehouse +0.94, wall +0.43 world
 * units of unwanted lift) -- and `heightPxFallback` (the type's own,
 * squatter `heightPx`) is exactly what closes each of those gaps once `art`
 * is populated: see `structures.test.ts` for the same five buildings,
 * re-measured.
 */
export function resolveRoofPx(
  art: { roofTopPx: number | null; badgeTopPx: number | null } | undefined,
  heightPxFallback: number
): number {
  return art?.roofTopPx ?? art?.badgeTopPx ?? heightPxFallback;
}

/** Plain-array quad geometry for one structure sheet's billboard -- the same
 *  shape `units/instances.ts`'s own `BillboardGeometry` is, kept as a local
 *  type rather than imported so this module does not couple to unit-specific
 *  naming; the two are structurally interchangeable. */
export interface StructureBillboardGeometry {
  /** xyz triples, three.js world space, local to an instance's own
   *  translation (the footprint's ground-centre anchor -- see this file's
   *  top comment). Four vertices: bottom-left, bottom-right, top-right,
   *  top-left. */
  positions: Float32Array;
  /** uv pairs, one per vertex, same order as `positions`. */
  uvs: Float32Array;
  indices: Uint32Array;
  /** Drawn width/height, screen px -- exposed for tests and for nothing else
   *  (the GPU half never reads these back off a constructed geometry). */
  drawWidthPx: number;
  drawHeightPx: number;
}

/**
 * The static, per-structure-sheet camera-facing quad every instance of that
 * sheet shares -- built once when a sheet's texture loads
 * (`ThreeRenderer.loadStructureSprite`), never per frame.
 *
 * Drawn WIDTH matches Pixi's own uniform-scale formula exactly:
 * `spriteScale = (spec.scale * TILE_W) / textureWidthPx`, applied to BOTH
 * axes (`renderer.ts:1821`, `sprite.scale.set(value)` with one argument sets
 * x and y alike) -- so drawn height is `textureHeightPx * spriteScale`, NOT
 * assumed square the way a unit frame is. `textureWidthPx`/`textureHeightPx`
 * are the DECODED bitmap's own dimensions (see this file's top comment on
 * why nothing here hardcodes 256 or 512).
 *
 * Anchored at the footprint's ground CENTRE (local up = 0 at both `-half`
 * and `+half` from it), not the feet -- see this file's top comment,
 * "Anchor convention", for why that is the correct port of Pixi's own
 * `anchor: 0.5`, matching `unitBillboardGeometry`'s own `-half..+half`
 * convention exactly (the two used to diverge here; see that module's own
 * top comment for why they no longer do).
 */
/**
 * The drawn width/height in screen px, shared by `structureBillboardGeometry`
 * and `collapseBillboardGeometry` below -- the two differ only in WHERE the
 * quad's local origin sits (centre vs. base), never in how big it is, so
 * this is the one place that formula is written rather than two copies that
 * could silently drift apart.
 */
export function billboardDrawSize(
  scale: number,
  textureWidthPx: number,
  textureHeightPx: number
): { drawWidthPx: number; drawHeightPx: number } {
  const drawWidthPx = scale * TILE_W;
  const spriteScale = textureWidthPx > 0 ? drawWidthPx / textureWidthPx : 0;
  const drawHeightPx = textureHeightPx * spriteScale;
  return { drawWidthPx, drawHeightPx };
}

export function structureBillboardGeometry(
  scale: number,
  textureWidthPx: number,
  textureHeightPx: number
): StructureBillboardGeometry {
  const { drawWidthPx, drawHeightPx } = billboardDrawSize(scale, textureWidthPx, textureHeightPx);
  const halfW = drawWidthPx / 2;
  const halfH = drawHeightPx / 2;
  const right = screenOffsetToWorld(1, 0);

  const corner = (rightPx: number, upPx: number): [number, number, number] => [
    right.dx * rightPx,
    upPx * WORLD_Y_PER_LIFT_PIXEL,
    right.dy * rightPx,
  ];

  const bl = corner(-halfW, -halfH);
  const br = corner(halfW, -halfH);
  const tr = corner(halfW, halfH);
  const tl = corner(-halfW, halfH);

  return {
    positions: Float32Array.from([...bl, ...br, ...tr, ...tl]),
    // INVERTED uvs -- the exact same mapping `unitBillboardGeometry` uses,
    // and for the exact same reason: `loadStructureFrame` (this file's GPU
    // half) sets `texture.flipY = false` explicitly, so v=0 samples the TOP
    // of the source PNG and v=1 the bottom (`atlas.ts`'s own convention,
    // `DataArrayTexture`'s constructor forcing the identical `flipY = false`
    // default). The quad's top edge (up = +halfH) therefore takes v=0 and
    // its bottom edge (up = -halfH) takes v=1.
    //
    // An earlier draft of this function left `texture.flipY` at three.js's
    // own default (`true`, since a plain `THREE.Texture` -- unlike
    // `DataArrayTexture` -- does not override it) and used the
    // theoretically-matching NON-inverted mapping instead. On paper that is
    // consistent (WebGL's `UNPACK_FLIP_Y_WEBGL` should make v=1 the top
    // under that default): in the browser it rendered every structure
    // upside down -- the mosque's dome at the BOTTOM of its billboard, its
    // wall at the top, discovered by isolating the mesh (every other object
    // in the scene set `.visible = false`) and inspecting the isolated
    // render directly, not by reading the shader. `ImageBitmap` sources are
    // a known, browser-dependent exception to the textbook `flipY` story
    // (`createImageBitmap`'s own orientation handling can interact with
    // `UNPACK_FLIP_Y_WEBGL` in ways the WebGL spec does not pin down
    // precisely) -- forcing `flipY = false` explicitly sidesteps that
    // uncertainty entirely, matching `DataArrayTexture`'s own already-proven
    // convention instead of trusting a default that measured wrong.
    uvs: Float32Array.from([0, 1, 1, 1, 1, 0, 0, 0]),
    // Same winding as `unitBillboardGeometry`: (bl, br, tr, tl) is the
    // front-facing order for a vertical quad under this camera, verified
    // directly by this file's own winding test.
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    drawWidthPx,
    drawHeightPx,
  };
}

/**
 * Task B4.4: the same quad as `structureBillboardGeometry`, base-anchored
 * instead of centred -- what `ThreeRenderer.beginCollapse` needs so
 * shrinking `mesh.scale.y` around the mesh's own local origin brings the
 * roof down while the footprint itself stays exactly where it is. Local up
 * runs `0` to `drawHeightPx`, NOT `-halfDrawHeightPx` to `+halfDrawHeightPx`
 * the way the steady-state structure billboard above (and, since its own
 * fix, `units/instances.ts`'s `unitBillboardGeometry`) is. This is a
 * scale-pivot requirement specific to an animated collapse, not a
 * depth-correctness argument shared with units -- `unitBillboardGeometry`
 * used to be base-anchored for a depth-correctness reason of its own, but
 * that reasoning turned out not to describe the shipped art (see that
 * function's own top comment) and no longer applies; nothing here still
 * leans on it. This geometry's own reason to stay base-anchored is
 * independent and unaffected: `mesh.scale.y` has to shrink around a fixed
 * point, and that point has to be the roofline's own base, not the quad's
 * middle.
 *
 * This is a SEPARATE geometry, not a runtime toggle on the shared one every
 * live/dead instance already draws through -- exactly the choice Pixi's own
 * `beginCollapse` makes: it builds a FRESH `Sprite` re-anchored at `{x:0.5,
 * y:1}` (`renderer.ts:281`, "anchored at its *base* rather than its
 * centre") rather than repositioning `drawStructureSprite`'s centred one,
 * because collapsing is a one-off animation with its own lifetime, never
 * the steady-state billboard's own concern.
 *
 * Translating this quad's local origin to `worldY - (drawHeightPx / 2) *
 * WORLD_Y_PER_LIFT_PIXEL` (see `ThreeRenderer.beginCollapse`) lands its base
 * at the EXACT world point the centred idle sprite's own bottom edge (`bl`/
 * `br` above, at local up `-halfH`) already sat at -- the fall begins with
 * no visible pop, "covering the same ground the centred sprite did."
 *
 * KNOWN, NOT FIXED: that same translation means this quad's vertices span
 * the identical `-halfH..+halfH` world-Y band relative to the footprint's
 * ground height that `createStructureMaterial`'s own ground-clip fix
 * addresses (`ground-clip.ts`) -- so a falling building is architecturally
 * exposed to the same "loses to its own ground" depth failure during the
 * animation. Unlike the steady-state billboard, this quad draws through a
 * one-off `THREE.Mesh`/`MeshBasicMaterial` (`createCollapseMaterial` below),
 * not the `InstancedMesh`/`ShaderMaterial` pair the shared clamp is written
 * against -- porting it here needs `onBeforeCompile` or a bespoke
 * `ShaderMaterial`, a larger change than this task's measured, in-scope fix.
 * Confirmed by reading, not measured -- the same status `structures.ts`
 * carried for its steady-state case before this pass, now narrowed to just
 * this one animation.
 */
export function collapseBillboardGeometry(
  scale: number,
  textureWidthPx: number,
  textureHeightPx: number
): StructureBillboardGeometry {
  const { drawWidthPx, drawHeightPx } = billboardDrawSize(scale, textureWidthPx, textureHeightPx);
  const halfW = drawWidthPx / 2;
  const right = screenOffsetToWorld(1, 0);

  const corner = (rightPx: number, upPx: number): [number, number, number] => [
    right.dx * rightPx,
    upPx * WORLD_Y_PER_LIFT_PIXEL,
    right.dy * rightPx,
  ];

  const bl = corner(-halfW, 0);
  const br = corner(halfW, 0);
  const tr = corner(halfW, drawHeightPx);
  const tl = corner(-halfW, drawHeightPx);

  return {
    // Same uv/index convention as structureBillboardGeometry -- identical
    // texture, identical camera, identical winding; only the "up" range of
    // the positions above differs.
    positions: Float32Array.from([...bl, ...br, ...tr, ...tl]),
    uvs: Float32Array.from([0, 1, 1, 1, 1, 0, 0, 0]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    drawWidthPx,
    drawHeightPx,
  };
}

/** Per-instance GPU attribute arrays `writeStructureInstances` fills, sized
 *  (by the caller) to at least the structure type's own per-type capacity. */
export interface StructureInstanceBuffers {
  /** xyz triples, world space. */
  positions: Float32Array;
  /** Battered-building alpha, one per instance. */
  alphas: Float32Array;
}

/**
 * Fires `console.warn` at most once for the life of this module, naming the
 * capacity `writeStructureInstances` overflowed -- identical reasoning to
 * `units/instances.ts`'s own `warnInstanceCapacityOnce` (not imported from
 * there: this module deliberately does not couple to `instances.ts`, see
 * this file's own top comment on `StructureBillboardGeometry`), duplicated
 * rather than shared for the same reason. A real overflow recurs every
 * frame for the rest of the mission, so warning on every one of those frames
 * would drown out everything else in the console.
 */
let warnedStructureOverflow = false;
function warnStructureCapacityOnce(capacity: number): void {
  if (warnedStructureOverflow) return;
  warnedStructureOverflow = true;
  console.warn(
    `writeStructureInstances: instance capacity (${capacity}) exceeded -- extra instances are dropped, not ` +
      "drawn. The caller needs a larger buffer."
  );
}

/**
 * Per-instance GPU attributes for every placement this frame -- the pure
 * half of `StructureInstancer.update`, callable with no `THREE.InstancedMesh`
 * at all. `placements` is whatever `liveStructurePlacements`/
 * `deadStructurePlacements` returned; unlike `writeUnitInstances` there is no
 * `visible` flag to filter on here (a structure has no roof-slot cap the way
 * a garrisoned occupant does), so every placement handed in is written.
 *
 * Clamped to `out`'s own capacity (`alphas.length`, `positions` sized 3x
 * that) for the same reason `writeUnitInstances` is: a past-the-end typed-
 * array write is a silent no-op in JavaScript rather than a thrown error, so
 * without this clamp `count` would climb past what was actually written and
 * the caller would set `mesh.count` beyond the allocated instances -- every
 * instance past the real data reads (0, 0, 0) at alpha 0 and is
 * alpha-discarded. Unreachable today (capacity is `sim.structureCount`, an
 * upper bound on any one type's own living-or-dead count), but this phase
 * already shipped one buffer that dropped the wrong end on overflow
 * (`tracers`, fixed) -- the same mistake, caught here before it needs its
 * own incident.
 */
export function writeStructureInstances(
  placements: readonly StructurePlacement[],
  out: StructureInstanceBuffers
): number {
  const capacity = Math.min(Math.floor(out.positions.length / 3), out.alphas.length);
  let count = 0;
  for (const p of placements) {
    if (count >= capacity) {
      warnStructureCapacityOnce(capacity);
      break;
    }
    out.positions[count * 3] = p.fx;
    out.positions[count * 3 + 1] = p.worldY;
    out.positions[count * 3 + 2] = p.fy;
    out.alphas[count] = p.alpha;
    count++;
  }
  return count;
}

/** Task B4.4: seconds a falling building takes to settle onto its own wreck
 *  -- Pixi's own `COLLAPSE_SECONDS` (`renderer.ts:53`), redeclared here
 *  rather than imported for the same pixi.js-import reason `ThreeRenderer.ts`
 *  redeclares `RECOIL_SECONDS`/`FLINCH_SECONDS` from `renderer.ts` rather
 *  than importing them (that class's own field doc comment). */
export const COLLAPSE_SECONDS = 0.6;
/** Task B4.4: how far the roof line settles over that fall, as a fraction of
 *  the billboard's own height -- Pixi's own `COLLAPSE_SQUASH`
 *  (`renderer.ts:58`). Not all the way to nothing: the wreck billboard
 *  underneath stands a little proud of the ground, and a roof sinking past
 *  it reads as the building falling through the floor -- Pixi's own comment
 *  on the identical constant, verbatim reasoning. */
export const COLLAPSE_SQUASH = 0.8;

/** What `collapseFrame` computes for one falling building on one frame. */
export interface CollapseFrame {
  /** `mesh.scale.y` to apply this frame. Always `1` at `tSeconds === 0` --
   *  `collapseBillboardGeometry`'s quad is already drawn at final world
   *  size (like every other billboard in this backend), unlike Pixi's own
   *  sprite, which starts at raw texture pixels and needs a separate
   *  `scaleY0` multiplier (`renderer.ts:280`) to reach screen size at all;
   *  three.js's own rest scale is simply `1`, so there is nothing here for
   *  a caller to multiply by. */
  scaleY: number;
  /** `mesh.material.opacity` to apply this frame. */
  alpha: number;
  /** True once the fall has finished settling -- the caller removes and
   *  disposes the mesh. */
  done: boolean;
}

/**
 * Squared easing, matching Pixi's own `stepCollapses` exactly
 * (`renderer.ts:311-325`): `p = min(1, t / COLLAPSE_SECONDS)`, `e = p * p`,
 * `scale.y = scaleY0 * (1 - COLLAPSE_SQUASH * e)`, `alpha = alpha0 * (1 -
 * e)`. A linear fall reads as a lift lowering rather than a structure
 * failing -- Pixi's own comment on why this is squared, not linear,
 * reproduced verbatim in intent.
 *
 * Pure -- `tSeconds` is the caller's own accumulated elapsed time, not a
 * per-frame delta, so this is a single deterministic function of "how far
 * into the fall," not a stateful stepper. `ThreeRenderer` owns the
 * per-mesh `t` accumulator itself, the same way it already owns every
 * other per-entity timer (`recoilT`, `flinchT`, `dying[].t`).
 */
export function collapseFrame(tSeconds: number, alpha0: number): CollapseFrame {
  const p = Math.min(1, tSeconds / COLLAPSE_SECONDS);
  const e = p * p;
  return {
    scaleY: 1 - COLLAPSE_SQUASH * e,
    alpha: alpha0 * (1 - e),
    done: p >= 1,
  };
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, InstancedMesh, ShaderMaterial) or real I/O (fetch, image
// decode). Neither is exercised by `structures.test.ts`, the same reason
// `terrain/mesh.ts` and `units/instances.ts`'s own GPU half have no test file
// of their own -- covered instead by the browser verification in this task's
// report.
// ---------------------------------------------------------------------------

/** Threshold below which a fragment is fully discarded rather than blended --
 *  identical reasoning and identical value to `units/instances.ts`'s own
 *  `ALPHA_PADDING_DISCARD`: a structure sheet's canvas is padded to a square
 *  (or at least a rectangle wider than the silhouette) around the art, and a
 *  fully-transparent padding texel must write neither colour nor depth, or
 *  an invisible box would occlude whatever stands behind the sprite's own
 *  bounding rectangle rather than its silhouette. */
const ALPHA_PADDING_DISCARD = 0.02;

/**
 * The structure material: samples ONE plain `sampler2D` (never a
 * `DataArrayTexture` -- there is no per-instance frame/layer to select, a
 * structure sheet has exactly one frame per instancer), blends per-instance
 * alpha the same way `units/instances.ts`'s own material does, and applies
 * no colour-space transform for the same reason units do not: a plain
 * `new THREE.Texture(...)` (this file's own `loadStructureFrame`, not
 * `THREE.TextureLoader`) defaults `colorSpace` to `NoColorSpace`
 * (`three/src/textures/Texture.js`, verified against the installed 0.170
 * source), so the sampled bytes already reach `gl_FragColor` unmodified with
 * no extra code needed here.
 *
 * ## Ground-clip fix -- measured here, not merely inherited by reading
 *
 * `structureBillboardGeometry`'s quad is centred exactly like
 * `unitBillboardGeometry`'s (this file's own top comment, "Anchor
 * convention"), so it straddles true ground by `halfDrawHeightPx` the same
 * way a unit's did before `f54be82` -- that commit's own "KNOWN, NOT FIXED"
 * note named this file by name but left it unmeasured. Measured now: a live
 * `apartment` billboard (the tallest arted type after `mosque`,
 * `height_px: 30`) showed the identical defect signature on the same
 * `beit_sahwan_outskirts` map -- a solid, textured band along the wall's
 * own base losing its depth test to the flat ground beneath it, not the
 * 1-2px antialiasing fringe. `mosque` and `shanty`, also captured, showed
 * none -- consistent with `instances.ts`'s own "vehicle-specific, not
 * uniform" scaling, not a contradiction. Full derivation, measurement, and
 * the two buildings that did NOT show it: `ground-clip.ts`'s own top
 * comment and `.superpowers/d-structure-clip-report.md`.
 */
function createStructureMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv;
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Ground-clip fix -- shared verbatim with instances.ts's own
        // createUnitMaterial via ground-clip.ts; see that file's own top
        // comment for the full derivation and for why the identical proof
        // applies to this material's InstancedMesh chain. (No backticks in
        // this comment: it lives inside the vertexShader template literal
        // below, and a backtick here would close it early.)
        ${GROUND_CLIP_DEPTH_CLAMP_GLSL}
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 texel = texture2D(uMap, vUv);
        float a = texel.a * vAlpha;
        if (a < ${ALPHA_PADDING_DISCARD}) discard;
        gl_FragColor = vec4(texel.rgb, a);
      }
    `,
    // Same three flags, same reasoning, as `units/instances.ts`'s own
    // `createUnitMaterial`: opaque-before-transparent render-pass ordering
    // plus `LessEqualDepth` is what lets a structure sprite win a depth tie
    // against terrain/scatter/grove geometry sharing its exact ground point,
    // and real `depthWrite` is what lets it genuinely occlude a unit or
    // another structure standing behind it -- no `clearZ`-style sort key
    // needed on either side.
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

/**
 * Task B4.4: the material a falling building's one-off, non-instanced
 * `THREE.Mesh` draws through -- structurally simpler than
 * `createStructureMaterial`'s `ShaderMaterial` above (no `aAlpha` instanced
 * attribute to read: a collapse is never instanced, so plain
 * `MeshBasicMaterial.opacity` is the whole story), but the same
 * padding-discard threshold (`ALPHA_PADDING_DISCARD`) via `alphaTest`, for
 * the identical reason: a fully-transparent texel around the art's own
 * silhouette must write neither colour nor depth, or an invisible box would
 * occlude whatever the fall passes in front of. `opacity` is set once here
 * from the caller's own `alpha0` and overwritten every frame afterward by
 * `ThreeRenderer.stepCollapses`' own easing.
 */
export function createCollapseMaterial(texture: THREE.Texture, alpha0: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    alphaTest: ALPHA_PADDING_DISCARD,
    opacity: alpha0,
  });
}

/**
 * One structure sheet's `InstancedMesh`, plus the per-instance scratch
 * buffers `update` writes into. A structure TYPE gets up to two of these --
 * one for its idle art, one for its wreck art if the sheet declares one --
 * constructed and owned by `ThreeRenderer.loadStructureSprite`.
 *
 * Sized (via `capacity`) to `sim.structureCount` at load time, the same
 * "total count across every type" bound `UnitInstancer` uses (`sim.capacity`
 * there) -- safe because no structure type can ever have more living (or
 * dead) instances than the sim has structures at all, and `sim.structureCount`
 * is already final by the time `loadStructureSprite` runs (`main.ts` adds
 * every map structure before kicking off any art load).
 */
export class StructureInstancer {
  readonly mesh: THREE.InstancedMesh;
  private readonly texture: THREE.Texture;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor(texture: THREE.Texture, geometry: StructureBillboardGeometry, capacity: number) {
    this.texture = texture;
    const cap = Math.max(1, capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(geometry.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(geometry.indices, 1));

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    geo.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geo, createStructureMaterial(texture), cap);
    this.mesh.count = 0;
    // Same reasoning as `UnitInstancer`: instances are translated across the
    // whole map, not clustered at the base geometry's own origin, so the
    // auto-computed bounding sphere would frustum-cull the whole mesh the
    // moment the camera panned away from (0, 0).
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(cap * 3);
  }

  /** Task B4.4: read-only access to the texture this instancer draws --
   *  `ThreeRenderer.beginCollapse` reads the IDLE instancer's copy of this
   *  and borrows the SAME texture object for its own one-off collapse
   *  `Mesh` (never a copy or a second decode), so this instancer remains
   *  the texture's one true owner: `dispose()` below is still the only
   *  thing that ever frees it, and the collapse mesh's own `dispose()`
   *  must not double-free it. */
  get spriteTexture(): THREE.Texture {
    return this.texture;
  }

  /** Writes this frame's placements into the mesh's GPU-facing buffers and
   *  shrinks `mesh.count` to match. */
  update(placements: readonly StructurePlacement[]): void {
    const count = writeStructureInstances(placements, {
      positions: this.scratchPositions,
      alphas: this.alphaAttr.array as Float32Array,
    });
    for (let i = 0; i < count; i++) {
      this.scratchMatrix.makeTranslation(
        this.scratchPositions[i * 3],
        this.scratchPositions[i * 3 + 1],
        this.scratchPositions[i * 3 + 2]
      );
      this.mesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  /** Releases the geometry, material and texture this instancer owns -- a
   *  re-load calls this on the instancer it replaces, exactly like
   *  `UnitInstancer.dispose`/`ThreeRenderer.loadSprites`. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}

/** One decoded structure frame: the texture `StructureInstancer` samples,
 *  plus the real pixel dimensions `structureBillboardGeometry` needs -- see
 *  this file's top comment on why those are read off the bitmap rather than
 *  threaded through from the manifest's own (unused, by either backend)
 *  `"size"` field. */
export interface LoadedStructureFrame {
  texture: THREE.Texture;
  width: number;
  height: number;
}

/**
 * Fetch and decode one structure frame -- `spec.file` (idle) or
 * `spec.wreckFile` (wreck), each its own independent call, matching Pixi's
 * own `Assets.load` per file (`renderer.ts:656,658`). No `fetchSlots`
 * throttle the way `atlas.ts`'s `decodeFrame` needs one: a structure sheet
 * is one or two files, never the 272-file burst per unit type that throttle
 * exists to prevent, and `main.ts` already loads at most seven structure
 * types in parallel (`STRUCTURE_SPRITES`), a fraction of the unit roster's
 * own concurrency.
 *
 * `flipY` is set to `false` explicitly, NOT left at a plain `THREE.Texture`'s
 * own default (`true`) -- see `structureBillboardGeometry`'s own uv comment
 * for the browser-measured reason: an `ImageBitmap` source combined with the
 * default `flipY = true` rendered every structure upside down in practice,
 * discovered by isolating the mesh in the live scene, not by reading the
 * shader. Forcing `false` here matches `atlas.ts`'s `DataArrayTexture`
 * convention exactly, which this module's uvs are written against.
 */
export async function loadStructureFrame(basePath: string, file: string): Promise<LoadedStructureFrame> {
  const url = `${basePath}${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`structure sprite: ${res.status} fetching ${url}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, width: bitmap.width, height: bitmap.height };
}
