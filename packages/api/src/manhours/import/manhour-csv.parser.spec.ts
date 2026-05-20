import { parseCsv, parseManhourCsv } from './manhour-csv.parser';

const HEADER =
  '組織コード,組織名称,担当者,作業区分,顧客名,件名,プロジェクトCD,SE/NE担当部署,受注ランク,4月,5月,6月,7月,8月,9月,10月,11月,12月,1月,2月,3月';

// 月列を [4,5,6,7,8,9,10,11,12,1,2,3] の順で組み立てる。
const MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
function months(v: Record<number, string>): string {
  return MONTH_ORDER.map((m) => v[m] ?? '').join(',');
}
function row(
  assignee: string,
  workType: string,
  customer: string,
  subject: string,
  cd: string,
  m: Record<number, string>,
): string {
  return [
    'AA5054',
    '組織A',
    assignee,
    workType,
    customer,
    subject,
    cd,
    '組織A',
    'S',
    months(m),
  ].join(',');
}

/** UTF-8 BOM 経路でデコード（Node に Shift-JIS エンコーダが無いため）。 */
function buf(lines: string[]): Buffer {
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(lines.join('\r\n'), 'utf8'),
  ]);
}

describe('parseCsv', () => {
  it('クォート内のカンマ・改行・"" エスケープを保持する', () => {
    const grid = parseCsv('a,"OT(4,5月)_x",c\r\n"l1\nl2","q""q",z\n');
    expect(grid[0]).toEqual(['a', 'OT(4,5月)_x', 'c']);
    expect(grid[1]).toEqual(['l1\nl2', 'q"q', 'z']);
  });

  it('完全空行を除外する', () => {
    expect(parseCsv('a,b\n\n,\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseManhourCsv', () => {
  const fy = 2026;
  const csv = buf([
    HEADER,
    row('堀田　和彦', 'AFT', 'NIPPO', '"OT(4,5月)_2026年_次期"', 'AAP001', {
      4: '100.00',
      5: '10.00',
    }),
    // 同一 担当者×CD の期間分割行（4月は前行と合算、7-9月は新規）
    row('堀田　和彦', 'AFT', 'NIPPO', '"(7-9月)OT続き"', 'AAP001', {
      4: '5.00',
      7: '5.00',
      8: '5.00',
      9: '5.00',
    }),
    // 作業区分・CD 空 → 件名で案件化
    row('堤　昇太朗', '', 'AG', 'お助けサポート', '', { 4: '5.00' }),
    // zz: 非稼働。project を持たない
    row('堀田　和彦', 'zz', '休暇系', '休暇', '-', { 4: '3.00' }),
    // 合計派生行（破棄）
    row('堀田　和彦', '合計', '', '非稼働合計', '', { 4: '21.00' }),
    row('堀田　和彦', '合計', '', '稼働率', '', { 4: '88%' }),
    // 月基準時間 → capacity（1月は翌暦年）
    row('堀田　和彦', '合計', '', '月基準時間', '', {
      4: '147.00',
      5: '119.00',
      1: '160.00',
    }),
    // 1月の明細（翌暦年 2027-01）
    row('西本　拓真', 'MNT', '顧客X', '保守', 'AAP002', { 1: '8.00' }),
  ]);

  it('組織コード・組織名称・担当者順を抽出する', () => {
    const p = parseManhourCsv(csv, fy);
    expect(p.orgCode).toBe('AA5054');
    expect(p.orgName).toBe('組織A');
    expect(p.assigneeNames).toEqual(['堀田　和彦', '堤　昇太朗', '西本　拓真']);
  });

  it('顧客名(E列)は AFT 行からのみ distinct 抽出（非AFT/zz/合計は対象外）', () => {
    const p = parseManhourCsv(csv, fy);
    // 顧客は AFT 行のみ収集（NIPPO は堀田 AFT 行）。AG=空区分, 顧客X=MNT,
    // 休暇系=zz は対象外。
    expect(p.customerNames).toEqual(['NIPPO']);
    expect(p.customerNames).not.toContain('AG');
    expect(p.customerNames).not.toContain('顧客X');
    expect(p.customerNames).not.toContain('休暇系');
  });

  it('期間分割行を (担当者,CD,作業区分,年月) で合算する', () => {
    const p = parseManhourCsv(csv, fy);
    const find = (cd: string, ym: string) =>
      p.entries.find(
        (e) => e.projectKey === `cd:${cd}` && e.yearMonth === ym,
      );
    expect(find('AAP001', '2026-04')!.hours).toBe(105); // 100 + 5
    expect(find('AAP001', '2026-05')!.hours).toBe(10);
    expect(find('AAP001', '2026-07')!.hours).toBe(5);
  });

  it('会計年度の月→年月変換（4月=FY, 1月=FY+1）', () => {
    const p = parseManhourCsv(csv, fy);
    expect(
      p.entries.find((e) => e.projectKey === 'cd:AAP002')!.yearMonth,
    ).toBe('2027-01');
    expect(p.capacities.find((c) => c.yearMonth === '2027-01')!.baseHours).toBe(
      160,
    );
  });

  it('合計派生行は破棄、月基準時間のみ capacity 化', () => {
    const p = parseManhourCsv(csv, fy);
    expect(p.entries.some((e) => e.workType === '合計')).toBe(false);
    // 稼働率 88% は破棄され NaN entry にならない
    expect(p.entries.every((e) => Number.isFinite(e.hours))).toBe(true);
    const cap = p.capacities.filter((c) => c.assigneeName === '堀田　和彦');
    expect(cap.find((c) => c.yearMonth === '2026-04')!.baseHours).toBe(147);
    expect(cap.find((c) => c.yearMonth === '2026-05')!.baseHours).toBe(119);
  });

  it('zz/非AFT は projects 対象外（工数は entry として残る）', () => {
    const p = parseManhourCsv(csv, fy);
    const zz = p.entries.find((e) => e.workType === 'zz');
    expect(zz).toBeTruthy();
    expect(zz!.projectCode).toBeNull();
    // zz は件名込みでキー化（休暇/会議/事務処理 を区別するため）
    expect(zz!.projectKey).toBe('zz:堀田　和彦:休暇');
    // zz も、空区分の「お助けサポート」も projects 同一性に出ない
    expect(p.projects.some((x) => x.projectKey.startsWith('zz:'))).toBe(false);
    expect(
      p.projects.some((x) => x.projectKey === 'nm:お助けサポート'),
    ).toBe(false);
    // ただし工数は entry として保持される（ラベル計上）
    expect(
      p.entries.some(
        (e) => e.projectKey === 'nm:お助けサポート' && e.label === 'お助けサポート',
      ),
    ).toBe(true);
    // projects はすべて AFT 由来（CDあり）
    expect(p.projects.every((x) => x.projectCode !== null)).toBe(true);
  });

  it('クォート内カンマを含む件名を壊さない', () => {
    const p = parseManhourCsv(csv, fy);
    const cd1 = p.projects.find((x) => x.projectKey === 'cd:AAP001');
    expect(cd1!.sampleName).toBe('OT(4,5月)_2026年_次期');
  });
});
