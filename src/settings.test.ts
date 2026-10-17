import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

function stubStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => (store[k] = v),
    removeItem: (k: string) => delete store[k],
  });
  return store;
}

describe('settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('旧版で既定値（400ms）のまま保存されていたら 600ms に移す', () => {
    stubStorage({ 'eyeboard.settings.v1': JSON.stringify({ ...DEFAULT_SETTINGS, selectMs: 400, lang: 'en' }) });
    const s = loadSettings();
    expect(s.selectMs).toBe(600);
    expect(s.lang).toBe('en');
  });

  it('旧版でも自分で変えた値はそのまま', () => {
    stubStorage({ 'eyeboard.settings.v1': JSON.stringify({ ...DEFAULT_SETTINGS, selectMs: 500 }) });
    expect(loadSettings().selectMs).toBe(500);
  });

  it('新しい版で 400ms を選んで保存した値はそのまま', () => {
    stubStorage();
    saveSettings({ ...DEFAULT_SETTINGS, selectMs: 400 });
    expect(loadSettings().selectMs).toBe(400);
  });
});
