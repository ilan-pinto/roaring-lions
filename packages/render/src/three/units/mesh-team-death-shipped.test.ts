/**
 * Every SHIPPED infantry team `art/meshes/*.glb` really carries the death
 * clips `units/mesh-death.ts` plays.
 *
 * This exists because the claim drifted out of true in the documentation and
 * nothing caught it. CLAUDE.md carried "Mesh units have no `down`/`wreck`/
 * `work` clips, so a mesh unit that dies has no death state" for long enough
 * that a task was raised to go and build them -- by which time `233f683` had
 * already shipped all of them, `mesh-death.ts` was already playing them, and
 * a killed `inf_squad` had been leaving three prone figures on the ground for
 * days. The reverse drift is the one that actually costs something: a
 * re-export that quietly stops emitting `down`/`wreck` returns the game to
 * the state that text described, and NOTHING else in the tree would fail.
 * `validate:meshes` renders one representative pose per mesh and checks
 * palette and silhouette; it never enumerates clips. `mesh-death.test.ts`
 * drives the fade against a hand-built fixture, which by construction has
 * whatever clips the fixture author gave it.
 *
 * So this file asserts against the BYTES ON DISK, through the real
 * `buildMeshUnitTemplate` -- the same standard `civilian-mesh-shipped.test.ts`
 * and `mesh-vehicle-shipped.test.ts` already set, and the same headless
 * `GLTFLoader.parseAsync`-on-a-Buffer route (no network, no `WebGLRenderer`).
 *
 * Scope is the TOP level of `art/meshes/` only -- the infantry teams
 * `tools/units/rig.py` builds. `civilians/` has its own file and its own
 * (deliberately different) clip set; `vehicles/`, `buildings/`, `decor/` and
 * `vfx/` are not rigged figures and carry no death clips at all, which is
 * itself the open debt CLAUDE.md now records.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildMeshUnitTemplate, instantiateMeshUnit } from './mesh-unit';
import { applyMeshClip } from './mesh-clip';
import { CLIP_NAMES } from './mesh-anim';
import { beginMeshDeath, liveFigureRoots, type MeshDeathPhase } from './mesh-death';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const TEAM_MESHES = `${REPO}art/meshes/`;

/**
 * `moto_rpg` is the one team with no `down`, and it is a decision rather than
 * a gap: `tools/units/rig.py`'s `build_moto_clips` says "No `down` --
 * `TEAM_CLIP_DROP` already drops it from the sprite sheet for the same reason
 * ('a motorcycle cannot go prone'); the mesh drops it too." Named here so that
 * a SECOND team losing its `down` fails, instead of widening a hole this one
 * team was allowed through.
 */
const NO_DOWN_CLIP = new Set(['moto_rpg']);

/** Team GLBs are the files at the top level of `art/meshes/`; every
 *  subdirectory is a different asset class with a different contract. */
function shippedTeams(): string[] {
  return readdirSync(TEAM_MESHES, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.glb'))
    .map((e) => e.name.slice(0, -'.glb'.length))
    .sort();
}

async function parseShipped(team: string) {
  const bytes = readFileSync(`${TEAM_MESHES}${team}.glb`);
  // `Buffer` is a `Uint8Array` view over a shared pool, so hand `parseAsync`
  // a standalone `ArrayBuffer` rather than the whole pool behind it.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(ab, '');
}

/** Faction picks a colour ramp and nothing else -- no clip, name, track or
 *  duration below depends on it, so every team is read through one. */
async function templateFor(team: string) {
  return buildMeshUnitTemplate(await parseShipped(team), 'kdf');
}

describe('shipped infantry team meshes: the death clips exist', () => {
  it('finds the team GLBs at all -- a bad glob would make every case below vacuous', () => {
    const teams = shippedTeams();
    expect(teams.length).toBeGreaterThanOrEqual(16);
    expect(teams).toContain('inf_squad');
    expect(teams).toContain('moto_rpg');
  });

  it.each(shippedTeams())('%s: carries a `wreck` clip', async (team) => {
    const template = await templateFor(team);
    expect([...template.clips.keys()]).toContain('wreck');
  });

  it.each(shippedTeams())('%s: carries a `down` clip unless it is the named exemption', async (team) => {
    const template = await templateFor(team);
    expect(template.clips.has('down')).toBe(!NO_DOWN_CLIP.has(team));
  });

  it.each(shippedTeams())('%s: every authored clip is a name the engine can play', async (team) => {
    const template = await templateFor(team);
    // `buildMeshUnitTemplate` throws on an unrecognised name, so reaching
    // here already proves it -- assert anyway so the case reports what it
    // checked rather than passing silently on an empty clip map.
    expect(template.clips.size).toBeGreaterThan(0);
    for (const name of template.clips.keys()) expect(CLIP_NAMES).toContain(name);
  });

  it.each(shippedTeams())('%s: `down`/`wreck` are held poses, not animated collapses', async (team) => {
    const template = await templateFor(team);
    for (const name of ['down', 'wreck'] as const) {
      const clip = template.clips.get(name);
      if (!clip) {
        expect(NO_DOWN_CLIP.has(team)).toBe(true);
        continue;
      }
      // `rig.py`'s `_VIS_FRAMES` is two frames at 24 fps = 0.0417 s. The
      // ceiling is loose because what matters is "static", not the exact
      // numeral; the living `idle` clips these sit beside run 1.33-3.67 s,
      // so anything animated lands far above this.
      expect(clip.duration).toBeLessThan(0.2);

      // Duration alone would pass a two-frame clip that still MOVED between
      // its two frames, which is exactly what an authored collapse would
      // look like once shortened. Assert the pose is genuinely held.
      //
      // Every sample against the FIRST, not the first against the last: a
      // first-vs-last check passes any CYCLE, since a loop by definition
      // returns to where it started. Found by falsification -- pointed at
      // the living `idle` clips, the first-vs-last version went red on only
      // 3 of 17 teams; this version goes red on 16 (`sniper_team`'s idle is
      // genuinely static, being prone already).
      for (const track of clip.tracks) {
        const values = track.values;
        const stride = values.length / track.times.length;
        for (let s = 1; s < track.times.length; s++) {
          for (let i = 0; i < stride; i++) {
            expect(Math.abs(values[s * stride + i] - values[i])).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  // --- I1 (Ruling 11): liveFigureRoots must never pick up a mount --------

  it.each(shippedTeams())(
    '%s: liveFigureRoots(idle) names no prop/ground/neutral_bone mount, and every root has a Bone child',
    async (team) => {
      const template = await templateFor(team);
      const entity = instantiateMeshUnit(template, team);
      applyMeshClip(entity, 'idle');
      entity.mixer.update(0.01); // writes the scale keys `liveFigureRoots` reads
      const roots = liveFigureRoots(entity.root);
      const names = roots.map((b) => b.name);
      // Printed on the PASSING path, per this task's brief -- the whole
      // point of a shipped-bytes sweep is to show what it actually found,
      // not just that nothing it was told to look for showed up.
      console.log(`${team}: liveFigureRoots(idle) = [${names.join(', ')}]`);
      for (const mount of ['prop', 'ground', 'neutral_bone']) expect(names).not.toContain(mount);
      for (const root of roots) {
        expect(root.children.some((c) => (c as THREE.Bone).isBone)).toBe(true);
      }
    }
  );
});

// --- I2 (Ruling 12): which death path each shipped rig takes ---------------

/**
 * Pinned by instantiating each shipped team, playing `idle`, advancing the
 * mixer once (so any constant scale keys are written), then calling
 * `beginMeshDeath` and reading `.phase`. Three files carry an authored
 * `fall`/`fallAlt` and enter `falling` (D3); two -- `sniper_team` (a prone
 * rig, live in its own wreck geometry already) AND `meshy_mortar_team`
 * (Ruling 12: its `idle`/`fire`/`down`/`wreck` are all poses in the SAME
 * bone tree, keying identical scale signatures, so a mortar team killed
 * while idle or firing takes the "already down" blend straight to
 * `settling` even though nothing about its actual pose is prone) -- take
 * the already-down path; every other shipped team has neither and enters
 * the generic per-figure `toppling` (D5).
 */
describe('which death path each shipped rig takes', () => {
  const EXPECTED_PHASE: Readonly<Record<string, MeshDeathPhase>> = {
    meshy_soldier: 'falling',
    sarim_rifles: 'falling',
    yahalom_engineer: 'falling',
    sniper_team: 'settling',
    meshy_mortar_team: 'settling',
  };

  it.each(shippedTeams())('%s', async (team) => {
    const template = await templateFor(team);
    const entity = instantiateMeshUnit(template, team);
    applyMeshClip(entity, 'idle');
    entity.mixer.update(0.01);
    const dying = beginMeshDeath(entity, 1);
    const expected = EXPECTED_PHASE[team] ?? 'toppling';
    // Break check (verified by hand, then reverted): change any one entry
    // above -- e.g. `meshy_mortar_team: 'toppling'`. That team's own case
    // goes red (reads 'settling', the real already-down blend Ruling 12
    // accepts), proving this pins the actual bytes rather than restating
    // whatever the map already says.
    expect(dying.phase).toBe(expected);
  });
});
