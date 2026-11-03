// 画面の入力値を計算関数に渡す前の変換（純粋関数。DOMに触れない）
import { parseIsoDate } from './calc.js';

export const NUMBER_FIELDS = Object.freeze(['usage', 'ansWater', 'ansSewer', 'ansTotal']);
export const DATE_FIELDS = Object.freeze(['start', 'end']);

const MINUS_LIKE = /^[‐-―−ー-]/; // ハイフン・全角マイナス・長音など

// 整数の入力欄の値を変換する
//   空欄 → { ok: true, value: null }
//   整数 → { ok: true, value }
//   それ以外 → { ok: false, error }
// 全角数字・全角カンマ・3桁区切りのカンマ（例：9,038）を受け付ける
export function parseIntegerInput(text) {
  if (text === null || text === undefined) return { ok: true, value: null };
  const s = String(text).normalize('NFKC').trim();
  if (s === '') return { ok: true, value: null };

  if (MINUS_LIKE.test(s)) return { ok: false, error: '0以上で入力してください' };
  if (!/^\d+$/.test(s) && !/^\d{1,3}(,\d{3})+$/.test(s)) {
    return { ok: false, error: '整数で入力してください' };
  }
  const value = Number(s.replaceAll(',', ''));
  if (!Number.isSafeInteger(value)) return { ok: false, error: '数値が大きすぎます' };
  return { ok: true, value };
}

// 日付の入力欄（文字入力）の値を変換する。計算に渡す形式は YYYY-MM-DD
// 受け付ける形式：2026/08/20、2026-08-20、2026.08.20、2026/8/20、20260820（全角数字も可）
export function parseDateText(text) {
  if (text === null || text === undefined) return { ok: true, value: null };
  const s = String(text).normalize('NFKC').trim();
  if (s === '') return { ok: true, value: null };

  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return { ok: false, error: '2026/08/20 の形式で入力してください' };
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (parseIsoDate(iso) === null) return { ok: false, error: '存在しない日付です' };
  return { ok: true, value: iso };
}

// YYYY-MM-DD を画面表示用の YYYY/MM/DD にする。null・空は空文字
export function formatDate(iso) {
  return iso ? iso.replaceAll('-', '/') : '';
}

// 入力欄を離れたときの表示。正しい日付なら YYYY/MM/DD に整え、それ以外は入力のまま返す
export function normalizeDateText(text) {
  const r = parseDateText(text);
  return r.ok && r.value !== null ? formatDate(r.value) : String(text ?? '');
}

// 1契約分の入力（文字列のまま保存したもの）を変換する
// values は judgeContract にそのまま渡せる形。errors はエラーのある欄だけを持つ
export function parseRow(raw = {}) {
  const values = { basicFree: raw.basicFree === true };
  const errors = {};
  for (const field of DATE_FIELDS) {
    const r = parseDateText(raw[field]);
    if (r.ok) values[field] = r.value; else errors[field] = r.error;
  }
  for (const field of NUMBER_FIELDS) {
    const r = parseIntegerInput(raw[field]);
    if (r.ok) values[field] = r.value; else errors[field] = r.error;
  }
  return { values, errors, hasError: Object.keys(errors).length > 0 };
}
