// localStorage の読み書き（キー接頭辞 wbc.）と初期データ
// 読み書きはすべて try/catch で囲み、保存できない環境でもメモリ上の状態で動作させる
import { SAMPLE_MASTER, SCHEMA_VERSION } from '../data/sample.js';
import { emptyRow, normalizeRow } from './inquiry.js';
import { normalizeDateText } from './parse.js';
import { normalizeTimer, normalizeLogs } from './timer.js';

export { emptyRow };

const KEY_MASTER = 'wbc.master';
const KEY_INQUIRY = 'wbc.inquiry';
const KEY_TIMER = 'wbc.timer';
const KEY_TIMELOGS = 'wbc.timelogs';

const ROW_TEXT_FIELDS = ['start', 'end', 'usage', 'ansWater', 'ansSewer', 'ansTotal'];

function read(key) {
  try {
    const text = localStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// この環境で localStorage に保存できるか
export function isStorageAvailable() {
  try {
    const key = 'wbc.__test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ---------- マスタ（wbc.master） ----------

export function sampleMaster() {
  return structuredClone(SAMPLE_MASTER);
}

function isValidMaster(m) {
  return m !== null && typeof m === 'object'
    && m.settings !== null && typeof m.settings === 'object'
    && Array.isArray(m.buildings) && Array.isArray(m.contracts);
}

// 旧版のマスタを今の形にそろえる（契約IDは変えない）
//   版1 → 版2：物件名（name）を追加、契約の location を label（契約名・表示名）に変更
export function migrateMaster(m) {
  m.settings = { ...SAMPLE_MASTER.settings, ...m.settings };
  for (const b of m.buildings) {
    if (typeof b.name !== 'string') b.name = '';
  }
  for (const c of m.contracts) {
    if (typeof c.label !== 'string') c.label = typeof c.location === 'string' ? c.location : '';
    delete c.location;
  }
  ensureContractIds(m.contracts);
  m.schemaVersion = SCHEMA_VERSION;
  return m;
}

// 保存されたマスタを読む。無い・壊れている場合は初期データ（架空）を返す
export function loadMaster() {
  const m = read(KEY_MASTER);
  if (!isValidMaster(m)) return sampleMaster();
  return migrateMaster(m);
}

export function saveMaster(master) {
  return write(KEY_MASTER, master);
}

// 契約ID（画面には表示しない一意の文字列）を採番する
export function newContractId(contracts) {
  const used = new Set(contracts.map(c => c.id));
  let n = contracts.length + 1;
  let id;
  do {
    id = `C${String(n).padStart(3, '0')}`;
    n += 1;
  } while (used.has(id));
  return id;
}

function ensureContractIds(contracts) {
  const seen = new Set();
  for (const c of contracts) {
    if (!c.id || seen.has(c.id)) c.id = newContractId(contracts);
    seen.add(c.id);
  }
}

// ---------- 入力途中の照会（wbc.inquiry） ----------
// rows は契約IDをキーにし、入力欄の文字列と確認状態（confirm）を持つ

export function emptyInquiry(buildingId = null) {
  return { buildingId, inquiryDate: '', memo: '', rows: {} };
}

export function loadInquiry() {
  const inq = read(KEY_INQUIRY);
  if (inq === null || typeof inq !== 'object' || inq.rows === null
      || typeof inq.rows !== 'object' || Array.isArray(inq.rows)) {
    return emptyInquiry();
  }
  const rows = {};
  for (const [id, row] of Object.entries(inq.rows)) rows[id] = normalizeRow(row);
  return {
    ...emptyInquiry(),
    ...inq,
    inquiryDate: normalizeDateText(inq.inquiryDate ?? ''),
    memo: String(inq.memo ?? ''),
    rows,
  };
}

export function saveInquiry(inquiry) {
  return write(KEY_INQUIRY, inquiry);
}

// 入力値が残っているか（物件切替時の確認に使う）
export function hasInquiryInput(inquiry) {
  if (String(inquiry.inquiryDate ?? '').trim() !== '' || String(inquiry.memo ?? '').trim() !== '') return true;
  return Object.values(inquiry.rows).some(row =>
    row.basicFree === true || (row.confirm ?? null) !== null || (row.confirmParts ?? null) !== null
    || ROW_TEXT_FIELDS.some(f => String(row[f] ?? '').trim() !== ''));
}

// 照会結果の入力欄だけを消す（物件の選択は残す）
export function clearInquiry(inquiry) {
  return emptyInquiry(inquiry.buildingId);
}

// ---------- 作業時間（wbc.timer：計測中の状態、wbc.timelogs：記録） ----------

// 計測中の状態。無い・壊れている場合は null（計測していない）
export function loadTimer() {
  return normalizeTimer(read(KEY_TIMER));
}

// null を渡すと計測中の状態を消す
export function saveTimer(timer) {
  if (timer !== null) return write(KEY_TIMER, timer);
  try {
    localStorage.removeItem(KEY_TIMER);
    return true;
  } catch {
    return false;
  }
}

export function loadTimelogs() {
  return normalizeLogs(read(KEY_TIMELOGS));
}

export function saveTimelogs(logs) {
  return write(KEY_TIMELOGS, logs);
}

// 記録のID（一意な文字列）
export function newLogId(now = new Date()) {
  return `L${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
