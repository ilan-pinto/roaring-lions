/**
 * The desktop demo's route gate (GH-1418): which routes a content cut closes, and the router's routes with that applied.
 * Split from `demo-cut.ts` because it builds hrefs through `shell/links.ts`, which reads `import.meta.env` at module load
 * and so may only be loaded by the app shell (`main.ts`), never by a module a headless harness loads (`demo-cut.ts` is one).
 * The cut itself is still read only through `demo-cut.ts`.
 */
import { demoCut, missionInDemo, type DemoCut } from './demo-cut';
import { routes } from './links';
import type { RouteDef, RouteRequest } from './router';

/**
 * Where a route outside the cut leaves for, or null when it may mount. Keyed by the route NAMES `main.ts` registers
 * (`demo-cut.test.ts` reads them there, so a renamed route cannot open the gate silently).
 */
export function demoLeaveFor(req: Pick<RouteRequest, 'name' | 'params' | 'query'>, cut: DemoCut = demoCut()): string | null {
  if (cut === null) return null;
  switch (req.name) {
    case 'mission':
    case 'briefing':
      return missionInDemo(req.params.id ?? '', cut) ? null : routes.campaign();
    case 'free-play':
      return routes.menu();
    case 'sandbox':
      // A versus room boots here (`?net=`); hiding versus on desktop is not approved by the lead (20 Nov, ruling 3), so its URL is untouched.
      return req.query.has('net') ? null : routes.menu();
    default:
      return null;
  }
}

/**
 * The router's routes with the cut applied. Without a cut, the same route objects. With one, a route outside the cut
 * mounts nothing and leaves softly, once the router has finished this mount, with a replacing navigation (the pattern
 * `/profile` uses with accounts off): no error card, no history entry left behind to come back to.
 */
export function gateDemoRoutes(defs: readonly RouteDef[], leave: (href: string) => void, cut: DemoCut = demoCut()): RouteDef[] {
  if (cut === null) return [...defs];
  return defs.map((d) => ({
    ...d,
    mount: (host: HTMLElement, req: RouteRequest) => {
      const to = demoLeaveFor(req, cut);
      if (to === null) return d.mount(host, req);
      queueMicrotask(() => leave(to));
      return () => {};
    },
  }));
}
