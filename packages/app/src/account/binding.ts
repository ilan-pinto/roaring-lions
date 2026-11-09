import type { StorageLike } from '../brigade-account';

export const ACCOUNT_BINDING_KEY = 'lions.account';

/** The shape of an op id (`validOpId` on the Worker): a UUID. The device id is minted in the same shape. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `deviceId` is the claim's idempotency key; `claimedAt` marks a device whose guest progress now lives on the server. */
export interface AccountBinding {
  version: 1;
  publicId: string;
  deviceId?: string;
  claimedAt?: number;
}

/** Every access is inside `try`: with site data blocked the property access itself throws. Malformed reads as null. */
export function readBinding(store: StorageLike | null): AccountBinding | null {
  try {
    const text = store?.getItem(ACCOUNT_BINDING_KEY);
    if (typeof text !== 'string') return null;
    const j = JSON.parse(text) as { version?: unknown; publicId?: unknown; deviceId?: unknown; claimedAt?: unknown } | null;
    if (j === null || typeof j !== 'object' || j.version !== 1 || typeof j.publicId !== 'string' || j.publicId === '') return null;
    const out: AccountBinding = { version: 1, publicId: j.publicId };
    if (typeof j.deviceId === 'string' && UUID.test(j.deviceId)) out.deviceId = j.deviceId;
    if (typeof j.claimedAt === 'number' && Number.isInteger(j.claimedAt)) out.claimedAt = j.claimedAt;
    return out;
  } catch {
    return null;
  }
}

export function writeBinding(store: StorageLike | null, b: AccountBinding): void {
  try {
    store?.setItem(ACCOUNT_BINDING_KEY, JSON.stringify(b));
  } catch {
    /* unwritable storage: the binding is a convenience */
  }
}

export function clearBinding(store: StorageLike | null): void {
  try {
    store?.removeItem(ACCOUNT_BINDING_KEY);
  } catch {
    /* as above */
  }
}
