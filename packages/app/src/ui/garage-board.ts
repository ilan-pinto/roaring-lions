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
  /** F7: the unit is not in the brigade yet, so this track is read-only
   *  speculation rather than a decision. Every tier reads as if nothing were
   *  owned -- tier 1 is `next`, expanded with its price and benefits, exactly
   *  as an unbought track always draws -- but where a Buy would sit on that
   *  rung, `.rl-garage__track-lock` says "Unlock first" instead. No Buy is
   *  ever drawn while this is true, even if `buy` is also supplied. */
  readonly locked?: boolean;
  readonly preview: (d: ReadonlyMap<string, number> | null) => void;
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

  // F7: a locked unit owns nothing on this track no matter what the account
  // says -- it is not in the brigade yet, so `deps.owned` (whatever a stray
  // account entry might carry) is never the number this draws from.
  const locked = deps.locked === true;
  const effectiveOwned = locked ? 0 : deps.owned;

  const summary = trackSummary(track, effectiveOwned);

  const trackWrap = el('div', 'rl-garage__track');
  trackWrap.dataset.track = trackName;
  trackWrap.dataset.locked = locked ? '1' : '0';
  // Maxed vs. still open -- read by CSS to grey the spend line once nothing
  // is left to buy on this track; nothing in script keys off it.
  trackWrap.dataset.state = summary.next === null ? 'maxed' : 'active';

  // --- the head: glyph, name, pips, tier, spend -----------------------------
  // The focus key lives HERE now, not on the track container the way Task 3
  // left it (a controller ruling on this task): a key that could sit on
  // either of two elements is a key `restoreFocus` could find on the wrong
  // one, and the container itself carries no `tabIndex` to receive it any
  // more.
  const head = el('div', 'rl-garage__track-head');
  head.dataset.focusKey = `track:${trackName}`;
  head.tabIndex = -1;

  const glyph = el('div', 'rl-garage__track-glyph');
  // A kit track (armour/sensors/firepower) draws its own symbol
  // (`kit-sign.ts`); anything else -- a content author's own track, the
  // underscored `fire_control` fixture's case -- draws the reserved hatch
  // alone, the same "reserved, not broken" language the rail's card art and
  // the bay's plate already speak for a unit with no picture.
  if (isKitTrack(trackName)) glyph.innerHTML = kitSymbolSvg(trackName, 40);
  head.appendChild(glyph);

  const headLine = el('div', 'rl-garage__track-line');
  headLine.appendChild(el('h3', 'rl-garage__track-name', trackLabel));
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
      'div',
      'rl-garage__track-spend',
      summary.next === null
        ? t('garage.track.spentMaxed', { spent: summary.spent })
        : t('garage.track.spent', { spent: summary.spent, toMax: summary.toMax })
    )
  );
  trackWrap.appendChild(head);

  // --- the ladder ------------------------------------------------------------
  const ladder = el('div', 'rl-garage__rungs');
  for (let tier = track.tiers.length; tier >= 1; tier--) {
    const state = rungState(tier, effectiveOwned);
    const owned = tier <= effectiveOwned;

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
        const price = nextTierPrice(deps.unit, trackName, effectiveOwned);
        // `tier === effectiveOwned + 1 <= track.tiers.length` here by
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
      deps.preview(state === 'owned' ? null : previewDeltas(deps.unit, trackName, effectiveOwned, tier));
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

  return trackWrap;
}
