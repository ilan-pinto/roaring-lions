// The verdict `routes-check.ts`'s deploy-screen leg now runs through -- see
// `board-canvases.ts`'s header for the race this closes. The first case is the
// exact reading CI took on 830f86c7 (main) and twice on ee0d4494 (PR #212): a
// board read mid-mount, 0 canvases against an ordinary leave's 1, which the
// old inline check reported as "an abandoned boot's renderer was never
// disposed" -- the opposite of what a count BELOW the reference can mean.
import { describe, expect, it } from 'vitest';
import { boardCanvasVerdict, type BoardReading } from './board-canvases';

const diorama = (canvases: number, settled = true): BoardReading => ({ canvases, board: 'diorama', settled });

describe('boardCanvasVerdict', () => {
  it('never calls a board that has not drawn yet a leak -- it says the board never settled', () => {
    const v = boardCanvasVerdict(diorama(0, false), diorama(1));
    expect(v).not.toBeNull();
    expect(v).toContain('never settled');
    expect(v).not.toContain('never disposed');
    expect(v).not.toContain('abandoned boot');
  });

  it('names the reference when it is the ordinary leave that never settled', () => {
    const v = boardCanvasVerdict(diorama(1), diorama(0, false));
    expect(v).toContain('ordinary leave');
    expect(v).toContain('never settled');
  });

  it('reports MORE canvases than the reference as the leak this leg exists for', () => {
    const v = boardCanvasVerdict(diorama(2), diorama(1));
    expect(v).toContain('2 canvas(es)');
    expect(v).toContain('against 1');
    expect(v).toContain('abandoned boot');
  });

  it('reports FEWER canvases on a settled board as the board drawing differently, not as a leak', () => {
    const v = boardCanvasVerdict({ canvases: 0, board: 'flat', settled: true }, diorama(1));
    expect(v).toContain('data-board=flat');
    expect(v).toContain('data-board=diorama');
    expect(v).not.toContain('abandoned boot');
  });

  it('is silent when the two settled boards agree -- the passing run must stay quiet', () => {
    expect(boardCanvasVerdict(diorama(1), diorama(1))).toBeNull();
    expect(
      boardCanvasVerdict({ canvases: 0, board: 'flat', settled: true }, { canvases: 0, board: 'flat', settled: true })
    ).toBeNull();
  });
});
