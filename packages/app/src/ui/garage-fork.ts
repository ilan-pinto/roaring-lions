// The Garage's FORK (GH-1384 slice 2; design 2026-11-17 §3.1): how a branched tier draws on the
// upgrade board, in its three rung states, and the legacy owner's one-time Switch or Return.
//
// `garage-board.ts`'s `trackEl` hands the branched rung here when, and only when, its caller passed a
// `fork` (`TrackDeps.fork`). `brigade.ts` passes one only for a (unit, track) in the economy's shipped
// branched table, which is EMPTY while the branch switch is closed (`shippedBranched`), so with the
// switch closed nothing in this module runs and the board is dev's, byte for byte.
//
// The rules each card lives by (§3.1):
//   - its benefit lines are `upgradeBenefits` on that branch, read against tier 2: the same function
//     and the same `readPath` the linear rungs use, so a card cannot print a number the sim will not
//     run (`visibleBenefits` drops a line that does not move);
//   - "Gives up" is COMPUTED, never authored (`givesUp`): every path where the OTHER branch ends
//     higher, with both numbers;
//   - a choice is final (the lead, Q2), so the Buy goes through the confirm dialog, which repeats
//     both names;
//   - giving a branch up is not an error: the owned rung's "Given up" line is muted ink, never `--bad`.
import { branchOf, readPath, type BranchPick, type UpgradableUnit } from '@lions/data';
import { t } from '../i18n/t';
import type { CreditAsk } from '../upgrade-pay';
import type { ConfirmOptions } from './confirm';
import { previewDeltas, statNumber } from './garage-stats';
import { blockText, type CreditBlock } from './spend-gate';
import { formatBenefit, benefitLabel, upgradeBenefits } from './upgrade-benefit';

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const PICKS: readonly BranchPick[] = [1, 2];
const other = (p: BranchPick): BranchPick => (p === 1 ? 2 : 1);

/** What the legacy owner of this (unit, track) is offered (`@lions/economy`'s `legacyOffer`, the
 *  two booleans the board needs). */
export interface ForkLegacy {
  readonly canSwitch: boolean;
  readonly canReturn: boolean;
}

/** What `trackEl` needs to draw a branched rung. Present only for a branched (unit, track). */
export interface ForkDeps {
  /** The branched tier's number (the track's length: only the last tier may branch). */
  readonly tier: number;
  /** The branch owned, once the branched tier is owned (`GarageState.picks`). */
  readonly pick?: BranchPick;
  /** Asks the player (`confirmDialog`'s answer). The screen owns the dialog and its teardown. */
  readonly confirm: (o: ConfirmOptions) => Promise<boolean>;
  /** The legacy owner's offer. Drawn only beside `onLegacy`. */
  readonly legacy?: ForkLegacy | null;
  /** Switch or Return, asked after the player confirmed. The caller writes and answers. */
  readonly onLegacy?: (action: 'switch' | 'return') => void;
}

/** A branch's player-facing name: its `en.json` key, or the id while the catalogue lacks it. */
export function branchName(unit: UpgradableUnit, track: string, pick: BranchPick): string {
  const b = branchOf(unit, track)?.[pick - 1];
  if (b === undefined) return '';
  const s = t(b.label);
  return s === b.label ? b.id.replace(/_/g, ' ') : s;
}

/** One "Gives up" line: a path the other branch ends higher on, with both final values. */
export interface GivesUpLine {
  readonly path: string;
  readonly label: string;
  readonly mine: number;
  readonly theirs: number;
  readonly kind: string;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Every path where the OTHER branch of `track`'s branched tier ends higher than branch `pick`, in
 *  the other branch's patch order, with this branch's final value and the other's. A branch patch is
 *  cumulative over base, so a path it does not name ends at base. Empty for a track that is not
 *  branched. Computed, never authored (§3.1). */
export function givesUp(unit: UpgradableUnit, track: string, pick: BranchPick): GivesUpLine[] {
  const pair = branchOf(unit, track);
  if (pair === null) return [];
  const mine = pair[pick - 1].patch;
  const theirs = pair[other(pick) - 1].patch;
  const out: GivesUpLine[] = [];
  for (const path of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const meta = benefitLabel(path);
    const base = readPath(unit, path);
    if (meta === null || base === undefined) continue;
    const a = round2(base + (mine[path] ?? 0));
    const b = round2(base + (theirs[path] ?? 0));
    if (b > a) out.push({ path, label: meta.label, mine: a, theirs: b, kind: meta.unit });
  }
  return out;
}

/** "Penetration stays 1508 (not 1625)". */
export function givesUpText(l: GivesUpLine): string {
  return t('garage.branch.givesUp', { label: l.label, mine: statNumber(l.mine, l.kind), theirs: statNumber(l.theirs, l.kind) });
}

/** What the branched rung needs from `trackEl`, beyond the fork itself. */
export interface ForkRungIn {
  readonly unit: UpgradableUnit;
  readonly unitId: string;
  readonly unitName: string;
  readonly trackName: string;
  readonly trackLabel: string;
  /** The single-player tier on this track. */
  readonly owned: number;
  readonly price: number;
  readonly state: 'owned' | 'next' | 'future';
  readonly locked: boolean;
  readonly fork: ForkDeps;
  readonly buy?: {
    readonly credits: number;
    /** The credit run that ends on this tier, or `null` when credits have nothing to buy here. */
    readonly ask: CreditAsk | null;
    readonly block: CreditBlock | null;
    readonly onBuy: (tier: number, price: number, asked: string, pick: BranchPick) => void;
  };
  readonly preview: (d: ReadonlyMap<string, number> | null) => void;
}

/** The branched rung, `.rl-garage__rung[data-fork="1"]`, carrying the same `data-tier`,
 *  `data-owned`, `data-state` and focus key a linear rung carries. */
export function forkRung(i: ForkRungIn): HTMLElement {
  const { unit, trackName, fork } = i;
  const tier = fork.tier;
  const names: Record<BranchPick, string> = { 1: branchName(unit, trackName, 1), 2: branchName(unit, trackName, 2) };
  const owned = i.state === 'owned';

  const rung = el('div', 'rl-garage__rung rl-garage__rung--fork');
  rung.dataset.tier = String(tier);
  rung.dataset.owned = owned ? '1' : '0';
  rung.dataset.state = i.state;
  rung.dataset.fork = '1';
  rung.dataset.focusKey = `rung:${trackName}:${tier}`;
  rung.tabIndex = -1;

  const head = el('div', 'rl-garage__rung-head');
  head.appendChild(el('span', 'rl-garage__rung-tier', t('garage.rung.tier', { tier })));
  head.appendChild(el('span', 'rl-garage__rung-price', String(i.price)));
  const pick = fork.pick;
  if (owned) {
    if (pick !== undefined) head.appendChild(el('span', 'rl-garage__fork-name', names[pick]));
    head.appendChild(el('span', 'rl-garage__rung-owned', t('garage.rung.owned')));
  } else if (i.state === 'next') {
    head.appendChild(el('span', 'rl-garage__fork-choose', t('garage.branch.chooseOne')));
  }
  rung.appendChild(head);

  if (i.state === 'future') {
    // One line, the full text on `title`, as a future rung is drawn today.
    const line = t('garage.branch.future', { a: names[1], b: names[2] });
    rung.title = line;
    rung.appendChild(el('div', 'rl-garage__rung-gist', line));
    return rung;
  }

  if (owned) {
    if (pick !== undefined) {
      // The choice stays legible later: what was given up, muted (never `--bad`).
      const given = el('div', 'rl-garage__fork-given');
      given.appendChild(el('div', 'rl-garage__fork-given-name', t('garage.branch.givenUp', { branch: names[other(pick)] })));
      for (const l of givesUp(unit, trackName, pick)) given.appendChild(el('div', 'rl-garage__fork-given-line', givesUpText(l)));
      rung.appendChild(given);
    }
    if (pick !== undefined && fork.legacy && fork.onLegacy && (fork.legacy.canSwitch || fork.legacy.canReturn)) {
      rung.appendChild(legacyBlock(i, pick, names));
    }
    return rung;
  }

  // --- next: the two cards ---------------------------------------------------
  const cards = el('div', 'rl-garage__fork');
  const ask = i.buy?.ask ?? null;
  for (const p of PICKS) {
    const card = el('div', 'rl-garage__fork-card');
    card.dataset.branch = String(p);
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', names[p]);
    card.appendChild(el('div', 'rl-garage__fork-name', names[p]));
    const benefits = el('div', 'rl-garage__benefits');
    for (const line of upgradeBenefits(unit, trackName, tier, p).filter((l) => l.before !== l.after)) {
      benefits.appendChild(el('div', 'rl-garage__benefit', formatBenefit(line)));
    }
    card.appendChild(benefits);
    const lines = givesUp(unit, trackName, p);
    if (lines.length > 0) {
      const gives = el('div', 'rl-garage__fork-gives');
      gives.appendChild(el('div', 'rl-garage__fork-gives-head', t('garage.branch.givesUp.head')));
      for (const l of lines) gives.appendChild(el('div', 'rl-garage__fork-gives-line', givesUpText(l)));
      card.appendChild(gives);
    }
    if (!i.locked && i.buy !== undefined && ask !== null && ask.to === tier) {
      card.appendChild(chooseButton(i, p, names, ask));
    }
    // Each card previews its own branch over the unit as bought.
    const on = (): void => i.preview(previewDeltas(unit, trackName, i.owned, tier, p));
    const off = (): void => i.preview(null);
    card.addEventListener('mouseenter', on);
    card.addEventListener('mouseleave', off);
    card.addEventListener('focusin', on);
    card.addEventListener('focusout', off);
    cards.appendChild(card);
  }
  rung.appendChild(cards);
  if (i.locked) {
    rung.appendChild(el('div', 'rl-garage__track-lock', t('garage.locked.unlockFirst')));
  } else if (i.buy !== undefined && ask !== null && ask.to === tier && ask.again > 0) {
    // The run's last tier carries the chosen branch; the run itself is stated once, under both cards.
    rung.appendChild(
      el('div', 'rl-garage__fork-run', t(ask.again === 1 ? 'garage.branch.run1' : 'garage.branch.run', { from: ask.from, last: ask.to - 1 }))
    );
  }
  rung.appendChild(el('div', 'rl-garage__fork-final', t('garage.branch.final')));
  return rung;
}

function chooseButton(i: ForkRungIn, p: BranchPick, names: Record<BranchPick, string>, ask: CreditAsk): HTMLButtonElement {
  const buy = i.buy;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rl-btn rl-garage__buy-tier rl-garage__fork-buy';
  b.dataset.focusKey = `branch:${i.trackName}:${p}`;
  b.dataset.branch = String(p);
  b.textContent = t('garage.branch.buy', { price: ask.price });
  b.setAttribute('aria-label', t('garage.branch.buy.aria', { branch: names[p], name: i.unitName, price: ask.price, other: names[other(p)] }));
  const block = buy?.block ?? null;
  b.disabled = buy === undefined || buy.credits < ask.price || block !== null;
  if (block !== null) {
    b.title = blockText(block);
    b.dataset.block = block;
  }
  b.addEventListener('click', () => {
    if (b.disabled || buy === undefined) return;
    b.disabled = true; // one ask per render; the answer (or a cancel) puts it back
    void i.fork
      .confirm({
        title: t('garage.branch.confirm.title', { branch: names[p] }),
        body: t('garage.branch.confirm.body', { branch: names[p], other: names[other(p)] }),
        confirm: t('garage.branch.confirm.action', { branch: names[p] }),
      })
      .then((yes) => {
        if (!yes) {
          b.disabled = false;
          return;
        }
        // Answers to the track's Buy key, so focus lands on the track head once the tier is owned (`restoreFocus`).
        buy.onBuy(i.fork.tier, ask.price, `buy:${i.trackName}`, p);
      });
  });
  return b;
}

/** "Your Tier 3 became a choice": the legacy owner's Switch (free, once) and Return (full refund). */
function legacyBlock(i: ForkRungIn, pick: BranchPick, names: Record<BranchPick, string>): HTMLElement {
  const { fork } = i;
  const box = el('div', 'rl-garage__fork-legacy');
  box.dataset.legacy = '1';
  box.appendChild(el('div', 'rl-garage__fork-legacy-title', t('garage.branch.legacy.title', { tier: fork.tier })));
  box.appendChild(el('p', 'rl-garage__fork-legacy-body', t('garage.branch.legacy.body', { branch: names[pick] })));
  const row = el('div', 'rl-garage__fork-legacy-row');
  const action = (kind: 'switch' | 'return', label: string, o: ConfirmOptions): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-btn rl-garage__fork-legacy-btn';
    b.dataset.legacy = kind;
    b.dataset.focusKey = `legacy:${i.trackName}:${kind}`;
    b.textContent = label;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      b.disabled = true;
      void fork.confirm(o).then((yes) => {
        if (!yes) {
          b.disabled = false;
          return;
        }
        fork.onLegacy?.(kind);
      });
    });
    return b;
  };
  const to = names[other(pick)];
  if (fork.legacy?.canSwitch === true) {
    row.appendChild(
      action('switch', t('garage.branch.legacy.switch', { branch: to }), {
        title: t('garage.branch.legacy.switch.title', { branch: to }),
        body: t('garage.branch.legacy.switch.body', { branch: to, other: names[pick] }),
        confirm: t('garage.branch.legacy.switch.action'),
      })
    );
  }
  if (fork.legacy?.canReturn === true) {
    const args = { tier: fork.tier, below: fork.tier - 1, name: i.unitName, track: i.trackLabel };
    row.appendChild(
      action('return', t('garage.branch.legacy.return', args), {
        title: t('garage.branch.legacy.return.title', args),
        body: t('garage.branch.legacy.return.body', args),
        confirm: t('garage.branch.legacy.return.action'),
      })
    );
  }
  box.appendChild(row);
  return box;
}
