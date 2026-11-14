// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultAvatar, avatarPresets, type AvatarView } from '@lions/data';
import type { AccountError } from '../account/client';
import { avatarPicker, type AvatarPickerDeps } from './avatar-picker';
import { closeOpenDialog, isDialogOpen } from './confirm';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const PUBLIC_ID = 'ABCD2345';
const chosen = (id: string): AvatarView => ({ kind: 'preset', id, chosen: true });

function open(over: Partial<AvatarPickerDeps> = {}) {
  const sent: (string | null)[] = [];
  const saved: (string | null)[] = [];
  let closes = 0;
  const handle = avatarPicker(document.body, {
    current: chosen('crest-lion'),
    publicId: PUBLIC_ID,
    save: async (id) => (sent.push(id), 'ok'),
    onSaved: (id) => void saved.push(id),
    onClose: () => void closes++,
    ...over,
  });
  return { handle, sent, saved, closes: () => closes };
}
const tiles = (): HTMLButtonElement[] => [...document.body.querySelectorAll<HTMLButtonElement>('.rl-avatar-picker__tile')];
const checked = (): string | undefined => tiles().find((x) => x.getAttribute('aria-checked') === 'true')?.dataset.preset;
const key = (target: Element | Window, k: string): void => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const saveBtn = (): HTMLButtonElement => document.body.querySelector('.rl-avatar-picker__save') as HTMLButtonElement;

afterEach(() => {
  closeOpenDialog();
  document.body.replaceChildren();
});

describe('the avatar picker sheet (GH-1075 P6)', () => {
  it('is a modal dialog on the body with every crest as a radio, the current one checked and focused', () => {
    open();
    const scrim = document.body.querySelector('.rl-avatar-picker');
    expect(scrim?.getAttribute('role')).toBe('dialog');
    expect(scrim?.getAttribute('aria-modal')).toBe('true');
    const label = scrim?.getAttribute('aria-labelledby');
    expect(label && document.getElementById(label)?.textContent).toBe('Choose your avatar');
    expect(isDialogOpen()).toBe(true);
    expect(tiles()).toHaveLength(avatarPresets.filter((x) => x.family === 'crest').length);
    expect(tiles().every((x) => x.getAttribute('role') === 'radio' && x.getAttribute('aria-label') !== null)).toBe(true);
    expect(checked()).toBe('crest-lion');
    expect(document.activeElement).toBe(tiles().find((x) => x.dataset.preset === 'crest-lion'));
    expect(document.body.querySelectorAll('.rl-avatar-picker__tag')).toHaveLength(1); // only the default carries the tag
  });

  it('the arrow keys move the selection (wrapping) and send nothing', () => {
    const { sent } = open();
    const order = tiles().map((x) => x.dataset.preset);
    const at = order.indexOf('crest-lion');
    key(document.activeElement as Element, 'ArrowRight');
    expect(checked()).toBe(order[at + 1]);
    key(document.activeElement as Element, 'ArrowLeft');
    key(document.activeElement as Element, 'ArrowLeft');
    expect(checked()).toBe(order[at - 1]);
    expect(document.activeElement).toBe(tiles().find((x) => x.dataset.preset === order[at - 1]));
    while (checked() !== order[0]) key(document.activeElement as Element, 'ArrowLeft');
    key(document.activeElement as Element, 'ArrowLeft');
    expect(checked()).toBe(order[order.length - 1]); // wraps
    expect(sent).toEqual([]);
  });

  it('Escape closes it and a click on the scrim does too', () => {
    const a = open();
    key(window, 'Escape');
    expect(document.body.querySelector('.rl-avatar-picker')).toBeNull();
    expect(isDialogOpen()).toBe(false);
    expect(a.closes()).toBe(1);
    open();
    (document.body.querySelector('.rl-avatar-picker') as HTMLElement).click();
    expect(document.body.querySelector('.rl-avatar-picker')).toBeNull();
  });

  it('Save sends the chosen id once, however many times it is pressed, then closes', async () => {
    const { sent, saved } = open();
    key(document.activeElement as Element, 'ArrowRight');
    const want = checked();
    saveBtn().click();
    saveBtn().click();
    await flush();
    expect(sent).toEqual([want]);
    expect(saved).toEqual([want]);
    expect(document.body.querySelector('.rl-avatar-picker')).toBeNull();
  });

  it('Use my default sends null, and a later pick sends the id again', async () => {
    const a = open();
    (document.body.querySelector('.rl-avatar-picker__default') as HTMLButtonElement).click();
    expect(checked()).toBe(defaultAvatar(PUBLIC_ID));
    saveBtn().click();
    await flush();
    expect(a.sent).toEqual([null]);
    const b = open();
    (document.body.querySelector('.rl-avatar-picker__default') as HTMLButtonElement).click();
    tiles().find((x) => x.dataset.preset === 'crest-wave')?.click();
    saveBtn().click();
    await flush();
    expect(b.sent).toEqual(['crest-wave']);
  });

  it('a failed save stays open with the error in the sheet, and can be tried again', async () => {
    let n = 0;
    const fail: AccountError = { error: 'network', status: 0 };
    const sent: (string | null)[] = [];
    const { saved } = open({ save: async (id) => (sent.push(id), ++n === 1 ? fail : 'ok') });
    saveBtn().click();
    await flush();
    expect(document.body.querySelector('.rl-avatar-picker')).not.toBeNull();
    expect(document.body.querySelector('.rl-avatar-picker__status')?.textContent).toBe('That did not work. Try again in a minute.');
    expect(saved).toEqual([]);
    saveBtn().click();
    await flush();
    expect(sent).toHaveLength(2);
    expect(document.body.querySelector('.rl-avatar-picker')).toBeNull();
  });

  it('closeOpenDialog() takes it down (the router and the battlefield call it), once', () => {
    const a = open();
    closeOpenDialog();
    expect(document.body.querySelector('.rl-avatar-picker')).toBeNull();
    a.handle.close();
    expect(a.closes()).toBe(1);
  });

  it('a save that settles after the sheet was closed does nothing', async () => {
    let release: (v: 'ok') => void = () => {};
    const { handle, saved } = open({ save: () => new Promise<'ok'>((r) => (release = r)) });
    saveBtn().click();
    handle.close();
    release('ok');
    await flush();
    expect(saved).toEqual([]);
  });

  it('game keys do not pass the sheet; the capture guard keeps them from the window', () => {
    open();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    key(document.activeElement as Element, 'h');
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });
});
