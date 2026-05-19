import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  AppDb,
  assignees,
  customers,
  manhourCapacities,
  manhourEntries,
  manhourImportBatches,
  projects,
} from '../../db';
import { DB_TOKEN } from '../../db/db.module';
import { CommitManhourImportDto } from './dto/commit-import.dto';
import {
  ParsedCapacity,
  ParsedManhourEntry,
  ParsedProjectIdentity,
  parseManhourCsv,
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
  suggestedProjectId: number | null;
  suggestedProjectName: string | null;
}

export interface ManhourCustomerMatch {
  name: string;
  suggestedCustomerId: number | null;
}

export interface ManhourPreviewResult {
  fiscalYear: number;
  orgCode: string | null;
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

    const customerByName = new Map(
      this.db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .all()
        .map((c) => [c.name, c.id]),
    );
    const customerMatches: ManhourCustomerMatch[] = parsed.customerNames.map(
      (name) => ({
        name,
        suggestedCustomerId: customerByName.get(name) ?? null,
      }),
    );
    const projectMatches: ManhourProjectMatch[] = parsed.projects.map((p) =>
      this.matchProject(p),
    );

    const totalHours = parsed.entries.reduce((s, e) => s + e.hours, 0);
    return {
      fiscalYear,
      orgCode: parsed.orgCode,
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

  private matchProject(p: ParsedProjectIdentity): ManhourProjectMatch {
    let suggestedProjectId: number | null = null;
    let suggestedProjectName: string | null = null;
    if (p.projectCode) {
      // CD 一致を優先（確定案件を仮案件より優先）。
      const rows = this.db
        .select({
          id: projects.id,
          name: projects.name,
          isProvisional: projects.isProvisional,
        })
        .from(projects)
        .where(eq(projects.projectCode, p.projectCode))
        .all();
      const best =
        rows.find((r) => r.isProvisional === 0) ?? rows[0] ?? null;
      if (best) {
        suggestedProjectId = best.id;
        suggestedProjectName = best.name;
      }
    }
    return {
      projectKey: p.projectKey,
      projectCode: p.projectCode,
      sampleName: p.sampleName,
      customerName: p.customerName,
      suggestedProjectId,
      suggestedProjectName,
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
            })
            .returning()
            .get();
          nameToAssigneeId.set(r.name, created.id);
          assigneesCreated += 1;
        }
        // skip → マップに入れない（その担当者の行は取り込まない）
      }

      // 1.5) 顧客の名寄せ（CSV E列。未登録は顧客マスタに新規登録）
      let customersCreated = 0;
      const customerNameToId = new Map<string, number>();
      for (const r of dto.customerResolution ?? []) {
        if (r.action === 'link' && r.customerId !== undefined) {
          customerNameToId.set(r.name, r.customerId);
        } else if (r.action === 'create' && r.newCustomer) {
          const created = tx
            .insert(customers)
            .values({
              code: r.newCustomer.code?.trim() || null,
              name: r.newCustomer.name.trim(),
              isActive: 1,
              sortOrder: 0,
            })
            .returning()
            .get();
          customerNameToId.set(r.name, created.id);
          customersCreated += 1;
        }
        // skip → マップに入れない（その顧客は紐づけない）
      }

      // 2) 案件の名寄せ（未一致/CD空は仮案件、再取込で重複作成しない）
      let projectsCreated = 0;
      const keyToProjectId = new Map<string, number>();
      for (const r of dto.projectResolution) {
        if (r.action === 'link' && r.projectId !== undefined) {
          keyToProjectId.set(r.projectKey, r.projectId);
          continue;
        }
        const name = (r.provisionalName?.trim() || r.projectKey).slice(0, 200);
        const code = r.projectCode?.trim() || null;
        // 仮案件の重複防止: CD があれば CD、無ければ名前で既存の仮案件を再利用。
        const dupe = code
          ? tx
              .select({ id: projects.id })
              .from(projects)
              .where(
                and(
                  eq(projects.projectCode, code),
                  eq(projects.isProvisional, 1),
                ),
              )
              .get()
          : tx
              .select({ id: projects.id })
              .from(projects)
              .where(
                and(eq(projects.name, name), eq(projects.isProvisional, 1)),
              )
              .get();
        if (dupe) {
          keyToProjectId.set(r.projectKey, dupe.id);
          continue;
        }
        const customerId = r.customerName
          ? (customerNameToId.get(r.customerName) ?? null)
          : null;
        const created = tx
          .insert(projects)
          .values({
            name,
            customerId,
            projectCode: code,
            isProvisional: 1,
          })
          .returning()
          .get();
        keyToProjectId.set(r.projectKey, created.id);
        projectsCreated += 1;
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
        if (!isZz && e.projectKey) {
          const pid = keyToProjectId.get(e.projectKey);
          if (pid === undefined) continue; // 解決不能な案件は取り込まない
          projectId = pid;
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
