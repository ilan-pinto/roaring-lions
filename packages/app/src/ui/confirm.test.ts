// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { confirmDialog } from './confirm';

describe('confirmDialog', () => {
  it('resolves false on Escape and true on the confirm button, and removes itself either way', async () => {
    const host = document.createElement('div');
    const p = confirmDialog(host, {
      title: 'Leave the fight?',
      body: 'This attempt is lost.',
      confirm: 'Leave',
      danger: true,
    });
    expect(host.querySelector('.rl-confirm')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('.rl-confirm__yes')?.click();
    await expect(p).resolves.toBe(true);
    expect(host.querySelector('.rl-confirm')).toBeNull();

    const q = confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(q).resolves.toBe(false);
    expect(host.querySelector('.rl-confirm')).toBeNull();
  });

  it('focuses Cancel, so an Enter that was meant for the game does not confirm', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    void confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
    expect(document.activeElement?.classList.contains('rl-confirm__no')).toBe(true);
  });

  it('names what is lost in the body, and stamps the danger colour on the confirm button', () => {
    const host = document.createElement('div');
    void confirmDialog(host, {
      title: 'Start the campaign over?',
      body: 'Your campaign progress, brigade account and tutorial completion are erased.',
      confirm: 'Erase and restart',
      danger: true,
    });
    expect(host.textContent).toContain('Your campaign progress, brigade account and tutorial completion are erased.');
    const yes = host.querySelector<HTMLButtonElement>('.rl-confirm__yes')!;
    expect(yes.textContent).toBe('Erase and restart');
    expect(yes.dataset.danger).toBe('1');
  });

  it('cancels on a click outside the panel, and does not cancel on a click inside it', async () => {
    const host = document.createElement('div');
    const p = confirmDialog(host, { title: 't', body: 'Clicking here must not cancel.', confirm: 'c' });
    const scrim = host.querySelector<HTMLElement>('.rl-confirm')!;
    const body = host.querySelector<HTMLElement>('.rl-confirm__body')!;
    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Still up: the click landed on the panel, not the scrim itself.
    expect(host.querySelector('.rl-confirm')).not.toBeNull();
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(p).resolves.toBe(false);
  });

  it('has no danger attribute on the confirm button when the action is not destructive', () => {
    const host = document.createElement('div');
    void confirmDialog(host, { title: 't', body: 'b', confirm: 'c' });
    const yes = host.querySelector<HTMLButtonElement>('.rl-confirm__yes')!;
    expect(yes.dataset.danger).toBeUndefined();
  });
});
