import './style.css';
import { CalibrationAborted, CalibrationRun, stepInstruction } from './calibration';
import type { CalProgress } from './calibration';
import { F_BLINK, classify, classifyDefault, loadCalibration, saveCalibration } from './classifier';
import type { Calibration, ClassifyResult } from './classifier';
import { InputEngine } from './engine';
import { Feedback } from './feedback';
import { applyEnglish } from './english';
import { applyItem } from './kana';
import { HEAD_KEYMAP, VOWEL_KEYMAP, flowerIndex, itemLabel, itemSpeech, keymapFor } from './layout';
import { toVowels } from './lab/vowels';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { Tracker } from './tracker';
import type { TrackerFrame } from './tracker';
import { applyStaticTexts, className, dirName, setLang, t } from './i18n';
import type { TextKey } from './i18n';
import { ALL_CLASSES, ALL_DIRS, DIR_ARROW, FLOWER_DIRS } from './types';
import type { AiEffort, AiProvider, Dir, GazeClass, Item, JaInput, Row, Settings, SideDir } from './types';
import { DEFAULT_MODELS, PROVIDER_LABELS, atSentenceStart, convertPhrase, loadKey, providerGenerate, saveKey } from './vowelime';
import type { Conv, ConvertInfo, FixedPart } from './vowelime';
import { InputLog } from './inputlog';

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

// ---- 母音入力の状態 ----
/**
 * 入力中（まだ変換していない）の拍。母音・ん、文節の区切り ' '、
 * 12キーで入れた最初の1文字は '*な' のように * を付けて持つ
 */
let pending: string[] = [];
/** idle：母音を入力中、waiting：AI に問い合わせ中、choosing：候補を選んでいる */
/** partial：候補のうち合っている文節を選んでいる */
let conv: 'idle' | 'waiting' | 'choosing' | 'partial' = 'idle';
/** 問い合わせごとの番号（やめた・やり直した問い合わせの返事を無視するため） */
let convToken = 0;
/** 今の問い合わせを始めた時刻（「変換中…（5秒）」の表示用） */
let convStartedAt = 0;
/** 今の母音について、これまでに見せた候補（「別の候補」で除く）と、直近に並べた候補 */
let shown: string[] = [];
let lastCands: Conv[] = [];
/** 「一部を使う」で選んでいる候補と、合っていると決めた区切り（母音を入れ直すと消える） */
let partialCand: Conv | null = null;
let fixedParts: FixedPart[] = [];
/** しばらく案内欄に出すお知らせ（エラーなど） */
let notice: { text: string; until: number } | null = null;
const VOWEL_CHARS = new Set([...'あいうえおんっ']);
const isVowelMode = () => settings.lang === 'ja' && settings.jaInput === 'vowel';
const isHead = (tok: string) => tok.startsWith('*');
/** AI に送る母音の並び（最初の1文字は、その母音に直す） */
const pendingVowels = () => pending.map((tok) => (isHead(tok) ? (toVowels(tok.slice(1), 'sokuon') ?? '') : tok)).join('');
/** 区切りごとの、12キーで入れた最初の1文字（無ければ null） */
function pendingHeads(): (string | null)[] {
  const heads: (string | null)[] = [];
  let atStart = true;
  for (const tok of pending) {
    if (tok === ' ') atStart = true;
    else if (atStart) {
      heads.push(isHead(tok) ? tok.slice(1) : null);
      atStart = false;
    }
  }
  return heads;
}
/** 今の位置で最初の1文字を12キーで入れるか */
function headWanted(): boolean {
  if (!isVowelMode() || settings.aiHead === 'off') return false;
  const atSegmentStart = !pending.length || pending[pending.length - 1] === ' ';
  if (settings.aiHead === 'all') return atSegmentStart;
  return !pending.length && atSentenceStart(text);
}
/** 母音入力のキー配置を、最初の1文字か母音かに合わせる（変換中・候補を選んでいる間は変えない） */
function syncKeymap() {
  if (!isVowelMode() || conv !== 'idle') return;
  const want = headWanted() ? HEAD_KEYMAP : VOWEL_KEYMAP;
  if (engine.keymap !== want) {
    engine.swapKeymap(want);
    renderKeyboard();
  }
}

const feedback = new Feedback(settings);
const inputLog = new InputLog();
inputLog.enabled = settings.inputLog;
const tracker = new Tracker($<HTMLVideoElement>('video'));
tracker.smoothing = settings.smoothing;

// 画面の言語は入力の言語と同じにする
setLang(settings.lang);

const engine = new InputEngine(settings, {
  rowCandidate(row, long) {
    spokenRow = row;
    // 母音などその場で入るキーは、確定した時にもう一度読み上げない
    spokenItem = row.direct ?? null;
    feedback.play(long ? 'long' : 'select');
    void feedback.say(row.speak);
  },
  rowCommit(row) {
    // 変換中・候補などの画面は、それぞれの処理の側で記録する
    if (!row.id.startsWith('jv-')) inputLog.add('行', row.label);
    feedback.play('commit');
    if (row !== spokenRow) void feedback.say(row.speak);
    spokenRow = null;
    renderKeyboard();
  },
  itemCandidate(item, long) {
    spokenItem = item;
    feedback.play(long ? 'long' : 'select');
    void feedback.say(itemSpeech(item));
  },
  commit(item) {
    feedback.play('commit');
    if (item !== spokenItem) void feedback.say(itemSpeech(item));
    spokenItem = null;
    // 候補の選択などは、それで始まる変換より先に記録する。文字の入力は、入力中の拍に反映した後で記録する
    const head = engine.keymap.id === HEAD_KEYMAP.id;
    const logged = logSelection(item);
    rejectedItem = null;
    applyToText(item);
    if (!logged && rejectedItem !== item) logInput(item, head);
    renderKeyboard();
  },
  cancel(reason) {
    inputLog.add('もどる', `${reason === 'idle' ? '時間切れ' : '目を閉じた'}${conv !== 'idle' ? `（${conv}）` : ''}`);
    spokenItem = spokenRow = null;
    feedback.play('cancel');
    if (conv === 'partial') {
      // 文節を選ばずに目を閉じた：候補の一覧にもどる
      conv = 'choosing';
      void feedback.say(t('jv.backToCands'));
      engine.openRow(candidateRow(lastCands, convToken), performance.now());
    } else if (conv !== 'idle') {
      // 変換中・候補から、目を閉じて入力にもどった（入れた母音はそのまま）
      void feedback.say(t(conv === 'waiting' ? 'jv.cancelled' : 'jv.backToInput'));
      conv = 'idle';
      notice = null;
      convToken++;
      syncKeymap();
    } else {
      void feedback.say(t(reason === 'idle' ? 'say.cancel' : 'say.back'));
    }
    renderKeyboard();
  },
  retract(item) {
    // 何も入れずに目を閉じ続けた（変換は始まっていない）時は記録しない
    const noop = item.kind === 'action' && item.action === 'convert' && conv === 'idle';
    if (!noop) inputLog.add('取り消し', `${itemLabel(item)}（閉じ続けた）`);
    if (item.kind === 'action' && item.action === 'more') {
      // 「別の候補」を頼んだが、閉じ続けたので入力にもどる（この後 cancel が来る）
      conv = 'choosing';
      convToken++;
      return;
    }
    if (item.kind === 'action' && item.action === 'convert') {
      // 変換しようとしたが、閉じ続けて記号に切り替えた：問い合わせはやめる
      conv = 'idle';
      convToken++;
      return;
    }
    // 目を閉じて入れたスペースを、閉じ続けて記号に切り替えたので取り消す
    undo();
  },
}, keymapFor(settings.lang, settings.jaInput));

/** 確定した操作を入力ログに残す（母音入力では、何として入ったかと入力中の拍も） */
/** 母音入力の候補の選択・一部を使う・変換を記録する（記録したら true）。反映する前に呼ぶ */
function logSelection(item: Item): boolean {
  if (!isVowelMode()) return false;
  if (conv === 'choosing' && item.kind === 'char') {
    const n = lastCands.findIndex((c) => c.text === item.ch) + 1;
    inputLog.add('選択', `${item.ch}（${n}番目）`);
  } else if (item.kind === 'action' && item.action === 'partial') {
    inputLog.add('一部を使う', lastCands[item.ref ?? -1]?.text ?? '');
  } else if (item.kind === 'action' && item.action === 'pickPart') {
    inputLog.add('文節を選択', `${item.label}（${(item.ref ?? 0) + 1}つ目）`);
  } else if (item.kind === 'action' && (item.action === 'convert' || item.action === 'more')) {
    // 送った内容は startConversion で記録する
  } else return false;
  return true;
}

/** 文字・操作の入力を記録する。反映した後に呼ぶ（母音入力では入力中の拍も残す） */
function logInput(item: Item, head: boolean) {
  const kind = head && item.kind === 'char' && /^[ぁ-ゖ]$/.test(item.ch) ? '最初の1文字' : '入力';
  inputLog.add(kind, itemLabel(item) + (isVowelMode() && pending.length ? `　→［${pendingView()}］` : ''));
}

// ---- テキスト ----
const textEl = $<HTMLTextAreaElement>('text');

function setText(next: string) {
  if (next === text) return;
  undoStack.push(text);
  if (undoStack.length > 200) undoStack.shift();
  text = next;
  renderText();
  syncKeymap();
}

/** 入力中の拍（文節の区切りは｜で見せる） */
const pendingView = () => pending.map((tok) => (tok === ' ' ? '｜' : isHead(tok) ? tok.slice(1) : tok)).join('');

/** 入力中の拍は［ ］で後ろに付けて見せる（本文・コピーには入れない） */
function renderText() {
  textEl.value = text + (pending.length ? `［${pendingView()}］` : '');
  textEl.scrollTop = textEl.scrollHeight;
}

function setPending(next: string[]) {
  pending = next;
  renderText();
  syncKeymap();
}

function applyToText(item: Item) {
  if (isVowelMode()) {
    applyVowelItem(item);
    return;
  }
  if (item.kind === 'action' && item.action === 'speak') {
    void feedback.say(text || t('say.empty'), true);
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
  renderText();
  syncKeymap();
}

// ---- 母音入力 ----

/**
 * 候補を確定する直前の状態。「戻す」で、確定を取り消して候補の画面にもどれるように残す
 * （after は確定した後の本文。本文がそこから変わっていたら使わない）
 */
interface CommitSnapshot {
  text: string;
  after: string;
  pending: string[];
  fixed: FixedPart[];
  shown: string[];
  cands: Conv[];
}
const commitSnapshots: CommitSnapshot[] = [];

function rememberCommit(added: string) {
  commitSnapshots.push({
    text,
    after: text + added,
    pending: [...pending],
    fixed: [...fixedParts],
    shown: [...shown],
    cands: lastCands,
  });
  if (commitSnapshots.length > 50) commitSnapshots.shift();
}

/** 母音入力の「戻す」：直前に確定した文節があれば、確定を取り消して候補の画面にもどる。無ければ本文を戻す */
function undoVowel() {
  const snap = commitSnapshots[commitSnapshots.length - 1];
  if (!snap || snap.after !== text) {
    undo();
    return;
  }
  commitSnapshots.pop();
  if (undoStack[undoStack.length - 1] === snap.text) undoStack.pop();
  text = snap.text;
  pending = [...snap.pending];
  fixedParts = [...snap.fixed];
  shown = [...snap.shown];
  lastCands = snap.cands;
  partialCand = null;
  renderText();
  const token = ++convToken; // 確定の後に始まった変換があれば、その返事は使わない
  conv = 'choosing';
  engine.openRow(candidateRow(lastCands, token), performance.now());
  renderKeyboard();
  inputLog.add('戻す', `候補にもどる（［${pendingView()}］）`);
  void feedback.say(t('jv.backToCands'));
}

function applyVowelItem(item: Item) {
  if (conv === 'choosing' && item.kind === 'char') {
    // 変換候補を選んだ：文節を確定して、次の文節の入力へ
    rememberCommit(item.ch);
    conv = 'idle';
    pending = [];
    setText(text + item.ch);
    renderText();
    syncKeymap();
    return;
  }
  if (item.kind === 'char') {
    if (engine.keymap.id === HEAD_KEYMAP.id && /^[ぁ-ゖ]$/.test(item.ch)) {
      // 12キーで入れた最初の1文字。行がその文節の最初の拍の手がかりになる
      editPending([...pending, `*${item.ch}`]);
    } else if (VOWEL_CHARS.has(item.ch)) editPending([...pending, item.ch]);
    else if (item.ch === ' ') {
      // 文節の区切り。入力中の文節があって、まだ区切っていない時だけ
      if (pending.length && pending[pending.length - 1] !== ' ') editPending([...pending, ' ']);
      else reject(item, t(pending.length ? 'jv.sepTwice' : 'jv.sepEmpty'));
    } else if (pending.length) reject(item, t('jv.convertFirst'));
    else setText(text + item.ch);
    syncKeymap();
    return;
  }
  switch (item.action) {
    case 'convert':
      void startConversion(false);
      return;
    case 'more':
      void startConversion(true);
      return;
    case 'partial': {
      // 候補を見続けた：その候補の文節を並べて、合っているものを選んでもらう
      const cand = lastCands[item.ref ?? -1];
      if (!cand) return;
      conv = 'partial';
      partialCand = cand;
      engine.openRow(partialRow(cand), performance.now());
      void feedback.say(t('jv.choosePartSay'));
      renderKeyboard();
      return;
    }
    case 'pickPart':
      pickPart(item.ref ?? -1);
      return;
    case 'backspace':
      // 入力中の拍があればそれを1つ消す
      if (pending.length) editPending(pending.slice(0, -1));
      else setText(applyItem(text, item));
      break;
    case 'clear':
      setText('');
      editPending([]);
      break;
    case 'speak':
      void feedback.say(text + pendingView() || t('say.empty'), true);
      break;
    case 'undo':
      undoVowel();
      return;
    default:
      if (pending.length) reject(item, t('jv.convertFirst'));
      else setText(applyItem(text, item));
  }
  syncKeymap();
}

/** 今は受け付けられない入力：案内して、入力ログにも「入力できず」と残す */
let rejectedItem: Item | null = null;
function reject(item: Item, msg: string) {
  rejectedItem = item;
  inputLog.add('入力できず', `${itemLabel(item)}（${msg}）`);
  say(msg);
}

/** 利用者が拍を入れ直した：固定していた文節は合わなくなるので捨てる */
function editPending(next: string[]) {
  fixedParts = [];
  setPending(next);
}

/** 入力中の区切りごとの、最初の拍の位置と拍の数 */
function segmentSpans(tokens: string[]): { start: number; len: number }[] {
  const spans: { start: number; len: number }[] = [];
  let at = 0;
  let open = false;
  for (const tok of tokens) {
    if (tok === ' ') {
      open = false;
      continue;
    }
    if (!open) spans.push({ start: at, len: 0 });
    open = true;
    spans[spans.length - 1].len++;
    at++;
  }
  return spans;
}

/** 入力中の拍の、指定した位置（何拍目の前）に区切りを入れる（もう区切ってあれば何もしない） */
function withBreaks(tokens: string[], at: number[]): string[] {
  const out: string[] = [];
  let n = 0;
  for (const tok of tokens) {
    if (tok !== ' ') {
      if (n > 0 && at.includes(n) && out[out.length - 1] !== ' ') out.push(' ');
      n++;
    }
    out.push(tok);
  }
  return out;
}

/**
 * 区切りが変わった後も、固定していた区切りを指し直す（shift 拍だけ前に詰めた時は shift）。
 * 拍の範囲が変わった区切りは固定をやめる
 */
function remapFixed(before: { start: number; len: number }[], after: string[], shift = 0): FixedPart[] {
  const spans = segmentSpans(after);
  return fixedParts.flatMap((f) => {
    const old = before[f.index];
    const index = old ? spans.findIndex((s) => s.start === old.start - shift && s.len === old.len) : -1;
    return index >= 0 ? [{ ...f, index }] : [];
  });
}

/**
 * 「一部を使う」で文節 k を選んだ。先頭の文節なら確定して残りを変換し直し、
 * それ以外なら（区切っていなければ前後に区切りを入れて）固定して全体を変換し直す
 */
function pickPart(k: number) {
  const part = partialCand?.parts[k];
  partialCand = null;
  conv = 'idle';
  if (!part) return;
  const before = segmentSpans(pending);
  if (part.start === 0) {
    rememberCommit(part.text);
    // 先頭から part.len 拍を取り除く（直後の区切りも）
    let n = 0;
    let i = 0;
    while (i < pending.length && n < part.len) if (pending[i++] !== ' ') n++;
    while (pending[i] === ' ') i++;
    const rest = pending.slice(i);
    fixedParts = remapFixed(before, rest, part.len);
    pending = rest;
    setText(text + part.text);
    // もう見せた候補のうち、選んだ文節で始まるものの続きは違うと分かっているので、続きの候補から除く
    const wrongRest = shown.filter((c) => c.startsWith(part.text) && c.length > part.text.length).map((c) => c.slice(part.text.length));
    if (pending.length) void startConversion(false, wrongRest);
    else syncKeymap();
    return;
  }
  const next = withBreaks(pending, [part.start, part.start + part.len]);
  const index = segmentSpans(next).findIndex((s) => s.start === part.start);
  fixedParts = [...remapFixed(before, next).filter((f) => f.index !== index), { index, text: part.text, reading: part.reading }];
  pending = next;
  renderText();
  // 母音は同じなので、もう見せた候補（固定した文節以外が違っていたもの）は除いて、ほかの文節を変えた候補を聞く
  void startConversion(false, shown);
}

/** 候補の文節を ← ↖ ↑ ↗ → に並べた2段目（最大5つ） */
function partialRow(cand: Conv): Row {
  const items = FLOWER_DIRS.map((_, k) => {
    const p = cand.parts[k];
    return p ? ({ kind: 'action', action: 'pickPart', label: p.text, speak: p.text, ref: k } as Item) : null;
  });
  return { id: `jv-part-${convToken}`, label: t('jv.partLabel'), speak: '', items, noIdle: true };
}

function say(msg: string) {
  notice = { text: msg, until: performance.now() + 5000 };
  void feedback.say(msg, true);
}

/** 違うと分かっている候補を AI に伝える数（多すぎると問い合わせが長くなる） */
const MAX_EXCLUDE = 30;

/** 「変換中」の間の2段目（選べるものはない。目を閉じるとやめる） */
const WAIT_ROW: Row = { id: 'jv-wait', label: t('jv.waiting'), speak: '', items: [null, null, null, null, null], noIdle: true };

/**
 * more：今の母音で、まだ見せていない別の候補を聞く。
 * exclude：新しく変換する時に、違うと分かっている候補（「一部を使う」の前に見せた候補など）
 */
async function startConversion(more: boolean, exclude: string[] = []) {
  const vowels = pendingVowels();
  // 何も入れずに目を閉じた時は何もしない（閉じ続けて記号を出す途中でもあるので、案内も出さない）
  if (!vowels.trim()) return;
  const key = loadKey(settings.aiProvider);
  if (!key) {
    say(t('jv.noKey'));
    return;
  }
  const token = ++convToken;
  conv = 'waiting';
  convStartedAt = performance.now();
  notice = null;
  if (!more) shown = exclude.slice(-MAX_EXCLUDE);
  // 変換が始まった：目を閉じたまま待っても記号に切り替えない（記号は入力中の拍が無い時だけ）
  if (!more) engine.holdClose();
  engine.openRow({ ...WAIT_ROW, label: t('jv.waiting') }, performance.now());
  renderKeyboard();
  const model = settings.aiModel.trim() || DEFAULT_MODELS[settings.aiProvider];
  try {
    // 「別の候補」は、外れて聞き直している場面なので、考える深さを1段上げる（速さより当たりを優先）
    const effort = more ? deeper(settings.aiEffort) : settings.aiEffort;
    const generate = providerGenerate(settings.aiProvider, key, model, effort);
    // 文頭は文脈が無く外れやすいので、少なくとも2回聞いて候補を広げる（同時に聞くので待ち時間はほぼ同じ）
    const runs = atSentenceStart(text) ? Math.max(2, settings.aiRuns) : settings.aiRuns;
    const heads = pendingHeads();
    const info: ConvertInfo = { received: 0, rejected: [] };
    const started = performance.now();
    inputLog.add(
      more ? '別の候補' : '変換',
      `［${pendingView()}］ 文脈「${text.slice(-20)}」 ${settings.aiProvider}:${model} 深さ ${effort} ×${runs}` +
        (fixedParts.length ? ` 固定 ${fixedParts.map((f) => `${f.index + 1}:${f.text}`).join('・')}` : '') +
        (shown.length ? ` 除外 ${shown.length}件` : ''),
    );
    let retried = false;
    let cands = await convertPhrase(text, vowels, generate, runs, shown, heads, info, '', fixedParts);
    if (token !== convToken) return;
    if (!cands.length && info.rejected.length) {
      // 返ってきた候補が全部はじかれた：理由を伝えて1回だけ聞き直す。
      // 最初の音の行や固定した文節が違うものは確実に違うので除く。母音が合わないものは表記が正しくて読みだけ違うこともあるので、
      // 除かずに読みを確かめてもらう
      const compactText = (s: string) => s.replace(/[\s　]+/g, '');
      const wrongHead = [...new Set(info.rejected.filter((r) => r.reason === 'constraint').map((r) => compactText(r.text)))];
      const badReading = [...new Set(info.rejected.filter((r) => r.reason === 'vowels').map((r) => `${compactText(r.text)}（${r.reading}）`))];
      const note = badReading.length
        ? `前の答えの次の候補は、読みを規則どおり母音に直すと入力と合いませんでした。拍の数と読み方を確かめてください：${badReading.slice(0, 5).join('、')}`
        : '';
      inputLog.add('聞き直し', `全部はじいたため（AI ${info.received}件）`);
      retried = true;
      cands = await convertPhrase(text, vowels, generate, runs, [...shown, ...wrongHead], heads, info, note, fixedParts);
      if (token !== convToken) return;
    }
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const rejectedEx = [...new Set(info.rejected.map((r) => `${r.text}（${r.reading}）`))].slice(0, 5).join('、');
    inputLog.add(
      cands.length ? '候補' : '候補なし',
      `${secs}秒 ` +
        (cands.length ? cands.map((c, i) => `${i + 1}.${c.text}`).join(' ') : '') +
        `（AI ${info.received}件・はじいた ${info.rejected.length}件${retried ? '・聞き直しあり' : ''}）` +
        (rejectedEx ? ` はじいた例：${rejectedEx}` : ''),
    );
    if (!cands.length) {
      feedback.play('cancel');
      if (more && lastCands.length) {
        // 別の候補が無ければ、前の候補にもどして選べるようにする
        say(t('jv.noMore'));
        conv = 'choosing';
        engine.openRow(candidateRow(lastCands, token), performance.now());
      } else {
        conv = 'idle';
        engine.leaveRow();
        say(t('jv.noCandidates'));
        if (info.rejected.length) {
          // 何がはじかれたかを見せる（読み上げはしない）
          const ex = [...new Set(info.rejected.map((r) => `${r.text}（${r.reading}）`))].slice(0, 3).join('、');
          notice = { text: t('jv.noCandidatesDetail', { n: info.received, ex }), until: performance.now() + 15000 };
        }
      }
      renderKeyboard();
      return;
    }
    shown.push(...cands.map((c) => c.text));
    lastCands = cands;
    conv = 'choosing';
    engine.openRow(candidateRow(cands, token), performance.now());
  } catch (e) {
    if (token !== convToken) return;
    console.error(e);
    inputLog.add('エラー', (e as Error).message);
    conv = 'idle';
    engine.leaveRow();
    feedback.play('cancel');
    say(t('jv.error', { msg: (e as Error).message }));
  }
  renderKeyboard();
}

/** 考える深さを1段上げる（モデルの既定と high はそのまま） */
function deeper(e: AiEffort): AiEffort {
  const next: Partial<Record<AiEffort, AiEffort>> = { minimal: 'low', low: 'medium', medium: 'high' };
  return next[e] ?? e;
}

/** 変換候補を ← ↖ ↑ ↗ → に並べた2段目（1番目の候補が ←） */
function candidateRow(cands: Conv[], token: number): Row {
  const items = FLOWER_DIRS.map((_, i) => (cands[i] ? ({ kind: 'char', ch: cands[i].text } as Item) : null));
  // 文節が2つ以上の候補は、見続けると「一部を使う」（合っている文節だけを選ぶ）
  const longItems = FLOWER_DIRS.map((_, i) =>
    cands[i]?.parts.length > 1
      ? ({ kind: 'action', action: 'partial', label: t('jv.partial'), speak: t('jv.partial'), ref: i } as Item)
      : null,
  );
  return {
    id: `jv-cand-${token}`,
    label: t('jv.candidates'),
    speak: t('jv.candidatesSay', { first: cands[0].text }),
    items,
    longItems,
    noIdle: true,
    // 目を閉じると別の候補、閉じ続けると入力にもどる
    closeItem: { kind: 'action', action: 'more', label: t('jv.more'), speak: t('jv.more') },
  };
}

$('btn-speak').onclick = () => void feedback.say(text || t('say.empty'), true);
$('btn-copy').onclick = () => void navigator.clipboard?.writeText(text);
$('btn-undo').onclick = () => (isVowelMode() ? undoVowel() : undo());
$('btn-clear').onclick = () => setText('');

// ---- キーボード表示 ----
const keyboardEl = $('keyboard');

/**
 * 画面上の並び（3×3）。中央は「見ても何も起きない」ことが伝わるよう空けておき、
 * 目を閉じる（下を見る）操作は、下を見る向きに合わせて3段目の中央に置く。
 * 'close' = 目を閉じる、null = 空き
 */
const GRID: (Dir | 'close' | null)[] = ['UL', 'U', 'UR', 'L', 'C', 'R', null, 'close', null];

function spacer(cls = 'spacer') {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

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
  const key = `${engine.keymap.id}:` + (engine.stage === 'row' ? 'row' : `char:${engine.row?.id}`);
  if (key === renderedStage) return;
  renderedStage = key;
  keyboardEl.innerHTML = '';
  keyboardEl.className = `keyboard stage-${engine.stage}`;

  if (engine.stage === 'row') {
    const km = engine.keymap;
    for (const pos of GRID) {
      if (pos === 'C' && mode === 'sim') {
        keyboardEl.append(stickCell(''));
      } else if (pos === null || pos === 'C') {
        keyboardEl.append(spacer());
      } else if (pos === 'close') {
        const cs = km.closeShort;
        const label = cs.kind === 'row' ? cs.row.label : itemLabel(cs.item);
        const sub = cs.kind === 'row' ? rowSub(cs.row) : cs.item.kind === 'char' ? closeShortName() : '';
        keyboardEl.append(keyEl('close', label, sub, km.closeLong.label, t('key.closeHint')));
      } else {
        const row = km.rowByDir[pos];
        keyboardEl.append(keyEl(pos, row.label, rowSub(row), km.longRowByDir[pos]?.label, DIR_ARROW[pos]));
      }
    }
    return;
  }

  // フラワー配置：左から時計回りに あ・い・う・え・お。中央は行の名前だけ（ボタンではない）
  const row = engine.row!;
  for (const pos of GRID) {
    if (pos === null) {
      keyboardEl.append(spacer());
    } else if (pos === 'C') {
      const name = row.speak.endsWith('行') ? row.speak : row.label;
      if (mode === 'sim') {
        keyboardEl.append(stickCell(name));
      } else if (row.id === WAIT_ROW.id) {
        // 変換中：中央のマスにも回る輪を出す
        const center = spacer('center-label');
        center.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${name}</span>`;
        keyboardEl.append(center);
      } else {
        const center = spacer('center-label');
        center.textContent = name;
        keyboardEl.append(center);
      }
    } else if (pos === 'close') {
      const back = document.createElement('div');
      back.className = 'cell back';
      back.id = 'cell-close';
      // 変換候補では、目を閉じると別の候補、閉じ続けると入力にもどる
      const label = row.closeItem ? itemLabel(row.closeItem) : t('char.back');
      const long = row.closeItem ? `<span class="long">${t('key.long', { label: t('jv.backToInput') })}</span>` : '';
      back.innerHTML = `<span class="hint">${t('key.closeHint')}</span><span class="main small">${label}</span>${long}`;
      keyboardEl.append(back);
    } else {
      const item = row.items[flowerIndex(pos)];
      const cell = document.createElement('div');
      cell.className = item ? 'cell' : 'cell empty';
      cell.id = `cell-${pos}`;
      const label = item ? itemLabel(item) : '';
      // 「゛゜小」「⌫削除」のような長いラベルは小さめに。変換候補はさらに長いことがある
      const len = [...label].length;
      const cls = len > 4 ? 'main small cand' : len > 2 ? 'main small' : 'main';
      // 見続けると切り替わるもの（変換候補の「一部を使う」）
      const longItem = row.longItems?.[flowerIndex(pos)];
      const long = longItem ? `<span class="long">${t('key.long', { label: itemLabel(longItem) })}</span>` : '';
      cell.innerHTML = `<span class="hint">${DIR_ARROW[pos]}</span><span class="${cls}">${label}</span>${long}`;
      keyboardEl.append(cell);
    }
  }
}

function keyEl(pos: Dir | 'close', label: string, sub: string, longLabel: string | undefined, hint: string) {
  const el = document.createElement('div');
  el.className = 'key';
  el.id = `key-${pos}`;
  // 「ABCDE」のような長いラベルは小さめに
  const cls = [...label].length > 2 ? 'main small' : 'main';
  const long = longLabel ? `<span class="long">${t('key.long', { label: longLabel })}</span>` : '';
  el.innerHTML = `<span class="hint">${hint}</span><span class="${cls}">${label}</span>
    <span class="sub">${sub}</span>${long}`;
  return el;
}

/** 1段目で目を閉じた時に入るものの名前（な行／スペース／変換） */
function closeShortName(): string {
  const cs = engine.keymap.closeShort;
  if (cs.kind === 'row') return cs.row.speak;
  return cs.item.kind === 'action' ? cs.item.label : t('key.space');
}

// ---- 仮想スティック ----
// キーボード操作のとき、3×3 の中央（見ても何も起きない位置）に出す。スマホでも試せるように、
// 倒した向きがその方向を見た扱い、下に倒すと目を閉じた扱い、離すと中央（画面に視線を戻す）
const stickEl = document.createElement('div');
stickEl.className = 'stick';
stickEl.innerHTML = '<div class="stick-base"><div class="stick-knob"></div></div><span class="stick-label"></span>';
const stickBase = stickEl.querySelector<HTMLElement>('.stick-base')!;
const stickKnob = stickEl.querySelector<HTMLElement>('.stick-knob')!;
/** スティックで指している向き（触れていなければ null） */
let stickClass: GazeClass | null = null;
/** 向きの角度（右 0°・上 90°）。下は目を閉じる */
const STICK_ANGLES: [number, GazeClass][] = [
  [0, 'R'],
  [45, 'UR'],
  [90, 'U'],
  [135, 'UL'],
  [180, 'L'],
  [270, 'closed'],
  [360, 'R'],
];

function stickMove(e: PointerEvent) {
  const r = stickBase.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2;
  const dist = Math.hypot(dx, dy);
  if (dist > max) {
    dx *= max / dist;
    dy *= max / dist;
  }
  stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  if (dist < max * 0.35) {
    stickClass = 'C';
  } else {
    let deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    stickClass = STICK_ANGLES.reduce((best, cur) => (Math.abs(deg - cur[0]) < Math.abs(deg - best[0]) ? cur : best))[1];
  }
  stickEl.classList.toggle('active', stickClass !== 'C');
}

function stickRelease() {
  stickClass = null;
  stickKnob.style.transform = '';
  stickEl.classList.remove('active', 'dragging');
}

stickEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  feedback.unlock();
  stickEl.setPointerCapture(e.pointerId);
  stickEl.classList.add('dragging');
  stickMove(e);
});
stickEl.addEventListener('pointermove', (e) => {
  if (stickEl.hasPointerCapture(e.pointerId)) stickMove(e);
});
stickEl.addEventListener('pointerup', stickRelease);
stickEl.addEventListener('pointercancel', stickRelease);

/** 中央のマスにスティックを置く（2段目では行の名前も小さく出す） */
function stickCell(label: string): HTMLElement {
  stickEl.querySelector('.stick-label')!.textContent = label;
  return stickEl;
}

// ---- 視線インジケータ ----（キーボードと同じ3×3の並び）
const gazeEl = $('gaze');
const gazeCells = {} as Record<GazeClass, HTMLElement>;
for (const pos of GRID) {
  const c = document.createElement('div');
  if (pos === null) {
    c.className = 'spacer';
  } else {
    const cls: GazeClass = pos === 'close' ? 'closed' : pos;
    c.textContent = cls === 'closed' ? '◡' : DIR_ARROW[cls];
    gazeCells[cls] = c;
  }
  gazeEl.append(c);
}

// ---- 毎フレームの描画 ----
const statusMain = $('status-main');
const statusSub = $('status-sub');
const meterFill = $('meter-fill');
const meterLong = $('meter-long');

function updateView(now: number) {
  // ハイライト
  keyboardEl.querySelectorAll('.hover, .candidate').forEach((el) => el.classList.remove('hover', 'candidate'));
  const cand = engine.candidate;
  keyboardEl.querySelectorAll('.long-active').forEach((el) => el.classList.remove('long-active'));
  if (engine.stage === 'row') {
    const keyId = `key-${engine.dir}`;
    if (cand?.kind === 'row') {
      $(keyId)?.classList.add('candidate');
      if (cand.long) $(keyId)?.classList.add('long-active');
    } else if (engine.closedStart !== null) $('key-close')?.classList.add('hover');
    else if (engine.dir !== 'C') $(keyId)?.classList.add('hover');
  } else {
    if (cand?.kind === 'item') {
      $(`cell-${cand.dir}`)?.classList.add('candidate');
      if (cand.long) $(`cell-${cand.dir}`)?.classList.add('long-active');
    }
    else if (engine.closedStart !== null) $('cell-close')?.classList.add('hover');
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
    const dur = now - engine.closedStart;
    if (engine.stage === 'row' || engine.closeCanSwitch || engine.row?.closeItem) {
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
  if (mode === 'camera' && tracker.active && now - tracker.lastFrameAt > 2000) {
    main = t('st.trackerStopped');
    sub = trackerDiagnostics();
  } else if (mode === 'camera' && !lastFrame?.faceFound) {
    main = t('st.noFace');
    sub = t('st.noFaceSub');
  } else if (engine.closedStart !== null) {
    main = t('st.closed');
    const longName = engine.keymap.closeLong.label;
    if (!engine.closeDone) {
      if (engine.stage === 'row') sub = t('st.keepClosedFor', { name: closeShortName() });
      else sub = engine.row?.closeItem ? t('jv.keepClosedMore') : t('st.keepClosedBack');
    } else if (engine.closeAction === 'back') sub = t('st.wentBack');
    else if (engine.closeAction === 'rowItem' && engine.closeCanSwitch) {
      sub = t('st.selectedCanSwitch', { name: t('jv.more'), long: t('jv.backToInput') });
    } else if (engine.closeAction === 'rowItem') sub = t('st.wentBack');
    else if (engine.closeCanSwitch) sub = t('st.selectedCanSwitch', { name: closeShortName(), long: longName });
    else sub = t('st.selectedOpen', { name: engine.row?.label ?? '' });
  } else if (engine.stage === 'row') {
    if (cand?.kind === 'row') {
      main = `${cand.row.label}`;
      const longRow = engine.keymap.longRowByDir[engine.dir as SideDir];
      sub = t('st.confirm') + (cand.long || !longRow ? '' : t('st.keepLooking', { name: longRow.label }));
    } else if (notice && now < notice.until) {
      main = notice.text;
      sub = isVowelMode() ? t('jv.chooseVowelSub') : '';
    } else if (isVowelMode()) {
      const v = pendingView();
      if (engine.keymap.id === HEAD_KEYMAP.id) {
        main = v ? t('jv.pending', { v }) : t('jv.chooseHead');
        sub = t('jv.chooseHeadSub');
      } else {
        main = v ? t('jv.pending', { v }) : t('jv.chooseVowel');
        sub = t('jv.chooseVowelSub');
      }
    } else {
      main = t('st.chooseRow');
      sub = t('st.chooseRowSub', { name: closeShortName() });
    }
  } else if (conv === 'waiting') {
    main = t('jv.waitingSecs', { s: Math.floor((now - convStartedAt) / 1000) });
    sub = t('jv.waitingSub');
  } else if (conv === 'partial' && cand?.kind !== 'item') {
    main = t('jv.choosePart');
    sub = t('jv.choosePartSub');
  } else if (conv === 'choosing' && cand?.kind !== 'item') {
    main = t('jv.choose');
    sub = t('jv.chooseSub');
  } else {
    const row = engine.row!;
    if (cand?.kind === 'item') {
      main = `「${itemLabel(cand.item)}」`;
      sub = t('st.confirm');
    } else {
      main = t('st.chooseItem', { row: row.label });
      sub = t('st.chooseItemSub');
    }
  }
  statusMain.textContent = main;
  statusSub.textContent = sub;
  // 変換中は回る輪を出す（止まっていると思われないように）
  statusMain.classList.toggle('busy', conv === 'waiting');

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
  const now = performance.now();
  if (mode === 'sim' && !calRun) {
    const cls = simClass();
    closedNow = cls === 'closed';
    if (cls !== 'closed') lastOpenDir = cls;
    lastRaw = { cls, distances: {} };
    engine.update({ t: now, faceFound: true, dir: lastOpenDir, closed: closedNow });
  }
  updateView(now);
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
  if (stickClass) return stickClass;
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
  setModeBadge();
}

function setModeBadge() {
  const badge = $('mode-badge');
  badge.hidden = mode === 'none';
  badge.textContent = t(mode === 'sim' ? 'mode.sim' : calibration ? 'mode.camera' : 'mode.cameraUncal');
}

async function startCamera(): Promise<boolean> {
  feedback.unlock();
  if (tracker.active) return true;
  const err = $('start-error');
  try {
    await tracker.start((step) => {
      err.textContent = '';
      if (step === 'ready') return;
      const msg = t(step === 'camera' ? 'cam.starting' : 'cam.loadingModel');
      statusMain.textContent = msg;
      $('btn-start-camera').textContent = msg;
    });
    return true;
  } catch (e) {
    console.error(e);
    err.textContent = t('cam.failed', { msg: (e as Error).message });
    $('start').hidden = false;
    $('btn-start-camera').textContent = t('start.camera');
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
/** 画面の文言を今の言語に揃える */
function applyTexts() {
  document.documentElement.lang = settings.lang;
  applyStaticTexts();
  $('btn-lang').textContent = t(isVowelMode() ? 'nav.langVowel' : 'nav.lang');
  gazeCells.closed.title = t('gaze.closed');
  renderKeyboard();
  if (mode !== 'none') setModeBadge();
  if ($<HTMLDialogElement>('settings').open) renderSettings();
}

/** 言語・入力方式を切り替える。入力途中の母音や変換は捨てる */
function switchInput(lang: Settings['lang'], jaInput: JaInput) {
  settings.lang = lang;
  settings.jaInput = jaInput;
  saveSettings(settings);
  setLang(settings.lang);
  pending = [];
  conv = 'idle';
  convToken++;
  notice = null;
  renderText();
  engine.setKeymap(isVowelMode() && headWanted() ? HEAD_KEYMAP : keymapFor(settings.lang, settings.jaInput), performance.now());
  applyTexts();
  feedback.unlock();
  void feedback.say(t(isVowelMode() ? 'lang.nameVowel' : 'lang.name'));
}

// 上のメニューは 日本語（12キー）→ 日本語（母音入力）→ English → … の順に切り替える
$('btn-lang').onclick = (e) => {
  // キーボード操作（Space など）でボタンが押されないよう、フォーカスを外す
  (e.currentTarget as HTMLElement).blur();
  if (settings.lang === 'en') switchInput('ja', 'kana');
  else if (settings.jaInput === 'kana') switchInput('ja', 'vowel');
  else switchInput('en', settings.jaInput);
};
// 開始画面のボタンは言語だけを切り替える
$('btn-start-lang').onclick = (e) => {
  (e.currentTarget as HTMLElement).blur();
  switchInput(settings.lang === 'ja' ? 'en' : 'ja', settings.jaInput);
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
    // スマホでは最初の数秒、顔認識の準備（GPU の初期化など）でフレームが来ないことがある
    $('calib-arrow').textContent = '⏳';
    $('calib-text').textContent = t('cal.preparing');
    $('calib-count').textContent = '';
    const ready = await waitForFrames(10, 15000);
    if (!ready) throw new Error(t('cal.notStarted'));
    calibration = await calRun.run();
    saveCalibration(calibration);
    const weak = ALL_CLASSES.filter((c) => calibration!.quality[c] < 0.8);
    if (weak.length) {
      alert(t('cal.weak', { list: weak.map(className).join(settings.lang === 'en' ? ', ' : '、') }));
    }
  } catch (e) {
    if (!(e instanceof CalibrationAborted)) alert(`${(e as Error).message}\n\n${trackerDiagnostics()}`);
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
    `${t('diag.delegate')}: ${tracker.delegate}`,
    `${t('diag.frames')}: ${tracker.frames}`,
    `${t('diag.video')}: ${v.videoWidth}×${v.videoHeight}`,
    `${t('diag.error')}: ${tracker.lastError ?? t('diag.none')}`,
    ...(tracker.badFrames ? [`${t('diag.bad')}: ${tracker.badFrames} (${tracker.lastBad})`] : []),
  ].join(' / ');
}

function showCalProgress(p: CalProgress) {
  $('calib-arrow').textContent = p.step === 'closed' ? '😌' : p.step === 'down' ? '↓' : DIR_ARROW[p.step];
  $('calib-text').textContent = stepInstruction(p.step);
  $('calib-fill').style.width = `${p.phase === 'record' ? p.progress * 100 : 0}%`;
  $('calib-count').textContent = `${p.index + 1} / ${p.total}` + (p.phase === 'record' ? t('cal.recording') : '');
  calibEl.dataset.step = p.step;
}

$('btn-calibrate').onclick = () => void runCalibration();
$('btn-calib-cancel').onclick = () => calRun?.abort();

// ---- 設定 ----
// label は i18n の 'set.<key>'
const FIELDS: { key: keyof Settings; step?: number; min?: number; max?: number }[] = [
  { key: 'selectMs', step: 50, min: 100 },
  { key: 'longMs', step: 100, min: 500 },
  { key: 'closeMinMs', step: 50, min: 200 },
  { key: 'idleMs', step: 500, min: 1000 },
  { key: 'debounceMs', step: 10, min: 0 },
  { key: 'smoothing', step: 0.05, min: 0.05, max: 1 },
  { key: 'hysteresis', step: 0.05, min: 0.3, max: 1 },
  { key: 'centerBias', step: 0.05, min: 0.2, max: 3 },
  { key: 'closedBias', step: 0.05, min: 0.1, max: 3 },
  { key: 'ttsRate', step: 0.1, min: 0.5, max: 3 },
  { key: 'tts' },
  { key: 'sound' },
  { key: 'inputLog' },
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
      inputLog.enabled = settings.inputLog;
      saveSettings(settings);
    };
    label.append(t(`set.${f.key}` as TextKey), input);
    box.append(label);
  }
  renderAiSettings(box);
  renderLogSettings(box);
}

/** 入力ログのコピーと削除 */
function renderLogSettings(box: HTMLElement) {
  const head = document.createElement('h3');
  head.textContent = t('set.logSection', { n: inputLog.size });
  const row = document.createElement('div');
  row.className = 'card-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = t('log.copy');
  copy.onclick = () => void copyInputLog();
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = t('log.clear');
  clear.onclick = () => {
    if (!confirm(t('log.confirmClear'))) return;
    inputLog.clear();
    renderSettings();
  };
  row.append(copy, clear);
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = t('log.note');
  box.append(head, row, note);
}

/** 入力ログを、設定の要約を付けてコピーする */
async function copyInputLog() {
  const header = [
    '# EyeBoard 入力ログ',
    `入力方式: ${settings.lang === 'en' ? 'English' : settings.jaInput === 'vowel' ? '日本語・母音入力' : '日本語・12キー'}`,
    `母音入力の AI: ${settings.aiProvider} ${settings.aiModel} 深さ ${settings.aiEffort} ×${settings.aiRuns} 最初の1文字 ${settings.aiHead}`,
    `時間: 候補 ${settings.selectMs}ms・長く ${settings.longMs}ms・閉じる ${settings.closeMinMs}ms`,
    `端末: ${navigator.userAgent}`,
  ];
  const textOut = inputLog.text(header);
  try {
    await navigator.clipboard.writeText(textOut);
    alert(t('log.copied', { n: inputLog.size }));
  } catch {
    prompt(t('copy.manual'), textOut);
  }
}

/** 母音入力（AI 変換）の設定。API キーは設定とは別に、このブラウザだけに保存する */
function renderAiSettings(box: HTMLElement) {
  const head = document.createElement('h3');
  head.textContent = t('set.aiSection');
  box.append(head);

  const field = (labelKey: TextKey, control: HTMLElement) => {
    const label = document.createElement('label');
    label.append(t(labelKey), control);
    box.append(label);
  };
  const select = (options: [string, string][], value: string, onChange: (v: string) => void) => {
    const el = document.createElement('select');
    for (const [v, text] of options) el.append(new Option(text, v));
    el.value = value;
    el.onchange = () => onChange(el.value);
    return el;
  };

  field(
    'set.jaInput',
    select(
      [
        ['kana', t('set.jaInput.kana')],
        ['vowel', t('set.jaInput.vowel')],
      ],
      settings.jaInput,
      (v) => switchInput(settings.lang, v as JaInput),
    ),
  );
  field(
    'set.aiProvider',
    select(
      (Object.keys(PROVIDER_LABELS) as AiProvider[]).map((p) => [p, PROVIDER_LABELS[p]]),
      settings.aiProvider,
      (v) => {
        settings.aiProvider = v as AiProvider;
        settings.aiModel = DEFAULT_MODELS[settings.aiProvider];
        saveSettings(settings);
        renderSettings();
      },
    ),
  );

  const model = document.createElement('input');
  model.value = settings.aiModel;
  model.placeholder = DEFAULT_MODELS[settings.aiProvider];
  model.spellcheck = false;
  model.onchange = () => {
    settings.aiModel = model.value.trim() || DEFAULT_MODELS[settings.aiProvider];
    saveSettings(settings);
  };
  field('set.aiModel', model);

  const key = document.createElement('input');
  key.type = 'password';
  key.autocomplete = 'off';
  key.spellcheck = false;
  key.value = loadKey(settings.aiProvider);
  key.onchange = () => saveKey(settings.aiProvider, key.value.trim());
  field('set.aiKey', key);
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = t('set.aiKeyNote');
  box.append(note);

  field(
    'set.aiEffort',
    select(
      (['default', 'minimal', 'low', 'medium', 'high'] as AiEffort[]).map((e) => [e, e === 'default' ? t('set.aiEffort.default') : e]),
      settings.aiEffort,
      (v) => {
        settings.aiEffort = v as AiEffort;
        saveSettings(settings);
      },
    ),
  );
  field(
    'set.aiHead',
    select(
      [
        ['start', t('set.aiHead.start')],
        ['all', t('set.aiHead.all')],
        ['off', t('set.aiHead.off')],
      ],
      settings.aiHead,
      (v) => {
        settings.aiHead = v as Settings['aiHead'];
        saveSettings(settings);
        syncKeymap();
      },
    ),
  );
  field(
    'set.aiRuns',
    select(
      ['1', '2', '3'].map((n) => [n, n]),
      String(settings.aiRuns),
      (v) => {
        settings.aiRuns = Number(v);
        saveSettings(settings);
      },
    ),
  );
}

$('btn-settings').onclick = () => {
  renderSettings();
  $<HTMLDialogElement>('settings').showModal();
};
$('btn-reset-settings').onclick = () => {
  // 言語と入力方式は既定値に戻さない
  Object.assign(settings, DEFAULT_SETTINGS, { lang: settings.lang, jaInput: settings.jaInput });
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
$('btn-copy-log').onclick = () => void copyInputLog();

$('btn-copy-cal').onclick = async () => {
  if (!calibration) {
    alert(t('copy.noCal'));
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
    alert(t('copy.done'));
  } catch {
    prompt(t('copy.manual'), textOut);
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
    `mode       ${mode}${calibration ? '' : t('dbg.uncal')}`,
    `${t('dbg.tracker').padEnd(10)} ${trackerDiagnostics()}`,
    `face       ${f?.faceFound ?? '-'}`,
    `bs  x,y    ${f ? fmt(f.feature[0]) + fmt(f.feature[1]) : '-'}`,
    `iris x,y   ${f ? fmt(f.feature[2]) + fmt(f.feature[3]) : '-'}`,
    `blink,open ${f ? fmt(f.feature[F_BLINK]) + fmt(f.feature[5]) : '-'}`,
    `${t('dbg.class').padEnd(10)} ${lastRaw ? className(lastRaw.cls) : '-'} / ${t('dbg.stable')} ${dirName(engine.dir)}`,
    `stage      ${engine.stage}${engine.row ? ' ' + engine.row.label : ''}`,
    '',
    t('dbg.header'),
    ...ALL_CLASSES.map(
      (c) =>
        `${className(c).padEnd(3, '　')} ${dist[c] !== undefined ? dist[c]!.toFixed(1).padStart(6) : '     -'}` +
        `   ${calibration ? Math.round(calibration.quality[c] * 100) + '%' : '-'}`,
    ),
  ].join('\n');
}

// ---- 起動 ----
applyTexts();
syncKeymap();
requestAnimationFrame(frameLoop);
