/** The 180-day retention the feedback tables (spec §7, D15; GH-1410) and the match evidence rows (desync,
 *  snapshot mismatch) share. Its own module so the relay Worker's bundle (GH-1397, `relay.ts`) does not pull
 *  the feedback code in through it: `relay-config.test.ts` (F8) holds the relay's import closure. */
export const RETENTION_MS = 180 * 86_400_000;
