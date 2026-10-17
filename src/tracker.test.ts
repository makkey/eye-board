import { describe, expect, it, vi } from 'vitest';

// tracker.ts は MediaPipe の wasm を ?url で読み込むので、テストではダミーにする
vi.mock('@mediapipe/tasks-vision', () => ({ FaceLandmarker: {} }));
vi.mock('@mediapipe/tasks-vision/vision_wasm_internal.js?url', () => ({ default: '' }));
vi.mock('@mediapipe/tasks-vision/vision_wasm_internal.wasm?url', () => ({ default: '' }));

const { extractFeature } = await import('./tracker');

const NAMES = [
  '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft',
  'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
];

const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: 0.5 + (i % 7) * 0.01, y: 0.5 + (i % 5) * 0.01, z: 0, visibility: 1 }));
const scores = (name: string) => (name === 'eyeLookUpLeft' || name === 'eyeLookUpRight' ? 0.6 : 0.1);

describe('extractFeature', () => {
  it('blendshape の名前から値を取る', () => {
    const cats = NAMES.map((n, i) => ({ index: i, categoryName: n, displayName: '', score: scores(n) }));
    const f = extractFeature(landmarks, cats, 4 / 3);
    expect(f.every(Number.isFinite)).toBe(true);
    expect(f[1]).toBeCloseTo(0.5); // 上を見ている
  });

  it('名前が空でも並び順から値を取る', () => {
    const cats = NAMES.map((n, i) => ({ index: i, categoryName: '', displayName: '', score: scores(n) }));
    const f = extractFeature(landmarks, cats, 4 / 3);
    expect(f.every(Number.isFinite)).toBe(true);
    expect(f[1]).toBeCloseTo(0.5);
  });
});
