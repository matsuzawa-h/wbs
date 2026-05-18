const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;

export const BIFF_RECORD = {
  EOF: 0x000a,
  BOUND_SHEET_8: 0x0085,
  SST: 0x00fc,
  EXT_SST: 0x00ff,
  CONTINUE: 0x003c,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  BOOL_ERR: 0x0205,
  FORMULA: 0x0006,
  ROW: 0x0208,
  RK: 0x027e,
  MUL_RK: 0x00bd,
  MUL_BLANK: 0x00be,
  LABEL_SST: 0x00fd,
} as const;

export interface DirectoryEntry {
  index: number;
  name: string;
  type: number;
  startSector: number;
  size: number;
  directoryOffset: number;
  fileOffset: number;
}

export interface CompoundFile {
  buffer: Buffer;
  sectorSize: number;
  miniSectorSize: number;
  miniStreamCutoff: number;
  difat: number[];
  fat: number[];
  directory: DirectoryEntry[];
  readStream(name: string): StreamData | null;
  getSectorChain(startSector: number): number[];
}

export interface StreamData {
  entry: DirectoryEntry;
  data: Buffer;
  sectorChain: number[];
  isMiniStream: boolean;
}

export interface BiffRecord {
  type: number;
  length: number;
  offset: number;
  dataOffset: number;
  endOffset: number;
  data: Buffer;
}

export interface SheetInfo {
  name: string;
  bofOffset: number;
  hiddenState: number;
  sheetType: number;
  recordOffset: number;
  dataOffset: number;
}

export interface SharedStringTable {
  totalCount: number;
  uniqueCount: number;
  strings: string[];
  sstRecord: BiffRecord;
  continueRecords: BiffRecord[];
  extSstRecord: BiffRecord | null;
  endOffset: number;
}

export type CellRecordType =
  | 'Blank'
  | 'Number'
  | 'Label'
  | 'LabelSST'
  | 'RK'
  | 'MulRK'
  | 'MulBlank'
  | 'Formula'
  | 'BoolErr';

export interface CellInfo {
  recordType: CellRecordType;
  row: number;
  col: number;
  xf: number;
  value: string | number | boolean | null;
  record: BiffRecord;
  sstIndex?: number;
}

function sectorOffset(sectorId: number, sectorSize: number): number {
  return (sectorId + 1) * sectorSize;
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function isEndOfChain(sectorId: number): boolean {
  return sectorId === ENDOFCHAIN || sectorId === FREESECT;
}

export function parseCompoundFile(buffer: Buffer): CompoundFile {
  const signature = buffer.subarray(0, 8).toString('hex').toUpperCase();
  if (signature !== 'D0CF11E0A1B11AE1') {
    throw new Error(`Not a CFB file: ${signature}`);
  }

  const sectorSize = 1 << buffer.readUInt16LE(30);
  const miniSectorSize = 1 << buffer.readUInt16LE(32);
  const fatSectorCount = readUInt32(buffer, 44);
  const firstDirectorySector = readUInt32(buffer, 48);
  const miniStreamCutoff = readUInt32(buffer, 56);
  const firstMiniFatSector = readUInt32(buffer, 60);
  const miniFatSectorCount = readUInt32(buffer, 64);
  const firstDifatSector = readUInt32(buffer, 68);
  const difatSectorCount = readUInt32(buffer, 72);

  const difat: number[] = [];
  for (let i = 0; i < 109; i += 1) {
    const sectorId = readUInt32(buffer, 76 + i * 4);
    if (sectorId !== FREESECT) difat.push(sectorId);
  }

  let difatSector = firstDifatSector;
  for (let i = 0; i < difatSectorCount && !isEndOfChain(difatSector); i += 1) {
    const offset = sectorOffset(difatSector, sectorSize);
    const entriesPerSector = sectorSize / 4 - 1;
    for (let j = 0; j < entriesPerSector; j += 1) {
      const sectorId = readUInt32(buffer, offset + j * 4);
      if (sectorId !== FREESECT) difat.push(sectorId);
    }
    difatSector = readUInt32(buffer, offset + entriesPerSector * 4);
  }

  const fat: number[] = [];
  for (let i = 0; i < fatSectorCount; i += 1) {
    const sectorId = difat[i];
    if (sectorId === undefined) {
      throw new Error(`Missing FAT sector ${i}`);
    }
    const offset = sectorOffset(sectorId, sectorSize);
    for (let j = 0; j < sectorSize / 4; j += 1) {
      fat.push(readUInt32(buffer, offset + j * 4));
    }
  }

  function getSectorChain(startSector: number): number[] {
    const chain: number[] = [];
    let sectorId = startSector;
    let guard = 0;
    while (!isEndOfChain(sectorId)) {
      if (sectorId >= fat.length) {
        throw new Error(`Sector chain out of range: ${sectorId}`);
      }
      if (sectorId === FATSECT || sectorId === DIFSECT) {
        throw new Error(`Unexpected special sector in stream chain: ${sectorId}`);
      }
      chain.push(sectorId);
      sectorId = fat[sectorId];
      guard += 1;
      if (guard > fat.length) throw new Error('Cycle in FAT chain');
    }
    return chain;
  }

  function readChain(startSector: number, size?: number): Buffer {
    const chunks = getSectorChain(startSector).map((sectorId) => {
      const offset = sectorOffset(sectorId, sectorSize);
      return buffer.subarray(offset, offset + sectorSize);
    });
    const data = Buffer.concat(chunks);
    return size === undefined ? data : data.subarray(0, size);
  }

  const directoryChain = getSectorChain(firstDirectorySector);
  const directoryStream = Buffer.concat(
    directoryChain.map((sectorId) => {
      const offset = sectorOffset(sectorId, sectorSize);
      return buffer.subarray(offset, offset + sectorSize);
    }),
  );

  function directoryEntryFileOffset(directoryOffset: number): number {
    const sectorIndex = Math.floor(directoryOffset / sectorSize);
    const sectorInnerOffset = directoryOffset % sectorSize;
    const sectorId = directoryChain[sectorIndex];
    if (sectorId === undefined) {
      throw new Error(`Directory entry offset out of range: ${directoryOffset}`);
    }
    return sectorOffset(sectorId, sectorSize) + sectorInnerOffset;
  }

  const directory: DirectoryEntry[] = [];
  for (let offset = 0; offset + 128 <= directoryStream.length; offset += 128) {
    const entry = directoryStream.subarray(offset, offset + 128);
    const nameBytes = entry.readUInt16LE(64);
    if (nameBytes < 2) continue;
    const name = entry.subarray(0, nameBytes - 2).toString('utf16le');
    const type = entry.readUInt8(66);
    const startSector = readUInt32(entry, 116);
    const size = Number(entry.readBigUInt64LE(120));
    directory.push({
      index: offset / 128,
      name,
      type,
      startSector,
      size,
      directoryOffset: offset,
      fileOffset: directoryEntryFileOffset(offset),
    });
  }

  const root = directory.find((entry) => entry.type === 5);
  const miniFat: number[] = [];
  if (miniFatSectorCount > 0 && !isEndOfChain(firstMiniFatSector)) {
    const miniFatStream = readChain(firstMiniFatSector, miniFatSectorCount * sectorSize);
    for (let offset = 0; offset + 4 <= miniFatStream.length; offset += 4) {
      miniFat.push(readUInt32(miniFatStream, offset));
    }
  }

  const miniStream =
    root && !isEndOfChain(root.startSector) && root.size > 0
      ? readChain(root.startSector, root.size)
      : Buffer.alloc(0);

  function readMiniChain(startMiniSector: number, size: number): Buffer {
    const chunks: Buffer[] = [];
    let sectorId = startMiniSector;
    let guard = 0;
    while (!isEndOfChain(sectorId)) {
      const offset = sectorId * miniSectorSize;
      chunks.push(miniStream.subarray(offset, offset + miniSectorSize));
      sectorId = miniFat[sectorId] ?? ENDOFCHAIN;
      guard += 1;
      if (guard > miniFat.length) throw new Error('Cycle in mini FAT chain');
    }
    return Buffer.concat(chunks).subarray(0, size);
  }

  function readStream(name: string): StreamData | null {
    const entry = directory.find((item) => item.name === name);
    if (!entry) return null;
    if (entry.type !== 2) {
      throw new Error(`${name} is not a stream`);
    }
    if (entry.size < miniStreamCutoff) {
      return {
        entry,
        data: readMiniChain(entry.startSector, entry.size),
        sectorChain: [],
        isMiniStream: true,
      };
    }
    return {
      entry,
      data: readChain(entry.startSector, entry.size),
      sectorChain: getSectorChain(entry.startSector),
      isMiniStream: false,
    };
  }

  return {
    buffer,
    sectorSize,
    miniSectorSize,
    miniStreamCutoff,
    difat,
    fat,
    directory,
    readStream,
    getSectorChain,
  };
}

export function readWorkbookStream(buffer: Buffer): StreamData {
  const cfb = parseCompoundFile(buffer);
  const workbook = cfb.readStream('Workbook') ?? cfb.readStream('Book');
  if (!workbook) {
    throw new Error('Workbook stream not found');
  }
  return workbook;
}

export function parseBiffRecords(buffer: Buffer, startOffset = 0): BiffRecord[] {
  const records: BiffRecord[] = [];
  let offset = startOffset;
  while (offset + 4 <= buffer.length) {
    const type = readUInt16(buffer, offset);
    const length = readUInt16(buffer, offset + 2);
    const dataOffset = offset + 4;
    const endOffset = dataOffset + length;
    if (endOffset > buffer.length) {
      throw new Error(`BIFF record overruns stream at ${offset}`);
    }
    records.push({
      type,
      length,
      offset,
      dataOffset,
      endOffset,
      data: buffer.subarray(dataOffset, endOffset),
    });
    offset = endOffset;
    if (type === BIFF_RECORD.EOF) break;
  }
  return records;
}

export function parseBoundSheets(workbook: Buffer): SheetInfo[] {
  const sheets: SheetInfo[] = [];
  for (let offset = 0; offset + 4 <= workbook.length;) {
    const type = readUInt16(workbook, offset);
    const length = readUInt16(workbook, offset + 2);
    const dataOffset = offset + 4;
    const endOffset = dataOffset + length;
    if (endOffset > workbook.length) break;
    if (type === BIFF_RECORD.BOUND_SHEET_8) {
      const data = workbook.subarray(dataOffset, endOffset);
      const nameLength = data.readUInt8(6);
      const flags = data.readUInt8(7);
      const nameRaw = data.subarray(8, 8 + nameLength * ((flags & 1) ? 2 : 1));
      sheets.push({
        name: (flags & 1) ? nameRaw.toString('utf16le') : nameRaw.toString('latin1'),
        bofOffset: readUInt32(data, 0),
        hiddenState: data.readUInt8(4),
        sheetType: data.readUInt8(5),
        recordOffset: offset,
        dataOffset,
      });
    }
    offset = endOffset;
  }
  return sheets;
}

class SegmentReader {
  private segmentIndex = 0;
  private offset = 0;

  constructor(private readonly segments: Buffer[]) {}

  remainingInSegment(): number {
    if (this.segmentIndex >= this.segments.length) return 0;
    return this.segments[this.segmentIndex].length - this.offset;
  }

  readByte(): number {
    if (this.remainingInSegment() < 1) this.nextSegment();
    const segment = this.segments[this.segmentIndex];
    const value = segment.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt16(): number {
    return this.readBytes(2).readUInt16LE(0);
  }

  readUInt32(): number {
    return this.readBytes(4).readUInt32LE(0);
  }

  readBytes(length: number): Buffer {
    const chunks: Buffer[] = [];
    let remaining = length;
    while (remaining > 0) {
      if (this.remainingInSegment() === 0) this.nextSegment();
      const take = Math.min(remaining, this.remainingInSegment());
      const segment = this.segments[this.segmentIndex];
      chunks.push(segment.subarray(this.offset, this.offset + take));
      this.offset += take;
      remaining -= take;
    }
    return Buffer.concat(chunks);
  }

  nextSegment(): void {
    this.segmentIndex += 1;
    this.offset = 0;
    if (this.segmentIndex >= this.segments.length) {
      throw new Error('Unexpected end of SST segments');
    }
  }

  skip(length: number): void {
    let remaining = length;
    while (remaining > 0) {
      if (this.remainingInSegment() === 0) this.nextSegment();
      const take = Math.min(remaining, this.remainingInSegment());
      this.offset += take;
      remaining -= take;
    }
  }
}

export function parseSharedStringTable(workbook: Buffer): SharedStringTable {
  for (let offset = 0; offset + 4 <= workbook.length;) {
    const type = readUInt16(workbook, offset);
    const length = readUInt16(workbook, offset + 2);
    const dataOffset = offset + 4;
    const endOffset = dataOffset + length;
    if (type === BIFF_RECORD.SST) {
      const sstRecord: BiffRecord = {
        type,
        length,
        offset,
        dataOffset,
        endOffset,
        data: workbook.subarray(dataOffset, endOffset),
      };
      const continueRecords: BiffRecord[] = [];
      let cursor = endOffset;
      while (cursor + 4 <= workbook.length && readUInt16(workbook, cursor) === BIFF_RECORD.CONTINUE) {
        const continueLength = readUInt16(workbook, cursor + 2);
        const continueDataOffset = cursor + 4;
        const continueEndOffset = continueDataOffset + continueLength;
        continueRecords.push({
          type: BIFF_RECORD.CONTINUE,
          length: continueLength,
          offset: cursor,
          dataOffset: continueDataOffset,
          endOffset: continueEndOffset,
          data: workbook.subarray(continueDataOffset, continueEndOffset),
        });
        cursor = continueEndOffset;
      }

      let extSstRecord: BiffRecord | null = null;
      if (cursor + 4 <= workbook.length && readUInt16(workbook, cursor) === BIFF_RECORD.EXT_SST) {
        const extLength = readUInt16(workbook, cursor + 2);
        const extDataOffset = cursor + 4;
        extSstRecord = {
          type: BIFF_RECORD.EXT_SST,
          length: extLength,
          offset: cursor,
          dataOffset: extDataOffset,
          endOffset: extDataOffset + extLength,
          data: workbook.subarray(extDataOffset, extDataOffset + extLength),
        };
      }

      const totalCount = readUInt32(sstRecord.data, 0);
      const uniqueCount = readUInt32(sstRecord.data, 4);
      const strings = readSstStrings(uniqueCount, [
        sstRecord.data.subarray(8),
        ...continueRecords.map((record) => record.data),
      ]);
      return {
        totalCount,
        uniqueCount,
        strings,
        sstRecord,
        continueRecords,
        extSstRecord,
        endOffset: continueRecords.at(-1)?.endOffset ?? sstRecord.endOffset,
      };
    }
    offset = endOffset;
  }
  throw new Error('SST record not found');
}

function readSstStrings(uniqueCount: number, segments: Buffer[]): string[] {
  const strings: string[] = [];
  const reader = new SegmentReader(segments);
  for (let i = 0; i < uniqueCount; i += 1) {
    const charCount = reader.readUInt16();
    const flags = reader.readByte();
    const richTextRunCount = (flags & 0x08) ? reader.readUInt16() : 0;
    const extendedSize = (flags & 0x04) ? reader.readUInt32() : 0;
    let is16Bit = (flags & 0x01) !== 0;
    const codes: number[] = [];
    for (let charIndex = 0; charIndex < charCount; charIndex += 1) {
      const width = is16Bit ? 2 : 1;
      if (reader.remainingInSegment() < width) {
        reader.nextSegment();
        is16Bit = (reader.readByte() & 0x01) !== 0;
      }
      codes.push(is16Bit ? reader.readUInt16() : reader.readByte());
    }
    if (richTextRunCount > 0) reader.skip(richTextRunCount * 4);
    if (extendedSize > 0) reader.skip(extendedSize);
    strings.push(String.fromCharCode(...codes));
  }
  return strings;
}

export function parseWorksheetRecords(workbook: Buffer, sheetName: string): BiffRecord[] {
  const sheet = parseBoundSheets(workbook).find((item) => item.name === sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }
  return parseBiffRecords(workbook, sheet.bofOffset);
}

export function enumerateWorksheetCells(
  workbook: Buffer,
  sheetName: string,
  rowStart: number,
  rowEnd: number,
): CellInfo[] {
  const sst = parseSharedStringTable(workbook).strings;
  const records = parseWorksheetRecords(workbook, sheetName);
  const cells: CellInfo[] = [];
  for (const record of records) {
    cells.push(...cellsFromRecord(record, sst).filter((cell) => cell.row >= rowStart && cell.row <= rowEnd));
  }
  return cells;
}

export function readCellValue(
  fileBuffer: Buffer,
  sheetName: string,
  row: number,
  col: number,
): string | number | boolean | null {
  const workbook = readWorkbookStream(fileBuffer).data;
  return (
    enumerateWorksheetCells(workbook, sheetName, row, row).find(
      (cell) => cell.row === row && cell.col === col,
    )?.value ?? null
  );
}

export function cellsFromRecord(record: BiffRecord, sst: string[]): CellInfo[] {
  const data = record.data;
  switch (record.type) {
    case BIFF_RECORD.LABEL_SST: {
      const sstIndex = readUInt32(data, 6);
      return [
        {
          recordType: 'LabelSST',
          row: readUInt16(data, 0),
          col: readUInt16(data, 2),
          xf: readUInt16(data, 4),
          value: sst[sstIndex] ?? null,
          record,
          sstIndex,
        },
      ];
    }
    case BIFF_RECORD.NUMBER:
      return [
        {
          recordType: 'Number',
          row: readUInt16(data, 0),
          col: readUInt16(data, 2),
          xf: readUInt16(data, 4),
          value: data.readDoubleLE(6),
          record,
        },
      ];
    case BIFF_RECORD.BLANK:
      return [
        {
          recordType: 'Blank',
          row: readUInt16(data, 0),
          col: readUInt16(data, 2),
          xf: readUInt16(data, 4),
          value: null,
          record,
        },
      ];
    case BIFF_RECORD.RK:
      return [
        {
          recordType: 'RK',
          row: readUInt16(data, 0),
          col: readUInt16(data, 2),
          xf: readUInt16(data, 4),
          value: decodeRk(readUInt32(data, 6)),
          record,
        },
      ];
    case BIFF_RECORD.MUL_RK: {
      const row = readUInt16(data, 0);
      const firstCol = readUInt16(data, 2);
      const lastCol = readUInt16(data, data.length - 2);
      const cells: CellInfo[] = [];
      for (let col = firstCol; col <= lastCol; col += 1) {
        const entryOffset = 4 + (col - firstCol) * 6;
        cells.push({
          recordType: 'MulRK',
          row,
          col,
          xf: readUInt16(data, entryOffset),
          value: decodeRk(readUInt32(data, entryOffset + 2)),
          record,
        });
      }
      return cells;
    }
    case BIFF_RECORD.MUL_BLANK: {
      const row = readUInt16(data, 0);
      const firstCol = readUInt16(data, 2);
      const lastCol = readUInt16(data, data.length - 2);
      const cells: CellInfo[] = [];
      for (let col = firstCol; col <= lastCol; col += 1) {
        const xfOffset = 4 + (col - firstCol) * 2;
        cells.push({
          recordType: 'MulBlank',
          row,
          col,
          xf: readUInt16(data, xfOffset),
          value: null,
          record,
        });
      }
      return cells;
    }
    case BIFF_RECORD.LABEL: {
      const row = readUInt16(data, 0);
      const col = readUInt16(data, 2);
      const xf = readUInt16(data, 4);
      const label = decodeShortString(data, 6);
      return [{ recordType: 'Label', row, col, xf, value: label.value, record }];
    }
    case BIFF_RECORD.BOOL_ERR:
      return [
        {
          recordType: 'BoolErr',
          row: readUInt16(data, 0),
          col: readUInt16(data, 2),
          xf: readUInt16(data, 4),
          value: data.readUInt8(6) !== 0,
          record,
        },
      ];
    default:
      return [];
  }
}

export function recordTypeName(type: number): string {
  return (
    {
      [BIFF_RECORD.FORMULA]: 'Formula',
      [BIFF_RECORD.BLANK]: 'Blank',
      [BIFF_RECORD.NUMBER]: 'Number',
      [BIFF_RECORD.LABEL]: 'Label',
      [BIFF_RECORD.BOOL_ERR]: 'BoolErr',
      [BIFF_RECORD.ROW]: 'ROW',
      [BIFF_RECORD.RK]: 'RK',
      [BIFF_RECORD.MUL_RK]: 'MulRK',
      [BIFF_RECORD.MUL_BLANK]: 'MulBlank',
      [BIFF_RECORD.LABEL_SST]: 'LabelSST',
    }[type] ?? `0x${type.toString(16).padStart(4, '0')}`
  );
}

export function decodeRk(raw: number): number {
  const multiplied = (raw & 0x01) !== 0;
  const isInteger = (raw & 0x02) !== 0;
  let value: number;
  if (isInteger) {
    value = raw >> 2;
  } else {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(raw & 0xfffffffc, 4);
    value = bytes.readDoubleLE(0);
  }
  return multiplied ? value / 100 : value;
}

function decodeShortString(data: Buffer, offset: number): { value: string; byteLength: number } {
  const charCount = data.readUInt8(offset);
  const flags = data.readUInt8(offset + 1);
  const is16Bit = (flags & 0x01) !== 0;
  const start = offset + 2;
  const byteLength = charCount * (is16Bit ? 2 : 1);
  const raw = data.subarray(start, start + byteLength);
  return {
    value: is16Bit ? raw.toString('utf16le') : raw.toString('latin1'),
    byteLength: 2 + byteLength,
  };
}
