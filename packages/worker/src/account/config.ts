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
export const OPS_PER_MEMBER = 400;
export const OPS_ALL = 20_000;

export const ACCOUNT_BODY_MAX_BYTES = 4096;

export const PINNED_ORIGINS: readonly string[] = ['https://roaring-lions.pint12.workers.dev'];
export const STEAM_OP = 'https://steamcommunity.com/openid/login';
export const ACCOUNT_RETURN_PATH = '/profile?accounts';

/** The pinned origins plus `env.ACCOUNT_ORIGINS` (comma-separated; a local relay only). */
export function accountOrigins(env: Env): string[] {
  const extra = (env.ACCOUNT_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...PINNED_ORIGINS, ...extra];
}
