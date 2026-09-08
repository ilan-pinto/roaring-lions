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
 * but only for whatever art that one site loads. One factory makes forgetting
 * impossible rather than merely unlikely.
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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

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
