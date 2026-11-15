/**
 * The avatar picker sheet (GH-1075 P6): a `.rl-confirm`-family modal, built on `confirm.ts`'s skeleton like the
 * feedback dialog: the scrim, `role=dialog` + `aria-modal` + `aria-labelledby`, opener focus captured and restored, the
 * focus trap, Escape and a scrim click to close, and a capture-phase guard that keeps game keys out. It registers with
 * `trackOpenDialog`, so `isDialogOpen()` is true while it is up and `closeOpenDialog()` takes it down.
 *
 * The sheet mounts on `document.body`, which the router never empties: whoever opens it closes it (the profile's
 * disposer). `close` is idempotent, and a Save that settles after it is ignored.
 *
 * Crests only for now: a family with no presets draws no group (the Units group arrives with the busts).
 */
import { avatarPresets, defaultAvatar, type AvatarView } from '@lions/data';
import type { AccountError } from '../account/client';
import { t } from '../i18n/t';
import { avatarElement } from './avatar';
import { trackOpenDialog } from './confirm';
import { focusTrap } from './focus-trap';
import { panel } from './panel';

export interface AvatarPickerDeps {
  /** What `me` resolved: the selection starts here. */
  current: AvatarView;
  publicId: string;
  /** Sends the one PATCH: a preset id, or null to go back to the default. */
  save: (avatar: string | null) => Promise<'ok' | AccountError>;
  /** After a successful save, just before the sheet closes. */
  onSaved: (avatar: string | null) => void;
  /** However the sheet ends (Save, Cancel, Escape, the scrim, `close()`), once. */
  onClose?: () => void;
}

const FAMILIES = [
  { family: 'crest', title: 'avatar.picker.crests' },
  { family: 'unit', title: 'avatar.picker.units' },
] as const;

const ARROW: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

let titleSeq = 0;

export function avatarPicker(host: HTMLElement, deps: AvatarPickerDeps): { close: () => void } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const def = defaultAvatar(deps.publicId);
  let selected = deps.current.kind === 'preset' ? deps.current.id : deps.current.fallback;
  /** "Use my default" was the last thing picked: Save sends null, not the id. */
  let reset = deps.current.kind === 'preset' && !deps.current.chosen && selected === def;
  let saving = false;
  let closed = false;

  const scrim = document.createElement('div');
  scrim.className = 'rl-confirm rl-avatar-picker';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  const p = panel({ rank: 'inspect', title: t('avatar.picker.title') });
  p.el.classList.add('rl-confirm__panel', 'rl-avatar-picker__panel');
  const titleEl = p.el.querySelector<HTMLElement>('.rl-panel__title');
  if (titleEl !== null) {
    titleEl.id = `rl-avatar-picker-title-${++titleSeq}`;
    scrim.setAttribute('aria-labelledby', titleEl.id);
  }
  const disposeTrap = focusTrap(p.el);

  const preview = document.createElement('div');
  preview.className = 'rl-avatar-picker__preview';
  const previewName = document.createElement('p');
  previewName.className = 'rl-avatar-picker__name';
  const labelOf = (id: string): string => t(avatarPresets.find((x) => x.id === id)?.label ?? 'avatar.preset.crest-chevrons');
  const paintPreview = (): void => {
    previewName.textContent = labelOf(selected);
    preview.replaceChildren(avatarElement({ kind: 'preset', id: selected, chosen: true }, deps.publicId, 'head'), previewName);
  };

  const tiles = new Map<string, HTMLButtonElement>();
  const order: string[] = [];
  const groups = document.createElement('div');
  groups.className = 'rl-avatar-picker__groups';
  for (const { family, title } of FAMILIES) {
    const members = avatarPresets.filter((x) => x.family === family);
    if (members.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'rl-avatar-picker__group';
    const heading = document.createElement('p');
    heading.className = 'rl-avatar-picker__heading';
    heading.id = `rl-avatar-picker-${family}-${titleSeq}`;
    heading.textContent = t(title);
    const grid = document.createElement('div');
    grid.className = 'rl-avatar-picker__grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-labelledby', heading.id);
    for (const preset of members) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'rl-avatar-picker__tile';
      tile.setAttribute('role', 'radio');
      tile.setAttribute('aria-label', t(preset.label));
      tile.dataset.preset = preset.id;
      tile.appendChild(avatarElement({ kind: 'preset', id: preset.id, chosen: true }, deps.publicId, 'tile'));
      if (preset.id === def) {
        const tag = document.createElement('span');
        tag.className = 'rl-avatar-picker__tag';
        tag.textContent = t('avatar.picker.default');
        tile.appendChild(tag);
      }
      tile.addEventListener('click', () => choose(preset.id, false));
      tiles.set(preset.id, tile);
      order.push(preset.id);
      grid.appendChild(tile);
    }
    group.append(heading, grid);
    groups.appendChild(group);
  }

  const status = document.createElement('p');
  status.className = 'rl-avatar-picker__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const mkButton = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const useDefault = mkButton(t('avatar.picker.useDefault'), 'rl-btn rl-avatar-picker__default', () => choose(def, true));
  const cancel = mkButton(t('avatar.picker.cancel'), 'rl-btn rl-avatar-picker__cancel', () => close());
  const saveBtn = mkButton(t('avatar.picker.save'), 'rl-btn rl-avatar-picker__save', () => void doSave());
  const row = document.createElement('div');
  row.className = 'rl-avatar-picker__row';
  row.append(useDefault, cancel, saveBtn);

  function paintTiles(): void {
    for (const [id, tile] of tiles) {
      const on = id === selected;
      tile.setAttribute('aria-checked', on ? 'true' : 'false');
      tile.tabIndex = on ? 0 : -1;
      tile.dataset.checked = on ? '1' : '0';
    }
  }
  function choose(id: string, asDefault: boolean): void {
    if (saving || closed) return;
    selected = id;
    reset = asDefault;
    paintTiles();
    paintPreview();
    status.textContent = '';
    status.classList.remove('rl-bad');
  }
  async function doSave(): Promise<void> {
    if (saving || closed) return;
    saving = true;
    saveBtn.disabled = true;
    const sent = reset ? null : selected;
    const r = await deps.save(sent);
    if (closed) return;
    saving = false;
    saveBtn.disabled = false;
    if (r === 'ok') {
      deps.onSaved(sent);
      close();
    } else {
      status.textContent = t('profile.error');
      status.classList.add('rl-bad');
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    release();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onCaptureKey, true);
    disposeTrap();
    scrim.remove();
    opener?.focus();
    deps.onClose?.();
  }
  const release = trackOpenDialog(close);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  // Arrow keys are answered HERE, in the capture phase: the guard below stops every other key before it reaches the
  // tiles, so a handler on the tile itself would never run. Space and Enter are the buttons' own click.
  const onCaptureKey = (e: KeyboardEvent): void => {
    const dir = ARROW[e.key];
    const target = e.target instanceof Element ? e.target : null;
    if (dir !== undefined && target !== null && scrim.contains(target) && target.closest('[role="radiogroup"]') !== null) {
      e.preventDefault();
      e.stopPropagation();
      if (saving) return;
      const at = order.indexOf(selected);
      const next = order[(at + dir + order.length) % order.length];
      if (next === undefined) return;
      choose(next, false);
      tiles.get(next)?.focus();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return;
    e.stopPropagation();
  };
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onCaptureKey, true);

  p.body.append(preview, groups, status, row);
  paintTiles();
  paintPreview();
  scrim.appendChild(p.el);
  host.appendChild(scrim);
  (tiles.get(selected) ?? cancel).focus();
  return { close };
}
