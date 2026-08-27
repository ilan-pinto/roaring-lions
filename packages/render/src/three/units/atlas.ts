/**
 * Task B3.4: one GPU texture per unit type.
 *
 * `sheet.ts` already knows a unit sheet's own conventions -- facings, clips,
 * frame counts, file names -- and is pure and tested. This module answers
 * the one question `sheet.ts` deliberately leaves open: *where in a texture*
 * does each `(clip, facing, frame)` land. `packSheet` is that decision, and
 * nothing else -- arithmetic over plain numbers, callable with no DOM, no
 * GPU and no file I/O, so it runs in this package's `environment: 'node'`
 * test suite exactly like the terrain builders in `../terrain/`.
 *
 * `buildUnitTexture` is the other half: decode the PNGs `packSheet` pointed
 * at into a real `THREE.Texture`. That is I/O (`fetch`, image decode, a 2D
 * canvas) and cannot be tested headlessly, so it is a separate function
 * rather than a branch inside `packSheet` -- the same split `ground.ts`
 * (pure) and `mesh.ts` (`toGeometry`, GPU-facing) draw for terrain, just
 * kept in one file here because this task creates only `atlas.ts`.
 *
 * ## Why a `DataArrayTexture`, not a 2D atlas
 *
 * The task's ruling is "one texture per unit type" (CLAUDE.md / the B3
 * brief's ruling 1) -- a single `InstancedMesh` per unit type reading one
 * texture, one draw call. The largest shipped sheet, `INF_SQUAD` (and
 * `INF_RPG`/`INF_MILITIA`/`INF_DEMO`/`INF_AT`, all the same shape: 16
 * facings x (10 idle + 4 move + 1 fire + 1 down + 1 wreck) = 272 frames),
 * already rules out a square 2D atlas at the common 4096px hardware ceiling:
 * `ceil(sqrt(272)) = 17`, and `17 * 256 = 4352 > 4096`. A `DataArrayTexture`
 * -- one 256x256 layer per frame, sampled in a shader as `sampler2DArray`
 * (WebGL2, which this project already requires for `MAX_ARRAY_TEXTURE_LAYERS`
 * itself) -- sidesteps the 2D packing problem entirely and stays one texture
 * object regardless of frame count, so "one texture per unit type" stays
 * literally true rather than becoming "one texture, unless it's the big one."
 *
 * ## The capacity check is real, not decorative
 *
 * WebGL2 requires `MAX_ARRAY_TEXTURE_LAYERS >= 256` -- a real floor some
 * conformant GPU could sit at, and 272 does not clear it. Measured directly
 * against this dev machine (Chrome/ANGLE, ANGLE Metal Renderer: Apple M3
 * Pro) rather than assumed: `gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)`
 * returns 2048, which is the number virtually every real WebGL2
 * implementation converges on (`MAX_ARRAY_TEXTURE_LAYERS` is tied to
 * `MAX_3D_TEXTURE_SIZE`, which the same query reports as 2048 here too).
 * `MAX_ARRAY_LAYERS` below is pinned to that measured, realistic number, and
 * `packSheet` throws rather than silently overlapping two frames onto one
 * layer if a sheet ever needs more -- see `packSheet`'s own comment. The
 * spec-floor risk (a hypothetical GPU at exactly 256) is not eliminated by
 * this choice; it is a known, reported limitation, not a silent one.
 *
 * ## VRAM: parity with Pixi, not a regression
 *
 * `renderer.ts:loadSprites` already loads every frame of a used unit type as
 * its own individual `Texture` via `Assets.load`, at native 256x256, with no
 * mipmap generation configured anywhere in this codebase. That is the same
 * bytes this module uploads: 272 layers x 256x256 x 4 bytes (RGBA8, no
 * mipmaps) ~= 71 MB for the worst-case shipped sheet, on both backends,
 * because both backends decode the exact same PNGs at the exact same
 * resolution into the exact same pixel format. A `DataArrayTexture` is not
 * cheaper than Pixi's per-frame textures (same raw pixels either way) but it
 * is not more expensive either -- the only Pixi cost this module does not
 * pay is per-texture GPU object overhead (one descriptor instead of 272),
 * which is a saving, not a cost. `generateMipmaps` stays off here to hold
 * that parity; turning it on would cost ~33% more VRAM than Pixi's baseline
 * for a benefit (trilinear minification) Pixi does not provide today either.
 */
import * as THREE from 'three';
import { frameFileName, type ClipName, type SheetSpec } from '../../sheet';

/**
 * Every shipped sprite frame is 256px square (`assets/sprites/**\/manifest.json`
 * -> `"size": 256`, and CLAUDE.md's own measurement: "3,101 PNGs at 256 px").
 * `SheetSpec` (deliberately) does not carry this -- it is a property of the
 * files, and `frameFileName` needs no pixel size to resolve a name. This
 * module needs one to reason about capacity and to validate what it decodes,
 * so it is a constant here rather than a fourth reimplementation of "256".
 */
export const FRAME_PX = 256;

/**
 * `DataArrayTexture` layer budget. See this file's top comment for how this
 * number was measured rather than assumed, and its risk (WebGL2's spec floor
 * is 256, not 2048).
 */
export const MAX_ARRAY_LAYERS = 2048;

/** Canonical clip order, matching `ClipName`'s own declaration in `sheet.ts`.
 *  Fixed here rather than derived from `Object.keys(sheet.clips)` so packing
 *  order cannot depend on a `Partial<Record<...>>`'s incidental insertion
 *  order -- that would still be *a* stable order in practice, but "in
 *  practice" is exactly the kind of stability this module's own test suite
 *  is required to prove, not assume. */
const CLIP_ORDER: readonly ClipName[] = ['idle', 'move', 'fire', 'down', 'wreck', 'work'];

/**
 * Where one packed frame lives in the array texture.
 *
 * `x`/`y`/`width`/`height` are always `0, 0, FRAME_PX, FRAME_PX` today --
 * every frame owns a whole layer, never a sub-rect of one -- but the shape
 * is kept general rather than collapsed to a bare layer number so a genuine
 * rectangle-overlap check (`atlas.test.ts`) is exercising real geometry, not
 * merely asserting a set of integers has no duplicates. If a future sheet
 * ever needed sub-layer packing (a 2D atlas page per layer, say), this type
 * would not need to change.
 */
export interface FrameRegion {
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One packed `(clip, facing, frame)`, with the file `buildUnitTexture` reads
 *  it from and the region it decodes into. */
export interface PackedFrame {
  clip: ClipName;
  facing: number;
  frame: number;
  file: string;
  region: FrameRegion;
}

/** `packSheet`'s output: every frame the sheet declares, packed, plus a
 *  lookup by `(clip, facing, frame)` for callers that want one triple rather
 *  than the whole table. */
export interface FramePacking {
  /** Pixel size of one frame/layer (always `FRAME_PX` today). */
  frameSize: number;
  /** Total `DataArrayTexture` depth this sheet needs. */
  layers: number;
  /** Every packed frame, in packing order. What `buildUnitTexture` decodes
   *  against -- it never recomputes a `(clip, facing, frame)` -> region
   *  mapping of its own. */
  entries: readonly PackedFrame[];
  /** The region for one `(clip, facing, frame)`. Throws if the sheet does
   *  not declare that triple, the same "fail loudly" stance `packSheet`
   *  itself takes on capacity -- a caller asking for an unpacked frame is a
   *  bug, not a case to paper over with a default. */
  regionFor(clip: ClipName, facing: number, frame: number): FrameRegion;
}

function key(clip: ClipName, facing: number, frame: number): string {
  return `${clip}:${facing}:${frame}`;
}

/** Total frames a sheet declares, summed across every clip it has, in
 *  `CLIP_ORDER`. Shared by `packSheet` (the capacity check) and
 *  `buildUnitTexture` (checking a `packing` was actually built from the
 *  `sheet` passed alongside it). */
function totalFrames(sheet: SheetSpec): number {
  let total = 0;
  for (const clip of CLIP_ORDER) {
    const spec = sheet.clips[clip];
    if (spec) total += sheet.facings * spec.frames;
  }
  return total;
}

/**
 * Decide where every `(clip, facing, frame)` a sheet declares lands in a
 * `DataArrayTexture` -- one layer per frame, assigned in `CLIP_ORDER` then
 * ascending facing then ascending frame, so the mapping is a pure function
 * of the sheet's own declared shape and nothing external (no `Math.random`,
 * no clock, no incidental object-key order -- see `CLIP_ORDER`'s comment).
 * Calling this twice on an equal `sheet` produces byte-identical output.
 *
 * Throws before packing a single frame if the sheet needs more layers than
 * `MAX_ARRAY_LAYERS` holds. The alternative -- wrapping the layer counter --
 * would make two unrelated frames decode into the same layer, which is
 * silent data corruption dressed as success: the sheet would "load" and one
 * unit type would render a stranger's frame over its own. Throwing turns
 * that into a load-time error pointing at the sheet that needs it, instead
 * of a rendering bug reported days later as "the militia sometimes looks
 * like the RPG team."
 */
export function packSheet(sheet: SheetSpec): FramePacking {
  const total = totalFrames(sheet);
  if (total > MAX_ARRAY_LAYERS) {
    throw new Error(
      `packSheet: sheet needs ${total} frames (${sheet.facings} facings x ` +
        `${Object.keys(sheet.clips).length} clips), which exceeds the ${MAX_ARRAY_LAYERS}-layer ` +
        'DataArrayTexture budget (see atlas.ts for how that budget was measured).'
    );
  }

  const entries: PackedFrame[] = [];
  const byKey = new Map<string, FrameRegion>();
  let layer = 0;
  for (const clip of CLIP_ORDER) {
    const spec = sheet.clips[clip];
    if (!spec) continue;
    for (let facing = 0; facing < sheet.facings; facing++) {
      for (let frame = 0; frame < spec.frames; frame++) {
        const region: FrameRegion = { layer, x: 0, y: 0, width: FRAME_PX, height: FRAME_PX };
        const file = frameFileName(sheet, clip, facing, frame);
        entries.push({ clip, facing, frame, file, region });
        byKey.set(key(clip, facing, frame), region);
        layer++;
      }
    }
  }

  return {
    frameSize: FRAME_PX,
    layers: layer,
    entries,
    regionFor(clip, facing, frame) {
      const region = byKey.get(key(clip, facing, frame));
      if (!region) {
        throw new Error(`packSheet: no packed region for clip "${clip}" facing ${facing} frame ${frame}`);
      }
      return region;
    },
  };
}

// ---------------------------------------------------------------------------
// Everything below this line is I/O: it fetches, decodes and draws to a 2D
// canvas to get raw pixels, none of which exists in `environment: 'node'`.
// Nothing above this line may be called from here in the other direction --
// `packSheet` never reaches into `buildUnitTexture` -- but `buildUnitTexture`
// consuming `packSheet`'s pure output is exactly the boundary the brief asks
// for: the decision is arithmetic and tested; the decode is I/O and is not.
// ---------------------------------------------------------------------------

/** Fetch one frame's PNG and decode it to a bitmap. Separated out so the
 *  parallel `Promise.all` in `buildUnitTexture` reads as "decode every file
 *  concurrently" rather than an inline `fetch`/`blob`/`createImageBitmap`
 *  chain repeated at the call site. */
async function decodeFrame(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`buildUnitTexture: ${res.status} fetching ${url}`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

/**
 * Decode a sheet's frames into one `DataArrayTexture`, per `packing`.
 *
 * Every PNG decodes in parallel (`Promise.all` over `decodeFrame`) -- 272
 * sequential round trips would be a visible stall on first load, the exact
 * problem `renderer.ts:loadSprites`'s own comment on parallel facing loads
 * already names. The 2D canvas that turns each bitmap into raw RGBA bytes is
 * reused sequentially after that, deliberately: `CanvasRenderingContext2D`
 * is stateful, and drawing two bitmaps into it concurrently would race.
 *
 * `sheet` is cross-checked against `packing` before doing any of that work --
 * a `packing` built from a different sheet is a caller bug (wrong pairing
 * passed in), and decoding 272 files only to write them into a
 * differently-shaped layout would fail confusingly, deep inside the pixel
 * copy, instead of immediately and by name.
 */
export async function buildUnitTexture(
  basePath: string,
  sheet: SheetSpec,
  packing: FramePacking
): Promise<THREE.Texture> {
  const expected = totalFrames(sheet);
  if (packing.entries.length !== expected) {
    throw new Error(
      `buildUnitTexture: packing has ${packing.entries.length} frames but sheet declares ${expected} -- ` +
        'this packing was not built from this sheet (pass the same SheetSpec to both packSheet and buildUnitTexture).'
    );
  }

  const { frameSize, layers } = packing;
  const bitmaps = await Promise.all(
    packing.entries.map((entry) => decodeFrame(`${basePath}${entry.file}`))
  );

  const canvas = document.createElement('canvas');
  canvas.width = frameSize;
  canvas.height = frameSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('buildUnitTexture: 2D canvas context unavailable');

  const data = new Uint8Array(frameSize * frameSize * 4 * layers);
  for (let i = 0; i < packing.entries.length; i++) {
    const entry = packing.entries[i];
    const bitmap = bitmaps[i];
    if (bitmap.width !== frameSize || bitmap.height !== frameSize) {
      throw new Error(
        `buildUnitTexture: ${basePath}${entry.file} is ${bitmap.width}x${bitmap.height}, expected ` +
          `${frameSize}x${frameSize}`
      );
    }
    ctx.clearRect(0, 0, frameSize, frameSize);
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, frameSize, frameSize).data;
    data.set(pixels, entry.region.layer * frameSize * frameSize * 4);
    bitmap.close();
  }

  const texture = new THREE.DataArrayTexture(data, frameSize, frameSize, layers);
  // No colour-space tag: `palette-material.ts`'s `applyPalettePipeline` sets
  // `renderer.outputColorSpace` to a pass-through (`LinearSRGBColorSpace`),
  // deliberately, so vertex colours reach the framebuffer byte-identical to
  // `data/palette.json`. Tagging this texture `SRGBColorSpace` would make
  // three.js decode it in the shader with nothing downstream to re-encode --
  // the exact double-transform Phase 0 measured at zero-of-65 palette
  // colours for the terrain path. Leaving `colorSpace` at its `NoColorSpace`
  // default keeps sampled sprite bytes passing through unchanged, matching
  // how Pixi displays the same PNGs today.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
