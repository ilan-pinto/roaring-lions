// Avatar presets (GH-1075 P1). Leaf module: imports only the catalogue JSON, so the Worker can take it
// without pulling in every map. The default is derived and total: a member who never chose has a crest,
// the same crest on the app and the Worker, because both call this one function.

import presetsJson from '../../../data/avatars/presets.json';

export interface CrestPreset { readonly id: string; readonly family: 'crest'; readonly label: string }
export interface UnitPreset { readonly id: string; readonly family: 'unit'; readonly side: 'kdf' | 'sarim'; readonly unit: string; readonly label: string }
export type AvatarPreset = CrestPreset | UnitPreset;

export const avatarPresets: readonly AvatarPreset[] = presetsJson.presets as readonly AvatarPreset[];
/** FROZEN at catalogue version 1: append-never, reorder-never. A change is a defaultPoolV2, a ruling. */
export const defaultAvatarPool: readonly string[] = presetsJson.defaultPool;
/** Reached only if the catalogue itself is corrupt (a default that is not a preset). */
export const LAST_RESORT_AVATAR = 'crest-chevrons';

/** FNV-1a, 32 bit, over the UTF-8 bytes of `text`. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function isAvatarPreset(id: unknown): id is string {
  return typeof id === 'string' && avatarPresets.some((p) => p.id === id);
}

/** The crest a member has until they choose: defaultPool[fnv1a32(publicId) mod pool length]. */
export function defaultAvatar(publicId: string): string {
  const pool = defaultAvatarPool;
  return pool[fnv1a32(publicId) % pool.length] ?? LAST_RESORT_AVATAR;
}

/** What `me` returns (spec section 7.3). `fallback` is the chosen preset, or the default. */
export type AvatarView =
  | { readonly kind: 'preset'; readonly id: string; readonly chosen: boolean }
  | { readonly kind: 'upload'; readonly rev: number; readonly fallback: string };

export interface AvatarInput {
  readonly publicId: string;
  /** The stored choice, or null/undefined for none. An id the catalogue does not hold counts as none. */
  readonly preset?: string | null;
  /** The upload's revision, when the member has an upload. */
  readonly uploadRev?: number | null;
}

/** Never null. Chain: upload, then the chosen preset, then the default crest, then the chevrons. */
export function resolveAvatar(input: AvatarInput): AvatarView {
  const chosen = isAvatarPreset(input.preset) ? input.preset : null;
  const fallback = chosen ?? (isAvatarPreset(defaultAvatar(input.publicId)) ? defaultAvatar(input.publicId) : LAST_RESORT_AVATAR);
  if (typeof input.uploadRev === 'number') return { kind: 'upload', rev: input.uploadRev, fallback };
  return { kind: 'preset', id: fallback, chosen: chosen !== null };
}
