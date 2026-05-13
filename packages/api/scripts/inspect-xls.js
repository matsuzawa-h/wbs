#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.resolve(__dirname, '../../../../テンプレートファイル.xls');
const TARGET_SHEET = 'スケジュール';

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

function sectorOffset(sectorId, sectorSize) {
  return (sectorId + 1) * sectorSize;
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function parseCfb(buffer) {
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

  const difat = [];
  for (let i = 0; i < 109; i += 1) {
    const sectorId = readUInt32(buffer, 76 + i * 4);
    if (sectorId !== FREESECT) difat.push(sectorId);
  }

  let difatSector = firstDifatSector;
  for (let i = 0; i < difatSectorCount && difatSector !== ENDOFCHAIN; i += 1) {
    const offset = sectorOffset(difatSector, sectorSize);
    const entriesPerSector = sectorSize / 4 - 1;
    for (let j = 0; j < entriesPerSector; j += 1) {
      const sectorId = readUInt32(buffer, offset + j * 4);
      if (sectorId !== FREESECT) difat.push(sectorId);
    }
    difatSector = readUInt32(buffer, offset + entriesPerSector * 4);
  }

  const fat = [];
  for (let i = 0; i < fatSectorCount; i += 1) {
    const sectorId = difat[i];
    const offset = sectorOffset(sectorId, sectorSize);
    for (let j = 0; j < sectorSize / 4; j += 1) {
      fat.push(readUInt32(buffer, offset + j * 4));
    }
  }

  function readChain(startSector, size) {
    const chunks = [];
    let sectorId = startSector;
    let guard = 0;
    while (sectorId !== ENDOFCHAIN && sectorId !== FREESECT) {
      if (sectorId >= fat.length) {
        throw new Error(`Sector chain out of range: ${sectorId}`);
      }
      const offset = sectorOffset(sectorId, sectorSize);
      chunks.push(buffer.subarray(offset, offset + sectorSize));
      sectorId = fat[sectorId];
      guard += 1;
      if (guard > fat.length) throw new Error('Cycle in FAT chain');
    }
    return Buffer.concat(chunks).subarray(0, size);
  }

  const directoryStream = readChain(firstDirectorySector, Number.MAX_SAFE_INTEGER);
  const directory = [];
  for (let offset = 0; offset + 128 <= directoryStream.length; offset += 128) {
    const entry = directoryStream.subarray(offset, offset + 128);
    const nameBytes = entry.readUInt16LE(64);
    if (nameBytes < 2) continue;
    const name = entry.subarray(0, nameBytes - 2).toString('utf16le');
    const type = entry.readUInt8(66);
    const startSector = readUInt32(entry, 116);
    const size = Number(entry.readBigUInt64LE(120));
    directory.push({ name, type, startSector, size });
  }

  const root = directory.find((entry) => entry.type === 5);
  const miniFat = [];
  if (miniFatSectorCount > 0 && firstMiniFatSector !== ENDOFCHAIN) {
    const miniFatStream = readChain(firstMiniFatSector, miniFatSectorCount * sectorSize);
    for (let offset = 0; offset + 4 <= miniFatStream.length; offset += 4) {
      miniFat.push(readUInt32(miniFatStream, offset));
    }
  }

  let miniStream = Buffer.alloc(0);
  if (root && root.startSector !== ENDOFCHAIN && root.size > 0) {
    miniStream = readChain(root.startSector, root.size);
  }

  function readMiniChain(startMiniSector, size) {
    const chunks = [];
    let sectorId = startMiniSector;
    let guard = 0;
    while (sectorId !== ENDOFCHAIN && sectorId !== FREESECT) {
      const offset = sectorId * miniSectorSize;
      chunks.push(miniStream.subarray(offset, offset + miniSectorSize));
      sectorId = miniFat[sectorId];
      guard += 1;
      if (guard > miniFat.length) throw new Error('Cycle in mini FAT chain');
    }
    return Buffer.concat(chunks).subarray(0, size);
  }

  function readStream(name) {
    const entry = directory.find((item) => item.name === name);
    if (!entry) return null;
    if (entry.size < miniStreamCutoff && entry.type === 2) {
      return readMiniChain(entry.startSector, entry.size);
    }
    return readChain(entry.startSector, entry.size);
  }

  return { directory, readStream };
}

function decodeBiffString(data, offset) {
  const cch = data.readUInt8(offset);
  const flags = data.readUInt8(offset + 1);
  const is16Bit = (flags & 0x01) !== 0;
  const start = offset + 2;
  const byteLength = cch * (is16Bit ? 2 : 1);
  const raw = data.subarray(start, start + byteLength);
  return {
    value: is16Bit ? raw.toString('utf16le') : raw.toString('latin1'),
    byteLength: 2 + byteLength,
  };
}

function parseRecords(buffer, startOffset = 0) {
  const records = [];
  let offset = startOffset;
  while (offset + 4 <= buffer.length) {
    const type = readUInt16(buffer, offset);
    const length = readUInt16(buffer, offset + 2);
    records.push({
      type,
      length,
      offset,
      dataOffset: offset + 4,
      data: buffer.subarray(offset + 4, offset + 4 + length),
    });
    offset += 4 + length;
    if (type === 0x000a) break;
  }
  return records;
}

function parseBoundSheets(workbook) {
  const sheets = [];
  for (let offset = 0; offset + 4 <= workbook.length;) {
    const type = readUInt16(workbook, offset);
    const length = readUInt16(workbook, offset + 2);
    const data = workbook.subarray(offset + 4, offset + 4 + length);
    if (type === 0x0085) {
      const bofOffset = readUInt32(data, 0);
      const nameLength = data.readUInt8(6);
      const flags = data.readUInt8(7);
      const nameRaw = data.subarray(8, 8 + nameLength * ((flags & 1) ? 2 : 1));
      sheets.push({
        name: (flags & 1) ? nameRaw.toString('utf16le') : nameRaw.toString('latin1'),
        bofOffset,
        hiddenState: data.readUInt8(4),
        sheetType: data.readUInt8(5),
      });
    }
    offset += 4 + length;
  }
  return sheets;
}

class SegmentReader {
  constructor(segments) {
    this.segments = segments;
    this.segmentIndex = 0;
    this.offset = 0;
  }

  remainingInSegment() {
    if (this.segmentIndex >= this.segments.length) return 0;
    return this.segments[this.segmentIndex].length - this.offset;
  }

  readByte() {
    if (this.remainingInSegment() < 1) this.nextSegment();
    const value = this.segments[this.segmentIndex].readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt16() {
    const bytes = this.readBytes(2);
    return bytes.readUInt16LE(0);
  }

  readUInt32() {
    const bytes = this.readBytes(4);
    return bytes.readUInt32LE(0);
  }

  readBytes(length) {
    const chunks = [];
    let remaining = length;
    while (remaining > 0) {
      if (this.remainingInSegment() === 0) this.nextSegment();
      const take = Math.min(remaining, this.remainingInSegment());
      chunks.push(this.segments[this.segmentIndex].subarray(this.offset, this.offset + take));
      this.offset += take;
      remaining -= take;
    }
    return Buffer.concat(chunks);
  }

  nextSegment() {
    this.segmentIndex += 1;
    this.offset = 0;
    if (this.segmentIndex >= this.segments.length) {
      throw new Error('Unexpected end of SST segments');
    }
  }

  skip(length) {
    let remaining = length;
    while (remaining > 0) {
      if (this.remainingInSegment() === 0) this.nextSegment();
      const take = Math.min(remaining, this.remainingInSegment());
      this.offset += take;
      remaining -= take;
    }
  }
}

function readSst(workbook) {
  const strings = [];
  for (let offset = 0; offset + 4 <= workbook.length;) {
    const type = readUInt16(workbook, offset);
    const length = readUInt16(workbook, offset + 2);
    if (type === 0x00fc) {
      const data = workbook.subarray(offset + 4, offset + 4 + length);
      const uniqueCount = readUInt32(data, 4);
      const segments = [data.subarray(8)];
      let next = offset + 4 + length;
      while (next + 4 <= workbook.length && readUInt16(workbook, next) === 0x003c) {
        const continueLength = readUInt16(workbook, next + 2);
        segments.push(workbook.subarray(next + 4, next + 4 + continueLength));
        next += 4 + continueLength;
      }
      const reader = new SegmentReader(segments);
      for (let i = 0; i < uniqueCount; i += 1) {
        const charCount = reader.readUInt16();
        const flags = reader.readByte();
        const richTextRunCount = (flags & 0x08) ? reader.readUInt16() : 0;
        const extendedSize = (flags & 0x04) ? reader.readUInt32() : 0;
        let is16Bit = (flags & 0x01) !== 0;
        const codes = [];
        for (let c = 0; c < charCount; c += 1) {
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
      break;
    }
    offset += 4 + length;
  }
  return strings;
}

function decodeRk(raw) {
  const multiplied = (raw & 0x01) !== 0;
  const isInteger = (raw & 0x02) !== 0;
  let value;
  if (isInteger) {
    value = raw >> 2;
  } else {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(raw & 0xfffffffc, 4);
    value = bytes.readDoubleLE(0);
  }
  return multiplied ? value / 100 : value;
}

function recordName(type) {
  return (
    {
      0x0006: 'Formula',
      0x0201: 'Blank',
      0x0203: 'Number',
      0x0204: 'Label',
      0x0205: 'BoolErr',
      0x0208: 'ROW',
      0x027e: 'RK',
      0x00bd: 'MulRK',
      0x00be: 'MulBlank',
      0x00fd: 'LabelSST',
    }[type] || `0x${type.toString(16).padStart(4, '0')}`
  );
}

function cellLines(record, sst) {
  const rows = [];
  const data = record.data;
  switch (record.type) {
    case 0x00fd: {
      const row = readUInt16(data, 0);
      const col = readUInt16(data, 2);
      if (row <= 60) {
        const sstIndex = readUInt32(data, 6);
        rows.push({ type: 'LabelSST', row, col, value: sst[sstIndex] ?? `<sst:${sstIndex}>` });
      }
      break;
    }
    case 0x0203: {
      const row = readUInt16(data, 0);
      const col = readUInt16(data, 2);
      if (row <= 60) rows.push({ type: 'Number', row, col, value: data.readDoubleLE(6) });
      break;
    }
    case 0x0201: {
      const row = readUInt16(data, 0);
      const col = readUInt16(data, 2);
      if (row <= 60) rows.push({ type: 'Blank', row, col, value: '' });
      break;
    }
    case 0x027e: {
      const row = readUInt16(data, 0);
      const col = readUInt16(data, 2);
      if (row <= 60) rows.push({ type: 'RK', row, col, value: decodeRk(readUInt32(data, 6)) });
      break;
    }
    case 0x00bd: {
      const row = readUInt16(data, 0);
      const firstCol = readUInt16(data, 2);
      const lastCol = readUInt16(data, data.length - 2);
      if (row <= 60) {
        for (let col = firstCol; col <= lastCol; col += 1) {
          const entryOffset = 4 + (col - firstCol) * 6;
          rows.push({ type: 'MulRK', row, col, value: decodeRk(readUInt32(data, entryOffset + 2)) });
        }
      }
      break;
    }
    case 0x00be: {
      const row = readUInt16(data, 0);
      const firstCol = readUInt16(data, 2);
      const lastCol = readUInt16(data, data.length - 2);
      if (row <= 60) {
        for (let col = firstCol; col <= lastCol; col += 1) {
          rows.push({ type: 'MulBlank', row, col, value: '' });
        }
      }
      break;
    }
    case 0x0204: {
      const row = readUInt16(data, 0);
      const col = readUInt16(data, 2);
      if (row <= 60) {
        const { value } = decodeBiffString(data, 6);
        rows.push({ type: 'Label', row, col, value });
      }
      break;
    }
    default:
      break;
  }
  return rows;
}

function main() {
  const file = fs.readFileSync(TEMPLATE_PATH);
  const cfb = parseCfb(file);
  const workbook = cfb.readStream('Workbook') || cfb.readStream('Book');
  if (!workbook) throw new Error('Workbook stream not found');

  const sheets = parseBoundSheets(workbook);
  console.log('Sheets:');
  for (const sheet of sheets) {
    console.log(`- name="${sheet.name}" bofOffset=${sheet.bofOffset} hidden=${sheet.hiddenState} type=${sheet.sheetType}`);
  }

  const target = sheets.find((sheet) => sheet.name === TARGET_SHEET);
  if (!target) throw new Error(`Sheet not found: ${TARGET_SHEET}`);

  const sst = readSst(workbook);
  const records = parseRecords(workbook, target.bofOffset);
  console.log('');
  console.log(`${TARGET_SHEET} ROW records rows 0-60:`);
  for (const record of records) {
    if (record.type !== 0x0208) continue;
    const rowIndex = readUInt16(record.data, 0);
    if (rowIndex > 60) continue;
    const firstCol = readUInt16(record.data, 2);
    const lastCol = readUInt16(record.data, 4);
    console.log(`ROW rowIndex=${rowIndex} firstCol=${firstCol} lastCol=${lastCol}`);
  }

  console.log('');
  console.log(`${TARGET_SHEET} cells rows 0-60:`);
  for (const record of records) {
    for (const cell of cellLines(record, sst)) {
      console.log(`${cell.type} row=${cell.row} col=${cell.col} value=${JSON.stringify(cell.value)}`);
    }
  }
}

main();
