/**
 * The service worker's routing policy, driven THROUGH THE FILE THAT SHIPS.
 *
 * `assets/sw.js` is a classic worker script, not a module, so there is
 * nothing to import. Rather than restate its rules in a testable copy -- the
 * shape that lets a gate go green while the artifact is wrong -- this
 * evaluates the real file in a `node:vm` context with a stubbed worker
 * global, then calls `strategyFor` out of that context. A top-level
 * `function` declaration in a script becomes a property of its context's
 * global, which is what makes that reachable.
 *
 * What is worth pinning here is every rule whose violation is silent and
 * expensive:
 *
 *  - a NAVIGATION that went cache-first would pin every returning player to
 *    the build they first saw, and no deploy would ever reach them;
 *  - a RANGE request stored as a 200 is a corrupt media file;
 *  - `/video/` cached at all is 6.1 MiB of once-watched briefing;
 *  - a cross-origin or non-GET request touched at all is a class of bug this
 *    worker has no business being able to have.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const SW_PATH = fileURLToPath(new URL('../../../assets/sw.js', import.meta.url));

/** Evaluates the shipped worker with `self.location` set to `href`, and
 *  hands back its `strategyFor`. */
function loadWorker(href: string): (url: URL, request: RequestLike) => string {
  const listeners: Record<string, unknown> = {};
  const context = vm.createContext({
    URL,
    URLSearchParams,
    self: {
      location: { href, origin: new URL(href).origin },
      addEventListener: (type: string, fn: unknown) => {
        listeners[type] = fn;
      },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
      registration: {},
    },
    caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), open: () => Promise.resolve({}) },
    fetch: () => Promise.reject(new Error('no network in this test')),
    console,
  });
  vm.runInContext(readFileSync(SW_PATH, 'utf8'), context);
  const fn = (context as { strategyFor?: unknown }).strategyFor;
  expect(typeof fn, 'assets/sw.js should declare a top-level `strategyFor`').toBe('function');
  return fn as (url: URL, request: RequestLike) => string;
}

interface RequestLike {
  method: string;
  mode?: string;
  headers?: { get(name: string): string | null };
}

const GET: RequestLike = { method: 'GET', mode: 'no-cors', headers: { get: () => null } };
const NAVIGATE: RequestLike = { method: 'GET', mode: 'navigate', headers: { get: () => null } };
const RANGED: RequestLike = { method: 'GET', mode: 'no-cors', headers: { get: (n) => (n === 'range' ? 'bytes=0-' : null) } };

/** Both the deployments this worker has to be correct on: local/preview at
 *  the origin root, and GitHub Pages under a repository sub-path. Every case
 *  below runs against both, because `BASE` is derived from the worker's own
 *  URL and a rule that only holds at `/` would be a Pages-only bug. */
const DEPLOYMENTS = [
  { name: 'root', sw: 'http://localhost:4173/sw.js?v=0.56.0', base: 'http://localhost:4173/' },
  { name: 'pages sub-path', sw: 'https://x.github.io/roaring-lions/sw.js?v=0.56.0', base: 'https://x.github.io/roaring-lions/' },
];

describe.each(DEPLOYMENTS)('the service worker policy ($name)', ({ sw, base }) => {
  const strategyFor = loadWorker(sw);
  const at = (path: string): URL => new URL(path, base);

  it('serves a NAVIGATION network-first, so a deploy always reaches a returning player', () => {
    // The rule that keeps a bad cache from being permanent. index.html is not
    // content-hashed, so cache-first here pins the player to one build.
    expect(strategyFor(at(''), NAVIGATE)).toBe('network-first');
    expect(strategyFor(at('?mission=beit_sahwan_1_recon'), NAVIGATE)).toBe('network-first');
  });

  it("takes Vite's hashed output cache-first, because those bytes cannot change", () => {
    expect(strategyFor(at('assets/main-DEADBEEF.js'), GET)).toBe('cache-first');
    expect(strategyFor(at('assets/index-CAFE1234.css'), GET)).toBe('cache-first');
  });

  it('takes the unhashed publicDir binaries stale-while-revalidate', () => {
    // Not cache-first: re-exporting a mesh changes the bytes under the same
    // URL, so a returning player has to be able to pick the new one up.
    for (const p of [
      'meshes/meshy_soldier.glb',
      'meshes/vehicles/mbt_lavi.glb',
      'textures/desert_sand_tile.jpg',
      'sprites/INF_RIFLE.png',
      'fonts/inter.woff2',
      'audio/ui_click.ogg',
      'ui/portraits/shai.png',
      'campaign/board.png',
      'draco/draco_decoder.wasm',
    ]) {
      expect(strategyFor(at(p), GET), p).toBe('swr');
    }
  });

  it('never touches the briefing videos', () => {
    // 6.1 MiB, watched once, and read with range requests -- the two reasons
    // this directory is absent from PUBLIC_DIRS by name.
    expect(strategyFor(at('video/tel_marum_3.mp4'), GET)).toBe('passthrough');
  });

  it('never touches a RANGE request, whatever it is for', () => {
    // A 206 stored in the Cache API and replayed as a 200 is a corrupt file.
    // Asserted on a path that WOULD otherwise be cached, so this proves the
    // range check wins rather than merely agreeing with the directory rule.
    expect(strategyFor(at('meshes/meshy_soldier.glb'), GET)).toBe('swr');
    expect(strategyFor(at('meshes/meshy_soldier.glb'), RANGED)).toBe('passthrough');
  });

  it('ignores anything that is not a same-origin GET', () => {
    expect(strategyFor(at('meshes/meshy_soldier.glb'), { ...GET, method: 'POST' })).toBe('passthrough');
    expect(strategyFor(new URL('https://example.com/meshes/x.glb'), GET)).toBe('passthrough');
  });

  it('ignores anything outside its own base, which is what makes the Pages sub-path safe', () => {
    // On Pages the worker is scoped to /roaring-lions/; a sibling project at
    // /other/ on the same origin must be none of its business.
    expect(strategyFor(new URL('/other/meshes/x.glb', base), GET)).toBe('passthrough');
    expect(strategyFor(new URL('/favicon.ico', base), GET)).toBe('passthrough');
  });

  it('passes through an unrecognised path rather than defaulting to storing it', () => {
    expect(strategyFor(at('some/new/thing.bin'), GET)).toBe('passthrough');
  });
});

describe('the service worker cache name', () => {
  it('carries the ?v= it was registered with, so a version bump is a new cache', () => {
    // The activate handler deletes every `lions-` cache that is not the
    // current one, so this string is what makes a release drop the old one.
    // Read out of the evaluated file rather than restated.
    const context = vm.createContext({
      URL,
      URLSearchParams,
      self: {
        location: { href: 'https://x.github.io/roaring-lions/sw.js?v=1.2.3', origin: 'https://x.github.io' },
        addEventListener: () => {},
      },
      caches: {},
      console,
    });
    vm.runInContext(readFileSync(SW_PATH, 'utf8'), context);
    // Evaluated as an EXPRESSION in the same context rather than read off its
    // global: `const` bindings live in the context's lexical scope and never
    // become properties of `globalThis`, unlike the `function` declaration
    // `loadWorker` above reaches for.
    expect(vm.runInContext('CACHE', context)).toBe('lions-1.2.3');
    expect(vm.runInContext('BASE', context)).toBe('/roaring-lions/');
  });
});
