/**
 * SHA-256 of a UTF-8 string, synchronous. Moved to `@lions/economy` (GH-1075 A0) so the
 * Worker's coupon route can share it; this module re-exports it for the app's callers.
 */
export { sha256Hex } from '@lions/economy';
