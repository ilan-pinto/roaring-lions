/**
 * G8 -- every figure armed (GH-746 follow-up, the 1 Nov infantry audit; the lead's rule of 30 Oct made checkable).
 * Every figure build of every infantry GLB carries a `weapon` or `charge` part on its OWN bones, and the unit type that
 * draws the file declares weapons in `data/units`.
 *
 * Why it exists. "Arm the unarmed figures" was ruled for the three GH-826 teams only; the rest of the roster was "later",
 * and nothing counted who held what. The store then showed a mortar crew with nothing in its hands, a spotter whose
 * binoculars were a box over his face, a radio operator with a radio and no rifle.
 *
 * What counts as armed is deliberately narrow and read off the bytes: a mesh of role `weapon` (a rifle, a launcher) or
 * `charge` (a satchel, a demolition charge) whose triangles ride this build's bones. A `metal` part (binoculars, a radio, a
 * detector pole) is kit, not a weapon. A crew weapon on the shared `prop` bone is the TEAM's: it arms the team, not a man,
 * so the man who works it (`atgm_crew0` at the tripod, `emtr_crew0` at the tube) is still listed here until he also carries
 * a personal weapon. A walker twin is the same soldier in another posture and is read through its base.
 *
 * Every figure that fails is a named exemption with a demotion assertion.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RIGGED_UNIT_MESHES } from '../../packages/app/src/mesh-catalogue';
import { readGlb, type GlbFile } from './mesh_gait';
import { figureBuilds, infantryTeams, isTwin, owns, readRoleMeshes, rebindVertices, trianglesOf } from './mesh_figures';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const MESHES = `${REPO}art/meshes/`;

const ARMED_ROLES: ReadonlySet<string> = new Set(['weapon', 'charge']);

/** The builds of a file that carry no weapon or charge part of their own. */
export function unarmedBuilds(glb: GlbFile): string[] {
  const meshes = readRoleMeshes(glb);
  const builds = figureBuilds(glb);
  const armed = new Set<string>();
  for (const m of meshes) {
    if (!ARMED_ROLES.has(m.role)) continue;
    for (const t of trianglesOf(m)) for (const p of builds) if (owns(p, t.bone) && !/death/.test(t.bone)) armed.add(p);
  }
  return builds.filter((p) => !isTwin(p, builds) && !armed.has(p));
}

/**
 * The figures with nothing of their own to fire. Keyed by team, each value the builds that fail and why; the same demotion
 * rule as everywhere: when a build gains a weapon, its entry must go. `gear` marks a man who works the team's crew weapon.
 */
export const UNARMED_EXEMPT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  at_team: { at_spot: 'spotter: only a box of binoculars (role metal), held by nothing' },
  atgm_cell: { atgm_crew0: 'gunner at the Kornet tripod (the shared prop): gear, no personal weapon', atgm_crew1: 'loader: nothing in hand' },
  charge_squad: { chg0: 'demolition man whose vest carries no charge part' },
  demo_squad: { demo_a: 'the Combat Engineer who works the satchel: no carbine, holds nothing in any clip' },
  digger_crew: { dig: 'a pick and a shovel (roles metal, wood): a tool, not a weapon' },
  mortar_crew: { emtr_crew0: 'gunner at the tube (the shared prop): gear, no personal weapon', emtr_crew1: 'loader: no round, no weapon' },
  mortar_team: { mtr_crew0: 'gunner at the 60 mm tube: no personal weapon', mtr_crew1: 'assistant gunner: no round, no weapon' },
  officer_engineer: { dalia: 'officer with a metal part only (no weapon, no charge)' },
  officer_fires: { sagi: 'the observer: nothing in hand, arm fused into the torso' },
  officer_infantry: { maya: 'officer with no weapon part at all' },
  recoilless_team: { rcl_load: 'loader: no round, no weapon' },
  recon_zikit: { zk_radio: 'radio operator: a radio (metal), no rifle', zk_spot: 'spotter: nothing in hand' },
  yahalom_squad: {
    yah_a: 'detector bearer: a pole (metal, webbing), no carbine',
    yah_ak: 'yah_a\'s second build (the kneel clips): the same pole, still no carbine',
  },
  manpad_team: { mpd_spot: 'spotter: a scope (metal), no weapon' },
};

const teams = infantryTeams(MESHES, (d) => readdirSync(d));

describe('G8: every figure carries a weapon of its own', () => {
  it('reads the population it says it reads', () => {
    expect(teams.length).toBe(23);
  });

  it('the exemptions name real builds of real teams', () => {
    for (const [team, figs] of Object.entries(UNARMED_EXEMPT)) {
      const t = teams.find(([n]) => n === team);
      expect(t, `${team}: not an infantry GLB`).toBeDefined();
      for (const f of Object.keys(figs)) expect(figureBuilds(t![1]), `${team}: ${f}`).toContain(f);
    }
  });

  it.each(teams)('%s: the unarmed builds are exactly the named ones', (team, glb) => {
    const want = Object.keys(UNARMED_EXEMPT[team] ?? {}).sort();
    expect(unarmedBuilds(glb).sort(), `${team}: a build gained or lost a weapon -- update (or delete) its UNARMED_EXEMPT entry`).toEqual(want);
    for (const why of Object.values(UNARMED_EXEMPT[team] ?? {})) expect(why.length, 'a reason, not a name').toBeGreaterThan(15);
  });

  it('a team that fields armed men names weapons in data/units', () => {
    const weaponsOf = (id: string): unknown[] | null => {
      for (const dir of ['kdf', 'enemy']) {
        try {
          return (JSON.parse(readFileSync(`${REPO}data/units/${dir}/${id}.json`, 'utf8')) as { weapons?: unknown[] }).weapons ?? [];
        } catch { /* not in this faction */ }
      }
      return null;
    };
    let checked = 0;
    for (const [type, entry] of Object.entries(RIGGED_UNIT_MESHES)) {
      const team = entry.files[0].replace(/\.glb$/, '');
      const t = teams.find(([n]) => n === team);
      const w = weaponsOf(type);
      if (!t || w === null) continue;
      const armedMen = figureBuilds(t[1]).filter((p) => !isTwin(p, figureBuilds(t[1]))).length - unarmedBuilds(t[1]).length;
      if (armedMen > 0) {
        expect(w.length, `${type}: its GLB arms ${armedMen} men but data/units declares no weapon`).toBeGreaterThan(0);
        checked += 1;
      }
    }
    expect(checked, 'a vacuous cross-check passes everything').toBeGreaterThanOrEqual(15);
  });
});

describe('G8 can fail (constructed inputs)', () => {
  it('the Rifle Squad is fully armed, and a rifleman whose weapon is moved onto another man\'s bones reads unarmed', () => {
    const squad = readGlb(`${MESHES}inf_squad.glb`);
    expect(unarmedBuilds(squad)).toEqual([]);
    expect(unarmedBuilds(rebindVertices(squad, 'f1_weapon', 'f2_spine'))).toEqual(['f1']);
  });
  it('handing demo_b\'s carbine to demo_a arms the engineer and disarms the rifleman', () => {
    const demo = readGlb(`${MESHES}demo_squad.glb`);
    expect(unarmedBuilds(demo)).toEqual(['demo_a']);
    expect(unarmedBuilds(rebindVertices(demo, 'demo_b_weapon', 'demo_a_spine'))).toEqual(['demo_b']);
  });
});
