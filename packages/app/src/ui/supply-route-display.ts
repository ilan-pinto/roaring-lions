// S-F F2 C3: when the world draws side 0's supply routes, and which. The world route is ON
// DEMAND, never a standing mark (the minimap is where every route always shows): it draws
// while the strip's logistics figure is hovered or keyboard-focused, and for
// `ROUTE_JUMP_SHOW_MS` after a Space jump lands on a supply alert. Any open dialog or the
// pause menu clears it, and ends a jump window still running.
//
// Timed on the FRAME clock (`performance.now()`), never sim ticks: what the world shows must
// not depend on the sim, and a paused sim must not freeze the route on screen.
//
// The routes come from the HUD beat's one `IncomeView` (`income-view.ts`); this never reads
// the runtime. The same array is handed back while the routes are unchanged, so the renderer,
// which rebuilds on a NEW array, rebuilds only when a recheck actually moved a line.
import type { SupplyRouteView } from '@lions/render';
import type { IncomeView } from './income-view';

/** How long a Space jump onto a supply alert shows the world route, in ms. */
export const ROUTE_JUMP_SHOW_MS = 4000;

/** Side 0's lines as world routes: the convoy, then each zone side 0 holds. A line with no
 *  route draws nothing. A cut line with no cut stretch is cut whole, as `routeLines`
 *  (`minimap.ts`) draws it. */
export function supplyRoutesOf(view: IncomeView | null): SupplyRouteView[] {
  if (view === null) return [];
  const lines = [
    ...(view.convoy ? [view.convoy] : []),
    ...view.zoneViews.map((z) => ({ route: z.route, cut: z.cut, cutSpan: z.cutSpan })),
  ];
  const out: SupplyRouteView[] = [];
  for (const l of lines) {
    if (l.route === null || l.route.length < 2) continue;
    const cutSpan = l.cutSpan ?? (l.cut !== null ? ([0, l.route.length - 1] as const) : null);
    out.push({ tiles: l.route, cutSpan });
  }
  return out;
}

function sameRoutes(a: readonly SupplyRouteView[], b: readonly SupplyRouteView[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.tiles.length !== y.tiles.length) return false;
    for (let k = 0; k < x.tiles.length; k++) if (x.tiles[k] !== y.tiles[k]) return false;
    const xs = x.cutSpan;
    const ys = y.cutSpan;
    if (xs === null || ys === null ? xs !== ys : xs[0] !== ys[0] || xs[1] !== ys[1]) return false;
  }
  return true;
}

export interface SupplyRouteInput {
  /** The HUD beat's income view, null for a mission with no income. */
  readonly view: IncomeView | null;
  /** The strip's logistics figure is hovered or keyboard-focused (`Hud.logisticsHeld`). */
  readonly logisticsHeld: boolean;
  /** A confirm dialog or the pause menu is open. */
  readonly modalOpen: boolean;
  /** The frame clock, `performance.now()`. */
  readonly nowMs: number;
}

export class SupplyRouteDisplay {
  private jumpUntilMs = -Infinity;
  private lastView: IncomeView | null = null;
  private lastRoutes: readonly SupplyRouteView[] = [];

  /** A Space jump landed on a supply alert at `nowMs` (frame clock). */
  jumpLanded(nowMs: number): void {
    this.jumpUntilMs = nowMs + ROUTE_JUMP_SHOW_MS;
  }

  /** What `renderer.supplyRoutes` should be this frame: the routes, or null. */
  routes(input: SupplyRouteInput): readonly SupplyRouteView[] | null {
    if (input.modalOpen) {
      this.jumpUntilMs = -Infinity;
      return null;
    }
    if (!input.logisticsHeld && input.nowMs >= this.jumpUntilMs) return null;
    if (input.view !== this.lastView) {
      this.lastView = input.view;
      const next = supplyRoutesOf(input.view);
      if (!sameRoutes(next, this.lastRoutes)) this.lastRoutes = next;
    }
    return this.lastRoutes.length > 0 ? this.lastRoutes : null;
  }
}
