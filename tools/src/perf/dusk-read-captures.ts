/**
 * GH-1403, "Make dusk read as well as day": the before/after capture instrument for the dusk figure read
 * (`packages/render/src/three/dusk-read.ts`, `RendererOptions.duskRead`, the app's `&duskread`).
 *
 * One browser, three pages, the SAME scene on each: Wadi Halam IV's map (the audit's dusk frame 07) in the sandbox, every
 * sandbox unit teleported to the far corners, then a mixed group spawned on the open ground north of the village, three
 * friendly teams against three hostile ones about six tiles apart, one of each PINNED by the sim's own `debugSuppress`
 * (the sandbox hook, through `applySuppression`: the pinned flag and the huddle are the sim's and the renderer's own, never
 * a written column). The pages:
 *   - `day`         `&tod=day`, the reference ("dusk reads no worse than day");
 *   - `dusk-before` `&tod=dusk`, today's dusk (no dusk read material exists: `debugDuskRead().built` must be false);
 *   - `dusk-after`  `&tod=dusk&duskread`, the read at its shipped numbers, then a sweep of its knobs on the SAME frame
 *                   (`debugSetDuskRead`, repaint at zero elapsed time), the neutral arm (1, 1, 0) first.
 * The sim is deterministic, so every page reaches the same tick with the same units in the same places; the FRAME clock
 * (clip blends, gait phase) is not, so a cross-page A/B can differ in a pose. The exact control is inside `dusk-after`:
 * its neutral arm is the same frame with the read turned off.
 *
 * Run against a dev server YOU started from this worktree (never 5177), on the real Metal GPU, music off, one browser:
 *
 *   cd tools && npx tsx src/perf/dusk-read-captures.ts --port=<n> --attach [--out=<dir>]
 *
 * Then it measures each squad's figure against the ground behind it (`wet-readability.ts`, CIEDE2000, floor 15.6) and
 * writes `report.txt` beside the frames. On `dusk-after` the figure mask is the pixels the exposure moves (neutral against
 * exposure 4), so it holds figure pixels only; on `day` and `dusk-before` it is units shown against units hidden, which
 * also takes in each unit's own shadow (said in the report).
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { FREEZE_FRAME_LOOP_SCRIPT } from '../golden-diff/capture-protocol';
import { readUnmaskedRenderer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { requireAttach } from '../ui-review/port';
import { READABILITY_FLOOR, figureMask, maskSize, readability, type Frame } from './wet-readability';

const args = process.argv.slice(2);
const arg = (k: string, d: string): string => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '0'));
if (!PORT) throw new Error('--port=<n> is required (your own dev server; 5177 is the lead’s)');
if (PORT === 5177) throw new Error('5177 is the lead’s dev server');
await requireAttach('dusk-read', [PORT]);
const OUT = path.resolve(arg('out', '../.superpowers/gh1403'));
const ZOOM = Number(arg('zoom', '1'));
const VIEWPORT = { width: 1600, height: 900 } as const;
fs.mkdirSync(OUT, { recursive: true });

const MAP = 'wadi_halam_4';
/** Ticks from the spawn to the suppression, then to the capture: an ABSOLUTE schedule, the same on every page. */
const FIGHT_TICKS = 40;
const SETTLE_TICKS = 2;
/** 1.0 suppression: over PIN_AT 0.70, and it decays under UNPIN_AT 0.45 only after about 100 ticks. */
const SUPPRESS = 65536;
/** Frame-clock time for the pinned clip's blend, after the last tick. */
const BLEND_MS = 900;
const CAMERA: readonly [number, number] = [21.5, 9.5];

interface Placement {
  readonly name: string;
  readonly type: string;
  readonly side: 0 | 1;
  readonly at: readonly [number, number];
  readonly pin: boolean;
}

/** The group: friendly (side 0) west, hostile (side 1) east; the pinned friendly sits in the long dusk shadow of the
 *  houses at (15-17, 11-13) (the wounded instrument's `own-shadow` spot), the pinned hostile on lit grass. */
const GROUP: readonly Placement[] = [
  { name: 'own-rifles', type: 'inf_squad', side: 0, at: [20.5, 10.5], pin: false },
  { name: 'own-pinned', type: 'inf_squad', side: 0, at: [17.5, 9.2], pin: true },
  { name: 'own-at', type: 'at_team', side: 0, at: [19.5, 7.0], pin: false },
  { name: 'foe-militia', type: 'militia_cell', side: 1, at: [26.5, 7.5], pin: false },
  { name: 'foe-pinned', type: 'militia_cell', side: 1, at: [25.5, 9.8], pin: true },
  { name: 'foe-rpg', type: 'rpg_team', side: 1, at: [24.5, 12.0], pin: false },
];

interface Arm {
  readonly name: string;
  readonly exposure: number;
  readonly contrast: number;
  readonly rimGain: number;
}
const ARMS: readonly Arm[] = [
  { name: 'neutral', exposure: 1, contrast: 1, rimGain: 0 },
  { name: 'e1.5', exposure: 1.5, contrast: 1, rimGain: 0 },
  { name: 'e2', exposure: 2, contrast: 1, rimGain: 0 },
  { name: 'e2.5', exposure: 2.5, contrast: 1, rimGain: 0 },
  { name: 'e3', exposure: 3, contrast: 1, rimGain: 0 },
  { name: 'e2-c1.2', exposure: 2, contrast: 1.2, rimGain: 0 },
  { name: 'e2-rim0.4', exposure: 2, contrast: 1, rimGain: 0.4 },
  { name: 'mask-e4', exposure: 4, contrast: 1, rimGain: 0 },
];

interface PageSpec {
  readonly id: string;
  readonly flags: string;
  readonly duskRead: boolean;
}
const PAGES: readonly PageSpec[] = [
  { id: 'day', flags: '&tod=day', duskRead: false },
  { id: 'dusk-before', flags: '&tod=dusk', duskRead: false },
  { id: 'dusk-after', flags: '&tod=dusk&duskread', duskRead: true },
];

interface Read {
  rimGain: number;
  rimPower: number;
  exposure: number;
  contrast: number;
  built: boolean;
}
interface L {
  step(n: number): number;
  sel(ids: number[]): number[];
  renderer: {
    camera: { x: number; y: number; zoom: number };
    frame(alpha: number, dtMs: number): void;
    worldToScreen(x: number, y: number): { x: number; y: number };
    setDebugLayerVisible(name: string, visible: boolean): number;
    meshUnitEntities: Map<number, { actions: Map<string, unknown> }>;
    selection: number[];
    debugSetDuskRead(p: { rimGain: number; rimPower: number; exposure: number; contrast: number }): void;
    debugDuskRead(): Read;
  };
  sim: {
    tickCount: number;
    width: number;
    height: number;
    blocked: Uint8Array;
    unitTypes: { id: string }[];
    state: { alive: Uint8Array; side: Uint8Array; pinned: Uint8Array; posX: Int32Array; posY: Int32Array; hp: Int32Array };
    spawn(typeIdx: number, side: number, x: number, y: number): number;
    teleport(id: number, x: number, y: number): void;
    debugSuppress(id: number, amount: number): void;
  };
}
type W = { __lions: L };

interface Meta {
  page: string;
  gpu: string;
  viewport: typeof VIEWPORT;
  zoom: number;
  camera: readonly [number, number];
  tick: number;
  read: Read;
  squads: { name: string; id: number; side: number; pinned: number; alive: number; sx: number; sy: number }[];
  repaintIdentical?: boolean;
}

async function open(page: Page, flags: string): Promise<number> {
  await page.goto(`http://localhost:${PORT}/?sandbox=${MAP}${flags}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as W).__lions?.renderer);
  const frozen = JSON.parse((await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT)) as string) as { tick: number };
  return frozen.tick;
}

/** Every unit the sandbox placed, out of the scene: side 0 to the east edge, every other side to the south-west corner,
 *  on open tiles, 30+ tiles from the group and from each other. A scene-setting shortcut (`teleport`, the sandbox hook). */
async function clearStage(page: Page): Promise<number> {
  return page.evaluate(() => {
    const L = (window as unknown as W).__lions;
    const { width, height, blocked } = L.sim;
    const st = L.sim.state;
    const openNear = (x0: number, y0: number, k: number): [number, number] => {
      let n = 0;
      for (let r = 0; r < 12; r++) {
        for (let y = Math.max(0, y0 - r); y <= Math.min(height - 1, y0 + r); y++) {
          for (let x = Math.max(0, x0 - r); x <= Math.min(width - 1, x0 + r); x++) {
            if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) !== r || blocked[y * width + x] !== 0) continue;
            if (n++ === k) return [x + 0.5, y + 0.5];
          }
        }
      }
      return [x0 + 0.5, y0 + 0.5];
    };
    let own = 0;
    let other = 0;
    let moved = 0;
    for (let i = 0; i < st.alive.length; i++) {
      if (st.alive[i] !== 1) continue;
      const [x, y] = st.side[i] === 0 ? openNear(45, 30, own++) : openNear(2, 45, other++);
      L.sim.teleport(i, Math.round(x * 65536), Math.round(y * 65536));
      moved++;
    }
    return moved;
  });
}

async function spawnGroup(page: Page): Promise<number[]> {
  return page.evaluate((group) => {
    const L = (window as unknown as W).__lions;
    return group.map((g) => {
      const idx = L.sim.unitTypes.findIndex((u) => u.id === g.type);
      if (idx < 0) throw new Error(`no unit type ${g.type}`);
      return L.sim.spawn(idx, g.side, Math.round(g.at[0] * 65536), Math.round(g.at[1] * 65536));
    });
  }, GROUP as unknown as Placement[]);
}

async function waitMeshes(page: Page, ids: number[]): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const missing = await page.evaluate((want) => {
      const L = (window as unknown as W).__lions;
      L.renderer.frame(1, 16);
      return want.filter((id) => {
        const e = L.renderer.meshUnitEntities.get(id);
        return !e || e.actions.size === 0;
      });
    }, ids);
    if (missing.length === 0) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`meshes never arrived for ${ids.join(',')}`);
}

async function stepTo(page: Page, tick: number): Promise<void> {
  await page.evaluate((t) => {
    const L = (window as unknown as W).__lions;
    if (L.sim.tickCount > t) throw new Error(`already past tick ${t} (at ${L.sim.tickCount})`);
    while (L.sim.tickCount < t) L.step(1);
  }, tick);
}

async function shoot(page: Page, name: string): Promise<string> {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  saved', path.relative(process.cwd(), file));
  return file;
}

async function setArm(page: Page, a: Arm): Promise<Read> {
  return page.evaluate((arm) => {
    const r = (window as unknown as W).__lions.renderer;
    r.debugSetDuskRead({ rimGain: arm.rimGain, rimPower: 3, exposure: arm.exposure, contrast: arm.contrast });
    r.frame(1, 0);
    return r.debugDuskRead();
  }, a as unknown as Arm);
}

function load(file: string): Frame {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

async function runPage(page: Page, spec: PageSpec, gpu: string): Promise<Meta> {
  console.log(`page ${spec.id}`);
  const t0 = await open(page, spec.flags);
  const moved = await clearStage(page);
  const ids = await spawnGroup(page);
  console.log(`  frozen at tick ${t0}; ${moved} sandbox units cleared; group ${ids.join(',')}`);
  await page.evaluate(() => (window as unknown as W).__lions.step(1));
  await waitMeshes(page, ids);
  const pinAt = t0 + 1 + FIGHT_TICKS;
  await stepTo(page, pinAt);
  await page.evaluate(
    ([all, amount]) => {
      const L = (window as unknown as W).__lions;
      for (const id of all as number[]) L.sim.debugSuppress(id, amount as number);
    },
    [ids.filter((_, k) => GROUP[k].pin), SUPPRESS] as const
  );
  const tick = pinAt + SETTLE_TICKS;
  await stepTo(page, tick);
  await page.evaluate((ms) => {
    const L = (window as unknown as W).__lions;
    L.sel([]);
    for (let done = 0; done < ms; done += 16) L.renderer.frame(1, 16);
  }, BLEND_MS);
  const squads = await page.evaluate(
    ([all, cam, z]) => {
      const L = (window as unknown as W).__lions;
      const c = L.renderer.camera;
      c.x = (cam as readonly number[])[0];
      c.y = (cam as readonly number[])[1];
      c.zoom = z as number;
      L.renderer.frame(1, 0);
      const st = L.sim.state;
      return (all as number[]).map((id) => {
        const p = L.renderer.worldToScreen(st.posX[id] / 65536, st.posY[id] / 65536);
        return { id, side: st.side[id], pinned: st.pinned[id], alive: st.alive[id], sx: p.x, sy: p.y };
      });
    },
    [ids, CAMERA, ZOOM] as const
  );
  const selection = await page.evaluate(() => (window as unknown as W).__lions.renderer.selection.length);
  if (selection !== 0) throw new Error(`${spec.id}: ${selection} units selected; a capture must have none`);
  for (const [k, s] of squads.entries()) {
    const g = GROUP[k];
    if (s.alive !== 1) throw new Error(`${spec.id}: ${g.name} is dead at tick ${tick}`);
    if (g.pin && s.pinned !== 1) throw new Error(`${spec.id}: ${g.name} was suppressed but is not pinned at tick ${tick}`);
  }
  const read = await page.evaluate(() => (window as unknown as W).__lions.renderer.debugDuskRead());
  if (read.built !== spec.duskRead) throw new Error(`${spec.id}: debugDuskRead().built is ${read.built}, wanted ${spec.duskRead}`);
  console.log(`  tick ${tick}; read ${JSON.stringify(read)}; pinned ${squads.map((s) => s.pinned).join('')}`);
  const meta: Meta = {
    page: spec.id,
    gpu,
    viewport: VIEWPORT,
    zoom: ZOOM,
    camera: CAMERA,
    tick,
    read,
    squads: squads.map((s, k) => ({ name: GROUP[k].name, ...s })),
  };
  const first = await shoot(page, `${spec.id}`);
  if (spec.duskRead) {
    const shipped: Arm = { name: 'shipped', exposure: read.exposure, contrast: read.contrast, rimGain: read.rimGain };
    for (const a of ARMS) {
      const got = await setArm(page, a);
      if (got.exposure !== a.exposure || got.contrast !== a.contrast || got.rimGain !== a.rimGain) {
        throw new Error(`arm ${a.name}: the shaders read ${JSON.stringify(got)}`);
      }
      await shoot(page, `${spec.id}-${a.name}`);
    }
    await setArm(page, shipped);
    const again = await shoot(page, `${spec.id}-repaint`);
    meta.repaintIdentical = Buffer.compare(fs.readFileSync(first), fs.readFileSync(again)) === 0;
    console.log(`  repaint control (shipped arm, first vs last): ${meta.repaintIdentical ? 'identical' : 'DIFFERS'}`);
  }
  const hiddenN = await page.evaluate(() => {
    const r = (window as unknown as W).__lions.renderer;
    const n = r.setDebugLayerVisible('units', false);
    r.frame(1, 0);
    return n;
  });
  await shoot(page, `${spec.id}-units-hidden`);
  await page.evaluate(() => {
    const r = (window as unknown as W).__lions.renderer;
    r.setDebugLayerVisible('units', true);
    r.frame(1, 0);
  });
  console.log(`  units layer hid ${hiddenN}`);
  return meta;
}

const MASK_RADIUS_PX = 70;

function report(metas: Meta[]): string {
  const lines: string[] = [];
  const f = (n: number): string => n.toFixed(1).padStart(5);
  lines.push('GH-1403 dusk read: each squad\'s figure against the ground behind it (CIEDE2000; wet-readability.ts).');
  lines.push(`share = figure pixels at dE >= ${READABILITY_FLOOR} against the pixel behind them; median = per-pixel median dE;`);
  lines.push('mean = the figure\'s mean colour against the ground ring around it.');
  for (const m of metas) {
    lines.push('');
    lines.push(`${m.page}: tick ${m.tick}, zoom ${m.zoom}, camera ${m.camera.join(',')}, ${m.viewport.width}x${m.viewport.height}, ${m.gpu}`);
    const hidden = load(path.join(OUT, `${m.page}-units-hidden.png`));
    const arms = m.page === 'dusk-after' ? ARMS.filter((a) => a.name !== 'mask-e4').map((a) => `${m.page}-${a.name}`) : [m.page];
    const maskNote = m.page === 'dusk-after' ? 'mask: neutral vs exposure 4 (figure pixels only)' : 'mask: units shown vs hidden (includes the unit\'s own shadow)';
    lines.push(`  ${maskNote}`);
    lines.push(`  ${'squad'.padEnd(12)} ${'frame'.padEnd(22)} share median  mean   px`);
    for (const s of m.squads) {
      const mask =
        m.page === 'dusk-after'
          ? figureMask(load(path.join(OUT, `${m.page}-neutral.png`)), load(path.join(OUT, `${m.page}-mask-e4.png`)), s.sx, s.sy - 10, MASK_RADIUS_PX)
          : figureMask(load(path.join(OUT, `${m.page}.png`)), hidden, s.sx, s.sy - 10, MASK_RADIUS_PX);
      if (maskSize(mask) === 0) {
        lines.push(`  ${s.name.padEnd(12)} (empty mask)`);
        continue;
      }
      for (const frame of arms) {
        const r = readability(load(path.join(OUT, `${frame}.png`)), hidden, mask);
        lines.push(`  ${s.name.padEnd(12)} ${frame.replace(`${m.page}-`, '').padEnd(22)} ${f(100 * r.shareAboveFloor)}% ${f(r.perPixelMedian)} ${f(r.mean)} ${String(r.pixels).padStart(5)}`);
      }
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
  });
  const metas: Meta[] = [];
  try {
    const gpu = await readUnmaskedRenderer(browser);
    console.log('GPU:', gpu);
    if (!/metal|apple/i.test(gpu)) throw new Error(`not a Metal GPU: ${gpu}`);
    for (const spec of PAGES) {
      const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
      await page.addInitScript(musicOffInitScript());
      // tsx's keepNames wraps inner functions in `__name`, which a serialised evaluate callback lacks.
      await page.addInitScript('window.__name = (f) => f;');
      page.setDefaultTimeout(180000);
      page.on('pageerror', (e) => console.log('  page error:', e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') console.log('  console error:', m.text().slice(0, 200));
      });
      metas.push(await runPage(page, spec, gpu));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(metas, null, 2));
  const text = report(metas);
  fs.writeFileSync(path.join(OUT, 'report.txt'), text + '\n');
  console.log(text);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
