// GH-1406 part 4: `data/locales/<lang>/{missions,units}.json` must reach the URL the loaders fetch, in the build and in `pnpm dev`. The
// build test RUNS a real Vite build over a fixture directory and reads the output, because a plugin that is not in the output is the whole
// failure this exists to prevent.
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME_FILE, LOCALE_FILE, chromeFiles, insideDir, localeFiles, localesPlugin, servedFiles } from './vite-plugin-locales';

let tmp: string;
let locales: string;
let chrome: string;
let app: string;

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'lions-locales-'));
  locales = join(tmp, 'data-locales');
  write(join(locales, 'fr', 'missions.json'), '{"m1":{"name":"Point d\'appui"}}');
  write(join(locales, 'fr', 'units.json'), '{"inf_squad":{"name":"Section"}}');
  write(join(locales, 'he', 'units.json'), '{"inf_squad":{"name":"X"}}');
  write(join(locales, 'en', 'missions.json'), '{"m1":{"name":"the generated template, never served"}}');
  write(join(locales, 'README.md'), '# not a locale file');
  write(join(locales, 'fr', 'notes.json'), '{"not":"a locale file"}');
  write(join(locales, 'fr', 'deeper', 'missions.json'), '{"not":"two levels down"}');
  // Files one level ABOVE the directory, for the traversal tests. A request for `../missions.json` does not match the filename rule (a language
  // starts with a letter), so these are rejected by the rule first; the path guard is tested on its own below (`insideDir`).
  write(join(tmp, 'missions.json'), '{"outside":true}');
  write(join(tmp, 'units.json'), '{"outside":true}');
  // Symlinks are not followed (dev and build alike): a symlinked file and a symlinked locale directory, both pointing at real content.
  symlinkSync(join(tmp, 'missions.json'), join(locales, 'fr', 'linked.json'));
  mkdirSync(join(locales, 'xx'), { recursive: true });
  symlinkSync(join(tmp, 'missions.json'), join(locales, 'xx', 'missions.json'));
  symlinkSync(join(locales, 'fr'), join(locales, 'yy'));
  // The chrome catalogues: flat `<id>.json` beside `en.json`.
  chrome = join(tmp, 'i18n');
  write(join(chrome, 'en.json'), '{"the":"bundled source, never served"}');
  write(join(chrome, 'fr.json'), '{"menu.play":"Jouer"}');
  write(join(chrome, 'pt-br.json'), '{"menu.play":"Jogar"}');
  write(join(chrome, 'notes.txt'), 'not json');
  write(join(chrome, 'nested', 'de.json'), '{"not":"a flat file"}');
  symlinkSync(join(tmp, 'missions.json'), join(chrome, 'linked.json'));
  app = join(tmp, 'app');
  write(join(app, 'index.html'), '<!doctype html><script type="module" src="/main.js"></script>');
  write(join(app, 'main.js'), 'console.log("hi");');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('which files are locale files', () => {
  it('is `<lang>/missions.json` and `<lang>/units.json` for any lang but en, and nothing else', () => {
    for (const ok of ['fr/missions.json', 'fr/units.json', 'he/units.json', 'pt-br/missions.json']) expect(LOCALE_FILE.test(ok), ok).toBe(true);
    for (const no of ['en/missions.json', 'en/units.json', 'README.md', 'fr/notes.json', 'fr/deeper/missions.json', 'missions.json', '../fr/missions.json', 'fr/missions.json.bak']) {
      expect(LOCALE_FILE.test(no), no).toBe(false);
    }
  });
  it('is DERIVED from the directory: the fixture yields exactly the three files and nothing else (a symlinked file or directory is not one)', () => {
    expect(localeFiles(locales)).toEqual(['fr/missions.json', 'fr/units.json', 'he/units.json']);
  });
  it('the chrome catalogue is a flat `<id>.json` but `en.json`, and DERIVED the same way', () => {
    for (const ok of ['fr.json', 'pt-br.json', 'he.json']) expect(CHROME_FILE.test(ok), ok).toBe(true);
    for (const no of ['en.json', 'notes.txt', 'fr/de.json', '../fr.json', 'fr.json.bak', '.json']) expect(CHROME_FILE.test(no), no).toBe(false);
    expect(chromeFiles(chrome)).toEqual(['fr.json', 'pt-br.json']);
    expect(chromeFiles(join(tmp, 'nope'))).toEqual([]);
    // today en.json and the staged de.json live there; only de.json, es-ES.json, fr.json and ru.json are served (en is bundled). `de`, `es-ES`, `fr` and `ru` are not in LOCALES yet, so nothing fetches it.
    expect(chromeFiles(join(__dirname, 'src', 'i18n'))).toEqual(['de.json', 'es-ES.json', 'fr.json', 'ru.json']);
    expect(servedFiles(locales, chrome).map((x) => x.rel)).toEqual(['fr/missions.json', 'fr/units.json', 'he/units.json', 'fr.json', 'pt-br.json']);
  });
  it('the path guard is its own layer: a file outside the directory is refused whatever the filename rule would say', () => {
    expect(insideDir(locales, join(locales, 'fr', 'missions.json'))).toBe(true);
    expect(insideDir(locales, join(locales, '..', 'missions.json'))).toBe(false);
    expect(insideDir(locales, join(locales, '..', 'data-locales-evil', 'missions.json'))).toBe(false);
    expect(insideDir(locales, locales)).toBe(false);
    // and the filename rule is its own layer: `..` as a language never matches it, so the guard is not what stops this one
    expect(LOCALE_FILE.test('../missions.json')).toBe(false);
  });
  it('is empty for a directory that is missing, and serves only the staged German, Spanish, French and Russian for the shipped one today (the en template is never served)', () => {
    expect(localeFiles(join(tmp, 'nope'))).toEqual([]);
    expect(localeFiles(join(__dirname, '..', '..', 'data', 'locales'))).toEqual(['de/missions.json', 'de/units.json', 'es-ES/missions.json', 'es-ES/units.json', 'fr/missions.json', 'fr/units.json', 'ru/missions.json', 'ru/units.json']);
  });
});

describe('the build emits them at locales/<lang>/<file>', () => {
  async function run(dir: string, extra: { publicDir?: string | false; chromeDir?: string; base?: string } = {}): Promise<string> {
    const outDir = mkdtempSync(join(tmp, 'out-'));
    await build({
      root: app, configFile: false, logLevel: 'silent', publicDir: extra.publicDir ?? false, base: extra.base ?? '/',
      plugins: [localesPlugin(dir, extra.chromeDir)], build: { outDir, emptyOutDir: true },
    });
    return outDir;
  }
  const all = (dir: string, prefix = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));

  it('every locale file is in the build output, byte for byte, and the template, the README and the stray files are not', async () => {
    const out = await run(locales);
    const emitted = all(out).filter((f) => f.startsWith('locales/')).sort();
    expect(emitted).toEqual(['locales/fr/missions.json', 'locales/fr/units.json', 'locales/he/units.json']);
    for (const rel of ['fr/missions.json', 'fr/units.json', 'he/units.json']) {
      expect(readFileSync(join(out, 'locales', rel), 'utf8')).toBe(readFileSync(join(locales, rel), 'utf8'));
    }
    expect(existsSync(join(out, 'locales', 'en'))).toBe(false);
    // symlinks are skipped: the linked file, the linked locale directory and the one inside xx never reach the output
    expect(existsSync(join(out, 'locales', 'fr', 'linked.json'))).toBe(false);
    expect(existsSync(join(out, 'locales', 'yy'))).toBe(false);
    expect(existsSync(join(out, 'locales', 'xx'))).toBe(false);
  }, 60_000);

  it('emits the chrome catalogues flat at locales/<id>.json, and not en.json, the notes, the nested file or the symlink', async () => {
    const out = await run(locales, { chromeDir: chrome });
    expect(all(out).filter((f) => f.startsWith('locales/')).sort()).toEqual([
      'locales/fr.json', 'locales/fr/missions.json', 'locales/fr/units.json', 'locales/he/units.json', 'locales/pt-br.json',
    ]);
    expect(readFileSync(join(out, 'locales', 'fr.json'), 'utf8')).toBe(readFileSync(join(chrome, 'fr.json'), 'utf8'));
  }, 60_000);

  it('a non-root base changes nothing about the output paths (the app prefixes the URL, the files stay at locales/...)', async () => {
    const out = await run(locales, { chromeDir: chrome, base: '/game/' });
    expect(all(out).filter((f) => f.startsWith('locales/')).sort()).toEqual([
      'locales/fr.json', 'locales/fr/missions.json', 'locales/fr/units.json', 'locales/he/units.json', 'locales/pt-br.json',
    ]);
  }, 60_000);

  it('a file in both the data directory and the publicDir is a build error (one URL, two sources)', async () => {
    const pub = join(tmp, 'public');
    write(join(pub, 'locales', 'fr', 'missions.json'), '{}');
    write(join(pub, 'locales', 'fr.json'), '{}');
    await expect(run(locales, { publicDir: pub })).rejects.toThrow(/in both its source folder and the publicDir/);
  }, 60_000);
});

describe('the dev server serves them at /locales/<lang>/<file>', () => {
  // `hmr: false`: with HMR on, middleware mode opens a WebSocket on the FIXED port 24678, which collides when specs run in parallel.
  async function withServer(fn: (base: string) => Promise<void>, appBase = '/'): Promise<void> {
    const vite = await createServer({
      root: app, configFile: false, logLevel: 'silent', appType: 'custom', base: appBase,
      server: { middlewareMode: true, hmr: false }, plugins: [localesPlugin(locales, chrome)],
    });
    const http = createHttpServer((req, res) =>
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('fell through');
      })
    );
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    try {
      await fn(`http://127.0.0.1:${(http.address() as AddressInfo).port}`);
    } finally {
      await new Promise<void>((r) => http.close(() => r()));
      await vite.close();
    }
  }

  it('answers a locale file with its bytes as JSON, with a query string, and not a file it should not', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/locales/fr/missions.json?t=1`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.text()).toBe(readFileSync(join(locales, 'fr', 'missions.json'), 'utf8'));
      for (const no of ['/locales/en/missions.json', '/locales/README.md', '/locales/fr/notes.json', '/locales/xx/missions.json', '/other/fr/missions.json']) {
        const r = await fetch(`${base}${no}`);
        expect(r.status, no).toBe(404);
        expect(await r.text(), no).toBe('fell through');
      }
    });
  }, 60_000);

  it('does not read outside the directory: a traversal falls through (the filename rule and the file list stop these; the guard has its own test above)', async () => {
    await withServer(async (base) => {
      for (const evil of ['/locales/..%2Fmissions.json', '/locales/%2e%2e/units.json', '/locales/..%2F..%2Fapp%2Findex.html', '/locales/fr%2F..%2F..%2Fapp%2Fmain.js']) {
        const r = await fetch(`${base}${evil}`);
        expect(r.status, evil).toBe(404);
        expect(await r.text(), evil).toBe('fell through');
      }
    });
  }, 60_000);

  it('does not follow a symlink: the linked file, the file inside a linked directory and the linked directory itself all fall through', async () => {
    await withServer(async (base) => {
      for (const linked of ['/locales/fr/linked.json', '/locales/xx/missions.json', '/locales/yy/missions.json', '/locales/linked.json']) {
        const r = await fetch(`${base}${linked}`);
        expect(r.status, linked).toBe(404);
        expect(await r.text(), linked).toBe('fell through');
      }
    });
  }, 60_000);

  it('serves the chrome catalogue flat at /locales/<id>.json, and not en.json, a nested file or the notes', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/locales/fr.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.text()).toBe(readFileSync(join(chrome, 'fr.json'), 'utf8'));
      expect(await (await fetch(`${base}/locales/pt-br.json`)).text()).toBe(readFileSync(join(chrome, 'pt-br.json'), 'utf8'));
      for (const no of ['/locales/en.json', '/locales/notes.txt', '/locales/de.json', '/locales/nested/de.json']) {
        const r = await fetch(`${base}${no}`);
        expect(r.status, no).toBe(404);
        expect(await r.text(), no).toBe('fell through');
      }
    });
  }, 60_000);

  it('under a non-root base (/game/) the loaders URL, base included, is served, for a mission file and for the chrome catalogue', async () => {
    await withServer(async (base) => {
      // `${base}locales/<lang>/missions.json` is exactly what the app fetches
      const mission = await fetch(`${base}/game/locales/fr/missions.json`);
      expect(mission.status).toBe(200);
      expect(await mission.text()).toBe(readFileSync(join(locales, 'fr', 'missions.json'), 'utf8'));
      const flat = await fetch(`${base}/game/locales/fr.json?t=2`);
      expect(flat.status).toBe(200);
      expect(await flat.text()).toBe(readFileSync(join(chrome, 'fr.json'), 'utf8'));
      for (const no of ['/game/locales/en/missions.json', '/game/locales/en.json', '/game/locales/xx/missions.json']) {
        const r = await fetch(`${base}${no}`);
        expect(r.status, no).toBe(404);
      }
    }, '/game/');
  }, 60_000);
});

describe('the real config registers it', () => {
  it('apps/vite.config.ts lists localesPlugin over the data/locales directory (source guard)', () => {
    const cfg = readFileSync(join(__dirname, 'vite.config.ts'), 'utf8');
    expect(cfg).toContain("import { localesPlugin } from './vite-plugin-locales.ts';");
    expect(cfg).toContain("localesPlugin(new URL('../../data/locales/', import.meta.url), new URL('./src/i18n/', import.meta.url)),");
  });
});
