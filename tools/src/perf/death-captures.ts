/**
 * Death and crew-walk capture sheet for the infantry-animation branch
 * (docs/superpowers/specs/2026-09-17-infantry-animation-design.md, gate 9).
 *
 * Same skeleton as `gait-captures.ts` (read that file's header first):
 * the live renderer on a sandbox, frame loop frozen, one `page.evaluate`
 * per step. What differs: each death subject is killed with
 * `sim.debugKill` (or, for the `killed` subject, by a real enemy) and then
 * photographed at fixed times after death by advancing
 * `renderer.frame(1, FRAME_MS)` by hand, since the death sequence runs on
 * the FRAME clock, not the tick clock. Nothing is intercepted: run it once
 * at the branch base with `--label=before` and once at the head with
 * `--label=after`.
 *
 *   npx tsx tools/src/perf/death-captures.ts --label=before
 *   npx tsx tools/src/perf/death-captures.ts --label=after --only=inf_squad
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { FREEZE_FRAME_LOOP_SCRIPT } from '../golden-diff/capture-protocol';

const PORT = 5179;
const VIEWPORT = { width: 1400, height: 900 } as const;
const ZOOMS = [1.0, 2.5] as const;
const CLOSE_CROP = { width: 600, height: 400 } as const;
const CLOSE_CROP_LIFT_PX = 50;
/** Seconds after death at which a frame is photographed. */
const SAMPLE_SECONDS = [0, 0.15, 0.25, 0.5, 1.0, 1.5] as const;
const FRAME_MS = 16;
const SUBJECT_Y = 7;
const MESH_WAIT_MS = 300000;
const STEP_TIMEOUT_MS = 120000;
const WALK_SETTLE_TICKS = 40;
const KILL_TICK_CAP = 600;

interface Subject {
  readonly id: string;
  readonly x: number;
  readonly bodies: number;
  readonly mode: 'death' | 'walk' | 'killed';
}

const SUBJECTS: readonly Subject[] = [
  { id: 'inf_squad', x: 4, bodies: 1, mode: 'death' },
  { id: 'sarim_rifles', x: 8, bodies: 2, mode: 'death' }, // two entities: both fall variants
  { id: 'yahalom_squad', x: 13, bodies: 1, mode: 'death' },
  { id: 'rpg_team', x: 17, bodies: 1, mode: 'death' },
  { id: 'militia_cell', x: 21, bodies: 1, mode: 'death' }, // kit rig: the topple
  { id: 'civilians', x: 25, bodies: 1, mode: 'death' }, // topple then fade, no wreck
  { id: 'sniper_team', x: 29, bodies: 1, mode: 'death' }, // already down
  { id: 'moto_rpg', x: 33, bodies: 1, mode: 'death' },
  { id: 'inf_squad', x: 37, bodies: 1, mode: 'killed' }, // a real killer: direction
  { id: 'atgm_cell', x: 41, bodies: 1, mode: 'walk' },
  { id: 'mortar_crew', x: 44, bodies: 1, mode: 'walk' },
  { id: 'digger_crew', x: 47, bodies: 1, mode: 'walk' },
];
const KILLER_TYPE = 'mbt_lavi';

interface LionsWindow {
  __lions: {
    step(n: number): number;
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      meshUnitEntities: Map<number, { currentClip: string | null; actions: Map<string, unknown> }>;
      meshDying?: { entityId: number; phase?: string; entity: { currentClip: string | null } }[];
    };
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array; posX: Int32Array; posY: Int32Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      debugKill(id: number): void;
      queueCommand(cmd: { kind: string; ids: number[]; x?: number; y?: number }): void;
    };
  };
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const label = arg('label', '');
if (label !== 'before' && label !== 'after') throw new Error('--label=before|after is required');
const outRoot = arg('out', path.join(process.cwd(), '.superpowers', 'art-captures', 'infantry-anim'));
const out = path.join(outRoot, label);
const only = arg('only', '');
const wanted = only ? SUBJECTS.filter((s) => s.id === only) : SUBJECTS;
if (wanted.length === 0) throw new Error(`--only=${only} names no subject`);
fs.mkdirSync(out, { recursive: true });

interface Cell {
  subject: string;
  mode: string;
  entity: number;
  seconds: number;
  zoom: number;
  clip: string | null;
  phase: string | null;
  file: string;
}
const cells: Cell[] = [];
const notes: string[] = [];

interface Placed {
  subject: Subject;
  ids: number[];
  killer: number | null;
}

async function spawnAll(page: Page): Promise<Placed[]> {
  return page.evaluate(
    ([rows, killerType, y]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const FIXED = 65536;
      const out: { subject: (typeof rows)[number]; ids: number[]; killer: number | null }[] = [];
      for (const row of rows) {
        const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === row.id);
        if (typeIdx < 0) throw new Error(`no unit type "${row.id}" in this build`);
        const ids: number[] = [];
        for (let b = 0; b < row.bodies; b++) ids.push(L.sim.spawn(typeIdx, 0, (row.x + b) * FIXED, y * FIXED));
        let killer: number | null = null;
        if (row.mode === 'killed') {
          const kIdx = L.sim.unitTypes.findIndex((t) => t.id === killerType);
          if (kIdx < 0) throw new Error(`no unit type "${killerType}" in this build`);
          killer = L.sim.spawn(kIdx, 1, row.x * FIXED, (y - 3) * FIXED);
        }
        out.push({ subject: row, ids, killer });
      }
      return out;
    },
    [wanted, KILLER_TYPE, SUBJECT_Y] as const
  );
}

async function waitForMeshes(page: Page, ids: number[]): Promise<void> {
  const deadline = Date.now() + MESH_WAIT_MS;
  let first = true;
  for (;;) {
    const missing = await page.evaluate(
      ([want, tick]) => {
        const L = (window as unknown as LionsWindow).__lions;
        if (tick) L.step(20);
        return want.filter((id) => {
          const e = L.renderer.meshUnitEntities.get(id);
          return !e || e.actions.size === 0;
        });
      },
      [ids, !first] as const
    );
    first = false;
    if (missing.length === 0) return;
    if (Date.now() > deadline) {
      notes.push(`entities ${missing.join(', ')} never got a mesh -- captured anyway`);
      return;
    }
    await page.waitForTimeout(400);
  }
}

/** Frame the camera on `id` at `zoom`, repaint, and report what the renderer holds for it. */
async function frameOn(page: Page, id: number, zoom: number, bodies: number) {
  return page.evaluate(
    ([e, z, n]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const FIXED = 65536;
      const wx = L.sim.state.posX[e] / FIXED;
      const wy = L.sim.state.posY[e] / FIXED;
      const c = L.renderer.camera;
      c.x = wx + (n - 1) / 2;
      c.y = wy;
      c.zoom = z;
      L.renderer.frame(1, 0);
      const live = L.renderer.meshUnitEntities.get(e);
      const dying = L.renderer.meshDying?.find((d) => d.entityId === e);
      const screen = L.renderer.worldToScreen(wx, wy);
      return {
        clip: live?.currentClip ?? dying?.entity.currentClip ?? null,
        phase: dying?.phase ?? (dying ? 'dying' : live ? 'alive' : 'gone'),
        screenX: screen.x,
        screenY: screen.y,
      };
    },
    [id, zoom, bodies] as const
  );
}

async function shoot(page: Page, p: Placed, seconds: number): Promise<void> {
  for (const zoom of ZOOMS) {
    const state = await frameOn(page, p.ids[0], zoom, p.subject.bodies);
    const name = `${p.subject.id}-${p.subject.mode}-${seconds.toFixed(2)}s-${label}-z${zoom}.png`;
    const clip =
      zoom === Math.max(...ZOOMS)
        ? {
            x: Math.min(Math.max(0, state.screenX - CLOSE_CROP.width / 2), VIEWPORT.width - CLOSE_CROP.width),
            y: Math.min(
              Math.max(0, state.screenY - CLOSE_CROP.height / 2 - CLOSE_CROP_LIFT_PX),
              VIEWPORT.height - CLOSE_CROP.height
            ),
            width: CLOSE_CROP.width,
            height: CLOSE_CROP.height,
          }
        : undefined;
    await page.screenshot({ path: path.join(out, name), ...(clip ? { clip } : {}) });
    cells.push({
      subject: p.subject.id,
      mode: p.subject.mode,
      entity: p.ids[0],
      seconds,
      zoom,
      clip: state.clip,
      phase: state.phase,
      file: name,
    });
    console.log(`  saved ${name}  clip=${state.clip} phase=${state.phase}`);
  }
}

/** Advance the renderer's own frame clock by `ms`, in FRAME_MS steps. */
async function advanceFrames(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    ([total, step]) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (let done = 0; done < total; done += step) L.renderer.frame(1, Math.min(step, total - done));
    },
    [ms, FRAME_MS] as const
  );
}

async function captureDeath(page: Page, p: Placed): Promise<void> {
  const id = p.ids[0];
  if (p.subject.mode === 'killed') {
    const ticks = await page.evaluate(
      ([e, cap]) => {
        const L = (window as unknown as LionsWindow).__lions;
        let n = 0;
        while (L.sim.state.alive[e] !== 0 && n < cap) {
          L.step(1);
          n++;
        }
        return n;
      },
      [id, KILL_TICK_CAP] as const
    );
    if (ticks >= KILL_TICK_CAP) {
      notes.push(`${p.subject.id} (killed): the ${KILLER_TYPE} never killed it in ${KILL_TICK_CAP} ticks`);
      return;
    }
    console.log(`  ${p.subject.id}: killed by ${KILLER_TYPE} after ${ticks} ticks`);
  } else {
    await page.evaluate((e) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (const each of e) L.sim.debugKill(each);
      L.step(1);
    }, p.ids);
  }
  let elapsed = 0;
  for (const s of SAMPLE_SECONDS) {
    const ms = Math.round(s * 1000) - elapsed;
    if (ms > 0) await advanceFrames(page, ms);
    elapsed += Math.max(0, ms);
    await shoot(page, p, s);
  }
}

async function captureWalk(page: Page, p: Placed): Promise<void> {
  await page.evaluate(
    ([ids, n]) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (const id of ids) L.sim.queueCommand({ kind: 'move', ids: [id], x: L.sim.state.posX[id], y: 0 });
      L.step(n);
    },
    [p.ids, WALK_SETTLE_TICKS] as const
  );
  await shoot(page, p, 0);
}

function writeIndex(): void {
  const lines = [
    `# Infantry animation capture sheet -- ${label}`,
    ``,
    `Live three.js renderer, ${VIEWPORT.width}x${VIEWPORT.height}, frame loop frozen, deaths advanced by`,
    `\`renderer.frame(1, ${FRAME_MS})\` from the tick the kill landed. z${Math.max(...ZOOMS)} cells are cropped`,
    `${CLOSE_CROP.width}x${CLOSE_CROP.height} around the subject.`,
    ``,
    `| subject | mode | t (s) | zoom | clip | phase | file |`,
    `|---|---|---|---|---|---|---|`,
    ...cells.map(
      (c) => `| \`${c.subject}\` | ${c.mode} | ${c.seconds.toFixed(2)} | ${c.zoom} | ${c.clip ?? '—'} | ${c.phase ?? '—'} | \`${c.file}\` |`
    ),
  ];
  if (notes.length) lines.push(``, `## Notes`, ``, ...notes.map((n) => `- ${n}`));
  fs.writeFileSync(path.join(out, 'sheet.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'sheet.json'), JSON.stringify({ label, cells, notes }, null, 2) + '\n');
  console.log(`index at ${path.join(out, 'sheet.md')}`);
}

async function main(): Promise<void> {
  const server = await ensureDevServer(PORT, process.cwd(), 'death-captures');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.on('pageerror', (err) => console.log('  page error:', err.message));
    await page.goto(`http://localhost:${PORT}/?sandbox=beit_sahwan_outskirts`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer);
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    const placed = await spawnAll(page);
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(1));
    await waitForMeshes(page, placed.flatMap((p) => p.ids));
    for (const p of placed) {
      console.log(`${label}: ${p.subject.id} (${p.subject.mode}) entity ${p.ids[0]}`);
      if (p.subject.mode === 'walk') await captureWalk(page, p);
      else await captureDeath(page, p);
    }
    writeIndex();
    await page.close();
  } finally {
    await browser.close();
    stopDevServer(server, 'death-captures');
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
