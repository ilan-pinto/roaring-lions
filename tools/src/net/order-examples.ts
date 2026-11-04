/**
 * One worked `order` call per verb: the exact argument object, as the tool takes it (the 4 Nov bot report, item 3).
 *
 * The standing prompt (`arena-prompt.md`) lists these lines verbatim, and the tool's description carries the first of
 * each group. `order-examples.test.ts` holds both to this table and runs every line through the tool's own schema and
 * its own `run`, so an example that stops being valid, or a prompt that drifts from the table, fails a test and does not
 * wait for a model's first call to find out. The ids (12, 14), the contact 87, the structure 3, the wounded man 41 and
 * the tiles are placeholders: take real ones from `observe`.
 */
import type { ORDER_VERBS } from './mcp-tools';

type Verb = (typeof ORDER_VERBS)[number];

export interface OrderExample {
  verb: Verb;
  /** What the verb group takes, in a clause. */
  group: string;
  /** The arguments as one line of JSON. */
  json: string;
  /** Whether the tool's description carries it (the first of each group; the prompt carries every one). */
  inDescription: boolean;
}

export const ORDER_EXAMPLES: readonly OrderExample[] = [
  { verb: 'move', group: 'to a tile: ids + x, y', json: '{"verb":"move","ids":[12,14],"x":40,"y":22}', inDescription: true },
  { verb: 'attackMove', group: 'to a tile: ids + x, y', json: '{"verb":"attackMove","ids":[12,14],"x":40,"y":22}', inDescription: false },
  { verb: 'smoke', group: 'to a tile: ids + x, y', json: '{"verb":"smoke","ids":[12],"x":38,"y":22}', inDescription: false },
  { verb: 'attack', group: 'at a contact: ids + target', json: '{"verb":"attack","ids":[12,14],"target":87}', inDescription: true },
  { verb: 'halt', group: 'ids only', json: '{"verb":"halt","ids":[12,14]}', inDescription: true },
  { verb: 'unload', group: 'ids only', json: '{"verb":"unload","ids":[15]}', inDescription: false },
  { verb: 'garrison', group: 'a structure: ids + structure', json: '{"verb":"garrison","ids":[12],"structure":3}', inDescription: true },
  { verb: 'demolish', group: 'a structure: ids + structure', json: '{"verb":"demolish","ids":[16],"structure":3}', inDescription: false },
  { verb: 'load', group: 'a carrier: ids + carrier', json: '{"verb":"load","ids":[12,14],"carrier":15}', inDescription: true },
  { verb: 'chargeTunnel', group: 'a tunnel: ids + tunnel', json: '{"verb":"chargeTunnel","ids":[12],"tunnel":1}', inDescription: true },
  { verb: 'rescue', group: 'a wounded man: ids (a medic team) + target', json: '{"verb":"rescue","ids":[13],"target":41}', inDescription: true },
  { verb: 'setStance', group: 'a stance: ids + stance', json: '{"verb":"setStance","ids":[12],"stance":"hold"}', inDescription: true },
  { verb: 'setStance', group: 'a stance: ids + stance', json: '{"verb":"setStance","ids":[12],"stance":"ambush","radius":4}', inDescription: false },
  { verb: 'setStance', group: 'a stance: ids + stance', json: '{"verb":"setStance","ids":[12],"stance":"patrol","waypoints":[[30,20],[36,26]]}', inDescription: false },
  { verb: 'build', group: 'production: no ids', json: '{"verb":"build","unit":"inf_squad","line":0}', inDescription: true },
  { verb: 'cancelBuild', group: 'production: no ids', json: '{"verb":"cancelBuild","line":0,"index":-1}', inDescription: false },
  { verb: 'setRally', group: 'production: no ids', json: '{"verb":"setRally","line":0,"x":30,"y":20}', inDescription: false },
  { verb: 'clearRally', group: 'production: no ids', json: '{"verb":"clearRally","line":0}', inDescription: false },
];

/** The lines the tool's description carries. */
export function orderExamplesForDescription(): string {
  return ORDER_EXAMPLES.filter((e) => e.inDescription).map((e) => `${e.json}`).join(' ');
}
