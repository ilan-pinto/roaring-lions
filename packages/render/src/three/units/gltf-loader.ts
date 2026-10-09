/**
 * The one `GLTFLoader` every mesh in this renderer is parsed through, and the
 * one place the Draco decoder is attached to it.
 *
 * ## Why a shared factory rather than `new GLTFLoader()` at each site
 *
 * Shipped meshes carry `KHR_draco_mesh_compression` since 2026-09-08 (level
 * load time, step 4: `assets/meshes/**.glb`, 75.47 MiB of source down to
 * 25.98 shipped). A `GLTFLoader` with no `DRACOLoader` attached does not
 * degrade on such a file -- it throws
 * `THREE.GLTFLoader: No DRACOLoader instance provided`, and the unit,
 * building or decor family it was loading is simply absent. There were NINE
 * `new GLTFLoader()` call sites when this landed (unit, vehicle, building,
 * decor, three VFX meshes, the campaign board, the soldier spike), and a
 * tenth added later without the decoder would fail exactly that way: loudly,
 * but only for whatever art that one site loads.
 *
 * **This comment used to end "one factory makes forgetting impossible rather
 * than merely unlikely", and that was wrong within a day.** The factory makes
 * forgetting the LOADER impossible; it does nothing about forgetting the
 * DECODER PATH, which is separate state set by whoever owns `BASE`. On
 * 2026-09-08 that was `ThreeRenderer`'s constructor and nowhere else -- so
 * the campaign board, which constructs no `ThreeRenderer`, fetched its
 * diorama, threw `No DRACOLoader instance provided`, and fell back to the
 * flat PNG map. It failed SOFTLY, which is why it reached main with CI
 * green: no gate loads `?campaign` with a real WebGL2 context.
 *
 * There are TWO entry points that must set the path, and the app names them
 * from one place (`mesh-catalogue.ts`'s `dracoDecoderPath`): `main.ts` via
 * `RendererOptions.dracoDecoderPath`, and `ui/menu.ts` via
 * `WorldViewOptions.dracoDecoderPath`. A third would have to be told too --
 * so if you are adding one, that is the thing to remember, and
 * `mountWorldView` warns by name when it is missing rather than letting a
 * fallback swallow the reason.
 *
 * ## The decoder is self-hosted and its path comes from the app
 *
 * `assets/draco/`, copied from the `three` package's own
 * `examples/jsm/libs/draco/gltf/` -- never a CDN, the same rule the fonts
 * follow (CLAUDE.md). `packages/render` cannot know the served base (`BASE`
 * is `/` locally and `/roaring-lions/` on Pages), so `ThreeRenderer` passes
 * it in from `RendererOptions.dracoDecoderPath` and this module holds it.
 * Module-level state rather than a parameter threaded through nine loaders:
 * the decoder is a property of the RUNTIME, not of any one asset.
 *
 * **Only the WebAssembly decoder is shipped** -- `draco_wasm_wrapper.js` (57
 * KB) and `draco_decoder.wasm` (188 KB), fetched once for the whole session
 * and shared by every mesh. `DRACOLoader` falls back to a 500 KB JavaScript
 * decoder when `WebAssembly` is absent, and that file is deliberately not in
 * the repository: this renderer already requires WebGL2, and the only engine
 * version that ever had WebGL2 without WebAssembly is Chrome 56 (January
 * 2017, superseded a month later). On such a browser the fallback 404s with
 * the missing file named in the console, which is a legible failure, and
 * `?renderer=pixi` has no mesh path to lose in the first place.
 *
 * ## Tests parse uncompressed fixtures and need none of this
 *
 * `units/mesh-fixture.ts` and `units/rigid-mesh-fixture.ts` build a GLB by
 * hand and call `parseAsync` on their own `GLTFLoader`. They are deliberately
 * left alone: their bytes are uncompressed by construction, a `DRACOLoader`
 * would need a decoder fetch inside a `node` test environment that has no
 * network, and the thing they exist to exercise is this renderer's own
 * contract reading rather than glTF transport.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF, type GLTFLoaderPlugin, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * GH-469 saving 1: free a GLB texture's CPU copy once the GPU has it.
 *
 * `GLTFLoader` decodes every texture into an `ImageBitmap` and three keeps it
 * as `texture.image` for the texture's whole life, so every GLB texture was
 * held TWICE -- once on the GPU, once decoded in the page's own process.
 * `pnpm perf:memory` measured the second copy at 440 MiB on the heaviest
 * mission and 184 MiB behind the menu (docs/PERFORMANCE.md, "Memory").
 *
 * `onUpdate` is three's own after-upload callback (`WebGLTextures`, called
 * once the pixels are in the GL texture), so this closes the bitmap the
 * moment it has been copied and never earlier. Its dimensions are kept on
 * `userData.rlReleasedImage` for anything that still wants to know the size
 * (`memory-inventory.ts`).
 *
 * What it trades away is RE-upload: a texture whose source is bumped
 * (`needsUpdate = true`) after release, or a second texture over the same
 * `Source` with different sampling parameters, would upload a closed bitmap
 * and draw black. Nothing in this renderer does either -- materials are
 * cloned, textures are shared by reference, and `prepareTexturedMap` sets its
 * parameters before the first draw -- and both cases are made LOUD rather than
 * silent: an upload that finds the bitmap already closed logs an error naming
 * the texture. Each renderer parses its own GLBs (`GLTFParser`'s texture cache
 * is per file and `THREE.Cache` is off), so one renderer's upload never
 * releases another renderer's texture.
 */
export const RELEASED_IMAGE_KEY = 'rlReleasedImage';

interface Closable {
  readonly width: number;
  readonly height: number;
  close(): void;
}

function isClosable(v: unknown): v is Closable {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { close?: unknown }).close === 'function' &&
    typeof (v as { width?: unknown }).width === 'number'
  );
}

/** Arm one texture: close its bitmap after its first upload. Idempotent. */
export function releaseImageAfterUpload(texture: THREE.Texture): void {
  if (!isClosable(texture.image) || texture.userData[RELEASED_IMAGE_KEY] !== undefined) return;
  const previous = texture.onUpdate;
  const t = texture;
  texture.onUpdate = (): void => {
    previous?.call(t);
    const img: unknown = t.image;
    const released = t.userData[RELEASED_IMAGE_KEY] as { width: number; height: number } | undefined;
    if (released && released.width > 0 && isClosable(img) && img.width === 0) {
      console.error(
        `[render] texture "${t.name || t.uuid}" was uploaded again after its CPU copy was released -- it will draw black`
      );
      return;
    }
    if (!isClosable(img) || img.width === 0) return;
    t.userData[RELEASED_IMAGE_KEY] = { width: img.width, height: img.height };
    img.close();
  };
  texture.userData[RELEASED_IMAGE_KEY] = null;
}

/** Every texture any material under `root` references, armed once. */
export function releaseImagesAfterUpload(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) releaseImageAfterUpload(v);
    }
  });
}

/** The loader plugin that arms every texture of every GLB this loader parses. */
export const RELEASE_IMAGES_PLUGIN = 'RL_release_images_after_upload';
function releaseImagesPlugin(): GLTFLoaderPlugin {
  return {
    name: RELEASE_IMAGES_PLUGIN,
    afterRoot: async (result: GLTF): Promise<void> => {
      for (const scene of result.scenes) releaseImagesAfterUpload(scene);
    },
  };
}

/**
 * GH-469 saving 2: COLD textures -- a GLB whose geometry is parsed now and
 * whose pictures are decoded only when something is about to draw them.
 *
 * `pnpm perf:memory` found 532 MiB of decoded GLB textures on the heaviest
 * mission that nothing had ever drawn: every building type's WRECK (loaded
 * after the first frame, shown only when one collapses) and every KDF
 * buildable the player has not ordered (deferred past deploy on a
 * `resources` mission). `coldGltfLoader()` parses those GLBs exactly as
 * `gltfLoader()` does except that each embedded image is kept ENCODED -- its
 * PNG/JPEG bytes as a `Blob`, a few hundred KiB -- and the texture's source
 * holds a 1x1 placeholder. `warmColdTextures(root)` decodes them, with the
 * very `createImageBitmap` options three's own `ImageBitmapLoader` uses
 * (`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`), so a warmed
 * texture is byte-for-byte the picture the hot path would have produced.
 *
 * A cold texture must never be DRAWN: three would upload the 1x1 placeholder
 * into immutable storage. The renderer guarantees that (`ThreeRenderer`'s
 * `templateCold` guards); this module only answers "is this cold" and
 * "warm it", and an upload of a still-cold texture logs an error by name.
 */
const coldSources = new WeakMap<THREE.Source, Blob>();

/** Hold `texture`'s pixels encoded as `blob` until `warmColdTextures`. The
 *  cold plugin's one write; exported so tests can build a cold template. */
export function markColdTexture(texture: THREE.Texture, blob: Blob): void {
  coldSources.set(texture.source, blob);
}

/** Whether this texture's pixels are still encoded. */
export function isColdTexture(t: THREE.Texture): boolean {
  return coldSources.has(t.source);
}

function texturesUnder(root: THREE.Object3D): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) out.add(v);
    }
  });
  return [...out];
}

/** Whether any material under `root` still has an encoded texture. */
export function hasColdTextures(root: THREE.Object3D): boolean {
  return texturesUnder(root).some(isColdTexture);
}

export type ImageDecoder = (blob: Blob) => Promise<ImageBitmap>;

/** three's `ImageBitmapLoader` options, verbatim (`ImageBitmapLoader.js`). */
const decodeLikeThree: ImageDecoder = (blob) =>
  createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });

/**
 * Decode every cold texture under `root`, once per source, and mark each
 * texture for upload. Resolves when all are decoded; idempotent, and a source
 * another call is already decoding is not decoded twice.
 */
export async function warmColdTextures(root: THREE.Object3D, decode: ImageDecoder = decodeLikeThree): Promise<void> {
  const textures = texturesUnder(root).filter(isColdTexture);
  const bySource = new Map<THREE.Source, THREE.Texture[]>();
  for (const t of textures) bySource.set(t.source, [...(bySource.get(t.source) ?? []), t]);
  await Promise.all(
    [...bySource].map(async ([source, ts]) => {
      let pending = warming.get(source);
      if (!pending) {
        const blob = coldSources.get(source);
        if (!blob) return;
        pending = decode(blob).then((bitmap) => {
          source.data = bitmap;
          coldSources.delete(source);
        });
        warming.set(source, pending);
      }
      await pending;
      for (const t of ts) {
        t.needsUpdate = true;
        // Saving 1 applies to a warmed texture too: free the decoded copy
        // once the GPU has it.
        releaseImageAfterUpload(t);
      }
    })
  );
}
const warming = new WeakMap<THREE.Source, Promise<void>>();

/** The 1x1 stand-in a cold texture holds until it is warmed. */
function placeholderImage(): unknown {
  return typeof ImageData === 'undefined' ? { width: 1, height: 1 } : new ImageData(1, 1);
}

/**
 * A cold texture over `blob`. Built HERE, at module scope, and not inside the
 * plugin's callbacks, for a measured reason: a closure created in there (the
 * `onUpdate` below) captures the plugin's scope, which holds the PARSER, which
 * holds the whole GLB body -- geometry, images and all. The first cut did
 * exactly that and `pnpm perf:memory` read +30 MiB of ArrayBuffers on the
 * heaviest mission, one retained GLB per cold template.
 */
function coldTexture(blob: Blob): THREE.Texture {
  const t = new THREE.Texture(placeholderImage() as HTMLImageElement);
  markColdTexture(t, blob);
  t.onUpdate = (): void => {
    if (coldSources.has(t.source)) {
      console.error(`[render] cold texture "${t.name || t.uuid}" was uploaded before it was warmed`);
    }
  };
  return t;
}

/** Exported for `gltf-loader.cold.test.ts`: the plugin, against any parser. */
export function coldTexturesPlugin(parser: GLTFParser): GLTFLoaderPlugin {
  return {
    name: COLD_TEXTURES_PLUGIN,
    loadTexture(textureIndex: number): Promise<THREE.Texture> | null {
      const json = parser.json as { textures: { source: number }[]; images: { bufferView?: number }[] };
      const def = json.textures[textureIndex];
      const image = json.images[def.source];
      // Only embedded images; a URI image (none ship) takes the hot path.
      if (image.bufferView === undefined || typeof createImageBitmap === 'undefined') return null;
      const keepEncoded = {
        isImageBitmapLoader: false,
        load(url: string, onLoad: (t: THREE.Texture) => void, _p: unknown, onError: (e: unknown) => void): void {
          // `url` is the blob: URL GLTFParser made from the bufferView, revoked
          // the moment this resolves -- so the bytes are read out first.
          fetch(url)
            .then((r) => r.blob())
            .then((blob) => onLoad(coldTexture(blob)), onError);
        },
      };
      // `loadTextureImage` resolves null only when the image fails to load,
      // which the hot path's own `loadTexture` passes on in exactly this way.
      return parser.loadTextureImage(textureIndex, def.source, keepEncoded as unknown as THREE.Loader) as Promise<THREE.Texture>;
    },
  };
}
export const COLD_TEXTURES_PLUGIN = 'RL_cold_textures';

/**
 * How many decode workers `DRACOLoader` may run, capped at 8.
 *
 * **Three's default is 4 and it is the wrong number for this boot**, which
 * fetches 39 compressed meshes at once behind one `Promise.all`. Measured on
 * `beit_sahwan_1_recon` (production build, `vite preview`, unthrottled, 3
 * runs each, macOS/M3 Pro): first frame lands at **3318-4993 ms** with the
 * default 4, **2751-3289 ms** at 8, and **2787-4170 ms** at 12 -- so the
 * curve flattens at 8 and then loses to contention, which is why the cap is
 * 8 rather than `hardwareConcurrency` outright.
 *
 * The honest framing of what Draco costs: against the same build with
 * uncompressed meshes the first frame was 2252-2622 ms, so 8 workers leaves
 * roughly half a second of decode on an unthrottled localhost -- and buys
 * 20.8 MiB, which on a 20 Mbit/s link is 8.5 s. The trade only looks bad
 * from a machine serving itself off an SSD.
 */
const DRACO_WORKERS = 8;

let decoderPath: string | null = null;
let shared: GLTFLoader | null = null;
let sharedCold: GLTFLoader | null = null;
let dracoLoader: DRACOLoader | null = null;

/**
 * Where `DRACOLoader` fetches `draco_wasm_wrapper.js` and
 * `draco_decoder.wasm` from -- a URL path ending in `/`, supplied by the app
 * because only it knows `BASE`.
 *
 * Call before the first `gltfLoader()`. Calling it again with a different
 * path rebuilds both loaders, which is what makes a renderer constructed
 * twice in one page (the campaign board, then a mission) safe.
 */
export function setDracoDecoderPath(path: string): void {
  if (decoderPath === path) return;
  decoderPath = path;
  disposeGltfLoader();
}

/** The shared loader, with the Draco decoder attached when a path is known.
 *  Built once and reused: `DRACOLoader` keeps a worker pool, and a fresh one
 *  per GLB would spin up a decoder per file. */
export function gltfLoader(): GLTFLoader {
  if (shared) return shared;
  shared = new GLTFLoader();
  shared.register(releaseImagesPlugin);
  const draco = sharedDraco();
  if (draco) shared.setDRACOLoader(draco);
  return shared;
}

/** The same loader, except every embedded texture stays encoded until
 *  `warmColdTextures` (above). Shares the one Draco worker pool. */
export function coldGltfLoader(): GLTFLoader {
  if (sharedCold) return sharedCold;
  sharedCold = new GLTFLoader();
  sharedCold.register(coldTexturesPlugin);
  // A cold texture holds a placeholder, so this arms nothing at parse; a
  // warmed one is armed by `warmColdTextures` once its bitmap lands.
  sharedCold.register(releaseImagesPlugin);
  const draco = sharedDraco();
  if (draco) sharedCold.setDRACOLoader(draco);
  return sharedCold;
}

function sharedDraco(): DRACOLoader | null {
  if (decoderPath === null) return null;
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(decoderPath);
    dracoLoader.setWorkerLimit(
      Math.max(1, Math.min(DRACO_WORKERS, globalThis.navigator?.hardwareConcurrency ?? DRACO_WORKERS))
    );
  }
  return dracoLoader;
}

/** Tears down the decoder's worker pool. `ThreeRenderer.dispose` calls it. */
export function disposeGltfLoader(): void {
  dracoLoader?.dispose();
  dracoLoader = null;
  shared = null;
  sharedCold = null;
}

/** Whether a Draco decoder is attached -- read by `gltf-loader.test.ts`, and
 *  the honest answer to "will a compressed GLB parse right now". */
export function hasDracoDecoder(): boolean {
  return gltfLoader().dracoLoader !== null && gltfLoader().dracoLoader !== undefined;
}
