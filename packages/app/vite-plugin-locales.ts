// Serves `data/locales/<lang>/{missions,units}.json` at `${base}locales/<lang>/...`, the path the overlay loaders fetch (GH-1406 part 4).
//
// THE GAP THIS CLOSES. Translators' files live in `data/locales/` (README, the validators, `applyMissionLocale`'s docs), but the app's
// Vite `publicDir` is `assets/`, so a loader's `${base}locales/fr/missions.json` was served from `assets/locales/fr/missions.json`, which
// nothing ever wrote. The first shipped translation would have been a 404, and the loaders fell back to English silently. This plugin is
// the whole bridge, in both places the path matters:
//
// - `pnpm dev`: a middleware answers `GET <base>locales/<lang>/missions.json` (and `units.json`) from the data directory, read per request so
//   an edit shows on reload. It answers nothing else and nothing outside the directory (the path is resolved and checked).
// - `pnpm build`: `generateBundle` emits every matching file as an asset at `locales/<lang>/<file>`, which is where Cloudflare's static
//   assets serve it from (`wrangler.jsonc`'s `assets.directory` is this package's `dist`).
//
// WHICH FILES. The set is DERIVED from the directory, never listed by hand: every `<lang>/missions.json` and `<lang>/units.json` except
// `en`'s. `en` is the source text and the loaders never fetch it (`data/locales/en/missions.json` is the generated translator's template),
// so shipping it would be 120 kB nobody asks for. A `README.md`, a stray note or anything deeper is not a locale file and is not served.
//
// A file that is in BOTH this directory and the publicDir's `locales/` is a build error: two sources for one URL would let one silently win.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** The files a locale directory serves, relative and posix: `<lang>/missions.json` or `<lang>/units.json`, never `en/`. */
export const LOCALE_FILE = /^(?!en\/)[a-z][a-z0-9-]*\/(?:missions|units)\.json$/i;

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

export function localesPlugin(dir: URL | string): Plugin {
  const root = resolve(typeof dir === 'string' ? dir : fileURLToPath(dir));
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
        if (!LOCALE_FILE.test(rel)) return next();
        const file = resolve(root, rel);
        if (!file.startsWith(root + sep) || !existsSync(file)) return next();
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
      });
    },
    buildStart() {
      for (const rel of localeFiles(root)) this.addWatchFile(join(root, rel));
    },
    generateBundle() {
      for (const rel of localeFiles(root)) {
        if (publicDir !== false && existsSync(join(publicDir, 'locales', rel))) {
          this.error(`locales/${rel} is in both data/locales and the publicDir (${publicDir}): one URL, two sources`);
        }
        this.emitFile({ type: 'asset', fileName: `locales/${rel}`, source: readFileSync(join(root, rel)) });
      }
    },
  };
}
