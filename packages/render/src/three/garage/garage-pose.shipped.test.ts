/**
 * The store stands its teams up (GH-921): every shipped infantry GLB, posed
 * exactly as the garage poses it (`poseRigged` from `showroomClip(id)`), must
 * show NO figure lying down, and a figure that stands must stand.
 *
 * Measured, not asserted of a table: the height of each shown figure's
 * visible points, so a rig change that puts a prone build back under the
 * chosen clip fails here whatever `SHOWROOM_CLIP` says.
 *
 * Falsified: deleting the `sniper_team` entry from `SHOWROOM_CLIP` makes the
 * sniper's pair read 0.72 m (prone, `idle`) and the first test goes red.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseGlbHeadless } from '../units/headless-gltf';
import { SHOWROOM_CLIP, bonesOf, livingFigureRoots, poseRigged, showroomClip, visiblePoints } from './garage-pose';

const DIR = new URL('../../../../../art/meshes/', import.meta.url);

/** Not store cards: the casualty rigs and the robot dog (four legs). */
const NOT_A_STANDING_TEAM = /^(wounded_|ugv_)/;
/** A bone that is gear, not a figure. */
const GEAR = /^(prop|ground)$/;

/** A figure at least this tall (metres, visible points) is standing. The
 *  shortest standing figure measured is 1.45 m (a charge squad's `move`
 *  walker), the tallest kneeler 1.31 m, the prone sniper 0.72 m. */
const STANDING_MIN = 1.4;
/** Below this a figure is lying down. */
const PRONE_MAX = 1.0;

/**
 * Teams whose store pose is a KNEEL at the deployed weapon, deliberately: the
 * crew-served weapon is the card (`move` would pack the tube away). Each
 * carries a demotion assertion below -- when one of these stands, delete it
 * from here. Adding a name here is a design call for the lead, not a fix.
 */
const KNEELS_AT_ITS_WEAPON: ReadonlySet<string> = new Set([
  'at_nlos_team',
  'atgm_cell',
  'digger_crew',
  'manpad_team',
  'mortar_crew',
  'mortar_team',
  'officer_fires',
  'recoilless_team',
]);

const teams = readdirSync(DIR)
  .filter((n) => n.endsWith('.glb') && !NOT_A_STANDING_TEAM.test(n))
  .map((n) => n.replace(/\.glb$/, ''));

async function storeFigureHeights(id: string): Promise<number[]> {
  const g = await parseGlbHeadless(readFileSync(new URL(`${id}.glb`, DIR)));
  const clip = g.animations.find((a) => a.name === showroomClip(id)) ?? null;
  expect(clip, `${id} has no '${showroomClip(id)}' clip`).not.toBeNull();
  poseRigged(g.scene, { showcase: null, idle: clip });
  g.scene.updateMatrixWorld(true);
  const figures = livingFigureRoots(bonesOf(g.scene)).filter((b) => !GEAR.test(b.name));
  expect(figures.length, `${id}: no figure shown`).toBeGreaterThan(0);
  const { points, owner } = visiblePoints(g.scene, figures, 1500);
  return figures.map((_, i) => {
    const ys = points.filter((_p: THREE.Vector3, k: number) => owner[k] === i).map((v) => v.y);
    expect(ys.length, `${id}: figure ${i} drew nothing`).toBeGreaterThan(0);
    return Math.max(...ys) - Math.min(...ys);
  });
}

describe('the store pose of every infantry team (GH-921)', () => {
  it('finds the teams (a vacuous census would pass everything)', () => {
    expect(teams.length).toBeGreaterThanOrEqual(20);
    expect(teams).toContain('sniper_team');
  });

  it.each(teams)('%s: no figure lies down', async (id) => {
    for (const h of await storeFigureHeights(id)) expect(h).toBeGreaterThan(PRONE_MAX);
  });

  it.each(teams.filter((id) => !KNEELS_AT_ITS_WEAPON.has(id)))('%s: every figure stands', async (id) => {
    for (const h of await storeFigureHeights(id)) expect(h).toBeGreaterThan(STANDING_MIN);
  });

  it.each([...KNEELS_AT_ITS_WEAPON])('%s: still kneels (else delete it from the exemption)', async (id) => {
    const hs = await storeFigureHeights(id);
    expect(Math.min(...hs)).toBeLessThan(STANDING_MIN);
  });

  it('the sniper is the one team on a non-idle store clip (the field clip table is untouched)', async () => {
    expect(SHOWROOM_CLIP['sniper_team']).toBe('move');
    expect(showroomClip('mortar_team')).toBe('idle');
  });
});
