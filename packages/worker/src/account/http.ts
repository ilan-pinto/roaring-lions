/** The account door's HTTP helpers (GH-1075 A1): JSON out, the CSRF guard, a capped JSON body in. */
import type { Env } from '../d1';
import { originAllowed } from '../origin';
import { readCapped } from '../read-capped';
import { ACCOUNT_BODY_MAX_BYTES } from './config';

/** Never an `access-control-*` header: the account API is same-origin only. */
export function accountJson(status: number, body: unknown, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** null when the request may proceed. `path` is the part after `/api/account/`. */
export function accountGuard(req: Request, env: Env, path: string): Response | null {
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') return accountJson(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD, POST, PATCH, PUT, DELETE' });
  // Steam's redirect is a top-level cross-site GET: it carries no custom header (§1.8.5).
  if (method === 'GET' && path === 'steam/return') return null;
  if (req.headers.get('x-rl-account') !== '1') return accountJson(403, { error: 'forbidden' });
  if (method !== 'GET' && method !== 'HEAD' && !originAllowed(req, env)) return accountJson(403, { error: 'forbidden' });
  if (BODY_METHODS.has(method) && !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return accountJson(415, { error: 'unsupported_media_type' });
  }
  return null;
}

/** The parsed JSON body; null if empty or not JSON; 'too_large' above `max` (default ACCOUNT_BODY_MAX_BYTES). */
export async function readAccountBody<T>(req: Request, max: number = ACCOUNT_BODY_MAX_BYTES): Promise<T | null | 'too_large'> {
  const bytes = await readCapped(req, max);
  if (bytes === null) return 'too_large';
  if (bytes.byteLength === 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}
