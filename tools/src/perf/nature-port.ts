// `pnpm nature:capture`'s port rule, kept out of the script (top-level side effects) so a test can drive it
// without ever starting a server or touching a port. The default is 5182 (the lead's pick for GH-984 N2);
// 5177, the lead's everyday dev server, is refused however it arrives.
import { resolvePort } from '../ui-review/port';

export const LEAD_PORT = 5177;
export const NATURE_DEFAULT_PORT = 5182;

/** The refusal line when the RESOLVED port (`--port=`, then `NATURE_CAPTURE_PORT`, then 5182) is the lead's, else null. */
export function naturePortRefusal(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string | null {
  return resolvePort(argv, env, 'NATURE_CAPTURE_PORT', NATURE_DEFAULT_PORT).port === LEAD_PORT
    ? `[nature] refusing port ${LEAD_PORT}: it is the lead's dev server`
    : null;
}
