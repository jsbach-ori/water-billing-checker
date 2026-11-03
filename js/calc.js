// 計算・判定・ファイル名生成（純粋関数。DOMに触れない）
// 金額は整数演算で計算する（SPEC 3章・4章・7章）
import {
  WATER_BASIC, waterClassOf, WATER_TIERS,
  SEWER_FLAT, SEWER_FLAT_HALF, SEWER_HALF_MAX_DAYS, SEWER_FLAT_UP_TO, SEWER_TIERS,
  BASIC_FREE_MAX_CALIBER,
} from './rates.js';

export const JUDGE = Object.freeze({
  MATCH: '一致',
  DIFF: '差異あり',
  BLANK: '未入力',
  PERIOD: '期間エラー',
});

// 建物合計の判定で重いものから順に並べる（SPEC 7.2）
const JUDGE_PRIORITY = [JUDGE.PERIOD, JUDGE.DIFF, JUDGE.BLANK, JUDGE.MATCH];

const MS_PER_DAY = 86400000;

// ---------- 基本の計算 ----------

// 税込 = floor(税抜 × (100 + 税率) / 100)
export function withTax(pretax, taxRatePercent) {
  return Math.floor(pretax * (100 + taxRatePercent) / 100);
}

// 2か月の使用水量を [1か月目, 2か月目] に分ける。奇数なら1か月目に1m³多く配分する
export function splitUsage(usage) {
  assertUsage(usage);
  const first = Math.ceil(usage / 2);
  return [first, usage - first];
}

export function waterBasic(caliber) {
  const key = caliber >= 300 ? 300 : caliber;
  const amount = WATER_BASIC[key];
  if (amount === undefined) throw new RangeError(`未対応の口径です: ${caliber}`);
  return amount;
}

// 水道 従量料金（1か月・税抜）
export function waterMetered(caliber, usage) {
  waterBasic(caliber); // 口径の検証
  const cls = waterClassOf(caliber);
  return tiered(usage, 0, WATER_TIERS.map(t => ({ upTo: t.upTo, price: t.price[cls] })));
}

// 下水道 従量料金（1か月・税抜。8m³までの定額部分を除く）
export function sewerMetered(usage) {
  return tiered(usage, SEWER_FLAT_UP_TO, SEWER_TIERS);
}

function tiered(usage, start, tiers) {
  let sum = 0;
  let lower = start;
  for (const { upTo, price } of tiers) {
    if (usage <= lower) break;
    sum += (Math.min(usage, upTo) - lower) * price;
    lower = upTo;
  }
  return sum;
}

function assertUsage(usage) {
  if (!Number.isInteger(usage) || usage < 0) {
    throw new RangeError(`使用水量は0以上の整数で指定してください: ${usage}`);
  }
}

// ---------- 2か月分の計算（SPEC 4.4） ----------

export function calcBimonthly({ caliber, usage, taxRatePercent, basicFree = false }) {
  const months = splitUsage(usage);
  const free = basicFree && caliber <= BASIC_FREE_MAX_CALIBER;
  const basicPerMonth = free ? 0 : waterBasic(caliber);

  const monthly = months.map(q => ({
    usage: q,
    waterBase: basicPerMonth,
    waterMetered: waterMetered(caliber, q),
    sewerBase: SEWER_FLAT,
    sewerMetered: sewerMetered(q),
  }));

  const water = summarize(
    monthly.reduce((s, m) => s + m.waterBase, 0),
    monthly.reduce((s, m) => s + m.waterMetered, 0),
    taxRatePercent,
  );
  const sewer = summarize(
    monthly.reduce((s, m) => s + m.sewerBase, 0),
    monthly.reduce((s, m) => s + m.sewerMetered, 0),
    taxRatePercent,
  );

  return { months, monthly, water, sewer, total: water.total + sewer.total };
}

function summarize(base, metered, taxRatePercent) {
  const total = withTax(base + metered, taxRatePercent);
  return { base, metered, tax: total - (base + metered), total };
}

// ---------- 日割り計算（1か月分。SPEC 4.5） ----------

export function calcProrated({ caliber, daysInMonth, daysUsed, usage, taxRatePercent }) {
  assertUsage(usage);
  if (daysUsed === 0) {
    // 使わない月（Excel版と同じく0円）
    return {
      converted: 0, waterMonthlyPretax: 0, waterProratedPretax: 0, waterTotal: 0,
      sewerBase: 0, sewerMetered: 0, sewerTotal: 0, total: 0,
    };
  }
  const converted = Math.floor(usage * daysInMonth / daysUsed);
  const waterMonthlyPretax = waterBasic(caliber) + waterMetered(caliber, converted);
  const waterProratedPretax = Math.floor(waterMonthlyPretax * daysUsed / daysInMonth);
  const waterTotal = withTax(waterProratedPretax, taxRatePercent);

  const sewerBase = daysUsed <= SEWER_HALF_MAX_DAYS ? SEWER_FLAT_HALF : SEWER_FLAT;
  const sewerMeteredAmount = sewerMetered(usage);
  const sewerTotal = withTax(sewerBase + sewerMeteredAmount, taxRatePercent);

  return {
    converted,
    waterMonthlyPretax,
    waterProratedPretax,
    waterTotal,
    sewerBase,
    sewerMetered: sewerMeteredAmount,
    sewerTotal,
    total: waterTotal + sewerTotal,
  };
}

// ---------- 日付 ----------

// 'YYYY-MM-DD' を UTC のミリ秒に変換する。不正な日付は null
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ms;
}

// 日数 = 終了日 − 開始日（Excel版と同じ）。どちらかが無ければ null
export function daysBetween(start, end) {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (s === null || e === null) return null;
  return Math.round((e - s) / MS_PER_DAY);
}

// その月の暦日数
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isPeriodError(start, end) {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  return s !== null && e !== null && e <= s;
}

// ---------- 判定（SPEC 7.1・7.2） ----------

const isBlank = v => v === null || v === undefined || v === '';

function judgeAmount(answer, diff) {
  if (isBlank(answer)) return JUDGE.BLANK;
  return diff === 0 ? JUDGE.MATCH : JUDGE.DIFF;
}

const diffOf = (answer, calc) => (isBlank(answer) || calc === null ? null : answer - calc);

// 1契約の計算と判定。口径が未設定（契約が存在しない）なら null を返す
export function judgeContract({
  caliber, basicFree = false, taxRatePercent,
  start, end, usage, ansWater, ansSewer, ansTotal,
}) {
  if (isBlank(caliber)) return null;

  const result = isBlank(usage) ? null : calcBimonthly({ caliber, usage, taxRatePercent, basicFree });
  const calcWater = result ? result.water.total : null;
  const calcSewer = result ? result.sewer.total : null;
  const calcTotal = result ? result.total : null;

  const answerTotal = !isBlank(ansTotal)
    ? ansTotal
    : (!isBlank(ansWater) && !isBlank(ansSewer) ? ansWater + ansSewer : null);

  const water = { calc: calcWater, answer: isBlank(ansWater) ? null : ansWater, diff: diffOf(ansWater, calcWater) };
  const sewer = { calc: calcSewer, answer: isBlank(ansSewer) ? null : ansSewer, diff: diffOf(ansSewer, calcSewer) };
  const total = { calc: calcTotal, answer: answerTotal, diff: diffOf(answerTotal, calcTotal) };

  let overall;
  if (isPeriodError(start, end)) {
    water.judge = sewer.judge = overall = JUDGE.PERIOD;
  } else if (isBlank(usage) || isBlank(start) || isBlank(end)) {
    water.judge = sewer.judge = overall = JUDGE.BLANK;
  } else {
    water.judge = judgeAmount(water.answer, water.diff);
    sewer.judge = judgeAmount(sewer.answer, sewer.diff);
    if (water.judge === JUDGE.DIFF || sewer.judge === JUDGE.DIFF) {
      overall = JUDGE.DIFF; // 合計の差額が相殺されて0でも差異あり
    } else {
      overall = judgeAmount(total.answer, total.diff);
    }
  }

  return { result, water, sewer, total, overall };
}

// 建物合計の判定。null（契約なし）は無視する。対象が無ければ null
export function judgeBuilding(overalls) {
  const present = overalls.filter(j => !isBlank(j));
  if (present.length === 0) return null;
  return JUDGE_PRIORITY.find(j => present.includes(j)) ?? null;
}

// 建物合計の金額と判定（Excel版の「建物合計」列と同じ集計）
// entries の各要素は judgeContract の結果、{ inputError: true }（入力エラーの契約）、null（契約なし）のどれか
// 金額は値のある契約だけを合計し、1件も無ければ null。入力エラーの契約は判定で「未入力」として扱う
export function sumBuilding(entries) {
  const present = entries.filter(e => e !== null && e !== undefined);
  if (present.length === 0) return null;
  const valid = present.filter(e => !e.inputError);

  const judgeOf = pick => judgeBuilding(present.map(e => (e.inputError ? JUDGE.BLANK : pick(e))));
  const sumOf = pick => {
    const values = valid.map(pick).filter(v => v !== null && v !== undefined);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };
  const part = key => ({
    base: sumOf(e => e.result?.[key].base),
    metered: sumOf(e => e.result?.[key].metered),
    tax: sumOf(e => e.result?.[key].tax),
    calc: sumOf(e => e[key].calc),
    answer: sumOf(e => e[key].answer),
    diff: sumOf(e => e[key].diff),
    judge: judgeOf(e => e[key].judge),
  });

  return {
    water: part('water'),
    sewer: part('sewer'),
    total: {
      calc: sumOf(e => e.total.calc),
      answer: sumOf(e => e.total.answer),
      diff: sumOf(e => e.total.diff),
    },
    overall: judgeOf(e => e.overall),
  };
}

// ---------- PDFファイル名（SPEC 7.3） ----------

// 成功時は { ok: true, filename }、生成しないときは { ok: false, reason }
export function buildPdfFilename(buildingId, contracts) {
  if (isBlank(buildingId)) return { ok: false, reason: '物件番号を選択してください' };

  const periods = contracts.map(c => ({
    start: isBlank(c.start) ? null : c.start,
    end: isBlank(c.end) ? null : c.end,
  }));
  if (periods.every(p => p.start === null && p.end === null)) {
    return { ok: false, reason: '今回の期間を入力してください' };
  }
  if (periods.some(p => (p.start === null) !== (p.end === null))) {
    return { ok: false, reason: '開始日・終了日の両方を入力してください' };
  }
  const filled = periods.filter(p => p.start !== null);
  if (filled.some(p => parseIsoDate(p.start) === null || parseIsoDate(p.end) === null)) {
    return { ok: false, reason: '日付の形式が正しくない契約があります' };
  }
  if (filled.some(p => isPeriodError(p.start, p.end))) {
    return { ok: false, reason: '終了日が開始日以前の契約があります' };
  }

  // 開始日が最も早い契約（同じ開始日なら契約の順番で最初のもの）
  const earliest = filled.reduce((a, b) => (parseIsoDate(b.start) < parseIsoDate(a.start) ? b : a));
  const startText = earliest.start.replaceAll('-', '');
  const endText = earliest.end.slice(5).replace('-', '');
  const count = filled.length > 1 ? `（${filled.length}件）` : '';
  return { ok: true, filename: `${buildingId}水道${startText}-${endText}${count}.pdf` };
}
