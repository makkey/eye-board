import './style.css';
import { CalibrationRun, stepInstruction } from './calibration';
import type { CalProgress } from './calibration';
import { F_BLINK, classify, classifyDefault, loadCalibration, saveCalibration } from './classifier';
import type { Calibration, ClassifyResult } from './classifier';
import { InputEngine } from './engine';
import { Feedback } from './feedback';
import { applyEnglish } from './english';
import { applyItem } from './kana';
import { KEYMAPS, flowerIndex, itemLabel, itemSpeech } from './layout';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { Tracker } from './tracker';
import type { TrackerFrame } from './tracker';
import { ALL_CLASSES, ALL_DIRS, DIR_ARROW, DIR_NAME_JA } from './types';
import type { Dir, GazeClass, Item, Lang, Row, Settings, SideDir } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 状態 ----
const settings: Settings = loadSettings();
let calibration: Calibration | null = loadCalibration();
let mode: 'none' | 'camera' | 'sim' = 'none';
let text = '';
const undoStack: string[] = [];
let lastRaw: ClassifyResult | null = null;
/** 目を閉じる直前に見ていた方向（閉じている間はこれを渡す） */
let lastOpenDir: Dir = 'C';
let lastFrame: TrackerFrame | null = null;
let closedNow = false;
let calRun: CalibrationRun | null = null;
let spokenItem: Item | null = null;
let spokenRow: Row | null = null;
const trail: number[][] = [];

const feedback = new Feedback(settings);
const tracker = new Tracker($<HTMLVideoElement>('video'));
tracker.smoothing = settings.smoothing;

/** 読み上げる定型の言葉（入力中の言語で読む） */
const PHRASES: Record<Lang, { cancel: string; back: string; empty: string; name: string }> = {
  ja: { cancel: 'キャンセル', back: 'もどる', empty: '何も入力されていません', name: '日本語' },
  en: { cancel: 'cancel', back: 'back', empty: 'nothing typed', name: 'English' },
};
const phrase = () => PHRASES[settings.lang];

const engine = new InputEngine(settings, {
  rowCandidate(row, long) {
    spokenRow = row;
    feedback.play(long ? 'long' : 'tick');
    void feedback.say(row.speak);
  },
  rowCommit(row) {
    feedback.play('commit');
    if (row !== spokenRow) void feedback.say(row.speak);
    spokenRow = null;
    renderKeyboard();
  },
  itemCandidate(item) {
    spokenItem = item;
    feedback.play('tick');
    void feedback.say(itemSpeech(item));
  },
  commit(item) {
    feedback.play('commit');
    if (item !== spokenItem) void feedback.say(itemSpeech(item));
    spokenItem = null;
    applyToText(item);
    renderKeyboard();
  },
  cancel(reason) {
    spokenItem = spokenRow = null;
    feedback.play('cancel');
    void feedback.say(reason === 'idle' ? phrase().cancel : phrase().back);
    renderKeyboard();
  },
  retract() {
    // 目を閉じて入れたスペースを、閉じ続けて記号に切り替えたので取り消す
    undo();
  },
}, KEYMAPS[settings.lang]);

// ---- テキスト ----
const textEl = $<HTMLTextAreaElement>('text');

function setText(next: string) {
  if (next === text) return;
  undoStack.push(text);
  if (undoStack.length > 200) undoStack.shift();
  text = next;
  textEl.value = text;
  textEl.scrollTop = textEl.scrollHeight;
}

function applyToText(item: Item) {
  if (item.kind === 'action' && item.action === 'speak') {
    void feedback.say(text || phrase().empty, true);
    return;
  }
  if (item.kind === 'action' && item.action === 'undo') {
    undo();
    return;
  }
  setText(settings.lang === 'en' ? applyEnglish(text, item) : applyItem(text, item));
}

function undo() {
  if (!undoStack.length) return;
  text = undoStack.pop()!;
  textEl.value = text;
}

$('btn-speak').onclick = () => void feedback.say(text || phrase().empty, true);
$('btn-copy').onclick = () => void navigator.clipboard?.writeText(text);
$('btn-undo').onclick = undo;
$('btn-clear').onclick = () => setText('');

// ---- キーボード表示 ----
const keyboardEl = $('keyboard');

/** 画面上の並び（上段：↖ ↑ ↗、下段：← 中央 →） */
const DIR_GRID: Dir[] = ['UL', 'U', 'UR', 'L', 'C', 'R'];

/** キーの下に小さく出す残りの文字（「あ」→「いうえお」）。ラベルが複数文字なら出さない（「ABCDE」など） */
function rowSub(row: Row): string {
  if ([...row.label].length > 1) return '';
  return row.items
    .slice(1)
    .filter((x): x is Item => !!x)
    .map(itemLabel)
    .join('');
}

let renderedStage = '';

function renderKeyboard() {
  const key = `${engine.keymap.lang}:` + (engine.stage === 'row' ? 'row' : `char:${engine.row?.id}`);
  if (key === renderedStage) return;
  renderedStage = key;
  keyboardEl.innerHTML = '';
  keyboardEl.className = `keyboard stage-${engine.stage}`;

  if (engine.stage === 'row') {
    const km = engine.keymap;
    for (const dir of DIR_GRID) {
      if (dir === 'C') {
        const cs = km.closeShort;
        const label = cs.kind === 'row' ? cs.row.label : itemLabel(cs.item);
        const sub = cs.kind === 'row' ? rowSub(cs.row) : closeShortName();
        keyboardEl.append(keyEl(dir, label, sub, km.closeLong.label, '目を閉じる／下'));
      } else {
        const row = km.rowByDir[dir];
        keyboardEl.append(keyEl(dir, row.label, rowSub(row), km.longRowByDir[dir].label, DIR_ARROW[dir]));
      }
    }
    return;
  }

  // フラワー配置：左から時計回りに あ・い・う・え・お
  const row = engine.row!;
  for (const dir of DIR_GRID) {
    const cell = document.createElement('div');
    if (dir === 'C') {
      cell.className = 'cell center';
      // 左の「あ段」と紛れないよう、中央は行の名前を小さく出す
      cell.innerHTML = `<span class="main">${row.speak.endsWith('行') ? row.speak : row.label}</span>`;
    } else {
      const item = row.items[flowerIndex(dir)];
      cell.className = item ? 'cell' : 'cell empty';
      cell.id = `cell-${dir}`;
      const label = item ? itemLabel(item) : '';
      // 「゛゜小」「⌫削除」のような長いラベルは小さめに
      const cls = [...label].length > 2 ? 'main small' : 'main';
      cell.innerHTML = `<span class="hint">${DIR_ARROW[dir]}</span><span class="${cls}">${label}</span>`;
    }
    keyboardEl.append(cell);
  }
  const back = document.createElement('div');
  back.className = 'cell back';
  back.innerHTML = `<span class="main">目を閉じる／下を見る → もどる</span>`;
  keyboardEl.append(back);
}

function keyEl(dir: Dir, label: string, sub: string, longLabel: string, hint: string) {
  const el = document.createElement('div');
  el.className = 'key';
  el.id = `key-${dir}`;
  // 「ABCDE」のような長いラベルは小さめに
  const cls = [...label].length > 2 ? 'main small' : 'main';
  el.innerHTML = `<span class="hint">${hint}</span><span class="${cls}">${label}</span>
    <span class="sub">${sub}</span><span class="long">2秒: ${longLabel}</span>`;
  return el;
}

/** 1段目で目を閉じた時に入るものの名前（な行／スペース） */
function closeShortName(): string {
  const cs = engine.keymap.closeShort;
  return cs.kind === 'row' ? cs.row.speak : 'スペース';
}

// ---- 視線インジケータ ----
const gazeEl = $('gaze');
const gazeCells = {} as Record<GazeClass, HTMLElement>;
for (const cls of [...DIR_GRID, 'closed'] as GazeClass[]) {
  const c = document.createElement('div');
  c.textContent = cls === 'closed' ? '閉／下' : DIR_ARROW[cls];
  if (cls === 'closed') c.className = 'closed';
  gazeEl.append(c);
  gazeCells[cls] = c;
}

// ---- 毎フレームの描画 ----
const statusMain = $('status-main');
const statusSub = $('status-sub');
const meterFill = $('meter-fill');
const meterLong = $('meter-long');

function updateView(t: number) {
  // ハイライト
  keyboardEl.querySelectorAll('.hover, .candidate').forEach((el) => el.classList.remove('hover', 'candidate'));
  const cand = engine.candidate;
  keyboardEl.querySelectorAll('.long-active').forEach((el) => el.classList.remove('long-active'));
  if (engine.stage === 'row') {
    const keyId = `key-${engine.dir}`;
    if (cand?.kind === 'row') {
      $(keyId)?.classList.add('candidate');
      if (cand.long) $(keyId)?.classList.add('long-active');
    } else if (engine.dir !== 'C') $(keyId)?.classList.add('hover');
  } else {
    if (cand?.kind === 'item') $(`cell-${cand.dir}`)?.classList.add('candidate');
    else if (engine.dir !== 'C') $(`cell-${engine.dir}`)?.classList.add('hover');
  }

  for (const cls of [...ALL_DIRS, 'closed'] as GazeClass[]) {
    const on = cls === 'closed' ? closedNow : engine.dir === cls && !closedNow;
    gazeCells[cls].classList.toggle('on', on);
    gazeCells[cls].classList.toggle('raw', lastRaw?.cls === cls && !on);
  }
  gazeEl.classList.toggle('noface', mode === 'camera' && !lastFrame?.faceFound);

  // メーター
  let fill = 0;
  let marker: number | null = null;
  if (engine.closedStart !== null) {
    const dur = t - engine.closedStart;
    if (engine.stage === 'row' || engine.closeCanSwitch) {
      // 1段目：0.6秒で な行（スペース）、2秒で 記号
      fill = dur / settings.longMs;
      marker = settings.closeMinMs / settings.longMs;
    } else {
      fill = engine.closeDone ? 1 : dur / settings.closeMinMs;
    }
  } else if (engine.dir !== 'C') {
    const held = engine.held;
    if (engine.stage === 'row') {
      fill = held / settings.longMs;
      marker = settings.selectMs / settings.longMs;
    } else {
      fill = held / settings.selectMs;
    }
  }
  meterFill.style.width = `${Math.min(1, fill) * 100}%`;
  meterLong.style.left = marker === null ? '-10px' : `${marker * 100}%`;

  // 案内文
  let main = '';
  let sub = '';
  if (mode === 'camera' && tracker.active && t - tracker.lastFrameAt > 2000) {
    main = '顔認識が止まっています';
    sub = trackerDiagnostics();
  } else if (mode === 'camera' && !lastFrame?.faceFound) {
    main = '顔が見つかりません';
    sub = 'カメラに顔が正面から映るようにしてください';
  } else if (engine.closedStart !== null) {
    main = '目を閉じています';
    const longName = engine.keymap.closeLong.label;
    if (!engine.closeDone) sub = `そのまま閉じていると${engine.stage === 'row' ? ` ${closeShortName()}` : '、もどる'}`;
    else if (engine.closeAction === 'back') sub = 'もどりました。目を開けてください';
    else if (engine.closeCanSwitch) sub = `${closeShortName()}。そのまま閉じていると ${longName}`;
    else sub = `${engine.row?.label ?? ''}。目を開けてください`;
  } else if (engine.stage === 'row') {
    if (cand?.kind === 'row') {
      main = `${cand.row.label}`;
      const longRow = engine.keymap.longRowByDir[engine.dir as SideDir];
      sub = '画面に視線を戻すと確定' + (cand.long ? '' : `（見続けると ${longRow.label}）`);
    } else {
      main = '行を選ぶ';
      sub = `方向を見る → 戻る　／　目を閉じる（下を見る）→ ${closeShortName()}`;
    }
  } else {
    const row = engine.row!;
    if (cand?.kind === 'item') {
      main = `「${itemLabel(cand.item)}」`;
      sub = '画面に視線を戻すと確定';
    } else {
      main = `${row.label} — 文字を選ぶ`;
      sub = '← ↖ ↑ ↗ → を見て戻る　／　目を閉じる（下を見る）→ もどる';
    }
  }
  statusMain.textContent = main;
  statusSub.textContent = sub;

  if (debugOn) drawDebug();
}

// ---- 入力の流れ ----
function onTrackerFrame(f: TrackerFrame) {
  lastFrame = f;
  if (f.faceFound) {
    trail.push(f.feature);
    if (trail.length > 40) trail.shift();
  }
  calRun?.push(f);
  if (mode !== 'camera' || calRun) return;

  lastRaw = calibration
    ? classify(f.feature, calibration, {
        prev: lastRaw?.cls ?? null,
        hysteresis: settings.hysteresis,
        centerBias: settings.centerBias,
        closedBias: settings.closedBias,
      })
    : classifyDefault(f.feature);
  closedNow = f.faceFound && lastRaw.cls === 'closed';
  if (lastRaw.cls !== 'closed') lastOpenDir = lastRaw.cls;
  engine.update({ t: f.t, faceFound: f.faceFound, dir: lastOpenDir, closed: closedNow });
}
tracker.onFrame = onTrackerFrame;

function frameLoop() {
  const t = performance.now();
  if (mode === 'sim' && !calRun) {
    const cls = simClass();
    closedNow = cls === 'closed';
    if (cls !== 'closed') lastOpenDir = cls;
    lastRaw = { cls, distances: {} };
    engine.update({ t, faceFound: true, dir: lastOpenDir, closed: closedNow });
  }
  updateView(t);
  requestAnimationFrame(frameLoop);
}

// ---- シミュレーション（キーボード） ----
const simKeys = new Set<string>();
// 下方向（Z X C・↓）とスペースは、目を閉じるのと同じ扱い
const SIM_MAP: Record<string, GazeClass> = {
  q: 'UL',
  w: 'U',
  e: 'UR',
  a: 'L',
  d: 'R',
  z: 'closed',
  x: 'closed',
  c: 'closed',
  ' ': 'closed',
};

function simClass(): GazeClass {
  for (const [k, cls] of Object.entries(SIM_MAP)) if (simKeys.has(k)) return cls;
  if (simKeys.has('arrowdown')) return 'closed';
  const v = simKeys.has('arrowup') ? 'U' : '';
  const h = simKeys.has('arrowleft') ? 'L' : simKeys.has('arrowright') ? 'R' : '';
  return ((v + h) || 'C') as Dir;
}

window.addEventListener('keydown', (e) => {
  if (mode !== 'sim' || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k in SIM_MAP || k.startsWith('arrow')) {
    simKeys.add(k);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => simKeys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => simKeys.clear());

// ---- 開始 ----
function setMode(next: typeof mode) {
  mode = next;
  $('camera-preview').hidden = !tracker.active;
  engine.reset(performance.now());
  renderedStage = '';
  renderKeyboard();
  const badge = $('mode-badge');
  badge.hidden = mode === 'none';
  badge.textContent =
    mode === 'sim' ? 'キーボード操作' : calibration ? 'カメラ' : 'カメラ（未キャリブレーション）';
}

async function startCamera(): Promise<boolean> {
  feedback.unlock();
  if (tracker.active) return true;
  const err = $('start-error');
  try {
    await tracker.start((msg) => {
      err.textContent = '';
      statusMain.textContent = msg || statusMain.textContent;
      if (msg) $('btn-start-camera').textContent = msg;
    });
    return true;
  } catch (e) {
    console.error(e);
    err.textContent = `カメラを開始できませんでした: ${(e as Error).message}`;
    $('start').hidden = false;
    $('btn-start-camera').textContent = 'カメラで始める';
    return false;
  }
}

$('btn-start-camera').onclick = async () => {
  if (!(await startCamera())) return;
  $('start').hidden = true;
  setMode('camera');
  if (!calibration) await runCalibration();
};

$('btn-start-sim').onclick = () => {
  feedback.unlock();
  $('start').hidden = true;
  setMode('sim');
};

// ---- 言語 ----
function showLang() {
  $('btn-lang').textContent = `言語: ${PHRASES[settings.lang].name}`;
}

$('btn-lang').onclick = (e) => {
  // キーボード操作（Space など）でボタンが押されないよう、フォーカスを外す
  (e.currentTarget as HTMLElement).blur();
  settings.lang = settings.lang === 'ja' ? 'en' : 'ja';
  saveSettings(settings);
  engine.setKeymap(KEYMAPS[settings.lang], performance.now());
  renderKeyboard();
  showLang();
  feedback.unlock();
  void feedback.say(phrase().name);
};
showLang();

// ---- キャリブレーション ----
const calibEl = $('calib');

async function runCalibration() {
  if (calRun) return;
  $('start').hidden = true;
  if (!(await startCamera())) return;
  calibEl.hidden = false;
  calRun = new CalibrationRun(feedback, showCalProgress);
  try {
    // スマホでは最初の数秒、顔認識の準備（GPU の初期化など）でフレームが来ないことがある
    $('calib-arrow').textContent = '⏳';
    $('calib-text').textContent = '顔認識を準備中…';
    $('calib-count').textContent = '';
    const ready = await waitForFrames(10, 15000);
    if (!ready) throw new Error('顔認識が動き始めませんでした。');
    calibration = await calRun.run();
    saveCalibration(calibration);
    const weak = ALL_CLASSES.filter((c) => calibration!.quality[c] < 0.8);
    if (weak.length) {
      alert(
        `次の区別がつきにくい結果でした：${weak.map(className).join('、')}\n` +
          '明るさやカメラの位置を変えて、もう一度試すと改善するかもしれません。',
      );
    }
  } catch (e) {
    if ((e as Error).message !== '中断しました') alert(`${(e as Error).message}\n\n${trackerDiagnostics()}`);
  } finally {
    calRun = null;
    calibEl.hidden = true;
    setMode('camera');
  }
}

/** 顔認識が n フレーム以上処理するまで待つ */
async function waitForFrames(n: number, timeoutMs: number): Promise<boolean> {
  const start = performance.now();
  const base = tracker.frames;
  while (performance.now() - start < timeoutMs) {
    if (calRun === null) return false;
    if (tracker.frames - base >= n) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function trackerDiagnostics(): string {
  const v = $<HTMLVideoElement>('video');
  return [
    `処理: ${tracker.delegate}`,
    `処理したフレーム: ${tracker.frames}`,
    `映像: ${v.videoWidth}×${v.videoHeight}`,
    `エラー: ${tracker.lastError ?? 'なし'}`,
    ...(tracker.badFrames ? [`数値にならないフレーム: ${tracker.badFrames}（${tracker.lastBad}）`] : []),
  ].join(' / ');
}

function showCalProgress(p: CalProgress) {
  $('calib-arrow').textContent = p.step === 'closed' ? '😌' : p.step === 'down' ? '↓' : DIR_ARROW[p.step];
  $('calib-text').textContent = stepInstruction(p.step);
  $('calib-fill').style.width = `${p.phase === 'record' ? p.progress * 100 : 0}%`;
  $('calib-count').textContent = `${p.index + 1} / ${p.total}` + (p.phase === 'record' ? '　記録中…' : '');
  calibEl.dataset.step = p.step;
}

$('btn-calibrate').onclick = () => void runCalibration();
$('btn-calib-cancel').onclick = () => calRun?.abort();

// ---- 設定 ----
const FIELDS: { key: keyof Settings; label: string; step?: number; min?: number; max?: number }[] = [
  { key: 'selectMs', label: '候補になるまで（ms）', step: 50, min: 100 },
  { key: 'longMs', label: '長く見る（わ・゛など）（ms）', step: 100, min: 500 },
  { key: 'closeMinMs', label: '目を閉じて選択（ms）', step: 50, min: 200 },
  { key: 'idleMs', label: '無操作キャンセル（ms）', step: 500, min: 1000 },
  { key: 'debounceMs', label: '揺れの無視（ms）', step: 10, min: 0 },
  { key: 'smoothing', label: '平滑化（1 = なし）', step: 0.05, min: 0.05, max: 1 },
  { key: 'hysteresis', label: '方向切替の粘り（小 = 粘る）', step: 0.05, min: 0.3, max: 1 },
  { key: 'centerBias', label: '中央の広さ（小 = 広い）', step: 0.05, min: 0.2, max: 3 },
  { key: 'closedBias', label: '閉じた判定の広さ（小 = 閉じたと判定しやすい）', step: 0.05, min: 0.1, max: 3 },
  { key: 'ttsRate', label: '読み上げ速度', step: 0.1, min: 0.5, max: 3 },
  { key: 'tts', label: '読み上げ' },
  { key: 'sound', label: '効果音' },
];

function renderSettings() {
  const box = $('settings-fields');
  box.innerHTML = '';
  for (const f of FIELDS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const value = settings[f.key];
    if (typeof value === 'boolean') {
      input.type = 'checkbox';
      input.checked = value;
    } else {
      input.type = 'number';
      input.value = String(value);
      if (f.step) input.step = String(f.step);
      if (f.min !== undefined) input.min = String(f.min);
      if (f.max !== undefined) input.max = String(f.max);
    }
    input.onchange = () => {
      const s = settings as unknown as Record<string, number | boolean>;
      s[f.key] = input.type === 'checkbox' ? input.checked : Number(input.value) || DEFAULT_SETTINGS[f.key] as number;
      tracker.smoothing = settings.smoothing;
      saveSettings(settings);
    };
    label.append(f.label, input);
    box.append(label);
  }
}

$('btn-settings').onclick = () => {
  renderSettings();
  $<HTMLDialogElement>('settings').showModal();
};
$('btn-reset-settings').onclick = () => {
  Object.assign(settings, DEFAULT_SETTINGS);
  tracker.smoothing = settings.smoothing;
  saveSettings(settings);
  renderSettings();
};
$('btn-forget-cal').onclick = () => {
  calibration = null;
  saveCalibration(null);
  setMode(mode);
};

// ---- デバッグ ----
let debugOn = false;
$('btn-debug').onclick = () => {
  debugOn = !debugOn;
  $('debug').hidden = !debugOn;
  $('btn-debug').setAttribute('aria-pressed', String(debugOn));
};

// 実機での判定の様子を共有してもらうため、キャリブレーション結果をテキストでコピーする
$('btn-copy-cal').onclick = async () => {
  if (!calibration) {
    alert('まだキャリブレーションしていません');
    return;
  }
  const r = (xs: number[]) => xs.map((x) => Number(x.toPrecision(3)));
  const summary = {
    features: ['bsX', 'bsY', 'irisX', 'irisY', 'blink', 'open'],
    means: Object.fromEntries(ALL_CLASSES.map((c) => [c, r(calibration!.means[c])])),
    sd: r(calibration.variance.map(Math.sqrt)),
    quality: Object.fromEntries(ALL_CLASSES.map((c) => [c, Math.round(calibration!.quality[c] * 100)])),
    settings,
    ua: navigator.userAgent,
  };
  const textOut = JSON.stringify(summary);
  try {
    await navigator.clipboard.writeText(textOut);
    alert('コピーしました。チャットに貼り付けてください。');
  } catch {
    prompt('コピーできませんでした。以下を手動でコピーしてください。', textOut);
  }
};

const plot = $<HTMLCanvasElement>('debug-plot');
const pctx = plot.getContext('2d')!;
const debugText = $('debug-text');

function drawDebug() {
  const W = plot.width;
  const H = plot.height;
  const style = getComputedStyle(document.body);
  const fg = style.getPropertyValue('--fg') || '#fff';
  const accent = style.getPropertyValue('--accent') || '#4cf';
  pctx.clearRect(0, 0, W, H);

  // blendshape の2次元（x: 本人の右が右, y: 上が上）を表示
  const pts = calibration ? ALL_DIRS.map((d) => calibration!.means[d]) : [];
  const range = Math.max(0.3, ...pts.flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]), ...trail.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) * 1.15;
  const sx = (x: number) => W / 2 + (x / range) * (W / 2);
  const sy = (y: number) => H / 2 - (y / range) * (H / 2);

  pctx.strokeStyle = fg;
  pctx.globalAlpha = 0.2;
  pctx.beginPath();
  pctx.moveTo(0, H / 2);
  pctx.lineTo(W, H / 2);
  pctx.moveTo(W / 2, 0);
  pctx.lineTo(W / 2, H);
  pctx.stroke();
  pctx.globalAlpha = 1;

  pctx.font = '14px system-ui';
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  if (calibration) {
    for (const d of ALL_DIRS) {
      const m = calibration.means[d];
      pctx.fillStyle = engine.dir === d ? accent : fg;
      pctx.fillText(DIR_ARROW[d], sx(m[0]), sy(m[1]));
    }
  }
  pctx.fillStyle = accent;
  trail.forEach((p, i) => {
    pctx.globalAlpha = (i + 1) / trail.length;
    pctx.beginPath();
    pctx.arc(sx(p[0]), sy(p[1]), 3, 0, Math.PI * 2);
    pctx.fill();
  });
  pctx.globalAlpha = 1;

  const f = lastFrame;
  const fmt = (x: number) => x.toFixed(3).padStart(7);
  const dist = lastRaw?.distances ?? {};
  debugText.textContent = [
    `mode       ${mode}${calibration ? '' : '（未キャリブレーション）'}`,
    `顔認識     ${trackerDiagnostics()}`,
    `face       ${f?.faceFound ?? '-'}`,
    `bs  x,y    ${f ? fmt(f.feature[0]) + fmt(f.feature[1]) : '-'}`,
    `iris x,y   ${f ? fmt(f.feature[2]) + fmt(f.feature[3]) : '-'}`,
    `blink,開き ${f ? fmt(f.feature[F_BLINK]) + fmt(f.feature[5]) : '-'}`,
    `判定       ${lastRaw ? className(lastRaw.cls) : '-'}　安定 ${DIR_NAME_JA[engine.dir]}`,
    `stage      ${engine.stage}${engine.row ? ' ' + engine.row.label : ''}`,
    '',
    'クラス  距離   キャリブ精度',
    ...ALL_CLASSES.map(
      (c) =>
        `${className(c).padEnd(3, '　')} ${dist[c] !== undefined ? dist[c]!.toFixed(1).padStart(6) : '     -'}` +
        `   ${calibration ? Math.round(calibration.quality[c] * 100) + '%' : '-'}`,
    ),
  ].join('\n');
}

function className(c: GazeClass): string {
  return c === 'closed' ? '閉じる' : DIR_NAME_JA[c];
}

// ---- 起動 ----
renderKeyboard();
requestAnimationFrame(frameLoop);
