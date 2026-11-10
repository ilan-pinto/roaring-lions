/**
 * GH-943 P3 (T13, GH-1152) G1: the per-pass counters add up to the frame's own counter.
 *
 * The fake renderer below counts exactly as three 0.186.1's `Info` does (`update` bumps `render.drawCalls`; `reset` zeroes it), and
 * its `render(object, camera)` draws what the object lists, recursing into nested render calls the way `ShadowNode.renderShadow` nests
 * inside a scene-drawing pass. The oracle is a LITERAL per pass, and the frame counter three would report.
 *
 * Falsification (run by hand, in the commit message): in `installPassCounter`'s wrapped `render`, skip the reset before the AO pass
 * (`if (pass !== 'ao') mark = info.render.drawCalls;`): the AO pass is credited the scene's calls a second time, and the sum exceeds
 * the frame counter.
 */
import { describe, expect, it } from 'vitest';
import { installPassCounter, type PassRendererLike, type RenderPassId } from './pass-counter';

interface FakeObject {
  readonly name: string;
}
/** One render call: the pass it is, what it draws, in order (an object per draw call, or a nested render call). */
interface FakeRender {
  readonly pass: RenderPassId;
  readonly steps: readonly (FakeObject | FakeRender)[];
}
const isRender = (s: FakeObject | FakeRender): s is FakeRender => 'steps' in s;

type FakeInfo = PassRendererLike['info'] & { render: { drawCalls: number } };
function fakeRenderer(): PassRendererLike & { info: FakeInfo } {
  const info: FakeInfo = {
    autoReset: true,
    render: { drawCalls: 0 },
    reset(): void {
      this.render.drawCalls = 0;
    },
    update(): void {
      this.render.drawCalls++;
    },
  };
  const r: PassRendererLike & { info: FakeInfo } = {
    info,
    render(object: unknown): void {
      for (const s of (object as FakeRender).steps) {
        if (isRender(s)) r.render(s, s.pass);
        else r.info.update(s, 3, 1);
      }
    },
  };
  return r;
}

const obj = (name: string): FakeObject => ({ name });
const many = (o: FakeObject, n: number): FakeObject[] => Array.from({ length: n }, () => o);
const classify = (object: unknown): RenderPassId => (object as FakeRender).pass;

/** A frame in the node chain's order: the scene pass draws, the shadow map nests inside it, the AO pre-pass follows, then the post quads. */
function frame(): FakeRender[] {
  const ground = obj('ground');
  const unit = obj('unit');
  const decor = obj('decor-batch');
  const shadow: FakeRender = { pass: 'shadow', steps: [ground, unit, ...many(decor, 4)] };
  const scene: FakeRender = { pass: 'scene', steps: [ground, shadow, unit, ...many(decor, 5)] };
  const ao: FakeRender = { pass: 'ao', steps: [ground, unit, ...many(decor, 3)] };
  const post: FakeRender[] = [
    { pass: 'post', steps: [obj('quad-bloom')] },
    { pass: 'post', steps: [obj('quad-smaa')] },
    { pass: 'post', steps: [obj('quad-output')] },
  ];
  return [scene, ao, ...post];
}

describe('installPassCounter (G1: the per-pass counters add up)', () => {
  it('splits one frame by pass, the nested shadow map included, and the sum is the frame counter', () => {
    const r = fakeRenderer();
    const counter = installPassCounter(r, classify);
    counter.beginFrame();
    for (const f of frame()) r.render(f, f.pass);
    const p = counter.perPass();
    expect(p).toEqual({
      shadow: { calls: 6, objects: 3 },
      scene: { calls: 7, objects: 3 },
      ao: { calls: 5, objects: 3 },
      post: { calls: 3, objects: 3 },
    });
    expect(p.shadow.calls + p.scene.calls + p.ao.calls + p.post.calls).toBe(r.info.render.drawCalls);
    expect(r.info.render.drawCalls).toBe(21);
  });

  it('holds the frame counter itself: autoReset off, one reset per frame, the next frame starts from zero', () => {
    const r = fakeRenderer();
    const counter = installPassCounter(r, classify);
    expect(r.info.autoReset).toBe(false);
    counter.beginFrame();
    for (const f of frame()) r.render(f, f.pass);
    counter.beginFrame();
    for (const f of frame()) r.render(f, f.pass);
    const p = counter.perPass();
    expect(r.info.render.drawCalls).toBe(21);
    expect(p.shadow.calls + p.scene.calls + p.ao.calls + p.post.calls).toBe(21);
  });

  it('dispose puts render, info.update and autoReset back', () => {
    const r = fakeRenderer();
    const render = r.render;
    const update = r.info.update;
    const counter = installPassCounter(r, classify);
    expect(r.render).not.toBe(render);
    counter.dispose();
    expect(r.render).toBe(render);
    expect(r.info.update).toBe(update);
    expect(r.info.autoReset).toBe(true);
  });
});
