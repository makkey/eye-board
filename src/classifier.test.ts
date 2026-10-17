import { describe, expect, it } from 'vitest';
import { buildCalibration, classify, classifyDefault } from './classifier';
import type { CalibrationSample } from './classifier';
import { ALL_DIRS, CARDINAL_DIRS } from './types';
import type { Dir } from './types';

const VEC: Record<Dir, [number, number]> = {
  C: [0, 0],
  U: [0, 1],
  UR: [0.7, 0.7],
  R: [1, 0],
  DR: [0.7, -0.7],
  D: [0, -0.6],
  DL: [-0.7, -0.7],
  L: [-1, 0],
  UL: [-0.7, 0.7],
};

/** 疑似乱数でノイズを乗せたサンプル（第3, 4次元はスケール違いのコピー） */
function makeSamples() {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1;
  const samples = {} as Record<Dir, CalibrationSample[]>;
  for (const dir of ALL_DIRS) {
    const [x, y] = VEC[dir];
    samples[dir] = Array.from({ length: 30 }, () => ({
      feature: [x + rnd(), y + rnd(), -x * 0.05 + rnd() * 0.05, -y * 0.03 + rnd() * 0.03],
      blink: dir === 'D' ? 0.35 : 0.1,
    }));
  }
  const closed = Array.from({ length: 30 }, () => ({ feature: [0, -0.5, 0, 0], blink: 0.9 }));
  return { samples, closed };
}

const opt = { allowed: ALL_DIRS, prev: null, hysteresis: 0.75, centerBias: 1 };

describe('classify', () => {
  const { samples, closed } = makeSamples();
  const cal = buildCalibration(samples, closed);

  it('キャリブレーション値に近い方向を返す', () => {
    for (const dir of ALL_DIRS) {
      const [x, y] = VEC[dir];
      expect(classify([x, y, -x * 0.05, -y * 0.03], cal, opt).dir).toBe(dir);
    }
  });

  it('許可された方向だけから選ぶ', () => {
    const [x, y] = VEC.UR;
    const r = classify([x * 1.1, y * 0.9, -x * 0.05, -y * 0.03], cal, { ...opt, allowed: CARDINAL_DIRS });
    expect(['U', 'R']).toContain(r.dir);
  });

  it('ヒステリシスで境界付近は前の方向を保つ', () => {
    // C(0,0) と UR(0.7,0.7) の中点 0.35 を少しだけ越えた点
    const f = (v: number) => [v, v, -v * 0.05, -v * 0.03];
    expect(classify(f(0.37), cal, { ...opt, prev: null }).dir).toBe('UR');
    expect(classify(f(0.37), cal, { ...opt, prev: 'C' }).dir).toBe('C');
    expect(classify(f(0.33), cal, { ...opt, prev: null }).dir).toBe('C');
    expect(classify(f(0.33), cal, { ...opt, prev: 'UR' }).dir).toBe('UR');
  });

  it('下を見た時のまぶたより高い位置に閾値を置く', () => {
    expect(cal.blinkThreshold).toBeGreaterThan(0.35);
    expect(cal.blinkThreshold).toBeLessThan(0.9);
    expect(cal.blinkWarning).toBe(false);
  });
});

describe('classifyDefault', () => {
  it('小さい値は中央', () => {
    expect(classifyDefault([0.05, 0.1], ALL_DIRS).dir).toBe('C');
  });
  it('角度で8方向', () => {
    expect(classifyDefault([0, 0.5], ALL_DIRS).dir).toBe('U');
    expect(classifyDefault([0.4, -0.4], ALL_DIRS).dir).toBe('DR');
    expect(classifyDefault([0.4, -0.4], CARDINAL_DIRS).dir).toMatch(/^(R|D)$/);
  });
});
