import { FLOWER_DIRS } from './types';
import type { Dir, Item, Row } from './types';

const c = (ch: string, speak?: string): Item => ({ kind: 'char', ch, speak });
const a = (action: Extract<Item, { kind: 'action' }>['action'], label: string, speak: string): Item => ({
  kind: 'action',
  action,
  label,
  speak,
});

function kanaRow(id: string, chars: string): Row {
  const items = [...chars].map((ch) => c(ch));
  return { id, label: chars[0], speak: `${chars[0]}行`, items };
}

export const ROWS: Record<string, Row> = {
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
  mod: {
    id: 'mod',
    label: '゛゜小',
    speak: '濁点',
    items: [
      a('cycle', '゛゜小', '切り替え'),
      a('small', '小', '小文字'),
      a('dakuten', '゛', '濁点'),
      a('handakuten', '゜', '半濁点'),
      null,
    ],
  },
  punct: {
    id: 'punct',
    label: '、。?!',
    speak: '句読点',
    items: [c('、', 'てん'), c('。', 'まる'), c('？', 'はてな'), c('！', 'びっくり'), null],
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

/** 1段目：視線方向 → 行（中央は「目を閉じる」で選ぶ） */
export const ROW_BY_DIR: Record<Dir, string> = {
  UL: 'a',
  U: 'ka',
  UR: 'sa',
  L: 'ta',
  C: 'na',
  R: 'ha',
  DL: 'ma',
  D: 'ya',
  DR: 'ra',
};

/** 1段目：長く見続けた時に切り替わる行 */
export const LONG_ROW_BY_DIR: Partial<Record<Dir, string>> = {
  U: 'edit',
  DL: 'mod',
  D: 'wa',
  DR: 'punct',
};

/** 2段目：方向 → その行の何番目の項目か（フラワー配置以外は -1） */
export function flowerIndex(dir: Dir): number {
  return FLOWER_DIRS.indexOf(dir);
}

export function itemLabel(item: Item): string {
  return item.kind === 'char' ? item.ch : item.label;
}

export function itemSpeech(item: Item): string {
  return item.kind === 'char' ? (item.speak ?? item.ch) : item.speak;
}
