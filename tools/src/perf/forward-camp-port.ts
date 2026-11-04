// The forward-camp browser check's port rule (GH-277), kept out of the script (top-level side effects) so a test can
// drive it without ever starting a server or opening a port. 5177 is the lead's dev server; the check's own default is 5195.
import { resolvePort } from '../ui-review/port';
import { LEAD_PORT } from './wind-port';

export const FORWARD_CAMP_PORT = 5195;

/** The refusal line when the RESOLVED port (`--port=`, then `FORWARD_CAMP_PORT`, then 5195) is the lead's, else null. */
export function forwardCampPortRefusal(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string | null {
  return resolvePort(argv, env, 'FORWARD_CAMP_PORT', FORWARD_CAMP_PORT).port === LEAD_PORT
    ? `[forward-camp] refusing port ${LEAD_PORT}: it is the lead's dev server`
    : null;
}
