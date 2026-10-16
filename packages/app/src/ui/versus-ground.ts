// packages/app/src/ui/versus-ground.ts
/**
 * The ground of a friend match as the lobby draws it (the face-off, with the
 * briefing table's map card; ruling 2026-10-16): a map's picture a pixel a
 * tile, both starts marked, its name and line, and three chips -- its size,
 * the plain fairness label ("Measured even", no figures: the lead's ruling),
 * and the pairing it plays.
 *
 * The facts are the shared rule's, never a second list: `VERSUS_FAIR_MAPS`
 * (every map the lobby offers was measured close to even in a mirror match,
 * GH-561) and `FACTION_MATCHUP_MAPS` (where KDF meets Sarim). The starts are
 * `sandboxAnchors`: seat 0 stands on the friendly anchor, seat 1 on the
 * hostile one. The picture is the free-play picker's own painter.
 */
import { maps, parseMap, type MapJson } from '@lions/data';
import { FACTION_MATCHUP_MAPS, type Seat } from '@lions/net';
import { t } from '../i18n/t';
import { sandboxAnchors } from '../sandbox-anchors';
import { terrainTonesFor } from '../terrain-themes';
import { paintMapTerrain } from './map-preview';

/** True where KDF can meet Sarim; everywhere else is mirror only. */
export const pairsBoth = (id: string): boolean => FACTION_MATCHUP_MAPS.includes(id);

/** A map's label split the way the catalogue writes it, "Name — Line". The
 *  names are DATA (`map.name`), so they read the same in every locale. */
export function splitMapLabel(label: string): { name: string; sub: string | null } {
  const at = label.indexOf(' — ');
  return at < 0 ? { name: label, sub: null } : { name: label.slice(0, at), sub: label.slice(at + 3) };
}

const jsonOf = (id: string): MapJson | undefined => (maps as Record<string, MapJson | undefined>)[id];

/** The map's ground, a pixel a tile; with `startsFor`, both starts marked from
 *  that seat's point of view (yours and your friend's). */
export function mapPicture(id: string, className: string, startsFor: Seat | null): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `rl-versus__pic ${className}`;
  wrap.setAttribute('aria-hidden', 'true');
  const json = jsonOf(id);
  if (json === undefined) return wrap;
  const parsed = parseMap(json);
  const canvas = paintMapTerrain(parsed, terrainTonesFor(parsed));
  if (canvas !== null) {
    canvas.className = 'rl-versus__pic-canvas';
    wrap.appendChild(canvas);
  }
  if (startsFor !== null) {
    const a = sandboxAnchors(json);
    const mine = startsFor === 0 ? a.friendly : a.hostile;
    const theirs = startsFor === 0 ? a.hostile : a.friendly;
    for (const [p, who] of [[mine, 'you'], [theirs, 'friend']] as const) {
      const dot = document.createElement('span');
      dot.className = 'rl-versus__start';
      dot.dataset.who = who;
      dot.style.left = `${((p[0] + 0.5) / json.width) * 100}%`;
      dot.style.top = `${((p[1] + 0.5) / json.height) * 100}%`;
      wrap.appendChild(dot);
    }
  }
  return wrap;
}

function chip(text: string, kind?: string): HTMLElement {
  const c = document.createElement('span');
  c.className = 'rl-versus__chip';
  if (kind !== undefined) c.dataset.kind = kind;
  c.textContent = text;
  return c;
}

/** The map card: picture with starts, name and line, the map's own sentence
 *  (`freePlay.map.<id>`, the picker's), the chips and the starts' key. */
export function mapCard(id: string, label: string, seat: Seat, className = ''): HTMLElement {
  const card = document.createElement('div');
  card.className = `rl-versus__mapcard ${className}`.trim();
  card.appendChild(mapPicture(id, 'rl-versus__pic--big', seat));
  const text = document.createElement('div');
  text.className = 'rl-versus__mapcard-text';
  const { name, sub } = splitMapLabel(label);
  const h = document.createElement('h3');
  h.className = 'rl-versus__mapcard-name';
  h.textContent = name;
  text.appendChild(h);
  if (sub !== null) {
    const s = document.createElement('span');
    s.className = 'rl-versus__mapcard-sub';
    s.textContent = sub;
    text.appendChild(s);
  }
  const desc = document.createElement('p');
  desc.className = 'rl-versus__mapcard-desc';
  desc.textContent = t(`freePlay.map.${id}`);
  text.appendChild(desc);
  const chips = document.createElement('div');
  chips.className = 'rl-versus__chips';
  const json = jsonOf(id);
  if (json !== undefined) chips.appendChild(chip(t('versus.lobby.map.size', { w: json.width, h: json.height })));
  const fair = chip(t('versus.lobby.map.fair'), 'fair');
  fair.title = t('versus.lobby.map.fair.tip');
  chips.append(fair, chip(t('versus.lobby.map.pairing', { both: String(pairsBoth(id)) }), pairsBoth(id) ? undefined : 'quiet'));
  text.appendChild(chips);
  const key = document.createElement('div');
  key.className = 'rl-versus__startkey';
  for (const who of ['you', 'friend'] as const) {
    const k = document.createElement('span');
    k.className = 'rl-versus__startkey-item';
    k.dataset.who = who;
    k.textContent = t(who === 'you' ? 'versus.lobby.map.you' : 'versus.lobby.map.friend');
    key.appendChild(k);
  }
  text.appendChild(key);
  card.appendChild(text);
  return card;
}
