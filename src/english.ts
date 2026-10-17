import { applyItem } from './kana';
import type { Item } from './types';

/** 文頭（空、または . ? ! の後に空白、または改行の直後）か */
function atSentenceStart(text: string): boolean {
  return /(^|[.?!]\s+|\n)$/.test(text);
}

/**
 * 英語用：アイテムを適用し、大文字を自動で整える。
 * - 文頭の英字は大文字
 * - 単独の「i」は、次に英字以外が来た時点で「I」にする
 */
export function applyEnglish(text: string, item: Item): string {
  if (item.kind === 'char') {
    const isLetter = /^[a-z]$/i.test(item.ch);
    if (isLetter) {
      const ch = atSentenceStart(text) ? item.ch.toUpperCase() : item.ch;
      return text + ch;
    }
    return text.replace(/(^|[\s"(])i$/, '$1I') + item.ch;
  }
  return applyItem(text, item);
}
