// 照会入力の表で、Tab／Shift＋Tab を契約ごとに縦に進めるための順番計算（純粋関数。DOMに触れない）
// items は { col, order, focusable } の配列（col＝契約の列、order＝列内の順番）
// 戻り値：
//   { type: 'item', index }      次にフォーカスする要素（items の添字）
//   { type: 'exit', direction }  表の外へ出る（'forward' | 'backward'）
//   null                         current が並びに含まれない（ブラウザの通常の動作に任せる）
// 今の要素がフォーカスできなくなっていても（無効化・非表示）、その位置から前後を探す
export function nextFocus(items, currentIndex, backwards = false) {
  if (!items[currentIndex]) return null;
  const sorted = items
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => a.col - b.col || a.order - b.order);
  const pos = sorted.findIndex(item => item.index === currentIndex);
  const step = backwards ? -1 : 1;
  for (let p = pos + step; p >= 0 && p < sorted.length; p += step) {
    if (sorted[p].focusable) return { type: 'item', index: sorted[p].index };
  }
  return { type: 'exit', direction: backwards ? 'backward' : 'forward' };
}
