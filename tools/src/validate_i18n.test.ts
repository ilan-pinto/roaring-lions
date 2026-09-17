import { describe, expect, it } from 'vitest';
import { bareStringFailures } from '../validate_i18n.mjs';

describe('bareStringFailures', () => {
  it('flags a literal with words assigned to a text sink', () => {
    expect(bareStringFailures('x.ts', `el.textContent = 'Deploy now';`)).toHaveLength(1);
    expect(bareStringFailures('x.ts', 'el.title = `Leave the mission`;')).toHaveLength(1);
    expect(bareStringFailures('x.ts', `el.setAttribute('aria-label', 'Close');`)).toHaveLength(1);
    expect(bareStringFailures('x.ts', 'el.innerHTML = `<b>enemy reinforcements</b> inbound`;')).toHaveLength(1);
  });
  it('accepts t() calls, glyphs, ids and data passthrough', () => {
    expect(bareStringFailures('x.ts', `el.textContent = t('menu.campaign');`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = '▮▮';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = '1×';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = mission.name;`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.className = 'rl-menu__back';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = \`\${n} / \${m}\`;`)).toEqual([]);
  });
  it('honours a line-level exemption comment for a proper noun', () => {
    expect(bareStringFailures('x.ts', `el.textContent = 'Roaring Lions'; /* i18n-ok: proper noun */`)).toEqual([]);
  });
});
