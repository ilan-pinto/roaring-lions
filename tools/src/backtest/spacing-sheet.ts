// The layout sheet's exporter (GH-1360, slice S0). Report-only: it writes JSON that `tools/spacing_sheet.py` draws.
// Spec section 9: "S0 commits the exporter so the picture can be regenerated after every slice".
//
//   pnpm spacing:sheet -- --out=sheet.json [--only=<substring>] [--layout=layout.json] [--png=sheet.png]
//
// For every start the census reads (the shipped missions, the offered versus cells, the free-play task force on each
// map) it exports the terrain, each body (class, side, capsule or circle, facing) and which bodies overlap. With
// `--layout` it also exports a second arm: the same bodies at the positions and facings a layout file gives, so the
// sheet reads "today | layout". A layout file is JSON,
//
//   { "<start name>": { "front": "E", "bodies": [ { "id": 7, "x": 24.5, "y": 20.5, "facing_deg": 0 } ] } }
//
// where `id` is the entity id the start spawned it as and a body the file does not name stays where it is. `front` is
// drawn as an arrow and has no other effect. S3a's layout function writes this file; until it exists the sheet shows
// today's starts alone.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TURN, eachStart, entriesOf, overlaps, type Entry, type Start } from './spacing-census';

export interface SheetBody {
  id: number;
  unit: string;
  cls: string;
  side: number;
  kind: 'foot' | 'vehicle';
  x: number;
  y: number;
  /** Turns, 0 east, a quarter turn south (y down). */
  facing: number;
  halfLen: number;
  halfWid: number;
  centre: number;
  /** Overlaps a same-side body by more than the census's threshold. */
  overlap: boolean;
  /** On a tile closed to its own mask. */
  onBlocked: boolean;
  /** Queued for a garrison at start (so standing on a building tile is the job). */
  garrison: boolean;
}

export interface SheetArm {
  bodies: SheetBody[];
  overlapPairs: number;
  front?: string;
}

export interface SheetStart {
  name: string;
  group: string;
  width: number;
  height: number;
  /** One string per row: `#` blocked, `b` boulder, `1`-`3` cover, `.` open. */
  rows: string[];
  today: SheetArm;
  layout?: SheetArm;
}

export interface LayoutFile {
  [start: string]: { front?: string; bodies: { id: number; x: number; y: number; facing_deg?: number }[] };
}

const bodyOf = (e: Entry, overlap: boolean, garrison: boolean): SheetBody => ({
  id: e.id,
  unit: e.unit,
  cls: e.cls,
  side: e.side,
  kind: e.kind,
  x: e.body.x,
  y: e.body.y,
  facing: e.body.facing / TURN,
  halfLen: e.body.halfLen,
  halfWid: e.body.halfWid,
  centre: e.body.centre,
  overlap,
  onBlocked: e.onBlocked,
  garrison,
});

/** Mark each entry's overlap flag and wrap the arm. */
function armOf(es: readonly Entry[], garrisonIds: ReadonlySet<number>, front?: string): SheetArm {
  const os = overlaps(es);
  const flagged = new Set<number>();
  for (const o of os) {
    flagged.add(o.a);
    flagged.add(o.b);
  }
  return { bodies: es.map((e, k) => bodyOf(e, flagged.has(k), garrisonIds.has(e.id))), overlapPairs: os.length, ...(front === undefined ? {} : { front }) };
}

export function sheetOf(st: Start, layout?: LayoutFile[string]): SheetStart {
  const sim = st.sim;
  const es = entriesOf(sim);
  const rows: string[] = [];
  for (let y = 0; y < sim.height; y++) {
    let row = '';
    for (let x = 0; x < sim.width; x++) {
      const i = y * sim.width + x;
      row += sim.blocked[i] !== 0 ? '#' : sim.boulder[i] !== 0 ? 'b' : sim.cover[i] > 0 ? String(Math.min(sim.cover[i], 3)) : '.';
    }
    rows.push(row);
  }
  const out: SheetStart = { name: st.name, group: st.group, width: sim.width, height: sim.height, rows, today: armOf(es, st.garrisonIds) };
  if (layout !== undefined) {
    const moved = new Map(layout.bodies.map((b) => [b.id, b] as const));
    const placed: Entry[] = es.map((e) => {
      const m = moved.get(e.id);
      if (m === undefined) return e;
      const tx = Math.floor(m.x);
      const ty = Math.floor(m.y);
      const mask = sim.unitTypes[sim.state.typeIdx[e.id]].wheeled ? sim.blockedVehicle : sim.blocked;
      const facing = Math.round((((m.facing_deg ?? (e.body.facing / TURN) * 360) % 360) + 360) % 360 / 360 * TURN) & (TURN - 1);
      return { ...e, tx, ty, onBlocked: tx < 0 || ty < 0 || tx >= sim.width || ty >= sim.height || mask[ty * sim.width + tx] !== 0, body: { ...e.body, x: m.x, y: m.y, facing } };
    });
    out.layout = armOf(placed, st.garrisonIds, layout.front);
  }
  return out;
}

/** Bodies on blocked ground that nothing ordered into a building: what the layout must not do. */
export const strayOnBlocked = (arm: SheetArm): number => arm.bodies.filter((b) => b.onBlocked && !b.garrison).length;

function main(): void {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const out = val('out');
  if (out === undefined) throw new Error('usage: spacing-sheet --out=<sheet.json> [--only=<substring>] [--layout=<layout.json>] [--png=<sheet.png>]');
  const only = val('only');
  const layoutPath = val('layout');
  const layouts: LayoutFile = layoutPath === undefined ? {} : (JSON.parse(readFileSync(layoutPath, 'utf8')) as LayoutFile);
  const sheets: SheetStart[] = [];
  eachStart((st) => {
    if (only !== undefined && !st.name.includes(only)) return;
    sheets.push(sheetOf(st, layouts[st.name]));
  });
  if (sheets.length === 0) throw new Error(`no start matches --only=${only}`);
  writeFileSync(out, JSON.stringify(sheets));
  console.log(`wrote ${sheets.length} starts to ${out}`);
  const png = val('png');
  if (png !== undefined) {
    const py = resolve(dirname(fileURLToPath(import.meta.url)), '../../spacing_sheet.py');
    execFileSync('python3', [py, out, png], { stdio: 'inherit' });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
