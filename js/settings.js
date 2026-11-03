// 料金表・設定タブ：設定の入力チェックと、料金表の表示用データ（純粋関数。DOMに触れない）
// 料金表は rates.js の値から作る（数値を二重に書かない）
import {
  WATER_BASIC, CALIBERS, WATER_TIERS, waterClassOf, SEWER_FLAT, SEWER_FLAT_UP_TO, SEWER_TIERS,
} from './rates.js';
import { parseIntegerInput } from './parse.js';

// 出典（利用者がクリックしたときだけ開くリンク。ページを開いただけでは通信しない）
export const RATE_SOURCES = Object.freeze([
  { label: '東京都水道局 料金表（23区）', url: 'https://www.waterworks.metro.tokyo.lg.jp/tetsuduki/ryokin/keisan_23' },
  { label: '東京都下水道局 料金表', url: 'https://www.gesui.metro.tokyo.lg.jp/living/fee/keisan/ryokinhyo' },
]);

export const TAX_RATE_MIN = 0;
export const TAX_RATE_MAX = 99;

// 消費税率（整数%、0〜99）
export function validateTaxRate(text) {
  const r = parseIntegerInput(text);
  if (!r.ok) return { ok: false, error: '0〜99の整数で入力してください' };
  if (r.value === null) return { ok: false, error: '消費税率を入力してください' };
  if (r.value < TAX_RATE_MIN || r.value > TAX_RATE_MAX) return { ok: false, error: '0〜99の整数で入力してください' };
  return { ok: true, value: r.value };
}

// 自分の電話番号（数字・ハイフン・＋・かっこ・空白。全角も受け付ける）
export function validatePhone(text) {
  const value = String(text ?? '').normalize('NFKC').trim();
  if (value === '') return { ok: false, error: '電話番号を入力してください' };
  if (!/^[0-9+\-() ]{3,20}$/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, error: '数字とハイフンで入力してください' };
  }
  return { ok: true, value };
}

const yen = n => n.toLocaleString('ja-JP');

const caliberLabel = c => (c === CALIBERS[CALIBERS.length - 1] ? `${c}mm以上` : `${c}mm`);

// 水道 従量料金の口径区分（rates.js の waterClassOf と同じ区切り）
function waterClasses() {
  const order = [];
  for (const c of CALIBERS) {
    const key = waterClassOf(c);
    const found = order.find(x => x.key === key);
    if (found) found.calibers.push(c); else order.push({ key, calibers: [c] });
  }
  return order.map(({ key, calibers }) => {
    const first = calibers[0];
    const last = calibers[calibers.length - 1];
    let label;
    if (last === CALIBERS[CALIBERS.length - 1]) label = `${first}mm以上`;
    else if (calibers.length <= 2) label = `${calibers.join('・')}mm`;
    else label = `${first}〜${last}mm`;
    return { key, label };
  });
}

// 段階の範囲（使用水量 m³）。lower 〜 upTo、最後の段階は「lower m³〜」
function rangeLabel(lower, upTo) {
  return upTo === Infinity ? `${yen(lower)}m³〜` : `${yen(lower)}〜${yen(upTo)}m³`;
}

// 料金表の表示用データ
export function rateTables() {
  const waterBasic = CALIBERS.map(c => ({ caliber: caliberLabel(c), price: WATER_BASIC[c] }));

  const classes = waterClasses();
  let lower = 0;
  const waterMeteredRows = WATER_TIERS.map(t => {
    const row = { range: rangeLabel(lower, t.upTo), prices: classes.map(k => t.price[k.key]) };
    lower = t.upTo + 1;
    return row;
  });

  const sewer = [{ range: rangeLabel(0, SEWER_FLAT_UP_TO), price: SEWER_FLAT, unit: '円（定額）' }];
  lower = SEWER_FLAT_UP_TO + 1;
  for (const t of SEWER_TIERS) {
    sewer.push({ range: rangeLabel(lower, t.upTo), price: t.price, unit: '円/m³' });
    lower = t.upTo + 1;
  }

  return {
    waterBasic,
    waterMetered: { classes: classes.map(k => k.label), rows: waterMeteredRows },
    sewer,
  };
}
