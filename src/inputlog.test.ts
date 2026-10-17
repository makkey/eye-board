import { describe, expect, it } from 'vitest';
import { InputLog } from './inputlog';

describe('InputLog', () => {
  it('時刻つきの行にして、見出しを付けて出す', () => {
    const log = new InputLog();
    log.clear();
    log.add('変換', '［いおうあ］');
    log.add('選択', '昨日は（1番目）');
    const text = log.text(['# 見出し']);
    expect(text.startsWith('# 見出し')).toBe(true);
    expect(text).toMatch(/\d+:\d+:\d+\.\d 変換　［いおうあ］/);
    expect(text).toContain('選択　昨日は（1番目）');
  });

  it('記録しない設定では増えない。最大件数を超えたら古いものから消す', () => {
    const log = new InputLog();
    log.clear();
    log.enabled = false;
    log.add('入力', 'あ');
    expect(log.size).toBe(0);
    log.enabled = true;
    for (let i = 0; i < 2100; i++) log.add('入力', String(i));
    expect(log.size).toBe(2000);
    expect(log.text()).not.toContain('入力　0\n');
    expect(log.text()).toContain('入力　2099');
  });
});
