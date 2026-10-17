import { describe, expect, it } from 'vitest';
import { convertPhrase } from './vowelime';
import type { Generate } from './vowelime';

const reply = (...cands: [string, string][]) => JSON.stringify({ candidates: cands.map(([reading, text]) => ({ reading, vowels: '', text })) });

describe('convertPhrase', () => {
  it('前の文を文脈として送り、母音が合う候補だけを返す', async () => {
    let sent = '';
    const gen: Generate = async (_system, _schema, user) => {
      sent = user;
      return reply(['たのしかったね', '楽しかったね'], ['たのしかった', '楽しかった'], ['たのしかったぜ', '楽しかったぜ']);
    };
    const got = await convertPhrase('昨日は', 'あおいあああえ', gen);
    expect(sent).toContain('ここまでの文: 昨日は');
    expect(sent).toContain('あおいあああえ');
    expect(got).toEqual(['楽しかったね', '楽しかったぜ']);
  });

  it('文頭は（文頭）として送り、表記の中の空白は除く', async () => {
    let sent = '';
    const gen: Generate = async (_s, _sc, user) => {
      sent = user;
      return reply(['おみずを ください', 'お水を ください']);
    };
    expect(await convertPhrase('', 'おいうおうああい', gen)).toEqual(['お水をください']);
    expect(sent).toContain('（文頭）');
  });

  it('同じ表記の候補はまとめ、最大5つ', async () => {
    const gen: Generate = async () =>
      reply(
        ['あめ', '雨'],
        ['あめ', '飴'],
        ['かぜ', '風'],
        ['あめ', '雨'],
        ['さけ', '酒'],
        ['かべ', '壁'],
        ['たね', '種'],
        ['はれ', '晴れ'],
      );
    expect(await convertPhrase('', 'あえ', gen)).toEqual(['雨', '飴', '風', '酒', '壁']);
  });

  it('何回か聞いた時は、一部が失敗しても返ってきた分で決める', async () => {
    let n = 0;
    const gen: Generate = async () => {
      n++;
      if (n === 1) throw new Error('混雑');
      return reply(['あめ', '雨']);
    };
    expect(await convertPhrase('', 'あえ', gen, 3)).toEqual(['雨']);
  });

  it('全部失敗したらエラー', async () => {
    const gen: Generate = async () => {
      throw new Error('HTTP 401: invalid key');
    };
    await expect(convertPhrase('', 'あえ', gen)).rejects.toThrow('HTTP 401');
  });

  it('別の候補：もう見せた候補を伝え、返ってきても除く', async () => {
    let sent = '';
    const gen: Generate = async (_s, _sc, user) => {
      sent = user;
      return reply(['わかったのは', '分かったのは'], ['なまたまごが', '生卵が'], ['かかったのは', 'かかったのは']);
    };
    expect(await convertPhrase('', 'ああああおあ', gen, 1, ['分かったのは', 'かかったのは'])).toEqual(['生卵が']);
    expect(sent).toContain('別の候補');
    expect(sent).toContain('分かったのは、かかったのは');
  });
});
