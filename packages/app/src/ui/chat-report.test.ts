// @vitest-environment jsdom
// GH-1417 S3 (D6, D7, D9): the report dialog.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SendResult } from '../feedback/client';
import { closeOpenDialog } from './confirm';
import { openChatReport, reportDialog, type ChatReportPort, type ReportDialogDeps } from './chat-report';
import { ChatInbox } from './chat-inbox';
import { createBlockList } from '../chat/block-list';

const q = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const NAMES = { 0: 'Me', 1: 'Them' } as const;
const LINES = [{ seat: 1 as const, text: '<b>rude</b>' }, { seat: 0 as const, text: 'stop' }];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function open(submit: ReportDialogDeps['submit'] = vi.fn(async () => ({ kind: 'sent', ref: 'FB-1' }) as SendResult)) {
  const handle = reportDialog(document.body, { reportedName: 'Them', lines: LINES, nameOf: (s) => NAMES[s], submit });
  return { handle, submit };
}
const pick = (reason: string): void => {
  const box = document.querySelector<HTMLInputElement>(`input[value="${reason}"]`)!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => {
  closeOpenDialog();
  document.body.replaceChildren();
});

describe('reportDialog', () => {
  it('is a modal dialog; Send stays disabled until a reason is chosen', () => {
    open();
    expect(q('.rl-report-dialog').getAttribute('role')).toBe('dialog');
    expect(q('.rl-report-dialog').getAttribute('aria-modal')).toBe('true');
    const send = q<HTMLButtonElement>('.rl-report__send');
    expect(send.disabled).toBe(true);
    pick('abuse');
    expect(send.disabled).toBe(false);
  });

  it('shows exactly the lines it will send, as text and never as markup, and says no account goes with them', () => {
    open();
    const items = [...document.querySelectorAll('.rl-report__line')].map((e) => e.textContent);
    expect(items).toEqual(['Them: <b>rude</b>', 'Me: stop']);
    expect(document.querySelector('.rl-report__line b')).toBeNull();
    expect(q('.rl-report__sends').textContent).toMatch(/Nothing identifies you but a session id/);
    expect(q('.rl-report__sends summary').textContent).toContain('2 messages');
  });

  it('sends the chosen reason and note, then says it was sent and that nothing happens automatically (D9)', async () => {
    const { submit } = open();
    pick('hate');
    q<HTMLTextAreaElement>('.rl-report__note').value = 'kept going';
    q<HTMLButtonElement>('.rl-report__send').click();
    expect(submit).toHaveBeenCalledWith('hate', 'kept going', expect.any(AbortSignal));
    await flush();
    expect(q('.rl-report__result').hidden).toBe(false);
    expect(q('.rl-report__result-title').textContent).toBe('Report sent');
    expect(q('.rl-report').hidden).toBe(true);
    expect(document.body.textContent).toMatch(/Nothing happens to the other player automatically/);
  });

  it('a second click while sending sends nothing more', () => {
    const submit = vi.fn(() => new Promise<SendResult>(() => undefined));
    open(submit);
    pick('spam');
    q<HTMLButtonElement>('.rl-report__send').click();
    q<HTMLButtonElement>('.rl-report__send').click();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(q<HTMLButtonElement>('.rl-report__send').disabled).toBe(true);
  });

  it('answers each result kind in words, and offers Try again after a busy or failed one with the form kept', async () => {
    const cases: [SendResult, RegExp, boolean][] = [
      [{ kind: 'dry-run' }, /does not send reports/, false],
      [{ kind: 'closed' }, /Reports are closed/, false],
      [{ kind: 'busy', retryAfter: 42 }, /Try again in 42 s/, true],
      [{ kind: 'failed', status: 500 }, /may not have been sent/, true],
    ];
    for (const [result, text, retry] of cases) {
      document.body.replaceChildren();
      closeOpenDialog();
      open(async () => result);
      pick('other');
      q<HTMLTextAreaElement>('.rl-report__note').value = 'keep me';
      q<HTMLButtonElement>('.rl-report__send').click();
      await flush();
      expect(q('.rl-report__result').textContent, result.kind).toMatch(text);
      const buttons = [...document.querySelectorAll('.rl-report__result button')];
      expect(buttons.length === 2, result.kind).toBe(retry);
      if (retry) {
        (buttons[0] as HTMLButtonElement).click();
        expect(q('.rl-report').hidden).toBe(false);
        expect(q<HTMLTextAreaElement>('.rl-report__note').value).toBe('keep me');
        expect(document.querySelector<HTMLInputElement>('input[value="other"]')!.checked).toBe(true);
      }
    }
  });

  it('a rejected send reads as failed, not as a thrown error', async () => {
    open(async () => { throw new Error('network'); });
    pick('abuse');
    q<HTMLButtonElement>('.rl-report__send').click();
    await flush();
    expect(q('.rl-report__result').textContent).toMatch(/may not have been sent/);
  });

  it('Escape, Cancel and the scrim close it; closing aborts a send in flight and nothing completes into the DOM afterwards', async () => {
    let signal: AbortSignal | undefined;
    let resolve: ((r: SendResult) => void) | undefined;
    const submit = vi.fn((_r: string, _n: string, s: AbortSignal) => { signal = s; return new Promise<SendResult>((res) => { resolve = res; }); });
    open(submit);
    pick('abuse');
    // the nodes outlive the dialog in the test's hands, so a late write into them would be seen even though they are detached
    const result = q('.rl-report__result');
    const sendBtn = q<HTMLButtonElement>('.rl-report__send');
    q<HTMLButtonElement>('.rl-report__send').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.rl-report-dialog')).toBeNull();
    expect(signal?.aborted).toBe(true);
    resolve?.({ kind: 'sent', ref: 'FB-2' });
    await flush();
    expect(document.querySelector('.rl-report-dialog')).toBeNull();
    expect(document.querySelector('.rl-report__result')).toBeNull();
    expect(result.hidden).toBe(true);
    expect(result.childElementCount).toBe(0);
    expect(sendBtn.textContent).toBe('Sending…');

    open();
    q<HTMLButtonElement>('.rl-report__cancel').click();
    expect(document.querySelector('.rl-report-dialog')).toBeNull();
    open();
    q('.rl-report-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.rl-report-dialog')).toBeNull();
  });

  it('close is idempotent and removes both window key listeners (a key after close does nothing and throws nothing)', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { handle } = open();
    const keyAdds = add.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(keyAdds).toBeGreaterThanOrEqual(2);
    handle.close();
    handle.close();
    // every keydown listener added on window while open (the dialog's two, the focus trap's) is removed, once each
    expect(remove.mock.calls.filter((c) => c[0] === 'keydown')).toHaveLength(keyAdds);
    add.mockRestore();
    remove.mockRestore();
  });

  it('closeOpenDialog (the router\'s unmount) takes it down', () => {
    open();
    closeOpenDialog();
    expect(document.querySelector('.rl-report-dialog')).toBeNull();
  });

  it('keeps game keys out while open, but lets Escape, Enter and Tab through', () => {
    open();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const press = (key: string): void => { q('.rl-report__lede').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); };
    press('w');
    expect(seen).not.toHaveBeenCalled();
    press('Tab');
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', seen);
  });
});

describe('openChatReport', () => {
  const setup = (publicId: string | null) => {
    const inbox = new ChatInbox(() => true);
    inbox.useWho({ blocks: createBlockList(null), publicIdOf: (s) => (s === 1 ? publicId : null) });
    inbox.deliver(1, 'rude', () => undefined);
    inbox.deliver(0, 'stop', () => undefined);
    const send = vi.fn(async () => ({ kind: 'sent', ref: 'FB-3' }) as SendResult);
    openChatReport({ host: document.body, port: { offered: () => true, send }, inbox, seat: 0, peer: 1, nameOf: (s) => NAMES[s], map: 'wadi_tarfan_l' });
    pick('threat');
    q<HTMLButtonElement>('.rl-report__send').click();
    return send;
  };

  it('sends the inbox\'s own copy, the seats, the map, and a MEMBER\'s public id', () => {
    const send = setup('ABCDEFG1');
    expect(send).toHaveBeenCalledWith(
      { seat: 0, reportedSeat: 1, reason: 'threat', note: '', lines: [{ seat: 1, text: 'rude' }, { seat: 0, text: 'stop' }], reportedPublicId: 'ABCDEFG1', map: 'wadi_tarfan_l' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('names no public id for a guest', () => {
    const send = setup(null);
    const first = send.mock.calls[0] as unknown as [{ reportedPublicId: string | null }];
    expect(first[0].reportedPublicId).toBeNull();
  });
});

// Review items 1, 2 and 4, and the design's automatic mute.
describe('the dialog works on one snapshot (review items 1, 2, 4; design 3.4)', () => {
  const mk = (preview?: (t: string) => string | null) => {
    const inbox = new ChatInbox(() => true);
    inbox.useWho({ blocks: createBlockList(null), publicIdOf: (s) => (s === 1 ? 'ABCDEFG1' : null) });
    if (preview !== undefined) inbox.useOptions({ preview });
    return inbox;
  };
  const open2 = (inbox: ChatInbox, send: ChatReportPort['send'] | ReturnType<typeof vi.fn>) =>
    openChatReport({ host: document.body, port: { offered: () => true, send: send as ChatReportPort['send'] }, inbox, seat: 0, peer: 1, nameOf: (s) => NAMES[s], map: 'wadi_tarfan_l' });
  const sentLines = (send: ReturnType<typeof vi.fn>, call = 0): string[] =>
    ((send.mock.calls[call] as [{ lines: { text: string }[] }])[0].lines).map((l) => l.text);

  it('a line that arrives while the dialog is open is not sent, and does not push out a line the reporter chose', async () => {
    const inbox = mk();
    for (let i = 0; i < 10; i++) inbox.deliver(1, `old ${i}`, () => undefined);
    const send = vi.fn(async () => ({ kind: 'sent', ref: 'FB-1' }) as SendResult);
    open2(inbox, send);
    const shown = [...document.querySelectorAll('.rl-report__line')].map((e) => e.textContent);
    inbox.deliver(1, 'arrived after open', () => undefined);
    pick('abuse');
    q<HTMLButtonElement>('.rl-report__send').click();
    await flush();
    expect(sentLines(send)).toEqual(Array.from({ length: 10 }, (_, i) => `old ${i}`));
    expect(shown).toEqual(Array.from({ length: 10 }, (_, i) => `Them: old ${i}`));
  });

  it('a retry sends the SAME lines as the first try, not the ring as it is by then', async () => {
    const inbox = mk();
    inbox.deliver(1, 'one', () => undefined);
    const send = vi.fn()
      .mockResolvedValueOnce({ kind: 'failed', status: 500 } as SendResult)
      .mockResolvedValueOnce({ kind: 'sent', ref: 'FB-2' } as SendResult);
    open2(inbox, send);
    pick('abuse');
    q<HTMLButtonElement>('.rl-report__send').click();
    await flush();
    inbox.deliver(1, 'two', () => undefined);
    (document.querySelectorAll('.rl-report__result button')[0] as HTMLButtonElement).click();
    q<HTMLButtonElement>('.rl-report__send').click();
    await flush();
    expect(sentLines(send, 0)).toEqual(['one']);
    expect(sentLines(send, 1)).toEqual(['one']);
  });

  it('says so, before sending, when the oldest lines are left out to fit the size cap, and shows only what is sent', () => {
    const inbox = mk();
    for (let i = 0; i < 10; i++) inbox.deliver(1, `${i}`.repeat(1) + '漢'.repeat(279), () => undefined);
    open2(inbox, vi.fn());
    const shown = document.querySelectorAll('.rl-report__line').length;
    expect(shown).toBeLessThan(10);
    const note = q('.rl-report__trimmed').textContent ?? '';
    expect(note).toMatch(new RegExp(`${10 - shown} oldest messages are left out so the report fits|oldest message is left out`));
    expect(q('.rl-report__sends summary').textContent).toContain(`${shown} messages`);
  });

  it('shows no notice when nothing was left out', () => {
    const inbox = mk();
    inbox.deliver(1, 'short', () => undefined);
    open2(inbox, vi.fn());
    expect(document.querySelector('.rl-report__trimmed')).toBeNull();
  });

  it('does not show a line the player\'s own filter hid, but sends it as evidence and says it is sent', async () => {
    const inbox = mk((t) => (t.includes('SLUR') ? null : t));
    inbox.deliver(1, 'a SLUR here', () => undefined);
    inbox.deliver(1, 'fine', () => undefined);
    const send = vi.fn(async () => ({ kind: 'sent', ref: 'FB-3' }) as SendResult);
    open2(inbox, send);
    const shown = [...document.querySelectorAll('.rl-report__line')].map((e) => e.textContent);
    expect(shown).toEqual(['Them: [hidden by your word filter; still sent]', 'Them: fine']);
    expect(document.body.textContent).not.toContain('SLUR');
    pick('hate');
    q<HTMLButtonElement>('.rl-report__send').click();
    await flush();
    expect(sentLines(send)).toEqual(['a SLUR here', 'fine']);
  });

  it('a report the server stored mutes the reported seat for the rest of the room; nothing else does', async () => {
    for (const [result, muted] of [
      [{ kind: 'sent', ref: 'FB-4' }, true],
      [{ kind: 'dry-run' }, false],
      [{ kind: 'closed' }, false],
      [{ kind: 'busy', retryAfter: 9 }, false],
      [{ kind: 'failed', status: 500 }, false],
    ] as [SendResult, boolean][]) {
      document.body.replaceChildren();
      closeOpenDialog();
      const inbox = mk();
      inbox.deliver(1, 'rude', () => undefined);
      open2(inbox, vi.fn(async () => result));
      expect(inbox.isMuted(1)).toBe(false);
      pick('abuse');
      q<HTMLButtonElement>('.rl-report__send').click();
      await flush();
      expect(inbox.isMuted(1), result.kind).toBe(muted);
      expect(inbox.isMuted(0), result.kind).toBe(false);
    }
  });

  it('keeps each preview with ITS line after the oldest are left out for size (a hidden line stays hidden at its own place)', () => {
    const inbox = mk((t) => (t.includes('NEWEST') ? null : t));
    for (let i = 0; i < 9; i++) inbox.deliver(1, `${i}` + '漢'.repeat(279), () => undefined);
    inbox.deliver(1, 'NEWEST' + '漢'.repeat(274), () => undefined);
    open2(inbox, vi.fn());
    const items = [...document.querySelectorAll('.rl-report__line')].map((e) => e.textContent ?? '');
    expect(items.length).toBeLessThan(10);
    expect(items[items.length - 1]).toBe('Them: [hidden by your word filter; still sent]');
    expect(items.slice(0, -1).every((x) => x.includes('漢'))).toBe(true);
  });
});

