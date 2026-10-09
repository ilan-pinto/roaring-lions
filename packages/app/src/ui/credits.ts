// packages/app/src/ui/credits.ts
/**
 * The credits screen (Task 8): people, libraries, type, art/model
 * attributions and the licence split, all pulled from `credits-data.ts` --
 * which `credits-data.test.ts` pins against `package.json`, `assets/fonts/`
 * and `LICENSE`, so nothing rendered here can drift silently from what
 * actually ships.
 *
 * The OFL texts themselves are NOT bundled into this screen: each font's
 * `<details>` fetches its licence file from `${base}fonts/${licenceFile}`
 * through `deps.fetchText` the first time it is opened, and never again --
 * a player who never expands one costs the game zero extra requests. A
 * failed fetch (offline, a 404) shows a plain fallback line rather than an
 * unhandled rejection or a permanently empty box.
 *
 * `<summary>`'s native `toggle` event is deliberately NOT used to drive the
 * fetch: jsdom updates `.open` on a click but never dispatches `toggle` (only
 * real browsers do), which would make this module untestable without a real
 * browser. A plain `click` listener on `<summary>` works in both, and the
 * native disclosure behaviour (the arrow, showing/hiding the body) still
 * comes free from the element itself.
 */
import { CREDITS } from '../credits-data';
import { t } from '../i18n/t';
import { symbolLabel } from './symbol';
import type { Disposer } from '../shell/router';
import { panel } from './panel';
import { stagger } from './motion';

export interface CreditsDeps {
  /** Deploy base ('/' locally, '/<repo>/' on Pages) -- an OFL file's URL is
   *  built from it the same way every other asset URL in the shell is. */
  base: string;
  /** `__APP_BUILD__`, printed at the foot of the panel like every other
   *  screen that shows one. */
  build: string;
  /** Where the back link goes -- `routes.menu()` from `main.ts`. */
  back: string;
  /** Fetches a URL's body as text. `main.ts` passes the real `fetch`
   *  (rejecting on a non-OK response); a test passes a stub, so this screen
   *  needs no network of its own to be driven. */
  fetchText(url: string): Promise<string>;
}

/** A block of a licence text, as the credits screen sets it. */
export type LicenceBlock = { kind: 'rule' } | { kind: 'head' | 'para'; text: string };

/**
 * PA-29: the OFL files are hard-wrapped at ~72 columns, and printing them in a
 * `<pre>` left a ragged column of broken lines. This reflows them into
 * paragraphs, sets the all-caps section titles as headings and the dashed
 * divider as a rule. NOTHING is dropped but the divider's dashes and the line
 * breaks: the licence text must ship whole, and `credits.test.ts` compares the
 * words of every shipped file with what this returns.
 *
 * A heading is a short, all-caps FIRST line of a paragraph (the disclaimer's
 * body is all caps too, but its lines are long and never first); "1) " starts
 * a new paragraph even with no blank line before it.
 */
export function licenceBlocks(text: string): LicenceBlock[] {
  const blocks: LicenceBlock[] = [];
  let held: string[] = [];
  const flush = (): void => {
    if (held.length > 0) blocks.push({ kind: 'para', text: held.join(' ') });
    held = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      flush();
    } else if (/^-{5,}$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
    } else if (held.length === 0 && line.length <= 32 && /[A-Z]{3}/.test(line) && line === line.toUpperCase()) {
      blocks.push({ kind: 'head', text: line });
    } else {
      if (/^\d\)\s/.test(line)) flush();
      held.push(line);
    }
  }
  flush();
  return blocks;
}

function licenceBody(into: HTMLElement, text: string): void {
  into.replaceChildren();
  for (const b of licenceBlocks(text)) {
    if (b.kind === 'rule') {
      into.appendChild(document.createElement('hr'));
      continue;
    }
    const el = document.createElement(b.kind === 'head' ? 'h4' : 'p');
    if (b.kind === 'head') el.className = 'rl-credits__licence-head';
    el.textContent = b.text;
    into.appendChild(el);
  }
}

function section(body: HTMLElement, title: string): HTMLElement {
  const h = document.createElement('h3');
  h.className = 'rl-credits__section';
  h.textContent = title;
  body.appendChild(h);
  const block = document.createElement('div');
  block.className = 'rl-credits__block';
  body.appendChild(block);
  return block;
}

export function showCredits(stage: HTMLElement, deps: CreditsDeps): Disposer {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu rl-menu--credits';

  const p = panel({ rank: 'inspect', title: t('credits.title') });
  wrap.appendChild(p.el);

  // --- Made by --------------------------------------------------------------
  const made = section(p.body, t('credits.madeBy'));
  const people = document.createElement('p');
  people.className = 'rl-credits__people';
  people.textContent = CREDITS.people.join(', ');
  made.appendChild(people);

  // --- Built with -------------------------------------------------------------
  const built = section(p.body, t('credits.builtWith'));
  const libs = document.createElement('ul');
  libs.className = 'rl-credits__libs';
  for (const lib of CREDITS.libraries) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = lib.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${lib.name} ${lib.version}`;
    li.append(a, document.createTextNode(` — ${lib.licence}`));
    libs.appendChild(li);
  }
  built.appendChild(libs);

  // --- Type -------------------------------------------------------------------
  const type = section(p.body, t('credits.type'));
  for (const font of CREDITS.fonts) {
    const d = document.createElement('details');
    d.className = 'rl-credits__font';
    const summary = document.createElement('summary');
    summary.textContent = t('credits.font.summary', { family: font.family, holder: font.holder });
    d.appendChild(summary);
    // A scrolling region, so a keyboard can reach it (PA-29: no longer a `<pre>`).
    const licenceEl = document.createElement('div');
    licenceEl.className = 'rl-credits__licence-text';
    licenceEl.tabIndex = 0;
    licenceEl.setAttribute('role', 'region');
    licenceEl.setAttribute('aria-label', t('credits.font.licenceRegion', { family: font.family }));
    d.appendChild(licenceEl);
    let loaded = false;
    summary.addEventListener('click', () => {
      if (loaded) return;
      loaded = true;
      deps
        .fetchText(`${deps.base}fonts/${font.licenceFile}`)
        .then((text) => {
          licenceBody(licenceEl, text);
        })
        .catch(() => {
          licenceEl.textContent = t('credits.font.unavailable');
        });
    });
    type.appendChild(d);
  }

  // --- Art and models -----------------------------------------------------
  const art = section(p.body, t('credits.artAndModels'));
  const assets = document.createElement('ul');
  assets.className = 'rl-credits__assets';
  // Every URI is printed as its own link text, not hidden behind a label: a
  // CC BY credit has to carry the URI itself, and a player reading this
  // screen in a build where links do not open should still be able to copy it.
  const link = (href: string): HTMLAnchorElement => {
    const el = document.createElement('a');
    el.href = href;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.textContent = href;
    return el;
  };
  for (const a of CREDITS.assets) {
    const li = document.createElement('li');
    li.className = 'rl-credits__asset';
    const line = document.createElement('p');
    line.textContent = t('credits.asset.line', {
      title: a.title,
      author: a.author,
      source: a.source,
      licence: a.licence,
      use: t(a.useKey),
    });
    const src = document.createElement('p');
    src.className = 'rl-credits__uri';
    src.append(document.createTextNode(t('credits.asset.sourceLabel')), link(a.sourceUrl));
    const lic = document.createElement('p');
    lic.className = 'rl-credits__uri';
    lic.append(document.createTextNode(t('credits.asset.licenceLabel')), link(a.licenceUrl));
    li.append(line, src, lic);
    assets.appendChild(li);
  }
  if (CREDITS.assets.length > 0) art.appendChild(assets);
  for (const key of CREDITS.aiDisclosure) {
    const disclosure = document.createElement('p');
    disclosure.className = 'rl-credits__disclosure';
    disclosure.textContent = t(key);
    art.appendChild(disclosure);
  }

  // --- Licence --------------------------------------------------------------
  const licence = section(p.body, t('credits.licence'));
  const licenceP = document.createElement('p');
  licenceP.textContent = t('credits.licence.line', { code: CREDITS.codeLicence, art: CREDITS.artLicence });
  licence.appendChild(licenceP);

  const build = document.createElement('p');
  build.className = 'rl-dim rl-credits__build';
  build.textContent = t('common.build', { build: deps.build });
  p.body.appendChild(build);

  const back = document.createElement('a');
  back.className = 'rl-btn rl-credits__back';
  back.dataset.kind = 'back';
  back.href = deps.back;
  back.innerHTML = symbolLabel('back', t('nav.backToMenu'));
  p.body.appendChild(back);

  stagger(wrap);
  stage.appendChild(wrap);
  return () => wrap.remove();
}
