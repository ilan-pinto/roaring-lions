// GH-954 (D-W8): the pin that was blind. N2 added `setStance`, `build` and the other production kinds to the wire,
// and `ORDER_VERBS` kept them out by NAME, so "every kind a versus room accepts has an order verb" was never asked
// and the §11c.8 expectation ("toolsFor's pin goes red until they are listed") never fired.
//
// The question here is asked of `validateCommand`, the room's own rule, not of a list the test writes down: for
// every command kind, one well-formed sample, run through the ownership check for a seat in each kind of versus
// room (a mirror room, and the economy room from the KDF seat and from the Sarim seat). A kind any of them accepts
// must be an `order` verb or sit in `ORDER_WITHHELD` with a reason; the test's own literal says which two may.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMAND_KINDS, validateCommand, type SeatWorld } from '@lions/net';
import type { Command } from '@lions/sim';
import { ORDER_VERBS, ORDER_WITHHELD, TOOLS } from './mcp-tools';
import { BOT_ADDENDUM } from './bot';

const F = 65536;
/** One well-formed command of every kind, against `world` below: ids 1-9 are side 0's, 10-19 side 1's. A new
 *  `Command` kind is a compile error until it has a sample here. */
const SAMPLE: { [K in Command['kind']]: Extract<Command, { kind: K }> } = {
  move: { kind: 'move', ids: [1], x: 5 * F, y: 5 * F },
  attackMove: { kind: 'attackMove', ids: [1], x: 5 * F, y: 5 * F },
  halt: { kind: 'halt', ids: [1] },
  setStance: { kind: 'setStance', ids: [1], stance: 'hold' },
  garrison: { kind: 'garrison', ids: [1], structure: 3 },
  load: { kind: 'load', ids: [1], carrier: 2 },
  unload: { kind: 'unload', ids: [1] },
  reveal: { kind: 'reveal', side: 0, x: 5 * F, y: 5 * F },
  callStrike: { kind: 'callStrike', caller: 1, x: 5 * F, y: 5 * F },
  smoke: { kind: 'smoke', ids: [1], x: 5 * F, y: 5 * F },
  demolish: { kind: 'demolish', ids: [1], structure: 3 },
  chargeTunnel: { kind: 'chargeTunnel', ids: [1], tunnel: 0 },
  attack: { kind: 'attack', ids: [1], target: 11 },
  rescue: { kind: 'rescue', ids: [1], target: 2 },
  build: { kind: 'build', side: 0, unit: 'inf_squad' },
  support: { kind: 'support', side: 0, support: 'drone_sweep', x: 5 * F, y: 5 * F },
  cancelBuild: { kind: 'cancelBuild', side: 0, line: 0, index: -1 },
  setRally: { kind: 'setRally', side: 0, line: 0, x: 5 * F, y: 5 * F },
  clearRally: { kind: 'clearRally', side: 0, line: 0 },
  construct: { kind: 'construct', ids: [1], structType: 0, x: 5 * F, y: 5 * F },
  cancelConstruct: { kind: 'cancelConstruct', site: 0 },
  raiseWorks: { kind: 'raiseWorks', side: 0, works: 'sandbag_post', x: 5 * F, y: 5 * F, ids: [1] },
  cancelWorks: { kind: 'cancelWorks', side: 0, site: 0 },
  enterTunnel: { kind: 'enterTunnel', ids: [1], tunnel: 0 },
  vent: { kind: 'vent', ids: [1], mode: 'raid' },
};

/** A seat's world in a versus room: seat s is side s, route 0 is the Sarim seat's. */
const room = (o: { economy: boolean; seat0: 'kdf' | 'sarim' }): SeatWorld => ({
  sideOfSeat: (seat) => seat,
  sideOfEntity: (id) => (id >= 1 && id < 10 ? 0 : id >= 10 && id < 20 ? 1 : undefined),
  width: 48,
  height: 48,
  structureExists: (id) => id === 3,
  tunnelExists: (id) => id === 0,
  factionOfSeat: (seat) => (seat === 0 ? o.seat0 : o.seat0 === 'kdf' ? 'sarim' : 'kdf'),
  tunnelOwner: () => 0,
  versus: true,
  economy: o.economy,
  formationAllowed: () => true,
});

/** The kinds a versus room accepts from some seat: a mirror room, and an economy room played from each side. */
function legalInVersus(): Set<string> {
  const worlds = [
    room({ economy: false, seat0: 'kdf' }),
    room({ economy: true, seat0: 'kdf' }),
    room({ economy: true, seat0: 'sarim' }),
  ];
  const out = new Set<string>();
  for (const kind of COMMAND_KINDS) for (const w of worlds) if (validateCommand(SAMPLE[kind], 0, w)) out.add(kind);
  return out;
}

describe('every command kind a versus room accepts is an order verb or withheld on purpose (GH-954, D-W8)', () => {
  it('measures the rule it pins: the samples are accepted where they should be, and the room-only kinds only there', () => {
    const legal = legalInVersus();
    // Premises, by literal: if the samples stopped being well-formed this whole file would pass vacuously.
    for (const kind of ['move', 'attackMove', 'halt', 'setStance', 'garrison', 'load', 'unload', 'smoke', 'demolish', 'chargeTunnel', 'attack', 'rescue', 'build', 'cancelBuild', 'setRally', 'clearRally', 'enterTunnel', 'vent']) {
      expect(legal.has(kind), `${kind} is legal in a versus room`).toBe(true);
    }
    for (const kind of ['reveal', 'callStrike', 'support', 'construct', 'cancelConstruct', 'raiseWorks', 'cancelWorks']) {
      expect(legal.has(kind), `${kind} is not legal in a versus room`).toBe(false);
    }
    // The four production kinds are the economy room's alone.
    const mirror = room({ economy: false, seat0: 'kdf' });
    for (const kind of ['build', 'cancelBuild', 'setRally', 'clearRally'] as const) expect(validateCommand(SAMPLE[kind], 0, mirror), kind).toBe(false);
  });

  it('every legal kind is an ORDER_VERB, except the two withheld on purpose (enterTunnel, vent)', () => {
    const verbs = new Set<string>(ORDER_VERBS);
    const missing = [...legalInVersus()].filter((k) => !verbs.has(k)).sort();
    // The named, justified exclusion. A kind joining this list is a decision; it is made here, in a literal.
    expect(missing).toEqual(['enterTunnel', 'vent']);
    for (const k of missing) expect(ORDER_WITHHELD, k).toHaveProperty(k);
  });

  it('ORDER_VERBS and ORDER_WITHHELD partition COMMAND_KINDS: no kind in both, none in neither', () => {
    const withheld = new Set(Object.keys(ORDER_WITHHELD));
    for (const k of COMMAND_KINDS) expect(new Set<string>(ORDER_VERBS).has(k) !== withheld.has(k), k).toBe(true);
    expect(ORDER_VERBS.length + withheld.size).toBe(COMMAND_KINDS.length);
  });

  it('a withheld kind\'s `legal` claim is true, and each has a reason', () => {
    const legal = legalInVersus();
    for (const [kind, w] of Object.entries(ORDER_WITHHELD)) {
      expect(legal.has(kind), `${kind}: legal says ${w.legal}`).toBe(w.legal);
      expect(w.why.length, kind).toBeGreaterThan(20);
    }
    // Fire support stays out (LD5) whatever else changes.
    expect(ORDER_WITHHELD).toHaveProperty('support');
  });

  it('the `order` tool offers exactly ORDER_VERBS in its schema and names each in its description', () => {
    const order = TOOLS.find((t) => t.name === 'order');
    const verb = (order?.schema.properties as Record<string, { enum?: string[] }>).verb;
    expect(verb.enum).toEqual([...ORDER_VERBS]);
    for (const v of ['setStance', 'build', 'cancelBuild', 'setRally', 'clearRally']) expect(order?.description, v).toContain(v);
    // The production verbs carry no unit ids, so a client that enforces the schema must not demand them.
    expect(order?.schema.required).toEqual(['verb']);
  });

  it('the standing prompt names every order verb, so a verb added to the tool is not a verb the model is never told of', () => {
    const prompt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'arena-prompt.md'), 'utf8');
    for (const v of ORDER_VERBS) expect(prompt, `arena-prompt.md names \`${v}\``).toContain(`\`${v}\``);
    // `pnpm bot` adds to that prompt, it does not replace it: the economy and the stance are named there too.
    for (const w of ['economy', 'economy.menu', 'setRally', 'setStance', 'purse']) expect(BOT_ADDENDUM, w).toContain(w);
  });
});
