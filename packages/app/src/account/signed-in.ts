import type { StorageLike } from '../brigade-account';
import { clearBinding, readBinding, writeBinding } from './binding';
import type { AccountClient, MeResult } from './client';

export type SignedInResult =
  | { kind: 'signedIn'; me: MeResult }
  | { kind: 'guest' }
  | { kind: 'deleted' }
  | { kind: 'signedOut'; publicId: string };

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function resolveSignedIn(client: AccountClient, store: StorageLike | null): Promise<SignedInResult> {
  const me = await client.me();
  if (me.kind === 'signedIn') {
    writeBinding(store, { version: 1, publicId: me.publicId });
    return { kind: 'signedIn', me };
  }
  const bound = readBinding(store);
  if (bound === null) return { kind: 'guest' };
  // 'off' (no server answer) keeps the binding: only a tombstone clears it.
  if (me.kind === 'signedOut' && (await client.gone(await sha256Hex(bound.publicId))) === 'deleted') {
    clearBinding(store);
    return { kind: 'deleted' };
  }
  return { kind: 'signedOut', publicId: bound.publicId };
}
