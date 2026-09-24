// The garage: one unit standing in a lit bay, the roster on a rail beside it,
// and an upgrade board that says what every rung DOES in that unit's own
// numbers.
//
// What it replaces was a list. Twenty rows, each a 40px sprite frame, a name,
// a role, a reason and — for a unit already in the brigade — a strip of pips
// and a button reading `tier 2 · 300`. A player could read the price of every
// upgrade in the game off that screen and not one thing any of them did. The
// project lead's own words (design §6 Phase 1, Decision 8): *"redesign the
// brigade page to look more robust, themed like a shop or garage … better
// explains the benefit of each upgrade … use better graphics and bigger
// font."*
//
// So: the plate (Task 15's engine-rendered capture, the same camera and sun a
// mission uses) large in the bay, the roster as a rail of cards with a status
// chip, and every rung of every track carrying its `formatBenefit` lines —
// `Front armour 700 → 714`, not `tier 1`. Hovering a rung previews it in the
// stat panel above, which is the one thing a shop can do that a list cannot:
// show the change before the money is spent.
//
// What is DELIBERATELY unchanged, because none of it is a look:
//   * `showBrigade`'s signature and every option and callback contract.
//   * `classifyRow` / `bindingGate` — which unit is locked, which gate binds,
//     and the order locked units sort in. Those are economy rules with their
//     own tests, and this task is a re-draw.
//   * The purchase protocol: this screen only ever ASKS (`onBuy`,
//     `onBuyUpgrade`, `onReset`); the caller buys, saves and re-renders.
//   * The two-click reset, and the rule that a Buy control renders only when
//     the caller supplied BOTH a balance and a callback.
import { applyUpgrades, nextTierPrice, readPath, type UpgradableUnit, type UpgradeTracks } from '@lions/data';
import { conductAtLeast, isBoughtOnly, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';
import { campaignRoe } from '../campaign';
import { gateSentence, gateShort } from '../gate-sentence';
import { t } from '../i18n/t';
import type { CampaignLedger } from '../ledger-store';
import { ROSTER_CAP } from '../roster-cap';
import { markSvg } from './mark';
import { plateFit } from './plate-fit';
import { flash } from './motion';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';
import { bucketVisible, roleBadgeSvg, roleBucket, roleLabel, type RoleBucket } from './role';
import { asPercent, benefitLabel, formatBenefit, upgradeBenefits, type BenefitLine } from './upgrade-benefit';

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
   * running Sim to read them off of. The garage reads them twice over: for
   * the stand-in hatch, and for the rail's role tabs.
   */
  isKamikaze: boolean;
  transportSlots: number;
  isSoft: boolean;
  /** Brigade economy step 3 upgrade tracks (`@lions/data`'s `UpgradeTracks`) --
   *  absent for a unit with none. Rendered only on an AVAILABLE unit; a locked
   *  one shows no board at all, since nothing can be bought for a unit not
   *  yet in reach. */
  upgrades?: UpgradeTracks;
}

export interface BrigadeOptions {
  units: BrigadeUnit[];
  ledger: CampaignLedger;
  /** Resolves a mission id to its player-facing title, for an `afterMission` gate's
   *  sentence -- the same catalogue lookup `showCampaign` hands the world map. A unit
   *  gated on a mission this cannot name still reads as a sentence (`gateSentence`'s
   *  neutral fallback), never as the raw id. */
  missionName: (id: string) => string | undefined;
  /** Resolves a unit type to its selection-chip frame, the same lookup the
   *  HUD's own card uses (`ui/hud.ts`'s `portrait` dependency). `null` — for
   *  a type with no sheet, or when the caller has no resolver at all — draws
   *  the reserved hatch instead of a broken image. The garage uses it on the
   *  RAIL, at 3rem; the bay wants a plate, not a chip frame. */
  portrait?: (typeId: string) => string | null;
  /** Which unit ids `portrait` above resolved from a cropped `unitIcon` rather
   *  than a whole sheet frame -- checked only to set the card art's
   *  `data-icon="1"`, which `theme.css` reads to pick `image-rendering` (a
   *  resampled crop must not be nearest-neighboured the way a
   *  palette-quantised sheet frame is). Absent reads as "none of them", the
   *  same as every id reading as a sheet frame. */
  iconIds?: ReadonlySet<string>;
  /** The engine-rendered plate for the bay (Task 15's `unitPlate`): a JPEG of
   *  the unit on lit sand, captured through the game's own camera, with the
   *  plate's own pixel `size` and the unit's measured `extent` inside it.
   *  Both are needed: `ui/plate-fit.ts` divides one by the other to decide how
   *  far to zoom, and a footprint without the frame it was measured in is a
   *  number that means nothing. `null`, or no resolver at all, draws the
   *  reserved hatch — the same "reserved, not broken" language the rail's card
   *  art uses. */
  plate?: (typeId: string) => { url: string; size: readonly [number, number]; extent: readonly [number, number] } | null;
  /** The unit's raw JSON, for the bay's stat panel and for every rung's
   *  benefit lines. Required, not optional: a garage with no numbers is the
   *  list this screen replaced. An id the caller does not know should hand
   *  back a bare `{ id }` — the panel then reads em-dashes rather than
   *  throwing. */
  baseOf: (typeId: string) => UpgradableUnit;
  /** Every campaign mission grades to 3 stars; the tutorial carries none. */
  possibleStars: number;
  /** The brigade account's balance, for the wallet. Absent when the caller has no
   *  account (tests, or a boot where storage is blocked): the header then prints no
   *  wallet, and no purchase control renders anywhere on the screen. */
  credits?: number;
  /** Called after the second click on the reset control. The caller resets the account and
   *  re-renders; this screen only asks twice. */
  onReset?: () => void;
  /** Called when the player clicks a locked, priced unit's Buy control. The caller buys,
   *  saves and re-renders; this screen only asks — it never mutates the account itself. */
  onBuy?: (unitId: string, price: number) => void;
  /** The brigade account's own `upgrades` map: unit id -> track -> owned tier (0 = none).
   *  Absent tiers read as 0. Absent entirely (no account) draws every rung unbought --
   *  still informative as a read-only view of what a track offers. */
  owned?: Record<string, Record<string, number>>;
  /** Called when the player clicks a rung's Buy control. The caller buys,
   *  saves and re-renders; this screen only asks. Rendered only alongside `credits`
   *  -- both present or neither, the same rule the unit-unlock Buy control follows. */
  onBuyUpgrade?: (unitId: string, track: string, tier: number, price: number) => void;
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The role mark's size inside a rail card's 3rem art frame. */
const CARD_MARK = 22;
/** And inside the bay's own reserved-plate hatch, which is the whole width of
 *  the bay rather than a chip. */
const BAY_MARK = 72;

/** The rail's tab order. `roleBucket`'s seven buckets (`ui/role.ts`) are what
 *  this codebase already has for "what kind of thing is this", and they are
 *  what the cursor badge and the HUD card both speak — a second taxonomy here
 *  would be a third answer to the same question on the same screen. Heaviest
 *  first, which is how a player thinks about a motor pool; `all` leads, and is
 *  the default, so the screen opens on the whole roster rather than on
 *  whichever bucket happened to sort first. */
const BUCKET_ORDER: readonly RoleBucket[] = [
  'armour',
  'transport',
  'soft',
  'sniper',
  'drone',
  'gunship',
  'kamikaze',
];

/** The six stats the bay's panel reads, in the order it draws them. Paths, not
 *  field names, because these are the SAME whitelist paths a tier's patch
 *  names — which is what lets a rung's benefit line address a panel row by
 *  `line.path` with nothing in between to get it wrong. */
const PANEL_PATHS: readonly string[] = [
  'hull.hp',
  'hull.armor.front',
  'hull.armor.side',
  'hull.armor.rear',
  'sensors.sight_tiles',
  'weapons[0].accuracy',
];

/** A unit once it is known to be locked: `unlock` narrowed to defined (never a
 *  cast) because `classifyRow` only builds this variant when `u.unlock` is
 *  itself checked non-undefined, and `reason` narrowed to a real string for
 *  the same reason (F2 minor 5: `brigade.ts:79-80` used to cast `u.unlock as
 *  UnlockGate` twice instead of typing this). */
type Row =
  | { u: BrigadeUnit; locked: false }
  | { u: BrigadeUnit; locked: true; unlock: UnlockGate; reason: string; short: string };

function classifyRow(u: BrigadeUnit, ledger: LedgerData, missionName: (id: string) => string | undefined): Row {
  if (u.unlock === undefined) return { u, locked: false };
  const reason = gateSentence(u.unlock, ledger, missionName);
  if (reason === null) return { u, locked: false };
  // `gateShort` is null on exactly the gates `gateSentence` is null on -- both
  // read one `gateRequirement` -- so this branch always has both. The `??` is
  // the type system's price for that, not a real fallback.
  const short = gateShort(u.unlock, ledger, missionName) ?? reason;
  return { u, locked: true, unlock: u.unlock, reason, short };
}

/**
 * Which of `gateSentence`'s three checks (the sim's `unlockReason`, spoken as a
 * sentence) is the one actually holding a unit back, and the number that check reads
 * by. Needed only to ORDER locked units "by the gate that opens soonest" — the reason
 * sentence itself still comes from `gateSentence`, unparsed. Mirrors that function's
 * own precedence (Conduct, then stars, then a named mission) so a unit that is locked
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
  // No earned field failed above, and none of Conduct/stars/mission is declared at all: a
  // bought-only gate (D1, the special forces shape). Sorts after every earned-gated unit,
  // by price.
  if (isBoughtOnly(unlock) && unlock.price !== undefined) return [3, unlock.price];
  return [2, 0]; // the mission gate — "last" among earned gates, and no threshold to sort within
}

/** The owned tier of every track of one unit, clamped to what the data still
 *  declares. Data may SHRINK a track after a purchase (`applyUpgrades`'s own
 *  rule): an owned tier past the track's length reads as maxed, never as a
 *  crash or a phantom rung. */
function ownedTiers(u: BrigadeUnit, owned: Record<string, Record<string, number>> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, track] of Object.entries(u.upgrades ?? {})) {
    out[name] = Math.min(owned?.[u.id]?.[name] ?? 0, track.tiers.length);
  }
  return out;
}

/** A panel number as the player reads it. `percent` is the only kind that is
 *  not printed as the raw figure — accuracy is authored as 0.85 and nobody
 *  reads armour in fractions of a hit. */
function statNumber(value: number, kind: string): string {
  return kind === 'percent' ? t('garage.stat.percent', { n: asPercent(value) }) : String(value);
}

export function showBrigade(host: HTMLElement, opts: BrigadeOptions): Disposer {
  const wrap = el('div', 'rl-menu rl-menu--garage');

  // --- header: the mark, the title, the campaign line, and the wallet -------
  const head = el('header', 'rl-garage__head');
  const brand = el('div', 'rl-garage__brand');
  brand.innerHTML = markSvg(43, 26, 'rl-garage__mark');
  const titles = el('div', 'rl-garage__titles');
  titles.appendChild(el('h1', 'rl-garage__title', t('garage.title')));
  const roe = campaignRoe(opts.ledger);
  const active = opts.ledger['roster.surviving_units'] ?? [];
  const stoodDown = opts.ledger['roster.reserve'] ?? [];
  titles.appendChild(
    el(
      'div',
      'rl-garage__campaign',
      `${t('garage.stars', { n: starsEarned(opts.ledger), m: opts.possibleStars })} · ${
        roe !== null ? t('garage.conduct', { mean: roe.mean }) : t('garage.conduct.none')
      } · ${
        stoodDown.length > 0
          ? t('garage.brigade.reserve', { n: active.length, cap: ROSTER_CAP, r: stoodDown.length })
          : t('garage.brigade', { n: active.length, cap: ROSTER_CAP })
      }`
    )
  );
  brand.appendChild(titles);
  head.appendChild(brand);

  let wallet: HTMLElement | null = null;
  if (opts.credits !== undefined) {
    wallet = el('div', 'rl-garage__wallet');
    // The figure carries no words of its own, so it is set from the number
    // rather than through the catalogue; the WORD beside it is pluralised
    // (`1 credit`), which is the part a locale changes.
    wallet.appendChild(el('span', 'rl-garage__wallet-n', String(opts.credits)));
    wallet.appendChild(el('span', 'rl-garage__wallet-word', t('garage.wallet.word', { n: opts.credits })));
    head.appendChild(wallet);
  }
  wrap.appendChild(head);

  /** Spent: the wallet flashes on the click that asks for a purchase, not on
   *  the re-render that follows it — the caller re-mounts this whole screen,
   *  so a flash started after the callback would be started on a node that is
   *  about to be replaced. */
  const spend = (): void => {
    if (wallet !== null) flash(wallet, 'rl-garage__wallet--spent', 600);
  };

  // --- the roster, classified and ordered exactly as it always was ---------
  // Available first; ties keep their given order (no gate to sort by).
  // Locked units follow, ordered by the gate that opens soonest — a Conduct
  // floor, then a star count, then a named mission, then a bought-only gate
  // (D1, sorted by price) last — ties broken by name.
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

  // Every bar in the stat panel is scaled against the ROSTER's own maximum for
  // that stat, not against the unit's own: a rifleman's 400 hit points and a
  // Lavi's 3000 have to draw at different lengths or the panel says they are
  // the same tank. Read off the base JSON; an upgraded unit can exceed it, and
  // the bar clamps rather than overflowing.
  const rosterMax = new Map<string, number>();
  for (const row of rows) {
    const base = opts.baseOf(row.u.id);
    for (const path of PANEL_PATHS) {
      const v = readPath(base, path);
      if (v === undefined) continue;
      rosterMax.set(path, Math.max(rosterMax.get(path) ?? 0, v));
    }
  }

  const body = el('div', 'rl-garage__body');
  const rail = el('nav', 'rl-garage__rail');
  const bay = el('section', 'rl-garage__bay');
  const board = el('aside', 'rl-garage__board');
  body.append(rail, bay, board);
  wrap.appendChild(body);

  // --- the rail -------------------------------------------------------------
  const present = new Set(rows.map((r) => roleBucket(r.u)));
  const buckets: readonly (RoleBucket | 'all')[] = ['all', ...BUCKET_ORDER.filter((b) => present.has(b))];
  let bucket: RoleBucket | 'all' = 'all';
  let selectedId: string = rows.length > 0 ? rows[0].u.id : '';

  const tabs = el('div', 'rl-garage__tabs');
  tabs.setAttribute('role', 'tablist');
  const tabEls = new Map<RoleBucket | 'all', HTMLButtonElement>();
  for (const b of buckets) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'rl-garage__tab';
    tab.dataset.bucket = b;
    tab.setAttribute('role', 'tab');
    tab.textContent = t(`garage.bucket.${b}`);
    tab.addEventListener('click', () => {
      bucket = b;
      syncTabs();
    });
    tabEls.set(b, tab);
    tabs.appendChild(tab);
  }
  rail.appendChild(tabs);

  const cards = el('div', 'rl-garage__cards');
  cards.setAttribute('role', 'listbox');
  const cardEls = new Map<string, HTMLButtonElement>();
  for (const row of rows) {
    const { u } = row;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'rl-garage__card';
    card.dataset.unit = u.id;
    card.dataset.locked = row.locked ? '1' : '0';
    card.dataset.bucket = roleBucket(u);
    card.setAttribute('role', 'option');

    const src = opts.portrait?.(u.id) ?? null;
    if (src !== null) {
      const img = document.createElement('img');
      img.className = 'rl-garage__card-art';
      img.src = src;
      img.alt = '';
      if (opts.iconIds?.has(u.id) === true) img.dataset.icon = '1';
      card.appendChild(img);
    } else {
      // The HUD's own "reserved, not broken" hatch — the role mark on top,
      // never a bare frame, so a type with no sheet (`civilians` is the
      // shipped case) reads as reserved rather than as a broken image.
      const art = el('div', 'rl-garage__card-art');
      art.dataset.nosprite = '1';
      // Named, not silent: the hatch says WHICH type has no sheet, which is
      // the difference between "reserved" and "this build is broken" for
      // anyone looking at the roster.
      art.title = t('garage.card.noSprite', { id: u.id });
      art.innerHTML = roleBadgeSvg(roleBucket(u), CARD_MARK);
      card.appendChild(art);
    }

    const text = el('div', 'rl-garage__card-text');
    text.appendChild(el('div', 'rl-garage__card-name', u.name));
    // The chip is the REQUIREMENT, not the instruction: `Locked · Conduct 55`,
    // not a sentence clipped to `Locked · Needs a campaign Conduc…`, which is
    // the same eleven characters for a floor of 35 and one of 75 and therefore
    // distinguishes nothing. The sentence is not lost -- it is the card's
    // `title` here and the bay prints it in full the moment the card is
    // picked.
    text.appendChild(
      el(
        'div',
        'rl-garage__card-chip',
        row.locked ? t('garage.chip.locked', { why: row.short }) : t('garage.chip.owned')
      )
    );
    if (row.locked) card.title = row.reason;
    card.appendChild(text);

    card.addEventListener('click', () => {
      selectedId = u.id;
      syncCards();
      renderBay();
    });
    cardEls.set(u.id, card);
    cards.appendChild(card);
  }
  rail.appendChild(cards);

  // Arrows move, Enter selects. A `<button>` already fires `click` on Enter
  // and Space in a real browser, so only the movement needs wiring — and it
  // moves FOCUS, not the selection, which is what lets a keyboard player read
  // down the roster the way a mouse player reads down it with the cursor.
  cards.addEventListener('keydown', (ev: KeyboardEvent) => {
    const order = [...cardEls.values()].filter((c) => !c.hidden);
    if (order.length === 0) return;
    const at = order.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') to = at < 0 ? 0 : (at + 1) % order.length;
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') to = at < 0 ? order.length - 1 : (at - 1 + order.length) % order.length;
    else if (ev.key === 'Home') to = 0;
    else if (ev.key === 'End') to = order.length - 1;
    if (to < 0) return;
    ev.preventDefault();
    order[to].focus();
  });

  function syncTabs(): void {
    for (const [b, tab] of tabEls) tab.setAttribute('aria-selected', b === bucket ? 'true' : 'false');
    for (const row of rows) {
      const card = cardEls.get(row.u.id);
      if (card === undefined) continue;
      card.hidden = !bucketVisible(roleBucket(row.u), bucket);
    }
  }

  function syncCards(): void {
    for (const [id, card] of cardEls) card.setAttribute('aria-selected', id === selectedId ? 'true' : 'false');
  }

  // --- the bay and the board ------------------------------------------------
  /** The six panel rows of the unit currently in the bay, keyed by the same
   *  whitelist path a tier's patch names. Rebuilt with the bay; a rung's
   *  preview addresses them by `line.path`. */
  interface PanelRow {
    kind: string;
    current: number | undefined;
    fill: HTMLElement;
    delta: HTMLElement;
    num: HTMLElement;
  }
  let panelRows = new Map<string, PanelRow>();

  function renderBay(): void {
    bay.replaceChildren();
    board.replaceChildren();
    panelRows = new Map();
    const row = rows.find((r) => r.u.id === selectedId);
    if (row === undefined) return;
    const { u } = row;
    const base = opts.baseOf(u.id);
    // The board draws the tracks the CALLER declared on the unit
    // (`BrigadeUnit.upgrades`, the option that already existed) and reads its
    // numbers off `baseOf`'s JSON — merged into one object so a rung's
    // benefit lines are computed from exactly the tiers the rung was drawn
    // from, and the two can never disagree about a track's length.
    const upgradable: UpgradableUnit = { ...base, id: u.id, upgrades: u.upgrades };
    const tiers = ownedTiers(u, opts.owned);
    // The panel shows the unit AS IT STANDS — base plus what has been bought —
    // so the next rung's `before` is the number already on screen.
    //
    // Guarded, and this is the one place in the screen that swallows a throw:
    // `applyUpgrades` refuses a patch path the unit does not itself declare
    // (a schema violation upstream, or a `baseOf` that handed back a bare
    // `{ id }` for an id it does not know). That is a real fault and it says
    // so in the console — but a garage that cannot draw is worse than one
    // drawing base numbers, and this screen is reached between missions.
    let asOwned = upgradable;
    try {
      asOwned = applyUpgrades(upgradable, tiers);
    } catch (err) {
      console.warn(`[lions] garage: ${u.id}'s owned tiers do not fit its own JSON:`, err);
    }

    // The plate, zoomed so the UNIT is large rather than the sand. Every plate
    // is the same frame at the same camera zoom, so a rifleman occupies 154 of
    // its 1800 pixels and a Namer 823; drawn at the plate's own scale the
    // rifleman is a speck. `plateFit` turns the measured footprint into a
    // scale factor and the bay's `overflow: hidden` crops the rest. The unit
    // is centred in the plate by construction (the capture frames it), so a
    // centred transform keeps it centred.
    const plate = el('div', 'rl-garage__plate');
    const picture = opts.plate?.(u.id) ?? null;
    if (picture !== null) {
      const img = document.createElement('img');
      img.className = 'rl-garage__plate-img';
      img.src = picture.url;
      img.alt = '';
      const { scale } = plateFit(picture.extent, picture.size);
      // Read back by `brigade.test.ts`, which cannot compute a transform in
      // jsdom -- and worth having on the element regardless, since "how far is
      // this one zoomed" is otherwise only discoverable by measuring pixels.
      plate.dataset.zoom = String(scale);
      img.style.transform = `scale(${scale})`;
      plate.appendChild(img);
    } else {
      plate.dataset.noplate = '1';
      plate.title = t('garage.plate.none', { id: u.id });
      plate.innerHTML = roleBadgeSvg(roleBucket(u), BAY_MARK);
    }
    bay.appendChild(plate);

    bay.appendChild(el('h2', 'rl-garage__name', u.name));
    bay.appendChild(el('div', 'rl-garage__role', roleLabel(u.role)));
    // The blurb is the unit's own JSON — data, in the unit's file, beside its
    // name. Not chrome, and not routed through the catalogue for the same
    // reason a mission's briefing is not.
    const blurb = readBlurb(base);
    if (blurb !== undefined) bay.appendChild(el('p', 'rl-garage__blurb', blurb));

    if (row.locked) {
      bay.appendChild(el('p', 'rl-garage__gate', row.reason));
      if (row.unlock.price !== undefined && opts.credits !== undefined && opts.onBuy) {
        const price = row.unlock.price;
        const credits = opts.credits;
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'rl-btn rl-garage__buy';
        buy.textContent = t('garage.buy', { price });
        buy.setAttribute('aria-label', t('garage.buy.aria', { name: u.name, price }));
        // Short balance: the control stays visible so the price is legible, and disabled so
        // a click cannot reach `buyUnlock`'s refusal path from here.
        buy.disabled = credits < price;
        buy.addEventListener('click', () => {
          buy.disabled = true; // one purchase per render; the caller re-renders
          spend();
          opts.onBuy?.(u.id, price);
        });
        bay.appendChild(buy);
        if (credits < price) {
          bay.appendChild(el('div', 'rl-garage__short', t('garage.buy.short', { n: price - credits })));
        }
      }
    }

    // --- the stat panel ---
    const stats = el('div', 'rl-garage__stats');
    stats.appendChild(el('h3', 'rl-garage__board-title', t('garage.board.stats')));
    for (const path of PANEL_PATHS) {
      const meta = benefitLabel(path);
      if (meta === null) continue;
      const stat = el('div', 'rl-garage__stat');
      stat.dataset.path = path;
      stat.appendChild(el('span', 'rl-garage__stat-label', meta.label));
      const bar = el('span', 'rl-garage__stat-bar');
      const fill = el('span', 'rl-garage__stat-fill');
      const delta = el('span', 'rl-garage__stat-delta');
      bar.append(fill, delta);
      stat.appendChild(bar);
      const value = readPath(asOwned, path);
      const num = el('span', 'rl-garage__stat-n', value === undefined ? t('garage.stat.none') : statNumber(value, meta.unit));
      stat.appendChild(num);
      const max = rosterMax.get(path) ?? 0;
      fill.style.width = barWidth(value ?? 0, max);
      delta.style.width = '0%';
      stats.appendChild(stat);
      panelRows.set(path, { kind: meta.unit, current: value, fill, delta, num });
    }
    board.appendChild(stats);

    // --- the tracks ---
    // A locked unit is not in the brigade yet, so there is nothing on it to
    // upgrade: no board rungs at all, exactly as before.
    if (!row.locked && u.upgrades) {
      for (const [trackName, track] of Object.entries(u.upgrades)) {
        const owned = tiers[trackName] ?? 0;
        // Display only: `trackName` itself stays the raw JSON key everywhere
        // it is used as a lookup or passed to a callback (nextTierPrice,
        // onBuyUpgrade) -- only the text a player reads is translated.
        //
        // Found by the I5 pseudo pass (final review): this heading was the
        // raw key with underscores turned to spaces, so the garage's three
        // track titles read "ARMOUR" / "FIREPOWER" / "SENSORS" in every
        // locale and came back UNBRACKETED under `?pseudo=1` -- a chrome
        // string that never went through `t()`, on the phase's newest and most
        // text-dense screen. `validate_i18n.mjs` cannot see it: the value
        // reaches the sink through a variable, which is blind spot #2 its own
        // header names.
        //
        // The humanised key remains the fallback rather than printing the raw
        // key, because a track a content author adds tomorrow should read as
        // an English word on the day it ships and not as `t()`'s
        // key-as-its-own-text. `trackLabel` therefore degrades exactly as it
        // used to.
        const trackKey = `garage.track.${trackName}`;
        const humanised = trackName.replace(/_/g, ' ');
        const translated = t(trackKey);
        const trackLabel = translated === trackKey ? humanised : translated;
        const trackEl = el('div', 'rl-garage__track');
        trackEl.dataset.track = trackName;
        trackEl.appendChild(el('h3', 'rl-garage__track-name', trackLabel));

        const ladder = el('div', 'rl-garage__rungs');
        // Tier 1 at the BOTTOM: a ladder is climbed, and the rung a player is
        // about to buy should sit next to the one they already own rather
        // than at the far end of the list from it.
        for (let tier = track.tiers.length; tier >= 1; tier--) {
          const rung = el('div', 'rl-garage__rung');
          rung.dataset.tier = String(tier);
          rung.dataset.owned = tier <= owned ? '1' : '0';
          rung.tabIndex = 0;

          const rungHead = el('div', 'rl-garage__rung-head');
          rungHead.appendChild(el('span', 'rl-garage__rung-tier', t('garage.rung.tier', { tier })));
          rungHead.appendChild(el('span', 'rl-garage__rung-price', String(track.tiers[tier - 1].price)));
          if (tier <= owned) rungHead.appendChild(el('span', 'rl-garage__rung-owned', t('garage.rung.owned')));
          rung.appendChild(rungHead);

          const lines = upgradeBenefits(upgradable, trackName, tier);
          const benefits = el('div', 'rl-garage__benefits');
          for (const line of lines) {
            benefits.appendChild(el('div', 'rl-garage__benefit', formatBenefit(line)));
          }
          rung.appendChild(benefits);

          // The garage's one trick a list cannot do: the panel above shows
          // what this rung would make of the unit, before the money is spent.
          const on = (): void => showPreview(lines);
          const off = (): void => showPreview(null);
          rung.addEventListener('mouseenter', on);
          rung.addEventListener('mouseleave', off);
          rung.addEventListener('focus', on);
          rung.addEventListener('blur', off);

          // The control (Buy or "maxed") renders only when the caller supplied
          // both a balance and a purchase callback -- without them, this is a
          // read-only view of what a track offers and what has been bought.
          if (opts.credits !== undefined && opts.onBuyUpgrade && tier === owned + 1) {
            const credits = opts.credits;
            const price = nextTierPrice(upgradable, trackName, owned);
            // `tier === owned + 1 <= track.tiers.length` here, so
            // `nextTierPrice` returning null would mean it disagrees with
            // `track` about the track's own length -- a programming error,
            // not data to fall through silently for.
            if (price === null) {
              throw new Error(`showBrigade: ${u.id} has no tier ${tier} on track "${trackName}"`);
            }
            const buy = document.createElement('button');
            buy.type = 'button';
            buy.className = 'rl-btn rl-garage__buy-tier';
            buy.textContent = t('garage.rung.buy', { tier, price });
            buy.setAttribute(
              'aria-label',
              t('garage.rung.buy.aria', { name: u.name, track: trackLabel, tier, price })
            );
            buy.disabled = credits < price;
            buy.addEventListener('click', () => {
              buy.disabled = true; // one purchase per render; the caller re-renders
              spend();
              opts.onBuyUpgrade?.(u.id, trackName, tier, price);
            });
            rung.appendChild(buy);
          }
          ladder.appendChild(rung);
        }
        trackEl.appendChild(ladder);
        if (opts.credits !== undefined && opts.onBuyUpgrade && owned >= track.tiers.length) {
          trackEl.appendChild(el('div', 'rl-garage__track-max', t('garage.track.maxed')));
        }
        board.appendChild(trackEl);
      }
    }
  }

  /** Paint (or clear) a rung's preview across the stat panel. A line whose
   *  path the panel does not draw — `weapons[1].*`, `hull.suppression_resistance`
   *  — simply has nowhere to land, which is why this never assumes a row
   *  exists. The delta is applied to what is ON SCREEN rather than to the
   *  line's own `before`: another track may already have moved the same stat,
   *  and a preview that contradicted the number above it would be worse than
   *  none. */
  function showPreview(lines: readonly BenefitLine[] | null): void {
    for (const [path, row] of panelRows) {
      const max = rosterMax.get(path) ?? 0;
      row.delta.style.width = '0%';
      row.num.textContent = row.current === undefined ? t('garage.stat.none') : statNumber(row.current, row.kind);
      row.fill.style.width = barWidth(row.current ?? 0, max);
    }
    if (lines === null) return;
    for (const line of lines) {
      const row = panelRows.get(line.path);
      if (row === undefined || row.current === undefined) continue;
      const after = Math.round((row.current + (line.after - line.before)) * 100) / 100;
      const max = rosterMax.get(line.path) ?? 0;
      row.fill.style.width = barWidth(Math.min(row.current, after), max);
      row.delta.style.width = barWidth(Math.abs(after - row.current), max);
      row.num.textContent = t('garage.stat.preview', {
        before: statNumber(row.current, row.kind),
        after: statNumber(after, row.kind),
      });
    }
  }

  syncTabs();
  syncCards();
  renderBay();

  // --- footer ---------------------------------------------------------------
  const nav = el('div', 'rl-endnav');
  const link = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.className = 'rl-btn';
    a.href = href;
    a.textContent = label;
    nav.appendChild(a);
  };
  link(t('nav.campaignMap'), routes.campaign());
  link(t('nav.menu'), routes.menu());
  if (opts.credits !== undefined && opts.onReset) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'rl-btn rl-garage__reset';
    reset.textContent = t('garage.reset.button');
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = t('garage.reset.confirm');
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
  wrap.appendChild(nav);

  host.appendChild(wrap);
  return () => wrap.remove();
}

/** A bar's length as a percentage of the roster's own maximum for that stat,
 *  clamped: an upgraded unit can exceed a maximum read off base JSON, and a
 *  bar that overflowed its track would read as a rendering fault. */
function barWidth(value: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

/** The unit's own one-line description, when its JSON carries one.
 *  `UpgradableUnit` describes only what `applyUpgrades` needs, so this reads
 *  the field structurally rather than widening that type with a display
 *  field the data package has no use for. */
function readBlurb(unit: UpgradableUnit): string | undefined {
  const v = (unit as unknown as Record<string, unknown>).blurb;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
