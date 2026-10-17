import { describe, expect, it } from 'vitest';
import { atSentenceStart, convertPhrase as convertFull, headsMatch, slotPrompt, splitParts } from './vowelime';

const convertPhrase = async (...args: Parameters<typeof convertFull>) => (await convertFull(...args)).map((c) => c.text);
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

  it('区切った複数の文節はまとめて変換する（文頭は文単位の形、途中は続きとして）', async () => {
    const sent: string[] = [];
    const gen: Generate = async (_s, _sc, user) => {
      sent.push(user);
      return reply(['なまたまごが たべたい', '生卵が 食べたい'], ['なまたまごが', '生卵が']);
    };
    expect(await convertPhrase('', 'ああああおあ あえあい ', gen)).toEqual(['生卵が食べたい']);
    expect(sent[0]).toBe('母音列: ああああおあ あえあい');
    await convertPhrase('今日は', 'ああああおあ あえあい', gen);
    expect(sent[1]).toContain('ここまでの文: 今日は');
    expect(sent[1]).toContain('全部をまとめて');
  });

  it('1文節は v2、区切った複数の文節は 詰め込みを禁じた v4 で聞く', async () => {
    const systems: string[] = [];
    const gen: Generate = async (system) => {
      systems.push(system);
      return reply(['あめ', '雨']);
    };
    await convertPhrase('', 'あえ', gen);
    await convertPhrase('', 'あえ あえ', gen);
    expect(systems[0]).not.toContain('自立語を2つ以上');
    expect(systems[1]).toContain('自立語を2つ以上');
  });
});

describe('atSentenceStart', () => {
  it('空か、文の終わりの直後なら文頭', () => {
    expect(atSentenceStart('')).toBe(true);
    expect(atSentenceStart('ありがとう。')).toBe(true);
    expect(atSentenceStart('元気？\n')).toBe(true);
    expect(atSentenceStart('昨日は')).toBe(false);
  });
});

describe('最初の1文字', () => {
  it('区切りごとに拍を並べ、拍の数を書く', () => {
    const p = slotPrompt('', ['ああああお', 'あえあい'], ['な', null]);
    expect(p).toContain('ここまでの文: （文頭）');
    expect(p).toContain('1つ目の区切り（5拍）: な ＊あ ＊あ ＊あ ＊お');
    expect(p).toContain('2つ目の区切り（4拍）: ＊あ ＊え ＊あ ＊い');
    expect(p).toContain('母音列（確かめ用）: ああああお あえあい');
    expect(slotPrompt('昨日は', ['あんいえ'], ['か'])).toContain('文節（4拍）: か ん ＊い ＊え');
  });

  it('行のヒントを送り、その行で始まらない候補は捨てる', async () => {
    let sent = '';
    const gen: Generate = async (_s, _sc, user) => {
      sent = user;
      return reply(['またたまごが', 'また卵が'], ['なまたまごが', '生卵が'], ['ただたまごが', 'ただ卵が']);
    };
    expect(await convertPhrase('', 'ああああおあ', gen, 1, [], ['な'])).toEqual(['生卵が']);
    expect(sent).toContain('文節（6拍）: な ＊あ ＊あ ＊あ ＊お ＊あ');
  });

  it('区切りごとに確かめる（濁点の違いは問わない）', () => {
    expect(headsMatch('なまたまごが たべたい', ['ああああおあ', 'あえあい'], ['な', 'た'])).toBe(true);
    expect(headsMatch('なまたまごが だべたい', ['ああああおあ', 'あえあい'], ['な', 'た'])).toBe(true);
    expect(headsMatch('なまたまごが あえあい', ['ああああおあ', 'あえあい'], ['な', 'た'])).toBe(false);
    expect(headsMatch('きょうは', ['おうあ'], ['か'])).toBe(true);
    expect(headsMatch('なんでも', ['あんえお'], [null])).toBe(true);
  });
});

describe('一部を使う', () => {
  it('候補を区切りごとに分ける（表記の空白が合わなければ読みで）', () => {
    expect(splitParts('明日には 言います', 'あしたには いいます', ['あいあいあ', 'いいあう'])).toEqual([
      { text: '明日には', reading: 'あしたには' },
      { text: '言います', reading: 'いいます' },
    ]);
    expect(splitParts('明日には言います', 'あしたにはいいます', ['あいあいあ', 'いいあう'])).toEqual([
      { text: 'あしたには', reading: 'あしたには' },
      { text: 'いいます', reading: 'いいます' },
    ]);
  });

  it('固定した区切りを伝え、そこが違う候補は捨てる', async () => {
    let sent = '';
    const gen: Generate = async (_s, _sc, user) => {
      sent = user;
      return reply(['あしたには いきます', '明日には 行きます'], ['あしたには いいます', '明日には 言います']);
    };
    const got = await convertFull('', 'あいあいあ いいあう', gen, 1, [], [], undefined, '', [
      { index: 1, text: '言います', reading: 'いいます' },
    ]);
    expect(got.map((c) => c.text)).toEqual(['明日には言います']);
    expect(sent).toContain('2つ目の区切り＝「言います」（いいます）');
  });
});
