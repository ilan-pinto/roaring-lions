// The merge check of `inf-kit-capture.ts`, as a pure function so a test can make it fail.
//
// What the renderer holds for a kit team (`inf_squad`, then `demo_squad`) at each state, against numbers measured offline. The
// served file is the Draco ENCODE, and Draco drops 432 degenerate triangles from the shipped
// `uniform` (7,032 -> 6,600, before the kit existed: 8,604 -> 8,172 at tier 0), so the in-game base is
// 8,172; the KIT triangles are exactly the art file's (`infantry-kit-shipped.test.ts`). The 29 Oct redesign
// ("real gear, fitted") has all eleven states: each tier of each track alone, and the full kit.

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
  { id: 'A1', label: 'armour 1', tiers: { armour: 1 }, kitTris: 786 },
  { id: 'A2', label: 'armour 2', tiers: { armour: 2 }, kitTris: 1074 },
  { id: 'A3', label: 'armour 3', tiers: { armour: 3 }, kitTris: 1242 },
  { id: 'S1', label: 'sensors 1', tiers: { sensors: 1 }, kitTris: 372 },
  { id: 'S2', label: 'sensors 2', tiers: { sensors: 2 }, kitTris: 728 },
  { id: 'S3', label: 'sensors 3', tiers: { sensors: 3 }, kitTris: 958 },
  { id: 'F1', label: 'firepower 1', tiers: { firepower: 1 }, kitTris: 570 },
  { id: 'F2', label: 'firepower 2', tiers: { firepower: 2 }, kitTris: 906 },
  { id: 'F3', label: 'firepower 3', tiers: { firepower: 3 }, kitTris: 1158 },
  { id: 'full', label: 'full kit', tiers: { armour: 3, sensors: 3, firepower: 3 }, kitTris: 3358 },
];

/**
 * `demo_squad`, the Demolition squad (30 Oct 2026): literals from its art file (`kitnums`: every part at or below the
 * track's tier, the highest tier of each (figure, slot, side) only), and from the Draco ENCODE for the base. Its devices
 * ride `uniform`, so the kit costs +0 meshes as the Rifle Squad's does.
 */
export const DEMO_ENCODED_BASE_TRIS = 7206;
export const DEMO_STATES: readonly State[] = [
  { id: 'T0', label: 'tier 0', tiers: {}, kitTris: 0 },
  { id: 'A1', label: 'armour 1', tiers: { armour: 1 }, kitTris: 484 },
  { id: 'A2', label: 'armour 2', tiers: { armour: 2 }, kitTris: 556 },
  { id: 'A3', label: 'armour 3', tiers: { armour: 3 }, kitTris: 616 },
  { id: 'S1', label: 'sensors 1', tiers: { sensors: 1 }, kitTris: 160 },
  { id: 'S2', label: 'sensors 2', tiers: { sensors: 2 }, kitTris: 412 },
  { id: 'S3', label: 'sensors 3', tiers: { sensors: 3 }, kitTris: 572 },
  { id: 'F1', label: 'firepower 1', tiers: { firepower: 1 }, kitTris: 310 },
  { id: 'F2', label: 'firepower 2', tiers: { firepower: 2 }, kitTris: 422 },
  { id: 'F3', label: 'firepower 3', tiers: { firepower: 3 }, kitTris: 546 },
  { id: 'full', label: 'full kit', tiers: { armour: 3, sensors: 3, firepower: 3 }, kitTris: 1734 },
];

/**
 * `breach_team` (30 Oct 2026): literals from its art file, by the same count as the two above (every part at or below the track's
 * tier, the highest tier of each (figure, slot, side) only) and from the Draco ENCODE for the base (7,910 live triangles). Its devices
 * ride `uniform` and `weapon`, both primitives the base already draws, so the kit costs +0 meshes.
 */
export const BREACH_ENCODED_BASE_TRIS = 7910;
export const BREACH_STATES: readonly State[] = [
  { id: 'T0', label: 'tier 0', tiers: {}, kitTris: 0 },
  { id: 'A1', label: 'armour 1', tiers: { armour: 1 }, kitTris: 536 },
  { id: 'A2', label: 'armour 2', tiers: { armour: 2 }, kitTris: 588 },
  { id: 'A3', label: 'armour 3', tiers: { armour: 3 }, kitTris: 632 },
  { id: 'S1', label: 'sensors 1', tiers: { sensors: 1 }, kitTris: 248 },
  { id: 'S2', label: 'sensors 2', tiers: { sensors: 2 }, kitTris: 500 },
  { id: 'S3', label: 'sensors 3', tiers: { sensors: 3 }, kitTris: 660 },
  { id: 'F1', label: 'firepower 1', tiers: { firepower: 1 }, kitTris: 380 },
  { id: 'F2', label: 'firepower 2', tiers: { firepower: 2 }, kitTris: 632 },
  { id: 'F3', label: 'firepower 3', tiers: { firepower: 3 }, kitTris: 800 },
  { id: 'full', label: 'full kit', tiers: { armour: 3, sensors: 3, firepower: 3 }, kitTris: 2092 },
];

/** Per team: the states and the encoded tier-0 triangle count the merge is held against. */
export const TEAM_CHECKS: Readonly<Record<string, { readonly baseTris: number; readonly states: readonly State[] }>> = {
  inf_squad: { baseTris: ENCODED_BASE_TRIS, states: STATES },
  demo_squad: { baseTris: DEMO_ENCODED_BASE_TRIS, states: DEMO_STATES },
  breach_team: { baseTris: BREACH_ENCODED_BASE_TRIS, states: BREACH_STATES },
};

export function mergeFailures(
  results: ReadonlyMap<string, Reading>,
  states: readonly State[] = STATES,
  baseTris: number = ENCODED_BASE_TRIS,
  unit = 'inf_squad'
): string[] {
  const failures: string[] = [];
  const t0 = results.get('T0');
  if (!t0) failures.push('no tier 0 reading to hold the others against');
  for (const state of states) {
    const r = results.get(state.id);
    if (!r) {
      failures.push(`${state.id}: not captured`);
      continue;
    }
    if (!r.loaded) failures.push(`${state.id}: no ${unit} template loaded`);
    if (JSON.stringify(r.tiers ?? {}) !== JSON.stringify(state.tiers)) {
      failures.push(`${state.id}: renderer tiers ${JSON.stringify(r.tiers)} != seeded ${JSON.stringify(state.tiers)}`);
    }
    if (r.kitTris !== state.kitTris) failures.push(`${state.id}: ${r.kitTris} kit triangles merged, expected ${state.kitTris}`);
    if (r.tris !== baseTris + state.kitTris) {
      failures.push(`${state.id}: ${r.tris} triangles in the template, expected ${baseTris + state.kitTris}`);
    }
    if (t0 && r.meshes !== t0.meshes) failures.push(`${state.id}: ${r.meshes} meshes against tier 0's ${t0.meshes} -- the kit must add none`);
    if (t0 && r.calls !== t0.calls) failures.push(`${state.id}: ${r.calls} draw calls against tier 0's ${t0.calls} -- the kit must cost +0`);
  }
  return failures;
}

/**
 * The part of the garage plate the three riflemen stand in, as fractions of its width and height.
 * The kit mark (top left), the Maxed stamp (bottom right) and the turn hint (bottom left) are DOM
 * over the model and change with the account whatever the model does, so a comparison of the
 * model must leave them out.
 */
export const MODEL_REGION = { x0: 0.2, x1: 0.8, y0: 0.24, y1: 0.74 } as const;

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major. */
  readonly data: ArrayLike<number>;
}

/** Pixels inside `MODEL_REGION` of `a` and `b` whose channels differ by more than 8/255; infinity for two sizes. */
export function differingPixels(a: Pixels, b: Pixels): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  const { x0, x1, y0, y1 } = MODEL_REGION;
  let n = 0;
  for (let y = Math.floor(a.height * y0); y < Math.ceil(a.height * y1); y++) {
    for (let x = Math.floor(a.width * x0); x < Math.ceil(a.width * x1); x++) {
      const i = (y * a.width + x) * 4;
      if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])) > 8) n++;
    }
  }
  return n;
}
