/**
 * What the game attaches to every note (GH-464, spec §4.1): enough to look at
 * the same ground the player was looking at, read from the sim, the runtime,
 * the HUD and the renderer -- all read-only (invariant 4). Capped at 8 KB of
 * JSON, which the Worker enforces too.
 *
 * Where the spec's table puts a fact the Worker indexes as a COLUMN -- build
 * and commit, mission, map and tick, and the sender's ids -- it rides in
 * `meta` (`meta.ts`) rather than twice. Everything else is here.
 *
 * Pure: `collectContext` takes plain values, and `main.ts` is what reads them
 * off the live objects (`feedback/wire.ts`).
 */
export const CONTEXT_MAX_BYTES = 8 * 1024;
export const FEED_LINES = 12;
export const ERROR_LINES = 5;
export const ERROR_CHARS = 300;
export const UA_CHARS = 200;

export interface FeedbackContext {
  renderer: 'three';
  quality?: string;
  gpu?: string;
  viewport: [number, number];
  dpr: number;
  locale: string;
  ua: string;
  /** The router path: `/mission/<id>`, `/campaign`, ... */
  route: string;
  paused?: boolean;
  objectives?: { id: string; status: string; primary: boolean }[];
  /** The Conduct (ROE) score, and the line under which the stars stop. */
  conduct?: number;
  floor?: number;
  force?: { alive: number; lost: number; fielded: string[]; selected: string[] };
  camera?: { x: number; y: number; zoom: number };
  /** The last feed lines, as shown. */
  feed?: string[];
  settings: { uiScale: string; textSize: number; motion: string; colorVision: string };
  /** The last errors this session logged, first stack frame only. */
  errors: string[];
}

/** The keys a context may carry, in the order the triage view lists them.
 *  The test pins this list against the spec's §4.1 table. */
export const CONTEXT_KEYS: readonly (keyof FeedbackContext)[] = [
  'renderer', 'quality', 'gpu', 'viewport', 'dpr', 'locale', 'ua', 'route', 'paused',
  'objectives', 'conduct', 'floor', 'force', 'camera', 'feed', 'settings', 'errors',
];

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ContextInput extends Omit<FeedbackContext, 'ua' | 'feed' | 'errors' | 'camera'> {
  ua: string;
  feed?: readonly string[];
  errors: readonly string[];
  camera?: { x: number; y: number; zoom: number };
}

/** Clamp each field to its own budget, then the whole to 8 KB. */
export function collectContext(i: ContextInput): FeedbackContext {
  const c: FeedbackContext = {
    renderer: 'three',
    ...(i.quality === undefined ? {} : { quality: i.quality }),
    ...(i.gpu === undefined ? {} : { gpu: i.gpu.slice(0, 160) }),
    viewport: [Math.round(i.viewport[0]), Math.round(i.viewport[1])],
    dpr: round2(i.dpr),
    locale: i.locale.slice(0, 16),
    ua: i.ua.slice(0, UA_CHARS),
    route: i.route.slice(0, 120),
    ...(i.paused === undefined ? {} : { paused: i.paused }),
    ...(i.objectives === undefined ? {} : { objectives: i.objectives.slice(0, 16).map((o) => ({ id: o.id.slice(0, 64), status: o.status, primary: o.primary })) }),
    ...(i.conduct === undefined ? {} : { conduct: Math.round(i.conduct) }),
    ...(i.floor === undefined ? {} : { floor: Math.round(i.floor) }),
    ...(i.force === undefined
      ? {}
      : { force: { alive: i.force.alive, lost: i.force.lost, fielded: i.force.fielded.slice(0, 32), selected: i.force.selected.slice(0, 32) } }),
    ...(i.camera === undefined ? {} : { camera: { x: round2(i.camera.x), y: round2(i.camera.y), zoom: round2(i.camera.zoom) } }),
    ...(i.feed === undefined ? {} : { feed: i.feed.slice(-FEED_LINES).map((l) => l.slice(0, 200)) }),
    settings: i.settings,
    errors: i.errors.slice(-ERROR_LINES).map((e) => e.slice(0, ERROR_CHARS)),
  };
  return capContext(c);
}

/**
 * Hold the context under `CONTEXT_MAX_BYTES`. Sheds the least useful bulk
 * first -- the oldest feed line, then the oldest error, then the unit lists
 * -- and never a scalar a bug report needs. A realistic context measured
 * 1.7 KB (spec §4.1), so this only ever runs on a pathological one.
 */
export function capContext(c: FeedbackContext): FeedbackContext {
  const out: FeedbackContext = structuredClone(c);
  const size = (): number => utf8Bytes(JSON.stringify(out));
  while (size() > CONTEXT_MAX_BYTES) {
    if (out.feed && out.feed.length > 0) out.feed.shift();
    else if (out.errors.length > 0) out.errors.shift();
    else if (out.force && (out.force.fielded.length > 0 || out.force.selected.length > 0)) {
      out.force.selected = [];
      out.force.fielded = [];
    } else if (out.objectives && out.objectives.length > 0) out.objectives.pop();
    else {
      out.ua = '';
      delete out.gpu;
      break;
    }
  }
  return out;
}
