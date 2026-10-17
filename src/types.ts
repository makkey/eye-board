/** 視線の方向。C = 中央（正面＝画面を見ている状態） */
export type Dir = 'C' | 'U' | 'UR' | 'R' | 'DR' | 'D' | 'DL' | 'L' | 'UL';

export const ALL_DIRS: Dir[] = ['C', 'U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'];

/** 分類器が区別するクラス：9方向＋目を閉じている */
export type GazeClass = Dir | 'closed';
export const ALL_CLASSES: GazeClass[] = [...ALL_DIRS, 'closed'];

/** 2段目（フラワー配置）：左から時計回りに あ・い・う・え・お */
export const FLOWER_DIRS: Dir[] = ['L', 'UL', 'U', 'UR', 'R'];
/** 2段目でこの方向を見ると、何も選ばずに1段目へ戻る */
export const BACK_DIRS: Dir[] = ['DL', 'D', 'DR'];

export const DIR_ARROW: Record<Dir, string> = {
  C: '●',
  U: '↑',
  UR: '↗',
  R: '→',
  DR: '↘',
  D: '↓',
  DL: '↙',
  L: '←',
  UL: '↖',
};

export const DIR_NAME_JA: Record<Dir, string> = {
  C: '中央',
  U: '上',
  UR: '右上',
  R: '右',
  DR: '右下',
  D: '下',
  DL: '左下',
  L: '左',
  UL: '左上',
};

export type Action =
  | 'cycle' // ゛゜小 を順に切り替え
  | 'dakuten'
  | 'handakuten'
  | 'small'
  | 'backspace'
  | 'space'
  | 'newline'
  | 'clear'
  | 'undo'
  | 'speak';

export type Item =
  | { kind: 'char'; ch: string; speak?: string }
  | { kind: 'action'; action: Action; label: string; speak: string };

export interface Row {
  id: string;
  /** キー上の表示 */
  label: string;
  /** 候補になった時の読み上げ */
  speak: string;
  /** あ段・い段・う段・え段・お段の順（FLOWER_DIRS に対応）。空きは null */
  items: (Item | null)[];
}

/** 1フレーム分の入力（視線分類後） */
export interface GazeFrame {
  t: number;
  faceFound: boolean;
  /** 分類済みの方向（目を閉じている間は無視される） */
  dir: Dir;
  closed: boolean;
}

export interface Settings {
  selectMs: number;
  longMs: number;
  closeMinMs: number;
  idleMs: number;
  debounceMs: number;
  smoothing: number;
  hysteresis: number;
  centerBias: number;
  closedBias: number;
  tts: boolean;
  sound: boolean;
  ttsRate: number;
}
