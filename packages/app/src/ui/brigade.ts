// The brigade: every KDF unit the campaign knows about, whether it is in reach
// yet, and — for the ones that are not — exactly what would open it. Pure DOM,
// no sim, the same shape as `debrief.ts` beside it.
import { conductAtLeast, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';
import { campaignRoe } from '../campaign';
import { gateSentence } from '../gate-sentence';
import { panel } from './panel';
import { roleBadgeSvg, roleBucket, roleLabel } from './role';

export interface BrigadeUnit {
  id: string;
  name: string;
  role: string;
  unlock?: UnlockGate;
  /**
   * What `roleBucket` needs to pick a role mark for a mesh-only unit's
   * stand-in hatch (F2) — the same four structural fields hud.ts's own card
   * reads off a live `Sim.unitTypes` entry (`packages/sim/src/sim.ts`'s
   * `addUnitType`: `isKamikaze` from `abilities.includes('kamikaze')`,
   * `transportSlots` from `hull.transport_slots ?? 0`, `isSoft` from
   * `hull.armor.front < 30` — the SOFT_ARMOR_LIMIT tuning.ts pins at 30mm),
   * reproduced here from the unit's own JSON because this screen has no
   * running Sim to read them off of.
   */
  isKamikaze: boolean;
  transportSlots: number;
  isSoft: boolean;
}

export interface BrigadeOptions {
  units: BrigadeUnit[];
  ledger: LedgerData;
  /** Resolves a mission id to its player-facing title, for an `afterMission` gate's
   *  sentence -- the same catalogue lookup `showCampaign` hands the world map. A row
   *  gated on a mission this cannot name still reads as a sentence (`gateSentence`'s
   *  neutral fallback), never as the raw id. */
  missionName: (id: string) => string | undefined;
  /** Resolves a unit type to its selection-chip frame, the same lookup the
   *  HUD's own card uses (`ui/hud.ts`'s `portrait` dependency). `null` — for
   *  a type with no sheet, or when the caller has no resolver at all — draws
   *  the reserved hatch instead of a broken image. */
  portrait?: (typeId: string) => string | null;
  /** Every campaign mission grades to 3 stars; the tutorial carries none. */
  possibleStars: number;
  /** The brigade account's balance, for the header. Absent when the caller has no account
   *  (tests, or a boot where storage is blocked): the header then prints no credits line. */
  credits?: number;
  /** Called after the second click on the reset control. The caller resets the account and
   *  re-renders; this screen only asks twice. */
  onReset?: () => void;
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The role mark's size inside the 40px `.rl-brigade__art` frame, matching
 *  hud.ts's own `CHIP_MARK` — the two hatches are the same physical size, so
 *  the mark inside them should read at the same size too. */
const ART_MARK = 18;

/** A row once it is known to be locked: `unlock` narrowed to defined (never a
 *  cast) because `classifyRow` only builds this variant when `u.unlock` is
 *  itself checked non-undefined, and `reason` narrowed to a real string for
 *  the same reason (F2 minor 5: `brigade.ts:79-80` used to cast `u.unlock as
 *  UnlockGate` twice instead of typing this). */
type Row = { u: BrigadeUnit; locked: false } | { u: BrigadeUnit; locked: true; unlock: UnlockGate; reason: string };

function classifyRow(u: BrigadeUnit, ledger: LedgerData, missionName: (id: string) => string | undefined): Row {
  if (u.unlock === undefined) return { u, locked: false };
  const reason = gateSentence(u.unlock, ledger, missionName);
  if (reason === null) return { u, locked: false };
  return { u, locked: true, unlock: u.unlock, reason };
}

/**
 * Which of `gateSentence`'s three checks (the sim's `unlockReason`, spoken as a
 * sentence) is the one actually holding a unit back, and the number that check reads
 * by. Needed only to ORDER locked rows "by the gate that opens soonest" — the reason
 * sentence itself still comes from `gateSentence`, unparsed. Mirrors that function's
 * own precedence (Conduct, then stars, then a named mission) so a row that is locked
 * by its stars gate is never mistaken for one locked by Conduct just because it also
 * declares a `roeMin` it has already cleared.
 *
 * The Conduct check uses `conductAtLeast` -- the exact `sum >= floor * count`
 * predicate `gateSentence` (and the sim's `unlockReason`) itself checks -- and not
 * `campaignRoe`'s rounded mean: two ratings of 39 and 40 against a floor of 40 round
 * to a mean of 40 (reads as cleared) while the exact sum, 79, is short of 80 (still
 * locked). Sorting off the rounded figure could disagree with `gateSentence`'s own
 * verdict about which gate is binding.
 */
function bindingGate(unlock: UnlockGate, ledger: LedgerData): readonly [rank: number, value: number] {
  if (unlock.roeMin !== undefined && !conductAtLeast(ledger, unlock.roeMin)) {
    return [0, unlock.roeMin];
  }
  if (unlock.starsMin !== undefined) {
    if (starsEarned(ledger) < unlock.starsMin) return [1, unlock.starsMin];
  }
  return [2, 0]; // the mission gate — "last", and no threshold to sort within
}

export function showBrigade(host: HTMLElement, opts: BrigadeOptions): void {
  const p = panel({ rank: 'mission', title: 'The brigade', mark: true });
  p.el.classList.add('rl-brigade');
  const b = p.body;

  const head = el('div', 'rl-brigade__head');
  head.appendChild(el('div', 'rl-brigade__stars', `${starsEarned(opts.ledger)} of ${opts.possibleStars} stars`));
  const roe = campaignRoe(opts.ledger);
  head.appendChild(el('div', 'rl-brigade__conduct', roe !== null ? `Conduct ${roe.mean}` : 'no missions rated yet'));
  if (opts.credits !== undefined) {
    head.appendChild(el('div', 'rl-brigade__credits', `${opts.credits} credits`));
  }
  b.appendChild(head);

  // Available first; ties keep their given order (no gate to sort by).
  // Locked rows follow, ordered by the gate that opens soonest — a Conduct
  // floor, then a star count, then a named mission last — ties broken by name.
  const rows = opts.units.map((u) => classifyRow(u, opts.ledger, opts.missionName));
  rows.sort((a, b2) => {
    if (a.locked !== b2.locked) return a.locked ? 1 : -1;
    if (!a.locked || !b2.locked) return 0; // both available: stable, preserves input order
    const [rankA, valA] = bindingGate(a.unlock, opts.ledger);
    const [rankB, valB] = bindingGate(b2.unlock, opts.ledger);
    if (rankA !== rankB) return rankA - rankB;
    if (valA !== valB) return valA - valB;
    return a.u.name.localeCompare(b2.u.name);
  });

  const list = el('div', 'rl-brigade__list');
  for (const row of rows) {
    const { u } = row;
    const rowEl = el('div', 'rl-brigade__row');
    rowEl.dataset.unit = u.id;
    rowEl.dataset.locked = row.locked ? '1' : '0';

    const src = opts.portrait?.(u.id) ?? null;
    if (src !== null) {
      const img = document.createElement('img');
      // Shared by declaration with the HUD's own chip art (theme.css's
      // `.rl-chip__art` rule lists `.rl-brigade__art` too) rather than
      // borrowing the HUD's class name by string.
      img.className = 'rl-brigade__art';
      img.src = src;
      img.alt = '';
      rowEl.appendChild(img);
    } else {
      // The HUD's own "reserved, not broken" hatch (hud.ts's `artHtml`) —
      // the role mark on top, never a bare hatch, so a type with no sheet
      // (`civilians` is the shipped case; the three star-gated units were
      // until their sheets landed) or a sheet that failed to fetch reads as
      // "reserved" rather than "broken".
      const art = document.createElement('div');
      art.className = 'rl-brigade__art';
      art.dataset.nosprite = '1';
      art.title = `${u.id} — no sprite sheet`;
      art.innerHTML = roleBadgeSvg(roleBucket(u), ART_MARK);
      rowEl.appendChild(art);
    }

    const info = el('div', 'rl-brigade__info');
    info.appendChild(el('div', 'rl-brigade__name', u.name));
    info.appendChild(el('div', 'rl-brigade__role', roleLabel(u.role)));
    rowEl.appendChild(info);

    rowEl.appendChild(el('div', 'rl-brigade__why', row.locked ? row.reason : 'available'));
    if (u.unlock?.starsMin !== undefined) {
      rowEl.appendChild(el('div', 'rl-brigade__gate', `★ ${u.unlock.starsMin}`));
    }
    list.appendChild(rowEl);
  }
  b.appendChild(list);

  const nav = el('div', 'rl-endnav');
  const link = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.className = 'rl-btn';
    a.href = href;
    a.textContent = label;
    nav.appendChild(a);
  };
  link('campaign map', '?campaign');
  link('menu', '?');
  if (opts.credits !== undefined && opts.onReset) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'rl-btn rl-brigade__reset';
    reset.textContent = 'reset brigade account';
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'click again to reset — this cannot be undone';
        return;
      }
      // Disabled BEFORE the handler runs, so the second click is provably the
      // last one this control can fire: the caller re-renders, but nothing
      // here relies on that, and a control that says "cannot be undone" must
      // not be able to fire twice.
      reset.disabled = true;
      opts.onReset?.();
    });
    nav.appendChild(reset);
  }
  b.appendChild(nav);

  host.appendChild(p.el);
}
