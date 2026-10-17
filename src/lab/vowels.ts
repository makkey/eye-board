/**
 * ひらがなの読みを「母音だけ」の並びに変える（T5 入力の再現）。
 * - 各拍を あ/い/う/え/お に（拗音「きゃ」などは1拍で、小さい字の母音を使う）
 * - ん はそのまま残す
 * - っ・ー は style で決める。mark：そのまま残す（別のキーで入れる）。
 *   fold：っ は次の拍の母音、ー は前の拍の母音で表す（ローマ字入力の totte・kaaten のような考え方で、キーを減らせる）
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

/** 句読点・記号（読みや表記に付いてきても、母音や正解の判定では無視する） */
export function stripPunctuation(s: string): string {
  return s.replace(/[、。，．,.!?！？「」『』（）()…・〜~]/g, '');
}

/** 空白を半角1つにそろえる */
export function normalizeSpaces(s: string): string {
  return s.replace(/[\s　]+/g, ' ').trim();
}

export type VowelStyle = 'mark' | 'fold';

/** 変換できない文字があれば null */
export function toVowels(reading: string, style: VowelStyle = 'mark'): string | null {
  const out: string[] = [];
  for (const c of toHiragana(normalizeSpaces(stripPunctuation(reading)))) {
    if (c === ' ') out.push(' ');
    else if (KEEP.has(c)) out.push(c);
    else if (SMALL[c]) {
      if (out.length && VOWEL_SET.has(out[out.length - 1])) out[out.length - 1] = SMALL[c];
      else out.push(SMALL[c]);
    } else if (VOWEL[c]) out.push(VOWEL[c]);
    else return null;
  }
  return style === 'fold' ? fold(out) : out.join('');
}

/** ー を前の拍の母音に、っ を次の拍の母音に置き換える（同じ文節の中で。なければ前後どちらかの母音） */
function fold(tokens: string[]): string | null {
  const t = [...tokens];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== 'ー') continue;
    if (i === 0 || !VOWEL_SET.has(t[i - 1])) return null;
    t[i] = t[i - 1];
  }
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] !== 'っ') continue;
    if (i + 1 < t.length && VOWEL_SET.has(t[i + 1])) t[i] = t[i + 1];
    else if (i > 0 && VOWEL_SET.has(t[i - 1])) t[i] = t[i - 1];
    else return null;
  }
  return t.join('');
}

const VOWEL_SET = new Set(['あ', 'い', 'う', 'え', 'お']);

const SMALL_KANA = new Set([...'ぁぃぅぇぉゃゅょゎ']);

/**
 * 読みを拍に分け、各拍の最初のかなを返す（「きょう」→ き・う）。
 * っ・ー・ん も1拍。拍の数は toVowels の母音の数と同じになる。変換できない文字があれば null
 */
export function moraKana(reading: string): string[] | null {
  return morae(reading)?.map((m) => m[0]) ?? null;
}

/** 読みを拍に分ける（「きょうは」→ きょ・う・は）。変換できない文字があれば null */
export function morae(reading: string): string[] | null {
  const out: string[] = [];
  for (const c of toHiragana(stripPunctuation(reading)).replace(/[\s　]+/g, '')) {
    if (SMALL_KANA.has(c) && out.length) {
      out[out.length - 1] += c;
      continue;
    }
    if (!VOWEL[c] && !KEEP.has(c) && !SMALL[c]) return null;
    out.push(c);
  }
  return out;
}

const ROW_FAMILY: Record<string, string> = {};
for (const [row, chars] of [
  ['あ', 'あいうえおぁぃぅぇぉゔ'],
  ['か', 'かきくけこがぎぐげご'],
  ['さ', 'さしすせそざじずぜぞ'],
  ['た', 'たちつてとだぢづでどっ'],
  ['な', 'なにぬねの'],
  ['は', 'はひふへほばびぶべぼぱぴぷぺぽ'],
  ['ま', 'まみむめも'],
  ['や', 'やゆよゃゅょ'],
  ['ら', 'らりるれろ'],
  ['わ', 'わをゎ'],
  ['ん', 'ん'],
] as const) {
  for (const c of chars) ROW_FAMILY[c] = row;
}

/** かなの行（濁点・半濁点・小さい字は区別しない：が → か、ぱ → は）。分からなければ null */
export function rowFamily(kana: string): string | null {
  return ROW_FAMILY[toHiragana(kana)[0]] ?? null;
}
