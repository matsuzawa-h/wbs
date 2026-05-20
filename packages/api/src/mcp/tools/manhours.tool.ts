import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ManhoursService } from '../../manhours/manhours.service';
import { IdParam } from '../schemas/common.schema';
import {
  BatchListQuerySchema,
  CapacitySummaryQuerySchema,
  ManualEntrySchema,
  ManualProjectSchema,
  ProjectMatrixQuerySchema,
} from '../schemas/manhour.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class ManhoursTool {
  private readonly logger = new Logger(ManhoursTool.name);

  constructor(private readonly manhours: ManhoursService) {}

  @Tool({
    name: 'manhour_batch_list',
    description:
      '稼働管理表（明細）の取込バッチ一覧を取得する（取込日時降順。fiscalYear で年度絞込み可）。',
    parameters: BatchListQuerySchema,
  })
  listBatches(input: z.infer<typeof BatchListQuerySchema>) {
    return asJson(this.manhours.listBatches(input.fiscalYear));
  }

  @Tool({
    name: 'manhour_summary',
    description:
      '担当者横断の稼働見通しサマリーを取得する。担当者×月の工数（確定=取込/仮=手入力 別、案件内訳）と、月基準時間に対する稼働率を返す。誰がいつ逼迫/空きかの判断に使う。batchId 未指定なら年度（または全体）の最新取込。imported/manual で確定/仮を出し分け（既定は両方 true）。',
    parameters: CapacitySummaryQuerySchema,
  })
  summary(input: z.infer<typeof CapacitySummaryQuerySchema>) {
    return asJson(
      this.manhours.getSummary({
        fiscalYear: input.fiscalYear,
        batchId: input.batchId,
        filter: {
          imported: input.imported ?? true,
          manual: input.manual ?? true,
        },
        organizationId: input.organizationId,
      }),
    );
  }

  @Tool({
    name: 'manhour_project_matrix',
    description:
      '指定プロジェクトの担当者×月の工数マトリクスを取得する（取込工数＋仮の手入力）。プロジェクトのガントと突き合わせて要員配分を確認する用途。',
    parameters: ProjectMatrixQuerySchema,
  })
  projectMatrix(input: z.infer<typeof ProjectMatrixQuerySchema>) {
    const { projectId, ...q } = input;
    return asJson(
      this.manhours.getProjectMatrix(projectId, {
        fiscalYear: q.fiscalYear,
        batchId: q.batchId,
        filter: { imported: q.imported ?? true, manual: q.manual ?? true },
      }),
    );
  }

  @Tool({
    name: 'manhour_manual_entry_set',
    description:
      '仮プロジェクトの月工数を手入力で登録/更新する（担当者×案件×作業区分×年月で upsert、hours<=0 で削除）。取込データには影響せず、再取込でも残る。yearMonth は YYYY-MM。',
    parameters: ManualEntrySchema,
  })
  setManualEntry(input: z.infer<typeof ManualEntrySchema>) {
    this.logger.log(
      `manhour_manual_entry_set assignee=${input.assigneeId} ym=${input.yearMonth}`,
    );
    return asJson(this.manhours.upsertManualEntry(input));
  }

  @Tool({
    name: 'manhour_manual_entry_delete',
    description: '手入力の工数明細を削除する（取込データは削除不可）。',
    parameters: IdParam,
  })
  deleteManualEntry(input: z.infer<typeof IdParam>) {
    this.logger.warn(`manhour_manual_entry_delete id=${input.id}`);
    this.manhours.deleteManualEntry(input.id);
    return asJson({ deleted: input.id });
  }

  @Tool({
    name: 'manhour_manual_project_create',
    description:
      '稼働見通し用の仮プロジェクト（is_provisional=1）を作成する。受注前の見込み案件などをキャパ計画に載せる用途。',
    parameters: ManualProjectSchema,
  })
  createManualProject(input: z.infer<typeof ManualProjectSchema>) {
    this.logger.log(`manhour_manual_project_create name="${input.name}"`);
    return asJson(this.manhours.createManualProject(input));
  }

  @Tool({
    name: 'manhour_batch_delete',
    description:
      '取込バッチを削除する（配下の工数明細・月基準時間もカスケード削除。仮案件は他バッチ/手入力が参照しうるため残す）。',
    parameters: IdParam,
  })
  deleteBatch(input: z.infer<typeof IdParam>) {
    this.logger.warn(`manhour_batch_delete id=${input.id}`);
    this.manhours.deleteBatch(input.id);
    return asJson({ deleted: input.id });
  }
}
