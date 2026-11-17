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
import { spawnSync } from 'node:child_process';
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
    expect(owned.length).toBe(23); // B7: sarim_rifles joined SUPPORTED_TEAMS; GH-707 P2: wounded_kdf, wounded_sarim (kit-owned), inf_medic_squad (import_meshy_medic_team.py); GH-709: ugv_recon_dog (was 17), inf_grenadier, at_nlos_team
  });

  it('names sniper_team as import_meshy_crew_team.py (B7), and that script writes it', () => {
    const entry = /^\s*"sniper_team":\s*("[\s\S]*?")\s*,?\s*$/m.exec((block as RegExpExecArray)[1]);
    expect(entry, 'sniper_team not found in TEAM_MESH_OWNER').not.toBeNull();
    const owner = (entry as RegExpExecArray)[1].replace(/"/g, '');
    expect(owner).not.toBe(kitSentinel());
    // The crew importer writes `art/meshes/<team_id>.glb` for every team in
    // its SOURCES table (an f-string, not one literal per file), so "writes
    // it" is: writes under art/meshes, and names sniper_team as a source.
    expect(owner).toBe('tools/units/import_meshy_crew_team.py');
    const script = read(owner);
    expect(joinedPaths(script)).toContain('art/meshes');
    expect(script).toMatch(/^\s*"sniper_team":\s*\(os\.path\.join\(REPO, "art", "meshy"/m);
    expect(script).toMatch(/os\.path\.join\(OUT_DIR, f"\{team_id\}\.glb"\)/);
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

  it('gives dozer_d9 to export_meshy_ramp.py, and that script writes it', () => {
    // The live trap this table was added for: `art/meshes/vehicles/
    // dozer_d9.glb` has been a supplied Meshy bulldozer since 31c9799 and has
    // SINCE taken the vehicle wreck pass, so a kit re-export would have
    // discarded a death_root, five WRECK_ children and two clips -- and
    // `pnpm validate:meshes` would have passed afterwards, because a dozer
    // still looks like a dozer. Since 2026-09-30 (GH-185, the A3.2 ramp set)
    // the owner is `export_meshy_ramp.py`, the textured Meshy remesh; the
    // assertion is the same -- whoever is named must write the file.
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

  it('gives every replaced building to the exporter that writes it', () => {
    // `house` was flipped when it was replaced; `warehouse` and `apartment`
    // were not, and shipped a Meshy bake (1 material, 1 texture, a Meshy
    // copyright -- read off the bytes) under a MESH_KIT_OWNED declaration
    // until 2026-09-16. Only `_assert_no_provenance_drift`'s credit check
    // stood between `-- all` and overwriting them. `shanty`, `concrete` and
    // `wall` followed on 2026-09-30 (GH-185, the A3.2 ramp set), so no
    // BuildingSpec is kit-owned any more; the control this table used to
    // carry ("the kit-authored three stay MESH_KIT_OWNED") has no member
    // left, and what stands in for it is the write check below: an owner
    // that names a script which does not write the file is caught.
    for (const [name, unit] of [
      ['HOUSE', 'house'],
      ['WAREHOUSE', 'warehouse'],
      ['APARTMENT', 'apartment'],
      ['SHANTY', 'shanty'],
      ['CONCRETE', 'concrete'],
      ['WALL', 'wall'],
    ] as const) {
      const owner = ownerOf(name);
      expect(owner, `${name} is still MESH_KIT_OWNED`).not.toBe('MESH_KIT_OWNED');
      expectOwnerWrites(owner, `art/meshes/buildings/${unit}.glb`);
    }
  });
});

// An importer keeps a SOURCES row for a team after the team has moved to another importer, and builds every row when
// run bare. `rig.TEAM_MESH_OWNER` alone does not stop it: the old importers never read the table for themselves.
// GH-826 unit 1 (12 Nov 2026) gave demo_squad to the skinned importer while `import_meshy_kdf_team.py` could still
// write the rigid figure over it (run and watched, in Blender: the file changed; with the guard it exits and the file
// does not). Falsified by mutation: with the guard line deleted from `import_meshy_kdf_team.py`'s `build_team`, the
// first test below is red; with `owner != rel` in `assert_script_owns` changed to `owner == rel`, the second is.
describe('an importer does not write a team the owner table gave to another script', () => {
  const rigPy = read('tools/units/rig.py');
  const block = /TEAM_MESH_OWNER\s*=\s*\{([\s\S]*?)^\}/m.exec(rigPy);
  const ownerOfTeam = (team: string): string | undefined =>
    new RegExp(`^\\s*"${team}":\\s*"([^"]+)"`, 'm').exec((block as RegExpExecArray)[1])?.[1];

  it.each([
    ['tools/units/import_meshy_kdf_team.py', ['demo_squad']],
    // (moto_rpg: the riders' source row; the bike importer loads it itself, and `main` already refused the name)
    ['tools/units/import_meshy_crew_team.py', ['inf_squad', 'moto_rpg']],
  ] as const)('%s guards build_team, and still lists %j as a source it no longer owns', (script, moved) => {
    const py = read(script);
    expect(py).toMatch(/^from mesh_ownership import assert_script_owns/m);
    // the guard is the first statement of build_team: nothing is loaded or written before it
    expect(py).toMatch(/^def build_team\(team_id\):\n {4}assert_script_owns\(rig\.TEAM_MESH_OWNER, team_id, "TEAM_MESH_OWNER", __file__, REPO\)\n/m);
    const sources = /^SOURCES\s*=\s*\{([\s\S]*?)^\}/m.exec(py);
    expect(sources, `${script}: SOURCES`).not.toBeNull();
    const teams = [...(sources as RegExpExecArray)[1].matchAll(/^\s*"([a-z_0-9]+)":/gm)].map((m) => m[1]);
    const notMine = teams.filter((t) => ownerOfTeam(t) !== undefined && ownerOfTeam(t) !== script).sort();
    expect(notMine).toEqual([...moved]);
  });

  it('assert_script_owns passes the owner, refuses another script by name, and has no default', () => {
    const code = [
      'import json, sys',
      'sys.path.insert(0, "tools")',
      'import mesh_ownership as m',
      'table = {"demo_squad": "tools/units/import_meshy_skinned_team.py", "at_team": "tools/units/import_meshy_kdf_team.py"}',
      'out = {}',
      'def run(unit, script):',
      '    try:',
      '        m.assert_script_owns(table, unit, "TEAM_MESH_OWNER", script, ".")',
      '        return "ok"',
      '    except SystemExit as e:',
      '        return "refused: " + str(e)',
      '    except RuntimeError as e:',
      '        return "no entry: " + str(e)[:20]',
      'out["owner"] = run("at_team", "tools/units/import_meshy_kdf_team.py")',
      'out["moved"] = run("demo_squad", "tools/units/import_meshy_kdf_team.py")',
      'out["unknown"] = run("nobody", "tools/units/import_meshy_kdf_team.py")',
      'print(json.dumps(out))',
    ].join('\n');
    const r = spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, string>;
    expect(out.owner).toBe('ok');
    expect(out.moved).toMatch(/^refused: demo_squad: TEAM_MESH_OWNER names tools\/units\/import_meshy_skinned_team\.py/);
    expect(out.moved).toMatch(/import_meshy_kdf_team\.py no longer builds it/);
    expect(out.unknown).toMatch(/^no entry: /);
  });
});
