// The sandbox's opt-in halves: a protected zone, and a tunnel route.
//
// Both exist to make a subsystem reachable without a mission, so the cases
// worth pinning are the ones about REACHABILITY: a zone that lands off the
// map, or a route whose ends nobody can walk to, look fine in a diff and are
// useless in the browser.
import { describe, expect, it } from 'vitest';
import { maps } from '@lions/data';
import { sandboxAnchors } from './sandbox-anchors';
import { sandboxFlaggedZones, sandboxTunnelRoute } from './sandbox-extras';

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
