/**
 * 入力ログ。どんな操作をして、どんな候補が出て、何を選んだかを時刻つきで記録する（使い勝手の確かめ用）。
 * このブラウザの中だけに保存し、利用者がコピーした時だけ外に出る
 */

export interface LogEntry {
  /** 時刻（Date.now()） */
  t: number;
  /** 種類（操作・変換・候補・選択 など） */
  kind: string;
  msg: string;
}

const KEY = 'eyeboard.inputlog.v1';
/** 保存しておく最大の件数（古いものから消す） */
const MAX = 2000;

export class InputLog {
  enabled = true;
  private entries: LogEntry[] = [];

  constructor() {
    try {
      this.entries = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    } catch {
      this.entries = [];
    }
  }

  get size(): number {
    return this.entries.length;
  }

  add(kind: string, msg: string) {
    if (!this.enabled) return;
    this.entries.push({ t: Date.now(), kind, msg });
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    this.save();
  }

  clear() {
    this.entries = [];
    this.save();
  }

  /** チャットなどに貼れるテキスト。header は先頭に付ける説明（設定など） */
  text(header: string[] = []): string {
    let day = '';
    const lines = [...header];
    const two = (n: number) => String(n).padStart(2, '0');
    for (const e of this.entries) {
      const d = new Date(e.t);
      const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
      if (date !== day) {
        day = date;
        lines.push('', `## ${date}`);
      }
      const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
      lines.push(`${time} ${e.kind}　${e.msg}`);
    }
    return lines.join('\n');
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      // 保存できなくても、開いている間は残る
    }
  }
}
