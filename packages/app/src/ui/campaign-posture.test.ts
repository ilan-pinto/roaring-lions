// @vitest-environment jsdom
/** GH-1394 slice 2 (ruling D10): the campaign board carries the posture chip under its theatre line, writes the ledger key
 *  through it, and tears it down with the screen. */
import { afterEach, describe, expect, it } from 'vitest';
import worldJson from '../../../../data/campaign/world.json';
import countriesJson from '../../../../data/campaign/countries.json';
import { parseCountries, parseWorld } from '../campaign';
import { memoryLedgerStore } from '../ledger-store';
import { showCampaign } from './menu';
import { posturePicker } from './posture-ui';

afterEach(() => document.body.replaceChildren());

function board() {
  const store = memoryLedgerStore();
  const stage = document.createElement('div');
  document.body.append(stage);
  let disposed = 0;
  const leave = showCampaign(stage, {
    base: '/',
    world: parseWorld(worldJson),
    countries: parseCountries(countriesJson),
    ledger: {},
    posture: () => {
      const p = posturePicker({ where: 'board', read: () => store.readLedger(), write: (l) => store.writeLedger(l), canWrite: true });
      return { el: p.el, dispose: () => { disposed += 1; p.dispose(); } };
    },
  });
  return { store, stage, leave, disposed: () => disposed };
}

describe('showCampaign with the posture chip', () => {
  it('draws the chip right under the theatre line, reading Standard on a fresh campaign', () => {
    const { stage } = board();
    const chip = stage.querySelector('.rl-posture')!;
    expect(chip).not.toBeNull();
    expect(chip.previousElementSibling?.className).toBe('rl-menu__theatre');
    expect(chip.querySelector('.rl-posture__name')?.textContent).toBe('Posture: Standard');
  });

  it('a click on the chip writes the campaign ledger key and the chip says what Easier costs', () => {
    const { stage, store } = board();
    stage.querySelector<HTMLButtonElement>('.rl-posture [data-posture="easier"]')!.click();
    expect(store.readLedger()['campaign.difficulty']).toBe('easier');
    expect(stage.querySelector('.rl-posture__note')?.textContent).toBe('Two stars at most; carried secondaries pay no credits.');
  });

  it('no builder, no chip; leaving the screen disposes it (the disposer contract)', () => {
    const plain = document.createElement('div');
    showCampaign(plain, { base: '/', world: parseWorld(worldJson), countries: parseCountries(countriesJson), ledger: {} });
    expect(plain.querySelector('.rl-posture')).toBeNull();
    const { stage, leave, disposed } = board();
    leave();
    expect(disposed()).toBe(1);
    expect(stage.querySelector('.rl-posture')).toBeNull();
  });
});
