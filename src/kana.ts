import type { Item } from './types';

// 清音 → 各変化形
const DAKUTEN: Record<string, string> = {};
const HANDAKUTEN: Record<string, string> = {};
const SMALL: Record<string, string> = {};

function pairs(table: Record<string, string>, from: string, to: string) {
  [...from].forEach((ch, i) => (table[ch] = [...to][i]));
}
pairs(DAKUTEN, 'かきくけこさしすせそたちつてとはひふへほう', 'がぎぐげござじずぜぞだぢづでどばびぶべぼゔ');
pairs(HANDAKUTEN, 'はひふへほ', 'ぱぴぷぺぽ');
pairs(SMALL, 'あいうえおつやゆよわ', 'ぁぃぅぇぉっゃゅょゎ');

/** 変化形 → 清音 */
const BASE: Record<string, string> = {};
for (const table of [DAKUTEN, HANDAKUTEN, SMALL]) {
  for (const [base, variant] of Object.entries(table)) BASE[variant] = base;
}

export function baseOf(ch: string): string {
  return BASE[ch] ?? ch;
}

/** 基底文字からの変化サイクル（タップ時の ゛゜小 キーと同じ順） */
export function variantsOf(ch: string): string[] {
  const base = baseOf(ch);
  const list = [base];
  if (DAKUTEN[base]) list.push(DAKUTEN[base]);
  if (HANDAKUTEN[base]) list.push(HANDAKUTEN[base]);
  if (SMALL[base]) list.push(SMALL[base]);
  return list;
}

function toggle(ch: string, table: Record<string, string>): string {
  const base = baseOf(ch);
  const target = table[base];
  if (!target) return ch;
  return ch === target ? base : target;
}

function cycle(ch: string): string {
  const list = variantsOf(ch);
  if (list.length < 2) return ch;
  const i = list.indexOf(ch);
  return list[(i + 1) % list.length];
}

function replaceLast(text: string, fn: (ch: string) => string): string {
  const chars = [...text];
  if (chars.length === 0) return text;
  chars[chars.length - 1] = fn(chars[chars.length - 1]);
  return chars.join('');
}

/**
 * アイテムをテキストに適用する。
 * 'speak' と 'undo' は履歴や音声が要るので呼び出し側で扱い、ここではテキストを変えない。
 */
export function applyItem(text: string, item: Item): string {
  if (item.kind === 'char') return text + item.ch;
  switch (item.action) {
    case 'cycle':
      return replaceLast(text, cycle);
    case 'case':
      return replaceLast(text, (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()));
    case 'dakuten':
      return replaceLast(text, (ch) => toggle(ch, DAKUTEN));
    case 'handakuten':
      return replaceLast(text, (ch) => toggle(ch, HANDAKUTEN));
    case 'small':
      return replaceLast(text, (ch) => toggle(ch, SMALL));
    case 'backspace':
      return [...text].slice(0, -1).join('');
    case 'space':
      return text + '　';
    case 'newline':
      return text + '\n';
    case 'clear':
      return '';
    case 'undo':
    case 'speak':
    case 'convert': // 母音入力の変換は呼び出し側で扱う
    case 'more':
    case 'partial':
    case 'pickPart':
      return text;
  }
}
