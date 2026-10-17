import { buildCalibration } from './classifier';
import type { Calibration, Feature } from './classifier';
import type { Feedback } from './feedback';
import type { TrackerFrame } from './tracker';
import { ALL_CLASSES, DIR_NAME_JA } from './types';
import type { GazeClass } from './types';

export type CalStep = GazeClass;

// 「下を見る」と「目を閉じる」は紛れやすいので、最後にもう一度ずつ記録する
const STEPS: CalStep[] = ['C', 'U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL', 'C', 'closed', 'D', 'closed'];

const SETTLE_MS = 700;
const RECORD_MS = 1500;

export function stepInstruction(step: CalStep): string {
  if (step === 'C') return '画面の中央を見てください';
  if (step === 'closed') return '目を閉じてください。音が鳴ったら開けてください';
  return `${DIR_NAME_JA[step]}を見てください`;
}

export interface CalProgress {
  index: number;
  total: number;
  step: CalStep;
  phase: 'announce' | 'settle' | 'record';
  /** record 中の進み具合 0〜1 */
  progress: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 中央・8方向・目を閉じた状態を順に音声で案内し、サンプルを集める。
 * 画面を見られない方向もあるので、案内は読み上げと効果音が主。
 */
export class CalibrationRun {
  private samples = Object.fromEntries(ALL_CLASSES.map((c) => [c, []])) as unknown as Record<
    GazeClass,
    Feature[]
  >;
  private recording: CalStep | null = null;
  private aborted = false;
  private missed = 0;
  private seen = 0;

  constructor(
    private feedback: Feedback,
    private onProgress: (p: CalProgress) => void,
  ) {}

  push(f: TrackerFrame) {
    if (!this.recording) return;
    this.seen++;
    if (!f.faceFound) {
      this.missed++;
      return;
    }
    this.samples[this.recording].push([...f.feature]);
  }

  abort() {
    this.aborted = true;
    this.recording = null;
    speechSynthesis?.cancel();
  }

  async run(): Promise<Calibration> {
    await this.feedback.say('キャリブレーションを始めます。顔は動かさず、目だけを大きく動かしてください。', true);
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      const base = { index: i, total: STEPS.length, step };
      this.check();
      this.onProgress({ ...base, phase: 'announce', progress: 0 });
      await this.feedback.say(stepInstruction(step), true);
      this.check();
      this.onProgress({ ...base, phase: 'settle', progress: 0 });
      await sleep(step === 'closed' ? SETTLE_MS + 300 : SETTLE_MS);
      this.check();
      this.recording = step;
      const start = performance.now();
      while (performance.now() - start < RECORD_MS) {
        this.onProgress({ ...base, phase: 'record', progress: (performance.now() - start) / RECORD_MS });
        await sleep(50);
        this.check();
      }
      this.recording = null;
      this.feedback.play('done');
    }
    if (this.seen === 0) {
      throw new Error('カメラの映像を顔認識に渡せていません。');
    }
    if (this.missed / this.seen > 0.5) {
      throw new Error('顔を見失うことが多すぎました。カメラの位置や明るさを確認してください。');
    }
    const cal = buildCalibration(this.samples);
    await this.feedback.say('キャリブレーションが完了しました', true);
    return cal;
  }

  private check() {
    if (this.aborted) throw new Error('中断しました');
  }
}
