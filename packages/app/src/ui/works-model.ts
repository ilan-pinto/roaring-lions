// Field works (GH-277), Task 10: the placement preview, as pure data.
//
// No DOM and no three here. `main.ts` (Task 11) reads the cursor tile, asks the
// runtime `constructReason`, and hands the answer to `worksPreview`, which says
// what the renderer draws: a gridded flat footprint pad (valid or not), the
// aura rings, and the cursor tooltip's catalogue key. Treatment B (spec §6):
// the pad is an outline and a grid, the rings are dashed or dotted with NO
// fill, so neither type carries a fill field and a test holds it.

import type { StructureType, WorksRefusal } from '@lions/sim';
import { fx } from '@lions/sim';
import type { AuraRingView, PlacementPreview } from '@lions/render';

/** What a preview needs of a structure type, in tiles (not Q16.16). */
export interface WorksShape {
  fw: number;
  fh: number;
  area: readonly { radius: number }[];
  sensor: { sight: number; tunnelRadius: number } | null;
}

/**
 * The parsed sim type in tiles. Radii are stored squared, so they are rooted
 * here, once, at the app's float boundary; the integers authored in
 * `data/structures.json` (4, 10, 10) round-trip exactly. A type with no
 * `buildable` block has no footprint and reads 1x1.
 */
export function worksShapeOf(type: StructureType): WorksShape {
  const root = (sq: number): number => Math.round(Math.sqrt(fx.toNumber(sq)) * 1000) / 1000;
  const aura = type.aura;
  return {
    fw: type.buildable?.fw ?? 1,
    fh: type.buildable?.fh ?? 1,
    area: aura === null ? [] : aura.area.map((a) => ({ radius: root(a.radiusSq) })),
    sensor: aura?.sensor == null ? null : { sight: fx.toNumber(aura.sensor.sight), tunnelRadius: root(aura.sensor.tunnelRadiusSq) },
  };
}

export interface WorksPreview {
  pad: PlacementPreview;
  rings: AuraRingView[];
  /** `works.refuse.<code>` for the cursor tooltip, or null when the pad is valid. */
  tooltipKey: string | null;
}

/** `works.refuse.<code>`: every refusal the runtime can return has a line. */
export function refusalKey(r: WorksRefusal): string {
  return `works.refuse.${r}`;
}

/**
 * The preview for a works type at tile (`tx`, `ty`), its top-left tile. Rings
 * are centred on the footprint. Equal area radii draw once (the workshop's
 * repair and accuracy areas share one circle). The intel centre draws its sight
 * ring dashed and its tunnel ring dotted, both at their authored radius; the
 * renderer sets the dotted one a few screen pixels outside where they coincide.
 */
export function worksPreview(type: WorksShape, tx: number, ty: number, reason: WorksRefusal | null): WorksPreview {
  const cx = tx + type.fw / 2;
  const cy = ty + type.fh / 2;
  const rings: AuraRingView[] = [];
  const seen = new Set<number>();
  for (const a of type.area) {
    if (a.radius <= 0 || seen.has(a.radius)) continue;
    seen.add(a.radius);
    rings.push({ cx, cy, radius: a.radius, style: 'dashed' });
  }
  if (type.sensor !== null) {
    if (type.sensor.sight > 0 && !seen.has(type.sensor.sight)) rings.push({ cx, cy, radius: type.sensor.sight, style: 'dashed' });
    if (type.sensor.tunnelRadius > 0) rings.push({ cx, cy, radius: type.sensor.tunnelRadius, style: 'dotted' });
  }
  return {
    pad: { x: tx, y: ty, w: type.fw, h: type.fh, valid: reason === null },
    rings,
    tooltipKey: reason === null ? null : refusalKey(reason),
  };
}
