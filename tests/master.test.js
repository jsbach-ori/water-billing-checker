// js/master.js・js/settings.js の追加テスト（38件とは別に数える）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CONTRACTS, validateBuilding, validateContract, buildingDraft, contractDraft, contractsOfBuilding,
  addBuilding, updateBuilding, deleteBuilding, addContract, updateContract, deleteContract, moveContract,
  overLimitMessage, normalizeCustomerNo, CUSTOMER_NO_PLACEHOLDER, CUSTOMER_NO_HINT, visibleErrors, touchField,
} from '../js/master.js';
import { validateTaxRate, validatePhone, rateTables, RATE_SOURCES } from '../js/settings.js';
import { WATER_BASIC, CALIBERS, WATER_TIERS, SEWER_TIERS, SEWER_FLAT } from '../js/rates.js';
import { SAMPLE_MASTER } from '../data/sample.js';
import { newContractId } from '../js/store.js';

const master = () => structuredClone(SAMPLE_MASTER);
const ids = (m, buildingId) => contractsOfBuilding(m, buildingId).map(c => c.id);

describe('物件の入力チェック', () => {
  test('新しい物件：物件番号は必須・英数字とハイフン・重複不可（大文字小文字は区別しない）', () => {
    const b = master().buildings;
    assert.equal(validateBuilding({ id: '', name: 'A' }, b, { isNew: true }).errors.id, '物件番号を入力してください');
    assert.match(validateBuilding({ id: 'V 01', name: 'A' }, b, { isNew: true }).errors.id, /半角の英数字/);
    assert.equal(validateBuilding({ id: 'v001', name: 'A' }, b, { isNew: true }).errors.id, 'この物件番号はすでに使われています');
    const ok = validateBuilding({ id: 'Ｖ０１０', name: ' 新ビル ', address: '東京都〇〇区', note: '' }, b, { isNew: true });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value, { id: 'V010', name: '新ビル', address: '東京都〇〇区', note: '' });
  });

  test('物件名は必須', () => {
    assert.equal(validateBuilding({ id: 'V010', name: '  ' }, [], { isNew: true }).errors.name, '物件名を入力してください');
  });

  test('編集：物件番号は入力値を使わず、元の番号のまま（重複チェックもしない）', () => {
    const r = validateBuilding({ id: 'X999', name: '名前' }, master().buildings, { isNew: false, id: 'V001' });
    assert.equal(r.ok, true);
    assert.equal(r.value.id, 'V001');
  });
});

describe('契約の入力チェック', () => {
  const base = { customerNo: '0000000010', holder: 'サンプル管理組合', label: '共用栓', prevStart: '2026/06/20', prevEnd: '20260820', caliber: '20', note: '' };

  test('正しい入力：前回期間は YYYY-MM-DD、口径は数値で返す。全角のお客様番号も受け付ける', () => {
    const r = validateContract({ ...base, customerNo: '００００００００１０' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { ...base, customerNo: '0000000010', prevStart: '2026-06-20', prevEnd: '2026-08-20', caliber: 20 });
  });

  test('お客様番号は必須・半角数字10桁（AG）', () => {
    assert.equal(validateContract({ ...base, customerNo: '' }).errors.customerNo, 'お客様番号を入力してください');
    assert.equal(validateContract({ ...base, customerNo: '123456789' }).errors.customerNo, 'お客様番号は半角数字10桁で入力してください（今は9桁）');
    assert.equal(validateContract({ ...base, customerNo: '12345678901' }).errors.customerNo, 'お客様番号は半角数字10桁で入力してください（今は11桁）');
    for (const bad of ['ABC', '0000-00001', '000000000A', '00000 00001', '1e9']) {
      assert.equal(validateContract({ ...base, customerNo: bad }).errors.customerNo, 'お客様番号は半角数字10桁で入力してください', bad);
    }
    assert.equal(CUSTOMER_NO_PLACEHOLDER, '例：0000000001');
    assert.equal(CUSTOMER_NO_HINT, '半角数字10桁（先頭の0も入力）');
  });

  test('お客様番号は数値に変換せず、先頭の0を保持した文字列で返す。全角・前後の空白は直す（AG）', () => {
    const r = validateContract({ ...base, customerNo: ' ００１２３４５６７８ ' });
    assert.equal(r.ok, true);
    assert.equal(r.value.customerNo, '0012345678');
    assert.equal(typeof r.value.customerNo, 'string');
    assert.equal(normalizeCustomerNo('０００００００００１'), '0000000001');
    assert.equal(normalizeCustomerNo(' 123 '), '123');
  });

  test('お客様番号の重複：別の物件の契約と同じなら不可。理由に使っている場所を出す（AI）', () => {
    const m = master();
    // 新しい契約に、V001『1-5F分』と同じ番号を入れる
    const added = validateContract({ ...base, customerNo: '0000000001' }, { master: m, id: null });
    assert.equal(added.ok, false);
    assert.equal(added.errors.customerNo, 'この番号は V001 サンプルハイツ『1-5F分』で使われています');
    // 全角で入力しても同じ番号として扱う
    assert.match(validateContract({ ...base, customerNo: '０００００００００９' }, { master: m, id: null }).errors.customerNo,
      /V003 サンプルビル『受水槽』/);
    // 別の物件の契約（C004：V002）を、V003 の契約の番号に変えようとする
    assert.match(validateContract({ ...contractDraft(m.contracts[3]), customerNo: '0000000007' }, { master: m, id: 'C004' }).errors.customerNo,
      /V003 サンプルビル『1-3F分』/);
    // 同じ物件の中の重複も不可
    assert.match(validateContract({ ...contractDraft(m.contracts[0]), customerNo: '0000000002' }, { master: m, id: 'C001' }).errors.customerNo,
      /V001 サンプルハイツ『共用栓』/);
    // 契約名が空欄の契約と重なったとき
    m.contracts[1].label = '';
    assert.equal(validateContract({ ...base, customerNo: '0000000002' }, { master: m, id: null }).errors.customerNo,
      'この番号は V001 サンプルハイツの契約で使われています');
    // 重ならない番号は可
    assert.equal(validateContract({ ...base, customerNo: '0000000010' }, { master: m, id: null }).ok, true);
  });

  test('お客様番号の重複：既存の契約は、番号を変えずに編集・保存できる（AI）', () => {
    const m = master();
    for (const c of m.contracts) {
      const r = validateContract({ ...contractDraft(c), note: '編集' }, { master: m, id: c.id });
      assert.equal(r.ok, true, c.id);
      assert.equal(r.value.customerNo, c.customerNo);
      const saved = updateContract(m, c.id, r.value).contracts.find(x => x.id === c.id);
      assert.equal(saved.customerNo, c.customerNo);
      assert.equal(saved.note, '編集');
    }
  });

  test('前回期間：両方空欄は可、片方だけ・存在しない日付・終了日が開始日以前は不可', () => {
    const blank = validateContract({ ...base, prevStart: '', prevEnd: '' });
    assert.equal(blank.ok, true);
    assert.equal(blank.value.prevStart, '');
    assert.match(validateContract({ ...base, prevEnd: '' }).errors.prevEnd, /両方/);
    assert.equal(validateContract({ ...base, prevStart: '2026/02/30' }).errors.prevStart, '存在しない日付です');
    assert.match(validateContract({ ...base, prevEnd: '2026/06/20' }).errors.prevEnd, /後の日付/);
  });

  test('口径は料金表にある口径だけ', () => {
    assert.equal(validateContract({ ...base, caliber: '' }).errors.caliber, '口径を選んでください');
    assert.equal(validateContract({ ...base, caliber: '35' }).errors.caliber, '口径を選んでください');
    assert.equal(validateContract({ ...base, caliber: '300' }).ok, true);
  });

  test('編集欄の初期値：日付は 2026/06/20 の形', () => {
    const c = master().contracts[0];
    assert.equal(contractDraft(c).prevStart, '2026/06/20');
    assert.equal(contractDraft(c).caliber, '20');
    assert.deepEqual(contractDraft(), { customerNo: '', holder: '', label: '', prevStart: '', prevEnd: '', caliber: '', note: '' });
    assert.deepEqual(buildingDraft(), { id: '', name: '', address: '', note: '' });
  });
});

describe('欄を離れたときの判定し直し（AH）', () => {
  const draft = { customerNo: '0000000010', holder: '', label: '', prevStart: '2026/06/20', prevEnd: '2026/08/20', caliber: '20', note: '' };
  // 欄を離れたときの処理（app.js の onMasterFieldBlur と同じ手順）
  const blur = (edit, key) => {
    const touched = touchField(edit.touched, key, edit.draft);
    return { ...edit, touched, errors: visibleErrors(validateContract(edit.draft).errors, edit.errors, touched) };
  };
  const saveFailed = d => ({ draft: d, touched: [], errors: validateContract(d).errors });

  test('存在しない日付を直すと、欄を離れた時点でエラーが消える', () => {
    let edit = saveFailed({ ...draft, prevStart: '20260230', prevEnd: '2026/09/30' });
    assert.equal(edit.errors.prevStart, '存在しない日付です');
    edit.draft = { ...edit.draft, prevStart: '2026/07/31' };
    edit = blur(edit, 'prevStart');
    assert.deepEqual(edit.errors, {});
  });

  test('まだ直っていなければ、理由を新しい内容に変えて出し続ける', () => {
    let edit = saveFailed({ ...draft, customerNo: '123' });
    edit.draft = { ...edit.draft, customerNo: '12345' };
    edit = blur(edit, 'customerNo');
    assert.equal(edit.errors.customerNo, 'お客様番号は半角数字10桁で入力してください（今は5桁）');
  });

  test('開始日を直して正しい期間になると、終了日の欄のエラーも消える', () => {
    let edit = saveFailed({ ...draft, prevStart: '2026/09/01', prevEnd: '2026/08/20' });
    assert.deepEqual(Object.keys(edit.errors), ['prevEnd']);
    assert.match(edit.errors.prevEnd, /後の日付/);
    edit.draft = { ...edit.draft, prevStart: '2026/06/20' };
    edit = blur(edit, 'prevStart');
    assert.deepEqual(edit.errors, {});
  });

  test('片方だけ入力のエラー：もう片方を入力すると消える。両方空欄にしても消える', () => {
    const edit = saveFailed({ ...draft, prevEnd: '' });
    assert.match(edit.errors.prevEnd, /両方/);
    assert.deepEqual(blur({ ...edit, draft: { ...edit.draft, prevEnd: '2026/08/20' } }, 'prevEnd').errors, {});
    assert.deepEqual(blur({ ...edit, draft: { ...edit.draft, prevStart: '', prevEnd: '' } }, 'prevStart').errors, {});
  });

  test('ほかの欄のエラーは、直すまで残る', () => {
    let edit = saveFailed({ ...draft, customerNo: '', caliber: '' });
    edit.draft = { ...edit.draft, customerNo: '0000000010' };
    edit = blur(edit, 'customerNo');
    assert.deepEqual(edit.errors, { caliber: '口径を選んでください' });
  });

  test('保存前：離れた欄の誤りは出すが、まだ触れていない欄には出さない', () => {
    let edit = { draft: { ...draft, customerNo: '', prevStart: '', prevEnd: '', caliber: '' }, touched: [], errors: {} };
    edit.draft = { ...edit.draft, customerNo: '12' };
    edit = blur(edit, 'customerNo');
    assert.deepEqual(Object.keys(edit.errors), ['customerNo']);
    // 開始日だけ入れて離れても、まだ入力していない終了日に「両方を入力」は出さない
    edit.draft = { ...edit.draft, prevStart: '2026/06/20' };
    edit = blur(edit, 'prevStart');
    assert.deepEqual(Object.keys(edit.errors), ['customerNo']);
    // 終了日に開始日以前の日付を入れて離れると、終了日に出る。開始日を直すと消える
    edit.draft = { ...edit.draft, prevEnd: '2026/06/01' };
    edit = blur(edit, 'prevEnd');
    assert.match(edit.errors.prevEnd, /後の日付/);
    edit.draft = { ...edit.draft, prevStart: '2026/04/01' };
    edit = blur(edit, 'prevStart');
    assert.equal('prevEnd' in edit.errors, false);
  });

  test('touchField：前回期間は、もう片方が入力済みのときだけ組で触れたとみなす', () => {
    assert.deepEqual(touchField([], 'prevStart', { prevEnd: '' }), ['prevStart']);
    assert.deepEqual(touchField([], 'prevStart', { prevEnd: '2026/08/20' }), ['prevStart', 'prevEnd']);
    assert.deepEqual(touchField(['customerNo'], 'customerNo', {}), ['customerNo']);
    const touched = ['label'];
    touchField(touched, 'note', {});
    assert.deepEqual(touched, ['label']); // 元の配列は変えない
  });

  test('物件の欄も同じ：物件名を入力して離れると、物件名のエラーが消える', () => {
    const b = master().buildings;
    let errors = validateBuilding({ id: 'V010', name: '' }, b, { isNew: true }).errors;
    assert.ok(errors.name);
    errors = visibleErrors(validateBuilding({ id: 'V010', name: '新ビル' }, b, { isNew: true }).errors, errors, ['name']);
    assert.deepEqual(errors, {});
  });
});

describe('物件・契約の追加・更新・削除・並べ替え', () => {
  test('物件の追加・更新（物件番号は変えない）。元のマスタは変えない', () => {
    const m = master();
    const added = addBuilding(m, { id: 'V010', name: '新ビル', address: '', note: '' });
    assert.equal(added.buildings.length, 4);
    assert.equal(m.buildings.length, 3);
    const updated = updateBuilding(added, 'V010', { id: 'ZZZ', name: '新ビル2', address: '住所', note: 'メモ' });
    assert.deepEqual(updated.buildings[3], { id: 'V010', name: '新ビル2', address: '住所', note: 'メモ' });
  });

  test('物件を削除すると、その物件の契約も消える（ほかの物件の契約は残る）', () => {
    const { master: m, removedContractIds } = deleteBuilding(master(), 'V001');
    assert.deepEqual(removedContractIds, ['C001', 'C002', 'C003']);
    assert.equal(m.buildings.some(b => b.id === 'V001'), false);
    assert.equal(m.contracts.length, 6);
    assert.deepEqual(ids(m, 'V003'), ['C005', 'C006', 'C007', 'C008', 'C009']);
  });

  test('契約の追加：物件の最後に加わり、IDは使用中のIDと重ならない', () => {
    const m = master();
    const id = newContractId(m.contracts);
    const v = validateContract({ customerNo: '0000000010', caliber: '13', prevStart: '', prevEnd: '' }).value;
    const added = addContract(m, 'V001', v, id);
    assert.deepEqual(ids(added, 'V001'), ['C001', 'C002', 'C003', id]);
    assert.equal(m.contracts.some(c => c.id === id), false);
  });

  test('契約の更新・削除：契約IDと物件番号は変えない', () => {
    const m = master();
    const updated = updateContract(m, 'C002', { id: 'X', buildingId: 'V002', customerNo: '9', holder: 'h', label: 'l', prevStart: '', prevEnd: '', caliber: 25, note: '' });
    const c = updated.contracts.find(x => x.id === 'C002');
    assert.equal(c.buildingId, 'V001');
    assert.equal(c.caliber, 25);
    assert.deepEqual(ids(deleteContract(updated, 'C002'), 'V001'), ['C001', 'C003']);
  });

  test('並べ替え：同じ物件の中だけで入れ替わり、IDは変わらない。端では何もしない', () => {
    const m = master();
    assert.deepEqual(ids(moveContract(m, 'C003', -1), 'V001'), ['C001', 'C003', 'C002']);
    assert.deepEqual(ids(moveContract(m, 'C005', 1), 'V003'), ['C006', 'C005', 'C007', 'C008', 'C009']);
    assert.equal(moveContract(m, 'C001', -1), m);
    assert.equal(moveContract(m, 'C003', 1), m); // 次は別の物件（V002）の契約なので動かさない
    assert.equal(moveContract(m, 'C004', 1), m);
    const moved = moveContract(m, 'C003', -1);
    assert.deepEqual(moved.contracts.map(c => [c.id, c.caliber]).sort(), m.contracts.map(c => [c.id, c.caliber]).sort());
  });

  test('6件目以降の警告', () => {
    assert.equal(MAX_CONTRACTS, 5);
    assert.equal(overLimitMessage(5), null);
    assert.equal(overLimitMessage(6), '契約が6件あります。6件目以降は料金確認に表示されません。');
  });
});

describe('設定', () => {
  test('消費税率：0〜99の整数（全角も可）', () => {
    assert.deepEqual(validateTaxRate('10'), { ok: true, value: 10 });
    assert.deepEqual(validateTaxRate('０'), { ok: true, value: 0 });
    assert.deepEqual(validateTaxRate('99'), { ok: true, value: 99 });
    for (const bad of ['', '100', '-1', '8.5', 'abc']) assert.equal(validateTaxRate(bad).ok, false, bad);
  });

  test('自分の電話番号', () => {
    assert.deepEqual(validatePhone(' ０９０-１２３４-５６７８ '), { ok: true, value: '090-1234-5678' });
    assert.equal(validatePhone('').ok, false);
    assert.equal(validatePhone('電話').ok, false);
  });
});

describe('料金表の表示用データ（rates.js の値と一致する）', () => {
  const t = rateTables();

  test('水道 基本料金：全口径、最後は「以上」', () => {
    assert.equal(t.waterBasic.length, CALIBERS.length);
    t.waterBasic.forEach((row, i) => assert.equal(row.price, WATER_BASIC[CALIBERS[i]]));
    assert.equal(t.waterBasic[0].caliber, '13mm');
    assert.equal(t.waterBasic.at(-1).caliber, '300mm以上');
  });

  test('水道 従量料金：口径区分と段階', () => {
    assert.deepEqual(t.waterMetered.classes, ['13〜25mm', '30・40mm', '50・75mm', '100mm以上']);
    assert.equal(t.waterMetered.rows.length, WATER_TIERS.length);
    assert.equal(t.waterMetered.rows[0].range, '0〜5m³');
    assert.equal(t.waterMetered.rows[1].range, '6〜10m³');
    assert.equal(t.waterMetered.rows.at(-1).range, '1,001m³〜');
    t.waterMetered.rows.forEach((row, i) => {
      assert.deepEqual(row.prices, ['small', 'medium', 'large', 'xlarge'].map(k => WATER_TIERS[i].price[k]));
    });
  });

  test('下水道：8m³までは定額、9m³からは段階ごと', () => {
    assert.deepEqual(t.sewer[0], { range: '0〜8m³', price: SEWER_FLAT, unit: '円（定額）' });
    assert.equal(t.sewer[1].range, '9〜20m³');
    assert.equal(t.sewer.length, SEWER_TIERS.length + 1);
    t.sewer.slice(1).forEach((row, i) => assert.equal(row.price, SEWER_TIERS[i].price));
  });

  test('出典は東京都の2つのページ', () => {
    assert.equal(RATE_SOURCES.length, 2);
    assert.ok(RATE_SOURCES.every(s => s.url.startsWith('https://www.') && s.url.includes('.metro.tokyo.lg.jp/')));
  });
});
