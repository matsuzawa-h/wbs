import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  AppDb,
  assignees,
  customers,
  manhourCapacities,
  manhourEntries,
  manhourImportBatches,
  organizations,
  projectCodes,
  projects,
} from '../../db';
import { DB_TOKEN } from '../../db/db.module';
import { CommitManhourImportDto } from './dto/commit-import.dto';
import {
  ParsedCapacity,
  ParsedManhourEntry,
  parseManhourCsv,
  projectStemLabel,
} from './manhour-csv.parser';

export interface ManhourAssigneeMatch {
  name: string;
  suggestedAssigneeId: number | null;
}

export interface ManhourProjectMatch {
  projectKey: string;
  projectCode: string | null;
  sampleName: string;
  customerName: string | null;
  /** 件名の束ね名（複数CDを 1 プロジェクトへ自動グルーピングするキー）。 */
  stem: string;
  /** CD が project_codes に登録済みなら、その所属プロジェクト。 */
  suggestedProjectId: number | null;
  suggestedProjectName: string | null;
  /** 既定の束ね先バケット: 既存=`proj:<id>` / 新規=`grp:<stem>`。 */
  proposedGroupKey: string;
  /** バケット表示名（既存プロジェクト名 or 新規グループ名=stem）。 */
  proposedGroupName: string;
}

export interface ManhourCustomerMatch {
  name: string;
  suggestedCustomerId: number | null;
  /** 名寄せ先の既存顧客名（表記揺れで一致した場合に何へ寄せたか可視化）。 */
  suggestedCustomerName: string | null;
}

export interface ManhourOrganizationMatch {
  /** CSV A列の組織コード（無ければ null）。 */
  orgCode: string | null;
  /** CSV B列の組織名称（無ければ null）。 */
  orgName: string | null;
  /** code 一致で見つかった既存 organization。新規作成提案時は null。 */
  suggestedOrganizationId: number | null;
  suggestedOrganizationName: string | null;
}

/**
 * 顧客名の表記揺れ吸収用キー。NFKC（全角→半角・互換文字）＋空白除去＋
 * 会社表記（株式会社/(株)/㈱ 等）除去＋小文字化。**安全側**：見た目だけ
 * 違う名前を同一視するに留め、別物の名称までは統合しない。
 */
export function normalizeCustomerName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/(株式会社|有限会社|合同会社|合名会社|合資会社|\(株\)|\(有\)|\(合\))/g, '')
    .toLowerCase();
}

export interface ManhourPreviewResult {
  fiscalYear: number;
  orgCode: string | null;
  orgName: string | null;
  organizationMatch: ManhourOrganizationMatch | null;
  assigneeMatches: ManhourAssigneeMatch[];
  customerMatches: ManhourCustomerMatch[];
  projectMatches: ManhourProjectMatch[];
  entries: ParsedManhourEntry[];
  capacities: ParsedCapacity[];
  summary: {
    entryCount: number;
    capacityCount: number;
    assigneeCount: number;
    projectCount: number;
    totalHours: number;
  };
}

@Injectable()
export class ManhourImportService {
  private readonly logger = new Logger(ManhourImportService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: AppDb) {}

  preview(fileBuffer: Buffer, fiscalYear: number): ManhourPreviewResult {
    const parsed = parseManhourCsv(fileBuffer, fiscalYear);

    const existing = this.db
      .select({ id: assignees.id, name: assignees.name })
      .from(assignees)
      .all();
    const byName = new Map(existing.map((e) => [e.name, e.id]));
    const assigneeMatches: ManhourAssigneeMatch[] = parsed.assigneeNames.map(
      (name) => ({ name, suggestedAssigneeId: byName.get(name) ?? null }),
    );

    const existingCustomers = this.db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .orderBy(asc(customers.id))
      .all();
    const customerByName = new Map(
      existingCustomers.map((c) => [c.name, { id: c.id, name: c.name }]),
    );
    // 表記揺れ用: 正規化キー → 最初(最小id)の既存顧客。
    const customerByNorm = new Map<string, { id: number; name: string }>();
    for (const c of existingCustomers) {
      const k = normalizeCustomerName(c.name);
      if (k && !customerByNorm.has(k)) customerByNorm.set(k, c);
    }
    const customerMatches: ManhourCustomerMatch[] = parsed.customerNames.map(
      (name) => {
        // 完全一致を優先、無ければ正規化一致（全半角/空白/会社表記ゆれ）。
        const hit =
          customerByName.get(name) ??
          customerByNorm.get(normalizeCustomerName(name)) ??
          null;
        return {
          name,
          suggestedCustomerId: hit ? hit.id : null,
          suggestedCustomerName: hit ? hit.name : null,
        };
      },
    );
    // CD → 既存プロジェクト（project_codes が正本。1CD=1プロジェクト）。
    const codeToProject = new Map<string, { id: number; name: string }>();
    for (const r of this.db
      .select({
        code: projectCodes.code,
        id: projects.id,
        name: projects.name,
      })
      .from(projectCodes)
      .innerJoin(projects, eq(projectCodes.projectId, projects.id))
      .all()) {
      codeToProject.set(r.code, { id: r.id, name: r.name });
    }
    const projectMatches: ManhourProjectMatch[] = parsed.projects.map((p) => {
      const existing = p.projectCode
        ? (codeToProject.get(p.projectCode) ?? null)
        : null;
      const stemLabel = projectStemLabel(p.sampleName) || p.sampleName;
      let proposedGroupKey: string;
      let proposedGroupName: string;
      if (existing) {
        proposedGroupKey = `proj:${existing.id}`;
        proposedGroupName = existing.name;
      } else if (p.projectCode) {
        proposedGroupKey = `grp:${p.stem}`;
        proposedGroupName = stemLabel;
      } else {
        // CD無し: 従来どおりラベルのみ（プロジェクト化しない）。
        proposedGroupKey = `label:${p.projectKey}`;
        proposedGroupName = stemLabel;
      }
      return {
        projectKey: p.projectKey,
        projectCode: p.projectCode,
        sampleName: p.sampleName,
        customerName: p.customerName,
        stem: p.stem,
        suggestedProjectId: existing ? existing.id : null,
        suggestedProjectName: existing ? existing.name : null,
        proposedGroupKey,
        proposedGroupName,
      };
    });

    // 組織解決の提案: code が既存 organizations にあればそれ、無ければ新規作成提案。
    let organizationMatch: ManhourOrganizationMatch | null = null;
    if (parsed.orgCode || parsed.orgName) {
      const hit = parsed.orgCode
        ? (this.db
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(eq(organizations.code, parsed.orgCode))
            .get() ?? null)
        : null;
      organizationMatch = {
        orgCode: parsed.orgCode,
        orgName: parsed.orgName,
        suggestedOrganizationId: hit ? hit.id : null,
        suggestedOrganizationName: hit ? hit.name : null,
      };
    }

    const totalHours = parsed.entries.reduce((s, e) => s + e.hours, 0);
    return {
      fiscalYear,
      orgCode: parsed.orgCode,
      orgName: parsed.orgName,
      organizationMatch,
      assigneeMatches,
      customerMatches,
      projectMatches,
      entries: parsed.entries,
      capacities: parsed.capacities,
      summary: {
        entryCount: parsed.entries.length,
        capacityCount: parsed.capacities.length,
        assigneeCount: parsed.assigneeNames.length,
        projectCount: parsed.projects.length,
        totalHours,
      },
    };
  }


  commit(dto: CommitManhourImportDto): {
    batchId: number;
    assigneesCreated: number;
    customersCreated: number;
    projectsCreated: number;
    entriesInserted: number;
    capacitiesInserted: number;
  } {
    if (!dto.fileName.trim()) {
      throw new BadRequestException('fileName は必須です');
    }

    return this.db.transaction((tx) => {
      // 0) 組織の解決（取込で作成される担当者/顧客/プロジェクトに紐付けるため最初に確定）。
      //    指定無し / skip → null（紐付けなし、既存エンティティは touched しない）。
      let resolvedOrgId: number | null = null;
      const orgRes = dto.organizationResolution;
      if (orgRes) {
        if (orgRes.action === 'link' && orgRes.organizationId !== undefined) {
          const exists = tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, orgRes.organizationId))
            .get();
          if (exists) resolvedOrgId = exists.id;
        } else if (orgRes.action === 'create' && orgRes.newOrganization) {
          const code = orgRes.newOrganization.code?.trim() || null;
          // code 既存なら再利用（再取込で重複組織を作らない）
          const existing = code
            ? (tx
                .select({ id: organizations.id })
                .from(organizations)
                .where(eq(organizations.code, code))
                .get() ?? null)
            : null;
          if (existing) {
            resolvedOrgId = existing.id;
          } else {
            const created = tx
              .insert(organizations)
              .values({
                code,
                name: orgRes.newOrganization.name.trim(),
                parentId: null,
                isActive: 1,
                sortOrder: 0,
              })
              .returning()
              .get();
            resolvedOrgId = created.id;
          }
        }
      }

      // 1) 担当者の名寄せ
      let assigneesCreated = 0;
      const nameToAssigneeId = new Map<string, number>();
      for (const r of dto.assigneeResolution) {
        if (r.action === 'link' && r.assigneeId !== undefined) {
          nameToAssigneeId.set(r.name, r.assigneeId);
        } else if (r.action === 'create' && r.newEmployee) {
          const created = tx
            .insert(assignees)
            .values({
              code: r.newEmployee.code?.trim() || nextEmployeeCode(tx),
              name: r.newEmployee.name,
              nameKana: null,
              department: r.newEmployee.department ?? null,
              role: null,
              email: null,
              employmentStart: null,
              employmentEnd: null,
              worksOnHolidays: 0,
              isActive: 1,
              note: null,
              sortOrder: 0,
              organizationId: resolvedOrgId,
            })
            .returning()
            .get();
          nameToAssigneeId.set(r.name, created.id);
          assigneesCreated += 1;
        }
        // skip → マップに入れない（その担当者の行は取り込まない）
      }

      // 1.5) 顧客の名寄せ（CSV E列。未登録は顧客マスタに新規登録）
      // create でも正規化一致する既存顧客があれば再利用（再取込・表記揺れで
      // 重複顧客を作らない）。同一取込内の表記揺れも同じ顧客へ集約。
      let customersCreated = 0;
      const customerNameToId = new Map<string, number>();
      const normToCustomerId = new Map<string, number>();
      for (const c of tx
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .orderBy(asc(customers.id))
        .all()) {
        const k = normalizeCustomerName(c.name);
        if (k && !normToCustomerId.has(k)) normToCustomerId.set(k, c.id);
      }
      for (const r of dto.customerResolution ?? []) {
        if (r.action === 'link' && r.customerId !== undefined) {
          customerNameToId.set(r.name, r.customerId);
        } else if (r.action === 'create' && r.newCustomer) {
          const norm = normalizeCustomerName(r.newCustomer.name);
          const existingId = norm ? normToCustomerId.get(norm) : undefined;
          if (existingId !== undefined) {
            customerNameToId.set(r.name, existingId);
            continue;
          }
          const created = tx
            .insert(customers)
            .values({
              code: r.newCustomer.code?.trim() || null,
              name: r.newCustomer.name.trim(),
              isActive: 1,
              sortOrder: 0,
              organizationId: resolvedOrgId,
            })
            .returning()
            .get();
          customerNameToId.set(r.name, created.id);
          if (norm) normToCustomerId.set(norm, created.id);
          customersCreated += 1;
        }
        // skip → マップに入れない（その顧客は紐づけない）
      }

      // 2) 案件の名寄せ → project_codes（1プロジェクト×複数CD）。
      //   link    : 既存プロジェクトへ（複数CDが同じ projectId を指せば束ね）
      //   newGroup: 同じ groupKey のCDを 1 新規プロジェクトに集約
      //   labelOnly: マスタ化せず件名ラベルのみ（CD無し既定）
      let projectsCreated = 0;
      const keyToProjectId = new Map<string, number>();
      const labelOnlyKeys = new Set<string>();
      const groupToProjectId = new Map<string, number>();
      // 既存 project_codes（CD→projectId）が正本。再取込での重複/付け替えを防ぐ。
      const codeToProjectId = new Map<string, number>();
      for (const pc of tx
        .select({ code: projectCodes.code, projectId: projectCodes.projectId })
        .from(projectCodes)
        .all()) {
        codeToProjectId.set(pc.code, pc.projectId);
      }
      const ensureCode = (projectId: number, code: string | null): void => {
        const c = code?.trim();
        if (!c || codeToProjectId.has(c)) return;
        tx.insert(projectCodes).values({ projectId, code: c }).run();
        codeToProjectId.set(c, projectId);
        const p = tx
          .select({ code: projects.projectCode })
          .from(projects)
          .where(eq(projects.id, projectId))
          .get();
        if (p && (p.code === null || p.code === '')) {
          tx.update(projects)
            .set({ projectCode: c })
            .where(eq(projects.id, projectId))
            .run();
        }
      };

      for (const r of dto.projectResolution) {
        if (r.action === 'labelOnly') {
          labelOnlyKeys.add(r.projectKey);
          continue;
        }
        const code = r.projectCode?.trim() || null;
        // CDが既に登録済みなら常にそのプロジェクト（CD一意・再取込安全）。
        if (code && codeToProjectId.has(code)) {
          keyToProjectId.set(r.projectKey, codeToProjectId.get(code)!);
          continue;
        }
        if (r.action === 'link' && r.projectId !== undefined) {
          keyToProjectId.set(r.projectKey, r.projectId);
          ensureCode(r.projectId, code);
          continue;
        }
        // newGroup: groupKey 単位で 1 プロジェクトを作成（同名の既存仮案件は再利用）
        const gkey = r.groupKey?.trim() || r.projectKey;
        let pid = groupToProjectId.get(gkey);
        if (pid === undefined) {
          const name = (r.groupName?.trim() || r.projectKey).slice(0, 200);
          const customerId = r.customerName
            ? (customerNameToId.get(r.customerName) ?? null)
            : null;
          const dupe = tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.name, name), eq(projects.isProvisional, 1)))
            .get();
          if (dupe) {
            pid = dupe.id;
          } else {
            const created = tx
              .insert(projects)
              .values({
                name,
                customerId,
                projectCode: code,
                isProvisional: 1,
                organizationId: resolvedOrgId,
              })
              .returning()
              .get();
            pid = created.id;
            projectsCreated += 1;
          }
          groupToProjectId.set(gkey, pid);
        }
        keyToProjectId.set(r.projectKey, pid);
        ensureCode(pid, code);
      }

      // 3) 取込バッチ
      const batch = tx
        .insert(manhourImportBatches)
        .values({
          fileName: dto.fileName.trim(),
          fiscalYear: dto.fiscalYear,
          orgCode: dto.orgCode ?? null,
          rowCount: dto.entries.length,
        })
        .returning()
        .get();

      // 4) 工数明細
      let entriesInserted = 0;
      for (const e of dto.entries) {
        const assigneeId = nameToAssigneeId.get(e.assigneeName);
        if (assigneeId === undefined) continue; // skip 担当者
        const isZz = e.workType === 'zz';
        let projectId: number | null = null;
        let label: string | null = null;
        if (isZz) {
          // 非稼働: project なし、件名をラベルに（休暇/事務処理 等）。
          label = e.label ?? '非稼働';
        } else if (e.projectKey) {
          const pid = keyToProjectId.get(e.projectKey);
          if (pid !== undefined) {
            projectId = pid;
          } else {
            // labelOnly / 非AFT(プロジェクト対象外)CD / 未解決 →
            // プロジェクト化せず件名ラベルで計上（工数は欠損させない）。
            label = e.label ?? null;
          }
        }
        tx.insert(manhourEntries)
          .values({
            batchId: batch.id,
            source: 'imported',
            assigneeId,
            projectId,
            workType: e.workType ?? '',
            yearMonth: e.yearMonth,
            hours: e.hours,
            label,
            customerLabel: e.customerLabel ?? null,
          })
          .run();
        entriesInserted += 1;
      }

      // 5) 月キャパ（月基準時間）
      let capacitiesInserted = 0;
      for (const c of dto.capacities) {
        const assigneeId = nameToAssigneeId.get(c.assigneeName);
        if (assigneeId === undefined) continue;
        tx.insert(manhourCapacities)
          .values({
            batchId: batch.id,
            source: 'imported',
            assigneeId,
            yearMonth: c.yearMonth,
            baseHours: c.baseHours,
          })
          .run();
        capacitiesInserted += 1;
      }

      this.logger.log(
        `manhour import committed: batch=${batch.id} entries=${entriesInserted} ` +
          `caps=${capacitiesInserted} newAssignees=${assigneesCreated} ` +
          `newCustomers=${customersCreated} newProjects=${projectsCreated}`,
      );
      return {
        batchId: batch.id,
        assigneesCreated,
        customersCreated,
        projectsCreated,
        entriesInserted,
        capacitiesInserted,
      };
    });
  }
}

/** 既存 `assignees.code` の E### 連番から次のコードを生成（excel 取込と同方式）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nextEmployeeCode(tx: any): string {
  const rows = tx.select({ code: assignees.code }).from(assignees).all();
  let max = 0;
  for (const r of rows) {
    const m = r.code?.match(/^E(\d{3,})$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `E${String(max + 1).padStart(3, '0')}`;
}
