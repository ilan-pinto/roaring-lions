import { sandboxAnchors, type SandboxAnchors } from '../sandbox-anchors';

/**
 * Per-map fair start points for a versus room (GH-561's "then fix"), for
 * campaign maps whose heuristic seats (`sandboxAnchors`) measured unfair.
 *
 * VERSUS-ROOM CONFIGURATION, not map data: the map JSON is a campaign map's,
 * and the single-player sandbox still stands on `sandboxAnchors`' pick (the
 * golden gate photographs it there). A dedicated versus map names its seats
 * in its own JSON (`versus_0`/`versus_1`) and needs no entry here.
 *
 * Every entry is a measurement, not a taste: `pnpm versus:probe` at 48 seeds
 * per spawn order, after air units began pathing over terrain (PR GH-721), the
 * cells a room offers on that map (`matchupAllowed`) all inside 60/40. The
 * probe's world registers no tunnel routes where a room's does; nothing digs
 * in a versus room, so the routes stay inert there.
 *
 * - `beit_sahwan_outskirts` (mirror only): the heuristic put seat 1 on
 *   `town_center` (31,22), inside the town, and the west seat won 38 of 48
 *   (79.2%). Seat 1 on the open ground east of the town at (40,24) reads
 *   west 22 / east 26 of 48, no draws. Seat 0 is the heuristic's own `kdf_assembly`.
 * - `tel_marum` (mirror and KDF-vs-Sarim; the lead's ruling, 22 Oct): the
 *   heuristic's `start_line` (24,44) read Sarim 29 of 48 with Sarim on seat 0
 *   (60.4%). Seat 0 two tiles further south at (24,46) reads the mirror
 *   west 20 / east 28, KDF-on-seat-0 KDF 24 / Sarim 24, Sarim-on-seat-0
 *   Sarim 22 / KDF 26. Seat 1 is the heuristic's own `overwatch_east`.
 *   At 96 seeds with wounds on (GH-774, 23 Oct) that pair read
 *   Sarim-on-seat-0 Sarim 60 / KDF 36 (62.5%). Seat 0 at (27,45), three tiles
 *   east and one north, with the south tunnel pair back at capacity 4
 *   (`data/versus/tel_marum.json`), reads the mirror west 39 / east 57,
 *   KDF-on-seat-0 Sarim 50 / KDF 46, Sarim-on-seat-0 KDF 52 / Sarim 44; the
 *   economy cells (600 s and 1500 s) and tunnel cell 3 stay inside too.
 *   Under 3-deep vehicle ranks (GH-421) tunnel cell 3 with Sarim on seat 0
 *   read KDF 61 / Sarim 35 (63.5%); the south pair at capacity 5 reads KDF 49 /
 *   Sarim 47 (capacity 2, 3, 4 and 6 read 60.4-63.5%, 6 on the Sarim side).
 * - `wadi_tarfan` (mirror and KDF-vs-Sarim; the lead's ruling, 23 Oct,
 *   GH-769): its own `versus_0`/`versus_1` markers (10,10)/(37,37) read
 *   KDF-vs-Sarim outside 60/40 at 96 seeds with wounds on (placed force, KDF
 *   friendly: KDF 64.6%; economy, KDF friendly: KDF 62.5%), while the tunnel
 *   arm's cell 3 leaned Sarim (59.4% both ways). Both seats one tile toward
 *   the centre, (11,11)/(36,36), keeps the map point-symmetric and reads at 96
 *   seeds: placed KDF 57.3% / Sarim 51%, economy (600 s and 1500 s caps alike)
 *   KDF 53.1% / KDF 51%, mirror east 53.1%. Seats alone could not hold cell 3
 *   (Sarim 67.7% / 72.9% at these seats), so the map's tunnel routes carry
 *   capacity 3, not 4 (data/versus/wadi_tarfan.json): cell 3 Sarim 54.2% /
 *   57.3%. Seventeen seat pairs were screened; the reading swings up to ~25
 *   points for a one-tile move, and a pair inside at 48 seeds failed at 96, so
 *   judge this map at 96.
 *   Under 3-deep vehicle ranks (GH-421) cell 3 with Sarim on seat 0 read
 *   Sarim 60 / KDF 36 (62.5%) at capacity 3; all four routes at capacity 2
 *   read cell 3 Sarim 56.3% / 59.4% (capacity 4 and 5 read 67.7-74.0%).
 *
 * - `milh_flats` (mirror only): a dedicated versus map, whose own named seats
 *   (`versus_0` (9,38), `versus_1` (38,9)) the single-player sandbox still
 *   uses. Under 3-deep vehicle ranks (GH-421) its mirror read west 61 /
 *   east 35 at 96 seeds (63.5%). Seat 0 one tile north at (9,37) reads west
 *   49 / east 47; (8,38), (10,38) and (9,39) read 53-54%.
 *
 * The reading is sensitive to a tile or two (seat 1 at (38,23) reads west
 * 17 / east 6 at 24 seeds, at (43,24) 3 / 21), so a change to a map's
 * terrain, a force, or the sim's movement re-opens the question: re-run the
 * probe.
 */
export const VERSUS_SEATS: Readonly<Record<string, SandboxAnchors>> = {
  beit_sahwan_outskirts: { friendly: [4, 23], hostile: [40, 24] },
  tel_marum: { friendly: [27, 45], hostile: [28, 16] },
  wadi_tarfan: { friendly: [11, 11], hostile: [36, 36] },
  milh_flats: { friendly: [9, 37], hostile: [38, 9] },
};

/** Where a versus room's two seats stand on `map`: seat 0 on `friendly`,
 *  seat 1 on `hostile`. The measured table first, by the map's own `id`, then
 *  the map's named seats or the sandbox heuristic (`sandboxAnchors`). */
export function versusAnchors(map: { id: string } & Parameters<typeof sandboxAnchors>[0]): SandboxAnchors {
  return Object.hasOwn(VERSUS_SEATS, map.id) ? VERSUS_SEATS[map.id] : sandboxAnchors(map);
}
