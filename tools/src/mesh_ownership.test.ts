// Who may regenerate which file under `art/meshes/**`.
//
// Three export pipelines each carry a table saying "this unit's shipped GLB is
// not mine to write, <script> owns it". Those tables are the only thing
// standing between `-- all` and a supplied asset, and they have exactly one
// failure mode: the named script gets retired or renamed, and the entry becomes
// a permanent unexplained block on a file nobody else claims. Nothing in Python
// can catch that -- the block LOOKS the same either way.
//
// So this pins each non-kit entry against the named script's OWN output path,
// read out of that script's source. Following
// `packages/render/src/three/units/textured-building.test.ts`, which is this
// tree's precedent for pinning a Python constant from TypeScript.
//
// Every claim below was measured on the bytes on 2026-09-16, not inferred:
//   sniper_team.glb   3 roles, 24-frame `move`, ghillie-suited prone figures
//                     -- against rig.py's 7 roles and 16 frames
//   dozer_d9.glb      death_root + 5 WRECK_ children + idle/wreck clips + a
//                     Meshy copyright -- all of which a kit re-export drops
//   warehouse/apartment(.glb and _wreck)  1 material, 1 texture, Meshy
//                     copyright, while BuildingSpec said MESH_KIT_OWNED
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(`${REPO}${rel}`, 'utf8');

/** The sentinel, read from its one definition rather than retyped here. */
function kitSentinel(): string {
  const py = read('tools/mesh_ownership.py');
  const m = /^MESH_KIT_OWNED\s*=\s*"([^"]+)"/m.exec(py);
  expect(m, 'MESH_KIT_OWNED not found in tools/mesh_ownership.py').not.toBeNull();
  return (m as RegExpExecArray)[1];
}

/**
 * Every repo-relative path a Python export script writes, resolved from its
 * own `NAME = os.path.join(...)` assignments.
 *
 * Deliberately a source read rather than an import: these scripts need Blender
 * to import at all, and the question here is what the FILE says, which is what
 * a human checking the entry would also read.
 */
function joinedPaths(py: string): string[] {
  const vars: Record<string, string> = { REPO: '', TOOLS: 'tools' };
  const out: string[] = [];
  // Two passes, so `OUT_PATH = os.path.join(OUT_DIR, "x.glb")` resolves after
  // `OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")`.
  for (let pass = 0; pass < 2; pass++) {
    // Leading whitespace matters: the three building exporters assign
    // `OUT_DIR` inside an `else:` branch (the `if "--out-dir" in argv` split),
    // so a `^`-anchored pattern found none of them and every building read as
    // "its owner writes nothing". Caught because the test went red on `house`,
    // whose ownership was never in doubt -- which is the control working.
    for (const m of py.matchAll(/^[ \t]*(\w+)\s*=\s*os\.path\.join\(\s*([^)]*)\)/gm)) {
      const [, name, args] = m;
      const lead = /^\s*(\w+)\s*,/.exec(args)?.[1];
      const base = lead && lead in vars ? vars[lead] : lead === 'REPO' ? '' : null;
      if (base === null) continue;
      const parts = [...args.matchAll(/"([^"]+)"/g)].map((q) => q[1]);
      const joined = [base, ...parts].filter(Boolean).join('/');
      vars[name] = joined;
      out.push(joined);
    }
  }
  return out;
}

/** `owner` strings carry prose after the script name; take the first token. */
function scriptNamed(owner: string): string {
  const m = /^([\w./-]+\.py)/.exec(owner.trim());
  expect(m, `owner string does not start with a script path: ${owner.slice(0, 60)}`).not.toBeNull();
  return (m as RegExpExecArray)[1];
}

function expectOwnerWrites(owner: string, ownedPath: string) {
  const script = scriptNamed(owner);
  expect(existsSync(`${REPO}${script}`), `${script} does not exist`).toBe(true);
  const written = joinedPaths(read(script));
  expect(
    written,
    `${script} does not write ${ownedPath} -- if it was retired, the guard ` +
      `naming it is now blocking a file nobody claims, which is worse than no ` +
      `guard. Resolve the ownership rather than deleting this assertion.`
  ).toContain(ownedPath);
}

describe('there is one spelling of mesh ownership', () => {
  it('defines MESH_KIT_OWNED in exactly one place', () => {
    expect(kitSentinel()).toBe('kit');
    // `render_building.py` invented this mechanism and now re-exports the
    // constant instead of defining a second one. A literal here again is how
    // the two halves drift into disagreeing about what "kit" means.
    const building = read('tools/render_building.py');
    expect(building).toMatch(/from mesh_ownership import MESH_KIT_OWNED/);
    expect(building).not.toMatch(/^MESH_KIT_OWNED\s*=/m);
    expect(read('tools/units/rig.py')).toMatch(/from mesh_ownership import \(/);
    expect(read('tools/export_mesh_vehicle.py')).toMatch(/from mesh_ownership import \(/);
  });

  it('has retired the ad-hoc name Task 4 first gave it', () => {
    // `SUPERSEDED_ELSEWHERE` was a second name for `mesh_owner`, invented
    // without noticing the buildings pipeline already had one.
    for (const f of ['tools/units/rig.py', 'tools/export_mesh_team.py']) {
      expect(read(f), f).not.toMatch(/SUPERSEDED_ELSEWHERE/);
    }
  });
});

describe('the infantry-team owner table', () => {
  const py = read('tools/units/rig.py');
  const block = /TEAM_MESH_OWNER\s*=\s*\{([\s\S]*?)^\}/m.exec(py);

  it('covers every SUPPORTED_TEAMS member and nothing else', () => {
    expect(block, 'TEAM_MESH_OWNER not found in tools/units/rig.py').not.toBeNull();
    const teams = /SUPPORTED_TEAMS\s*=\s*\(([\s\S]*?)\)/.exec(py);
    expect(teams).not.toBeNull();
    const declared = [...(teams as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const owned = [...(block as RegExpExecArray)[1].matchAll(/^\s*"([a-z_]+)":/gm)].map((m) => m[1]).sort();
    expect(owned).toEqual(declared);
    expect(owned.length).toBe(14);
  });

  it('names sniper_team as export_meshy_sniper.py, and that script writes it', () => {
    const entry = /^\s*"sniper_team":\s*("[\s\S]*?")\s*,?\s*$/m.exec((block as RegExpExecArray)[1]);
    expect(entry, 'sniper_team not found in TEAM_MESH_OWNER').not.toBeNull();
    const owner = (entry as RegExpExecArray)[1].replace(/"/g, '');
    expect(owner).not.toBe(kitSentinel());
    expectOwnerWrites(owner, 'art/meshes/sniper_team.glb');
  });
});

describe('the vehicle owner table', () => {
  const py = read('tools/export_mesh_vehicle.py');

  it('declares an owner on every VehicleMeshSpec', () => {
    const units = [...py.matchAll(/unit_id="([a-z_0-9]+)"/g)].map((m) => m[1]);
    const owners = [...py.matchAll(/mesh_owner=/g)];
    expect(units.length).toBeGreaterThan(0);
    expect(owners.length).toBe(units.length);
  });

  it('gives dozer_d9 to export_meshy_d9.py, and that script writes it', () => {
    // The live trap this table was added for: `art/meshes/vehicles/
    // dozer_d9.glb` has been a supplied Meshy bulldozer since 31c9799 and has
    // SINCE taken the vehicle wreck pass, so a kit re-export would have
    // discarded a death_root, five WRECK_ children and two clips -- and
    // `pnpm validate:meshes` would have passed afterwards, because a dozer
    // still looks like a dozer.
    const spec = /"dozer_d9":[\s\S]*?mesh_owner=\(([\s\S]*?)\),/.exec(py);
    expect(spec, 'dozer_d9 mesh_owner not found').not.toBeNull();
    const owner = [...(spec as RegExpExecArray)[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
    expectOwnerWrites(owner, 'art/meshes/vehicles/dozer_d9.glb');
  });
});

describe('the building owner table', () => {
  const py = read('tools/render_building.py');

  function ownerOf(constName: string): string {
    const spec = new RegExp(`${constName} = BuildingSpec\\(([\\s\\S]*?)\\n\\)`).exec(py);
    expect(spec, `${constName} not found`).not.toBeNull();
    const body = (spec as RegExpExecArray)[1];
    const paren = /mesh_owner=\(([\s\S]*?)\),/.exec(body);
    if (paren) return [...paren[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
    const bare = /mesh_owner=(\w+)/.exec(body);
    expect(bare, `${constName} declares no mesh_owner`).not.toBeNull();
    return (bare as RegExpExecArray)[1];
  }

  it('gives the three supplied Meshy buildings to their own exporters', () => {
    // `house` was flipped when it was replaced; `warehouse` and `apartment`
    // were not, and shipped a Meshy bake (1 material, 1 texture, a Meshy
    // copyright -- read off the bytes) under a MESH_KIT_OWNED declaration
    // until 2026-09-16. Only `_assert_no_provenance_drift`'s credit check
    // stood between `-- all` and overwriting them.
    for (const [name, unit] of [
      ['HOUSE', 'house'],
      ['WAREHOUSE', 'warehouse'],
      ['APARTMENT', 'apartment'],
    ] as const) {
      const owner = ownerOf(name);
      expect(owner, `${name} is still MESH_KIT_OWNED`).not.toBe('MESH_KIT_OWNED');
      expectOwnerWrites(owner, `art/meshes/buildings/${unit}.glb`);
    }
  });

  it('leaves the kit-authored buildings kit-owned', () => {
    // The control: a table where every entry says "not mine" would gate
    // nothing and look like it gated something.
    for (const name of ['SHANTY', 'CONCRETE', 'WALL']) {
      expect(ownerOf(name), name).toBe('MESH_KIT_OWNED');
    }
  });
});
