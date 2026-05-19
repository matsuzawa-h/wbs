import { BadRequestException } from '@nestjs/common';
import { TextDecoder } from 'node:util';

/**
 * Decode an uploaded 稼働管理表 CSV buffer to a JS string.
 *
 * The external system exports Shift-JIS (CP932). Node ships full-ICU by
 * default (verified on the production Node v22 runtime), so the built-in
 * `TextDecoder('shift_jis')` handles it with **zero extra dependencies** —
 * no hand-rolled JIS0208 table. If the user re-saves the file as UTF-8
 * (the documented fallback), Excel writes a UTF-8 BOM; we detect it and
 * decode as UTF-8 instead so that path also works.
 *
 * On a stripped small-ICU build `new TextDecoder('shift_jis')` throws a
 * RangeError; we turn that into a clear "re-save as UTF-8" instruction.
 */
export function decodeShiftJis(buf: Buffer): string {
  // UTF-8 BOM → the file was re-saved as UTF-8 (fallback path).
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }

  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder('shift_jis', { fatal: false });
  } catch {
    throw new BadRequestException(
      'この実行環境は Shift-JIS をデコードできません。CSV を UTF-8 で再保存してから取り込んでください。',
    );
  }
  const text = decoder.decode(buf);
  // Strip a stray BOM if present (some exporters prepend U+FEFF).
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
