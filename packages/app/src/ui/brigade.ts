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
//     `onBuyUpgrade`, `onReset`); the caller buys and saves. It never mutates
//     the account itself. What changed (WP-S3g T3, F3) is that the caller
//     may now also ANSWER, returning the account as the store holds it
//     afterwards (`GarageState`); the screen redraws around that answer in
//     place -- same node, tab, unit, scroll and a focused control -- instead
//     of the caller remounting the whole route. A caller that answers nothing
//     leaves the screen exactly as the click left it.
//   * The two-click reset, and the rule that a Buy control renders only when
//     the caller supplied BOTH a balance and a callback.
import { applyUpgrades, maxTiers, readPath, type UpgradableUnit, type UpgradeTracks } from '@lions/data';
import { conductAtLeast, isBoughtOnly, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';
import { campaignRoe } from '../campaign';
import { gateSentence, gateShort } from '../gate-sentence';
import { expandedTrack, trackEl, type TrackDeps } from './garage-board';
import { PANEL_PATHS, statPanel, type StatPanel } from './garage-stats';
import { t } from '../i18n/t';
import type { CampaignLedger } from '../ledger-store';
import { ROSTER_CAP } from '../roster-cap';
import {
  BAR_GROW_MS,
  STAMP_MS,
  WALLET_COUNT_MS,
  cardStatus,
  countAt,
  cueFor,
  purchaseLanded,
  restoreFocus,
  retainSelection,
  rovingStep,
  trackForDigit,
  type PurchaseAsk,
  type PurchaseCue,
} from './garage-model';
import { kitLevelLabel, kitPipsHtml, kitSummary, kitSymbolSvg } from './kit-sign';
import { markSvg } from './mark';
import { plateFit } from './plate-fit';
import { flash, prefersReducedMotion } from './motion';
import { routes } from '../shell/links';
import type { Disposer } from '../shell/router';
import { bucketVisible, roleBadgeSvg, roleBucket, roleLabel, type RoleBucket } from './role';

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
   *  absent for a unit with none. Rendered on a locked unit too (F7): read-only,
   *  as what the type could become once it is unlocked -- tier 1 of every track
   *  expanded, its price and benefits shown, no Buy anywhere on it. */
  upgrades?: UpgradeTracks;
}

/** The account as a purchase or a reset left it, which is what the caller
 *  hands back from `onBuy`, `onBuyUpgrade` and `onReset` (R-3). The same
 *  three fields `BrigadeOptions` opens with, because a redraw is the mount
 *  with newer numbers. */
export interface GarageState {
  readonly units: BrigadeUnit[];
  readonly credits?: number;
  readonly owned?: Record<string, Record<string, number>>;
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
  /** Called after the second click on the reset control. The caller resets the account
   *  and answers with the account as it now stands, which the screen redraws around in
   *  place; this screen only asks twice. Answering nothing leaves the control disabled. */
  onReset?: () => GarageState | void;
  /** Called when the player clicks a locked, priced unit's Buy control. The caller buys,
   *  saves and answers with the account as the store now holds it -- a refusal answers
   *  too, off the true state. This screen only asks; it never mutates the account itself. */
  onBuy?: (unitId: string, price: number) => GarageState | void;
  /** The brigade account's own `upgrades` map: unit id -> track -> owned tier (0 = none).
   *  Absent tiers read as 0. Absent entirely (no account) draws every rung unbought --
   *  still informative as a read-only view of what a track offers. */
  owned?: Record<string, Record<string, number>>;
  /** Called when the player clicks a rung's Buy control. The caller buys,
   *  saves and answers, exactly as `onBuy` does; this screen only asks. Rendered only
   *  alongside `credits` -- both present or neither, the same rule the unit-unlock Buy
   *  control follows. */
  onBuyUpgrade?: (unitId: string, track: string, tier: number, price: number) => GarageState | void;
  /** Sounded once per purchase the store actually made (§3.5) -- never on a
   *  refusal, never on a reset. The screen names the cue; the caller owns the
   *  audio (`CUE_SET` maps each to its manifest set). */
  onCue?: (cue: PurchaseCue) => void;
  /** Whether to drop the purchase's movement (the count steps, the bars jump).
   *  Absent reads `motion.ts`'s `prefersReducedMotion()` -- the setting, then
   *  the OS. A seam for tests, which have neither. */
  reducedMotion?: () => boolean;
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

/** Each stat row's base and kit bar widths, by `PANEL_PATHS` path -- what a
 *  purchase's bars grow FROM (§3.5). */
type BarWidths = Map<string, { fill: string; kit: string }>;

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

export function showBrigade(host: HTMLElement, opts: BrigadeOptions): Disposer {
  /** The account this screen is drawing. Opens as the options hand it in and
   *  is replaced whole by each answer a purchase or a reset gets back
   *  (`answer()` below); nothing here edits it. */
  let state: GarageState = { units: opts.units, credits: opts.credits, owned: opts.owned };
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

  // The wallet is built ONCE and survives every purchase: `renderWallet`
  // repaints its figure, so the spend flash below runs on a node that is still
  // on screen afterwards (F3: it used to run on one the remount had removed).
  let wallet: HTMLElement | null = null;
  let walletN: HTMLElement | null = null;
  let walletWord: HTMLElement | null = null;
  if (state.credits !== undefined) {
    wallet = el('div', 'rl-garage__wallet');
    // The figure carries no words of its own, so it is set from the number
    // rather than through the catalogue; the WORD beside it is pluralised
    // (`1 credit`), which is the part a locale changes.
    walletN = el('span', 'rl-garage__wallet-n');
    walletWord = el('span', 'rl-garage__wallet-word');
    wallet.append(walletN, walletWord);
    head.appendChild(wallet);
  }
  wrap.appendChild(head);

  /** The wallet's figure and word off `state.credits`. `data-value` is the
   *  true balance whatever the text says, so a later count-up animation of
   *  the text (Task 10) never leaves a reader of the number mid-count. */
  function renderWallet(): void {
    if (walletN === null || walletWord === null || state.credits === undefined) return;
    walletN.textContent = String(state.credits);
    walletN.dataset.value = String(state.credits);
    walletWord.textContent = t('garage.wallet.word', { n: state.credits });
  }
  renderWallet();

  // The purchase event's own clocks (§3.5): every flash's timeout and the
  // wallet count's frame, held here so the disposer can stop all of them.
  // A timer that outlives the screen reaches a node nobody draws any more.
  // Ids already fired stay in the set (a handful per purchase); clearing a
  // spent timeout is a no-op, and pruning would cost a second timer apiece.
  const timers: number[] = [];
  let countRaf = 0;
  /** `motion.ts`'s `flash`, with its timeout kept for the disposer. */
  const pulse = (target: Element | null, className: string, ms: number): void => {
    if (target instanceof HTMLElement) timers.push(flash(target, className, ms));
  };
  /** The setting, then the OS -- or the caller's own answer (tests). */
  const reduced = (): boolean => opts.reducedMotion?.() ?? prefersReducedMotion();

  /** Spent: the wallet flashes on the click that asks for a purchase. The
   *  wallet node persists across the redraw that answers it, so the flash is
   *  seen through to its end. */
  const spend = (): void => {
    pulse(wallet, 'rl-garage__wallet--spent', 600);
  };

  // --- the roster, classified and ordered exactly as it always was ---------
  // Available first; ties keep their given order (no gate to sort by).
  // Locked units follow, ordered by the gate that opens soonest — a Conduct
  // floor, then a star count, then a named mission, then a bought-only gate
  // (D1, sorted by price) last — ties broken by name. Re-run on every answer:
  // a unit bought open moves from the locked tail to the available head.
  function classify(): Row[] {
    const out = state.units.map((u) => classifyRow(u, opts.ledger, opts.missionName));
    out.sort((a, b2) => {
      if (a.locked !== b2.locked) return a.locked ? 1 : -1;
      if (!a.locked || !b2.locked) return 0; // both available: stable, preserves input order
      const [rankA, valA] = bindingGate(a.unlock, opts.ledger);
      const [rankB, valB] = bindingGate(b2.unlock, opts.ledger);
      if (rankA !== rankB) return rankA - rankB;
      if (valA !== valB) return valA - valB;
      return a.u.name.localeCompare(b2.u.name);
    });
    return out;
  }
  let rows: Row[] = classify();

  // Every bar in the stat panel is scaled against the ROSTER's own maximum for
  // that stat, not against the unit's own: a rifleman's 400 hit points and a
  // Lavi's 3000 have to draw at different lengths or the panel says they are
  // the same tank. Read off each unit's FULLY KITTED numbers (R-5) -- base
  // JSON alone would leave the roster's own strongest unit with a full bar
  // and no room to draw what it bought. Computed once, like the tabs below: a
  // purchase changes neither which units are on the roster nor their base
  // JSON or upgrade tracks.
  const rosterMax = new Map<string, number>();
  for (const row of rows) {
    const base = opts.baseOf(row.u.id);
    const merged: UpgradableUnit = { ...base, id: row.u.id, upgrades: row.u.upgrades };
    let kitted: UpgradableUnit = merged;
    try {
      kitted = applyUpgrades(merged, maxTiers(merged));
    } catch {
      // Same fault `renderBay` already tolerates: a patch path the unit does
      // not itself declare. Falling back to the unmodified unit still gives
      // every OTHER unit's bar something honest to measure against.
      kitted = merged;
    }
    for (const path of PANEL_PATHS) {
      const v = readPath(kitted, path);
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
  let selectedId: string = retainSelection('', rows.map((r) => r.u.id));

  const tabs = el('div', 'rl-garage__tabs');
  tabs.setAttribute('role', 'tablist');
  const tabEls = new Map<RoleBucket | 'all', HTMLButtonElement>();
  for (const b of buckets) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'rl-garage__tab';
    tab.dataset.bucket = b;
    tab.setAttribute('role', 'tab');
    tab.dataset.focusKey = `tab:${b}`;
    tab.textContent = t(`garage.bucket.${b}`);
    tab.addEventListener('click', () => {
      bucket = b;
      syncTabs();
    });
    tabEls.set(b, tab);
    tabs.appendChild(tab);
  }
  // Left/Right/Home/End only (F8) -- Up/Down are the cards' own keys, one
  // row below, and a tablist that also answered to them would make a
  // vertical arrow ambiguous between the two rails. Moves the filter WITH
  // focus: `syncTabs` below resets the roving card stop, since the filter
  // this lands on may hide the card that used to hold it.
  tabs.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'Home' && ev.key !== 'End') return;
    const order = [...tabEls.entries()];
    const at = order.findIndex(([, tab]) => tab === document.activeElement);
    const to = rovingStep(ev.key, at, order.length);
    if (to === null) return;
    ev.preventDefault();
    bucket = order[to][0];
    syncTabs();
    order[to][1].focus();
  });
  rail.appendChild(tabs);

  const cards = el('div', 'rl-garage__cards');
  cards.setAttribute('role', 'listbox');
  const cardEls = new Map<string, HTMLButtonElement>();
  /** The rail's cards off `rows`. The `.rl-garage__cards` container itself is
   *  never replaced -- only its children -- so its scroll offset and its
   *  keydown listener outlive a purchase. */
  function renderCards(): void {
    cards.replaceChildren();
    cardEls.clear();
    for (const row of rows) {
      const { u } = row;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'rl-garage__card';
      card.dataset.unit = u.id;
      card.dataset.locked = row.locked ? '1' : '0';
      card.dataset.bucket = roleBucket(u);
      card.dataset.focusKey = `card:${u.id}`;
      card.setAttribute('role', 'option');

      // Status and kit (WP-S3g T5, §3.1): the same `applyUpgrades`-ready merge
      // the bay itself builds, so a card's Maxed reading can never disagree
      // with what the board would show for the same unit.
      const merged: UpgradableUnit = { ...opts.baseOf(u.id), id: u.id, upgrades: u.upgrades };
      const kit = kitSummary(merged, ownedTiers(u, state.owned));
      const status = cardStatus({ locked: row.locked, bought: u.unlock?.bought === true, maxed: kit.maxed });
      card.dataset.status = status;
      card.dataset.kit = String(kit.level);

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
          row.locked ? t('garage.chip.locked', { why: row.short }) : t(`garage.chip.${status}`)
        )
      );
      if (row.locked) card.title = row.reason;
      card.appendChild(text);

      // The kit, drawn only for a type that HAS tracks -- a card with none
      // carries no pip column at all rather than three empty ones, and
      // `data-kit="0"` (set above regardless) is what a type-with-no-tracks
      // reads as.
      if (u.upgrades !== undefined && Object.keys(u.upgrades).length > 0) {
        const pips = el('span', 'rl-garage__card-kit');
        pips.innerHTML = kitPipsHtml(kit.pips);
        card.appendChild(pips);
      }

      card.addEventListener('click', () => {
        selectedId = u.id;
        // A different unit: the accordion starts over rather than carrying
        // an old track name across (fix round 1). The one deliberate place
        // `activeTrack` is ever cleared (fix round 2, issue 2) -- everywhere
        // else it is only ever set to a new track, never reset to null.
        activeTrack = null;
        syncCards();
        renderBay();
      });
      cardEls.set(u.id, card);
      cards.appendChild(card);
    }
  }
  renderCards();
  rail.appendChild(cards);

  // Listbox semantics (F8): selection follows focus. An arrow both moves
  // focus AND picks the card it lands on -- unlike the tabs' own rail, where
  // moving off a role filter would be a strange thing for a Buy click to
  // answer to, a card IS the thing a mouse player picks by looking at it, so
  // a keyboard player's arrow does the same job a click already does.
  cards.addEventListener('keydown', (ev: KeyboardEvent) => {
    const order = [...cardEls.values()].filter((c) => !c.hidden);
    const at = order.indexOf(document.activeElement as HTMLButtonElement);
    const to = rovingStep(ev.key, at, order.length);
    if (to === null) return;
    ev.preventDefault();
    selectedId = order[to].dataset.unit ?? selectedId;
    // A different unit: the accordion starts over (fix round 1).
    activeTrack = null;
    syncCards();
    renderBay();
    order[to].focus();
  });

  // 1-9 jumps straight to a track's own next decision (F8): the digit maps
  // onto the BOARD's own order (`trackForDigit`), never a fixed
  // armour/sensors/firepower slot, so a unit missing a track shifts every
  // digit after it. Left alone for an `input`/`textarea` target -- none
  // lives on this screen today, but a content author's stray one must never
  // have its own digits hijacked by the board.
  wrap.addEventListener('keydown', (ev: KeyboardEvent) => {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const trackNames = [...board.querySelectorAll<HTMLElement>('[data-track]')].map((e) => e.dataset.track ?? '');
    const trackName = trackForDigit(ev.key, trackNames);
    if (trackName === null) return;
    // The accordion (fix round 1): a digit jump points at its own track too,
    // and has to expand it BEFORE the search below -- a rung under
    // `display: none` cannot receive focus at all.
    activeTrack = trackName;
    applyExpansion();
    const trackWrap = board.querySelector<HTMLElement>(`.rl-garage__track[data-track="${trackName}"]`);
    const landing =
      trackWrap?.querySelector<HTMLElement>('.rl-garage__rung[data-state="next"]') ??
      trackWrap?.querySelector<HTMLElement>('.rl-garage__track-head') ??
      null;
    if (landing === null) return;
    ev.preventDefault();
    landing.focus();
  });

  // Enter on a rung buys it -- the digit jump's own landing spot, and the
  // only way this screen puts real keyboard focus ON a rung at all (a rung's
  // own `tabIndex` is -1, script-focusable only). Silent when there is
  // nothing to buy: an owned or future rung's disabled/absent Buy, or a
  // locked unit's "Unlock first" in its place.
  board.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key !== 'Enter') return;
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const rung = target?.closest<HTMLElement>('.rl-garage__rung') ?? null;
    const buy = rung?.querySelector<HTMLButtonElement>('.rl-garage__buy-tier') ?? null;
    if (buy !== null && !buy.disabled) buy.click();
  });

  function syncTabs(): void {
    for (const [b, tab] of tabEls) {
      const isSelected = b === bucket;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      tab.tabIndex = isSelected ? 0 : -1;
    }
    for (const row of rows) {
      const card = cardEls.get(row.u.id);
      if (card === undefined) continue;
      card.hidden = !bucketVisible(roleBucket(row.u), bucket);
    }
    // Controller ruling (T9): a filter change can hide the card the roving
    // tab stop was on, and a stop Tab can no longer reach is worse than one
    // on the wrong unit -- every tab change resets it.
    syncCards();
  }

  function syncCards(): void {
    const visible = [...cardEls.values()].filter((c) => !c.hidden);
    const selectedCard = cardEls.get(selectedId);
    const stop = selectedCard !== undefined && !selectedCard.hidden ? selectedCard : (visible[0] ?? null);
    for (const [id, card] of cardEls) {
      card.setAttribute('aria-selected', id === selectedId ? 'true' : 'false');
      card.tabIndex = card === stop ? 0 : -1;
    }
  }

  // --- the bay and the board ------------------------------------------------
  /** The bay's stat panel (`garage-stats.ts`'s `statPanel`), rebuilt with the
   *  bay. A rung's hover and focus address it through `panel.preview`, which
   *  is why it lives in a variable that outlives one `renderBay` call rather
   *  than being read back out of the DOM. */
  let panel: StatPanel | null = null;

  // The accordion's own state: which track the player last pointed at, by
  // mouse or by keyboard (fix round 1, §2 goal 3). Fix round 2, issue 2's
  // ruling made this SET-ONLY: nothing in this screen ever nulls it except
  // picking a different unit (the card click and card-arrow handlers below).
  // Leaving a track's head, or blurring out of it, asks for nothing -- the
  // last track pointed at stays expanded through anything short of pointing
  // at a different one, which is also what makes a keyboard purchase safe
  // (`renderBay`'s own `board.replaceChildren()` blurs the focused rung, but
  // with no `focusout` listener anywhere on the accordion, that blur has
  // nothing to clear). Persists ACROSS a `renderBay()` call on purpose -- a
  // purchase rebuilds the board's DOM but the track just bought into must
  // stay the one expanded, so focus can land back on its own next Buy.
  let activeTrack: string | null = null;

  /** Sets `data-expanded` on every track wrapper the board currently holds,
   *  off `expandedTrack`'s own decision. Reads each track's `data-state`
   *  (set by `trackEl` itself) rather than recomputing `trackSummary`, so
   *  this never has its own opinion about what "maxed" means. */
  function applyExpansion(): void {
    const wraps = [...board.querySelectorAll<HTMLElement>('.rl-garage__track')];
    const order = wraps.map((w) => w.dataset.track ?? '');
    const maxed = new Set(wraps.filter((w) => w.dataset.state === 'maxed').map((w) => w.dataset.track ?? ''));
    const expanded = expandedTrack(order, maxed, activeTrack);
    for (const w of wraps) w.dataset.expanded = w.dataset.track === expanded ? '1' : '0';
  }

  function renderBay(): void {
    bay.replaceChildren();
    board.replaceChildren();
    panel = null;
    const row = rows.find((r) => r.u.id === selectedId);
    if (row === undefined) return;
    const { u } = row;
    // F7: zero credits, and only zero -- five is still an account with a
    // future, and no account at all (this screen's own "as before" reading)
    // says nothing here either. Prepended to the board, ahead of every track,
    // since it is the one thing on this screen that answers "why can't I buy
    // anything" before a player goes looking for a reason on a rung.
    if (state.credits === 0) {
      board.appendChild(el('div', 'rl-garage__empty', t('garage.empty.credits')));
    }
    const base = opts.baseOf(u.id);
    // The board draws the tracks the CALLER declared on the unit
    // (`BrigadeUnit.upgrades`, the option that already existed) and reads its
    // numbers off `baseOf`'s JSON — merged into one object so a rung's
    // benefit lines are computed from exactly the tiers the rung was drawn
    // from, and the two can never disagree about a track's length.
    const upgradable: UpgradableUnit = { ...base, id: u.id, upgrades: u.upgrades };
    const tiers = ownedTiers(u, state.owned);
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

    // One reading of "how kitted is this unit" drives both the plate's mark
    // and the credits line below it -- never two arithmetics for one idea.
    const kit = kitSummary(upgradable, tiers);

    // The plate, zoomed so the UNIT is large rather than the sand. Every plate
    // is the same frame at the same camera zoom, so a rifleman occupies 154 of
    // its 1800 pixels and a Namer 823; drawn at the plate's own scale the
    // rifleman is a speck. `plateFit` turns the measured footprint into a
    // scale factor and the bay's `overflow: hidden` crops the rest. The unit
    // is centred in the plate by construction (the capture frames it), so a
    // centred transform keeps it centred.
    const plate = el('div', 'rl-garage__plate');
    plate.dataset.kit = String(kit.level);
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
    // The kit mark: a bevelled plate with `kit.level` bars and its own label
    // (`Kit I`/`II`/`III`), drawn only once something on this type has
    // actually been bought -- an unkitted bay is left exactly as it was.
    if (kit.level !== 0) {
      const mark = el('div', 'rl-garage__plate-kit rl-kit-mark');
      mark.innerHTML = kitSymbolSvg('kit', 48, kit.level);
      mark.appendChild(el('span', 'rl-garage__plate-kit-label', kitLevelLabel(kit.level)));
      plate.appendChild(mark);
    }
    // F7: stamped only when every tier on every track is owned -- level 3
    // (kitLevel's own top third, reached at 7 of 9 tiers) is a DIFFERENT
    // question from "everything is bought" (R-11), and this reads `kit.maxed`
    // rather than the level for exactly that reason.
    if (kit.maxed) {
      plate.appendChild(el('div', 'rl-garage__plate-maxed', t('garage.chip.maxed')));
    }
    bay.appendChild(plate);

    bay.appendChild(el('h2', 'rl-garage__name', u.name));
    bay.appendChild(el('div', 'rl-garage__role', roleLabel(u.role)));

    // The stat panel -- base, kit and (while a rung is hovered) preview, all
    // one reading -- sits straight under the name and role, and stays in
    // view for as long as the bay does (it no longer scrolls away inside the
    // board's own aside).
    panel = statPanel(base, asOwned, rosterMax);
    bay.appendChild(panel.el);

    // What this type's kit cost, directly under the numbers it bought.
    // Absent when nothing has been spent -- the same "nothing to say" rule
    // the kit mark above follows.
    if (kit.spent > 0) {
      bay.appendChild(el('div', 'rl-garage__kit-total', t('garage.kit.total', { n: kit.spent })));
    }

    // The blurb is the unit's own JSON — data, in the unit's file, beside its
    // name. Not chrome, and not routed through the catalogue for the same
    // reason a mission's briefing is not.
    const blurb = readBlurb(base);
    if (blurb !== undefined) bay.appendChild(el('p', 'rl-garage__blurb', blurb));

    if (row.locked) {
      bay.appendChild(el('p', 'rl-garage__gate', row.reason));
      if (row.unlock.price !== undefined && state.credits !== undefined && opts.onBuy) {
        const price = row.unlock.price;
        const credits = state.credits;
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'rl-btn rl-garage__buy';
        buy.textContent = t('garage.buy', { price });
        buy.setAttribute('aria-label', t('garage.buy.aria', { name: u.name, price }));
        buy.dataset.focusKey = 'unit-buy';
        // Short balance: the control stays visible so the price is legible, and disabled so
        // a click cannot reach `buyUnlock`'s refusal path from here.
        buy.disabled = credits < price;
        buy.addEventListener('click', () => {
          buy.disabled = true; // one purchase per render; the answer redraws
          spend();
          answer(opts.onBuy?.(u.id, price), 'unit-buy', { kind: 'unit', unitId: u.id });
        });
        bay.appendChild(buy);
        if (credits < price) {
          bay.appendChild(el('div', 'rl-garage__short', t('garage.buy.short', { n: price - credits })));
        }
      }
    }

    // --- the tracks ---
    // F7: a locked unit is not in the brigade yet, but its tracks still draw
    // -- read-only, what the type could become once it is unlocked -- rather
    // than nothing at all. Task 7 moved the track's own DOM into
    // `garage-board.ts`'s `trackEl`; this loop's only job now is to hand it
    // the one unit's numbers, the locked flag, and the purchase/preview
    // callbacks -- the Task 3 answer path, unchanged.
    if (u.upgrades) {
      for (const [trackName, track] of Object.entries(u.upgrades)) {
        const owned = tiers[trackName] ?? 0;
        // The control (Buy or "maxed") renders only when the caller supplied
        // both a balance and a purchase callback -- without them, this is a
        // read-only view of what a track offers and what has been bought.
        const buy: TrackDeps['buy'] =
          state.credits !== undefined && opts.onBuyUpgrade
            ? {
                credits: state.credits,
                onBuy: (tier, price, asked) => {
                  spend();
                  answer(opts.onBuyUpgrade?.(u.id, trackName, tier, price), asked, {
                    kind: 'upgrade',
                    unitId: u.id,
                    track: trackName,
                    tier,
                  });
                },
              }
            : undefined;
        board.appendChild(
          trackEl(trackName, track, {
            unit: upgradable,
            unitId: u.id,
            unitName: u.name,
            owned,
            buy,
            locked: row.locked,
            preview: (d) => panel?.preview(d),
            onActivate: () => {
              activeTrack = trackName;
              applyExpansion();
            },
          })
        );
      }
      // The accordion's own first paint for this unit (fix round 1): decides
      // off whatever `activeTrack` already is -- null for a freshly picked
      // unit, carried over from before a purchase's redraw otherwise.
      applyExpansion();
    }
  }

  syncTabs();
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
  // Built once, like the wallet: the reset survives a purchase, and its own
  // answer puts it back to its first label rather than replacing it.
  let reset: HTMLButtonElement | null = null;
  let armed = false;
  /** The reset control as it stands before its first click: unarmed, live,
   *  first label. Run by every answer, which is what makes the two-click
   *  confirmation start over after a reset that was answered in place. */
  function resetUi(): void {
    if (reset === null) return;
    armed = false;
    reset.disabled = false;
    reset.textContent = t('garage.reset.button');
  }
  if (state.credits !== undefined && opts.onReset) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'rl-btn rl-garage__reset';
    control.dataset.focusKey = 'reset';
    reset = control;
    resetUi();
    control.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        control.textContent = t('garage.reset.confirm');
        return;
      }
      // Disabled BEFORE the handler runs, so the second click is provably the
      // last one this control can fire until the caller answers: a caller
      // that answers nothing leaves it disabled, and a control that says
      // "cannot be undone" must not be able to fire twice on one ask.
      control.disabled = true;
      answer(opts.onReset?.(), 'reset');
    });
    nav.appendChild(control);
  }
  wrap.appendChild(nav);

  /** The caller's answer to a purchase or a reset: the account as the store
   *  holds it now (R-3). Redraws around it -- same screen node, same tab,
   *  same unit, same scroll -- and puts focus where `restoreFocus` says.
   *
   *  A keyboard purchase used to strand focus here: `renderBay`'s own
   *  `board.replaceChildren()` blurs the just-focused rung, and on the old
   *  hover/focus-tracked accordion that blur's `focusout` nulled the active
   *  track, collapsing the very one just bought into before this function's
   *  own `applyExpansion` (inside `renderBay`) ever ran. Fix round 2, issue
   *  2 closed that at the source instead of patching it here: `activeTrack`
   *  is SET-ONLY now (no `focusout`/`mouseleave` listener exists anywhere on
   *  the accordion to clear it), so it survives a purchase's redraw
   *  unchanged and needs no re-assertion after the fact.
   *
   *  `ask` is what a Buy asked for (a reset asks for nothing). When the answer
   *  says the store did it, the purchase is an event (§3.5): `celebrate`
   *  below. The figures it animates FROM are read here, before the redraw
   *  replaces them. */
  function answer(next: GarageState | void, asked: string | null, ask?: PurchaseAsk): void {
    if (next === undefined) return; // a caller that answers nothing: as before
    const scroll = { rail: cards.scrollTop, bay: bay.scrollTop, board: board.scrollTop };
    // The figure ON SCREEN, not `state.credits`: a second purchase landing
    // mid-count carries on down from where the eye is rather than jumping
    // back up to the last true balance.
    const shown = walletN !== null ? Number(walletN.textContent) : Number.NaN;
    const fromCredits = Number.isFinite(shown) ? shown : state.credits;
    const fromBars = barWidths();
    // Whatever answers -- a refusal, a reset, or the next purchase -- the
    // count in flight stops here: its target is the OLD answer, and it would
    // otherwise keep writing over the figure `renderWallet` is about to set.
    cancelAnimationFrame(countRaf);
    countRaf = 0;
    state = next;
    rows = classify();
    selectedId = retainSelection(selectedId, rows.map((r) => r.u.id));
    renderWallet();
    renderCards();
    syncTabs();
    renderBay();
    resetUi();
    // Children replaced under a scroller clamp its offset to the new height
    // for a frame; put it back after the content is whole again.
    cards.scrollTop = scroll.rail;
    bay.scrollTop = scroll.bay;
    board.scrollTop = scroll.board;
    // Only controls a player can actually SEE are candidates. A card the
    // current tab hides still carries its key, and so does a rung under a
    // track the accordion has collapsed (`trackEl` always builds the full
    // ladder; `[data-expanded='0']` is what hides it) -- `.focus()` on
    // either is refused by a real browser, which drops focus to `<body>`
    // silently. `checkVisibility()` is the real check where a browser has it
    // (it already accounts for every ancestor's `display`, not just this
    // element's own); jsdom carries no such method at all, so the fallback
    // -- no `[hidden]` ancestor and no collapsed-track ancestor -- is what
    // `brigade.test.ts` actually exercises.
    const isRendered = (e: HTMLElement): boolean =>
      typeof e.checkVisibility === 'function'
        ? e.checkVisibility()
        : e.closest('[hidden]') === null && e.closest('[data-expanded="0"]') === null;
    const keys = [...wrap.querySelectorAll<HTMLElement>('[data-focus-key]')].filter(isRendered);
    // Nothing closer is left when the unit's own card is filtered out (the
    // bay keeps a unit the tab has hidden): the tab the player is on is the
    // nearest visible control to where they were.
    const want =
      restoreFocus(asked, keys.map((e) => e.dataset.focusKey ?? ''), selectedId) ??
      (asked !== null ? `tab:${bucket}` : null);
    keys.find((e) => e.dataset.focusKey === want)?.focus({ preventScroll: true });
    if (ask !== undefined && purchaseLanded(ask, next)) celebrate(ask, fromCredits, fromBars);
  }

  /** Each stat row's base and kit widths, by path, as the panel draws them
   *  now -- the "old" a purchase's bars grow from. */
  function barWidths(): BarWidths {
    const out = new Map<string, { fill: string; kit: string }>();
    for (const row of bay.querySelectorAll<HTMLElement>('.rl-garage__stat[data-path]')) {
      const fill = row.querySelector<HTMLElement>('.rl-garage__stat-fill');
      const kit = row.querySelector<HTMLElement>('.rl-garage__stat-kit');
      if (fill === null || kit === null) continue;
      out.set(row.dataset.path ?? '', { fill: fill.style.width, kit: kit.style.width });
    }
    return out;
  }

  /** A purchase the store made, made to feel like one (§3.5): the cue, the
   *  wallet counted down, the rung and its pip swept into the kit colour, the
   *  plate's mark stamped (on EVERY purchase, level change or not), the bars
   *  grown old -> new, and for a unit the plate's hatch lifted under an
   *  ENLISTED stamp. Runs after the redraw, on the nodes it left behind.
   *
   *  Reduced motion: the count and the bars STEP -- they are movement and
   *  nothing else. The stamps and the sweep still go on as classes, because
   *  the sheet's own global reduced-motion rules (`theme.css`, both the media
   *  query and `data-motion='reduce'`, the same two checks `reduced()` makes)
   *  already collapse their durations to 1 ms, and what is left is the
   *  colour, which reports. */
  function celebrate(ask: PurchaseAsk, fromCredits: number | undefined, fromBars: BarWidths): void {
    opts.onCue?.(cueFor(ask));
    countWallet(fromCredits, state.credits);
    pulse(bay.querySelector('.rl-garage__plate-kit'), 'rl-garage__plate-kit--stamp', STAMP_MS);
    if (ask.kind === 'upgrade') {
      const track = `[data-track="${ask.track}"]`;
      const rung = board.querySelector(`.rl-garage__track${track} .rl-garage__rung[data-tier="${ask.tier}"]`);
      pulse(rung, 'rl-garage__rung--stamp', STAMP_MS);
      const pips = cardEls.get(ask.unitId)?.querySelectorAll(`.rl-kit-pips__col${track} .rl-kit-pips__pip`);
      pulse(pips?.[ask.tier - 1] ?? null, 'rl-kit-pips__pip--new', STAMP_MS);
    } else {
      const plate = bay.querySelector('.rl-garage__plate');
      if (plate instanceof HTMLElement) {
        plate.appendChild(el('div', 'rl-garage__stamp', t('garage.plate.enlisted')));
        pulse(plate, 'rl-garage__plate--enlisted', 900);
      }
    }
    growBars(fromBars);
  }

  /** The bars, old -> new over `BAR_GROW_MS`. The width transition exists ONLY
   *  under `rl-garage__stats--grow` (theme.css), so picking another unit --
   *  which rebuilds the panel at its own widths -- never animates. Order is
   *  the whole trick: old widths written and laid out first, THEN the class,
   *  THEN the new widths, so the transition's start is the old figure. A
   *  frame lost anywhere in the middle still ends on the new widths, which
   *  are written here synchronously; the class coming off early only cuts
   *  the tween short. */
  function growBars(fromBars: BarWidths): void {
    if (reduced() || panel === null) return;
    const rows: { fill: HTMLElement; kit: HTMLElement; to: { fill: string; kit: string } }[] = [];
    for (const row of panel.el.querySelectorAll<HTMLElement>('.rl-garage__stat[data-path]')) {
      const from = fromBars.get(row.dataset.path ?? '');
      const fill = row.querySelector<HTMLElement>('.rl-garage__stat-fill');
      const kit = row.querySelector<HTMLElement>('.rl-garage__stat-kit');
      if (from === undefined || fill === null || kit === null) continue;
      rows.push({ fill, kit, to: { fill: fill.style.width, kit: kit.style.width } });
      fill.style.width = from.fill;
      kit.style.width = from.kit;
    }
    if (rows.length === 0) return;
    void panel.el.offsetWidth;
    pulse(panel.el, 'rl-garage__stats--grow', BAR_GROW_MS);
    for (const r of rows) {
      r.fill.style.width = r.to.fill;
      r.kit.style.width = r.to.kit;
    }
  }

  /** The wallet's figure from `from` down to `to` over `WALLET_COUNT_MS`.
   *  `data-value` already holds the true balance (`renderWallet`), so only the
   *  TEXT counts. The clock starts on the FIRST FRAME's own timestamp, never
   *  `performance.now()` -- the two are not the same clock in a harness that
   *  fakes one and not the other -- and `requestAnimationFrame` is the bare
   *  global, looked up at call time: a reference captured at module load
   *  would miss both a test's fake and a frame-loop freeze. */
  function countWallet(from: number | undefined, to: number | undefined): void {
    cancelAnimationFrame(countRaf);
    countRaf = 0;
    if (walletN === null || to === undefined) return;
    const figure = walletN;
    if (from === undefined || from === to || reduced()) {
      figure.textContent = String(to);
      return;
    }
    figure.textContent = String(from);
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const v = countAt(from, to, now - start, WALLET_COUNT_MS);
      figure.textContent = String(v);
      countRaf = v === to ? 0 : requestAnimationFrame(step);
    };
    countRaf = requestAnimationFrame(step);
  }

  host.appendChild(wrap);
  // Leaving mid-purchase stops the count's frame and every flash's timeout
  // BEFORE the node goes, so nothing this screen started writes to it after.
  return () => {
    cancelAnimationFrame(countRaf);
    for (const id of timers) window.clearTimeout(id);
    wrap.remove();
  };
}

/** The unit's own one-line description, when its JSON carries one.
 *  `UpgradableUnit` describes only what `applyUpgrades` needs, so this reads
 *  the field structurally rather than widening that type with a display
 *  field the data package has no use for. */
function readBlurb(unit: UpgradableUnit): string | undefined {
  const v = (unit as unknown as Record<string, unknown>).blurb;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
