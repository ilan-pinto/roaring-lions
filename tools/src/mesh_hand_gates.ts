/**
 * The readings under the hand gates (GH-746), in a module that registers no tests. A test file that exports a helper
 * re-registers its own tests in whoever imports it, so the gates (`mesh_hand_census.test.ts`, `mesh_hand_holds.test.ts`,
 * `mesh_armed.test.ts`, `mesh_fragments.test.ts`) keep their exemption tables to themselves and read through here.
 */
import { measureGrip, type GlbFile } from './mesh_gait';
import { figureBuilds, handAssembly, handsExtras, isTwin, owns, readRoleMeshes, trianglesOf } from './mesh_figures';

// ---- G1: the census ---------------------------------------------------------------------------------------------------

/** A living modelled hand: its pieces, and its triangle count's band (397 shipped; the spec's cap is 400). */
export const HAND_PIECES = 7;
export const HAND_TRIANGLES: readonly [number, number] = [350, 400];

/** Why a file fails the hand census, as a list. Empty is a pass. */
export function censusViolations(glb: GlbFile): string[] {
  const meshes = readRoleMeshes(glb);
  const builds = figureBuilds(glb);
  const out: string[] = [];
  for (const p of builds.filter((b) => !isTwin(b, builds))) {
    let hands = 0;
    for (const side of ['L', 'R'] as const) {
      const h = handAssembly(glb, p, side, meshes);
      if (h.triangles === 0) { out.push(`${p}_hand_${side}: no hand assembly on its bone`); continue; }
      hands += 1;
      if (h.pieces !== HAND_PIECES) out.push(`${p}_hand_${side}: ${h.pieces} pieces, the generator makes ${HAND_PIECES}`);
      if (h.triangles < HAND_TRIANGLES[0] || h.triangles > HAND_TRIANGLES[1]) out.push(`${p}_hand_${side}: ${h.triangles} triangles outside ${HAND_TRIANGLES.join('-')}`);
    }
    if (hands !== 2) out.push(`${p}: ${hands} hands, not 2`);
  }
  return out;
}

// ---- G3: the holds ----------------------------------------------------------------------------------------------------

export const GRIP_HZ = 30;

/** A team is a closed-hands team when every figure has both hands as modelled assemblies AND the pass declared the poses. */
export function hasClosedHands(glb: GlbFile): boolean {
  if (handsExtras(glb) === null) return false;
  const meshes = readRoleMeshes(glb);
  const builds = figureBuilds(glb);
  return builds
    .filter((b) => !isTwin(b, builds))
    .every((b) => (['L', 'R'] as const).every((s) => handAssembly(glb, b, s, meshes).triangles > 0));
}

/** Lowest palm-side contact of either hand over `clip`, for one figure. */
export function lowestContact(glb: GlbFile, clip: string, fig: string): { fire: number; support: number } {
  const r = measureGrip('', clip, fig, { glb, hz: GRIP_HZ });
  return { fire: r.fire.contact ?? 0, support: r.support.contact ?? 0 };
}

// ---- G8: armed --------------------------------------------------------------------------------------------------------

const ARMED_ROLES: ReadonlySet<string> = new Set(['weapon', 'charge']);

/** The builds of a file that carry no weapon or charge part of their own (walker twins read through their base). */
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
