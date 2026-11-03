// 物件マスタの編集（追加・更新・削除・並べ替え・入力チェック）。純粋関数（画面にも保存処理にも触れない）
// マスタは書き換えずに、新しいマスタを返す
import { CALIBERS } from './rates.js';
import { parseDateText, formatDate } from './parse.js';

// 料金確認に表示する契約の上限（6件目以降は表示しない）
export const MAX_CONTRACTS = 5;

const trim = v => String(v ?? '').trim();
// 番号類は全角の英数字・ハイフンも受け付ける
const normalizeCode = v => trim(String(v ?? '').normalize('NFKC'));

const BUILDING_ID_PATTERN = /^[A-Za-z0-9-]{1,20}$/;

// お客様番号：半角数字10桁（先頭の0も入力）。数値には変換せず、文字列のまま保存・比較する
export const CUSTOMER_NO_DIGITS = 10;
const CUSTOMER_NO_PATTERN = /^[0-9]{10}$/;
export const CUSTOMER_NO_PLACEHOLDER = '例：0000000001';
export const CUSTOMER_NO_HINT = '半角数字10桁（先頭の0も入力）';

// 全角数字は半角に直し、前後の空白を除く（ほかの番号類と同じ扱い）
export const normalizeCustomerNo = v => normalizeCode(v);

// お客様番号を使っている契約の場所（重複の理由に出す）
function customerNoPlace(contract, buildings) {
  const b = buildings.find(x => x.id === contract.buildingId);
  const where = b ? `${b.id} ${b.name}` : contract.buildingId;
  return contract.label ? `${where}『${contract.label}』` : `${where}の契約`;
}

// 物件の入力チェック。isNew のときだけ物件番号を受け付ける（あとからは変えない）
// 戻り値：{ ok, value: { id, name, address, note }, errors: { 項目: 理由 } }
export function validateBuilding(input, buildings, { isNew, id: currentId = null } = {}) {
  const errors = {};
  const id = isNew ? normalizeCode(input.id) : currentId;
  if (isNew) {
    if (id === '') errors.id = '物件番号を入力してください';
    else if (!BUILDING_ID_PATTERN.test(id)) errors.id = '物件番号は半角の英数字とハイフン（20文字まで）で入力してください';
    else if (buildings.some(b => b.id.toLowerCase() === id.toLowerCase())) errors.id = 'この物件番号はすでに使われています';
  }
  const name = trim(input.name);
  if (name === '') errors.name = '物件名を入力してください';
  const value = { id, name, address: trim(input.address), note: trim(input.note) };
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// 契約の入力チェック
// master を渡すと、お客様番号がほかの契約（別の物件も含む。id の契約自身は除く）と重ならないかも調べる
// 戻り値：{ ok, value: { customerNo, holder, label, prevStart, prevEnd, caliber, note }, errors }
// 前回期間は YYYY-MM-DD（空欄なら ''）で返す
export function validateContract(input, { master = null, id = null } = {}) {
  const errors = {};
  const customerNo = normalizeCustomerNo(input.customerNo);
  if (customerNo === '') errors.customerNo = 'お客様番号を入力してください';
  else if (!CUSTOMER_NO_PATTERN.test(customerNo)) {
    const digits = /^[0-9]+$/.test(customerNo) ? `（今は${customerNo.length}桁）` : '';
    errors.customerNo = `お客様番号は半角数字10桁で入力してください${digits}`;
  } else if (master) {
    const other = master.contracts.find(c => c.id !== id && String(c.customerNo) === customerNo);
    if (other) errors.customerNo = `この番号は ${customerNoPlace(other, master.buildings)}で使われています`;
  }

  const start = parseDateText(input.prevStart);
  const end = parseDateText(input.prevEnd);
  if (!start.ok) errors.prevStart = start.error;
  if (!end.ok) errors.prevEnd = end.error;
  if (start.ok && end.ok) {
    if ((start.value === null) !== (end.value === null)) {
      errors[start.value === null ? 'prevStart' : 'prevEnd'] = '開始日・終了日の両方を入力してください（前回期間が不明なら両方とも空欄）';
    } else if (start.value !== null && end.value <= start.value) {
      errors.prevEnd = '終了日は開始日より後の日付にしてください';
    }
  }

  const caliber = Number(input.caliber);
  if (!CALIBERS.includes(caliber)) errors.caliber = '口径を選んでください';

  const value = {
    customerNo,
    holder: trim(input.holder),
    label: trim(input.label),
    prevStart: start.ok && start.value !== null ? start.value : '',
    prevEnd: end.ok && end.value !== null ? end.value : '',
    caliber,
    note: trim(input.note),
  };
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// 欄を離れたときに出すエラー（AH）
// - 今エラーが出ている欄と、この編集で触れた欄（touched）だけを、判定し直した結果で置き換える
//   （直って正しくなった欄のエラーは消え、まだ触れていない欄にはエラーを出さない）
// - 前回期間の開始日・終了日は組で判定するので、片方を直すと、もう片方のエラーも判定し直される
export function visibleErrors(allErrors, shownErrors, touched) {
  const out = {};
  for (const [key, message] of Object.entries(allErrors)) {
    if (key in shownErrors || touched.includes(key)) out[key] = message;
  }
  return out;
}

// 欄を離れたときに「触れた」とみなす欄。前回期間は、もう片方が入力済みなら組で触れたとみなす
// （開始日だけ入れて離れたときに、まだ入力していない終了日へ「両方を入力」を出さないため）
const PAIRS = { prevStart: 'prevEnd', prevEnd: 'prevStart' };
export function touchField(touched, key, draft) {
  const keys = new Set(touched);
  keys.add(key);
  const partner = PAIRS[key];
  if (partner && trim(draft[partner]) !== '') keys.add(partner);
  return [...keys];
}

// 編集欄に入れる文字列（日付は 2026/06/20 の形）
export function buildingDraft(b = null) {
  return { id: b?.id ?? '', name: b?.name ?? '', address: b?.address ?? '', note: b?.note ?? '' };
}

export function contractDraft(c = null) {
  return {
    customerNo: c?.customerNo ?? '', holder: c?.holder ?? '', label: c?.label ?? '',
    prevStart: c?.prevStart ? formatDate(c.prevStart) : '', prevEnd: c?.prevEnd ? formatDate(c.prevEnd) : '',
    caliber: c ? String(c.caliber) : '', note: c?.note ?? '',
  };
}

export function contractsOfBuilding(master, buildingId) {
  return master.contracts.filter(c => c.buildingId === buildingId);
}

export function addBuilding(master, value) {
  return { ...master, buildings: [...master.buildings, { ...value }] };
}

// 物件番号（id）は変えない
export function updateBuilding(master, id, value) {
  return {
    ...master,
    buildings: master.buildings.map(b => (b.id === id
      ? { ...b, name: value.name, address: value.address, note: value.note } : b)),
  };
}

// 物件と、その物件の契約をまとめて削除する
// 戻り値：{ master, removedContractIds }
export function deleteBuilding(master, id) {
  const removedContractIds = contractsOfBuilding(master, id).map(c => c.id);
  return {
    master: {
      ...master,
      buildings: master.buildings.filter(b => b.id !== id),
      contracts: master.contracts.filter(c => c.buildingId !== id),
    },
    removedContractIds,
  };
}

// 契約は物件の最後に加える（契約IDは呼び出し側で採番して渡す）
export function addContract(master, buildingId, value, id) {
  return { ...master, contracts: [...master.contracts, { id, buildingId, ...value }] };
}

// 契約IDと物件番号は変えない
export function updateContract(master, id, value) {
  return {
    ...master,
    contracts: master.contracts.map(c => (c.id === id ? { ...c, ...value, id: c.id, buildingId: c.buildingId } : c)),
  };
}

export function deleteContract(master, id) {
  return { ...master, contracts: master.contracts.filter(c => c.id !== id) };
}

// 同じ物件の中で、契約を1つ前（direction = -1）または1つ後（+1）と入れ替える
// 端の契約を動かそうとしたときは、同じマスタを返す
export function moveContract(master, id, direction) {
  const index = master.contracts.findIndex(c => c.id === id);
  if (index < 0) return master;
  const buildingId = master.contracts[index].buildingId;
  const siblings = master.contracts
    .map((c, i) => ({ c, i }))
    .filter(x => x.c.buildingId === buildingId)
    .map(x => x.i);
  const pos = siblings.indexOf(index);
  const target = siblings[pos + direction];
  if (target === undefined) return master;
  const contracts = [...master.contracts];
  [contracts[index], contracts[target]] = [contracts[target], contracts[index]];
  return { ...master, contracts };
}

// 契約が上限を超えたときの警告（超えていなければ null）
export function overLimitMessage(count) {
  return count > MAX_CONTRACTS
    ? `契約が${count}件あります。6件目以降は料金確認に表示されません。`
    : null;
}
