// 画面制御
import { sumBuilding, daysBetween } from './calc.js';
import { formatDate, normalizeDateText, parseDateText, parseIntegerInput } from './parse.js';
import {
  CONFIRM, STATUS, TOTAL_ONLY, STATUS_PARTS_TEXT, PARTS_ANSWER_TEXT, evaluateRow, applyConfirm, applyAnswerInput,
  applyPartsConfirm, buildingPartsAnswerIsCalc, breakdownSumMismatch, fillBlankPeriods,
  BUILDING_PARTIAL, buildingPartScope, buildingPartJudgeShown, pdfFilenameForRows, hasPartAnswers, pendingContracts, clearBasicFreeChecks,
} from './inquiry.js';
import { nextFocus } from './tab-order.js';
import {
  isStorageAvailable, loadMaster, saveMaster, sampleMaster, newContractId, loadInquiry, saveInquiry,
  emptyRow, emptyInquiry, hasInquiryInput, clearInquiry,
  loadTimer, saveTimer, loadTimelogs, saveTimelogs, newLogId,
} from './store.js';
import {
  MODE_LABEL, startTimer, elapsedSeconds, phoneSecondsOf, isPhoneActive, togglePhone,
  finishTimer, manualLog, summarizeLogs, formatClock, formatDuration, formatDateTime, toCsv, csvFilename,
  DELETED_LABEL,
} from './timer.js';
import {
  MAX_CONTRACTS, validateBuilding, validateContract, buildingDraft, contractDraft, contractsOfBuilding,
  addBuilding, updateBuilding, deleteBuilding, addContract, updateContract, deleteContract, moveContract,
  overLimitMessage, normalizeCustomerNo, CUSTOMER_NO_PLACEHOLDER, CUSTOMER_NO_HINT, visibleErrors, touchField,
} from './master.js';
import { validateTaxRate, validatePhone, rateTables, RATE_SOURCES } from './settings.js';
import { CALIBERS } from './rates.js';
import { BASIC_FREE_MAX_CALIBER } from './rates.js';


// 照会入力の表で Tab が縦に進む順番（契約ごと）
const SEQ = Object.freeze({
  start: 1, end: 2, usage: 3, basicFree: 4, match: 5, mismatch: 6, parts: 7,
  ansTotal: 8, breakdown: 9, ansWater: 10, ansSewer: 11,
});

// 日付欄の見本。入力済みの日付と見間違えないように「例：」を付ける
const DATE_PLACEHOLDER = '例：20260820';

const BASIC_FREE_HELP = '東京都が2026年夏に実施した期間限定の措置です。口径13・20・25mmの契約は、水道の基本料金が4か月分無償になりました（6月1日検針分から。検針月により5〜6月分と7〜8月分、または6〜7月分と8〜9月分）。申請は不要です。水道局から「基本料金は無償」と言われた場合だけチェックしてください。';
const BASIC_FREE_SOURCE = '出典：東京都水道局 報道発表（2026年5月15日）';

const state = {
  storageOk: isStorageAvailable(),
  master: loadMaster(),
  inquiry: loadInquiry(),
  timer: loadTimer(),        // 計測中の状態（null＝計測していない）
  timelogs: loadTimelogs(),  // 作業時間の記録
};

// 画面だけの状態（保存しない）
const ui = {
  openBreakdown: new Set(),
  printing: false,       // 印刷中（document.title を変えている間）
  timerMessage: '',      // 「所要時間 ○分○秒 を記録しました」など
  manualErrors: {},      // 手作業の記録の入力エラー
};

// ---------- 共通 ----------

const $ = (sel, root = document) => root.querySelector(sel);

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// 金額の表示。文字列（「—」など）はそのまま
const yen = v => {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : v.toLocaleString('ja-JP');
};

const signedYen = v => (v > 0 ? `+${yen(v)}` : yen(v));

// Y・Z：途中で改行させない文字のかたまり（金額と「円」、日付と「〜」）。中身はエスケープ済みの文字列
const nowrap = html => `<span class="nowrap">${html}</span>`;

// Z：期間の表示。折り返すときは「〜」のあとで改行し、日付の途中では切らない
// AD：2行になるときは、1行目の「開始日〜」は左寄せ、2行目の終了日は右寄せ（1行に収まるときは今のまま）
const periodHtml = (start, end) =>
  `<span class="period">${nowrap(`${esc(formatDate(start))}〜`)}<span class="nowrap period-end">${esc(formatDate(end))}</span></span>`;

// AB：状態の表示。「一致（内訳も確認）」は、折り返すときはカッコの前で改行する
function statusHtml(text) {
  const i = text.indexOf('（');
  if (i <= 0) return esc(text);
  return `${esc(text.slice(0, i))}<span class="status-sub">${esc(text.slice(i))}</span>`;
}

const telHref = phone => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

const STATUS_CLASS = {
  [STATUS.MATCH]: 'j-match',
  [STATUS.DIFF]: 'j-diff',
  [STATUS.PERIOD]: 'j-period',
  [STATUS.INPUT_ERROR]: 'j-error',
  [STATUS.UNCONFIRMED]: 'j-blank',
  [STATUS.STALE]: 'j-stale',
  '未入力': 'j-blank',
  [TOTAL_ONLY]: 'j-na',
};

// 契約が無い列のセル（印刷では列ごと出さない）
const EMPTY_CELL = '<td class="col-empty"></td>';

// 合計で照合した契約の水道・下水道の判定欄に出す文言（画面・印刷とも。小さなグレーの文字）
const TOTAL_ONLY_TEXT = '合計で照合';

function judgeCell(label) {
  if (!label) return '<td></td>';
  if (label === TOTAL_ONLY) return `<td class="judge judge-total-only">${TOTAL_ONLY_TEXT}</td>`;
  if (label === BUILDING_PARTIAL) return `<td class="judge judge-total-only">${BUILDING_PARTIAL}</td>`;
  return `<td class="judge ${STATUS_CLASS[label] ?? ''}">${esc(label)}</td>`;
}

// 印刷用：入力欄の値を、同じセルの中で折り返す文字（.print-value）に写す
// 入力欄そのものは印刷しない（入力欄の幅がセルより広いと、数字が隣の列にはみ出すため）
function syncPrintValues() {
  for (const span of document.querySelectorAll('#tab-check .print-value')) {
    const input = span.previousElementSibling;
    span.textContent = input && 'value' in input ? printText(input) : '';
  }
}

// AE：水道局の回答（合計・水道・下水道）は「21,754円」の形で印刷する。読めない値は入力のまま
function printText(input) {
  if (!String(input.dataset?.field ?? '').startsWith('ans')) return input.value;
  const r = parseIntegerInput(input.value);
  return r.ok && r.value !== null ? `${yen(r.value)}円` : input.value;
}

// 基本料金無償化の入力欄を表示するか（設定。初期値オフ）
const showBasicFree = () => state.master.settings.showBasicFree === true;

// 無償化の入力欄を表示しない設定なら、照会入力に残っているチェックをすべて外して保存する
function applyBasicFreeSetting() {
  if (showBasicFree()) return;
  const { rows, changed } = clearBasicFreeChecks(state.inquiry.rows);
  if (changed.length === 0) return;
  state.inquiry.rows = rows;
  persistInquiry();
}

function persistInquiry() {
  saveInquiry(state.inquiry);
}

function currentBuilding() {
  return state.master.buildings.find(b => b.id === state.inquiry.buildingId) ?? null;
}

function contractsOf(buildingId) {
  return state.master.contracts.filter(c => c.buildingId === buildingId);
}

function displayedContracts() {
  const building = currentBuilding();
  return building ? contractsOf(building.id).slice(0, MAX_CONTRACTS) : [];
}

function rowOf(contractId) {
  return { ...emptyRow(), ...(state.inquiry.rows[contractId] ?? {}) };
}

function setRow(contractId, row) {
  state.inquiry.rows[contractId] = row;
}

// 契約名（表示名）。空欄なら「契約1」など
function contractTitle(contract, index) {
  const label = String(contract.label ?? '').trim();
  return label === '' ? `契約${index + 1}` : label;
}

function evaluateAll(contracts) {
  const taxRatePercent = state.master.settings.taxRatePercent;
  return contracts.map(c => evaluateRow({ row: rowOf(c.id), caliber: c.caliber, taxRatePercent }));
}

// ---------- タブ ----------

function setupTabs() {
  for (const btn of document.querySelectorAll('.tabs [data-tab]')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.tabs [data-tab]')) {
        const selected = b === btn;
        b.setAttribute('aria-selected', String(selected));
        $(`#tab-${b.dataset.tab}`).hidden = !selected;
      }
    });
  }
}

// ---------- 料金確認タブ ----------

function renderCheckTab() {
  const panel = $('#tab-check');
  const building = currentBuilding();
  const all = building ? contractsOf(building.id) : [];
  const contracts = all.slice(0, MAX_CONTRACTS);
  const { settings } = state.master;
  const holders = [...new Set(contracts.map(c => c.holder))];
  const sameHolder = holders.length === 1;

  panel.innerHTML = `
    ${state.storageOk ? '' : '<p class="notice notice-warn">この環境では入力内容を保存できません。リロードすると入力が消えます。</p>'}

    <div class="top-grid">
    <div class="top-main">
    <section class="block">
      <h2>物件情報</h2>
      <div class="building-row">
        <label>物件番号
          <select id="building-select">
            <option value="">（物件を選択してください）</option>
            ${state.master.buildings.map(b => `
              <option value="${esc(b.id)}" ${building && b.id === building.id ? 'selected' : ''}>${esc(b.id)} ${esc(b.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${building ? `
        <dl class="info">
          <dt>物件名</dt><dd>${esc(building.name)}</dd>
          <dt>契約住所</dt><dd>${esc(building.address)}</dd>
          <dt>契約件数</dt><dd>${all.length}件</dd>
          ${sameHolder ? `<dt>契約者名</dt><dd>${esc(holders[0])}</dd>` : ''}
        </dl>
        ${overLimitMessage(all.length) ? `<p class="notice notice-warn">${esc(overLimitMessage(all.length))}</p>` : ''}
      ` : ''}
    </section>

    </div>
    <aside class="guide no-print" aria-label="使い方と連絡先">
      <p>「水道使用量のお知らせ」が届いていない場合、<br>最新の期間の使用量・合計金額を電話で問い合わせます。</p>
      <p class="guide-phone">水道局 お客さまセンター<br>
        <a href="${esc(telHref(settings.bureauPhone))}" class="guide-tel">${esc(settings.bureauPhone)}</a>
        <span class="guide-hours">（${esc(settings.bureauHours)}）</span></p>
      <p>電話で聞かれる項目：お客様番号／住所／契約者名／自分の電話番号</p>
      <p class="guide-phone">自分の電話番号<br>
        <a href="${esc(telHref(settings.myPhone))}" class="guide-tel">${esc(settings.myPhone)}</a></p>
    </aside>
    </div>

    ${building ? renderContractSections(contracts, sameHolder) : '<p class="notice">物件番号を選択してください。</p>'}
  `;

  if (building) updateAll();
}

// 表の右端の列：計算結果の表は「建物合計」、ほかの表は罫線も文字もない空の列（契約の列の位置を上下の表でそろえる）
const SPACER_CELL = '<td class="col-spacer" aria-hidden="true"></td>';
const TOTAL_HEAD = '<th scope="col" class="col-total">建物合計</th>';
const SPACER_HEAD = '<th class="col-spacer" aria-hidden="true"></th>';

// 列見出し：1行目に契約名、2行目にお客様番号（電話の最初に読み上げるので大きく表示する。前に小さくラベルを付ける）
function columnHeaders(contracts, extra = SPACER_HEAD) {
  const cols = Array.from({ length: MAX_CONTRACTS }, (_, i) => {
    const c = contracts[i];
    if (!c) return `<th scope="col" class="contract-head empty col-empty">契約${i + 1}</th>`;
    return `<th scope="col" class="contract-head">
      <span class="contract-title">${esc(contractTitle(c, i))}</span>
      <span class="contract-no"><span class="contract-no-label">お客様番号</span>
        <span class="contract-no-value">${esc(c.customerNo)}</span></span></th>`;
  }).join('');
  return `<tr><th scope="col" class="col-head">項目</th>${cols}${extra}</tr>`;
}

// 契約1〜5の列を作る。契約が無い列は空欄
function eachColumn(contracts, fn) {
  return Array.from({ length: MAX_CONTRACTS }, (_, i) => (contracts[i] ? fn(contracts[i], i) : EMPTY_CELL)).join('');
}

const seqAttrs = (index, key) => `data-seq-col="${index}" data-seq-order="${SEQ[key]}"`;

function textInput(c, index, field, cls, attrs = '') {
  return `<input type="text" class="${cls}" data-cid="${esc(c.id)}" data-field="${field}"
      value="${esc(rowOf(c.id)[field])}" autocomplete="off" ${seqAttrs(index, field)} ${attrs}><span
      class="print-value${cls.includes('num-input') ? ' num' : ''}" aria-hidden="true"></span>
    <span class="field-error" data-err-for="${esc(c.id)}:${field}"></span>`;
}

function renderContractSections(contracts, sameHolder) {
  const inq = state.inquiry;
  const row = (label, fn, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th>${eachColumn(contracts, fn)}${SPACER_CELL}</tr>`;

  return `
    <section class="block">
      <h2>契約情報と照会結果の入力</h2>
      <p class="legend no-print">入力欄の色：
        <span class="swatch sw-required">黄色</span>＝必須（開始日・終了日・使用水量）／
        <span class="swatch sw-answer">水色</span>＝水道局の回答（［違う］のとき）／
        <span class="swatch sw-optional">白</span>＝任意（問い合わせ日・${showBasicFree() ? '基本料金無償化・' : ''}内訳の確認・対応者メモ）／
        <span class="swatch sw-error">赤枠</span>＝エラー（最優先で直してください）</p>
      <p class="hint no-print">お客様番号を伝えて、期間と使用水量を入力します。計算額の合計が水道局の金額と同じなら［一致］、違えば［違う］を押して水道局の金額を入力します。日付は 2026/08/20 や 20260820 の形で入力できます。</p>
      <div class="inline-field">
        <label for="inquiry-date">問い合わせ日</label>
        <input type="text" id="inquiry-date" class="in-optional" value="${esc(inq.inquiryDate)}"
          autocomplete="off" placeholder="${DATE_PLACEHOLDER}"><span class="print-value" aria-hidden="true"></span>
        <span class="field-error" data-err-for="inquiry-date"></span>
      </div>
      ${showBasicFree() ? `<details class="help no-print" id="basic-free-help">
        <summary>？ 基本料金無償化（都の期間限定措置）とは</summary>
        <p>${esc(BASIC_FREE_HELP)}</p>
        <p class="source">${esc(BASIC_FREE_SOURCE)}</p>
      </details>` : ''}
      <div class="table-wrap">
        <table class="grid entry" id="entry-table">
          <thead>${columnHeaders(contracts)}</thead>
          <tbody>
            ${sameHolder ? '' : row('契約者名', c => `<td>${esc(c.holder)}</td>`)}
            ${row('前回期間', c => `<td>${periodHtml(c.prevStart, c.prevEnd)}</td>`)}
            ${row('口径', c => `<td>${esc(c.caliber)}mm</td>`)}
            ${row('今回期間 開始日', (c, i) => `<td>${textInput(c, i, 'start', 'in-required', `placeholder="${DATE_PLACEHOLDER}"`)}</td>`, 'group-start')}
            ${row('今回期間 終了日', (c, i) => `<td>${textInput(c, i, 'end', 'in-required', `placeholder="${DATE_PLACEHOLDER}"`)}</td>`)}
            ${row('日数', c => `<td class="num" data-days-for="${esc(c.id)}"></td>`)}
            ${row('使用水量（2か月・m³）', (c, i) => `<td>${textInput(c, i, 'usage', 'in-required num-input', 'inputmode="numeric"')}</td>`)}
            ${showBasicFree() ? row(`基本料金無償化（都の期間限定措置）
                <a href="#basic-free-help" class="help-link no-print" tabindex="-1" data-open-help aria-hidden="true">？</a>
                <span class="row-note no-print">水道局から「基本料金は無償」と言われた場合だけチェック</span>`,
              (c, i) => (c.caliber <= BASIC_FREE_MAX_CALIBER
                ? `<td><label class="check in-optional-box"><input type="checkbox" data-cid="${esc(c.id)}" data-field="basicFree"
                      ${rowOf(c.id).basicFree ? 'checked' : ''} ${seqAttrs(i, 'basicFree')}> 無償</label></td>`
                : `<td class="muted"><label class="check"><input type="checkbox" disabled ${seqAttrs(i, 'basicFree')}> 対象外</label></td>`)) : ''}
            ${row('計算額（税込）', c => `<td class="calc-cell" data-calc-for="${esc(c.id)}"></td>`, 'group-start')}
            ${row(`確認（合計）
                <span class="row-note no-print">内訳のチェックは、ホームページや電話で確かめた場合だけ</span>`,
              (c, i) => `<td class="confirm-cell">${renderConfirmCell(c, i)}</td>`)}
          </tbody>
        </table>
      </div>
      <label class="block-field">対応者・メモ
        <textarea class="in-optional" id="inquiry-memo" rows="2">${esc(inq.memo)}</textarea><span class="print-value" aria-hidden="true"></span>
      </label>
    </section>

    <section class="block result-block">
      <div class="keep-together">
        <h2 id="result-heading"></h2>
        <div id="check-alerts"></div>
        <div class="table-wrap"><table class="grid result" id="result-table"></table></div>
        <p class="result-note">水道・下水道の金額は、使用水量から計算した値です。照合方法が「合計で照合」の契約は、内訳（水道・下水道）を水道局に確認していません。</p>
      </div>
      <div class="pdf-row no-print">
        <button type="button" id="pdf-btn" class="btn-primary">PDF保存（印刷）</button>
        <div class="pdf-info" aria-live="polite">
          <div id="pdf-filename" class="pdf-filename"></div>
          <div id="pdf-pending" class="pdf-warn" hidden></div>
        </div>
      </div>
    </section>

    <section class="block breakdown-block">
      <details id="breakdown-details">
        <summary>内訳（税抜・月別）</summary>
        <div class="table-wrap"><table class="grid breakdown" id="breakdown-table"></table></div>
      </details>
    </section>

    <div class="actions-bottom no-print">
      <button type="button" id="clear-btn" class="btn-quiet">入力をクリア</button>
    </div>
  `;
}

function renderConfirmCell(c, i) {
  const cid = esc(c.id);
  const open = ui.openBreakdown.has(c.id) ? 'open' : '';
  return `
    <div class="confirm-buttons no-print">
      <button type="button" class="btn-confirm btn-match" data-action="${CONFIRM.MATCH}" data-cid="${cid}"
        aria-pressed="false" ${seqAttrs(i, 'match')}>一致</button>
      <button type="button" class="btn-confirm btn-mismatch" data-action="${CONFIRM.MISMATCH}" data-cid="${cid}"
        aria-pressed="false" ${seqAttrs(i, 'mismatch')}>違う</button>
    </div>
    <div class="status" data-status-for="${cid}" aria-live="polite"></div>
    <div class="parts-confirm no-print">
      <label class="check in-optional-box"><input type="checkbox" data-parts-for="${cid}" disabled
        ${seqAttrs(i, 'parts')}> 内訳（水道・下水道）も一致を確認した</label>
    </div>
    <div class="answer-area" data-answer-for="${cid}" hidden>
      <label class="answer-label">水道局の合計（税込）
        ${textInput(c, i, 'ansTotal', 'in-answer num-input', 'inputmode="numeric"')}</label>
      <div class="diff" data-diff-for="${cid}"></div>
      <details class="answer-breakdown" data-breakdown-for="${cid}" ${open}>
        <summary ${seqAttrs(i, 'breakdown')}>内訳（水道・下水道）も聞いた場合</summary>
        <label class="answer-label">水道（税込）${textInput(c, i, 'ansWater', 'in-answer num-input', 'inputmode="numeric"')}</label>
        <label class="answer-label">下水道（税込）${textInput(c, i, 'ansSewer', 'in-answer num-input', 'inputmode="numeric"')}</label>
      </details>
      <div class="sum-warn" data-sumwarn-for="${cid}" role="alert" hidden></div>
    </div>
    <div class="suggest" data-suggest-for="${cid}" hidden>基本料金無償化の対象期間ではありませんか？水道局に確認してください（自動では適用しません）。</div>`;
}

// ---------- 再計算と表示の更新（入力欄は作り直さない） ----------

function updateAll() {
  const contracts = displayedContracts();
  if (contracts.length === 0 && !currentBuilding()) return;
  const evaluations = evaluateAll(contracts);

  // 確認後に計算条件が変わった契約は、確認を取り消して保存する
  let dirty = false;
  evaluations.forEach((ev, i) => {
    if (ev.changed) {
      setRow(contracts[i].id, ev.row);
      syncInputs(contracts[i].id);
      dirty = true;
    }
  });
  if (dirty) persistInquiry();

  contracts.forEach((c, i) => updateColumn(c, evaluations[i]));
  updateInquiryDate();

  const total = sumBuilding(evaluations.map(ev => ev.entry));
  $('#result-heading').textContent =
    `計算結果と照合（2か月分・税込／消費税率 ${state.master.settings.taxRatePercent}%）`;
  $('#check-alerts').innerHTML = renderAlerts(contracts, evaluations);
  $('#result-table').innerHTML = renderResultTable(contracts, evaluations, total);
  $('#breakdown-table').innerHTML = renderBreakdown(contracts, evaluations);
  updatePdfFilename();
  updatePendingNotice(contracts, evaluations);
}

// 保存値を入力欄に反映する（入力中の欄は触らない）
function syncInputs(cid) {
  const row = rowOf(cid);
  for (const el of document.querySelectorAll(`[data-cid="${CSS.escape(cid)}"][data-field]`)) {
    if (el === document.activeElement) continue;
    if (el.type === 'checkbox') el.checked = row[el.dataset.field] === true;
    else el.value = row[el.dataset.field] ?? '';
  }
}

function updateColumn(c, ev) {
  const cid = CSS.escape(c.id);
  const periodError = ev.status === STATUS.PERIOD;

  for (const input of document.querySelectorAll(`input[data-cid="${cid}"][data-field]`)) {
    const field = input.dataset.field;
    const error = ev.errors[field] ?? null;
    input.classList.toggle('is-error', error !== null || (periodError && (field === 'start' || field === 'end')));
    const msg = document.querySelector(`[data-err-for="${CSS.escape(`${c.id}:${field}`)}"]`);
    if (msg) msg.textContent = error ?? '';
  }
  if (ev.errors.caliber) {
    const msg = document.querySelector(`[data-err-for="${CSS.escape(`${c.id}:usage`)}"]`);
    if (msg) msg.textContent = ev.errors.caliber;
  }

  const days = ev.errors.start || ev.errors.end ? null : daysBetween(ev.values.start, ev.values.end);
  const daysCell = $(`[data-days-for="${cid}"]`);
  daysCell.textContent = days === null ? '' : `${days}日`;
  daysCell.classList.toggle('is-error-text', days !== null && days <= 0);

  const calcCell = $(`[data-calc-for="${cid}"]`);
  const result = ev.entry.inputError ? null : ev.entry.result;
  calcCell.innerHTML = result
    ? `<div class="calc-part">${nowrap('水道')} ${nowrap(`${yen(result.water.total)}円`)}</div>
       <div class="calc-part">${nowrap('下水道')} ${nowrap(`${yen(result.sewer.total)}円`)}</div>
       <div class="calc-total">${nowrap('合計')} ${nowrap(`${yen(result.total)}<small>円</small>`)}</div>`
    : `<span class="muted">${ev.entry.inputError ? '入力エラーを直すと表示されます' : '期間と使用水量を入力すると表示されます'}</span>`;

  for (const btn of document.querySelectorAll(`.btn-confirm[data-cid="${cid}"]`)) {
    btn.disabled = !ev.canConfirm;
    btn.setAttribute('aria-pressed', String(ev.state === btn.dataset.action));
  }

  // W：内訳の確認のチェック欄。押せるのは「一致」のときだけ
  const parts = $(`[data-parts-for="${cid}"]`);
  if (parts) {
    parts.checked = ev.partsConfirmed;
    parts.disabled = !ev.canConfirmParts && !ev.partsConfirmed;
  }

  const status = $(`[data-status-for="${cid}"]`);
  status.innerHTML = statusHtml(ev.partsConfirmed ? STATUS_PARTS_TEXT : ev.status);
  status.className = `status ${STATUS_CLASS[ev.status] ?? ''}`;

  $(`[data-answer-for="${cid}"]`).hidden = !ev.answersOpen;
  const diff = $(`[data-diff-for="${cid}"]`);
  const answered = ev.status === STATUS.MATCH || ev.status === STATUS.DIFF;
  diff.innerHTML = answered && ev.entry.total.diff !== null
    ? `差額（回答－計算） ${nowrap(`${signedYen(ev.entry.total.diff)}円`)}`
    : '';
  diff.className = `diff ${answered ? STATUS_CLASS[ev.status] : ''}`;

  // AF：水道＋下水道が水道局の合計と合わないときの警告（表示だけ。判定は変えない）
  const sumWarn = $(`[data-sumwarn-for="${cid}"]`);
  const mismatch = breakdownSumMismatch(ev);
  sumWarn.hidden = mismatch === null;
  sumWarn.innerHTML = mismatch === null ? ''
    : `水道＋下水道（${nowrap(`${yen(mismatch.sum)}円`)}）が合計（${nowrap(`${yen(mismatch.total)}円`)}）と合いません。聞き直してください`;

  $(`[data-suggest-for="${cid}"]`).hidden = !(showBasicFree() && ev.suggestBasicFree);
}

// 問い合わせ日のエラー表示。入力中（showError=false）はエラーを消すだけにする
function updateInquiryDate(showError = true) {
  const input = $('#inquiry-date');
  if (!input) return;
  const r = parseDateText(input.value);
  if (!r.ok && !showError) return;
  input.classList.toggle('is-error', !r.ok);
  $('[data-err-for="inquiry-date"]').textContent = r.ok ? '' : r.error;
}

function renderAlerts(contracts, evaluations) {
  const items = [];
  evaluations.forEach((ev, i) => {
    const name = `契約${i + 1}（${contractTitle(contracts[i], i)}）`;
    if (ev.status === STATUS.INPUT_ERROR) items.push({ cls: 'alert-error', text: `${name}：入力エラーがあります` });
    else if (ev.status === STATUS.PERIOD) items.push({ cls: 'alert-error', text: `${name}：終了日が開始日以前です（期間エラー）` });
    else if (ev.status === STATUS.STALE) items.push({ cls: 'alert-warn', text: `${name}：確認したあとに条件が変わりました。再確認が必要です` });
    if (showBasicFree() && ev.suggestBasicFree) items.push({ cls: 'alert-warn', text: `${name}：基本料金無償化の対象期間ではありませんか？` });
  });
  if (items.length === 0) return '';
  return `<ul class="alert-list">${items.map(a => `<li class="${a.cls}">${esc(a.text)}</li>`).join('')}</ul>`;
}

function renderResultTable(contracts, evaluations, buildingTotal) {
  const cols = Array.from({ length: MAX_CONTRACTS }, (_, i) => evaluations[i] ?? null);
  // 契約が1件も無い建物では建物合計も空欄
  const total = buildingTotal ?? { water: {}, sewer: {}, total: {}, overall: null };

  const amountRow = (label, pick, totalValue, cls = '') => `
    <tr class="${cls}"><th scope="row">${label}</th>
      ${cols.map(ev => {
        if (!ev) return EMPTY_CELL;
        if (ev.entry.inputError) return '<td></td>';
        return `<td class="num">${yen(pick(ev))}</td>`;
      }).join('')}
      ${totalValue === BUILDING_PARTIAL
        ? `<td class="building judge-total-only partial">${BUILDING_PARTIAL}</td>`
        : `<td class="num building">${yen(totalValue)}</td>`}</tr>`;

  const judgeRow = (label, pick, totalJudge, cls = '') => `
    <tr class="${cls}"><th scope="row">${label}</th>
      ${cols.map(ev => (ev ? judgeCell(pick(ev)) : EMPTY_CELL)).join('')}
      ${judgeCell(totalJudge)}</tr>`;

  // 合計で照合した契約では、聞いていない内訳の回答を「—」にする
  // W：内訳も一致を確認した契約では、金額を聞き取ったように見えないよう「計算額どおり」にする（表示だけ）
  const answerOf = (ev, key) => {
    if (ev.partsConfirmed) return PARTS_ANSWER_TEXT;
    const judge = key === 'water' ? ev.waterJudge : ev.sewerJudge;
    return judge === TOTAL_ONLY ? '—' : ev.entry[key].answer;
  };
  // 建物合計：内訳を確かめた契約が一部だけなら、回答・差額は「一部のみ」（案2。表示だけ）
  const partial = key => buildingPartScope(evaluations, key) === 'partial';
  const totalAnswerOf = key => {
    if (partial(key)) return BUILDING_PARTIAL;
    return buildingPartsAnswerIsCalc(evaluations, key) ? PARTS_ANSWER_TEXT : total[key].answer;
  };

  // 内訳（水道・下水道）を聞いた契約が1件も無ければ、回答・差額の行は印刷しない（画面には出す）
  const answerRowCls = hasPartAnswers(evaluations) ? '' : 'no-print';

  const part = (key, name, baseLabel) => `
    ${amountRow(`${name}　${baseLabel}`, ev => ev.entry.result?.[key].base ?? null, total[key].base, 'group-start')}
    ${amountRow(`${name}　従量料金`, ev => ev.entry.result?.[key].metered ?? null, total[key].metered)}
    ${amountRow(`${name}　消費税`, ev => ev.entry.result?.[key].tax ?? null, total[key].tax)}
    ${amountRow(`${name}　計算結果`, ev => ev.entry[key].calc, total[key].calc, 'strong')}
    ${amountRow(`${name}　水道局の回答`, ev => answerOf(ev, key), totalAnswerOf(key), answerRowCls)}
    ${amountRow(`${name}　差額（回答－計算）`, ev => ev.entry[key].diff, partial(key) ? BUILDING_PARTIAL : total[key].diff, answerRowCls)}
    ${judgeRow(`${name}　判定`, ev => (key === 'water' ? ev.waterJudge : ev.sewerJudge),
      buildingPartJudgeShown(evaluations, key))}`;

  return `
    <thead>${columnHeaders(contracts, TOTAL_HEAD)}</thead>
    <tbody>
      ${part('water', '水道', '基本料金')}
      ${part('sewer', '下水道', '基本料金（8m³まで）')}
      ${amountRow('合計　計算結果', ev => ev.entry.total.calc, total.total.calc, 'group-start strong')}
      ${amountRow('合計　水道局の回答', ev => ev.entry.total.answer, total.total.answer)}
      ${amountRow('合計　差額（回答－計算）', ev => ev.entry.total.diff, total.total.diff)}
      <tr class="group-start"><th scope="row">照合方法</th>
        ${cols.map(ev => (ev ? `<td class="method">${esc(ev.method)}</td>` : EMPTY_CELL)).join('')}
        <td></td></tr>
      ${judgeRow('総合判定', ev => (ev.entry.inputError ? STATUS.INPUT_ERROR : ev.entry.overall), total.overall, 'overall')}
    </tbody>`;
}

function renderBreakdown(contracts, evaluations) {
  const cols = Array.from({ length: MAX_CONTRACTS }, (_, i) => evaluations[i] ?? null);
  const row = (label, pick, unit = '') => `
    <tr><th scope="row">${label}</th>
      ${cols.map(ev => {
        if (!ev) return EMPTY_CELL;
        const r = !ev.entry.inputError ? ev.entry.result : null;
        return r ? `<td class="num">${yen(pick(r))}${unit}</td>` : '<td></td>';
      }).join('')}${SPACER_CELL}</tr>`;
  return `
    <thead>${columnHeaders(contracts)}</thead>
    <tbody>
      ${row('1か月目 使用水量', r => r.monthly[0].usage, 'm³')}
      ${row('2か月目 使用水量', r => r.monthly[1].usage, 'm³')}
      ${row('水道 基本料金（1か月）', r => r.monthly[0].waterBase)}
      ${row('下水道 基本料金（1か月）', r => r.monthly[0].sewerBase)}
      ${row('水道 従量料金（1か月目）', r => r.monthly[0].waterMetered)}
      ${row('水道 従量料金（2か月目）', r => r.monthly[1].waterMetered)}
      ${row('下水道 従量料金（1か月目）', r => r.monthly[0].sewerMetered)}
      ${row('下水道 従量料金（2か月目）', r => r.monthly[1].sewerMetered)}
    </tbody>`;
}

// ---------- 操作 ----------

function onBuildingChange(select) {
  const nextId = select.value || null;
  if (nextId === state.inquiry.buildingId) return;
  if (hasInquiryInput(state.inquiry)
      && !window.confirm('入力値が残っています。クリアして切り替えますか？')) {
    select.value = state.inquiry.buildingId ?? '';
    return;
  }
  state.inquiry = emptyInquiry(nextId);
  ui.openBreakdown.clear();
  persistInquiry();
  // 計測中の分は記録せずに破棄し、新しい物件で計測を始める（物件の選択を外したら止める）
  setTimer(nextId ? startTimer(nextId, new Date()) : null);
  ui.timerMessage = '';
  renderTimer();
  renderCheckTab();
}

function onClear() {
  if (!window.confirm('照会結果の入力（問い合わせ日・各契約の入力・確認・メモ）を消します。よろしいですか？')) return;
  state.inquiry = clearInquiry(state.inquiry);
  ui.openBreakdown.clear();
  persistInquiry();
  renderCheckTab();
}

function evaluateContract(cid) {
  const c = state.master.contracts.find(x => x.id === cid);
  return evaluateRow({ row: rowOf(cid), caliber: c.caliber, taxRatePercent: state.master.settings.taxRatePercent });
}

// 入力途中の値（例：「2026/0」「9,0」）でエラーを点滅させないため、
// 入力中は正しく読める値だけを反映し、それ以外は入力欄を離れたときに反映してエラーを出す
function isCompleteText(field, value) {
  const r = field === 'start' || field === 'end' ? parseDateText(value) : parseIntegerInput(value);
  return r.ok;
}

// 契約の入力欄の値を照会入力に反映して再計算する
function commitField(target) {
  const cid = target.dataset.cid;
  const field = target.dataset.field;
  const value = target.type === 'checkbox' ? target.checked : target.value;
  const ev = evaluateContract(cid);
  if (ev.row[field] === value && !ev.changed) return;
  const row = field.startsWith('ans')
    ? applyAnswerInput(ev.row, field, value, ev)
    : { ...ev.row, [field]: value };
  setRow(cid, row);
  persistInquiry();
  updateAll();
}

// 入力中（input イベント。チェックボックスは change）
function onFieldInput(target) {
  if (target.id === 'inquiry-date') {
    state.inquiry.inquiryDate = target.value;
    updateInquiryDate(false);
    persistInquiry();
  } else if (target.id === 'inquiry-memo') {
    state.inquiry.memo = target.value;
    persistInquiry();
  } else if (target.dataset.cid && target.dataset.field) {
    if (target.type === 'checkbox' || isCompleteText(target.dataset.field, target.value)) commitField(target);
  }
}

// 入力欄を離れたとき（change イベント）：値を反映し、日付を整え、
// 契約1の期間をほかの契約の空欄へコピーする
function onFieldCommit(target) {
  if (target.id === 'inquiry-date') {
    target.value = normalizeDateText(target.value);
    state.inquiry.inquiryDate = target.value;
    updateInquiryDate(true);
    persistInquiry();
    return;
  }
  const field = target.dataset.field;
  if (!target.dataset.cid || !field) return;
  if (field === 'start' || field === 'end') target.value = normalizeDateText(target.value);
  commitField(target);

  const cid = target.dataset.cid;
  const contracts = displayedContracts();
  if ((field === 'start' || field === 'end') && contracts.length > 1 && contracts[0].id === cid) {
    const { rows, filled } = fillBlankPeriods(
      { ...state.inquiry.rows, [cid]: rowOf(cid) }, cid, contracts.slice(1).map(c => c.id));
    if (filled.length > 0) {
      state.inquiry.rows = rows;
      filled.forEach(syncInputs);
      persistInquiry();
      updateAll();
    }
  }
}

function onConfirm(button) {
  const cid = button.dataset.cid;
  const action = button.dataset.action;
  const ev = evaluateContract(cid);
  const row = applyConfirm(ev.row, action, ev);
  if (row === ev.row) return;
  setRow(cid, row);
  if (action === CONFIRM.MISMATCH && (row.ansWater !== '' || row.ansSewer !== '')) ui.openBreakdown.add(cid);
  if (action === CONFIRM.MATCH) {
    ui.openBreakdown.delete(cid);
    const details = $(`[data-breakdown-for="${CSS.escape(cid)}"]`);
    if (details) details.open = false;
  }
  persistInquiry();
  syncInputs(cid);
  updateAll();
  // ［違う］で開いた合計の入力欄にフォーカスする
  if (action === CONFIRM.MISMATCH) {
    $(`input[data-cid="${CSS.escape(cid)}"][data-field="ansTotal"]`)?.focus();
  }
}

// W：「内訳（水道・下水道）も一致を確認した」のチェック
function onPartsConfirm(checkbox) {
  const cid = checkbox.dataset.partsFor;
  const ev = evaluateContract(cid);
  const row = applyPartsConfirm(ev.row, checkbox.checked, ev);
  if (row !== ev.row) {
    setRow(cid, row);
    persistInquiry();
  }
  updateAll();
}

// ---------- Tab／Shift＋Tab（契約ごとに縦に進める） ----------

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

const isVisible = el => el.getClientRects().length > 0;
const isFocusable = el => !el.disabled && el.tabIndex >= 0 && isVisible(el);

function onEntryKeydown(e) {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
  const table = $('#entry-table');
  const elements = [...table.querySelectorAll('[data-seq-order]')];
  const index = elements.indexOf(e.target);
  if (index < 0) return; // 並びに含まれない要素は通常の Tab 操作
  const items = elements.map(el => ({
    col: Number(el.dataset.seqCol), order: Number(el.dataset.seqOrder), focusable: isFocusable(el),
  }));
  const next = nextFocus(items, index, e.shiftKey);
  if (!next) return;
  if (next.type === 'item') {
    e.preventDefault();
    elements[next.index].focus();
    return;
  }
  const outside = focusableOutside(table, next.direction);
  if (outside) {
    e.preventDefault();
    outside.focus();
  }
}

// 表の外で、表の直後（forward）または直前（backward）にあるフォーカスできる要素
function focusableOutside(table, direction) {
  const candidates = [...document.querySelectorAll(FOCUSABLE)]
    .filter(el => !table.contains(el) && isFocusable(el));
  if (direction === 'forward') {
    return candidates.find(el => table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? null;
  }
  return candidates.filter(el => table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING).pop() ?? null;
}

function setupCheckTabEvents() {
  const panel = $('#tab-check');
  panel.addEventListener('change', e => {
    if (e.target.id === 'building-select') onBuildingChange(e.target);
    else if (e.target.dataset.partsFor) onPartsConfirm(e.target);
    else if (e.target.type === 'checkbox') onFieldInput(e.target);
    else onFieldCommit(e.target);
  });
  panel.addEventListener('input', e => {
    if (e.target.id !== 'building-select' && e.target.type !== 'checkbox') onFieldInput(e.target);
  });
  panel.addEventListener('click', e => {
    const confirmBtn = e.target.closest('.btn-confirm');
    const helpLink = e.target.closest('[data-open-help]');
    if (confirmBtn) onConfirm(confirmBtn);
    else if (helpLink) $('#basic-free-help').open = true;
    else if (e.target.id === 'pdf-btn') window.print();
    else if (e.target.id === 'clear-btn') onClear();
  });
  panel.addEventListener('keydown', e => {
    if (e.target.closest('#entry-table')) onEntryKeydown(e);
  });
  // details の開閉は toggle イベント（バブリングしないので capture で受ける）
  panel.addEventListener('toggle', e => {
    const cid = e.target.dataset?.breakdownFor;
    if (!cid) return;
    if (e.target.open) ui.openBreakdown.add(cid); else ui.openBreakdown.delete(cid);
  }, true);
}

// ---------- PDF保存（SPEC 7.3・7.4） ----------

const ORIGINAL_TITLE = document.title;

function currentPdfFilename() {
  const building = currentBuilding();
  return pdfFilenameForRows(building?.id ?? '', displayedContracts().map(c => rowOf(c.id)));
}

// ［PDF保存］ボタンの横に、保存されるファイル名（または生成できない理由）を表示する
function updatePdfFilename() {
  const el = $('#pdf-filename');
  if (!el) return;
  const r = currentPdfFilename();
  el.classList.toggle('pdf-warn', !r.ok);
  el.innerHTML = r.ok
    ? `保存されるファイル名：<strong>${esc(r.filename)}</strong>`
    : `ファイル名を生成できません：${esc(r.reason)}（印刷はできます）`;
}

// ［PDF保存］ボタンの横に、確認が済んでいない契約を注意として出す（印刷は止めない）
function updatePendingNotice(contracts, evaluations) {
  const el = $('#pdf-pending');
  if (!el) return;
  const pending = pendingContracts(contracts.map(contractTitle), evaluations);
  el.hidden = pending.length === 0;
  el.textContent = pending.length === 0 ? ''
    : `確認が済んでいない契約があります：${pending.map(p => `${p.title}（${p.status}）`).join('、')}（印刷はできます）`;
}

const isCheckTabVisible = () => !$('#tab-check').hidden;

// 印刷の直前：ファイル名を document.title にする（PDFに保存の初期ファイル名になる）
// 内訳（税抜・月別）は自動では開かない（画面で開いているときだけ印刷する）
// Ctrl+P で印刷した場合も同じ扱いにする
function onBeforePrint() {
  syncPrintValues();
  // 印刷の見出しの横：作成日時と、保存されるファイル名
  $('#print-created').textContent = `作成日時：${formatDateTime(new Date().toISOString())}`;
  $('#print-filename').textContent = '';
  if (!isCheckTabVisible() || !currentBuilding()) return;
  const r = currentPdfFilename();
  ui.printing = true;
  document.title = r.ok ? r.filename.replace(/\.pdf$/, '') : ORIGINAL_TITLE;
  $('#print-filename').textContent = `ファイル名：${r.ok ? r.filename : `（生成できません：${r.reason}）`}`;
}

// 印刷のあと：元に戻し、計測中ならPDFを保存したかを確認する
// （印刷をキャンセルしても afterprint は発生するため、利用者に確かめる）
function onAfterPrint() {
  if (!ui.printing) return;
  document.title = ORIGINAL_TITLE;
  ui.printing = false;
  const dialog = $('#print-confirm');
  if (state.timer && !dialog.open) dialog.showModal();
}

function setupPrint() {
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
  $('#print-saved').addEventListener('click', () => {
    $('#print-confirm').close();
    recordTimer();
  });
  $('#print-not-saved').addEventListener('click', () => {
    $('#print-confirm').close();
    ui.timerMessage = '計測を続けています';
    renderTimer();
  });
}

// ---------- 作業時間タイマー（SPEC 7.6） ----------

function setTimer(timer) {
  state.timer = timer;
  saveTimer(timer);
}

// 記録する契約数＝物件の契約数（表示している最大5件）
function contractCountOf(buildingId) {
  return Math.min(contractsOf(buildingId).length, MAX_CONTRACTS);
}

// 物件の表示（マスタから削除された物件は「（削除済み）」）
function buildingLabel(buildingId) {
  const b = state.master.buildings.find(x => x.id === buildingId);
  return b ? `${b.id} ${b.name}`.trim() : `${buildingId} ${DELETED_LABEL}`;
}

// 計測を終えて記録する
function recordTimer() {
  if (!state.timer) return;
  const now = new Date();
  const log = finishTimer(state.timer, now, {
    id: newLogId(now), contractCount: contractCountOf(state.timer.buildingId),
  });
  state.timelogs = [...state.timelogs, log];
  saveTimelogs(state.timelogs);
  setTimer(null);
  ui.timerMessage = `所要時間 ${formatDuration(log.seconds)} を記録しました`;
  renderTimer();
  renderTimelogTab();
}

function renderTimer() {
  const t = state.timer;
  const now = new Date();
  const phone = t ? phoneSecondsOf(t, now) : null;
  const canStart = !t && currentBuilding() !== null;
  $('#timer').innerHTML = `
    <span class="timer-label">作業時間</span>
    <span class="timer-clock ${t ? 'running' : ''}" id="timer-clock">${t ? formatClock(elapsedSeconds(t, now)) : '--:--'}</span>
    <span class="timer-building">${t ? esc(buildingLabel(t.buildingId)) : '停止中'}</span>
    <span class="timer-phone" id="timer-phone-time">${phone !== null ? `電話 ${formatClock(phone)}` : ''}</span>
    <button type="button" id="timer-start" ${canStart ? '' : 'disabled'}>開始</button>
    <button type="button" id="timer-stop" ${t ? '' : 'disabled'}>終了</button>
    <button type="button" id="timer-phone" aria-pressed="${isPhoneActive(t)}" ${t ? '' : 'disabled'}>${isPhoneActive(t) ? '通話終了' : '電話中'}</button>
    <span class="timer-message" aria-live="polite">${esc(ui.timerMessage)}</span>`;
}

// 毎秒、時計の表示だけを更新する（経過時間は開始時刻から計算するので、リロードしても続く）
function tickTimer() {
  const t = state.timer;
  if (!t) return;
  const now = new Date();
  const clock = $('#timer-clock');
  if (clock) clock.textContent = formatClock(elapsedSeconds(t, now));
  const phone = phoneSecondsOf(t, now);
  const phoneEl = $('#timer-phone-time');
  if (phoneEl) phoneEl.textContent = phone !== null ? `電話 ${formatClock(phone)}` : '';
}

function setupTimerEvents() {
  $('#timer').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'timer-start' && !state.timer && currentBuilding()) {
      setTimer(startTimer(currentBuilding().id, new Date()));
      ui.timerMessage = '';
    } else if (id === 'timer-stop' && state.timer) {
      recordTimer();
      return;
    } else if (id === 'timer-phone' && state.timer) {
      setTimer(togglePhone(state.timer, new Date()));
    } else {
      return;
    }
    renderTimer();
  });
  setInterval(tickTimer, 1000);
}

// ---------- 作業時間タブ（SPEC 6.3） ----------

// 今日の日付（ローカル時刻。YYYY/MM/DD）
const todayText = () => formatDateTime(new Date().toISOString()).slice(0, 10);

function emptyManualForm() {
  return { date: todayText(), buildingId: '', minutes: '', phoneMinutes: '', note: '' };
}

ui.manualForm = emptyManualForm();

const minutesText = seconds => (seconds === null ? '—' : (seconds / 60).toFixed(1));

function renderTimelogTab() {
  const panel = $('#tab-timelog');
  const logs = [...state.timelogs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const sum = summarizeLogs(state.timelogs);
  const f = ui.manualForm;
  const err = ui.manualErrors;
  const statRow = (label, s) => `<tr><th scope="row">${label}</th>
    <td class="num">${s.count}</td><td class="num">${minutesText(s.avgSeconds)}</td>
    <td class="num">${minutesText(s.perContractSeconds)}</td></tr>`;

  let reduction = '<p class="muted">手作業とツールの両方の記録があると、改善前後の差と削減率を表示します。</p>';
  if (sum.diffPerContractSeconds !== null) {
    const diff = sum.diffPerContractSeconds;
    reduction = `<p class="reduction">1契約あたり <strong>${minutesText(Math.abs(diff))}分 ${diff >= 0 ? '短縮' : '増加'}</strong>
      ${sum.reductionRate !== null ? `（削減率 <strong>${(sum.reductionRate * 100).toFixed(1)}%</strong>）` : ''}</p>`;
  }

  const fieldError = key => (err[key] ? `<span class="field-error">${esc(err[key])}</span>` : '');
  const count = f.buildingId ? contractCountOf(f.buildingId) : null;

  panel.innerHTML = `
    <section class="block">
      <h2>集計</h2>
      <div class="table-wrap"><table class="grid summary">
        <thead><tr><th scope="col">方式</th><th scope="col">件数</th><th scope="col">平均時間（分）</th><th scope="col">1契約あたり（分）</th></tr></thead>
        <tbody>${statRow('手作業（改善前）', sum.manual)}${statRow('ツール（改善後）', sum.tool)}</tbody>
      </table></div>
      ${reduction}
      <p class="hint">1契約あたり＝所要時間の合計 ÷ 契約数の合計。削減率＝（手作業 − ツール）÷ 手作業。</p>
    </section>

    <section class="block">
      <h2>手作業の記録を追加</h2>
      <p class="hint">ツールを使わずに作業した場合の時間を、分単位の概算で入力します。契約数は物件を選ぶと自動で入ります。</p>
      <div class="manual-form">
        <label>日付<input type="text" class="in-required" data-manual="date" value="${esc(f.date)}" autocomplete="off" placeholder="${DATE_PLACEHOLDER}">${fieldError('date')}</label>
        <label>物件<select data-manual="buildingId" class="in-required">
          <option value="">（選択）</option>
          ${state.master.buildings.map(b => `<option value="${esc(b.id)}" ${b.id === f.buildingId ? 'selected' : ''}>${esc(b.id)} ${esc(b.name)}</option>`).join('')}
        </select>${fieldError('buildingId')}</label>
        <label>契約数<span class="manual-count" id="manual-count">${count === null ? '—' : `${count}件`}</span></label>
        <label>所要時間（分）<input type="text" class="in-required num-input" data-manual="minutes" value="${esc(f.minutes)}" inputmode="numeric" autocomplete="off">${fieldError('minutes')}</label>
        <label>電話時間（分・任意）<input type="text" class="in-optional num-input" data-manual="phoneMinutes" value="${esc(f.phoneMinutes)}" inputmode="numeric" autocomplete="off">${fieldError('phoneMinutes')}</label>
        <label class="wide">メモ<input type="text" class="in-optional" data-manual="note" value="${esc(f.note)}" autocomplete="off"></label>
        <button type="button" id="manual-add" class="btn-primary">記録を追加</button>
      </div>
    </section>

    <section class="block">
      <h2>記録の一覧</h2>
      <div class="log-actions">
        <button type="button" id="csv-btn" ${logs.length ? '' : 'disabled'}>CSV出力</button>
        <button type="button" id="logs-clear" class="btn-quiet" ${logs.length ? '' : 'disabled'}>全件削除</button>
      </div>
      ${logs.length === 0 ? '<p class="muted">記録はまだありません。</p>' : `
      <div class="table-wrap"><table class="grid logs">
        <thead><tr><th scope="col">日時</th><th scope="col">方式</th><th scope="col">物件</th><th scope="col">契約数</th>
          <th scope="col">所要時間</th><th scope="col">電話時間</th><th scope="col">メモ</th><th scope="col">操作</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td>${esc(formatDateTime(l.startedAt))}</td>
          <td>${esc(MODE_LABEL[l.mode])}</td>
          <td>${esc(buildingLabel(l.buildingId))}</td>
          <td class="num">${l.contractCount}</td>
          <td class="num">${esc(formatDuration(l.seconds))}</td>
          <td class="num">${esc(formatDuration(l.phoneSeconds))}</td>
          <td>${esc(l.note)}</td>
          <td><button type="button" class="btn-quiet" data-delete-log="${esc(l.id)}">削除</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </section>`;
}

function addManualLog() {
  const f = ui.manualForm;
  const errors = {};
  const date = parseDateText(f.date);
  if (!date.ok) errors.date = date.error;
  else if (date.value === null) errors.date = '日付を入力してください';
  if (!f.buildingId) errors.buildingId = '物件を選んでください';
  const minutes = parseIntegerInput(f.minutes);
  if (!minutes.ok || minutes.value === null || minutes.value < 1) errors.minutes = '1以上の整数（分）で入力してください';
  const phone = parseIntegerInput(f.phoneMinutes);
  if (!phone.ok) errors.phoneMinutes = phone.error;

  ui.manualErrors = errors;
  if (Object.keys(errors).length === 0) {
    const log = manualLog({
      id: newLogId(), date: date.value, buildingId: f.buildingId,
      contractCount: contractCountOf(f.buildingId), minutes: minutes.value,
      phoneMinutes: phone.value, note: f.note.trim(),
    });
    state.timelogs = [...state.timelogs, log];
    saveTimelogs(state.timelogs);
    ui.manualForm = { ...emptyManualForm(), date: f.date, buildingId: f.buildingId };
  }
  renderTimelogTab();
}

function downloadCsv() {
  const now = new Date();
  const logs = [...state.timelogs].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const blob = new Blob([toCsv(logs, state.master.buildings)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvFilename(now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setupTimelogEvents() {
  const panel = $('#tab-timelog');
  const onField = e => {
    const key = e.target.dataset.manual;
    if (!key) return;
    ui.manualForm[key] = e.target.value;
    if (key === 'buildingId') {
      $('#manual-count').textContent = e.target.value ? `${contractCountOf(e.target.value)}件` : '—';
    }
  };
  panel.addEventListener('input', onField);
  panel.addEventListener('change', e => {
    onField(e);
    if (e.target.dataset.manual === 'date') {
      e.target.value = normalizeDateText(e.target.value);
      ui.manualForm.date = e.target.value;
    }
  });
  panel.addEventListener('click', e => {
    const id = e.target.id;
    const del = e.target.closest('[data-delete-log]');
    if (id === 'manual-add') {
      addManualLog();
    } else if (id === 'csv-btn') {
      downloadCsv();
    } else if (id === 'logs-clear') {
      if (!window.confirm('作業時間の記録をすべて削除します。よろしいですか？')) return;
      state.timelogs = [];
      saveTimelogs(state.timelogs);
      renderTimelogTab();
    } else if (del) {
      if (!window.confirm('この記録を削除します。よろしいですか？')) return;
      state.timelogs = state.timelogs.filter(l => l.id !== del.dataset.deleteLog);
      saveTimelogs(state.timelogs);
      renderTimelogTab();
    }
  });
}

// ---------- 物件マスタタブ（SPEC 6.2） ----------

ui.master = {
  buildingId: null,   // 契約の一覧を表示している物件
  edit: null,         // 編集中：{ kind: 'building' | 'contract', id: null（追加）| 物件番号・契約ID, draft, errors, touched }
};

const DATE_PLACEHOLDER_PREV = '例：20260620';

// マスタを保存し、ほかのタブに反映する
function commitMaster(master) {
  state.master = master;
  saveMaster(master);
  // 照会中・計測中の物件が無くなったら、照会入力をクリアし、計測を破棄する
  if (state.inquiry.buildingId && !currentBuilding()) {
    state.inquiry = emptyInquiry();
    ui.openBreakdown.clear();
    persistInquiry();
  }
  if (state.timer && !master.buildings.some(b => b.id === state.timer.buildingId)) {
    setTimer(null);
    ui.timerMessage = '';
  }
  // 作業時間タブの手作業の記録で選んでいた物件が無くなったら、選択を外す
  if (ui.manualForm.buildingId && !master.buildings.some(b => b.id === ui.manualForm.buildingId)) {
    ui.manualForm.buildingId = '';
  }
  applyBasicFreeSetting();
  renderTimer();
  renderCheckTab();
  renderTimelogTab();
  renderMasterTab();
  renderSettingsTab();
}

function masterField(key, label, draft, errors, { cls = 'in-optional', attrs = '', hint = '' } = {}) {
  return `<label class="m-field">${label}
    <input type="text" class="${cls} ${errors[key] ? 'is-error' : ''}" data-mf="${key}" value="${esc(draft[key])}" autocomplete="off" ${attrs}>
    ${hint ? `<span class="m-hint">${esc(hint)}</span>` : ''}
    ${errors[key] ? `<span class="field-error">${esc(errors[key])}</span>` : ''}</label>`;
}

function formButtons() {
  return `<div class="m-form-buttons">
      <button type="button" class="btn-primary" data-m="save">保存</button>
      <button type="button" class="btn-quiet" data-m="cancel">キャンセル</button>
    </div>`;
}

function renderBuildingForm(edit) {
  const { draft, errors } = edit;
  const isNew = edit.id === null;
  return `
    <div class="m-form" id="m-form">
      <h3>${isNew ? '物件を追加' : `物件を編集（${esc(edit.id)}）`}</h3>
      <div class="m-fields">
        ${isNew
          ? masterField('id', '物件番号（必須）', draft, errors, { cls: 'in-required', attrs: 'placeholder="例：V004"', hint: '半角の英数字。あとから変更できません' })
          : `<div class="m-field">物件番号<span class="m-fixed">${esc(edit.id)}</span><span class="m-hint">物件番号は変更できません</span></div>`}
        ${masterField('name', '物件名（必須）', draft, errors, { cls: 'in-required' })}
        ${masterField('address', '契約住所', draft, errors, { cls: 'in-optional m-wide' })}
        ${masterField('note', '備考', draft, errors)}
      </div>
      ${formButtons()}
    </div>`;
}

function renderContractForm(edit) {
  const { draft, errors } = edit;
  const isNew = edit.id === null;
  return `
    <div class="m-form" id="m-form">
      <h3>${isNew ? '契約を追加' : '契約を編集'}</h3>
      <div class="m-fields">
        ${masterField('label', '契約名（表示名）', draft, errors, { hint: '例：1-5F分、共用栓' })}
        ${masterField('customerNo', 'お客様番号（必須）', draft, errors, {
          cls: 'in-required', attrs: `inputmode="numeric" placeholder="${CUSTOMER_NO_PLACEHOLDER}"`, hint: CUSTOMER_NO_HINT })}
        ${masterField('holder', '契約者名', draft, errors)}
        ${masterField('prevStart', '前回期間 開始日', draft, errors, { attrs: `placeholder="${DATE_PLACEHOLDER_PREV}"` })}
        ${masterField('prevEnd', '前回期間 終了日', draft, errors, { attrs: `placeholder="${DATE_PLACEHOLDER_PREV}"` })}
        <label class="m-field">口径（必須）
          <select data-mf="caliber" class="in-required ${errors.caliber ? 'is-error' : ''}">
            <option value="">（選択）</option>
            ${CALIBERS.map(c => `<option value="${c}" ${String(c) === draft.caliber ? 'selected' : ''}>${c}mm</option>`).join('')}
          </select>
          ${errors.caliber ? `<span class="field-error">${esc(errors.caliber)}</span>` : ''}</label>
        ${masterField('note', '備考', draft, errors)}
      </div>
      ${formButtons()}
    </div>`;
}

function renderMasterTab() {
  const panel = $('#tab-master');
  const { buildings } = state.master;
  if (!buildings.some(b => b.id === ui.master.buildingId)) ui.master.buildingId = buildings[0]?.id ?? null;
  const selected = buildings.find(b => b.id === ui.master.buildingId) ?? null;
  const contracts = selected ? contractsOfBuilding(state.master, selected.id) : [];
  const edit = ui.master.edit;
  const over = overLimitMessage(contracts.length);

  const buildingRows = buildings.length === 0
    ? '<tr><td colspan="6" class="muted">物件がありません。</td></tr>'
    : buildings.map(b => `
      <tr class="${b.id === ui.master.buildingId ? 'm-selected' : ''}">
        <td>${esc(b.id)}</td><td>${esc(b.name)}</td><td>${esc(b.address)}</td>
        <td class="num">${contractsOfBuilding(state.master, b.id).length}件</td><td>${esc(b.note)}</td>
        <td class="m-ops">
          <button type="button" data-m="select-building" data-id="${esc(b.id)}" aria-pressed="${b.id === ui.master.buildingId}">契約を表示</button>
          <button type="button" data-m="edit-building" data-id="${esc(b.id)}">編集</button>
          <button type="button" class="btn-quiet" data-m="delete-building" data-id="${esc(b.id)}">削除</button>
        </td></tr>`).join('');

  const contractRows = contracts.length === 0
    ? '<tr><td colspan="8" class="muted">契約がありません。</td></tr>'
    : contracts.map((c, i) => `
      <tr class="${i >= MAX_CONTRACTS ? 'm-over' : ''}">
        <td class="num">${i + 1}${i >= MAX_CONTRACTS ? '<span class="m-over-note">料金確認に表示されません</span>' : ''}</td>
        <td>${esc(c.label)}</td><td class="num">${esc(c.customerNo)}</td><td>${esc(c.holder)}</td>
        <td>${c.prevStart ? periodHtml(c.prevStart, c.prevEnd) : ''}</td>
        <td class="num">${esc(c.caliber)}mm</td><td>${esc(c.note)}</td>
        <td class="m-ops">
          <button type="button" data-m="move" data-dir="-1" data-id="${esc(c.id)}" ${i === 0 ? 'disabled' : ''}>上へ</button>
          <button type="button" data-m="move" data-dir="1" data-id="${esc(c.id)}" ${i === contracts.length - 1 ? 'disabled' : ''}>下へ</button>
          <button type="button" data-m="edit-contract" data-id="${esc(c.id)}">編集</button>
          <button type="button" class="btn-quiet" data-m="delete-contract" data-id="${esc(c.id)}">削除</button>
        </td></tr>`).join('');

  panel.innerHTML = `
    <p class="notice notice-warn"><strong>実在の個人情報は入力しないでください（公開デモ版）</strong></p>

    <section class="block">
      <h2>物件</h2>
      <div class="table-wrap"><table class="grid m-table">
        <thead><tr><th scope="col">物件番号</th><th scope="col">物件名</th><th scope="col">契約住所</th>
          <th scope="col">契約数</th><th scope="col">備考</th><th scope="col">操作</th></tr></thead>
        <tbody>${buildingRows}</tbody>
      </table></div>
      <div class="m-actions"><button type="button" data-m="add-building">物件を追加</button></div>
      ${edit?.kind === 'building' ? renderBuildingForm(edit) : ''}
    </section>

    <section class="block">
      <h2>契約${selected ? `（${esc(selected.id)} ${esc(selected.name)}）` : ''}</h2>
      ${selected ? `
        <p class="hint">上から順に、料金確認の契約1〜5になります。［上へ］［下へ］で並べ替えられます。</p>
        ${over ? `<p class="notice notice-warn">${esc(over)}</p>` : ''}
        <div class="table-wrap"><table class="grid m-table">
          <thead><tr><th scope="col">順</th><th scope="col">契約名（表示名）</th><th scope="col">お客様番号</th><th scope="col">契約者名</th>
            <th scope="col">前回期間</th><th scope="col">口径</th><th scope="col">備考</th><th scope="col">操作</th></tr></thead>
          <tbody>${contractRows}</tbody>
        </table></div>
        <div class="m-actions"><button type="button" data-m="add-contract">契約を追加</button></div>
        ${edit?.kind === 'contract' ? renderContractForm(edit) : ''}
      ` : '<p class="muted">物件を追加してください。</p>'}
    </section>

    <div class="actions-bottom">
      <button type="button" class="btn-quiet" data-m="reset">初期データ（架空）に戻す</button>
    </div>`;
}

function startEdit(kind, id) {
  if (kind === 'building') {
    const b = id ? state.master.buildings.find(x => x.id === id) : null;
    ui.master.edit = { kind, id: id ?? null, draft: buildingDraft(b), errors: {}, touched: [] };
  } else {
    const c = id ? state.master.contracts.find(x => x.id === id) : null;
    ui.master.edit = { kind, id: id ?? null, draft: contractDraft(c), errors: {}, touched: [] };
  }
  renderMasterTab();
  $('#m-form input, #m-form select')?.focus();
}

// 編集中の内容の入力チェック（保存するときと、欄を離れたときに使う）
function validateEdit(edit) {
  return edit.kind === 'building'
    ? validateBuilding(edit.draft, state.master.buildings, { isNew: edit.id === null, id: edit.id })
    : validateContract(edit.draft, { master: state.master, id: edit.id });
}

// AH：欄を離れたら判定し直し、直った欄のエラーを消す（表全体は描き直さず、エラーの表示だけ変える）
function onMasterFieldBlur(key) {
  const edit = ui.master.edit;
  if (!edit) return;
  edit.touched = touchField(edit.touched, key, edit.draft);
  edit.errors = visibleErrors(validateEdit(edit).errors, edit.errors, edit.touched);
  for (const el of document.querySelectorAll('#m-form [data-mf]')) {
    const message = edit.errors[el.dataset.mf];
    el.classList.toggle('is-error', Boolean(message));
    const field = el.closest('.m-field');
    let span = field?.querySelector('.field-error');
    if (message && field) {
      if (!span) {
        span = document.createElement('span');
        span.className = 'field-error';
        field.append(span);
      }
      span.textContent = message;
    } else {
      span?.remove();
    }
  }
}

function saveEdit() {
  const edit = ui.master.edit;
  if (!edit) return;
  if (edit.kind === 'building') {
    const isNew = edit.id === null;
    const r = validateEdit(edit);
    if (!r.ok) { edit.errors = r.errors; renderMasterTab(); return; }
    ui.master.edit = null;
    if (isNew) ui.master.buildingId = r.value.id;
    commitMaster(isNew ? addBuilding(state.master, r.value) : updateBuilding(state.master, edit.id, r.value));
  } else {
    const r = validateEdit(edit);
    if (!r.ok) { edit.errors = r.errors; renderMasterTab(); return; }
    ui.master.edit = null;
    commitMaster(edit.id === null
      ? addContract(state.master, ui.master.buildingId, r.value, newContractId(state.master.contracts))
      : updateContract(state.master, edit.id, r.value));
  }
}

function onDeleteBuilding(id) {
  const b = state.master.buildings.find(x => x.id === id);
  if (!b) return;
  const n = contractsOfBuilding(state.master, id).length;
  const notes = [];
  if (state.inquiry.buildingId === id) notes.push('料金確認で照会中の入力も消えます。');
  if (state.timer?.buildingId === id) notes.push('計測中の作業時間は記録せずに破棄します。');
  notes.push('作業時間の記録は残ります。');
  if (!window.confirm(`物件「${b.id} ${b.name}」と、その契約${n}件を削除します。\n${notes.join('\n')}\nよろしいですか？`)) return;
  ui.master.edit = null;
  commitMaster(deleteBuilding(state.master, id).master);
}

function onDeleteContract(id) {
  const c = state.master.contracts.find(x => x.id === id);
  if (!c) return;
  if (!window.confirm(`契約「${c.label || c.customerNo}」（お客様番号 ${c.customerNo}）を削除します。よろしいですか？`)) return;
  if (state.inquiry.rows[id]) {
    const rows = { ...state.inquiry.rows };
    delete rows[id];
    state.inquiry.rows = rows;
    persistInquiry();
  }
  if (ui.master.edit?.id === id) ui.master.edit = null;
  commitMaster(deleteContract(state.master, id));
}

function onResetMaster() {
  if (!window.confirm('物件マスタと設定を、初期データ（架空）に戻します。\n料金確認で照会中の入力は消え、計測中の作業時間は破棄します。作業時間の記録は残ります。\nよろしいですか？')) return;
  state.inquiry = emptyInquiry();
  ui.openBreakdown.clear();
  persistInquiry();
  setTimer(null);
  ui.timerMessage = '';
  ui.master = { buildingId: null, edit: null };
  ui.settingsDraft = {};
  ui.settingsErrors = {};
  commitMaster(sampleMaster());
}

function setupMasterEvents() {
  const panel = $('#tab-master');
  const onField = e => {
    const key = e.target.dataset.mf;
    if (!key || !ui.master.edit) return;
    ui.master.edit.draft[key] = e.target.value;
  };
  panel.addEventListener('input', onField);
  panel.addEventListener('change', e => {
    onField(e);
    const key = e.target.dataset.mf;
    if ((key === 'prevStart' || key === 'prevEnd') && ui.master.edit) {
      e.target.value = normalizeDateText(e.target.value);
      ui.master.edit.draft[key] = e.target.value;
    }
    // AG：全角数字は半角に直して表示する（10桁かどうかは、欄を離れたときと保存のときに判定する）
    if (key === 'customerNo' && ui.master.edit) {
      e.target.value = normalizeCustomerNo(e.target.value);
      ui.master.edit.draft[key] = e.target.value;
    }
  });
  // AH：欄を離れた時点で判定し直す（change のあとに起きるので、日付の整形も済んでいる）
  panel.addEventListener('focusout', e => {
    const key = e.target.dataset?.mf;
    if (key && e.target.isConnected) onMasterFieldBlur(key);
  });
  // 編集欄の入力中にボタンを押したときは、欄を離れたときの表示の変更でボタンの位置がずれて
  // クリックが外れないよう、押した時点ではフォーカスを動かさない（クリックの処理は通常どおり）
  panel.addEventListener('mousedown', e => {
    if (e.target.closest('button') && document.activeElement?.dataset?.mf) e.preventDefault();
  });
  panel.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.mf && e.target.tagName === 'INPUT') saveEdit();
  });
  panel.addEventListener('click', e => {
    const btn = e.target.closest('[data-m]');
    if (!btn) return;
    const { id } = btn.dataset;
    switch (btn.dataset.m) {
      case 'select-building':
        ui.master.buildingId = id;
        if (ui.master.edit?.kind === 'contract') ui.master.edit = null;
        renderMasterTab();
        break;
      case 'add-building': startEdit('building', null); break;
      case 'edit-building': startEdit('building', id); break;
      case 'delete-building': onDeleteBuilding(id); break;
      case 'add-contract': startEdit('contract', null); break;
      case 'edit-contract': startEdit('contract', id); break;
      case 'delete-contract': onDeleteContract(id); break;
      case 'move': commitMaster(moveContract(state.master, id, Number(btn.dataset.dir))); break;
      case 'save': saveEdit(); break;
      case 'cancel': ui.master.edit = null; renderMasterTab(); break;
      case 'reset': onResetMaster(); break;
      default: break;
    }
  });
}

// ---------- 料金表・設定タブ（SPEC 6.4） ----------

ui.settingsDraft = {};   // 入力途中（エラーのある値）の設定
ui.settingsErrors = {};

function renderSettingsTab() {
  const panel = $('#tab-settings');
  const st = state.master.settings;
  const draft = key => (key in ui.settingsDraft ? ui.settingsDraft[key] : String(st[key] ?? ''));
  const err = key => (ui.settingsErrors[key] ? `<span class="field-error">${esc(ui.settingsErrors[key])}</span>` : '');
  const t = rateTables();

  panel.innerHTML = `
    <section class="block">
      <h2>設定</h2>
      <div class="settings-form">
        <label class="m-field">消費税率（%）
          <input type="text" class="in-required num-input ${ui.settingsErrors.taxRatePercent ? 'is-error' : ''}" data-setting="taxRatePercent"
            value="${esc(draft('taxRatePercent'))}" inputmode="numeric" autocomplete="off">
          <span class="m-hint">0〜99の整数。変えると計算結果がすぐ変わります（確認済みの契約は「再確認が必要」になります）</span>
          ${err('taxRatePercent')}</label>
        <label class="m-field">自分の電話番号
          <input type="text" class="in-required ${ui.settingsErrors.myPhone ? 'is-error' : ''}" data-setting="myPhone"
            value="${esc(draft('myPhone'))}" inputmode="tel" autocomplete="off">
          <span class="m-hint">料金確認の右上の枠に表示します（電話で聞かれることがあります）</span>
          ${err('myPhone')}</label>
        <div class="m-field">
          <label class="check"><input type="checkbox" data-setting="showBasicFree" ${st.showBasicFree ? 'checked' : ''}>
            基本料金無償化の入力欄を表示する</label>
          <span class="m-hint">東京都が2026年夏に実施した期間限定の措置の試算用です。オフ（初期値）のときは無償化なしで計算し、照会中の無償化のチェックはすべて外れます。</span>
        </div>
        <div class="m-field">水道局 お客さまセンター
          <span><a href="${esc(telHref(st.bureauPhone))}">${esc(st.bureauPhone)}</a>（${esc(st.bureauHours)}）</span>
          <span class="m-hint">表示だけです（変更できません）</span>
        </div>
      </div>
    </section>

    <section class="block">
      <h2>料金表（東京都23区・一般用。金額は税抜・1か月分）</h2>
      <div class="rate-tables">
        <div>
          <h3>水道 基本料金</h3>
          <table class="grid rate"><thead><tr><th scope="col">口径</th><th scope="col">基本料金（円）</th></tr></thead>
            <tbody>${t.waterBasic.map(r => `<tr><th scope="row">${esc(r.caliber)}</th><td class="num">${yen(r.price)}</td></tr>`).join('')}</tbody></table>
        </div>
        <div>
          <h3>水道 従量料金（円/m³）</h3>
          <table class="grid rate"><thead><tr><th scope="col">1か月の使用水量</th>${t.waterMetered.classes.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${t.waterMetered.rows.map(r => `<tr><th scope="row">${esc(r.range)}</th>${r.prices.map(p => `<td class="num">${yen(p)}</td>`).join('')}</tr>`).join('')}</tbody></table>
        </div>
        <div>
          <h3>下水道（一般汚水）</h3>
          <table class="grid rate"><thead><tr><th scope="col">1か月の排除汚水量</th><th scope="col">料金</th></tr></thead>
            <tbody>${t.sewer.map(r => `<tr><th scope="row">${esc(r.range)}</th><td class="num">${yen(r.price)}${esc(r.unit)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
      <ul class="rate-notes">
        <li>2か月分の使用水量を2か月に分けて計算し、水道・下水道それぞれで消費税を加えます（1円未満は切り捨て）。</li>
        <li>口径30mm以上の単価は、公式の料金表（結合セル）から読み取った値です。</li>
        <li>出典（クリックすると東京都のページを新しいタブで開きます）：
          ${RATE_SOURCES.map(src => `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.label)}</a>`).join('／')}</li>
      </ul>
    </section>`;
}

// 設定を保存し、料金確認タブに反映する
function commitSettings(patch) {
  state.master = { ...state.master, settings: { ...state.master.settings, ...patch } };
  saveMaster(state.master);
  applyBasicFreeSetting();
  renderCheckTab();
}

function onSettingCommit(target) {
  const key = target.dataset.setting;
  if (key === 'showBasicFree') {
    commitSettings({ showBasicFree: target.checked });
    renderSettingsTab();
    return;
  }
  const r = key === 'taxRatePercent' ? validateTaxRate(target.value) : validatePhone(target.value);
  if (!r.ok) {
    ui.settingsDraft[key] = target.value;
    ui.settingsErrors[key] = r.error;
    renderSettingsTab();
    return;
  }
  delete ui.settingsDraft[key];
  delete ui.settingsErrors[key];
  if (state.master.settings[key] !== r.value) commitSettings({ [key]: r.value });
  renderSettingsTab();
}

function setupSettingsEvents() {
  const panel = $('#tab-settings');
  panel.addEventListener('change', e => {
    if (e.target.dataset.setting) onSettingCommit(e.target);
  });
  panel.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.setting && e.target.type === 'text') e.target.blur();
  });
}

// ---------- 起動 ----------

if (state.inquiry.buildingId && !currentBuilding()) {
  state.inquiry = emptyInquiry();
}
// 計測中の物件がマスタに無ければ、計測をやめる
if (state.timer && !state.master.buildings.some(b => b.id === state.timer.buildingId)) {
  setTimer(null);
}
applyBasicFreeSetting();
setupTabs();
setupCheckTabEvents();
setupTimerEvents();
setupTimelogEvents();
setupMasterEvents();
setupSettingsEvents();
setupPrint();
renderTimer();
renderTimelogTab();
renderMasterTab();
renderSettingsTab();
renderCheckTab();
