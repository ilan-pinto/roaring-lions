// GH-943 P0: does headless Chromium give a STABLE WebGPU device on this machine? One tiny page, no game, several launch-argument
// variants, each asked to clear a canvas 60 times and report whether `device.lost` fired. REPORT-ONLY (exit 0): the CI arm uses
// it to choose `chromiumArgsFor('webgpu')` from evidence rather than from memory.
//
//   pnpm --filter @lions/tools exec tsx src/ci/webgpu-smoke.ts
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const VARIANTS: Record<string, string[]> = {
  'A swiftshader-vulkan': ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
  'B adapter-only': ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
  'C vulkan+angle': ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  'D default-flags': ['--enable-unsafe-webgpu'],
  'E no-sandbox-gpu': ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-gpu-sandbox', '--ignore-gpu-blocklist'],
};

const server = createServer((_q, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><canvas id=c width=256 height=256></canvas>');
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

for (const [name, args] of Object.entries(VARIANTS)) {
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 100)));
  try {
    await page.goto(`http://localhost:${port}/`);
    const out = await page.evaluate(async () => {
      // The page-side WebGPU surface this probe touches, structurally (`@webgpu/types` is not a dependency).
      interface Gpu {
        requestAdapter(): Promise<{ info?: Record<string, string>; isFallbackAdapter?: boolean; features: Iterable<string>; requestDevice(): Promise<Dev> } | null>;
        getPreferredCanvasFormat(): string;
      }
      interface Dev {
        lost: Promise<{ reason: string; message: string }>;
        queue: { submit(b: unknown[]): void; onSubmittedWorkDone(): Promise<void> };
        createCommandEncoder(): { beginRenderPass(d: unknown): { end(): void }; finish(): unknown };
      }
      const nav = navigator as unknown as { gpu?: Gpu };
      if (!nav.gpu) return 'no navigator.gpu';
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) return 'no adapter';
      const info = adapter.info ?? {};
      const device = await adapter.requestDevice();
      let lost = '';
      device.lost.then((l) => (lost = `LOST(${l.reason}): ${String(l.message).slice(0, 80)}`));
      const canvas = document.getElementById('c') as HTMLCanvasElement;
      const ctx = canvas.getContext('webgpu') as unknown as { configure(c: unknown): void; getCurrentTexture(): { createView(): unknown } };
      ctx.configure({ device, format: nav.gpu.getPreferredCanvasFormat() });
      let ok = 0;
      for (let i = 0; i < 60; i++) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: i / 60, g: 0.2, b: 0.4, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
        pass.end();
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
        await new Promise((r) => setTimeout(r, 20));
        ok++;
      }
      return `adapter "${[info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ')}" fallback=${adapter.isFallbackAdapter} features=${[...adapter.features].join(',')} frames ok ${ok}/60 ${lost}`;
    });
    console.log(`[webgpu-smoke] ${name}: ${out}${errs.length ? ` errors=${JSON.stringify(errs.slice(0, 3))}` : ''}`);
  } catch (e) {
    console.log(`[webgpu-smoke] ${name}: THREW ${(e as Error).message.slice(0, 160)}`);
  }
  await browser.close();
}
server.close();
process.exit(0);
