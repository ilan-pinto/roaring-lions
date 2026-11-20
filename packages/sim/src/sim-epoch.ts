/**
 * The sim epoch (GH-1393, decision D-S1 of the mid-mission save design; the lead's ruling: a save keeps working across non-sim updates and
 * is refused only when the sim or the format version changes).
 *
 * A save records the epoch it was made under, and a resume refuses a save from another one. `SNAPSHOT_FORMAT` and the schema digests already
 * refuse a changed STATE TABLE; what they cannot see is a change to sim CODE or TUNING that leaves every column where it was and changes
 * the outcome. That is what the epoch is for: bump `epoch` BY HAND in the commit that deliberately changes sim behaviour, i.e. in the commit that
 * moves a golden pin (`determinism.test.ts`'s pins). A commit that moves the snapshot schema digest, by adding or removing rows that
 * every world encodes (not rows behind a `when`), bumps the epoch too, pin or no pin, as E1 (PR 1609) and E6 (PR 1652) do.
 *
 * `fingerprint` is a hash of those pins AND of every value `tuning.ts` exports (slice 2 of GH-1393: a tuning edit changes what a match does, and
 * a constant no pin world exercises would otherwise move nothing), and `tools/src/sim_epoch.test.ts` recomputes it from the test file's own text: a pin that moves
 * without this record moving is a red test. The fingerprint and the epoch are one literal on purpose, so that editing the fingerprint
 * alone to make the test pass is a visible half-edit in review. Changing a pin and the fingerprint but not the epoch is the mistake this
 * guard exists to make loud, not one it can prevent.
 *
 * A constant and a number: no column, no hash, no tuning. The golden hashes do not move.
 */
// History. Epoch 1, fingerprint 1875494945. Epoch 2, fingerprint 3342987182: the compound gate (GH-1438 E1, PR 1609) ADDED
// `GATE_WORLD_PIN` and appended four sim snapshot rows, so the snapshot schema digest already refused every older save and the
// epoch moved with it. Epoch 2, fingerprint 773375667: versus field works (the lead's ruling, 18 Nov 2026, PR 1587) ADDED a pin
// (`VERSUS_WORKS_WORLD_PIN`, a new works-only world) on top of epoch 2 and moved none (every pin above it reads as on dev), and
// its four side-1 runtime rows are `when: 'worksOnly'`, so no other runtime's digest moves: every world a save can be made in
// plays byte for byte as before, so the epoch stays 2 and only the fingerprint follows the pin list. A moved pin would bump the
// epoch as well. Epoch 3, fingerprint 4288273075: fires on civilians (GH-1438 E6) ADDED `CIV_FIRE_WORLD_PIN` and appended
// two sim snapshot rows (`civFire`, `civFireLive`), so, as at epoch 2, the snapshot schema digest already refuses every older
// save and the epoch moves with it; no existing pin moved.
export const SIM_EPOCH_RECORD = { epoch: 3, fingerprint: 4288273075 } as const;

export const SIM_EPOCH: number = SIM_EPOCH_RECORD.epoch;
