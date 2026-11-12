// GH-1167 S6 (design 2026-11-11, sections 5.2, 5.3 and decision 12): the instruments' half of the 3D grass field. Pure, so each
// decision can be driven red by a constructed input in `webgpu-grass-lib.test.ts`.
//
// Two jobs:
//  1. The L-vs-G tools on `wadi_halam_4` (the ABBA runner, the submit probe, the banding probe and sheet, the P1 and P2 sheets, the
//     units probe's `valley` subject, the rAF hypothesis) HIDE the `grass-field` layer and print `grass: hidden` in their conditions.
//     Grass on G only would break the like-for-like comparison with L (which draws no field) and land on the GH-1152 ratio.
//  2. The grass cost is its own column, G on against G off (`webgpu-grass-probe.ts` counts it on SwiftShader; `webgpu:abba --grass`
//     times it on Metal). A grass-on arm that drew 0 grass calls is REFUSED: the probe cannot pass vacuously.
import type { PerPass } from './webgpu-submit-probe-lib';

/** The debug layer (`three/debug-layers.ts`, `ThreeRenderer.setDebugLayerVisible`) that shows and hides the whole field. */
export const GRASS_LAYER = 'grass-field';
/** The field's scene objects are named under this (`GRASS_FIELD_NAME` in `terrain/grass-field.node.ts`; `grass_instruments.test.ts` pins the copy). */
export const GRASS_NAME_PREFIX = 'rl-grass-field';
/** The zooms of the budget (design 5.1). */
export const GRASS_ZOOMS: readonly number[] = [0.5, 1, 1.5, 2.5];

/** `hidden`: the L-vs-G tools' mode. `on` / `off`: the G-on-against-G-off column (the field is built either way; only the layer differs). */
export type GrassMode = 'hidden' | 'on' | 'off';

/** The token every conditions line carries. */
export const grassCondition = (mode: GrassMode): string => `grass: ${mode}`;

/** The scene-graph shape the in-page counter reads. */
export interface GrassNodeLike {
  readonly name: string;
  readonly visible: boolean;
  readonly isMesh?: boolean;
  readonly children: readonly GrassNodeLike[];
}

/** Meshes under `root` whose name is under `GRASS_NAME_PREFIX` and whose own and every ancestor's `visible` is true: what a frame would submit, before the frustum. */
export function countGrassMeshes(root: GrassNodeLike): number {
  let n = 0;
  const walk = (o: GrassNodeLike, parentVisible: boolean): void => {
    const vis = parentVisible && o.visible;
    if (vis && o.isMesh === true && o.name.startsWith(GRASS_NAME_PREFIX)) n++;
    for (const c of o.children) walk(c, vis);
  };
  walk(root, true);
  return n;
}

/**
 * In-page statements for a tool that boots the real app (`window.__lions`): hide the layer, then read how many grass meshes are still
 * visible. Returns JSON `{ changed, meshes }`. `meshes` must be 0 after this; `hiddenRefusal` turns anything else into a refusal.
 * Plain JS in a string (an injected script), so it carries its own copy of `countGrassMeshes`.
 */
export const HIDE_GRASS_SCRIPT = `(() => {
  const R = window.__lions.renderer;
  const changed = R.setDebugLayerVisible(${JSON.stringify(GRASS_LAYER)}, false);
  let meshes = 0;
  const walk = (o, pv) => {
    const vis = pv && o.visible;
    if (vis && o.isMesh === true && o.name.startsWith(${JSON.stringify(GRASS_NAME_PREFIX)})) meshes++;
    for (const c of o.children) walk(c, vis);
  };
  walk(R.scene, true);
  return JSON.stringify({ changed, meshes });
})()`;

/** A hide that left grass visible measured a scene with grass in it. */
export function hiddenRefusal(tool: string, meshes: number): string | null {
  return meshes === 0 ? null : `${tool}: ${grassCondition('hidden')} was asked for but ${meshes} grass mesh(es) are still visible (the layer did not hide the field)`;
}

/** What a page tells its driver about the grass it booted with, so the driver prints the page's word and not its own. */
export interface GrassState {
  readonly mode: GrassMode;
  /** Visible grass meshes right after boot and the mode was applied. */
  readonly meshes: number;
}

/** One stats frame of the G arm, grass on or off, at one zoom. */
export interface GrassReading {
  readonly zoom: number;
  readonly grass: 'on' | 'off';
  readonly perPass: PerPass;
  readonly triangles: number;
  /** `countGrassMeshes` on the scene when the stats frame was drawn. */
  readonly grassMeshes: number;
  /** What `setDebugLayerVisible('grass-field', ...)` reported: 1 when it changed and a field exists. */
  readonly layerChanged: number;
}

/** The on-minus-off difference at one zoom. `sceneCalls` is the GRASS calls: the field draws in the scene pass and nowhere else. */
export interface GrassRow {
  readonly zoom: number;
  readonly sceneCalls: number;
  readonly shadowCalls: number;
  readonly aoCalls: number;
  readonly triangles: number;
  readonly onMeshes: number;
  readonly onSceneCalls: number;
  readonly offSceneCalls: number;
}

const pick = (rs: readonly GrassReading[], zoom: number, grass: 'on' | 'off'): GrassReading | undefined => rs.find((r) => r.zoom === zoom && r.grass === grass);

export function grassRows(rs: readonly GrassReading[]): GrassRow[] {
  const out: GrassRow[] = [];
  for (const zoom of [...new Set(rs.map((r) => r.zoom))].sort((a, b) => a - b)) {
    const on = pick(rs, zoom, 'on');
    const off = pick(rs, zoom, 'off');
    if (on === undefined || off === undefined) continue;
    out.push({
      zoom,
      sceneCalls: on.perPass.scene.calls - off.perPass.scene.calls,
      shadowCalls: on.perPass.shadow.calls - off.perPass.shadow.calls,
      aoCalls: on.perPass.ao.calls - off.perPass.ao.calls,
      triangles: on.triangles - off.triangles,
      onMeshes: on.grassMeshes,
      onSceneCalls: on.perPass.scene.calls,
      offSceneCalls: off.perPass.scene.calls,
    });
  }
  return out;
}

/**
 * Every reason these readings must not be reported. Empty is "report them".
 *  - a zoom with no on/off pair (a table with a hole in it);
 *  - the grass-on arm built no field, or drew 0 grass calls (the probe passing vacuously): `on` has no visible grass mesh, or its scene
 *    calls are no more than the off arm's;
 *  - the grass-off arm still has a visible grass mesh, or the layer reported it changed nothing (the A/B toggled nothing).
 * Grass calls in the shadow or AO pass are a finding for the budget table (0 and 0), not a refusal.
 */
export function grassRefusals(rs: readonly GrassReading[], zooms: readonly number[] = GRASS_ZOOMS): string[] {
  const out: string[] = [];
  for (const zoom of zooms) {
    const on = pick(rs, zoom, 'on');
    const off = pick(rs, zoom, 'off');
    if (on === undefined || off === undefined) {
      out.push(`z${zoom}: ${on === undefined ? 'no grass-on' : 'no grass-off'} reading`);
      continue;
    }
    if (on.grassMeshes === 0) out.push(`z${zoom}: the grass-on arm has 0 visible grass meshes (no field was built, or its layer is hidden): it drew 0 grass calls`);
    else if (on.perPass.scene.calls - off.perPass.scene.calls <= 0) out.push(`z${zoom}: the grass-on arm drew ${on.perPass.scene.calls} scene calls against ${off.perPass.scene.calls} with grass off: 0 grass calls`);
    if (off.grassMeshes !== 0) out.push(`z${zoom}: the grass-off arm still has ${off.grassMeshes} visible grass mesh(es): the layer did not hide the field`);
    if (off.layerChanged === 0) out.push(`z${zoom}: hiding the grass layer reported 0 changed: there is no field to toggle`);
  }
  return out;
}

/** The probe's table: grass calls and triangles per zoom, with the shadow and AO deltas (the budget says 0 and 0). */
export function grassTable(rs: readonly GrassReading[]): string[] {
  const rows = grassRows(rs);
  return [
    '| zoom | grass calls (scene on - off) | scene calls on / off | triangles on - off | shadow d | ao d | visible grass meshes (on) |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| z${r.zoom} | ${r.sceneCalls} | ${r.onSceneCalls} / ${r.offSceneCalls} | ${r.triangles} | ${r.shadowCalls} | ${r.aoCalls} | ${r.onMeshes} |`),
  ];
}

/** One G page of the abba grass column, as the runner saw it. */
export interface GrassColumnArm {
  readonly mode: 'on' | 'off';
  /** `ArmRun.grass.meshes`: visible grass meshes right after boot with the mode applied. */
  readonly meshes: number;
  readonly views: readonly { readonly zoom: number; readonly triangles: number }[];
}

/**
 * The abba grass column's refusals: the on page must have built a field that shows (visible grass meshes), the off page must show none,
 * and every zoom's on triangles must exceed the off triangles (a column of two identical scenes timed nothing).
 */
export function grassColumnRefusals(on: GrassColumnArm, off: GrassColumnArm): string[] {
  const out: string[] = [];
  if (on.meshes === 0) out.push('the grass-on page has 0 visible grass meshes: it drew 0 grass calls (no field was built)');
  if (off.meshes !== 0) out.push(`the grass-off page still has ${off.meshes} visible grass mesh(es)`);
  for (const v of on.views) {
    const o = off.views.find((x) => x.zoom === v.zoom);
    if (o === undefined) out.push(`z${v.zoom}: no grass-off view`);
    else if (!(v.triangles > o.triangles)) out.push(`z${v.zoom}: grass-on triangles ${v.triangles} are not above grass-off ${o.triangles}: the two scenes are the same`);
  }
  return out;
}

/**
 * For a tool that boots the real app in Playwright: hides the grass layer on `page` and throws a refusal when any grass mesh is still
 * visible. Call it once the app's `__lions` exists (after the boot settle), before anything is read or photographed. A boot with no
 * field (legacy, `low`, a theme with no `grassField`) reports `changed` 0 and `meshes` 0: that is a pass, the hide held vacuously.
 */
export async function hideGrassOnPage(page: { evaluate(script: string): Promise<unknown> }, tool: string): Promise<{ changed: number; meshes: number }> {
  const got = JSON.parse((await page.evaluate(HIDE_GRASS_SCRIPT)) as string) as { changed: number; meshes: number };
  const refusal = hiddenRefusal(tool, got.meshes);
  if (refusal !== null) throw new Error(refusal);
  return got;
}
