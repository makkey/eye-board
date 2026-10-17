import '../style.css';
import './lab.css';
import { DEFAULT_SENTENCES, parseSentences } from './dataset';
import { PROMPTS, TOP_N, judge, mergeRuns, segmentPrompt, sentencePrompt } from './decode';
import type { Candidate, PromptId, PromptVersion } from './decode';
import { PROVIDERS, setSarashinaRelay } from './providers';
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
  $('effort-field').hidden = providerId !== 'claude' && providerId !== 'gemini';
  $('relay-field').hidden = providerId !== 'sarashina';
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

const relayInput = $<HTMLInputElement>('relay');
relayInput.value = store.get('relay.sarashina') ?? '';
setSarashinaRelay(relayInput.value);
relayInput.onchange = () => {
  store.set('relay.sarashina', relayInput.value.trim() || null);
  setSarashinaRelay(relayInput.value);
};

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
const promptVersion = () => PROMPTS[promptSelect.value as PromptId];
function showPrompt() {
  const p = promptVersion();
  $('prompt-preview').textContent = [
    '【指示（system）】',
    p.system,
    '',
    '【問い合わせ（user）の例】',
    '文単位：',
    sentencePrompt('いおうあ あおいあっあえ あいあおう'),
    '',
    '文節ごと：',
    segmentPrompt('昨日は', 'あおいあっあえ'),
    '',
    '【返答の形（JSON Schema）】',
    JSON.stringify(p.schema, null, 2),
  ].join('\n');
}
promptSelect.onchange = () => {
  store.set('prompt', promptSelect.value);
  showPrompt();
};
showPrompt();

/** 問い合わせ先（まとめて測る時は、実行中に画面を切り替えられても同じ設定で通す） */
interface Target {
  provider: ProviderId;
  key: string;
  model: string;
  effort: Effort;
  prompt: PromptVersion;
  /** 同時に聞く回数 */
  runs: number;
}

function currentTarget(): Target {
  const runs = Number($<HTMLSelectElement>('runs').value) || 1;
  return { provider: providerId, key: requireKey(), model: currentModel(), effort: effort(), prompt: promptVersion(), runs };
}

const runsSelect = $<HTMLSelectElement>('runs');
runsSelect.value = store.get('runs') ?? '1';
if (!runsSelect.value) runsSelect.value = '1';
runsSelect.onchange = () => store.set('runs', runsSelect.value);

interface Answer {
  /** 全候補（何回か聞いた時は合算した順位） */
  all: Candidate[];
  /** 各回で受け取った候補の数の合計と、そのうち母音が合う数 */
  received: number;
  receivedValid: number;
  /** 全部の返答がそろうまでの時間 */
  ms: number;
  raws: string[];
}

/** t.runs 回同時に問い合わせて採点する。一部が失敗しても、返ってきた分で決める */
async function ask(user: string, vowels: string, goldReading: string, goldText: string, t: Target): Promise<Answer> {
  const start = performance.now();
  const settled = await Promise.allSettled(
    Array.from({ length: t.runs }, () => PROVIDERS[t.provider].generate(t.key, t.model, t.prompt.system, t.prompt.schema, user, t.effort)),
  );
  const ms = performance.now() - start;
  const raws = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const runs: Candidate[][] = [];
  let firstError: unknown = settled.find((s) => s.status === 'rejected')?.reason;
  for (const raw of raws) {
    try {
      runs.push(judge(raw, vowels, goldReading, goldText, t.prompt.validFirst));
    } catch (e) {
      firstError ??= e;
    }
  }
  if (!runs.length) throw firstError;
  const flat = runs.flat();
  return { all: mergeRuns(runs, t.prompt.validFirst), received: flat.length, receivedValid: flat.filter((c) => c.valid).length, ms, raws };
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
  let target: Target;
  try {
    target = currentTarget();
  } catch (e) {
    error.textContent = (e as Error).message;
    return;
  }

  // 返ってくるまで数秒〜数十秒かかるので、経過時間を出しておく
  const btn = $<HTMLButtonElement>('btn-try');
  btn.disabled = true;
  const label = `${PROVIDERS[target.provider].label}: ${target.model}（指示文 ${target.prompt.id}${target.runs > 1 ? `・${target.runs}回` : ''}）`;
  const started = performance.now();
  const tick = () => (status.textContent = `${label} に問い合わせ中…（${((performance.now() - started) / 1000).toFixed(0)}秒）送った母音：${vowels}`);
  tick();
  const timer = setInterval(tick, 500);
  try {
    const user = context ? segmentPrompt(context, vowels) : sentencePrompt(vowels);
    const { all, raws, ms } = await ask(user, vowels, '', '', target);
    $('try-raw').textContent = raws.join('\n\n');
    $('try-raw-box').hidden = false;
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
  /** まだ問い合わせていない（中止した時に残る） */
  pending?: boolean;
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

/** 直近の実行の設定（エラーになった分をやり直す時に使う） */
let lastTarget: Target | null = null;
let lastMode = '';

$('btn-run').onclick = async () => {
  let target: Target;
  try {
    target = currentTarget();
  } catch (e) {
    alert((e as Error).message);
    return;
  }
  const mode = (document.querySelector('input[name=mode]:checked') as HTMLInputElement).value;
  const limit = Math.max(1, Number($<HTMLInputElement>('limit').value) || 20);
  const tasks = buildTasks(mode, limit);
  if (!tasks.length) return;
  lastTarget = target;
  lastMode = mode;
  lastRun = tasks.map((t) => ({ ...t, candidates: [], received: 0, receivedValid: 0, ms: 0, pending: true }));
  await runTasks(lastRun, target);
  if (!lastRun.some((r) => !r.pending)) return;
  results.push(summarize(target, mode, lastRun.filter((r) => !r.pending)));
  store.set('results', JSON.stringify(results));
  renderSummary();
};

$('btn-retry').onclick = async () => {
  const failed = lastRun.filter((r) => r.error);
  if (!lastTarget || !failed.length) return;
  // キーは今の画面の値を使う（無料キーから有料キーに替えてやり直せるように）
  let target = lastTarget;
  if (providerId === lastTarget.provider && keyInput.value.trim()) target = { ...lastTarget, key: keyInput.value.trim() };
  for (const r of failed) {
    r.error = undefined;
    r.pending = true;
  }
  await runTasks(failed, target);
  // 結果の表の最後の行（直近の実行）を書き直す
  results[Math.max(0, results.length - 1)] = summarize(target, lastMode, lastRun.filter((r) => !r.pending));
  store.set('results', JSON.stringify(results));
  renderSummary();
};

/** rs の各問いを並列に問い合わせ、結果を rs に書き込む */
async function runTasks(rs: TaskResult[], target: Target) {
  const parallel = Math.min(8, Math.max(1, Number($<HTMLInputElement>('parallel').value) || 3));
  stopRequested = false;
  for (const id of ['btn-run', 'btn-retry']) $<HTMLButtonElement>(id).disabled = true;
  $<HTMLButtonElement>('btn-stop').disabled = false;
  renderDetail();

  let next = 0;
  let done = 0;
  const progress = () => ($('progress').textContent = `${done} / ${rs.length}`);
  progress();
  const worker = async () => {
    while (!stopRequested && next < rs.length) {
      const r = rs[next++];
      try {
        const a = await ask(r.user, r.vowels, r.goldReading, r.goldText, target);
        r.ms = a.ms;
        r.candidates = a.all.slice(0, TOP_N);
        r.received = a.received;
        r.receivedValid = a.receivedValid;
      } catch (e) {
        r.error = (e as Error).message;
      }
      r.pending = false;
      done++;
      progress();
      renderDetail();
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));

  $<HTMLButtonElement>('btn-run').disabled = false;
  $<HTMLButtonElement>('btn-stop').disabled = true;
  updateRetryButton();
  $('progress').textContent += stopRequested ? '（中止）' : '（完了）';
}

function updateRetryButton() {
  const n = lastRun.filter((r) => r.error).length;
  const btn = $<HTMLButtonElement>('btn-retry');
  btn.hidden = !n;
  btn.disabled = !n;
  btn.textContent = `エラーになった ${n} 件だけやり直す`;
}

$('btn-stop').onclick = () => {
  stopRequested = true;
};

function summarize(t: Target, mode: string, rs: TaskResult[]): Summary {
  const ok = rs.filter((r) => !r.error);
  const received = ok.reduce((a, r) => a + r.received, 0);
  const receivedValid = ok.reduce((a, r) => a + r.receivedValid, 0);
  let modeLabel = mode === 'sentence' ? '文単位' : '文節ごと';
  if (mode === 'segment') {
    // 文の全文節が1位で当たった割合（実際の使い心地に近い）。エラーを含む文は数えない
    const bySentence = new Map<number, boolean>();
    for (const r of rs) bySentence.set(r.sentence, (bySentence.get(r.sentence) ?? true) && !!r.candidates[0]?.correct);
    const withError = new Set(rs.filter((r) => r.error).map((r) => r.sentence));
    const all = [...bySentence].filter(([i]) => !withError.has(i)).map(([, v]) => v);
    modeLabel += `（文ごと全部1位 ${pct(all.filter(Boolean).length, all.length)}）`;
  }
  const effortLabel = (t.provider === 'claude' || t.provider === 'gemini') && t.effort !== 'default' ? ` / 深さ ${t.effort}` : '';
  // 割合はエラーにならなかった問いの中で数える（混雑や回数制限で精度が低く見えないように）
  const n = ok.length || 1;
  return {
    model: `${PROVIDERS[t.provider].label}: ${t.model}${effortLabel} / 指示文 ${t.prompt.id}${t.runs > 1 ? ` / ${t.runs}回合算` : ''}`,
    mode: modeLabel,
    n: rs.length,
    top1: ok.filter((r) => r.candidates[0]?.correct).length / n,
    top5: ok.filter((r) => r.candidates.some((c) => c.correct)).length / n,
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
      r.pending ? '（待ち）' : r.error ? `エラー：${r.error}` : r.candidates.map(candidateText).join('　'),
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
    for (const r of lastRun.filter((x) => !x.pending)) {
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
  updateRetryButton();
  store.set('results', null);
  renderSummary();
  renderDetail();
};

loadProvider();
renderSummary();
