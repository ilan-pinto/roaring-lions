// Serves `data/locales/<lang>/{missions,units,places}.json` at `${base}locales/<lang>/...`, the path the overlay loaders fetch (GH-1406 part 4).
//
// THE GAP THIS CLOSES. Translators' files live in `data/locales/` (README, the validators, `applyMissionLocale`'s docs), but the app's
// Vite `publicDir` is `assets/`, so a loader's `${base}locales/fr/missions.json` was served from `assets/locales/fr/missions.json`, which
// nothing ever wrote. The first shipped translation would have been a 404, and the loaders fell back to English silently. This plugin is
// the whole bridge, in both places the path matters:
//
// - `pnpm dev`: a middleware answers `GET <base>locales/<lang>/missions.json` (and `units.json`, `places.json`) from the data directory, read per request so
//   an edit shows on reload. It answers nothing else and nothing outside the directory (the path is resolved and checked).
// - `pnpm build`: `generateBundle` emits every matching file as an asset at `locales/<lang>/<file>`, which is where Cloudflare's static
//   assets serve it from (`wrangler.jsonc`'s `assets.directory` is this package's `dist`).
//
// WHICH FILES. The set is DERIVED from the directory, never listed by hand: every `<lang>/missions.json`, `<lang>/units.json` and `<lang>/places.json` (GH-1406) except
// `en`'s. `en` is the source text and the loaders never fetch it (`data/locales/en/missions.json` is the generated translator's template),
// so shipping it would be 120 kB nobody asks for. A `README.md`, a stray note or anything deeper is not a locale file and is not served.
//
// THE CHROME CATALOGUE (menus, the HUD) is the other file the app fetches: `loadLocale` asks for `${base}locales/<id>.json`, a flat file. It
// has no home in `data/locales/`; it is the sibling of `packages/app/src/i18n/en.json` that `locales.ts` has always promised, so a translator
// adds `packages/app/src/i18n/fr.json` and this plugin serves it at `locales/fr.json` the same way. Same derivation (every `<id>.json` there
// but `en.json`, no list), same rules. Nothing ships one today.
//
// SYMLINKS ARE NOT FOLLOWED, in dev or in the build: a locale directory or file that is a symlink is not a locale file (one definition,
// `localeFiles`, and the dev server answers only what it lists).
//
// A file that is in BOTH this directory and the publicDir's `locales/` is a build error: two sources for one URL would let one silently win.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** The files a locale directory serves, relative and posix: `<lang>/missions.json`, `<lang>/units.json` or `<lang>/places.json`, never `en/`. */
export const LOCALE_FILE = /^(?!en\/)[a-z][a-z0-9-]*\/(?:missions|units|places)\.json$/i;

/** Every locale file under `dir`, sorted, as `<lang>/<file>`. Empty when the directory is missing or holds none. */
export function localeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const lang of readdirSync(dir, { withFileTypes: true })) {
    if (!lang.isDirectory()) continue;
    for (const f of readdirSync(join(dir, lang.name), { withFileTypes: true })) {
      const rel = posix.join(lang.name, f.name);
      if (f.isFile() && LOCALE_FILE.test(rel)) out.push(rel);
    }
  }
  return out.sort();
}

/** The chrome catalogues a directory serves, as `<id>.json`: every flat `<id>.json` but `en.json` (the bundled source), no symlinks. */
export const CHROME_FILE = /^(?!en\.json$)[a-z][a-z0-9-]*\.json$/i;

export function chromeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && CHROME_FILE.test(f.name))
    .map((f) => f.name)
    .sort();
}

/** The path guard, on its own: true when `file` is strictly inside `root`. A second layer behind the file lists, tested separately from them. */
export function insideDir(root: string, file: string): boolean {
  return resolve(file).startsWith(resolve(root) + sep);
}

type Served = { rel: string; file: string };

/** Every file the plugin serves, as the URL path under `locales/` and the file it comes from. */
export function servedFiles(root: string, chromeDir: string | null): Served[] {
  return [
    ...localeFiles(root).map((rel) => ({ rel, file: join(root, rel) })),
    ...(chromeDir === null ? [] : chromeFiles(chromeDir).map((rel) => ({ rel, file: join(chromeDir, rel) }))),
  ];
}

/**
 * `dir` is `data/locales`; `chromeDir` the folder holding `en.json` and its sibling chrome catalogues (omit for none).
 */
export function localesPlugin(dir: URL | string, chromeDir?: URL | string): Plugin {
  const asPath = (d: URL | string): string => resolve(typeof d === 'string' ? d : fileURLToPath(d));
  const root = asPath(dir);
  const chrome = chromeDir === undefined ? null : asPath(chromeDir);
  /** The file for a request path under `locales/`, or null: it must be one of the DERIVED files and inside its directory. */
  const find = (rel: string): string | null => {
    const hit = servedFiles(root, chrome).find((x) => x.rel === rel);
    const home = hit === undefined ? null : rel.includes('/') ? root : chrome;
    return hit !== undefined && home !== null && insideDir(home, hit.file) ? hit.file : null;
  };
  let base = '/';
  let publicDir: string | false = false;
  return {
    name: 'lions-locales',
    configResolved(config) {
      base = config.base;
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.watcher.add(root);
      if (chrome !== null && existsSync(chrome)) server.watcher.add(chrome);
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const pathname = (req.url ?? '').split('?')[0];
        // The dev server may or may not have stripped `base` yet, so accept the path with or without it.
        const path = base !== '/' && pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
        if (!path.startsWith('/locales/')) return next();
        let rel: string;
        try {
          rel = decodeURIComponent(path.slice('/locales/'.length));
        } catch {
          return next();
        }
        const file = find(rel);
        if (file === null) return next();
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
      });
    },
    buildStart() {
      for (const { file } of servedFiles(root, chrome)) this.addWatchFile(file);
    },
    generateBundle() {
      for (const { rel, file } of servedFiles(root, chrome)) {
        if (publicDir !== false && existsSync(join(publicDir, 'locales', rel))) {
          this.error(`locales/${rel} is in both its source folder and the publicDir (${publicDir}): one URL, two sources`);
        }
        this.emitFile({ type: 'asset', fileName: `locales/${rel}`, source: readFileSync(file) });
      }
    },
  };
}
