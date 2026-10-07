// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { groundView } from './ground-view';
import type { GroundMark } from './ground-marks';

const map = { width: 4, height: 4, blocked: new Uint8Array(16), boulder: new Uint8Array(16), cover: new Uint8Array(16) };
const tones = { open: 'a', blocked: 'b', rock: 'c', cover: ['d', 'e', 'f'] as [string, string, string] };
const marks: GroundMark[] = [
  { kind: 'objective', zone: 'depot', rect: { x: 1, y: 1, w: 2, h: 2 }, numbers: [1, 3], label: 'Raze', clock: '5:00 limit', primary: true },
  { kind: 'nofire', zone: 'hall', rect: { x: 0, y: 3, w: 1, h: 1 }, label: 'civic hall' },
  { kind: 'start', x: 0, y: 0 },
];

const origGetContext = HTMLCanvasElement.prototype.getContext;
function withContext(): { puts: number } {
  const seen = { puts: 0 };
  const ctx = { fillStyle: '', fillRect: (): void => undefined, putImageData: (): void => void seen.puts++ };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  return seen;
}
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});
const img = (w: number, h: number): ImageData => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) as unknown as ImageData;

describe('groundView (GH-417)', () => {
  it('draws each mark by class, in tile units, and a legend of only what is drawn', () => {
    withContext();
    const v = groundView({ map, tones, marks, caption: 'Ground' });
    const svg = v.el.querySelector('svg.rl-ground__svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 4 4');
    const zone = v.el.querySelector('.rl-ground__zone--objective');
    expect([zone?.getAttribute('x'), zone?.getAttribute('width')]).toEqual(['1', '2']);
    expect(v.el.querySelector('.rl-ground__label--objective')?.textContent).toBe('Objective 1 · 3 · 5:00 limit');
    expect(v.el.querySelector('.rl-ground__label--nofire')?.textContent).toBe('civic hall · no fire');
    expect([...v.el.querySelectorAll('.rl-ground__key')].map((k) => k.className.split('--')[1])).toEqual(['objective', 'nofire', 'start']);
    expect(v.source).toBe('painted');
  });

  it('gives each view its own hatch pattern, so two views on one page do not share an id', () => {
    withContext();
    const a = groundView({ map, tones, marks });
    const b = groundView({ map, tones, marks });
    const id = (v: ReturnType<typeof groundView>): string | null | undefined => v.el.querySelector('pattern')?.id;
    expect(id(a)).not.toBe(id(b));
    expect(a.el.querySelector('.rl-ground__zone--nofire')?.getAttribute('fill')).toBe(`url(#${id(a)})`);
  });

  // Falsified: removing the aspect guard lets the 8x4 picture through.
  it('swaps in a photograph of the same aspect, and refuses one of another map', () => {
    const seen = withContext();
    const v = groundView({ map, tones, marks });
    v.setPhoto(img(8, 4));
    expect(v.source).toBe('painted');
    v.setPhoto(img(16, 16));
    expect(v.source).toBe('photo');
    expect(seen.puts).toBe(1);
    expect(v.el.querySelectorAll('.rl-ground__base')).toHaveLength(1);
    expect(v.el.querySelector('.rl-ground__base--photo')).not.toBeNull();
  });

  it('draws loss and deduction pins for the after-action report', () => {
    withContext();
    const v = groundView({ map, tones, marks: [], pins: [{ kind: 'loss', x: 2, y: 2, label: 'Barzel · 5:40' }] });
    expect(v.el.querySelector('.rl-ground__pin--loss')?.getAttribute('cx')).toBe('2.5');
    expect(v.el.querySelector('.rl-ground__label--loss')?.textContent).toBe('Barzel · 5:40');
  });

  it('with no 2D context, still draws the marks over an empty frame', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
    const v = groundView({ map, tones, marks });
    expect(v.source).toBe('none');
    expect(v.el.querySelector('.rl-ground__zone--objective')).not.toBeNull();
  });
});
