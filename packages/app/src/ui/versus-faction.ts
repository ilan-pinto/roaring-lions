// packages/app/src/ui/versus-faction.ts
/**
 * The two sides of a friend match as the lobby draws them (the face-off,
 * 2026-10-16): which side each seat commands under a matchup, the Blender
 * portraits that stand in for a faction emblem (none exists yet; the lead's
 * ruling is portraits for now), and the side's name and one-line blurb.
 *
 * Every string is resolved when it is ASKED for, never at module load: a table
 * resolved at load freezes in whatever locale was active before `main.ts`'s
 * boot set the catalogue (CLAUDE.md, "Every chrome string goes through t()").
 */
import type { Faction, Matchup } from '@lions/net';
import { t } from '../i18n/t';
import { unitIcon } from './portrait';

/** The portraits each side wears, front figure last: the KDF's armoured
 *  infantry and its tank, Sarim's anti-tank cell and its gun truck (its real
 *  versus force). Two each, overlapped. */
export const FACTION_ART: Readonly<Record<Faction, readonly string[]>> = {
  kdf: ['inf_squad', 'mbt_lavi'],
  sarim: ['atgm_cell', 'gun_truck'],
};

/** The host's side under a matchup: the mirror is KDF against KDF. */
export const hostSide = (m: Matchup): Faction => (m === 'sarim' ? 'sarim' : 'kdf');
/** The friend's side under the host's matchup. */
export const friendSide = (m: Matchup): Faction => (m === 'kdf' ? 'sarim' : 'kdf');

export const factionName = (f: Faction): string => t('versus.faction', { f });
export const factionBlurb = (f: Faction): string => t(`versus.lobby.faction.${f}.blurb`);
/** The segmented control's three labels: KDF, Sarim, Mirror. */
export const matchupLabel = (m: Matchup): string => (m === 'mirror' ? t('versus.lobby.faction.mirror') : factionName(m));

/** A side's portraits, decoration only: hidden from a screen reader, `alt=""`.
 *  A portrait the build does not ship is skipped, never a broken image. */
export function factionArt(f: Faction, className = ''): HTMLElement {
  const box = document.createElement('span');
  box.className = `rl-versus__art ${className}`.trim();
  box.setAttribute('aria-hidden', 'true');
  FACTION_ART[f].forEach((id, i) => {
    const icon = unitIcon(id);
    if (icon === null) return;
    const img = document.createElement('img');
    img.className = 'rl-versus__art-img';
    img.src = icon.url;
    img.alt = '';
    img.dataset.n = String(i);
    box.appendChild(img);
  });
  return box;
}
