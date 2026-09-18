import { describe, expect, it } from 'vitest';
import { buildProvenanceLine } from './provenance';

describe('buildProvenanceLine', () => {
  it('formats a text-to-3d line with the prompt and ai model', () => {
    const line = buildProvenanceLine({
      kind: 'text',
      glbPath: 'art/meshy/watchtower-20260918-018f1a2b/model.glb',
      aiModel: 'meshy-6',
      refined: false,
      taskId: '018f1a2b-cccc-dddd-eeee-ffffffffffff',
      promptOrSource: 'a desert watchtower',
      generatedAt: '2026-09-18',
    });
    expect(line).toContain('| art/meshy/watchtower-20260918-018f1a2b/model.glb |');
    expect(line).toContain('TODO: draws as');
    expect(line).toContain('Meshy AI text-to-3d (meshy-6, prompt: "a desert watchtower")');
    expect(line).toContain('AI-generated, disclosed per CONTRIBUTING.md');
    expect(line).toContain('task 018f1a2b-cccc-dddd-eeee-ffffffffffff');
    expect(line).toContain('generated 2026-09-18');
  });

  it('marks a refined task', () => {
    const line = buildProvenanceLine({
      kind: 'text',
      glbPath: 'art/meshy/x/refine/model.glb',
      aiModel: 'meshy-7',
      refined: true,
      taskId: 'id',
      promptOrSource: 'a tower',
      generatedAt: '2026-09-18',
    });
    expect(line).toContain('meshy-7+refine');
  });

  it('formats an image-to-3d line with the source path', () => {
    const line = buildProvenanceLine({
      kind: 'image',
      glbPath: 'art/meshy/x/model.glb',
      aiModel: 'meshy-6',
      refined: false,
      taskId: 'id',
      promptOrSource: './ref.png',
      generatedAt: '2026-09-18',
    });
    expect(line).toContain('Meshy AI image-to-3d (meshy-6, source: ./ref.png)');
  });
});
