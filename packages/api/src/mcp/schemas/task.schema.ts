import { z } from 'zod';
import { YyyyMmDd } from './common.schema';

export const CreateTaskSchema = z.object({
  projectId: z.number().int().positive(),
  level: z.number().int().min(1).max(3),
  parentId: z.number().int().nullable().optional(),
  name: z.string().max(500),
  startDate: YyyyMmDd.optional(),
  duration: z.number().int().min(1).optional(),
  actualStartDate: YyyyMmDd.nullable().optional(),
  actualEndDate: YyyyMmDd.nullable().optional(),
  plannedHours: z.number().min(0).nullable().optional(),
  actualHours: z.number().min(0).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  assigneeId: z.number().int().nullable().optional(),
  status: z.string().max(100).optional(),
  sortOrder: z.number().int().optional(),
});

export const UpdateTaskSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().max(500).optional(),
  startDate: YyyyMmDd.optional(),
  duration: z.number().int().min(1).optional(),
  actualStartDate: YyyyMmDd.nullable().optional(),
  actualEndDate: YyyyMmDd.nullable().optional(),
  plannedHours: z.number().min(0).nullable().optional(),
  actualHours: z.number().min(0).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  assigneeId: z.number().int().nullable().optional(),
  status: z.string().max(100).optional(),
  note: z.string().max(2000).nullable().optional(),
  cascade: z.boolean().optional(),
});

export const ReorderTasksSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        sortOrder: z.number().int(),
      }),
    )
    .min(1)
    .max(200),
});
