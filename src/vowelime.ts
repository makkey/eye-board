import { PROMPTS, TOP_N, judge, mergeRuns, segmentPrompt, sentencePrompt } from './lab/decode';
import type { Candidate, JsonSchema } from './lab/decode';
import { moraKana, morae, normalizeSpaces, rowFamily, toHiragana } from './lab/vowels';
import type { AiEffort, AiProvider } from './types';

/**
 * 母音入力の変換（1文節ずつ）。母音ラボ（lab.html）で測った方式をそのまま使う：
 * 1文節なら指示文 v2、区切った複数の文節なら v4（v2 に、1区切りに自立語は1つまで・細かい区切りも可、の決まりを加えたもの）。
 * ラボの文節ごとの測定では、1文節に v3 を使うと母音の合う候補が減り、文頭の文節で正解が5位以内に入らないことが増えたため。
 * っ はそのまま（↑ の2秒で入れる）、ー は前の拍の母音で表す、前の文節までの確定した文を文脈として付ける、
 * 母音が入力と合わない候補は捨てる。
 */

/** 会社ごとの既定のモデル（ラボで文節ごとの精度が良かったもの） */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: 'gemini-3.8-flash',
  openai: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
};

export const PROVIDER_LABELS: Record<AiProvider, string> = { gemini: 'Gemini', openai: 'ChatGPT', claude: 'Claude' };

/** 文脈として送るのは直近のこの文字数まで */
const CONTEXT_CHARS = 200;

/** 指示（system）・返答の形・問い合わせ（user）を受け取り、モデルの返答（JSON 文字列）を返す */
export type Generate = (system: string, schema: JsonSchema, user: string) => Promise<string>;

/**
 * 問い合わせ（user）の文。1文節なら前の文を文脈に「次の文節」として、
 * 空白で区切った複数の文節ならまとめて変換させる（文頭ならラボの文単位と同じ形）
 */
export function userPrompt(context: string, vowels: string): string {
  if (!vowels.includes(' ')) return segmentPrompt(context, vowels);
  if (!context) return sentencePrompt(vowels);
  return `ここまでの文: ${context}\n続きの母音列（空白で区切った複数の文節。次の文節だけでなく、全部をまとめて1つの続きとして候補にしてください）: ${vowels}`;
}

/** 変換候補。parts は入力の区切りごとの表記と読み（「一部を使う」で合っている文節を選ぶため） */
export interface Conv {
  text: string;
  parts: { text: string; reading: string }[];
}

/** 利用者が「合っている」と選んで固定した区切り（index は0から） */
export interface FixedPart {
  index: number;
  text: string;
  reading: string;
}

const compactKana = (s: string) => toHiragana(s).replace(/[\s　]+/g, '');

/**
 * 候補を入力の区切りごとに分ける。読みは拍の数で切り分け、表記は空白の数が区切りの数と同じならそれを使う
 * （合わなければ読みのひらがなを表記の代わりにする）
 */
export function splitParts(text: string, reading: string, segments: string[]): Conv['parts'] {
  const ms = morae(reading);
  const total = segments.reduce((a, s) => a + [...s].length, 0);
  let readings: string[];
  if (ms && ms.length === total) {
    readings = [];
    let i = 0;
    for (const seg of segments) {
      const n = [...seg].length;
      readings.push(ms.slice(i, i + n).join(''));
      i += n;
    }
  } else {
    readings = normalizeSpaces(reading).split(' ');
  }
  const texts = normalizeSpaces(text).split(' ');
  const useTexts = texts.length === segments.length;
  return readings.map((r, i) => ({ text: useTexts ? texts[i] : r, reading: r }));
}

/** 変換の途中経過（候補が無かった時に、何がはじかれたかを見せるため） */
export interface ConvertInfo {
  /** AI が返した候補の数（全回の合計） */
  received: number;
  /** 捨てた候補。vowels：母音が合わない、constraint：最初の音や固定した文節が合わない（確実に違う） */
  rejected: { text: string; reading: string; reason: 'vowels' | 'constraint' }[];
}

/**
 * 最初の1文字がある時の問い合わせ。母音列とヒントを別々に書くと拍を数え違えやすい（「なあああお」に 4拍の「ななめの」を返す）ので、
 * 区切りごとに拍を1つずつ並べ、拍の数も書く。「な」はその音、「＊あ」は あ段のどれか
 */
export function slotPrompt(context: string, segments: string[], heads: (string | null)[]): string {
  const lines = segments.map((seg, i) => {
    const morae = [...seg].map((v, j) => (j === 0 && heads[i] ? heads[i]! : v === 'ん' || v === 'っ' ? v : `＊${v}`));
    const name = segments.length > 1 ? `${i + 1}つ目の区切り` : '文節';
    return `${name}（${morae.length}拍）: ${morae.join(' ')}`;
  });
  const what =
    segments.length > 1
      ? '次の区切りの並びに当てはまる続き（全部をまとめて1つの続きとして候補にしてください）'
      : '次の拍の並びに当てはまる、次の文節';
  return [
    `ここまでの文: ${context || '（文頭）'}`,
    `${what}。「な」のようなかなは、その音そのもの（濁点・半濁点の有無や、きゃ・しょ のような小さい字が付くかは問わない。な なら な行）。「＊あ」は あ段の音ならどれでもよく（あ・か・が・さ・ざ・た・だ・な・は・ば・ぱ・ま・や・ら・わ、きゃ のような拗音も）、「＊い」「＊う」「＊え」「＊お」も同じ。「ん」は ん、「っ」は小さい っ。拍の数を必ず合わせてください。`,
    ...lines,
    `母音列（確かめ用）: ${segments.join(' ')}`,
  ].join('\n');
}

/**
 * 母音の並び（1文節、または空白で区切った複数の文節）を変換して、表記の候補を最大 TOP_N 個返す。
 * runs 回同時に聞いて順位を合算する。exclude（もう見せた候補）は除いて、別の候補を探させる。
 * heads は区切りごとの最初の拍のかな（利用者が12キーで入れたもの。無ければ null）。
 * その行で始まらない候補は捨てる（濁点・半濁点・小さい字は区別しない）。
 * 母音が合う候補が1つもなければ空の配列
 */
export async function convertPhrase(
  context: string,
  vowels: string,
  generate: Generate,
  runs = 1,
  exclude: string[] = [],
  heads: (string | null)[] = [],
  info?: ConvertInfo,
  /** 問い合わせの最後に付け足す注意（聞き直す時など） */
  note = '',
  /** 利用者が合っていると選んだ区切り。そこが違う候補は捨てる */
  fixed: FixedPart[] = [],
): Promise<Conv[]> {
  const style = 'sokuon';
  vowels = vowels.trim().replace(/ +/g, ' ');
  const multi = vowels.includes(' ');
  const prompt = multi ? PROMPTS.v4 : PROMPTS.v2;
  const segments = vowels.split(' ');
  // 最初の1文字があれば拍を並べた形で、無ければラボで測った形で聞く
  let user = heads.some(Boolean)
    ? slotPrompt(context.slice(-CONTEXT_CHARS), segments, heads)
    : userPrompt(context.slice(-CONTEXT_CHARS), vowels);
  if (exclude.length) user += `\n次の候補は違いました。これらとは別の候補を挙げてください：${exclude.join('、')}`;
  if (fixed.length) {
    const list = fixed.map((f) => `${f.index + 1}つ目の区切り＝「${f.text}」（${f.reading}）`).join('、');
    user += `\n次の区切りは利用者が正しいと決めたものです。必ずこのとおりにし、ほかの区切りだけを考えてください：${list}`;
  }
  if (note) user += `\n${note}`;
  const settled = await Promise.allSettled(
    Array.from({ length: Math.max(1, runs) }, () => generate(prompt.system(style), prompt.schema, user)),
  );
  const lists: Candidate[][] = [];
  let firstError: unknown;
  for (const s of settled) {
    if (s.status === 'rejected') {
      firstError ??= s.reason;
      continue;
    }
    try {
      const all = judge(s.value, vowels, '', '', true, style, multi);
      const ok = all.filter(
        (c) => c.valid && headsMatch(c.reading, segments, heads) && fixedMatch(c.text, c.reading, segments, fixed),
      );
      if (info) {
        info.received += all.length;
        for (const c of all) {
          if (!ok.includes(c)) info.rejected.push({ text: c.text, reading: c.reading, reason: c.valid ? 'constraint' : 'vowels' });
        }
      }
      lists.push(ok);
    } catch (e) {
      firstError ??= e;
    }
  }
  if (!lists.length) throw firstError instanceof Error ? firstError : new Error(String(firstError));
  const out: Conv[] = [];
  for (const c of mergeRuns(lists, true, multi)) {
    // 文節の中の区切りの空白は本文に入れない
    const text = c.text.replace(/[\s　]+/g, '');
    if (!text || out.some((o) => o.text === text) || exclude.includes(text)) continue;
    out.push({ text, parts: splitParts(c.text, c.reading, segments) });
  }
  return out.slice(0, TOP_N);
}

/** 固定した区切りの読みが、候補でも同じか */
function fixedMatch(text: string, reading: string, segments: string[], fixed: FixedPart[]): boolean {
  if (!fixed.length) return true;
  const parts = splitParts(text, reading, segments);
  return fixed.every((f) => parts[f.index] && compactKana(parts[f.index].reading) === compactKana(f.reading));
}

/** 区切りごとの最初の拍が、指定された行で始まっているか */
export function headsMatch(reading: string, segments: string[], heads: (string | null)[]): boolean {
  if (!heads.some(Boolean)) return true;
  const morae = moraKana(reading);
  if (!morae) return false;
  let start = 0;
  for (let i = 0; i < segments.length; i++) {
    const head = heads[i];
    if (head && (start >= morae.length || rowFamily(morae[start]) !== rowFamily(head))) return false;
    start += [...segments[i]].length;
  }
  return true;
}

/** 文頭（何も無いか、文の終わりの記号・改行の直後）か。文頭の文節は文脈が無く、いちばん外れやすい */
export function atSentenceStart(text: string): boolean {
  return !text.trim() || /[。！？!?\n]\s*$/.test(text);
}

/** 選んだ会社の API を呼ぶ Generate を作る（各社の呼び出しは使う時に読み込む） */
export function providerGenerate(provider: AiProvider, key: string, model: string, effort: AiEffort): Generate {
  return async (system, schema, user) => {
    const { PROVIDERS } = await import('./lab/providers');
    const reply = await PROVIDERS[provider].generate(key, model, system, schema, user, effort);
    return reply.text;
  };
}

// API キーは母音ラボと共有する（どちらかで保存すれば両方で使える）。このブラウザの中だけに置く
const keyName = (p: AiProvider) => `eyeboard.lab.key.${p}`;
/** 保存できない環境（プライベートモードなど）でも、開いている間は使えるように */
const memory: Partial<Record<AiProvider, string>> = {};

export function loadKey(provider: AiProvider): string {
  if (memory[provider] !== undefined) return memory[provider]!;
  try {
    return localStorage.getItem(keyName(provider)) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(provider: AiProvider, key: string) {
  memory[provider] = key;
  try {
    if (key) localStorage.setItem(keyName(provider), key);
    else localStorage.removeItem(keyName(provider));
  } catch {
    // 保存できなくても、今開いている間は使える
  }
}
