# Legacy XLS Export

This endpoint exports WBS rows into `C:\Git\WBS\テンプレートファイル.xls` by editing the BIFF8 Workbook stream inside the existing CFB `.xls` file. It does not convert to `.xlsx` and does not rebuild unrelated workbook streams, VBA storage, drawings, styles, or other sheets.

## Approach

- Parse the CFB container and extract the `Workbook` stream.
- Locate the `スケジュール` worksheet from `BoundSheet8` records.
- Decode the Shared String Table and worksheet cell records.
- Add required new strings to the SST, then update `LabelSST` cell references.
- Rewrite only touched worksheet cell records. `MulRK` and `MulBlank` records are split into individual BIFF8 cell records only when one of their cells is updated.
- Write the modified Workbook stream back into the original CFB file, expanding the stream sector chain only if needed.

## Column Mapping

Rows and columns are 0-indexed.

| Field | Column |
| --- | ---: |
| 大項目 | 1 |
| 中項目 | 2 |
| 項番 | 3 |
| 項目名 | 4 |
| 開始日 | 5 |
| 日数 | 6 |
| 終了日 | 7 |
| 開始(実績) | 8 |
| 日数(実績) | 9 |
| 終了(実績) | 10 |
| 遅れ | 11 |
| 進捗 | 12 |
| 工数 | 13 |
| 先行関係 | 14 |
| 先行関係補助 | 15 |
| 担当 | 16 |
| 状態 | 17 |

The decoded template has headers at row `3`, first writable data row `5`, last populated sample data row `45`, and a formatted blank row at `46`.

## Known Limitations

- The writer targets the current template layout and existing cell records. It throws if a requested row/column has no writable record.
- `ExtSST` is removed when new strings are appended because its old SST bucket offsets become stale; Excel can load BIFF8 workbooks without `ExtSST`.
- It does not create additional visual rows beyond the inspected template capacity.
- Predecessor data is blank because the current task model has no predecessor field.

## Commands

Run the offline export against the dev API:

```powershell
node packages/api/scripts/export-xls.js 5 out.xls
```

Run the writer tests:

```powershell
pnpm --filter api test
```

In restricted sandboxes that block Jest worker processes, run:

```powershell
pnpm --filter api test -- --runInBand
```
