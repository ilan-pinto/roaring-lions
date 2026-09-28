import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATGM_LAYER_FLOORS,
  ATGM_LADDER_MS,
  ATGM_SUBJECTS,
  ATGM_WINDOW_MS,
  atgmLadder,
  atgmSheetIndex,
  FLASH_INTENSITY_SCALE,
  flipHtml,
  lockstepPlan,
  missilesFloorReasons,
} from './atgm-captures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const UNITS = path.join(ROOT, 'data/units');

function shippedUnitIds(): Set<string> {
  const ids = new Set<string>();
  for (const dir of ['kdf', 'enemy']) {
    for (const f of readdirSync(path.join(UNITS, dir))) {
      if (!f.endsWith('.json')) continue;
      const u = JSON.parse(readFileSync(path.join(UNITS, dir, f), 'utf8')) as { id: string };
      ids.add(u.id);
    }
  }
  return ids;
}

describe('the ATGM ladder', () => {
  it('is dense through the flight and sparse through the aftermath: 89 rungs over ten seconds', () => {
    expect(ATGM_LADDER_MS).toEqual(atgmLadder());
    expect(ATGM_LADDER_MS).toHaveLength(89);
    expect(ATGM_LADDER_MS[0]).toBe(0);
    expect(ATGM_LADDER_MS[60]).toBe(3000);
    expect(ATGM_LADDER_MS[61]).toBe(3250);
    expect(ATGM_LADDER_MS[ATGM_LADDER_MS.length - 1]).toBe(ATGM_WINDOW_MS);
  });

  it('never skips the flight: every 50 ms rung up to 3 s, so a 0.65 s RPG spans 13 of them', () => {
    const inFlight = ATGM_LADDER_MS.filter((t) => t > 0 && t <= 650);
    expect(inFlight).toHaveLength(13);
    for (let i = 1; i <= 60; i++) expect(ATGM_LADDER_MS[i] - ATGM_LADDER_MS[i - 1]).toBe(50);
  });
});

describe('the subjects', () => {
  it('covers each drawn variant exactly as spec § Capture protocol names it', () => {
    expect(ATGM_SUBJECTS.map((s) => [s.shooter, s.target, s.gapTiles, s.expectVariant])).toEqual([
      ['at_team', 'technical', 7, 'top_attack'],
      ['atgm_cell', 'jeep_shoded', 8, 'guided'],
      ['heli_peten', 'technical', 8, 'guided'],
      ['rpg_team', 'jeep_shoded', 4, 'unguided'],
    ]);
  });

  it('spawns only units that ship, on the open northern band, inside the map', () => {
    const ids = shippedUnitIds();
    for (const s of ATGM_SUBJECTS) {
      expect(ids.has(s.shooter), s.shooter).toBe(true);
      expect(ids.has(s.target), s.target).toBe(true);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(7);
      expect(s.x + s.gapTiles).toBeLessThan(48);
      expect(s.shooterSide).not.toBe(s.targetSide);
    }
  });
});

describe('lockstep', () => {
  it('ticks once per 50 ms of pumped time and pumps frames of at most 16 ms with an exact remainder', () => {
    expect(lockstepPlan(50, 50, 16)).toEqual({ ticks: 1, frames: [16, 16, 16, 2] });
    expect(lockstepPlan(250, 50, 16).ticks).toBe(5);
    const p = lockstepPlan(250, 50, 16);
    expect(p.frames.reduce((a, b) => a + b, 0)).toBe(250);
    expect(Math.max(...p.frames)).toBeLessThanOrEqual(16);
    expect(lockstepPlan(0, 50, 16)).toEqual({ ticks: 0, frames: [] });
  });
});

describe('the flip page', () => {
  it('plays every frame in order at its own timestamp, loops, and loads nothing from outside', () => {
    const html = flipHtml('after', [
      { file: 'at_team-0000.png', tMs: 0 },
      { file: 'at_team-0050.png', tMs: 50 },
      { file: 'at_team-3250.png', tMs: 3250 },
    ]);
    const a = html.indexOf('at_team-0000.png');
    const b = html.indexOf('at_team-0050.png');
    const c = html.indexOf('at_team-3250.png');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(html).toContain('[0,50,3250]');
    expect(html).toMatch(/loop/i);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('the sheet index', () => {
  it('names the capture conditions with every number', () => {
    const md = atgmSheetIndex('before', 'darwin-arm64 ANGLE/Metal 1400x900 dsf1', [
      { subject: 'at_team', tMs: 0, tick: 812, zoom: 2, inFlight: 1, progress: 0.25, trail: 14, flash: 2.6, file: 'at_team-0000.png' },
      { subject: 'at_team', tMs: 50, tick: 813, zoom: 2, inFlight: 0, progress: -1, trail: 0, flash: 0, file: 'at_team-0050.png' },
    ]);
    expect(md).toContain('# ATGM capture sheet -- before');
    expect(md).toContain('darwin-arm64 ANGLE/Metal 1400x900 dsf1');
    expect(md).toContain('89 rungs');
    expect(md).toContain('| at_team | 0 | 812 | 2 | 1 | 0.25 | 14 | 2.60 | `at_team-0000.png` |');
    expect(md).toContain('| at_team | 50 | 813 | 2 | 0 | - | 0 | 0.00 | `at_team-0050.png` |');
  });
});

describe('the flash reading', () => {
  it('divides by the pool\'s own FLASH_INTENSITY_SCALE, copied and pinned as text', () => {
    const src = readFileSync(path.join(ROOT, 'packages/render/src/three/flash-light.ts'), 'utf8');
    const m = /export const FLASH_INTENSITY_SCALE = (\d+(?:\.\d+)?);/.exec(src);
    if (m === null) throw new Error('FLASH_INTENSITY_SCALE not found in flash-light.ts');
    expect(FLASH_INTENSITY_SCALE).toBe(Number(m[1]));
  });
});

describe('the missiles floor', () => {
  it('is calibrated, not zero -- a zero floor passes a layer that draws nothing', () => {
    expect(ATGM_LAYER_FLOORS.missiles.minDiffPixels).toBeGreaterThan(0);
    expect(ATGM_LAYER_FLOORS.missiles.minMeanAbsChannelDelta).toBeGreaterThan(0);
    expect(ATGM_LAYER_FLOORS.missiles.measured).toMatch(/rung 600/);
  });

  it('fails a reading below either half of it, and a build without the layer', () => {
    const f = { minDiffPixels: 100, minMeanAbsChannelDelta: 0.1, measured: 'rung 600' };
    expect(missilesFloorReasons({ available: true, diffPixels: 100, meanAbsChannelDelta: 0.1 }, f)).toEqual([]);
    expect(missilesFloorReasons({ available: true, diffPixels: 99, meanAbsChannelDelta: 0.1 }, f)).toHaveLength(1);
    expect(missilesFloorReasons({ available: true, diffPixels: 100, meanAbsChannelDelta: 0.09 }, f)).toHaveLength(1);
    expect(missilesFloorReasons({ available: false, diffPixels: 500, meanAbsChannelDelta: 1 }, f)).toHaveLength(1);
  });
});
