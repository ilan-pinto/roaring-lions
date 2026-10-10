// The GL ledger is a STRING the browser runs (`addInitScript`), so this test
// runs that exact string in a node `vm` against a fake WebGL2 prototype whose
// methods do nothing -- the ledger wraps them, and the arithmetic is what is
// under test, as shipped.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GL_LEDGER_INIT_SCRIPT, liveContexts, liveGpuBytes, type LedgerReadout } from './memory-ledger';

const GL = {
  TEXTURE_2D: 0x0de1,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE0: 0x84c0,
  RGBA8: 0x8058,
  R8: 0x8229,
  RGBA16F: 0x881a,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  HALF_FLOAT: 0x140b,
  ARRAY_BUFFER: 0x8892,
  RENDERBUFFER: 0x8d41,
  DEPTH24_STENCIL8: 0x88f0,
};

function rig(): { ctx: () => Record<string, (...a: unknown[]) => unknown> & { lost: boolean }; read: () => LedgerReadout } {
  const sandbox: Record<string, unknown> = { WeakRef, WeakMap, WeakSet, Map, Set, Math, Number, Object, ArrayBuffer };
  class WebGL2RenderingContext {
    lost = false;
    canvas = { width: 100, height: 50, isConnected: true };
    drawingBufferWidth = 100;
    drawingBufferHeight = 50;
    isContextLost(): boolean {
      return this.lost;
    }
    getContextAttributes(): { antialias: boolean; depth: boolean; stencil: boolean } {
      return { antialias: false, depth: true, stencil: false };
    }
  }
  for (const m of [
    'activeTexture', 'bindTexture', 'texImage2D', 'texSubImage2D', 'copyTexImage2D', 'texImage3D', 'compressedTexImage2D',
    'texStorage2D', 'texStorage3D', 'generateMipmap', 'deleteTexture', 'bindBuffer', 'bufferData', 'deleteBuffer',
    'bindRenderbuffer', 'renderbufferStorage', 'renderbufferStorageMultisample', 'deleteRenderbuffer',
  ]) {
    (WebGL2RenderingContext.prototype as unknown as Record<string, () => void>)[m] = () => undefined;
  }
  sandbox.WebGL2RenderingContext = WebGL2RenderingContext;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(GL_LEDGER_INIT_SCRIPT, sandbox);
  return {
    ctx: () => new WebGL2RenderingContext() as never,
    read: () => (sandbox.__rlMem as { read(): LedgerReadout }).read(),
  };
}

describe('the GL ledger', () => {
  it('counts a full mip chain from texStorage2D, and gives it back on delete', () => {
    const r = rig();
    const gl = r.ctx();
    const tex = {};
    gl.bindTexture(GL.TEXTURE_2D, tex);
    gl.texStorage2D(GL.TEXTURE_2D, 12, GL.RGBA8, 2048, 2048);
    let chain = 0;
    for (let l = 0; l < 12; l++) chain += Math.max(1, 2048 >> l) ** 2 * 4;
    expect(r.read().contexts[0].texture).toEqual({ bytes: chain, count: 1 });
    gl.deleteTexture(tex);
    expect(r.read().contexts[0].texture).toEqual({ bytes: 0, count: 0 });
  });

  it('sizes texImage2D from the format and type, per texture unit, and a generated mip chain at a third more', () => {
    const r = rig();
    const gl = r.ctx();
    const a = {};
    const b = {};
    gl.activeTexture(GL.TEXTURE0 + 3);
    gl.bindTexture(GL.TEXTURE_2D, a);
    gl.activeTexture(GL.TEXTURE0);
    gl.bindTexture(GL.TEXTURE_2D, b);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA16F, 64, 64, 0, GL.RGBA, GL.HALF_FLOAT, null); // into b: 32 KiB
    gl.activeTexture(GL.TEXTURE0 + 3);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.R8, 30, 30, 0, 0x1903, GL.UNSIGNED_BYTE, null); // into a: 900 B
    gl.generateMipmap(GL.TEXTURE_2D); // a: +300
    expect(r.read().contexts[0].texture).toEqual({ bytes: 64 * 64 * 8 + 900 + 300, count: 2 });
  });

  it('counts buffers by bufferData size and renderbuffers by samples, and drops a lost context', () => {
    const r = rig();
    const gl = r.ctx();
    const buf = {};
    gl.bindBuffer(GL.ARRAY_BUFFER, buf);
    gl.bufferData(GL.ARRAY_BUFFER, new Float32Array(100), 0x88e4);
    gl.bufferData(GL.ARRAY_BUFFER, 1000, 0x88e8); // re-specified: replaces, never adds
    const rb = {};
    gl.bindRenderbuffer(GL.RENDERBUFFER, rb);
    gl.renderbufferStorageMultisample(GL.RENDERBUFFER, 4, GL.DEPTH24_STENCIL8, 10, 10);
    gl.bindTexture(GL.TEXTURE_2D, {});
    gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, 8, 8); // 256 B
    const c = r.read().contexts[0];
    expect(c.buffer).toEqual({ bytes: 1000, count: 1 });
    expect(c.renderbuffer).toEqual({ bytes: 10 * 10 * 4 * 4, count: 1 });
    // 100 x 50 drawing buffer, no MSAA: colour 4 + depth 4 + presentation copy 4.
    expect(c.drawingBufferEst).toBe(100 * 50 * 12);
    const out = r.read();
    expect(liveGpuBytes(out)).toBe(1000 + 1600 + 256 + 60000);
    expect(liveContexts(out)).toBe(1);
    gl.lost = true;
    const after = r.read();
    expect(liveGpuBytes(after)).toBe(0);
    expect(liveContexts(after)).toBe(0);
    expect(after.contexts[0].lost).toBe(true);
    // A lost context's own fields read zero too, not only the total.
    expect(after.contexts[0].texture).toEqual({ bytes: 0, count: 0 });
  });
});
