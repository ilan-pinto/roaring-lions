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
import { GEAR_BONE, SHOWROOM_CLIP, bonesOf, gearRoots, livingFigureRoots, poseRigged, showroomClip, stageTeam, visiblePoints } from './garage-pose';

const DIR = new URL('../../../../../art/meshes/', import.meta.url);

/** Not store cards: the casualty rigs and the robot dog (four legs). */
const NOT_A_STANDING_TEAM = /^(wounded_|ugv_)/;

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
  // The view's own staging, with no filter of ours between it and what we measure: a gear bone that
  // the staging let through as a figure would be measured here, and fail the height checks below.
  const figures = stageTeam(g.scene, 0).crew;
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

/**
 * Teams that carry a shared weapon bone (`prop`, or the digger's `ground`). The census is a literal: a new gear team
 * has to be named here, and a vacuous census (no team found) cannot pass.
 */
const GEAR_TEAMS = [
  'at_nlos_team',
  'atgm_cell',
  'demo_squad',
  'digger_crew',
  'mortar_crew',
  'mortar_team',
  'officer_fires',
  'recoilless_team',
  'recon_zikit',
];

async function posed(id: string) {
  const g = await parseGlbHeadless(readFileSync(new URL(`${id}.glb`, DIR)));
  const clip = g.animations.find((a) => a.name === showroomClip(id)) ?? null;
  poseRigged(g.scene, { showcase: null, idle: clip });
  g.scene.updateMatrixWorld(true);
  return g;
}

describe('a crew weapon stays with its crew in the store (GH-746)', () => {
  it('finds exactly the gear teams', async () => {
    const found: string[] = [];
    for (const id of teams) if (gearRoots(bonesOf((await posed(id)).scene)).length > 0) found.push(id);
    expect(found.sort()).toEqual(GEAR_TEAMS);
  });

  it.each(GEAR_TEAMS)('%s: the gear is not a figure, and stands where the field puts it relative to every crewman', async (id) => {
    const g = await posed(id);
    const where = (bs: readonly THREE.Bone[]) => bs.map((b) => b.getWorldPosition(new THREE.Vector3()));
    // The FIELD layout: the posed rig, before any staging touches it.
    const gearBefore = where(gearRoots(bonesOf(g.scene)));
    expect(gearBefore.length).toBeGreaterThan(0);
    const fieldCrew = livingFigureRoots(bonesOf(g.scene));
    const crewBefore = new Map(fieldCrew.map((b, i) => [b.name, where(fieldCrew)[i]] as const));
    const st = stageTeam(g.scene, 0);
    g.scene.updateMatrixWorld(true);
    expect(st.layout).toBe('group');
    for (const b of st.crew) expect(b.name, `${id}: a gear bone staged as a figure`).not.toMatch(GEAR_BONE);
    expect(st.gear.map((b) => b.name).length).toBe(gearBefore.length);
    const crewAfter = where(st.crew);
    const gearAfter = where(st.gear);
    // The offset from each crewman to each piece of gear, before staging and after, within 1 cm.
    expect([...crewBefore.keys()].sort()).toEqual(st.crew.map((b) => b.name).sort());
    st.crew.forEach((cb, i) => {
      const c0 = crewBefore.get(cb.name)!;
      gearBefore.forEach((g0, j) => {
        const was = new THREE.Vector3().subVectors(c0, g0);
        const now = new THREE.Vector3().subVectors(crewAfter[i], gearAfter[j]);
        expect(was.distanceTo(now), `${id}: crewman ${st.crew[i].name} moved ${was.distanceTo(now).toFixed(3)} m relative to ${st.gear[j].name}`).toBeLessThan(0.01);
      });
    });
    // ...and the crew stand at the weapon, not a line away from it.
    const nearest = Math.min(...crewAfter.map((c) => Math.min(...gearAfter.map((g1) => Math.hypot(c.x - g1.x, c.z - g1.z)))));
    expect(nearest, `${id}: nearest crewman to the gear`).toBeLessThan(1.0);
  });

  it('a team with no gear is still a line of figures that turn on their own spots', async () => {
    const st = stageTeam((await posed('inf_squad')).scene, 0);
    expect(st.layout).toBe('line');
    expect(st.crew.length).toBe(3);
    expect(st.spacing).toBeGreaterThan(0);
  });
});
