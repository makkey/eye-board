import { describe, expect, it } from 'vitest';
import { applyItem, variantsOf } from './kana';
import type { Action, Item } from './types';

const act = (action: Action): Item => ({ kind: 'action', action, label: action, speak: action });

describe('applyItem', () => {
  it('文字を追加', () => {
    expect(applyItem('か', { kind: 'char', ch: 'き' })).toBe('かき');
  });

  it('濁点・半濁点・小文字の付け外し', () => {
    expect(applyItem('か', act('dakuten'))).toBe('が');
    expect(applyItem('が', act('dakuten'))).toBe('か');
    expect(applyItem('ぱ', act('dakuten'))).toBe('ば');
    expect(applyItem('は', act('handakuten'))).toBe('ぱ');
    expect(applyItem('つ', act('small'))).toBe('っ');
    expect(applyItem('っ', act('dakuten'))).toBe('づ');
    expect(applyItem('な', act('dakuten'))).toBe('な');
    expect(applyItem('', act('dakuten'))).toBe('');
  });

  it('゛゜小 の切り替え', () => {
    expect(variantsOf('は')).toEqual(['は', 'ば', 'ぱ']);
    expect(variantsOf('つ')).toEqual(['つ', 'づ', 'っ']);
    let s = 'は';
    const seen = [];
    for (let i = 0; i < 3; i++) {
      s = applyItem(s, act('cycle'));
      seen.push(s);
    }
    expect(seen).toEqual(['ば', 'ぱ', 'は']);
  });

  it('編集操作', () => {
    expect(applyItem('あい', act('backspace'))).toBe('あ');
    expect(applyItem('あ', act('space'))).toBe('あ　');
    expect(applyItem('あ', act('newline'))).toBe('あ\n');
    expect(applyItem('あい', act('clear'))).toBe('');
  });
});
