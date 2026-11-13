import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_MARKER, GRASS_FIELD_MARKER, HEIGHT_BLEND_FIELD_MARKER, LEGACY_POST_MARKERS, MATERIAL_MATHS_MARKER, NODE_BACKEND_MARKER, NODE_MATERIAL_MARKER, NODE_POST_MARKER, RAPIER_MARKER, WEBGL_MARKER, WEBGPU_MARKER, censusChunks, dynamicImports, heightBlendFieldUsedIn, preloadList, staticImports, type Chunk } from './bundle-census';

const preload = (...files: string[]): string => `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[${files.map((f) => `"assets/${f}"`).join(',')}])))=>i.map(i=>d[i]);\n`;
/** GH-1167 S5: the grass field's marker, carried by every good node-backend chunk now that P1 requires a carrier. */
const GRASS = `,g="${GRASS_FIELD_MARKER}"`;
const good = (): Chunk[] => [
  { file: 'index.js', code: preload('ThreeRenderer.js') + 'import{t as e}from"./runtime.js";console.log("app")' },
  { file: 'runtime.js', code: 'export const t=1' },
  { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x")` },
  { file: 'webgpu.js', code: `import{a}from"./core.js";throw new Error("${WEBGPU_MARKER}: x")` },
  { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"${GRASS}` },
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
    ok[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}",t="${NODE_MATERIAL_MARKER}ground"${GRASS}` };
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

describe('GH-1167 S3/S5 (P1): the 3D grass field lives in the node-backend chunk and nowhere else, and it is there', () => {
  const withNode = (extra: string): Chunk[] => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}"${extra}` };
    return c;
  };
  it('passes with the marker in the node-backend chunk', () => {
    expect(run(withNode(GRASS))).toEqual([]);
    expect(run(good())).toEqual([]);
  });
  it('S5: fails when NO chunk carries the marker (the field dropped from the node backend, or its name moved): never vacuous', () => {
    expect(run(withNode('')).join()).toMatch(/no chunk carries the 3D grass field marker "rl-grass-field"/);
  });
  it('fails when the marker is in the ThreeRenderer chunk (a static import of grass-field.node.ts from ThreeRenderer.ts)', () => {
    const c = withNode(GRASS);
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

describe('GH-1226 S3 (L1): the height-blend field is node-path only, and the pin cannot go on passing after it stopped looking', () => {
  const withNode = (extra: string): Chunk[] => {
    const c = good();
    c[4] = { file: 'node-backend.js', code: preload('webgpu.js', 'core.js') + `throw new Error("${NODE_BACKEND_MARKER}");const n="${NODE_POST_MARKER}",g="${GRASS_FIELD_MARKER}"${extra}` };
    return c;
  };
  const armed = (chunks: Chunk[]): string[] => censusChunks(chunks, 'index.js', 10000, { heightBlendFieldExpected: true, heightBlendFieldUsed: true }).failures;
  const field = `,h="${HEIGHT_BLEND_FIELD_MARKER}"`;
  it('the marker is the one S2 gives the field texture (literal)', () => {
    expect(HEIGHT_BLEND_FIELD_MARKER).toBe('rl-height-blend-field');
    // Armed by S2: once the file is on main, it must still carry this literal (a renamed marker would silently disarm the pin above).
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const file = path.join(root, 'packages/render/src/three/terrain/height-blend-field.ts');
    if (existsSync(file)) expect(readFileSync(file, 'utf8')).toContain(`HEIGHT_BLEND_FIELD_MARKER = '${HEIGHT_BLEND_FIELD_MARKER}'`);
  });
  it('passes with no carrier while the file is not in the tree (today), and with the carrier in the node-backend chunk once it is', () => {
    expect(run(good())).toEqual([]);
    expect(armed(withNode(field))).toEqual([]);
  });
  it('passes with the carrier in a lazy chunk of its own that only the node-backend chunk imports (statically or dynamically)', () => {
    const c = withNode(`;import{h}from"./field.js"`);
    c.push({ file: 'field.js', code: `export const h="${HEIGHT_BLEND_FIELD_MARKER}"` });
    expect(armed(c)).toEqual([]);
    const d = withNode(`;const l=()=>import("./field.js")`);
    d.push({ file: 'field.js', code: `export const h="${HEIGHT_BLEND_FIELD_MARKER}"` });
    expect(armed(d)).toEqual([]);
  });
  it('armed (a source uses the field), a bundle with NO carrier is red (the vacuous pass is gone the day S5 wires it)', () => {
    expect(armed(good()).join()).toMatch(/no chunk carries the height-blend field marker/);
  });
  it('file present but nothing uses it (S2 alone: it bakes and wires nothing), no carrier is NOT red', () => {
    expect(censusChunks(good(), 'index.js', 10000, { heightBlendFieldExpected: true, heightBlendFieldUsed: false }).failures).toEqual([]);
  });
  it('a dynamic importer is allowed from the ThreeRenderer chunk and the node-backend chunk, and from nowhere else', () => {
    const ok = withNode(field);
    ok[5] = { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}",mm={marker:"${MATERIAL_MATHS_MARKER}"};const l=()=>import("./field.js")` };
    ok.push({ file: 'field.js', code: `export const h="${HEIGHT_BLEND_FIELD_MARKER}"` });
    ok[0] = { file: 'index.js', code: preload('ThreeRenderer.js') + 'import{t as e}from"./runtime.js";console.log("app")' };
    expect(armed(ok)).toEqual([]);
    const bad = ok.map((c) => c.file === 'index.js' ? { file: 'index.js', code: c.code + ';const l=()=>import("./field.js")' } : c);
    expect(armed(bad).join()).toMatch(/index.js dynamically imports the height-blend field chunk field.js/);
    const app = ok.map((c) => c.file === 'rapier.js' ? { file: 'rapier.js', code: c.code + ';import("./field.js")' } : c);
    expect(armed(app).join()).toMatch(/rapier.js dynamically imports/);
  });
  it('dynamicImports reads import("./x.js") and not static imports', () => {
    expect(dynamicImports('import{a}from"./s.js";const z=import("./w.js"),y=import( "./v.js" )')).toEqual(['w.js', 'v.js']);
  });
  it('heightBlendFieldUsedIn: a real importer arms it; the two field files, the barrel and tests do not', () => {
    const src = (e: Record<string, string>): ReadonlyMap<string, string> => new Map(Object.entries(e));
    const imp = "const m = await import('./terrain/height-blend-field');";
    expect(heightBlendFieldUsedIn(src({}))).toBe(false);
    expect(heightBlendFieldUsedIn(src({ 'packages/render/src/three/ThreeRenderer.ts': imp }))).toBe(true);
    expect(heightBlendFieldUsedIn(src({ 'packages/render/src/three/ThreeRenderer.ts': "import { x } from './terrain/height-blend-texture';" }))).toBe(true);
    expect(heightBlendFieldUsedIn(src({ 'packages/app/src/a.ts': "import('../x/height-blend-field')" }))).toBe(true);
    expect(heightBlendFieldUsedIn(src({
      'packages/render/src/three/terrain/height-blend-field.ts': imp,
      'packages/render/src/three/terrain/height-blend-texture.ts': "import { M } from './height-blend-field';",
      'packages/render/src/three/terrain/index.ts': "export * from './height-blend-field';",
      'packages/render/src/three/X.test.ts': imp,
      'packages/render/src/three/Y.test-support.ts': imp,
    }))).toBe(false);
  });
  it('disarmed, a carrier is red (a stale marker, or the driver\'s arming check is wrong)', () => {
    expect(run(withNode(field)).join()).toMatch(/height-blend-field.ts is not in the tree/);
  });
  it('fails when the marker is in the ThreeRenderer chunk (a static import of height-blend-field.ts from ThreeRenderer.ts)', () => {
    const c = withNode(field);
    c[5] = { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";export const r="${LEGACY_POST_MARKERS[0]}",mm={marker:"${MATERIAL_MATHS_MARKER}"}${field}` };
    expect(armed(c).join()).toMatch(/height-blend field leaked into ThreeRenderer.js/);
  });
  it('fails when the field is hoisted into its own chunk that ThreeRenderer imports statically', () => {
    const c = withNode(`;import{h}from"./field.js"`);
    c[5] = { file: 'ThreeRenderer.js', code: `import{a}from"./core.js";import{h}from"./field.js";export const r="${LEGACY_POST_MARKERS[0]}",mm={marker:"${MATERIAL_MATHS_MARKER}"}` };
    c.push({ file: 'field.js', code: `export const h="${HEIGHT_BLEND_FIELD_MARKER}"` });
    expect(armed(c).join()).toMatch(/ThreeRenderer.js statically imports the height-blend field chunk field.js/);
  });
  it('fails when the marker is in the entry, its static closure, or the shared core', () => {
    const e = withNode(field);
    e[0] = { file: 'index.js', code: preload('ThreeRenderer.js') + `import{t as e}from"./runtime.js";const h="${HEIGHT_BLEND_FIELD_MARKER}"` };
    expect(armed(e).join()).toMatch(/MAIN CHUNK GUARD: the height-blend field is in the entry chunk index.js/);
    const r = withNode(field);
    r[1] = { file: 'runtime.js', code: `export const t="${HEIGHT_BLEND_FIELD_MARKER}"` };
    expect(armed(r).join()).toMatch(/is in runtime.js, which the entry index.js statically imports/);
    const k = withNode(field);
    k[2] = { file: 'core.js', code: `console.warn("${CORE_MARKER}");throw new Error("${WEBGL_MARKER}: x");const h="${HEIGHT_BLEND_FIELD_MARKER}"` };
    expect(armed(k).join()).toMatch(/leaked into core.js, a shared three chunk/);
  });
});
