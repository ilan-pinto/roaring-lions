// @vitest-environment jsdom
// The main menu's feedback modal (GH-464): a `.rl-confirm`-family dialog that
// the router's `closeOpenDialog()` takes down, and that yields every key to
// its text field (D18).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeOpenDialog, isDialogOpen } from './confirm';
import { feedbackDialog } from './feedback-dialog';

const deps = () => ({ who: { anonymous: true }, build: '0.122.0', storage: null, send: vi.fn(async () => ({ kind: 'dry-run' as const })) });
afterEach(() => document.body.replaceChildren());

describe('feedbackDialog', () => {
  it('is a modal dialog with the form and no picture or replay', () => {
    feedbackDialog(document.body, deps());
    const dlg = document.querySelector('.rl-feedback-dialog');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(isDialogOpen()).toBe(true);
    expect(dlg?.querySelector('.rl-feedback__thumb')).toBeNull();
    expect(dlg?.querySelector('.rl-feedback__contact')).not.toBeNull();
    expect(document.activeElement?.classList.contains('rl-feedback__kind')).toBe(true);
  });

  it('is taken down by closeOpenDialog, listeners and all', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    feedbackDialog(document.body, deps());
    const keyAdds = add.mock.calls.filter((c) => c[0] === 'keydown');
    expect(keyAdds.length).toBeGreaterThanOrEqual(3);
    closeOpenDialog();
    expect(document.querySelector('.rl-feedback-dialog')).toBeNull();
    for (const [type, fn, opt] of keyAdds) {
      expect(remove.mock.calls.some((c) => c[0] === type && c[1] === fn && c[2] === opt)).toBe(true);
    }
    add.mockRestore();
    remove.mockRestore();
  });

  it('lets no typed key reach the page under it, and Escape closes it', () => {
    feedbackDialog(document.body, deps());
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    const text = document.querySelector<HTMLTextAreaElement>('.rl-feedback__text');
    for (const key of ['w', 'h', 'Enter', 'ArrowLeft']) text?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(reached).not.toHaveBeenCalled();
    text?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', reached);
    expect(document.querySelector('.rl-feedback-dialog')).toBeNull();
  });
});
