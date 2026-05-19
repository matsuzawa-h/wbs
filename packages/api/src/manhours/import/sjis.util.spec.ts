import { decodeShiftJis } from './sjis.util';

describe('decodeShiftJis', () => {
  it('CP932 の漢字をデコードする', () => {
    // 日本語
    expect(
      decodeShiftJis(Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea])),
    ).toBe('日本語');
  });

  it('半角カタカナ(単バイト 0xA1-0xDF)をデコードする', () => {
    // ｱｲｳ
    expect(decodeShiftJis(Buffer.from([0xb1, 0xb2, 0xb3]))).toBe('ｱｲｳ');
  });

  it('UTF-8 BOM 付き(再保存フォールバック)は UTF-8 として読む', () => {
    const b = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('担当者,工数', 'utf8'),
    ]);
    expect(decodeShiftJis(b)).toBe('担当者,工数');
  });
});
