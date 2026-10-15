/**
 * The tiles a map's tunnel routes run under, for capture harnesses that pick
 * "empty" ground to park subjects on. A route identified by a `mark_tunnel`
 * carrier draws its x-ray bore (a translucent cyan tube and vent ring) right
 * through the frame, whatever is parked over it: the vehicle-damage sheet's
 * paramotor cells showed exactly that (2026-10-15), because its parade tiles
 * avoided map obstacles but not routes.
 *
 * A route is the polyline mouth -> waypoints -> vent (`map.schema.json`);
 * every tile any part of it crosses counts, sampled at a quarter tile.
 */
export interface TunnelRoute {
  readonly mouth: readonly [number, number];
  readonly waypoints?: readonly (readonly [number, number])[];
  readonly vent: readonly [number, number];
}

export function tunnelRouteTiles(routes: readonly TunnelRoute[]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  const add = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([x, y]);
  };
  for (const r of routes) {
    const pts = [r.mouth, ...(r.waypoints ?? []), r.vent];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        add(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
      }
    }
  }
  return out;
}
