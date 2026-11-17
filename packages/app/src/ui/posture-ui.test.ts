// @vitest-environment jsdom
/**
 * GH-1394 slice 2: the campaign posture where the player chooses it (the board's chip, the deploy line, ruling D10) and the
 * defeat screen's one suggestion (D11). Oracles are literals: the ledger key's spelling, the English of every line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { missions } from '@lions/data';
import type { MissionJson } from '@lions/sim';
import en from '../i18n/en.json';
import { missingKeys, setCatalogue } from '../i18n/t';
import { pseudo } from '../i18n/pseudo';
import { memoryLedgerStore, type CampaignLedger } from '../ledger-store';
import { defeatSuggestion, posturePicker, showsPosture, withPosture, type PosturePickerDeps } from './posture-ui';

const KEY = 'campaign.difficulty';
const foothold = missions.beit_sahwan_2_foothold as unknown as MissionJson;
const tutorial = missions.beit_sahwan_0_tutorial as unknown as MissionJson;

afterEach(() => {
  setCatalogue('en', en);
  document.body.replaceChildren();
});

function onStore(seed: CampaignLedger = {}, over: Partial<PosturePickerDeps> = {}) {
  const store = memoryLedgerStore();
  store.writeLedger(seed);
  const onChanged = vi.fn();
  const deps: PosturePickerDeps = {
    where: 'board',
    read: () => store.readLedger(),
    write: (l) => store.writeLedger(l),
    canWrite: true,
    onChanged,
    ...over,
  };
  const picker = posturePicker(deps);
  document.body.append(picker.el);
  const row = (id: string): HTMLButtonElement => picker.el.querySelector<HTMLButtonElement>(`[data-posture="${id}"]`)!;
  const text = (sel: string): string | null | undefined => picker.el.querySelector(sel)?.textContent;
  return { store, picker, row, text, onChanged };
}

describe('withPosture: the one ledger write', () => {
  it('sets the key for Easier and Harder, removes it for Standard, and leaves the input alone', () => {
    const base = { 'campaign.completed_missions': ['m0'] } as CampaignLedger;
    expect(withPosture(base, 'easier')).toEqual({ 'campaign.completed_missions': ['m0'], 'campaign.difficulty': 'easier' });
    expect(withPosture(base, 'harder')).toEqual({ 'campaign.completed_missions': ['m0'], 'campaign.difficulty': 'harder' });
    expect(withPosture({ ...base, [KEY]: 'easier' }, 'standard')).toEqual({ 'campaign.completed_missions': ['m0'] });
    expect(base).toEqual({ 'campaign.completed_missions': ['m0'] });
  });
});

describe('the posture picker (board chip and deploy line)', () => {
  it('reads the ledger key: absent is Standard, and a stored posture is the one shown and pressed', () => {
    const a = onStore();
    expect(a.text('.rl-posture__name')).toBe('Posture: Standard');
    expect(a.text('.rl-posture__note')).toBe('As written.');
    expect(a.row('standard').getAttribute('aria-pressed')).toBe('true');
    a.picker.dispose();
    const b = onStore({ [KEY]: 'harder' });
    expect(b.text('.rl-posture__name')).toBe('Posture: Harder');
    expect(b.text('.rl-posture__note')).toBe('The same marks and credits as Standard.');
    expect(b.row('harder').getAttribute('aria-pressed')).toBe('true');
    expect(b.row('easier').getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the ledger key on a click, says what Easier costs, and Standard puts the ledger back as it was', () => {
    const seed = { 'campaign.completed_missions': ['m0'] } as CampaignLedger;
    const { store, row, text, onChanged, picker } = onStore(seed);
    row('easier').click();
    expect(store.readLedger()).toEqual({ 'campaign.completed_missions': ['m0'], 'campaign.difficulty': 'easier' });
    expect(text('.rl-posture__name')).toBe('Posture: Easier');
    expect(text('.rl-posture__note')).toBe('Two stars at most; carried secondaries pay no credits.');
    expect(picker.el.dataset.posture).toBe('easier');
    expect(onChanged).toHaveBeenCalledWith('easier');
    row('standard').click();
    expect(store.readLedger()).toEqual({ 'campaign.completed_missions': ['m0'] });
    expect(onChanged).toHaveBeenLastCalledWith('standard');
  });

  it('the rows say what each posture does, the pay line is the ruled copy, and the board says when it applies', () => {
    const { row, text } = onStore();
    expect(row('easier').textContent).toBe(
      'EasierMore time, thinner and later enemy waves, and a rifle squad and a medic squad at 1:30. Two stars at most; carried secondaries pay no credits.'
    );
    expect(text('.rl-posture__pays')).toBe("Easier never pays more than Standard's best.");
    expect(text('.rl-posture__when')).toBe('Applies from the next deploy.');
  });

  it('the deploy line says a change starts the briefing again, and calls back so the caller can', () => {
    const { row, text, onChanged } = onStore({}, { where: 'deploy' });
    expect(text('.rl-posture__when')).toBe('A change starts this briefing again on the new posture.');
    row('harder').click();
    expect(onChanged).toHaveBeenCalledTimes(1);
    row('harder').click(); // the posture it already is: nothing written, nothing restarted
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a refused write changes nothing, says so, and keeps the posture it had', () => {
    const { store, row, text, onChanged } = onStore({}, { write: () => { throw new Error('quota'); } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    row('easier').click();
    expect(store.readLedger()).toEqual({});
    expect(text('.rl-posture__msg')).toBe('This browser would not keep the change. The posture is still Standard.');
    expect(row('standard').getAttribute('aria-pressed')).toBe('true');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('with nothing durable to write to, the rows are disabled and say why; a click writes nothing', () => {
    const { store, row, text } = onStore({}, { canWrite: false });
    expect(row('easier').disabled).toBe(true);
    expect(text('.rl-posture__when')).toBe('This browser is not keeping the campaign, so the posture cannot be changed here.');
    row('easier').dispatchEvent(new MouseEvent('click'));
    expect(store.readLedger()).toEqual({});
  });

  it('dispose removes it, and a click that lands afterwards writes nothing', () => {
    const { store, row, picker } = onStore();
    const easier = row('easier');
    picker.dispose();
    expect(picker.el.isConnected).toBe(false);
    easier.click();
    expect(store.readLedger()).toEqual({});
  });

  it('?pseudo=1: every string the picker draws is bracketed, so none bypassed t()', () => {
    setCatalogue('pseudo', en, pseudo);
    const { picker } = onStore({ [KEY]: 'easier' });
    const leaves = picker.el.querySelectorAll('.rl-posture__name, .rl-posture__note, .rl-posture__row-name, .rl-posture__row-blurb, .rl-posture__pays, .rl-posture__when');
    expect(leaves.length).toBe(2 + 3 + 3 + 2);
    for (const e of leaves) expect(e.textContent, e.className).toMatch(/^⟦[\s\S]*⟧$/);
    expect(picker.el.querySelector('.rl-posture__rows')?.getAttribute('aria-label')).toMatch(/^⟦[\s\S]*⟧$/);
    expect(missingKeys()).toEqual([]);
  });
});

describe('the defeat suggestion (D11) and the tutorial (D12)', () => {
  const SUGGEST = 'Try Easier from the next deploy: more time, thinner enemy waves and a relief at 1:30. Choose it on the campaign map or the deploy screen.';

  it('a lost campaign mission on Standard or Harder suggests Easier', () => {
    expect(defeatSuggestion('defeat', foothold, {})).toBe(SUGGEST);
    expect(defeatSuggestion('defeat', foothold, { [KEY]: 'harder' })).toBe(SUGGEST);
  });

  it('never on Easier, never on a win, never in the tutorial, never without a mission', () => {
    expect(defeatSuggestion('defeat', foothold, { [KEY]: 'easier' })).toBeNull();
    expect(defeatSuggestion('victory', foothold, {})).toBeNull();
    expect(defeatSuggestion('defeat', tutorial, {})).toBeNull();
    expect(defeatSuggestion('defeat', undefined, {})).toBeNull();
  });

  it('never changes the posture: the ledger it reads is left exactly as it was', () => {
    const ledger = Object.freeze({ [KEY]: 'harder', 'campaign.completed_missions': Object.freeze(['m0']) });
    expect(defeatSuggestion('defeat', foothold, ledger)).toBe(SUGGEST);
    expect(ledger).toEqual({ 'campaign.difficulty': 'harder', 'campaign.completed_missions': ['m0'] });
  });

  it('the tutorial shows no posture at all; a campaign mission does', () => {
    expect(showsPosture(tutorial)).toBe(false);
    expect(showsPosture(undefined)).toBe(false);
    expect(showsPosture(foothold)).toBe(true);
  });

  it('?pseudo=1: the suggestion is bracketed', () => {
    setCatalogue('pseudo', en, pseudo);
    expect(defeatSuggestion('defeat', foothold, {})).toMatch(/^⟦[\s\S]*⟧$/);
  });
});
