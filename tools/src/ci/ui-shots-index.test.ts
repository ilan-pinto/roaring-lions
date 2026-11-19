// GH-1409 (b): the contact sheet of the CI `ui:shots` captures. The fixtures are real PNGs written into a temp tree in the layout
// shoot.ts writes (`<WxH>/NN-state.png`, `locales/<id>/<WxH>/NN-state.png`); every expectation is a literal.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { buildIndex, collectShots, esc, renderIndex, summaryMarkdown, thumbnail } from '../../ci/ui-shots-index.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'ui-shots-index-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A w x h PNG: left half red, right half blue, so a downscale has two known colours to keep. */
function png(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      p.data[i] = x < w / 2 ? 255 : 0;
      p.data[i + 1] = 0;
      p.data[i + 2] = x < w / 2 ? 0 : 255;
      p.data[i + 3] = 255;
    }
  return PNG.sync.write(p);
}
function put(dir: string, rel: string, buf: Buffer): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), buf);
}

const tree = path.join(root, 'tree');
for (const rel of ['1400x900/01-menu.png', '1400x900/02-campaign.png', '1920x1080/01-menu.png', 'locales/de/1400x900/01-menu.png', 'locales/fr/1400x900/01-menu.png'])
  put(tree, rel, png(800, 400));
// Files that are NOT captures: a stray log, a wrong resolution folder, a png at the root.
writeFileSync(path.join(tree, 'notes.txt'), 'x');
put(tree, 'misc/01-x.png', png(8, 8));
put(tree, 'stray.png', png(8, 8));

describe('collectShots', () => {
  it('finds the five captures and none of the strays, English first, then locales A-Z, resolutions by size, states by name', () => {
    expect(collectShots(tree).map((s) => `${s.locale}|${s.res}|${s.state}`)).toEqual([
      'en|1400x900|01-menu',
      'en|1400x900|02-campaign',
      'en|1920x1080|01-menu',
      'de|1400x900|01-menu',
      'fr|1400x900|01-menu',
    ]);
  });
  it('the relative path keeps forward slashes and the locales/ prefix', () => {
    expect(collectShots(tree).map((s) => s.rel)).toContain('locales/de/1400x900/01-menu.png');
  });
  it('a missing directory has no captures (the walk that wrote none)', () => {
    expect(collectShots(path.join(root, 'nope'))).toEqual([]);
  });
});

describe('thumbnail', () => {
  it('scales 800x400 to 200x100 and keeps both halves\' colours', () => {
    const t = PNG.sync.read(thumbnail(png(800, 400), 200));
    expect([t.width, t.height]).toEqual([200, 100]);
    expect([...t.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]); // left edge: red
    const last = (100 * 200 - 1) * 4;
    expect([...t.data.subarray(last, last + 4)]).toEqual([0, 0, 255, 255]); // right edge: blue
  });
  it('never scales up', () => {
    const t = PNG.sync.read(thumbnail(png(50, 20), 200));
    expect([t.width, t.height]).toEqual([50, 20]);
  });
  it('a buffer that is not a PNG throws (buildIndex turns that into a placeholder)', () => {
    expect(() => thumbnail(Buffer.from('not a png'), 100)).toThrow();
  });
});

describe('renderIndex and buildIndex', () => {
  it('every capture is a thumbnail that links to its own full-size file', () => {
    const out = path.join(root, 'index.html');
    const shots = buildIndex(tree, out, 100);
    expect(shots).toHaveLength(5);
    const html = readFileSync(out, 'utf8');
    for (const rel of ['1400x900/01-menu.png', '1400x900/02-campaign.png', '1920x1080/01-menu.png', 'locales/de/1400x900/01-menu.png', 'locales/fr/1400x900/01-menu.png'])
      expect(html).toContain(`<a href="${rel}"><img`);
    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(5);
    expect(html).toContain('5 captures');
    expect(html).toContain('<h2 id="de">de</h2>');
  });
  it('is self-contained: the only external references are the full-size links', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script|<link |src="(?!data:)/);
  });
  it('a capture that cannot be decoded gets a placeholder, and the run still writes the page', () => {
    const bad = path.join(root, 'bad');
    put(bad, '1400x900/01-menu.png', Buffer.from('not a png'));
    put(bad, '1400x900/02-ok.png', png(40, 20));
    const html = readFileSync((buildIndex(bad, path.join(bad, 'index.html'), 20), path.join(bad, 'index.html')), 'utf8');
    expect(html).toContain('could not decode');
    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(1);
  });
  it('names are escaped, and the href is URL-encoded', () => {
    const html = renderIndex([{ locale: 'en', res: '1x1', state: '<b>"x"&', rel: '1x1/a b.png' }], () => null);
    expect(html).toContain('&lt;b&gt;&quot;x&quot;&amp;');
    expect(html).not.toContain('<b>"x"');
    expect(html).toContain('href="1x1/a%20b.png"');
    expect(esc(`'`)).toBe('&#39;');
  });
  it('an empty tree still writes a page that says so', () => {
    const out = path.join(root, 'empty', 'index.html');
    expect(buildIndex(path.join(root, 'empty-in'), out)).toEqual([]);
    expect(readFileSync(out, 'utf8')).toContain('No captures found.');
  });
});

describe('summaryMarkdown', () => {
  it('counts per locale and resolution', () => {
    expect(summaryMarkdown(collectShots(tree))).toBe(
      [
        '### UI captures',
        '',
        '5 captures in 3 locales. Open the `ui-shots-index.html` artifact for the contact sheet; the `ui-shots` zip holds the full-size PNGs.',
        '',
        '| locale | 1400x900 | 1920x1080 |',
        '|---|---|---|',
        '| en | 2 | 1 |',
        '| de | 1 | 0 |',
        '| fr | 1 | 0 |',
        '',
      ].join('\n'),
    );
  });
  it('says so when nothing was captured', () => {
    expect(summaryMarkdown([])).toContain('No captures found');
  });
});

describe('the command line', () => {
  const cli = path.resolve(import.meta.dirname, '../../ci/ui-shots-index.mjs');
  it('writes <dir>/index.html by default, prints the summary on stdout, exits 0', () => {
    const dir = path.join(root, 'cli');
    put(dir, '1400x900/01-menu.png', png(40, 20));
    const stdout = execFileSync('node', [cli, dir, '--summary', '--thumb=20'], { encoding: 'utf8' });
    expect(stdout).toContain('| en | 1 |');
    expect(readFileSync(path.join(dir, 'index.html'), 'utf8')).toContain('01-menu');
  });
  it('exits 2 with no directory and with a bad --thumb', () => {
    const run = (args: string[]): number => {
      try {
        execFileSync('node', [cli, ...args], { stdio: 'pipe' });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };
    expect(run([])).toBe(2);
    expect(run([root, '--thumb=3'])).toBe(2);
  });
});

describe('ci.yml wires the index in', () => {
  const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const step = (name: string): string => {
    const at = ci.indexOf(`- name: ${name}`);
    return at < 0 ? '' : ci.slice(at, at + 700).split(/\n {6}- /)[0] ?? '';
  };
  it('the index step runs the tool over ui-shots-output, report-only, and writes the summary', () => {
    const s = step('Index the shell captures (report-only)');
    expect(s).toContain('node tools/ci/ui-shots-index.mjs ui-shots-output --out=ui-shots-output/index.html --summary >> "$GITHUB_STEP_SUMMARY"');
    expect(s).toContain('continue-on-error: true');
    expect(s).toContain('if: always()');
  });
  it('the contact sheet is uploaded as a single unarchived file, report-only', () => {
    const s = step('Upload the contact sheet (opens in the browser)');
    expect(s).toContain('path: ui-shots-index.html');
    expect(s).toContain('archive: false');
    expect(s).toContain('continue-on-error: true');
  });
});
