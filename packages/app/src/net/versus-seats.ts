import { sandboxAnchors, type SandboxAnchors } from '../sandbox-anchors';

/**
 * Per-map fair start points for a versus room (#561's "then fix"), for
 * campaign maps whose heuristic seats (`sandboxAnchors`) measured unfair.
 *
 * VERSUS-ROOM CONFIGURATION, not map data: the map JSON is a campaign map's,
 * and the single-player sandbox still stands on `sandboxAnchors`' pick (the
 * golden gate photographs it there). A dedicated versus map names its seats
 * in its own JSON (`versus_0`/`versus_1`) and needs no entry here.
 *
 * Every entry is a measurement, not a taste: `pnpm versus:probe` at 48 seeds
 * per spawn order, after air units began pathing over terrain (PR #721), the
 * cells a room offers on that map (`matchupAllowed`) all inside 60/40. The
 * probe's world registers no tunnel routes where a room's does; nothing digs
 * in a versus room, so the routes stay inert there.
 *
 * - `beit_sahwan_outskirts` (mirror only): the heuristic put seat 1 on
 *   `town_center` (31,22), inside the town, and the west seat won 38 of 48
 *   (79.2%). Seat 1 on the open ground east of the town at (40,24) reads
 *   west 22 / east 26 of 48, no draws. Seat 0 is the heuristic's own `kdf_assembly`.
 *
 * The reading is sensitive to a tile or two (seat 1 at (38,23) reads west
 * 17 / east 6 at 24 seeds, at (43,24) 3 / 21), so a change to a map's
 * terrain, a force, or the sim's movement re-opens the question: re-run the
 * probe.
 */
export const VERSUS_SEATS: Readonly<Record<string, SandboxAnchors>> = {
  beit_sahwan_outskirts: { friendly: [4, 23], hostile: [40, 24] },
};

/** Where a versus room's two seats stand on `map`: seat 0 on `friendly`,
 *  seat 1 on `hostile`. The measured table first, by the map's own `id`, then
 *  the map's named seats or the sandbox heuristic (`sandboxAnchors`). */
export function versusAnchors(map: { id: string } & Parameters<typeof sandboxAnchors>[0]): SandboxAnchors {
  return Object.hasOwn(VERSUS_SEATS, map.id) ? VERSUS_SEATS[map.id] : sandboxAnchors(map);
}
