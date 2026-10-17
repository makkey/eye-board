import { FLOWER_DIRS } from './types';
import type { Dir, Item, JaInput, Keymap, Lang, Row } from './types';

const c = (ch: string, speak?: string, label?: string): Item => ({ kind: 'char', ch, speak, label });
const a = (action: Extract<Item, { kind: 'action' }>['action'], label: string, speak: string): Item => ({
  kind: 'action',
  action,
  label,
  speak,
});

// 2段目の items は ← ↖ ↑ ↗ → の順（FLOWER_DIRS）。空きは null

// ---- 日本語 ----

function kanaRow(id: string, chars: string): Row {
  const items = [...chars].map((ch) => c(ch));
  return { id, label: chars[0], speak: `${chars[0]}行`, items };
}

const JA: Record<string, Row> = {
  a: kanaRow('a', 'あいうえお'),
  ka: kanaRow('ka', 'かきくけこ'),
  sa: kanaRow('sa', 'さしすせそ'),
  ta: kanaRow('ta', 'たちつてと'),
  na: kanaRow('na', 'なにぬねの'),
  ha: kanaRow('ha', 'はひふへほ'),
  ma: kanaRow('ma', 'まみむめも'),
  ya: {
    id: 'ya',
    label: 'や',
    speak: 'や行',
    items: [c('や'), c('（', 'かっこ'), c('ゆ'), c('）', 'かっことじ'), c('よ')],
  },
  ra: kanaRow('ra', 'らりるれろ'),
  wa: {
    id: 'wa',
    label: 'わ',
    speak: 'わ行',
    items: [c('わ'), c('を'), c('ん'), c('ー', 'のばしぼう'), null],
  },
  kigo: {
    id: 'kigo',
    label: '記号',
    speak: '記号',
    items: [
      c('、', 'てん'),
      c('。', 'まる'),
      a('cycle', '゛゜小', '濁点'),
      c('？', 'はてな'),
      c('！', 'びっくり'),
    ],
  },
  edit: {
    id: 'edit',
    label: '編集',
    speak: '編集',
    items: [
      a('backspace', '⌫削除', '削除'),
      a('space', '空白', '空白'),
      a('speak', '🔊読上', '読み上げ'),
      a('undo', '↶戻す', '元に戻す'),
      a('clear', '全消去', '全消去'),
    ],
  },
};

export const JA_KEYMAP: Keymap = {
  id: 'ja',
  lang: 'ja',
  rowByDir: { UL: JA.a, U: JA.ka, UR: JA.sa, L: JA.ta, R: JA.ha },
  // 編集は ←（「← を2秒、続けて ←」で削除）
  longRowByDir: { UL: JA.ma, U: JA.ya, UR: JA.ra, L: JA.edit, R: JA.wa },
  closeShort: { kind: 'row', row: JA.na },
  closeLong: JA.kigo,
};

// ---- 英語 ----
// 5文字ずつアルファベット順。短い操作だけで a〜y に届き、スペースは目を閉じるだけで入る。
// 26文字目の z は最も使われないので、目を閉じ続けた時の記号の行に置く。

function letterRow(letters: string): Row {
  const first = letters[0].toUpperCase();
  const last = letters[letters.length - 1].toUpperCase();
  return {
    id: `en-${letters}`,
    label: letters.toUpperCase(),
    speak: `${first} to ${last}`,
    items: [...letters].map((ch) => c(ch, ch.toUpperCase(), ch.toUpperCase())),
  };
}

function symbolRow(id: string, label: string, speak: string, items: [string, string][]): Row {
  return { id, label, speak, items: items.map(([ch, name]) => c(ch, name)) };
}

const EN: Record<string, Row> = {
  ae: letterRow('abcde'),
  fj: letterRow('fghij'),
  ko: letterRow('klmno'),
  pt: letterRow('pqrst'),
  uy: letterRow('uvwxy'),
  num1: symbolRow('en-num1', '1-5', 'one to five', [
    ['1', 'one'],
    ['2', 'two'],
    ['3', 'three'],
    ['4', 'four'],
    ['5', 'five'],
  ]),
  num2: symbolRow('en-num2', '6-0', 'six to zero', [
    ['6', 'six'],
    ['7', 'seven'],
    ['8', 'eight'],
    ['9', 'nine'],
    ['0', 'zero'],
  ]),
  punct: symbolRow('en-punct', '!-:;"', 'punctuation', [
    ['!', 'exclamation'],
    ['-', 'hyphen'],
    [':', 'colon'],
    [';', 'semicolon'],
    ['"', 'quote'],
  ]),
  brackets: symbolRow('en-brackets', '()/@&', 'brackets', [
    ['(', 'open paren'],
    [')', 'close paren'],
    ['/', 'slash'],
    ['@', 'at'],
    ['&', 'and'],
  ]),
  symbols: {
    id: 'en-symbols',
    label: ".,?'Z",
    speak: 'symbols',
    items: [c('.', 'period'), c(',', 'comma'), c('?', 'question'), c("'", 'apostrophe'), c('z', 'Z', 'Z')],
  },
  edit: {
    id: 'en-edit',
    label: 'Edit',
    speak: 'edit',
    items: [
      a('backspace', '⌫Del', 'delete'),
      a('case', 'Aa', 'case'),
      a('speak', '🔊Speak', 'speak'),
      a('undo', '↶Undo', 'undo'),
      a('clear', 'Clear', 'clear'),
    ],
  },
};

export const EN_KEYMAP: Keymap = {
  id: 'en',
  lang: 'en',
  rowByDir: { UL: EN.ae, U: EN.fj, UR: EN.ko, L: EN.pt, R: EN.uy },
  // Edit は ←（「← を2秒、続けて ←」で Backspace）
  longRowByDir: { UL: EN.num1, U: EN.num2, UR: EN.punct, L: EN.edit, R: EN.brackets },
  closeShort: { kind: 'item', item: c(' ', 'space', '␣') },
  closeLong: EN.symbols,
};

// ---- 日本語・母音入力 ----
// 各拍の母音だけを入れ、文節ごとに AI が漢字かな交じりに変換する。
// 母音は12キーの2段目と同じフラワー配置（← あ ↖ い ↑ う ↗ え → お）で、1回見るだけで入る。
// っ は次の拍の母音、ー は前の拍の母音で入れる（キーが要らない）。

function vowelRow(v: string): Row {
  return { id: `jv-${v}`, label: v, speak: v, items: [], direct: c(v) };
}

const JV: Record<string, Row> = {
  n: vowelRow('ん'),
  // 文節の区切り：未確定のまま次の文節を入れ、まとめて変換する
  sep: { id: 'jv-sep', label: '区切り', speak: '区切り', items: [], direct: c(' ', '区切り', '区切り') },
  kigo: {
    id: 'jv-kigo',
    label: '記号',
    speak: '記号',
    items: [c('、', 'てん'), c('。', 'まる'), c('？', 'はてな'), c('！', 'びっくり'), a('newline', '改行', '改行')],
  },
};

export const VOWEL_KEYMAP: Keymap = {
  id: 'jv',
  lang: 'ja',
  rowByDir: { L: vowelRow('あ'), UL: vowelRow('い'), U: vowelRow('う'), UR: vowelRow('え'), R: vowelRow('お') },
  // 編集は12キーと同じく ←（「← を2秒、続けて ←」で1拍削除）。ん は ↖、文節の区切りは → を2秒
  longRowByDir: { L: JA.edit, UL: JV.n, R: JV.sep },
  closeShort: { kind: 'item', item: a('convert', '変換', '変換') },
  closeLong: JV.kigo,
};

export const KEYMAPS: Record<Lang, Keymap> = { ja: JA_KEYMAP, en: EN_KEYMAP };

export function keymapFor(lang: Lang, jaInput: JaInput): Keymap {
  return lang === 'ja' && jaInput === 'vowel' ? VOWEL_KEYMAP : KEYMAPS[lang];
}

/** 2段目：方向 → その行の何番目の項目か（中央は -1） */
export function flowerIndex(dir: Dir): number {
  return FLOWER_DIRS.indexOf(dir);
}

export function itemLabel(item: Item): string {
  return item.kind === 'char' ? (item.label ?? item.ch) : item.label;
}

export function itemSpeech(item: Item): string {
  return item.kind === 'char' ? (item.speak ?? item.ch) : item.speak;
}
