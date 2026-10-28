// The merge check of `inf-kit-capture.ts`, as a pure function so a test can make it fail.
//
// What the renderer holds for `inf_squad` at each state, against numbers measured offline. The
// served file is the Draco ENCODE, and Draco drops 432 degenerate triangles from the shipped
// `uniform` (7,032 -> 6,600, before the kit existed: 8,604 -> 8,172 at tier 0), so the in-game base is
// 8,172; the KIT triangles are exactly the art file's (`infantry-kit-shipped.test.ts`): 1,290 / 1,060 /
// 1,068 for each track at tier 3, 3,418 for all three.

export interface State {
  readonly id: string;
  readonly label: string;
  readonly tiers: Readonly<Record<string, number>>;
  readonly kitTris: number;
}

export interface Reading {
  tiers: Record<string, number> | null;
  loaded: boolean;
  tris: number;
  kitTris: number;
  meshes: number;
  /** `renderer.info.render.calls` for one frame, shadow + main + post, at zoom 2.5. */
  calls: number;
}

/** Live triangles of the encoded `inf_squad` at tier 0. */
export const ENCODED_BASE_TRIS = 8172;

export const STATES: readonly State[] = [
  { id: 'T0', label: 'tier 0', tiers: {}, kitTris: 0 },
  { id: 'A3', label: 'armour 3', tiers: { armour: 3 }, kitTris: 1290 },
  { id: 'S3', label: 'sensors 3', tiers: { sensors: 3 }, kitTris: 1060 },
  { id: 'F3', label: 'firepower 3', tiers: { firepower: 3 }, kitTris: 1068 },
  { id: 'full', label: 'full kit', tiers: { armour: 3, sensors: 3, firepower: 3 }, kitTris: 3418 },
];

export function mergeFailures(results: ReadonlyMap<string, Reading>, states: readonly State[] = STATES): string[] {
  const failures: string[] = [];
  const t0 = results.get('T0');
  if (!t0) failures.push('no tier 0 reading to hold the others against');
  for (const state of states) {
    const r = results.get(state.id);
    if (!r) {
      failures.push(`${state.id}: not captured`);
      continue;
    }
    if (!r.loaded) failures.push(`${state.id}: no inf_squad template loaded`);
    if (JSON.stringify(r.tiers ?? {}) !== JSON.stringify(state.tiers)) {
      failures.push(`${state.id}: renderer tiers ${JSON.stringify(r.tiers)} != seeded ${JSON.stringify(state.tiers)}`);
    }
    if (r.kitTris !== state.kitTris) failures.push(`${state.id}: ${r.kitTris} kit triangles merged, expected ${state.kitTris}`);
    if (r.tris !== ENCODED_BASE_TRIS + state.kitTris) {
      failures.push(`${state.id}: ${r.tris} triangles in the template, expected ${ENCODED_BASE_TRIS + state.kitTris}`);
    }
    if (t0 && r.meshes !== t0.meshes) failures.push(`${state.id}: ${r.meshes} meshes against tier 0's ${t0.meshes} -- the kit must add none`);
    if (t0 && r.calls !== t0.calls) failures.push(`${state.id}: ${r.calls} draw calls against tier 0's ${t0.calls} -- the kit must cost +0`);
  }
  return failures;
}
