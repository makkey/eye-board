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

  it('1段目で長く目を閉じると何もしない（休む）', () => {
    const { log, engine } = run([
      ['C', 300],
      ['closed', 2000],
      ['C', 300],
    ]);
    expect(log).toEqual([]);
    expect(engine.stage).toBe('row');
  });

  it('閉じ始めのまぶたが一瞬「左下」と判定されても、閉じ続ければ な行', () => {
    const { rows } = run([
      ['C', 300],
      ['DL', 150],
      ['closed', 900],
      ['C', 300],
    ]);
    expect(rows).toEqual(['na']);
  });

  it('閉じている途中に薄目で一瞬開いても途切れず、ま行にもならない', () => {
    const { rows } = run([
      ['C', 300],
      ['DL', 150],
      ['closed', 400],
      ['DL', 50],
      ['closed', 400],
      ['C', 300],
    ]);
    expect(rows).toEqual(['na']);
  });

  it('目を閉じている時間は、方向を見ている時間に数えない', () => {
    const { rows, engine } = run([
      ['C', 300],
      ['DL', 250],
      ['closed', 400],
      ['DL', 150],
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

  it('2段目で下を見て戻ると、何も選ばず1段目へ', () => {
    for (const d of ['DL', 'D', 'DR'] as Dir[]) {
      const { log, engine } = run([
        ['C', 300],
        ['U', 600],
        ['C', 300],
        [d, 600],
        ['C', 300],
      ]);
      expect(log).toEqual(['cancel:back']);
      expect(engine.stage).toBe('row');
    }
  });

  it('2段目で目を閉じると、何も選ばず1段目へ', () => {
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

  it('下を2秒見続けると「わ行」', () => {
    const { log } = run([
      ['C', 300],
      ['D', 2300],
      ['C', 300],
      ['U', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['ん']);
  });

  it('下を短く見ると「や行」', () => {
    const { log } = run([
      ['C', 300],
      ['D', 800],
      ['C', 300],
      ['R', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['よ']);
  });

  it('左下2秒 → 上 で濁点', () => {
    const { log } = run([
      ['C', 300],
      ['DL', 2300],
      ['C', 300],
      ['U', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['゛']);
  });

  it('上2秒 → 左 で削除', () => {
    const { log } = run([
      ['C', 300],
      ['U', 2300],
      ['C', 300],
      ['L', 600],
      ['C', 300],
    ]);
    expect(log).toEqual(['⌫削除']);
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
