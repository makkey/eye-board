import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  selectMs: 600,
  longMs: 2000,
  closeMinMs: 600,
  idleMs: 5000,
  debounceMs: 100,
  smoothing: 0.5,
  hysteresis: 0.75,
  centerBias: 1.0,
  closedBias: 1.0,
  tts: true,
  sound: true,
  ttsRate: 1.3,
  lang: 'ja',
  jaInput: 'kana',
  // ラボの測定で、文節ごとの変換の精度・速さ・費用の釣り合いが最も良かった組み合わせ
  aiProvider: 'gemini',
  aiModel: 'gemini-3.8-flash',
  aiEffort: 'low',
  aiRuns: 1,
  // 文頭の文節は文脈が無く外れやすいので、最初の1文字だけ12キーで正確に入れる
  aiHead: 'start',
};

const KEY = 'eyeboard.settings.v1';
/** 保存形式の版。2: selectMs の既定値を 400 → 600 に変更 */
const VERSION = 2;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // 旧版の既定値のまま保存されていたら、新しい既定値に移す
      if ((saved._v ?? 1) < 2 && saved.selectMs === 400) delete saved.selectMs;
      delete saved._v;
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {
    // 保存領域が使えない環境では既定値
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, _v: VERSION }));
  } catch {
    // ignore
  }
}
