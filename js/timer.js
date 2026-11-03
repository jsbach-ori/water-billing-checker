// 作業時間の計測・記録・集計・CSV（純粋関数。DOMに触れない）
// 現在時刻は引数 now（Date）で受け取る。テストで時刻を固定できるようにするため

export const MODE = Object.freeze({ TOOL: 'tool', MANUAL: 'manual' });
export const MODE_LABEL = Object.freeze({ [MODE.TOOL]: 'ツール', [MODE.MANUAL]: '手作業' });

const secondsBetween = (fromIso, now) => Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 1000));

// ---------- 計測中の状態（wbc.timer） ----------
// { buildingId, startedAt, phoneStartedAt: ISO | null, phoneSeconds: 整数 | null（電話ボタンを使っていなければ null） }

export function startTimer(buildingId, now) {
  return { buildingId, startedAt: now.toISOString(), phoneStartedAt: null, phoneSeconds: null };
}

// 保存されていた状態を確かめる。形が正しくなければ null（計測していない）
export function normalizeTimer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.buildingId !== 'string' || raw.buildingId === '') return null;
  if (typeof raw.startedAt !== 'string' || Number.isNaN(Date.parse(raw.startedAt))) return null;
  const phoneStartedAt = typeof raw.phoneStartedAt === 'string' && !Number.isNaN(Date.parse(raw.phoneStartedAt))
    ? raw.phoneStartedAt : null;
  const phoneSeconds = Number.isInteger(raw.phoneSeconds) && raw.phoneSeconds >= 0 ? raw.phoneSeconds : null;
  return { buildingId: raw.buildingId, startedAt: raw.startedAt, phoneStartedAt, phoneSeconds };
}

export function elapsedSeconds(timer, now) {
  return secondsBetween(timer.startedAt, now);
}

// 電話時間（電話中ならその時点までを含める）。電話ボタンを一度も使っていなければ null
export function phoneSecondsOf(timer, now) {
  if (timer.phoneStartedAt === null && timer.phoneSeconds === null) return null;
  const running = timer.phoneStartedAt ? secondsBetween(timer.phoneStartedAt, now) : 0;
  return (timer.phoneSeconds ?? 0) + running;
}

export const isPhoneActive = timer => timer !== null && timer.phoneStartedAt !== null;

// ［電話中］／［通話終了］
export function togglePhone(timer, now) {
  if (timer.phoneStartedAt) {
    return { ...timer, phoneStartedAt: null, phoneSeconds: phoneSecondsOf(timer, now) };
  }
  return { ...timer, phoneStartedAt: now.toISOString(), phoneSeconds: timer.phoneSeconds ?? 0 };
}

// 計測を終えて記録を作る（電話中ならその時点までを電話時間に加える）
export function finishTimer(timer, now, { id, contractCount }) {
  return {
    id,
    mode: MODE.TOOL,
    buildingId: timer.buildingId,
    contractCount,
    startedAt: timer.startedAt,
    endedAt: now.toISOString(),
    seconds: elapsedSeconds(timer, now),
    phoneSeconds: phoneSecondsOf(timer, now),
    note: '',
  };
}

// 手作業の記録（分単位の概算値）。date は YYYY-MM-DD
export function manualLog({ id, date, buildingId, contractCount, minutes, phoneMinutes = null, note = '' }) {
  return {
    id,
    mode: MODE.MANUAL,
    buildingId,
    contractCount,
    startedAt: date,
    endedAt: null,
    seconds: minutes * 60,
    phoneSeconds: phoneMinutes === null ? null : phoneMinutes * 60,
    note,
  };
}

// ---------- 記録（wbc.timelogs） ----------

const isLog = log => log && typeof log === 'object'
  && (log.mode === MODE.TOOL || log.mode === MODE.MANUAL)
  && typeof log.id === 'string'
  && Number.isInteger(log.seconds) && log.seconds >= 0
  && Number.isInteger(log.contractCount) && log.contractCount >= 0;

// 保存されていた記録のうち、形の正しいものだけを残す
export function normalizeLogs(raw) {
  return Array.isArray(raw) ? raw.filter(isLog) : [];
}

// 方式ごとの件数・平均時間・1契約あたりの平均時間（秒）と、改善前後の差・削減率
// 1契約あたり = 所要時間の合計 ÷ 契約数の合計
export function summarizeLogs(logs) {
  const stat = mode => {
    const list = logs.filter(l => l.mode === mode);
    if (list.length === 0) return { count: 0, avgSeconds: null, perContractSeconds: null };
    const seconds = list.reduce((s, l) => s + l.seconds, 0);
    const contracts = list.reduce((s, l) => s + l.contractCount, 0);
    return {
      count: list.length,
      avgSeconds: seconds / list.length,
      perContractSeconds: contracts > 0 ? seconds / contracts : null,
    };
  };
  const tool = stat(MODE.TOOL);
  const manual = stat(MODE.MANUAL);
  let diffPerContractSeconds = null;
  let reductionRate = null;
  if (tool.perContractSeconds !== null && manual.perContractSeconds !== null) {
    diffPerContractSeconds = manual.perContractSeconds - tool.perContractSeconds;
    reductionRate = manual.perContractSeconds > 0 ? diffPerContractSeconds / manual.perContractSeconds : null;
  }
  return { tool, manual, diffPerContractSeconds, reductionRate };
}

// ---------- 表示 ----------

const pad2 = n => String(n).padStart(2, '0');

// 経過時間の時計表示（03:25、1:02:03）
export function formatClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

// 所要時間の文章表示（5分12秒、1時間2分3秒、45秒）
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}時間${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

// 日時の表示（ローカル時刻）。日付だけ（YYYY-MM-DD）の値は YYYY/MM/DD
export function formatDateTime(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll('-', '/');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ---------- CSV（UTF-8 BOM付き。Excelで文字化けしないようにする） ----------

export const CSV_HEADERS = Object.freeze([
  '方式', '物件番号', '物件名', '契約数', '開始日時', '終了日時',
  '所要時間（秒）', '所要時間（分）', '電話時間（秒）', 'メモ',
]);

// 1つのセル。カンマ・引用符・改行を含む文字列は "" でくくる
// 文字列が = + - @ で始まる場合は、Excelで数式として扱われないよう先頭に ' を付ける
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// 削除された物件の物件名の欄に出す文言
export const DELETED_LABEL = '（削除済み）';

export function toCsv(logs, buildings) {
  // マスタから削除された物件は「（削除済み）」（作業時間の記録は残すため）
  const nameOf = id => buildings.find(b => b.id === id)?.name ?? DELETED_LABEL;
  const lines = [CSV_HEADERS.map(csvCell).join(',')];
  for (const l of logs) {
    lines.push([
      MODE_LABEL[l.mode], l.buildingId, nameOf(l.buildingId), l.contractCount,
      formatDateTime(l.startedAt), formatDateTime(l.endedAt),
      l.seconds, Math.round(l.seconds / 6) / 10, l.phoneSeconds, l.note,
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

// CSVのファイル名（作業時間_YYYYMMDD.csv）
export function csvFilename(now) {
  return `作業時間_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.csv`;
}
