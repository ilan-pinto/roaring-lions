/**
 * GH-85: the schema ran ahead of the runtime once already -- eighteen
 * triggers declared, three dispatched, and an emitter file that validated,
 * loaded and was never fired (`catastrophic_kill.json` until WP-A1.2). These
 * two checks keep the two in step from the data side.
 *
 * 1. Every authored emitter has a dispatch. A `weapon_fire` emitter is
 *    indexed by weapon class (`EmitterLibrary.fireEmitterFor`); every other
 *    one is looked up by id, so its id must appear as a string literal in the
 *    renderer's own (non-test) source. A file whose id nothing names would
 *    ship as dead data, which is exactly what this issue was about.
 * 2. The triggers deliberately left silent stay silent. Each carries the
 *    reason; authoring an emitter for one without wiring it fails here and
 *    says which question to answer first.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const VFX_DIR = new URL('../../../../data/vfx/', import.meta.url);
const RENDER_SRC = new URL('../', import.meta.url);

interface Authored {
  id: string;
  trigger: string;
}

function authored(): Authored[] {
  return readdirSync(VFX_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(f, VFX_DIR), 'utf8')) as Authored);
}

function renderSource(dir: URL = RENDER_SRC): string {
  let out = '';
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) out += renderSource(new URL(`${ent.name}/`, dir));
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out += readFileSync(new URL(ent.name, dir), 'utf8');
  }
  return out;
}

/** Triggers with no emitter on purpose, and why. */
const SILENT: Readonly<Record<string, string>> = {
  flare: 'the sim models no countermeasure flare -- there is no event to hang one on',
  interceptor_hit: "already drawn: an `aps` intercept throws `missile_impact` at half scale (GH-250)",
  suppression_near_miss: "already drawn: every `nearMiss` throws the flat dust puff and the flinch",
};

/**
 * Authored emitters with NO dispatch on the one renderer we have, recorded as
 * debt with their numbers rather than hidden. Self-cleaning: one that gains a
 * dispatch fails the second case below until it is deleted from here.
 *
 * The cigarette pair rode the retired billboard idle clip (`teams.smoke_pose`,
 * `anim.ts`), which went with the sprite sheets in WP-A3.3; the rigged mesh
 * idle has no smoking beat to fire them on. Found by this test, GH-85.
 */
const UNDISPATCHED: Readonly<Record<string, string>> = {
  cigarette_ember: 'billboard-era idle beat, retired in WP-A3.3; the mesh idle has no smoke pose',
  cigarette_smoke: 'billboard-era idle beat, retired in WP-A3.3; the mesh idle has no smoke pose',
};

describe('every emitter in data/vfx has a dispatch (GH-85)', () => {
  it('names every non-weapon_fire emitter id in the renderer source', () => {
    const src = renderSource();
    const list = authored();
    // An empty directory would pass vacuously.
    expect(list.length).toBeGreaterThan(20);
    const unnamed = list
      .filter((e) => e.trigger !== 'weapon_fire')
      .filter((e) => !src.includes(`'${e.id}'`))
      .map((e) => e.id)
      .filter((id) => !(id in UNDISPATCHED));
    expect(unnamed, 'emitters no renderer code looks up by id').toEqual([]);
  });

  it('carries no stale UNDISPATCHED entry', () => {
    const src = renderSource();
    const ids = new Set(authored().map((e) => e.id));
    for (const id of Object.keys(UNDISPATCHED)) {
      expect(ids.has(id), `${id} is not in data/vfx any more: delete it from UNDISPATCHED`).toBe(true);
      expect(src.includes(`'${id}'`), `${id} is dispatched now: delete it from UNDISPATCHED`).toBe(false);
    }
  });

  it('leaves the deliberately silent triggers unauthored', () => {
    const list = authored();
    for (const [trigger, why] of Object.entries(SILENT)) {
      expect(
        list.filter((e) => e.trigger === trigger).map((e) => e.id),
        `${trigger}: ${why}. Wire a dispatch, then move it out of SILENT.`
      ).toEqual([]);
    }
  });
});
