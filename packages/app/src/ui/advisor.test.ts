// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdvisorMsg } from '@lions/net';
import type { Command } from '@lions/sim';
import { PROPOSAL_MS, PROPOSAL_QUEUE, describeCommand, mountAdvisorPanel, type AdvisorPanel, type AdvisorPanelDeps } from './advisor';

const ONE = 65536;
const move = (ids: number[], tx = 24, ty = 31): Command => ({ kind: 'move', ids, x: tx * ONE, y: ty * ONE });
const proposal = (id: number, note = 'push the ridge', cmd: Command = move([1, 2, 3])): AdvisorMsg => ({ kind: 'proposal', id, cmd, note });

function mount(opts: { valid?: (cmd: Command) => boolean } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let clock = 0;
  const sent: AdvisorMsg[] = [];
  const queued: Command[] = [];
  const pinged: [number, number][] = [];
  const deps: AdvisorPanelDeps = {
    send: (a) => sent.push(a),
    queueCommand: (c) => queued.push(c),
    validate: opts.valid ?? (() => true),
    now: () => clock,
    describe: describeCommand,
    ping: (x, y) => pinged.push([x, y]),
  };
  const panel: AdvisorPanel = mountAdvisorPanel(host, deps);
  panel.onPresence('assist');
  return {
    host, panel, sent, queued, pinged,
    // Time passes the way a running game gives it: a frame every 50 ms up to `ms`.
    at: (ms: number) => { while (clock < ms) { clock = Math.min(clock + 50, ms); panel.frame(); } },
    // Time the frame loop did not see (a room pause, a hidden tab): the clock moves, no frame runs.
    skip: (ms: number) => { clock += ms; },
    now: () => clock,
    frameNow: () => panel.frame(),
    vetoes: () => sent.filter((m) => m.kind === 'veto'),
    feed: () => [...host.querySelectorAll('.rl-advisor__line')].map((li) => li.textContent),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('advisor panel: the proposal strip', () => {
  it('queues an unvetoed proposal as a command at exactly PROPOSAL_MS, and not before', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(7));
    m.at(PROPOSAL_MS - 1);
    expect(m.queued).toHaveLength(0);
    m.at(PROPOSAL_MS);
    expect(m.queued).toEqual([move([1, 2, 3])]);
    expect(m.sent).toEqual([{ kind: 'accept', id: 7 }]);
  });

  it('X before the deadline queues nothing and sends one veto', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(7));
    m.at(500);
    expect(m.panel.veto()).toBe(true);
    m.at(PROPOSAL_MS + 100);
    expect(m.queued).toHaveLength(0);
    expect(m.vetoes()).toEqual([{ kind: 'veto', id: 7 }]);
  });

  it('a proposal that no longer validates at the deadline is vetoed and the feed says it went stale', () => {
    let ok = true;
    const m = mount({ valid: () => ok });
    m.panel.onAdvisor('advisor', proposal(9));
    ok = false;
    m.at(PROPOSAL_MS);
    expect(m.queued).toHaveLength(0);
    expect(m.vetoes()).toEqual([{ kind: 'veto', id: 9 }]);
    expect(m.feed().some((l) => l?.includes('stale'))).toBe(true);
  });

  it('draws the note as literal text, never markup', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(1, '<img src=x onerror=alert(1)>'));
    m.panel.onAdvisor('advisor', { kind: 'text', text: '<img src=x onerror=alert(2)>' });
    expect(m.host.querySelector('img')).toBeNull();
    expect(m.host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(m.host.textContent).toContain('<img src=x onerror=alert(2)>');
  });

  it('four proposals in one tick: the second is vetoed, the first still shows, order is kept', () => {
    const m = mount();
    expect(PROPOSAL_QUEUE).toBe(3);
    for (const id of [1, 2, 3, 4]) m.panel.onAdvisor('advisor', proposal(id, `note ${id}`));
    expect(m.vetoes()).toEqual([{ kind: 'veto', id: 2 }]);
    expect(m.host.querySelector('.rl-advisor__note')?.textContent).toBe('note 1');
    m.at(PROPOSAL_MS);
    expect(m.sent.filter((s) => s.kind === 'accept')).toEqual([{ kind: 'accept', id: 1 }]);
    // The next one starts its own two seconds when it comes up.
    expect(m.host.querySelector('.rl-advisor__note')?.textContent).toBe('note 3');
    m.at(PROPOSAL_MS + PROPOSAL_MS - 1);
    expect(m.sent.filter((s) => s.kind === 'accept')).toHaveLength(1);
    m.at(PROPOSAL_MS * 2);
    expect(m.sent.filter((s) => s.kind === 'accept').map((s) => (s as { id: number }).id)).toEqual([1, 3]);
    m.at(PROPOSAL_MS * 3);
    expect(m.sent.filter((s) => s.kind === 'accept').map((s) => (s as { id: number }).id)).toEqual([1, 3, 4]);
  });

  it('time the frame loop never saw (a pause, a hidden tab) does not count: no order fires on the first frame back', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(7));
    m.at(300);
    m.skip(60_000);
    m.frameNow();
    expect(m.queued).toHaveLength(0);
    expect(m.vetoes()).toHaveLength(0);
    // The countdown resumes from where it was (~1.6 s left, less the one clamped frame).
    const back = m.now();
    m.at(back + 1500);
    expect(m.queued).toHaveLength(0);
    m.at(back + 1600);
    expect(m.queued).toEqual([move([1, 2, 3])]);
  });

  it('dispose stops the timers: time after it queues and sends nothing', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(7));
    m.panel.dispose();
    m.at(PROPOSAL_MS * 5);
    expect(m.queued).toHaveLength(0);
    expect(m.sent).toHaveLength(0);
    expect(m.panel.veto()).toBe(false);
  });

  it('veto() is false while nothing shows, so the key goes on to whatever else it does', () => {
    const m = mount();
    expect(m.panel.veto()).toBe(false);
    expect(m.sent).toHaveLength(0);
    m.panel.onAdvisor('advisor', proposal(1));
    expect(m.panel.veto()).toBe(true);
    expect(m.panel.veto()).toBe(false);
  });

  it('Accept (click or accept()) takes the proposal at once', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(4));
    m.host.querySelector<HTMLButtonElement>('.rl-advisor__accept')!.click();
    expect(m.queued).toEqual([move([1, 2, 3])]);
    expect(m.sent).toEqual([{ kind: 'accept', id: 4 }]);
    expect(m.panel.accept()).toBe(false);
    m.panel.onAdvisor('advisor', proposal(5));
    expect(m.panel.accept()).toBe(true);
    expect(m.sent).toEqual([{ kind: 'accept', id: 4 }, { kind: 'accept', id: 5 }]);
  });

  it('a Veto button refuses the showing proposal, for a player with only a mouse', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(6));
    m.host.querySelector<HTMLButtonElement>('.rl-advisor__veto')!.click();
    expect(m.vetoes()).toEqual([{ kind: 'veto', id: 6 }]);
    m.at(PROPOSAL_MS * 2);
    expect(m.queued).toHaveLength(0);
    expect(m.panel.showing).toBe(false);
  });

  it('Escape inside the answer box vetoes a showing proposal, and is the old Escape (clear and leave) otherwise', () => {
    const m = mount();
    const input = m.host.querySelector<HTMLInputElement>('.rl-advisor__input')!;
    const esc = (): KeyboardEvent => {
      const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      return ev;
    };
    input.value = 'half a thought';
    expect(esc().defaultPrevented).toBe(true);
    expect(m.sent).toEqual([]);
    expect(input.value).toBe('');
    m.panel.onAdvisor('advisor', proposal(8));
    input.value = 'keep this';
    esc();
    expect(m.vetoes()).toEqual([{ kind: 'veto', id: 8 }]);
    expect(input.value).toBe('keep this');
  });

  it('shows the note and a description of the order, and counts down', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', proposal(1));
    expect(m.host.querySelector('.rl-advisor__note')?.textContent).toBe('push the ridge');
    expect(m.host.querySelector('.rl-advisor__what')?.textContent).toBe('Move 3 units to (24, 31)');
    expect(m.host.querySelector('.rl-advisor__hint')?.textContent).toContain('X');
    m.at(500);
    expect(m.host.querySelector('.rl-advisor__count')?.textContent).toBe('1.5 s');
  });

  it('an advise-scope advisor cannot propose: a proposal is ignored, never shown or queued', () => {
    const m = mount();
    m.panel.onPresence('advise');
    m.panel.onAdvisor('advisor', proposal(1));
    m.at(PROPOSAL_MS * 2);
    expect(m.queued).toHaveLength(0);
    expect(m.host.querySelector<HTMLElement>('.rl-advisor__strip')!.hidden).toBe(true);
    expect(m.panel.showing).toBe(false);
  });

  it('is hidden until an advisor is present, and the advisor leaving drops the strip without sending', () => {
    const m = mount();
    const root = m.host.querySelector<HTMLElement>('.rl-advisor')!;
    expect(root.hidden).toBe(false);
    m.panel.onAdvisor('advisor', proposal(1));
    m.panel.onPresence(null);
    expect(root.hidden).toBe(true);
    m.at(PROPOSAL_MS * 2);
    expect(m.queued).toHaveLength(0);
    expect(m.sent).toHaveLength(0);
  });
});

describe('advisor panel: the feed', () => {
  it('shows advisor text, sends the human\'s own lines as text and echoes them', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', { kind: 'text', text: 'enemy armour north' });
    expect(m.feed()).toEqual(['Advisor: enemy armour north']);
    const input = m.host.querySelector<HTMLInputElement>('.rl-advisor__input')!;
    input.value = '  hold the bridge ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(m.sent).toEqual([{ kind: 'text', text: 'hold the bridge' }]);
    expect(m.feed()).toContain('You: hold the bridge');
    expect(input.value).toBe('');
  });

  it('keys typed in the box never reach the game', () => {
    const m = mount();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const input = m.host.querySelector<HTMLInputElement>('.rl-advisor__input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('a ping draws through the field ping and leaves a feed line with the tile', () => {
    const m = mount();
    m.panel.onAdvisor('advisor', { kind: 'ping', x: 12, y: 40 });
    expect(m.pinged).toEqual([[12, 40]]);
    expect(m.feed()).toEqual(['Advisor pings (12, 40)']);
  });

  it('keeps the feed to its last lines', () => {
    const m = mount();
    for (let i = 0; i < 80; i++) m.panel.onAdvisor('advisor', { kind: 'text', text: `l${i}` });
    expect(m.feed().length).toBeLessThanOrEqual(30);
    expect(m.feed().at(-1)).toBe('Advisor: l79');
  });
});

describe('describeCommand', () => {
  it('words each order through the catalogue', () => {
    expect(describeCommand(move([1]))).toBe('Move 1 unit to (24, 31)');
    expect(describeCommand({ kind: 'attackMove', ids: [1, 2], x: 3 * ONE, y: 4 * ONE })).toBe('Attack-move 2 units to (3, 4)');
    expect(describeCommand({ kind: 'setStance', ids: [1, 2], stance: 'ambush' })).toBe('Set an ambush with 2 units');
    expect(describeCommand({ kind: 'setStance', ids: [1, 2], stance: 'hold' })).toBe('Hold 2 units where they stand');
    expect(describeCommand({ kind: 'halt', ids: [1, 2] })).toBe('Halt 2 units');
    expect(describeCommand({ kind: 'attack', ids: [1], target: 9 })).toBe('Fire on an enemy with 1 unit');
  });
});
