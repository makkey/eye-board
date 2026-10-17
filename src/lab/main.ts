import '../style.css';
import './lab.css';
import { DEFAULT_SENTENCES, parseSentences } from './dataset';
import { PROMPTS, TOP_N, judge, segmentPrompt, sentencePrompt } from './decode';
import type { Candidate, PromptId } from './decode';
import { PROVIDERS } from './providers';
import type { Effort, ProviderId } from './providers';
import { toVowels } from './vowels';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// localStorage は使えない環境（プライベートモードなど）でも動くように包む
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`eyeboard.lab.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(`eyeboard.lab.${k}`);
      else localStorage.setItem(`eyeboard.lab.${k}`, v);
    } catch {
      // 保存できなくても続ける
    }
  },
};

// ---- モデルの選択 ----
let providerId = (store.get('provider') as ProviderId) || 'claude';
const keyInput = $<HTMLInputElement>('api-key');
const modelSelect = $<HTMLSelectElement>('model');
const modelCustom = $<HTMLInputElement>('model-custom');

function renderProviders() {
  const tabs = $('provider-tabs');
  tabs.innerHTML = '';
  for (const p of Object.values(PROVIDERS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.setAttribute('aria-pressed', String(p.id === providerId));
    b.onclick = () => {
      providerId = p.id;
      store.set('provider', providerId);
      loadProvider();
    };
    tabs.append(b);
  }
}

function loadProvider() {
  renderProviders();
  const p = PROVIDERS[providerId];
  keyInput.value = store.get(`key.${providerId}`) ?? '';
  $('key-help').textContent = `（${p.keyHelp}）`;
  $('effort-field').hidden = providerId !== 'claude';
  const models = JSON.parse(store.get(`models.${providerId}`) ?? '[]') as string[];
  fillModels(models, store.get(`model.${providerId}`));
}

function fillModels(models: string[], selected: string | null) {
  modelSelect.innerHTML = '';
  if (!models.length) {
    const o = document.createElement('option');
    o.textContent = '（「モデル一覧を取得」を押してください）';
    o.value = '';
    modelSelect.append(o);
    return;
  }
  for (const m of models) {
    const o = document.createElement('option');
    o.value = o.textContent = m;
    modelSelect.append(o);
  }
  modelSelect.value = selected && models.includes(selected) ? selected : PROVIDERS[providerId].pickDefault(models);
}

keyInput.onchange = () => {
  if ($<HTMLInputElement>('save-key').checked) store.set(`key.${providerId}`, keyInput.value.trim());
};
$('btn-forget-key').onclick = () => {
  for (const id of Object.keys(PROVIDERS)) store.set(`key.${id}`, null);
  keyInput.value = '';
};
modelSelect.onchange = () => store.set(`model.${providerId}`, modelSelect.value);

$('btn-list').onclick = async () => {
  const btn = $<HTMLButtonElement>('btn-list');
  btn.disabled = true;
  try {
    const models = await PROVIDERS[providerId].listModels(requireKey());
    store.set(`models.${providerId}`, JSON.stringify(models));
    fillModels(models, store.get(`model.${providerId}`));
  } catch (e) {
    alert(`モデル一覧を取得できませんでした：${(e as Error).message}`);
  } finally {
    btn.disabled = false;
  }
};

function requireKey(): string {
  const key = keyInput.value.trim();
  if (!key) throw new Error('API キーを入力してください');
  return key;
}

function currentModel(): string {
  const m = modelCustom.value.trim() || modelSelect.value;
  if (!m) throw new Error('モデルを選んでください');
  return m;
}

const effort = () => $<HTMLSelectElement>('effort').value as Effort;

// ---- 指示文の版 ----
const promptSelect = $<HTMLSelectElement>('prompt-version');
for (const v of Object.values(PROMPTS)) {
  const o = document.createElement('option');
  o.value = v.id;
  o.textContent = v.label;
  promptSelect.append(o);
}
const savedPrompt = store.get('prompt');
promptSelect.value = savedPrompt && savedPrompt in PROMPTS ? savedPrompt : 'v2';
promptSelect.onchange = () => store.set('prompt', promptSelect.value);
const promptVersion = () => PROMPTS[promptSelect.value as PromptId];

/** 1回問い合わせて、かかった時間と返答を返す */
async function ask(user: string, p = promptVersion()): Promise<{ raw: string; ms: number }> {
  const key = requireKey();
  const model = currentModel();
  const start = performance.now();
  const raw = await PROVIDERS[providerId].generate(key, model, p.system, p.schema, user, effort());
  return { raw, ms: performance.now() - start };
}

// ---- 試し入力 ----
$('btn-try').onclick = async () => {
  const out = $('try-result');
  const status = $('try-status');
  const error = $('try-error');
  out.innerHTML = '';
  error.textContent = '';
  $('try-raw-box').hidden = true;

  const vowels = toVowels($<HTMLInputElement>('try-input').value);
  if (!vowels) {
    error.textContent = '母音（あいうえお・ん・っ・ー）、ひらがな・カタカナ、空白だけで入力してください。';
    return;
  }
  const context = $<HTMLInputElement>('try-context').value.trim();
  let model: string;
  try {
    requireKey();
    model = currentModel();
  } catch (e) {
    error.textContent = (e as Error).message;
    return;
  }

  // 返ってくるまで数秒〜数十秒かかるので、経過時間を出しておく
  const btn = $<HTMLButtonElement>('btn-try');
  btn.disabled = true;
  const label = `${PROVIDERS[providerId].label}: ${model}（指示文 ${promptVersion().id}）`;
  const started = performance.now();
  const tick = () => (status.textContent = `${label} に問い合わせ中…（${((performance.now() - started) / 1000).toFixed(0)}秒）送った母音：${vowels}`);
  tick();
  const timer = setInterval(tick, 500);
  try {
    const user = context ? segmentPrompt(context, vowels) : sentencePrompt(vowels);
    const { raw, ms } = await ask(user);
    $('try-raw').textContent = raw;
    $('try-raw-box').hidden = false;
    const all = judge(raw, vowels, '', '', promptVersion().validFirst);
    const cands = all.slice(0, TOP_N);
    const dropped = all.length - cands.length;
    status.textContent = `${label}　${(ms / 1000).toFixed(1)}秒　送った母音：${vowels}` + (dropped > 0 ? `　（ほかに ${dropped} 候補を省略）` : '');
    if (!cands.length) {
      error.textContent = '候補が返ってきませんでした（下の「モデルの返答」を確認してください）。';
    }
    for (const c of cands) {
      const li = document.createElement('li');
      li.textContent = `${c.text}（${c.reading}）${c.valid ? '' : '　✗母音が合わない'}`;
      out.append(li);
    }
  } catch (e) {
    status.textContent = '';
    error.textContent = `エラー：${(e as Error).message}`;
  } finally {
    clearInterval(timer);
    btn.disabled = false;
  }
};

// ---- 例文 ----
const datasetEl = $<HTMLTextAreaElement>('dataset');
datasetEl.value = store.get('dataset') ?? DEFAULT_SENTENCES;
function showDatasetInfo() {
  const { sentences, errors } = parseSentences(datasetEl.value);
  $('dataset-info').textContent = `${sentences.length} 文` + (errors.length ? `／${errors.join('、')}` : '');
}
datasetEl.oninput = () => {
  store.set('dataset', datasetEl.value);
  showDatasetInfo();
};
$('btn-reset-dataset').onclick = () => {
  datasetEl.value = DEFAULT_SENTENCES;
  store.set('dataset', null);
  showDatasetInfo();
};
showDatasetInfo();

// ---- まとめて測る ----
interface Task {
  vowels: string;
  user: string;
  goldReading: string;
  goldText: string;
  /** 文節ごとの時、何文目か（文全体の正解率の集計用） */
  sentence: number;
}

interface TaskResult extends Task {
  /** 採点・表示に使う上位 TOP_N 個 */
  candidates: Candidate[];
  /** 受け取った候補の数と、そのうち母音が合う数 */
  received: number;
  receivedValid: number;
  ms: number;
  error?: string;
}

interface Summary {
  model: string;
  mode: string;
  n: number;
  top1: number;
  top5: number;
  validRate: number;
  avgMs: number;
  errors: number;
}

let results: Summary[] = JSON.parse(store.get('results') ?? '[]');
let lastRun: TaskResult[] = [];
let stopRequested = false;

function buildTasks(mode: string, limit: number): Task[] {
  const { sentences } = parseSentences(datasetEl.value);
  const tasks: Task[] = [];
  sentences.slice(0, limit).forEach((s, i) => {
    if (mode === 'sentence') {
      const vowels = toVowels(s.readings.join(' '));
      if (vowels) {
        tasks.push({ vowels, user: sentencePrompt(vowels), goldReading: s.readings.join(' '), goldText: s.surfaces.join(''), sentence: i });
      }
      return;
    }
    s.readings.forEach((reading, j) => {
      const vowels = toVowels(reading);
      if (!vowels) return;
      const context = s.surfaces.slice(0, j).join('');
      tasks.push({ vowels, user: segmentPrompt(context, vowels), goldReading: reading, goldText: s.surfaces[j], sentence: i });
    });
  });
  return tasks;
}

$('btn-run').onclick = async () => {
  let model: string;
  try {
    requireKey();
    model = currentModel();
  } catch (e) {
    alert((e as Error).message);
    return;
  }
  const mode = (document.querySelector('input[name=mode]:checked') as HTMLInputElement).value;
  const limit = Math.max(1, Number($<HTMLInputElement>('limit').value) || 20);
  const parallel = Math.min(8, Math.max(1, Number($<HTMLInputElement>('parallel').value) || 3));
  const tasks = buildTasks(mode, limit);
  if (!tasks.length) return;
  // 実行中に切り替えられても、この実行は同じ版で通す
  const prompt = promptVersion();

  stopRequested = false;
  $<HTMLButtonElement>('btn-run').disabled = true;
  $<HTMLButtonElement>('btn-stop').disabled = false;
  lastRun = [];
  renderDetail();

  let next = 0;
  let done = 0;
  const progress = () => ($('progress').textContent = `${done} / ${tasks.length}`);
  progress();
  const worker = async () => {
    while (!stopRequested && next < tasks.length) {
      const task = tasks[next++];
      const result: TaskResult = { ...task, candidates: [], received: 0, receivedValid: 0, ms: 0 };
      try {
        const { raw, ms } = await ask(task.user, prompt);
        result.ms = ms;
        const all = judge(raw, task.vowels, task.goldReading, task.goldText, prompt.validFirst);
        result.candidates = all.slice(0, TOP_N);
        result.received = all.length;
        result.receivedValid = all.filter((c) => c.valid).length;
      } catch (e) {
        result.error = (e as Error).message;
      }
      lastRun.push(result);
      done++;
      progress();
      renderDetail();
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));

  $<HTMLButtonElement>('btn-run').disabled = false;
  $<HTMLButtonElement>('btn-stop').disabled = true;
  if (!lastRun.length) return;
  results.push(summarize(model, mode, prompt.id, lastRun));
  store.set('results', JSON.stringify(results));
  renderSummary();
  $('progress').textContent += stopRequested ? '（中止）' : '（完了）';
};

$('btn-stop').onclick = () => {
  stopRequested = true;
};

function summarize(model: string, mode: string, promptId: PromptId, rs: TaskResult[]): Summary {
  const ok = rs.filter((r) => !r.error);
  const received = ok.reduce((a, r) => a + r.received, 0);
  const receivedValid = ok.reduce((a, r) => a + r.receivedValid, 0);
  let modeLabel = mode === 'sentence' ? '文単位' : '文節ごと';
  if (mode === 'segment') {
    // 文の全文節が1位で当たった割合（実際の使い心地に近い）
    const bySentence = new Map<number, boolean>();
    for (const r of rs) bySentence.set(r.sentence, (bySentence.get(r.sentence) ?? true) && !!r.candidates[0]?.correct);
    const all = [...bySentence.values()];
    modeLabel += `（文ごと全部1位 ${pct(all.filter(Boolean).length, all.length)}）`;
  }
  const effortLabel = providerId === 'claude' && effort() !== 'default' ? ` / effort ${effort()}` : '';
  return {
    model: `${PROVIDERS[providerId].label}: ${model}${effortLabel} / 指示文 ${promptId}`,
    mode: modeLabel,
    n: rs.length,
    top1: ok.filter((r) => r.candidates[0]?.correct).length / rs.length,
    top5: ok.filter((r) => r.candidates.some((c) => c.correct)).length / rs.length,
    // 並べ替え・絞り込みの前の、モデルが返した候補全体での割合
    validRate: received ? receivedValid / received : 0,
    avgMs: ok.length ? ok.reduce((a, r) => a + r.ms, 0) / ok.length : 0,
    errors: rs.length - ok.length,
  };
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const pctOf = (x: number) => `${Math.round(x * 100)}%`;

function renderSummary() {
  const tbody = document.querySelector('#summary tbody')!;
  tbody.innerHTML = '';
  for (const s of results) {
    const tr = document.createElement('tr');
    for (const v of [s.model, s.mode, String(s.n), pctOf(s.top1), pctOf(s.top5), pctOf(s.validRate), `${(s.avgMs / 1000).toFixed(1)}秒`, String(s.errors)]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function candidateText(c: Candidate, i: number): string {
  return `${i + 1}.${c.text}${c.correct ? '✓' : ''}${c.valid ? '' : '✗'}`;
}

function renderDetail() {
  const tbody = document.querySelector('#detail tbody')!;
  tbody.innerHTML = '';
  for (const r of lastRun) {
    const tr = document.createElement('tr');
    if (r.candidates[0]?.correct) tr.className = 'hit';
    else if (r.candidates.some((c) => c.correct)) tr.className = 'near';
    const cells = [
      r.vowels,
      r.goldText,
      r.error ? `エラー：${r.error}` : r.candidates.map(candidateText).join('　'),
      r.ms ? (r.ms / 1000).toFixed(1) : '-',
    ];
    for (const v of cells) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

$('btn-copy').onclick = async () => {
  const lines = ['# 集計', 'モデル | 方式 | 件数 | 1位 | 5位以内 | 母音が合う候補 | 平均時間 | エラー'];
  for (const s of results) {
    lines.push([s.model, s.mode, s.n, pctOf(s.top1), pctOf(s.top5), pctOf(s.validRate), `${(s.avgMs / 1000).toFixed(1)}秒`, s.errors].join(' | '));
  }
  if (lastRun.length) {
    lines.push('', '# 直近の実行（✓正解 ✗母音が合わない）');
    for (const r of lastRun) {
      lines.push(`${r.vowels} | ${r.goldText} | ${r.error ? `エラー：${r.error}` : r.candidates.map(candidateText).join(' ')}`);
    }
  }
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    alert('コピーしました。チャットに貼り付けてください。');
  } catch {
    prompt('コピーできませんでした。以下を手動でコピーしてください。', text);
  }
};

$('btn-clear-results').onclick = () => {
  results = [];
  lastRun = [];
  store.set('results', null);
  renderSummary();
  renderDetail();
};

loadProvider();
renderSummary();
