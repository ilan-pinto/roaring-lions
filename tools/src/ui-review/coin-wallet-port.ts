// The port the Roar-coin wallet check (GH-317) may serve on. Pure: argv and env in, a verdict out, so
// a test can feed it port 5177 and watch it refuse. 5177 is the lead's everyday dev server (CLAUDE.md,
// house rules), and `port.ts` alone only refuses a port that is HELD, which is not the same thing:
// the lead's server may be stopped the moment this runs.
import { resolvePort } from './port';

/** The lead's dev server. Never this check's. */
export const LEAD_PORT = 5177;
/** This check's own default. */
export const COIN_WALLET_DEFAULT_PORT = 5194;

export type CoinWalletPort = { ok: true; port: number } | { ok: false; message: string };

export function coinWalletPort(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): CoinWalletPort {
  let port: number;
  try {
    port = resolvePort(argv, env, 'COIN_WALLET_PORT', COIN_WALLET_DEFAULT_PORT).port;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (port === LEAD_PORT) {
    return { ok: false, message: `port ${LEAD_PORT} is the lead's dev server and is off-limits: pass --port=<n> (default ${COIN_WALLET_DEFAULT_PORT})` };
  }
  return { ok: true, port };
}
