import type { Dir, Item, Row, Slot } from './types';

const c = (ch: string, speak?: string): Item => ({ kind: 'char', ch, speak });

function kanaRow(id: string, chars: string): Row {
  const [C, L, U, R, D] = [...chars];
  return {
    id,
    label: C,
    speak: `${C}行`,
    slots: { C: c(C), L: c(L), U: c(U), R: c(R), D: c(D) },
  };
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
    slots: { C: c('や'), L: c('（', 'かっこ'), U: c('ゆ'), R: c('）', 'かっことじ'), D: c('よ') },
  },
  ra: kanaRow('ra', 'らりるれろ'),
  wa: {
    id: 'wa',
    label: 'わ',
    speak: 'わ行',
    slots: { C: c('わ'), L: c('を'), U: c('ん'), R: c('ー', 'のばしぼう') },
  },
  mod: {
    id: 'mod',
    label: '゛゜小',
    speak: '濁点',
    slots: {
      C: { kind: 'action', action: 'cycle', label: '゛゜小', speak: '切り替え' },
      L: { kind: 'action', action: 'small', label: '小', speak: '小文字' },
      U: { kind: 'action', action: 'dakuten', label: '゛', speak: '濁点' },
      R: { kind: 'action', action: 'handakuten', label: '゜', speak: '半濁点' },
    },
  },
  punct: {
    id: 'punct',
    label: '、。?!',
    speak: '句読点',
    slots: {
      C: c('、', 'てん'),
      L: c('。', 'まる'),
      U: c('？', 'はてな'),
      R: c('！', 'びっくり'),
    },
  },
  edit: {
    id: 'edit',
    label: '編集',
    speak: '編集',
    slots: {
      C: { kind: 'action', action: 'backspace', label: '⌫削除', speak: '削除' },
      L: { kind: 'action', action: 'clear', label: '全消去', speak: '全消去' },
      U: { kind: 'action', action: 'speak', label: '🔊読上', speak: '読み上げ' },
      R: { kind: 'action', action: 'space', label: '空白', speak: '空白' },
      D: { kind: 'action', action: 'newline', label: '改行', speak: '改行' },
    },
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

export function dirToSlot(dir: Dir): Slot | null {
  switch (dir) {
    case 'C':
    case 'L':
    case 'U':
    case 'R':
    case 'D':
      return dir;
    default:
      return null;
  }
}

export function itemLabel(item: Item): string {
  return item.kind === 'char' ? item.ch : item.label;
}

export function itemSpeech(item: Item): string {
  return item.kind === 'char' ? (item.speak ?? item.ch) : item.speak;
}
