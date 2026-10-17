import { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { Category, NormalizedLandmark } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { Feature } from './classifier';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface TrackerFrame {
  t: number;
  faceFound: boolean;
  /** 平滑化済みの特徴量（classifier.ts 参照） */
  feature: Feature;
  landmarks?: NormalizedLandmark[];
}

// 目ごとのランドマーク番号：[目尻/目頭, 目頭/目尻, 上まぶた, 下まぶた]
const EYES: [number, number, number, number][] = [
  [33, 133, 159, 145],
  [362, 263, 386, 374],
];
const IRIS_CENTERS = [468, 473];

export class Tracker {
  private landmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private running = false;
  private smoothed: Feature | null = null;
  private lastVideoTime = -1;
  private lastTs = 0;
  private recreating = false;

  /** 0〜1。1 = 平滑化なし */
  smoothing = 0.5;
  onFrame: (f: TrackerFrame) => void = () => {};

  /** 診断用：使っている処理装置、処理したフレーム数、直近のエラー */
  delegate: 'GPU' | 'CPU' = 'GPU';
  frames = 0;
  lastFrameAt = 0;
  lastError: string | null = null;
  /** 数値にならなかった（NaN など）フレームの数と、その時の様子 */
  badFrames = 0;
  lastBad: string | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** onStatus には進み具合（'camera' → 'model' → 'ready'）を渡す。文言は呼び出し側で決める */
  async start(onStatus: (step: 'camera' | 'model' | 'ready') => void) {
    onStatus('camera');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    if (!this.landmarker) {
      onStatus('model');
      try {
        this.landmarker = await createLandmarker('GPU');
        this.delegate = 'GPU';
      } catch (e) {
        this.lastError = `GPU: ${(e as Error).message}`;
        this.landmarker = await createLandmarker('CPU');
        this.delegate = 'CPU';
      }
    }
    onStatus('ready');
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  get active() {
    return this.running;
  }

  private schedule() {
    if (this.running) requestAnimationFrame(this.tick);
  }

  private tick = () => {
    // 例外で処理が止まらないよう、次のフレームの予約を先に済ませる
    this.schedule();
    const v = this.video;
    if (!this.landmarker || this.recreating || v.readyState < 2) return;
    // 新しいフレームだけ処理する。ただし currentTime が進まないブラウザもあるので、一定時間ごとにも処理する
    const now = performance.now();
    if (v.currentTime === this.lastVideoTime && now - this.lastTs < 100) return;
    this.lastVideoTime = v.currentTime;
    // MediaPipe は単調増加のタイムスタンプを要求する
    const t = Math.max(now, this.lastTs + 1);
    this.lastTs = t;
    try {
      this.process(t);
    } catch (e) {
      this.lastError = `${this.delegate}: ${(e as Error).message}`;
      console.error(e);
      // スマホの GPU では作成できても推論で失敗することがあるので、CPU に切り替える
      if (this.delegate === 'GPU') void this.fallbackToCpu();
    }
  };

  private async fallbackToCpu() {
    this.recreating = true;
    try {
      this.landmarker?.close();
      this.landmarker = await createLandmarker('CPU');
      this.delegate = 'CPU';
    } catch (e) {
      this.lastError = `CPU: ${(e as Error).message}`;
    } finally {
      this.recreating = false;
    }
  }

  private process(t: number) {
    const v = this.video;
    const res = this.landmarker!.detectForVideo(v, t);
    this.frames++;
    this.lastFrameAt = t;
    const lm = res.faceLandmarks[0];
    const bs = res.faceBlendshapes[0]?.categories;
    const aspect = v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 1;
    // 虹彩（468〜477）まで揃っていない時は特徴量を作れない
    const raw = lm && lm.length >= 478 && bs?.length ? extractFeature(lm, bs, aspect) : null;
    if (raw && raw.every(Number.isFinite)) {
      const a = this.smoothing;
      this.smoothed = this.smoothed ? raw.map((x, i) => a * x + (1 - a) * this.smoothed![i]) : raw;
      this.onFrame({ t, faceFound: true, feature: this.smoothed, landmarks: lm });
    } else {
      if (lm) {
        // 顔はあるのに特徴量が数値にならない：平滑化に NaN が混ざると以後ずっと NaN になるので捨てる
        this.badFrames++;
        this.lastBad = `landmarks ${lm.length} / blendshapes ${bs?.length ?? 0} / features ${raw?.map((x) => x.toFixed(2)).join(',') ?? '-'}`;
      }
      this.onFrame({ t, faceFound: false, feature: this.smoothed ?? [0, 0, 0, 0, 0, 0] });
    }
  }
}

function createLandmarker(delegate: 'GPU' | 'CPU') {
  return FaceLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
    },
  );
}

/** MediaPipe の blendshape の並び順（使うものだけ） */
const BLENDSHAPE_INDEX: Record<string, number> = {
  eyeBlinkLeft: 9,
  eyeBlinkRight: 10,
  eyeLookDownLeft: 11,
  eyeLookDownRight: 12,
  eyeLookInLeft: 13,
  eyeLookInRight: 14,
  eyeLookOutLeft: 15,
  eyeLookOutRight: 16,
  eyeLookUpLeft: 17,
  eyeLookUpRight: 18,
};

export function extractFeature(
  lm: NormalizedLandmark[],
  categories: Category[],
  aspect: number,
): Feature {
  const b: Record<string, number> = {};
  for (const c of categories) if (c.categoryName) b[c.categoryName] = c.score;
  // 名前が付いていない環境に備えて、標準の並び順（index）からも引けるようにする
  for (const [name, index] of Object.entries(BLENDSHAPE_INDEX)) {
    if (b[name] === undefined) {
      const c = categories.find((x) => x.index === index) ?? categories[index];
      if (c) b[name] = c.score;
    }
  }

  // blendshape の Left/Right は本人から見た左右
  const bsX = (b.eyeLookInLeft + b.eyeLookOutRight - b.eyeLookOutLeft - b.eyeLookInRight) / 2;
  const bsY = (b.eyeLookUpLeft + b.eyeLookUpRight - b.eyeLookDownLeft - b.eyeLookDownRight) / 2;
  const blink = (b.eyeBlinkLeft + b.eyeBlinkRight) / 2;

  // 虹彩の位置を目頭・目尻の線分を基準に正規化（頭の平行移動・拡大縮小に強い）
  let ix = 0;
  let iy = 0;
  let open = 0;
  for (const [a, c, up, low] of EYES) {
    const p1 = { x: lm[a].x * aspect, y: lm[a].y };
    const p2 = { x: lm[c].x * aspect, y: lm[c].y };
    if (p2.x < p1.x) [p1.x, p2.x, p1.y, p2.y] = [p2.x, p1.x, p2.y, p1.y];
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const w = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const u = { x: (p2.x - p1.x) / w, y: (p2.y - p1.y) / w };
    // この目に近い方の虹彩中心
    const iris = IRIS_CENTERS.map((i) => ({ x: lm[i].x * aspect, y: lm[i].y })).sort(
      (q, r) => Math.hypot(q.x - mid.x, q.y - mid.y) - Math.hypot(r.x - mid.x, r.y - mid.y),
    )[0];
    const d = { x: iris.x - mid.x, y: iris.y - mid.y };
    ix += (d.x * u.x + d.y * u.y) / w;
    iy += (-d.x * u.y + d.y * u.x) / w;
    // 目の開き：下を見るとまぶたが下がるが、閉じた時ほどは狭まらない
    open += Math.hypot((lm[up].x - lm[low].x) * aspect, lm[up].y - lm[low].y) / w;
  }
  return [bsX, bsY, ix / 2, iy / 2, blink, open / 2];
}
