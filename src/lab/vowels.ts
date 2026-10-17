/**
 * ひらがなの読みを「母音だけ」の並びに変える（T5 入力の再現）。
 * - 各拍を あ/い/う/え/お に（拗音「きゃ」などは1拍で、小さい字の母音を使う）
 * - ん・っ・ー はそのまま残す（別のキーで入れる想定）
 * - 空白（文節の区切り）はそのまま
 * 書いてあるかなの通りに変える（「とう」は お う、「は（わ）」は あ）。
 */

const VOWEL: Record<string, string> = {};
const ROWS: [string, string][] = [
  ['あ', 'あかがさざただなはばぱまやらわ'],
  ['い', 'いきぎしじちぢにひびぴみり'],
  ['う', 'うくぐすずつづぬふぶぷむゆるゔ'],
  ['え', 'えけげせぜてでねへべぺめれ'],
  ['お', 'おこごそぞとどのほぼぽもよろを'],
];
for (const [v, chars] of ROWS) for (const c of chars) VOWEL[c] = v;

/** 前の拍の母音を置き換える小さい字 */
const SMALL: Record<string, string> = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゃ: 'あ', ゅ: 'う', ょ: 'お', ゎ: 'あ' };

const KEEP = new Set(['ん', 'っ', 'ー']);

export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 空白を半角1つにそろえる */
export function normalizeSpaces(s: string): string {
  return s.replace(/[\s　]+/g, ' ').trim();
}

/** 変換できない文字があれば null */
export function toVowels(reading: string): string | null {
  const out: string[] = [];
  for (const c of toHiragana(normalizeSpaces(reading))) {
    if (c === ' ') out.push(' ');
    else if (KEEP.has(c)) out.push(c);
    else if (SMALL[c]) {
      if (out.length && VOWEL_SET.has(out[out.length - 1])) out[out.length - 1] = SMALL[c];
      else out.push(SMALL[c]);
    } else if (VOWEL[c]) out.push(VOWEL[c]);
    else return null;
  }
  return out.join('');
}

const VOWEL_SET = new Set(['あ', 'い', 'う', 'え', 'お']);
