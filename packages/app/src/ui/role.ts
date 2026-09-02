/**
 * The seven buckets a unit falls into for display.
 *
 * Extracted from hud.ts's inspect-card rung so the cursor's badge and the
 * card's glyph cannot disagree about what a unit is -- the player sees both
 * at once. What is shared is the BUCKET; the two render it differently, the
 * card as a Unicode glyph and the cursor as an SVG path, because font
 * availability inside a cursor image is not something to bet on.
 *
 * Seven and not fourteen because a badge is about 10px in motion, and
 * hud.ts's own comment already calls these a placeholder until the art
 * pipeline produces portraits. When it does, both callers change together.
 */
export type RoleBucket =
  | 'kamikaze'
  | 'drone'
  | 'gunship'
  | 'sniper'
  | 'transport'
  | 'soft'
  | 'armour';

/** Structural on purpose: the four fields it reads, so this module needs no
 *  sim import and a test can describe a unit without building one. */
export function roleBucket(type: {
  isKamikaze: boolean;
  role?: string;
  transportSlots: number;
  isSoft: boolean;
}): RoleBucket {
  if (type.isKamikaze) return 'kamikaze';
  if (type.role === 'drone') return 'drone';
  if (type.role === 'gunship') return 'gunship';
  if (type.role === 'sniper') return 'sniper';
  if (type.transportSlots > 0) return 'transport';
  return type.isSoft ? 'soft' : 'armour';
}

/** The inspect card's glyphs, unchanged from what hud.ts drew inline. */
export const ROLE_GLYPH: Record<RoleBucket, string> = {
  kamikaze: '✹',
  drone: '⬡',
  gunship: '✈',
  sniper: '✛',
  transport: '▤',
  soft: '▲',
  armour: '■',
};

/**
 * The seven marks as SVG geometry, centred on (x, y) at radius r.
 *
 * Moved here from `vite-plugin-cursors.ts`'s `badgeMark`, which now calls it,
 * because GH-153 gave the shapes a THIRD reader: the selection chip and the
 * unit card both badge a unit with the same mark the cursor wears while it is
 * being ordered. Three hand-copied switch statements over seven buckets is
 * twenty-one chances for one of them to say something different from the
 * others about what a unit is, and a player sees at least two of them at once.
 *
 * `colour` is a parameter and not a constant because the two callers cannot
 * share one. The cursor plugin lives outside `pnpm validate:ui`'s scan root and
 * bakes a palette hex straight into a data URI, since a cursor image inherits
 * nothing; the HUD is inside that root, may not name a colour at all, and wants
 * the mark to take the colour of the text beside it — so it passes
 * `currentColor`. Neither knows the other's answer.
 */
export function roleBadgeShapes(
  bucket: RoleBucket,
  x: number,
  y: number,
  r: number,
  colour: string
): string {
  switch (bucket) {
    case 'armour': // '■' -- a filled square
      return `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${colour}"/>`;
    case 'soft': // '▲' -- a filled triangle
      return `<path d="M${x},${y - r} L${x + r},${y + r} L${x - r},${y + r} Z" fill="${colour}"/>`;
    case 'drone': {
      // '⬡' -- a hexagon
      const h = r;
      return (
        `<path d="M${x - h},${y} L${x - h / 2},${y - h} L${x + h / 2},${y - h} ` +
        `L${x + h},${y} L${x + h / 2},${y + h} L${x - h / 2},${y + h} Z" fill="${colour}"/>`
      );
    }
    case 'gunship': // '✈' -- a dart, distinct from soft's plain triangle
      return (
        `<path d="M${x},${y - r} L${x + r * 0.7},${y + r} L${x},${y + r * 0.35} ` +
        `L${x - r * 0.7},${y + r} Z" fill="${colour}"/>`
      );
    case 'sniper': {
      // '✛' -- a heavy cross
      const t = r * 0.4;
      return (
        `<path d="M${x - t},${y - r} L${x + t},${y - r} L${x + t},${y - t} ` +
        `L${x + r},${y - t} L${x + r},${y + t} L${x + t},${y + t} ` +
        `L${x + t},${y + r} L${x - t},${y + r} L${x - t},${y + t} ` +
        `L${x - r},${y + t} L${x - r},${y - t} L${x - t},${y - t} Z" fill="${colour}"/>`
      );
    }
    case 'transport': // '▤' -- a square ruled with two bars
      return (
        `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="none" stroke="${colour}" stroke-width="1"/>` +
        `<line x1="${x - r}" y1="${y - r / 3}" x2="${x + r}" y2="${y - r / 3}" stroke="${colour}" stroke-width="1"/>` +
        `<line x1="${x - r}" y1="${y + r / 3}" x2="${x + r}" y2="${y + r / 3}" stroke="${colour}" stroke-width="1"/>`
      );
    case 'kamikaze': // '✹' -- an eight-point burst, small
      return (
        `<path d="M${x},${y - r} L${x + r * 0.35},${y - r * 0.35} L${x + r},${y} ` +
        `L${x + r * 0.35},${y + r * 0.35} L${x},${y + r} L${x - r * 0.35},${y + r * 0.35} ` +
        `L${x - r},${y} L${x - r * 0.35},${y - r * 0.35} Z" fill="${colour}"/>`
      );
  }
}

/**
 * The role mark as a standalone inline SVG for the HUD, in `currentColor`.
 *
 * `currentColor` and not a token: the badge is set in the same ink as the name
 * beside it, so a chip that dims dims its badge with it and nothing has to
 * remember to dim two things. That also keeps this file clear of
 * `pnpm validate:ui` — it names no colour at all.
 *
 * Inset by half a unit so a 1px stroke (transport is the only bucket that has
 * one) lands inside the viewBox instead of being clipped in half by it.
 */
export function roleBadgeSvg(bucket: RoleBucket, size: number): string {
  const c = size / 2;
  return (
    `<svg class="rl-badge" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `aria-hidden="true" focusable="false">` +
    `${roleBadgeShapes(bucket, c, c, c - 0.5, 'currentColor')}</svg>`
  );
}
