/**
 * Task B3.5: units on screen. `frame-state.ts` (B3.3) decides WHERE and WHAT
 * one living entity looks like for one rendered frame, as a plain
 * `EntityFrame` -- no `THREE.*`, no GPU. `atlas.ts` (B3.4) decides WHICH
 * `DataArrayTexture` layer holds a given `(clip, facing, frame)`. This module
 * is where both become the thing actually on screen: one `THREE.InstancedMesh`
 * per unit type, one draw call regardless of how many of that type are alive,
 * per Ruling 1 (`packages/render/src/three/ThreeRenderer.ts`'s callers wire
 * it up; nothing here touches `Sim`).
 *
 * Split the same way `atlas.ts` is: pure functions first (testable in
 * `environment: 'node'` -- no DOM, no GPU), the `THREE.*`-constructing half
 * after the line that says so. `unitBillboardGeometry`, `facingIndex` and
 * `writeUnitInstances` are exercised directly by `instances.test.ts`;
 * `UnitInstancer` itself is not (`THREE.InstancedMesh`/`ShaderMaterial`
 * construction needs nothing headless cannot provide, but *using* it end to
 * end needs a real `WebGLRenderer`, which cannot be built under
 * `environment: 'node'` -- the same reason `ThreeRenderer` itself has no
 * test file).
 *
 * ## Billboard convention: matches `terrain/grove.ts`, not `THREE.Sprite`
 *
 * `grove.ts`'s canopies are baked billboards: "right" is
 * `screenOffsetToWorld(px, 0)`, "up" is world +Y scaled by
 * `WORLD_Y_PER_LIFT_PIXEL`, and both are baked into static vertices once,
 * never recomputed from the camera per frame -- correct because this camera
 * never orbits (`ELEVATION`/`AZIMUTH` are compile-time constants; `Camera` is
 * `{x, y, zoom}`, no orbit field exists). `unitBillboardGeometry` below uses
 * the identical two axes for the identical reason, and for a second one
 * specific to units: they carry real textures with real alpha, so *which*
 * billboard convention is used is not merely a style choice the way it might
 * be for an unlit vertex-coloured tree -- it decides depth semantics.
 *
 * `THREE.Sprite` was the other candidate and was rejected, not merely passed
 * over. Its own vertex shader (`SpriteMaterial`'s chunk, `three.module.js`)
 * transforms only the sprite's *anchor point* into view space and then
 * offsets the four corners in view-space X/Y by a screen-facing rotation --
 * critically, it does NOT touch view-space Z. Every corner of a `THREE.Sprite`
 * therefore shares exactly one depth, regardless of the sprite's size. A unit
 * standing at a ridge's base needs its feet and its head to depth-test
 * differently against that ridge's own sloped face -- that is the entire
 * reason B3 replaces Pixi's `clearZ` hacks with a real depth buffer. A
 * `THREE.Sprite` cannot provide that: it is flat in depth by construction,
 * the exact defect `clearZ` existed to paper over, reborn one layer down. So
 * every vertex here is placed in genuine world space -- exactly like
 * `grove.ts`'s `toWorld` -- and depth falls out of the ordinary depth buffer
 * with no sort key, no per-frame camera-facing math, and (because this
 * camera's azimuth/elevation are fixed) no loss of correctness relative to a
 * "real" billboard shader that recomputed the same two axes from
 * `viewMatrix` every frame: they would compute the same numbers.
 *
 * ## Anchored at the centre, matching Pixi -- not at the feet
 *
 * An earlier version of this module anchored the quad at the feet (local
 * "up" `0..drawPx`, feet at `0`) on reasoning that was internally sound and
 * still wrong, kept here rather than deleted because the mistake is worth
 * naming: Pixi's own comment on `spawnAmbient` (`renderer.ts`) calls a
 * unit's screen anchor "the unit's ground contact point", and three.js has a
 * real depth buffer where Pixi has none, so centring the quad on that point
 * -- local "up" running `-half` to `+half` -- looked like it would sink half
 * the sprite below the entity's actual standing point for no reason, and
 * that half-sink argument is correct as far as it goes.
 *
 * What it missed: Pixi does not anchor a UNIT at its feet either. `new
 * Sprite({ texture, anchor: 0.5 })` (`renderer.ts:1283`, `:1256`) centres the
 * FRAME on the anchor point, full stop -- the identical call, with the
 * identical `anchor: 0.5`, that `structures.ts`'s own
 * `structureBillboardGeometry` already ports correctly (see that file's own
 * "Anchor convention" section). Pixi's source draws no distinction between a
 * unit sprite and a structure sprite here; this module's belief that "the
 * unit's ground contact point... already means the same thing on both
 * backends" for a unit SPECIFICALLY was never checked against the art the
 * manifests describe, and does not hold. The render rig's own camera aims at
 * the footprint's ground centre for every sheet class it builds
 * (`tools/dimetric.py`'s `badge_top_px` doc comment: "the camera aims at the
 * footprint's ground centre, so the canvas centre is the anchor";
 * `tools/render_team.py`'s own comment on why it aims at the footprint's
 * `z=0`, "ground level between the figures", rather than the vertical middle
 * of the mass) -- units included, with no carve-out for them.
 *
 * The golden-image diff (`tools/src/golden-diff/`, Phase C's own instrument)
 * caught the consequence, run over real combat for the first time: every
 * unit rendered 60-90 SCREEN PIXELS too high relative to Pixi at
 * verified-identical tick/camera/zoom -- `drawPx / 2`, exactly the gap
 * between "feet at the anchor" and "centre at the anchor" scaled by zoom.
 * Measured directly against the shipped art rather than assumed, so "centre"
 * is not assumed to be exactly right either: the opaque bottom edge of
 * INF_SQUAD's sixteen idle frames sits 5-31 sheet px BELOW the frame's own
 * centre row (of 256), not on it, and TNK_HULL's sits 40-63 sheet px below
 * centre. Neither convention puts a unit's own drawn feet exactly at the
 * anchor point -- Pixi's centred frame does not either. "Feet at the anchor"
 * was therefore never actually a description of the shipped art, for
 * infantry or for vehicles; it was a plausible-sounding idealisation this
 * module adopted without checking it, and the 60-90px gap was the cost.
 *
 * Given that neither convention is exactly right, and Pixi is the explicit
 * reference for this migration phase ("match its on-screen result"), this
 * module now reproduces Pixi's actual, already-shipped, already-tuned
 * convention: local "up" runs `-half` to `+half` (see
 * `unitBillboardGeometry` below), so the quad's GEOMETRIC MIDDLE -- not its
 * base -- sits at the translation. `writeUnitInstances` still writes
 * `f.worldY` there unmodified; only this geometry's own parameterisation of
 * "up" changed, matching `structureBillboardGeometry`'s `-halfH..+halfH`
 * exactly rather than diverging from it for a reason that turned out not to
 * exist.
 *
 * The depth-correctness cost this reopens has two parts, and only one of
 * them is a repeat of something Pixi already lives with. The COSMETIC half
 * -- a vehicle's tracks sitting 40-63 sheet px, scaled, below the point
 * Pixi anchors at -- is not new; it is the same appearance Pixi's own tank
 * rendering already carries, now reproduced rather than avoided. The
 * DEPTH half is genuinely new, because Pixi has no depth buffer for it to
 * cost anything against: a unit's quad now straddles true ground by
 * `halfDrawPx` in world-Y on both sides, and the sunk lower half is not a
 * hypothetical -- captured directly, `mbt_lavi`'s TNK_HULL (`half` = 63
 * SCREEN px at zoom 1, over a third of a tile) visibly loses part of its
 * own tracks to the flat ground plane it stands on, at zoom 1, on a map
 * with NO relief at all (`beit_sahwan_outskirts`; golden-diff crop on
 * file, not merely reasoned about). This does not need a ridge to occur --
 * CLAUDE.md's "picking is untested mid-slope" elevation debt undersold it;
 * it is reachable on flat ground for any unit type whose `halfDrawPx`
 * sink is large relative to a tile, which large vehicles are. Infantry
 * (`inf_squad`, `half` ~15 screen px at zoom 1) shows no measurable version
 * of this in the same capture -- the effect scales with `sheet.scale`, so
 * it is a vehicle-specific cost, not a uniform one. Unresolved by this
 * change and out of its scope: a real fix wants either a second,
 * depth-write-disabled quad for the below-ground sliver (so it never
 * competes with the SAME tile's own ground for depth) or an accepted,
 * documented limitation -- a decision for whoever owns this backend's next
 * phase, not a call this fix makes unilaterally. What is NOT reopened: the
 * render-order tie-break below (opaque terrain committing depth before any
 * transparent unit fragment draws) resolves a depth TIE regardless of
 * where within the quad the tied point falls, vertex or interior -- see
 * the next section, unaffected by this change.
 *
 * ## The unit-vs-tree tie, and what actually resolves it
 *
 * A unit standing at a grove tile's own tree anchor is a genuine, reachable
 * depth tie, not a hypothetical: `groundWorldY` (what `entityFrame` uses for
 * a unit's `worldY`) and `grove.ts`'s own `topY = levelAt(...) *
 * WORLD_PER_LEVEL` (what a tree's trunk base stands on) are the *same*
 * formula over the *same* constants -- `groundLevelAt` delegates to the
 * identical `levelAt` grove.ts imports from `shared.ts`. So a unit's own
 * translation (local up = 0 -- the quad's geometric middle now, not a
 * vertex; see "Anchored at the centre" above) and a co-located tree's trunk
 * base sit at exactly the same world Y before anything else runs, on a tile
 * grove tiles do not block movement onto -- proven in `instances.test.ts`,
 * not merely argued. The tie-point moving from a vertex to the quad's
 * interior does not weaken this: the quad is still one flat plane through
 * that point, spanned by the same two vectors, so its interpolated depth AT
 * that point is the plane equation evaluated there -- identical whether the
 * point happens to land on an edge or inside the rectangle cut from it.
 *
 * An earlier draft of this module resolved that tie with a constant world-Y
 * nudge on every unit vertex, on the reasoning that +Y is monotonically
 * nearer this camera (the same fact `grove.ts`'s own inter-lobe epsilons,
 * `TRUNK_EPSILON` .. `CROWN_LIT_EPSILON`, rely on). That reasoning holds for
 * grove's OWN epsilons because those quads are not all coplanar with each
 * other. It does not hold here: a unit billboard and a grove billboard are
 * BOTH spanned by the identical two vectors (`screenOffsetToWorld(1, 0)` and
 * world +Y), so a translation purely along +Y stays inside that shared
 * plane's span -- it moves a point *within* the plane, not off it. Every
 * screen pixel maps to exactly one point of a plane under this orthographic
 * projection, so at any shared pixel the two quads still yield the same
 * depth regardless of the nudge's size. Measured directly against the real
 * camera rather than re-derived on paper: 4.7e-10 in NDC, zero to float
 * precision. The nudge bought no separation against trees at all -- inert
 * for the one case it was introduced to fix -- which is why this module no
 * longer carries one.
 *
 * What actually resolves the tie is ordinary three.js render-pass ordering,
 * not anything this module opts into. Every builder under `terrain/` --
 * ground, scatter, grove, buildings, all of it -- shares one opaque
 * `MeshBasicMaterial({ vertexColors: true })` (`terrain/mesh.ts`);
 * `createUnitMaterial` below sets `transparent: true`. three.js sorts every
 * frame's renderables into an opaque list and a transparent list and always
 * finishes the opaque list -- committing its depths to the depth buffer --
 * before drawing anything transparent. The default depth comparison
 * (`THREE.LessEqualDepth`) then passes a transparent fragment whose depth
 * *equals* what is already written, so at the exact pixel where a unit and a
 * tree (or a unit and the ground itself) tie, the transparent, drawn-after
 * unit fragment passes and overwrites the opaque, already-committed terrain
 * pixel -- deterministically, every frame, independent of scene-graph
 * insertion order and of how exact the tie is. This is not the manual
 * `renderOrder` property the brief names as the bias's alternative: that
 * property only arbitrates which of two fragments *already judged equal
 * depth within one pass* wins by submission order, which cannot help a
 * *near* tie a moving, interpolated unit might cross through mid-frame.
 * Opaque-before-transparent ordering has no such gap -- it never compares
 * two draws' arrival order at all, only a committed depth buffer against an
 * incoming fragment, so "near" and "exact" resolve the identical way.
 * `DoubleSide` was never applicable either: it addresses back-face culling,
 * not depth ordering.
 *
 * ## Alpha: blend, matching Pixi -- and the palette consequence, stated plainly
 *
 * B3.4's own orchestrator note (see the B3.5 brief) measured that `LinearFilter`
 * (already set by `atlas.ts`, unchanged here) puts off-palette pixels on
 * screen at this draw scale -- most interior pixels are already a bilinear
 * blend of two to four adjacent palette entries, and the note is explicit
 * that alpha-test alone does not undo that; only switching to `NearestFilter`
 * would, at the cost of shimmer on pan/zoom the note also measured. Given
 * that the interior is not palette-exact regardless of the alpha decision,
 * this module chooses alpha-BLEND: `transparent: true`, real coverage
 * blending at the silhouette edge, matching exactly what `?renderer=pixi`
 * already ships for these same 3,101 PNGs (Pixi v8 defaults `scaleMode` to
 * `'linear'` and nothing in this repo overrides it). That keeps a future
 * Phase D golden-image diff meaningful for units, and keeps the three.js
 * backend's units looking like the game players already know rather than
 * introducing a crisper-but-different silhouette style nobody asked for.
 *
 * **Stated plainly, per the brief's own requirement: unit pixels drawn by
 * this module are NOT palette-exact.** B2's terrain guarantee (every terrain
 * pixel is one of the 65 palette entries, proved by `ground.test.ts` et al.)
 * covers terrain only, and always has -- terrain is unlit vertex-coloured
 * geometry with no texture sampling anywhere in its pipeline, a fundamentally
 * different mechanism from a raster sprite. Units were never going to carry
 * that same guarantee once real PNGs entered the picture; this is Pixi's
 * own, already-shipping behaviour, inherited rather than introduced by B3.
 * The one piece of `ALPHA_PADDING_DISCARD` below is not the palette
 * trade-off -- it exists only so the fully-transparent canvas padding around
 * a sprite's silhouette does not write bogus depth (see its own comment).
 */
import * as THREE from 'three';
import { TILE_W, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { screenOffsetToWorld } from '../terrain/shared';
import { turretAxisOffset, type SheetSpec } from '../../sheet';
import { FRAME_PX, type FramePacking } from './atlas';
import type { EntityFrame } from './frame-state';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './render-order';

// ---------------------------------------------------------------------------
// Pure: geometry and per-instance attribute arithmetic. No THREE.* GPU
// objects below this line yet -- BufferAttribute/InstancedMesh construction
// starts after the "GPU-facing" divider further down.
// ---------------------------------------------------------------------------

/**
 * Sprite-sheet facing index for a normalised (0..1) heading. Ported from
 * `PixiRenderer.spriteIndex` (`renderer.ts:388-392`) rather than imported:
 * it is `private static` and unexported, and importing anything from
 * `renderer.ts` would pull pixi.js into this module's graph -- the same
 * reason `terrain/shared.ts` redeclares `TERRAIN_DECOR` instead of importing
 * it. `entityFrame` (`frame-state.ts`) hands back `facing` as the raw
 * normalised float unconverted (matching Pixi's own `facingNorm`); turning
 * it into an integer sheet index is this module's job, one lookup away from
 * where it is actually used (`packing.regionFor`).
 */
export function facingIndex(facingNorm: number, sheet: SheetSpec): number {
  const n = sheet.facings;
  const k = Math.round(facingNorm * n) % n;
  const dir = sheet.facingReverse ? -k : k;
  return (((dir + sheet.facingOffset) % n) + n) % n;
}

/** Plain-array quad geometry for one unit type's billboard: four vertices,
 *  two triangles, shared by every instance of that type. No THREE.* types,
 *  so it is testable exactly like `terrain/*`'s `MeshData` builders. */
export interface BillboardGeometry {
  /** xyz triples, three.js world space, local to an instance's own
   *  translation (the entity's ground anchor -- the quad's geometric middle
   *  sits here, matching Pixi's `anchor: 0.5`, not its base). Four vertices:
   *  bottom-left, bottom-right, top-right, top-left. */
  positions: Float32Array;
  /** uv pairs, one per vertex, same order as `positions`. */
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * The static, per-unit-type camera-facing quad every instance of that type
 * shares -- built once when a sheet's texture loads (`ThreeRenderer.
 * loadSprites`), never per frame. See this file's own top comment for the
 * billboard convention and the centre anchor; this is where both become
 * numbers.
 *
 * Drawn size matches Pixi's own on-screen scale exactly: Pixi computes
 * `spriteScale = (sheet.scale * TILE_W) / textureWidthPx` and applies it
 * uniformly to a square texture (`renderer.ts:2103-2105`), so its drawn
 * width -- and, since every frame is square, height -- is always
 * `sheet.scale * TILE_W` regardless of the texture's actual pixel size. That
 * arithmetic is reproduced directly here rather than importing `FRAME_PX`
 * from `atlas.ts` and dividing it back out, which would only reintroduce the
 * same cancelled term.
 */
export function unitBillboardGeometry(sheet: SheetSpec): BillboardGeometry {
  const drawPx = sheet.scale * TILE_W;
  const half = drawPx / 2;
  const right = screenOffsetToWorld(1, 0);

  // No world-Y bias here -- see this file's top comment ("The unit-vs-tree
  // tie, and what actually resolves it") for why a +Y nudge cannot separate
  // this plane from a coplanar one, and for the render-order mechanism that
  // actually resolves the tie instead. Local up = 0 is therefore the
  // entity's real, unmodified groundWorldY, matching `groundWorldY`'s own
  // contract exactly rather than by 0.05 world units -- it is just no longer
  // a drawn vertex (see "Anchored at the centre, matching Pixi" above): the
  // quad's own geometric middle sits there now, matching
  // `structureBillboardGeometry`'s `-halfH..+halfH` convention rather than
  // this module's own former `0..drawPx`.
  const corner = (rightPx: number, upPx: number): [number, number, number] => [
    right.dx * rightPx,
    upPx * WORLD_Y_PER_LIFT_PIXEL,
    right.dy * rightPx,
  ];

  const bl = corner(-half, -half);
  const br = corner(half, -half);
  const tr = corner(half, half);
  const tl = corner(-half, half);

  return {
    positions: Float32Array.from([...bl, ...br, ...tr, ...tl]),
    // v inverted relative to local "up": `buildUnitTexture` (atlas.ts)
    // uploads into a `THREE.DataArrayTexture` with `flipY` set explicitly to
    // `false` (matching `DataArrayTexture`'s own default, verified against
    // 0.170's source -- but no longer relying on that default going
    // unchanged across a future three.js version, see atlas.ts's own
    // comment). With no flip, texel row 0 -- `getImageData`'s first row,
    // the TOP of the source PNG -- lands at texture v = 0. So the quad's
    // TOP edge (up = +half) must sample v = 0 to show the sprite's top,
    // and the quad's BOTTOM edge (up = -half) samples v = 1 -- the vertex
    // ORDER (bl, br, tr, tl) is unchanged from the feet-anchored version,
    // only what world Y each one computes to did.
    uvs: Float32Array.from([0, 1, 1, 1, 1, 0, 0, 0]),
    // Winding verified analytically against this camera's VIEW_DIRECTION,
    // not by inspection -- `instances.test.ts` checks it directly, the same
    // way `grove.test.ts` proves its own billboards. For vertex order
    // (bl, br, tr, tl) this is the front-facing order; the opposite index
    // order (0,2,1)/(0,3,2) -- `ground.ts`'s own `flip: false`, correct
    // there for a *horizontal* quad traced (x,y)->(x+1,y)->(x+1,y+1)->
    // (x,y+1) -- would face away here, because a vertical quad traced
    // bottom-left->bottom-right->top-right->top-left runs the opposite
    // rotational sense relative to this camera.
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  };
}

/** Per-instance GPU attribute arrays `writeUnitInstances` fills, sized (by
 *  the caller) to at least the unit type's own per-type capacity. */
export interface UnitInstanceBuffers {
  /** xyz triples, world space -- the translation `UnitInstancer` writes into
   *  each live instance's `instanceMatrix`. */
  positions: Float32Array;
  /** DataArrayTexture layer index, one per instance. */
  layers: Float32Array;
  /** Body alpha (contact-level fade), one per instance. */
  alphas: Float32Array;
}

/**
 * Fires `console.warn` at most once per writer for the life of this module,
 * naming the writer and the capacity it overflowed -- an instance buffer
 * overflow recurs every single frame for the rest of the mission (nothing
 * about the condition that caused it self-corrects), and warning on every
 * one of those frames would drown out anything else in the console. See
 * `writeUnitInstances`'/`writeTurretInstances`' own doc comments for the
 * defect this guards: a past-the-end typed-array write is a silent no-op in
 * JS, not a thrown error, so without this a caller's `mesh.count` could climb
 * past what was actually written with nothing ever saying so.
 */
const warnedInstanceOverflow = new Set<string>();
function warnInstanceCapacityOnce(writer: string, capacity: number): void {
  if (warnedInstanceOverflow.has(writer)) return;
  warnedInstanceOverflow.add(writer);
  console.warn(
    `${writer}: instance capacity (${capacity}) exceeded -- extra instances are dropped, not drawn. ` +
      'The caller needs a larger buffer.'
  );
}

/**
 * Per-instance GPU attributes for every VISIBLE living entity of one unit
 * type, this frame -- the pure half of the per-frame update, callable with
 * no `THREE.InstancedMesh` at all (this file's own tests exercise it
 * directly, with a hand-built `EntityFrame[]` fixture).
 *
 * `frames` need not be pre-filtered: `visible: false` (an over-the-cap roof
 * occupant, per `frame-state.ts`'s own `assignRoofSlots`/`roofSpreadPx`) is
 * skipped here, exactly mirroring Pixi's `continue`. The returned count is
 * always `<= frames.length` -- callers set `mesh.count` to it, which is the
 * only "hide an instance" mechanism an `InstancedMesh` has; a stale tail of
 * attribute data past `count` is simply never read by the GPU.
 *
 * Also clamped to `out`'s own capacity (`layers`/`alphas`' shared length,
 * `positions` sized 3x that): a `count` past the end of a typed array is a
 * silent no-op write in JavaScript, not a thrown `RangeError`, so without
 * this clamp `count` would keep climbing past what was actually written and
 * the caller would set `mesh.count` beyond the allocated instances -- every
 * instance past the real data reads (0, 0, 0) at alpha 0 and is
 * alpha-discarded, a mesh that silently draws fewer units than it claims to.
 * Unreachable today (every per-type capacity is sized to `sim.capacity`), but
 * this phase already shipped one buffer that dropped the wrong end on
 * overflow (`tracers`, fixed) -- this is the same mistake, caught here before
 * it needs its own incident.
 *
 * `roofDx` (a screen-pixel lateral spread between two roof occupants,
 * `frame-state.ts`'s own doc comment) converts through the same `right` axis
 * `unitBillboardGeometry` and every terrain mark use -- a garrisoned unit's
 * translation is nudged sideways in world space by the same amount a mark's
 * screen-pixel jitter would be, not a separate convention.
 */
export function writeUnitInstances(
  frames: readonly EntityFrame[],
  sheet: SheetSpec,
  packing: FramePacking,
  out: UnitInstanceBuffers
): number {
  const right = screenOffsetToWorld(1, 0);
  const capacity = Math.min(Math.floor(out.positions.length / 3), out.layers.length, out.alphas.length);
  let count = 0;
  for (const f of frames) {
    if (!f.visible) continue;
    if (count >= capacity) {
      warnInstanceCapacityOnce('writeUnitInstances', capacity);
      break;
    }
    const facing = facingIndex(f.facing, sheet);
    const region = packing.regionFor(f.clip, facing, f.frame);
    out.positions[count * 3] = f.wx + right.dx * f.roofDx;
    out.positions[count * 3 + 1] = f.worldY;
    out.positions[count * 3 + 2] = f.wy + right.dy * f.roofDx;
    out.layers[count] = region.layer;
    out.alphas[count] = f.alpha;
    count++;
  }
  return count;
}

/**
 * Task B3.6: per-instance GPU attributes for a unit type's TURRET mesh --
 * the second `InstancedMesh` a turreted unit type draws through, composited
 * above its hull at the SAME world position, corrected by `turretAxisOffset`
 * so the weapon's own traverse axis (not the model's median vertex) stays on
 * the hull. Reads the SAME `EntityFrame[]` the hull mesh draws from --
 * `entityFrame` (`frame-state.ts`) already decided `turretFacing`/
 * `turretClip`/`turretFrame` alongside everything else, so this function's
 * own job is exactly `writeUnitInstances`'s: turn an already-decided
 * `EntityFrame` into GPU attributes, generalised only by the one thing a
 * turret needs that a hull does not.
 *
 * `hullSheet` is needed only for `facingIndex(f.facing, hullSheet)` --
 * `turretAxisOffset`'s own `hullIndex` argument, in the HULL sheet's own
 * facing convention, exactly mirroring `renderer.ts:2161`'s
 * `turretAxisOffset(atlas.turretSheet ?? sheet, hullIdx, tIdx)` where
 * `hullIdx = PixiRenderer.spriteIndex(facingNorm, sheet)` and `sheet` there
 * is the HULL sheet (`renderer.ts:2100`).
 *
 * The draw SIZE, though, comes from `hullSheet.scale`, not `turretSheet
 * .scale` -- `spritePxPerSheetPx` below reproduces Pixi's own `spriteScale`
 * (`renderer.ts:2108`, `(sheet.scale * TILE_W) / idle[0][0].width`, `sheet`
 * again the HULL) applied to `tspr.scale.set(spriteScale)` (renderer.ts:2169,
 * the SAME variable, never `atlas.turretSheet.scale`). This is safe rather
 * than merely convenient: every shipped hull/turret pair (TNK, EITAN, NAMER,
 * GUNTRUCK, TECH) declares the IDENTICAL `scale` in both manifests --
 * verified against the files, not assumed -- because a hull and its turret
 * are two meshes of the one vehicle, rendered by the same rig invocation
 * from the same `realMetres`/`metresPerModelUnit`. `unitBillboardGeometry`
 * itself is still built from `turretSheet` when this instancer is
 * constructed (see `UnitInstancer.updateTurret`'s own comment) -- since the
 * scales agree, that produces the identical quad size Pixi's own
 * hull-scale-only mechanism does.
 */
export function writeTurretInstances(
  frames: readonly EntityFrame[],
  hullSheet: SheetSpec,
  turretSheet: SheetSpec,
  turretPacking: FramePacking,
  out: UnitInstanceBuffers
): number {
  const right = screenOffsetToWorld(1, 0);
  const spritePxPerSheetPx = (hullSheet.scale * TILE_W) / FRAME_PX;
  // Same overflow clamp as `writeUnitInstances`, same reason -- see that
  // function's own doc comment.
  const capacity = Math.min(Math.floor(out.positions.length / 3), out.layers.length, out.alphas.length);
  let count = 0;
  for (const f of frames) {
    if (!f.visible) continue;
    if (count >= capacity) {
      warnInstanceCapacityOnce('writeTurretInstances', capacity);
      break;
    }
    const hullIdx = facingIndex(f.facing, hullSheet);
    const turretIdx = facingIndex(f.turretFacing, turretSheet);
    const [axXsheetPx, axYsheetPx] = turretAxisOffset(turretSheet, hullIdx, turretIdx);
    // Both components are a genuine 2D SCREEN-pixel correction -- the same
    // shape recoil/flinch's `ox`/`oy` are (`frame-state.ts`'s own top
    // comment) -- so both go through `screenOffsetToWorld` onto the ground
    // plane. There is no "real height" component here the way
    // `roofLiftWorld` has for `roofPx`: `turretAxisPx` measures a rendering
    // artefact (the turret's pivot lands at a different screen pixel per
    // facing purely because the rig rotated the object, not the camera),
    // not a physical height the sim tracks.
    const axisOffset = screenOffsetToWorld(
      axXsheetPx * spritePxPerSheetPx,
      axYsheetPx * spritePxPerSheetPx
    );
    const region = turretPacking.regionFor(f.turretClip, turretIdx, f.turretFrame);
    out.positions[count * 3] = f.wx + right.dx * f.roofDx + axisOffset.dx;
    out.positions[count * 3 + 1] = f.worldY;
    out.positions[count * 3 + 2] = f.wy + right.dy * f.roofDx + axisOffset.dy;
    out.layers[count] = region.layer;
    out.alphas[count] = f.alpha;
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, InstancedMesh, ShaderMaterial). None of it is exercised
// by `instances.test.ts` for the same reason `terrain/mesh.ts` has no test
// file of its own -- there is nothing to assert beyond "three.js accepted
// these buffers", and *using* it end to end needs a real WebGLRenderer,
// which `environment: 'node'` cannot build. Covered instead by the browser
// verification in the B3.5 report.
// ---------------------------------------------------------------------------

/**
 * Threshold below which a fragment is fully discarded rather than blended.
 *
 * NOT the alpha-test-vs-blend decision (see this file's top comment) --
 * everything above this threshold still blends normally, silhouette edges
 * included. This exists only because `buildUnitTexture` decodes a sprite's
 * *whole* 256x256 canvas, most of which is fully transparent padding around
 * the silhouette: with `depthWrite: true` (needed so an opaque unit
 * genuinely occludes terrain and other units behind it, replacing `clearZ`),
 * a fragment that blended at alpha 0 would still write real depth at that
 * pixel -- an invisible box occluding whatever stands behind the padding,
 * the exact defect this task's shift to real depth is supposed to fix, not
 * reintroduce one texel type at a time. Discarding fully-transparent texels
 * outright means they write neither colour nor depth, exactly as if that
 * corner of the quad were not there.
 */
const ALPHA_PADDING_DISCARD = 0.02;

/**
 * `Object3D.renderOrder` values for a hull mesh and its turret mesh, Task
 * B3.6. `HULL_RENDER_ORDER` is three.js's own default (0) named here rather
 * than left implicit, so the pairing reads as a deliberate decision at both
 * call sites, not an accident of only one of the two ever being set.
 * `TURRET_RENDER_ORDER` being strictly greater is what guarantees a turret
 * mesh draws on top of its hull at every co-located, identical-depth
 * instance (every shipped sheet WITHOUT a `turretAxisPx` correction --
 * mbt_lavi, apc_eitan, ifv_namer) regardless of scene-graph insertion order,
 * construction order, or `Object3D.id` -- see `UnitInstancer`'s own
 * constructor doc comment for why relying on any of those was the hazard.
 *
 * Re-exported from `./render-order`, not declared here: that module is now
 * the single source of truth for every band this backend uses, INCLUDING
 * `units/fx.ts`'s `FX_RENDER_ORDER`/`FX_RENDER_ORDER_ABOVE` -- see its own
 * doc comment for the collision this fixed (`TURRET_RENDER_ORDER` and the
 * old, module-local `FX_RENDER_ORDER` were both `1`) and the full band
 * table. Re-exported here, not merely imported, so every existing importer
 * of this module (`ThreeRenderer.ts`, `instances.test.ts`) is unaffected.
 */
export { HULL_RENDER_ORDER, TURRET_RENDER_ORDER };

/**
 * The unit material: samples one layer of a `DataArrayTexture` per instance,
 * blends (see this file's top comment for the alpha decision), and applies
 * no colour-space transform -- `applyPalettePipeline`'s pass-through
 * `outputColorSpace` and `buildUnitTexture`'s untagged (`NoColorSpace`)
 * texture mean the sampled bytes must reach `gl_FragColor` unmodified, the
 * same contract `terrainMaterial`'s vertex colours honour.
 *
 * A custom `ShaderMaterial` rather than `MeshBasicMaterial`: three.js's
 * built-in materials have no `sampler2DArray` path at all, and per-instance
 * layer selection needs a custom instanced attribute (`aLayer`) regardless.
 * `position`/`uv`/`instanceMatrix` are declared by three.js's own generated
 * prefix for any non-raw `ShaderMaterial` used with an `InstancedMesh`
 * (verified against 0.170's `WebGLProgram` source) -- only the two
 * genuinely custom per-instance attributes are declared here.
 */
function createUnitMaterial(texture: THREE.DataArrayTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
    },
    vertexShader: /* glsl */ `
      attribute float aLayer;
      attribute float aAlpha;
      varying vec2 vUv;
      varying float vLayer;
      varying float vAlpha;
      void main() {
        vUv = uv;
        vLayer = aLayer;
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp sampler2DArray;
      uniform sampler2DArray uMap;
      varying vec2 vUv;
      varying float vLayer;
      varying float vAlpha;
      void main() {
        vec4 texel = texture2D(uMap, vec3(vUv, vLayer));
        float a = texel.a * vAlpha;
        if (a < ${ALPHA_PADDING_DISCARD}) discard;
        gl_FragColor = vec4(texel.rgb, a);
      }
    `,
    // `transparent: true` is not only the alpha decision (this file's top
    // comment) -- combined with `depthTest`/`depthWrite` staying on, and
    // three.js's own opaque-before-transparent render-pass ordering plus its
    // default `LessEqualDepth` comparison, this is the actual mechanism that
    // resolves the unit-vs-terrain/unit-vs-tree depth tie in the unit's
    // favour. See this file's top comment, "The unit-vs-tree tie, and what
    // actually resolves it", for the full account -- `instances.test.ts`
    // asserts these three flags directly on a constructed `UnitInstancer`
    // rather than trusting this comment.
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

/**
 * One unit type's `InstancedMesh`, plus everything `ThreeRenderer` needs to
 * feed it a new frame: the shared billboard geometry, the packed texture,
 * and the per-instance scratch buffers `update` writes into.
 *
 * Sized (via `capacity`) to the unit type's own per-type ceiling, not
 * reallocated per frame -- `update` shrinks `mesh.count` to however many of
 * that type are actually visible this frame rather than resizing anything.
 */
export class UnitInstancer {
  readonly mesh: THREE.InstancedMesh;
  readonly sheet: SheetSpec;
  private readonly packing: FramePacking;
  private readonly texture: THREE.DataArrayTexture;
  private readonly layerAttr: THREE.InstancedBufferAttribute;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();

  /**
   * `renderOrder` defaults to `HULL_RENDER_ORDER` (0, three.js's own
   * default) -- a hull instancer never passes this argument. A turret
   * instancer is always constructed with `TURRET_RENDER_ORDER` explicitly
   * (`ThreeRenderer.loadSprites`).
   *
   * Why this needs to be explicit at all: for `mbt_lavi`/`apc_eitan`/
   * `ifv_namer` -- none of which declare `turretAxisPx` -- the turret quad
   * lands EXACTLY co-located with its hull's, at identical depth. Without an
   * explicit `renderOrder`, three.js's transparent-list sort ties there and
   * falls through to insertion order (`Object3D.id`), which happens to work
   * today only because `ThreeRenderer.loadSprites` always constructs the
   * hull `UnitInstancer` before its turret counterpart. That is exactly the
   * hazard class `units/fx.ts`'s own `renderOrder` split was added to close
   * after a review found ITS ordering was working by accident -- an
   * explicit, tested value here means a future reordering of that
   * construction sequence fails loudly (a turret drawing under its own
   * hull) rather than silently, instead of relying on a tie-break this
   * class has no control over.
   */
  constructor(
    sheet: SheetSpec,
    texture: THREE.DataArrayTexture,
    packing: FramePacking,
    capacity: number,
    renderOrder: number = HULL_RENDER_ORDER
  ) {
    this.sheet = sheet;
    this.packing = packing;
    this.texture = texture;

    const geo = unitBillboardGeometry(sheet);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(geo.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.layerAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aLayer', this.layerAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createUnitMaterial(texture), capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = renderOrder;
    // Instances are translated across the whole map, not clustered at the
    // origin the base geometry is authored around -- the bounding sphere
    // three.js would otherwise compute from the base geometry alone covers
    // only a few dozen world units at the origin, and would frustum-cull the
    // entire mesh the moment the camera panned away from (0, 0). One draw
    // call per unit type (Ruling 1) already means every living instance of
    // a type is submitted together regardless of per-instance visibility, so
    // disabling frustum culling here costs nothing beyond what the
    // architecture already pays.
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(capacity * 3);
  }

  /**
   * Writes this frame's visible instances into the mesh's GPU-facing
   * buffers and shrinks `mesh.count` to match. `frames` is every LIVING
   * entity of this instancer's unit type this frame -- not pre-filtered for
   * `visible`, matching `writeUnitInstances`'s own contract.
   */
  update(frames: readonly EntityFrame[]): void {
    this.commit(writeUnitInstances(frames, this.sheet, this.packing, this.scratchBuffers()));
  }

  /**
   * Task B3.6: updates this instancer AS A TURRET MESH -- composited above
   * `hullSheet`'s own hull mesh rather than standing on its own tile. Only a
   * turret `UnitInstancer` (constructed from a turret sheet/texture/packing
   * in `ThreeRenderer.loadSprites`) calls this; a hull instancer always
   * calls the plain `update` above instead.
   *
   * Kept on the SAME class rather than a subclass or a second type: geometry
   * construction, the material, the GPU buffers and `dispose` are all
   * IDENTICAL between a hull mesh and a turret mesh (see `writeTurretInstances`'s
   * own doc comment for why `unitBillboardGeometry(sheet)` -- called with
   * the TURRET's own sheet here, in the constructor -- already produces the
   * correct draw size without needing a separate code path). Only the
   * per-instance attribute arithmetic differs, and both halves of that are
   * already pure functions this method merely chooses between.
   */
  updateTurret(frames: readonly EntityFrame[], hullSheet: SheetSpec): void {
    this.commit(writeTurretInstances(frames, hullSheet, this.sheet, this.packing, this.scratchBuffers()));
  }

  /** The mutable buffers `writeUnitInstances`/`writeTurretInstances` write
   *  into -- a fresh object each call (cheap: three references, not a copy
   *  of the underlying typed arrays) so `update`/`updateTurret` share this
   *  exact wiring rather than each re-listing the same three fields. */
  private scratchBuffers(): UnitInstanceBuffers {
    return {
      positions: this.scratchPositions,
      layers: this.layerAttr.array as Float32Array,
      alphas: this.alphaAttr.array as Float32Array,
    };
  }

  /** The GPU-facing tail both `update` and `updateTurret` share: turn
   *  `scratchPositions` into per-instance transforms and shrink `mesh.count`
   *  to `count`. Split out so neither caller has to duplicate it. */
  private commit(count: number): void {
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
    this.layerAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  /** Releases the geometry, material and texture this instancer owns. Not
   *  reached from anywhere today -- `ThreeRenderer` has no shutdown path
   *  (see its own `dispose()` doc comment) -- but `loadSprites` replacing an
   *  already-loaded unit type calls it, so a re-load cannot leak the type it
   *  replaces. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
