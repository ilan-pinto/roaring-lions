/**
 * WP-P5 (PA-06): where an alert happened, said the way a commander reads it
 * -- relative to what he is looking at.
 *
 * A `Place` is `here` when the point is on screen, otherwise one of eight
 * compass bearings from the CAMERA, in SCREEN terms: "north" is up the
 * screen. Not map north: the battlefield is drawn dimetric, so the map's own
 * axes run diagonally across the screen, and a bearing in tile space would
 * send the player's eye 45 degrees off where the thing actually is. The
 * minimap is top-down and does not share that frame, which is why an alert
 * also flashes the minimap -- the two say the same thing in their own frames.
 *
 * Pure: the caller asks the renderer for the screen point
 * (`renderer.worldToScreen`, CLAUDE.md: projection is asked for, never
 * recomputed) and hands it here with the viewport's size. No `t()` in this
 * file -- it returns values, and `placePhrase` (`mission-notice.ts`) words
 * them where the line is rendered, for the reason `alerts.ts`'s header gives.
 */

export type Bearing = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type Place = 'here' | Bearing;

/** Counter-clockwise from screen-right, one per 45-degree sector. */
const SECTORS: readonly Bearing[] = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se'];

/**
 * Where a screen point lies relative to a viewport of `width` x `height`
 * pixels: `here` inside it, else the bearing from its centre. Screen y grows
 * DOWN, so it is negated before the angle is taken -- up the screen is north.
 * A non-finite point (a projection of nowhere) has no bearing and reads as
 * `here` rather than inventing a direction.
 */
export function placeOnScreen(p: { x: number; y: number }, width: number, height: number): Place {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'here';
  if (p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) return 'here';
  const angle = Math.atan2(-(p.y - height / 2), p.x - width / 2);
  const sector = Math.round(angle / (Math.PI / 4));
  return SECTORS[((sector % 8) + 8) % 8];
}

/** Places in first-seen order, each once -- "north and north" says nothing
 *  "north" does not. */
export function distinctPlaces(places: readonly Place[]): Place[] {
  const out: Place[] = [];
  for (const p of places) if (!out.includes(p)) out.push(p);
  return out;
}
