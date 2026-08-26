/**
 * The projection contract, independent of which renderer implements it.
 *
 * `Renderer.worldToScreen`/`screenToWorld` (`api.ts`) are one seam with two
 * implementations: `project.ts`'s flat 2D formulas for Pixi, and
 * `three/camera.ts`'s `OrthographicCamera` for three. Both must agree
 * numerically -- that is what `camera.test.ts`'s "agrees with..." tests pin.
 * But numeric agreement between two implementations does not prove either one
 * is *right*: it only proves they have not drifted apart. If both made the
 * same mistake, agreement would stay green.
 *
 * This file is the other half: five properties any correct dimetric
 * projection must satisfy, asserted independently against each
 * implementation via `runProjectionConformance`. Written against only one
 * implementation this would be indistinguishable from a implementation test;
 * run against both, it is what stops a second backend from silently
 * satisfying "agrees with the first one" while both are wrong, and what
 * would catch a *first* implementation regressing even if a second backend
 * never existed.
 */
import { describe, it, expect } from 'vitest';
import type { Camera, Viewport } from './project';

/** Decimal places for float comparisons -- matches camera.test.ts's own bar
 *  for cross-implementation numeric agreement. */
const PRECISION = 3;

/**
 * The projection half of the `Renderer` seam, implementation-agnostic.
 *
 * Matches `project.worldToScreen`/`screenToWorldFlat`'s signatures exactly,
 * which `three/camera.ts`'s `worldToScreenThree`/`screenToWorldThree` also
 * share -- so both can be passed here with no adapter. `lift` stays optional
 * on `worldToScreen` only: `screenToWorld` has no lift counterpart in either
 * implementation (both assume flat ground on the inverse), which is why the
 * two members are not symmetric.
 */
export interface ProjectionUnderTest {
  worldToScreen(wx: number, wy: number, cam: Camera, vp: Viewport, lift?: number): { x: number; y: number };
  screenToWorld(px: number, py: number, cam: Camera, vp: Viewport): { x: number; y: number };
}

const VP: Viewport = { width: 800, height: 600 };
const WIDE_VP: Viewport = { width: 1280, height: 400 };
const CAM: Camera = { x: 24, y: 24, zoom: 1 };
const ZOOMED_CAM: Camera = { x: -8, y: 60, zoom: 1.75 };

/** Points chosen to exercise both diagonals, the origin, and fractional tiles. */
const POINTS: [number, number][] = [
  [24, 24], [0, 0], [47, 12], [12, 47], [3.5, 41.25], [30, 30], [10, 38],
];

/**
 * Runs the shared projection contract against one implementation.
 *
 * Call once per backend. `name` becomes the describe block's label so a
 * failure names both the property that broke and which implementation broke
 * it.
 */
export function runProjectionConformance(name: string, project: ProjectionUnderTest): void {
  describe(`projection conformance: ${name}`, () => {
    it("the camera's own position lands at the viewport centre", () => {
      for (const vp of [VP, WIDE_VP]) {
        for (const cam of [CAM, ZOOMED_CAM]) {
          const p = project.worldToScreen(cam.x, cam.y, cam, vp);
          expect(p.x).toBeCloseTo(vp.width / 2, PRECISION);
          expect(p.y).toBeCloseTo(vp.height / 2, PRECISION);
        }
      }
    });

    it('worldToScreen and screenToWorld are inverses on flat ground', () => {
      // zoom 1, zoom != 1, and a non-square viewport -- three separate
      // conditions the property must hold under, not three properties.
      const cases: [Camera, Viewport][] = [
        [CAM, VP],
        [ZOOMED_CAM, VP],
        [CAM, WIDE_VP],
      ];
      for (const [cam, vp] of cases) {
        for (const [wx, wy] of POINTS) {
          const screen = project.worldToScreen(wx, wy, cam, vp);
          const back = project.screenToWorld(screen.x, screen.y, cam, vp);
          expect(back.x).toBeCloseTo(wx, PRECISION);
          expect(back.y).toBeCloseTo(wy, PRECISION);
        }
      }
    });

    it('displacement from the camera scales linearly with zoom', () => {
      const base: Camera = { x: 10, y: 30, zoom: 1 };
      const factor = 2.5;
      const scaled: Camera = { ...base, zoom: factor };
      for (const [wx, wy] of POINTS) {
        const atZoom1 = project.worldToScreen(wx, wy, base, VP);
        const atZoomFactor = project.worldToScreen(wx, wy, scaled, VP);
        const dx1 = atZoom1.x - VP.width / 2;
        const dy1 = atZoom1.y - VP.height / 2;
        const dxF = atZoomFactor.x - VP.width / 2;
        const dyF = atZoomFactor.y - VP.height / 2;
        expect(dxF).toBeCloseTo(dx1 * factor, PRECISION);
        expect(dyF).toBeCloseTo(dy1 * factor, PRECISION);
      }
    });

    it('the two dimetric diagonals map to pure horizontal and pure vertical screen movement', () => {
      for (const vp of [VP, WIDE_VP]) {
        for (const cam of [CAM, ZOOMED_CAM]) {
          const origin = project.worldToScreen(cam.x, cam.y, cam, vp);

          // The x-y diagonal: screen Y must not move at all.
          const alongXMinusY = project.worldToScreen(cam.x + 5, cam.y - 5, cam, vp);
          expect(alongXMinusY.y).toBeCloseTo(origin.y, PRECISION);
          expect(Math.abs(alongXMinusY.x - origin.x)).toBeGreaterThan(1);

          // The x+y diagonal: screen X must not move at all.
          const alongXPlusY = project.worldToScreen(cam.x + 5, cam.y + 5, cam, vp);
          expect(alongXPlusY.x).toBeCloseTo(origin.x, PRECISION);
          expect(Math.abs(alongXPlusY.y - origin.y)).toBeGreaterThan(1);
        }
      }
    });

    it('lift moves a point up the screen by the lift amount, unscaled by zoom', () => {
      // Zoom fixed at 1 deliberately: this property is about the raw,
      // unscaled relationship between lift pixels and screen pixels. How
      // lift interacts with zoom is a separate, implementation-specific
      // detail already pinned elsewhere (project.test.ts's "subtracts lift
      // before the zoom multiply" and camera.test.ts's "same amount Pixi
      // does" at zoom 1) and is not part of this shared contract.
      const cam: Camera = { x: 24, y: 24, zoom: 1 };
      for (const vp of [VP, WIDE_VP]) {
        for (const [wx, wy] of POINTS) {
          for (const lift of [0, 12, 30, 100]) {
            const flat = project.worldToScreen(wx, wy, cam, vp, 0);
            const lifted = project.worldToScreen(wx, wy, cam, vp, lift);
            expect(lifted.x).toBeCloseTo(flat.x, PRECISION);
            expect(flat.y - lifted.y).toBeCloseTo(lift, PRECISION);
          }
        }
      }
    });
  });
}
