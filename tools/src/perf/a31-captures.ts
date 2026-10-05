/**
 * In-game photographs of the A3.1 parts batch (GH-179, 2026-10-05): every
 * unit type that gained a Meshy part, drawn by the LIVE renderer in the
 * sandbox, at gameplay zoom (1.0) and close up (2.5).
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/a31-captures.ts [--port=5190] [--out=docs/art/sheets/a31-parts/ingame] [--only=id,id]
 *
 * One unit type per BROWSER, as `unit-plates.ts` learned the hard way: a
 * page's third or fourth screenshot can stall for minutes and lose the WebGL
 * context. The GPU backend is `ui-review/gpu.ts`'s (Metal on macOS). Each type gets a fresh Chromium, boots the sandbox
 * once (`/free-play/beit_sahwan_outskirts?sur&tunnel`, music off through
 * `lions.settings` before boot), finds an open tile clear of buildings and
 * units near the friendly force (so fog is lifted by the force's own sight
 * and nothing shoots), spawns the type there on side 0 through `sim.spawn`
 * (the mesh is by type, not by side), steps 20 ticks so the pose settles and
 * the 1 Hz mesh sweep loads a type the boot roster did not field, and
 * photographs a crop around the tile at both zooms. A type with no GLB
 * draws its billboard; that is the same picture the player gets.
 *
 * Not a gate. It writes PNGs for a person to look at and prints their paths.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'a31-captures';
const VIEWPORT = { width: 1400, height: 900 } as const;
const DPR = 2;
const CLIP = { w: 520, h: 400 } as const;
const CLEAR_RADIUS = 4;
const ZOOMS: readonly [string, number][] = [
  ['gameplay', 1.0],
  ['closeup', 2.5],
];
const DEFAULT_TYPES = [
  'militia_cell',
  'sarim_rifles',
  'rpg_team',
  'moto_rpg',
  'at_team',
  'mortar_team',
  'yahalom_squad',
  'breach_team',
  'manpad_team',
  'recon_drone',
  'attack_drone',
];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const PORT = Number(arg('port') ?? 5190);
const OUT = path.resolve(REPO_ROOT, arg('out') ?? 'docs/art/sheets/a31-parts/ingame');
const TYPES = (arg('only')?.split(',') ?? DEFAULT_TYPES).filter(Boolean);
// Metal on macOS, SwiftShader elsewhere (`--gpu=`): a SwiftShader screenshot of a
// live mission at DPR 2 stalled past Playwright's 30 s here; Metal reads in ~150 ms.
const GPU = resolveGpuBackend(process.argv, process.platform);
if (PORT === 5177) throw new Error('port 5177 is the lead\'s everyday dev server; pick another');
fs.mkdirSync(OUT, { recursive: true });

interface LionsWindow {
  __lions: {
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(dt: number, alpha: number): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
    };
    sim: {
      width: number;
      height: number;
      blocked: Uint8Array;
      unitTypes: { id: string }[];
      spawn(typeIdx: number, side: number, x: number, y: number): number;
    };
    step(n: number): void;
    units(side?: number): { id: number; type: string; x: number; y: number }[];
  };
}

const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
const base = `http://localhost:${PORT}`;
const written: string[] = [];
let failures = 0;

try {
  for (const unitId of TYPES) {
    console.log(`[${TAG}] ${unitId}`);
    const browser = await chromium.launch({
      headless: true,
      args: gpuLaunchArgs(GPU),
    });
    try {
      const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: DPR });
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem(
            'lions.settings',
            JSON.stringify({ audio: { master: 1, music: 0, sfx: 0, voice: 0, radio: false } })
          );
        } catch {
          /* storage blocked: the page still boots, with sound */
        }
      });
      await page.goto(`${base}/free-play/beit_sahwan_outskirts?sur&tunnel`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, {
        timeout: 120000,
      });
      await page.waitForTimeout(4000);

      // A string, not a function: tsx/esbuild wraps a named inner function in a
      // `__name` helper that does not exist inside the page.
      const tile = (await page.evaluate(`(() => {
        const r = ${CLEAR_RADIUS};
        const L = window.__lions;
        const friends = L.units(0);
        const ax = Math.round(friends.reduce((s, u) => s + u.x, 0) / friends.length);
        const ay = Math.round(friends.reduce((s, u) => s + u.y, 0) / friends.length);
        const everyone = [...L.units(0), ...L.units(1)];
        const W = L.sim.width, H = L.sim.height;
        for (let ring = 0; ring < 20; ring++) {
          for (let dy = -ring; dy <= ring; dy++) {
            for (let dx = -ring; dx <= ring; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
              const x = ax + dx, y = ay + dy;
              let ok = true;
              for (let yy = -r; ok && yy <= r; yy++) for (let xx = -r; ok && xx <= r; xx++) {
                const tx = x + xx, ty = y + yy;
                if (tx < 0 || ty < 0 || tx >= W || ty >= H || L.sim.blocked[ty * W + tx] !== 0) ok = false;
              }
              if (ok && everyone.every((u) => Math.hypot(u.x - x, u.y - y) > r + 1)) return [x, y];
            }
          }
        }
        return null;
      })()`)) as [number, number] | null;
      if (!tile) throw new Error('no clear tile near the friendly force');

      const entity = await page.evaluate(
        ([id, x, y]) => {
          const L = (window as unknown as LionsWindow).__lions;
          const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === id);
          if (typeIdx < 0) throw new Error(`no unit type "${id}" in this build`);
          return L.sim.spawn(typeIdx, 0, Math.round(x * 65536), Math.round(y * 65536));
        },
        [unitId, tile[0], tile[1]] as [string, number, number]
      );
      await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(20));
      // The 1 Hz mesh sweep and the GLB fetch for a type the roster did not field.
      await page.waitForTimeout(7000);

      for (const [label, zoom] of ZOOMS) {
        const clip = await page.evaluate(
          ([x, y, z, cw, ch]) => {
            const L = (window as unknown as LionsWindow).__lions;
            L.renderer.camera.x = x;
            L.renderer.camera.y = y;
            L.renderer.camera.zoom = z;
            L.step(1);
            for (let i = 0; i < 3; i++) L.renderer.frame(1, 0);
            const p = L.renderer.worldToScreen(x, y);
            return { x: Math.round(p.x - cw / 2), y: Math.round(p.y - ch / 2 - 40), width: cw, height: ch };
          },
          [tile[0], tile[1], zoom, CLIP.w, CLIP.h] as [number, number, number, number, number]
        );
        await page.waitForTimeout(500);
        const file = path.join(OUT, `${unitId}-${label}.png`);
        await page.screenshot({ path: file, clip });
        written.push(file);
        console.log(`[${TAG}]   ${label} zoom ${zoom} -> ${path.relative(REPO_ROOT, file)} (entity ${entity} at ${tile[0]},${tile[1]})`);
      }
    } catch (err) {
      failures++;
      console.error(`[${TAG}] ${unitId} FAILED: ${(err as Error).message}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  if (devServer) await stopDevServer(devServer, TAG);
}
console.log(`[${TAG}] wrote ${written.length} file(s), ${failures} failure(s)`);
process.exit(failures > 0 ? 1 : 0);
