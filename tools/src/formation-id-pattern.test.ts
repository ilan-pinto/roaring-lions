import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formations } from '@lions/data';
import { FORMATION_ID, cleanCommand } from '@lions/net';

// GH-859 P1a Ruling 13: the wire's FORMATION_ID (in @lions/net, which cannot import @lions/data) and the schema's
// `id` pattern are two spellings of one rule. Pinned against every shipped id and a fixed set of refusals, the way
// unit-id-pattern.test.ts pins UNIT_ID.
const ROOT = join(__dirname, '..', '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'formation.schema.json'), 'utf8')) as {
  properties: { id: { pattern: string } };
};

it('the schema pattern and the wire pattern are the same text', () => {
  expect(FORMATION_ID.source).toBe(schema.properties.id.pattern);
});

it('the wire accepts every shipped formation id and refuses what the schema refuses', () => {
  const ids = formations.map((f) => f.id);
  expect(ids).toHaveLength(3); // an empty list could not fail
  const schemaPattern = new RegExp(schema.properties.id.pattern);
  for (const id of ids) {
    expect(schemaPattern.test(id), id).toBe(true);
    expect(cleanCommand({ kind: 'move', ids: [1], x: 0, y: 0, formation: id }), id).not.toBeNull();
  }
  for (const bad of ['', 'A', 'a-b', '9a', '_a', 'x'.repeat(33)]) {
    expect(schemaPattern.test(bad), bad).toBe(false);
    expect(cleanCommand({ kind: 'move', ids: [1], x: 0, y: 0, formation: bad }), bad).toBeNull();
  }
});
