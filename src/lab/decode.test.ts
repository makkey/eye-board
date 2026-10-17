import { describe, expect, it } from 'vitest';
import { PROMPTS, judge, mergeRuns } from './decode';
import { toVowels } from './vowels';

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

  it('validFirst では母音が合う候補を先にし、重複を除く', () => {
    const r = JSON.stringify({
      candidates: [
        { reading: 'きょうは', vowels: 'おうあ', text: '今日は' },
        { reading: 'きのうは', vowels: 'いおうあ', text: '昨日は' },
        { reading: 'きのうは', vowels: 'いおうあ', text: '昨日は' },
        { reading: 'ひのうは', vowels: 'いおうあ', text: '日野うは' },
      ],
    });
    const c = judge(r, 'いおうあ', 'きのうは', '昨日は', true);
    expect(c.map((x) => x.text)).toEqual(['昨日は', '日野うは', '今日は']);
    expect(c[0].correct).toBe(true);
  });

  it('正解が空（試し入力）の時は正解扱いしない', () => {
    const r = JSON.stringify({ candidates: [{ text: '', reading: '' }] });
    expect(judge(r, 'あ', '', '')[0].correct).toBe(false);
  });
});

describe('途中で切れた返答', () => {
  it('書き終わっている候補だけ拾う', () => {
    const raw = '{"candidates": [{"reading": "こんにちは", "vowels": "おんいいあ", "text": "こんにちは"}, {"reading": "こんにち';
    const c = judge(raw, 'おんいいあ', 'こんにちは', 'こんにちは', true);
    expect(c.map((x) => x.text)).toEqual(['こんにちは']);
  });

  it('候補が1つも読めなければエラー', () => {
    expect(() => judge('{"candidates": [{"reading": "こ', 'お', '', '')).toThrow();
  });
});

describe('mergeRuns', () => {
  const run = (...readings: string[]) =>
    judge(JSON.stringify({ candidates: readings.map((r) => ({ reading: r, text: r })) }), 'あうい', 'さむい', 'さむい', true);

  it('何回かの返答で上位に多く出た候補を先にする', () => {
    const m = mergeRuns([run('あつい', 'さむい'), run('さむい', 'かゆい'), run('さむい', 'あつい')], true);
    expect(m.map((c) => c.reading)).toEqual(['さむい', 'あつい', 'かゆい']);
  });

  it('何回かで1位になった候補は、毎回2位に出る候補より上', () => {
    const m = mergeRuns([run('さむい', 'かゆい'), run('さむい', 'かゆい'), run('あつい', 'かゆい')], true);
    expect(m[0].reading).toBe('さむい');
  });

  it('母音が合わない候補は点が高くても後ろ', () => {
    const m = mergeRuns([run('さむいです', 'あつい'), run('さむいです', 'あつい')], true);
    expect(m.map((c) => c.reading)).toEqual(['あつい', 'さむいです']);
  });
});

describe('PROMPTS', () => {
  it('v2 の例は規則どおりの母音になっている', () => {
    const examples = [...PROMPTS.v2.system.matchAll(/reading「(.+?)」、vowels「(.+?)」/g)];
    expect(examples.length).toBe(3);
    for (const [, reading, vowels] of examples) expect(toVowels(reading)).toBe(vowels);
  });

  it('スキーマの必須項目がプロパティと一致する', () => {
    for (const p of Object.values(PROMPTS)) {
      const item = p.schema.properties.candidates.items;
      expect(Object.keys(item.properties)).toEqual(item.required);
    }
  });
});
