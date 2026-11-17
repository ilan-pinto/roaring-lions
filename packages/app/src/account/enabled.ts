import { LOCAL } from '../telemetry/enabled';

/** Where the page runs: the two facts the network switch needs. */
export interface AccountHost {
  prod: boolean;
  hostname: string;
}

function currentHost(): AccountHost {
  return { prod: import.meta.env.PROD, hostname: typeof location === 'undefined' ? 'localhost' : location.hostname };
}

/**
 * Whether the account client may talk to the server (GH-1075). On by default for a production build on a real host, the
 * telemetry rule: `pnpm dev`, tests and CI (`pnpm ui:routes` fails on any console error, and a dev server has no ACCOUNTS
 * binding) never reach the account routes. `?fresh` (the clean-slate flag) turns it off everywhere. `?accounts` is a no-op on a
 * real host and the dev opt-in elsewhere, like `?telemetry`; old links carrying it keep working.
 * Off, the account client module is never loaded and the guest ledger store is the only store.
 */
export function accountsEnabled(query: URLSearchParams, host: AccountHost = currentHost()): boolean {
  if (query.has('fresh')) return false;
  return query.has('accounts') || (host.prod && !LOCAL.test(host.hostname));
}
