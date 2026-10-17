import { normalizeSpaces, toHiragana, toVowels } from './vowels';

/** LLM への指示（全リクエストで同じ。先頭に固定しておくとキャッシュが効く） */
export const SYSTEM_PROMPT = `あなたは、目の動きだけで文字を入力する人のための日本語入力補助です。
利用者は、日本語の各拍の母音だけを入力します。
- 各拍は あ・い・う・え・お のどれかで表されます（か→あ、し→い、つ→う、て→え、の→お）。
- 濁音・半濁音も同じ母音です（が→あ、ぱ→あ）。
- 拗音（きゃ・しゅ・ちょ など）は1拍で、ゃ→あ、ゅ→う、ょ→お です。
- 「ん」「っ」「ー」はそのまま入力されます。
- 母音は書いたかなの通りです。助詞の「は」は あ、「を」は お、「へ」は え。「とう」「こう」は お う、「せい」は え い。
- 空白は文節の区切りです（主に助詞の後ろ）。

入力された母音列に当てはまる、日常会話として自然な日本語を、可能性が高い順に最大5つ挙げてください。
各候補には、漢字かな交じりの表記（text）と、ひらがなの読み（reading。入力と同じ位置に空白を入れる）を付けてください。
reading を上の規則で母音に変えたものが、入力と完全に一致しなければなりません。一致しない候補は出さないでください。
「ここまでの文」が示された場合は、その続きとして自然な、次の文節だけを候補にしてください。`;

/** 出力の形（Claude / ChatGPT 用の JSON Schema） */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          reading: { type: 'string' },
        },
        required: ['text', 'reading'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

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

/** LLM の返答（JSON 文字列）を候補に変え、母音の一致と正解を判定する */
export function judge(raw: string, inputVowels: string, goldReading: string, goldText: string): Candidate[] {
  const json = JSON.parse(extractJson(raw)) as { candidates?: { text?: string; reading?: string }[] };
  const want = inputVowels.replace(/ /g, '');
  return (json.candidates ?? []).slice(0, 5).map((c) => {
    const text = String(c.text ?? '');
    const reading = String(c.reading ?? '');
    const v = toVowels(reading);
    return {
      text,
      reading,
      // 文節の区切り位置の違いは許す（母音の並びが合っていればよい）
      valid: v !== null && v.replace(/ /g, '') === want,
      correct: compact(reading) === compact(goldReading) || compact(text) === compact(goldText),
    };
  });
}

/** ```json ... ``` で囲まれて返ってきた場合にも対応する */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}
