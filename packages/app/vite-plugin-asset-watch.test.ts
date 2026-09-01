// GH-147: a mesh added while the dev server runs left Vite's baked-in
// directory listing stale, and the app booted into
//
//   SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON
//       at GLTFLoader.parse
//
// because the missing glob key produced `undefined`, `new URL(undefined, ...)`
// resolved to `/src/undefined`, and the SPA fallback answered with index.html.
//
// The first test here is a NEGATIVE CONTROL and it asserts the BUG. It runs a
// real dev server without the plugin over the same geometry the app has — an
// asset directory ABOVE the Vite root — adds a file, and asserts the listing
// does not change. It is not decoration: it is what stops the second test from
// passing vacuously. If Vite ever starts watching above the root on its own,
// or if the fixture stops exercising the glob path at all, the control goes
// red and says so, instead of the real test quietly asserting nothing.
//
// The second test is the fix, and it is red the moment `assetWatchPlugin` is
// removed from the plugin list or stops resolving the directory.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createServer, type Plugin } from 'vite';
import { assetWatchPlugin, globDirOf } from './vite-plugin-asset-watch';

/**
 * A throwaway project with the geometry that causes GH-147: the globbed asset
 * directory sits ABOVE the Vite root, so the dev server's own watcher (which
 * covers `root`, the config's dependencies, the env files and `publicDir`)
 * does not cover it.
 *
 *   <tmp>/art/a.glb      <- globbed, above root
 *   <tmp>/app/           <- vite root
 *   <tmp>/app/src/entry.ts
 */
function makeFixture(): { dir: string; root: string; art: string } {
  // `realpathSync` because on macOS `tmpdir()` is `/var/...`, a symlink to
  // `/private/var/...`. Vite resolves module ids through the real path, so
  // without this the root and the resolved id disagree and every load fails
  // with "Failed to load url /src/entry.ts ... Does the file exist?".
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'lions-glob-')));
  const art = path.join(dir, 'art');
  const root = path.join(dir, 'app');
  mkdirSync(art);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(art, 'a.glb'), '');
  writeFileSync(
    path.join(root, 'src', 'entry.ts'),
    'export const urlFor = (name: string): string =>\n' +
      '  new URL(`../../art/${name}.glb`, import.meta.url).href;\n'
  );
  return { dir, root, art };
}

/**
 * A port the OS just handed out and immediately released. Vite treats
 * `port: 0` as absent and falls back to 5173, then walks upward looking for a
 * free one — which on a developer's machine means knocking on the port their
 * dev server is already using. Asking the OS first and pinning `strictPort`
 * keeps this test off every port anyone is actually running on.
 */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(root: string, plugins: Plugin[]) {
  const port = await freePort();
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins,
    // Keep the run hermetic and quick: no dep scan, and nothing written back
    // into the repository.
    cacheDir: path.join(root, '.vite'),
    optimizeDeps: { noDiscovery: true },
    // A real listening server, because the watcher and the HMR path that
    // carries the invalidation only run on one.
    server: { port, strictPort: true, host: '127.0.0.1' },
  });
  await server.listen();
  return server;
}

/** The transformed source of the entry module, re-requested each call. */
async function listing(server: Awaited<ReturnType<typeof startServer>>): Promise<string> {
  const res = await server.transformRequest('/src/entry.ts');
  return res?.code ?? '';
}

/**
 * Re-reads the listing until it mentions `needle`, or the budget runs out.
 * Returns whether it ever did. Both tests use the same budget so that "stale"
 * and "fresh" are decided by the same clock.
 */
async function waitForListing(
  server: Awaited<ReturnType<typeof startServer>>,
  needle: string,
  budgetMs = 8000
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if ((await listing(server)).includes(needle)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('globDirOf', () => {
  const importer = '/repo/packages/app/src/main.ts';

  it('resolves the directory a dynamic specifier globs into', () => {
    expect(globDirOf('`../../../art/meshes/${id}.glb`', importer)).toBe('/repo/art/meshes');
    expect(globDirOf('`../../../art/meshes/vehicles/${id}.glb`', importer)).toBe(
      '/repo/art/meshes/vehicles'
    );
    expect(globDirOf('`./sub/${a}_${b}.glb`', importer)).toBe('/repo/packages/app/src/sub');
  });

  it('takes the parent when the interpolation is a directory segment', () => {
    // Vite globs this as `../../../art/*/x.glb`; chokidar watches
    // recursively, so the parent is the right watch.
    expect(globDirOf('`../../../art/${kind}/x.glb`', importer)).toBe('/repo/art');
  });

  it('drops the query the way Vite does before globbing', () => {
    // A trailing static query cannot reach the directory either way.
    expect(globDirOf('`../../../art/meshes/${id}.glb?url`', importer)).toBe('/repo/art/meshes');
    // This is the case the strip exists for, and the only one that can tell
    // whether it happened. Vite splits the query off FIRST and then asks
    // whether what remains still interpolates. Here it does not, so Vite
    // resolves one file and bakes in no listing at all — nothing to keep
    // fresh. Leave the query on and this reads as a glob.
    expect(globDirOf('`../../../art/meshes/inf_squad.glb?v=${n}`', importer)).toBeNull();
  });

  it('ignores specifiers that are not globs', () => {
    // No interpolation: Vite resolves these to a single file, no listing.
    expect(globDirOf('`../../../art/meshes/inf_squad.glb`', importer)).toBeNull();
    expect(globDirOf("'../../../art/meshes/inf_squad.glb'", importer)).toBeNull();
    // Leading `*`: Vite refuses to glob it, so there is nothing to watch.
    // Caught by the relative-only rule below rather than by a rule of its
    // own — a dedicated guard for this was written and then deleted, because
    // removing it left every test green.
    expect(globDirOf('`${dir}/x.glb`', importer)).toBeNull();
    // Non-relative: resolved through the resolver, not the importer's dir.
    expect(globDirOf('`/art/${id}.glb`', importer)).toBeNull();
    expect(globDirOf('`pkg/art/${id}.glb`', importer)).toBeNull();
  });
});

describe('dynamic new URL() listings above the Vite root', () => {
  it('NEGATIVE CONTROL: go stale without the plugin — this is GH-147', async () => {
    const { dir, root, art } = makeFixture();
    const server = await startServer(root, []);
    try {
      expect(await listing(server)).toContain('a.glb');
      writeFileSync(path.join(art, 'b.glb'), '');
      expect(await waitForListing(server, 'b.glb')).toBe(false);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('are watched from server start, before any module is transformed', async () => {
    // Not a nicety. `watcher.add()` is async and chokidar walks the new path
    // with `ignoreInitial: true`, so a file created during that walk is
    // recorded silently rather than announced and its invalidation is lost
    // for the life of the server. Registering only at transform time leaves
    // that window open across the first page load — measured at 1 failure in
    // 6 runs of the test below before the startup walk existed.
    const { dir, root, art } = makeFixture();
    const server = await startServer(root, [assetWatchPlugin()]);
    try {
      const deadline = Date.now() + 8000;
      let watching = false;
      // No transformRequest anywhere above this line: the only thing that can
      // have registered this watch is the startup walk of `<root>/src`.
      while (!(watching = Object.keys(server.watcher.getWatched()).includes(art))) {
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(watching).toBe(true);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('stay fresh with the plugin: a file added after the transform is listed', async () => {
    const { dir, root, art } = makeFixture();
    const server = await startServer(root, [assetWatchPlugin()]);
    try {
      // The first transform is what registers the watch and what bakes in the
      // snapshot that used to go stale.
      expect(await listing(server)).toContain('a.glb');
      writeFileSync(path.join(art, 'b.glb'), '');
      expect(await waitForListing(server, 'b.glb')).toBe(true);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
