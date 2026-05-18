import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readCellValue, readWorkbookStream } from './biff-reader';
import { applyCellUpdates } from './biff-writer';
import { SCHEDULE_SHEET_NAME, TEMPLATE_DATA_START_ROW, WBS_COLUMNS } from './column-map';

const templatePath = resolve(__dirname, '..', '..', '..', '..', '..', 'テンプレートファイル.xls');

describe('BIFF8 writer', () => {
  const template = readFileSync(templatePath);

  it('returns byte-for-byte identical output when there are no updates', () => {
    const output = applyCellUpdates(template, []);
    expect(Buffer.compare(output, template)).toBe(0);
  });

  it('writes a known string to an existing template cell', () => {
    const output = applyCellUpdates(template, [
      {
        row: TEMPLATE_DATA_START_ROW,
        col: WBS_COLUMNS.itemName,
        value: 'テスト出力',
      },
    ]);

    expect(
      readCellValue(output, SCHEDULE_SHEET_NAME, TEMPLATE_DATA_START_ROW, WBS_COLUMNS.itemName),
    ).toBe('テスト出力');
  });

  it('keeps the CFB header signature', () => {
    const output = applyCellUpdates(template, [
      {
        row: TEMPLATE_DATA_START_ROW,
        col: WBS_COLUMNS.itemName,
        value: 'テスト出力',
      },
    ]);

    expect(output.subarray(0, 8).toString('hex').toUpperCase()).toBe('D0CF11E0A1B11AE1');
  });

  it('keeps the Workbook stream terminated by EOF', () => {
    const output = applyCellUpdates(template, [
      {
        row: TEMPLATE_DATA_START_ROW,
        col: WBS_COLUMNS.itemName,
        value: 'テスト出力',
      },
    ]);
    const workbook = readWorkbookStream(output).data;

    expect(workbook.readUInt16LE(workbook.length - 4)).toBe(0x000a);
    expect(workbook.readUInt16LE(workbook.length - 2)).toBe(0);
  });
});
