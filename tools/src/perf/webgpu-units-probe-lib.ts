// GH-943 WebGPU P3 T2: the pure half of the units/fx probe (`webgpu-units-probe.ts`). Readings and subjects in, verdicts and refusals out,
// so a test can feed each refusal the input that trips it.
//
// WHAT IT IS. Report-only parity for everything no gated scenario shows (plan, "Parity method", ungated rows): for one layer toggle on one
// scripted moment, the shown-minus-hidden delta on each arm, and the ratio r = node / legacy-MATCHED against the band the plan names. Four
// readings per subject, because the ratio and the witness check read different legacy arms (Ruling P3-R5):
//
//   L   plain legacy (`matchNodeStatements` OFF). The WITNESS: if hiding the layer moves nothing here, the subject is vacuous, so it REFUSES.
//   Lm  legacy matched (the node census run on the legacy scene, ported keys left visible). The DENOMINATOR of r. A subject whose material
//       is not ported yet is hidden here, so it reads 0 and prints `n/a (unported)`; it goes live when a port flips the subject.
//   F   node on WebGL2.            G  node on WebGPU.
//
// A node delta under its floor reads DEAD. The floor is "a third of the smallest of 3 CI runs per key" and does not exist yet for these
// keys, so a missing floor means DEAD is exactly "the toggle moved nothing". DEAD is the right answer for a census-HIDDEN object (a
// ShaderMaterial the node backend does not draw yet). A hook-less subject drawn with a stock material on node (the unit hooks, `valley`)
// moves the frame, and its row is labelled `pre-port` until its port names its own witness (Ruling P3-R5 iii).
import { BANDS, ratioOf, type ArmDelta, type BandName } from '../golden-diff/parity';
import { BLAST_SUBJECTS, DEFAULT_MAP, LADDER_ZOOM, cameraTileOf } from './blast-captures';
import { E6_SUBJECTS } from './e6-captures';

export type ProbeKind = 'units' | 'fx';
/** The arms a run drives. `L` produces two readings (plain and matched), on one page. */
export type ProbeArm = 'L' | 'F' | 'G';
/** The four readings. */
export type ReadingArm = 'L' | 'Lm' | 'F' | 'G';

/** `backendInfo().kind` each arm must report. */
export const PROBE_ARM_KIND: Readonly<Record<ProbeArm, string>> = { L: 'legacy-gl', F: 'node-webgl2', G: 'node-webgpu' };

export interface ProbeSubject {
  readonly id: string;
  /** The sandbox map the page boots. */
  readonly map: string;
  /** Sandbox flags, as bare tokens (`tunnel`, `roe`). */
  readonly flags: string[];
  /** The absolute sim tick the page is stepped to (never below the boot settle's) before `setup` runs. */
  readonly tick: number;
  /** Where the camera is put before `setup`, in tiles, and the zoom. `setup` may re-aim it. */
  readonly camera: { tile: [number, number]; zoom: number };
  /**
   * In-page statements, run in order inside one async function with `__lions` and `__probe` (the helpers this probe installs) in scope.
   * A statement beginning `@blast:<id>` / `@firefight:<id>` / `@e6:beam` is not JavaScript: it names a scripted moment the driver replays
   * by IMPORTING it from `blast-captures.ts` / `e6-captures.ts` (never copying), and `<id>` must be a `BLAST_SUBJECTS` id.
   */
  readonly setup: string[];
  /** fx: after `setup`, advance the FRAME clock `n` frames of `dtMs` each (no sim tick), so a moment is read at a fixed age. */
  readonly frameSteps?: { n: number; dtMs: number };
  /** The debug layer whose shown-minus-hidden delta is the reading. */
  readonly layer: string;
  readonly band: BandName;
  /** `[x, y, w, h]` in CSS pixels of the canvas; absent means the whole frame. */
  readonly crop?: [number, number, number, number];
}

const BSO = 'beit_sahwan_outskirts';
/** The E6 `beam_sequence` subject's own framing (imported). */
const e6Beam = E6_SUBJECTS.find((e) => e.id === 'beam_sequence');
if (e6Beam === undefined) throw new Error('E6_SUBJECTS no longer holds beam_sequence');
const E6_BEAM_CAMERA: { tile: [number, number]; zoom: number } = { tile: [e6Beam.x, e6Beam.y], zoom: e6Beam.zoom };
/** The sandbox force's own Lavi tile (`VEHICLE_SCENARIO`'s camera). */
const FORCE: [number, number] = [4.5, 20.5];

/** Aim at a living unit of `type` (the `index`-th) and zoom, then settle a few frames. */
const aim = (type: string, index: number, zoom: number, name = 'u'): string[] => [
  `const ${name} = __lions.units().filter((x) => x.type === ${JSON.stringify(type)})[${index}];`,
  `if (${name} === undefined) throw new Error('probe: no ${type} on this map');`,
  `__probe.follow(${name}.id, ${zoom});`,
];

/**
 * The subjects, per probe. EVERY LATER PORT (T3..T12) APPENDS HERE and flips its subject's node side live by adding the id to
 * `PORTED_PROBE_SUBJECTS`. Today every subject reads the legacy renderer, so a node delta is DEAD (the object is census-hidden) or
 * `pre-port` (a stock material draws it without its hook).
 */
export const PROBE_SUBJECTS: Record<ProbeKind, ProbeSubject[]> = {
  units: [
    {
      id: 'moving-lavi',
      map: BSO,
      flags: [],
      tick: 20,
      camera: { tile: FORCE, zoom: 2 },
      setup: [
        ...aim('mbt_lavi', 0, 2, 'lv'),
        "__lions.sim.queueCommand({ kind: 'move', ids: [lv.id], x: Math.round((lv.x + 12) * 65536), y: Math.round((lv.y + 0.5) * 65536) });",
        '__lions.step(30);',
        'await __probe.settle(4, 50);',
        '__probe.follow(lv.id, 2);',
      ],
      layer: 'running-gear',
      band: 'loose',
    },
    {
      id: 'wreck-lavi',
      map: BSO,
      flags: [],
      tick: 20,
      camera: { tile: FORCE, zoom: 2.5 },
      setup: [
        ...aim('mbt_lavi', 1, 2.5, 'lv'),
        '__lions.sim.debugKill(lv.id);',
        '__lions.step(1);',
        // The wreck reveal: the death clip, then the settled wreck.
        'await __probe.settle(30, 100);',
      ],
      layer: 'wreck-soot',
      band: 'loose',
    },
    {
      id: 'rain-kdf',
      // The wetland: `RendererOptions.weather === 'rain'`. Rain is P4, so the driver hides the `rain` layer on every arm.
      map: 'ein_qasab',
      flags: [],
      tick: 20,
      camera: { tile: [24, 24], zoom: 3 },
      setup: [...aim('inf_squad', 0, 3, 'sq'), 'await __probe.settle(4, 50);'],
      layer: 'unit-surface',
      band: 'loose',
    },
    {
      id: 'wounded-squad',
      map: BSO,
      flags: [],
      tick: 20,
      camera: { tile: FORCE, zoom: 3 },
      setup: [
        ...aim('inf_squad', 0, 3, 'sq'),
        // The wounded body type (`wounded_kdf`, role `wounded`): four of them lying beside the squad.
        "const ids = [0, 1, 2, 3].map((i) => __probe.spawn('wounded_kdf', 0, sq.x + 1.5 + (i % 2) * 0.8, sq.y + 1 + Math.floor(i / 2) * 0.8));",
        'await __probe.meshes(ids, false);',
        'await __probe.settle(4, 50);',
      ],
      layer: 'wounded-read',
      band: 'ao',
    },
    {
      id: 'occluded',
      map: BSO,
      flags: [],
      tick: 20,
      camera: { tile: [37.5, 31], zoom: 2.5 },
      setup: [
        // Six rifle squads packed against the south-east house (x 36-39, y 30-32, the `collapse_house` of blast-captures), the camera's far
        // side among them. Damaged, so a health bar draws too: the layer is `overlays` until T5 gives the outline its own.
        "const ids = [[35.4, 29.4], [36.6, 29.2], [37.8, 29.1], [35.2, 30.6], [35.3, 31.8], [38.4, 29.3]].map((p) => __probe.spawn('inf_squad', 0, p[0], p[1]));",
        'await __probe.meshes(ids, false);',
        '__probe.damage(ids, 0.4);',
        '__probe.follow(ids[1], 2.5);',
        'await __probe.settle(4, 50);',
      ],
      layer: 'overlays',
      band: 'tight',
    },
    {
      id: 'smoke-own',
      map: BSO,
      flags: [],
      tick: 20,
      camera: { tile: FORCE, zoom: 2.5 },
      setup: [
        ...aim('apc_eitan', 0, 2.5, 'ap'),
        // The hull lays a screen over itself; 60 ticks later it stands and the hull is inside it.
        "__lions.sim.queueCommand({ kind: 'smoke', ids: [ap.id], x: Math.round((ap.x + 0.5) * 65536), y: Math.round((ap.y + 0.5) * 65536) });",
        '__lions.step(60);',
        'await __probe.settle(4, 50);',
      ],
      layer: 'smoke-outline',
      band: 'tight',
    },
    {
      id: 'held-house',
      map: BSO,
      flags: [],
      tick: 20,
      camera: { tile: [37.5, 31], zoom: 2.5 },
      setup: [
        // Two squads put beside the south-east house, ordered in. `teleport` is the dev hook; the garrison walk itself is the sim's.
        "const hs = __lions.sim.structureAt(37, 31);",
        "if (hs < 0) throw new Error('probe: no structure at 37,31');",
        "const sq = __lions.units().filter((x) => x.type === 'inf_squad').slice(0, 2);",
        'sq.forEach((u, i) => __lions.sim.teleport(u.id, Math.round((37.5 + i) * 65536), Math.round(33.2 * 65536)));',
        "__lions.sim.queueCommand({ kind: 'garrison', ids: sq.map((u) => u.id), structure: hs });",
        '__lions.step(120);',
        '__probe.goto(37.5, 31, 2.5);',
        'await __probe.settle(4, 50);',
      ],
      layer: 'garrison-banner',
      band: 'loose',
    },
    {
      id: 'damaged-zone',
      map: BSO,
      flags: ['roe'],
      tick: 20,
      camera: { tile: FORCE, zoom: 1 },
      setup: [
        // The synthesised zone sits on the midpoint of the two anchors; the damaged hull goes into it.
        "const f = __lions.units(0), h = __lions.units(1);",
        "const mx = (f.reduce((a, u) => a + u.x, 0) / f.length + h.reduce((a, u) => a + u.x, 0) / h.length) / 2;",
        "const my = (f.reduce((a, u) => a + u.y, 0) / f.length + h.reduce((a, u) => a + u.y, 0) / h.length) / 2;",
        "const ap = __lions.units().filter((x) => x.type === 'apc_eitan')[0];",
        '__lions.sim.teleport(ap.id, Math.round(mx * 65536), Math.round(my * 65536));',
        '__probe.damage([ap.id], 0.5);',
        '__lions.step(2);',
        '__probe.goto(mx, my, 1.4);',
        'await __probe.settle(4, 50);',
      ],
      layer: 'overlays',
      band: 'tight',
    },
    {
      id: 'route',
      map: BSO,
      flags: [],
      tick: 20,
      camera: { tile: FORCE, zoom: 2 },
      setup: [
        ...aim('mbt_lavi', 0, 2, 'lv'),
        // A fifteen-tile supply route along the row the Lavi stands on (tile indices, y * width + x).
        "__lions.renderer.supplyRoutes = [{ tiles: Array.from({ length: 15 }, (_, i) => Math.floor(lv.y) * __lions.sim.width + Math.floor(lv.x) - 3 + i), cutSpan: null }];",
        'await __probe.settle(4, 50);',
      ],
      layer: 'supply-route',
      band: 'tight',
    },
    {
      id: 'trail',
      map: BSO,
      flags: ['tunnel'],
      tick: 20,
      camera: { tile: FORCE, zoom: 1.5 },
      setup: TUNNEL_SETUP(),
      layer: 'trail',
      band: 'tight',
    },
    {
      id: 'tunnel',
      map: BSO,
      flags: ['tunnel'],
      tick: 20,
      camera: { tile: FORCE, zoom: 1.5 },
      setup: TUNNEL_SETUP(),
      layer: 'tunnel-xray',
      band: 'loose',
    },
    {
      id: 'valley',
      map: 'wadi_halam_4',
      flags: [],
      tick: 20,
      // Out to the clamp's far end: the valley backdrop is the ground beyond the playable rectangle.
      camera: { tile: [24, 24], zoom: 0.4 },
      setup: ['await __probe.settle(4, 50);'],
      layer: 'backdrop',
      band: 'loose',
    },
  ],
  fx: [
    // Each is a scripted moment from `blast-captures.ts` / `e6-captures.ts`, replayed by import. Subjects on one moment share a page.
    { id: 'mortar-impact', ...fxMoment('mortar_team', 'particles'), band: 'loose', frameSteps: { n: 6, dtMs: 50 } },
    { id: 'mortar-impact/muzzle-burst', ...fxMoment('mortar_team', 'muzzle-burst'), band: 'loose', frameSteps: { n: 6, dtMs: 50 } },
    { id: 'mortar-impact/flipbook', ...fxMoment('mortar_team', 'flipbook'), band: 'loose', frameSteps: { n: 6, dtMs: 50 } },
    { id: 'vehicle-death', ...fxMoment('mbt_lavi', 'flipbook'), band: 'loose', frameSteps: { n: 16, dtMs: 50 } },
    { id: 'vehicle-death/smoke-plume', ...fxMoment('mbt_lavi', 'smoke-plume'), band: 'loose', frameSteps: { n: 16, dtMs: 50 } },
    { id: 'smoke-screen', ...fxMoment('smoke_eitan', 'smoke-screen'), band: 'loose', frameSteps: { n: 20, dtMs: 50 } },
    { id: 'collapse', ...fxMoment('collapse_house', 'collapse-shroud'), band: 'loose', frameSteps: { n: 10, dtMs: 50 } },
    { id: 'tracers', ...fxMoment('blast_in_firefight', 'tracers', '@firefight'), band: 'loose', frameSteps: { n: 1, dtMs: 16 } },
    { id: 'atgm', ...fxMoment('aps_lavi', 'missiles'), band: 'loose', frameSteps: { n: 1, dtMs: 16 } },
    {
      id: 'beam-swarm',
      map: BSO,
      flags: [],
      tick: 5,
      camera: E6_BEAM_CAMERA,
      setup: ['@e6:beam'],
      layer: 'beam',
      band: 'loose',
    },
    {
      id: 'beam-swarm/swarm',
      map: BSO,
      flags: [],
      tick: 5,
      camera: E6_BEAM_CAMERA,
      setup: ['@e6:beam'],
      layer: 'swarm',
      band: 'loose',
    },
  ],
};

/**
 * The tunnel moment, shared by `trail` and `tunnel`: `&tunnel` digs one pre-dug route from the hostile anchor a third of the way back, and the
 * recon drone (which marks tunnels) is put on its midpoint so the viewer holds the route at level 2 (the x-ray, and the spoil trail).
 */
function TUNNEL_SETUP(): string[] {
  return [
    "if (__lions.sim.tunnelCount < 1) throw new Error('probe: &tunnel dug no route');",
    '// The route runs from point 0 to its length; its midpoint is where the drone looks and the camera goes.',
    'const len = __lions.sim.tnLength[0] / 65536;',
    'const mid = __lions.sim.tunnelPointAt(0, Math.round((len / 2) * 65536));',
    "const dr = __lions.units().filter((x) => x.type === 'recon_drone')[0];",
    'if (dr !== undefined) __lions.sim.teleport(dr.id, mid[0], mid[1]);',
    '__lions.step(80);',
    '__probe.goto(mid[0] / 65536, mid[1] / 65536, 1.5);',
    'await __probe.settle(4, 50);',
  ];
}

/**
 * The ProbeSubject fields an fx moment takes from its blast subject: the map, flags, camera and zoom are READ from `BLAST_SUBJECTS`
 * (imported, never copied), and `setup` names the moment for the driver to replay with `blast-captures.ts`'s own staging functions.
 */
function fxMoment(blastId: string, layer: string, tag = '@blast'): Pick<ProbeSubject, 'map' | 'flags' | 'tick' | 'camera' | 'setup' | 'layer'> {
  const s = BLAST_SUBJECTS.find((b) => b.id === blastId);
  if (s === undefined) throw new Error(`fx subject names blast subject "${blastId}", which BLAST_SUBJECTS does not hold`);
  return { map: s.map ?? DEFAULT_MAP, flags: [...(s.flags ?? [])], tick: 5, camera: { tile: cameraTileOf(s), zoom: s.ladderZoom ?? LADDER_ZOOM }, setup: [`${tag}:${blastId}`], layer };
}

/**
 * Subjects whose node side is LIVE: a port task adds its subject id here in the same PR. Until then a non-DEAD node delta is labelled
 * `pre-port`. The set is read by `rowStatus` only.
 */
export const PORTED_PROBE_SUBJECTS: Set<string> = new Set<string>();

// ---------------------------------------------------------------------------------------------------------------------------------
// The verdict.
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ProbeRow {
  readonly band: BandName;
  /** The node arm's shown-minus-hidden delta, or null when that arm did not run. */
  readonly node: ArmDelta | null;
  /** Legacy MATCHED's delta (the denominator), or null when it did not run. */
  readonly legacyMatched: ArmDelta | null;
  /** The node floor (a third of the smallest of 3 CI runs). Absent: the toggle moved nothing is DEAD. */
  readonly nodeFloor?: number;
}

export interface ProbeVerdict {
  /** node / legacy-matched on the primary metric, or null when undefined (a missing arm, or legacy read 0). */
  readonly r: number | null;
  /** `in` / `out` of the subject's band, or null when there is nothing to judge. */
  readonly band: 'in' | 'out' | null;
  readonly dead: boolean;
}

/**
 * Judges one row against its band.
 *
 * DEAD: the node delta is BELOW its floor (strictly: a delta equal to the floor is the smallest value the floor still accepts), or, with
 * no floor, exactly 0. The `zero` band never reads DEAD: a layer the plan expects to move nothing is not dead for moving nothing.
 */
export function probeVerdict(row: ProbeRow): ProbeVerdict {
  const spec = BANDS[row.band];
  const node = row.node;
  const lm = row.legacyMatched;
  const r = node === null || lm === null ? null : ratioOf(node.meanAbsChannelDelta, lm.meanAbsChannelDelta);
  const dead =
    node === null || spec.kind === 'zero'
      ? false
      : !Number.isFinite(node.meanAbsChannelDelta) || (row.nodeFloor === undefined ? !(node.meanAbsChannelDelta > 0) : node.meanAbsChannelDelta < row.nodeFloor);
  let band: 'in' | 'out' | null = null;
  if (node !== null && lm !== null) {
    if (spec.kind === 'ratio') band = r === null ? null : r >= spec.lo && r <= spec.hi ? 'in' : 'out';
    else if (spec.kind === 'zero') band = node.meanAbsChannelDelta === 0 && lm.meanAbsChannelDelta === 0 && node.changedPixels === 0 && lm.changedPixels === 0 ? 'in' : 'out';
    else band = Math.abs(node.meanAbsChannelDelta - lm.meanAbsChannelDelta) <= spec.maxDelta ? 'in' : 'out';
  }
  return { r, band, dead };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The readings and the refusals.
// ---------------------------------------------------------------------------------------------------------------------------------

/** What the driver read for one subject. A missing arm is one that did not run. */
export interface SubjectReading {
  readonly id: string;
  readonly layer: string;
  readonly band: BandName;
  /** Shown-minus-hidden, per reading arm. */
  readonly deltas: Partial<Record<ReadingArm, ArmDelta>>;
  /** Pixels that differ between two zero-time repaints of the SHOWN state, per ARM (not per reading): L, F, G. */
  readonly controlPx: Partial<Record<ProbeArm, number>>;
  /** Names of visible `ShaderMaterial` objects in the node frame (empty on a legacy arm), per node arm. */
  readonly visibleShaders: Partial<Record<'F' | 'G', string[]>>;
}

export const isZeroDelta = (d: ArmDelta | undefined): boolean => d === undefined || !(d.meanAbsChannelDelta > 0 || d.changedPixels > 0);

/**
 * A subject whose PLAIN-legacy A/B read 0 (or never ran, or is NaN) is vacuous: the toggle moved nothing, so any ratio against it would be
 * 0/0 dressed as a number. Reads the UNMATCHED arm (`L`), not `Lm`: an unported subject is hidden on `Lm` by design (Ruling P3-R5 i).
 */
export function legacyDeltaRefusals(readings: readonly SubjectReading[]): string[] {
  return readings
    .filter((r) => {
      const d = r.deltas.L;
      return d === undefined || !Number.isFinite(d.meanAbsChannelDelta) || !Number.isFinite(d.changedPixels) || isZeroDelta(d);
    })
    .map((r) => `${r.id}: the legacy A/B of \`${r.layer}\` read ${r.deltas.L === undefined ? 'nothing' : '0'} (the toggle moved nothing, so a ratio against it would be vacuous): fix the subject's framing, tick or setup`);
}

/** A node subject whose two zero-time repaints of one state differ is not a stable reading: the delta would contain the noise. */
export function repaintControlRefusals(readings: readonly SubjectReading[]): string[] {
  const out: string[] = [];
  for (const r of readings) {
    for (const arm of ['F', 'G'] as const) {
      const px = r.controlPx[arm];
      if (px !== undefined && px > 0) out.push(`${r.id} (${arm}): two zero-time repaints of the same state differ by ${px} px`);
    }
  }
  return out;
}

/** A node frame that draws a `ShaderMaterial` object is not the node chain (Review Focus 5). */
export function shaderMaterialRefusals(readings: readonly SubjectReading[]): string[] {
  const out: string[] = [];
  for (const r of readings) {
    for (const arm of ['F', 'G'] as const) {
      const names = r.visibleShaders[arm];
      if (names !== undefined && names.length > 0) out.push(`${r.id} (${arm}): ${names.length} visible ShaderMaterial object(s) in the node frame: ${[...new Set(names)].slice(0, 6).join(', ')}`);
    }
  }
  return out;
}

export interface BackendReading {
  readonly arm: ProbeArm;
  readonly backendKind: string;
  /** `webgl` / `gl` string of what draws. */
  readonly gpu: string;
}

/** A run mixing backends: an arm that is not on its own backend, or arms on different hardware classes. */
export function mixedBackendRefusals(readings: readonly BackendReading[]): string[] {
  const out: string[] = [];
  for (const b of readings) {
    if (b.backendKind !== PROBE_ARM_KIND[b.arm]) out.push(`arm ${b.arm}: backendInfo().kind is "${b.backendKind}", expected "${PROBE_ARM_KIND[b.arm]}" (a fallback is evidence about the fallback)`);
  }
  const classes = new Set(readings.map((b) => (/swiftshader/i.test(b.gpu) ? 'swiftshader' : /metal/i.test(b.gpu) ? 'metal' : b.gpu)));
  if (classes.size > 1) out.push(`the arms draw on different hardware: ${[...classes].join(' vs ')}`);
  return out;
}

export function emptySubjectRefusal(kind: string, subjects: readonly unknown[]): string | null {
  return subjects.length === 0 ? `${kind}: the subject list is empty (nothing would be read)` : null;
}

/**
 * The in-page walk that finds visible `ShaderMaterial` objects. A function, not a string, so a test can run it on a stub scene and the
 * driver can inject `String(visibleShaderObjects)` into the page. `isShaderMaterial` and not `material.type`: a `RawShaderMaterial`'s type
 * is `RawShaderMaterial`, and three sets `isShaderMaterial` on both. An object is visible when it and every ancestor is.
 */
export const visibleShaderObjects = (root: { visible?: boolean; name?: string; type?: string; material?: unknown; children?: unknown[] }): string[] => {
  const out: string[] = [];
  const walk = (o: { visible?: boolean; name?: string; type?: string; material?: unknown; children?: unknown[] }, parentVisible: boolean): void => {
    const visible = parentVisible && o.visible !== false;
    if (!visible) return;
    const m = o.material as unknown;
    if (m !== undefined && m !== null) {
      const list = Array.isArray(m) ? m : [m];
      for (const x of list) {
        const mat = x as { isShaderMaterial?: boolean; visible?: boolean } | null;
        if (mat !== null && mat.isShaderMaterial === true && mat.visible !== false) out.push(o.name !== undefined && o.name !== '' ? o.name : (o.type ?? 'object'));
      }
    }
    for (const c of o.children ?? []) walk(c as typeof o, visible);
  };
  walk(root, true);
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Moments, selection and the table.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Subjects with the same page state (map, flags, tick, camera, setup, frame steps) share one page and one setup. */
export function momentKey(s: ProbeSubject): string {
  return JSON.stringify([s.map, s.flags, s.tick, s.camera, s.setup, s.frameSteps ?? null]);
}

export function groupMoments(subjects: readonly ProbeSubject[]): ProbeSubject[][] {
  const by = new Map<string, ProbeSubject[]>();
  for (const s of subjects) {
    const k = momentKey(s);
    const g = by.get(k);
    if (g === undefined) by.set(k, [s]);
    else g.push(s);
  }
  return [...by.values()];
}

/** `--only=a,b` filter; an id that names no subject throws (a typo must not read as an empty list). */
export function selectSubjects(kind: ProbeKind, only: readonly string[]): ProbeSubject[] {
  const all = PROBE_SUBJECTS[kind];
  for (const id of only) if (!all.some((s) => s.id === id)) throw new Error(`--only=${id} names no ${kind} subject (have: ${all.map((s) => s.id).join(', ')})`);
  return only.length === 0 ? [...all] : all.filter((s) => only.includes(s.id));
}

const f4 = (n: number): string => (Number.isFinite(n) ? n.toFixed(4) : 'NaN');
export const fmtDelta = (d: ArmDelta | undefined): string => (d === undefined ? 'n/a' : `${f4(d.meanAbsChannelDelta)} (${d.changedPixels} px)`);

/** The matched-legacy cell: `n/a (unported)` when the plain arm moved and the matched one did not (the material is not ported yet). */
export function matchedCell(l: ArmDelta | undefined, lm: ArmDelta | undefined): string {
  if (lm === undefined) return 'n/a';
  if (isZeroDelta(lm) && !isZeroDelta(l)) return 'n/a (unported)';
  return fmtDelta(lm);
}

/** One node arm's cell: the delta and what it means (DEAD, pre-port, or the ratio against its band). */
export function nodeCell(id: string, row: ProbeRow): string {
  if (row.node === null) return 'n/a';
  const v = probeVerdict(row);
  const delta = fmtDelta(row.node);
  if (v.dead) return `${delta} DEAD`;
  const ratio = v.r === null ? 'r n/a' : `r ${v.r.toFixed(3)} ${v.band ?? '-'}`;
  return PORTED_PROBE_SUBJECTS.has(id) ? `${delta} ${ratio}` : `${delta} pre-port (${ratio})`;
}

export function probeTable(readings: readonly SubjectReading[]): string[] {
  const out = [
    '| subject | layer | band | L (plain legacy) | L-matched | F (node webgl2) | G (node webgpu) |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of readings) {
    const row = (arm: 'F' | 'G'): ProbeRow => ({ band: r.band, node: r.deltas[arm] ?? null, legacyMatched: r.deltas.Lm ?? null });
    out.push(`| ${r.id} | ${r.layer} | ${r.band} | ${fmtDelta(r.deltas.L)} | ${matchedCell(r.deltas.L, r.deltas.Lm)} | ${nodeCell(r.id, row('F'))} | ${nodeCell(r.id, row('G'))} |`);
  }
  return out;
}

/** Every refusal of one run, in one list. Empty means "read it" (exit 0); anything else is exit 2. */
export function allRefusals(kind: string, subjects: readonly unknown[], readings: readonly SubjectReading[], backends: readonly BackendReading[]): string[] {
  const empty = emptySubjectRefusal(kind, subjects);
  if (empty !== null) return [empty];
  return [...mixedBackendRefusals(backends), ...legacyDeltaRefusals(readings), ...repaintControlRefusals(readings), ...shaderMaterialRefusals(readings)];
}
