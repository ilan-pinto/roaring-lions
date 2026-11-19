/**
 * GH-1395 slice 2: "Amendments to the orders" (ruling D11), the deploy screen's panel under the briefing's orders.
 *
 * It offers the mission's three amendments as toggles, names the challenge, marks the amendments the challenge needs,
 * and says what beating it pays: 10 Roar coins, once per account (D1), no credits (D3), no star and no unit (D2). It is
 * drawn only where `amendmentOffer` (`../challenge.ts`) allows: a pilot mission, never the tutorial, never on Easier,
 * never a mission played by address that is not open, and never a resumed run (main.ts's gate, `amendmentsForRun`).
 *
 * A change starts this briefing again (`onChange`, main.ts's `req.restart({ amendments })`), as the posture line does
 * (PR 1548): the mission the player deploys is the one the panel names, and the ids become the run's start input, so
 * a save, a replay and Restart carry them (D10). Buttons, not checkboxes: each press restarts the briefing.
 *
 * Copy: the panel's own words are `t()` keys; the amendment and challenge names and blurbs are DATA text
 * (`data/challenges/*.json`, the lead's ruling 4 on PR 1524), shown as written.
 *
 * Loaded lazily, through `../posture` (one chunk with the challenge code), so none of it is on the entry chunk
 * (`webgpu:bundle`; `posture-wiring.test.ts` holds the boundary).
 *
 * Disposer contract: the panel owns what it makes. Its listeners are on its own elements and die with them; a click after
 * `dispose` or `freeze` changes nothing. `freeze` is called the moment Deploy is answered: after that a change would
 * restart a mission that has started.
 */
import type { MissionChallengeJson } from '@lions/data';
import { offeredAmendments } from '../challenge';
import { t } from '../i18n/t';

export interface AmendmentPanelDeps {
  /** The mission's offers and challenge (`amendmentOffer`). */
  offer: MissionChallengeJson;
  /** The ids this run is played with (`amendmentsForRun`). */
  chosen: readonly string[];
  /** A press: the new id set, in the mission's `offers` order. The caller restarts the briefing on it. */
  onChange(next: string[]): void;
}

export interface AmendmentPanel {
  el: HTMLElement;
  /** Disables every toggle for good; a press after it changes nothing. Idempotent. */
  freeze(): void;
  dispose(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function amendmentPanel(deps: AmendmentPanelDeps): AmendmentPanel {
  let disposed = false;
  let frozen = false;
  const { offer } = deps;
  const on = new Set(deps.chosen);
  const needed = new Set(offer.challenge.amendments);
  const list = offeredAmendments(offer);
  const armed = offer.challenge.amendments.every((id) => on.has(id));

  // A disclosure, open whenever an amendment is on, so a restart onto an amended briefing shows what is on.
  const root = el('details', 'rl-amend');
  root.open = on.size > 0;
  root.dataset.armed = String(armed);
  const summary = el('summary', 'rl-amend__summary');
  summary.append(el('span', 'rl-amend__head', t('amend.head')), el('span', 'rl-amend__count', on.size === 0 ? t('amend.none') : t('amend.on', { n: on.size })));

  const rows = el('div', 'rl-amend__rows');
  rows.setAttribute('role', 'group');
  rows.setAttribute('aria-label', t('amend.head'));
  const buttons = list.map((a) => {
    const b = el('button', 'rl-amend__row');
    b.type = 'button';
    b.dataset.amendment = a.id;
    b.setAttribute('aria-pressed', String(on.has(a.id)));
    const name = el('span', 'rl-amend__name', a.label);
    b.append(name);
    if (needed.has(a.id)) {
      b.dataset.needed = 'true';
      b.append(el('span', 'rl-amend__need', t('amend.needed')));
    }
    b.append(el('span', 'rl-amend__blurb', a.blurb));
    b.addEventListener('click', () => press(a.id));
    rows.append(b);
    return b;
  });

  const challenge = el('div', 'rl-amend__challenge');
  challenge.dataset.armed = String(armed);
  const title = el('p', 'rl-amend__challenge-title');
  title.append(el('span', 'rl-amend__mark'), el('span', 'rl-amend__challenge-name', t('amend.challenge', { name: offer.challenge.label })));
  const state = el('p', 'rl-amend__challenge-state', armed ? t('amend.armed') : t('amend.unarmed'));
  challenge.append(title, el('p', 'rl-amend__challenge-blurb', offer.challenge.blurb), state);

  root.append(summary, rows, challenge, el('p', 'rl-amend__pays', t('amend.pays')), el('p', 'rl-amend__when', t('amend.when')));

  function press(id: string): void {
    if (disposed || frozen) return;
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // One press, one restart: the panel is spent once it has asked for one.
    frozen = true;
    for (const b of buttons) b.disabled = true;
    deps.onChange(offer.offers.filter((x) => next.has(x)));
  }

  return {
    el: root,
    freeze: () => {
      frozen = true;
      for (const b of buttons) b.disabled = true;
    },
    dispose: () => {
      disposed = true;
      root.remove();
    },
  };
}
