import { describe, expect, it } from 'vitest';
import { buildCalibration, classify, classifyDefault } from './classifier';
import type { Feature } from './classifier';
import { ALL_CLASSES, ALL_DIRS } from './types';
import type { GazeClass } from './types';

const VEC: Record<GazeClass, [number, number]> = {
  C: [0, 0],
  U: [0, 1],
  UR: [0.7, 0.7],
  R: [1, 0],
  DR: [0.7, -0.7],
  D: [0, -0.6],
  DL: [-0.7, -0.7],
  L: [-1, 0],
  UL: [-0.7, 0.7],
  // 目を閉じると blendshape は「下を見ている」に近い値になる
  closed: [0, -0.5],
};

/** [blink, 目の開き]：下を見るとまばたき値は閉じた時に近いが、目の開きでは区別できる */
const LID: Record<GazeClass, [number, number]> = {
  ...(Object.fromEntries(ALL_DIRS.map((d) => [d, [0.1, 0.3]])) as Record<GazeClass, [number, number]>),
  DL: [0.4, 0.2],
  D: [0.45, 0.18],
  DR: [0.4, 0.2],
  closed: [0.55, 0.05],
};

const feat = (c: GazeClass, scale = 1): Feature => {
  const [x, y] = VEC[c];
  return [x * scale, y * scale, -x * 0.05 * scale, -y * 0.03 * scale, ...LID[c]];
};

/** 疑似乱数でノイズを乗せたサンプル */
function makeSamples() {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1;
  const samples = {} as Record<GazeClass, Feature[]>;
  for (const c of ALL_CLASSES) {
    samples[c] = Array.from({ length: 30 }, () => feat(c).map((v, i) => v + rnd() * (i === 2 || i === 3 ? 0.05 : 1)));
  }
  return samples;
}

const opt = { prev: null, hysteresis: 0.75, centerBias: 1 };

describe('classify', () => {
  const cal = buildCalibration(makeSamples());

  it('キャリブレーション値に近いクラスを返す', () => {
    for (const c of ALL_CLASSES) expect(classify(feat(c), cal, opt).cls).toBe(c);
  });

  it('下を見るのと目を閉じるのを区別する', () => {
    expect(cal.quality.D).toBeGreaterThan(0.9);
    expect(cal.quality.closed).toBeGreaterThan(0.9);
  });

  it('ヒステリシスで境界付近は前の方向を保つ', () => {
    // C(0,0) と UR(0.7,0.7) の中点 0.35 を少しだけ越えた点
    const f = (v: number) => [v, v, -v * 0.05, -v * 0.03, 0.1, 0.3];
    expect(classify(f(0.37), cal, { ...opt, prev: null }).cls).toBe('UR');
    expect(classify(f(0.37), cal, { ...opt, prev: 'C' }).cls).toBe('C');
    expect(classify(f(0.33), cal, { ...opt, prev: null }).cls).toBe('C');
    expect(classify(f(0.33), cal, { ...opt, prev: 'UR' }).cls).toBe('UR');
  });
});

describe('classifyDefault', () => {
  const f = (x: number, y: number, blink = 0) => [x, y, 0, 0, blink, 0.3];
  it('小さい値は中央', () => {
    expect(classifyDefault(f(0.05, 0.1)).cls).toBe('C');
  });
  it('角度で8方向', () => {
    expect(classifyDefault(f(0, 0.5)).cls).toBe('U');
    expect(classifyDefault(f(0.4, -0.4)).cls).toBe('DR');
    expect(classifyDefault(f(-0.5, 0)).cls).toBe('L');
    expect(classifyDefault(f(-0.4, 0.4)).cls).toBe('UL');
  });
  it('まばたき値が高ければ閉じている', () => {
    expect(classifyDefault(f(0, -0.5, 0.8)).cls).toBe('closed');
  });
});
