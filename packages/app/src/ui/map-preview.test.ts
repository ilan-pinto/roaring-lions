// @vitest-environment jsdom
//
// The ground the briefing is about (shell-upgrade Phase 3, Task 3): the
// minimap's one-pixel-per-tile terrain painter, extracted so the deploy
// screen can draw it before any `Sim` exists.
//
// jsdom has no canvas backend -- `getContext` returns null (minimap.test.ts
// records the same) -- so, as there, the context is a recording stub and the
// tones are TAG STRINGS rather than colours (pre-flight M12). A pixel is read
// back as "the last fillRect that covered it", which is exactly what a real
// 2D context would show for opaque fills, without needing one.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMap } from '@lions/data';
import { terrainTonesFor } from '../terrain-themes';
import { paintMapTerrain, type PreviewMap, type PreviewTones } from './map-preview';

interface Fill {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let fills: Fill[] = [];
const realGetContext = HTMLCanvasElement.prototype.getContext;

function installContext(): void {
  fills = [];
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style: String(this.fillStyle), x, y, w, h });
    },
  };
  // Assigned rather than `vi.spyOn`d, for minimap.test.ts's reason: the
  // overloaded `getContext` only typechecks as a spy behind a cast that says
  // the opposite of what is happening. Put back in `afterEach`.
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
}

beforeEach(installContext);
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

/** The tone a real context would show at tile (`x`,`y`): the LAST fill that
 *  covered its centre. 'unpainted' when nothing did. */
function at(x: number, y: number): string {
  let tone = 'unpainted';
  for (const f of fills) {
    if (x + 0.5 >= f.x && x + 0.5 < f.x + f.w && y + 0.5 >= f.y && y + 0.5 < f.y + f.h) tone = f.style;
  }
  return tone;
}

const TONES: PreviewTones = { open: 'open', blocked: 'blocked', rock: 'rock', cover: ['c1', 'c2', 'c3'] };

/**
 * 3x2, and every precedence claim has a tile that can see it -- a tile with
 * only ONE layer set proves nothing about which layer wins:
 *
 *   (0,0) nothing                          -> open
 *   (1,0) blocked + boulder + cover 2      -> blocked  (blocked beats both)
 *   (2,0) boulder + cover 3                -> rock     (boulder beats cover)
 *   (0,1) cover 1                          -> c1
 *   (1,1) cover 3                          -> c3
 *   (2,1) nothing                          -> open
 */
const MAP: PreviewMap = {
  width: 3,
  height: 2,
  blocked: Uint8Array.from([0, 1, 0, 0, 0, 0]),
  boulder: Uint8Array.from([0, 1, 1, 0, 0, 0]),
  cover: Uint8Array.from([0, 2, 3, 1, 3, 0]),
};

describe('paintMapTerrain', () => {
  it("is one pixel per tile, at the map's own dimensions", () => {
    const c = paintMapTerrain(MAP, TONES);
    expect([c?.width, c?.height]).toEqual([3, 2]);
  });

  it('blocked wins over boulder wins over cover wins over open', () => {
    paintMapTerrain(MAP, TONES);
    expect([at(0, 0), at(1, 0), at(2, 0)]).toEqual(['open', 'blocked', 'rock']);
    expect([at(0, 1), at(1, 1), at(2, 1)]).toEqual(['c1', 'c3', 'open']);
  });

  it('clamps a cover tier above 3 rather than reading off the end of the ramp', () => {
    const odd: PreviewMap = { ...MAP, cover: Uint8Array.from([0, 2, 3, 1, 3, 9]) };
    paintMapTerrain(odd, TONES);
    expect(at(2, 1)).toBe('c3');
  });

  // The deploy screen runs where a 2D context may not exist -- this very
  // test environment is one -- and a briefing that threw on its map preview
  // would take the Deploy button down with it. Null is the answer the
  // screen degrades on; `Minimap`, which cannot draw without it, turns the
  // same null into its own throw.
  it('answers null, rather than throwing, when there is no 2D context to paint into', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
    expect(paintMapTerrain(MAP, TONES)).toBeNull();
  });

  // GH-871 P2 T6a. A `~` tile is decor 6, cover 1 AND a boulder (the vehicle
  // wall), so without the marsh branch ahead of the boulder branch the card
  // paints it as rock. Tones are tag strings; the stub reads the last fill.
  describe('the marsh', () => {
    //   (0,0) marsh: decor 6 + boulder + cover 1   -> marsh
    //   (1,0) plain boulder (decor 0)              -> rock
    //   (2,0) decor 6 but blocked                  -> blocked (blocked still wins)
    const MARSH_MAP: PreviewMap = {
      width: 3,
      height: 1,
      blocked: Uint8Array.from([0, 0, 1]),
      boulder: Uint8Array.from([1, 1, 0]),
      cover: Uint8Array.from([1, 0, 0]),
      decor: Uint8Array.from([6, 0, 6]),
    };

    it('paints the marsh tone, not the rock tone, ahead of the boulder branch', () => {
      paintMapTerrain(MARSH_MAP, { ...TONES, marsh: 'marsh' });
      expect([at(0, 0), at(1, 0), at(2, 0)]).toEqual(['marsh', 'rock', 'blocked']);
    });

    it('paints a ~ tile as it always did where the theme has no marsh tone, or the map no decor', () => {
      paintMapTerrain(MARSH_MAP, TONES);
      expect(at(0, 0)).toBe('rock');
      paintMapTerrain({ ...MARSH_MAP, decor: undefined }, { ...TONES, marsh: 'marsh' });
      expect(at(0, 0)).toBe('rock');
    });

    it('is what the Free Play card and the minimap paint from a real parsed wetland map', () => {
      // The two callers hold a ParsedMap and pass it, and terrainTonesFor's
      // result, whole: this is that composition on a literal four-tile map.
      const parsed = parseMap({
        id: 'tiny_wet', name: 'Tiny wet', width: 4, height: 2, terrain: 'wetland',
        rows: ['.~^2', '~b..'], markers: {}, zones: {},
      });
      const tones = terrainTonesFor(parsed);
      expect(tones.marsh).toBeDefined();
      paintMapTerrain(parsed, tones);
      const want = tones.marsh;
      expect([at(1, 0), at(0, 1)]).toEqual([want, want]);
      expect(at(1, 1)).toBe(tones.rock); // the `b` boulder stays rock
      expect(at(2, 0)).toBe(tones.blocked);
    });
  });
});
