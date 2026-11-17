// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { defaultAvatar, LAST_RESORT_AVATAR, type AvatarView } from '@lions/data';
import { PLAYER_KEY } from '../telemetry/identity';
import { avatarChain, avatarElement, crestSrc, guestMark } from './avatar';

const chosen = (id: string): AvatarView => ({ kind: 'preset', id, chosen: true });
const imgOf = (el: HTMLElement): HTMLImageElement => el.querySelector('img') as HTMLImageElement;

describe('the avatar element (GH-1075 P5)', () => {
  it('draws the resolved preset as a decorative <img>', () => {
    const el = avatarElement(chosen('crest-lion'), 'ABCD2345', 'chip');
    expect(imgOf(el).getAttribute('src')).toBe(crestSrc('crest-lion'));
    expect(imgOf(el).getAttribute('alt')).toBe('');
    expect(el.dataset.avatar).toBe('crest-lion');
  });

  it('a failed file steps to the member default, then to the chevrons, then to the guest mark', () => {
    const publicId = 'ABCD2345';
    const def = defaultAvatar(publicId);
    const pick = def === 'crest-claw' ? 'crest-star' : 'crest-claw'; // a choice that is not the default
    const el = avatarElement(chosen(pick), publicId, 'head');
    const img = imgOf(el);
    expect(el.dataset.avatar).toBe(pick);
    img.dispatchEvent(new Event('error'));
    expect(el.dataset.avatar).toBe(def);
    expect(img.getAttribute('src')).toBe(crestSrc(def));
    img.dispatchEvent(new Event('error'));
    expect(el.dataset.avatar).toBe(LAST_RESORT_AVATAR);
    expect(img.getAttribute('src')).toBe(crestSrc(LAST_RESORT_AVATAR));
    img.dispatchEvent(new Event('error'));
    expect(el.dataset.avatar).toBe('guest');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('the chain never repeats an id and always contains the chevrons', () => {
    for (const id of ['crest-chevrons', 'crest-lion', defaultAvatar('ZZZZ9999')]) {
      const c = avatarChain(chosen(id), 'ZZZZ9999');
      expect(new Set(c).size).toBe(c.length);
      expect(c[0]).toBe(id);
      expect(c).toContain(LAST_RESORT_AVATAR);
    }
  });

  it('an upload draws its fallback crest (uploads are not open)', () => {
    expect(avatarChain({ kind: 'upload', rev: 3, fallback: 'crest-wave' }, 'ABCD2345')[0]).toBe('crest-wave');
  });

  it('the guest mark is fixed: nothing on the device changes it (A1-10)', () => {
    const before = guestMark('chip').outerHTML;
    try {
      window.localStorage.setItem(PLAYER_KEY, '0f8fad5b-d9cb-469f-a165-70867728950e');
      window.localStorage.setItem('lions.account.binding', JSON.stringify({ version: 1, publicId: 'PUBSENTINEL77', deviceId: 'dev-sentinel' }));
    } catch {
      /* a jsdom without a real Storage: the mark takes no input at all, which is the point */
    }
    const after = guestMark('chip').outerHTML;
    expect(after).toBe(before);
    expect(after).not.toContain('0f8fad5b');
    expect(after).not.toContain('PUBSENTINEL77');
  });

  it('the guest mark and a member\'s avatar are decorative: aria-hidden, so the name beside them is the label (falsification audit)', () => {
    expect(guestMark('chip').getAttribute('aria-hidden')).toBe('true');
    expect(avatarElement(chosen('crest-lion'), 'ABCD2345', 'chip').getAttribute('aria-hidden')).toBe('true');
  });
});
