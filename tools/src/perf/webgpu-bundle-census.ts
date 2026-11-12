/**
 * The P0 bundle census driver (GH-943 WebGPU-primary): builds the app to `packages/app/dist-bundle-census` (ignored by git and
 * eslint: `dist-*`) and runs `bundle-census.ts` over the real chunks.
 *
 *   pnpm --filter @lions/tools webgpu:bundle [-- --no-build] [--out=<json>]
 *
 * Prints the size of every three chunk (raw and gzip) and the findings; exit 1 on any failure. The ceiling is MAIN_CHUNK_MAX_BYTES.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { censusChunks, heightBlendFieldUsedIn, type Chunk } from './bundle-census';

/**
 * The entry's ceiling, bytes (`code.length`): measured 1,794,107 bytes with P0 on 5 Nov 2026 (origin/main d05cd6da5 + this branch);
 * this is the ratchet, never raised to fit a change. Since 8 Nov 2026 it holds the entry chunk PLUS every chunk the entry statically
 * imports (`entryClosureBytes`), unchanged in value: at origin/main c9a230a23 that sum was 1,857,936 (the entry 1,857,778 + the 158-byte runtime chunk).
 */
export const MAIN_CHUNK_MAX_BYTES = 1_850_000;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const APP = path.join(REPO, 'packages/app');
const OUT_DIR = path.join(APP, 'dist-bundle-census');
const args = process.argv.slice(2);

if (!args.includes('--no-build')) {
  const r = spawnSync('pnpm', ['exec', 'vite', 'build', '--outDir', 'dist-bundle-census', '--emptyOutDir'], { cwd: APP, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('bundle census: the build failed');
    process.exit(2);
  }
}
const html = readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
const entry = /src="\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1];
if (entry === undefined) {
  console.error('bundle census: no entry script in index.html');
  process.exit(2);
}
const dir = path.join(OUT_DIR, 'assets');
const chunks: Chunk[] = readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => {
    const buf = readFileSync(path.join(dir, f));
    return { file: f, code: buf.toString('utf8'), gzipBytes: gzipSync(buf).length };
  });
const maxArg = Number(args.find((a) => a.startsWith('--max='))?.slice(6) ?? MAIN_CHUNK_MAX_BYTES);
// GH-1226 S3 (L1): the field's pin is armed by the source file's existence (bundle-census.ts, HEIGHT_BLEND_FIELD_MARKER).
const heightBlendFieldExpected = existsSync(path.join(REPO, 'packages/render/src/three/terrain/height-blend-field.ts'));
const sources = new Map<string, string>();
const walk = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('dist')) walk(p); }
    else if (/\.tsx?$/.test(e.name)) sources.set(path.relative(REPO, p), readFileSync(p, 'utf8'));
  }
};
for (const pkg of ['render', 'app']) walk(path.join(REPO, 'packages', pkg, 'src'));
const heightBlendFieldUsed = heightBlendFieldUsedIn(sources);
const f = censusChunks(chunks, entry, maxArg, { heightBlendFieldExpected, heightBlendFieldUsed });
const row = (c: Chunk): string => `${c.file}  raw ${(c.code.length / 1024).toFixed(1)} KiB  gzip ${((c.gzipBytes ?? 0) / 1024).toFixed(1)} KiB`;
const pick = (files: string[]): Chunk[] => chunks.filter((c) => files.includes(c.file));
const lines: string[] = [];
lines.push(`entry (main chunk): ${row(chunks.find((c) => c.file === entry) as Chunk)}`);
for (const c of pick(f.entryStaticClosure)) lines.push(`  + statically imported by the entry: ${row(c)}`);
lines.push(`entry + static closure: ${f.entryClosureBytes} bytes (${(f.entryClosureBytes / 1024).toFixed(1)} KiB)  ceiling ${maxArg} bytes (${(maxArg / 1024).toFixed(0)} KiB)`);
for (const c of pick(f.coreChunks)) lines.push(`three.core (+WebGLRenderer, shared): ${row(c)}`);
for (const c of pick(f.webgpuChunks)) lines.push(`three/webgpu (lazy): ${row(c)}`);
for (const c of chunks.filter((x) => /^three\.tsl-/.test(x.file))) lines.push(`three/tsl (lazy): ${row(c)}`);
for (const c of pick(f.nodeBackendChunks)) lines.push(`node backend (lazy): ${row(c)}`);
for (const c of pick(f.rapierChunks)) lines.push(`Rapier (lazy, ragdolls only; GH-1223): ${row(c)}`);
for (const c of chunks.filter((x) => /^ThreeRenderer-/.test(x.file))) lines.push(`ThreeRenderer (lazy, legacy path + composer): ${row(c)}`);
const lazy = pick(f.webgpuChunks).concat(chunks.filter((x) => /^three\.tsl-/.test(x.file)), pick(f.nodeBackendChunks));
const lazyBytes = lazy.reduce((n, c) => n + c.code.length, 0);
const lazyGzip = lazy.reduce((n, c) => n + (c.gzipBytes ?? 0), 0);
lines.push(`node-boot extra download (webgpu + tsl + node backend): raw ${(lazyBytes / 1024).toFixed(1)} KiB, gzip ${(lazyGzip / 1024).toFixed(1)} KiB; a legacy boot downloads none of it`);
lines.push(`node post chain (post-chain.node.ts) in: ${f.nodePostChunks.join(', ') || '(NOWHERE)'}; legacy composer (three/addons/postprocessing) in: ${f.legacyPostChunks.join(', ') || '(NOWHERE)'}`);
lines.push(`material-maths.ts (app-side material values) in: ${f.materialMathsChunks.join(', ') || '(NOWHERE)'}; node material twins (${'rl-node-material-*'}) in: ${f.nodeMaterialChunks.join(', ') || '(none yet)'}`);
// GH-943 P3 (T1): the two import-free twin-side modules (`twin-identity.ts`, `material-names.ts`), by a literal only each holds.
// Report-only: they import nothing, so wherever the bundler puts them they drag no chunk in (the G9 source spec is the gate).
const holders = (marker: string): string => chunks.filter((c) => c.code.includes(marker)).map((c) => c.file).join(', ') || '(NOWHERE)';
lines.push(`twin-identity.ts (rlLegacyBase) in: ${holders('rlLegacyBase')}; material-names.ts (rl-backdrop-fade) in: ${holders('rl-backdrop-fade')}`);
lines.push(`3D grass field (rl-grass-field, S4) in: ${f.grassFieldChunks.join(', ') || '(none yet)'}`);
lines.push(`height-blend field (rl-height-blend-field, GH-1226; file: ${heightBlendFieldExpected}, used: ${heightBlendFieldUsed}) in: ${f.heightBlendFieldChunks.join(', ') || (heightBlendFieldUsed ? '(NOWHERE)' : '(not used yet)')}`);
lines.push(`entry static closure: ${f.entryStaticClosure.join(', ') || '(none)'}`);
lines.push(f.failures.length === 0 ? 'FINDINGS: none (core shared, webgpu lazy, main chunk clean, node post chain only in the node backend chunk, no postprocessing addons in it, material values off the node load, twins only in the node backend chunk)' : `FINDINGS:\n  ${f.failures.join('\n  ')}`);
console.log(lines.join('\n'));
const outArg = args.find((a) => a.startsWith('--out='))?.slice(6);
if (outArg) writeFileSync(outArg, lines.join('\n') + '\n');
process.exit(f.failures.length === 0 ? 0 : 1);
