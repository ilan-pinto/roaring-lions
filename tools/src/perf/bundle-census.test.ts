import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_MARKER, GRASS_FIELD_MARKER, LEGACY_POST_MARKERS, MATERIAL_MATHS_MARKER, NODE_BACKEND_MARKER, NODE_MATERIAL_MARKER, NODE_POST_MARKER, RAPIER_MARKER, WEBGL_MARKER, WEBGPU_MARKER, censusChunks, preloadList, staticImports, type Chunk } from './bundle-census';

const preload = (...files: string[]): string => `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[${files.map((f) => `"assets/${f}"`).join(',')}])))=>i.map(i=>d[i]);\n`;
const good = (): Chunk[] => [
  { file: 'index.js', code: preload('ThreeRenderer.js') + 'import{t as e}from"./runtime.js";console.log("app")' },
  { file: 'runtime.js', code: 'export const t=1' },
  { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x")` },
  { file: 'webgpu.js', code: `import{a}from"./core.js";throw new Error("${WEBGPU_MARKER}: x")` },
  { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"` },
  { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}",mm={marker:"${MATERIAL_MATHS_MARKER}"};const p=()=>import("./rapier.js")` },
  { file: 'rapier.js', code: `const w={${RAPIER_MARKER}:1}` },
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
  it('holds the ceiling against the entry PLUS its static imports, not the entry file alone', () => {
    // A small entry whose weight was hoisted into a chunk it imports statically: the boot downloads both. Measured on the entry
    // file alone (the rule before 8 Nov 2026) this bundle passes a 100-byte ceiling; summed, it is red.
    const c = good();
    c[0] = { file: 'index.js', code: preload('ThreeRenderer.js') + 'import{s}from"./shared.js";import{t as e}from"./runtime.js";' };
    c.push({ file: 'shared.js', code: `export const s="${'x'.repeat(200)}"` });
    expect(c[0].code.length).toBeLessThan(200);
    const f = censusChunks(c, 'index.js', 200);
    expect(f.entryStaticClosure.sort()).toEqual(['runtime.js', 'shared.js']);
    expect(f.entryClosureBytes).toBe(c[0].code.length + 'export const t=1'.length + c[c.length - 1].code.length);
    expect(f.failures.join()).toMatch(/entry chunk and its static imports are \d+ bytes \(index\.js \d+ \+ (runtime|shared)\.js/);
    // A lazy chunk does not count: the same weight behind a dynamic import is under the same ceiling.
    c[0] = { file: 'index.js', code: preload('ThreeRenderer.js', 'shared.js') + 'import{t as e}from"./runtime.js";import("./shared.js")' };
    expect(run(c, 200)).toEqual([]);
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
  it('GH-1223: fails when Rapier is not one lazy chunk: in the entry, statically imported, inside the renderer, or doubled', () => {
    const inEntry = good().filter((x) => x.file !== 'rapier.js');
    inEntry[0] = { file: 'index.js', code: inEntry[0].code + `;const w={${RAPIER_MARKER}:1}` };
    expect(run(inEntry).join()).toMatch(/MAIN CHUNK GUARD: Rapier is in the entry chunk/);
    const staticFromEntry = good();
    staticFromEntry[0] = { file: 'index.js', code: staticFromEntry[0].code + ';import"./rapier.js"' };
    expect(run(staticFromEntry).join()).toMatch(/MAIN CHUNK GUARD: Rapier is in rapier.js, which the entry/);
    const staticFromRenderer = good();
    staticFromRenderer[5] = { file: 'ThreeRenderer.js', code: `import"./rapier.js";import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}",mm={marker:"${MATERIAL_MATHS_MARKER}"}` };
    expect(run(staticFromRenderer).join()).toMatch(/ThreeRenderer.js statically imports the Rapier chunk rapier.js/);
    const inRenderer = good().filter((x) => x.file !== 'rapier.js');
    inRenderer[2] = { file: 'core.js', code: inRenderer[2].code + `;const w={${RAPIER_MARKER}:1}` };
    expect(run(inRenderer).join()).toMatch(/Rapier is bundled into a renderer chunk/);
    const none = good().filter((x) => x.file !== 'rapier.js');
    expect(run(none).join()).toMatch(/Rapier must live in exactly ONE lazy chunk; found 0/);
  });
  it('GH-1223: the Rapier marker is in the installed package\'s code', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const dist = path.join(root, 'packages/render/node_modules/@dimforge/rapier3d-deterministic-compat/dist/rapier.mjs');
    expect(readFileSync(dist, 'utf8')).toContain(RAPIER_MARKER);
  });
  it('the markers are real: the node marker is a literal in post-chain.node.ts, the legacy one in three\'s SMAAShader', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    expect(readFileSync(path.join(root, 'packages/render/src/three/post-chain.node.ts'), 'utf8')).toContain(`'${NODE_POST_MARKER}'`);
    const shader = (f: string): string => readFileSync(path.join(root, 'packages/render/node_modules/three/examples/jsm/shaders', f), 'utf8');
    expect(shader('CopyShader.js')).toContain(`'${LEGACY_POST_MARKERS[0]}'`);
    expect(shader('LuminosityHighPassShader.js')).toContain(`'${LEGACY_POST_MARKERS[1]}'`);
    expect(shader('SMAAShader.js')).toContain(`'${LEGACY_POST_MARKERS[2]}'`);
  });
  it('P2 (T1): fails when a node boot statically loads material-maths.ts (a twin value-imports it, so the node chunk imports its holder)', () => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: 'import{mm}from"./ThreeRenderer.js";' + preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"` };
    expect(run(c).join()).toMatch(/a node boot statically loads ThreeRenderer.js \(via node-backend.js\), which carries material-maths.ts/);
  });
  it('P2 (T1): fails when material-maths.ts is bundled INTO the node-backend chunk, or into the entry', () => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}",mm="${MATERIAL_MATHS_MARKER}"` };
    expect(run(c).join()).toMatch(/material-maths.ts \(the app-side material values\) is in the node-backend chunk node-backend.js/);
    const d = good();
    d[0] = { file: 'index.js', code: preload('ThreeRenderer.js') + `import{t as e}from"./runtime.js";const mm="${MATERIAL_MATHS_MARKER}"` };
    expect(run(d).join()).toMatch(/MAIN CHUNK GUARD: material-maths.ts is in the entry chunk index.js/);
  });
  it('P2 (T1): fails when material-maths.ts sits in a NON-entry chunk the entry statically imports (it loads eagerly)', () => {
    const c = good();
    c[1] = { file: 'runtime.js', code: `export const t=1;const mm="${MATERIAL_MATHS_MARKER}"` };
    expect(run(c).join()).toMatch(/MAIN CHUNK GUARD: material-maths.ts is in runtime.js, which the entry index.js statically imports/);
  });
  it('P2 (T1): is not vacuous: a bundle with no material-maths marker anywhere fails', () => {
    const c = good();
    c[5] = { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}"` };
    expect(run(c).join()).toMatch(/no chunk carries the material-maths marker/);
  });
  it('P2 (T1): a node material twin belongs in the node-backend chunk; anywhere else fails', () => {
    const ok = good();
    ok[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}",t="${NODE_MATERIAL_MARKER}ground"` };
    expect(run(ok)).toEqual([]);
    const c = good();
    c[5] = { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}",mm="${MATERIAL_MATHS_MARKER}",t="${NODE_MATERIAL_MARKER}ring"` };
    expect(run(c).join()).toMatch(/a node material twin \("rl-node-material-\*", a .node.ts\) leaked into ThreeRenderer.js/);
    const d = good();
    d[2] = { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x");const t="${NODE_MATERIAL_MARKER}foliage"` };
    expect(run(d).join()).toMatch(/leaked into core.js/);
  });
  it('P2 (T1): the material-maths marker is the literal material-maths.ts exports', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    expect(readFileSync(path.join(root, 'packages/render/src/three/material-maths.ts'), 'utf8')).toContain(`marker: '${MATERIAL_MATHS_MARKER}'`);
  });
  it('parses static imports, not dynamic ones, and the preload list', () => {
    expect(staticImports('import{a as b}from"./x.js";import"./y.js";const z=import("./w.js")')).toEqual(['x.js', 'y.js']);
    expect(preloadList(preload('a.js', 'b.js'))).toEqual(['a.js', 'b.js']);
  });
});

describe('GH-1167 S3 (P1): the 3D grass field lives in the node-backend chunk and nowhere else', () => {
  const withNode = (extra: string): Chunk[] => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"${extra}` };
    return c;
  };
  it('passes with the marker in the node-backend chunk, and with no carrier at all (armed by S4)', () => {
    expect(run(withNode(`,g="${GRASS_FIELD_MARKER}"`))).toEqual([]);
    expect(run(good())).toEqual([]);
  });
  it('fails when the marker is in the ThreeRenderer chunk (a static import of grass-field.node.ts from ThreeRenderer.ts)', () => {
    const c = withNode(`,g="${GRASS_FIELD_MARKER}"`);
    c[5] = { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}",mm={marker:"${MATERIAL_MATHS_MARKER}"},g="${GRASS_FIELD_MARKER}"` };
    expect(run(c).join()).toMatch(/grass field .* leaked into ThreeRenderer.js/);
  });
  it('fails when the marker is in the entry or the shared core', () => {
    const e = withNode('');
    e[1] = { file: 'runtime.js', code: `export const t="${GRASS_FIELD_MARKER}"` };
    expect(run(e).join()).toMatch(/leaked into runtime.js/);
    const k = withNode('');
    k[2] = { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x");const g="${GRASS_FIELD_MARKER}"` };
    expect(run(k).join()).toMatch(/leaked into core.js/);
  });
  it('the marker is the name prefix S4 gives the scene objects (P3 looks for the same prefix)', () => {
    expect(GRASS_FIELD_MARKER).toBe('rl-grass-field');
  });
});
