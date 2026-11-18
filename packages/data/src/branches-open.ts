/**
 * GH-1384: THE switch for branched upgrade tiers. While it is false, a branched tier plays exactly as the linear tier 3
 * it replaced did on dev:
 *
 *   - `applyUpgrades` and `tierPatch` resolve a branched tier as its ENVELOPE (the per-path maximum of the two
 *     branches), which the validator's B6 and the guard test's case 7 hold equal, to the digit, to the old linear tier 3;
 *   - `@lions/economy`'s shipped branched table is EMPTY (`shippedBranched`), so no buy refuses a branched tier, no
 *     migration writes a pick or a legacy marker, and the stored account and wallet keep dev's shape and version
 *     (`ACCOUNT_VERSION` 2, `ROAR_VERSION` 1);
 *   - mid-mission resume reads a record with no `picks` as dev does.
 *
 * What is live while it is false: the schema accepting `branches`, the validators (B1 to B7, C1, `BRANCH_CEILING`), the
 * branched unit JSON and its `en.json` names, and the branch code itself, which the tests drive by passing a branched
 * table or `open = true` explicitly. Opening it is the lead's call, together with the Garage fork (slice 2) and the net and
 * Worker slice. A module of its own so a test can flip it for every reader at once (`vi.mock`).
 */
export const BRANCHES_OPEN: boolean = false;
