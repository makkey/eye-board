import Anthropic from '@anthropic-ai/sdk';
import type { JsonSchema } from './decode';

export type ProviderId = 'claude' | 'gemini' | 'openai' | 'sarashina';
export type Effort = 'default' | 'low' | 'medium' | 'high';

export interface Provider {
  id: ProviderId;
  label: string;
  /** API キーを取得する場所の案内 */
  keyHelp: string;
  listModels(key: string): Promise<string[]>;
  /** 一覧から既定で選ぶモデル */
  pickDefault(models: string[]): string;
  /** JSON 文字列を返す */
  generate(key: string, model: string, system: string, schema: JsonSchema, user: string, effort: Effort): Promise<string>;
}

// ---- Claude（公式 SDK をブラウザから直接使う。キーは利用者のブラウザにだけある）----

/** 拒否された時に別モデルで続ける server-side fallback（"default"）に対応するモデル */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const claude: Provider = {
  id: 'claude',
  label: 'Claude',
  keyHelp: 'https://platform.claude.com/ の API Keys で作成',
  async listModels(key) {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  },
  pickDefault(models) {
    return models.includes('claude-opus-5-5') ? 'claude-opus-5-5' : models[0];
  },
  async generate(key, model, system, schema, user, effort) {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const fallback = FALLBACK_MODELS.has(model);
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_config: {
        format: { type: 'json_schema', schema },
        ...(effort === 'default' ? {} : { effort }),
      },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(`拒否されました（${response.stop_details?.category ?? '理由不明'}）`);
    }
    return response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  },
};

// ---- Gemini ----

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini の responseSchema は OpenAPI 形式（型名が大文字、additionalProperties は使えない） */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase();
    else if (k === 'properties') {
      out[k] = Object.fromEntries(Object.entries(v as object).map(([name, sub]) => [name, toGeminiSchema(sub)]));
      // 出力の順番を JSON Schema と同じにする（v2 は読み→母音→表記の順に考えさせたい）
      out.propertyOrdering = Object.keys(v as object);
    } else out[k] = toGeminiSchema(v);
  }
  return out;
}

const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini',
  keyHelp: 'https://aistudio.google.com/apikey で作成',
  async listModels(key) {
    const res = await fetchJson(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
    return (res.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''))
      .filter((id: string) => id.startsWith('gemini'))
      .sort()
      .reverse();
  },
  pickDefault(models) {
    return models.find((m) => m.includes('flash') && !m.includes('lite')) ?? models[0];
  },
  async generate(key, model, system, schema, user) {
    const res = await fetchJson(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
      }),
    });
    const parts: { text?: string }[] = res.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    if (!text) throw new Error(`応答が空です（${res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? '不明'}）`);
    return text;
  },
};

// ---- ChatGPT（OpenAI）----

const OPENAI = 'https://api.openai.com/v1';

const openai: Provider = {
  id: 'openai',
  label: 'ChatGPT',
  keyHelp: 'https://platform.openai.com/api-keys で作成',
  async listModels(key) {
    const res = await fetchJson(`${OPENAI}/models`, { headers: { authorization: `Bearer ${key}` } });
    const skip = /audio|realtime|tts|transcribe|image|search|embedding|moderation|dall-e|whisper|instruct/;
    return (res.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) => /^(gpt|o\d|chatgpt)/.test(id) && !skip.test(id))
      .sort()
      .reverse();
  },
  pickDefault(models) {
    return models.find((m) => m.startsWith('gpt') && !m.includes('mini') && !m.includes('nano')) ?? models[0];
  },
  async generate(key, model, system, schema, user) {
    const res = await fetchJson(`${OPENAI}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'candidates', strict: true, schema } },
      }),
    });
    const msg = res.choices?.[0]?.message;
    if (msg?.refusal) throw new Error(`拒否されました（${msg.refusal}）`);
    return msg?.content ?? '';
  },
};

// ---- Sarashina（SB Intuitions。OpenAI 互換の形式。書かれていない引数を送ると 400 になる）----

const SARASHINA = 'https://api.sarashina.ai/v1';
/** 一覧の API が使えない時に出すモデル */
const SARASHINA_MODELS = ['sarashina3-mini', 'sarashina3-nano'];
/** json_schema の出力指定が通らなかったモデル（以後は指示文で JSON を頼む） */
const noSchema = new Set<string>();

const sarashina: Provider = {
  id: 'sarashina',
  label: 'Sarashina',
  keyHelp: 'https://sarashina.ai/ に Google アカウントでログインして作成。無料ベータは1分あたりの回数制限が厳しいので「同時に送る数」は1に',
  async listModels(key) {
    try {
      const res = await fetchJson(`${SARASHINA}/models`, { headers: { authorization: `Bearer ${key}` } });
      const ids = (res.data ?? []).map((m: { id: string }) => m.id).filter((id: string) => /sarashina/.test(id) && !/embed|rerank|guard|translate/.test(id));
      return ids.length ? ids : SARASHINA_MODELS;
    } catch {
      return SARASHINA_MODELS;
    }
  },
  pickDefault(models) {
    return models.find((m) => m.includes('mini')) ?? models[0];
  },
  async generate(key, model, system, schema, user) {
    const call = (structured: boolean) =>
      withRetryOn429(() =>
        fetchJson(`${SARASHINA}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            // max_tokens は受け付けず、max_completion_tokens（1〜8000）を使う
            max_completion_tokens: 2000,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: structured ? user : `${user}\n\n${jsonInstruction(schema)}` },
            ],
            ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'candidates', strict: true, schema } } } : {}),
          }),
        }),
      );
    let res;
    if (noSchema.has(model)) res = await call(false);
    else {
      try {
        res = await call(true);
      } catch (e) {
        if (!/HTTP 400/.test((e as Error).message)) throw e;
        noSchema.add(model);
        res = await call(false);
      }
    }
    return res.choices?.[0]?.message?.content ?? '';
  },
};

/** 出力形式を指定できない時に、指示文で JSON の形を伝える */
function jsonInstruction(schema: JsonSchema): string {
  const fields = schema.properties.candidates.items.required.map((f) => `"${f}": "..."`).join(', ');
  return `次の形の JSON だけを返してください（説明やコードブロックは不要）：{"candidates": [{${fields}}]}`;
}

/** 回数制限（429）の時は少し待ってやり直す */
async function withRetryOn429<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= 5 || !/HTTP 429/.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 12000));
    }
  }
}

export const PROVIDERS: Record<ProviderId, Provider> = { claude, gemini, openai, sarashina };

async function fetchJson(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // ブラウザからの直接呼び出し（CORS）を受け付けていない API だと、ここで失敗する
    throw new Error(`接続できませんでした（${(e as Error).message}）。この API がブラウザからの直接呼び出しを受け付けていない可能性があります`);
  }
  const body = await res.text();
  if (!res.ok) {
    let message = body;
    try {
      message = JSON.parse(body).error?.message ?? body;
    } catch {
      // JSON でなければ本文をそのまま
    }
    throw new Error(`HTTP ${res.status}: ${message.slice(0, 300)}`);
  }
  return JSON.parse(body);
}
