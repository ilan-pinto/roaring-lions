import type { AccountClient } from './client';

export interface MenuAccountDeps {
  on: boolean;
  /** A device binding exists (`readBinding(...) !== null`): only then is anyone possibly signed in. */
  hasBinding: boolean;
  loadClient: () => Promise<AccountClient>;
  /** Told the answer of `GET open` (the save prompt reads it). */
  onOpen: (open: boolean) => void;
}

/**
 * What the menu and the save prompt ask of the account server (GH-1075). `open` is `GET open` once the lazy client has
 * loaded; any failure reads as closed, silently. `name` is `GET me`, asked only when the device has a binding: a guest's
 * cookie-less call would answer 401 (a console line) and spend the shared per-IP budget for nothing.
 */
export function menuAccount(d: MenuAccountDeps): { open: Promise<boolean>; name: Promise<string | null> | undefined } {
  if (!d.on) return { open: Promise.resolve(false), name: undefined };
  const open = d
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
