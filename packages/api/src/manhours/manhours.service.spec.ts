import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { AppDb } from '../db';
import { ManhoursService } from './manhours.service';
import { ManhourImportService } from './import/manhour-import.service';
import type { CommitManhourImportDto } from './import/dto/commit-import.dto';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

function makeDb(): { db: AppDb; close: () => void } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const s = stmt.trim();
      if (s) sqlite.exec(s);
    }
  }
  const db = drizzle(sqlite, { schema }) as unknown as AppDb;
  return { db, close: () => sqlite.close() };
}

const HEADER =
  '組織コード,組織名称,担当者,作業区分,顧客名,件名,プロジェクトCD,SE/NE担当部署,受注ランク,4月,5月,6月,7月,8月,9月,10月,11月,12月,1月,2月,3月';
const MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
function months(v: Record<number, string>): string {
  return MONTH_ORDER.map((m) => v[m] ?? '').join(',');
}
function csvBuf(rows: string[][]): Buffer {
  const lines = [
    HEADER,
    ...rows.map((r) =>
      [
        'AA5054',
        '組織A',
        r[0],
        r[1],
        r[2],
        r[3],
        r[4],
        '組織A',
        'S',
        r[5],
      ].join(','),
    ),
  ];
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(lines.join('\r\n'), 'utf8'),
  ]);
}

// 取込→preview→自動名寄せ(create/createProvisional)で commit dto を組む。
function commitDtoFromPreview(
  imp: ManhourImportService,
  buf: Buffer,
  fy: number,
  fileName: string,
): CommitManhourImportDto {
  const p = imp.preview(buf, fy);
  return {
    fileName,
    fiscalYear: fy,
    orgCode: p.orgCode,
    organizationResolution: p.organizationMatch
      ? p.organizationMatch.suggestedOrganizationId !== null
        ? {
            action: 'link' as const,
            organizationId: p.organizationMatch.suggestedOrganizationId,
          }
        : {
            action: 'create' as const,
            newOrganization: {
              code: p.organizationMatch.orgCode ?? undefined,
              name: p.organizationMatch.orgName ?? p.organizationMatch.orgCode ?? '組織',
            },
          }
      : undefined,
    assigneeResolution: p.assigneeMatches.map((m) =>
      m.suggestedAssigneeId !== null
        ? { name: m.name, action: 'link', assigneeId: m.suggestedAssigneeId }
        : { name: m.name, action: 'create', newEmployee: { name: m.name } },
    ),
    customerResolution: p.customerMatches.map((m) =>
      m.suggestedCustomerId !== null
        ? { name: m.name, action: 'link', customerId: m.suggestedCustomerId }
        : { name: m.name, action: 'create', newCustomer: { name: m.name } },
    ),
    projectResolution: p.projectMatches.map((m) => {
      if (m.suggestedProjectId !== null)
        return {
          projectKey: m.projectKey,
          action: 'link',
          projectId: m.suggestedProjectId,
          projectCode: m.projectCode,
        };
      // CD無し＆未一致は既定でラベルのみ（マスタ化しない）。
      if (!m.projectCode)
        return { projectKey: m.projectKey, action: 'labelOnly' };
      // CD有り未一致は提案グループ（同一 stem の複数CDが 1 プロジェクトへ）。
      return {
        projectKey: m.projectKey,
        action: 'newGroup',
        projectCode: m.projectCode,
        groupKey: m.proposedGroupKey,
        groupName: m.proposedGroupName,
        customerName: m.customerName,
      };
    }),
    entries: p.entries.map((e) => ({
      assigneeName: e.assigneeName,
      projectKey: e.projectKey,
      workType: e.workType,
      yearMonth: e.yearMonth,
      hours: e.hours,
      label: e.label,
      customerLabel: e.customerLabel,
      projectCode: e.projectCode,
    })),
    capacities: p.capacities.map((c) => ({
      assigneeName: c.assigneeName,
      yearMonth: c.yearMonth,
      baseHours: c.baseHours,
    })),
  };
}

const SAMPLE = (): string[][] => [
  ['堀田　和彦', 'AFT', 'NIPPO', 'A案件', 'AAP001', months({ 4: '100', 5: '40' })],
  ['堀田　和彦', 'zz', '休暇系', '休暇', '-', months({ 4: '8' })],
  ['堀田　和彦', '合計', '', '月基準時間', '', months({ 4: '160', 5: '160' })],
  ['西本　拓真', 'MNT', '顧客X', 'B案件', 'AAP002', months({ 5: '20' })],
];

describe('ManhourImportService + ManhoursService', () => {
  const FY = 2026;

  it('取込で担当者と仮案件を自動作成し、稼働率を Σ/基準で算出する', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      const res = imp.commit(
        commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'),
      );
      expect(res.assigneesCreated).toBe(2); // 堀田/西本（全区分の行から）
      // 顧客・プロジェクトは AFT 行のみ対象 → NIPPO / AAP001 だけ。
      // 西本の B案件(AAP002,顧客X) は MNT なので projects/customers 化しない。
      expect(res.customersCreated).toBe(1);
      expect(res.projectsCreated).toBe(1);

      // 仮案件が CSV顧客名で作成済み顧客に紐づく（zz の 休暇系 は対象外）
      const nippo = db
        .select()
        .from(schema.customers)
        .all()
        .find((c) => c.name === 'NIPPO')!;
      expect(nippo).toBeTruthy();
      const aap001 = db
        .select()
        .from(schema.projects)
        .all()
        .find((p) => p.projectCode === 'AAP001')!;
      expect(aap001.customerId).toBe(nippo.id);
      expect(
        db
          .select()
          .from(schema.customers)
          .all()
          .some((c) => c.name === '休暇系'),
      ).toBe(false);

      const sum = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const horita = sum.rows.find((r) => r.assigneeName === '堀田　和彦')!;
      const apr = horita.cells['2026-04'];
      // 100(A案件) + 8(zz非稼働) = 108、基準 160
      expect(apr.total).toBe(108);
      expect(apr.base).toBe(160);
      expect(apr.utilization).toBeCloseTo(108 / 160, 5);
      // zz は project なしで内訳に出る
      expect(apr.byProject.some((b) => b.workType === 'zz')).toBe(true);
    } finally {
      close();
    }
  });

  it('取込時に組織を自動解決し、作成された担当者/顧客/仮案件を同じ組織に紐付ける', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));

      // 組織は AA5054 / 組織A で 1 件作成される
      const orgs = db.select().from(schema.organizations).all();
      expect(orgs.length).toBe(1);
      expect(orgs[0].code).toBe('AA5054');
      expect(orgs[0].name).toBe('組織A');
      const orgId = orgs[0].id;

      // 取込で作成された担当者/顧客/プロジェクトはすべて同じ組織を持つ
      const horita = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '堀田　和彦')!;
      expect(horita.organizationId).toBe(orgId);
      const nippo = db
        .select()
        .from(schema.customers)
        .all()
        .find((c) => c.name === 'NIPPO')!;
      expect(nippo.organizationId).toBe(orgId);
      const aap001 = db
        .select()
        .from(schema.projects)
        .all()
        .find((p) => p.projectCode === 'AAP001')!;
      expect(aap001.organizationId).toBe(orgId);

      // 再取込しても組織は重複作成しない（code 一致で再利用）
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'b.csv'));
      expect(db.select().from(schema.organizations).all().length).toBe(1);
    } finally {
      close();
    }
  });

  it('再取込しても仮案件を重複作成しない（CD で再利用）／履歴は保持', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));
      const b2 = imp.commit(
        commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'),
      );
      expect(b2.assigneesCreated).toBe(0); // 既存に link
      expect(b2.projectsCreated).toBe(0); // 仮案件は CD で再利用

      const projectCount = db
        .select()
        .from(schema.projects)
        .all()
        .filter((p) => p.isProvisional === 1).length;
      expect(projectCount).toBe(1); // AFT の AAP001 のみ

      const batches = svc.listBatches(FY);
      expect(batches.length).toBe(2);

      // 最新バッチのみ集計（合算で二重にならない）
      const latest = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: false },
      });
      expect(
        latest.rows.find((r) => r.assigneeName === '堀田　和彦')!.cells[
          '2026-04'
        ].total,
      ).toBe(108);

      // 過去バッチを明示すると履歴を参照できる
      const old = svc.getSummary({
        batchId: batches[1].id,
        filter: { imported: true, manual: false },
      });
      expect(old.rows.length).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it('getSummary: 取込分は「そのバッチに属する社員」、manual は assignee.org で絞る', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));

      // 取込で 2 名（堀田/西本）作成、両方とも組織 AA5054 に紐付く。
      // バッチも organization_id = org.id で記録される。
      const org = db.select().from(schema.organizations).all()[0];
      expect(org.code).toBe('AA5054');
      const batches = svc.listBatches();
      expect(batches[0].organizationId).toBe(org.id);

      const horita = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '堀田　和彦')!;
      const nishi = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '西本　拓真')!;
      // 西本だけ組織を外して「未設定」グループへ（手動付け替え相当）
      db.update(schema.assignees)
        .set({ organizationId: null })
        .where(eq(schema.assignees.id, nishi.id))
        .run();

      // organizationId 指定無し → 組織別最新バッチを集約。今回は 1 バッチ。
      const all = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      expect(all.rows.map((r) => r.assigneeId).sort()).toEqual(
        [horita.id, nishi.id].sort(),
      );

      // 組織 AA5054 指定 → AA5054 のバッチに含まれる社員はすべて見せる。
      // 西本は現在 org=null だが、AA5054 のバッチ取込に含まれていたので残る。
      // （リンクで別組織所属になった社員も「そのバッチの社員」として扱う）
      const inOrg = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
        organizationId: org.id,
      });
      expect(inOrg.batchId).toBe(batches[0].id);
      expect(inOrg.rows.map((r) => r.assigneeId).sort()).toEqual(
        [horita.id, nishi.id].sort(),
      );

      // 組織 null（未設定）指定 → 「組織未紐付バッチ」が無いので imported は空。
      // manual も assignee.org=null の社員のみだが、今 manual entry が無いので空。
      const noOrg = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
        organizationId: null,
      });
      expect(noOrg.batchId).toBeNull();
      expect(noOrg.rows).toEqual([]);

      // listBatches は組織絞り込みで「そのバッチが属するか」で判定される。
      expect(svc.listBatches(FY, org.id).map((b) => b.id)).toEqual([
        batches[0].id,
      ]);
      expect(svc.listBatches(FY, null)).toEqual([]);
    } finally {
      close();
    }
  });

  it('複数組織のバッチが混在する場合、未指定モードでは組織別最新バッチを集約する', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      // 1st: org AA5054（堀田/西本）
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));
      const orgA = db.select().from(schema.organizations).all()[0];

      // 2nd: 別組織 BB5099 を新規作成して取込（堀田はリンク、別人「新人」を新規）
      // 別の CSV を生成（組織コード/名称を変える + 新人を追加）
      function csvBufWithOrg(orgCode: string, orgName: string, rows: string[][]): Buffer {
        const header =
          '組織コード,組織名称,担当者,作業区分,顧客名,件名,プロジェクトCD,SE/NE担当部署,受注ランク,4月,5月,6月,7月,8月,9月,10月,11月,12月,1月,2月,3月';
        const lines = [header, ...rows.map((r) =>
          [orgCode, orgName, r[0], r[1], r[2], r[3], r[4], orgName, 'S', r[5]].join(','),
        )];
        return Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(lines.join('\r\n'), 'utf8'),
        ]);
      }
      imp.commit(
        commitDtoFromPreview(
          imp,
          csvBufWithOrg('BB5099', '別組織', [
            ['堀田　和彦', 'AFT', 'NIPPO', 'A2', 'BB001', months({ 4: '50' })],
            ['新人　太郎', 'AFT', 'NIPPO', 'A2', 'BB001', months({ 4: '30' })],
            ['堀田　和彦', '合計', '', '月基準時間', '', months({ 4: '160' })],
            ['新人　太郎', '合計', '', '月基準時間', '', months({ 4: '160' })],
          ]),
          FY,
          'b.csv',
        ),
      );
      const orgB = db
        .select()
        .from(schema.organizations)
        .all()
        .find((o) => o.code === 'BB5099')!;
      const horita = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '堀田　和彦')!;
      const newcomer = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '新人　太郎')!;
      const batches = svc.listBatches(FY);
      expect(batches.length).toBe(2);

      // 未指定モード（"すべて"）→ org A と org B の最新バッチを集約。
      // 堀田は両方の最新バッチに登場するので、堀田の cells は両バッチ合算（150h）。
      // 西本 (org A) と 新人 (org B) もそれぞれ自分のバッチで登場する。
      const all = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const ids = new Set(all.rows.map((r) => r.assigneeId));
      expect(ids.has(horita.id)).toBe(true);
      expect(ids.has(newcomer.id)).toBe(true);
      expect(all.batchId).toBeNull(); // 複数バッチ集約時は単一 ID にならない

      // 組織 A 指定 → A の最新バッチのみ。堀田の 4月 は org A 分の 100h。
      const a = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
        organizationId: orgA.id,
      });
      const horitaInA = a.rows.find((r) => r.assigneeId === horita.id)!;
      expect(horitaInA.cells['2026-04'].total).toBe(108); // 100 AFT + 8 zz休暇
      expect(a.rows.find((r) => r.assigneeId === newcomer.id)).toBeUndefined();

      // 組織 B 指定 → B の最新バッチのみ。堀田の 4月 は org B 分の 50h（リンクで入った）。
      const b = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
        organizationId: orgB.id,
      });
      const horitaInB = b.rows.find((r) => r.assigneeId === horita.id)!;
      expect(horitaInB.cells['2026-04'].total).toBe(50);
      const newcomerInB = b.rows.find((r) => r.assigneeId === newcomer.id)!;
      expect(newcomerInB.cells['2026-04'].total).toBe(30);
    } finally {
      close();
    }
  });

  it('getBatchStats: 取込バッチの統計（担当者数/案件数/明細件数/合計工数/月別）', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));
      const b = svc.listBatches()[0];

      const stats = svc.getBatchStats(b.id);
      expect(stats.batchId).toBe(b.id);
      expect(stats.fiscalYear).toBe(FY);
      // SAMPLE: 堀田/西本 の 2 名、AFT の AAP001 のみプロジェクト化 = 1 件、
      // 堀田の zz 休暇 + AFT 2 月 + 西本 MNT = entries 4 件
      expect(stats.assigneeCount).toBe(2);
      expect(stats.projectCount).toBe(1); // AAP001 のみ
      expect(stats.entryCount).toBe(4);
      // 100(AFT 4月) + 40(AFT 5月) + 8(zz 4月) + 20(MNT 5月) = 168
      expect(stats.totalHours).toBe(168);
      expect(stats.monthlyTotals['2026-04']).toBe(108);
      expect(stats.monthlyTotals['2026-05']).toBe(60);
      expect(stats.capacityCount).toBe(2); // 堀田 4月+5月 = 2
    } finally {
      close();
    }
  });

  it('getBatchDiffWithPrevious: 直前バッチが無い場合は previousBatchId=null', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));
      const b = svc.listBatches()[0];
      const d = svc.getBatchDiffWithPrevious(b.id);
      expect(d.currentBatchId).toBe(b.id);
      expect(d.previousBatchId).toBeNull();
      // delta は current の値そのもの
      expect(d.delta.totalHours).toBe(168);
    } finally {
      close();
    }
  });

  it('getBatchDiffWithPrevious: 同 org+年度の直前バッチと比較し追加/消失/月別差分を返す', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      // 1 回目: SAMPLE そのまま
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));

      // 2 回目: 西本（MNT）を削除し、堀田の 4月を 100→120 に増やす
      const rows2: string[][] = [
        ['堀田　和彦', 'AFT', 'NIPPO', 'A案件', 'AAP001', months({ 4: '120', 5: '40' })],
        ['堀田　和彦', 'zz', '休暇系', '休暇', '-', months({ 4: '8' })],
        ['堀田　和彦', '合計', '', '月基準時間', '', months({ 4: '160', 5: '160' })],
      ];
      imp.commit(commitDtoFromPreview(imp, csvBuf(rows2), FY, 'b.csv'));

      const batches = svc.listBatches();
      // listBatches は importedAt desc。最新が b.csv 側
      const latest = batches[0];
      const previous = batches[1];
      const d = svc.getBatchDiffWithPrevious(latest.id);

      expect(d.previousBatchId).toBe(previous.id);
      // 全体工数の差分: 1回目=168, 2回目=120+40+8=168 → 同じ？ 違う、計算しなおし。
      // 2回目: 120(AFT 4月) + 40(AFT 5月) + 8(zz 4月) = 168
      // 1回目: 100(AFT 4月) + 40(AFT 5月) + 8(zz 4月) + 20(MNT 5月 西本) = 168
      // → totalHours は同じだが、内訳が違う。assignee_count は 2→1（-1）
      expect(d.delta.assigneeCount).toBe(-1);
      // 4月の合計差分: (120+8) - (100+8) = +20、5月: 40 - (40+20) = -20
      expect(d.delta.monthlyTotals['2026-04']).toBe(20);
      expect(d.delta.monthlyTotals['2026-05']).toBe(-20);
      // 西本は消えた
      expect(d.removedAssignees.map((a) => a.name)).toContain('西本　拓真');
      expect(d.addedAssignees).toEqual([]);
    } finally {
      close();
    }
  });

  it('確定(imported)プロジェクトに negative manual overlay を保存して total を下げられる', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));

      const horita = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '堀田　和彦')!;
      const aap001 = db
        .select()
        .from(schema.projects)
        .all()
        .find((p) => p.projectCode === 'AAP001')!;

      // SAMPLE: AAP001 / 堀田 / 2026-04 = 100 (AFT)
      // popup での編集相当: total を 100 → 80 に下げる → manual = -20 を保存
      svc.upsertManualEntry({
        assigneeId: horita.id,
        projectId: aap001.id,
        workType: '',
        yearMonth: '2026-04',
        hours: -20,
      });

      const mx = svc.getProjectMatrix(aap001.id, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const row = mx.rows.find((r) => r.assigneeId === horita.id)!;
      const cell = row.cells['2026-04'];
      expect(cell.imported).toBe(100);
      expect(cell.manual).toBe(-20);
      expect(cell.total).toBe(80);

      // total を取込値に戻す（manual = 0 で削除）
      svc.upsertManualEntry({
        assigneeId: horita.id,
        projectId: aap001.id,
        workType: '',
        yearMonth: '2026-04',
        hours: 0,
      });
      const mx2 = svc.getProjectMatrix(aap001.id, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const cell2 = mx2.rows.find((r) => r.assigneeId === horita.id)!.cells[
        '2026-04'
      ];
      expect(cell2.imported).toBe(100);
      expect(cell2.manual).toBe(0);
      expect(cell2.total).toBe(100);
    } finally {
      close();
    }
  });

  it('手入力(仮案件)と取込を結合し、確定/仮トグルで出し分ける', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));

      const horitaId = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '堀田　和彦')!.id;
      const prov = svc.createManualProject({ name: '見込み案件Z' });
      svc.upsertManualEntry({
        assigneeId: horitaId,
        projectId: prov.id,
        yearMonth: '2026-04',
        hours: 30,
      });

      const both = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const apr = both.rows.find((r) => r.assigneeName === '堀田　和彦')!.cells[
        '2026-04'
      ];
      expect(apr.imported).toBe(108);
      expect(apr.manual).toBe(30);
      expect(apr.total).toBe(138);

      const onlyImported = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: false },
      });
      expect(
        onlyImported.rows.find((r) => r.assigneeName === '堀田　和彦')!.cells[
          '2026-04'
        ].total,
      ).toBe(108);

      // upsert は同キーを置換（追加でなく上書き）
      svc.upsertManualEntry({
        assigneeId: horitaId,
        projectId: prov.id,
        yearMonth: '2026-04',
        hours: 50,
      });
      const after = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: false, manual: true },
      });
      expect(
        after.rows.find((r) => r.assigneeName === '堀田　和彦')!.cells[
          '2026-04'
        ].manual,
      ).toBe(50);
    } finally {
      close();
    }
  });

  it('案件別マトリクスは担当者×月で合算する', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhoursService(db);
      const importer = new ManhourImportService(db);
      importer.commit(
        commitDtoFromPreview(importer, csvBuf(SAMPLE()), FY, 'a.csv'),
      );
      const proj = db
        .select()
        .from(schema.projects)
        .all()
        .find((p) => p.projectCode === 'AAP001')!;
      const mx = imp.getProjectMatrix(proj.id, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      expect(mx.grandTotal).toBe(140); // 100 + 40
      expect(mx.monthTotals['2026-04']).toBe(100);
      expect(mx.rows[0].cells['2026-05'].total).toBe(40);
    } finally {
      close();
    }
  });

  it('顧客名は表記揺れ(全角/全角空白)を吸収して同一顧客に名寄せ', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));
      const custCount = () => db.select().from(schema.customers).all().length;
      expect(custCount()).toBe(1); // AFT 行の NIPPO のみ（顧客X は MNT）

      // 再取込: 顧客名を「ＮＩＰＰＯ　」(全角＋全角空白) に
      const rows = [
        ['堀田　和彦', 'AFT', 'ＮＩＰＰＯ　', 'A案件', 'AAP001', months({ 4: '10' })],
        ['堀田　和彦', '合計', '', '月基準時間', '', months({ 4: '160' })],
      ];
      // 全角空白は parser の trim で除去され、全角英字は NFKC で吸収される
      const p = imp.preview(csvBuf(rows), FY);
      const m = p.customerMatches.find((x) => x.name === 'ＮＩＰＰＯ')!;
      expect(m.suggestedCustomerId).not.toBeNull();
      expect(m.suggestedCustomerName).toBe('NIPPO'); // 既存へ名寄せ

      // create を明示しても正規化一致で重複作成しない（commit 側の二重防御）
      const dto2 = commitDtoFromPreview(imp, csvBuf(rows), FY, 'b.csv');
      imp.commit({
        ...dto2,
        fileName: 'c.csv',
        customerResolution: dto2.customerResolution.map((c) =>
          c.name === 'ＮＩＰＰＯ'
            ? { name: c.name, action: 'create', newCustomer: { name: c.name } }
            : c,
        ),
      });
      expect(custCount()).toBe(1); // 顧客は増えない
    } finally {
      close();
    }
  });

  it('工程ごとに別CDでも件名ステムが同じなら 1 プロジェクトに束ねる', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      const rows = [
        ['堀田　和彦', 'AFT', 'NIPPO', '駆付けサービス対応（SS-ST工程）', 'AAP803', months({ 4: '10' })],
        ['西本　拓真', 'AFT', 'NIPPO', '(4?6月)駆付けサービス対応（UI工程）', 'AAP802', months({ 5: '20' })],
      ];
      const res = imp.commit(commitDtoFromPreview(imp, csvBuf(rows), FY, 'a.csv'));
      // 2 CD だが束ね名が同一 → 新規プロジェクトは 1 個だけ
      expect(res.projectsCreated).toBe(1);
      const projs = db
        .select()
        .from(schema.projects)
        .all()
        .filter((p) => p.name === '駆付けサービス対応');
      expect(projs.length).toBe(1);
      const pid = projs[0].id;
      // project_codes に 2 CD がぶら下がる
      const codes = db
        .select()
        .from(schema.projectCodes)
        .all()
        .filter((c) => c.projectId === pid)
        .map((c) => c.code)
        .sort();
      expect(codes).toEqual(['AAP802', 'AAP803']);
      // 工数は 1 プロジェクトに合算（10 + 20）
      const mx = svc.getProjectMatrix(pid, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      expect(mx.grandTotal).toBe(30);

      // 再取込: 既存CDなので新規作成されず同じプロジェクトへ
      const res2 = imp.commit(
        commitDtoFromPreview(imp, csvBuf(rows), FY, 'b.csv'),
      );
      expect(res2.projectsCreated).toBe(0);
      expect(
        db
          .select()
          .from(schema.projects)
          .all()
          .filter((p) => p.name === '駆付けサービス対応').length,
      ).toBe(1);
    } finally {
      close();
    }
  });

  it('プロジェクト化対象は AFT/SY かつ CD有りのみ（CD無しAFT・MNTはラベル）', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      const rows = [
        ['堀田　和彦', 'SY', 'NIPPO', 'SY見積', 'AAPSY1', months({ 4: '12' })],
        ['堀田　和彦', 'AFT', 'NIPPO', 'CD無しAFT作業', '', months({ 5: '7' })],
        ['西本　拓真', 'MNT', '顧客X', '保守', 'AAPMNT', months({ 6: '9' })],
      ];
      const res = imp.commit(commitDtoFromPreview(imp, csvBuf(rows), FY, 'a.csv'));
      // SY+CD の AAPSY1 のみプロジェクト化。CD無しAFT・MNT は不作成。
      expect(res.projectsCreated).toBe(1);
      const projNames = db
        .select()
        .from(schema.projects)
        .all()
        .map((p) => p.name);
      expect(projNames).toContain('SY見積');
      expect(projNames).not.toContain('CD無しAFT作業');
      expect(projNames).not.toContain('保守');

      const sum = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const horita = sum.rows.find((r) => r.assigneeName === '堀田　和彦')!;
      // SY見積(プロジェクト) と CD無しAFT作業(ラベル) の両方が計上される
      expect(horita.cells['2026-04'].total).toBe(12);
      const may = horita.cells['2026-05'];
      expect(may.total).toBe(7);
      expect(
        may.byProject.some(
          (b) => b.projectId === null && b.projectName === 'CD無しAFT作業',
        ),
      ).toBe(true);
      // MNT 保守 もラベルで計上
      const nishi = sum.rows.find((r) => r.assigneeName === '西本　拓真')!;
      expect(nishi.cells['2026-06'].total).toBe(9);
    } finally {
      close();
    }
  });

  it('担当者別明細（原本形・FY12ヶ月・確定/仮の行）を返す', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      imp.commit(commitDtoFromPreview(imp, csvBuf(SAMPLE()), FY, 'a.csv'));
      const horita = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '堀田　和彦')!;
      // 取込のみ
      const d = svc.getAssigneeDetail(horita.id, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      expect(d.assigneeName).toBe('堀田　和彦');
      expect(d.months).toEqual([
        '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
        '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
      ]);
      const aft = d.rows.find((r) => r.projectCode === 'AAP001')!;
      expect(aft.workType).toBe('AFT');
      expect(aft.customerName).toBe('NIPPO');
      expect(aft.source).toBe('imported');
      expect(aft.cells['2026-04']).toBe(100);
      expect(aft.total).toBe(140);
      // zz はラベル行（project なし）。SAMPLE の zz は「休暇」なので 休暇 行になる。
      const vac = d.rows.find(
        (r) => r.workType === 'zz' && r.subject === '休暇',
      );
      expect(vac).toBeTruthy();
      expect(vac!.cells['2026-04']).toBe(8);
      // 月別の基準時間（標準時間）が response に含まれる
      expect(d.capacity['2026-04']).toBe(160);
      expect(d.capacity['2026-05']).toBe(160);

      // SAMPLE の MNT 行（AAP002, projects 化されない）の CD は
      // entries.project_code_label にフォールバックして表示される
      const nishimoto = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '西本　拓真')!;
      const dn = svc.getAssigneeDetail(nishimoto.id, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const mnt = dn.rows.find(
        (r) => r.workType === 'MNT' && r.projectId === null,
      )!;
      expect(mnt).toBeTruthy();
      expect(mnt.projectCode).toBe('AAP002'); // projects 化しないが CD は表示

      // 仮の手入力を足すと manual 行として出る
      svc.upsertManualEntry({
        assigneeId: horita.id,
        projectId: aft.projectId,
        workType: 'AFT',
        yearMonth: '2026-06',
        hours: 5,
      });
      const d2 = svc.getAssigneeDetail(horita.id, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const man = d2.rows.find(
        (r) => r.source === 'manual' && r.projectId === aft.projectId,
      )!;
      expect(man.cells['2026-06']).toBe(5);
    } finally {
      close();
    }
  });

  it('明細の行順: AFT(顧客名→CD,NULL末尾) → MNT等 → 非稼働 → 休暇', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      const rows = [
        ['堀田　和彦', 'AFT', '顧客B', 'Bproj', 'AAP200', months({ 4: '4' })],
        ['堀田　和彦', 'AFT', '顧客A', 'Aproj', 'AAP100', months({ 4: '3' })],
        ['堀田　和彦', 'AFT', '', 'CD無しAFT', '', months({ 4: '2' })],
        ['堀田　和彦', 'MNT', '顧客X', '保守', 'AAPMNT', months({ 4: '9' })],
        ['堀田　和彦', 'zz', '事務系', '事務処理', '-', months({ 4: '5' })],
        ['堀田　和彦', 'zz', '休暇系', '休暇', '-', months({ 4: '8' })],
      ];
      imp.commit(commitDtoFromPreview(imp, csvBuf(rows), FY, 'a.csv'));
      const horita = db
        .select()
        .from(schema.assignees)
        .all()
        .find((a) => a.name === '堀田　和彦')!;
      const d = svc.getAssigneeDetail(horita.id, {
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const seq = d.rows.map((r) => ({
        wt: r.workType,
        cust: r.customerName,
        code: r.projectCode,
        subj: r.subject,
      }));
      // AFT(顧客A) → AFT(顧客B) → AFT(顧客空=末尾) → MNT → 非稼働(zz) → 休暇(zz)
      expect(seq[0]).toMatchObject({ wt: 'AFT', cust: '顧客A' });
      expect(seq[1]).toMatchObject({ wt: 'AFT', cust: '顧客B' });
      expect(seq[2].wt).toBe('AFT');
      expect(seq[2].cust === null || seq[2].cust === '').toBe(true);
      expect(seq[3].wt).toBe('MNT');
      expect(seq[4]).toMatchObject({ wt: 'zz', subj: '非稼働' });
      expect(seq[5]).toMatchObject({ wt: 'zz', subj: '休暇' });
      // 件名ごとに合算（マージされない）
      expect(d.rows.find((r) => r.subject === '休暇')!.cells['2026-04']).toBe(8);
      expect(
        d.rows.find((r) => r.subject === '非稼働')!.cells['2026-04'],
      ).toBe(5);
    } finally {
      close();
    }
  });

  it('CD無し明細はラベルのみ（projects マスタを作らず件名で内訳表示）', () => {
    const { db, close } = makeDb();
    try {
      const imp = new ManhourImportService(db);
      const svc = new ManhoursService(db);
      const rows = [
        ...SAMPLE(),
        // CD 無しのフリー作業
        ['西本　拓真', 'MNT', '顧客X', '保守作業', '', months({ 6: '10' })],
      ];
      const res = imp.commit(commitDtoFromPreview(imp, csvBuf(rows), FY, 'a.csv'));
      // AFT の AAP001 のみ作成。AAP002(MNT)・CD無し「保守作業」(MNT) は不作成。
      expect(res.projectsCreated).toBe(1);
      const hasHosyu = db
        .select()
        .from(schema.projects)
        .all()
        .some((p) => p.name === '保守作業');
      expect(hasHosyu).toBe(false);

      // 工数は担当者に計上され、内訳は件名ラベルで出る。
      const sum = svc.getSummary({
        fiscalYear: FY,
        filter: { imported: true, manual: true },
      });
      const nishimoto = sum.rows.find((r) => r.assigneeName === '西本　拓真')!;
      const jun = nishimoto.cells['2026-06'];
      expect(jun.total).toBe(10);
      expect(
        jun.byProject.some(
          (b) => b.projectId === null && b.projectName === '保守作業',
        ),
      ).toBe(true);
    } finally {
      close();
    }
  });
});
