import { describe, expect, it } from 'vitest';
import { toVowels } from './vowels';

describe('toVowels', () => {
  it('利用者の例と同じ並びになる', () => {
    expect(toVowels('こんにちは')).toBe('おんいいあ');
    expect(toVowels('ありがとう')).toBe('あいあおう');
    expect(toVowels('きのうは たのしかったね ありがとう')).toBe('いおうあ あおいあっあえ あいあおう');
  });

  it('拗音は1拍、ー と っ はそのまま', () => {
    expect(toVowels('しゃしん')).toBe('あいん');
    expect(toVowels('びょういん')).toBe('おういん');
    expect(toVowels('かーてん')).toBe('あーえん');
    expect(toVowels('ちょっと')).toBe('おっお');
  });

  it('カタカナと全角空白も扱う', () => {
    expect(toVowels('テレビを　つけて')).toBe('ええいお うええ');
  });

  it('変換できない文字は null', () => {
    expect(toVowels('abc')).toBeNull();
  });
});
