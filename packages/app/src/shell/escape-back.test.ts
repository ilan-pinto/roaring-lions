// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installEscapeBack } from './escape-back';
import { footBack, screenFoot } from '../ui/foot';
import { confirmDialog, closeOpenDialog, isDialogOpen } from '../ui/confirm';

/** A stage holding one screen with a `footBack` way back, the way every shell
 *  screen builds it since GH-498. */
function stageWithBack(): { stage: HTMLElement; clicks: string[] } {
  const stage = document.createElement('div');
  const foot = screenFoot();
  const back = footBack('Main menu', '/');
  const clicks: string[] = [];
  back.addEventListener('click', (e) => {
    e.preventDefault();
    clicks.push('back');
  });
  foot.start.appendChild(back);
  stage.appendChild(foot.el);
  document.body.appendChild(stage);
  return { stage, clicks };
}

const esc = (init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  closeOpenDialog();
  document.body.replaceChildren();
});

describe('Escape goes back on shell screens (KS-07)', () => {
  it('presses the screen’s own back control on every shell screen', () => {
    for (const route of ['campaign', 'brigade', 'free-play', 'settings', 'saves', 'credits']) {
      const { stage, clicks } = stageWithBack();
      dispose = installEscapeBack({ route: () => route, stage, dialogOpen: () => isDialogOpen() });
      const ev = esc();
      document.body.dispatchEvent(ev);
      expect(clicks, route).toEqual(['back']);
      expect(ev.defaultPrevented).toBe(true);
      dispose();
      dispose = null;
      stage.remove();
    }
  });

  it('does nothing on the menu, a mission or a sandbox', () => {
    for (const route of ['menu', 'mission', 'sandbox', null]) {
      const { stage, clicks } = stageWithBack();
      dispose = installEscapeBack({ route: () => route, stage, dialogOpen: () => isDialogOpen() });
      const ev = esc();
      document.body.dispatchEvent(ev);
      expect(clicks, String(route)).toEqual([]);
      expect(ev.defaultPrevented).toBe(false);
      dispose();
      dispose = null;
      stage.remove();
    }
  });

  it('leaves Escape to an open dialog', () => {
    const { stage, clicks } = stageWithBack();
    dispose = installEscapeBack({ route: () => 'saves', stage, dialogOpen: () => isDialogOpen() });
    void confirmDialog(stage, { title: 'Load?', body: 'Sure?', confirm: 'Load' }).answer;
    expect(isDialogOpen()).toBe(true);
    document.body.dispatchEvent(esc());
    expect(clicks).toEqual([]);
  });

  it('leaves a key another listener spent, a held key and a text field alone', () => {
    const { stage, clicks } = stageWithBack();
    dispose = installEscapeBack({ route: () => 'saves', stage, dialogOpen: () => false });
    const spent = esc();
    spent.preventDefault();
    document.body.dispatchEvent(spent);
    document.body.dispatchEvent(esc({ repeat: true }));
    const field = document.createElement('input');
    field.type = 'text';
    stage.appendChild(field);
    field.dispatchEvent(esc());
    expect(clicks).toEqual([]);
    // a select or a button is not a text field: Escape there still goes back
    const btn = document.createElement('button');
    stage.appendChild(btn);
    btn.dispatchEvent(esc());
    expect(clicks).toEqual(['back']);
  });

  it('lets go when disposed', () => {
    const { stage, clicks } = stageWithBack();
    installEscapeBack({ route: () => 'saves', stage, dialogOpen: () => false })();
    document.body.dispatchEvent(esc());
    expect(clicks).toEqual([]);
  });
});
