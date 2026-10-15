/**
 * A `^` tile is ROCK by its symbol, not by the blocked mask -- in all three
 * places that decide what a tile looks like: the control map's surface
 * (`tileSurface`), the vertex tone (`groundTone`) and the open-ground grain
 * (`buildScatter`).
 *
 * Why it matters: the draw mask may stop terracing a ridge tile (a tell's
 * crown drawn as a smooth summit), and that tile is still bedrock. Before
 * this, an unterraced `^` tile fell through every one of the three to OPEN
 * ground and drew as sand with sand grain on it.
 *
 * It changes nothing today: on every shipped map a ridge tile is blocked in
 * the sim and carries no structure, so the draw mask always terraces it --
 * `packages/app/src/rock-keying-precondition.test.ts` pins that against the
 * real maps.
 *
 * Every case below compares an UNBLOCKED ridge tile against the same tile
 * BLOCKED: the blocked answer is today's, unchanged, and the unblocked one
 * must now equal it.
 */
import { describe, it, expect } from 'vitest';
import { tileSurface } from './control-map';
import { groundTone, quantisePalette } from './tones';
import { buildScatterTiled } from './scatter';
import { DECOR_RIDGE } from './shared';
import type { TerrainInput } from './types';
import type { TerrainTones } from '../../api';

const BACKGROUND = '#14150F';
const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'], blocked: '#3A3C33', underBuilding: '#23241F',
  road: '#E6D8BE', rut: '#4E5433', rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433', leafLit: '#6E7449',
  bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449', crownRatio: 0.52, scatter: 'stone',
  groveFamily: 'desert_tree', haze: '#E0B87A',
} as TerrainTones;

const W = 5;
const H = 5;
const CENTRE = 2 * W + 2;

/** A flat 5x5 of open ground with one `^` tile at the centre, blocked or not. */
function ridgeAtCentre(blocked: boolean): TerrainInput {
  const decor = new Uint8Array(W * H);
  decor[CENTRE] = DECOR_RIDGE;
  const mask = new Uint8Array(W * H);
  if (blocked) mask[CENTRE] = 1;
  return { width: W, height: H, decor, elevation: null, blocked: mask, cover: new Uint8Array(W * H) };
}

describe('a ^ tile is rock by its symbol, not by the mask', () => {
  it('tileSurface: an unterraced ridge tile is rock, exactly as a terraced one is', () => {
    expect(tileSurface(ridgeAtCentre(true), 2, 2)).toEqual({ kind: 'rock', strength: 1 });
    expect(tileSurface(ridgeAtCentre(false), 2, 2)).toEqual({ kind: 'rock', strength: 1 });
  });

  it('tileSurface: a blocked tile that is NOT a ridge is still a pad', () => {
    const input = ridgeAtCentre(true);
    (input.decor as Uint8Array)[CENTRE] = 0;
    expect(tileSurface(input, 2, 2)).toEqual({ kind: 'pad', strength: 0 });
  });

  it('groundTone: an unterraced ridge tile takes the ridge tone, not the open wash', () => {
    const palette = quantisePalette(TONES);
    const terraced = groundTone(ridgeAtCentre(true), TONES, CENTRE, palette, BACKGROUND);
    const open = groundTone(ridgeAtCentre(true), TONES, 0, palette, BACKGROUND);
    expect(terraced).not.toBe(open); // the two tones are distinguishable at all
    expect(groundTone(ridgeAtCentre(false), TONES, CENTRE, palette, BACKGROUND)).toBe(terraced);
  });

  it('buildScatter: an unterraced ridge tile draws no open-ground grain, as a terraced one draws none', () => {
    const marks = (blocked: boolean): number => {
      const tiled = buildScatterTiled(ridgeAtCentre(blocked), TONES, BACKGROUND);
      return tiled.vertexStart[CENTRE + 1]! - tiled.vertexStart[CENTRE]!;
    };
    expect(marks(true)).toBe(0);
    expect(marks(false)).toBe(0);
    // Not vacuous: the same tile as plain open ground does get grain.
    const open = ridgeAtCentre(false);
    (open.decor as Uint8Array)[CENTRE] = 0;
    const tiled = buildScatterTiled(open, TONES, BACKGROUND);
    expect(tiled.vertexStart[CENTRE + 1]! - tiled.vertexStart[CENTRE]!).toBeGreaterThan(0);
  });
});
