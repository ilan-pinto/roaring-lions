// A Blender unit portrait never crops its subject.
//
// `tools/render_unit_portraits.py` fits a vehicle on its WIDTH at 92% (the lead,
// 1 Oct) and lets the height fall where it will. GH-709's Te'o Cluster Howitzer,
// its gun laid at 50 degrees, was the first vehicle taller than it is wide in the
// frame: fitted on width it read 1.086 of the frame high, and its muzzle brake and
// tracks were cut off the master (`ndc_box` -0.0428..1.0428). The fit now takes the
// height when the height is the larger. This pins the outcome on every master the
// script wrote, from the box it records beside each one: no edge outside the frame.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MASTERS = fileURLToPath(new URL('../../art/portraits/masters', import.meta.url));

const boxes = readdirSync(MASTERS, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, box: (JSON.parse(readFileSync(join(MASTERS, f), 'utf8')) as { ndc_box: number[] }).ndc_box }));

describe('unit portraits are framed whole', () => {
  it('reads a real set of masters (vacuity guard)', () => {
    expect(boxes.length).toBeGreaterThan(30);
  });

  it('no master records a subject box outside the frame', () => {
    const cropped = boxes.filter(({ box }) => box.length !== 4 || box.some((v) => v < 0 || v > 1)).map(({ f, box }) => `${f} ${JSON.stringify(box)}`);
    expect(cropped).toEqual([]);
  });
});
