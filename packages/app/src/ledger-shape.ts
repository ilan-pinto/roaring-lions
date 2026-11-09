// The element-wise ledger shape check moved to `@lions/economy` (GH-1075 A2) so the Worker
// runs the same rules; this module re-exports it so no caller changes.
export { sanitiseLedger } from '@lions/economy';
