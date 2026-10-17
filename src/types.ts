/**
 * 視線の方向。C = 中央（正面＝画面を見ている状態）。
 * 下方向は、カメラから見ると「目を閉じた」のとほぼ同じになり区別できないので、方向としては使わず
 * 「閉じる」と同じ1つの操作として扱う。
 */
export type Dir = 'C' | 'UL' | 'U' | 'UR' | 'L' | 'R';

export const ALL_DIRS: Dir[] = ['C', 'UL', 'U', 'UR', 'L', 'R'];

/** 中央以外の5方向（1段目の行・2段目の文字に割り当てる） */
export type SideDir = Exclude<Dir, 'C'>;

/** 分類器が区別するクラス：6方向＋目を閉じている（下を見ている） */
export type GazeClass = Dir | 'closed';
export const ALL_CLASSES: GazeClass[] = [...ALL_DIRS, 'closed'];

/** 2段目（フラワー配置）：左から時計回りに あ・い・う・え・お */
export const FLOWER_DIRS: Dir[] = ['L', 'UL', 'U', 'UR', 'R'];

export const DIR_ARROW: Record<Dir, string> = {
  C: '●',
  UL: '↖',
  U: '↑',
  UR: '↗',
  L: '←',
  R: '→',
};


export type Action =
  | 'cycle' // ゛゜小 を順に切り替え
  | 'case' // 直前の英字の大文字・小文字を切り替え
  | 'dakuten'
  | 'handakuten'
  | 'small'
  | 'backspace'
  | 'space'
  | 'newline'
  | 'clear'
  | 'undo'
  | 'speak'
  | 'convert' // 母音入力：ここまでの母音を1文節として AI に変換させる
  | 'more'; // 母音入力：まだ出ていない別の候補を AI に聞く

export type Item =
  | { kind: 'char'; ch: string; speak?: string; label?: string }
  | { kind: 'action'; action: Action; label: string; speak: string };

export interface Row {
  id: string;
  /** キー上の表示 */
  label: string;
  /** 候補になった時の読み上げ */
  speak: string;
  /** あ段・い段・う段・え段・お段の順（FLOWER_DIRS に対応）。空きは null */
  items: (Item | null)[];
  /** 2段目に入らず、確定した時点でこの1つを入力する（母音入力の「あ」など） */
  direct?: Item;
  /** 何もしなくても1段目へ戻らない（変換候補を読んで選ぶ間など） */
  noIdle?: boolean;
  /**
   * 2段目で目を閉じた時に、1段目へ戻る代わりにこれを入力する（母音入力の「別の候補」）。
   * そのまま longMs まで閉じ続けると取り消して1段目へ戻る
   */
  closeItem?: Item;
}

export type Lang = 'ja' | 'en';

/** 日本語の入力方式。kana = 12キー（行→段）、vowel = 母音だけ入れて AI が変換 */
export type JaInput = 'kana' | 'vowel';

/** 言語・入力方式ごとのキー配置 */
export interface Keymap {
  /** ja / jv（日本語・母音入力）/ en */
  id: string;
  lang: Lang;
  /** 1段目：方向を短く見た時の行 */
  rowByDir: Record<SideDir, Row>;
  /** 1段目：方向を longMs 見続けた時の行（無い方向は、見続けても切り替わらない） */
  longRowByDir: Partial<Record<SideDir, Row>>;
  /** 1段目：目を閉じた（下を見た）時。行に入るか、その場で1文字入れるか */
  closeShort: { kind: 'row'; row: Row } | { kind: 'item'; item: Item };
  /** 1段目：そのまま longMs まで閉じ続けた時の行 */
  closeLong: Row;
}

/** 1フレーム分の入力（視線分類後） */
export interface GazeFrame {
  t: number;
  faceFound: boolean;
  /** 分類済みの方向（目を閉じている／下を見ている間は無視される） */
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
  lang: Lang;
  jaInput: JaInput;
  /** 母音入力で使う AI（API キーは設定とは別に、このブラウザに保存する） */
  aiProvider: AiProvider;
  aiModel: string;
  aiEffort: AiEffort;
  /** 同じ問いを同時に聞く回数（順位を合算する） */
  aiRuns: number;
}

export type AiProvider = 'gemini' | 'openai' | 'claude';
export type AiEffort = 'default' | 'minimal' | 'low' | 'medium' | 'high';
