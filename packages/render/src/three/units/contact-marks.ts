/**
 * GH-346 (approved by the lead, 2 Oct): a mark over every OBSERVED hostile,
 * shape-coded by what the player knows about it, so the enemy reads at a
 * glance whatever ground it stands on and at any zoom.
 *
 *  - foot, identified:    a downward chevron (points at the man)
 *  - vehicle, identified: a bar (a hull, side on)
 *  - air, identified:     an upward wedge
 *  - suspected (`sim.contactLevel` < 2): a hollow diamond
 *
 * Drawn by `ThreeRenderer.updateOverlays` into the existing `OverlayBatch`
 * (band 4, `render-order.ts`): +0 draw calls, no new `renderOrder`. Colour is
 * `teamColors[1]` (CVD-variant-aware) over a `shadow.1` halo. Only a unit the
 * overlay loop already draws gets one, so fog hides it exactly as it hides
 * the unit. Pure: no `three` import.
 *
 * Measurements and the mock: docs/superpowers/specs/2026-10-02-readability-design.md.
 */
import type { RingClass } from './readability';

export const CONTACT_MARK = {
  /** Half-size of a mark in screen px at zoom 1. */
  halfPx: 6,
  /** Dark halo width, px. */
  haloPx: 1.5,
  /** Halo alpha. */
  haloAlpha: 0.85,
  /** How far above the overlay radius the mark's centre sits. The HP bar is
   *  at r + 10 (3 px tall); a mark's lowest point is r + 22 - 7.5, clear of it. */
  liftPx: 22,
} as const;

/** What a contact mark says. `unknown` is a suspected (not identified) contact. */
export type ContactShape = 'foot' | 'vehicle' | 'air' | 'unknown';

export function contactShapeOf(cls: RingClass, contactLevel: number): ContactShape {
  if (contactLevel < 2) return 'unknown';
  if (cls === 'air') return 'air';
  return cls === 'foot' ? 'foot' : 'vehicle';
}

/** The mark's overlay-px scale at `zoom`. The overlay layer grows and shrinks
 *  with the world (faithful, CLAUDE.md), so below zoom 1 the mark is divided
 *  by zoom and never falls under its zoom-1 size on screen; at and above 1 it
 *  grows with the world like every other overlay. */
export function contactScale(zoom: number): number {
  return zoom >= 1 ? 1 : 1 / Math.max(zoom, 0.05);
}

type Pt = readonly [number, number];
export type ContactTri = readonly [Pt, Pt, Pt];

/** The mark as triangles in overlay px (Pixi convention: y DOWN), centred on
 *  (0, 0), half-size `h`. */
export function contactTriangles(shape: ContactShape, h: number): ContactTri[] {
  switch (shape) {
    case 'foot':
      return [[[-h, -h * 0.7], [h, -h * 0.7], [0, h * 0.9]]];
    case 'vehicle': {
      const w = h * 1.25;
      const t = h * 0.6;
      return [
        [[-w, -t], [w, -t], [w, t]],
        [[-w, -t], [w, t], [-w, t]],
      ];
    }
    case 'air':
      return [
        [[0, -h], [h, h * 0.6], [0, h * 0.1]],
        [[0, -h], [0, h * 0.1], [-h, h * 0.6]],
      ];
    case 'unknown':
      return diamondRing(h, h * 0.55);
  }
}

/** A diamond ring between half-diagonals `outer` and `inner`: four quads,
 *  eight triangles. */
function diamondRing(outer: number, inner: number): ContactTri[] {
  const o: Pt[] = [[0, -outer], [outer, 0], [0, outer], [-outer, 0]];
  const n: Pt[] = [[0, -inner], [inner, 0], [0, inner], [-inner, 0]];
  const out: ContactTri[] = [];
  for (let k = 0; k < 4; k++) out.push([o[k], o[(k + 1) % 4], n[(k + 1) % 4]], [o[k], n[(k + 1) % 4], n[k]]);
  return out;
}

/** The dark halo under a mark: the same shape grown by `halo` px -- and for
 *  the hollow diamond, shrunk by `halo` on its INNER edge too, so both edges
 *  of the ring are haloed. */
export function contactHaloTriangles(shape: ContactShape, h: number, halo: number): ContactTri[] {
  if (shape === 'unknown') return diamondRing(h + halo, Math.max(0, h * 0.55 - halo));
  return contactTriangles(shape, h + halo);
}
