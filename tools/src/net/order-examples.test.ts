// The 4 Nov bot report, items 3 and 4: the standing prompt and the tool descriptions carry the exact argument shape of
// `order` and `submit_score`, and every example in them is checked against the tool's OWN schema and `run`. A model's
// first call no longer has to be corrected from an error message, and an example that stops being valid fails here.
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import type { AgentClient } from './agent-client';
import { botPrompt } from './bot';
import { replyFormat, validateScores } from './match-score';
import { ORDER_VERBS, TOOLS, type ToolContext } from './mcp-tools';
import { ORDER_EXAMPLES, orderExamplesForDescription } from './order-examples';
import { readStandingPrompt, standingPrompt } from './external-player';

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (t === undefined) throw new Error(`no tool ${name}`);
  return t;
};
const ajv = new Ajv({ strict: false, allErrors: true });
const orderSchema = ajv.compile(tool('order').schema);
const scoreSchema = ajv.compile(tool('submit_score').schema);

/** The lines of the fenced block (``` + lang) that follows `marker` in `text`. */
function fenced(text: string, marker: string, lang: string): string[] {
  const at = text.indexOf(marker);
  expect(at, `no "${marker}" in the text`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf('```' + lang + '\n', at);
  expect(open, `no ${lang} block after "${marker}"`).toBeGreaterThanOrEqual(0);
  const start = open + 4 + lang.length;
  return text.slice(start, text.indexOf('\n```', start)).split('\n');
}

/** A client that holds exactly the ids, contact, structure and wounded man the examples name; ownership says yes. */
function stubCtx(): ToolContext {
  const own = [12, 13, 14, 15, 16].map((id) => ({ id, type: 'inf_squad', tile: [5, 5], hp: 100, flags: [], stance: 'free' }));
  const view = {
    tick: 100, clock: '00:05', side: 0, size: [64, 64], camp: [1, 1], enemyCamp: [60, 60],
    units: own, contacts: [{ id: 87, type: 'inf_squad', tile: [30, 30], hp: 100 }], casualties: { mine: [{ id: 41, type: 'inf_squad', tile: [6, 6], state: 'down' }], theirs: [] },
    held: [], stances: [], score: {}, mode: 'annihilation', result: null, by: null,
  };
  const client = {
    config: () => ({ seats: [{ kind: 'human' }, { kind: 'human' }], pace: { kind: 'realtime' } }),
    view: () => view,
    tick: () => 100,
    result: () => null,
    joinedUnderway: () => false,
    memory: () => null,
    precheck: () => true,
    world: () => null,
    desk: { submit: () => ({ ref: 1, status: 'queued' }), records: () => [] },
    transport: { status: () => ({ kind: 'live', behind: 0 }), behind: () => 0 },
  };
  return { client: client as unknown as AgentClient, scope: 'command', inbox: [], proposals: new Map(), doneRound: -1, nextProposal: 1, seen: true };
}

describe('order: the exact argument shape is in the prompt and in the tool (item 3)', () => {
  const prompt = readStandingPrompt();

  it('the prompt lists exactly the example table, one line per example, in order', () => {
    expect(fenced(prompt, '## Exact `order` arguments', 'jsonl')).toEqual(ORDER_EXAMPLES.map((e) => e.json));
  });

  it('every verb the tool builds has an example, and every example names a verb the tool builds', () => {
    expect([...new Set(ORDER_EXAMPLES.map((e) => e.verb))].sort()).toEqual([...ORDER_VERBS].sort());
  });

  it('every prompt example parses with the tool\'s own JSON schema, and the tool\'s `run` accepts it', async () => {
    const ctx = stubCtx();
    for (const line of fenced(prompt, '## Exact `order` arguments', 'jsonl')) {
      const args: unknown = JSON.parse(line);
      expect(orderSchema(args), `${line}: ${JSON.stringify(orderSchema.errors)}`).toBe(true);
      const r = await tool('order').run(ctx, args);
      expect(r.ok, `${line} -> ${r.text}`).toBe(true);
    }
  });

  it('the standing prompt a model is given still carries the block (the placeholders replaced around it)', () => {
    const p = standingPrompt({ seat: 1, code: 'ABCDEF' });
    expect(fenced(p, '## Exact `order` arguments', 'jsonl')).toEqual(ORDER_EXAMPLES.map((e) => e.json));
  });

  it('the tool description carries the shape and its examples, and each of those parses too', async () => {
    const d = tool('order').description;
    expect(d).toContain('ONE flat JSON object');
    const ctx = stubCtx();
    const shown = ORDER_EXAMPLES.filter((e) => e.inDescription);
    expect(shown.length).toBeGreaterThanOrEqual(8);
    expect(d).toContain(orderExamplesForDescription());
    expect(d).toMatch(/\}, \{"verb"/);   // the examples are comma-separated
    for (const e of shown) {
      expect(d, e.verb).toContain(e.json);
      expect(orderSchema(JSON.parse(e.json)), e.json).toBe(true);
      expect((await tool('order').run(ctx, JSON.parse(e.json))).ok, e.json).toBe(true);
    }
  });

  it('control: the schema and `run` do reject a wrong shape (an example that parsed vacuously would prove nothing)', async () => {
    const ctx = stubCtx();
    expect(orderSchema({ verb: 'move', ids: [12], x: 4 , target: 'x' })).toBe(false);          // a wrong type
    expect(orderSchema({ verb: 'move', ids: [12], x: 4, y: 4, tile: [4, 4] })).toBe(false);    // an unknown key
    expect(orderSchema({ verb: 'teleport', ids: [12] })).toBe(false);                          // an unknown verb
    expect((await tool('order').run(ctx, { verb: 'move', ids: [12] })).ok).toBe(false);        // schema-valid, but no tile
    expect((await tool('order').run(ctx, { verb: 'attack', ids: [12], target: 5 })).ok).toBe(false);   // not a contact
  });
});

describe('submit_score: the exact JSON shape is in the prompt and in the tool (item 4)', () => {
  it('the bot prompt carries the object, and the validator and the tool schema both accept it', () => {
    const prompt = botPrompt({ room: 'ABCDEF' });
    const lines = fenced(prompt, 'The arguments of `submit_score` are exactly this one JSON object', 'json');
    const example: unknown = JSON.parse(lines.join('\n'));
    const v = validateScores(example);
    expect(v.ok, v.ok ? '' : v.problems.join('; ')).toBe(true);
    expect(scoreSchema(example), JSON.stringify(scoreSchema.errors)).toBe(true);
    expect(example).toEqual(JSON.parse(replyFormat()));
  });

  it('the tool description carries the same object, and it validates', () => {
    const d = tool('submit_score').description;
    expect(d).toContain(replyFormat());
    expect(d).toContain('`seat0` and `seat1` at the top level');
  });

  it('control: the shapes the first call got wrong are refused by the validator and the schema', () => {
    const good = JSON.parse(replyFormat()) as Record<string, unknown>;
    const wrapped = { result: good };                                   // wrapped in another key
    const flat = { seat0: 7, seat1: 5 };                                 // a bare number for a player
    const noOverall = { seat0: { criteria: (good.seat0 as { criteria: unknown }).criteria }, seat1: good.seat1 };
    for (const bad of [wrapped, flat, noOverall]) {
      expect(validateScores(bad).ok).toBe(false);
      expect(scoreSchema(bad)).toBe(false);
    }
  });
});
