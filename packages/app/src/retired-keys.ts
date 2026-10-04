/**
 * `localStorage` keys the game no longer reads, removed once at boot.
 *
 * `lions.renderer` held a player's `?renderer=pixi` choice
 * (`renderer-choice.ts`, deleted with the Pixi backend, WP-A3.3). A returning
 * player may still carry it. Nothing reads it any more -- the point of
 * removing it is only that a key nobody owns does not sit in their storage
 * forever, and that no later code can be tempted to read it back.
 *
 * Never throws: a browser with site data blocked throws on the property
 * access itself, and this vitest jsdom configuration can hand over a bare
 * `{}` with no Storage API (CLAUDE.md, "The campaign board").
 */
export const RETIRED_STORAGE_KEYS: readonly string[] = ['lions.renderer'];

type RemoveDoor = () => Partial<Pick<Storage, 'removeItem'>> | null | undefined;

export function forgetRetiredKeys(storage: RemoveDoor = () => window.localStorage): void {
  try {
    const s = storage();
    for (const key of RETIRED_STORAGE_KEYS) s?.removeItem?.(key);
  } catch {
    // Nothing to do: the key was never going to be read.
  }
}
