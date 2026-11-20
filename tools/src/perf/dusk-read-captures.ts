/**
 * GH-1403, "Make dusk read as well as day": the before/after capture instrument for the dusk figure read
 * (`packages/render/src/three/dusk-read.ts`, `RendererOptions.duskRead`, the app's `&duskread`).
 *
 * One browser, three pages, the SAME scene on each: Wadi Halam IV's map (the audit's dusk frame 07) in the sandbox. At an
 * ABSOLUTE tick (`START_TICK`) every sandbox unit is teleported to the far corners and a mixed group is spawned north of the
 * village: two friendly rifle squads and two friendly spotters (`recon_zikit`: sight 14, carbines 6) in the west, three
 * hostile teams in the east, every friendly at least `MIN_GAP` tiles from every hostile, which is past every weapon either
 * side has here (rifles 8, militia 7, RPG 5, carbines 6). So the sides SEE each other (the spotters identify the hostiles,
 * which the renderer then draws) but nobody fires: no tracer, burst, smoke or wound moves the frame, and a repaint at zero
 * elapsed time must be byte-identical (the control, printed per page and per zoom). One squad on each side is PINNED by the
 * sim's own `debugSuppress` (the sandbox hook, through `applySuppression`): the pinned flag and the huddle are the sim's and
 * the renderer's own, never a written column. The pinned friendly sits in the long dusk shadow of the houses at (15-17,
 * 11-13), the pinned hostile on lit grass, each beside an unpinned squad of its own side.
 *
 * The pages:
 *   - `day`         `&tod=day`, the reference ("dusk reads no worse than day");
 *   - `dusk-before` `&tod=dusk`, today's dusk (no dusk read material exists: `debugDuskRead().built` must be false);
 *   - `dusk-after`  `&tod=dusk&duskread`, the read at its shipped numbers, then a sweep of its knobs on the SAME frame
 *                   (`debugSetDuskRead`, repaint at zero elapsed time), the neutral arm (1, 1, 0) first.
 * Ticks are absolute and identical on every page: the first page finds the tick the spotters have identified every hostile
 * (`contactLevel === 2`), and every later page steps to that same tick and asserts the same facts there. The frame clock is
 * advanced by the same calls on every page too (meshes are waited for with zero-elapsed frames), so poses should match
 * across pages; the exact control is still inside `dusk-after`, whose neutral arm is the same frame with the read off.
 *
 * Run against a dev server YOU started from this worktree (never 5177), on the real Metal GPU, music off, one browser:
 *
 *   cd tools && npx tsx src/perf/dusk-read-captures.ts --port=<n> --attach [--out=<dir>]
 *   cd tools && npx tsx src/perf/dusk-read-captures.ts --report-only [--out=<dir>]   (re-reads meta.json and the frames)
 *
 * Then it measures each squad's figure against the ground behind it (`wet-readability.ts`, CIEDE2000, floor 15.6), writes
 * `report.txt`, and builds the A/B sheets (`sheet-z<zoom>.png`: day / dusk today / dusk with the read / dusk with the read
 * plus the rim, cropped to the group). On `dusk-after` the figure mask is the pixels the exposure moves (neutral against
 * exposure 4) minus any pixel the repaint control saw move; on `day` and `dusk-before` it is units shown against units
 * hidden, which also takes in each unit's own shadow (said in the report).
 *
 * History: the first run (19 Nov 2026) put the sides inside weapon range on a relative tick schedule; a missile, a burst and
 * a wounded man landed in the group and the repaint control differed by 2,912 px. This layout is the fix.
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
const REPORT_ONLY = args.includes('--report-only');
const PORT = Number(arg('port', '0'));
if (!REPORT_ONLY) {
  if (!PORT) throw new Error('--port=<n> is required (your own dev server; 5177 is the lead’s)');
  if (PORT === 5177) throw new Error('5177 is the lead’s dev server');
  await requireAttach('dusk-read', [PORT]);
}
const OUT = path.resolve(arg('out', '../.superpowers/gh1403'));
const VIEWPORT = { width: 1600, height: 900 } as const;
const ZOOMS: readonly number[] = [1, 1.6];
fs.mkdirSync(OUT, { recursive: true });

const MAP = 'wadi_halam_4';
/** The absolute tick the stage is cleared and the group spawned at, on every page. */
const START_TICK = 2;
/** The spotters must identify every hostile by the first page's search, between these ticks. */
const OBSERVE_MIN = 40;
const OBSERVE_MAX = 900;
/** Ticks from the suppression to the capture. */
const SETTLE_TICKS = 2;
/** 1.0 suppression: over PIN_AT 0.70, and it decays under UNPIN_AT 0.45 only after about 100 ticks. */
const SUPPRESS = 65536;
/** Frame-clock time for the pinned clip's blend, after the last tick. */
const BLEND_MS = 900;
const CAMERA: readonly [number, number] = [23.5, 9.2];
/** Every friendly at least this far from every hostile: past rifles 8, militia 7, RPG 5 and carbines 6. */
const MIN_GAP = 9.5;

interface Placement {
  readonly name: string;
  readonly type: string;
  readonly side: 0 | 1;
  readonly at: readonly [number, number];
  readonly pin: boolean;
}

const GROUP: readonly Placement[] = [
  { name: 'own-rifles', type: 'inf_squad', side: 0, at: [19.5, 10.8], pin: false },
  { name: 'own-pinned', type: 'inf_squad', side: 0, at: [17.5, 9.2], pin: true },
  { name: 'own-spotter', type: 'recon_zikit', side: 0, at: [19.0, 7.6], pin: false },
  { name: 'own-spotter2', type: 'recon_zikit', side: 0, at: [17.0, 6.6], pin: false },
  { name: 'foe-militia', type: 'militia_cell', side: 1, at: [29.5, 6.6], pin: false },
  { name: 'foe-pinned', type: 'militia_cell', side: 1, at: [29.2, 8.9], pin: true },
  { name: 'foe-rpg', type: 'rpg_team', side: 1, at: [29.6, 11.2], pin: false },
];

/** The layout is checked BEFORE a browser is opened: a gap under MIN_GAP is a fight, and the run is refused. */
function minGap(): number {
  let best = Infinity;
  for (const a of GROUP) {
    for (const b of GROUP) {
      if (a.side === b.side) continue;
      best = Math.min(best, Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]));
    }
  }
  return best;
}

interface Arm {
  readonly name: string;
  readonly exposure: number;
  readonly contrast: number;
  readonly rimGain: number;
}
const ARMS: readonly Arm[] = [
  { name: 'neutral', exposure: 1, contrast: 1, rimGain: 0 },
  { name: 'e2', exposure: 2, contrast: 1, rimGain: 0 },
  { name: 'e2-rim0.4', exposure: 2, contrast: 1, rimGain: 0.4 },
  { name: 'e1-rim0.4', exposure: 1, contrast: 1, rimGain: 0.4 },
  { name: 'e2-rim0.6', exposure: 2, contrast: 1, rimGain: 0.6 },
  { name: 'e2.5-rim0.4', exposure: 2.5, contrast: 1, rimGain: 0.4 },
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
    meshUnitEntities: Map<number, { actions: Map<string, unknown>; currentClip: string | null }>;
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
    state: {
      alive: Uint8Array;
      side: Uint8Array;
      pinned: Uint8Array;
      posX: Int32Array;
      posY: Int32Array;
      hp: Int32Array;
      curTarget: Int32Array;
    };
    spawn(typeIdx: number, side: number, x: number, y: number): number;
    teleport(id: number, x: number, y: number): void;
    debugSuppress(id: number, amount: number): void;
    contactLevel(side: number, target: number): number;
  };
}
type W = { __lions: L };

interface Squad {
  name: string;
  id: number;
  side: number;
  pinned: number;
  alive: number;
  hp: number;
  hpAtSpawn: number;
  target: number;
  moved: number;
  clip: string | null;
  contact: number;
}
interface ZoomShot {
  zoom: number;
  squads: { name: string; sx: number; sy: number }[];
  repaintIdentical: boolean;
}
interface Meta {
  page: string;
  gpu: string;
  viewport: typeof VIEWPORT;
  camera: readonly [number, number];
  tick: number;
  read: Read;
  squads: Squad[];
  shots: ZoomShot[];
}

async function open(page: Page, flags: string): Promise<number> {
  await page.goto(`http://localhost:${PORT}/?sandbox=${MAP}${flags}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as W).__lions?.renderer);
  const frozen = JSON.parse((await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT)) as string) as { tick: number };
  return frozen.tick;
}

async function stepTo(page: Page, tick: number): Promise<void> {
  await page.evaluate((t) => {
    const L = (window as unknown as W).__lions;
    if (L.sim.tickCount > t) throw new Error(`already past tick ${t} (at ${L.sim.tickCount})`);
    while (L.sim.tickCount < t) L.step(1);
  }, tick);
}

/** Every unit the sandbox placed, out of the scene: side 0 to the east edge, every other side to the south-west corner,
 *  on open tiles, 25+ tiles from the group and 40+ from each other. A scene-setting shortcut (`teleport`, the sandbox hook). */
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
      const [x, y] = st.side[i] === 0 ? openNear(45, 34, own++) : openNear(2, 45, other++);
      L.sim.teleport(i, Math.round(x * 65536), Math.round(y * 65536));
      moved++;
    }
    return moved;
  });
}

async function spawnGroup(page: Page): Promise<{ ids: number[]; hp: number[] }> {
  return page.evaluate((group) => {
    const L = (window as unknown as W).__lions;
    const ids = group.map((g) => {
      const idx = L.sim.unitTypes.findIndex((u) => u.id === g.type);
      if (idx < 0) throw new Error(`no unit type ${g.type}`);
      return L.sim.spawn(idx, g.side, Math.round(g.at[0] * 65536), Math.round(g.at[1] * 65536));
    });
    return { ids, hp: ids.map((id) => L.sim.state.hp[id]) };
  }, GROUP as unknown as Placement[]);
}

/** Waits for every mesh with ZERO-elapsed frames, so the frame clock is the same on every page whatever the load time. */
async function waitMeshes(page: Page, ids: number[]): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const missing = await page.evaluate((want) => {
      const L = (window as unknown as W).__lions;
      L.renderer.frame(1, 0);
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

/** The first tick at or after `from` at which side 0 has identified every hostile in the group (or -1 by `to`). */
async function identifiedTick(page: Page, foes: number[], from: number, to: number): Promise<number> {
  return page.evaluate(
    ([f, a, b]) => {
      const L = (window as unknown as W).__lions;
      while (L.sim.tickCount < (a as number)) L.step(1);
      while (L.sim.tickCount <= (b as number)) {
        if ((f as number[]).every((id) => L.sim.contactLevel(0, id) === 2)) return L.sim.tickCount;
        L.step(1);
      }
      return -1;
    },
    [foes, from, to] as const
  );
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

function same(a: string, b: string): boolean {
  return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
}

/** The tick every page captures at: found by the first page, reused by the rest. */
let captureTick = -1;

async function runPage(page: Page, spec: PageSpec, gpu: string): Promise<Meta> {
  console.log(`page ${spec.id}`);
  const t0 = await open(page, spec.flags);
  await stepTo(page, START_TICK);
  const moved = await clearStage(page);
  const { ids, hp } = await spawnGroup(page);
  console.log(`  frozen at tick ${t0}, cleared ${moved} sandbox units at ${START_TICK}; group ${ids.join(',')}`);
  await page.evaluate(() => (window as unknown as W).__lions.step(1));
  await waitMeshes(page, ids);
  const foes = ids.filter((_, k) => GROUP[k].side === 1);
  let pinAt: number;
  if (captureTick < 0) {
    pinAt = await identifiedTick(page, foes, START_TICK + OBSERVE_MIN, OBSERVE_MAX);
    if (pinAt < 0) throw new Error(`${spec.id}: the spotters had not identified every hostile by tick ${OBSERVE_MAX}`);
    captureTick = pinAt + SETTLE_TICKS;
    console.log(`  every hostile identified at tick ${pinAt}; capture tick ${captureTick} on every page`);
  } else {
    pinAt = captureTick - SETTLE_TICKS;
    await stepTo(page, pinAt);
  }
  await page.evaluate(
    ([all, amount]) => {
      const L = (window as unknown as W).__lions;
      for (const id of all as number[]) L.sim.debugSuppress(id, amount as number);
    },
    [ids.filter((_, k) => GROUP[k].pin), SUPPRESS] as const
  );
  await stepTo(page, captureTick);
  await page.evaluate((ms) => {
    const L = (window as unknown as W).__lions;
    L.sel([]);
    for (let done = 0; done < ms; done += 16) L.renderer.frame(1, 16);
  }, BLEND_MS);
  const squads = (
    await page.evaluate(
      ([all, hp0, at]) => {
        const L = (window as unknown as W).__lions;
        const st = L.sim.state;
        return (all as number[]).map((id, k) => ({
          id,
          side: st.side[id],
          pinned: st.pinned[id],
          alive: st.alive[id],
          hp: st.hp[id],
          hpAtSpawn: (hp0 as number[])[k],
          target: st.curTarget[id],
          moved: Math.hypot(st.posX[id] / 65536 - (at as number[][])[k][0], st.posY[id] / 65536 - (at as number[][])[k][1]),
          clip: L.renderer.meshUnitEntities.get(id)?.currentClip ?? null,
          contact: L.sim.contactLevel(0, id),
        }));
      },
      [ids, hp, GROUP.map((g) => [...g.at])] as const
    )
  ).map((s, k) => ({ name: GROUP[k].name, ...s }));
  const selection = await page.evaluate(() => (window as unknown as W).__lions.renderer.selection.length);
  if (selection !== 0) throw new Error(`${spec.id}: ${selection} units selected; a capture must have none`);
  for (const [k, s] of squads.entries()) {
    const g = GROUP[k];
    if (s.alive !== 1) throw new Error(`${spec.id}: ${g.name} is dead at tick ${captureTick}`);
    if (g.pin && s.pinned !== 1) throw new Error(`${spec.id}: ${g.name} was suppressed but is not pinned at tick ${captureTick}`);
    if (!g.pin && s.pinned !== 0) console.log(`  WARNING ${g.name} is pinned and was not suppressed`);
    if (g.side === 1 && s.contact !== 2) throw new Error(`${spec.id}: ${g.name} is not identified by side 0 at tick ${captureTick}`);
    if (s.hp !== s.hpAtSpawn) console.log(`  WARNING ${g.name} lost hp ${s.hpAtSpawn} -> ${s.hp}: somebody fired`);
    if (s.target >= 0) console.log(`  WARNING ${g.name} has a target (${s.target})`);
  }
  const read = await page.evaluate(() => (window as unknown as W).__lions.renderer.debugDuskRead());
  if (read.built !== spec.duskRead) throw new Error(`${spec.id}: debugDuskRead().built is ${read.built}, wanted ${spec.duskRead}`);
  console.log(`  tick ${captureTick}; read ${JSON.stringify(read)}`);
  for (const s of squads) {
    console.log(`    ${s.name}: pinned ${s.pinned}, clip ${s.clip}, hp ${s.hp}/${s.hpAtSpawn}, target ${s.target}, moved ${s.moved.toFixed(2)}`);
  }
  const meta: Meta = { page: spec.id, gpu, viewport: VIEWPORT, camera: CAMERA, tick: captureTick, read, squads, shots: [] };
  for (const z of ZOOMS) {
    const pos = await page.evaluate(
      ([all, cam, zoom]) => {
        const L = (window as unknown as W).__lions;
        const c = L.renderer.camera;
        c.x = (cam as readonly number[])[0];
        c.y = (cam as readonly number[])[1];
        c.zoom = zoom as number;
        for (let n = 0; n < 3; n++) L.renderer.frame(1, 0);
        const st = L.sim.state;
        return (all as number[]).map((id) => {
          const p = L.renderer.worldToScreen(st.posX[id] / 65536, st.posY[id] / 65536);
          return { sx: p.x, sy: p.y };
        });
      },
      [ids, CAMERA, z] as const
    );
    const tag = `${spec.id}-z${z}`;
    const first = await shoot(page, tag);
    if (spec.duskRead) {
      const shipped: Arm = { name: 'shipped', exposure: read.exposure, contrast: read.contrast, rimGain: read.rimGain };
      for (const a of ARMS) {
        const got = await setArm(page, a);
        if (got.exposure !== a.exposure || got.contrast !== a.contrast || got.rimGain !== a.rimGain) {
          throw new Error(`arm ${a.name}: the shaders read ${JSON.stringify(got)}`);
        }
        await shoot(page, `${tag}-${a.name}`);
      }
      await setArm(page, shipped);
    } else {
      await page.evaluate(() => (window as unknown as W).__lions.renderer.frame(1, 0));
    }
    const again = await shoot(page, `${tag}-repaint`);
    const identical = same(first, again);
    console.log(`  repaint control z${z} (first vs last): ${identical ? 'IDENTICAL (0 px)' : 'DIFFERS'}`);
    await page.evaluate(() => {
      const r = (window as unknown as W).__lions.renderer;
      r.setDebugLayerVisible('units', false);
      r.frame(1, 0);
    });
    await shoot(page, `${tag}-units-hidden`);
    await page.evaluate(() => {
      const r = (window as unknown as W).__lions.renderer;
      r.setDebugLayerVisible('units', true);
      r.frame(1, 0);
    });
    meta.shots.push({ zoom: z, squads: pos.map((p, k) => ({ name: GROUP[k].name, ...p })), repaintIdentical: identical });
  }
  return meta;
}

const MASK_RADIUS_PX = 70;
/** A pixel where the repaint control's two frames differ by more than this in some channel is noise. */
const NOISE_LEVELS = 2;

function diffPixels(a: Frame, b: Frame): Uint8Array {
  const out = new Uint8Array(a.width * a.height);
  for (let i = 0; i < out.length; i++) {
    const d = Math.max(
      Math.abs(a.data[i * 4] - b.data[i * 4]),
      Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]),
      Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2])
    );
    if (d > NOISE_LEVELS) out[i] = 1;
  }
  return out;
}

/** The four-row A/B sheet for one zoom, cropped to the group's screen box plus a margin, scaled by `scale`. */
function sheet(metas: Meta[], zoom: number, scale: number): string {
  const rows = ['day', 'dusk-before', 'dusk-after', 'dusk-after@e2-rim0.4'];
  const after = metas.find((m) => m.page === 'dusk-after');
  const shot = after?.shots.find((s) => s.zoom === zoom);
  if (!shot) throw new Error(`no dusk-after shot at zoom ${zoom}`);
  const xs = shot.squads.map((s) => s.sx);
  const ys = shot.squads.map((s) => s.sy);
  const m = 70 * zoom;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - m));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - m * 1.4));
  const x1 = Math.min(VIEWPORT.width, Math.ceil(Math.max(...xs) + m));
  const y1 = Math.min(VIEWPORT.height, Math.ceil(Math.max(...ys) + m * 0.6));
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new PNG({ width: w * scale, height: (h * scale + 4) * rows.length });
  rows.forEach((row, k) => {
    const [pageId, arm] = row.split('@');
    const src = load(path.join(OUT, `${pageId}-z${zoom}${arm ? `-${arm}` : ''}.png`));
    for (let y = 0; y < h * scale; y++) {
      for (let x = 0; x < w * scale; x++) {
        const si = ((y0 + Math.floor(y / scale)) * src.width + x0 + Math.floor(x / scale)) * 4;
        const di = ((k * (h * scale + 4) + y) * w * scale + x) * 4;
        for (let c = 0; c < 4; c++) out.data[di + c] = src.data[si + c];
      }
    }
  });
  const file = path.join(OUT, `sheet-z${zoom}.png`);
  fs.writeFileSync(file, PNG.sync.write(out));
  return file;
}

function report(metas: Meta[]): string {
  const lines: string[] = [];
  const f = (n: number): string => n.toFixed(1).padStart(5);
  lines.push('GH-1403 dusk read: each squad\'s figure against the ground behind it (CIEDE2000; wet-readability.ts).');
  lines.push(`share = figure pixels at dE >= ${READABILITY_FLOOR} against the pixel behind them; median = per-pixel median dE;`);
  lines.push('mean = the figure\'s mean colour against the ground ring around it.');
  for (const m of metas) {
    lines.push('');
    lines.push(`${m.page}: tick ${m.tick}, camera ${m.camera.join(',')}, ${m.viewport.width}x${m.viewport.height} at DPR 1, ${m.gpu}`);
    lines.push(`  read ${JSON.stringify(m.read)}`);
    for (const s of m.squads) {
      lines.push(
        `  ${s.name}: pinned ${s.pinned}, clip ${s.clip}, hp ${s.hp}/${s.hpAtSpawn}, target ${s.target}, moved ${s.moved.toFixed(2)} t, contact ${s.contact}`
      );
    }
    const after = m.page === 'dusk-after';
    for (const shot of m.shots) {
      const tag = `${m.page}-z${shot.zoom}`;
      const hidden = load(path.join(OUT, `${tag}-units-hidden.png`));
      const noise = diffPixels(load(path.join(OUT, `${tag}.png`)), load(path.join(OUT, `${tag}-repaint.png`)));
      lines.push(
        `  zoom ${shot.zoom}: repaint control ${shot.repaintIdentical ? 'identical (0 px)' : `DIFFERS (${maskSize(noise)} px over ${NOISE_LEVELS} levels)`}`
      );
      lines.push(after ? '  mask: neutral vs exposure 4, minus any pixel the repaint control saw move' : '  mask: units shown vs hidden (includes the unit\'s own shadow)');
      const arms = after ? ARMS.filter((a) => a.name !== 'mask-e4').map((a) => `${tag}-${a.name}`) : [tag];
      lines.push(`  ${'squad'.padEnd(13)} ${'frame'.padEnd(14)} share median  mean   px`);
      for (const s of shot.squads) {
        const mask = after
          ? figureMask(load(path.join(OUT, `${tag}-neutral.png`)), load(path.join(OUT, `${tag}-mask-e4.png`)), s.sx, s.sy - 10 * shot.zoom, MASK_RADIUS_PX * shot.zoom)
          : figureMask(load(path.join(OUT, `${tag}.png`)), hidden, s.sx, s.sy - 10 * shot.zoom, MASK_RADIUS_PX * shot.zoom);
        for (let i = 0; i < mask.length; i++) if (noise[i] === 1) mask[i] = 0;
        if (maskSize(mask) === 0) {
          lines.push(`  ${s.name.padEnd(13)} (empty mask)`);
          continue;
        }
        for (const frame of arms) {
          const r = readability(load(path.join(OUT, `${frame}.png`)), hidden, mask);
          const label = frame === tag ? m.page : frame.replace(`${tag}-`, '');
          lines.push(`  ${s.name.padEnd(13)} ${label.padEnd(14)} ${f(100 * r.shareAboveFloor)}% ${f(r.perPixelMedian)} ${f(r.mean)} ${String(r.pixels).padStart(5)}`);
        }
      }
    }
  }
  lines.push('');
  for (const z of ZOOMS) {
    lines.push(`sheet: ${sheet(metas, z, z === 1 ? 2 : 1)} (day / dusk today / dusk with the read / dusk with the read plus rim 0.4)`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (REPORT_ONLY) {
    const metas = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8')) as Meta[];
    const text = report(metas);
    fs.writeFileSync(path.join(OUT, 'report.txt'), text + '\n');
    console.log(text);
    return;
  }
  const gap = minGap();
  if (gap < MIN_GAP) throw new Error(`the layout puts a friendly ${gap.toFixed(2)} tiles from a hostile (< ${MIN_GAP}): that is a fight`);
  console.log(`layout: closest friendly-hostile pair ${gap.toFixed(2)} tiles`);
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
      try {
        metas.push(await runPage(page, spec, gpu));
      } finally {
        // Whatever came back so far is kept, so a late failure still leaves a usable meta.json.
        fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(metas, null, 2));
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
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
