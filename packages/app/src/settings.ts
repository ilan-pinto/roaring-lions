/**
 * The player's settings: one JSON object under `lions.settings`, beside the
 * ledger and the brigade account. Parsing is tolerant FIELD BY FIELD — a bad
 * value falls back to its own default and every neighbour survives, because a
 * settings blob that resets wholesale over one bad key teaches the player not
 * to touch settings. Unknown keys are dropped so a downgrade cannot smuggle
 * state forward.
 *
 * `applySettings` is the ONLY writer of the three root hooks the CSS reads:
 * `--ui-scale` (inline overrides theme.css's media steps; absent means auto),
 * `--text-size` (a second multiplier on the rem), `data-motion` and
 * `data-cvd`. The audio gains and the render quality are applied by their
 * owners (main.ts) from the same object.
 */
import type { StorageLike } from './brigade-account';

export type { StorageLike };
export type UiScaleSetting = 'auto' | 0.85 | 1 | 1.15 | 1.4;
export type TextSize = 1 | 1.15 | 1.3;
export type Quality = 'low' | 'medium' | 'high';
export type ColorVision = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type CameraSpeed = 0.5 | 1 | 1.5 | 2;

export interface Settings {
  version: 1;
  video: { fullscreen: boolean; uiScale: UiScaleSetting; textSize: TextSize; quality: Quality };
  audio: { master: number; music: number; sfx: number };
  controls: { cameraSpeed: CameraSpeed; bindings: Record<string, string> };
  accessibility: { motion: 'system' | 'reduce'; colorVision: ColorVision };
  language: string;
}

export const SETTINGS_KEY = 'lions.settings';

export const UI_SCALES: readonly UiScaleSetting[] = ['auto', 0.85, 1, 1.15, 1.4];
export const TEXT_SIZES: readonly TextSize[] = [1, 1.15, 1.3];
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
export const COLOR_VISIONS: readonly ColorVision[] = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];
export const CAMERA_SPEEDS: readonly CameraSpeed[] = [0.5, 1, 1.5, 2];

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  video: { fullscreen: false, uiScale: 'auto', textSize: 1, quality: 'high' },
  audio: { master: 1, music: 1, sfx: 1 },
  controls: { cameraSpeed: 1, bindings: {} },
  accessibility: { motion: 'system', colorVision: 'default' },
  language: 'en',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T,>(allowed: readonly T[], v: unknown, dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const unit = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : dflt);
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt);

function bindings(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string' && val.length > 0) out[k] = val;
  return out;
}

export function parseSettings(raw: string | null): Settings {
  if (raw === null) return structuredClone(DEFAULT_SETTINGS);
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
  if (!isRecord(v) || v.version !== 1) return structuredClone(DEFAULT_SETTINGS);
  const d = DEFAULT_SETTINGS;
  const video = isRecord(v.video) ? v.video : {};
  const audio = isRecord(v.audio) ? v.audio : {};
  const controls = isRecord(v.controls) ? v.controls : {};
  const acc = isRecord(v.accessibility) ? v.accessibility : {};
  return {
    version: 1,
    video: {
      fullscreen: bool(video.fullscreen, d.video.fullscreen),
      uiScale: oneOf(UI_SCALES, video.uiScale, d.video.uiScale),
      textSize: oneOf(TEXT_SIZES, video.textSize, d.video.textSize),
      quality: oneOf(QUALITIES, video.quality, d.video.quality),
    },
    audio: { master: unit(audio.master, 1), music: unit(audio.music, 1), sfx: unit(audio.sfx, 1) },
    controls: { cameraSpeed: oneOf(CAMERA_SPEEDS, controls.cameraSpeed, 1), bindings: bindings(controls.bindings) },
    accessibility: {
      motion: oneOf(['system', 'reduce'] as const, acc.motion, 'system'),
      colorVision: oneOf(COLOR_VISIONS, acc.colorVision, 'default'),
    },
    language: typeof v.language === 'string' && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(v.language) ? v.language : 'en',
  };
}

export function loadSettings(store: StorageLike | null): Settings {
  if (!store) return structuredClone(DEFAULT_SETTINGS);
  try {
    return parseSettings(store.getItem(SETTINGS_KEY));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(store: StorageLike | null, s: Settings): void {
  if (!store) return;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // A blocked store keeps this session's settings in memory; nothing to say.
  }
}

export function applySettings(s: Settings, root: HTMLElement): void {
  if (s.video.uiScale === 'auto') root.style.removeProperty('--ui-scale');
  else root.style.setProperty('--ui-scale', String(s.video.uiScale));
  root.style.setProperty('--text-size', String(s.video.textSize));
  root.dataset.motion = s.accessibility.motion;
  root.dataset.cvd = s.accessibility.colorVision;
  root.setAttribute('lang', s.language);
}
