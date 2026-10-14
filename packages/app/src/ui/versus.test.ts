// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { maps } from '@lions/data';
import { VERSUS_FAIR_MAPS, type MatchConfig, type SeatState, type WsTransport, type WsTransportHooks } from '@lions/net';
import { CODE_ALPHABET, PENDING_LOBBY_EXPIRE_MS, filterCode, showVersus, showVersusRoom, versusMaps, type VersusDeps } from './versus';
import { RoomRefused, RoomStarted, type OpenedRoom, type RoomRequest } from '../net/connect';
import { takeHanded } from '../net/handoff';
import { isDialogOpen } from './confirm';

/** The methods the screens call on a transport, recorded. */
function fakeTransport() {
  const hooks: Partial<WsTransportHooks> = {};
  const t = {
    hooks,
    ready: vi.fn(),
    chat: vi.fn(),
    close: vi.fn(),
    detach: vi.fn(),
    setHooks: vi.fn((h: Partial<WsTransportHooks>) => { Object.assign(hooks, h); }),
  };
  return { fake: t, transport: t as unknown as WsTransport };
}

const SEATS_TWO: SeatState[] = [
  { seat: 0, callsign: 'Ari', connected: true, ready: false },
  { seat: 1, callsign: 'Bo', connected: true, ready: false },
];

/** What the lobby is handed in the build: `versusMaps()`, the two maps opened for versus (#561). */
const MAPS = [
  { id: 'beit_sahwan_outskirts', label: 'Beit Sahwan Outskirts' },
  { id: 'tel_marum', label: 'Tel Marum' },
];

function deps(overrides: Partial<VersusDeps> = {}): VersusDeps & { saved: string[]; navigated: [string, { replace?: boolean } | undefined][] } {
  const saved: string[] = [];
  const navigated: [string, { replace?: boolean } | undefined][] = [];
  return {
    saved,
    navigated,
    open: vi.fn(),
    maps: MAPS,
    callsign: { get: () => 'Ari', set: (v: string) => { saved.push(v); } },
    navigate: (href, opts) => { navigated.push([href, opts]); },
    copy: vi.fn().mockResolvedValue(true),
    linkFor: (code) => `https://game.test/versus/${code}`,
    ...overrides,
  };
}

const opened = (transport: WsTransport, over: Partial<OpenedRoom> = {}): OpenedRoom => ({
  code: 'ABCDEF', seat: 0, transport, lobby: { seats: [SEATS_TWO[0]!], map: 'tel_marum', factions: ['kdf', 'kdf'] }, ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Every screen a test mounts is left in `afterEach`, as the router would:
 *  a lobby left mounted keeps its window Escape listener for the next test. */
const mounted: (() => void)[] = [];
const room = (stage: HTMLElement, code: string, d: VersusDeps): (() => void) => {
  const dispose = showVersusRoom(stage, code, d);
  mounted.push(dispose);
  return dispose;
};

/** Hosts a room on `/versus`, then mounts `/versus/ABCDEF` as the router would. */
async function hostedRoom(over: Partial<VersusDeps> = {}) {
  const { fake, transport } = fakeTransport();
  const d = deps({ open: vi.fn().mockResolvedValue(opened(transport)), ...over });
  const entry = document.createElement('div');
  const leaveEntry = showVersus(entry, d);
  entry.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
  await flush();
  leaveEntry();
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  const dispose = room(stage, 'ABCDEF', d);
  return { fake, transport, d, stage, dispose };
}

afterEach(() => {
  for (const leave of mounted.splice(0)) leave();
  takeHanded('ABCDEF');
  document.body.replaceChildren();
});

describe('versusMaps (R-B9, #561)', () => {
  it('offers only the maps the lead opened for versus, by their own names (2026-10-14)', () => {
    const offered = versusMaps();
    const catalogue = maps as Record<string, { name: string }>;
    // Exactly the shared rule's list, each of which the build ships: a typo in
    // the rule would leave the lobby with no map at all.
    expect(offered.map((m) => m.id).sort()).toEqual([...VERSUS_FAIR_MAPS].sort());
    expect(offered.map((m) => m.id)).toContain('tel_marum');
    for (const m of offered) expect(m.label).toBe(catalogue[m.id]!.name);
  });
  it('drops every other map of a catalogue: the tile studies, the tutorial ground and the maps nobody has measured', () => {
    const catalogue = {
      beit_sahwan_outskirts: { name: 'Beit Sahwan Outskirts' },
      tel_marum: { name: 'Tel Marum' },
      qarn_hadid: { name: 'Qarn Hadid' },
      wadi_halam_basin: { name: 'Wadi Halam Basin' },
      tile_road: { name: 'Road tile' },
      tutorial_ground: { name: 'Tutorial' },
    };
    expect(versusMaps(catalogue)).toEqual([
      { id: 'beit_sahwan_outskirts', label: 'Beit Sahwan Outskirts' },
      { id: 'tel_marum', label: 'Tel Marum' },
    ]);
  });
});

describe('the room code alphabet', () => {
  // The app cannot import the Worker; the copy is pinned against its source text.
  it('is the Worker\'s own', () => {
    const src = readFileSync(`${process.cwd()}/packages/worker/src/match/code.ts`, 'utf8'); // vitest runs from the repo root
    expect(src).toContain(`export const CODE_ALPHABET = '${CODE_ALPHABET}';`);
  });
  it('drops 0, O, 1 and I, upper-cases, and stops at six', () => {
    expect(filterCode('ab0o1icdefgh')).toBe('ABCDEF');
    expect(filterCode('x7-y8 z9')).toBe('X7Y8Z9');
  });
});

describe('showVersus (/versus)', () => {
  it('draws a sticky foot whose back control goes to the menu', () => {
    const stage = document.createElement('div');
    showVersus(stage, deps());
    const back = stage.querySelector<HTMLAnchorElement>('.rl-panel > .rl-foot.rl-foot--sticky [data-kind="back"]');
    expect(back?.getAttribute('href')).toBe('/');
  });

  it('prefills the callsign, caps it at 24 and saves it on change', () => {
    const stage = document.createElement('div');
    const d = deps();
    showVersus(stage, d);
    const input = stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!;
    expect(input.value).toBe('Ari');
    expect(input.maxLength).toBe(24);
    input.value = 'Gal';
    input.dispatchEvent(new Event('change'));
    expect(d.saved).toEqual(['Gal']);
  });

  it('cleans the callsign as the room will: change shows and saves the cleaned name, and the prefill is cleaned (N1b follow-up)', () => {
    const stage = document.createElement('div');
    const d = deps();
    showVersus(stage, d);
    const input = stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!;
    input.value = '  G\u202Eal\u0000  ＢＯ ';
    input.dispatchEvent(new Event('change'));
    expect(input.value).toBe('Gal BO');
    expect(d.saved).toEqual(['Gal BO']);
    // Nothing usable left: the field empties and the empty name is saved ('Lion' is only where it is sent).
    input.value = '\u200B\u0007';
    input.dispatchEvent(new Event('change'));
    expect(input.value).toBe('');
    expect(d.saved.at(-1)).toBe('');
  });

  it('sends the cleaned callsign, and Lion when it is empty', async () => {
    const stage = document.createElement('div');
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    showVersus(stage, deps({ open }));
    const field = stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!;
    field.value = 'D\u202Eov\u0000';
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toMatchObject({ kind: 'create', callsign: 'Dov' });
  });

  it('selects tel_marum by default and lists the maps by label', () => {
    const stage = document.createElement('div');
    showVersus(stage, deps());
    const select = stage.querySelector<HTMLSelectElement>('.rl-versus__map')!;
    expect(select.value).toBe('tel_marum');
    expect([...select.options].map((o) => o.textContent)).toEqual(MAPS.map((m) => m.label));
  });

  it('hosting opens a room on the chosen map with the typed callsign, then goes to its lobby', async () => {
    const stage = document.createElement('div');
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    const d = deps({ open });
    showVersus(stage, d);
    stage.querySelector<HTMLSelectElement>('.rl-versus__map')!.value = 'beit_sahwan_outskirts';
    stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!.value = '  Dov ';
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect((open.mock.calls[0] as [RoomRequest])[0]).toEqual({ kind: 'create', map: 'beit_sahwan_outskirts', matchup: 'mirror', callsign: 'Dov' });
    expect(d.navigated).toEqual([['/versus/ABCDEF', undefined]]);
  });

  it('the host picks its side: the mirror by default, KDF or Sarim, and the create carries it (2026-10-14)', async () => {
    const stage = document.createElement('div');
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    showVersus(stage, deps({ open }));
    const side = stage.querySelector<HTMLSelectElement>('.rl-versus__faction')!;
    expect(side.value).toBe('mirror');
    expect([...side.options].map((o) => o.value)).toEqual(['mirror', 'kdf', 'sarim']);
    expect([...side.options].map((o) => o.textContent)).toEqual([
      'Mirror — KDF against KDF',
      'KDF — your friend plays Sarim',
      'Sarim — your friend plays KDF',
    ]);
    side.value = 'sarim';
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toMatchObject({ kind: 'create', matchup: 'sarim' });
  });

  it('KDF vs Sarim is Tel Marum only: a side narrows the map list and says so; the mirror opens every map (the lead, 2026-10-14)', async () => {
    const stage = document.createElement('div');
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    showVersus(stage, deps({ open }));
    const map = stage.querySelector<HTMLSelectElement>('.rl-versus__map')!;
    const side = stage.querySelector<HTMLSelectElement>('.rl-versus__faction')!;
    const note = stage.querySelector<HTMLElement>('.rl-versus__side-note')!;
    const enabled = () => [...map.options].filter((o) => !o.disabled).map((o) => o.value);
    expect(note.hidden).toBe(true);
    expect(enabled()).toEqual(['beit_sahwan_outskirts', 'tel_marum']);
    map.value = 'beit_sahwan_outskirts';
    side.value = 'sarim';
    side.dispatchEvent(new Event('change'));
    expect(enabled()).toEqual(['tel_marum']);
    expect(map.value).toBe('tel_marum');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('KDF against Sarim is played on Tel Marum only');
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toMatchObject({ kind: 'create', map: 'tel_marum', matchup: 'sarim' });
    side.value = 'mirror';
    side.dispatchEvent(new Event('change'));
    expect(enabled()).toEqual(['beit_sahwan_outskirts', 'tel_marum']);
    expect(note.hidden).toBe(true);
  });

  it('a build that ships no Tel Marum offers the mirror alone', () => {
    const stage = document.createElement('div');
    showVersus(stage, deps({ maps: [MAPS[0]!] }));
    const side = stage.querySelector<HTMLSelectElement>('.rl-versus__faction')!;
    expect([...side.options].filter((o) => !o.disabled).map((o) => o.value)).toEqual(['mirror']);
  });

  it('the code field upper-cases and drops 0, O, 1 and I as typed; Join opens a join for it', async () => {
    const stage = document.createElement('div');
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1 }));
    const d = deps({ open });
    showVersus(stage, d);
    const code = stage.querySelector<HTMLInputElement>('.rl-versus__code-input')!;
    const go = stage.querySelector<HTMLButtonElement>('.rl-versus__join')!;
    expect(go.disabled).toBe(true);
    code.value = 'ab0cO1dIef';
    code.dispatchEvent(new Event('input'));
    expect(code.value).toBe('ABCDEF');
    expect(go.disabled).toBe(false);
    go.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toEqual({ kind: 'join', code: 'ABCDEF', callsign: 'Ari' });
    expect(d.navigated).toEqual([['/versus/ABCDEF', undefined]]);
  });

  for (const [reason, line] of [
    ['not_found', 'No room with that code'],
    ['full', 'That room is full'],
    ['build', 'Your friend is on a different version: both reload the page'],
  ] as const) {
    it(`a refused join (${reason}) says so and stays`, async () => {
      const stage = document.createElement('div');
      const d = deps({ open: vi.fn().mockRejectedValue(new RoomRefused(reason, 'x')) });
      showVersus(stage, d);
      const code = stage.querySelector<HTMLInputElement>('.rl-versus__code-input')!;
      code.value = 'ABCDEF';
      code.dispatchEvent(new Event('input'));
      stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
      await flush();
      expect(stage.querySelector('.rl-versus__msg')?.textContent).toBe(line);
      expect(d.navigated).toEqual([]);
    });
  }

  it('a room that opens after the screen was left is closed, not navigated to', async () => {
    const stage = document.createElement('div');
    const { fake, transport } = fakeTransport();
    let resolveOpen: (r: OpenedRoom) => void = () => {};
    const d = deps({ open: vi.fn(() => new Promise<OpenedRoom>((r) => { resolveOpen = r; })) });
    const dispose = showVersus(stage, d);
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    dispose();
    resolveOpen(opened(transport));
    await flush();
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(d.navigated).toEqual([]);
  });
});

describe('showVersusRoom (/versus/:code) with the lobby handed from /versus', () => {
  it('shows the code large, and takes the transport without a second open', async () => {
    const { d, stage } = await hostedRoom();
    expect(stage.querySelector('.rl-versus__code')?.textContent).toBe('ABCDEF');
    expect(d.open).toHaveBeenCalledTimes(1);
  });

  it('Copy link copies the absolute link and says it was copied', async () => {
    const { d, stage } = await hostedRoom();
    stage.querySelector<HTMLButtonElement>('.rl-versus__copy')!.click();
    await flush();
    expect(d.copy).toHaveBeenCalledWith('https://game.test/versus/ABCDEF');
    const line = stage.querySelector('.rl-versus__copied');
    expect(line?.getAttribute('role')).toBe('status');
    expect(line?.textContent).toBe('Link copied');
  });

  it('a refused copy offers the code instead', async () => {
    const { stage } = await hostedRoom({ copy: vi.fn().mockResolvedValue(false) });
    stage.querySelector<HTMLButtonElement>('.rl-versus__copy')!.click();
    await flush();
    expect(stage.querySelector('.rl-versus__copied')?.textContent).toBe('Copy failed: send the code instead');
  });

  it('shows one callsign and a waiting seat, then both callsigns once the friend is in, with the map by name', async () => {
    const { fake, stage } = await hostedRoom();
    const cards = () => [...stage.querySelectorAll('.rl-versus__seat')];
    expect(cards()).toHaveLength(2);
    expect(cards()[0]!.textContent).toContain('Ari');
    expect(cards()[1]!.textContent).toContain('Waiting for your friend');
    fake.hooks.onLobby?.([...SEATS_TWO.slice(0, 1), { ...SEATS_TWO[1]!, ready: true }], 0, 'tel_marum');
    expect(cards()[0]!.textContent).toContain('Ari');
    expect(cards()[0]!.textContent).toContain('Not ready');
    expect(cards()[1]!.textContent).toContain('Bo');
    expect(cards()[1]!.textContent).toContain('Ready');
    expect(stage.querySelector('.rl-versus__room-map')?.textContent).toContain('Tel Marum');
  });

  it('each seat card names the force that seat commands, from the lobby\'s factions', async () => {
    const { fake, stage } = await hostedRoom();
    const forces = () => [...stage.querySelectorAll('.rl-versus__seat .rl-versus__force')].map((e) => e.textContent);
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum', ['sarim', 'kdf']);
    expect(forces()).toEqual(['Sarim', 'KDF']);
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum', ['kdf', 'kdf']);
    expect(forces()).toEqual(['KDF', 'KDF']);
  });

  it('renders an untrusted callsign as text, never as markup', async () => {
    const { fake, stage } = await hostedRoom();
    const evil = '<img src=x onerror=alert(1)>';
    fake.hooks.onLobby?.([SEATS_TWO[0]!, { ...SEATS_TWO[1]!, callsign: evil }], 0, 'tel_marum');
    expect(stage.querySelector('img')).toBeNull();
    expect(stage.querySelectorAll('.rl-versus__seat')[1]!.textContent).toContain(evil);
  });

  it('Ready sends ready once, however often it is clicked', async () => {
    const { fake, stage } = await hostedRoom();
    const ready = stage.querySelector<HTMLButtonElement>('.rl-versus__ready')!;
    ready.click();
    ready.click();
    ready.dispatchEvent(new MouseEvent('click'));
    expect(fake.ready).toHaveBeenCalledTimes(1);
    expect(ready.getAttribute('aria-pressed')).toBe('true');
  });

  it('mounts the lobby chat in its labelled slot: Enter sends through the transport (task 9, R-B10)', async () => {
    const { fake, stage } = await hostedRoom();
    const slot = stage.querySelector('.rl-versus__chat');
    expect(slot?.getAttribute('aria-label')).toBeTruthy();
    const input = slot?.querySelector<HTMLInputElement>('.rl-chat__input');
    expect(input).not.toBeNull();
    expect(input!.closest<HTMLElement>('.rl-chat__entry')!.hidden).toBe(false);
    input!.value = '  glhf ';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(fake.chat).toHaveBeenCalledWith('glhf');
  });

  it('an incoming lobby chat line is drawn as TEXT under the sender\'s callsign (task 9, R-B10)', async () => {
    const { fake, stage } = await hostedRoom();
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum');
    fake.hooks.onChat?.(1, '<img src=x onerror=alert(1)><b>x</b>');
    const lines = stage.querySelectorAll('.rl-versus__chat .rl-chat__line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe('Bo: <img src=x onerror=alert(1)><b>x</b>');
    expect(stage.querySelector('img')).toBeNull();
    expect(stage.querySelector('b')).toBeNull();
  });

  it('Escape typed into the lobby chat clears it and does not ask to leave', async () => {
    const { stage } = await hostedRoom();
    const input = stage.querySelector<HTMLInputElement>('.rl-chat__input')!;
    input.value = 'oops';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(input.value).toBe('');
    expect(stage.querySelector('.rl-confirm')).toBeNull();
  });

  it('the lobby\'s disposer takes the chat with it, and a late line draws nothing', async () => {
    const { fake, stage, dispose } = await hostedRoom();
    dispose();
    expect(stage.querySelector('.rl-chat')).toBeNull();
    expect(() => fake.hooks.onChat?.(1, 'late')).not.toThrow();
    expect(stage.querySelector('.rl-chat__line')).toBeNull();
  });

  it('at the start hands the transport over and goes to the match, replacing history; the disposer then says nothing', async () => {
    const { fake, transport, d, dispose } = await hostedRoom();
    const config = { code: 'ABCDEF', map: 'tel_marum', mode: 'versus' } as unknown as MatchConfig;
    fake.hooks.onStart?.(config);
    expect(d.navigated.at(-1)).toEqual(['/free-play/tel_marum?net=ABCDEF', { replace: true }]);
    dispose();
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.detach).not.toHaveBeenCalled();
    expect(takeHanded('ABCDEF')).toEqual({ transport, seat: 0, config });
  });

  it('the disposer before the start says bye (closes)', async () => {
    const { fake, dispose } = await hostedRoom();
    dispose();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('Leave asks first; confirmed, it closes the room and goes back to /versus', async () => {
    const { fake, d, stage, dispose } = await hostedRoom();
    const leave = stage.querySelector<HTMLButtonElement>('.rl-panel > .rl-foot [data-kind="back"]')!;
    expect(leave.tagName).toBe('BUTTON');
    leave.click();
    expect(fake.close).not.toHaveBeenCalled();
    const confirm = stage.querySelector('.rl-confirm');
    expect(confirm?.textContent).toContain('Leave the room?');
    expect(confirm?.textContent).toContain('The room closes for both of you.');
    stage.querySelector<HTMLButtonElement>('.rl-confirm__yes')!.click();
    await flush();
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(d.navigated.at(-1)).toEqual(['/versus', undefined]);
    dispose();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('Escape opens the same confirm; cancelled, nothing is closed', async () => {
    const { fake, stage } = await hostedRoom();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(stage.querySelector('.rl-confirm')?.textContent).toContain('Leave the room?');
    stage.querySelector<HTMLButtonElement>('.rl-confirm__no')!.click();
    await flush();
    expect(stage.querySelector('.rl-confirm')).toBeNull();
    expect(fake.close).not.toHaveBeenCalled();
  });

  it('leaving the screen with the confirm open takes the confirm (and its key guard) with it', async () => {
    const { stage, dispose } = await hostedRoom();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isDialogOpen()).toBe(true);
    dispose();
    expect(isDialogOpen()).toBe(false);
    expect(stage.querySelector('.rl-confirm')).toBeNull();
    // The screen's own Escape listener is gone too: nothing answers the key.
    const late = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(late);
    expect(late.defaultPrevented).toBe(false);
    expect(isDialogOpen()).toBe(false);
  });

  for (const [code, line] of [
    ['bad_ticket', 'The room has closed'],
    ['build_mismatch', 'Your friend is on a different version: both reload the page'],
  ] as const) {
    it(`a terminal error after the lobby opened (${code}) ends it: the line says why and Ready stops (Task 6 review (e))`, async () => {
      const { fake, d, stage } = await hostedRoom();
      fake.hooks.onError?.(code);
      expect(stage.querySelector('.rl-versus__status')?.textContent).toBe(line);
      const ready = stage.querySelector<HTMLButtonElement>('.rl-versus__ready')!;
      expect(ready.disabled).toBe(true);
      ready.click();
      expect(fake.ready).not.toHaveBeenCalled();
      // Ended: Leave has nothing to close for anyone, so it does not ask.
      stage.querySelector<HTMLButtonElement>('.rl-panel > .rl-foot [data-kind="back"]')!.click();
      expect(stage.querySelector('.rl-confirm')).toBeNull();
      expect(d.navigated.at(-1)).toEqual(['/versus', undefined]);
    });
  }

  it('an error that is not terminal leaves the lobby open', async () => {
    const { fake, stage } = await hostedRoom();
    fake.hooks.onError?.('full');
    expect(stage.querySelector('.rl-versus__status')?.textContent).toBe('');
    expect(stage.querySelector<HTMLButtonElement>('.rl-versus__ready')!.disabled).toBe(false);
  });

  it('says the room closed when the friend leaves, and Ready stops', async () => {
    const { fake, stage } = await hostedRoom();
    fake.hooks.onEnded?.('left');
    expect(stage.querySelector('.rl-versus__status')?.textContent).toBe('The room has closed');
    expect(stage.querySelector<HTMLButtonElement>('.rl-versus__ready')!.disabled).toBe(true);
  });
});

describe('the parked lobby (Task 6 review (f))', () => {
  it('is taken once: a second mount of the same code shows the prompt, not the closed transport', async () => {
    const { fake, d, dispose } = await hostedRoom();
    dispose();
    expect(fake.close).toHaveBeenCalledTimes(1);
    const again = document.createElement('div');
    room(again, 'ABCDEF', d);
    expect(again.querySelector('.rl-versus__seat')).toBeNull();
    expect(again.querySelector('.rl-versus__callsign')).not.toBeNull();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('an entry nobody takes is closed after its expiry, and a later mount shows the prompt', async () => {
    vi.useFakeTimers();
    try {
      const { fake, transport } = fakeTransport();
      const d = deps({ open: vi.fn().mockResolvedValue(opened(transport)) });
      const entry = document.createElement('div');
      const leaveEntry = showVersus(entry, d);
      entry.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
      await vi.advanceTimersByTimeAsync(0);
      leaveEntry();
      expect(d.navigated).toEqual([['/versus/ABCDEF', undefined]]);
      await vi.advanceTimersByTimeAsync(PENDING_LOBBY_EXPIRE_MS - 1);
      expect(fake.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.close).toHaveBeenCalledTimes(1);
      const stage = document.createElement('div');
      room(stage, 'ABCDEF', d);
      expect(stage.querySelector('.rl-versus__seat')).toBeNull();
      expect(stage.querySelector('.rl-versus__callsign')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an entry taken in time is not closed by its expiry', async () => {
    vi.useFakeTimers();
    try {
      const { fake, transport } = fakeTransport();
      const d = deps({ open: vi.fn().mockResolvedValue(opened(transport)) });
      const entry = document.createElement('div');
      const leaveEntry = showVersus(entry, d);
      entry.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
      await vi.advanceTimersByTimeAsync(0);
      leaveEntry();
      const stage = document.createElement('div');
      room(stage, 'ABCDEF', d);
      expect(stage.querySelector('.rl-versus__code')?.textContent).toBe('ABCDEF');
      await vi.advanceTimersByTimeAsync(PENDING_LOBBY_EXPIRE_MS * 2);
      expect(fake.close).not.toHaveBeenCalled();
      expect(stage.querySelector<HTMLButtonElement>('.rl-versus__ready')!.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a lobby reload into a room that has already started (Task 7 review (g))', () => {
  it('goes to the match on the started map, replacing history, so the battlefield rejoins with the stored ticket', async () => {
    const d = deps({ open: vi.fn().mockRejectedValue(new RoomStarted('qarn_hadid', 'ABCDEF')) });
    const stage = document.createElement('div');
    room(stage, 'ABCDEF', d);
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    await flush();
    expect(d.navigated).toEqual([['/free-play/qarn_hadid?net=ABCDEF', { replace: true }]]);
    expect(stage.querySelector('.rl-versus__msg')?.textContent).toBe('');
  });

  it('a join by code from /versus into a started room goes to the match too', async () => {
    const d = deps({ open: vi.fn().mockRejectedValue(new RoomStarted('tel_marum', 'ABCDEF')) });
    const stage = document.createElement('div');
    showVersus(stage, d);
    const code = stage.querySelector<HTMLInputElement>('.rl-versus__code-input')!;
    code.value = 'ABCDEF';
    code.dispatchEvent(new Event('input'));
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    await flush();
    expect(d.navigated).toEqual([['/free-play/tel_marum?net=ABCDEF', { replace: true }]]);
  });
});

describe('showVersusRoom by a direct link (the guest\'s path)', () => {
  it('asks for a callsign, joins this code, then shows the lobby on the same transport', async () => {
    const { fake, transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1, lobby: { seats: SEATS_TWO, map: 'tel_marum', factions: ['kdf', 'kdf'] } }));
    const d = deps({ open, callsign: { get: () => '', set: () => {} } });
    const stage = document.createElement('div');
    const dispose = room(stage, 'ABCDEF', d);
    expect(open).not.toHaveBeenCalled();
    expect(stage.querySelector('.rl-versus__seat')).toBeNull();
    stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!.value = 'Bo';
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toEqual({ kind: 'join', code: 'ABCDEF', callsign: 'Bo' });
    expect(stage.querySelectorAll('.rl-versus__seat')).toHaveLength(2);
    expect(stage.querySelector('.rl-versus__code')?.textContent).toBe('ABCDEF');
    stage.querySelector<HTMLButtonElement>('.rl-versus__ready')!.click();
    expect(fake.ready).toHaveBeenCalledTimes(1);
    dispose();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('a full room says so and offers no lobby', async () => {
    const d = deps({ open: vi.fn().mockRejectedValue(new RoomRefused('full', 'x')) });
    const stage = document.createElement('div');
    room(stage, 'ABCDEF', d);
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    await flush();
    expect(stage.querySelector('.rl-versus__msg')?.textContent).toBe('That room is full');
    expect(stage.querySelector('.rl-versus__seat')).toBeNull();
  });

  it('a join that lands after the screen was left is closed', async () => {
    const { fake, transport } = fakeTransport();
    let resolveOpen: (r: OpenedRoom) => void = () => {};
    const d = deps({ open: vi.fn(() => new Promise<OpenedRoom>((r) => { resolveOpen = r; })) });
    const stage = document.createElement('div');
    const dispose = room(stage, 'ABCDEF', d);
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    dispose();
    resolveOpen(opened(transport));
    await flush();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });
});
