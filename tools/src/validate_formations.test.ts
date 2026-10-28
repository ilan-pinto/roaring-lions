// GH-859 P1a Task 1: data/formations/*.json, its schema, and the static rules
// tools/validate_formations.mjs holds over it. Fixture tests, the validate_narrative pattern: one
// passing and one failing fixture per rule. The placement run (N = 2..24 on open ground) is
// tools/src/formations_place.test.ts, because the plain-node validator cannot import the sim.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { formationFailures } from '../validate_formations.mjs';

const ROOT = join(__dirname, '..', '..');
const en = JSON.parse(readFileSync(join(ROOT, 'packages', 'app', 'src', 'i18n', 'en.json'), 'utf8')) as Record<string, string>;

interface Doc {
  id: string;
  label: string;
  blurb: string;
  factions: string[];
  verb: string;
  min_members: number;
  elements: Record<string, unknown>[];
  arrival: { face: string; stance: string };
  contact: { drill: string };
  [k: string]: unknown;
}
interface F {
  file: string;
  doc: Doc;
}

const shipped: F[] = readdirSync(join(ROOT, 'data', 'formations'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: `data/formations/${f}`, doc: JSON.parse(readFileSync(join(ROOT, 'data', 'formations', f), 'utf8')) as Doc }));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** One shipped file, deep-copied, with `mutate` applied to its doc. */
const variant = (id: string, mutate: (d: Doc) => void): F[] => {
  const f = clone(shipped.find((s) => s.doc.id === id) as F);
  mutate(f.doc);
  return [f];
};
const run = (files: F[], catalogue: Record<string, string> = en): string[] => formationFailures(files, catalogue);

describe('the shipped formations', () => {
  it('are the three MVP files and pass the schema and every static rule', () => {
    expect(shipped.map((s) => s.file)).toEqual(['data/formations/ambush.json', 'data/formations/attack.json', 'data/formations/column.json']);
    expect(run(shipped)).toEqual([]);
    const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
    const ajv = new (Ajv2020 as unknown as new (o: object) => {
      compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
    })({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'formation.schema.json'), 'utf8')) as object);
    for (const s of shipped) expect(validate(s.doc), `${s.file} ${JSON.stringify(validate.errors)}`).toBe(true);
  });
});

describe('ids', () => {
  it('passes when each id is its filename', () => {
    expect(run(variant('column', () => undefined))).toEqual([]);
  });
  it('refuses an id that is not its filename', () => {
    const out = run(variant('column', (d) => (d.id = 'columns')));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('not its filename');
  });
  it('refuses a duplicate id, naming the second file', () => {
    const a = variant('column', () => undefined)[0];
    const b = clone(a);
    b.file = 'data/formations/other/column.json';
    const out = run([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('a second formation with id "column"');
    expect(out[0]).toContain('other/column.json');
  });
});

describe('i18n keys', () => {
  it('passes when label and blurb are in en.json', () => {
    expect(run(variant('attack', () => undefined))).toEqual([]);
  });
  it('refuses a label key en.json lacks', () => {
    const out = run(variant('attack', (d) => (d.label = 'formation.attack.nope')));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('label key "formation.attack.nope" is not in en.json');
  });
  it('refuses a blurb key en.json lacks', () => {
    const out = run(variant('attack', (d) => (d.blurb = 'formation.attack.nope')));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('blurb key');
  });
  it('refuses an arrival face with no hud line, and a drill with none, but not a halt', () => {
    const face = run(variant('attack', (d) => (d.arrival.face = 'outward')));
    expect(face).toHaveLength(1);
    expect(face[0]).toContain('hud.formation.face.outward');
    expect(run(variant('attack', (d) => (d.arrival.face = 'none')))).toEqual([]);
    const drill = run(variant('attack', (d) => (d.contact.drill = 'bound')));
    expect(drill).toHaveLength(1);
    expect(drill[0]).toContain('hud.formation.drill.bound');
    // Column ships `halt`, which has no P1a line (Ruling 16), and must still pass.
    expect(run(variant('column', () => undefined))).toEqual([]);
  });
  it('refuses a ring when en.json has no ring line', () => {
    const { 'hud.formation.shape.ring': _gone, ...rest } = en;
    void _gone;
    const out = run(variant('ambush', () => undefined), rest);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('hud.formation.shape.ring');
  });
});

describe('shapes', () => {
  it('refuses a faction other than kdf or sarim', () => {
    const out = run(variant('column', (d) => d.factions.push('rif')));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('faction "rif"');
  });
  it('refuses a ring radius with min above max', () => {
    const out = run(variant('ambush', (d) => ((d.elements[0].shape as { radius: number[] }).radius = [6, 3])));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('min above max');
  });
  it('refuses an odd centre: two files two apart is even, two files three apart is not', () => {
    expect(run(variant('column', () => undefined))).toEqual([]);
    const out = run(variant('column', (d) => ((d.elements[1].shape as { file_gap: number }).file_gap = 3)));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('is odd');
  });
  it('refuses "rest" that is not last, and "rest" twice', () => {
    const notLast = run(
      variant('column', (d) => {
        (d.elements[1] as { classes: string[] }).classes = ['armour', 'rest'];
      })
    );
    expect(notLast).toHaveLength(1);
    expect(notLast[0]).toContain('not the last element');
    const last = run(
      variant('column', (d) => {
        (d.elements[d.elements.length - 1] as { classes: string[] }).classes = ['rest'];
      })
    );
    expect(last).toEqual([]);
    const twice = run(
      variant('column', (d) => {
        const n = d.elements.length;
        (d.elements[n - 2] as { classes: string[] }).classes = ['rest'];
        (d.elements[n - 1] as { classes: string[] }).classes = ['rest'];
      })
    );
    expect(twice.some((l) => l.includes('at most one'))).toBe(true);
  });
  it('refuses an ambush stance without a ring', () => {
    const out = run(
      variant('ambush', (d) => {
        d.elements = d.elements.slice(1);
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('needs a ring element');
  });
  it('refuses an ambush stance whose drill is not spring', () => {
    const out = run(variant('ambush', (d) => (d.contact.drill = 'press')));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('needs a ring element and the "spring" drill');
  });
  it('refuses two ring elements', () => {
    const out = run(
      variant('ambush', (d) => {
        d.elements.push(clone(d.elements[0]));
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('2 ring elements');
  });
});

describe('the type count (N8)', () => {
  it('255 formations pass, 256 fail: the sim keeps a group\'s type in one byte', () => {
    const one = shipped.find((f) => f.doc.id === 'column') as F;
    const many = (n: number): F[] =>
      Array.from({ length: n }, (_, k) => {
        const c = clone(one);
        c.file = `data/formations/col_${k}.json`;
        c.doc.id = `col_${k}`;
        return c;
      });
    expect(run(many(255))).toEqual([]);
    expect(run(many(256))).toEqual(['256 formations; at most 255 (the sim keeps a group\'s type in one byte)']);
  });
});
