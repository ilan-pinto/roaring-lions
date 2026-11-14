import type { AccountClient } from './client';

export interface MenuAccountDeps {
  on: boolean;
  /** A device binding exists (`readBinding(...) !== null`): only then is anyone possibly signed in. */
  hasBinding: boolean;
  loadClient: () => Promise<AccountClient>;
  /** Told the answer of `GET open` (the save prompt reads it). */
  onOpen: (open: boolean) => void;
  /** The switch's answer from an earlier mount of this page: reused, so a menu mount asks `GET open` only once. */
  cachedOpen?: Promise<boolean>;
}

/**
 * What the menu and the save prompt ask of the account server (GH-1075). `open` is `GET open` once the lazy client has
 * loaded; any failure reads as closed, silently. `name` is `GET me`, asked only when the device has a binding: a guest's
 * cookie-less call would answer 401 (a console line) and spend the shared per-IP budget for nothing.
 */
export function menuAccount(d: MenuAccountDeps): { open: Promise<boolean>; name: Promise<string | null> | undefined } {
  if (!d.on) return { open: Promise.resolve(false), name: undefined };
  const open =
    d.cachedOpen ??
    d
      .loadClient()
      .then((c) => c.open())
      .catch(() => false)
      .then((v) => {
        d.onOpen(v);
        return v;
      });
  const name = d.hasBinding
    ? d
        .loadClient()
        .then((c) => c.me())
        .then((m) => (m.kind === 'signedIn' ? m.displayName : null), () => null)
    : undefined;
  return { open, name };
}

export interface MenuAccountSourceDeps extends Omit<MenuAccountDeps, 'hasBinding'> {
  /** Read afresh on EVERY menu mount: the profile and claim flows write the binding after the page booted. */
  hasBinding: () => boolean;
}

/**
 * The per-mount form of `menuAccount` (GH-1075). The switch (`GET open`) is asked once per page and shared; the binding is
 * read at each mount, so a sign-in made on the profile screen shows on the menu without a reload. `hasAccount` is the
 * chip's label signal (Sign up for a device that never had an account), read from the binding with no network call.
 */
export function menuAccountSource(d: MenuAccountSourceDeps): () => ReturnType<typeof menuAccount> & { hasAccount: boolean } {
  let openP: Promise<boolean> | undefined;
  return () => {
    const hasAccount = d.hasBinding();
    const r = menuAccount({ ...d, hasBinding: hasAccount, ...(openP ? { cachedOpen: openP } : {}) });
    openP ??= r.open;
    return { ...r, hasAccount };
  };
}
