/**
 * `captureComposerView` (#464): the feedback picture is the composer's own
 * output, read from a render target -- never the canvas, whose drawing
 * buffer reads back black with `preserveDrawingBuffer` off -- and the
 * composer is always handed back drawing to the screen.
 *
 * A fake composer and GL stand in for the real ones (no WebGL under node);
 * what is pinned is the ORDER of calls and what is read, which is what a
 * regression would get wrong.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { captureComposerView, captureSize, type CaptureViewDeps } from './capture-view';

function rig(opts: { throwOnRender?: boolean } = {}) {
  const log: string[] = [];
  const texture = { id: 'composer-out' } as unknown as THREE.Texture;
  const made: { width: number; height: number; disposed: boolean }[] = [];
  let current: unknown = 'screen-target';
  const composer = {
    renderToScreen: true,
    readBuffer: { width: 3840, height: 2160, texture },
    render: vi.fn(() => {
      log.push(`render toScreen=${String(composer.renderToScreen)}`);
      if (opts.throwOnRender) throw new Error('boom');
    }),
  };
  const d: CaptureViewDeps = {
    composer,
    gl: {
      getRenderTarget: () => current as THREE.WebGLRenderTarget | null,
      setRenderTarget: (t) => {
        current = t;
        log.push(`target ${t === null ? 'null' : (t as unknown as { tag?: string }).tag ?? 'screen-target'}`);
      },
      clear: () => log.push('clear'),
      readRenderTargetPixels: (t, _x, _y, w, h, buf) => {
        log.push(`read ${(t as unknown as { tag: string }).tag} ${w}x${h}`);
        buf.fill(7);
      },
    },
    makeTarget: (width, height) => {
      const rec = { width, height, disposed: false };
      made.push(rec);
      return { tag: `bytes ${width}x${height}`, dispose: () => (rec.disposed = true) } as unknown as THREE.WebGLRenderTarget;
    },
    copy: (into, from) => log.push(`copy ${(from as unknown as { id: string }).id} -> ${(into as unknown as { tag: string }).tag}`),
  };
  return { d, log, composer, made, current: () => current };
}

describe('captureSize', () => {
  it('keeps the aspect, caps the width and never upscales', () => {
    expect(captureSize(3840, 2160, 1280)).toEqual({ width: 1280, height: 720 });
    expect(captureSize(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(captureSize(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
});

describe('captureComposerView', () => {
  it('renders the post chain into its own target and reads that, never the screen', () => {
    const r = rig();
    const px = captureComposerView(r.d, 1280);
    expect(px).not.toBeNull();
    expect(px?.width).toBe(1280);
    expect(px?.height).toBe(720);
    expect(px?.data.length).toBe(1280 * 720 * 4);
    expect(px?.data[0]).toBe(7);
    // The composer ran with its last pass kept OFF the screen, and the bytes
    // came from the copy of its own output, not the default framebuffer.
    expect(r.log).toEqual([
      'render toScreen=false',
      'target bytes 1280x720',
      'clear',
      'copy composer-out -> bytes 1280x720',
      'read bytes 1280x720 1280x720',
      'target screen-target',
    ]);
  });

  it('hands the composer back to the screen and frees its target, even when the render throws', () => {
    const r = rig({ throwOnRender: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(captureComposerView(r.d, 1280)).toBeNull();
    warn.mockRestore();
    expect(r.composer.renderToScreen).toBe(true);
    expect(r.current()).toBe('screen-target');
  });

  it('restores renderToScreen and disposes the byte target on success too', () => {
    const r = rig();
    captureComposerView(r.d, 960);
    expect(r.composer.renderToScreen).toBe(true);
    expect(r.made).toEqual([{ width: 960, height: 540, disposed: true }]);
  });
});
