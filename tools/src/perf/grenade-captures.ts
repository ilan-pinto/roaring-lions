/**
 * The lobbed-grenade motion sheet (GH-709 P2/P3): `inf_grenadier`'s `gl_40`
 * leaving the launcher, flying its short dark arc and landing, judged IN
 * MOTION through a flip page -- never a still.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/grenade-captures.ts --label=after  --port=5243
 *   pnpm --filter @lions/tools exec tsx src/perf/grenade-captures.ts --label=before --port=5243
 *   pnpm grenade:capture -- --label=after --out=glint-after   (any output directory under grenade/)
 *
 * A sibling of `atgm-captures.ts`, with its method (frozen frame loop, the sim
 * stepped in lockstep by hand, subjects spawned, one flip page a subject) and
 * its pure helpers (`lockstepPlan`, `flipHtml`). `--label=before` turns the
 * grenade routing off AT RUNTIME: it empties `LOBBED_WEAPON_IDS` in the page's
 * own `shells.ts` module instance (the Set is mutable at runtime though typed
 * read-only), so `gl_40` falls back to its class and flies as a missile. No
 * tracked file is touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { flipHtml, lockstepPlan } from './atgm-captures';

// ---------------------------------------------------------------------------
// The pure half, imported by the spec. Nothing here may pull in playwright.
// ---------------------------------------------------------------------------

export const GRENADE_WINDOW_MS = 2_500;
export const GRENADE_EVERY_MS = 50;

/** 0..2500 every 50 ms: 51 rungs. A 6-tile shot flies about 0.6 s, so a dozen rungs. */
export function grenadeLadder(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= GRENADE_WINDOW_MS; t += GRENADE_EVERY_MS) out.push(t);
  return out;
}
export const GRENADE_LADDER_MS: readonly number[] = grenadeLadder();

export interface GrenadeCell {
  tMs: number;
  /** Rounds in flight after this rung (shells for the after-set, missiles for the before-set). */
  inFlight: number;
}

/** Rungs with a round in flight, the first and last of them (ms), or nulls. */
export function flightRungs(cells: readonly GrenadeCell[]): { count: number; firstMs: number | null; lastMs: number | null } {
  const live = cells.filter((c) => c.inFlight >= 1);
  return {
    count: live.length,
    firstMs: live.length > 0 ? live[0].tMs : null,
    lastMs: live.length > 0 ? live[live.length - 1].tMs : null,
  };
}

/** The FIRST contiguous run of frames with a round up (a later volley is a different shot).
 *  `endMs` is the first frame after it with nothing up -- the drawn landing, to one frame. */
export function firstFlight(timeline: readonly (readonly [number, number])[]): { frames: number; startMs: number; endMs: number } | null {
  const i0 = timeline.findIndex(([, up]) => up === 1);
  if (i0 < 0) return null;
  let i = i0;
  while (i < timeline.length && timeline[i][1] === 1) i++;
  if (i >= timeline.length) return null;
  return { frames: i - i0, startMs: timeline[i0][0], endMs: timeline[i][0] };
}

/** How far the drawn landing is from the sim's resolution, in ms. Positive:
 *  the picture lands AFTER the sim. Null when either never happened. */
export function landingSkewMs(drawnLandMs: number | null, simResolveMs: number | null): number | null {
  if (drawnLandMs === null || simResolveMs === null) return null;
  return drawnLandMs - simResolveMs;
}

// ---------------------------------------------------------------------------
// The browser half.
// ---------------------------------------------------------------------------

const VIEWPORT = { width: 1400, height: 900 } as const;
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;
const ZOOMS = [2.0, 1.0] as const;
const CROP = { width: 600, height: 400 } as const;
const CROP_LIFT_PX = 40;
const TICK_MS = 50;
const FRAME_MS = 16;
const FIRE_TICK_CAP = 1200;
const FIXED = 65536;
const STEP_TIMEOUT_MS = 120_000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_ROOT = '/Users/ilpinto/dev/roaring-lions-ep/_coord/special-units-p3/grenade';

const SUBJECT = { shooter: 'inf_grenadier', target: 'militia_cell', x: 4, y: 3, gapTiles: 6, weaponId: 'gl_40' } as const;

interface SimEvent { kind: string; tick?: number; shooter?: number; weaponId?: string; target?: number }
interface LionsWindow {
  __lions: {
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      snapshot(): void;
      onEvents(events: unknown[]): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      shells?: { kind: string; t: number; duration: number }[];
      missileFx?: { missiles: { t: number; duration: number }[] };
      meshUnitTemplates?: Map<string, unknown>;
      failedMeshTypes?(): ReadonlySet<string>;
    };
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      tick(): SimEvent[];
      removeFromPlay(id: number): void;
    };
  };
}

function arg(name: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}
function load(): string {
  const [a, b, c] = os.loadavg();
  return `load ${a.toFixed(2)}/${b.toFixed(2)}/${c.toFixed(2)} on ${os.cpus().length} cpus`;
}

interface PumpResult {
  tick: number;
  inFlight: number;
  /** 16 ms frames in this stretch with a round in flight. */
  flightFrames: number;
  /** Offsets (ms into this stretch) of the first and last such frame, or -1. */
  firstMs: number;
  lastMs: number;
  /** Per-frame flags: [pumpedMs, 1 if a round is up]. */
  timeline: [number, number][];
  events: { tick: number; kind: string; weaponId: string; shooter: number; target: number }[];
  alive: [number, number];
}

async function pump(page: import('playwright').Page, ms: number, ids: readonly [number, number]): Promise<PumpResult> {
  const plan = lockstepPlan(ms, TICK_MS, FRAME_MS);
  return page.evaluate(
    ([frames, ticks, tickMs, who]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const r = L.renderer;
      let pumped = 0;
      let done = 0;
      let flightFrames = 0;
      let firstMs = -1;
      let lastMs = -1;
      const timeline: [number, number][] = [];
      const events: { tick: number; kind: string; weaponId: string; shooter: number; target: number }[] = [];
      for (const f of frames) {
        L.renderer.frame(1, f);
        pumped += f;
        while (done < ticks && pumped >= (done + 1) * tickMs) {
          const ev = L.sim.tick();
          L.renderer.snapshot();
          L.renderer.onEvents(ev);
          for (const e of ev) {
            if (e.kind !== 'contact' && e.kind !== 'spawn') {
              events.push({ tick: L.sim.tickCount, kind: e.kind, weaponId: e.weaponId ?? '', shooter: e.shooter ?? -1, target: e.target ?? -1 });
            }
          }
          done++;
        }
        const up = (r.shells ?? []).length + (r.missileFx !== undefined ? r.missileFx.missiles.length : 0) > 0;
        timeline.push([pumped, up ? 1 : 0]);
        if (up) {
          flightFrames++;
          if (firstMs < 0) firstMs = pumped;
          lastMs = pumped;
        }
      }
      return { tick: L.sim.tickCount, inFlight: (r.shells ?? []).length + (r.missileFx !== undefined ? r.missileFx.missiles.length : 0), flightFrames, firstMs, lastMs, timeline, events, alive: [L.sim.state.alive[who[0]], L.sim.state.alive[who[1]]] };
    },
    [plan.frames, plan.ticks, TICK_MS, ids] as const
  );
}

async function frameOn(page: import('playwright').Page, zoom: number) {
  const mx = SUBJECT.x + SUBJECT.gapTiles / 2;
  const at = await page.evaluate(
    ([x, y, z]) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.renderer.camera.x = x;
      L.renderer.camera.y = y;
      L.renderer.camera.zoom = z;
      L.renderer.frame(1, 0);
      return L.renderer.worldToScreen(x, y);
    },
    [mx, SUBJECT.y, zoom] as const
  );
  return {
    x: Math.min(Math.max(0, at.x - CROP.width / 2), VIEWPORT.width - CROP.width),
    y: Math.min(Math.max(0, at.y - CROP.height / 2 - CROP_LIFT_PX), VIEWPORT.height - CROP.height),
    width: CROP.width,
    height: CROP.height,
  };
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT } = await import('../golden-diff/capture-protocol');
  const { settleScript, parseSettleResult, settleLine } = await import('./blast-captures');

  const label = arg('label');
  if (label !== 'before' && label !== 'after') throw new Error('--label=before|after is required');
  const port = await claimPort('grenade-captures', 'GRENADE_CAPTURE_PORT', 5243);
  if (port === 5177 || port === 5173) throw new Error(`port ${port} is someone else's`);
  // `--out=<dir>` names the output directory under OUT_ROOT (default: the label), so a
  // later change can be photographed beside an earlier one without touching either.
  const outName = arg('out') || label;
  if (!/^[a-z0-9-]+$/.test(outName)) throw new Error(`--out=${outName}: lower-case letters, digits and dashes only`);
  const out = path.join(OUT_ROOT, outName);
  fs.mkdirSync(out, { recursive: true });

  const server = await ensureDevServer(port, REPO_ROOT, 'grenade-captures');
  if (server === null) {
    console.error(`port ${port} is not ours`);
    process.exitCode = 2;
    return;
  }
  const notes: string[] = [`machine at start: ${load()}`];
  const cellsByZoom: Record<string, { tMs: number; inFlight: number; tick: number; file: string }[]> = { '2': [], '1': [] };
  let env: string;
  let routing: string;
  let fireTick = -1;
  const allEvents: { tick: number; kind: string; weaponId: string; shooter: number; target: number }[] = [];
  const aliveByRung: { tMs: number; shooter: number; target: number }[] = [];
  const timeline: [number, number][] = [];
  let flightFrames = 0;
  let firstFlightMs = -1;
  let lastFlightMs = -1;
  const browser = await chromium.launch({ headless: true }); // default GPU: SwiftShader
  try {
    const gl = (await readUnmaskedRenderer(browser)).replace(/\|/g, '/');
    env = `${process.platform}-${process.arch} ${gl} ${VIEWPORT.width}x${VIEWPORT.height} dsf1`;
    const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.on('pageerror', (err) => console.log('  page error:', err.message));
    await page.goto(`http://localhost:${port}/?sandbox=beit_sahwan_outskirts`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
    await page.evaluate(() => document.fonts.ready);
    const settle = parseSettleResult(await page.evaluate(settleScript(30_000)));
    notes.push(settleLine('beit_sahwan_outskirts', settle));

    // The runtime switch. Import the SAME module instance the app uses (found
    // by its resource URL) and read/empty its routing set.
    routing = await page.evaluate(async ([doClear, shellsPath]) => {
      // The resource-timing buffer (250 entries) is long full by now, so ask Vite for
      // the module by its /@fs path; the same URL gives the same module instance.
      const url = `/@fs${shellsPath}`;
      const m = (await import(/* @vite-ignore */ url)) as { LOBBED_WEAPON_IDS: Set<string>; shellKindForWeapon(cls: number, id: string): string | null };
      const was = [...m.LOBBED_WEAPON_IDS].join(',');
      if (doClear) m.LOBBED_WEAPON_IDS.clear();
      return `LOBBED_WEAPON_IDS was {${was}}, now {${[...m.LOBBED_WEAPON_IDS].join(',')}}; shellKindForWeapon(he, gl_40) = ${m.shellKindForWeapon(2, 'gl_40')} (cls arg 2 is only indicative)`;
    }, [label === 'before', path.join(REPO_ROOT, 'packages/render/src/three/units/shells.ts')] as const);
    notes.push(routing);
    console.log(routing);

    // Warm-up, BEFORE the freeze: neither type is in this sandbox's boot roster, so
    // `main.ts`'s 1 Hz "unknown living type" sweep loads the GLB late, and a frozen
    // frame loop never lets that finish -- the first cut of this harness drew an
    // empty ring. Spawn both once, step so the sweep arms, wait on the renderer's own
    // template map, then remove them. A type that never lands, or lands failed, REFUSES.
    const warmup = await page.evaluate(
      async ([row, fixed]) => {
        const w = window as unknown as LionsWindow & { __lions: { step(n: number): void } };
        const L = w.__lions;
        const si = L.sim.unitTypes.findIndex((t) => t.id === row.shooter);
        const ti = L.sim.unitTypes.findIndex((t) => t.id === row.target);
        if (si < 0 || ti < 0) throw new Error(`${row.shooter}/${row.target} not in this build`);
        const a = L.sim.spawn(si, 0, row.x * fixed, row.y * fixed);
        const b = L.sim.spawn(ti, 1, (row.x + row.gapTiles) * fixed, row.y * fixed);
        L.step(20);
        const t0 = performance.now();
        const tpl = L.renderer.meshUnitTemplates ?? new Map<string, unknown>();
        while (performance.now() - t0 < 60000 && !(tpl.has(row.shooter) && tpl.has(row.target))) {
          await new Promise((r) => setTimeout(r, 250));
        }
        const failed = [...(L.renderer.failedMeshTypes?.() ?? [])];
        for (const id of [a, b]) if (L.sim.state.alive[id] === 1) L.sim.removeFromPlay(id);
        L.renderer.frame(1, 0);
        return { shooter: tpl.has(row.shooter), target: tpl.has(row.target), failed, ms: Math.round(performance.now() - t0) };
      },
      [SUBJECT, FIXED] as const
    );
    const warmLine = `mesh warm-up: inf_grenadier template ${warmup.shooter}, militia_cell template ${warmup.target}, failed types [${warmup.failed.join(',')}], ${warmup.ms} ms`;
    notes.push(warmLine);
    console.log(warmLine);
    if (!warmup.shooter || !warmup.target || warmup.failed.length > 0) {
      throw new Error(`REFUSED: ${warmLine} -- a capture without the unit meshes would show an empty ring`);
    }

    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.setViewportSize({ ...VIEWPORT });
    await page.waitForFunction(
      ([w, h]) => {
        const c = document.querySelector('canvas');
        return c !== null && c.clientWidth === w && c.clientHeight === h;
      },
      [VIEWPORT.width, VIEWPORT.height] as const
    );

    const start = await page.evaluate(
      ([row, fixed, cap]) => {
        const L = (window as unknown as LionsWindow).__lions;
        const si = L.sim.unitTypes.findIndex((t) => t.id === row.shooter);
        const ti = L.sim.unitTypes.findIndex((t) => t.id === row.target);
        if (si < 0 || ti < 0) throw new Error(`${row.shooter}/${row.target} not in this build`);
        const shooter = L.sim.spawn(si, 0, row.x * fixed, row.y * fixed);
        const target = L.sim.spawn(ti, 1, (row.x + row.gapTiles) * fixed, row.y * fixed);
        const fires: string[] = [];
        for (let n = 1; n <= cap; n++) {
          const events = L.sim.tick();
          L.renderer.snapshot();
          L.renderer.onEvents(events);
          for (const e of events) if (e.kind === 'fire' && e.shooter === shooter) fires.push(`${e.weaponId}@${L.sim.tickCount}`);
          if (events.some((e) => e.kind === 'fire' && e.shooter === shooter && e.weaponId === row.weaponId)) {
            return { shooter, target, n, tick: L.sim.tickCount, fires };
          }
        }
        return { shooter, target, n: -1, tick: L.sim.tickCount, fires };
      },
      [SUBJECT, FIXED, FIRE_TICK_CAP] as const
    );
    if (start.n < 0) {
      notes.push(`${SUBJECT.shooter} never fired ${SUBJECT.weaponId} in ${FIRE_TICK_CAP} ticks (fires: ${start.fires.join(', ')})`);
      process.exitCode = 1;
    } else {
      fireTick = start.tick;
      notes.push(`pre-window fires (lead-in): ${start.fires.join(', ')}`);
      console.log(`gl_40 fired at tick ${fireTick} after ${start.n} ticks`);
      let prev = 0;
      for (const tMs of GRENADE_LADDER_MS) {
        const st = await pump(page, tMs - prev, [start.shooter, start.target]);
        aliveByRung.push({ tMs, shooter: st.alive[0], target: st.alive[1] });
        if (st.firstMs >= 0) {
          if (firstFlightMs < 0) firstFlightMs = prev + st.firstMs;
          lastFlightMs = prev + st.lastMs;
        }
        flightFrames += st.flightFrames;
        for (const [ms, up] of st.timeline) timeline.push([prev + ms, up]);
        prev = tMs;
        allEvents.push(...st.events);
        for (const zoom of ZOOMS) {
          const clip = await frameOn(page, zoom);
          const file = `grenade-z${zoom}-${String(tMs).padStart(5, '0')}.png`;
          await page.screenshot({ path: path.join(out, file), clip });
          cellsByZoom[String(zoom)].push({ tMs, inFlight: st.inFlight, tick: st.tick, file });
        }
      }
    }
    await page.close();
  } finally {
    await browser.close();
    stopDevServer(server, 'grenade-captures');
  }
  notes.push(`machine at end: ${load()}`);

  const z2 = cellsByZoom['2'];
  const rungs = flightRungs(z2.filter((c) => firstFlight(timeline) !== null && c.tMs <= (firstFlight(timeline)?.endMs ?? 0)));
  const ff = firstFlight(timeline);
  const afterFire = allEvents.filter((e) => e.weaponId === SUBJECT.weaponId || e.kind === 'kill');
  const simResolve = allEvents.find((e) => e.kind !== 'fire' && e.weaponId === SUBJECT.weaponId);
  const simResolveMs = simResolve ? (simResolve.tick - fireTick) * TICK_MS : null;
  // The drawn landing: the pumped time of the last frame with a round up (frame resolution, 16 ms).
  const skew = landingSkewMs(ff === null ? null : ff.endMs, simResolveMs);
  for (const zoom of ZOOMS) {
    fs.writeFileSync(
      path.join(out, `flip-grenade-z${zoom}.html`),
      flipHtml(`${label} / grenade / zoom ${zoom}`, cellsByZoom[String(zoom)].map((c) => ({ file: c.file, tMs: c.tMs })))
    );
  }
  const flashEvents = allEvents.filter((e) => e.kind !== 'fire' || e.shooter !== -1).filter((e) => e.target !== -1 || e.kind === 'fire').map((e) => `${e.kind}:${e.weaponId || '-'}@${e.tick} s${e.shooter}->t${e.target}`);
  const firstDeath = aliveByRung.find((r) => r.shooter !== 1 || r.target !== 1);
  const summary = [
    `routing: ${routing}`,
    `fired ${SUBJECT.weaponId} at tick ${fireTick}`,
    `FIRST shot visible in flight: ${ff === null ? 'never' : `${ff.frames} frames of ${FRAME_MS} ms, +${ff.startMs} to +${ff.endMs} ms after the fire tick`}; ${rungs.count} 50 ms rungs show it (first ${rungs.firstMs}, last ${rungs.lastMs} ms). Whole window incl. later volleys: ${flightFrames} frames`,
    `sim resolution after the fire tick: ${simResolve ? `${simResolve.kind} at tick ${simResolve.tick} = +${simResolveMs} ms` : 'no impact/nearMiss event carried the weapon id'}`,
    `drawn landing (first frame with no round up) minus sim resolution: ${skew === null ? 'n/a' : `${skew} ms`}`,
    `liveness: first rung where either unit is dead: ${firstDeath ? `${firstDeath.tMs} ms (shooter alive=${firstDeath.shooter}, target alive=${firstDeath.target})` : 'none, both alive throughout'}`,
    `all sim events in window except contact/spawn: ${flashEvents.join(', ') || 'none'}`,
    `sim events in window (fire/impact/nearMiss/damage/kill/suppress): ${afterFire.map((e) => `${e.kind}:${e.weaponId}@${e.tick}`).join(', ') || 'none'}`,
  ];
  fs.writeFileSync(
    path.join(out, 'sheet.md'),
    [
      `# Grenade capture sheet -- ${label}`,
      ``,
      `Capture conditions: ${env}; port ${port}; \`?sandbox=beit_sahwan_outskirts\`; frame loop frozen; lockstep ${TICK_MS} ms ticks / ${FRAME_MS} ms frames; crop ${CROP.width}x${CROP.height} lifted ${CROP_LIFT_PX} px; zooms ${ZOOMS.join(', ')}; ${SUBJECT.shooter} (side 0) at (${SUBJECT.x},${SUBJECT.y}) -> ${SUBJECT.target} (side 1) ${SUBJECT.gapTiles} tiles east. No frame-cost numbers are taken.`,
      ``,
      `Judge the flip pages: ${ZOOMS.map((z) => `flip-grenade-z${z}.html`).join(', ')}.`,
      ``,
      `## Summary`,
      ``,
      ...summary.map((l) => `- ${l}`),
      ``,
      `## Notes`,
      ``,
      ...notes.map((n) => `- ${n}`),
      ``,
    ].join('\n')
  );
  fs.writeFileSync(path.join(out, 'sheet.json'), JSON.stringify({ label, env, port, fireTick, flightFrames, firstFlightMs, lastFlightMs, simResolve, allEvents, cellsByZoom, notes }, null, 2) + '\n');
  console.log(summary.join('\n'));
  console.log(`sheet at ${path.join(out, 'sheet.md')}`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    }
  );
}
