import { ALL_DIRS } from './types';
import type { Dir } from './types';

/**
 * 特徴量ベクトル:
 *   [0] blendshape 由来の左右（+ = ユーザーの右）
 *   [1] blendshape 由来の上下（+ = 上）
 *   [2] 虹彩位置の左右（目頭・目尻基準、画像座標）
 *   [3] 虹彩位置の上下（同上）
 * 符号や縮尺は気にしない：キャリブレーションで方向ごとの代表値を覚える。
 */
export type Feature = number[];

export interface Calibration {
  version: 1;
  createdAt: number;
  /** 方向ごとの代表値（中央値） */
  means: Record<Dir, Feature>;
  /** 次元ごとの方向内ばらつき（分散） */
  variance: Feature;
  /** これを超えたら「目を閉じている」 */
  blinkThreshold: number;
  /** 目を閉じた時と開いた時の分離が悪い */
  blinkWarning: boolean;
}

export interface ClassifyResult {
  dir: Dir;
  /** 方向ごとの距離（分散で正規化した二乗距離） */
  distances: Partial<Record<Dir, number>>;
}

export interface ClassifyOptions {
  allowed: Dir[];
  prev: Dir | null;
  /** 0〜1。新しい方向に切り替えるには prev の距離 × この値 を下回る必要がある */
  hysteresis: number;
  /** 中央の距離に掛ける係数。小さいほど中央が広くなる */
  centerBias: number;
}

export function classify(f: Feature, cal: Calibration, opt: ClassifyOptions): ClassifyResult {
  const distances: Partial<Record<Dir, number>> = {};
  let best: Dir = opt.allowed[0];
  for (const dir of opt.allowed) {
    const mu = cal.means[dir];
    let d = 0;
    for (let i = 0; i < mu.length; i++) d += (f[i] - mu[i]) ** 2 / cal.variance[i];
    if (dir === 'C') d *= opt.centerBias;
    distances[dir] = d;
    if (d < distances[best]!) best = dir;
  }
  if (opt.prev && opt.prev !== best && distances[opt.prev] !== undefined) {
    if (distances[best]! > distances[opt.prev]! * opt.hysteresis) best = opt.prev;
  }
  return { dir: best, distances };
}

/** キャリブレーション前の大まかな分類（blendshape の値だけを使う） */
export function classifyDefault(f: Feature, allowed: Dir[], threshold = 0.25): ClassifyResult {
  const x = f[0];
  const y = f[1];
  const mag = Math.hypot(x, y);
  if (mag < threshold || !allowed.some((d) => d !== 'C')) return { dir: 'C', distances: {} };
  const angle = Math.atan2(y, x); // 0 = 右, π/2 = 上
  let best: Dir = 'C';
  let bestDiff = Infinity;
  for (const dir of allowed) {
    if (dir === 'C') continue;
    const diff = Math.abs(normalizeAngle(angle - DIR_ANGLE[dir]));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = dir;
    }
  }
  return { dir: best, distances: {} };
}

const DIR_ANGLE: Record<Exclude<Dir, 'C'>, number> = {
  R: 0,
  UR: Math.PI / 4,
  U: Math.PI / 2,
  UL: (3 * Math.PI) / 4,
  L: Math.PI,
  DL: (-3 * Math.PI) / 4,
  D: -Math.PI / 2,
  DR: -Math.PI / 4,
};

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

export interface CalibrationSample {
  feature: Feature;
  blink: number;
}

/**
 * 方向ごとのサンプルと「目を閉じた」サンプルからキャリブレーションを作る。
 * 外れ値（自然なまばたき等）に強いよう中央値と MAD を使う。
 */
export function buildCalibration(
  samples: Record<Dir, CalibrationSample[]>,
  closed: CalibrationSample[],
): Calibration {
  for (const dir of ALL_DIRS) {
    if (!samples[dir] || samples[dir].length < 3) throw new Error(`サンプル不足: ${dir}`);
  }
  if (closed.length < 3) throw new Error('サンプル不足: 目を閉じる');

  const dims = samples.C[0].feature.length;
  const means = {} as Record<Dir, Feature>;
  const madSq: number[][] = Array.from({ length: dims }, () => []);

  for (const dir of ALL_DIRS) {
    const mu: Feature = [];
    for (let i = 0; i < dims; i++) {
      const xs = samples[dir].map((s) => s.feature[i]);
      const m = median(xs);
      mu.push(m);
      const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
      madSq[i].push(mad * mad);
    }
    means[dir] = mu;
  }

  const variance: Feature = [];
  for (let i = 0; i < dims; i++) {
    const pooled = madSq[i].reduce((a, b) => a + b, 0) / madSq[i].length;
    const ms = ALL_DIRS.map((d) => means[d][i]);
    const spread = Math.max(...ms) - Math.min(...ms);
    // 極端に小さい分散で一つの次元が支配しないよう下限を設ける
    variance.push(Math.max(pooled, (0.1 * spread) ** 2, 1e-8));
  }

  // 開いている時のまばたき値の上限（下を見るとまぶたが下がるので方向ごとに見る）
  const openHigh = Math.max(...ALL_DIRS.map((d) => quantile(samples[d].map((s) => s.blink), 0.85)));
  const closedLevel = median(closed.map((s) => s.blink));
  const blinkWarning = closedLevel - openHigh < 0.15;
  const blinkThreshold = blinkWarning
    ? Math.max(0.5, openHigh + 0.05)
    : openHigh + 0.5 * (closedLevel - openHigh);

  return { version: 1, createdAt: Date.now(), means, variance, blinkThreshold, blinkWarning };
}

const KEY = 'eyeboard.calibration.v1';

export function loadCalibration(): Calibration | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const cal = JSON.parse(raw) as Calibration;
    return cal.version === 1 ? cal : null;
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
