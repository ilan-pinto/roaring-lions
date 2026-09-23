// @vitest-environment jsdom
//
// The one HTML escaper (shell upgrade Phase 3, Task 10). There were three,
// for two jobs, and they disagreed: `hud.ts`'s `escapeAttr` (`& " <`) and
// `escapeHtml` (`& < >`), and `mission-notice.ts`'s `escapeHtml` (all five).
// The five-character body is the one kept, because it is a superset of the
// other two -- the round-trip below is what "a superset" means in practice,
// and each of the two retired bodies fails it on at least one input.

import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  // Moved here from `mission-notice.test.ts`, which pinned the five-entity
  // body when that module owned it.
  it('escapes all five reserved characters', () => {
    expect(escapeHtml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('escapes the ampersand first, so nothing is double-escaped', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Rest and Refit')).toBe('Rest and Refit');
  });

  // Every context the UI interpolates data into: text between tags, an
  // attribute in double quotes (every `data-*`, `title` and `src` hud.ts
  // builds), and one in single quotes for completeness. The value must come
  // back out of the parser exactly as it went in, and nothing it carries may
  // become an element of its own.
  //
  // `hud.ts`'s old text body (`& < >`) ends the double-quoted attribute on
  // `He said "go"`; its old attribute body (`& " <`) and that text body both
  // end the single-quoted one on `Sahim's route`.
  it.each([
    'Fish &amp; Chips',
    '<img src=x onerror=1>',
    'He said "go"',
    "Sahim's route",
    'a > b < c',
    '&#39;',
  ])('round-trips %j through text and through either kind of quoted attribute', (s) => {
    const host = document.createElement('div');
    host.innerHTML = `<span title="${escapeHtml(s)}" data-x='${escapeHtml(s)}'>${escapeHtml(s)}</span>`;
    expect(host.children).toHaveLength(1);
    const span = host.firstElementChild;
    expect(span?.children).toHaveLength(0);
    expect(span?.textContent).toBe(s);
    expect(span?.getAttribute('title')).toBe(s);
    expect(span?.getAttribute('data-x')).toBe(s);
  });
});
