import { z } from 'zod';

// ManualEntryDto と完全一致（mcp-schema-parity.spec で担保）。
// hours は確定取込の上書き(overlay)を表現するため負値も許可。
// 0 は manual の明示削除。
export const ManualEntrySchema = z.object({
  assigneeId: z.number().int().positive(),
  projectId: z.number().int().positive().nullable().optional(),
  workType: z.string().max(8).optional(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM'),
  hours: z.number(),
});

// ManualProjectDto と完全一致。
export const ManualProjectSchema = z.object({
  name: z.string().min(1).max(200),
  projectCode: z.string().max(64).nullable().optional(),
  customerId: z.number().int().nullable().optional(),
});

// 以下はクエリ系（class-validator DTO を持たないため parity 対象外）。
export const BatchListQuerySchema = z.object({
  fiscalYear: z.number().int().optional(),
  organizationId: z.number().int().nullable().optional(),
});

export const CapacitySummaryQuerySchema = z.object({
  fiscalYear: z.number().int().optional(),
  batchId: z.number().int().positive().optional(),
  imported: z.boolean().optional(),
  manual: z.boolean().optional(),
  organizationId: z.number().int().nullable().optional(),
});

export const ProjectMatrixQuerySchema = z.object({
  projectId: z.number().int().positive(),
  fiscalYear: z.number().int().optional(),
  batchId: z.number().int().positive().optional(),
  imported: z.boolean().optional(),
  manual: z.boolean().optional(),
});
