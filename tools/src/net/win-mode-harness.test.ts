// GH-976 P2: the bot harness learns a win mode. `observe` carries the mode, the points and each zone's holder; `status` carries
// `by` and the mode; a mode room has no economy to show or to order; the standing prompt says how the mode is won; `--mode`
// reaches the bot, the harness and the arena, and a room that plays another mode than the one the player was told is refused.
// Real rooms (the room's own Worker code over the fake Durable Object), real worlds, stub players: no model anywhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versusModes } from '@lions/data';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';
import { pointsViewOf } from '../../../packages/app/src/net/points-view';
import { flagViewOf } from '../../../packages/app/src/net/flag-view';
import { flagOrder, modeConfig, pointsOrder, raidParty } from '../backtest/versus-modes';
import { AgentClient } from './agent-client';
import { parseArgs as parseAgentArgs } from './agent';
import { parseArgs as parseArenaArgs, refusalOf, resolvePlayer, runArena, untrusted } from './arena';
import type { GameRecord } from './arena-score';
import { inProcess, type Policy } from './players';
import { economyView, buildRefusal, productionRefusal } from './economy-view';
import { botMcpConfig, botPrompt, parseBotArgs } from './bot';
import { mcpConfig, standingPrompt } from './external-player';
import { FogTracker } from './fog-tracker';
import { createContext, TOOLS, type ToolContext } from './mcp-tools';
import { ROOM_BUILD, ROOM_CODE, ROOM_NOW, newRoom, play, type Loop } from './test-room';
import { sideView } from './view';
import { ANNIHILATION_RULE, applyWinRule, modeFlag } from './win-rule';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT = readFileSync(join(HERE, 'arena-prompt.md'), 'utf8');

const world = (map: 'wadi_tarfan' | 'milh_flats' = 'wadi_tarfan', seed = 4000) => buildMatchWorld(modeConfig(map, 'points', seed));
const zoneNames = (map: string): string[] => versusModes[map].modes.points?.zones.map((z) => z.zone) ?? [];

/** A points world played `ticks` ticks with both seats attack-moving on the zones (the probe's own play). */
function played(map: 'wadi_tarfan' | 'milh_flats', ticks: number) {
  const w = world(map);
  const fogs = [new FogTracker(w.sim, 0), new FogTracker(w.sim, 1)] as const;
  for (let t = 0; t < ticks; t++) {
    if (t % 400 === 0) pointsOrder(w, zoneNames(map), -1);
    matchTick(w);
    fogs[0].step(); fogs[1].step();
  }
  return { w, fogs };
}

describe('observe in a points room (GH-976 P2)', () => {
  it('names the mode, both sides\' points, the target and every zone with its holder, in the order of the mode file', () => {
    const { w, fogs } = played('wadi_tarfan', 2400);
    const v = sideView(w, 0, fogs[0], null);
    expect(v.mode).toBe('points');
    expect(v.points?.target).toBe(600);
    expect(v.points?.zones.map((z) => z.zone)).toEqual(zoneNames('wadi_tarfan'));
    expect(v.points?.zones.every((z) => z.at.length === 4)).toBe(true);
    // The numbers are the runtime's own, not a copy: the very function the browser's HUD calls.
    expect(v.points).toEqual(pointsViewOf(w.runtime!, versusModes.wadi_tarfan.modes.points!, 0));
    expect(v.points!.mine + v.points!.theirs).toBeGreaterThan(0);   // two minutes of play banked something
    expect(v.points!.zones.some((z) => z.holder !== 'none')).toBe(true);
    // A points room has no economy: the runtime is there, but it runs goals only.
    expect(v).not.toHaveProperty('economy');
  });

  it('both seats read one board from their own side: mine and theirs swap, the zones and their holders agree', () => {
    const { w, fogs } = played('milh_flats', 2400);
    const a = sideView(w, 0, fogs[0], null).points!;
    const b = sideView(w, 1, fogs[1], null).points!;
    expect([b.mine, b.theirs, b.target]).toEqual([a.theirs, a.mine, a.target]);
    const flip = { mine: 'theirs', theirs: 'mine', contested: 'contested', none: 'none' } as const;
    expect(b.zones.map((z) => z.holder)).toEqual(a.zones.map((z) => flip[z.holder]));
  });

  it('fog: the points board names no unit, and the contacts are still only what the seat sees', () => {
    const { w, fogs } = played('wadi_tarfan', 1200);
    const v = sideView(w, 0, fogs[0], null);
    // Scores and zone holders are public by design; a unit is never part of them.
    expect(JSON.stringify(v.points)).not.toMatch(/"(id|type|hp|tile|units|contacts)"/);
    expect(Object.keys(v.points!).sort()).toEqual(['mine', 'mineRate', 'target', 'theirs', 'theirsRate', 'zones']);
    for (const z of v.points!.zones) expect(Object.keys(z).sort()).toEqual(['at', 'holder', 'perMin', 'zone']);
    // Every contact is one the seat's own fog can see (the renderer's rule), exactly as in an annihilation room.
    for (const c of v.contacts) expect(fogs[0].visibleTile(c.tile[0], c.tile[1]), `contact ${c.id} at ${c.tile}`).toBe(true);
    const annihilation = sideView(buildMatchWorld(modeConfig('wadi_tarfan', 'points', 4000)), 0, new FogTracker(w.sim, 0), null);
    expect(annihilation.contacts.length).toBeLessThanOrEqual(w.sim.entityCount);   // sanity: the view is a view, not the roster
  });

  it('an annihilation room says so, and has no points', () => {
    const w = buildMatchWorld({ ...modeConfig('wadi_tarfan', 'points', 4000), winMode: undefined });
    const v = sideView(w, 0, new FogTracker(w.sim, 0), null);
    expect(v.mode).toBe('annihilation');
    expect(v).not.toHaveProperty('points');
    expect(v.by).toBeNull();
  });

  it('carries how the match was decided once it was', () => {
    const w = world();
    const fog = new FogTracker(w.sim, 0);
    expect(sideView(w, 0, fog, 'won (objective)', 'objective')).toMatchObject({ result: 'won (objective)', by: 'objective' });
    expect(sideView(w, 0, fog, null).by).toBeNull();
  });
});

describe('observe in a flag room (GH-976 P3)', () => {
  const flagWorld = (map: 'wadi_tarfan' | 'milh_flats' = 'wadi_tarfan', seed = 4000) => buildMatchWorld(modeConfig(map, 'flag', seed));
  const ends = (w: ReturnType<typeof flagWorld>): [0 | 1, 0 | 1] => [w.endOfSide[0] === 'friendly' ? 0 : 1, w.endOfSide[0] === 'friendly' ? 1 : 0];

  it('names the mode and both flags: where, the hold, and how each raid stands, from the same function as the browser\'s marks', () => {
    for (const map of ['wadi_tarfan', 'milh_flats'] as const) {
      const w = flagWorld(map);
      const fog = new FogTracker(w.sim, 0);
      const v = sideView(w, 0, fog, null);
      expect(v.mode).toBe('flag');
      const f = versusModes[map].flags!;
      expect(v.flags).toEqual(flagViewOf(w.runtime!, { flags: f, modes: versusModes[map].modes }, 0, w.endOfSide[0]));
      expect(v.flags!.holdSeconds).toBe(30);
      // Side 0 stands at the friendly end of a mirror room: it defends the friendly flag and raids the hostile one.
      expect(v.flags!.mine.at).toEqual([f.friendly.at[0], f.friendly.at[1], f.friendly.size[0], f.friendly.size[1]]);
      expect(v.flags!.theirs.at).toEqual([f.hostile.at[0], f.hostile.at[1], f.hostile.size[0], f.hostile.size[1]]);
      expect([v.flags!.mine.state, v.flags!.theirs.state]).toEqual(['open', 'open']);
      expect(v).not.toHaveProperty('points');
      expect(v).not.toHaveProperty('economy');
    }
  });

  it('a seat at the other end reads the same board from its own side: mine and theirs swap', () => {
    const w = flagWorld();
    const a = sideView(w, 0, new FogTracker(w.sim, 0), null).flags!;
    const b = sideView(w, 1, new FogTracker(w.sim, 1), null).flags!;
    expect(b.mine.at).toEqual(a.theirs.at);
    expect(b.theirs.at).toEqual(a.mine.at);
  });

  it('follows a raid: open, then raiding with the seconds held, and captured at the end; the defender sees its own flag raided', () => {
    const w = flagWorld();
    const parties = new Map<number, readonly number[]>([[0, raidParty(w, 0)], [1, raidParty(w, 1)]]);
    const seen: string[] = [];
    let raiding: { held: number } | null = null;
    // Side 1 stays home; side 0's raid walks to the hostile flag and holds it.
    for (let t = 0; t < 2000; t++) {
      if (t % 400 === 0) flagOrder(w, 'wadi_tarfan', parties, new Set([1]), ends(w));
      matchTick(w);
      if (t % 20 === 0) {
        const mine = sideView(w, 0, new FogTracker(w.sim, 0), null).flags!;
        const theirs = sideView(w, 1, new FogTracker(w.sim, 1), null).flags!;
        // The two seats read ONE raid: side 0's `theirs` is side 1's `mine`.
        expect(theirs.mine.state).toBe(mine.theirs.state);
        expect(theirs.mine.held).toBe(mine.theirs.held);
        seen.push(mine.theirs.state);
        if (mine.theirs.state === 'raiding') raiding = { held: mine.theirs.held };
      }
    }
    expect(seen[0]).toBe('open');
    expect(raiding).not.toBeNull();
    expect(seen).toContain('raiding');
    expect(seen.at(-1)).toBe('captured');
  });

  it('fog: the flag board names no unit, and says nothing a points room or an annihilation room would not', () => {
    const w = flagWorld();
    const v = sideView(w, 0, new FogTracker(w.sim, 0), null);
    expect(JSON.stringify(v.flags)).not.toMatch(/"(id|type|hp|tile|units|contacts)"/);
    expect(Object.keys(v.flags!).sort()).toEqual(['holdSeconds', 'mine', 'theirs']);
    for (const line of [v.flags!.mine, v.flags!.theirs]) expect(Object.keys(line).sort()).toEqual(['at', 'held', 'state']);
    const annihilation = sideView(buildMatchWorld({ ...modeConfig('wadi_tarfan', 'flag', 4000), winMode: undefined }), 0, new FogTracker(w.sim, 0), null);
    expect(annihilation).not.toHaveProperty('flags');
  });
});

describe('a points room has no economy to show or to order (the runtime is there; its lines and purse are not)', () => {
  it('economyView is null, and a production order is refused in words, not run against a goals-only runtime', () => {
    const w = world();
    expect(w.runtime).not.toBeNull();
    expect(economyView(w, 0)).toBeNull();
    expect(buildRefusal(w, 0, 'inf_squad')).toBe('this room has no production');
    expect(productionRefusal(w, 0, { kind: 'build', side: 0, unit: 'inf_squad' })).toBeNull();   // ownership already drops it: no refusal text to add
  });
  it('the control: a KDF-against-Sarim room still shows its economy', () => {
    const w = buildMatchWorld({ ...modeConfig('wadi_tarfan', 'points', 4000), winMode: undefined, seats: modeConfig('wadi_tarfan', 'points', 4000).seats.map((s, i) => ({ ...s, faction: i === 0 ? 'kdf' : 'sarim', side: i === 0 ? 0 : 1 })) as never });
    expect(w.winMode).toBeNull();
    expect(economyView(w, 0)).not.toBeNull();
  });
});

describe('the standing prompt says how the mode is won (GH-976 P2)', () => {
  const numbered = (text: string): number[] => [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  it('annihilation is the prompt as it stands, byte for byte', () => {
    expect(applyWinRule(PROMPT, null)).toBe(PROMPT);
    expect(standingPrompt({ seat: 1, code: 'ABCDEF' })).toBe(standingPrompt({ seat: 1, code: 'ABCDEF', winMode: null }));
    expect(PROMPT).toContain(ANNIHILATION_RULE.join('\n'));   // the swap\'s expectation is the file\'s text, line for line
  });
  it('a points prompt replaces the annihilation rule with the race, adds what to defend, and keeps the list numbered 1 to 11', () => {
    const p = standingPrompt({ seat: 1, code: 'ABCDEF', winMode: 'points' });
    expect(p).not.toContain(ANNIHILATION_RULE[0]);
    expect(p).toContain('POINTS RACE');
    expect(p).toContain('`observe` shows `points`');
    expect(p).toMatch(/^8\. Defend the ground you hold/m);
    expect(numbered(p.slice(p.indexOf('## The game'), p.indexOf('## You'))))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(p).toContain('in eleven lines');
    expect(p).toMatch(/^9\. The arena may also stop/m);
    expect(p).toMatch(/^11\. Positions are TILES/m);
    expect(p).toContain('You are seat 1 in match ABCDEF.');
    // the rest of the prompt is untouched
    expect(p.slice(p.indexOf('## You'))).toBe(PROMPT.slice(PROMPT.indexOf('## You')).replace('{seat}', '1').replace('{code}', 'ABCDEF'));
  });
  it('refuses to swap when the prompt no longer holds the lines it expects (a silently wrong prompt is worse than none)', () => {
    expect(() => applyWinRule(PROMPT.replace('(annihilation)', '(wipe-out)'), 'points')).toThrow(/lines 6 and 7/);
    expect(() => applyWinRule(PROMPT.replace('9. Losing units', '9. Losses'), 'points')).toThrow(/renumber/);
  });
  it('--mode is a known win mode or annihilation, nothing else', () => {
    expect([modeFlag('points'), modeFlag('camp'), modeFlag('annihilation'), modeFlag('flag'), modeFlag('rally'), modeFlag('')]).toEqual(['points', 'camp', null, 'flag', undefined, undefined]);
  });
});

describe('pnpm bot --mode', () => {
  const base = ['--room', 'ABCDEF'];
  it('is optional, accepts points, and refuses what is not a mode', () => {
    expect(parseBotArgs(base)).not.toHaveProperty('winMode');
    expect(parseBotArgs([...base, '--mode=points'])).toMatchObject({ winMode: 'points' });
    expect(parseBotArgs([...base, '--mode', 'points'])).toMatchObject({ winMode: 'points' });
    expect(parseBotArgs([...base, '--mode=annihilation'])).toMatchObject({ winMode: null });
    const bad = parseBotArgs([...base, '--mode=rally']);
    expect('error' in bad && bad.error).toMatch(/--mode is annihilation\|camp\|points\|flag/);
    expect(parseBotArgs([...base, '--mode=flag'])).toMatchObject({ winMode: 'flag' });
  });
  it('the prompt and the harness\'s arguments follow it; without it neither mentions a mode', () => {
    const withMode = botPrompt({ room: 'ABCDEF', seat: 1, winMode: 'points' });
    expect(withMode).toContain('POINTS RACE');
    expect(withMode).toContain('observe` names the `mode`');   // the addendum\'s own fallback, always there
    expect(botPrompt({ room: 'ABCDEF', seat: 1 })).not.toContain('POINTS RACE');
    expect(botPrompt({ room: 'ABCDEF', seat: 1 })).toContain('observe` names the `mode`');
    const args = (m: 'points' | null | undefined) => botMcpConfig({ server: 'http://x', room: 'ABCDEF', ...(m === undefined ? {} : { winMode: m }) }, '/t', '/l').mcpServers.lions.args;
    expect(args('points').slice(-2)).toEqual(['--mode', 'points']);
    expect(args(null).slice(-2)).toEqual(['--mode', 'annihilation']);
    expect(args(undefined)).not.toContain('--mode');
  });
  it('the arena\'s external players get the same: the prompt and the harness\'s --mode', () => {
    const s = { server: 'http://x', origin: 'http://x', code: 'ABCDEF', build: 'b' };
    expect(mcpConfig({ ...s, winMode: 'points' }, '/t').mcpServers.lions.args.slice(-2)).toEqual(['--mode', 'points']);
    expect(mcpConfig(s, '/t').mcpServers.lions.args).not.toContain('--mode');
    expect(standingPrompt({ seat: 0, code: 'ABCDEF', winMode: 'points' })).toContain('POINTS RACE');
  });
});

describe('pnpm agent --mode, and a room that plays another mode than the player was told', () => {
  const need = { server: 'http://x', code: 'ABCDEF', scope: 'command', 'ticket-file': '/t' };
  const argv = (extra: string[]) => Object.entries(need).flatMap(([k, v]) => [`--${k}`, v]).concat(extra);
  it('parses --mode, and refuses a value that is not one', () => {
    expect(parseAgentArgs(argv([]))).not.toHaveProperty('mode');
    expect(parseAgentArgs(argv(['--mode', 'points']))).toMatchObject({ mode: 'points' });
    expect(parseAgentArgs(argv(['--mode', 'annihilation']))).toMatchObject({ mode: null });
    expect('error' in parseAgentArgs(argv(['--mode', 'rally']))).toBe(true);
  });

  beforeEach(() => { vi.useFakeTimers({ now: ROOM_NOW }); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  const seat = async (winMode: string | undefined, expectWinMode: 'points' | null | undefined) => {
    const room = await newRoom({ map: 'wadi_tarfan', ...(winMode === undefined ? {} : { winMode }) });
    const open = (loop: Loop, seatNo: 0 | 1, ticket: string, expect_?: typeof expectWinMode) => {
      let sock: ReturnType<Loop['open']> | null = null;
      const client = new AgentClient({
        server: 'https://room.test', code: ROOM_CODE, ticket, build: ROOM_BUILD, role: 'seat', seat: seatNo, log: () => {},
        open: () => { sock = loop.open(); return sock; }, ...(expect_ === undefined ? {} : { expectWinMode: expect_ }),
      });
      return { client, sock: () => sock };
    };
    const a = open(room.loop, 0, await room.ticket(0), expectWinMode);
    const b = open(room.loop, 1, await room.ticket(1));
    await room.loop.flush();
    await Promise.allSettled([a.client.ready, b.client.ready]);
    await play(room.loop, 4, [a.client, b.client], () => a.client.world() !== null || a.client.failed() !== null);
    return { a: a.client, b: b.client };
  };

  it('plays the room whose mode it was told, and sees it in its view and its status', async () => {
    const { a, b } = await seat('points', 'points');
    expect(a.failed()).toBeNull();
    expect(a.view().mode).toBe('points');
    expect(a.view().points?.target).toBe(600);
    expect(b.view().mode).toBe('points');
    const ctx: ToolContext = createContext(a, 'command');
    const status = JSON.parse((await TOOLS.find((t) => t.name === 'status')!.run(ctx, {})).text) as Record<string, unknown>;
    expect(status).toMatchObject({ mode: 'points', by: null, result: null });
    const observed = JSON.parse((await TOOLS.find((t) => t.name === 'observe')!.run(ctx, {})).text) as Record<string, unknown>;
    expect(observed).toMatchObject({ mode: 'points', by: null });
    expect(observed.points).toMatchObject({ target: 600 });
    expect(observed).not.toHaveProperty('economy');
  });

  it('refuses a room that plays another mode, before the player moves, and says what to do', async () => {
    const wrongWay = await seat('points', null);   // told annihilation, the room plays points
    expect(wrongWay.a.world()).toBeNull();
    expect(wrongWay.a.failed()).toMatch(/the room plays points, but this player was told annihilation: start it with --mode points/);
    const other = await seat(undefined, 'points');   // told points, the room plays annihilation
    expect(other.a.world()).toBeNull();
    expect(other.a.failed()).toMatch(/the room plays annihilation, but this player was told points/);
  });

  it('a player told nothing is not checked: it plays any room', async () => {
    const { a } = await seat('points', undefined);
    expect(a.failed()).toBeNull();
    expect(a.world()).not.toBeNull();
  });
});

describe('pnpm arena --mode', () => {
  const base = ['--a', 'passive', '--b', 'passive', '--map', 'wadi_tarfan'];
  it('parses --mode=points and --mode points; annihilation is no mode; anything else is an error', () => {
    expect(parseArenaArgs(base)).not.toHaveProperty('winMode');
    expect(parseArenaArgs([...base, '--mode=points'])).toMatchObject({ winMode: 'points' });
    expect(parseArenaArgs([...base, '--mode', 'points'])).toMatchObject({ winMode: 'points' });
    expect(parseArenaArgs([...base, '--mode=annihilation'])).not.toHaveProperty('winMode');
    const bad = parseArenaArgs([...base, '--mode=rally']);
    expect('error' in bad && bad.error).toMatch(/--mode is annihilation\|camp\|points\|flag/);
    expect(parseArenaArgs([...base, '--mode=flag'])).toMatchObject({ winMode: 'flag' });
  });
  it('the cap defaults to the map\'s own with a mode (a points game outlasts 12,000 ticks), and to 12,000 without; an explicit one wins', () => {
    const cap = (extra: string[], map = 'wadi_tarfan') => (parseArenaArgs(['--a', 'passive', '--b', 'passive', '--map', map, ...extra]) as { capTicks: number }).capTicks;
    expect(cap([])).toBe(12_000);
    expect(cap(['--mode=annihilation'])).toBe(12_000);
    expect(cap(['--mode=points'])).toBe(25 * 60 * 20);
    expect(cap(['--mode', 'points'], 'milh_flats')).toBe(25 * 60 * 20);
    expect(cap(['--mode=points', '--cap-ticks=5000'])).toBe(5000);
  });
  const numbered = (text: string): number[] => [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  it('a flag prompt replaces the annihilation rule with the raid, says what `flags` holds, and keeps the list numbered 1 to 11', () => {
    const p = standingPrompt({ seat: 0, code: 'ABCDEF', winMode: 'flag' });
    expect(p).not.toContain(ANNIHILATION_RULE[0]);
    expect(p).toContain('CAPTURING THE ENEMY FLAG');
    expect(p).toContain('`observe` shows `flags`');
    expect(p).toMatch(/^8\. Defend your own flag ground/m);
    expect(numbered(p.slice(p.indexOf('## The game'), p.indexOf('## You')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(p).toContain('in eleven lines');
  });
  it('GH-976 P3: a points prompt says the cap is decided on the points, and a flag or camp prompt still says surviving force', () => {
    const points = standingPrompt({ seat: 1, code: 'ABCDEF', winMode: 'points' });
    expect(points).toMatch(/^7\. .*MORE POINTS wins and level points draw/m);
    expect(points).not.toMatch(/^7\. .*nobody reaches the target.*larger surviving force value wins; equal values draw/m);
    for (const mode of ['flag', 'camp'] as const) expect(standingPrompt({ seat: 1, code: 'ABCDEF', winMode: mode })).toMatch(/^7\. .*the side with the larger surviving force value wins; equal values draw/m);
  });
  it('refuses, as the lobby would not offer it, a mode unfair on the map or off the mirror (exit 2, before any room)', () => {
    expect(refusalOf('wadi_tarfan', 'mirror', 'points')).toBeNull();
    expect(refusalOf('milh_flats', 'mirror', 'points')).toBeNull();
    expect(refusalOf('tel_marum', 'mirror', 'points')).toBeNull();   // GH-976 P4: the five other open maps
    expect(refusalOf('wadi_tarfan', 'mirror', 'camp')).toBeNull();   // GH-976, 5 Nov: forward camps with wipe after_camp
    expect(refusalOf('wadi_tarfan_l', 'mirror', 'camp')).toBeNull();
    expect(refusalOf('rujm_sawda', 'mirror', 'camp')).toMatch(/not offered on this map/);
    expect(refusalOf('wadi_tarfan', 'mirror', 'flag')).toBeNull();
    expect(refusalOf('milh_flats', 'mirror', 'flag')).toBeNull();
    expect(refusalOf('tel_marum', 'mirror', 'flag')).toBeNull();
    expect(refusalOf('tel_marum', 'mirror', 'camp')).toMatch(/not offered on this map/);
    // GH-976 P4 review: no KDF-against-Sarim cell passed, so every faction pairing is refused for every mode.
    expect(refusalOf('wadi_tarfan_l', 'kdf', 'points')).toMatch(/not offered on this map for this matchup/);
    expect(refusalOf('wadi_tarfan_l', 'sarim', 'points')).toMatch(/not offered on this map for this matchup/);
    expect(refusalOf('wadi_tarfan_l', 'kdf', 'flag')).toMatch(/not offered on this map for this matchup/);
    expect(refusalOf('wadi_tarfan', 'kdf', 'flag')).toMatch(/not offered on this map for this matchup/);
    expect(refusalOf('wadi_tarfan', 'sarim', 'points')).toMatch(/not offered on this map for this matchup/);
    expect(refusalOf('tel_marum', 'sarim', 'points')).toMatch(/not offered on this map for this matchup/);
    expect(refusalOf('milh_flats', 'kdf', 'points')).toMatch(/matchup is not offered on milh_flats \(mirror only\)/);   // a mirror-only map refuses the pairing first
    expect(refusalOf('wadi_tarfan', 'mirror')).toBeNull();   // annihilation: as ever
  });
  it('does not trust a room that started on another mode than it asked for', () => {
    const config = (winMode?: 'points') => ({ ...modeConfig('wadi_tarfan', 'points', 4000), ...(winMode === undefined ? { winMode: undefined } : { winMode }) });
    const a = { pace: 40, roundWallMs: 1000, map: 'wadi_tarfan', matchup: 'mirror' as const };
    const paced = (c: ReturnType<typeof config>) => ({ ...c, pace: { kind: 'paced' as const, roundTicks: 40, roundWallMs: 1000 }, seed: 5 });
    expect(untrusted(paced(config('points')), { ...a, winMode: 'points' }, 5)).toBeNull();
    expect(untrusted(paced(config()), { ...a, winMode: 'points' }, 5)).toMatch(/started on annihilation, not points/);
    expect(untrusted(paced(config('points')), a, 5)).toMatch(/started on points, not annihilation/);
  });
});

// One real points race, end to end: the Worker's own routes and room on the local relay, two in-process players (a stub that
// sends its idle units to the nearest zones it does not hold, and a passive control), the referee's tally, the report.
describe('a points race played through the arena (GH-976 P2)', () => {
  const tileCentre = (t: number): number => (t + 0.5) * 65536;
  /** The stub: idle units attack-move to the three zones nearest its camp that it does not hold. No model, no fog cheat: it reads `observe` only. */
  const zoneStub: Policy = (view) => {
    const targets = (view.points?.zones ?? []).filter((z) => z.holder !== 'mine')
      .map((z) => ({ x: z.at[0] + z.at[2] / 2, y: z.at[1] + z.at[3] / 2 }))
      .sort((a, b) => Math.hypot(a.x - view.camp[0], a.y - view.camp[1]) - Math.hypot(b.x - view.camp[0], b.y - view.camp[1]))
      .slice(0, 3);
    const idle = view.units.filter((u) => u.flags.includes('idle')).map((u) => u.id);
    if (targets.length === 0 || idle.length === 0) return [];
    return targets.map((t, k) => ({ kind: 'attackMove' as const, ids: idle.filter((_, i) => i % targets.length === k), x: tileCentre(Math.floor(t.x)), y: tileCentre(Math.floor(t.y)) })).filter((c) => c.ids.length > 0);
  };

  it('decides on the goal: the stub reaches the target against a passive seat from either seat, the record and the report say so', async () => {
    const out = mkdtempSync(join(tmpdir(), 'win-mode-arena-'));
    try {
      const lines: string[] = [];
      const games: GameRecord[] = [];
      const run = await runArena(
        ['--a', 'cmd:stub', '--b', 'passive', '--seeds', '1', '--first-seed', '0', '--map', 'wadi_tarfan', '--mode=points', '--pace', '600', '--tick-ms', '1', '--cap-ticks', '24000', '--out', out],
        {
          log: (l) => { lines.push(l); }, print: () => {},
          resolvePlayer: (spec, log) => (spec === 'cmd:stub' ? inProcess('cmd:stub', zoneStub, { log }) : resolvePlayer(spec, log)),
          onGameEnd: ({ record }) => { games.push(record); },
        },
      );
      expect(run.code, lines.join('\n')).toBe(0);
      expect(games).toHaveLength(2);
      for (const g of games) {
        expect(g.mode).toBe('points');
        expect(g.outcome, `${g.players} ${g.by}`).toBe(g.players[0] === 'Player A' ? 'seat0' : 'seat1');
        expect(g.by).toBe('objective');
        expect(g.ticks).toBeLessThan(24000);
        // the referee\'s stats: the winner reached the target, from zones above all, the loser banked less
        const winnerSeat = g.outcome === 'seat0' ? 0 : 1;
        const stats = g.referee!;
        expect(stats.mode).toBe('points');
        expect(stats.target).toBe(600);
        expect(stats.seats[winnerSeat].points!.total).toBeGreaterThanOrEqual(600);
        expect(stats.seats[winnerSeat].points!.fromZones).toBeGreaterThan(stats.seats[winnerSeat].points!.fromKills);
        expect(stats.seats[1 - winnerSeat].points!.total).toBeLessThan(600);
      }
      const md = readFileSync(join(out, readdirSync(out).find((f) => f.endsWith('.md')) ?? ''), 'utf8');
      expect(md).toMatch(/^# Arena: wadi_tarfan, mirror, points$/m);
      expect(md).toContain('| objective | points race |');
      expect(md).toContain('Points by source');
      expect(lines.some((l) => /\(objective\) at tick/.test(l))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 280_000);
});

// GH-976 P4: a KDF-v-Sarim mode room (not offered today: the arena refuses it) is a PLACED-force match (no production, no tunnels,
// a goals-only runtime), so the harness shows no economy.
describe('a KDF-against-Sarim mode room, and the arena that refuses to start one (GH-976 P4)', () => {
  it('observe in a faction mode room: each seat reads its own faction, the board and no economy', () => {
    const w = buildMatchWorld(modeConfig('wadi_tarfan_l', 'points', 4000, ['sarim', 'kdf']));
    expect(w.factions).toEqual(['kdf', 'sarim']);
    const sarimSeat = sideView(w, 1, new FogTracker(w.sim, 1), null);
    const kdfSeat = sideView(w, 0, new FogTracker(w.sim, 0), null);
    expect([sarimSeat.faction, kdfSeat.faction]).toEqual(['sarim', 'kdf']);
    expect(sarimSeat.mode).toBe('points');
    expect(sarimSeat.points?.target).toBe(600);
    expect(sarimSeat).not.toHaveProperty('economy');   // the room is NOT an economy room, though the factions differ
    expect(economyView(w, 1)).toBeNull();
    // A Sarim host stands at the friendly end (the west): its camp point is the friendly anchor, the KDF seat's the hostile one.
    expect(sarimSeat.camp).toEqual([w.anchors.friendly[0], w.anchors.friendly[1]]);
    expect(kdfSeat.camp).toEqual([w.anchors.hostile[0], w.anchors.hostile[1]]);
  });

  it('the arena refuses the pairing before any room: no faction cell is offered (exit 2)', async () => {
    const lines: string[] = [];
    const run = await runArena(['--a', 'passive', '--b', 'passive', '--seeds', '1', '--map', 'wadi_tarfan_l', '--matchup', 'kdf', '--mode=points', '--out', '/nonexistent-arena-out'], { log: (l) => { lines.push(l); }, print: () => {} });
    expect(run.code).toBe(2);
    expect(lines.join('\n')).toMatch(/not offered on this map for this matchup/);
  });
});

// One real flag raid, end to end: the Worker's route and room, two in-process players (a stub that sends two infantry squads at
// the enemy flag and leaves the rest where they stand, and a passive control), the referee's tally and the report.
describe('a flag raid played through the arena (GH-976 P3)', () => {
  const tileCentre = (t: number): number => (t + 0.5) * 65536;
  /** The stub reads `observe` only: its first two infantry squads, ordered once on the middle of the flag `observe` names as `theirs`. */
  let sent = false;
  let lastTick = -1;
  const raidStub: Policy = (view) => {
    if (view.tick < lastTick) sent = false; // a new game
    lastTick = view.tick;
    if (sent || view.flags === undefined) return [];
    const squads = view.units.filter((u) => u.type === 'inf_squad').slice(0, 2).map((u) => u.id);
    if (squads.length < 2) return [];
    sent = true;
    const [x, y, w, h] = view.flags.theirs.at;
    return [{ kind: 'attackMove' as const, ids: squads, x: tileCentre(Math.floor(x + w / 2)), y: tileCentre(Math.floor(y + h / 2)) }];
  };

  it('decides on the flag: the raid captures against a passive seat from either seat, the record and the report say so', async () => {
    const out = mkdtempSync(join(tmpdir(), 'flag-arena-'));
    try {
      const lines: string[] = [];
      const games: GameRecord[] = [];
      const run = await runArena(
        ['--a', 'cmd:raid', '--b', 'passive', '--seeds', '1', '--first-seed', '0', '--map', 'wadi_tarfan', '--mode=flag', '--pace', '600', '--tick-ms', '1', '--cap-ticks', '24000', '--out', out],
        {
          log: (l) => { lines.push(l); }, print: () => {},
          resolvePlayer: (spec, log) => (spec === 'cmd:raid' ? inProcess('cmd:raid', raidStub, { log }) : resolvePlayer(spec, log)),
          onGameEnd: ({ record }) => { games.push(record); },
        },
      );
      expect(run.code, lines.join('\n')).toBe(0);
      expect(games).toHaveLength(2);
      for (const g of games) {
        expect(g.mode).toBe('flag');
        expect(g.outcome, `${g.players} ${g.by}`).toBe(g.players[0] === 'Player A' ? 'seat0' : 'seat1');
        expect(g.by).toBe('objective');
        expect(g.ticks).toBeLessThan(120 * 20);
        expect(g.referee!.mode).toBe('flag'); // the referee's stats name the mode (a camp or flag room read as annihilation before)
      }
      const md = readFileSync(join(out, readdirSync(out).find((f) => f.endsWith('.md')) ?? ''), 'utf8');
      expect(md).toMatch(/^# Arena: wadi_tarfan, mirror, flag$/m);
      expect(md).toContain('| objective | flag captured |');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 280_000);
});
