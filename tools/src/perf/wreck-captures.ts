/**
 * The eleven-pair vehicle-wreck sheet: every mesh vehicle photographed alive
 * and wrecked, at both ends of the gameplay zoom band.
 *
 *   npx tsx tools/src/perf/wreck-captures.ts http://127.0.0.1:5178 .superpowers/wreck-captures
 *   npx tsx tools/src/perf/wreck-captures.ts <base> <out> --only=mbt_lavi --tag=-lighttint
 *
 * 11 ids x {live, wreck} x {1.6, 2.2} = 44 PNGs. It is the instrument the
 * spec's SS4.5 asks for and the only one there is: `pnpm validate:meshes`
 * photographs each wreck through Blender, from the palette tables, with the
 * runtime CHARRING invisible to it -- so the gate can say the shape moved and
 * can say nothing at all about how the thing reads on screen.
 *
 * Three things about this script are not obvious and each one cost something.
 *
 * **It spawns its own eleven rather than framing the sandbox's force.**
 * `?sandbox=beit_sahwan_outskirts&sur` fields nine of the eleven -- but three
 * of those nine are HOSTILE (`technical`, `paramotor`, `rocket_battery`) and a
 * hostile draws nothing until a friendly sees its tile, and `scout_shachaf`
 * and `apc_kipod` are in no sandbox table at all. A parade line of side-0
 * copies on the empty northern band (rows 0-7 of that map are open ground with
 * no decor) is visible by construction, is at a known tile so the camera can
 * be centred exactly, and puts a LIVE neighbour in frame beside every wreck,
 * which is the contrast the sheet is being judged on.
 *
 * **The two unrostered vehicles arrive through the 1 Hz sweep, not through the
 * loader.** `mesh-catalogue.ts` is roster-driven and neither type is on this
 * sandbox's roster, so their GLBs are not fetched at boot. `main.ts`'s
 * per-second sweep notices a living type with no template, warns by name and
 * loads it -- so the script steps a second of ticks after spawning and then
 * waits for the fetch. The warning is echoed to this console, because "the
 * sweep did not fire" and "the mesh is missing" produce the same empty tile.
 *
 * **The wreck is photographed SETTLED, so the frame loop is left alone.**
 * Task 4 had to freeze it and hand-drive `renderer.frame()` to catch the 0.4 s
 * fade mid-flight: under SwiftShader one real frame can eat the whole window.
 * Nothing here wants mid-fade -- the subject is the pose and the charring
 * after everything has come to rest -- so this drives `step(20)`, waits out the
 * fade in wall-clock time, and then pumps a few explicit frames in case rAF is
 * being throttled (the standing hazard: a frame-driven read in a hidden tab
 * comes back stale with no error).
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

/** The zoom band `main.ts` clamps the camera to is 0.35-2.5; these are the two
 *  ends the spec names, and the lead judges the sheet at both. */
const ZOOMS = [1.6, 2.2] as const;

/**
 * The eleven, and where each one stands.
 *
 * Rows 0-7 of `beit_sahwan_outskirts` are open ground end to end -- no cover,
 * no buildings, no decor families -- which is why the line is up there and not
 * beside the assembly marker. Two rows, 6 tiles apart along x, offset so no
 * two vehicles land on top of each other in SCREEN space: a tile step is
 * `(32, 16)` px before zoom, so 6 tiles is 422 px across at 2.2 and 307 at
 * 1.6, against a vehicle about 250 px long at 1.6. Neighbours are in frame and
 * are meant to be.
 */
const PARADE: readonly (readonly [string, number, number])[] = [
  ['mbt_lavi', 3, 2],
  ['ifv_namer', 9, 2],
  ['apc_eitan', 15, 2],
  ['apc_kipod', 21, 2],
  ['dozer_d9', 27, 2],
  ['jeep_shoded', 33, 2],
  ['scout_shachaf', 6, 6],
  ['technical', 12, 6],
  ['rocket_battery', 18, 6],
  ['heli_peten', 24, 6],
  ['paramotor', 30, 6],
];

interface LionsWindow {
  __lions: {
    step(n: number): number;
    units(side?: number): { id: number; type: string; x: number; y: number }[];
    renderer: { camera: { x: number; y: number; zoom: number }; frame(a: number, dt: number): void };
    sim: {
      unitTypes: { id: string }[];
      entityCount: number;
      state: { alive: Int8Array | Uint8Array; typeIdx: Int32Array | Uint16Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      debugKill(id: number): void;
    };
  };
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = positional[0] ?? 'http://127.0.0.1:5178';
const out = positional[1] ?? '.superpowers/wreck-captures';
/** One id only, for a one-off comparison (the lighter charred tint). */
const only = arg('only', '');
/** Appended to every filename, so a variant run cannot overwrite the sheet. */
const tag = arg('tag', '');

fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page: Page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('no mesh queued') || text.includes('[lions]')) console.log('  page:', text);
});

async function boot(url: string): Promise<void> {
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, {
    timeout: 60000,
  });
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
  await page.waitForTimeout(500);
}

/** Pump presentation frames by hand. Belt and braces against a throttled rAF:
 *  everything here is read off a frame, and a stale one reports no error. */
async function frames(n: number): Promise<void> {
  await page.evaluate((count) => {
    const r = (window as unknown as LionsWindow).__lions.renderer;
    for (let i = 0; i < count; i++) r.frame(1, 1000 / 60);
  }, n);
}

async function shot(name: string): Promise<void> {
  const file = path.join(out, `${name}${tag}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file);
}

/** Place the eleven on the northern band as side 0, and return what landed. */
async function parade(): Promise<{ id: string; entity: number }[]> {
  return page.evaluate((placements) => {
    const L = (window as unknown as LionsWindow).__lions;
    // Q16.16: `Sim.spawn` takes fixed-point tiles, and a raw tile number
    // reaches it as 5/65536 of a tile -- i.e. the map's corner, silently.
    const FIXED = 65536;
    const placed: { id: string; entity: number }[] = [];
    for (const [id, x, y] of placements) {
      const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === id);
      if (typeIdx < 0) throw new Error(`no unit type "${id}" in this build`);
      placed.push({ id, entity: L.sim.spawn(typeIdx, 0, x * FIXED, y * FIXED) });
    }
    return placed;
  }, PARADE.map(([id, x, y]) => [id, x, y] as [string, number, number]));
}

console.log(`base ${base}, out ${out}${only ? `, only ${only}` : ''}${tag ? `, tag ${tag}` : ''}`);
await boot('/?sandbox=beit_sahwan_outskirts&sur');

const placed = await parade();
console.log('spawned', placed.map((p) => `${p.id}#${p.entity}`).join(' '));

// A second of ticks, which is what arms `main.ts`'s 1 Hz roster sweep, then
// time for the two unrostered GLBs to arrive over the wire.
await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(20));
await page.waitForTimeout(6000);
await frames(4);

const wanted = only ? PARADE.filter(([id]) => id === only) : PARADE;
if (wanted.length === 0) throw new Error(`--only=${only} names no vehicle in the parade`);

for (const [id, x, y] of wanted) {
  const entity = placed.find((p) => p.id === id)?.entity;
  if (entity === undefined) throw new Error(`${id} was never spawned`);

  for (const zoom of ZOOMS) {
    await cam(x, y, zoom);
    await frames(2);
    await shot(`${id}-live-${zoom}`);
  }

  await page.evaluate((e) => (window as unknown as LionsWindow).__lions.sim.debugKill(e), entity);
  // Past the 0.4 s fade and the held `wreck` clip, then settled. `step` runs
  // the ticks; the wall-clock wait and the hand-driven frames are what carry
  // the PRESENTATION clock the fade is on.
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(20));
  await page.waitForTimeout(1200);
  await frames(6);

  for (const zoom of ZOOMS) {
    await cam(x, y, zoom);
    await frames(2);
    await shot(`${id}-wreck-${zoom}`);
  }
}

await browser.close();
console.log(`done -- ${wanted.length * 4} PNG(s) under ${out}`);
