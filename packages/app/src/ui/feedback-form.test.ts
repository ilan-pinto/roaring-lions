// @vitest-environment jsdom
// The feedback form (GH-464, mocks 02-04): its states, its attachments, its
// keys, and its disposer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedbackForm, type FeedbackFormDeps, type FormSubmission } from './feedback-form';
import { forgetDraftForTest, DRAFT_KEY } from '../feedback/draft';
import type { SendResult } from '../feedback/client';
import type { StorageLike } from '../telemetry/identity';

const store = (): StorageLike & { d: Record<string, string> } => {
  const d: Record<string, string> = {};
  return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
};
const pic = { blob: new Blob([new Uint8Array(46 * 1024)], { type: 'image/webp' }), width: 1280, height: 720, quality: 0.75 };

function deps(o: Partial<FeedbackFormDeps> = {}) {
  const sent: FormSubmission[] = [];
  const d: FeedbackFormDeps = {
    source: 'pause',
    who: { tester: 'dana', anonymous: false },
    build: '0.122.0',
    where: { mission: 'Beit Sahwan II', clock: '0:27' },
    picture: async () => pic,
    replay: { available: () => true, approxBytes: () => 4 * 1024, log: () => '{"v":1}' },
    send: vi.fn(async (s: FormSubmission): Promise<SendResult> => {
      sent.push(s);
      return { kind: 'sent', ref: 'FB-0042' };
    }),
    storage: store(),
    onBack: vi.fn(),
    onCancel: vi.fn(),
    objectUrl: { create: () => 'blob:thumb', revoke: vi.fn() },
    ...o,
  };
  return { d, sent };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const q = <T extends Element>(sel: string): T => {
  const e = document.querySelector<T>(sel);
  if (!e) throw new Error(`no ${sel}`);
  return e;
};
const type = (text: string): void => {
  const ta = q<HTMLTextAreaElement>('.rl-feedback__text');
  ta.value = text;
  ta.dispatchEvent(new Event('input'));
};
const kind = (k: string): void => q<HTMLButtonElement>(`.rl-feedback__kind[data-kind="${k}"]`).click();

beforeEach(() => forgetDraftForTest());
afterEach(() => document.body.replaceChildren());

describe('feedbackForm', () => {
  it('keeps Send disabled until a kind is chosen and something is written', async () => {
    const { d } = deps();
    feedbackForm(document.body, d);
    await flush();
    const send = q<HTMLButtonElement>('.rl-feedback__send');
    expect(send.disabled).toBe(true);
    expect(q('.rl-feedback').getAttribute('data-state')).toBe('empty');
    kind('bug');
    expect(send.disabled).toBe(true);
    type('   ');
    expect(send.disabled).toBe(true);
    type('It walked to the far wall.');
    expect(send.disabled).toBe(false);
    expect(q('.rl-feedback__count').textContent).toBe('26 / 2000');
  });

  it('attaches the picture by default and shows exactly what is sent', async () => {
    const { d, sent } = deps();
    feedbackForm(document.body, d);
    await flush();
    const thumb = q<HTMLImageElement>('.rl-feedback__thumb');
    expect(thumb.hidden).toBe(false);
    expect(thumb.getAttribute('src')).toBe('blob:thumb');
    const box = q<HTMLInputElement>('.rl-feedback__check input');
    expect(box.checked).toBe(true);
    kind('idea');
    type('more smoke');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    await flush();
    expect(sent[0].shot).toBe(pic.blob);
  });

  it('offers the replay for a Bug only, ticked by default, and sends it only then', async () => {
    const { d, sent } = deps();
    feedbackForm(document.body, d);
    await flush();
    const replay = document.querySelectorAll<HTMLInputElement>('.rl-feedback__check input')[1];
    kind('idea');
    expect(replay.disabled).toBe(true);
    expect(replay.checked).toBe(false);
    kind('bug');
    expect(replay.disabled).toBe(false);
    expect(replay.checked).toBe(true);
    kind('balance');
    type('the tank is too cheap');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    await flush();
    expect(sent[0].replay).toBeNull();
    q<HTMLButtonElement>('.rl-feedback__another').click();
    kind('bug');
    type('it walked to the wall');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    await flush();
    expect(sent[1].replay).toBe('{"v":1}');
  });

  it('sends with Ctrl+Enter from the text, and stops the key there', async () => {
    const { d, sent } = deps();
    feedbackForm(document.body, d);
    await flush();
    kind('bug');
    type('x');
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
    q('.rl-feedback__text').dispatchEvent(ev);
    window.removeEventListener('keydown', reached);
    await flush();
    expect(sent).toHaveLength(1);
    expect(reached).not.toHaveBeenCalled();
  });

  it('moves the kind with the arrow keys, which never reach the game', async () => {
    const { d } = deps();
    feedbackForm(document.body, d);
    await flush();
    kind('bug');
    const bug = q<HTMLButtonElement>('.rl-feedback__kind[data-kind="bug"]');
    bug.focus();
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    bug.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', reached);
    expect(q('.rl-feedback__kind[aria-checked="true"]').getAttribute('data-kind')).toBe('balance');
    expect(document.activeElement?.getAttribute('data-kind')).toBe('balance');
    expect(reached).not.toHaveBeenCalled();
  });

  it('shows the reference after a send, with Back to the game focused, and clears the draft', async () => {
    const { d } = deps();
    feedbackForm(document.body, d);
    await flush();
    kind('bug');
    type('x');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    await flush();
    expect(q('.rl-feedback').getAttribute('data-state')).toBe('sent');
    expect(q('.rl-feedback__ref').textContent).toContain('FB-0042');
    expect(document.activeElement).toBe(q('.rl-feedback__back'));
    q<HTMLButtonElement>('.rl-feedback__back').click();
    expect(d.onBack).toHaveBeenCalledTimes(1);
    expect(JSON.parse((d.storage as ReturnType<typeof store>).d[DRAFT_KEY]).text).toBe('');
  });

  it('says calmly what was sent without the picture or the replay, never as an error', async () => {
    const cases: [SendResult, string[]][] = [
      [{ kind: 'sent', ref: 'FB-0050', dropped: { picture: 'too_large' } }, ['The picture was too large, so it was sent without it.']],
      [
        { kind: 'sent', ref: 'FB-0051', dropped: { picture: 'storage_full', replay: 'storage_full' } },
        ['Sent without the picture: there is no room for pictures right now.', 'Sent without the replay: there is no room for replays right now.'],
      ],
      [{ kind: 'sent', ref: 'FB-0052' }, []],
    ];
    for (const [r, lines] of cases) {
      document.body.replaceChildren();
      const { d } = deps({ send: vi.fn(async (): Promise<SendResult> => r) });
      feedbackForm(document.body, d);
      await flush();
      kind('bug');
      type('x');
      q<HTMLButtonElement>('.rl-feedback__send').click();
      await flush();
      expect(q('.rl-feedback').getAttribute('data-state')).toBe('sent');
      expect(q('.rl-feedback__title').getAttribute('data-tone')).toBe('good');
      expect([...document.querySelectorAll('.rl-feedback__dropped')].map((e) => e.textContent)).toEqual(lines);
    }
  });

  it('says calmly that feedback is closed on the server\'s switch, and keeps the note', async () => {
    const { d } = deps({ send: vi.fn(async (): Promise<SendResult> => ({ kind: 'closed' })) });
    feedbackForm(document.body, d);
    await flush();
    kind('bug');
    type('keep me');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    await flush();
    expect(q('.rl-feedback').getAttribute('data-state')).toBe('closed');
    expect(q('.rl-feedback__title').textContent).toBe('Feedback is closed right now');
    expect(q('.rl-feedback__title').getAttribute('data-tone')).toBe('mute');
    expect(document.querySelector('.rl-feedback__retry')).toBeNull();
    expect(q<HTMLTextAreaElement>('.rl-feedback__text').value).toBe('keep me');
  });

  it('offers Retry after a failure, and keeps the note', async () => {
    let n = 0;
    const { d } = deps({ send: vi.fn(async (): Promise<SendResult> => (n++ === 0 ? { kind: 'failed', status: 503 } : { kind: 'sent', ref: 'FB-0007' })) });
    feedbackForm(document.body, d);
    await flush();
    kind('bug');
    type('keep me');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    await flush();
    expect(q('.rl-feedback').getAttribute('data-state')).toBe('failed');
    expect(document.activeElement).toBe(q('.rl-feedback__retry'));
    q<HTMLButtonElement>('.rl-feedback__retry').click();
    await flush();
    expect(q('.rl-feedback__ref').textContent).toContain('FB-0007');
  });

  it('reads a rate limit as a calm "slow down", with the wait and Retry', async () => {
    const { d } = deps({ send: vi.fn(async (): Promise<SendResult> => ({ kind: 'busy', retryAfter: 42 })) });
    feedbackForm(document.body, d);
    await flush();
    kind('bug');
    type('keep me');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    await flush();
    expect(q('.rl-feedback').getAttribute('data-state')).toBe('busy');
    expect(q('.rl-feedback__title').textContent).toBe('Slow down a moment');
    expect(q('.rl-feedback__title').getAttribute('data-tone')).toBe('mute');
    expect(q('.rl-feedback__thanks').textContent).toContain('42 s');
    expect(document.activeElement).toBe(q('.rl-feedback__retry'));
  });

  it('shows the contact line only to a player with no tester label (D16)', async () => {
    feedbackForm(document.body, deps().d);
    expect(document.querySelector('.rl-feedback__contact')).toBeNull();
    document.body.replaceChildren();
    feedbackForm(document.body, deps({ who: { anonymous: true } }).d);
    expect(document.querySelector('.rl-feedback__contact')).not.toBeNull();
    expect(q('.rl-feedback__who').textContent).toContain('Sent anonymously');
  });

  it('dispose removes its key listener, aborts the send in flight, and writes nothing after', async () => {
    let signal: AbortSignal | null = null;
    let land: (r: SendResult) => void = () => undefined;
    const { d } = deps({
      send: vi.fn((_s: FormSubmission, sig: AbortSignal) => {
        signal = sig;
        return new Promise<SendResult>((r) => (land = r));
      }),
    });
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const f = feedbackForm(document.body, d);
    await flush();
    const added = add.mock.calls.filter((c) => c[0] === 'keydown');
    expect(added).toHaveLength(1);
    kind('bug');
    type('x');
    q<HTMLButtonElement>('.rl-feedback__send').click();
    const root = q('.rl-feedback');
    f.dispose();
    expect(remove.mock.calls.filter((c) => c[0] === 'keydown' && c[1] === added[0][1] && c[2] === added[0][2])).toHaveLength(1);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(root.isConnected).toBe(false);
    land({ kind: 'sent', ref: 'FB-0009' });
    await flush();
    expect(root.querySelector('.rl-feedback__ref')).toBeNull();
    expect(d.objectUrl?.revoke).toHaveBeenCalledWith('blob:thumb');
    add.mockRestore();
    remove.mockRestore();
  });
});
