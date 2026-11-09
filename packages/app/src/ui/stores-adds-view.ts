// "What it adds": the Stores' panel for one unit card (GH-1076, spec 2026-11-07 §1.1, §1.5).
//
// `stores-adds.ts` computes discriminated values; this turns each into one `t()` sentence. Every visible string,
// numbers included, is a catalogue key with params, so `?pseudo=1` brackets every text node in the panel. The panel
// carries no Buy and reads no wallet: it takes the Stores' own `StoreInput` and the shipped data, nothing else.
// Everything it makes is one element the caller mounts and removes.
import { doctrines, missions, units, world } from '@lions/data';
import { specialRefusal } from '@lions/net';
import type { MissionJson } from '@lions/sim';
import { t } from '../i18n/t';
import threatTable from './generated/threat-table.json';
import { roleBadgeSvg, roleLabel, type RoleBucket } from './role';
import {
  unitAdds,
  type AddsInput,
  type AddsTag,
  type CompareRow,
  type GapLine,
  type UnitAdds,
  type UnitJson,
  type WeakTag,
  type WhereLine,
} from './stores-adds';
import { unitItem, type StoreInput } from './stores-model';

const THREATS = threatTable as Readonly<Record<string, readonly string[]>>;
/** The wounded type is a casualty, not a unit a brigade fields (spec §1.2 input). */
const WOUNDED = 'wounded_kdf';

interface Fixed {
  readonly all: ReadonlyMap<string, UnitJson>;
  readonly kdf: readonly UnitJson[];
  readonly enemies: readonly UnitJson[];
  readonly missions: readonly MissionJson[];
  readonly worldMissionIds: readonly string[];
  readonly versusMenu: ReadonlySet<string>;
}
let fixed: Fixed | null = null;
/** The shipped data every panel reads, built once: it never changes in a session. */
function shipped(): Fixed {
  if (fixed !== null) return fixed;
  const list = Object.values(units) as unknown as UnitJson[];
  fixed = {
    all: new Map(list.map((u) => [u.id, u])),
    kdf: list.filter((u) => u.faction === 'kdf'),
    // Every unit of data/units/enemy (sarim, ashwar, rif): the threat table's own domain. The model throws for a
    // hard KDF type missing from the table, so a narrower list would disagree with it.
    enemies: list.filter((u) => u.faction !== 'kdf' && u.faction !== 'civilian'),
    missions: Object.values(missions) as unknown as MissionJson[],
    worldMissionIds: (world.regions as { towns: { missions: string[] }[] }[]).flatMap((r) => r.towns.flatMap((x) => x.missions)),
    versusMenu: new Set(doctrines.kdf.menu),
  };
  return fixed;
}

/** Whether a card has a panel to open: only a shipped KDF unit does. */
export function addsAvailable(unitId: string): boolean {
  return shipped().all.get(unitId)?.faction === 'kdf';
}

/** The model's input for one unit, off the Stores' own input. The open set is what the Stores calls owned. */
export function addsInput(unitId: string, input: StoreInput): AddsInput | null {
  const s = shipped();
  const unit = s.all.get(unitId);
  if (unit === undefined) return null;
  const open = new Set<string>();
  for (const u of input.units) {
    const state = unitItem(u, input).state;
    if ((state === 'earned' || state === 'coins') && u.id !== WOUNDED) open.add(u.id);
  }
  return {
    unit,
    kdf: s.kdf,
    enemies: s.enemies,
    open,
    ownedTiers: input.owned ?? {},
    ledger: input.ledger,
    missions: s.missions,
    worldMissionIds: s.worldMissionIds,
    versusMenu: s.versusMenu,
    threats: THREATS,
    // R0.8: the sim of the room is the source of the refused list; the app keeps no copy.
    refusal: specialRefusal,
  };
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const num = (n: number): string => String(Math.round(n * 100) / 100);
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

const tagText = (tag: AddsTag, n?: number): string => t(`stores.adds.tag.${tag}`, { n: n ?? 0 });

function weakText(w: WeakTag): string {
  switch (w.kind) {
    case 'minRange':
      return t('stores.adds.weak.minRange', { n: w.n });
    case 'needsSpotter':
      return t('stores.adds.weak.needsSpotter', { sight: w.sight, range: w.range });
    default:
      return t(`stores.adds.weak.${w.kind}`);
  }
}

/** A list capped at four, the rest behind a toggle ("+N more"). */
function cappedList(cls: string, shown: readonly string[], more: readonly string[]): HTMLElement {
  const wrap = el('div', 'rl-stores__adds-capped');
  const list = el('ul', cls);
  for (const s of shown) list.appendChild(el('li', 'rl-stores__adds-item', s));
  const extra: HTMLElement[] = [];
  for (const s of more) {
    const li = el('li', 'rl-stores__adds-item', s);
    li.hidden = true;
    extra.push(li);
    list.appendChild(li);
  }
  wrap.appendChild(list);
  if (more.length > 0) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rl-stores__adds-more';
    let open = false;
    const sync = (): void => {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? t('stores.adds.less') : t('stores.adds.more', { n: more.length });
      for (const li of extra) li.hidden = !open;
    };
    toggle.addEventListener('click', () => {
      open = !open;
      sync();
    });
    sync();
    wrap.appendChild(toggle);
  }
  return wrap;
}

function block(key: string, ...body: HTMLElement[]): HTMLElement {
  const b = el('div', 'rl-stores__adds-block');
  b.dataset.block = key;
  b.appendChild(el('h5', 'rl-stores__adds-bh', t(`stores.adds.h.${key}`)));
  for (const e of body) b.appendChild(e);
  return b;
}

const STAT_LABEL: Readonly<Record<CompareRow['stat'], string>> = {
  range: 'stores.adds.stat.range',
  armourFront: 'garage.stat.armourFront',
  hp: 'garage.stat.hp',
  speed: 'stores.adds.stat.speed',
  sight: 'garage.stat.sight',
};

function compareList(c: UnitAdds['compare']): HTMLElement {
  const wrap = el('div', 'rl-stores__adds-compare');
  wrap.appendChild(
    el('p', 'rl-stores__adds-note', c.against === null ? t('stores.adds.compare.first') : t('stores.adds.compare.against', { name: c.against }))
  );
  const list = el('ul', 'rl-stores__adds-stats');
  for (const r of c.rows) {
    const li = el('li', 'rl-stores__adds-stat');
    li.dataset.stat = r.stat;
    li.appendChild(el('span', 'rl-stores__adds-stat-n', t(STAT_LABEL[r.stat])));
    li.appendChild(
      el('span', 'rl-stores__adds-stat-v', r.theirs === null ? t('stores.adds.stat.alone', { mine: num(r.mine) }) : t('stores.adds.stat.pair', { mine: num(r.mine), theirs: num(r.theirs) }))
    );
    if (r.theirs !== null) {
      const d = Math.round((r.mine - r.theirs) * 100) / 100;
      const signed = d > 0 ? `+${num(d)}` : d < 0 ? `−${num(-d)}` : '0';
      // The sign picks the tone: a bigger number is better in all five rows.
      const tone = d > 0 ? ' rl-good' : d < 0 ? ' rl-bad' : '';
      li.appendChild(el('span', `rl-stores__adds-stat-d${tone}`, t('stores.adds.stat.delta', { d: signed })));
    }
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

function gapText(g: GapLine): string {
  switch (g.kind) {
    case 'firstRole':
      return t('stores.adds.gap.firstRole', { role: roleLabel(g.role) });
    case 'newTags':
      return t('stores.adds.gap.newTags', { tags: g.tags.map((x) => lowerFirst(tagText(x, 0))).join(', ') });
    case 'reach':
      return t('stores.adds.gap.reach', { n: g.n, d: num(g.d) });
    case 'plusOne':
      return t('stores.adds.gap.plusOne', { role: roleLabel(g.role), name: g.name });
  }
}

function whereText(w: WhereLine, missionName: (id: string) => string | undefined): string {
  switch (w.kind) {
    case 'dock':
      return t('stores.adds.where.dock', { n: w.n });
    case 'fieldedAs':
      return t('stores.adds.where.fieldedAs', {
        base: shipped().all.get(w.base)?.name ?? w.base,
        mission: missionName(w.mission) ?? t('stores.honest.mission.unnamed'),
      });
    case 'loaned':
      return t('stores.adds.where.loaned', { n: w.n });
    default:
      return t(`stores.adds.where.${w.kind}`);
  }
}

/** The panel for one unit. `id` is the DOM id the card's control names in `aria-controls`; `headingId` is the
 *  heading focus lands on. */
export function buildAddsPanel(
  unitId: string,
  input: StoreInput,
  missionName: (id: string) => string | undefined,
  id: string,
  headingId: string
): HTMLElement | null {
  const ai = addsInput(unitId, input);
  if (ai === null) return null;
  const a = unitAdds(ai);
  const name = ai.unit.name ?? ai.unit.id;

  const panel = el('section', 'rl-stores__adds');
  panel.id = id;
  panel.dataset.adds = unitId;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', headingId);
  const heading = el('h4', 'rl-stores__adds-h', t('stores.adds.heading', { name }));
  heading.id = headingId;
  heading.tabIndex = -1;
  panel.appendChild(heading);
  const grid = el('div', 'rl-stores__adds-grid');
  panel.appendChild(grid);

  // A. Role
  const role = el('p', 'rl-stores__adds-role');
  const mark = el('span', 'rl-stores__adds-mark');
  mark.innerHTML = roleBadgeSvg(a.role.bucket as RoleBucket, 22);
  role.append(
    mark,
    el('span', 'rl-stores__adds-role-n', roleLabel(a.role.role)),
    el('span', 'rl-stores__adds-purpose', t(`role.${a.role.role}.purpose`))
  );
  grid.appendChild(block('role', role));

  // B. Brings
  grid.appendChild(
    block(
      'brings',
      cappedList(
        'rl-stores__adds-list rl-stores__adds-list--brings',
        a.brings.shown.map((x) => tagText(x.tag, x.n)),
        a.brings.more.map((x) => tagText(x, 0))
      )
    )
  );

  // C. Watch for, and Hurt by
  const watch: HTMLElement[] = [
    cappedList('rl-stores__adds-list rl-stores__adds-list--watch', a.watch.shown.map(weakText), a.watch.more.map(weakText)),
  ];
  if (a.hurtBy !== null) {
    const hurt = el('div', 'rl-stores__adds-hurt');
    hurt.appendChild(el('p', 'rl-stores__adds-note', t('stores.adds.hurtBy.h')));
    if (a.hurtBy.groups.length === 0) {
      hurt.appendChild(el('p', 'rl-stores__adds-item', t('stores.adds.hurtBy.none')));
    } else {
      const list = el('ul', 'rl-stores__adds-list');
      for (const g of a.hurtBy.groups) {
        list.appendChild(el('li', 'rl-stores__adds-item', t('stores.adds.hurtBy.group', { role: roleLabel(g.role), names: g.names.join(', ') })));
      }
      if (a.hurtBy.moreGroups > 0) list.appendChild(el('li', 'rl-stores__adds-item', t('stores.adds.hurtBy.more', { n: a.hurtBy.moreGroups })));
      hurt.appendChild(list);
    }
    if (a.hurtBy.shrugs.length > 0) hurt.appendChild(el('p', 'rl-stores__adds-note', t('stores.adds.shrugs', { names: a.hurtBy.shrugs.join(', ') })));
    watch.push(hurt);
  }
  grid.appendChild(block('watch', ...watch));

  // D. Against your closest unit
  grid.appendChild(block('compare', compareList(a.compare)));

  // E. The gap it fills
  if (a.gap.length > 0) {
    const list = el('ul', 'rl-stores__adds-list');
    for (const g of a.gap) list.appendChild(el('li', 'rl-stores__adds-item', gapText(g)));
    grid.appendChild(block('gap', list));
  }

  // F. Where you can use it
  const where = el('ul', 'rl-stores__adds-list');
  for (const w of a.where) {
    const li = el('li', 'rl-stores__adds-item', whereText(w, missionName));
    li.dataset.where = w.kind;
    where.appendChild(li);
  }
  grid.appendChild(block('where', where));

  // G. Upgrades it can take
  const up = a.upgrades;
  grid.appendChild(
    block(
      'upgrades',
      el(
        'p',
        'rl-stores__adds-item',
        up === null
          ? t('stores.adds.upgrades.none')
          : t('stores.adds.upgrades', {
              n: up.tracks.length,
              names: up.tracks.map((x) => t(`garage.track.${x}`)).join(', '),
              tiers: up.tiers,
              credits: up.credits,
              coins: up.coins,
            })
      )
    )
  );
  return panel;
}
