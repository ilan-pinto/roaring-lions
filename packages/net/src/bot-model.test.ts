import { describe, expect, it } from 'vitest';
import { BOT_MODELS, botModelField, decodeBotModel, encodeBotModel } from './index';

describe('the declared bot model (GH-1075 A3, §0.16)', () => {
  it('a_listed_id_round_trips', () => {
    expect(BOT_MODELS.slice(0, 5)).toEqual(['scripted', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2']);
    for (const id of BOT_MODELS) {
      const r = botModelField({ id });
      expect(r).toEqual({ ok: true, model: { id } });
      const enc = encodeBotModel({ id });
      expect(enc).toBe(`id:${id}`);
      expect(decodeBotModel(enc)).toEqual({ id });
    }
  });

  it('absent is an unlabelled bot, and no other key survives', () => {
    expect(botModelField(undefined)).toEqual({ ok: true, model: null });
    expect(botModelField({ id: 'scripted', evil: 'x' })).toEqual({ ok: true, model: { id: 'scripted' } });
    expect(botModelField('scripted')).toEqual({ ok: false });
    expect(botModelField(null)).toEqual({ ok: false });
  });

  it('other_needs_a_name', () => {
    for (const v of [{ id: 'other' }, { id: 'other', name: '' }, { id: 'other', name: '​‮  ' }, { id: 'gpt-x' }]) {
      expect(botModelField(v)).toEqual({ ok: false });
    }
  });

  it('a_long_name_is_trimmed', () => {
    const long = '𝔸'.repeat(10) + 'abcdefghijklmnopqrstuvwxyzabcd';
    const r = botModelField({ id: 'other', name: long });
    expect(r.ok).toBe(true);
    if (!r.ok || r.model === null || r.model.id !== 'other') throw new Error('expected other');
    expect(Array.from(r.model.name)).toHaveLength(24);
    // The literal, not the function under test: NFKC folds each U+1D538 to 'A', and the first 24 code points are kept.
    expect(r.model.name).toBe('AAAAAAAAAAabcdefghijklmn');
    const dirty = botModelField({ id: 'other', name: 'My‮Net‍v3' });
    expect(dirty).toEqual({ ok: true, model: { id: 'other', name: 'MyNetv3' } });
    const typed = botModelField({ id: 'other', name: 'claude-opus-5-5' });
    if (!typed.ok || typed.model === null) throw new Error('expected a model');
    expect(encodeBotModel(typed.model)).toBe('other:claude-opus-5-5');
    expect(decodeBotModel('other:claude-opus-5-5')).toEqual({ id: 'other', name: 'claude-opus-5-5' });
  });

  it('a stored value that does not decode is null', () => {
    for (const s of [null, '', 'claude-opus-5-5', 'id:gpt-x', 'other:', 'other:  padded', 'x:scripted']) expect(decodeBotModel(s)).toBeNull();
  });
});
