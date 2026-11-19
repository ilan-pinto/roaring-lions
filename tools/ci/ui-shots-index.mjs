// GH-1409 part (b): a browsable index of the `ui:shots` captures the CI `visual` job takes.
//
//   node tools/ci/ui-shots-index.mjs <dir> [--out=<dir>/index.html] [--thumb=360] [--summary]
//
// <dir> is the `ui:shots` output root: `<dir>/<WxH>/NN-state.png` for English and `<dir>/locales/<id>/<WxH>/NN-state.png` for each
// shipped locale (shoot.ts, `--lang=all`). The tool writes ONE self-contained HTML page: every capture as a small thumbnail (embedded,
// so the file works on its own) that links to the full PNG by relative path (so it also works inside the unzipped `ui-shots` artifact).
// CI uploads that page a second time with `archive: false`, so GitHub shows it in the browser from the run page without a download.
// Inside that standalone copy the full-size links point at nothing: the page says so, and the zip holds the originals.
//
// `--summary` prints a short markdown table (captures per locale and resolution) for `$GITHUB_STEP_SUMMARY`.
//
// REPORT-ONLY, like the walk it indexes: it writes an index even for an empty or missing directory (saying so), and a PNG it cannot
// decode gets a placeholder tile instead of failing the run. Exit codes: 0 the page was written; 2 usage.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

export const DEFAULT_THUMB_WIDTH = 360;
/** The English walk is the group with no locale prefix. */
export const EN = 'en';

/** `<WxH>/<state>.png`, or `locales/<id>/<WxH>/<state>.png`, as a path relative to the output root (forward slashes). */
const SHOT = /^(?:locales\/([^/]+)\/)?(\d+x\d+)\/([^/]+)\.png$/;

/**
 * Every capture under `dir`, as `{ locale, res, state, rel }`, ordered English first, then locales A-Z, then resolution
 * (width, then height), then state name (the `NN-` prefix makes that the walk's order). A file that does not fit the layout is left out.
 */
export function collectShots(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), r);
      else {
        const m = SHOT.exec(r);
        if (m) out.push({ locale: m[1] ?? EN, res: m[2], state: m[3], rel: r });
      }
    }
  };
  if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir, '');
  const area = (res) => res.split('x').map(Number);
  return out.sort(
    (a, b) =>
      (a.locale === EN ? 0 : 1) - (b.locale === EN ? 0 : 1) ||
      a.locale.localeCompare(b.locale) ||
      area(a.res)[0] - area(b.res)[0] ||
      area(a.res)[1] - area(b.res)[1] ||
      a.state.localeCompare(b.state),
  );
}

/** Box-average downscale of a PNG buffer to `width` pixels wide (never up), returned as a PNG buffer. */
export function thumbnail(buf, width = DEFAULT_THUMB_WIDTH) {
  const src = PNG.sync.read(buf);
  if (src.width <= width) return PNG.sync.write(src);
  const scale = src.width / width;
  const w = width;
  const h = Math.max(1, Math.round(src.height / scale));
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3]; n++;
        }
      }
      const o = (y * w + x) * 4;
      dst.data[o] = Math.round(r / n); dst.data[o + 1] = Math.round(g / n); dst.data[o + 2] = Math.round(b / n); dst.data[o + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(dst);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Counts per locale and resolution, as a markdown table for the step summary. */
export function summaryMarkdown(shots) {
  if (shots.length === 0) return '### UI captures\n\nNo captures found: the `ui:shots` steps wrote nothing.\n';
  const res = [...new Set(shots.map((s) => s.res))];
  const locales = [...new Set(shots.map((s) => s.locale))];
  const rows = locales.map((l) => `| ${l} | ${res.map((r) => shots.filter((s) => s.locale === l && s.res === r).length).join(' | ')} |`);
  return [
    '### UI captures',
    '',
    `${shots.length} captures in ${locales.length} locale${locales.length === 1 ? '' : 's'}. Open the \`ui-shots-index.html\` artifact for the contact sheet; the \`ui-shots\` zip holds the full-size PNGs.`,
    '',
    `| locale | ${res.join(' | ')} |`,
    `|---|${res.map(() => '---').join('|')}|`,
    ...rows,
    '',
  ].join('\n');
}

/** The page. `thumbOf(shot)` returns a data URI, or null for a capture that could not be decoded. */
export function renderIndex(shots, thumbOf) {
  const body = [];
  for (const locale of [...new Set(shots.map((s) => s.locale))]) {
    body.push(`<h2 id="${esc(locale)}">${esc(locale)}</h2>`);
    for (const res of [...new Set(shots.filter((s) => s.locale === locale).map((s) => s.res))]) {
      body.push(`<h3>${esc(res)}</h3><div class="grid">`);
      for (const s of shots.filter((x) => x.locale === locale && x.res === res)) {
        const uri = thumbOf(s);
        const img = uri ? `<img loading="lazy" alt="${esc(s.state)}" src="${uri}">` : '<div class="gone">could not decode</div>';
        body.push(`<figure><a href="${encodeURI(s.rel)}">${img}</a><figcaption>${esc(s.state)}</figcaption></figure>`);
      }
      body.push('</div>');
    }
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ui:shots captures</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--ink:#1b1b1b;--dim:#666}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--ink:#e8e8e8;--dim:#9a9a9a}}
body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,sans-serif}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid var(--dim)}
figcaption{color:var(--dim);font-size:12px;word-break:break-all}.gone{padding:24px;border:1px dashed var(--dim);color:var(--dim)}
</style></head><body>
<h1>ui:shots captures</h1>
<p>${shots.length} captures. Thumbnails are embedded; a thumbnail links to the full-size PNG next to this page, which exists only inside the unzipped <code>ui-shots</code> artifact. SwiftShader captures: compare only with other CI captures.</p>
${shots.length === 0 ? '<p><strong>No captures found.</strong> The <code>ui:shots</code> steps wrote nothing.</p>' : body.join('\n')}
</body></html>
`;
}

/** Index `dir`: writes the page to `out`, returns the shots found. */
export function buildIndex(dir, out, width = DEFAULT_THUMB_WIDTH) {
  const shots = collectShots(dir);
  const thumbOf = (s) => {
    try {
      return `data:image/png;base64,${thumbnail(readFileSync(path.join(dir, s.rel)), width).toString('base64')}`;
    } catch {
      return null;
    }
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, renderIndex(shots, thumbOf));
  return shots;
}

function main(argv) {
  const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node tools/ci/ui-shots-index.mjs <dir> [--out=<file>] [--thumb=360] [--summary]');
    return 2;
  }
  const width = flags.thumb === undefined ? DEFAULT_THUMB_WIDTH : Number(flags.thumb);
  if (!Number.isInteger(width) || width < 16) { console.error(`--thumb must be an integer of at least 16, got ${flags.thumb}`); return 2; }
  const out = typeof flags.out === 'string' ? flags.out : path.join(dir, 'index.html');
  const shots = buildIndex(dir, out, width);
  console.error(`ui-shots-index: ${shots.length} captures -> ${out}`);
  if (flags.summary) process.stdout.write(summaryMarkdown(shots));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
