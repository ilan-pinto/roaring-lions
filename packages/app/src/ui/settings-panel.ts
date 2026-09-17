// packages/app/src/ui/settings-panel.ts
/**
 * The settings screen: one table, four sections today (Video, Audio,
 * Accessibility, Language -- Controls joins once Task 5 supplies a `keymap`),
 * applied as the player changes them. `get`/`set` are the whole contract with
 * the shell -- this module reads the current `Settings` once per render and
 * writes a whole new object back through `set`, which persists and applies it
 * (`main.ts`'s `settingsDeps.set`). The one exception is an audio slider,
 * which also reaches the mixer LIVE while it is being dragged (`audio`),
 * because "does the game go quiet" is the whole point of that control and a
 * player should not have to release the mouse to find out.
 *
 * `fullscreen` and `keymap` are both nullable: a browser that cannot go
 * fullscreen gets no row for it, and Task 5's rebind table simply has not
 * landed yet, rather than either being represented by a broken control.
 *
 * `onChange` is a plain subscriber list, not a second copy of the settings --
 * `set()` is still the only writer. Task 5 (live-previewing a rebind) and
 * Task 6 (the pause menu, mounting this same panel over a running mission)
 * both need to react to a change made through a DIFFERENT mount of this
 * panel without polling, which is what this buys them.
 */
import type { AudioGains } from '@lions/render';
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
  /** Task 9 fills this; `[{ id: 'en', name: 'English' }]` until then. */
  locales: readonly { id: string; name: string }[];
  /** Task 5 fills this; `null` renders no Controls section at all. */
  keymap: KeymapDeps | null;
  /** `__APP_BUILD__`, printed at the foot of the table. */
  build: string;
  /** Fires after every `set()`, with the settings it was called with. */
  onChange(fn: (s: Settings) => void): Disposer;
}

function row(table: HTMLElement, label: string, control: HTMLElement, hint?: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'rl-settings__row';
  const l = document.createElement('label');
  l.textContent = label;
  const id = `set-${control.getAttribute('name') ?? Math.random().toString(36).slice(2)}`;
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

function checkbox(name: string, value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.name = name;
  c.checked = value;
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}

function section(table: HTMLElement, title: string): void {
  const h = document.createElement('h3');
  h.className = 'rl-settings__section';
  h.textContent = title;
  table.appendChild(h);
}

export function settingsPanel(host: HTMLElement, deps: SettingsDeps): { el: HTMLElement; dispose: Disposer } {
  const p = panel({ rank: 'inspect', title: 'Settings' });
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

  section(table, 'Video');
  if (deps.fullscreen?.supported()) {
    const fs = deps.fullscreen;
    row(
      table,
      'Fullscreen',
      checkbox('fullscreen', fs.active(), (on) => {
        void fs.set(on);
        update((n) => {
          n.video.fullscreen = on;
        });
      })
    );
  }
  row(
    table,
    'Interface scale',
    select<UiScaleSetting>(
      'uiScale',
      UI_SCALES,
      s.video.uiScale,
      (v) => (v === 'auto' ? 'Automatic (by screen width)' : `${Math.round(v * 100)}%`),
      (v) =>
        update((n) => {
          n.video.uiScale = v;
        })
    )
  );
  row(
    table,
    'Text size',
    select<TextSize>(
      'textSize',
      TEXT_SIZES,
      s.video.textSize,
      (v) => (v === 1 ? 'Normal' : `${Math.round(v * 100)}%`),
      (v) =>
        update((n) => {
          n.video.textSize = v;
        })
    )
  );
  row(
    table,
    'Render quality',
    select<Quality>(
      'quality',
      QUALITIES,
      s.video.quality,
      (v) =>
        (
          {
            low: 'Low — no ambient occlusion, no anti-aliasing, soft shadows',
            medium: 'Medium — anti-aliasing, 2K shadows',
            high: 'High — everything, 4K shadows',
          } satisfies Record<Quality, string>
        )[v],
      (v) =>
        update((n) => {
          n.video.quality = v;
        })
    ),
    'applies when the next mission starts.'
  );

  section(table, 'Audio');
  const live = (k: 'master' | 'music' | 'sfx') => (v: number): void => {
    const g: AudioGains = { ...deps.get().audio, [k]: v };
    deps.audio?.setGains(g);
  };
  for (const [k, label] of [
    ['master', 'Master'],
    ['music', 'Music'],
    ['sfx', 'Effects'],
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

  section(table, 'Accessibility');
  row(
    table,
    'Motion',
    select<'system' | 'reduce'>(
      'motion',
      ['system', 'reduce'],
      s.accessibility.motion,
      (v) => (v === 'system' ? 'Follow the system setting' : 'Reduce motion'),
      (v) =>
        update((n) => {
          n.accessibility.motion = v;
        })
    )
  );
  row(
    table,
    'Colour vision',
    select<ColorVision>(
      'colorVision',
      COLOR_VISIONS,
      s.accessibility.colorVision,
      (v) =>
        (
          {
            default: 'Default',
            deuteranopia: 'Deuteranopia (red–green)',
            protanopia: 'Protanopia (red–green)',
            tritanopia: 'Tritanopia (blue–yellow)',
          } satisfies Record<ColorVision, string>
        )[v],
      (v) =>
        update((n) => {
          n.accessibility.colorVision = v;
        })
    ),
    'Team colours on the map, the minimap and the HUD.'
  );

  if (deps.keymap) {
    const keymap = deps.keymap;
    section(table, 'Controls');
    row(
      table,
      'Camera speed',
      select<CameraSpeed>(
        'cameraSpeed',
        CAMERA_SPEEDS,
        s.controls.cameraSpeed,
        (v) => `${v}×`,
        (v) =>
          update((n) => {
            n.controls.cameraSpeed = v;
          })
      )
    );
    keymap.mount(table);
  }

  section(table, 'Language');
  row(
    table,
    'Language',
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
    deps.locales.length === 1 ? 'More languages are coming.' : undefined
  );

  const foot = document.createElement('p');
  foot.className = 'rl-settings__hint';
  foot.textContent = `Build ${deps.build}`;
  p.body.appendChild(foot);

  host.appendChild(p.el);
  return { el: p.el, dispose: () => p.el.remove() };
}

export function showSettings(stage: HTMLElement, deps: SettingsDeps & { back: string }): Disposer {
  const { el, dispose } = settingsPanel(stage, deps);
  const back = document.createElement('a');
  back.className = 'rl-btn rl-menu__item rl-settings__back';
  back.dataset.kind = 'back';
  back.href = deps.back;
  back.textContent = '← main menu';
  (el.querySelector('.rl-panel__body') ?? el).appendChild(back);
  return dispose;
}
