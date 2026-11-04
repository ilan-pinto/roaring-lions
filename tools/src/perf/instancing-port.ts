// `pnpm perf:instancing`'s port rule, kept out of the script (top-level side effects) so a test can drive it
// without ever starting a server or touching a port. Same shape as `wind-port.ts`.
import { resolvePort } from '../ui-review/port';

export const LEAD_PORT = 5177;
/** The script's own default port: unique among the harnesses (5186 is `bloom-census`'s). */
export const INSTANCING_DEFAULT_PORT = 5266;

/** The refusal line when the RESOLVED port (`--port=`, then `INSTANCING_AB_PORT`, then the default) is the lead's, else null. */
export function instancingPortRefusal(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string | null {
  return resolvePort(argv, env, 'INSTANCING_AB_PORT', INSTANCING_DEFAULT_PORT).port === LEAD_PORT
    ? `[instancing-ab] refusing port ${LEAD_PORT}: it is the lead's dev server`
    : null;
}
