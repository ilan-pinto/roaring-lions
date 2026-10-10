// Draw calls per kitted vehicle, through the SHIPPED template builder
// (GH-238 plan 3, Task 3; spec docs/superpowers/specs/2026-10-06-kitted-vehicles.md §5).
//
//   tsx tools/src/perf/kit-drawcalls.ts [--ids=mbt_lavi,dozer_d9] [--tiers=0|3] [--n=20]
//       [--gpu=metal|swiftshader] [--synthetic-kit]
//
// The claim it checks: merging bought kit into the host geometry at load costs
// +0 draw calls. A vehicle submits once per live mesh per pass, and the game
// draws three passes -- shadow, main, and the GTAO pre-pass (an override
// material) -- so every KDF vehicle reads 4 meshes x 3 = 12, and the D9 (2
// meshes) reads 6, at tiers 0 and at tiers 3 alike. Anything else exits 1 --
// and so does a tiers > 0 reading on a vehicle with no kit merged (without
// `--synthetic-kit`), which would be the tier-0 hull read twice and no
// measurement of the merge at all. An unknown argument exits 2. Both live in
// `kit-drawcalls-args.ts`, where its test holds them.
//
// WHAT IT MEASURES IS THE REAL CODE. `packages/render`'s own
// `buildVehicleMeshTemplate` (which calls `applyVehicleKit` first),
// `instantiateVehicleMesh` and the shared Draco `gltfLoader` are bundled with
// esbuild (three left external) and loaded into a page that takes `three` from
// the same `packages/render/node_modules/three` through an import map, so the
// bundle and the page share one THREE. Each GLB is read from
// `assets/meshes/vehicles/<id>.glb` -- the Draco files the app ships -- with the
// app's own self-hosted decoder from `assets/draco/`. That matters: a raw
// `gltf.scene.clone()` draws the `death_root` wreck twins too (the builder is
// what hides them), and would read 24, not 12.
//
// No server: a fake origin answered from disk by `page.route`, so nothing
// listens on a port. Music off is seeded through the shared helper (the lead's
// rule), although this page plays nothing.
//
// `--synthetic-kit` is for a GLB with no kit yet (every shipped one until
// Task 4): in the page, before the builder runs, it grafts a copy of each
// vehicle's first live mesh beside it as `kit_armour_1_<host>` -- the
// contract's shape exactly (host's parent, transform, material, attributes)
// -- so the merge runs on real Draco-decoded geometry and the kit columns
// read non-zero at tiers >= 1.
//
// THE COUNT IS TAKEN BY HAND. three r170's `renderer.info` auto-resets AFTER
// the shadow pass, so the default reading is the main pass alone and would
// call a vehicle 4 where it costs 12. `info.autoReset` is turned off and
// `info.reset()` called once before the frame (shadow + main) and once before
// the AO pre-pass.
import { realpathSync, readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { EXPECTED, EXPECTED_DEFAULT, kitReadingFailure, parseKitDrawcallArgs, type KitDrawcallArgs } from './kit-drawcalls-args';

const TAG = 'kit-drawcalls';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const THREE_DIR = join(REPO, 'packages/render/node_modules/three');
const UNITS = join(REPO, 'packages/render/src/three/units');
const GLB_DIR = join(REPO, 'assets/meshes/vehicles');
const DRACO_DIR = join(REPO, 'assets/draco');

let args: KitDrawcallArgs;
try {
  args = parseKitDrawcallArgs(process.argv.slice(2), process.platform);
} catch (err) {
  console.error(`[${TAG}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
const { ids, tierLevels, n: N, gpu, syntheticKit } = args;
for (const id of ids) {
  if (!existsSync(join(GLB_DIR, `${id}.glb`))) {
    console.error(`[${TAG}] no ${join(GLB_DIR, `${id}.glb`)}`);
    process.exit(2);
  }
}

/** esbuild, reached through `tsx` (a direct dependency of this package, which
 *  depends on it) rather than added as one -- the bundle is a measuring
 *  convenience, not a build this package owns. Typed by hand to the one call
 *  this file makes. */
interface EsbuildApi {
  build(opts: {
    entryPoints: string[];
    bundle: boolean;
    format: 'esm';
    outfile: string;
    external: string[];
    platform: 'browser';
    logLevel: 'error';
  }): Promise<unknown>;
}
function loadEsbuild(): EsbuildApi {
  const tsx = realpathSync(join(REPO, 'tools/node_modules/tsx/package.json'));
  return createRequire(tsx)('esbuild') as EsbuildApi;
}

async function bundleShippedBuilder(outDir: string): Promise<string> {
  const entry = join(outDir, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { buildVehicleMeshTemplate, instantiateVehicleMesh } from ${JSON.stringify(join(UNITS, 'mesh-vehicle.ts'))};`,
      `export { gltfLoader, setDracoDecoderPath } from ${JSON.stringify(join(UNITS, 'gltf-loader.ts'))};`,
      `export { TEXTURED_VEHICLE_TYPES } from ${JSON.stringify(join(UNITS, 'textured-vehicle.ts'))};`,
      `export { KIT_BASE_COUNT_KEY } from ${JSON.stringify(join(UNITS, 'vehicle-kit.ts'))};`,
      '',
    ].join('\n')
  );
  const outfile = join(outDir, 'kit-builder.js');
  await loadEsbuild().build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    outfile,
    // The page's import map supplies these, so the bundle and the page
    // construct and render through ONE three.
    external: ['three', 'three/*'],
    platform: 'browser',
    logLevel: 'error',
  });
  return outfile;
}

const ORIGIN = 'http://kit.local';
const MIME: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
};

// The page. Plain JS in a string: it runs in the browser against the bundle,
// and nothing here is part of any shipped build.
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script type="importmap">{"imports":{"three":"${ORIGIN}/three/build/three.module.js","three/addons/":"${ORIGIN}/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import * as K from '${ORIGIN}/kit/kit-builder.js';
K.setDracoDecoderPath('${ORIGIN}/draco/');
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(800, 600);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
window.run = async (id, level, n, synthetic) => {
  const gltf = await K.gltfLoader().loadAsync('${ORIGIN}/glb/' + id + '.glb');
  if (synthetic) {
    let host = null;
    gltf.scene.traverse((o) => {
      if (host || !o.isMesh) return;
      for (let p = o; p; p = p.parent) if (p.name === 'death_root') return;
      host = o;
    });
    const k = new THREE.Mesh(host.geometry.clone(), host.material);
    k.name = 'kit_armour_1_' + host.name;
    k.userData = { ...host.userData, rl_kit: { track: 'armour', tier: 1, host: host.name } };
    k.position.copy(host.position);
    k.quaternion.copy(host.quaternion);
    k.scale.copy(host.scale);
    host.parent.add(k);
  }
  const tiers = level > 0 ? { armour: level, sensors: level, firepower: level } : undefined;
  const tpl = K.buildVehicleMeshTemplate(gltf, id, K.TEXTURED_VEHICLE_TYPES.has(id), tiers);
  let liveMeshes = 0, kitted = 0, kitTris = 0;
  tpl.root.traverse((o) => {
    if (!o.isMesh) return;
    let hidden = false;
    for (let p = o; p; p = p.parent) if (p.visible === false) hidden = true;
    if (!hidden) liveMeshes++;
    const base = o.geometry.userData[K.KIT_BASE_COUNT_KEY];
    if (!hidden && typeof base === 'number') { kitted++; kitTris += (o.geometry.index.count - base) / 3; }
  });
  const scene = new THREE.Scene();
  const ents = [];
  for (let i = 0; i < n; i++) {
    const e = K.instantiateVehicleMesh(tpl, id);
    // The game's own resting pose: idle plays, the wreck stays hidden.
    const idle = e.actions.get('idle');
    if (idle) idle.play();
    if (e.mixer) e.mixer.update(0);
    ents.push(e);
  }
  // Lay them out on a grid sized from the vehicle's own extent, and fit the
  // camera AND the shadow camera to the whole field, so no clone is culled
  // from either pass.
  const box = new THREE.Box3().setFromObject(ents[0].root);
  const size = box.getSize(new THREE.Vector3());
  const pitch = Math.max(size.x, size.z) * 1.5 + 0.1;
  const cols = Math.ceil(Math.sqrt(n));
  ents.forEach((e, i) => {
    e.root.position.set((i % cols) * pitch, 0, Math.floor(i / cols) * pitch);
    e.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(e.root);
  });
  scene.updateMatrixWorld(true);
  const field = new THREE.Box3().setFromObject(scene);
  const centre = field.getCenter(new THREE.Vector3());
  const r = field.getSize(new THREE.Vector3()).length() * 0.6 + 1;
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.copy(centre).add(new THREE.Vector3(-0.406, 0.819, 0.406).multiplyScalar(r * 2));
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.01, far: r * 4 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0x444444, 1));
  const cam = new THREE.OrthographicCamera(-r * 1.4, r * 1.4, r, -r, 0.01, r * 8);
  cam.position.copy(centre).add(new THREE.Vector3(-1, 1, -1).normalize().multiplyScalar(r * 3));
  cam.lookAt(centre);
  cam.updateMatrixWorld(true);

  renderer.render(scene, cam); // warm: programs compiled, shadow map allocated
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, cam);
  const mainAndShadow = renderer.info.render.calls;
  const triangles = renderer.info.render.triangles;
  renderer.info.reset();
  const rt = new THREE.WebGLRenderTarget(400, 300);
  const ao = new THREE.MeshNormalMaterial();
  scene.overrideMaterial = ao;
  renderer.setRenderTarget(rt);
  renderer.shadowMap.autoUpdate = false;
  renderer.render(scene, cam);
  const aoPrepass = renderer.info.render.calls;
  renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = true;
  renderer.info.autoReset = true;
  scene.overrideMaterial = null;
  rt.dispose();
  ao.dispose();
  for (const e of ents) if (e.mixer) e.mixer.uncacheRoot(e.root);
  for (const m of tpl.materials) m.dispose();
  for (const g of tpl.geometries) g.dispose();
  return {
    liveMeshes, kittedMeshes: kitted, kitTrisPerVehicle: kitTris,
    callsMainPlusShadow: mainAndShadow, callsAoPrepass: aoPrepass,
    perVehicle: (mainAndShadow + aoPrepass) / n, trianglesPerVehicleMainPlusShadow: triangles / n,
  };
};
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
window.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
window.ready = true;
</script>`;

interface RunResult {
  liveMeshes: number;
  kittedMeshes: number;
  kitTrisPerVehicle: number;
  callsMainPlusShadow: number;
  callsAoPrepass: number;
  perVehicle: number;
  trianglesPerVehicleMainPlusShadow: number;
}

const work = mkdtempSync(join(tmpdir(), 'kit-drawcalls-'));
let failures = 0;
const browser = await chromium.launch({ args: gpuLaunchArgs(gpu) });
try {
  const bundle = await bundleShippedBuilder(work);
  const ctx = await browser.newContext();
  await ctx.addInitScript(musicOffInitScript());
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[page]', m.text());
  });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    let file: string | null = null;
    if (p === '/kit/kit-builder.js') file = bundle;
    else if (p.startsWith('/three/')) file = join(THREE_DIR, p.slice('/three/'.length));
    else if (p.startsWith('/glb/')) file = join(GLB_DIR, p.slice('/glb/'.length));
    else if (p.startsWith('/draco/')) file = join(DRACO_DIR, p.slice('/draco/'.length));
    if (file === null || !existsSync(file)) {
      console.error(`[${TAG}] 404 ${p}`);
      return route.fulfill({ status: 404, body: `missing ${p}` });
    }
    return route.fulfill({
      status: 200,
      contentType: MIME[extname(file)] ?? 'application/octet-stream',
      body: readFileSync(file),
    });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, null, { timeout: 30_000 });
  const gpuName = await page.evaluate(() => (window as unknown as { gpu: string }).gpu);
  console.log(
    `[${TAG}] gpu ${gpu}: ${gpuName}; ${N} clones; shadow + main + AO override pass; info reset by hand` +
      (syntheticKit ? '; SYNTHETIC kit (a copy of each first live mesh as kit_armour_1)' : '')
  );
  for (const level of tierLevels) {
    for (const id of ids) {
      const r = await page.evaluate(
        ([i, l, n, s]) =>
          (window as unknown as { run(id: string, l: number, n: number, s: boolean): Promise<RunResult> }).run(
            i,
            l,
            n,
            s
          ),
        [id, level, N, syntheticKit] as [string, number, number, boolean]
      );
      const want = EXPECTED[id] ?? EXPECTED_DEFAULT;
      const failure = kitReadingFailure({ id, level, perVehicle: r.perVehicle, kittedMeshes: r.kittedMeshes, syntheticKit });
      if (failure !== null) failures++;
      console.log(
        `${failure === null ? 'PASS' : 'FAIL'} ${id} tiers=${level}: ${r.perVehicle} submissions/vehicle (want ${want}) ` +
          `= (${r.callsMainPlusShadow} shadow+main + ${r.callsAoPrepass} AO) / ${N}; ` +
          `${r.liveMeshes} live meshes, ${r.kittedMeshes} carrying kit, ${r.kitTrisPerVehicle} kit tris/vehicle, ` +
          `${r.trianglesPerVehicleMainPlusShadow} tris/vehicle shadow+main` +
          (failure === null ? '' : `\n     -> ${failure}`)
      );
    }
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`[${TAG}] ${failures} reading(s) failed: off the expected submissions per vehicle, or tiers > 0 with no kit merged`);
  process.exit(1);
}
console.log(`[${TAG}] every reading at 12 (6 for dozer_d9)`);
