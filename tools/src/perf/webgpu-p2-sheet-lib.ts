// GH-943 WebGPU P2 T9: the pure half of the lead's P2 sheet (`webgpu-p2-sheet.ts` drives the browser). No playwright here, so every
// decision can be driven red by a constructed input in `webgpu-p2-sheet.test.ts`. It EXTENDS the P1 sheet's lib (`webgpu-p1-sheet-lib.ts`):
// the diff panel, the synced summary, the validation-error counter and the r0 report are imported from it, not copied.
import path from 'node:path';
import { PNG } from 'pngjs';
import { bandingIndex, type Crop } from '../golden-diff/banding';
import { BANDS } from '../golden-diff/parity';
import { PARITY_ROWS, type ParityRow } from '../golden-diff/parity-bands';
import { G_BAR, type AbbaVerdictRow, type GateRow, type Verdict } from './webgpu-p1-sheet-lib';

export { countValidationErrors, diffPanel, r0Outside, syncedSummary } from './webgpu-p1-sheet-lib';
export type { GateRow, Verdict };

/** The layers P2 ported, each with the task that owns it (the plan's table). `repaint-control` is T6's zero row. */
export const P2_LAYERS: Readonly<Record<string, string>> = {
  roads: 'T3',
  'ground-albedo': 'T3',
  macro: 'T3',
  'slope-light': 'T4',
  'height-contours': 'T4',
  'selection-ring': 'T5',
  wind: 'T6',
  'repaint-control': 'T6',
  disturb: 'T7',
  wash: 'T7',
};

/** The P2 parity rows as they stand in `parity-bands.ts` (r0 and node floors are written there from CI, never from a Metal run). */
export function p2ParityRows(rows: readonly ParityRow[] = PARITY_ROWS): ParityRow[] {
  return rows.filter((r) => r.layer in P2_LAYERS && !(r.layer === 'repaint-control' && r.scenario !== 'quiet'));
}

const fmt = (v: number | null | undefined): string => (v === null || v === undefined ? 'null' : String(v));

/** One markdown line per P2 row: scenario, layer, owner task, band, r0 and node floor per key, and whether r0 sits outside the band. */
export function parityTable(rows: readonly ParityRow[]): string[] {
  const out = ['| scenario | layer | task | band | r0 wgl2 / wgpu (CI) | node floor wgl2 / wgpu (CI) | r0 vs band |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const band = BANDS[r.band];
    const inside = (v: number | null): string =>
      v === null ? 'unread' : band.kind === 'zero' ? (v === 0 ? 'in' : 'OUTSIDE') : band.kind === 'exact' ? (v <= band.maxDelta ? 'in' : 'OUTSIDE') : v >= band.lo && v <= band.hi ? 'in' : 'OUTSIDE';
    out.push(
      `| ${r.scenario} | ${r.layer} | ${P2_LAYERS[r.layer] ?? '?'} | ${r.band} | ${fmt(r.r0.wgl2)} / ${fmt(r.r0.wgpu)} | ${fmt(r.nodeFloor?.wgl2)} / ${fmt(r.nodeFloor?.wgpu)} | ${inside(r.r0.wgl2)} / ${inside(r.r0.wgpu)} |`
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The node census: only the expected entries remain, each named.
// ---------------------------------------------------------------------------------------------------------------------------

export interface CensusEntry {
  readonly kind: string;
  readonly key: string;
  readonly objects: number;
}
export interface CensusRule {
  readonly kind: RegExp;
  readonly key: RegExp;
  /** Why this entry is still on the list, and which phase takes it off. Never empty. */
  readonly reason: string;
}

/**
 * The entries P2 leaves on the node census ON PURPOSE (the plan's "Not in P2" section). An entry matching no rule is UNEXPECTED and
 * fails the census gate: a rule is added only with the phase that owns the entry, never to quiet a defect. Matching is on the kind AND
 * the key, so a ported material that came back (a `shader-material` named `rl-selection-ring`) matches nothing.
 */
export const CENSUS_RULES: readonly CensusRule[] = [
  { kind: /^partial$/, key: /^rl-ground: wet terms/, reason: 'wet ground terms (THEME_WET): a wet map draws dry on node, P4 (ruled 7 Nov)' },
  // GH-943 P3 (T7): the decal half of the wet ground (DECAL_WET, the crater water), drawn dry on node by the decal twin.
  { kind: /^partial$/, key: /^rl-decal: wet terms$/, reason: 'wet decal terms (DECAL_WET, the crater water): a wet map draws the decals dry on node, P4' },
  { kind: /^on-before-compile$/, key: /garrison-banner/, reason: 'garrison banner wind (`rl-garrison-banner`, a separate hook): P3 (units)' },
  // Added after the Metal run's census was READ and every entry traced to its object (a scene probe listed name, parent and uniforms):
  { kind: /^shader-material$/, key: /^ShaderMaterial$/, reason: 'unnamed ShaderMaterial batches: ground decal pools, HP/overlay batches, tracers, shells, smoke, flipbook and tunnel overlays (decals, VFX): P3/P4' },
  { kind: /^shader-material$/, key: /^(rl-beam|rl-flipbook-fire|rl-flipbook-smoke)$/, reason: 'the E6 beam and the flipbook fire and smoke (VFX): P3 (T11, T12)' },
  { kind: /^shader-material$/, key: /^(rl-zone-band|rl-supply-route)$/, reason: 'the zone-band and supply-route overlays (overlays): P3' },
  // GH-943 P3 (T1): the census keys a named P3 batch by its material name (`material-names.ts`), no longer as `ShaderMaterial`.
  {
    kind: /^shader-material$/,
    // T7 took `decal` off: the decal pools have a twin, so a `rl-decal` ShaderMaterial on node is a ported material that came back.
    key: /^rl-(overlay|trail|xray-(tube|collar|figure|beam)|fx-particle(-hot)?|fx-tracer|fx-mesh|smoke-screen|smoke-plume|collapse-shroud|swarm-rotors)$/,
    reason: 'the named P3 batches: the overlay batch, the trail, the tunnel x-ray and the VFX: P3 (T8-T12)',
  },
  // GH-943 P3 (T1): a hooked unit material keys by its hook segments (`censusKey`), no longer by its GLB material name.
  {
    kind: /^on-before-compile$/,
    key: /^rl-(unit-mark-3|running-gear-1|unit-rain-rim|wounded-floor|soot)(\|rl-(unit-mark-3|running-gear-1|unit-rain-rim|wounded-floor|soot))*$/,
    reason: 'unit materials carrying the team mark, running gear, rain rim, wounded floor or soot hooks (units): P3 (T3, T4)',
  },
  { kind: /^on-before-compile$/, key: /^rl-backdrop-fade$/, reason: 'the valley backdrop fade (backdrop): P3 (T10)' },
  { kind: /^on-before-compile$/, key: /^rl-silhouette-outline$/, reason: 'the occlusion outline (hidden on node by HIDE_WITHOUT_HOOK): P3' },
  { kind: /^image-release$/, key: /./, reason: 'GLB bitmap release disarmed on node (P0 behaviour, by design)' },
];

export interface CensusVerdict {
  readonly expected: readonly (CensusEntry & { reason: string })[];
  readonly unexpected: readonly CensusEntry[];
}

export function classifyCensus(hooks: readonly CensusEntry[], rules: readonly CensusRule[] = CENSUS_RULES): CensusVerdict {
  const expected: (CensusEntry & { reason: string })[] = [];
  const unexpected: CensusEntry[] = [];
  for (const h of hooks) {
    const rule = rules.find((r) => r.kind.test(h.kind) && r.key.test(h.key));
    if (rule === undefined) unexpected.push(h);
    else expected.push({ ...h, reason: rule.reason });
  }
  return { expected, unexpected };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Banding.
// ---------------------------------------------------------------------------------------------------------------------------

export type CropId = 'penumbra' | 'lit';
export type BandingCell = { readonly index: number; readonly masked: number } | { readonly refused: string };

/** bandingIndex of each named crop in a decoded frame; an empty mask is a REFUSAL carried as a value, never a 0. */
export function bandingOf(png: PNG, crops: Readonly<Record<CropId, Crop>>): Record<CropId, BandingCell> {
  const read = (c: Crop): BandingCell => {
    const r = bandingIndex(png.data, png.width, png.height, c);
    return r.kind === 'index' ? { index: r.index, masked: r.masked } : { refused: r.reason };
  };
  return { penumbra: read(crops.penumbra), lit: read(crops.lit) };
}

export const fmtBanding = (c: BandingCell | undefined): string => (c === undefined ? 'n/a' : 'refused' in c ? 'REFUSED' : `${c.index.toFixed(3)} (${c.masked})`);

/** G's shipped index must stay under this: an order of magnitude under the reported defect (G 0.636/0.679) and under the rectangular dither (0.07). */
export const G_BANDING_CEILING = 0.05;

// ---------------------------------------------------------------------------------------------------------------------------
// The gate table.
// ---------------------------------------------------------------------------------------------------------------------------

export interface P2GateInputs {
  /** Frames photographed: 3 zooms x (L, G, F) + L shipped z1 + the 4 extra framings + 2 wind pairs (4 frames) = 18. */
  readonly sheetFrames: number;
  readonly expectedFrames: number;
  readonly sheetUnsettled: number;
  readonly abba: readonly AbbaVerdictRow[];
  readonly triangles: readonly { zoom: number; L: number; G: number }[];
  readonly banding: { readonly L?: Record<CropId, BandingCell>; readonly G?: Record<CropId, BandingCell>; readonly LS?: Record<CropId, BandingCell> };
  readonly census: Readonly<Record<string, CensusVerdict>>;
  readonly wind: { readonly L: number; readonly G: number } | null;
  readonly validationErrors: number;
}

/** Triangle agreement of L-matched and G, each within 1% of L. An L of 0 is a failed reading, not an agreement. */
export function triangleDisagreements(t: P2GateInputs['triangles']): P2GateInputs['triangles'] {
  return t.filter((x) => !(x.L > 0) || Math.abs(x.G - x.L) > x.L * 0.01);
}

export function gateTableP2(g: P2GateInputs): GateRow[] {
  const rows: GateRow[] = [];
  rows.push({
    item: `sheet: ${g.expectedFrames} frames photographed`,
    verdict: g.sheetFrames === g.expectedFrames ? 'PASS' : 'FAIL',
    detail: `${g.sheetFrames} photographed; ${g.sheetUnsettled} not settled (two zero-time repaints differed)`,
  });
  for (const target of [300, 600]) {
    const r = g.abba.find((x) => x.test === 'G' && x.target === target);
    rows.push(
      r === undefined
        ? { item: `ABBA n${target}: G <= ${G_BAR} x L-matched`, verdict: 'FAIL', detail: 'no G timing exists (refused or not run)' }
        : { item: `ABBA n${target}: G <= ${G_BAR} x L-matched`, verdict: r.met ? 'PASS' : 'FAIL', detail: `x${r.ratio.toFixed(3)}${r.withinSpread ? ' (inside spread)' : ''}` }
    );
  }
  const bad = triangleDisagreements(g.triangles);
  rows.push({
    item: 'ABBA triangle agreement L-matched vs G (within 1%)',
    verdict: g.triangles.length > 0 && bad.length === 0 ? 'PASS' : 'FAIL',
    detail: g.triangles.length === 0 ? 'no triangle reading' : g.triangles.map((t) => `z${t.zoom}: L ${t.L} G ${t.G}`).join('; '),
  });
  const gb = g.banding.G;
  const worst = gb === undefined ? null : Math.max(...(['penumbra', 'lit'] as const).map((c) => ('index' in gb[c] ? (gb[c] as { index: number }).index : Number.POSITIVE_INFINITY)));
  rows.push({
    item: `bandingIndex G shipped < ${G_BANDING_CEILING} on both crops`,
    verdict: worst !== null && worst < G_BANDING_CEILING ? 'PASS' : 'FAIL',
    detail: gb === undefined ? 'no G reading' : `penumbra ${fmtBanding(gb.penumbra)}, lit ${fmtBanding(gb.lit)}`,
  });
  for (const [arm, v] of Object.entries(g.census)) {
    rows.push({
      item: `node census ${arm}: only expected entries remain`,
      verdict: v.unexpected.length === 0 ? 'PASS' : 'FAIL',
      detail: v.unexpected.length === 0 ? `${v.expected.length} expected entries, each named` : `UNEXPECTED: ${v.unexpected.map((u) => `${u.kind} ${u.key} x${u.objects}`).join('; ')}`,
    });
  }
  if (Object.keys(g.census).length === 0) rows.push({ item: 'node census: only expected entries remain', verdict: 'FAIL', detail: 'no census was read' });
  rows.push({
    item: 'wind pair: the foliage moves between ticks 1 s apart on L and G',
    verdict: g.wind !== null && g.wind.L > 0 && g.wind.G > 0 ? 'PASS' : 'FAIL',
    detail: g.wind === null ? 'no wind pair' : `changed px L ${g.wind.L}, G ${g.wind.G}`,
  });
  rows.push({ item: 'GPUValidationErrors == 0', verdict: g.validationErrors === 0 ? 'PASS' : 'FAIL', detail: `${g.validationErrors}` });
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The sheet's HTML.
// ---------------------------------------------------------------------------------------------------------------------------

export interface P2Frame {
  readonly caption: string;
  readonly file: string;
}
export interface P2Section {
  readonly title: string;
  readonly rows: readonly (readonly (P2Frame | null)[])[];
}

const base = (f: string): string => f.slice(f.lastIndexOf('/') + 1);
/** Escapes text AND attribute values: a `"` in a filename would otherwise close `src="..."`. */
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A null cell is a frame the run did not capture; it is SAID, never left blank. */
export function p2SheetHtml(title: string, sections: readonly P2Section[]): string {
  const cell = (c: P2Frame | null): string =>
    c === null ? '<div class="c"><div class="cap">not captured in this run</div></div>' : `<div class="c"><img src="${esc(base(c.file))}"><div class="cap">${esc(c.caption)}</div></div>`;
  const body = sections.map((s) => `<h2>${esc(s.title)}</h2>${s.rows.map((r) => `<div class="row">${r.map(cell).join('')}</div>`).join('')}`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#111;color:#ddd;font:13px/1.35 ui-monospace,Menlo,monospace;width:1800px}
.row{display:flex;gap:8px;margin-bottom:8px}.c{width:588px}.c img{width:588px;display:block}.cap{padding:2px 0}
h2{margin:14px 0 6px;font-size:14px}
</style><h2>${esc(title)}</h2>${body}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// `--report-only` after the output directory moved.
// ---------------------------------------------------------------------------------------------------------------------------

/** The keys of a page record that hold a PNG path the run wrote into its output directory. */
const FILE_KEYS: ReadonlySet<string> = new Set(['png', 'minimap', 'flatPng', 'file']);

/**
 * `p2-data.json` stores the ABSOLUTE path of every frame the run wrote, so a `--report-only` rerun after the directory moved (or on
 * another machine, from the zipped output) would throw ENOENT on the first one. Every such path is rebased onto `out` by its base
 * name: all of a run's files sit directly in its output directory. Pure (returns a copy), so a constructed record drives it red.
 */
export function rebaseFiles<T>(value: T, out: string): T {
  if (Array.isArray(value)) return value.map((v) => rebaseFiles(v, out)) as unknown as T;
  if (typeof value !== 'object' || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) copy[k] = typeof v === 'string' && FILE_KEYS.has(k) ? path.join(out, path.basename(v)) : rebaseFiles(v, out);
  return copy as T;
}

/**
 * Every recorded frame path (`png`, `minimap`, `flatPng`, `file`) that `exists` does not find. `--report-only` refuses on a non-empty
 * list: a deleted or never-copied PNG (a wind difference, a frame) would otherwise render as a broken image on a sheet that reports
 * success. `exists` is injected so a constructed record drives it without a disk.
 */
export function missingFiles(value: unknown, exists: (file: string) => boolean): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => missingFiles(v, exists));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => (typeof v === 'string' && FILE_KEYS.has(k) ? (exists(v) ? [] : [v]) : missingFiles(v, exists)));
}
