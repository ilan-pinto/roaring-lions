/**
 * The two Worker configs of the relay split (GH-1397), read as data: `wrangler.jsonc` (the game Worker) and
 * `wrangler.relay.jsonc` (the relay), and `cutConfig`, the lead's cut as a pure function. Test infrastructure,
 * not a test file: `relay-config.test.ts` pins the configs with it, and `relay-split.test.ts` builds its
 * Miniflare Workers from the same parsed configs, so the two-Worker run is the config, not a copy of it.
 * Nothing the Worker ships imports it.
 */
import { readFileSync } from 'node:fs';
import { REPO_ROOT } from './worker-bundle';

export interface DoBinding { name: string; class_name: string; script_name?: string }
export interface Migration { tag: string; new_sqlite_classes?: string[]; new_classes?: string[]; deleted_classes?: string[] }
export interface WranglerCfg {
  name?: string;
  main?: string;
  compatibility_date?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown[];
  route?: unknown;
  migrations?: Migration[];
  durable_objects?: { bindings?: DoBinding[] };
  d1_databases?: { binding: string; database_name?: string; database_id?: string; migrations_dir?: string }[];
  kv_namespaces?: { binding: string }[];
  vars?: Record<string, string>;
  observability?: unknown;
  ratelimits?: { name: string; simple?: { limit: number; period: number } }[];
}

/** Strip // and block comments outside strings and trailing commas, then parse (the wrangler-pin reader). */
const strip = (s: string): string => s.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : '')).replace(/,(\s*[}\]])/g, '$1');
export const readCfg = (file: string): WranglerCfg => JSON.parse(strip(readFileSync(REPO_ROOT + file, 'utf8'))) as WranglerCfg;

export const ROOM_CLASS = 'MatchRoom';
/** The relay's entry file (D-R2). */
export const RELAY_MAIN = 'packages/worker/src/relay.ts';

export const doBinding = (cfg: WranglerCfg, name: string): DoBinding | undefined => (cfg.durable_objects?.bindings ?? []).find((b) => b.name === name);
export const declaresSqliteClass = (cfg: WranglerCfg, tag: string | null, cls: string): boolean =>
  (cfg.migrations ?? []).some((m) => (tag === null || m.tag === tag) && (m.new_sqlite_classes ?? []).includes(cls));

/**
 * The cut (design §4, §5.3 step 3): `ROOMS` gains `script_name` (every room from the cut on is the relay's), and
 * the old namespace stays bound as `ROOMS_LEGACY`, the `ROOMS_NEW=0` lever's target. Nothing else changes: the
 * `net-v1` migration and the `MatchRoom` export stay. Pure: returns a new config.
 */
export function cutConfig(game: WranglerCfg, relayName: string): WranglerCfg {
  const bindings = (game.durable_objects?.bindings ?? []).map((b) => (b.name === 'ROOMS' ? { ...b, script_name: relayName } : b));
  return { ...game, durable_objects: { ...game.durable_objects, bindings: [...bindings, { name: 'ROOMS_LEGACY', class_name: ROOM_CLASS }] } };
}
