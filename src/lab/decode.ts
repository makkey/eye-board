import { normalizeSpaces, toHiragana, toVowels } from './vowels';

/** 母音の規則（v1・v2 共通） */
const RULES = `あなたは、目の動きだけで文字を入力する人のための日本語入力補助です。
利用者は、日本語の各拍の母音だけを入力します。
- 各拍は あ・い・う・え・お のどれかで表されます（か→あ、し→い、つ→う、て→え、の→お）。
- 濁音・半濁音も同じ母音です（が→あ、ぱ→あ）。
- 拗音（きゃ・しゅ・ちょ など）は1拍で、ゃ→あ、ゅ→う、ょ→お です。
- 「ん」「っ」「ー」はそのまま入力されます。
- 母音は書いたかなの通りです。助詞の「は」は あ、「を」は お、「へ」は え。「とう」「こう」は お う、「せい」は え い。
- 空白は文節の区切りです（主に助詞の後ろ）。`;

/** v1：規則だけを伝える */
const SYSTEM_PROMPT_V1 = `${RULES}

入力された母音列に当てはまる、日常会話として自然な日本語を、可能性が高い順に最大5つ挙げてください。
各候補には、漢字かな交じりの表記（text）と、ひらがなの読み（reading。入力と同じ位置に空白を入れる）を付けてください。
reading を上の規則で母音に変えたものが、入力と完全に一致しなければなりません。一致しない候補は出さないでください。
「ここまでの文」が示された場合は、その続きとして自然な、次の文節だけを候補にしてください。`;

/** v2：例と自己確認を加え、候補を多めに出させる（母音が合わないものは受け取った側で捨てる） */
const SYSTEM_PROMPT_V2 = `${RULES}

入力された母音列に当てはまる、日常会話として自然な日本語を、可能性が高い順に最大10個挙げてください。

考え方：
- まず各文節の拍の数を数えてください。候補の読みは、文節ごとに拍の数が入力とぴったり同じでなければなりません（「きのうは」は4拍で いおうあ、「きょうは」は3拍でおうあ なので別物です）。
- あいさつ・お礼・お願い・返事などの決まり文句（例：おはようございます、よろしくおねがいします、だいじょうぶです）は、当てはまるなら優先して上位に入れてください。
- 意味の通らない語の組み合わせより、ふだんの会話でよく言う文を上に置いてください。

各候補には次の3つを付けてください。
- reading：ひらがなの読み。入力と同じ位置に空白を入れる
- vowels：reading を規則どおり1拍ずつ母音に変えたもの（自分で確かめるため）
- text：漢字かな交じりの表記
vowels が入力と一致しない候補は出さないでください。

例（入力 → 候補の一つ）：
- 「おあえいああい」→ reading「おかえりなさい」、vowels「おあえいああい」、text「おかえりなさい」
- 「あえあ うっえ いあう」→ reading「あめが ふって います」、vowels「あえあ うっえ いあう」、text「雨が 降って います」
- 「おあお おいあい」→ reading「おちゃを のみたい」、vowels「おあお おいあい」、text「お茶を 飲みたい」

「ここまでの文」が示された場合は、その続きとして自然な、次の文節だけを候補にしてください。`;

/** JSON Schema を作る（Claude / ChatGPT 用。Gemini 用には providers.ts で変換する） */
function candidatesSchema(fields: string[]) {
  return {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: Object.fromEntries(fields.map((f) => [f, { type: 'string' }])),
          required: fields,
          additionalProperties: false,
        },
      },
    },
    required: ['candidates'],
    additionalProperties: false,
  };
}

export type JsonSchema = ReturnType<typeof candidatesSchema>;
export type PromptId = 'v1' | 'v2';

export interface PromptVersion {
  id: PromptId;
  label: string;
  system: string;
  schema: JsonSchema;
  /** 受け取った候補を、母音が合うものを先に並べ替えるか */
  validFirst: boolean;
}

/** 指示文の版（system は全リクエストで同じ。先頭に固定しておくとキャッシュが効く） */
export const PROMPTS: Record<PromptId, PromptVersion> = {
  v1: { id: 'v1', label: 'v1（規則のみ・5候補）', system: SYSTEM_PROMPT_V1, schema: candidatesSchema(['text', 'reading']), validFirst: false },
  v2: {
    id: 'v2',
    label: 'v2（例・自己確認つき・10候補から母音の合う上位5つ）',
    system: SYSTEM_PROMPT_V2,
    schema: candidatesSchema(['reading', 'vowels', 'text']),
    validFirst: true,
  },
};

/** 採点・表示に使う候補の数 */
export const TOP_N = 5;

export function sentencePrompt(vowels: string): string {
  return `母音列: ${vowels}`;
}

export function segmentPrompt(context: string, vowels: string): string {
  return `ここまでの文: ${context || '（文頭）'}\n次の文節の母音: ${vowels}`;
}

export interface Candidate {
  text: string;
  reading: string;
  /** reading の母音が入力と一致するか */
  valid: boolean;
  /** 正解と一致するか */
  correct: boolean;
}

const compact = (s: string) => toHiragana(normalizeSpaces(s)).replace(/ /g, '');

/**
 * LLM の返答（JSON 文字列）を候補に変え、母音の一致と正解を判定する。
 * validFirst の時は母音が合う候補を先に並べる（同じ読み・表記の重複は除く）。
 * 返すのは受け取った全候補。採点・表示には先頭の TOP_N 個を使う。
 */
export function judge(raw: string, inputVowels: string, goldReading: string, goldText: string, validFirst = false): Candidate[] {
  const json = JSON.parse(extractJson(raw)) as { candidates?: { text?: string; reading?: string }[] };
  const want = inputVowels.replace(/ /g, '');
  const all = (json.candidates ?? []).map((c) => {
    const text = String(c.text ?? '');
    const reading = String(c.reading ?? '');
    const v = toVowels(reading);
    return {
      text,
      reading,
      // 文節の区切り位置の違いは許す（母音の並びが合っていればよい）
      valid: v !== null && v.replace(/ /g, '') === want,
      correct: (!!goldReading && compact(reading) === compact(goldReading)) || (!!goldText && compact(text) === compact(goldText)),
    };
  });
  if (!validFirst) return all;
  const seen = new Set<string>();
  const unique = all.filter((c) => {
    const k = `${compact(c.reading)}|${compact(c.text)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...unique.filter((c) => c.valid), ...unique.filter((c) => !c.valid)];
}

/** ```json ... ``` で囲まれて返ってきた場合にも対応する */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}
