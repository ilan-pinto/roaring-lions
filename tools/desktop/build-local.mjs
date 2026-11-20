#!/usr/bin/env node
// GH-1418: package the production web build into an UNSIGNED local Electron desktop build (`pnpm desktop:package`).
//
// What it does, in order:
//   1. reads the demo's content cut (`tools/desktop/demo.json`: the lead's ruling of 20 Nov 2026, the tutorial plus Beit
//      Sahwan I to IV), every id checked against data/missions (`policy.mjs`'s `readDemoConfig`);
//   2. `pnpm build` (skip with --skip-build to reuse an existing packages/app/dist), VITE_BASE cleared and the cut handed
//      over as RL_DEMO_MISSIONS, which bakes it into the bundle and writes `demo-cut.json` beside index.html; then refuses
//      a build that does not carry exactly that cut (`checkBundleCut`, so a --skip-build over a full build is caught) and
//      a build whose `_headers` has no Content-Security-Policy (`requireCsp`);
//   3. stages the app code (package.json, main.mjs, policy.mjs, resolve.mjs, desktop-build.json) and, beside it, the web
//      build copied unchanged;
//   4. runs @electron/packager (pinned exactly) for linux/<this arch> at ELECTRON_VERSION: the code in `app.asar`, the web
//      build as loose files in `resources/web/` (`extraResource`), the Electron zip cached under dist-desktop/cache/ and
//      checked against the SHA-256 pinned in policy.mjs (never a mirror: ELECTRON_MIRROR and friends are cleared);
//   5. flips the Electron fuses (`policy.mjs`'s FUSES, all nine) with @electron/fuses (pinned exactly) and reads the
//      wire back, refusing a binary whose wire differs;
//   6. writes dist-desktop/roaring-lions-linux-<arch>.tar.gz (the stand-in for a depot or an installer), prints sizes;
//   7. with --smoke: launches the shipped bundle once (it must print RL_DESKTOP_READY with smoke:false, its environment
//      asking for the smoke run notwithstanding), then packages a SEPARATE smoke bundle (manifest `smoke: true`) and runs
//      the headless check in it (xvfb-run when there is no $DISPLAY): WebGL2, the policy from inside the page, a
//      screenshot. Every process it starts, it starts in its own process group and stops by that group.
//   8. with --report-commercial: runs `tools/commercial_asset_cut.py --dist` (report only, nothing stripped) and records
//      the count in the manifest.
//   9. with --crash-reports (GH-1414): the SHIPPED bundle's manifest says `crashReports: true`, so it sends crash reports
//      to the Worker (`crash.mjs`). Without the flag no bundle sends any; the smoke bundle never does. The shipped-bundle
//      launch check runs with RL_DESKTOP_NO_CRASH_REPORTS=1 whatever the flag. With --smoke-crash the smoke run also
//      forces a page error and a renderer crash and checks the reports it recorded (never sent).
//
// What it never does: sign, notarise, read a secret, upload to a store, publish or auto-update. Nothing in packages/ is
// touched. Linux only, on purpose: the other targets need signing (spec, section 9).
//
// Flags: --skip-build, --smoke, --no-tar, --report-commercial, --crash-reports, --smoke-crash. Output: dist-desktop/ at the repo root (gitignored; eslint
// ignores dist-*/). Spec: docs/superpowers/specs/2026-11-17-desktop-wrapper-spike.md, section 9.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEMO_CUT_ENV,
  DEMO_CUT_FILE,
  ELECTRON_SHA256,
  ELECTRON_VERSION,
  FUSES,
  checkBundleCut,
  parseStaticHeaders,
  readDemoConfig,
  requireCsp,
} from './policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const APP_DIST = path.join(ROOT, 'packages', 'app', 'dist');
const MISSIONS = path.join(ROOT, 'data', 'missions');
const OUT = path.join(ROOT, 'dist-desktop');
const CACHE = path.join(OUT, 'cache');
const EXECUTABLE = 'roaring-lions';
const PRODUCT = 'Roaring Lions';

const args = new Set(process.argv.slice(2));
const known = new Set(['--skip-build', '--smoke', '--no-tar', '--report-commercial', '--crash-reports', '--smoke-crash']);
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

if (process.platform !== 'linux') fail(`the desktop build packages Linux only (this is ${process.platform}); see the spec, section 9`);
// The two Linux arches the packager builds here; anything else is refused, never silently built as x64.
if (process.arch !== 'x64' && process.arch !== 'arm64') fail(`unsupported arch ${process.arch}: linux-x64 or linux-arm64 only`);
const arch = process.arch;

// 1. The content cut, checked against the missions this checkout ships (each file's own `id`).
let demo;
try {
  const missionIds = readdirSync(MISSIONS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(MISSIONS, f), 'utf8')).id);
  demo = readDemoConfig(JSON.parse(readFileSync(path.join(HERE, 'demo.json'), 'utf8')), missionIds);
} catch (err) {
  fail(String(err?.message ?? err));
}

// 2. The web build, as it deploys but for the cut. VITE_BASE must be '/': the custom scheme maps '/' to the bundle.
if (!args.has('--skip-build')) {
  const env = { ...process.env };
  delete env.VITE_BASE;
  delete env[DEMO_CUT_ENV];
  if (demo.missions !== null) env[DEMO_CUT_ENV] = JSON.stringify(demo.missions);
  if (run('pnpm', ['build'], { env }) !== 0) fail('pnpm build failed');
}
if (!existsSync(path.join(APP_DIST, 'index.html'))) fail(`no build at ${APP_DIST}; run without --skip-build`);

// The build carries exactly that cut, and a CSP; both fail closed.
try {
  const cutFile = path.join(APP_DIST, DEMO_CUT_FILE);
  checkBundleCut(demo, existsSync(cutFile) ? readFileSync(cutFile, 'utf8') : null);
  const headersFile = path.join(APP_DIST, '_headers');
  requireCsp(parseStaticHeaders(existsSync(headersFile) ? readFileSync(headersFile, 'utf8') : ''));
} catch (err) {
  fail(String(err?.message ?? err));
}
console.log(
  demo.missions === null
    ? '[desktop] demo content cut: NONE (demo.json missions: null; the whole build ships).'
    : `[desktop] demo content cut: ${demo.missions.length} missions (${demo.missions.join(', ')}); baked into the bundle and checked.`,
);

const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
const commit = gitHead.status === 0 ? gitHead.stdout.trim() : null;

let commercial = null;
if (args.has('--report-commercial')) {
  const reportFile = path.join(OUT, 'commercial-cut.json');
  mkdirSync(OUT, { recursive: true });
  const r = spawnSync('python3', [path.join(ROOT, 'tools', 'commercial_asset_cut.py'), '--dist', APP_DIST, '--json', reportFile], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) fail(`commercial_asset_cut.py failed (exit ${r.status}): ${r.stderr}`);
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const inBuild = Object.values(report.dist ?? {}).filter((b) => typeof b === 'number');
  commercial = {
    failing: Object.keys(report.excluded ?? {}).length,
    failingInBuild: inBuild.length,
    failingBytesInBuild: inBuild.reduce((a, b) => a + b, 0),
  };
  console.log(`[desktop] commercial gate (REPORT ONLY, nothing stripped; GH-1415): ${JSON.stringify(commercial)}; full list ${reportFile}`);
}

/** Stage, package and fuse one bundle. `smoke` is written into its manifest; only a smoke bundle can run the check. */
async function packageBundle({ smoke }) {
  const kind = smoke ? 'smoke' : 'shipped';
  const stage = path.join(OUT, `stage-${kind}`);
  const appDir = path.join(stage, 'app');
  const webDir = path.join(stage, 'web');
  rmSync(stage, { recursive: true, force: true });
  rmSync(path.join(OUT, kind), { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'roaring-lions-desktop',
        productName: PRODUCT,
        version: rootPkg.version,
        private: true,
        type: 'module',
        main: 'main.mjs',
        license: rootPkg.license,
        description: 'GH-1418 desktop build: unsigned, local only. Not for distribution.',
      },
      null,
      2,
    )}\n`,
  );
  for (const f of ['main.mjs', 'policy.mjs', 'resolve.mjs', 'crash.mjs']) cpSync(path.join(HERE, f), path.join(appDir, f));
  // GH-1414: only a shipped bundle packaged with --crash-reports sends crash reports.
  const crashReports = !smoke && args.has('--crash-reports');
  const manifest = { version: rootPkg.version, commit, electron: ELECTRON_VERSION, smoke, crashReports, demo, commercial };
  writeFileSync(path.join(appDir, 'desktop-build.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(APP_DIST, webDir, { recursive: true });
  console.log(`[desktop] ${kind}: staged ${mib(bytesUnder(webDir))} of web build`);

  // A dynamic import, so a bad flag or a missing build fails before the packager loads.
  const { packager } = await import('@electron/packager');
  mkdirSync(CACHE, { recursive: true });
  // The runtime comes from GitHub's release or from the cache, never from a mirror the environment names.
  for (const k of ['ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_CUSTOM_FILENAME', 'npm_config_electron_mirror']) delete process.env[k];
  let appPaths;
  try {
    appPaths = await packager({
      dir: appDir,
      out: path.join(OUT, kind),
      name: PRODUCT,
      executableName: EXECUTABLE,
      platform: 'linux',
      arch,
      electronVersion: ELECTRON_VERSION,
      overwrite: true,
      // The code in an asar (the OnlyLoadAppFromAsar fuse needs one); the 180 MiB of assets loose beside it, so a
      // Steam depot diff or a patch moves only the files that changed.
      asar: true,
      extraResource: [webDir],
      prune: false,
      quiet: true,
      download: { cacheRoot: CACHE, checksums: ELECTRON_SHA256 },
    });
  } catch (err) {
    // A blocked or failed Electron download, or a checksum mismatch, lands here. Report it; never work around it.
    fail(`@electron/packager failed (a blocked download or a checksum mismatch ends here): ${err?.message ?? err}`);
  }
  if (!Array.isArray(appPaths) || appPaths.length === 0) fail('@electron/packager returned no bundle path');
  const bundle = appPaths[0];
  // The packager leaves the bundle's top directory 0700 (measured); an install readable only by its builder is not one.
  chmodSync(bundle, 0o755);
  rmSync(stage, { recursive: true, force: true });

  const binary = path.join(bundle, EXECUTABLE);
  const { flipFuses, getCurrentFuseWire, FuseV1Options, FuseVersion, FuseState } = await import('@electron/fuses');
  const names = Object.keys(FuseV1Options).filter((k) => Number.isNaN(Number(k)));
  for (const name of Object.keys(FUSES)) if (!names.includes(name)) fail(`policy.mjs names a fuse @electron/fuses does not know: ${name}`);
  for (const name of names) if (!(name in FUSES)) fail(`@electron/fuses knows a fuse policy.mjs does not set: ${name}`);
  const config = { version: FuseVersion.V1, strictlyRequireAllFuses: true };
  for (const [name, on] of Object.entries(FUSES)) config[FuseV1Options[name]] = on;
  await flipFuses(binary, config);
  const wire = await getCurrentFuseWire(binary);
  for (const [name, on] of Object.entries(FUSES)) {
    const want = on ? FuseState.ENABLE : FuseState.DISABLE;
    if (wire[FuseV1Options[name]] !== want) fail(`fuse ${name} reads ${wire[FuseV1Options[name]]} after the flip, want ${want}`);
  }
  const bundleBytes = bytesUnder(bundle);
  const gameBytes = bytesUnder(path.join(bundle, 'resources'));
  console.log(`[desktop] ${kind}: ${bundle}`);
  console.log(
    `[desktop]   on disk ${mib(bundleBytes)} (Electron ${ELECTRON_VERSION} runtime ${mib(bundleBytes - gameBytes)}, resources ${mib(gameBytes)}); fuses flipped and read back`,
  );
  return { bundle, binary, bundleBytes };
}

/**
 * Launch a bundle headlessly in its OWN process group and stop it by that group: xvfb-run, Xvfb and Electron's helpers
 * all go, and nothing else is touched. Resolves with the output when `doneWhen(stdout)` is true, the process exits, or
 * `timeoutMs` passes.
 */
function launch(binary, env, { doneWhen, timeoutMs }) {
  // Chromium refuses to run as root with its sandbox on; a container run is root. A player never is.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const electronArgs = isRoot ? ['--no-sandbox'] : [];
  let cmd = binary;
  let argv = electronArgs;
  if (!process.env.DISPLAY) {
    const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' });
    if (xvfb.status !== 0) fail('no $DISPLAY and no xvfb-run: cannot run the headless launch');
    cmd = 'xvfb-run';
    argv = ['-a', '-s', '-screen 0 1600x900x24', binary, ...electronArgs];
  }
  console.log(`[desktop] launch: ${cmd} ${argv.join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The group has already gone.
      }
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ stdout, stderr, why });
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (doneWhen(stdout)) finish('done');
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('exit', () => setTimeout(() => finish('exit'), 200));
  });
}

const lineOf = (stdout, tag) => {
  const line = stdout.split('\n').find((l) => l.startsWith(`${tag} `));
  return line === undefined ? null : JSON.parse(line.slice(tag.length + 1));
};

// 3-5. The shipped bundle.
const shipped = await packageBundle({ smoke: false });

// 6. The installer stand-in: a gzip tarball, roughly what a Steam depot download or an AppImage costs.
if (!args.has('--no-tar')) {
  const tarball = path.join(OUT, `roaring-lions-linux-${arch}.tar.gz`);
  rmSync(tarball, { force: true });
  if (run('tar', ['-czf', tarball, '-C', path.dirname(shipped.bundle), path.basename(shipped.bundle)]) !== 0) fail('tar failed');
  console.log(`[desktop]   tar.gz ${mib(statSync(tarball).size)} at ${tarball}`);
}

// 7. The launch checks.
if (args.has('--smoke')) {
  // (a) The SHIPPED bundle, asked for the smoke run by its environment, must start as itself and ignore it. Its own
  // HOME, so it never writes into this machine's ~/.config/Roaring Lions.
  const home = path.join(OUT, 'shipped-home');
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const shippedRun = await launch(
    shipped.binary,
    {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      RL_DESKTOP_SMOKE: '1',
      RL_DESKTOP_SMOKE_OUT: OUT,
      // A launch check never sends a crash report, even from a bundle packaged with --crash-reports.
      RL_DESKTOP_NO_CRASH_REPORTS: '1',
    },
    { doneWhen: (s) => s.includes('RL_DESKTOP_READY ') || s.includes('RL_SMOKE '), timeoutMs: 90_000 },
  );
  const ready = lineOf(shippedRun.stdout, 'RL_DESKTOP_READY');
  const smokeLine = lineOf(shippedRun.stdout, 'RL_SMOKE');
  rmSync(home, { recursive: true, force: true });
  if (ready === null || smokeLine !== null || ready.smoke !== false) {
    console.error(shippedRun.stdout);
    console.error(shippedRun.stderr.slice(-4000));
    fail(
      `shipped bundle: want RL_DESKTOP_READY with smoke:false and no RL_SMOKE; got ready=${JSON.stringify(ready)} smoke line=${smokeLine !== null} (${shippedRun.why})`,
    );
  }
  console.log(`[desktop] shipped bundle launched: ${JSON.stringify(ready)} (the smoke variable was ignored)`);

  // (b) The smoke bundle: the same code and web build; its manifest says smoke:true.
  const smokeBundle = await packageBundle({ smoke: true });
  rmSync(path.join(OUT, 'profile'), { recursive: true, force: true });
  const r = await launch(
    smokeBundle.binary,
    { ...process.env, RL_DESKTOP_SMOKE: '1', RL_DESKTOP_SMOKE_OUT: OUT, ...(args.has('--smoke-crash') ? { RL_DESKTOP_SMOKE_CRASH: '1' } : {}) },
    { doneWhen: (s) => s.includes('RL_SMOKE '), timeoutMs: 180_000 },
  );
  const result = lineOf(r.stdout, 'RL_SMOKE');
  // The smoke bundle is a test fixture, not a deliverable.
  rmSync(path.join(OUT, 'smoke'), { recursive: true, force: true });
  if (result === null) {
    console.error(r.stdout);
    console.error(r.stderr.slice(-4000));
    fail(`smoke run printed no RL_SMOKE line (${r.why})`);
  }
  console.log(`[desktop] smoke ${result.pass ? 'PASS' : 'FAIL'}`);
  console.log(JSON.stringify(result, null, 2));
  writeFileSync(path.join(OUT, 'smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exit(1);
}
