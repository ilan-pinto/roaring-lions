// The sandbox's opt-in halves: a protected zone, and a tunnel route.
//
// Both exist to make a subsystem reachable without a mission, so the cases
// worth pinning are the ones about REACHABILITY: a zone that lands off the
// map, or a route whose ends nobody can walk to, look fine in a diff and are
// useless in the browser.
import { describe, expect, it } from 'vitest';
import { maps } from '@lions/data';
import { sandboxAnchors } from './sandbox-anchors';
import {
  sandboxDitchRows,
  sandboxFlaggedZones,
  sandboxRefuge,
  sandboxTunnelRoute,
} from './sandbox-extras';

const ANCHORS = { friendly: [4, 23] as const, hostile: [31, 22] as const };

describe('sandboxFlaggedZones', () => {
  it('prefers a zone the map already declares as protected', () => {
    const z = sandboxFlaggedZones(
      { width: 48, height: 48, zones: { town: [0, 0, 5, 5], clinic: [37, 2, 3, 3] } },
      ANCHORS
    );
    expect(z).toEqual([[37, 2, 3, 3]]);
  });

  it('takes every protected zone, not just the first', () => {
    const z = sandboxFlaggedZones(
      { width: 48, height: 48, zones: { mosque_block: [10, 10, 4, 4], refuge: [20, 20, 3, 3] } },
      ANCHORS
    );
    expect(z).toHaveLength(2);
  });

  it('synthesises one midway between the anchors when the map declares none', () => {
    // Tel Marum's zones are valley_floor, pass and the two overwatches —
    // none protected — and it is the only map with relief, so this is what
    // makes the X reachable on the map that most needs looking at.
    const z = sandboxFlaggedZones({ width: 48, height: 48, zones: { pass: [22, 12, 5, 6] } }, ANCHORS);
    expect(z).toHaveLength(1);
    const [x, y, w, h] = z[0];
    expect(x).toBeGreaterThan(10);
    expect(x).toBeLessThan(25);
    expect(w).toBe(4);
    expect(h).toBe(4);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it('keeps a synthesised zone inside the map rather than hanging over the edge', () => {
    // zoneContains is exclusive at the far edge, so an overhanging rectangle
    // silently covers less ground than it claims.
    const z = sandboxFlaggedZones({ width: 8, height: 8 }, { friendly: [7, 7], hostile: [7, 7] });
    const [x, y, w, h] = z[0];
    expect(x + w).toBeLessThanOrEqual(8);
    expect(y + h).toBeLessThanOrEqual(8);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it('ignores a malformed zone rather than emitting a broken rectangle', () => {
    const z = sandboxFlaggedZones({ width: 48, height: 48, zones: { clinic: [1, 2] } }, ANCHORS);
    expect(z[0]).toHaveLength(4);
  });
});

describe('sandboxTunnelRoute', () => {
  it('runs from the hostile side toward the friendly one', () => {
    const r = sandboxTunnelRoute({ width: 48, height: 48 }, ANCHORS);
    const [start, end] = r.points;
    expect(start).toEqual([31, 22]);
    // Toward the friendly anchor, not past it and not away from it.
    expect(end[0]).toBeLessThan(start[0]);
    expect(end[0]).toBeGreaterThan(ANCHORS.friendly[0]);
  });

  it('is pre-dug, because a sandbox is for looking at a finished thing', () => {
    expect(sandboxTunnelRoute({ width: 48, height: 48 }, ANCHORS).pre_dug).toBe(true);
  });

  it('keeps both ends on the map', () => {
    for (const a of [
      { friendly: [0, 0] as const, hostile: [47, 47] as const },
      { friendly: [47, 47] as const, hostile: [0, 0] as const },
    ]) {
      const r = sandboxTunnelRoute({ width: 48, height: 48 }, a);
      for (const [x, y] of r.points) {
        expect(`${x},${y}`).toBe(`${Math.min(Math.max(x, 0), 47)},${Math.min(Math.max(y, 0), 47)}`);
      }
    }
  });
});

describe('against the maps that actually ship', () => {
  const shipped = Object.entries(maps) as [string, Parameters<typeof sandboxFlaggedZones>[0] & Parameters<typeof sandboxAnchors>[0]][];

  it('gives every map at least one flagged zone, inside its bounds', () => {
    for (const [id, m] of shipped) {
      const zones = sandboxFlaggedZones(m, sandboxAnchors(m));
      expect(`${id}:${zones.length > 0}`).toBe(`${id}:true`);
      for (const [x, y, w, h] of zones) {
        const inside = x >= 0 && y >= 0 && x + w <= m.width && y + h <= m.height;
        expect(`${id}:${inside}`).toBe(`${id}:true`);
      }
    }
  });

  it('gives Tel Marum a synthesised zone, since it declares no protected one', () => {
    const zones = sandboxFlaggedZones(maps.tel_marum, sandboxAnchors(maps.tel_marum));
    expect(zones).toHaveLength(1);
    expect(zones[0][2]).toBe(4);
  });

  it('uses the clinic beit_sahwan_outskirts already declares', () => {
    const zones = sandboxFlaggedZones(
      maps.beit_sahwan_outskirts,
      sandboxAnchors(maps.beit_sahwan_outskirts)
    );
    expect(zones.length).toBeGreaterThan(0);
    expect(zones[0][2]).not.toBe(4);
  });

  it('uses the clinic Qarn Hadid declares, so `&roe` needs no synthesised box', () => {
    // The relief map declares one on purpose: a 4x4 synthesised at the
    // midpoint of the anchor axis would land in the saddle notch, which is
    // the one piece of ground the map is about crossing.
    const zones = sandboxFlaggedZones(maps.qarn_hadid, sandboxAnchors(maps.qarn_hadid));
    expect(zones).toEqual([[42, 6, 5, 5]]);
  });

  it('walks Qarn Hadid’s civilians to its own refuge, not to the fallback', () => {
    // Tel Marum has no `civ_refuge` and falls back to the friendly anchor.
    // This map declares one, so the crowd is shepherded to ground an author
    // chose rather than onto the start line.
    const r = sandboxRefuge(maps.qarn_hadid, sandboxAnchors(maps.qarn_hadid));
    expect(r.at).toEqual([10, 43]);
    expect(r.at).not.toEqual([...sandboxAnchors(maps.qarn_hadid).friendly]);
    // And the arrival box is open ground on all sixteen tiles: a civilian
    // that walks into a wall inside its own refuge never gets counted.
    const [zx, zy, zw, zh] = r.zone;
    for (let y = zy; y < zy + zh; y++) {
      for (let x = zx; x < zx + zw; x++) {
        expect(`${x},${y}:${maps.qarn_hadid.rows[y]?.[x]}`).toBe(`${x},${y}:.`);
      }
    }
  });

  it('cuts `&ditch` across Qarn Hadid in one run, from the west edge to the scree', () => {
    // The dev flag on the map that most needs it. The line lands on row 26 --
    // the bench at the foot of the scarp, which is deliberately open ground
    // for exactly this reason -- and stops where the boulder field starts,
    // because `b` is not overwritable. The single gap at x=30 is the road,
    // which is also not overwritable, and reads as a crossing.
    const m = maps.qarn_hadid;
    const rows = sandboxDitchRows(m, sandboxAnchors(m));
    const row = rows[26] ?? '';
    expect(row.slice(0, 30)).toBe('d'.repeat(30));
    expect(row[30]).toBe('r');
    expect(row.slice(31, 34)).toBe('ddd');
    expect(row.slice(34)).toBe('b'.repeat(14));
    // Nothing else on the map moved.
    expect(rows.filter((r, y) => y !== 26 && r !== m.rows[y])).toEqual([]);
  });

  it('routes a tunnel inside every shipped map', () => {
    for (const [id, m] of shipped) {
      const r = sandboxTunnelRoute(m, sandboxAnchors(m));
      for (const [x, y] of r.points) {
        const inside = x >= 0 && y >= 0 && x < m.width && y < m.height;
        expect(`${id}:${inside}`).toBe(`${id}:true`);
      }
    }
  });
});

describe('sandboxDitchRows', () => {
  const open = (w: number, h: number): string[] =>
    Array.from({ length: h }, () => '.'.repeat(w));

  it('cuts the ditch ACROSS the axis between the two forces', () => {
    // A ditch nobody has to path around proves nothing about the mask, which
    // is the entire reason this flag exists. Anchors 4 apart in x and 0 in y,
    // so the obstacle between them runs north-south down a single column.
    const rows = sandboxDitchRows(
      { width: 9, height: 5, rows: open(9, 5) },
      { friendly: [1, 2], hostile: [7, 2] }
    );
    expect(rows.every((r) => r[4] === 'd')).toBe(true);
    // And it is one column, not a smear: every other tile is untouched.
    expect(rows.every((r) => r.replace(/d/g, '.') === '.'.repeat(9))).toBe(true);
  });

  it('turns the ditch the other way when the forces are apart in y', () => {
    const rows = sandboxDitchRows(
      { width: 9, height: 9, rows: open(9, 9) },
      { friendly: [4, 1], hostile: [4, 7] }
    );
    expect(rows[4]).toBe('d'.repeat(9));
    expect(rows[3]).toBe('.'.repeat(9));
  });

  it('never overwrites a ridge, a boulder or a building', () => {
    // A dev flag that quietly deleted half a building would change the map
    // under the very check it exists to serve.
    // Anchors 0 and 2 apart in x put the line on column 1; row 1 holds a
    // building there, and rows 0/2/3 hold plain ground.
    const rows = ['....', '.#^b', '....', '....'];
    const out = sandboxDitchRows(
      { width: 4, height: 4, rows },
      { friendly: [0, 1], hostile: [2, 1] }
    );
    expect(out[1]).toBe('.#^b');
    expect(out[0]).toBe('.d..');
    expect(out[2]).toBe('.d..');
    expect(out[3]).toBe('.d..');
  });

  it('does overwrite plain ground and cover levels', () => {
    const out = sandboxDitchRows(
      { width: 3, height: 3, rows: ['.1.', '.2.', '.3.'] },
      { friendly: [0, 1], hostile: [2, 1] }
    );
    expect(out).toEqual(['.d.', '.d.', '.d.']);
  });

  it('leaves the source rows alone', () => {
    // main.ts spreads the result into a fresh MapJson; mutating the imported
    // map JSON in place would leak a dev flag into every later parse of it,
    // including a mission's.
    const rows = open(5, 3);
    const before = [...rows];
    sandboxDitchRows({ width: 5, height: 3, rows }, { friendly: [0, 1], hostile: [4, 1] });
    expect(rows).toEqual(before);
  });
});

describe('sandboxRefuge', () => {
  it("prefers the map's own refuge marker, which is what a mission names", () => {
    const r = sandboxRefuge(
      { width: 48, height: 48, markers: { kdf_assembly: [4, 23], civ_refuge: [22, 45] } },
      ANCHORS
    );
    expect(r.at).toEqual([22, 45]);
  });

  it('falls back to the friendly anchor on a map that declares none', () => {
    // Tel Marum. The player's own start line is safe by construction and open
    // by construction -- the force spawns on it.
    const r = sandboxRefuge(
      { width: 48, height: 48, markers: { start_line: [24, 44], pass: [24, 12] } },
      { friendly: [24, 44], hostile: [24, 12] }
    );
    expect(r.at).toEqual([24, 44]);
  });

  it('puts the refuge point INSIDE its own arrival zone, on every shipped map', () => {
    // The one property that makes the flag work rather than hang.
    // `CivilianFlight.step` stops re-ordering a civilian standing on the
    // refuge, so a point outside its own zone is a crowd that walks there,
    // stops, and is never counted -- no error, nothing on screen, forever.
    for (const map of Object.values(maps)) {
      const a = sandboxAnchors(map);
      const { at, zone } = sandboxRefuge(map, a);
      expect(
        at[0] >= zone[0] &&
          at[0] < zone[0] + zone[2] &&
          at[1] >= zone[1] &&
          at[1] < zone[1] + zone[3],
        `${map.id}: refuge ${at.join(',')} outside zone ${zone.join(',')}`
      ).toBe(true);
    }
  });

  it('keeps the zone on the map when the refuge sits in a corner', () => {
    const r = sandboxRefuge({ width: 10, height: 10, markers: { refuge: [9, 9] } }, ANCHORS);
    expect(r.zone).toEqual([6, 6, 4, 4]);
    const r0 = sandboxRefuge({ width: 10, height: 10, markers: { refuge: [0, 0] } }, ANCHORS);
    expect(r0.zone).toEqual([0, 0, 4, 4]);
  });
});
