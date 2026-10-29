// The merge check of `inf-kit-capture.ts`, as a pure function so a test can make it fail.
//
// What the renderer holds for `inf_squad` at each state, against numbers measured offline. The
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
