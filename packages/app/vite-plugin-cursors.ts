// Draws the thirteen cursor states as inline SVG data URIs and injects them
// as CSS.
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
// `default` (one of the thirteen names) deliberately gets no rule -- it is
// the OS arrow.

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { cursorKey, type CursorName } from './src/input/cursor';
import type { RoleBucket } from './src/ui/role';

interface Palette {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, { colors: Record<string, string> }>;
}

// The twelve drawn cursors (thirteen names in CursorName, minus 'default')
// all share one hotspot: dead centre, at half the canvas size on each axis.
// Six of them are still plain symmetric reticles built around that centre
// with no off-centre tip. The other six (the verb cursors) can additionally
// carry a role badge riding the lower-right corner, which *is* off-centre --
// but the hotspot itself never moves for it, because the badge decorates the
// cursor, it does not aim it.
export const SIZE = 32;
export const CENTER = SIZE / 2;

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

function moveBody(light: string): string {
  const c = hex(light);
  return (
    `<circle cx="${CENTER}" cy="${CENTER}" r="9" fill="none" stroke="${c}" stroke-width="2"/>` +
    `<circle cx="${CENTER}" cy="${CENTER}" r="2" fill="${c}"/>`
  );
}
function moveShape(light: string): string {
  return svg(moveBody(light));
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

function attackBody(bad: string): string {
  return reticleTicks(bad);
}
function attackShape(bad: string): string {
  return svg(attackBody(bad));
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

// An eight-ray burst radiating from the centre -- denser and more violent
// than attack's four-tick reticle, read as detonation rather than aim.
function burstRays(color: string): string {
  const c = hex(color);
  const near = 5;
  const far = 12;
  const dirs: [number, number][] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    [0.7071, -0.7071],
    [0.7071, 0.7071],
    [-0.7071, -0.7071],
    [-0.7071, 0.7071],
  ];
  return dirs
    .map(([dx, dy]) => {
      const x1 = (CENTER + dx * near).toFixed(2);
      const y1 = (CENTER + dy * near).toFixed(2);
      const x2 = (CENTER + dx * far).toFixed(2);
      const y2 = (CENTER + dy * far).toFixed(2);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="2"/>`;
    })
    .join('');
}

// A shield outline -- a unit holding a fortified position.
function garrisonBody(mid: string): string {
  const c = hex(mid);
  return (
    `<path d="M${CENTER},7 L${CENTER + 8},10 L${CENTER + 8},18 ` +
    `Q${CENTER + 8},24 ${CENTER},26 Q${CENTER - 8},24 ${CENTER - 8},18 ` +
    `L${CENTER - 8},10 Z" fill="none" stroke="${c}" stroke-width="2"/>`
  );
}
function garrisonShape(mid: string): string {
  return svg(garrisonBody(mid));
}

function demolishBody(bad: string): string {
  return burstRays(bad);
}
function demolishShape(bad: string): string {
  return svg(demolishBody(bad));
}

// A filled diamond -- a breaching charge set at a point.
function chargeBody(bad: string): string {
  const c = hex(bad);
  return `<path d="M${CENTER},6 L${CENTER + 10},${CENTER} L${CENTER},26 L${CENTER - 10},${CENTER} Z" fill="${c}"/>`;
}
function chargeShape(bad: string): string {
  return svg(chargeBody(bad));
}

// An upward chevron -- boarding a carrier.
function mountBody(mid: string): string {
  const c = hex(mid);
  return `<path d="M${CENTER - 8},20 L${CENTER},10 L${CENTER + 8},20" fill="none" stroke="${c}" stroke-width="2"/>`;
}
function mountShape(mid: string): string {
  return svg(mountBody(mid));
}

// A downward chevron -- leaving a carrier.
function dismountBody(mid: string): string {
  const c = hex(mid);
  return `<path d="M${CENTER - 8},12 L${CENTER},22 L${CENTER + 8},12" fill="none" stroke="${c}" stroke-width="2"/>`;
}
function dismountShape(mid: string): string {
  return svg(dismountBody(mid));
}

// Three overlapping puffs -- a smoke screen.
function smokeBody(mid: string): string {
  const c = hex(mid);
  return (
    `<circle cx="${CENTER - 6}" cy="${CENTER + 4}" r="5" fill="none" stroke="${c}" stroke-width="2"/>` +
    `<circle cx="${CENTER}" cy="${CENTER - 2}" r="6" fill="none" stroke="${c}" stroke-width="2"/>` +
    `<circle cx="${CENTER + 6}" cy="${CENTER + 4}" r="5" fill="none" stroke="${c}" stroke-width="2"/>`
  );
}
function smokeShape(mid: string): string {
  return svg(smokeBody(mid));
}

/** Every drawn cursor, in the order they read best as a legend. `default` is
 *  intentionally absent: it resolves to no rule and the OS arrow shows. */
function shapesFor(palette: Palette): Record<Exclude<CursorName, 'default'>, string> {
  const { light, mid, bad, good } = paletteColors(palette);
  return {
    move: moveShape(light),
    attack: attackShape(bad),
    blocked: blockedShape(mid),
    costly: costlyShape(bad, light),
    protected: protectedShape(bad),
    support: supportShape(good),
    garrison: garrisonShape(mid),
    demolish: demolishShape(bad),
    charge: chargeShape(bad),
    mount: mountShape(mid),
    dismount: dismountShape(mid),
    smoke: smokeShape(mid),
  };
}

function paletteColors(palette: Palette): { light: string; mid: string; bad: string; good: string } {
  return {
    light: palette.ramps.limestone.colors[0],
    mid: palette.ramps.limestone.colors[4],
    bad: palette.reserved.ui.colors.bad,
    good: palette.reserved.ui.colors.good,
  };
}

const BADGE_CX = 24;
const BADGE_CY = 24;
const BADGE_R = 4.5;

/** A small SVG mark riding the reticle's lower-right corner, shaped to match
 *  `ROLE_GLYPH`'s Unicode for the same bucket in `src/ui/role.ts` -- so the
 *  cursor's badge and the inspect card's glyph read as the same thing to a
 *  player who sees both at once. Drawn as paths rather than that Unicode
 *  text, because font availability inside a cursor image is not something
 *  to bet on. Kept to a few path commands each: this rides at roughly 10px
 *  on a 32px reticle, seen in motion. */
function badgeMark(bucket: RoleBucket, colour: string): string {
  const c = hex(colour);
  const x = BADGE_CX;
  const y = BADGE_CY;
  const r = BADGE_R;
  switch (bucket) {
    case 'armour': // '■' -- a filled square
      return `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${c}"/>`;
    case 'soft': // '▲' -- a filled triangle
      return `<path d="M${x},${y - r} L${x + r},${y + r} L${x - r},${y + r} Z" fill="${c}"/>`;
    case 'drone': { // '⬡' -- a hexagon
      const h = r;
      return (
        `<path d="M${x - h},${y} L${x - h / 2},${y - h} L${x + h / 2},${y - h} ` +
        `L${x + h},${y} L${x + h / 2},${y + h} L${x - h / 2},${y + h} Z" fill="${c}"/>`
      );
    }
    case 'gunship': // '✈' -- a dart, distinct from soft's plain triangle
      return (
        `<path d="M${x},${y - r} L${x + r * 0.7},${y + r} L${x},${y + r * 0.35} ` +
        `L${x - r * 0.7},${y + r} Z" fill="${c}"/>`
      );
    case 'sniper': { // '✛' -- a heavy cross
      const t = r * 0.4;
      return (
        `<path d="M${x - t},${y - r} L${x + t},${y - r} L${x + t},${y - t} ` +
        `L${x + r},${y - t} L${x + r},${y + t} L${x + t},${y + t} ` +
        `L${x + t},${y + r} L${x - t},${y + r} L${x - t},${y + t} ` +
        `L${x - r},${y + t} L${x - r},${y - t} L${x - t},${y - t} Z" fill="${c}"/>`
      );
    }
    case 'transport': // '▤' -- a square ruled with two bars
      return (
        `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="none" stroke="${c}" stroke-width="1"/>` +
        `<line x1="${x - r}" y1="${y - r / 3}" x2="${x + r}" y2="${y - r / 3}" stroke="${c}" stroke-width="1"/>` +
        `<line x1="${x - r}" y1="${y + r / 3}" x2="${x + r}" y2="${y + r / 3}" stroke="${c}" stroke-width="1"/>`
      );
    case 'kamikaze': // '✹' -- an eight-point burst, small
      return (
        `<path d="M${x},${y - r} L${x + r * 0.35},${y - r * 0.35} L${x + r},${y} ` +
        `L${x + r * 0.35},${y + r * 0.35} L${x},${y + r} L${x - r * 0.35},${y + r * 0.35} ` +
        `L${x - r},${y} L${x - r * 0.35},${y - r * 0.35} Z" fill="${c}"/>`
      );
  }
}

/** Which buckets can actually reach each verb -- from the roster. `move` and
 *  `attack` are reachable by all seven; the other six verbs are gated to the
 *  subset of buckets whose units can actually issue them. A verb absent here
 *  keeps only its bare (unbadged) rule -- `blocked`, `costly`, `protected`
 *  and `support` describe the target, not the actor, and never earn a badge. */
const BADGED_VERBS: { [K in Exclude<CursorName, 'default'>]?: RoleBucket[] } = {
  move: ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'],
  attack: ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'],
  garrison: ['soft', 'sniper'],
  demolish: ['soft', 'armour'],
  charge: ['soft'],
  mount: ['transport'],
  dismount: ['transport'],
  smoke: ['transport', 'soft', 'armour'],
};

/** The same base body used for a verb's bare rule, so a badged rule is
 *  always exactly that body plus a badge mark -- never a second drawing that
 *  could drift from the first. */
function bodyFor(name: keyof typeof BADGED_VERBS, palette: Palette): string {
  const { light, mid, bad } = paletteColors(palette);
  switch (name) {
    case 'move':
      return moveBody(light);
    case 'attack':
      return attackBody(bad);
    case 'garrison':
      return garrisonBody(mid);
    case 'demolish':
      return demolishBody(bad);
    case 'charge':
      return chargeBody(bad);
    case 'mount':
      return mountBody(mid);
    case 'dismount':
      return dismountBody(mid);
    case 'smoke':
      return smokeBody(mid);
    default:
      return '';
  }
}

/** The badge always contrasts against its own base shape's colour: `move`'s
 *  base is drawn in `light`, so its badge uses `mid`; every other badged
 *  verb's base is `mid` or `bad`, so its badge uses `light`. */
function badgeColourFor(
  name: keyof typeof BADGED_VERBS,
  colors: { light: string; mid: string; bad: string; good: string }
): string {
  return name === 'move' ? colors.mid : colors.light;
}

function ruleFor(key: string, markup: string): string {
  const encoded = encodeURIComponent(markup);
  return (
    `canvas[data-cursor='${key}'] { ` +
    `cursor: url("data:image/svg+xml,${encoded}") ${CENTER} ${CENTER}, auto; }`
  );
}

/** The CSS text: one rule per drawn cursor name, each with an explicit
 *  hotspot so the pointer's true position matches where the shape aims, plus
 *  one further rule per reachable (verb, bucket) badge combination. */
export function cursorRules(palette: Palette): string {
  const shapes = shapesFor(palette);
  const colors = paletteColors(palette);
  const rules: string[] = [];

  for (const [name, markup] of Object.entries(shapes) as [Exclude<CursorName, 'default'>, string][]) {
    rules.push(ruleFor(cursorKey(name, null), markup));
  }

  for (const [name, buckets] of Object.entries(BADGED_VERBS) as [
    keyof typeof BADGED_VERBS,
    RoleBucket[],
  ][]) {
    const base = bodyFor(name, palette);
    const badgeColour = badgeColourFor(name, colors);
    for (const bucket of buckets) {
      const markup = svg(base + badgeMark(bucket, badgeColour));
      rules.push(ruleFor(cursorKey(name, bucket), markup));
    }
  }

  return rules.join('\n');
}

// The real data/palette.json has no `ui` reserved band -- cursor colour
// reuses the same two values theme.css already aliases as --bad and --good
// (team.hostile and scrub's lightest step), so a cursor and the HUD text it
// sits next to always agree on what "bad" and "good" look like. Exported (not
// inlined into cursorsPlugin) so a test can run this exact translation
// against the real file on disk: cursorRules is tested as a pure function
// over an already-shaped Palette, and that shape never occurs on disk, only
// here -- so this is the one seam a rename or removal of team.hostile /
// scrub[0] would otherwise slip past.
export function deriveUiBand(raw: Palette): Palette {
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
}

/** Reads and shapes the palette exactly as `cursorsPlugin` does at request
 *  time -- factored out so a test can point it at the real data/palette.json. */
export function resolvePalette(paletteUrl: URL): Palette {
  const raw = JSON.parse(readFileSync(paletteUrl, 'utf8')) as Palette;
  return deriveUiBand(raw);
}

export function cursorsPlugin(paletteUrl: URL): Plugin {
  const path = paletteUrl.pathname;

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
          children: cursorRules(resolvePalette(paletteUrl)),
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
