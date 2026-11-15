/**
 * The sim epoch (GH-1393, decision D-S1 of the mid-mission save design; the lead's ruling: a save keeps working across non-sim updates and
 * is refused only when the sim or the format version changes).
 *
 * A save records the epoch it was made under, and a resume refuses a save from another one. `SNAPSHOT_FORMAT` and the schema digests already
 * refuse a changed STATE TABLE; what they cannot see is a change to sim CODE or TUNING that leaves every column where it was and changes
 * the outcome. That is what the epoch is for: bump `epoch` BY HAND in the commit that deliberately changes sim behaviour, i.e. in the commit that
 * moves a golden pin (`determinism.test.ts`'s pins).
 *
 * `fingerprint` is a hash of those pins, and `tools/src/sim_epoch.test.ts` recomputes it from the test file's own text: a pin that moves
 * without this record moving is a red test. The fingerprint and the epoch are one literal on purpose, so that editing the fingerprint
 * alone to make the test pass is a visible half-edit in review. Changing a pin and the fingerprint but not the epoch is the mistake this
 * guard exists to make loud, not one it can prevent.
 *
 * A constant and a number: no column, no hash, no tuning. The golden hashes do not move.
 */
export const SIM_EPOCH_RECORD = { epoch: 1, fingerprint: 2012679294 } as const;

export const SIM_EPOCH: number = SIM_EPOCH_RECORD.epoch;
