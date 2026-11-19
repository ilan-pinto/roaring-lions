#!/usr/bin/env node
// GH-1418 desktop spike: package `pnpm build` output into an UNSIGNED local Linux Electron bundle (`pnpm desktop:spike`).
//
// What it does, in order:
//   1. `pnpm build` (skip with --skip-build to reuse an existing packages/app/dist);
//   2. stages a throwaway Electron app in dist-desktop/stage/: a package.json, tools/desktop/main.mjs and resolve.mjs,
//      and the build copied to web/ unchanged;
//   3. runs @electron/packager (a tools-only devDependency, pinned exactly) for linux/<this arch> at ELECTRON_VERSION,
//      caching the Electron zip under dist-desktop/cache/ (@electron/get checks it against the release's SHASUMS256);
//   4. writes dist-desktop/roaring-lions-linux-<arch>.tar.gz, the stand-in for an installer, and prints the sizes;
//   5. with --smoke, launches the bundle once headlessly (xvfb-run when there is no $DISPLAY) with RL_DESKTOP_SMOKE=1,
//      which loads index.html, probes WebGL2 and WebGPU, writes dist-desktop/smoke.png and prints one RL_SMOKE line.
//      The run's Chromium profile is dist-desktop/profile/, emptied first, never ~/.config/Roaring Lions.
//
// What it never does: sign, notarise, read a secret, upload to a store, publish or auto-update. Nothing in packages/
// is touched; the app's entry chunk is whatever `pnpm build` makes. Linux only, on purpose: the spike's question is
// whether the build runs in the wrapper at all, and the other targets need signing (see the spike doc).
//
// Flags: --skip-build, --smoke, --no-tar. Output: dist-desktop/ at the repo root (gitignored; eslint ignores dist-*/).
// Spec: docs/superpowers/specs/2026-11-17-desktop-wrapper-spike.md.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exact, and at least two weeks old when chosen (45.2.1 was published 2026-10-31). Bumping it is its own change.
export const ELECTRON_VERSION = '45.2.1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const APP_DIST = path.join(ROOT, 'packages', 'app', 'dist');
const OUT = path.join(ROOT, 'dist-desktop');
const STAGE = path.join(OUT, 'stage');
const BUNDLES = path.join(OUT, 'out');
const CACHE = path.join(OUT, 'cache');
const EXECUTABLE = 'roaring-lions';

const args = new Set(process.argv.slice(2));
const known = new Set(['--skip-build', '--smoke', '--no-tar']);
for (const a of args) {
  if (!known.has(a)) {
    console.error(`[desktop] unknown flag ${a}; known: ${[...known].join(' ')}`);
    process.exit(2);
  }
}

function fail(message) {
  console.error(`[desktop] ${message}`);
  process.exit(1);
}

/** Bytes under a path, following no symlinks (a link counts as its own size, not its target's). */
export function bytesUnder(p) {
  const st = lstatSync(p, { throwIfNoEntry: false });
  if (st === undefined) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of readdirSync(p)) total += bytesUnder(path.join(p, name));
  return total;
}

const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.error) fail(`${cmd} could not start: ${r.error.message}`);
  return r.status ?? 1;
}

if (process.platform !== 'linux') fail(`the spike builds a Linux bundle only (this is ${process.platform})`);
// The two Linux arches the packager builds here; anything else is refused, never silently built as x64.
if (process.arch !== 'x64' && process.arch !== 'arm64') fail(`unsupported arch ${process.arch}: the spike builds linux-x64 or linux-arm64`);
const arch = process.arch;

// 1. The web build, exactly as it deploys. VITE_BASE must be '/': the custom scheme maps '/' to the bundle.
if (!args.has('--skip-build')) {
  const env = { ...process.env };
  delete env.VITE_BASE;
  if (run('pnpm', ['build'], { env }) !== 0) fail('pnpm build failed');
}
if (!existsSync(path.join(APP_DIST, 'index.html'))) fail(`no build at ${APP_DIST}; run without --skip-build`);

// 2. Stage.
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
writeFileSync(
  path.join(STAGE, 'package.json'),
  `${JSON.stringify(
    {
      name: 'roaring-lions-desktop-spike',
      productName: 'Roaring Lions',
      version: rootPkg.version,
      private: true,
      type: 'module',
      main: 'main.mjs',
      license: rootPkg.license,
      description: 'GH-1418 desktop spike: unsigned local bundle. Not for distribution.',
    },
    null,
    2,
  )}\n`,
);
cpSync(path.join(HERE, 'main.mjs'), path.join(STAGE, 'main.mjs'));
cpSync(path.join(HERE, 'resolve.mjs'), path.join(STAGE, 'resolve.mjs'));
cpSync(APP_DIST, path.join(STAGE, 'web'), { recursive: true });
const webBytes = bytesUnder(path.join(STAGE, 'web'));
console.log(`[desktop] staged ${mib(webBytes)} of web build`);

// 3. Package. A dynamic import, so a bad flag or a missing build fails before the packager loads.
const { packager } = await import('@electron/packager');
mkdirSync(CACHE, { recursive: true });
let appPaths;
try {
  appPaths = await packager({
    dir: STAGE,
    out: BUNDLES,
    name: 'Roaring Lions',
    executableName: EXECUTABLE,
    platform: 'linux',
    arch,
    electronVersion: ELECTRON_VERSION,
    overwrite: true,
    // Loose files, no asar: Steam's depot diff works per chunk either way, and loose files keep the spike debuggable.
    asar: false,
    prune: false,
    quiet: true,
    download: { cacheRoot: CACHE },
  });
} catch (err) {
  // A blocked or failed Electron download lands here. Do not work around it (no mirror, no proxy change): report it.
  fail(`@electron/packager failed (an Electron download blocked by the network ends here): ${err?.message ?? err}`);
}
if (!Array.isArray(appPaths) || appPaths.length === 0) fail('@electron/packager returned no bundle path');
const bundle = appPaths[0];
const bundleBytes = bytesUnder(bundle);
const runtimeBytes = bundleBytes - bytesUnder(path.join(bundle, 'resources', 'app'));
console.log(`[desktop] bundle ${bundle}`);
console.log(`[desktop]   on disk ${mib(bundleBytes)} (Electron ${ELECTRON_VERSION} runtime ${mib(runtimeBytes)}, game ${mib(bundleBytes - runtimeBytes)})`);

// 4. The installer stand-in: a gzip tarball, roughly what a Steam depot download or an AppImage costs.
if (!args.has('--no-tar')) {
  const tarball = path.join(OUT, `roaring-lions-linux-${arch}.tar.gz`);
  rmSync(tarball, { force: true });
  if (run('tar', ['-czf', tarball, '-C', path.dirname(bundle), path.basename(bundle)]) !== 0) fail('tar failed');
  console.log(`[desktop]   tar.gz ${mib(statSync(tarball).size)} at ${tarball}`);
}

// 5. Headless launch check.
if (args.has('--smoke')) {
  const binary = path.join(bundle, EXECUTABLE);
  // Chromium refuses to run as root with its sandbox on; a container smoke run is root. A player never is.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const electronArgs = isRoot ? ['--no-sandbox'] : [];
  // main.mjs keeps the smoke run's profile in OUT/profile; start each run from an empty one.
  rmSync(path.join(OUT, 'profile'), { recursive: true, force: true });
  const env = { ...process.env, RL_DESKTOP_SMOKE: '1', RL_DESKTOP_SMOKE_OUT: OUT };
  let cmd = binary;
  let argv = electronArgs;
  if (!process.env.DISPLAY) {
    const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' });
    if (xvfb.status !== 0) fail('no $DISPLAY and no xvfb-run: cannot run the headless launch check');
    cmd = 'xvfb-run';
    argv = ['-a', '-s', '-screen 0 1600x900x24', binary, ...electronArgs];
  }
  console.log(`[desktop] smoke: ${cmd} ${argv.join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd: ROOT, env, encoding: 'utf8', timeout: 180_000 });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('RL_SMOKE '));
  if (line === undefined) {
    console.error(r.stdout);
    console.error(r.stderr);
    fail(`smoke run printed no RL_SMOKE line (exit ${r.status}, signal ${r.signal})`);
  }
  const result = JSON.parse(line.slice('RL_SMOKE '.length));
  console.log(`[desktop] smoke ${result.pass ? 'PASS' : 'FAIL'}`);
  console.log(JSON.stringify(result, null, 2));
  writeFileSync(path.join(OUT, 'smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exit(1);
}
