import { normalizeSpaces, stripPunctuation, toHiragana, toVowels } from './vowels';
import type { VowelStyle } from './vowels';

/** 空白（文節の区切り）の意味。v3 は1区切り＝ちょうど1文節と厳密にする */
const LOOSE_SEGMENTS = '- 空白は文節の区切りです（主に助詞の後ろ）。';
const STRICT_SEGMENTS = `- 空白は文節の区切りです。区切りと区切りの間は、ちょうど1つの文節（名詞・動詞などの自立語1つと、その後ろに付く助詞・助動詞）です。
  例：「あめが ふって います」は3つの文節です。「けさからあめ ふって」のように1つの区切りに2つの文節（けさから／あめ）を入れたり、1つの文節を2つに分けたりした候補は出さないでください。
- 候補の reading には、入力と同じ数・同じ位置に空白を入れてください（区切りごとの拍の数も入力と同じになります）。`;

/**
 * v4：区切りは利用者が決めた言葉の切れ目。1区切りに自立語は1つまで（詰め込みは不可）だが、
 * 助詞を独立させたり複合語を分けたりする細かい区切りは許す（細かく区切ると当たりやすくなることがあるため）
 */
const WORD_SEGMENTS = `- 空白は利用者が入れた言葉の区切りです。候補は必ず区切りの位置で言葉が切れるようにしてください。
- 1つの区切りの中に、名詞・動詞・形容詞などの自立語を2つ以上入れないでください。例：「けさからあめ」のように けさ と あめ を1つの区切りに入れるのは不可です。
- 助詞・助動詞は、前の言葉と同じ区切りでも、それだけで1つの区切りでも構いません（「たまごが」も「たまご が」もありえます）。複合語は1つの区切りでも、分けて「なま たまご」のように区切っても構いません。
- 候補の reading には、入力と同じ数・同じ位置に空白を入れてください（区切りごとの拍の数も入力と同じになります）。`;

type SegmentRule = 'loose' | 'strict' | 'word';

/** 母音の規則（全版共通。segments は空白の意味の決め方） */
function rules(style: VowelStyle, segments: SegmentRule = 'loose'): string {
  const special =
    style === 'fold'
      ? `- 「ん」はそのまま入力されます。
- 小さい「っ」は、次の拍の母音で表されます（とって→おええ、ちょっと→おおお、きって→いええ）。
- のばす「ー」は、前の拍の母音で表されます（かーてん→ああえん、こーひー→おおいい）。`
      : '- 「ん」「っ」「ー」はそのまま入力されます。';
  return `あなたは、目の動きだけで文字を入力する人のための日本語入力補助です。
利用者は、日本語の各拍の母音だけを入力します。
- 各拍は あ・い・う・え・お のどれかで表されます（か→あ、し→い、つ→う、て→え、の→お）。
- 濁音・半濁音も同じ母音です（が→あ、ぱ→あ）。
- 拗音（きゃ・しゅ・ちょ など）は1拍で、ゃ→あ、ゅ→う、ょ→お です。
${special}
- 母音は書いたかなの通りです。助詞の「は」は あ、「を」は お、「へ」は え。「とう」「こう」は お う、「せい」は え い。
${segments === 'strict' ? STRICT_SEGMENTS : segments === 'word' ? WORD_SEGMENTS : LOOSE_SEGMENTS}`;
}

/** v1：規則だけを伝える */
const systemV1 = (style: VowelStyle) => `${rules(style)}

入力された母音列に当てはまる、日常会話として自然な日本語を、可能性が高い順に最大5つ挙げてください。
各候補には、漢字かな交じりの表記（text）と、ひらがなの読み（reading。入力と同じ位置に空白を入れる）を付けてください。
reading を上の規則で母音に変えたものが、入力と完全に一致しなければなりません。一致しない候補は出さないでください。
「ここまでの文」が示された場合は、その続きとして自然な、次の文節だけを候補にしてください。`;

/** v2 の例（測定用の例文には入っていない文） */
const V2_EXAMPLES: [string, string][] = [
  ['おかえりなさい', 'おかえりなさい'],
  ['あめが ふって います', '雨が 降って います'],
  ['おちゃを のみたい', 'お茶を 飲みたい'],
];

/** v2：例と自己確認を加え、候補を多めに出させる（母音が合わないものは受け取った側で捨てる）。v3 は区切りを厳密に */
const systemV2 = (style: VowelStyle, segments: SegmentRule = 'loose') => {
  const examples = V2_EXAMPLES.map(([reading, text]) => {
    const v = toVowels(reading, style);
    return `- 「${v}」→ reading「${reading}」、vowels「${v}」、text「${text}」`;
  }).join('\n');
  return `${rules(style, segments)}

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
${examples}

「ここまでの文」が示された場合は、その続きとして自然な、次の文節だけを候補にしてください。`;
};

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
export type PromptId = 'v1' | 'v2' | 'v3' | 'v4';

export interface PromptVersion {
  id: PromptId;
  label: string;
  /** っ・ー の入れ方ごとの指示 */
  system: (style: VowelStyle) => string;
  schema: JsonSchema;
  /** 受け取った候補を、母音が合うものを先に並べ替えるか */
  validFirst: boolean;
  /** 母音が合う候補の中で、文節の区切り位置まで入力と同じものを先にするか */
  exactFirst?: boolean;
}

/** 指示文の版（system は全リクエストで同じ。先頭に固定しておくとキャッシュが効く） */
export const PROMPTS: Record<PromptId, PromptVersion> = {
  v1: { id: 'v1', label: 'v1（規則のみ・5候補）', system: systemV1, schema: candidatesSchema(['text', 'reading']), validFirst: false },
  v2: {
    id: 'v2',
    label: 'v2（例・自己確認つき・10候補から母音の合う上位5つ）',
    system: systemV2,
    schema: candidatesSchema(['reading', 'vowels', 'text']),
    validFirst: true,
  },
  v3: {
    id: 'v3',
    label: 'v3（v2＋1区切り＝1文節を厳密に・区切り位置まで合う候補を先に）',
    system: (style) => systemV2(style, 'strict'),
    schema: candidatesSchema(['reading', 'vowels', 'text']),
    validFirst: true,
    exactFirst: true,
  },
  v4: {
    id: 'v4',
    label: 'v4（v2＋1区切りに自立語は1つまで・細かい区切りも可・区切り位置まで合う候補を先に）',
    system: (style) => systemV2(style, 'word'),
    schema: candidatesSchema(['reading', 'vowels', 'text']),
    validFirst: true,
    exactFirst: true,
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
  /** reading の母音が入力と一致するか（文節の区切り位置は問わない） */
  valid: boolean;
  /** 区切り位置まで入力と一致するか */
  exact: boolean;
  /** 正解と一致するか */
  correct: boolean;
}

const compact = (s: string) => toHiragana(normalizeSpaces(stripPunctuation(s))).replace(/ /g, '');

/**
 * LLM の返答（JSON 文字列）を候補に変え、母音の一致と正解を判定する。
 * validFirst の時は母音が合う候補を先に並べる（同じ読み・表記の重複は除く）。
 * 返すのは受け取った全候補。採点・表示には先頭の TOP_N 個を使う。
 */
export function judge(
  raw: string,
  inputVowels: string,
  goldReading: string,
  goldText: string,
  validFirst = false,
  style: VowelStyle = 'mark',
  exactFirst = false,
): Candidate[] {
  const json = parseCandidates(raw);
  const wantExact = normalizeSpaces(inputVowels);
  const want = wantExact.replace(/ /g, '');
  const all = (json.candidates ?? []).map((c) => {
    const text = String(c.text ?? '');
    const reading = String(c.reading ?? '');
    const v = toVowels(reading, style);
    return {
      text,
      reading,
      // 文節の区切り位置の違いは許す（母音の並びが合っていればよい）
      valid: v !== null && v.replace(/ /g, '') === want,
      exact: v !== null && normalizeSpaces(v) === wantExact,
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
  const valid = unique.filter((c) => c.valid);
  const ordered = exactFirst ? [...valid.filter((c) => c.exact), ...valid.filter((c) => !c.exact)] : valid;
  return [...ordered, ...unique.filter((c) => !c.valid)];
}

/**
 * 同じ問いを何回か聞いた結果を1つの順位にまとめる（返答は毎回少しずつ違うため）。
 * 読みが同じ候補は1つにまとめ、各回の順位に応じた点（1位 1点、2位 1/2点、3位 1/3点…）の合計で並べる。
 * 下位まで均等に点を配ると、どの回でも中位に出る候補が、何回かで1位になった候補を追い越してしまうため、上位を重く見る。
 * validFirst の時は母音が合う候補を先に置く。
 */
export function mergeRuns(runs: Candidate[][], validFirst: boolean, exactFirst = false): Candidate[] {
  if (runs.length === 1) return runs[0];
  const merged = new Map<string, { c: Candidate; score: number; first: number }>();
  let order = 0;
  for (const run of runs) {
    run.forEach((c, i) => {
      const k = compact(c.reading) || compact(c.text);
      const m = merged.get(k);
      const point = 1 / (i + 1);
      if (m) m.score += point;
      else merged.set(k, { c, score: point, first: order++ });
    });
  }
  return [...merged.values()]
    .sort(
      (a, b) =>
        (validFirst ? Number(b.c.valid) - Number(a.c.valid) : 0) ||
        (exactFirst ? Number(b.c.exact) - Number(a.c.exact) : 0) ||
        b.score - a.score ||
        a.first - b.first,
    )
    .map((m) => m.c);
}

type RawCandidates = { candidates?: { text?: string; reading?: string }[] };

/**
 * 返答の JSON を読む。同じ内容を繰り返して途中で切れた（閉じていない）JSON でも、
 * 最後まで書けている候補だけは拾う。
 */
function parseCandidates(raw: string): RawCandidates {
  const body = extractJson(raw);
  try {
    return JSON.parse(body) as RawCandidates;
  } catch (e) {
    const candidates = [...body.matchAll(/\{[^{}]*\}/g)]
      .map((m) => {
        try {
          return JSON.parse(m[0]);
        } catch {
          return null;
        }
      })
      .filter((c) => c && typeof c === 'object' && ('reading' in c || 'text' in c));
    if (!candidates.length) throw e;
    return { candidates };
  }
}

/** ```json ... ``` で囲まれて返ってきた場合にも対応する */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}
