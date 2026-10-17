import { LONG_ROW_BY_DIR, ROWS, ROW_BY_DIR, flowerIndex } from './layout';
import { BACK_DIRS } from './types';
import type { Dir, GazeFrame, Item, Row, Settings } from './types';

export type Candidate =
  | { kind: 'row'; row: Row; long: boolean }
  | { kind: 'item'; dir: Dir; item: Item }
  | { kind: 'back' };

export interface EngineEvents {
  /** 1段目で行が候補になった（まだ確定していない） */
  rowCandidate?(row: Row, long: boolean): void;
  /** 行が確定し、2段目（フラワー展開）に入った */
  rowCommit?(row: Row): void;
  /** 2段目で文字が候補になった */
  itemCandidate?(item: Item): void;
  /** 2段目で「戻る」が候補になった */
  backCandidate?(): void;
  /** 文字・操作が確定した */
  commit?(item: Item): void;
  /** 何も選ばずに1段目へ戻った */
  cancel?(reason: 'back' | 'close' | 'idle'): void;
  /** 目を閉じ続けて閾値を越えた（1: 選択／戻る, 2: 休む＝何もしない） */
  closeTick?(level: 1 | 2): void;
  /** 安定した視線方向が変わった */
  dirChange?(dir: Dir): void;
}

/**
 * 視線方向の時系列を「行選択 → 文字選択」に変換する状態機械。
 *
 * 1段目（行）
 * - 方向を selectMs 見続けると候補、中央に戻ると確定
 * - 一部の方向は longMs 見続けると別の行（わ・゛゜小・句読点・編集）に切り替わる
 * - 目を closeMinMs 以上閉じて開くと「な行」。restCloseMs 以上なら何もしない（目を休める）
 *
 * 2段目（フラワー配置：左から時計回りに あ・い・う・え・お）
 * - 方向を selectMs 見続けると候補、中央に戻ると確定
 * - 下方向（↙↓↘）を見て戻る、または目を closeMinMs 以上閉じて開くと、何も選ばず1段目へ
 * - idleMs 何もしなくても1段目へ
 */
export class InputEngine {
  stage: 'row' | 'char' = 'row';
  row: Row | null = null;
  candidate: Candidate | null = null;

  /** デバウンス後の安定した方向 */
  dir: Dir = 'C';
  /** 現在の方向を見始めた時刻（中央なら null） */
  holdStart: number | null = null;
  /** 目を閉じ始めた時刻 */
  closedStart: number | null = null;
  closeLevel: 0 | 1 | 2 = 0;

  private pendingDir: Dir = 'C';
  private pendingSince = 0;
  private lastActivity = 0;

  constructor(
    private settings: Settings,
    private events: EngineEvents = {},
  ) {}

  reset(t = 0) {
    this.stage = 'row';
    this.row = null;
    this.candidate = null;
    this.dir = 'C';
    this.pendingDir = 'C';
    this.pendingSince = t;
    this.holdStart = null;
    this.closedStart = null;
    this.closeLevel = 0;
    this.lastActivity = t;
  }

  update(frame: GazeFrame) {
    const { t } = frame;
    if (!frame.faceFound) {
      // 顔を見失った間の「目を閉じた」は数えない
      this.closedStart = null;
      this.closeLevel = 0;
      this.lastActivity = t;
      return;
    }

    if (frame.closed) {
      this.updateClosed(t);
      return; // 閉じている間は方向を凍結する
    }
    if (this.closedStart !== null) this.onOpen(t);

    this.updateDir(frame.dir, t);
    this.updateHold(t);
    this.updateIdle(t);
  }

  /** 目を閉じた操作が今受け付けられるか（方向の候補を保持中は無効） */
  private closeActionAvailable(): boolean {
    return this.dir === 'C' && this.candidate === null;
  }

  private updateClosed(t: number) {
    if (this.closedStart === null) {
      this.closedStart = t;
      this.closeLevel = 0;
    }
    if (!this.closeActionAvailable()) return;
    const dur = t - this.closedStart;
    if (this.closeLevel < 1 && dur >= this.settings.closeMinMs) {
      this.closeLevel = 1;
      this.events.closeTick?.(1);
    }
    // 2段目では長さに関係なく「戻る」なので、休む段階は1段目だけ
    if (this.closeLevel < 2 && this.stage === 'row' && dur >= this.settings.restCloseMs) {
      this.closeLevel = 2;
      this.events.closeTick?.(2);
    }
  }

  private onOpen(t: number) {
    const level = this.closeLevel;
    this.closedStart = null;
    this.closeLevel = 0;
    this.lastActivity = t;
    // 開いた直後の視線は不安定なので、方向のデバウンスをやり直す
    this.pendingSince = t;

    if (level !== 1) return;
    if (this.stage === 'row') this.enterChar(ROWS[ROW_BY_DIR.C], t);
    else this.cancel('close');
  }

  private updateDir(raw: Dir, t: number) {
    if (raw !== this.pendingDir) {
      this.pendingDir = raw;
      this.pendingSince = t;
    }
    if (this.pendingDir !== this.dir && t - this.pendingSince >= this.settings.debounceMs) {
      this.changeDir(this.pendingDir, t);
    }
  }

  private changeDir(next: Dir, t: number) {
    this.dir = next;
    this.lastActivity = t;
    this.events.dirChange?.(next);

    if (next === 'C') {
      this.holdStart = null;
      if (this.candidate) this.commitCandidate(t);
      return;
    }
    // 別の方向へ移った：候補を捨ててその方向で計り直す
    this.holdStart = t;
    this.candidate = null;
  }

  private updateHold(t: number) {
    if (this.dir === 'C' || this.holdStart === null) return;
    const held = t - this.holdStart;
    const s = this.settings;

    if (this.stage === 'row') {
      if (!this.candidate && held >= s.selectMs) {
        this.setRowCandidate(ROWS[ROW_BY_DIR[this.dir]], false);
      }
      const longId = LONG_ROW_BY_DIR[this.dir];
      if (longId && held >= s.longMs && this.candidate?.kind === 'row' && !this.candidate.long) {
        this.setRowCandidate(ROWS[longId], true);
      }
      return;
    }

    if (!this.row || this.candidate || held < s.selectMs) return;
    if (BACK_DIRS.includes(this.dir)) {
      this.candidate = { kind: 'back' };
      this.events.backCandidate?.();
      return;
    }
    const item = this.row.items[flowerIndex(this.dir)];
    if (item) {
      this.candidate = { kind: 'item', dir: this.dir, item };
      this.events.itemCandidate?.(item);
    }
  }

  private updateIdle(t: number) {
    if (this.stage !== 'char' || this.dir !== 'C' || this.candidate) return;
    if (t - this.lastActivity >= this.settings.idleMs) this.cancel('idle');
  }

  private setRowCandidate(row: Row, long: boolean) {
    this.candidate = { kind: 'row', row, long };
    this.events.rowCandidate?.(row, long);
  }

  private commitCandidate(t: number) {
    const cand = this.candidate;
    this.candidate = null;
    if (!cand) return;
    if (cand.kind === 'row') this.enterChar(cand.row, t);
    else if (cand.kind === 'item') this.commitItem(cand.item);
    else this.cancel('back');
  }

  private enterChar(row: Row, t: number) {
    this.stage = 'char';
    this.row = row;
    this.candidate = null;
    this.lastActivity = t;
    this.events.rowCommit?.(row);
  }

  private commitItem(item: Item) {
    this.stage = 'row';
    this.row = null;
    this.candidate = null;
    this.events.commit?.(item);
  }

  private cancel(reason: 'back' | 'close' | 'idle') {
    this.stage = 'row';
    this.row = null;
    this.candidate = null;
    this.events.cancel?.(reason);
  }
}
