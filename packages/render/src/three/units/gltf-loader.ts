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
import { GLTFLoader, type GLTF, type GLTFLoaderPlugin } from 'three/addons/loaders/GLTFLoader.js';
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
  if (decoderPath !== null) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(decoderPath);
    dracoLoader.setWorkerLimit(
      Math.max(1, Math.min(DRACO_WORKERS, globalThis.navigator?.hardwareConcurrency ?? DRACO_WORKERS))
    );
    shared.setDRACOLoader(dracoLoader);
  }
  return shared;
}

/** Tears down the decoder's worker pool. `ThreeRenderer.dispose` calls it. */
export function disposeGltfLoader(): void {
  dracoLoader?.dispose();
  dracoLoader = null;
  shared = null;
}

/** Whether a Draco decoder is attached -- read by `gltf-loader.test.ts`, and
 *  the honest answer to "will a compressed GLB parse right now". */
export function hasDracoDecoder(): boolean {
  return gltfLoader().dracoLoader !== null && gltfLoader().dracoLoader !== undefined;
}
