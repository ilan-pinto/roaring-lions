import { ID_PATTERN, TESTER_PATTERN } from '@lions/data/telemetry';

export const PLAYER_KEY = 'lions.telemetry.player';
export const TESTER_KEY = 'lions.telemetry.tester';
export const OPTOUT_KEY = 'lions.telemetry.optout';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** A storage that cannot throw. `get` is the ACCESS itself (`() => window.localStorage`),
 *  because with site data blocked the property read is what throws, and in this repo's
 *  vitest jsdom on Node 25 it yields a bare `{}`. Null means "no storage": the caller
 *  keeps its ids for the session. */
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

export function resolveIdentity(storage: StorageLike | null, query: URLSearchParams, newId: () => string): Identity {
  if (query.has('notrack')) storage?.setItem(OPTOUT_KEY, '1');
  const optedOut = query.has('notrack') || storage?.getItem(OPTOUT_KEY) === '1';

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
