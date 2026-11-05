// GH-943 WebGPU-primary P0: the bundle census. Pure (chunks in, findings out), so `bundle-census.test.ts` can hand it a constructed
// bad bundle and watch each finding go red; `webgpu-bundle-census.ts` builds the app and feeds it the real `dist/assets`.
//
// What it asserts (design sections 1 and 8, P0):
//   1. three.core is SHARED: exactly one chunk carries it, so the legacy renderer and `three/webgpu` do not each ship a copy.
//   2. three/webgpu lives in its OWN lazy chunk (the node backend's second dynamic import), distinct from core, and the node-backend
//      chunk's preload list names it. A legacy boot never fetches it.
//   3. THE MAIN-CHUNK GUARD: the entry chunk carries no three code (core, WebGPURenderer, WebGLRenderer) and its STATIC import closure
//      reaches none of the three chunks (core, webgpu, tsl, node-backend, the renderer). Plus a size ceiling on the entry.

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

export interface CensusFindings {
  readonly coreChunks: string[];
  readonly webgpuChunks: string[];
  readonly nodeBackendChunks: string[];
  readonly nodePostChunks: string[];
  readonly legacyPostChunks: string[];
  readonly entryHasThree: string[];
  /** Chunks reachable from the entry by STATIC imports only. */
  readonly entryStaticClosure: string[];
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

export function censusChunks(chunks: readonly Chunk[], entryFile: string, entryMaxBytes: number): CensusFindings {
  const byFile = new Map(chunks.map((c) => [c.file, c]));
  const has = (c: Chunk, marker: string): boolean => c.code.includes(marker);
  const coreChunks = chunks.filter((c) => has(c, CORE_MARKER)).map((c) => c.file);
  const webgpuChunks = chunks.filter((c) => has(c, WEBGPU_MARKER)).map((c) => c.file);
  const nodeBackendChunks = chunks.filter((c) => has(c, NODE_BACKEND_MARKER)).map((c) => c.file);
  const nodePostChunks = chunks.filter((c) => has(c, NODE_POST_MARKER)).map((c) => c.file);
  const legacyPostChunks = chunks.filter((c) => LEGACY_POST_MARKERS.some((m) => has(c, m))).map((c) => c.file);
  const entry = byFile.get(entryFile);
  const failures: string[] = [];
  if (!entry) {
    return { coreChunks, webgpuChunks, nodeBackendChunks, nodePostChunks, legacyPostChunks, entryHasThree: [], entryStaticClosure: [], failures: [`entry chunk ${entryFile} not found`] };
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
    }
    if (legacyPostChunks.includes(f)) failures.push(`the node-backend chunk ${f} carries three/addons/postprocessing code (${LEGACY_POST_MARKERS.join('/')})`);
  }
  if (entryHasThree.length > 0) failures.push(`MAIN CHUNK GUARD: the entry chunk ${entryFile} carries three code (${entryHasThree.join(', ')})`);
  for (const f of [...coreChunks, ...webgpuChunks, ...nodeBackendChunks]) {
    if (seen.has(f)) failures.push(`MAIN CHUNK GUARD: the entry statically imports ${f}`);
  }
  if (entry.code.length > entryMaxBytes) failures.push(`MAIN CHUNK GUARD: the entry chunk is ${entry.code.length} bytes, over the ${entryMaxBytes} ceiling`);
  return { coreChunks, webgpuChunks, nodeBackendChunks, nodePostChunks, legacyPostChunks, entryHasThree, entryStaticClosure, failures };
}
