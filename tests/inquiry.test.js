// js/inquiry.js の追加テスト（38件とは別に数える）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JUDGE, judgeContract } from '../js/calc.js';
import {
  CONFIRM, STATUS, METHOD, TOTAL_ONLY, emptyRow, normalizeRow, evaluateRow,
  applyConfirm, applyAnswerInput, fillBlankPeriods, buildingPartJudge, pdfFilenameForRows,
  hasPartAnswers, pendingContracts, clearBasicFreeChecks,
  STATUS_PARTS_TEXT, PARTS_ANSWER_TEXT, applyPartsConfirm, buildingPartsAnswerIsCalc, breakdownSumMismatch,
  BUILDING_PARTIAL, buildingPartScope, buildingPartJudgeShown,
} from '../js/inquiry.js';

const ctx = { caliber: 20, taxRatePercent: 10 };
const ready = { ...emptyRow(), start: '2026/08/20', end: '2026/10/20', usage: '59' }; // 計算額 16,100円
const ev = (row, c = ctx) => evaluateRow({ row, ...c });
const press = (row, action, c = ctx) => {
  const e = ev(row, c);
  return applyConfirm(e.row, action, e);
};
const answer = (row, field, value, c = ctx) => applyAnswerInput(ev(row, c).row, field, value, ev(row, c));

describe('確認状態：未確認', () => {
  test('期間と水量がそろえば計算額が出て、未確認・ボタンが押せる', () => {
    const e = ev(ready);
    assert.equal(e.status, STATUS.UNCONFIRMED);
    assert.equal(e.method, METHOD.UNCONFIRMED);
    assert.equal(e.canConfirm, true);
    assert.equal(e.calcTotal, 16100);
    assert.equal(e.entry.overall, JUDGE.BLANK);
  });

  test('入力がそろわない間はボタンを押せない（押しても行は変わらない）', () => {
    const row = { ...ready, usage: '' };
    assert.equal(ev(row).canConfirm, false);
    assert.deepEqual(press(row, CONFIRM.MATCH), row);
    assert.deepEqual(press(row, CONFIRM.MISMATCH), row);
  });

  test('期間エラー・入力エラーの間もボタンを押せない', () => {
    assert.equal(ev({ ...ready, end: '2026/08/01' }).canConfirm, false);
    assert.equal(ev({ ...ready, usage: 'abc' }).canConfirm, false);
  });
});

describe('確認状態：［一致］', () => {
  const matched = press(ready, CONFIRM.MATCH);

  test('計算した合計を回答（合計）として記録し、確認状態を別に保存する', () => {
    assert.equal(matched.ansTotal, '16100');
    assert.equal(matched.confirm.state, CONFIRM.MATCH);
    assert.equal(typeof matched.confirm.basis, 'string');
  });

  test('総合判定は一致、水道・下水道は「—（合計で照合）」、照合方法は「合計で照合」', () => {
    const e = ev(matched);
    assert.equal(e.status, STATUS.MATCH);
    assert.equal(e.entry.overall, JUDGE.MATCH);
    assert.equal(e.waterJudge, TOTAL_ONLY);
    assert.equal(e.sewerJudge, TOTAL_ONLY);
    assert.equal(e.method, METHOD.TOTAL);
  });

  test('判定関数の結果は、合計だけを渡したときの judgeContract と同じ（J-C と同じ形）', () => {
    const direct = judgeContract({
      caliber: 20, taxRatePercent: 10, basicFree: false, start: '2026-08-20', end: '2026-10-20',
      usage: 59, ansWater: null, ansSewer: null, ansTotal: 16100,
    });
    assert.deepEqual(ev(matched).entry, direct);
  });

  test('［違う］で入力していた内訳は消す', () => {
    let row = press(ready, CONFIRM.MISMATCH);
    row = answer(row, 'ansWater', '9048');
    row = answer(row, 'ansSewer', '7052');
    row = press(row, CONFIRM.MATCH);
    assert.deepEqual([row.ansTotal, row.ansWater, row.ansSewer], ['16100', '', '']);
  });
});

describe('確認状態：［違う］', () => {
  const opened = press(ready, CONFIRM.MISMATCH);

  test('金額を入力するまでは未確認。回答欄が開く', () => {
    const e = ev(opened);
    assert.equal(opened.confirm.state, CONFIRM.MISMATCH);
    assert.equal(e.status, STATUS.UNCONFIRMED);
    assert.equal(e.answersOpen, true);
  });

  test('合計を入力すると差額と「差異あり」', () => {
    const e = ev(answer(opened, 'ansTotal', '16,000'));
    assert.equal(e.status, STATUS.DIFF);
    assert.equal(e.entry.total.diff, -100);
    assert.equal(e.method, METHOD.TOTAL);
    assert.equal(e.waterJudge, TOTAL_ONLY);
  });

  test('計算額と同じ金額を入力すれば一致', () => {
    assert.equal(ev(answer(opened, 'ansTotal', '16100')).status, STATUS.MATCH);
  });

  test('内訳も入力すれば水道・下水道も判定する（合計が同じでも差異あり）', () => {
    let row = answer(opened, 'ansTotal', '16100');
    row = answer(row, 'ansWater', '9048');
    row = answer(row, 'ansSewer', '7052');
    const e = ev(row);
    assert.equal(e.status, STATUS.DIFF);
    assert.equal(e.waterJudge, JUDGE.DIFF);
    assert.equal(e.sewerJudge, JUDGE.DIFF);
    assert.equal(e.method, METHOD.BREAKDOWN);
  });

  test('水道だけ入力しても合計が取れなければ未確認', () => {
    assert.equal(ev(answer(opened, 'ansWater', '9038')).status, STATUS.UNCONFIRMED);
  });

  test('一致から［違う］にすると記録した合計を消す', () => {
    const row = press(press(ready, CONFIRM.MATCH), CONFIRM.MISMATCH);
    assert.equal(row.ansTotal, '');
    assert.equal(ev(row).status, STATUS.UNCONFIRMED);
  });

  test('違うから［一致］にすると入力した金額を計算額に置き換える', () => {
    const row = press(answer(opened, 'ansTotal', '16000'), CONFIRM.MATCH);
    assert.equal(row.ansTotal, '16100');
    assert.equal(ev(row).status, STATUS.MATCH);
  });

  test('回答欄のエラーは入力エラーになる（回答欄が開いているとき）', () => {
    assert.equal(ev(answer(opened, 'ansTotal', 'abc')).status, STATUS.INPUT_ERROR);
  });
});

describe('再確認が必要', () => {
  const matched = press(ready, CONFIRM.MATCH);
  const mismatched = answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16000');

  const cases = [
    ['開始日', { start: '2026/08/21' }, ctx],
    ['終了日', { end: '2026/10/21' }, ctx],
    ['使用水量', { usage: '60' }, ctx],
    ['無償化', { basicFree: true }, ctx],
    ['口径', {}, { caliber: 25, taxRatePercent: 10 }],
    ['消費税率', {}, { caliber: 20, taxRatePercent: 12 }],
  ];
  for (const [name, change, c] of cases) {
    test(`一致のあとに${name}が変わると再確認（記録した計算額は消す）`, () => {
      const e = ev({ ...matched, ...change }, c);
      assert.equal(e.changed, true);
      assert.equal(e.status, STATUS.STALE);
      assert.equal(e.row.confirm.state, CONFIRM.STALE);
      assert.equal(e.row.confirm.from, CONFIRM.MATCH);
      assert.equal(e.row.ansTotal, '');
      assert.equal(e.entry.total.answer, null);
    });
    test(`違うのあとに${name}が変わると再確認（入力した金額は残す）`, () => {
      const e = ev({ ...mismatched, ...change }, c);
      assert.equal(e.status, STATUS.STALE);
      assert.equal(e.row.ansTotal, '16000');
      assert.equal(e.answersOpen, true);
      assert.equal(e.entry.total.answer, null); // 再確認までは判定に使わない
    });
  }

  test('日付の書き方を整えただけでは再確認にならない', () => {
    const e = ev({ ...matched, start: '20260820', end: '２０２６/10/20' });
    assert.equal(e.changed, false);
    assert.equal(e.status, STATUS.MATCH);
  });

  test('値を元に戻しても一致には戻らない', () => {
    const stale = ev({ ...matched, usage: '60' }).row;
    const back = ev({ ...stale, usage: '59' });
    assert.equal(back.status, STATUS.STALE);
  });

  test('再確認で［一致］を押せば一致に戻る', () => {
    const stale = ev({ ...matched, usage: '60' }).row;
    const row = press(stale, CONFIRM.MATCH);
    assert.equal(row.ansTotal, '16434'); // 20mm・60m³ の計算額
    assert.equal(ev(row).status, STATUS.MATCH);
  });

  test('違うの再確認中に金額を入れ直すと、［違う］として確認し直す', () => {
    const stale = ev({ ...mismatched, usage: '60' }).row;
    const row = answer(stale, 'ansTotal', '16000');
    assert.equal(row.confirm.state, CONFIRM.MISMATCH);
    assert.equal(ev(row).status, STATUS.DIFF);
  });
});

describe('期間エラー・入力エラーの表示', () => {
  test('期間エラーでも計算額は出す', () => {
    const e = ev({ ...ready, end: '2026/08/01' });
    assert.equal(e.status, STATUS.PERIOD);
    assert.equal(e.calcTotal, 16100);
  });

  test('未確認のときは、隠れた回答欄のエラーを扱わない（旧データの移行など）', () => {
    const e = ev({ ...ready, ansTotal: 'abc' });
    assert.equal(e.status, STATUS.UNCONFIRMED);
    assert.deepEqual(e.errors, {});
  });

  test('日付の形式エラー・水量のエラーは入力エラー', () => {
    assert.equal(ev({ ...ready, start: '2026/02/30' }).status, STATUS.INPUT_ERROR);
    assert.equal(ev({ ...ready, usage: '-1' }).status, STATUS.INPUT_ERROR);
  });
});

describe('無償化の案内', () => {
  // 20mm・59m³：通常 16,100円、無償化した場合 13,526円（cases.json EX-free）
  const withAnswer = (total, base = ready, c = ctx) => answer(press(base, CONFIRM.MISMATCH, c), 'ansTotal', total, c);

  test('チェックOFF・25mm以下・［違う］の合計が無償化した場合の計算額と一致 → 案内を出す', () => {
    const e = ev(withAnswer('13526'));
    assert.equal(e.suggestBasicFree, true);
    assert.equal(e.status, STATUS.DIFF); // 判定は変えない
    assert.equal(e.values.basicFree, false); // 自動で適用しない
  });

  test('金額が違えば出さない', () => {
    assert.equal(ev(withAnswer('13500')).suggestBasicFree, false);
  });

  test('無償化のチェックがONなら出さない', () => {
    const e = ev(withAnswer('13526', { ...ready, basicFree: true }));
    assert.equal(e.status, STATUS.MATCH);
    assert.equal(e.suggestBasicFree, false);
  });

  test('口径30mm以上では出さない', () => {
    const c30 = { caliber: 30, taxRatePercent: 10 };
    assert.equal(ev(withAnswer('28442', ready, c30), c30).suggestBasicFree, false);
  });

  test('［一致］・未確認・再確認が必要では出さない', () => {
    assert.equal(ev(press(ready, CONFIRM.MATCH)).suggestBasicFree, false);
    assert.equal(ev(ready).suggestBasicFree, false);
    assert.equal(ev({ ...withAnswer('13526'), usage: '60' }).suggestBasicFree, false);
  });
});

describe('契約1の期間の自動コピー', () => {
  const src = { ...emptyRow(), start: '2026/08/20', end: '2026/10/20' };

  test('ほかの契約の空欄にだけコピーし、入力済みの値は上書きしない', () => {
    const rows = {
      C001: src,
      C002: { ...emptyRow() },
      C003: { ...emptyRow(), start: '2026/08/10', end: '' },
      C004: { ...emptyRow(), start: '2026/08/11', end: '2026/10/11' },
    };
    const r = fillBlankPeriods(rows, 'C001', ['C002', 'C003', 'C004', 'C005']);
    assert.deepEqual([r.rows.C002.start, r.rows.C002.end], ['2026/08/20', '2026/10/20']);
    assert.deepEqual([r.rows.C003.start, r.rows.C003.end], ['2026/08/10', '2026/10/20']);
    assert.deepEqual([r.rows.C004.start, r.rows.C004.end], ['2026/08/11', '2026/10/11']);
    assert.deepEqual([r.rows.C005.start, r.rows.C005.end], ['2026/08/20', '2026/10/20']); // 行が無い契約も作る
    assert.deepEqual(r.filled, ['C002', 'C003', 'C005']);
    assert.equal(rows.C002.start, ''); // 元のオブジェクトは変えない
  });

  test('契約1の値は全角や8桁でも、整えた形でコピーする', () => {
    const r = fillBlankPeriods({ C001: { ...src, start: '２０２６０８２０' } }, 'C001', ['C002']);
    assert.equal(r.rows.C002.start, '2026/08/20');
  });

  for (const [name, change] of [
    ['開始日が未入力', { start: '' }],
    ['終了日が入力途中', { end: '2026/10' }],
    ['存在しない日付', { end: '2026/02/30' }],
    ['終了日が開始日以前', { end: '2026/08/20' }],
  ]) {
    test(`${name}ならコピーしない`, () => {
      const r = fillBlankPeriods({ C001: { ...src, ...change }, C002: emptyRow() }, 'C001', ['C002']);
      assert.deepEqual(r.filled, []);
      assert.equal(r.rows.C002.start, '');
    });
  }
});

describe('建物合計の水道・下水道の判定（表示）', () => {
  const matched = ev(press(ready, CONFIRM.MATCH));
  const unconfirmed = ev(ready);
  const breakdownDiff = ev(answer(answer(answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16100'), 'ansWater', '9048'), 'ansSewer', '7052'));

  test('全契約が合計で照合なら「—（合計で照合）」', () => {
    assert.equal(buildingPartJudge([matched, matched, null], 'water'), TOTAL_ONLY);
  });
  test('「—」を除いて優先順位で決める', () => {
    assert.equal(buildingPartJudge([matched, unconfirmed], 'water'), JUDGE.BLANK);
    assert.equal(buildingPartJudge([matched, breakdownDiff], 'sewer'), JUDGE.DIFF);
  });
  test('入力エラーは「未入力」として扱う', () => {
    assert.equal(buildingPartJudge([matched, ev({ ...ready, usage: 'x' })], 'water'), JUDGE.BLANK);
  });
  test('契約が無ければ null', () => {
    assert.equal(buildingPartJudge([null], 'water'), null);
  });
});

describe('PDFファイル名（入力欄の日付から）', () => {
  const row = (start, end) => ({ ...emptyRow(), start, end });

  test('入力欄の文字（スラッシュ・8桁・全角）からファイル名を作る', () => {
    const r = pdfFilenameForRows('V001', [
      row('2026/08/20', '2026/10/20'), row('20260820', '20261020'), row('２０２６/08/20', '2026/10/20'),
    ]);
    assert.deepEqual(r, { ok: true, filename: 'V001水道20260820-1020（3件）.pdf' });
  });

  test('期間が空欄の契約は件数に含めない', () => {
    assert.equal(pdfFilenameForRows('V001', [row('2026/08/20', '2026/10/20'), row('', '')]).filename, 'V001水道20260820-1020.pdf');
  });

  test('作れないときは理由を返す', () => {
    assert.deepEqual(pdfFilenameForRows('', [row('2026/08/20', '2026/10/20')]), { ok: false, reason: '物件番号を選択してください' });
    assert.deepEqual(pdfFilenameForRows('V001', [row('', '')]), { ok: false, reason: '今回の期間を入力してください' });
    assert.deepEqual(pdfFilenameForRows('V001', [row('2026/08/20', '')]), { ok: false, reason: '開始日・終了日の両方を入力してください' });
    assert.deepEqual(pdfFilenameForRows('V001', [row('2026/02/30', '2026/10/20')]), { ok: false, reason: '日付の形式が正しくない契約があります' });
    assert.deepEqual(pdfFilenameForRows('V001', [row('2026/08/20', '2026/08/01')]), { ok: false, reason: '終了日が開始日以前の契約があります' });
  });
});

describe('保存済みの行の正規化（移行）', () => {
  test('旧データの回答金額は保持し、確認状態は推定しない（未確認）', () => {
    const row = normalizeRow({ start: '2026-08-20', end: '2026-10-20', usage: 59, ansTotal: 16100, ansWater: null });
    assert.equal(row.confirm, null);
    assert.equal(row.ansTotal, '16100');
    assert.equal(row.ansWater, '');
    assert.equal(row.usage, '59');
    assert.equal(row.start, '2026/08/20');
    assert.equal(ev(row).status, STATUS.UNCONFIRMED);
  });

  test('形の正しくない確認状態は捨てる', () => {
    assert.equal(normalizeRow({ confirm: { state: 'ok' } }).confirm, null);
    assert.equal(normalizeRow({ confirm: { state: 'stale', basis: '[]' } }).confirm, null);
    assert.equal(normalizeRow({ confirm: { state: 'match', basis: '[]' } }).confirm.state, CONFIRM.MATCH);
  });
});

describe('印刷：内訳の回答・差額の行を出すか', () => {
  test('合計で照合しただけ・未確認なら false', () => {
    const matched = press(ready, CONFIRM.MATCH);
    assert.equal(hasPartAnswers([ev(matched), ev(ready), null]), false);
    const totalOnly = answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16200');
    assert.equal(hasPartAnswers([ev(totalOnly)]), false);
  });

  test('［違う］で水道か下水道を入力した契約が1件でもあれば true', () => {
    const base = answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16100');
    assert.equal(hasPartAnswers([ev(ready), ev(answer(base, 'ansWater', '9048'))]), true);
    assert.equal(hasPartAnswers([ev(answer(base, 'ansSewer', '7052'))]), true);
  });

  test('入力エラーの契約の回答は数えない', () => {
    const base = answer(answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16100'), 'ansWater', '9048');
    assert.equal(hasPartAnswers([ev({ ...base, usage: 'abc' })]), false);
  });
});

describe('確認が済んでいない契約（PDF保存の横の注意）', () => {
  test('未確認・再確認が必要・入力エラー・期間エラーを契約の順に返す', () => {
    const matched = press(ready, CONFIRM.MATCH);
    const stale = { ...matched, usage: '60' };
    const rows = [matched, ready, stale, { ...ready, usage: 'abc' }, { ...ready, end: '2026/08/01' }];
    const titles = ['1-5F分', '共用栓', '受水槽', '散水栓', '店舗'];
    assert.deepEqual(pendingContracts(titles, rows.map(r => ev(r))), [
      { title: '共用栓', status: STATUS.UNCONFIRMED },
      { title: '受水槽', status: STATUS.STALE },
      { title: '散水栓', status: STATUS.INPUT_ERROR },
      { title: '店舗', status: STATUS.PERIOD },
    ]);
  });

  test('一致・差異ありは確認済みとして含めない。何も入力していない契約は未確認', () => {
    const diff = answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16200');
    assert.equal(ev(diff).status, STATUS.DIFF);
    assert.deepEqual(pendingContracts(['A', 'B', 'C'], [ev(press(ready, CONFIRM.MATCH)), ev(diff), ev(emptyRow())]),
      [{ title: 'C', status: STATUS.UNCONFIRMED }]);
  });
});

describe('基本料金無償化の入力欄を表示しない設定', () => {
  test('無償化のチェックをすべて外し、外した契約IDを返す（ほかの入力は変えない）', () => {
    const rows = { C001: { ...ready, basicFree: true }, C002: { ...ready }, C003: { ...ready, basicFree: true, usage: '10' } };
    const r = clearBasicFreeChecks(rows);
    assert.deepEqual(r.changed, ['C001', 'C003']);
    assert.equal(Object.values(r.rows).some(row => row.basicFree), false);
    assert.equal(r.rows.C003.usage, '10');
    assert.equal(rows.C001.basicFree, true); // 元の行は変えない
  });

  test('チェックが無ければ同じ rows を返す', () => {
    const rows = { C001: { ...ready } };
    const r = clearBasicFreeChecks(rows);
    assert.equal(r.rows, rows);
    assert.deepEqual(r.changed, []);
  });

  test('無償化して［一致］した契約は、チェックを外すと「再確認が必要」になる', () => {
    const matched = press({ ...ready, basicFree: true }, CONFIRM.MATCH);
    const { rows } = clearBasicFreeChecks({ C001: matched });
    assert.equal(ev(rows.C001).status, STATUS.STALE);
  });
});

describe('W：内訳（水道・下水道）も一致を確認した', () => {
  const matched = press(ready, CONFIRM.MATCH);
  const check = (row, checked = true, c = ctx) => {
    const e = ev(row, c);
    return applyPartsConfirm(e.row, checked, e);
  };
  const both = check(matched);

  test('合計の［一致］だけでは内訳は未確認（水道・下水道は「合計で照合」）', () => {
    const e = ev(matched);
    assert.equal(matched.confirmParts, null);
    assert.equal(e.partsConfirmed, false);
    assert.equal(e.canConfirmParts, true);
    assert.equal(e.waterJudge, TOTAL_ONLY);
    assert.equal(e.sewerJudge, TOTAL_ONLY);
    assert.equal(e.method, METHOD.TOTAL);
  });

  test('チェックすると、合計の確認とは別に confirmParts を保存する', () => {
    assert.deepEqual(both.confirm, matched.confirm);
    assert.deepEqual(both.confirmParts, { basis: matched.confirm.basis });
    assert.equal(both.ansWater, ''); // 回答欄には何も記録しない
    assert.equal(both.ansSewer, '');
  });

  test('水道・下水道の判定は一致、総合判定は一致、照合方法は「内訳も照合」、差額は0', () => {
    const e = ev(both);
    assert.equal(e.partsConfirmed, true);
    assert.equal(e.status, STATUS.MATCH);
    assert.equal(e.entry.overall, JUDGE.MATCH);
    assert.equal(e.waterJudge, JUDGE.MATCH);
    assert.equal(e.sewerJudge, JUDGE.MATCH);
    assert.equal(e.method, METHOD.BREAKDOWN);
    assert.equal(e.entry.water.answer, e.entry.water.calc);
    assert.equal(e.entry.sewer.answer, e.entry.sewer.calc);
    assert.deepEqual([e.entry.water.diff, e.entry.sewer.diff, e.entry.total.diff], [0, 0, 0]);
  });

  test('判定は、計算額を内訳の回答として渡したときの judgeContract と同じ', () => {
    const e = ev(both);
    const direct = judgeContract({
      caliber: 20, taxRatePercent: 10, basicFree: false, start: '2026-08-20', end: '2026-10-20',
      usage: 59, ansTotal: 16100, ansWater: e.entry.water.calc, ansSewer: e.entry.sewer.calc,
    });
    assert.deepEqual(e.entry, direct);
  });

  test('表示の文言', () => {
    assert.equal(STATUS_PARTS_TEXT, '一致（内訳も確認）');
    assert.equal(PARTS_ANSWER_TEXT, '計算額どおり');
  });

  test('一致以外（未確認・違う・再確認が必要・入力エラー・期間エラー）ではチェックしても行が変わらない', () => {
    const stale = ev({ ...matched, usage: '60' }).row;
    const rows = [
      ready,
      press(ready, CONFIRM.MISMATCH),
      answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16100'), // ［違う］で同じ金額を入れても対象外
      stale,
      { ...ready, usage: 'abc' },
      { ...ready, end: '2026/08/01' },
    ];
    for (const row of rows) {
      const e = ev(row);
      assert.equal(e.canConfirmParts, row.confirm?.state === CONFIRM.MATCH && e.status === STATUS.MATCH);
      assert.equal(e.canConfirmParts, false);
      assert.deepEqual(check(row), e.row);
    }
  });

  test('チェックを外すと、合計の確認だけが残る', () => {
    const row = check(both, false);
    assert.equal(row.confirmParts, null);
    assert.deepEqual(row.confirm, both.confirm);
    const e = ev(row);
    assert.equal(e.status, STATUS.MATCH);
    assert.equal(e.method, METHOD.TOTAL);
  });

  const cases = [
    ['使用水量', { usage: '60' }, ctx],
    ['期間', { end: '2026/10/21' }, ctx],
    ['口径', {}, { caliber: 25, taxRatePercent: 10 }],
    ['消費税率', {}, { caliber: 20, taxRatePercent: 12 }],
  ];
  for (const [name, change, c] of cases) {
    test(`${name}が変わると「再確認が必要」になり、内訳の確認も消える`, () => {
      const e = ev({ ...both, ...change }, c);
      assert.equal(e.changed, true);
      assert.equal(e.status, STATUS.STALE);
      assert.equal(e.row.confirmParts, null);
      assert.equal(e.partsConfirmed, false);
      assert.equal(e.waterJudge, JUDGE.BLANK);
    });
  }

  test('再確認で［一致］を押し直しても、内訳は未確認のまま', () => {
    const stale = ev({ ...both, usage: '60' }).row;
    const row = press(stale, CONFIRM.MATCH);
    assert.equal(row.confirmParts, null);
    assert.equal(ev(row).method, METHOD.TOTAL);
  });

  test('同じ条件で［一致］を押し直しても、内訳の確認は残る', () => {
    const row = press(both, CONFIRM.MATCH);
    assert.deepEqual(row.confirmParts, both.confirmParts);
    assert.equal(ev(row).partsConfirmed, true);
  });

  test('［違う］を押すと内訳の確認が消え、［一致］に戻しても未確認のまま', () => {
    const mismatched = press(both, CONFIRM.MISMATCH);
    assert.equal(mismatched.confirmParts, null);
    assert.equal(mismatched.ansTotal, '');
    const back = press(mismatched, CONFIRM.MATCH);
    assert.equal(back.confirmParts, null);
  });

  test('入力をクリアすると内訳の確認も消える', () => {
    assert.equal(emptyRow().confirmParts, null);
  });

  test('保存データの移行：confirmParts がない旧データ・形の正しくない値は null', () => {
    assert.equal(normalizeRow(matched).confirmParts, null);
    assert.equal(normalizeRow({ ...matched, confirmParts: undefined }).confirmParts, null);
    assert.equal(normalizeRow({ ...matched, confirmParts: true }).confirmParts, null);
    assert.equal(normalizeRow({ ...matched, confirmParts: { basis: 1 } }).confirmParts, null);
    assert.equal(normalizeRow({ ...matched, confirmParts: { basis: 'other' } }).confirmParts, null);
    // 合計の確認が「一致」でなければ捨てる
    assert.equal(normalizeRow({ ...press(ready, CONFIRM.MISMATCH), confirmParts: { basis: matched.confirm.basis } }).confirmParts, null);
    assert.deepEqual(normalizeRow(both).confirmParts, both.confirmParts);
  });

  test('印刷：内訳も確認した契約があれば、回答・差額の行を出す', () => {
    assert.equal(hasPartAnswers([ev(matched)]), false);
    assert.equal(hasPartAnswers([ev(both)]), true);
  });

  test('建物合計：水道・下水道の判定は「合計で照合」以外の契約で決まる', () => {
    assert.equal(buildingPartJudge([ev(both), ev(matched)], 'water'), JUDGE.MATCH);
    assert.equal(buildingPartJudge([ev(matched), ev(matched)], 'sewer'), TOTAL_ONLY);
  });

  test('建物合計の「水道局の回答」は、回答のある契約がすべて内訳も確認した契約のときだけ「計算額どおり」', () => {
    let heard = press(ready, CONFIRM.MISMATCH);
    heard = answer(heard, 'ansTotal', '16100');
    heard = answer(heard, 'ansWater', '9048');
    heard = answer(heard, 'ansSewer', '7052');
    assert.equal(buildingPartsAnswerIsCalc([ev(both), ev(matched), null], 'water'), true);
    assert.equal(buildingPartsAnswerIsCalc([ev(both), ev(heard)], 'water'), false);
    assert.equal(buildingPartsAnswerIsCalc([ev(matched)], 'sewer'), false);
    assert.equal(buildingPartsAnswerIsCalc([], 'sewer'), false);
  });
});

describe('AF：水道＋下水道が水道局の合計と合わないときの警告（表示だけ）', () => {
  const opened = answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '21754');
  const withParts = (water, sewer, base = opened) => answer(answer(base, 'ansWater', water), 'ansSewer', sewer);

  test('両方入力して、合計と合わなければ { sum, total } を返す', () => {
    assert.deepEqual(breakdownSumMismatch(ev(withParts('12000', '9752'))), { sum: 21752, total: 21754 });
  });

  test('合っていれば出さない（カンマ・全角の入力も読む）', () => {
    assert.equal(breakdownSumMismatch(ev(withParts('12,000', '９７５４'))), null);
  });

  test('片方だけ・合計が空欄・入力エラーのときは出さない', () => {
    assert.equal(breakdownSumMismatch(ev(answer(opened, 'ansWater', '12000'))), null);
    assert.equal(breakdownSumMismatch(ev(answer(opened, 'ansSewer', '9752'))), null);
    assert.equal(breakdownSumMismatch(ev(withParts('12000', '9752', press(ready, CONFIRM.MISMATCH)))), null);
    assert.equal(breakdownSumMismatch(ev(withParts('12000', 'abc'))), null);
  });

  test('回答欄が開いていない（一致・未確認）ときは出さない', () => {
    assert.equal(breakdownSumMismatch(ev(press(ready, CONFIRM.MATCH))), null);
    assert.equal(breakdownSumMismatch(ev(ready)), null);
  });

  test('判定の結果は変えない（judgeContract に同じ値を渡した結果と同じ）', () => {
    const e = ev(withParts('12000', '9752'));
    const direct = judgeContract({
      caliber: 20, taxRatePercent: 10, basicFree: false, start: '2026-08-20', end: '2026-10-20',
      usage: 59, ansTotal: 21754, ansWater: 12000, ansSewer: 9752,
    });
    assert.deepEqual(e.entry, direct);
  });
});

describe('建物合計：内訳を確かめた契約が一部だけのとき（案2。表示だけ）', () => {
  const matched = press(ready, CONFIRM.MATCH);
  const both = (() => { const e = ev(matched); return applyPartsConfirm(e.row, true, e); })();
  const heard = (water, sewer) => {
    let row = answer(press(ready, CONFIRM.MISMATCH), 'ansTotal', '16100');
    if (water !== undefined) row = answer(row, 'ansWater', water);
    if (sewer !== undefined) row = answer(row, 'ansSewer', sewer);
    return row;
  };
  // 内訳の計算額（［違う］で同じ額を聞いた場合に使う）
  const waterCalc = String(evaluateRow({ row: both, ...ctx }).entry.water.calc);
  const sewerCalc = String(evaluateRow({ row: both, ...ctx }).entry.sewer.calc);

  test('範囲の判定：全契約・一部・なし', () => {
    assert.equal(buildingPartScope([ev(both), ev(both)], 'water'), 'all');
    assert.equal(buildingPartScope([ev(both), ev(matched), null], 'water'), 'partial');
    assert.equal(buildingPartScope([ev(matched), ev(matched)], 'sewer'), 'none');
    assert.equal(buildingPartScope([ev(heard(waterCalc, sewerCalc)), ev(matched)], 'sewer'), 'partial');
    assert.equal(buildingPartScope([], 'water'), 'none');
  });

  test('水道だけ聞いた契約があれば、水道は一部・下水道は合計で照合だけ', () => {
    const evs = [ev(heard(waterCalc)), ev(matched)];
    assert.equal(buildingPartScope(evs, 'water'), 'partial');
    assert.equal(buildingPartScope(evs, 'sewer'), 'none');
  });

  test('V003で1件だけチェック：判定は「一致」ではなく「一部のみ」', () => {
    const evs = [ev(both), ev(matched), ev(matched), ev(matched), ev(matched)];
    assert.equal(buildingPartJudge(evs, 'water'), JUDGE.MATCH); // 元の判定は変えない
    assert.equal(buildingPartJudgeShown(evs, 'water'), BUILDING_PARTIAL);
    assert.equal(buildingPartJudgeShown(evs, 'sewer'), BUILDING_PARTIAL);
  });

  test('確かめた契約に差異があれば「差異あり」のまま', () => {
    const diff = ev(heard('9000', String(16100 - 9000)));
    assert.equal(diff.waterJudge, JUDGE.DIFF);
    assert.equal(buildingPartJudgeShown([diff, ev(matched)], 'water'), JUDGE.DIFF);
  });

  test('未確認の契約があれば「未入力」のまま', () => {
    assert.equal(buildingPartJudgeShown([ev(both), ev(matched), ev(ready)], 'water'), JUDGE.BLANK);
  });

  test('全契約で内訳を確かめたとき・全契約が合計で照合のときは、これまでどおり', () => {
    assert.equal(buildingPartJudgeShown([ev(both), ev(both)], 'water'), JUDGE.MATCH);
    assert.equal(buildingPartJudgeShown([ev(matched), ev(matched)], 'water'), TOTAL_ONLY);
  });

  test('文言は「一部のみ」（4文字）', () => {
    assert.equal(BUILDING_PARTIAL, '一部のみ');
  });
});
