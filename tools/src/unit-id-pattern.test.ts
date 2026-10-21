import { expect, it } from 'vitest';
import { UNIT_ID_PATTERN } from '@lions/data/telemetry';
import { units } from '@lions/data';
import { cleanCommand } from '@lions/net';
it('the wire accepts every shipped unit id, and refuses what data refuses', () => {
  for (const id of Object.keys(units)) expect(cleanCommand({ kind: 'build', side: 0, unit: id }), id).not.toBeNull();
  for (const bad of ['', 'A', 'a-b', 'x'.repeat(33)]) {
    expect(UNIT_ID_PATTERN.test(bad)).toBe(false);
    expect(cleanCommand({ kind: 'build', side: 0, unit: bad })).toBeNull();
  }
});
