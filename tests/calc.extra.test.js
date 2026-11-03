// cases.json に期待値のない部分の追加テスト（38件とは別に数える）
// 期待値はSPECとExcel版の数式から決めている
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  JUDGE, withTax, splitUsage, waterBasic, calcBimonthly, calcProrated,
  daysBetween, daysInMonth, judgeContract, judgeBuilding, sumBuilding, buildPdfFilename,
} from '../js/calc.js';

const base = {
  caliber: 20, basicFree: false, taxRatePercent: 10,
  start: '2026-08-20', end: '2026-10-20', usage: 59,
  ansWater: 9038, ansSewer: 7062, ansTotal: 16100,
};

describe('基本の計算', () => {
  test('税込は整数演算（×1.1の誤差が出ない）', () => {
    assert.equal(withTax(1959, 10), 2154);
    assert.equal(withTax(8217, 10), 9038);
    assert.equal(withTax(100, 10), 110); // 100 * 1.1 = 110.00000000000001
  });

  test('水量の分割：奇数は1か月目に1m³多く', () => {
    assert.deepEqual(splitUsage(59), [30, 29]);
    assert.deepEqual(splitUsage(1), [1, 0]);
  });

  test('口径300mm以上は300mmの基本料金', () => {
    assert.equal(waterBasic(350), 816145);
  });

  test('未対応の口径・不正な水量はエラー', () => {
    assert.throws(() => waterBasic(35), RangeError);
    assert.throws(() => calcBimonthly({ caliber: 20, usage: -1, taxRatePercent: 10 }), RangeError);
    assert.throws(() => calcBimonthly({ caliber: 20, usage: 1.5, taxRatePercent: 10 }), RangeError);
  });

  test('月別の内訳を返す', () => {
    const r = calcBimonthly({ caliber: 20, usage: 59, taxRatePercent: 10 });
    assert.deepEqual(r.monthly[0], { usage: 30, waterBase: 1170, waterMetered: 3020, sewerBase: 560, sewerMetered: 2720 });
    assert.deepEqual(r.monthly[1], { usage: 29, waterBase: 1170, waterMetered: 2857, sewerBase: 560, sewerMetered: 2580 });
  });

  test('日割り：使用日数0の月は0円', () => {
    const r = calcProrated({ caliber: 20, daysInMonth: 30, daysUsed: 0, usage: 0, taxRatePercent: 10 });
    assert.equal(r.total, 0);
  });
});

describe('日付', () => {
  test('日数は 終了日 − 開始日', () => {
    assert.equal(daysBetween('2026-08-20', '2026-10-20'), 61);
    assert.equal(daysBetween('2026-08-20', null), null);
    assert.equal(daysBetween('2026-02-30', '2026-03-01'), null);
  });

  test('暦日数', () => {
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2028, 2), 29);
    assert.equal(daysInMonth(2026, 10), 31);
  });
});

describe('契約の判定', () => {
  test('口径が未設定なら null（列を空欄にする）', () => {
    assert.equal(judgeContract({ ...base, caliber: null }), null);
  });

  test('差額は 回答 − 計算', () => {
    const r = judgeContract({ ...base, ansWater: 9048, ansSewer: 7052 });
    assert.equal(r.water.diff, 10);
    assert.equal(r.sewer.diff, -10);
    assert.equal(r.total.diff, 0);
  });

  test('使用水量が未入力なら計算結果も空欄', () => {
    const r = judgeContract({ ...base, usage: null });
    assert.equal(r.result, null);
    assert.equal(r.total.calc, null);
    assert.equal(r.total.diff, null);
  });

  test('合計の回答が無ければ 水道＋下水道 を使う', () => {
    const r = judgeContract({ ...base, ansTotal: null });
    assert.equal(r.total.answer, 16100);
    assert.equal(r.overall, JUDGE.MATCH);
  });

  test('終了日 = 開始日 は期間エラー', () => {
    const r = judgeContract({ ...base, end: '2026-08-20' });
    assert.equal(r.overall, JUDGE.PERIOD);
  });

  test('期間エラーでも使用水量があれば計算結果は出す', () => {
    const r = judgeContract({ ...base, end: '2026-08-01' });
    assert.equal(r.overall, JUDGE.PERIOD);
    assert.equal(r.water.calc, 9038);
    assert.equal(r.total.calc, 16100);
  });
});

describe('建物合計の金額（sumBuilding）', () => {
  const a = judgeContract(base);                                                   // 9038 / 7062
  const b = judgeContract({ ...base, caliber: 13, usage: 20, ansWater: 2134, ansSewer: 1716, ansTotal: null });
  const noAnswer = judgeContract({ ...base, ansWater: null, ansSewer: null, ansTotal: null });

  test('計算結果・回答・内訳を契約ごとに合計する', () => {
    const t = sumBuilding([a, b, null]);
    assert.equal(t.water.base, 2340 + 1720);
    assert.equal(t.water.calc, 9038 + 2134);
    assert.equal(t.sewer.answer, 7062 + 1716);
    assert.equal(t.total.calc, 16100 + 3850);
    assert.equal(t.total.answer, 16100 + 3850);
    assert.equal(t.total.diff, 0);
    assert.equal(t.overall, JUDGE.MATCH);
  });

  test('回答が1件も無ければ回答と差額は空欄（null）', () => {
    const t = sumBuilding([noAnswer]);
    assert.equal(t.water.answer, null);
    assert.equal(t.water.diff, null);
    assert.equal(t.water.calc, 9038);
  });

  test('差額は差額の出ている契約だけを合計する', () => {
    const diff = judgeContract({ ...base, ansWater: 9048, ansSewer: 7052 });
    const t = sumBuilding([diff, noAnswer]);
    assert.equal(t.water.diff, 10);
    assert.equal(t.sewer.diff, -10);
    assert.equal(t.overall, JUDGE.DIFF);
  });

  test('水道・下水道の判定も優先順位で決める', () => {
    const t = sumBuilding([a, judgeContract({ ...base, ansSewer: null })]);
    assert.equal(t.water.judge, JUDGE.MATCH);
    assert.equal(t.sewer.judge, JUDGE.BLANK);
  });

  test('契約が無ければ null', () => {
    assert.equal(sumBuilding([null, null]), null);
  });
});

describe('建物合計の判定', () => {
  const { MATCH, DIFF, BLANK, PERIOD } = JUDGE;
  test('優先順位：期間エラー → 差異あり → 未入力 → 一致', () => {
    assert.equal(judgeBuilding([MATCH, DIFF, BLANK, PERIOD]), PERIOD);
    assert.equal(judgeBuilding([MATCH, BLANK, DIFF]), DIFF);
    assert.equal(judgeBuilding([MATCH, BLANK]), BLANK);
    assert.equal(judgeBuilding([MATCH, MATCH]), MATCH);
  });

  test('契約なし（null）は無視する', () => {
    assert.equal(judgeBuilding([MATCH, null, null]), MATCH);
    assert.equal(judgeBuilding([null, null]), null);
  });
});

describe('PDFファイル名：生成しない理由', () => {
  const ok = { start: '2026-08-20', end: '2026-10-20' };
  test('物件が未選択', () => {
    assert.deepEqual(buildPdfFilename('', [ok]), { ok: false, reason: '物件番号を選択してください' });
  });
  test('期間がどの契約にも無い', () => {
    assert.deepEqual(buildPdfFilename('V001', [{ start: null, end: null }]), { ok: false, reason: '今回の期間を入力してください' });
  });
  test('片方だけ入った契約がある', () => {
    assert.deepEqual(buildPdfFilename('V001', [ok, { start: null, end: '2026-10-20' }]), { ok: false, reason: '開始日・終了日の両方を入力してください' });
  });
  test('終了日 <= 開始日 の契約がある', () => {
    assert.deepEqual(buildPdfFilename('V001', [ok, { start: '2026-08-20', end: '2026-08-01' }]), { ok: false, reason: '終了日が開始日以前の契約があります' });
  });
  test('同じ開始日なら契約の順番で最初のもの', () => {
    const r = buildPdfFilename('V001', [ok, { start: '2026-08-20', end: '2026-10-19' }]);
    assert.equal(r.filename, 'V001水道20260820-1020（2件）.pdf');
  });
});
