import {
  BIFF_RECORD,
  BiffRecord,
  CellInfo,
  DirectoryEntry,
  cellsFromRecord,
  parseBiffRecords,
  parseBoundSheets,
  parseCompoundFile,
  parseSharedStringTable,
} from './biff-reader';
import { SCHEDULE_SHEET_NAME } from './column-map';

const BIFF_MAX_RECORD_DATA = 8224;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

export interface CellUpdate {
  row: number;
  col: number;
  value: string | number | null;
}

interface WorkbookWithDelta {
  workbook: Buffer;
  delta: number;
}

type NormalizedCellValue = string | number | null;

export function applyCellUpdates(
  templateBuffer: Buffer,
  updates: CellUpdate[],
  sheetName = SCHEDULE_SHEET_NAME,
): Buffer {
  if (updates.length === 0) {
    return Buffer.from(templateBuffer);
  }

  const cfb = parseCompoundFile(templateBuffer);
  const workbookStream = cfb.readStream('Workbook') ?? cfb.readStream('Book');
  if (!workbookStream) {
    throw new Error('Workbook stream not found');
  }
  if (workbookStream.isMiniStream) {
    throw new Error('Workbook stream unexpectedly uses the CFB mini stream');
  }

  const workbook = Buffer.from(workbookStream.data);
  const sst = parseSharedStringTable(workbook);
  const stringIndexes = new Map<string, number>();
  sst.strings.forEach((value, index) => {
    if (!stringIndexes.has(value)) stringIndexes.set(value, index);
  });

  const newStrings = collectNewStrings(updates, stringIndexes, sst.strings.length);
  const withStrings = insertSstStrings(workbook, newStrings, sst.totalCount, sst.uniqueCount);
  const rewritten = replaceWorksheetCells(withStrings.workbook, sheetName, updates, stringIndexes);

  return writeWorkbookStream(templateBuffer, workbookStream.entry, workbookStream.sectorChain, rewritten.workbook);
}

function collectNewStrings(
  updates: CellUpdate[],
  stringIndexes: Map<string, number>,
  existingUniqueCount: number,
): string[] {
  const newStrings: string[] = [];
  for (const update of updates) {
    if (typeof update.value !== 'string' || update.value.length === 0) continue;
    if (!stringIndexes.has(update.value)) {
      stringIndexes.set(update.value, existingUniqueCount + newStrings.length);
      newStrings.push(update.value);
    }
  }
  return newStrings;
}

function insertSstStrings(
  workbook: Buffer,
  newStrings: string[],
  totalCount: number,
  uniqueCount: number,
): WorkbookWithDelta {
  if (newStrings.length === 0) {
    return { workbook, delta: 0 };
  }

  const sst = parseSharedStringTable(workbook);
  const insertion = buildContinueRecords(newStrings);
  const replaceStart = sst.endOffset;

  // ExtSST is an optional acceleration index into the SST. Once the SST grows,
  // the existing bucket index is stale, so the writer removes it rather than
  // leaving incorrect offsets for Excel to consult.
  const replaceEnd = sst.extSstRecord?.endOffset ?? sst.endOffset;
  const delta = insertion.length - (replaceEnd - replaceStart);
  const nextWorkbook = Buffer.concat([
    workbook.subarray(0, replaceStart),
    insertion,
    workbook.subarray(replaceEnd),
  ]);

  nextWorkbook.writeUInt32LE(totalCount + newStrings.length, sst.sstRecord.dataOffset);
  nextWorkbook.writeUInt32LE(uniqueCount + newStrings.length, sst.sstRecord.dataOffset + 4);

  for (const sheet of parseBoundSheets(workbook)) {
    if (sheet.bofOffset >= replaceEnd) {
      nextWorkbook.writeUInt32LE(sheet.bofOffset + delta, sheet.dataOffset);
    }
  }

  return { workbook: nextWorkbook, delta };
}

function buildContinueRecords(strings: string[]): Buffer {
  const records: Buffer[] = [];
  let payloadParts: Buffer[] = [];
  let payloadLength = 0;

  function flush(): void {
    if (payloadLength === 0) return;
    const payload = Buffer.concat(payloadParts, payloadLength);
    const record = Buffer.alloc(4 + payload.length);
    record.writeUInt16LE(BIFF_RECORD.CONTINUE, 0);
    record.writeUInt16LE(payload.length, 2);
    payload.copy(record, 4);
    records.push(record);
    payloadParts = [];
    payloadLength = 0;
  }

  for (const value of strings) {
    const encoded = encodeSstString(value);
    if (encoded.length > BIFF_MAX_RECORD_DATA) {
      throw new Error(`String is too long for this minimal SST writer: ${value.slice(0, 32)}`);
    }
    if (payloadLength + encoded.length > BIFF_MAX_RECORD_DATA) {
      flush();
    }
    payloadParts.push(encoded);
    payloadLength += encoded.length;
  }
  flush();

  return Buffer.concat(records);
}

function encodeSstString(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf16le');
  const data = Buffer.alloc(3 + encoded.length);
  data.writeUInt16LE(value.length, 0);
  data.writeUInt8(0x01, 2);
  encoded.copy(data, 3);
  return data;
}

function replaceWorksheetCells(
  workbook: Buffer,
  sheetName: string,
  updates: CellUpdate[],
  stringIndexes: Map<string, number>,
): WorkbookWithDelta {
  const sheets = parseBoundSheets(workbook);
  const sheet = sheets.find((item) => item.name === sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const sstStrings = parseSharedStringTable(workbook).strings;
  const worksheetRecords = parseBiffRecords(workbook, sheet.bofOffset);
  const sheetEnd = worksheetRecords.at(-1)?.endOffset;
  if (sheetEnd === undefined) {
    throw new Error(`Sheet has no records: ${sheetName}`);
  }

  const pendingUpdates = new Map<string, NormalizedCellValue>();
  for (const update of updates) {
    pendingUpdates.set(cellKey(update.row, update.col), normalizeValue(update.value));
  }

  const rewrittenRecords: Buffer[] = [];
  for (const record of worksheetRecords) {
    const cells = cellsFromRecord(record, sstStrings);
    const touchesRecord = cells.some((cell) => pendingUpdates.has(cellKey(cell.row, cell.col)));
    if (!touchesRecord) {
      rewrittenRecords.push(workbook.subarray(record.offset, record.endOffset));
      continue;
    }

    for (const cell of cells) {
      const key = cellKey(cell.row, cell.col);
      const value = pendingUpdates.has(key) ? pendingUpdates.get(key)! : preserveValue(cell);
      rewrittenRecords.push(makeCellRecord(cell.row, cell.col, cell.xf, value, stringIndexes));
      pendingUpdates.delete(key);
    }
  }

  if (pendingUpdates.size > 0) {
    const missing = [...pendingUpdates.keys()].slice(0, 10).join(', ');
    throw new Error(`Template is missing writable cell records for: ${missing}`);
  }

  const rewrittenSheet = Buffer.concat(rewrittenRecords);
  const delta = rewrittenSheet.length - (sheetEnd - sheet.bofOffset);
  const nextWorkbook = Buffer.concat([
    workbook.subarray(0, sheet.bofOffset),
    rewrittenSheet,
    workbook.subarray(sheetEnd),
  ]);

  if (delta !== 0) {
    for (const otherSheet of sheets) {
      if (otherSheet.bofOffset > sheet.bofOffset) {
        nextWorkbook.writeUInt32LE(otherSheet.bofOffset + delta, otherSheet.dataOffset);
      }
    }
  }

  return { workbook: nextWorkbook, delta };
}

function preserveValue(cell: CellInfo): NormalizedCellValue {
  if (typeof cell.value === 'string' || typeof cell.value === 'number' || cell.value === null) {
    return cell.value;
  }
  return cell.value ? 1 : 0;
}

function normalizeValue(value: string | number | null): NormalizedCellValue {
  if (typeof value === 'string' && value.length === 0) return null;
  return value;
}

function makeCellRecord(
  row: number,
  col: number,
  xf: number,
  value: NormalizedCellValue,
  stringIndexes: Map<string, number>,
): Buffer {
  if (value === null) {
    const record = makeRecord(BIFF_RECORD.BLANK, 6);
    record.writeUInt16LE(row, 4);
    record.writeUInt16LE(col, 6);
    record.writeUInt16LE(xf, 8);
    return record;
  }

  if (typeof value === 'number') {
    const record = makeRecord(BIFF_RECORD.NUMBER, 14);
    record.writeUInt16LE(row, 4);
    record.writeUInt16LE(col, 6);
    record.writeUInt16LE(xf, 8);
    record.writeDoubleLE(value, 10);
    return record;
  }

  const sstIndex = stringIndexes.get(value);
  if (sstIndex === undefined) {
    throw new Error(`String was not added to the SST: ${value}`);
  }
  const record = makeRecord(BIFF_RECORD.LABEL_SST, 10);
  record.writeUInt16LE(row, 4);
  record.writeUInt16LE(col, 6);
  record.writeUInt16LE(xf, 8);
  record.writeUInt32LE(sstIndex, 10);
  return record;
}

function makeRecord(type: number, dataLength: number): Buffer {
  const record = Buffer.alloc(4 + dataLength);
  record.writeUInt16LE(type, 0);
  record.writeUInt16LE(dataLength, 2);
  return record;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function writeWorkbookStream(
  fileBuffer: Buffer,
  workbookEntry: DirectoryEntry,
  workbookSectorChain: number[],
  workbookData: Buffer,
): Buffer {
  const cfb = parseCompoundFile(fileBuffer);
  const sectorSize = cfb.sectorSize;
  const neededSectors = Math.ceil(workbookData.length / sectorSize);
  if (neededSectors === 0) {
    throw new Error('Refusing to write an empty Workbook stream');
  }

  const fat = [...cfb.fat];
  const chain = [...workbookSectorChain];
  if (neededSectors > chain.length) {
    appendSectors(fileBuffer, sectorSize, cfb.difat, fat, chain, neededSectors - chain.length);
  }

  const currentSectorCount = Math.ceil((fileBuffer.length - sectorSize) / sectorSize);
  const appendedSectorCount = Math.max(0, chain.length - workbookSectorChain.length);
  const output = Buffer.alloc(fileBuffer.length + appendedSectorCount * sectorSize);
  fileBuffer.copy(output);

  patchFat(output, cfb.difat, fat, cfb.fat, sectorSize);

  for (let i = 0; i < chain.length; i += 1) {
    const sectorId = chain[i];
    const offset = sectorOffset(sectorId, sectorSize);
    if (sectorId >= currentSectorCount) {
      output.fill(0, offset, offset + sectorSize);
    } else {
      output.fill(0, offset, offset + sectorSize);
    }
    const sourceStart = i * sectorSize;
    const sourceEnd = Math.min(sourceStart + sectorSize, workbookData.length);
    if (sourceStart < workbookData.length) {
      workbookData.copy(output, offset, sourceStart, sourceEnd);
    }
  }

  output.writeBigUInt64LE(BigInt(workbookData.length), workbookEntry.fileOffset + 120);
  return output;
}

function appendSectors(
  fileBuffer: Buffer,
  sectorSize: number,
  difat: number[],
  fat: number[],
  chain: number[],
  count: number,
): void {
  const currentSectorCount = Math.ceil((fileBuffer.length - sectorSize) / sectorSize);
  const entriesPerFatSector = sectorSize / 4;
  const fatCapacity = difat.length * entriesPerFatSector;
  const firstNewSector = currentSectorCount;
  const lastNewSector = firstNewSector + count - 1;
  if (lastNewSector >= fatCapacity) {
    throw new Error('Workbook stream growth requires adding a FAT sector, which is not implemented');
  }
  if (chain.length === 0) {
    throw new Error('Workbook stream has an empty sector chain');
  }

  let previous = chain[chain.length - 1];
  for (let i = 0; i < count; i += 1) {
    const sectorId = firstNewSector + i;
    fat[previous] = sectorId;
    fat[sectorId] = i === count - 1 ? ENDOFCHAIN : sectorId + 1;
    chain.push(sectorId);
    previous = sectorId;
  }
}

function patchFat(
  output: Buffer,
  difat: number[],
  nextFat: number[],
  previousFat: number[],
  sectorSize: number,
): void {
  const entriesPerFatSector = sectorSize / 4;
  for (let i = 0; i < nextFat.length; i += 1) {
    if ((previousFat[i] ?? FREESECT) === nextFat[i]) continue;
    const fatSectorId = difat[Math.floor(i / entriesPerFatSector)];
    if (fatSectorId === undefined) {
      throw new Error(`No FAT sector for FAT entry ${i}`);
    }
    const offset = sectorOffset(fatSectorId, sectorSize) + (i % entriesPerFatSector) * 4;
    output.writeUInt32LE(nextFat[i], offset);
  }
}

function sectorOffset(sectorId: number, sectorSize: number): number {
  return (sectorId + 1) * sectorSize;
}
