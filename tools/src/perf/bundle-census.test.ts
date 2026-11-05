import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_MARKER, LEGACY_POST_MARKERS, NODE_BACKEND_MARKER, NODE_POST_MARKER, WEBGL_MARKER, WEBGPU_MARKER, censusChunks, preloadList, staticImports, type Chunk } from './bundle-census';

const preload = (...files: string[]): string => `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[${files.map((f) => `"assets/${f}"`).join(',')}])))=>i.map(i=>d[i]);\n`;
const good = (): Chunk[] => [
  { file: 'index.js', code: preload('ThreeRenderer.js') + 'import{t as e}from"./runtime.js";console.log("app")' },
  { file: 'runtime.js', code: 'export const t=1' },
  { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x")` },
  { file: 'webgpu.js', code: `import{a}from"./core.js";throw new Error("${WEBGPU_MARKER}: x")` },
  { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"` },
  { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}"` },
];
const run = (chunks: Chunk[], max = 10000): string[] => censusChunks(chunks, 'index.js', max).failures;

describe('bundle census: each finding is driven red by a constructed bundle', () => {
  it('passes the good layout', () => {
    expect(run(good())).toEqual([]);
  });
  it('fails when three.core is duplicated (webgpu bundles its own copy)', () => {
    const c = good();
    c[3] = { file: 'webgpu.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGPU_MARKER}")` };
    expect(run(c).join()).toMatch(/exactly ONE shared chunk; found 2/);
  });
  it('fails when webgpu and core are one chunk', () => {
    const c = good().filter((x) => x.file !== 'webgpu.js' && x.file !== 'core.js');
    c.push({ file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGPU_MARKER}")` });
    expect(run(c).join()).toMatch(/SAME chunk/);
  });
  it('fails when the main chunk carries three', () => {
    const c = good();
    c[0] = { file: 'index.js', code: `throw new Error("${WEBGL_MARKER}")` };
    expect(run(c).join()).toMatch(/MAIN CHUNK GUARD: the entry chunk index.js carries three code/);
  });
  it('fails when the entry statically imports the renderer chunks', () => {
    const c = good();
    c[0] = { file: 'index.js', code: 'import{a}from"./webgpu.js";' };
    expect(run(c).join()).toMatch(/entry statically imports webgpu.js/);
    c[0] = { file: 'index.js', code: 'import{t as e}from"./runtime.js";' };
    c[1] = { file: 'runtime.js', code: 'import"./core.js"' };
    expect(run(c).join()).toMatch(/entry statically imports core.js/);
  });
  it('fails over the main-chunk size ceiling', () => {
    expect(run(good(), 10).join()).toMatch(/over the 10 ceiling/);
  });
  it('fails when the node backend does not preload the webgpu chunk', () => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: preload('core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"` };
    expect(run(c).join()).toMatch(/preload list does not name/);
  });
  it('fails when the node post-chain twin leaks into the shared core or the legacy renderer chunk (an import of a .node.ts from legacy code)', () => {
    const c = good();
    c[2] = { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x");const n="${NODE_POST_MARKER}"` };
    expect(run(c).join()).toMatch(/twin \(post-chain.node.ts\) leaked into core.js/);
    const d = good();
    d[5] = { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";const r="${LEGACY_POST_MARKERS[0]}",n="${NODE_POST_MARKER}"` };
    expect(run(d).join()).toMatch(/leaked into ThreeRenderer.js/);
  });
  it('fails when the node-backend chunk carries the legacy composer (a three/addons/postprocessing import from the twin)', () => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}",l="${LEGACY_POST_MARKERS[0]}"` };
    expect(run(c).join()).toMatch(/node-backend chunk node-backend.js carries three\/addons\/postprocessing code/);
  });
  it('fails when the node-backend chunk merely IMPORTS the chunk that carries the legacy composer (a hoisted shared module)', () => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: 'import{b}from"./ThreeRenderer.js";' + preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"` };
    expect(run(c).join()).toMatch(/a node boot loads ThreeRenderer.js \(via node-backend.js\)/);
  });
  it('is not vacuous: a bundle with no node marker, or no legacy marker anywhere, fails', () => {
    const noNode = good();
    noNode[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}")` };
    expect(run(noNode).join()).toMatch(/no chunk carries the node post-chain marker/);
    const noLegacy = good();
    noLegacy[5] = { file: 'ThreeRenderer.js', code: 'import{a}from"./core.js";export const r=1' };
    expect(run(noLegacy).join()).toMatch(/no chunk carries the legacy composer marker/);
  });
  it('the markers are real: the node marker is a literal in post-chain.node.ts, the legacy one in three\'s SMAAShader', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    expect(readFileSync(path.join(root, 'packages/render/src/three/post-chain.node.ts'), 'utf8')).toContain(`'${NODE_POST_MARKER}'`);
    const shader = (f: string): string => readFileSync(path.join(root, 'packages/render/node_modules/three/examples/jsm/shaders', f), 'utf8');
    expect(shader('CopyShader.js')).toContain(`'${LEGACY_POST_MARKERS[0]}'`);
    expect(shader('LuminosityHighPassShader.js')).toContain(`'${LEGACY_POST_MARKERS[1]}'`);
    expect(shader('SMAAShader.js')).toContain(`'${LEGACY_POST_MARKERS[2]}'`);
  });
  it('parses static imports, not dynamic ones, and the preload list', () => {
    expect(staticImports('import{a as b}from"./x.js";import"./y.js";const z=import("./w.js")')).toEqual(['x.js', 'y.js']);
    expect(preloadList(preload('a.js', 'b.js'))).toEqual(['a.js', 'b.js']);
  });
});
