import { describe, expect, it } from 'vitest';
import { InputEngine } from './engine';
import { itemLabel } from './layout';
import { DEFAULT_SETTINGS } from './settings';
import type { Dir } from './types';

/** 方向の列（[dir, ms] や ['closed', ms]）を 10ms 刻みで流し、確定した項目を返す */
function run(steps: [Dir | 'closed', number][], settings = DEFAULT_SETTINGS) {
  const log: string[] = [];
  const rows: string[] = [];
  const engine = new InputEngine(settings, {
    rowCommit: (row) => rows.push(row.id),
    commit: (item) => log.push(itemLabel(item)),
    cancel: (reason) => log.push(`cancel:${reason}`),
  });
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

  it('1段目は ↖あ ↑か ↗さ ←た →は、2秒で ↖ま ↑や ↗ら ←わ →編集', () => {
    const first = (d: Dir, ms: number) =>
      run([
        ['C', 300],
        [d, ms],
        ['C', 300],
        ['L', 600],
        ['C', 300],
      ]).log[0];
    expect((['UL', 'U', 'UR', 'L', 'R'] as Dir[]).map((d) => first(d, 600))).toEqual(['あ', 'か', 'さ', 'た', 'は']);
    expect((['UL', 'U', 'UR', 'L', 'R'] as Dir[]).map((d) => first(d, 2300))).toEqual(['ま', 'や', 'ら', 'わ', '⌫削除']);
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
