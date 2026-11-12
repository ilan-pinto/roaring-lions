/**
 * GH-1167 S5: the grass field's headless pieces (design 2026-11-11, sections 2.1 LOD bands, 3.2, decision 8), against literals.
 * The five-map cell census and the collapse splice against a full plan live in `packages/app/src/grass-field-cells.test.ts`.
 *
 * Falsified by (run red, then put back; in the commit message): the hysteresis dropped (`GRASS_LOD_HYSTERESIS` 0); `coarse`
 * reading 1 instead of 1.2; the matrix's sine sign flipped; `grassSpliceCells` ignoring `extra`.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITY_PRESETS } from '../../quality';
import { grassCellGrid, grassClumpMatrix, grassLodFor, grassLodScaleOf, grassSpliceCells } from './grass-field-cells';

describe('grassLodFor: bands by zoom alone, with a 0.05 hysteresis', () => {
  it('lands in the plain band on the first frame (high: LOD0 >= 1.5, LOD1 >= 0.9)', () => {
    expect([2.5, 1.5, 1.49, 1.0, 0.9, 0.89, 0.35].map((z) => grassLodFor(z, null, 1))).toEqual([0, 0, 1, 1, 1, 2, 2]);
  });
  it('holds the band until the zoom leaves it by more than 0.05, either way', () => {
    expect(grassLodFor(1.46, 0, 1)).toBe(0);
    expect(grassLodFor(1.449, 0, 1)).toBe(1);
    expect(grassLodFor(1.54, 1, 1)).toBe(1);
    expect(grassLodFor(1.551, 1, 1)).toBe(0);
    expect(grassLodFor(0.86, 1, 1)).toBe(1);
    expect(grassLodFor(0.849, 1, 1)).toBe(2);
    expect(grassLodFor(0.94, 2, 1)).toBe(2);
    expect(grassLodFor(0.951, 2, 1)).toBe(1);
  });
  it('jumps two bands in one call', () => {
    expect(grassLodFor(0.5, 0, 1)).toBe(2);
    expect(grassLodFor(2.0, 2, 1)).toBe(0);
  });
  it('medium draws both edges x 1.2 (LOD0 >= 1.8, LOD1 >= 1.08); low draws no field', () => {
    expect(grassLodScaleOf(QUALITY_PRESETS.high)).toBe(1);
    expect(grassLodScaleOf(QUALITY_PRESETS.medium)).toBe(1.2);
    expect(grassLodScaleOf(QUALITY_PRESETS.low)).toBeNull();
    expect(grassLodScaleOf(undefined)).toBe(1);
    expect([1.8, 1.79, 1.08, 1.07].map((z) => grassLodFor(z, null, 1.2))).toEqual([0, 1, 1, 2]);
  });
});

describe('grassClumpMatrix: T * Ry(yaw) * S, column-major', () => {
  it('equals three\'s Matrix4.compose for the same turn and scale', () => {
    const out = new Float32Array(32);
    grassClumpMatrix(12.25, 0.75, 30.5, 0.3, 0.9, out, 16);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(12.25, 0.75, 30.5),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3 * Math.PI * 2),
      new THREE.Vector3(0.9, 0.9, 0.9)
    );
    for (let i = 0; i < 16; i++) expect(out[16 + i]).toBeCloseTo(m.elements[i] as number, 6);
    expect([...out.slice(0, 16)].every((v) => v === 0)).toBe(true);
  });
});

describe('grassSpliceCells: the cells the terrain splice touched, grown by one tile', () => {
  it('a 48x48 map has 36 cells', () => {
    expect(grassCellGrid(48, 48)).toEqual({ cellsX: 6, cellsY: 6 });
    expect(grassCellGrid(50, 9)).toEqual({ cellsX: 7, cellsY: 2 });
  });
  it('a dirty tile inside a cell touches that cell; one on its edge touches the neighbour too', () => {
    const dirty = new Uint8Array(48 * 48);
    dirty[3 * 48 + 3] = 1;
    expect(grassSpliceCells(dirty, 48, 48)).toEqual([0]);
    dirty.fill(0);
    dirty[3 * 48 + 7] = 1; // x 7: one tile from cell 1
    expect(grassSpliceCells(dirty, 48, 48)).toEqual([0, 1]);
    dirty.fill(0);
    dirty[8 * 48 + 8] = 1; // cell 7's corner: cells 0, 1, 6, 7
    expect(grassSpliceCells(dirty, 48, 48)).toEqual([0, 1, 6, 7]);
    expect(grassSpliceCells(dirty, 48, 48, 0)).toEqual([7]);
    expect(grassSpliceCells(new Uint8Array(48 * 48), 48, 48)).toEqual([]);
  });
});
