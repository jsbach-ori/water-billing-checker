// 架空の初期データ（SPEC 8章）。実在の人名・お客様番号・住所を入れない
// 契約IDと口径の組み合わせは変えない（保存済みの照会入力が別の契約に付かないようにするため）
export const SCHEMA_VERSION = 2;

export const SAMPLE_MASTER = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  settings: {
    taxRatePercent: 10,
    myPhone: '090-0000-0000',
    bureauPhone: '0570-091-100',
    bureauHours: '日曜・祝日を除く 8:30～20:00',
    showBasicFree: false, // 基本料金無償化の入力欄を表示する（初期値オフ。オフのときは無償化なしで計算する）
  },
  buildings: [
    { id: 'V001', name: 'サンプルハイツ', address: '東京都〇〇区サンプル町1-2-3', note: 'サンプル（架空）' },
    { id: 'V002', name: 'サンプル第2ビル', address: '東京都〇〇区サンプル町4-5-6', note: 'サンプル（架空）' },
    { id: 'V003', name: 'サンプルビル', address: '東京都〇〇区サンプル町7-8-9', note: 'サンプル（架空）' },
  ],
  contracts: [
    // V001：契約者名が契約ごとに異なる物件
    { id: 'C001', buildingId: 'V001', customerNo: '0000000001', holder: 'サンプルハイツ管理組合', label: '1-5F分', prevStart: '2026-06-20', prevEnd: '2026-08-20', caliber: 20, note: '' },
    { id: 'C002', buildingId: 'V001', customerNo: '0000000002', holder: 'サンプルハイツ管理組合', label: '共用栓', prevStart: '2026-06-20', prevEnd: '2026-08-20', caliber: 13, note: '' },
    { id: 'C003', buildingId: 'V001', customerNo: '0000000003', holder: 'サンプル商事（株）', label: '1階店舗', prevStart: '2026-06-20', prevEnd: '2026-08-20', caliber: 25, note: '' },
    // V002：1契約
    { id: 'C004', buildingId: 'V002', customerNo: '0000000004', holder: 'サンプル不動産（株）', label: '全体分', prevStart: '2026-06-25', prevEnd: '2026-08-25', caliber: 20, note: '' },
    // V003：5契約・契約者名はすべて同じ
    { id: 'C005', buildingId: 'V003', customerNo: '0000000005', holder: 'サンプルビル管理組合', label: '共用栓', prevStart: '2026-06-10', prevEnd: '2026-08-10', caliber: 13, note: '' },
    { id: 'C006', buildingId: 'V003', customerNo: '0000000006', holder: 'サンプルビル管理組合', label: '散水栓', prevStart: '2026-06-10', prevEnd: '2026-08-10', caliber: 13, note: '' },
    { id: 'C007', buildingId: 'V003', customerNo: '0000000007', holder: 'サンプルビル管理組合', label: '1-3F分', prevStart: '2026-06-10', prevEnd: '2026-08-10', caliber: 20, note: '' },
    { id: 'C008', buildingId: 'V003', customerNo: '0000000008', holder: 'サンプルビル管理組合', label: '4-6F分', prevStart: '2026-06-10', prevEnd: '2026-08-10', caliber: 25, note: '' },
    { id: 'C009', buildingId: 'V003', customerNo: '0000000009', holder: 'サンプルビル管理組合', label: '受水槽', prevStart: '2026-06-10', prevEnd: '2026-08-10', caliber: 40, note: '' },
  ],
});
