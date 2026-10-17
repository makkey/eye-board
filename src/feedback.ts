import type { Lang, Settings } from './types';

type Tone = 'select' | 'long' | 'commit' | 'cancel' | 'start' | 'done';

interface ToneSpec {
  /** [周波数Hz, 長さms] の列 */
  notes: [number, number][];
  wave: OscillatorType;
  gain: number;
  /** 振動できる端末で振動させるパターン（ms） */
  vibrate?: number[];
}

const TONES: Record<Tone, ToneSpec> = {
  // 短く見て候補になった：はっきり聞こえる明るい上昇2音（ここで戻れば確定）
  select: {
    notes: [
      [1175, 90],
      [1760, 160],
    ],
    wave: 'triangle',
    gain: 0.45,
    vibrate: [40],
  },
  // 見続けて長い方に切り替わった：低い下降2音（select と聞き分けられるように）
  long: {
    notes: [
      [523, 140],
      [349, 220],
    ],
    wave: 'square',
    gain: 0.18,
    vibrate: [30, 60, 30],
  },
  commit: {
    notes: [
      [1046, 50],
      [1318, 80],
    ],
    wave: 'sine',
    gain: 0.25,
  },
  cancel: {
    notes: [
      [440, 80],
      [330, 120],
    ],
    wave: 'sine',
    gain: 0.25,
  },
  start: { notes: [[1046, 120]], wave: 'sine', gain: 0.25 },
  done: {
    notes: [
      [784, 70],
      [1046, 120],
    ],
    wave: 'sine',
    gain: 0.25,
  },
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
    const spec = TONES[tone];
    if (spec.vibrate) navigator.vibrate?.(spec.vibrate);
    if (!this.settings.sound || !this.ctx) return;
    let at = this.ctx.currentTime;
    for (const [freq, ms] of spec.notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = spec.wave;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(spec.gain, at + 0.01);
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
