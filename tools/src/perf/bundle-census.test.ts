import { describe, expect, it } from 'vitest';
import { CORE_MARKER, NODE_BACKEND_MARKER, WEBGL_MARKER, WEBGPU_MARKER, censusChunks, preloadList, staticImports, type Chunk } from './bundle-census';

const preload = (...files: string[]): string => `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[${files.map((f) => `"assets/${f}"`).join(',')}])))=>i.map(i=>d[i]);\n`;
const good = (): Chunk[] => [
  { file: 'index.js', code: preload('ThreeRenderer.js') + 'import{t as e}from"./runtime.js";console.log("app")' },
  { file: 'runtime.js', code: 'export const t=1' },
  { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x")` },
  { file: 'webgpu.js', code: `import{a}from"./core.js";throw new Error("${WEBGPU_MARKER}: x")` },
  { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}")` },
  { file: 'ThreeRenderer.js', code: 'import{a}from"./core.js";export const r=1' },
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
    c[4] = { file: 'node-backend.js', code: preload('core.js') + `throw new Error("${NODE_BACKEND_MARKER}")` };
    expect(run(c).join()).toMatch(/preload list does not name/);
  });
  it('parses static imports, not dynamic ones, and the preload list', () => {
    expect(staticImports('import{a as b}from"./x.js";import"./y.js";const z=import("./w.js")')).toEqual(['x.js', 'y.js']);
    expect(preloadList(preload('a.js', 'b.js'))).toEqual(['a.js', 'b.js']);
  });
});
