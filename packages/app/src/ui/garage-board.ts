// The upgrade board's per-track element (WP-S3g Task 7, §4, F6, F9): three
// compact tracks instead of one long list of fully-expanded rungs, and no
// line that says a stat is not changing.
//
// Split out of `brigade.ts` for the reason `garage-stats.ts` already was
// (Task 6): the pure half -- `rungState`, `trackSummary`, `visibleBenefits`
// -- can be swept against the shipped units directly, and `trackEl` can be
// tested with a `TrackDeps` fixture that never touches `showBrigade`'s own
// classification, purchase protocol, or DOM.
//
// What Task 5/6 shipped drew every rung on every track fully expanded: a
// price line and a full block of `formatBenefit` lines, always on screen,
// tier 1 to the track's own maximum. §2 goal 3 and F9 name the same cause --
// a unit with three real tracks (the Lavi's armour/firepower/sensors, all
// three tiers deep) does not fit the board column at 1920x1080 without
// scrolling, and the garage's own box was taller than the viewport it opens
// in. A rung also does not mean the same thing to read at every tier: an
// OWNED rung is read-only history, a FUTURE one is read-only speculation,
// and only the rung directly above what is owned -- the NEXT one -- is an
// actual decision. So only that rung stays expanded (its benefits, its Buy);
// every other rung collapses to one line (tier, price, an Owned tag where it
// applies), carrying its full text as a `title` a mouse can still reach, and
// -- for a FUTURE rung only, and only once the widest layout has room to
// spare -- a one-line gist.
import { nextTierPrice, type UpgradableUnit, type UpgradeTrack } from '@lions/data';
import { t } from '../i18n/t';
import { previewDeltas } from './garage-stats';
import { isKitTrack, kitSymbolSvg } from './kit-sign';
import { formatBenefit, upgradeBenefits, type BenefitLine } from './upgrade-benefit';

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Where tier `tier` stands against the `owned` tier of its own track: the
 *  one already bought, the one decision left on the table, or one of the
 *  ones still further off. Everything the board draws differently between
 *  one rung and another hinges on this one read. */
export type RungState = 'owned' | 'next' | 'future';

export function rungState(tier: number, owned: number): RungState {
  if (tier <= owned) return 'owned';
  return tier === owned + 1 ? 'next' : 'future';
}

/** The track head's own "spent 360 · 1315 to max" line (§4), and the tier a
 *  Buy control would sell next. `owned` is clamped to the track's own
 *  length the same way `brigade.ts`'s `ownedTiers` already does -- data may
 *  SHRINK a track after a purchase, and a clamped owned tier reads as maxed
 *  rather than pricing a phantom rung past the end of `tiers`. */
export interface TrackSummary {
  readonly owned: number;
  readonly length: number;
  readonly spent: number;
  readonly toMax: number;
  readonly next: number | null;
}

export function trackSummary(track: UpgradeTrack, owned: number): TrackSummary {
  const length = track.tiers.length;
  const clamped = Math.min(Math.max(owned, 0), length);
  let spent = 0;
  let toMax = 0;
  track.tiers.forEach((tier, i) => {
    // `i` is 0-based; tier `i + 1` is owned exactly when `i < clamped`.
    if (i < clamped) spent += tier.price;
    else toMax += tier.price;
  });
  return { owned: clamped, length, spent, toMax, next: clamped < length ? clamped + 1 : null };
}

/** The accordion (fix round 1, §2 goal 3): which one of the board's tracks
 *  shows its ladder. `active` is whatever the player is currently pointed
 *  at -- mouse hover or keyboard focus landing anywhere inside a track, or a
 *  digit jump (`brigade.ts` owns combining those into one value; this
 *  function only makes the choice from it). A track the player is pointed
 *  at wins outright, maxed or not -- reading what is already bought is still
 *  a reason to open one. Absent that, the first track still worth a
 *  decision opens by default; a fully maxed board (or an empty one) expands
 *  nothing. */
export function expandedTrack(order: readonly string[], maxed: ReadonlySet<string>, active: string | null): string | null {
  if (active !== null && order.includes(active)) return active;
  return order.find((name) => !maxed.has(name)) ?? null;
}

/** F6: a line whose `before` and `after` read the same number is not a
 *  benefit. `upgradeBenefits` still reports it -- a tier's cumulative patch
 *  can net to zero at a path it nonetheless names -- and this is the one
 *  place that drops it before it reaches a player, rather than printing
 *  "Front armour 12 → 12" and letting them wonder what changed. */
export function visibleBenefits(lines: readonly BenefitLine[]): BenefitLine[] {
  return lines.filter((l) => l.before !== l.after);
}

/** What `trackEl` needs about the unit that owns this track, and how to ask
 *  for a purchase and a stat-panel preview -- everything `brigade.ts`
 *  already holds onto, handed down so this module never imports
 *  `showBrigade`'s own state or its purchase protocol directly. */
export interface TrackDeps {
  readonly unit: UpgradableUnit;
  readonly unitId: string;
  readonly unitName: string;
  readonly owned: number;
  /** Present only when the caller supplied both a balance and a purchase
   *  callback -- the rule `showBrigade` has always followed for a Buy
   *  control anywhere on this screen. `asked` is the focus key a purchase
   *  answers to (`buy:<track>`), built here and handed back rather than
   *  rebuilt by the caller, so `garage-model.ts`'s `restoreFocus` only ever
   *  sees the one spelling. */
  readonly buy?: {
    readonly credits: number;
    readonly onBuy: (tier: number, price: number, asked: string) => void;
  };
  /** F7: the unit is not in the brigade -- never unlocked, or re-locked by a
   *  gate it no longer clears -- so this track is read-only. Tiers it owns
   *  draw as owned all the same (M3, ruling L2: kept, dormant), and the next
   *  rung is expanded with its price and benefits exactly as an open track
   *  draws it; but where its Buy would sit, `.rl-garage__track-lock` says
   *  "Unlock first" instead. No Buy is ever drawn while this is true, even
   *  if `buy` is also supplied. */
  readonly locked?: boolean;
  readonly preview: (d: ReadonlyMap<string, number> | null) => void;
  /** The accordion's own one signal (fix round 2, issue 2): this track was
   *  pointed at, either by a `mouseenter` on its HEAD specifically -- never
   *  the whole track box, which is what let a cursor merely passing over an
   *  expanded (tall) neighbour on its way somewhere else resize the board
   *  under it -- or by keyboard focus landing anywhere inside the track
   *  (the head, a rung, a Buy). There is no opposite signal: leaving a head,
   *  or blurring out of the track, fires nothing at all, on purpose --
   *  `brigade.ts`'s own `activeTrack` only ever gets SET, never cleared by
   *  either, so the last track pointed at stays expanded through anything
   *  short of pointing at a different one. Optional so a caller with no
   *  accordion (none exists today, but a future read-only embed might) need
   *  not wire it. */
  readonly onActivate?: () => void;
}

/**
 * One track of the board: `.rl-garage__track[data-track][data-state]`, a
 * head (`.rl-garage__track-head[data-focus-key="track:<n>"]`, holding the
 * glyph, the name, the pips, the tier count and the spend line) and a ladder
 * of rungs, tier `track.tiers.length` at the top of the DOM down to tier 1 --
 * climbed, like the ladder it is.
 */
export function trackEl(trackName: string, track: UpgradeTrack, deps: TrackDeps): HTMLElement {
  // I5's pseudo pass (Task 5/6's final review): a track's heading is
  // catalogue text (`garage.track.<n>`), never the raw JSON key -- the
  // humanised key is only the fallback for a track a content author adds
  // before a translator has caught up with it.
  const trackKey = `garage.track.${trackName}`;
  const humanised = trackName.replace(/_/g, ' ');
  const translated = t(trackKey);
  const trackLabel = translated === trackKey ? humanised : translated;

  // F7: a locked unit is read-only -- no Buy anywhere on its board. What it
  // OWNS is still drawn (M3, lead ruling L2): a unit that re-locks (a Conduct
  // gate after a bad mission) keeps the tiers it bought, dormant, and the
  // sim's `applyUpgrades` pre-pass applies them regardless of the gate. The
  // board used to read every tier as unbought here, beside rail pips, a kit
  // mark and a kit total that all read the account and said otherwise.
  const locked = deps.locked === true;

  const summary = trackSummary(track, deps.owned);

  const trackWrap = el('div', 'rl-garage__track');
  trackWrap.dataset.track = trackName;
  trackWrap.dataset.locked = locked ? '1' : '0';
  // Maxed vs. still open -- read by CSS to grey the spend line once nothing
  // is left to buy on this track; nothing in script keys off it.
  trackWrap.dataset.state = summary.next === null ? 'maxed' : 'active';

  // --- the head: glyph, name, pips, tier, spend -----------------------------
  // The focus key lives HERE, not on the track container the way Task 3 left
  // it (a controller ruling on T7): a key that could sit on either of two
  // elements is a key `restoreFocus` could find on the wrong one.
  //
  // A real `<button>` (final review I1), inside the track's own heading --
  // the disclosure pattern: `aria-expanded` says whether its ladder is open
  // (`brigade.ts`'s `applyExpansion` keeps it true to `data-expanded`),
  // `aria-controls` names the ladder, and Enter or Space opens it natively,
  // through the click below. The accordion (T9) made a collapsed ladder
  // `display: none`, and with the head a `tabIndex = -1` div a keyboard
  // player had NO route into another track but the digit keys, which
  // nothing on screen mentions. Its children are spans, since a button holds
  // phrasing content only.
  const heading = el('h3', 'rl-garage__track-heading');
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'rl-garage__track-head';
  head.dataset.focusKey = `track:${trackName}`;
  const ladderId = `rl-garage-rungs-${deps.unitId}-${trackName}`;
  head.setAttribute('aria-controls', ladderId);
  head.setAttribute('aria-expanded', 'false');
  heading.appendChild(head);

  const glyph = el('span', 'rl-garage__track-glyph');
  // A kit track (armour/sensors/firepower) draws its own symbol
  // (`kit-sign.ts`); anything else -- a content author's own track, the
  // underscored `fire_control` fixture's case -- draws the reserved hatch
  // alone, the same "reserved, not broken" language the rail's card art and
  // the bay's plate already speak for a unit with no picture.
  if (isKitTrack(trackName)) glyph.innerHTML = kitSymbolSvg(trackName, 40);
  head.appendChild(glyph);

  const headLine = el('span', 'rl-garage__track-line');
  headLine.appendChild(el('span', 'rl-garage__track-name', trackLabel));
  const pips = el('span', 'rl-garage__track-pips');
  for (let i = 0; i < summary.length; i++) {
    const pip = document.createElement('i');
    pip.dataset.on = i < summary.owned ? '1' : '0';
    pips.appendChild(pip);
  }
  headLine.appendChild(pips);
  headLine.appendChild(
    el('span', 'rl-garage__track-tier', t('garage.track.tierOf', { n: summary.owned, m: summary.length }))
  );
  head.appendChild(headLine);

  head.appendChild(
    el(
      'span',
      'rl-garage__track-spend',
      summary.next === null
        ? t('garage.track.spentMaxed', { spent: summary.spent })
        : t('garage.track.spent', { spent: summary.spent, toMax: summary.toMax })
    )
  );
  trackWrap.appendChild(heading);

  // --- the ladder ------------------------------------------------------------
  const ladder = el('div', 'rl-garage__rungs');
  ladder.id = ladderId;
  for (let tier = track.tiers.length; tier >= 1; tier--) {
    const state = rungState(tier, deps.owned);
    const owned = tier <= deps.owned;

    const rung = el('div', 'rl-garage__rung');
    rung.dataset.tier = String(tier);
    rung.dataset.owned = owned ? '1' : '0';
    rung.dataset.state = state;
    rung.dataset.focusKey = `rung:${trackName}:${tier}`;
    // Script-focusable only: nothing on this screen tabs INTO a rung today,
    // and `focusin`/`focusout` below still fire when a descendant control --
    // the next rung's own Buy -- takes focus, since those bubble and
    // `focus`/`blur` do not.
    rung.tabIndex = -1;

    const rungHead = el('div', 'rl-garage__rung-head');
    rungHead.appendChild(el('span', 'rl-garage__rung-tier', t('garage.rung.tier', { tier })));
    rungHead.appendChild(el('span', 'rl-garage__rung-price', String(track.tiers[tier - 1].price)));
    if (owned) rungHead.appendChild(el('span', 'rl-garage__rung-owned', t('garage.rung.owned')));
    rung.appendChild(rungHead);

    const visible = visibleBenefits(upgradeBenefits(deps.unit, trackName, tier));

    if (state === 'next') {
      // The one rung that is a decision: every visible line, in full.
      const benefits = el('div', 'rl-garage__benefits');
      for (const line of visible) benefits.appendChild(el('div', 'rl-garage__benefit', formatBenefit(line)));
      rung.appendChild(benefits);

      if (locked) {
        // F7: read-only speculation. Where a Buy would sit -- even one the
        // caller supplied -- this rung says what stands in its way instead.
        rung.appendChild(el('div', 'rl-garage__track-lock', t('garage.locked.unlockFirst')));
      } else if (deps.buy) {
        const { credits, onBuy } = deps.buy;
        const price = nextTierPrice(deps.unit, trackName, deps.owned);
        // `tier === deps.owned + 1 <= track.tiers.length` here by
        // construction, so `nextTierPrice` disagreeing about the track's own
        // length would be a programming error, not data to fall through
        // silently for.
        if (price === null) {
          throw new Error(`trackEl: ${deps.unitId} has no tier ${tier} on track "${trackName}"`);
        }
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'rl-btn rl-garage__buy-tier';
        buy.textContent = t('garage.rung.buy', { tier, price });
        buy.setAttribute(
          'aria-label',
          t('garage.rung.buy.aria', { name: deps.unitName, track: trackLabel, tier, price })
        );
        // Named by the TRACK, not the tier, so the next tier's Buy after a
        // purchase answers to the same key and `restoreFocus` finds it.
        buy.dataset.focusKey = `buy:${trackName}`;
        buy.disabled = credits < price;
        buy.addEventListener('click', () => {
          buy.disabled = true; // one purchase per render; the caller's answer redraws
          onBuy(tier, price, `buy:${trackName}`);
        });
        rung.appendChild(buy);
      }
    } else {
      // A read-only line: the full text lives on `title` (a hover a mouse
      // player can still reach), and the FIRST visible line is also drawn as
      // a `.rl-garage__rung-gist` -- hidden everywhere by default (`theme.css`),
      // and shown only for a FUTURE rung at the widest layout (F9's
      // wide-screen allowance), never for an owned one.
      const texts = visible.map(formatBenefit);
      rung.title = texts.join('\n');
      rung.appendChild(el('div', 'rl-garage__rung-gist', texts[0] ?? ''));
    }

    // The garage's one trick a list cannot do: the panel above shows what
    // this rung would make of the unit, before the money is spent. An owned
    // rung previews nothing (F5) -- never `previewDeltas` on it, which would
    // read as a re-buy.
    const on = (): void =>
      deps.preview(state === 'owned' ? null : previewDeltas(deps.unit, trackName, deps.owned, tier));
    const off = (): void => deps.preview(null);
    rung.addEventListener('mouseenter', on);
    rung.addEventListener('mouseleave', off);
    rung.addEventListener('focusin', on);
    rung.addEventListener('focusout', off);

    ladder.appendChild(rung);
  }
  trackWrap.appendChild(ladder);

  if (!locked && deps.buy && summary.next === null) {
    trackWrap.appendChild(el('div', 'rl-garage__track-max', t('garage.track.maxed')));
  }

  // The accordion's own one signal (fix round 2, issue 2): the DOM is always
  // built in full above -- this module never decides which track is
  // expanded, only reports that the player pointed at THIS one, and only on
  // the way IN. Deliberately asymmetric:
  //   - `mouseenter` is bound to `head` alone, not `trackWrap`. The whole
  //     track box includes the ladder below it, which is tall exactly when
  //     the track is already expanded -- binding to the box let a cursor
  //     merely passing over an open neighbour on its way to a track further
  //     down retrigger it and resize the board underneath, the hover-jitter
  //     the review named. A head is a fixed, compact target regardless of
  //     what its own ladder is doing.
  //   - `focusin` stays on `trackWrap`: keyboard focus can land on a rung or
  //     a Buy directly (a digit jump, Task 9), and any of those pointing at
  //     the track is exactly as valid as the head doing it. `focusin`
  //     bubbles; `mouseenter` does not, which is why the two need different
  //     listener targets to express the same "landed inside" for keyboard
  //     and a narrower one for the mouse.
  //   - There is no `mouseleave`/`focusout` handler at all. Leaving a head,
  //     or blurring out of the track, asks for nothing -- the ruling is that
  //     the last track pointed at stays open through anything short of
  //     pointing at a different one, so there is nothing for a "leaving"
  //     event to usefully do.
  //   - `click` on the head (I1) is the keyboard's own way in -- Enter and
  //     Space activate a button natively -- and a mouse click on a head the
  //     cursor has already opened by entering it changes nothing.
  head.addEventListener('mouseenter', () => deps.onActivate?.());
  head.addEventListener('click', () => deps.onActivate?.());
  trackWrap.addEventListener('focusin', () => deps.onActivate?.());

  return trackWrap;
}
