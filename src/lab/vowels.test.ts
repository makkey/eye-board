import { describe, expect, it } from 'vitest';
import { moraKana, rowFamily, toVowels } from './vowels';

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

  it('fold では っ は次の母音、ー は前の母音', () => {
    expect(toVowels('めがねを とって ください', 'fold')).toBe('えあえお おええ うああい');
    expect(toVowels('かーてん', 'fold')).toBe('ああえん');
    expect(toVowels('こーひー', 'fold')).toBe('おおいい');
    expect(toVowels('ちょっと', 'fold')).toBe('おおお');
    // 文節の最後の っ は前の母音
    expect(toVowels('あっ そう', 'fold')).toBe('ああ おう');
  });
});

describe('moraKana・rowFamily', () => {
  it('拍ごとの最初のかな（拗音は1拍、っ・ー・ん も1拍）', () => {
    expect(moraKana('きょうは')).toEqual(['き', 'う', 'は']);
    expect(moraKana('なまたまご が')).toEqual(['な', 'ま', 'た', 'ま', 'ご', 'が']);
    expect(moraKana('こーひー、')).toEqual(['こ', 'ー', 'ひ', 'ー']);
    expect(moraKana('abc')).toBeNull();
  });

  it('行は濁点・半濁点・小さい字を区別しない', () => {
    expect(rowFamily('が')).toBe('か');
    expect(rowFamily('ぱ')).toBe('は');
    expect(rowFamily('ょ')).toBe('や');
    expect(rowFamily('ナ')).toBe('な');
  });
});

describe('toVowels（sokuon）', () => {
  it('っ はそのまま、ー は前の母音', () => {
    expect(toVowels('めがねを とって ください', 'sokuon')).toBe('えあえお おっえ うああい');
    expect(toVowels('こーひー', 'sokuon')).toBe('おおいい');
    expect(toVowels('きのうは たのしかったね', 'sokuon')).toBe('いおうあ あおいあっあえ');
  });
});
