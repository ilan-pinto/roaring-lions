/**
 * The A3.2-remainder building captures (GH-185, GH-31): the relay hut on its
 * crest, the pump house on its mission, and the damage-state sheet -- one
 * building at every band from clean to wreck, photographed through the live
 * renderer rather than through Blender, because the thing being judged (the
 * material step, the fire, the wreck under its own shroud) is RUNTIME
 * treatment that `pnpm validate:meshes` repaints away.
 *
 *   npx tsx tools/src/perf/building-captures.ts http://127.0.0.1:5280 <out> [--only=relay|pump|sheet] [--gpu=metal|swiftshader]
 *
 * The server is the caller's (a `vite --port 5280 --strictPort` from the tree
 * under test): this script never starts or stops one, so it cannot take down
 * someone else's. Music is off before boot (`lions.settings` `audio.music`
 * 0), the lead's standing rule for every test browser.
 *
 * Three things worth knowing.
 *
 * **The pump house is a MISSION structure, not a map symbol.** It stands in
 * `wadi_halam_2_laager`'s `structures[]`, so `?sandbox=wadi_halam_basin`
 * cannot show it; the capture boots the real mission and clears its deploy
 * gate the way the golden harness does (`dismissDeployGate`).
 *
 * **A friendly squad is spawned beside every subject.** Fog is computed from
 * living side-0 units, the sandbox force spawns at the map's own start marker
 * -- thirty tiles from the crest on Umm Zeitoun -- and an unexplored building
 * is a black rectangle. The squad is side 0 and parked; it fires at nothing.
 *
 * **The sheet damages one building DOWN the bands, in order.** `Sim.debug
 * DamageStructure` never heals, so each row is a further grind of the same
 * structure: 8 (clean), 5 and 3 (scarred), 2 (burning), 0 (the wreck, after
 * its settle). Every band lands through the real `structureHit` event, so
 * what the sheet shows is the shipped wiring, not a hand-set material.
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { dismissDeployGate } from '../golden-diff/capture-guard';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';

const ZOOMS = [2.5, 1.0] as const;
/** The rows of the sheet: `structureHpBand`'s eighths, descending. */
const BANDS = [8, 5, 3, 2, 0] as const;
const FIXED = 65536;

interface LionsWindow {
  __lions: {
    step(n: number): number;
    renderer: { camera: { x: number; y: number; zoom: number }; frame(a: number, dt: number): void };
    sim: {
      unitTypes: { id: string }[];
      structureTypes: { id: string }[];
      structures: { typeIdx: Int32Array | number[]; alive: Uint8Array | number[] };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      structureAt(x: number, y: number): number;
      debugDamageStructure(id: number, eighths: number): void;
      debugDestroyStructure(id: number): void;
    };
  };
}

const [base, outArg, ...rest] = process.argv.slice(2);
if (!base || !outArg) {
  console.error('usage: building-captures.ts <base url> <out dir> [--only=relay|pump|sheet] [--gpu=...]');
  process.exit(2);
}
const out = path.resolve(outArg);
const only = rest.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? '';
fs.mkdirSync(out, { recursive: true });

const gpu = resolveGpuBackend(process.argv, process.platform);
const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(gpu) });
const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.addInitScript(musicOffInitScript());
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' || text.includes('no mesh queued')) console.log('  page:', text);
});

async function waitForLions(): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 90_000 });
}

async function bootSandbox(url: string): Promise<void> {
  await page.goto(base + url, { waitUntil: 'load' });
  await waitForLions();
  await page.waitForTimeout(2500);
}

async function bootMission(id: string): Promise<void> {
  await page.goto(`${base}/?mission=${id}`, { waitUntil: 'load' });
  await dismissDeployGate(page, id, { selectorTimeoutMs: 90_000 });
  await waitForLions();
  await page.waitForTimeout(2500);
}

async function cam(x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => {
      const c = (window as unknown as LionsWindow).__lions.renderer.camera;
      c.x = cx;
      c.y = cy;
      c.zoom = cz;
    },
    [x, y, zoom]
  );
  await page.waitForTimeout(300);
}

/** Pump presentation frames by hand -- the standing hazard is a throttled
 *  rAF in a headless tab, and a frame-driven read comes back stale with no
 *  error. `dt` is per frame, so 60 x 16 ms is a second of presentation. */
async function frames(n: number, dtMs = 1000 / 60): Promise<void> {
  await page.evaluate(
    ([count, dt]) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      for (let i = 0; i < count; i++) r.frame(1, dt);
    },
    [n, dtMs]
  );
}

async function spawnFriendly(id: string, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([uid, ux, uy, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === uid);
      if (typeIdx < 0) throw new Error(`no unit type "${uid}"`);
      return L.sim.spawn(typeIdx, 0, (ux as number) * (fixed as number), (uy as number) * (fixed as number));
    },
    [id, x, y, FIXED] as const
  );
}

async function step(n: number): Promise<number> {
  return page.evaluate((count) => (window as unknown as LionsWindow).__lions.step(count), n);
}

async function structureAt(x: number, y: number, expectType: string): Promise<number> {
  const found = await page.evaluate(
    ([sx, sy]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const s = L.sim.structureAt(sx, sy);
      return { s, type: s >= 0 ? L.sim.structureTypes[L.sim.structures.typeIdx[s]].id : null };
    },
    [x, y]
  );
  if (found.s < 0 || found.type !== expectType) {
    throw new Error(`expected a ${expectType} at (${x},${y}), found ${found.type ?? 'nothing'}`);
  }
  return found.s;
}

async function shot(name: string): Promise<string> {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file);
  return file;
}

async function both(name: string, x: number, y: number): Promise<void> {
  for (const zoom of ZOOMS) {
    await cam(x, y, zoom);
    await frames(3);
    await shot(`${name}-z${zoom}`);
  }
}

const wants = (job: string): boolean => only === '' || only === job;

// --- the relay hut on Umm Zeitoun's crest ------------------------------------
if (wants('relay')) {
  await bootSandbox('/?sandbox=umm_zeitoun');
  const relay = await structureAt(15, 7, 'relay');
  await spawnFriendly('inf_squad', 16.5, 9.5);
  await step(20);
  await page.waitForTimeout(1500);
  await frames(4);
  console.log(`relay: structure #${relay}`);
  await both('relay-umm_zeitoun', 16.0, 7.5);
}

// --- the pump house on Wadi Halam II -----------------------------------------
if (wants('pump')) {
  await bootMission('wadi_halam_2_laager');
  const pump = await structureAt(16, 19, 'pump_house');
  // The store is on Rif ground: a squad parked beside it is under fire
  // within a second of ticks, and the under-fire vignette washes the whole
  // frame red. Three ticks is enough for fog and not enough for the Rif.
  await spawnFriendly('inf_squad', 13.5, 22.5);
  await step(3);
  await page.waitForTimeout(800);
  await frames(4);
  console.log(`pump house: structure #${pump}`);
  await both('pump_house-wadi_halam_2', 17.0, 20.0);
}

// --- the pump house, clean, on its own map ------------------------------------
// The mission capture above is the honest one and it is red: the store sits
// inside Wadi Halam II's contested hold zone from tick 0. For a reading of
// the ART, the sandbox stands the same 2x2 at the mission's own tile and
// loads its mesh by hand -- the roster-driven loader has no reason to fetch
// a type the map never authors.
if (wants('pump-clean')) {
  await bootSandbox('/?sandbox=wadi_halam_basin');
  await page.evaluate(`(async () => {
    const L = window.__lions;
    const typeIdx = L.sim.structureTypes.findIndex((t) => t.id === 'pump_house');
    if (typeIdx < 0) throw new Error('no pump_house structure type');
    const w = L.sim.width;
    L.sim.addStructure(typeIdx, [16 + 19 * w, 17 + 19 * w, 16 + 20 * w, 17 + 20 * w]);
    await L.renderer.loadBuildingMesh('pump_house', '/meshes/buildings/pump_house.glb', '/meshes/buildings/pump_house_wreck.glb');
  })()`);
  await spawnFriendly('inf_squad', 13.5, 22.5);
  await step(20);
  await page.waitForTimeout(1500);
  await frames(4);
  await both('pump_house-wadi_halam_basin-sandbox', 17.0, 20.0);
}

// --- the damage-state sheet --------------------------------------------------
if (wants('sheet')) {
  await bootSandbox('/?sandbox=beit_sahwan_outskirts');
  const subjects: { id: string; tile: [number, number]; centre: [number, number]; watch: [number, number] }[] = [
    { id: 'house', tile: [28, 10], centre: [30.0, 11.5], watch: [30.5, 14.5] },
    { id: 'hall', tile: [20, 18], centre: [21.5, 19.5], watch: [24.5, 19.5] },
  ];
  const files: { id: string; band: number; zoom: number; file: string }[] = [];
  for (const sub of subjects) {
    const s = await structureAt(sub.tile[0], sub.tile[1], sub.id);
    await spawnFriendly('inf_squad', sub.watch[0], sub.watch[1]);
    await step(20);
    await page.waitForTimeout(1000);
    await frames(4);
    for (const band of BANDS) {
      if (band === 0) {
        await page.evaluate((id) => (window as unknown as LionsWindow).__lions.sim.debugDestroyStructure(id), s);
        // The shroud, the swap hold and the settle all run on the frame
        // clock: a second of ticks, then four seconds of presentation.
        await step(20);
        await page.waitForTimeout(500);
        await frames(240);
      } else if (band < 8) {
        await page.evaluate(([id, b]) => (window as unknown as LionsWindow).__lions.sim.debugDamageStructure(id, b), [s, band]);
        await step(2);
        // A burning band needs its timer to have thrown a few beats.
        await frames(band <= 2 ? 150 : 6);
      }
      for (const zoom of ZOOMS) {
        await cam(sub.centre[0], sub.centre[1], zoom);
        await frames(band <= 2 ? 30 : 3);
        files.push({ id: sub.id, band, zoom, file: await shot(`sheet-${sub.id}-band${band}-z${zoom}`) });
      }
    }
  }
  // The contact sheet: one row per band, the two subjects at both zooms,
  // laid out by the browser and photographed once.
  const cell = (f: { file: string }) => `<img src="file://${f.file}" style="width:460px;height:288px;object-fit:cover">`;
  const rows = BANDS.map(
    (band) =>
      `<tr><th>band ${band}${band === 8 ? ' clean' : band >= 3 ? ' scarred' : band >= 1 ? ' burning' : ' wreck'}</th>` +
      files
        .filter((f) => f.band === band)
        .sort((a, b) => a.id.localeCompare(b.id) || b.zoom - a.zoom)
        .map((f) => `<td>${cell(f)}<div>${f.id} z${f.zoom}</div></td>`)
        .join('') +
      '</tr>'
  ).join('');
  const html =
    '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#ddd;font:12px sans-serif">' +
    `<table style="border-collapse:collapse"><tr><th></th>${['hall z2.5', 'hall z1', 'house z2.5', 'house z1'].map((h) => `<th>${h}</th>`).join('')}</tr>${rows}</table>`;
  const sheetHtml = path.join(out, 'damage-sheet.html');
  fs.writeFileSync(sheetHtml, html);
  const sheetPage = await browser.newPage({ viewport: { width: 1900, height: 1600 }, deviceScaleFactor: 1 });
  await sheetPage.goto(`file://${sheetHtml}`, { waitUntil: 'load' });
  await sheetPage.waitForTimeout(500);
  await sheetPage.screenshot({ path: path.join(out, 'damage-sheet.png'), fullPage: true });
  console.log('saved', path.join(out, 'damage-sheet.png'));
  await sheetPage.close();
}

await browser.close();
