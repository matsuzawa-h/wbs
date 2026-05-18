import { z } from 'zod';
import { YyyyMmDd } from './common.schema';

// Mirrors CreatePersonalTaskDto (+ employeeId path param).
export const CreatePersonalTaskSchema = z.object({
  employeeId: z.number().int().positive(),
  projectId: z.number().int().nullable().optional(),
  name: z.string().max(500).optional(),
  startDate: YyyyMmDd.optional(),
  duration: z.number().int().min(1).optional(),
  actualStartDate: YyyyMmDd.nullable().optional(),
  actualEndDate: YyyyMmDd.nullable().optional(),
  plannedHours: z.number().min(0).nullable().optional(),
  actualHours: z.number().min(0).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  note: z.string().max(2000).nullable().optional(),
});

// Mirrors UpdatePersonalTaskDto (+ id path param).
export const UpdatePersonalTaskSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().nullable().optional(),
  name: z.string().max(500).optional(),
  startDate: YyyyMmDd.nullable().optional(),
  duration: z.number().int().min(1).nullable().optional(),
  actualStartDate: YyyyMmDd.nullable().optional(),
  actualEndDate: YyyyMmDd.nullable().optional(),
  plannedHours: z.number().min(0).nullable().optional(),
  actualHours: z.number().min(0).nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  note: z.string().max(2000).nullable().optional(),
});
