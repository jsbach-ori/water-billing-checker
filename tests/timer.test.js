// js/timer.js の追加テスト（38件とは別に数える）。現在時刻は固定値を渡す
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE, startTimer, normalizeTimer, elapsedSeconds, phoneSecondsOf, isPhoneActive, togglePhone,
  finishTimer, manualLog, normalizeLogs, summarizeLogs, formatClock, formatDuration, formatDateTime,
  csvCell, toCsv, csvFilename, CSV_HEADERS,
} from '../js/timer.js';

const T0 = new Date('2026-10-31T05:00:00.000Z');
const at = sec => new Date(T0.getTime() + sec * 1000);

describe('タイマー：開始・経過・終了', () => {
  test('開始すると物件と開始時刻を持つ。電話時間は未使用（null）', () => {
    assert.deepEqual(startTimer('V001', T0), {
      buildingId: 'V001', startedAt: '2026-10-31T05:00:00.000Z', phoneStartedAt: null, phoneSeconds: null,
    });
  });

  test('経過時間は開始時刻から計算する（リロードしても続く）', () => {
    const t = startTimer('V001', T0);
    const reloaded = normalizeTimer(JSON.parse(JSON.stringify(t)));
    assert.equal(elapsedSeconds(reloaded, at(312)), 312);
    assert.equal(elapsedSeconds(reloaded, at(-5)), 0); // 時計が戻っても負にしない
  });

  test('終了すると記録を作る（契約数は渡した値）', () => {
    const log = finishTimer(startTimer('V003', T0), at(312), { id: 'L1', contractCount: 5 });
    assert.deepEqual(log, {
      id: 'L1', mode: MODE.TOOL, buildingId: 'V003', contractCount: 5,
      startedAt: '2026-10-31T05:00:00.000Z', endedAt: '2026-10-31T05:05:12.000Z',
      seconds: 312, phoneSeconds: null, note: '',
    });
  });

  test('保存データが壊れていれば計測していない扱い（null）', () => {
    assert.equal(normalizeTimer(null), null);
    assert.equal(normalizeTimer({ buildingId: 'V001', startedAt: 'abc' }), null);
    assert.equal(normalizeTimer({ startedAt: T0.toISOString() }), null);
    assert.equal(normalizeTimer('x'), null);
  });
});

describe('タイマー：電話時間', () => {
  test('電話中の時間を累計する', () => {
    let t = startTimer('V001', T0);
    t = togglePhone(t, at(10));          // 電話開始
    assert.equal(isPhoneActive(t), true);
    assert.equal(phoneSecondsOf(t, at(40)), 30);
    t = togglePhone(t, at(70));          // 通話終了（60秒）
    assert.equal(isPhoneActive(t), false);
    t = togglePhone(t, at(100));         // 2回目
    t = togglePhone(t, at(130));         // 30秒
    assert.equal(phoneSecondsOf(t, at(500)), 90);
  });

  test('電話中のまま終了すると、その時点までを電話時間に加える', () => {
    let t = togglePhone(startTimer('V001', T0), at(10));
    t = normalizeTimer(JSON.parse(JSON.stringify(t))); // リロードしても続く
    const log = finishTimer(t, at(100), { id: 'L1', contractCount: 3 });
    assert.equal(log.phoneSeconds, 90);
    assert.equal(log.seconds, 100);
  });

  test('電話ボタンを使わなければ電話時間は null', () => {
    assert.equal(phoneSecondsOf(startTimer('V001', T0), at(100)), null);
  });
});

describe('手作業の記録', () => {
  test('分を秒にして記録する', () => {
    assert.deepEqual(manualLog({ id: 'M1', date: '2026-10-30', buildingId: 'V001', contractCount: 3, minutes: 25, phoneMinutes: 10, note: 'メモ' }), {
      id: 'M1', mode: MODE.MANUAL, buildingId: 'V001', contractCount: 3,
      startedAt: '2026-10-30', endedAt: null, seconds: 1500, phoneSeconds: 600, note: 'メモ',
    });
    assert.equal(manualLog({ id: 'M2', date: '2026-10-30', buildingId: 'V001', contractCount: 1, minutes: 5 }).phoneSeconds, null);
  });

  test('保存データのうち形の正しい記録だけを残す', () => {
    const ok = manualLog({ id: 'M1', date: '2026-10-30', buildingId: 'V001', contractCount: 3, minutes: 25 });
    assert.deepEqual(normalizeLogs([ok, { mode: 'x' }, null, { ...ok, seconds: -1 }]), [ok]);
    assert.deepEqual(normalizeLogs('壊れたデータ'), []);
  });
});

describe('集計（平均・1契約あたり・削減率）', () => {
  const log = (mode, seconds, contractCount) => ({ id: `${mode}${seconds}`, mode, buildingId: 'V001', contractCount, startedAt: '2026-10-30', seconds, phoneSeconds: null, note: '' });
  const logs = [
    log(MODE.MANUAL, 1800, 3), // 30分・3契約
    log(MODE.MANUAL, 600, 1),  // 10分・1契約
    log(MODE.TOOL, 360, 3),    // 6分・3契約
    log(MODE.TOOL, 240, 1),    // 4分・1契約
  ];

  test('方式ごとの件数・平均時間・1契約あたり（合計 ÷ 契約数の合計）', () => {
    const s = summarizeLogs(logs);
    assert.deepEqual(s.manual, { count: 2, avgSeconds: 1200, perContractSeconds: 600 });
    assert.deepEqual(s.tool, { count: 2, avgSeconds: 300, perContractSeconds: 150 });
  });

  test('改善前後の差と削減率（1契約あたり）', () => {
    const s = summarizeLogs(logs);
    assert.equal(s.diffPerContractSeconds, 450);
    assert.equal(s.reductionRate, 0.75);
  });

  test('片方しか無ければ差と削減率は null', () => {
    const s = summarizeLogs(logs.filter(l => l.mode === MODE.TOOL));
    assert.equal(s.manual.count, 0);
    assert.equal(s.diffPerContractSeconds, null);
    assert.equal(s.reductionRate, null);
  });

  test('記録が無ければすべて空', () => {
    const s = summarizeLogs([]);
    assert.deepEqual(s.tool, { count: 0, avgSeconds: null, perContractSeconds: null });
    assert.equal(s.reductionRate, null);
  });

  test('契約数0の記録だけなら1契約あたりは null（0で割らない）', () => {
    assert.equal(summarizeLogs([log(MODE.TOOL, 60, 0)]).tool.perContractSeconds, null);
  });
});

describe('表示', () => {
  test('時計表示', () => {
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(205), '03:25');
    assert.equal(formatClock(3723), '1:02:03');
  });
  test('所要時間の文章表示', () => {
    assert.equal(formatDuration(312), '5分12秒');
    assert.equal(formatDuration(45), '45秒');
    assert.equal(formatDuration(3723), '1時間2分3秒');
    assert.equal(formatDuration(null), '');
  });
  test('日時の表示（ローカル時刻）と日付だけの値', () => {
    const local = new Date(2026, 9, 31, 14, 5, 12);
    assert.equal(formatDateTime(local.toISOString()), '2026/10/31 14:05:12');
    assert.equal(formatDateTime('2026-10-30'), '2026/10/30');
    assert.equal(formatDateTime(null), '');
  });
});

describe('CSV出力', () => {
  const buildings = [{ id: 'V001', name: 'サンプルハイツ' }];
  const started = new Date(2026, 9, 31, 14, 0, 0).toISOString();
  const ended = new Date(2026, 9, 31, 14, 5, 12).toISOString();
  const logs = [
    { id: 'L1', mode: MODE.TOOL, buildingId: 'V001', contractCount: 3, startedAt: started, endedAt: ended, seconds: 312, phoneSeconds: 90, note: '' },
    { id: 'M1', mode: MODE.MANUAL, buildingId: 'V001', contractCount: 3, startedAt: '2026-10-30', endedAt: null, seconds: 1500, phoneSeconds: null, note: '電話が混雑, "再"照会\n2回目' },
  ];
  const csv = toCsv(logs, buildings);

  test('先頭にBOM（UTF-8）を付け、行は CRLF で区切る', () => {
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    assert.equal(Buffer.from(csv, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf');
    assert.ok(csv.endsWith('\r\n'));
  });

  test('日本語の列名', () => {
    assert.equal(csv.slice(1).split('\r\n')[0], CSV_HEADERS.join(','));
    assert.equal(CSV_HEADERS[0], '方式');
  });

  test('ツールの記録の行', () => {
    assert.equal(csv.slice(1).split('\r\n')[1], 'ツール,V001,サンプルハイツ,3,2026/10/31 14:00:00,2026/10/31 14:05:12,312,5.2,90,');
  });

  test('マスタから削除された物件の物件名は「（削除済み）」', () => {
    const line = toCsv([{ ...logs[0], buildingId: 'V999' }], buildings).slice(1).split('\r\n')[1];
    assert.equal(line.split(',').slice(1, 3).join(','), 'V999,（削除済み）');
  });

  test('カンマ・引用符・改行を含むメモは "" でくくる', () => {
    assert.ok(csv.includes('手作業,V001,サンプルハイツ,3,2026/10/30,,1500,25,,"電話が混雑, ""再""照会\n2回目"\r\n'));
  });

  test('セルの規則', () => {
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(0), '0');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)"); // 数式として扱われないようにする
  });

  test('ファイル名', () => {
    assert.equal(csvFilename(new Date(2026, 9, 31, 9, 0, 0)), '作業時間_20261031.csv');
  });
});
