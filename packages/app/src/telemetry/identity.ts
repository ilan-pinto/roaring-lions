import { ID_PATTERN, TESTER_PATTERN } from '@lions/data/telemetry';

export const PLAYER_KEY = 'lions.telemetry.player';
export const TESTER_KEY = 'lions.telemetry.tester';
export const OPTOUT_KEY = 'lions.telemetry.optout';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** A storage that cannot throw. `get` is the ACCESS itself (a function that retrieves
 *  the browser's persistent store), because with site data blocked the property read
 *  is what throws, and in this repo's vitest jsdom on Node 25 it yields a bare `{}`.
 *  Null means "no storage": the caller keeps its ids for the session. */
export function safeStorage(get: () => unknown): StorageLike | null {
  let s: unknown;
  try {
    s = get();
  } catch {
    return null;
  }
  const real = s as Partial<StorageLike> | null;
  if (!real || typeof real.getItem !== 'function' || typeof real.setItem !== 'function') return null;
  return {
    getItem: (k) => {
      try {
        return real.getItem?.(k) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        real.setItem?.(k, v);
      } catch {
        /* quota or blocked: the id lives for this session */
      }
    },
  };
}

export interface Identity {
  player: string;
  tester?: string;
  returning: boolean;
  optedOut: boolean;
}

/** Reads (and persists) the opt-out signal alone, without minting or storing
 *  a player or tester id. The caller must check this -- together with GPC/DNT
 *  and the prod/host gate -- BEFORE calling `resolveIdentity`, so a user who
 *  is not tracked never gets an id written to storage in the first place. */
export function readOptOut(storage: StorageLike | null, query: URLSearchParams): boolean {
  if (query.has('notrack')) storage?.setItem(OPTOUT_KEY, '1');
  return query.has('notrack') || storage?.getItem(OPTOUT_KEY) === '1';
}

export function resolveIdentity(storage: StorageLike | null, query: URLSearchParams, newId: () => string): Identity {
  const optedOut = readOptOut(storage, query);

  const asked = query.get('tester');
  if (asked !== null && TESTER_PATTERN.test(asked)) storage?.setItem(TESTER_KEY, asked);
  const storedTester = storage?.getItem(TESTER_KEY) ?? null;
  const tester =
    asked !== null && TESTER_PATTERN.test(asked)
      ? asked
      : storedTester !== null && TESTER_PATTERN.test(storedTester)
        ? storedTester
        : undefined;

  const stored = storage?.getItem(PLAYER_KEY) ?? null;
  const returning = stored !== null && ID_PATTERN.test(stored);
  const player = returning ? stored : newId();
  if (!returning) storage?.setItem(PLAYER_KEY, player);

  return tester === undefined ? { player, returning, optedOut } : { player, tester, returning, optedOut };
}
