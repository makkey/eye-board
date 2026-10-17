import { LONG_ROW_BY_DIR, ROWS, ROW_BY_DIR, flowerIndex } from './layout';
import type { Dir, GazeFrame, Item, Row, Settings } from './types';

export type Candidate =
  | { kind: 'row'; row: Row; long: boolean }
  | { kind: 'item'; dir: Dir; item: Item };

export interface EngineEvents {
  /** 1段目で行が候補になった（まだ確定していない） */
  rowCandidate?(row: Row, long: boolean): void;
  /** 行が確定し、2段目（フラワー展開）に入った（目を閉じ続けて行が切り替わった時も呼ぶ） */
  rowCommit?(row: Row): void;
  /** 2段目で文字が候補になった */
  itemCandidate?(item: Item): void;
  /** 文字・操作が確定した */
  commit?(item: Item): void;
  /** 何も選ばずに1段目へ戻った */
  cancel?(reason: 'close' | 'idle'): void;
  /** 安定した視線方向が変わった */
  dirChange?(dir: Dir): void;
}

/**
 * 視線方向の時系列を「行選択 → 文字選択」に変換する状態機械。
 *
 * 「目を閉じる」と「下を見る」はカメラから区別できないので、同じ1つの操作（closed）として扱う。
 *
 * 1段目（行）
 * - 方向を selectMs 見続けると候補、中央に戻ると確定。longMs 見続けると別の行に切り替わる
 * - 目を closeMinMs 閉じ続けた時点で「な行」、そのまま longMs まで閉じ続けると「記号」
 *   （閉じている間に決まるので、開けるタイミングは問わない）
 *
 * 2段目（フラワー配置：左から時計回りに あ・い・う・え・お）
 * - 方向を selectMs 見続けると候補、中央に戻ると確定
 * - 目を closeMinMs 閉じ続けると（下を見ても）、何も選ばず1段目へ
 * - idleMs 何もしなくても1段目へ
 */
export class InputEngine {
  stage: 'row' | 'char' = 'row';
  row: Row | null = null;
  candidate: Candidate | null = null;

  /** デバウンス後の安定した方向 */
  dir: Dir = 'C';
  /** 現在の方向を見ている時間（目を閉じている間は数えない） */
  held = 0;
  /** 目を閉じ始めた時刻（デバウンス後に確定、開始時刻は遡る） */
  closedStart: number | null = null;
  /** 今回目を閉じている間に、閉じる操作をもう実行したか（開けるまで次は受け付けない） */
  closeDone = false;
  /** 今回目を閉じている間に1段目から「な行」に入ったか（閉じ続けると「記号」に切り替える） */
  private closeEnteredRow = false;

  private pendingDir: Dir = 'C';
  private pendingSince = 0;
  private lastActivity = 0;
  private lastT: number | null = null;
  /** フレームごとの「閉じている」判定と、その状態が続いている始まり */
  private rawClosed = false;
  private rawClosedSince = 0;
  /** デバウンス後の「閉じている」 */
  private closedStable = false;

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
    this.held = 0;
    this.closedStart = null;
    this.closeDone = false;
    this.lastActivity = t;
    this.lastT = null;
    this.rawClosed = false;
    this.closedStable = false;
  }

  update(frame: GazeFrame) {
    const { t } = frame;
    // 方向を見ている時間はフレーム間隔の積み上げで測る（止まっている間は増えない）
    const dt = this.lastT === null ? 0 : Math.min(t - this.lastT, 100);
    this.lastT = t;

    if (!frame.faceFound) {
      // 顔を見失った間の「目を閉じた」は数えない
      this.rawClosed = false;
      this.closedStable = false;
      this.closedStart = null;
      this.closeDone = false;
      this.lastActivity = t;
      return;
    }

    // 「閉じる／開く」にもデバウンスをかける（薄目などで1〜2フレームだけ開いた判定になっても途切れない）
    if (frame.closed !== this.rawClosed) {
      this.rawClosed = frame.closed;
      this.rawClosedSince = t;
    }
    if (this.rawClosed !== this.closedStable && t - this.rawClosedSince >= this.settings.debounceMs) {
      this.closedStable = this.rawClosed;
      if (this.closedStable) {
        this.closedStart = this.rawClosedSince;
        this.closeDone = false;
      } else {
        this.onOpen(t);
      }
    }

    if (this.closedStable) {
      if (this.rawClosed) this.updateClosed(t);
      return; // 閉じている間は方向を凍結する
    }
    // まばたきの途中かもしれない間は、方向も時間も進めない
    if (this.rawClosed) return;

    this.updateDir(frame.dir, t);
    this.updateHold(dt);
    this.updateIdle(t);
  }

  /** 目を閉じた操作が今受け付けられるか（方向の候補を保持中は無効） */
  private closeActionAvailable(): boolean {
    return this.candidate === null;
  }

  private updateClosed(t: number) {
    if (this.closedStart === null) return;
    const dur = t - this.closedStart;

    if (this.closeDone) {
      // 閉じたまま longMs に達したら「な行」→「記号」に切り替える
      if (this.closeEnteredRow && dur >= this.settings.longMs) {
        this.closeEnteredRow = false;
        this.row = ROWS[LONG_ROW_BY_DIR.C];
        this.events.rowCommit?.(this.row);
      }
      return;
    }
    if (!this.closeActionAvailable() || dur < this.settings.closeMinMs) return;
    // 閉じ続けた時点で実行する（開けるタイミングを計らなくてよいように）。
    // 実行は1回だけで、目を開けるまで次の閉じる操作は数えない
    this.closeDone = true;
    // 閉じる途中のまぶたは別の方向と判定されることがある。意図して閉じたと分かった時点で、
    // その方向は取り消して中央に戻す
    this.dir = 'C';
    this.pendingDir = 'C';
    this.held = 0;
    if (this.stage === 'row') {
      this.enterChar(ROWS[ROW_BY_DIR.C], t);
      this.closeEnteredRow = true;
    } else {
      this.cancel('close');
    }
  }

  private onOpen(t: number) {
    this.closedStart = null;
    this.closeDone = false;
    this.closeEnteredRow = false;
    this.lastActivity = t;
    // 開いた直後の視線は不安定なので、方向のデバウンスをやり直す
    this.pendingDir = this.dir;
    this.pendingSince = t;
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

    // 別の方向へ移った：候補を捨ててその方向で計り直す
    this.held = 0;
    if (next === 'C') {
      if (this.candidate) this.commitCandidate(t);
      return;
    }
    this.candidate = null;
  }

  private updateHold(dt: number) {
    if (this.dir === 'C') return;
    this.held += dt;
    const held = this.held;
    const s = this.settings;

    if (this.stage === 'row') {
      if (!this.candidate && held >= s.selectMs) {
        this.setRowCandidate(ROWS[ROW_BY_DIR[this.dir]], false);
      }
      if (held >= s.longMs && this.candidate?.kind === 'row' && !this.candidate.long) {
        this.setRowCandidate(ROWS[LONG_ROW_BY_DIR[this.dir]], true);
      }
      return;
    }

    if (!this.row || this.candidate || held < s.selectMs) return;
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
    else this.commitItem(cand.item);
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

  private cancel(reason: 'close' | 'idle') {
    this.stage = 'row';
    this.row = null;
    this.candidate = null;
    this.events.cancel?.(reason);
  }
}
