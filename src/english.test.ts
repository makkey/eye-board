import { describe, expect, it } from 'vitest';
import { applyEnglish } from './english';
import type { Item } from './types';

const ch = (c: string): Item => ({ kind: 'char', ch: c });
const type = (s: string) => [...s].reduce((text, c) => applyEnglish(text, ch(c)), '');

describe('applyEnglish', () => {
  it('文頭を大文字にする', () => {
    expect(type('hello world. how are you? fine')).toBe('Hello world. How are you? Fine');
  });

  it('単独の i を I にする', () => {
    expect(type('yes i am. it is')).toBe('Yes I am. It is');
    expect(type('i')).toBe('I');
  });

  it('i で始まる単語はそのまま', () => {
    expect(type('so it is')).toBe('So it is');
  });

  it('大文字・小文字の切り替え', () => {
    expect(applyEnglish('Hello w', { kind: 'action', action: 'case', label: 'Aa', speak: 'case' })).toBe('Hello W');
    expect(applyEnglish('Hello W', { kind: 'action', action: 'case', label: 'Aa', speak: 'case' })).toBe('Hello w');
  });
});
