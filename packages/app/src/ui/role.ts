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
