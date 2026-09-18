// packages/app/src/ui/settings-panel.ts
/**
 * The settings screen: one table, five sections (Video, Audio, Controls,
 * Accessibility, Language), applied as the player changes them. `get`/`set`
 * are the whole contract with the shell -- this module reads the current
 * `Settings` once per render and writes a whole new object back through
 * `set`, which persists and applies it (`main.ts`'s `settingsDeps.set`). The
 * one exception is an audio slider, which also reaches the mixer LIVE while
 * it is being dragged (`audio`), because "does the game go quiet" is the
 * whole point of that control and a player should not have to release the
 * mouse to find out.
 *
 * `fullscreen` and `keymap` are both nullable: a browser that cannot go
 * fullscreen gets no row for it, and a test that does not exercise the
 * rebind table (or the pre-Task-5 stub, historically) passes `null` rather
 * than either being represented by a broken control.
 *
 * `onChange` is a plain subscriber list, not a second copy of the settings --
 * `set()` is still the only writer. Task 5's keymap section reads bindings
 * fresh from `deps.bindings()` on every row it repaints rather than
 * subscribing here, and Task 6 (the pause menu, mounting this same panel
 * over a running mission) is the one that needs a DIFFERENT mount of this
 * panel to react to a change without polling, which is what this buys it.
 */
import type { AudioGains } from '@lions/render';
import { t } from '../i18n/t';
import type { Locale } from '../i18n/locales';
import type { Disposer } from '../shell/router';
import {
  CAMERA_SPEEDS,
  COLOR_VISIONS,
  QUALITIES,
  TEXT_SIZES,
  UI_SCALES,
  type CameraSpeed,
  type ColorVision,
  type Quality,
  type Settings,
  type TextSize,
  type UiScaleSetting,
} from '../settings';
import { panel } from './panel';
import type { KeymapDeps } from './settings-keymap';

export interface SettingsDeps {
  get(): Settings;
  /** Persists and applies -- see the file header. */
  set(next: Settings): void;
  fullscreen: { supported(): boolean; active(): boolean; set(on: boolean): Promise<void> } | null;
  audio: { setGains(g: AudioGains): void } | null;
  /** `main.ts` passes `LOCALES` (i18n/locales.ts); only `dir` goes unread here. */
  locales: readonly Locale[];
  /** `main.ts` passes `keymapRows(...)`; `null` renders no Controls section
   *  at all, which is what a test that does not exercise the row wants. */
  keymap: KeymapDeps | null;
  /** `__APP_BUILD__`, printed at the foot of the table. */
  build: string;
  /** Fires after every `set()`, with the settings it was called with. */
  onChange(fn: (s: Settings) => void): Disposer;
}

/**
 * One labelled row.
 *
 * Minor 14 (final review): the id used to be
 * `control.getAttribute('name') ?? Math.random()...`, and the fallback was
 * dead -- every control routed through here sets a `name`. It was also worse
 * than dead: a random id changes on every render, so a `label for=` written
 * against one mount cannot be asserted about, and two mounts of this panel
 * (the settings screen and the pause menu's Settings tab, which can both exist
 * in one document) would disagree about the same row. The type now REQUIRES
 * the name, so the compiler enforces what the fallback was papering over.
 */
function row(table: HTMLElement, label: string, control: HTMLElement & { name: string }, hint?: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'rl-settings__row';
  const l = document.createElement('label');
  l.textContent = label;
  const id = `set-${control.name}`;
  control.id = id;
  l.htmlFor = id;
  r.appendChild(l);
  const c = document.createElement('div');
  c.className = 'rl-settings__control';
  c.appendChild(control);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'rl-settings__hint';
    h.textContent = hint;
    c.appendChild(h);
  }
  r.appendChild(c);
  table.appendChild(r);
  return r;
}

function select<T extends string | number>(
  name: string,
  options: readonly T[],
  value: T,
  label: (v: T) => string,
  onChange: (v: T) => void
): HTMLSelectElement {
  const s = document.createElement('select');
  s.name = name;
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o);
    opt.textContent = label(o);
    opt.selected = o === value;
    s.appendChild(opt);
  }
  s.addEventListener('change', () => {
    const picked = options.find((o) => String(o) === s.value);
    if (picked !== undefined) onChange(picked);
  });
  return s;
}

function slider(name: string, value: number, onInput: (v: number) => void, onCommit: (v: number) => void): HTMLInputElement {
  const r = document.createElement('input');
  r.type = 'range';
  r.name = name;
  r.min = '0';
  r.max = '1';
  r.step = '0.05';
  r.value = String(value);
  r.addEventListener('input', () => onInput(Number(r.value)));
  r.addEventListener('change', () => onCommit(Number(r.value)));
  return r;
}

function checkbox(name: string, checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.name = name;
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  return cb;
}

function section(table: HTMLElement, title: string): void {
  const h = document.createElement('h3');
  h.className = 'rl-settings__section';
  h.textContent = title;
  table.appendChild(h);
}

export function settingsPanel(host: HTMLElement, deps: SettingsDeps): { el: HTMLElement; dispose: Disposer } {
  /** Everything this mount has to release. Drained by `dispose` below. */
  const cleanup: Disposer[] = [];
  const p = panel({ rank: 'inspect', title: t('settings.title') });
  p.el.classList.add('rl-settings');
  const table = document.createElement('div');
  table.className = 'rl-settings__table';
  p.body.appendChild(table);

  const update = (mut: (s: Settings) => void): void => {
    const next = structuredClone(deps.get());
    mut(next);
    deps.set(next);
  };
  const s = deps.get();

  section(table, t('settings.video'));
  if (deps.fullscreen?.supported()) {
    const fs = deps.fullscreen;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'fullscreen';
    cb.checked = fs.active();
    const fsRow = row(table, t('settings.fullscreen'), cb);
    // The same `.rl-settings__hint` styling every other row's optional hint
    // already uses -- built here rather than through `row`'s own `hint`
    // param because this one's text only appears AFTER a rejection, not at
    // render time.
    const hint = document.createElement('div');
    hint.className = 'rl-settings__hint';
    fsRow.querySelector('.rl-settings__control')?.appendChild(hint);
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    // Honest, not optimistic: the checkbox only STAYS where the player left
    // it once the browser has actually granted the request. `requestFullscreen`
    // rejects for plenty of ordinary reasons (no user-activation window left,
    // a denied permission, a disallowed iframe) and a control that ignores
    // that reads as broken the next time the player looks at it -- checked,
    // but not actually fullscreen. Neither the checkbox nor `deps.set` (the
    // persisted flag) moves until `fs.set` resolves.
    cb.addEventListener('change', () => {
      const on = cb.checked;
      void (async () => {
        try {
          await fs.set(on);
          update((n) => {
            n.video.fullscreen = on;
          });
        } catch {
          cb.checked = fs.active();
          hint.textContent = t('settings.fullscreen.refused');
          clearTimeout(hintTimer);
          hintTimer = setTimeout(() => {
            hint.textContent = '';
          }, 3000);
        }
      })();
    });
    // Minor 1 (final review): this checkbox was painted once from `fs.active()`
    // and never again, so leaving fullscreen with F11 or Escape -- which this
    // panel is not told about and which writes nothing through `deps.set` --
    // left it ticked while the window was not fullscreen. `fullscreenchange`
    // is the browser's own notification and the only one that fires for those
    // two; `deps.onChange` covers the other direction the file header claims
    // (a SECOND mount of this panel reacting to a change made through the
    // first, without polling), which until now this file did not actually
    // subscribe to at all.
    const repaintFs = (): void => {
      cb.checked = fs.active();
    };
    document.addEventListener('fullscreenchange', repaintFs);
    cleanup.push(() => document.removeEventListener('fullscreenchange', repaintFs));
    cleanup.push(deps.onChange(repaintFs));
    cleanup.push(() => clearTimeout(hintTimer));
  }
  row(
    table,
    t('settings.uiScale'),
    select<UiScaleSetting>(
      'uiScale',
      UI_SCALES,
      s.video.uiScale,
      (v) => (v === 'auto' ? t('settings.uiScale.auto') : t('settings.uiScale.percent', { pct: Math.round(v * 100) })),
      (v) =>
        update((n) => {
          n.video.uiScale = v;
        })
    )
  );
  row(
    table,
    t('settings.textSize'),
    select<TextSize>(
      'textSize',
      TEXT_SIZES,
      s.video.textSize,
      (v) => (v === 1 ? t('settings.textSize.normal') : t('settings.textSize.percent', { pct: Math.round(v * 100) })),
      (v) =>
        update((n) => {
          n.video.textSize = v;
        })
    )
  );
  row(
    table,
    t('settings.quality'),
    select<Quality>(
      'quality',
      QUALITIES,
      s.video.quality,
      (v) =>
        (
          {
            low: t('settings.quality.low'),
            medium: t('settings.quality.medium'),
            high: t('settings.quality.high'),
          } satisfies Record<Quality, string>
        )[v],
      (v) =>
        update((n) => {
          n.video.quality = v;
        })
    ),
    t('settings.quality.hint')
  );

  section(table, t('settings.audio'));
  const live = (k: 'master' | 'music' | 'sfx') => (v: number): void => {
    const g: AudioGains = { ...deps.get().audio, [k]: v };
    deps.audio?.setGains(g);
  };
  for (const [k, label] of [
    ['master', t('settings.audio.master')],
    ['music', t('settings.audio.music')],
    ['sfx', t('settings.audio.sfx')],
  ] as const) {
    row(
      table,
      label,
      slider(k, s.audio[k], live(k), (v) =>
        update((n) => {
          n.audio[k] = v;
        })
      )
    );
  }

  section(table, t('settings.accessibility'));
  row(
    table,
    t('settings.motion'),
    select<'system' | 'reduce'>(
      'motion',
      ['system', 'reduce'],
      s.accessibility.motion,
      (v) => (v === 'system' ? t('settings.motion.system') : t('settings.motion.reduce')),
      (v) =>
        update((n) => {
          n.accessibility.motion = v;
        })
    )
  );
  row(
    table,
    t('settings.colorVision'),
    select<ColorVision>(
      'colorVision',
      COLOR_VISIONS,
      s.accessibility.colorVision,
      (v) =>
        (
          {
            default: t('settings.colorVision.default'),
            deuteranopia: t('settings.colorVision.deuteranopia'),
            protanopia: t('settings.colorVision.protanopia'),
            tritanopia: t('settings.colorVision.tritanopia'),
          } satisfies Record<ColorVision, string>
        )[v],
      (v) =>
        update((n) => {
          n.accessibility.colorVision = v;
        })
    ),
    t('settings.colorVision.hint')
  );

  if (deps.keymap) {
    const keymap = deps.keymap;
    section(table, t('settings.controls'));
    row(
      table,
      t('settings.cameraSpeed'),
      select<CameraSpeed>(
        'cameraSpeed',
        CAMERA_SPEEDS,
        s.controls.cameraSpeed,
        (v) => t('settings.cameraSpeed.multiplier', { x: v }),
        (v) =>
          update((n) => {
            n.controls.cameraSpeed = v;
          })
      )
    );
    row(
      table,
      t('settings.edgePan'),
      checkbox('edgePan', s.controls.edgePan, (v) =>
        update((n) => {
          n.controls.edgePan = v;
        })
      ),
      t('settings.edgePan.hint')
    );
    row(
      table,
      t('settings.zoomToCursor'),
      checkbox('zoomToCursor', s.controls.zoomToCursor, (v) =>
        update((n) => {
          n.controls.zoomToCursor = v;
        })
      ),
      t('settings.zoomToCursor.hint')
    );
    keymap.mount(table);
  }

  section(table, t('settings.language'));
  row(
    table,
    t('settings.language'),
    select<string>(
      'language',
      deps.locales.map((l) => l.id),
      s.language,
      (id) => deps.locales.find((l) => l.id === id)?.name ?? id,
      (v) =>
        update((n) => {
          n.language = v;
        })
    ),
    deps.locales.length === 1 ? t('settings.language.hint') : undefined
  );

  const foot = document.createElement('p');
  foot.className = 'rl-settings__hint';
  foot.textContent = t('common.build', { build: deps.build });
  p.body.appendChild(foot);

  host.appendChild(p.el);
  return {
    el: p.el,
    dispose: () => {
      // Cancels a pending rebind capture and its hint timers -- without this
      // a capture-phase `keydown` armed by "Change" would keep listening on
      // `window` after the player left `/settings` (or Task 6 closed the
      // pause menu mid-capture), answering to a panel that is no longer on
      // screen.
      deps.keymap?.dispose();
      for (const f of cleanup.splice(0)) f();
      p.el.remove();
    },
  };
}

export function showSettings(stage: HTMLElement, deps: SettingsDeps & { back: string }): Disposer {
  const { el, dispose } = settingsPanel(stage, deps);
  const back = document.createElement('a');
  back.className = 'rl-btn rl-menu__item rl-settings__back';
  back.dataset.kind = 'back';
  back.href = deps.back;
  back.textContent = t('nav.backToMenu');
  (el.querySelector('.rl-panel__body') ?? el).appendChild(back);
  return dispose;
}
