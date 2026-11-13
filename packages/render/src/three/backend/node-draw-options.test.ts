/**
 * GH-943 P3 (T14b, GH-1152): the node draw switches' defaults (lead ruling D3: F2 on) and the `--node-opts=` parser, which must refuse
 * a typo rather than time the default arm under a non-default name.
 *
 * Falsification (run by hand, in the commit message): `refreshPolicy: 'three'` in `NODE_DRAW_DEFAULTS`: the D3 spec goes red.
 */
import { describe, expect, it } from 'vitest';
import { NODE_DRAW_DEFAULTS, parseNodeDraw, resolveNodeDraw } from './node-draw-options';

describe('node draw switches', () => {
  it('D3: F2 parked, F8 once and the 1205 uploads on by default', () => {
    expect(NODE_DRAW_DEFAULTS).toEqual({ refreshPolicy: 'parked', matrixWalk: 'once', uploads: 'versioned', batchUploads: 'drawn' });
    expect(resolveNodeDraw(undefined)).toEqual(NODE_DRAW_DEFAULTS);
    expect(resolveNodeDraw({ matrixWalk: 'every-pass' })).toEqual({ refreshPolicy: 'parked', matrixWalk: 'every-pass', uploads: 'versioned', batchUploads: 'drawn' });
  });
  it('parses the R3 arms', () => {
    expect(parseNodeDraw('')).toEqual({});
    expect(parseNodeDraw('refreshPolicy=three,matrixWalk=every-pass')).toEqual({ refreshPolicy: 'three', matrixWalk: 'every-pass' });
    expect(parseNodeDraw('refreshPolicy=three,matrixWalk=every-pass,uploads=three')).toEqual({ refreshPolicy: 'three', matrixWalk: 'every-pass', uploads: 'three' });
    expect(parseNodeDraw('batchUploads=capacity')).toEqual({ batchUploads: 'capacity' });
  });
  it('refuses an unknown key, an unknown value, a key twice and a malformed pair', () => {
    expect(() => parseNodeDraw('refreshpolicy=three')).toThrow(/unknown key/);
    expect(() => parseNodeDraw('refreshPolicy=off')).toThrow(/expected one of three, parked/);
    expect(() => parseNodeDraw('uploads=three,uploads=versioned')).toThrow(/twice/);
    expect(() => parseNodeDraw('uploads')).toThrow(/not k=v/);
  });
});
