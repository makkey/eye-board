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
  L: [-1, 0],
  UL: [-0.7, 0.7],
  // 目を閉じる（下を見る）と blendshape は「下」寄りになる
  closed: [0, -0.7],
};

/** [blink, 目の開き] */
const LID: Record<GazeClass, [number, number]> = {
  ...(Object.fromEntries(ALL_DIRS.map((d) => [d, [0.1, 0.3]])) as Record<GazeClass, [number, number]>),
  closed: [0.7, 0.05],
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

const opt = { prev: null, hysteresis: 0.75, centerBias: 1, closedBias: 1 };

describe('classify', () => {
  const cal = buildCalibration(makeSamples());

  it('キャリブレーション値に近いクラスを返す', () => {
    for (const c of ALL_CLASSES) expect(classify(feat(c), cal, opt).cls).toBe(c);
  });

  it('「中央」から「閉じる」へはヒステリシスなしで移る', () => {
    // 中央と閉じるの中間よりわずかに閉じる寄り（ヒステリシスがあれば「中央」に留まる位置）
    const mid = feat('C').map((v, i) => v + (feat('closed')[i] - v) * 0.52);
    expect(classify(mid, cal, { ...opt, prev: 'C' }).cls).toBe('closed');
  });

  it('closedBias を小さくすると閉じていると判定されやすい', () => {
    const mid = feat('C').map((v, i) => v + (feat('closed')[i] - v) * 0.45);
    expect(classify(mid, cal, opt).cls).toBe('C');
    expect(classify(mid, cal, { ...opt, closedBias: 0.5 }).cls).toBe('closed');
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
  it('角度で方向を決め、下方向は「閉じる」', () => {
    expect(classifyDefault(f(0, 0.5)).cls).toBe('U');
    expect(classifyDefault(f(-0.5, 0)).cls).toBe('L');
    expect(classifyDefault(f(-0.4, 0.4)).cls).toBe('UL');
    expect(classifyDefault(f(0.4, -0.4)).cls).toBe('closed');
    expect(classifyDefault(f(0, -0.5)).cls).toBe('closed');
  });
  it('まばたき値が高ければ閉じている', () => {
    expect(classifyDefault(f(0, -0.5, 0.8)).cls).toBe('closed');
  });
});
