/**
 * GH-1102 (the lead's ruling of 7 Nov 2026, the simple version): in a versus room on
 * "Bring your brigade" (`kit: 'brigade'`), every Store special a player owns joins that
 * player's starting force. The friend's specials join the friend's force; a bot seat
 * fields the standard force. No budget, no picker, no balance gate: fairness comes later,
 * from matchmaking. A matched room is unchanged, byte for byte.
 *
 * A "Store special" is a unit whose `unlock` is bought-only (`isBoughtOnly`: a price and
 * no earned field). All twelve are KDF; Sarim has no store. The Worker keeps its own
 * table of them (`worker/src/match/store-specials.ts`, pinned to the data), because it
 * does not bundle the unit JSON.
 *
 * What travels:
 * - the client's create/join body carries `specials: string[]` beside `tiers`, from the
 *   account's bought units (`accountState().boughtUnits`, the view the tier claim already
 *   reads, coin-bought included: D4 of 11 Oct);
 * - the room cleans it against its table (`seatSpecialsField`) and mints the seat's
 *   `SeatConfig.unlocks` from it, in a brigade room, for a human KDF seat, minus
 *   `VERSUS_REFUSED_SPECIALS`. Everywhere else `unlocks` stays `[]`, as it always was;
 * - the lobby shows both seats' lists before Ready (`SeatState.specials`).
 *
 * The sim learns none of this: it sees unit types and placements.
 */

/** Why a Store special cannot come into a versus room at all, whatever the room's kit. */
export type SpecialRefusal = 'rescue' | 'conduct';

/**
 * The Store specials a brigade room refuses, each with its reason. The lead's rule is that
 * every owned special comes; these are the ones that cannot work in a versus room, so they
 * are LISTED to both seats in the lobby (never dropped silently) and logged by the room
 * at the mint.
 *
 * - `veh_ambulance`, `air_medevac_heli`: `rescue`. The 3 Nov 2026 rescue ruling holds both
 *   out of versus (`versus-roster.ts`'s `VERSUS_HELD_UNITS` header): only the Nemala medic
 *   team carries rescue there, and the medevac is an AIR carrier besides.
 * - `spg_cluster`: `conduct`. Its campaign price is Conduct (collateral 0.95, against
 *   civilians and ROE), and a versus room has neither, so the cost that balances it does
 *   not exist there.
 *
 * Every other Store special comes: `inf_medic_squad`, `inf_grenadier`, `recon_zikit`,
 * `heli_peten_gunship`, `mbt_lavi_camo`, `demo_tzav`, `ugv_recon_dog`, `spg_long_range` and
 * `at_nlos_team`. Pinned to the data by `worker/src/match/store-specials.test.ts`.
 */
export const VERSUS_REFUSED_SPECIALS: Readonly<Record<string, SpecialRefusal>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, SpecialRefusal>, {
    veh_ambulance: 'rescue',
    air_medevac_heli: 'rescue',
    spg_cluster: 'conduct',
  }),
);

/** Why `id` is refused in a versus room, or null when it may come. Own keys only. */
export function specialRefusal(id: string): SpecialRefusal | null {
  return Object.hasOwn(VERSUS_REFUSED_SPECIALS, id) ? VERSUS_REFUSED_SPECIALS[id] : null;
}

/** Bounds a seat's `unlocks` and a lobby seat's `specials`, so a config read back from a
 *  replay or the room's storage is bounded as the body is. Twelve Store specials ship;
 *  32 is well over twice that, and `store-specials.test.ts` fails if the table outgrows it. */
export const SPECIALS_MAX = 32;
