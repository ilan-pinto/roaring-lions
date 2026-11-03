// GH-954 W1, "not in production": the arena watch screen is a DEV-only route. A real `vite build` of the app (in
// memory, nothing written) must contain neither the route path, the API path, the key header, nor any of the
// watch screen's modules. The same build with `import.meta.env.DEV` forced true is the positive control: it
// must contain them, so a build that "has none" is not just a build that never looked.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, '../../../packages/app');
const MODULES = [/ui\/arena-watch\.ts/, /ui\/arena-strip\.ts/, /net\/watch-run\.ts/, /net\/watch-connect\.ts/];
const MARKERS = ['/arena/watch', '/arena/api', 'x-arena-token'];

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

describe('the arena watch screen is not in a production build (GH-954 W1)', () => {
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
