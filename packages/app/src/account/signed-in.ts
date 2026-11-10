import type { StorageLike } from '../brigade-account';
import { clearBinding, readBinding, writeBinding } from './binding';
import type { AccountClient, MeResult } from './client';

export type SignedInResult =
  | { kind: 'signedIn'; me: MeResult }
  | { kind: 'guest' }
  | { kind: 'deleted' }
  /** `off`: the server did not answer (offline), so the 401 is not known; the binding is kept either way. */
  | { kind: 'signedOut'; publicId: string; off?: boolean };

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function resolveSignedIn(client: AccountClient, store: StorageLike | null): Promise<SignedInResult> {
  const me = await client.me();
  if (me.kind === 'signedIn') {
    // The same member keeps the device id and the claim mark; a different member starts clean (§0.31).
    const bound = readBinding(store);
    writeBinding(store, bound !== null && bound.publicId === me.publicId ? { ...bound, publicId: me.publicId } : { version: 1, publicId: me.publicId });
    return { kind: 'signedIn', me };
  }
  const bound = readBinding(store);
  if (bound === null) return { kind: 'guest' };
  // 'off' (no server answer) keeps the binding: only a tombstone clears it.
  if (me.kind === 'signedOut' && (await client.gone(await sha256Hex(bound.publicId))) === 'deleted') {
    clearBinding(store);
    return { kind: 'deleted' };
  }
  return me.kind === 'off' ? { kind: 'signedOut', publicId: bound.publicId, off: true } : { kind: 'signedOut', publicId: bound.publicId };
}
