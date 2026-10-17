import { PROMPTS, TOP_N, judge, mergeRuns, segmentPrompt, sentencePrompt } from './lab/decode';
import type { Candidate, JsonSchema } from './lab/decode';
import { moraKana, rowFamily } from './lab/vowels';
import type { AiEffort, AiProvider } from './types';

/**
 * 母音入力の変換（1文節ずつ）。母音ラボ（lab.html）で測った方式をそのまま使う：
 * 1文節なら指示文 v2、区切った複数の文節なら v4（v2 に、1区切りに自立語は1つまで・細かい区切りも可、の決まりを加えたもの）。
 * ラボの文節ごとの測定では、1文節に v3 を使うと母音の合う候補が減り、文頭の文節で正解が5位以内に入らないことが増えたため。
 * っ・ー は母音で表す、前の文節までの確定した文を文脈として付ける、母音が入力と合わない候補は捨てる。
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
): Promise<string[]> {
  const style = 'fold';
  vowels = vowels.trim().replace(/ +/g, ' ');
  const multi = vowels.includes(' ');
  const prompt = multi ? PROMPTS.v4 : PROMPTS.v2;
  let user = userPrompt(context.slice(-CONTEXT_CHARS), vowels);
  const segments = vowels.split(' ');
  const hints = heads.flatMap((h, i) =>
    h ? [`${segments.length > 1 ? `${i + 1}つ目の区切り` : 'この文節'}は「${h}」の行（${rowFamily(h)}行）の音で始まる`] : [],
  );
  if (hints.length) {
    user += `\n最初の音のヒント（濁点・半濁点の有無や、きゃ・しょ のような小さい字が付くかは問わない）: ${hints.join('／')}`;
  }
  if (exclude.length) user += `\n次の候補は違いました。これらとは別の候補を挙げてください：${exclude.join('、')}`;
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
      lists.push(judge(s.value, vowels, '', '', true, style, multi).filter((c) => c.valid && headsMatch(c.reading, segments, heads)));
    } catch (e) {
      firstError ??= e;
    }
  }
  if (!lists.length) throw firstError instanceof Error ? firstError : new Error(String(firstError));
  const texts: string[] = [];
  for (const c of mergeRuns(lists, true, multi)) {
    // 文節の中の区切りの空白は本文に入れない
    const text = c.text.replace(/[\s　]+/g, '');
    if (text && !texts.includes(text) && !exclude.includes(text)) texts.push(text);
  }
  return texts.slice(0, TOP_N);
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
