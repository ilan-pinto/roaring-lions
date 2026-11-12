// GH-943 WebGPU-primary P0: the bundle census. Pure (chunks in, findings out), so `bundle-census.test.ts` can hand it a constructed
// bad bundle and watch each finding go red; `webgpu-bundle-census.ts` builds the app and feeds it the real `dist/assets`.
//
// What it asserts (design sections 1 and 8, P0):
//   1. three.core is SHARED: exactly one chunk carries it, so the legacy renderer and `three/webgpu` do not each ship a copy.
//   2. three/webgpu lives in its OWN lazy chunk (the node backend's second dynamic import), distinct from core, and the node-backend
//      chunk's preload list names it. A legacy boot never fetches it.
//   3. THE MAIN-CHUNK GUARD: the entry chunk carries no three code (core, WebGPURenderer, WebGLRenderer) and its STATIC import closure
//      reaches none of the three chunks (core, webgpu, tsl, node-backend, the renderer). Plus a size ceiling on the entry AND every
//      chunk it statically imports, summed: what a boot downloads before `main.ts` runs. The bundler is free to hoist modules the
//      entry shares with two or more lazy chunks into a common chunk the entry imports statically (rolldown does, for `@lions/sim`,
//      once a second lazy chunk reads it), so a ceiling on the entry FILE alone could be met by moving nothing off the boot.
//   4. (P2, T1) the material twins' values (`material-maths.ts`) stay out of what a node boot loads statically, and every node
//      material twin lives in the node-backend chunk.

export interface Chunk {
  readonly file: string;
  readonly code: string;
  /** Compressed size, supplied by the driver (gzip); the pure part never compresses. */
  readonly gzipBytes?: number;
}

/** three.core.js's own warning text: present once per copy of three.core. */
export const CORE_MARKER = 'Multiple instances of Three.js';
/** WebGPURenderer's own message prefix: present in the `three/webgpu` entry. */
export const WEBGPU_MARKER = 'THREE.WebGPURenderer';
/** The legacy WebGLRenderer's message prefix. */
export const WEBGL_MARKER = 'THREE.WebGLRenderer';
/** A string only `node-backend.ts` contains. */
export const NODE_BACKEND_MARKER = 'WebGPURenderer chose';
/** TSL's entry: `three/tsl` re-exports `three/webgpu`'s node functions; its own small chunk. */
export const TSL_MARKER = 'tslFn';

/**
 * GH-943 P1 (T2): a string only `post-chain.node.ts` contains (its scene pass's name; pinned against the file in the test). The node
 * twin must land in the node-backend chunk and nowhere else: not the entry, not the shared core, not the legacy renderer chunk.
 */
export const NODE_POST_MARKER = 'rl-node-post-scene';
/**
 * Strings only the legacy composer's shader passes carry (`name:` fields of three's GLSL shaders, which survive minification):
 * `CopyShader` (EffectComposer, UnrealBloomPass), `LuminosityHighPassShader` (the bloom's high pass), `SMAAEdgesShader` (SMAAPass).
 * The node chunk must carry none of them, or a node boot downloads the legacy composer. Several, so that the stock-node twin
 * importing ANY one legacy pass (`bloom.ts` as readily as `SMAAPass`) turns the check red.
 */
export const LEGACY_POST_MARKERS = ['CopyShader', 'LuminosityHighPassShader', 'SMAAEdgesShader'] as const;

/**
 * GH-943 P2 (T1): `material-maths.ts`'s own marker (`MATERIAL_MATHS.marker`; pinned against the file in the test). The app-side
 * values bundle the material twins receive: it gathers maths the LEGACY materials import too, so it belongs with the ThreeRenderer
 * chunk, and a node boot must never load it statically. A twin that VALUE-imports it (instead of receiving it through
 * `NodeBackendOptions.materialMaths`) makes the node-backend chunk import the chunk that holds it, and this goes red.
 */
export const MATERIAL_MATHS_MARKER = 'rl-material-maths';
/**
 * GH-943 P2 (T1): the prefix of every node material twin's `name` (`rl-node-material-ground`, `-ring`, `-foliage`: T3, T5, T6).
 * A twin is a `.node.ts` module: it lives in the node-backend chunk and nowhere else (not the entry, the shared core or the legacy
 * renderer chunk). No twin exists in T1, so the check is armed by the first one to land.
 */
export const NODE_MATERIAL_MARKER = 'rl-node-material-';

/**
 * GH-1223 (design guard 6): a wasm-bindgen export name only Rapier's glue carries (it survives minification: it is the
 * WASM's own export). Rapier must live in exactly ONE chunk, reached only by a dynamic `import()`: never the entry, never
 * anything the entry or any other chunk imports statically. Pinned against the installed package in the test.
 */
export const RAPIER_MARKER = 'rawintegrationparameters_new';

/**
 * GH-1167 S3 (P1): the marker of the node-native 3D grass field (`grass-field.node.ts`, S4; its scene objects are named
 * `rl-grass-field*`, which is what the legacy-scene pin P3 looks for). The field is a `.node.ts` module: it lives in the
 * node-backend chunk and nowhere else (not the entry, the shared core, or the `ThreeRenderer` chunk the legacy path loads).
 * No such file exists in S3, so the check is armed by S4: a bundle with no carrier passes, and a carrier anywhere but the
 * node-backend chunk is red from the day it exists.
 */
export const GRASS_FIELD_MARKER = 'rl-grass-field';

/**
 * GH-1226 S3 (pin L1): the marker of the height-blend field (`terrain/height-blend-field.ts`, S2: `HEIGHT_BLEND_FIELD_MARKER`, the
 * name of its `DataTexture`). The field is node-path only and is loaded by DYNAMIC import from `ThreeRenderer`'s node branch (S5), so
 * it may sit in the node-backend chunk or in a lazy chunk of its own, but never in the entry, its static closure, the shared core,
 * the three/webgpu chunk, or the `ThreeRenderer` chunk the legacy path loads, and no such chunk may import it statically.
 *
 * ARMING: this is vacuously true while the file does not exist, which is why `censusChunks` takes `heightBlendFieldExpected`. The
 * driver passes `existsSync(height-blend-field.ts)`. Once the file is on disk, a bundle with NO carrier is red (the marker moved, or
 * the module is in no chunk because nothing loads it), so the pin cannot go on passing after it stopped looking. S5's dynamic import
 * is what makes the carrier appear; nothing in S4/S5 needs to touch this. The converse is red too: a carrier with no file in the
 * tree is a stale marker or a wrong arming check.
 */
export const HEIGHT_BLEND_FIELD_MARKER = 'rl-height-blend-field';

export interface CensusOptions {
  /** True when `height-blend-field.ts` exists in the source tree: the bundle must then carry `HEIGHT_BLEND_FIELD_MARKER`. */
  readonly heightBlendFieldExpected?: boolean;
}

export interface CensusFindings {
  readonly coreChunks: string[];
  readonly webgpuChunks: string[];
  readonly nodeBackendChunks: string[];
  readonly nodePostChunks: string[];
  readonly legacyPostChunks: string[];
  /** GH-943 P2 (T1): the chunks carrying `MATERIAL_MATHS_MARKER` and `NODE_MATERIAL_MARKER`. */
  readonly materialMathsChunks: string[];
  readonly nodeMaterialChunks: string[];
  /** GH-1223: the chunks carrying `RAPIER_MARKER`. */
  readonly rapierChunks: string[];
  /** GH-1167 S3 (P1): the chunks carrying `GRASS_FIELD_MARKER`. */
  readonly grassFieldChunks: string[];
  /** GH-1226 S3 (L1): the chunks carrying `HEIGHT_BLEND_FIELD_MARKER`. */
  readonly heightBlendFieldChunks: string[];
  readonly entryHasThree: string[];
  /** Chunks reachable from the entry by STATIC imports only. */
  readonly entryStaticClosure: string[];
  /** The size the ceiling is held against: the entry plus every chunk in `entryStaticClosure` (`code.length` each). */
  readonly entryClosureBytes: number;
  readonly failures: string[];
}

/** `import{...}from"./x.js"` and `import"./x.js"` (static), not `import("./x.js")` (dynamic). */
export function staticImports(code: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|[;}\n])\s*(?:import|export)(?:[^"'`;(]*?from)?\s*["'`]\.\/([^"'`]+\.js)["'`]/g;
  for (const m of code.matchAll(re)) out.add(m[1] as string);
  return [...out];
}

/** The `__vite__mapDeps` list at the top of a chunk: what a dynamic import FROM it preloads. */
export function preloadList(code: string): string[] {
  const m = /m\.f=\[([^\]]*)\]/.exec(code.slice(0, 2000));
  if (!m) return [];
  return [...(m[1] as string).matchAll(/"assets\/([^"]+)"/g)].map((x) => x[1] as string);
}

export function censusChunks(chunks: readonly Chunk[], entryFile: string, entryMaxBytes: number, options: CensusOptions = {}): CensusFindings {
  const byFile = new Map(chunks.map((c) => [c.file, c]));
  const has = (c: Chunk, marker: string): boolean => c.code.includes(marker);
  const coreChunks = chunks.filter((c) => has(c, CORE_MARKER)).map((c) => c.file);
  const webgpuChunks = chunks.filter((c) => has(c, WEBGPU_MARKER)).map((c) => c.file);
  const nodeBackendChunks = chunks.filter((c) => has(c, NODE_BACKEND_MARKER)).map((c) => c.file);
  const nodePostChunks = chunks.filter((c) => has(c, NODE_POST_MARKER)).map((c) => c.file);
  const legacyPostChunks = chunks.filter((c) => LEGACY_POST_MARKERS.some((m) => has(c, m))).map((c) => c.file);
  const materialMathsChunks = chunks.filter((c) => has(c, MATERIAL_MATHS_MARKER)).map((c) => c.file);
  const nodeMaterialChunks = chunks.filter((c) => has(c, NODE_MATERIAL_MARKER)).map((c) => c.file);
  const rapierChunks = chunks.filter((c) => has(c, RAPIER_MARKER)).map((c) => c.file);
  const grassFieldChunks = chunks.filter((c) => has(c, GRASS_FIELD_MARKER)).map((c) => c.file);
  const heightBlendFieldChunks = chunks.filter((c) => has(c, HEIGHT_BLEND_FIELD_MARKER)).map((c) => c.file);
  const entry = byFile.get(entryFile);
  const failures: string[] = [];
  if (!entry) {
    return { coreChunks, webgpuChunks, nodeBackendChunks, nodePostChunks, legacyPostChunks, materialMathsChunks, nodeMaterialChunks, rapierChunks, grassFieldChunks, heightBlendFieldChunks, entryHasThree: [], entryStaticClosure: [], entryClosureBytes: 0, failures: [`entry chunk ${entryFile} not found`] };
  }
  const entryHasThree = [CORE_MARKER, WEBGPU_MARKER, WEBGL_MARKER].filter((m) => has(entry, m));
  // Static closure from the entry.
  const seen = new Set<string>([entryFile]);
  const stack = [entryFile];
  while (stack.length > 0) {
    const f = stack.pop() as string;
    for (const dep of staticImports(byFile.get(f)?.code ?? '')) {
      if (!seen.has(dep) && byFile.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  const entryStaticClosure = [...seen].filter((f) => f !== entryFile);
  const entryClosureBytes = [...seen].reduce((n, f) => n + (byFile.get(f)?.code.length ?? 0), 0);

  if (coreChunks.length !== 1) failures.push(`three.core must live in exactly ONE shared chunk; found ${coreChunks.length} (${coreChunks.join(', ') || 'none'})`);
  if (webgpuChunks.length !== 1) failures.push(`three/webgpu must live in exactly ONE lazy chunk; found ${webgpuChunks.length} (${webgpuChunks.join(', ') || 'none'})`);
  if (webgpuChunks.length === 1 && coreChunks.length === 1 && webgpuChunks[0] === coreChunks[0]) failures.push('three/webgpu and three.core are the SAME chunk: the legacy boot would download WebGPURenderer');
  if (nodeBackendChunks.length !== 1) failures.push(`the node backend must be exactly one lazy chunk; found ${nodeBackendChunks.length}`);
  const nb = nodeBackendChunks[0] !== undefined ? byFile.get(nodeBackendChunks[0]) : undefined;
  if (nb && webgpuChunks[0] !== undefined && !preloadList(nb.code).includes(webgpuChunks[0])) {
    failures.push(`the node-backend chunk's preload list does not name the three/webgpu chunk ${webgpuChunks[0]}: the second dynamic import is not what loads it`);
  }
  // The node post-chain twin lives in the node-backend chunk and nowhere else; the legacy composer is nowhere near it. Both markers
  // must be FOUND, or the check would pass on a bundle that lost the marker (vacuous).
  if (nodePostChunks.length === 0) failures.push(`no chunk carries the node post-chain marker "${NODE_POST_MARKER}": the twin is missing or its marker moved`);
  for (const f of nodePostChunks) {
    if (!nodeBackendChunks.includes(f)) failures.push(`the node post-chain twin (post-chain.node.ts) leaked into ${f}, which is not the node-backend chunk`);
  }
  if (legacyPostChunks.length === 0) failures.push(`no chunk carries the legacy composer marker ${LEGACY_POST_MARKERS.join('/')}: the no-addons check below would be vacuous`);
  // P2 (T1): the material-maths values must be FOUND (or the node-load check below is vacuous), and never in the node-backend chunk
  // or the entry. A material twin must live in the node-backend chunk.
  if (materialMathsChunks.length === 0) failures.push(`no chunk carries the material-maths marker "${MATERIAL_MATHS_MARKER}": material-maths.ts is missing, unused, or its marker moved`);
  for (const f of materialMathsChunks) {
    if (nodeBackendChunks.includes(f)) failures.push(`material-maths.ts (the app-side material values) is in the node-backend chunk ${f}: a twin value-imports it`);
    if (f === entryFile) failures.push(`MAIN CHUNK GUARD: material-maths.ts is in the entry chunk ${f}`);
    else if (seen.has(f)) failures.push(`MAIN CHUNK GUARD: material-maths.ts is in ${f}, which the entry ${entryFile} statically imports`);
  }
  for (const f of nodeMaterialChunks) {
    if (!nodeBackendChunks.includes(f)) failures.push(`a node material twin ("${NODE_MATERIAL_MARKER}*", a .node.ts) leaked into ${f}, which is not the node-backend chunk`);
  }
  // GH-1167 S3 (P1): the grass field is node-native. Any carrier that is not the node-backend chunk (the entry, the shared core, the
  // ThreeRenderer chunk) means a static import of `grass-field.node.ts` from the legacy side.
  for (const f of grassFieldChunks) {
    if (!nodeBackendChunks.includes(f)) failures.push(`the 3D grass field ("${GRASS_FIELD_MARKER}", grass-field.node.ts) leaked into ${f}, which is not the node-backend chunk`);
  }
  // GH-1226 S3 (L1): the height-blend field is node-path only (see HEIGHT_BLEND_FIELD_MARKER). Armed by the source file's existence.
  if (options.heightBlendFieldExpected === true && heightBlendFieldChunks.length === 0) {
    failures.push(`no chunk carries the height-blend field marker "${HEIGHT_BLEND_FIELD_MARKER}", but height-blend-field.ts exists: the marker moved, or the module is in no chunk`);
  }
  if (options.heightBlendFieldExpected !== true && heightBlendFieldChunks.length > 0) {
    failures.push(`a chunk carries "${HEIGHT_BLEND_FIELD_MARKER}" (${heightBlendFieldChunks.join(', ')}) but height-blend-field.ts is not in the tree: a stale marker, or the driver's arming check is wrong`);
  }
  for (const f of heightBlendFieldChunks) {
    if (f === entryFile) failures.push(`MAIN CHUNK GUARD: the height-blend field is in the entry chunk ${f}`);
    else if (seen.has(f)) failures.push(`MAIN CHUNK GUARD: the height-blend field is in ${f}, which the entry ${entryFile} statically imports`);
    if (coreChunks.includes(f) || webgpuChunks.includes(f)) failures.push(`the height-blend field leaked into ${f}, a shared three chunk`);
    if (legacyPostChunks.includes(f) || /^ThreeRenderer/.test(f)) failures.push(`the height-blend field leaked into ${f}, the ThreeRenderer chunk a legacy boot loads (a static import of height-blend-field.ts from ThreeRenderer.ts)`);
    for (const other of chunks) {
      if (other.file === f || nodeBackendChunks.includes(other.file)) continue;
      if (staticImports(other.code).includes(f)) failures.push(`${other.file} statically imports the height-blend field chunk ${f}: only the node-backend chunk may, and ThreeRenderer must use a dynamic import()`);
    }
  }
  for (const f of nodeBackendChunks) {
    // Bundlers hoist a module shared by two chunks into one of them: a twin that imports a legacy pass does not make its OWN chunk
    // carry the marker, it makes the node-backend chunk import the legacy renderer chunk. So walk what a node boot actually loads.
    const loads = new Set<string>([f]);
    const stack = [f];
    while (stack.length > 0) {
      const cur = byFile.get(stack.pop() as string);
      if (!cur) continue;
      // Static imports all the way down; the preload list only of the node-backend chunk itself (an entry's list names the whole app).
      for (const dep of cur === byFile.get(f) ? [...staticImports(cur.code), ...preloadList(cur.code)] : staticImports(cur.code)) {
        if (!loads.has(dep) && byFile.has(dep)) {
          loads.add(dep);
          stack.push(dep);
        }
      }
    }
    for (const dep of loads) {
      if (dep !== f && legacyPostChunks.includes(dep)) failures.push(`a node boot loads ${dep} (via ${f}), which carries the legacy composer (three/addons/postprocessing)`);
      if (dep !== f && materialMathsChunks.includes(dep)) failures.push(`a node boot statically loads ${dep} (via ${f}), which carries material-maths.ts: a twin value-imports the app-side material values`);
    }
    if (legacyPostChunks.includes(f)) failures.push(`the node-backend chunk ${f} carries three/addons/postprocessing code (${LEGACY_POST_MARKERS.join('/')})`);
  }
  // GH-1223: presentation-only physics is one lazy chunk, fetched by the renderer only when a preset asks for ragdolls.
  if (rapierChunks.length !== 1) failures.push(`Rapier must live in exactly ONE lazy chunk; found ${rapierChunks.length} (${rapierChunks.join(', ') || 'none'})`);
  for (const f of rapierChunks) {
    if (f === entryFile) failures.push(`MAIN CHUNK GUARD: Rapier is in the entry chunk ${f}`);
    else if (seen.has(f)) failures.push(`MAIN CHUNK GUARD: Rapier is in ${f}, which the entry ${entryFile} statically imports`);
    if (coreChunks.includes(f) || has(byFile.get(f) as Chunk, WEBGL_MARKER)) failures.push(`Rapier is bundled into a renderer chunk (${f}): a static import of it`);
    for (const c of chunks) {
      if (c.file !== f && staticImports(c.code).includes(f)) failures.push(`${c.file} statically imports the Rapier chunk ${f}: it must be a dynamic import()`);
    }
  }
  if (entryHasThree.length > 0) failures.push(`MAIN CHUNK GUARD: the entry chunk ${entryFile} carries three code (${entryHasThree.join(', ')})`);
  for (const f of [...coreChunks, ...webgpuChunks, ...nodeBackendChunks]) {
    if (seen.has(f)) failures.push(`MAIN CHUNK GUARD: the entry statically imports ${f}`);
  }
  if (entryClosureBytes > entryMaxBytes) {
    const parts = [entryFile, ...entryStaticClosure].map((f) => `${f} ${byFile.get(f)?.code.length ?? 0}`).join(' + ');
    failures.push(`MAIN CHUNK GUARD: the entry chunk and its static imports are ${entryClosureBytes} bytes (${parts}), over the ${entryMaxBytes} ceiling`);
  }
  return { coreChunks, webgpuChunks, nodeBackendChunks, nodePostChunks, legacyPostChunks, materialMathsChunks, nodeMaterialChunks, rapierChunks, grassFieldChunks, heightBlendFieldChunks, entryHasThree, entryStaticClosure, entryClosureBytes, failures };
}
