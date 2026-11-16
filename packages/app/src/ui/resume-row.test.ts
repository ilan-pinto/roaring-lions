// @vitest-environment jsdom
/** GH-1393 slice 2: the Resume row of the campaign board. Every check was seen red under the one-line mutations in the commit. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeOpenDialog, isDialogOpen } from './confirm';
import { clockOfTicks, resumeRow, type ResumeRowDeps, type ResumeView } from './resume-row';
import { resumeRefusalText, saveFailureText, savedAgo } from './resume-copy';
import { setCatalogue, missingKeys } from '../i18n/t';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';

const NOW = 1_790_000_000_000;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function deps(view: ResumeView, over: Partial<ResumeRowDeps> = {}): ResumeRowDeps & { view: ResumeView } {
  const d: ResumeRowDeps & { view: ResumeView } = {
    view,
    read: (): ResumeView => d.view,
    nameOf: (id: string) => (id === 'tel_marum_2_foothold' ? 'Tel Marum II' : undefined),
    resume: vi.fn(),
    discard: vi.fn(() => { d.view = { state: 'none' }; return true; }),
    now: () => NOW,
    ...over,
  };
  return d;
}
const ready = (over: Partial<Extract<ResumeView, { state: 'ready' }>> = {}): ResumeView => ({ state: 'ready', missionId: 'tel_marum_2_foothold', savedAt: NOW - 14 * 60_000, simTick: 5200, ...over });

afterEach(() => {
  closeOpenDialog();
  document.body.replaceChildren();
  setCatalogue('en', en);
});

describe('the Resume row', () => {
  it('draws nothing when there is nothing to resume', () => {
    expect(resumeRow(deps({ state: 'none' })).el).toBeNull();
  });

  it('names the mission, when it was saved and the mission clock, with Resume and Discard', () => {
    const row = resumeRow(deps(ready()));
    document.body.append(row.el!);
    expect(row.el!.querySelector('.rl-resume__line')?.textContent).toBe('Tel Marum II · saved 14 minutes ago · at 4:20');
    expect(row.el!.querySelector<HTMLElement>('[data-act="resume"]')?.textContent).toBe('Resume Tel Marum II');
    expect(row.el!.querySelector('[data-act="discard"]')?.textContent).toBe('Discard save');
    expect(missingKeys()).toEqual([]);
  });

  it('a mission the board does not know is named by its id, not blank', () => {
    const row = resumeRow(deps(ready({ missionId: 'some_new_mission' })));
    expect(row.el!.querySelector('.rl-resume__line')?.textContent).toContain('some_new_mission');
  });

  it('Resume opens the saved mission, asking the store again first', () => {
    const d = deps(ready());
    const row = resumeRow(d);
    row.el!.querySelector<HTMLButtonElement>('[data-act="resume"]')!.click();
    expect(d.resume).toHaveBeenCalledWith('tel_marum_2_foothold');
  });

  it('Resume on a save that has gone since the row was drawn does not navigate: the row repaints', () => {
    const d = deps(ready());
    const row = resumeRow(d);
    d.view = { state: 'none' };
    row.el!.querySelector<HTMLButtonElement>('[data-act="resume"]')!.click();
    expect(d.resume).not.toHaveBeenCalled();
    expect(row.el!.isConnected).toBe(false);
  });

  it('a save that will not load says why in words and offers Discard alone; the reason code is never shown', () => {
    for (const reason of ['older_version', 'mission_unknown', 'damaged', 'world_mismatch', 'unreadable', 'moved'] as const) {
      const row = resumeRow(deps({ state: 'refused', reason }));
      const text = row.el!.textContent ?? '';
      expect(text, reason).toContain(resumeRefusalText(reason));
      expect(text, reason).not.toMatch(/older_version|mission_unknown|world_mismatch|unreadable|moved/); // the internal ids; "damaged" is also a plain word, so it is not in this list
      expect(row.el!.querySelector('[data-act="resume"]'), reason).toBeNull();
      expect(row.el!.querySelector('[data-act="discard"]'), reason).not.toBeNull();
    }
  });

  it('a resume that was tried and failed keeps Resume and says so', () => {
    const row = resumeRow(deps(ready({ note: 'failed' })));
    expect(row.el!.querySelector('[data-act="resume"]')).not.toBeNull();
    expect(row.el!.querySelector('.rl-resume__msg')?.textContent).toBe('The save could not be resumed. It is kept: try again, or discard it.');
  });
});

describe('Discard', () => {
  it('asks first; a yes removes the save and the row; a no keeps both', async () => {
    const d = deps(ready());
    const row = resumeRow(d);
    document.body.append(row.el!);
    row.el!.querySelector<HTMLButtonElement>('[data-act="discard"]')!.click();
    expect(isDialogOpen()).toBe(true);
    document.querySelector<HTMLButtonElement>('.rl-confirm [data-act="cancel"], .rl-confirm .rl-btn:not([data-kind="danger"])')?.click();
    await flush();
    expect(d.discard).not.toHaveBeenCalled();
    expect(row.el!.isConnected).toBe(true);
  });

  it('a yes discards, and the row goes', async () => {
    const d = deps(ready());
    const row = resumeRow(d);
    document.body.append(row.el!);
    row.el!.querySelector<HTMLButtonElement>('[data-act="discard"]')!.click();
    const yes = [...document.querySelectorAll<HTMLButtonElement>('.rl-confirm button')].find((b) => b.textContent === 'Discard');
    yes!.click();
    await flush();
    expect(d.discard).toHaveBeenCalledTimes(1);
    expect(row.el!.isConnected).toBe(false);
  });

  it('a browser that refuses the removal is told so, and the row stays', async () => {
    const d = deps(ready(), { discard: vi.fn(() => false) });
    const row = resumeRow(d);
    document.body.append(row.el!);
    row.el!.querySelector<HTMLButtonElement>('[data-act="discard"]')!.click();
    [...document.querySelectorAll<HTMLButtonElement>('.rl-confirm button')].find((b) => b.textContent === 'Discard')!.click();
    await flush();
    expect(row.el!.querySelector('.rl-resume__msg')?.textContent).toBe('This browser would not let the save go. Try again.');
    expect(row.el!.isConnected).toBe(true);
  });

  it('the disposer contract: leaving closes the dialog, and a late answer after dispose touches nothing', async () => {
    const d = deps(ready());
    const row = resumeRow(d);
    document.body.append(row.el!);
    row.el!.querySelector<HTMLButtonElement>('[data-act="discard"]')!.click();
    expect(isDialogOpen()).toBe(true);
    row.dispose();
    await flush();
    expect(isDialogOpen()).toBe(false);
    expect(d.discard).not.toHaveBeenCalled();
    expect(row.el!.isConnected).toBe(false);
  });
});

describe('the words', () => {
  it('the clock and the age read as a player would say them', () => {
    expect(clockOfTicks(5200)).toBe('4:20');
    expect(clockOfTicks(0)).toBe('0:00');
    expect(savedAgo(NOW - 20_000, NOW)).toBe('just now');
    expect(savedAgo(NOW - 60_000, NOW)).toBe('1 minute ago');
    expect(savedAgo(NOW - 59 * 60_000, NOW)).toBe('59 minutes ago');
    expect(savedAgo(NOW - 3 * 3_600_000, NOW)).toBe('3 hours ago');
    expect(savedAgo(NOW - 5 * 86_400_000, NOW)).toBe('5 days ago');
    expect(savedAgo(NOW + 5_000, NOW)).toBe('just now'); // a clock set back never reads "-1 minutes ago"
  });

  it('?pseudo=1: every string of the row is bracketed, so none bypassed t()', () => {
    setCatalogue('pseudo', en, pseudo);
    const row = resumeRow(deps(ready({ note: 'failed' })));
    for (const el of row.el!.querySelectorAll('.rl-resume__lead, .rl-resume__line, button, .rl-resume__msg')) {
      expect(el.textContent, el.className).toMatch(/^⟦[\s\S]*⟧$/);
    }
  });

  it('a save failure is worded for each way it can fail, and never as the code', () => {
    for (const reason of ['encode_failed', 'too_large', 'no_storage', 'refused', 'unverified'] as const) {
      const text = saveFailureText(reason);
      expect(text.length, reason).toBeGreaterThan(20);
      expect(text, reason).not.toMatch(/encode_failed|too_large|no_storage|unverified/);
    }
    expect(saveFailureText('refused')).toBe(saveFailureText('unverified'));
  });
});
