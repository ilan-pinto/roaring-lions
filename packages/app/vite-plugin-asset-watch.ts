// Keeps Vite's dynamic-`new URL()` directory listings fresh in dev (GH-147).
//
// THE MECHANISM, because the symptom points nowhere near the cause.
//
// `main.ts` asks for meshes by name:
//
//     new URL(`../../../art/meshes/${id}.glb`, import.meta.url).href
//
// Vite's own `vite:asset-import-meta-url` plugin rewrites that at TRANSFORM
// time into a glob lookup:
//
//     new URL((import.meta.glob('../../../art/meshes/*.glb',
//              { eager: true, import: 'default', query: '?url' }))[
//       `../../../art/meshes/${id}.glb`], import.meta.url)
//
// and `vite:import-glob` then bakes the directory listing into the transform
// result as one static import per file. The listing is a snapshot: it is
// whatever `art/meshes/` contained the last time `main.ts` was transformed.
//
// Vite knows that and handles it — `vite:import-glob` has a `hotUpdate` hook
// that invalidates every importer whose glob matches a created or deleted
// file. That hook is fed by the dev server's chokidar watcher, and the watcher
// is created over `[root, ...configFileDependencies, envFiles, publicDir]`
// (vite/dist/node/chunks/config.js, `_createServer`). For this app `root` is
// `packages/app` and `publicDir` is `<repo>/assets`.
//
// `art/` is under NEITHER. So an added or removed GLB never produces a
// watcher event, `hotUpdate` never runs, `main.ts` is never invalidated, and
// its listing stays snapshot-stale for the life of the dev server.
//
// What that looks like from the outside: the missing key yields `undefined`,
// `new URL(undefined, import.meta.url)` resolves to `/src/undefined`, Vite's
// SPA fallback answers that with `index.html` at HTTP 200, and GLTFLoader
// reports
//
//     boot failed: SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON
//         at JSON.parse (<anonymous>)
//         at GLTFLoader.parse (.../three_addons_loaders_GLTFLoader__js.js)
//
// — a JSON parse error, in a mesh loader, naming a file nobody touched. The
// asset is on disk and correct. `touch packages/app/src/main.ts` "fixed" it
// only because editing the importer is the one thing that does re-run the
// glob, and that workaround is what this plugin exists to delete.
//
// THE FIX is one line of intent: put the globbed directories under the
// watcher, and Vite's own invalidation does the rest. Nothing here duplicates
// the glob or the module graph.
//
// WHY IT DERIVES THE DIRECTORIES INSTEAD OF LISTING THEM. A hardcoded list
// would be a second registry of asset locations, and this repository has a
// standing scar from exactly that shape: `SPRITE_MAP` in `main.ts` is a
// hand-kept list of which sheets to load, and art has shipped complete,
// gate-passing and drawing NOTHING six times on this branch because someone
// added the asset and not the list entry. A watch list maintained by hand
// would fail the same way and fail silently — the app would break exactly as
// it does today, and the next reader would find a plugin that claims to have
// fixed it.
//
// So the list is not written down. This plugin finds the directories itself,
// using the SAME detection rule Vite's own plugin uses (the regex below is
// copied from `assetImportMetaUrl.ts`), and watches whatever each module globs
// into. A new globbed directory anywhere in the app is covered with nothing to
// remember.
//
// It does that TWICE, and the first one is not redundant.
//
//  1. At server start, by reading the app's own `src/` off disk. This is what
//     closes a race that a transform-time watch cannot. `watcher.add()` is
//     asynchronous, and chokidar walks the new path with `ignoreInitial: true`
//     — so a file created DURING that walk is recorded silently instead of
//     announced, and the invalidation is lost for the life of the server.
//     Watching at transform time leaves that window open around the first page
//     load, which is exactly when a dev session is busiest. Measured before
//     this was added: the plugin's own integration test failed 1 run in 6 for
//     precisely this reason, and a bug that bites sometimes is the shape this
//     whole ticket was.
//  2. At transform, for anything the `src/` walk cannot see — a module in
//     another package, or a file created after the server was already up.
//
// Over-matching is safe and under-matching is not, which is why this errs
// toward watching: a directory watched needlessly costs one chokidar handle,
// a directory missed costs the bug above. `.add()` on an already-watched path
// is a no-op in chokidar, so the repeated calls a hot dev session produces
// cost nothing.
//
// Dev only. `apply: 'serve'` — a production build lists the directory once and
// exits, so there is no snapshot to keep fresh.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/** Extensions the startup walk reads. Anything Vite would transform. */
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']);

// Copied from vite/src/node/plugins/assetImportMetaUrl.ts so that what this
// plugin watches and what Vite globs cannot drift apart. Matches
// `new URL(<string literal>, import.meta.url)`; only the backtick form with a
// `${}` in it becomes a glob, which `globDirOf` re-checks below.
const ASSET_IMPORT_META_URL_RE =
  /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/g;

/**
 * The directory a dynamic `new URL()` specifier globs into, resolved against
 * the importing module, or `null` when the specifier is not a glob at all.
 *
 * `rawUrl` is the literal INCLUDING its quotes, as the regex captures it.
 *
 * Mirrors Vite's `buildGlobPattern`: every `${...}` becomes `*`. The directory
 * is everything before the first `*`; when a `${...}` sits in a directory
 * segment rather than the basename the result is the parent of that segment,
 * which is correct because chokidar watches recursively.
 *
 * Vite additionally skips a pattern whose first character is `*`. This does
 * not need its own guard here and briefly had one: a specifier that reaches
 * that line has already been required to start with `./` or `../`, so its
 * first character is never `*`. The guard was written, then removed after it
 * survived deletion with every test still green — dead code that reads as a
 * safety check is worse than no check.
 */
export function globDirOf(rawUrl: string, importerId: string): string | null {
  if (rawUrl[0] !== '`' || !rawUrl.includes('${')) return null;

  // Strip the backticks, then the `?query` Vite splits off before globbing.
  let spec = rawUrl.slice(1, -1);
  const q = spec.indexOf('?');
  if (q !== -1) spec = spec.slice(0, q);

  // Only relative specifiers. Bare and root-relative ones resolve through the
  // resolver rather than the importer's directory, and no module in this app
  // uses them here; watching the wrong tree would be worse than not watching.
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;

  const pattern = spec.replace(/\$\{[^}]*\}/g, '*');
  const star = pattern.indexOf('*');
  if (star === -1) return null;

  const head = pattern.slice(0, star);
  const dir = head.endsWith('/') ? head.slice(0, -1) : path.posix.dirname(head);
  return path.resolve(path.dirname(importerId), dir);
}

/** Every directory the dynamic `new URL()` specifiers in `code` glob into. */
export function globDirsIn(code: string, file: string): string[] {
  if (!code.includes('import.meta.url')) return [];
  const out: string[] = [];
  ASSET_IMPORT_META_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASSET_IMPORT_META_URL_RE.exec(code))) {
    const dir = globDirOf(match[1], file);
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}

/** Source files under `dir`, recursively. Build output and deps skipped. */
function sourceFilesUnder(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name[0] === '.' || e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFilesUnder(full, out);
    else if (SOURCE_EXT.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

/**
 * Watches the directories the app's dynamic `new URL()` specifiers glob into,
 * so that adding or removing an asset invalidates the module that lists it.
 */
export function assetWatchPlugin(): Plugin {
  let server: ViteDevServer | undefined;
  const watched = new Set<string>();

  /** Watches `dirs` that exist and are not already watched. */
  function watch(dirs: string[]): string[] {
    const added: string[] = [];
    for (const dir of dirs) {
      if (watched.has(dir)) continue;
      watched.add(dir);
      // A directory that does not exist yet has nothing to list, so its glob
      // has no snapshot to go stale. The transform that follows its creation
      // picks it up.
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      server?.watcher.add(dir);
      added.push(dir);
    }
    return added;
  }

  return {
    name: 'lions-asset-watch',
    apply: 'serve',

    configureServer(s) {
      server = s;
      const src = path.join(s.config.root, 'src');
      const added: string[] = [];
      for (const file of sourceFilesUnder(src)) {
        added.push(...watch(globDirsIn(readFileSync(file, 'utf8'), file)));
      }
      if (added.length) {
        const rel = added.map((d) => path.relative(s.config.root, d)).join(', ');
        s.config.logger.info(`  ➜  Assets:  watching ${rel} for adds (GH-147)`);
      }
    },

    transform(code, id) {
      // The net for what the startup walk cannot see. `id` carries a query for
      // asset modules; only the path matters here.
      if (!server || id.includes('/node_modules/') || id[0] === '\0') return null;
      for (const dir of watch(globDirsIn(code, id.split('?')[0]))) {
        server.config.logger.info(
          `  ➜  watching ${path.relative(server.config.root, dir)} for asset adds (GH-147)`,
          { timestamp: true }
        );
      }
      return null;
    },
  };
}
