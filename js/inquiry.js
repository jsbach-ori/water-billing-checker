// 照会入力の確認状態・再確認・期間の自動コピー・無償化の案内（純粋関数。DOMに触れない）
// 判定は calc.js の judgeContract をそのまま使い、渡す回答の値だけを確認状態に応じて組み立てる
import { JUDGE, judgeContract, judgeBuilding, calcBimonthly, parseIsoDate, buildPdfFilename } from './calc.js';
import { parseRow, parseDateText, formatDate, normalizeDateText } from './parse.js';
import { BASIC_FREE_MAX_CALIBER } from './rates.js';

// 保存する確認状態（row.confirm.state）。null は未確認
export const CONFIRM = Object.freeze({ MATCH: 'match', MISMATCH: 'mismatch', STALE: 'stale' });

// 画面に出す状態の文言（判定の4区分に、表示だけの文言を加えたもの）
export const STATUS = Object.freeze({
  UNCONFIRMED: '未確認',
  MATCH: JUDGE.MATCH,
  DIFF: JUDGE.DIFF,
  STALE: '再確認が必要',
  INPUT_ERROR: '入力エラー',
  PERIOD: JUDGE.PERIOD,
});

// 照合方法（結果の表・PDFで、合計だけ照合したのか内訳も照合したのかを区別する）
export const METHOD = Object.freeze({
  TOTAL: '合計で照合',
  BREAKDOWN: '内訳も照合',
  UNCONFIRMED: '未確認',
  STALE: '再確認が必要',
  NONE: '—',
});

// 合計で照合した契約の水道・下水道の判定欄（表示だけ）
export const TOTAL_ONLY = '—（合計で照合）';

// W：内訳（水道・下水道）も一致を確認した契約の状態表示と、「水道局の回答」の水道・下水道の欄（表示だけ）
export const STATUS_PARTS_TEXT = '一致（内訳も確認）';
export const PARTS_ANSWER_TEXT = '計算額どおり';

// 建物合計の水道・下水道で、内訳を確かめた契約が一部だけのときの表示（表示だけ）
export const BUILDING_PARTIAL = '一部のみ';

const ANSWER_FIELDS = Object.freeze(['ansTotal', 'ansWater', 'ansSewer']);
const CONFIRM_STATES = Object.values(CONFIRM);

export function emptyRow() {
  return {
    start: '', end: '', usage: '', basicFree: false,
    ansTotal: '', ansWater: '', ansSewer: '', confirm: null, confirmParts: null,
  };
}

// 保存済みの行を今の形にそろえる。確認状態は正しい形のときだけ残す
// 旧データに回答金額が残っていても、確認状態を推定しない（未確認のまま。金額は保持する）
export function normalizeRow(raw) {
  const row = { ...emptyRow(), ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const field of ['start', 'end', 'usage', ...ANSWER_FIELDS]) {
    row[field] = row[field] === null || row[field] === undefined ? '' : String(row[field]);
  }
  row.start = normalizeDateText(row.start);
  row.end = normalizeDateText(row.end);
  row.basicFree = row.basicFree === true;
  const c = row.confirm;
  const valid = c && typeof c === 'object' && CONFIRM_STATES.includes(c.state) && typeof c.basis === 'string'
    && (c.state !== CONFIRM.STALE || c.from === CONFIRM.MATCH || c.from === CONFIRM.MISMATCH);
  row.confirm = valid ? { ...c } : null;
  // 内訳の確認は、合計の確認が「一致」で、同じ計算条件のときだけ残す（確認したと推定はしない）
  const p = row.confirmParts;
  const partsValid = p && typeof p === 'object' && typeof p.basis === 'string'
    && row.confirm?.state === CONFIRM.MATCH && row.confirm.basis === p.basis;
  row.confirmParts = partsValid ? { basis: p.basis } : null;
  return row;
}

// 確認時の計算条件。これが変わったら再確認が必要になる
// 変換後の値で作るので、日付の書き方を整えただけでは変わらない
export function basisOf(values, caliber, taxRatePercent) {
  return JSON.stringify([
    values.start ?? null, values.end ?? null, values.usage ?? null,
    values.basicFree === true, caliber ?? null, taxRatePercent ?? null,
  ]);
}

// 1契約を評価する。確認後に計算条件が変わっていれば、確認を取り消した行（changed: true）を返す
export function evaluateRow({ row: rawRow, caliber, taxRatePercent }) {
  let row = { ...emptyRow(), ...rawRow };
  const parsed = parseRow(row);
  const v = parsed.values;
  const basis = basisOf(v, caliber, taxRatePercent);

  // 確認を取り消す（値を元に戻しても確認済みには戻らない）
  let changed = false;
  const prev = row.confirm;
  if (prev && (prev.state === CONFIRM.MATCH || prev.state === CONFIRM.MISMATCH) && prev.basis !== basis) {
    // 内訳の確認も一緒に失効させる
    row = { ...row, confirm: { state: CONFIRM.STALE, from: prev.state, basis: prev.basis }, confirmParts: null };
    if (prev.state === CONFIRM.MATCH) {
      // 一致で記録したのは計算額なので消す
      row.ansTotal = '';
      row.ansWater = '';
      row.ansSewer = '';
    }
    changed = true;
  }
  const state = row.confirm?.state ?? null;
  // 内訳の確認は、合計の確認が「一致」で、同じ計算条件のときだけ有効
  const partsChecked = state === CONFIRM.MATCH && row.confirmParts?.basis === row.confirm.basis;
  const answersOpen = state === CONFIRM.MISMATCH
    || (state === CONFIRM.STALE && row.confirm.from === CONFIRM.MISMATCH);

  // 回答欄のエラーは、回答欄が開いているときだけ扱う
  const errors = {};
  for (const [field, message] of Object.entries(parsed.errors)) {
    if (!ANSWER_FIELDS.includes(field) || answersOpen) errors[field] = message;
  }
  const calcFieldError = ['start', 'end', 'usage'].some(f => f in errors);

  // 判定関数に渡す回答
  const feed = { ansTotal: null, ansWater: null, ansSewer: null };
  if (state === CONFIRM.MATCH) {
    feed.ansTotal = v.ansTotal ?? null;
  } else if (state === CONFIRM.MISMATCH) {
    feed.ansTotal = v.ansTotal ?? null;
    feed.ansWater = v.ansWater ?? null;
    feed.ansSewer = v.ansSewer ?? null;
  }

  let entry;
  if (Object.keys(errors).length > 0) {
    entry = { inputError: true };
  } else {
    try {
      const input = { caliber, taxRatePercent, basicFree: v.basicFree, start: v.start, end: v.end, usage: v.usage };
      entry = judgeContract({ ...input, ...feed });
      // 内訳も一致を確認したときは、水道・下水道の回答として計算額を渡す（judgeContract は変えない）
      if (partsChecked && entry.result && entry.overall === JUDGE.MATCH) {
        feed.ansWater = entry.water.calc;
        feed.ansSewer = entry.sewer.calc;
        entry = judgeContract({ ...input, ...feed });
      }
    } catch (err) {
      errors.caliber = err.message; // マスタの口径が不正など
      entry = { inputError: true };
    }
  }

  const periodError = !calcFieldError && v.start && v.end && parseIsoDate(v.end) <= parseIsoDate(v.start);
  const canConfirm = !calcFieldError && !('caliber' in errors) && !periodError
    && v.start !== null && v.end !== null && v.usage !== null;

  let status;
  if (entry.inputError) status = STATUS.INPUT_ERROR;
  else if (entry.overall === JUDGE.PERIOD) status = STATUS.PERIOD;
  else if (state === CONFIRM.STALE) status = STATUS.STALE;
  else if (state === CONFIRM.MATCH || state === CONFIRM.MISMATCH) {
    status = entry.overall === JUDGE.BLANK ? STATUS.UNCONFIRMED : entry.overall;
  } else status = STATUS.UNCONFIRMED;

  const answered = status === STATUS.MATCH || status === STATUS.DIFF;
  let method;
  if (status === STATUS.INPUT_ERROR || status === STATUS.PERIOD) method = METHOD.NONE;
  else if (status === STATUS.STALE) method = METHOD.STALE;
  else if (!answered) method = METHOD.UNCONFIRMED;
  else method = feed.ansWater !== null || feed.ansSewer !== null ? METHOD.BREAKDOWN : METHOD.TOTAL;

  const partJudge = key => {
    if (entry.inputError) return STATUS.INPUT_ERROR;
    if (answered && entry[key].answer === null) return TOTAL_ONLY;
    return entry[key].judge;
  };

  // 無償化の案内：チェックOFF・口径25mm以下・［違う］で入力した合計が無償化した場合の計算額と一致
  let suggestBasicFree = false;
  if (state === CONFIRM.MISMATCH && answered && !v.basicFree && caliber <= BASIC_FREE_MAX_CALIBER
      && entry.total.answer !== null) {
    const free = calcBimonthly({ caliber, usage: v.usage, taxRatePercent, basicFree: true });
    suggestBasicFree = entry.total.answer === free.total;
  }

  return {
    row,
    changed,
    state,
    errors,
    values: v,
    entry,
    status,
    method,
    waterJudge: partJudge('water'),
    sewerJudge: partJudge('sewer'),
    canConfirm,
    // 内訳の確認：チェック欄を押せるか、チェックが有効か
    canConfirmParts: state === CONFIRM.MATCH && status === STATUS.MATCH,
    partsConfirmed: partsChecked && status === STATUS.MATCH && feed.ansWater !== null,
    basis,
    calcTotal: entry.inputError || !entry.result ? null : entry.result.total,
    answersOpen,
    suggestBasicFree,
  };
}

// ［一致］［違う］を押したときの行。ev は同じ行の evaluateRow の結果
export function applyConfirm(row, action, ev) {
  if (!ev.canConfirm || ev.calcTotal === null) return row;
  if (action === CONFIRM.MATCH) {
    // 計算した合計を水道局の回答（合計）として記録する。内訳の回答入力は消す
    // 同じ条件ですでに一致を確認していれば、内訳の確認は残す。それ以外（違う・再確認が必要から）は未確認に戻す
    const keepParts = row.confirm?.state === CONFIRM.MATCH && row.confirm.basis === ev.basis
      && row.confirmParts?.basis === ev.basis;
    return {
      ...row, ansTotal: String(ev.calcTotal), ansWater: '', ansSewer: '',
      confirm: { state: CONFIRM.MATCH, basis: ev.basis },
      confirmParts: keepParts ? { basis: ev.basis } : null,
    };
  }
  if (action === CONFIRM.MISMATCH) {
    const c = row.confirm;
    const fromMatch = c?.state === CONFIRM.MATCH || (c?.state === CONFIRM.STALE && c.from === CONFIRM.MATCH);
    return {
      ...row,
      ...(fromMatch ? { ansTotal: '', ansWater: '', ansSewer: '' } : {}),
      confirm: { state: CONFIRM.MISMATCH, basis: ev.basis },
      confirmParts: null,
    };
  }
  return row;
}

// W：「内訳（水道・下水道）も一致を確認した」のチェックを切り替えたときの行。ev は同じ行の evaluateRow の結果
// チェックできるのは、合計の確認が「一致」のときだけ（それ以外では行を変えない）。外すのはいつでもできる
export function applyPartsConfirm(row, checked, ev) {
  if (!checked) return row.confirmParts ? { ...row, confirmParts: null } : row;
  if (!ev.canConfirmParts) return row;
  return { ...row, confirmParts: { basis: ev.basis } };
}

// AF：［違う］で入力した水道＋下水道が、水道局の合計と合わないか（表示だけ。judgeContract と判定は変えない）
// 回答欄が開いていて、合計・水道・下水道の3つとも正しく入力されているときだけ調べる（片方だけなら出さない）
// 戻り値：合わなければ { sum, total }、それ以外は null
export function breakdownSumMismatch(ev) {
  if (!ev.answersOpen) return null;
  if (ANSWER_FIELDS.some(f => f in ev.errors)) return null;
  const { ansTotal, ansWater, ansSewer } = ev.values;
  if ([ansTotal, ansWater, ansSewer].some(v => typeof v !== 'number')) return null;
  const sum = ansWater + ansSewer;
  return sum === ansTotal ? null : { sum, total: ansTotal };
}

// 建物合計の列の「水道局の回答」（水道・下水道）を「計算額どおり」と表示するか
// 回答のある契約が1件以上あり、そのすべてが内訳も一致を確認した契約のとき true
export function buildingPartsAnswerIsCalc(evaluations, part) {
  const answered = evaluations.filter(ev => ev && !ev.entry.inputError && ev.entry[part].answer !== null);
  return answered.length > 0 && answered.every(ev => ev.partsConfirmed);
}

// ［違う］の回答欄に入力したときの行。再確認が必要な状態で金額を入れ直したら、［違う］として確認し直す
export function applyAnswerInput(row, field, value, ev) {
  const next = { ...row, [field]: value };
  const c = row.confirm;
  if (c?.state === CONFIRM.STALE && c.from === CONFIRM.MISMATCH && ev.canConfirm) {
    next.confirm = { state: CONFIRM.MISMATCH, basis: ev.basis };
  }
  return next;
}

// 契約1の期間を、ほかの契約の空欄にだけコピーする
// 契約1の開始日・終了日が両方正しく、終了日が開始日より後のときだけコピーする
export function fillBlankPeriods(rows, sourceId, targetIds) {
  const src = rows[sourceId];
  if (!src) return { rows, filled: [] };
  const s = parseDateText(src.start);
  const e = parseDateText(src.end);
  if (!s.ok || !e.ok || s.value === null || e.value === null
      || parseIsoDate(e.value) <= parseIsoDate(s.value)) {
    return { rows, filled: [] };
  }
  const next = { ...rows };
  const filled = [];
  for (const id of targetIds) {
    if (id === sourceId) continue;
    const row = { ...emptyRow(), ...(rows[id] ?? {}) };
    const blankStart = String(row.start ?? '').trim() === '';
    const blankEnd = String(row.end ?? '').trim() === '';
    if (!blankStart && !blankEnd) continue;
    next[id] = {
      ...row,
      start: blankStart ? formatDate(s.value) : row.start,
      end: blankEnd ? formatDate(e.value) : row.end,
    };
    filled.push(id);
  }
  return { rows: next, filled };
}

// PDFファイル名（SPEC 7.3）。rows は契約の順に並べた照会入力（日付は入力欄の文字列）
// 正しい日付は YYYY-MM-DD に変換して buildPdfFilename に渡す。読めない日付は入力のまま渡し、理由を返させる
export function pdfFilenameForRows(buildingId, rows) {
  const toDate = text => {
    const r = parseDateText(text);
    if (r.ok) return r.value;
    return String(text);
  };
  return buildPdfFilename(buildingId, rows.map(row => ({ start: toDate(row?.start), end: toDate(row?.end) })));
}

// 建物合計の水道・下水道の判定（表示用）。「—（合計で照合）」の契約を除いて優先順位で決める
// evaluations は evaluateRow の結果（契約が無い列は null）
export function buildingPartJudge(evaluations, part) {
  const judges = evaluations.filter(Boolean).map(ev => {
    const j = part === 'water' ? ev.waterJudge : ev.sewerJudge;
    return j === STATUS.INPUT_ERROR ? JUDGE.BLANK : j; // 入力エラーは「未入力」として扱う
  });
  if (judges.length === 0) return null;
  const rest = judges.filter(j => j !== TOTAL_ONLY);
  return rest.length === 0 ? TOTAL_ONLY : judgeBuilding(rest);
}

// 建物合計の水道・下水道で、内訳を確かめた契約の範囲（表示用。sumBuilding と判定は変えない）
// 'partial'：内訳を確かめた契約（［違う］で内訳を入力、または［一致］＋内訳も確認）と、
//            合計だけで照合した契約（判定欄が「合計で照合」）が混ざっている
// 'all'    ：内訳を確かめた契約があり、合計だけで照合した契約は無い
// 'none'   ：内訳を確かめた契約が無い
export function buildingPartScope(evaluations, part) {
  const evs = evaluations.filter(ev => ev && !ev.entry.inputError);
  const checked = evs.some(ev => ev.entry[part].answer !== null);
  const totalOnly = evs.some(ev => (part === 'water' ? ev.waterJudge : ev.sewerJudge) === TOTAL_ONLY);
  if (!checked) return 'none';
  return totalOnly ? 'partial' : 'all';
}

// 建物合計の水道・下水道の判定欄に出す値
// 一部だけのときは、建物全体を確かめたように読めないよう「一致」を「一部のみ」にする
// 差異あり・期間エラー・未入力は、そのまま出す（確かめた契約の差異などを目立たせるため）
export function buildingPartJudgeShown(evaluations, part) {
  const judge = buildingPartJudge(evaluations, part);
  if (buildingPartScope(evaluations, part) !== 'partial') return judge;
  return judge === JUDGE.MATCH ? BUILDING_PARTIAL : judge;
}

// 水道・下水道の内訳の回答（水道局から聞いた金額）がある契約が1件でもあるか
// 1件も無ければ、印刷時に結果の表の「水道局の回答」「差額」の行（水道・下水道）を出さない
export function hasPartAnswers(evaluations) {
  return evaluations.some(ev => ev && !ev.entry.inputError
    && (ev.entry.water.answer !== null || ev.entry.sewer.answer !== null));
}

// 確認が済んでいない契約（PDF保存の横に注意として出す）
const PENDING_STATUSES = new Set([STATUS.STALE, STATUS.UNCONFIRMED, STATUS.INPUT_ERROR, STATUS.PERIOD]);

// titles は契約名（表示名）、evaluations は evaluateRow の結果（同じ順）
// 戻り値：[{ title, status }]（契約の順）
export function pendingContracts(titles, evaluations) {
  return evaluations
    .map((ev, i) => (ev && PENDING_STATUSES.has(ev.status) ? { title: titles[i], status: ev.status } : null))
    .filter(Boolean);
}

// 基本料金無償化の入力欄を表示しない設定のとき、照会入力に残っている無償化のチェックをすべて外す
// 戻り値：{ rows, changed }（changed はチェックを外した契約IDの配列）。確認済みの契約は、
// 計算条件が変わるので evaluateRow で「再確認が必要」になる（既存の仕組み）
export function clearBasicFreeChecks(rows) {
  const next = { ...rows };
  const changed = [];
  for (const [id, row] of Object.entries(rows)) {
    if (row?.basicFree === true) {
      next[id] = { ...row, basicFree: false };
      changed.push(id);
    }
  }
  return { rows: changed.length ? next : rows, changed };
}
