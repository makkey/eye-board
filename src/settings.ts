import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  selectMs: 400,
  longMs: 2000,
  closeMinMs: 600,
  restCloseMs: 1500,
  idleMs: 5000,
  debounceMs: 100,
  smoothing: 0.5,
  hysteresis: 0.75,
  centerBias: 1.0,
  tts: true,
  sound: true,
  ttsRate: 1.3,
};

const KEY = 'eyeboard.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // 保存領域が使えない環境では既定値
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
