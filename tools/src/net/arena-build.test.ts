// GH-954 W1, W2 and W3, "not in production": the arena watch, setup, results and replay screens are DEV-only routes. A real `vite build` of the app (in
// memory, nothing written) must contain neither the route path, the API path, the key header, nor any of the
// watch screen's modules. The same build with `import.meta.env.DEV` forced true is the positive control: it
// must contain them, so a build that "has none" is not just a build that never looked.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, '../../../packages/app');
const MODULES = [/ui\/arena-watch\.ts/, /ui\/arena-strip\.ts/, /net\/watch-run\.ts/, /net\/watch-connect\.ts/, /ui\/arena-setup\.ts/, /net\/arena-setup-api\.ts/,
  // W3: the results and replay screens, the replay transport, the frames-file reader and the results client.
  /ui\/arena-results\.ts/, /ui\/arena-replay\.ts/, /net\/replay-transport\.ts/, /net\/replay-file\.ts/, /net\/arena-results-api\.ts/];
// W2 adds the setup route's name, its API paths (start, stop, players, status) and the one word only the token field uses.
const MARKERS = ['/arena/watch', '/arena/api', 'x-arena-token', 'arena-setup', '/arena/api/start', '/arena/api/stop', '/arena/api/players', '/arena/api/status', 'rl-arena-setup__token',
  // W3: the two routes' paths, their API paths, the route names main.ts registers and the one class only the replay controls use.
  '/arena/results', '/arena/replay', '/arena/api/results', '/arena/api/replay', 'arena-results', 'arena-replay', 'rl-arena-replay__speeds'];

interface Built { code: string; files: string[]; modules: string[] }
async function built(dev: boolean): Promise<Built> {
  const res = await build({
    root: APP,
    configFile: resolve(APP, 'vite.config.ts'),
    logLevel: 'silent',
    // `define` is the only way to flip the constant the app's guard reads; false is the real production value.
    define: { 'import.meta.env.DEV': dev ? 'true' : 'false' },
    build: { write: false, minify: false, reportCompressedSize: false, outDir: resolve(APP, '../../dist-arena-check') },
  });
  const outputs = (Array.isArray(res) ? res : [res]).flatMap((r) => ('output' in r ? r.output : []));
  const chunks = outputs.filter((o) => o.type === 'chunk');
  return {
    code: chunks.map((c) => c.code).join('\n'),
    files: outputs.map((o) => o.fileName),
    modules: chunks.flatMap((c) => c.moduleIds),
  };
}

describe('the arena watch, setup, results and replay screens are not in a production build (GH-954 W1, W2, W3)', () => {
  it('a production build has no /arena route, API path, key header or watch module; a build with DEV forced on has them all', async () => {
    const prod = await built(false);
    expect(prod.files.length).toBeGreaterThan(5);
    expect(prod.modules.some((m) => /packages\/app\/src\/main\.ts$/.test(m))).toBe(true);   // it did build the app
    for (const m of MARKERS) expect(prod.code.includes(m), `production code has ${m}`).toBe(false);
    for (const re of MODULES) expect(prod.modules.some((m) => re.test(m)), `production includes ${String(re)}`).toBe(false);
    expect(prod.files.filter((f) => /arena|watch/i.test(f))).toEqual([]);

    // The positive control: with the guard's constant true the same build carries all of it.
    const dev = await built(true);
    for (const m of MARKERS) expect(dev.code.includes(m), `dev code has ${m}`).toBe(true);
    for (const re of MODULES) expect(dev.modules.some((m) => re.test(m)), `dev includes ${String(re)}`).toBe(true);
  }, 240_000);
});
