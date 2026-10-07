// What the briefing draws on the ground (GH-417, Field order): the player's
// start, the ground each objective is about, where civilians are taken to, and
// the ground the ROE protects. Pure: a list of marks in TILE units, read off
// data the mission and its map already declare.
//
// Deliberately NOT drawn: any hostile position (an HVT's tag, a garrison, a
// watch post) and any wave's origin. A recon mission is about finding exactly
// those, and a wave is often an authored surprise; a briefing that pinned them
// would hand out the intel the mission exists to earn (`intel.marked_positions`
// is the one sanctioned way to pre-reveal anything, and it is a reward). Only
// ground the briefing's own objectives and ROE already name is marked.

import { objectiveClock, type GlanceObjective } from './briefing-glance';

export type GroundMark =
  | { kind: 'start'; x: number; y: number }
  /** One zone, with every objective that targets it. `numbers` are the
   *  objectives' 1-based places in the briefing's own list. */
  | { kind: 'objective'; zone: string; rect: Rect; numbers: number[]; label: string; clock: string | null; primary: boolean }
  | { kind: 'refuge'; zone: string; rect: Rect; label: string }
  | { kind: 'nofire'; zone: string; rect: Rect; label: string | null };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroundMarkInputs {
  playerStart?: readonly number[];
  zones: Readonly<Record<string, readonly number[]>>;
  /** In the order the briefing lists them (primaries first, stable). */
  objectives: readonly (GlanceObjective & { target?: string })[];
  flaggedZones?: readonly string[];
  zoneName?: (zoneId: string) => string | null;
}

const rectOf = (z: readonly number[] | undefined): Rect | null =>
  z !== undefined && z.length >= 4 ? { x: z[0], y: z[1], w: z[2], h: z[3] } : null;

export function groundMarks(m: GroundMarkInputs): GroundMark[] {
  const marks: GroundMark[] = [];
  const byZone = new Map<string, Extract<GroundMark, { kind: 'objective' }>>();
  const refuges = new Set<string>();
  m.objectives.forEach((o, i) => {
    if (o.target === undefined) return;
    const rect = rectOf(m.zones[o.target]);
    if (rect === null) return; // a tag, not ground: never pinned (see header)
    if (o.type === 'evacuate_before') {
      if (!refuges.has(o.target)) {
        refuges.add(o.target);
        marks.push({ kind: 'refuge', zone: o.target, rect, label: o.text ?? '' });
      }
      return;
    }
    const at = byZone.get(o.target);
    if (at) {
      at.numbers.push(i + 1);
      at.primary ||= o.primary;
      return;
    }
    const mark = { kind: 'objective' as const, zone: o.target, rect, numbers: [i + 1], label: o.text ?? '', clock: objectiveClock(o), primary: o.primary };
    byZone.set(o.target, mark);
    marks.push(mark);
  });
  for (const z of m.flaggedZones ?? []) {
    const rect = rectOf(m.zones[z]);
    if (rect !== null) marks.push({ kind: 'nofire', zone: z, rect, label: m.zoneName?.(z) ?? null });
  }
  if (m.playerStart && m.playerStart.length >= 2) marks.push({ kind: 'start', x: m.playerStart[0], y: m.playerStart[1] });
  return marks;
}
