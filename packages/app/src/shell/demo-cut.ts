/**
 * The desktop demo's content cut (GH-1418; the lead's rulings of 20 Nov 2026: the demo plays the tutorial, First Light,
 * then Beit Sahwan I to IV). The ONE module the app reads it through.
 *
 * WHERE IT COMES FROM. `tools/desktop/demo.json` lists the mission ids; `tools/desktop/build-local.mjs` hands them to
 * `pnpm build` as `RL_DEMO_MISSIONS`, and `packages/app/vite-plugin-demo-cut.ts` bakes them into the bundle as the
 * build-time constant `__DEMO_MISSIONS__`. Every other build (the deployed web game, `pnpm dev`, CI, every test that
 * stubs nothing) bakes `null`, which is "no cut": every function below then answers exactly what the full game did, so
 * the web build is unchanged in behaviour.
 *
 * WHAT A CUT CLOSES. Each surface asks here and nowhere else:
 *   - the campaign WORLD (`campaignWorldJson`): every town keeps only the cut's missions, a town left with none is not
 *     drawn, a region left with no town is "no operations yet", and the world is marked `cut`, so it is never a won war
 *     (`@lions/economy`'s `campaignComplete`). Every board pin, the menu's Continue, the board's Next, the debrief's next
 *     mission (none after Beit Sahwan IV) and the credit and coin pay read this world;
 *   - the ROUTES (`gateDemoRoutes`): `/mission/<id>` and `/briefing/<id>` outside the cut leave softly for the campaign
 *     board, so a deep link, an old `?mission=` URL, a board link and a resumed save all meet the same gate;
 *   - FREE PLAY (`freePlayOpen`): closed. It has no notion of a mission set: its sandbox fields the full task force on
 *     any of the shipped maps. The menu does not offer it, and `/free-play` and `/free-play/<map>` leave for the menu.
 *     The one exception is a versus room (`/free-play/<map>?net=...`): versus boots through the sandbox route, and
 *     hiding versus on desktop is not approved by the lead (20 Nov, ruling 3), so a room's URL is left exactly as it was;
 *   - a SAVED mission (`missionInDemo`, read by `mission-save.ts`'s shipped-mission test): a save of a mission outside
 *     the cut is refused as one this build does not ship, and the board's Resume row says so and offers Discard.
 */
import { world as shippedWorld } from '@lions/data';
import { routes } from './links';
import type { RouteDef, RouteRequest } from './router';

/** The cut: the mission ids the demo plays, or null for the full game. */
export type DemoCut = readonly string[] | null;

/**
 * The cut this build was made with. Null for every build but the desktop demo's. A value that is neither null nor a
 * non-empty list of ids (the plugin refuses one at build time, so only a hand-edited bundle could carry it) is read as
 * an EMPTY cut, which closes every mission: a malformed cut fails closed, never open.
 */
export function demoCut(): DemoCut {
  const v: unknown = typeof __DEMO_MISSIONS__ === 'undefined' ? null : __DEMO_MISSIONS__;
  if (v === null) return null;
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string') ? (v as readonly string[]) : [];
}

/** May this mission be played in this build? Always, without a cut. */
export function missionInDemo(missionId: string, cut: DemoCut = demoCut()): boolean {
  return cut === null || cut.includes(missionId);
}

/** Does this build offer Free play? Not in a cut (see the header). */
export function freePlayOpen(cut: DemoCut = demoCut()): boolean {
  return cut === null;
}

interface TownShape {
  missions: readonly string[];
}
interface RegionShape {
  unlock?: unknown;
  towns: readonly TownShape[];
}
interface WorldShape {
  regions: readonly RegionShape[];
}

/**
 * `world.json` cut to `cut`'s missions, or `json` itself (the same object) with no cut. A town keeps the cut's missions
 * in their authored order and is dropped when none is left; a region with no town left loses its gate as well (a gate on
 * a mission the demo does not ship would only say "locked" about content that is not there), so it reads as "no
 * operations yet". The result carries `cut: true`, which `parseWorld` keeps: a cut world is never a finished war.
 */
export function cutWorld<W extends WorldShape>(json: W, cut: DemoCut): W | (W & { cut: true }) {
  if (cut === null) return json;
  const keep = new Set(cut);
  const regions = json.regions.map((r) => {
    const towns = r.towns.map((t) => ({ ...t, missions: t.missions.filter((m) => keep.has(m)) })).filter((t) => t.missions.length > 0);
    if (towns.length > 0) return { ...r, towns };
    const bare: RegionShape = { ...r, towns };
    delete bare.unlock;
    return bare;
  });
  return { ...json, regions, cut: true } as unknown as W & { cut: true };
}

/** The campaign world this build plays: `@lions/data`'s `world`, cut when the build carries a cut. */
export function campaignWorldJson(cut: DemoCut = demoCut()): typeof shippedWorld {
  return cutWorld(shippedWorld, cut) as typeof shippedWorld;
}

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
