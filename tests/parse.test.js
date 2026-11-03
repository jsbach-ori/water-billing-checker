// 入力値の変換（js/parse.js）の追加テスト（38件とは別に数える）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntegerInput, parseDateText, formatDate, normalizeDateText, parseRow } from '../js/parse.js';
import { judgeContract, sumBuilding, JUDGE } from '../js/calc.js';

const ok = value => ({ ok: true, value });

describe('parseIntegerInput：受け付ける値', () => {
  test('半角の整数', () => assert.deepEqual(parseIntegerInput('9038'), ok(9038)));
  test('3桁区切りのカンマ', () => assert.deepEqual(parseIntegerInput('9,038'), ok(9038)));
  test('大きな値のカンマ区切り', () => assert.deepEqual(parseIntegerInput('1,206,854'), ok(1206854)));
  test('全角数字', () => assert.deepEqual(parseIntegerInput('９０３８'), ok(9038)));
  test('全角数字＋全角カンマ', () => assert.deepEqual(parseIntegerInput('９，０３８'), ok(9038)));
  test('前後の空白（全角を含む）', () => assert.deepEqual(parseIntegerInput(' 59　'), ok(59)));
  test('0は有効な入力', () => assert.deepEqual(parseIntegerInput('0'), ok(0)));
  test('空欄・空白だけ・null は null', () => {
    assert.deepEqual(parseIntegerInput(''), ok(null));
    assert.deepEqual(parseIntegerInput('   '), ok(null));
    assert.deepEqual(parseIntegerInput(null), ok(null));
  });
});

describe('parseIntegerInput：エラーにする値', () => {
  const isError = (text, message) => {
    const r = parseIntegerInput(text);
    assert.equal(r.ok, false, `${text} はエラーになるべき`);
    if (message) assert.equal(r.error, message);
  };
  test('負の数（半角・全角）', () => {
    isError('-5', '0以上で入力してください');
    isError('－５', '0以上で入力してください');
    isError('−5', '0以上で入力してください');
  });
  test('小数', () => isError('59.5', '整数で入力してください'));
  test('数字以外', () => {
    isError('abc', '整数で入力してください');
    isError('59m3', '整数で入力してください');
    isError('1e3', '整数で入力してください');
  });
  test('カンマの位置が正しくない', () => {
    isError('9,03');
    isError('1,2345');
    isError(',903');
  });
  test('安全な整数の範囲を超える', () => isError('99999999999999999', '数値が大きすぎます'));
});

describe('parseDateText（日付の文字入力）', () => {
  test('受け付ける形式はすべて YYYY-MM-DD に変換する', () => {
    for (const text of ['2026/08/20', '2026-08-20', '2026.08.20', '20260820', '2026/8/20', '２０２６／０８／２０', '２０２６０８２０', ' 2026/08/20 ']) {
      assert.deepEqual(parseDateText(text), ok('2026-08-20'), text);
    }
    assert.deepEqual(parseDateText('2026/1/5'), ok('2026-01-05'));
  });
  test('空欄は null', () => {
    assert.deepEqual(parseDateText(''), ok(null));
    assert.deepEqual(parseDateText('  '), ok(null));
  });
  test('存在しない日付はエラー', () => {
    for (const text of ['2026/02/30', '2026/13/01', '2026/00/10', '20260230']) {
      assert.deepEqual(parseDateText(text), { ok: false, error: '存在しない日付です' }, text);
    }
  });
  test('読めない形式はエラー', () => {
    for (const text of ['2026/8', '26/08/20', '2026082', '202608201', 'abc', '2026年8月20日', '2026/08/20/1']) {
      assert.deepEqual(parseDateText(text), { ok: false, error: '2026/08/20 の形式で入力してください' }, text);
    }
  });
  test('表示用の形式（YYYY/MM/DD）', () => {
    assert.equal(formatDate('2026-08-20'), '2026/08/20');
    assert.equal(formatDate(null), '');
    assert.equal(normalizeDateText('2026/8/5'), '2026/08/05');
    assert.equal(normalizeDateText('２０２６０８２０'), '2026/08/20');
    assert.equal(normalizeDateText('2026/02/30'), '2026/02/30'); // エラーの入力はそのまま残す
    assert.equal(normalizeDateText(''), '');
  });
  test('parseRow は文字入力の日付を YYYY-MM-DD で渡す', () => {
    const r = parseRow({ start: '2026/8/20', end: '20261020', usage: '59' });
    assert.equal(r.values.start, '2026-08-20');
    assert.equal(r.values.end, '2026-10-20');
    assert.equal(r.hasError, false);
  });
});

describe('parseRow と計算の連携', () => {
  const raw = { start: '2026-08-20', end: '2026-10-20', usage: '59', basicFree: false, ansWater: '9038', ansSewer: '7062', ansTotal: '' };

  test('文字列 "9038" と "7062" は連結されず、合計の回答は 16100', () => {
    const { values, hasError } = parseRow(raw);
    assert.equal(hasError, false);
    const r = judgeContract({ caliber: 20, taxRatePercent: 10, ...values });
    assert.equal(r.total.answer, 16100);
    assert.equal(r.overall, JUDGE.MATCH);
  });

  test('全角・カンマ付きでも同じ結果', () => {
    const { values } = parseRow({ ...raw, usage: '５９', ansWater: '9,038', ansSewer: '７，０６２', ansTotal: '16,100' });
    const r = judgeContract({ caliber: 20, taxRatePercent: 10, ...values });
    assert.deepEqual([r.water.judge, r.sewer.judge, r.overall], [JUDGE.MATCH, JUDGE.MATCH, JUDGE.MATCH]);
  });

  test('エラーの欄は errors に入り、値には入らない', () => {
    const r = parseRow({ ...raw, usage: '-5', ansWater: 'abc' });
    assert.equal(r.hasError, true);
    assert.deepEqual(Object.keys(r.errors).sort(), ['ansWater', 'usage']);
    assert.equal('usage' in r.values, false);
  });

  test('入力エラーの契約は、建物合計の判定で「未入力」として扱う', () => {
    const good = judgeContract({ caliber: 20, taxRatePercent: 10, ...parseRow(raw).values });
    const total = sumBuilding([good, { inputError: true }, null]);
    assert.equal(total.overall, JUDGE.BLANK);
    assert.equal(total.water.judge, JUDGE.BLANK);
    assert.equal(total.total.calc, 16100); // 入力エラーの契約は金額に含めない
  });
});
