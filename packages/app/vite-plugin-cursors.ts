// Draws the seven cursor states as inline SVG data URIs and injects them as CSS.
//
// Cursor art needs colour, and `pnpm validate:ui` rejects a hex or rgb()
// literal anywhere under packages/app/src with no allowlist. This file sits
// outside that scan root -- exactly where vite-plugin-palette.ts sits -- so it
// is the one place cursor colour can live at all. It injects a <style> block
// through transformIndexHtml (which Vite runs in both dev and build) instead
// of emitting a stylesheet, for the same reason vite-plugin-palette.ts does:
// a stylesheet would still need index.html to reference it, and one literal
// there is all it takes for the palette gate to become a rule with an
// exception.
//
// `default` (the seventh name) deliberately gets no rule -- it is the OS arrow.

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import type { CursorName } from './src/input/cursor';

interface Palette {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, { colors: Record<string, string> }>;
}

// All six drawn cursors point from their own geometric centre: every shape
// below is a symmetric reticle, ring, frame or X built around the middle of
// its 32x32 canvas, with no off-centre tip the way an arrow has. So the
// hotspot for every one of them is simply half the canvas size on each axis
// -- derived from the shape's own symmetry, not eyeballed.
const SIZE = 32;
const CENTER = SIZE / 2;

/** Lowercased so the encoded output is deterministic regardless of how the
 *  source palette capitalises its hex strings. */
function hex(color: string): string {
  return color.toLowerCase();
}

function svg(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`
  );
}

function moveShape(light: string): string {
  const c = hex(light);
  return svg(
    `<circle cx="${CENTER}" cy="${CENTER}" r="9" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<circle cx="${CENTER}" cy="${CENTER}" r="2" fill="${c}"/>`
  );
}

// A four-tick reticle with an open centre -- no mark sits over the point
// being aimed at.
function reticleTicks(color: string): string {
  const c = hex(color);
  const near = 6;
  const far = 11;
  return (
    `<line x1="${CENTER}" y1="${CENTER - far}" x2="${CENTER}" y2="${CENTER - near}" stroke="${c}" stroke-width="2"/>` +
    `<line x1="${CENTER}" y1="${CENTER + near}" x2="${CENTER}" y2="${CENTER + far}" stroke="${c}" stroke-width="2"/>` +
    `<line x1="${CENTER - far}" y1="${CENTER}" x2="${CENTER - near}" y2="${CENTER}" stroke="${c}" stroke-width="2"/>` +
    `<line x1="${CENTER + near}" y1="${CENTER}" x2="${CENTER + far}" y2="${CENTER}" stroke="${c}" stroke-width="2"/>`
  );
}

function attackShape(bad: string): string {
  return svg(reticleTicks(bad));
}

function blockedShape(mid: string): string {
  const c = hex(mid);
  return svg(
    `<circle cx="${CENTER}" cy="${CENTER}" r="9" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<line x1="9" y1="9" x2="23" y2="23" stroke="${c}" stroke-width="2"/>`
  );
}

// The attack reticle plus a small filled triangle in the upper-right --
// signals "this attack costs something" without changing what the reticle
// itself points at.
function costlyShape(bad: string, light: string): string {
  const badC = hex(bad);
  const lightC = hex(light);
  return svg(
    reticleTicks(badC) + `<path d="M24,4 L30,4 L30,10 Z" fill="${lightC}"/>`
  );
}

// A bold X spanning the full box -- the strongest, least ambiguous "no" this
// vocabulary has, reserved for firing on a protected site.
function protectedShape(bad: string): string {
  const c = hex(bad);
  return svg(
    `<line x1="3" y1="3" x2="29" y2="29" stroke="${c}" stroke-width="4"/>` +
      `<line x1="29" y1="3" x2="3" y2="29" stroke="${c}" stroke-width="4"/>`
  );
}

// Four corner brackets and a centre dot -- a target frame, not a weapon.
function supportShape(good: string): string {
  const c = hex(good);
  return svg(
    `<path d="M6,11 L6,6 L11,6" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<path d="M21,6 L26,6 L26,11" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<path d="M6,21 L6,26 L11,26" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<path d="M26,21 L26,26 L21,26" fill="none" stroke="${c}" stroke-width="2"/>` +
      `<circle cx="${CENTER}" cy="${CENTER}" r="2" fill="${c}"/>`
  );
}

/** Every drawn cursor, in the order they read best as a legend. `default` is
 *  intentionally absent: it resolves to no rule and the OS arrow shows. */
function shapesFor(palette: Palette): Record<Exclude<CursorName, 'default'>, string> {
  const light = palette.ramps.limestone.colors[0];
  const mid = palette.ramps.limestone.colors[4];
  const bad = palette.reserved.ui.colors.bad;
  const good = palette.reserved.ui.colors.good;
  return {
    move: moveShape(light),
    attack: attackShape(bad),
    blocked: blockedShape(mid),
    costly: costlyShape(bad, light),
    protected: protectedShape(bad),
    support: supportShape(good),
  };
}

/** The CSS text: one rule per drawn cursor name, each with an explicit
 *  hotspot so the pointer's true position matches where the shape aims. */
export function cursorRules(palette: Palette): string {
  const shapes = shapesFor(palette);
  return (Object.entries(shapes) as [Exclude<CursorName, 'default'>, string][])
    .map(([name, markup]) => {
      const encoded = encodeURIComponent(markup);
      return (
        `[data-cursor='${name}'] canvas { ` +
        `cursor: url("data:image/svg+xml,${encoded}") ${CENTER} ${CENTER}, auto; }`
      );
    })
    .join('\n');
}

export function cursorsPlugin(paletteUrl: URL): Plugin {
  const path = paletteUrl.pathname;

  // The real data/palette.json has no `ui` reserved band -- cursor colour
  // reuses the same two values theme.css already aliases as --bad and --good
  // (team.hostile and scrub's lightest step), so a cursor and the HUD text it
  // sits next to always agree on what "bad" and "good" look like. This reads
  // those values out of the real palette at plugin-run time; it never writes
  // a literal.
  const read = (): Palette => {
    const raw = JSON.parse(readFileSync(paletteUrl, 'utf8')) as Palette;
    return {
      ...raw,
      reserved: {
        ...raw.reserved,
        ui: {
          colors: {
            bad: raw.reserved.team.colors.hostile,
            good: raw.ramps.scrub.colors[0],
          },
        },
      },
    };
  };

  return {
    name: 'lions-cursors',

    configureServer(server) {
      server.watcher.add(path);
      server.watcher.on('change', (file) => {
        if (file === path) server.ws.send({ type: 'full-reload' });
      });
    },

    transformIndexHtml() {
      return [
        {
          tag: 'style',
          attrs: { 'data-cursor-rules': 'data/palette.json' },
          children: cursorRules(read()),
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
