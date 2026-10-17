import './style.css';
import { CalibrationRun, stepInstruction } from './calibration';
import type { CalProgress } from './calibration';
import { classify, classifyDefault, loadCalibration, saveCalibration } from './classifier';
import type { Calibration, ClassifyResult } from './classifier';
import { InputEngine } from './engine';
import { Feedback } from './feedback';
import { applyItem } from './kana';
import { LONG_ROW_BY_DIR, ROWS, ROW_BY_DIR, itemLabel, itemSpeech } from './layout';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { Tracker } from './tracker';
import type { TrackerFrame } from './tracker';
import { ALL_DIRS, DIR_ARROW, DIR_NAME_JA } from './types';
import type { Dir, Item, Row, Settings, Slot } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 状態 ----
const settings: Settings = loadSettings();
let calibration: Calibration | null = loadCalibration();
let mode: 'none' | 'camera' | 'sim' = 'none';
let text = '';
const undoStack: string[] = [];
let lastRaw: ClassifyResult | null = null;
let lastFrame: TrackerFrame | null = null;
let closedNow = false;
let calRun: CalibrationRun | null = null;
let spokenItem: Item | null = null;
let spokenRow: Row | null = null;
const trail: number[][] = [];

const feedback = new Feedback(settings);
const tracker = new Tracker($<HTMLVideoElement>('video'));
tracker.smoothing = settings.smoothing;

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
  cancel() {
    spokenItem = spokenRow = null;
    feedback.play('cancel');
    void feedback.say('キャンセル');
    renderKeyboard();
  },
  closeTick(level) {
    feedback.play(level === 1 ? 'close1' : 'close2');
  },
});

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
    void feedback.say(text || '何も入力されていません', true);
    return;
  }
  setText(applyItem(text, item));
}

$('btn-speak').onclick = () => void feedback.say(text || '何も入力されていません', true);
$('btn-copy').onclick = () => void navigator.clipboard?.writeText(text);
$('btn-undo').onclick = () => {
  if (!undoStack.length) return;
  text = undoStack.pop()!;
  textEl.value = text;
};
$('btn-clear').onclick = () => setText('');

// ---- キーボード表示 ----
const keyboardEl = $('keyboard');

const DIR_GRID: Dir[] = ['UL', 'U', 'UR', 'L', 'C', 'R', 'DL', 'D', 'DR'];
const LONG_KEYS: [Dir, string][] = [
  ['DL', 'mod'],
  ['D', 'wa'],
  ['DR', 'punct'],
];

function rowSub(row: Row): string {
  return (['L', 'U', 'R', 'D'] as Slot[])
    .map((s) => row.slots[s])
    .filter((x): x is Item => !!x)
    .map(itemLabel)
    .join('');
}

let renderedStage = '';

function renderKeyboard() {
  const key = engine.stage === 'row' ? 'row' : `char:${engine.row?.id}`;
  if (key === renderedStage) return;
  renderedStage = key;
  keyboardEl.innerHTML = '';
  keyboardEl.className = `keyboard stage-${engine.stage}`;

  if (engine.stage === 'row') {
    const edit = ROWS.edit;
    keyboardEl.append(keyEl(edit, `${DIR_ARROW.U} 2秒`, 'key wide'));
    for (const dir of DIR_GRID) {
      const row = ROWS[ROW_BY_DIR[dir]];
      keyboardEl.append(keyEl(row, dir === 'C' ? '目を閉じる' : DIR_ARROW[dir], 'key'));
    }
    for (const [dir, id] of LONG_KEYS) {
      keyboardEl.append(keyEl(ROWS[id], `${DIR_ARROW[dir]} 2秒`, 'key long'));
    }
    return;
  }

  const row = engine.row!;
  const layout: (Slot | null)[] = [null, 'U', null, 'L', 'C', 'R', null, 'D', null];
  for (const slot of layout) {
    const cell = document.createElement('div');
    if (!slot) {
      cell.className = 'cell empty';
    } else {
      const item = row.slots[slot];
      cell.className = item ? 'cell' : 'cell empty';
      cell.id = `cell-${slot}`;
      cell.innerHTML = `<span class="main">${item ? itemLabel(item) : ''}</span>
        <span class="hint">${slot === 'C' ? '目を閉じる' : DIR_ARROW[slot]}</span>`;
    }
    keyboardEl.append(cell);
  }
}

function keyEl(row: Row, hint: string, cls: string) {
  const el = document.createElement('div');
  el.className = cls;
  el.id = `key-${row.id}`;
  el.innerHTML = `<span class="hint">${hint}</span><span class="main">${row.label}</span><span class="sub">${rowSub(row)}</span>`;
  return el;
}

// ---- 視線インジケータ ----
const gazeEl = $('gaze');
const gazeCells = {} as Record<Dir, HTMLElement>;
for (const dir of DIR_GRID) {
  const c = document.createElement('div');
  c.textContent = DIR_ARROW[dir];
  gazeEl.append(c);
  gazeCells[dir] = c;
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
  if (engine.stage === 'row') {
    if (cand?.kind === 'row') $(`key-${cand.row.id}`)?.classList.add('candidate');
    else if (engine.dir !== 'C') $(`key-${ROWS[ROW_BY_DIR[engine.dir]].id}`)?.classList.add('hover');
  } else {
    if (cand?.kind === 'slot') $(`cell-${cand.slot}`)?.classList.add('candidate');
    else if (engine.dir !== 'C') $(`cell-${engine.dir}`)?.classList.add('hover');
  }

  for (const dir of ALL_DIRS) {
    gazeCells[dir].classList.toggle('on', engine.dir === dir);
    gazeCells[dir].classList.toggle('raw', lastRaw?.dir === dir && engine.dir !== dir);
  }
  gazeEl.classList.toggle('closed', closedNow);
  gazeEl.classList.toggle('noface', mode === 'camera' && !lastFrame?.faceFound);

  // メーター
  let fill = 0;
  let marker: number | null = null;
  if (engine.closedStart !== null) {
    const dur = t - engine.closedStart;
    fill = dur / settings.cancelCloseMs;
    marker = settings.closeMinMs / settings.cancelCloseMs;
  } else if (engine.holdStart !== null) {
    const held = t - engine.holdStart;
    if (engine.stage === 'row' && LONG_ROW_BY_DIR[engine.dir]) {
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
  if (mode === 'camera' && !lastFrame?.faceFound) {
    main = '顔が見つかりません';
    sub = 'カメラに顔が正面から映るようにしてください';
  } else if (engine.closedStart !== null) {
    const dur = t - engine.closedStart;
    main = '目を閉じています';
    sub = dur < settings.closeMinMs ? '…' : dur < settings.cancelCloseMs ? '開けると選択' : '開けるとキャンセル';
  } else if (engine.stage === 'row') {
    if (cand?.kind === 'row') {
      main = `${cand.row.label}`;
      const longId = LONG_ROW_BY_DIR[engine.dir];
      sub = '画面に視線を戻すと確定' + (longId && !cand.long ? `（見続けると ${ROWS[longId].label}）` : '');
    } else {
      main = '行を選ぶ';
      sub = '方向を見る → 戻る　／　目を閉じる → な行';
    }
  } else {
    const row = engine.row!;
    if (cand?.kind === 'slot') {
      main = `「${itemLabel(cand.item)}」`;
      sub = '画面に視線を戻すと確定';
    } else {
      main = `${row.label} — 文字を選ぶ`;
      sub = `方向を見る → 戻る　／　目を閉じる → ${row.slots.C ? itemLabel(row.slots.C) : ''}`;
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

  const allowed = engine.allowedDirs();
  const prev = lastRaw && allowed.includes(lastRaw.dir) ? lastRaw.dir : null;
  lastRaw = calibration
    ? classify(f.feature, calibration, {
        allowed,
        prev,
        hysteresis: settings.hysteresis,
        centerBias: settings.centerBias,
      })
    : classifyDefault(f.feature, allowed);
  closedNow = f.faceFound && f.blink > (calibration?.blinkThreshold ?? 0.5);
  engine.update({ t: f.t, faceFound: f.faceFound, dir: lastRaw.dir, closed: closedNow });
}
tracker.onFrame = onTrackerFrame;

function frameLoop() {
  const t = performance.now();
  if (mode === 'sim' && !calRun) {
    const dir = simDir();
    lastRaw = { dir, distances: {} };
    closedNow = simKeys.has(' ');
    engine.update({ t, faceFound: true, dir, closed: closedNow });
  }
  updateView(t);
  requestAnimationFrame(frameLoop);
}

// ---- シミュレーション（キーボード） ----
const simKeys = new Set<string>();
const SIM_MAP: Record<string, Dir> = { q: 'UL', w: 'U', e: 'UR', a: 'L', d: 'R', z: 'DL', x: 'D', c: 'DR' };

function simDir(): Dir {
  for (const [k, dir] of Object.entries(SIM_MAP)) if (simKeys.has(k)) return dir;
  const up = simKeys.has('arrowup');
  const down = simKeys.has('arrowdown');
  const left = simKeys.has('arrowleft');
  const right = simKeys.has('arrowright');
  const v = up ? 'U' : down ? 'D' : '';
  const h = left ? 'L' : right ? 'R' : '';
  return ((v + h) || 'C') as Dir;
}

window.addEventListener('keydown', (e) => {
  if (mode !== 'sim' || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k in SIM_MAP || k === ' ' || k.startsWith('arrow')) {
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

// ---- キャリブレーション ----
const calibEl = $('calib');

async function runCalibration() {
  if (calRun) return;
  $('start').hidden = true;
  if (!(await startCamera())) return;
  calibEl.hidden = false;
  calRun = new CalibrationRun(feedback, showCalProgress);
  try {
    calibration = await calRun.run();
    saveCalibration(calibration);
    if (calibration.blinkWarning) {
      alert('目を閉じた状態と開いた状態の区別がつきにくい結果でした。明るさを調整して、もう一度試すと改善するかもしれません。');
    }
  } catch (e) {
    if ((e as Error).message !== '中断しました') alert((e as Error).message);
  } finally {
    calRun = null;
    calibEl.hidden = true;
    setMode('camera');
  }
}

function showCalProgress(p: CalProgress) {
  $('calib-arrow').textContent = p.step === 'closed' ? '😌' : DIR_ARROW[p.step];
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
  { key: 'cancelCloseMs', label: '目を閉じてキャンセル（ms）', step: 100, min: 500 },
  { key: 'idleMs', label: '無操作キャンセル（ms）', step: 500, min: 1000 },
  { key: 'debounceMs', label: '揺れの無視（ms）', step: 10, min: 0 },
  { key: 'smoothing', label: '平滑化（1 = なし）', step: 0.05, min: 0.05, max: 1 },
  { key: 'hysteresis', label: '方向切替の粘り（小 = 粘る）', step: 0.05, min: 0.3, max: 1 },
  { key: 'centerBias', label: '中央の広さ（小 = 広い）', step: 0.05, min: 0.2, max: 3 },
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
    `face       ${f?.faceFound ?? '-'}`,
    `bs  x,y    ${f ? fmt(f.feature[0]) + fmt(f.feature[1]) : '-'}`,
    `iris x,y   ${f ? fmt(f.feature[2]) + fmt(f.feature[3]) : '-'}`,
    `blink      ${f ? fmt(f.blink) : '-'}  閾値 ${fmt(calibration?.blinkThreshold ?? 0.5)}`,
    `raw dir    ${lastRaw ? DIR_NAME_JA[lastRaw.dir] : '-'}　安定 ${DIR_NAME_JA[engine.dir]}`,
    `stage      ${engine.stage}${engine.row ? ' ' + engine.row.label : ''}`,
    '',
    ...ALL_DIRS.filter((d) => dist[d] !== undefined).map((d) => `${DIR_ARROW[d]} ${dist[d]!.toFixed(1)}`),
  ].join('\n');
}

// ---- 起動 ----
renderKeyboard();
requestAnimationFrame(frameLoop);
