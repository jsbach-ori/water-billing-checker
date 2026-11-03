# cases.json の構成

| キー | 件数 | 内容 |
|---|---|---|
| bimonthly | 19 | 2か月分の通常計算。input: caliber, usage, taxRatePercent, basicFree / expected: months[1か月目,2か月目], water{base,metered,tax,total}, sewer{...}, total |
| prorated | 4 | 日割り（1か月）。input: caliber, daysInMonth, daysUsed, usage, taxRatePercent / expected: converted, water_monthly_pretax, water_prorated_pretax, water_total, sewer_base, sewer_metered, sewer_total, total |
| judgement | 9 | 1契約の判定。input: 口径・期間・使用水量・回答（未入力はnull）/ expected: water, sewer, overall（一致・差異あり・未入力・期間エラー） |
| filename | 6 | PDFファイル名。expected が null のときは「生成しない」 |

- 金額はすべて円（整数）。base / metered / tax は税抜の内訳、total は税込
- `OFF-` で始まるケースは東京都水道局の公式計算例・早見表と一致することを確認済み
- `LG-` で始まるケース（大口径）は Excel版と同じロジックで算出した値（公式の早見表では未検証）
- 「Excel版」は `docs/reference/tokyo-water-calc-reference.xlsx` を指す
- 期待値は書き換えないこと
