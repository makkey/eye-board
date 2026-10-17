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

  /** 0〜1。1 = 平滑化なし */
  smoothing = 0.5;
  onFrame: (f: TrackerFrame) => void = () => {};

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(onStatus: (msg: string) => void) {
    onStatus('カメラを起動中…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    if (!this.landmarker) {
      onStatus('顔認識モデルを読み込み中…');
      const fileset = { wasmLoaderPath, wasmBinaryPath };
      const options = {
        runningMode: 'VIDEO' as const,
        numFaces: 1,
        outputFaceBlendshapes: true,
      };
      try {
        this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        });
      } catch {
        this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        });
      }
    }
    onStatus('');
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  get active() {
    return this.running;
  }

  private loop = () => {
    if (!this.running) return;
    const v = this.video;
    if (this.landmarker && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t = performance.now();
      const res = this.landmarker.detectForVideo(v, t);
      const lm = res.faceLandmarks[0];
      const bs = res.faceBlendshapes[0]?.categories;
      if (lm && bs) {
        const raw = extractFeature(lm, bs, v.videoWidth / v.videoHeight);
        const a = this.smoothing;
        this.smoothed = this.smoothed ? raw.map((x, i) => a * x + (1 - a) * this.smoothed![i]) : raw;
        this.onFrame({ t, faceFound: true, feature: this.smoothed, landmarks: lm });
      } else {
        this.onFrame({ t, faceFound: false, feature: this.smoothed ?? [0, 0, 0, 0, 0, 0] });
      }
    }
    requestAnimationFrame(this.loop);
  };
}

export function extractFeature(
  lm: NormalizedLandmark[],
  categories: Category[],
  aspect: number,
): Feature {
  const b: Record<string, number> = {};
  for (const c of categories) b[c.categoryName] = c.score;

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
