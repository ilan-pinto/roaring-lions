// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { maps, paletteTeamColors } from '@lions/data';
import { FACTION_MATCHUP_MAPS, FLAG_SETUP_MAPS, VERSUS_FAIR_MAPS, WIN_MODE_FAIR_FACTION_CELLS, WIN_MODE_FAIR_MAPS, type MatchConfig, type SeatState, type WsTransport, type WsTransportHooks } from '@lions/net';
import { ANNOUNCE_AFTER_MOUNT_MS, CODE_ALPHABET, PENDING_LOBBY_EXPIRE_MS, filterCode, showVersus, showVersusRoom, versusMaps, type VersusDeps } from './versus';
import { RoomRefused, RoomStarted, type OpenedRoom, type RoomRequest } from '../net/connect';
import { takeHanded } from '../net/handoff';
import { isDialogOpen } from './confirm';
import { AdvisorRefused } from '../net/connect';
import { missingKeys, setCatalogue } from '../i18n/t';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';

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

/** What the lobby is handed in the build: `versusMaps()`, the maps opened for versus (#561), in catalogue order. */
const MAPS = [
  { id: 'beit_sahwan_outskirts', label: 'Beit Sahwan Outskirts' },
  { id: 'milh_flats', label: 'Milh Flats — Bir Milh' },
  { id: 'tel_marum', label: 'Tel Marum' },
  { id: 'wadi_tarfan', label: 'Wadi Tarfan — The Three Fords' },
];
/** Wadi Tarfan (large), a map KDF against Sarim plays: added to a lobby by the tests that need it. */
const WADI_TARFAN_L = { id: 'wadi_tarfan_l', label: 'Wadi Tarfan (large) — The Three Fords' };
/** Runs `fn` with a points cell for Wadi Tarfan (large) in the faction table and takes it out again, also on a throw. The table is
 *  empty (GH-976 P4 review: the one cell that passed was a kill race), so the lobby's handling of a faction cell is exercised with
 *  a cell the test adds. */
async function withFactionPoints(hosts: ('kdf' | 'sarim')[], fn: () => Promise<void>): Promise<void> {
  const cells = WIN_MODE_FAIR_FACTION_CELLS.points as Record<string, readonly ('kdf' | 'sarim')[]>;
  cells.wadi_tarfan_l = hosts;
  try { await fn(); } finally { delete cells.wadi_tarfan_l; }
}

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
    serverOrigin: 'https://game.test',
    advisorTicket: vi.fn().mockResolvedValue('ADV-TICKET-SECRET'),
    ...overrides,
  };
}

const opened = (transport: WsTransport, over: Partial<OpenedRoom> = {}): OpenedRoom => ({
  code: 'ABCDEF', seat: 0, transport, lobby: { seats: [SEATS_TWO[0]!], map: 'tel_marum', factions: ['kdf', 'kdf'], kit: 'matched' }, ...over,
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

// jsdom has no 2D canvas: the map pictures paint nothing (the painter's own
// null path), without jsdom's "not implemented" line per picture.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

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

// The pick screen's controls (the face-off, 2026-10-16): real radios inside
// labels, a role="switch" button, and one code input over six drawn cells.
const sideRadio = (stage: ParentNode, m: string) => stage.querySelector<HTMLInputElement>(`input.rl-versus__side-radio[value="${m}"]`)!;
const mapRadio = (stage: ParentNode, id: string) => stage.querySelector<HTMLInputElement>(`input.rl-versus__map-radio[value="${id}"]`)!;
const pick = (radio: HTMLInputElement): void => {
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};
const enabledMaps = (stage: ParentNode) => [...stage.querySelectorAll<HTMLInputElement>('input.rl-versus__map-radio')].filter((r) => !r.disabled).map((r) => r.value);
const checkedMap = (stage: ParentNode) => stage.querySelector<HTMLInputElement>('input.rl-versus__map-radio:checked')?.value;
/** The text an element's `aria-describedby` points at, as a screen reader would read it. */
const describedBy = (el: Element): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');
/** A screen mounted into the document, so ids resolve. */
function mountPick(d: VersusDeps): HTMLElement {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  mounted.push(showVersus(stage, d));
  return stage;
}
const typeCode = (stage: ParentNode, raw: string): HTMLInputElement => {
  const code = stage.querySelector<HTMLInputElement>('.rl-versus__code-input')!;
  code.value = raw;
  code.dispatchEvent(new Event('input'));
  return code;
};

describe('showVersus (/versus)', () => {
  it('draws a foot whose back control goes to the menu', () => {
    const stage = mountPick(deps());
    const back = stage.querySelector<HTMLAnchorElement>('.rl-versus__frame > .rl-foot [data-kind="back"]');
    expect(back?.getAttribute('href')).toBe('/');
  });

  it('prefills the callsign, caps it at 24 and saves it on change', () => {
    const d = deps();
    const stage = mountPick(d);
    const input = stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!;
    expect(input.value).toBe('Ari');
    expect(input.maxLength).toBe(24);
    input.value = 'Gal';
    input.dispatchEvent(new Event('change'));
    expect(d.saved).toEqual(['Gal']);
  });

  it('cleans the callsign as the room will: change shows and saves the cleaned name, and the prefill is cleaned (N1b follow-up)', () => {
    const d = deps();
    const stage = mountPick(d);
    const input = stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!;
    input.value = '  G\u202eal\u0000  ＢＯ ';
    input.dispatchEvent(new Event('change'));
    expect(input.value).toBe('Gal BO');
    expect(d.saved).toEqual(['Gal BO']);
    // Nothing usable left: the field empties and the empty name is saved ('Lion' is only where it is sent).
    input.value = '\u200b\u0007';
    input.dispatchEvent(new Event('change'));
    expect(input.value).toBe('');
    expect(d.saved.at(-1)).toBe('');
  });

  it('sends the cleaned callsign, and Lion when it is empty', async () => {
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    const stage = mountPick(deps({ open }));
    const field = stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!;
    field.value = 'D\u202eov\u0000';
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toMatchObject({ kind: 'create', callsign: 'Dov' });
  });

  it('picks tel_marum by default and lists the maps as radios, by name, in one labelled group', () => {
    const stage = mountPick(deps());
    const radios = [...stage.querySelectorAll<HTMLInputElement>('input.rl-versus__map-radio')];
    expect(radios.map((r) => r.type)).toEqual(['radio', 'radio', 'radio', 'radio']);
    expect(radios.map((r) => r.value)).toEqual(MAPS.map((m) => m.id));
    expect(checkedMap(stage)).toBe('tel_marum');
    // Each radio is named by its map's name (the part before the dash).
    const names = radios.map((r) => document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent);
    expect(names).toEqual(['Beit Sahwan Outskirts', 'Milh Flats', 'Tel Marum', 'Wadi Tarfan']);
    const group = radios[0]!.closest('fieldset');
    expect(group?.querySelector('legend')?.textContent).toBe('Choose the ground');
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  });

  it('hosting opens a room on the chosen map with the typed callsign, then goes to its lobby', async () => {
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    const d = deps({ open });
    const stage = mountPick(d);
    pick(mapRadio(stage, 'beit_sahwan_outskirts'));
    stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!.value = '  Dov ';
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect((open.mock.calls[0] as [RoomRequest])[0]).toEqual({ kind: 'create', map: 'beit_sahwan_outskirts', matchup: 'mirror', kit: 'matched', callsign: 'Dov' });
    expect(d.navigated).toEqual([['/versus/ABCDEF', undefined]]);
  });

  it('the host picks its side from a radio group -- KDF, Sarim, Mirror -- the mirror by default, and the create carries it (2026-10-14)', async () => {
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    const stage = mountPick(deps({ open }));
    const radios = [...stage.querySelectorAll<HTMLInputElement>('.rl-versus__sides:not(.rl-versus__win) input.rl-versus__side-radio')];
    expect(radios.map((r) => r.value)).toEqual(['kdf', 'sarim', 'mirror']);
    expect(radios.map((r) => r.type)).toEqual(['radio', 'radio', 'radio']);
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['KDF', 'Sarim', 'Mirror']);
    expect(radios.find((r) => r.checked)?.value).toBe('mirror');
    expect(radios[0]!.closest('fieldset')?.querySelector('legend')?.textContent).toBe('Pick your side');
    pick(sideRadio(stage, 'sarim'));
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toMatchObject({ kind: 'create', matchup: 'sarim' });
  });

  it('side first: a faction pick greys the mirror-only maps out, each with a reason a screen reader hears, and moves the pick onto ground it plays on; the mirror opens every map (the lead, 2026-10-14; ruling 2026-10-16)', async () => {
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    const stage = mountPick(deps({ open }));
    const note = stage.querySelector<HTMLElement>('.rl-versus__side-note')!;
    expect(note.hidden).toBe(true);
    expect(enabledMaps(stage)).toEqual(['beit_sahwan_outskirts', 'milh_flats', 'tel_marum', 'wadi_tarfan']);
    pick(mapRadio(stage, 'milh_flats'));
    pick(sideRadio(stage, 'sarim'));
    expect(enabledMaps(stage)).toEqual(['tel_marum', 'wadi_tarfan']);
    for (const id of ['beit_sahwan_outskirts', 'milh_flats']) {
      const r = mapRadio(stage, id);
      expect(r.disabled).toBe(true);
      expect(r.closest('label')?.dataset.off).toBe('1');
      expect(describedBy(r)).toBe('Mirror only: pick Mirror to play here');
    }
    expect(describedBy(mapRadio(stage, 'tel_marum'))).toBe('KDF or Sarim');
    expect(checkedMap(stage)).toBe('tel_marum');
    expect(note.hidden).toBe(false);
    // Was 'Tel Marum and Wadi Tarfan only': Wadi Tarfan (large) is a faction-matchup map from GH-920 B7.
    expect(note.textContent).toBe('KDF against Sarim is played on Tel Marum, Wadi Tarfan and Wadi Tarfan (large) only');
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect((open.mock.calls[0] as [RoomRequest])[0]).toMatchObject({ kind: 'create', map: 'tel_marum', matchup: 'sarim' });
    pick(sideRadio(stage, 'mirror'));
    expect(enabledMaps(stage)).toEqual(['beit_sahwan_outskirts', 'milh_flats', 'tel_marum', 'wadi_tarfan']);
    expect(describedBy(mapRadio(stage, 'milh_flats'))).toBe('Mirror only');
    expect(note.hidden).toBe(true);
  });

  it('GH-913 L8: Rujm Sawda is a mirror-only map with a lobby card: 80 x 80, "Mirror only", greyed out for a faction pick', () => {
    const rujm = { id: 'rujm_sawda', label: (maps as Record<string, { name: string }>).rujm_sawda!.name };
    const stage = mountPick(deps({ maps: [...MAPS, rujm] }));
    expect(enabledMaps(stage)).toEqual(['beit_sahwan_outskirts', 'milh_flats', 'tel_marum', 'wadi_tarfan', 'rujm_sawda']);
    expect(describedBy(mapRadio(stage, 'rujm_sawda'))).toBe('Mirror only');
    pick(mapRadio(stage, 'rujm_sawda'));
    const card = stage.querySelector<HTMLElement>('.rl-versus__mapcard')!;
    expect(card.querySelector('.rl-versus__mapcard-name')?.textContent).toBe('Rujm Sawda');
    expect(card.querySelector('.rl-versus__mapcard-desc')?.textContent).toMatch(/\blarge\b/i);
    expect(card.textContent).toContain('80 × 80 tiles');
    expect(card.querySelector('.rl-versus__chip[data-kind="quiet"]')?.textContent).toBe('Mirror only');
    expect(card.querySelector('.rl-versus__pic-canvas, .rl-versus__pic')).not.toBeNull();
    pick(sideRadio(stage, 'sarim'));
    expect(enabledMaps(stage)).toEqual(['tel_marum', 'wadi_tarfan']);
    expect(mapRadio(stage, 'rujm_sawda').disabled).toBe(true);
    expect(describedBy(mapRadio(stage, 'rujm_sawda'))).toBe('Mirror only: pick Mirror to play here');
  });

  it('GH-920 B7: Wadi Tarfan (large) is a map for BOTH faction cells with a lobby card: 96 x 96, "KDF or Sarim", enabled for a faction pick', () => {
    const large = { id: 'wadi_tarfan_l', label: (maps as Record<string, { name: string }>).wadi_tarfan_l!.name };
    const stage = mountPick(deps({ maps: [...MAPS, large] }));
    expect(enabledMaps(stage)).toEqual(['beit_sahwan_outskirts', 'milh_flats', 'tel_marum', 'wadi_tarfan', 'wadi_tarfan_l']);
    expect(describedBy(mapRadio(stage, 'wadi_tarfan_l'))).toBe('KDF or Sarim');
    pick(mapRadio(stage, 'wadi_tarfan_l'));
    const card = stage.querySelector<HTMLElement>('.rl-versus__mapcard')!;
    expect(card.querySelector('.rl-versus__mapcard-name')?.textContent).toBe('Wadi Tarfan (large)');
    expect(card.querySelector('.rl-versus__mapcard-desc')?.textContent).toMatch(/^A large 96 by 96 map/);
    expect(card.textContent).toContain('96 × 96 tiles');
    expect(card.querySelector('.rl-versus__chip[data-kind="quiet"]')).toBeNull(); // not "Mirror only"
    pick(sideRadio(stage, 'sarim'));
    expect(enabledMaps(stage)).toEqual(['tel_marum', 'wadi_tarfan', 'wadi_tarfan_l']);
    expect(mapRadio(stage, 'wadi_tarfan_l').disabled).toBe(false);
    expect(checkedMap(stage)).toBe('wadi_tarfan_l'); // a faction pick keeps ground it plays on
  });

  it('GH-920 B7: Milh Flats (large) is a MIRROR-ONLY map with a lobby card: 96 x 96, "Mirror only", greyed out for a faction pick', () => {
    const large = { id: 'milh_flats_l', label: (maps as Record<string, { name: string }>).milh_flats_l!.name };
    const stage = mountPick(deps({ maps: [...MAPS, large] }));
    expect(enabledMaps(stage)).toEqual(['beit_sahwan_outskirts', 'milh_flats', 'tel_marum', 'wadi_tarfan', 'milh_flats_l']);
    expect(describedBy(mapRadio(stage, 'milh_flats_l'))).toBe('Mirror only');
    pick(mapRadio(stage, 'milh_flats_l'));
    const card = stage.querySelector<HTMLElement>('.rl-versus__mapcard')!;
    expect(card.querySelector('.rl-versus__mapcard-name')?.textContent).toBe('Milh Flats (large)');
    expect(card.querySelector('.rl-versus__mapcard-desc')?.textContent).toMatch(/^A large 96 by 96 map/);
    expect(card.textContent).toContain('96 × 96 tiles');
    expect(card.querySelector('.rl-versus__chip[data-kind="quiet"]')?.textContent).toBe('Mirror only');
    expect(card.querySelector('.rl-versus__pic-canvas, .rl-versus__pic')).not.toBeNull();
    pick(sideRadio(stage, 'sarim'));
    expect(enabledMaps(stage)).toEqual(['tel_marum', 'wadi_tarfan']);
    expect(mapRadio(stage, 'milh_flats_l').disabled).toBe(true);
    expect(describedBy(mapRadio(stage, 'milh_flats_l'))).toBe('Mirror only: pick Mirror to play here');
  });

  it('GH-920 B7: the side note names every KDF-v-Sarim map by its name (it is a catalogue string, so a map added to the list without it is red)', () => {
    const stage = mountPick(deps());
    const note = stage.querySelector<HTMLElement>('.rl-versus__side-note')!.textContent!;
    for (const id of FACTION_MATCHUP_MAPS) {
      const full = (maps as Record<string, { name: string }>)[id]!.name;
      // The catalogue spells the map's short name: "Wadi Tarfan (large) — The Three Fords" -> "Wadi Tarfan (large)".
      expect(note, id).toContain(full.split(' — ')[0]);
    }
    // 'Wadi Tarfan' is a substring of 'Wadi Tarfan (large)', so the loop alone cannot see the plain map dropped.
    expect(note).toBe('KDF against Sarim is played on Tel Marum, Wadi Tarfan and Wadi Tarfan (large) only');
  });

  it('N3 Task 6: the KDF-v-Sarim options say the economy is on; the mirror says nothing of it', () => {
    const stage = mountPick(deps());
    const note = stage.querySelector<HTMLElement>('.rl-versus__matchup-note')!;
    expect(note.hidden).toBe(true);
    for (const m of ['kdf', 'sarim']) {
      pick(sideRadio(stage, m));
      expect(note.hidden).toBe(false);
      expect(note.textContent).toBe('Camps, income and production on');
      expect(describedBy(sideRadio(stage, m))).toBe('Camps, income and production on');
    }
    pick(sideRadio(stage, 'mirror'));
    expect(note.hidden).toBe(true);
    expect(sideRadio(stage, 'mirror').hasAttribute('aria-describedby')).toBe(false);
  });

  it('a build that ships neither faction map offers the mirror alone, and says why on the greyed sides', () => {
    const stage = mountPick(deps({ maps: [MAPS[0]!] }));
    const radios = [...stage.querySelectorAll<HTMLInputElement>('.rl-versus__sides:not(.rl-versus__win) input.rl-versus__side-radio')];
    expect(radios.filter((r) => !r.disabled).map((r) => r.value)).toEqual(['mirror']);
    expect(describedBy(sideRadio(stage, 'kdf'))).toBe('No ground for KDF against Sarim in this build');
  });

  it('the face-off: your card under your callsign, your friend\'s across from it, each in its side\'s faction', () => {
    const stage = mountPick(deps());
    const card = (who: string) => stage.querySelector<HTMLElement>(`.rl-versus__fcard[data-who="${who}"]`)!;
    // The mirror: KDF against KDF.
    expect(card('you').dataset.faction).toBe('kdf');
    expect(card('friend').dataset.faction).toBe('kdf');
    expect(card('you').querySelector('.rl-versus__fcard-who')?.textContent).toBe('Ari');
    expect(card('friend').querySelector('.rl-versus__fcard-who')?.textContent).toBe('Your friend');
    pick(sideRadio(stage, 'sarim'));
    expect(card('you').dataset.faction).toBe('sarim');
    expect(card('you').querySelector('.rl-versus__fcard-name')?.textContent).toBe('Sarim');
    expect(card('friend').dataset.faction).toBe('kdf');
    expect(card('friend').querySelector('.rl-versus__fcard-name')?.textContent).toBe('KDF');
    // The callsign typed is the card's name as it is typed.
    const input = stage.querySelector<HTMLInputElement>('.rl-versus__callsign')!;
    input.value = 'Noa';
    input.dispatchEvent(new Event('input'));
    expect(card('you').querySelector('.rl-versus__fcard-who')?.textContent).toBe('Noa');
    // The portraits are decoration: hidden from a screen reader, alt empty.
    for (const art of stage.querySelectorAll('.rl-versus__art')) expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(missingKeys()).toEqual([]);
  });

  it('the map card shows the chosen ground: its starts, its line and the plain fairness label', () => {
    const stage = mountPick(deps());
    const cardEl = stage.querySelector<HTMLElement>('.rl-versus__mapcard')!;
    expect(cardEl.querySelector('.rl-versus__mapcard-name')?.textContent).toBe('Tel Marum');
    expect(cardEl.querySelectorAll('.rl-versus__start')).toHaveLength(2);
    const chips = [...cardEl.querySelectorAll('.rl-versus__chip')].map((c) => c.textContent);
    expect(chips).toContain('Measured even');
    expect(chips).toContain('KDF or Sarim');
    pick(mapRadio(stage, 'milh_flats'));
    const again = stage.querySelector<HTMLElement>('.rl-versus__mapcard')!;
    expect(again.querySelector('.rl-versus__mapcard-name')?.textContent).toBe('Milh Flats');
    expect(again.querySelector('.rl-versus__mapcard-sub')?.textContent).toBe('Bir Milh');
    expect([...again.querySelectorAll('.rl-versus__chip')].map((c) => c.textContent)).toContain('Mirror only');
  });

  it('the code entry upper-cases and drops 0, O, 1 and I as typed, draws it in six cells, and Join opens a join for it', async () => {
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1 }));
    const d = deps({ open });
    const stage = mountPick(d);
    const go = stage.querySelector<HTMLButtonElement>('.rl-versus__join')!;
    expect(go.disabled).toBe(true);
    const code = typeCode(stage, 'ab0cO1dIef');
    expect(code.value).toBe('ABCDEF');
    const cells = [...stage.querySelectorAll('.rl-versus__code-cell')].map((c) => c.textContent);
    expect(cells).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(stage.querySelector('.rl-versus__code-cells')?.getAttribute('aria-hidden')).toBe('true');
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
      const d = deps({ open: vi.fn().mockRejectedValue(new RoomRefused(reason, 'x')) });
      const stage = mountPick(d);
      typeCode(stage, 'ABCDEF');
      stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
      await flush();
      expect(stage.querySelector('.rl-versus__msg')?.textContent).toBe(line);
      expect(d.navigated).toEqual([]);
    });
  }

  it('the join bar\'s error line is reserved: there, empty and live before any error, the same node after, and the stylesheet holds its height', async () => {
    const d = deps({ open: vi.fn().mockRejectedValue(new RoomRefused('not_found', 'x')) });
    const stage = mountPick(d);
    const msg = stage.querySelector<HTMLElement>('.rl-versus__join-bar .rl-versus__msg')!;
    expect(msg).not.toBeNull();
    expect(msg.textContent).toBe('');
    expect(msg.hidden).toBe(false);
    expect(msg.getAttribute('aria-live')).toBe('polite');
    const code = typeCode(stage, 'ABCDEF');
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    await flush();
    expect(stage.querySelector('.rl-versus__join-bar .rl-versus__msg')).toBe(msg);
    expect(msg.textContent).toBe('No room with that code');
    expect(code.getAttribute('aria-invalid')).toBe('true');
    // Typing again clears the error, and the line stays where it was.
    typeCode(stage, 'ABCDE');
    expect(msg.textContent).toBe('');
    expect(code.getAttribute('aria-invalid')).toBe(null);
    // The height is reserved by the sheet, not by the text: one line, always.
    const css = readFileSync(`${process.cwd()}/packages/app/src/ui/theme.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes('.rl-versus__msg'));
    expect(rule.some((m) => /min-height\s*:\s*calc\(var\(--lh-body\) \* 1em\)/.test(m[2]))).toBe(true);
    expect(/\.rl-versus__msg:empty[^{]*\{[^}]*display\s*:\s*none/.test(css)).toBe(false);
  });

  it('a room that fails to open says so on its own reserved line beside Open a room, not under the join cells', async () => {
    const d = deps({ open: vi.fn().mockRejectedValue(new Error('offline')) });
    const stage = mountPick(d);
    const openMsg = stage.querySelector<HTMLElement>('.rl-versus__act .rl-versus__open-msg');
    expect(openMsg).not.toBeNull();
    expect(openMsg!.textContent).toBe('');
    expect(openMsg!.getAttribute('role')).toBe('status');
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    expect(openMsg!.textContent).toBe('Could not reach the room: try again');
    expect(openMsg!.dataset.tone).toBe('bad');
    expect(stage.querySelector('.rl-versus__join-bar .rl-versus__msg')?.textContent).toBe('');
    // Reserved like the join line: the sheet holds its height, not the text.
    const css = readFileSync(`${process.cwd()}/packages/app/src/ui/theme.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((x) => x.trim()).includes('.rl-versus__open-msg'));
    expect(rule.some((m) => /min-height\s*:/.test(m[2]))).toBe(true);
  });

  it('"Measured even" says why to a screen reader, not only in a tooltip', () => {
    const stage = mountPick(deps());
    const fair = stage.querySelector<HTMLElement>('.rl-versus__chip[data-kind="fair"]')!;
    expect(describedBy(fair)).toBe('Both starts were measured close to even in test matches');
  });

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

  it('draws the menu\'s still plate behind it, decoration only; save-data and a missing plate draw none', () => {
    const stage = mountPick(deps({ plateUrl: '/ui/menu_host_plate.jpg' }));
    const back = stage.querySelector<HTMLElement>('.rl-versus__backdrop');
    expect(back?.getAttribute('aria-hidden')).toBe('true');
    expect(back?.querySelector('img')?.getAttribute('src')).toBe('/ui/menu_host_plate.jpg');
    expect(back?.querySelector('img')?.getAttribute('alt')).toBe('');
    const saving = mountPick(deps({ plateUrl: '/ui/menu_host_plate.jpg', saveData: () => true }));
    expect(saving.querySelector('.rl-versus__backdrop')).toBeNull();
    const none = mountPick(deps());
    expect(none.querySelector('.rl-versus__backdrop')).toBeNull();
  });

  it('every string it draws went through t()', async () => {
    const d = deps({ open: vi.fn().mockRejectedValue(new RoomRefused('not_found', 'x')), maps: [MAPS[0]!] });
    const stage = mountPick(d);
    typeCode(stage, 'ABCDEF');
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    await flush();
    stage.querySelector<HTMLButtonElement>('.rl-versus__kit-toggle')!.click();
    expect(missingKeys()).toEqual([]);
  });
});

// Per-seat kit: "Bring your brigade", a host's toggle for a friends' room.
describe('bring your brigade: the host\'s toggle and the room\'s kit line', () => {
  const toggle = (stage: ParentNode) => stage.querySelector<HTMLButtonElement>('.rl-versus__kit-toggle');

  it('is a real switch on the host\'s create form only: off, named, with a one-line hint that follows its state', () => {
    const stage = mountPick(deps());
    const sw = toggle(stage)!;
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.type).toBe('button');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.textContent).toBe('Bring your brigade');
    expect(describedBy(sw)).toBe('Both sides field the standard kit');
    sw.click();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(describedBy(sw)).toBe('Friends only: each player brings the upgrades and the Store special units they own. A bot fields the standard force');
    sw.click();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(stage.querySelectorAll('.rl-versus__kit-toggle')).toHaveLength(1);
    // The fine-print paragraph is gone: the hint is the whole of it.
    expect(stage.querySelector('.rl-versus__kit-note')).toBeNull();
    expect(missingKeys()).toEqual([]);
  });

  it('is not on the guest\'s direct-link join screen, nor in a lobby either seat sits in', async () => {
    const guest = document.createElement('div');
    room(guest, 'ABCDEF', deps());
    expect(toggle(guest)).toBeNull();
    const { stage } = await hostedRoom();
    expect(toggle(stage)).toBeNull();
  });

  it('switched on, the create asks for a brigade room; off, a matched one', async () => {
    for (const [on, kit] of [[true, 'brigade'], [false, 'matched']] as const) {
      const { transport } = fakeTransport();
      const open = vi.fn().mockResolvedValue(opened(transport));
      const stage = mountPick(deps({ open }));
      if (on) toggle(stage)!.click();
      stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
      await flush();
      expect((open.mock.calls[0] as [RoomRequest])[0]).toMatchObject({ kind: 'create', kit });
      // The room opened here is parked for its lobby; mounting it takes it, as the router would.
      room(document.createElement('div'), 'ABCDEF', deps());
    }
  });

  it('the room screen says what the kit rule is, to the host and to the guest alike, and updates with the lobby', async () => {
    for (const kit of ['brigade', 'matched'] as const) {
      const { transport } = fakeTransport();
      const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1, lobby: { seats: SEATS_TWO, map: 'tel_marum', factions: ['kdf', 'kdf'], kit } }));
      const stage = document.createElement('div');
      room(stage, 'ABCDEF', deps({ open }));
      stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
      await flush();
      const line = stage.querySelector('.rl-versus__room-kit');
      expect(line?.querySelector('.rl-versus__kit-name')?.textContent, kit).toBe(kit === 'brigade' ? 'Brigades: upgrades and Store specials (friends only)' : 'Standard kit for both');
      expect(line?.getAttribute('data-kit')).toBe(kit);
    }
    expect(missingKeys()).toEqual([]);
  });

  it('a lobby repaint that carries the rule moves the line; textContent only', async () => {
    const { fake, stage } = await hostedRoom();
    expect(stage.querySelector('.rl-versus__room-kit')?.getAttribute('data-kit')).toBe('matched');
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum', ['kdf', 'kdf'], 'brigade');
    expect(stage.querySelector('.rl-versus__room-kit')?.getAttribute('data-kit')).toBe('brigade');
    expect(stage.querySelector('.rl-versus__room-kit')?.innerHTML).not.toMatch(/<(?!\/?span)/);
  });
});

// GH-1102: in a brigade room each seat's card shows the Store specials it brings, before Ready.
describe("bring your brigade: both line-ups in the lobby (GH-1102)", () => {
  const SEATS_SPECIALS: SeatState[] = [
    { seat: 0, callsign: 'Ari', connected: true, ready: false, specials: ['mbt_lavi_camo', 'spg_cluster', 'veh_ambulance'] },
    { seat: 1, callsign: 'Bo', connected: true, ready: false, specials: [] },
  ];
  const joined = async (kit: 'brigade' | 'matched', seats: SeatState[] = SEATS_SPECIALS) => {
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1, lobby: { seats, map: 'tel_marum', factions: ['kdf', 'kdf'], kit } }));
    const stage = document.createElement('div');
    room(stage, 'ABCDEF', deps({ open }));
    stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
    await flush();
    return stage;
  };
  const cardOf = (stage: ParentNode, seat: 0 | 1) => stage.querySelector<HTMLElement>(`.rl-versus__fcard[data-seat="${seat}"]`)!;

  it("each seat's card names what joins its force and what stays out, with the reason; a seat with none reads Standard force", async () => {
    const stage = await joined('brigade');
    const host = cardOf(stage, 0);
    // Names are the unit JSON's `name` (data), in the order the room sent them.
    expect(host.querySelector('.rl-versus__lineup-brings')?.textContent).toBe('Brings: Lavi Ambush Tank');
    expect(host.querySelector('.rl-versus__lineup-out')?.textContent).toBe(
      "Stays out of versus: Te'o Cluster Howitzer (its price is Conduct, and a versus room has no civilians), Pered Armoured Ambulance (rescue is not in versus yet)");
    expect(cardOf(stage, 1).querySelector('.rl-versus__lineup-none')?.textContent).toBe('Standard force');
    expect(cardOf(stage, 1).querySelector('.rl-versus__lineup-brings')).toBeNull();
    expect(missingKeys()).toEqual([]);
  });
  it('a matched room shows no line-up at all', async () => {
    const stage = await joined('matched', SEATS_TWO);
    expect(stage.querySelector('.rl-versus__lineup')).toBeNull();
  });
  it('?pseudo=1: every line-up string is bracketed, so none bypassed t()', async () => {
    setCatalogue('pseudo', en, pseudo);
    try {
      const stage = await joined('brigade');
      const shown = [...stage.querySelectorAll('.rl-versus__lineup p')].map((e) => e.textContent ?? '');
      expect(shown.length).toBe(3);
      for (const text of shown) expect(text, text).toMatch(/^⟦[\s\S]*⟧$/);
    } finally {
      setCatalogue('en', en);
    }
  });
});

// GH-976 P2: the host picks how the match is won; the lobby offers a mode only where it was read fair.
describe('how to win: the host\'s pick and the room\'s line (GH-976 P2)', () => {
  // GH-1139: flag is out of the lobby until CTF v2 lands (WP9, `WIN_MODE_FAIR_MAPS.flag` is empty). The flag lobby path is still
  // code that WP9 turns back on, so these tests stand the seven v1 maps back in for their own run; the test that reads what
  // the lobby offers TODAY takes them out first.
  const V1_FLAG_MAPS = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];
  const flagList = WIN_MODE_FAIR_MAPS.flag as string[];
  const SHIPPED = [...flagList];
  const asShipped = (): void => { flagList.splice(0, flagList.length, ...SHIPPED); };
  beforeEach(() => { flagList.push(...V1_FLAG_MAPS.filter((m) => !flagList.includes(m))); });
  afterEach(asShipped);
  const winRadios = (stage: ParentNode) => [...stage.querySelectorAll<HTMLInputElement>('.rl-versus__win input.rl-versus__side-radio')];
  const winGroup = (stage: ParentNode) => stage.querySelector<HTMLElement>('fieldset.rl-versus__win')!;
  const created = async (stage: HTMLElement, open: ReturnType<typeof vi.fn>): Promise<RoomRequest> => {
    stage.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    // The room opened here is parked for its lobby; mounting it takes it, as the router would.
    room(document.createElement('div'), 'ABCDEF', deps());
    return (open.mock.calls[0] as [RoomRequest])[0];
  };
  const mount = (extra: { id: string; label: string }[] = []) => {
    const { transport } = fakeTransport();
    const open = vi.fn().mockResolvedValue(opened(transport));
    return { open, stage: mountPick(deps({ open, maps: [...MAPS, ...extra] })) };
  };

  it('is hidden where no mode was read fair (KDF against Sarim on Tel Marum), and a create from there says nothing of a mode', async () => {
    const { open, stage } = mount();
    expect(checkedMap(stage)).toBe('tel_marum');
    // GH-976 P4: the mirror on Tel Marum offers both modes now; the pairing with Sarim was read and offers none.
    expect(winRadios(stage).map((r) => r.value)).toEqual(['annihilation', 'points', 'flag']);
    pick(sideRadio(stage, 'kdf'));
    expect(checkedMap(stage)).toBe('tel_marum');
    expect(winGroup(stage).hidden).toBe(true);
    expect(winRadios(stage)).toEqual([]);
    expect('winMode' in (await created(stage, open))).toBe(false);
  });

  it('on a fair map it is Annihilation (the default), Points race and Capture the flag, in one labelled group with a hint', async () => {
    const { open, stage } = mount();
    pick(mapRadio(stage, 'tel_marum'));
    expect(winGroup(stage).hidden).toBe(false);
    expect(winGroup(stage).querySelector('legend')?.textContent).toBe('How to win');
    expect(winRadios(stage).map((r) => r.value)).toEqual(['annihilation', 'points', 'flag']);
    expect(winRadios(stage).map((r) => r.closest('label')?.textContent)).toEqual(['Annihilation', 'Points race', 'Capture the flag']);
    expect(winRadios(stage).find((r) => r.checked)?.value).toBe('annihilation');
    expect(describedBy(winRadios(stage)[0]!)).toBe('Destroy every enemy combat unit');
    expect('winMode' in (await created(stage, open))).toBe(false);   // the default asks for no mode at all
  });

  it('picking Points race says its target and the create carries it', async () => {
    const { open, stage } = mount();
    pick(mapRadio(stage, 'milh_flats'));
    pick(winRadios(stage).find((r) => r.value === 'points')!);
    expect(winRadios(stage).find((r) => r.checked)?.value).toBe('points');
    expect(describedBy(winRadios(stage).find((r) => r.checked)!)).toContain('First to 600. Hold a zone alone to earn its points every minute (10 to 50 a minute)');
    expect(await created(stage, open)).toMatchObject({ kind: 'create', map: 'milh_flats', matchup: 'mirror', winMode: 'points' });
  });

  it('GH-976 P3: picking Capture the flag says its hold and the create carries it', async () => {
    const { open, stage } = mount();
    pick(mapRadio(stage, 'wadi_tarfan'));
    pick(winRadios(stage).find((r) => r.value === 'flag')!);
    expect(winRadios(stage).find((r) => r.checked)?.value).toBe('flag');
    expect(describedBy(winRadios(stage).find((r) => r.checked)!)).toContain('for 30 seconds');
    expect(await created(stage, open)).toMatchObject({ kind: 'create', map: 'wadi_tarfan', matchup: 'mirror', winMode: 'flag' });
  });

  it('GH-976 v2 R0.22: the lobby reads the hold through flagBlockOf: 45 seconds on a map in FLAG_SETUP_MAPS, 30 on every other', () => {
    const listed = FLAG_SETUP_MAPS as string[];
    const before = [...listed]; // restored below, never left cleared
    listed.splice(0, listed.length, 'wadi_tarfan'); // exactly one map listed, whatever ships, so 'every other' is true
    try {
      const { stage } = mount();
      pick(mapRadio(stage, 'wadi_tarfan'));
      pick(winRadios(stage).find((r) => r.value === 'flag')!);
      expect(describedBy(winRadios(stage).find((r) => r.checked)!)).toContain('for 45 seconds');
      pick(mapRadio(stage, 'milh_flats'));
      pick(winRadios(stage).find((r) => r.value === 'flag')!);
      expect(describedBy(winRadios(stage).find((r) => r.checked)!)).toContain('for 30 seconds');
    } finally { listed.splice(0, listed.length, ...before); }
  });

  it('a pick that the next pairing does not offer is dropped, not carried to a cell it was never read fair on', async () => withFactionPoints(['kdf'], async () => {
    const { open, stage } = mount([WADI_TARFAN_L]);
    pick(mapRadio(stage, 'wadi_tarfan_l'));
    pick(winRadios(stage).find((r) => r.value === 'flag')!);
    expect(winRadios(stage).find((r) => r.checked)?.value).toBe('flag');
    // KDF against Sarim is offered the points race alone on this map (a cell the test adds): the flag pick is dropped, annihilation is the default again.
    pick(sideRadio(stage, 'kdf'));
    expect(winRadios(stage).map((r) => r.value)).toEqual(['annihilation', 'points']);
    expect(winRadios(stage).find((r) => r.checked)?.value).toBe('annihilation');
    pick(winRadios(stage).find((r) => r.value === 'points')!);
    // ...and a map the pairing was not read fair on drops the points pick too: absent from the DOM, not merely hidden.
    pick(mapRadio(stage, 'tel_marum'));
    expect(winGroup(stage).hidden).toBe(true);
    expect(winRadios(stage)).toEqual([]);
    const req = await created(stage, open);
    expect(req).toMatchObject({ matchup: 'kdf', map: 'tel_marum' });
    expect('winMode' in req).toBe(false);
  }));

  it('a faction pick on a map KDF-against-Sarim was not read fair on offers no mode and drops the pick', async () => {
    const { open, stage } = mount();
    pick(mapRadio(stage, 'wadi_tarfan'));
    pick(winRadios(stage).find((r) => r.value === 'points')!);
    pick(sideRadio(stage, 'sarim'));
    expect(checkedMap(stage)).toBe('wadi_tarfan');   // a map KDF-v-Sarim plays, so the ground stays
    expect(winRadios(stage)).toEqual([]);
    const req = await created(stage, open);
    expect(req).toMatchObject({ matchup: 'sarim' });
    expect('winMode' in req).toBe(false);
    // and back to the mirror: Annihilation again, not the dropped Points race
    pick(sideRadio(stage, 'mirror'));
    expect(winRadios(stage).find((r) => r.checked)?.value).toBe('annihilation');
  });

  it('GH-976 P4: a faction cell in the table is offered, the create carries it, and the economy line gives way to the placed-forces one', async () => withFactionPoints(['kdf', 'sarim'], async () => {
    for (const side of ['kdf', 'sarim'] as const) {
      const { open, stage } = mount([WADI_TARFAN_L]);
      const economy = stage.querySelector<HTMLElement>('.rl-versus__matchup-note:not([id*="placed"])')!;
      const placed = [...stage.querySelectorAll<HTMLElement>('.rl-versus__matchup-note')].find((n) => n.textContent === 'Both forces start on the field; nothing is built or bought')!;
      pick(mapRadio(stage, 'wadi_tarfan_l'));
      pick(sideRadio(stage, side));
      expect(checkedMap(stage)).toBe('wadi_tarfan_l');
      expect(winGroup(stage).hidden).toBe(false);
      expect(winRadios(stage).map((r) => r.value)).toEqual(['annihilation', 'points']);
      // Annihilation on a faction pairing is the economy room: the economy line shows and the placed-forces line does not.
      expect(economy.hidden).toBe(false);
      expect(placed.hidden).toBe(true);
      expect(describedBy(sideRadio(stage, side))).toBe('Camps, income and production on');
      pick(winRadios(stage).find((r) => r.value === 'points')!);
      expect(describedBy(winRadios(stage).find((r) => r.checked)!)).toContain('First to 600. Hold a zone alone to earn its points every minute (10 to 40 a minute)');
      // A mode on a faction pairing is the placed forces with no economy, so the economy line would be untrue.
      expect(economy.hidden).toBe(true);
      expect(placed.hidden).toBe(false);
      expect(describedBy(sideRadio(stage, side))).toBe('Both forces start on the field; nothing is built or bought');
      expect(await created(stage, open)).toMatchObject({ kind: 'create', map: 'wadi_tarfan_l', matchup: side, winMode: 'points' });
    }
  }));

  it('offers exactly the modes WIN_MODE_FAIR_MAPS lists, on every map of the lobby: Destroy the camp on wadi_tarfan, milh_flats and wadi_tarfan_l, and never Capture the flag (GH-1139)', () => {
    asShipped();   // the table as it ships
    const stage = mountPick(deps({ maps: [...MAPS, WADI_TARFAN_L] }));
    const offered: Record<string, string[]> = {};
    for (const m of [...MAPS, WADI_TARFAN_L]) {
      pick(mapRadio(stage, m.id));
      offered[m.id] = winRadios(stage).map((r) => r.value);
    }
    expect(offered).toEqual({
      beit_sahwan_outskirts: [], /* points delisted 12 Nov (GH-976): nothing but annihilation, so no picker is drawn */ milh_flats: ['annihilation', 'camp', 'points'], tel_marum: ['annihilation', 'points'],
      wadi_tarfan: ['annihilation', 'camp', 'points'], wadi_tarfan_l: ['annihilation', 'camp', 'points'],
    });
  });

  it('the room screen names the win mode to the host and the guest alike, and a lobby repaint moves it', async () => {
    for (const mode of ['points', 'flag', undefined] as const) {
      const { transport } = fakeTransport();
      const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1, lobby: { seats: SEATS_TWO, map: 'wadi_tarfan', factions: ['kdf', 'kdf'], kit: 'matched', ...(mode === undefined ? {} : { winMode: mode }) } }));
      const stage = document.createElement('div');
      room(stage, 'ABCDEF', deps({ open }));
      stage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
      await flush();
      const line = stage.querySelector('.rl-versus__room-win');
      expect(line?.querySelector('.rl-versus__label')?.textContent).toBe('How to win');
      expect(line?.querySelector('.rl-versus__kit-name')?.textContent, String(mode)).toBe(mode === 'points' ? 'Points race' : mode === 'flag' ? 'Capture the flag' : 'Annihilation');
    }
    const { fake, stage } = await hostedRoom();
    expect(stage.querySelector('.rl-versus__room-win .rl-versus__kit-name')?.textContent).toBe('Annihilation');
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'wadi_tarfan', ['kdf', 'kdf'], 'matched', 'points');
    expect(stage.querySelector('.rl-versus__room-win .rl-versus__kit-name')?.textContent).toBe('Points race');
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'wadi_tarfan', ['kdf', 'kdf'], 'matched');
    expect(stage.querySelector('.rl-versus__room-win .rl-versus__kit-name')?.textContent).toBe('Annihilation');
  });

  it('?pseudo=1: every string of the win group and of the room line is bracketed, so none bypassed t()', async () => {
    setCatalogue('pseudo', en, pseudo);
    try {
      const stage = mountPick(deps());
      pick(mapRadio(stage, 'tel_marum'));
      pick(winRadios(stage).find((r) => r.value === 'points')!);
      const shown = [
        winGroup(stage).querySelector('legend')!.textContent!,
        ...[...winGroup(stage).querySelectorAll('.rl-versus__side-name, .rl-versus__win-hint')].map((e) => e.textContent!),
      ];
      expect(shown.length).toBe(5);   // the legend, three options, the hint
      for (const text of shown) expect(text, text).toMatch(/^⟦[\s\S]*⟧$/);
      // the room line, for both modes
      const { transport } = fakeTransport();
      const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1, lobby: { seats: SEATS_TWO, map: 'wadi_tarfan', factions: ['kdf', 'kdf'], kit: 'matched', winMode: 'points' } }));
      const roomStage = document.createElement('div');
      room(roomStage, 'ABCDEF', deps({ open }));
      roomStage.querySelector<HTMLButtonElement>('.rl-versus__join')!.click();
      await flush();
      for (const sel of ['.rl-versus__room-win .rl-versus__label', '.rl-versus__room-win .rl-versus__kit-name']) {
        const text = roomStage.querySelector(sel)!.textContent!;
        expect(text, sel).toMatch(/^⟦[\s\S]*⟧$/);
      }
      expect(missingKeys()).toEqual([]);
    } finally {
      setCatalogue('en', en);
    }
  });
});

// The face-off's tints (ruling 2026-10-16, made relational in fix round 1):
// the match colours by RELATION, not faction -- `ThreeRenderer` paints
// `teamColors[colorSlot(side, viewer)]`, so each player sees their own force
// in team.kedem and the other in team.hostile, whatever the faction. The lobby
// does the same: two semantic tokens in theme.css, --side-you and
// --side-friend, mapped from the team colours and re-pointed by every
// colour-vision block, keyed on who a card is, never on its faction.
describe('the side tints are by relation, as the match draws them, and follow the colour-vision setting', () => {
  const css = readFileSync(`${process.cwd()}/packages/app/src/ui/theme.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const palette = JSON.parse(readFileSync(`${process.cwd()}/data/palette.json`, 'utf8')) as {
    reserved: { team: { colors: Record<string, string>; variants: Record<string, Record<string, string>> } };
  };
  /** The hex a `--rl-team-…` property carries (`vite-plugin-palette.ts`'s naming). */
  const hexOf = (prop: string): string | undefined => {
    const m = /^--rl-team-(?:(deuteranopia|protanopia|tritanopia)-)?(kedem|hostile)$/.exec(prop);
    if (m === null) return undefined;
    const table = m[1] === undefined ? palette.reserved.team.colors : palette.reserved.team.variants[m[1]];
    return table?.[m[2]!]?.toLowerCase();
  };
  const block = (selector: string): string => rules.filter((r) => r.sel === selector).map((r) => r.body).join(';');
  const tokenIn = (body: string, name: string): string | undefined => new RegExp(`${name}\\s*:\\s*var\\((--rl-[\\w-]+)\\)`).exec(body)?.[1];
  /** The --side-* token the sheet tints an element's bottom edge with, read
   *  from every rule whose selector the element matches. */
  const tintOf = (el: Element): string[] => {
    const out: string[] = [];
    for (const r of rules) {
      const hit = r.sel.split(',').some((one) => {
        try { return el.matches(one.trim()); } catch { return false; }
      });
      const m = /border-bottom-color\s*:\s*var\((--side-[\w-]+)\)/.exec(r.body);
      if (hit && m !== null) out.push(m[1]!);
    }
    return out;
  };

  for (const variant of ['default', 'deuteranopia', 'protanopia', 'tritanopia'] as const) {
    it(`${variant}: --side-you and --side-friend are the resolver's own and hostile team colours`, () => {
      const body = variant === 'default' ? block(':root') : block(`:root[data-cvd='${variant}']`);
      const [kedem, hostile] = paletteTeamColors(variant);
      expect(hexOf(tokenIn(body, '--side-you') ?? '')).toBe(kedem.toLowerCase());
      expect(hexOf(tokenIn(body, '--side-friend') ?? '')).toBe(hostile.toLowerCase());
    });
  }

  it('no faction token survives and no faction-keyed rule tints anything; nothing else names a team colour for the lobby', () => {
    expect(css).not.toMatch(/--side-(kdf|sarim)/);
    expect(rules.filter((r) => /rl-versus/.test(r.sel) && /data-(faction|side)=/.test(r.sel) && /--side-/.test(r.body))).toEqual([]);
    expect(css).not.toMatch(/--vl-/);
    expect(rules.filter((r) => /rl-versus/.test(r.sel) && /--rl-team/.test(r.body))).toEqual([]);
  });

  it('on the pick screen: your card wears your colour and your friend\'s the other, a Sarim pick and a mirror alike', () => {
    const stage = mountPick(deps());
    const card = (who: string) => stage.querySelector<HTMLElement>(`.rl-versus__fcard[data-who="${who}"]`)!;
    // The mirror: two KDF cards, two colours.
    expect(tintOf(card('you'))).toEqual(['--side-you']);
    expect(tintOf(card('friend'))).toEqual(['--side-friend']);
    pick(sideRadio(stage, 'sarim'));
    expect(card('you').dataset.faction).toBe('sarim');
    expect(tintOf(card('you'))).toEqual(['--side-you']);
    expect(tintOf(card('friend'))).toEqual(['--side-friend']);
  });

  it('in the room: your seat wears your colour whichever seat and faction you hold', async () => {
    const { fake, stage } = await hostedRoom();
    const seat = (who: string) => stage.querySelector<HTMLElement>(`.rl-versus__seat[data-who="${who}"]`)!;
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum', ['sarim', 'kdf']);
    expect(seat('you').dataset.faction).toBe('sarim');
    expect(tintOf(seat('you'))).toEqual(['--side-you']);
    expect(tintOf(seat('friend'))).toEqual(['--side-friend']);
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum', ['kdf', 'kdf']);
    expect(tintOf(seat('you'))).toEqual(['--side-you']);
    expect(tintOf(seat('friend'))).toEqual(['--side-friend']);
  });

  it('the KDF / Sarim / Mirror segments are not faction-coloured: the checked one wears your colour', () => {
    const checked = rules.filter((r) => r.sel.split(',').map((x) => x.trim()).includes('.rl-versus__side:has(.rl-versus__side-radio:checked)'));
    expect(checked.some((r) => /border-bottom-color\s*:\s*var\(--side-you\)/.test(r.body))).toBe(true);
    expect(rules.filter((r) => /\.rl-versus__side\[data-side=/.test(r.sel) && /border/.test(r.body))).toEqual([]);
  });
});

describe('showVersusRoom (/versus/:code) with the lobby handed from /versus', () => {
  it('shows the code large, and takes the transport without a second open', async () => {
    const { d, stage } = await hostedRoom();
    expect(stage.querySelector('.rl-versus__code')?.textContent).toBe('ABCDEF');
    expect(d.open).toHaveBeenCalledTimes(1);
  });

  it('puts the big code where your friend will stand: in their empty card, spelled for a screen reader and announced; it moves out once they are in', async () => {
    const { fake, stage } = await hostedRoom();
    const friend = () => stage.querySelector<HTMLElement>('.rl-versus__seat[data-who="friend"]')!;
    const code = stage.querySelector<HTMLElement>('.rl-versus__code')!;
    expect(friend().dataset.empty).toBe('1');
    expect(friend().contains(code)).toBe(true);
    expect(friend().querySelector('.rl-versus__copy')).not.toBeNull();
    expect(code.getAttribute('aria-label')).toBe('A B C D E F');
    expect([...code.querySelectorAll('.rl-versus__code-char')].map((c) => c.textContent)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const live = stage.querySelector<HTMLElement>('.rl-versus__live')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    // The region enters the document EMPTY and is filled afterwards: a screen
    // reader announces a change to a live region, not a region that arrives
    // already holding its text (fix round 1, Important 1).
    expect(live.isConnected).toBe(true);
    expect(live.textContent).toBe('');
    await new Promise((r) => setTimeout(r, ANNOUNCE_AFTER_MOUNT_MS + 20));
    expect(live.textContent).toBe('Room ABCDEF is open. Send your friend the code or the link.');
    // The player lands on the control that sends it.
    expect(document.activeElement).toBe(friend().querySelector('.rl-versus__copy'));
    // The friend sits down: their card is theirs, and the code is still on screen.
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum');
    expect(friend().dataset.empty).toBeUndefined();
    expect(friend().textContent).toContain('Bo');
    expect(friend().querySelector('.rl-versus__code')).toBeNull();
    expect(stage.querySelector('.rl-versus__code')?.textContent).toBe('ABCDEF');
    expect(missingKeys()).toEqual([]);
  });

  it('keeps the focus on Copy link when the code moves out of the friend\'s card to the head', async () => {
    const { fake, stage } = await hostedRoom();
    const copy = stage.querySelector<HTMLButtonElement>('.rl-versus__copy')!;
    expect(document.activeElement).toBe(copy);
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum');
    expect(stage.querySelector('.rl-versus__head-end')?.contains(copy)).toBe(true);
    expect(document.activeElement).toBe(copy);
    // A focus elsewhere is left where it is.
    const ready = stage.querySelector<HTMLButtonElement>('.rl-versus__ready')!;
    ready.focus();
    fake.hooks.onLobby?.(SEATS_TWO, 0, 'tel_marum');
    expect(document.activeElement).toBe(ready);
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
    expect(stage.querySelector('img[onerror]')).toBeNull();
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
    expect(stage.querySelector('img[onerror]')).toBeNull();
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
    const leave = stage.querySelector<HTMLButtonElement>('.rl-versus__frame > .rl-foot [data-kind="back"]')!;
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
      stage.querySelector<HTMLButtonElement>('.rl-versus__frame > .rl-foot [data-kind="back"]')!.click();
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
    const open = vi.fn().mockResolvedValue(opened(transport, { seat: 1, lobby: { seats: SEATS_TWO, map: 'tel_marum', factions: ['kdf', 'kdf'], kit: 'matched' } }));
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

  it('a second try clears the last error, its tone with it', async () => {
    const open = vi.fn().mockRejectedValueOnce(new RoomRefused('full', 'x')).mockReturnValueOnce(new Promise<OpenedRoom>(() => {}));
    const stage = document.createElement('div');
    room(stage, 'ABCDEF', deps({ open }));
    const go = stage.querySelector<HTMLButtonElement>('.rl-versus__join')!;
    const msg = stage.querySelector<HTMLElement>('.rl-versus__msg')!;
    go.click();
    await flush();
    expect(msg.dataset.tone).toBe('bad');
    go.click();
    expect(msg.textContent).toBe('');
    expect(msg.dataset.tone).toBeUndefined();
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

// N4a Task 9 (decision D1): a seat invites its OWN advisor from the lobby, and
// both seat cards wear a badge for whichever advisors the room says are seated.
describe('the lobby: invite an advisor, and the advisor badge (N4a Task 9)', () => {
  const COMMAND = 'pnpm --silent agent -- --server https://game.test --code ABCDEF --scope assist --ticket-file ~/.roaring-lions/advisor-ticket';

  /** A lobby for `seat`, both seats in. */
  async function lobbyAs(seat: 0 | 1, over: Partial<VersusDeps> = {}) {
    const { fake, transport } = fakeTransport();
    const d = deps({ open: vi.fn().mockResolvedValue(opened(transport, { seat })), ...over });
    const entry = document.createElement('div');
    const leaveEntry = showVersus(entry, d);
    entry.querySelector<HTMLButtonElement>('.rl-versus__open')!.click();
    await flush();
    leaveEntry();
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    room(stage, 'ABCDEF', d);
    fake.hooks.onLobby?.(SEATS_TWO, seat, 'tel_marum');
    const cards = () => [...stage.querySelectorAll<HTMLElement>('.rl-versus__seat')];
    return { fake, d, stage, cards };
  }

  it('renders the control in the viewer\'s own seat card only, for either seat', async () => {
    for (const seat of [0, 1] as const) {
      const { cards, stage } = await lobbyAs(seat);
      // Your card first, your friend's across from it (the face-off), whichever seat you hold.
      expect(cards().map((c) => c.dataset.seat)).toEqual(seat === 0 ? ['0', '1'] : ['1', '0']);
      const has = cards().map((c) => c.querySelector('.rl-versus__advisor-invite') !== null);
      expect(has).toEqual([true, false]);
      expect(stage.querySelectorAll('.rl-versus__advisor-invite')).toHaveLength(1);
      document.body.replaceChildren();
    }
  });

  it('offers Advise (the default) and Assist, with a hint for the one chosen', async () => {
    const { stage } = await lobbyAs(0);
    const radios = [...stage.querySelectorAll<HTMLInputElement>('.rl-versus__advisor-scope input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['advise', 'assist']);
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    const hint = stage.querySelector('.rl-versus__advisor-hint')!;
    expect(hint.textContent).toMatch(/^Advise:/);
    radios[1]!.checked = true;
    radios[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(hint.textContent).toMatch(/^Assist:/);
  });

  it('mints a ticket for the chosen scope and shows the ready-to-paste command, the ticket nowhere in it', async () => {
    const { d, stage } = await lobbyAs(0);
    const assist = stage.querySelector<HTMLInputElement>('.rl-versus__advisor-scope input[value="assist"]')!;
    assist.checked = true;
    assist.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stage.querySelector('.rl-versus__advisor-command')).toBeNull();
    stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-mint')!.click();
    await flush();
    expect(d.advisorTicket).toHaveBeenCalledWith('ABCDEF', 'assist');
    const cmd = stage.querySelector('.rl-versus__advisor-command')!;
    expect(cmd.textContent).toBe(COMMAND);
    expect(cmd.textContent).toContain('--ticket-file ');
    expect(cmd.textContent).toContain('pnpm --silent agent');
    // The ticket is on the clipboard path alone: not in the command, a URL, an attribute or any text.
    expect(stage.textContent).not.toContain('ADV-TICKET-SECRET');
    expect(stage.innerHTML).not.toContain('ADV-TICKET-SECRET');
    expect(stage.querySelector('.rl-versus__advisor-note')?.textContent).toBe('Your advisor sees what your side sees. Your friend is told you have one.');
    expect(stage.querySelector('.rl-versus__advisor-file')?.textContent).toContain('~/.roaring-lions/advisor-ticket');
  });

  it('Copy ticket puts the ticket on the clipboard and says so; a refused copy says that', async () => {
    const { d, stage } = await lobbyAs(0);
    expect(stage.querySelector('.rl-versus__advisor-copy')).toBeNull();
    stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-mint')!.click();
    await flush();
    stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-copy')!.click();
    await flush();
    expect(d.copy).toHaveBeenCalledWith('ADV-TICKET-SECRET');
    expect(stage.querySelector('.rl-versus__advisor-copied')?.textContent).toBe('Ticket copied');
    (d.copy as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-copy')!.click();
    await flush();
    expect(stage.querySelector('.rl-versus__advisor-copied')?.textContent).toMatch(/^Copy failed/);
    expect(stage.textContent).not.toContain('ADV-TICKET-SECRET');
  });

  it('a changed scope retires the ticket and command shown for the old one', async () => {
    const { stage } = await lobbyAs(0);
    stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-mint')!.click();
    await flush();
    expect(stage.querySelector('.rl-versus__advisor-command')).not.toBeNull();
    const assist = stage.querySelector<HTMLInputElement>('.rl-versus__advisor-scope input[value="assist"]')!;
    assist.checked = true;
    assist.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stage.querySelector('.rl-versus__advisor-command')).toBeNull();
    expect(stage.querySelector('.rl-versus__advisor-copy')).toBeNull();
  });

  it('survives the lobby\'s repaint: a ready toggle does not lose the minted command', async () => {
    const { fake, stage } = await lobbyAs(0);
    stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-mint')!.click();
    await flush();
    fake.hooks.onLobby?.([{ ...SEATS_TWO[0]!, ready: true }, SEATS_TWO[1]!], 0, 'tel_marum');
    expect(stage.querySelector('.rl-versus__advisor-command')?.textContent).toContain('--scope advise');
    expect(stage.querySelectorAll('.rl-versus__advisor-invite')).toHaveLength(1);
  });

  it('a refusal (403) says the advisor failed, shows no command, and lets the player ask again', async () => {
    const advisorTicket = vi.fn().mockRejectedValueOnce(new AdvisorRefused(403)).mockResolvedValue('ADV-TICKET-SECRET');
    const { stage } = await lobbyAs(0, { advisorTicket });
    const mint = stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-mint')!;
    mint.click();
    await flush();
    const status = stage.querySelector('.rl-versus__advisor-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('The room refused the advisor ticket. Try again.');
    expect(stage.querySelector('.rl-versus__advisor-command')).toBeNull();
    expect(mint.disabled).toBe(false);
    mint.click();
    await flush();
    expect(status.textContent).toBe('');
    expect(stage.querySelector('.rl-versus__advisor-command')).not.toBeNull();
  });

  it('asks once at a time: a second click while the room is answering does nothing', async () => {
    let resolve!: (t: string) => void;
    const advisorTicket = vi.fn().mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const { stage } = await lobbyAs(0, { advisorTicket });
    const mint = stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-mint')!;
    mint.click();
    mint.click();
    expect(advisorTicket).toHaveBeenCalledTimes(1);
    expect(mint.disabled).toBe(true);
    resolve('ADV-TICKET-SECRET');
    await flush();
    expect(mint.disabled).toBe(false);
  });

  it('the badge on each seat card follows the room\'s advisors, seat by seat', async () => {
    const { fake, cards } = await lobbyAs(0);
    const badges = () => cards().map((c) => c.querySelector('.rl-versus__advisor-badge')?.textContent ?? null);
    expect(badges()).toEqual([null, null]);
    fake.hooks.onAdvisors?.(['advise', null]);
    expect(badges()).toEqual(['Advisor: advise', null]);
    fake.hooks.onAdvisors?.([null, 'assist']);
    expect(badges()).toEqual([null, 'Advisor: assist']);
    fake.hooks.onAdvisors?.(['assist', 'advise']);
    expect(badges()).toEqual(['Advisor: assist', 'Advisor: advise']);
    fake.hooks.onAdvisors?.([null, null]);
    expect(badges()).toEqual([null, null]);
  });

  it('the badge survives a lobby repaint and shows on the friend\'s card too', async () => {
    const { fake, cards } = await lobbyAs(1);
    fake.hooks.onAdvisors?.(['advise', null]);
    fake.hooks.onLobby?.(SEATS_TWO.map((s) => ({ ...s, ready: true })), 1, 'tel_marum');
    const seat0 = cards().find((c) => c.dataset.seat === '0')!;
    expect(seat0.dataset.who).toBe('friend');
    expect(seat0.querySelector('.rl-versus__advisor-badge')?.textContent).toBe('Advisor: advise');
    expect(seat0.querySelector('.rl-versus__advisor-invite')).toBeNull();
  });

  it('every string it draws went through t()', async () => {
    const advisorTicket = vi.fn().mockRejectedValueOnce(new AdvisorRefused(403)).mockResolvedValue('ADV-TICKET-SECRET');
    const { fake, stage } = await lobbyAs(0, { advisorTicket });
    fake.hooks.onAdvisors?.(['advise', 'assist']);
    const mint = stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-mint')!;
    mint.click();
    await flush();
    mint.click();
    await flush();
    stage.querySelector<HTMLButtonElement>('.rl-versus__advisor-copy')!.click();
    await flush();
    const assist = stage.querySelector<HTMLInputElement>('.rl-versus__advisor-scope input[value="assist"]')!;
    assist.checked = true;
    assist.dispatchEvent(new Event('change', { bubbles: true }));
    expect(missingKeys()).toEqual([]);
  });
});
