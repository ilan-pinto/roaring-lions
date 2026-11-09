/**
 * L2 (GH-943): the `low` quality preset builds no grade. Spec section 3: "`low` gets the grade only after a GPU-timer read",
 * and that read is still owed. GL-free, over the `WebGLRenderer` stand-in the other `ThreeRenderer*.test.ts` files use,
 * with a REAL `OutputPass` + vignette fold + `OutputGrade` injected where `init()` would put them.
 */
import { describe, it, expect, vi } from 'vitest';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';
import { OutputGrade } from './output-grade';
import { OutputVignette } from './vignette-pass';
import type { GradeJson } from './grade-maths';
import dusk from '../../../../data/grades/dusk.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function make(quality: 'low' | 'medium' | 'high'): { r: ThreeRenderer; grade: OutputGrade } {
  const opts: RendererOptions = {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    timeOfDay: 'dusk',
    quality: QUALITY_PRESETS[quality],
  };
  const r = new ThreeRenderer(new Sim({ seed: 1, width: 4, height: 4, capacity: 1 }), opts);
  const pass = new OutputPass();
  new OutputVignette(pass);
  const grade = new OutputGrade(pass);
  (r as unknown as { gradePass: OutputGrade }).gradePass = grade;
  return { r, grade };
}

describe('the grade per quality preset', () => {
  it('the preset table: low off, medium and high on', () => {
    expect(QUALITY_PRESETS.low.grade).toBe(false);
    expect(QUALITY_PRESETS.medium.grade).toBe(true);
    expect(QUALITY_PRESETS.high.grade).toBe(true);
  });

  it('`low` builds no grade: setGrade with the dusk grade compiles nothing and the frame is the identity', () => {
    const { r, grade } = make('low');
    expect(r.setGrade(dusk as GradeJson, 1)).toBe(false);
    expect(r.gradeActive).toBe(false);
    expect(grade.active).toBe(false);
    r.dispose();
  });

  it('`medium` and `high` compile the lookup in', () => {
    for (const q of ['medium', 'high'] as const) {
      const { r, grade } = make(q);
      expect(r.setGrade(dusk as GradeJson, 1), q).toBe(true);
      expect(grade.active, q).toBe(true);
      r.dispose();
    }
  });
});
