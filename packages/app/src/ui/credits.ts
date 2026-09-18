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
    const licenceBody = document.createElement('pre');
    licenceBody.className = 'rl-credits__licence-text';
    d.appendChild(licenceBody);
    let loaded = false;
    summary.addEventListener('click', () => {
      if (loaded) return;
      loaded = true;
      deps
        .fetchText(`${deps.base}fonts/${font.licenceFile}`)
        .then((text) => {
          licenceBody.textContent = text;
        })
        .catch(() => {
          licenceBody.textContent = t('credits.font.unavailable');
        });
    });
    type.appendChild(d);
  }

  // --- Art and models -----------------------------------------------------
  const art = section(p.body, t('credits.artAndModels'));
  const assets = document.createElement('ul');
  assets.className = 'rl-credits__assets';
  for (const a of CREDITS.assets) {
    const li = document.createElement('li');
    li.textContent = `${a.what} — ${a.author}, ${a.licence} (${a.source})`;
    assets.appendChild(li);
  }
  art.appendChild(assets);
  const disclosure = document.createElement('p');
  disclosure.className = 'rl-credits__disclosure';
  disclosure.textContent = CREDITS.aiDisclosure;
  art.appendChild(disclosure);

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
  back.className = 'rl-btn rl-menu__item rl-credits__back';
  back.dataset.kind = 'back';
  back.href = deps.back;
  back.textContent = t('nav.backToMenu');
  p.body.appendChild(back);

  stagger(wrap);
  stage.appendChild(wrap);
  return () => wrap.remove();
}
