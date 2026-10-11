/** A seat ticket (spec §3.5): `b64url(json payload).b64url(HMAC-SHA256)` under
 *  TICKET_SECRET -- the same Web Crypto pattern as `../auth.ts`'s stats cookie,
 *  NEVER the same secret (rotating STATS_PASSWORD is how dashboard sessions
 *  are revoked). Sent in the first WebSocket message, never the URL. */
import type { Seat } from '@lions/net';

export interface Ticket { matchId: string; seat: Seat; player: string; exp: number }

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`ticket:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signTicket(secret: string, t: Ticket): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(t)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyTicket(secret: string, raw: string, now: number): Promise<Ticket | null> {
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  let sig: Uint8Array<ArrayBuffer>;
  let t: unknown;
  try {
    sig = fromB64url(raw.slice(dot + 1));
    t = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', await key(secret), sig, new TextEncoder().encode(payload));
  if (!ok || typeof t !== 'object' || t === null) return null;
  const v = t as Record<string, unknown>;
  if (typeof v.matchId !== 'string' || (v.seat !== 0 && v.seat !== 1) || typeof v.player !== 'string' || typeof v.exp !== 'number') return null;
  if (v.exp <= now) return null;
  return { matchId: v.matchId, seat: v.seat, player: v.player, exp: v.exp };
}
