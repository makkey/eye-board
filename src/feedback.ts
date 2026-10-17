import type { Lang, Settings } from './types';

type Tone = 'tick' | 'long' | 'commit' | 'cancel' | 'start' | 'done';

const TONES: Record<Tone, [number, number][]> = {
  // [周波数Hz, 長さms] の列
  tick: [[880, 60]],
  long: [
    [660, 60],
    [990, 80],
  ],
  commit: [
    [1046, 50],
    [1318, 80],
  ],
  cancel: [
    [440, 80],
    [330, 120],
  ],
  start: [[1046, 120]],
  done: [
    [784, 70],
    [1046, 120],
  ],
};

/** 画面を見ていない間の手がかりになる音と読み上げ */
export class Feedback {
  private ctx: AudioContext | null = null;
  private voices: Partial<Record<Lang, SpeechSynthesisVoice>> = {};

  constructor(private settings: Settings) {
    if ('speechSynthesis' in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        const find = (exact: string, prefix: string) =>
          voices.find((v) => v.lang === exact) ?? voices.find((v) => v.lang.startsWith(prefix));
        this.voices = { ja: find('ja-JP', 'ja'), en: find('en-US', 'en') };
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  /** ユーザー操作の中で呼ぶ（自動再生制限の解除） */
  unlock() {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  play(tone: Tone) {
    if (!this.settings.sound || !this.ctx) return;
    let at = this.ctx.currentTime;
    for (const [freq, ms] of TONES[tone]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(at);
      osc.stop(at + ms / 1000 + 0.02);
      at += ms / 1000;
    }
  }

  /**
   * 読み上げる。終わったら（または読み上げできなければすぐ）resolve。
   * lang を省くと、入力中の言語（settings.lang）の声で読む
   */
  say(text: string, force = false, lang: Lang = this.settings.lang): Promise<void> {
    if ((!this.settings.tts && !force) || !('speechSynthesis' in window)) return Promise.resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'en' ? 'en-US' : 'ja-JP';
    u.rate = this.settings.ttsRate;
    const voice = this.voices[lang];
    if (voice) u.voice = voice;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 600 + text.length * 250);
      u.onend = u.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }
}
