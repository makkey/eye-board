import { ALL_CLASSES, DIR_NAME_JA } from './types';
import type { GazeClass } from './types';

/**
 * 特徴量ベクトル:
 *   [0] blendshape 由来の左右（+ = ユーザーの右）
 *   [1] blendshape 由来の上下（+ = 上）
 *   [2] 虹彩位置の左右（目頭・目尻基準、画像座標）
 *   [3] 虹彩位置の上下（同上）
 *   [4] blendshape のまばたき値（0〜1）
 *   [5] 目の開き（上下まぶたの距離 ÷ 目の幅）
 * 符号や縮尺は気にしない：キャリブレーションでクラスごとの代表値を覚える。
 */
export type Feature = number[];

export const F_BLINK = 4;

export interface Calibration {
  version: 2;
  createdAt: number;
  /** クラスごとの代表値（中央値） */
  means: Record<GazeClass, Feature>;
  /** 次元ごとのクラス内ばらつき（分散） */
  variance: Feature;
  /** キャリブレーション時のサンプルを分類し直した時の正解率（0〜1） */
  quality: Record<GazeClass, number>;
}

export interface ClassifyResult {
  cls: GazeClass;
  /** クラスごとの距離（分散で正規化した二乗距離） */
  distances: Partial<Record<GazeClass, number>>;
}

export interface ClassifyOptions {
  prev: GazeClass | null;
  /** 0〜1。新しいクラスに切り替えるには prev の距離 × この値 を下回る必要がある */
  hysteresis: number;
  /** 中央の距離に掛ける係数。小さいほど中央が広くなる */
  centerBias: number;
  /** 「目を閉じる」の距離に掛ける係数。小さいほど閉じていると判定されやすい */
  closedBias: number;
}

export function classify(f: Feature, cal: Calibration, opt: ClassifyOptions): ClassifyResult {
  const distances: Partial<Record<GazeClass, number>> = {};
  let best: GazeClass = 'C';
  for (const cls of ALL_CLASSES) {
    const mu = cal.means[cls];
    let d = 0;
    for (let i = 0; i < mu.length; i++) d += (f[i] - mu[i]) ** 2 / cal.variance[i];
    if (cls === 'C') d *= opt.centerBias;
    if (cls === 'closed') d *= opt.closedBias;
    distances[cls] = d;
    if (d < distances[best]!) best = cls;
  }
  // 目を閉じる時はまぶたが下がる途中で「下」を通るので、そこから「閉じる」へ移る時に
  // ヒステリシスで「下」に留まらないよう、閉じる／開くの切り替えには掛けない
  // （瞬間的な揺れはエンジン側のデバウンスで吸収する）
  const involvesClosed = best === 'closed' || opt.prev === 'closed';
  if (opt.prev && opt.prev !== best && !involvesClosed && distances[opt.prev] !== undefined) {
    if (distances[best]! > distances[opt.prev]! * opt.hysteresis) best = opt.prev;
  }
  return { cls: best, distances };
}

/** キャリブレーション前の大まかな分類（blendshape の値だけを使う） */
export function classifyDefault(f: Feature, threshold = 0.25): ClassifyResult {
  if (f[F_BLINK] > 0.5) return { cls: 'closed', distances: {} };
  const x = f[0];
  const y = f[1];
  if (Math.hypot(x, y) < threshold) return { cls: 'C', distances: {} };
  // -4〜4（-180°〜180°を45°刻み、0 = 右、2 = 上）
  const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  const SECTORS: GazeClass[] = ['L', 'DL', 'D', 'DR', 'R', 'UR', 'U', 'UL', 'L'];
  return { cls: SECTORS[sector + 4], distances: {} };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * クラスごとのサンプルからキャリブレーションを作る。
 * 外れ値（自然なまばたき等）に強いよう中央値と MAD を使う。
 * 「目を閉じる」も1つのクラスとして扱うので、下を見た時のまぶたの下がり方と
 * 閉じた時の違いを、まばたき値だけでなく全ての次元で見分ける。
 */
export function buildCalibration(samples: Record<GazeClass, Feature[]>): Calibration {
  for (const cls of ALL_CLASSES) {
    if (!samples[cls] || samples[cls].length < 3) {
      const name = cls === 'closed' ? '目を閉じる' : DIR_NAME_JA[cls];
      throw new Error(`「${name}」の記録がほとんど取れませんでした（${samples[cls]?.length ?? 0} フレーム）。`);
    }
  }

  const dims = samples.C[0].length;
  const means = {} as Record<GazeClass, Feature>;
  const madSq: number[][] = Array.from({ length: dims }, () => []);

  for (const cls of ALL_CLASSES) {
    const mu: Feature = [];
    for (let i = 0; i < dims; i++) {
      const xs = samples[cls].map((s) => s[i]);
      const m = median(xs);
      mu.push(m);
      const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
      madSq[i].push(mad * mad);
    }
    means[cls] = mu;
  }

  const variance: Feature = [];
  for (let i = 0; i < dims; i++) {
    // 目を閉じている時の虹彩位置のように、1クラスだけ極端にばらつく次元があるので中央値でまとめる
    const pooled = median(madSq[i]);
    const ms = ALL_CLASSES.map((c) => means[c][i]);
    const spread = Math.max(...ms) - Math.min(...ms);
    // 極端に小さい分散で一つの次元が支配しないよう下限を設ける
    variance.push(Math.max(pooled, (0.1 * spread) ** 2, 1e-8));
  }

  const cal: Calibration = {
    version: 2,
    createdAt: Date.now(),
    means,
    variance,
    quality: {} as Record<GazeClass, number>,
  };
  const opt = { prev: null, hysteresis: 1, centerBias: 1, closedBias: 1 };
  for (const cls of ALL_CLASSES) {
    const ok = samples[cls].filter((f) => classify(f, cal, opt).cls === cls).length;
    cal.quality[cls] = ok / samples[cls].length;
  }
  return cal;
}

const KEY = 'eyeboard.calibration.v2';

export function loadCalibration(): Calibration | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const cal = JSON.parse(raw) as Calibration;
    return cal.version === 2 ? cal : null;
  } catch {
    return null;
  }
}

export function saveCalibration(cal: Calibration | null) {
  try {
    if (cal) localStorage.setItem(KEY, JSON.stringify(cal));
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
