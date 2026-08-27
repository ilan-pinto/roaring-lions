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
 * at into a real `THREE.DataArrayTexture`. That is I/O (`fetch`, image
 * decode, a 2D canvas) and cannot be tested headlessly, so it is a separate function
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
 * ## The capacity check is real, not decorative -- and not frozen to one machine
 *
 * WebGL2 requires `MAX_ARRAY_TEXTURE_LAYERS >= 256` -- a real floor some
 * conformant GPU could sit at, and 272 does not clear it. `MAX_ARRAY_LAYERS`
 * below (2048) is not a guess: it was measured directly against this dev
 * machine (Chrome/ANGLE, ANGLE Metal Renderer: Apple M3 Pro) via
 * `gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)`, and 2048 is the number
 * virtually every real WebGL2 implementation converges on (the limit is tied
 * to `MAX_3D_TEXTURE_SIZE`, which the same query reports as 2048 here too).
 * But it is still one machine's number baked into source, and `packSheet`
 * cannot do better than that on its own -- it is pure, by design, and has no
 * GPU to ask. So the budget is a `packSheet` *parameter*, defaulting to
 * `MAX_ARRAY_LAYERS` so every existing caller (and every test) gets that
 * measured baseline for free, while `buildUnitTexture` -- the one function
 * in this file that runs somewhere a GL context actually exists -- queries
 * the real device's `MAX_ARRAY_TEXTURE_LAYERS` and fails loudly, by sheet and
 * by number, if the packing it was handed needs more layers than the actual
 * hardware under the player offers. That closes the gap between "measured on
 * my machine" and "true on theirs" without asking `packSheet` to stop being
 * pure and testable.
 *
 * `packSheet` still throws before packing a single frame if a sheet exceeds
 * whatever budget it was given -- wrapping the layer counter instead would
 * make two unrelated frames decode into the same layer, silent data
 * corruption dressed as success. See `packSheet`'s own comment.
 *
 * **What happens if the diagnostic ever actually fires, on real hardware at
 * the 256-layer floor:** *not* splitting one unit type's frames across two
 * `DataArrayTexture`s, and *not* shrinking `FRAME_PX`. A device that sits at
 * WebGL2's bare floor is an old Android ES3 part, and that hardware cannot
 * hold a multi-hundred-megabyte sprite working set regardless of how it is
 * packed -- VRAM binds before layer count does. Splitting into two textures
 * saves zero bytes (same pixels, same count) and only reduces descriptor
 * count, while forfeiting the one-draw-call-per-unit-type this whole module
 * exists for. The documented mitigation, if this ever needs one: load only
 * the clips a mission's roster actually uses (already possible -- `packSheet`
 * is per-clip already, and every shipped sheet's *idle-only* frame count is
 * far under 256). Not built here -- nothing in this task's scope, or any
 * shipped mission, needs it yet.
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
 * Frame size for a *unit* sheet -- `SheetSpec`, the only shape this module
 * accepts. Every unit sheet ships 256px square (checked directly across
 * every `assets/sprites/*\/manifest.json` with a `facings` field; also
 * CLAUDE.md's own measurement, "3,101 PNGs at 256 px"). That is NOT
 * universal across everything this game ships: seven `BLD_*` structure
 * sheets declare `"size": 512` in their own manifest. Structures are out of
 * reach for this module regardless -- they parse to `StructureSpec` via
 * `parseStructureManifest`, a single-frame shape `packSheet` cannot accept,
 * and no code path here or elsewhere hands one to it. `SheetSpec`
 * (deliberately) does not carry a size field at all: it is a property of the
 * files, `parseManifest` drops the manifest's own `"size"` rather than
 * threading it through, and `frameFileName` needs no pixel size to resolve a
 * name. So 256 is a constant here for the shapes this module actually
 * handles, not a reimplementation of something `SheetSpec` could report
 * instead -- and `buildUnitTexture` still validates every decoded bitmap
 * against it, throwing loudly on a mismatch rather than mis-packing a
 * wrong-sized frame into a 256-sized layer.
 */
export const FRAME_PX = 256;

/**
 * `packSheet`'s default `DataArrayTexture` layer budget, and the number
 * `buildUnitTexture` falls back to if it cannot reach a WebGL2 context at
 * all. See this file's top comment for how it was measured, why it is a
 * default rather than a hard ceiling, and the risk it does not eliminate
 * (WebGL2's spec floor is 256, not 2048).
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

/**
 * A counting semaphore: at most `limit` holders at once, sharing one queue
 * across every `acquire()` call on the same instance -- not one queue per
 * caller. That "shared across callers" property is exactly what
 * `buildUnitTexture`'s frame-fetch throttling needs (see its module-level
 * `fetchSlots` instance below): `main.ts` runs ~30 unit types' worth of
 * `buildUnitTexture` calls in parallel, and a limiter reset per call would
 * still let each of those 30 calls open its own `limit` connections --
 * `30 * limit` total, the exact compounding this class exists to prevent.
 *
 * No `fetch`, no DOM, no timers -- just `Promise`/array bookkeeping -- so
 * it is genuinely pure and testable under `environment: 'node'`, unlike the
 * I/O it is used to throttle below. `acquire()` resolves immediately while
 * a slot is free; once the limit is reached, callers queue in FIFO order
 * and each `release()` wakes exactly the next one.
 */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.available--;
        resolve();
      });
    });
  }

  /** Always call from a `finally`, so a holder that throws still frees its
   *  slot -- otherwise one failure stalls every caller queued behind it,
   *  forever, which is worse than the burst this class exists to prevent. */
  release(): void {
    this.available++;
    const next = this.queue.shift();
    if (next) next();
  }
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
 * Calling this twice on an equal `sheet` (and equal `maxLayers`) produces
 * byte-identical output.
 *
 * `maxLayers` defaults to `MAX_ARRAY_LAYERS` -- a real measurement (see the
 * top-of-file comment), but one machine's, and `packSheet` has no GPU to ask
 * for a better one; it stays a parameter rather than a hardcoded constant so
 * a caller that *can* ask (`buildUnitTexture`, or any future caller with a
 * live GL context) is able to hand this the real device limit instead.
 *
 * Throws before packing a single frame if the sheet needs more layers than
 * `maxLayers` holds. The alternative -- wrapping the layer counter -- would
 * make two unrelated frames decode into the same layer, which is silent data
 * corruption dressed as success: the sheet would "load" and one unit type
 * would render a stranger's frame over its own. Throwing turns that into a
 * load-time error naming the sheet's own frame count and the budget it
 * missed, instead of a rendering bug reported days later as "the militia
 * sometimes looks like the RPG team."
 */
export function packSheet(sheet: SheetSpec, maxLayers: number = MAX_ARRAY_LAYERS): FramePacking {
  const total = totalFrames(sheet);
  if (total > maxLayers) {
    throw new Error(
      `packSheet: sheet needs ${total} frames (${sheet.facings} facings x ` +
        `${Object.keys(sheet.clips).length} clips), which exceeds the ${maxLayers}-layer ` +
        'DataArrayTexture budget (see atlas.ts for how that budget was measured, and the ' +
        'documented mitigation if this is a real device limit rather than a test).'
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

/**
 * This device's real `DataArrayTexture` layer budget, or `null` if no WebGL2
 * context can be reached at all. `MAX_ARRAY_LAYERS` is one machine's
 * measurement baked into source; this is the actual number for whatever GPU
 * is under the browser the game is running in, gathered the only place this
 * module can reach a GL context to ask. A throwaway canvas is enough --
 * querying a driver limit does not need `ThreeRenderer`'s own context, and
 * this module has no access to that context anyway (its exports take
 * `basePath`/`sheet`/`packing`, not a renderer). Cached after the first call
 * so loading a mission's dozen unit types does not open a dozen contexts to
 * ask the same driver the same question.
 */
let deviceArrayLayerLimit: number | null | undefined;
function queryArrayLayerLimit(): number | null {
  if (deviceArrayLayerLimit === undefined) {
    // try/catch, not just a null check: `getContext` RETURNS null on a browser
    // that merely lacks WebGL2, but THROWS on one that has blocked or
    // blacklisted the GPU. Letting that throw escape would surface an
    // unattributable error out of `buildUnitTexture` -- a diagnostic crashing
    // on exactly the hardware it exists to diagnose, which is worse than the
    // frozen constant it replaced. Either way we degrade to null and skip the
    // check, falling back to the packed default.
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = document.createElement('canvas').getContext('webgl2');
    } catch {
      gl = null;
    }
    deviceArrayLayerLimit = gl ? (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number) : null;
    // Hand the slot back. Chrome caps live contexts at roughly 16 and evicts
    // the oldest, so holding one forever to answer a question already cached
    // above is a slot taken from the renderer for nothing.
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return deviceArrayLayerLimit;
}

/**
 * How many frame fetches this module allows in flight at once, *shared
 * across every concurrent `buildUnitTexture` call* via the one `fetchSlots`
 * instance below -- not one budget per call. `main.ts` loads a mission's
 * roster (~30 unit types) with their `buildUnitTexture` calls running in
 * parallel, and the largest sheets are 272 frames; the original shape here
 * was a per-call `Promise.all` over `decodeFrame` with no throttle at all,
 * issuing all 272 `fetch()`s for one sheet at once with nothing stopping 30
 * sheets from doing that simultaneously -- up to ~8,000 concurrent requests
 * from one page load. Task B3.5 hit this directly: genuine `503`s and fetch
 * failures for a shifting subset of unit types on each reload, with units
 * silently missing from the mission and no error naming which sheet or file
 * was responsible.
 *
 * 6 is not a round number picked for tidiness -- it is Chrome's (and
 * Firefox's and Safari's) own default maximum simultaneous HTTP/1.1
 * connections per origin. Throttling above that number buys nothing: those
 * extra requests would queue inside the browser's own connection pool
 * regardless of how many this module hands it at once. Throttling *to* that
 * number keeps this module from ever handing the browser (and whatever is
 * serving `basePath`) a burst larger than the browser was ever going to
 * service concurrently in the first place -- so the fix costs no real
 * wall-clock parallelism, only the burst. A per-call limiter (a fresh
 * `Semaphore` inside `buildUnitTexture` itself) would not fix this: 30
 * concurrent calls would each open their own 6 connections, 180 total,
 * exactly the compounding this exists to prevent -- so `fetchSlots` is one
 * instance at module scope, shared for the process's lifetime, the same
 * sharing `deviceArrayLayerLimit` above already relies on.
 */
const FETCH_CONCURRENCY = 6;
const fetchSlots = new Semaphore(FETCH_CONCURRENCY);

/**
 * Fetch one packed frame's PNG and decode it to a bitmap, queued behind
 * `fetchSlots` so this call cannot itself contribute to the burst it exists
 * to prevent.
 *
 * Takes the `PackedFrame` itself, not a bare URL, so a failure -- a `fetch`
 * rejection (typically an opaque `TypeError: Failed to fetch`, naming
 * neither sheet nor file), a non-ok status, or a decode error from a
 * truncated/corrupt PNG -- can be rethrown naming the sheet (`basePath`) and
 * exactly which `(clip, facing, frame)` it was. That is the same principle
 * the device-limit diagnostic above applies to capacity, applied here to
 * loading: a named, attributable failure instead of a rejection a caller
 * cannot trace back to a unit type.
 */
async function decodeFrame(basePath: string, entry: PackedFrame): Promise<ImageBitmap> {
  const url = `${basePath}${entry.file}`;
  const where = `${basePath} clip "${entry.clip}" facing ${entry.facing} frame ${entry.frame} (${url})`;
  await fetchSlots.acquire();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`buildUnitTexture: ${res.status} fetching ${where}`);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('buildUnitTexture:')) throw err;
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`buildUnitTexture: failed to fetch or decode ${where}: ${cause}`);
  } finally {
    fetchSlots.release();
  }
}

/**
 * Decode a sheet's frames into one `DataArrayTexture`, per `packing`.
 *
 * Every PNG decodes concurrently (`Promise.all` over `decodeFrame`), bounded
 * by the shared `FETCH_CONCURRENCY` slot pool rather than truly unthrottled
 * -- 272 sequential round trips would be a visible stall on first load, the
 * exact problem `renderer.ts:loadSprites`'s own comment on parallel facing
 * loads already names, but 272 (or 30 sheets' worth) genuinely simultaneous
 * requests is the burst `FETCH_CONCURRENCY`'s own comment describes. The 2D
 * canvas that turns each bitmap into raw RGBA bytes is reused sequentially
 * after decoding, deliberately: `CanvasRenderingContext2D` is stateful, and
 * drawing two bitmaps into it concurrently would race.
 *
 * `sheet` is cross-checked against `packing` before doing any of that work --
 * a `packing` built from a different sheet is a caller bug (wrong pairing
 * passed in), and decoding 272 files only to write them into a
 * differently-shaped layout would fail confusingly, deep inside the pixel
 * copy, instead of immediately and by name.
 *
 * The real device's `MAX_ARRAY_TEXTURE_LAYERS` (`queryArrayLayerLimit`) is
 * checked here too, before any decode work starts: `packing` may have been
 * built with `packSheet`'s default budget (one machine's measurement), and
 * this is the first place in the pipeline that can ask the *actual* GPU
 * whether it can hold that many layers. Failing here, by `basePath` and by
 * number, turns "silently broken on unknown hardware" into a loud,
 * attributable error instead of a texture that fails to upload three steps
 * later with no indication which sheet was responsible.
 */
export async function buildUnitTexture(
  basePath: string,
  sheet: SheetSpec,
  packing: FramePacking
): Promise<THREE.DataArrayTexture> {
  const expected = totalFrames(sheet);
  if (packing.entries.length !== expected) {
    throw new Error(
      `buildUnitTexture: packing has ${packing.entries.length} frames but sheet declares ${expected} -- ` +
        'this packing was not built from this sheet (pass the same SheetSpec to both packSheet and buildUnitTexture).'
    );
  }

  const deviceLimit = queryArrayLayerLimit();
  if (deviceLimit !== null && packing.layers > deviceLimit) {
    throw new Error(
      `buildUnitTexture: ${basePath} needs ${packing.layers} DataArrayTexture layers, which exceeds this ` +
        `device's real MAX_ARRAY_TEXTURE_LAYERS of ${deviceLimit}. See atlas.ts's top comment for the ` +
        'documented mitigation (load only the clips this mission actually uses) -- not built here.'
    );
  }

  const { frameSize, layers } = packing;
  const bitmaps = await Promise.all(
    packing.entries.map((entry) => decodeFrame(basePath, entry))
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
  // Set explicitly rather than left at `DataArrayTexture`'s own default
  // (`false`, verified against 0.170's source -- see `unitBillboardGeometry`'s
  // own uv comment in `instances.ts`, which this texture's row-0-at-v-0
  // convention depends on). A three.js version bump could change that
  // default without this codebase noticing until units render upside down --
  // Phase B3.7 hit exactly that failure mode for structures (a plain
  // `THREE.Texture`, whose default genuinely is `true`), caught only by
  // looking at the screen, because every headless signal (this file's own
  // `atlas.test.ts`, `instances.test.ts`'s winding/uv assertions) reads
  // correct either way -- neither can see what a real GPU actually samples.
  // Structures now set this explicitly for the same reason
  // (`loadStructureFrame`'s own comment); this closes the same gap here.
  texture.flipY = false;
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
