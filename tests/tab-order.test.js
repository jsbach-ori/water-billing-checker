// js/tab-order.js の追加テスト（38件とは別に数える）
// 照会入力の表を模した並び（DOMの順＝行ごと）で、Tab／Shift＋Tab の移動先を確かめる
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextFocus } from '../js/tab-order.js';

// 列内の順番（app.js の SEQ と同じ）
const ORDER = { start: 1, end: 2, usage: 3, basicFree: 4, match: 5, mismatch: 6, ansTotal: 7, breakdown: 8, ansWater: 9, ansSewer: 10 };
const KEYS = Object.keys(ORDER);

// 契約ごとの状態から items を作る。DOMと同じく行ごと（項目ごと）に並べる
// opts[i] = { disabled: ボタン無効, open: 回答欄が開いている, breakdownOpen, noBasicFree: 30mm以上 }
function table(opts) {
  const items = [];
  for (const key of KEYS) {
    opts.forEach((o, col) => {
      let focusable = true;
      if ((key === 'match' || key === 'mismatch') && o.disabled) focusable = false;
      if (key === 'basicFree' && o.noBasicFree) focusable = false;
      if (['ansTotal', 'breakdown', 'ansWater', 'ansSewer'].includes(key) && !o.open) focusable = false;
      if ((key === 'ansWater' || key === 'ansSewer') && !o.breakdownOpen) focusable = false;
      items.push({ col, order: ORDER[key], focusable, key });
    });
  }
  return items;
}

const at = (items, col, key) => items.findIndex(it => it.col === col && it.key === key);
const go = (items, col, key, back = false) => {
  const r = nextFocus(items, at(items, col, key), back);
  return r.type === 'exit' ? `exit:${r.direction}` : `${items[r.index].col}:${items[r.index].key}`;
};

describe('Tab：契約ごとに縦に進む', () => {
  const items = table([{}, {}, {}]);
  test('開始日 → 終了日 → 使用水量 → 無償化 → ［一致］ → ［違う］', () => {
    assert.equal(go(items, 0, 'start'), '0:end');
    assert.equal(go(items, 0, 'end'), '0:usage');
    assert.equal(go(items, 0, 'usage'), '0:basicFree');
    assert.equal(go(items, 0, 'basicFree'), '0:match');
    assert.equal(go(items, 0, 'match'), '0:mismatch');
  });
  test('［違う］の回答欄が閉じていれば、次の契約の開始日へ', () => {
    assert.equal(go(items, 0, 'mismatch'), '1:start');
  });
  test('Shift＋Tab は逆順。次の契約の開始日から前の契約の［違う］へ戻る', () => {
    assert.equal(go(items, 1, 'start', true), '0:mismatch');
    assert.equal(go(items, 0, 'end', true), '0:start');
  });
});

describe('Tab：無効・閉じた要素でフォーカスが行き場を失わない', () => {
  test('ボタンが無効なら、無償化の次は次の契約の開始日', () => {
    const items = table([{ disabled: true }, {}]);
    assert.equal(go(items, 0, 'basicFree'), '1:start');
    assert.equal(go(items, 1, 'start', true), '0:basicFree');
  });
  test('30mm以上（無償化が無効）では、使用水量の次は［一致］', () => {
    const items = table([{ noBasicFree: true }]);
    assert.equal(go(items, 0, 'usage'), '0:match');
    assert.equal(go(items, 0, 'match', true), '0:usage');
  });
  test('ボタンも無償化も無効なら、使用水量の次は次の契約へ', () => {
    const items = table([{ disabled: true, noBasicFree: true }, {}]);
    assert.equal(go(items, 0, 'usage'), '1:start');
  });
  test('［違う］で開いた回答欄：合計 → 内訳の開閉 → （閉じていれば）次の契約', () => {
    const items = table([{ open: true }, {}]);
    assert.equal(go(items, 0, 'mismatch'), '0:ansTotal');
    assert.equal(go(items, 0, 'ansTotal'), '0:breakdown');
    assert.equal(go(items, 0, 'breakdown'), '1:start');
    assert.equal(go(items, 1, 'start', true), '0:breakdown');
  });
  test('内訳を開いていれば 水道 → 下水道 → 次の契約', () => {
    const items = table([{ open: true, breakdownOpen: true }, {}]);
    assert.equal(go(items, 0, 'breakdown'), '0:ansWater');
    assert.equal(go(items, 0, 'ansWater'), '0:ansSewer');
    assert.equal(go(items, 0, 'ansSewer'), '1:start');
  });
  test('今の要素が直前に無効になっていても、その位置から次へ進む', () => {
    const items = table([{ disabled: true }, {}]);
    assert.equal(go(items, 0, 'match'), '1:start');
    assert.equal(go(items, 0, 'mismatch', true), '0:basicFree');
  });
  test('並びに含まれない要素は null を返し、通常の Tab に任せる', () => {
    assert.equal(nextFocus(table([{}]), 999), null);
  });
});

describe('Tab：最後の欄から表の外へ抜ける', () => {
  test('契約1件の物件：最後の［違う］から外へ、最初の開始日から前へ', () => {
    const items = table([{}]);
    assert.equal(go(items, 0, 'mismatch'), 'exit:forward');
    assert.equal(go(items, 0, 'start', true), 'exit:backward');
  });
  test('契約1件で回答欄・内訳が開いているときは、下水道の次で外へ', () => {
    const items = table([{ open: true, breakdownOpen: true }]);
    assert.equal(go(items, 0, 'ansSewer'), 'exit:forward');
  });
  test('契約5件の物件：契約5の最後から外へ', () => {
    const items = table([{}, {}, {}, {}, {}]);
    assert.equal(go(items, 4, 'mismatch'), 'exit:forward');
    assert.equal(go(items, 3, 'mismatch'), '4:start');
    assert.equal(go(items, 0, 'start', true), 'exit:backward');
  });
  test('契約5件で、最後の契約のボタンが無効なら無償化から外へ', () => {
    const items = table([{}, {}, {}, {}, { disabled: true }]);
    assert.equal(go(items, 4, 'basicFree'), 'exit:forward');
  });
  test('契約5件で最後の契約が40mm・ボタン無効なら、使用水量から外へ', () => {
    const items = table([{}, {}, {}, {}, { disabled: true, noBasicFree: true }]);
    assert.equal(go(items, 4, 'usage'), 'exit:forward');
  });
});
