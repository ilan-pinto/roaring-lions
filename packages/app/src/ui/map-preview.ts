// The ground a briefing is about, as one pixel per tile (shell-upgrade Phase 3,
// Task 3; spec Decision 4: "a map preview right").
//
// This is `Minimap`'s own terrain painter, taken OUT of the class rather than
// copied beside it. `Minimap` cannot be built off-mission -- its constructor
// demands a live `Sim` (`MinimapDeps.sim`) -- while the deploy screen is up
// before the mission's runtime exists at all. The painter never needed the
// `Sim`: it reads the map's three terrain layers and four tones and nothing
// else. So the loop lives here once, `Minimap.paintTerrain` is a wrapper that
// calls it, and the two screens cannot drift into showing the same ground two
// ways -- one loop, two callers.
//
// What stayed in `Minimap`: the `dataset.source = 'painted'` label (the
// minimap's own way of telling a test WHICH of its two grounds it blitted,
// pre-flight T3 (5)) and the throw on a missing 2D context. Here a missing
// context is an answer, `null`: the deploy screen degrades to no preview
// rather than losing its Deploy button to a canvas that could not be drawn.

import type { TerrainTones } from '@lions/render';
import type { MinimapMap } from './minimap';

/** The three layers the painter reads, and the two dimensions it needs to
 *  read them -- a structural subset of `MinimapMap` (itself a subset of the
 *  parsed map), so `main.ts`'s own `map` passes straight in. */
export type PreviewMap = Pick<MinimapMap, 'width' | 'height' | 'blocked' | 'boulder' | 'cover'>;

/** The four tones the painter fills with -- the SAME resolved values the
 *  battlefield is drawn with (`TerrainTones`), so neither caller can show a
 *  differently coloured version of the ground the player is about to fight on. */
export type PreviewTones = Pick<TerrainTones, 'open' | 'blocked' | 'rock' | 'cover'>;

/**
 * The ground, once: a canvas `map.width` x `map.height`, one pixel per tile.
 *
 * Cover tiers read as the graining they are on the field; `blocked` covers
 * both buildings and rock ridge; `boulder` gets the rock tone because it is
 * rock, and because on `tel_marum` the boulder corridor is a piece of terrain
 * the player has to plan around and therefore has to be able to see. Where
 * layers overlap, blocked wins over boulder wins over cover wins over open,
 * and a cover tier above 3 is clamped onto the last tone rather than reading
 * off the end of the ramp.
 *
 * Returns `null` when the canvas has no 2D context -- the caller decides
 * whether that is fatal (`Minimap`) or a thing to go without (the deploy
 * screen).
 */
export function paintMapTerrain(map: PreviewMap, tones: PreviewTones): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = map.width;
  c.height = map.height;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = tones.open;
  g.fillRect(0, 0, map.width, map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      let tone: string | null = null;
      if (map.blocked[i] !== 0) tone = tones.blocked;
      else if (map.boulder[i] !== 0) tone = tones.rock;
      else if (map.cover[i] > 0) tone = tones.cover[Math.min(map.cover[i], 3) - 1];
      if (tone === null) continue;
      g.fillStyle = tone;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
