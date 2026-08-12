// Palette gate for UI source — the interface held to the same rule as the art.
//
// A sprite cannot ship an off-palette pixel: validate_assets.py quantizes
// against data/palette.json and rejects the file. A VFX emitter may only name a
// palette key, never a raw hex. The interface was the exception, carrying 26
// hex literals of its own — which meant the one part of the product a player
// looks at continuously was the one part with no colour discipline.
//
// Two checks:
//
//   1. No colour literal anywhere in UI source. Not hex, not rgb()/rgba().
//      There is no allowlist: the palette reaches CSS as --rl-* custom
//      properties (see packages/app/vite-plugin-palette.ts) and color-mix()
//      covers translucency, so nothing legitimately needs one.
//
//   2. Every var(--…) a UI file names resolves — either to a semantic token
//      declared in theme.css, or to a --rl-* the plugin actually emits from
//      palette.json. A typo'd token is not a build error and not a visual
//      error either; it renders as nothing at all, which is how it survives
//      review.
//
// Run: pnpm validate:ui

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const THEME = 'packages/app/src/ui/theme.css';
const PALETTE = 'data/palette.json';

// Scope: source that produces DOM. The renderer draws into Pixi, where colours
// arrive as RendererOptions resolved from the palette by the app — a different
// mechanism with a different fix, so holding it to a CSS-shaped rule here would
// only teach people to silence the gate.
const ROOTS = ['packages/app/src', 'assets/campaign'];
const EXTRA = ['packages/app/index.html', 'packages/render/src/overlay.ts'];
const EXTS = ['.ts', '.css', '.html', '.svg'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some((e) => entry.endsWith(e)) && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

// A colour literal in any form. Hex needs a boundary check so that an id like
// "#stage" or a fragment link is not mistaken for #stage-as-colour; requiring
// 3, 4, 6 or 8 hex digits terminated by a non-word character does that.
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB = /\brgba?\(\s*\d/g;
const VAR = /var\(\s*(--[\w-]+)/g;

function paletteVars() {
  const p = JSON.parse(readFileSync(join(ROOT, PALETTE), 'utf8'));
  const names = new Set();
  for (const [band, ramp] of Object.entries(p.ramps)) {
    ramp.colors.forEach((_, i) => names.add(`--rl-${band}-${i}`));
  }
  for (const [band, group] of Object.entries(p.reserved)) {
    for (const key of Object.keys(group.colors)) {
      names.add(`--rl-${band}-${key.replace(/_/g, '-')}`);
    }
  }
  return names;
}

/** Custom properties theme.css declares, e.g. `--ink:` at the start of a rule. */
function declaredVars(themeSrc) {
  const names = new Set();
  for (const m of themeSrc.matchAll(/^\s*(--[\w-]+)\s*:/gm)) names.add(m[1]);
  return names;
}

const failures = [];
const files = [...ROOTS.flatMap((r) => walk(join(ROOT, r))), ...EXTRA.map((f) => join(ROOT, f))];
const themeSrc = readFileSync(join(ROOT, THEME), 'utf8');
const known = new Set([...paletteVars(), ...declaredVars(themeSrc)]);

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    // The palette is the one place a hex is the point, and it is data, not
    // source — it is not in ROOTS. Everything reaching here must be clean.
    for (const m of line.matchAll(HEX)) {
      failures.push(`${rel}:${i + 1}  colour literal ${m[0]} — use a semantic class or token`);
    }
    if (RGB.test(line)) {
      RGB.lastIndex = 0; // /g regex: a stateful test() would skip the next line
      failures.push(
        `${rel}:${i + 1}  rgb()/rgba() literal — use color-mix(in srgb, var(--token) N%, transparent)`
      );
    }
  });

  for (const m of src.matchAll(VAR)) {
    const name = m[1];
    if (known.has(name)) continue;
    // --i drives the menu stagger delay and is set from JS per element.
    if (name === '--i') continue;
    failures.push(`${rel}  unknown custom property ${name} — not declared in ${THEME} or ${PALETTE}`);
  }
}

// The two-tier rule: only theme.css maps a raw palette entry onto meaning. If
// UI code reaches past it for --rl-* directly, a palette revision stops being
// a one-file change and the semantic layer quietly rots.
// index.html is the one exemption, and it is a real one rather than a
// convenience: it paints the ground colour before any stylesheet has parsed,
// so the semantic layer does not exist yet. Reaching for --rl-* there is the
// only way to keep a literal out of the document.
const RAW_EXEMPT = new Set(['packages/app/index.html']);

const rawOutsideTheme = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel === THEME || RAW_EXEMPT.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/var\(\s*(--rl-[\w-]+)/g)) {
    rawOutsideTheme.push(`${rel}  names ${m[1]} directly — map it to a semantic token in ${THEME}`);
  }
}

const all = [...failures, ...rawOutsideTheme];
if (all.length > 0) {
  console.error(`UI palette gate: ${all.length} problem(s)\n`);
  for (const f of all) console.error('  ' + f);
  console.error(
    '\nThe battlefield cannot ship an off-palette pixel. Neither can the interface.'
  );
  process.exit(1);
}

console.log(`UI palette gate: ${files.length} file(s) clean, ${known.size} token(s) known.`);
