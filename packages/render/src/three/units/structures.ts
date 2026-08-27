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
 * `maskArtedStructures` below, and `ThreeRenderer.rebuildTerrain`'s own
 * comment on how its output is used (for `buildBuildings` alone, never for
 * `buildGround`/`buildScatter`/`buildGroves`).
 *
 * ## Anchor convention: centred, like Pixi -- not feet-anchored, like units
 *
 * `units/instances.ts` anchors a unit billboard at the feet (local up = 0)
 * because Pixi's own unit anchor point (`spawnAmbient`'s "ground contact
 * point") already means the same thing on both backends. A structure sprite
 * is different: Pixi's `drawStructureSprite`/`drawWreckedStructures` both
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
import { groundWorldY } from '../ground-height';

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

/**
 * `sim.blocked`, with every tile belonging to a LIVING structure whose type
 * satisfies `hasArt` zeroed out -- a fresh copy, never a mutation of
 * `sim.blocked` itself (which `buildGround`/`buildScatter`/`buildGroves`
 * still read unmodified, via their own, separate `TerrainInput`).
 *
 * This is how `ThreeRenderer.rebuildTerrain` tells `buildBuildings` to skip
 * an arted structure's tiles entirely -- not by removing its entry from
 * `structureFootprintsFor`'s own snapshot (which would leave those tiles
 * `blocked` but unclaimed, and `buildBuildings`'s own fallback bundle exists
 * for exactly that shape of input: "a blocked tile no footprint claims
 * still gets a box", `buildings.ts`'s own top comment). Zeroing `blocked`
 * for those tiles instead means `buildBuildings`'s tile loop `continue`s
 * before it ever asks whether a footprint claims them, so neither the real
 * box nor the fallback one is drawn -- the sprite this module's GPU half
 * draws is the only thing left standing there.
 *
 * A structure that is DEAD, or whose type does not satisfy `hasArt` (no
 * sheet loaded, or the load failed -- see `ThreeRenderer.loadStructureSprite`),
 * is left exactly as `sim.blocked` already has it: `buildBuildings` still
 * draws its ordinary box, or the destroyed structure's already-unblocked
 * tiles are already skipped the same way they always were (the pre-existing
 * staleness gap `rebuildTerrain`'s own doc comment names, unaffected by this
 * function either way).
 */
export function maskArtedStructures(sim: Sim, hasArt: (structureId: string) => boolean): Uint8Array {
  const { width, height } = sim;
  const out = Uint8Array.from(sim.blocked);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sIdx = sim.structureAt(x, y);
      if (sIdx < 0) continue;
      const type = sim.structureTypes[sim.structures.typeIdx[sIdx]];
      if (hasArt(type.id)) out[y * width + x] = 0;
    }
  }
  return out;
}

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

function footprintCentre(sim: Sim, sIdx: number): { fx: number; fy: number } {
  const st = sim.structures;
  return {
    fx: (st.minX[sIdx] + st.maxX[sIdx] + 1) / 2,
    fy: (st.minY[sIdx] + st.maxY[sIdx] + 1) / 2,
  };
}

function structurePlacements(
  sim: Sim,
  structureId: string,
  elevation: Uint8Array | null,
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
    let alpha = 1;
    if (wantAlive) {
      const max = st.maxHp[s];
      const integrity = max > 0 ? Math.max(0, st.hp[s] / max) : 1;
      alpha = 0.55 + 0.45 * integrity;
    }
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
  elevation: Uint8Array | null
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
  elevation: Uint8Array | null
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
 * `anchor: 0.5`, not an oversight relative to `unitBillboardGeometry`'s feet
 * anchor.
 */
export function structureBillboardGeometry(
  scale: number,
  textureWidthPx: number,
  textureHeightPx: number
): StructureBillboardGeometry {
  const drawWidthPx = scale * TILE_W;
  const spriteScale = textureWidthPx > 0 ? drawWidthPx / textureWidthPx : 0;
  const drawHeightPx = textureHeightPx * spriteScale;
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

/** Per-instance GPU attribute arrays `writeStructureInstances` fills, sized
 *  (by the caller) to at least the structure type's own per-type capacity. */
export interface StructureInstanceBuffers {
  /** xyz triples, world space. */
  positions: Float32Array;
  /** Battered-building alpha, one per instance. */
  alphas: Float32Array;
}

/**
 * Per-instance GPU attributes for every placement this frame -- the pure
 * half of `StructureInstancer.update`, callable with no `THREE.InstancedMesh`
 * at all. `placements` is whatever `liveStructurePlacements`/
 * `deadStructurePlacements` returned; unlike `writeUnitInstances` there is no
 * `visible` flag to filter on here (a structure has no roof-slot cap the way
 * a garrisoned occupant does), so every placement handed in is written.
 */
export function writeStructureInstances(
  placements: readonly StructurePlacement[],
  out: StructureInstanceBuffers
): number {
  let count = 0;
  for (const p of placements) {
    out.positions[count * 3] = p.fx;
    out.positions[count * 3 + 1] = p.worldY;
    out.positions[count * 3 + 2] = p.fy;
    out.alphas[count] = p.alpha;
    count++;
  }
  return count;
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
