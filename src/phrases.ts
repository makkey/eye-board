import { stripPunctuation, toHiragana } from './lab/vowels';

/**
 * 変換候補を手元で文節に切り分ける（区切りを入れずに変換した候補でも「一部を使う」で合っている文節を選べるように）。
 * 辞書は持たず、表記の文字の種類（漢字・カタカナ・ひらがな）と、AI が返した読みとの対応から決める：
 * - ひらがなの後に漢字・カタカナが来たら区切る（昨日は｜楽しかった）
 * - 漢字・カタカナの直後の助詞（が・は・を・に・で・と・へ・も・の・から・まで・より）の後で区切る（ゲームが｜したい）
 * - 2文字以上の漢字やカタカナ（名詞が多い）の直後に、する・だ などでないひらがなが続いたら区切る（明後日｜やろう）
 * - 読点などの後、カタカナの後の漢字の前でも区切る（大丈夫、｜ありがとう、コーヒー｜飲む）
 * - 「て」「で」の後に別の動詞が続いたら区切る（黙って｜やろう）
 * 漢字が続く所（明後日買おう）は切れない。読みと表記を対応づけられない時は切り分けない（1つのまま返す）
 */

export interface Phrase {
  text: string;
  reading: string;
}

type Kind = 'kanji' | 'kata' | 'hira' | 'punct' | 'other';

function kindOf(c: string): Kind {
  if (/[\p{Script=Han}々〆ヶ]/u.test(c)) return 'kanji';
  if (/[ァ-ヺ]/.test(c)) return 'kata';
  if (/[ぁ-ゖ]/.test(c)) return 'hira';
  if (!stripPunctuation(c).trim()) return 'punct';
  return 'other';
}

interface Chunk {
  kind: Kind;
  text: string;
  reading: string;
}

/** 表記を文字の種類ごとのまとまりに分け、それぞれの読みを読みの文字列から割り当てる。対応しなければ null */
function align(text: string, reading: string): Chunk[] | null {
  const chunks: { kind: Kind; text: string }[] = [];
  for (const c of text) {
    // ー は前の文字と同じまとまりにする（すごーい・ゲーム）
    const kind = c === 'ー' && chunks.length ? chunks[chunks.length - 1].kind : kindOf(c);
    const last = chunks[chunks.length - 1];
    if (last && last.kind === kind) last.text += c;
    else chunks.push({ kind, text: c });
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // かなはそのまま読みに現れる（ー は読みでは母音で書かれることもある）。漢字などは1文字以上の何か
  const pattern = chunks
    .map((ch) => {
      if (ch.kind === 'punct') return '()';
      if (ch.kind === 'hira' || ch.kind === 'kata') {
        return `(${[...toHiragana(ch.text)].map((c) => (c === 'ー' ? '[ーあいうえお]' : esc(c))).join('')})`;
      }
      return '(.+?)';
    })
    .join('');
  const m = new RegExp(`^${pattern}$`).exec(toHiragana(reading.replace(/[\s　]+/g, '')));
  if (!m) return null;
  return chunks.map((ch, i) => ({ ...ch, reading: m[i + 1] }));
}

/** 助詞の後や「て」の後で、続きが別の言葉として始まらない時の最初の文字（活用の続き・小さい字など） */
const NOT_WORD_START = 'ぁぃぅぇぉゃゅょゎっんーるらりれろ';
/** 「て」「で」の後でも、補助的に続くもの（ている・てね・ても・てた など）は切らない */
const AFTER_TE_KEEP = NOT_WORD_START + 'もはねよなのばがかさしたいぇ';
/** 名詞の後でも切らない（する・だ・な・に・っぽい など、名詞と1つの文節になるもの） */
const AFTER_NOUN_KEEP = NOT_WORD_START + 'しすさせなにだでじずぜ';
/** 漢字の後では、あ行も送りがなのことが多い（明後日買おう の「買」は前の漢字とつながっていて切れない） */
const AFTER_KANJI_KEEP = AFTER_NOUN_KEEP + 'あいうえお';
const PARTICLES = /^(?:から|まで|より|が|は|を|に|で|と|へ|も|の)+/;

export function splitPhrase(text: string, reading: string): Phrase[] {
  const chunks = align(text, reading);
  if (!chunks || chunks.length < 2) return [{ text, reading }];
  const out: Phrase[] = [];
  let cur: Phrase = { text: '', reading: '' };
  const cut = () => {
    if (cur.text) out.push(cur);
    cur = { text: '', reading: '' };
  };
  const add = (t: string, r: string) => {
    cur.text += t;
    cur.reading += r;
  };
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const prev = chunks[i - 1];
    if (ch.kind === 'punct') {
      // 読点などは前に付けて区切る（大丈夫、｜ありがとう）
      add(ch.text, ch.reading);
      cut();
      continue;
    }
    if (ch.kind !== 'hira') {
      // ひらがなの後に漢字などが来たら新しい文節（「お茶」「ご飯」の お・ご は前に付ける）。
      // カタカナの後の漢字も（コーヒー｜飲む）
      const prefix = cur.text === 'お' || cur.text === 'ご';
      if ((prev?.kind === 'hira' && !prefix) || (prev?.kind === 'kata' && ch.kind === 'kanji')) cut();
      add(ch.text, ch.reading);
      continue;
    }
    // ひらがなは表記と読みが1文字ずつ対応する
    let s = ch.text;
    let r = ch.reading;
    const take = (n: number) => {
      add(s.slice(0, n), r.slice(0, n));
      s = s.slice(n);
      r = r.slice(n);
    };
    const content = prev && prev.kind !== 'punct' && prev.kind !== 'hira';
    if (content) {
      const p = PARTICLES.exec(s)?.[0] ?? '';
      // です・でした の で は助詞ではない
      const desu = p.endsWith('で') && 'すし'.includes(s[p.length]);
      if (p && s.length > p.length && !NOT_WORD_START.includes(s[p.length]) && !desu) {
        take(p.length);
        cut();
      } else if (!p) {
        const noun = prev.kind !== 'kanji' || [...prev.text].length >= 2;
        const keep = prev.kind === 'kanji' ? AFTER_KANJI_KEEP : AFTER_NOUN_KEEP;
        if (noun && s.length >= 2 && !keep.includes(s[0])) cut();
      }
    }
    // 「て」「で」の後に別の動詞が続く（黙って｜やろう）
    for (let j = 1; j < s.length - 2; j++) {
      if ((s[j] === 'て' || s[j] === 'で') && !AFTER_TE_KEEP.includes(s[j + 1])) {
        take(j + 1);
        cut();
        j = 0;
      }
    }
    add(s, r);
  }
  cut();
  return out.length ? out : [{ text, reading }];
}
