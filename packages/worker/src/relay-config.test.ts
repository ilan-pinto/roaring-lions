/**
 * GH-1397 T2: pins on the two Worker configs for the relay split (design §8.2 and §9, F1 to F4 and F8). Each check
 * is a pure function over parsed configs or source text, in the style of `account/wrangler-pin.test.ts`, and each
 * has a constructed input that turns it red.
 *
 * `wrangler.jsonc` is NOT changed by this slice (design §5.2, P0): `ROOMS` binds the game Worker's own class
 * until the lead's cut PR. So the game-config checks accept two shapes: today's (pre-cut) and the cut. The
 * cut's exact shape is `cutConfig` (`wrangler-cfg.ts`), the same change the runbook gives the lead as a diff
 * (`docs/agent-notes/relay-split.md`), and it is checked here as if applied.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, bundleWorker } from './worker-bundle';
import { RELAY_MAIN, ROOM_CLASS, cutConfig, declaresSqliteClass, doBinding, readCfg, type WranglerCfg } from './wrangler-cfg';

/** Secrets the room reads: a pin cannot see a secret, so it is named here (design §6.2, the parity smoke). */
export const RELAY_SECRETS = ['TICKET_SECRET'] as const;

/** F1 and F4 over the game config. Pre-cut (no `script_name` on `ROOMS`, no `ROOMS_LEGACY`) is today's shape and
 *  only needs today's binding and migration; once either half of the cut is present, all of it must be. */
export function gameRoomsProblems(game: WranglerCfg, relay: WranglerCfg): string[] {
  const out: string[] = [];
  const rooms = doBinding(game, 'ROOMS');
  const legacy = doBinding(game, 'ROOMS_LEGACY');
  if (rooms === undefined) return ['the game config binds no ROOMS'];
  if (rooms.class_name !== ROOM_CLASS) out.push(`ROOMS binds ${rooms.class_name}, not ${ROOM_CLASS}`);
  // F4: the old namespace stays declared, before the cut and after it (the rollback lever's target).
  if (!declaresSqliteClass(game, 'net-v1', ROOM_CLASS)) out.push('the game config no longer declares net-v1 with MatchRoom (the rollback lever needs it)');
  if (rooms.script_name === undefined && legacy === undefined) return out;   // pre-cut: today's shape
  // F1: ROOMS points at the relay, by its name.
  if (rooms.script_name !== relay.name) out.push(`ROOMS.script_name is ${String(rooms.script_name)}, not the relay's name ${String(relay.name)}`);
  // F4: the lever is bound and points at the game Worker's own class, never at the relay.
  if (legacy === undefined) out.push('ROOMS has script_name but ROOMS_LEGACY is not bound (no rollback lever)');
  else {
    if (legacy.class_name !== ROOM_CLASS) out.push(`ROOMS_LEGACY binds ${legacy.class_name}, not ${ROOM_CLASS}`);
    if (legacy.script_name !== undefined) out.push(`ROOMS_LEGACY has script_name ${legacy.script_name}: the lever must be the game Worker's own class`);
  }
  return out;
}

/** F4: `index.ts` still exports the class (deleting it would strand the rollback lever and fail the deploy). */
export function indexExportProblems(indexSource: string): string[] {
  return /^export\s*\{\s*MatchRoom\s*\}\s*from\s*'\.\/match\/match-room';/m.test(indexSource) ? [] : ['index.ts no longer exports MatchRoom'];
}

/** F2: the relay has no public URL (D-R3). `workers_dev` defaults to true when absent, so it must be explicitly false. */
export function relayReachProblems(relay: WranglerCfg): string[] {
  const out: string[] = [];
  if (relay.workers_dev !== false) out.push('the relay must set workers_dev: false');
  if (relay.preview_urls !== false) out.push('the relay must set preview_urls: false');
  if (relay.routes !== undefined || relay.route !== undefined) out.push('the relay must have no routes');
  return out;
}

/** The relay hosts the class from its own entry, in a SQLite migration, on the game Worker's compatibility date. */
export function relayClassProblems(relay: WranglerCfg, game: WranglerCfg): string[] {
  const out: string[] = [];
  if (relay.main !== RELAY_MAIN) out.push(`the relay's main is ${String(relay.main)}, not ${RELAY_MAIN}`);
  if (!declaresSqliteClass(relay, null, ROOM_CLASS)) out.push('the relay declares no new_sqlite_classes migration for MatchRoom');
  if (relay.compatibility_date !== game.compatibility_date) out.push('the relay\'s compatibility_date differs from the game Worker\'s');
  if (JSON.stringify(relay.observability) !== JSON.stringify(game.observability)) out.push('the relay\'s observability block is not the game Worker\'s, verbatim');
  return out;
}

/** Every `this.env.X` the room reads. Derived from the source, so a new read cannot be forgotten (F3). */
export const roomReads = (roomSource: string): string[] => [...new Set([...roomSource.matchAll(/this\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? ''))].sort();

/** F3: each read is a binding of the relay or a named secret; the relay's D1 bindings are the game Worker's
 *  databases and carry no `migrations_dir` (the game config stays the one place D1 migrations are applied from). */
export function relayBindingProblems(relay: WranglerCfg, game: WranglerCfg, reads: readonly string[]): string[] {
  const out: string[] = [];
  const have = new Set<string>([
    ...(relay.d1_databases ?? []).map((d) => d.binding),
    ...(relay.durable_objects?.bindings ?? []).map((b) => b.name),
    ...(relay.kv_namespaces ?? []).map((k) => k.binding),
    ...Object.keys(relay.vars ?? {}),
    ...RELAY_SECRETS,
  ]);
  for (const r of reads) if (!have.has(r)) out.push(`the room reads env.${r} but the relay has no such binding`);
  for (const d of relay.d1_databases ?? []) {
    if (d.migrations_dir !== undefined) out.push(`the relay's ${d.binding} has a migrations_dir`);
    const twin = (game.d1_databases ?? []).find((g) => g.binding === d.binding);
    if (twin === undefined || twin.database_id !== d.database_id || twin.database_name !== d.database_name) out.push(`the relay's ${d.binding} is not the game Worker's database`);
  }
  return out;
}

/**
 * The relay's Workers Builds watch paths (D-R5, runbook §6.1), generated from the bundle's import closure and
 * compared with it (F8). `*` matches any run of characters, `/` included. Include paths may be broader than one
 * file (a directory), and the two config files are always included; excludes keep a test edit from redeploying.
 */
export const RELAY_WATCH_INCLUDE = [
  'packages/worker/src/relay.ts',
  'packages/worker/src/match/*',
  'packages/worker/src/account/config.ts',
  'packages/worker/src/account/crypto.ts',
  'packages/worker/src/account/http.ts',
  'packages/worker/src/account/seat-member.ts',
  'packages/worker/src/account/session.ts',
  'packages/worker/src/auth.ts',
  'packages/worker/src/origin.ts',
  'packages/worker/src/rate-day.ts',
  'packages/worker/src/read-capped.ts',
  'packages/worker/src/retention.ts',
  'packages/net/src/*',
  'packages/sim/src/*',
  'wrangler.relay.jsonc',
  'pnpm-lock.yaml',
] as const;
export const RELAY_WATCH_EXCLUDE = ['*.test.ts'] as const;
const CONFIG_PATHS = new Set<string>(['wrangler.relay.jsonc', 'pnpm-lock.yaml']);
const globRe = (g: string): RegExp => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

/** Modules that must never be in the relay: the game Worker's own surfaces. */
const RELAY_FORBIDDEN = [/^packages\/worker\/src\/stats/, /^packages\/worker\/src\/account\/routes/, /feedback-/, /arena-results/, /^packages\/worker\/src\/index\.ts$/, /^packages\/(app|render)\//];
/** The relay bundle's size ceiling, in bytes of the unminified Vite bundle: 194,673 when recorded (GH-1397),
 *  about 1.25x that. A deliberate growth raises it in the same commit, saying why. */
export const RELAY_BUNDLE_MAX_BYTES = 245_000;

/** F8: the closure is the room's, the bundle stays under its ceiling, and the watch paths cover the closure with no stale entry. */
export function relayClosureProblems(modules: readonly string[], bytes: number, include: readonly string[] = RELAY_WATCH_INCLUDE, exclude: readonly string[] = RELAY_WATCH_EXCLUDE): string[] {
  const out: string[] = [];
  if (modules.length === 0) return ['the relay bundle has no modules (the closure check would pass vacuously)'];
  for (const m of modules) if (RELAY_FORBIDDEN.some((re) => re.test(m))) out.push(`the relay bundle contains ${m}`);
  if (bytes > RELAY_BUNDLE_MAX_BYTES) out.push(`the relay bundle is ${bytes} bytes, over ${RELAY_BUNDLE_MAX_BYTES}`);
  const covered = (m: string): boolean => include.some((g) => globRe(g).test(m)) && !exclude.some((g) => globRe(g).test(m));
  for (const m of modules) if (!m.startsWith('node_modules/') && !covered(m)) out.push(`watch paths miss ${m}`);
  for (const g of include) if (!CONFIG_PATHS.has(g) && !modules.some((m) => globRe(g).test(m))) out.push(`stale watch path ${g}`);
  return out;
}

const game = readCfg('wrangler.jsonc');
const relay = readCfg('wrangler.relay.jsonc');
const roomSource = readFileSync(REPO_ROOT + 'packages/worker/src/match/match-room.ts', 'utf8');
const indexSource = readFileSync(REPO_ROOT + 'packages/worker/src/index.ts', 'utf8');

describe('GH-1397 T2: the game config (F1, F4)', () => {
  it('the repo config is today\'s shape or the cut, never half of it', () => {
    expect(gameRoomsProblems(game, relay)).toEqual([]);
  });
  it('the cut, applied as the runbook gives it, passes F1 and F4', () => {
    const cut = cutConfig(game, String(relay.name));
    expect(gameRoomsProblems(cut, relay)).toEqual([]);
    expect(doBinding(cut, 'ROOMS')).toEqual({ name: 'ROOMS', class_name: 'MatchRoom', script_name: 'roaring-lions-relay' });
    expect(doBinding(cut, 'ROOMS_LEGACY')).toEqual({ name: 'ROOMS_LEGACY', class_name: 'MatchRoom' });
  });
  it('index.ts still exports MatchRoom (F4)', () => {
    expect(indexExportProblems(indexSource)).toEqual([]);
  });
  it('falsification F1: script_name deleted after the cut, or the relay renamed', () => {
    const cut = cutConfig(game, 'roaring-lions-relay');
    const noScript: WranglerCfg = { ...cut, durable_objects: { bindings: (cut.durable_objects?.bindings ?? []).map((b) => (b.name === 'ROOMS' ? { name: b.name, class_name: b.class_name } : b)) } };
    expect(gameRoomsProblems(noScript, relay)).toEqual(['ROOMS.script_name is undefined, not the relay\'s name roaring-lions-relay']);
    expect(gameRoomsProblems(cut, { ...relay, name: 'roaring-lions-relay-2' })).toHaveLength(1);
  });
  it('falsification F4: the lever given the relay\'s script_name, unbound, net-v1 deleted, the export dropped', () => {
    const cut = cutConfig(game, 'roaring-lions-relay');
    const leverToRelay: WranglerCfg = { ...cut, durable_objects: { bindings: (cut.durable_objects?.bindings ?? []).map((b) => (b.name === 'ROOMS_LEGACY' ? { ...b, script_name: 'roaring-lions-relay' } : b)) } };
    expect(gameRoomsProblems(leverToRelay, relay)).toEqual(['ROOMS_LEGACY has script_name roaring-lions-relay: the lever must be the game Worker\'s own class']);
    const noLever: WranglerCfg = { ...cut, durable_objects: { bindings: (cut.durable_objects?.bindings ?? []).filter((b) => b.name !== 'ROOMS_LEGACY') } };
    expect(gameRoomsProblems(noLever, relay)).toEqual(['ROOMS has script_name but ROOMS_LEGACY is not bound (no rollback lever)']);
    expect(gameRoomsProblems({ ...cut, migrations: [] }, relay)).toHaveLength(1);
    expect(gameRoomsProblems({ ...game, migrations: [] }, relay)).toHaveLength(1);   // pre-cut too
    expect(indexExportProblems(indexSource.replace("export { MatchRoom } from './match/match-room';", ''))).toHaveLength(1);
  });
});

describe('GH-1397 T2: the relay config (F2, F3)', () => {
  it('the relay has no public URL (F2)', () => {
    expect(relayReachProblems(relay)).toEqual([]);
  });
  it('the relay hosts MatchRoom from relay.ts, on the game Worker\'s date and observability', () => {
    expect(relayClassProblems(relay, game)).toEqual([]);
  });
  it('every binding the room reads exists on the relay (F3), read from the source', () => {
    const reads = roomReads(roomSource);
    expect(reads).toEqual(['ACCOUNTS', 'DB', 'TICKET_SECRET']);   // a literal: a new read lands here first
    expect(relayBindingProblems(relay, game, reads)).toEqual([]);
  });
  it('falsification F2: workers_dev true or absent, a route, preview_urls true', () => {
    expect(relayReachProblems({ ...relay, workers_dev: true })).toHaveLength(1);
    const noFlag: WranglerCfg = { ...relay };
    delete noFlag.workers_dev;
    expect(relayReachProblems(noFlag)).toHaveLength(1);
    expect(relayReachProblems({ ...relay, routes: [{ pattern: 'relay.example/*' }] })).toHaveLength(1);
    expect(relayReachProblems({ ...relay, preview_urls: true })).toHaveLength(1);
  });
  it('falsification F3: ACCOUNTS removed from the relay, a new env read, a migrations_dir, another database', () => {
    const reads = roomReads(roomSource);
    expect(relayBindingProblems({ ...relay, d1_databases: (relay.d1_databases ?? []).filter((d) => d.binding !== 'ACCOUNTS') }, game, reads)).toEqual(['the room reads env.ACCOUNTS but the relay has no such binding']);
    expect(relayBindingProblems(relay, game, roomReads(roomSource + '\nthis.env.NEW_THING;'))).toEqual(['the room reads env.NEW_THING but the relay has no such binding']);
    expect(relayBindingProblems({ ...relay, d1_databases: (relay.d1_databases ?? []).map((d) => ({ ...d, migrations_dir: 'x' })) }, game, reads)).toHaveLength(2);
    expect(relayBindingProblems({ ...relay, d1_databases: (relay.d1_databases ?? []).map((d) => ({ ...d, database_id: '0' })) }, game, reads)).toHaveLength(2);
  });
  it('falsification: the relay without its migration, on another entry or date', () => {
    expect(relayClassProblems({ ...relay, migrations: [] }, game)).toHaveLength(1);
    expect(relayClassProblems({ ...relay, main: 'packages/worker/src/index.ts' }, game)).toHaveLength(1);
    expect(relayClassProblems({ ...relay, compatibility_date: '2026-01-01' }, game)).toHaveLength(1);
    expect(relayClassProblems({ ...relay, observability: { enabled: false } }, game)).toHaveLength(1);
  });
});

describe('GH-1397 T2: the relay bundle (F8)', () => {
  it('the closure is the room\'s, under its ceiling, and the watch paths cover it with nothing stale', async () => {
    const b = await bundleWorker(RELAY_MAIN);
    expect(b.modules).toContain('packages/worker/src/match/match-room.ts');
    expect(b.modules).toContain('packages/worker/src/retention.ts');   // inlined, still in the closure
    expect(relayClosureProblems(b.modules, b.code.length)).toEqual([]);
  });
  it('falsification F8: stats in the closure, an oversize bundle, a missed module, a stale path, an empty closure', async () => {
    const b = await bundleWorker(RELAY_MAIN);
    expect(relayClosureProblems([...b.modules, 'packages/worker/src/stats.ts'], b.code.length)).toEqual(['the relay bundle contains packages/worker/src/stats.ts', 'watch paths miss packages/worker/src/stats.ts']);
    expect(relayClosureProblems(b.modules, RELAY_BUNDLE_MAX_BYTES + 1)).toHaveLength(1);
    expect(relayClosureProblems(b.modules, b.code.length, RELAY_WATCH_INCLUDE.filter((g) => g !== 'packages/sim/src/*'))).not.toEqual([]);
    expect(relayClosureProblems(b.modules, b.code.length, [...RELAY_WATCH_INCLUDE, 'packages/worker/src/d1.ts'])).toEqual(['stale watch path packages/worker/src/d1.ts']);
    expect(relayClosureProblems([], 0)).toHaveLength(1);
  });
  it('the game Worker\'s bundle still carries the class (the rollback lever)', async () => {
    const b = await bundleWorker('packages/worker/src/index.ts');
    expect(b.modules).toContain('packages/worker/src/match/match-room.ts');
    expect(b.code).toMatch(/export\s*\{[^}]*\bMatchRoom\b/);
  });
});
