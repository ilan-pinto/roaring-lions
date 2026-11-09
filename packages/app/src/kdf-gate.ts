// The one mapping from a KDF unit's authored `unlock` field names to the sim's `UnlockGate`
// moved to `@lions/economy` (GH-1075 A2), so the Worker's Stores input is built from it too;
// re-exported so no caller changes.
export { kdfUnlockGate } from '@lions/economy';
