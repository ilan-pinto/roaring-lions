// Draw-call measurement for the kitted-vehicle variant mechanism
// (GH-238 plan 3, docs/superpowers/specs/2026-10-06-kitted-vehicles.md s5).
//
//   tools/node_modules/.bin/tsx docs/art/sheets/kitted-vehicles/measure/kit-drawcalls.mts \
//       <dir of kit_blockout.py --export GLBs> [ids] [vehicles per scene]
//
// For each `<id>_kit.glb` (the shipped live nodes plus every kit part as its own
// `kit_*` node) it draws N clones three ways -- kit removed, kit as separate
// nodes, kit MERGED into its host node's geometry -- and counts draw calls with
// three r170's own `renderer.info`, which resets AFTER the shadow pass, so it is
// reset by hand here and the shadow draws are counted. The AO pre-pass is a
// second render with an override material, as the composer's GTAO pass makes.
// No server: a fake origin answered from disk by `page.route`. Music off seeded
// through the shared helper (the lead's rule), although this page plays nothing.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const { chromium } = await import(join(REPO, 'tools/node_modules/playwright/index.mjs'));
const { musicOffInitScript } = await import(join(REPO, 'tools/src/ui-review/music-off.ts'));
const THREE = join(REPO, 'packages/render/node_modules/three');
const GLB = process.argv[2];
const IDS = (process.argv[3] ?? 'mbt_lavi,apc_eitan').split(',');
const N = Number(process.argv[4] ?? 20);
const MIME = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script type="importmap">{"imports":{"three":"http://kit.local/three/build/three.module.js","three/addons/":"http://kit.local/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
window.run = async (id, n) => {
  const gltf = await new GLTFLoader().loadAsync('http://kit.local/glb/' + id + '_kit.glb');
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(800, 600);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const isKit = (o) => !!(o.userData && o.userData.rl_kit);
  function variant(kind) {
    const root = gltf.scene.clone(true);
    root.traverse((o) => { if (o.isMesh) o.geometry = o.geometry.clone(); });
    const kits = []; root.traverse((o) => { if (o.isMesh && isKit(o)) kits.push(o); });
    let mergeMs = 0;
    if (kind === 'base') kits.forEach((k) => k.parent.remove(k));
    if (kind === 'merged') {
      const t0 = performance.now();
      const byHost = new Map();
      for (const k of kits) {
        const host = root.getObjectByName(k.userData.rl_kit.host);
        if (!byHost.has(host)) byHost.set(host, []);
        byHost.get(host).push(k);
      }
      root.updateMatrixWorld(true);
      for (const [host, ks] of byHost) {
        const inv = host.matrixWorld.clone().invert();
        const geos = [host.geometry];
        for (const k of ks) {
          const g = k.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld));
          geos.push(g);
        }
        const common = Object.keys(geos[0].attributes).filter((a) => geos.every((g) => g.attributes[a]));
        for (const g of geos) for (const a of Object.keys(g.attributes)) if (!common.includes(a)) g.deleteAttribute(a);
        const idx = geos.map((g) => (g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()])));
        host.geometry = mergeGeometries(idx, false);
        ks.forEach((k) => k.parent.remove(k));
      }
      mergeMs = performance.now() - t0;
    }
    let meshes = 0, tris = 0;
    root.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    return { root, mergeMs, meshes, tris, kitNodes: kits.length };
  }
  const out = {};
  for (const kind of ['base', 'toggled', 'merged']) {
    const v = variant(kind);
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(-20, 40, 20); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });
    scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x444444, 1));
    for (let i = 0; i < n; i++) {
      const c = v.root.clone(true); c.scale.setScalar(1 / 3);
      c.position.set((i % 5) * 4 - 8, 0, Math.floor(i / 5) * 4 - 8);
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(c);
    }
    const cam = new THREE.OrthographicCamera(-15, 15, 11, -11, 0.1, 200); cam.position.set(-30, 30, -30); cam.lookAt(0, 0, 0);
    renderer.render(scene, cam);
    // three r170 resets info AFTER the shadow pass, so autoReset hides the
    // shadow draws: reset by hand and count both.
    renderer.info.autoReset = false;
    renderer.info.reset(); renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, cam);
    const mainAndShadow = renderer.info.render.calls;
    const triangles = renderer.info.render.triangles;
    renderer.info.reset();
    const rt = new THREE.WebGLRenderTarget(400, 300);
    scene.overrideMaterial = new THREE.MeshNormalMaterial();
    renderer.setRenderTarget(rt); renderer.shadowMap.autoUpdate = false;
    renderer.render(scene, cam);
    const aoPrepass = renderer.info.render.calls;
    renderer.info.autoReset = true;
    renderer.setRenderTarget(null); renderer.shadowMap.autoUpdate = true; scene.overrideMaterial = null;
    // merge time: median of 15 fresh merges
    let mergeMs = null;
    if (kind === 'merged') { const ts = []; for (let i = 0; i < 15; i++) ts.push(variant('merged').mergeMs); ts.sort((a, b) => a - b); mergeMs = +ts[7].toFixed(2); }
    out[kind] = { meshesPerVehicle: v.meshes, kitNodes: v.kitNodes, trisPerVehicle: v.tris, vehicles: n,
      callsMainPlusShadow: mainAndShadow, callsAoPrepass: aoPrepass, perVehicleAllPasses: +((mainAndShadow + aoPrepass) / n).toFixed(2), triangles, mergeMs };
    rt.dispose();
  }
  const gl = renderer.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  out.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  renderer.dispose();
  return out;
};
window.ready = true;
</script>`;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'] });
try {
  const ctx = await browser.newContext();
  await ctx.addInitScript(musicOffInitScript());
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.route('http://kit.local/**', async (route) => {
    const url = new URL(route.request().url());
    let file = null;
    if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.pathname.startsWith('/three/')) file = join(THREE, url.pathname.slice('/three/'.length));
    if (url.pathname.startsWith('/glb/')) file = join(GLB, url.pathname.slice('/glb/'.length));
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'missing ' + url.pathname });
    return route.fulfill({ status: 200, contentType: MIME[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await page.goto('http://kit.local/');
  await page.waitForFunction(() => window.ready === true);
  for (const id of IDS) {
    const r = await page.evaluate(([i, n]) => window.run(i, n), [id, N]);
    console.log(JSON.stringify({ id, ...r }));
  }
} finally {
  await browser.close();
}
