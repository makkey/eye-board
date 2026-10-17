import type { Settings } from './types';

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
  private voice: SpeechSynthesisVoice | null = null;

  constructor(private settings: Settings) {
    if ('speechSynthesis' in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        this.voice = voices.find((v) => v.lang === 'ja-JP') ?? voices.find((v) => v.lang.startsWith('ja')) ?? null;
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

  /** 読み上げる。終わったら（または読み上げできなければすぐ）resolve */
  say(text: string, force = false): Promise<void> {
    if ((!this.settings.tts && !force) || !('speechSynthesis' in window)) return Promise.resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = this.settings.ttsRate;
    if (this.voice) u.voice = this.voice;
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
