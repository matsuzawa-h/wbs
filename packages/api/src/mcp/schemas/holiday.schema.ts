import { z } from 'zod';
import { YyyyMmDd } from './common.schema';

export const CreateHolidaySchema = z.object({
  date: YyyyMmDd,
  name: z.string().max(100).optional(),
});

export const UpdateHolidaySchema = z.object({
  id: z.number().int().positive(),
  date: YyyyMmDd.optional(),
  name: z.string().max(100).nullable().optional(),
});

export const BulkHolidaysSchema = z.object({
  items: z.array(CreateHolidaySchema).min(1).max(500),
});
