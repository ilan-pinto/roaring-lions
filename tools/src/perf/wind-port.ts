// `pnpm wind:capture`'s port rule, kept out of the script (top-level side effects) so a test can drive it
// without ever starting a server or touching a port.
import { resolvePort } from '../ui-review/port';

export const LEAD_PORT = 5177;

/** The refusal line when the RESOLVED port (`--port=`, then `WIND_CAPTURE_PORT`, then 5181) is the lead's, else null. */
export function windPortRefusal(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string | null {
  return resolvePort(argv, env, 'WIND_CAPTURE_PORT', 5181).port === LEAD_PORT
    ? `[wind] refusing port ${LEAD_PORT}: it is the lead's dev server`
    : null;
}
