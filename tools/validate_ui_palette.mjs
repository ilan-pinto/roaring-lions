// Palette gate for UI source — the interface held to the same rule as the art.
//
// A sprite cannot ship an off-palette pixel: validate_assets.py quantizes
// against data/palette.json and rejects the file. A VFX emitter may only name a
// palette key, never a raw hex. The interface was the exception, carrying 26
// hex literals of its own — which meant the one part of the product a player
// looks at continuously was the one part with no colour discipline.
//
// Three checks:
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
//   3. No untagged layout px in theme.css (spec 2026-09-16 §5: UI scale is
//      one number, --ui-scale, and only rem tracks it). See pxFailures below.
//
// Run: pnpm validate:ui
//
// The checkers are exported pure functions -- the same idiom
// tools/validate_narrative.mjs uses -- so a test can import one directly
// without running the whole sweep below, which reads real files off disk and
// calls process.exit() on failure. The sweep itself only runs when this file
// is executed directly (`node tools/validate_ui_palette.mjs`), not when it is
// imported.

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
// EXTS never reads .json, and that blind spot is how a retired dingbat hid in
// a catalogue string -- the dingbat sweep below reads this directory itself.
const I18N_DIR = 'packages/app/src/i18n';

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

// Strips shadow/filter DECLARATIONS (not whole lines) before the px scan --
// `drop-shadow(...)` is always a function nested inside a `filter:` value
// (never its own `prop:` declaration), so stripping `filter:` already covers
// it. A whole-line skip on any of these keywords appearing ANYWHERE on the
// line let a layout px sharing that line escape detection (fix round 1,
// 2026-09-16): `margin: 8px; text-shadow: 0 1px 2px red;` on one line
// previously passed with zero failures, because the old line-wide keyword
// test bailed out before the 8px was ever scanned.
const SHADOW_DECL = /(text-shadow|box-shadow|filter)\s*:[^;]*;?/g;
/** Layout must scale with --ui-scale (spec §5: UI scale is one number), so a
 *  px value of 4 or more in UI CSS is a defect unless the line says why. */
export function pxFailures(file, css) {
  const out = [];
  css.split('\n').forEach((line, i) => {
    if (line.includes('/* px-ok */')) return;
    const scanned = line.replace(SHADOW_DECL, '');
    for (const m of scanned.matchAll(/(\d+(?:\.\d+)?)px\b/g)) {
      if (Number(m[1]) >= 4) out.push(`${file}:${i + 1}: ${m[0]} -- use rem (or tag the line /* px-ok */ for a hairline)`);
    }
  });
  return out;
}

// Retired dingbats -- the Unicode glyphs G1 (#165, 2026-09-28, r2 and r5)
// replaced with the drawn sheet in ui/symbol.ts. Checked as a NAMED LIST, not
// a Unicode range, because a range would also catch typography (`°`, `·`).
// Q4 ruling: the r2 utility marks ▣ ◎ ↺ ↻ ship, so they are on this list too.
//
// `★` is a NAMED EXCEPTION (Q5) -- a repeated countable mark (stars earned,
// veteran rank), not an icon -- so it is deliberately NOT on this list and is
// never flagged. Cited by identifier, not line number, so this list cannot
// drift the way its predecessor did. Its sites:
//   loading.ts's `commendation` (the veterancy stripe helper)
//   hud.ts's `cardHtml` (`rl-commend` span, veteran rank)
//   debrief.ts's `showDebrief` (`rl-debrief__stars`, `rl-debrief__promotion`)
//   worldmap.ts's `worldMap` (`rl-world__stars`) and `ledgerLine`
//   worldmap3d.ts's `worldMap3d` town-pins loop (`rl-world__stars`)
//   campaign.ts's `campaignSummary`
//   catalogue: en.json `dock.lock.stars` (rendered via dock-model.ts's
//     `lockLabel`), en.json `gate.short.stars` (rendered via
//     gate-sentence.ts's `gateShort`)
// Prose-only `★` needing no exemption: roster-cap.ts's module doc comment,
// the comment above campaign.ts's `possibleStars`, the comment above
// gate-sentence.ts's `gateShort`, the comment above theme.css's
// `.rl-garage__card-chip` rule.
export const RETIRED_DINGBATS = [
  '⟶', '■', '◌', '⤓', '⤒', // order row
  '✹', '⬡', '✈', '✛', '▤', '▲', // ROLE_GLYPH (■ above already covers it)
  '▣', '◎', '✸', // strip and dock
  '↺', '↻', // board
];

// Q10 ruling: the dingbats no G1 round drew stay, tracked as follow-up GH-261
// (https://github.com/ilan-pinto/roaring-lions/issues/261), until they get a
// drawn mark of their own. Not on RETIRED_DINGBATS, so dingbatFailures is
// silent on every one of these. Cited by identifier, not line number:
//   hud.ts's `speedCluster` spec list (▮▮ pause), `cmdPrev`/`cmdNext`
//     (◂/▸ beat step), `muteChip` (🔇/🔊 mute)
//   hud-model.ts's `objectiveGlyph`, debrief.ts's `showDebrief` secondaries
//     loop (☑/☒/☐ objective status)
//   input/keymap.ts's `LABELS` (↑ ↓ ← → key-name display)
//   i18n/en.json: ← → (nav/back links, debrief.next, garage.benefit.*,
//     roe.notice.head), ♪ (menu.audio.*), ▼ (hud.strip.pinned),
//     ⚑ (hud.strip.broken), ⌂ (hud.leave.link), ⚠ (hud.card.weaponHeavy)

// Modules that draw the replacement marks are exempt by NAME, not by content
// scan -- neither holds a dingbat, but a comment in either may quote the
// retired glyph the mark beside it replaces.
const DINGBAT_EXEMPT_FILES = ['ui/symbol.ts', 'ui/order-sight.ts'];

/** A retired dingbat anywhere in UI/catalogue source is a defect: draw it
 *  instead, through ui/symbol.ts's symbolSvg. */
export function dingbatFailures(file, src) {
  if (file.endsWith('.test.ts')) return [];
  if (DINGBAT_EXEMPT_FILES.some((f) => file.endsWith(f))) return [];
  const out = [];
  src.split('\n').forEach((line, i) => {
    for (const ch of RETIRED_DINGBATS) {
      if (line.includes(ch)) {
        out.push(`${file}:${i + 1}  retired dingbat ${ch} -- draw it with symbolSvg (ui/symbol.ts)`);
      }
    }
  });
  return out;
}

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
    // CVD variants (Task 12): vite-plugin-palette.ts's paletteDeclarations
    // publishes one extra --rl-<band>-<variant>-<key> per entry -- mirrored
    // here so theme.css's :root[data-cvd='...'] blocks, the only place
    // allowed to name one, do not read as unknown custom properties.
    for (const [variant, colors] of Object.entries(group.variants ?? {})) {
      for (const key of Object.keys(colors)) {
        names.add(`--rl-${band}-${variant}-${key.replace(/_/g, '-')}`);
      }
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

function main() {
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

    if (rel.endsWith('.css')) {
      failures.push(...pxFailures(rel, src));
    }

    for (const m of src.matchAll(VAR)) {
      const name = m[1];
      if (known.has(name)) continue;
      // --i drives the menu stagger delay and is set from JS per element.
      if (name === '--i') continue;
      failures.push(`${rel}  unknown custom property ${name} — not declared in ${THEME} or ${PALETTE}`);
    }
  }

  // The retired-dingbat sweep also reads the catalogue: en.json is where a
  // star gate hid, past EXTS's blind spot for .json.
  const i18nFiles = readdirSync(join(ROOT, I18N_DIR))
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(ROOT, I18N_DIR, f));
  for (const file of [...files, ...i18nFiles]) {
    const rel = relative(ROOT, file);
    failures.push(...dingbatFailures(rel, readFileSync(file, 'utf8')));
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
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
