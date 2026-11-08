import type { StorageLike } from '../brigade-account';

export const ACCOUNT_BINDING_KEY = 'lions.account';

/** `deviceId` and `claimedAt` arrive in A2. */
export interface AccountBinding {
  version: 1;
  publicId: string;
}

/** Every access is inside `try`: with site data blocked the property access itself throws. Malformed reads as null. */
export function readBinding(store: StorageLike | null): AccountBinding | null {
  try {
    const text = store?.getItem(ACCOUNT_BINDING_KEY);
    if (typeof text !== 'string') return null;
    const j = JSON.parse(text) as { version?: unknown; publicId?: unknown } | null;
    if (j === null || typeof j !== 'object' || j.version !== 1 || typeof j.publicId !== 'string' || j.publicId === '') return null;
    return { version: 1, publicId: j.publicId };
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
