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
  it('refuses an arrival face with no hud line, and a drill with none (a halt included, GH-859 P1b)', () => {
    const face = run(variant('attack', (d) => (d.arrival.face = 'outward')));
    expect(face).toHaveLength(1);
    expect(face[0]).toContain('hud.formation.face.outward');
    expect(run(variant('attack', (d) => (d.arrival.face = 'none')))).toEqual([]);
    const drill = run(variant('attack', (d) => (d.contact.drill = 'bound')));
    expect(drill).toHaveLength(1);
    expect(drill[0]).toContain('hud.formation.drill.bound');
    // Column ships `halt` and en.json has its line (P1b Task 4), so the shipped file passes.
    expect(run(variant('column', () => undefined))).toEqual([]);
  });
  it('refuses a halt drill whose en.json line is missing (P1a exempted it; P1b Task 4 does not)', () => {
    const { 'hud.formation.drill.halt': _gone, ...rest } = en;
    void _gone;
    expect(Object.keys(en)).toContain('hud.formation.drill.halt'); // the key exists, so the fixture really removes it
    const out = run(variant('column', () => undefined), rest);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('contact.drill "halt" has no en.json key hud.formation.drill.halt');
    // the other side of the fixture: drill "none" needs no line, so the same catalogue passes it
    expect(run(variant('column', (d) => (d.contact.drill = 'none')), rest)).toEqual([]);
  });
  it('refuses a paced file whose en.json has no pace line, and an element on call with no call line (GH-859 P1b Task 10)', () => {
    const { 'hud.formation.pace': _p, ...noPace } = en;
    void _p;
    expect(Object.keys(en)).toContain('hud.formation.pace');
    const pace = run(variant('column', () => undefined), noPace);
    expect(pace).toHaveLength(1);
    expect(pace[0]).toContain('march.pace "slowest_ground" but en.json has no hud.formation.pace');
    // A file that does not pace needs no line.
    expect(run(variant('column', (d) => ((d.march as { pace: string }).pace = 'none')), noPace)).toEqual([]);
    // Column has a casualty element and a contact element on call: each needs its line.
    const { 'hud.formation.call.casualty': _c, ...noCasualty } = en;
    void _c;
    const call = run(variant('column', () => undefined), noCasualty);
    expect(call).toHaveLength(1);
    expect(call[0]).toContain('on_call "casualty" has no en.json key hud.formation.call.casualty');
    const { 'hud.formation.call.contact': _k, ...noContact } = en;
    void _k;
    // (The Attack leaves its aircraft out and so has no contact call of its own: the Column and the Ambush have one.)
    expect(run(variant('attack', () => undefined), noContact)).toEqual([]);
    expect(run(variant('column', () => undefined), noContact)).toHaveLength(1);
    // The tooltip's other side of the rule: a catalogue with every line passes (the shipped files above).
    expect(run(shipped)).toEqual([]);
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

describe('exclude (the classes a formation leaves out)', () => {
  const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => (d: unknown) => boolean })({ allErrors: true, strict: false });
  const schema = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'formation.schema.json'), 'utf8')) as object);
  /** The shipped Attack, deep-copied, with `mutate` applied. */
  const attack = (mutate: (d: Doc) => void): Doc => variant('attack', mutate)[0].doc;

  it('the shipped Attack leaves the aircraft out, validates, and names no aircraft element', () => {
    const a = shipped.find((f) => f.doc.id === 'attack') as F;
    expect(a.doc.exclude).toEqual(['aircraft']);
    expect(schema(a.doc)).toBe(true);
    expect(run([a])).toEqual([]);
  });
  it('the schema takes any placed class and refuses rest, a repeat, an empty list, an unknown name and a non-array', () => {
    for (const c of ['armour', 'light_vehicle', 'recon', 'infantry', 'support_weapon', 'medic', 'aircraft']) {
      expect(schema(attack((d) => ((d.exclude = [c]), (d.elements = d.elements.filter((e) => !(e.classes as string[]).includes(c)))))), c).toBe(true);
    }
    expect(schema(attack((d) => (d.exclude = ['rest'])))).toBe(false);
    expect(schema(attack((d) => (d.exclude = ['aircraft', 'aircraft'])))).toBe(false);
    expect(schema(attack((d) => (d.exclude = [])))).toBe(false);
    expect(schema(attack((d) => (d.exclude = ['tank'])))).toBe(false);
    expect(schema(attack((d) => (d.exclude = 'aircraft' as unknown as string[])))).toBe(false);
  });
  it('refuses a class that is both excluded and named by an element, naming the element', () => {
    const out = run(variant('attack', (d) => (d.exclude = ['infantry'])));
    expect(out).toEqual(['data/formations/attack.json: element 2 names "infantry", which the formation excludes']);
  });
  it('passes a file with no exclude at all (column, ambush)', () => {
    expect(run(shipped.filter((f) => f.doc.id !== 'attack'))).toEqual([]);
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
