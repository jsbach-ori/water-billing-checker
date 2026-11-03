// 料金表データ（定数）。東京都23区・一般用。金額はすべて税抜・1か月分（SPEC 4章）
// 出典：
//   東京都水道局 https://www.waterworks.metro.tokyo.lg.jp/tetsuduki/ryokin/keisan_23
//   東京都下水道局 https://www.gesui.metro.tokyo.lg.jp/living/fee/keisan/ryokinhyo

// 水道 基本料金（円）。300 は 300mm以上を表す
export const WATER_BASIC = Object.freeze({
  13: 860,
  20: 1170,
  25: 1460,
  30: 3435,
  40: 6865,
  50: 20720,
  75: 45623,
  100: 94568,
  150: 159094,
  200: 349434,
  250: 480135,
  300: 816145,
});

export const CALIBERS = Object.freeze(Object.keys(WATER_BASIC).map(Number));

// 水道 従量料金の口径区分
export function waterClassOf(caliber) {
  if (caliber <= 25) return 'small';   // 13〜25mm
  if (caliber <= 40) return 'medium';  // 30・40mm
  if (caliber <= 75) return 'large';   // 50・75mm
  return 'xlarge';                     // 100mm以上
}

// 水道 従量料金（円/m³）。upTo はその段階の上限水量（m³）
export const WATER_TIERS = Object.freeze([
  { upTo: 5, price: { small: 0, medium: 213, large: 372, xlarge: 404 } },
  { upTo: 10, price: { small: 22, medium: 213, large: 372, xlarge: 404 } },
  { upTo: 20, price: { small: 128, medium: 213, large: 372, xlarge: 404 } },
  { upTo: 30, price: { small: 163, medium: 213, large: 372, xlarge: 404 } },
  { upTo: 50, price: { small: 202, medium: 213, large: 372, xlarge: 404 } },
  { upTo: 100, price: { small: 213, medium: 213, large: 372, xlarge: 404 } },
  { upTo: 200, price: { small: 298, medium: 298, large: 372, xlarge: 404 } },
  { upTo: 1000, price: { small: 372, medium: 372, large: 372, xlarge: 404 } },
  { upTo: Infinity, price: { small: 404, medium: 404, large: 404, xlarge: 404 } },
]);

// 下水道（一般汚水）。8m³までは定額、9m³以上は段階ごとの従量
export const SEWER_FLAT = 560;
export const SEWER_FLAT_HALF = 280;       // 日割り：使用日数が15日以内のときの定額
export const SEWER_HALF_MAX_DAYS = 15;
export const SEWER_FLAT_UP_TO = 8;
export const SEWER_TIERS = Object.freeze([
  { upTo: 20, price: 110 },
  { upTo: 30, price: 140 },
  { upTo: 50, price: 170 },
  { upTo: 100, price: 200 },
  { upTo: 200, price: 230 },
  { upTo: 500, price: 270 },
  { upTo: 1000, price: 310 },
  { upTo: Infinity, price: 345 },
]);

// 基本料金無償化（期間限定措置の試算用）の対象となる口径の上限
export const BASIC_FREE_MAX_CALIBER = 25;
