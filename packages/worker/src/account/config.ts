/** Accounts constants (GH-1075 A1). Values are the spec's, verbatim. */
import type { Env } from '../d1';

const DAY_MS = 86_400_000;

export const SESSION_COOKIE = '__Host-rl_session';
export const PRE_COOKIE_PREFIX = '__Host-rl_pre_';
/** One pre-auth cookie per challenge, so a second tab's `steam/start` cannot overwrite the first. */
export const preCookieName = (c: string): string => PRE_COOKIE_PREFIX + c.slice(0, 16);

export const SESSION_IDLE_MS = 30 * DAY_MS;
export const SESSION_ABS_MS = 180 * DAY_MS;
export const FRESH_MS = 300_000;
export const CHALLENGE_MS = 300_000;

export const MAX_SESSIONS = 10;
export const OP_TTL_MS = 30 * DAY_MS;
export const PENDING_TTL_MS = 7 * DAY_MS;
export const TOMB_TTL_S = 7_776_000;

export const NEW_PER_IP = 5;
export const NEW_ALL = 500;
/** Day budgets for POST steam/start (it writes an auth_challenge row): per address, and overall. */
export const START_PER_IP = 50;
export const START_ALL = 5000;
export const OPS_PER_MEMBER = 400;
export const OPS_ALL = 20_000;

export const ACCOUNT_BODY_MAX_BYTES = 4096;

// GH-1075 A2. Values are the plan's Global Constraints, verbatim.
/** A campaign or a slot, canonical UTF-8: `campaign_state.bytes` and `save_slot.bytes` CHECK against it. */
export const CAMPAIGN_MAX_BYTES = 262_144;
/** 256 KiB plus 8 KiB of envelope: PUT campaign, POST victory, PUT slots/:id. */
export const CAMPAIGN_BODY_MAX = 270_336;
export const CLAIM_BODY_MAX = 1_048_576;
export const CLAIM_COUPON_COINS_CAP = 800;
export const CLAIMS_PER_DAY = 5;
export const DEVICE_CLAIMS_MAX = 20;
export const START_MAX_AGE_MS = 7 * DAY_MS;
/** Attempts a write gets while its batch loses a compare-and-swap race (budgetedOp). */
export const CAS_TRIES = 3;
export const PLAYER_SLOTS = 12;
export const SYSTEM_SLOTS = 4;
/** Code points. */
export const SLOT_NAME_MAX = 64;

export const PINNED_ORIGINS: readonly string[] = ['https://roaring-lions.pint12.workers.dev'];
export const STEAM_OP = 'https://steamcommunity.com/openid/login';
export const ACCOUNT_RETURN_PATH = '/profile?accounts';

/** The pinned origins plus `env.ACCOUNT_ORIGINS` (comma-separated; a local relay only). */
export function accountOrigins(env: Env): string[] {
  const extra = (env.ACCOUNT_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...PINNED_ORIGINS, ...extra];
}

// GH-1075 A3.
/** `GET matches`: the largest `limit`; the default page is `MATCHES_PAGE_DEFAULT`. */
export const MATCHES_PAGE_MAX = 50;
export const MATCHES_PAGE_DEFAULT = 20;
