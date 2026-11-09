import type { StorageLike } from '../brigade-account';

export const ACCOUNT_BINDING_KEY = 'lions.account';

/** Written before a claim is sent and removed when it resolves; while it exists the guest store refuses writes (§0.40). */
export const CLAIMING_KEY = 'lions.account.claiming';

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
    store?.removeItem(CLAIMING_KEY); // a pending claim marker belongs to the binding: it must not outlive it (it would lock the guest store)
    store?.removeItem(ACCOUNT_BINDING_KEY);
  } catch {
    /* as above */
  }
}

/** Sign-out and account deletion forget the device id and the claim mark, so the next claim mints a new id (GH-1075 A2, §0.16). */
export function clearDeviceId(store: StorageLike | null): void {
  try {
    store?.removeItem(CLAIMING_KEY); // as `clearBinding`: the marker names the device id being forgotten
  } catch {
    /* a marker that cannot be removed is dropped at the next boot */
  }
  const b = readBinding(store);
  if (b === null) return;
  writeBinding(store, { version: 1, publicId: b.publicId });
}

/** The device's claim id: the one stored in the binding, else a new one (stored when a binding exists). The next claim after sign-out mints a new one (§0.16). */
export function ensureDeviceId(store: StorageLike | null): string {
  const b = readBinding(store);
  if (b?.deviceId !== undefined) return b.deviceId;
  const id = crypto.randomUUID();
  if (b !== null) writeBinding(store, { ...b, deviceId: id });
  return id;
}

/** Strict: true only when the binding now reads back with this `claimedAt` (a refused write must stop the claim, §0.40). */
export function setClaimedAt(store: StorageLike | null, at: number, deviceId?: string): boolean {
  const b = readBinding(store);
  if (b === null || store === null) return false;
  const next: AccountBinding = { ...b, claimedAt: at, ...(deviceId === undefined ? {} : { deviceId }) };
  try {
    store.setItem(ACCOUNT_BINDING_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return readBinding(store)?.claimedAt === at;
}
