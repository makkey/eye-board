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

/** 1段目：視線方向 → 行（中央は「目を閉じる／下を見る」） */
export const ROW_BY_DIR: Record<Dir, string> = {
  UL: 'a',
  U: 'ka',
  UR: 'sa',
  L: 'ta',
  C: 'na',
  R: 'ha',
};

/** 1段目：longMs 見続けた時（中央は目を閉じ続けた時）に切り替わる行 */
export const LONG_ROW_BY_DIR: Record<Dir, string> = {
  UL: 'ma',
  U: 'ya',
  UR: 'ra',
  L: 'wa',
  C: 'kigo',
  R: 'edit',
};

/** 2段目：方向 → その行の何番目の項目か（中央は -1） */
export function flowerIndex(dir: Dir): number {
  return FLOWER_DIRS.indexOf(dir);
}

export function itemLabel(item: Item): string {
  return item.kind === 'char' ? item.ch : item.label;
}

export function itemSpeech(item: Item): string {
  return item.kind === 'char' ? (item.speak ?? item.ch) : item.speak;
}
