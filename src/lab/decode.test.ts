import { describe, expect, it } from 'vitest';
import { judge } from './decode';

describe('judge', () => {
  const raw = JSON.stringify({
    candidates: [
      { text: '昨日は', reading: 'きのうは' },
      { text: '機能は', reading: 'きのうは' },
      { text: '昨日', reading: 'きのう' },
    ],
  });

  it('母音の一致と正解を判定する', () => {
    const c = judge(raw, 'いおうあ', 'きのうは', '昨日は');
    expect(c.map((x) => [x.valid, x.correct])).toEqual([
      [true, true],
      [true, true], // 読みが同じなら表記違いも正解とみなす
      [false, false],
    ]);
  });

  it('コードブロックで囲まれた JSON も読める', () => {
    const c = judge('```json\n' + raw + '\n```', 'いおうあ', 'きのうは', '昨日は');
    expect(c).toHaveLength(3);
  });

  it('文節の区切り位置が違っても母音が合えば有効', () => {
    const r = JSON.stringify({ candidates: [{ text: 'お水をください', reading: 'おみずをください' }] });
    const [c] = judge(r, 'おいうお うああい', 'おみずを ください', 'お水を ください');
    expect(c.valid).toBe(true);
    expect(c.correct).toBe(true);
  });
});
