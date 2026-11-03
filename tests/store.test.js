// store.js の追加テスト（38件とは別に数える）。localStorage はメモリ上の代用品に差し替える
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadMaster, saveMaster, loadInquiry, saveInquiry, newContractId, emptyRow, hasInquiryInput,
  loadTimer, saveTimer, loadTimelogs, saveTimelogs, newLogId,
} from '../js/store.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
  };
}

describe('store：契約IDと照会入力', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true, writable: true });
  });

  test('保存が無ければ初期データ（3建物・9契約、IDは一意）', () => {
    const m = loadMaster();
    assert.equal(m.buildings.length, 3);
    assert.equal(m.contracts.length, 9);
    assert.equal(new Set(m.contracts.map(c => c.id)).size, 9);
  });

  test('新しい契約IDは使用中のIDと重ならない', () => {
    const contracts = [{ id: 'C001' }, { id: 'C003' }, { id: 'C004' }];
    assert.equal(contracts.some(c => c.id === newContractId(contracts)), false);
  });

  test('IDが無い・重複した契約には読み込み時にIDを振る', () => {
    localStorage.setItem('wbc.master', JSON.stringify({
      settings: {}, buildings: [{ id: 'V001' }],
      contracts: [{ id: 'C001', buildingId: 'V001' }, { id: 'C001', buildingId: 'V001' }, { buildingId: 'V001' }],
    }));
    const m = loadMaster();
    assert.equal(new Set(m.contracts.map(c => c.id)).size, 3);
    assert.equal(m.contracts[0].id, 'C001');
    assert.equal(m.settings.taxRatePercent, 10); // 欠けた設定は初期値で補う
  });

  test('契約を並べ替え・削除しても、照会入力は契約IDに付いたまま', () => {
    const m = loadMaster();
    saveInquiry({ buildingId: 'V001', inquiryDate: '', memo: '', rows: { C002: { ...emptyRow(), usage: '20' } } });
    m.contracts = m.contracts.filter(c => c.id !== 'C001').reverse(); // C001 を削除して並べ替え
    saveMaster(m);
    const reloaded = loadMaster();
    const inq = loadInquiry();
    const c002 = reloaded.contracts.find(c => c.id === 'C002');
    assert.equal(inq.rows[c002.id].usage, '20');
    assert.equal(inq.rows.C001, undefined);
  });

  test('初期データの契約IDと口径の組み合わせ（保存済みの入力が別の契約に付かない）', () => {
    const m = loadMaster();
    const pairs = Object.fromEntries(m.contracts.map(c => [c.id, [c.buildingId, c.caliber]]));
    assert.deepEqual(pairs, {
      C001: ['V001', 20], C002: ['V001', 13], C003: ['V001', 25], C004: ['V002', 20],
      C005: ['V003', 13], C006: ['V003', 13], C007: ['V003', 20], C008: ['V003', 25], C009: ['V003', 40],
    });
  });

  test('初期データ：物件名・契約名があり、契約者名が契約ごとに異なる物件と、すべて同じ物件がある', () => {
    const m = loadMaster();
    assert.deepEqual(m.buildings.map(b => b.name), ['サンプルハイツ', 'サンプル第2ビル', 'サンプルビル']);
    assert.ok(m.contracts.every(c => typeof c.label === 'string' && c.label !== ''));
    const holders = id => new Set(m.contracts.filter(c => c.buildingId === id).map(c => c.holder)).size;
    assert.equal(holders('V001') > 1, true);
    assert.equal(holders('V003'), 1);
  });

  test('版1のマスタを移行：location → label、物件名を追加、契約IDは変えない', () => {
    localStorage.setItem('wbc.master', JSON.stringify({
      settings: { taxRatePercent: 10 },
      buildings: [{ id: 'V001', address: '東京都〇〇区サンプル町1-2-3 サンプルハイツ', note: '' }],
      contracts: [{ id: 'C001', buildingId: 'V001', location: '101号室', caliber: 20 }],
    }));
    const m = loadMaster();
    assert.equal(m.schemaVersion, 2);
    assert.equal(m.buildings[0].name, '');
    assert.equal(m.contracts[0].id, 'C001');
    assert.equal(m.contracts[0].label, '101号室');
    assert.equal('location' in m.contracts[0], false);
  });

  test('旧形式の照会入力を移行：回答金額は保持し、確認状態は未確認、日付は YYYY/MM/DD', () => {
    localStorage.setItem('wbc.inquiry', JSON.stringify({
      buildingId: 'V001', inquiryDate: '2026-10-31', memo: '',
      rows: { C001: { start: '2026-08-20', end: '2026-10-20', usage: '59', basicFree: false, ansWater: '9038', ansSewer: '7062', ansTotal: '16100' } },
    }));
    const inq = loadInquiry();
    assert.equal(inq.inquiryDate, '2026/10/31');
    assert.equal(inq.rows.C001.confirm, null);
    assert.deepEqual([inq.rows.C001.ansWater, inq.rows.C001.ansSewer, inq.rows.C001.ansTotal], ['9038', '7062', '16100']);
    assert.equal(inq.rows.C001.start, '2026/08/20');
  });

  test('確認状態だけが残っていても「入力値が残っている」とみなす', () => {
    const inq = { buildingId: 'V001', inquiryDate: '', memo: '', rows: { C001: { ...emptyRow(), confirm: { state: 'stale', from: 'match', basis: '[]' } } } };
    assert.equal(hasInquiryInput(inq), true);
  });

  test('W：内訳の確認（confirmParts）を保存・復元し、「入力値が残っている」に含める', () => {
    const basis = '[]';
    const row = { ...emptyRow(), confirm: { state: 'match', basis }, confirmParts: { basis } };
    saveInquiry({ buildingId: 'V001', inquiryDate: '', memo: '', rows: { C001: row } });
    const inq = loadInquiry();
    assert.deepEqual(inq.rows.C001.confirmParts, { basis });
    assert.equal(hasInquiryInput(inq), true);
    assert.equal(hasInquiryInput({ ...inq, rows: { C001: { ...emptyRow(), confirmParts: { basis } } } }), true);
  });

  test('計測中の状態（wbc.timer）を保存・復元し、null で消す', () => {
    const t = { buildingId: 'V001', startedAt: '2026-10-31T05:00:00.000Z', phoneStartedAt: null, phoneSeconds: null };
    assert.equal(saveTimer(t), true);
    assert.deepEqual(loadTimer(), t);
    saveTimer(null);
    assert.equal(loadTimer(), null);
    assert.equal(localStorage.getItem('wbc.timer'), null);
  });

  test('作業時間の記録（wbc.timelogs）を保存・復元し、壊れた記録は除く', () => {
    const log = { id: 'L1', mode: 'tool', buildingId: 'V001', contractCount: 3, startedAt: '2026-10-31T05:00:00.000Z', endedAt: '2026-10-31T05:05:12.000Z', seconds: 312, phoneSeconds: null, note: '' };
    saveTimelogs([log, { id: 'bad' }]);
    assert.deepEqual(loadTimelogs(), [log]);
    localStorage.setItem('wbc.timelogs', '{壊れたJSON');
    assert.deepEqual(loadTimelogs(), []);
    localStorage.setItem('wbc.timer', '{壊れたJSON');
    assert.equal(loadTimer(), null);
  });

  test('記録IDは重ならない', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newLogId(new Date(2026, 9, 31))));
    assert.equal(ids.size, 200);
  });

  test('壊れた保存データは初期データ・空の照会に戻す', () => {
    localStorage.setItem('wbc.master', '{壊れたJSON');
    localStorage.setItem('wbc.inquiry', '[]');
    assert.equal(loadMaster().contracts.length, 9);
    assert.equal(hasInquiryInput(loadInquiry()), false);
  });
});
