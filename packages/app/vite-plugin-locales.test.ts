// GH-1406 part 4: `data/locales/<lang>/{missions,units}.json` must reach the URL the loaders fetch, in the build and in `pnpm dev`. The
// build test RUNS a real Vite build over a fixture directory and reads the output, because a plugin that is not in the output is the whole
// failure this exists to prevent.
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCALE_FILE, localeFiles, localesPlugin } from './vite-plugin-locales';

let tmp: string;
let locales: string;
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
  // Files a traversal could actually reach: `..` as the language, one level above the directory. They match the filename rule, so only the
  // path guard stands between a request and them.
  write(join(tmp, 'missions.json'), '{"outside":true}');
  write(join(tmp, 'units.json'), '{"outside":true}');
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
  it('is DERIVED from the directory: the fixture yields exactly the three files and nothing else', () => {
    expect(localeFiles(locales)).toEqual(['fr/missions.json', 'fr/units.json', 'he/units.json']);
  });
  it('is empty for a directory that is missing, and for the shipped one today (only the en template)', () => {
    expect(localeFiles(join(tmp, 'nope'))).toEqual([]);
    expect(localeFiles(join(__dirname, '..', '..', 'data', 'locales'))).toEqual([]);
  });
});

describe('the build emits them at locales/<lang>/<file>', () => {
  async function run(dir: string, extra: { publicDir?: string | false } = {}): Promise<string> {
    const outDir = mkdtempSync(join(tmp, 'out-'));
    await build({ root: app, configFile: false, logLevel: 'silent', publicDir: extra.publicDir ?? false, plugins: [localesPlugin(dir)], build: { outDir, emptyOutDir: true } });
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
  }, 60_000);

  it('a file in both the data directory and the publicDir is a build error (one URL, two sources)', async () => {
    const pub = join(tmp, 'public');
    write(join(pub, 'locales', 'fr', 'missions.json'), '{}');
    await expect(run(locales, { publicDir: pub })).rejects.toThrow(/in both data\/locales and the publicDir/);
  }, 60_000);
});

describe('the dev server serves them at /locales/<lang>/<file>', () => {
  async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
    const vite = await createServer({ root: app, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true }, plugins: [localesPlugin(locales)] });
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

  it('does not read outside the directory: a traversal falls through', async () => {
    await withServer(async (base) => {
      for (const evil of ['/locales/..%2Fmissions.json', '/locales/%2e%2e/units.json', '/locales/..%2F..%2Fapp%2Findex.html', '/locales/fr%2F..%2F..%2Fapp%2Fmain.js']) {
        const r = await fetch(`${base}${evil}`);
        expect(r.status, evil).toBe(404);
        expect(await r.text(), evil).toBe('fell through');
      }
    });
  }, 60_000);
});

describe('the real config registers it', () => {
  it('apps/vite.config.ts lists localesPlugin over the data/locales directory (source guard)', () => {
    const cfg = readFileSync(join(__dirname, 'vite.config.ts'), 'utf8');
    expect(cfg).toContain("import { localesPlugin } from './vite-plugin-locales.ts';");
    expect(cfg).toContain("localesPlugin(new URL('../../data/locales/', import.meta.url)),");
  });
});
