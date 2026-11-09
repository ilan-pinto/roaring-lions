import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// GH-883: `sensors.thermal` is display-only. The sim parses it into the unit
// type (sim.ts) and nothing reads it. It only feeds the balance cost-curve
// factor in tools/validate_balance.py. This pins that: if a sim system starts
// reading the field it is no longer display-only, and the schema description,
// the dock and the balance factor must be revisited first.
const SRC = __dirname;
const PARSE_FILE = 'sim.ts';

function sources(): string[] {
  return readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('.test-helper'));
}

/** Lines naming the field, minus the parse's own three declarations. */
function readers(file: string, text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (!/\bthermal\b/.test(code)) return;
    if (file === PARSE_FILE) {
      // The type members and the parse are the only allowed forms.
      if (/^\s*thermal\??: boolean;\s*$/.test(code)) return;
      if (/^\s*thermal: json\.sensors\.thermal \?\? false,\s*$/.test(code)) return;
    }
    out.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

describe('sensors.thermal has no reader in the sim', () => {
  it('only the parse in sim.ts names it', () => {
    const files = sources();
    expect(files).toContain(PARSE_FILE);
    const parse = readFileSync(join(SRC, PARSE_FILE), 'utf8')
      .split('\n')
      .filter((l) => /\bthermal\b/.test(l));
    expect(parse.length, 'the parse must still exist or this test guards nothing').toBe(3);
    const all = files.flatMap((f) => readers(f, readFileSync(join(SRC, f), 'utf8')));
    expect(all).toEqual([]);
  });

  it('the scanner sees a reader when one exists', () => {
    expect(readers('combat.ts', 'const r = t.sensors.thermal ? 1 : 0;')).toHaveLength(1);
    expect(readers('sim.ts', '    if (u.thermal) boost();')).toHaveLength(1);
  });
});
