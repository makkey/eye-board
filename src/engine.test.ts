import { describe, expect, it } from 'vitest';
import { InputEngine } from './engine';
import { EN_KEYMAP, JA_KEYMAP, VOWEL_KEYMAP, itemLabel } from './layout';
import { DEFAULT_SETTINGS } from './settings';
import type { Dir, Row } from './types';

// 時間の組み立てを読みやすくするため、テストでは候補になるまでを 400ms に固定する
const SETTINGS = { ...DEFAULT_SETTINGS, selectMs: 400 };

/** 方向の列（[dir, ms] や ['closed', ms]）を 10ms 刻みで流し、確定した項目を返す */
function run(steps: [Dir | 'closed', number][], keymap = JA_KEYMAP, settings = SETTINGS) {
  const log: string[] = [];
  const rows: string[] = [];
  const engine = new InputEngine(
    settings,
    {
      rowCommit: (row) => rows.push(row.id),
      commit: (item) => log.push(itemLabel(item)),
      retract: (item) => log.push(`retract:${itemLabel(item)}`),
      cancel: (reason) => log.push(`cancel:${reason}`),
    },
    keymap,
  );
  let t = 0;
  for (const [what, ms] of steps) {
    for (let i = 0; i < ms; i += 10) {
      engine.update({
        t,
        faceFound: true,
        dir: what === 'closed' ? 'C' : what,
        closed: what === 'closed',
      });
      t += 10;
    }
  }
  return { log, rows, engine };
}

describe('InputEngine', () => {
  it('上 → 中央 → 右上 → 中央 で「け」（左から時計回りに あいうえお）', () => {
    const { log } = run([
      ['C', 300],
      ['U', 600],
      ['C', 300],
      ['UR', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['け']);
  });

  it('2段目の あ〜お は ← ↖ ↑ ↗ →', () => {
    const got = (['L', 'UL', 'U', 'UR', 'R'] as Dir[]).map(
      (d) =>
        run([
          ['C', 300],
          ['U', 600],
          ['C', 300],
          [d, 600],
          ['C', 300],
        ]).log[0],
    );
    expect(got).toEqual(['か', 'き', 'く', 'け', 'こ']);
  });

  it('1段目は ↖あ ↑か ↗さ ←た →は、2秒で ↖ま ↑や ↗ら ←編集 →わ', () => {
    const first = (d: Dir, ms: number) =>
      run([
        ['C', 300],
        [d, ms],
        ['C', 300],
        ['L', 600],
        ['C', 300],
      ]).log[0];
    expect((['UL', 'U', 'UR', 'L', 'R'] as Dir[]).map((d) => first(d, 600))).toEqual(['あ', 'か', 'さ', 'た', 'は']);
    expect((['UL', 'U', 'UR', 'L', 'R'] as Dir[]).map((d) => first(d, 2300))).toEqual(['ま', 'や', 'ら', '⌫削除', 'わ']);
  });

  it('既定の設定では 0.6 秒見ると候補になる', () => {
    const look = (ms: number) =>
      run(
        [
          ['C', 300],
          ['U', ms],
          ['C', 300],
          ['L', 900],
          ['C', 300],
        ],
        JA_KEYMAP,
        DEFAULT_SETTINGS,
      ).log;
    expect(DEFAULT_SETTINGS.selectMs).toBe(600);
    expect(look(500)).toEqual([]);
    expect(look(900)).toEqual(['か']);
  });

  it('← を2秒、続けて ← で削除', () => {
    const { log } = run([
      ['C', 300],
      ['L', 2300],
      ['C', 300],
      ['L', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['⌫削除']);
  });

  it('選択時間に満たない視線移動は無視', () => {
    const { log, engine } = run([
      ['C', 300],
      ['U', 250],
      ['C', 300],
    ]);
    expect(log).toEqual([]);
    expect(engine.stage).toBe('row');
  });

  it('1段目で目を閉じると「な行」', () => {
    const { log, engine } = run([
      ['C', 300],
      ['closed', 800],
      ['C', 300],
      ['L', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['な']);
    expect(engine.stage).toBe('row');
  });

  it('目を閉じ続けた時点で な行（開けるのが遅くてもよい）', () => {
    const { rows, engine } = run([
      ['C', 300],
      ['closed', 1500],
    ]);
    expect(rows).toEqual(['na']);
    expect(engine.stage).toBe('char');
    expect(engine.row?.id).toBe('na');
  });

  it('そのまま2秒閉じ続けると「記号」に切り替わる', () => {
    const { rows, log } = run([
      ['C', 300],
      ['closed', 2500],
      ['C', 300],
      ['UR', 600],
      ['C', 300],
    ]);
    expect(rows).toEqual(['na', 'kigo']);
    expect(log).toEqual(['？']);
  });

  it('な行に入った後も閉じ続けていて、2段目の「戻る」にはならない', () => {
    const { rows, log, engine } = run([
      ['C', 300],
      ['closed', 1500],
      ['C', 300],
      ['UL', 600],
      ['C', 300],
    ]);
    expect(rows).toEqual(['na']);
    expect(log).toEqual(['に']);
    expect(engine.stage).toBe('row');
  });

  it('閉じ始めに一瞬別の方向と判定されても、閉じ続ければ な行', () => {
    const { rows } = run([
      ['C', 300],
      ['L', 150],
      ['closed', 900],
      ['C', 300],
    ]);
    expect(rows).toEqual(['na']);
  });

  it('閉じている途中に薄目で一瞬開いても途切れない', () => {
    const { rows } = run([
      ['C', 300],
      ['L', 150],
      ['closed', 400],
      ['L', 50],
      ['closed', 400],
      ['C', 300],
    ]);
    expect(rows).toEqual(['na']);
  });

  it('目を閉じている時間は、方向を見ている時間に数えない', () => {
    const { rows, engine } = run([
      ['C', 300],
      ['L', 250],
      ['closed', 400],
      ['L', 150],
      ['C', 300],
    ]);
    expect(rows).toEqual([]);
    expect(engine.stage).toBe('row');
  });

  it('自然なまばたきは何もしない', () => {
    const { log, engine } = run([
      ['C', 300],
      ['closed', 200],
      ['C', 300],
    ]);
    expect(log).toEqual([]);
    expect(engine.stage).toBe('row');
  });

  it('2段目で目を閉じる（下を見る）と、何も選ばず1段目へ', () => {
    const { log, engine } = run([
      ['C', 300],
      ['U', 600],
      ['C', 300],
      ['closed', 800],
      ['C', 300],
    ]);
    expect(log).toEqual(['cancel:close']);
    expect(engine.stage).toBe('row');
  });

  it('2段目で何もしないとタイムアウトでキャンセル', () => {
    const { log } = run([
      ['C', 300],
      ['U', 600],
      ['C', 5500],
    ]);
    expect(log).toEqual(['cancel:idle']);
  });

  it('方向を見続けている途中のまばたきで候補は消えない', () => {
    const { log } = run([
      ['C', 300],
      ['U', 300],
      ['closed', 150],
      ['U', 400],
      ['C', 300],
      ['UL', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['き']);
  });

  it('別の方向へ移ると測り直す', () => {
    const { log } = run([
      ['C', 300],
      ['U', 600],
      ['UR', 600],
      ['C', 300],
      ['L', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['さ']);
  });

  it('デバウンス未満の一瞬の揺れは無視', () => {
    const { log } = run([
      ['C', 300],
      ['U', 300],
      ['C', 50],
      ['U', 300],
      ['C', 300],
      ['UR', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['け']);
  });
});

describe('InputEngine（英語）', () => {
  const en = (steps: [Dir | 'closed', number][]) => run(steps, EN_KEYMAP);

  it('↑（F〜J）→ ↗ で i', () => {
    const { log } = en([
      ['C', 300],
      ['U', 600],
      ['C', 300],
      ['UR', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['I']);
  });

  it('目を閉じるとその場でスペース（2段目に入らない）', () => {
    const { log, engine } = en([
      ['C', 300],
      ['closed', 800],
      ['C', 300],
    ]);
    expect(log).toEqual(['␣']);
    expect(engine.stage).toBe('row');
  });

  it('閉じ続けるとスペースを取り消して記号へ', () => {
    const { log, rows } = en([
      ['C', 300],
      ['closed', 2500],
      ['C', 300],
      ['L', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['␣', 'retract:␣', '.']);
    expect(rows).toEqual(['en-symbols']);
  });

  it('← を2秒、続けて ← で削除', () => {
    const { log } = en([
      ['C', 300],
      ['L', 2300],
      ['C', 300],
      ['L', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['⌫Del']);
  });
});

describe('InputEngine（母音入力）', () => {
  it('方向を見て戻ると、2段目に入らずその母音が入る', () => {
    const { log, rows, engine } = run(
      [
        ['C', 300],
        ['L', 600],
        ['C', 300],
        ['UR', 600],
        ['C', 300],
      ],
      VOWEL_KEYMAP,
    );
    expect(log).toEqual(['あ', 'え']);
    expect(rows).toEqual([]);
    expect(engine.stage).toBe('row');
  });

  it('↖ を2秒で ん、長押しの無い方向は見続けても母音のまま', () => {
    expect(run([['C', 300], ['UL', 2200], ['C', 300]], VOWEL_KEYMAP).log).toEqual(['ん']);
    expect(run([['C', 300], ['U', 2200], ['C', 300]], VOWEL_KEYMAP).log).toEqual(['う']);
  });

  it('目を閉じると変換、閉じ続けると変換を取り消して記号へ', () => {
    expect(run([['C', 300], ['closed', 800], ['C', 300]], VOWEL_KEYMAP).log).toEqual(['変換']);
    const long = run([['C', 300], ['closed', 2300], ['C', 300]], VOWEL_KEYMAP);
    expect(long.log).toEqual(['変換', 'retract:変換']);
    expect(long.rows).toEqual(['jv-kigo']);
  });

  it('外から開いた候補の行は、見て戻ると選べて、目を閉じるともどる。放っておいても戻らない', () => {
    const cands: Row = {
      id: 'cand',
      label: '候補',
      speak: '候補',
      items: [{ kind: 'char', ch: '昨日は' }, { kind: 'char', ch: '希望は' }, null, null, null],
      noIdle: true,
    };
    const log: string[] = [];
    const engine = new InputEngine(SETTINGS, { commit: (i) => log.push(itemLabel(i)), cancel: (r) => log.push(`cancel:${r}`) }, VOWEL_KEYMAP);
    let t = 0;
    const feed = (what: Dir | 'closed', ms: number) => {
      for (let i = 0; i < ms; i += 10, t += 10) {
        engine.update({ t, faceFound: true, dir: what === 'closed' ? 'C' : what, closed: what === 'closed' });
      }
    };
    feed('C', 300);
    engine.openRow(cands, t);
    feed('C', 8000); // 放っておいても戻らない
    expect(engine.stage).toBe('char');
    feed('UL', 600);
    feed('C', 300);
    expect(log).toEqual(['希望は']);

    engine.openRow(cands, t);
    feed('closed', 800);
    feed('C', 300);
    expect(log).toEqual(['希望は', 'cancel:close']);
    expect(engine.stage).toBe('row');
  });
});
